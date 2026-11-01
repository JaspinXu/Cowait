// Build standalone Cowait executables with Bun (`bun build --compile`): one file per platform that
// carries its own runtime, so users need neither Node nor npm.
//
//   node scripts/compile.mjs                           all five targets
//   node scripts/compile.mjs --target bun-linux-x64    only these (repeat, or separate with commas)
//   node scripts/compile.mjs --sums                    only rewrite release/SHA256SUMS (e.g. after codesigning)
//
// Output: release/cowait-<os>-<arch>[.exe] and release/SHA256SUMS (sha256sum format).
// Bun comes from $BUN, else `bun` on PATH, else `npx bun@BUN_VERSION`.
// Cross-compiling downloads each target's runtime (~100 MB) once. Unless BUN_INSTALL_CACHE_DIR is
// set, that cache goes to node_modules/.cache/bun inside this clone instead of the home folder.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = ['bun-windows-x64', 'bun-linux-x64', 'bun-linux-arm64', 'bun-darwin-x64', 'bun-darwin-arm64'];
const BUN_VERSION = '1.4.4';
const OUT = 'release';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const isWin = process.platform === 'win32';
const winQuote = (s) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);

/** Run a command, inheriting stdio. On Windows go through the shell so .cmd shims (npx, bun.cmd) work. */
function run(cmd, args, opts = {}) {
  const r = isWin
    ? spawnSync([cmd, ...args].map(winQuote).join(' '), { stdio: 'inherit', shell: true, ...opts })
    : spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  return r.status === 0;
}

function findBun() {
  if (process.env.BUN) return [process.env.BUN];
  const probe = isWin ? spawnSync('bun --version', { shell: true, stdio: 'ignore' }) : spawnSync('bun', ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) return ['bun'];
  console.log(`bun not found on PATH; using npx bun@${BUN_VERSION}`);
  return ['npx', '--yes', `bun@${BUN_VERSION}`];
}

function parseTargets(argv) {
  const picked = [];
  argv.forEach((a, i) => {
    if (a === '--target') picked.push(argv[i + 1] ?? '');
    else if (a.startsWith('--target=')) picked.push(a.slice('--target='.length));
  });
  const list = picked.flatMap((t) => t.split(',')).map((t) => t.trim()).filter(Boolean);
  for (const t of list) {
    if (!/^bun-(windows|linux|darwin)-(x64|arm64)(-[a-z]+)*$/.test(t)) {
      console.error(`Unknown target "${t}". Known: ${TARGETS.join(', ')}`);
      process.exit(1);
    }
  }
  return list.length ? list : TARGETS;
}

/** bun-windows-x64 → cowait-windows-x64.exe, bun-linux-x64-musl → cowait-linux-x64-musl */
const outName = (target) => `cowait-${target.replace(/^bun-/, '')}${target.startsWith('bun-windows') ? '.exe' : ''}`;

function writeSums() {
  const files = fs
    .readdirSync(OUT)
    .filter((f) => f.startsWith('cowait-') && fs.statSync(path.join(OUT, f)).isFile())
    .sort();
  const lines = files.map((f) => `${createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex')}  ${f}`);
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS'), lines.join('\n') + '\n');
  for (const f of files) console.log(`  ${f.padEnd(28)} ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)} MB`);
  console.log(`  ${'SHA256SUMS'.padEnd(28)} ${files.length} file(s)`);
}

const argv = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

if (!argv.includes('--sums')) {
  if (!fs.existsSync('dist/cli.js')) {
    console.log('dist/cli.js is missing: building it first');
    if (!run(process.execPath, ['scripts/build.mjs'])) process.exit(1);
  }
  const bun = findBun();
  const env = { ...process.env, BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR || path.resolve('node_modules/.cache/bun') };
  for (const target of parseTargets(argv)) {
    const outfile = path.join(OUT, outName(target));
    console.log(`\n${target} → ${outfile}`);
    // --bytecode precompiles the bundle: the hook (run on every tool call) starts about a third faster.
    const ok = run(bun[0], [...bun.slice(1), 'build', 'dist/cli.js', '--compile', '--minify', '--bytecode', `--target=${target}`, '--outfile', outfile], { env });
    if (!ok) {
      console.error(`Failed to compile ${target}`);
      process.exit(1);
    }
  }
}
console.log('');
writeSums();
