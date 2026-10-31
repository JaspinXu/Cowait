/**
 * Review notes travel from the panel to Claude through a folder of small files.
 * The panel writes one file per note; the hook claims files by renaming them
 * (rename is atomic, so parallel hook processes never deliver a note twice).
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { ensureDir } from './fsutil.js';

export interface Note {
  id: string;
  t: number;
  text: string;
  file?: string;
  cardId?: string;
}

export function addNote(note: Note): void {
  const dir = paths.feedback();
  ensureDir(dir);
  const file = path.join(dir, `${note.t}-${note.id}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(note));
  fs.renameSync(tmp, file);
}

function noteFiles(): string[] {
  try {
    return fs
      .readdirSync(paths.feedback())
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

export function pendingNotes(): Note[] {
  const out: Note[] = [];
  for (const f of noteFiles()) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(paths.feedback(), f), 'utf8')));
    } catch {
      /* skip broken file */
    }
  }
  return out;
}

/** Take ownership of every waiting note and remove it from the queue. */
export function claimNotes(): Note[] {
  const dir = paths.feedback();
  const out: Note[] = [];
  for (const f of noteFiles()) {
    const src = path.join(dir, f);
    const claimed = `${src}.claimed-${process.pid}`;
    try {
      fs.renameSync(src, claimed);
    } catch {
      continue; // another hook process got it first
    }
    try {
      out.push(JSON.parse(fs.readFileSync(claimed, 'utf8')));
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(claimed);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** The message Claude sees. Written in English so it works for any model prompt language. */
export function formatNotes(notes: Note[]): string {
  const lines = notes.map((n) => `- ${n.file ? `${n.file}: ` : ''}"${n.text.replace(/\s+/g, ' ').trim()}"`);
  return [
    '[Cowait] While you were working, the user reviewed your recent changes in a side panel and left these notes.',
    'Take them into account now: fix what they point out, or briefly explain why not.',
    ...lines,
  ].join('\n');
}
