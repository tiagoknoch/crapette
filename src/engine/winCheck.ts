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

// §9 stalemate: two consecutive no-progress turns (one per player) ends the game.
// §2/resolution #3 scoring: lower own-penalty (2/reserve card, 1/hand+waste card) wins the
// difference; the other player scores 0; a tie has no winner and both score 0. No 30pt bonus.
export function checkStalemate(state: GameState): GameState {
  if (state.status !== 'in_progress') return state;
  if (state.roundsWithoutProgress < 2) return state;

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
