#!/usr/bin/env node
/**
 * Records the README pictures from the real panel, on a light background:
 *   docs/media/demo-{en,zh}.gif           the walkthrough at the top of the README
 *   docs/media/{review,battle,learn,me}-{en,zh}.png
 *
 * Works on Windows, macOS and Linux. Needs Chrome, Chromium or Edge (to draw the terminal) and
 * ffmpeg (to make the GIF); set CHROME=… or FFMPEG=… if they are not found.
 *   npm run media              everything
 *   npm run media -- png       only the screenshots
 * Temporary files go to data/.media (inside the clone, so nothing lands on the system drive).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import stringWidth from 'string-width';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(root, 'docs', 'media');
const tmp = path.join(root, 'data', '.media');
const only = process.argv[2];

// ------------------------------------------------------------------ tools

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const env = process.env;
  const candidates =
    process.platform === 'win32'
      ? [
          `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const c of candidates) {
    if (path.isAbsolute(c) ? fs.existsSync(c) : spawnSync('which', [c]).status === 0) return c;
  }
  throw new Error('Chrome/Chromium/Edge not found: set CHROME=/path/to/chrome');
}

const FFMPEG = process.env.FFMPEG || 'ffmpeg';

// ------------------------------------------------------------------ terminal frame → HTML

const BG = '#ffffff';
const FG = '#1f2328';
// Ink's named colours, re-tuned to read well on white.
const PALETTE = {
  30: '#1f2328', 31: '#cf222e', 32: '#1a7f37', 33: '#9a6700', 34: '#0969da', 35: '#8250df', 36: '#0b7285', 37: '#6e7781',
  90: '#6e7781', 91: '#d1242f', 92: '#1a7f37', 93: '#9a6700', 94: '#0969da', 95: '#8250df', 96: '#0b7285', 97: '#1f2328',
};
const CELL_W = 9;
const CELL_H = 20;
// Box drawing and bar characters are drawn as shapes, so borders join up and bars look solid.
const SHAPES = { '─': 'h', '│': 'v', '╭': 'tl', '╮': 'tr', '╰': 'bl', '╯': 'br', '█': 'blk', '░': 'shd' };
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function parseAnsi(text) {
  const rows = [[]];
  let st = { fg: null, bg: null, bold: false, dim: false, inv: false };
  const put = (s) => {
    for (const { segment: g } of graphemes.segment(s)) {
      if (g === '\n') rows.push([]);
      else if (g !== '\r') rows.at(-1).push({ g, w: stringWidth(g), ...st });
    }
  };
  let last = 0;
  for (const m of text.matchAll(/\x1b\[([0-9;?]*)([A-Za-z])/g)) {
    put(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== 'm') continue;
    const ps = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      if (p === 0) st = { fg: null, bg: null, bold: false, dim: false, inv: false };
      else if (p === 1) st = { ...st, bold: true };
      else if (p === 2) st = { ...st, dim: true };
      else if (p === 22) st = { ...st, bold: false, dim: false };
      else if (p === 7) st = { ...st, inv: true };
      else if (p === 27) st = { ...st, inv: false };
      else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) st = { ...st, fg: PALETTE[p] };
      else if (p === 39) st = { ...st, fg: null };
      else if ((p >= 40 && p <= 47) || (p >= 100 && p <= 107)) st = { ...st, bg: PALETTE[p - 10] };
      else if (p === 49) st = { ...st, bg: null };
      else if ((p === 38 || p === 48) && ps[k + 1] === 2) {
        const hex = '#' + ps.slice(k + 2, k + 5).map((n) => n.toString(16).padStart(2, '0')).join('');
        st = p === 38 ? { ...st, fg: hex } : { ...st, bg: hex };
        k += 4;
      } else if ((p === 38 || p === 48) && ps[k + 1] === 5) k += 2;
    }
  }
  put(text.slice(last));
  return rows;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function termHtml(ansi, rows) {
  const lines = parseAnsi(ansi).slice(0, rows);
  while (lines.length < rows) lines.push([]);
  return lines
    .map((cells) => {
      const html = cells
        .map((c) => {
          let fg = c.fg ?? FG;
          let bg = c.bg;
          if (c.inv) [fg, bg] = [BG, fg];
          const cls = [`w${c.w}`];
          if (c.bold) cls.push('b');
          if (c.dim) cls.push('d');
          const shape = SHAPES[c.g];
          if (shape) cls.push(shape);
          else if (c.w === 2) cls.push(/\p{Extended_Pictographic}/u.test(c.g) ? 'emo' : 'cjk');
          const style = `color:${fg}${bg ? `;background:${bg}` : ''}`;
          return `<i class="${cls.join(' ')}" style="${style}">${shape || c.g === ' ' ? '' : esc(c.g)}</i>`;
        })
        .join('');
      return `<div class="r">${html}</div>`;
    })
    .join('');
}

const CSS = `
html,body{margin:0}
body{background:linear-gradient(135deg,#f6f8fb 0%,#eef2f7 100%);padding:28px;display:flex;gap:28px;align-items:flex-start;width:max-content}
.win{background:${BG};border:1px solid #dde2e8;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(31,35,40,.06),0 14px 36px rgba(31,35,40,.12)}
.bar{height:34px;background:#f6f7f9;border-bottom:1px solid #e7eaee;position:relative;display:flex;align-items:center;padding:0 14px}
.dot{width:12px;height:12px;border-radius:50%;margin-right:8px}
.title{position:absolute;left:0;right:0;text-align:center;font:13px/34px -apple-system,"Segoe UI",system-ui,sans-serif;color:#8b949e}
.term{padding:14px 18px;font:15px/${CELL_H}px "Cascadia Mono",Consolas,"SF Mono",Menlo,"DejaVu Sans Mono",monospace;color:${FG}}
.r{display:flex;height:${CELL_H}px;white-space:pre}
i{font-style:normal;display:block;flex:none;height:${CELL_H}px;text-align:center;position:relative}
.w0{width:0}.w1{width:${CELL_W}px}.w2{width:${CELL_W * 2}px}
.b{font-weight:700}.d{opacity:.5}
.cjk{font-family:"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Noto Sans SC",sans-serif;font-size:16px}
.emo{font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif;font-size:13px}
i::before{content:"";position:absolute;border:0 solid currentColor}
.h::before{left:0;right:0;top:9.25px;border-top-width:1.5px}
.v::before{top:0;bottom:0;left:3.75px;border-left-width:1.5px}
.tl::before{left:3.75px;top:9.25px;right:0;bottom:0;border-left-width:1.5px;border-top-width:1.5px;border-top-left-radius:6px}
.tr::before{left:0;top:9.25px;right:3.75px;bottom:0;border-right-width:1.5px;border-top-width:1.5px;border-top-right-radius:6px}
.bl::before{left:3.75px;top:0;right:0;bottom:9.25px;border-left-width:1.5px;border-bottom-width:1.5px;border-bottom-left-radius:6px}
.br::before{left:0;top:0;right:3.75px;bottom:9.25px;border-right-width:1.5px;border-bottom-width:1.5px;border-bottom-right-radius:6px}
.blk::before{left:0;right:0;top:6px;bottom:6px;background:currentColor}
.shd::before{left:0;right:0;top:6px;bottom:6px;background:currentColor;opacity:.18}
`;

function windowHtml(ansi, cols, rows) {
  const dots = ['#ff5f57', '#febc2e', '#28c840'].map((c) => `<span class="dot" style="background:${c}"></span>`).join('');
  return `<div class="win"><div class="bar">${dots}<span class="title">cowait</span></div><div class="term" style="width:${cols * CELL_W}px">${termHtml(ansi, rows)}</div></div>`;
}

function pageSize(cols, rows) {
  return { w: cols * CELL_W + 36 + 2 + 56, h: 34 + 1 + rows * CELL_H + 28 + 2 + 56 };
}

// ------------------------------------------------------------------ screenshots

let profiles = 0;
/** A headless Chrome now and then exits without writing the file: try again a couple of times. */
async function screenshot(chrome, ansi, cols, rows, png, scale) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await screenshotOnce(chrome, ansi, cols, rows, png, scale);
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

function screenshotOnce(chrome, ansi, cols, rows, png, scale) {
  const html = path.join(tmp, `${path.basename(png, '.png')}.html`);
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${windowHtml(ansi, cols, rows)}`);
  const { w, h } = pageSize(cols, rows);
  const profile = path.join(tmp, `chrome-${profiles++ % 4}`);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${scale}`,
    `--window-size=${w},${h}`,
    `--screenshot=${png}`,
    pathToFileURL(html).href,
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(chrome, args, { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('exit', () => (fs.existsSync(png) ? resolve(png) : reject(new Error(`no screenshot for ${png}`))));
  });
}

/** Run tasks a few at a time (each one is a short-lived headless browser). */
async function pool(tasks, n = 4) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < tasks.length) {
        const k = i++;
        results[k] = await tasks[k]();
      }
    }),
  );
  return results;
}

function gif(framePngs, durations, target) {
  const list = path.join(tmp, `${path.basename(target)}.txt`);
  const lines = ['ffconcat version 1.0'];
  framePngs.forEach((f, i) => lines.push(`file '${f.replace(/\\/g, '/')}'`, `duration ${(durations[i] / 1000).toFixed(3)}`));
  lines.push(`file '${framePngs.at(-1).replace(/\\/g, '/')}'`);
  fs.writeFileSync(list, lines.join('\n'));
  const r = spawnSync(
    FFMPEG,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-fps_mode', 'vfr', '-loop', '0', target],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.error?.message ?? r.status}): is it installed? Set FFMPEG=/path/to/ffmpeg`);
}

// ------------------------------------------------------------------ main

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const chrome = findChrome();

// Colours on: Ink only emits them when it believes the output is a colour terminal.
delete process.env.NO_COLOR;
process.env.FORCE_COLOR = '3';
await build({
  entryPoints: [path.join(root, 'scripts', 'media', 'scenes.tsx')],
  outfile: path.join(tmp, 'scenes.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
  jsx: 'automatic',
  banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'stub-devtools',
      setup(b) {
        b.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default { initialize() {}, connectToDevTools() {} };' }));
      },
    },
  ],
});
const scenes = await import(pathToFileURL(path.join(tmp, 'scenes.mjs')).href);

for (const lang of ['en', 'zh']) {
  for (const [name, shot] of [
    ['review', scenes.reviewShot],
    ['battle', scenes.battleShot],
    ['learn', scenes.learnShot],
    ['me', scenes.meShot],
  ]) {
    const ansi = await shot(path.join(tmp, `home-${name}-${lang}`), lang);
    const png = path.join(out, `${name}-${lang}.png`);
    await screenshot(chrome, ansi, 76, 24, png, 2);
    console.log('wrote', path.relative(root, png));
  }
  if (only === 'png') continue;

  const frames = (await scenes.demoGif(path.join(tmp, `home-demo-${lang}`), lang)).filter((f) => f.ms >= 25);
  const dir = path.join(tmp, `gif-${lang}`);
  fs.mkdirSync(dir, { recursive: true });
  const pngs = await pool(frames.map((f, i) => () => screenshot(chrome, f.ansi, 80, 28, path.join(dir, `f${String(i).padStart(4, '0')}.png`), 1)));
  const target = path.join(out, `demo-${lang}.gif`);
  gif(pngs, frames.map((f) => f.ms), target);
  console.log('wrote', path.relative(root, target), `(${frames.length} frames, ${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
}

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
