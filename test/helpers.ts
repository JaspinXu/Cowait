import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Point Cowait at a fresh temp data folder for one test. */
export function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowait-test-'));
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
