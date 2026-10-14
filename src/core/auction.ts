/**
 * The goods auction, one resource at a time. Buyers start at the bottom of
 * the price scale and push their bid up; sellers start at the top and lower
 * their ask. When a bid and an ask meet, units change hands one at a time at
 * that price while the auction clock pauses. The store buys anything at its
 * floor price and sells from its stock at its ceiling price.
 */
import { AUCTION_DECLARE_MS, AUCTION_MOVE_RANGE_PER_S, AUCTION_TRADE_MS, AUCTION_UNIT_MS, PRICE_SPREAD } from './constants';
import { criticalLevel } from './economy';
import { emit } from './state';
import type { AuctionParticipant, GameState, GoodsAuction, Resource } from './types';

export const RESULT_MS = 2600;
/** Price distance at which a bid and an ask count as touching. */
const TOUCH = 0.5;

export function createGoodsAuction(state: GameState, resource: Resource): GoodsAuction {
  const storeBuy = state.store.buy[resource];
  const storeSell = storeBuy + PRICE_SPREAD[resource];
  const storeHas = state.store.stock[resource] > 0;
  const ceiling = storeHas ? storeSell : storeSell + Math.max(40, Math.round(storeBuy * 0.8));
  const participants: AuctionParticipant[] = state.players.map((p) => {
    const stopAt = criticalLevel(state, p.id, resource);
    const role = p.goods[resource] > stopAt ? 'seller' : 'buyer';
    return { playerId: p.id, role, price: role === 'seller' ? ceiling : storeBuy, stopAt, override: false, input: 0, traded: 0, spent: 0 };
  });
  return {
    kind: 'goods', resource, stage: 'status', timer: 0, clock: AUCTION_TRADE_MS, unitTimer: AUCTION_UNIT_MS,
    floor: storeBuy, ceiling, storeBuy, storeSell, participants, lastPrice: null, tradesCount: 0, ready: [],
  };
}

export function setRole(a: GoodsAuction, playerId: number, role: 'buyer' | 'seller'): void {
  if (a.stage !== 'declare') return;
  const p = a.participants.find((q) => q.playerId === playerId);
  if (!p) return;
  p.role = role;
  p.price = role === 'seller' ? a.ceiling : a.floor;
}

/**
 * Movement input. A seller who was stopped at the critical level and presses
 * down again chooses to keep selling below it.
 */
export function setMove(state: GameState, a: GoodsAuction, playerId: number, dir: -1 | 0 | 1): void {
  const p = a.participants.find((q) => q.playerId === playerId);
  if (!p || a.stage !== 'trading') return;
  if (p.role === 'seller' && dir < 0 && p.input >= 0 && !p.override && sellable(state, a, p) === 0 && state.players[playerId]!.goods[a.resource] > 0) {
    p.override = true;
  }
  p.input = dir;
}

export function startDeclare(a: GoodsAuction): void {
  a.stage = 'declare';
  a.timer = AUCTION_DECLARE_MS;
}

/** Whether anything at all can trade, so empty auctions can be skipped. */
export function hasPossibleTrades(state: GameState, a: GoodsAuction): boolean {
  const sellers = a.participants.filter((p) => p.role === 'seller' && sellable(state, a, p) > 0);
  const buyers = a.participants.filter((p) => p.role === 'buyer' && state.players[p.playerId]!.money >= a.floor);
  return sellers.length > 0 || (buyers.length > 0 && state.store.stock[a.resource] > 0);
}

export function startTrading(a: GoodsAuction): void {
  a.stage = 'trading';
  a.clock = AUCTION_TRADE_MS;
  a.unitTimer = AUCTION_UNIT_MS;
}

/** Units a seller can still part with, respecting the critical-level stop. */
export function sellable(state: GameState, a: GoodsAuction, p: AuctionParticipant): number {
  const have = state.players[p.playerId]!.goods[a.resource];
  return p.override ? have : Math.max(0, have - p.stopAt);
}

function activeSellers(state: GameState, a: GoodsAuction) {
  return a.participants.filter((p) => p.role === 'seller' && sellable(state, a, p) > 0);
}

function activeBuyers(state: GameState, a: GoodsAuction) {
  return a.participants.filter((p) => p.role === 'buyer' && state.players[p.playerId]!.money >= Math.round(p.price));
}

/** Lowest ask on the board (the store's counts if it has stock). */
export function bestAsk(state: GameState, a: GoodsAuction): number {
  let ask = state.store.stock[a.resource] > 0 ? a.storeSell : Infinity;
  for (const s of activeSellers(state, a)) ask = Math.min(ask, s.price);
  return ask;
}

/** Highest bid on the board (the store always bids its floor). */
export function bestBid(state: GameState, a: GoodsAuction): number {
  let bid = a.floor;
  for (const b of activeBuyers(state, a)) bid = Math.max(bid, b.price);
  return bid;
}

export function tickTrading(state: GameState, a: GoodsAuction, ms: number): void {
  // Move everyone, without letting a bid jump past the best ask or vice versa.
  const rate = ((a.ceiling - a.floor) * AUCTION_MOVE_RANGE_PER_S * ms) / 1000;
  for (const p of a.participants) {
    if (p.role === 'none' || p.input === 0) continue;
    let price = p.price + p.input * rate;
    if (p.role === 'buyer') {
      price = Math.min(price, bestAskExcluding(state, a, p.playerId));
    } else {
      price = Math.max(price, bestBidExcluding(state, a, p.playerId));
    }
    p.price = Math.min(Math.max(price, a.floor), a.ceiling);
  }

  const match = findMatch(state, a);
  if (!match) {
    a.clock = Math.max(0, a.clock - ms);
    a.unitTimer = AUCTION_UNIT_MS;
    return;
  }
  a.unitTimer -= ms;
  while (a.unitTimer <= 0) {
    a.unitTimer += AUCTION_UNIT_MS;
    const m = findMatch(state, a);
    if (!m) break;
    transfer(state, a, m.buyer, m.seller, m.price);
  }
}

function bestAskExcluding(state: GameState, a: GoodsAuction, id: number): number {
  let ask = state.store.stock[a.resource] > 0 ? a.storeSell : a.ceiling;
  for (const s of activeSellers(state, a)) if (s.playerId !== id) ask = Math.min(ask, s.price);
  return ask;
}

function bestBidExcluding(state: GameState, a: GoodsAuction, id: number): number {
  let bid = a.floor;
  for (const b of activeBuyers(state, a)) if (b.playerId !== id) bid = Math.max(bid, b.price);
  return bid;
}

interface Match {
  buyer: AuctionParticipant | null; // null = store
  seller: AuctionParticipant | null; // null = store
  price: number;
}

/** The pair that trades next, if any bid and ask touch. Earlier players win ties. */
export function findMatch(state: GameState, a: GoodsAuction): Match | null {
  const sellers = activeSellers(state, a);
  const buyers = activeBuyers(state, a);
  let seller: AuctionParticipant | null = null;
  for (const s of sellers) if (!seller || s.price < seller.price) seller = s;
  let buyer: AuctionParticipant | null = null;
  for (const b of buyers) if (!buyer || b.price > buyer.price) buyer = b;

  const storeHas = state.store.stock[a.resource] > 0;
  // Player to player.
  if (seller && buyer && buyer.price >= seller.price - TOUCH) {
    const price = Math.round(seller.price);
    if (state.players[buyer.playerId]!.money >= price) return { buyer, seller, price };
  }
  // Player sells to the store at its floor.
  if (seller && seller.price <= a.floor + TOUCH) return { buyer: null, seller, price: a.floor };
  // Player buys from the store at its ceiling.
  if (buyer && storeHas && buyer.price >= a.storeSell - TOUCH && state.players[buyer.playerId]!.money >= a.storeSell) {
    return { buyer, seller: null, price: a.storeSell };
  }
  return null;
}

function transfer(state: GameState, a: GoodsAuction, buyer: AuctionParticipant | null, seller: AuctionParticipant | null, price: number): void {
  const r = a.resource;
  if (buyer) {
    const p = state.players[buyer.playerId]!;
    p.money -= price;
    p.goods[r] += 1;
    buyer.traded += 1;
    buyer.spent += price;
  } else {
    state.store.stock[r] += 1;
  }
  if (seller) {
    const p = state.players[seller.playerId]!;
    p.money += price;
    p.goods[r] -= 1;
    seller.traded += 1;
    seller.spent -= price;
  } else {
    state.store.stock[r] -= 1;
  }
  a.lastPrice = price;
  a.tradesCount += 1;
  emit(state, { type: 'trade', resource: r, buyer: buyer?.playerId ?? null, seller: seller?.playerId ?? null, price });
}
