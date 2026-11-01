/**
 * `cowait update`: how this copy was installed, whether a newer version exists, and the
 * exact command that updates it. Checking never throws and gives up after a few seconds.
 */
import type { Lang } from './i18n.js';
import { isCompiled, packageRoot } from './runtime.js';

export type InstallKind = 'binary' | 'npm' | 'clone';

export const REGISTRY_LATEST = 'https://registry.npmjs.org/cowait-cli/latest';
export const RELEASES = 'https://github.com/JaspinXu/Cowait/releases/latest/download';

/** binary: a standalone executable; npm: a package inside node_modules; clone: a git checkout. */
export function installKind(root = packageRoot(), compiled = isCompiled()): InstallKind {
  if (compiled) return 'binary';
  return root.split(/[\\/]/).includes('node_modules') ? 'npm' : 'clone';
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Latest published version on npm, or null when offline, slow (default 3 s), or the answer is not a version. */
export async function latestVersion(opts: { fetch?: FetchLike; timeoutMs?: number; url?: string } = {}): Promise<string | null> {
  const f: FetchLike | undefined = opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (typeof f !== 'function') return null;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race the request against a timer too: an injected fetch may ignore the abort signal.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(null);
    }, opts.timeoutMs ?? 3000);
  });
  const lookup = (async () => {
    const res = await f(opts.url ?? REGISTRY_LATEST, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: unknown } | null)?.version;
    return typeof v === 'string' && parseSemver(v) ? v : null;
  })().catch(() => null);
  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface Semver {
  core: [number, number, number];
  pre: string[];
}

function parseSemver(v: string): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** Semver precedence: negative when a < b, 0 when equal (build metadata ignored), positive when a > b. */
function compare(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  // A pre-release sorts before its release: 1.0.0-beta < 1.0.0.
  if (!a.pre.length || !b.pre.length) return (a.pre.length ? -1 : 0) + (b.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xn !== yn) return xn ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Is version `a` newer than version `b`? False when either is not a valid version. */
export function isNewer(a: string, b: string): boolean {
  const x = parseSemver(a);
  const y = parseSemver(b);
  return !!x && !!y && compare(x, y) > 0;
}

/**
 * The exact command that updates this kind of install. The command does not depend on `lang`
 * (it is accepted so callers can pass their language uniformly); `platform` picks the installer.
 */
export function updateCommand(kind: InstallKind, _lang: Lang = 'en', opts: { platform?: NodeJS.Platform; root?: string } = {}): string {
  const platform = opts.platform ?? process.platform;
  if (kind === 'npm') return 'npm i -g cowait-cli@latest';
  if (kind === 'clone') return `git -C "${opts.root ?? packageRoot()}" pull --ff-only`;
  // Re-running the installer replaces the binary in place, so the hooks keep pointing at it.
  return platform === 'win32' ? `irm ${RELEASES}/install.ps1 | iex` : `curl -fsSL ${RELEASES}/install.sh | sh`;
}
