import os from 'node:os';
import path from 'node:path';
import { isCompiled, packageRoot } from './runtime.js';

export { packageRoot };

/**
 * Where Cowait keeps its data (events, state, notes, decks).
 *  1. COWAIT_HOME, if set (tests, demo mode, power users).
 *  2. A cloned/portable install keeps data next to the program, in <install>/data,
 *     so everything stays on the drive you installed to (e.g. G:\Cowait\data).
 *  3. A standalone binary, or a global npm install (inside node_modules), uses ~/.cowait.
 */
export function dataDir(): string {
  if (process.env.COWAIT_HOME) return process.env.COWAIT_HOME;
  if (isCompiled()) return path.join(os.homedir(), '.cowait');
  const root = packageRoot();
  if (!root.split(path.sep).includes('node_modules')) return path.join(root, 'data');
  return path.join(os.homedir(), '.cowait');
}

/** Comparable form of a path: forward slashes, no trailing slash, and case-folded for Windows drive paths. */
export function normPath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:(\/|$)/i.test(s) ? s.toLowerCase() : s;
}

/** Is `dir` the folder `root`, or inside it? */
export function within(dir: string, root: string): boolean {
  const d = normPath(dir);
  const r = normPath(root);
  return d === r || d.startsWith(r + '/');
}

export const paths = {
  events: () => path.join(dataDir(), 'events.jsonl'),
  state: () => path.join(dataDir(), 'state.json'),
  config: () => path.join(dataDir(), 'config.json'),
  feedback: () => path.join(dataDir(), 'feedback'),
  decks: () => path.join(dataDir(), 'decks'),
  lock: () => path.join(dataDir(), 'panel.lock'),
};
