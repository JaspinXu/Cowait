#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { loadConfig, saveConfig, DEFAULT_CONFIG, type Config } from './config.js';
import { resolveLang, t, fmtDur, type Lang } from './i18n.js';
import { dataDir, packageRoot, paths } from './paths.js';
import { ensureDir } from './fsutil.js';
import { acquireLock, loadState, releaseLock, saveState } from './engine/store.js';
import { coverage, pendingCards } from './engine/state.js';
import { grantDaily } from './engine/economy.js';
import { claudeSettingsPath, hookCommand, hookStatus, install, ourHookCommand, readClaudeSettings, uninstall, type Scope } from './install.js';
import { statusLine } from './statusline.js';
import { detectProvider } from './learn/llm.js';

function version(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const bad = (s: string) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
const info = (s: string) => console.log(`  \x1b[90m•\x1b[0m ${s}`);

// ------------------------------------------------------------------ panel

async function runPanel(opts: { demo?: boolean; fast?: boolean } = {}): Promise<void> {
  if (opts.demo) {
    const demoHome = path.join(dataDir(), 'demo');
    fs.rmSync(demoHome, { recursive: true, force: true });
    ensureDir(demoHome);
    process.env.COWAIT_HOME = demoHome;
  }
  const cfg = loadConfig();
  const lang = resolveLang(cfg);
  const lock = acquireLock();
  if (!lock.ok) {
    console.error(t(lang, 'another', { pid: lock.pid }));
    process.exit(1);
  }
  const state = loadState();
  const daily = grantDaily(state, Date.now());
  saveState(state);

  const [{ render }, React, { App }] = await Promise.all([import('ink'), import('react'), import('./ui/App.js')]);
  let stopDemo: (() => void) | undefined;
  if (opts.demo) stopDemo = (await import('./demo.js')).startDemo(opts.fast ? 0.35 : 1);

  const alt = process.stdout.isTTY;
  if (alt) process.stdout.write('\x1b[?1049h\x1b[H');
  const restore = () => {
    if (alt) process.stdout.write('\x1b[?1049l');
    releaseLock();
  };
  process.on('exit', restore);
  const app = render(React.createElement(App, { cfg, lang, initial: state, daily }), { exitOnCtrlC: true });
  await app.waitUntilExit();
  stopDemo?.();
  restore();
  process.removeListener('exit', restore);
  process.exit(0);
}

// ------------------------------------------------------------------ install / doctor

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes' || answer === '是';
  } finally {
    rl.close();
  }
}

async function cmdInstall(args: string[], lang: Lang): Promise<void> {
  const scope: Scope = flag(args, '--project') ? 'project' : 'user';
  const zh = lang === 'zh';
  const file = claudeSettingsPath(scope);
  const statusline = flag(args, '--statusline');

  // Say exactly what will change before touching anything.
  console.log(zh ? '\ncowait install 将会：' : '\ncowait install will:');
  info(`${zh ? '修改' : 'edit'} ${file}${fs.existsSync(file) ? '' : zh ? '（不存在，会新建）' : ' (does not exist yet, will be created)'}`);
  info(
    zh
      ? '添加 5 条 hooks（UserPromptSubmit / PostToolUse / Stop / Notification / SessionEnd），' + (scope === 'user' ? '对这台电脑上所有项目的 Claude Code 生效' : '只对当前项目生效')
      : 'add 5 hooks (UserPromptSubmit / PostToolUse / Stop / Notification / SessionEnd), ' + (scope === 'user' ? 'for every project on this machine' : 'for this project only'),
  );
  if (statusline) info(zh ? '启用 Cowait 状态栏（已有自定义状态栏时不覆盖，除非 --force）' : 'enable the Cowait status line (an existing one is kept unless --force)');
  info(zh ? '其他配置一律不动；改之前先备份原文件；随时可以 cowait uninstall 撤销' : 'leave everything else untouched, back the file up first, and can be undone with cowait uninstall');
  if (scope === 'user') info(zh ? '只想在一个项目里试？用 cowait install --project' : 'Just trying it in one project? Use cowait install --project');

  if (!flag(args, '--yes') && !flag(args, '-y')) {
    if (!process.stdin.isTTY) {
      console.log(zh ? '\n非交互环境：确认无误后加 --yes 重新运行。' : '\nNot interactive: re-run with --yes to confirm.');
      process.exitCode = 1;
      return;
    }
    if (!(await confirm(zh ? '\n继续吗？[Y/n] ' : '\nContinue? [Y/n] '))) {
      console.log(zh ? '已取消，什么都没改。' : 'Cancelled. Nothing was changed.');
      return;
    }
  }

  const r = install({ scope, statusline, force: flag(args, '--force') });
  console.log(zh ? '\nCowait 已接入 Claude Code ✓' : '\nCowait is hooked into Claude Code ✓');
  ok(`${zh ? '配置文件' : 'settings'}: ${r.file}`);
  if (r.backup) ok(`${zh ? '原文件已备份到' : 'backup'}: ${r.backup}`);
  ok(`${zh ? '数据目录' : 'data folder'}: ${dataDir()}`);
  if (r.statusline === 'set') ok(zh ? '已启用 Cowait 状态栏' : 'Cowait status line enabled');
  if (r.statusline === 'kept-existing')
    info(zh ? '你已经有自定义状态栏，没有覆盖（加 --force 可替换，卸载时会还原）' : 'You already have a custom status line; kept it (use --force to replace; uninstall restores it)');
  console.log(
    zh
      ? '\n下一步：\n  1. 重启正在运行的 Claude Code 会话，让新 hooks 生效\n  2. 在旁边开一个终端分屏运行 `cowait`（Windows Terminal / tmux 里可以直接 `cowait split`）\n  3. 不放心可以先跑 `cowait doctor` 自检，或 `cowait demo` 试玩\n'
      : '\nNext:\n  1. Restart running Claude Code sessions so the hooks load\n  2. Run `cowait` in a pane next to Claude Code (`cowait split` does it in Windows Terminal / tmux)\n  3. `cowait doctor` checks the setup, `cowait demo` lets you try it\n',
  );
}

function cmdUninstall(args: string[], lang: Lang): void {
  const scope: Scope = flag(args, '--project') ? 'project' : 'user';
  const r = uninstall({ scope });
  const zh = lang === 'zh';
  if (r.changed) ok(zh ? `已从 ${r.file} 移除 Cowait 的 hooks（其他配置原样保留）` : `Removed Cowait hooks from ${r.file} (everything else untouched)`);
  else info(zh ? `${r.file} 里没有 Cowait 的配置` : `No Cowait entries in ${r.file}`);
  info(zh ? `你的数据还在 ${dataDir()}，不需要可以直接删除` : `Your data is still in ${dataDir()}; delete it if you like`);
}

function smokeTest(command: string): { ok: boolean; ms: number; detail: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cowait-doctor-'));
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'doctor', cwd: process.cwd(), prompt: 'doctor' });
  const t0 = Date.now();
  const r = spawnSync(command, { shell: true, input: payload, env: { ...process.env, COWAIT_HOME: tmp }, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const ms = Date.now() - t0;
  let logged = false;
  try {
    logged = fs.readFileSync(path.join(tmp, 'events.jsonl'), 'utf8').includes('"doctor"');
  } catch {
    /* no file */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.status === 0 && logged) return { ok: true, ms, detail: '' };
  return { ok: false, ms, detail: (r.stderr || r.error?.message || `exit ${r.status}`).toString().trim().slice(0, 300) };
}

function cmdDoctor(lang: Lang): void {
  const zh = lang === 'zh';
  console.log(zh ? '\nCowait 自检\n' : '\nCowait doctor\n');
  const major = Number(process.versions.node.split('.')[0]);
  (major >= 20 ? ok : bad)(`Node ${process.version} ${zh ? '（需要 ≥ 20）' : '(need ≥ 20)'}`);
  const hookJs = path.join(packageRoot(), 'dist', 'hook.js');
  (fs.existsSync(hookJs) ? ok : bad)(`${zh ? 'hook 脚本' : 'hook script'}: ${hookJs}`);

  let command: string | null = null;
  const inProject = hookStatus(readClaudeSettings('project')).installed.length > 0;
  for (const scope of ['user', 'project'] as Scope[]) {
    const s = readClaudeSettings(scope);
    const st = hookStatus(s);
    const file = claudeSettingsPath(scope);
    if (st.installed.length === 0) {
      if (scope !== 'user') continue;
      // Project-only installs are a deliberate choice, not a problem.
      if (inProject) info(zh ? '全局没装（只在这个项目里生效，这是 --project 模式）' : 'Not installed globally (project-only, via --project)');
      else bad(zh ? `${file} 里还没有 Cowait 的 hooks —— 运行 cowait install（或 cowait install --project 只装当前项目）` : `No Cowait hooks in ${file} — run cowait install (or cowait install --project)`);
      continue;
    }
    command ??= ourHookCommand(s);
    if (st.missing.length) bad(`${file}: ${zh ? '缺少' : 'missing'} ${st.missing.join(', ')}`);
    else ok(`${zh ? 'hooks 已配置' : 'hooks configured'} (${st.installed.length}/5): ${file}`);
  }
  if (command && command !== hookCommand()) info(zh ? `已配置的 hook 命令指向别处：${command}` : `Configured hook command points elsewhere: ${command}`);
  const smoke = smokeTest(command ?? hookCommand());
  if (smoke.ok) ok(zh ? `hook 实测通过（${smoke.ms}ms）` : `hook smoke test passed (${smoke.ms}ms)`);
  else bad(`${zh ? 'hook 实测失败' : 'hook smoke test failed'}: ${smoke.detail}`);

  try {
    ensureDir(dataDir());
    fs.accessSync(dataDir(), fs.constants.W_OK);
    ok(`${zh ? '数据目录可写' : 'data folder writable'}: ${dataDir()}`);
  } catch {
    bad(`${zh ? '数据目录不可写' : 'data folder not writable'}: ${dataDir()}`);
  }
  try {
    const m = fs.statSync(paths.events()).mtimeMs;
    info(`${zh ? '最近一次收到 Claude Code 的事件' : 'last event from Claude Code'}: ${fmtDur(Date.now() - m)} ${zh ? '前' : 'ago'}`);
  } catch {
    info(zh ? '还没收到过 Claude Code 的事件（装好后重启 Claude Code，发一条消息试试）' : 'No events from Claude Code yet (restart Claude Code after installing and send a message)');
  }
  const prov = detectProvider(loadConfig());
  info(
    `${zh ? 'AI 出题' : 'AI flashcards'}: ${
      prov === 'anthropic' ? 'ANTHROPIC_API_KEY' : prov === 'claude-cli' ? (zh ? 'claude 命令（用你已登录的账号）' : 'claude CLI (your signed-in account)') : zh ? '不可用（内置卡组照常能用）' : 'unavailable (built-in decks still work)'
    }`,
  );
  console.log('');
}

// ------------------------------------------------------------------ misc commands

function cmdStats(lang: Lang): void {
  const s = loadState();
  const zh = lang === 'zh';
  const cov = coverage(s);
  const T = s.totals;
  console.log(zh ? '\nCowait 统计\n' : '\nCowait stats\n');
  console.log(`  ⚡ ${s.energy}   💰 ${s.coins}`);
  console.log(
    zh
      ? `  Claude 干活的轮次 ${T.turns} · 测试通过的轮次 ${T.testsPassed}\n  改动卡片 ${T.cards} · 你审过 ${T.reviewed + T.flagged}（标出问题 ${T.flagged}，已转达 ${T.delivered}）· 跳过 ${T.skipped} · 待审 ${pendingCards(s).length}\n  AI 代码人工审阅覆盖率 ${cov === null ? '—' : Math.round(cov * 100) + '%'}\n  刷卡 ${T.learned} 张 · 捉虫地牢 ${T.runs} 局，通关 ${T.wins} 次，最深第 ${T.bestFloor} 层`
      : `  Claude turns ${T.turns} · turns with passing tests ${T.testsPassed}\n  Change cards ${T.cards} · reviewed ${T.reviewed + T.flagged} (flagged ${T.flagged}, relayed ${T.delivered}) · skipped ${T.skipped} · pending ${pendingCards(s).length}\n  Human review coverage of AI code ${cov === null ? '—' : Math.round(cov * 100) + '%'}\n  Flashcards ${T.learned} · Debug Dungeon runs ${T.runs}, wins ${T.wins}, deepest floor ${T.bestFloor}`,
  );
  console.log('');
}

async function cmdLearn(args: string[], lang: Lang): Promise<void> {
  const topic = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '-n').join(' ').trim();
  const zh = lang === 'zh';
  if (!topic) {
    console.log(zh ? '用法：cowait learn "想学的主题" [-n 12]' : 'Usage: cowait learn "topic" [-n 12]');
    return;
  }
  const n = Math.max(3, Math.min(30, Number(opt(args, '-n') ?? 12) || 12));
  const cfg = loadConfig();
  if (!detectProvider(cfg)) {
    console.log(t(lang, 'ln_no_provider'));
    process.exit(1);
  }
  console.log(zh ? `正在为「${topic}」出 ${n} 张卡……` : `Writing ${n} cards on "${topic}"…`);
  const { generateTopicDeck } = await import('./learn/generate.js');
  const { saveDeck } = await import('./learn/decks.js');
  const d = await generateTopicDeck(topic, n, lang, cfg);
  saveDeck(d);
  const s = loadState();
  s.learnDeck = d.id;
  saveState(s);
  ok(zh ? `好了，共 ${d.cards.length} 张，已设为当前卡组` : `Done: ${d.cards.length} cards, set as the current deck`);
}

function cmdSplit(lang: Lang): void {
  const cli = path.join(packageRoot(), 'dist', 'cli.js');
  const zh = lang === 'zh';
  if (process.env.WT_SESSION) {
    spawn('wt.exe', ['-w', '0', 'sp', '-V', '-s', '0.4', '-d', process.cwd(), process.execPath, cli], { detached: true, stdio: 'ignore' }).unref();
    ok(zh ? '已在 Windows Terminal 右侧分屏打开 Cowait' : 'Opened Cowait in a Windows Terminal split');
  } else if (process.env.TMUX) {
    spawnSync('tmux', ['split-window', '-h', '-l', '40%', `"${process.execPath}" "${cli}"`], { stdio: 'inherit' });
  } else {
    console.log(
      zh
        ? '没检测到 Windows Terminal 或 tmux。请自己开一个新终端窗口或分屏，运行：cowait'
        : 'No Windows Terminal or tmux detected. Open another terminal pane and run: cowait',
    );
  }
}

function cmdConfig(args: string[], lang: Lang): void {
  const cfg = loadConfig();
  const [key, value] = args;
  if (!key) {
    console.log(`# ${paths.config()}`);
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  if (!(key in DEFAULT_CONFIG)) {
    console.log(lang === 'zh' ? `没有这个配置项：${key}` : `Unknown key: ${key}`);
    process.exit(1);
  }
  const def = (DEFAULT_CONFIG as any)[key];
  const v: any = typeof def === 'boolean' ? ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase()) : typeof def === 'number' ? Number(value) : value;
  const next = { ...cfg, [key]: v } as Config;
  saveConfig(next);
  ok(`${key} = ${JSON.stringify(v)}`);
}

async function cmdStatusline(): Promise<void> {
  let raw = '';
  if (!process.stdin.isTTY) {
    raw = await new Promise<string>((resolve) => {
      let d = '';
      const timer = setTimeout(() => resolve(d), 800);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => (d += c));
      process.stdin.on('end', () => {
        clearTimeout(timer);
        resolve(d);
      });
    });
  }
  let input: any = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    /* ignore */
  }
  process.stdout.write(statusLine(input, loadState(), resolveLang(loadConfig())));
}

function help(lang: Lang): void {
  const zh = lang === 'zh';
  console.log(
    zh
      ? `Cowait v${version()} —— 把等 Claude Code 的时间变成有用的时间

用法：
  cowait                 打开面板（放在 Claude Code 旁边的分屏里）
  cowait install         接入 Claude Code（写入 ~/.claude/settings.json，会先备份）
      --project          只装到当前项目（.claude/settings.local.json）
      --yes              不再询问，直接安装（脚本里用）
      --statusline       同时启用 Cowait 状态栏（不会覆盖你已有的状态栏，除非加 --force）
  cowait uninstall       移除 hooks（其他配置不动）
  cowait doctor          自检
  cowait demo [--fast]   用模拟的 Claude 会话试玩，不需要 Claude Code
  cowait split           在 Windows Terminal / tmux 里分屏打开面板
  cowait learn "主题"    让 AI 出一组卡片 [-n 12]
  cowait stats           查看统计（含 AI 代码人工审阅覆盖率）
  cowait config [键 值]  查看或修改配置
`
      : `Cowait v${version()} — turn time spent waiting on Claude Code into useful time

Usage:
  cowait                 open the panel (put it in a pane next to Claude Code)
  cowait install         hook into Claude Code (edits ~/.claude/settings.json, backs it up first)
      --project          install for the current project only (.claude/settings.local.json)
      --yes              skip the confirmation (for scripts)
      --statusline       also enable the Cowait status line (never replaces yours unless --force)
  cowait uninstall       remove the hooks (nothing else is touched)
  cowait doctor          check the setup
  cowait demo [--fast]   try it with a simulated Claude session, no Claude Code needed
  cowait split           open the panel in a Windows Terminal / tmux split
  cowait learn "topic"   have AI write a flashcard deck [-n 12]
  cowait stats           stats, including human review coverage of AI code
  cowait config [k v]    show or change settings
`,
  );
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const lang = resolveLang(loadConfig());
  switch (cmd) {
    case undefined:
    case 'panel':
    case 'start':
      return runPanel();
    case 'demo':
      return runPanel({ demo: true, fast: flag(args, '--fast') });
    case 'install':
      return cmdInstall(args, lang);
    case 'uninstall':
      return cmdUninstall(args, lang);
    case 'doctor':
      return cmdDoctor(lang);
    case 'stats':
      return cmdStats(lang);
    case 'learn':
      return cmdLearn(args, lang);
    case 'split':
      return cmdSplit(lang);
    case 'config':
      return cmdConfig(args, lang);
    case 'statusline':
      return cmdStatusline();
    case '-v':
    case '--version':
    case 'version':
      console.log(version());
      return;
    default:
      return help(lang);
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
