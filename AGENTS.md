# AGENTS.md — Cowait 接手指南

> 给接手这个项目的 AI agent / 新账号看的。读完这一份就能无缝继续。
> 这次创立会话的完整来龙去脉（市场调研、每个决定为什么这么做、踩过的坑）在
> [`docs/history/2026-11-01-founding-session.md`](docs/history/2026-11-01-founding-session.md)。
> 和用户沟通用**中文**。

---

## 1. 一句话

Cowait 是一个放在 Claude Code 旁边分屏里的终端面板，把等 Claude 干活的时间变成有用的时间：
**审阅** Claude 刚做的改动（并能写一句话实时转达给 Claude），玩回合制卡牌小游戏 **捉虫地牢**，
或者用抽认卡**学习**（含“用 Claude 刚写的代码出题”）。三种模式由一套经济系统连起来：
⚡ 能量靠你审代码/刷卡赚、用来开游戏（先审后玩）；💰 金币只看 Claude 的成果（干活 +3、测试通过 +10），不看等了多久。

## 2. 当前状态（2026-11-01）

| 项 | 状态 |
|---|---|
| 版本 | 0.1.0，功能完整可用 |
| 仓库 | **私有** `https://github.com/JaspinXu/Cowait`（仓库名首字母大写是用户明确要求的；npm 包名和命令必须小写 `cowait`） |
| 用户电脑上的安装 | `G:\Cowait`（git clone），`cowait` 命令通过 `npm install -g G:\Cowait` 装到 PATH（C 盘上只有一个指向 G:\Cowait 的 junction） |
| 数据目录 | `G:\Cowait\data`（clone 安装时数据跟着程序走，见 `src/paths.ts`） |
| 测试 | 64 个，全部通过（`npm test`） |
| 真机验证 | Linux 和 Windows 11 上都用真实 Claude Code 会话跑通过：留言送达且 Claude 照做、Edit 带行号、测试通过被识别 |
| **用户全局 Claude Code 配置** | **没装**。`C:\Users\19826\.claude\settings.json` 没动过；改全局之前必须再问用户 |
| **项目级安装** | 用户选择“就在本项目试”：已在 **`G:\Cowait` 本项目**里 `cowait install --project`（2026-11-01）。配置在 `G:\Cowait\.claude\settings.local.json`（已 gitignore，里面是本机绝对路径）。用真实 Claude Code 会话验证过，事件写进 `G:\Cowait\data\events.jsonl` |
| 下一步 | 用户在 `G:\Cowait` 里启动 Claude Code，再开一个分屏运行 `cowait`（在 Windows Terminal 里可以 `cowait split`），用 Cowait 开发 Cowait |

## 3. 必须遵守的约定

- **产品名中英文都只叫 Cowait。** 不要再用“等等党”（用户 2026-11-01 明确要求；创立会话里曾用过这个中文名，已全部去掉）。
- **改 `~/.claude/settings.json`（全局）之前必须得到用户明确同意。** 默认用 `--project`。`cowait install` 本身也会先列出改动并要求确认（`--yes` 跳过）。
- **一切放 G 盘。** 用户 C 盘快满了（约 21 GB 空闲）。npm 缓存之类的临时东西也不要往 C 盘写。
- **关于 `npm_config_allow_scripts` 和 `EALLOWSCRIPTS`（已查清，2026-11-01）：** 通过 Claude 桌面应用（`claude.exe`）连到用户电脑时，进程环境里会带 `npm_config_allow_scripts=@anthropic-ai/claude-code`。它**不是用户设的**：用户级、系统级环境变量和 PowerShell profile 里都没有（父进程链是 `claude.exe → cmd → node(Desktop Commander) → powershell`）。npm 11.18 在项目级安装里拒绝来自环境变量/命令行的 allow-scripts，所以**在这条通道里**项目级 `npm install` 会报 `EALLOWSCRIPTS`。用户自己的 `C:\Users\19826\.npmrc` 里有同样的白名单 `allow-scripts=@anthropic-ai/claude-code`；沙盒里用同版本 npm 11.18 验证过：只有 `.npmrc`、没有环境变量时，项目级安装正常。结论和做法：
  - 不要试图清掉这个变量（在 AI 的执行通道里清它会被安全审查拦下，属于削弱安全设置），也不需要用户改任何系统设置。
  - 用户在**自己的终端**（或从自己终端启动的 Claude Code CLI）里，`G:\Cowait` 的 `npm install` 应该可以直接用；npm 缓存放 G 盘：`npm install --cache G:\Cowait\.npm-cache`。如果仍报 `EALLOWSCRIPTS`，先看 `$env:npm_config_allow_scripts` 是从哪来的，再和用户商量。
  - 用户运行 Cowait 本身**不需要** `npm install`：`dist/` 里是 esbuild 打好的两个自包含文件，已提交进仓库，clone 下来就能跑。改了 `src/` 一定要 `npm run build` 并**把 `src/` 和 `dist/` 一起提交**；用户电脑上 `cd G:\Cowait; git pull` 就生效（全局命令是 junction，自动指向新代码）。
- **在 `G:\Cowait` 里用 Claude Code 开发 Cowait 时注意两点：**
  1. 改了 `src/` 之后要先 `npm install --cache G:\Cowait\.npm-cache`（第一次）再 `npm run build`，`dist/` 更新了改动才会生效。从用户自己的终端启动的 Claude Code 里应该能跑（见上一条）；如果遇到 `EALLOWSCRIPTS`，就到 Linux 沙盒构建后提交 `dist/`，这边 `git pull`。
  2. hook 就是本项目里的 `G:\Cowait\dist\hook.js`，改坏它会直接影响正在运行的 Claude Code（hook 报错不会卡住 Claude，但事件会丢）。改坏了就 `git checkout dist/`，或者 `cowait uninstall --project` 先卸掉。
- 每次改进后：跑测试 → 提交 → **推到 GitHub**（用户的固定要求）。提交身份用 `Zhaobin Xu <sea.xuo@gmail.com>`，并按你所在环境的要求加 AI 署名行。
- 仓库命名不要连字符/下划线；README 保持现在的双语风格（居中标题 + 动图/截图 + 徽章 + 导航行 + 叙事开头 + 三列亮点表），中英文两份同步改。
- 用户偏好“能用浏览器做的就用浏览器做”。但 Claude 桌面版内置浏览器**没有登录 GitHub**，GitHub 操作用用户电脑上已登录的 `gh`（账号 JaspinXu，keyring，https）。
- 用户偏好需要图片时用他电脑上的 Codex（`codex`，npm 全局安装）生成。目前 README 用的是真实终端截图和 GIF（`docs/media/`），没有生成图。

## 4. 用户电脑环境（Windows 11）

| | |
|---|---|
| 用户目录 | `C:\Users\19826`（设备名 xusea） |
| Shell | Windows PowerShell **5.1**（Desktop Commander 默认 shell） |
| Node / npm | v24.18.0（`D:\nodejs`）/ npm 11.18.0，registry 是 npmmirror |
| git | 2.55，`core.autocrlf=true`（仓库里有 `.gitattributes` 强制 LF） |
| 已装 | `gh`（已登录）、`claude`、`codex`（都在 `C:\Users\19826\AppData\Roaming\npm`） |
| 磁盘 | G: 约 95 GB 空闲；C: 约 21 GB 空闲 |

PowerShell 5.1 的坑：
- `Set-Content -Encoding utf8` 会写 **BOM**（Cowait 的 JSON 读取已兼容 BOM，见 `fsutil.parseJson`）。
- 不支持 `<` 输入重定向（整条脚本会解析失败）。
- 通过管道捕获的中文输出会被按 GBK 解码成乱码；在真实终端里显示正常，不是 bug。
- 用 `claude.cmd`（不是 `claude`）在 PowerShell 里调用 Claude Code CLI 更稳。

## 5. 架构

```
Claude Code ──hooks──▶ dist/hook.js ──append──▶ data/events.jsonl ──poll 400ms──▶ 面板（Ink TUI）
     ▲                       │                                                      │
     └── additionalContext / ┘◀──── 原子认领 ──── data/feedback/*.json ◀── 你写的话 ┘
         一次性拦 Stop
```

- **Hook 事件**：`UserPromptSubmit`、`PostToolUse`（matcher `*`）、`Stop`、`Notification`、`SessionEnd`。故意**不**挂 `PreToolUse`（会给每次工具调用前加延迟）。hook 命令带标记参数 `--cowait-hook`，安装/卸载靠它识别自己的条目。
- **hook 的铁律**：无第三方依赖、永远 exit 0、4 秒硬超时、只在有留言要转达时才输出。`COWAIT_INTERNAL=1` 时什么都不做（Cowait 自己调 `claude -p` 出题时用）。Windows 上管道写是异步的，退出前要等 `stdout.write` 回调。
- **留言转达**：`PostToolUse`/`UserPromptSubmit` 时以 `hookSpecificOutput.additionalContext` 注入；`Stop` 时如果有留言且 `stop_hook_active` 为假，就返回 `{"decision":"block","reason":…}` 让 Claude 多做一轮（只拦一次，防死循环），此时不记 stop 事件。留言文件用 rename 原子认领；解析失败的改名为 `*.unreadable`，**绝不静默删除**。
- **事件日志**：hook 写、面板读（按字节偏移增量读）。不存 prompt 原文、不存 Read 的文件内容、不存命令输出；改动截断到 4000 字符。所有会话空闲且日志超过 2 MB 时由面板滚动清理。
- **面板单实例**：`data/panel.lock`，防止两个面板重复结算奖励。
- **数据目录解析**（`src/paths.ts`）：`COWAIT_HOME` > clone 安装用 `<安装目录>/data` > npm 全局安装（在 node_modules 里）用 `~/.cowait`。

### 文件地图

```
src/
  hook.ts          Claude Code 调的 hook（快路径，只依赖 events/feedback/fsutil/paths）
  events.ts        hook payload → 紧凑事件；优先用 tool_response.structuredPatch（真实行号）
  feedback.ts      留言队列（addNote / claimNotes / formatNotes）
  testdetect.ts    Bash 命令按 && ; | 拆段识别测试命令 + 读测试汇总行判断通过/失败
  install.ts       settings.json 合并/还原、状态栏（可选）、备份
  statusline.ts    可选的 Claude Code 状态栏
  config.ts / paths.ts / fsutil.ts / i18n.ts（中英文案，lang=auto 跟随系统）
  engine/          state（类型与默认值）、reducer（纯函数：事件→状态+信号）、economy、predict（等待预测+自动选模式）、diff、store（I/O、锁、滚动）
  game/engine.ts   捉虫地牢：纯函数、种子随机（mulberry32 状态存在 run 里）、可序列化
  game/meta.ts     一局结束时结算战绩和能量
  learn/           srs（Leitner）、decks（5 个内置中英双语卡组 + 用户/AI 卡组）、llm（ANTHROPIC_API_KEY 或 claude -p）、generate
  ui/              App（轮询、信号、全局按键、提醒）、Review、Game、Learn、common（useLine 行编辑器）
  demo.ts          模拟 Claude 会话（cowait demo）
  cli.ts           所有子命令
scripts/build.mjs  esbuild 打包成 dist/cli.js + dist/hook.js（react-devtools-core 用空桩替代）
scripts/media/     Linux 下用 pty + pyte 录 README 截图/GIF、测打字丢字的脚本
test/              vitest：hook 协议、reducer/经济/预测/diff/测试识别/SRS、安装器、游戏平衡、UI 交互
docs/media/        README 用的中英文截图和 GIF
```

### 关键数字

- 经济（`engine/economy.ts`）：审阅通过 +1⚡，写留言 +2⚡，刷卡 +1⚡，每日首次打开 +5⚡，通关 +5⚡；开局 3⚡（`runCost`）；新用户 10⚡。干活的一轮 +3💰，含测试通过再 +10💰，纯聊天 0。
- 装备价格：椅子 50、耳机 60、咖啡机 80、双屏 90、键盘 150（💰）。
- 游戏平衡（贪心机器人 1000 局）：裸装通关约 44%，椅子+耳机约 74%，满装备约 94%。改数值后跑 `test/game.test.ts`（断言裸装在 15%–70% 之间且装备有用）。
- hook 延迟：Linux 约 40 ms；Windows 约 47 ms（其中 39 ms 是 Node 启动）。
- 自动模式：有待审先审；有新改动进来就切回审阅（战斗中/打字中除外）；预计等待 < 45 s 刷卡；否则有能量就玩。

## 6. 常用命令

```bash
# 开发（Linux / 能正常 npm install 的机器）
npm install
npm test              # 先打包再跑 64 个测试
npm run build         # tsc 类型检查 + esbuild 打包（改完 src 必须跑，并提交 dist）
node dist/cli.js demo --fast

# 用户电脑（PowerShell）
cd G:\Cowait; git pull
cowait doctor
cowait demo
cowait install --project      # 在某个项目目录里运行，只改那个项目（G:\Cowait 本项目已经装了）
cowait uninstall --project    # 在 G:\Cowait 里运行即可撤销本项目的安装
```

## 7. 踩过的坑（改 UI/输入/hook 前先看）

1. **Ink 里连续按键会丢字**：状态更新前第二个键拿到的是旧值。行编辑器必须用 ref 保存当前文本（`ui/common.tsx` 的 `useLine`）；模式切换用函数式 `setMode(m => …)`；`setTyping` 要同步更新 ref。
2. **提醒弹出时吃掉按键**：打字时任何按键都归输入框，提醒不能拦（`App.tsx` 里先判断 `typingRef`，子组件 `active = !help && (!alert || typing)`）。
3. **第一次没有历史时自动模式会选游戏**：后来加了“新改动进来就切回审阅”。
4. **emoji 宽度**：🪙 在旧 Windows 字体里没有，换成 💰；🛡 ⚔ ❓ 🌀 宽度不确定，带边框的盒子里只用文字。
5. **测试识别误判**：`cat pytest.ini` 曾被当成测试；现在按命令段解析，去掉环境变量和 `npx` / `uv run` / `python -m` 等包装后再判断。
6. **Windows BOM**：PowerShell/记事本写的 JSON 带 BOM，曾导致留言被认领后解析失败而丢失。现在所有 JSON 读取都走 `parseJson`。
7. **npm 改写 bin 文件换行符**：`core.autocrlf=true` 时 `dist/cli.js` 会显示为已修改；`.gitattributes` 已强制 LF。
8. **测试里的“小黄鸭”**：打出小黄鸭会抽一张牌，手牌数不变；UI 测试改为检查专注值。

## 8. 路线图 / 还没做的

- **马上**：帮用户在 Windows Terminal 里把面板分屏开在 Claude Code 旁边（`cowait split` 需要在 Windows Terminal 里运行，`WT_SESSION` 才存在），在本项目里实际用起来，收集体验问题。
- 产品：
  - “提前问”假设队列：让 Claude 把不确定的假设推给面板，用户异步确认
  - 更多为等待设计的游戏：随 Claude 产出成长的基地经营、短等待用的每日谜题
  - 更准的等待预测：按任务类型、prompt 长度预测
  - VS Code 扩展形态
- 商业化（创立会话里定的方向）：
  - 免费版：三模式全开
  - 个人 Pro：更多游戏/皮肤、AI 导师学习路线
  - **团队版是主要收入**：AI 代码人工审阅覆盖率报告、团队看板
  - 赞助内容：开发者工具公司赞助学习卡组/游戏道具，而不是去卷 spinner 广告位
- 发布：npm 包名 `cowait` 在 2026-11-01 时还没被占（`interlude` 被一个 2012 年的函数式 JS 库占了）。发布前确认用户同意，且仓库目前是私有的。
- README 头图：用户偏好用 Codex 生成图片，可以考虑做一张横幅（保留现在的真实 GIF）。

## 9. 可以清理的测试残留

用户电脑上 `G:\Cowait\data\` 里有 Windows 真机测试留下的 `e2e-test\`（一个带项目级 hooks 的临时项目）、`e2e-home\`、`latency-test\`、`bomtest.json`。它们被 `.gitignore` 忽略，不影响面板（面板读的是 `G:\Cowait\data\events.jsonl`），删掉前先问用户。
