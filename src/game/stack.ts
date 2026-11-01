/**
 * Stack Puzzle (栈机谜题) — drive a tiny stack machine with a handful of buttons until
 * the stack is exactly the target. Every move is one keypress and nothing happens in
 * real time, so it can be dropped the instant Claude finishes and resumed on the next wait.
 *
 * Pure logic. Puzzles come from a seed (the daily one from the date); a run is plain
 * JSON and can be saved to disk as-is.
 */

import type { L } from './engine.js';

const l = (zh: string, en: string): L => ({ zh, en });

export const MAX_DEPTH = 6;
export const MAX_VALUE = 9999;
/** How far ahead a hint searches from the current stack. */
export const HINT_DEPTH = 10;
/**
 * Hint search gives up after this many distinct stacks: worst case ~70 ms, and it still finds
 * 99% of the paths a 4× larger budget finds (measured from scrambled mid-game stacks).
 */
const HINT_BUDGET = 100_000;
/** Targets stay small enough for mental arithmetic. */
const TARGET_MAX = 99;

// ---------------------------------------------------------------- ops

export type OpKind = 'add' | 'sub' | 'mul' | 'dup' | 'swap' | 'over' | 'drop' | 'inc' | 'dec' | 'neg' | 'push';

export interface Op {
  /** `kind`, or `push3` for "push 3". */
  id: string;
  kind: OpKind;
  /** Only for push. */
  n?: number;
  /** Short button text. */
  label: string;
  name: L;
  desc: L;
}

const op = (kind: Exclude<OpKind, 'push'>, label: string, name: L, desc: L): Op => ({ id: kind, kind, label, name, desc });

export const OPS: Record<Exclude<OpKind, 'push'>, Op> = {
  add: op('add', '+', l('加', 'Add'), l('顶上两数相加：a b → a+b', 'Add the top two: a b → a+b')),
  sub: op('sub', '-', l('减', 'Subtract'), l('下面的减上面的：a b → a-b', 'Second minus top: a b → a-b')),
  mul: op('mul', '*', l('乘', 'Multiply'), l('顶上两数相乘：a b → a×b', 'Multiply the top two: a b → a×b')),
  dup: op('dup', 'dup', l('复制', 'Duplicate'), l('复制栈顶：a → a a', 'Copy the top: a → a a')),
  swap: op('swap', 'swap', l('交换', 'Swap'), l('交换顶上两个：a b → b a', 'Swap the top two: a b → b a')),
  over: op('over', 'over', l('复制下层', 'Over'), l('把第二个复制到顶上：a b → a b a', 'Copy the second to the top: a b → a b a')),
  drop: op('drop', 'drop', l('丢弃', 'Drop'), l('扔掉栈顶：a b → a', 'Throw away the top: a b → a')),
  inc: op('inc', '+1', l('加一', 'Increment'), l('栈顶加 1：a → a+1', 'Add 1 to the top: a → a+1')),
  dec: op('dec', '-1', l('减一', 'Decrement'), l('栈顶减 1：a → a-1', 'Subtract 1 from the top: a → a-1')),
  neg: op('neg', 'neg', l('取反', 'Negate'), l('栈顶变号：a → -a', 'Flip the sign of the top: a → -a')),
};

export function pushOp(n: number): Op {
  return { id: `push${n}`, kind: 'push', n, label: `push ${n}`, name: l(`压入 ${n}`, `Push ${n}`), desc: l(`把 ${n} 放到栈顶：a → a ${n}`, `Put ${n} on top: a → a ${n}`) };
}

/** `add`, `swap`, `push3`, … → the op, or null. */
export function opById(id: string): Op | null {
  const m = /^push([1-9])$/.exec(id);
  if (m) return pushOp(Number(m[1]));
  return Object.prototype.hasOwnProperty.call(OPS, id) ? OPS[id as keyof typeof OPS] : null;
}

const KIND_ORDER: OpKind[] = ['add', 'sub', 'mul', 'inc', 'dec', 'neg', 'dup', 'swap', 'over', 'drop', 'push'];
const BINARY: Exclude<OpKind, 'push'>[] = ['add', 'sub', 'mul'];
const SHUFFLE: Exclude<OpKind, 'push'>[] = ['dup', 'swap', 'over', 'drop'];
const NEED: Record<OpKind, number> = { add: 2, sub: 2, mul: 2, swap: 2, over: 2, dup: 1, drop: 1, inc: 1, dec: 1, neg: 1, push: 0 };

// ---------------------------------------------------------------- the machine

const UNDERFLOW = 1;
const TOO_DEEP = 2;
const OVERFLOW = 3;
type Fail = typeof UNDERFLOW | typeof TOO_DEEP | typeof OVERFLOW;

/** Keep -0 out of stacks (0 × -3, -0) so equality and JSON stay boring. */
const norm = (x: number) => (x === 0 ? 0 : x);

/** The hot path for the searches: a new stack, or why the op cannot run. */
function apply(stack: number[], o: Op): number[] | Fail {
  const n = stack.length;
  if (n < NEED[o.kind]) return UNDERFLOW;
  const s = stack.slice();
  const a = s[n - 2];
  const b = s[n - 1];
  switch (o.kind) {
    case 'add':
      s.pop();
      s[n - 2] = a + b;
      break;
    case 'sub':
      s.pop();
      s[n - 2] = a - b;
      break;
    case 'mul':
      s.pop();
      s[n - 2] = norm(a * b);
      break;
    case 'dup':
      s.push(b);
      break;
    case 'swap':
      s[n - 2] = b;
      s[n - 1] = a;
      break;
    case 'over':
      s.push(a);
      break;
    case 'drop':
      s.pop();
      break;
    case 'inc':
      s[n - 1] = b + 1;
      break;
    case 'dec':
      s[n - 1] = b - 1;
      break;
    case 'neg':
      s[n - 1] = norm(-b);
      break;
    case 'push':
      s.push(o.n ?? 0);
      break;
  }
  if (s.length > MAX_DEPTH) return TOO_DEEP;
  // Only the top can have changed value.
  if (s.length && Math.abs(s[s.length - 1]) > MAX_VALUE) return OVERFLOW;
  return s;
}

function reason(f: Fail, o: Op): L {
  if (f === UNDERFLOW) {
    const need = NEED[o.kind];
    return need === 1
      ? l('栈是空的：这一步要 1 个数', 'Stack underflow: this needs a number')
      : l(`栈里的数不够：这一步要 ${need} 个`, `Stack underflow: this needs ${need} numbers`);
  }
  if (f === TOO_DEEP) return l(`栈满了：最多 ${MAX_DEPTH} 个数`, `Stack too deep: at most ${MAX_DEPTH} numbers`);
  return l(`数太大了：只能在 ±${MAX_VALUE} 之内`, `Overflow: numbers must stay within ±${MAX_VALUE}`);
}

export type StepResult = { ok: true; stack: number[] } | { ok: false; reason: L };

/** Run one op. Never mutates `stack`, never throws. */
export function step(stack: number[], o: Op): StepResult {
  const r = apply(stack, o);
  return typeof r === 'number' ? { ok: false, reason: reason(r, o) } : { ok: true, stack: r };
}

export function sameStack(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const key = (s: number[]) => s.join(',');

/**
 * Shortest button sequence (indexes into `buttons`) from `start` to `target`, or null if
 * there is none within `maxDepth` presses (or `budget` distinct stacks have been seen).
 * Ties go to the lower button index, so the answer is deterministic.
 */
export function solve(start: number[], target: number[], buttons: Op[], maxDepth = HINT_DEPTH, budget = HINT_BUDGET): number[] | null {
  if (sameStack(start, target)) return [];
  const goal = key(target);
  // child key → [parent key, button]; the root has button -1.
  const parent = new Map<string, [string, number]>([[key(start), ['', -1]]]);
  let frontier: [number[], string][] = [[start, key(start)]];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: [number[], string][] = [];
    const left = maxDepth - d;
    for (const [s, sk] of frontier) {
      for (let i = 0; i < buttons.length; i++) {
        const r = apply(s, buttons[i]);
        if (typeof r === 'number') continue;
        const k = key(r);
        if (parent.has(k)) continue;
        parent.set(k, [sk, i]);
        if (k === goal) {
          const path: number[] = [];
          for (let at = parent.get(k)!; at[1] !== -1; at = parent.get(at[0])!) path.push(at[1]);
          return path.reverse();
        }
        // Each press changes the depth by at most one.
        if (left > 0 && Math.abs(r.length - target.length) <= left) next.push([r, k]);
      }
      if (parent.size > budget) return null;
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------- generation

export type Difficulty = 1 | 2 | 3;

export interface Puzzle {
  id: string;
  seed: number;
  difficulty: Difficulty;
  start: number[];
  target: number[];
  buttons: Op[];
  /** Length of the shortest solution. */
  par: number;
}

export const DIFFICULTY: Record<Difficulty, { buttons: number; par: [number, number] }> = {
  1: { buttons: 4, par: [3, 4] },
  2: { buttons: 5, par: [4, 5] },
  3: { buttons: 6, par: [5, 7] },
};

/** mulberry32. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** murmur3's finaliser: spreads nearby inputs far apart. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

function pickButtons(rnd: () => number, count: number): Op[] {
  const pushes = Math.min(Math.floor(rnd() * 3), count - 2);
  // At least one two-operand arithmetic op and one stack-shuffling op.
  const kinds = new Set<Exclude<OpKind, 'push'>>([pick(rnd, BINARY), pick(rnd, SHUFFLE)]);
  const rest = (Object.keys(OPS) as Exclude<OpKind, 'push'>[]).filter((k) => !kinds.has(k));
  while (kinds.size < count - pushes) kinds.add(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
  const ns = new Set<number>();
  while (ns.size < pushes) ns.add(1 + Math.floor(rnd() * 9));
  return [...[...kinds].map((k) => OPS[k]), ...[...ns].map(pushOp)].sort(
    (x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || (x.n ?? 0) - (y.n ?? 0),
  );
}

function pickStart(rnd: () => number, buttons: Op[]): number[] {
  let len = 1 + Math.floor(rnd() * 3);
  // A lone number with no way to grow the stack would leave the two-operand ops dead.
  if (len === 1 && !buttons.some((b) => b.kind === 'dup' || b.kind === 'push')) len = 2;
  return Array.from({ length: len }, () => 1 + Math.floor(rnd() * 9));
}

interface Candidate {
  stack: number[];
  d: number;
}

/**
 * BFS over stacks from `start` (deduplicated), returning every stack of length 1–2 whose
 * shortest distance is in [lo, hi], in discovery order.
 */
function explore(start: number[], buttons: Op[], lo: number, hi: number): Candidate[] {
  const seen = new Set<string>([key(start)]);
  const out: Candidate[] = [];
  let frontier = [start];
  for (let d = 1; d <= hi && frontier.length; d++) {
    const next: number[][] = [];
    const last = d === hi;
    for (const s of frontier) {
      for (const b of buttons) {
        const r = apply(s, b);
        if (typeof r === 'number') continue;
        if (last && r.length > 2) continue; // never a target, never expanded
        const k = key(r);
        if (seen.has(k)) continue;
        seen.add(k);
        if (d >= lo && r.length >= 1 && r.length <= 2) out.push({ stack: r, d });
        // Only ops that consume (+ - × drop) shrink the stack, one per press.
        if (!last && r.length - 2 <= hi - d) next.push(r);
      }
    }
    frontier = next;
  }
  return out;
}

/** True when pressing one button over and over gets there: not much of a puzzle. */
function oneButtonOnly(start: number[], target: number[], d: number, buttons: Op[]): boolean {
  return buttons.some((b) => {
    let s: number[] | Fail = start;
    for (let i = 0; i < d && typeof s !== 'number'; i++) s = apply(s, b);
    return typeof s !== 'number' && sameStack(s, target);
  });
}

function tryGenerate(seed: number, difficulty: Difficulty): Omit<Puzzle, 'id' | 'seed' | 'difficulty'> | null {
  const rnd = rng(seed);
  const spec = DIFFICULTY[difficulty];
  const buttons = pickButtons(rnd, spec.buttons);
  const start = pickStart(rnd, buttons);
  const [lo, hi] = spec.par;
  // Values the player already has for free: on the start stack or on a push button.
  const known = new Set([...start, ...buttons.filter((b) => b.kind === 'push').map((b) => b.n)]);
  // Tier 0: every target value is new; 1: some are; 2: none are.
  const tiers: Candidate[][] = [[], [], []];
  for (const c of explore(start, buttons, lo, hi)) {
    if (c.stack.some((v) => Math.abs(v) > TARGET_MAX)) continue;
    if (oneButtonOnly(start, c.stack, c.d, buttons)) continue;
    const fresh = c.stack.filter((v) => !known.has(v)).length;
    tiers[fresh === c.stack.length ? 0 : fresh > 0 ? 1 : 2].push(c);
  }
  const tier = tiers.find((t) => t.length);
  if (!tier) return null;
  // Pick the par first so long puzzles (far more numerous) don't crowd out short ones.
  const pars = [...new Set(tier.map((c) => c.d))].sort((a, b) => a - b);
  const par = pick(rnd, pars);
  const target = pick(rnd, tier.filter((c) => c.d === par)).stack;
  return { start, target, buttons, par };
}

/** Over 15,000 seeds no puzzle needed more than 3 attempts. */
const MAX_ATTEMPTS = 200;

const fixed = (start: number[], target: number[], ids: string[], par: number) => ({ start, target, buttons: ids.map((id) => opById(id)!), par });

/** Only if every attempt fails, which has never happened; the tests check these are sound. */
export const FALLBACK: Record<Difficulty, Pick<Puzzle, 'start' | 'target' | 'buttons' | 'par'>> = {
  1: fixed([5, 2], [14], ['add', 'swap', 'push1', 'push7'], 3),
  2: fixed([2, 3], [9], ['add', 'sub', 'swap', 'push5', 'push7'], 5),
  3: fixed([9, 3], [74], ['add', 'mul', 'dup', 'drop', 'push6', 'push7'], 7),
};

/** A deterministic puzzle for this seed and difficulty. */
export function generatePuzzle(seed: number, difficulty: Difficulty): Puzzle {
  seed >>>= 0;
  let body: Omit<Puzzle, 'id' | 'seed' | 'difficulty'> | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !body; attempt++) {
    body = tryGenerate(attempt === 0 ? seed : fmix32(seed ^ Math.imul(attempt, 0x9e3779b9)), difficulty);
  }
  const b = body ?? FALLBACK[difficulty];
  return { id: `p${difficulty}-${seed}`, seed, difficulty, start: [...b.start], target: [...b.target], buttons: [...b.buttons], par: b.par };
}

// ---------------------------------------------------------------- a run (what the UI saves)

export type PuzzleMode = 'daily' | 'practice';

export interface PuzzleRun {
  puzzle: Puzzle;
  /** Button indexes pressed so far (only the ones that worked). */
  prog: number[];
  stack: number[];
  mode: PuzzleMode;
  /** YYYY-MM-DD, for daily runs. */
  day?: string;
  solved: boolean;
  startedAt: number;
  /** Every successful press, including ones later undone or reset. */
  presses: number;
  hints: number;
  /** Why the last press was refused; cleared by the next successful action. */
  error?: L;
}

export function newPuzzleRun(puzzle: Puzzle, mode: PuzzleMode, now: number, day?: string): PuzzleRun {
  const run: PuzzleRun = { puzzle, prog: [], stack: [...puzzle.start], mode, solved: false, startedAt: now, presses: 0, hints: 0 };
  if (day !== undefined) run.day = day;
  return run;
}

/** Press button `i`. Refused presses set `run.error` and change nothing; a solved run ignores input. */
export function press(run: PuzzleRun, i: number): boolean {
  if (run.solved) return false;
  const o = run.puzzle.buttons[i];
  if (!o) {
    run.error = l('没有这个按钮', 'No such button');
    return false;
  }
  const r = step(run.stack, o);
  if (!r.ok) {
    run.error = r.reason;
    return false;
  }
  run.stack = r.stack;
  run.prog.push(i);
  run.presses++;
  delete run.error;
  if (sameStack(run.stack, run.puzzle.target)) run.solved = true;
  return true;
}

/** Rebuild the stack from the program (also repairs a hand-edited or stale save). */
function replay(run: PuzzleRun): void {
  let s = [...run.puzzle.start];
  for (let k = 0; k < run.prog.length; k++) {
    const o = run.puzzle.buttons[run.prog[k]];
    const r = o ? apply(s, o) : UNDERFLOW;
    if (typeof r === 'number') {
      run.prog.length = k;
      break;
    }
    s = r;
  }
  run.stack = s;
}

/** Take back the last press. A solved run is final. */
export function undo(run: PuzzleRun): boolean {
  if (run.solved || !run.prog.length) return false;
  run.prog.pop();
  replay(run);
  delete run.error;
  return true;
}

/** Back to the start stack (hints and presses still count). A solved run is final. */
export function reset(run: PuzzleRun): boolean {
  if (run.solved) return false;
  run.prog = [];
  run.stack = [...run.puzzle.start];
  delete run.error;
  return true;
}

/**
 * The next button on a shortest path from the current stack, or null if the target can't be
 * reached within HINT_DEPTH presses (then undo/reset is the hint). Counts as a hint used.
 */
export function hint(run: PuzzleRun): number | null {
  if (run.solved) return null;
  const path = solve(run.stack, run.puzzle.target, run.puzzle.buttons, HINT_DEPTH);
  if (!path || !path.length) return null;
  run.hints++;
  return path[0];
}

/** 3: par or better with no hints; 2: within par + 2 (hints cap a solve at 2); 1: anything longer. */
export function stars(puzzle: Puzzle, len: number, hints: number): 1 | 2 | 3 {
  if (len <= puzzle.par && hints === 0) return 3;
  if (len <= puzzle.par + 2) return 2;
  return 1;
}

// ---------------------------------------------------------------- daily

const EPOCH = Date.UTC(2026, 10, 1); // puzzle #1
const DAY_MS = 86_400_000;

function dayUtc(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

/** The local calendar day of `now` as YYYY-MM-DD: the daily puzzle turns over at local midnight. */
export function localDay(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** FNV-1a over the date, then mixed: stable across machines and versions. */
export function dailySeed(day: string): number {
  let h = 0x811c9dc5;
  const s = `cowait-stack/${day}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** Mon/Tue easy, Wed/Thu medium, Fri–Sun hard — from the date itself, not the clock. */
export function dailyDifficulty(day: string): Difficulty {
  const wd = new Date(dayUtc(day)).getUTCDay();
  if (wd === 1 || wd === 2) return 1;
  if (wd === 3 || wd === 4) return 2;
  return 3;
}

/** #1 is 2026-11-01. */
export function puzzleNumber(day: string): number {
  return Math.round((dayUtc(day) - EPOCH) / DAY_MS) + 1;
}

export function dailyPuzzle(day: string): Puzzle {
  return { ...generatePuzzle(dailySeed(day), dailyDifficulty(day)), id: `daily-${day}` };
}

// ---------------------------------------------------------------- sharing

/** One spoiler-free line: number, stars, length vs par, hints. Never the buttons. */
export function shareText(run: PuzzleRun, lang: 'zh' | 'en'): string {
  const par = run.puzzle.par;
  const daily = run.mode === 'daily' && run.day !== undefined;
  const num = daily ? ` #${puzzleNumber(run.day!)}` : '';
  const len = run.prog.length;
  const n = run.solved ? stars(run.puzzle, len, run.hints) : 0;
  const starText = '★'.repeat(n) + '☆'.repeat(3 - n);
  if (lang === 'zh') {
    const head = `Cowait 栈机谜题${num}${daily ? ' ' : '（练习）'}`;
    if (!run.solved) return `${head}还没解出（标准 ${par}）`;
    return `${head}${starText} ${len} 步（标准 ${par}${run.hints ? `，提示 ${run.hints} 次` : ''}）`;
  }
  const head = `Cowait Stack Puzzle${num}${daily ? '' : ' (practice)'}`;
  if (!run.solved) return `${head} not solved yet (par ${par})`;
  const hints = run.hints ? `, ${run.hints} hint${run.hints > 1 ? 's' : ''}` : '';
  return `${head} ${starText} in ${len} (par ${par}${hints})`;
}
