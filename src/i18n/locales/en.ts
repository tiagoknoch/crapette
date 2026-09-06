// §14 step 10: the canonical set of translation keys — every other locale is typed against
// this one (see pt.ts's `satisfies typeof en`) so a missing/misspelled key is a compile error
// rather than a silent fallback-to-English at runtime.
const en = {
  reject: {
    wrongSuitSequence: "Doesn't match that foundation's suit/sequence",
    wrongHouseSequence: "Doesn't fit that house (needs descending rank, alternating color)",
    wrongLoadMatch: "Doesn't match that pile's suit and rank (±1)",
    notAvailable: "That card isn't available to move",
    compulsoryMovePending: 'A forced move must be played first',
    forbiddenDestination: "You can't place a card there",
    mustFillEmptyHouse: 'Fill the empty house from your reserve first',
    nothingToDraw: "There's nothing left to draw",
    cannotDrawYet: "You can't draw a card right now",
  },
  turn: {
    human: 'Your turn',
    cpu: "CPU's turn",
  },
  end: {
    youWon: 'You won!',
    cpuWon: 'CPU won!',
    stalemate: 'Stalemate',
    stalemateWinner: 'Stalemate — {{winner}}',
    stalemateHumanWins: 'you win',
    stalemateCpuWins: 'CPU wins',
    scoreLine: 'You: {{human}} pts · CPU: {{cpu}} pts',
    playAgain: 'Play Again',
  },
  footer: {
    aboutLegal: 'About / Legal',
  },
  rotate: {
    message: 'Please rotate your device to landscape to play.',
  },
  resume: {
    message: 'You have a game in progress. Resume it, or start a new game?',
    resumeButton: 'Resume game',
    newGameButton: 'New game',
  },
  about: {
    title: 'About & Legal',
    body: [
      'Crapette — a web implementation of Russian Bank.',
      '',
      'Third-party credits:',
      '• Card art: SVG-cards by Huub de Beer (LGPL-2.1)',
      '  github.com/htdebeer/SVG-cards',
      '• Rendering: PixiJS (MIT License) — pixijs.com',
      '• Built with Vite, TypeScript, and Vitest (MIT License)',
      '',
      "This project's own source license has not been published yet.",
    ].join('\n'),
  },
};

export default en;
