/** Optional Claude Code status line: keeps model + folder, adds streak, energy, coins and the review queue. */
import path from 'node:path';
import { pendingCards, type State } from './engine/state.js';
import { streak } from './engine/progress.js';

export function statusLine(input: any, s: State, lang: 'zh' | 'en'): string {
  const parts: string[] = [];
  const model = input?.model?.display_name;
  const dir = input?.workspace?.current_dir || input?.cwd;
  if (model) parts.push(String(model));
  if (dir) parts.push(path.basename(String(dir)));
  const sk = streak(s).days;
  let mine = `${sk ? `🔥${sk} ` : ''}⚡${s.energy} 💰${s.coins}`;
  const pending = pendingCards(s).length;
  if (pending) mine += lang === 'zh' ? ` · 📝${pending} 个待审` : ` · 📝${pending} to review`;
  parts.push(mine);
  return parts.join(' · ');
}
