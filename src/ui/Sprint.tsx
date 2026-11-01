import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ECON } from '../engine/economy.js';
import { track } from '../engine/progress.js';
import {
  SNIPPETS,
  accuracy,
  backspace,
  charStates,
  currentLine,
  isPersonalBest,
  linesFromChanges,
  newSprint,
  progress,
  result,
  typeChar,
  wpm,
  type Sprint as SprintRun,
} from '../game/sprint.js';
import { t } from '../i18n.js';
import { Para, useHint, type ModeProps } from './common.js';

type Done = { wpm: number; acc: number; best: boolean; prevBest: number; source: SprintRun['source'] };

/**
 * Code Sprint. While a round is on, every key belongs to it (the panel's own shortcuts are
 * paused), and the round lives in a ref: saving the whole panel state on each keystroke would
 * be wasteful, so it is written back when you pause or finish.
 */
export function Sprint({ st, update, lang, active, blocked, width, setTyping, setHint, onExit }: ModeProps & { onExit: () => void }) {
  const resume = st.sprint && !st.sprint.done ? (st.sprint as SprintRun) : null;
  const ref = useRef<SprintRun | null>(resume);
  const [, render] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const [msg, setMsg] = useState('');
  const sp = ref.current;

  // A round in progress owns the keyboard.
  useEffect(() => {
    setTyping(!!sp && !sp.done);
  }, [!!sp && !sp.done]);

  // Leaving mid-round (pause) keeps the round for later.
  const save = () => {
    const cur = ref.current;
    update((s) => {
      s.sprint = cur && !cur.done ? cur : null;
    });
  };
  useEffect(
    () => () => {
      setTyping(false);
    },
    [],
  );

  const start = () => {
    if (st.energy < ECON.sprintCost) return setMsg(t(lang, 'gm_poor_any'));
    const fresh = linesFromChanges(st.review, 20);
    const fromChanges = fresh.length >= 3;
    const seed = (Date.now() ^ Math.imul(st.totals.sprints + 11, 2654435761)) >>> 0;
    ref.current = newSprint(seed, fromChanges ? fresh : SNIPPETS, 5, fromChanges ? 'changes' : 'builtin');
    update((s) => {
      s.energy -= ECON.sprintCost;
      s.sprint = ref.current;
    });
    // Right away, not after the next render: a key typed in between must not reach the panel
    // (a `q` would quit it).
    setTyping(true);
    setDone(null);
    setMsg('');
    render((x) => x + 1);
  };

  const finish = (run: SprintRun) => {
    const r = result(run);
    const prev = st.best.wpm;
    const best = isPersonalBest(prev, run);
    update((s) => {
      s.sprint = null;
      s.totals.sprints++;
      track(s, 'sprint');
      if (best) s.best.wpm = r.wpm;
    });
    ref.current = null;
    setDone({ wpm: r.wpm, acc: r.accuracy, best, prevBest: prev, source: run.source });
    setTyping(false);
  };

  useInput(
    (input, key) => {
      if (blocked()) return;
      const run = ref.current;
      if (run && !run.done) {
        if (key.escape) {
          save();
          setTyping(false);
          return onExit();
        }
        const now = Date.now();
        if (key.backspace || key.delete) backspace(run, now);
        else if (input && !key.ctrl && !key.meta) typeChar(run, input, now);
        if (run.done) finish(run);
        render((x) => x + 1);
        return;
      }
      if (key.escape) return onExit();
      if (key.return) start();
    },
    { isActive: active },
  );

  const hint = sp && !sp.done ? t(lang, 'sp_keys') : t(lang, 'gm_back_hub');
  useHint(setHint, hint, active);

  const w = width - 1;
  const title = (
    <Text wrap="truncate-end">
      <Text bold color="magenta">
        {t(lang, 'sp_title')}
      </Text>
      {sp && !sp.done ? <Text color="gray"> · {t(lang, 'sp_line', { i: progress(sp).line, n: progress(sp).of })}</Text> : null}
    </Text>
  );

  // ---------------------------------------------------------------- typing
  if (sp && !sp.done) {
    const line = currentLine(sp);
    const states = charStates(sp);
    const cells = states.map((s, i) => ({ ch: i < line.length ? line[i] : sp.typed[i] ?? ' ', s }));
    const cursor = sp.typed.length;
    const rowW = Math.max(20, w - 2);
    const rows: { ch: string; s: string; i: number }[][] = [];
    for (let i = 0; i <= Math.max(cells.length, cursor); i += rowW) rows.push([]);
    const all = [...cells, ...(cursor >= cells.length ? [{ ch: ' ', s: 'todo' }] : [])];
    all.forEach((c, i) => rows[Math.floor(i / rowW)]?.push({ ...c, i }));
    const next = sp.lines[sp.i + 1];
    // What you typed, under the line: the difference is visible even without colors.
    const typedRows: { ch: string; ok: boolean }[][] = [];
    Array.from(sp.typed).forEach((ch, i) => {
      (typedRows[Math.floor(i / rowW)] ??= []).push({ ch, ok: states[i] === 'ok' });
    });
    const live = wpm(sp);
    return (
      <Box flexDirection="column">
        {title}
        <Text color="gray">{t(lang, sp.source === 'changes' ? 'sp_from_changes' : 'sp_from_builtin')}</Text>
        <Text> </Text>
        {rows.map((row, r) => (
          <Text key={r}>
            {'  '}
            {row.map(({ ch, s, i }) => (
              <Text
                key={i}
                color={s === 'ok' ? 'green' : s === 'bad' ? 'white' : undefined}
                backgroundColor={s === 'bad' ? 'red' : undefined}
                bold={s === 'todo'}
                underline={i === cursor}
              >
                {ch}
              </Text>
            ))}
          </Text>
        ))}
        {(typedRows.length ? typedRows : [[]]).map((row, r) => (
          <Text key={`t${r}`}>
            {'  '}
            {row.map(({ ch, ok }, i) => (
              <Text key={i} color={ok ? 'gray' : 'red'}>
                {ch}
              </Text>
            ))}
            {r === typedRows.length - 1 || !typedRows.length ? <Text color="cyan">▏</Text> : null}
          </Text>
        ))}
        <Text> </Text>
        {next ? (
          <Text color="gray" dimColor wrap="truncate-end">
            {'  '}
            {next}
          </Text>
        ) : (
          <Text> </Text>
        )}
        <Text> </Text>
        <Text color="gray">
          {live ? t(lang, 'sp_result', { wpm: live, acc: `${Math.round(accuracy(sp) * 100)}%` }) : t(lang, 'sp_acc', { acc: `${Math.round(accuracy(sp) * 100)}%` })}
        </Text>
      </Box>
    );
  }

  // ---------------------------------------------------------------- result / intro
  return (
    <Box flexDirection="column">
      {title}
      <Text> </Text>
      {done ? (
        <>
          <Text bold color="green">
            {t(lang, 'sp_result', { wpm: done.wpm, acc: `${Math.round(done.acc * 100)}%` })}
          </Text>
          <Text color={done.best ? 'yellow' : 'gray'}>{done.best ? t(lang, 'sp_best') : t(lang, 'sp_best_was', { n: done.prevBest })}</Text>
          <Text color="gray">{t(lang, done.source === 'changes' ? 'sp_from_changes' : 'sp_from_builtin')}</Text>
        </>
      ) : (
        <>
          <Para text={t(lang, 'sp_intro')} width={w} />
          {st.best.wpm ? <Text color="gray">{t(lang, 'sp_best_was', { n: st.best.wpm })}</Text> : null}
        </>
      )}
      <Text> </Text>
      <Text bold color={st.energy >= ECON.sprintCost ? 'cyan' : 'gray'}>
        {t(lang, done ? 'sp_start_again' : 'sp_start', { c: ECON.sprintCost })}
      </Text>
      <Text> </Text>
      {msg ? <Para text={msg} width={w} color="yellow" /> : null}
    </Box>
  );
}
