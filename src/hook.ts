#!/usr/bin/env node
/**
 * Claude Code hook entry point. Claude Code runs this on UserPromptSubmit,
 * PostToolUse, Stop, Notification and SessionEnd, passing the payload on stdin.
 *
 * Rules: never block the agent, never fail loudly. Always exit 0, finish in
 * milliseconds, and only print when there is a review note to hand to Claude.
 */
import { pathToFileURL } from 'node:url';
import { paths } from './paths.js';
import { appendLine, readJson } from './fsutil.js';
import { toEvent, type IEvent } from './events.js';
import { claimNotes, formatNotes } from './feedback.js';

function log(ev: IEvent): void {
  appendLine(paths.events(), JSON.stringify(ev));
}

function feedbackEnabled(): boolean {
  return readJson<{ feedback?: boolean }>(paths.config(), {}).feedback !== false;
}

/** Process one payload. Returns what to print on stdout, or null. */
export function handleHook(raw: string, now = Date.now()): string | null {
  let p: any;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  const name: string = p?.hook_event_name ?? '';
  const sid: string = typeof p?.session_id === 'string' ? p.session_id : 'unknown';
  const ev = toEvent(p, now);
  const relay = feedbackEnabled();

  if (name === 'Stop') {
    // Notes left while Claude was working: keep Claude going so it can address them.
    // stop_hook_active means we already did that once this turn; never loop.
    if (relay && !p.stop_hook_active) {
      const notes = claimNotes();
      if (notes.length) {
        log({ t: now, k: 'delivered', sid, ids: notes.map((n) => n.id) });
        return JSON.stringify({ decision: 'block', reason: formatNotes(notes) });
      }
    }
    if (ev) log(ev);
    return null;
  }

  if (ev) log(ev);

  if (relay && (name === 'PostToolUse' || name === 'UserPromptSubmit')) {
    const notes = claimNotes();
    if (notes.length) {
      log({ t: now, k: 'delivered', sid, ids: notes.map((n) => n.id) });
      return JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: formatNotes(notes) } });
    }
  }
  return null;
}

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

async function main(): Promise<void> {
  // Our own background `claude -p` calls (flashcard generation) must not feed back into the log.
  if (process.env.COWAIT_INTERNAL) return;
  const raw = await readStdin(2000);
  const out = handleHook(raw);
  // Pipes are asynchronous on Windows: wait for the write before exiting.
  if (out) await new Promise<void>((resolve) => process.stdout.write(out, () => resolve()));
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const guard = setTimeout(() => process.exit(0), 4000);
  main()
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(guard);
      process.exit(0);
    });
}
