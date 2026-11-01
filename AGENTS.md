# AGENTS.md — Cowait 接手指南

> 给接手这个项目的 AI agent / 新账号看的。读完这一份就能无缝继续。
> 来龙去脉在 `docs/history/`：
> [创立会话](docs/history/2026-11-01-founding-session.md)（市场调研、每个决定为什么这么做）、
> [第一轮整体优化](docs/history/2026-11-01-optimization-pass.md)（0.2.0）、
> [1.0.0 与开源](docs/history/2026-11-01-launch-pass.md)（按轮审阅、留存系统、三个游戏、打包分发；最后决定开源、不做付费）。
> 和用户沟通用**中文**。

---

## 1. 一句话

Cowait 是放在 Claude Code 旁边分屏里的终端面板，把等 Claude 干活的时间变成有用的时间。四个页面：
**审阅**（按 Claude 的“轮”列出改了哪些文件，`y`/`n`/`Y`，写一句话 Claude 下一步就看到）、
**游戏**（捉虫地牢、栈机谜题、代码速打）、**学习**（抽认卡，含“用 Claude 刚写的代码出题”）、**我**（等级、连续天数、今日任务、成就、设置）。
经济：⚡ 能量靠你认真审代码/刷卡/任务赚、用来玩游戏（先审后玩；没看就过不算）；💰 金币只看 Claude 的成果（干活 +3、测试通过 +10）。
产品主线：审阅是核心，游戏和学习是奖励；激励必须对齐；审阅覆盖率必须可信；留存靠“每天都有理由回来”（连续天数、每日谜题、任务、周回顾），而不是挂机奖励。
**开源、免费、没有付费版**（MIT，用户 2026-11-01 决定）：不要再加付费墙、许可证或“Pro”之类的东西，除非用户主动提出。

## 2. 当前状态（2026-11-01）

| 项 | 状态 |
|---|---|
| 版本 | **1.0.0**（见 `CHANGELOG.md`） |
| 仓库 | **公开** `https://github.com/JaspinXu/Cowait`，MIT 开源（仓库名首字母大写是用户要求；npm 包名和命令小写 `cowait`） |
| 测试 | 207 个，全部通过（`npm test`） |
| 分发渠道 | 现在只能从源码装（`git clone` + `npm install -g .`）。npm 包、独立可执行文件（release workflow）、官网（Pages）的代码和 CI 都已就绪，但**都还没发布**；npm 包名 `cowait` 还没被占。发布清单见第 8 节，每一步都要先问用户 |
| 付费 | **没有**。1.0.0 开发中做过一版 Polar 许可证和 Pro/Team 方案，用户决定开源后整体删掉了（在 git 历史里，提交 `a99641e` 之后） |
| 独立可执行文件 | Bun 编译。Windows x64 版在用户电脑上实测通过（面板、hook、doctor、install）；Linux/macOS 版能编出来但没运行过（本机 WSL 坏了），release workflow 里的冒烟测试是第一次真实检验 |
| 用户电脑上的安装 | `G:\Cowait`（git clone），`cowait` 通过 `npm install -g G:\Cowait` 装在 PATH 上 |
| 数据目录 | `G:\Cowait\data`（clone 安装数据跟着程序走；npm 和独立可执行文件用 `~/.cowait`） |
| **用户全局 Claude Code 配置** | **没装**。`C:\Users\19826\.claude\settings.json` 没动过；改全局之前必须再问用户 |
| 项目级安装 | `G:\Cowait` 本项目已 `cowait install --project`（`.claude/settings.local.json`，已 gitignore） |
| 使用方式 | 用户在 Windows Terminal 里开 Claude Code，`cowait split` 把面板开在右边 40%，用 Cowait 开发 Cowait |

## 3. 必须遵守的约定

- **产品名中英文都只叫 Cowait。**
- **改 `~/.claude/settings.json`（全局）之前必须得到用户明确同意。** 默认用 `--project`。
- **对外发布的动作一律先问用户**：npm publish、打 release tag、开 GitHub Pages。仓库是公开的：提交前确认没有密钥、本机隐私信息以外的东西（这份文件里的本机环境说明是用户同意公开的工作笔记）。
- **一切放 G 盘。** 用户 C 盘快满了。npm 缓存 `G:\Cowait\.npm-cache`；Bun 的跨平台运行时缓存在 `node_modules/.cache/bun`（约 380 MB，`compile.mjs` 设的）；录图临时文件在 `data/.media`（录完自动删）；草稿放 `data/scratch`（gitignore 了）。
- **npm**：用户 registry 是 npmmirror，`npm install <包>` 会把 lock 里的 `resolved` 改成 npmmirror，提交前改回 `registry.npmjs.org`。在 Claude 桌面应用（`claude.exe`）里会遇到 `EALLOWSCRIPTS`，换到用户终端里的会话做。
- **`dist/` 已提交**：改了 `src/` 一定要 `npm run build`（或 `npm test`）并把 `src/` 和 `dist/` 一起提交；用户 `git pull` 就生效。
- **在 `G:\Cowait` 里开发 Cowait**：hook 就是本项目的 `dist\hook.js`，每次打包都会替换它。改坏了 `git checkout dist/`。正在运行的面板用的是启动时的代码，要看新效果得 `q` 再 `cowait split`（面板单实例，旧的不关新的起不来）。
- 每次改进后：跑测试 → 提交 → **推到 GitHub**。提交身份 `Zhaobin Xu <sea.xuo@gmail.com>`，加你所在环境要求的 AI 署名行。
- 仓库命名不要连字符/下划线；不留过程文件和一次性脚本；**删文件前先告诉用户删哪些**。
- README 保持双语风格（居中标题 + 动图 + 徽章 + 导航行 + 叙事开头 + 三列亮点表），中英文同步改；徽章和“开发”一节里的测试数跟着改。
- **配图**：浅色背景，不做暗色版本，不加角落小标注，能合并或删掉的就合并/删掉。`docs/media/` 全部由 `npm run media` 从真实面板录出来，界面改了就重录。官网 `site/` 也是浅色。
- **记录每轮标题是有意改变的隐私边界**：hook 只存你消息的第一行（最多 60 字），只在本机，`promptTitles=false` 时一个字都不存（有测试）。别再往日志里存更多 prompt 内容。
- 用户偏好“能用浏览器做的就用浏览器做”；GitHub 操作用已登录的 `gh`（JaspinXu）；需要插画时用他电脑上的 Codex。

## 4. 用户电脑环境（Windows 11）

| | |
|---|---|
| 用户目录 | `C:\Users\19826`（设备名 xusea） |
| Shell | Windows PowerShell **5.1**；Claude Code CLI 跑在 Windows Terminal 里（`WT_SESSION` 有值） |
| Node / npm | v24.18.0（`D:\nodejs`）/ npm 11.18.0，registry 是 npmmirror |
| git | 2.55，`core.autocrlf=true`（仓库有 `.gitattributes` 强制 LF） |
| 已装 | `gh`、`claude`、`codex`；ffmpeg（`C:\ffmpeg\bin`，PATH 里可能没有，用全路径）；Python 3.11（anaconda）。**Bun 没装**，用 `npx --cache G:\Cowait\.npm-cache bun@1.4.4`（`compile.mjs` 会自己找）。WSL 的 Ubuntu 坏了（vhdx 丢了） |
| 浏览器 | Chrome 在 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`；也有 Edge |
| 字体 | Consolas、微软雅黑、Segoe UI Emoji；没有 Cascadia |
| 磁盘 | G: 约 95 GB 空闲；C: 约 21 GB 空闲 |

PowerShell 5.1 的坑：`Set-Content -Encoding utf8` 写 BOM（JSON 读取已兼容）；不支持 `<` 重定向；管道捕获的中文会乱码（真实终端正常）；`ConvertFrom-Json` 解析大 `state.json` 会失败（用 Node）；调 Claude Code 用 `claude.cmd`。
无头 Chrome 截图：要用 `Start-Process -Wait`（直接 `&` 调用会立刻返回）；窗口最小宽度约 500px，窄于这个的截图会被裁，不是页面的问题。

## 5. 架构

```
Claude Code ──hooks──▶ hook（dist/hook.js 或 cowait hook）──append──▶ data/events.jsonl ──poll 400ms──▶ 面板（Ink TUI）
     ▲                       │                                                                         │
     └── additionalContext / ┘◀── 按会话/项目原子认领 ── data/feedback/*.json ◀──────────────────── 你写的话（n / m）
         一次性拦 Stop
```

- **Hook 事件**：`UserPromptSubmit`、`PostToolUse`（matcher `*`）、`Stop`、`Notification`、`SessionEnd`。故意**不**挂 `PreToolUse`。命令带标记 `--cowait-hook`，安装/卸载靠它识别。clone/npm 安装用 `"<node>" "<root>/dist/hook.js" --cowait-hook`；独立可执行文件用 `"<exe>" hook --cowait-hook`（`runtime.isCompiled()` 判断）。
- **hook 的铁律**：无第三方依赖、永远 exit 0、4 秒硬超时、只在有留言要转达时才输出。`COWAIT_INTERNAL=1` 时什么都不做。Windows 上退出前要等 `stdout.write` 回调。`hook.ts` 的入口判断靠 esbuild define `__COWAIT_HOOK_ENTRY__`（否则 cli 包里也带着 hook 代码，每条命令都会触发一次 hook）。延迟：Windows 独立可执行文件约 32 ms，`node dist/hook.js` 约 50 ms。
- **按轮审阅**（`engine/reducer.ts`、`ui/Review.tsx`）：`prompt` 事件开一个 `TurnMeta`（`key = sid@turnStart`，`title` 来自事件的 `p`），同一轮里同一个文件的修改合到一张卡的 `more` 里（每卡最多 20 处）。面板按轮分组、**最新的一轮在前**，选中项按卡片 id 记（不按下标，新改动进来光标不会跳）。旧版本存下的没有 `turn` 的卡片，`normalizeState` 按会话和 10 分钟静默切成轮。
- **诚实审阅**：`Review.tsx` 的模块级 `dwell` 累计每张卡当前内容（`id:处数`）**真正显示在屏幕上的时长**（切走、看帮助时暂停）。`y` 和 `Y` 都用 `isSkim(改动行数, 显示时长)` 判断：不够就算“没看就过”（通过但不加能量、不计覆盖率）。整轮每个文件都真看过 → `fullTurn`（每轮只奖励一次，`TurnMeta.full`）。放了 24 小时没人看的卡由 `sweep` 归档成跳过（`totals.expired`）。
- **进度**（`engine/progress.ts`）：调用方用 `track(s, 活动)` 记今天的 `DayStat`（`state.days`，留 120 天）和 XP；App 的 `update()` 之后调用 `settleProgress` 发放任务/成就/升级并返回事件（第一次 settle 时 `level === 0`，已经满足的成就静默发放，不刷屏）。连续天数只认“有用的一天”：审过 ≥1 个文件、刷 ≥5 张卡、或解出每日谜题。今日任务按日期哈希挑：审阅/学习/游戏各一个。周回顾：每周第一次打开时显示上周（`lastRecap` 记已显示的周）。
- **留言**：每条带 `cwd` 和 `sid`；`claimNotes(cwd, sid)`：自己会话的一定拿；否则只拿当前目录等于或在留言项目之内的，**不拿父目录的**。解析失败改名 `*.unreadable`，绝不静默删除。送达：`PostToolUse`/`UserPromptSubmit` 用 `additionalContext`；`Stop` 时 `stop_hook_active` 为假就 block 一次。
- **面板外壳**（`ui/App.tsx`）：四个页面 + 三个浮层（欢迎页 `welcome`、周回顾 `recap`、帮助 `help`）。底栏只有一行：当前页面通过 `useHint` 上报的按键提示 + `? 帮助`；打字/速打时不显示 `? 帮助`。提示（toast）分两种：反馈（`✓ +1⚡`）立即替换上一条反馈；奖励（任务、成就、升级、新版本）排队，并且用 `setTimeout(0)` 排在调用方自己的反馈之后。完成提醒带 `turn` 时按 Enter 跳到那一轮（`focusTurn`）。
- **游戏页**：`Game.tsx` 是列表，`state.arcade` 记当前打开的游戏；`Dungeon.tsx`（原来的捉虫地牢，Esc 回列表，进度保留）、`Puzzle.tsx`（每日谜题按本地日期做种子，免费；练习 1⚡，不限次数）、`Sprint.tsx`（一轮 1⚡；**进行中占住整个键盘**：`setTyping(true)`，所以 `q`/`?`/Tab 都是普通字符；回合在 ref 里，暂停或结束时才写回 state，避免每个键都整份存盘）。游戏引擎都是纯函数、带种子、可序列化（`game/engine.ts`、`game/stack.ts`、`game/sprint.ts`）。
- **其他**：事件日志 2 MB 滚动；面板状态用户操作立即落盘、日志折叠的变化最多 3 秒一次；比现在早 15 秒以上的信号不提醒；面板单实例 `data/panel.lock`；数据目录 `COWAIT_HOME` > 独立可执行文件 `~/.cowait` > clone `<root>/data` > npm `~/.cowait`。
- **界面布局**：按 60 列窄分屏设计，测试里中英文各有一次 60×26 全界面溢出检查；预览脚本还查过 46 列。大段文字用 `Para`/`Labeled`（`text.ts` 的 `wrapText`）。

### 文件地图

```
src/
  hook.ts            hook 入口（runHookProcess）；dist/hook.js 和 `cowait hook` 共用
  events.ts          payload → 紧凑事件（含 promptTitle：第一行，最多 60 字）
  feedback.ts        留言队列
  testdetect.ts      测试命令识别
  install.ts         settings.json 合并/还原、状态栏
  runtime.ts         appVersion（构建时注入）、isCompiled、selfCommand、splitPlan（各终端怎么分屏）
  update.ts          installKind、latestVersion（npm registry）、updateCommand
  report.ts          `cowait report`（HTML/Markdown）
  statusline.ts      可选状态栏（🔥⚡💰 + 待审数）
  config.ts / paths.ts / fsutil.ts / text.ts / i18n.ts（所有中英文案 + 帮助）
  engine/            state（类型、DayStat、TurnMeta、旧卡片迁移）、reducer（按轮分组）、economy（isSkim、applyVerdict、expireOld）、
                     progress（XP/等级/连续天数/任务/成就/周回顾）、predict（等待预测、自动选页面）、diff、store
  game/              engine（捉虫地牢，含加班模式）、meta（结算）、stack（栈机谜题）、sprint（代码速打）
  learn/             srs、decks、llm（Haiku）、generate
  ui/                App、Review、Game（列表）、Dungeon、Puzzle、Sprint、Learn、Me、Today（等级/连续/任务块）、common
  demo.ts            `cowait demo`（每轮带标题）；导出 CWD/EDITS/TITLES 给录图用
  cli.ts             所有子命令
scripts/
  build.mjs          esbuild 打包（define __COWAIT_VERSION__、__COWAIT_HOOK_ENTRY__）
  compile.mjs        Bun 编五个平台的独立可执行文件到 release/（gitignore）
  install.sh / install.ps1   独立可执行文件安装脚本（校验 SHA256、装到用户目录、重复运行即升级）
  site.mjs           把 site/ 和 docs/media 拼成可发布的官网目录（默认 data/site）
  media/             record.mjs + scenes.tsx：用真实面板录 README 配图
site/index.html      产品官网（中英双语、浅色、单文件）
.github/workflows/   ci.yml（三平台 × Node 20/24）、release.yml（打 v* 标签：测试→编译→签名→Release→可选 npm publish）、pages.yml（官网，私有仓库时跳过）
test/                vitest（vitest.config.ts 只收 test/，否则会把 .claude/worktrees 里的副本也跑一遍）
docs/media/          README 配图：demo-*.gif、review/battle/learn/me-*.png
```

### 关键数字

- 经济：认真审过 +1⚡，针对文件留言 +2⚡，刷卡 +1⚡，今日任务 +2⚡，成就 +3⚡，每日首次打开 +5⚡，通关 +5⚡（加班模式 ×2）。地牢 3⚡、速打 1⚡、练习谜题 1⚡，每日谜题免费。干活的一轮 +3💰，测试通过再 +10💰。
- XP：审过 10、标出问题 15、留言 5、刷卡 3、每日谜题 20 + 每星 5、练习 8、速打 10、地牢每层 5、通关 50、整轮看完 10、任务 20。升级所需 `100 + 40 × (等级 - 1)`。称号：实习生 1 / 初级 3 / 工程师 6 / 高级 10 / 资深 15 / 首席 20 / 传奇 30。成就 21 个。
- 扫一眼：`min(4000, 600 + 80 × 改动行数)` ms 的**显示时长**；刷卡最短 1500 ms。
- 卡片：每卡最多 20 处、队列上限 150 张、24 小时归档。轮次元数据留 60 个，每日统计留 120 天。
- 栈机谜题：难度 1/2/3 = 4/5/6 个按钮、标准步数 3–4/4–5/5–7；周一二难度 1、周三四 2、周五到周日 3；编号从 2026-11-01 = #1 开始。用了提示最多两星。
- 代码速打：5 行；两次按键间隔最多算 3 秒；准确率 ≥ 90% 且 ≤ 250 WPM 才算纪录。
- 游戏平衡（贪心机器人）：裸装通关约 44%，满装备约 94%。加班模式：敌人血量 ×1.3、攻击 +2。

## 6. 常用命令

```bash
npm test              # 先打包再跑 207 个测试
npm run build         # tsc 类型检查 + esbuild 打包（改完 src 必须跑，并提交 dist）
npm run compile       # Bun 编独立可执行文件到 release/（--target bun-windows-x64 只编一个）
npm run media         # 重录 docs/media（中英 GIF + 4 张截图，约 2 分钟）；只要截图：npm run media -- png
node scripts/site.mjs # 拼出官网到 data/site，用浏览器打开 data/site/index.html 预览
node dist/cli.js demo --fast
cowait report --days 7   # 审阅报告，存到 <数据目录>/reports/
```

## 7. 踩过的坑（改 UI/输入/hook 前先看）

1. **Ink 里连续按键会丢字/丢键**：按键处理里读的状态必须用 ref（`useLine`、`useRefState`）；模式切换用函数式 `setMode`；`setTyping` 要同步更新 ref。
2. **提醒弹出时吃掉按键**：打字时任何按键都归输入框（`typingRef`），子组件 `active = overlay === null && !noteOpen && (!alert || typing)`。
3. **测试用的假终端会合并紧挨着写入的按键**：`test/render.ts` 的 FakeStdin 只保留最后一次写入，连续 `stdin.write` 之间要 `sleep`（测试里的 `typeKeys`、录图脚本的 `keys` 都逐个按键加了间隔）。
4. **emoji 宽度**：🪙 换成 💰；带边框的盒子里不用 🛡 ⚔ ❓ 🌀 ✉；栈机谜题的乘号用 `*` 而不是 `×`（宽度不确定）。
5. **`normalizeState` 里 `...raw` 会把值为 undefined 的字段盖掉默认值**：新字段要在后面显式写 `raw.x ?? 默认值`（`level` 曾因此出 bug）。
6. **测试识别误判**：按命令段解析，去掉包装后再判断。
7. **Windows BOM**：所有 JSON 读取走 `parseJson`/`readJson`。
8. **`dist/cli.js` 换行符**：`.gitattributes` 强制 LF。
9. **Ink 的折行只在空格处断**：大段文字用 `Para`/`Labeled`。
10. **内容比面板高时 Yoga 会压扁中间的行**：`App` 内容区包了一层 `flexShrink={0}`，别去掉。帮助页要能放进 60×26。
11. **延时触发的自动切换要在触发时重新检查当前模式**。
12. **`ink-testing-library` 固定 100 列**：测窄屏用 `renderSized`。
13. **环境里有 `NO_COLOR`**：录图脚本会删掉它并设 `FORCE_COLOR=3`。截图里看不到颜色时，代码速打另起一行显示你打的字，没颜色也能看出哪里错了。
14. **这个 harness 里 bash heredoc 偶尔解析失败**（内容里有反引号或某些引号组合时）：大段替换先用 Write 写成文件再跑，或者直接用 Edit。
15. **vitest 会扫到 `.claude/worktrees/` 里 agent 的副本**：`vitest.config.ts` 只收 `test/`。
16. **无头 Chrome 偶尔不写截图就退出**：`record.mjs` 的截图会重试 3 次。

## 8. 路线图 / 还没做的

**发布清单**（仓库已经公开；下面每一步都要用户点头，用户没提之前不要做，也不要反复催）：
1. 在仓库 Secrets 里加 `NPM_TOKEN`，然后打 `v1.0.0` 标签：release workflow 会编译、签名、发 Release、发 npm。第一次要盯着 Linux/macOS 的冒烟测试。
2. Settings → Pages → Source 选 “GitHub Actions”，然后给 `pages.yml` 加回 push 触发（现在只能手动运行，免得 Pages 没开时每次改官网都报错），官网会发到 `https://jaspinxu.github.io/Cowait/`。
3. 发布后：README 和官网的安装方式改回“npm / 独立可执行文件优先、源码其次”（现在写的是“还没发布”），README 徽章加 npm 版本号。

**产品**（开源项目，按社区反馈来）：
- 多人审阅覆盖率汇总（例如 `cowait report --merge` 合并几个人导出的数据）。
- “提前问”假设队列（创立时的方向 B）：会改变 Claude 的行为，做之前和用户确认、做成可选。
- 更多每日内容：每日谜题的往期补做、周挑战；随 Claude 产出成长的基地经营。
- 更准的等待预测；VS Code 扩展形态；Windows arm64 构建；独立可执行文件体积（约 90–114 MB，Bun 运行时）可以考虑压缩包。
- 为什么不做付费：见 `docs/history/2026-11-01-launch-pass.md` 第 7 节（个人付费意愿低、门槛低易被替代、开源更能建立信任和传播；真正可能付费的是团队，但需要服务器端，且需求未验证）。

## 9. 可以清理的东西（删之前先问用户）

1.0.0 用过的 agent 工作区、`worktree-agent-*` 分支、Bun 缓存和 `data\scratch` 已在 2026-11-01 经用户同意清理掉了。以后再用 worktree 并行开发：工作区里的 `node_modules` 如果是指向主仓库的 junction，删之前先单独删 junction（`cmd /c rmdir <工作区>\node_modules`，只删链接），再 `git worktree remove`，否则可能把主仓库的依赖一起删了。`npm run compile` 会重新下载 Bun 缓存（约 380 MB，在 `node_modules/.cache/bun`）。

还剩：
- `G:\Cowait\data\` 里的 `site\`（`node scripts/site.mjs` 生成的官网预览）、`e2e-test\`、`e2e-home\`、`latency-test\`、`bomtest.json`（测试残留，gitignore 了）。
- C 盘 `%TEMP%` 里 0.2.0 之前测试留下的 `cowait-test-*`、`claude-cfg-*` 小文件夹（合计约 120 KB），可以请用户自己运行：
  `Get-ChildItem $env:TEMP -Directory | Where-Object Name -match '^(cowait-(test|frames)-|claude-cfg-)' | Remove-Item -Recurse -Force`
