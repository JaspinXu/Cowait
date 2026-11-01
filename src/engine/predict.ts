import type { Config } from '../config.js';
import { pendingCards, type State, type TurnRecord } from './state.js';

export type Mode = 'review' | 'game' | 'learn' | 'me';
export const MODES: Mode[] = ['review', 'game', 'learn', 'me'];

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Recent turn lengths to predict from: the same project when there is enough history, else overall. */
function sample(history: TurnRecord[], cwd?: string): number[] {
  if (cwd) {
    const local = history.filter((h) => h.cwd === cwd).slice(-7).map((h) => h.ms);
    if (local.length >= 3) return local;
  }
  const all = history.slice(-15).map((h) => h.ms);
  return all.length >= 3 ? all : [];
}

/**
 * Expected total length of a Claude turn: the median of recent turns. Once a turn has already run
 * `elapsedMs`, only turns that lasted at least that long are relevant, so the estimate moves out
 * instead of showing a time already passed. Null when there is no history, or when this turn is
 * already longer than any seen before.
 */
export function predictWait(history: TurnRecord[], cwd?: string, elapsedMs = 0): number | null {
  const xs = sample(history, cwd);
  if (!xs.length) return null;
  const m = median(xs);
  if (elapsedMs <= m) return m;
  const longer = xs.filter((x) => x > elapsedMs);
  return longer.length ? median(longer) : null;
}

/**
 * Auto mode: what fits this wait?
 *  - Claude's changes waiting for review always come first (review first, then play).
 *  - A short wait gets flashcards; a long one gets a game (if there is energy for it).
 */
export function chooseMode(s: State, cfg: Config, predictedMs: number | null): Mode {
  if (pendingCards(s).length > 0) return 'review';
  // First run: show what Cowait is for (and how to hook it up) before offering a game.
  if (s.totals.turns === 0 && s.totals.cards === 0) return 'review';
  const short = predictedMs !== null && predictedMs < cfg.shortWaitSec * 1000;
  if (short) return 'learn';
  const canPlay = (s.game !== null && s.game.phase !== 'dead' && s.game.phase !== 'victory') || s.energy >= cfg.runCost;
  return canPlay ? 'game' : 'learn';
}
