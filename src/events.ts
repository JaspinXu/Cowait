/**
 * The event log is the contract between the hook (writer, runs inside Claude Code)
 * and the panel (reader). Keep this file dependency-free: the hook imports it and
 * must start fast.
 */
import { isTestCommand, testOutcome, type TestResult } from './testdetect.js';

export interface Hunk {
  old: string;
  new: string;
}

export interface PatchHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export interface EditInfo {
  file: string;
  kind: 'edit' | 'write' | 'multiedit' | 'notebook';
  /** Raw before/after text (Edit / MultiEdit / new files). */
  hunks?: Hunk[];
  /** Real unified-diff hunks with line numbers, when Claude Code provides them. */
  patch?: PatchHunk[];
  created?: boolean;
}

export interface BashInfo {
  cmd: string;
  test: boolean;
  result: TestResult;
}

export type IEvent =
  /** `p`: the first line of your message, shortened: the turn's title in the review tab. Stays local. */
  | { t: number; k: 'prompt'; sid: string; cwd: string; p?: string }
  | { t: number; k: 'tool'; sid: string; cwd: string; tool: string; edit?: EditInfo; bash?: BashInfo }
  | { t: number; k: 'stop'; sid: string; cwd: string }
  | { t: number; k: 'notify'; sid: string; cwd: string; msg: string }
  | { t: number; k: 'end'; sid: string }
  | { t: number; k: 'delivered'; sid: string; ids: string[] };

const MAX_TEXT = 4000;
const MAX_PATCH_LINES = 240;

function clip(s: unknown, max = MAX_TEXT): string {
  const str = typeof s === 'string' ? s : '';
  return str.length > max ? str.slice(0, max) + '\n…' : str;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const TITLE_MAX = 60;

/** A short, single-line title for a turn: the first non-empty line of the prompt. */
export function promptTitle(prompt: unknown): string | undefined {
  const line = str(prompt)
    .split(/\r?\n/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .find(Boolean);
  if (!line) return undefined;
  const chars = Array.from(line);
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX - 1).join('') + '…' : line;
}

function readPatch(resp: any): PatchHunk[] | undefined {
  const sp = resp?.structuredPatch;
  if (!Array.isArray(sp) || sp.length === 0) return undefined;
  const out: PatchHunk[] = [];
  let budget = MAX_PATCH_LINES;
  for (const h of sp) {
    if (!h || !Array.isArray(h.lines) || budget <= 0) continue;
    const lines = (h.lines as unknown[]).filter((l): l is string => typeof l === 'string').slice(0, budget);
    budget -= lines.length;
    out.push({ oldStart: Number(h.oldStart) || 1, newStart: Number(h.newStart) || 1, lines: lines.map((l) => clip(l, 400)) });
  }
  return out.length ? out : undefined;
}

function editInfo(tool: string, input: any, resp: any): EditInfo | undefined {
  const file = str(input?.file_path) || str(input?.notebook_path) || str(resp?.filePath);
  if (!file) return undefined;
  const patch = readPatch(resp);
  switch (tool) {
    case 'Edit':
      return { file, kind: 'edit', patch, hunks: patch ? undefined : [{ old: clip(input?.old_string), new: clip(input?.new_string) }] };
    case 'MultiEdit': {
      const edits = Array.isArray(input?.edits) ? input.edits : [];
      return {
        file,
        kind: 'multiedit',
        patch,
        hunks: patch ? undefined : edits.slice(0, 12).map((e: any) => ({ old: clip(e?.old_string, 1500), new: clip(e?.new_string, 1500) })),
      };
    }
    case 'Write': {
      const created = resp?.type === 'create';
      if (patch && !created) return { file, kind: 'write', patch };
      return { file, kind: 'write', created, hunks: [{ old: '', new: clip(input?.content) }] };
    }
    case 'NotebookEdit':
      return { file, kind: 'notebook', hunks: [{ old: '', new: clip(input?.new_source) }] };
    default:
      return undefined;
  }
}

function bashInfo(input: any, resp: any): BashInfo | undefined {
  const cmd = str(input?.command);
  if (!cmd) return undefined;
  const test = isTestCommand(cmd);
  let result: TestResult = 'unknown';
  if (test && !resp?.interrupted) {
    const out = typeof resp === 'string' ? resp : `${str(resp?.stdout)}\n${str(resp?.stderr)}\n${str(resp?.output)}`;
    result = testOutcome(out);
  }
  return { cmd: clip(cmd, 300), test, result };
}

/** Turn a Claude Code hook payload into a compact log event (or null to ignore it). */
export function toEvent(p: any, now: number, opts: { titles?: boolean } = {}): IEvent | null {
  if (!p || typeof p !== 'object') return null;
  const sid = str(p.session_id) || 'unknown';
  const cwd = str(p.cwd);
  switch (p.hook_event_name) {
    case 'UserPromptSubmit': {
      const ev: IEvent = { t: now, k: 'prompt', sid, cwd };
      const title = opts.titles === false ? undefined : promptTitle(p.prompt);
      if (title) ev.p = title;
      return ev;
    }
    case 'PostToolUse': {
      const tool = str(p.tool_name) || 'tool';
      const ev: IEvent = { t: now, k: 'tool', sid, cwd, tool };
      const edit = editInfo(tool, p.tool_input, p.tool_response);
      if (edit) ev.edit = edit;
      if (tool === 'Bash') {
        const bash = bashInfo(p.tool_input, p.tool_response);
        if (bash) ev.bash = bash;
      }
      return ev;
    }
    case 'Stop':
      return { t: now, k: 'stop', sid, cwd };
    case 'Notification':
      return { t: now, k: 'notify', sid, cwd, msg: clip(p.message, 200) };
    case 'SessionEnd':
      return { t: now, k: 'end', sid };
    default:
      return null;
  }
}
