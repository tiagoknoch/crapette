import { describe, expect, it } from 'vitest';
import { applyMove, discardDrawnCardToWaste, drawFromHand, passTurn, startTurn } from './engine.ts';
import type { Card, GameState, PlayerId, PlayerState } from './types.ts';

function card(suit: Card['suit'], rank: Card['rank'], faceUp = true, tag = ''): Card {
  return { id: `${suit}${rank}${tag}`, suit, rank, faceUp };
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
  };
}

describe('applyMove', () => {
  it('moves the card, auto-flips the next reserve card, and logs the move', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 5, false), card('H', 1, true)];
    const move = {
      card: card('H', 1, true),
      from: { type: 'reserve' as const, owner: 'human' as const },
      to: { type: 'foundation' as const, index: 0 },
    };

    const next = applyMove(state, move);

    expect(next.players.human.reserve).toHaveLength(1);
    expect(next.players.human.reserve[0].faceUp).toBe(true); // auto-flipped
    expect(next.foundations[0].suit).toBe('H');
    expect(next.foundations[0].cards.map((c) => c.id)).toEqual([card('H', 1).id]);
    expect(next.turnMoveLog).toHaveLength(1);
    // original state is untouched (pure)
    expect(state.players.human.reserve).toHaveLength(2);
    expect(state.turnMoveLog).toHaveLength(0);
  });

  it('sets a foundation slot’s suit on the first Ace placed there', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('S', 1)];
    const move = {
      card: card('S', 1),
      from: { type: 'house' as const, owner: 'human' as const, index: 0 as const },
      to: { type: 'foundation' as const, index: 3 },
    };
    const next = applyMove(state, move);
    expect(next.foundations[3].suit).toBe('S');
  });

  it('allows loading a card onto the opponent’s waste pile', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('H', 6)];
    state.players.cpu.waste = [card('H', 5)];
    const move = {
      card: card('H', 6),
      from: { type: 'house' as const, owner: 'human' as const, index: 0 as const },
      to: { type: 'waste' as const, owner: 'cpu' as const },
    };
    const next = applyMove(state, move);
    expect(next.players.cpu.waste.map((c) => c.id)).toEqual([card('H', 5).id, card('H', 6).id]);
  });

  it('throws on an illegal move instead of silently applying it', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('H', 5)];
    const move = {
      card: card('H', 5),
      from: { type: 'house' as const, owner: 'human' as const, index: 0 as const },
      to: { type: 'reserve' as const, owner: 'human' as const }, // forbidden
    };
    expect(() => applyMove(state, move)).toThrow(/illegal move/);
  });
});

describe('drawFromHand', () => {
  it('flips the top hand card face-up without removing it', () => {
    const state = emptyState();
    state.players.human.hand = [card('C', 2, false), card('C', 3, false)];
    const next = drawFromHand(state, 'human');
    expect(next.players.human.hand).toHaveLength(2);
    expect(next.players.human.hand[1].faceUp).toBe(true);
    expect(next.players.human.hand[0].faceUp).toBe(false);
  });

  it('reshuffles waste into hand immediately when hand is empty mid-turn, preserving discard order as draw order', () => {
    const state = emptyState();
    // waste built up in discard order: D2 discarded first, then D3, then D4 (top)
    state.players.human.waste = [card('D', 2), card('D', 3), card('D', 4)];
    state.players.human.hand = [];

    const next = drawFromHand(state, 'human');

    expect(next.players.human.waste).toHaveLength(0);
    // D2 (first discarded) should be drawn first -> ends up on top of the new hand
    expect(next.players.human.hand.map((c) => c.id)).toEqual([card('D', 4).id, card('D', 3).id, card('D', 2).id]);
    expect(next.players.human.hand[next.players.human.hand.length - 1].faceUp).toBe(true);
    expect(next.players.human.hand.slice(0, -1).every((c) => c.faceUp === false)).toBe(true);
  });

  it('throws when both hand and waste are empty', () => {
    const state = emptyState();
    expect(() => drawFromHand(state, 'human')).toThrow(/no cards left/);
  });
});

describe('discardDrawnCardToWaste', () => {
  it('moves the drawn card to waste and switches the turn', () => {
    const state = emptyState('human');
    state.players.human.hand = [card('C', 9, false), card('C', 10, true)];
    const next = discardDrawnCardToWaste(state, 'human');
    expect(next.players.human.hand.map((c) => c.id)).toEqual([card('C', 9).id]);
    expect(next.players.human.waste.map((c) => c.id)).toEqual([card('C', 10).id]);
    expect(next.turn).toBe('cpu');
    expect(next.turnMoveLog).toEqual([]);
  });

  it('increments roundsWithoutProgress when the turn was purely draw-then-discard', () => {
    const state = emptyState('human');
    state.players.human.hand = [card('C', 10, true)];
    state.turnMoveLog = []; // nothing happened this turn before the draw
    const next = discardDrawnCardToWaste(state, 'human');
    expect(next.roundsWithoutProgress).toBe(1);
  });

  it('resets roundsWithoutProgress to 0 when other moves happened earlier this turn', () => {
    const state = emptyState('human');
    state.roundsWithoutProgress = 1;
    state.players.human.hand = [card('C', 10, true)];
    state.turnMoveLog = [
      { card: card('S', 1), from: { type: 'house', owner: 'human', index: 0 }, to: { type: 'foundation', index: 0 } },
    ];
    const next = discardDrawnCardToWaste(state, 'human');
    expect(next.roundsWithoutProgress).toBe(0);
  });

  it('sets needsHandReshuffle when the discard empties the hand', () => {
    const state = emptyState('human');
    state.players.human.hand = [card('C', 10, true)];
    const next = discardDrawnCardToWaste(state, 'human');
    expect(next.players.human.hand).toHaveLength(0);
    expect(next.players.human.needsHandReshuffle).toBe(true);
  });

  it('does not set needsHandReshuffle when the hand still has cards left', () => {
    const state = emptyState('human');
    state.players.human.hand = [card('C', 9, false), card('C', 10, true)];
    const next = discardDrawnCardToWaste(state, 'human');
    expect(next.players.human.needsHandReshuffle).toBe(false);
  });

  it('throws when there is no drawn (face-up) hand card to discard', () => {
    const state = emptyState('human');
    state.players.human.hand = [card('C', 10, false)];
    expect(() => discardDrawnCardToWaste(state, 'human')).toThrow(/no drawn hand card/);
  });
});

describe('startTurn', () => {
  it('reshuffles waste into hand when needsHandReshuffle is set, preserving discard order', () => {
    const state = emptyState('human');
    state.players.human.needsHandReshuffle = true;
    state.players.human.waste = [card('D', 2), card('D', 3), card('D', 4)];
    const next = startTurn(state);
    expect(next.players.human.needsHandReshuffle).toBe(false);
    expect(next.players.human.waste).toHaveLength(0);
    expect(next.players.human.hand.map((c) => c.id)).toEqual([card('D', 4).id, card('D', 3).id, card('D', 2).id]);
    expect(next.players.human.hand.every((c) => c.faceUp === false)).toBe(true);
  });

  it('is a no-op when needsHandReshuffle is false', () => {
    const state = emptyState('human');
    state.players.human.hand = [card('C', 9, false)];
    const next = startTurn(state);
    expect(next.players.human.hand.map((c) => c.id)).toEqual([card('C', 9).id]);
  });
});

describe('passTurn', () => {
  it('switches the turn and resets the move log without touching any cards', () => {
    const state = emptyState('human');
    state.players.human.reserve = [card('S', 7)]; // present but untouched
    const next = passTurn(state, 'human');
    expect(next.turn).toBe('cpu');
    expect(next.turnMoveLog).toEqual([]);
    expect(next.players.human.reserve.map((c) => c.id)).toEqual([card('S', 7).id]);
  });

  it('counts as no progress when nothing happened earlier this turn', () => {
    const state = emptyState('human');
    const next = passTurn(state, 'human');
    expect(next.roundsWithoutProgress).toBe(1);
  });

  it('resets progress to 0 when other moves happened earlier this turn before passing', () => {
    const state = emptyState('human');
    state.roundsWithoutProgress = 1;
    state.turnMoveLog = [
      { card: card('S', 1), from: { type: 'house', owner: 'human', index: 0 }, to: { type: 'foundation', index: 0 } },
    ];
    const next = passTurn(state, 'human');
    expect(next.roundsWithoutProgress).toBe(0);
  });
});

describe('reshuffle timing rule end-to-end (resolution #2)', () => {
  it('deferred case: discard-ends-turn with empty hand does NOT reshuffle until the start of the SAME player\'s next turn', () => {
    let state = emptyState('human');
    state.players.human.hand = [card('C', 10, true)]; // last hand card, about to be discarded
    state.players.human.waste = [card('D', 2)]; // pre-existing waste

    state = discardDrawnCardToWaste(state, 'human');
    expect(state.turn).toBe('cpu');
    expect(state.players.human.needsHandReshuffle).toBe(true);
    expect(state.players.human.hand).toHaveLength(0);
    // waste still holds both cards -- opponent's turn could still load onto it here
    expect(state.players.human.waste.map((c) => c.id)).toEqual([card('D', 2).id, card('C', 10).id]);

    // cpu's turn happens in between (nothing relevant to this test) ...
    state = { ...state, turn: 'human' }; // simulate arriving back at human's next turn

    state = startTurn(state);
    expect(state.players.human.needsHandReshuffle).toBe(false);
    expect(state.players.human.hand.map((c) => c.id)).toEqual([card('C', 10).id, card('D', 2).id]);
    expect(state.players.human.waste).toHaveLength(0);
  });

  it('immediate case: hand emptied mid-turn by successful plays reshuffles right away and the turn continues', () => {
    let state = emptyState('human');
    state.players.human.hand = [card('S', 2, true)]; // one card, about to be played (not discarded)
    state.players.human.houses[0] = [card('H', 3)]; // legal target: black 2 onto red 3
    state.players.human.waste = [card('D', 7)];

    state = applyMove(state, {
      card: card('S', 2, true),
      from: { type: 'hand' as const, owner: 'human' as const },
      to: { type: 'house' as const, owner: 'human' as const, index: 0 as const },
    });
    // hand is now empty because the card was played, not discarded -- turn is still ongoing
    expect(state.players.human.hand).toHaveLength(0);
    expect(state.turn).toBe('human');
    expect(state.players.human.needsHandReshuffle).toBe(false);

    state = drawFromHand(state, 'human');
    expect(state.turn).toBe('human'); // still the same turn
    expect(state.players.human.waste).toHaveLength(0); // reshuffled immediately, not deferred
    expect(state.players.human.hand.map((c) => c.id)).toEqual([card('D', 7).id]);
    expect(state.players.human.hand[0].faceUp).toBe(true);
  });
});
