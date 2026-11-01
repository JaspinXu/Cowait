import { describe, it, expect } from 'vitest';
import { applyEvents, sweep } from '../src/engine/reducer.js';
import { newState, pendingCards, coverage } from '../src/engine/state.js';
import { applyVerdict, grantDaily, ECON } from '../src/engine/economy.js';
import { chooseMode, predictWait } from '../src/engine/predict.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { cardDiff } from '../src/engine/diff.js';
import { isTestCommand, testOutcome } from '../src/testdetect.js';
import { rate, nextCard } from '../src/learn/srs.js';
import { parseCards } from '../src/learn/generate.js';
import type { IEvent } from '../src/events.js';

const edit = (t: number, file = '/p/a.ts'): IEvent => ({ t, k: 'tool', sid: 's', cwd: '/p', tool: 'Edit', edit: { file, kind: 'edit', hunks: [{ old: 'a', new: 'b' }] } });

describe('reducer', () => {
  it('pays coins for outcomes, not for waiting', () => {
    const s = newState();
    const sig = applyEvents(s, [
      { t: 0, k: 'prompt', sid: 's', cwd: '/p' },
      edit(1000),
      { t: 2000, k: 'tool', sid: 's', cwd: '/p', tool: 'Bash', bash: { cmd: 'npm test', test: true, result: 'pass' } },
      { t: 60_000, k: 'stop', sid: 's', cwd: '/p' },
    ]);
    expect(s.coins).toBe(13);
    expect(s.totals).toMatchObject({ turns: 1, testsPassed: 1, cards: 1 });
    expect(s.history).toEqual([{ cwd: '/p', ms: 60_000, t: 60_000 }]);
    expect(pendingCards(s)).toHaveLength(1);
    expect(sig.map((x) => x.type)).toEqual(['turn_start', 'turn_done', 'new_card']);

    // A 20-minute turn that only chats earns nothing.
    applyEvents(s, [
      { t: 100_000, k: 'prompt', sid: 's', cwd: '/p' },
      { t: 1_300_000, k: 'stop', sid: 's', cwd: '/p' },
    ]);
    expect(s.coins).toBe(13);
    // A working turn whose tests fail earns only the base.
    applyEvents(s, [
      { t: 2_000_000, k: 'prompt', sid: 's', cwd: '/p' },
      { t: 2_000_100, k: 'tool', sid: 's', cwd: '/p', tool: 'Bash', bash: { cmd: 'pytest', test: true, result: 'fail' } },
      { t: 2_000_200, k: 'stop', sid: 's', cwd: '/p' },
    ]);
    expect(s.coins).toBe(16);
  });

  it('flags a busy session that needs approval, ignores idle notifications', () => {
    const s = newState();
    applyEvents(s, [{ t: 0, k: 'notify', sid: 's', cwd: '/p', msg: 'waiting for input' }]);
    expect(s.sessions.s.status).toBe('idle');
    const sig = applyEvents(s, [
      { t: 1, k: 'prompt', sid: 's', cwd: '/p' },
      { t: 2, k: 'notify', sid: 's', cwd: '/p', msg: 'Claude needs your permission to use Bash' },
    ]);
    expect(s.sessions.s.status).toBe('attention');
    expect(sig.at(-1)).toMatchObject({ type: 'attention' });
    applyEvents(s, [{ t: 3, k: 'tool', sid: 's', cwd: '/p', tool: 'Bash' }]);
    expect(s.sessions.s.status).toBe('busy');
  });

  it('marks relayed notes as delivered and tracks coverage', () => {
    const s = newState();
    applyEvents(s, [edit(1, '/p/a.ts'), edit(2, '/p/b.ts'), edit(3, '/p/c.ts')]);
    const [a, b, c] = s.review;
    expect(applyVerdict(s, a.id, 'ok')).toBe(1);
    expect(applyVerdict(s, b.id, 'flag', { note: 'fix this', noteId: 'note1' })).toBe(2);
    expect(applyVerdict(s, b.id, 'ok')).toBe(0); // already decided
    applyVerdict(s, c.id, 'skip');
    expect(s.energy).toBe(13);
    expect(coverage(s)).toBeCloseTo(2 / 3);
    applyEvents(s, [{ t: 9, k: 'delivered', sid: 's', ids: ['note1'] }]);
    expect(s.review[1].delivered).toBe(true);
    expect(s.totals.delivered).toBe(1);
  });

  it('caps the card queue, dropping reviewed cards first', () => {
    const s = newState();
    applyEvents(s, [edit(1)]);
    applyVerdict(s, s.review[0].id, 'ok');
    applyEvents(
      s,
      Array.from({ length: ECON.maxCards }, (_, i) => edit(10 + i, `/p/f${i}.ts`)),
    );
    expect(s.review).toHaveLength(ECON.maxCards);
    expect(s.review.every((c) => c.status === 'new')).toBe(true);
  });

  it('expires sessions that went silent', () => {
    const s = newState();
    applyEvents(s, [{ t: 0, k: 'prompt', sid: 's', cwd: '/p' }]);
    expect(sweep(s, 60_000)).toBe(false);
    expect(sweep(s, 16 * 60_000)).toBe(true);
    expect(s.sessions.s.status).toBe('idle');
  });

  it('gives a daily bonus once a day, not on first launch', () => {
    const s = newState();
    const day1 = new Date(2026, 10, 1, 9).getTime();
    expect(grantDaily(s, day1)).toBe(0);
    expect(grantDaily(s, day1 + 3600_000)).toBe(0);
    expect(grantDaily(s, day1 + 26 * 3600_000)).toBe(5);
    expect(s.energy).toBe(15);
  });
});

describe('auto mode', () => {
  const cfg = DEFAULT_CONFIG;
  it('predicts from the same project first', () => {
    const h = [10, 20, 30].map((s) => ({ cwd: '/a', ms: s * 1000, t: 0 })).concat([100, 200, 300].map((s) => ({ cwd: '/b', ms: s * 1000, t: 0 })));
    expect(predictWait(h, '/a')).toBe(20_000);
    expect(predictWait(h, '/c')).toBe(65_000);
    expect(predictWait([], '/a')).toBeNull();
  });

  it('re-estimates a turn that has already run past the usual length', () => {
    const h = [30, 60, 90, 120, 600].map((s) => ({ cwd: '/a', ms: s * 1000, t: 0 }));
    expect(predictWait(h, '/a', 10_000)).toBe(90_000);
    // 100 s in: only the 120 s and 600 s turns lasted this long, so expect their median.
    expect(predictWait(h, '/a', 100_000)).toBe(360_000);
    // Longer than anything seen before: no honest estimate.
    expect(predictWait(h, '/a', 700_000)).toBeNull();
  });

  it('starts a brand-new user on the review tab, the heart of the product', () => {
    expect(chooseMode(newState(), cfg, null)).toBe('review');
  });

  it('reviews first, then flashcards for short waits, games for long ones', () => {
    const s = newState();
    applyEvents(s, [edit(1)]);
    expect(chooseMode(s, cfg, 300_000)).toBe('review');
    applyVerdict(s, s.review[0].id, 'ok');
    expect(chooseMode(s, cfg, 20_000)).toBe('learn');
    expect(chooseMode(s, cfg, 120_000)).toBe('game');
    s.energy = 0;
    expect(chooseMode(s, cfg, 120_000)).toBe('learn');
  });
});

describe('diff rendering', () => {
  it('uses real line numbers from structuredPatch', () => {
    const d = cardDiff({ file: 'x', kind: 'edit', patch: [{ oldStart: 7, newStart: 7, lines: [' keep', '-old', '+new', '+more'] }] });
    expect(d.map((x) => [x.type, x.no])).toEqual([
      ['hunk', undefined],
      ['ctx', 7],
      ['del', 8],
      ['add', 8],
      ['add', 9],
    ]);
  });
  it('diffs raw old/new strings', () => {
    const d = cardDiff({ file: 'x', kind: 'edit', hunks: [{ old: 'a\nb\nc', new: 'a\nB\nc' }] });
    expect(d.filter((x) => x.type === 'del').map((x) => x.text)).toEqual(['b']);
    expect(d.filter((x) => x.type === 'add').map((x) => x.text)).toEqual(['B']);
  });
});

describe('test detection', () => {
  it.each([
    ['npm test', true],
    ['npm run test -- --watch=false', true],
    ['pnpm test', true],
    ['npx vitest run', true],
    ['cd api && pytest -q tests/', true],
    ['python -m pytest', true],
    ['go test ./...', true],
    ['cargo test', true],
    ['./gradlew test', true],
    ['git status', false],
    ['cat pytest.ini', false],
    ['npm install', false],
  ])('%s → %s', (cmd, expected) => expect(isTestCommand(cmd)).toBe(expected));

  it.each([
    ['Tests: 1 failed, 4 passed, 5 total', 'fail'],
    ['Tests: 5 passed, 5 total', 'pass'],
    ['===== 12 passed in 0.31s =====', 'pass'],
    ['FAILED tests/test_x.py::test_a - assert 1 == 2\n1 failed', 'fail'],
    ['ok  \tgithub.com/x/y\t0.012s', 'pass'],
    ['--- FAIL: TestX (0.00s)', 'fail'],
    ['test result: ok. 3 passed; 0 failed', 'pass'],
    ['Ran 4 tests in 0.001s\n\nOK', 'pass'],
    ['0 failed, 3 passed', 'pass'],
    ['something else', 'unknown'],
  ])('%s → %s', (out, expected) => expect(testOutcome(out)).toBe(expected));
});

describe('spaced repetition', () => {
  it('moves cards between boxes and serves due cards first', () => {
    const now = 1_000_000;
    let e = rate(undefined, 'good', now);
    expect(e.box).toBe(1);
    e = rate(e, 'easy', now);
    expect(e.box).toBe(3);
    e = rate(e, 'again', now);
    expect(e.box).toBe(0);
    const srs = { a: { box: 1, due: now - 10, seen: 1 }, b: { box: 2, due: now + 10_000, seen: 1 } };
    expect(nextCard(['a', 'b', 'c'], srs, now)).toEqual({ id: 'a', isNew: false });
    expect(nextCard(['b', 'c'], srs, now)).toEqual({ id: 'c', isNew: true });
    expect(nextCard(['b'], srs, now)).toBeNull();
  });
});

describe('AI deck parsing', () => {
  it('extracts the JSON array even with chatter around it', () => {
    const out = 'Sure! Here you go:\n```json\n[{"q":"What is X?","a":"X is Y."},{"q":"","a":"skip me"}]\n```';
    expect(parseCards(out)).toEqual([{ q: 'What is X?', a: 'X is Y.' }]);
    expect(() => parseCards('no cards')).toThrow();
  });
});
