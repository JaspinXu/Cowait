import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsutil.js';

export interface Config {
  /** UI language: auto-detected from the system locale unless set. */
  lang: 'auto' | 'zh' | 'en';
  /** Pick a mode automatically at the start of every Claude turn. */
  autoMode: boolean;
  /** Energy needed to start a Debug Dungeon run (0 = free play). */
  runCost: number;
  /** Relay review notes back to Claude through hooks. */
  feedback: boolean;
  /** Ring the terminal bell when Claude finishes or needs you. */
  bell: boolean;
  /** Where AI-generated flashcards come from. */
  llm: 'auto' | 'anthropic' | 'claude-cli' | 'off';
  /** Model used with ANTHROPIC_API_KEY. */
  model: string;
  /** Model alias passed to `claude -p --model`. */
  cliModel: string;
  /** Waits predicted shorter than this go to quick modes (review / flashcards). */
  shortWaitSec: number;
  /** Keep the first line of each message to Claude as the turn's title in the review tab (local only). */
  promptTitles: boolean;
  /** Look for a newer Cowait once a day (one small request to the npm registry). */
  updateCheck: boolean;
}

export const DEFAULT_CONFIG: Config = {
  lang: 'auto',
  autoMode: true,
  runCost: 3,
  feedback: true,
  bell: true,
  llm: 'auto',
  model: 'claude-haiku-5-5',
  cliModel: 'haiku',
  shortWaitSec: 45,
  promptTitles: true,
  updateCheck: true,
};

export function loadConfig(): Config {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<Config>>(paths.config(), {}) };
}

export function saveConfig(cfg: Config): void {
  writeJsonAtomic(paths.config(), cfg, true);
}
