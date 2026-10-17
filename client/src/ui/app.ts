/** Interface em DOM: menu, sala, escolha de personagem, HUD da partida e resultado. Quase só ícones. */
import QRCode from 'qrcode';
import { CONFIG } from '@shared/config';
import { LISTA_MAPAS, MAPAS, mapaAceitaModo, type IdMapa, type Mapa } from '@shared/mapa';
import { LISTA_PERSONAGENS, PERSONAGENS, type IdPersonagem } from '@shared/personagens';
import type { InfoServidor, LutadorSnap, SalaPublica, Sessao } from '@shared/protocolo';
import { Entrada, MiraToque, ehToque } from '../controls/entrada';
import { Conexao, type EstadoConexao } from '../network/conexao';
import { abrirArena, arena, fecharArena } from '../scenes/montar';
import { ICONES, ICONE_ARMA, ICONE_ATIVA, ICONE_MODO, ICONE_PASSIVA } from './icones';
import { CORES_EQUIPE, MODOS_EQUIPE, MODOS_TROCA, type ModoJogo } from '@shared/protocolo';
import type { Placar } from '../scenes/Arena';
import { copiarTexto, esc, lerPreferencias, salvarPreferencias } from './util';
import { alternarMudo, estaMudo, tocar } from '../audio/som';
import { iniciarFundo, pararFundo } from './fundo';

type Tela = 'menu' | 'criar' | 'entrar' | 'lobby' | 'partida';
const st = {
  tela: 'menu' as Tela,
  conexao: 'conectando' as EstadoConexao,
  sessao: null as Sessao | null,
  sala: null as SalaPublica | null,
  aviso: null as string | null,
  endereco: null as string | null,
  qr: null as string | null,
  fim: null as { vencedorId: string | null; equipe?: number } | null,
  /** Etapa do lobby (Modo → Mapa → Personagem). */
  etapa: null as 'modo' | 'mapa' | 'times' | 'personagem' | null,
};
const raiz = document.getElementById('ui')!;
let conexao: Conexao;
let entrada: Entrada | null = null;
let mira: MiraToque | null = null;

export function iniciarApp(): void {
  conexao = new Conexao({
    conexao: (c) => {
      st.conexao = c;
      const b = document.querySelector<HTMLButtonElement>('#form button[type=submit]');
      if (b) b.disabled = c !== 'conectado';
      document.getElementById('conexao')?.setAttribute('data-estado', c);
    },
    sessao: (s, aviso) => {
      st.sessao = s;
      st.sala = s?.sala ?? null;
      if (aviso) st.aviso = aviso;
      atualizarTela();
    },
    sala: (s) => {
      st.sala = s;
      atualizarTela();
    },
    encerrada: (motivo) => {
      st.sessao = null;
      st.sala = null;
      st.aviso = motivo;
      ir('menu');
    },
  });
  conexao.socket.on('jogo:fim', (f) => {
    st.fim = f;
    mostrarFim();
  });
  if (new URLSearchParams(location.search).has('sala')) st.tela = 'entrar';
  void carregarEndereco();
  render();
}

const meuId = () => st.sessao?.jogadorId ?? '';
const eu = () => st.sala?.jogadores.find((j) => j.id === meuId());

function ir(t: Tela): void {
  if (st.tela === 'partida' && t !== 'partida') sairDaPartida();
  st.tela = t;
  render();
}

function atualizarTela(): void {
  if (!st.sessao || !st.sala) {
    if (st.tela === 'lobby' || st.tela === 'partida') ir('menu');
    else render();
    return;
  }
  if (st.sala.estado === 'partida') {
    if (st.tela !== 'partida') {
      st.tela = 'partida';
      st.fim = null;
      render();
      const personagens: Record<string, { personagem: IdPersonagem; apelido: string; vaga: number; equipe?: number }> = {};
      const emEquipe = MODOS_EQUIPE.includes(st.sala.modo);
      // mesma regra de vagas do servidor: em equipe, a 0 fica à esquerda (0, 3, 4) e a 1 à direita (2, 1, 5)
      const vagasEquipe = st.sala.ladosTrocados ? [[2, 1, 5], [0, 3, 4]] : [[0, 3, 4], [2, 1, 5]];
      const usadas = [0, 0];
      st.sala.jogadores.forEach((j, i) => {
        const vaga = emEquipe ? vagasEquipe[j.equipe]![usadas[j.equipe]!++ % 3]! : i;
        if (j.personagem) personagens[j.id] = { personagem: j.personagem, apelido: j.apelido, vaga, ...(emEquipe ? { equipe: j.equipe } : {}) };
      });
      void abrirArena(document.getElementById('jogo')!, {
        socket: conexao.socket,
        meuId: meuId(),
        mapa: MAPAS[st.sala.mapa],
        ...(MODOS_EQUIPE.includes(st.sala.modo) ? { coresEquipe: st.sala.coresEquipe } : {}),
        personagens,
        lerMovimento: () => entrada?.vetor() ?? { x: 0, y: 0 },
        lerMira: () => mira?.estado() ?? null,
        aoEstado: atualizarHud,
      });
    }
  } else {
    if (st.tela === 'partida') sairDaPartida();
    st.tela = 'lobby';
    render();
  }
}

function sairDaPartida(): void {
  fecharArena();
  entrada?.destruir();
  mira?.destruir();
  entrada = null;
  mira = null;
}

async function carregarEndereco(): Promise<void> {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  let end = local ? null : location.origin;
  if (!end) {
    try {
      const info = (await (await fetch('/api/info')).json()) as InfoServidor;
      if (info.enderecos[0]) {
        const u = new URL(info.enderecos[0]);
        u.port = location.port;
        end = u.origin;
      }
    } catch {
      end = null;
    }
  }
  st.endereco = end;
  st.qr = end ? await QRCode.toDataURL(end, { margin: 1, width: 200, color: { dark: '#0f1115', light: '#e8ecf3' } }) : null;
  if (st.tela === 'lobby') render();
}

// ------------------------------------------------------------------ telas

function render(): void {
  if (st.tela === 'partida' && document.getElementById('hud')) return;
  raiz.className = `tela-${st.tela}`;
  const aviso = st.aviso ? `<p class="aviso">${esc(st.aviso)}</p>` : '';
  const telas: Record<Tela, () => string> = {
    menu: () => `
      <main class="menu">
        <h1 class="logo"><span class="l1">NEON</span><span class="l2">ROYALE</span></h1>
        <p class="sub">${LISTA_PERSONAGENS.length} personagens · ${LISTA_MAPAS.length} mapas · 3 modos</p>
        ${aviso}
        <nav>
          <button data-ir="criar" class="primario">${ICONES.mais} Criar sala</button>
          <button data-ir="entrar">${ICONES.entrar} Entrar</button>
        </nav>
      </main>`,
    criar: () => formulario(false, aviso),
    entrar: () => formulario(true, aviso),
    lobby: telaLobby,
    partida: telaPartida,
  };
  raiz.innerHTML = telas[st.tela]() + `<div id="conexao" class="conexao" data-estado="${st.conexao}"></div>`;
  if (st.tela === 'menu' || st.tela === 'criar' || st.tela === 'entrar') iniciarFundo();
  else pararFundo();
  ligar();
}

function formulario(entrar: boolean, aviso: string): string {
  const codigo = new URLSearchParams(location.search).get('sala') ?? '';
  return `
    <main class="cartao">
      ${aviso}
      <form id="form" autocomplete="off">
        <input name="apelido" placeholder="Apelido" maxlength="${CONFIG.sala.tamanhoMaxApelido}" value="${esc(lerPreferencias().apelido)}" required />
        ${entrar ? `<input name="codigo" class="codigo" placeholder="CÓDIGO" maxlength="6" value="${esc(codigo)}" required />` : ''}
        <div class="linha">
          <button type="button" data-ir="menu" class="icone" aria-label="Voltar">${ICONES.voltar}</button>
          <button type="submit" class="primario" ${st.conexao !== 'conectado' ? 'disabled' : ''}>${entrar ? ICONES.entrar : ICONES.mais}</button>
        </div>
      </form>
    </main>`;
}

function cartaoPersonagem(id: IdPersonagem, dono: string | null, meu: boolean): string {
  const p = PERSONAGENS[id];
  return `
    <button class="personagem ${meu ? 'meu' : ''}" data-personagem="${id}" ${dono && !meu ? 'disabled' : ''} style="--cor:${p.cor}">
      <span class="silhueta"></span>
      <strong>${esc(p.nome)}</strong>
      <span class="habs">
        <i title="${esc(`${p.arma.nome}`)}">${ICONE_ARMA[id]}</i>
        <i title="${esc(`${p.ativa.nome}: ${p.ativa.descricao}`)}">${ICONE_ATIVA[id]}</i>
        <i title="${esc(`${p.passiva.nome}: ${p.passiva.descricao}`)}">${ICONE_PASSIVA[id]}</i>
      </span>
      ${dono ? `<em>${esc(dono)}</em>` : ''}
    </button>`;
}

/** Miniatura do mapa em SVG (1 unidade = 1 bloco). */
const miniaturas = new Map<IdMapa, string>();
function miniatura(m: Mapa): string {
  const pronta = miniaturas.get(m.id);
  if (pronta) return pronta;
  const b = 16;
  const rets = m.obstaculos
    .map((o) => `<rect x="${o.x / b}" y="${o.y / b}" width="${o.w / b}" height="${o.h / b}" fill="${({ 2: '#56607a', 3: '#1d5674', 4: '#c2410c', 5: '#1f5a2a', 6: '#4a3a22', 7: '#5b3fd9', 8: '#4f8fa8' } as Record<number, string>)[o.tipo] ?? (o.tipo >= 9 ? '#33363f' : '#7a869f')}"/>`)
    .join('');
  const areas = m.areas.map((a) => `<circle cx="${a.x / b}" cy="${a.y / b}" r="${a.raio / b}" fill="none" stroke="#c9d2e0" stroke-opacity=".6" stroke-width="1.2"/>`).join('');
  const svg = `<svg viewBox="0 0 ${m.colunas} ${m.linhas}" aria-hidden="true"><rect width="${m.colunas}" height="${m.linhas}" fill="#0b0d11"/>${rets}${areas}<circle cx="${m.colunas / 2}" cy="${m.linhas / 2}" r="10" fill="none" stroke="#3a4152"/></svg>`;
  miniaturas.set(m.id, svg);
  return svg;
}

function telaLobby(): string {
  const sala = st.sala!;
  const meu = eu();
  const anfitriao = !!meu?.anfitriao;
  const jogadores = sala.jogadores
    .map((j) => {
      const c = MODOS_EQUIPE.includes(sala.modo) ? sala.coresEquipe[j.equipe]! : j.personagem ? PERSONAGENS[j.personagem].cor : '#3a4152';
      const status = !j.conectado ? ICONES.semSinal : j.anfitriao ? ICONES.coroa : j.pronto ? ICONES.check : ICONES.ampulheta;
      const expulsar = anfitriao && j.id !== meuId() ? `<button class="expulsar" data-expulsar="${j.id}" data-nome="${esc(j.apelido)}" aria-label="Expulsar" title="Expulsar">${ICONES.expulsar}</button>` : '';
      return `<li style="--cor:${c}"><span class="ponto"></span><b>${esc(j.apelido)}</b><span class="status">${status}</span>${expulsar}</li>`;
    })
    .join('');
  const vagas = CONFIG.sala.jogadores - sala.jogadores.length;
  const cartas = LISTA_PERSONAGENS.map((p) => {
    const dono = sala.jogadores.find((j) => j.personagem === p.id);
    return cartaoPersonagem(p.id, dono?.apelido ?? null, dono?.id === meuId());
  }).join('');
  const etapa = st.etapa ?? (anfitriao ? 'modo' : 'personagem');
  const emEquipe = MODOS_EQUIPE.includes(sala.modo);
  const ETAPAS = [
    { id: 'modo', icone: ICONE_MODO[sala.modo], nome: 'Modo' },
    { id: 'mapa', icone: ICONES.mapa, nome: 'Mapa' },
    ...(emEquipe ? [{ id: 'times', icone: ICONE_MODO.equipes, nome: 'Times' }] : []),
    { id: 'personagem', icone: ICONES.pessoa, nome: 'Personagem' },
  ] as const;
  const DESCR_MODO: Record<ModoJogo, [string, string]> = {
    royale: ['Royale', 'O último vivo vence.'],
    abates: ['10 abates', 'Quem morre renasce. O primeiro a 10 abates vence.'],
    corrida: ['Corrida armada', 'Cada abate troca de personagem. Vence quem abater com todos.'],
    equipes: ['Mata-mata em equipe', '2 equipes, sem fogo amigo. A primeira a 25 abates vence. Ao morrer, dá para trocar de personagem.'],
    neoncalypse: ['Neoncalypse', 'Royale com tudo em dobro e a zona fechando para o centro. Morreu, acabou.'],
    bandeira: ['Pega Bandeira', '7 pontos para capturar (o do centro vale 3). 300 pontos ou o maior placar em 5 min.'],
    bandeiraEquipe: ['Pega Bandeira em equipe', 'Igual ao Pega Bandeira, com os pontos somados por equipe.'],
    pintao: ['Pintão', 'Andar e atirar pinta o chão. Mais área em 3 min vence. Morreu, perde o que pintou.'],
    pintaoEquipe: ['Pintão em equipe', 'Igual ao Pintão, com a cor da equipe e a área somada.'],
  };
  let conteudo = '';
  if (etapa === 'modo') {
    conteudo = `<section class="modos">${(Object.keys(DESCR_MODO) as ModoJogo[])
      .map(
        (m) => `<button class="modo ${sala.modo === m ? 'escolhido' : ''}" data-modo="${m}" ${anfitriao ? '' : 'disabled'}>
          ${ICONE_MODO[m]}<strong>${DESCR_MODO[m][0]}</strong><small>${DESCR_MODO[m][1]}</small></button>`,
      )
      .join('')}</section>`;
  } else if (etapa === 'mapa') {
    conteudo = `<section class="mapas">${LISTA_MAPAS.map((m) => {
      const serve = mapaAceitaModo(m, sala.modo);
      return `<button class="mapa ${sala.mapa === m.id ? 'escolhido' : ''} ${serve ? '' : 'nao-serve'}" data-mapa="${m.id}" ${anfitriao && serve ? '' : 'disabled'} title="${esc(m.descricao)}">
          ${miniatura(m)}<strong>${m.paraBandeira ? ICONE_MODO.bandeira : ''}${esc(m.nome)}</strong></button>`;
    }).join('')}</section>`;
  } else if (etapa === 'times' && emEquipe) {
    conteudo = `<section class="times">${[0, 1]
      .map((eq) => {
        const membros = sala.jogadores.filter((j) => j.equipe === eq);
        const lider = membros[0];
        const souLider = lider?.id === meuId();
        const corEq = sala.coresEquipe[eq]!;
        return `<div class="time" style="--cor:${corEq}">
          <h3><span class="ponto"></span>${eq === 0 ? 'A' : 'B'}</h3>
          <ul>${membros.map((j) => `<li>${j === lider ? ICONES.coroa : ''}<b>${esc(j.apelido)}</b></li>`).join('') || '<li class="vazio">…</li>'}</ul>
          ${meu && meu.equipe !== eq ? `<button class="entrar-time" data-equipe="${eq}">${ICONES.entrar}</button>` : ''}
          ${
            souLider
              ? `<div class="paleta">${CORES_EQUIPE.map(
                  (c) => `<button class="cor ${c === corEq ? 'atual' : ''}" data-cor="${c}" style="--c:${c}" ${sala.coresEquipe[1 - eq] === c ? 'disabled' : ''} aria-label="Cor"></button>`,
                ).join('')}</div>`
              : ''
          }
        </div>`;
      })
      .join('')}</section>`;
  } else conteudo = `<section class="personagens">${cartas}</section>`;
  const idx = ETAPAS.findIndex((x) => x.id === etapa);
  return `
    <main class="lobby">
      <section class="cartao sala">
        <div>
          <p class="codigo-sala"><code id="codigo">${esc(sala.codigo)}</code><button id="copiar" class="icone" aria-label="Copiar">${ICONES.copiar}</button></p>
          ${st.endereco ? `<p class="endereco">${esc(st.endereco)}</p>` : ''}
          <ul class="jogadores">${jogadores}${'<li class="vaga"><span class="ponto"></span>…</li>'.repeat(Math.max(0, vagas))}</ul>
        </div>
        ${st.qr ? `<img class="qr" src="${st.qr}" alt="QR code" width="120" height="120" />` : ''}
      </section>
      ${st.aviso ? `<p class="aviso">${esc(st.aviso)}</p>` : ''}
      <nav class="etapas">
        ${ETAPAS.map(
          (x, k) => `<button class="etapa ${x.id === etapa ? 'atual' : ''}" data-etapa="${x.id}"><span class="num">${k + 1}</span>${x.icone}<small>${x.nome}</small></button>`,
        ).join('<span class="seta">›</span>')}
      </nav>
      <div class="resumo">${ICONE_MODO[sala.modo]} ${DESCR_MODO[sala.modo][0]} · ${ICONES.mapa} ${esc(MAPAS[sala.mapa].nome)}</div>
      ${conteudo}
      <footer class="acoes">
        <button id="sair" class="icone" aria-label="Sair">${ICONES.sair}</button>
        ${idx < ETAPAS.length - 1 ? `<button class="icone" data-etapa="${ETAPAS[idx + 1]!.id}" aria-label="Próxima etapa">${ICONES.avancar}</button>` : ''}
        ${
          anfitriao
            ? `<button id="iniciar" class="primario" ${sala.podeIniciar ? '' : 'disabled'}>${ICONES.play}</button>`
            : `<button id="pronto" class="primario ${meu?.pronto ? 'ativo' : ''}" ${meu?.personagem ? '' : 'disabled'}>${meu?.pronto ? ICONES.fechar : ICONES.check}</button>`
        }
      </footer>
    </main>`;
}

function telaPartida(): string {
  const toque = ehToque();
  return `
    <div id="hud" class="hud ${toque ? 'toque' : 'teclado'}">
      <div class="hud-topo"><div id="vida" class="vida"><div class="barra"></div><span></span></div><div id="placar" class="placar" hidden></div></div>
      <div id="contagem" class="contagem"></div>
      <div id="zona-joystick" class="zona-joystick"><div id="joy-base" class="joy-base"><div id="joy-pino" class="joy-pino"></div></div></div>
      <div class="botoes">
        <button id="btn-super" class="btn super" aria-label="Supernova" hidden>${ICONES.estrelaSuper}</button>
        <button id="btn-ativa" class="btn ativa" aria-label="Habilidade"><span class="ic"></span><span class="anel"></span></button>
        <button id="btn-atacar" class="btn atacar" aria-label="Mirar e atacar"><span id="mira-pino" class="ic"></span><span class="anel"></span></button>
      </div>
      <p class="teclas"><kbd>WASD</kbd> <kbd>mouse</kbd> <kbd>E</kbd> <kbd>R</kbd></p>
      <canvas id="minimapa" class="minimapa" aria-hidden="true"></canvas>
      <div id="trocar" class="trocar" hidden></div>
      <div id="espectador" class="espectador" hidden>${ICONES.olho}<span></span></div>
      <button id="btn-som" class="btn-som" aria-label="Som">${estaMudo() ? ICONES.mudo : ICONES.som}</button>
      <div id="fim" class="fim" hidden></div>
    </div>`;
}

let ultimoHud = '';
let ultimoAtaque = -1;
function atualizarHud(s: LutadorSnap | null, contagem: number, ataque: number, placar: Placar | null = null): void {
  // mata-mata em equipe: enquanto espera para renascer, dá para trocar de personagem
  const troca = document.getElementById('trocar');
  if (troca) {
    const mostrar = !!s && !s.vivo && MODOS_TROCA.includes(placar?.modo as ModoJogo);
    if (mostrar && troca.hidden) {
      troca.hidden = false;
      troca.innerHTML = `<div class="grade">${LISTA_PERSONAGENS.map(
        (p) => `<button data-trocar="${p.id}" style="--cor:${p.cor}" class="${p.id === s!.personagem ? 'meu' : ''}" title="${esc(p.nome)}"><span class="silhueta"></span><small>${esc(p.nome)}</small></button>`,
      ).join('')}</div>`;
      troca.querySelectorAll<HTMLButtonElement>('[data-trocar]').forEach((b) =>
        b.addEventListener('click', () => {
          conexao.socket.emit('jogo:personagem', { personagem: b.dataset.trocar as IdPersonagem });
          troca.querySelectorAll('.meu').forEach((x) => x.classList.remove('meu'));
          b.classList.add('meu');
        }),
      );
    } else if (!mostrar && !troca.hidden) troca.hidden = true;
  }
  // anel de recarga do ataque (a cada quadro, mas só mexe no DOM quando muda)
  const f = Math.round(ataque * 40) / 40;
  if (f !== ultimoAtaque) {
    ultimoAtaque = f;
    const b = document.getElementById('btn-atacar');
    b?.style.setProperty('--f', String(f));
    b?.classList.toggle('pronta', f >= 1);
  }
  const c = document.getElementById('contagem');
  if (c) {
    const txt = contagem > 0 ? String(contagem) : '';
    if (c.textContent !== txt) c.textContent = txt;
  }
  if (!s) return;
  const sup = document.getElementById('btn-super');
  if (sup) {
    const tem = s.vivo && s.estados.includes('temSupernova');
    if (sup.hidden === tem) sup.hidden = !tem;
  }
  const p = PERSONAGENS[s.personagem];
  const melhor = placar ? Math.max(0, ...placar.pontos.filter((x) => x.id !== s.id).map((x) => x.pontos)) : 0;
  const pe = placar?.pontosEquipe ? placar.pontosEquipe.join('x') : '';
  const relogio =
    placar?.tempoRestante !== undefined
      ? `<span class="relogio">${ICONES.relogio}${Math.floor(placar.tempoRestante / 60000)}:${String(Math.floor((placar.tempoRestante % 60000) / 1000)).padStart(2, '0')}</span>`
      : '';
  const chave = `${s.vida}|${s.recargaAtiva > 0 ? Math.ceil(s.recargaAtiva / 1000) : 0}|${s.protegido}|${s.forca}|${s.vivo}|${s.personagem}|${s.pontos}|${melhor}|${pe}|${relogio}`;
  if (chave === ultimoHud) return;
  ultimoHud = chave;
  const vida = document.getElementById('vida');
  if (vida) {
    vida.style.setProperty('--cor', p.cor);
    (vida.querySelector('.barra') as HTMLElement).style.width = `${(s.vida / (s.vidaMax || CONFIG.vida.maxima)) * 100}%`;
    vida.querySelector('span')!.innerHTML = `${ICONES.coracao}${s.vida}${s.protegido ? ` ${ICONES.escudo}` : ''}${s.forca ? ` ${ICONES.raio}` : ''}`;
  }
  const ativa = document.getElementById('btn-ativa');
  if (ativa) {
    ativa.style.setProperty('--cor', p.cor);
    const seg = Math.ceil(s.recargaAtiva / 1000);
    ativa.querySelector('.ic')!.innerHTML = seg > 0 ? `<b>${seg}</b>` : ICONE_ATIVA[s.personagem];
    ativa.classList.toggle('pronta', seg === 0);
    (ativa.querySelector('.anel') as HTMLElement).style.setProperty('--f', String(1 - s.recargaAtiva / (p.ativa.recarga * 1000)));
  }
  const atq = document.getElementById('mira-pino');
  if (atq && atq.dataset.p !== s.personagem) {
    // na corrida armada o personagem muda a cada abate
    atq.innerHTML = ICONE_ARMA[s.personagem];
    atq.dataset.p = s.personagem;
  }
  const pl = document.getElementById('placar');
  const pintao = placar?.modo === 'pintao' || placar?.modo === 'pintaoEquipe';
  const fmt = (n: number) => {
    if (!pintao || !placar) return String(n);
    const pct = (n / Math.max(1, placar.meta)) * 100;
    return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  };
  if (pl && placar && pintao && !placar.pontosEquipe) {
    pl.hidden = false;
    pl.innerHTML = `${ICONE_MODO.pintao}<b>${fmt(s.pontos)}</b><span class="rival">${ICONES.trofeu}${fmt(melhor)}</span>${relogio}`;
  } else if (pl && placar && placar.pontosEquipe && placar.coresEquipe && pintao) {
    pl.hidden = false;
    const [a, b] = placar.pontosEquipe;
    const [ca, cb] = placar.coresEquipe;
    pl.innerHTML = `<i class="eq" style="--c:${ca}"></i><b>${fmt(a)}</b><small>×</small><b>${fmt(b)}</b><i class="eq" style="--c:${cb}"></i>${relogio}`;
  } else if (pl && placar && placar.pontosEquipe && placar.coresEquipe) {
    pl.hidden = false;
    const [a, b] = placar.pontosEquipe;
    const [ca, cb] = placar.coresEquipe;
    pl.innerHTML = `<i class="eq" style="--c:${ca}"></i><b>${a}</b><small>×</small><b>${b}</b><i class="eq" style="--c:${cb}"></i><small>/${placar.meta}</small>${relogio}`;
  } else if (pl && placar && placar.modo !== 'royale' && placar.modo !== 'neoncalypse') {
    pl.hidden = false;
    pl.innerHTML = `${ICONE_MODO[placar.modo as ModoJogo]}<b>${s.pontos}</b><small>/${placar.meta}</small><span class="rival">${ICONES.trofeu}${melhor}</span>${relogio}`;
  }
  document.getElementById('btn-atacar')?.style.setProperty('--cor', p.cor);
}

function mostrarFim(): void {
  const el = document.getElementById('fim');
  if (!el || !st.fim || !st.sala) return;
  let ganhei: boolean;
  let cor: string;
  let nome: string;
  if (st.fim.equipe !== undefined) {
    ganhei = eu()?.equipe === st.fim.equipe;
    cor = st.sala.coresEquipe[st.fim.equipe] ?? '#e8ecf3';
    nome = st.sala.jogadores.filter((j) => j.equipe === st.fim!.equipe).map((j) => j.apelido).join(' · ');
  } else {
    const v = st.sala.jogadores.find((j) => j.id === st.fim!.vencedorId);
    ganhei = v?.id === meuId();
    cor = v?.personagem ? PERSONAGENS[v.personagem].cor : '#e8ecf3';
    nome = v ? v.apelido : '—';
  }
  tocar(ganhei ? 'vitoria' : 'derrota');
  el.hidden = false;
  el.innerHTML = `<div class="resultado" style="--cor:${cor}">${ganhei ? ICONES.trofeu : ICONES.caveira}<strong>${esc(nome)}</strong></div>`;
}

// ------------------------------------------------------------------ eventos

function ligar(): void {
  raiz.querySelectorAll<HTMLElement>('[data-ir]').forEach((b) =>
    b.addEventListener('click', () => {
      st.aviso = null;
      ir(b.dataset.ir as Tela);
    }),
  );
  const form = document.getElementById('form') as HTMLFormElement | null;
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(form);
    const apelido = String(d.get('apelido') ?? '').trim();
    salvarPreferencias({ apelido });
    const r = st.tela === 'criar' ? await conexao.criar(apelido) : await conexao.entrar(String(d.get('codigo') ?? ''), apelido);
    if (!r.ok) {
      st.aviso = r.erro.mensagem;
      render();
    } else st.aviso = null;
  });
  if (st.tela === 'lobby') {
    document.getElementById('copiar')?.addEventListener('click', () => void copiarTexto(st.sala!.codigo, document.getElementById('codigo')));
    raiz.querySelectorAll<HTMLButtonElement>('[data-personagem]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.personagem as IdPersonagem;
        const r = await conexao.enviar('lobby:personagem', { personagem: eu()?.personagem === id ? null : id });
        if (!r.ok) {
          st.aviso = r.erro.mensagem;
          render();
        }
      }),
    );
    raiz.querySelectorAll<HTMLButtonElement>('[data-expulsar]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!window.confirm(`Expulsar ${b.dataset.nome ?? 'este jogador'} da sala?`)) return;
        const r = await conexao.enviar('sala:expulsar', { jogadorId: b.dataset.expulsar! });
        if (!r.ok) {
          st.aviso = r.erro.mensagem;
          render();
        }
      }),
    );
    raiz.querySelectorAll<HTMLButtonElement>('[data-etapa]').forEach((b) =>
      b.addEventListener('click', () => {
        st.etapa = b.dataset.etapa as 'modo' | 'mapa' | 'times' | 'personagem';
        render();
      }),
    );
    raiz.querySelectorAll<HTMLButtonElement>('[data-equipe]').forEach((b) =>
      b.addEventListener('click', () => void conexao.enviar('lobby:equipe', { equipe: Number(b.dataset.equipe) })),
    );
    raiz.querySelectorAll<HTMLButtonElement>('[data-cor]').forEach((b) =>
      b.addEventListener('click', () => void conexao.enviar('lobby:corEquipe', { cor: b.dataset.cor! })),
    );
    raiz.querySelectorAll<HTMLButtonElement>('[data-modo]').forEach((b) =>
      b.addEventListener('click', () => void conexao.enviar('lobby:modo', { modo: b.dataset.modo as ModoJogo })),
    );
    raiz.querySelectorAll<HTMLButtonElement>('[data-mapa]').forEach((b) =>
      b.addEventListener('click', () => void conexao.enviar('lobby:mapa', { mapa: b.dataset.mapa as IdMapa })),
    );
    document.getElementById('pronto')?.addEventListener('click', () => void conexao.enviar('lobby:pronto', { pronto: !eu()?.pronto }));
    document.getElementById('iniciar')?.addEventListener('click', async () => {
      const r = await conexao.enviar('lobby:iniciar', {});
      if (!r.ok) {
        st.aviso = r.erro.mensagem;
        render();
      }
    });
    document.getElementById('sair')?.addEventListener('click', () => void conexao.sair());
  }
  if (st.tela === 'partida') {
    entrada?.destruir();
    mira?.destruir();
    const ativa = () => arena()?.usarAtiva();
    entrada = new Entrada(
      document.getElementById('zona-joystick')!,
      document.getElementById('joy-base')!,
      document.getElementById('joy-pino')!,
      ativa,
      () => {},
      () => arena()?.atacar(),
      ativa,
    );
    document.getElementById('btn-super')?.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      arena()?.ativarSupernova();
    });
    document.getElementById('btn-som')?.addEventListener('click', (ev) => {
      const b = ev.currentTarget as HTMLElement;
      b.innerHTML = alternarMudo() ? ICONES.mudo : ICONES.som;
    });
    mira = new MiraToque(document.getElementById('btn-atacar')!, document.getElementById('mira-pino')!, () => arena()?.atacar());
    document.getElementById('btn-ativa')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ativa();
    });
    ultimoHud = '';
  }
}
