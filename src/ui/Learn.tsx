import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { allDecks, saveDeck, tx, type Deck, type Flashcard } from '../learn/decks.js';
import { nextCard, rate, dueCount, type Rating } from '../learn/srs.js';
import { ECON } from '../engine/economy.js';
import { detectProvider } from '../learn/llm.js';
import { generateCodebaseDeck, generateTopicDeck } from '../learn/generate.js';
import { t } from '../i18n.js';
import { useLine, type ModeProps } from './common.js';

export function Learn({ st, update, cfg, lang, active, width, now, setTyping }: ModeProps) {
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

  const [cur, setCur] = useState<{ id: string; isNew: boolean } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [msg, setMsg] = useState('');
  const [busyGen, setBusyGen] = useState(false);
  const topic = useLine();

  // Pick a card whenever there is none (first render, deck switch, after rating).
  useEffect(() => {
    if (!cur || !cards.has(cur.id)) {
      setCur(nextCard(ids, st.srs, Date.now()));
      setFlipped(false);
    }
  }, [cur, deckId, cards]);

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
    if (!cur) return;
    const id = cur.id;
    update((s) => {
      s.srs[id] = rate(s.srs[id], r, Date.now());
      s.energy += ECON.learnCard;
      s.totals.learned++;
    });
    setMsg(t(lang, 'ln_gained', { n: ECON.learnCard }));
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
      if (!cur) return;
      if (!flipped && (input === ' ' || key.return)) return setFlipped(true);
      if (flipped) {
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
  const boxW = Math.min(width - 2, 90);

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
          <Text color="gray">
            {tx(item.deck.title, lang)} · {cur!.isNew ? t(lang, 'ln_new') : t(lang, 'ln_review')}
          </Text>
          <Text wrap="wrap">
            <Text color="cyan" bold>
              {t(lang, 'ln_q')}{lang === 'zh' ? '：' : ': '}
            </Text>
            {tx(item.card.q, lang)}
          </Text>
          {flipped ? (
            <>
              <Text> </Text>
              <Text wrap="wrap">
                <Text color="green" bold>
                  {t(lang, 'ln_a')}{lang === 'zh' ? '：' : ': '}
                </Text>
                {tx(item.card.a, lang)}
              </Text>
            </>
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="green">{t(lang, 'ln_done')}</Text>
          <Text color="gray">{t(lang, 'ln_done_hint')}</Text>
        </Box>
      )}
      {topic.value !== null ? (
        <Text>
          <Text color="yellow">{t(lang, 'ln_topic')}</Text>
          {topic.value}
          <Text inverse> </Text>
        </Text>
      ) : (
        <Text color="yellow" wrap="truncate-end">
          {msg || ' '}
        </Text>
      )}
      {item && <Text color="gray">{flipped ? t(lang, 'ln_rate') : t(lang, 'ln_flip')}</Text>}
      <Text color="gray" wrap="truncate-end">
        {t(lang, 'ln_keys')}
      </Text>
    </Box>
  );
}
