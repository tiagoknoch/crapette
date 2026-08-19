import { describe, expect, it } from 'vitest';
import { canLoadPile, canPlayToFoundation, canPlayToHouse, isForbiddenDestination } from './rules.ts';
import type { Card, FoundationSlot } from './types.ts';

function card(suit: Card['suit'], rank: Card['rank'], faceUp = true): Card {
  return { id: `${suit}${rank}`, suit, rank, faceUp };
}

describe('canPlayToFoundation', () => {
  it('accepts an Ace onto an empty slot', () => {
    const foundation: FoundationSlot = { suit: null, cards: [] };
    expect(canPlayToFoundation(card('H', 1), foundation)).toBeNull();
  });

  it('rejects a non-Ace onto an empty slot', () => {
    const foundation: FoundationSlot = { suit: null, cards: [] };
    expect(canPlayToFoundation(card('H', 2), foundation)).toBe('wrong-suit-sequence');
  });

  it('accepts the next rank up in the same suit', () => {
    const foundation: FoundationSlot = { suit: 'H', cards: [card('H', 1), card('H', 2)] };
    expect(canPlayToFoundation(card('H', 3), foundation)).toBeNull();
  });

  it('rejects a different suit even if the rank is right', () => {
    const foundation: FoundationSlot = { suit: 'H', cards: [card('H', 1), card('H', 2)] };
    expect(canPlayToFoundation(card('S', 3), foundation)).toBe('wrong-suit-sequence');
  });

  it('rejects a skipped rank', () => {
    const foundation: FoundationSlot = { suit: 'H', cards: [card('H', 1), card('H', 2)] };
    expect(canPlayToFoundation(card('H', 4), foundation)).toBe('wrong-suit-sequence');
  });
});

describe('canPlayToHouse', () => {
  it('accepts any card onto an empty house', () => {
    expect(canPlayToHouse(card('S', 13), [])).toBeNull();
  });

  it('accepts descending rank with alternating color', () => {
    // black 10 -> red 9
    expect(canPlayToHouse(card('H', 9), [card('S', 10)])).toBeNull();
  });

  it('rejects same-color descending rank', () => {
    // black 10 -> black 9 (same color, not alternating)
    expect(canPlayToHouse(card('C', 9), [card('S', 10)])).toBe('wrong-house-sequence');
  });

  it('rejects non-descending rank even with alternating color', () => {
    expect(canPlayToHouse(card('H', 8), [card('S', 10)])).toBe('wrong-house-sequence');
  });
});

describe('canLoadPile', () => {
  it('rejects loading onto an empty pile (no exposed card to match)', () => {
    expect(canLoadPile(card('H', 5), [])).toBe('wrong-load-match');
  });

  it('accepts same suit, one rank above', () => {
    expect(canLoadPile(card('H', 6), [card('H', 5)])).toBeNull();
  });

  it('accepts same suit, one rank below', () => {
    expect(canLoadPile(card('H', 4), [card('H', 5)])).toBeNull();
  });

  it('rejects same rank distance but different suit', () => {
    expect(canLoadPile(card('S', 6), [card('H', 5)])).toBe('wrong-load-match');
  });

  it('rejects same suit but two ranks apart', () => {
    expect(canLoadPile(card('H', 7), [card('H', 5)])).toBe('wrong-load-match');
  });
});

describe('isForbiddenDestination', () => {
  it('forbids either player’s hand as a destination', () => {
    expect(isForbiddenDestination({ type: 'hand', owner: 'human' }, 'human')).toBe(true);
    expect(isForbiddenDestination({ type: 'hand', owner: 'cpu' }, 'human')).toBe(true);
  });

  it('forbids the mover’s own reserve', () => {
    expect(isForbiddenDestination({ type: 'reserve', owner: 'human' }, 'human')).toBe(true);
  });

  it('allows the opponent’s reserve (loading target)', () => {
    expect(isForbiddenDestination({ type: 'reserve', owner: 'cpu' }, 'human')).toBe(false);
  });

  it('forbids the mover’s own waste', () => {
    expect(isForbiddenDestination({ type: 'waste', owner: 'human' }, 'human')).toBe(true);
  });

  it('allows the opponent’s waste (loading target)', () => {
    expect(isForbiddenDestination({ type: 'waste', owner: 'cpu' }, 'human')).toBe(false);
  });

  it('allows houses (shared tableau) and foundations', () => {
    expect(isForbiddenDestination({ type: 'house', owner: 'human', index: 0 }, 'human')).toBe(false);
    expect(isForbiddenDestination({ type: 'house', owner: 'cpu', index: 0 }, 'human')).toBe(false);
    expect(isForbiddenDestination({ type: 'foundation', index: 0 }, 'human')).toBe(false);
  });
});
