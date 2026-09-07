// Pure data model (§3). No Pixi/DOM/Node imports allowed in this file or anywhere
// else under /src/engine — see §4's portability requirement.

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13; // 1=A, 11=J, 12=Q, 13=K

export interface Card {
  id: string; // unique per physical card instance, e.g. "H7-0"
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

export type PlayerId = 'human' | 'cpu';

export interface PlayerState {
  id: PlayerId;
  reserve: Card[]; // index 0 = bottom, last = top (face-up)
  houses: [Card[], Card[], Card[], Card[]]; // each a face-up overlapping sequence; last = outer/available
  hand: Card[]; // face-down draw pile
  waste: Card[]; // last = top/available
  needsHandReshuffle: boolean; // true if hand emptied via a turn-ending discard; reshuffle happens at next turn start
}

export interface FoundationSlot {
  suit: Suit | null; // set once an Ace is placed
  cards: Card[]; // top = cards[cards.length-1]
}

export type GameStatus = 'in_progress' | 'won' | 'stalemate';

export interface GameState {
  players: Record<PlayerId, PlayerState>;
  foundations: FoundationSlot[]; // length 8
  turn: PlayerId;
  turnMoveLog: Move[]; // moves made so far this turn (for animation/replay/debug)
  status: GameStatus;
  winner?: PlayerId;
  scores?: Record<PlayerId, number>; // set once status !== 'in_progress'
  roundsWithoutProgress: number; // stalemate detection counter, see §9
  turnVisitedSignatures: string[]; // board-state signatures seen so far this turn, see stateSignature.ts
}

export type PileRef =
  | { type: 'reserve'; owner: PlayerId }
  | { type: 'house'; owner: PlayerId; index: 0 | 1 | 2 | 3 }
  | { type: 'hand'; owner: PlayerId }
  | { type: 'waste'; owner: PlayerId }
  | { type: 'foundation'; index: number };

export interface Move {
  card: Card;
  from: PileRef;
  to: PileRef;
}

export type RejectReason =
  | 'wrong-suit-sequence' // foundation: not next rank up in same suit, or not an ace on empty
  | 'wrong-house-sequence' // house: not descending/alternating-color, or house not empty
  | 'wrong-load-match' // opponent pile: not same suit ±1 rank
  | 'not-available' // card isn't the exposed/top card of its pile
  | 'compulsory-move-pending' // another move is mandatory right now, this one isn't it
  | 'forbidden-destination'; // own reserve, own waste (mid-turn from elsewhere), either hand

export interface MoveEvaluation {
  move: Move;
  legal: boolean;
  reason?: RejectReason; // present when legal === false, drives the UI toast copy
}
