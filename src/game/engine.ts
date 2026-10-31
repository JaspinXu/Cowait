/**
 * Debug Dungeon (捉虫地牢) — a tiny turn-based card roguelike built for waiting:
 * every action is one keypress, nothing happens in real time, so it can be dropped
 * the instant Claude finishes and picked up again on the next wait.
 *
 * Pure logic, seeded RNG stored inside the run, fully serialisable.
 */

export type L = { zh: string; en: string };
const l = (zh: string, en: string): L => ({ zh, en });

export const FLOORS = 6;
const BASE_HP = 32;
const HAND = 4;
const FOCUS = 3;

// ---------------------------------------------------------------- cards

export type Rarity = 'starter' | 'common' | 'rare' | 'junk';

export interface CardDef {
  id: string;
  name: L;
  cost: number;
  desc: L;
  rarity: Rarity;
  attack?: boolean;
  exhaust?: boolean;
  unplayable?: boolean;
}

const card = (id: string, cost: number, rarity: Rarity, name: L, desc: L, extra: Partial<CardDef> = {}): CardDef => ({
  id,
  cost,
  rarity,
  name,
  desc,
  ...extra,
});

export const CARDS: Record<string, CardDef> = Object.fromEntries(
  [
    card('log', 1, 'starter', l('console.log', 'console.log'), l('造成 5 伤害，并观测敌人', 'Deal 5. Observe the enemy'), { attack: true }),
    card('bp', 1, 'starter', l('打断点', 'Breakpoint'), l('获得 5 格挡', 'Gain 5 block')),
    card('duck', 1, 'starter', l('小黄鸭', 'Rubber Duck'), l('回复 3 生命，抽 1 张', 'Heal 3, draw 1')),
    card('unittest', 1, 'starter', l('单元测试', 'Unit Test'), l('造成 3 伤害 ×2', 'Deal 3 twice'), { attack: true }),
    card('refactor', 2, 'starter', l('重构', 'Refactor'), l('造成 8 伤害，获得 5 格挡', 'Deal 8, gain 5 block'), { attack: true }),
    card('hotfix', 0, 'common', l('热修复', 'Hotfix'), l('造成 6 伤害。用后移除', 'Deal 6. Exhaust'), { attack: true, exhaust: true }),
    card('review', 1, 'common', l('代码审查', 'Code Review'), l('敌人易伤 2 回合（受伤 +50%），观测敌人', 'Vulnerable 2 (+50% damage taken). Observe'), {}),
    card('typecheck', 1, 'common', l('类型检查', 'Type Check'), l('获得 9 格挡', 'Gain 9 block')),
    card('docs', 1, 'common', l('查文档', 'Read the Docs'), l('抽 3 张', 'Draw 3')),
    card('lint', 1, 'common', l('静态检查', 'Lint'), l('造成 3 伤害，敌人虚弱 2 回合（伤害 -25%）', 'Deal 3. Weak 2 (enemy deals -25%)'), { attack: true }),
    card('defensive', 1, 'common', l('防御式编程', 'Defensive Coding'), l('获得 5 格挡，下回合再获得 5', 'Gain 5 block now and 5 next turn')),
    card('coffee', 0, 'common', l('续杯咖啡', 'Coffee Refill'), l('获得 2◆。用后移除', 'Gain 2◆. Exhaust'), { exhaust: true }),
    card('rmrf', 2, 'rare', l('rm -rf', 'rm -rf'), l('造成 20 伤害，自己失去 4 生命', 'Deal 20. Lose 4 HP'), { attack: true }),
    card('parallel', 2, 'rare', l('并行化', 'Parallelize'), l('造成 4 伤害 ×3', 'Deal 4 three times'), { attack: true }),
    card('pair', 1, 'rare', l('结对编程', 'Pair Programming'), l('本回合下一张攻击牌伤害翻倍', 'Your next attack this turn deals double')),
    card('bisect', 1, 'rare', l('git bisect', 'git bisect'), l('造成 4 伤害；敌人易伤时改为 12', 'Deal 4, or 12 if the enemy is Vulnerable'), { attack: true }),
    card('ship', 1, 'rare', l('周五上线', 'Ship on Friday'), l('造成 14 伤害，往弃牌堆塞一张「线上事故」', 'Deal 14. Add an Incident to your discard'), { attack: true }),
    card('revert', 1, 'rare', l('git revert', 'git revert'), l('回复 7 生命。用后移除', 'Heal 7. Exhaust'), { exhaust: true }),
    card('incident', 0, 'junk', l('线上事故', 'Incident'), l('无法打出，只会堵住你的手牌', 'Unplayable. Clogs your hand'), { unplayable: true }),
  ].map((c) => [c.id, c]),
);

export const STARTER_DECK = ['log', 'log', 'log', 'bp', 'bp', 'bp', 'unittest', 'refactor', 'duck'];
const COMMON = Object.values(CARDS).filter((c) => c.rarity === 'common').map((c) => c.id);
const RARE = Object.values(CARDS).filter((c) => c.rarity === 'rare').map((c) => c.id);

// ---------------------------------------------------------------- enemies

export interface EnemyDef {
  id: string;
  name: L;
  hp: number;
  trait: L;
  boss?: boolean;
}

export const ENEMIES: Record<string, EnemyDef> = Object.fromEntries(
  [
    { id: 'nullptr', name: l('空指针史莱姆', 'NullPointer Slime'), hp: 14, trait: l('每第 3 回合缩起来加格挡', 'Hardens every 3rd turn') },
    { id: 'offbyone', name: l('差一小鬼', 'Off-by-One Imp'), hp: 15, trait: l('总是多打一下', 'Always hits one extra time') },
    { id: 'heisen', name: l('海森堡虫', 'Heisenbug'), hp: 17, trait: l('没被观测时，每回合躲开你的第一下', 'Dodges your first hit each turn unless observed') },
    { id: 'leak', name: l('内存泄漏团', 'Memory Leak Blob'), hp: 20, trait: l('每回合变大变强', 'Grows every turn') },
    { id: 'race', name: l('竞态条件', 'Race Condition'), hp: 18, trait: l('意图不可预测', 'Intent is unpredictable') },
    { id: 'deadlock', name: l('死锁守卫', 'Deadlock Warden'), hp: 26, trait: l('一回合锁死，一回合重击', 'Locks up, then strikes hard') },
    { id: 'stackoverflow', name: l('栈溢出', 'Stack Overflow'), hp: 64, trait: l('递归越深打得越疼，每 3 回合再递归一层', 'Hits harder the deeper it recurses'), boss: true },
  ].map((e) => [e.id, e as EnemyDef]),
);

const FLOOR_POOLS: string[][] = [
  ['nullptr', 'offbyone'],
  ['offbyone', 'nullptr', 'heisen'],
  ['leak', 'heisen', 'race'],
  ['leak', 'race'],
  ['deadlock'],
  ['stackoverflow'],
];

// ---------------------------------------------------------------- relics (permanent, bought with coins)

export interface RelicDef {
  id: string;
  name: L;
  desc: L;
  price: number;
}

export const RELICS: RelicDef[] = [
  { id: 'chair', name: l('人体工学椅', 'Ergonomic Chair'), desc: l('每场战斗开局获得 6 格挡', 'Start every fight with 6 block'), price: 50 },
  { id: 'headphones', name: l('降噪耳机', 'Noise-Cancelling Headphones'), desc: l('最大生命 +8', '+8 max HP'), price: 60 },
  { id: 'espresso', name: l('意式咖啡机', 'Espresso Machine'), desc: l('每赢一场回复 4 生命', 'Heal 4 after every win'), price: 80 },
  { id: 'monitor', name: l('双显示器', 'Second Monitor'), desc: l('每场战斗第一回合 +1◆', '+1◆ on the first turn of each fight'), price: 90 },
  { id: 'keyboard', name: l('机械键盘', 'Mechanical Keyboard'), desc: l('每回合多抽 1 张', 'Draw 1 extra card each turn'), price: 150 },
];

// ---------------------------------------------------------------- state

export type Intent =
  | { kind: 'attack'; dmg: number; times: number }
  | { kind: 'block'; amt: number }
  | { kind: 'mystery' }
  | { kind: 'recurse'; block: number };

export interface EnemyState {
  id: string;
  hp: number;
  maxHp: number;
  block: number;
  vuln: number;
  weak: number;
  depth: number;
  turn: number;
  intent: Intent;
}

export interface Battle {
  enemy: EnemyState;
  draw: string[];
  hand: string[];
  discard: string[];
  exhausted: string[];
  focus: number;
  block: number;
  blockNext: number;
  double: boolean;
  observed: boolean;
  missed: boolean;
  turn: number;
}

export type Phase = 'battle' | 'reward' | 'dead' | 'victory';

export interface Run {
  seed: number;
  rng: number;
  floor: number;
  hp: number;
  maxHp: number;
  deck: string[];
  phase: Phase;
  battle: Battle | null;
  reward: string[] | null;
  log: L[];
  kills: number;
}

// ---------------------------------------------------------------- helpers

/** mulberry32, with its state kept in the run so saves replay identically. */
function rand(run: Run): number {
  run.rng = (run.rng + 0x6d2b79f5) >>> 0;
  let t = run.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(run: Run, xs: T[]): T {
  return xs[Math.floor(rand(run) * xs.length)];
}

function shuffle<T>(run: Run, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(run) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function say(run: Run, msg: L): void {
  run.log.push(msg);
  if (run.log.length > 5) run.log = run.log.slice(-5);
}

const has = (relics: string[], id: string) => relics.includes(id);

// ---------------------------------------------------------------- flow

export function newRun(seed: number, relics: string[]): Run {
  const maxHp = BASE_HP + (has(relics, 'headphones') ? 8 : 0);
  const run: Run = {
    seed,
    rng: seed >>> 0,
    floor: 1,
    hp: maxHp,
    maxHp,
    deck: [...STARTER_DECK],
    phase: 'battle',
    battle: null,
    reward: null,
    log: [],
    kills: 0,
  };
  startBattle(run, relics);
  return run;
}

function attackBonus(run: Run, def: EnemyDef): number {
  return def.boss ? 0 : run.floor - 1;
}

function computeIntent(run: Run, e: EnemyState): Intent {
  const def = ENEMIES[e.id];
  const bonus = attackBonus(run, def);
  const t = e.turn;
  switch (e.id) {
    case 'nullptr':
      return t % 3 === 0 ? { kind: 'block', amt: 6 } : { kind: 'attack', dmg: 5 + bonus, times: 1 };
    case 'offbyone':
      return { kind: 'attack', dmg: 2 + bonus, times: t % 2 === 1 ? 3 : 2 };
    case 'leak':
      return { kind: 'attack', dmg: 3 + t + bonus, times: 1 };
    case 'heisen':
      return { kind: 'attack', dmg: 6 + bonus, times: 1 };
    case 'race':
      return { kind: 'mystery' };
    case 'deadlock':
      return t % 2 === 1 ? { kind: 'block', amt: 10 } : { kind: 'attack', dmg: 11 + bonus, times: 1 };
    case 'stackoverflow':
      return t % 3 === 0 ? { kind: 'recurse', block: 12 } : { kind: 'attack', dmg: 5 + e.depth, times: 1 };
    default:
      return { kind: 'attack', dmg: 5, times: 1 };
  }
}

export function startBattle(run: Run, relics: string[]): void {
  const id = pick(run, FLOOR_POOLS[Math.min(run.floor, FLOORS) - 1]);
  const def = ENEMIES[id];
  const hp = def.boss ? def.hp : Math.round(def.hp * (1 + 0.15 * (run.floor - 1)));
  const enemy: EnemyState = { id, hp, maxHp: hp, block: 0, vuln: 0, weak: 0, depth: 0, turn: 1, intent: { kind: 'mystery' } };
  enemy.intent = computeIntent(run, enemy);
  run.battle = {
    enemy,
    draw: shuffle(run, run.deck),
    hand: [],
    discard: [],
    exhausted: [],
    focus: 0,
    block: 0,
    blockNext: 0,
    double: false,
    observed: false,
    missed: false,
    turn: 0,
  };
  run.phase = 'battle';
  run.reward = null;
  say(run, l(`第 ${run.floor} 层：${def.name.zh} 出现了！`, `Floor ${run.floor}: a wild ${def.name.en} appears!`));
  startPlayerTurn(run, relics);
}

function drawCards(run: Run, n: number): void {
  const b = run.battle!;
  for (let i = 0; i < n && b.hand.length < 8; i++) {
    if (b.draw.length === 0) {
      if (b.discard.length === 0) break;
      b.draw = shuffle(run, b.discard);
      b.discard = [];
    }
    b.hand.push(b.draw.pop()!);
  }
}

function startPlayerTurn(run: Run, relics: string[]): void {
  const b = run.battle!;
  b.turn++;
  b.block = b.blockNext + (b.turn === 1 && has(relics, 'chair') ? 6 : 0);
  b.blockNext = 0;
  b.focus = FOCUS + (b.turn === 1 && has(relics, 'monitor') ? 1 : 0);
  b.observed = false;
  b.missed = false;
  b.double = false;
  drawCards(run, HAND + (has(relics, 'keyboard') ? 1 : 0));
}

function hitEnemy(run: Run, base: number, times: number): void {
  const b = run.battle!;
  const e = b.enemy;
  const mult = b.double ? 2 : 1;
  b.double = false;
  let dealt = 0;
  for (let i = 0; i < times && e.hp > 0; i++) {
    if (e.id === 'heisen' && !b.observed && !b.missed) {
      b.missed = true;
      say(run, l('海森堡虫在你没盯着它时躲开了！', 'The Heisenbug dodged — you were not observing it!'));
      continue;
    }
    let dmg = base * mult;
    if (e.vuln > 0) dmg = Math.floor(dmg * 1.5);
    const absorbed = Math.min(e.block, dmg);
    e.block -= absorbed;
    e.hp = Math.max(0, e.hp - (dmg - absorbed));
    dealt += dmg - absorbed;
  }
  if (dealt > 0) say(run, l(`造成 ${dealt} 伤害`, `Dealt ${dealt} damage`));
}

function heal(run: Run, n: number): void {
  run.hp = Math.min(run.maxHp, run.hp + n);
}

export type PlayResult = { ok: true } | { ok: false; reason: L };

export function playCard(run: Run, handIndex: number, relics: string[]): PlayResult {
  if (run.phase !== 'battle' || !run.battle) return { ok: false, reason: l('现在不在战斗中', 'Not in a fight') };
  const b = run.battle;
  const id = b.hand[handIndex];
  if (!id) return { ok: false, reason: l('没有这张牌', 'No such card') };
  const c = CARDS[id];
  if (c.unplayable) return { ok: false, reason: l('这张牌无法打出', 'This card cannot be played') };
  if (c.cost > b.focus) return { ok: false, reason: l('专注◆不够了，按 e 结束回合', 'Not enough focus ◆ — press e to end turn') };
  b.focus -= c.cost;
  b.hand.splice(handIndex, 1);
  const e = b.enemy;

  switch (id) {
    case 'log':
      b.observed = true;
      hitEnemy(run, 5, 1);
      break;
    case 'bp':
      b.block += 5;
      break;
    case 'duck':
      heal(run, 3);
      drawCards(run, 1);
      say(run, l('你对着小黄鸭讲了一遍，思路清晰了', 'You explained it to the duck. Clarity!'));
      break;
    case 'unittest':
      hitEnemy(run, 3, 2);
      break;
    case 'refactor':
      hitEnemy(run, 8, 1);
      b.block += 5;
      break;
    case 'hotfix':
      hitEnemy(run, 6, 1);
      break;
    case 'review':
      e.vuln += 2;
      b.observed = true;
      say(run, l('代码审查发现了弱点：敌人易伤', 'Review found a weakness: enemy is Vulnerable'));
      break;
    case 'typecheck':
      b.block += 9;
      break;
    case 'docs':
      drawCards(run, 3);
      break;
    case 'lint':
      hitEnemy(run, 3, 1);
      e.weak += 2;
      break;
    case 'defensive':
      b.block += 5;
      b.blockNext += 5;
      break;
    case 'coffee':
      b.focus += 2;
      break;
    case 'rmrf':
      hitEnemy(run, 20, 1);
      run.hp = Math.max(1, run.hp - 4);
      break;
    case 'parallel':
      hitEnemy(run, 4, 3);
      break;
    case 'pair':
      b.double = true;
      say(run, l('结对中：下一张攻击牌伤害翻倍', 'Pairing: next attack deals double'));
      break;
    case 'bisect':
      hitEnemy(run, e.vuln > 0 ? 12 : 4, 1);
      break;
    case 'ship':
      hitEnemy(run, 14, 1);
      b.discard.push('incident');
      say(run, l('上线成功……顺便带来了一起线上事故', 'Shipped! …and caused an incident'));
      break;
    case 'revert':
      heal(run, 7);
      break;
  }

  // A pair-programming buff only waits for the next *attack* card.
  if (c.attack && id !== 'pair') b.double = false;
  (c.exhaust ? b.exhausted : b.discard).push(id);

  if (e.hp <= 0) winBattle(run, relics);
  return { ok: true };
}

function winBattle(run: Run, relics: string[]): void {
  const def = ENEMIES[run.battle!.enemy.id];
  run.kills++;
  if (has(relics, 'espresso')) heal(run, 4);
  run.battle = null;
  say(run, l(`击败了${def.name.zh}！`, `Squashed the ${def.name.en}!`));
  if (run.floor >= FLOORS) {
    run.phase = 'victory';
    return;
  }
  run.phase = 'reward';
  const options = new Set<string>();
  while (options.size < 3) {
    options.add(rand(run) < 0.3 ? pick(run, RARE) : pick(run, COMMON));
  }
  run.reward = [...options];
}

export const REST_HEAL = 10;

/** Pick reward 0..2 (add a card) or 3 (rest), then go one floor deeper. */
export function chooseReward(run: Run, choice: number, relics: string[]): boolean {
  if (run.phase !== 'reward' || !run.reward) return false;
  if (choice >= 0 && choice < run.reward.length) run.deck.push(run.reward[choice]);
  else if (choice === run.reward.length) heal(run, REST_HEAL);
  else return false;
  run.floor++;
  startBattle(run, relics);
  return true;
}

function hitPlayer(run: Run, dmg: number): number {
  const b = run.battle!;
  if (b.enemy.weak > 0) dmg = Math.floor(dmg * 0.75);
  const absorbed = Math.min(b.block, dmg);
  b.block -= absorbed;
  const lost = dmg - absorbed;
  run.hp = Math.max(0, run.hp - lost);
  return lost;
}

export function endTurn(run: Run, relics: string[]): void {
  if (run.phase !== 'battle' || !run.battle) return;
  const b = run.battle;
  const e = b.enemy;
  b.discard.push(...b.hand);
  b.hand = [];

  e.block = 0;
  let intent = e.intent;
  if (intent.kind === 'mystery') {
    const bonus = attackBonus(run, ENEMIES[e.id]);
    intent = rand(run) < 0.5 ? { kind: 'attack', dmg: 10 + bonus, times: 1 } : { kind: 'attack', dmg: 3 + bonus, times: 3 };
  }
  const name = ENEMIES[e.id].name;
  if (intent.kind === 'attack') {
    let lost = 0;
    for (let i = 0; i < intent.times && run.hp > 0; i++) lost += hitPlayer(run, intent.dmg);
    say(run, l(`${name.zh} 攻击，你失去 ${lost} 生命`, `${name.en} attacks: you lose ${lost} HP`));
    if (e.id === 'stackoverflow') e.depth += 1;
  } else if (intent.kind === 'block') {
    e.block += intent.amt;
    say(run, l(`${name.zh} 获得 ${intent.amt} 格挡`, `${name.en} gains ${intent.amt} block`));
  } else if (intent.kind === 'recurse') {
    e.block += intent.block;
    e.depth += 2;
    say(run, l('栈溢出又递归了一层！', 'Stack Overflow recurses deeper!'));
  }
  if (e.id === 'leak') {
    e.maxHp += 2;
    e.hp += 2;
  }
  if (e.vuln > 0) e.vuln--;
  if (e.weak > 0) e.weak--;

  if (run.hp <= 0) {
    run.phase = 'dead';
    run.battle = null;
    say(run, l('你被 Bug 击倒了……', 'The bugs got you…'));
    return;
  }
  e.turn++;
  e.intent = computeIntent(run, e);
  startPlayerTurn(run, relics);
}

/** Damage the player would take from the current intent, after block and Weak (for the UI). */
export function incoming(run: Run): number | null {
  const b = run.battle;
  if (!b) return null;
  const it = b.enemy.intent;
  if (it.kind !== 'attack') return it.kind === 'mystery' ? null : 0;
  const per = b.enemy.weak > 0 ? Math.floor(it.dmg * 0.75) : it.dmg;
  return Math.max(0, per * it.times - b.block);
}
