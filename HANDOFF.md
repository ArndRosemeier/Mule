# Handoff

State as of 2026-10-14: v1 single-player game is complete and playable
(beginner, standard, tournament), with generated art and music.

## Architecture

- **Core (`src/core`)**: plain JSON `GameState` + `applyAction(state, action)`
  / `dispatch` (pure copy). No DOM, no `Math.random`, no clock: randomness
  comes from the seeded RNG stored in the state, time advances only through
  `{ type: 'tick', ms: 50 }` actions. Same seed + same action log = same game.
  - `game.ts` round flow and the reducer, `development.ts` the timed turn
    (movement, doors, install, pub, assay, wampus), `production.ts`,
    `auction.ts` (goods auction), `land.ts` (grant + land auctions),
    `events.ts`, `economy.ts` (prices, scoring), `town.ts` (shared town
    geometry), `ai.ts` (computer players, run inside the reducer on every
    tick, so they are deterministic too).
- **UI (`src/ui`)**: `app.ts` screens (title, setup, help, sound), `gameview.ts`
  the in-game screen (HUD, overlays per phase, input, event → sound/FX),
  `renderer.ts` canvas drawing for map, town and auction floor, `audio.ts`
  music crossfades + synthesized SFX, `session.ts` the session abstraction.
- **Multiplayer path**: `Session` is the seam. A networked session would send
  each local player's actions to a host that orders them with ticks and
  broadcasts the log; every client runs `applyAction` identically. Player
  input is already per `playerId`; only `localPlayers` changes.

## Testing

- `npm test`: rule tests plus whole AI games (determinism, all difficulties).
- `npm run e2e`: Playwright bot plays a whole game through the UI at `?speed=8`
  (reads `window.__mule` to decide, acts only with keyboard and pointer) and
  fails on console errors or if the game doesn't reach game over.

## Next ideas

- Hot-seat / online multiplayer on top of `Session`.
- More AI personality (collusion in auctions, wampus hunting).
- Music loops are not seamless; tracks restart just before their fade-out.
