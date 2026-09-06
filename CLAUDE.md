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

Card art is vendored from `htdebeer/SVG-cards` (LGPL-2.1) into `public/cards/` as genuine
per-card SVG files (not §12's originally-chosen pre-rendered PNGs — switched after manual
play-testing found the fixed 338×489 PNG resolution visibly blurred/aliased once cards
were sized differently; see `public/cards/CREDIT.md` for how each standalone SVG was
extracted from the upstream project's single combined sheet, and `SVG_RASTER_RESOLUTION`
in `cardSprites.ts` for the rasterization target). Each player's face-down piles use a
different back color (human=blue, cpu=red, purely cosmetic — done via an SVG `fill`
override on the back design rather than one of the upstream's 16 pre-baked back-color
assets, see `PLAYER_BACK_COLOR` in `cardSprites.ts`). Talon/waste/reserve piles draw a few
cheap filler layers behind the top card to hint at pile depth (`stackDepthLayers` in
`scene.ts`) — an impression, not an exact count (superseded for exact counts by the §14
step 9 pile-count badges, see below).

`createTableScene`'s `app.init` call also now sets `resolution: window.devicePixelRatio`
+ `autoDensity: true` (found alongside the above) — Pixi's renderer defaults `resolution`
to 1 regardless of screen density, meaning on any retina/high-DPI display the *entire*
canvas (not just card art) was being rendered at a lower pixel density than the screen
and then upscaled by the browser, independent of any texture's own resolution.

`CARD_WIDTH` in `layout.ts` was bumped 80→96 per direct user direction ("make the cards a
bit bigger") — everything else in `layout.ts` derives from it, so this alone rescales the
whole table proportionally.

**Foundations always visually group by suit, one suit per row, alternating black/red row-
to-row** — per direct user direction ("in the foundation pile the rows have to be the same
suit... looks good to be black/red/black/red"). This is *display-only*: the engine still
treats all 8 `state.foundations` slots as interchangeable (any empty one accepts any ace —
unchanged, still correct per §2/moveResolver.ts, still fully covered by its existing
tests). `layout.ts`'s `computeFoundationDisplayOrder` (own test file,
`layout.test.ts` — the one piece of `/render` logic that's actually worth unit-testing,
unlike pixel geometry) maps each real foundation index to a visual grid position grouped by
`FOUNDATION_ROW_SUIT`; `scene.ts`'s `renderGameState`/`effectiveSlotPoint` both go through
it, so a card's *engine* index (what moves/flashes operate on) and its *displayed* position
can differ, but a click on a displayed card still resolves to the correct real index.

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
`renderGameState` pipeline entirely, unlike everything else in this file.

Step 10 is also complete: `/src/i18n` (`index.ts` + `locales/en.ts` + `locales/pt.ts`)
wires up `i18next` with inline bundled resources — no HTTP backend/loader, since this is
a small static site and every locale's strings just ship in the JS bundle. No
`i18next-browser-languagedetector` dependency either; `detectLanguage()` in
`src/i18n/index.ts` does a one-shot `navigator.language` check at startup instead (falls
back to `en` for anything not in `SUPPORTED_LANGUAGES`). `main.ts` calls `initI18n()`
(awaited) before the first `initGameStore`/render. Every player-facing string that used
to be hardcoded — `REASON_TEXT` in `gameStore.ts` (now `REASON_KEY`, mapping each
`UiRejectReason` to a translation key resolved via `i18next.t()` at flash-creation time,
not render time — acceptable since there's no live language switcher yet and a flash is
short-lived anyway), plus `scene.ts`'s turn indicator/footer link/About modal/end-screen
text — now goes through `i18next.t()`. `locales/pt.ts` is typed `satisfies typeof en`
(not `: typeof en`) so it keeps literal string types while still failing to compile if a
key is missing or misspelled relative to `en.ts`. There's no in-app language switcher UI
yet (not required for v1 — the requirement was externalizing/making strings swappable,
not necessarily user-facing switching); `footerLink`'s and the About modal's text are
built once in `createTableScene` rather than re-resolved every render, so if a switcher
is added later those two would need to be redrawn on language change same as everything
already inside `renderGameState` is.

**Drag-and-drop is now also implemented, added alongside tap-to-select rather than
replacing it** — per direct user direction, reversing (for this one gesture only) the
step-7 "reactive-only" input decision's scope, but *not* its no-hints philosophy: dragging
still shows no legal-destination highlighting, matching the existing tap flow (per direct
user direction: highlighting mid-drag is deferred behind a future settings toggle, not
built now). `gameStore.ts` exposes two new pure/self-contained exports for this — `
canPickUp(ref)` (read-only: is this ref currently a legal move source for the human on
turn, i.e. would `isSelectableSource` accept it — the face-down talon is deliberately
excluded, since drawing just flips it face-up in place and has no meaningful drop target)
and `attemptDragMove(from, to)` (the atomic drag-completion action: mirrors
`handleSlotClick`'s second-tap branch via a shared `resolveMove(source, target, mover)`
helper both now call, and is responsible for its own `notify()` the same way
`handleSlotClick` is for taps). Neither touches `selected` in any way that changes the tap
flow's existing behavior — `resolveMove`'s "clear `selected`" calls are harmless no-ops for
a drag, which never sets `selected` to begin with.

All the actual drag mechanics live in `scene.ts`'s `createDragController` (mirrors Pixi
v8's own official drag-and-drop example: `app.stage` is made `eventMode: 'static'` with
`hitArea: app.screen` so stage-wide `pointermove`/`pointerup`/`pointerupoutside` listening
works regardless of what's under the pointer; `applyLetterbox`'s resize handler now also
refreshes `app.stage.hitArea` each resize, since a `Rectangle` hitArea is a snapshot, not
live-bound to `app.screen`). `drawStackedPile`/`drawHouse` call `dragController.attach()`
on the top-card sprite alongside the existing `makeClickable` tap wiring (foundations never
do — per §2/moveResolver.ts, a foundation is never a legal move *source*, only ever a
destination, so `drawTopCardOnly` stays tap-only). On `pointerdown`, if `canPickUp` passes,
the sprite is reparented into a new `dragLayer` (topmost card layer, added between
`cardsLayer` and `overlayLayer`) and follows the pointer (converted to `root`-local logical
space via `root.toLocal`) until release; movement past a small `DRAG_MOVE_THRESHOLD` (6
logical px) is what distinguishes a real drag from a plain tap — below it, `endDrag` just
snaps the sprite back to its origin and does nothing else, deliberately leaving Pixi's own
`pointertap` (unaffected by the brief reparent) to fire the normal tap-to-select path for
that gesture. Above the threshold, `endDrag` hit-tests the release point against every
`allBaseSlots()` ref's *current* `effectiveSlotPoint` (so a fanned house or a
suit-grouped foundation position resolves the same way a real tap-to-target already does)
and, if it lands on a different pile than the drag started from, calls `onDrop` (wired to
`attemptDragMove` in `main.ts`) — otherwise the drag is silently cancelled, sprite already
snapped back. A rejected drop gets the exact same red-flash-overlay + reason-banner
feedback a rejected tap gets (verified manually: dragging a card onto an illegal house
target shows "Doesn't fit that house..." and the card visibly returns to its origin pile,
never actually leaving it).

**Move tweening (§14 step 12, partial — this is only the move half, no card-flip animation
yet) is also in now**, per direct user direction: CPU moves (and human tap-to-select moves)
used to teleport instantly between piles, which read as visually broken/jarring next to the
human's own drag-and-drop, which already moves smoothly under the pointer. `scene.ts`'s
`placeCard(scene, sprite, cardId, point)` is now the only path that ever sets a card
sprite's position — `drawStackedPile`/`drawHouse`/`drawTopCardOnly` all route through it
instead of calling `sprite.position.set` directly. It compares `point` against
`scene.cardPositions`' last-known point for that exact card id (a `Map<string, Point>` field
on `TableScene`, persisted across renders — card ids are stable/suit+rank+copy per
`deck.ts`, not randomized, so `main.ts`'s `newGame()` explicitly `.clear()`s it, else a fresh
deal would see "same id, different point" versus the finished game and the whole table
would appear to slide in from its old positions): no previous entry, or an unchanged point,
snaps instantly (`sprite.position.set`); a genuinely different previous point tweens via
`animateCardTo` (a plain `app.ticker` callback driven by `performance.now()`, ease-out-cubic,
`CARD_MOVE_DURATION_MS` = 260ms — no dependency on any tweening library). Every house-fan
card (not just the top one) goes through `placeCard` too, not only the interactive top card
— otherwise a card moving from mid-fan visibility straight to a foundation would have no
tracked previous position to animate from.

Critically, this does *not* double-animate the human's own drag: `DragController` gained a
one-shot `consumeJustDragged(cardId)` — `endDrag` sets an internal `justDraggedCardId` right
before calling `onDrop` for a real (moved-past-threshold, landed-on-a-different-pile) drag
attempt, and `placeCard` checks/consumes it to force an instant snap instead of a tween for
that specific card on the next render, regardless of what `cardPositions` says — the user's
pointer already smoothly carried it there, so re-tweening it from its pre-drag origin would
look like the card jumping back and re-sliding. Verified manually: a tap-to-select move
(same code path CPU moves use) visibly animates card-in-flight partway through its 260ms
duration; a drag-completed move does not re-animate on drop.

Nothing under `/src/ui` exists yet — no `localStorage` persistence/autosave (step 11).

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
