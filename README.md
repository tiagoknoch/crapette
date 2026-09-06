# Crapette

A web implementation of **Crapette** (aka Russian Bank), the two-player patience/rummy
hybrid card game. v1 is single-player vs. a CPU opponent in the browser; online
multiplayer is planned for v2 without a rewrite of the rules engine.

Full design and rules reference: [`docs/tech-spec.md`](docs/tech-spec.md). Detailed
build history (what was built, in what order, and why) is in
[`docs/build-log.md`](docs/build-log.md); investigated gotchas and non-bugs are in
[`docs/known-issues.md`](docs/known-issues.md).

## Status

Feature-complete v1 — playable end-to-end in the browser.

- ✅ `/src/engine` — pure game logic: deck/deal, legality rules, compulsory-move
  resolution, win/stalemate detection. Fully unit-tested with Vitest.
- ✅ `/src/ai` — rule-based CPU heuristic opponent.
- ✅ `src/cli/simulate.ts` — headless CLI that plays full games (random or heuristic
  policy on either side), used to validate the engine/AI without any UI.
- ✅ `/src/render` — PixiJS rendering: tap-to-select and drag-and-drop input, tweened
  card moves/flips, pile-count badges, end screen, New Game/How to Play/language/
  About modals. No separate `/src/ui` directory — it all lives in
  `src/render/pixi/scene.ts`.
- ✅ `/src/state` — the game store (`gameStore.ts`), CPU auto-play driver, and
  localStorage autosave/resume.
- ✅ `/src/i18n` — English + Portuguese, with a manual in-app language switcher.

See `docs/tech-spec.md` §14 for the original build order, and `docs/build-log.md` for
what actually happened at each step (including several deliberate deviations from the
spec's original text — see `CLAUDE.md`'s "Things that deviate from tech-spec.md"
section for the short version).

## Rules

Two standard 52-card decks (each shuffled/dealt independently), 13-card reserve
variant, own-waste-pile-top-card-playable house rule enabled, no "Stop!" honor
system — the engine blocks illegal moves and enforces compulsory moves automatically.
Full canonical ruleset: `docs/tech-spec.md` §2. In-app "How to Play" reference is also
available from the game's footer.

## Tech stack

TypeScript, Vite, PixiJS (rendering), Vitest (tests), i18next (English/Portuguese),
`@vercel/analytics` (Web Analytics, via the framework-agnostic `inject()` — this is a
Vite app, not Next.js, so the `/next`/`/react` component doesn't apply; requires Web
Analytics to be enabled for the project in the Vercel dashboard, otherwise it's a no-op
in dev/anywhere not deployed there). See `docs/tech-spec.md` §12 for the stack and
licensing rationale. Everything is
permissively licensed (MIT/Apache-2.0/BSD) except the vendored card art
(`public/cards/`, from `htdebeer/SVG-cards`, LGPL-2.1 — credited in-app via the
About/Legal modal, per §12).

## Getting started

```bash
npm install

# Run the engine test suite
npm run test

# Play a single random-legal-move game and print the result + move log
npm run simulate

# Batch-simulate many games to validate the engine (win/stalemate/failure summary)
npm run simulate -- --games 1000

# Same, but with the CPU heuristic instead of random-legal-move on either/both sides
npm run simulate -- --games 1000 --heuristic-cpu

# Vite dev server / production build — the actual playable game
npm run dev
npm run build
```

## Project structure

```
/src
  /engine   pure game logic — zero Pixi/DOM/Node dependencies, portable to a future
            server (multiplayer validation) or mobile app unchanged
  /ai       rule-based CPU heuristic player
  /cli      headless simulation harness (Node-only, imports only /engine and /ai)
  /render   PixiJS scene/layout, all HUD/modal UI (no separate /src/ui directory)
  /state    game store, CPU auto-play driver, localStorage persistence
  /i18n     i18next setup + English/Portuguese locale resources
/docs
  tech-spec.md     canonical design/rules/architecture spec
  build-log.md     chronological build history and rationale
  known-issues.md  investigated gotchas and confirmed non-bugs
```

## License

MIT — see [`LICENSE`](LICENSE). Third-party dependencies are all permissively
licensed (MIT/Apache-2.0); the vendored card art (`public/cards/`) carries its own
LGPL-2.1 attribution (see `docs/tech-spec.md` §12 and `public/cards/CREDIT.md`) and is
credited in-app via the About/Legal modal, per that section.
