import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  CARDS,
  ENEMIES,
  FLOORS,
  RELICS,
  REST_HEAL,
  chooseReward,
  endTurn,
  incoming,
  newRun,
  playCard,
  type Intent,
  type PlayResult,
} from '../game/engine.js';
import { settleRun } from '../game/meta.js';
import { ECON } from '../engine/economy.js';
import type { State } from '../engine/state.js';
import { t, type Lang } from '../i18n.js';
import { Bar, type ModeProps } from './common.js';

function intentText(it: Intent, lang: Lang): string {
  switch (it.kind) {
    case 'attack':
      return t(lang, 'gm_atk', { d: it.times > 1 ? `${it.dmg}×${it.times}` : it.dmg });
    case 'block':
      return t(lang, 'gm_blk', { a: it.amt });
    case 'recurse':
      return t(lang, 'gm_rec', { b: it.block });
    default:
      return t(lang, 'gm_myst');
  }
}

export function Game({ st, update, cfg, lang, active, width, height }: ModeProps) {
  const [screen, setScreen] = useState<'main' | 'shop'>('main');
  const [msg, setMsg] = useState('');
  const run = st.game;

  const act = (fn: (s: State) => void) =>
    update((s) => {
      const before = s.game?.phase ?? null;
      fn(s);
      settleRun(s, before);
    });

  const startRun = () => {
    if (st.energy < cfg.runCost) {
      setMsg(t(lang, 'gm_poor'));
      return;
    }
    act((s) => {
      s.energy -= cfg.runCost;
      s.game = newRun((Date.now() ^ Math.imul(s.totals.runs + 1, 2654435761)) >>> 0, s.relics);
      s.totals.runs++;
    });
    setMsg('');
  };

  const buy = (n: number) => {
    const r = RELICS[n];
    if (!r) return;
    if (st.relics.includes(r.id)) return setMsg(t(lang, 'gm_have'));
    if (st.coins < r.price) return setMsg(t(lang, 'gm_poor_coins'));
    update((s) => {
      s.coins -= r.price;
      s.relics.push(r.id);
    });
    setMsg(t(lang, 'gm_bought', { n: r.name[lang] }));
  };

  useInput(
    (input, key) => {
      if (screen === 'shop') {
        if (input === 'b' || key.escape) {
          setScreen('main');
          setMsg('');
        } else if (/^[1-9]$/.test(input)) buy(Number(input) - 1);
        return;
      }
      if (run?.phase === 'battle') {
        if (input === 'e') {
          act((s) => endTurn(s.game!, s.relics));
          setMsg('');
        } else if (/^[1-9]$/.test(input)) {
          let res = { ok: true } as PlayResult;
          act((s) => {
            res = playCard(s.game!, Number(input) - 1, s.relics);
          });
          setMsg(res.ok ? '' : res.reason[lang]);
        }
        return;
      }
      if (run?.phase === 'reward') {
        const n = Number(input);
        if (n >= 1 && n <= (run.reward?.length ?? 0) + 1) act((s) => void chooseReward(s.game!, n - 1, s.relics));
        return;
      }
      if (input === 'n') startRun();
      else if (input === 's') {
        setScreen('shop');
        setMsg('');
      }
    },
    { isActive: active },
  );

  const title = (
    <Text>
      <Text bold color="magenta">
        {t(lang, 'gm_title')}
      </Text>
      {run && (run.phase === 'battle' || run.phase === 'reward') ? (
        <Text color="gray"> · {t(lang, 'gm_floor', { f: run.floor, n: FLOORS })}</Text>
      ) : null}
      <Text color="gray">
        {'   '}⚡{st.energy} 💰{st.coins}
      </Text>
    </Text>
  );
  const msgLine = <Text color="yellow">{msg || ' '}</Text>;

  // ---------------------------------------------------------------- shop
  if (screen === 'shop') {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{t(lang, 'gm_shop_title')}</Text>
          <Text color="gray"> 💰{st.coins}</Text>
        </Text>
        <Text> </Text>
        {RELICS.map((r, i) => {
          const owned = st.relics.includes(r.id);
          return (
            <Box key={r.id}>
              <Box width={4}>
                <Text color="cyan">{i + 1}</Text>
              </Box>
              <Box width={lang === 'zh' ? 14 : 30}>
                <Text bold={!owned} dimColor={owned}>
                  {r.name[lang]}
                </Text>
              </Box>
              <Box width={8}>
                <Text color={st.coins >= r.price ? 'yellow' : 'gray'}>{r.price}💰</Text>
              </Box>
              <Text dimColor={owned} wrap="truncate-end">
                {r.desc[lang]}
                {owned ? `  [${t(lang, 'gm_have')}]` : ''}
              </Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text color="gray" wrap="wrap">
          {t(lang, 'gm_shop_hint')}
        </Text>
        <Text color="gray">{t(lang, 'gm_back')}</Text>
        {msgLine}
      </Box>
    );
  }

  // ---------------------------------------------------------------- battle
  if (run?.phase === 'battle' && run.battle) {
    const b = run.battle;
    const e = b.enemy;
    const def = ENEMIES[e.id];
    const inc = incoming(run);
    const logRoom = Math.max(1, height - 13 - b.hand.length);
    const boxW = Math.min(width - 2, 72);
    return (
      <Box flexDirection="column">
        {title}
        <Box flexDirection="column" borderStyle="round" borderColor={def.boss ? 'magenta' : 'red'} paddingX={1} width={boxW}>
          <Text wrap="truncate-end">
            <Text bold color={def.boss ? 'magenta' : 'red'}>
              {def.name[lang]}
            </Text>
            {'  '}HP {e.hp}/{e.maxHp} <Bar value={e.hp} max={e.maxHp} width={12} color="red" />
            {e.block ? <Text color="blue"> {t(lang, 'gm_block')} {e.block}</Text> : null}
            {e.vuln ? <Text color="yellow"> {t(lang, 'gm_vuln', { n: e.vuln })}</Text> : null}
            {e.weak ? <Text color="yellow"> {t(lang, 'gm_weak', { n: e.weak })}</Text> : null}
          </Text>
          <Text wrap="truncate-end">
            <Text color="gray">{t(lang, 'gm_intent')}: </Text>
            <Text bold>{intentText(e.intent, lang)}</Text>
            <Text color="gray">
              {'   '}
              {def.trait[lang]}
            </Text>
          </Text>
        </Box>
        <Text wrap="truncate-end">
          <Text bold>{t(lang, 'gm_you')}</Text> HP {run.hp}/{run.maxHp} <Bar value={run.hp} max={run.maxHp} width={12} color="green" />
          <Text color="blue">
            {' '}
            {t(lang, 'gm_block')} {b.block}
          </Text>
          <Text color="cyan"> {'◆'.repeat(b.focus)}</Text>
          <Text color="gray">{'◇'.repeat(Math.max(0, 3 - b.focus))}</Text>
          {b.double ? <Text color="yellow"> ×2</Text> : null}
          {b.observed ? <Text color="gray"> [{lang === 'zh' ? '已观测' : 'observed'}]</Text> : null}
          {'  '}
          {inc === null ? null : inc > 0 ? <Text color="red">{t(lang, 'gm_incoming', { n: inc })}</Text> : <Text color="green">{t(lang, 'gm_safe')}</Text>}
        </Text>
        <Text color="gray">{t(lang, 'gm_hand')}</Text>
        {b.hand.map((id, i) => {
          const c = CARDS[id];
          const can = !c.unplayable && c.cost <= b.focus;
          return (
            <Box key={i}>
              <Box width={4}>
                <Text color={can ? 'cyan' : 'gray'}>{i + 1}</Text>
              </Box>
              <Box width={lang === 'zh' ? 14 : 20}>
                <Text bold={can} dimColor={!can}>
                  {c.name[lang]}
                </Text>
              </Box>
              <Box width={5}>
                <Text color={can ? 'cyan' : 'gray'}>{c.unplayable ? '-' : `${c.cost}◆`}</Text>
              </Box>
              <Text dimColor={!can} wrap="truncate-end">
                {c.desc[lang]}
              </Text>
            </Box>
          );
        })}
        <Box flexDirection="column" marginTop={1}>
          {run.log.slice(-logRoom).map((m, i) => (
            <Text key={i} color="gray" wrap="truncate-end">
              · {m[lang]}
            </Text>
          ))}
        </Box>
        <Text color="gray">{t(lang, 'gm_keys')}</Text>
        {msgLine}
      </Box>
    );
  }

  // ---------------------------------------------------------------- reward
  if (run?.phase === 'reward' && run.reward) {
    return (
      <Box flexDirection="column">
        {title}
        <Text> </Text>
        <Text color="green">{run.log[run.log.length - 1]?.[lang]}</Text>
        <Text bold>{t(lang, 'gm_reward')}</Text>
        {run.reward.map((id, i) => {
          const c = CARDS[id];
          return (
            <Box key={id}>
              <Box width={4}>
                <Text color="cyan">{i + 1}</Text>
              </Box>
              <Box width={lang === 'zh' ? 14 : 20}>
                <Text bold color={c.rarity === 'rare' ? 'yellow' : undefined}>
                  {c.name[lang]}
                </Text>
              </Box>
              <Box width={5}>
                <Text color="cyan">{c.cost}◆</Text>
              </Box>
              <Text wrap="truncate-end">{c.desc[lang]}</Text>
            </Box>
          );
        })}
        <Text>
          <Text color="cyan">{t(lang, 'gm_rest', { k: String(run.reward.length + 1).padEnd(3), n: REST_HEAL })}</Text>
          <Text color="gray">
            {'   '}❤ {run.hp}/{run.maxHp}
          </Text>
        </Text>
        {msgLine}
      </Box>
    );
  }

  // ---------------------------------------------------------------- menu / result
  const owned = st.relics.map((id) => RELICS.find((r) => r.id === id)?.name[lang]).filter(Boolean);
  return (
    <Box flexDirection="column">
      {title}
      <Text> </Text>
      {run?.phase === 'dead' ? <Text color="red">{t(lang, 'gm_dead', { f: run.floor })}</Text> : null}
      {run?.phase === 'victory' ? <Text color="green">{t(lang, 'gm_victory', { e: ECON.winEnergy })}</Text> : null}
      {!run ? (
        <>
          <Text wrap="wrap">{t(lang, 'gm_intro')}</Text>
          <Text color="gray" wrap="wrap">
            {t(lang, 'gm_intro2')}
          </Text>
        </>
      ) : null}
      <Text> </Text>
      <Text color="gray">{owned.length ? t(lang, 'gm_owned', { list: owned.join(lang === 'zh' ? '、' : ', ') }) : t(lang, 'gm_owned_none')}</Text>
      <Text color="gray">{t(lang, 'gm_record', { w: st.totals.wins, f: st.totals.bestFloor, r: st.totals.runs })}</Text>
      <Text> </Text>
      <Text>
        <Text color={st.energy >= cfg.runCost ? 'cyan' : 'gray'} bold>
          {t(lang, 'gm_new', { c: cfg.runCost })}
        </Text>
        <Text color="gray">{'   '}</Text>
        <Text color="cyan">{t(lang, 'gm_shop')}</Text>
      </Text>
      {msgLine}
    </Box>
  );
}
