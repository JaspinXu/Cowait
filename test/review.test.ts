import { describe, it, expect } from 'vitest';
import { applyEvents } from '../src/engine/reducer.js';
import { coverage, newState, pendingCards } from '../src/engine/state.js';
import { applyVerdict, isSkim } from '../src/engine/economy.js';
import { cardDiff, diffRows } from '../src/engine/diff.js';
import { describeChanges } from '../src/learn/generate.js';
import type { IEvent } from '../src/events.js';

const edit = (t: number, file = '/p/a.ts', sid = 's', old = 'a', next = 'b'): IEvent => ({
  t,
  k: 'tool',
  sid,
  cwd: '/p',
  tool: 'Edit',
  edit: { file, kind: 'edit', hunks: [{ old, new: next }] },
});

describe('review cards', () => {
  it('folds repeated edits to a file into the card that is still waiting for review', () => {
    const s = newState();
    const sig = applyEvents(s, [edit(1, '/p/a.ts'), edit(2, '/p/b.ts'), edit(3, '/p/a.ts')]);
    expect(pendingCards(s).map((c) => [c.file, c.more?.length ?? 0])).toEqual([
      ['/p/a.ts', 1],
      ['/p/b.ts', 0],
    ]);
    expect(s.review[0].last).toBe(3);
    expect(s.totals.cards).toBe(2);
    // Every edit still counts as news for auto mode.
    expect(sig).toContainEqual({ type: 'new_card', t: 3, count: 3 });
  });

  it('starts a fresh card once the earlier one has been reviewed', () => {
    const s = newState();
    applyEvents(s, [edit(1, '/p/a.ts')]);
    applyVerdict(s, s.review[0].id, 'ok');
    applyEvents(s, [edit(2, '/p/a.ts')]);
    expect(pendingCards(s)).toHaveLength(1);
    expect(pendingCards(s)[0].more).toBeUndefined();
    expect(s.totals.cards).toBe(2);
  });

  it('keeps edits from different sessions apart', () => {
    const s = newState();
    applyEvents(s, [edit(1, '/p/a.ts', 's1'), edit(2, '/p/a.ts', 's2')]);
    expect(pendingCards(s)).toHaveLength(2);
  });

  it('treats Windows paths that differ only in case or slash style as one file', () => {
    const s = newState();
    applyEvents(s, [edit(1, 'G:\\proj\\src\\a.ts'), edit(2, 'g:/proj/src/a.ts')]);
    expect(pendingCards(s)).toHaveLength(1);
  });

  it('does not fold an edit into a card that has sat untouched for a long time', () => {
    const s = newState();
    applyEvents(s, [edit(1_000, '/p/a.ts'), edit(1_000 + 31 * 60_000, '/p/a.ts')]);
    expect(pendingCards(s)).toHaveLength(2);
  });

  it('caps a merged card at 20 edits and opens a new one after that', () => {
    const s = newState();
    applyEvents(
      s,
      Array.from({ length: 21 }, (_, i) => edit(i + 1, '/p/a.ts')),
    );
    expect(pendingCards(s).map((c) => 1 + (c.more?.length ?? 0))).toEqual([20, 1]);
  });

  it('shows every merged edit, each under its own part marker', () => {
    const s = newState();
    applyEvents(s, [edit(1, '/p/a.ts', 's', 'one', 'ONE'), edit(2, '/p/a.ts', 's', 'two', 'TWO')]);
    const lines = cardDiff(s.review[0]);
    expect(lines.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['ONE', 'TWO']);
    expect(lines.filter((l) => l.type === 'sep').map((l) => l.no)).toEqual([2]);
  });
});

describe('quiz material', () => {
  it('feeds the model the newest code first when a file was edited many times', () => {
    const s = newState();
    const big = (v: string) => Array.from({ length: 40 }, (_, i) => `const ${v}_${i} = "${v}";`).join('\n');
    applyEvents(
      s,
      ['v1', 'v2', 'v3', 'v4', 'v5'].map((v, i) => edit(i + 1, '/p/a.ts', 's', '', big(v))),
    );
    const text = describeChanges(pendingCards(s), 3000);
    expect(text).toContain('v5_0');
    expect(text).not.toContain('v1_0');
    expect(text.length).toBeLessThanOrEqual(3000);
  });
});

describe('honest reviews', () => {
  it('treats an approval faster than the change could be read as a skim', () => {
    expect(isSkim(2, 300)).toBe(true);
    expect(isSkim(2, 1500)).toBe(false);
    // Bigger changes need longer…
    expect(isSkim(60, 2000)).toBe(true);
    expect(isSkim(60, 4500)).toBe(false);
    // …but never more than a few seconds, however large the diff.
    expect(isSkim(5000, 4500)).toBe(false);
  });

  it('pays no energy for a skim and leaves it out of review coverage', () => {
    const s = newState();
    applyEvents(s, [edit(1, '/p/a.ts'), edit(2, '/p/b.ts')]);
    expect(applyVerdict(s, s.review[0].id, 'ok', { quick: true })).toBe(0);
    expect(s.review[0].status).toBe('ok');
    expect(s.totals).toMatchObject({ reviewed: 0, skimmed: 1 });
    expect(applyVerdict(s, s.review[1].id, 'ok')).toBe(1);
    expect(coverage(s)).toBeCloseTo(1 / 2);
    expect(s.energy).toBe(11);
  });
});

describe('diff rows', () => {
  it('wraps long lines into continuation rows, counting CJK as two columns', () => {
    const rows = diffRows(
      [
        { type: 'add', text: 'abcdefghij', no: 3 },
        { type: 'ctx', text: '中文中文中', no: 4 },
      ],
      4,
    );
    expect(rows.map((r) => [r.type, r.text, r.no ?? null, !!r.cont])).toEqual([
      ['add', 'abcd', 3, false],
      ['add', 'efgh', null, true],
      ['add', 'ij', null, true],
      ['ctx', '中文', 4, false],
      ['ctx', '中文', null, true],
      ['ctx', '中', null, true],
    ]);
  });

  it('keeps empty lines and expands tabs', () => {
    const rows = diffRows(
      [
        { type: 'add', text: '', no: 1 },
        { type: 'add', text: '\tx', no: 2 },
      ],
      10,
    );
    expect(rows.map((r) => r.text)).toEqual(['', '  x']);
  });
});
