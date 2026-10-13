# M.U.L.E. — Colony of Irata

A faithful TypeScript remake of the 1983 classic M.U.L.E., with generated
painted art, an original soundtrack and a modern UI. Single player against
three computer colonists; the engine is built for multiplayer later.

```
npm install
npm run dev        # play at http://localhost:5173
npm test           # rules tests (vitest)
npm run build      # production build in dist/
npm run e2e        # bot plays a whole game through the UI (needs `npm run preview` running)
```

Controls: arrow keys / WASD to walk, Space to act (claim, install, continue),
↑/↓ in auctions, E to end your turn, F to fast-forward computer turns, Esc to
pause. Mouse and touch work too: click to walk, tap your plot to install.

- `src/core` — deterministic rules engine and computer players (no DOM).
- `src/ui` — canvas renderer, HTML overlays, audio, input.
- `docs/RULES.md` — the rules and numbers as implemented.
- `tools/assets` — how the art and music were generated (OpenRouter).
- `HANDOFF.md` — architecture notes and what's next.
