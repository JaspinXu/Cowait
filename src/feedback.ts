/**
 * Review notes travel from the panel to Claude through a folder of small files.
 * The panel writes one file per note; the hook claims files by renaming them
 * (rename is atomic, so parallel hook processes never deliver a note twice).
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths, within } from './paths.js';
import { ensureDir, parseJson } from './fsutil.js';

export interface Note {
  id: string;
  t: number;
  text: string;
  file?: string;
  cardId?: string;
  /** The project the note is about: a Claude session working in it (or below it) receives the note. */
  cwd?: string;
  /** The Claude session the note was written for: it always receives it, whatever folder it is in now. */
  sid?: string;
}

/**
 * Should a hook running in session `sid`, working in `cwd`, hand this note over? Its own session
 * always; otherwise only a session inside the note's project, never one in a parent folder (that
 * would let a session opened in ~/code swallow notes meant for ~/code/shop-api). Notes without a
 * target, or a payload without a cwd, keep the old behaviour: anyone may take them.
 */
function isFor(note: Note, cwd?: string, sid?: string): boolean {
  if (note.sid && sid && note.sid === sid) return true;
  if (!note.cwd || !cwd) return true;
  return within(cwd, note.cwd);
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
      out.push(parseJson<Note>(fs.readFileSync(path.join(paths.feedback(), f), 'utf8')));
    } catch {
      /* skip broken file */
    }
  }
  return out;
}

/**
 * Take ownership of the waiting notes meant for this session (see `isFor`; all of them when the
 * caller passes no session) and remove them from the queue. Notes for other projects stay put, so
 * with two Claude sessions open, a note about project A never lands in project B's session.
 * Notes are tiny and rare: when there are none this is one directory read, as before.
 */
export function claimNotes(cwd?: string, sid?: string): Note[] {
  const dir = paths.feedback();
  const out: Note[] = [];
  for (const f of noteFiles()) {
    const src = path.join(dir, f);
    let note: Note | null = null;
    try {
      note = parseJson<Note>(fs.readFileSync(src, 'utf8'));
    } catch {
      // Unreadable, or claimed by another hook a moment ago: the claim below sorts it out.
    }
    if (note && typeof note.text === 'string' && !isFor(note, cwd, sid)) continue;
    const claimed = `${src}.claimed-${process.pid}`;
    try {
      fs.renameSync(src, claimed);
    } catch {
      continue; // another hook process got it first
    }
    try {
      // The rename is atomic and note files never change, so what was read above is what we own.
      note ??= parseJson<Note>(fs.readFileSync(claimed, 'utf8'));
      if (!note || typeof note.text !== 'string') throw new Error('not a note');
      out.push(note);
      fs.unlinkSync(claimed);
    } catch {
      // Never silently lose what the user wrote: set unreadable files aside instead of deleting them.
      try {
        fs.renameSync(claimed, `${src}.unreadable`);
      } catch {
        /* ignore */
      }
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
