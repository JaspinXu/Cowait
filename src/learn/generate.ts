/** AI-generated decks: any topic you want to learn, or "understand what Claude just changed". */
import type { Config } from '../config.js';
import type { ReviewCard } from '../engine/state.js';
import { cardDiff, diffText } from '../engine/diff.js';
import { complete } from './llm.js';
import type { Deck } from './decks.js';

const LANG_NAME = { zh: 'Simplified Chinese', en: 'English' } as const;

export function parseCards(text: string): { q: string; a: string }[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('No JSON array in model output');
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('Model output is not an array');
  const cards = arr
    .filter((c: any) => c && typeof c.q === 'string' && typeof c.a === 'string' && c.q.trim() && c.a.trim())
    .map((c: any) => ({ q: c.q.trim(), a: c.a.trim() }));
  if (!cards.length) throw new Error('Model returned no usable cards');
  return cards;
}

function slug(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return base || 'deck';
}

function toDeck(id: string, title: string, cards: { q: string; a: string }[]): Deck {
  return { id, title, generated: true, createdAt: Date.now(), cards: cards.map((c, i) => ({ id: `${id}.${i + 1}`, q: c.q, a: c.a })) };
}

const FORMAT = 'Respond with ONLY a JSON array, no prose before or after: [{"q": "question", "a": "answer"}]';

export async function generateTopicDeck(topic: string, n: number, lang: 'zh' | 'en', cfg: Config): Promise<Deck> {
  const prompt = [
    'You write flashcards for a software developer who studies in short bursts (30 seconds to 3 minutes) while waiting for an AI coding agent to finish.',
    `Topic: "${topic}"`,
    `Write ${n} flashcards in ${LANG_NAME[lang]}. Order them from fundamentals to deeper ideas.`,
    'Each question must be answerable in one breath; each answer is 1-3 accurate, concrete sentences. No numbering, no markdown.',
    FORMAT,
  ].join('\n');
  const cards = parseCards(await complete(prompt, cfg));
  return toDeck(`topic-${slug(topic)}-${Date.now().toString(36)}`, topic, cards);
}

export async function generateCodebaseDeck(recent: ReviewCard[], n: number, lang: 'zh' | 'en', cfg: Config): Promise<Deck> {
  if (!recent.length) throw new Error('NO_CHANGES');
  let changes = '';
  for (const c of recent.slice(-8)) {
    changes += diffText(c.file, cardDiff(c), 2000) + '\n';
    if (changes.length > 9000) break;
  }
  const prompt = [
    'Below are code changes an AI coding agent just made in a developer\'s project.',
    `Write ${n} flashcards in ${LANG_NAME[lang]} that help the developer genuinely understand these changes: what changed, why it was likely needed, the concepts and APIs involved, and risks worth checking.`,
    'Questions must be answerable from the changes shown plus general programming knowledge. Refer to file and function names where it helps. Answers: 1-3 sentences.',
    '<changes>',
    changes.trim(),
    '</changes>',
    FORMAT,
  ].join('\n');
  const cards = parseCards(await complete(prompt, cfg));
  const day = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const title = lang === 'zh' ? `看懂最近的改动 · ${day}` : `Recent changes · ${day}`;
  return toDeck(`changes-${Date.now().toString(36)}`, title, cards);
}
