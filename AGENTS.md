# AGENTS.md — Cowait 接手指南

> 给接手这个项目的 AI agent / 新账号看的。读完这一份就能无缝继续。
> 来龙去脉在 `docs/history/`：
> [创立会话](docs/history/2026-11-01-founding-session.md)（市场调研、每个决定为什么这么做、踩过的坑）、
> [第一轮整体优化](docs/history/2026-11-01-optimization-pass.md)（0.2.0：真实使用暴露的问题、审阅意见和取舍）。
> 和用户沟通用**中文**。

---

## 1. 一句话

Cowait 是一个放在 Claude Code 旁边分屏里的终端面板，把等 Claude 干活的时间变成有用的时间：
**审阅** Claude 刚做的改动（每个文件一张卡，能写一句话实时转达给 Claude，也能随时按 `m` 给它留言），
玩回合制卡牌小游戏 **捉虫地牢**，或者用抽认卡**学习**（含“用 Claude 刚写的代码出题”）。三种模式由一套经济系统连起来：
⚡ 能量靠你审代码/刷卡赚、用来开游戏（先审后玩；扫一眼不算审）；💰 金币只看 Claude 的成果（干活 +3、测试通过 +10），不看等了多久。
产品主线（创立会话定的）：审阅是核心，游戏和学习是审完的奖励；激励必须对齐，审阅覆盖率必须可信（团队版靠它收费）。

## 2. 当前状态（2026-11-01）

| 项 | 状态 |
|---|---|
| 版本 | 0.2.0（第一轮整体优化后） |
| 仓库 | **私有** `https://github.com/JaspinXu/Cowait`（仓库名首字母大写是用户明确要求的；npm 包名和命令必须小写 `cowait`） |
| 用户电脑上的安装 | `G:\Cowait`（git clone），`cowait` 命令通过 `npm install -g G:\Cowait` 装到 PATH（C 盘上只有一个指向 G:\Cowait 的 junction） |
| 数据目录 | `G:\Cowait\data`（clone 安装时数据跟着程序走，见 `src/paths.ts`） |
| 测试 | 104 个，全部通过（`npm test`） |
| 真机验证 | Linux 和 Windows 11 上都用真实 Claude Code 会话跑通过：留言送达且 Claude 照做、Edit 带行号、测试通过被识别。0.2.0 的钩子在开发它的那个真实会话里一直在用 |
| **用户全局 Claude Code 配置** | **没装**。`C:\Users\19826\.claude\settings.json` 没动过；改全局之前必须再问用户 |
| **项目级安装** | 已在 **`G:\Cowait` 本项目**里 `cowait install --project`。配置在 `G:\Cowait\.claude\settings.local.json`（已 gitignore，里面是本机绝对路径） |
| 使用方式 | 用户在 Windows Terminal 里开 Claude Code，`cowait split` 把面板开在右边 40%，用 Cowait 开发 Cowait |
| 下一步 | 用户实际用 0.2.0，收集体验问题（见第 8 节） |

## 3. 必须遵守的约定

- **产品名中英文都只叫 Cowait。** 不要再用“等等党”（用户 2026-11-01 明确要求）。
- **改 `~/.claude/settings.json`（全局）之前必须得到用户明确同意。** 默认用 `--project`。`cowait install` 本身也会先列出改动并要求确认（`--yes` 跳过）。
- **一切放 G 盘。** 用户 C 盘快满了（约 21 GB 空闲）。npm 缓存放 `G:\Cowait\.npm-cache`；配图录制的临时文件在 `G:\Cowait\data\.media`（录完自动删）。
- **npm：**
  - 从用户自己终端启动的 Claude Code CLI 里，`npm install --cache G:\Cowait\.npm-cache` 可以直接用（0.2.0 时验证过，环境里没有 `npm_config_allow_scripts`）。通过 Claude 桌面应用（`claude.exe`）连进来时，进程环境会被注入 `npm_config_allow_scripts`，项目级安装会报 `EALLOWSCRIPTS`：不要试图清掉这个变量（会被安全审查拦下），也不需要用户改系统设置，换到用户终端里的会话做即可。
  - 用户的 npm registry 是 npmmirror，`npm install <包>` 会把 `package-lock.json` 里该包的 `resolved` 改成 `registry.npmmirror.com`。提交前改回 `registry.npmjs.org`（其余条目都是官方源）。
  - 用户运行 Cowait 本身**不需要** `npm install`：`dist/` 里是 esbuild 打好的两个自包含文件，已提交进仓库。改了 `src/` 一定要 `npm run build`（或 `npm test`，它会先打包）并**把 `src/` 和 `dist/` 一起提交**；用户电脑上 `cd G:\Cowait; git pull` 就生效。
- **在 `G:\Cowait` 里用 Claude Code 开发 Cowait：** hook 就是本项目的 `dist\hook.js`，每次打包都会替换它，改坏会直接影响正在运行的 Claude Code（hook 报错不会卡住 Claude，但事件会丢）。改坏了就 `git checkout dist/`，或者 `cowait uninstall --project`。正在运行的面板进程用的是启动时的代码，要看新效果得关掉（`q`）再 `cowait split`。
- 每次改进后：跑测试 → 提交 → **推到 GitHub**（用户的固定要求）。提交身份用 `Zhaobin Xu <sea.xuo@gmail.com>`，并按你所在环境的要求加 AI 署名行。
- 仓库命名不要连字符/下划线；仓库保持干净，不留过程文件、临时文件和一次性脚本；删文件前先告诉用户删哪些。
- README 保持现在的双语风格（居中标题 + 动图/截图 + 徽章 + 导航行 + 叙事开头 + 三列亮点表），中英文两份同步改；徽章和“开发”一节里的测试数要跟着改。
- **配图**：浅色背景，不做暗色版本，不加角落小标注，能合并或删掉的就合并/删掉。`docs/media/` 里的图全部由 `npm run media` 从真实面板录出来（见第 6 节），界面改了就重录。
- 用户偏好“能用浏览器做的就用浏览器做”。GitHub 操作用用户电脑上已登录的 `gh`（账号 JaspinXu，keyring，https）。
- 用户偏好需要插画时用他电脑上的 Codex（`codex`）生成；README 目前只用真实录屏，不需要插画。

## 4. 用户电脑环境（Windows 11）

| | |
|---|---|
| 用户目录 | `C:\Users\19826`（设备名 xusea） |
| Shell | Windows PowerShell **5.1**；Claude Code CLI 跑在 Windows Terminal 里（`WT_SESSION` 有值，`cowait split` 可用） |
| Node / npm | v24.18.0（`D:\nodejs`）/ npm 11.18.0，registry 是 npmmirror |
| git | 2.55，`core.autocrlf=true`（仓库里有 `.gitattributes` 强制 LF） |
| 已装 | `gh`（已登录）、`claude`、`codex`（都在 `C:\Users\19826\AppData\Roaming\npm`）；ffmpeg（`C:\ffmpeg\bin`）；Python 3.11（anaconda `pytorch_env`，没有 pyte） |
| 浏览器 | Chrome 装在用户目录 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`（不在 Program Files）；也有 Edge |
| 字体 | Consolas、微软雅黑、Segoe UI Emoji；**系统里没有 Cascadia**（Windows Terminal 自带，但浏览器用不到） |
| 磁盘 | G: 约 95 GB 空闲；C: 约 21 GB 空闲 |

PowerShell 5.1 的坑：
- `Set-Content -Encoding utf8` 会写 **BOM**（Cowait 的 JSON 读取已兼容 BOM，见 `fsutil.parseJson`）。
- 不支持 `<` 输入重定向（整条脚本会解析失败）。
- 通过管道捕获的中文输出会被按 GBK 解码成乱码；在真实终端里显示正常，不是 bug。
- `ConvertFrom-Json` 解析大的 `state.json` 会失败，看状态用 Node。
- 用 `claude.cmd`（不是 `claude`）在 PowerShell 里调用 Claude Code CLI 更稳。

## 5. 架构

```
Claude Code ──hooks──▶ dist/hook.js ──append──▶ data/events.jsonl ──poll 400ms──▶ 面板（Ink TUI）
     ▲                       │                                                      │
     └── additionalContext / ┘◀── 按会话/项目原子认领 ── data/feedback/*.json ◀── 你写的话（n / m）
         一次性拦 Stop
```

- **Hook 事件**：`UserPromptSubmit`、`PostToolUse`（matcher `*`）、`Stop`、`Notification`、`SessionEnd`。故意**不**挂 `PreToolUse`（会给每次工具调用前加延迟）。hook 命令带标记参数 `--cowait-hook`，安装/卸载靠它识别自己的条目。
- **hook 的铁律**：无第三方依赖、永远 exit 0、4 秒硬超时、只在有留言要转达时才输出。`COWAIT_INTERNAL=1` 时什么都不做（Cowait 自己调 `claude -p` 出题时用）。Windows 上管道写是异步的，退出前要等 `stdout.write` 回调。hook 只 import `events/feedback/fsutil/paths/testdetect`，打包后约 11 KB。
- **留言**：每条留言文件带 `cwd`（属于哪个项目）和 `sid`（写给哪个 Claude 会话）。`claimNotes(cwd, sid)` 的规则（`feedback.ts` 的 `isFor`）：自己会话的一定拿；否则只拿“当前目录等于或在留言项目之内”的，**不拿父目录的**（开在 `~/code` 的会话不能吞掉 `~/code/shop-api` 的留言）；没标目标的谁都能拿（旧格式兼容）。路径比较用 `paths.normPath`（斜杠统一，Windows 盘符路径不区分大小写）。认领前先读一次文件判断归属，rename 原子认领后直接用读到的内容。解析失败的改名为 `*.unreadable`，**绝不静默删除**。送达方式：`PostToolUse`/`UserPromptSubmit` 时以 `additionalContext` 注入；`Stop` 时 `stop_hook_active` 为假就 `{"decision":"block"}` 让 Claude 多做一轮（只拦一次），此时不记 stop 事件。
- **卡片合并**（`engine/reducer.ts`）：同一会话、同一文件（`normPath` 比较）、还没审、最近一次改动在 30 分钟内、不超过 20 处，就把新改动追加到这张卡的 `more` 里（`last` 记最新时间）；否则开新卡。`cardDiff` 依次渲染每一处，中间插 `sep` 行（界面显示“第 N 处”）。
- **诚实审阅**：`economy.isSkim(changedLines, shownMs)`：出现后不到 `min(4000, 600 + 80×改动行数)` 毫秒就按 `y` 算“扫一眼”：卡片照样通过，但 0 能量，记 `totals.skimmed`，不计入覆盖率。“出现时间”在 `Review.tsx` 的模块级 `firstSeen` 里，按 `卡片id:处数` 记，审阅页被卸载（帮助、切页）也不会重置；有新改动合进来会重新计时。刷卡同理：出题后不到 `ECON.minStudyMs`（1.5 秒）就打分不加能量、不计数。`S` 连按两次跳过整个队列（算跳过，不算审过）。
- **事件日志**：hook 写、面板读（按字节偏移增量读）。不存 prompt 原文、不存 Read 的文件内容、不存命令输出；改动截断到 4000 字符。所有会话空闲且日志超过 2 MB 时由面板滚动清理。
- **面板状态落盘**：用户操作（审阅、留言、游戏、刷卡）立刻保存；从日志折叠来的变化最多每 3 秒存一次（崩溃了也能从日志重放，保存的 offset 只随它们前进），滚动清理日志时立刻存，退出时也会存。
- **信号**（reducer → UI）都带事件时间 `t`。比现在早 15 秒以上的信号（面板关着时发生的、重启后补读的）不响铃、不弹提醒、不切模式。
- **面板单实例**：`data/panel.lock`，防止两个面板重复结算奖励。
- **数据目录解析**（`src/paths.ts`）：`COWAIT_HOME` > clone 安装用 `<安装目录>/data` > npm 全局安装（在 node_modules 里）用 `~/.cowait`。
- **界面布局**：按 60 列的窄分屏设计（测试里有 60×26 的全界面溢出检查）。按键提示有长短两版，用 `fit()` 按宽度挑；大段文字一律用 `Para`/`Labeled`（底层是 `text.ts` 的 `wrapText`，中文可在任意两字之间断行、英文单词不拆、句末标点不放行首）；diff 长行用 `splitByWidth` 硬折行。

### 文件地图

```
src/
  hook.ts          Claude Code 调的 hook（快路径）
  events.ts        hook payload → 紧凑事件；优先用 tool_response.structuredPatch（真实行号）
  feedback.ts      留言队列（addNote / claimNotes(cwd, sid) / formatNotes）
  testdetect.ts    Bash 命令按 && ; | 拆段识别测试命令 + 读测试汇总行判断通过/失败
  install.ts       settings.json 合并/还原、状态栏（可选）、备份
  statusline.ts    可选的 Claude Code 状态栏
  text.ts          按终端列宽排版：wrapText（中英文折行）、splitByWidth（硬折行）
  config.ts / paths.ts（含 normPath/within）/ fsutil.ts / i18n.ts（中英文案 + 结构化帮助 helpContent）
  engine/          state（类型、默认值、notes 列表）、reducer（纯函数：事件→状态+带时间的信号；卡片合并）、
                   economy（isSkim、applyVerdict）、predict（等待预测含“已超时重估”、自动选模式）、diff（cardDiff、diffRows）、store（I/O、锁、滚动）
  game/engine.ts   捉虫地牢：纯函数、种子随机（mulberry32 状态存在 run 里）、可序列化
  game/meta.ts     一局结束时结算战绩和能量
  learn/           srs（Leitner）、decks（5 个内置中英双语卡组 + 用户/AI 卡组）、llm（ANTHROPIC_API_KEY 或 claude -p）、generate（describeChanges：最新改动优先）
  ui/              App（轮询、信号、全局按键、m 留言框、toast、提醒、延迟落盘）、Review、Game、Learn、
                   common（useLine、useRefState、Para、Labeled、InputLine、fit）
  demo.ts          模拟 Claude 会话（cowait demo）；导出 CWD/EDITS 给录图脚本用
  cli.ts           所有子命令
scripts/build.mjs  esbuild 打包成 dist/cli.js + dist/hook.js（react-devtools-core 用空桩替代）
scripts/media/     record.mjs + scenes.tsx：用真实面板录 README 配图（见第 6 节）
test/              vitest：engine / review（合并、扫一眼、折行）/ notes（路由）/ hook / install / game / wrap / ui（含 60 列溢出检查）
                   render.ts 是可指定终端宽高的渲染工具（ink-testing-library 固定 100 列）
                   helpers.ts 的 tempDir/tempHome 把临时目录建在 data/.test-tmp，每个测试文件结束时删掉（别再用 os.tmpdir()）
docs/media/        README 用的中英文配图：demo-*.gif、review/battle/learn-*.png（浅色）
```

### 关键数字

- 经济（`engine/economy.ts`）：审阅通过 +1⚡，针对卡片写留言 +2⚡（`m` 自由留言不加），刷卡 +1⚡，每日首次打开 +5⚡，通关 +5⚡；开局 3⚡（`runCost`）；新用户 10⚡。干活的一轮 +3💰，含测试通过再 +10💰，纯聊天 0。
- 扫一眼：`min(4000, 600 + 80 × 改动行数)` ms；刷卡最短 1500 ms。
- 卡片：同文件合并窗口 30 分钟、每卡最多 20 处、队列上限 80 张（先丢已审的）。留言记录保留最近 30 条。
- 面板：轮询 400 ms，折叠变化最多 3 秒落盘一次，toast 显示 4 秒，15 秒以前的信号不提醒。
- 装备价格：椅子 50、耳机 60、咖啡机 80、双屏 90、键盘 150（💰）。
- 游戏平衡（贪心机器人 1000 局）：裸装通关约 44%，椅子+耳机约 74%，满装备约 94%。改数值后跑 `test/game.test.ts`（断言裸装在 15%–70% 之间且装备有用）。
- hook 延迟：Linux 约 40 ms；Windows 约 47 ms（其中 39 ms 是 Node 启动）。
- 自动模式：第一次用（没有任何轮次和卡片）停在审阅页；有待审先审；有新改动进来就切回审阅（战斗中/打字中除外）；新一轮开工不打断战斗；预计等待 < 45 s 刷卡；否则有能量就玩。审完队列 1.5 秒后自动换模式，但只在你还停在审阅页时。

## 6. 常用命令

```bash
# 开发
npm install --cache G:\Cowait\.npm-cache   # 用户电脑上缓存放 G 盘
npm test              # 先打包再跑 104 个测试
npm run build         # tsc 类型检查 + esbuild 打包（改完 src 必须跑，并提交 dist）
npm run media         # 重录 docs/media（中英各一个 GIF + 三张截图）；只要截图：npm run media -- png
node dist/cli.js demo --fast

# 用户电脑（PowerShell）
cd G:\Cowait; git pull
cowait doctor
cowait demo
cowait install --project      # 在某个项目目录里运行，只改那个项目（G:\Cowait 本项目已经装了）
cowait uninstall --project    # 在 G:\Cowait 里运行即可撤销本项目的安装
```

**录配图**（`scripts/media/record.mjs`）：用 esbuild 把 `scenes.tsx` 打包后在本进程里跑，`scenes.tsx` 用脚本驱动真实的 `App`（假终端，`test/render.ts`）、写入和 hook 一样的事件，拿到每一帧的 ANSI 文本；`record.mjs` 把 ANSI 转成浅色主题 HTML（每个字符一个定宽格子，框线和血条画成图形），用无头 Chrome/Edge 截图（`CHROME=` 可指定），再用 ffmpeg 合成 GIF（`FFMPEG=` 可指定）。在这台电脑上跑一次约 2 分钟。要改演示内容，改 `scenes.tsx` 里的时间线和 `TEXT`。

## 7. 踩过的坑（改 UI/输入/hook 前先看）

1. **Ink 里连续按键会丢字/丢键**：状态更新前第二个键拿到的是旧值。按键处理里读的状态必须用 ref（`useLine`、`useRefState`）；模式切换用函数式 `setMode(m => …)`；`setTyping` 要同步更新 ref。0.2.0 又在学习页发现一次：“空格 + 2”按得太快，2 被吞（`flipped` 读的是旧值）。
2. **提醒弹出时吃掉按键**：打字时任何按键都归输入框，提醒不能拦（`App.tsx` 里先判断留言框和 `typingRef`，子组件 `active = !help && !noteOpen && (!alert || typing)`）。`m` 留言框打开后、React 重新渲染前到达的键，靠子组件开头的 `blocked()`（同步读 ref）挡住，不会漏到下面的审阅页。
3. **第一次没有历史时自动模式会选游戏**：0.2.0 起第一次用直接停在审阅页（顺便给出接入提示）。
4. **emoji 宽度**：🪙 在旧 Windows 字体里没有，换成 💰；🛡 ⚔ ❓ 🌀 宽度不确定，带边框的盒子里只用文字。✉ 这类宽度不确定的符号也别用，等待中的留言用 `✎N`。
5. **测试识别误判**：`cat pytest.ini` 曾被当成测试；现在按命令段解析，去掉环境变量和 `npx` / `uv run` / `python -m` 等包装后再判断。
6. **Windows BOM**：PowerShell/记事本写的 JSON 带 BOM，曾导致留言被认领后解析失败而丢失。现在所有 JSON 读取都走 `parseJson`。
7. **npm 改写 bin 文件换行符**：`core.autocrlf=true` 时 `dist/cli.js` 会显示为已修改；`.gitattributes` 已强制 LF。
8. **测试里的“小黄鸭”**：打出小黄鸭会抽一张牌，手牌数不变；UI 测试改为检查专注值。
9. **Ink 的折行只在空格处断**：中英混排时英文单词会单独占一行、标点会跑到行首。大段文字用 `Para`/`Labeled`，不要直接 `<Text wrap="wrap">`。
10. **内容比面板高时 Yoga 会把中间的行压扁吃掉**（帮助页曾经少了一行），而不是在底部裁掉。`App` 里的内容区包了一层 `flexShrink={0}`，别去掉。
11. **延时触发的自动切换要在触发时重新检查当前模式**：“审完 1.5 秒后自动换模式”曾经把已经自己切到学习页的用户拽回游戏。
12. **合并卡片后旧测试的前提变了**：对同一个文件连续改多次只会有一张卡；需要多张卡的测试要改不同的文件。
13. **`ink-testing-library` 固定 100 列**：测窄屏用 `test/render.ts` 的 `renderSized`。
14. **环境里有 `NO_COLOR`**：录图脚本会删掉它并设 `FORCE_COLOR=3`，否则 Ink 不输出颜色。

## 8. 路线图 / 还没做的

- **马上**：用户在 0.2.0 上实际用一段时间，收集体验问题。0.2.0 之前的真实数据：开发它的那个长会话里 Claude 改了 150 处、用户审了 0 张，刷了 13 张卡、玩了 1 局。合并卡片和 `S` 是对这个的第一步回应；后续可以考虑“一轮结束时的改动摘要卡”（按轮而不是按文件审）、或者把审阅入口做得更轻。
- 产品：
  - “提前问”假设队列（创立时的方向 B）：让 Claude 把不确定的假设推给面板，用户异步确认。会改变 Claude 每个会话的行为（要往上下文里加说明），做之前和用户确认、做成可选
  - 团队版的审阅覆盖率报告（现在有 `cowait stats`，扫一眼不计入）
  - 更多为等待设计的游戏：随 Claude 产出成长的基地经营、短等待用的每日谜题
  - 更准的等待预测：按任务类型、prompt 长度预测
  - VS Code 扩展形态
- 商业化（创立会话里定的方向）：
  - 免费版：三模式全开
  - 个人 Pro：更多游戏/皮肤、AI 导师学习路线
  - **团队版是主要收入**：AI 代码人工审阅覆盖率报告、团队看板
  - 赞助内容：开发者工具公司赞助学习卡组/游戏道具，而不是去卷 spinner 广告位
- 发布：npm 包名 `cowait` 在 2026-11-01 时还没被占。发布前确认用户同意，且仓库目前是私有的。

## 9. 可以清理的测试残留

用户电脑上 `G:\Cowait\data\` 里有 Windows 真机测试留下的 `e2e-test\`（一个带项目级 hooks 的临时项目）、`e2e-home\`、`latency-test\`、`bomtest.json`。它们被 `.gitignore` 忽略，不影响面板（面板读的是 `G:\Cowait\data\events.jsonl`），删掉前先问用户。

C 盘临时目录（`%TEMP%`）里还有 0.2.0 之前的测试留下的约 260 个小文件夹（`cowait-test-*`、`claude-cfg-*`，另有一个 `cowait-frames-*`），合计约 120 KB。0.2.0 起测试不再往那里写；这些旧的可以删，删前先问用户（AI 通道里批量删临时目录会被安全审查拦下，可以请用户自己运行：
`Get-ChildItem $env:TEMP -Directory | Where-Object Name -match '^(cowait-(test|frames)-|claude-cfg-)' | Remove-Item -Recurse -Force`）。
