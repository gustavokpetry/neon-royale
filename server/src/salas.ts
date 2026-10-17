/** Salas privadas (2 jogadores por enquanto): lobby, escolha de personagem, início e reconexão. */
import { CONFIG } from '@shared/config';
import { MAPAS, MAPA_PADRAO, mapaAceitaModo, type IdMapa } from '@shared/mapa';
import { CORES_EQUIPE, MODOS_EQUIPE, type ModoJogo } from '@shared/protocolo';
import { IDS_PERSONAGENS, type IdPersonagem } from '@shared/personagens';
import type { CodigoErro, ErroJogo, SalaPublica } from '@shared/protocolo';
import { criarJogo, eliminar, type EstadoJogo } from './jogo';
import { gerarId, gerarToken, type Rng } from './rng';

export interface Jogador {
  id: string;
  token: string;
  apelido: string;
  socketId: string | null;
  desconectadoEm: number | null;
  personagem: IdPersonagem | null;
  pronto: boolean;
  equipe: number;
}

export interface Sala {
  codigo: string;
  anfitriaoId: string;
  jogadores: Jogador[];
  jogo: EstadoJogo | null;
  mapa: IdMapa;
  modo: ModoJogo;
  coresEquipe: [string, string];
  ladosTrocados: boolean;
  semConectadosDesde: number | null;
}

export class ErroSala extends Error {
  constructor(
    readonly codigo: CodigoErro,
    mensagem: string,
  ) {
    super(mensagem);
  }
  get json(): ErroJogo {
    return { codigo: this.codigo, mensagem: this.message };
  }
}
const erro = (c: CodigoErro, m: string): never => {
  throw new ErroSala(c, m);
};

export class Salas {
  private salas = new Map<string, Sala>();
  private porToken = new Map<string, string>();

  constructor(
    private readonly rng: Rng,
    private readonly agora: () => number = Date.now,
    private readonly prazoReconexaoMs: number = CONFIG.sala.prazoReconexaoMs,
  ) {}

  todas(): Iterable<Sala> {
    return this.salas.values();
  }

  sessao(token: string): { sala: Sala; jogador: Jogador } | undefined {
    const codigo = this.porToken.get(token);
    const sala = codigo ? this.salas.get(codigo) : undefined;
    const jogador = sala?.jogadores.find((j) => j.token === token);
    return sala && jogador ? { sala, jogador } : undefined;
  }

  criar(apelido: string, socketId: string): { sala: Sala; jogador: Jogador } {
    let codigo = '';
    do {
      codigo = Array.from({ length: CONFIG.sala.tamanhoCodigo }, () => CONFIG.sala.alfabetoCodigo[this.rng.inteiro(0, CONFIG.sala.alfabetoCodigo.length - 1)]).join('');
    } while (this.salas.has(codigo));
    const jogador = this.novo(apelido, socketId);
    jogador.personagem = 'veni'; // cada um já entra com um personagem livre; dá para trocar no lobby
    const sala: Sala = { codigo, anfitriaoId: jogador.id, jogadores: [jogador], jogo: null, mapa: MAPA_PADRAO, modo: 'royale', coresEquipe: [CORES_EQUIPE[0], CORES_EQUIPE[1]], ladosTrocados: false, semConectadosDesde: null };
    this.salas.set(codigo, sala);
    this.porToken.set(jogador.token, codigo);
    return { sala, jogador };
  }

  entrar(codigo: string, apelido: string, socketId: string): { sala: Sala; jogador: Jogador } {
    const sala = this.salas.get(codigo) ?? erro('CODIGO_INVALIDO', 'Sala não encontrada.');
    if (sala.jogo) erro('PARTIDA_INICIADA', 'A partida já começou.');
    if (sala.jogadores.length >= CONFIG.sala.jogadores) erro('SALA_CHEIA', 'Sala cheia.');
    let nome = apelido;
    for (let n = 2; sala.jogadores.some((j) => j.apelido.toLowerCase() === nome.toLowerCase()); n++) nome = `${apelido.slice(0, 13)} ${n}`;
    const jogador = this.novo(nome, socketId);
    // o primeiro personagem livre já vem marcado
    const livre = IDS_PERSONAGENS.find((p) => !sala.jogadores.some((j) => j.personagem === p));
    jogador.personagem = livre ?? null;
    // entra na equipe com menos gente
    jogador.equipe = sala.jogadores.filter((j) => j.equipe === 0).length <= sala.jogadores.filter((j) => j.equipe === 1).length ? 0 : 1;
    sala.jogadores.push(jogador);
    this.porToken.set(jogador.token, codigo);
    return { sala, jogador };
  }

  reconectar(token: string, socketId: string): { sala: Sala; jogador: Jogador } {
    const s = this.sessao(token) ?? erro('SESSAO_INVALIDA', 'Sessão expirada.');
    s.jogador.socketId = socketId;
    s.jogador.desconectadoEm = null;
    s.sala.semConectadosDesde = null;
    return s;
  }

  desconectar(socketId: string): Sala | undefined {
    for (const sala of this.salas.values()) {
      const j = sala.jogadores.find((x) => x.socketId === socketId);
      if (!j) continue;
      j.socketId = null;
      j.desconectadoEm = this.agora();
      if (!sala.jogadores.some((x) => x.socketId)) sala.semConectadosDesde = this.agora();
      return sala;
    }
    return undefined;
  }

  sair(token: string): Sala {
    const { sala, jogador } = this.sessao(token) ?? erro('FORA_DA_SALA', 'Você não está numa sala.');
    this.remover(sala, jogador);
    return sala;
  }

  /** O anfitrião expulsa um jogador (no lobby ou no meio da partida). Devolve o socket de quem saiu. */
  expulsar(token: string, jogadorId: string): { sala: Sala; socketId: string | null } {
    const s = this.sessao(token) ?? erro('FORA_DA_SALA', 'Você não está numa sala.');
    if (s.jogador.id !== s.sala.anfitriaoId) erro('NAO_AUTORIZADO', 'Só o anfitrião expulsa jogadores.');
    const alvo = s.sala.jogadores.find((j) => j.id === jogadorId) ?? erro('DADOS_INVALIDOS', 'Jogador não encontrado.');
    if (alvo === s.jogador) erro('DADOS_INVALIDOS', 'Para sair, use o botão de sair.');
    const socketId = alvo.socketId;
    this.remover(s.sala, alvo);
    return { sala: s.sala, socketId };
  }

  escolher(token: string, personagem: IdPersonagem | null): Sala {
    const { sala, jogador } = this.lobby(token);
    if (personagem && sala.jogadores.some((j) => j !== jogador && j.personagem === personagem)) erro('PERSONAGEM_OCUPADO', 'Personagem já escolhido.');
    jogador.personagem = personagem;
    jogador.pronto = false;
    return sala;
  }

  pronto(token: string, pronto: boolean): Sala {
    const { sala, jogador } = this.lobby(token);
    if (pronto && !jogador.personagem) erro('NAO_PODE_INICIAR', 'Escolha um personagem.');
    jogador.pronto = pronto;
    return sala;
  }

  /** O anfitrião escolhe o mapa no lobby. */
  escolherMapa(token: string, mapa: IdMapa): Sala {
    const { sala, jogador } = this.lobby(token);
    if (jogador.id !== sala.anfitriaoId) erro('NAO_AUTORIZADO', 'Só o anfitrião escolhe o mapa.');
    if (!mapaAceitaModo(MAPAS[mapa], sala.modo)) erro('NAO_PODE_INICIAR', 'Este mapa não é feito para o Pega Bandeira.');
    sala.mapa = mapa;
    return sala;
  }

  /** O anfitrião escolhe o modo no lobby. */
  escolherModo(token: string, modo: ModoJogo): Sala {
    const { sala, jogador } = this.lobby(token);
    if (jogador.id !== sala.anfitriaoId) erro('NAO_AUTORIZADO', 'Só o anfitrião escolhe o modo.');
    sala.modo = modo;
    // Pega Bandeira: se o mapa atual não é feito para ele, troca para a Colmeia
    if (!mapaAceitaModo(MAPAS[sala.mapa], modo)) sala.mapa = 'colmeia';
    return sala;
  }

  /** Troca de equipe no lobby (no máximo 3 por equipe). */
  trocarEquipe(token: string, equipe: number): Sala {
    const { sala, jogador } = this.lobby(token);
    if (sala.jogadores.filter((j) => j.equipe === equipe && j !== jogador).length >= 3) erro('SALA_CHEIA', 'Equipe cheia.');
    jogador.equipe = equipe;
    jogador.pronto = false;
    return sala;
  }

  /** O líder (o primeiro da equipe) escolhe a cor; as duas equipes não podem ter a mesma cor. */
  corEquipe(token: string, cor: string): Sala {
    const { sala, jogador } = this.lobby(token);
    const lider = sala.jogadores.find((j) => j.equipe === jogador.equipe);
    if (lider !== jogador) erro('NAO_AUTORIZADO', 'Só o líder da equipe escolhe a cor.');
    if (!(CORES_EQUIPE as readonly string[]).includes(cor)) erro('DADOS_INVALIDOS', 'Cor inválida.');
    if (sala.coresEquipe[1 - jogador.equipe] === cor) erro('DADOS_INVALIDOS', 'A outra equipe já usa essa cor.');
    sala.coresEquipe[jogador.equipe] = cor;
    return sala;
  }

  podeIniciar(sala: Sala): boolean {
    return (
      !sala.jogo &&
      sala.jogadores.length >= CONFIG.sala.minimoJogadores &&
      mapaAceitaModo(MAPAS[sala.mapa], sala.modo) &&
      (!MODOS_EQUIPE.includes(sala.modo) || (sala.jogadores.some((j) => j.equipe === 0) && sala.jogadores.some((j) => j.equipe === 1))) &&
      sala.jogadores.every((j) => j.socketId && j.personagem && (j.pronto || j.id === sala.anfitriaoId))
    );
  }

  iniciar(token: string): Sala {
    const { sala, jogador } = this.lobby(token);
    if (jogador.id !== sala.anfitriaoId) erro('NAO_AUTORIZADO', 'Só o anfitrião inicia.');
    if (!this.podeIniciar(sala)) erro('NAO_PODE_INICIAR', 'Aguardando os jogadores ficarem prontos.');
    sala.jogo = criarJogo(
      sala.jogadores.map((j) => ({ id: j.id, personagem: j.personagem!, equipe: j.equipe })),
      this.agora(),
      MAPAS[sala.mapa],
      sala.modo,
      [...sala.coresEquipe],
      sala.ladosTrocados,
    );
    return sala;
  }

  /** Volta ao lobby depois do fim da partida. */
  encerrarJogo(sala: Sala): void {
    if (sala.jogo && MODOS_EQUIPE.includes(sala.modo)) sala.ladosTrocados = !sala.ladosTrocados;
    sala.jogo = null;
    for (const j of sala.jogadores) j.pronto = false;
  }

  /** Expira desconexões e salas vazias. Retorna salas alteradas e encerradas. */
  manutencao(): { alteradas: Sala[]; encerradas: Sala[] } {
    const t = this.agora();
    const alteradas: Sala[] = [];
    const encerradas: Sala[] = [];
    for (const sala of this.salas.values()) {
      let mudou = false;
      for (const j of [...sala.jogadores]) {
        if (j.desconectadoEm !== null && t - j.desconectadoEm >= this.prazoReconexaoMs) {
          this.remover(sala, j);
          mudou = true;
        }
      }
      const ociosa = sala.semConectadosDesde !== null && t - sala.semConectadosDesde >= CONFIG.sala.encerrarSalaVaziaMs;
      if (!sala.jogadores.length || ociosa) {
        for (const j of sala.jogadores) this.porToken.delete(j.token);
        this.salas.delete(sala.codigo);
        encerradas.push(sala);
      } else if (mudou) alteradas.push(sala);
    }
    return { alteradas, encerradas };
  }

  publica(sala: Sala): SalaPublica {
    return {
      codigo: sala.codigo,
      estado: sala.jogo ? 'partida' : 'lobby',
      mapa: sala.mapa,
      modo: sala.modo,
      coresEquipe: [...sala.coresEquipe] as [string, string],
      ladosTrocados: sala.ladosTrocados,
      jogadores: sala.jogadores.map((j) => ({
        id: j.id,
        apelido: j.apelido,
        personagem: j.personagem,
        pronto: j.pronto,
        conectado: j.socketId !== null,
        anfitriao: j.id === sala.anfitriaoId,
        equipe: j.equipe,
      })),
      podeIniciar: this.podeIniciar(sala),
    };
  }

  private lobby(token: string): { sala: Sala; jogador: Jogador } {
    const s = this.sessao(token) ?? erro('FORA_DA_SALA', 'Você não está numa sala.');
    if (s.sala.jogo) erro('PARTIDA_INICIADA', 'A partida já começou.');
    return s;
  }

  private remover(sala: Sala, j: Jogador): void {
    sala.jogadores = sala.jogadores.filter((x) => x !== j);
    this.porToken.delete(j.token);
    if (sala.jogo) eliminar(sala.jogo, j.id, this.agora(), []);
    if (j.id === sala.anfitriaoId && sala.jogadores[0]) sala.anfitriaoId = sala.jogadores[0].id;
  }

  private novo(apelido: string, socketId: string): Jogador {
    return { id: gerarId(), token: gerarToken(), apelido, socketId, desconectadoEm: null, personagem: null, pronto: false, equipe: 0 };
  }
}
