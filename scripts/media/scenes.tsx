/**
 * Scripted Cowait sessions for the README pictures. They drive the real panel (src/ui/App) in a
 * fake terminal, feed it the same events the hook writes, and hand back what was on screen.
 * Run through scripts/media/record.mjs (it bundles this file), not directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { App } from '../../src/ui/App.js';
import { emptyDay, localDay, newState, type State } from '../../src/engine/state.js';
import { weekKey } from '../../src/engine/progress.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import { CWD, EDITS, TITLES } from '../../src/demo.js';
import { dailyPuzzle, solve } from '../../src/game/stack.js';
import { claimNotes } from '../../src/feedback.js';
import { saveDeck } from '../../src/learn/decks.js';
import { chooseReward, endTurn, newRun, playCard, type Run } from '../../src/game/engine.js';
import type { IEvent } from '../../src/events.js';
import type { Lang } from '../../src/i18n.js';
import { renderSized } from '../../test/render.js';

export interface Frame {
  ansi: string;
  ms: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SID = 'demo';

const TEXT = {
  en: {
    note: 'returning 201 breaks the frontend, keep 200',
    free: 'also add a CHANGELOG entry',
    deck: 'Recent changes · 2026-11-01 09:30',
    q: 'Why does POST /orders now run OrderInput.safeParse before db.orders.create?',
    a: 'So a malformed body is rejected with a 400 and the validation errors instead of being written to the database. Success now returns 201 instead of 200, so check any client that looks at the status code.',
  },
  zh: {
    note: '这里返回 201 会打断前端，保持 200',
    free: '顺便在 CHANGELOG 里记一笔',
    deck: '看懂最近的改动 · 2026-11-01 09:30',
    q: '为什么 POST /orders 现在要先调用 OrderInput.safeParse，再写数据库？',
    a: '这样格式不对的请求体会直接返回 400 和校验错误，不会写进数据库。另外成功时的状态码从 200 变成了 201，判断了状态码的前端要跟着改。',
  },
};

/** Someone who has used Cowait for a while: a streak going, some levels, a decent review record. */
function seasoned(turnMs: number[]): State {
  const s = newState();
  const now = Date.now();
  s.onboarded = true;
  s.lastRecap = weekKey(now);
  s.energy = 6;
  s.coins = 37;
  s.lastDaily = localDay(now);
  Object.assign(s.totals, { turns: 46, testsPassed: 31, cards: 120, reviewed: 92, flagged: 9, delivered: 11, learned: 140, runs: 6, wins: 1, bestFloor: 6, puzzles: 5 });
  s.history = turnMs.map((ms, i) => ({ cwd: CWD, ms, t: now - (i + 1) * 3_600_000 }));
  // Four useful days before today: today keeps the streak alive.
  for (let i = 1; i <= 4; i++) {
    const day = localDay(now - i * 86_400_000);
    s.days[day] = { ...emptyDay(), turns: 6, files: 14, reviewed: 11, flagged: 1, learned: 8, puzzle: i % 2 ? 3 : 2, xp: 190 };
  }
  s.xp = 2080;
  s.level = 9;
  s.bestStreak = 9;
  s.best.wpm = 68;
  for (const id of ['first_review', 'review_50', 'full_turn', 'coverage_80', 'first_note', 'streak_3', 'learn_100', 'dungeon_win', 'puzzle_perfect', 'wpm_60']) s.achievements[id] = now - 86_400_000;
  return s;
}

function busy(s: State, sinceMs: number): State {
  s.sessions[SID] = { cwd: CWD, status: 'busy', turnStart: Date.now() - sinceMs, lastAt: Date.now(), tools: 4, edits: 0, pass: false, fail: false };
  return s;
}

/** A fresh data folder, `prepare` run inside it, then the panel. */
function open(home: string, lang: Lang, cols: number, rows: number, initial: State, prepare = () => {}) {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  process.env.COWAIT_HOME = home;
  prepare();
  return { home, app: renderSized(<App cfg={{ ...DEFAULT_CONFIG, lang, bell: false }} lang={lang} initial={initial} daily={0} pollMs={50} />, cols, rows) };
}

function claude(home: string) {
  const emit = (ev: IEvent) => fs.appendFileSync(path.join(home, 'events.jsonl'), JSON.stringify(ev) + '\n');
  return {
    prompt: (p?: string) => emit({ t: Date.now(), k: 'prompt', sid: SID, cwd: CWD, p }),
    stop: () => emit({ t: Date.now(), k: 'stop', sid: SID, cwd: CWD }),
    tool: (tool: string, extra: Partial<Extract<IEvent, { k: 'tool' }>> = {}) => emit({ t: Date.now(), k: 'tool', sid: SID, cwd: CWD, tool, ...extra }),
    /** What the hook does on Claude's next step: hand over waiting notes. */
    relay: () => {
      const notes = claimNotes();
      if (notes.length) emit({ t: Date.now(), k: 'delivered', sid: SID, ids: notes.map((n) => n.id) });
    },
  };
}

function keyboard(app: { stdin: { write: (s: string) => void } }) {
  return {
    // One key at a time: a fake terminal can merge keys written back to back.
    keys: async (s: string, wait = 0) => {
      for (const ch of s) {
        app.stdin.write(ch);
        await sleep(20);
      }
      await sleep(wait);
    },
    type: async (s: string, per = 60) => {
      for (const ch of s) {
        app.stdin.write(ch);
        await sleep(per);
      }
    },
  };
}

/** Samples the screen, merging consecutive identical frames into one with a duration. */
function recorder(app: { lastFrame: () => string }) {
  const frames: Frame[] = [];
  let cur = app.lastFrame();
  let since = Date.now();
  const id = setInterval(() => {
    const f = app.lastFrame();
    if (f === cur) return;
    const now = Date.now();
    if (cur) frames.push({ ansi: cur, ms: now - since });
    cur = f;
    since = now;
  }, 30);
  return (holdLastMs: number) => {
    clearInterval(id);
    frames.push({ ansi: cur, ms: holdLastMs });
    return frames;
  };
}

/**
 * The README GIF: a turn's files as they come in (two edits to one file folded together), a note
 * Claude receives on its next step, the "finished" alert, approving the turn, today's puzzle, the Me tab.
 */
export async function demoGif(home: string, lang: Lang, cols = 80, rows = 28): Promise<Frame[]> {
  const T = TEXT[lang];
  const { app } = open(home, lang, cols, rows, seasoned([62_000, 75_000, 88_000]));
  const c = claude(home);
  const { keys, type } = keyboard(app);
  const stop = recorder(app);
  await sleep(900);
  c.prompt(TITLES[lang][0]);
  await sleep(1100);
  c.tool('Read');
  await sleep(900);
  c.tool('Edit', { edit: EDITS[0] }); // orders.ts
  await sleep(1500);
  c.tool('Edit', { edit: EDITS[1] }); // orders.ts again: folded into the same entry
  await sleep(1300);
  c.tool('Edit', { edit: EDITS[2] }); // payment.ts
  await sleep(1700);
  await keys('n', 350);
  await type(T.note);
  await sleep(500);
  await keys('\r', 1300);
  c.tool('Bash', { bash: { cmd: 'npm test', test: true, result: 'pass' } });
  c.relay(); // "Claude got your note"
  await sleep(2200);
  await keys('y', 1500); // payment.ts, read and fine
  c.tool('Write', { edit: EDITS[3] });
  await sleep(1600);
  c.stop();
  await sleep(2600); // the "finished" alert
  await keys('\r', 2200); // Enter: straight to what is left of that turn
  await keys('Y', 2600); // approve the rest of the turn
  await sleep(1200); // queue empty: auto mode moves on to the game list
  await keys('2', 1200);
  await keys('\r', 1500);
  const p = dailyPuzzle(localDay(Date.now()));
  for (const i of solve(p.start, p.target, p.buttons) ?? []) await keys(String(i + 1), 650);
  await sleep(2600);
  await keys('\x1b', 600);
  await keys('\t', 600);
  await keys('\t', 2800); // Me: level, streak, today's quests
  const frames = stop(2400);
  app.unmount();
  return frames;
}

/** Review: a card holding two edits to one file, with a note to Claude being typed. */
export async function reviewShot(home: string, lang: Lang, cols = 76, rows = 24): Promise<string> {
  const { app } = open(home, lang, cols, rows, seasoned([62_000, 75_000, 88_000]));
  const c = claude(home);
  const { keys, type } = keyboard(app);
  c.prompt(TITLES[lang][0]);
  c.tool('Read');
  c.tool('Edit', { edit: EDITS[0] });
  c.tool('Edit', { edit: EDITS[1] });
  c.tool('Edit', { edit: EDITS[2] });
  await sleep(400);
  await keys('n', 100);
  await type(TEXT[lang].note, 10);
  await sleep(300);
  const f = app.lastFrame();
  app.unmount();
  return f;
}

/** Play the first floors with a simple strategy, to show a fight further down the dungeon. */
function runTo(floor: number, relics: string[]): Run {
  for (let seed = 1; seed < 200; seed++) {
    const run = newRun(seed, relics);
    for (let guard = 0; guard < 400 && run.phase !== 'dead' && run.floor < floor; guard++) {
      if (run.phase === 'reward') chooseReward(run, 0, relics);
      else if (run.phase === 'battle' && !run.battle!.hand.some((_, i) => playCard(run, i, relics).ok)) endTurn(run, relics);
    }
    if (run.phase === 'battle' && run.floor === floor && run.battle!.enemy.id !== 'race') return run;
  }
  throw new Error('no seed reached the floor');
}

/** Play: a fight on floor 3 with some gear, while Claude works. */
export async function battleShot(home: string, lang: Lang, cols = 76, rows = 24): Promise<string> {
  const s = busy(seasoned([62_000, 75_000, 88_000]), 41_000);
  s.relics = ['chair', 'headphones'];
  s.game = runTo(3, s.relics);
  s.arcade = 'dungeon';
  const { app } = open(home, lang, cols, rows, s);
  const { keys } = keyboard(app);
  await sleep(300);
  await keys('1', 300);
  const f = app.lastFrame();
  app.unmount();
  return f;
}

/** Me: level, streak, today's quests, achievements. */
export async function meShot(home: string, lang: Lang, cols = 76, rows = 24): Promise<string> {
  const s = seasoned([62_000, 75_000, 88_000]);
  const today = localDay(Date.now());
  s.days[today] = { ...emptyDay(), turns: 3, files: 7, reviewed: 6, learned: 4, xp: 72 };
  s.quests = { day: today, done: [] };
  const { app } = open(home, lang, cols, rows, s);
  const { keys } = keyboard(app);
  await sleep(300);
  await keys('\t\t\t', 500);
  const f = app.lastFrame();
  app.unmount();
  return f;
}

/** Learn: a card the AI wrote about Claude's latest change, flipped. */
export async function learnShot(home: string, lang: Lang, cols = 76, rows = 24): Promise<string> {
  const T = TEXT[lang];
  // Short recent turns: auto mode opens the Learn tab.
  const s = busy(seasoned([20_000, 26_000, 31_000]), 9_000);
  s.learnDeck = 'changes-demo';
  const { app } = open(home, lang, cols, rows, s, () =>
    saveDeck({ id: 'changes-demo', title: T.deck, generated: true, createdAt: Date.now(), cards: [{ id: 'changes-demo.1', q: T.q, a: T.a }] }),
  );
  const { keys } = keyboard(app);
  await sleep(300);
  await keys(' ', 300);
  const f = app.lastFrame();
  app.unmount();
  return f;
}
