import React, { useMemo, useRef, useState } from 'react';
import path from 'node:path';
import { Box, Text, useInput } from 'ink';
import { pendingCards, coverage, recordNote } from '../engine/state.js';
import { applyVerdict, isSkim } from '../engine/economy.js';
import { cardDiff, diffRows, diffStats } from '../engine/diff.js';
import { addNote } from '../feedback.js';
import { normPath } from '../paths.js';
import { t, fmtAgo, type Key } from '../i18n.js';
import { InputLine, Para, fit, newNoteId, useLine, type ModeProps } from './common.js';

/**
 * When each card's current content first appeared on screen. Kept outside the component so the
 * clock survives the review tab being swapped out (help screen, a look at another tab).
 */
const firstSeen = new Map<string, number>();
function seenSince(key: string): number {
  let at = firstSeen.get(key);
  if (at === undefined) {
    at = Date.now();
    firstSeen.set(key, at);
    if (firstSeen.size > 500) firstSeen.delete(firstSeen.keys().next().value!);
  }
  return at;
}

function rel(file: string, cwd: string): string {
  if (cwd && file.toLowerCase().startsWith(cwd.toLowerCase())) {
    const r = path.relative(cwd, file);
    if (r && !r.startsWith('..')) return r.replace(/\\/g, '/');
  }
  return file.replace(/\\/g, '/');
}

export function Review({ st, update, lang, active, blocked, width, height, now, busy, setTyping, setupHint }: ModeProps) {
  const pending = pendingCards(st);
  const [idx, setIdx] = useState(0);
  const [scroll, setScroll] = useState(0);
  const line = useLine();
  const noteCard = useRef<{ id: string; file: string; cwd: string; sid: string } | null>(null);
  const [flash, setFlash] = useState('');

  const i = Math.min(idx, Math.max(0, pending.length - 1));
  const card = pending[i];
  const parts = card ? 1 + (card.more?.length ?? 0) : 0;
  // When did this content first appear on screen? An edit folded into the card restarts the clock.
  const contentKey = card ? `${card.id}:${parts}` : '';
  if (card) seenSince(contentKey);

  const lines = useMemo(() => (card ? cardDiff(card) : []), [contentKey]);
  const stats = diffStats(lines);
  const textW = Math.max(10, width - 8);
  const rows = useMemo(() => diffRows(lines, textW), [lines, textW]);
  const file = card ? rel(card.file, card.cwd) : '';
  const manyProjects = new Set(pending.map((c) => normPath(c.cwd))).size > 1;

  // title + file line on top; "more" line + keys (or the note box) at the bottom
  const view = Math.max(3, height - 4);
  const maxScroll = Math.max(0, rows.length - view);
  const sc = Math.min(scroll, maxScroll);

  const go = (d: number) => {
    setIdx((x) => Math.max(0, Math.min(pending.length - 1, Math.min(x, pending.length - 1) + d)));
    setScroll(0);
  };

  // After a long session the queue can hold dozens of cards. S twice clears it, counted as skipped
  // (not reviewed), so coverage stays honest. One S only asks; any other key forgets the request.
  const skipAllAsked = useRef(0);
  const skipAll = () => {
    if (Date.now() - skipAllAsked.current > 4000) {
      skipAllAsked.current = Date.now();
      setFlash(t(lang, 'rv_skip_all_ask', { n: pending.length }));
      return;
    }
    skipAllAsked.current = 0;
    const ids = pending.map((c) => c.id);
    update((s) => {
      for (const id of ids) applyVerdict(s, id, 'skip');
    });
    setFlash(t(lang, 'rv_skip_all_done', { n: ids.length }));
    setScroll(0);
  };

  const verdict = (v: 'ok' | 'skip') => {
    if (!card) return;
    const quick = v === 'ok' && isSkim(stats.add + stats.del, Date.now() - seenSince(contentKey));
    let gain = 0;
    update((s) => {
      gain = applyVerdict(s, card.id, v, { quick });
    });
    setFlash(v === 'skip' ? t(lang, 'rv_skip') : quick ? t(lang, 'rv_skim') : t(lang, 'rv_ok', { n: gain }));
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
    update((s) => {
      gain = applyVerdict(s, target.id, 'flag', { note: text, noteId });
      recordNote(s, { id: noteId, t: at, text, file: target.file, cwd });
    });
    setFlash(t(lang, busy ? 'rv_queued_busy' : 'rv_queued_idle', { n: gain }));
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
      else if (input === 's') verdict('skip');
      else if (input === 'n') {
        noteCard.current = { id: card.id, file, cwd: card.cwd, sid: card.sid };
        line.open();
        setTyping(true);
        setFlash('');
      } else if (key.rightArrow || input === 'l') go(1);
      else if (key.leftArrow || input === 'h') go(-1);
      else if (key.downArrow || input === 'j') setScroll(Math.min(maxScroll, sc + 1));
      else if (key.upArrow || input === 'k') setScroll(Math.max(0, sc - 1));
      else if (key.pageDown || input === ' ') setScroll(Math.min(maxScroll, sc + view));
      else if (key.pageUp) setScroll(Math.max(0, sc - view));
    },
    { isActive: active },
  );

  const cov = coverage(st);
  const head = (
    <Text wrap="truncate-end">
      <Text bold>{t(lang, 'rv_title')}</Text>
      <Text color="gray">
        {'  '}
        {t(lang, 'rv_pending', { n: pending.length })}
        {cov !== null ? ' · ' + t(lang, 'rv_cov', { p: `${Math.round(cov * 100)}%` }) : ''}
        {st.totals.delivered ? ' · ' + t(lang, 'rv_relayed', { n: st.totals.delivered }) : ''}
      </Text>
    </Text>
  );

  const paraW = width - 1;
  if (!card) {
    return (
      <Box flexDirection="column">
        {head}
        <Text> </Text>
        {setupHint ? (
          <>
            <Para text={t(lang, 'rv_setup')} width={paraW} color="yellow" />
            <Para text={t(lang, 'rv_setup_cmd')} width={paraW} />
            <Para text={t(lang, 'rv_setup_then')} width={paraW} color="gray" />
          </>
        ) : (
          <>
            <Text color="green">{t(lang, 'rv_empty')}</Text>
            <Para text={t(lang, 'rv_empty_hint')} width={paraW} color="gray" />
          </>
        )}
        <Text> </Text>
        {st.totals.cards > 0 && <Para text={t(lang, 'rv_empty_play', { e: st.energy })} width={paraW} color="cyan" />}
        {flash ? <Para text={flash} width={paraW} color="yellow" /> : null}
      </Box>
    );
  }

  const kind = parts > 1 ? t(lang, 'rv_parts', { n: parts }) : card.created ? t(lang, 'rv_new_file') : t(lang, `kind_${card.kind}` as Key);
  const shownRows = rows.slice(sc, sc + view);
  const below = rows.length - sc - view;
  return (
    <Box flexDirection="column">
      {head}
      <Text wrap="truncate-end">
        {manyProjects ? <Text color="gray">{path.basename(card.cwd)} › </Text> : null}
        <Text color="cyan" bold>
          {file}
        </Text>
        <Text color="gray">
          {'  '}
          {kind} · <Text color="green">+{stats.add}</Text> <Text color="red">-{stats.del}</Text> · {t(lang, 'rv_ago', { t: fmtAgo(now - (card.last ?? card.t), lang) })} · [{i + 1}/
          {pending.length}]
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
        <>
          <InputLine prompt={t(lang, 'rv_note')} value={line.value} />
          <Text color="gray">{t(lang, 'rv_note_hint')}</Text>
        </>
      ) : (
        <>
          <Text color="gray">{below > 0 ? t(lang, 'rv_more', { n: below }) : ' '}</Text>
          <Text wrap="truncate-end">
            {flash ? <Text color="yellow">{flash} · </Text> : null}
            <Text color="gray">{fit([t(lang, 'rv_keys'), t(lang, 'rv_keys_short')], width - 1)}</Text>
          </Text>
        </>
      )}
    </Box>
  );
}
