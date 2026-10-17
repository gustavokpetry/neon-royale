/**
 * Simulação autoritativa da partida: movimento por comandos, combate, habilidades,
 * áreas seguras, pickups, efeitos contínuos, entidades no mapa e fim de jogo.
 * Funções puras sobre o estado (testáveis sem rede).
 */
import { CONFIG } from '@shared/config';
import { bloqueiaTiro, destinoFuga, linhaLivre, mover, pontoLivrePerto, posicaoLivre } from '@shared/colisao';
import { BLOCO, MAPAS, MAPA_PADRAO, T, bloco, copiaDoMapa, dentroDaArea, type Mapa, type Retangulo } from '@shared/mapa';
import { aplicarMovimento, fatorTinta, fatorVelocidade, passagemDe, type Poca } from '@shared/movimento';
import { HABILIDADES, IDS_PERSONAGENS, PERSONAGENS, vidaMaxima, type EstiloProjetil, type IdPersonagem } from '@shared/personagens';
import { CASA_PINTURA, MODOS_EQUIPE, MODOS_TROCA, type Efeito, type EntidadeSnap, type LutadorSnap, type ModoJogo, type PontoControleSnap, type Snapshot } from '@shared/protocolo';

const R = CONFIG.movimento.raioJogador;
const H = HABILIDADES;

export interface Comando {
  seq: number;
  x: number;
  y: number;
}

/** Efeito contínuo (queimadura ou veneno): dano por tique de 1 s. */
interface Dot {
  tipo: 'fogo' | 'veneno';
  dano: number;
  tiques: number;
  proximo: number;
  de: string;
}

export interface Lutador {
  id: string;
  personagem: IdPersonagem;
  /** Equipe nos modos em equipe (senão null). */
  equipe: number | null;
  vaga: number;
  x: number;
  y: number;
  vida: number;
  vivo: boolean;
  fila: Comando[];
  seq: number;
  mx: number;
  my: number;
  mira: { x: number; y: number };
  recargaAtaqueAte: number;
  recargaAtivaAte: number;
  preparada: boolean;
  forcaAte: number;
  dots: Dot[];
  areaDesde: number | null;
  areaSuspensa: boolean;
  escudoAte: number;
  rapidoAte: number;
  adrenalinaPronta: number;
  chocadoAte: number;
  voandoAte: number;
  // novos
  invisivelAte: number;
  emboscada: boolean;
  frio: { camadas: number; ate: number };
  congeladoAte: number;
  presoAte: number;
  silenciadoAte: number;
  laserAte: number;
  ultimoMovimento: number;
  furiaAte: number;
  refletindoAte: number;
  fugaUsada: boolean;
  /** Posições e vida recentes (Relojoeiro). */
  historico: Array<{ t: number; x: number; y: number; vida: number }>;
  // terceira leva e modos
  marcadoAte: number;
  cancaoAte: number;
  sobrecargaAte: number;
  foco: { alvo: string; n: number } | null;
  refrao: number;
  ultimoDanoRecebido: number;
  proximaRegen: number;
  /** Abates (modo abates) ou progresso (corrida). */
  pontos: number;
  /** Lava: próximo tique de dano; último inimigo que acertou (leva o crédito se morrer na lava). */
  proximaLava: number;
  ultimoAtacante: { id: string; ate: number } | null;
  /** Velocidade (gelo), portais, trampolim e moita. */
  vx: number;
  vy: number;
  portalPronto: number;
  salto: { x0: number; y0: number; x1: number; y1: number; inicio: number; dur: number } | null;
  /** Atacou há pouco: aparece mesmo dentro de uma moita. */
  reveladoAte: number;
  /** Atirador: Corrida ativa até. Caçador: alvo marcado (as boleadeiras seguem ele). */
  corridaAte: number;
  marcaAlvo: { id: string; ate: number } | null;
  /** Supernova guardada e efeito ativo até. */
  temSupernova: boolean;
  supernovaAte: number;
  /** Quando renasce (modos com renascimento); `fora` = saiu da partida. */
  renascerEm: number;
  fora: boolean;
  /** Compatibilidade com a queimadura antiga (lida pelos testes e pelo snapshot). */
  readonly queimadura: Dot | null;
}

export interface Projetil {
  id: number;
  dono: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  vel: number;
  restante: number;
  alcance: number;
  dano: number;
  estilo: EstiloProjetil;
  /** Multiplicador fixado no disparo (força, carga, paciência, emboscada). */
  mult: number;
  /** Só começa a voar depois deste instante (chuva de granadas). */
  inicio: number;
  preparada: boolean;
  tinta: boolean;
  agua: boolean;
  atravessa: boolean;
  atingidos: Set<string>;
  bumerangue: { voltando: boolean; atingidosVolta: Set<string> } | null;
  arco: { x0: number; y0: number; total: number } | null;
  explosao: { raio: number; danoBorda: number } | null;
  /** Efeitos do acerto. */
  veneno?: { dano: number; tiques: number };
  frio?: boolean;
  rouboVida?: number;
  pane?: boolean;
  gancho?: boolean;
  /** Projétil do drone (não conta como ataque do dono para a área segura). */
  drone?: boolean;
  ricochetes?: number;
  prende?: number;
  marca?: boolean;
  troca?: boolean;
  /** Teleguiado até este jogador (boleadeiras do Caçador durante a marca). */
  guiado?: string;
}

export interface PocaJogo extends Poca {
  ate: number;
  balde: boolean;
}

export interface Onda {
  dono: string;
  x: number;
  y: number;
  inicio: number;
  atingidos: Set<string>;
}

export type Entidade =
  | { tipo: 'parede'; id: number; dono: string; ret: Retangulo; ate: number }
  | { tipo: 'mina'; id: number; dono: string; x: number; y: number; armadaEm: number }
  | { tipo: 'drone'; id: number; dono: string; x: number; y: number; ate: number; proximoTiro: number }
  | { tipo: 'clone'; id: number; dono: string; personagem: IdPersonagem; x: number; y: number; dx: number; dy: number; ate: number; parado: boolean }
  | { tipo: 'totem'; id: number; dono: string; x: number; y: number; r: number; ate: number; proximo: number }
  | { tipo: 'nuvem'; id: number; dono: string; x: number; y: number; r: number; ate: number; proximo: number }
  | { tipo: 'buraco'; id: number; dono: string; x: number; y: number; r: number; ate: number; proximo: number }
  | { tipo: 'meteoro'; id: number; dono: string; x: number; y: number; r: number; ate: number };

/** Pega Bandeira: estado de um ponto de controle. */
export interface PontoControle extends PontoControleSnap {}

/** Regras do Pega Bandeira. */
export const BANDEIRA = { segCaptura: 3, meta: 300, segPartida: 300, raio: 70, raioCentro: 110, valor: 1, valorCentro: 3 } as const;
const ehBandeira = (m: ModoJogo) => m === 'bandeira' || m === 'bandeiraEquipe';

/** Pintão: grade de pintura do mapa. */
export interface Pintura {
  colunas: number;
  linhas: number;
  /** Lado dono de cada casa (0 = sem tinta). */
  dono: Uint8Array;
  /** Quem pintou cada casa (vaga + 1): ao morrer, o jogador perde as casas que pintou. */
  pintor: Uint8Array;
  /** Casas onde dá para pintar (chão livre). */
  pintavel: Uint8Array;
  pintaveis: number;
  /** Quantas casas cada lado tem (índice = lado). */
  contagem: number[];
  /** Mudanças desde o último envio: pares [índice, lado]. */
  mudancas: number[];
  proximaCompleta: number;
  enviarCompleta: boolean;
}

export const PINTAO = { segPartida: 180, raioRastro: 24, raioImpacto: 40 } as const;
const ehPintao = (m: ModoJogo) => m === 'pintao' || m === 'pintaoEquipe';

function criarPintura(m: Mapa): Pintura {
  const colunas = Math.ceil(m.largura / CASA_PINTURA);
  const linhas = Math.ceil(m.altura / CASA_PINTURA);
  const pintavel = new Uint8Array(colunas * linhas);
  let pintaveis = 0;
  for (let r = 0; r < linhas; r++) {
    for (let c = 0; c < colunas; c++) {
      // o centro da casa precisa estar em chão livre (nem obstáculo nem água)
      const bx = Math.floor(((c + 0.5) * CASA_PINTURA) / BLOCO);
      const by = Math.floor(((r + 0.5) * CASA_PINTURA) / BLOCO);
      if (bloco(m, bx, by) === 0) {
        pintavel[r * colunas + c] = 1;
        pintaveis++;
      }
    }
  }
  return { colunas, linhas, dono: new Uint8Array(colunas * linhas), pintor: new Uint8Array(colunas * linhas), pintavel, pintaveis, contagem: new Array(8).fill(0), mudancas: [], proximaCompleta: 0, enviarCompleta: true };
}

/** Lado de pintura de um jogador: equipe + 1, ou vaga + 1. */
const ladoPintura = (l: Lutador) => (l.equipe !== null ? l.equipe + 1 : l.vaga + 1);

/** Pinta as casas dentro do raio com a cor do jogador. */
export function pintar(e: EstadoJogo, l: Lutador, x: number, y: number, raio: number): void {
  const p = e.pintura;
  if (!p) return;
  const lado = ladoPintura(l);
  const pintor = l.vaga + 1;
  const c0 = Math.max(0, Math.floor((x - raio) / CASA_PINTURA));
  const c1 = Math.min(p.colunas - 1, Math.floor((x + raio) / CASA_PINTURA));
  const r0 = Math.max(0, Math.floor((y - raio) / CASA_PINTURA));
  const r1 = Math.min(p.linhas - 1, Math.floor((y + raio) / CASA_PINTURA));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * p.colunas + c;
      if (!p.pintavel[i]) continue;
      const cx = (c + 0.5) * CASA_PINTURA;
      const cy = (r + 0.5) * CASA_PINTURA;
      if (Math.hypot(cx - x, cy - y) > raio + CASA_PINTURA / 2) continue;
      if (p.dono[i] === lado && p.pintor[i] === pintor) continue;
      p.contagem[p.dono[i]!]!--;
      p.dono[i] = lado;
      p.pintor[i] = pintor;
      p.contagem[lado]!++;
      p.mudancas.push(i, lado);
    }
  }
}

/** Ao morrer no Pintão, o jogador perde as casas que pintou. */
function apagarPintura(e: EstadoJogo, l: Lutador): void {
  const p = e.pintura;
  if (!p) return;
  const pintor = l.vaga + 1;
  for (let i = 0; i < p.dono.length; i++) {
    if (p.pintor[i] !== pintor) continue;
    p.contagem[p.dono[i]!]!--;
    p.contagem[0]!++;
    p.dono[i] = 0;
    p.pintor[i] = 0;
    p.mudancas.push(i, 0);
  }
}

/** Depois de enviar o snapshot a todos: zera as mudanças acumuladas. */
export function limparMudancasPintura(e: EstadoJogo): void {
  if (!e.pintura) return;
  e.pintura.mudancas = [];
  e.pintura.enviarCompleta = false;
}

/** Supernova: aparece a cada 30 s num lugar sorteado (uma por vez). */
export const SUPERNOVA = { segIntervalo: 30, segDuracao: 5, dano: 2, recarga: 0.5, movimento: 1.5, danoNeon: 1.5, recargaNeon: 0.75, raioColeta: 34 } as const;
/** Lava: dano por segundo (em 2 tiques) e tempo que o último atacante leva o crédito. */
export const LAVA = { danoPorSeg: 8, segCredito: 3 } as const;

/** Muro que quebra (Demolição). */
export interface Muro {
  id: number;
  ret: Retangulo;
  vida: number;
}
export const MURO = { vida: 60 } as const;
/** Trampolim: duração do salto; portal: espera para usar de novo. */
export const SALTO = { segDuracao: 0.7, raio: 24 } as const;
export const PORTAL = { raio: 24, segEspera: 1 } as const;
/** Moita: quem está dentro só é visto de perto (ou se atacou há pouco). */
export const MOITA = { raioVisto: 120, segRevelado: 1.5 } as const;

export interface EstadoJogo {
  mapa: Mapa;
  modo: ModoJogo;
  pintura: Pintura | null;
  muros: Muro[];
  supernova: { x: number; y: number } | null;
  proximaSupernova: number;
  controle: PontoControle[];
  /** Pega Bandeira: fim por tempo e próximo tique de pontos. */
  fimEm: number;
  proximoPontoControle: number;
  pontosEquipe: [number, number];
  coresEquipe: [string, string];
  /** Neoncalypse: próximo tique de dano da zona. */
  proximoDanoZona: number;
  /** Pontos para vencer nos modos abates e corrida. */
  meta: number;
  inicio: number;
  lutadores: Map<string, Lutador>;
  projeteis: Projetil[];
  proximoProjetil: number;
  pocas: PocaJogo[];
  proximaPoca: number;
  ondas: Onda[];
  entidades: Entidade[];
  proximaEntidade: number;
  pickups: Map<string, number>;
  ultimoTick: number;
  fim: { vencedorId: string | null; equipe?: number } | null;
  /** Sorteio (Duplicata do Espelho); trocável nos testes. */
  aleatorio: () => number;
}

export function criarJogo(
  participantes: Array<{ id: string; personagem: IdPersonagem; vaga?: number; equipe?: number }>,
  agora: number,
  mapa: Mapa = MAPAS[MAPA_PADRAO],
  modo: ModoJogo = 'royale',
  coresEquipe: [string, string] = ['#ff3d9a', '#19d3e6'],
  ladosTrocados = false,
): EstadoJogo {
  const m = copiaDoMapa(mapa);
  const lutadores = new Map<string, Lutador>();
  const emEquipe = MODOS_EQUIPE.includes(modo);
  // em equipe: a equipe 0 nasce do lado esquerdo (vagas 0, 3, 4) e a 1 do direito (2, 1, 5)
  const vagasEquipe = ladosTrocados ? [[2, 1, 5], [0, 3, 4]] : [[0, 3, 4], [2, 1, 5]];
  const usadas = [0, 0];
  participantes.forEach((p, i) => {
    const equipe = emEquipe ? (p.equipe ?? i % 2) : null;
    const vaga = p.vaga ?? (equipe !== null ? vagasEquipe[equipe]![usadas[equipe]!++ % 3]! : i);
    const ini = m.nascimentos[vaga % m.nascimentos.length]!;
    const l = {
      id: p.id,
      personagem: p.personagem,
      equipe,
      vaga,
      x: ini.x,
      y: ini.y,
      vida: vidaMaxima(p.personagem),
      vivo: true,
      fila: [],
      seq: 0,
      mx: 0,
      my: 0,
      mira: { x: ini.x < m.largura / 2 ? 1 : -1, y: 0 },
      recargaAtaqueAte: 0,
      recargaAtivaAte: 0,
      preparada: false,
      forcaAte: 0,
      dots: [],
      areaDesde: null,
      areaSuspensa: false,
      escudoAte: 0,
      rapidoAte: 0,
      adrenalinaPronta: 0,
      chocadoAte: 0,
      voandoAte: 0,
      invisivelAte: 0,
      emboscada: false,
      frio: { camadas: 0, ate: 0 },
      congeladoAte: 0,
      presoAte: 0,
      silenciadoAte: 0,
      laserAte: 0,
      ultimoMovimento: agora,
      furiaAte: 0,
      refletindoAte: 0,
      fugaUsada: false,
      historico: [],
      marcadoAte: 0,
      cancaoAte: 0,
      sobrecargaAte: 0,
      foco: null,
      refrao: 0,
      ultimoDanoRecebido: 0,
      proximaRegen: 0,
      pontos: 0,
      proximaLava: 0,
      ultimoAtacante: null,
      temSupernova: false,
      supernovaAte: 0,
      corridaAte: 0,
      marcaAlvo: null,
      vx: 0,
      vy: 0,
      portalPronto: 0,
      salto: null,
      reveladoAte: 0,
      renascerEm: 0,
      fora: false,
    } as Omit<Lutador, 'queimadura'>;
    Object.defineProperty(l, 'queimadura', { get: () => (l as Lutador).dots.find((d) => d.tipo === 'fogo') ?? null, enumerable: false });
    lutadores.set(p.id, l as Lutador);
  });
  const estado: EstadoJogo = {
    mapa: m,
    modo,
    pintura: ehPintao(modo) ? criarPintura(m) : null,
    muros: m.destrutiveis.map((ret, i) => ({ id: -1000 - i, ret, vida: MURO.vida })),
    supernova: null,
    proximaSupernova: agora + (CONFIG.partida.segContagem + SUPERNOVA.segIntervalo) * 1000,
    controle: ehBandeira(modo) ? pontosDeControle(m) : [],
    fimEm: ehBandeira(modo)
      ? agora + (CONFIG.partida.segContagem + BANDEIRA.segPartida) * 1000
      : ehPintao(modo)
        ? agora + (CONFIG.partida.segContagem + PINTAO.segPartida) * 1000
        : 0,
    proximoPontoControle: 0,
    pontosEquipe: [0, 0],
    coresEquipe,
    proximoDanoZona: 0,
    meta: modo === 'abates' ? 10 : modo === 'corrida' ? IDS_PERSONAGENS.length : modo === 'equipes' ? 25 : ehBandeira(modo) ? BANDEIRA.meta : 0,
    inicio: agora,
    lutadores,
    projeteis: [],
    proximoProjetil: 1,
    pocas: [],
    proximaPoca: 1,
    ondas: [],
    entidades: [],
    proximaEntidade: 1,
    pickups: new Map(m.pickups.map((p) => [p.id, 0])),
    ultimoTick: agora,
    fim: null,
    aleatorio: Math.random,
  };
  if (estado.pintura) {
    estado.pintura.contagem[0] = estado.pintura.pintaveis;
    estado.meta = estado.pintura.pintaveis;
  }
  return estado;
}

/** Mesma equipe (nos modos em equipe): sem fogo amigo. */
export function aliados(a: { id: string; equipe: number | null } | undefined, b: { id: string; equipe: number | null } | undefined): boolean {
  return !!a && !!b && a.id !== b.id && a.equipe !== null && a.equipe === b.equipe;
}

/** Ids dos aliados de um jogador (a tinta deles não deixa lento). */
function idsAliados(e: EstadoJogo, l: Lutador): Set<string> {
  return new Set([...e.lutadores.values()].filter((o) => aliados(o, l)).map((o) => o.id));
}

/** Neoncalypse: dano, ataques e habilidades em dobro; movimento +50%. */
export const NEON = { dano: 2, recarga: 0.5, movimento: 1.5 } as const;
const neon = (e: EstadoJogo) => e.modo === 'neoncalypse';

/** Neoncalypse: raio da zona segura (fecha 28% a cada 30 s, encolhendo nos primeiros 10 s de cada etapa). */
export function raioZona(e: EstadoJogo, agora: number): number {
  const r0 = Math.hypot(e.mapa.largura / 2, e.mapa.altura / 2) + 60;
  const t = Math.max(0, (agora - e.inicio) / 1000 - CONFIG.partida.segContagem);
  const etapa = Math.floor(t / 30);
  const dentro = Math.min(1, (t - etapa * 30) / 10);
  const de = r0 * 0.72 ** Math.max(0, etapa - 1);
  const ate = r0 * 0.72 ** etapa;
  return Math.max(140, etapa === 0 ? r0 : de + (ate - de) * dentro);
}

/**
 * 7 pontos de controle simétricos: 1 maior no centro e 6 em volta (2 nos lados, 4 nas diagonais).
 * Cada um é ajustado para o ponto livre mais próximo do desejado e espelhado, para manter a simetria.
 */
export function pontosDeControle(m: Mapa): PontoControle[] {
  const cx = m.largura / 2;
  const cy = m.altura / 2;
  const livre = (x: number, y: number) => pontoLivrePerto(m, x, y, 'nada');
  const lado = livre(cx - 780, cy);
  const diag = livre(cx - 400, cy - 640);
  const pts: Array<[number, number, boolean]> = m.controle ? m.controle.map((p, i) => [p.x, p.y, i === 0]) : [
    [cx, cy, true],
    [lado.x, cy, false],
    [m.largura - lado.x, cy, false],
    [diag.x, diag.y, false],
    [m.largura - diag.x, diag.y, false],
    [diag.x, m.altura - diag.y, false],
    [m.largura - diag.x, m.altura - diag.y, false],
  ];
  return pts.map(([x, y, centro], id) => ({
    id,
    x: Math.round(x),
    y: Math.round(y),
    r: centro ? BANDEIRA.raioCentro : BANDEIRA.raio,
    valor: centro ? BANDEIRA.valorCentro : BANDEIRA.valor,
    dono: null,
    capturando: null,
    progresso: 0,
    disputado: false,
  }));
}

/** Lado de um jogador no Pega Bandeira: ele mesmo, ou a equipe. */
const ladoDe = (l: Lutador) => (l.equipe !== null ? `e${l.equipe}` : l.id);

/** Captura (3 s sozinho no ponto), disputa e pontos por segundo; fim por meta ou por tempo. */
function atualizarControle(e: EstadoJogo, dt: number, agora: number, efeitos: Efeito[]): void {
  for (const pc of e.controle) {
    const lados = new Set<string>();
    for (const l of e.lutadores.values()) if (l.vivo && Math.hypot(l.x - pc.x, l.y - pc.y) <= pc.r) lados.add(ladoDe(l));
    pc.disputado = lados.size > 1;
    if (lados.size === 1) {
      const lado = [...lados][0]!;
      if (lado === pc.dono) {
        pc.capturando = null;
        pc.progresso = 0;
      } else {
        if (pc.capturando !== lado) {
          pc.capturando = lado;
          pc.progresso = 0;
        }
        pc.progresso += dt / BANDEIRA.segCaptura;
        if (pc.progresso >= 1) {
          pc.dono = lado;
          pc.capturando = null;
          pc.progresso = 0;
          efeitos.push({ tipo: 'anel', x: pc.x, y: pc.y, raio: pc.r, cor: corDoLado(e, lado), ms: 500 });
        }
      }
    } else if (lados.size === 0 && pc.capturando) {
      // ninguém no ponto: o progresso volta devagar
      pc.progresso = Math.max(0, pc.progresso - dt / (BANDEIRA.segCaptura * 2));
      if (pc.progresso === 0) pc.capturando = null;
    }
  }
  // pontos a cada segundo
  if (agora >= e.proximoPontoControle) {
    e.proximoPontoControle = agora + 1000;
    for (const pc of e.controle) {
      if (!pc.dono) continue;
      if (pc.dono.startsWith('e')) e.pontosEquipe[Number(pc.dono.slice(1))]! += pc.valor;
      else {
        const l = e.lutadores.get(pc.dono);
        if (l) l.pontos += pc.valor;
      }
    }
  }
  const emEquipe = e.modo === 'bandeiraEquipe';
  const placar = emEquipe
    ? e.pontosEquipe.map((p, i) => ({ lado: i, p }))
    : [...e.lutadores.values()].filter((l) => !l.fora).map((l) => ({ lado: l.id, p: l.pontos }));
  const lider = [...placar].sort((a, b) => b.p - a.p);
  const venceu = (x: { lado: string | number } | undefined) =>
    (e.fim = emEquipe ? { vencedorId: null, ...(x ? { equipe: x.lado as number } : {}) } : { vencedorId: (x?.lado as string) ?? null });
  if (lider[0] && lider[0].p >= e.meta) venceu(lider[0]);
  else if (agora >= e.fimEm) venceu(lider[0] && lider[1] && lider[0].p === lider[1].p ? undefined : lider[0]);
}

function corDoLado(e: EstadoJogo, lado: string): string {
  if (lado.startsWith('e')) return e.coresEquipe[Number(lado.slice(1))] ?? '#ffffff';
  const l = e.lutadores.get(lado);
  return l ? PERSONAGENS[l.personagem].cor : '#ffffff';
}

/** Partida começa após a contagem regressiva. */
export const comecou = (e: EstadoJogo, agora: number) => agora >= e.inicio + CONFIG.partida.segContagem * 1000;

// ------------------------------------------------------------------ movimento

/** Fator de lentidão por frio, prisão e congelamento (1 = normal, 0 = parado). */
function outraLentidao(l: Lutador, agora: number): number {
  if (l.congeladoAte > agora || l.presoAte > agora) return 0;
  if (l.frio.ate > agora && l.frio.camadas > 0) return 1 - H.frio.porCamada * l.frio.camadas;
  return 1;
}

export function aplicarComando(m: Mapa, l: Lutador, c: Comando, pocas: readonly Poca[] = [], agora = 0, extra = 1, amigos?: Set<string>): { x: number; y: number; vx: number; vy: number } {
  const voando = l.voandoAte > agora;
  const tinta = voando ? H.voo.fatorVelocidade : fatorTinta(l.id, l.personagem, l.x, l.y, pocas, amigos);
  const f = fatorVelocidade(tinta, l.chocadoAte > agora, l.rapidoAte > agora, outraLentidao(l, agora)) * (l.cancaoAte > agora ? H.cancao.fator : 1) * extra;
  return aplicarMovimento(m, l.personagem, l.x, l.y, c.x, c.y, f, voando, { vx: l.vx, vy: l.vy });
}

export function receberComando(l: Lutador, c: Comando): void {
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || c.seq <= l.seq) return;
  if (l.fila.length && c.seq <= l.fila[l.fila.length - 1]!.seq) return;
  l.fila.push(c);
  if (l.fila.length > 20) l.fila.shift();
}

/** Mira atual (o escudo e o drone usam; os outros veem para onde você aponta). */
export function mirar(l: Lutador, dx: number, dy: number): void {
  const m = Math.hypot(dx, dy);
  if (l.vivo && m > 0.1) l.mira = { x: dx / m, y: dy / m };
}

/** Protegido = vivo, dentro da própria área, sem ter atacado de lá e há menos de N s seguidos lá. */
export function protegido(l: Lutador, agora: number, semAreas = false): boolean {
  return !semAreas && l.vivo && l.areaDesde !== null && !l.areaSuspensa && agora - l.areaDesde < CONFIG.areaSegura.segMaxSeguidos * 1000;
}

/** O escudo do Daniel cobre a direção de `origem`? */
export function escudoCobre(l: Lutador, ox: number, oy: number, agora: number): boolean {
  if (l.escudoAte <= agora) return false;
  const vx = ox - l.x;
  const vy = oy - l.y;
  const d = Math.hypot(vx, vy);
  if (d < 0.01) return true;
  const cos = (vx * l.mira.x + vy * l.mira.y) / d;
  return cos >= Math.cos((H.escudo.arcoGraus * Math.PI) / 180) - 1e-9;
}

/** Empurrões e puxões: a passiva Massa (Gravidade) ignora. */
function deslocar(e: EstadoJogo, o: Lutador, dx: number, dy: number, agora: number): void {
  if (o.personagem === 'gravidade') return;
  const novo = mover(e.mapa, o.x, o.y, dx, dy, passagemDe(o.personagem, o.voandoAte > agora));
  o.x = novo.x;
  o.y = novo.y;
}

// ------------------------------------------------------------------ dano

interface OpcoesDano {
  autor?: Lutador;
  tipo?: 'projetil' | 'corpo' | 'area' | 'dot' | 'lava' | 'estatica';
  rouboVida?: number;
}

function vencedorSe(e: EstadoJogo): void {
  if (e.fim) return;
  const vivos = [...e.lutadores.values()].filter((l) => l.vivo);
  if (vivos.length <= 1) e.fim = { vencedorId: vivos[0]?.id ?? null };
}

const multForca = (l: Lutador | undefined, agora: number) => (l && l.forcaAte > agora ? 1 + CONFIG.pickups.forca.bonusDano : 1);

export function aplicarDano(
  e: EstadoJogo,
  alvo: Lutador,
  valor: number,
  agora: number,
  efeitos: Efeito[],
  origem?: { x: number; y: number },
  op: OpcoesDano = {},
): number {
  if (!alvo.vivo) return 0;
  // sem fogo amigo nos modos em equipe
  if (op.autor && aliados(op.autor, alvo)) return 0;
  if (protegido(alvo, agora, neon(e)) || (origem && escudoCobre(alvo, origem.x, origem.y, agora))) {
    efeitos.push({ tipo: 'dano', alvo: alvo.id, valor: 0, bloqueado: true });
    return 0;
  }
  let mult = 1;
  const a = op.autor;
  if (a && a.id !== alvo.id && op.tipo !== 'lava') {
    // Sombra: pelas costas (o alvo está virado para o outro lado)
    if (a.personagem === 'sombra') {
      const vx = a.x - alvo.x;
      const vy = a.y - alvo.y;
      if (vx * alvo.mira.x + vy * alvo.mira.y < 0) mult *= 1 + H.costas.bonus;
    }
    // Berserker: quanto menos vida, mais dano
    if (a.personagem === 'berserker') mult *= 1 + H.sangueQuente.bonusMax * (1 - a.vida / vidaMaxima(a.personagem));
  }
  if (alvo.personagem === 'engenheiro' && op.tipo === 'projetil') mult *= 1 - H.blindado.reducao;
  if (alvo.personagem === 'atirador' && op.tipo === 'corpo') mult *= 1 + H.corpoAtirador.extra;
  if (alvo.marcadoAte > agora) mult *= 1 + H.marca.bonus;
  if (neon(e) && op.autor && op.tipo !== 'lava') mult *= NEON.dano;
  if (op.autor && op.autor.supernovaAte > agora && op.tipo !== 'lava') mult *= neon(e) ? SUPERNOVA.danoNeon : SUPERNOVA.dano;
  if (op.autor && op.autor.id !== alvo.id) alvo.ultimoAtacante = { id: op.autor.id, ate: agora + LAVA.segCredito * 1000 };
  if (a?.personagem === 'cacador' && estaLento(e, alvo, agora)) mult *= 1 + H.rastreador.bonus;
  alvo.ultimoDanoRecebido = agora;
  const v = Math.max(1, Math.round(valor * mult));
  const vidaAntes = alvo.vida;
  alvo.vida = Math.max(0, alvo.vida - v);
  alvo.invisivelAte = 0; // levar dano revela
  efeitos.push({ tipo: 'dano', alvo: alvo.id, valor: v, bloqueado: false });

  // roubo de vida (Vampiro, Fúria do Berserker)
  let roubo = op.rouboVida ?? 0;
  if (a?.personagem === 'berserker' && a.furiaAte > agora) roubo += H.furia.rouboVida;
  if (a && a.vivo && roubo > 0) curar(a, Math.min(v, vidaAntes) * roubo, efeitos); // só a vida que o alvo tinha

  // Estática (Lucas): qualquer ataque inimigo leva um choque de volta
  if (alvo.personagem === 'lucas' && a && a.vivo && a.id !== alvo.id && (op.tipo === 'projetil' || op.tipo === 'corpo' || op.tipo === 'area')) {
    efeitos.push({ tipo: 'estatica', de: alvo.id, alvo: a.id });
    aplicarDano(e, a, H.estatica.dano, agora, efeitos, alvo, { autor: alvo, tipo: 'estatica' });
  }
  // Duplicata (Espelho)
  if (alvo.personagem === 'espelho' && alvo.vida > 0 && e.aleatorio() < H.duplicata.chance) {
    e.entidades.push({ tipo: 'clone', id: e.proximaEntidade++, dono: alvo.id, personagem: alvo.personagem, x: alvo.x + 18, y: alvo.y, dx: 0, dy: 0, ate: agora + H.duplicata.segDuracao * 1000, parado: true });
  }
  // Fuga (Ilusionista)
  if (alvo.personagem === 'ilusionista' && !alvo.fugaUsada && alvo.vida > 0 && alvo.vida < H.fuga.limiteVida) {
    alvo.fugaUsada = true;
    alvo.invisivelAte = agora + H.fuga.segDuracao * 1000;
  }

  if (alvo.vida <= 0) morrer(e, alvo, a, agora, efeitos);
  return v;
}

/** Lento ou preso (para o Rastreador do Caçador). */
function estaLento(e: EstadoJogo, l: Lutador, agora: number): boolean {
  return (
    l.chocadoAte > agora ||
    l.presoAte > agora ||
    l.congeladoAte > agora ||
    (l.frio.ate > agora && l.frio.camadas > 0) ||
    e.pocas.some((p) => p.dono !== l.id && Math.hypot(l.x - p.x, l.y - p.y) <= p.r)
  );
}

function curar(l: Lutador, quanto: number, efeitos: Efeito[]): void {
  const antes = l.vida;
  l.vida = Math.min(vidaMaxima(l.personagem), l.vida + Math.round(quanto));
  if (l.vida > antes) efeitos.push({ tipo: 'cura', alvo: l.id, valor: l.vida - antes });
}

function morrer(e: EstadoJogo, alvo: Lutador, autor: Lutador | undefined, agora: number, efeitos: Efeito[]): void {
  alvo.vivo = false;
  alvo.temSupernova = false;
  alvo.supernovaAte = 0;
  alvo.dots = [];
  alvo.fila = [];
  efeitos.push({ tipo: 'morte', alvo: alvo.id, ...(autor && autor.id !== alvo.id ? { por: autor.id } : {}) });
  e.entidades = e.entidades.filter((x) => !(x.tipo === 'drone' && x.dono === alvo.id));
  if (autor && autor.id !== alvo.id && autor.vivo) {
    if (autor.personagem === 'vampiro') curar(autor, H.sede.cura, efeitos);
    if (autor.personagem === 'domador') autor.recargaAtivaAte -= H.companheiro.reducaoSeg * 1000;
    if (autor.personagem === 'astro') autor.recargaAtivaAte = agora;
  }
  if (renasce(e)) {
    if (!alvo.fora) alvo.renascerEm = agora + (MODOS_TROCA.includes(e.modo) ? 3000 : 2000);
    if (ehPintao(e.modo)) apagarPintura(e, alvo);
    if (autor && autor.id !== alvo.id && !aliados(autor, alvo) && !ehBandeira(e.modo) && !ehPintao(e.modo)) {
      autor.pontos++;
      if (autor.equipe !== null) {
        e.pontosEquipe[autor.equipe]!++;
        if (e.pontosEquipe[autor.equipe]! >= e.meta) e.fim = { vencedorId: null, equipe: autor.equipe };
      } else if (autor.pontos >= e.meta) e.fim = { vencedorId: autor.id };
      else if (e.modo === 'corrida') transformar(e, autor, proximoPersonagem(autor.personagem), agora);
    }
  }
  // Explosão final (Granadeiro)
  if (alvo.personagem === 'granadeiro') {
    const f = H.explosaoFinal;
    explosaoEm(e, alvo.x, alvo.y, f.raio, f.dano, f.dano, alvo, PERSONAGENS.granadeiro.cor, agora, efeitos);
  }
  if (!renasce(e)) vencedorSe(e);
  else if (!e.fim) fimPorAbandono(e);
}

/** Modos com renascimento (abates, corrida, equipes). */
export const renasce = (e: EstadoJogo) => e.modo !== 'royale' && e.modo !== 'neoncalypse';

/** Acaba quando sobra 1 jogador (ou 1 equipe) na partida. */
function fimPorAbandono(e: EstadoJogo): void {
  const ativos = [...e.lutadores.values()].filter((l) => !l.fora);
  if (MODOS_EQUIPE.includes(e.modo)) {
    const equipes = new Set(ativos.map((l) => l.equipe));
    if (equipes.size <= 1) e.fim = { vencedorId: null, ...(ativos[0] ? { equipe: ativos[0].equipe! } : {}) };
  } else if (ativos.length <= 1) e.fim = { vencedorId: ativos[0]?.id ?? null };
}

/** Mata-mata em equipe: trocar de personagem enquanto espera para renascer. */
export function trocarPersonagemAoRenascer(e: EstadoJogo, l: Lutador, novo: IdPersonagem): boolean {
  if (!MODOS_TROCA.includes(e.modo) || l.vivo || l.fora) return false;
  transformar(e, l, novo, Date.now());
  return true;
}

/** Corrida armada: o próximo personagem da lista (dá a volta). */
export function proximoPersonagem(atual: IdPersonagem): IdPersonagem {
  return IDS_PERSONAGENS[(IDS_PERSONAGENS.indexOf(atual) + 1) % IDS_PERSONAGENS.length]!;
}

/** Troca o personagem no meio da partida (corrida armada). A vida fica, até o máximo do novo. */
export function transformar(e: EstadoJogo, l: Lutador, novo: IdPersonagem, agora: number): void {
  l.personagem = novo;
  l.vida = Math.min(l.vida, vidaMaxima(novo));
  l.recargaAtaqueAte = 0;
  l.recargaAtivaAte = 0;
  l.preparada = false;
  l.escudoAte = 0;
  l.invisivelAte = 0;
  l.emboscada = false;
  l.laserAte = 0;
  l.furiaAte = 0;
  l.refletindoAte = 0;
  l.cancaoAte = 0;
  l.sobrecargaAte = 0;
  l.foco = null;
  l.refrao = 0;
  l.historico = [];
  if (l.voandoAte > agora) {
    l.voandoAte = 0;
    const p = pontoLivrePerto(e.mapa, l.x, l.y, passagemDe(novo, false));
    l.x = p.x;
    l.y = p.y;
  }
  e.entidades = e.entidades.filter((x) => !((x.tipo === 'drone' || x.tipo === 'clone') && x.dono === l.id));
}

/** Renascimento (modos abates e corrida): no próprio nascimento, com vida cheia e sem efeitos. */
function renascer(e: EstadoJogo, l: Lutador, agora: number, efeitos: Efeito[]): void {
  const n = e.mapa.nascimentos[l.vaga % e.mapa.nascimentos.length]!;
  Object.assign(l, {
    x: n.x,
    y: n.y,
    vida: vidaMaxima(l.personagem),
    vivo: true,
    fila: [],
    dots: [],
    renascerEm: 0,
    areaDesde: null,
    areaSuspensa: false,
    frio: { camadas: 0, ate: 0 },
    congeladoAte: 0,
    presoAte: 0,
    silenciadoAte: 0,
    chocadoAte: 0,
    marcadoAte: 0,
    voandoAte: 0,
    invisivelAte: 0,
  });
  efeitos.push({ tipo: 'anel', x: n.x, y: n.y, raio: 30, cor: PERSONAGENS[l.personagem].cor, ms: 400 });
}

/** Muros que quebram: dano em quem está no ponto (ou dentro do raio da explosão). */
function danoEmMuro(e: EstadoJogo, x: number, y: number, raio: number, dano: number, efeitos: Efeito[]): void {
  if (!e.muros.length) return;
  for (const m of e.muros) {
    const px = Math.max(m.ret.x, Math.min(x, m.ret.x + m.ret.w));
    const py = Math.max(m.ret.y, Math.min(y, m.ret.y + m.ret.h));
    if (Math.hypot(px - x, py - y) > raio + 2) continue;
    m.vida -= dano;
    if (m.vida <= 0) efeitos.push({ tipo: 'explosao', x: m.ret.x + m.ret.w / 2, y: m.ret.y + m.ret.h / 2, raio: Math.max(m.ret.w, m.ret.h) / 2, cor: '#8a97b0' });
  }
  e.muros = e.muros.filter((m) => m.vida > 0);
}

/** Paredes do momento: do Engenheiro, as dinâmicas fechadas e os muros que ainda não quebraram. */
function atualizarParedes(e: EstadoJogo, agora: number): void {
  const t = Math.max(0, (agora - e.inicio) / 1000);
  const fechadas = e.mapa.dinamicas.filter((d) => (t + d.fase) % d.periodo < d.fechado).map((d) => d.ret);
  const doEngenheiro = e.entidades.filter((x): x is Extract<Entidade, { tipo: 'parede' }> => x.tipo === 'parede').map((x) => x.ret);
  e.mapa.paredesTemp = [...doEngenheiro, ...fechadas, ...e.muros.map((m) => m.ret)];
}

/** Explosão em área: obstáculos protegem; o autor não se fere. */
function explosaoEm(
  e: EstadoJogo,
  x: number,
  y: number,
  raio: number,
  danoCentro: number,
  danoBorda: number,
  autor: Lutador | undefined,
  cor: string,
  agora: number,
  efeitos: Efeito[],
  mult = 1,
): void {
  efeitos.push({ tipo: 'explosao', x, y, raio, cor });
  danoEmMuro(e, x, y, raio, danoCentro * mult, efeitos);
  for (const o of e.lutadores.values()) {
    if (o.id === autor?.id || !o.vivo || aliados(o, autor)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d > raio + R || !linhaLivre(e.mapa, x, y, o.x, o.y)) continue;
    const f = Math.min(1, Math.max(0, (d - R) / raio));
    aplicarDano(e, o, (danoCentro + (danoBorda - danoCentro) * f) * mult, agora, efeitos, { x, y }, { autor, tipo: 'area' });
  }
}

function aplicarDot(alvo: Lutador, tipo: Dot['tipo'], q: { dano: number; tiques: number }, de: string, agora: number): void {
  if (alvo.personagem === 'veneno') return; // Antídoto
  alvo.dots = alvo.dots.filter((d) => d.tipo !== tipo);
  alvo.dots.push({ tipo, dano: q.dano, tiques: q.tiques, proximo: agora + CONFIG.queimadura.segIntervalo * 1000, de });
}

function aplicarFrio(alvo: Lutador, camadas: number, agora: number): void {
  const f = alvo.frio.ate > agora ? alvo.frio.camadas : 0;
  alvo.frio = { camadas: Math.min(H.frio.maxCamadas, f + camadas), ate: agora + H.frio.segDuracao * 1000 };
}

/** Estática (Lucas) e Pele fria (Gelo): reações a golpes corpo a corpo. */
function reacaoCorpo(e: EstadoJogo, alvo: Lutador, atacante: Lutador, agora: number, efeitos: Efeito[]): void {
  if (!atacante.vivo) return;
  if (alvo.personagem === 'gelo') aplicarFrio(atacante, H.peleFria.camadas, agora);
}

// ------------------------------------------------------------------ ataques

function normalizar(dx: number, dy: number, padrao: { x: number; y: number }): { x: number; y: number } {
  const m = Math.hypot(dx, dy);
  return m > 0.1 ? { x: dx / m, y: dy / m } : padrao;
}

function inimigos(e: EstadoJogo, l: Lutador): Lutador[] {
  return [...e.lutadores.values()].filter((o) => o.id !== l.id && o.vivo && !aliados(o, l));
}

function novoProjetil(e: EstadoJogo, dono: Lutador, dir: { x: number; y: number }, base: Partial<Projetil> & { dano: number; vel: number; alcance: number; estilo: EstiloProjetil }): Projetil {
  const pr: Projetil = {
    id: e.proximoProjetil++,
    dono: dono.id,
    x: dono.x + dir.x * (R + 4),
    y: dono.y + dir.y * (R + 4),
    dx: dir.x,
    dy: dir.y,
    restante: base.alcance,
    mult: 1,
    inicio: 0,
    preparada: false,
    tinta: false,
    agua: false,
    atravessa: false,
    atingidos: new Set(),
    bumerangue: null,
    arco: null,
    explosao: null,
    ...base,
  };
  e.projeteis.push(pr);
  return pr;
}

/** Ataque com a arma, na direção da mira (sem mira automática). `carga` = 0–1 (Atirador). */
export function atacar(e: EstadoJogo, l: Lutador, dx: number, dy: number, agora: number, efeitos: Efeito[], carga = 0): boolean {
  if (e.fim || !l.vivo || !comecou(e, agora) || agora < l.recargaAtaqueAte || l.congeladoAte > agora) return false;
  // atacar de dentro da própria área desliga a proteção (a área não vira posição de tiro segura)
  if (l.areaDesde !== null) l.areaSuspensa = true;
  const p = PERSONAGENS[l.personagem];
  const dir = normalizar(dx, dy, l.mira);
  l.mira = dir;
  const prontoDesde = l.recargaAtaqueAte;
  l.recargaAtaqueAte = agora + p.arma.recarga * 1000 * fatorRecargaAtaque(l, agora) * (neon(e) ? NEON.recarga : 1) * fatorSupernova(e, l, agora);

  // atacar revela (inclusive dentro de moita); a primeira ação depois de ficar invisível é uma emboscada
  l.reveladoAte = agora + MOITA.segRevelado * 1000;
  let mult = multForca(l, agora);
  if (l.invisivelAte > agora) l.invisivelAte = 0;
  if (l.emboscada) {
    l.emboscada = false;
    mult *= 1 + H.invisivel.bonusEmboscada;
  }

  if (p.arma.instantaneo) {
    feixe(e, l, dir, p.arma.alcance, p.arma.dano * mult, agora, efeitos);
    return true;
  }

  if (p.arma.tipo === 'projetil') {
    const a = p.arma;
    let alcance = a.alcance;
    if (a.carga) {
      const permitido = Math.min(1, Math.max(0, (agora - prontoDesde) / (a.carga.seg * 1000)));
      const c = Math.min(Math.max(0, carga), permitido);
      mult *= 1 + a.carga.bonus * c;
      alcance *= 1 + a.carga.bonusAlcance * c;
    }
    if (l.personagem === 'atirador' && agora - l.ultimoMovimento >= H.paciencia.segParado * 1000) mult *= 1 + H.paciencia.bonus;
    const n = a.projeteis ?? 1;
    const abre = ((a.leque ?? 0) * Math.PI) / 180;
    const ang0 = Math.atan2(dir.y, dir.x);
    for (let k = 0; k < n; k++) {
      const ang = ang0 + (k - (n - 1) / 2) * abre;
      const d = { x: Math.cos(ang), y: Math.sin(ang) };
      novoProjetil(e, l, d, {
        dano: a.dano,
        vel: a.velocidadeProjetil ?? 500,
        alcance,
        estilo: a.estilo ?? 'bala',
        mult,
        preparada: l.preparada,
        tinta: !!a.tinta,
        agua: !!a.agua,
        atravessa: !!a.atravessa || (l.personagem === 'atirador' && l.laserAte > agora),
        bumerangue: a.bumerangue ? { voltando: false, atingidosVolta: new Set() } : null,
        arco: a.arco ? { x0: l.x, y0: l.y, total: alcance } : null,
        explosao: a.explosao ? { ...a.explosao } : null,
        veneno: a.veneno,
        frio: a.frio,
        rouboVida: a.rouboVida,
        ricochetes: a.ricochete,
        prende: a.prende,
        ...(l.marcaAlvo && l.marcaAlvo.ate > agora && e.lutadores.get(l.marcaAlvo.id)?.vivo
          ? { guiado: l.marcaAlvo.id, mult: mult * H.guiado.fatorDano }
          : {}),
      });
      if (a.arco) {
        // a granada sai do centro do personagem (voa por cima de tudo)
        const pr = e.projeteis[e.projeteis.length - 1]!;
        pr.x = l.x;
        pr.y = l.y;
      }
    }
    l.preparada = false;
    efeitos.push({ tipo: 'disparo', de: l.id, x: l.x, y: l.y });
    return true;
  }

  if (p.arma.tipo === 'aura') {
    const raioAura = p.arma.alcance + R;
    efeitos.push({ tipo: 'pulso', de: l.id, x: l.x, y: l.y, raio: raioAura });
    for (const o of inimigos(e, l)) {
      if (Math.hypot(o.x - l.x, o.y - l.y) > raioAura || !linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
      const feito = aplicarDano(e, o, p.arma.dano * mult, agora, efeitos, l, { autor: l, tipo: 'area' });
      if (feito > 0) o.chocadoAte = agora + H.choque.segDuracao * 1000;
    }
    return true;
  }

  // corpo a corpo: arco à frente da mira
  const raio = p.arma.alcance + R;
  const cosArco = Math.cos(((p.arma.arcoGraus ?? 60) * Math.PI) / 180);
  efeitos.push({ tipo: 'golpe', de: l.id, x: l.x, y: l.y, dx: dir.x, dy: dir.y, raio, arco: p.arma.arcoGraus ?? 60 });
  for (const o of inimigos(e, l)) {
    const vx = o.x - l.x;
    const vy = o.y - l.y;
    const d = Math.hypot(vx, vy);
    if (d > raio) continue;
    if (d > R * 2 && (vx * dir.x + vy * dir.y) / d < cosArco) continue;
    if (!linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
    const feito = aplicarDano(e, o, p.arma.dano * mult, agora, efeitos, l, { autor: l, tipo: 'corpo' });
    if (feito > 0 && p.arma.queimadura) aplicarDot(o, 'fogo', p.arma.queimadura, l.id, agora);
    if (feito > 0) reacaoCorpo(e, o, l, agora, efeitos);
  }
  // golpes corpo a corpo também desfazem clones
  e.entidades = e.entidades.filter((x) => !(x.tipo === 'clone' && x.dono !== l.id && Math.hypot(x.x - l.x, x.y - l.y) <= raio));
  return true;
}

/** Supernova ativa: recargas pela metade (no Neoncalypse, 25% menores, para não virar 4×). */
function fatorSupernova(e: EstadoJogo, l: Lutador, agora: number): number {
  return l.supernovaAte > agora ? (neon(e) ? SUPERNOVA.recargaNeon : SUPERNOVA.recarga) : 1;
}

/** Ativa a Supernova guardada: 5 s com tudo mais forte. Depois o botão some. */
export function ativarSupernova(e: EstadoJogo, l: Lutador, agora: number, efeitos: Efeito[]): boolean {
  if (!l.vivo || !l.temSupernova || e.fim) return false;
  l.temSupernova = false;
  l.supernovaAte = agora + SUPERNOVA.segDuracao * 1000;
  efeitos.push({ tipo: 'supernova', acao: 'ativou', x: l.x, y: l.y, de: l.id });
  return true;
}

/** Sorteia um lugar livre para a Supernova: chão comum, fora das áreas seguras e longe das bordas. */
function lugarSupernova(e: EstadoJogo): { x: number; y: number } | null {
  const m = e.mapa;
  for (let k = 0; k < 80; k++) {
    const x = 160 + e.aleatorio() * (m.largura - 320);
    const y = 160 + e.aleatorio() * (m.altura - 320);
    if (bloco(m, Math.floor(x / BLOCO), Math.floor(y / BLOCO)) !== 0) continue;
    if (!posicaoLivre(m, x, y, 24)) continue;
    if (m.areas.some((a) => Math.hypot(a.x - x, a.y - y) < a.raio + 40)) continue;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}

/** Fúria, Canção e Sobrecarga encurtam a recarga do ataque. */
export function fatorRecargaAtaque(l: Lutador, agora: number): number {
  let f = 1;
  if (l.furiaAte > agora) f *= H.furia.fatorRecarga;
  if (l.cancaoAte > agora) f /= H.cancao.fator;
  if (l.sobrecargaAte > agora) f *= H.sobrecarga.fatorRecarga;
  return f;
}

/** Feixe (Laserista): tiro instantâneo em linha reta, para no primeiro obstáculo ou inimigo. */
function feixe(e: EstadoJogo, l: Lutador, dir: { x: number; y: number }, alcance: number, dano: number, agora: number, efeitos: Efeito[]): void {
  let x = l.x;
  let y = l.y;
  for (let d = R; d <= alcance; d += 4) {
    const nx = l.x + dir.x * d;
    const ny = l.y + dir.y * d;
    if (bloqueiaTiro(e.mapa, nx, ny)) break;
    x = nx;
    y = ny;
    const clone = e.entidades.find((c) => c.tipo === 'clone' && c.dono !== l.id && Math.hypot(c.x - nx, c.y - ny) <= R + 10);
    if (clone) {
      e.entidades = e.entidades.filter((c) => c !== clone);
      break;
    }
    const alvo = [...e.lutadores.values()].find((o) => o.id !== l.id && o.vivo && !aliados(o, l) && Math.hypot(o.x - nx, o.y - ny) <= R + 10);
    if (alvo) {
      // Foco: acertos seguidos no mesmo alvo causam +1 cada
      l.foco = l.foco?.alvo === alvo.id ? { alvo: alvo.id, n: Math.min(H.foco.maximo, l.foco.n + 1) } : { alvo: alvo.id, n: 0 };
      aplicarDano(e, alvo, dano + l.foco.n, agora, efeitos, l, { autor: l, tipo: 'projetil' });
      break;
    }
  }
  efeitos.push({ tipo: 'linha', x0: l.x, y0: l.y, x1: x, y1: y, cor: PERSONAGENS[l.personagem].cor, largura: 8 });
}

/** Avanço em linha (Ninja, Tanque): move até `dist` e acerta quem estiver perto do caminho. */
function avancar(e: EstadoJogo, l: Lutador, dir: { x: number; y: number }, dist: number, largura: number, agora: number, efeitos: Efeito[], aoAcertar: (o: Lutador) => void): void {
  const x0 = l.x;
  const y0 = l.y;
  const fim = mover(e.mapa, l.x, l.y, dir.x * dist, dir.y * dist, passagemDe(l.personagem, false));
  l.x = fim.x;
  l.y = fim.y;
  efeitos.push({ tipo: 'linha', x0, y0, x1: fim.x, y1: fim.y, cor: PERSONAGENS[l.personagem].cor });
  const vx = fim.x - x0;
  const vy = fim.y - y0;
  const len2 = vx * vx + vy * vy || 1;
  for (const o of inimigos(e, l)) {
    const t = Math.max(0, Math.min(1, ((o.x - x0) * vx + (o.y - y0) * vy) / len2));
    if (Math.hypot(o.x - (x0 + vx * t), o.y - (y0 + vy * t)) <= largura) aoAcertar(o);
  }
}

/** Habilidade ativa de cada personagem. */
export function usarAtiva(e: EstadoJogo, l: Lutador, dx: number, dy: number, agora: number, efeitos: Efeito[]): boolean {
  if (e.fim || !l.vivo || !comecou(e, agora) || agora < l.recargaAtivaAte) return false;
  if (l.silenciadoAte > agora || l.congeladoAte > agora) return false;
  const p = PERSONAGENS[l.personagem];
  const dir = normalizar(dx, dy, l.mira);
  l.recargaAtivaAte = agora + p.ativa.recarga * 1000 * (neon(e) ? NEON.recarga : 1) * fatorSupernova(e, l, agora);
  const cor = p.cor;
  const ataque = () => {
    if (l.areaDesde !== null) l.areaSuspensa = true;
  };
  const pontoAFrente = (dist: number) => ({ x: Math.min(e.mapa.largura - 24, Math.max(24, l.x + dir.x * dist)), y: Math.min(e.mapa.altura - 24, Math.max(24, l.y + dir.y * dist)) });

  switch (l.personagem) {
    case 'veni': {
      const t = H.teletransporte;
      const destino = destinoFuga(e.mapa, l.x, l.y, inimigos(e, l), t.minimo, t.maximo, dir.x, dir.y);
      efeitos.push({ tipo: 'teleporte', de: l.id, x0: l.x, y0: l.y, x1: destino.x, y1: destino.y });
      l.x = destino.x;
      l.y = destino.y;
      l.preparada = true;
      return true;
    }
    case 'gut': {
      ataque();
      const g = H.giro;
      efeitos.push({ tipo: 'giro', de: l.id, x: l.x, y: l.y, raio: g.raio + R });
      for (const o of inimigos(e, l)) {
        const vx = o.x - l.x;
        const vy = o.y - l.y;
        const d = Math.hypot(vx, vy);
        if (d > g.raio + R || !linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
        const feito = aplicarDano(e, o, g.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: 'corpo' });
        if (feito > 0) reacaoCorpo(e, o, l, agora, efeitos);
        if (feito <= 0 || !o.vivo) continue;
        aplicarDot(o, 'fogo', g.queimadura, l.id, agora);
        const n = d > 0.01 ? { x: vx / d, y: vy / d } : dir;
        deslocar(e, o, n.x * g.empurrao, n.y * g.empurrao, agora);
      }
      return true;
    }
    case 'vini': {
      ataque();
      const b = H.balde;
      criarPoca(e, l.id, l.x, l.y, b.raio, b.segDuracao, true, agora);
      efeitos.push({ tipo: 'balde', de: l.id, x: l.x, y: l.y, raio: b.raio });
      for (const o of inimigos(e, l)) {
        const vx = o.x - l.x;
        const vy = o.y - l.y;
        const d = Math.hypot(vx, vy);
        if (d > b.raio + R || d < 0.01) continue;
        deslocar(e, o, (vx / d) * b.empurrao, (vy / d) * b.empurrao, agora);
      }
      return true;
    }
    case 'daniel':
      l.mira = dir;
      l.escudoAte = agora + H.escudo.segDuracao * 1000;
      return true;
    case 'lucas': {
      ataque();
      const o = H.onda;
      e.ondas.push({ dono: l.id, x: l.x, y: l.y, inicio: agora, atingidos: new Set() });
      efeitos.push({ tipo: 'onda', de: l.id, x: l.x, y: l.y, raio: o.raioMax, ms: o.segExpansao * 1000 });
      avancarOndas(e, agora, efeitos);
      return true;
    }
    case 'pacheco':
      l.voandoAte = agora + H.voo.segDuracao * 1000;
      efeitos.push({ tipo: 'voo', de: l.id, x: l.x, y: l.y, pouso: false });
      return true;
    case 'sombra':
      l.invisivelAte = agora + H.invisivel.segDuracao * 1000;
      l.emboscada = true;
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: 30, cor, ms: 300 });
      return true;
    case 'vampiro': {
      const t = H.totem;
      e.entidades.push({ tipo: 'totem', id: e.proximaEntidade++, dono: l.id, x: l.x, y: l.y, r: t.raio, ate: agora + t.segDuracao * 1000, proximo: agora });
      return true;
    }
    case 'engenheiro': {
      const pa = H.parede;
      const c = pontoAFrente(pa.distancia);
      const vertical = Math.abs(dir.x) >= Math.abs(dir.y);
      const w = vertical ? pa.espessura : pa.comprimento;
      const h = vertical ? pa.comprimento : pa.espessura;
      const ret: Retangulo = { x: c.x - w / 2, y: c.y - h / 2, w, h, tipo: 1 };
      e.mapa.paredesTemp.push(ret);
      e.entidades.push({ tipo: 'parede', id: e.proximaEntidade++, dono: l.id, ret, ate: agora + pa.segDuracao * 1000 });
      return true;
    }
    case 'pescador': {
      ataque();
      const g = H.gancho;
      novoProjetil(e, l, dir, { dano: g.dano, vel: g.velocidade, alcance: g.alcance, estilo: 'gancho', gancho: true, mult: multForca(l, agora) });
      return true;
    }
    case 'gravidade': {
      ataque();
      const b = H.buraco;
      const c = pontoAFrente(b.distancia);
      e.entidades.push({ tipo: 'buraco', id: e.proximaEntidade++, dono: l.id, x: c.x, y: c.y, r: b.raio, ate: agora + b.segDuracao * 1000, proximo: agora + 1000 });
      return true;
    }
    case 'ilusionista': {
      // 5 cópias, cada uma numa direção (a primeira na direção da mira)
      const a0 = Math.atan2(dir.y, dir.x);
      for (let k = 0; k < H.clone.quantidade; k++) {
        const a = a0 + (k / H.clone.quantidade) * Math.PI * 2;
        e.entidades.push({ tipo: 'clone', id: e.proximaEntidade++, dono: l.id, personagem: l.personagem, x: l.x, y: l.y, dx: Math.cos(a), dy: Math.sin(a), ate: agora + H.clone.segDuracao * 1000, parado: false });
      }
      return true;
    }
    case 'atirador':
      l.corridaAte = agora + H.corrida.segDuracao * 1000;
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: 26, cor, ms: 250 });
      return true;
    case 'granadeiro': {
      ataque();
      const c = H.chuva;
      const centro = pontoAFrente(c.distancia);
      for (let k = 0; k < c.quantidade; k++) {
        const ang = e.aleatorio() * Math.PI * 2;
        const r = Math.sqrt(e.aleatorio()) * c.espalhamento;
        const alvo = { x: centro.x + Math.cos(ang) * r, y: centro.y + Math.sin(ang) * r };
        const d = Math.hypot(alvo.x - l.x, alvo.y - l.y) || 1;
        const pr = novoProjetil(e, l, { x: (alvo.x - l.x) / d, y: (alvo.y - l.y) / d }, {
          dano: c.dano,
          vel: PERSONAGENS.granadeiro.arma.velocidadeProjetil!,
          alcance: d,
          estilo: 'granada',
          mult: multForca(l, agora),
          arco: { x0: l.x, y0: l.y, total: d },
          explosao: { raio: c.raio, danoBorda: c.dano / 2 },
          inicio: agora + k * c.intervalo * 1000,
        });
        pr.x = l.x;
        pr.y = l.y;
      }
      return true;
    }
    case 'armadilheiro': {
      const minhas = e.entidades.filter((x) => x.tipo === 'mina' && x.dono === l.id);
      if (minhas.length >= H.mina.maximo) e.entidades = e.entidades.filter((x) => x !== minhas[0]);
      e.entidades.push({ tipo: 'mina', id: e.proximaEntidade++, dono: l.id, x: l.x, y: l.y, armadaEm: agora + 500 });
      return true;
    }
    case 'gelo': {
      ataque();
      const g = H.congelar;
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: g.raio, cor, ms: 350 });
      for (const o of inimigos(e, l)) {
        if (Math.hypot(o.x - l.x, o.y - l.y) > g.raio + R || !linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
        const feito = aplicarDano(e, o, g.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: 'area' });
        if (feito > 0) o.congeladoAte = agora + g.segDuracao * 1000;
      }
      return true;
    }
    case 'veneno': {
      ataque();
      const n = H.nuvem;
      const c = pontoAFrente(n.distancia);
      e.entidades.push({ tipo: 'nuvem', id: e.proximaEntidade++, dono: l.id, x: c.x, y: c.y, r: n.raio, ate: agora + n.segDuracao * 1000, proximo: agora + 1000 });
      return true;
    }
    case 'hacker': {
      ataque();
      const pn = H.pane;
      novoProjetil(e, l, dir, { dano: pn.dano, vel: pn.velocidade, alcance: pn.alcance, estilo: 'pulso', pane: true, mult: multForca(l, agora) });
      return true;
    }
    case 'relojoeiro': {
      const alvoT = agora - H.rebobinar.segAtras * 1000;
      const antigo = l.historico.find((h) => h.t >= alvoT) ?? l.historico[0];
      if (!antigo) return true;
      const p0 = pontoLivrePerto(e.mapa, antigo.x, antigo.y, passagemDe(l.personagem, false));
      efeitos.push({ tipo: 'linha', x0: l.x, y0: l.y, x1: p0.x, y1: p0.y, cor });
      l.x = p0.x;
      l.y = p0.y;
      l.vida = Math.max(l.vida, antigo.vida);
      l.dots = [];
      // Eco: pequena onda de choque onde chegou
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: H.eco.raio, cor, ms: 300 });
      for (const o of inimigos(e, l)) {
        if (Math.hypot(o.x - l.x, o.y - l.y) <= H.eco.raio + R && linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) {
          aplicarDano(e, o, H.eco.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: 'area' });
        }
      }
      return true;
    }
    case 'berserker':
      l.furiaAte = agora + H.furia.segDuracao * 1000;
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: 34, cor, ms: 300 });
      return true;
    case 'domador': {
      e.entidades = e.entidades.filter((x) => !(x.tipo === 'drone' && x.dono === l.id));
      e.entidades.push({ tipo: 'drone', id: e.proximaEntidade++, dono: l.id, x: l.x, y: l.y - H.drone.distancia, ate: agora + H.drone.segDuracao * 1000, proximoTiro: agora + 300 });
      return true;
    }
    case 'espelho':
      l.refletindoAte = agora + H.reflexo.segDuracao * 1000;
      return true;
    case 'ninja':
      avancar(e, l, dir, H.avanco.distancia, H.avanco.largura, agora, efeitos, (o) => {
        const feito = aplicarDano(e, o, H.avanco.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: 'corpo' });
        if (feito > 0) reacaoCorpo(e, o, l, agora, efeitos);
      });
      ataque();
      return true;
    case 'tanque':
      ataque();
      avancar(e, l, dir, H.investida.distancia, H.investida.largura, agora, efeitos, (o) => {
        const feito = aplicarDano(e, o, H.investida.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: 'corpo' });
        if (feito > 0 && o.vivo) deslocar(e, o, dir.x * H.investida.empurrao, dir.y * H.investida.empurrao, agora);
      });
      return true;
    case 'medico':
      curar(l, H.kit.cura, efeitos);
      l.dots = [];
      l.frio = { camadas: 0, ate: 0 };
      l.chocadoAte = 0;
      l.presoAte = 0;
      l.congeladoAte = 0;
      l.silenciadoAte = 0;
      l.marcadoAte = 0;
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: 30, cor, ms: 350 });
      return true;
    case 'cacador': {
      ataque();
      const mc = H.marca;
      novoProjetil(e, l, dir, { dano: mc.dano, vel: mc.velocidade, alcance: mc.alcance, estilo: 'boleadeira', marca: true, mult: multForca(l, agora) });
      return true;
    }
    case 'laserista':
      l.sobrecargaAte = agora + H.sobrecarga.segDuracao * 1000;
      return true;
    case 'trocador': {
      const tr = H.troca;
      const alvo = inimigos(e, l)
        .filter((o) => visivelPara(e, o, l, agora) && Math.hypot(o.x - l.x, o.y - l.y) <= tr.alcance)
        .sort((a, b) => Math.hypot(a.x - l.x, a.y - l.y) - Math.hypot(b.x - l.x, b.y - l.y))[0];
      if (!alvo) {
        l.recargaAtivaAte = 0; // ninguém perto: não gasta a habilidade
        return false;
      }
      ataque();
      efeitos.push({ tipo: 'linha', x0: l.x, y0: l.y, x1: alvo.x, y1: alvo.y, cor });
      const feito = aplicarDano(e, alvo, tr.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: 'area' });
      if (feito > 0 && alvo.vivo && alvo.personagem !== 'gravidade') {
        const [px, py] = [l.x, l.y];
        l.x = alvo.x;
        l.y = alvo.y;
        alvo.x = px;
        alvo.y = py;
        alvo.chocadoAte = agora + tr.segDesorientado * 1000;
      }
      return true;
    }
    case 'bardo':
      l.cancaoAte = agora + H.cancao.segDuracao * 1000;
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: 34, cor, ms: 300 });
      return true;
    case 'astro': {
      ataque();
      const mt = H.meteoro;
      const c = pontoAFrente(mt.distancia);
      e.entidades.push({ tipo: 'meteoro', id: e.proximaEntidade++, dono: l.id, x: c.x, y: c.y, r: mt.raio, ate: agora + mt.segAviso * 1000 });
      return true;
    }
  }
  return false;
}

function criarPoca(e: EstadoJogo, dono: string, x: number, y: number, r: number, seg: number, balde: boolean, agora: number): void {
  e.pocas.push({ id: e.proximaPoca++, dono, x, y, r, ate: agora + seg * 1000, balde });
  if (!balde) {
    const doCanhao = e.pocas.filter((p) => p.dono === dono && !p.balde);
    if (doCanhao.length > H.tinta.maxPocas) e.pocas = e.pocas.filter((p) => p !== doCanhao[0]);
  }
}

/** Ondas de choque: o raio cresce com o tempo; cada inimigo é atingido uma vez; obstáculos protegem. */
function avancarOndas(e: EstadoJogo, agora: number, efeitos: Efeito[]): void {
  const o = H.onda;
  const vivas: Onda[] = [];
  for (const w of e.ondas) {
    const raio = Math.min(o.raioMax, (o.raioMax * (agora - w.inicio)) / (o.segExpansao * 1000));
    const dono = e.lutadores.get(w.dono);
    for (const alvo of e.lutadores.values()) {
      if (alvo.id === w.dono || !alvo.vivo || w.atingidos.has(alvo.id) || aliados(alvo, dono)) continue;
      const vx = alvo.x - w.x;
      const vy = alvo.y - w.y;
      const d = Math.hypot(vx, vy);
      if (d > raio + R || !linhaLivre(e.mapa, w.x, w.y, alvo.x, alvo.y)) continue;
      w.atingidos.add(alvo.id);
      const feito = aplicarDano(e, alvo, o.dano * multForca(dono, agora), agora, efeitos, { x: w.x, y: w.y }, { autor: dono, tipo: 'area' });
      if (feito <= 0 || !alvo.vivo) continue;
      const n = d > 0.01 ? { x: vx / d, y: vy / d } : { x: 1, y: 0 };
      deslocar(e, alvo, n.x * o.empurrao, n.y * o.empurrao, agora);
    }
    if (raio < o.raioMax) vivas.push(w);
  }
  e.ondas = vivas;
}

// ------------------------------------------------------------------ projéteis

/** Acerto direto de um projétil (sem explosão): dano + efeitos do acerto. */
function acertoDireto(e: EstadoJogo, pr: Projetil, alvo: Lutador, agora: number, efeitos: Efeito[]): void {
  const dono = e.lutadores.get(pr.dono);
  const origem = { x: pr.x - pr.dx * 20, y: pr.y - pr.dy * 20 };
  let mult = pr.mult;
  // Refrão (Bardo): a cada 4 acertos, o dobro
  if (dono?.personagem === 'bardo' && pr.estilo === 'nota') {
    dono.refrao++;
    if (dono.refrao % H.refrao.cada === 0) mult *= 2;
  }
  const feito = aplicarDano(e, alvo, pr.dano * mult, agora, efeitos, origem, { autor: dono, tipo: 'projetil', rouboVida: pr.rouboVida });
  if (feito <= 0) return;
  if (pr.prende) alvo.presoAte = agora + pr.prende * 1000;
  if (pr.marca) {
    alvo.marcadoAte = agora + H.marca.segDuracao * 1000;
    if (dono) dono.marcaAlvo = { id: alvo.id, ate: alvo.marcadoAte };
  }
  if (pr.troca && dono && dono.vivo && alvo.vivo && alvo.personagem !== 'gravidade') {
    const px = dono.x;
    const py = dono.y;
    efeitos.push({ tipo: 'linha', x0: px, y0: py, x1: alvo.x, y1: alvo.y, cor: PERSONAGENS.trocador.cor });
    dono.x = alvo.x;
    dono.y = alvo.y;
    alvo.x = px;
    alvo.y = py;
    alvo.chocadoAte = agora + H.troca.segDesorientado * 1000;
  }
  if (pr.veneno) aplicarDot(alvo, 'veneno', pr.veneno, pr.dono, agora);
  if (pr.frio) aplicarFrio(alvo, 1, agora);
}

function impacto(e: EstadoJogo, pr: Projetil, x: number, y: number, alvo: Lutador | null, agora: number, efeitos: Efeito[]): void {
  const dono = e.lutadores.get(pr.dono);
  // Pintão: os tiros pintam onde caem (explosões pintam a área toda)
  if (e.pintura && dono) pintar(e, dono, x, y, pr.explosao ? Math.max(PINTAO.raioImpacto, pr.explosao.raio) : PINTAO.raioImpacto);
  if (pr.explosao) {
    // Flecha preparada (Veni): mais dano e explosão maior
    const fp = H.flechaPreparada;
    const raio = pr.explosao.raio * (pr.preparada ? 1 + fp.bonusRaio : 1);
    const mult = pr.mult * (pr.preparada ? 1 + fp.bonusDano : 1);
    explosaoEm(e, x, y, raio, pr.dano, pr.explosao.danoBorda, dono, dono ? PERSONAGENS[dono.personagem].cor : '#ffffff', agora, efeitos, mult);
    return;
  }
  if (pr.tinta) {
    if (alvo) acertoDireto(e, pr, alvo, agora, efeitos);
    const t = H.tinta;
    criarPoca(e, pr.dono, x, y, t.raio, t.segDuracao, false, agora);
    efeitos.push({ tipo: 'respingo', x, y, raio: t.raio });
    return;
  }
  if (!alvo) return;
  if (pr.gancho) {
    acertoDireto(e, pr, alvo, agora, efeitos);
    if (dono && alvo.vivo) {
      // puxa até perto do Pescador (a Massa do Gravidade ignora)
      const vx = dono.x - alvo.x;
      const vy = dono.y - alvo.y;
      const d = Math.hypot(vx, vy);
      const puxar = d - H.gancho.distanciaFinal;
      efeitos.push({ tipo: 'linha', x0: dono.x, y0: dono.y, x1: alvo.x, y1: alvo.y, cor: PERSONAGENS.pescador.cor });
      if (puxar > 0) deslocar(e, alvo, (vx / d) * puxar, (vy / d) * puxar, agora);
    }
    return;
  }
  if (pr.pane) {
    acertoDireto(e, pr, alvo, agora, efeitos);
    alvo.silenciadoAte = agora + H.pane.segDuracao * 1000;
    return;
  }
  acertoDireto(e, pr, alvo, agora, efeitos);
}

function avancarProjeteis(e: EstadoJogo, dt: number, agora: number, efeitos: Efeito[]): void {
  const vivos: Projetil[] = [];
  for (const pr of e.projeteis) {
    if (pr.inicio > agora) {
      vivos.push(pr);
      continue;
    }
    let dist = pr.vel * dt;
    let ativo = true;

    // granadas: voam em arco por cima de tudo e explodem onde caem
    if (pr.arco) {
      const passo = Math.min(dist, pr.restante);
      pr.x += pr.dx * passo;
      pr.y += pr.dy * passo;
      pr.restante -= passo;
      if (pr.restante <= 0.01) impacto(e, pr, pr.x, pr.y, null, agora, efeitos);
      else vivos.push(pr);
      continue;
    }

    while (ativo && dist > 0) {
      const dono = e.lutadores.get(pr.dono);
      // bumerangue voltando: mira no dono e atravessa obstáculos
      if (pr.bumerangue?.voltando) {
        if (!dono || !dono.vivo) {
          ativo = false;
          break;
        }
        const vx = dono.x - pr.x;
        const vy = dono.y - pr.y;
        const d = Math.hypot(vx, vy);
        if (d < 18) {
          ativo = false;
          break;
        }
        pr.dx = vx / d;
        pr.dy = vy / d;
      }
      const passo = Math.min(6, dist);
      // teleguiado: vira aos poucos na direção do alvo marcado
      if (pr.guiado) {
        const g = e.lutadores.get(pr.guiado);
        if (g?.vivo) {
          const vx = g.x - pr.x;
          const vy = g.y - pr.y;
          const d = Math.hypot(vx, vy) || 1;
          const k = Math.min(1, (H.guiado.giroPorSeg * passo) / pr.vel);
          const ndx = pr.dx + (vx / d - pr.dx) * k;
          const ndy = pr.dy + (vy / d - pr.dy) * k;
          const m = Math.hypot(ndx, ndy) || 1;
          pr.dx = ndx / m;
          pr.dy = ndy / m;
        }
      }
      const nx = pr.x + pr.dx * passo;
      const ny = pr.y + pr.dy * passo;
      if (!pr.bumerangue?.voltando && bloqueiaTiro(e.mapa, nx, ny)) {
        if (pr.ricochetes && pr.ricochetes > 0) {
          // quica: inverte o eixo que bateu
          pr.ricochetes--;
          if (bloqueiaTiro(e.mapa, pr.x + pr.dx * passo, pr.y)) pr.dx = -pr.dx;
          else pr.dy = -pr.dy;
          dist -= passo;
          continue;
        }
        if (pr.bumerangue) {
          pr.bumerangue.voltando = true;
          dist -= passo;
          continue;
        }
        danoEmMuro(e, nx, ny, 0, pr.dano * pr.mult, efeitos);
        impacto(e, pr, pr.x, pr.y, null, agora, efeitos);
        ativo = false;
        break;
      }
      // escudo do Daniel
      const escudo = [...e.lutadores.values()].find(
        (o) => o.id !== pr.dono && o.vivo && !aliados(o, dono) && Math.hypot(o.x - nx, o.y - ny) <= H.escudo.raio && escudoCobre(o, nx, ny, agora),
      );
      if (escudo) {
        efeitos.push({ tipo: 'defesa', alvo: escudo.id, x: nx, y: ny });
        ativo = false;
        break;
      }
      // reflexo do Espelho: o projétil volta e passa a ser dele
      const espelho = [...e.lutadores.values()].find(
        (o) => o.id !== pr.dono && o.vivo && !aliados(o, dono) && o.refletindoAte > agora && Math.hypot(o.x - nx, o.y - ny) <= R + 4,
      );
      if (espelho && !pr.gancho) {
        pr.dono = espelho.id;
        pr.dx = -pr.dx;
        pr.dy = -pr.dy;
        pr.restante = pr.alcance;
        pr.atingidos = new Set();
        pr.bumerangue = null;
        efeitos.push({ tipo: 'anel', x: nx, y: ny, raio: 16, cor: PERSONAGENS.espelho.cor, ms: 200 });
        dist -= passo;
        continue;
      }
      // clones e reflexos: o projétil some neles
      const clone = e.entidades.find((x) => x.tipo === 'clone' && x.dono !== pr.dono && !aliados(e.lutadores.get(x.dono), dono) && Math.hypot(x.x - nx, x.y - ny) <= R + 3);
      if (clone) {
        e.entidades = e.entidades.filter((x) => x !== clone);
        efeitos.push({ tipo: 'anel', x: nx, y: ny, raio: 18, cor: '#c9d2e0', ms: 220 });
        ativo = false;
        break;
      }
      pr.x = nx;
      pr.y = ny;
      pr.restante -= passo;
      dist -= passo;
      const jaAcertados = pr.bumerangue?.voltando ? pr.bumerangue.atingidosVolta : pr.atingidos;
      const podeAcertar = (o: Lutador) => o.id !== pr.dono && o.vivo && !aliados(o, dono) && !jaAcertados.has(o.id) && Math.hypot(o.x - nx, o.y - ny) <= R + 3;
      const alvo = [...e.lutadores.values()].find((o) => podeAcertar(o) && o.voandoAte <= agora) ?? [...e.lutadores.values()].find((o) => podeAcertar(o) && o.voandoAte > agora);
      if (alvo) {
        if (pr.atravessa || pr.bumerangue) {
          jaAcertados.add(alvo.id);
          acertoDireto(e, pr, alvo, agora, efeitos);
        } else {
          impacto(e, pr, pr.x, pr.y, alvo, agora, efeitos);
          ativo = false;
          break;
        }
      }
      if (pr.restante <= 0) {
        if (pr.bumerangue && !pr.bumerangue.voltando) {
          pr.bumerangue.voltando = true;
          pr.restante = pr.alcance * 3;
          continue;
        }
        impacto(e, pr, pr.x, pr.y, null, agora, efeitos);
        ativo = false;
      }
    }
    if (ativo) vivos.push(pr);
  }
  e.projeteis = vivos;
}

// ------------------------------------------------------------------ entidades

function avancarEntidades(e: EstadoJogo, dt: number, agora: number, efeitos: Efeito[]): void {
  const ficam: Entidade[] = [];
  for (const x of e.entidades) {
    const dono = e.lutadores.get(x.dono);
    if (x.tipo !== 'mina' && 'ate' in x && x.ate <= agora) {
      if (x.tipo === 'parede') e.mapa.paredesTemp = e.mapa.paredesTemp.filter((p) => p !== x.ret);
      if (x.tipo === 'meteoro') {
        const mt = H.meteoro;
        explosaoEm(e, x.x, x.y, mt.raio, mt.dano, mt.danoBorda, dono, PERSONAGENS.astro.cor, agora, efeitos, multForca(dono, agora));
      }
      continue;
    }
    switch (x.tipo) {
      case 'mina': {
        if (agora < x.armadaEm) break;
        const vitima = [...e.lutadores.values()].find((o) => o.id !== x.dono && o.vivo && !aliados(o, dono) && o.voandoAte <= agora && Math.hypot(o.x - x.x, o.y - x.y) <= H.mina.raioGatilho + R);
        if (vitima) {
          efeitos.push({ tipo: 'anel', x: x.x, y: x.y, raio: 30, cor: PERSONAGENS.armadilheiro.cor, ms: 300 });
          aplicarDano(e, vitima, H.mina.dano * multForca(dono, agora), agora, efeitos, { x: x.x, y: x.y }, { autor: dono, tipo: 'area' });
          vitima.presoAte = agora + H.mina.segPreso * 1000;
          continue; // a mina some
        }
        break;
      }
      case 'drone': {
        if (!dono || !dono.vivo) continue;
        const ang = agora / 400;
        x.x = dono.x + Math.cos(ang) * H.drone.distancia;
        x.y = dono.y + Math.sin(ang) * H.drone.distancia;
        if (agora >= x.proximoTiro) {
          const alvo = inimigos(e, dono)
            .filter((o) => visivelPara(e, o, dono, agora) && Math.hypot(o.x - x.x, o.y - x.y) <= H.drone.alcance && linhaLivre(e.mapa, x.x, x.y, o.x, o.y))
            .sort((a, b) => Math.hypot(a.x - x.x, a.y - x.y) - Math.hypot(b.x - x.x, b.y - x.y))[0];
          if (alvo) {
            const d = Math.hypot(alvo.x - x.x, alvo.y - x.y) || 1;
            const pr = novoProjetil(e, dono, { x: (alvo.x - x.x) / d, y: (alvo.y - x.y) / d }, {
              dano: H.drone.dano,
              vel: H.drone.velocidade,
              alcance: H.drone.alcance + 20,
              estilo: 'bala',
              mult: multForca(dono, agora),
              drone: true,
            });
            pr.x = x.x;
            pr.y = x.y;
            x.proximoTiro = agora + H.drone.intervalo * 1000;
          }
        }
        break;
      }
      case 'clone': {
        if (!x.parado) {
          const p = PERSONAGENS[x.personagem];
          const v = CONFIG.movimento.velocidadeBase * p.velocidade * dt;
          const novo = mover(e.mapa, x.x, x.y, x.dx * v, x.dy * v);
          x.x = novo.x;
          x.y = novo.y;
        }
        break;
      }
      case 'totem':
        if (agora >= x.proximo) {
          x.proximo = agora + 1000;
          if (dono?.vivo && Math.hypot(dono.x - x.x, dono.y - x.y) <= x.r) curar(dono, H.totem.curaPorSeg, efeitos);
        }
        break;
      case 'nuvem':
        if (agora >= x.proximo) {
          x.proximo = agora + 1000;
          for (const o of e.lutadores.values()) {
            if (o.id === x.dono || !o.vivo || aliados(o, dono) || Math.hypot(o.x - x.x, o.y - x.y) > x.r + R) continue;
            aplicarDano(e, o, H.nuvem.danoPorSeg, agora, efeitos, undefined, { autor: dono, tipo: 'area' });
          }
        }
        break;
      case 'buraco': {
        const b = H.buraco;
        for (const o of e.lutadores.values()) {
          if (o.id === x.dono || !o.vivo || aliados(o, dono)) continue;
          const vx = x.x - o.x;
          const vy = x.y - o.y;
          const d = Math.hypot(vx, vy);
          if (d > x.r || d < 4) continue;
          const passo = Math.min(d - 4, b.puxaoPorSeg * dt);
          deslocar(e, o, (vx / d) * passo, (vy / d) * passo, agora);
        }
        if (agora >= x.proximo) {
          x.proximo = agora + 1000;
          for (const o of e.lutadores.values()) {
            if (o.id === x.dono || !o.vivo || aliados(o, dono) || Math.hypot(o.x - x.x, o.y - x.y) > x.r) continue;
            aplicarDano(e, o, b.danoPorSeg, agora, efeitos, { x: x.x, y: x.y }, { autor: dono, tipo: 'area' });
          }
        }
        break;
      }
      case 'parede':
      case 'meteoro':
        break;
    }
    ficam.push(x);
  }
  e.entidades = ficam;
}

// ------------------------------------------------------------------ tique

/** Avança a partida até `agora`. */
export function tick(e: EstadoJogo, agora: number, efeitos: Efeito[]): void {
  const dt = Math.min(0.1, Math.max(0, (agora - e.ultimoTick) / 1000));
  e.ultimoTick = agora;
  if (e.fim) return;
  const jogando = comecou(e, agora);
  if (e.mapa.dinamicas.length || e.muros.length || e.mapa.paredesTemp.length) atualizarParedes(e, agora);

  for (const l of e.lutadores.values()) {
    if (!l.vivo) {
      if (renasce(e) && !l.fora && l.renascerEm && agora >= l.renascerEm) renascer(e, l, agora, efeitos);
      continue;
    }
    // Neoncalypse: fora da zona leva dano a cada segundo (mais forte a cada etapa)
    if (neon(e) && jogando && agora >= e.proximoDanoZona && Math.hypot(l.x - e.mapa.largura / 2, l.y - e.mapa.altura / 2) > raioZona(e, agora)) {
      const etapa = Math.floor(Math.max(0, (agora - e.inicio) / 1000 - CONFIG.partida.segContagem) / 30);
      aplicarDano(e, l, 3 + 2 * etapa, agora, efeitos, undefined, { tipo: 'area' });
      if (e.fim) return;
      if (!l.vivo) continue;
    }
    let n = 0;
    while (l.fila.length && n < CONFIG.movimento.maxComandosPorTick) {
      const c = l.fila.shift()!;
      n++;
      l.seq = c.seq;
      if (!jogando || l.salto) continue; // no salto do trampolim, o movimento é do salto

      const extra = (neon(e) ? NEON.movimento : 1) * (l.supernovaAte > agora ? SUPERNOVA.movimento : 1) * (l.corridaAte > agora ? H.corrida.fator : 1);
      const novo = aplicarComando(e.mapa, l, c, e.pocas, agora, extra, l.equipe !== null ? idsAliados(e, l) : undefined);
      if (Math.abs(novo.x - l.x) + Math.abs(novo.y - l.y) > 0.01) l.ultimoMovimento = agora;
      l.x = novo.x;
      l.y = novo.y;
      l.vx = novo.vx;
      l.vy = novo.vy;
      l.mx = c.x;
      l.my = c.y;
    }
    if (n === 0) {
      l.mx = 0;
      l.my = 0;
    }
    // Trampolim: durante o salto, a posição segue o arco até o destino
    if (l.salto) {
      const s = l.salto;
      const f = Math.min(1, (agora - s.inicio) / s.dur);
      l.x = s.x0 + (s.x1 - s.x0) * f;
      l.y = s.y0 + (s.y1 - s.y0) * f;
      if (f >= 1) l.salto = null;
    } else if (jogando) {
      // pisou num trampolim
      const tr = e.mapa.trampolins.find((p) => Math.hypot(p.x - l.x, p.y - l.y) <= SALTO.raio);
      if (tr && agora >= l.portalPronto) {
        l.salto = { x0: l.x, y0: l.y, x1: tr.destino.x, y1: tr.destino.y, inicio: agora, dur: SALTO.segDuracao * 1000 };
        l.voandoAte = agora + SALTO.segDuracao * 1000 + 30;
        l.portalPronto = agora + SALTO.segDuracao * 1000 + 600;
        l.vx = 0;
        l.vy = 0;
        efeitos.push({ tipo: 'voo', de: l.id, x: l.x, y: l.y, pouso: false });
      }
      // entrou num portal
      for (const p of e.mapa.portais) {
        if (agora < l.portalPronto) break;
        const [de, para] = Math.hypot(p.a.x - l.x, p.a.y - l.y) <= PORTAL.raio ? [p.a, p.b] : Math.hypot(p.b.x - l.x, p.b.y - l.y) <= PORTAL.raio ? [p.b, p.a] : [null, null];
        if (!de || !para) continue;
        efeitos.push({ tipo: 'linha', x0: de.x, y0: de.y, x1: para.x, y1: para.y, cor: '#c9b8ff' });
        efeitos.push({ tipo: 'anel', x: para.x, y: para.y, raio: 30, cor: '#c9b8ff', ms: 300 });
        l.x = para.x;
        l.y = para.y;
        l.portalPronto = agora + PORTAL.segEspera * 1000;
        break;
      }
      // caiu no abismo: morte na hora (o abate vai para quem acertou nos últimos 3 s)
      if (l.voandoAte <= agora && bloco(e.mapa, Math.floor(l.x / BLOCO), Math.floor(l.y / BLOCO)) === T.ABISMO) {
        const credito = l.ultimoAtacante && l.ultimoAtacante.ate > agora ? e.lutadores.get(l.ultimoAtacante.id) : undefined;
        l.areaDesde = null;
        aplicarDano(e, l, 9999, agora, efeitos, undefined, { autor: credito, tipo: 'lava' });
        if (e.fim) return;
        if (!l.vivo) continue;
      }
    }
    // Daniel: quando o escudo acaba, solta agulhas em todas as direções
    if (l.escudoAte !== 0 && agora >= l.escudoAte) {
      l.escudoAte = 0;
      const ag = H.agulhas;
      for (let k = 0; k < ag.quantidade; k++) {
        const a = (k / ag.quantidade) * Math.PI * 2;
        novoProjetil(e, l, { x: Math.cos(a), y: Math.sin(a) }, { dano: ag.dano, vel: ag.velocidade, alcance: ag.alcance, estilo: 'adaga', mult: multForca(l, agora) });
      }
      efeitos.push({ tipo: 'anel', x: l.x, y: l.y, raio: 30, cor: PERSONAGENS[l.personagem].cor, ms: 300 });
    }
    // Lava: queima quem está em cima (o Pacheco voando passa ileso); o último atacante leva o crédito
    if (jogando && l.voandoAte <= agora && bloco(e.mapa, Math.floor(l.x / BLOCO), Math.floor(l.y / BLOCO)) === 4 && agora >= l.proximaLava) {
      l.proximaLava = agora + 500;
      const credito = l.ultimoAtacante && l.ultimoAtacante.ate > agora ? e.lutadores.get(l.ultimoAtacante.id) : undefined;
      aplicarDano(e, l, (LAVA.danoPorSeg / 2) * (l.personagem === 'pacheco' ? H.lavaPacheco.fator : 1), agora, efeitos, undefined, { autor: credito, tipo: 'lava' });
      if (e.fim) return;
      if (!l.vivo) continue;
    }
    // Supernova: pega quem passar por cima (se ainda não tiver uma)
    if (e.supernova && !l.temSupernova && Math.hypot(l.x - e.supernova.x, l.y - e.supernova.y) <= SUPERNOVA.raioColeta) {
      efeitos.push({ tipo: 'supernova', acao: 'pegou', x: e.supernova.x, y: e.supernova.y, de: l.id });
      l.temSupernova = true;
      e.supernova = null;
      e.proximaSupernova = agora + SUPERNOVA.segIntervalo * 1000;
    }
    // Pintão: o rastro pinta o chão
    if (e.pintura && jogando) pintar(e, l, l.x, l.y, PINTAO.raioRastro);
    // fim do voo: pousa no ponto livre mais próximo
    if (l.voandoAte !== 0 && agora >= l.voandoAte) {
      l.voandoAte = 0;
      const p = pontoLivrePerto(e.mapa, l.x, l.y, passagemDe(l.personagem, false));
      l.x = p.x;
      l.y = p.y;
      efeitos.push({ tipo: 'voo', de: l.id, x: l.x, y: l.y, pouso: true });
    }
    // paredes novas podem prender alguém: empurra para fora
    if (e.mapa.paredesTemp.length && l.voandoAte <= agora && !posicaoLivre(e.mapa, l.x, l.y, R, passagemDe(l.personagem, false))) {
      const p = pontoLivrePerto(e.mapa, l.x, l.y, passagemDe(l.personagem, false));
      l.x = p.x;
      l.y = p.y;
    }
    // área segura: proteção por no máximo N s seguidos
    if (dentroDaArea(e.mapa, l.vaga, l.x, l.y)) l.areaDesde ??= agora;
    else {
      l.areaDesde = null;
      l.areaSuspensa = false;
    }
    if (l.frio.ate <= agora) l.frio.camadas = 0;
    // efeitos contínuos (queimadura, veneno)
    for (const d of [...l.dots]) {
      if (agora < d.proximo) continue;
      d.tiques--;
      d.proximo = agora + CONFIG.queimadura.segIntervalo * 1000;
      if (d.tiques <= 0) l.dots = l.dots.filter((x) => x !== d);
      aplicarDano(e, l, d.dano, agora, efeitos, undefined, { autor: e.lutadores.get(d.de), tipo: 'dot' });
      if (e.fim || !l.vivo) break;
    }
    if (!l.vivo) continue;
    // Regeneração (Médico)
    if (l.personagem === 'medico' && agora - l.ultimoDanoRecebido >= H.regeneracao.segSemDano * 1000 && agora >= l.proximaRegen) {
      l.proximaRegen = agora + 1000;
      if (l.vida < vidaMaxima(l.personagem)) curar(l, H.regeneracao.porSeg, efeitos);
    }
    // histórico (Relojoeiro)
    if (l.personagem === 'relojoeiro') {
      l.historico.push({ t: agora, x: l.x, y: l.y, vida: l.vida });
      const limite = agora - (H.rebobinar.segAtras + 1) * 1000;
      while (l.historico.length && l.historico[0]!.t < limite) l.historico.shift();
    }
    // pickups (o Ímã do Pescador pega de longe)
    const alcancePickup = l.personagem === 'pescador' ? H.ima.raio : CONFIG.pickups.raioColeta + R;
    for (const pk of e.mapa.pickups) {
      if ((e.pickups.get(pk.id) ?? 0) > agora) continue;
      if (Math.hypot(l.x - pk.x, l.y - pk.y) > alcancePickup) continue;
      if (pk.tipo === 'vida') {
        if (l.vida >= vidaMaxima(l.personagem)) continue;
        curar(l, CONFIG.pickups.vida.cura, efeitos);
        e.pickups.set(pk.id, agora + CONFIG.pickups.vida.segReaparecer * 1000);
      } else {
        l.forcaAte = agora + CONFIG.pickups.forca.segDuracao * 1000;
        e.pickups.set(pk.id, agora + CONFIG.pickups.forca.segReaparecer * 1000);
      }
      efeitos.push({ tipo: 'pickup', alvo: l.id, pickup: pk.id, item: pk.tipo });
    }
  }
  if (e.fim) return;
  if (neon(e) && agora >= e.proximoDanoZona) e.proximoDanoZona = agora + 1000;
  if (jogando && !e.supernova && agora >= e.proximaSupernova) {
    e.supernova = lugarSupernova(e);
    e.proximaSupernova = agora + SUPERNOVA.segIntervalo * 1000;
    if (e.supernova) efeitos.push({ tipo: 'supernova', acao: 'surgiu', ...e.supernova });
  }
  if (ehBandeira(e.modo) && jogando) {
    atualizarControle(e, dt, agora, efeitos);
    if (e.fim) return;
  }
  if (e.pintura) {
    const p = e.pintura;
    for (const l of e.lutadores.values()) if (l.equipe === null) l.pontos = p.contagem[l.vaga + 1] ?? 0;
    if (MODOS_EQUIPE.includes(e.modo)) e.pontosEquipe = [p.contagem[1] ?? 0, p.contagem[2] ?? 0];
    if (agora >= p.proximaCompleta) {
      p.enviarCompleta = true;
      p.proximaCompleta = agora + 2000;
    }
    if (agora >= e.fimEm) {
      if (MODOS_EQUIPE.includes(e.modo)) {
        const [a, b] = e.pontosEquipe;
        e.fim = a === b ? { vencedorId: null } : { vencedorId: null, equipe: a > b ? 0 : 1 };
      } else {
        const ord = [...e.lutadores.values()].filter((l) => !l.fora).sort((a, b) => b.pontos - a.pontos);
        e.fim = { vencedorId: ord[0] && (!ord[1] || ord[0].pontos > ord[1].pontos) ? ord[0].id : null };
      }
      return;
    }
  }
  avancarProjeteis(e, dt, agora, efeitos);
  avancarOndas(e, agora, efeitos);
  avancarEntidades(e, dt, agora, efeitos);
  e.pocas = e.pocas.filter((p) => p.ate > agora);
}

/** Abandono: quem sai ou perde o prazo de reconexão é eliminado. */
export function eliminar(e: EstadoJogo, id: string, agora: number, efeitos: Efeito[]): void {
  const l = e.lutadores.get(id);
  if (!l || l.fora) return;
  l.fora = true;
  if (!l.vivo) {
    // já estava morto esperando renascer: só confere se a partida acabou
    if (renasce(e) && !e.fim) fimPorAbandono(e);
    return;
  }
  l.vida = 0;
  morrer(e, l, undefined, agora, efeitos);
}

// ------------------------------------------------------------------ o que cada um vê

/** Invisíveis só aparecem para quem tem Faro por perto, quando pisam em tinta, ou para eles mesmos. */
export function visivelPara(e: EstadoJogo, alvo: Lutador, obs: Lutador | undefined, agora: number): boolean {
  if (!obs || obs.id === alvo.id || alvo.marcadoAte > agora || aliados(obs, alvo)) return true;
  const d = Math.hypot(alvo.x - obs.x, alvo.y - obs.y);
  // escuridão (Apagão): só perto de quem olha ou perto de uma luz
  const esc = e.mapa.escuro;
  if (esc && d > esc.raioVisao && !esc.luzes.some((l) => Math.hypot(alvo.x - l.x, alvo.y - l.y) <= l.r)) return false;
  // moita: quem está dentro só é visto de perto ou se atacou há pouco
  if (alvo.reveladoAte <= agora && d > MOITA.raioVisto && bloco(e.mapa, Math.floor(alvo.x / BLOCO), Math.floor(alvo.y / BLOCO)) === T.MATO) return false;
  if (alvo.invisivelAte <= agora) return true;
  if (e.pocas.some((p) => Math.hypot(alvo.x - p.x, alvo.y - p.y) <= p.r)) return true;
  return obs.personagem === 'armadilheiro' && Math.hypot(alvo.x - obs.x, alvo.y - obs.y) <= H.faro.raio;
}

function estadosDe(l: Lutador, agora: number): string[] {
  const s: string[] = [];
  if (l.invisivelAte > agora) s.push('invisivel');
  if (l.congeladoAte > agora) s.push('congelado');
  if (l.presoAte > agora) s.push('preso');
  if (l.dots.some((d) => d.tipo === 'veneno')) s.push('envenenado');
  if (l.silenciadoAte > agora) s.push('silenciado');
  if (l.furiaAte > agora) s.push('furia');
  if (l.refletindoAte > agora) s.push('refletindo');
  if (l.laserAte > agora) s.push('laser');
  if (l.personagem === 'hacker') s.push('glitch');
  if (l.marcadoAte > agora) s.push('marcado');
  if (l.cancaoAte > agora) s.push('cancao');
  if (l.sobrecargaAte > agora) s.push('sobrecarga');
  if (l.supernovaAte > agora) s.push('supernova');
  if (l.corridaAte > agora) s.push('corrida');
  if (l.salto) s.push('salto');
  if (l.marcaAlvo && l.marcaAlvo.ate > agora) s.push('caçando');
  if (l.temSupernova) s.push('temSupernova');
  if (l.frio.ate > agora && l.frio.camadas > 0) s.push(`frio${l.frio.camadas}`);
  return s;
}

/** Snapshot para um jogador (`paraId`): esconde invisíveis e minas que ele não pode ver. Sem `paraId`, mostra tudo. */
export function snapshot(e: EstadoJogo, agora: number, paraId?: string): Snapshot {
  const obs = paraId ? e.lutadores.get(paraId) : undefined;
  const lutadores: LutadorSnap[] = [];
  for (const l of e.lutadores.values()) {
    if (paraId && !visivelPara(e, l, obs, agora)) continue;
    lutadores.push({
      id: l.id,
      personagem: l.personagem,
      vaga: l.vaga,
      vidaMax: vidaMaxima(l.personagem),
      vx: l.vx,
      vy: l.vy,
      pontos: l.pontos,
      equipe: l.equipe,
      estados: estadosDe(l, agora),
      x: Math.round(l.x * 100) / 100,
      y: Math.round(l.y * 100) / 100,
      mx: l.mx,
      my: l.my,
      ax: Math.round(l.mira.x * 100) / 100,
      ay: Math.round(l.mira.y * 100) / 100,
      seq: l.seq,
      vida: l.vida,
      vivo: l.vivo,
      protegido: protegido(l, agora, neon(e)),
      forca: l.forcaAte > agora,
      queimando: l.dots.some((d) => d.tipo === 'fogo'),
      preparada: l.preparada,
      escudo: Math.max(0, l.escudoAte - agora),
      rapido: l.rapidoAte > agora,
      chocado: l.chocadoAte > agora,
      voando: l.voandoAte > agora,
      recargaAtaque: Math.max(0, l.recargaAtaqueAte - agora),
      recargaAtiva: Math.max(0, l.recargaAtivaAte - agora),
    });
  }
  const entidades: EntidadeSnap[] = [];
  for (const x of e.entidades) {
    if (x.tipo === 'mina') {
      const raioVer = obs?.personagem === 'armadilheiro' ? H.faro.raio : H.mina.raioVisivel;
      if (obs && x.dono !== obs.id && Math.hypot(obs.x - x.x, obs.y - x.y) > raioVer) continue;
      entidades.push({ id: x.id, tipo: 'mina', dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), restante: 0 });
      continue;
    }
    const restante = Math.max(0, x.ate - agora);
    if (x.tipo === 'parede') entidades.push({ id: x.id, tipo: 'parede', dono: x.dono, x: x.ret.x, y: x.ret.y, w: x.ret.w, h: x.ret.h, restante });
    else if (x.tipo === 'clone') {
      const d = e.lutadores.get(x.dono);
      entidades.push({ id: x.id, tipo: 'clone', dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), restante, personagem: x.personagem, ax: d?.mira.x ?? 1, ay: d?.mira.y ?? 0 });
    } else if (x.tipo === 'drone') entidades.push({ id: x.id, tipo: 'drone', dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), restante });
    else entidades.push({ id: x.id, tipo: x.tipo, dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), r: x.r, restante });
  }
  // paredes do mapa (prensas, labirinto vivo) e muros que quebram
  const t = Math.max(0, (agora - e.inicio) / 1000);
  e.mapa.dinamicas.forEach((d, i) => {
    if ((t + d.fase) % d.periodo < d.fechado)
      entidades.push({ id: -1 - i, tipo: 'parede', dono: '', x: d.ret.x, y: d.ret.y, w: d.ret.w, h: d.ret.h, restante: Math.round((d.fechado - ((t + d.fase) % d.periodo)) * 1000), estilo: 'prensa' });
  });
  for (const m of e.muros) entidades.push({ id: m.id, tipo: 'parede', dono: '', x: m.ret.x, y: m.ret.y, w: m.ret.w, h: m.ret.h, restante: 0, estilo: 'muro', vida: Math.round(m.vida), vidaMax: MURO.vida });
  return {
    t: agora,
    inicio: e.inicio,
    modo: e.modo,
    meta: e.meta,
    supernova: e.supernova,
    ...(MODOS_EQUIPE.includes(e.modo) ? { pontosEquipe: [...e.pontosEquipe] as [number, number], coresEquipe: e.coresEquipe } : {}),
    ...(ehBandeira(e.modo)
      ? { controle: e.controle.map((c) => ({ ...c, progresso: Math.round(c.progresso * 100) / 100 })), tempoRestante: Math.max(0, e.fimEm - agora) }
      : {}),
    ...(e.pintura
      ? {
          tempoRestante: Math.max(0, e.fimEm - agora),
          pintura: {
            colunas: e.pintura.colunas,
            linhas: e.pintura.linhas,
            mudancas: e.pintura.mudancas,
            pintaveis: e.pintura.pintaveis,
            ...(e.pintura.enviarCompleta ? { completa: Buffer.from(e.pintura.dono).toString('base64') } : {}),
          },
        }
      : {}),
    ...(neon(e) ? { zona: { x: e.mapa.largura / 2, y: e.mapa.altura / 2, raio: Math.round(raioZona(e, agora)) } } : {}),
    lutadores,
    projeteis: e.projeteis
      .filter((p) => p.inicio <= agora)
      .map((p) => ({
        id: p.id,
        dono: p.dono,
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: Math.round(p.dx * p.vel),
        vy: Math.round(p.dy * p.vel),
        preparada: p.preparada,
        tinta: p.tinta,
        agua: p.agua,
        estilo: p.estilo,
      })),
    pocas: e.pocas.map((p) => ({ id: p.id, dono: p.dono, x: Math.round(p.x), y: Math.round(p.y), r: p.r, restante: Math.max(0, p.ate - agora) })),
    entidades,
    pickups: e.mapa.pickups.filter((p) => (e.pickups.get(p.id) ?? 0) <= agora).map((p) => p.id),
  };
}
