/**
 * Small, fast, deterministic PRNG (mulberry32) whose entire state is a single
 * 32-bit integer, so it serializes trivially inside the game state. Every
 * random decision in the core goes through this so that a game replays
 * identically from the same seed and action log (needed for multiplayer
 * lockstep and for tests).
 */
export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 || 0x9e3779b9 };
}

/** Uniform float in [0, 1). Advances the state. */
export function next(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function int(r: RngState, min: number, max: number): number {
  return min + Math.floor(next(r) * (max - min + 1));
}

export function chance(r: RngState, p: number): boolean {
  return next(r) < p;
}

export function pick<T>(r: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[Math.floor(next(r) * items.length)]!;
}

export function shuffle<T>(r: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next(r) * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** Pick from weighted entries. */
export function weighted<T>(r: RngState, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = next(r) * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x < 0) return v;
  }
  return entries[entries.length - 1]![0];
}
