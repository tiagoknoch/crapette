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
  cpu: {
    draws: 'comprando uma carta',
    playsToFoundation: 'jogando {{card}} numa fundação',
    playsToOwnHouse: 'jogando {{card}} na própria casa',
    loadsHouse: 'carregando {{card}} na sua casa',
    loadsReserve: 'carregando {{card}} na sua reserva',
    loadsWaste: 'carregando {{card}} no seu descarte',
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
  toolbar: {
    wordmark: 'Crapette',
    qualifier: 'BANCO RUSSO',
    about: 'Sobre / Legal',
    newGame: 'Novo Jogo',
    howToPlay: 'Como Jogar',
    settings: 'Configurações',
  },
  newGameConfirm: {
    message: 'Começar um novo jogo? Seu jogo em andamento será descartado.',
    confirm: 'Novo Jogo',
    keepPlaying: 'Continuar Jogando',
  },
  settings: {
    aboutLegalTitle: 'Sobre / Legal',
    aboutLegalSub: 'Arte das cartas, motor, licenças',
  },
  board: {
    emptyHouse: 'CASA VAZIA',
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
      'O código-fonte deste projeto está sob a licença MIT.',
    ].join('\n'),
  },
  rules: {
    title: 'Como Jogar',
    body: [
      'Objetivo',
      'Seja o primeiro a esvaziar sua reserva, suas casas, seu monte de compra e sua pilha de descarte.',
      '',
      'Preparação',
      'Você começa com uma reserva de 13 cartas (a carta do topo virada para cima), 4 casas com uma carta cada, e um monte de compra de 35 cartas viradas para baixo.',
      '',
      'Cartas disponíveis',
      'Você pode jogar: o topo da sua própria reserva, a carta externa de qualquer casa (sua ou do adversário), sua carta de compra virada para cima, e o topo da sua própria pilha de descarte.',
      '',
      'Fundações (compartilhadas)',
      'Uma fundação vazia só aceita um Ás. Depois, construa em ordem crescente no mesmo naipe: A, 2, 3 ... K.',
      '',
      'Casas',
      'Construa em ordem decrescente com cores alternadas (por exemplo, um 7 preto sobre um 8 vermelho). Uma casa vazia aceita qualquer carta.',
      '',
      'Carregando o adversário',
      'Você pode colocar uma carta do mesmo naipe, um valor acima ou abaixo, na reserva ou na pilha de descarte de qualquer jogador — nunca na sua própria reserva, e nunca no monte de compra de ninguém.',
      '',
      'Jogadas obrigatórias',
      'Se houver uma jogada possível para uma fundação, você deve fazê-la antes de qualquer outra coisa. Se sua reserva não estiver vazia e houver uma casa vazia, você deve preenchê-la com a reserva antes de comprar uma carta.',
      '',
      'Turnos',
      'Continue jogando enquanto tiver jogadas legais. Quando não tiver mais nenhuma, você pode virar a carta do topo do seu monte de compra — se não jogá-la, ela vai para sua pilha de descarte e seu turno termina.',
      '',
      'Vitória e pontuação',
      'Esvaziar sua reserva, casas, monte de compra e pilha de descarte garante a vitória imediata. O vencedor marca 30 pontos, mais 1 por carta restante na mão/descarte do perdedor e 2 por carta restante na reserva dele. Se nenhum dos jogadores puder progredir, é um empate, pontuado da mesma forma, mas sem o bônus de 30 pontos.',
    ].join('\n'),
  },
} satisfies typeof en;

export default pt;
