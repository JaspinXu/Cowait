/** Optional Claude Code status line: keeps model + folder, adds energy, coins and the review queue. */
import path from 'node:path';
import { pendingCards, type State } from './engine/state.js';

export function statusLine(input: any, s: State, lang: 'zh' | 'en'): string {
  const parts: string[] = [];
  const model = input?.model?.display_name;
  const dir = input?.workspace?.current_dir || input?.cwd;
  if (model) parts.push(String(model));
  if (dir) parts.push(path.basename(String(dir)));
  let mine = `⚡${s.energy} 💰${s.coins}`;
  const pending = pendingCards(s).length;
  if (pending) mine += lang === 'zh' ? ` · 📝${pending} 张待审` : ` · 📝${pending} to review`;
  parts.push(mine);
  return parts.join(' · ');
}
