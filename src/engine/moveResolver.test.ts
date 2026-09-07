import { describe, expect, it } from 'vitest';
import { canDrawHand, evaluateMove, getLegalMoves } from './moveResolver.ts';
import type { Card, GameState, PlayerId, PlayerState } from './types.ts';

function card(suit: Card['suit'], rank: Card['rank'], faceUp = true): Card {
  return { id: `${suit}${rank}-${faceUp}`, suit, rank, faceUp };
}

function emptyPlayer(id: PlayerId): PlayerState {
  return { id, reserve: [], houses: [[], [], [], []], hand: [], waste: [], needsHandReshuffle: false };
}

function emptyState(turn: PlayerId = 'human'): GameState {
  return {
    players: { human: emptyPlayer('human'), cpu: emptyPlayer('cpu') },
    foundations: Array.from({ length: 8 }, () => ({ suit: null, cards: [] })),
    turn,
    turnMoveLog: [],
    status: 'in_progress',
    roundsWithoutProgress: 0,
    turnVisitedSignatures: [],
  };
}

describe('getLegalMoves — compulsory priority (§2)', () => {
  it('category 1: reserve-top-to-foundation is forced, excluding other foundation-eligible cards', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 1)]; // Ace of Hearts — foundation-eligible
    state.players.human.houses[0] = [card('S', 1)]; // Ace of Spades — also foundation-eligible

    const { compulsory } = getLegalMoves(state, 'human');
    expect(compulsory.length).toBeGreaterThan(0);
    expect(compulsory.every((m) => m.card.suit === 'H' && m.card.rank === 1)).toBe(true);
    expect(compulsory.some((m) => m.card.suit === 'S')).toBe(false);
  });

  it('category 2: any-available-card-to-foundation is forced when the reserve top has no foundation play', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 5)]; // no foundation play (only Aces fit empty slots)
    state.players.human.houses[0] = [card('S', 1)];
    state.players.human.waste = [card('D', 1)];

    const { compulsory } = getLegalMoves(state, 'human');
    const cardIds = new Set(compulsory.map((m) => m.card.id));
    expect(cardIds.has(card('S', 1).id)).toBe(true);
    expect(cardIds.has(card('D', 1).id)).toBe(true);
    expect(compulsory.some((m) => m.card.rank === 5)).toBe(false);
  });

  it('category 3 (clarified scope): empty-house + non-empty reserve does NOT restrict the move set, only gates draw-hand', () => {
    const state = emptyState();
    state.players.human.reserve = [card('S', 7)];
    state.players.human.houses = [[], [card('H', 8)], [card('C', 9)], []]; // one non-empty house to build onto, one empty
    // no foundation-eligible card anywhere (foundations empty, no aces available)

    const { compulsory, optional } = getLegalMoves(state, 'human');
    expect(compulsory).toEqual([]);
    // reserve-to-empty-house is present as an *optional* move, not forced
    expect(
      optional.some((m) => m.card.id === card('S', 7).id && m.to.type === 'house' && m.to.index === 0),
    ).toBe(true);
    // an unrelated optional move (house-to-house build) is also freely available
    expect(
      optional.some((m) => m.card.id === card('H', 8).id && m.to.type === 'house' && m.to.index === 2),
    ).toBe(true);
  });
});

describe('canDrawHand', () => {
  it('is false while a compulsory move is pending', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 1)];
    expect(canDrawHand(state, 'human')).toBe(false);
  });

  it('is false while reserve is non-empty and an empty house exists (even with no compulsory move)', () => {
    const state = emptyState();
    state.players.human.reserve = [card('S', 7)];
    state.players.human.houses = [[], [], [], []];
    expect(canDrawHand(state, 'human')).toBe(false);
  });

  it('is true once reserve is empty or no empty house remains, with no compulsory move', () => {
    const state = emptyState();
    state.players.human.reserve = [];
    state.players.human.houses = [[], [card('H', 8)], [card('C', 9)], []];
    state.players.human.waste = [card('D', 2)]; // something left to draw
    expect(canDrawHand(state, 'human')).toBe(true);
  });

  it('is false while a previously drawn hand card sits unresolved (face-up on top of hand)', () => {
    const state = emptyState();
    state.players.human.hand = [card('H', 4, true)];
    expect(canDrawHand(state, 'human')).toBe(false);
  });

  it('is false when hand and waste are both empty (nothing left to draw)', () => {
    const state = emptyState();
    state.players.human.reserve = [];
    state.players.human.houses = [[], [card('H', 8)], [card('C', 9)], []];
    expect(canDrawHand(state, 'human')).toBe(false);
  });
});

describe('evaluateMove', () => {
  it('accepts a legal foundation move', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 1)];
    const move = { card: card('H', 1), from: { type: 'reserve' as const, owner: 'human' as const }, to: { type: 'foundation' as const, index: 0 } };
    expect(evaluateMove(state, move)).toEqual({ move, legal: true });
  });

  it('rejects a card that is not the exposed top of its stated source pile', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 1), card('H', 5)]; // top is H5, not H1
    const move = { card: card('H', 1), from: { type: 'reserve' as const, owner: 'human' as const }, to: { type: 'foundation' as const, index: 0 } };
    expect(evaluateMove(state, move).reason).toBe('not-available');
  });

  it('rejects moving onto one’s own reserve', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('H', 5)];
    const move = { card: card('H', 5), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'reserve' as const, owner: 'human' as const } };
    expect(evaluateMove(state, move).reason).toBe('forbidden-destination');
  });

  it('rejects a non-compulsory-set move while a compulsory move is pending', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 1)]; // forces H1 -> foundation
    state.players.human.houses[0] = [card('S', 8)];
    state.players.human.houses[1] = [card('H', 7)]; // legal house build target for S8, but not compulsory
    const move = { card: card('S', 8), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 1 as const } };
    expect(evaluateMove(state, move).reason).toBe('compulsory-move-pending');
  });

  it('passes through the specific rules.ts reason for an illegal house build', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('S', 8)];
    state.players.human.houses[1] = [card('C', 7)]; // same color as S8 — illegal
    const move = { card: card('S', 8), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 1 as const } };
    expect(evaluateMove(state, move).reason).toBe('wrong-house-sequence');
  });

  it('allows loading onto the opponent’s waste pile', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('H', 6)];
    state.players.cpu.waste = [card('H', 5)];
    const move = { card: card('H', 6), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'waste' as const, owner: 'cpu' as const } };
    expect(evaluateMove(state, move)).toEqual({ move, legal: true });
  });
});
