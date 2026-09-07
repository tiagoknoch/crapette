# Known issues and non-bugs

Investigated gotchas and "looks like a bug but isn't" cases. Check here before
re-investigating something that looks suspicious — it may already have a confirmed
explanation. See `docs/build-log.md` for the broader chronological build history.

## Fixed: New Game / Play Again buttons not responding to clicks (PixiJS Graphics hit-test bug)

**Symptom**: clicking "Start new game" (or Cancel) in the New Game confirm dialog did
nothing at all — not intermittently, every time. Reported directly by a user.

**Root cause, found via direct instrumentation** (not guesswork — used Playwright to call
`scene.app.renderer.events.rootBoundary.hitTest(x, y)` directly against the running page):
in pixi.js 8.19.0, a `Graphics` object sitting among these particular modal-layer siblings
reliably **fails** hit-testing. Confirmed false for:
- an explicit `.hitArea` Rectangle matching the drawn shape exactly,
- Pixi's own auto-computed bounds from the drawn shape,
- a brand-new `Graphics` object added fresh at runtime purely to rule out stale state.

A `Text` object in the exact same layer, same position, hit-tests correctly every time —
verified both with auto text bounds and an explicit Rectangle `.hitArea`, against real
(non-forced) geometry. At the time, the failure looked specific to small button-sized
`Graphics` siblings in modal/overlay layers — card sprites, `drawEmptyHitZone`'s invisible
rects, and the modal backdrop/panel Graphics were all re-verified still working, so the fix
below was scoped to "modal buttons only."

**Correction (redesign pass)**: that scoping was wrong. Building the redesign's new
empty-foundation/empty-house visuals, a fresh interactive `Graphics` rect placed on a
**board** tile (`cardsLayer`, not a modal layer) reproduced the exact same silent
click-eating failure — confirmed via console logging (`gameStore.ts`'s click-routing log
never fired for that tile) and cross-checked with the exact same screen coordinates
computed independently from `layout.ts`. The rule below now applies to every `Graphics`
object in `scene.ts`, board tiles included, not only modal buttons — `drawEmptyHitZone`
itself was migrated to a Text-based hit target (an empty dummy `Text` sized to the full
card box) for this reason. `drawEmptyHitZone`'s Graphics apparently "still working" in the
original investigation was never actually exercised by an interactive click test, just
assumed fine because nothing had reported it broken yet.

Root cause inside Pixi's `EventBoundary` itself was not pinned down further — not worth
it once a reliable alternative was confirmed.

**Fix (the actual, permanent rule)**: a clickable button in `scene.ts` must put ALL its
interactivity (`eventMode`, `cursor`, `.hitArea`, the `pointertap` listener) on its `Text`
label, never on its `Graphics` background. See `makeButtonHitTarget` in `scene.ts`, used by
`drawConfirmModal`'s Cancel/Confirm buttons and `drawEndScreen`'s "Play Again" button. The
`Graphics` shapes stay purely decorative (no `eventMode`, no listener). **Do not add a new
Graphics-based button anywhere in this file** — route the click handler through
`makeButtonHitTarget` on a Text label instead.

**Correction note**: an earlier pass at this same bug (before the user's "it doesn't work
at all" report) had misdiagnosed it as an explicit-`.hitArea`-fixes-it problem and shipped
that as the fix. It didn't actually fix anything — the follow-up report and direct
`hitTest()` instrumentation is what found the real cause above. If you're ever tempted to
add a Graphics `.hitArea` as a fix for an unresponsive button in this file, it won't work;
move the interactivity to the Text label instead.

Verified via a 5-cycle rapid open→cancel→reopen→cancel stress test (previously the exact
scenario that intermittently failed) plus a real open→confirm — all landed correctly, and
`npm run test` / `tsc --noEmit` were both clean after the change.

## Fixed: stalemate declared far too early (2 turns, not a real deadlock)

**Symptom**: a user reported the game ending in a stalemate while they still had a legal
move available. Their actual saved game (`localStorage`'s `crapette-save-v1`) showed
`human.hand.length === 18` (all still face-down, never drawn this cycle) and
`human.waste.length === 2` at the moment it triggered — nowhere close to genuinely stuck.

**Root cause**: `checkStalemate` in `winCheck.ts` originally matched tech-spec §9's own
text literally — declare `status = 'stalemate'` once `roundsWithoutProgress` (a shared
counter, incremented once per turn that made zero progress, reset on any progress) hit a
hardcoded `2`, i.e. one bad draw per player, back to back. Checked against three
independent sources (pagat.com/patience/crapette.html, Wikipedia's Russian Bank article,
denexa.com's Crapette writeup) — all three agree the real rule is "nobody has any
legally-playable cards in their stock, discard, or reserve," a board-state condition, not
a fixed turn count.

**Fix** (§9/resolution #4, see the comment above `checkStalemate`): keep the same
increment/reset mechanism, but replace the threshold `2` with
`2 * max(humanCycleSize, cpuCycleSize)`, where a player's cycle size is their current
`hand.length + waste.length` — i.e. require each player to have had enough consecutive
no-progress turns to have cycled through *all* their own remaining hand+waste at least
once without a play. Turns strictly alternate (every turn ends via
`discardDrawnCardToWaste` or `passTurn`, both of which always flip `state.turn`), so N
consecutive no-progress turns split ~N/2 per player, hence the `2×`. A player whose
hand+waste is already empty has cycle size 0 — correctly still stuck immediately, since
there's nothing left for them to cycle through.

Verified directly against the user's reported save: with the fix, that exact state
resolves to `in_progress` (needed threshold was 72, not 2), and `getLegalMoves` confirmed
the human genuinely did have a move available. `docs/tech-spec.md` §9 and
`winCheck.test.ts` were both updated to match, including a regression test using the
reported save's exact shape (large hand+waste, `roundsWithoutProgress: 2`, must NOT
trigger).

**Debug tooling added alongside this fix**: every genuinely new deal now goes through
`dealWithLoggedSeed()` in `main.ts` — logs `[crapette] seed: <n>` to the console and
persists it to `localStorage` under `crapette-seed-v1`, so a future bug report can just be
a seed number instead of the whole `crapette-save-v1` JSON blob (which is only
recoverable while that exact browser tab/session is still open). Deliberately kept OUT of
`GameState`/`/src/engine` — `deal()` only ever takes a `random: () => number`, stays
seed-agnostic per the engine purity rule; the seed is pure tooling living in `main.ts`.

## Fixed: clicking an empty draw pile did nothing — stuck once the hand emptied mid-turn

**Symptom**: a user reported their draw pile was empty and they couldn't reshuffle to
continue — the game appeared stuck.

**Root cause**: the actual reshuffle-from-waste logic (`drawFromHand` in `engine.ts`) was
correct all along — it already reshuffles the waste pile into the hand whenever the hand
is empty at draw time, no separate flag needed. The bug was in the UI's click routing:
`gameStore.ts`'s `isOwnFaceDownTalon` (the check that decides whether clicking a pile
should attempt a draw) required `topCardOf(state, ref)` to return an actual card and be
face-down — `!top.faceUp`. When the hand pile is completely empty, `topCardOf` returns
`undefined`, so this check was always false. `isSelectableSource` doesn't cover an empty
hand either (`getAvailableSources` only includes the hand when it has a face-up top
card). Net effect: once a player's hand pile actually reached zero cards — most commonly
by playing their *last* hand card via a real move rather than discarding it, which never
sets the `needsHandReshuffle` flag `startTurn()`'s automatic reshuffle relies on — there
was no click that could ever reach `drawFromHand`, leaving the player stuck with a
visibly empty draw pile and a non-empty waste pile they could never get to.

**Fix**: renamed to `isOwnHandDrawTarget` and changed the check to
`top === undefined || !top.faceUp` — an empty own-hand pile is now just as valid a draw
target as a face-down one. `attemptDraw`/`canDrawHand`/`drawFromHand` already handled the
empty-hand-reshuffle case correctly; they just needed the click to actually reach them.
If both hand and waste are genuinely empty, the existing `canDrawHand` gate still
correctly rejects the attempt with `reject.nothingToDraw` rather than doing nothing
silently.

**Verified** end-to-end via a constructed save (`human.hand: []`, `human.waste`: 3 cards)
loaded through the real Resume flow: clicking the empty hand pile logged
`human draws 5♠`, reshuffled all 3 waste cards back into hand (waste emptied, hand went
0→3), and rendered correctly (waste pile empty, hand showing the newly drawn card
face-up). `npm run test` (92 tests) and `tsc --noEmit` were both clean after the change.

## Fixed: cards sometimes visibly flew in from an unrelated position (often the waste pile)

**Symptom**: a user reported that "the flip animation comes from the center, or a dragging
card comes from the center" — cards would occasionally slide in from an unrelated spot on
the table (often near a waste pile, which sits at each row's horizontal center) instead of
just appearing or animating from where they actually just came from.

**Root cause**: only the *top* card of a stacked pile (hand/waste/reserve/foundation — see
`drawStackedPile`/`drawTopCardOnly`) gets a `placeCard` call each render; a card buried
underneath simply isn't touched again until it resurfaces as that pile's top, which can be
many renders (and many unrelated moves) later. `scene.cardRenderState` is a flat
`Map<cardId, {point, faceUp}>` with no way to tell "this was placed last render" apart from
"this was placed 40 renders ago and has been invisible ever since" — so when a
long-buried card resurfaced, `placeCard` trusted its stale, ancient position as a genuine
"animate from here" source, producing a spurious flight from wherever it happened to be
last visible (very often a waste pile, since most cards pass through one).

**Verified directly** (not just inferred from reading the code): poked a fake stale
`cardRenderState` entry for a card about to become a pile's new top, forced a render, and
sampled the actual sprite's position over several animation frames — it visibly
interpolated from the poked stale point toward its real destination, confirming the bug
empirically before fixing it.

**Fix**: added a `renderGeneration` counter on `TableScene`, incremented once at the start
of every `renderGameState` call. Each `cardRenderState` entry now also stores the
generation it was set during, and `placeCard` only trusts a stored entry as a real
animation source if `stored.generation === scene.renderGeneration - 1` — i.e. it was
placed on the *immediately preceding* render, so it's known to have been continuously,
visibly at that position until right now. Anything older is treated the same as "never
seen before" (snap instantly, no animation) rather than an animation source.

**Re-verified after the fix**: the same poke-and-sample test now shows the sprite snapping
straight to its correct final position with no interpolation, while a genuine
back-to-back move (real previous-render position, one render apart) still tweens smoothly
as before — confirming the fix doesn't regress legitimate animations. `npm run test`
(92 tests) and `tsc --noEmit` both clean.

## Feature: completed foundations (built up through King) now flip face-down

Per direct user question, confirmed against pagat.com/patience/crapette.html's rules text:
"No further card can be added after the King; it is usual to turn the King face-down to
indicate that the foundation pile is complete." This is a display convention, not a
legality rule — a full foundation already naturally accepts no further cards
(`canPlayToFoundation` only ever allows the next rank up), so this has zero effect on
game logic. `drawTopCardOnly` in `scene.ts` (foundations-only, per its own comment) now
renders a foundation's top card face-down once `cards.length === FOUNDATION_COMPLETE_SIZE`
(13 — a foundation always runs exactly A through K, one card per rank, so this reliably
means the top card is the King). The underlying `GameState` card is left untouched
(`faceUp` stays `true` in the actual data) — only a render-time copy is flipped, the same
pattern already used elsewhere in this file (e.g. `placeCard`'s flip branch).

Deliberately kept simple: the King renders face-down starting the very same render it
completes the foundation (no separate "arrives face-up, then flips after settling"
two-step animation) — a reasonable first cut for a cosmetic-only feature; revisit only if
it actually looks abrupt in practice, not preemptively.

## Feature: "Crapette Redesign" visual language + landscape layout

A design handoff (`design_handoff_crapette_board/README.md` + `Crapette Redesign.dc.html`)
specified a new visual language (felt gradient, Instrument Serif/IBM Plex Mono typography,
gold/red accent palette, card shadows/rings) and a resolved responsive strategy: the table
is always the portrait graph, a landscape viewport only rotates each player's talon/waste/
reserve group into their own flank (see `docs/tech-spec.md` §5, now rewritten to match).
Implemented as a visual + responsive-geometry pass on top of the existing interactions,
per direct user scope decision — two things from the mockup were explicitly **not**
built:

- A Settings screen with a deck-art toggle (alternate type-only card faces) and a "rows"
  table-view toggle — neither has any asset/layout work behind it yet; skipped rather than
  building a whole second feature just to have a place to put an unused switch.
- An explicit drawn-card play/discard panel and a live CPU move-description indicator —
  both are genuine interaction changes (new UI, new state exposed from `gameStore.ts`)
  beyond a restyle; the existing implicit click-your-own-waste-to-discard and static
  turn-label interactions were kept as-is, just reskinned.

Two more pieces from the mockup were skipped for a different reason — they contradict the
locked-in "reactive-only, no legal-move highlighting" architecture rule (see CLAUDE.md):
the pulsing "legal target" ring and the dashed "loadable pile" ring. Neither exists in this
codebase and shouldn't be added without revisiting that rule first.

Two visual details are deliberate approximations rather than pixel-perfect ports of the
mockup's CSS: `box-shadow` under every card is a flat offset semi-transparent rounded-rect
(`drawCardShadow` in `scene.ts`), not a real blur filter — pixi-filters isn't a dependency,
and a GPU drop-shadow filter per card would cost a render pass per sprite with dozens of
cards on screen at once, several animating simultaneously during a move/drag. The mockup's
dashed empty-house border is a plain solid low-alpha stroke instead — Pixi's `Graphics` has
no native dashed-stroke option, and hand-building one from short line segments wasn't
judged worth it for a border this subtle.

**One derived (not new) state addition**: a compulsory-move banner, ineligible-pile
dimming, and a ring on the forced source. `gameStore.ts`'s `getCompulsoryMove()` exposes
`getLegalMoves(state, 'human').compulsory` — already computed for click-gating rejections —
to the renderer; nothing new is tracked, and it's only ever populated during the human's
own turn (the CPU resolves its own forced moves automatically, see `cpuStep`).

**Real bug caught and fixed during this pass**: see the correction note on the very first
entry in this file — an interactive `Graphics` empty-foundation slot silently ate every
click, which is what led to discovering the Graphics-hit-test-failure rule is broader than
originally scoped.

## Feature: top toolbar replaces the footer nav (redesign v2 handoff)

A second, corrected design-handoff package (`Crapette card game UI mockups/
design_handoff_crapette_board/README.md` + `DESIGN_RULES.md`) superseded the first
handoff's "derive card size from the binding axis in pixels" instruction (wrong for this
codebase — card size only changes via the logical canvas's aspect ratio) and specified a
top toolbar band replacing the old footer row: wordmark + "RUSSIAN BANK" qualifier on the
left, NEW GAME / HOW TO PLAY / SETTINGS / ABOUT plus an EN/PT segmented control on the
right. Implemented as its own logical-canvas band (`TOOLBAR_HEIGHT` in `layout.ts`, folded
into `rowY()` so both portrait and landscape shift down by exactly that much), per
`DESIGN_RULES.md` §5's "chrome goes where no card can reach" rule — not a DOM overlay.

Per direct user scope decision, **SETTINGS ships as a stub**: the toolbar item opens a
small popover with exactly one row, "About / Legal", which opens the existing About modal.
Deck art / Table view / Pile layout rows (all real settings the v2 handoff specifies) stay
out until those features actually exist — same reasoning as the first redesign round's
Settings deferral above.

**NEW GAME's confirmation moved from a centered modal to a popover anchored under the
toolbar button**, and gained a condition the old confirm-modal flow didn't have: with no
game in progress (fresh load, or right after the current one ended) it acts immediately,
matching "Play Again"'s existing behavior — the popover only appears when there's actually
something to lose. This needed a new `isGameInProgress()` handler threaded from `main.ts`
into `TableSceneHandlers`.

**These new popovers (New Game, Settings) never use a `Graphics` for their "tap outside to
close" or "tap the panel without closing" behavior** — both route through invisible `Text`
hit zones (`drawInvisibleHitZone` in `scene.ts`), even though the *existing* About/Rules
modal backdrops already do use an interactive `Graphics` and are documented above as
re-verified working. This file's own rule says not to add a *new* Graphics-based button
anywhere in `scene.ts`, so new code stays conservative rather than assuming the existing
exception extends to it.

**Deferred to a later round** (not built this pass, flagged so a future session doesn't
have to re-derive scope from the handoff again): the `pileLayout` (ROWS/SIDES) setting;
Settings real content; drag-state polish; the drawn-card play/discard panel; the live CPU
move-description indicator; and a `docs/tech-spec.md` §5 touch-up once the `pileLayout`
setting lands. The pulsing legal-target ring and dashed loadable-pile ring remain out of
scope for the same architecture-rule reason as the first redesign round. (The "fan clamp"
bug fix and the landscape geometry constants that used to be listed here were both done in
later phases — see the two entries directly below.)

## Fixed: house fan had no width clamp — a long enough house ran over its neighbor

`HOUSE_OVERLAP_X` (26 logical units) was a constant per-card peek, so a house's total fan
width (`card + (n − 1) × peek`) was unbounded — a house of ~8+ cards could fan far enough to
visually overlap the adjacent waste pile, which also breaks that pile's hit-testing (a card
drawn across a pile boundary silently eats clicks meant for the pile underneath). Flagged as
the one must-fix bug in the redesign v2 handoff (`DESIGN_RULES.md` §6).

Fixed by budgeting the *whole* house's fan against the real clear space instead of a fixed
per-card peek: `houseFanPeek(cardCount)` in `layout.ts` returns
`clamp(HOUSE_FAN_ALLOWANCE / (n − 1), 0.10 × CARD_WIDTH, HOUSE_OVERLAP_X)` — short houses
still fan at the natural (maximum) peek, longer ones compress evenly, and a house long
enough to hit the floor (~18+ cards, with today's `HOUSE_FAN_ALLOWANCE = 156`) stops
shrinking further rather than escaping; its true length is left to the count badge. Called
from all three sites that previously inlined `HOUSE_OVERLAP_X` directly (`effectiveSlotPoint`
and `drawHouse`'s per-card/top-card points in `scene.ts`), so the card you see and the card
you can click/drag never disagree. Verified live with a fabricated 22-card house (well past
the old constant-peek overflow point) — the fan compresses and stays inside the allotted gap
instead of overlapping the reserve pile.

Not done in this pass: `HOUSE_FAN_ALLOWANCE` itself is unchanged (still `6 ×
HOUSE_OVERLAP_X`, i.e. 156) — the v2 handoff's larger landscape-only allowance (286) was
delivered in the very next phase, see the entry directly below. The clamp is correct
either way; it just had less room to work with until that landed.

## Feature: landscape gets its own (smaller) edge margin and (much larger) house-fan allowance

`DESIGN_RULES.md` §5's other landscape change, done separately from the toolbar itself:
landscape's fit is height-bound (portrait's is width-bound), so at a typical laptop aspect
ratio ~434 screen px of width sat unused while the card was squeezed by the shared,
portrait-sized margins. Two new landscape-only constants in `layout.ts` —
`LANDSCAPE_ROW_MARGIN = 24` (down from the shared `ROW_MARGIN`'s 60) and
`LANDSCAPE_HOUSE_FAN_ALLOWANCE = 11 * HOUSE_OVERLAP_X = 286` (up from the shared
`HOUSE_FAN_ALLOWANCE`'s 156) — spend the freed height on a taller card and the already-free
width on fan room, at the same time, because they're paid for on different axes. Portrait is
untouched: `ROW_MARGIN`/`HOUSE_FAN_ALLOWANCE`/`GRID_MARGIN` keep their original values and
meaning, used only by `computePortraitLayout`.

This required threading a `marginY` parameter through `rowY`/`houseColumn`/
`foundationBlock`/`flankSlots` (previously hardcoded to the shared `ROW_MARGIN`), and
splitting `houseFanPeek`'s single implicit `clear` constant into an explicit parameter — see
the new `houseFanAllowance(mode)` in `layout.ts`, called from both `scene.ts` sites that call
`houseFanPeek` so the fan clamp uses the right budget per mode. Verified live: at 1440×900
landscape, cards are visibly larger than before this change, with portrait unaffected at any
viewport (confirmed no shared geometry regressed).

Not done in this pass: the `pileLayout` (ROWS/SIDES) setting itself — this only changes the
*existing* landscape flank arrangement's constants, it doesn't add the alternate ROWS
arrangement (`DESIGN_RULES.md` §5's "optional rows arrangement," a Settings-gated variant
that reuses the portrait six-row graph verbatim at landscape's wider canvas). That, and the
Settings screen needed to expose it, remain deferred (see the toolbar feature entry above).

## Rules question, confirmed not a rule: empty house doesn't force a waste-pile fill once reserve is empty

Direct user question: "if there is an open house, I think it has to be put first from the
waste pile, if the crapot [reserve] pile is empty." Checked against
pagat.com/patience/crapette.html directly — **not a rule**. The compulsory
"fill an empty house before drawing" requirement is explicitly scoped to reserve cards
only ("If you have any cards in your reserve, then... you must fill any empty spaces in
the tableau from your reserve") — the obligation ends once the reserve is empty. A waste
card can still always be *voluntarily* played into an empty house (an empty house accepts
any available card, from any source), it's just never forced. No code change — the
engine already implements exactly this (`canDrawHand` in `moveResolver.ts` only gates on
`p.reserve.length > 0 && hasEmptyHouse(state)`).

## Known limitation: mobile touch targets slightly under the 44×44px guideline

The letterboxed scale on common phone portrait sizes (e.g. 375×667, 390×844) comes out
around 0.41–0.43, making each card's touch target roughly 39×57 CSS px — still below
§5's 44×44px minimum on the width axis specifically (height clears it). The bottleneck is
`LOGICAL_HEIGHT` (1104px, 6 stacked rows) being tall relative to `LOGICAL_WIDTH`, not
`CARD_WIDTH` itself — fixing it properly would mean shrinking vertical spacing/margins
across the whole table, affecting the already-tuned desktop layout too. Tablet and up are
unaffected. Deliberately left as-is per direct user direction — don't "fix" this by
silently shrinking `ROW_GAP`/`ROW_MARGIN`; it needs the same explicit trade-off
conversation if revisited, since it directly affects desktop card size too.

## Known non-bug: rare simulate.ts "failure" on seed 3925 (and similar)

`npm run simulate -- --games 5000` will very occasionally (~1-in-5000 seeds) report a
game exceeding `MAX_MOVES_PER_GAME` in `src/cli/simulate.ts`. Investigated and confirmed
**not an engine bug**: with two decks in play, a card can legally ping-pong forever
between two houses whose top cards are two different copies of the same rank+color (e.g.
5♥ onto either of two black 6s, then back — both directions legal under the
alternating-color rule, returning to the exact same board state). A uniform-random bot
can rarely get stuck oscillating in such a pair. Confirmed via a throwaway script that
re-ran the capped seed with periodic state-signature logging — the signature repeated
exactly every ~2000 moves. Don't "fix" this by making the harness smarter; it's
deliberately dumb/uniform-random per the brief. If it starts happening much more often
than ~1-in-thousands, that would be worth re-investigating.

## Known non-bug: rare simulate.ts "failure" on seed 885 with `--heuristic-human --heuristic-cpu`

Same `MAX_MOVES_PER_GAME` cap, same ~1-in-5000 rarity, different mechanism, and **only
reachable in this specific harness configuration** — running the deterministic
`cpuPlayer.ts` heuristic on *both* sides at once. Investigated: the two fully
deterministic policies can lock into a repeating macro-cycle spanning a full hand/waste
rotation (e.g. one side draws a card, plays it to one of its own houses, then discards its
next draw ending the turn; the other side immediately loads that exact card off the house
onto the first side's own waste pile and passes; repeat for the next card in hand, and so
on until the hand/waste reshuffles and the identical sequence recurs) — confirmed via a
throwaway script logging the move sequence leading into the cap. `--heuristic-cpu` alone
and `--heuristic-human` alone are each clean across 5000 seeds (0 failures) — this cycle
needs *both* sides playing the exact same deterministic policy with no randomness anywhere
to break the symmetry, which never happens in actual v1 play (the human side is a real
person, not a second copy of the CPU's policy). Don't chase this with more scoring
heuristics in `cpuPlayer.ts` or add cycle-detection machinery for a configuration the
shipped game never exercises; `--heuristic-human --heuristic-cpu` remains available in the
harness for CPU-heuristic regression testing, just expect this same ~1-in-5000 rate.
