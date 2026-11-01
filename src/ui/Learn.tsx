import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { allDecks, saveDeck, tx, type Deck, type Flashcard } from '../learn/decks.js';
import { nextCard, rate, dueCount, type Rating } from '../learn/srs.js';
import { ECON } from '../engine/economy.js';
import { track } from '../engine/progress.js';
import { detectProvider } from '../learn/llm.js';
import { generateCodebaseDeck, generateTopicDeck } from '../learn/generate.js';
import { t } from '../i18n.js';
import { InputLine, Labeled, Para, fit, useHint, useLine, useRefState, type ModeProps } from './common.js';

export function Learn({ st, update, cfg, lang, active, blocked, width, now, setTyping, setHint }: ModeProps) {
  const [reload, setReload] = useState(0);
  const decks = useMemo(() => allDecks(), [reload]);
  const deckId = st.learnDeck === 'all' || decks.some((d) => d.id === st.learnDeck) ? st.learnDeck : 'all';
  const pool: Deck[] = deckId === 'all' ? decks : decks.filter((d) => d.id === deckId);
  const cards = useMemo(() => {
    const m = new Map<string, { card: Flashcard; deck: Deck }>();
    for (const d of pool) for (const c of d.cards) m.set(c.id, { card: c, deck: d });
    return m;
  }, [pool.map((d) => d.id).join('|'), reload]);
  const ids = [...cards.keys()];

  // Refs too: a fast "space, 2" arrives before React re-renders, and "2" must see the flip.
  const [cur, setCur, curRef] = useRefState<{ id: string; isNew: boolean } | null>(null);
  const [flipped, setFlipped, flippedRef] = useRefState(false);
  const [msg, setMsg] = useState('');
  const [busyGen, setBusyGen] = useState(false);
  const topic = useLine();
  const shownAt = useRef(Date.now());

  // Pick a card whenever there is none (first render, deck switch, after rating).
  useEffect(() => {
    if (!cur || !cards.has(cur.id)) {
      setCur(nextCard(ids, st.srs, Date.now()));
      setFlipped(false);
    }
  }, [cur, deckId, cards]);

  // Start the clock whenever a new question appears.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [cur?.id]);

  // When nothing was due, look again every so often (cards become due over time).
  useEffect(() => {
    if (cur) return;
    const n = nextCard(ids, st.srs, now);
    if (n) setCur(n);
  }, [Math.floor(now / 15000)]);

  const switchDeck = () => {
    const order = ['all', ...decks.map((d) => d.id)];
    const next = order[(order.indexOf(deckId) + 1) % order.length];
    update((s) => {
      s.learnDeck = next;
    });
    setCur(null);
    setMsg('');
  };

  const doRate = (r: Rating) => {
    if (!curRef.current) return;
    const id = curRef.current.id;
    // Flip-and-rate in a blink is not studying: keep the rating, skip the reward.
    const quick = Date.now() - shownAt.current < ECON.minStudyMs;
    update((s) => {
      s.srs[id] = rate(s.srs[id], r, Date.now());
      if (!quick) {
        s.energy += ECON.learnCard;
        s.totals.learned++;
        track(s, 'learned');
      }
    });
    setMsg(quick ? t(lang, 'ln_quick') : t(lang, 'ln_gained', { n: ECON.learnCard }));
    setFlipped(false);
    setCur(null);
  };

  const run = async (make: () => Promise<Deck>) => {
    if (busyGen) return;
    if (!detectProvider(cfg)) {
      setMsg(t(lang, 'ln_no_provider'));
      return;
    }
    setBusyGen(true);
    setMsg(t(lang, 'ln_generating'));
    try {
      const d = await make();
      saveDeck(d);
      setReload((x) => x + 1);
      update((s) => {
        s.learnDeck = d.id;
      });
      setCur(null);
      setMsg(t(lang, 'ln_generated', { t: tx(d.title, lang), n: d.cards.length }));
    } catch (e: any) {
      setMsg(t(lang, 'ln_failed', { e: String(e?.message ?? e).slice(0, 120) }));
    } finally {
      setBusyGen(false);
    }
  };

  useInput(
    (input, key) => {
      if (blocked()) return;
      if (topic.isOpen()) {
        topic.handle(
          input,
          key,
          (text) => {
            const q = text.trim();
            setTyping(false);
            if (q) void run(() => generateTopicDeck(q, 12, lang, cfg));
          },
          () => setTyping(false),
        );
        return;
      }
      if (input === 'd') return switchDeck();
      if (input === 't') {
        topic.open();
        setTyping(true);
        return;
      }
      if (input === 'g') {
        if (!st.review.length) return setMsg(t(lang, 'ln_no_changes'));
        return void run(() => generateCodebaseDeck(st.review.slice(-8), 8, lang, cfg));
      }
      if (!curRef.current) return;
      if (!flippedRef.current && (input === ' ' || key.return)) return setFlipped(true);
      if (flippedRef.current) {
        if (input === '1') doRate('again');
        else if (input === '2' || input === ' ' || key.return) doRate('good');
        else if (input === '3') doRate('easy');
      }
    },
    { isActive: active },
  );

  const deckTitle = deckId === 'all' ? t(lang, 'ln_all') : tx(decks.find((d) => d.id === deckId)!.title, lang);
  const due = dueCount(ids, st.srs, now);
  const unseen = ids.filter((id) => !st.srs[id]).length;
  const item = cur ? cards.get(cur.id) : undefined;

  const hint =
    topic.value !== null
      ? t(lang, 'note_hint')
      : item && flipped
        ? t(lang, 'ln_rate')
        : item
          ? fit([t(lang, 'ln_flip'), t(lang, 'ln_flip_short')], width - 12)
          : fit([t(lang, 'ln_keys'), t(lang, 'ln_keys_short')], width - 12);
  useHint(setHint, hint, active);

  const boxW = Math.min(width - 2, 90);
  const inner = boxW - 4; // round border + one column of padding on each side

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>{t(lang, 'ln_title')}</Text>
        <Text color="gray">
          {'  '}
          {deckTitle} · {t(lang, 'ln_due', { n: due })} · {t(lang, 'ln_new')} {unseen}
        </Text>
      </Text>
      <Text> </Text>
      {item ? (
        <Box flexDirection="column" borderStyle="round" borderColor={flipped ? 'green' : 'cyan'} paddingX={1} width={boxW}>
          <Text color="gray" wrap="truncate-end">
            {tx(item.deck.title, lang)} · {cur!.isNew ? t(lang, 'ln_new') : t(lang, 'ln_review')}
          </Text>
          <Labeled label={t(lang, 'ln_q') + (lang === 'zh' ? '：' : ': ')} text={tx(item.card.q, lang)} width={inner} labelColor="cyan" />
          {flipped ? (
            <>
              <Text> </Text>
              <Labeled label={t(lang, 'ln_a') + (lang === 'zh' ? '：' : ': ')} text={tx(item.card.a, lang)} width={inner} labelColor="green" />
            </>
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="green">{t(lang, 'ln_done')}</Text>
          <Para text={t(lang, 'ln_done_hint')} width={width - 1} color="gray" />
        </Box>
      )}
      {topic.value !== null ? (
        <InputLine prompt={t(lang, 'ln_topic')} value={topic.value} />
      ) : msg ? (
        <Para text={msg} width={width - 1} color="yellow" />
      ) : (
        <Text> </Text>
      )}
    </Box>
  );
}
