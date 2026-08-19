# Crapette

Web implementation of Crapette (Russian Bank), single-player vs CPU for v1. Full
tech spec: [`docs/tech-spec.md`](docs/tech-spec.md) — canonical source for rules (§2),
data model (§3), architecture (§4), stack/licensing (§12), and build order (§14). Read
it before making structural changes.

A few rules-engine decisions needed clarification beyond what the spec states outright
(the compulsory-move priority scope, hand/waste reshuffle timing, and stalemate scoring).
The resolutions are documented as comments directly in the relevant `src/engine/` source
(search for "§2 rule 3" and "resolution #") rather than duplicated here.

## Architecture rule (non-negotiable)

`/src/engine` is pure TypeScript: **zero imports of Pixi, the DOM, or Node-only APIs**
(no `fs`, no `process`). It exposes plain-data functions (`GameState in -> GameState
out`, or `GameState in -> Move[] out`). This is required for a future headless
server (online multiplayer validation) and a future mobile port — don't compromise
it for convenience.

## Project status

Engine-first build (§14 steps 1–4) is complete: `/src/engine` (types, deck, rules,
moveResolver, engine, winCheck) plus the headless CLI harness at `src/cli/simulate.ts`,
all covered by Vitest. Nothing under `/src/ai`, `/src/render`, `/src/ui`, or
`/src/state` exists yet — no rendering, no CPU heuristic AI, no persistence, no i18n
wiring. Those are the next build-order steps (§14 steps 5–12).

The engine/CLI code is still young — fields or functions with no usages elsewhere in
the repo are safe to add, rename, or remove as the implementation is worked out; this
isn't yet a stable public API with external callers to preserve compatibility for.

## Commands

- `npm run test` — run the Vitest suite (engine only, for now).
- `npm run simulate -- --games <n>` — headless random-legal-move simulation via
  `src/cli/simulate.ts`; the fastest way to shake out engine bugs. Defaults to 1 game
  (prints the final state and move log); pass `--games 1000`+ for a batch summary
  (win/stalemate/failure counts, a 104-card conservation check after every move).
- `npm run dev` / `npm run build` — Vite dev server / production build. Not
  meaningful yet since `/src/render` and `/src/ui` don't exist; `main.ts` is still the
  unmodified Vite scaffold.

## Conventions

- No TS `enum` — use string-literal union types (`erasableSyntaxOnly` is set in
  `tsconfig.json`), matching the spec's data model style.
- Vitest tests are colocated next to the module they test (`foo.ts` + `foo.test.ts`).
- The CLI harness (`src/cli/simulate.ts`) imports only from `/src/engine` — no
  rendering, UI, or AI-heuristic code exists yet in this build phase.
