/** Conexão com o servidor (mesma origem), sessão e reconexão automática. */
import { io, type Socket } from 'socket.io-client';
import type { EventosClienteServidor, EventosServidorCliente, Resposta, SalaPublica, Sessao } from '@shared/protocolo';

const CHAVE = 'neon:sessao';
export type EstadoConexao = 'conectando' | 'conectado' | 'reconectando';

export class Conexao {
  readonly socket: Socket<EventosServidorCliente, EventosClienteServidor>;
  private token: string | null = null;

  constructor(
    private readonly ao: {
      conexao: (e: EstadoConexao) => void;
      sessao: (s: Sessao | null, aviso?: string) => void;
      sala: (s: SalaPublica) => void;
      encerrada: (motivo: string) => void;
    },
  ) {
    try {
      this.token = localStorage.getItem(CHAVE);
    } catch {
      this.token = null;
    }
    this.socket = io({ reconnectionDelay: 400, reconnectionDelayMax: 2500 });
    ao.conexao('conectando');
    this.socket.on('connect', () => {
      ao.conexao('conectado');
      if (this.token) void this.reconectar();
    });
    this.socket.on('disconnect', () => ao.conexao('reconectando'));
    this.socket.on('sala:estado', (s) => ao.sala(s));
    this.socket.on('sala:encerrada', ({ motivo }) => {
      this.esquecer();
      ao.encerrada(motivo);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.socket.connected) this.socket.connect();
    });
  }

  get conectado(): boolean {
    return this.socket.connected;
  }

  enviar<K extends 'sala:criar' | 'sala:entrar' | 'sala:reconectar' | 'sala:sair' | 'sala:expulsar' | 'lobby:personagem' | 'lobby:pronto' | 'lobby:mapa' | 'lobby:modo' | 'lobby:equipe' | 'lobby:corEquipe' | 'lobby:iniciar'>(
    evento: K,
    dados: Parameters<EventosClienteServidor[K]>[0],
  ): Promise<Parameters<Parameters<EventosClienteServidor[K]>[1]>[0]> {
    type R = Parameters<Parameters<EventosClienteServidor[K]>[1]>[0];
    const emissor = this.socket.timeout(8000) as unknown as { emit: (e: K, d: unknown, cb: (err: Error | null, r: R) => void) => void };
    return new Promise((ok) =>
      emissor.emit(evento, dados, (err, r) => ok(err ? ({ ok: false, erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'Sem resposta do servidor.' } } as R) : r)),
    );
  }

  async criar(apelido: string): Promise<Resposta<Sessao>> {
    const r = await this.enviar('sala:criar', { apelido });
    if (r.ok) this.guardar(r.dados);
    return r;
  }

  async entrar(codigo: string, apelido: string): Promise<Resposta<Sessao>> {
    const r = await this.enviar('sala:entrar', { codigo, apelido });
    if (r.ok) this.guardar(r.dados);
    return r;
  }

  async sair(): Promise<void> {
    if (this.socket.connected) await this.enviar('sala:sair', {});
    this.esquecer();
    this.ao.sessao(null);
  }

  private async reconectar(): Promise<void> {
    const r = await this.enviar('sala:reconectar', { token: this.token! });
    if (r.ok) this.ao.sessao(r.dados);
    else {
      this.esquecer();
      this.ao.sessao(null);
    }
  }

  private guardar(s: Sessao): void {
    this.token = s.token;
    try {
      localStorage.setItem(CHAVE, s.token);
    } catch {
      /* sem armazenamento: reconexão só com a aba aberta */
    }
    this.ao.sessao(s);
  }

  private esquecer(): void {
    this.token = null;
    try {
      localStorage.removeItem(CHAVE);
    } catch {
      /* ignorado */
    }
  }
}
