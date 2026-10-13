/**
 * Computer colonists. They live inside the deterministic core: every tick the
 * reducer asks them what to do and applies it exactly like human input, so
 * games replay identically and multiplayer clients agree.
 */
import { BASE_PRODUCTION, LAND_GRANT_STEP_MS, OUTFIT_COST, PRICE_SPREAD, RESOURCES, AUCTION_TRADE_MS, SCENE_W, foodRequired } from './constants';
import { energyNeeded } from './economy';
import { sellable } from './auction';
import { neighbours } from './map';
import { interact, plotAt, plotCentre, endTurn } from './development';
import { hash01 } from './state';
import { STREET_MID, TOWN_RECT, doorFront, doorPoint } from './town';
import type { DevTurn, DoorKind, GameState, GoodsAuction, LandAuction, Phase, Player, Plot, Resource, Vec } from './types';

type Level = NonNullable<Player['ai']>;

/** What the AI believes a plot's crystite level to be. */
function knownCrystite(state: GameState, p: Player, plot: Plot): number {
  if (p.assayed.includes(plot.index)) return plot.crystite;
  if (p.ai === 'hard') return plot.crystite;
  if (p.ai === 'normal') return hash01(state.config.seed, p.id, plot.index) < 0.5 ? plot.crystite : 1;
  return 0;
}

function resources(state: GameState): Resource[] {
  return state.config.difficulty === 'beginner' ? RESOURCES.filter((r) => r !== 'crystite') : [...RESOURCES];
}

/** Expected units a MULE of type `r` would make on `plot` for player `p`. */
export function expectedOutput(state: GameState, p: Player, plot: Plot, r: Resource): number {
  if (plot.terrain === 'town') return 0;
  const base = r === 'crystite' ? knownCrystite(state, p, plot) : BASE_PRODUCTION[r][plot.terrain];
  if (base <= 0) return 0;
  const adj = neighbours(plot.index).some((i) => state.map[i]!.owner === p.id && state.map[i]!.mule === r) ? 1 : 0;
  const same = state.map.filter((q) => q.owner === p.id && q.mule === r).length + 1;
  return base + adj + Math.floor(same / 3);
}

/** How much the player wants more of each resource, as a price multiplier. */
function needs(state: GameState, p: Player): Record<Resource, number> {
  const own = state.map.filter((q) => q.owner === p.id && q.mule);
  const prod = (r: Resource) => own.filter((q) => q.mule === r).reduce((a, q) => a + expectedOutput(state, p, q, r) - 0.5, 0);
  const foodNeed = foodRequired(state.round + 1);
  const energyNeed = energyNeeded(state, p.id) + 1;
  return {
    food: prod('food') < foodNeed ? 3 : 0.7,
    energy: prod('energy') < energyNeed ? 2.2 : 0.8,
    smithore: 1,
    crystite: 1,
  };
}

function priceGuess(state: GameState, r: Resource): number {
  return state.store.buy[r] + PRICE_SPREAD[r] / 2;
}

export function bestUse(state: GameState, p: Player, plot: Plot): { resource: Resource; value: number } {
  const need = needs(state, p);
  let best: { resource: Resource; value: number } = { resource: 'food', value: -1 };
  for (const r of resources(state)) {
    const v = expectedOutput(state, p, plot, r) * priceGuess(state, r) * need[r];
    if (v > best.value) best = { resource: r, value: v };
  }
  return best;
}

export function plotValue(state: GameState, p: Player, plot: Plot): number {
  const near = neighbours(plot.index).filter((i) => state.map[i]!.owner === p.id).length;
  return bestUse(state, p, plot).value + near * 6;
}

const REACTION: Record<Level, number> = { easy: 450, normal: 300, hard: 180 };
const PICKINESS: Record<Level, number> = { easy: 4, normal: 2, hard: 1 };

/** Land grant: which AI players claim the plot under the cursor right now. */
export function aiLandGrant(state: GameState, phase: Extract<Phase, { kind: 'landGrant' }>): number[] {
  const out: number[] = [];
  if (phase.done || phase.cursor < 0) return out;
  const dwell = LAND_GRANT_STEP_MS - phase.timer;
  const here = state.map[phase.cursor]!;
  const ahead = state.map.filter((q) => q.index >= phase.cursor && q.owner === null && q.terrain !== 'town');
  for (const p of state.players) {
    if (!p.ai || phase.claims[p.id] !== null) continue;
    if (dwell < REACTION[p.ai]) continue;
    const mine = plotValue(state, p, here) * (0.85 + 0.3 * hash01(state.config.seed, state.round, p.id, here.index));
    const better = ahead.filter((q) => q !== here && plotValue(state, p, q) > mine).length;
    const unclaimed = state.players.filter((q) => phase.claims[q.id] === null).length;
    if (better < PICKINESS[p.ai] || ahead.length <= unclaimed) out.push(p.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Development turn

interface DevPlan {
  key: string;
  /** Where to walk, in the scene the avatar is in now. */
  path: Vec[];
  /** Call interact when the path is done. */
  act?: boolean;
  end?: boolean;
}

function emptyPlots(state: GameState, p: Player): Plot[] {
  return state.map.filter((q) => q.owner === p.id && !q.mule);
}

function chooseTarget(state: GameState, p: Player, money: number): { plot: Plot; resource: Resource } | null {
  let best: { plot: Plot; resource: Resource; value: number } | null = null;
  for (const plot of emptyPlots(state, p)) {
    const need = needs(state, p);
    for (const r of resources(state)) {
      if (OUTFIT_COST[r] > money) continue;
      const v = expectedOutput(state, p, plot, r) * priceGuess(state, r) * need[r];
      if (v > 0 && (!best || v > best.value)) best = { plot, resource: r, value: v };
    }
  }
  return best ? { plot: best.plot, resource: best.resource } : null;
}

function segmentHitsTown(a: Vec, b: Vec): boolean {
  const pad = 2;
  const r = { x0: TOWN_RECT.x - pad, x1: TOWN_RECT.x + TOWN_RECT.w + pad, y0: TOWN_RECT.y - pad, y1: TOWN_RECT.y + TOWN_RECT.h + pad };
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  }
  return false;
}

/** Map path from `from` to `to` that walks around the town. */
export function mapPath(from: Vec, to: Vec): Vec[] {
  if (!segmentHitsTown(from, to)) return [to];
  const m = 8;
  const corners = [
    { x: TOWN_RECT.x - m, y: TOWN_RECT.y - m }, { x: TOWN_RECT.x + TOWN_RECT.w + m, y: TOWN_RECT.y - m },
    { x: TOWN_RECT.x - m, y: TOWN_RECT.y + TOWN_RECT.h + m }, { x: TOWN_RECT.x + TOWN_RECT.w + m, y: TOWN_RECT.y + TOWN_RECT.h + m },
  ];
  let best: Vec[] | null = null;
  let bestLen = Infinity;
  for (const c of corners) {
    if (segmentHitsTown(from, c) || segmentHitsTown(c, to)) continue;
    const len = Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(to.x - c.x, to.y - c.y);
    if (len < bestLen) { bestLen = len; best = [c, to]; }
  }
  if (best) return best;
  // Two corners: go around a side.
  for (const c1 of corners) for (const c2 of corners) {
    if (c1 === c2 || segmentHitsTown(from, c1) || segmentHitsTown(c1, c2) || segmentHitsTown(c2, to)) continue;
    const len = Math.hypot(c1.x - from.x, c1.y - from.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(to.x - c2.x, to.y - c2.y);
    if (len < bestLen) { bestLen = len; best = [c1, c2, to]; }
  }
  return best ?? [to];
}

function goToDoor(turn: DevTurn, door: DoorKind): Vec[] {
  if (turn.scene === 'map') return mapPath(turn.pos, { x: TOWN_RECT.x + TOWN_RECT.w / 2, y: TOWN_RECT.y + TOWN_RECT.h / 2 });
  const front = doorFront(door);
  const path: Vec[] = [];
  if (Math.abs(turn.pos.y - STREET_MID) > 30) path.push({ x: turn.pos.x, y: STREET_MID });
  path.push(front, doorPoint(door));
  return path;
}

function goToPlot(turn: DevTurn, plot: number): Vec[] {
  const target = plotCentre(plot);
  if (turn.scene === 'town') {
    const west = target.x < TOWN_RECT.x + TOWN_RECT.w / 2;
    return [{ x: turn.pos.x, y: STREET_MID }, { x: west ? -5 : SCENE_W + 5, y: STREET_MID }];
  }
  return mapPath(turn.pos, target);
}

function planDev(state: GameState, turn: DevTurn, p: Player): DevPlan {
  const secs = turn.timeLeft / 1000;
  if (turn.mule) {
    const target = chooseTarget(state, p, p.money + (turn.mule.outfit ? OUTFIT_COST[turn.mule.outfit] : 0));
    if (!target) return { key: 'corral-return', path: goToDoor(turn, 'corral') };
    if (turn.mule.outfit !== target.resource) {
      if (p.money < OUTFIT_COST[target.resource]) return { key: 'corral-return', path: goToDoor(turn, 'corral') };
      return { key: `shop:${target.resource}`, path: goToDoor(turn, target.resource) };
    }
    return { key: `install:${target.plot.index}`, path: goToPlot(turn, target.plot.index), act: true };
  }
  const cheapest = Math.min(...resources(state).map((r) => OUTFIT_COST[r]));
  const target = chooseTarget(state, p, p.money - state.store.mulePrice);
  if (target && state.store.mules > 0 && p.money >= state.store.mulePrice + cheapest && secs > 14) {
    return { key: 'corral', path: goToDoor(turn, 'corral') };
  }
  if (secs > 4) return { key: 'pub', path: goToDoor(turn, 'pub') };
  return { key: 'end', path: [], end: true };
}

/** Steer an AI's development turn for one tick. */
export function aiDevTick(state: GameState, turn: DevTurn): void {
  const p = state.players[turn.playerId]!;
  if (turn.stage !== 'active') return;
  if (turn.menu) {
    turn.menu = null;
    return;
  }
  const plan = planDev(state, turn, p);
  const key = `${plan.key}@${turn.scene}`;
  if (plan.end) {
    endTurn(state, turn, 'player');
    return;
  }
  if (turn.aiGoal !== key) {
    turn.aiGoal = key;
    turn.waypoints = plan.path.map((v) => ({ ...v }));
    return;
  }
  if (turn.waypoints.length === 0) {
    if (plan.act && turn.scene === 'map' && `install:${plotAt(turn.pos)}` === plan.key) {
      interact(state, turn);
      turn.aiGoal = null;
    } else {
      // Arrived somewhere that didn't change the plan (e.g. bumped a wall): re-plan.
      turn.aiGoal = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Auctions

export function aiDeclare(state: GameState, a: GoodsAuction): void {
  for (const part of a.participants) {
    const p = state.players[part.playerId]!;
    if (!p.ai) continue;
    const have = p.goods[a.resource];
    const buffer = p.ai === 'hard' ? 0 : 1;
    if (have > part.stopAt + buffer) {
      part.role = 'seller';
      part.price = a.ceiling;
    } else if ((a.resource === 'food' || a.resource === 'energy') && have < part.stopAt) {
      part.role = 'buyer';
      part.price = a.floor;
    } else if (a.resource === 'smithore' && have === 0 && p.ai !== 'easy' && a.storeSell < 70 && p.money > 600) {
      // Cheap smithore is a decent speculation.
      part.role = 'buyer';
      part.price = a.floor;
    } else {
      part.role = 'none';
    }
  }
}

export function aiTrade(state: GameState, a: GoodsAuction): void {
  const t = 1 - a.clock / AUCTION_TRADE_MS;
  for (const part of a.participants) {
    const p = state.players[part.playerId]!;
    if (!p.ai || part.role === 'none') continue;
    const jitter = hash01(state.config.seed, state.round, p.id, a.resource.length) * 0.15;
    let reserve: number;
    if (part.role === 'seller') {
      const hold = p.ai === 'hard' ? 0.85 : p.ai === 'normal' ? 0.7 : 0.5;
      reserve = a.ceiling - (a.ceiling - a.floor) * Math.min(1, t / (hold + jitter));
    } else {
      const have = p.goods[a.resource];
      const short = have < part.stopAt;
      const maxPay = short ? Math.min(p.money, a.ceiling) : a.floor + (a.storeSell - a.floor) * 0.35;
      const speed = p.ai === 'hard' ? 0.75 : 0.55;
      reserve = a.floor + (maxPay - a.floor) * Math.min(1, t / (speed + jitter));
      if (!short && a.resource !== 'smithore') reserve = a.floor;
      if (a.resource === 'smithore' && p.goods.smithore >= 4) reserve = a.floor;
    }
    if (part.role === 'seller') {
      part.input = sellable(state, a, part) === 0 ? 0 : part.price > reserve + 0.5 ? -1 : 0;
    } else {
      part.input = part.price < reserve - 0.5 ? 1 : part.price > reserve + 3 ? -1 : 0;
    }
  }
}

/** The most an AI will pay for a plot at auction. */
export function landValuation(state: GameState, p: Player, plot: Plot): number {
  const roundsLeft = state.config.rounds - state.round + 1;
  const perRound = bestUse(state, p, plot).value * 0.6;
  const want = 160 + perRound * Math.min(roundsLeft, 5) * 0.6;
  const cap = p.ai === 'hard' ? 0.4 : p.ai === 'normal' ? 0.3 : 0.2;
  return Math.min(want, p.money * cap);
}

export function aiLandAuction(state: GameState, a: LandAuction): { playerId: number; raising: boolean }[] {
  const out: { playerId: number; raising: boolean }[] = [];
  const plot = state.map[a.plot]!;
  const high = a.leader === null ? 0 : a.bids[a.leader]!;
  for (const p of state.players) {
    if (!p.ai || p.id === a.seller) continue;
    const want = high < landValuation(state, p, plot) && a.leader !== p.id;
    if (want !== a.raising.includes(p.id)) out.push({ playerId: p.id, raising: want });
  }
  return out;
}
