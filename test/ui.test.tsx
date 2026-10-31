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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let home: string;
const emit = (ev: object) => fs.appendFileSync(path.join(home, 'events.jsonl'), JSON.stringify(ev) + '\n');

beforeEach(() => {
  home = tempHome();
});

describe('panel', () => {
  it('walks through review → alert → game → learn', async () => {
    const cfg = { ...DEFAULT_CONFIG, bell: false, lang: 'en' as const };
    const app = render(<App cfg={cfg} lang="en" initial={newState()} daily={0} pollMs={30} />);
    await sleep(80);
    expect(app.lastFrame()).toContain('Waiting for Claude');

    // Claude starts a turn and edits a file.
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/proj' });
    emit({ t: t + 1, k: 'tool', sid: 's', cwd: '/proj', tool: 'Edit', edit: { file: '/proj/src/a.ts', kind: 'edit', hunks: [{ old: 'const x = 1;', new: 'const x = 2;' }] } });
    emit({ t: t + 2, k: 'tool', sid: 's', cwd: '/proj', tool: 'Edit', edit: { file: '/proj/src/b.ts', kind: 'edit', hunks: [{ old: 'return a;', new: 'return a ?? null;' }] } });
    await sleep(120);
    let f = app.lastFrame()!;
    expect(f).toContain('Claude is working');
    expect(f).toContain('src/a.ts');
    expect(f).toContain('+ const x = 2;');
    expect(f).toContain('- const x = 1;');
    expect(f).toContain('Review 2');

    // Approve the first card.
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
    expect(pendingNotes().map((n) => n.text)).toEqual(['please keep undefined']);
    expect(pendingNotes()[0].file).toBe('src/b.ts');
    expect(app.lastFrame()).toContain('Claude sees it on its very next step');
    expect(loadState().energy).toBe(13);

    // Claude finishes → alert with coins.
    emit({ t: t + 5000, k: 'stop', sid: 's', cwd: '/proj' });
    await sleep(120);
    f = app.lastFrame()!;
    expect(f).toContain('Claude finished');
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

    // Learn: flip a card and rate it.
    app.stdin.write('\t');
    await sleep(60);
    f = app.lastFrame()!;
    expect(f).toContain('Learn');
    expect(f).toContain('Q:');
    app.stdin.write(' ');
    await sleep(40);
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
    const cfg = { ...DEFAULT_CONFIG, bell: false, lang: 'en' as const };
    const app = render(<App cfg={cfg} lang="en" initial={newState()} daily={0} pollMs={30} />);
    const t = Date.now();
    emit({ t, k: 'tool', sid: 's', cwd: '/p', tool: 'Edit', edit: { file: '/p/x.ts', kind: 'edit', hunks: [{ old: 'a', new: 'b' }] } });
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
    const cfg = { ...DEFAULT_CONFIG, bell: false, lang: 'en' as const };
    const app = render(<App cfg={cfg} lang="en" initial={newState()} daily={0} pollMs={20} />);
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/p' });
    emit({ t: t + 1, k: 'tool', sid: 's', cwd: '/p', tool: 'Edit', edit: { file: '/p/x.ts', kind: 'edit', hunks: [{ old: 'a', new: 'b' }] } });
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

  it('auto mode opens review when a turn starts with changes pending, and flags approvals', async () => {
    const cfg = { ...DEFAULT_CONFIG, bell: false, lang: 'zh' as const };
    const s = newState();
    const app = render(<App cfg={cfg} lang="zh" initial={s} daily={5} pollMs={30} />);
    await sleep(60);
    expect(app.lastFrame()).toContain('今日首次打开 +5⚡');
    app.stdin.write(' ');
    const t = Date.now();
    emit({ t, k: 'prompt', sid: 's', cwd: '/p' });
    emit({ t: t + 1, k: 'notify', sid: 's', cwd: '/p', msg: 'Claude needs your permission to use Bash' });
    await sleep(120);
    expect(app.lastFrame()).toContain('Claude 在等你确认');
    app.unmount();
  });
});
