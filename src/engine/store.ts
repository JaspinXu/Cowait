/** Disk I/O for the panel: state file, incremental event reading, log rotation, single-instance lock. */
import fs from 'node:fs';
import { paths } from '../paths.js';
import { ensureDir, readJson, writeJsonAtomic } from '../fsutil.js';
import type { IEvent } from '../events.js';
import { normalizeState, type State } from './state.js';
import { dataDir } from '../paths.js';

export function loadState(): State {
  return normalizeState(readJson<Partial<State> | null>(paths.state(), null));
}

export function saveState(s: State): void {
  writeJsonAtomic(paths.state(), s);
}

/** Read complete lines appended to the event log since `offset`. */
export function readNewEvents(offset: number): { events: IEvent[]; offset: number } {
  const file = paths.events();
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { events: [], offset: 0 };
  }
  if (size < offset) offset = 0; // log was rotated or truncated
  if (size === offset) return { events: [], offset };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return { events: [], offset }; // a line is still being written
    const text = buf.subarray(0, lastNl).toString('utf8');
    const events: IEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* skip corrupt line */
      }
    }
    return { events, offset: offset + lastNl + 1 };
  } finally {
    fs.closeSync(fd);
  }
}

const ROTATE_BYTES = 2 * 1024 * 1024;

/**
 * Keep the log small. Only called when every session is idle: rename the file away,
 * fold in anything appended since the last read, then drop it.
 */
export function rotateIfLarge(offset: number): { events: IEvent[]; rotated: boolean } {
  const file = paths.events();
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { events: [], rotated: false };
  }
  if (size < ROTATE_BYTES || offset < size) return { events: [], rotated: false };
  const old = `${file}.${Date.now()}.old`;
  try {
    fs.renameSync(file, old);
  } catch {
    return { events: [], rotated: false };
  }
  const events: IEvent[] = [];
  try {
    const rest = fs.readFileSync(old).subarray(offset).toString('utf8');
    for (const line of rest.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* partial line */
      }
    }
    fs.unlinkSync(old);
  } catch {
    /* ignore */
  }
  return { events, rotated: true };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

/** Only one panel may consume events at a time, otherwise rewards would be counted twice. */
export function acquireLock(): { ok: true } | { ok: false; pid: number } {
  ensureDir(dataDir());
  const file = paths.lock();
  const cur = readJson<{ pid?: number }>(file, {});
  if (cur.pid && cur.pid !== process.pid && pidAlive(cur.pid)) return { ok: false, pid: cur.pid };
  writeJsonAtomic(file, { pid: process.pid, t: Date.now() });
  return { ok: true };
}

export function releaseLock(): void {
  const cur = readJson<{ pid?: number }>(paths.lock(), {});
  if (cur.pid === process.pid) {
    try {
      fs.unlinkSync(paths.lock());
    } catch {
      /* ignore */
    }
  }
}
