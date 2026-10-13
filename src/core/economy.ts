import {
  COLONY_RATINGS, LAND_VALUE, MAX_PRICE, MAX_STORE_MULES, MIN_PRICE, MULE_START_PRICE, PRICE_SPREAD,
  RESOURCES, SMITHORE_PER_MULE, START_PRICE, foodRequired,
} from './constants';
import { int } from './rng';
import type { GameState, Player, Resource } from './types';

export function storeSellPrice(state: GameState, r: Resource): number {
  return state.store.buy[r] + PRICE_SPREAD[r];
}

export function plotsOf(state: GameState, playerId: number) {
  return state.map.filter((p) => p.owner === playerId);
}

/** Energy a player's MULEs consume each production: one per non-energy MULE. */
export function energyNeeded(state: GameState, playerId: number): number {
  return plotsOf(state, playerId).filter((p) => p.mule && p.mule !== 'energy').length;
}

/**
 * Critical level: what a player needs to keep through the next round. A
 * seller in the auction stops automatically when reaching it.
 */
export function criticalLevel(state: GameState, playerId: number, r: Resource): number {
  if (r === 'food') return state.round < state.config.rounds ? foodRequired(state.round + 1) : 0;
  if (r === 'energy') return state.round < state.config.rounds ? energyNeeded(state, playerId) : 0;
  return 0;
}

export interface ScoreBreakdown {
  money: number;
  land: number;
  goods: number;
  total: number;
}

export function playerScore(state: GameState, player: Player): ScoreBreakdown {
  const plots = plotsOf(state, player.id);
  const land = plots.length * LAND_VALUE + plots.filter((p) => p.mule).length * state.store.mulePrice;
  let goods = 0;
  for (const r of RESOURCES) goods += player.goods[r] * state.store.buy[r];
  return { money: player.money, land, goods, total: player.money + land + goods };
}

export function colonyScore(state: GameState): number {
  return state.players.reduce((a, p) => a + playerScore(state, p).total, 0);
}

export function colonyRating(total: number): string {
  for (const [min, text] of COLONY_RATINGS) if (total >= min) return text;
  return COLONY_RATINGS[COLONY_RATINGS.length - 1]![1];
}

/** Players sorted by score, best first. Ties broken by id for determinism. */
export function ranking(state: GameState): Player[] {
  return [...state.players].sort((a, b) => playerScore(state, b).total - playerScore(state, a).total || a.id - b.id);
}

/**
 * Re-price the store between rounds. Food and energy follow colony-wide
 * supply against next round's demand; smithore follows the store's own stock
 * (MULEs are built from it); crystite is set by off-world demand, which
 * swings randomly.
 */
export function updatePrices(state: GameState): void {
  const s = state.store;
  const held = (r: Resource) => state.players.reduce((a, p) => a + p.goods[r], 0) + s.stock[r];

  const foodDemand = state.players.length * foodRequired(state.round + 1);
  const energyDemand = state.players.reduce((a, p) => a + energyNeeded(state, p.id), 0) + state.players.length;
  const adjust = (r: Resource, demand: number, base: number) => {
    const supply = Math.max(held(r), 1);
    const ratio = Math.min(Math.max(demand / supply, 0.25), 4);
    const target = base * (0.4 + 0.6 * ratio);
    s.buy[r] = clampPrice(r, Math.round((s.buy[r] + target) / 2));
  };
  adjust('food', foodDemand, START_PRICE.food);
  adjust('energy', energyDemand, START_PRICE.energy);

  // Smithore: scarce in the store means expensive.
  const ore = s.stock.smithore;
  const oreTarget = ore >= 20 ? 35 : ore >= 10 ? 50 : ore >= 4 ? 75 : 110;
  s.buy.smithore = clampPrice('smithore', Math.round((s.buy.smithore + oreTarget) / 2));

  s.buy.crystite = clampPrice('crystite', int(state.rng, 50, 150));
}

function clampPrice(r: Resource, v: number): number {
  return Math.min(Math.max(v, MIN_PRICE[r]), MAX_PRICE[r]);
}

/**
 * At the start of each round the store turns smithore into MULEs and
 * re-prices them from the smithore price.
 */
export function buildMules(state: GameState): void {
  const s = state.store;
  const room = MAX_STORE_MULES - s.mules;
  const build = Math.max(0, Math.min(room, Math.floor(s.stock.smithore / SMITHORE_PER_MULE)));
  s.mules += build;
  s.stock.smithore -= build * SMITHORE_PER_MULE;
  const raw = Math.max(MULE_START_PRICE, s.buy.smithore * 2);
  // Scarcity premium when the corral runs low.
  const premium = s.mules < 4 ? 1.25 : 1;
  s.mulePrice = Math.round((raw * premium) / 10) * 10;
}
