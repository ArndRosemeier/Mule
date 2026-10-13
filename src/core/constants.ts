/**
 * Rule numbers. Everything tunable about the game lives here so the rules
 * modules stay readable and docs/RULES.md can point at one place.
 */
import type { Difficulty, Resource, Species, Terrain } from './types';

export const TICK_MS = 50;

export const MAP_COLS = 9;
export const MAP_ROWS = 5;
export const TOWN_COL = 4;
export const TOWN_ROW = 2;
export const TOWN_INDEX = TOWN_ROW * MAP_COLS + TOWN_COL;

/** World units. The map scene and the town scene share the same size. */
export const PLOT_W = 100;
export const PLOT_H = 100;
export const SCENE_W = MAP_COLS * PLOT_W; // 900
export const SCENE_H = MAP_ROWS * PLOT_H; // 500

export const RESOURCES: readonly Resource[] = ['food', 'energy', 'smithore', 'crystite'];
/** Auction order each round, as in the original. */
export const AUCTION_ORDER: readonly Resource[] = ['smithore', 'crystite', 'food', 'energy'];

export const ROUNDS: Record<Difficulty, number> = { beginner: 6, standard: 12, tournament: 12 };

export const SPECIES: readonly Species[] = [
  'mechtron', 'gollumer', 'packer', 'bonzoid', 'spheroid', 'flapper', 'leggite', 'humanoid',
];

export const START_MONEY: Record<Species, number> = {
  mechtron: 1000, gollumer: 1000, packer: 1000, bonzoid: 1000,
  spheroid: 1000, leggite: 1000, flapper: 1600, humanoid: 600,
};

export const PLAYER_COLORS = ['#e8504f', '#3fa7f5', '#f5c542', '#55d17a'] as const;

export const START_GOODS: Record<Resource, number> = { food: 4, energy: 2, smithore: 0, crystite: 0 };

/** Base production of one MULE by terrain. Crystite depends on the hidden deposit instead. */
export const BASE_PRODUCTION: Record<Exclude<Resource, 'crystite'>, Record<Terrain, number>> = {
  food: { river: 4, plain: 2, mountain1: 1, mountain2: 1, mountain3: 1, town: 0 },
  energy: { river: 2, plain: 3, mountain1: 1, mountain2: 1, mountain3: 1, town: 0 },
  smithore: { river: 0, plain: 1, mountain1: 2, mountain2: 3, mountain3: 4, town: 0 },
};
export const MAX_PRODUCTION = 8;

/** Food each player needs per development turn, by round (index = round - 1). */
export const FOOD_REQUIRED = [3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5];
export function foodRequired(round: number): number {
  return FOOD_REQUIRED[Math.min(Math.max(round, 1), FOOD_REQUIRED.length) - 1]!;
}

/** Development turn length in ms with full food, and the floor with none. */
export const DEV_TIME_FULL = 47_500;
export const DEV_TIME_MIN = 5_000;

export const WALK_SPEED_MAP = 105; // world units per second
export const WALK_SPEED_TOWN = 190;

/** Money multiplier used by random events, pub and wampus (index = round - 1). */
export const ROUND_MULT = [25, 25, 25, 50, 50, 50, 50, 75, 75, 75, 75, 100];
export function roundMult(round: number): number {
  return ROUND_MULT[Math.min(Math.max(round, 1), ROUND_MULT.length) - 1]!;
}
export const PUB_ROUND_BONUS = [50, 50, 50, 100, 100, 100, 100, 150, 150, 150, 150, 200];
export const PUB_MAX = 250;
export const WAMPUS_BONUS = [100, 100, 100, 200, 200, 200, 200, 300, 300, 300, 300, 400];

export const OUTFIT_COST: Record<Resource, number> = { food: 25, energy: 50, smithore: 75, crystite: 100 };

export const LAND_VALUE = 500;

/** Store opening stock and prices (store buy price; it sells for buy + spread). */
export const STORE_START: Record<Difficulty, { stock: Record<Resource, number>; mules: number }> = {
  beginner: { stock: { food: 16, energy: 16, smithore: 0, crystite: 0 }, mules: 25 },
  standard: { stock: { food: 8, energy: 8, smithore: 8, crystite: 0 }, mules: 14 },
  tournament: { stock: { food: 8, energy: 8, smithore: 8, crystite: 0 }, mules: 14 },
};
export const START_PRICE: Record<Resource, number> = { food: 30, energy: 25, smithore: 50, crystite: 100 };
export const PRICE_SPREAD: Record<Resource, number> = { food: 35, energy: 35, smithore: 35, crystite: 35 };
export const MIN_PRICE: Record<Resource, number> = { food: 10, energy: 10, smithore: 20, crystite: 50 };
export const MAX_PRICE: Record<Resource, number> = { food: 250, energy: 250, smithore: 250, crystite: 150 };
export const MULE_START_PRICE = 100;
export const MAX_STORE_MULES = 25;
export const SMITHORE_PER_MULE = 2;

/** Above this amount smithore and crystite spoil (are lost) each round. */
export const MINERAL_SPOIL_CAP = 50;

/** Personal random event chance at the start of each development turn. */
export const PERSONAL_EVENT_CHANCE = 0.275;
/** Colony event chance per round (production phase). */
export const COLONY_EVENT_CHANCE = 0.55;

/** Land grant cursor step. */
export const LAND_GRANT_STEP_MS = 700;

/** Auction timing. */
export const AUCTION_DECLARE_MS = 6_000;
export const AUCTION_TRADE_MS = 14_000;
export const AUCTION_UNIT_MS = 250;
/** Price change per second while holding up/down, as a fraction of the visible range. */
export const AUCTION_MOVE_RANGE_PER_S = 0.4;
export const LAND_AUCTION_MS = 12_000;
export const LAND_AUCTION_CHANCE = 0.35;
export const LAND_AUCTION_MIN_BID = 160;
export const LAND_BID_STEP = 4;

/** Colony rating thresholds on the total colony score at game end. */
export const COLONY_RATINGS: readonly [number, string][] = [
  [120_000, 'Superior. The colony is a shining jewel of the frontier.'],
  [100_000, 'Excellent. The colony will be remembered as a great success.'],
  [80_000, 'Good. The colony is comfortable and prosperous.'],
  [60_000, 'Fair. The colony survives, if not exactly in luxury.'],
  [40_000, 'Weak. Life on Irata is hard for the colonists left behind.'],
  [0, 'Failure. The colony could not support itself and was abandoned.'],
];
