import { describe, it, expect } from 'vitest';
import { applyEvents, sweep } from '../src/engine/reducer.js';
import { dayOf, localDay, newState, normalizeState, pendingCards, type State } from '../src/engine/state.js';
import { applyVerdict, ECON } from '../src/engine/economy.js';
import {
  ACHIEVEMENTS,
  lastWeekRecap,
  levelInfo,
  levelTitle,
  questProgress,
  questsFor,
  recapDue,
  settleProgress,
  streak,
  track,
  unlock,
  weekKey,
  xpForLevel,
} from '../src/engine/progress.js';
import type { IEvent } from '../src/events.js';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const edit = (t: number, file: string, sid = 's'): IEvent => ({ t, k: 'tool', sid, cwd: '/p', tool: 'Edit', edit: { file, kind: 'edit', hunks: [{ old: 'a', new: 'b' }] } });

describe('levels', () => {
  it('needs a little more XP for every level', () => {
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelInfo(99).level).toBe(1);
    expect(levelInfo(100)).toEqual({ level: 2, into: 0, need: 140 });
    expect(xpForLevel(10)).toBe(460);
    expect(levelTitle(1).en).toBe('Intern');
    expect(levelTitle(12).en).toBe('Senior Engineer');
  });

  it('counts XP only for useful work', () => {
    const s = newState();
    track(s, 'reviewed');
    track(s, 'skimmed');
    track(s, 'skipped');
    track(s, 'learned', Date.now(), 2);
    expect(s.xp).toBe(10 + 6);
  });

  it('pays the daily puzzle once, plus only the improvement on a replay', () => {
    const s = newState();
    const now = at(2026, 11, 2);
    track(s, 'puzzle', now, 2);
    expect(s.xp).toBe(20 + 10);
    track(s, 'puzzle', now, 1);
    expect(s.xp).toBe(30);
    track(s, 'puzzle', now, 3);
    expect(s.xp).toBe(35);
    expect(s.days[localDay(now)].puzzle).toBe(3);
  });
});

describe('streak', () => {
  it('counts consecutive useful days and survives until the end of today', () => {
    const s = newState();
    track(s, 'reviewed', at(2026, 11, 1));
    track(s, 'learned', at(2026, 11, 2), 5);
    expect(streak(s, at(2026, 11, 2, 20))).toEqual({ days: 2, today: true });
    // Next morning, nothing done yet: still 2, but today is open.
    expect(streak(s, at(2026, 11, 3, 8))).toEqual({ days: 2, today: false });
    // A day missed breaks it.
    expect(streak(s, at(2026, 11, 4, 8))).toEqual({ days: 0, today: false });
  });

  it('does not count a day of only playing or skimming', () => {
    const s = newState();
    track(s, 'floor', at(2026, 11, 1));
    track(s, 'skimmed', at(2026, 11, 1));
    track(s, 'learned', at(2026, 11, 1), 4);
    expect(streak(s, at(2026, 11, 1)).days).toBe(0);
  });

  it('crosses month boundaries', () => {
    const s = newState();
    track(s, 'reviewed', at(2026, 10, 31));
    track(s, 'reviewed', at(2026, 11, 1));
    expect(streak(s, at(2026, 11, 1)).days).toBe(2);
  });
});

describe('daily quests', () => {
  it('always offers one review, one learning and one play quest', () => {
    for (const day of ['2026-11-01', '2026-11-02', '2026-12-25', '2027-02-28']) {
      const ids = questsFor(day).map((q) => q.id);
      expect(ids).toHaveLength(3);
      expect(['review3', 'review8', 'fullturn']).toContain(ids[0]);
      expect(['learn5', 'learn10']).toContain(ids[1]);
      expect(['puzzle', 'sprint', 'floors']).toContain(ids[2]);
    }
  });

  it('rewards a quest once, when it is reached', () => {
    const s = newState();
    s.level = 1;
    const now = at(2026, 11, 2);
    const learn = questsFor(localDay(now))[1];
    track(s, 'learned', now, learn.goal - 1);
    expect(settleProgress(s, now).filter((e) => e.type === 'quest')).toEqual([]);
    const energy = s.energy;
    track(s, 'learned', now, 1);
    const evs = settleProgress(s, now);
    expect(evs).toContainEqual({ type: 'quest', id: learn.id, label: learn.label });
    expect(s.energy).toBe(energy + 2);
    expect(settleProgress(s, now).filter((e) => e.type === 'quest')).toEqual([]);
    expect(questProgress(s, now)[1]).toMatchObject({ done: true, value: learn.goal });
  });

  it('starts fresh the next day', () => {
    const s = newState();
    s.quests = { day: '2026-11-01', done: ['learn5'] };
    settleProgress(s, at(2026, 11, 2));
    expect(s.quests).toEqual({ day: '2026-11-02', done: [] });
  });
});

describe('achievements', () => {
  it('announces new ones with a little energy, but grants old ones quietly on the first run', () => {
    const s = normalizeState({ ...newState(), totals: { ...newState().totals, reviewed: 60, cards: 70 }, xp: undefined as any, level: undefined as any });
    expect(s.xp).toBe(600); // earlier honest work is not forgotten
    const energy = s.energy;
    expect(settleProgress(s)).toEqual([]);
    expect(Object.keys(s.achievements)).toEqual(expect.arrayContaining(['first_review', 'review_50', 'coverage_80']));
    expect(s.energy).toBe(energy + 3 * Object.keys(s.achievements).length);
    s.totals.delivered = 1;
    expect(settleProgress(s)).toContainEqual({ type: 'achievement', id: 'first_note', name: expect.anything() });
  });

  it('game-granted achievements unlock once', () => {
    const s = newState();
    expect(unlock(s, 'dungeon_bare')).toBe(true);
    expect(unlock(s, 'dungeon_bare')).toBe(false);
    expect(unlock(s, 'no_such_thing')).toBe(false);
  });

  it('has unique ids and bilingual names', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) expect(a.name.zh && a.name.en && a.desc.zh && a.desc.en).toBeTruthy();
  });

  it('announces a level-up', () => {
    const s = newState();
    s.level = 1;
    track(s, 'win');
    track(s, 'win');
    const evs = settleProgress(s);
    expect(evs).toContainEqual({ type: 'level', level: 2, title: expect.anything() });
    expect(settleProgress(s).some((e) => e.type === 'level')).toBe(false);
  });
});

describe('weekly recap', () => {
  it('sums last Monday to Sunday and is due once a week', () => {
    const s = newState();
    const now = at(2026, 11, 4); // a Wednesday
    expect(weekKey(now)).toBe('2026-11-02');
    const d = dayOf(s, at(2026, 10, 28));
    Object.assign(d, { turns: 4, files: 10, reviewed: 7, flagged: 1, learned: 6 });
    dayOf(s, at(2026, 11, 2)).turns = 9; // this week: not in last week's recap
    const r = lastWeekRecap(s, now);
    expect(r).toMatchObject({ week: '2026-10-26', turns: 4, files: 10, read: 8, activeDays: 1, coverage: 0.8 });
    expect(recapDue(s, now)).not.toBeNull();
    s.lastRecap = weekKey(now);
    expect(recapDue(s, now)).toBeNull();
  });

  it('skips an empty week', () => {
    expect(recapDue(newState(), at(2026, 11, 4))).toBeNull();
  });
});

describe('turns and the queue', () => {
  it('archives changes left unreviewed for a day, honestly as skipped', () => {
    const s = newState();
    applyEvents(s, [edit(1_000, '/p/a.ts'), edit(2_000, '/p/b.ts')]);
    sweep(s, 1_000 + ECON.expireMs - 1);
    expect(pendingCards(s)).toHaveLength(2);
    expect(sweep(s, 2_000 + ECON.expireMs)).toBe(true);
    expect(pendingCards(s)).toHaveLength(0);
    expect(s.totals).toMatchObject({ expired: 2, skipped: 2, reviewed: 0 });
  });

  it('records each turn with its title, files, end and test result', () => {
    const s = newState();
    applyEvents(s, [
      { t: 10, k: 'prompt', sid: 's', cwd: '/p', p: 'Add retries' },
      edit(11, '/p/a.ts'),
      edit(12, '/p/b.ts'),
      { t: 13, k: 'tool', sid: 's', cwd: '/p', tool: 'Bash', bash: { cmd: 'npm test', test: true, result: 'pass' } },
      { t: 20, k: 'stop', sid: 's', cwd: '/p' },
    ]);
    expect(s.turns).toEqual([{ key: 's@10', sid: 's', cwd: '/p', start: 10, end: 20, title: 'Add retries', files: 2, pass: true, fail: undefined }]);
    expect(dayOf(s, 20)).toMatchObject({ turns: 1, files: 2 });
  });

  it('rewards a fully read turn once, even if Claude edits it again later', () => {
    const s = newState();
    applyEvents(s, [{ t: 10, k: 'prompt', sid: 's', cwd: '/p' }, edit(11, '/p/a.ts')]);
    applyVerdict(s, s.review[0].id, 'ok');
    applyEvents(s, [edit(12, '/p/b.ts')]);
    applyVerdict(s, s.review[1].id, 'ok');
    expect(Object.values(s.days).reduce((n, d) => n + d.fullTurns, 0)).toBe(1);
  });

  it('a skimmed file means the turn was not read in full', () => {
    const s = newState();
    applyEvents(s, [{ t: 10, k: 'prompt', sid: 's', cwd: '/p' }, edit(11, '/p/a.ts'), edit(12, '/p/b.ts')]);
    applyVerdict(s, s.review[0].id, 'ok', { quick: true });
    applyVerdict(s, s.review[1].id, 'ok');
    expect(Object.values(s.days).reduce((n, d) => n + d.fullTurns, 0)).toBe(0);
  });

  it('groups cards saved by an older version into turns by session and quiet gaps', () => {
    const old: Partial<State> = {
      ...newState(),
      turns: undefined as any,
      review: [
        { id: '1', t: 1_000, sid: 'a', cwd: '/p', file: '/p/x.ts', kind: 'edit', status: 'new' },
        { id: '2', t: 2_000, sid: 'a', cwd: '/p', file: '/p/y.ts', kind: 'edit', status: 'new' },
        { id: '3', t: 2_000 + 11 * 60_000, sid: 'a', cwd: '/p', file: '/p/z.ts', kind: 'edit', status: 'ok' },
        { id: '4', t: 3_000, sid: 'b', cwd: '/q', file: '/q/w.ts', kind: 'edit', status: 'new' },
      ],
    };
    const s = normalizeState(old);
    expect(s.review.map((c) => c.turn)).toEqual(['a@1000', 'a@1000', 'a@662000', 'b@3000']);
    expect(s.turns.map((m) => [m.key, m.files])).toEqual([
      ['a@1000', 2],
      ['b@3000', 1],
      ['a@662000', 1],
    ]);
  });
});
