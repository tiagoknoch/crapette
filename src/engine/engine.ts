import { evaluateMove, getLegalMoves, type LegalMoves } from './moveResolver.ts';
import { computeStateSignature } from './stateSignature.ts';
import type { Card, GameState, Move, PlayerId, PlayerState } from './types.ts';

function otherPlayer(player: PlayerId): PlayerId {
  return player === 'human' ? 'cpu' : 'human';
}

// §2: "flip the waste pile over, without mixing the cards in it" — the card discarded
// first (bottom of waste) is drawn first from the new hand (top of hand), so the reversal
// preserves discard order as draw order.
function reshuffleWasteIntoHand(player: PlayerState): PlayerState {
  const hand: Card[] = player.waste
    .slice()
    .reverse()
    .map((c) => ({ ...c, faceUp: false }));
  return { ...player, hand, waste: [], needsHandReshuffle: false };
}

// §2/§3: playing the reserve's top card auto-flips the next reserve card face-up.
function removeTop(cards: Card[]): { removed: Card; rest: Card[] } {
  const rest = cards.slice(0, -1);
  const removed = cards[cards.length - 1];
  if (rest.length > 0) {
    rest[rest.length - 1] = { ...rest[rest.length - 1], faceUp: true };
  }
  return { removed, rest };
}

// applyMove(state, move) -> new GameState. Pure; throws if the move isn't legal right now —
// the engine never allows an illegal state transition to be constructed (§6).
export function applyMove(state: GameState, move: Move): GameState {
  const evaluation = evaluateMove(state, move);
  if (!evaluation.legal) {
    throw new Error(`illegal move: ${evaluation.reason}`);
  }

  const next = structuredClone(state);

  let card: Card;
  if (move.from.type === 'reserve') {
    const { removed, rest } = removeTop(next.players[move.from.owner].reserve);
    card = removed;
    next.players[move.from.owner].reserve = rest;
  } else if (move.from.type === 'house') {
    const house = next.players[move.from.owner].houses[move.from.index];
    card = house[house.length - 1];
    next.players[move.from.owner].houses[move.from.index] = house.slice(0, -1);
  } else if (move.from.type === 'hand') {
    const hand = next.players[move.from.owner].hand;
    card = hand[hand.length - 1];
    next.players[move.from.owner].hand = hand.slice(0, -1);
  } else if (move.from.type === 'waste') {
    const waste = next.players[move.from.owner].waste;
    card = waste[waste.length - 1];
    next.players[move.from.owner].waste = waste.slice(0, -1);
  } else {
    // A move never legitimately originates from a foundation — evaluateMove's legality
    // checks never produce one; kept only for TS exhaustiveness.
    throw new Error(`a move cannot originate from a foundation`);
  }

  if (move.to.type === 'foundation') {
    const foundation = next.foundations[move.to.index];
    if (foundation.suit === null) {
      foundation.suit = card.suit;
    }
    foundation.cards.push(card);
  } else if (move.to.type === 'house') {
    next.players[move.to.owner].houses[move.to.index].push(card);
  } else if (move.to.type === 'waste') {
    next.players[move.to.owner].waste.push(card);
  } else {
    // 'reserve' as a destination only ever reaches here via evaluateMove's legality
    // check, which forbids it — unreachable in practice, kept exhaustive for TS.
    next.players[move.to.owner].reserve.push(card);
  }

  next.turnMoveLog.push({ ...move, card });
  next.turnVisitedSignatures = [...next.turnVisitedSignatures, computeStateSignature(next)];
  return next;
}

// A move that only returns the board to a state already visited earlier this same turn
// isn't real progress — see docs/known-issues.md's turn-never-ends soft-lock write-up for
// why this matters (a reversible optional move, like one card endlessly swapping between
// two houses, has no other code path that ever stops it: a turn only ends via a discard or
// a pass, and passing is only reachable once zero optional moves remain).
function wouldCycle(state: GameState, move: Move): boolean {
  const next = applyMove(state, move);
  return state.turnVisitedSignatures.includes(computeStateSignature(next));
}

// Same shape as moveResolver.getLegalMoves, but with any optional move that would merely
// cycle back to an already-visited state this turn filtered out. Compulsory moves are
// never filtered (they only ever build onto a foundation, which never reverses, so they
// can't cycle). Callers deciding "is there anything worth doing, or should this player
// draw/pass instead" should use this instead of getLegalMoves directly; callers validating
// or rendering an actual candidate move (evaluateMove, drag/tap legality, compulsory-move
// highlighting) should keep using getLegalMoves as-is — a cycling move is still legal, a
// player just isn't forced to keep taking it forever.
export function getReachableLegalMoves(state: GameState, player: PlayerId): LegalMoves {
  const legal = getLegalMoves(state, player);
  if (legal.compulsory.length > 0) return legal;
  return { compulsory: [], optional: legal.optional.filter((m) => !wouldCycle(state, m)) };
}

// The "voluntarily turn up hand's top card" action (§2/§8). Reshuffles waste into hand
// immediately if the hand is empty mid-turn (per the resolved timing rule — this path is
// only reachable when the turn is still ongoing, never at the discard-ends-turn boundary).
export function drawFromHand(state: GameState, player: PlayerId): GameState {
  const next = structuredClone(state);
  let p = next.players[player];

  if (p.hand.length === 0) {
    if (p.waste.length === 0) {
      throw new Error('no cards left to draw: hand and waste are both empty');
    }
    p = reshuffleWasteIntoHand(p);
    next.players[player] = p;
  }

  p.hand[p.hand.length - 1] = { ...p.hand[p.hand.length - 1], faceUp: true };
  return next;
}

// The "drawn hand card is unplayable / not played" action — always ends the turn (§2).
// The deferred reshuffle-from-waste rule applies from here: if this empties the hand, the
// actual reshuffle happens at the start of this player's NEXT turn (see startTurn), giving
// the opponent one turn to load onto the exposed waste pile first.
export function discardDrawnCardToWaste(state: GameState, player: PlayerId): GameState {
  const next = structuredClone(state);
  const p = next.players[player];
  const top = p.hand[p.hand.length - 1];
  if (!top || !top.faceUp) {
    throw new Error('no drawn hand card to discard');
  }

  p.hand = p.hand.slice(0, -1);
  p.waste.push(top);
  next.turnMoveLog.push({ card: top, from: { type: 'hand', owner: player }, to: { type: 'waste', owner: player } });

  const madeProgress = next.turnMoveLog.length > 1;
  next.roundsWithoutProgress = madeProgress ? 0 : next.roundsWithoutProgress + 1;

  if (p.hand.length === 0) {
    p.needsHandReshuffle = true;
  }

  next.turn = otherPlayer(player);
  next.turnMoveLog = [];
  return next;
}

// A player with no compulsory move, no legal optional move, and nothing left to draw
// (hand and waste both empty — see moveResolver.canDrawHand) has no action available at
// all this turn. This isn't covered by §8's pseudocode directly, but follows the same
// §9 progress rule as discardDrawnCardToWaste: no moves logged this turn counts as no
// progress, ending the turn with zero cards touched.
export function passTurn(state: GameState, player: PlayerId): GameState {
  const next = structuredClone(state);
  const madeProgress = next.turnMoveLog.length > 0;
  next.roundsWithoutProgress = madeProgress ? 0 : next.roundsWithoutProgress + 1;
  next.turn = otherPlayer(player);
  next.turnMoveLog = [];
  return next;
}

// Called once at the start of each turn: performs the deferred waste->hand reshuffle if the
// previous turn ended with the hand empty (see discardDrawnCardToWaste).
export function startTurn(state: GameState): GameState {
  const next = structuredClone(state);
  const player = next.players[next.turn];
  if (player.needsHandReshuffle) {
    next.players[next.turn] = reshuffleWasteIntoHand(player);
  }
  // Callers (gameStore.ts, simulate.ts) call this at the start of every single step, not
  // just the first one of a turn — turnMoveLog is only ever empty at a genuine turn
  // boundary (it resets in discardDrawnCardToWaste/passTurn), so that's the one reliable
  // signal that this is a fresh turn needing a fresh visited-state list, not a repeated
  // no-op call mid-turn that would otherwise wipe out cycle-detection history.
  if (next.turnMoveLog.length === 0) {
    next.turnVisitedSignatures = [computeStateSignature(next)];
  }
  return next;
}
