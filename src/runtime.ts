/**
 * How this copy of Cowait is running: its version, where it lives, and whether it is a
 * standalone binary (`bun build --compile`) or Node running the dist/*.js bundles.
 *
 * Kept free of other Cowait imports: the hook bundle pulls this in through paths.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Replaced with the package.json version by scripts/build.mjs (esbuild `define`). */
declare const __COWAIT_VERSION__: string | undefined;

/** Folder that contains package.json (dist/ and src/ both sit one level below it). */
export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Bun mounts the code of a compiled executable on a virtual file system:
 * `/$bunfs/root/<name>` on macOS/Linux and `B:/~BUN/root/<name>` on Windows
 * (`import.meta.url` percent-encodes the tilde: `file:///B:/%7EBUN/root/<name>`).
 */
const BUNFS = /^\/?(?:\$bunfs[\\/]|b:[\\/]~bun[\\/])/i;

export function isBunfsPath(p: string): boolean {
  let s = p;
  if (s.startsWith('file:')) {
    try {
      s = decodeURIComponent(s.replace(/^file:\/\//, ''));
    } catch {
      s = s.replace(/^file:\/\//, '');
    }
  }
  return BUNFS.test(s);
}

let compiledOverride: boolean | null = null;

/** Tests only: pretend to be (or not be) a compiled binary. `null` restores detection. */
export function setCompiledForTests(v: boolean | null): void {
  compiledOverride = v;
}

/** True inside a Bun single-file executable, false under Node (and under plain `bun dist/cli.js`). */
export function isCompiled(): boolean {
  if (compiledOverride !== null) return compiledOverride;
  if (!process.versions.bun) return false;
  const main = (globalThis as { Bun?: { main?: unknown } }).Bun?.main;
  return [typeof main === 'string' ? main : '', import.meta.url, process.argv[1] ?? ''].some((p) => p && isBunfsPath(p));
}

/** The Cowait version: baked in at build time, else read from package.json (tests, unbundled runs). */
export function appVersion(): string {
  if (typeof __COWAIT_VERSION__ === 'string' && __COWAIT_VERSION__) return __COWAIT_VERSION__;
  try {
    return JSON.parse(fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** argv that starts this Cowait again: the binary itself, or Node + dist/cli.js. */
export function selfCommand(): string[] {
  if (isCompiled()) return [process.execPath];
  return [process.execPath, path.join(packageRoot(), 'dist', 'cli.js')];
}

// ------------------------------------------------------------------ cowait split

export interface SplitPlan {
  /** Which terminal or multiplexer was detected. */
  via: 'tmux' | 'zellij' | 'wezterm' | 'kitty' | 'iterm2' | 'windows-terminal';
  bin: string;
  args: string[];
  /** Run in the background and return at once (Windows Terminal), instead of waiting for the launcher. */
  detached?: boolean;
}

/** POSIX shell quoting: one argument, single-quoted. */
export function shQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** iTerm2: split the current session side by side, cd into argv[1] and exec the rest of argv there. */
const ITERM_SCRIPT = [
  'on run argv',
  '  set cmdLine to "cd " & quoted form of (item 1 of argv) & " && exec"',
  '  repeat with i from 2 to count of argv',
  '    set cmdLine to cmdLine & " " & quoted form of (item i of argv)',
  '  end repeat',
  '  tell application "iTerm2"',
  '    tell current session of current window',
  '      set newSession to (split vertically with same profile)',
  '    end tell',
  '    tell newSession to write text cmdLine',
  '  end tell',
  'end run',
];

/**
 * How to open the panel in a split next to the current pane, or null when no supported
 * terminal is detected. Multiplexers come first: tmux inside WezTerm should split the tmux window.
 * Every launcher gets the command as separate arguments, never as one concatenated shell string,
 * except tmux, whose split-window takes a shell command (each argument is quoted).
 */
export function splitPlan(cmd: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): SplitPlan | null {
  if (env.TMUX) return { via: 'tmux', bin: 'tmux', args: ['split-window', '-h', '-l', '40%', '-c', cwd, cmd.map(shQuote).join(' ')] };
  if (env.ZELLIJ)
    return { via: 'zellij', bin: 'zellij', args: ['run', '--direction', 'right', '--close-on-exit', '--name', 'cowait', '--cwd', cwd, '--', ...cmd] };
  if (env.WEZTERM_PANE)
    return { via: 'wezterm', bin: 'wezterm', args: ['cli', 'split-pane', '--right', '--percent', '40', '--cwd', cwd, '--', ...cmd] };
  // Needs remote control (allow_remote_control in kitty.conf); vsplit needs the splits layout.
  if (env.KITTY_WINDOW_ID) return { via: 'kitty', bin: 'kitty', args: ['@', 'launch', '--location=vsplit', '--bias=40', '--cwd=current', ...cmd] };
  // osascript hands the arguments after the -e lines to `on run argv`; cwd and cmd are absolute paths.
  if (env.TERM_PROGRAM === 'iTerm.app') return { via: 'iterm2', bin: 'osascript', args: [...ITERM_SCRIPT.flatMap((l) => ['-e', l]), cwd, ...cmd] };
  if (env.WT_SESSION) return { via: 'windows-terminal', bin: 'wt.exe', args: ['-w', '0', 'sp', '-V', '-s', '0.4', '-d', cwd, ...cmd], detached: true };
  return null;
}
