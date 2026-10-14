/**
 * A game session drives the core with actions. The local session applies
 * them directly; a networked session can later replace it by relaying the
 * same actions to every client (the core is deterministic, so lockstep works).
 */
import { applyAction, createGame, type NewGameOptions } from '../core/game';
import type { Action, GameState, PlayerSetup } from '../core/types';

export interface Session {
  readonly state: GameState;
  /** Players controlled on this device. */
  readonly localPlayers: number[];
  send(action: Action): void;
}

const SAVE_KEY = 'mule.save.v1';

export class LocalSession implements Session {
  state: GameState;
  localPlayers: number[];

  constructor(state: GameState) {
    this.state = state;
    this.localPlayers = state.players.filter((p) => p.ai === null).map((p) => p.id);
  }

  static create(setups: PlayerSetup[], opts: NewGameOptions): LocalSession {
    return new LocalSession(createGame(setups, opts));
  }

  send(action: Action): void {
    applyAction(this.state, action);
  }

  save(): void {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch { /* storage full or blocked */ }
  }

  static load(): LocalSession | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw) as GameState;
      if (state.version !== 1 || state.phase.kind === 'gameOver') return null;
      return new LocalSession(state);
    } catch {
      return null;
    }
  }

  static hasSave(): boolean {
    return LocalSession.load() !== null;
  }

  static clearSave(): void {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
}
