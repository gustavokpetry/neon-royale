/** Contrato cliente ↔ servidor (Socket.IO). Sem dependências de runtime. */
import type { IdMapa } from './mapa';

/** Modos: battle royale; abates (o primeiro a 10 vence, renasce); corrida armada (cada abate troca de personagem). */
export type ModoJogo = 'royale' | 'abates' | 'corrida' | 'equipes' | 'neoncalypse' | 'bandeira' | 'bandeiraEquipe' | 'pintao' | 'pintaoEquipe';
export const MODOS: readonly ModoJogo[] = ['royale', 'abates', 'corrida', 'equipes', 'neoncalypse', 'bandeira', 'bandeiraEquipe', 'pintao', 'pintaoEquipe'];
/** Modos jogados em 2 equipes. */
export const MODOS_EQUIPE: readonly ModoJogo[] = ['equipes', 'bandeiraEquipe', 'pintaoEquipe'];
/** Modos em que, ao morrer, dá para trocar de personagem antes de renascer. */
export const MODOS_TROCA: readonly ModoJogo[] = ['equipes', 'bandeira', 'bandeiraEquipe', 'pintao', 'pintaoEquipe'];
/** Pintão: tamanho da casa da grade de pintura (px). */
export const CASA_PINTURA = 32;

/** Ponto de controle (Pega Bandeira). `dono` e `capturando`: id do jogador, ou 'e0'/'e1' em equipe. */
export interface PontoControleSnap {
  id: number;
  x: number;
  y: number;
  r: number;
  /** Pontos por segundo para o dono (o do centro vale mais). */
  valor: number;
  dono: string | null;
  capturando: string | null;
  /** 0–1 */
  progresso: number;
  disputado: boolean;
}
/** Paleta das cores de equipe (o líder escolhe). */
export const CORES_EQUIPE = ['#ff3d9a', '#19d3e6', '#ffd21f', '#a6ff2e', '#ff8a00', '#9b5cff', '#f2f6ff', '#ff2e4d'] as const;
import type { EstiloProjetil, IdPersonagem } from './personagens';

export type CodigoErro =
  | 'DADOS_INVALIDOS'
  | 'APELIDO_INVALIDO'
  | 'CODIGO_INVALIDO'
  | 'SALA_CHEIA'
  | 'PARTIDA_INICIADA'
  | 'SESSAO_INVALIDA'
  | 'FORA_DA_SALA'
  | 'NAO_AUTORIZADO'
  | 'PERSONAGEM_OCUPADO'
  | 'NAO_PODE_INICIAR'
  | 'LIMITE_EXCEDIDO';

export interface ErroJogo {
  codigo: CodigoErro;
  mensagem: string;
}
export type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: ErroJogo };

export interface JogadorPublico {
  id: string;
  apelido: string;
  personagem: IdPersonagem | null;
  pronto: boolean;
  conectado: boolean;
  anfitriao: boolean;
  /** Equipe (0 ou 1) nos modos em equipe. */
  equipe: number;
}

export interface SalaPublica {
  codigo: string;
  estado: 'lobby' | 'partida';
  /** Mapa e modo escolhidos pelo anfitrião. */
  mapa: IdMapa;
  modo: ModoJogo;
  /** Cores das 2 equipes. */
  coresEquipe: [string, string];
  /** Os times trocam de lado a cada partida (justo também nos mapas assimétricos). */
  ladosTrocados: boolean;
  jogadores: JogadorPublico[];
  podeIniciar: boolean;
}

export interface Sessao {
  token: string;
  jogadorId: string;
  sala: SalaPublica;
}

export interface LutadorSnap {
  id: string;
  personagem: IdPersonagem;
  /** Vaga (0–5): nascimento e área segura. */
  vaga: number;
  vidaMax: number;
  /** Velocidade atual (o gelo dá inércia; a previsão no aparelho precisa dela). */
  vx: number;
  vy: number;
  /** Abates (modo abates) ou progresso (corrida armada). */
  pontos: number;
  /** Equipe nos modos em equipe (senão null). */
  equipe: number | null;
  /** Estados para desenhar: invisivel, congelado, preso, envenenado, silenciado, furia, refletindo, laser, glitch, frio1..frio5. */
  estados: string[];
  x: number;
  y: number;
  /** Direção do movimento e da mira (para desenhar). */
  mx: number;
  my: number;
  ax: number;
  ay: number;
  /** Último comando de movimento processado (reconciliação). */
  seq: number;
  vida: number;
  vivo: boolean;
  protegido: boolean;
  forca: boolean;
  queimando: boolean;
  preparada: boolean;
  /** ms restantes do escudo frontal (Daniel). */
  escudo: number;
  /** Adrenalina ativa (Daniel): mais rápido. */
  rapido: boolean;
  /** Lento pelo choque do Lucas. */
  chocado: boolean;
  /** Voando (Pacheco): passa por cima de obstáculos. */
  voando: boolean;
  /** ms até poder atacar / usar a habilidade ativa. */
  recargaAtaque: number;
  recargaAtiva: number;
}

export interface ProjetilSnap {
  id: number;
  dono: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  preparada: boolean;
  tinta: boolean;
  agua: boolean;
  estilo: EstiloProjetil;
}

/** Coisas no mapa criadas por habilidades. */
export interface EntidadeSnap {
  id: number;
  tipo: 'parede' | 'mina' | 'drone' | 'clone' | 'totem' | 'nuvem' | 'buraco' | 'meteoro';
  dono: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  /** ms até sumir. */
  restante: number;
  /** Paredes do mapa: prensa/labirinto (abre e fecha) ou muro que quebra (com vida). */
  estilo?: 'prensa' | 'muro';
  vida?: number;
  vidaMax?: number;
  /** Clone: personagem e direção, para desenhar igual ao dono. */
  personagem?: IdPersonagem;
  ax?: number;
  ay?: number;
}

export interface PocaSnap {
  id: number;
  dono: string;
  x: number;
  y: number;
  r: number;
  /** ms até sumir. */
  restante: number;
}

export interface Snapshot {
  t: number;
  inicio: number;
  modo: ModoJogo;
  /** Pontos para vencer (abates: 10; corrida: 1 abate com cada personagem; equipes: 25). */
  meta: number;
  /** Modos em equipe: pontos e cores das duas equipes. */
  pontosEquipe?: [number, number];
  coresEquipe?: [string, string];
  /** Neoncalypse: zona segura que fecha para o centro. */
  zona?: { x: number; y: number; raio: number };
  /** Supernova no chão (uma por vez). */
  supernova?: { x: number; y: number } | null;
  /** Pega Bandeira: pontos de controle e tempo restante (ms). */
  controle?: PontoControleSnap[];
  tempoRestante?: number;
  /**
   * Pintão: casas que mudaram desde o último envio, em pares [índice, lado] (lado 0 = sem tinta;
   * individual: vaga + 1; equipe: equipe + 1). A cada 2 s vem também a grade completa (base64).
   */
  pintura?: { colunas: number; linhas: number; mudancas: number[]; completa?: string; pintaveis: number };
  lutadores: LutadorSnap[];
  projeteis: ProjetilSnap[];
  pocas: PocaSnap[];
  entidades: EntidadeSnap[];
  /** Pickups disponíveis agora. */
  pickups: string[];
}

export type Efeito =
  | { tipo: 'explosao'; x: number; y: number; raio: number; cor: string }
  | { tipo: 'golpe'; de: string; x: number; y: number; dx: number; dy: number; raio: number; arco: number }
  | { tipo: 'giro'; de: string; x: number; y: number; raio: number }
  | { tipo: 'teleporte'; de: string; x0: number; y0: number; x1: number; y1: number }
  | { tipo: 'dano'; alvo: string; valor: number; bloqueado: boolean }
  | { tipo: 'cura'; alvo: string; valor: number }
  | { tipo: 'pickup'; alvo: string; pickup: string; item: 'vida' | 'forca' }
  | { tipo: 'disparo'; de: string; x: number; y: number }
  | { tipo: 'respingo'; x: number; y: number; raio: number }
  | { tipo: 'defesa'; alvo: string; x: number; y: number }
  | { tipo: 'pulso'; de: string; x: number; y: number; raio: number }
  | { tipo: 'onda'; de: string; x: number; y: number; raio: number; ms: number }
  | { tipo: 'estatica'; de: string; alvo: string }
  | { tipo: 'voo'; de: string; x: number; y: number; pouso: boolean }
  | { tipo: 'anel'; x: number; y: number; raio: number; cor: string; ms: number }
  | { tipo: 'linha'; x0: number; y0: number; x1: number; y1: number; cor: string; largura?: number }
  | { tipo: 'supernova'; acao: 'surgiu' | 'pegou' | 'ativou'; x: number; y: number; de?: string }
  | { tipo: 'balde'; de: string; x: number; y: number; raio: number }
  | { tipo: 'morte'; alvo: string; por?: string };

export interface EventosClienteServidor {
  'sala:criar': (p: { apelido: string }, ack: (r: Resposta<Sessao>) => void) => void;
  'sala:entrar': (p: { codigo: string; apelido: string }, ack: (r: Resposta<Sessao>) => void) => void;
  'sala:reconectar': (p: { token: string }, ack: (r: Resposta<Sessao>) => void) => void;
  'sala:sair': (p: Record<string, never>, ack: (r: Resposta<null>) => void) => void;
  /** O anfitrião expulsa um jogador da sala. */
  'sala:expulsar': (p: { jogadorId: string }, ack: (r: Resposta<null>) => void) => void;
  'lobby:personagem': (p: { personagem: IdPersonagem | null }, ack: (r: Resposta<null>) => void) => void;
  'lobby:pronto': (p: { pronto: boolean }, ack: (r: Resposta<null>) => void) => void;
  'lobby:mapa': (p: { mapa: IdMapa }, ack: (r: Resposta<null>) => void) => void;
  'lobby:modo': (p: { modo: ModoJogo }, ack: (r: Resposta<null>) => void) => void;
  'lobby:equipe': (p: { equipe: number }, ack: (r: Resposta<null>) => void) => void;
  'lobby:corEquipe': (p: { cor: string }, ack: (r: Resposta<null>) => void) => void;
  'lobby:iniciar': (p: Record<string, never>, ack: (r: Resposta<null>) => void) => void;
  'jogo:cmd': (p: { seq: number; x: number; y: number }) => void;
  /** `carga` (0–1): quanto o tiro foi carregado (Atirador). */
  'jogo:atacar': (p: { dx: number; dy: number; carga?: number }) => void;
  'jogo:ativa': (p: { dx: number; dy: number }) => void;
  /** Mata-mata em equipe: escolher outro personagem enquanto espera para renascer. */
  'jogo:personagem': (p: { personagem: IdPersonagem }) => void;
  /** Ativa a Supernova guardada. */
  'jogo:supernova': () => void;
  /** Direção da mira (para o escudo frontal e para os outros verem para onde você aponta). */
  'jogo:mira': (p: { dx: number; dy: number }) => void;
  ping: (t: number, ack: (t: number) => void) => void;
}

export interface EventosServidorCliente {
  'sala:estado': (s: SalaPublica) => void;
  'sala:encerrada': (p: { motivo: string }) => void;
  'jogo:snapshot': (s: Snapshot) => void;
  'jogo:efeito': (e: Efeito) => void;
  'jogo:fim': (p: { vencedorId: string | null; equipe?: number }) => void;
}

export interface InfoServidor {
  enderecos: string[];
  porta: number;
  versao: string;
}
