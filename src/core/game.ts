/**
 * The game reducer. `dispatch(state, action)` returns the next state; the
 * whole game, including the computer players, advances only through
 * actions, so the same seed and action log always replay the same game.
 */
import { aiDeclare, aiDevTick, aiLandAuction, aiLandGrant, aiTrade } from './ai';
import { createGoodsAuction, hasPossibleTrades, RESULT_MS, setMove, setRole, startDeclare, startTrading, tickTrading } from './auction';
import {
  AUCTION_ORDER, COLONY_EVENT_CHANCE, LAND_AUCTION_CHANCE, LAND_AUCTION_MS, LAND_GRANT_STEP_MS, PLAYER_COLORS,
  ROUNDS, START_GOODS, START_MONEY, START_PRICE, STORE_START, MULE_START_PRICE, TOWN_INDEX,
} from './constants';
import { createDevTurn, endTurn, interact, newWampus, sellPlot, tickDevTurn } from './development';
import { buildMules, colonyScore, playerScore, updatePrices } from './economy';
import { rollColonyEvent } from './events';
import { claimPlot, createLandAuction, nextFreePlot, setRaising, tickLandBidding } from './land';
import { generateMap } from './map';
import { runProduction } from './production';
import { createRng, int, pick } from './rng';
import { allHumansReady, emit, setPhase } from './state';
import type { Action, Difficulty, GameState, Phase, PlayerSetup, Resource } from './types';

export const LAND_GRANT_DONE_MS = 1200;

export interface NewGameOptions {
  difficulty: Difficulty;
  seed: number;
  /** Override the number of rounds (tests and quick games). */
  rounds?: number;
}

export function createGame(setups: PlayerSetup[], opts: NewGameOptions): GameState {
  if (setups.length < 1 || setups.length > 4) throw new Error('M.U.L.E. needs 1 to 4 colonists');
  const rng = createRng(opts.seed);
  const map = generateMap(rng);
  const start = STORE_START[opts.difficulty];
  const state: GameState = {
    version: 1,
    config: { difficulty: opts.difficulty, rounds: opts.rounds ?? ROUNDS[opts.difficulty], seed: opts.seed },
    rng,
    round: 0,
    phase: { kind: 'roundIntro', ready: [] },
    players: setups.map((s, id) => ({
      id, name: s.name, species: s.species, color: PLAYER_COLORS[id]!, ai: s.ai,
      money: START_MONEY[s.species], goods: { ...START_GOODS }, assayed: [], foodUsed: 0,
    })),
    map,
    store: { stock: { ...start.stock }, buy: { ...START_PRICE }, mules: start.mules, mulePrice: MULE_START_PRICE },
    landForSale: [],
    events: [],
    eventSeq: 0,
    history: [],
    lastReport: null,
    time: 0,
  };
  startRound(state);
  return state;
}

/** Pure entry point: returns a new state, leaving the input untouched. */
export function dispatch(state: GameState, action: Action): GameState {
  const next = structuredClone(state);
  applyAction(next, action);
  return next;
}

/** Mutating version, for hot loops (simulations, the client's own copy). */
export function applyAction(state: GameState, action: Action): void {
  switch (action.type) {
    case 'tick':
      state.time += action.ms;
      tick(state, action.ms);
      return;
    case 'ready':
      return ready(state, action.playerId);
    case 'claim':
      return claim(state, action.playerId);
    case 'move': {
      const turn = activeTurn(state, action.playerId);
      if (turn) turn.input = { x: clamp1(action.x), y: clamp1(action.y) };
      return;
    }
    case 'interact': {
      const turn = activeTurn(state, action.playerId);
      if (turn) interact(state, turn);
      return;
    }
    case 'endTurn': {
      const turn = activeTurn(state, action.playerId);
      if (turn) endTurn(state, turn, 'player');
      return;
    }
    case 'sellPlot': {
      const turn = activeTurn(state, action.playerId);
      if (turn) sellPlot(state, turn, action.plot);
      return;
    }
    case 'auctionRole':
      if (state.phase.kind === 'auction') setRole(state.phase.auction, action.playerId, action.role);
      return;
    case 'auctionMove':
      if (state.phase.kind === 'auction') setMove(state, state.phase.auction, action.playerId, action.dir);
      return;
    case 'landBid':
      if (state.phase.kind === 'landAuction') setRaising(state, state.phase.auction, action.playerId, action.raising);
      return;
  }
}

const clamp1 = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, -1), 1) : 0);

function activeTurn(state: GameState, playerId: number) {
  if (state.phase.kind !== 'development') return null;
  const turn = state.phase.turn;
  if (turn.playerId !== playerId || turn.stage !== 'active') return null;
  if (state.players[playerId]!.ai) return null;
  return turn;
}

// ---------------------------------------------------------------------------
// Round flow

function startRound(state: GameState): void {
  state.round += 1;
  if (state.round > 1) buildMules(state);
  for (const p of state.players) p.foodUsed = 0;
  setPhase(state, { kind: 'roundIntro', ready: [] });
}

function startLandGrant(state: GameState): void {
  const claims: Record<number, number | null> = {};
  for (const p of state.players) claims[p.id] = null;
  const cursor = nextFreePlot(state, -1);
  setPhase(state, { kind: 'landGrant', cursor, timer: LAND_GRANT_STEP_MS, claims, done: cursor < 0, ready: [] });
}

function startLandAuctions(state: GameState): void {
  const queue: { plot: number; seller: number | null }[] = [];
  for (const s of state.landForSale) {
    if (state.map[s.plot]!.owner === s.seller) queue.push({ plot: s.plot, seller: s.seller });
  }
  state.landForSale = [];
  if (state.config.difficulty !== 'beginner' && state.round > 1 && state.round < state.config.rounds) {
    const free = state.map.filter((p) => p.owner === null && p.index !== TOWN_INDEX);
    if (free.length && int(state.rng, 0, 999) < LAND_AUCTION_CHANCE * 1000) {
      queue.push({ plot: pick(state.rng, free).index, seller: null });
    }
  }
  nextLandAuction(state, queue);
}

function nextLandAuction(state: GameState, queue: { plot: number; seller: number | null }[]): void {
  const item = queue.shift();
  if (!item) return startDevelopment(state);
  setPhase(state, { kind: 'landAuction', auction: createLandAuction(item.plot, item.seller), queue });
}

function startDevelopment(state: GameState): void {
  // The colonist in last place goes first.
  const order = [...state.players]
    .sort((a, b) => playerScore(state, a).total - playerScore(state, b).total || a.id - b.id)
    .map((p) => p.id);
  const first = state.players[order[0]!]!;
  const turn = createDevTurn(state, first);
  setPhase(state, { kind: 'development', order, index: 0, turn, wampus: newWampus(state) });
}

function nextDevTurn(state: GameState, phase: Extract<Phase, { kind: 'development' }>): void {
  phase.index += 1;
  if (phase.index >= phase.order.length) return startProduction(state);
  phase.turn = createDevTurn(state, state.players[phase.order[phase.index]!]!);
  phase.wampus = newWampus(state);
}

function startProduction(state: GameState): void {
  const chance = state.config.difficulty === 'beginner' ? COLONY_EVENT_CHANCE * 0.6 : COLONY_EVENT_CHANCE;
  const event = rollColonyEvent(state, chance);
  const report = runProduction(state, event);
  state.lastReport = report;
  if (event) emit(state, { type: 'colony', event });
  setPhase(state, { kind: 'production', report, colonyEvent: event, ready: [] });
}

function auctionResources(state: GameState): Resource[] {
  return AUCTION_ORDER.filter((r) => !(r === 'crystite' && state.config.difficulty === 'beginner'));
}

function startAuction(state: GameState, index: number): void {
  const list = auctionResources(state);
  for (let i = index; i < list.length; i++) {
    const r = list[i]!;
    const anyone = state.players.some((p) => p.goods[r] > 0) || state.store.stock[r] > 0;
    if (!anyone) continue;
    setPhase(state, { kind: 'auction', auction: createGoodsAuction(state, r), index: i });
    return;
  }
  endRound(state);
}

function endRound(state: GameState): void {
  const scores: Record<number, number> = {};
  for (const p of state.players) scores[p.id] = playerScore(state, p).total;
  state.history.push({ round: state.round, scores, colony: colonyScore(state) });
  if (state.round >= state.config.rounds) {
    setPhase(state, { kind: 'gameOver', ready: [] });
    return;
  }
  updatePrices(state);
  startRound(state);
}

// ---------------------------------------------------------------------------
// Ticks and readiness

function ready(state: GameState, playerId: number): void {
  const ph = state.phase;
  const mark = (list: number[]) => { if (!list.includes(playerId)) list.push(playerId); };
  switch (ph.kind) {
    case 'roundIntro':
    case 'production':
    case 'gameOver':
      mark(ph.ready);
      return;
    case 'landGrant':
      if (ph.done) mark(ph.ready);
      return;
    case 'landAuction':
      if (ph.auction.stage !== 'bidding') mark(ph.auction.ready);
      return;
    case 'development':
      if (ph.turn.playerId === playerId && ph.turn.stage === 'intro') {
        ph.turn.stage = 'active';
      } else if (ph.turn.stage === 'done' && ph.turn.playerId === playerId) {
        ph.turn.stageTimer = 0;
      }
      return;
    case 'auction':
      if (ph.auction.stage !== 'trading') mark(ph.auction.ready);
      return;
  }
}

function claim(state: GameState, playerId: number): void {
  const ph = state.phase;
  if (ph.kind !== 'landGrant' || ph.done || ph.cursor < 0) return;
  if (ph.claims[playerId] !== null) return;
  if (claimPlot(state, playerId, ph.cursor)) {
    ph.claims[playerId] = ph.cursor;
    if (Object.values(ph.claims).every((c) => c !== null)) finishLandGrant(ph);
    else {
      // Move on from a plot as soon as it is taken.
      ph.cursor = nextFreePlot(state, ph.cursor);
      ph.timer = LAND_GRANT_STEP_MS;
      if (ph.cursor < 0) finishLandGrant(ph);
    }
  }
}

function finishLandGrant(ph: Extract<Phase, { kind: 'landGrant' }>): void {
  ph.done = true;
  ph.timer = LAND_GRANT_DONE_MS;
}

function tick(state: GameState, ms: number): void {
  const ph = state.phase;
  switch (ph.kind) {
    case 'roundIntro':
      if (allHumansReady(state, ph.ready)) startLandGrant(state);
      return;

    case 'landGrant': {
      if (ph.done) {
        ph.timer -= ms;
        if (ph.timer <= 0 || allHumansReady(state, ph.ready)) startLandAuctions(state);
        return;
      }
      ph.timer -= ms;
      for (const id of aiLandGrant(state, ph)) {
        if (ph.done) break;
        claim(state, id);
      }
      if (ph.done) return;
      if (ph.timer <= 0) {
        ph.cursor = nextFreePlot(state, ph.cursor);
        ph.timer = LAND_GRANT_STEP_MS;
        if (ph.cursor < 0) finishLandGrant(ph);
      }
      return;
    }

    case 'landAuction': {
      const a = ph.auction;
      if (a.stage === 'intro') {
        a.timer -= ms;
        if (a.timer <= 0 || allHumansReady(state, a.ready)) {
          a.stage = 'bidding';
          a.timer = LAND_AUCTION_MS;
          a.ready = [];
        }
      } else if (a.stage === 'bidding') {
        for (const d of aiLandAuction(state, a)) setRaising(state, a, d.playerId, d.raising);
        tickLandBidding(state, a, ms);
      } else {
        a.timer -= ms;
        if (a.timer <= 0 || allHumansReady(state, a.ready)) nextLandAuction(state, ph.queue);
      }
      return;
    }

    case 'development': {
      const turn = ph.turn;
      const isAI = state.players[turn.playerId]!.ai !== null;
      if (turn.stage === 'intro') {
        if (isAI) {
          turn.stageTimer -= ms;
          if (turn.stageTimer <= 0) turn.stage = 'active';
        }
        return;
      }
      if (turn.stage === 'active') {
        if (isAI) aiDevTick(state, turn);
        if (turn.stage === 'active') tickDevTurn(state, ph, ms);
        return;
      }
      turn.stageTimer -= ms;
      if (turn.stageTimer <= 0) nextDevTurn(state, ph);
      return;
    }

    case 'production':
      if (allHumansReady(state, ph.ready)) startAuction(state, 0);
      return;

    case 'auction': {
      const a = ph.auction;
      if (a.stage === 'status') {
        if (allHumansReady(state, a.ready)) {
          a.ready = [];
          startDeclare(a);
          aiDeclare(state, a);
        }
      } else if (a.stage === 'declare') {
        a.timer -= ms;
        if (a.timer <= 0 || allHumansReady(state, a.ready)) {
          a.ready = [];
          if (hasPossibleTrades(state, a)) startTrading(a);
          else {
            a.stage = 'result';
            a.timer = RESULT_MS;
          }
        }
      } else if (a.stage === 'trading') {
        aiTrade(state, a);
        tickTrading(state, a, ms);
        if (a.clock <= 0) {
          a.stage = 'result';
          a.timer = RESULT_MS;
          for (const p of a.participants) p.input = 0;
        }
      } else {
        a.timer -= ms;
        if (a.timer <= 0 || allHumansReady(state, a.ready)) startAuction(state, ph.index + 1);
      }
      return;
    }

    case 'gameOver':
      return;
  }
}
