/**
 * Open a web page in the default browser, without going through a shell.
 *
 * Windows: `cmd /c start "" <url>` would let cmd.exe read the URL, and cmd treats `&`, `|`, `^`, `<`, `>`
 * as syntax: `https://x/?a=1&b=2` runs `b=2` as a command, and `^&` escaping only holds while Node
 * leaves the argument unquoted. Instead we run rundll32 (by absolute path, so a rundll32.exe in the
 * current folder is never picked up) with `url.dll,FileProtocolHandler`, which hands the URL to
 * ShellExecute: no command interpreter ever parses it.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

/** The normalised URL if it is a plain http(s) URL we are willing to hand to the OS, else null. */
export function safeHttpUrl(url: string): string | null {
  if (typeof url !== 'string') return null;
  let href: string;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    href = u.href;
  } catch {
    return null;
  }
  // The URL parser percent-encodes these almost everywhere, but not in the host. They would change
  // how Windows splits the command line, so refuse rather than guess.
  if (/["\s\x00-\x1f\x7f]/.test(href)) return null;
  return href;
}

/** The program and arguments that open `url` on `platform`, or null if the URL is not allowed. */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } | null {
  const href = safeHttpUrl(url);
  if (!href) return null;
  if (platform === 'win32') {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    return { cmd: path.win32.join(root, 'System32', 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', href] };
  }
  if (platform === 'darwin') return { cmd: '/usr/bin/open', args: [href] };
  return { cmd: 'xdg-open', args: [href] };
}

/** Open `url` (http/https only) in the default browser. False if it is not allowed or nothing could be started. */
export function openUrl(url: string): boolean {
  const c = browserCommand(url);
  if (!c) return false;
  try {
    const child = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {
      /* e.g. no xdg-open: nothing to do, the caller shows the URL anyway */
    });
    child.unref();
    // A program that cannot be started (ENOENT, EACCES) has no pid; the error event comes later.
    return child.pid !== undefined;
  } catch {
    return false;
  }
}
