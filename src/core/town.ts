/**
 * Geometry of the town scene, shared by the rules (door triggers, exits) and
 * the renderer. The street runs left to right through the middle; four
 * outfitters line the top and the corral, pub, land office and assay office
 * line the bottom. Walking off either end of the street leads back to the map.
 */
import { PLOT_H, PLOT_W, SCENE_H, SCENE_W, TOWN_COL, TOWN_ROW } from './constants';
import type { DoorKind, Vec } from './types';

export const STREET_TOP = 205;
export const STREET_BOTTOM = 295;
export const STREET_MID = (STREET_TOP + STREET_BOTTOM) / 2;
/** How far into a doorway the avatar may step (which triggers the door). */
export const DOOR_DEPTH = 18;
export const DOOR_HALF_W = 32;

export interface Building {
  kind: DoorKind;
  side: 'top' | 'bottom';
  /** Building footprint, for drawing. */
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
}

const SLOT_W = SCENE_W / 4;
const TOP_KINDS: DoorKind[] = ['food', 'energy', 'smithore', 'crystite'];
const BOTTOM_KINDS: DoorKind[] = ['corral', 'pub', 'land', 'assay'];

export const BUILDINGS: Building[] = [
  ...TOP_KINDS.map((kind, i) => ({
    kind, side: 'top' as const,
    x: i * SLOT_W + 18, y: 18, w: SLOT_W - 36, h: STREET_TOP - 18,
    doorX: i * SLOT_W + SLOT_W / 2,
  })),
  ...BOTTOM_KINDS.map((kind, i) => ({
    kind, side: 'bottom' as const,
    x: i * SLOT_W + 18, y: STREET_BOTTOM, w: SLOT_W - 36, h: SCENE_H - STREET_BOTTOM - 18,
    doorX: i * SLOT_W + SLOT_W / 2,
  })),
];

export function building(kind: DoorKind): Building {
  return BUILDINGS.find((b) => b.kind === kind)!;
}

/** Point just inside a door, used as an AI waypoint. */
export function doorPoint(kind: DoorKind): Vec {
  const b = building(kind);
  return { x: b.doorX, y: b.side === 'top' ? STREET_TOP - DOOR_DEPTH + 2 : STREET_BOTTOM + DOOR_DEPTH - 2 };
}

/** Point on the street in front of a door. */
export function doorFront(kind: DoorKind): Vec {
  return { x: building(kind).doorX, y: STREET_MID };
}

/** Which door (if any) the avatar is standing in. */
export function doorAt(pos: Vec): DoorKind | null {
  for (const b of BUILDINGS) {
    if (Math.abs(pos.x - b.doorX) > DOOR_HALF_W) continue;
    if (b.side === 'top' && pos.y < STREET_TOP - 4) return b.kind;
    if (b.side === 'bottom' && pos.y > STREET_BOTTOM + 4) return b.kind;
  }
  return null;
}

/** Keep the avatar on the street, letting it step into doorways. */
export function clampTown(pos: Vec): Vec {
  const x = Math.min(Math.max(pos.x, 0), SCENE_W);
  const nearDoor = BUILDINGS.some((b) => Math.abs(x - b.doorX) <= DOOR_HALF_W);
  const top = nearDoor ? STREET_TOP - DOOR_DEPTH : STREET_TOP;
  const bottom = nearDoor ? STREET_BOTTOM + DOOR_DEPTH : STREET_BOTTOM;
  return { x, y: Math.min(Math.max(pos.y, top), bottom) };
}

/** The town plot's rectangle on the map. */
export const TOWN_RECT = {
  x: TOWN_COL * PLOT_W, y: TOWN_ROW * PLOT_H, w: PLOT_W, h: PLOT_H,
};

export function inTownRect(p: Vec): boolean {
  return p.x > TOWN_RECT.x && p.x < TOWN_RECT.x + TOWN_RECT.w && p.y > TOWN_RECT.y && p.y < TOWN_RECT.y + TOWN_RECT.h;
}

/** Map position just outside the town on the given side. */
export function townExitOnMap(side: 'west' | 'east'): Vec {
  return { x: side === 'west' ? TOWN_RECT.x - 10 : TOWN_RECT.x + TOWN_RECT.w + 10, y: TOWN_RECT.y + TOWN_RECT.h / 2 };
}

/** Town position when entering from the map at `mapPos`. */
export function townEntryFrom(mapPos: Vec): Vec {
  const cx = TOWN_RECT.x + TOWN_RECT.w / 2;
  return { x: mapPos.x < cx ? 6 : SCENE_W - 6, y: STREET_MID };
}

export const TOWN_START: Vec = { x: SCENE_W / 2, y: STREET_MID };
