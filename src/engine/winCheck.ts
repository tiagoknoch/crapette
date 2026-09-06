import type { GameState, PlayerId } from './types.ts';

function otherPlayer(player: PlayerId): PlayerId {
  return player === 'human' ? 'cpu' : 'human';
}

// §9: "Win: after every applyMove, check if the mover's reserve, hand, and waste are all
// empty." §2 scoring: winner gets 30 + 1 per opponent's remaining hand+waste card + 2 per
// opponent's remaining reserve card; the loser scores 0 for the round.
export function checkWin(state: GameState, mover: PlayerId): GameState {
  if (state.status !== 'in_progress') return state;

  const p = state.players[mover];
  if (p.reserve.length > 0 || p.hand.length > 0 || p.waste.length > 0) {
    return state;
  }

  const opponent = otherPlayer(mover);
  const opp = state.players[opponent];
  const score = 30 + (opp.hand.length + opp.waste.length) + 2 * opp.reserve.length;

  return {
    ...state,
    status: 'won',
    winner: mover,
    scores: { [mover]: score, [opponent]: 0 } as Record<PlayerId, number>,
  };
}

function penalty(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  return 2 * p.reserve.length + (p.hand.length + p.waste.length);
}

// §9 stalemate, resolution #4 (corrected from the tech-spec's original "2 consecutive
// no-progress turns"): per the actual rules (pagat.com/patience/crapette.html, Wikipedia's
// Russian Bank article, denexa.com's Crapette writeup — all three independently agree),
// stalemate means "nobody has any legally-playable cards in their stock, discard, or
// reserve," a genuine board-state condition, not a turn-count heuristic. A single bad draw
// per player proves nothing when their hand+waste still holds another 20+ untried cards —
// confirmed as a real, reachable bug via an actual played game reported by the user, saved
// mid-hand with human.hand.length===18 (all still face-down, never drawn this cycle) and
// human.waste.length===2, yet `roundsWithoutProgress` had already hit the old hardcoded `2`
// and ended the game.
//
// `roundsWithoutProgress` still increments/resets exactly as before (see engine.ts) — a
// player's turn only ever adds to the streak when that specific turn had zero legal moves
// (a pure draw-then-discard, or a real pass). What changes here is the THRESHOLD: instead of
// a fixed `2`, require enough consecutive no-progress turns for BOTH players to have each
// cycled through their *entire* remaining hand+waste at least once without a play — i.e. a
// full lap proving "drawing further just repeats the same cards you've already seen fail."
// Turns strictly alternate (every turn ends via discardDrawnCardToWaste or passTurn, both of
// which always flip `state.turn`), so N consecutive no-progress turns split as roughly N/2
// per player; guaranteeing each player got at least their own full-cycle count needs
// N >= 2 * max(humanCycle, cpuCycle). (A player whose hand+waste is already empty has
// cycle size 0 — correctly still stuck, so 0 rounds is enough for them specifically, though
// the max() with the other player's nonzero cycle almost always dominates in practice.)
// §2/resolution #3 scoring (unchanged): lower own-penalty (2/reserve card, 1/hand+waste
// card) wins the difference; the other player scores 0; a tie has no winner and both score
// 0. No 30pt bonus.
export function checkStalemate(state: GameState): GameState {
  if (state.status !== 'in_progress') return state;

  const cycleSize = (player: PlayerId): number => {
    const p = state.players[player];
    return p.hand.length + p.waste.length;
  };
  const threshold = 2 * Math.max(cycleSize('human'), cycleSize('cpu'));
  if (state.roundsWithoutProgress < threshold) return state;

  const humanPenalty = penalty(state, 'human');
  const cpuPenalty = penalty(state, 'cpu');

  let winner: PlayerId | undefined;
  const scores: Record<PlayerId, number> = { human: 0, cpu: 0 };
  if (humanPenalty !== cpuPenalty) {
    winner = humanPenalty < cpuPenalty ? 'human' : 'cpu';
    scores[winner] = Math.abs(humanPenalty - cpuPenalty);
  }

  return { ...state, status: 'stalemate', winner, scores };
}
