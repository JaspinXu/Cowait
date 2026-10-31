/** Turn a review card into displayable diff lines. */
import { structuredPatch } from 'diff';
import type { EditInfo } from '../events.js';
import { splitByWidth } from '../text.js';

export interface DiffLine {
  /** `sep` starts the next edit on a card that holds several edits to one file. */
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'sep';
  text: string;
  /** Line number in the new file (or old file for deletions), when known. For `sep`: the edit's number. */
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

/** Every edit on the card, in order; later edits to the same file each start with a `sep` line. */
export function cardDiff(card: EditInfo & { more?: EditInfo[] }): DiffLine[] {
  const out = editDiff(card);
  (card.more ?? []).forEach((e, i) => {
    out.push({ type: 'sep', text: '', no: i + 2 });
    out.push(...editDiff(e));
  });
  return out;
}

function editDiff(card: EditInfo): DiffLine[] {
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

export interface DiffRow {
  type: DiffLine['type'];
  text: string;
  /** Set on the first row of a line only. */
  no?: number;
  /** A wrapped continuation of the line above. */
  cont?: boolean;
}

/**
 * Lay diff lines out as screen rows `width` columns wide. Long lines wrap instead of being
 * cut off: in a narrow side panel the end of a line is often the part worth reviewing.
 */
export function diffRows(lines: DiffLine[], width: number): DiffRow[] {
  const out: DiffRow[] = [];
  for (const d of lines) {
    if (d.type === 'hunk' || d.type === 'sep') {
      out.push({ type: d.type, text: d.text, no: d.no });
      continue;
    }
    splitByWidth(d.text.replace(/\t/g, '  '), width).forEach((text, i) =>
      out.push(i === 0 ? { type: d.type, text, no: d.no } : { type: d.type, text, cont: true }),
    );
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
    if (d.type === 'sep') {
      s += `--- edit #${d.no} ---\n`;
      continue;
    }
    const prefix = d.type === 'add' ? '+' : d.type === 'del' ? '-' : d.type === 'hunk' ? '' : ' ';
    s += prefix + d.text + '\n';
    if (s.length > maxChars) return s.slice(0, maxChars) + '\n…\n';
  }
  return s;
}
