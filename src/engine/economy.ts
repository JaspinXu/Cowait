/**
 * Two currencies, earned in two different ways:
 *   ⚡ energy — earned by YOU doing something useful (reviewing Claude's changes, flashcards).
 *              Spent to start a game run. "Review first, then play."
 *   💰 coins  — earned by Claude's OUTCOMES, never by waiting time: a turn that actually
 *              did work, and a bonus when tests pass. Spent on permanent game gear.
 * Rewarding outcomes instead of minutes means a 20-minute run that goes nowhere pays nothing extra.
 */
import type { CardStatus, State } from './state.js';

export const ECON = {
  reviewOk: 1,
  reviewFlag: 2,
  learnCard: 1,
  dailyBonus: 5,
  coinWorkTurn: 3,
  coinTestsPass: 10,
  winEnergy: 5,
  maxCards: 80,
  /** A flashcard rated sooner than this after it appeared earns nothing. */
  minStudyMs: 1500,
};

export function turnCoins(tools: number, pass: boolean): number {
  if (tools === 0) return 0; // a chat-only turn did no work
  return ECON.coinWorkTurn + (pass ? ECON.coinTestsPass : 0);
}

/**
 * Was this approval too fast to be a real review? A glance needs a moment, plus a little
 * per changed line, but never more than a few seconds: the rule catches key-mashing,
 * not careful readers. Pressing `y` faster than this still approves, it just earns nothing.
 */
export function isSkim(changedLines: number, shownMs: number): boolean {
  const needed = Math.min(4000, 600 + 80 * Math.max(0, changedLines));
  return shownMs < needed;
}

/** Apply a review verdict. Returns the energy gained. */
export function applyVerdict(
  s: State,
  cardId: string,
  verdict: Exclude<CardStatus, 'new'>,
  opts: { note?: string; noteId?: string; quick?: boolean } = {},
): number {
  const card = s.review.find((c) => c.id === cardId);
  if (!card || card.status !== 'new') return 0;
  card.status = verdict;
  let gain = 0;
  if (verdict === 'ok' && opts.quick) {
    // Rubber-stamping is not reviewing: it must not pay, or count toward coverage.
    card.quick = true;
    s.totals.skimmed++;
  } else if (verdict === 'ok') {
    s.totals.reviewed++;
    gain = ECON.reviewOk;
  } else if (verdict === 'flag') {
    s.totals.flagged++;
    card.note = opts.note;
    card.noteId = opts.noteId;
    gain = ECON.reviewFlag;
  } else {
    s.totals.skipped++;
  }
  s.energy += gain;
  return gain;
}

export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** First panel launch of the day gives a little energy. Returns the bonus granted. */
export function grantDaily(s: State, now: number): number {
  const today = localDay(now);
  if (s.lastDaily === today) return 0;
  const first = s.lastDaily === '';
  s.lastDaily = today;
  if (first) return 0; // brand-new state already starts with energy
  s.energy += ECON.dailyBonus;
  return ECON.dailyBonus;
}
