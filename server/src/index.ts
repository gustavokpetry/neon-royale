/**
 * Servidor: um processo Node serve o cliente compilado e o Socket.IO na mesma porta (rede local).
 */
import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { Server, type Socket } from 'socket.io';
import { CONFIG } from '@shared/config';
import { ESQUEMAS } from '@shared/esquemas';
import type { IdPersonagem } from '@shared/personagens';
import type { IdMapa } from '@shared/mapa';
import type { ModoJogo } from '@shared/protocolo';
import type { Efeito, EventosClienteServidor, EventosServidorCliente, InfoServidor, Resposta, Sessao } from '@shared/protocolo';
import { ativarSupernova, atacar, limparMudancasPintura, mirar, receberComando, snapshot, tick, trocarPersonagemAoRenascer, usarAtiva } from './jogo';
import { Limitador } from './limitador';
import { enderecosRedeLocal } from './rede';
import { rngServidor } from './rng';
import { ErroSala, Salas, type Sala } from './salas';

export const VERSAO = '0.16.2';
type Io = Server<EventosClienteServidor, EventosServidorCliente>;
type Sock = Socket<EventosClienteServidor, EventosServidorCliente>;

export function origemPermitida(origem: string | undefined, host: string | undefined): boolean {
  if (!origem) return true;
  try {
    return new URL(origem).host === host;
  } catch {
    return false;
  }
}

export interface ServidorJogo {
  http: HttpServer;
  io: Io;
  salas: Salas;
  porta: number;
  fechar: () => Promise<void>;
}

export async function iniciarServidor(op: { porta: number; host: string; pastaCliente?: string; prazoReconexaoMs?: number }): Promise<ServidorJogo> {
  const app = express();
  app.disable('x-powered-by');
  const http = createServer(app);
  const io: Io = new Server(http, {
    maxHttpBufferSize: CONFIG.rede.maxBytesMensagem,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    allowRequest: (req, cb) => cb(null, origemPermitida(req.headers.origin, req.headers.host)),
  });
  const salas = new Salas(rngServidor, Date.now, op.prazoReconexaoMs ?? CONFIG.sala.prazoReconexaoMs);
  const limGeral = new Limitador(CONFIG.rede.maxEventosPorSegundo, CONFIG.rede.rajadaEventos);
  const limCmd = new Limitador(CONFIG.rede.maxComandosPorSegundo, CONFIG.rede.maxComandosPorSegundo * 2);
  const limEntrada = new Limitador(CONFIG.sala.maxTentativasEntradaPorMinuto / 60, CONFIG.sala.maxTentativasEntradaPorMinuto);
  const tokenDe = new Map<string, string>();
  const canal = (s: Sala) => `sala:${s.codigo}`;
  const publicar = (s: Sala) => io.to(canal(s)).emit('sala:estado', salas.publica(s));
  const emitirEfeitos = (s: Sala, efs: Efeito[]) => {
    for (const e of efs) io.to(canal(s)).emit('jogo:efeito', e);
  };

  io.on('connection', (socket: Sock) => {
    const ip = socket.handshake.address;
    const sessaoAtual = () => {
      const t = tokenDe.get(socket.id);
      return t ? salas.sessao(t) : undefined;
    };
    function tratar<E extends keyof typeof ESQUEMAS>(evento: E, fn: (d: ReturnType<(typeof ESQUEMAS)[E]['parse']>) => unknown, extra?: () => boolean) {
      return (bruto: unknown, ack: unknown) => {
        const responder = (r: Resposta<unknown>) => typeof ack === 'function' && (ack as (r: Resposta<unknown>) => void)(r);
        if (!limGeral.permitir(socket.id) || (extra && !extra())) return responder({ ok: false, erro: { codigo: 'LIMITE_EXCEDIDO', mensagem: 'Aguarde.' } });
        const v = ESQUEMAS[evento].safeParse(bruto ?? {});
        if (!v.success) {
          const campo = v.error.issues[0]?.path[0];
          const codigo = campo === 'codigo' ? 'CODIGO_INVALIDO' : campo === 'apelido' ? 'APELIDO_INVALIDO' : 'DADOS_INVALIDOS';
          return responder({ ok: false, erro: { codigo, mensagem: codigo === 'CODIGO_INVALIDO' ? 'Código inválido.' : codigo === 'APELIDO_INVALIDO' ? 'Apelido inválido.' : 'Mensagem inválida.' } });
        }
        try {
          responder({ ok: true, dados: fn(v.data as never) ?? null });
        } catch (e) {
          if (e instanceof ErroSala) return responder({ ok: false, erro: e.json });
          console.error(e);
          responder({ ok: false, erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'Erro no servidor.' } });
        }
      };
    }
    const entrarNoCanal = (s: Sala, token: string): Sessao => {
      for (const r of socket.rooms) if (r.startsWith('sala:')) void socket.leave(r);
      void socket.join(canal(s));
      tokenDe.set(socket.id, token);
      publicar(s);
      return { token, jogadorId: s.jogadores.find((j) => j.token === token)!.id, sala: salas.publica(s) };
    };

    socket.on('sala:criar', tratar('sala:criar', ({ apelido }) => {
      const { sala, jogador } = salas.criar(apelido, socket.id);
      return entrarNoCanal(sala, jogador.token);
    }));
    socket.on('sala:entrar', tratar('sala:entrar', ({ codigo, apelido }) => {
      const { sala, jogador } = salas.entrar(codigo, apelido, socket.id);
      return entrarNoCanal(sala, jogador.token);
    }, () => limEntrada.permitir(ip)));
    socket.on('sala:reconectar', tratar('sala:reconectar', ({ token }) => {
      const anterior = salas.sessao(token)?.jogador.socketId;
      const { sala } = salas.reconectar(token, socket.id);
      if (anterior && anterior !== socket.id) io.sockets.sockets.get(anterior)?.disconnect(true);
      return entrarNoCanal(sala, token);
    }));
    socket.on('sala:sair', tratar('sala:sair', () => {
      const t = tokenDe.get(socket.id);
      if (!t) throw new ErroSala('FORA_DA_SALA', 'Você não está numa sala.');
      const sala = salas.sair(t);
      tokenDe.delete(socket.id);
      void socket.leave(canal(sala));
      publicar(sala);
      return null;
    }));
    socket.on('sala:expulsar', tratar('sala:expulsar', ({ jogadorId }) => {
      const t = tokenDe.get(socket.id);
      if (!t) throw new ErroSala('FORA_DA_SALA', 'Você não está numa sala.');
      const { sala, socketId } = salas.expulsar(t, jogadorId);
      if (socketId) {
        // quem foi expulso volta ao menu com o aviso e deixa de receber a sala
        io.to(socketId).emit('sala:encerrada', { motivo: 'Você foi expulso da sala pelo anfitrião.' });
        tokenDe.delete(socketId);
        io.sockets.sockets.get(socketId)?.leave(canal(sala));
      }
      publicar(sala);
      return null;
    }));
    const lobby = (fn: (token: string, d: never) => Sala) => (d: never) => {
      const t = tokenDe.get(socket.id);
      if (!t) throw new ErroSala('FORA_DA_SALA', 'Você não está numa sala.');
      publicar(fn(t, d));
      return null;
    };
    socket.on('lobby:personagem', tratar('lobby:personagem', lobby((t, d: { personagem: IdPersonagem | null }) => salas.escolher(t, d.personagem)) as never));
    socket.on('lobby:pronto', tratar('lobby:pronto', lobby((t, d: { pronto: boolean }) => salas.pronto(t, d.pronto)) as never));
    socket.on('lobby:mapa', tratar('lobby:mapa', lobby((t, d: { mapa: IdMapa }) => salas.escolherMapa(t, d.mapa)) as never));
    socket.on('lobby:modo', tratar('lobby:modo', lobby((t, d: { modo: ModoJogo }) => salas.escolherModo(t, d.modo)) as never));
    socket.on('lobby:equipe', tratar('lobby:equipe', lobby((t, d: { equipe: number }) => salas.trocarEquipe(t, d.equipe)) as never));
    socket.on('lobby:corEquipe', tratar('lobby:corEquipe', lobby((t, d: { cor: string }) => salas.corEquipe(t, d.cor)) as never));
    socket.on('lobby:iniciar', tratar('lobby:iniciar', lobby((t) => salas.iniciar(t)) as never));

    socket.on('jogo:cmd', (bruto) => {
      if (!limCmd.permitir(socket.id)) return;
      const v = ESQUEMAS['jogo:cmd'].safeParse(bruto);
      const s = sessaoAtual();
      const l = s?.sala.jogo?.lutadores.get(s.jogador.id);
      if (v.success && l) receberComando(l, v.data);
    });
    socket.on('jogo:mira', (bruto) => {
      if (!limCmd.permitir(socket.id)) return;
      const v = ESQUEMAS['jogo:mira'].safeParse(bruto);
      const s = sessaoAtual();
      const l = s?.sala.jogo?.lutadores.get(s.jogador.id);
      if (v.success && l) mirar(l, v.data.dx, v.data.dy);
    });
    const acao = (evento: 'jogo:atacar' | 'jogo:ativa') => (bruto: unknown) => {
      if (!limGeral.permitir(socket.id)) return;
      const v = ESQUEMAS[evento].safeParse(bruto);
      const s = sessaoAtual();
      const jogo = s?.sala.jogo;
      const l = jogo?.lutadores.get(s!.jogador.id);
      if (!v.success || !jogo || !l) return;
      const efs: Efeito[] = [];
      if (evento === 'jogo:atacar') atacar(jogo, l, v.data.dx, v.data.dy, Date.now(), efs, (v.data as { carga?: number }).carga ?? 0);
      else usarAtiva(jogo, l, v.data.dx, v.data.dy, Date.now(), efs);
      emitirEfeitos(s!.sala, efs);
    };
    socket.on('jogo:atacar', acao('jogo:atacar'));
    socket.on('jogo:supernova', () => {
      if (!limGeral.permitir(socket.id)) return;
      const s = sessaoAtual();
      const jogo = s?.sala.jogo;
      const l = jogo?.lutadores.get(s!.jogador.id);
      if (!jogo || !l) return;
      const efs: Efeito[] = [];
      ativarSupernova(jogo, l, Date.now(), efs);
      emitirEfeitos(s!.sala, efs);
    });
    socket.on('jogo:personagem', (bruto) => {
      if (!limGeral.permitir(socket.id)) return;
      const v = ESQUEMAS['jogo:personagem'].safeParse(bruto);
      const s = sessaoAtual();
      const jogo = s?.sala.jogo;
      const l = jogo?.lutadores.get(s!.jogador.id);
      if (v.success && jogo && l) trocarPersonagemAoRenascer(jogo, l, v.data.personagem);
    });
    socket.on('jogo:ativa', acao('jogo:ativa'));
    socket.on('ping', (t, ack) => typeof ack === 'function' && typeof t === 'number' && ack(t));
    socket.on('disconnect', () => {
      tokenDe.delete(socket.id);
      limGeral.esquecer(socket.id);
      limCmd.esquecer(socket.id);
      const sala = salas.desconectar(socket.id);
      if (sala) publicar(sala);
    });
  });

  let porta = op.porta;
  app.get('/api/info', (_q, res) => res.json({ enderecos: enderecosRedeLocal(porta), porta, versao: VERSAO } satisfies InfoServidor));
  if (op.pastaCliente && existsSync(op.pastaCliente)) {
    // index.html nunca fica em cache (senão o navegador continua com a versão antiga depois de
    // atualizar); os arquivos de /assets têm o hash no nome e podem ficar guardados para sempre
    app.use(
      express.static(op.pastaCliente, {
        index: 'index.html',
        setHeaders: (res, caminho) =>
          res.setHeader('Cache-Control', caminho.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable'),
      }),
    );
    app.get('*', (_q, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(resolve(op.pastaCliente!, 'index.html'));
    });
  }

  // laço da simulação
  const fimEnviado = new WeakSet<object>();
  const laco = setInterval(() => {
    const agora = Date.now();
    for (const sala of salas.todas()) {
      const jogo = sala.jogo;
      if (!jogo) continue;
      const efs: Efeito[] = [];
      tick(jogo, agora, efs);
      emitirEfeitos(sala, efs);
      // cada jogador recebe só o que pode ver (invisíveis e minas)
      for (const j of sala.jogadores) {
        if (j.socketId) io.to(j.socketId).volatile.emit('jogo:snapshot', snapshot(jogo, agora, j.id));
      }
      limparMudancasPintura(jogo);
      if (jogo.fim && !fimEnviado.has(jogo)) {
        fimEnviado.add(jogo);
        io.to(canal(sala)).emit('jogo:fim', { vencedorId: jogo.fim.vencedorId, ...(jogo.fim.equipe !== undefined ? { equipe: jogo.fim.equipe } : {}) });
        // volta ao lobby depois de mostrar o resultado
        setTimeout(() => {
          if (sala.jogo === jogo) {
            salas.encerrarJogo(sala);
            publicar(sala);
          }
        }, 5000);
      }
    }
  }, 1000 / CONFIG.rede.taxaSimulacaoHz);
  const manut = setInterval(() => {
    const { alteradas, encerradas } = salas.manutencao();
    for (const s of alteradas) publicar(s);
    for (const s of encerradas) io.to(canal(s)).emit('sala:encerrada', { motivo: 'Sala encerrada.' });
  }, CONFIG.sala.intervaloLimpezaMs);
  laco.unref();
  manut.unref();

  await new Promise<void>((ok, falha) => {
    http.once('error', falha);
    http.listen(op.porta, op.host, () => ok());
  });
  const end = http.address();
  if (end && typeof end === 'object') porta = end.port;
  return {
    http,
    io,
    salas,
    porta,
    fechar: async () => {
      clearInterval(laco);
      clearInterval(manut);
      await new Promise<void>((ok) => io.close(() => ok()));
    },
  };
}

async function main(): Promise<void> {
  const porta = Number(process.env.PORT || 3100);
  const pastaCliente = resolve(dirname(fileURLToPath(import.meta.url)), '../client');
  const s = await iniciarServidor({ porta, host: process.env.HOST || '0.0.0.0', pastaCliente });
  const dev = !existsSync(pastaCliente);
  const enderecos = enderecosRedeLocal(dev ? 5173 : s.porta);
  console.log(`\nNeon Royale v${VERSAO} — porta ${s.porta}${dev ? ' (dev: abra pela porta 5173)' : ''}`);
  for (const e of enderecos) console.log(`  ${e}`);
  if (enderecos[0]) console.log(await QRCode.toString(enderecos[0], { type: 'terminal', small: true }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
