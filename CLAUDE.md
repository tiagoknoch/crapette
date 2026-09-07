# Crapette

Web implementation of Crapette (Russian Bank), single-player vs CPU for v1. Full
tech spec: [`docs/tech-spec.md`](docs/tech-spec.md) — canonical source for rules (§2),
data model (§3), architecture (§4), stack/licensing (§12), and build order (§14). Read
it before making structural changes.

Detailed build history (what was built, in what order, and why — including every
"per direct user direction" deviation from the spec) lives in
[`docs/build-log.md`](docs/build-log.md), not here. Investigated gotchas and
"looks like a bug but isn't" cases live in
[`docs/known-issues.md`](docs/known-issues.md) — check there before re-investigating
something that looks suspicious.

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

Feature-complete v1: engine, CPU heuristic AI, PixiJS rendering (tap-to-select +
drag-and-drop, tweened moves/flips), i18n (en/pt with a manual switcher), and
localStorage autosave/resume are all built and working. Nothing under `/src/ui` exists
as a separate directory — all HUD/modal code (pile counts, end screen, About/Legal, New
Game confirm popover, How to Play, Settings stub, EN/PT toolbar toggle) lives directly in
`src/render/pixi/scene.ts`, in a top toolbar band (replacing an earlier footer row — see
`docs/known-issues.md`'s toolbar entry). See `docs/build-log.md` for the full step-by-step
history.

The engine/AI/CLI/render/state code is still young — fields or functions with no usages
elsewhere in the repo are safe to add, rename, or remove as the implementation is worked
out; this isn't yet a stable public API with external callers to preserve compatibility
for.

## Things that deviate from tech-spec.md — trust the code, not the spec text

These are deliberate, direct-user-directed deviations; the spec doc's prose was never
edited to match. Full rationale for each is in `docs/build-log.md`.

- **Input** (§6): reactive-only, no legal-move highlighting or pre-disabling — every
  action is attempted, rejections get a red flash + reason banner. Drag-and-drop exists
  alongside tap-to-select but follows the same no-hints philosophy. One narrow exception,
  added with the redesign: a compulsory move's source gets a ring and every ineligible
  pile dims — that's surfacing state the engine already gates clicks on, not a hint about
  what to play, so it doesn't compromise the no-hints rule.
- Foundations are visually grouped by suit (alternating black/red rows) but the engine
  still treats all 8 slots as interchangeable — display-only, see
  `computeFoundationDisplayOrder` in `layout.ts`.
- Houses fan horizontally (outward, away from the foundations), not vertically.
- Each player's two decks are shuffled/dealt independently (never one combined 104-card
  pool) — `docs/tech-spec.md` §2 itself was wrong here and has been corrected.

(§5's tableau-layout and mobile-rotate-prompt deviations that used to live here are gone —
the redesign pass rewrote §5 to describe the actual geometry, including the landscape
flank arrangement, and deleted the rotate-to-continue prompt entirely now that both
portrait and landscape are fully supported. See `docs/known-issues.md`.)

## Rules to not accidentally re-break

- **Never put a click handler on a `Graphics` object anywhere in `scene.ts`** — board
  tiles included, not just modal/overlay layers as first diagnosed. In this codebase's
  pixi.js version, an interactive `Graphics` reliably fails hit-testing; re-confirmed
  during the redesign pass when a new interactive empty-foundation/empty-house `Graphics`
  silently ate every click on a board tile, not just in a modal. Put all interactivity
  (`eventMode`, `cursor`, `.hitArea`, `pointertap`) on a `Text` object instead (a real
  label, or an empty dummy for a fully invisible hit zone), via `makeButtonHitTarget`.
  Full story: `docs/known-issues.md`.
- **Stalemate's `roundsWithoutProgress` threshold is dynamic** (`2 * max(humanCycleSize,
  cpuCycleSize)` in `winCheck.ts`'s `checkStalemate`), not a fixed count — a fixed
  threshold (the spec's original text) fires far too early. Full story:
  `docs/known-issues.md`.
- **`layout.ts`'s `TableMode` (`'portrait'`/`'landscape'`) is chosen by aspect ratio**
  (`chooseTableMode`, width ≥ height → landscape) and can change live on resize — `scene.ts`
  rebuilds its mode-dependent static chrome (backdrop, slot outlines, toolbar/HUD
  positions) whenever that happens, and fires `onModeChange` so `main.ts` re-renders
  gameplay content too. A change here needs both halves kept in sync, not just
  `computeTableLayout`'s geometry.
- Card art is vendored from `htdebeer/SVG-cards` (LGPL-2.1) into `public/cards/` — see
  `public/cards/CREDIT.md` and the required in-app About/Legal credit (§12).
- Every genuinely new deal logs `[crapette] seed: <n>` and persists it to
  `localStorage['crapette-seed-v1']` (`dealWithLoggedSeed()` in `main.ts`) — ask for that
  seed (or the `crapette-save-v1` blob, while the tab's still open) when debugging a
  reported game state, instead of trying to reconstruct it another way.
- `npm run simulate` can rarely report a capped/failed game on specific seeds — these are
  investigated non-bugs, not new failures. Check `docs/known-issues.md` before
  re-investigating.

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
  instead (see `docs/known-issues.md` before running both flags together).
- `npm run dev` / `npm run build` — Vite dev server / production build.

## Conventions

- No TS `enum` — use string-literal union types (`erasableSyntaxOnly` is set in
  `tsconfig.json`), matching the spec's data model style.
- Vitest tests are colocated next to the module they test (`foo.ts` + `foo.test.ts`).
- The CLI harness (`src/cli/simulate.ts`) imports only from `/src/engine` and
  `/src/ai` — no rendering/UI code.
- `src/render/layout.ts` is pure geometry with zero Pixi imports (mirrors the
  `/src/engine` purity rule, one level down); actual PixiJS usage is confined to
  `src/render/pixi/`.
