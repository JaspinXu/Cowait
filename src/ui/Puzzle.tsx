import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ECON } from '../engine/economy.js';
import { track, unlock } from '../engine/progress.js';
import { localDay, type State } from '../engine/state.js';
import {
  dailyPuzzle,
  generatePuzzle,
  hint,
  newPuzzleRun,
  press,
  puzzleNumber,
  reset,
  shareText,
  stars,
  undo,
  type Difficulty,
  type PuzzleRun,
} from '../game/stack.js';
import { t } from '../i18n.js';
import { Para, padTo, useHint, type ModeProps } from './common.js';

const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
const stackText = (xs: number[]) => (xs.length ? `[ ${xs.join('  ')} ]` : '[ ]');

/** Stack Puzzle: one daily puzzle for everyone, plus practice puzzles. */
export function Puzzle({ st, update, lang, active, blocked, width, now, setHint, onExit }: ModeProps & { onExit: () => void }) {
  const [msg, setMsg] = useState<{ text: string; color: string } | null>(null);
  const today = localDay(now);
  const run: PuzzleRun | null = st.puzzle;
  const day = st.days[today];
  const dailyStars = day?.puzzle ?? 0;
  // A finished or stale run is not "in progress": show the menu.
  const live = run && !run.solved && (run.mode === 'practice' || run.day === today) ? run : null;
  const justSolved = run?.solved && (run.mode === 'practice' || run.day === today) ? run : null;

  const act = (fn: (r: PuzzleRun, s: State) => void) =>
    update((s) => {
      const r = s.puzzle as PuzzleRun | null;
      if (!r) return;
      const was = r.solved;
      fn(r, s);
      if (!was && r.solved) {
        const n = stars(r.puzzle, r.prog.length, r.hints);
        s.totals.puzzles++;
        if (r.mode === 'daily' && r.day === localDay(Date.now())) track(s, 'puzzle', Date.now(), n);
        else track(s, 'practice');
        if (n === 3) unlock(s, 'puzzle_perfect');
      }
    });

  const startDaily = () => {
    if (dailyStars) return setMsg({ text: t(lang, 'pz_daily_done', { stars: starText(dailyStars) }), color: 'green' });
    update((s) => {
      const r = s.puzzle as PuzzleRun | null;
      if (!(r && r.mode === 'daily' && r.day === today && !r.solved)) s.puzzle = newPuzzleRun(dailyPuzzle(today), 'daily', Date.now(), today);
    });
    setMsg(null);
  };

  const startPractice = () => {
    if (st.energy < ECON.practiceCost) return setMsg({ text: t(lang, 'gm_poor_any'), color: 'yellow' });
    // Practice follows your level: the more you have solved, the harder it gets.
    const d = (Math.min(3, 1 + Math.floor(st.totals.puzzles / 4)) as Difficulty) || 1;
    update((s) => {
      s.energy -= ECON.practiceCost;
      s.puzzle = newPuzzleRun(generatePuzzle((Date.now() ^ Math.imul(s.totals.puzzles + 7, 2654435761)) >>> 0, d), 'practice', Date.now());
    });
    setMsg(null);
  };

  useInput(
    (input, key) => {
      if (blocked()) return;
      if (key.escape) return onExit();
      if (live) {
        if (/^[1-9]$/.test(input)) {
          const i = Number(input) - 1;
          if (i >= live.puzzle.buttons.length) return;
          act((r) => void press(r, i));
          setMsg(null);
        } else if (key.backspace || key.delete) {
          act((r) => void undo(r));
          setMsg(null);
        } else if (input === 'r') {
          act((r) => void reset(r));
          setMsg(null);
        } else if (input === 'h') {
          let b: number | null = null;
          act((r) => {
            b = hint(r);
          });
          setMsg(
            b === null
              ? { text: t(lang, 'pz_no_hint'), color: 'yellow' }
              : { text: t(lang, 'pz_hint', { b: `${b + 1} (${live.puzzle.buttons[b].label})` }), color: 'cyan' },
          );
        }
        return;
      }
      if (key.return) startDaily();
      else if (input === 'p') startPractice();
    },
    { isActive: active },
  );

  const hintText = live ? t(lang, 'pz_keys') : justSolved ? t(lang, 'pz_done_keys') : `${t(lang, 'pz_menu_daily')} · ${t(lang, 'gm_back_hub')}`;
  useHint(setHint, hintText, active);

  const w = width - 1;
  const title = (r: PuzzleRun | null) => (
    <Box width={w}>
      <Box flexGrow={1}>
        <Text wrap="truncate-end">
          <Text bold color="magenta">
            {t(lang, 'pz_title')}
          </Text>
          <Text color="gray"> · {r?.mode === 'practice' ? t(lang, 'pz_practice') : t(lang, 'pz_daily', { n: puzzleNumber(today) })}</Text>
        </Text>
      </Box>
      {r ? <Text color="gray">{t(lang, 'pz_level', { n: r.puzzle.difficulty })}</Text> : null}
    </Box>
  );
  const msgLine = msg ? <Para text={msg.text} width={w} color={msg.color} /> : <Text> </Text>;

  // ---------------------------------------------------------------- playing
  if (live) {
    const p = live.puzzle;
    const labelW = lang === 'zh' ? 6 : 8;
    return (
      <Box flexDirection="column">
        {title(live)}
        <Text> </Text>
        <Text>
          <Text color="gray">{padTo(t(lang, 'pz_goal'), labelW)}</Text>
          <Text bold color="green">
            {stackText(p.target)}
          </Text>
        </Text>
        <Text>
          <Text color="gray">{padTo(t(lang, 'pz_stack'), labelW)}</Text>
          <Text bold color="cyan">
            {stackText(live.stack)}
          </Text>
          <Text color="gray"> {t(lang, 'pz_top')}</Text>
        </Text>
        <Text color="gray" wrap="truncate-end">
          {padTo('', labelW)}
          {live.prog.map((i) => p.buttons[i]?.label).join('  ') || ' '}
        </Text>
        <Text color="gray">
          {padTo('', labelW)}
          {t(lang, 'pz_steps', { n: live.prog.length, p: p.par })}
        </Text>
        <Text> </Text>
        {p.buttons.map((b, i) => (
          <Text key={b.id} wrap="truncate-end">
            <Text color="cyan">{` ${i + 1}  `}</Text>
            <Text bold>{padTo(b.label, 8)}</Text>
            <Text color="gray">{b.desc[lang]}</Text>
          </Text>
        ))}
        <Text> </Text>
        {live.error ? <Para text={live.error[lang]} width={w} color="red" /> : msgLine}
      </Box>
    );
  }

  // ---------------------------------------------------------------- just solved
  if (justSolved) {
    const n = stars(justSolved.puzzle, justSolved.prog.length, justSolved.hints);
    return (
      <Box flexDirection="column">
        {title(justSolved)}
        <Text> </Text>
        <Text bold color="green">
          {t(lang, 'pz_solved', { stars: starText(n), n: justSolved.prog.length })}
        </Text>
        <Text color="gray">{stackText(justSolved.puzzle.start) + '  →  ' + stackText(justSolved.puzzle.target)}</Text>
        <Text> </Text>
        <Para text={t(lang, 'pz_share', { s: shareText(justSolved, lang) })} width={w} color="cyan" />
        <Text> </Text>
        <Text color="gray">{t(lang, 'pz_menu_practice', { c: `${ECON.practiceCost}⚡` })}</Text>
        {msgLine}
      </Box>
    );
  }

  // ---------------------------------------------------------------- menu
  return (
    <Box flexDirection="column">
      {title(null)}
      <Text> </Text>
      <Para text={t(lang, 'pz_intro')} width={w} />
      <Text> </Text>
      {dailyStars ? (
        <Para text={t(lang, 'pz_daily_done', { stars: starText(dailyStars) })} width={w} color="green" />
      ) : (
        <Text bold color="cyan">
          {t(lang, 'pz_menu_daily')}
        </Text>
      )}
      <Text color="cyan">{t(lang, 'pz_menu_practice', { c: `${ECON.practiceCost}⚡` })}</Text>
      <Text> </Text>
      {msgLine}
    </Box>
  );
}
