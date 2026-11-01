import { describe, it, expect } from 'vitest';
import type { ReviewCard } from '../src/engine/state.js';
import {
  OVERFLOW,
  PAUSE_CAP_MS,
  SNIPPETS,
  accuracy,
  backspace,
  charStates,
  currentLine,
  isPersonalBest,
  linesFromChanges,
  newSprint,
  progress,
  result,
  typeChar,
  wpm,
  type Sprint,
} from '../src/game/sprint.js';

/** Type `text` one key at a time, `step` ms apart, starting at `t`; returns the time after the last key. */
function typeKeys(sp: Sprint, text: string, t: number, step: number): number {
  for (const c of text) {
    typeChar(sp, c, t);
    t += step;
  }
  return t;
}

const LINE_A = 'const total = items.length;';
const LINE_B = 'return users.map((u) => u.id);';

function card(extra: Partial<ReviewCard>): ReviewCard {
  return { id: 'c', t: 0, sid: 's', cwd: '/p', status: 'new', file: '/p/a.ts', kind: 'edit', ...extra };
}

describe('SNIPPETS', () => {
  it('are plenty, distinct, and fit the rules', () => {
    expect(SNIPPETS.length).toBeGreaterThanOrEqual(70);
    expect(new Set(SNIPPETS).size).toBe(SNIPPETS.length);
    for (const s of SNIPPETS) {
      expect(s.length, s).toBeGreaterThanOrEqual(18);
      expect(s.length, s).toBeLessThanOrEqual(60);
      expect(s, s).toMatch(/^[\x20-\x7e]+$/);
      expect(s, s).toBe(s.trim());
      expect(s, s).not.toContain('\t');
    }
  });
});

describe('linesFromChanges', () => {
  it("takes '+' patch lines and ignores removed and context lines", () => {
    const cards = [
      card({
        patch: [
          {
            oldStart: 1,
            newStart: 1,
            lines: [' const keep = context.line();', '-const removed = oldThing();', '+const added = newThing(arg);'],
          },
        ],
      }),
    ];
    expect(linesFromChanges(cards)).toEqual(['const added = newThing(arg);']);
  });

  it('takes only the new lines of old/new hunks', () => {
    const cards = [
      card({
        hunks: [
          {
            old: 'function load(id) {\n  return cache.get(id);\n}',
            new: 'function load(id) {\n  if (!id) throw new Error("no id");\n  return cache.get(id);\n}',
          },
        ],
      }),
    ];
    expect(linesFromChanges(cards)).toEqual(['if (!id) throw new Error("no id");']);
  });

  it('drops non-ASCII, short, long, letter-poor and comment lines', () => {
    const keep = 'const port = Number(env.PORT);';
    const lines = [
      keep,
      "const greeting = '你好，世界' + name;", // non-ASCII
      'const a = 1;', // shorter than 16
      'const value = ' + 'x'.repeat(60) + ';', // longer than 64
      '1 + 2 + 3 + 4 + 5 + 6 + 7 + 8;', // fewer than 4 letters
      '// explain why this matters here',
      '# python comment about the loop',
      '/* block comment opens right here',
      ' * continued block comment text',
      '',
    ];
    const cards = [card({ hunks: [{ old: '', new: lines.join('\n') }] })];
    expect(linesFromChanges(cards)).toEqual([keep]);
  });

  it('replaces tabs, trims ends and dedupes keeping the newest position', () => {
    const cards = [
      card({ hunks: [{ old: '', new: '\t\tif (a &&\tb) run(job);  \nconst first = makeFirst();' }] }),
      card({ hunks: [{ old: '', new: 'const later = makeLater();\nif (a &&  b) run(job);' }] }),
    ];
    expect(linesFromChanges(cards)).toEqual(['const first = makeFirst();', 'const later = makeLater();', 'if (a &&  b) run(job);']);
  });

  it("includes a card's folded-in edits, after the card's own lines", () => {
    const cards = [
      card({
        hunks: [{ old: '', new: 'const first = makeFirst();' }],
        more: [
          { file: '/p/a.ts', kind: 'edit', patch: [{ oldStart: 1, newStart: 1, lines: ['+const second = makeSecond();'] }] },
          { file: '/p/a.ts', kind: 'edit', hunks: [{ old: 'x', new: 'x\nconst third = makeThird();' }] },
        ],
      }),
    ];
    expect(linesFromChanges(cards)).toEqual(['const first = makeFirst();', 'const second = makeSecond();', 'const third = makeThird();']);
  });

  it('returns the newest `max` lines', () => {
    const news = Array.from({ length: 30 }, (_, k) => `const value${k} = compute(${k});`);
    const cards = news.map((l) => card({ hunks: [{ old: '', new: l }] }));
    expect(linesFromChanges(cards)).toEqual(news.slice(-20));
    expect(linesFromChanges(cards, 3)).toEqual(news.slice(-3));
    expect(linesFromChanges(cards, 0)).toEqual([]);
  });

  it('skips the partial line in front of a clip marker', () => {
    const cards = [card({ hunks: [{ old: '', new: 'const whole = readAll();\nconst cut = somethingVeryLo\n…' }] })];
    expect(linesFromChanges(cards)).toEqual(['const whole = readAll();']);
  });
});

describe('newSprint', () => {
  it('is deterministic for a seed and picks distinct lines', () => {
    const a = newSprint(7, SNIPPETS);
    const b = newSprint(7, SNIPPETS);
    expect(a.lines).toEqual(b.lines);
    expect(a.lines).toHaveLength(5);
    expect(new Set(a.lines).size).toBe(5);
    const others = [1, 2, 3, 4, 5].map((s) => newSprint(s, SNIPPETS).lines.join('|'));
    expect(new Set(others).size).toBeGreaterThan(1);
    expect(a).toMatchObject({ i: 0, typed: '', keys: 0, errors: 0, done: false, source: 'builtin' });
  });

  it('tops a small pool up from SNIPPETS and skips unusable pool lines', () => {
    const sp = newSprint(3, [LINE_A, LINE_B, LINE_A, 'const s = "héllo wörld";'], 5, 'changes');
    expect(sp.lines).toHaveLength(5);
    expect(new Set(sp.lines).size).toBe(5);
    expect(sp.lines).toEqual(expect.arrayContaining([LINE_A, LINE_B]));
    expect(sp.lines.filter((l) => l !== LINE_A && l !== LINE_B).every((l) => SNIPPETS.includes(l))).toBe(true);
    expect(sp.source).toBe('changes');
  });

  it('survives a JSON round trip', () => {
    const sp = newSprint(9, SNIPPETS);
    typeKeys(sp, currentLine(sp).slice(0, 4), 1000, 100);
    const back: Sprint = JSON.parse(JSON.stringify(sp));
    typeChar(sp, currentLine(sp)[4], 2000);
    typeChar(back, currentLine(back)[4], 2000);
    expect(back).toEqual(sp);
  });
});

describe('typing', () => {
  it('plays a full round: done, wpm from active time, perfect accuracy', () => {
    const sp = newSprint(11, SNIPPETS);
    expect(progress(sp)).toEqual({ line: 1, of: 5 });
    let t = 10_000;
    const lines = sp.lines.slice();
    lines.forEach((line, k) => {
      expect(progress(sp).line).toBe(k + 1);
      t = typeKeys(sp, line, t, 120) + 2000; // a 2 s breather between lines is not counted
    });
    expect(sp.done).toBe(true);
    expect(sp.i).toBe(5);
    expect(progress(sp)).toEqual({ line: 5, of: 5 });
    const chars = lines.reduce((n, l) => n + l.length, 0);
    const ms = lines.reduce((n, l) => n + (l.length - 1) * 120, 0);
    expect(sp.activeMs).toBe(ms);
    expect(sp.perLine.map((p) => p.chars)).toEqual(lines.map((l) => l.length));
    expect(wpm(sp)).toBe(Math.round(chars / 5 / (ms / 60000)));
    expect(accuracy(sp)).toBe(1);
    expect(result(sp)).toEqual({ wpm: wpm(sp), accuracy: 1, ms, lines: 5 });

    const keys = sp.keys;
    typeChar(sp, 'x', t);
    expect(sp.keys).toBe(keys);
    expect(sp.typed).toBe('');
  });

  it('starts with no score', () => {
    const sp = newSprint(1, SNIPPETS);
    expect(wpm(sp)).toBe(0);
    expect(accuracy(sp)).toBe(1);
    expect(result(sp)).toEqual({ wpm: 0, accuracy: 1, ms: 0, lines: 0 });
  });

  it('counts errors until they are backspaced away', () => {
    const sp = newSprint(1, [LINE_A], 1);
    typeKeys(sp, 'cons', 0, 100);
    typeChar(sp, 'X', 400); // wrong
    typeChar(sp, 't', 500); // right letter, but after a mistake: still not a prefix
    expect(sp.errors).toBe(2);
    expect(sp.lineErrors).toBe(2);
    expect(sp.typed).toBe('consXt');
    backspace(sp, 600);
    backspace(sp, 700);
    expect(sp.typed).toBe('cons');
    expect(sp.errors).toBe(2);
    typeKeys(sp, LINE_A.slice(4), 800, 100);
    expect(sp.done).toBe(true);
    expect(sp.perLine[0].errors).toBe(2);
    expect(sp.keys).toBe(LINE_A.length + 4);
    expect(accuracy(sp)).toBeCloseTo((sp.keys - 2) / sp.keys);
  });

  it('a line never completes while a mistake is in it', () => {
    const sp = newSprint(1, [LINE_A, LINE_B], 2);
    const line = currentLine(sp);
    typeChar(sp, line.slice(0, -1) + '!', 0);
    expect(sp.i).toBe(0);
    typeChar(sp, line.slice(-1), 0);
    expect(sp.i).toBe(0);
  });

  it('backspace on an empty line does nothing', () => {
    const sp = newSprint(1, [LINE_A], 1);
    backspace(sp, 0);
    expect(sp.keys).toBe(0);
    expect(sp.lastKeyAt).toBeUndefined();
  });

  it('caps a long pause at 3 s, and the pause before a line is free', () => {
    const sp = newSprint(1, [LINE_A, LINE_B], 2);
    const first = currentLine(sp);
    typeChar(sp, first[0], 0);
    typeChar(sp, first[1], 60_000); // looked away for a minute
    expect(sp.activeMs).toBe(PAUSE_CAP_MS);
    typeChar(sp, first[2], 60_100);
    expect(sp.activeMs).toBe(PAUSE_CAP_MS + 100);
    typeChar(sp, first[3], 50_000); // clock went backwards: no negative time
    expect(sp.activeMs).toBe(PAUSE_CAP_MS + 100);
    const t = typeKeys(sp, first.slice(4), 50_100, 100);
    expect(sp.i).toBe(1);
    const before = sp.activeMs;
    typeChar(sp, currentLine(sp)[0], t + 600_000); // first key of the next line, much later
    expect(sp.activeMs).toBe(before);
  });

  it('takes chunks: a paste can finish a line and run on into the next', () => {
    const sp = newSprint(1, [LINE_A, LINE_B], 2);
    const [first, second] = sp.lines;
    typeChar(sp, first + second.slice(0, 5), 1000);
    expect(sp.i).toBe(1);
    expect(sp.perLine[0]).toEqual({ ms: 0, errors: 0, chars: first.length });
    expect(sp.typed).toBe(second.slice(0, 5));
    expect(sp.keys).toBe(first.length + 5);
    typeChar(sp, '\r\n\t', 1100); // Enter / Tab are not keys here
    expect(sp.keys).toBe(first.length + 5);
    typeChar(sp, '你', 1200); // IME output is ignored too
    expect(sp.typed).toBe(second.slice(0, 5));
    typeChar(sp, second.slice(5), 1300);
    expect(sp.done).toBe(true);
  });

  it('never lets typed run more than 8 chars past the line', () => {
    const sp = newSprint(1, [LINE_A], 1);
    typeChar(sp, 'z'.repeat(LINE_A.length + 30), 0);
    expect(sp.typed).toHaveLength(LINE_A.length + OVERFLOW);
    expect(sp.keys).toBe(LINE_A.length + 30);
    expect(sp.errors).toBe(LINE_A.length + 30);
    expect(sp.done).toBe(false);
  });
});

describe('charStates', () => {
  it('marks each position ok, bad or todo', () => {
    const sp = newSprint(1, [LINE_A], 1);
    typeChar(sp, 'cX', 0);
    const states = charStates(sp);
    expect(states).toHaveLength(LINE_A.length);
    expect(states.slice(0, 3)).toEqual(['ok', 'bad', 'todo']);
    expect(states.slice(2).every((s) => s === 'todo')).toBe(true);
  });

  it('covers typed text that runs past the line', () => {
    const sp = newSprint(1, [LINE_A], 1);
    typeChar(sp, LINE_A.slice(0, -1) + '!!!', 0);
    const states = charStates(sp);
    expect(states).toHaveLength(LINE_A.length + 2);
    expect(states.slice(0, LINE_A.length - 1).every((s) => s === 'ok')).toBe(true);
    expect(states.slice(LINE_A.length - 1)).toEqual(['bad', 'bad', 'bad']);
  });

  it('is empty once the round is done', () => {
    const sp = newSprint(1, [LINE_A], 1);
    typeChar(sp, LINE_A, 0);
    expect(charStates(sp)).toEqual([]);
  });
});

describe('isPersonalBest', () => {
  function round(errors: number, step: number): Sprint {
    const sp = newSprint(1, [LINE_A, LINE_B], 2);
    let t = 0;
    for (let k = 0; k < errors; k++) {
      typeChar(sp, '#', t);
      backspace(sp, (t += step));
      t += step;
    }
    for (const line of sp.lines.slice()) t = typeKeys(sp, line, t, step);
    return sp;
  }

  it('needs a finished, accurate, faster, humanly possible round', () => {
    const good = round(0, 150);
    expect(wpm(good)).toBeGreaterThan(0);
    expect(isPersonalBest(0, good)).toBe(true);
    expect(isPersonalBest(wpm(good), good)).toBe(false);

    const unfinished = newSprint(1, [LINE_A, LINE_B], 2);
    typeKeys(unfinished, unfinished.lines[0], 0, 150);
    expect(isPersonalBest(0, unfinished)).toBe(false);

    const sloppy = round(10, 150);
    expect(accuracy(sloppy)).toBeLessThan(0.9);
    expect(isPersonalBest(0, sloppy)).toBe(false);

    const pasted = round(0, 1);
    expect(wpm(pasted)).toBeGreaterThan(1000);
    expect(isPersonalBest(0, pasted)).toBe(false);
  });
});
