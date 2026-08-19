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
import { applyMove, discardDrawnCardToWaste, drawFromHand, passTurn, startTurn } from '../engine/engine.ts';
import { canDrawHand, evaluateMove, getAvailableSources, getLegalMoves, hasEmptyHouse } from '../engine/moveResolver.ts';
import type { Card, GameState, Move, PileRef, PlayerId, RejectReason } from '../engine/types.ts';
import { checkStalemate, checkWin } from '../engine/winCheck.ts';

export type UiRejectReason = RejectReason | 'must-fill-empty-house' | 'nothing-to-draw' | 'cannot-draw-yet';

export const REASON_TEXT: Record<UiRejectReason, string> = {
  'wrong-suit-sequence': "Doesn't match that foundation's suit/sequence",
  'wrong-house-sequence': "Doesn't fit that house (needs descending rank, alternating color)",
  'wrong-load-match': "Doesn't match that pile's suit and rank (±1)",
  'not-available': "That card isn't available to move",
  'compulsory-move-pending': 'A forced move must be played first',
  'forbidden-destination': "You can't place a card there",
  'must-fill-empty-house': 'Fill the empty house from your reserve first',
  'nothing-to-draw': "There's nothing left to draw",
  'cannot-draw-yet': "You can't draw a card right now",
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

let state: GameState;
let selected: PileRef | null = null;
let flash: Flash | null = null;
let flashTimeout: ReturnType<typeof setTimeout> | undefined;
const listeners: Array<() => void> = [];

export function initGameStore(initialState: GameState): void {
  state = initialState;
  selected = null;
  flash = null;
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

export function subscribe(fn: () => void): void {
  listeners.push(fn);
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

function showReject(ref: PileRef, reason: UiRejectReason): void {
  flash = { ref, message: REASON_TEXT[reason] };
  log('rejected:', pileLabel(ref), '—', REASON_TEXT[reason]);
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

function isOwnFaceDownTalon(ref: PileRef, mover: PlayerId): boolean {
  if (ref.type !== 'hand' || ref.owner !== mover) return false;
  const top = topCardOf(state, ref);
  return top !== undefined && !top.faceUp;
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
// - a compulsory or optional move exists -> stop and wait, the human picks one
// - a drawn hand card is sitting face-up with *no* legal move for it -> it must be
//   discarded (§8: this is only a human *choice* when a legal move exists — see
//   handleSlotClick's own-waste special case for that path; with no legal move at all
//   there's nothing to choose between, so it's forced, not merely "stuck")
// - otherwise, if drawing is possible -> stop and wait, the human can choose to draw
// - otherwise there is truly nothing this player can do -> pass
function settle(): void {
  while (state.status === 'in_progress') {
    const mover = state.turn;
    const legal = getLegalMoves(state, mover);
    if (legal.compulsory.length > 0 || legal.optional.length > 0) return;

    const hand = state.players[mover].hand;
    const drawnCardPending = hand.length > 0 && hand[hand.length - 1].faceUp;
    if (drawnCardPending) {
      performDiscard(mover);
      continue;
    }

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

function attemptMove(move: Move, mover: PlayerId): void {
  state = startTurn(state);
  const evaluation = evaluateMove(state, move);
  if (!evaluation.legal) {
    showReject(move.to, evaluation.reason ?? 'not-available');
    return;
  }
  const previousStatus = state.status;
  log(`${mover} plays ${cardLabel(move.card)}: ${pileLabel(move.from)} -> ${pileLabel(move.to)}`);
  state = checkStalemate(checkWin(applyMove(state, move), mover));
  logGameEndIfJustEnded(previousStatus);
  selected = null;
  settle();
}

// The single entry point for every click on a pile slot (whether it currently holds a card
// or is empty) — see comment atop this file for the overall reactive-only interaction model.
export function handleSlotClick(ref: PileRef): void {
  if (state.status !== 'in_progress') return;
  const mover = state.turn;

  if (selected === null) {
    if (isOwnFaceDownTalon(ref, mover)) {
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

  // Special case: clicking your own waste while your own drawn hand card is selected means
  // "discard it" — waste is otherwise always a forbidden destination for a regular move
  // (rules.ts), so this can't be reached any other way.
  if (selected.type === 'hand' && selected.owner === mover && ref.type === 'waste' && ref.owner === mover) {
    discardDrawn(mover);
    selected = null;
    notify();
    return;
  }

  const card = topCardOf(state, selected);
  if (!card) {
    selected = null;
    notify();
    return;
  }
  attemptMove({ card, from: selected, to: ref }, mover);
  notify();
}
