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

Step 7 is also complete: `src/state/gameStore.ts` owns the mutable `GameState`, the
current selection, and a transient rejection "flash". `handleSlotClick` is the single
entry point every pile click resolves through — click a card to pick it up, click a
destination to attempt the move, click your own waste while a drawn hand card is
selected to discard it. Draw is just clicking your own face-down talon.

**Input is deliberately reactive-only, per direct user direction — not what
tech-spec.md §6 describes.** §6 says legal destinations should be highlighted on
drag-start and illegal ones rejected on drop. Instead: nothing is ever highlighted or
pre-disabled (no legal-move hints, no greyed-out draw button) — every action is
attempted, and only rejected attempts get feedback (a red flash on the attempted
destination + a reason banner at the top, ~900ms, see `REASON_TEXT` in
`gameStore.ts`). Finding the play is the player's job; a hint-mode toggle is a
plausible future option but isn't built. Every slot is clickable via Pixi's
`pointertap` — including empty ones (an invisible hit-zone) and, for a house, the
*actual* top card's current sprite specifically (not a fixed base rectangle — see the
house-fan note below for why that distinction matters).

Step 8 is also complete: CPU-side automatic play is wired in via `cpuStep()` in
`gameStore.ts`, driven by a `setInterval(cpuStep, 700)` in `main.ts`. `cpuStep` performs
exactly one discrete action per call (one move, one draw, or resolving the just-drawn
card) using `cpuPlayer.ts`'s existing `chooseMove`/`chooseCompulsoryMove`/
`chooseOptionalMove` — mirroring `simulate.ts`'s `playHeuristicStep` logic but split into
single-action beats so each CPU action is independently visible rather than an entire
turn resolving in one frame. It's a no-op whenever it isn't actually the CPU's turn, so
the interval can just tick unconditionally for the page's whole lifetime. `handleSlotClick`
now also ignores clicks outright unless `state.turn === 'human'` — only the human seat is
click-driven; the CPU seat never was reachable via a real click anyway (there's no "CPU
plays as if clicked" concept), this just makes that explicit instead of relying on nobody
clicking during the CPU's turn.

`gameStore.ts` also logs every action to the browser console (prefixed `[crapette]`
— selections, applied moves, rejections with their reason, draws, discards, passes,
game-over) since there's no in-app HUD/move-log yet to see what happened during manual
testing.

**Fixed a real dealing bug found via manual play-testing**: `deck.ts` used to build one
combined 104-card pool and shuffle it as a whole before splitting 52/52 — per real
Crapette/Russian Bank rules (confirmed via the Wikipedia article, which the tech spec
had gotten wrong at §2), each player shuffles and deals from their **own** independent
52-card deck. The old approach could deal a single player two copies of the same
card, which is impossible with real decks. `deck.ts` now has `buildStandardDeck(copy)`
(52 unique cards) instead of `buildTwoDeckPool()`, and `deal(random)` shuffles two of
them independently — `docs/tech-spec.md` §2 has been corrected to match. A same-rank
duplicate can still legitimately appear on the shared tableau (each player's own copy,
e.g. one in a house each) — just never within one player's own reserve/houses/hand/waste.

**Houses fan horizontally, not vertically** — corrected per direct user direction to
match the Wikipedia setup photo (cards overlap sideways, outward, away from the shared
foundation columns; see `HOUSE_FAN_SIGN` in `layout.ts`). This exposed a real
interaction bug: click hit-zones used to be fixed rectangles at each slot's *base*
position, so a fanned house's actual (visually shifted) top card could sit outside its
own click target once the house held more than a couple of cards. Fixed by making the
click handler live on the top card's actual rendered sprite (or an invisible hit-zone
at the base position only when the pile is empty) instead of a static rectangle —
`scene.ts`'s `makeClickable`/`drawEmptyHitZone`.

**Drawing an unplayable card no longer auto-discards it**, per direct user direction:
it used to silently discard and end the turn the moment `settle()` in `gameStore.ts`
saw no legal move for it, which gave no sense that anything had happened. Now it just
sits there face-up; discarding is always the explicit action of clicking it then
clicking your own waste (same mechanic as the already-existing voluntary-discard
path), whether or not it happens to have a legal move. There's also now a persistent
turn indicator ("Your turn" / "CPU's turn" / game-over) drawn at the top of the table
(`turnLabel` in `scene.ts`), so a turn actually ending is visible in the game itself,
not just in the console log.

Step 9 is also complete: HUD additions live entirely in `src/render/pixi/scene.ts` (no
`/src/ui` needed for these). **Pile counts**: every non-empty pile (hand/waste/reserve/
houses/foundations) gets a small numeric badge at its base slot's bottom-right corner
(`drawCountBadge`) — an exact count, unlike `stackDepthLayers`' cosmetic depth
*impression*. **End screen**: `overlayLayer` (new field on `TableScene`, cleared/rebuilt
every `renderGameState` call like `cardsLayer`) draws a dimmed full-table overlay with the
result, both players' scores, and a "Play Again" button once `state.status !==
'in_progress'` (`drawEndScreen`); `turnText` is blanked in that state instead of also
announcing the result, to avoid saying it twice. "Play Again" calls a new `onPlayAgain`
callback threaded through `createTableScene`'s third argument — wired in `main.ts` to
`initGameStore(deal())` (genuine `Math.random()`, not the fixed dev-session seed) followed
by a direct `render()` call. **About/Legal modal**: a persistent "About / Legal" footer
link toggles a static modal (`drawAboutModal`, built once, visibility toggled) with the
§12-required credits (SVG-cards LGPL-2.1, PixiJS, Vite/TypeScript/Vitest) — this is pure
presentation with no `GameState` involvement, so it lives outside the gameStore/
`renderGameState` pipeline entirely, unlike everything else in this file. Per the
established pattern of not yet doing i18n (that's still step 10, undone), all of this HUD
text is hardcoded English, same as `REASON_TEXT`/`turnLabel` already were.

Nothing under `/src/ui` exists yet — no persistence, no i18n wiring.

The engine/AI/CLI/render/state code is still young — fields or functions with no
usages elsewhere in the repo are safe to add, rename, or remove as the implementation
is worked out; this isn't yet a stable public API with external callers to preserve
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
