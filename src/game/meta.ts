/** Bridges a run's outcome into the persistent stats and economy. */
import { ECON } from '../engine/economy.js';
import type { State } from '../engine/state.js';
import type { Phase } from './engine.js';

export function settleRun(s: State, before: Phase | null): 'won' | 'lost' | null {
  const g = s.game;
  if (!g) return null;
  s.totals.bestFloor = Math.max(s.totals.bestFloor, g.floor);
  if (g.phase === 'victory' && before !== 'victory') {
    s.totals.wins++;
    s.energy += ECON.winEnergy;
    return 'won';
  }
  if (g.phase === 'dead' && before !== 'dead') return 'lost';
  return null;
}
