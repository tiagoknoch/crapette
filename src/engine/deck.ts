import type { Card, FoundationSlot, GameState, PlayerId, PlayerState, Rank, Suit } from './types.ts';

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

// §2: each player brings their own standard 52-card deck — the two decks are shuffled
// and dealt independently, never combined into one pool. `copy` only distinguishes each
// deck's cards by id (e.g. "H7-0" vs "H7-1") so all 104 cards in play stay unique; it has
// no gameplay meaning and isn't shown to players.
export function buildStandardDeck(copy: 0 | 1): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `${suit}${rank}-${copy}`, suit, rank, faceUp: false });
    }
  }
  return cards;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function dealPlayer(id: PlayerId, cards: Card[]): PlayerState {
  // §2 per-player deal: 13 reserve (top face-up), 4 houses (one card each, face-up),
  // 35 hand (face-down), waste empty.
  const reserveCards = cards.slice(0, 13).map((c, i) => ({ ...c, faceUp: i === 12 }));
  const houseCards = cards.slice(13, 17).map((c) => ({ ...c, faceUp: true }));
  const handCards = cards.slice(17, 52).map((c) => ({ ...c, faceUp: false }));

  return {
    id,
    reserve: reserveCards,
    houses: [[houseCards[0]], [houseCards[1]], [houseCards[2]], [houseCards[3]]],
    hand: handCards,
    waste: [],
    needsHandReshuffle: false,
  };
}

// §2: first player = lower top-reserve rank (A low, K high); ties broken by
// comparing house cards outward (index 0..3) until a difference is found.
export function determineFirstPlayer(human: PlayerState, cpu: PlayerState, random: () => number): PlayerId {
  const humanTop = human.reserve[human.reserve.length - 1];
  const cpuTop = cpu.reserve[cpu.reserve.length - 1];
  if (humanTop.rank !== cpuTop.rank) {
    return humanTop.rank < cpuTop.rank ? 'human' : 'cpu';
  }
  for (let i = 0; i < 4; i++) {
    const humanRank = human.houses[i as 0 | 1 | 2 | 3][0].rank;
    const cpuRank = cpu.houses[i as 0 | 1 | 2 | 3][0].rank;
    if (humanRank !== cpuRank) {
      return humanRank < cpuRank ? 'human' : 'cpu';
    }
  }
  // Fully tied (possible with duplicate ranks across the two decks) — no rule
  // covers this case, so break the tie randomly.
  return random() < 0.5 ? 'human' : 'cpu';
}

// §2: "Each of the two players... takes a pack of 52 cards... shuffles it" (and the
// opponent cuts it, physically — a purely mechanical step with no digital equivalent, so
// it's skipped here) — each player's 52 cards come from their own independently-shuffled
// deck, not a shared 104-card shuffle. A card can still have a same-rank/suit duplicate
// on the shared tableau (the other player's copy), just never within one player's own
// reserve/houses/hand/waste.
export function deal(random: () => number = Math.random): GameState {
  const human = dealPlayer('human', shuffle(buildStandardDeck(0), random));
  const cpu = dealPlayer('cpu', shuffle(buildStandardDeck(1), random));
  const foundations: FoundationSlot[] = Array.from({ length: 8 }, () => ({ suit: null, cards: [] }));

  return {
    players: { human, cpu },
    foundations,
    turn: determineFirstPlayer(human, cpu, random),
    turnMoveLog: [],
    status: 'in_progress',
    roundsWithoutProgress: 0,
  };
}
