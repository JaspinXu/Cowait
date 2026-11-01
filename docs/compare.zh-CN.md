# Cowait 和同类工具的比较

[English](compare.md) · **简体中文**

围绕“等 Claude Code 干活”这段时间，已经有不少工具。这一页把 Cowait for Claude Code 和它们放在一起比，方便你挑合适的。其他工具的描述来自它们 2026 年 11 月时的公开页面和公告；如果哪里过时了，欢迎[提个 issue](https://github.com/JaspinXu/Cowait/issues)。

## 一览

| | 用来做什么 | 和 Cowait 的关系 |
|---|---|---|
| **Claude Code 自带的 `/diff` 面板** | 在全屏模式下，对话旁边显示未提交的改动 | 看 diff 最省事的办法。Cowait 按轮整理改动、把你的话转给 Claude、记录你真正看过多少 |
| **会话监控**（[ccglance](https://www.hunted.space/product/ccglance)、[Crystl](https://crystl-web.pages.dev/blog/reviewing-agent-work)） | 同时盯多个会话、权限确认、任务完成提醒 | Cowait 也会在 Claude 干完或要你确认时响铃，但核心是看懂改动，而不是会话看板 |
| **在编辑器里审**（[Wing IDE 的审阅按钮](https://wingware.com/doc/claudecode/tool)）、**kizu** | 在 IDE 或审阅终端里看 Claude 的 diff | 思路最接近。Cowait 多了：一句话 Claude 下一步就看到、诚实的审阅覆盖率、看完之后有事可做 |
| **游戏**（[claudemon](https://www.producthunt.com/posts/claudemon)、[Claude Code Arcade](https://www.everydev.ai/tools/claude-code-arcade)、ClaudeLab） | Claude 干活时玩点什么 | Cowait 的游戏要用审代码赚的能量来玩，奖励只看 Claude 的成果，从不看等了多久 |
| **学习**（sidequest） | Claude 干活时在旁边学一个无关的主题 | Cowait 的抽认卡还能用 Claude 刚写的代码出题 |
| **spinner 广告**（Kickbacks.ai、spinyield、IdleAds） | 把转圈动画当广告位，分广告收入 | Cowait 没有广告，也不收集任何数据 |

## Claude Code 自带的 `/diff` 面板

从 Claude Code v2.1.260 起，`/diff` 会在全屏模式下于对话旁边打开一个面板，显示 Claude 正在做的未提交改动（[版本更新解读](https://dev.classmethod.jp/en/articles/20260904-cc-updates-v2-1-260/)）。如果你只是想看看 diff，直接用它：自带、零配置。

Cowait 在另一个层面上：

- **按轮，而不是按工作区。** 每一轮的标题就是你当时说的话，带用时和测试结果；同一轮里一个文件改了几次就合在一起看。
- **不打断也能纠偏。** 针对某个文件（或者随便什么）写一句话，Claude 下一次调用工具时就会看到，只送给对应的会话和项目。
- **诚实的覆盖率。** 只有在屏幕上停留够久的文件才算审过；`cowait report` 能生成按天、按项目的报告。
- **独立的窗格。** 它待在 Claude Code 旁边，任何终端都行，不在 Claude Code 的全屏界面里。

## 会话监控和提醒

[ccglance](https://www.hunted.space/product/ccglance) 是一个 macOS 浮动面板，按项目列出多个会话，哪个在等权限确认就立刻标出来。[Crystl](https://crystl-web.pages.dev/blog/reviewing-agent-work) 在 Claude 需要确认、出错或完成时发通知，并提供对话和终端输出的分屏视图。

如果你同时跑很多会话，主要想知道哪个在等你，它们更合适。Cowait 显示你正在用的这个会话的状态（工作中、在等你、需要确认、这一轮比平时久没久），Claude 干完时响铃，然后帮你看懂它做了什么。它在终端里运行，Windows、macOS、Linux 都行。

## 在编辑器或审阅终端里审

Wing IDE 在 Claude 空闲且有改动时显示一个审阅按钮，点开就是 diff 视图（[文档](https://wingware.com/doc/claudecode/tool)）。kizu 是一个实时盯 diff、可以行内审阅的终端工具。

它们和 Cowait 的“审阅”最接近。区别在于：Cowait 在 Claude 还在干活时就能一个文件一个文件地审；你的话通过 Claude Code 的 hooks 送达（作为 `additionalContext`，或者在一轮结束时拦一次），不用另发一条消息；并且记录一个“扫一眼”刷不上去的覆盖率。

## 等待时玩游戏

[claudemon](https://www.producthunt.com/posts/claudemon) 是一个宝可梦风格的游戏，Claude 干活时自动推进，在另一个终端标签页里战斗。[Claude Code Arcade](https://www.everydev.ai/tools/claude-code-arcade) 把状态栏变成由 Claude 活动驱动的街机游戏。ClaudeLab 是等距像素风的办公室动画。

Cowait 也有游戏：捉虫地牢（卡牌闯关）、栈机谜题（每天一道，人人同题）、代码速打（照着打真实的代码）。区别在于外面那一圈规则：开游戏要花能量，而能量只能靠真正看 Claude 的改动来赚；买装备的金币只来自 Claude 的成果（真正干了活的一轮、通过的测试）。空转二十分钟什么都没干成的一轮，不会多给任何奖励。

## 等待时学习

sidequest 用 hooks 判断 Claude 是否在忙，然后用小模型在旁边教你一个无关的主题。Cowait 的学习页是间隔重复的抽认卡（Git、网络、并发、LLM、系统设计），也能让 AI 按任意主题出题，或者直接拿 Claude 刚改的代码考你，学的东西指向你自己的项目。

## spinner 广告

Kickbacks.ai、spinyield、IdleAds 等把转圈动画的文字换成赞助内容并分成收入。Cowait 没有广告、没有账号、没有遥测；除非你让 AI 出题，否则什么都不会离开你的电脑。

## 什么时候 Cowait 不适合你

- 你想在 IDE 里审：编辑器集成更合适。
- 你同时跑很多会话，想要一个总览看板：试试会话监控工具。
- 你不想在 Claude Code 的配置里加任何东西：Cowait 需要 hooks（默认只装到当前项目，先备份配置文件，`cowait uninstall` 只删它自己加的条目）。
- 你只想看 diff：`/diff` 已经自带了。
