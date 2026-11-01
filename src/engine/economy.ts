/**
 * Two currencies, earned in two different ways:
 *   ⚡ energy — earned by YOU doing something useful (reviewing Claude's changes, flashcards).
 *              Spent to start a game run. "Review first, then play."
 *   💰 coins  — earned by Claude's OUTCOMES, never by waiting time: a turn that actually
 *              did work, and a bonus when tests pass. Spent on permanent game gear.
 * Rewarding outcomes instead of minutes means a 20-minute run that goes nowhere pays nothing extra.
 */
import { localDay, turnByKey, type CardStatus, type State } from './state.js';
import { track } from './progress.js';

export { localDay };

export const ECON = {
  reviewOk: 1,
  reviewFlag: 2,
  learnCard: 1,
  dailyBonus: 5,
  coinWorkTurn: 3,
  coinTestsPass: 10,
  winEnergy: 5,
  /** A Code Sprint round, and a practice Stack Puzzle (the daily puzzle is free). */
  sprintCost: 1,
  practiceCost: 1,
  maxCards: 150,
  /** Changes left unreviewed this long are archived (counted as skipped), so the queue never becomes a guilt pile. */
  expireMs: 24 * 60 * 60 * 1000,
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
  opts: { note?: string; noteId?: string; quick?: boolean; now?: number } = {},
): number {
  const card = s.review.find((c) => c.id === cardId);
  if (!card || card.status !== 'new') return 0;
  const now = opts.now ?? Date.now();
  card.status = verdict;
  let gain = 0;
  if (verdict === 'ok' && opts.quick) {
    // Rubber-stamping is not reviewing: it must not pay, or count toward coverage.
    card.quick = true;
    s.totals.skimmed++;
    track(s, 'skimmed', now);
  } else if (verdict === 'ok') {
    s.totals.reviewed++;
    gain = ECON.reviewOk;
    track(s, 'reviewed', now);
  } else if (verdict === 'flag') {
    s.totals.flagged++;
    card.note = opts.note;
    card.noteId = opts.noteId;
    gain = ECON.reviewFlag;
    track(s, 'flagged', now);
    track(s, 'note', now);
  } else {
    s.totals.skipped++;
    track(s, 'skipped', now);
  }
  s.energy += gain;
  // Every file of a turn read (none skimmed, none skipped): that turn was reviewed in full.
  const meta = turnByKey(s, card.turn);
  if (meta && !meta.full && verdict !== 'skip' && !card.quick) {
    const mates = s.review.filter((c) => c.turn === card.turn);
    if (mates.every((c) => (c.status === 'ok' || c.status === 'flag') && !c.quick)) {
      meta.full = true;
      track(s, 'fullTurn', now);
    }
  }
  return gain;
}

/** Archive changes nobody looked at for a day. Returns how many were archived. */
export function expireOld(s: State, now: number): number {
  let n = 0;
  for (const c of s.review) {
    if (c.status !== 'new' || now - (c.last ?? c.t) < ECON.expireMs) continue;
    c.status = 'skip';
    c.expired = true;
    s.totals.skipped++;
    s.totals.expired++;
    n++;
  }
  return n;
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
