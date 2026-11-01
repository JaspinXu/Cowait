/**
 * Long-term progress: XP and levels, the daily streak, three daily quests, achievements and the
 * weekly recap. Everything is derived from honest activity (reading Claude's changes, studying,
 * solving the daily puzzle), never from time spent waiting.
 *
 * Call sites record what happened with `track`; the app calls `settleProgress` after every change
 * to grant quests/achievements/level-ups, and shows the events it returns.
 */
import type { L } from '../game/engine.js';
import { dayOf, localDay, type DayStat, type State } from './state.js';

const l = (zh: string, en: string): L => ({ zh, en });

export const XP = {
  reviewed: 10,
  flagged: 15,
  note: 5,
  learned: 3,
  puzzle: 20,
  puzzleStar: 5,
  practice: 8,
  sprint: 10,
  floor: 5,
  win: 50,
  fullTurn: 10,
  quest: 20,
};

export const QUEST_ENERGY = 2;
export const ACHIEVEMENT_ENERGY = 3;

// ---------------------------------------------------------------- recording

export type Activity = 'reviewed' | 'flagged' | 'skimmed' | 'skipped' | 'note' | 'learned' | 'puzzle' | 'practice' | 'sprint' | 'floor' | 'win' | 'fullTurn';

/** Record one thing the user did today. For 'puzzle', `n` is the stars earned on the daily puzzle. */
export function track(s: State, what: Activity, now = Date.now(), n = 1): void {
  const d = dayOf(s, now);
  let xp = 0;
  switch (what) {
    case 'reviewed':
      d.reviewed += n;
      xp = XP.reviewed * n;
      break;
    case 'flagged':
      d.flagged += n;
      xp = XP.flagged * n;
      break;
    case 'skimmed':
      d.skimmed += n;
      break;
    case 'skipped':
      d.skipped += n;
      break;
    case 'note':
      d.notes += n;
      xp = XP.note * n;
      break;
    case 'learned':
      d.learned += n;
      xp = XP.learned * n;
      break;
    case 'puzzle':
      // Replaying the daily for more stars only pays for the improvement.
      if (n > d.puzzle) {
        xp = (d.puzzle ? 0 : XP.puzzle) + XP.puzzleStar * (n - d.puzzle);
        d.puzzle = n;
      }
      break;
    case 'practice':
      d.practice += n;
      xp = XP.practice * n;
      break;
    case 'sprint':
      d.sprints += n;
      xp = XP.sprint * n;
      break;
    case 'floor':
      d.floors += n;
      xp = XP.floor * n;
      break;
    case 'win':
      d.wins += n;
      xp = XP.win * n;
      break;
    case 'fullTurn':
      d.fullTurns += n;
      xp = XP.fullTurn * n;
      break;
  }
  d.xp += xp;
  s.xp += xp;
}

// ---------------------------------------------------------------- levels

/** XP needed to go from `level` to the next one. */
export function xpForLevel(level: number): number {
  return 100 + 40 * (level - 1);
}

export function levelInfo(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, xp);
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, into: rest, need: xpForLevel(level) };
}

const TITLES: [number, L][] = [
  [30, l('传奇工程师', 'Legendary Engineer')],
  [20, l('首席工程师', 'Principal Engineer')],
  [15, l('资深工程师', 'Staff Engineer')],
  [10, l('高级工程师', 'Senior Engineer')],
  [6, l('工程师', 'Engineer')],
  [3, l('初级工程师', 'Junior Engineer')],
  [1, l('实习生', 'Intern')],
];

export function levelTitle(level: number): L {
  return TITLES.find(([min]) => level >= min)![1];
}

// ---------------------------------------------------------------- streak

/** A day counts toward the streak when you did something useful, not just played. */
export function activeDay(d: DayStat | undefined): boolean {
  return !!d && (d.reviewed + d.flagged >= 1 || d.learned >= 5 || d.puzzle > 0);
}

function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + by, 12).getTime());
}

/**
 * Consecutive useful days. A streak survives until the end of today: if you have not done
 * anything yet today, it counts up to yesterday and `today` is false (time to keep it alive).
 */
export function streak(s: State, now = Date.now()): { days: number; today: boolean } {
  const today = localDay(now);
  const doneToday = activeDay(s.days[today]);
  let day = doneToday ? today : shiftDay(today, -1);
  let n = 0;
  while (activeDay(s.days[day])) {
    n++;
    day = shiftDay(day, -1);
  }
  return { days: n, today: doneToday };
}

// ---------------------------------------------------------------- quests

export interface QuestDef {
  id: string;
  goal: number;
  metric: (d: DayStat) => number;
  label: L;
}

const QUESTS: Record<string, QuestDef> = Object.fromEntries(
  [
    { id: 'review3', goal: 3, metric: (d: DayStat) => d.reviewed + d.flagged, label: l('认真审过 3 个文件', 'Actually read 3 changed files') },
    { id: 'review8', goal: 8, metric: (d: DayStat) => d.reviewed + d.flagged, label: l('认真审过 8 个文件', 'Actually read 8 changed files') },
    { id: 'fullturn', goal: 1, metric: (d: DayStat) => d.fullTurns, label: l('完整审完一轮（每个文件都看过）', 'Review one whole turn, every file read') },
    { id: 'learn5', goal: 5, metric: (d: DayStat) => d.learned, label: l('刷 5 张卡', 'Study 5 flashcards') },
    { id: 'learn10', goal: 10, metric: (d: DayStat) => d.learned, label: l('刷 10 张卡', 'Study 10 flashcards') },
    { id: 'puzzle', goal: 1, metric: (d: DayStat) => (d.puzzle > 0 ? 1 : 0), label: l('解出今日栈机谜题', "Solve today's Stack Puzzle") },
    { id: 'sprint', goal: 1, metric: (d: DayStat) => d.sprints, label: l('打完一轮代码速打', 'Finish a Code Sprint round') },
    { id: 'floors', goal: 2, metric: (d: DayStat) => d.floors, label: l('捉虫地牢打过 2 层', 'Clear 2 Debug Dungeon floors') },
  ].map((q) => [q.id, q]),
);

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Today's three quests: one about reviewing, one about learning, one about playing. */
export function questsFor(day: string): QuestDef[] {
  const h = hash(day);
  const review = ['review3', 'review8', 'fullturn'][h % 3];
  const learn = ['learn5', 'learn10'][(h >>> 3) % 2];
  const play = ['puzzle', 'sprint', 'floors'][(h >>> 5) % 3];
  return [QUESTS[review], QUESTS[learn], QUESTS[play]];
}

export function questProgress(s: State, now = Date.now()): { def: QuestDef; value: number; done: boolean }[] {
  const day = localDay(now);
  const d = s.days[day];
  const done = s.quests.day === day ? s.quests.done : [];
  return questsFor(day).map((def) => ({ def, value: Math.min(def.goal, d ? def.metric(d) : 0), done: done.includes(def.id) }));
}

// ---------------------------------------------------------------- achievements

export interface AchievementDef {
  id: string;
  name: L;
  desc: L;
  /** Unlocked by the state alone; achievements without a test are unlocked by the game that grants them. */
  test?: (s: State, ctx: { streak: number; level: number }) => boolean;
}

const read = (s: State) => s.totals.reviewed + s.totals.flagged;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_review', name: l('第一眼', 'First Look'), desc: l('认真审过第 1 个文件', 'Read your first changed file'), test: (s) => read(s) >= 1 },
  { id: 'review_50', name: l('火眼金睛', 'Sharp Eyes'), desc: l('累计审过 50 个文件', 'Read 50 changed files'), test: (s) => read(s) >= 50 },
  { id: 'review_500', name: l('代码守门人', 'Gatekeeper'), desc: l('累计审过 500 个文件', 'Read 500 changed files'), test: (s) => read(s) >= 500 },
  { id: 'full_turn', name: l('一轮不落', 'Nothing Missed'), desc: l('完整审完一整轮', 'Review one whole turn, every file read'), test: (s) => Object.values(s.days).some((d) => (d.fullTurns ?? 0) > 0) },
  {
    id: 'coverage_80',
    name: l('认真负责', 'Diligent'),
    desc: l('审过 50 个以上的文件，覆盖率保持在 80% 以上', 'Over 50 files read with coverage at 80% or more'),
    test: (s) => read(s) >= 50 && read(s) / Math.max(1, s.totals.cards) >= 0.8,
  },
  { id: 'first_note', name: l('一句话的事', 'Just One Line'), desc: l('Claude 收到了你的第 1 条留言', 'Claude picked up your first note'), test: (s) => s.totals.delivered >= 1 },
  { id: 'notes_25', name: l('默契搭档', 'In Sync'), desc: l('Claude 收到了你的 25 条留言', 'Claude picked up 25 of your notes'), test: (s) => s.totals.delivered >= 25 },
  { id: 'streak_3', name: l('渐入佳境', 'Warming Up'), desc: l('连续 3 天', 'A 3-day streak'), test: (_s, c) => c.streak >= 3 },
  { id: 'streak_7', name: l('一周不断', 'Full Week'), desc: l('连续 7 天', 'A 7-day streak'), test: (_s, c) => c.streak >= 7 },
  { id: 'streak_30', name: l('习惯成自然', 'Second Nature'), desc: l('连续 30 天', 'A 30-day streak'), test: (_s, c) => c.streak >= 30 },
  { id: 'learn_100', name: l('学而时习之', 'Lifelong Learner'), desc: l('刷了 100 张卡', 'Study 100 flashcards'), test: (s) => s.totals.learned >= 100 },
  { id: 'dungeon_win', name: l('栈溢出已修复', 'Overflow Fixed'), desc: l('通关捉虫地牢', 'Beat Debug Dungeon'), test: (s) => s.totals.wins >= 1 },
  { id: 'dungeon_bare', name: l('徒手捉虫', 'Bare Hands'), desc: l('不带任何装备通关捉虫地牢', 'Beat Debug Dungeon with no gear') },
  { id: 'puzzle_perfect', name: l('一步不多', 'Not One Step More'), desc: l('三星解出一道栈机谜题', 'Three-star a Stack Puzzle') },
  {
    id: 'puzzle_week',
    name: l('每日一题', 'Daily Habit'),
    desc: l('累计 7 天解出每日谜题', 'Solve the daily puzzle on 7 days'),
    test: (s) => Object.values(s.days).filter((d) => d.puzzle > 0).length >= 7,
  },
  { id: 'wpm_60', name: l('手速在线', 'Quick Fingers'), desc: l('代码速打达到 60 WPM', 'Reach 60 WPM in Code Sprint'), test: (s) => s.best.wpm >= 60 },
  { id: 'wpm_90', name: l('键盘如飞', 'Flying Keys'), desc: l('代码速打达到 90 WPM', 'Reach 90 WPM in Code Sprint'), test: (s) => s.best.wpm >= 90 },
  { id: 'turns_100', name: l('老搭档', 'Old Partners'), desc: l('Claude 为你干了 100 轮活', 'Claude worked 100 turns for you'), test: (s) => s.totals.turns >= 100 },
  { id: 'tests_50', name: l('绿灯常亮', 'All Green'), desc: l('50 轮测试通过', '50 turns with passing tests'), test: (s) => s.totals.testsPassed >= 50 },
  { id: 'level_10', name: l('独当一面', 'Senior Now'), desc: l('达到 10 级', 'Reach level 10'), test: (_s, c) => c.level >= 10 },
];

/** Unlock an achievement directly (for ones a game grants). Returns whether it was new. */
export function unlock(s: State, id: string, now = Date.now()): boolean {
  if (s.achievements[id] || !ACHIEVEMENTS.some((a) => a.id === id)) return false;
  s.achievements[id] = now;
  s.energy += ACHIEVEMENT_ENERGY;
  return true;
}

// ---------------------------------------------------------------- settling

export type ProgressEvent =
  | { type: 'quest'; id: string; label: L }
  | { type: 'quests_all' }
  | { type: 'achievement'; id: string; name: L }
  | { type: 'level'; level: number; title: L };

/** Grant whatever the latest activity earned. Idempotent: calling it twice grants nothing new. */
export function settleProgress(s: State, now = Date.now()): ProgressEvent[] {
  const out: ProgressEvent[] = [];
  const today = localDay(now);
  if (s.quests.day !== today) s.quests = { day: today, done: [] };
  const d = s.days[today];
  if (d) {
    const before = s.quests.done.length;
    for (const q of questsFor(today)) {
      if (s.quests.done.includes(q.id) || q.metric(d) < q.goal) continue;
      s.quests.done.push(q.id);
      s.energy += QUEST_ENERGY;
      d.xp += XP.quest;
      s.xp += XP.quest;
      out.push({ type: 'quest', id: q.id, label: q.label });
    }
    if (before < 3 && s.quests.done.length === 3) out.push({ type: 'quests_all' });
  }

  const st = streak(s, now).days;
  if (st > s.bestStreak) s.bestStreak = st;

  // The very first settle (new user, or upgrading from a version without progress) grants what is
  // already earned quietly, instead of a burst of announcements.
  const quiet = s.level === 0;
  const { level } = levelInfo(s.xp);
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id] || !a.test?.(s, { streak: st, level })) continue;
    s.achievements[a.id] = now;
    s.energy += ACHIEVEMENT_ENERGY;
    if (!quiet) out.push({ type: 'achievement', id: a.id, name: a.name });
  }

  const lv = levelInfo(s.xp).level;
  if (!quiet && lv > s.level) out.push({ type: 'level', level: lv, title: levelTitle(lv) });
  s.level = Math.max(s.level, lv);
  return out;
}

// ---------------------------------------------------------------- weekly recap

/** Monday of the week containing `now`, as YYYY-MM-DD. */
export function weekKey(now: number): string {
  const d = new Date(now);
  const back = (d.getDay() + 6) % 7;
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12).getTime());
}

export interface Recap {
  week: string;
  turns: number;
  files: number;
  read: number;
  flagged: number;
  notes: number;
  learned: number;
  activeDays: number;
  coverage: number | null;
  xp: number;
}

/** Last week's numbers (Monday to Sunday before the week containing `now`). */
export function lastWeekRecap(s: State, now = Date.now()): Recap {
  return weekStats(s, shiftDay(weekKey(now), -7));
}

/** Numbers for the seven days starting at `start` (a Monday, YYYY-MM-DD). */
export function weekStats(s: State, start: string): Recap {
  const r: Recap = { week: start, turns: 0, files: 0, read: 0, flagged: 0, notes: 0, learned: 0, activeDays: 0, coverage: null, xp: 0 };
  for (let i = 0; i < 7; i++) {
    const d = s.days[shiftDay(start, i)];
    if (!d) continue;
    r.turns += d.turns;
    r.files += d.files;
    r.read += d.reviewed + d.flagged;
    r.flagged += d.flagged;
    r.notes += d.notes;
    r.learned += d.learned;
    r.xp += d.xp;
    if (activeDay(d)) r.activeDays++;
  }
  r.coverage = r.files > 0 ? Math.min(1, r.read / r.files) : null;
  return r;
}

/** Should the panel show last week's recap now? Once per week, and only if last week had anything in it. */
export function recapDue(s: State, now = Date.now()): Recap | null {
  const wk = weekKey(now);
  if (s.lastRecap === wk) return null;
  const r = lastWeekRecap(s, now);
  return r.turns + r.read + r.learned > 0 ? r : null;
}
