import React, { useEffect, useRef, useState } from 'react';
import path from 'node:path';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { Config } from '../config.js';
import { saveConfig } from '../config.js';
import { applyEvents, sweep, type Signal } from '../engine/reducer.js';
import { busySessions, pendingCards, recordNote, turnByKey, waitingNotes, type State } from '../engine/state.js';
import { readNewEvents, rotateIfLarge, saveState } from '../engine/store.js';
import { chooseMode, predictWait, MODES, type Mode } from '../engine/predict.js';
import { ACHIEVEMENT_ENERGY, QUEST_ENERGY, recapDue, settleProgress, streak, track, weekKey, type ProgressEvent, type Recap } from '../engine/progress.js';
import { addNote } from '../feedback.js';
import { install, type Scope } from '../install.js';
import type { Plan } from '../license.js';
import { normPath } from '../paths.js';
import { t, fmtDur, helpContent, pct, type Lang } from '../i18n.js';
import { Review } from './Review.js';
import { Learn } from './Learn.js';
import { Game } from './Game.js';
import { Me } from './Me.js';
import { InputLine, Para, fit, newNoteId, useLine } from './common.js';

type Alert = { kind: 'done' | 'attention'; text: string; sub?: string; turn?: string };
type Toast = { text: string; color: string; kind: 'feedback' | 'reward' };
type Overlay = 'welcome' | 'recap' | 'help' | null;

/** Changes folded from the event log are written to disk at most this often (the log can replay them). */
const SAVE_EVERY_MS = 3000;
const FEEDBACK_MS = 2500;
const REWARD_MS = 3500;
/** Events older than this are history being caught up on (panel restarted): fold them in silently. */
const STALE_MS = 15_000;

export interface AppProps {
  cfg: Config;
  /** Language to use while the config says "auto". */
  lang: Lang;
  initial: State;
  daily: number;
  /** Poll interval for new hook events. */
  pollMs?: number;
  /** Nothing is hooked up yet: show how to connect Cowait to Claude Code. */
  setupHint?: boolean;
  plan?: Plan;
  /** The project folder the panel was opened in (where "hook up this project" writes). */
  cwd?: string;
  /** Resolves to a line announcing a newer version, if there is one. */
  checkUpdate?: () => Promise<{ version: string; command: string } | null>;
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

const inFight = (m: Mode, s: State) => m === 'game' && s.arcade === 'dungeon' && (s.game?.phase === 'battle' || s.game?.phase === 'reward');

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

function Welcome({ lang, width, hooked, cwd }: { lang: Lang; width: number; hooked: boolean; cwd: string }) {
  const rows: [string, string][] = [
    [t(lang, 'mode_review'), t(lang, 'wl_review')],
    [t(lang, 'mode_game'), t(lang, 'wl_game')],
    [t(lang, 'mode_learn'), t(lang, 'wl_learn')],
  ];
  const keyW = lang === 'zh' ? 6 : 8;
  const opt = (k: string, text: string, color?: string) => (
    <Box>
      <Box width={8} flexShrink={0}>
        <Text color="cyan" bold>
          {k}
        </Text>
      </Box>
      <Para text={text} width={width - 8} color={color} />
    </Box>
  );
  return (
    <Box flexDirection="column" width={width}>
      <Text bold color="cyan">
        {t(lang, 'wl_title')}
      </Text>
      <Text> </Text>
      <Para text={t(lang, 'wl_intro')} width={width} />
      {rows.map(([k, d]) => (
        <Box key={k} marginTop={1}>
          <Box width={keyW} flexShrink={0}>
            <Text bold>{k}</Text>
          </Box>
          <Para text={d} width={width - keyW} color="gray" />
        </Box>
      ))}
      <Text> </Text>
      {hooked ? (
        <>
          <Para text={t(lang, 'wl_ready')} width={width} color="green" />
          <Text> </Text>
          {opt('Enter', t(lang, 'wl_start'))}
        </>
      ) : (
        <>
          <Text bold color="yellow">
            {t(lang, 'wl_connect')}
          </Text>
          {opt('Enter', `${t(lang, 'wl_here')}  ${cwd}`)}
          {opt('g', t(lang, 'wl_global'), 'gray')}
          {opt('Esc', t(lang, 'wl_later'), 'gray')}
        </>
      )}
      {opt('L', t(lang, 'wl_lang'), 'gray')}
    </Box>
  );
}

function RecapView({ r, lang, width }: { r: Recap; lang: Lang; width: number }) {
  const md = (d: string) => d.slice(5).replace('-', '/');
  const end = new Date(Number(r.week.slice(0, 4)), Number(r.week.slice(5, 7)) - 1, Number(r.week.slice(8, 10)) + 6);
  const to = `${String(end.getMonth() + 1).padStart(2, '0')}/${String(end.getDate()).padStart(2, '0')}`;
  const verdict = r.files === 0 ? 'rc_none' : (r.coverage ?? 0) >= 0.8 ? 'rc_hi' : (r.coverage ?? 0) >= 0.5 ? 'rc_mid' : 'rc_lo';
  return (
    <Box flexDirection="column" width={width}>
      <Text bold color="cyan">
        {t(lang, 'rc_title', { from: md(r.week), to })}
      </Text>
      <Text> </Text>
      <Para text={t(lang, 'rc_turns', { n: r.turns, f: r.files })} width={width} />
      {r.files > 0 ? <Para text={t(lang, 'rc_read', { r: r.read, p: pct(r.coverage) })} width={width} color={(r.coverage ?? 0) >= 0.5 ? 'green' : 'yellow'} /> : null}
      <Para text={t(lang, 'rc_notes', { f: r.flagged, n: r.notes, l: r.learned })} width={width} />
      <Para text={t(lang, 'rc_days', { n: r.activeDays, xp: r.xp })} width={width} />
      <Text> </Text>
      <Para text={t(lang, verdict)} width={width} color="magenta" />
    </Box>
  );
}

export function App({ cfg: initialCfg, lang: autoLang, initial, daily, pollMs = 400, setupHint = false, plan = 'free', cwd = process.cwd(), checkUpdate }: AppProps) {
  const { exit } = useApp();
  const { cols, rows } = useSize();
  const [cfg, setCfgState] = useState(initialCfg);
  const lang: Lang = cfg.lang === 'zh' || cfg.lang === 'en' ? cfg.lang : autoLang;
  const [st, setSt] = useState(initial);
  const ref = useRef(initial);
  const [now, setNow] = useState(Date.now());
  const [mode, setMode] = useState<Mode>(() => chooseMode(initial, initialCfg, predictWait(initial.history)));
  const autoRef = useRef(initialCfg.autoMode);
  autoRef.current = cfg.autoMode;
  const [alert, setAlert] = useState<Alert | null>(null);
  const [toast, setToastState] = useState<Toast | null>(null);
  const toastRef = useRef<Toast | null>(null);
  const setToast = (x: Toast | null) => {
    toastRef.current = x;
    setToastState(x);
  };
  const toastQueue = useRef<Toast[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [recap] = useState<Recap | null>(() => (initial.onboarded ? recapDue(initial) : null));
  const [overlay, setOverlay] = useState<Overlay>(() => (!initial.onboarded ? 'welcome' : recap ? 'recap' : null));
  const [hooked, setHooked] = useState(!setupHint);
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  typingRef.current = typing;
  // Update the ref immediately so keys arriving before the next render see it.
  const setTypingNow = (v: boolean) => {
    typingRef.current = v;
    setTyping(v);
  };
  const [hint, setHint] = useState('');
  const [focusTurn, setFocusTurn] = useState<string | null>(null);
  const note = useLine();
  const lastSweep = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ---------------------------------------------------------------- toasts
  // Feedback (✓ +1⚡) replaces feedback right away; rewards (quests, achievements) queue up.
  const pump = () => {
    if (toastTimer.current) return;
    const next = toastQueue.current.shift();
    setToast(next ?? null);
    if (!next) return;
    toastTimer.current = setTimeout(
      () => {
        toastTimer.current = undefined;
        pump();
      },
      next.kind === 'reward' ? REWARD_MS : FEEDBACK_MS,
    );
  };
  const pushToast = (x: Toast) => {
    if (x.kind === 'feedback') {
      toastQueue.current = [x, ...toastQueue.current.filter((q) => q.kind !== 'feedback')];
      // Replace a feedback toast on screen at once; a reward toast finishes first.
      if (toastTimer.current && toastRef.current?.kind !== 'reward') {
        clearTimeout(toastTimer.current);
        toastTimer.current = undefined;
      }
    } else toastQueue.current.push(x);
    pump();
  };
  const showToast = (text: string, color = 'green') => pushToast({ text, color, kind: 'feedback' });
  const celebrate = (evs: ProgressEvent[]) => {
    for (const e of evs) {
      const text =
        e.type === 'quest'
          ? t(lang, 'quest_done', { q: e.label[lang], e: QUEST_ENERGY })
          : e.type === 'quests_all'
            ? t(lang, 'quests_all')
            : e.type === 'achievement'
              ? t(lang, 'achievement', { n: e.name[lang], e: ACHIEVEMENT_ENERGY })
              : t(lang, 'level_up', { l: e.level, t: e.title[lang] });
      pushToast({ text, color: e.type === 'level' ? 'magenta' : 'yellow', kind: 'reward' });
    }
  };

  // ---------------------------------------------------------------- state on disk
  // User actions are saved at once; changes folded from the event log are batched,
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
    const evs = settleProgress(s);
    commit(s);
    // After the caller's own feedback toast ("✓ +1⚡"), not before it.
    if (evs.length) setTimeout(() => celebrate(evs), 0);
  };

  const setCfg = (c: Config) => {
    autoRef.current = c.autoMode;
    setCfgState(c);
    saveConfig(c);
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
        // Review first: fresh changes pull you to the review tab, unless you are busy elsewhere.
        if (autoRef.current && !typingRef.current && m !== 'review' && m !== 'me' && !inFight(m, s)) go('review');
      } else if (sig.type === 'turn_done') {
        const dir = sig.cwd ? path.basename(sig.cwd) : '';
        const multi = Object.keys(s.sessions).length > 1;
        const files = turnByKey(s, sig.turn)?.files ?? 0;
        const waiting = pendingCards(s).filter((c) => c.turn === sig.turn).length;
        const sub = [sig.coins > 0 ? t(lang, 'done_coins', { n: sig.coins }) : t(lang, 'done_none')];
        if (sig.pass) sub.push(t(lang, 'done_pass'));
        else if (sig.fail) sub.push(t(lang, 'done_fail'));
        if (waiting) sub.push(t(lang, 'done_pending', { n: waiting }));
        setAlert({
          kind: 'done',
          text: t(lang, 'done', { t: fmtDur(sig.ms) }) + (files ? t(lang, files === 1 ? 'done_edit1' : 'done_edits', { n: files }) : '') + (multi && dir ? t(lang, 'done_cwd', { dir }) : ''),
          sub: sub.join(' · '),
          turn: waiting ? sig.turn : undefined,
        });
        ring();
      } else if (sig.type === 'attention') {
        setAlert({ kind: 'attention', text: t(lang, 'attention', { msg: sig.msg }) });
        ring();
      } else if (sig.type === 'delivered') {
        showToast(sig.count > 1 ? t(lang, 'delivered_n', { n: sig.count }) : t(lang, 'delivered_one'), 'cyan');
      }
    }
  };

  useEffect(() => {
    if (daily > 0) {
      const sk = streak(ref.current).days;
      showToast(sk > 0 ? t(lang, 'daily_streak', { n: daily, d: sk }) : t(lang, 'daily', { n: daily }), 'cyan');
    }
    // Quietly bring progress up to date (first run of this version, a new day).
    const s = structuredClone(ref.current);
    celebrate(settleProgress(s));
    commit(s);
    if (cfg.updateCheck && checkUpdate) {
      checkUpdate()
        .then((u) => {
          if (u) pushToast({ text: t(lang, 'update_avail', { v: u.version, cmd: u.command }), color: 'magenta', kind: 'reward' });
        })
        .catch(() => undefined);
    }
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
      let archived = 0;
      if (t0 - lastSweep.current > 30_000) {
        lastSweep.current = t0;
        const target = s ?? structuredClone(cur);
        const before = target.totals.expired;
        if (sweep(target, t0)) s = target;
        archived = target.totals.expired - before;
      }
      let evs: ProgressEvent[] = [];
      if (s) evs = settleProgress(s);
      // After a rotation the old log is gone and cannot be replayed: save right away.
      if (s) commit(s, !rotated && !archived);
      if (dirty.current && t0 - lastSave.current >= SAVE_EVERY_MS) persist(ref.current);
      if (sigs.length) onSignals(sigs, s ?? cur);
      if (archived) showToast(t(lang, 'expired', { n: archived }), 'gray');
      if (evs.length) celebrate(evs);
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
    if (cfg.autoMode && mode === 'review' && was > 0 && pending === 0 && !typing) {
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
    const { sid, cwd: noteCwd } = noteTarget(s);
    const id = newNoteId();
    const at = Date.now();
    addNote({ id, t: at, text, cwd: noteCwd, sid });
    update((x) => {
      recordNote(x, { id, t: at, text, cwd: noteCwd });
      // A note is useful work (XP), but energy is for notes about a specific change.
      track(x, 'note');
    });
    showToast(t(lang, busySessions(s).length ? 'note_sent_busy' : 'note_sent_idle'), 'cyan');
  };

  const hookUp = (scope: Scope) => {
    try {
      install({ scope, cwd });
      setHooked(true);
      showToast(t(lang, 'installed_ok'), 'green');
    } catch (e: any) {
      showToast(t(lang, 'install_failed', { e: String(e?.message ?? e).slice(0, 120) }), 'red');
    }
  };

  const finishWelcome = () => {
    update((s) => {
      s.onboarded = true;
    });
    setOverlay(recap ? 'recap' : null);
  };

  const closeRecap = () => {
    update((s) => {
      s.lastRecap = weekKey(Date.now());
    });
    setOverlay(null);
  };

  useInput((input, key) => {
    // The note box owns every key while it is open, even if an alert pops up mid-sentence.
    if (note.isOpen()) {
      note.handle(input, key, sendNote, () => setTypingNow(false));
      return;
    }
    // A mode's own text box or game (review note, topic, a sprint) is taking keys.
    if (typingRef.current) return;
    if (overlay === 'welcome') {
      if (input === 'L') setCfg({ ...cfg, lang: lang === 'zh' ? 'en' : 'zh' });
      else if (key.return) {
        if (!hooked) hookUp('project');
        finishWelcome();
      } else if (input === 'g' && !hooked) {
        hookUp('user');
        finishWelcome();
      } else if (key.escape) finishWelcome();
      return;
    }
    if (overlay === 'recap') return closeRecap();
    if (alert) {
      if (key.return && alert.turn) {
        setFocusTurn(alert.turn);
        modeRef.current = 'review';
        setMode('review');
      }
      setAlert(null);
      return;
    }
    if (overlay === 'help') {
      setOverlay(null);
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
    } else if (input === 'a') setCfg({ ...cfg, autoMode: !cfg.autoMode });
    else if (input === 'i' && !hooked) hookUp('project');
    else if (input === '?') setOverlay('help');
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
  const sk = streak(st, now);

  const tabs = MODES.map((m) => {
    const label = t(lang, m === 'review' ? 'mode_review' : m === 'game' ? 'mode_game' : m === 'learn' ? 'mode_learn' : 'mode_me');
    const badge = m === 'review' && pending ? ` ${pending}` : '';
    const on = m === mode && overlay !== 'help';
    return (
      <Text key={m} inverse={on} bold={on} color={on ? 'cyan' : m === 'review' && pending ? 'yellow' : 'gray'}>
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
  const showSetup = !hooked && st.offset === 0 && Object.keys(st.sessions).length === 0;
  const modeProps = {
    st,
    update,
    cfg,
    lang,
    active: overlay === null && !noteOpen && (!alert || typing),
    blocked: note.isOpen,
    width,
    height: bodyH,
    now,
    busy: working.length > 0 || !!attention,
    setTyping: setTypingNow,
    setupHint: showSetup,
    toast: showToast,
    setHint,
    setCfg,
    plan,
    focusTurn,
    clearFocus: () => setFocusTurn(null),
  };

  const target = noteOpen ? noteTarget(st) : {};
  const rule = '─'.repeat(Math.max(10, width - 1));
  const helpKey = t(lang, 'help_key');
  const footer =
    overlay === 'help'
      ? t(lang, 'help_close')
      : overlay === 'recap'
        ? t(lang, 'anykey')
        : overlay === 'welcome'
          ? ''
          : typing
            ? hint
            : fit([`${hint} · ${helpKey}`, hint], width - 1);
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
            {sk.days > 0 ? <Text color={sk.today ? 'yellow' : 'gray'}>🔥{sk.days} </Text> : null}
            <Text color="yellow">⚡{st.energy}</Text> <Text color="yellow">💰{st.coins}</Text>
          </Text>
        </Box>
      </Box>
      <Box justifyContent="space-between" width={width - 1}>
        <Box>{tabs}</Box>
        <Text color="gray">{cfg.autoMode ? <Text color="green">{t(lang, 'auto')} </Text> : null}Tab ⇄</Text>
      </Box>
      <Text color="gray">{rule}</Text>
      {alert ? (
        <Box borderStyle="round" borderColor={alert.kind === 'done' ? 'green' : 'yellow'} paddingX={1} width={Math.min(width - 1, 80)} flexDirection="column">
          <Text bold color={alert.kind === 'done' ? 'green' : 'yellow'} wrap="truncate-end">
            {alert.text}
          </Text>
          <Text color="gray" wrap="truncate-end">
            {fit(
              [
                [alert.sub, t(lang, alert.turn ? 'alert_review' : 'anykey')],
                [alert.sub, alert.turn ? t(lang, 'alert_review_short') : ''],
                [alert.sub],
              ].map((xs) => xs.filter(Boolean).join(' · ')),
              Math.min(width - 1, 80) - 4,
            )}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" height={bodyH} overflow="hidden">
        {/* flexShrink 0: content taller than the pane is clipped at the bottom, never squeezed line by line. */}
        <Box flexDirection="column" flexShrink={0}>
          {overlay === 'welcome' ? (
            <Welcome lang={lang} width={width - 1} hooked={hooked} cwd={cwd} />
          ) : overlay === 'recap' && recap ? (
            <RecapView r={recap} lang={lang} width={width - 1} />
          ) : overlay === 'help' ? (
            <Help lang={lang} width={width - 1} />
          ) : mode === 'review' ? (
            <Review {...modeProps} />
          ) : mode === 'game' ? (
            <Game {...modeProps} />
          ) : mode === 'learn' ? (
            <Learn {...modeProps} />
          ) : (
            <Me {...modeProps} />
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
      ) : (
        <Text color="gray" wrap="truncate-end">
          {footer || ' '}
        </Text>
      )}
    </Box>
  );
}
