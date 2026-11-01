import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Arcade } from '../engine/state.js';
import { localDay } from '../engine/state.js';
import { ECON } from '../engine/economy.js';
import { FLOORS } from '../game/engine.js';
import { puzzleNumber } from '../game/stack.js';
import { t, type Key } from '../i18n.js';
import { useHint, type ModeProps } from './common.js';
import { Dungeon } from './Dungeon.js';
import { Puzzle } from './Puzzle.js';
import { Sprint } from './Sprint.js';

const GAMES: { id: Arcade; name: Key; desc: Key }[] = [
  { id: 'dungeon', name: 'gd_name', desc: 'gd_desc' },
  { id: 'puzzle', name: 'gp_name', desc: 'gp_desc' },
  { id: 'sprint', name: 'gs_name', desc: 'gs_desc' },
];

/** The Play tab: a short list of games built for waiting, each one key per step. */
export function Game(props: ModeProps) {
  const { st, update, cfg, lang, active, blocked, width, now, setHint } = props;
  const [cursor, setCursor] = useState(() => Math.max(0, GAMES.findIndex((g) => g.id === st.arcade)));
  const arcade = st.arcade;

  const openGame = (id: Arcade | null) =>
    update((s) => {
      s.arcade = id;
    });

  useInput(
    (input, key) => {
      if (blocked() || arcade) return;
      if (/^[1-3]$/.test(input)) return openGame(GAMES[Number(input) - 1].id);
      if (key.upArrow || input === 'k') setCursor((c) => (c + GAMES.length - 1) % GAMES.length);
      else if (key.downArrow || input === 'j') setCursor((c) => (c + 1) % GAMES.length);
      else if (key.return) openGame(GAMES[cursor].id);
    },
    { isActive: active && !arcade },
  );

  useHint(setHint, t(lang, 'gm_hub_keys'), active && !arcade);

  const exit = () => openGame(null);
  if (arcade === 'dungeon') return <Dungeon {...props} onExit={exit} />;
  if (arcade === 'puzzle') return <Puzzle {...props} onExit={exit} />;
  if (arcade === 'sprint') return <Sprint {...props} onExit={exit} />;

  // What each game is up to right now: the line that makes you want to go back in.
  const today = localDay(now);
  const status = (id: Arcade): [string, string] => {
    if (id === 'dungeon') {
      const g = st.game;
      if (g && (g.phase === 'battle' || g.phase === 'reward')) return [t(lang, 'gm_floor', { f: g.floor, n: FLOORS }), 'yellow'];
      return [t(lang, 'gm_cost', { n: cfg.runCost }), st.energy >= cfg.runCost ? 'cyan' : 'gray'];
    }
    if (id === 'puzzle') {
      const stars = st.days[today]?.puzzle ?? 0;
      const no = `#${puzzleNumber(today)}`;
      return stars ? [`${no} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, 'green'] : [`${no} ${t(lang, 'gm_free_daily')}`, 'yellow'];
    }
    return [st.best.wpm ? `${st.best.wpm} WPM` : t(lang, 'gm_cost', { n: ECON.sprintCost }), st.best.wpm ? 'gray' : 'cyan'];
  };

  const w = width - 1;
  const puzzleDays = Object.values(st.days).filter((d) => d.puzzle > 0).length;
  const records = [
    st.totals.wins ? t(lang, 'gm_rec_wins', { n: st.totals.wins }) : '',
    puzzleDays ? t(lang, 'gm_rec_puzzle', { n: puzzleDays }) : '',
    st.best.wpm ? t(lang, 'gm_rec_wpm', { n: st.best.wpm }) : '',
  ].filter(Boolean);
  return (
    <Box flexDirection="column">
      <Text bold>{t(lang, 'gm_hub')}</Text>
      <Text> </Text>
      {GAMES.map((g, i) => {
        const on = i === cursor;
        const [right, color] = status(g.id);
        return (
          <Box key={g.id} flexDirection="column" marginBottom={1}>
            <Box width={w}>
              <Box flexGrow={1}>
                <Text wrap="truncate-end">
                  <Text color="cyan">{on ? '▸ ' : '  '}</Text>
                  <Text color="cyan">{i + 1} </Text>
                  <Text bold={on}>{t(lang, g.name)}</Text>
                </Text>
              </Box>
              <Text color={color}>{right}</Text>
            </Box>
            <Text color="gray" wrap="truncate-end">
              {'    '}
              {t(lang, g.desc)}
            </Text>
          </Box>
        );
      })}
      {records.length ? (
        <Text color="gray" wrap="truncate-end">
          {records.join(' · ')}
        </Text>
      ) : null}
    </Box>
  );
}
