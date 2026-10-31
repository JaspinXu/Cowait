import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Folder that contains package.json (dist/ and src/ both sit one level below it). */
export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Where Cowait keeps its data (events, state, notes, decks).
 *  1. COWAIT_HOME, if set (tests, demo mode, power users).
 *  2. A cloned/portable install keeps data next to the program, in <install>/data,
 *     so everything stays on the drive you installed to (e.g. G:\Cowait\data).
 *  3. A global npm install (inside node_modules) falls back to ~/.cowait.
 */
export function dataDir(): string {
  if (process.env.COWAIT_HOME) return process.env.COWAIT_HOME;
  const root = packageRoot();
  if (!root.split(path.sep).includes('node_modules')) return path.join(root, 'data');
  return path.join(os.homedir(), '.cowait');
}

export const paths = {
  events: () => path.join(dataDir(), 'events.jsonl'),
  state: () => path.join(dataDir(), 'state.json'),
  config: () => path.join(dataDir(), 'config.json'),
  feedback: () => path.join(dataDir(), 'feedback'),
  decks: () => path.join(dataDir(), 'decks'),
  lock: () => path.join(dataDir(), 'panel.lock'),
};
