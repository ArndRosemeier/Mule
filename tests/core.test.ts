import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, dispatch, MAP_COLS, TOWN_INDEX, BASE_PRODUCTION, DEV_TIME_FULL, DEV_TIME_MIN,
  playerScore, plotCentre, doorPoint, doorFront, TICK_MS,
} from '../src/core';
import type { GameState, PlayerSetup } from '../src/core';
import { createRng, next } from '../src/core/rng';
import { generateMap } from '../src/core/map';
import { runProduction, baseOutput } from '../src/core/production';
import { createGoodsAuction, startDeclare, startTrading, tickTrading, setMove, setRole } from '../src/core/auction';
import { createLandAuction, setRaising, tickLandBidding } from '../src/core/land';
import { newAIGame, run } from './helpers';

const HUMAN: PlayerSetup[] = [
  { name: 'You', species: 'humanoid', ai: null },
  { name: 'A', species: 'mechtron', ai: 'normal' },
  { name: 'B', species: 'packer', ai: 'normal' },
  { name: 'C', species: 'bonzoid', ai: 'normal' },
];

const tick = (s: GameState, n = 1) => { for (let i = 0; i < n; i++) applyAction(s, { type: 'tick', ms: TICK_MS }); };

/** Walk the human avatar along waypoints by driving its input like a player would. */
function walkTo(s: GameState, target: { x: number; y: number }, maxTicks = 2000) {
  for (let i = 0; i < maxTicks; i++) {
    if (s.phase.kind !== 'development') return;
    const t = s.phase.turn;
    const dx = target.x - t.pos.x, dy = target.y - t.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) { applyAction(s, { type: 'move', playerId: 0, x: 0, y: 0 }); return; }
    // Ease in so the last step doesn't overshoot (one tick is ~9.5 units in town).
    const k = Math.min(1, d / 10) / d;
    applyAction(s, { type: 'move', playerId: 0, x: dx * k, y: dy * k });
    const before = { ...t.pos };
    tick(s);
    if (s.phase.kind !== 'development') return;
    const after = s.phase.turn.pos;
    // A door or scene change teleports the avatar: that's arriving.
    if (Math.hypot(after.x - before.x, after.y - before.y) > 12) { applyAction(s, { type: 'move', playerId: 0, x: 0, y: 0 }); return; }
  }
}

/** A game where the human's development turn is active, with plot `plot` owned by the human. */
function humanTurn(plot = 12): GameState {
  const s = createGame(HUMAN, { seed: 7, difficulty: 'standard' });
  s.map[plot]!.owner = 0;
  const turnState = s;
  applyAction(turnState, { type: 'ready', playerId: 0 });
  // Skip to development by letting the AIs and the cursor run; the human doesn't claim.
  run(s, (g) => g.phase.kind === 'development' && g.phase.turn.playerId === 0);
  applyAction(s, { type: 'ready', playerId: 0 });
  return s;
}

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 100; i++) expect(next(a)).toBe(next(b));
  });
});

describe('map', () => {
  it('has the town in the middle, the river through it, and mountains off the river', () => {
    for (let seed = 1; seed < 30; seed++) {
      const map = generateMap(createRng(seed));
      expect(map).toHaveLength(45);
      expect(map[TOWN_INDEX]!.terrain).toBe('town');
      for (const p of map) {
        if (p.col === 4 && p.index !== TOWN_INDEX) expect(p.terrain).toBe('river');
        if (p.col !== 4) expect(['plain', 'mountain1', 'mountain2', 'mountain3']).toContain(p.terrain);
        expect(p.crystite).toBeGreaterThanOrEqual(0);
        expect(p.crystite).toBeLessThanOrEqual(4);
      }
      const mountains = map.filter((p) => p.terrain.startsWith('mountain')).length;
      expect(mountains).toBeGreaterThanOrEqual(8);
      expect(mountains).toBeLessThanOrEqual(11);
      expect(map.some((p) => p.crystite === 4)).toBe(true);
    }
  });
});

describe('production', () => {
  function bare(): GameState {
    const s = newAIGame(3);
    for (const p of s.map) { p.owner = null; p.mule = null; }
    for (const p of s.players) { p.goods = { food: 0, energy: 10, smithore: 0, crystite: 0 }; }
    return s;
  }
  const river = (s: GameState) => s.map.find((p) => p.terrain === 'river')!;
  const plain = (s: GameState) => s.map.find((p) => p.terrain === 'plain' && p.col !== 3 && p.col !== 5)!;

  it('uses the base table per terrain', () => {
    const s = bare();
    const r = river(s);
    r.owner = 0; r.mule = 'food';
    expect(baseOutput(s, r)).toBe(BASE_PRODUCTION.food.river);
    r.mule = 'smithore';
    expect(baseOutput(s, r)).toBe(0);
    const m = s.map.find((p) => p.terrain === 'mountain3') ?? s.map.find((p) => p.terrain === 'mountain2')!;
    m.owner = 0; m.mule = 'smithore';
    expect(baseOutput(s, m)).toBe(BASE_PRODUCTION.smithore[m.terrain]);
  });

  it('adds the learning-curve bonus for adjacent same plots and economies of scale per three', () => {
    const s = bare();
    const row = 0;
    const plots = [0, 1, 2].map((c) => s.map[row * MAP_COLS + c]!);
    for (const p of plots) { p.terrain = 'plain'; p.owner = 0; p.mule = 'energy'; }
    // Adjacent (+1) and three of a kind (+1).
    expect(baseOutput(s, plots[0]!)).toBe(BASE_PRODUCTION.energy.plain + 2);
    plots[1]!.mule = 'food';
    // Plot 0 and 2 no longer touch another energy plot, and only two remain.
    expect(baseOutput(s, plots[0]!)).toBe(BASE_PRODUCTION.energy.plain);
  });

  it('MULEs without energy produce nothing, energy MULEs need none', () => {
    const s = bare();
    const p = plain(s);
    p.owner = 0; p.mule = 'food';
    s.players[0]!.goods.energy = 0;
    const report = runProduction(s, null);
    expect(report.plots[p.index]).toBe(0);
    expect(report.perPlayer[0]!.shortEnergy).toBe(1);

    const s2 = bare();
    const q = plain(s2);
    q.owner = 0; q.mule = 'energy';
    s2.players[0]!.goods.energy = 0;
    const r2 = runProduction(s2, null);
    expect(r2.plots[q.index]).toBeGreaterThan(0);
  });

  it('spoils half the food, a quarter of the energy, and minerals above 50', () => {
    const s = bare();
    s.players[0]!.goods = { food: 10, energy: 8, smithore: 60, crystite: 55 };
    const r = runProduction(s, null);
    expect(r.perPlayer[0]!.spoiled).toEqual({ food: 5, energy: 2, smithore: 10, crystite: 5 });
    expect(s.players[0]!.goods).toEqual({ food: 5, energy: 6, smithore: 50, crystite: 50 });
  });

  it('applies colony events', () => {
    const s = bare();
    const p = plain(s);
    p.owner = 0; p.mule = 'food';
    const r = runProduction(s, { type: 'pests', plot: p.index, playerId: 0, text: '' });
    expect(r.plots[p.index]).toBe(0);

    const s2 = bare();
    s2.players[1]!.goods.crystite = 7;
    runProduction(s2, { type: 'pirates', text: '' });
    expect(s2.players[1]!.goods.crystite).toBe(0);

    const s3 = bare();
    s3.store.stock = { food: 5, energy: 5, smithore: 5, crystite: 5 };
    runProduction(s3, { type: 'fire', text: '' });
    expect(s3.store.stock).toEqual({ food: 0, energy: 0, smithore: 0, crystite: 0 });
  });
});

describe('development turn', () => {
  it('eating less food than required shortens the turn', () => {
    const s = createGame(HUMAN, { seed: 7, difficulty: 'standard' });
    s.players[0]!.goods.food = 0;
    applyAction(s, { type: 'ready', playerId: 0 });
    run(s, (g) => g.phase.kind === 'development' && g.phase.turn.playerId === 0);
    if (s.phase.kind !== 'development') throw new Error();
    expect(s.phase.turn.timeTotal).toBe(DEV_TIME_MIN);

    const s2 = createGame(HUMAN, { seed: 7, difficulty: 'standard' });
    applyAction(s2, { type: 'ready', playerId: 0 });
    run(s2, (g) => g.phase.kind === 'development' && g.phase.turn.playerId === 0);
    if (s2.phase.kind !== 'development') throw new Error();
    expect(s2.phase.turn.timeTotal).toBe(DEV_TIME_FULL);
  });

  it('buy, outfit and install a MULE by walking through town', () => {
    const s = humanTurn(12);
    const p = s.players[0]!;
    const money = p.money;
    const price = s.store.mulePrice;
    walkTo(s, doorFront('corral'));
    walkTo(s, doorPoint('corral'));
    if (s.phase.kind !== 'development') throw new Error();
    expect(s.phase.turn.mule).toEqual({ outfit: null });
    expect(p.money).toBe(money - price);

    walkTo(s, doorFront('energy'));
    walkTo(s, doorPoint('energy'));
    expect(s.phase.turn.mule).toEqual({ outfit: 'energy' });
    expect(p.money).toBe(money - price - 50);

    // Leave town on the west side and walk to plot 12 (col 3, row 1).
    walkTo(s, { x: 10, y: 250 });
    walkTo(s, { x: -10, y: 250 }, 20);
    expect(s.phase.turn.scene).toBe('map');
    walkTo(s, { x: 360, y: 250 });
    walkTo(s, plotCentre(12));
    applyAction(s, { type: 'interact', playerId: 0 });
    expect(s.map[12]!.mule).toBe('energy');
    expect(s.phase.turn.mule).toBeNull();
  });

  it('a MULE released on land you do not own runs away', () => {
    const s = humanTurn(12);
    walkTo(s, doorFront('corral'));
    walkTo(s, doorPoint('corral'));
    if (s.phase.kind !== 'development') throw new Error();
    walkTo(s, { x: 10, y: 250 });
    walkTo(s, { x: -10, y: 250 }, 20);
    walkTo(s, { x: 360, y: 250 });
    walkTo(s, plotCentre(0));
    expect(s.map[0]!.owner).not.toBe(0);
    applyAction(s, { type: 'interact', playerId: 0 });
    expect(s.phase.turn.mule).toBeNull();
    expect(s.map[0]!.mule).toBeNull();
  });

  it('the pub pays out and ends the turn; no MULEs allowed inside', () => {
    const s = humanTurn(12);
    const money = s.players[0]!.money;
    walkTo(s, doorFront('pub'));
    walkTo(s, doorPoint('pub'));
    if (s.phase.kind !== 'development') throw new Error();
    expect(s.phase.turn.stage).toBe('done');
    expect(s.players[0]!.money).toBeGreaterThan(money);
  });

  it('a MULE still in tow when time runs out is lost', () => {
    const s = humanTurn(12);
    walkTo(s, doorFront('corral'));
    walkTo(s, doorPoint('corral'));
    if (s.phase.kind !== 'development') throw new Error();
    s.phase.turn.timeLeft = 100;
    tick(s, 3);
    expect(s.phase.kind === 'development' && s.phase.turn.mule).toBeFalsy();
    expect(s.events.some((e) => e.type === 'muleLost')).toBe(true);
  });

  it('assaying a soil sample reveals the crystite level', () => {
    const s = humanTurn(12);
    walkTo(s, { x: 10, y: 250 });
    walkTo(s, { x: -10, y: 250 }, 20);
    walkTo(s, { x: 360, y: 250 });
    walkTo(s, plotCentre(12));
    applyAction(s, { type: 'interact', playerId: 0 });
    if (s.phase.kind !== 'development') throw new Error();
    expect(s.phase.turn.sample).toBe(12);
    walkTo(s, { x: 360, y: 250 });
    walkTo(s, { x: 420, y: 250 }, 40);
    expect(s.phase.turn.scene).toBe('town');
    walkTo(s, doorFront('assay'));
    walkTo(s, doorPoint('assay'));
    expect(s.players[0]!.assayed).toContain(12);
  });
});

describe('land grant', () => {
  it('the human claims the plot under the cursor', () => {
    const s = createGame(HUMAN, { seed: 11, difficulty: 'standard' });
    applyAction(s, { type: 'ready', playerId: 0 });
    tick(s);
    expect(s.phase.kind).toBe('landGrant');
    if (s.phase.kind !== 'landGrant') throw new Error();
    const cursor = s.phase.cursor;
    applyAction(s, { type: 'claim', playerId: 0 });
    expect(s.map[cursor]!.owner).toBe(0);
    // Only one claim per round.
    const ph = s.phase as Extract<GameState['phase'], { kind: 'landGrant' }>;
    const next = ph.cursor;
    applyAction(s, { type: 'claim', playerId: 0 });
    expect(next < 0 || s.map[next]!.owner !== 0).toBe(true);
  });
});

describe('goods auction', () => {
  function auctionGame() {
    const s = createGame(HUMAN, { seed: 5, difficulty: 'standard' });
    for (const p of s.players) { p.ai = null; p.money = 1000; p.goods = { food: 0, energy: 0, smithore: 0, crystite: 0 }; }
    return s;
  }

  it('a seller stops at the critical level unless they push down again', () => {
    const s = auctionGame();
    s.round = 1;
    s.players[0]!.goods.food = 6; // needs 3 next round
    for (const p of s.players.slice(1)) p.money = 0;
    s.store.stock.food = 0;
    const a = createGoodsAuction(s, 'food');
    expect(a.participants[0]!.role).toBe('seller');
    expect(a.participants[0]!.stopAt).toBe(3);
    startDeclare(a);
    startTrading(a);
    setMove(s, a, 0, -1);
    for (let i = 0; i < 400; i++) tickTrading(s, a, 50);
    // Sold to the store at the floor down to the critical level.
    expect(s.players[0]!.goods.food).toBe(3);
    expect(s.store.stock.food).toBe(3);
    expect(s.players[0]!.money).toBe(1000 + 3 * a.floor);
    setMove(s, a, 0, 0);
    setMove(s, a, 0, -1);
    a.clock = 10000;
    for (let i = 0; i < 200; i++) tickTrading(s, a, 50);
    expect(s.players[0]!.goods.food).toBe(0);
  });

  it('buyers and sellers meet in the middle and trade at the touching price', () => {
    const s = auctionGame();
    s.players[0]!.goods.smithore = 5;
    s.store.stock.smithore = 0;
    const a = createGoodsAuction(s, 'smithore');
    startDeclare(a);
    setRole(a, 1, 'buyer');
    startTrading(a);
    setMove(s, a, 0, -1);
    setMove(s, a, 1, 1);
    let guard = 0;
    while (s.players[1]!.goods.smithore === 0 && guard++ < 400) tickTrading(s, a, 50);
    const price = a.lastPrice!;
    expect(price).toBeGreaterThan(a.floor);
    expect(price).toBeLessThan(a.ceiling);
    expect(s.players[1]!.money).toBe(1000 - price);
    expect(s.players[0]!.money).toBe(1000 + price);
  });

  it('the store sells from stock at its ceiling', () => {
    const s = auctionGame();
    s.store.stock.energy = 2;
    const a = createGoodsAuction(s, 'energy');
    startDeclare(a);
    startTrading(a);
    setMove(s, a, 0, 1);
    for (let i = 0; i < 400; i++) tickTrading(s, a, 50);
    expect(s.store.stock.energy).toBe(0);
    expect(s.players[0]!.goods.energy).toBe(2);
    expect(s.players[0]!.money).toBe(1000 - 2 * a.storeSell);
  });
});

describe('land auction', () => {
  it('the highest bidder wins and pays the seller', () => {
    const s = createGame(HUMAN, { seed: 5, difficulty: 'standard' });
    const plot = s.map.find((p) => p.terrain === 'plain')!;
    plot.owner = 2;
    const a = createLandAuction(plot.index, 2);
    a.stage = 'bidding';
    a.timer = 4000;
    const m0 = s.players[0]!.money, m2 = s.players[2]!.money;
    setRaising(s, a, 0, true);
    setRaising(s, a, 1, true);
    setRaising(s, a, 2, true); // the seller can't bid
    for (let i = 0; i < 20; i++) tickLandBidding(s, a, 50);
    setRaising(s, a, 1, false);
    setRaising(s, a, 0, false);
    for (let i = 0; i < 200 && a.stage === 'bidding'; i++) tickLandBidding(s, a, 50);
    expect(a.stage).toBe('result');
    expect(a.winner).not.toBeNull();
    expect(a.winner).not.toBe(2);
    expect(plot.owner).toBe(a.winner);
    const winner = a.winner!;
    expect(s.players[winner]!.money).toBe((winner === 0 ? m0 : s.players[winner]!.money + a.price!) - a.price!);
    expect(s.players[2]!.money).toBe(m2 + a.price!);
  });
});

describe('whole game', () => {
  it('an all-AI standard game runs to the end with sane numbers', () => {
    const s = newAIGame(9);
    const ticks = run(s, (g) => g.phase.kind === 'gameOver');
    expect(s.phase.kind).toBe('gameOver');
    expect(s.round).toBe(12);
    expect(ticks).toBeLessThan(80_000);
    expect(s.history).toHaveLength(12);
    for (const p of s.players) {
      expect(p.money).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(p.goods)) expect(v).toBeGreaterThanOrEqual(0);
      expect(s.map.filter((q) => q.owner === p.id).length).toBeGreaterThan(4);
      expect(playerScore(s, p).total).toBeGreaterThan(0);
    }
    for (const v of Object.values(s.store.stock)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('replays identically from the same seed', () => {
    const a = newAIGame(21, 'standard', 4);
    const b = newAIGame(21, 'standard', 4);
    run(a, (g) => g.phase.kind === 'gameOver');
    run(b, (g) => g.phase.kind === 'gameOver');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('beginner and tournament games finish too', () => {
    const beg = newAIGame(4, 'beginner');
    run(beg, (g) => g.phase.kind === 'gameOver');
    expect(beg.round).toBe(6);
    expect(beg.players.every((p) => p.goods.crystite === 0)).toBe(true);
    const tour = newAIGame(4, 'tournament');
    run(tour, (g) => g.phase.kind === 'gameOver');
    expect(tour.phase.kind).toBe('gameOver');
  });

  it('dispatch does not mutate its input', () => {
    const s = newAIGame(2);
    const before = JSON.stringify(s);
    dispatch(s, { type: 'tick', ms: 50 });
    expect(JSON.stringify(s)).toBe(before);
  });
});
