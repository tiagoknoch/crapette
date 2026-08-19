import { describe, expect, it } from 'vitest';
import { buildTwoDeckPool, deal, dealPlayer, determineFirstPlayer, shuffle } from './deck.ts';
import type { Card, PlayerState } from './types.ts';

describe('buildTwoDeckPool', () => {
  it('builds 104 cards: two of every suit/rank combination', () => {
    const pool = buildTwoDeckPool();
    expect(pool).toHaveLength(104);

    const ids = new Set(pool.map((c) => c.id));
    expect(ids.size).toBe(104);

    const counts = new Map<string, number>();
    for (const card of pool) {
      const key = `${card.suit}${card.rank}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    for (const count of counts.values()) {
      expect(count).toBe(2);
    }
  });

  it('deals every card face-down', () => {
    const pool = buildTwoDeckPool();
    expect(pool.every((c) => c.faceUp === false)).toBe(true);
  });
});

describe('shuffle', () => {
  it('preserves the multiset of items', () => {
    const pool = buildTwoDeckPool();
    const shuffled = shuffle(pool, () => 0.42);
    expect(shuffled).toHaveLength(pool.length);
    expect([...shuffled].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...pool].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('is deterministic given a fixed random source', () => {
    const pool = buildTwoDeckPool();
    let seed = 0;
    const rng = () => {
      seed = (seed + 0.1) % 1;
      return seed;
    };
    const a = shuffle(pool, rng);
    let seed2 = 0;
    const rng2 = () => {
      seed2 = (seed2 + 0.1) % 1;
      return seed2;
    };
    const b = shuffle(pool, rng2);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });
});

describe('dealPlayer', () => {
  const cards52: Card[] = Array.from({ length: 52 }, (_, i) => ({
    id: `X${i}`,
    suit: 'S',
    rank: ((i % 13) + 1) as Card['rank'],
    faceUp: false,
  }));

  it('splits 52 cards into 13 reserve / 4 houses / 35 hand / empty waste', () => {
    const player = dealPlayer('human', cards52);
    expect(player.reserve).toHaveLength(13);
    expect(player.houses.map((h) => h.length)).toEqual([1, 1, 1, 1]);
    expect(player.hand).toHaveLength(35);
    expect(player.waste).toHaveLength(0);
    expect(player.needsHandReshuffle).toBe(false);
  });

  it('only the reserve top card is face-up; the rest of the reserve is face-down', () => {
    const player = dealPlayer('human', cards52);
    expect(player.reserve.slice(0, 12).every((c) => c.faceUp === false)).toBe(true);
    expect(player.reserve[12].faceUp).toBe(true);
  });

  it('house cards are face-up and hand cards are face-down', () => {
    const player = dealPlayer('human', cards52);
    expect(player.houses.every((h) => h[0].faceUp === true)).toBe(true);
    expect(player.hand.every((c) => c.faceUp === false)).toBe(true);
  });

  it('accounts for all 52 input cards with no duplicates or drops', () => {
    const player = dealPlayer('human', cards52);
    const allIds = [
      ...player.reserve.map((c) => c.id),
      ...player.houses.flatMap((h) => h.map((c) => c.id)),
      ...player.hand.map((c) => c.id),
    ];
    expect(new Set(allIds).size).toBe(52);
    expect(allIds).toHaveLength(52);
  });
});

describe('determineFirstPlayer', () => {
  function playerWith(reserveTopRank: Card['rank'], houseRanks: [number, number, number, number]): PlayerState {
    return {
      id: 'human',
      reserve: [{ id: 'r', suit: 'S', rank: reserveTopRank, faceUp: true }],
      houses: houseRanks.map((r) => [{ id: `h${r}`, suit: 'S', rank: r as Card['rank'], faceUp: true }]) as PlayerState['houses'],
      hand: [],
      waste: [],
      needsHandReshuffle: false,
    };
  }

  it('lower reserve-top rank goes first (A low, K high)', () => {
    const human = playerWith(1, [5, 5, 5, 5]);
    const cpu = playerWith(13, [5, 5, 5, 5]);
    expect(determineFirstPlayer(human, cpu, () => 0)).toBe('human');
  });

  it('breaks a reserve-top tie by comparing houses outward until a difference appears', () => {
    const human = playerWith(7, [3, 9, 9, 9]);
    const cpu = playerWith(7, [3, 2, 9, 9]);
    // houses[0] ties (3 vs 3), houses[1] differs (9 vs 2) -> cpu's lower house rank wins
    expect(determineFirstPlayer(human, cpu, () => 0)).toBe('cpu');
  });

  it('falls back to the random source when everything ties', () => {
    const human = playerWith(7, [3, 3, 3, 3]);
    const cpu = playerWith(7, [3, 3, 3, 3]);
    expect(determineFirstPlayer(human, cpu, () => 0)).toBe('human');
    expect(determineFirstPlayer(human, cpu, () => 0.99)).toBe('cpu');
  });
});

describe('deal', () => {
  it('produces a valid initial GameState with all 104 cards accounted for exactly once', () => {
    const state = deal(buildTwoDeckPool(), () => 0.5);
    const all = [
      ...state.players.human.reserve,
      ...state.players.human.houses.flat(),
      ...state.players.human.hand,
      ...state.players.human.waste,
      ...state.players.cpu.reserve,
      ...state.players.cpu.houses.flat(),
      ...state.players.cpu.hand,
      ...state.players.cpu.waste,
    ];
    expect(all).toHaveLength(104);
    expect(new Set(all.map((c) => c.id)).size).toBe(104);
    expect(state.foundations).toHaveLength(8);
    expect(state.foundations.every((f) => f.suit === null && f.cards.length === 0)).toBe(true);
    expect(state.status).toBe('in_progress');
    expect(['human', 'cpu']).toContain(state.turn);
    expect(state.roundsWithoutProgress).toBe(0);
    expect(state.turnMoveLog).toEqual([]);
  });
});
