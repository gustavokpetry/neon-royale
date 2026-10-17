/** Constantes do jogo num só lugar (equilíbrio sem caçar números). Tempos em segundos, distâncias em px. */
export const CONFIG = {
  sala: {
    tamanhoCodigo: 6,
    alfabetoCodigo: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    prazoReconexaoMs: 120_000,
    encerrarSalaVaziaMs: 120_000,
    tamanhoMaxApelido: 16,
    maxTentativasEntradaPorMinuto: 12,
    intervaloLimpezaMs: 5_000,
    /** Uma vaga por personagem (Veni, Gut, Vini, Daniel, Lucas, Pacheco); a partida começa com 2 ou mais. */
    jogadores: 6,
    minimoJogadores: 2,
  },
  rede: {
    taxaSimulacaoHz: 20,
    maxBytesMensagem: 8_000,
    maxEventosPorSegundo: 30,
    rajadaEventos: 60,
    /** Comandos de movimento: 20/s normalmente; a folga absorve rajadas depois de travadas do navegador. */
    maxComandosPorSegundo: 40,
    intervaloPingMs: 2_000,
  },
  movimento: {
    /** Passo fixo de cada comando de movimento. */
    dtComando: 0.05,
    velocidadeBase: 190,
    raioJogador: 12,
    /** Comandos aplicados por tick, no máximo (contra trapaça de velocidade). */
    maxComandosPorTick: 4,
  },
  vida: { maxima: 100 },
  areaSegura: {
    raio: 96,
    /** Proteção por no máximo este tempo seguido; volta ao sair e entrar de novo. */
    segMaxSeguidos: 8,
  },
  pickups: {
    raioColeta: 22,
    vida: { cura: 35, segReaparecer: 20 },
    forca: { bonusDano: 0.5, segDuracao: 8, segReaparecer: 30 },
  },
  queimadura: { segIntervalo: 1 },
  partida: { segContagem: 3 },
} as const;
