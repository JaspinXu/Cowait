/**
 * Terminal text layout that works for Chinese as well as English, measured in terminal columns
 * (a CJK character or emoji takes two).
 *
 * Ink's own wrapping only breaks at spaces, so in mixed text an English word ends up alone on a line
 * and punctuation starts the next one. `wrapText` may break between any two CJK characters or at a
 * space, never inside an English word, never before closing punctuation, never after an opening bracket.
 */
import stringWidth from 'string-width';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const CLOSE = new Set(Array.from('，。、；：？！）》」』】〕〉…’”'));
const OPEN = new Set(Array.from('（《「『【〔〈‘“'));

const first = (s: string) => Array.from(s)[0] ?? '';
const last = (s: string) => Array.from(s).at(-1) ?? '';

/** Cut text into pieces at most `width` columns wide, anywhere (code, long identifiers, URLs). */
export function splitByWidth(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  const out: string[] = [];
  let chunk = '';
  let used = 0;
  for (const { segment: g } of graphemes.segment(text)) {
    const gw = stringWidth(g);
    if (used + gw > w && used > 0) {
      out.push(chunk);
      chunk = '';
      used = 0;
    }
    chunk += g;
    used += gw;
  }
  out.push(chunk);
  return out;
}

/** Unbreakable pieces of a line: English words, single spaces, single wide (CJK) characters. */
function units(text: string): string[] {
  const raw: string[] = [];
  let word = '';
  const flush = () => {
    if (word) raw.push(word);
    word = '';
  };
  for (const { segment: g } of graphemes.segment(text)) {
    if (g === ' ') {
      flush();
      raw.push(' ');
    } else if (stringWidth(g) >= 2) {
      flush();
      raw.push(g);
    } else word += g;
  }
  flush();
  // Kinsoku: glue closing punctuation to what comes before it…
  const glued: string[] = [];
  for (const u of raw) {
    const prev = glued.at(-1);
    if (prev !== undefined && prev !== ' ' && CLOSE.has(first(u))) glued[glued.length - 1] = prev + u;
    else glued.push(u);
  }
  // …and opening brackets to what comes after.
  const out: string[] = [];
  for (let i = 0; i < glued.length; i++) {
    let u = glued[i];
    while (OPEN.has(last(u)) && i + 1 < glued.length && glued[i + 1] !== ' ') u += glued[++i];
    out.push(u);
  }
  return out;
}

/** Word-wrap prose into lines at most `width` columns wide. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    let used = 0;
    for (const u of units(para)) {
      if (u === ' ') {
        if (used > 0 && used < w) {
          line += ' ';
          used += 1;
        }
        continue;
      }
      const uw = stringWidth(u);
      if (used + uw <= w) {
        line += u;
        used += uw;
        continue;
      }
      if (used > 0) lines.push(line.trimEnd());
      // Longer than a whole line (a URL, a long identifier): split it, keep filling after the last piece.
      const pieces = uw <= w ? [u] : splitByWidth(u, w);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1];
      used = stringWidth(line);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
