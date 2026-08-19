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

Engine-first build (§14 steps 1–4) is complete and committed (initial commit
`e730ce7`): `/src/engine` (types, deck, rules, moveResolver, engine, winCheck) plus
the headless CLI harness at `src/cli/simulate.ts`, all covered by Vitest (73 tests
passing). Validated with `npm run simulate -- --games 5000` (~70s, 0 unexpected
failures, 104-card conservation checked after every move).

Nothing under `/src/ai`, `/src/render`, `/src/ui`, or `/src/state` exists yet — no
rendering, no CPU heuristic AI, no persistence, no i18n wiring. `main.ts`/`index.html`
are still the unmodified Vite scaffold. **Next up per §14: step 5, `cpuPlayer.ts`**,
tested against the `simulate.ts` harness (swap the harness's random choices for the
heuristic where useful), then step 6 (static PixiJS rendering of a `GameState`
snapshot, no interaction yet).

The engine/CLI code is still young — fields or functions with no usages elsewhere in
the repo are safe to add, rename, or remove as the implementation is worked out; this
isn't yet a stable public API with external callers to preserve compatibility for.

### Known non-bug: rare simulate.ts "failure" on seed 3925 (and similar)

`npm run simulate -- --games 5000` will very occasionally (~1-in-5000 seeds) report a
game exceeding `MAX_MOVES_PER_GAME` in `src/cli/simulate.ts`. Investigated and
confirmed **not an engine bug**: with two decks in play, a card can legally
ping-pong forever between two houses whose top cards are two different copies of the
same rank+color (e.g. 5♥ onto either of two black 6s, then back — both directions
legal under the alternating-color rule, returning to the exact same board state). A
uniform-random bot can rarely get stuck oscillating in such a pair. Confirmed via a
throwaway script that re-ran the capped seed with periodic state-signature logging —
the signature repeated exactly every ~2000 moves. Don't "fix" this by making the
harness smarter; it's deliberately dumb/uniform-random per the brief. If it starts
happening much more often than ~1-in-thousands, that would be worth re-investigating.

## Local environment note

`.claude/settings.local.json` (gitignored, not committed) disables the
`symphony-enablement` plugin's PreToolUse CLAUDE.md-conventions-check hook for this
project — it's a global plugin enabled in the user's `~/.claude/settings.json` and was
firing (sometimes blocking) on every Edit/Write. This override only takes effect for a
session actually rooted at this directory, not one rooted at a parent folder.

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
