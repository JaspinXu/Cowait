import React, { useEffect, useMemo, useRef, useState } from 'react';
import path from 'node:path';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import { pendingCards, recordNote, turnByKey, type ReviewCard, type State, type TurnMeta } from '../engine/state.js';
import { applyVerdict, isSkim } from '../engine/economy.js';
import { cardDiff, diffRows, diffStats } from '../engine/diff.js';
import { addNote } from '../feedback.js';
import { normPath } from '../paths.js';
import { t, fmtAgo, fmtDur, type Key, type Lang } from '../i18n.js';
import { InputLine, Para, fit, newNoteId, useHint, useLine, useRefState, type ModeProps } from './common.js';
import { Today } from './Today.js';

// ---------------------------------------------------------------- honest reading time

/**
 * How long each card's current content has actually been on screen, summed over every visit.
 * Kept outside the component so it survives the review tab being swapped out (help, other tabs).
 * Only what you looked at counts as reviewed; a file approved unseen (by `y` in a blink, or as
 * part of a whole turn) is approved but not counted.
 */
const dwell = new Map<string, number>();
let showing: { key: string; since: number } | null = null;

function startDwell(key: string): void {
  stopDwell();
  showing = { key, since: Date.now() };
}

function stopDwell(): void {
  if (!showing) return;
  dwell.set(showing.key, (dwell.get(showing.key) ?? 0) + Date.now() - showing.since);
  showing = null;
  if (dwell.size > 500) dwell.delete(dwell.keys().next().value!);
}

function shownMs(key: string): number {
  return (dwell.get(key) ?? 0) + (showing?.key === key ? Date.now() - showing.since : 0);
}

const parts = (c: ReviewCard) => 1 + (c.more?.length ?? 0);
/** A new edit folded into the card is new content: its reading clock starts over. */
const contentKey = (c: ReviewCard) => `${c.id}:${parts(c)}`;
const changedLines = (c: ReviewCard) => {
  const s = diffStats(cardDiff(c));
  return s.add + s.del;
};

// ---------------------------------------------------------------- grouping

export interface TurnGroup {
  key: string;
  meta?: TurnMeta;
  /** Every card of the turn, reviewed or not, in the order the files were first touched. */
  cards: ReviewCard[];
  pending: ReviewCard[];
}

const turnKeyOf = (c: ReviewCard) => c.turn ?? `legacy:${c.sid}`;

/** Turns that still have something to review, newest first: what Claude just did is freshest in mind. */
export function reviewGroups(s: State): TurnGroup[] {
  const pend = pendingCards(s);
  const keys = new Set(pend.map(turnKeyOf));
  const groups: TurnGroup[] = [];
  for (const key of keys) {
    const cards = s.review.filter((c) => turnKeyOf(c) === key).sort((a, b) => a.t - b.t);
    groups.push({ key, meta: turnByKey(s, key), cards, pending: cards.filter((c) => c.status === 'new') });
  }
  const start = (g: TurnGroup) => g.meta?.start ?? g.cards[0]?.t ?? 0;
  return groups.sort((a, b) => start(b) - start(a));
}

function rel(file: string, cwd: string): string {
  if (cwd && normPath(file).startsWith(normPath(cwd) + '/')) {
    const r = path.relative(cwd, file);
    if (r && !r.startsWith('..')) return r.replace(/\\/g, '/');
  }
  return file.replace(/\\/g, '/');
}

const short = (s: string, n: number) => (Array.from(s).length > n ? Array.from(s).slice(0, n - 1).join('') + '…' : s);

const baseName = (f: string) => f.replace(/\\/g, '/').split('/').pop() || f;

const MARK: Record<string, [string, string]> = {
  new: ['●', 'yellow'],
  ok: ['✓', 'green'],
  flag: ['✎', 'cyan'],
  skip: ['–', 'gray'],
  quick: ['·', 'gray'],
};

type ChipRow = { card: ReviewCard; label: string }[];

/** Lay a turn's files out as chips on at most `maxLines` lines (the rest become "+N"). */
function layoutChips(cards: ReviewCard[], width: number, maxLines: number): { lines: ChipRow[]; hidden: number } {
  const lines: ChipRow[] = [[]];
  let used = 0;
  let hidden = 0;
  for (const card of cards) {
    const label = baseName(card.file);
    const w = stringWidth(label) + 4;
    if (used + w > width - 4 && lines[lines.length - 1].length) {
      if (lines.length >= maxLines) {
        hidden++;
        continue;
      }
      lines.push([]);
      used = 0;
    }
    lines[lines.length - 1].push({ card, label });
    used += w;
  }
  return { lines, hidden };
}

/** A turn's files as chips; the current file is highlighted. */
function Chips({ lines, hidden, current }: { lines: ChipRow[]; hidden: number; current?: string }) {
  return (
    <Box flexDirection="column">
      {lines.map((row, i) => (
        <Text key={i} wrap="truncate-end">
          {row.map(({ card, label }) => {
            const [mark, color] = MARK[card.quick ? 'quick' : card.status];
            const on = card.id === current;
            return (
              <Text key={card.id}>
                <Text color={color}>{mark} </Text>
                <Text inverse={on} bold={on} color={on ? 'cyan' : card.status === 'new' ? undefined : 'gray'}>
                  {label}
                </Text>
                {'  '}
              </Text>
            );
          })}
          {i === lines.length - 1 && hidden ? <Text color="gray">+{hidden}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}

function turnLine(g: TurnGroup, st: State, lang: Lang, now: number, manyProjects: boolean): string {
  const m = g.meta;
  const start = m?.start ?? g.cards[0].t;
  const bits: string[] = [];
  const session = m ? st.sessions[m.sid] : undefined;
  const running = !!m && !m.end && session?.status !== 'idle' && session?.turnStart === m.start;
  bits.push(running ? t(lang, 'rv_running') : t(lang, 'rv_ago', { t: fmtAgo(now - (m?.end ?? g.cards[g.cards.length - 1].last ?? start), lang) }));
  if (m?.end) bits.push(t(lang, 'rv_took', { t: fmtDur(m.end - m.start) }));
  if (m?.pass) bits.push(t(lang, 'rv_pass'));
  else if (m?.fail) bits.push(t(lang, 'rv_fail'));
  bits.push(t(lang, 'rv_files', { n: g.cards.length }));
  if (manyProjects) bits.push(path.basename(g.cards[0].cwd));
  return bits.join(' · ');
}

// ---------------------------------------------------------------- component

export function Review({ st, update, lang, active, blocked, width, height, now, busy, setTyping, setupHint, toast, setHint, focusTurn, clearFocus }: ModeProps) {
  const groups = useMemo(() => reviewGroups(st), [st.review, st.turns]);
  const flat = useMemo(() => groups.flatMap((g) => g.pending), [groups]);
  const [sel, setSel, selRef] = useRefState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const line = useLine();
  const noteCard = useRef<{ id: string; file: string; cwd: string; sid: string } | null>(null);

  // "Claude finished → Enter": open that turn.
  useEffect(() => {
    if (!focusTurn) return;
    const g = groups.find((x) => x.key === focusTurn);
    if (g?.pending[0]) {
      setSel(g.pending[0].id);
      setScroll(0);
    }
    clearFocus();
  }, [focusTurn]);

  const card = flat.find((c) => c.id === sel) ?? flat[0];
  const group = card ? groups.find((g) => g.key === turnKeyOf(card)) : undefined;
  const ck = card ? contentKey(card) : '';

  // Count reading time only while this card is on screen.
  useEffect(() => {
    if (!ck) return;
    startDwell(ck);
    return () => stopDwell();
  }, [ck]);

  const lines = useMemo(() => (card ? cardDiff(card) : []), [ck]);
  const stats = diffStats(lines);
  const textW = Math.max(10, width - 8);
  const rows = useMemo(() => diffRows(lines, textW), [lines, textW]);
  const manyProjects = new Set(flat.map((c) => normPath(c.cwd))).size > 1;

  const chips = group && group.cards.length > 1 ? layoutChips(group.cards, width - 1, height >= 18 ? 2 : 1) : null;
  // title, turn line, chips, file header on top; "more" line (or the 2-line note box) at the bottom
  const view = Math.max(3, height - (3 + (chips?.lines.length ?? 0) + 1));
  const maxScroll = Math.max(0, rows.length - view);
  const sc = Math.min(scroll, maxScroll);

  /** The card to show after `id` leaves the queue: the next one, else the one before. */
  const neighbour = (id: string, list = flat): string | null => {
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return list[0]?.id ?? null;
    return list[i + 1]?.id ?? list[i - 1]?.id ?? null;
  };

  const go = (d: number) => {
    if (!card) return;
    const i = flat.findIndex((c) => c.id === card.id);
    const next = flat[Math.max(0, Math.min(flat.length - 1, i + d))];
    if (next) setSel(next.id);
    setScroll(0);
  };

  const goTurn = (d: number) => {
    if (!group) return;
    const gi = groups.findIndex((g) => g.key === group.key);
    const g = groups[Math.max(0, Math.min(groups.length - 1, gi + d))];
    if (g?.pending[0]) setSel(g.pending[0].id);
    setScroll(0);
  };

  // After a long session the queue can hold dozens of files. S twice clears it, counted as skipped
  // (not reviewed), so coverage stays honest. One S only asks; any other key forgets the request.
  const skipAllAsked = useRef(0);
  const skipAll = () => {
    if (Date.now() - skipAllAsked.current > 4000) {
      skipAllAsked.current = Date.now();
      toast(t(lang, 'rv_skip_all_ask', { n: flat.length }), 'yellow');
      return;
    }
    skipAllAsked.current = 0;
    const ids = flat.map((c) => c.id);
    update((s) => {
      for (const id of ids) applyVerdict(s, id, 'skip');
    });
    toast(t(lang, 'rv_skip_all_done', { n: ids.length }), 'gray');
    setScroll(0);
  };

  const verdict = (v: 'ok' | 'skip') => {
    if (!card) return;
    const quick = v === 'ok' && isSkim(stats.add + stats.del, shownMs(ck));
    let gain = 0;
    const next = neighbour(card.id);
    update((s) => {
      gain = applyVerdict(s, card.id, v, { quick });
    });
    setSel(next);
    if (v === 'skip') toast(t(lang, 'rv_skip'), 'gray');
    else toast(quick ? t(lang, 'rv_skim') : t(lang, 'rv_ok', { n: gain }), quick ? 'yellow' : 'green');
    setScroll(0);
  };

  /** Approve every waiting file of this turn. Files you have read count; unseen ones are approved unread. */
  const approveTurn = () => {
    if (!group) return;
    const todo = group.pending.map((c) => ({ id: c.id, quick: isSkim(changedLines(c), shownMs(contentKey(c))) }));
    const rest = flat.filter((c) => !todo.some((x) => x.id === c.id));
    const after = groups.slice(groups.findIndex((g) => g.key === group.key) + 1).find((g) => g.pending.length)?.pending[0]?.id;
    let gain = 0;
    update((s) => {
      for (const x of todo) gain += applyVerdict(s, x.id, 'ok', { quick: x.quick });
    });
    setSel(after ?? rest[0]?.id ?? null);
    const unread = todo.filter((x) => x.quick).length;
    const read = todo.length - unread;
    toast(
      !unread ? t(lang, 'rv_turn_all', { n: read, e: gain }) : !read ? t(lang, 'rv_turn_none', { n: unread }) : t(lang, 'rv_turn_some', { r: read, e: gain, q: unread }),
      unread ? 'yellow' : 'green',
    );
    setScroll(0);
  };

  const submitNote = (raw: string) => {
    const text = raw.trim();
    const target = noteCard.current;
    setTyping(false);
    if (!target || !text) return;
    const noteId = newNoteId();
    const at = Date.now();
    const cwd = target.cwd || undefined;
    addNote({ id: noteId, t: at, text, file: target.file, cardId: target.id, cwd, sid: target.sid });
    let gain = 0;
    const next = neighbour(target.id);
    update((s) => {
      gain = applyVerdict(s, target.id, 'flag', { note: text, noteId });
      recordNote(s, { id: noteId, t: at, text, file: target.file, cwd });
    });
    if (selRef.current === target.id) setSel(next);
    toast(t(lang, busy ? 'rv_queued_busy' : 'rv_queued_idle', { n: gain }), 'cyan');
    setScroll(0);
  };

  useInput(
    (input, key) => {
      if (blocked()) return;
      if (line.isOpen()) {
        line.handle(input, key, submitNote, () => setTyping(false));
        return;
      }
      if (!card) return;
      if (input === 'S') return skipAll();
      skipAllAsked.current = 0;
      if (input === 'y') verdict('ok');
      else if (input === 'Y') approveTurn();
      else if (input === 's') verdict('skip');
      else if (input === 'n') {
        noteCard.current = { id: card.id, file: rel(card.file, card.cwd), cwd: card.cwd, sid: card.sid };
        line.open();
        setTyping(true);
      } else if (key.rightArrow || input === 'l') go(1);
      else if (key.leftArrow || input === 'h') go(-1);
      else if (input === ']') goTurn(1);
      else if (input === '[') goTurn(-1);
      else if (key.downArrow || input === 'j') setScroll(Math.min(maxScroll, sc + 1));
      else if (key.upArrow || input === 'k') setScroll(Math.max(0, sc - 1));
      else if (key.pageDown || input === ' ') setScroll(Math.min(maxScroll, sc + view));
      else if (key.pageUp) setScroll(Math.max(0, sc - view));
    },
    { isActive: active },
  );

  const hint = !card
    ? t(lang, 'rv_empty_keys')
    : line.value !== null
      ? t(lang, 'rv_note_hint')
      : fit([t(lang, 'rv_keys'), t(lang, 'rv_keys_short')], width - 12);
  useHint(setHint, hint, active);

  const paraW = width - 1;

  // ---------------------------------------------------------------- nothing waiting
  if (!card || !group) {
    const last = [...st.turns].reverse().find((m) => m.files > 0);
    return (
      <Box flexDirection="column">
        {setupHint ? (
          <>
            <Text bold color="yellow">
              {t(lang, 'rv_setup')}
            </Text>
            <Para text={t(lang, 'rv_setup_cmd')} width={paraW} />
            <Para text={t(lang, 'rv_setup_then')} width={paraW} color="gray" />
          </>
        ) : (
          <>
            <Text bold color={last ? 'green' : undefined}>
              {t(lang, last ? 'rv_empty' : 'rv_empty_first')}
            </Text>
            {last ? (
              <Para
                text={
                  last.end
                    ? t(lang, 'rv_last', { title: short(last.title ?? t(lang, 'rv_untitled'), 16), n: last.files, ago: fmtAgo(now - last.end, lang) })
                    : t(lang, 'rv_last_running', { title: short(last.title ?? t(lang, 'rv_untitled'), 16), n: last.files })
                }
                width={paraW}
                color="gray"
              />
            ) : (
              <Para text={t(lang, 'rv_empty_wait')} width={paraW} color="gray" />
            )}
          </>
        )}
        <Text> </Text>
        <Today st={st} lang={lang} width={paraW} now={now} />
      </Box>
    );
  }

  // ---------------------------------------------------------------- a file of a turn
  const gi = groups.findIndex((g) => g.key === group.key);
  const title = group.meta?.title ?? t(lang, 'rv_untitled');
  const pos = groups.length > 1 ? t(lang, 'rv_turn', { i: gi + 1, n: groups.length }) : '';
  const file = rel(card.file, card.cwd);
  const n = parts(card);
  const kind = n > 1 ? t(lang, 'rv_parts', { n }) : card.created ? t(lang, 'rv_new_file') : t(lang, `kind_${card.kind}` as Key);
  const shownRows = rows.slice(sc, sc + view);
  const below = rows.length - sc - view;
  return (
    <Box flexDirection="column">
      <Box width={paraW}>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold wrap="truncate-end">
            {title}
          </Text>
        </Box>
        {pos ? (
          <Box flexShrink={0} marginLeft={1}>
            <Text color="gray">{pos}</Text>
          </Box>
        ) : null}
      </Box>
      <Text color="gray" wrap="truncate-end">
        {turnLine(group, st, lang, now, manyProjects)}
      </Text>
      {chips ? <Chips lines={chips.lines} hidden={chips.hidden} current={card.id} /> : null}
      <Text wrap="truncate-start">
        <Text color="cyan" bold>
          {file}
        </Text>
        <Text color="gray">
          {'  '}
          {kind} <Text color="green">+{stats.add}</Text> <Text color="red">-{stats.del}</Text>
        </Text>
      </Text>
      <Box flexDirection="column" height={view}>
        {shownRows.map((r, k) => {
          if (r.type === 'hunk')
            return (
              <Text key={k} color="cyan" dimColor wrap="truncate-end">
                {r.text}
              </Text>
            );
          if (r.type === 'sep')
            return (
              <Text key={k} color="cyan" wrap="truncate-end">
                {t(lang, 'rv_part', { n: r.no ?? 0 })}
              </Text>
            );
          const color = r.type === 'add' ? 'green' : r.type === 'del' ? 'red' : undefined;
          const sign = r.cont ? ' ' : r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
          const no = r.no !== undefined ? String(r.no).padStart(4) : '    ';
          return (
            <Text key={k} wrap="truncate-end">
              <Text color="gray">{no} </Text>
              <Text color={color} dimColor={r.type === 'ctx'}>
                {sign} {r.text}
              </Text>
            </Text>
          );
        })}
      </Box>
      {line.value !== null ? (
        <InputLine prompt={t(lang, 'rv_note')} value={line.value} />
      ) : (
        <Text color="gray">{below > 0 ? t(lang, 'rv_more', { n: below }) : ' '}</Text>
      )}
    </Box>
  );
}
