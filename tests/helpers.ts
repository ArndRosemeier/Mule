import { applyAction, createGame, TICK_MS } from '../src/core';
import type { Difficulty, GameState, PlayerSetup } from '../src/core';

export const AI4: PlayerSetup[] = [
  { name: 'Ada', species: 'mechtron', ai: 'normal' },
  { name: 'Bo', species: 'flapper', ai: 'hard' },
  { name: 'Cy', species: 'humanoid', ai: 'easy' },
  { name: 'Di', species: 'bonzoid', ai: 'normal' },
];

export function newAIGame(seed = 1, difficulty: Difficulty = 'standard', rounds?: number): GameState {
  return createGame(AI4, { seed, difficulty, rounds });
}

/** Tick until `until` is true or the tick budget runs out. Returns ticks used. */
export function run(state: GameState, until: (s: GameState) => boolean, maxTicks = 400_000): number {
  let n = 0;
  while (!until(state) && n < maxTicks) {
    applyAction(state, { type: 'tick', ms: TICK_MS });
    n++;
  }
  return n;
}
