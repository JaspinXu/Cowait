/** Folds hook events into panel state. Pure: no I/O, so it is easy to test. */
import type { IEvent } from '../events.js';
import { ECON, turnCoins } from './economy.js';
import type { Session, State } from './state.js';

export type Signal =
  | { type: 'turn_start'; sid: string; cwd: string }
  | { type: 'turn_done'; sid: string; cwd: string; ms: number; coins: number; pass: boolean; fail: boolean; edits: number }
  | { type: 'attention'; sid: string; cwd: string; msg: string }
  | { type: 'new_card'; count: number };

const STALE_BUSY_MS = 15 * 60 * 1000;
const FORGET_IDLE_MS = 24 * 60 * 60 * 1000;

function session(s: State, sid: string, cwd: string, t: number): Session {
  let x = s.sessions[sid];
  if (!x) {
    x = { cwd, status: 'idle', lastAt: t, tools: 0, edits: 0, pass: false, fail: false };
    s.sessions[sid] = x;
  }
  if (cwd) x.cwd = cwd;
  return x;
}

function trimCards(s: State): void {
  if (s.review.length <= ECON.maxCards) return;
  // Drop the oldest reviewed cards first, then the oldest unreviewed ones.
  const overflow = s.review.length - ECON.maxCards;
  const doneIdx = s.review.map((c, i) => (c.status !== 'new' ? i : -1)).filter((i) => i >= 0);
  const drop = new Set(doneIdx.slice(0, overflow));
  if (drop.size < overflow) {
    for (let i = 0; i < s.review.length && drop.size < overflow; i++) drop.add(i);
  }
  s.review = s.review.filter((_, i) => !drop.has(i));
}

export function applyEvents(s: State, events: IEvent[]): Signal[] {
  const out: Signal[] = [];
  let newCards = 0;
  for (const e of events) {
    switch (e.k) {
      case 'prompt': {
        const x = session(s, e.sid, e.cwd, e.t);
        Object.assign(x, { status: 'busy', turnStart: e.t, lastAt: e.t, tools: 0, edits: 0, pass: false, fail: false });
        out.push({ type: 'turn_start', sid: e.sid, cwd: x.cwd });
        break;
      }
      case 'tool': {
        const x = session(s, e.sid, e.cwd, e.t);
        if (x.status !== 'busy') {
          x.status = 'busy';
          x.turnStart ??= e.t;
        }
        x.lastAt = e.t;
        x.tools++;
        if (e.bash?.test) {
          if (e.bash.result === 'pass') x.pass = true;
          else if (e.bash.result === 'fail') x.fail = true;
        }
        if (e.edit) {
          s.seq++;
          s.review.push({ ...e.edit, id: `${e.t.toString(36)}-${s.seq}`, t: e.t, sid: e.sid, cwd: x.cwd, status: 'new' });
          s.totals.cards++;
          x.edits++;
          newCards++;
          trimCards(s);
        }
        break;
      }
      case 'stop': {
        const x = session(s, e.sid, e.cwd, e.t);
        if (x.turnStart !== undefined) {
          const ms = Math.max(0, e.t - x.turnStart);
          const coins = turnCoins(x.tools, x.pass);
          s.coins += coins;
          s.totals.turns++;
          if (x.pass) s.totals.testsPassed++;
          if (x.tools > 0) {
            s.history.push({ cwd: x.cwd, ms, t: e.t });
            if (s.history.length > 200) s.history = s.history.slice(-200);
          }
          out.push({ type: 'turn_done', sid: e.sid, cwd: x.cwd, ms, coins, pass: x.pass, fail: x.fail, edits: x.edits });
        }
        Object.assign(x, { status: 'idle', turnStart: undefined, lastAt: e.t });
        break;
      }
      case 'notify': {
        const x = session(s, e.sid, e.cwd, e.t);
        // Notifications also fire for "waiting for your input" after a finished turn; the
        // turn_done alert already covered that. Only a busy session needing approval matters.
        if (x.status === 'busy') {
          x.status = 'attention';
          x.lastAt = e.t;
          out.push({ type: 'attention', sid: e.sid, cwd: x.cwd, msg: e.msg });
        }
        break;
      }
      case 'end':
        delete s.sessions[e.sid];
        break;
      case 'delivered': {
        const ids = new Set(e.ids);
        for (const c of s.review) if (c.noteId && ids.has(c.noteId)) c.delivered = true;
        s.totals.delivered += e.ids.length;
        break;
      }
    }
  }
  if (newCards) out.push({ type: 'new_card', count: newCards });
  return out;
}

/** Expire sessions that went silent (e.g. the user pressed Esc, so no Stop event ever came). */
export function sweep(s: State, now: number): boolean {
  let changed = false;
  for (const [sid, x] of Object.entries(s.sessions)) {
    if (x.status !== 'idle' && now - x.lastAt > STALE_BUSY_MS) {
      Object.assign(x, { status: 'idle', turnStart: undefined });
      changed = true;
    } else if (x.status === 'idle' && now - x.lastAt > FORGET_IDLE_MS) {
      delete s.sessions[sid];
      changed = true;
    }
  }
  return changed;
}
