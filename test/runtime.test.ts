import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appVersion, isBunfsPath, isCompiled, packageRoot, selfCommand, setCompiledForTests, shQuote, splitPlan } from '../src/runtime.js';
import { dataDir } from '../src/paths.js';
import { hookCommand, hookStatus, install, statuslineCommand, HOOK_MARK, STATUS_MARK } from '../src/install.js';
import { addNote } from '../src/feedback.js';
import { readEvents, tempDir, tempHome } from './helpers.js';

const fwd = (p: string) => p.replace(/\\/g, '/');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

afterEach(() => setCompiledForTests(null));

describe('standalone binary detection', () => {
  it('recognises Bun’s virtual file system on every platform', () => {
    expect(isBunfsPath('/$bunfs/root/cowait')).toBe(true);
    expect(isBunfsPath('file:///$bunfs/root/cowait')).toBe(true);
    expect(isBunfsPath('B:/~BUN/root/cowait.exe')).toBe(true);
    expect(isBunfsPath('B:\\~BUN\\root\\cowait.exe')).toBe(true);
    // import.meta.url percent-encodes the tilde on Windows.
    expect(isBunfsPath('file:///B:/%7EBUN/root/cowait.exe')).toBe(true);
  });

  it('does not mistake ordinary paths for it', () => {
    for (const p of ['/home/u/.cowait/bin/cowait', 'G:/Cowait/dist/cli.js', 'file:///G:/Cowait/dist/cli.js', 'C:\\~BUN\\x.exe', '/tmp/$bunfs/x', ''])
      expect(isBunfsPath(p)).toBe(false);
  });

  it('is false under Node', () => {
    expect(isCompiled()).toBe(false);
  });
});

describe('version and self command', () => {
  it('reads the version from package.json when not baked in', () => {
    expect(appVersion()).toBe(pkg.version);
  });

  it('runs Node + dist/cli.js, or the binary itself', () => {
    expect(selfCommand()).toEqual([process.execPath, path.join(packageRoot(), 'dist', 'cli.js')]);
    setCompiledForTests(true);
    expect(selfCommand()).toEqual([process.execPath]);
  });
});

describe('data folder of a standalone binary', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.COWAIT_HOME;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.COWAIT_HOME;
    else process.env.COWAIT_HOME = saved;
  });

  it('is ~/.cowait, and COWAIT_HOME still wins', () => {
    delete process.env.COWAIT_HOME;
    expect(dataDir()).toBe(path.join(packageRoot(), 'data')); // a clone keeps data next to the program
    setCompiledForTests(true);
    expect(dataDir()).toBe(path.join(os.homedir(), '.cowait'));
    process.env.COWAIT_HOME = '/somewhere/else';
    expect(dataDir()).toBe('/somewhere/else');
  });
});

describe('commands written into Claude Code settings', () => {
  it('uses Node + dist files normally', () => {
    expect(hookCommand()).toBe(`"${fwd(process.execPath)}" "${fwd(path.join(packageRoot(), 'dist', 'hook.js'))}" ${HOOK_MARK}`);
    expect(statuslineCommand()).toBe(`"${fwd(process.execPath)}" "${fwd(path.join(packageRoot(), 'dist', 'cli.js'))}" statusline ${STATUS_MARK}`);
  });

  it('runs the binary’s own subcommands when compiled', () => {
    setCompiledForTests(true);
    expect(hookCommand()).toBe(`"${fwd(process.execPath)}" hook ${HOOK_MARK}`);
    expect(statuslineCommand()).toBe(`"${fwd(process.execPath)}" statusline ${STATUS_MARK}`);
    expect(hookCommand()).not.toContain('\\');
  });

  it('installs the compiled command, and re-installing replaces the old Node one', () => {
    tempHome();
    const cfg = tempDir('claude-cfg-');
    process.env.CLAUDE_CONFIG_DIR = cfg;
    install({ scope: 'user', statusline: true });
    setCompiledForTests(true);
    install({ scope: 'user', statusline: true });
    const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
    expect(hookStatus(s).missing).toEqual([]);
    expect(s.hooks.Stop).toHaveLength(1);
    expect(s.hooks.Stop[0].hooks[0].command).toBe(hookCommand());
    expect(s.statusLine.command).toBe(statuslineCommand());
  });
});

describe('cowait hook (subcommand of the CLI bundle)', () => {
  const cliJs = path.resolve(__dirname, '../dist/cli.js');
  let home: string;
  beforeEach(() => {
    home = tempHome();
  });
  const run = (args: string[], payload: object | string) =>
    spawnSync(process.execPath, [cliJs, ...args], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: { ...process.env, COWAIT_HOME: home },
      encoding: 'utf8',
    });

  it('logs the event, relays notes and exits 0, like dist/hook.js', () => {
    addNote({ id: 'c1', t: 5, text: 'mind the edge case' });
    const r = run(['hook', HOOK_MARK], { session_id: 's', cwd: '/p', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {}, tool_response: {} });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('mind the edge case');
    expect(readEvents(home).map((e) => e.k)).toEqual(['tool', 'delivered']);
  });

  it('exits 0 on garbage', () => {
    const r = run(['hook', HOOK_MARK], 'not json');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('never starts a hook run from other commands (the CLI bundle contains the hook module)', () => {
    const r = run(['--version'], { session_id: 's', cwd: '/p', hook_event_name: 'UserPromptSubmit' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version); // baked in at build time
    expect(readEvents(home)).toHaveLength(0);
  });
});

describe('cowait split', () => {
  const cmd = ['/opt/cowait/bin/cowait'];
  const cwd = '/home/me/my project';

  it('finds no terminal it can split', () => {
    expect(splitPlan(cmd, cwd, {})).toBeNull();
    expect(splitPlan(cmd, cwd, { TERM_PROGRAM: 'Apple_Terminal' })).toBeNull();
  });

  it('opens Windows Terminal detached with the command as separate arguments', () => {
    const p = splitPlan(['C:\\node.exe', 'G:\\Co wait\\dist\\cli.js'], 'G:\\proj', { WT_SESSION: 'x' })!;
    expect(p).toEqual({ via: 'windows-terminal', bin: 'wt.exe', args: ['-w', '0', 'sp', '-V', '-s', '0.4', '-d', 'G:\\proj', 'C:\\node.exe', 'G:\\Co wait\\dist\\cli.js'], detached: true });
  });

  it('quotes each argument for tmux, which takes a shell command', () => {
    const p = splitPlan(['/usr/bin/node', "/it's here/dist/cli.js"], cwd, { TMUX: '/tmp/tmux-1/default,1,0' })!;
    expect(p.bin).toBe('tmux');
    expect(p.args).toEqual(['split-window', '-h', '-l', '40%', '-c', cwd, `/usr/bin/node '/it'\\''s here/dist/cli.js'`]);
  });

  it('passes argv straight through for zellij, WezTerm and kitty', () => {
    expect(splitPlan(cmd, cwd, { ZELLIJ: '0' })).toMatchObject({ bin: 'zellij', args: ['run', '--direction', 'right', '--close-on-exit', '--name', 'cowait', '--cwd', cwd, '--', ...cmd] });
    expect(splitPlan(cmd, cwd, { WEZTERM_PANE: '3' })).toMatchObject({ bin: 'wezterm', args: ['cli', 'split-pane', '--right', '--percent', '40', '--cwd', cwd, '--', ...cmd] });
    expect(splitPlan(cmd, cwd, { KITTY_WINDOW_ID: '1' })).toMatchObject({ bin: 'kitty', args: ['@', 'launch', '--location=vsplit', '--bias=40', '--cwd=current', ...cmd] });
  });

  it('drives iTerm2 through osascript, with the folder and command as script arguments', () => {
    const p = splitPlan(cmd, cwd, { TERM_PROGRAM: 'iTerm.app' })!;
    expect(p.bin).toBe('osascript');
    expect(p.args.slice(-2)).toEqual([cwd, ...cmd]);
    expect(p.args.filter((a) => a !== '-e').slice(0, -2).join('\n')).toMatch(/^on run argv[\s\S]*quoted form of[\s\S]*split vertically[\s\S]*end run$/);
  });

  it('prefers a multiplexer over the terminal it runs in', () => {
    expect(splitPlan(cmd, cwd, { TMUX: '1', WEZTERM_PANE: '1', WT_SESSION: '1' })!.via).toBe('tmux');
    expect(splitPlan(cmd, cwd, { ZELLIJ: '0', KITTY_WINDOW_ID: '1' })!.via).toBe('zellij');
  });

  it('shell-quotes only when needed', () => {
    expect(shQuote('/usr/bin/node')).toBe('/usr/bin/node');
    expect(shQuote('a b')).toBe("'a b'");
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
    expect(shQuote('$HOME')).toBe("'$HOME'");
  });
});
