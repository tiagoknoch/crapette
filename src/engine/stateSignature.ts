import type { Card, GameState } from './types.ts';

// Board-topology fingerprint used to detect a move that only cycles the board back to a
// state already seen this turn (see docs/known-issues.md's turn-never-ends soft-lock
// write-up) — a player's turn only ever ends via a discard or a pass, so a reversible
// optional move (e.g. one card endlessly swapping between two houses) can otherwise loop
// forever with no other code path ever stopping it. Card ids alone fully determine pile
// contents/order; face-up state elsewhere is a deterministic function of position, so it
// doesn't need to be included separately.
function ids(cards: Card[]): string[] {
  return cards.map((c) => c.id);
}

export function computeStateSignature(state: GameState): string {
  const snapshot = {
    turn: state.turn,
    human: {
      reserve: ids(state.players.human.reserve),
      houses: state.players.human.houses.map(ids),
      hand: ids(state.players.human.hand),
      waste: ids(state.players.human.waste),
    },
    cpu: {
      reserve: ids(state.players.cpu.reserve),
      houses: state.players.cpu.houses.map(ids),
      hand: ids(state.players.cpu.hand),
      waste: ids(state.players.cpu.waste),
    },
    foundations: state.foundations.map((f) => ids(f.cards)),
  };
  return JSON.stringify(snapshot);
}
