# Build log

Chronological narrative of what was built, in what order, and why — including the
"per direct user direction" deviations from `tech-spec.md`, gotchas found the hard way,
and bugs fixed along the way. This is the detailed archive; `CLAUDE.md` keeps only a
terse current-status summary and pointers in here. Read this when you need the full
context behind a specific decision; skim past it otherwise.

Steps 1–5 (§14): engine-first build — `/src/engine` (types, deck, rules, moveResolver,
engine, winCheck), the headless CLI harness at `src/cli/simulate.ts`, and
`src/ai/cpuPlayer.ts` (the §7 rule-based CPU heuristic). `simulate.ts` supports
`--heuristic-human`/`--heuristic-cpu` flags to switch either side from the original
random-legal-move bot to the heuristic.

## Step 6: static PixiJS rendering

`/src/render` (`layout.ts` + `pixi/cardSprites.ts` + `pixi/scene.ts`) renders a static
`GameState` snapshot via PixiJS, letterboxed/rescaled to fit any viewport (no drag/drop
or tap interaction yet — that's step 7). `main.ts` deals a fixed-seed game and renders it.

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
step 9 pile-count badges).

`createTableScene`'s `app.init` call also sets `resolution: window.devicePixelRatio` +
`autoDensity: true` — Pixi's renderer defaults `resolution` to 1 regardless of screen
density, meaning on any retina/high-DPI display the *entire* canvas (not just card art)
was being rendered at a lower pixel density than the screen and then upscaled by the
browser, independent of any texture's own resolution.

`CARD_WIDTH` in `layout.ts` was bumped 80→96 per direct user direction ("make the cards a
bit bigger") — everything else in `layout.ts` derives from it, so this alone rescales the
whole table proportionally.

**Foundations always visually group by suit, one suit per row, alternating black/red row-
to-row** — per direct user direction ("in the foundation pile the rows have to be the same
suit... looks good to be black/red/black/red"). This is *display-only*: the engine still
treats all 8 `state.foundations` slots as interchangeable (any empty one accepts any ace —
unchanged, still correct per §2/moveResolver.ts, still fully covered by its existing
tests). `layout.ts`'s `computeFoundationDisplayOrder` (own test file, `layout.test.ts` —
the one piece of `/render` logic that's actually worth unit-testing, unlike pixel
geometry) maps each real foundation index to a visual grid position grouped by
`FOUNDATION_ROW_SUIT`; `scene.ts`'s `renderGameState`/`effectiveSlotPoint` both go through
it, so a card's *engine* index (what moves/flashes operate on) and its *displayed*
position can differ, but a click on a displayed card still resolves to the correct real
index.

## Step 7: tap-to-select input

`src/state/gameStore.ts` owns the mutable `GameState`, the current selection, and a
transient rejection "flash". `handleSlotClick` is the single entry point every pile click
resolves through — click a card to pick it up, click a destination to attempt the move,
click your own waste while a drawn hand card is selected to discard it. Draw is just
clicking your own face-down talon.

**Input is deliberately reactive-only, per direct user direction — not what
tech-spec.md §6 describes.** §6 says legal destinations should be highlighted on
drag-start and illegal ones rejected on drop. Instead: nothing is ever highlighted or
pre-disabled (no legal-move hints, no greyed-out draw button) — every action is
attempted, and only rejected attempts get feedback (a red flash on the attempted
destination + a reason banner at the top, ~900ms, see `REASON_TEXT` in `gameStore.ts`).
Finding the play is the player's job; a hint-mode toggle is a plausible future option but
isn't built. Every slot is clickable via Pixi's `pointertap` — including empty ones (an
invisible hit-zone) and, for a house, the *actual* top card's current sprite specifically
(not a fixed base rectangle — see the house-fan note below for why that distinction
matters).

## Step 8: CPU auto-play

CPU-side automatic play is wired in via `cpuStep()` in `gameStore.ts`, driven by a
`setInterval(cpuStep, 700)` in `main.ts`. `cpuStep` performs exactly one discrete action
per call (one move, one draw, or resolving the just-drawn card) using `cpuPlayer.ts`'s
existing `chooseMove`/`chooseCompulsoryMove`/`chooseOptionalMove` — mirroring
`simulate.ts`'s `playHeuristicStep` logic but split into single-action beats so each CPU
action is independently visible rather than an entire turn resolving in one frame. It's a
no-op whenever it isn't actually the CPU's turn, so the interval can just tick
unconditionally for the page's whole lifetime. `handleSlotClick` also ignores clicks
outright unless `state.turn === 'human'` — only the human seat is click-driven; the CPU
seat never was reachable via a real click anyway, this just makes that explicit.

`gameStore.ts` also logs every action to the browser console (prefixed `[crapette]` —
selections, applied moves, rejections with their reason, draws, discards, passes,
game-over) since there's no in-app HUD/move-log to see what happened during manual
testing.

**Fixed a real dealing bug found via manual play-testing**: `deck.ts` used to build one
combined 104-card pool and shuffle it as a whole before splitting 52/52 — per real
Crapette/Russian Bank rules (confirmed via the Wikipedia article, which the tech spec
had gotten wrong at §2), each player shuffles and deals from their **own** independent
52-card deck. The old approach could deal a single player two copies of the same card,
which is impossible with real decks. `deck.ts` now has `buildStandardDeck(copy)` (52
unique cards) instead of `buildTwoDeckPool()`, and `deal(random)` shuffles two of them
independently — `docs/tech-spec.md` §2 has been corrected to match. A same-rank
duplicate can still legitimately appear on the shared tableau (each player's own copy,
e.g. one in a house each) — just never within one player's own reserve/houses/hand/waste.

**Houses fan horizontally, not vertically** — corrected per direct user direction to
match the Wikipedia setup photo (cards overlap sideways, outward, away from the shared
foundation columns; see `HOUSE_FAN_SIGN` in `layout.ts`). This exposed a real interaction
bug: click hit-zones used to be fixed rectangles at each slot's *base* position, so a
fanned house's actual (visually shifted) top card could sit outside its own click target
once the house held more than a couple of cards. Fixed by making the click handler live
on the top card's actual rendered sprite (or an invisible hit-zone at the base position
only when the pile is empty) instead of a static rectangle — `scene.ts`'s
`makeClickable`/`drawEmptyHitZone`.

**Drawing an unplayable card no longer auto-discards it**, per direct user direction: it
used to silently discard and end the turn the moment `settle()` in `gameStore.ts` saw no
legal move for it, which gave no sense that anything had happened. Now it just sits there
face-up; discarding is always the explicit action of clicking it then clicking your own
waste (same mechanic as the already-existing voluntary-discard path), whether or not it
happens to have a legal move. There's also now a persistent turn indicator ("Your turn" /
"CPU's turn" / game-over) drawn at the top of the table (`turnLabel` in `scene.ts`), so a
turn actually ending is visible in the game itself, not just in the console log.

## Step 9: HUD (pile counts, end screen, About/Legal)

HUD additions live entirely in `src/render/pixi/scene.ts` (no `/src/ui` needed for
these). **Pile counts**: every non-empty pile (hand/waste/reserve/houses/foundations)
gets a small numeric badge at its base slot's bottom-right corner (`drawCountBadge`) — an
exact count, unlike `stackDepthLayers`' cosmetic depth *impression*. **End screen**:
`overlayLayer` (cleared/rebuilt every `renderGameState` call like `cardsLayer`) draws a
dimmed full-table overlay with the result, both players' scores, and a "Play Again"
button once `state.status !== 'in_progress'` (`drawEndScreen`); `turnText` is blanked in
that state instead of also announcing the result, to avoid saying it twice. "Play Again"
calls an `onPlayAgain` callback threaded through `createTableScene`'s handlers, wired in
`main.ts` to re-deal (genuine `Math.random()`, not the fixed dev-session seed) followed by
a direct `render()` call. **About/Legal modal**: a persistent "About / Legal" footer link
toggles a modal with the §12-required credits (SVG-cards LGPL-2.1, PixiJS,
Vite/TypeScript/Vitest) — pure presentation with no `GameState` involvement, so it lives
outside the gameStore/`renderGameState` pipeline entirely, unlike everything else in this
file.

## Step 10: i18n

`/src/i18n` (`index.ts` + `locales/en.ts` + `locales/pt.ts`) wires up `i18next` with
inline bundled resources — no HTTP backend/loader, since this is a small static site and
every locale's strings just ship in the JS bundle. No `i18next-browser-languagedetector`
dependency either; `detectLanguage()` in `src/i18n/index.ts` does a one-shot
`navigator.language` check at startup instead (falls back to `en` for anything not in
`SUPPORTED_LANGUAGES`). `main.ts` calls `initI18n()` (awaited) before the first
`initGameStore`/render. Every player-facing string that used to be hardcoded —
`REASON_KEY` in `gameStore.ts` (mapping each `UiRejectReason` to a translation key
resolved via `i18next.t()` at flash-creation time), plus `scene.ts`'s turn
indicator/footer link/About modal/end-screen text — now goes through `i18next.t()`.
`locales/pt.ts` is typed `satisfies typeof en` (not `: typeof en`) so it keeps literal
string types while still failing to compile if a key is missing or misspelled relative to
`en.ts`.

**Drag-and-drop was added alongside tap-to-select rather than replacing it** — per direct
user direction, reversing (for this one gesture only) step 7's "reactive-only" input
decision's scope, but *not* its no-hints philosophy: dragging still shows no
legal-destination highlighting, matching the existing tap flow (highlighting mid-drag is
deferred behind a future settings toggle, not built). `gameStore.ts` exposes
`canPickUp(ref)` (read-only: is this ref currently a legal move source for the human on
turn — the face-down talon is deliberately excluded, since drawing just flips it face-up
in place and has no meaningful drop target) and `attemptDragMove(from, to)` (the atomic
drag-completion action: mirrors `handleSlotClick`'s second-tap branch via a shared
`resolveMove(source, target, mover)` helper both call).

All the actual drag mechanics live in `scene.ts`'s `createDragController` (mirrors Pixi
v8's own official drag-and-drop example: `app.stage` is made `eventMode: 'static'` with
`hitArea: app.screen` so stage-wide `pointermove`/`pointerup`/`pointerupoutside` listening
works regardless of what's under the pointer; `applyLetterbox`'s resize handler also
refreshes `app.stage.hitArea` each resize, since a `Rectangle` hitArea is a snapshot, not
live-bound to `app.screen`). `drawStackedPile`/`drawHouse` call `dragController.attach()`
on the top-card sprite alongside the existing `makeClickable` tap wiring (foundations
never do — per §2/moveResolver.ts, a foundation is never a legal move *source*). On
`pointerdown`, if `canPickUp` passes, the sprite is reparented into a `dragLayer` (topmost
card layer) and follows the pointer until release; movement past a small
`DRAG_MOVE_THRESHOLD` (6 logical px) distinguishes a real drag from a plain tap — below
it, `endDrag` just snaps the sprite back and leaves Pixi's own `pointertap` to fire the
normal tap-to-select path. Above the threshold, `endDrag` hit-tests the release point
against every `allBaseSlots()` ref's *current* `effectiveSlotPoint` and, if it lands on a
different pile, calls `onDrop` — otherwise the drag is silently cancelled. A rejected drop
gets the same red-flash-overlay + reason-banner feedback a rejected tap gets.

**Move tweening is in**: CPU moves (and human tap-to-select moves) used to teleport
instantly between piles, which read as visually broken/jarring next to the human's own
drag-and-drop, which already moves smoothly under the pointer. `scene.ts`'s
`placeCard(scene, sprite, card, owner, point)` is now the only path that ever sets a card
sprite's position/texture. It compares `point` (and `card.faceUp`) against
`scene.cardRenderState`'s last-known entry for that exact card id (a
`Map<string, { point: Point; faceUp: boolean }>` field on `TableScene`, persisted across
renders — card ids are stable/suit+rank+copy per `deck.ts`, so `main.ts`'s `newGame()`
explicitly `.clear()`s it, else a fresh deal would see "same id, different point/face"
versus the finished game): no previous entry, or an unchanged point and face, snaps
instantly; a genuinely different previous point (same face) tweens via `animateCardTo` (a
plain `app.ticker` callback, ease-out-cubic, `CARD_MOVE_DURATION_MS` = 260ms); an
unchanged point but a *different* previous face (most commonly a hand card just turned
face-up by a draw) flips via `flipCard` instead. Every house-fan card (not just the top
one) goes through `placeCard` too.

This does *not* double-animate the human's own drag: `DragController` gained a one-shot
`consumeJustDragged(cardId)` — `endDrag` sets an internal `justDraggedCardId` right before
calling `onDrop` for a real drag attempt, and `placeCard` checks/consumes it to force an
instant snap instead of a tween for that specific card on the next render.

**Card-flip animation**: `flipCard(app, sprite, newTexture)` in `scene.ts` does a
horizontal squash-to-a-sliver/re-expand (`CARD_FLIP_DURATION_MS` = 220ms), swapping the
sprite's actual `.texture` at the midpoint rather than crossfading. `cardSprites.ts`
exports `cardTexture(card, owner)` (the `Texture` lookup `createCardSprite` already did
internally, factored out) so `placeCard` can resolve both the pre-flip and post-flip
texture without duplicating the suit/rank/back-color key logic.

**Mobile**: `#app canvas` sets `touch-action: none` in `style.css` — without it a
touch-drag risks being hijacked by the browser as a scroll/pull-to-refresh gesture before
it ever reaches Pixi's pointer events. A "rotate your device" overlay exists as a plain
`#rotate-overlay` div in `index.html`, shown via a pure-CSS
`@media (orientation: ...) and (pointer: coarse)` rule in `style.css` — `pointer: coarse`
deliberately restricts this to touch devices, so a desktop user resizing their window
narrow never sees it. (Originally prompted for landscape per §5's text; later flipped to
portrait — see the "orientation flip" entry below, since this canvas's own proportions
turned out to favor portrait, not landscape.)

**Known limitation, deliberately left as-is per direct user direction**: the letterboxed
scale on common phone portrait sizes (e.g. 375×667, 390×844) comes out around 0.41–0.43,
making each card's touch target roughly 39×57 CSS px — still below §5's 44×44px minimum on
the width axis specifically (height clears it), though notably less cramped than
landscape's ~33×47px would be on the same devices. The bottleneck is `LOGICAL_HEIGHT`
(1104px, 6 stacked rows) being tall relative to `LOGICAL_WIDTH`, not `CARD_WIDTH` itself —
fixing it properly would mean shrinking vertical spacing/margins across the whole table,
affecting the desktop layout too (already deliberately tuned/approved — see the
`CARD_WIDTH` 80→96 bump above). Tablet and up (iPad mini and larger, either orientation:
comfortably >60px) are unaffected. Don't "fix" this by silently shrinking
`ROW_GAP`/`ROW_MARGIN` — if it's ever revisited, it needs the same explicit trade-off
conversation, since it directly affects the already-tuned desktop card size.

## Step 11 (§10): localStorage autosave/resume

`localStorage` autosave/resume, key `crapette-save-v1` per §10's exact spec.
`gameStore.ts`'s `notify()` — the function every state-changing action already calls to
trigger a re-render — now also calls `saveGame()`, so persistence piggybacks on the exact
same "something happened" signal as rendering does; `initGameStore()` saves too, so the
very first frame of any game is always immediately backed by a save. `saveGame`/
`loadSavedGame` wrap `localStorage` calls in try/catch — private-browsing quota errors or
storage being disabled must never break an in-progress move, persistence is strictly a
nice-to-have. `loadSavedGame` runs the parsed value through `isPlausibleGameState` (a
handful of cheap structural checks, not a full schema validator) and returns `null` rather
than a bogus object if it fails.

`main.ts` reads `loadSavedGame()` before creating the table scene and picks the starting
`GameState` per §10's exact rule ("if a save exists and the game is `in_progress`, offer
Resume vs New Game; otherwise start fresh"), with one addition beyond spec text: "start
fresh" only ever means the fixed dev seed on a *truly first-ever* visit (no save at all) —
a save that exists but already ended (won/stalemate) starts fresh via a genuinely random
deal instead, matching "Play Again"'s behavior. The Resume-vs-New-Game choice itself is a
plain-DOM `#resume-prompt` overlay (`index.html`/`style.css`, sharing a `.modal-overlay`/
`.modal-panel`/`.modal-buttons` look) rather than a Pixi screen — it has to resolve
*before* the table scene even exists.

## New Game / language switcher / rules modal

**Three UI gaps closed, per direct user direction ("what is missing? We need new game UI
and so on")**: an in-game way to abandon and restart mid-game (previously "Play Again"
only existed on the end screen), a manual language switcher (i18n infra existed since
step 10 but was auto-detect-only), and an in-game rules reference (the About modal only
ever had license credits, not how-to-play text).

The footer is a 4-item row — New Game | How to Play | *(language autonym)* | About /
Legal. New Game opens a confirm dialog rather than acting immediately, since discarding an
in-progress game is exactly the kind of hard-to-reverse action worth an "are you sure?".
How to Play opens a taller text modal built from the same `drawTextModal` the About modal
goes through. The language toggle shows the *other* language's autonym
(`LANGUAGE_AUTONYM` — "Português"/"English", hardcoded, deliberately NOT run through
i18next, since a language's own name for itself isn't translated content) and calls
`setLanguage()` in `src/i18n/index.ts`, which persists the choice to `localStorage` (key
`crapette-lang`, checked by `detectLanguage()` ahead of browser auto-detection).

**A genuine, non-obvious PixiJS gotcha**: an `eventMode: 'static'` Graphics or Text object
created while its container is still `visible: false` never becomes properly hit-testable
later, even after the container is set back to `visible: true` — confirmed via a minimal
isolated repro. Fix, applied to all modals (About, How to Play, New Game confirm): don't
pre-build a modal once and toggle `.visible` on a persistent layer — instead
`layer.removeChildren()` and rebuild its content fresh every time it opens. This is also
why `drawTextModal`/`drawConfirmModal` take their text as plain string params rather than
returning `Text` refs for later patching — rebuilding on every open already picks up the
current language.

## The Graphics-button hit-testing bug (see `docs/known-issues.md` for the full story)

A follow-up user report ("when I click new game it doesn't work") led to actually
instrumenting `scene.app.renderer.events.rootBoundary.hitTest(x, y)` directly via
Playwright, which found: in pixi.js 8.19.0, a `Graphics` object sitting among these
particular modal-layer siblings reliably fails hit-testing — true for an explicit
`.hitArea` Rectangle *and* Pixi's own auto-computed bounds, even for a brand-new Graphics
added fresh at runtime. A `Text` object in the exact same position hit-tests correctly
every time. Fix: all interactivity (`eventMode`, `cursor`, `.hitArea`, `pointertap`) now
lives on the button's `Text` label, not its `Graphics` background — see
`makeButtonHitTarget` in `scene.ts`. Full investigation notes and the "don't do this
again" rule are in `docs/known-issues.md`.

## Orientation flip: rotate-prompt now asks for portrait, not landscape

An external design-review pass flagged that `layout.ts`'s actual geometry (924×1104,
taller than wide) contradicts tech-spec §5's landscape assumption and the original
rotate-overlay (which asked for landscape). Since the canvas is taller than wide, the
letterboxed scale on a phone works out *bigger* in portrait (~0.41, width-constrained)
than landscape (~0.34, height-constrained, more wasted pillarbox space) — so the prompt
was flipped to ask for portrait instead of reshaping the tableau to match the stale
landscape assumption. `style.css`'s media query, the `rotate.message` locale copy (en+pt),
and this doc were all updated to match. Verified with a touch-emulated Playwright context:
overlay shows in portrait, hides in landscape now (previously the reverse).

## The stalemate-detection bug and the debug seed (see `docs/known-issues.md`)

A user reported a stalemate being declared while they still had 18 untouched hand cards
sitting unplayed. Checked against three independent sources (pagat.com, Wikipedia,
denexa.com) — the real rule is a board-state condition ("nobody has any legally-playable
cards"), not the tech-spec's originally-specified fixed "2 consecutive no-progress turns."
Fixed in `winCheck.ts` — see `docs/known-issues.md` for the full investigation and the
threshold formula. Alongside the fix, every fresh deal now logs/persists a debug seed
(`dealWithLoggedSeed()` in `main.ts`, `localStorage` key `crapette-seed-v1`) so a future
bug report can just be a seed number instead of the whole save blob.

## Current state

Nothing under `/src/ui` exists as a separate directory — all HUD/modal code lives in
`src/render/pixi/scene.ts` since none of it needed to be anything more than Pixi
draw calls plus plain callbacks.

The engine/AI/CLI/render/state code is still young — fields or functions with no usages
elsewhere in the repo are safe to add, rename, or remove as the implementation is worked
out; this isn't yet a stable public API with external callers to preserve compatibility
for.
