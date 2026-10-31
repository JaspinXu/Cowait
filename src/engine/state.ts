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
  status: CardStatus;
  note?: string;
  noteId?: string;
  delivered?: boolean;
  /** Later edits to the same file, folded in while this card was still waiting for review. */
  more?: EditInfo[];
  /** When the latest folded-in edit arrived. */
  last?: number;
  /** Approved faster than it could have been read: no energy, not counted as reviewed. */
  quick?: boolean;
}

export interface Totals {
  turns: number;
  testsPassed: number;
  cards: number;
  reviewed: number;
  flagged: number;
  skipped: number;
  /** Approvals given faster than the change could be read. */
  skimmed: number;
  delivered: number;
  learned: number;
  runs: number;
  wins: number;
  bestFloor: number;
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

const MAX_NOTES = 30;

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
  review: ReviewCard[];
  notes: NoteRecord[];
  srs: Record<string, SrsEntry>;
  learnDeck: string;
  relics: string[];
  game: Run | null;
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
      delivered: 0,
      learned: 0,
      runs: 0,
      wins: 0,
      bestFloor: 0,
    },
    sessions: {},
    history: [],
    review: [],
    notes: [],
    srs: {},
    learnDeck: 'all',
    relics: [],
    game: null,
  };
}

/** Fill in fields added by newer versions so old state files keep loading. */
export function normalizeState(raw: Partial<State> | null | undefined): State {
  const base = newState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    totals: { ...base.totals, ...(raw.totals ?? {}) },
    sessions: raw.sessions ?? {},
    history: raw.history ?? [],
    review: raw.review ?? [],
    notes: raw.notes ?? [],
    srs: raw.srs ?? {},
    relics: raw.relics ?? [],
    game: raw.game ?? null,
  };
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

export function coverage(s: State): number | null {
  const done = s.totals.reviewed + s.totals.flagged;
  return s.totals.cards > 0 ? done / s.totals.cards : null;
}
