import type { RngState } from './rng';

export type Resource = 'food' | 'energy' | 'smithore' | 'crystite';
export type Terrain = 'plain' | 'river' | 'mountain1' | 'mountain2' | 'mountain3' | 'town';
export type Species =
  | 'mechtron' | 'gollumer' | 'packer' | 'bonzoid'
  | 'spheroid' | 'flapper' | 'leggite' | 'humanoid';
export type Difficulty = 'beginner' | 'standard' | 'tournament';
export type Goods = Record<Resource, number>;

export interface PlayerSetup {
  name: string;
  species: Species;
  /** null = human. */
  ai: null | 'easy' | 'normal' | 'hard';
}

export interface GameConfig {
  difficulty: Difficulty;
  rounds: number;
  seed: number;
}

export interface Player {
  id: number;
  name: string;
  species: Species;
  color: string;
  ai: PlayerSetup['ai'];
  money: number;
  goods: Goods;
  /** Plot indices whose crystite level this player has assayed. */
  assayed: number[];
  /** Food eaten at the start of this round's development turn. */
  foodUsed: number;
}

export interface Plot {
  index: number;
  col: number;
  row: number;
  terrain: Terrain;
  /** Hidden crystite deposit, 0 (none) to 4 (very high). */
  crystite: number;
  owner: number | null;
  mule: Resource | null;
  /** Units produced last production phase, for the map display. */
  lastProduction: number | null;
}

export interface Store {
  stock: Goods;
  /** Price the store pays; it sells at buy + spread. */
  buy: Goods;
  mules: number;
  mulePrice: number;
}

export interface Vec {
  x: number;
  y: number;
}

export type Scene = 'map' | 'town';

export type DoorKind =
  | 'food' | 'energy' | 'smithore' | 'crystite'
  | 'corral' | 'pub' | 'assay' | 'land';

export interface CarriedMule {
  outfit: Resource | null;
}

export interface DevTurn {
  playerId: number;
  /** 'intro' shows the personal event / get-ready card; 'active' runs the clock; 'done' shows the outcome. */
  stage: 'intro' | 'active' | 'done';
  stageTimer: number;
  timeLeft: number;
  timeTotal: number;
  scene: Scene;
  pos: Vec;
  /** Facing for animation: -1 left, 1 right. */
  facing: -1 | 1;
  /** Human analog input, each in [-1, 1]. */
  input: Vec;
  /** Navigation targets in the current scene (AI). */
  waypoints: Vec[];
  /** What the AI is currently walking towards, so it only re-plans when that changes. */
  aiGoal: string | null;
  mule: CarriedMule | null;
  /** Plot index of the assay sample being carried. */
  sample: number | null;
  /** Door the avatar is currently overlapping, to fire once per entry. */
  inDoor: DoorKind | null;
  /** Land office menu open: avatar frozen, waits for a sellPlot / closeMenu action. */
  menu: 'land' | null;
  wampusCaught: boolean;
  message: string | null;
  endReason: null | 'time' | 'pub' | 'player';
}

export interface Wampus {
  plot: number;
  visible: boolean;
  timer: number;
}

export interface AuctionParticipant {
  playerId: number;
  role: 'buyer' | 'seller' | 'none';
  price: number;
  /** Units at which a seller stops automatically (critical level). */
  stopAt: number;
  /** Seller passed the critical stop and keeps selling. */
  override: boolean;
  /** Move input: -1 down, 0 still, 1 up. */
  input: number;
  traded: number;
  spent: number;
}

export interface GoodsAuction {
  kind: 'goods';
  resource: Resource;
  stage: 'status' | 'declare' | 'trading' | 'result';
  timer: number;
  /** Ms left on the trading clock (paused while units change hands). */
  clock: number;
  /** Ms until the next unit transfers while a buyer and seller touch. */
  unitTimer: number;
  floor: number;
  ceiling: number;
  storeBuy: number;
  storeSell: number;
  participants: AuctionParticipant[];
  /** Last trade price, for the display. */
  lastPrice: number | null;
  tradesCount: number;
  ready: number[];
}

export interface LandAuction {
  kind: 'land';
  plot: number;
  /** Player selling the plot, or null for the colony. */
  seller: number | null;
  stage: 'intro' | 'bidding' | 'result';
  timer: number;
  minBid: number;
  bids: Record<number, number>;
  /** Players currently raising (holding up). */
  raising: number[];
  /** Ms until the next bid step for raising players. */
  stepTimer: number;
  /** Player holding the high bid. */
  leader: number | null;
  winner: number | null;
  price: number | null;
  ready: number[];
}

export interface ProductionReport {
  /** Per plot index production this round. */
  plots: Record<number, number>;
  /** Per player: energy needed, energy had. */
  perPlayer: Record<number, { produced: Goods; usage: Goods; spoiled: Goods; before: Goods; shortEnergy: number }>;
}

export type Phase =
  | { kind: 'roundIntro'; ready: number[] }
  | { kind: 'landGrant'; cursor: number; timer: number; claims: Record<number, number | null>; done: boolean; ready: number[] }
  | { kind: 'landAuction'; auction: LandAuction; queue: { plot: number; seller: number | null }[] }
  | { kind: 'development'; order: number[]; index: number; turn: DevTurn; wampus: Wampus | null }
  | { kind: 'production'; report: ProductionReport; colonyEvent: ColonyEvent | null; ready: number[] }
  | { kind: 'auction'; auction: GoodsAuction; index: number }
  | { kind: 'gameOver'; ready: number[] };

export interface ColonyEvent {
  type: 'pests' | 'pirates' | 'acidrain' | 'sunspot' | 'quake' | 'meteorite' | 'radiation' | 'fire';
  text: string;
  /** Affected plot or row, depending on type. */
  plot?: number;
  row?: number;
  playerId?: number;
}

export type GameEvent =
  | { seq: number; type: 'log'; text: string; playerId?: number }
  | { seq: number; type: 'personal'; playerId: number; text: string; good: boolean }
  | { seq: number; type: 'colony'; event: ColonyEvent }
  | { seq: number; type: 'claim'; playerId: number; plot: number }
  | { seq: number; type: 'buyMule'; playerId: number; price: number }
  | { seq: number; type: 'outfit'; playerId: number; resource: Resource; cost: number }
  | { seq: number; type: 'install'; playerId: number; plot: number; resource: Resource }
  | { seq: number; type: 'muleLost'; playerId: number; reason: string }
  | { seq: number; type: 'pub'; playerId: number; amount: number }
  | { seq: number; type: 'wampus'; playerId: number; amount: number }
  | { seq: number; type: 'assay'; playerId: number; plot: number; level: number }
  | { seq: number; type: 'trade'; resource: Resource; buyer: number | null; seller: number | null; price: number }
  | { seq: number; type: 'landSold'; plot: number; buyer: number; seller: number | null; price: number }
  | { seq: number; type: 'phase'; phase: Phase['kind'] };

/** A GameEvent before the reducer stamps its sequence number. */
export type NewEvent = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 'seq'> : never) : never;

export interface RoundHistory {
  round: number;
  scores: Record<number, number>;
  colony: number;
}

export interface GameState {
  version: 1;
  config: GameConfig;
  rng: RngState;
  round: number;
  phase: Phase;
  players: Player[];
  map: Plot[];
  store: Store;
  /** Plots put up for sale at the land office, auctioned next land auction. */
  landForSale: { plot: number; seller: number }[];
  events: GameEvent[];
  eventSeq: number;
  history: RoundHistory[];
  /** Most recent production phase, for the auction status boards. */
  lastReport: ProductionReport | null;
  /** Ms of game time elapsed, for animation sync. */
  time: number;
}

export type Action =
  | { type: 'tick'; ms: number }
  | { type: 'ready'; playerId: number }
  | { type: 'claim'; playerId: number }
  | { type: 'move'; playerId: number; x: number; y: number }
  | { type: 'interact'; playerId: number }
  | { type: 'endTurn'; playerId: number }
  | { type: 'sellPlot'; playerId: number; plot: number | null }
  | { type: 'auctionRole'; playerId: number; role: 'buyer' | 'seller' }
  | { type: 'auctionMove'; playerId: number; dir: -1 | 0 | 1 }
  | { type: 'landBid'; playerId: number; raising: boolean };
