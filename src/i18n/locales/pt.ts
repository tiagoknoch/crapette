import type en from './en.ts';

// `satisfies typeof en` (not `: typeof en`) keeps the literal string types so i18next's own
// key-completion still works off this file, while still erroring at compile time if a key is
// missing or misspelled relative to en.ts.
const pt = {
  reject: {
    wrongSuitSequence: 'Não corresponde ao naipe/sequência dessa fundação',
    wrongHouseSequence: 'Não encaixa nessa casa (precisa ser ordem decrescente, cores alternadas)',
    wrongLoadMatch: 'Não corresponde ao naipe e valor (±1) dessa pilha',
    notAvailable: 'Essa carta não está disponível para mover',
    compulsoryMovePending: 'Uma jogada obrigatória precisa ser feita primeiro',
    forbiddenDestination: 'Você não pode colocar uma carta ali',
    mustFillEmptyHouse: 'Preencha a casa vazia com sua reserva primeiro',
    nothingToDraw: 'Não há mais nada para comprar',
    cannotDrawYet: 'Você não pode comprar uma carta agora',
  },
  turn: {
    human: 'Sua vez',
    cpu: 'Vez do CPU',
  },
  end: {
    youWon: 'Você venceu!',
    cpuWon: 'O CPU venceu!',
    stalemate: 'Empate',
    stalemateWinner: 'Empate — {{winner}}',
    stalemateHumanWins: 'você vence',
    stalemateCpuWins: 'o CPU vence',
    scoreLine: 'Você: {{human}} pts · CPU: {{cpu}} pts',
    playAgain: 'Jogar Novamente',
  },
  footer: {
    aboutLegal: 'Sobre / Legal',
  },
  rotate: {
    message: 'Gire seu dispositivo para a horizontal para jogar.',
  },
  resume: {
    message: 'Você tem um jogo em andamento. Continuar ou começar um novo jogo?',
    resumeButton: 'Continuar jogo',
    newGameButton: 'Novo jogo',
  },
  about: {
    title: 'Sobre e Aspectos Legais',
    body: [
      'Crapette — uma versão web do Banco Russo (Russian Bank).',
      '',
      'Créditos de terceiros:',
      '• Arte das cartas: SVG-cards por Huub de Beer (LGPL-2.1)',
      '  github.com/htdebeer/SVG-cards',
      '• Renderização: PixiJS (Licença MIT) — pixijs.com',
      '• Construído com Vite, TypeScript e Vitest (Licença MIT)',
      '',
      'A licença do código-fonte deste projeto ainda não foi publicada.',
    ].join('\n'),
  },
} satisfies typeof en;

export default pt;
