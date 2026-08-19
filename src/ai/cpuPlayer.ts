// §7/§14 step 5: rule-based CPU heuristic, no search/minimax. Per §4's architecture
// diagram this module only *picks* a move given a GameState + an already-computed legal
// move set — it never mutates state itself. The turn-driving loop (§8, e.g. the CLI
// harness or a future gameStore) is what actually calls engine.applyMove/drawFromHand/
// discardDrawnCardToWaste with whatever this returns. A stronger AI (shallow minimax or
// MCTS over the small branching factor) is a natural v1.5 upgrade, isolated entirely here.
import { applyMove } from '../engine/engine.ts';
import { getLegalMoves } from '../engine/moveResolver.ts';
import type { LegalMoves } from '../engine/moveResolver.ts';
import type { GameState, Move, PileRef, PlayerId } from '../engine/types.ts';

function other(player: PlayerId): PlayerId {
  return player === 'human' ? 'cpu' : 'human';
}

function sourcePileLength(state: GameState, from: PileRef): number {
  switch (from.type) {
    case 'reserve':
      return state.players[from.owner].reserve.length;
    case 'waste':
      return state.players[from.owner].waste.length;
    case 'hand':
      return state.players[from.owner].hand.length;
    case 'house':
      return state.players[from.owner].houses[from.index].length;
    case 'foundation':
      return state.foundations[from.index].cards.length;
  }
}

// §7 step 1/2: `moves` here are always foundation plays — moveResolver never mixes
// categories into `compulsory`. moveResolver's rule-1 scope already makes the reserve
// exclusive (if the reserve top has a foundation play, it's the *only* candidate), so any
// remaining tie is between waste/hand/house sources — favor emptying waste, then hand,
// then house, the same "clear your own piles first" idea as the optional ranking below.
const COMPULSORY_SOURCE_PRIORITY: Record<PileRef['type'], number> = {
  reserve: 3,
  waste: 2,
  hand: 1,
  house: 0,
  foundation: -1,
};

export function chooseCompulsoryMove(moves: Move[]): Move {
  if (moves.length === 1) return moves[0];
  return moves.slice().sort((a, b) => COMPULSORY_SOURCE_PRIORITY[b.from.type] - COMPULSORY_SOURCE_PRIORITY[a.from.type])[0];
}

// §7 step 3b: simulate the load and check whether it hands the opponent a card that
// newly unblocks one of their own foundation plays (the loaded card becomes the new
// exposed top of their reserve/waste, which is one of *their* own available sources).
function unlocksOpponentFoundation(state: GameState, player: PlayerId, move: Move): boolean {
  const opponent = other(player);
  const before = new Set(getLegalMoves(state, opponent).compulsory.map((m) => m.card.id));
  const after = applyMove(state, move);
  return getLegalMoves(after, opponent).compulsory.some((m) => !before.has(m.card.id));
}

// §7 step 3(a-d): heuristic priority score for a single optional (non-foundation) move —
// higher is better. Tiers are spaced far enough apart to behave lexicographically (the max
// possible bonus from a lower tier can never outweigh climbing one tier up), which is what
// gives the a > b > c > d ordering from the spec without needing a multi-key sort.
function scoreOptionalMove(state: GameState, player: PlayerId, move: Move): number {
  let score = 0;
  const emptiesSource = sourcePileLength(state, move.from) === 1;

  // Ranked above a-d: keeping an empty house filled from the reserve is what lets
  // canDrawHand ever become true again (§2 rule 3) — moveResolver deliberately leaves this
  // optional rather than compulsory at the engine level (see its "resolution #3" comment),
  // but a competent player always does it immediately when possible. Skipping it in favor of
  // some other zero-value shuffle is exactly what let a greedy bot get stuck oscillating a
  // card between two houses forever while an empty house sat unfilled and reserve>1 card
  // meant tier a's bonus didn't apply to distinguish this move from that shuffle.
  if (move.from.type === 'reserve' && move.to.type === 'house' && sourcePileLength(state, move.to) === 0) {
    score += 10000;
  }

  // a. Emptying own reserve > emptying own waste > other moves.
  if (move.from.type === 'reserve' && emptiesSource) {
    score += 5000;
  } else if (move.from.type === 'waste' && emptiesSource) {
    score += 4000;
  }

  // b. Loading onto the opponent hurts their progress — prefer it, unless the 1-ply
  // lookahead shows it hands them a new foundation play.
  if ((move.to.type === 'reserve' || move.to.type === 'waste') && move.to.owner === other(player)) {
    score += unlocksOpponentFoundation(state, player, move) ? -500 : 3000;
  }

  // c. House move that empties one of the CPU's own piles (reserve/waste/hand).
  if (move.to.type === 'house' && move.from.type !== 'house' && emptiesSource) {
    score += 2000;
  }

  // d. Prefer moves that empty a house entirely (a flexible empty slot) over ones that
  // fill/extend one — but only when that's a *net* gain in empty houses. Moving a lone
  // card from one already-near-empty house onto another house that's already empty just
  // relocates the same empty slot (net change zero); scoring that as a win is exactly what
  // let a greedy bot shuffle a single card back and forth between two empty houses forever,
  // since undoing the move looks equally "good" as making it.
  if (move.from.type === 'house' && emptiesSource) {
    const destinationWasEmpty = move.to.type === 'house' && sourcePileLength(state, move.to) === 0;
    if (!destinationWasEmpty) {
      score += 1000;
    }
  }

  return score;
}

interface RankedMove {
  move: Move;
  score: number;
}

// §7 step 3e: rank by scoreOptionalMove, falling back to list order on ties (Array#sort is
// stable, so equal scores keep their original relative position).
function rankOptionalMoves(state: GameState, player: PlayerId, moves: Move[]): RankedMove[] {
  return moves
    .map((move, index) => ({ move, index, score: scoreOptionalMove(state, player, move) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

export function chooseOptionalMove(state: GameState, player: PlayerId, moves: Move[]): Move {
  if (moves.length === 1) return moves[0];
  return rankOptionalMoves(state, player, moves)[0].move;
}

// Top-level entry point: given the current state and the already-computed legal move set
// for the player on turn, pick the single best move to make right now, or null if none
// exist *worth taking* (§7 step 3's own phrase). A move that scores 0 accomplishes none of
// heuristic (a)-(d) — it's a lateral shuffle, not progress — so treat it the same as having
// no optional move at all and return null unconditionally, regardless of whether drawing is
// currently possible. This matters: an always-take-a-move policy would retake the same
// zero-score shuffle forever once it's the only legal option, even when the reason drawing
// isn't available is something permanent for this turn (hand+waste both empty, say) rather
// than a temporary gate — returning null either way lets the turn driver fall through to its
// own "can't draw either" handling (passing the turn) instead of looping.
export function chooseMove(state: GameState, player: PlayerId, legal: LegalMoves): Move | null {
  if (legal.compulsory.length > 0) return chooseCompulsoryMove(legal.compulsory);
  if (legal.optional.length === 0) return null;

  const best = rankOptionalMoves(state, player, legal.optional)[0];
  return best.score > 0 ? best.move : null;
}
