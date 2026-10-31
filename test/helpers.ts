import fs from 'node:fs';
import path from 'node:path';
import { afterAll } from 'vitest';

/**
 * Scratch folders for tests live inside the clone (data/ is git-ignored), not in the system temp
 * folder, and are removed when the test file finishes: nothing piles up on the system drive.
 */
const root = path.resolve(__dirname, '..', 'data', '.test-tmp');
const made: string[] = [];

export function tempDir(prefix: string): string {
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, prefix));
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Point Cowait at a fresh data folder for one test. */
export function tempHome(): string {
  const dir = tempDir('cowait-test-');
  process.env.COWAIT_HOME = dir;
  return dir;
}

export function readEvents(home: string): any[] {
  try {
    return fs
      .readFileSync(path.join(home, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
