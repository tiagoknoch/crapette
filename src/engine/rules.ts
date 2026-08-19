import type { Card, FoundationSlot, PlayerId, PileRef, RejectReason, Suit } from './types.ts';

function suitColor(suit: Suit): 'red' | 'black' {
  return suit === 'H' || suit === 'D' ? 'red' : 'black';
}

// §2 Foundation: empty slot accepts only an Ace; otherwise build up same suit, ascending.
export function canPlayToFoundation(card: Card, foundation: FoundationSlot): RejectReason | null {
  if (foundation.suit === null) {
    return card.rank === 1 ? null : 'wrong-suit-sequence';
  }
  const top = foundation.cards[foundation.cards.length - 1];
  if (card.suit === foundation.suit && card.rank === top.rank + 1) {
    return null;
  }
  return 'wrong-suit-sequence';
}

// §2 House: empty house accepts any card; otherwise descending rank, alternating color.
export function canPlayToHouse(card: Card, house: Card[]): RejectReason | null {
  if (house.length === 0) {
    return null;
  }
  const top = house[house.length - 1];
  if (card.rank === top.rank - 1 && suitColor(card.suit) !== suitColor(top.suit)) {
    return null;
  }
  return 'wrong-house-sequence';
}

// §2 Loading (opponent's reserve or waste only): same suit, exactly one rank above or below
// the current exposed card. An empty pile has no exposed card to match, so nothing loads onto it.
export function canLoadPile(card: Card, pile: Card[]): RejectReason | null {
  if (pile.length === 0) {
    return 'wrong-load-match';
  }
  const top = pile[pile.length - 1];
  if (card.suit === top.suit && Math.abs(card.rank - top.rank) === 1) {
    return null;
  }
  return 'wrong-load-match';
}

// §2 "Illegal destinations, always: your own reserve (never load onto it), either player's
// hand." Plus §3's RejectReason note that a move's own waste pile is also always forbidden
// as a destination (waste is only ever reached via the discard-drawn-card action, not a
// generic move).
export function isForbiddenDestination(to: PileRef, mover: PlayerId): boolean {
  if (to.type === 'hand') {
    return true;
  }
  if (to.type === 'reserve' && to.owner === mover) {
    return true;
  }
  if (to.type === 'waste' && to.owner === mover) {
    return true;
  }
  return false;
}
