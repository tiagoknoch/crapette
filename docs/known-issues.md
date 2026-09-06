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
(non-forced) geometry. The failure is specific to small button-sized `Graphics` siblings
in this layer structure — it does NOT affect `Graphics` hit-testing in general (card
sprites, `drawEmptyHitZone`'s invisible rects, and the modal backdrop/panel Graphics were
all independently re-verified still working).

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
