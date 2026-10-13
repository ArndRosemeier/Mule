/**
 * The development phase: each colonist in turn gets a timed walk through the
 * town (buy and outfit a MULE, visit the pub, assay office, land office) and
 * across the map (install MULEs, take soil samples, hunt the wampus).
 */
import {
  DEV_TIME_FULL, DEV_TIME_MIN, MAP_COLS, OUTFIT_COST, PERSONAL_EVENT_CHANCE, PLOT_H, PLOT_W, PUB_MAX,
  PUB_ROUND_BONUS, SCENE_H, SCENE_W, TOWN_INDEX, WALK_SPEED_MAP, WALK_SPEED_TOWN, WAMPUS_BONUS, foodRequired,
} from './constants';
import { rollPersonalEvent, moveWampus } from './events';
import { crystiteLabel } from './map';
import { int } from './rng';
import { emit } from './state';
import { TOWN_START, clampTown, doorAt, inTownRect, townEntryFrom, townExitOnMap, STREET_BOTTOM, STREET_TOP, building } from './town';
import type { DevTurn, DoorKind, GameState, Phase, Player, Resource, Vec } from './types';

type DevPhase = Extract<Phase, { kind: 'development' }>;

export const INTRO_AI_MS = 1600;
export const DONE_MS = 1800;

/** Begin a player's turn: they eat, luck strikes, and the clock is set. */
export function createDevTurn(state: GameState, player: Player): DevTurn {
  const need = foodRequired(state.round);
  const eaten = Math.min(need, player.goods.food);
  player.goods.food -= eaten;
  player.foodUsed = eaten;
  const timeTotal = eaten >= need ? DEV_TIME_FULL : Math.round(DEV_TIME_MIN + ((DEV_TIME_FULL - DEV_TIME_MIN) * eaten) / need);

  let message: string | null = null;
  const luck = rollPersonalEvent(state, player, state.config.difficulty === 'beginner' ? PERSONAL_EVENT_CHANCE * 0.7 : PERSONAL_EVENT_CHANCE);
  if (luck) {
    message = luck.text;
    emit(state, { type: 'personal', playerId: player.id, text: luck.text, good: luck.good });
  }
  if (eaten < need) {
    const hunger = eaten === 0 ? 'You have no food, so you have very little time.' : `You are short of food (${eaten} of ${need}), so you have less time.`;
    message = message ? `${message}\n${hunger}` : hunger;
  }

  return {
    playerId: player.id,
    stage: 'intro',
    stageTimer: INTRO_AI_MS,
    timeLeft: timeTotal,
    timeTotal,
    scene: 'town',
    pos: { ...TOWN_START },
    facing: 1,
    input: { x: 0, y: 0 },
    waypoints: [],
    aiGoal: null,
    mule: null,
    sample: null,
    inDoor: null,
    menu: null,
    wampusCaught: false,
    message,
    endReason: null,
  };
}

export function newWampus(state: GameState): DevPhase['wampus'] {
  const plot = moveWampus(state);
  return plot === null ? null : { plot, visible: false, timer: int(state.rng, 1500, 4000) };
}

export function plotAt(pos: Vec): number {
  const col = Math.min(Math.max(Math.floor(pos.x / PLOT_W), 0), MAP_COLS - 1);
  const row = Math.min(Math.max(Math.floor(pos.y / PLOT_H), 0), 4);
  return row * MAP_COLS + col;
}

export function plotCentre(index: number): Vec {
  return { x: (index % MAP_COLS) * PLOT_W + PLOT_W / 2, y: Math.floor(index / MAP_COLS) * PLOT_H + PLOT_H / 2 };
}

function say(turn: DevTurn, text: string) {
  turn.message = text;
}

export function endTurn(state: GameState, turn: DevTurn, reason: DevTurn['endReason']): void {
  if (turn.stage !== 'active') return;
  turn.stage = 'done';
  turn.stageTimer = DONE_MS;
  turn.endReason = reason;
  turn.input = { x: 0, y: 0 };
  turn.waypoints = [];
  turn.menu = null;
  if (turn.mule) {
    turn.mule = null;
    emit(state, { type: 'muleLost', playerId: turn.playerId, reason: 'Your MULE wandered off when your time ran out.' });
    say(turn, 'Time is up. Your MULE wandered off and is lost.');
  } else if (reason === 'time') {
    say(turn, 'Time is up.');
  }
}

/** Advance the active turn by `ms`: clock, movement, doors, exits, wampus. */
export function tickDevTurn(state: GameState, phase: DevPhase, ms: number): void {
  const turn = phase.turn;
  turn.timeLeft = Math.max(0, turn.timeLeft - ms);
  if (turn.timeLeft === 0) {
    endTurn(state, turn, 'time');
    return;
  }
  if (!turn.menu) move(state, turn, ms);
  if (phase.wampus) tickWampus(state, phase, ms);
}

function move(state: GameState, turn: DevTurn, ms: number): void {
  let dir = { ...turn.input };
  const wp = turn.waypoints[0];
  if (wp) {
    const dx = wp.x - turn.pos.x;
    const dy = wp.y - turn.pos.y;
    const d = Math.hypot(dx, dy);
    const step = ((turn.scene === 'town' ? WALK_SPEED_TOWN : WALK_SPEED_MAP) * ms) / 1000;
    if (d <= step) {
      dir = { x: 0, y: 0 };
      turn.pos = { x: wp.x, y: wp.y };
      turn.waypoints.shift();
    } else {
      dir = { x: dx / d, y: dy / d };
    }
  }
  const len = Math.hypot(dir.x, dir.y);
  if (len > 1) dir = { x: dir.x / len, y: dir.y / len };
  if (dir.x > 0.05) turn.facing = 1;
  else if (dir.x < -0.05) turn.facing = -1;
  const speed = turn.scene === 'town' ? WALK_SPEED_TOWN : WALK_SPEED_MAP;
  const next = { x: turn.pos.x + (dir.x * speed * ms) / 1000, y: turn.pos.y + (dir.y * speed * ms) / 1000 };

  if (turn.scene === 'town') {
    if (next.x <= 0 || next.x >= SCENE_W) {
      turn.scene = 'map';
      turn.pos = townExitOnMap(next.x <= 0 ? 'west' : 'east');
      turn.inDoor = null;
      turn.waypoints = [];
      turn.input = { x: 0, y: 0 };
      return;
    }
    turn.pos = clampTown(next);
    const door = doorAt(turn.pos);
    if (door && door !== turn.inDoor) {
      turn.inDoor = door;
      enterDoor(state, turn, door);
      // Pop back out onto the street, as if stepping out of the shop.
      const b = building(door);
      turn.pos = { x: turn.pos.x, y: b.side === 'top' ? STREET_TOP + 22 : STREET_BOTTOM - 22 };
      turn.waypoints = [];
      turn.inDoor = null;
      // Stop walking: the player has to press again to go anywhere.
      turn.input = { x: 0, y: 0 };
    }
  } else {
    const clamped = { x: Math.min(Math.max(next.x, 4), SCENE_W - 4), y: Math.min(Math.max(next.y, 4), SCENE_H - 4) };
    if (inTownRect(clamped)) {
      turn.scene = 'town';
      turn.pos = townEntryFrom(turn.pos);
      turn.waypoints = [];
      turn.input = { x: 0, y: 0 };
      return;
    }
    turn.pos = clamped;
  }
}

function tickWampus(state: GameState, phase: DevPhase, ms: number): void {
  const w = phase.wampus!;
  const turn = phase.turn;
  w.timer -= ms;
  if (w.timer <= 0) {
    if (w.visible) {
      w.visible = false;
      w.timer = int(state.rng, 2000, 5500);
      const moved = moveWampus(state);
      if (moved !== null) w.plot = moved;
    } else {
      w.visible = true;
      w.timer = state.config.difficulty === 'tournament' ? 650 : 900;
    }
  }
  if (!w.visible || turn.wampusCaught || turn.scene !== 'map') return;
  const c = plotCentre(w.plot);
  if (Math.hypot(turn.pos.x - c.x, turn.pos.y - c.y) < 30) {
    const player = state.players[turn.playerId]!;
    const amount = WAMPUS_BONUS[Math.min(state.round, WAMPUS_BONUS.length) - 1]!;
    player.money += amount;
    turn.wampusCaught = true;
    w.visible = false;
    w.timer = 999_999;
    emit(state, { type: 'wampus', playerId: player.id, amount });
    say(turn, `You caught the mountain wampus! The colony pays a $${amount} bounty.`);
  }
}

const SHOP_NAMES: Record<Resource, string> = { food: 'food', energy: 'energy', smithore: 'smithore', crystite: 'crystite' };

function enterDoor(state: GameState, turn: DevTurn, door: DoorKind): void {
  const player = state.players[turn.playerId]!;
  const store = state.store;
  switch (door) {
    case 'corral': {
      if (turn.mule) {
        // Return the MULE for a refund of its price (outfitting is not refunded).
        player.money += store.mulePrice;
        store.mules += 1;
        turn.mule = null;
        say(turn, `You returned your MULE to the corral for $${store.mulePrice}.`);
        return;
      }
      if (store.mules <= 0) return say(turn, 'The corral is empty. No MULEs left to buy.');
      if (player.money < store.mulePrice) return say(turn, `A MULE costs $${store.mulePrice}. You can't afford one.`);
      player.money -= store.mulePrice;
      store.mules -= 1;
      turn.mule = { outfit: null };
      emit(state, { type: 'buyMule', playerId: player.id, price: store.mulePrice });
      return say(turn, `You bought a MULE for $${store.mulePrice}. Now outfit it at a shop.`);
    }
    case 'food':
    case 'energy':
    case 'smithore':
    case 'crystite': {
      if (door === 'crystite' && state.config.difficulty === 'beginner') return say(turn, 'The crystite shop is closed in beginner games.');
      if (!turn.mule) return say(turn, `You need a MULE before you can outfit it for ${SHOP_NAMES[door]}.`);
      if (turn.mule.outfit === door) return say(turn, `Your MULE is already outfitted for ${SHOP_NAMES[door]}.`);
      const cost = OUTFIT_COST[door];
      if (player.money < cost) return say(turn, `Outfitting for ${SHOP_NAMES[door]} costs $${cost}. You can't afford it.`);
      player.money -= cost;
      turn.mule.outfit = door;
      emit(state, { type: 'outfit', playerId: player.id, resource: door, cost });
      return say(turn, `Your MULE is outfitted for ${SHOP_NAMES[door]} ($${cost}). Lead it to one of your plots.`);
    }
    case 'pub': {
      if (turn.mule) return say(turn, 'No MULEs allowed in the pub!');
      const bonus = PUB_ROUND_BONUS[Math.min(state.round, PUB_ROUND_BONUS.length) - 1]!;
      const secs = Math.floor(turn.timeLeft / 1000);
      const amount = Math.min(PUB_MAX, bonus + int(state.rng, 0, secs * 4));
      player.money += amount;
      emit(state, { type: 'pub', playerId: player.id, amount });
      say(turn, `You gambled at the pub and won $${amount}.`);
      endTurn(state, turn, 'pub');
      return;
    }
    case 'assay': {
      if (turn.sample === null) return say(turn, 'Bring a soil sample from a plot to have it assayed.');
      const level = state.map[turn.sample]!.crystite;
      if (!player.assayed.includes(turn.sample)) player.assayed.push(turn.sample);
      emit(state, { type: 'assay', playerId: player.id, plot: turn.sample, level });
      say(turn, `Assay result: ${crystiteLabel(level).toLowerCase()} crystite.`);
      turn.sample = null;
      return;
    }
    case 'land': {
      const owned = state.map.filter((p) => p.owner === player.id);
      if (!owned.length) return say(turn, 'You own no land to sell.');
      turn.menu = 'land';
      return say(turn, 'Which plot would you like to put up for auction?');
    }
  }
}

/** The action button on the map: install a MULE or take a soil sample. */
export function interact(state: GameState, turn: DevTurn): void {
  if (turn.stage !== 'active' || turn.scene !== 'map' || turn.menu) return;
  const index = plotAt(turn.pos);
  if (index === TOWN_INDEX) return;
  const plot = state.map[index]!;
  const player = state.players[turn.playerId]!;
  if (turn.mule) {
    if (plot.owner !== player.id) {
      turn.mule = null;
      emit(state, { type: 'muleLost', playerId: player.id, reason: 'released on land you do not own' });
      return say(turn, "That isn't your land! Your MULE broke loose and ran away.");
    }
    if (!turn.mule.outfit) {
      turn.mule = null;
      emit(state, { type: 'muleLost', playerId: player.id, reason: 'not outfitted' });
      return say(turn, 'Your MULE had no outfit, got confused and ran away.');
    }
    const previous = plot.mule;
    plot.mule = turn.mule.outfit;
    plot.lastProduction = null;
    emit(state, { type: 'install', playerId: player.id, plot: index, resource: plot.mule });
    if (previous) {
      turn.mule = { outfit: previous };
      return say(turn, `MULE installed. You now lead the ${previous} MULE that was there.`);
    }
    turn.mule = null;
    return say(turn, `MULE installed for ${plot.mule} production.`);
  }
  turn.sample = index;
  say(turn, 'You took a soil sample. Bring it to the assay office.');
}

/** Land office: put a plot up for auction at the start of next round. */
export function sellPlot(state: GameState, turn: DevTurn, plot: number | null): void {
  if (turn.menu !== 'land') return;
  turn.menu = null;
  if (plot === null) return say(turn, 'Maybe another time.');
  const p = state.map[plot];
  if (!p || p.owner !== turn.playerId) return;
  if (state.landForSale.some((s) => s.plot === plot)) return say(turn, 'That plot is already up for auction.');
  state.landForSale.push({ plot, seller: turn.playerId });
  say(turn, 'Your plot will be auctioned at the start of next round.');
}
