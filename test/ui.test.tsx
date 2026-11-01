import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { App } from '../src/ui/App.js';
import { localDay, newState, type State } from '../src/engine/state.js';
import { loadState } from '../src/engine/store.js';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';
import { pendingNotes } from '../src/feedback.js';
import { weekKey } from '../src/engine/progress.js';
import { solve, type PuzzleRun } from '../src/game/stack.js';
import { tempDir, tempHome } from './helpers.js';
import { renderSized, widest } from './render.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let home: string;
const emit = (ev: object) => fs.appendFileSync(path.join(home, 'events.jsonl'), JSON.stringify(ev) + '\n');
const cfgEn = { ...DEFAULT_CONFIG, bell: false, lang: 'en' as const };
const editEv = (t: number, file: string, old: string, next: string, cwd = '/proj', sid = 's') => ({
  t,
  k: 'tool',
  sid,
  cwd,
  tool: 'Edit',
  edit: { file, kind: 'edit', hunks: [{ old, new: next }] },
});
/** Someone who has used the panel before: no welcome screen. */
const ready = (): State => ({ ...newState(), onboarded: true });
const typeKeys = async (app: { stdin: { write: (s: string) => void } }, keys: string, gap = 15) => {
  for (const k of keys) {
    app.stdin.write(k);
    await sleep(gap);
  }
};
/** Wait (up to 3 s) until `check` holds: slow CI machines need longer than a fixed sleep. */
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await sleep(15);
};
type Term = { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined };
/**
 * Press a key that changes the screen, then wait for the new screen. A key sent before React has
 * mounted the next tab would reach the old one, so tests must not race ahead of the render.
 */
const press = async (app: Term, key: string, shows: string) => {
  app.stdin.write(key);
  await until(() => (app.lastFrame() ?? '').includes(shows));
  expect(app.lastFrame()).toContain(shows);
};

beforeEach(() => {
  home = tempHome();
});

describe('panel', () => {
  it('walks through review → alert → play → learn → me', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(80);
    expect(app.lastFrame()).toContain('Waiting for Claude');

    // Claude starts a turn and edits two files.
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj', p: 'Fix the null check' });
    emit(editEv(t + 1, '/proj/src/a.ts', 'const x = 1;', 'const x = 2;'));
    emit(editEv(t + 2, '/proj/src/b.ts', 'return a;', 'return a ?? null;'));
    await sleep(120);
    let f = app.lastFrame()!;
    expect(f).toContain('Claude is working');
    expect(f).toContain('Fix the null check');
    expect(f).toContain('src/a.ts');
    expect(f).toContain('+ const x = 2;');
    expect(f).toContain('- const x = 1;');
    expect(f).toContain('Review 2');
    expect(f).toContain('● a.ts');
    expect(f).toContain('● b.ts');

    // Approve the first file after actually reading it.
    await sleep(800);
    app.stdin.write('y');
    await sleep(60);
    f = app.lastFrame()!;
    expect(f).toContain('✓ +1⚡');
    expect(f).toContain('✓ a.ts');
    expect(f).toContain('src/b.ts');
    expect(loadState().totals.reviewed).toBe(1);
    // The first real review unlocks an achievement, announced after the feedback.
    expect(loadState().achievements.first_review).toBeGreaterThan(0);

    // Flag the second one with a note for Claude.
    app.stdin.write('n');
    await sleep(40);
    app.stdin.write('please keep undefined');
    await sleep(40);
    expect(app.lastFrame()).toContain('please keep undefined');
    app.stdin.write('\r');
    await sleep(60);
    expect(pendingNotes().map((n) => [n.text, n.file, n.cwd])).toEqual([['please keep undefined', 'src/b.ts', '/proj']]);
    expect(app.lastFrame()).toContain('Claude sees it on its very next step');
    expect(loadState().totals.flagged).toBe(1);

    // Claude finishes → alert with what the turn did.
    emit({ t: t + 5000, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(120);
    f = app.lastFrame()!;
    expect(f).toContain('Claude finished');
    expect(f).toContain('2 files changed');
    expect(f).toContain('+3💰');
    app.stdin.write('x'); // any key dismisses
    await sleep(40);
    expect(app.lastFrame()).not.toContain('Claude finished');
    expect(app.lastFrame()).toContain('All caught up');

    // Play: the game list, then a Debug Dungeon run.
    app.stdin.write('\t');
    await sleep(60);
    expect(app.lastFrame()).toContain('Stack Puzzle');
    app.stdin.write('1');
    await sleep(60);
    expect(app.lastFrame()).toContain('Debug Dungeon');
    const before = loadState().energy;
    app.stdin.write('n');
    await sleep(60);
    f = app.lastFrame()!;
    expect(f).toContain('Floor 1/6');
    expect(f).toContain('Hand');
    expect(loadState().energy).toBe(before - 3);
    const focus = loadState().game!.battle!.focus;
    app.stdin.write('1');
    await sleep(40);
    expect(loadState().game!.battle!.focus).toBeLessThan(focus);
    app.stdin.write('e');
    await sleep(40);
    expect(loadState().game!.battle!.turn).toBe(2);
    app.stdin.write('\x1b'); // back to the list; the run is kept
    await sleep(60);
    expect(app.lastFrame()).toContain('Floor 1/6');
    expect(loadState().game).not.toBeNull();

    // Learn: flip a card, think about it, rate it.
    app.stdin.write('\t');
    await sleep(60);
    expect(app.lastFrame()).toContain('Q:');
    app.stdin.write(' ');
    await sleep(1500);
    expect(app.lastFrame()).toContain('A:');
    app.stdin.write('2');
    await sleep(60);
    expect(loadState().totals.learned).toBe(1);

    // Me: level, streak, quests.
    app.stdin.write('\t');
    await sleep(60);
    f = app.lastFrame()!;
    expect(f).toContain('Lv.');
    expect(f).toContain('streak');
    expect(f).toContain("Today's quests");

    // Help overlay and auto toggle.
    app.stdin.write('?');
    await sleep(40);
    expect(app.lastFrame()).toContain('Two currencies');
    app.stdin.write('x');
    await sleep(40);
    expect(app.lastFrame()).toContain('auto Tab');
    app.stdin.write('a');
    await sleep(40);
    expect(app.lastFrame()).not.toContain('auto Tab');
    app.unmount();
  });

  it('never drops keystrokes when typing fast (no re-render between keys)', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    emit(editEv(Date.now(), '/p/x.ts', 'a', 'b', '/p'));
    await sleep(120);
    app.stdin.write('\t'); // leave review…
    await sleep(40);
    app.stdin.write('\t');
    app.stdin.write('\t');
    app.stdin.write('\t'); // …and come back
    await sleep(60);
    app.stdin.write('n');
    await sleep(30);
    for (const ch of 'returning 201 breaks 前端') app.stdin.write(ch);
    app.stdin.write('\r');
    await sleep(60);
    expect(pendingNotes().map((n) => n.text)).toEqual(['returning 201 breaks 前端']);
    app.unmount();
  });

  it('an alert popping up while typing a note does not swallow keys', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={20} />);
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/p' });
    emit(editEv(t + 1, '/p/x.ts', 'a', 'b', '/p'));
    await sleep(100);
    app.stdin.write('n');
    await sleep(30);
    app.stdin.write('ke');
    emit({ t: t + 9000, k: 'stop', sid: 's', cwd: '/p' }); // Claude finishes mid-sentence
    await sleep(100);
    expect(app.lastFrame()).toContain('Claude finished');
    for (const ch of 'ep 200') app.stdin.write(ch);
    app.stdin.write('\r');
    await sleep(60);
    expect(pendingNotes().map((n) => n.text)).toEqual(['keep 200']);
    // Once the note is sent, the next key dismisses the alert as usual.
    app.stdin.write('x');
    await sleep(40);
    expect(app.lastFrame()).not.toContain('Claude finished');
    app.unmount();
  });

  it('shows the daily bonus without blocking, and flags a session that needs approval', async () => {
    const cfg = { ...DEFAULT_CONFIG, bell: false, lang: 'zh' as const };
    const app = render(<App cfg={cfg} lang="zh" initial={ready()} daily={5} pollMs={30} />);
    await sleep(60);
    expect(app.lastFrame()).toContain('今天第一次打开 +5⚡');
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/p' });
    emit({ t: t + 1, k: 'notify', sid: 's', cwd: '/p', msg: 'Claude needs your permission to use Bash' });
    await sleep(120);
    expect(app.lastFrame()).toContain('Claude 在等你确认');
    app.unmount();
  });
});

describe('first run', () => {
  it('welcomes a new user and hooks up the project with one key', async () => {
    const proj = tempDir('proj-');
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} setupHint cwd={proj} />);
    await sleep(60);
    let f = app.lastFrame()!;
    expect(f).toContain('Welcome to Cowait');
    expect(f).toContain('Hook up this project only');
    // L switches the language right there.
    app.stdin.write('L');
    await sleep(60);
    expect(app.lastFrame()).toContain('欢迎使用 Cowait');
    app.stdin.write('L');
    await sleep(60);
    app.stdin.write('\r');
    await sleep(80);
    const settings = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8'));
    expect(Object.keys(settings.hooks)).toContain('PostToolUse');
    expect(loadState().onboarded).toBe(true);
    f = app.lastFrame()!;
    expect(f).not.toContain('Welcome to Cowait');
    expect(f).toContain('restart Claude Code');
    app.unmount();
  });

  it('Esc on the welcome screen changes nothing on disk but never shows it again', async () => {
    const proj = tempDir('proj-');
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} setupHint cwd={proj} />);
    await sleep(60);
    app.stdin.write('\x1b');
    await sleep(80);
    expect(fs.existsSync(path.join(proj, '.claude'))).toBe(false);
    expect(loadState().onboarded).toBe(true);
    // Still not hooked up: the review tab explains how, and i does it.
    expect(app.lastFrame()).toContain('cowait install --project');
    app.stdin.write('i');
    await sleep(60);
    expect(fs.existsSync(path.join(proj, '.claude', 'settings.local.json'))).toBe(true);
    app.unmount();
  });

  it('tells a new user how to hook Cowait up until the first event arrives', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} setupHint />);
    await sleep(60);
    expect(app.lastFrame()).toContain('cowait install --project');
    emit({ t: Date.now(), k: 'prompt', sid: 's', cwd: '/proj' });
    await sleep(120);
    expect(app.lastFrame()).not.toContain('cowait install --project');
    app.unmount();
  });

  it("shows last week's recap once, on the first open of a week", async () => {
    const s = ready();
    const lastMonday = new Date(weekKey(Date.now()) + 'T12:00:00');
    lastMonday.setDate(lastMonday.getDate() - 7);
    s.days[localDay(lastMonday.getTime())] = { ...emptyDayFor(), turns: 6, files: 10, reviewed: 8, flagged: 1, xp: 120 };
    const app = render(<App cfg={cfgEn} lang="en" initial={s} daily={0} pollMs={30} />);
    await sleep(60);
    const f = app.lastFrame()!;
    expect(f).toContain('Last week');
    expect(f).toContain('Claude worked 6 turns and changed 10 files');
    expect(f).toContain('You actually read 9 of them (90%)');
    app.stdin.write('x');
    await sleep(60);
    expect(app.lastFrame()).not.toContain('Last week');
    expect(loadState().lastRecap).toBe(weekKey(Date.now()));
    app.unmount();
  });
});

function emptyDayFor() {
  return { turns: 0, files: 0, reviewed: 0, flagged: 0, skimmed: 0, skipped: 0, notes: 0, learned: 0, puzzle: 0, practice: 0, sprints: 0, floors: 0, wins: 0, fullTurns: 0, xp: 0 };
}

describe('notes to Claude', () => {
  it('m sends a free-form note to the project Claude is working in, and confirms delivery', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj' });
    emit(editEv(t + 1, '/proj/a.ts', 'a', 'b'));
    await sleep(120);

    app.stdin.write('m');
    await sleep(40);
    expect(app.lastFrame()).toContain('Note to Claude');
    // Keys belong to the note now: "y" must not approve the card underneath.
    for (const ch of 'yes, use pnpm') app.stdin.write(ch);
    app.stdin.write('\r');
    await sleep(60);
    const [note] = pendingNotes();
    expect(note).toMatchObject({ text: 'yes, use pnpm', cwd: '/proj' });
    expect(note.file).toBeUndefined();
    expect(loadState().review[0].status).toBe('new');
    expect(app.lastFrame()).toContain('✎1');

    emit({ t: t + 2, k: 'delivered', sid: 's', ids: [note.id] });
    await sleep(100);
    expect(app.lastFrame()).toContain('Claude got your note');
    expect(app.lastFrame()).not.toContain('✎1');
    app.unmount();
  });

  it('Esc closes the note box without sending anything', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(60);
    app.stdin.write('m');
    await sleep(40);
    app.stdin.write('never mind');
    await sleep(30);
    app.stdin.write('\x1b');
    await sleep(80);
    expect(pendingNotes()).toEqual([]);
    expect(app.lastFrame()).not.toContain('Note to Claude');
    app.unmount();
  });
});

describe('reviewing', () => {
  it('folds edits to one file in a turn into one entry, and a too-quick approval earns nothing', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj' });
    emit(editEv(t + 1, '/proj/a.ts', 'one', 'ONE'));
    emit(editEv(t + 2, '/proj/a.ts', 'two', 'TWO'));
    emit(editEv(t + 3, '/proj/b.ts', 'x', 'y'));
    await sleep(120);
    let f = app.lastFrame()!;
    expect(f).toContain('Review 2');
    expect(f).toContain('2 edits');
    expect(f).toContain('+ ONE');
    expect(f).toContain('+ TWO');

    app.stdin.write('y'); // a fraction of a second after it appeared
    await sleep(60);
    expect(app.lastFrame()).toContain('not read yet');
    expect(loadState().energy).toBe(10);
    expect(loadState().totals).toMatchObject({ reviewed: 0, skimmed: 1 });

    // The finished-turn alert says what is still waiting, and Enter goes there.
    emit({ t: t + 9000, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(120);
    f = app.lastFrame()!;
    expect(f).toContain('2 files changed');
    expect(f).toContain('1 to review');
    expect(f).toContain('Enter review');
    app.unmount();
  });

  it('Y approves a whole turn, counting only the files you actually read', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj', p: 'Three files' });
    emit(editEv(t + 1, '/proj/a.ts', 'a', 'b'));
    emit(editEv(t + 2, '/proj/b.ts', 'a', 'b'));
    emit(editEv(t + 3, '/proj/c.ts', 'a', 'b'));
    await sleep(900); // a.ts is on screen and gets read
    app.stdin.write('Y');
    await sleep(60);
    expect(app.lastFrame()).toContain('1 read +1⚡, 2 unread');
    expect(loadState().totals).toMatchObject({ reviewed: 1, skimmed: 2 });
    expect(app.lastFrame()).toContain('All caught up');
    app.unmount();
  });

  it('a whole turn read file by file counts as a full turn', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj' });
    emit(editEv(t + 1, '/proj/a.ts', 'a', 'b'));
    emit(editEv(t + 2, '/proj/b.ts', 'a', 'b'));
    await sleep(900);
    app.stdin.write('y');
    await sleep(900);
    app.stdin.write('y');
    await sleep(60);
    expect(loadState().days[localDay(Date.now())].fullTurns).toBe(1);
    expect(loadState().achievements.full_turn).toBeGreaterThan(0);
    app.unmount();
  });

  it('Enter on the "finished" alert opens that turn', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj', p: 'First turn' });
    emit(editEv(t + 1, '/proj/old.ts', 'a', 'b'));
    emit({ t: t + 2, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(100);
    app.stdin.write('x');
    emit({ t: t + 3, k: 'prompt', sid: 's', cwd: '/proj', p: 'Second turn' });
    emit(editEv(t + 4, '/proj/new.ts', 'a', 'b'));
    await sleep(100);
    app.stdin.write('l'); // look at the older turn meanwhile
    await sleep(40);
    expect(app.lastFrame()).toContain('First turn');
    emit({ t: Date.now(), k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(100);
    app.stdin.write('\r');
    await sleep(60);
    const f = app.lastFrame()!;
    expect(f).toContain('Second turn');
    expect(f).toContain('new.ts');
    app.unmount();
  });

  it('S twice skips the whole backlog (honestly, as skipped), once does not', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    const t = Date.now();
    emit(editEv(t, '/proj/a.ts', 'a', 'b'));
    emit(editEv(t + 1, '/proj/b.ts', 'a', 'b'));
    await sleep(120);
    app.stdin.write('S');
    await sleep(60);
    expect(app.lastFrame()).toContain('S again');
    expect(loadState().totals.skipped).toBe(0);
    app.stdin.write('S');
    await sleep(60);
    expect(loadState().totals).toMatchObject({ skipped: 2, reviewed: 0 });
    expect(app.lastFrame()).toContain('All caught up');
    app.unmount();
  });

  it('time spent reading a change still counts after a look at the help screen', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    emit(editEv(Date.now(), '/proj/a.ts', 'a', 'b'));
    await sleep(1000); // read it
    app.stdin.write('?');
    await sleep(40);
    app.stdin.write('x'); // close help
    await sleep(40);
    app.stdin.write('y');
    await sleep(60);
    expect(app.lastFrame()).toContain('✓ +1⚡');
    expect(loadState().totals).toMatchObject({ reviewed: 1, skimmed: 0 });
    app.unmount();
  });

  it('a flashcard rated in a blink earns nothing', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(60);
    app.stdin.write('\t');
    app.stdin.write('\t'); // review → play → learn
    await sleep(60);
    expect(app.lastFrame()).toContain('Q:');
    app.stdin.write(' ');
    app.stdin.write('2');
    await sleep(60);
    expect(app.lastFrame()).toContain('too quick');
    expect(loadState().energy).toBe(10);
    expect(loadState().totals.learned).toBe(0);
    app.unmount();
  });
});

describe('games', () => {
  it("solves today's Stack Puzzle and offers a spoiler-free share line", async () => {
    const app = render(<App cfg={{ ...cfgEn, autoMode: false }} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(60);
    await press(app, '\t', 'Stack Puzzle');
    await press(app, '2', "Enter start today's puzzle");
    await press(app, '\r', 'Goal');
    const run = loadState().puzzle as PuzzleRun;
    const path0 = solve(run.puzzle.start, run.puzzle.target, run.puzzle.buttons)!;
    expect(path0).toHaveLength(run.puzzle.par);
    await typeKeys(app, path0.map((i) => String(i + 1)).join(''), 40);
    await until(() => (app.lastFrame() ?? '').includes('Solved!'));
    const f = app.lastFrame()!;
    expect(f).toContain('Solved!');
    expect(f).toContain('★★★');
    expect(f).toMatch(/Share: Cowait Stack Puzzle #\d+ ★★★/);
    expect(loadState().days[localDay(Date.now())].puzzle).toBe(3);
    expect(loadState().achievements.puzzle_perfect).toBeGreaterThan(0);
    app.unmount();
  });

  it('a Code Sprint round owns the keyboard until it is done', async () => {
    const app = render(<App cfg={{ ...cfgEn, autoMode: false }} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(60);
    await press(app, '\t', 'Stack Puzzle');
    await press(app, '3', 'Enter start a round');
    app.stdin.write('\r');
    await until(() => !!loadState().sprint);
    const lines: string[] = loadState().sprint.lines;
    expect(lines).toHaveLength(5);
    expect(loadState().energy).toBe(9);
    // Tab, q and ? are just keys while typing.
    app.stdin.write('q');
    await sleep(30);
    app.stdin.write('\b');
    await sleep(30);
    for (const line of lines) {
      for (const ch of line) app.stdin.write(ch);
      await sleep(40);
    }
    await until(() => loadState().totals.sprints === 1);
    const f = app.lastFrame()!;
    expect(f).toContain('WPM');
    expect(loadState().totals.sprints).toBe(1);
    expect(loadState().sprint).toBeNull();
    app.unmount();
  });
});

describe('settings', () => {
  it('toggles a setting in the Me tab and saves it', async () => {
    const app = render(<App cfg={{ ...cfgEn, autoMode: false }} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(60);
    await press(app, '\t', 'Stack Puzzle');
    await press(app, '\t', 'Q:');
    await press(app, '\t', "Today's quests");
    await press(app, 's', 'Settings');
    app.stdin.write('\u001B[B'); // ↓ to the bell
    await sleep(30);
    app.stdin.write('\r');
    await until(() => loadConfig().bell);
    expect(loadConfig().bell).toBe(true);
    app.unmount();
  });
});

describe('auto mode and restarts', () => {
  it('a new Claude turn does not pull you out of a fight', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(60);
    await press(app, '\t', 'Stack Puzzle');
    await press(app, '1', 'gear shop');
    await press(app, 'n', 'Hand');
    emit({ t: Date.now(), k: 'prompt', sid: 's', cwd: '/proj' });
    await sleep(120);
    expect(app.lastFrame()).toContain('Hand');
    app.unmount();
  });

  it('catching up on old events after a restart does not ring or pop stale alerts', async () => {
    const t = Date.now();
    emit({ t: t - 120_000, k: 'prompt', sid: 's', cwd: '/proj' });
    emit({ t: t - 60_000, k: 'stop', sid: 's', cwd: '/proj' });
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    await sleep(120);
    expect(app.lastFrame()).not.toContain('Claude finished');
    emit({ t: Date.now(), k: 'prompt', sid: 's', cwd: '/proj' });
    emit({ t: Date.now() + 1, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(120);
    expect(app.lastFrame()).toContain('Claude finished');
    app.unmount();
  });

  it('keeps what it folded from the log when the panel closes', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={ready()} daily={0} pollMs={30} />);
    emit(editEv(Date.now(), '/proj/a.ts', 'a', 'b'));
    await sleep(100);
    app.unmount();
    await sleep(20);
    expect(loadState().review.map((c) => c.file)).toEqual(['/proj/a.ts']);
  });
});

describe('narrow side panel (60 columns)', () => {
  for (const lang of ['en', 'zh'] as const) {
    it(`never draws past the edge (${lang}), and wraps long code lines instead of cutting them`, async () => {
      const cfg = { ...cfgEn, lang, autoMode: false };
      const app = renderSized(<App cfg={cfg} lang={lang} initial={newState()} daily={0} pollMs={30} setupHint cwd="/home/dev/shop-api" />, 60, 26);
      const screens: [string, string][] = [];
      const snap = async (name: string, keys = '', wait = 60) => {
        for (const k of keys) {
          app.stdin.write(k);
          await sleep(10);
        }
        await sleep(wait);
        screens.push([name, app.lastFrame()]);
      };
      await snap('welcome');
      await snap('welcome closed', '\x1b');
      const t = Date.now();
      const long = `const message = ${'"x" + '.repeat(16)}"TAIL_END";`;
      emit({ t, k: 'prompt', sid: 's', cwd: '/home/dev/shop-api', p: 'A rather long request that goes on and on about what to change in the orders route' });
      emit(editEv(t + 1, '/home/dev/shop-api/src/routes/orders.ts', 'const message = "";', long, '/home/dev/shop-api'));
      emit(editEv(t + 2, '/home/dev/shop-api/src/routes/very-long-file-name-for-testing.ts', 'a', 'b', '/home/dev/shop-api'));
      emit({ t: t + 3, k: 'prompt', sid: 's2', cwd: '/home/dev/web' });
      emit(editEv(t + 4, '/home/dev/web/src/App.tsx', 'a', 'b', '/home/dev/web', 's2'));
      await sleep(150);
      await snap('review');
      await snap('older turn', 'l');
      expect(screens.map(([, f]) => f).join('\n')).toContain('TAIL_END');
      await snap('typing a note', 'n');
      await snap('typing a note (text)', 'this should stay inside the panel');
      await snap('note cancelled', '\x1b');
      await snap('help', '?');
      await snap('help closed', 'x');
      await snap('free note', 'm');
      await snap('free note closed', '\x1b');
      await snap('game list', '\t');
      await snap('dungeon', '1');
      await snap('shop', 's');
      await snap('battle', 'bn');
      await snap('puzzle', '\x1b2\r');
      await snap('sprint', '\x1b3\r');
      await snap('sprint typed', 'abc');
      await snap('learn', '\x1b\x1b\t');
      await snap('learn flipped', ' ');
      await snap('me', '\t');
      await snap('settings', 's');
      await snap('achievements', '\x1bc');
      await snap('me again', '\x1b');
      emit({ t: t + 9000, k: 'stop', sid: 's', cwd: '/home/dev/shop-api' });
      await snap('alert', '', 150);
      for (const [name, frame] of screens) expect(widest(frame), `${name}:\n${frame}`).toBeLessThanOrEqual(60);
      app.unmount();
    });
  }
});
