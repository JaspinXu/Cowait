import type { EditInfo } from '../events.js';
import type { Run } from '../game/engine.js';

export type SessionStatus = 'busy' | 'idle' | 'attention';

export interface Session {
  cwd: string;
  status: SessionStatus;
  turnStart?: number;
  lastAt: number;
  /** Tool calls in the current turn. */
  tools: number;
  edits: number;
  pass: boolean;
  fail: boolean;
}

export type CardStatus = 'new' | 'ok' | 'flag' | 'skip';

export interface ReviewCard extends EditInfo {
  id: string;
  /** When the first edit on this card arrived. */
  t: number;
  sid: string;
  cwd: string;
  /** The Claude turn this change belongs to (see TurnMeta.key). */
  turn?: string;
  status: CardStatus;
  note?: string;
  noteId?: string;
  delivered?: boolean;
  /** Later edits to the same file in the same turn, folded in while the card was still waiting. */
  more?: EditInfo[];
  /** When the latest folded-in edit arrived. */
  last?: number;
  /** Approved without having been read: no energy, not counted as reviewed. */
  quick?: boolean;
  /** Left unreviewed for over a day and archived (counted as skipped). */
  expired?: boolean;
}

/** One Claude turn: from your message to Claude stopping. Review is grouped by turn. */
export interface TurnMeta {
  /** `${sid}@${start}` */
  key: string;
  sid: string;
  cwd: string;
  start: number;
  end?: number;
  /** First line of your message, shortened. Stays on this machine. */
  title?: string;
  pass?: boolean;
  fail?: boolean;
  /** Files changed (cards opened) in this turn. */
  files: number;
  /** Every file of this turn was read (rewarded once). */
  full?: boolean;
}

export interface Totals {
  turns: number;
  testsPassed: number;
  cards: number;
  reviewed: number;
  flagged: number;
  skipped: number;
  /** Approvals given without reading the change. */
  skimmed: number;
  /** Cards archived after sitting unreviewed for a day (also counted in `skipped`). */
  expired: number;
  delivered: number;
  learned: number;
  runs: number;
  wins: number;
  bestFloor: number;
  puzzles: number;
  sprints: number;
}

/** What happened on one local calendar day: drives streaks, quests, the weekly recap and reports. */
export interface DayStat {
  /** Claude turns that did work. */
  turns: number;
  /** Files Claude changed (new cards). */
  files: number;
  reviewed: number;
  flagged: number;
  skimmed: number;
  skipped: number;
  /** Notes you sent Claude (on a card or free-form). */
  notes: number;
  learned: number;
  /** Stars on the daily puzzle (0 = not solved). */
  puzzle: number;
  practice: number;
  sprints: number;
  floors: number;
  wins: number;
  /** Turns whose every file you actually read. */
  fullTurns: number;
  xp: number;
}

export interface SrsEntry {
  box: number;
  due: number;
  seen: number;
}

export interface TurnRecord {
  cwd: string;
  ms: number;
  t: number;
}

/** A note the user sent Claude from the panel (about a card, or free-form with `m`). */
export interface NoteRecord {
  id: string;
  t: number;
  text: string;
  file?: string;
  cwd?: string;
  delivered?: boolean;
}

export type Arcade = 'dungeon' | 'puzzle' | 'sprint';

const MAX_NOTES = 30;
export const MAX_TURNS = 60;
const MAX_DAYS = 120;

export interface State {
  v: 1;
  /** Bytes of events.jsonl already folded into this state. */
  offset: number;
  energy: number;
  coins: number;
  seq: number;
  lastDaily: string;
  totals: Totals;
  sessions: Record<string, Session>;
  history: TurnRecord[];
  turns: TurnMeta[];
  review: ReviewCard[];
  notes: NoteRecord[];
  srs: Record<string, SrsEntry>;
  learnDeck: string;
  relics: string[];
  /** Debug Dungeon run in progress (or just finished). */
  game: Run | null;
  /** Which game the Play tab shows; null = the game list. */
  arcade: Arcade | null;
  /** Stack Puzzle in progress (see game/stack.ts). */
  puzzle: any | null;
  /** Code Sprint round in progress (see game/sprint.ts). */
  sprint: any | null;
  best: { wpm: number };
  days: Record<string, DayStat>;
  xp: number;
  /** Highest level already announced (0 = not known yet: the next settle sets it quietly). */
  level: number;
  bestStreak: number;
  /** Daily quests already rewarded today. */
  quests: { day: string; done: string[] };
  /** Achievement id → when it was unlocked. */
  achievements: Record<string, number>;
  /** The week (Monday's date) whose recap was last shown. */
  lastRecap: string;
  /** The welcome screen has been dismissed. */
  onboarded: boolean;
}

export function newState(): State {
  return {
    v: 1,
    offset: 0,
    energy: 10,
    coins: 0,
    seq: 0,
    lastDaily: '',
    totals: {
      turns: 0,
      testsPassed: 0,
      cards: 0,
      reviewed: 0,
      flagged: 0,
      skipped: 0,
      skimmed: 0,
      expired: 0,
      delivered: 0,
      learned: 0,
      runs: 0,
      wins: 0,
      bestFloor: 0,
      puzzles: 0,
      sprints: 0,
    },
    sessions: {},
    history: [],
    turns: [],
    review: [],
    notes: [],
    srs: {},
    learnDeck: 'all',
    relics: [],
    game: null,
    arcade: null,
    puzzle: null,
    sprint: null,
    best: { wpm: 0 },
    days: {},
    xp: 0,
    level: 0,
    bestStreak: 0,
    quests: { day: '', done: [] },
    achievements: {},
    lastRecap: '',
    onboarded: false,
  };
}

/**
 * Cards from before review was grouped by turn: split each session's cards wherever Claude was
 * quiet for 10 minutes, and give each group a turn of its own.
 */
function groupLegacyCards(s: State): State {
  const loose = s.review.filter((c) => !c.turn).sort((a, b) => a.t - b.t);
  const open: Record<string, { key: string; last: number }> = {};
  for (const c of loose) {
    const cur = open[c.sid];
    const at = c.last ?? c.t;
    if (!cur || c.t - cur.last > 10 * 60 * 1000) {
      const key = c.sid + '@' + c.t;
      open[c.sid] = { key, last: at };
      if (!s.turns.some((m) => m.key === key)) s.turns.push({ key, sid: c.sid, cwd: c.cwd, start: c.t, end: at, files: 0 });
    } else cur.last = Math.max(cur.last, at);
    c.turn = open[c.sid].key;
    const m = s.turns.find((x) => x.key === c.turn)!;
    m.files++;
    m.end = Math.max(m.end ?? 0, at);
  }
  if (loose.length) s.turns.sort((a, b) => a.start - b.start);
  return s;
}

/** Fill in fields added by newer versions so old state files keep loading. */
export function normalizeState(raw: Partial<State> | null | undefined): State {
  const base = newState();
  if (!raw || typeof raw !== 'object') return base;
  return groupLegacyCards({
    ...base,
    ...raw,
    totals: { ...base.totals, ...(raw.totals ?? {}) },
    sessions: raw.sessions ?? {},
    history: raw.history ?? [],
    turns: raw.turns ?? [],
    review: raw.review ?? [],
    notes: raw.notes ?? [],
    srs: raw.srs ?? {},
    relics: raw.relics ?? [],
    game: raw.game ?? null,
    arcade: raw.arcade ?? null,
    puzzle: raw.puzzle ?? null,
    sprint: raw.sprint ?? null,
    best: { ...base.best, ...(raw.best ?? {}) },
    days: raw.days ?? {},
    // Upgrading from a version without XP: earlier honest work still counts.
    xp: raw.xp ?? backfillXp(raw.totals),
    level: raw.level ?? 0,
    quests: raw.quests ?? base.quests,
    achievements: raw.achievements ?? {},
    // Anyone upgrading already knows the panel: no welcome screen for them.
    onboarded: raw.onboarded ?? (raw.totals?.turns ?? 0) + (raw.totals?.cards ?? 0) > 0,
  });
}

function backfillXp(t: Partial<Totals> | undefined): number {
  if (!t) return 0;
  return (t.reviewed ?? 0) * 10 + (t.flagged ?? 0) * 15 + (t.learned ?? 0) * 3 + (t.wins ?? 0) * 50;
}

export function pendingCards(s: State): ReviewCard[] {
  return s.review.filter((c) => c.status === 'new');
}

export function recordNote(s: State, note: NoteRecord): void {
  s.notes.push(note);
  if (s.notes.length > MAX_NOTES) s.notes = s.notes.slice(-MAX_NOTES);
}

/** Notes Claude has not picked up yet. */
export function waitingNotes(s: State): NoteRecord[] {
  return s.notes.filter((n) => !n.delivered);
}

export function busySessions(s: State): [string, Session][] {
  return Object.entries(s.sessions).filter(([, x]) => x.status !== 'idle');
}

/** Share of Claude's changed files you actually read (skims, skips and expired cards don't count). */
export function coverage(s: State): number | null {
  const done = s.totals.reviewed + s.totals.flagged;
  return s.totals.cards > 0 ? done / s.totals.cards : null;
}

export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyDay(): DayStat {
  return {
    turns: 0,
    files: 0,
    reviewed: 0,
    flagged: 0,
    skimmed: 0,
    skipped: 0,
    notes: 0,
    learned: 0,
    puzzle: 0,
    practice: 0,
    sprints: 0,
    floors: 0,
    wins: 0,
    fullTurns: 0,
    xp: 0,
  };
}

/** The stats bucket for the local day containing `now` (created on first use; old days pruned). */
export function dayOf(s: State, now: number): DayStat {
  const key = localDay(now);
  let d = s.days[key];
  if (!d) {
    d = emptyDay();
    s.days[key] = d;
    const keys = Object.keys(s.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete s.days[k];
  } else {
    // Days written by an older version may lack newer counters.
    for (const [k, v] of Object.entries(emptyDay())) if ((d as any)[k] === undefined) (d as any)[k] = v;
  }
  return d;
}

export function turnByKey(s: State, key: string | undefined): TurnMeta | undefined {
  return key ? s.turns.find((x) => x.key === key) : undefined;
}
