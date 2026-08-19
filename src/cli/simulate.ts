// Headless random-legal-move simulation harness (§14 build order step 4). Plays full
// Crapette games using only /engine (no rendering, no AI heuristics yet) to shake out
// rules-engine bugs before any UI exists. Node-only file — lives outside /engine, so
// process/console usage here is fine.
import { chooseCompulsoryMove, chooseMove, chooseOptionalMove } from '../ai/cpuPlayer.ts';
import { deal } from '../engine/deck.ts';
import { applyMove, discardDrawnCardToWaste, drawFromHand, passTurn, startTurn } from '../engine/engine.ts';
import { canDrawHand, getLegalMoves } from '../engine/moveResolver.ts';
import type { Card, GameState, PlayerId } from '../engine/types.ts';
import { checkStalemate, checkWin } from '../engine/winCheck.ts';

// §14 step 5: which move-selection policy each player uses this run. 'random' is the
// original step-4 harness behavior (kept byte-for-byte, including its draw/discard bias);
// 'heuristic' routes through cpuPlayer.ts's §7 rule-based AI instead, to validate it against
// this same harness per the build order ("tested against the harness from step 4").
type Policy = 'random' | 'heuristic';

// With two decks in play, a house-building swap can be fully legal and exactly
// reversible (e.g. 5H moving onto either of two black 6s from the two decks, then back)
// — a uniform-random bot can rarely get stuck oscillating in such a pair for a long
// stretch, which is a property of the real game's rules with duplicate cards, not an
// engine bug (confirmed by re-running a capped-out seed with cycle-detection logging:
// the state repeats exactly every ~2000 moves). applyMove also clones the full
// GameState — including the current turn's move log — on every call, so an abnormally
// long single turn costs roughly O(turn length^2); this cap exists to fail such a rare
// pathological random walk fast (a real turn is a handful of moves) rather than let it
// silently cost minutes.
const MAX_MOVES_PER_GAME = 3_000;

function pickRandom<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

function allCardsInPlay(state: GameState): Card[] {
  const p = state.players;
  return [
    ...p.human.reserve,
    ...p.human.houses.flat(),
    ...p.human.hand,
    ...p.human.waste,
    ...p.cpu.reserve,
    ...p.cpu.houses.flat(),
    ...p.cpu.hand,
    ...p.cpu.waste,
    ...state.foundations.flatMap((f) => f.cards),
  ];
}

function assertInvariants(state: GameState): void {
  const cards = allCardsInPlay(state);
  if (cards.length !== 104) {
    throw new Error(`invariant violated: expected 104 cards in play, found ${cards.length}`);
  }
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== 104) {
    throw new Error('invariant violated: duplicate card id detected across piles');
  }
}

// One "step" of the §8 turn algorithm: forced move if one exists, otherwise a random
// optional move or a draw, chosen with just enough bias to make reasonable progress
// without needing any game-playing intelligence (that's cpuPlayer.ts's job).
function playRandomStep(state: GameState, player: PlayerId, rng: () => number): GameState {
  const { compulsory, optional } = getLegalMoves(state, player);
  if (compulsory.length > 0) {
    state = applyMove(state, pickRandom(compulsory, rng));
    return checkStalemate(checkWin(state, player));
  }

  const draw = canDrawHand(state, player);
  if (optional.length > 0 && (!draw || rng() < 0.6)) {
    state = applyMove(state, pickRandom(optional, rng));
    return checkStalemate(checkWin(state, player));
  }

  if (!draw) {
    // No compulsory move, no optional move, and nothing left to draw — pass this turn.
    return checkStalemate(passTurn(state, player));
  }

  state = drawFromHand(state, player);
  const hand = state.players[player].hand;
  const drawnId = hand[hand.length - 1].id;
  const afterDraw = getLegalMoves(state, player);
  const playsForDrawnCard = [...afterDraw.compulsory, ...afterDraw.optional].filter(
    (m) => m.from.type === 'hand' && m.card.id === drawnId,
  );

  state =
    playsForDrawnCard.length > 0 && rng() < 0.7
      ? applyMove(state, pickRandom(playsForDrawnCard, rng))
      : discardDrawnCardToWaste(state, player);

  return checkStalemate(checkWin(state, player));
}

// §7 step 3/4 driving the same §8 loop: always take the top-ranked compulsory/optional move
// if one exists; only draw once none remain (which, per chooseMove, can also happen with
// optional moves still on the table if none of them are worth taking — see cpuPlayer.ts).
function playHeuristicStep(state: GameState, player: PlayerId): GameState {
  const legal = getLegalMoves(state, player);
  const move = chooseMove(state, player, legal);
  if (move) {
    state = applyMove(state, move);
    return checkStalemate(checkWin(state, player));
  }

  if (!canDrawHand(state, player)) {
    return checkStalemate(passTurn(state, player));
  }

  // Resolve *only* the drawn card's fate here — some other always-available move (e.g. a
  // house shuffle with nothing better to do) could otherwise still be sitting in the legal
  // set and get chosen instead, leaving the drawn card stuck face-up, unplayed and
  // undiscarded, forever. Scope to moves sourced from this exact card.
  //
  // Deliberately bypass chooseMove's "worth taking" filter here: per §8's pseudocode, once a
  // card is drawn the CPU always plays it if *any* legal move exists ("cpu: yes if any
  // exist") — that decision is unconditional, unlike the score-based ranking used to choose
  // among already-available moves before drawing.
  state = drawFromHand(state, player);
  const hand = state.players[player].hand;
  const drawnId = hand[hand.length - 1].id;
  const afterDraw = getLegalMoves(state, player);
  const compulsoryForDrawnCard = afterDraw.compulsory.filter((m) => m.from.type === 'hand' && m.card.id === drawnId);
  const optionalForDrawnCard = afterDraw.optional.filter((m) => m.from.type === 'hand' && m.card.id === drawnId);
  const drawnMove =
    compulsoryForDrawnCard.length > 0
      ? chooseCompulsoryMove(compulsoryForDrawnCard)
      : optionalForDrawnCard.length > 0
        ? chooseOptionalMove(state, player, optionalForDrawnCard)
        : null;
  state = drawnMove ? applyMove(state, drawnMove) : discardDrawnCardToWaste(state, player);

  return checkStalemate(checkWin(state, player));
}

function playOneStep(state: GameState, rng: () => number, policies: Record<PlayerId, Policy>): GameState {
  const player = state.turn;
  state = startTurn(state);
  return policies[player] === 'heuristic' ? playHeuristicStep(state, player) : playRandomStep(state, player, rng);
}

function makeRng(seed: number): () => number {
  let s = seed % 0x7fffffff || 1;
  return () => {
    s = (s * 48271) % 0x7fffffff;
    return s / 0x7fffffff;
  };
}

interface GameResult {
  state: GameState;
  moves: number;
}

function playGame(seed: number, policies: Record<PlayerId, Policy>): GameResult {
  const rng = makeRng(seed);
  let state = deal(rng);
  assertInvariants(state);

  let moves = 0;
  while (state.status === 'in_progress') {
    if (moves >= MAX_MOVES_PER_GAME) {
      throw new Error(`exceeded ${MAX_MOVES_PER_GAME} moves without reaching an end state`);
    }
    state = playOneStep(state, rng, policies);
    assertInvariants(state);
    moves++;
  }
  return { state, moves };
}

function parseGamesArg(argv: string[]): number {
  const flagIndex = argv.indexOf('--games');
  const raw = flagIndex !== -1 ? argv[flagIndex + 1] : undefined;
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// §14 step 5: --heuristic-human / --heuristic-cpu independently switch that player from the
// step-4 random bot to cpuPlayer.ts's heuristic, so this harness can validate heuristic-vs-
// random and heuristic-vs-heuristic play, not just random-vs-random.
function parsePolicies(argv: string[]): Record<PlayerId, Policy> {
  return {
    human: argv.includes('--heuristic-human') ? 'heuristic' : 'random',
    cpu: argv.includes('--heuristic-cpu') ? 'heuristic' : 'random',
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const games = parseGamesArg(argv);
  const policies = parsePolicies(argv);
  const wins: Record<PlayerId, number> = { human: 0, cpu: 0 };
  let stalemates = 0;
  let failures = 0;
  const winningScores: number[] = [];

  for (let i = 0; i < games; i++) {
    const seed = i + 1;
    try {
      const { state, moves } = playGame(seed, policies);
      if (state.status === 'won' && state.winner) {
        wins[state.winner]++;
        winningScores.push(state.scores?.[state.winner] ?? 0);
      } else if (state.status === 'stalemate') {
        stalemates++;
      }
      if (games === 1) {
        console.log(`status=${state.status} winner=${state.winner ?? 'none'} scores=${JSON.stringify(state.scores)} moves=${moves}`);
        console.log('final turn move log:', JSON.stringify(state.turnMoveLog, null, 2));
      }
    } catch (err) {
      failures++;
      console.error(`game seed=${seed} FAILED:`, err instanceof Error ? err.message : err);
      if (games === 1) throw err;
    }
  }

  console.log(`\n${games} game(s) simulated. policies — human: ${policies.human}, cpu: ${policies.cpu}`);
  console.log(`wins — human: ${wins.human}, cpu: ${wins.cpu} | stalemates: ${stalemates} | failures: ${failures}`);
  if (winningScores.length > 0) {
    const avg = winningScores.reduce((a, b) => a + b, 0) / winningScores.length;
    console.log(`average winning score: ${avg.toFixed(1)}`);
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
