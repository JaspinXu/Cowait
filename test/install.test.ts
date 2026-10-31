import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { addHooks, removeHooks, hookStatus, install, uninstall, HOOK_MARK, STATUS_MARK } from '../src/install.js';
import { tempDir, tempHome } from './helpers.js';

const userHooks = {
  hooks: {
    PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
  },
  model: 'opus',
};

describe('settings merge', () => {
  it('adds all five hooks next to the user’s own, idempotently', () => {
    const once = addHooks(userHooks, `node hook.js ${HOOK_MARK}`);
    const twice = addHooks(once, `node hook.js ${HOOK_MARK}`);
    expect(twice).toEqual(once);
    expect(hookStatus(once)).toEqual({ installed: ['UserPromptSubmit', 'PostToolUse', 'Stop', 'Notification', 'SessionEnd'], missing: [] });
    expect(once.hooks.PostToolUse[0]).toEqual(userHooks.hooks.PostToolUse[0]);
    expect(once.hooks.PostToolUse[1]).toMatchObject({ matcher: '*' });
    expect(once.model).toBe('opus');
  });

  it('removes only its own entries', () => {
    expect(removeHooks(addHooks(userHooks, `x ${HOOK_MARK}`))).toEqual(userHooks);
    expect(removeHooks(addHooks({}, `x ${HOOK_MARK}`))).toEqual({});
  });
});

describe('install / uninstall on disk', () => {
  let cfgDir: string;
  beforeEach(() => {
    tempHome();
    cfgDir = tempDir('claude-cfg-');
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
  });

  it('backs up, installs, keeps a custom status line, and restores cleanly', () => {
    const file = path.join(cfgDir, 'settings.json');
    const original = { ...userHooks, statusLine: { type: 'command', command: 'my-status' } };
    fs.writeFileSync(file, JSON.stringify(original, null, 2));

    const r = install({ scope: 'user', statusline: true });
    expect(r.backup && fs.existsSync(r.backup)).toBe(true);
    expect(r.statusline).toBe('kept-existing');
    let s = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(hookStatus(s).missing).toEqual([]);
    expect(s.statusLine.command).toBe('my-status');
    const cmd: string = s.hooks.Stop[1].hooks[0].command;
    expect(cmd).toContain('dist/hook.js');
    expect(cmd).not.toContain('\\');

    const forced = install({ scope: 'user', statusline: true, force: true });
    expect(forced.statusline).toBe('set');
    s = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(s.statusLine.command).toContain(STATUS_MARK);

    expect(uninstall({ scope: 'user' }).changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(original);
  });

  it('creates settings.json when there is none, and refuses broken JSON', () => {
    const file = path.join(cfgDir, 'settings.json');
    expect(install({ scope: 'user' }).backup).toBeUndefined();
    expect(hookStatus(JSON.parse(fs.readFileSync(file, 'utf8'))).missing).toEqual([]);
    fs.writeFileSync(file, '{ broken');
    expect(() => install({ scope: 'user' })).toThrow(/Cannot parse/);
  });
});

describe('settings.json saved with a BOM', () => {
  it('still parses and installs', () => {
    tempHome();
    const dir = tempDir('claude-cfg-');
    process.env.CLAUDE_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, 'settings.json'), '﻿' + JSON.stringify({ model: 'opus' }));
    install({ scope: 'user' });
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(s.model).toBe('opus');
    expect(hookStatus(s).missing).toEqual([]);
  });
});
