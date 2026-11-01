/** Bridges a run's outcome into the persistent stats, economy and progress. */
import { ECON } from '../engine/economy.js';
import { track, unlock } from '../engine/progress.js';
import type { State } from '../engine/state.js';
import type { Phase } from './engine.js';

export type Before = { phase: Phase; floor: number } | null;

export function snapshot(s: State): Before {
  return s.game ? { phase: s.game.phase, floor: s.game.floor } : null;
}

export function settleRun(s: State, before: Before, now = Date.now()): 'won' | 'lost' | null {
  const g = s.game;
  if (!g) return null;
  s.totals.bestFloor = Math.max(s.totals.bestFloor, g.floor);
  // A fight was just won (the reward screen, or the final victory).
  if (before?.phase === 'battle' && (g.phase === 'reward' || g.phase === 'victory')) track(s, 'floor', now);
  if (g.phase === 'victory' && before?.phase !== 'victory') {
    s.totals.wins++;
    s.energy += ECON.winEnergy;
    track(s, 'win', now);
    if (s.relics.length === 0) unlock(s, 'dungeon_bare', now);
    return 'won';
  }
  if (g.phase === 'dead' && before?.phase !== 'dead') return 'lost';
  return null;
}
