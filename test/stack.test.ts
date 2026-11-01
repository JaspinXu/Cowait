import { describe, it, expect } from 'vitest';
import {
  DIFFICULTY,
  FALLBACK,
  MAX_DEPTH,
  OPS,
  dailyDifficulty,
  dailyPuzzle,
  dailySeed,
  generatePuzzle,
  hint,
  localDay,
  newPuzzleRun,
  opById,
  press,
  puzzleNumber,
  pushOp,
  reset,
  sameStack,
  shareText,
  solve,
  stars,
  step,
  undo,
  type Difficulty,
  type Op,
  type Puzzle,
} from '../src/game/stack.js';

const LEVELS: Difficulty[] = [1, 2, 3];
const ALL_OPS: Op[] = [...Object.values(OPS), ...Array.from({ length: 9 }, (_, i) => pushOp(i + 1))];

/** Plain BFS straight on `step`, no pruning: an independent check of `par`. */
function shortest(start: number[], target: number[], buttons: Op[], max: number): number {
  const seen = new Set([start.join(',')]);
  let frontier = [start];
  for (let d = 0; d <= max; d++) {
    if (frontier.some((s) => sameStack(s, target))) return d;
    const next: number[][] = [];
    for (const s of frontier) {
      for (const b of buttons) {
        const r = step(s, b);
        if (!r.ok || seen.has(r.stack.join(','))) continue;
        seen.add(r.stack.join(','));
        next.push(r.stack);
      }
    }
    frontier = next;
  }
  return -1;
}

const op = (id: string) => opById(id)!;
const run = (stack: number[], id: string) => step(stack, op(id));

describe('Stack Puzzle: the machine', () => {
  it('runs every op', () => {
    expect(run([2, 7, 3], 'add')).toEqual({ ok: true, stack: [2, 10] });
    expect(run([7, 3], 'sub')).toEqual({ ok: true, stack: [4] }); // second minus top
    expect(run([7, 3], 'mul')).toEqual({ ok: true, stack: [21] });
    expect(run([7, 3], 'dup')).toEqual({ ok: true, stack: [7, 3, 3] });
    expect(run([1, 7, 3], 'swap')).toEqual({ ok: true, stack: [1, 3, 7] });
    expect(run([7, 3], 'over')).toEqual({ ok: true, stack: [7, 3, 7] });
    expect(run([7, 3], 'drop')).toEqual({ ok: true, stack: [7] });
    expect(run([7, 3], 'inc')).toEqual({ ok: true, stack: [7, 4] });
    expect(run([7, 3], 'dec')).toEqual({ ok: true, stack: [7, 2] });
    expect(run([7, 3], 'neg')).toEqual({ ok: true, stack: [7, -3] });
    expect(run([7], 'push3')).toEqual({ ok: true, stack: [7, 3] });
    expect(run([], 'push9')).toEqual({ ok: true, stack: [9] });
  });

  it('never produces -0', () => {
    const a = run([0, -3], 'mul');
    const b = run([0], 'neg');
    expect(a.ok && Object.is(a.stack[0], 0)).toBe(true);
    expect(b.ok && Object.is(b.stack[0], 0)).toBe(true);
  });

  it('refuses underflow, too-deep stacks and overflow with a reason, without throwing or mutating', () => {
    const one = [5];
    for (const id of ['add', 'sub', 'mul', 'swap', 'over']) {
      const r = run(one, id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.en).toMatch(/underflow/i);
    }
    for (const id of ['dup', 'drop', 'inc', 'dec', 'neg']) expect(run([], id).ok).toBe(false);
    expect(one).toEqual([5]);

    const full = [1, 2, 3, 4, 5, 6];
    expect(full).toHaveLength(MAX_DEPTH);
    for (const id of ['dup', 'over', 'push1']) {
      const r = run(full, id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.en).toMatch(/too deep/i);
    }
    expect(run(full, 'add').ok).toBe(true);
    expect(full).toEqual([1, 2, 3, 4, 5, 6]);

    for (const [stack, id] of [[[9999], 'inc'], [[-9999], 'dec'], [[5000, 5000], 'add'], [[-5000, 5000], 'sub'], [[100, 100], 'mul']] as const) {
      const r = run([...stack], id);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason.en).toMatch(/overflow/i);
        expect(r.reason.zh.length).toBeGreaterThan(0);
      }
    }
    expect(run([9998], 'inc')).toEqual({ ok: true, stack: [9999] });
  });

  it('has bilingual names and the expected button labels', () => {
    expect(ALL_OPS.map((o) => o.label).slice(0, 11)).toEqual(['+', '-', '×', 'dup', 'swap', 'over', 'drop', '+1', '-1', 'neg', 'push 1']);
    for (const o of ALL_OPS) {
      expect(o.name.zh && o.name.en && o.desc.zh && o.desc.en).toBeTruthy();
      expect(opById(o.id)).toEqual(o);
    }
    expect(opById('push0')).toBeNull();
    expect(opById('toString')).toBeNull();
  });
});

describe('Stack Puzzle: generation', () => {
  it('is deterministic for a seed', () => {
    for (const d of LEVELS) {
      expect(generatePuzzle(1234, d)).toEqual(generatePuzzle(1234, d));
      const shape = (p: Puzzle) => JSON.stringify([p.start, p.target, p.buttons.map((b) => b.id)]);
      const distinct = new Set(Array.from({ length: 20 }, (_, i) => shape(generatePuzzle(i, d))));
      expect(distinct.size).toBeGreaterThan(15);
    }
  });

  it('every puzzle is well-formed, fast to make, and solvable in exactly par moves', () => {
    for (const d of LEVELS) {
      const spec = DIFFICULTY[d];
      const pars = new Set<number>();
      for (let seed = 0; seed < 200; seed++) {
        const t0 = performance.now();
        const p = generatePuzzle(seed * 2654435761, d);
        const ms = performance.now() - t0;
        expect(ms).toBeLessThan(150);

        expect(p.difficulty).toBe(d);
        expect(p.buttons).toHaveLength(spec.buttons);
        expect(new Set(p.buttons.map((b) => b.id)).size).toBe(spec.buttons);
        expect(p.buttons.some((b) => ['add', 'sub', 'mul'].includes(b.kind))).toBe(true);
        expect(p.buttons.some((b) => ['dup', 'swap', 'over', 'drop'].includes(b.kind))).toBe(true);
        expect(p.buttons.filter((b) => b.kind === 'push').length).toBeLessThanOrEqual(2);

        expect(p.start.length).toBeGreaterThanOrEqual(1);
        expect(p.start.length).toBeLessThanOrEqual(3);
        for (const v of p.start) expect(v >= 1 && v <= 9 && Number.isInteger(v)).toBe(true);
        expect([1, 2]).toContain(p.target.length);
        expect(sameStack(p.start, p.target)).toBe(false);

        expect(p.par).toBeGreaterThanOrEqual(spec.par[0]);
        expect(p.par).toBeLessThanOrEqual(spec.par[1]);
        pars.add(p.par);
        const path = solve(p.start, p.target, p.buttons);
        expect(path).not.toBeNull();
        expect(path!.length).toBe(p.par);
        // Pressing that path really ends on the target.
        const r = newPuzzleRun(p, 'practice', 0);
        for (const i of path!) expect(press(r, i)).toBe(true);
        expect(r.solved).toBe(true);
      }
      // Both ends of the par range turn up.
      expect(pars.size).toBe(spec.par[1] - spec.par[0] + 1);
    }
  });

  it('par agrees with a plain, unpruned BFS', () => {
    for (const d of LEVELS) {
      for (let seed = 0; seed < 25; seed++) {
        const p = generatePuzzle(seed, d);
        expect(shortest(p.start, p.target, p.buttons, p.par)).toBe(p.par);
      }
    }
  });

  it('the fallback puzzles are sound too', () => {
    for (const d of LEVELS) {
      const f = FALLBACK[d];
      expect(f.buttons).toHaveLength(DIFFICULTY[d].buttons);
      expect(f.par).toBeGreaterThanOrEqual(DIFFICULTY[d].par[0]);
      expect(f.par).toBeLessThanOrEqual(DIFFICULTY[d].par[1]);
      expect(shortest(f.start, f.target, f.buttons, f.par)).toBe(f.par);
    }
  });
});

describe('Stack Puzzle: a run', () => {
  // [5, 2] → [14] with + swap push1 push7, par 3 (+ push7 +).
  const puzzle = (): Puzzle => ({ id: 'test', seed: 0, difficulty: 1, ...structuredClone(FALLBACK[1]) });

  it('press, refuse, undo, reset, solve', () => {
    const r = newPuzzleRun(puzzle(), 'practice', 1000);
    expect(r.stack).toEqual([5, 2]);
    expect(r).not.toHaveProperty('day');

    expect(press(r, 0)).toBe(true); // +
    expect(r.stack).toEqual([7]);
    expect(press(r, 1)).toBe(false); // swap needs two
    expect(r.error?.en).toMatch(/underflow/i);
    expect(r.prog).toEqual([0]);
    expect(r.stack).toEqual([7]);
    expect(press(r, 9)).toBe(false);
    expect(r.error?.en).toMatch(/no such button/i);

    expect(press(r, 2)).toBe(true); // push 1
    expect(r.error).toBeUndefined();
    expect(r.stack).toEqual([7, 1]);
    expect(undo(r)).toBe(true);
    expect(r.stack).toEqual([7]);
    expect(r.prog).toEqual([0]);

    expect(reset(r)).toBe(true);
    expect(r.stack).toEqual([5, 2]);
    expect(r.prog).toEqual([]);
    expect(undo(r)).toBe(false);

    for (const i of [0, 3, 0]) press(r, i); // + push7 +
    expect(r.stack).toEqual([14]);
    expect(r.solved).toBe(true);
    expect(r.presses).toBe(5);
    expect(r.prog).toEqual([0, 3, 0]);

    // Solved is final.
    expect(press(r, 2)).toBe(false);
    expect(undo(r)).toBe(false);
    expect(reset(r)).toBe(false);
    expect(r.stack).toEqual([14]);
    expect(stars(r.puzzle, r.prog.length, r.hints)).toBe(3);
  });

  it('survives a JSON round trip and repairs a stale save on undo', () => {
    const r = newPuzzleRun(puzzle(), 'daily', 5, '2026-11-02');
    press(r, 0);
    press(r, 3);
    const saved = JSON.parse(JSON.stringify(r));
    expect(saved).toEqual(r);
    expect(press(saved, 0)).toBe(true);
    expect(saved.solved).toBe(true);

    const stale = JSON.parse(JSON.stringify(r));
    stale.prog = [0, 3, 1, 9, 1]; // there is no button 9: replay stops before it
    expect(undo(stale)).toBe(true);
    expect(stale.prog).toEqual([0, 3, 1]);
    expect(stale.stack).toEqual([7, 7]);
  });

  it('following hints solves every puzzle in exactly par presses', () => {
    for (const d of LEVELS) {
      for (let seed = 0; seed < 40; seed++) {
        const r = newPuzzleRun(generatePuzzle(seed, d), 'practice', 0);
        for (let guard = 0; guard < 20 && !r.solved; guard++) {
          const h = hint(r);
          expect(h).not.toBeNull();
          expect(press(r, h!)).toBe(true);
        }
        expect(r.solved).toBe(true);
        expect(r.prog.length).toBe(r.puzzle.par);
        expect(r.hints).toBe(r.puzzle.par);
        expect(hint(r)).toBeNull();
        expect(r.hints).toBe(r.puzzle.par);
        expect(stars(r.puzzle, r.prog.length, r.hints)).toBe(2);
      }
    }
  });

  it('hints recover from a detour, or give up without counting', () => {
    let recovered = 0;
    for (let seed = 0; seed < 60; seed++) {
      const r = newPuzzleRun(generatePuzzle(seed, 2), 'practice', 0);
      for (let k = 0; k < 3; k++) press(r, (seed + k) % r.puzzle.buttons.length);
      if (r.solved) continue;
      const before = r.hints;
      const first = hint(r);
      if (first === null) {
        expect(r.hints).toBe(before);
        continue;
      }
      expect(press(r, first)).toBe(true);
      for (let guard = 0; guard < 12 && !r.solved; guard++) {
        const next = hint(r);
        expect(next).not.toBeNull();
        expect(press(r, next!)).toBe(true);
      }
      expect(r.solved).toBe(true);
      recovered++;
    }
    expect(recovered).toBeGreaterThan(10);
  });

  it('stars', () => {
    const p = { ...puzzle(), par: 4 };
    expect(stars(p, 4, 0)).toBe(3);
    expect(stars(p, 3, 0)).toBe(3);
    expect(stars(p, 5, 0)).toBe(2);
    expect(stars(p, 6, 0)).toBe(2);
    expect(stars(p, 7, 0)).toBe(1);
    expect(stars(p, 4, 1)).toBe(2); // hints cap a solve at two stars
    expect(stars(p, 6, 3)).toBe(2);
    expect(stars(p, 9, 1)).toBe(1);
  });
});

describe('Stack Puzzle: daily', () => {
  it('seeds are stable 32-bit numbers that change every day', () => {
    // Pinned: changing the hash would change everyone's daily puzzle.
    expect(dailySeed('2026-11-01')).toBe(3352276839);
    const seeds = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const s = dailySeed(localDay(Date.UTC(2026, 10, 1 + i, 12)));
      expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
      seeds.add(s);
    }
    expect(seeds.size).toBe(60);
  });

  it('difficulty follows the weekday of the date', () => {
    // 2026-11-01 is a Sunday.
    const week = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
    expect(week.map(dailyDifficulty)).toEqual([3, 1, 1, 2, 2, 3, 3]);
    expect(dailyDifficulty('2027-03-01')).toBe(1); // a Monday
  });

  it('numbers puzzles from #1 on 2026-11-01', () => {
    expect(puzzleNumber('2026-11-01')).toBe(1);
    expect(puzzleNumber('2026-11-12')).toBe(12);
    expect(puzzleNumber('2026-12-01')).toBe(31);
    expect(puzzleNumber('2027-01-01')).toBe(62);
    expect(puzzleNumber('2028-03-01')).toBe(487); // across a leap day
  });

  it('daily puzzles are deterministic and match the day', () => {
    const p = dailyPuzzle('2026-11-04');
    expect(p).toEqual(dailyPuzzle('2026-11-04'));
    expect(p.id).toBe('daily-2026-11-04');
    expect(p.difficulty).toBe(2);
    expect(p.seed).toBe(dailySeed('2026-11-04'));
    expect(dailyPuzzle('2026-11-05')).not.toEqual(p);
  });

  it('localDay formats the local calendar date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDay(new Date(2026, 10, 1, 0, 0).getTime())).toBe('2026-11-01');
  });
});

describe('Stack Puzzle: sharing', () => {
  const solveDaily = (day: string, withHint = false) => {
    const r = newPuzzleRun(dailyPuzzle(day), 'daily', 0, day);
    if (withHint) press(r, hint(r)!);
    for (const i of solve(r.stack, r.puzzle.target, r.puzzle.buttons)!) press(r, i);
    return r;
  };

  it('formats daily and practice results', () => {
    const r = solveDaily('2026-11-12');
    const par = r.puzzle.par;
    expect(shareText(r, 'zh')).toBe(`Cowait 栈机谜题 #12 ★★★ ${par} 步（标准 ${par}）`);
    expect(shareText(r, 'en')).toBe(`Cowait Stack Puzzle #12 ★★★ in ${par} (par ${par})`);

    const h = solveDaily('2026-11-12', true);
    expect(shareText(h, 'zh')).toBe(`Cowait 栈机谜题 #12 ★★☆ ${par} 步（标准 ${par}，提示 1 次）`);
    expect(shareText(h, 'en')).toBe(`Cowait Stack Puzzle #12 ★★☆ in ${par} (par ${par}, 1 hint)`);

    const p = newPuzzleRun(generatePuzzle(7, 1), 'practice', 0);
    expect(shareText(p, 'en')).toBe(`Cowait Stack Puzzle (practice) not solved yet (par ${p.puzzle.par})`);
    expect(shareText(p, 'zh')).toBe(`Cowait 栈机谜题（练习）还没解出（标准 ${p.puzzle.par}）`);
    for (const i of solve(p.stack, p.puzzle.target, p.puzzle.buttons)!) press(p, i);
    expect(shareText(p, 'en')).toMatch(/^Cowait Stack Puzzle \(practice\) ★★★ in \d+ \(par \d+\)$/);
    expect(shareText(p, 'en')).not.toContain('#');
  });

  it('never spoils the buttons or the solution', () => {
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-12']) {
      const r = solveDaily(day);
      for (const lang of ['zh', 'en'] as const) {
        const text = shareText(r, lang).toLowerCase();
        for (const o of ALL_OPS) {
          expect(text).not.toContain(o.label.toLowerCase());
          expect(text).not.toContain(o.name.en.toLowerCase());
          expect(text).not.toContain(o.name.zh);
        }
      }
    }
  });
});
