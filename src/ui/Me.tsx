import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ACHIEVEMENTS, weekKey, weekStats } from '../engine/progress.js';
import { localDay } from '../engine/state.js';
import type { Config } from '../config.js';
import { CHECKOUT, PRICES, licensingConfigured } from '../product.js';
import { loadLicense, maskKey } from '../license.js';
import { openUrl } from '../open.js';
import { t, pct, type Key } from '../i18n.js';
import { Para, padTo, useHint, useRefState, type ModeProps } from './common.js';
import { Today } from './Today.js';

type Screen = 'main' | 'achievements' | 'settings' | 'pro';

type Toggle = { key: keyof Config; label: Key; value: (c: Config) => string; next: (c: Config) => Config };

export function Me(props: ModeProps) {
  const { st, cfg, lang, active, blocked, width, height, now, setHint, setCfg, plan, toast } = props;
  const [screen, setScreen, screenRef] = useRefState<Screen>('main');
  const [cursor, setCursor] = useState(0);
  const [scroll, setScroll] = useState(0);

  const onOff = (v: boolean) => t(lang, v ? 'on' : 'off');
  const toggles: Toggle[] = [
    { key: 'lang', label: 'set_lang', value: () => t(lang, 'set_lang_v'), next: (c) => ({ ...c, lang: lang === 'zh' ? 'en' : 'zh' }) },
    { key: 'bell', label: 'set_bell', value: (c) => onOff(c.bell), next: (c) => ({ ...c, bell: !c.bell }) },
    { key: 'autoMode', label: 'set_auto', value: (c) => onOff(c.autoMode), next: (c) => ({ ...c, autoMode: !c.autoMode }) },
    { key: 'feedback', label: 'set_feedback', value: (c) => onOff(c.feedback), next: (c) => ({ ...c, feedback: !c.feedback }) },
    { key: 'promptTitles', label: 'set_titles', value: (c) => onOff(c.promptTitles), next: (c) => ({ ...c, promptTitles: !c.promptTitles }) },
    { key: 'updateCheck', label: 'set_update', value: (c) => onOff(c.updateCheck), next: (c) => ({ ...c, updateCheck: !c.updateCheck }) },
  ];

  const open = (s: Screen) => {
    setScreen(s);
    setCursor(0);
    setScroll(0);
  };

  const achRows = Math.max(3, height - 2);
  const unlocked = ACHIEVEMENTS.filter((a) => st.achievements[a.id]);

  useInput(
    (input, key) => {
      if (blocked()) return;
      const sc = screenRef.current;
      if (sc !== 'main' && (key.escape || input === 'b')) return open('main');
      if (sc === 'main') {
        if (input === 'c') open('achievements');
        else if (input === 's') open('settings');
        else if (input === 'u') open('pro');
      } else if (sc === 'settings') {
        if (key.upArrow || input === 'k') setCursor((c) => (c + toggles.length - 1) % toggles.length);
        else if (key.downArrow || input === 'j') setCursor((c) => (c + 1) % toggles.length);
        else if (key.return || input === ' ') setCfg(toggles[cursor].next(cfg));
      } else if (sc === 'achievements') {
        const max = Math.max(0, ACHIEVEMENTS.length - Math.floor(achRows / 2));
        if (key.downArrow || input === 'j') setScroll((x) => Math.min(max, x + 1));
        else if (key.upArrow || input === 'k') setScroll((x) => Math.max(0, x - 1));
      } else if (sc === 'pro') {
        if (key.return && plan === 'free' && CHECKOUT.pro) {
          toast(openUrl(CHECKOUT.pro) ? t(lang, 'pro_opened') : CHECKOUT.pro, 'cyan');
        }
      }
    },
    { isActive: active },
  );

  const hint =
    screen === 'main'
      ? t(lang, 'me_keys')
      : screen === 'settings'
        ? t(lang, 'set_keys')
        : screen === 'achievements'
          ? t(lang, 'ach_keys')
          : plan === 'free' && CHECKOUT.pro
            ? `${t(lang, 'pro_buy')} · ${t(lang, 'me_back')}`
            : t(lang, 'me_back');
  useHint(setHint, hint, active);

  const w = width - 1;

  // ---------------------------------------------------------------- settings
  if (screen === 'settings') {
    const labelW = Math.min(30, Math.max(16, w - 14));
    return (
      <Box flexDirection="column">
        <Text bold>{t(lang, 'set_title')}</Text>
        <Text> </Text>
        {toggles.map((x, i) => {
          const on = i === cursor;
          return (
            <Text key={x.key} wrap="truncate-end">
              <Text color="cyan">{on ? '▸ ' : '  '}</Text>
              <Text bold={on}>{padTo(t(lang, x.label), labelW)}</Text>
              <Text color={on ? 'cyan' : 'gray'}>{x.value(cfg)}</Text>
            </Text>
          );
        })}
      </Box>
    );
  }

  // ---------------------------------------------------------------- achievements
  if (screen === 'achievements') {
    const shown = ACHIEVEMENTS.slice(scroll, scroll + Math.floor(achRows / 2));
    return (
      <Box flexDirection="column">
        <Text bold>{t(lang, 'ach_title', { n: unlocked.length, m: ACHIEVEMENTS.length })}</Text>
        {shown.map((a) => {
          const got = !!st.achievements[a.id];
          return (
            <Box key={a.id} flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={got ? 'yellow' : 'gray'}>{got ? '🏆 ' : '·  '}</Text>
                <Text bold={got} color={got ? undefined : 'gray'}>
                  {a.name[lang]}
                </Text>
              </Text>
              <Text color="gray" wrap="truncate-end">
                {'   '}
                {a.desc[lang]}
                {got ? `  ${localDay(st.achievements[a.id])}` : ''}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  // ---------------------------------------------------------------- pro
  if (screen === 'pro') {
    const planName = t(lang, plan === 'team' ? 'me_plan_team' : plan === 'pro' ? 'me_plan_pro' : 'me_plan_free');
    const lic = plan !== 'free' ? loadLicense() : null;
    return (
      <Box flexDirection="column">
        <Text bold color="magenta">
          {t(lang, 'pro_title')}
        </Text>
        <Text color="gray">{t(lang, 'pro_current', { plan: planName })}</Text>
        <Text> </Text>
        {plan === 'free' ? (
          <>
            <Para text={t(lang, 'pro_pitch')} width={w} />
            {(['pro_f1', 'pro_f2', 'pro_f3', 'pro_f4'] as Key[]).map((k) => (
              <Para key={k} text={`  ✦ ${t(lang, k)}`} width={w} color="gray" />
            ))}
            <Text> </Text>
            {licensingConfigured() ? (
              <>
                <Text color="cyan">{t(lang, 'pro_price', { c: PRICES.currency, m: PRICES.pro.monthly, y: PRICES.pro.yearly })}</Text>
                <Para text={t(lang, 'pro_activate')} width={w} color="gray" />
              </>
            ) : (
              <Para text={t(lang, 'pro_soon')} width={w} color="green" />
            )}
          </>
        ) : (
          <>
            <Text color="green">{t(lang, 'pro_thanks')}</Text>
            {lic ? <Text color="gray">{t(lang, 'pro_key', { k: maskKey(lic.key) })}</Text> : null}
          </>
        )}
      </Box>
    );
  }

  // ---------------------------------------------------------------- main
  const r = weekStats(st, weekKey(now));
  const latest = [...unlocked].sort((a, b) => st.achievements[b.id] - st.achievements[a.id])[0];
  const planName = t(lang, plan === 'team' ? 'me_plan_team' : plan === 'pro' ? 'me_plan_pro' : 'me_plan_free');
  return (
    <Box flexDirection="column">
      <Today st={st} lang={lang} width={w} now={now} />
      <Text> </Text>
      <Text color="gray" wrap="truncate-end">
        {r.files > 0 ? t(lang, 'me_week', { t: r.turns, p: pct(r.coverage) }) : t(lang, 'me_week_none')}
      </Text>
      <Text wrap="truncate-end">
        <Text>{t(lang, 'me_ach', { n: unlocked.length, m: ACHIEVEMENTS.length })}</Text>
        {latest ? <Text color="gray"> · {t(lang, 'me_ach_recent', { name: latest.name[lang] })}</Text> : null}
      </Text>
      <Text wrap="truncate-end">
        <Text color={plan === 'free' ? 'gray' : 'magenta'}>{t(lang, 'me_plan_line', { plan: planName })}</Text>
      </Text>
    </Box>
  );
}
