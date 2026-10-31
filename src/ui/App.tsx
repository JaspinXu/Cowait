import React, { useEffect, useRef, useState } from 'react';
import path from 'node:path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { Config } from '../config.js';
import { saveConfig } from '../config.js';
import { applyEvents, sweep, type Signal } from '../engine/reducer.js';
import { busySessions, pendingCards, recordNote, waitingNotes, type State } from '../engine/state.js';
import { readNewEvents, rotateIfLarge, saveState } from '../engine/store.js';
import { chooseMode, predictWait, MODES, type Mode } from '../engine/predict.js';
import { addNote } from '../feedback.js';
import { normPath } from '../paths.js';
import { t, fmtDur, helpContent, type Lang } from '../i18n.js';
import { Review } from './Review.js';
import { Learn } from './Learn.js';
import { Game } from './Game.js';
import { InputLine, Para, fit, newNoteId, useLine } from './common.js';

type Alert = { kind: 'done' | 'attention'; text: string; sub?: string };
type Toast = { text: string; color: string };

/** Changes folded from the event log are written to disk at most this often (the log can replay them). */
const SAVE_EVERY_MS = 3000;
const TOAST_MS = 4000;
/** Events older than this are history being caught up on (panel restarted): fold them in silently. */
const STALE_MS = 15_000;

export interface AppProps {
  cfg: Config;
  lang: Lang;
  initial: State;
  daily: number;
  /** Poll interval for new hook events. */
  pollMs?: number;
  /** Nothing is hooked up yet: show how to connect Cowait to Claude Code. */
  setupHint?: boolean;
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

/** Where a free-form note should go: the session Claude is working in now, else the last active one. */
function noteTarget(s: State): { sid?: string; cwd?: string; dir?: string } {
  const all = Object.entries(s.sessions);
  if (!all.length) return {};
  const [sid, pick] = [...all].sort(([, a], [, b]) => Number(b.status !== 'idle') - Number(a.status !== 'idle') || b.lastAt - a.lastAt)[0];
  const many = new Set(all.map(([, x]) => normPath(x.cwd))).size > 1;
  return { sid, cwd: pick.cwd || undefined, dir: many && pick.cwd ? path.basename(pick.cwd) : undefined };
}

const inFight = (m: Mode, s: State) => m === 'game' && (s.game?.phase === 'battle' || s.game?.phase === 'reward');

function Help({ lang, width }: { lang: Lang; width: number }) {
  const h = helpContent(lang);
  const keyW = lang === 'zh' ? 9 : 11;
  return (
    <Box flexDirection="column" width={width}>
      <Para text={h.intro} width={width} />
      {h.sections.map((sec) => (
        <Box key={sec.title} flexDirection="column" marginTop={1}>
          <Text bold>{sec.title}</Text>
          {sec.rows.map(([k, d]) => (
            <Box key={k}>
              <Box width={keyW} flexShrink={0}>
                <Text color="cyan">{k}</Text>
              </Box>
              <Para text={d} width={width - keyW} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function App({ cfg: initialCfg, lang, initial, daily, pollMs = 400, setupHint = false }: AppProps) {
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
  const [alert, setAlert] = useState<Alert | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [help, setHelp] = useState(false);
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  typingRef.current = typing;
  // Update the ref immediately so keys arriving before the next render see it.
  const setTypingNow = (v: boolean) => {
    typingRef.current = v;
    setTyping(v);
  };
  const note = useLine();
  const lastSweep = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // State on disk: user actions are saved at once; changes folded from the event log are batched,
  // since a crash just replays them from the log (the saved offset only moves with them).
  const dirty = useRef(false);
  const lastSave = useRef(0);
  const persist = (s: State) => {
    saveState(s);
    dirty.current = false;
    lastSave.current = Date.now();
  };
  const commit = (s: State, lazy = false) => {
    ref.current = s;
    setSt(s);
    if (lazy) dirty.current = true;
    else persist(s);
  };
  const update = (fn: (s: State) => void) => {
    const s = structuredClone(ref.current);
    fn(s);
    commit(s);
  };

  const showToast = (text: string, color = 'green') => {
    setToast({ text, color });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const ring = () => {
    if (cfg.bell) process.stdout.write('\x07');
  };

  const onSignals = (sigs: Signal[], s: State) => {
    let m = modeRef.current;
    const go = (next: Mode) => {
      m = next;
      modeRef.current = next;
      setMode(next);
    };
    for (const sig of sigs) {
      // No bells, alerts or tab switches for things that happened while the panel was closed.
      if (Date.now() - sig.t > STALE_MS) continue;
      if (sig.type === 'turn_start') {
        // You answered in Claude Code, so the "finished" alert has done its job.
        setAlert(null);
        if (autoRef.current && !typingRef.current && !inFight(m, s)) go(chooseMode(s, cfg, predictWait(s.history, sig.cwd)));
      } else if (sig.type === 'new_card') {
        // Review first: fresh changes pull you to the review tab, unless you are mid-fight or typing.
        if (autoRef.current && !typingRef.current && m !== 'review' && !inFight(m, s)) go('review');
      } else if (sig.type === 'turn_done') {
        const dir = sig.cwd ? path.basename(sig.cwd) : '';
        const multi = Object.keys(s.sessions).length > 1;
        const waiting = pendingCards(s).length;
        const sub = [sig.coins > 0 ? t(lang, 'done_coins', { n: sig.coins }) : t(lang, 'done_none')];
        if (sig.pass) sub.push(t(lang, 'done_pass'));
        else if (sig.fail) sub.push(t(lang, 'done_fail'));
        if (waiting) sub.push(t(lang, 'done_pending', { n: waiting }));
        setAlert({
          kind: 'done',
          text:
            t(lang, 'done', { t: fmtDur(sig.ms) }) +
            (sig.edits ? t(lang, sig.edits === 1 ? 'done_edit1' : 'done_edits', { n: sig.edits }) : '') +
            (multi && dir ? t(lang, 'done_cwd', { dir }) : ''),
          sub: sub.join(' · '),
        });
        ring();
      } else if (sig.type === 'attention') {
        setAlert({ kind: 'attention', text: t(lang, 'attention', { msg: sig.msg }) });
        ring();
      } else if (sig.type === 'delivered') {
        showToast(sig.count > 1 ? t(lang, 'delivered_n', { n: sig.count }) : t(lang, 'delivered_one'));
      }
    }
  };

  useEffect(() => {
    if (daily > 0) showToast(t(lang, 'daily', { n: daily }), 'cyan');
    return () => clearTimeout(toastTimer.current);
  }, []);

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
      let rotated = false;
      if (busySessions(base).length === 0) {
        const r = rotateIfLarge(base.offset);
        if (r.rotated) {
          rotated = true;
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
      // After a rotation the old log is gone and cannot be replayed: save right away.
      if (s) commit(s, !rotated);
      if (dirty.current && t0 - lastSave.current >= SAVE_EVERY_MS) persist(ref.current);
      if (sigs.length) onSignals(sigs, s ?? cur);
      // Second granularity: React skips the re-render when the value has not changed.
      setNow(Math.floor(t0 / 1000) * 1000);
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      clearInterval(id);
      if (dirty.current) persist(ref.current);
    };
  }, []);

  // Auto mode: once the review queue is cleared, move on to something else.
  const pending = pendingCards(st).length;
  const prevPending = useRef(pending);
  useEffect(() => {
    const was = prevPending.current;
    prevPending.current = pending;
    if (auto && mode === 'review' && was > 0 && pending === 0 && !typing) {
      // Only if you are still on the review tab by then: never override a tab you picked yourself.
      const id = setTimeout(() => {
        if (modeRef.current !== 'review' || typingRef.current) return;
        const next = chooseMode(ref.current, cfg, predictWait(ref.current.history));
        modeRef.current = next;
        setMode(next);
      }, 1500);
      return () => clearTimeout(id);
    }
  }, [pending]);

  const sendNote = (raw: string) => {
    setTypingNow(false);
    const text = raw.trim();
    if (!text) return;
    const s = ref.current;
    const { sid, cwd } = noteTarget(s);
    const id = newNoteId();
    const at = Date.now();
    addNote({ id, t: at, text, cwd, sid });
    update((x) => recordNote(x, { id, t: at, text, cwd }));
    showToast(t(lang, busySessions(s).length ? 'note_sent_busy' : 'note_sent_idle'), 'yellow');
  };

  useInput((input, key) => {
    // The note box owns every key while it is open, even if an alert pops up mid-sentence.
    if (note.isOpen()) {
      note.handle(input, key, sendNote, () => setTypingNow(false));
      return;
    }
    // A mode's own text box (review note, learn topic) is open: the keys are its.
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
    } else if (input === 'm') {
      if (!cfg.feedback) showToast(t(lang, 'note_off'), 'yellow');
      else {
        note.open();
        setTypingNow(true);
      }
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
    const eta = predictWait(st.history, w.cwd, elapsed);
    const usual = eta ?? predictWait(st.history, w.cwd);
    statusEl = (
      <Text>
        <Text color="green">● {t(lang, 'st_busy')}</Text> <Text bold>{fmtDur(elapsed)}</Text>
        {eta ? <Text color="gray"> / {t(lang, 'eta', { t: fmtDur(eta) })}</Text> : usual ? <Text color="gray"> / {t(lang, 'st_longer')}</Text> : null}
        {working.length > 1 ? <Text color="gray">{t(lang, 'st_more', { n: working.length })}</Text> : null}
      </Text>
    );
  } else if (Object.keys(st.sessions).length) {
    statusEl = <Text color="gray">○ {t(lang, 'st_idle')}</Text>;
  } else {
    statusEl = <Text color="gray">○ {t(lang, 'st_none')}</Text>;
  }
  const notesWaiting = waitingNotes(st).length;

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
  const noteOpen = note.value !== null;
  const alertLines = alert ? 4 : 0;
  const footerLines = noteOpen ? 2 : 1;
  // 3 header lines, the footer, and one spare row so the terminal never scrolls.
  const bodyH = Math.max(6, rows - 4 - footerLines - alertLines);
  const modeProps = {
    st,
    update,
    cfg,
    lang,
    active: !help && !noteOpen && (!alert || typing),
    blocked: note.isOpen,
    width,
    height: bodyH,
    now,
    busy: working.length > 0 || !!attention,
    setTyping: setTypingNow,
    setupHint: setupHint && st.offset === 0 && Object.keys(st.sessions).length === 0,
  };

  const target = noteOpen ? noteTarget(st) : {};
  const onOff = t(lang, auto ? 'on' : 'off');
  const rule = '─'.repeat(Math.max(10, width - 1));
  return (
    <Box flexDirection="column" width={width}>
      <Box width={width - 1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color="cyan">
              {t(lang, 'brand')}
            </Text>
            {'  '}
            {statusEl}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text>
            {notesWaiting ? <Text color="yellow">✎{notesWaiting} </Text> : null}
            <Text color="yellow">⚡{st.energy}</Text> <Text color="yellow">💰{st.coins}</Text>
          </Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" width={width - 1}>
        <Box>{tabs}</Box>
        <Text color={auto ? 'green' : 'gray'}>
          {t(lang, 'auto')} {auto ? '✓' : '✗'}
        </Text>
      </Box>
      <Text color="gray">{rule}</Text>
      {alert ? (
        <Box borderStyle="round" borderColor={alert.kind === 'done' ? 'green' : 'yellow'} paddingX={1} width={Math.min(width - 1, 80)} flexDirection="column">
          <Text bold color={alert.kind === 'done' ? 'green' : 'yellow'} wrap="truncate-end">
            {alert.text}
          </Text>
          <Text color="gray" wrap="truncate-end">
            {alert.sub ? `${alert.sub} · ` : ''}
            {t(lang, 'anykey')}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" height={bodyH} overflow="hidden">
        {/* flexShrink 0: content taller than the pane is clipped at the bottom, never squeezed line by line. */}
        <Box flexDirection="column" flexShrink={0}>
          {help ? (
            <Help lang={lang} width={width - 1} />
          ) : mode === 'review' ? (
            <Review {...modeProps} />
          ) : mode === 'game' ? (
            <Game {...modeProps} />
          ) : (
            <Learn {...modeProps} />
          )}
        </Box>
      </Box>
      {noteOpen ? (
        <>
          <InputLine prompt={target.dir ? t(lang, 'note_prompt_to', { dir: target.dir }) : t(lang, 'note_prompt')} value={note.value ?? ''} />
          <Text color="gray">{t(lang, 'note_hint')}</Text>
        </>
      ) : toast ? (
        <Text color={toast.color} wrap="truncate-end">
          {toast.text}
        </Text>
      ) : help ? (
        <Text color="gray" wrap="truncate-end">
          {t(lang, 'help_close')}
        </Text>
      ) : (
        <Text color="gray" wrap="truncate-end">
          {fit([t(lang, 'footer', { on: onOff }), t(lang, 'footer_short', { on: onOff })], width - 1)}
        </Text>
      )}
    </Box>
  );
}
