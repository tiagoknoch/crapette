import { describe, expect, it } from 'vitest';
import { checkStalemate, checkWin } from './winCheck.ts';
import type { Card, GameState, PlayerId, PlayerState } from './types.ts';

function card(suit: Card['suit'], rank: Card['rank']): Card {
  return { id: `${suit}${rank}`, suit, rank, faceUp: true };
}

function emptyPlayer(id: PlayerId): PlayerState {
  return { id, reserve: [], houses: [[], [], [], []], hand: [], waste: [], needsHandReshuffle: false };
}

function baseState(): GameState {
  return {
    players: { human: emptyPlayer('human'), cpu: emptyPlayer('cpu') },
    foundations: Array.from({ length: 8 }, () => ({ suit: null, cards: [] })),
    turn: 'human',
    turnMoveLog: [],
    status: 'in_progress',
    roundsWithoutProgress: 0,
  };
}

describe('checkWin', () => {
  it('declares the mover the winner once their reserve, hand, and waste are all empty', () => {
    const state = baseState();
    state.players.cpu.reserve = [card('S', 5)];
    state.players.cpu.hand = [card('S', 6), card('S', 7)];

    const next = checkWin(state, 'human');
    expect(next.status).toBe('won');
    expect(next.winner).toBe('human');
    // score = 30 + 1*(opponent hand+waste) + 2*(opponent reserve) = 30 + 2 + 2 = 34
    expect(next.scores).toEqual({ human: 34, cpu: 0 });
  });

  it('does not declare a win while the mover still has cards in any of the three piles', () => {
    const state = baseState();
    state.players.human.waste = [card('H', 2)];
    const next = checkWin(state, 'human');
    expect(next.status).toBe('in_progress');
    expect(next.winner).toBeUndefined();
  });

  it('is a no-op once the game has already ended', () => {
    const state = baseState();
    state.status = 'won';
    state.winner = 'cpu';
    const next = checkWin(state, 'human');
    expect(next.winner).toBe('cpu');
  });
});

describe('checkStalemate', () => {
  it('does nothing before two consecutive no-progress turns', () => {
    const state = baseState();
    state.roundsWithoutProgress = 1;
    const next = checkStalemate(state);
    expect(next.status).toBe('in_progress');
  });

  it('declares the lower-penalty player the winner, scoring the difference, once stalemated', () => {
    const state = baseState();
    state.roundsWithoutProgress = 2;
    state.players.human.reserve = [card('S', 1)]; // penalty 2
    state.players.cpu.reserve = [card('S', 2), card('S', 3)]; // penalty 4
    state.players.cpu.hand = [card('S', 4)]; // +1 -> cpu penalty 5

    const next = checkStalemate(state);
    expect(next.status).toBe('stalemate');
    expect(next.winner).toBe('human');
    expect(next.scores).toEqual({ human: 3, cpu: 0 }); // 5 - 2 = 3, no 30pt bonus
  });

  it('has no winner and both score 0 when penalties tie', () => {
    const state = baseState();
    state.roundsWithoutProgress = 2;
    state.players.human.reserve = [card('S', 1)];
    state.players.cpu.reserve = [card('H', 1)];

    const next = checkStalemate(state);
    expect(next.status).toBe('stalemate');
    expect(next.winner).toBeUndefined();
    expect(next.scores).toEqual({ human: 0, cpu: 0 });
  });

  it('is a no-op once the game has already ended', () => {
    const state = baseState();
    state.status = 'won';
    state.winner = 'human';
    state.roundsWithoutProgress = 2;
    const next = checkStalemate(state);
    expect(next.status).toBe('won');
    expect(next.winner).toBe('human');
  });
});
