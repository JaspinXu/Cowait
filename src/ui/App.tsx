import React, { useEffect, useRef, useState } from 'react';
import path from 'node:path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { Config } from '../config.js';
import { saveConfig } from '../config.js';
import { applyEvents, sweep, type Signal } from '../engine/reducer.js';
import { busySessions, pendingCards, type State } from '../engine/state.js';
import { readNewEvents, rotateIfLarge, saveState } from '../engine/store.js';
import { chooseMode, predictWait, MODES, type Mode } from '../engine/predict.js';
import { t, fmtDur, type Lang } from '../i18n.js';
import { Review } from './Review.js';
import { Learn } from './Learn.js';
import { Game } from './Game.js';

type Alert = { kind: 'done' | 'attention' | 'info'; text: string; sub?: string };

export interface AppProps {
  cfg: Config;
  lang: Lang;
  initial: State;
  daily: number;
  /** Poll interval for new hook events. */
  pollMs?: number;
}

function useSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ cols: stdout.columns || 100, rows: stdout.rows || 30 });
  useEffect(() => {
    const on = () => setSize({ cols: stdout.columns || 100, rows: stdout.rows || 30 });
    stdout.on('resize', on);
    return () => {
      stdout.off('resize', on);
    };
  }, [stdout]);
  return size;
}

export function App({ cfg: initialCfg, lang, initial, daily, pollMs = 400 }: AppProps) {
  const { exit } = useApp();
  const { cols, rows } = useSize();
  const [cfg, setCfg] = useState(initialCfg);
  const [st, setSt] = useState(initial);
  const ref = useRef(initial);
  const [now, setNow] = useState(Date.now());
  const [mode, setMode] = useState<Mode>(() => chooseMode(initial, initialCfg, predictWait(initial.history)));
  const [auto, setAuto] = useState(initialCfg.autoMode);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const [alert, setAlert] = useState<Alert | null>(daily > 0 ? { kind: 'info', text: t(lang, 'daily', { n: daily }) } : null);
  const [help, setHelp] = useState(false);
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  typingRef.current = typing;
  // Update the ref immediately so keys arriving before the next render see it.
  const setTypingNow = (v: boolean) => {
    typingRef.current = v;
    setTyping(v);
  };
  const lastSweep = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const commit = (s: State) => {
    ref.current = s;
    saveState(s);
    setSt(s);
  };
  const update = (fn: (s: State) => void) => {
    const s = structuredClone(ref.current);
    fn(s);
    commit(s);
  };

  const ring = () => {
    if (cfg.bell) process.stdout.write('\x07');
  };

  const onSignals = (sigs: Signal[], s: State) => {
    let m = modeRef.current;
    const go = (next: Mode) => {
      m = next;
      setMode(next);
    };
    for (const sig of sigs) {
      if (sig.type === 'turn_start') {
        setAlert((a) => (a && a.kind !== 'info' ? null : a));
        if (autoRef.current && !typingRef.current) go(chooseMode(s, cfg, predictWait(s.history, sig.cwd)));
      } else if (sig.type === 'new_card') {
        // Review first: fresh changes pull you to the review tab, unless you are mid-fight or typing.
        const fighting = m === 'game' && (s.game?.phase === 'battle' || s.game?.phase === 'reward');
        if (autoRef.current && !typingRef.current && m !== 'review' && !fighting) go('review');
      } else if (sig.type === 'turn_done') {
        const dir = sig.cwd ? path.basename(sig.cwd) : '';
        const multi = Object.keys(s.sessions).length > 1;
        setAlert({
          kind: 'done',
          text: t(lang, 'done', { t: fmtDur(sig.ms) }) + (multi && dir ? t(lang, 'done_cwd', { dir }) : ''),
          sub: sig.coins > 0 ? `${t(lang, 'done_coins', { n: sig.coins })}${sig.pass ? ' · ' + t(lang, 'done_pass') : ''}` : t(lang, 'done_none'),
        });
        ring();
      } else if (sig.type === 'attention') {
        setAlert({ kind: 'attention', text: t(lang, 'attention', { msg: sig.msg }) });
        ring();
      }
    }
  };

  // Poll the event log the hook appends to.
  useEffect(() => {
    const tick = () => {
      const t0 = Date.now();
      const cur = ref.current;
      let s: State | null = null;
      let sigs: Signal[] = [];
      const { events, offset } = readNewEvents(cur.offset);
      if (events.length || offset !== cur.offset) {
        s = structuredClone(cur);
        s.offset = offset;
        sigs = applyEvents(s, events);
      }
      const base = s ?? cur;
      if (busySessions(base).length === 0) {
        const r = rotateIfLarge(base.offset);
        if (r.rotated) {
          s = s ?? structuredClone(cur);
          sigs = sigs.concat(applyEvents(s, r.events));
          s.offset = 0;
        }
      }
      if (t0 - lastSweep.current > 30_000) {
        lastSweep.current = t0;
        const target = s ?? structuredClone(cur);
        if (sweep(target, t0)) s = target;
      }
      if (s) commit(s);
      if (sigs.length) onSignals(sigs, s ?? cur);
      // Second granularity: React skips the re-render when the value has not changed.
      setNow(Math.floor(t0 / 1000) * 1000);
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => clearInterval(id);
  }, []);

  // Auto mode: once the review queue is cleared, move on to something else.
  const pending = pendingCards(st).length;
  const prevPending = useRef(pending);
  useEffect(() => {
    const was = prevPending.current;
    prevPending.current = pending;
    if (auto && mode === 'review' && was > 0 && pending === 0 && !typing) {
      const id = setTimeout(() => setMode(chooseMode(ref.current, cfg, predictWait(ref.current.history))), 1500);
      return () => clearTimeout(id);
    }
  }, [pending]);

  useInput((input, key) => {
    // While a note or topic is being typed, every key belongs to the text box:
    // an alert that pops up mid-sentence must not swallow a keystroke.
    if (typingRef.current) return;
    if (alert) {
      setAlert(null);
      return;
    }
    if (help) {
      setHelp(false);
      return;
    }
    if (key.tab) {
      const step = key.shift ? MODES.length - 1 : 1;
      setMode((m) => {
        const next = MODES[(MODES.indexOf(m) + step) % MODES.length];
        modeRef.current = next;
        return next;
      });
    } else if (input === 'a') {
      const next = !autoRef.current;
      autoRef.current = next;
      setAuto(next);
      const c = { ...cfg, autoMode: next };
      setCfg(c);
      saveConfig(c);
    } else if (input === '?') setHelp(true);
    else if (input === 'q') exit();
  });

  // ---------------------------------------------------------------- header
  const busy = busySessions(st);
  const attention = busy.find(([, x]) => x.status === 'attention');
  const working = busy.filter(([, x]) => x.status === 'busy').sort((a, b) => (b[1].turnStart ?? 0) - (a[1].turnStart ?? 0));
  let statusEl: React.ReactNode;
  if (attention) {
    statusEl = <Text color="yellow">⚠ {t(lang, 'st_attention')}</Text>;
  } else if (working.length) {
    const [, w] = working[0];
    const elapsed = now - (w.turnStart ?? now);
    const eta = predictWait(st.history, w.cwd);
    statusEl = (
      <Text>
        <Text color="green">● {t(lang, 'st_busy')}</Text> <Text bold>{fmtDur(elapsed)}</Text>
        {eta ? <Text color="gray"> / {t(lang, 'eta', { t: fmtDur(eta) })}</Text> : null}
        {working.length > 1 ? <Text color="gray">{t(lang, 'st_more', { n: working.length })}</Text> : null}
      </Text>
    );
  } else if (Object.keys(st.sessions).length) {
    statusEl = <Text color="gray">○ {t(lang, 'st_idle')}</Text>;
  } else {
    statusEl = <Text color="gray">○ {t(lang, 'st_none')}</Text>;
  }

  const tabs = MODES.map((m) => {
    const label = t(lang, m === 'review' ? 'mode_review' : m === 'game' ? 'mode_game' : 'mode_learn');
    const badge = m === 'review' && pending ? ` ${pending}` : '';
    const on = m === mode;
    return (
      <Text key={m} inverse={on} bold={on} color={on ? 'cyan' : 'gray'}>
        {` ${label}${badge} `}
      </Text>
    );
  });

  const width = Math.max(40, cols);
  const alertLines = alert ? 4 : 0;
  const bodyH = Math.max(6, rows - 5 - alertLines);
  const modeProps = {
    st,
    update,
    cfg,
    lang,
    active: !help && (!alert || typing),
    width,
    height: bodyH,
    now,
    busy: working.length > 0 || !!attention,
    setTyping: setTypingNow,
  };

  const rule = '─'.repeat(Math.max(10, width - 1));
  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between" width={width - 1}>
        <Text>
          <Text bold color="cyan">
            {t(lang, 'brand')}
          </Text>
          {'  '}
          {statusEl}
        </Text>
        <Text>
          <Text color="yellow">⚡{st.energy}</Text> <Text color="yellow">💰{st.coins}</Text>
        </Text>
      </Box>
      <Box justifyContent="space-between" width={width - 1}>
        <Box>{tabs}</Box>
        <Text color={auto ? 'green' : 'gray'}>
          {t(lang, 'auto')} {auto ? '✓' : '✗'}
        </Text>
      </Box>
      <Text color="gray">{rule}</Text>
      {alert ? (
        <Box borderStyle="round" borderColor={alert.kind === 'done' ? 'green' : alert.kind === 'attention' ? 'yellow' : 'cyan'} paddingX={1} width={Math.min(width - 1, 80)} flexDirection="column">
          <Text bold color={alert.kind === 'done' ? 'green' : alert.kind === 'attention' ? 'yellow' : 'cyan'} wrap="truncate-end">
            {alert.text}
          </Text>
          <Text color="gray" wrap="truncate-end">
            {alert.sub ? `${alert.sub} · ` : ''}
            {t(lang, 'anykey')}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" height={bodyH} overflow="hidden">
        {help ? (
          <Text wrap="wrap">{t(lang, 'help')}</Text>
        ) : mode === 'review' ? (
          <Review {...modeProps} />
        ) : mode === 'game' ? (
          <Game {...modeProps} />
        ) : (
          <Learn {...modeProps} />
        )}
      </Box>
      <Text color="gray" wrap="truncate-end">
        {t(lang, 'footer', { on: t(lang, auto ? 'on' : 'off') })}
      </Text>
    </Box>
  );
}
