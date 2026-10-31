import React, { useMemo, useRef, useState } from 'react';
import path from 'node:path';
import { Box, Text, useInput } from 'ink';
import { pendingCards, coverage } from '../engine/state.js';
import { applyVerdict } from '../engine/economy.js';
import { cardDiff, diffStats } from '../engine/diff.js';
import { addNote } from '../feedback.js';
import { t, fmtAgo } from '../i18n.js';
import { useLine, type ModeProps } from './common.js';

function rel(file: string, cwd: string): string {
  if (cwd && file.toLowerCase().startsWith(cwd.toLowerCase())) {
    const r = path.relative(cwd, file);
    if (r && !r.startsWith('..')) return r.replace(/\\/g, '/');
  }
  return file.replace(/\\/g, '/');
}

export function Review({ st, update, lang, active, width, height, now, busy, setTyping }: ModeProps) {
  const pending = pendingCards(st);
  const [idx, setIdx] = useState(0);
  const [scroll, setScroll] = useState(0);
  const line = useLine();
  const noteCard = useRef<{ id: string; file: string } | null>(null);
  const [flash, setFlash] = useState('');

  const i = Math.min(idx, Math.max(0, pending.length - 1));
  const card = pending[i];
  const lines = useMemo(() => (card ? cardDiff(card) : []), [card?.id]);
  const stats = diffStats(lines);
  const file = card ? rel(card.file, card.cwd) : '';

  // title + file line + blank + keys + flash/note line
  const view = Math.max(3, height - 5);
  const maxScroll = Math.max(0, lines.length - view);
  const sc = Math.min(scroll, maxScroll);

  const go = (d: number) => {
    setIdx((x) => Math.max(0, Math.min(pending.length - 1, Math.min(x, pending.length - 1) + d)));
    setScroll(0);
  };

  const verdict = (v: 'ok' | 'skip') => {
    if (!card) return;
    let gain = 0;
    update((s) => {
      gain = applyVerdict(s, card.id, v);
    });
    setFlash(v === 'ok' ? t(lang, 'rv_ok', { n: gain }) : t(lang, 'rv_skip'));
    setScroll(0);
  };

  const submitNote = (raw: string) => {
    const text = raw.trim();
    const target = noteCard.current;
    setTyping(false);
    if (!target || !text) return;
    const noteId = Math.random().toString(36).slice(2, 10);
    addNote({ id: noteId, t: Date.now(), text, file: target.file, cardId: target.id });
    let gain = 0;
    update((s) => {
      gain = applyVerdict(s, target.id, 'flag', text, noteId);
    });
    setFlash(t(lang, busy ? 'rv_queued_busy' : 'rv_queued_idle', { n: gain }));
    setScroll(0);
  };

  useInput(
    (input, key) => {
      if (line.isOpen()) {
        line.handle(input, key, submitNote, () => setTyping(false));
        return;
      }
      if (!card) return;
      if (input === 'y') verdict('ok');
      else if (input === 's') verdict('skip');
      else if (input === 'n') {
        noteCard.current = { id: card.id, file };
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
    <Text>
      <Text bold>{t(lang, 'rv_title')}</Text>
      <Text color="gray">
        {'  '}
        {t(lang, 'rv_pending', { n: pending.length })}
        {cov !== null ? ' · ' + t(lang, 'rv_cov', { p: `${Math.round(cov * 100)}%` }) : ''}
        {st.totals.delivered ? ' · ' + t(lang, 'rv_relayed', { n: st.totals.delivered }) : ''}
      </Text>
    </Text>
  );

  if (!card) {
    return (
      <Box flexDirection="column">
        {head}
        <Text> </Text>
        <Text color="green">{t(lang, 'rv_empty')}</Text>
        <Text color="gray" wrap="wrap">
          {t(lang, 'rv_empty_hint')}
        </Text>
        <Text> </Text>
        {st.totals.cards > 0 && <Text color="cyan">{t(lang, 'rv_empty_play', { e: st.energy })}</Text>}
        {flash ? <Text color="yellow">{flash}</Text> : null}
      </Box>
    );
  }

  const shown = lines.slice(sc, sc + view);
  const textW = Math.max(10, width - 8);
  return (
    <Box flexDirection="column">
      {head}
      <Text wrap="truncate-end">
        <Text color="cyan" bold>
          {file}
        </Text>
        <Text color="gray">
          {'  '}
          {card.created ? t(lang, 'rv_new_file') + ' · ' : ''}
          {card.kind} · <Text color="green">+{stats.add}</Text> <Text color="red">-{stats.del}</Text> · {t(lang, 'rv_ago', { t: fmtAgo(now - card.t, lang) })} · [{i + 1}/
          {pending.length}]
        </Text>
      </Text>
      <Box flexDirection="column" height={view}>
        {shown.map((d, k) => {
          const no = d.no !== undefined ? String(d.no).padStart(4) : '    ';
          const body = d.text.replace(/\t/g, '  ').slice(0, textW);
          if (d.type === 'hunk')
            return (
              <Text key={k} color="cyan" dimColor wrap="truncate-end">
                {d.text}
              </Text>
            );
          const color = d.type === 'add' ? 'green' : d.type === 'del' ? 'red' : undefined;
          const sign = d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ';
          return (
            <Text key={k} wrap="truncate-end">
              <Text color="gray">{no} </Text>
              <Text color={color} dimColor={d.type === 'ctx'}>
                {sign} {body}
              </Text>
            </Text>
          );
        })}
      </Box>
      <Text color="gray">{lines.length > sc + view ? t(lang, 'rv_more', { n: lines.length - sc - view }) : ' '}</Text>
      {line.value !== null ? (
        <Text>
          <Text color="yellow">{t(lang, 'rv_note')}</Text>
          <Text>{line.value}</Text>
          <Text inverse> </Text>
          <Text color="gray">
            {'   '}
            {t(lang, 'rv_note_hint')}
          </Text>
        </Text>
      ) : (
        <Text wrap="truncate-end">
          {flash ? <Text color="yellow">{flash} · </Text> : null}
          <Text color="gray">{t(lang, 'rv_keys')}</Text>
        </Text>
      )}
    </Box>
  );
}
