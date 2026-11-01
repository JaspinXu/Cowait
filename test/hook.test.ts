import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { handleHook } from '../src/hook.js';
import { addNote, pendingNotes } from '../src/feedback.js';
import { tempHome, readEvents } from './helpers.js';

let home: string;
beforeEach(() => {
  home = tempHome();
});

const base = { session_id: 's1', cwd: '/proj', transcript_path: '/x' };

describe('hook', () => {
  it('logs a prompt with only its first line as the turn title, and prints nothing', () => {
    const prompt = '  fix the login bug  \n\nhere is the secret stuff you need';
    expect(handleHook(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit', prompt }), 1000)).toBeNull();
    const ev = readEvents(home);
    expect(ev).toEqual([{ t: 1000, k: 'prompt', sid: 's1', cwd: '/proj', p: 'fix the login bug' }]);
    // Nothing past the first line is ever stored.
    expect(fs.readFileSync(path.join(home, 'events.jsonl'), 'utf8')).not.toContain('secret');
  });

  it('keeps no title at all when turn titles are switched off', () => {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ promptTitles: false }));
    handleHook(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'fix the login bug' }), 1000);
    expect(readEvents(home)).toEqual([{ t: 1000, k: 'prompt', sid: 's1', cwd: '/proj' }]);
  });

  it('captures Edit diffs, preferring Claude Code structuredPatch when present', () => {
    handleHook(
      JSON.stringify({
        ...base,
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/a.ts', old_string: 'a', new_string: 'b' },
        tool_response: { filePath: '/proj/a.ts', structuredPatch: [{ oldStart: 10, oldLines: 1, newStart: 10, newLines: 1, lines: ['-a', '+b'] }] },
      }),
      1,
    );
    handleHook(
      JSON.stringify({
        ...base,
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/b.ts', old_string: 'x', new_string: 'y' },
        tool_response: {},
      }),
      2,
    );
    const [a, b] = readEvents(home);
    expect(a.edit).toMatchObject({ file: '/proj/a.ts', kind: 'edit', patch: [{ oldStart: 10, newStart: 10, lines: ['-a', '+b'] }] });
    expect(b.edit).toMatchObject({ file: '/proj/b.ts', kind: 'edit', hunks: [{ old: 'x', new: 'y' }] });
  });

  it('marks new files from Write and ignores Read output entirely', () => {
    handleHook(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/proj/n.ts', content: 'hi' }, tool_response: { type: 'create' } }), 1);
    handleHook(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/proj/n.ts' }, tool_response: { content: 'SECRET FILE' } }), 2);
    const [w, r] = readEvents(home);
    expect(w.edit).toMatchObject({ kind: 'write', created: true, hunks: [{ old: '', new: 'hi' }] });
    expect(r).toEqual({ t: 2, k: 'tool', sid: 's1', cwd: '/proj', tool: 'Read' });
  });

  it('detects passing and failing test runs in Bash', () => {
    const bash = (command: string, stdout: string, t: number) =>
      handleHook(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout, stderr: '' } }), t);
    bash('npm test', 'Test Files  3 passed (3)\n     Tests  12 passed (12)', 1);
    bash('pytest -q', '2 failed, 10 passed in 0.5s', 2);
    bash('ls -la', 'total 0', 3);
    const [p, f, l] = readEvents(home);
    expect(p.bash).toEqual({ cmd: 'npm test', test: true, result: 'pass' });
    expect(f.bash).toEqual({ cmd: 'pytest -q', test: true, result: 'fail' });
    expect(l.bash).toEqual({ cmd: 'ls -la', test: false, result: 'unknown' });
  });

  it('relays review notes to Claude after the next tool call, exactly once', () => {
    addNote({ id: 'n1', t: 5, text: 'don’t drop the token refresh', file: 'src/auth.ts' });
    const out = handleHook(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {}, tool_response: {} }), 10);
    expect(out).not.toBeNull();
    const json = JSON.parse(out!);
    expect(json.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(json.hookSpecificOutput.additionalContext).toContain('src/auth.ts: "don’t drop the token refresh"');
    expect(pendingNotes()).toHaveLength(0);
    expect(readEvents(home).at(-1)).toEqual({ t: 10, k: 'delivered', sid: 's1', ids: ['n1'] });
    expect(handleHook(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read' }), 11)).toBeNull();
  });

  it('relays notes on the next prompt when Claude was idle', () => {
    addNote({ id: 'n2', t: 5, text: 'rename this' });
    const json = JSON.parse(handleHook(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'go on' }), 10)!);
    expect(json.hookSpecificOutput).toMatchObject({ hookEventName: 'UserPromptSubmit' });
    expect(json.hookSpecificOutput.additionalContext).toContain('"rename this"');
  });

  it('blocks Stop once to let Claude address notes, and never loops', () => {
    addNote({ id: 'n3', t: 5, text: 'add a test' });
    const out = JSON.parse(handleHook(JSON.stringify({ ...base, hook_event_name: 'Stop', stop_hook_active: false }), 10)!);
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('"add a test"');
    // The turn is not over, so no stop event yet.
    expect(readEvents(home).map((e) => e.k)).toEqual(['delivered']);

    addNote({ id: 'n4', t: 6, text: 'another' });
    expect(handleHook(JSON.stringify({ ...base, hook_event_name: 'Stop', stop_hook_active: true }), 20)).toBeNull();
    expect(readEvents(home).at(-1)).toMatchObject({ k: 'stop' });
    expect(pendingNotes()).toHaveLength(1); // kept for the next prompt
  });

  it('respects feedback=false', () => {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ feedback: false }));
    addNote({ id: 'n5', t: 5, text: 'x' });
    expect(handleHook(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read' }), 10)).toBeNull();
    expect(handleHook(JSON.stringify({ ...base, hook_event_name: 'Stop' }), 11)).toBeNull();
  });

  it('survives garbage input', () => {
    expect(handleHook('not json')).toBeNull();
    expect(handleHook('')).toBeNull();
    expect(handleHook('{"hook_event_name":"SomethingNew"}')).toBeNull();
  });

  describe('compiled entry point', () => {
    const hookJs = path.resolve(__dirname, '../dist/hook.js');
    const run = (payload: object, env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [hookJs, '--cowait-hook'], { input: JSON.stringify(payload), env: { ...process.env, COWAIT_HOME: home, ...env }, encoding: 'utf8' });

    it('exits 0 and prints the relay JSON', () => {
      addNote({ id: 'n6', t: 5, text: 'check null case' });
      const r = run({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/x', old_string: 'a', new_string: 'b' } });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('check null case');
    });

    it('ignores our own internal claude -p calls', () => {
      const r = run({ ...base, hook_event_name: 'UserPromptSubmit' }, { COWAIT_INTERNAL: '1' });
      expect(r.status).toBe(0);
      expect(readEvents(home)).toHaveLength(0);
    });

    it('exits 0 even with empty stdin', () => {
      const r = spawnSync(process.execPath, [hookJs], { input: '', env: { ...process.env, COWAIT_HOME: home }, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    });
  });
});

describe('Windows-written files (UTF-8 BOM)', () => {
  it('delivers a note file that starts with a BOM', () => {
    const dir = path.join(home, 'feedback');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '5-bom.json'), '﻿' + JSON.stringify({ id: 'bom', t: 5, text: 'from PowerShell' }));
    const out = handleHook(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit' }), 10);
    expect(JSON.parse(out!).hookSpecificOutput.additionalContext).toContain('"from PowerShell"');
  });

  it('sets an unreadable note aside instead of deleting it', () => {
    const dir = path.join(home, 'feedback');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '6-bad.json'), '{ not json');
    expect(handleHook(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit' }), 10)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual(['6-bad.json.unreadable']);
  });

  it('honours a config.json saved with a BOM (e.g. by Notepad)', () => {
    fs.writeFileSync(path.join(home, 'config.json'), '﻿{"feedback": false}');
    addNote({ id: 'n9', t: 5, text: 'x' });
    expect(handleHook(JSON.stringify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read' }), 10)).toBeNull();
  });
});
