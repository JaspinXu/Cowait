#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { loadConfig, saveConfig, DEFAULT_CONFIG, type Config } from './config.js';
import { resolveLang, t, fmtDur, type Lang } from './i18n.js';
import { dataDir, packageRoot, paths } from './paths.js';
import { ensureDir, readJson, writeJsonAtomic } from './fsutil.js';
import { acquireLock, loadState, releaseLock, saveState } from './engine/store.js';
import { coverage, pendingCards } from './engine/state.js';
import { grantDaily } from './engine/economy.js';
import { claudeSettingsPath, hookCommand, hookStatus, install, ourHookCommand, readClaudeSettings, uninstall, type Scope } from './install.js';
import { statusLine } from './statusline.js';
import { detectProvider } from './learn/llm.js';
import { runHookProcess } from './hook.js';
import { appVersion, isCompiled, selfCommand, splitPlan } from './runtime.js';
import { installKind, isNewer, latestVersion, updateCommand } from './update.js';
import { activePlan, proUnlocked, refreshLicense } from './plan.js';
import { activateLicense, deactivateLicense, loadLicense, maskKey, validateLicense } from './license.js';
import { CHECKOUT, PRICES, SITE, licensingConfigured } from './product.js';
import { openUrl } from './open.js';
import { levelInfo, levelTitle, streak } from './engine/progress.js';

const version = appVersion;

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
  // The demo shows the product straight away; the welcome screen is for real first runs.
  if (opts.demo) state.onboarded = true;
  const daily = grantDaily(state, Date.now());
  saveState(state);
  // Never heard from Claude Code and no hooks here or globally: the panel explains how to connect.
  // (Any past turn or card proves the hooks work somewhere, e.g. in another project folder.)
  const hooked = (['user', 'project'] as Scope[]).some((sc) => hookStatus(readClaudeSettings(sc)).installed.length > 0);
  const everConnected = state.totals.turns > 0 || state.totals.cards > 0 || fs.existsSync(paths.events());
  const setupHint = !opts.demo && !hooked && !everConnected;

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
  // Re-check a paid license every few days, quietly; the result counts from the next launch.
  void refreshLicense();
  const app = render(
    React.createElement(App, {
      cfg,
      lang,
      initial: state,
      daily,
      setupHint,
      plan: activePlan(),
      cwd: process.cwd(),
      checkUpdate: opts.demo ? undefined : () => checkUpdateCached(lang),
    }),
    { exitOnCtrlC: true },
  );
  await app.waitUntilExit();
  stopDemo?.();
  restore();
  process.removeListener('exit', restore);
  process.exit(0);
}

/** At most one registry lookup a day; the answer is cached in the data folder. */
async function checkUpdateCached(lang: Lang): Promise<{ version: string; command: string } | null> {
  const file = path.join(dataDir(), 'update.json');
  const cache = readJson<{ at?: number; latest?: string | null }>(file, {});
  let latest = cache.latest ?? null;
  if (!cache.at || Date.now() - cache.at > 24 * 60 * 60 * 1000) {
    latest = await latestVersion();
    try {
      writeJsonAtomic(file, { at: Date.now(), latest });
    } catch {
      /* read-only data folder: just check again next time */
    }
  }
  return latest && isNewer(latest, version()) ? { version: latest, command: updateCommand(installKind(), lang) } : null;
}

// ------------------------------------------------------------------ plans

const failText = (reason: string, detail: string | undefined, zh: boolean): string =>
  ({
    not_configured: zh ? '付费渠道还没开放，现在所有功能都可以免费用' : 'Paid plans are not open yet; everything is free to use for now',
    invalid: zh ? '这个密钥无效（检查一下有没有复制完整）' : 'That key is not valid (check it was copied in full)',
    limit: zh ? '这个密钥激活的设备数已经满了：先在旧设备上运行 cowait deactivate' : 'This key is active on as many machines as it allows: run cowait deactivate on an old one first',
    revoked: detail === 'expired' ? (zh ? '这个密钥已过期' : 'This key has expired') : zh ? '这个密钥已停用（订阅结束或退款）' : 'This key is no longer active (subscription ended or refunded)',
    network: zh ? `连不上授权服务器${detail ? `（${detail}）` : ''}，稍后再试` : `Could not reach the license server${detail ? ` (${detail})` : ''}; try again later`,
    server: zh ? `授权服务器出错${detail ? `（${detail}）` : ''}，稍后再试` : `The license server had a problem${detail ? ` (${detail})` : ''}; try again later`,
  })[reason] ?? reason;

async function cmdActivate(args: string[], lang: Lang): Promise<void> {
  const zh = lang === 'zh';
  const key = args.find((a) => !a.startsWith('-'));
  if (!key) {
    console.log(zh ? '用法：cowait activate <密钥>' : 'Usage: cowait activate <key>');
    process.exitCode = 1;
    return;
  }
  const r = await activateLicense(key);
  if (!r.ok) {
    (r.reason === 'not_configured' ? info : bad)(failText(r.reason, r.detail, zh));
    process.exitCode = r.reason === 'not_configured' ? 0 : 1;
    return;
  }
  const plan = r.license.plan === 'team' ? 'Team' : 'Pro';
  ok(zh ? `Cowait ${plan} 已激活 ✓（${r.license.label}）谢谢支持！` : `Cowait ${plan} is active ✓ (${r.license.label}). Thank you!`);
  info(zh ? '重新打开面板就能用上 Pro 功能' : 'Reopen the panel to use the Pro features');
}

async function cmdLicense(args: string[], lang: Lang): Promise<void> {
  const zh = lang === 'zh';
  let lic = loadLicense();
  if (lic && flag(args, '--check')) {
    const r = await validateLicense(lic);
    if (!r.ok) bad(failText(r.reason, r.detail, zh));
    lic = loadLicense();
  }
  const plan = activePlan();
  console.log(zh ? `\n当前方案：${plan === 'free' ? 'Free' : plan === 'team' ? 'Team' : 'Pro'}` : `\nPlan: ${plan === 'free' ? 'Free' : plan === 'team' ? 'Team' : 'Pro'}`);
  if (lic) {
    info(`${zh ? '密钥' : 'key'}: ${maskKey(lic.key)} · ${lic.status} · ${lic.label}`);
    info(`${zh ? '上次核验' : 'last checked'}: ${new Date(lic.checkedAt).toLocaleString()}`);
  } else if (!licensingConfigured()) {
    info(zh ? '付费渠道即将开放；在那之前 Pro 功能对所有人开放' : 'Paid plans open soon; until then the Pro features are open to everyone');
  } else {
    info(zh ? '升级：cowait upgrade · 激活：cowait activate <密钥>' : 'Upgrade: cowait upgrade · Activate: cowait activate <key>');
  }
  console.log('');
}

async function cmdDeactivate(lang: Lang): Promise<void> {
  const zh = lang === 'zh';
  const lic = loadLicense();
  if (!lic) {
    info(zh ? '这台电脑上没有激活的密钥' : 'No license is active on this machine');
    return;
  }
  const r = await deactivateLicense(lic);
  if (r.ok) ok(zh ? '已在这台电脑上停用，密钥可以拿去别的电脑激活' : 'Deactivated here; the key can now be activated on another machine');
  else {
    bad(zh ? `停用失败：${r.detail ?? ''}` : `Could not deactivate: ${r.detail ?? ''}`);
    process.exitCode = 1;
  }
}

function cmdUpgrade(lang: Lang): void {
  const zh = lang === 'zh';
  const url = CHECKOUT.pro || SITE;
  console.log(
    zh
      ? `\nCowait Pro：${PRICES.currency}${PRICES.pro.monthly}/月 或 ${PRICES.currency}${PRICES.pro.yearly}/年`
      : `\nCowait Pro: ${PRICES.currency}${PRICES.pro.monthly}/month or ${PRICES.currency}${PRICES.pro.yearly}/year`,
  );
  if (!licensingConfigured()) info(zh ? '付费渠道即将开放；在那之前 Pro 功能对所有人开放' : 'Paid plans open soon; until then the Pro features are open to everyone');
  if (openUrl(url)) ok(zh ? `已在浏览器打开 ${url}` : `Opened ${url}`);
  else info(url);
  if (licensingConfigured()) info(zh ? '买好后运行：cowait activate <密钥>' : 'Then run: cowait activate <key>');
  console.log('');
}

async function cmdReport(args: string[], lang: Lang): Promise<void> {
  const zh = lang === 'zh';
  const days = Math.max(1, Math.min(120, Number(opt(args, '--days') ?? 7) || 7));
  const { buildReport, reportHtml, reportMarkdown } = await import('./report.js');
  const s = loadState();
  const r = buildReport(s, days);
  const pctText = r.coverage === null ? '—' : `${Math.round(r.coverage * 100)}%`;
  console.log(
    zh
      ? `\n${r.from} – ${r.to}：Claude 干活 ${r.turns} 轮，改了 ${r.files} 个文件；你认真看过 ${r.read} 个（${pctText}），标出问题 ${r.flagged} 个`
      : `\n${r.from} – ${r.to}: Claude worked ${r.turns} turns and changed ${r.files} files; you read ${r.read} (${pctText}) and flagged ${r.flagged}`,
  );
  if (!proUnlocked(activePlan())) {
    info(zh ? '完整的报告（每天、每个项目，可以分享的网页）是 Pro 功能：cowait upgrade' : 'The full report (per day, per project, a page you can share) is a Pro feature: cowait upgrade');
    console.log('');
    return;
  }
  const md = flag(args, '--md');
  const body = md ? reportMarkdown(r, lang, version()) : reportHtml(r, lang, version());
  const out = opt(args, '--out') ?? path.join(dataDir(), 'reports', `cowait-report-${r.to}.${md ? 'md' : 'html'}`);
  ensureDir(path.dirname(out));
  fs.writeFileSync(out, body);
  ok(zh ? `报告已保存：${out}` : `Report saved: ${out}`);
  console.log('');
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
      ? '\n下一步：\n  1. 重启正在运行的 Claude Code 会话，让新 hooks 生效\n  2. 在旁边开一个终端分屏运行 `cowait`（Windows Terminal、tmux、zellij、WezTerm、kitty、iTerm2 里可以直接 `cowait split`）\n  3. 不放心可以先跑 `cowait doctor` 自检，或 `cowait demo` 试玩\n'
      : '\nNext:\n  1. Restart running Claude Code sessions so the hooks load\n  2. Run `cowait` in a pane next to Claude Code (`cowait split` does it in Windows Terminal, tmux, zellij, WezTerm, kitty and iTerm2)\n  3. `cowait doctor` checks the setup, `cowait demo` lets you try it\n',
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
  if (isCompiled()) {
    // The binary carries its own runtime and runs the hook itself (`cowait hook`).
    ok(`${zh ? '独立可执行文件' : 'standalone binary'} v${version()}: ${process.execPath}`);
  } else {
    const major = Number(process.versions.node.split('.')[0]);
    (major >= 20 ? ok : bad)(`Node ${process.version} ${zh ? '（需要 ≥ 20）' : '(need ≥ 20)'}`);
    const hookJs = path.join(packageRoot(), 'dist', 'hook.js');
    (fs.existsSync(hookJs) ? ok : bad)(`${zh ? 'hook 脚本' : 'hook script'}: ${hookJs}`);
  }

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
  const lv = levelInfo(s.xp);
  const sk = streak(s);
  console.log(`  Lv.${lv.level} ${levelTitle(lv.level)[lang]} (${lv.into}/${lv.need} XP) · 🔥 ${sk.days} (${zh ? '最长' : 'best'} ${s.bestStreak}) · ⚡ ${s.energy} · 💰 ${s.coins}`);
  console.log(
    zh
      ? `  Claude 干活的轮次 ${T.turns} · 测试通过的轮次 ${T.testsPassed}\n  改动卡片 ${T.cards} · 你审过 ${T.reviewed + T.flagged}（其中标出问题 ${T.flagged}）· 扫一眼就过 ${T.skimmed} · 跳过 ${T.skipped} · 待审 ${pendingCards(s).length}\n  AI 代码人工审阅覆盖率 ${cov === null ? '—' : Math.round(cov * 100) + '%'}（扫一眼就过的不算）\n  转达给 Claude 的留言 ${T.delivered} 条\n  刷卡 ${T.learned} 张 · 捉虫地牢 ${T.runs} 局，通关 ${T.wins} 次，最深第 ${T.bestFloor} 层 · 栈机谜题 ${T.puzzles} 道 · 代码速打 ${T.sprints} 轮（最快 ${s.best.wpm} WPM）\n  成就 ${Object.keys(s.achievements).length} 个 · 详细报告：cowait report`
      : `  Claude turns ${T.turns} · turns with passing tests ${T.testsPassed}\n  Change cards ${T.cards} · reviewed ${T.reviewed + T.flagged} (${T.flagged} flagged) · skimmed ${T.skimmed} · skipped ${T.skipped} · pending ${pendingCards(s).length}\n  Human review coverage of AI code ${cov === null ? '—' : Math.round(cov * 100) + '%'} (skims don't count)\n  Notes relayed to Claude ${T.delivered}\n  Flashcards ${T.learned} · Debug Dungeon runs ${T.runs}, wins ${T.wins}, deepest floor ${T.bestFloor} · Stack Puzzles ${T.puzzles} · Code Sprints ${T.sprints} (best ${s.best.wpm} WPM)\n  Achievements ${Object.keys(s.achievements).length} · Full report: cowait report`,
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

const SPLIT_NAMES = { tmux: 'tmux', zellij: 'zellij', wezterm: 'WezTerm', kitty: 'kitty', iterm2: 'iTerm2', 'windows-terminal': 'Windows Terminal' };

function cmdSplit(lang: Lang): void {
  const zh = lang === 'zh';
  const plan = splitPlan(selfCommand(), process.cwd());
  if (!plan) {
    console.log(
      zh
        ? '没检测到能自动分屏的终端（Windows Terminal、tmux、zellij、WezTerm、kitty、iTerm2）。请自己开一个新终端窗口或分屏，运行：cowait'
        : 'No terminal that Cowait can split was detected (Windows Terminal, tmux, zellij, WezTerm, kitty, iTerm2). Open another pane and run: cowait',
    );
    return;
  }
  const name = SPLIT_NAMES[plan.via];
  const opened = () => ok(zh ? `已在 ${name} 右侧分屏打开 Cowait` : `Opened Cowait in a ${name} split`);
  if (plan.detached) {
    const child = spawn(plan.bin, plan.args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    opened();
    return;
  }
  const r = spawnSync(plan.bin, plan.args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15000 });
  if (r.status === 0) {
    opened();
    return;
  }
  bad(`${zh ? `${name} 分屏失败` : `${name} split failed`}: ${(r.error?.message || r.stderr || `exit ${r.status}`).toString().trim().slice(0, 300)}`);
  if (plan.via === 'kitty')
    info(
      zh
        ? 'kitty 需要开启远程控制：在 kitty.conf 里加 allow_remote_control yes（左右分屏还要 enabled_layouts splits），然后重启 kitty'
        : 'kitty needs remote control: add `allow_remote_control yes` to kitty.conf (and `enabled_layouts splits` for a side-by-side split), then restart kitty',
    );
  if (plan.via === 'iterm2')
    info(
      zh
        ? 'macOS 会询问是否允许控制 iTerm2：在 系统设置 → 隐私与安全性 → 自动化 里允许你的终端控制 iTerm2'
        : 'macOS must allow controlling iTerm2: System Settings → Privacy & Security → Automation',
    );
  info(zh ? '也可以自己开一个分屏，运行：cowait' : 'Or open a pane yourself and run: cowait');
  process.exitCode = 1;
}

async function cmdUpdate(args: string[], lang: Lang): Promise<void> {
  const zh = lang === 'zh';
  const kind = installKind();
  const current = version();
  const kindName = {
    binary: zh ? '独立可执行文件' : 'standalone binary',
    npm: zh ? 'npm 全局安装' : 'npm global install',
    clone: zh ? 'git 克隆' : 'git clone',
  }[kind];
  console.log(zh ? `\nCowait v${current}（${kindName}）` : `\nCowait v${current} (${kindName})`);
  const latest = await latestVersion();
  const cmd = updateCommand(kind, lang);
  if (latest === null) info(zh ? '查不到最新版本（离线、网络慢，或者还没发布到 npm）' : 'Could not check the latest version (offline, slow network, or not on npm yet)');
  else if (isNewer(latest, current)) ok(zh ? `有新版本：v${latest}` : `New version available: v${latest}`);
  else ok(zh ? `已经是最新版（npm 上最新是 v${latest}）` : `Up to date (latest on npm: v${latest})`);

  if (kind === 'clone') {
    // A clone follows the repository, not npm: pulling is always the update.
    if (!flag(args, '--yes') && !flag(args, '-y')) {
      info(zh ? `更新：${cmd}（或者 cowait update --yes 让 Cowait 来运行）` : `To update: ${cmd} (or cowait update --yes to run it)`);
      console.log('');
      return;
    }
    console.log(`\n> ${cmd}`);
    const r = spawnSync('git', ['-C', packageRoot(), 'pull', '--ff-only'], { stdio: 'inherit' });
    if (r.status !== 0) {
      bad(zh ? 'git pull 没有成功，见上面的输出' : 'git pull did not succeed, see above');
      process.exitCode = 1;
      return;
    }
    ok(zh ? '已更新（dist/ 随仓库提交，不用重新构建）。面板要关掉再打开才会用上新版本' : 'Updated (dist/ is committed, nothing to build). Reopen the panel to run the new version');
    console.log('');
    return;
  }
  if (latest === null || isNewer(latest, current)) info(zh ? `更新命令：${cmd}` : `To update, run: ${cmd}`);
  console.log('');
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
  cowait split           在右侧分屏打开面板（Windows Terminal / tmux / zellij / WezTerm / kitty / iTerm2）
  cowait update [--yes]  检查新版本并给出更新命令（git 克隆安装加 --yes 直接 git pull）
  cowait learn "主题"    让 AI 出一组卡片 [-n 12]
  cowait stats           查看统计（含 AI 代码人工审阅覆盖率）
  cowait report          生成审阅报告网页 [--days 7] [--md] [--out 文件]
  cowait config [键 值]  查看或修改配置
  cowait upgrade         了解 Cowait Pro
  cowait activate <密钥> 激活 Pro（cowait license 查看，cowait deactivate 在本机停用）
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
  cowait split           open the panel in a split (Windows Terminal / tmux / zellij / WezTerm / kitty / iTerm2)
  cowait update [--yes]  check for a newer version and show how to update (--yes: git pull for clones)
  cowait learn "topic"   have AI write a flashcard deck [-n 12]
  cowait stats           stats, including human review coverage of AI code
  cowait report          a review report page [--days 7] [--md] [--out file]
  cowait config [k v]    show or change settings
  cowait upgrade         about Cowait Pro
  cowait activate <key>  activate Pro (cowait license shows it, cowait deactivate frees this machine)
`,
  );
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  // Claude Code runs this on every tool call (standalone binary): go straight to the hook, read nothing else.
  if (cmd === 'hook') return runHookProcess();
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
    case 'update':
      return cmdUpdate(args, lang);
    case 'activate':
      return cmdActivate(args, lang);
    case 'deactivate':
      return cmdDeactivate(lang);
    case 'license':
      return cmdLicense(args, lang);
    case 'upgrade':
    case 'pro':
      return cmdUpgrade(lang);
    case 'report':
      return cmdReport(args, lang);
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
