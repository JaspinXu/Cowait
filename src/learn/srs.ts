/** Leitner-box spaced repetition: small enough to reason about, good enough for micro-sessions. */
import type { SrsEntry } from '../engine/state.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** Wait before a card in box N comes back. Box 0 = "forgot it": see it again soon. */
export const BOX_INTERVALS = [1 * MIN, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY];

export type Rating = 'again' | 'good' | 'easy';

export function rate(prev: SrsEntry | undefined, r: Rating, now: number): SrsEntry {
  const box = prev ? prev.box : 0;
  const next = r === 'again' ? 0 : r === 'good' ? Math.min(box + 1, 5) : Math.min(box + 2, 5);
  return { box: next, due: now + BOX_INTERVALS[next], seen: (prev?.seen ?? 0) + 1 };
}

/** Next card to show: the most overdue known card, otherwise the first unseen one. */
export function nextCard(ids: string[], srs: Record<string, SrsEntry>, now: number): { id: string; isNew: boolean } | null {
  let best: string | null = null;
  let bestDue = Infinity;
  for (const id of ids) {
    const e = srs[id];
    if (e && e.due <= now && e.due < bestDue) {
      best = id;
      bestDue = e.due;
    }
  }
  if (best) return { id: best, isNew: false };
  const fresh = ids.find((id) => !srs[id]);
  return fresh ? { id: fresh, isNew: true } : null;
}

export function dueCount(ids: string[], srs: Record<string, SrsEntry>, now: number): number {
  return ids.filter((id) => srs[id] && srs[id].due <= now).length;
}
