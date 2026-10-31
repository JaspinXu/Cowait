import type { Config } from '../config.js';
import { pendingCards, type State, type TurnRecord } from './state.js';

export type Mode = 'review' | 'game' | 'learn';
export const MODES: Mode[] = ['review', 'game', 'learn'];

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Expected length of the next Claude turn: median of recent turns in the same project, else overall. */
export function predictWait(history: TurnRecord[], cwd?: string): number | null {
  if (cwd) {
    const local = history.filter((h) => h.cwd === cwd).slice(-7).map((h) => h.ms);
    if (local.length >= 3) return median(local);
  }
  const all = history.slice(-15).map((h) => h.ms);
  return all.length >= 3 ? median(all) : null;
}

/**
 * Auto mode: what fits this wait?
 *  - Claude's changes waiting for review always come first (review first, then play).
 *  - A short wait gets flashcards; a long one gets a game (if there is energy for it).
 */
export function chooseMode(s: State, cfg: Config, predictedMs: number | null): Mode {
  if (pendingCards(s).length > 0) return 'review';
  const short = predictedMs !== null && predictedMs < cfg.shortWaitSec * 1000;
  if (short) return 'learn';
  const canPlay = (s.game !== null && s.game.phase !== 'dead' && s.game.phase !== 'victory') || s.energy >= cfg.runCost;
  return canPlay ? 'game' : 'learn';
}
