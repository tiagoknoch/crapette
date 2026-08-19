import { describe, expect, it } from 'vitest';
import { chooseCompulsoryMove, chooseMove, chooseOptionalMove } from './cpuPlayer.ts';
import { getLegalMoves } from '../engine/moveResolver.ts';
import type { Card, GameState, PlayerId, PlayerState } from '../engine/types.ts';

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
  };
}

describe('chooseCompulsoryMove', () => {
  it('returns the only candidate when there is just one', () => {
    const move = { card: card('H', 1), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'foundation' as const, index: 0 } };
    expect(chooseCompulsoryMove([move])).toBe(move);
  });

  it('prefers emptying the waste over playing a house or hand card to foundation', () => {
    const wasteMove = { card: card('D', 1), from: { type: 'waste' as const, owner: 'human' as const }, to: { type: 'foundation' as const, index: 0 } };
    const houseMove = { card: card('S', 1), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'foundation' as const, index: 1 } };
    const handMove = { card: card('C', 1), from: { type: 'hand' as const, owner: 'human' as const }, to: { type: 'foundation' as const, index: 2 } };
    expect(chooseCompulsoryMove([houseMove, handMove, wasteMove])).toBe(wasteMove);
  });

  it('prefers emptying the hand over a house source when waste is not a candidate', () => {
    const houseMove = { card: card('S', 1), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'foundation' as const, index: 1 } };
    const handMove = { card: card('C', 1), from: { type: 'hand' as const, owner: 'human' as const }, to: { type: 'foundation' as const, index: 2 } };
    expect(chooseCompulsoryMove([houseMove, handMove])).toBe(handMove);
  });
});

describe('chooseOptionalMove — §7 step 3 priority order', () => {
  it('prefers a move that empties the own reserve over everything else', () => {
    const state = emptyState();
    state.players.human.reserve = [card('S', 7)]; // one card left — this move empties it
    state.players.human.waste = [card('H', 9)]; // waste move does NOT empty (only reserve does here)
    state.players.human.houses[0] = [card('H', 8)]; // S7 can build onto H8
    state.players.human.houses[1] = [card('C', 10)]; // H9 can build onto C10

    const reserveMove = { card: card('S', 7), from: { type: 'reserve' as const, owner: 'human' as const }, to: { type: 'house' as const, owner: 'human' as const, index: 0 as const } };
    const wasteMove = { card: card('H', 9), from: { type: 'waste' as const, owner: 'human' as const }, to: { type: 'house' as const, owner: 'human' as const, index: 1 as const } };

    expect(chooseOptionalMove(state, 'human', [wasteMove, reserveMove])).toBe(reserveMove);
  });

  it('prefers emptying own waste over loading the opponent', () => {
    const state = emptyState();
    state.players.human.waste = [card('S', 7)]; // last card — this move empties it
    state.players.human.houses[0] = [card('H', 8)]; // S7 -> house
    state.players.human.houses[1] = [card('H', 6)]; // some other card that can load the opponent
    state.players.cpu.waste = [card('H', 5)]; // H6 loads legally onto cpu's waste

    const wasteMove = { card: card('S', 7), from: { type: 'waste' as const, owner: 'human' as const }, to: { type: 'house' as const, owner: 'human' as const, index: 0 as const } };
    const loadMove = { card: card('H', 6), from: { type: 'house' as const, owner: 'human' as const, index: 1 as const }, to: { type: 'waste' as const, owner: 'cpu' as const } };

    expect(chooseOptionalMove(state, 'human', [loadMove, wasteMove])).toBe(wasteMove);
  });

  it('prefers loading the opponent over a passive house move that changes nothing else', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('H', 6)]; // loads onto cpu's waste
    state.players.cpu.waste = [card('H', 5)];
    state.players.human.houses[1] = [card('S', 9)];
    state.players.human.houses[2] = [card('H', 10)]; // S9 can build onto H10, a passive house move

    const loadMove = { card: card('H', 6), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'waste' as const, owner: 'cpu' as const } };
    const passiveHouseMove = { card: card('S', 9), from: { type: 'house' as const, owner: 'human' as const, index: 1 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 2 as const } };

    expect(chooseOptionalMove(state, 'human', [passiveHouseMove, loadMove])).toBe(loadMove);
  });

  it('deprioritizes a load that would hand the opponent a new foundation play (1-ply lookahead)', () => {
    const state = emptyState();
    // Note: the card being loaded can never itself be the newly-unlocked card — if it were
    // already foundation-eligible, it would already be *compulsory* for the mover instead of
    // sitting in the optional list at all. The real mechanism is a shared house: moving the
    // house's exposed top away as the load reveals a *different*, previously-buried card in
    // that same house, which is now available to anyone — including the opponent.
    state.foundations[0] = { suit: 'D', cards: [card('D', 1), card('D', 2), card('D', 3), card('D', 4)] }; // top D4
    state.players.human.houses[0] = [card('D', 5), card('H', 6)]; // top H6; D5 (foundation-eligible) sits buried underneath
    state.players.cpu.reserve = [card('H', 9, false), card('H', 7)]; // top H7 — legal load target for H6
    state.players.human.houses[1] = [card('S', 8), card('S', 9)]; // top S9, moving it doesn't empty house 1
    state.players.human.houses[2] = [card('H', 10)]; // passive alternative: S9 -> H10

    const riskyLoadMove = { card: card('H', 6), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'reserve' as const, owner: 'cpu' as const } };
    const passiveHouseMove = { card: card('S', 9), from: { type: 'house' as const, owner: 'human' as const, index: 1 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 2 as const } };

    expect(chooseOptionalMove(state, 'human', [riskyLoadMove, passiveHouseMove])).toBe(passiveHouseMove);
  });

  it('prefers a house move that empties its source house over one that fills/extends one', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('S', 9)]; // single card — moving it empties house 0
    state.players.human.houses[1] = [card('H', 6), card('S', 5)]; // top S5, moving it does not empty house 1
    state.players.human.houses[2] = [card('H', 10)]; // S9 -> H10
    state.players.human.houses[3] = [card('H', 6)]; // S5 -> H6 (fills/extends, doesn't empty source)

    const emptyingMove = { card: card('S', 9), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 2 as const } };
    const fillingMove = { card: card('S', 5), from: { type: 'house' as const, owner: 'human' as const, index: 1 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 3 as const } };

    expect(chooseOptionalMove(state, 'human', [fillingMove, emptyingMove])).toBe(emptyingMove);
  });

  it('falls back to list order when nothing distinguishes two moves', () => {
    const state = emptyState();
    state.players.human.houses[0] = [card('H', 6), card('S', 9)]; // top S9, doesn't empty house 0
    state.players.human.houses[1] = [card('D', 6), card('C', 9)]; // top C9, doesn't empty house 1
    state.players.human.houses[2] = [card('H', 10)];
    state.players.human.houses[3] = [card('D', 10)];

    const moveA = { card: card('S', 9), from: { type: 'house' as const, owner: 'human' as const, index: 0 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 2 as const } };
    const moveB = { card: card('C', 9), from: { type: 'house' as const, owner: 'human' as const, index: 1 as const }, to: { type: 'house' as const, owner: 'human' as const, index: 3 as const } };

    expect(chooseOptionalMove(state, 'human', [moveA, moveB])).toBe(moveA);
    expect(chooseOptionalMove(state, 'human', [moveB, moveA])).toBe(moveB);
  });
});

describe('chooseMove', () => {
  it('always prefers a compulsory move over any optional move', () => {
    const state = emptyState();
    state.players.human.reserve = [card('H', 1)]; // forces H1 -> foundation
    state.players.human.houses[0] = [card('S', 9)];
    state.players.human.houses[1] = [card('H', 10)]; // an unrelated optional move also exists

    const legal = getLegalMoves(state, 'human');
    const move = chooseMove(state, 'human', legal);
    expect(move?.card.id).toBe(card('H', 1).id);
    expect(move?.to.type).toBe('foundation');
  });

  it('returns null when neither a compulsory nor an optional move exists', () => {
    const state = emptyState();
    state.players.human.hand = [card('H', 4, true)]; // available but nothing legal to do with it
    // Fill every house (both players', since houses are a shared destination) with a red
    // card so H4 (red) can never legally build onto any of them.
    state.players.human.houses = [[card('D', 9)], [card('D', 10)], [card('D', 11)], [card('D', 12)]];
    state.players.cpu.houses = [[card('H', 9)], [card('H', 10)], [card('H', 11)], [card('H', 12)]];
    const legal = getLegalMoves(state, 'human');
    expect(chooseMove(state, 'human', legal)).toBeNull();
  });
});
