import type { GameEvent, GameState, NewEvent, Phase } from './types';

const MAX_EVENTS = 300;

/** Append an event to the log with the next sequence number. */
export function emit(state: GameState, ev: NewEvent): void {
  state.eventSeq += 1;
  state.events.push({ ...ev, seq: state.eventSeq } as GameEvent);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

export function setPhase(state: GameState, phase: Phase): void {
  state.phase = phase;
  emit(state, { type: 'phase', phase: phase.kind });
}

export function humanIds(state: GameState): number[] {
  return state.players.filter((p) => p.ai === null).map((p) => p.id);
}

/** True once every human player is in `ready` (AI players never hold things up). */
export function allHumansReady(state: GameState, ready: number[]): boolean {
  return humanIds(state).every((id) => ready.includes(id));
}

/** Small deterministic hash in [0, 1) for AI personality without touching the RNG. */
export function hash01(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
