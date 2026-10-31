/** Turn a review card into displayable diff lines. */
import { structuredPatch } from 'diff';
import type { EditInfo } from '../events.js';

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
  /** Line number in the new file (or old file for deletions), when known. */
  no?: number;
}

function fromPatchLines(oldStart: number, newStart: number, lines: string[], out: DiffLine[]): void {
  let o = oldStart;
  let n = newStart;
  out.push({ type: 'hunk', text: `@@ -${oldStart} +${newStart} @@` });
  for (const raw of lines) {
    const tag = raw[0];
    const text = raw.slice(1);
    if (tag === '+') out.push({ type: 'add', text, no: n++ });
    else if (tag === '-') out.push({ type: 'del', text, no: o++ });
    else if (tag === '\\') continue; // "\ No newline at end of file"
    else {
      out.push({ type: 'ctx', text, no: n++ });
      o++;
    }
  }
}

export function cardDiff(card: EditInfo): DiffLine[] {
  const out: DiffLine[] = [];
  if (card.patch?.length) {
    for (const h of card.patch) fromPatchLines(h.oldStart, h.newStart, h.lines, out);
    return out;
  }
  for (const h of card.hunks ?? []) {
    if (!h.old) {
      // New content (new file or a Write without a diff): show it all as additions.
      out.push({ type: 'hunk', text: card.created ? '@@ new file @@' : '@@ written @@' });
      h.new.split('\n').forEach((text, i) => out.push({ type: 'add', text, no: i + 1 }));
      continue;
    }
    const p = structuredPatch('a', 'b', h.old.endsWith('\n') ? h.old : h.old + '\n', h.new.endsWith('\n') ? h.new : h.new + '\n', '', '', { context: 3 });
    // Line numbers are relative to the edited snippet, not the file, so leave them out.
    for (const hk of p.hunks) {
      const tmp: DiffLine[] = [];
      fromPatchLines(hk.oldStart, hk.newStart, hk.lines, tmp);
      out.push(...tmp.map((d) => (d.type === 'hunk' ? { type: 'hunk' as const, text: '@@' } : { ...d, no: undefined })));
    }
  }
  return out;
}

export function diffStats(lines: DiffLine[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const d of lines) {
    if (d.type === 'add') add++;
    else if (d.type === 'del') del++;
  }
  return { add, del };
}

/** Plain-text rendering, used when asking a model to write flashcards about recent changes. */
export function diffText(file: string, lines: DiffLine[], maxChars: number): string {
  let s = `### ${file}\n`;
  for (const d of lines) {
    const prefix = d.type === 'add' ? '+' : d.type === 'del' ? '-' : d.type === 'hunk' ? '' : ' ';
    s += prefix + d.text + '\n';
    if (s.length > maxChars) return s.slice(0, maxChars) + '\n…\n';
  }
  return s;
}
