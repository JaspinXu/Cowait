import { describe, it, expect } from 'vitest';
import { CARDS, RELICS, chooseReward, endTurn, incoming, newRun, playCard, type Run } from '../src/game/engine.js';

/** A simple greedy player: block when the hit would hurt, otherwise attack; take the first reward card. */
function autoplay(seed: number, relics: string[]): Run {
  const run = newRun(seed, relics);
  for (let step = 0; step < 2000 && (run.phase === 'battle' || run.phase === 'reward'); step++) {
    if (run.phase === 'reward') {
      chooseReward(run, run.hp < run.maxHp * 0.4 ? run.reward!.length : 0, relics);
      continue;
    }
    const b = run.battle!;
    const threat = incoming(run) ?? 6;
    const playable = b.hand.map((id, i) => ({ id, i, c: CARDS[id] })).filter((x) => !x.c.unplayable && x.c.cost <= b.focus);
    if (!playable.length) {
      endTurn(run, relics);
      continue;
    }
    const defensive = playable.find((x) => ['bp', 'typecheck', 'defensive'].includes(x.id));
    const attack = playable.find((x) => x.c.attack || ['review', 'pair', 'coffee', 'docs', 'duck'].includes(x.id));
    const pickCard = threat > 4 && defensive ? defensive : attack ?? defensive ?? playable[0];
    playCard(run, pickCard.i, relics);
  }
  return run;
}

describe('Debug Dungeon', () => {
  it('is deterministic for a seed', () => {
    const a = autoplay(42, []);
    const b = autoplay(42, []);
    expect(a).toEqual(b);
  });

  it('is winnable but not trivial, and gear helps', () => {
    const N = 400;
    const wins = (relics: string[]) => Array.from({ length: N }, (_, i) => autoplay(1000 + i, relics)).filter((r) => r.phase === 'victory').length / N;
    const bare = wins([]);
    const geared = wins(RELICS.map((r) => r.id));
    // Printed so balance changes are visible in test output.
    console.log(`greedy-bot win rate: no gear ${(bare * 100).toFixed(1)}%, full gear ${(geared * 100).toFixed(1)}%`);
    expect(bare).toBeGreaterThan(0.15);
    expect(bare).toBeLessThan(0.7);
    expect(geared).toBeGreaterThan(bare);
  });

  it('every run ends (no softlocks)', () => {
    for (let i = 0; i < 200; i++) {
      const r = autoplay(i, []);
      expect(['dead', 'victory']).toContain(r.phase);
    }
  });

  it('Heisenbug dodges the first hit unless observed', () => {
    let run: Run | null = null;
    for (let seed = 0; seed < 5000 && !run; seed++) {
      const r = newRun(seed, []);
      // Jump to floor 2, where Heisenbugs live.
      r.floor = 2;
      r.battle = null;
      r.phase = 'reward';
      r.reward = ['hotfix', 'hotfix', 'hotfix'];
      chooseReward(r, 3, []);
      r.floor = 2;
      if (r.battle?.enemy.id === 'heisen') run = r;
    }
    expect(run).not.toBeNull();
    const b = run!.battle!;
    b.hand = ['unittest', 'log', 'unittest'];
    b.focus = 3;
    const hp0 = b.enemy.hp;
    playCard(run!, 0, []); // 3×2: first hit dodged
    expect(b.enemy.hp).toBe(hp0 - 3);
    playCard(run!, 0, []); // console.log observes: 5
    playCard(run!, 0, []); // observed: both hits land
    expect(b.enemy.hp).toBe(hp0 - 3 - 5 - 6);
  });

  it('Vulnerable and Pair Programming stack', () => {
    const run = newRun(7, []);
    const b = run.battle!;
    b.enemy.hp = 100;
    b.enemy.maxHp = 100;
    b.enemy.block = 0;
    b.hand = ['review', 'pair', 'refactor'];
    b.focus = 4;
    playCard(run, 0, []);
    playCard(run, 0, []);
    playCard(run, 0, []); // 8 × 2 × 1.5 = 24
    expect(b.enemy.hp).toBe(76);
    expect(b.double).toBe(false);
  });

  it('refuses unaffordable and unplayable cards', () => {
    const run = newRun(3, []);
    const b = run.battle!;
    b.hand = ['refactor', 'incident'];
    b.focus = 1;
    expect(playCard(run, 0, []).ok).toBe(false);
    expect(playCard(run, 1, []).ok).toBe(false);
    expect(b.hand).toHaveLength(2);
  });
});
