/**
 * Adds / removes Cowait's hooks in Claude Code's settings.json.
 * Our entries are recognised by a marker argument, so install is idempotent and
 * uninstall never touches anything the user configured themselves.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, packageRoot } from './paths.js';
import { ensureDir, parseJson, readJson, writeJsonAtomic } from './fsutil.js';

export const HOOK_MARK = '--cowait-hook';
export const STATUS_MARK = '--cowait-statusline';

/** [event, needs a tool matcher]. PreToolUse is left out on purpose: it would add latency before every tool call. */
const HOOK_EVENTS: [string, boolean][] = [
  ['UserPromptSubmit', false],
  ['PostToolUse', true],
  ['Stop', false],
  ['Notification', false],
  ['SessionEnd', false],
];

type Settings = Record<string, any>;

export type Scope = 'user' | 'project';

export function claudeSettingsPath(scope: Scope, cwd = process.cwd()): string {
  if (scope === 'project') return path.join(cwd, '.claude', 'settings.local.json');
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

/** Forward slashes work in both Git Bash and cmd on Windows and need no escaping. */
const fwd = (p: string) => p.replace(/\\/g, '/');

export function hookCommand(): string {
  return `"${fwd(process.execPath)}" "${fwd(path.join(packageRoot(), 'dist', 'hook.js'))}" ${HOOK_MARK}`;
}

export function statuslineCommand(): string {
  return `"${fwd(process.execPath)}" "${fwd(path.join(packageRoot(), 'dist', 'cli.js'))}" statusline ${STATUS_MARK}`;
}

const ours = (cmd: unknown, mark: string) => typeof cmd === 'string' && cmd.includes(mark);

export function removeHooks(settings: Settings): Settings {
  const s = structuredClone(settings);
  if (!s.hooks || typeof s.hooks !== 'object') return s;
  for (const ev of Object.keys(s.hooks)) {
    const arr = s.hooks[ev];
    if (!Array.isArray(arr)) continue;
    const kept = arr
      .map((entry: any) => ({ ...entry, hooks: (entry?.hooks ?? []).filter((h: any) => !ours(h?.command, HOOK_MARK)) }))
      .filter((entry: any) => entry.hooks.length > 0);
    if (kept.length) s.hooks[ev] = kept;
    else delete s.hooks[ev];
  }
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
  return s;
}

export function addHooks(settings: Settings, command: string): Settings {
  const s = removeHooks(settings);
  s.hooks ??= {};
  for (const [ev, matcher] of HOOK_EVENTS) {
    const entry: any = { hooks: [{ type: 'command', command, timeout: 10 }] };
    if (matcher) entry.matcher = '*';
    s.hooks[ev] = [...(Array.isArray(s.hooks[ev]) ? s.hooks[ev] : []), entry];
  }
  return s;
}

export function hookStatus(settings: Settings): { installed: string[]; missing: string[] } {
  const installed: string[] = [];
  const missing: string[] = [];
  for (const [ev] of HOOK_EVENTS) {
    const arr = settings?.hooks?.[ev];
    const found = Array.isArray(arr) && arr.some((e: any) => (e?.hooks ?? []).some((h: any) => ours(h?.command, HOOK_MARK)));
    (found ? installed : missing).push(ev);
  }
  return { installed, missing };
}

export function ourHookCommand(settings: Settings): string | null {
  for (const arr of Object.values(settings?.hooks ?? {})) {
    if (!Array.isArray(arr)) continue;
    for (const e of arr) for (const h of e?.hooks ?? []) if (ours(h?.command, HOOK_MARK)) return h.command;
  }
  return null;
}

function readSettings(file: string): { settings: Settings; existed: boolean } {
  if (!fs.existsSync(file)) return { settings: {}, existed: false };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return { settings: {}, existed: true };
  try {
    return { settings: parseJson<Settings>(raw), existed: true };
  } catch {
    throw new Error(`Cannot parse ${file} — please fix the JSON first.`);
  }
}

function writeSettings(file: string, s: Settings): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

const prevStatusFile = () => path.join(dataDir(), 'statusline.prev.json');

export interface InstallResult {
  file: string;
  backup?: string;
  statusline: 'set' | 'kept-existing' | 'not-requested';
}

export function install(opts: { scope: Scope; statusline?: boolean; force?: boolean; cwd?: string }): InstallResult {
  const file = claudeSettingsPath(opts.scope, opts.cwd);
  const { settings, existed } = readSettings(file);
  let backup: string | undefined;
  if (existed) {
    backup = `${file}.cowait-backup-${stamp()}`;
    fs.copyFileSync(file, backup);
  }
  let next = addHooks(settings, hookCommand());
  let status: InstallResult['statusline'] = 'not-requested';
  if (opts.statusline) {
    const cur = next.statusLine;
    if (cur && !ours(cur.command, STATUS_MARK) && !opts.force) {
      status = 'kept-existing';
    } else {
      if (cur && !ours(cur.command, STATUS_MARK)) writeJsonAtomic(prevStatusFile(), cur, true);
      next = { ...next, statusLine: { type: 'command', command: statuslineCommand(), padding: 0 } };
      status = 'set';
    }
  }
  writeSettings(file, next);
  return { file, backup, statusline: status };
}

export function uninstall(opts: { scope: Scope; cwd?: string }): { file: string; changed: boolean } {
  const file = claudeSettingsPath(opts.scope, opts.cwd);
  const { settings, existed } = readSettings(file);
  if (!existed) return { file, changed: false };
  let next = removeHooks(settings);
  if (next.statusLine && ours(next.statusLine.command, STATUS_MARK)) {
    const prev = readJson<Settings | null>(prevStatusFile(), null);
    if (prev) next = { ...next, statusLine: prev };
    else {
      next = { ...next };
      delete next.statusLine;
    }
  }
  const changed = JSON.stringify(next) !== JSON.stringify(settings);
  if (changed) {
    fs.copyFileSync(file, `${file}.cowait-backup-${stamp()}`);
    writeSettings(file, next);
  }
  return { file, changed };
}

export function readClaudeSettings(scope: Scope, cwd?: string): Settings {
  try {
    return readSettings(claudeSettingsPath(scope, cwd)).settings;
  } catch {
    return {};
  }
}
