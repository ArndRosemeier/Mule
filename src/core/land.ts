/**
 * Land: the free land grant at the start of each round and the land auctions
 * (plots sold through the land office, plus the occasional colony sale).
 */
import { LAND_AUCTION_MIN_BID, LAND_AUCTION_MS, LAND_BID_STEP, TOWN_INDEX } from './constants';
import { emit } from './state';
import type { GameState, LandAuction } from './types';

export const LAND_INTRO_MS = 2200;
export const LAND_RESULT_MS = 2600;
export const LAND_BID_STEP_MS = 100;
/** A new high bid keeps the auction open at least this long. */
export const LAND_EXTEND_MS = 2500;

/** Next unowned plot after `from` in reading order, or -1. */
export function nextFreePlot(state: GameState, from: number): number {
  for (let i = from + 1; i < state.map.length; i++) {
    const p = state.map[i]!;
    if (i !== TOWN_INDEX && p.owner === null) return i;
  }
  return -1;
}

export function claimPlot(state: GameState, playerId: number, plot: number): boolean {
  const p = state.map[plot];
  if (!p || p.owner !== null || plot === TOWN_INDEX) return false;
  p.owner = playerId;
  p.mule = null;
  p.lastProduction = null;
  emit(state, { type: 'claim', playerId, plot });
  return true;
}

export function createLandAuction(plot: number, seller: number | null, minBid = LAND_AUCTION_MIN_BID): LandAuction {
  return {
    kind: 'land', plot, seller, stage: 'intro', timer: LAND_INTRO_MS, minBid,
    bids: {}, raising: [], stepTimer: LAND_BID_STEP_MS, leader: null, winner: null, price: null, ready: [],
  };
}

export function highBid(a: LandAuction): number {
  return a.leader === null ? 0 : a.bids[a.leader]!;
}

export function setRaising(state: GameState, a: LandAuction, playerId: number, raising: boolean): void {
  if (a.stage !== 'bidding' || playerId === a.seller) return;
  const has = a.raising.includes(playerId);
  if (raising && !has) {
    a.raising.push(playerId);
    if (a.bids[playerId] === undefined) a.bids[playerId] = 0;
    // Jump straight to a competitive bid when starting.
    const start = Math.max(a.minBid, highBid(a) + LAND_BID_STEP);
    if (a.bids[playerId]! < start && state.players[playerId]!.money >= start) {
      a.bids[playerId] = start;
      updateLeader(a, playerId);
    }
  } else if (!raising && has) {
    a.raising = a.raising.filter((id) => id !== playerId);
  }
}

function updateLeader(a: LandAuction, playerId: number): void {
  if (a.leader === null || a.bids[playerId]! > a.bids[a.leader]!) {
    a.leader = playerId;
    a.timer = Math.max(a.timer, LAND_EXTEND_MS);
  }
}

export function tickLandBidding(state: GameState, a: LandAuction, ms: number): void {
  a.stepTimer -= ms;
  while (a.stepTimer <= 0) {
    a.stepTimer += LAND_BID_STEP_MS;
    for (const id of a.raising) {
      const target = Math.max(a.minBid, highBid(a) + LAND_BID_STEP);
      if (a.leader === id) continue; // already on top, nothing to raise against
      if (state.players[id]!.money < target) continue;
      a.bids[id] = target;
      updateLeader(a, id);
    }
  }
  a.timer -= ms;
  if (a.timer <= 0) finishLandAuction(state, a);
}

export function finishLandAuction(state: GameState, a: LandAuction): void {
  a.stage = 'result';
  a.timer = LAND_RESULT_MS;
  a.raising = [];
  const plot = state.map[a.plot]!;
  if (a.leader === null) return;
  const price = a.bids[a.leader]!;
  const buyer = state.players[a.leader]!;
  if (buyer.money < price) return;
  buyer.money -= price;
  if (a.seller !== null) state.players[a.seller]!.money += price;
  plot.owner = buyer.id;
  if (a.seller === null) plot.mule = null;
  a.winner = buyer.id;
  a.price = price;
  emit(state, { type: 'landSold', plot: a.plot, buyer: buyer.id, seller: a.seller, price });
}

export { LAND_AUCTION_MS };
