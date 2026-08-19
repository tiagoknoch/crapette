# Crapette

A web implementation of **Crapette** (aka Russian Bank), the two-player patience/rummy
hybrid card game. v1 targets single-player vs. a CPU opponent in the browser; online
multiplayer is planned for v2 without a rewrite of the rules engine.

Full design and rules reference: [`docs/tech-spec.md`](docs/tech-spec.md).

## Status

🚧 Early development. The rules engine and a headless validation harness are done;
rendering, AI, UI, and persistence are not built yet.

- ✅ `/src/engine` — pure game logic: deck/deal, legality rules, compulsory-move
  resolution, win/stalemate detection. Fully unit-tested with Vitest.
- ✅ `src/cli/simulate.ts` — headless CLI that plays full games with random legal
  moves, used to validate the engine before any UI exists.
- ⬜ CPU heuristic AI (`/src/ai`)
- ⬜ PixiJS rendering (`/src/render`)
- ⬜ UI / HUD (`/src/ui`)
- ⬜ Game store, autosave/resume, i18n wiring (`/src/state`)

See `docs/tech-spec.md` §14 for the full build order.

## Rules

Two standard 52-card decks, 13-card reserve variant, own-waste-pile-top-card-playable
house rule enabled, no "Stop!" honor system — the engine blocks illegal moves and
enforces compulsory moves automatically. Full canonical ruleset: `docs/tech-spec.md` §2.

## Tech stack

TypeScript, Vite, PixiJS (rendering, not wired up yet), Vitest, i18next. See
`docs/tech-spec.md` §12 for the stack and licensing rationale (everything permissively
licensed — MIT/Apache-2.0/BSD, LGPL only for the eventual card art asset).

## Getting started

```bash
npm install

# Run the engine test suite
npm run test

# Play a single random-legal-move game and print the result + move log
npm run simulate

# Batch-simulate many games to validate the engine (win/stalemate/failure summary)
npm run simulate -- --games 1000

# Vite dev server / production build (not meaningful yet — no UI exists)
npm run dev
npm run build
```

## Project structure

```
/src
  /engine   pure game logic — zero Pixi/DOM/Node dependencies, portable to a future
            server (multiplayer validation) or mobile app unchanged
  /cli      headless simulation harness (Node-only, imports only /engine)
  /ai       CPU heuristic player — not started
  /render   PixiJS scene/layout — not started
  /ui       HUD, modals — not started
  /state    game store, persistence — not started
/docs
  tech-spec.md   canonical design/rules/architecture spec
```

## License

Not yet finalized for the game's own code/assets. Third-party dependencies are all
permissively licensed (MIT/Apache-2.0); the card art asset will carry its own
LGPL-2.1 attribution once chosen (see `docs/tech-spec.md` §12) and will be credited
in-app via an About/Legal page, per that section.
