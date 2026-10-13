# Handoff

Status of the M.U.L.E. remake as of the first thread (2026-10-13). Very early: only the project scaffold exists.

## Goal

A faithful TypeScript recreation of Atari M.U.L.E. (1983) with a polished modern UI. v1 is a complete, tested single-player game (1 human + 3 AI, Standard 12-round game, Beginner/Tournament as variants), architected so multiplayer can be layered on later.

## Done

- Vite 8 + TypeScript 5.9 + Vitest 5 scaffold (`npm run dev | build | test | typecheck`).
- `src/core/rng.ts`: deterministic, serializable PRNG (mulberry32; state is one uint32 kept inside game state).
- Folder layout: `src/core` (pure rules engine), `src/ui` (rendering/input), `src/audio`, `tests`.

## Intended architecture

- **Pure deterministic core** (`src/core`): plain JSON-serializable `GameState` + `dispatch(state, action)`. No DOM, no `Math.random`, no wall clock. All randomness through `rng.ts` with its state stored in `GameState`.
- **Time is an action**: real-time phases (land-grant cursor, development timer and avatar movement, auctions) advance only via `{ type: 'tick', ms }` actions at a fixed step (e.g. 50 ms). Player inputs are actions too. Same seed + same action log = same game, which gives replays, tests, and lockstep multiplayer for free.
- **AI in the core**: AI players are functions `(state, playerId) => Action[]`, deterministic, so they run identically on every client.
- **Events log in state** (sequence-numbered) so the UI can animate production results, random events, and trades without diffing state.
- **UI**: Canvas 2D for the map, town, and auction scenes (procedurally drawn art until real assets exist), HTML/CSS overlays for HUD, menus, and dialogs. Fixed-timestep loop dispatching ticks, render interpolation on top.
- Phases per round: round status → land grant → land auction (sometimes) → development (each player, timed) → production + random events → auctions (smithore, crystite, food, energy) → next round; game over after the last round with colony rating.

## Next

1. Rules spec: a background research pass on the original rules and numbers (map, species and starting money, food/time, production table, economies of scale, spoilage, events, store pricing, auction mechanics, scoring) was started; if `docs/RULES.md` is in the repo, use it, otherwise redo that research.
2. Core: types, map generation, phases, production, events, store, auction, scoring, AI. Unit tests for each rule.
3. UI and audio; generated art/sound assets via OpenRouter can replace the procedural placeholders.
