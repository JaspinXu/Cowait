/**
 * Where AI-written flashcards come from:
 *   - ANTHROPIC_API_KEY set  → Messages API with a small, cheap model.
 *   - otherwise `claude` CLI → `claude -p` in print mode, using the account you are already signed in with.
 * Our own `claude -p` call runs with COWAIT_INTERNAL=1 so the Cowait hook ignores it.
 */
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import type { Config } from '../config.js';

export type Provider = 'anthropic' | 'claude-cli';

let cliAvailable: boolean | undefined;

export function hasClaudeCli(): boolean {
  if (cliAvailable === undefined) {
    // On Windows `claude` is a .cmd shim, which needs a shell; pass one command string, not an args array.
    const r =
      process.platform === 'win32'
        ? spawnSync('claude --version', { shell: true, timeout: 10000, stdio: 'ignore', windowsHide: true })
        : spawnSync('claude', ['--version'], { timeout: 10000, stdio: 'ignore' });
    cliAvailable = r.status === 0;
  }
  return cliAvailable;
}

export function detectProvider(cfg: Config): Provider | null {
  if (cfg.llm === 'off') return null;
  if ((cfg.llm === 'auto' || cfg.llm === 'anthropic') && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if ((cfg.llm === 'auto' || cfg.llm === 'claude-cli') && hasClaudeCli()) return 'claude-cli';
  return null;
}

async function viaApi(prompt: string, cfg: Config): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: cfg.model, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  return (json.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
}

function viaCli(prompt: string, cfg: Config): Promise<string> {
  return new Promise((resolve, reject) => {
    const model = /^[\w.-]+$/.test(cfg.cliModel) ? cfg.cliModel : 'haiku';
    const args = ['-p', '--model', model, '--output-format', 'text'];
    const opts = { cwd: os.tmpdir(), env: { ...process.env, COWAIT_INTERNAL: '1' }, windowsHide: true };
    // The prompt goes over stdin, so the command line only ever holds these fixed, validated words.
    const child = process.platform === 'win32' ? spawn(['claude', ...args].join(' '), { ...opts, shell: true }) : spawn('claude', args, opts);
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude -p timed out'));
    }, 180_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().slice(0, 200) || `claude exited with code ${code}`));
    });
    child.stdin.end(prompt);
  });
}

export async function complete(prompt: string, cfg: Config): Promise<string> {
  const p = detectProvider(cfg);
  if (!p) throw new Error('NO_PROVIDER');
  return p === 'anthropic' ? viaApi(prompt, cfg) : viaCli(prompt, cfg);
}
