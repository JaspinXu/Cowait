import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { App } from '../src/ui/App.js';
import { newState } from '../src/engine/state.js';
import { loadState } from '../src/engine/store.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { pendingNotes } from '../src/feedback.js';
import { tempHome } from './helpers.js';
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

beforeEach(() => {
  home = tempHome();
});

describe('panel', () => {
  it('walks through review → alert → game → learn', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
    await sleep(80);
    expect(app.lastFrame()).toContain('Waiting for Claude');

    // Claude starts a turn and edits two files.
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj' });
    emit(editEv(t + 1, '/proj/src/a.ts', 'const x = 1;', 'const x = 2;'));
    emit(editEv(t + 2, '/proj/src/b.ts', 'return a;', 'return a ?? null;'));
    await sleep(120);
    let f = app.lastFrame()!;
    expect(f).toContain('Claude is working');
    expect(f).toContain('src/a.ts');
    expect(f).toContain('+ const x = 2;');
    expect(f).toContain('- const x = 1;');
    expect(f).toContain('Review 2');

    // Approve the first card after actually reading it.
    await sleep(800);
    app.stdin.write('y');
    await sleep(60);
    f = app.lastFrame()!;
    expect(f).toContain('✓ +1⚡');
    expect(f).toContain('⚡11');
    expect(f).toContain('src/b.ts');

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
    expect(loadState().energy).toBe(13);

    // Claude finishes → alert with what the turn did.
    emit({ t: t + 5000, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(120);
    f = app.lastFrame()!;
    expect(f).toContain('Claude finished');
    expect(f).toContain('2 edits');
    expect(f).toContain('+3💰');
    app.stdin.write('x'); // any key dismisses
    await sleep(40);
    expect(app.lastFrame()).not.toContain('Claude finished');

    // Game: start a run (costs 3⚡) and play a card.
    app.stdin.write('\t');
    await sleep(40);
    expect(app.lastFrame()).toContain('Debug Dungeon');
    app.stdin.write('n');
    await sleep(60);
    f = app.lastFrame()!;
    expect(f).toContain('Floor 1/6');
    expect(f).toContain('Hand');
    expect(loadState().energy).toBe(10);
    const before = loadState().game!.battle!.focus;
    app.stdin.write('1');
    await sleep(40);
    expect(loadState().game!.battle!.focus).toBeLessThan(before);
    app.stdin.write('e');
    await sleep(40);
    expect(loadState().game!.battle!.turn).toBe(2);

    // Learn: flip a card, think about it, rate it.
    app.stdin.write('\t');
    await sleep(60);
    f = app.lastFrame()!;
    expect(f).toContain('Learn');
    expect(f).toContain('Q:');
    app.stdin.write(' ');
    await sleep(1500);
    expect(app.lastFrame()).toContain('A:');
    app.stdin.write('2');
    await sleep(60);
    expect(loadState().totals.learned).toBe(1);
    expect(loadState().energy).toBe(11);

    // Help overlay and auto toggle.
    app.stdin.write('?');
    await sleep(40);
    expect(app.lastFrame()).toContain('Two currencies');
    app.stdin.write('x');
    await sleep(40);
    app.stdin.write('a');
    await sleep(40);
    expect(app.lastFrame()).toContain('auto ✗');
    app.unmount();
  });

  it('never drops keystrokes when typing fast (no re-render between keys)', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
    emit(editEv(Date.now(), '/p/x.ts', 'a', 'b', '/p'));
    await sleep(120);
    app.stdin.write('\t'); // leave review…
    await sleep(40);
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
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={20} />);
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
    const app = render(<App cfg={cfg} lang="zh" initial={newState()} daily={5} pollMs={30} />);
    await sleep(60);
    expect(app.lastFrame()).toContain('今日首次打开 +5⚡');
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/p' });
    emit({ t: t + 1, k: 'notify', sid: 's', cwd: '/p', msg: 'Claude needs your permission to use Bash' });
    await sleep(120);
    expect(app.lastFrame()).toContain('Claude 在等你确认');
    app.unmount();
  });
});

describe('notes to Claude', () => {
  it('m sends a free-form note to the project Claude is working in, and confirms delivery', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
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
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
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
  it('merges edits to one file into one card, and a too-quick approval earns nothing', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
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
    expect(app.lastFrame()).toContain('too quick');
    expect(loadState().energy).toBe(10);
    expect(loadState().totals).toMatchObject({ reviewed: 0, skimmed: 1 });

    // The finished-turn alert says what is still waiting.
    emit({ t: t + 9000, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(120);
    f = app.lastFrame()!;
    expect(f).toContain('3 edits');
    expect(f).toContain('1 to review');
    app.unmount();
  });

  it('S twice skips the whole backlog (honestly, as skipped), once does not', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
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
    expect(app.lastFrame()).toContain('Nothing to review');
    app.unmount();
  });

  it('time spent reading a card still counts after a look at the help screen', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
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
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
    await sleep(60);
    app.stdin.write('\t');
    app.stdin.write('\t'); // review → game → learn
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

describe('auto mode and first run', () => {
  it('a new Claude turn does not pull you out of a fight', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
    await sleep(60);
    app.stdin.write('\t'); // review → game
    await sleep(40);
    app.stdin.write('n');
    await sleep(60);
    expect(app.lastFrame()).toContain('Hand');
    emit({ t: Date.now(), k: 'prompt', sid: 's', cwd: '/proj' });
    await sleep(120);
    expect(app.lastFrame()).toContain('Hand');
    app.unmount();
  });

  it('tells a new user how to hook Cowait up until the first event arrives', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} setupHint />);
    await sleep(60);
    expect(app.lastFrame()).toContain('cowait install --project');
    emit({ t: Date.now(), k: 'prompt', sid: 's', cwd: '/proj' });
    await sleep(120);
    expect(app.lastFrame()).not.toContain('cowait install --project');
    app.unmount();
  });

  it('catching up on old events after a restart does not ring or pop stale alerts', async () => {
    const t = Date.now();
    emit({ t: t - 120_000, k: 'prompt', sid: 's', cwd: '/proj' });
    emit({ t: t - 60_000, k: 'stop', sid: 's', cwd: '/proj' });
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
    await sleep(120);
    expect(app.lastFrame()).not.toContain('Claude finished');
    emit({ t: Date.now(), k: 'prompt', sid: 's', cwd: '/proj' });
    emit({ t: Date.now() + 1, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(120);
    expect(app.lastFrame()).toContain('Claude finished');
    app.unmount();
  });

  it('keeps what it folded from the log when the panel closes', async () => {
    const app = render(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />);
    emit(editEv(Date.now(), '/proj/a.ts', 'a', 'b'));
    await sleep(100);
    app.unmount();
    await sleep(20);
    expect(loadState().review.map((c) => c.file)).toEqual(['/proj/a.ts']);
  });
});

describe('narrow side panel (60 columns)', () => {
  it('never draws past the edge, and wraps long code lines instead of cutting them', async () => {
    const app = renderSized(<App cfg={cfgEn} lang="en" initial={newState()} daily={0} pollMs={30} />, 60, 26);
    const t = Date.now();
    const long = `const message = ${'"x" + '.repeat(16)}"TAIL_END";`;
    emit({ t, k: 'prompt', sid: 's', cwd: '/home/dev/shop-api' });
    emit(editEv(t + 1, '/home/dev/shop-api/src/routes/orders.ts', 'const message = "";', long, '/home/dev/shop-api'));
    emit({ t: t + 2, k: 'prompt', sid: 's2', cwd: '/home/dev/web' });
    emit(editEv(t + 3, '/home/dev/web/src/App.tsx', 'a', 'b', '/home/dev/web', 's2'));
    await sleep(150);
    const screens: [string, string][] = [];
    const snap = async (name: string, keys = '', wait = 60) => {
      for (const k of keys) app.stdin.write(k);
      await sleep(wait);
      screens.push([name, app.lastFrame()]);
    };
    await snap('review');
    expect(app.lastFrame()).toContain('TAIL_END');
    expect(app.lastFrame()).toContain('shop-api');
    await snap('typing a note', 'n');
    await snap('typing a note (text)', 'this should stay inside the panel');
    await snap('note cancelled', '\x1b');
    await snap('help', '?');
    await snap('help closed', 'x');
    await snap('free note', 'm');
    await snap('free note closed', '\x1b');
    await snap('game menu', '\t');
    await snap('shop', 's');
    await snap('battle', 'bn');
    await snap('learn', '\t');
    await snap('learn flipped', ' ');
    emit({ t: t + 9000, k: 'stop', sid: 's', cwd: '/home/dev/shop-api' });
    await snap('alert', '', 150);
    for (const [name, frame] of screens) expect(widest(frame), `${name}:\n${frame}`).toBeLessThanOrEqual(60);
    app.unmount();
  });
});
