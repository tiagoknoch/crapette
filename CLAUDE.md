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
moveResolver, engine, winCheck) plus the headless CLI harness at `src/cli/simulate.ts`.
Step 5, `src/ai/cpuPlayer.ts` (the §7 rule-based CPU heuristic), is also complete, with
`simulate.ts` extended with `--heuristic-human`/`--heuristic-cpu` flags so either or
both sides can run the heuristic instead of the original random bot.

Step 6 is also complete: `/src/render` (`layout.ts` + `pixi/cardSprites.ts` +
`pixi/scene.ts`) renders a static `GameState` snapshot via PixiJS, letterboxed/rescaled
to fit any viewport (no drag/drop or tap interaction yet — that's step 7). `main.ts`
deals a fixed-seed game and renders it. 84 Vitest tests passing (render code has no
tests yet — it's layout/visual, not logic worth unit-testing the way the engine is).

**The actual tableau shape deviates from docs/tech-spec.md §5.** Per direct user
direction (citing Russian Bank's traditional physical layout — see the Wikipedia
article's setup photo), the table is NOT the spec's 5-horizontal-band layout. It's
instead: each player's talon/waste/reserve as a 3-slot row (mirrored between the two
players, like the physical game), and a 4×4 middle grid — one player's 4 houses as a
vertical column, the 8 foundations as a 4×2 block, the other player's 4 houses as a
vertical column. See the comment block at the top of `src/render/layout.ts` for the
exact geometry. If §5's text is ever consulted for render work, prefer what's actually
implemented in `layout.ts` — the spec doc itself hasn't been edited to match.

Card art is vendored from `htdebeer/SVG-cards` (LGPL-2.1) into `public/cards/` — see
`public/cards/CREDIT.md`. Each player's face-down piles use a different back color
(human=blue, cpu=red, purely cosmetic, see `PLAYER_BACK_COLOR` in `cardSprites.ts`).
Talon/waste/reserve piles draw a few cheap filler layers behind the top card to hint at
pile depth (`stackDepthLayers` in `scene.ts`) — an impression, not an exact count.

Nothing under `/src/ui` or `/src/state` exists yet — no drag/drop, no persistence, no
i18n wiring, no HUD. **Next up per §14: step 7**, drag-and-drop + tap-to-select input
wired to the engine, with legal-destination highlighting and compulsory-move gating.

The engine/AI/CLI/render code is still young — fields or functions with no usages
elsewhere in the repo are safe to add, rename, or remove as the implementation is
worked out; this isn't yet a stable public API with external callers to preserve
compatibility for.

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

### Known non-bug: rare simulate.ts "failure" on seed 885 with `--heuristic-human --heuristic-cpu`

Same `MAX_MOVES_PER_GAME` cap, same ~1-in-5000 rarity, different mechanism, and
**only reachable in this specific harness configuration** — running the deterministic
`cpuPlayer.ts` heuristic on *both* sides at once. Investigated: the two fully
deterministic policies can lock into a repeating macro-cycle spanning a full
hand/waste rotation (e.g. one side draws a card, plays it to one of its own houses,
then discards its next draw ending the turn; the other side immediately loads that
exact card off the house onto the first side's own waste pile and passes; repeat for
the next card in hand, and so on until the hand/waste reshuffles and the identical
sequence recurs) — confirmed via a throwaway script logging the move sequence leading
into the cap. `--heuristic-cpu` alone and `--heuristic-human` alone are each clean
across 5000 seeds (0 failures) — this cycle needs *both* sides playing the exact same
deterministic policy with no randomness anywhere to break the symmetry, which never
happens in actual v1 play (the human side is a real person, not a second copy of the
CPU's policy). Don't chase this with more scoring heuristics in `cpuPlayer.ts` or add
cycle-detection machinery for a configuration the shipped game never exercises;
`--heuristic-human --heuristic-cpu` remains available in the harness for CPU-heuristic
regression testing, just expect this same ~1-in-5000 rate.

## Local environment note

`.claude/settings.local.json` (gitignored, not committed) disables the
`symphony-enablement` plugin's PreToolUse CLAUDE.md-conventions-check hook for this
project — it's a global plugin enabled in the user's `~/.claude/settings.json` and was
firing (sometimes blocking) on every Edit/Write. This override only takes effect for a
session actually rooted at this directory, not one rooted at a parent folder.

## Commands

- `npm run test` — run the Vitest suite (engine only, for now).
- `npm run simulate -- --games <n>` — headless simulation via `src/cli/simulate.ts`;
  the fastest way to shake out engine/AI bugs. Defaults to 1 game (prints the final
  state and move log); pass `--games 1000`+ for a batch summary (win/stalemate/failure
  counts, a 104-card conservation check after every move). Both sides play the
  original random-legal-move bot by default; add `--heuristic-human` and/or
  `--heuristic-cpu` to switch either side to `src/ai/cpuPlayer.ts`'s §7 heuristic
  instead (see the "known non-bug" notes below before running both flags together).
- `npm run dev` / `npm run build` — Vite dev server / production build. Renders a
  fixed-seed static `GameState` snapshot (§14 step 6); no interaction yet since
  `/src/ui` doesn't exist.

## Conventions

- No TS `enum` — use string-literal union types (`erasableSyntaxOnly` is set in
  `tsconfig.json`), matching the spec's data model style.
- Vitest tests are colocated next to the module they test (`foo.ts` + `foo.test.ts`).
- The CLI harness (`src/cli/simulate.ts`) imports only from `/src/engine` and
  `/src/ai` — no rendering/UI code.
- `src/render/layout.ts` is pure geometry with zero Pixi imports (mirrors the
  `/src/engine` purity rule, one level down); actual PixiJS usage is confined to
  `src/render/pixi/`.
