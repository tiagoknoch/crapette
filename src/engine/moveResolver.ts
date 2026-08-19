import { canLoadPile, canPlayToFoundation, canPlayToHouse, isForbiddenDestination } from './rules.ts';
import type { Card, GameState, Move, MoveEvaluation, PileRef, PlayerId } from './types.ts';

const PLAYER_IDS: PlayerId[] = ['human', 'cpu'];
const HOUSE_INDICES = [0, 1, 2, 3] as const;

function other(player: PlayerId): PlayerId {
  return player === 'human' ? 'cpu' : 'human';
}

export function getPileCards(state: GameState, ref: PileRef): Card[] {
  switch (ref.type) {
    case 'reserve':
      return state.players[ref.owner].reserve;
    case 'house':
      return state.players[ref.owner].houses[ref.index];
    case 'hand':
      return state.players[ref.owner].hand;
    case 'waste':
      return state.players[ref.owner].waste;
    case 'foundation':
      return state.foundations[ref.index].cards;
  }
}

function pileRefEquals(a: PileRef, b: PileRef): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'foundation' && b.type === 'foundation') return a.index === b.index;
  if (a.type === 'house' && b.type === 'house') return a.owner === b.owner && a.index === b.index;
  if ((a.type === 'reserve' && b.type === 'reserve') || (a.type === 'hand' && b.type === 'hand') || (a.type === 'waste' && b.type === 'waste')) {
    return a.owner === b.owner;
  }
  return false;
}

export function hasEmptyHouse(state: GameState): boolean {
  return PLAYER_IDS.some((p) => state.players[p].houses.some((h) => h.length === 0));
}

interface Source {
  card: Card;
  from: PileRef;
}

// §2 "Available cards for the player on turn": own reserve top, any house's outer card
// (shared tableau), own hand's top card once turned up, own waste top (v1 variant).
export function getAvailableSources(state: GameState, player: PlayerId): Source[] {
  const p = state.players[player];
  const sources: Source[] = [];

  if (p.reserve.length > 0) {
    sources.push({ card: p.reserve[p.reserve.length - 1], from: { type: 'reserve', owner: player } });
  }
  for (const owner of PLAYER_IDS) {
    for (const index of HOUSE_INDICES) {
      const house = state.players[owner].houses[index];
      if (house.length > 0) {
        sources.push({ card: house[house.length - 1], from: { type: 'house', owner, index } });
      }
    }
  }
  if (p.hand.length > 0 && p.hand[p.hand.length - 1].faceUp) {
    sources.push({ card: p.hand[p.hand.length - 1], from: { type: 'hand', owner: player } });
  }
  if (p.waste.length > 0) {
    sources.push({ card: p.waste[p.waste.length - 1], from: { type: 'waste', owner: player } });
  }
  return sources;
}

function foundationMovesForSource(state: GameState, source: Source): Move[] {
  const moves: Move[] = [];
  state.foundations.forEach((foundation, index) => {
    if (canPlayToFoundation(source.card, foundation) === null) {
      moves.push({ card: source.card, from: source.from, to: { type: 'foundation', index } });
    }
  });
  return moves;
}

function nonFoundationMovesForSource(state: GameState, player: PlayerId, source: Source): Move[] {
  const moves: Move[] = [];

  for (const owner of PLAYER_IDS) {
    for (const index of HOUSE_INDICES) {
      const to: PileRef = { type: 'house', owner, index };
      if (pileRefEquals(source.from, to)) continue;
      if (canPlayToHouse(source.card, state.players[owner].houses[index]) === null) {
        moves.push({ card: source.card, from: source.from, to });
      }
    }
  }

  const opponent = other(player);
  for (const type of ['reserve', 'waste'] as const) {
    const to: PileRef = { type, owner: opponent };
    if (pileRefEquals(source.from, to)) continue;
    if (isForbiddenDestination(to, player)) continue;
    if (canLoadPile(source.card, getPileCards(state, to)) === null) {
      moves.push({ card: source.card, from: source.from, to });
    }
  }

  return moves;
}

export interface LegalMoves {
  compulsory: Move[];
  optional: Move[];
}

// §2 compulsory priority: (1) reserve-top-to-foundation strictly forces before all else;
// else (2) any-available-card-to-foundation forces before non-foundation moves; else (3, per
// clarified scope) no move is forced — only the "draw hand" action is separately gated by
// canDrawHand, everything else here remains freely optional.
export function getLegalMoves(state: GameState, player: PlayerId): LegalMoves {
  const sources = getAvailableSources(state, player);
  const reserveSource = sources.find((s) => s.from.type === 'reserve');

  let compulsory: Move[] = [];
  if (reserveSource) {
    compulsory = foundationMovesForSource(state, reserveSource);
  }
  if (compulsory.length === 0) {
    compulsory = sources.flatMap((s) => foundationMovesForSource(state, s));
  }

  const optional = compulsory.length > 0 ? [] : sources.flatMap((s) => nonFoundationMovesForSource(state, player, s));

  return { compulsory, optional };
}

// §2 rule 3, gate-only scope: the player may not turn up a hand card while a compulsory
// foundation move is pending, while their reserve could still fill an empty house, or while
// a previously drawn hand card hasn't yet been played or discarded. Also false when there's
// nothing left to draw at all (hand and waste both empty — reachable if every hand card was
// played out via foundation/house/loading moves without ever being discarded to waste).
export function canDrawHand(state: GameState, player: PlayerId): boolean {
  const { compulsory } = getLegalMoves(state, player);
  if (compulsory.length > 0) return false;

  const p = state.players[player];
  if (p.hand.length === 0 && p.waste.length === 0) return false;
  if (p.hand.length > 0 && p.hand[p.hand.length - 1].faceUp) return false;
  if (p.reserve.length > 0 && hasEmptyHouse(state)) return false;

  return true;
}

function moveMatches(move: Move, candidate: Move): boolean {
  return move.card.id === candidate.card.id && pileRefEquals(move.to, candidate.to);
}

export function evaluateMove(state: GameState, move: Move): MoveEvaluation {
  const mover = state.turn;
  const sourcePile = getPileCards(state, move.from);
  const topOfSource = sourcePile[sourcePile.length - 1];

  if (!topOfSource || topOfSource.id !== move.card.id) {
    return { move, legal: false, reason: 'not-available' };
  }
  if (move.from.type === 'hand' && !topOfSource.faceUp) {
    return { move, legal: false, reason: 'not-available' };
  }
  if (isForbiddenDestination(move.to, mover)) {
    return { move, legal: false, reason: 'forbidden-destination' };
  }

  const { compulsory } = getLegalMoves(state, mover);
  if (compulsory.length > 0) {
    return compulsory.some((m) => moveMatches(move, m))
      ? { move, legal: true }
      : { move, legal: false, reason: 'compulsory-move-pending' };
  }

  const reason =
    move.to.type === 'foundation'
      ? canPlayToFoundation(topOfSource, state.foundations[move.to.index])
      : move.to.type === 'house'
        ? canPlayToHouse(topOfSource, state.players[move.to.owner].houses[move.to.index])
        : canLoadPile(topOfSource, getPileCards(state, move.to));

  return reason ? { move, legal: false, reason } : { move, legal: true };
}
