import { MAP_COLS, MAP_ROWS, TOWN_COL, TOWN_INDEX, TOWN_ROW } from './constants';
import { chance, int, next, type RngState } from './rng';
import type { Plot, Terrain } from './types';

export function plotIndex(col: number, row: number): number {
  return row * MAP_COLS + col;
}

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < MAP_COLS && row >= 0 && row < MAP_ROWS;
}

/** Orthogonal neighbours. */
export function neighbours(index: number): number[] {
  const col = index % MAP_COLS;
  const row = Math.floor(index / MAP_COLS);
  const out: number[] = [];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (inBounds(col + dc, row + dr)) out.push(plotIndex(col + dc, row + dr));
  }
  return out;
}

export function isMountain(t: Terrain): boolean {
  return t === 'mountain1' || t === 'mountain2' || t === 'mountain3';
}

/**
 * The planet Irata: a 9x5 grid with the river running down the middle column,
 * the town at its centre, mountains scattered on both sides, and hidden
 * crystite deposits clustered around a few hot spots.
 */
export function generateMap(rng: RngState): Plot[] {
  const plots: Plot[] = [];
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      let terrain: Terrain = 'plain';
      if (col === TOWN_COL) terrain = row === TOWN_ROW ? 'town' : 'river';
      plots.push({ index: plotIndex(col, row), col, row, terrain, crystite: 0, owner: null, mule: null, lastProduction: null });
    }
  }

  // Mountains: 8-11 of them, never on the river, balanced between the halves.
  const mountainCount = int(rng, 8, 11);
  let placed = 0;
  let guard = 0;
  while (placed < mountainCount && guard++ < 500) {
    const col = int(rng, 0, MAP_COLS - 1);
    const row = int(rng, 0, MAP_ROWS - 1);
    const p = plots[plotIndex(col, row)]!;
    if (p.terrain !== 'plain') continue;
    const leftCount = plots.filter((q) => q.col < TOWN_COL && isMountain(q.terrain)).length;
    const rightCount = plots.filter((q) => q.col > TOWN_COL && isMountain(q.terrain)).length;
    if (col < TOWN_COL && leftCount > rightCount + 1) continue;
    if (col > TOWN_COL && rightCount > leftCount + 1) continue;
    const r = next(rng);
    p.terrain = r < 0.45 ? 'mountain1' : r < 0.8 ? 'mountain2' : 'mountain3';
    placed++;
  }

  // Crystite: a few hot spots of level 4, falling off with distance.
  const spots = int(rng, 3, 4);
  for (let i = 0; i < spots; i++) {
    let idx: number;
    do idx = int(rng, 0, plots.length - 1);
    while (idx === TOWN_INDEX);
    seedCrystite(plots, idx, rng);
  }
  plots[TOWN_INDEX]!.crystite = 0;
  return plots;
}

/** Place a deposit centred on `centre`, used by map generation and meteorite strikes. */
export function seedCrystite(plots: Plot[], centre: number, rng: RngState): void {
  const c0 = centre % MAP_COLS;
  const r0 = Math.floor(centre / MAP_COLS);
  for (const p of plots) {
    if (p.terrain === 'town') continue;
    const d = Math.max(Math.abs(p.col - c0), Math.abs(p.row - r0));
    let level = 0;
    if (d === 0) level = 4;
    else if (d === 1) level = chance(rng, 0.5) ? 3 : 2;
    else if (d === 2) level = chance(rng, 0.6) ? 1 : 0;
    if (level > p.crystite) p.crystite = level;
  }
}

export function crystiteLabel(level: number): string {
  return ['None', 'Low', 'Medium', 'High', 'Very high'][level] ?? 'None';
}
