import type { Config } from './config.js';

export type Lang = 'zh' | 'en';

export function resolveLang(cfg: Pick<Config, 'lang'>): Lang {
  if (cfg.lang === 'zh' || cfg.lang === 'en') return cfg.lang;
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  if (env) return env.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

const S = {
  zh: {
    brand: 'Cowait',
    st_busy: 'Claude 工作中',
    st_idle: 'Claude 空闲，等你下指令',
    st_attention: 'Claude 在等你确认',
    st_none: '等 Claude 开工',
    st_more: '（共 {n} 个会话在跑）',
    eta: '预计 {t}',
    st_longer: '比平时久',
    mode_review: '审阅',
    mode_game: '游戏',
    mode_learn: '学习',
    auto: '自动',
    footer: 'Tab 切换模式 · m 给 Claude 留言 · a 自动[{on}] · ? 帮助 · q 退出',
    footer_short: 'Tab 切换 · m 留言 · a 自动[{on}] · ? 帮助 · q 退出',
    on: '开',
    off: '关',
    done: '✔ Claude 完成了 · 用时 {t}',
    done_edits: ' · 改动 {n} 处',
    done_edit1: ' · 改动 1 处',
    done_cwd: '（{dir}）',
    done_coins: '+{n}💰',
    done_pass: '测试通过',
    done_fail: '测试没过',
    done_pending: '待审 {n}',
    done_none: '这一轮没动手干活，不发💰',
    attention: '⚠ Claude 在等你确认：{msg}',
    daily: '☀ 今日首次打开 +{n}⚡',
    anykey: '按任意键继续',
    help_close: '按任意键关闭帮助',
    // notes to Claude (any time, m)
    note_prompt: '✎ 给 Claude 留言：',
    note_prompt_to: '✎ 给 Claude 留言（{dir}）：',
    note_hint: 'Enter 发送 · Esc 取消',
    note_sent_busy: '✎ 已记下 —— Claude 下一步操作时就会看到',
    note_sent_idle: '✎ 已记下 —— 下次给 Claude 发消息时一起带过去',
    note_off: '留言转达已关闭（cowait config feedback true 可以打开）',
    delivered_one: '✓ Claude 收到了你的留言',
    delivered_n: '✓ Claude 收到了你的 {n} 条留言',
    // review
    rv_title: '审阅 Claude 的改动',
    rv_pending: '待审 {n}',
    rv_cov: '覆盖率 {p}',
    rv_relayed: '已转达 {n} 条',
    rv_empty: '没有待审的改动 ✓',
    rv_empty_hint: 'Claude 每改一个文件，就会变成一张卡片出现在这里。看一眼、标个 ✓，或者写一句话让它改。',
    rv_empty_play: '审完了，能量 ⚡{e}。按 Tab 去玩一局或学点东西。',
    rv_setup: 'Cowait 还没接入 Claude Code。',
    rv_setup_cmd: '在你的项目目录里运行：cowait install --project',
    rv_setup_then: '然后重启 Claude Code。只想先看看效果：cowait demo',
    rv_keys: 'y 没问题 +1⚡ · n 有问题→告诉Claude +2⚡ · s 跳过 · ←→ 换卡 · ↑↓ 滚动',
    rv_keys_short: 'y 通过 · n 写给Claude · s 跳过 · ←→ 换卡 · ↑↓',
    rv_new_file: '新文件',
    rv_parts: '{n} 处修改',
    rv_part: '── 第 {n} 处 ──',
    kind_edit: '修改',
    kind_write: '写入',
    kind_multiedit: '多处修改',
    kind_notebook: '笔记本',
    rv_ago: '{t}前',
    rv_more: '… 还有 {n} 行（↓ 滚动）',
    rv_note: '✎ 想对 Claude 说：',
    rv_note_hint: 'Enter 发送 · Esc 取消',
    rv_queued_busy: '已记下 +{n}⚡ —— Claude 下一步操作时就会看到这句话',
    rv_queued_idle: '已记下 +{n}⚡ —— 你下次给 Claude 发消息时会一起带过去',
    rv_ok: '✓ +{n}⚡',
    rv_skim: '✓ 已通过 · 太快了，不算审过，不加⚡',
    rv_skip: '已跳过',
    rv_skip_all_ask: '再按一次 S 跳过全部 {n} 张（算作跳过，不算审过）',
    rv_skip_all_done: '已跳过 {n} 张',
    // learn
    ln_title: '学习',
    ln_all: '全部卡组',
    ln_due: '待复习 {n}',
    ln_new: '新卡',
    ln_review: '复习',
    ln_q: '问',
    ln_a: '答',
    ln_flip: '按 空格 翻面',
    ln_rate: '1 没记住 · 2 记住了 · 3 太简单   （都 +1⚡）',
    ln_keys: 'd 换卡组 · t 学一个新主题(AI) · g 用 Claude 刚写的代码出题(AI)',
    ln_keys_short: 'd 换卡组 · t 新主题(AI) · g 考考刚写的代码(AI)',
    ln_done: '这一组暂时都复习完了 🎉',
    ln_done_hint: '按 d 换个卡组，或按 t 让 AI 出一组新主题的题。',
    ln_generating: '⏳ 正在出题，你可以接着刷卡……',
    ln_generated: '✓ 新卡组「{t}」好了，共 {n} 张，已切换过去',
    ln_failed: '出题失败：{e}',
    ln_no_provider: '要 AI 出题，需要设置 ANTHROPIC_API_KEY，或者装好并登录 claude 命令',
    ln_no_changes: 'Claude 还没改过代码，先去干点活吧',
    ln_topic: '想学什么主题：',
    ln_gained: '+{n}⚡',
    ln_quick: '太快了，这张不加⚡',
    // game
    gm_title: '捉虫地牢',
    gm_intro: '你是一名调试员。往下打穿 6 层 Bug，最后修好「栈溢出」。',
    gm_intro2: '回合制，一次一个按键，Claude 一干完就能放下，下次等待接着打。',
    gm_new: 'n 开新一局（-{c}⚡）',
    gm_shop: 's 装备商店',
    gm_poor: '⚡ 不够开局：去审阅（+1~2⚡）或刷卡（+1⚡）攒点能量。先审后玩 :)',
    gm_owned: '已有装备：{list}',
    gm_owned_none: '还没有装备',
    gm_record: '通关 {w} 次 · 最深第 {f} 层 · 共 {r} 局',
    gm_floor: '第 {f}/{n} 层',
    gm_intent: '意图',
    gm_atk: '攻击 {d}',
    gm_blk: '防御 {a}',
    gm_myst: '？？看不透',
    gm_rec: '递归（+{b} 格挡，之后更疼）',
    gm_vuln: '易伤{n}',
    gm_weak: '虚弱{n}',
    gm_incoming: '⚠ 结束回合会受到 {n} 伤害',
    gm_safe: '✓ 挡得住',
    gm_hand: '手牌',
    gm_keys: '数字键 出牌 · e 结束回合',
    gm_reward: '击败了！选一张新卡加进牌组：',
    gm_rest: '{k}  休息：回复 {n} 生命',
    gm_dead: '💀 你倒在了第 {f} 层……',
    gm_victory: '🏆 通关！「栈溢出」被你修好了。奖励 +{e}⚡',
    gm_shop_title: '装备商店 —— 用 💰 买，永久生效',
    gm_shop_hint: '💰 只能靠 Claude 的成果赚：干了活的一轮 +3，测试通过再 +10。等再久也不会多给。',
    gm_bought: '买到了：{n}！',
    gm_have: '已拥有',
    gm_poor_coins: '💰 不够',
    gm_back: 'b 返回',
    gm_you: '你',
    gm_block: '格挡',
    gm_observed: '已观测',
    another: '另一个 Cowait 面板已经在运行（PID {pid}）。同一时间只能开一个，不然奖励会被算两次。',
  },
  en: {
    brand: 'Cowait',
    st_busy: 'Claude is working',
    st_idle: 'Claude is idle — your move',
    st_attention: 'Claude needs your approval',
    st_none: 'Waiting for Claude',
    st_more: ' ({n} sessions running)',
    eta: 'est. {t}',
    st_longer: 'longer than usual',
    mode_review: 'Review',
    mode_game: 'Play',
    mode_learn: 'Learn',
    auto: 'auto',
    footer: 'Tab switch mode · m note to Claude · a auto-pick [{on}] · ? help · q quit',
    footer_short: 'Tab mode · m note · a auto [{on}] · ? help · q quit',
    on: 'on',
    off: 'off',
    done: '✔ Claude finished · took {t}',
    done_edits: ' · {n} edits',
    done_edit1: ' · 1 edit',
    done_cwd: ' ({dir})',
    done_coins: '+{n}💰',
    done_pass: 'tests passed',
    done_fail: 'tests failed',
    done_pending: '{n} to review',
    done_none: 'no real work this turn, no coins',
    attention: '⚠ Claude is waiting for you: {msg}',
    daily: '☀ First open today +{n}⚡',
    anykey: 'press any key',
    help_close: 'press any key to close help',
    note_prompt: '✎ Note to Claude: ',
    note_prompt_to: '✎ Note to Claude ({dir}): ',
    note_hint: 'Enter send · Esc cancel',
    note_sent_busy: '✎ Noted — Claude sees it on its very next step',
    note_sent_idle: '✎ Noted — it goes along with your next message to Claude',
    note_off: 'Relaying notes is off (turn it on with: cowait config feedback true)',
    delivered_one: '✓ Claude got your note',
    delivered_n: '✓ Claude got your {n} notes',
    rv_title: "Review Claude's changes",
    rv_pending: '{n} to review',
    rv_cov: 'coverage {p}',
    rv_relayed: 'relayed {n}',
    rv_empty: 'Nothing to review ✓',
    rv_empty_hint: 'Every file Claude changes shows up here as a card. Glance, approve, or write one line asking it to fix something.',
    rv_empty_play: 'All reviewed, ⚡{e}. Press Tab to play or learn.',
    rv_setup: 'Cowait is not hooked into Claude Code yet.',
    rv_setup_cmd: 'In your project folder run: cowait install --project',
    rv_setup_then: 'then restart Claude Code. Just looking? Try: cowait demo',
    rv_keys: 'y looks good +1⚡ · n tell Claude what is wrong +2⚡ · s skip · ←→ cards · ↑↓ scroll',
    rv_keys_short: 'y ok +1⚡ · n note +2⚡ · s skip · ←→ · ↑↓',
    rv_new_file: 'new file',
    rv_parts: '{n} edits',
    rv_part: '── edit {n} ──',
    kind_edit: 'edit',
    kind_write: 'write',
    kind_multiedit: 'multi-edit',
    kind_notebook: 'notebook',
    rv_ago: '{t} ago',
    rv_more: '… {n} more lines (↓ to scroll)',
    rv_note: '✎ Tell Claude: ',
    rv_note_hint: 'Enter send · Esc cancel',
    rv_queued_busy: 'Noted +{n}⚡ — Claude sees it on its very next step',
    rv_queued_idle: 'Noted +{n}⚡ — it goes along with your next message to Claude',
    rv_ok: '✓ +{n}⚡',
    rv_skim: '✓ approved · too quick to count as a review, no ⚡',
    rv_skip: 'Skipped',
    rv_skip_all_ask: 'Press S again to skip all {n} (counted as skipped, not reviewed)',
    rv_skip_all_done: 'Skipped {n} cards',
    ln_title: 'Learn',
    ln_all: 'All decks',
    ln_due: '{n} due',
    ln_new: 'new',
    ln_review: 'review',
    ln_q: 'Q',
    ln_a: 'A',
    ln_flip: 'Space to flip',
    ln_rate: '1 forgot · 2 got it · 3 easy   (all +1⚡)',
    ln_keys: 'd deck · t learn a new topic (AI) · g quiz me on what Claude just wrote (AI)',
    ln_keys_short: 'd deck · t new topic (AI) · g quiz on new code (AI)',
    ln_done: 'Nothing due in this deck right now 🎉',
    ln_done_hint: 'Press d for another deck, or t to have AI write one on any topic.',
    ln_generating: '⏳ Writing cards… keep studying meanwhile',
    ln_generated: '✓ New deck "{t}" with {n} cards — switched to it',
    ln_failed: 'Could not generate: {e}',
    ln_no_provider: 'AI decks need ANTHROPIC_API_KEY or a signed-in claude CLI',
    ln_no_changes: 'Claude has not changed any code yet',
    ln_topic: 'Topic to learn: ',
    ln_gained: '+{n}⚡',
    ln_quick: 'too quick to count, no ⚡',
    gm_title: 'Debug Dungeon',
    gm_intro: 'You are a debugger. Fight down 6 floors of bugs and fix the Stack Overflow.',
    gm_intro2: 'Turn-based, one key per action: drop it the moment Claude is done, resume next wait.',
    gm_new: 'n new run (-{c}⚡)',
    gm_shop: 's gear shop',
    gm_poor: '⚡ too low to start: review changes (+1~2⚡) or study cards (+1⚡). Review first, then play :)',
    gm_owned: 'Gear: {list}',
    gm_owned_none: 'No gear yet',
    gm_record: '{w} wins · deepest floor {f} · {r} runs',
    gm_floor: 'Floor {f}/{n}',
    gm_intent: 'Intent',
    gm_atk: 'attack {d}',
    gm_blk: 'block {a}',
    gm_myst: '?? unreadable',
    gm_rec: 'recurse (+{b} block, hits harder after)',
    gm_vuln: 'Vuln {n}',
    gm_weak: 'Weak {n}',
    gm_incoming: '⚠ ending turn costs {n} HP',
    gm_safe: '✓ fully blocked',
    gm_hand: 'Hand',
    gm_keys: 'number keys play · e end turn',
    gm_reward: 'Victory! Add a card to your deck:',
    gm_rest: '{k}  Rest: heal {n} HP',
    gm_dead: '💀 You fell on floor {f}…',
    gm_victory: '🏆 You fixed the Stack Overflow! +{e}⚡',
    gm_shop_title: 'Gear shop — bought with 💰, permanent',
    gm_shop_hint: '💰 only come from Claude’s results: +3 per working turn, +10 when tests pass. Waiting longer never pays more.',
    gm_bought: 'Got it: {n}!',
    gm_have: 'owned',
    gm_poor_coins: 'not enough 💰',
    gm_back: 'b back',
    gm_you: 'You',
    gm_block: 'Block',
    gm_observed: 'observed',
    another: 'Another Cowait panel is already running (PID {pid}). Only one at a time, or rewards would count twice.',
  },
} as const;

export type Key = keyof (typeof S)['zh'];

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = S[lang][key] ?? S.en[key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export interface HelpContent {
  intro: string;
  sections: { title: string; rows: [string, string][] }[];
}

/** The `?` overlay, as label/description rows so it can wrap neatly in a narrow pane. */
export function helpContent(lang: Lang): HelpContent {
  if (lang === 'zh')
    return {
      intro: 'Cowait 把等 Claude 干活的时间变成有用的时间。Claude 完成或需要你确认时，面板会响铃提醒。',
      sections: [
        {
          title: '三个模式（Tab 切换）',
          rows: [
            ['审阅', 'Claude 每改一个文件就生成一张卡片，连续改同一个文件会合到一张里。y 没问题，n 写一句话给 Claude，它下一步操作时就会看到，不用打断它。扫一眼就按 y 不算审过；积压太多时连按两次 S 全部跳过。'],
            ['游戏', '捉虫地牢：回合制卡牌小游戏，一次一个按键，随时能停。'],
            ['学习', '抽认卡 + 间隔重复。内置 Git / 网络 / 并发 / LLM / 系统设计；t 让 AI 出任意主题，g 用 Claude 刚写的代码出题。'],
          ],
        },
        {
          title: '随时可用',
          rows: [
            ['m', '给 Claude 留言，不用针对某张卡片。'],
            ['a', '自动选模式：有待审的先审，等得短就刷卡，等得长就玩。'],
          ],
        },
        {
          title: '两种货币',
          rows: [
            ['⚡ 能量', '你自己干活赚（审阅、刷卡），用来开游戏。先审后玩。'],
            ['💰 金币', '只看 Claude 的成果：干活的一轮 +3，测试通过再 +10，等再久也不多给。用来买永久装备。'],
          ],
        },
      ],
    };
  return {
    intro: 'Cowait turns the time you spend waiting on Claude into useful time, and rings when Claude finishes or needs you.',
    sections: [
      {
        title: 'Three modes (Tab to switch)',
        rows: [
          ['Review', 'Every file Claude changes becomes a card; repeated edits to one file share a card. y = fine, n = write Claude one line, which it sees on its next step without being interrupted. A y in the blink of an eye does not count as a review; S twice skips a whole backlog.'],
          ['Play', 'Debug Dungeon: a turn-based card game, one key per action, drop it at any moment.'],
          ['Learn', 'Flashcards with spaced repetition. Built-in Git / networking / concurrency / LLM / system-design decks; t has AI write a deck on any topic, g quizzes you on the code Claude just wrote.'],
        ],
      },
      {
        title: 'Any time',
        rows: [
          ['m', 'Send Claude a note that is not about one card.'],
          ['a', 'Auto mode: reviews first, short waits get flashcards, long waits a game.'],
        ],
      },
      {
        title: 'Two currencies',
        rows: [
          ['⚡ energy', 'Earned by you (reviewing, studying); spent to start a run. Review first, then play.'],
          ['💰 coins', 'Earned by Claude’s results only: +3 per working turn, +10 when tests pass, never by waiting longer. Spent on permanent gear.'],
        ],
      },
    ],
  };
}

export function fmtDur(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

export function fmtAgo(ms: number, lang: Lang): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return lang === 'zh' ? `${sec} 秒` : `${sec}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return lang === 'zh' ? `${m} 分钟` : `${m}m`;
  const h = Math.round(m / 60);
  return lang === 'zh' ? `${h} 小时` : `${h}h`;
}
