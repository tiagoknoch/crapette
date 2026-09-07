// §14 step 7: owns the single mutable GameState and every discrete player action (select,
// attempt a move, draw, discard). Deliberately reactive-only: per direct user direction, the
// game never highlights legal destinations or disables illegal-looking actions in advance —
// it only reacts *after* an attempt, either applying it or showing why it was rejected. This
// keeps "finding the play" part of the challenge; a hint mode is a plausible future option
// but isn't built here.
//
// This is also step 8's "turn loop wiring" territory, but only the parts driven by a human
// click (turn-ending discard/pass, the deferred reshuffle, win/stalemate checks). CPU-side
// automatic play (cpuPlayer.ts on a timer) isn't wired in yet — both seats are click-driven
// for now, purely to make step 7's interaction testable end to end.
import { chooseCompulsoryMove, chooseMove, chooseOptionalMove } from '../ai/cpuPlayer.ts';
import { applyMove, discardDrawnCardToWaste, drawFromHand, getReachableLegalMoves, passTurn, startTurn } from '../engine/engine.ts';
import { canDrawHand, evaluateMove, getAvailableSources, getLegalMoves, hasEmptyHouse } from '../engine/moveResolver.ts';
import type { Card, GameState, Move, PileRef, PlayerId, RejectReason } from '../engine/types.ts';
import { checkStalemate, checkWin } from '../engine/winCheck.ts';
import { i18next } from '../i18n/index.ts';

export type UiRejectReason = RejectReason | 'must-fill-empty-house' | 'nothing-to-draw' | 'cannot-draw-yet';

const REASON_KEY: Record<UiRejectReason, string> = {
  'wrong-suit-sequence': 'reject.wrongSuitSequence',
  'wrong-house-sequence': 'reject.wrongHouseSequence',
  'wrong-load-match': 'reject.wrongLoadMatch',
  'not-available': 'reject.notAvailable',
  'compulsory-move-pending': 'reject.compulsoryMovePending',
  'forbidden-destination': 'reject.forbiddenDestination',
  'must-fill-empty-house': 'reject.mustFillEmptyHouse',
  'nothing-to-draw': 'reject.nothingToDraw',
  'cannot-draw-yet': 'reject.cannotDrawYet',
};

export interface Flash {
  ref: PileRef;
  message: string;
}

function refsEqual(a: PileRef, b: PileRef): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'foundation' && b.type === 'foundation') return a.index === b.index;
  if (a.type === 'house' && b.type === 'house') return a.owner === b.owner && a.index === b.index;
  if ((a.type === 'reserve' && b.type === 'reserve') || (a.type === 'hand' && b.type === 'hand') || (a.type === 'waste' && b.type === 'waste')) {
    return a.owner === b.owner;
  }
  return false;
}

const RANK_LABEL: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
const SUIT_GLYPH: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

function cardLabel(card: Card): string {
  return `${RANK_LABEL[card.rank] ?? card.rank}${SUIT_GLYPH[card.suit]}`;
}

function pileLabel(ref: PileRef): string {
  if (ref.type === 'foundation') return `foundation[${ref.index}]`;
  if (ref.type === 'house') return `${ref.owner}.house[${ref.index}]`;
  return `${ref.owner}.${ref.type}`;
}

// Everything meaningful the store does gets logged to the console — there's no in-app HUD
// or move log yet (that's step 9), and this is the cheapest way to have something readable
// to point at while testing interactively.
function log(...parts: unknown[]): void {
  console.log('[crapette]', ...parts);
}

function topCardOf(state: GameState, ref: PileRef): Card | undefined {
  const cards =
    ref.type === 'reserve'
      ? state.players[ref.owner].reserve
      : ref.type === 'hand'
        ? state.players[ref.owner].hand
        : ref.type === 'waste'
          ? state.players[ref.owner].waste
          : ref.type === 'house'
            ? state.players[ref.owner].houses[ref.index]
            : state.foundations[ref.index].cards;
  return cards[cards.length - 1];
}

// §14 step 11/§10: localStorage key + shape guard. `localStorage` calls are wrapped —
// private-browsing quota errors or storage being disabled shouldn't ever break an in-progress
// move, persistence is a nice-to-have layered on top of a game that already works without it.
const SAVE_KEY = 'crapette-save-v1';

// A cheap structural sanity check, not a full schema validator — enough to catch a corrupted
// or foreign localStorage value (hand-edited, or written by some future incompatible save
// format) without crashing later on `state.players.human.reserve` etc. being undefined.
function isPlausibleGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<GameState>;
  return (
    (v.status === 'in_progress' || v.status === 'won' || v.status === 'stalemate') &&
    (v.turn === 'human' || v.turn === 'cpu') &&
    Array.isArray(v.foundations) &&
    v.foundations.length === 8 &&
    typeof v.players === 'object' &&
    v.players !== null &&
    'human' in v.players &&
    'cpu' in v.players
  );
}

function saveGame(toSave: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave));
  } catch {
    // see comment above SAVE_KEY
  }
}

// §10: "on load, if a save exists and game is in_progress, offer Resume vs New Game;
// otherwise start fresh" — the in_progress check is main.ts's call (it decides whether to
// prompt), this just hands back whatever's there (of any status) or null.
export function loadSavedGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPlausibleGameState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let state: GameState;
let selected: PileRef | null = null;
let flash: Flash | null = null;
let flashTimeout: ReturnType<typeof setTimeout> | undefined;
// Redesign v2 handoff (README.md §5): the CPU turn indicator's live description of what the
// CPU is currently doing — set at the same three cpuStep()/resolveCpuDrawnCard() branches
// that already log a move/draw to the console, so it's read, not recomputed. Composed only
// of engine types (Move) plus a plain string literal, deliberately not a new exported type —
// the render layer (scene.ts) never imports from this module (see CLAUDE.md's architecture
// rule), so this stays something it can already type-check structurally.
let cpuActivity: Move | 'drawing' | null = null;
const listeners: Array<() => void> = [];

export function initGameStore(initialState: GameState): void {
  state = initialState;
  selected = null;
  flash = null;
  cpuActivity = null;
  saveGame(state);
}

export function getState(): GameState {
  return state;
}

export function getSelected(): PileRef | null {
  return selected;
}

export function getFlash(): Flash | null {
  return flash;
}

// Redesign: exposes the human's own currently-pending compulsory move(s) (if any) so the
// renderer can show a forced-move banner/ring/dimming — pure read of what getLegalMoves
// already computes for click-gating (see attemptMove's reject path), not new game state.
// Only meaningful during the human's own turn — the CPU resolves its forced moves
// automatically (see cpuStep), so there's nothing for a person to act on otherwise.
export function getCompulsoryMove(): Move[] | null {
  if (state.status !== 'in_progress' || state.turn !== 'human') return null;
  const compulsory = getLegalMoves(state, 'human').compulsory;
  return compulsory.length > 0 ? compulsory : null;
}

// Redesign v2 handoff (README.md §5): what the CPU is currently doing, for the CPU turn
// indicator's description text. Only meaningful during the CPU's own turn — a discard or a
// pass always ends it in the same cpuStep() call that set cpuActivity, so by the time a
// render reads this, state.turn has already flipped to 'human' and this already reads back
// null regardless of cpuActivity's last-set value (the gate below, not a separate reset, is
// what makes that true).
export function getCpuActivity(): Move | 'drawing' | null {
  return state.status === 'in_progress' && state.turn === 'cpu' ? cpuActivity : null;
}

export function subscribe(fn: () => void): void {
  listeners.push(fn);
}

function notify(): void {
  saveGame(state);
  listeners.forEach((fn) => fn());
}

function showReject(ref: PileRef, reason: UiRejectReason): void {
  const message = i18next.t(REASON_KEY[reason]);
  flash = { ref, message };
  log('rejected:', pileLabel(ref), '—', message);
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => {
    flash = null;
    notify();
  }, 900);
}

function logGameEndIfJustEnded(previousStatus: GameState['status']): void {
  if (previousStatus === 'in_progress' && state.status !== 'in_progress') {
    log(`game over: ${state.status}`, state.winner ? `winner=${state.winner}` : '', state.scores ?? '');
  }
}

function isSelectableSource(ref: PileRef, mover: PlayerId): boolean {
  return getAvailableSources(state, mover).some((s) => refsEqual(s.from, ref));
}

// A click on the player's own hand pile always attempts a draw — whether that pile
// currently shows a face-down card (the normal case) or is empty (canDrawHand/drawFromHand
// then decide what happens: reshuffle waste back into hand and draw if waste has cards,
// or a "nothing to draw" rejection if it's truly empty too). Real bug this fixed: an empty
// hand pile used to fail this check entirely (topCardOf returns undefined, so the old
// `top !== undefined && !top.faceUp` was false), meaning clicking it did nothing at all —
// isSelectableSource also excludes an empty hand (getAvailableSources requires a face-up
// top card), so there was no click that could ever reach drawFromHand's own reshuffle
// logic, leaving the player stuck once their hand pile emptied mid-turn (e.g. by playing
// their last hand card via a real move rather than a discard, so needsHandReshuffle was
// never set and startTurn()'s automatic reshuffle never had a reason to run either).
function isOwnHandDrawTarget(ref: PileRef, mover: PlayerId): boolean {
  if (ref.type !== 'hand' || ref.owner !== mover) return false;
  const top = topCardOf(state, ref);
  return top === undefined || !top.faceUp;
}

function performDiscard(mover: PlayerId): void {
  const previousStatus = state.status;
  const discarded = state.players[mover].hand.at(-1);
  state = checkStalemate(checkWin(discardDrawnCardToWaste(state, mover), mover));
  log(`${mover} discards ${discarded ? cardLabel(discarded) : '?'} to waste (turn ends)`);
  if (state.status === 'in_progress') state = startTurn(state);
  logGameEndIfJustEnded(previousStatus);
}

// Cascades forced consequences after any state-changing action, until reaching a point where
// a human decision is genuinely required (or the game has ended):
// - a compulsory move exists -> stop and wait, the human picks one
// - a *reachable* optional move exists (i.e. not merely a cycle back to a state already
//   seen this turn, per getReachableLegalMoves — see docs/known-issues.md's turn-never-ends
//   soft-lock write-up) -> stop and wait, the human picks one. The human can still see and
//   manually make a cycling move if they want to (it's still legal, just not one this gate
//   waits around for); this only stops treating its mere existence as "something to do."
// - a drawn hand card is sitting face-up -> stop and wait, *even if it has no legal move* —
//   discarding it is always something the player does explicitly (click it, click own
//   waste), per direct user direction: an automatic "can't play it, so it's silently
//   discarded and your turn is over" was surprising and gave no sense that anything had
//   happened. This module has no opinion on the drawn card beyond that: whatever the human
//   does with it next is on them.
// - otherwise, if drawing is possible -> stop and wait, the human can choose to draw
// - otherwise there is truly nothing worth doing this player can do at all (no drawn card
//   sitting there either) -> pass automatically; there's nothing to click
function settle(): void {
  while (state.status === 'in_progress') {
    const mover = state.turn;
    const legal = getReachableLegalMoves(state, mover);
    if (legal.compulsory.length > 0 || legal.optional.length > 0) return;

    const hand = state.players[mover].hand;
    const drawnCardPending = hand.length > 0 && hand[hand.length - 1].faceUp;
    if (drawnCardPending) return;

    if (canDrawHand(state, mover)) return;

    const previousStatus = state.status;
    log(`${mover} has no legal move and nothing to draw — turn passes`);
    state = checkStalemate(passTurn(state, mover));
    if (state.status === 'in_progress') state = startTurn(state);
    logGameEndIfJustEnded(previousStatus);
  }
}

function whyCannotDraw(mover: PlayerId): UiRejectReason {
  const p = state.players[mover];
  if (getLegalMoves(state, mover).compulsory.length > 0) return 'compulsory-move-pending';
  if (p.reserve.length > 0 && hasEmptyHouse(state)) return 'must-fill-empty-house';
  if (p.hand.length === 0 && p.waste.length === 0) return 'nothing-to-draw';
  return 'cannot-draw-yet';
}

function attemptDraw(mover: PlayerId): void {
  state = startTurn(state);
  if (!canDrawHand(state, mover)) {
    showReject({ type: 'hand', owner: mover }, whyCannotDraw(mover));
    return;
  }
  state = drawFromHand(state, mover);
  const drawn = state.players[mover].hand.at(-1);
  log(`${mover} draws ${drawn ? cardLabel(drawn) : '?'}`);
  settle();
}

// §8: discarding a drawn card is always the player's choice to make, even if it *could* be
// played elsewhere ("human: may choose to play or discard") — no legality gate here beyond
// there being a face-up drawn card to discard at all.
function discardDrawn(mover: PlayerId): void {
  state = startTurn(state);
  performDiscard(mover);
  settle();
}

// Returns whether the move was actually applied — the drag controller (see
// attemptDragMove/resolveMove below) needs this to tell a legal drop from a rejected one, to
// choose between letting it stand and playing the reject shake (DESIGN_RULES.md §7). The tap
// flow (handleSlotClick) ignores it; a rejected tap already gets its own flash overlay.
function attemptMove(move: Move, mover: PlayerId): boolean {
  state = startTurn(state);
  const evaluation = evaluateMove(state, move);
  if (!evaluation.legal) {
    showReject(move.to, evaluation.reason ?? 'not-available');
    return false;
  }
  const previousStatus = state.status;
  log(`${mover} plays ${cardLabel(move.card)}: ${pileLabel(move.from)} -> ${pileLabel(move.to)}`);
  state = checkStalemate(checkWin(applyMove(state, move), mover));
  logGameEndIfJustEnded(previousStatus);
  selected = null;
  settle();
  return true;
}

// §14 step 8: resolves the drawn card sitting face-up in the CPU's hand — mirrors
// simulate.ts's playHeuristicStep, scoped to only that exact card (see its comment for why:
// some other always-legal shuffle could otherwise get chosen instead, leaving the drawn card
// stuck forever).
function resolveCpuDrawnCard(): void {
  const hand = state.players.cpu.hand;
  const drawnId = hand[hand.length - 1].id;
  const afterDraw = getLegalMoves(state, 'cpu');
  const compulsoryForDrawn = afterDraw.compulsory.filter((m) => m.from.type === 'hand' && m.card.id === drawnId);
  const optionalForDrawn = afterDraw.optional.filter((m) => m.from.type === 'hand' && m.card.id === drawnId);
  const drawnMove =
    compulsoryForDrawn.length > 0
      ? chooseCompulsoryMove(compulsoryForDrawn)
      : optionalForDrawn.length > 0
        ? chooseOptionalMove(state, 'cpu', optionalForDrawn)
        : null;

  if (!drawnMove) {
    performDiscard('cpu');
    settle();
    return;
  }

  cpuActivity = drawnMove;
  const previousStatus = state.status;
  log(`cpu plays ${cardLabel(drawnMove.card)}: ${pileLabel(drawnMove.from)} -> ${pileLabel(drawnMove.to)}`);
  state = checkStalemate(checkWin(applyMove(state, drawnMove), 'cpu'));
  logGameEndIfJustEnded(previousStatus);
}

// §8/§14 step 8: drives the CPU's side of the turn loop — one discrete action per call, so
// main.ts can pace CPU turns visibly on a timer instead of resolving an entire turn in a
// single frame. A no-op unless it's actually the CPU's turn, so it's cheap to call on every
// tick regardless of whose turn it is.
export function cpuStep(): void {
  if (state.status !== 'in_progress' || state.turn !== 'cpu') return;
  state = startTurn(state);

  const hand = state.players.cpu.hand;
  const drawnPending = hand.length > 0 && hand[hand.length - 1].faceUp;
  if (drawnPending) {
    resolveCpuDrawnCard();
    notify();
    return;
  }

  const legal = getReachableLegalMoves(state, 'cpu');
  const move = chooseMove(state, 'cpu', legal);
  if (move) {
    cpuActivity = move;
    const previousStatus = state.status;
    log(`cpu plays ${cardLabel(move.card)}: ${pileLabel(move.from)} -> ${pileLabel(move.to)}`);
    state = checkStalemate(checkWin(applyMove(state, move), 'cpu'));
    logGameEndIfJustEnded(previousStatus);
    notify();
    return;
  }

  if (canDrawHand(state, 'cpu')) {
    state = drawFromHand(state, 'cpu');
    cpuActivity = 'drawing';
    const drawn = state.players.cpu.hand.at(-1);
    log(`cpu draws ${drawn ? cardLabel(drawn) : '?'}`);
    notify();
    return;
  }

  const previousStatus = state.status;
  log('cpu has no legal move and nothing to draw — turn passes');
  state = checkStalemate(passTurn(state, 'cpu'));
  if (state.status === 'in_progress') state = startTurn(state);
  logGameEndIfJustEnded(previousStatus);
  settle();
  notify();
}

// Shared by both the tap flow (source = the prior tap's `selected`) and the drag flow
// (source = wherever the drag gesture picked up from, see attemptDragMove) — everything
// past "we have a source and a distinct target" is identical for either input gesture.
// Doesn't touch `selected`, except where matching the original tap behavior requires it
// (the discard branch clears it unconditionally; that's a harmless no-op for drag, which
// never sets `selected` to begin with).
// Returns whether the action was actually applied — see attemptMove's comment; the discard
// special-case and the "no card there" defensive branch both count as "applied" (there was
// no legality question to reject), so only the regular attemptMove call can return false.
function resolveMove(source: PileRef, target: PileRef, mover: PlayerId): boolean {
  // Special case: targeting your own waste while your own drawn hand card is the source
  // means "discard it" — waste is otherwise always a forbidden destination for a regular
  // move (rules.ts), so this can't be reached any other way.
  if (source.type === 'hand' && source.owner === mover && target.type === 'waste' && target.owner === mover) {
    discardDrawn(mover);
    selected = null;
    return true;
  }

  const card = topCardOf(state, source);
  if (!card) {
    selected = null;
    return true;
  }
  return attemptMove({ card, from: source, to: target }, mover);
}

// The single entry point for every click on a pile slot (whether it currently holds a card
// or is empty) — see comment atop this file for the overall reactive-only interaction model.
// Only the human seat is click-driven (the CPU seat auto-plays via cpuStep on a timer, see
// main.ts), so a click during the CPU's turn is simply ignored.
export function handleSlotClick(ref: PileRef): void {
  if (state.status !== 'in_progress' || state.turn !== 'human') return;
  const mover = state.turn;

  if (selected === null) {
    if (isOwnHandDrawTarget(ref, mover)) {
      attemptDraw(mover);
    } else if (isSelectableSource(ref, mover)) {
      selected = ref;
      const card = topCardOf(state, ref);
      log(`${mover} picks up ${card ? cardLabel(card) : '?'} from ${pileLabel(ref)}`);
    } else {
      log(`${mover} clicks ${pileLabel(ref)} — not selectable (not their turn's available card)`);
    }
    notify();
    return;
  }

  if (refsEqual(ref, selected)) {
    log(`${mover} puts ${pileLabel(ref)} back down`);
    selected = null;
    notify();
    return;
  }

  resolveMove(selected, ref, mover);
  notify();
}

// Redesign v2 handoff (README.md §4): the drawn-card panel's two buttons — PLAY IT selects
// the just-drawn card as the tap-flow's source, same as tapping it directly, so the player
// still picks the actual destination afterward via the normal tap/drag flow (this never
// bypasses legality or reveals whether a legal play exists, unlike the mockup's own copy
// which states a legal-play count — see docs/known-issues.md for why that clause was
// dropped). Deliberately overwrites `selected` unconditionally rather than replicating tap
// semantics exactly: canDrawHand doesn't require the absence of other optional moves
// elsewhere, so some unrelated pile could already be selected when the panel's button is
// clicked, and "select this specific card" is the least surprising thing a dedicated button
// about the drawn card can do in that edge case.
export function selectDrawnCard(): void {
  if (state.status !== 'in_progress' || state.turn !== 'human') return;
  const ref: PileRef = { type: 'hand', owner: 'human' };
  if (!isSelectableSource(ref, 'human')) return; // defensive — the panel shouldn't show otherwise
  selected = ref;
  const card = topCardOf(state, ref);
  log(`human picks up ${card ? cardLabel(card) : '?'} from ${pileLabel(ref)}`);
  notify();
}

// DISCARD · END — mirrors handleSlotClick's discard special-case (resolveMove), but callable
// directly regardless of the current tap-selection state, same reasoning as
// selectDrawnCard above.
export function discardDrawnCard(): void {
  if (state.status !== 'in_progress' || state.turn !== 'human') return;
  const hand = state.players.human.hand;
  if (hand.length === 0 || !hand[hand.length - 1].faceUp) return; // defensive
  discardDrawn('human');
  selected = null;
  notify();
}

// §14 step 10.5 (drag-and-drop, added alongside tap-to-select rather than replacing it):
// a pure read-only check scene.ts's drag controller calls on `pointerdown` to decide
// whether to start tracking a drag gesture at all — never mutates state, so speculatively
// calling it (before knowing whether the gesture will turn out to be a tap or a real drag)
// is free. Only ever true for an actual move source (reserve/house/waste/face-up hand,
// see getAvailableSources) — the face-down talon's "draw" action stays tap-only, since
// there's nowhere meaningful to drag it to (drawing just flips it face-up in place).
export function canPickUp(ref: PileRef): boolean {
  return state.status === 'in_progress' && state.turn === 'human' && isSelectableSource(ref, state.turn);
}

// Mirrors handleSlotClick's second-tap branch (resolveMove), but for a drag gesture that
// picked `from` up and released over a different slot `to` — scene.ts's drag controller
// calls this once per completed drag (never for a plain tap, and never when dropped back
// onto its own origin), and it's responsible for its own notify() the same way
// handleSlotClick is for taps, since nothing else triggers a re-render after a drop.
// Returns whether the drop was accepted (see DropHandler in scene.ts) — the drag controller
// uses this to choose between letting the drop stand and playing the reject shake instead.
export function attemptDragMove(from: PileRef, to: PileRef): boolean {
  if (state.status !== 'in_progress' || state.turn !== 'human') return false;
  const mover = state.turn;
  if (!isSelectableSource(from, mover)) return false; // defensive; canPickUp already gated this at drag-start
  const card = topCardOf(state, from);
  log(`${mover} drags ${card ? cardLabel(card) : '?'}: ${pileLabel(from)} -> ${pileLabel(to)}`);
  const accepted = resolveMove(from, to, mover);
  notify();
  return accepted;
}
