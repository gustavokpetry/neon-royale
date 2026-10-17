/**
 * Arena: desenho neon minimalista (tudo vetorial, sem imagens), previsão do próprio movimento
 * com reaplicação dos comandos pendentes, interpolação dos outros, projéteis e efeitos.
 */
import Phaser from 'phaser';
import { tocar, type Som } from '../audio/som';
import type { Socket } from 'socket.io-client';
import { CONFIG } from '@shared/config';
import { ESTEIRAS, T, copiaDoMapa, type Mapa } from '@shared/mapa';
import { aplicarMovimento, fatorTinta, fatorVelocidade, terrenoMove, type Poca, type Vel } from '@shared/movimento';
import { HABILIDADES, PERSONAGENS, type IdPersonagem } from '@shared/personagens';
const ARCO_ESCUDO = (HABILIDADES.escudo.arcoGraus * Math.PI) / 180;
import { CASA_PINTURA, type Efeito, type EntidadeSnap, type EventosClienteServidor, type EventosServidorCliente, type LutadorSnap, type Snapshot } from '@shared/protocolo';

/** Placar e regras do modo, para o HUD. */
export interface Placar {
  modo: string;
  meta: number;
  pontos: Array<{ id: string; pontos: number }>;
  pontosEquipe?: [number, number];
  coresEquipe?: [string, string];
  tempoRestante?: number;
}

export interface ContextoArena {
  socket: Socket<EventosServidorCliente, EventosClienteServidor>;
  meuId: string;
  mapa: Mapa;
  /** Personagem, apelido, vaga e equipe de cada jogador. */
  personagens: Record<string, { personagem: IdPersonagem; apelido: string; vaga: number; equipe?: number }>;
  /** Cores das equipes (modos em equipe). */
  coresEquipe?: [string, string];
  lerMovimento: () => { x: number; y: number };
  lerMira: () => { x: number; y: number; ativo: boolean; atirando: boolean } | null;
  /** Estado do próprio jogador; `ataque` = fração da recarga do ataque já cumprida (0–1); `placar` = modo, meta e pontos. */
  aoEstado: (eu: LutadorSnap | null, contagem: number, ataque: number, placar: Placar | null) => void;
}

interface Visual {
  id: string;
  personagem: IdPersonagem;
  cor: number;
  container: Phaser.GameObjects.Container;
  corpo: Phaser.GameObjects.Graphics;
  barra: Phaser.GameObjects.Graphics;
  buffer: Array<{ t: number; x: number; y: number }>;
  snap: LutadorSnap | null;
}

const R = CONFIG.movimento.raioJogador;
const DT = CONFIG.movimento.dtComando;
const ATRASO = 110;
const FUNDO = 0x0f1115;
const cor = (hex: string) => Phaser.Display.Color.HexStringToColor(hex).color;

export class Arena extends Phaser.Scene {
  private ctx!: ContextoArena;
  private visuais = new Map<string, Visual>();
  private projeteis = new Map<number, { g: Phaser.GameObjects.Graphics; x: number; y: number; vx: number; vy: number; t: number }>();
  private pickups = new Map<string, Phaser.GameObjects.Container>();
  private pocas: Poca[] = [];
  private visuaisPoca = new Map<number, Phaser.GameObjects.Graphics>();
  private mira!: Phaser.GameObjects.Graphics;
  private setas!: Phaser.GameObjects.Graphics;
  // previsão local
  private anterior = { x: 0, y: 0 };
  private atual = { x: 0, y: 0 };
  private desvio = { x: 0, y: 0 };
  private acumulador = 0;
  private seq = 0;
  private pendentes: Array<{ seq: number; x: number; y: number }> = [];
  private dirMira = { x: 1, y: 0 };
  /** Tiro carregado: desde quando o botão está segurado. */
  private cargaDesde = 0;
  private segurando = false;
  /** Coisas no mapa criadas por habilidades. */
  private entidades = new Map<number, { g: Phaser.GameObjects.Graphics; e: EntidadeSnap; visual?: Visual }>();
  private angMira = 0;
  /** No celular, a última direção mirada vale por um tempo depois de soltar o botão. */
  private miraManualAte = 0;
  private ultimaDir = { x: 1, y: 0 };
  private mouseAtirando = false;
  private proximoTiro = 0;
  private inicio = Date.now() + 99999;
  private relogio = 0;
  private meuSnap: LutadorSnap | null = null;
  private placar: Placar | null = null;
  private zona: Phaser.GameObjects.Graphics | null = null;
  private controle: Phaser.GameObjects.Graphics | null = null;
  private supernova: { x: number; y: number } | null = null;
  /** Mini mapa: o desenho fixo do mapa e a posição do próprio jogador. */
  private mini: { ctx: CanvasRenderingContext2D; base: HTMLCanvasElement; escala: number; dpr: number; ultimo: number } | null = null;
  private orbe: Phaser.GameObjects.Graphics | null = null;
  /** Pintão: 1 pixel por casa, ampliado na tela. */
  private pinturaTex: Phaser.Textures.CanvasTexture | null = null;
  private pinturaDono: Uint8Array | null = null;
  /** Voo previsto no aparelho logo depois de apertar (até o servidor confirmar). */
  private vooLocalAte = 0;
  private ultimaContagem = 99;
  /** Velocidade prevista (gelo). */
  private vel: Vel = { vx: 0, vy: 0 };
  /** Apagão: camada de escuridão (em resolução baixa, ampliada). */
  private escuridao: { tex: Phaser.Textures.CanvasTexture; img: Phaser.GameObjects.Image } | null = null;
  /** Equipes (modos em equipe): equipe de cada jogador e cores. */
  private equipeDe = new Map<string, number>();
  private coresEquipe: [string, string] | null = null;
  /** Espectador (modos sem renascimento): quem a câmera segue, ou câmera livre. */
  private espectando: string | null = null;
  private camLivre = false;
  private seguindo: string | null = null;

  constructor() {
    super('arena');
  }

  init(ctx: ContextoArena): void {
    this.ctx = ctx;
    const eu = ctx.personagens[ctx.meuId];
    ctx.mapa = copiaDoMapa(ctx.mapa);
    this.equipeDe = new Map(Object.entries(ctx.personagens).filter(([, p]) => p.equipe !== undefined).map(([id, p]) => [id, p.equipe!]));
    this.coresEquipe = ctx.coresEquipe ?? null;
    const ini = eu ? ctx.mapa.nascimentos[eu.vaga] ?? ctx.mapa.nascimentos[0]! : { x: ctx.mapa.largura / 2, y: ctx.mapa.altura / 2 };
    this.anterior = { ...ini };
    this.atual = { ...ini };
    this.pendentes = [];
    this.visuais.clear();
    this.projeteis.clear();
    this.pickups.clear();
    this.pocas = [];
    this.visuaisPoca.clear();
  }

  create(): void {
    this.cameras.main.setBackgroundColor(FUNDO);
    this.desenharArena();
    this.mira = this.add.graphics().setDepth(5);
    this.prepararMiniMapa();
    this.setas = this.add.graphics().setDepth(90);
    for (const [id, info] of Object.entries(this.ctx.personagens)) this.criarVisual(id, info.personagem);
    const cam = this.cameras.main;
    cam.setBounds(-200, -200, this.ctx.mapa.largura + 400, this.ctx.mapa.altura + 400);
    const meu = this.visuais.get(this.ctx.meuId);
    if (meu) cam.startFollow(meu.container, true, 0.14, 0.14);
    this.ajustarZoom();
    this.scale.on('resize', this.ajustarZoom, this);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch || p.button !== 0) return;
      this.mouseAtirando = true;
      if (!this.carregavel()) this.atacar();
    });
    this.input.keyboard?.on('keydown-R', () => this.ativarSupernova());
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) this.mouseAtirando = false;
    });

    const s = this.ctx.socket;
    const onSnap = (x: Snapshot) => this.aplicarSnapshot(x);
    const onEfeito = (e: Efeito) => this.mostrarEfeito(e);
    s.on('jogo:snapshot', onSnap);
    s.on('jogo:efeito', onEfeito);
    const desligar = () => {
      s.off('jogo:snapshot', onSnap);
      s.off('jogo:efeito', onEfeito);
      this.scale.off('resize', this.ajustarZoom, this);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, desligar);
    this.events.once(Phaser.Scenes.Events.DESTROY, desligar);
  }

  private ajustarZoom(): void {
    const { width, height } = this.scale;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // ~560 px de arena no menor lado da tela
    this.cameras.main.setZoom(Phaser.Math.Clamp(Math.min(width, height) / 560, 0.6 * dpr, 2.2 * dpr));
  }

  // ------------------------------------------------------------------ cenário

  private desenharArena(): void {
    const m = this.ctx.mapa;
    const L = m.largura;
    const A = m.altura;
    const g = this.add.graphics().setDepth(-10);
    // pisos das áreas (só visual)
    for (const z of m.zonas) g.fillStyle(cor(z.cor), 1).fillRect(z.x, z.y, z.w, z.h);
    // grade sutil
    g.lineStyle(1, 0x1a1d24, 1);
    for (let x = 0; x <= L; x += 64) g.lineBetween(x, 0, x, A);
    for (let y = 0; y <= A; y += 64) g.lineBetween(0, y, L, y);
    // borda
    g.lineStyle(6, 0x2a2f3a, 1).strokeRect(8, 8, L - 16, A - 16);
    g.lineStyle(2, 0x5a6478, 0.6).strokeRect(8, 8, L - 16, A - 16);
    // linhas de simetria bem discretas e o círculo do centro
    g.lineStyle(1, 0x232833, 1).lineBetween(L / 2, 0, L / 2, A).lineBetween(0, A / 2, L, A / 2);
    g.lineStyle(2, 0x2a3040, 1).strokeCircle(L / 2, A / 2, 160);
    // áreas seguras: brilho na cor do dono
    const ocupantes = Object.values(this.ctx.personagens);
    for (const a of m.areas) {
      const quem = ocupantes.find((o) => o.vaga === a.vaga);
      if (!quem) {
        g.lineStyle(1, 0x2a3040, 1).strokeCircle(a.x, a.y, a.raio);
        continue;
      }
      const c = quem.equipe !== undefined && this.ctx.coresEquipe ? cor(this.ctx.coresEquipe[quem.equipe]!) : cor(PERSONAGENS[quem.personagem].cor);
      g.fillStyle(c, 0.06).fillCircle(a.x, a.y, a.raio);
      g.lineStyle(12, c, 0.08).strokeCircle(a.x, a.y, a.raio);
      g.lineStyle(2, c, 0.85).strokeCircle(a.x, a.y, a.raio);
    }
    // chãos especiais: lama, gelo, esteiras e abismo
    for (const o of m.obstaculos) {
      if (o.tipo === T.LAMA) {
        g.fillStyle(0x2a2216, 1).fillRect(o.x, o.y, o.w, o.h);
        for (let k = 0; k < (o.w * o.h) / 1800; k++) g.fillStyle(0x3a3020, 1).fillCircle(o.x + ((k * 97) % o.w), o.y + ((k * 53) % o.h), 5);
      } else if (o.tipo === T.GELO) {
        g.fillStyle(0x16303d, 1).fillRect(o.x, o.y, o.w, o.h);
        for (let y = o.y + 6; y < o.y + o.h; y += 22) g.lineStyle(1, 0x9fe6ff, 0.18).lineBetween(o.x, y, o.x + Math.min(o.w, 60), y + 30);
      } else if (ESTEIRAS[o.tipo]) {
        const [ex, ey] = ESTEIRAS[o.tipo]!;
        g.fillStyle(0x1e2128, 1).fillRect(o.x, o.y, o.w, o.h);
        g.lineStyle(1, 0x3a4152, 1).strokeRect(o.x, o.y, o.w, o.h);
        for (let k = 8; k < (ex ? o.w : o.h); k += 24) {
          const cx = ex ? o.x + k : o.x + o.w / 2;
          const cy = ey ? o.y + k : o.y + o.h / 2;
          g.lineStyle(2, 0xffd21f, 0.45).lineBetween(cx - ex * 5 - ey * 5, cy - ey * 5 - ex * 5, cx, cy).lineBetween(cx, cy, cx - ex * 5 + ey * 5, cy - ey * 5 + ex * 5);
        }
      } else if (o.tipo === T.ABISMO) {
        g.fillStyle(0x000000, 1).fillRect(o.x, o.y, o.w, o.h);
        g.lineStyle(3, 0x8a5cff, 0.6).strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
        g.lineStyle(10, 0x8a5cff, 0.12).strokeRect(o.x + 5, o.y + 5, o.w - 10, o.h - 10);
      }
    }
    // portais (par com a mesma cor) e trampolins (seta até o destino)
    const coresPortal = [0xc9b8ff, 0x7ff3ff, 0xffb3c7, 0xa6ff2e];
    m.portais.forEach((p, i) => {
      const c = coresPortal[i % coresPortal.length]!;
      for (const q of [p.a, p.b]) {
        g.fillStyle(c, 0.15).fillCircle(q.x, q.y, 26);
        g.lineStyle(3, c, 0.9).strokeCircle(q.x, q.y, 22);
        g.lineStyle(1.5, c, 0.6).strokeCircle(q.x, q.y, 14);
      }
    });
    for (const tr of m.trampolins) {
      g.fillStyle(0x3cf0ff, 0.15).fillCircle(tr.x, tr.y, 22);
      g.lineStyle(3, 0x3cf0ff, 0.9).strokeCircle(tr.x, tr.y, 18);
      const ang = Math.atan2(tr.destino.y - tr.y, tr.destino.x - tr.x);
      g.lineStyle(2, 0x3cf0ff, 0.6).lineBetween(tr.x, tr.y, tr.x + Math.cos(ang) * 14, tr.y + Math.sin(ang) * 14);
      g.lineStyle(1, 0x3cf0ff, 0.25).strokeCircle(tr.destino.x, tr.destino.y, 14);
    }
    // mato: por cima dos personagens (esconde quem está dentro)
    const mato = this.add.graphics().setDepth(15);
    for (const o of m.obstaculos) {
      if (o.tipo !== T.MATO) continue;
      mato.fillStyle(0x1c4a24, 0.82).fillRoundedRect(o.x, o.y, o.w, o.h, 12);
      for (let k = 0; k < (o.w * o.h) / 900; k++) mato.fillStyle(0x2f7a3a, 0.9).fillCircle(o.x + 10 + ((k * 71) % Math.max(1, o.w - 20)), o.y + 10 + ((k * 37) % Math.max(1, o.h - 20)), 9);
    }
    // água: para o movimento, tiros passam por cima
    for (const o of m.obstaculos) {
      if (o.tipo !== 3) continue;
      g.fillStyle(0x0d2432, 1).fillRect(o.x, o.y, o.w, o.h);
      g.lineStyle(2, 0x2f8fb8, 0.7).strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      for (let y = o.y + 10; y < o.y + o.h - 4; y += 14) g.lineStyle(1, 0x1f5f7c, 0.8).lineBetween(o.x + 6, y, o.x + o.w - 6, y);
    }
    // lava: dá para andar, mas queima
    for (const o of m.obstaculos) {
      if (o.tipo !== 4) continue;
      // faixas finas (lagos montados por linhas) viram uma superfície contínua: sem borda interna
      g.fillStyle(0x3a0c06, 1).fillRect(o.x, o.y, o.w, o.h);
      const borda = o.h >= 32 && o.w >= 32 ? 3 : 0;
      g.fillStyle(0xff4d1a, 0.25).fillRect(o.x + borda, o.y + borda, o.w - 2 * borda, o.h - 2 * borda);
      // ondas alinhadas ao mundo (contínuas entre faixas vizinhas)
      for (let y = Math.ceil(o.y / 48) * 48 + 8; y < o.y + o.h; y += 48) {
        for (let x = Math.ceil(o.x / 64) * 64; x < o.x + o.w - 20; x += 64) g.lineStyle(2, 0xff8a1f, 0.35).lineBetween(x, y, x + 20, y + 3);
      }
    }
    // obstáculos (altos) e muretas (mais baixas e claras); os dois param tudo
    for (const o of m.obstaculos) {
      if (o.tipo !== 1 && o.tipo !== 2) continue;
      const mureta = o.tipo === 2;
      g.fillStyle(0x000000, 0.35).fillRect(o.x + 4, o.y + 5, o.w, o.h);
      g.fillStyle(mureta ? 0x232833 : 0x1c2029, 1).fillRect(o.x, o.y, o.w, o.h);
      g.lineStyle(2, mureta ? 0x8a97b0 : 0x6b7894, mureta ? 0.45 : 0.55).strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    }
    // pickups
    for (const p of m.pickups) {
      const ic = this.add.graphics();
      const c = p.tipo === 'vida' ? 0xe8ecf3 : 0xc9b8ff;
      ic.lineStyle(10, c, 0.15).strokeCircle(0, 0, 13);
      ic.lineStyle(2, c, 1);
      if (p.tipo === 'vida') {
        ic.fillStyle(c, 1).fillRect(-3, -9, 6, 18).fillRect(-9, -3, 18, 6);
      } else {
        ic.fillStyle(c, 1).fillPoints([{ x: 0, y: -11 }, { x: 9, y: 0 }, { x: 0, y: 11 }, { x: -9, y: 0 }], true);
      }
      const ct = this.add.container(p.x, p.y, [ic]).setDepth(2);
      this.tweens.add({ targets: ic, alpha: 0.55, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
      this.pickups.set(p.id, ct);
    }
  }

  private criarVisual(id: string, personagem: IdPersonagem): void {
    const c = cor(PERSONAGENS[personagem].cor);
    const corpo = this.add.graphics();
    const barra = this.add.graphics();
    const nome = this.add
      .text(0, -30, this.ctx.personagens[id]?.apelido ?? '', { fontFamily: 'system-ui, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#e8ecf3' })
      .setOrigin(0.5, 1)
      .setResolution(3)
      .setAlpha(0.8);
    const ini = this.ctx.mapa.nascimentos[this.ctx.personagens[id]?.vaga ?? 0] ?? this.ctx.mapa.nascimentos[0]!;
    const container = this.add.container(ini.x, ini.y, [corpo, barra, nome]).setDepth(10);
    this.visuais.set(id, { id, personagem, cor: c, container, corpo, barra, buffer: [{ t: 0, x: ini.x, y: ini.y }], snap: null });
  }

  /** Silhueta preta com contorno neon e a arma apontando para a mira. */
  private desenharCorpo(v: Visual, ax: number, ay: number, agora: number): void {
    const g = v.corpo;
    const s = v.snap;
    g.clear();
    const vivo = s?.vivo ?? true;
    const pulso = 0.5 + 0.5 * Math.sin(agora / 160);
    if (s?.voando) {
      // sombra no chão e o corpo "sobe" um pouco
      g.fillStyle(0x000000, 0.45).fillEllipse(0, 14, 26, 10);
      v.corpo.setScale(1.25).setY(-10);
    } else v.corpo.setScale(1).setY(0);
    g.lineStyle(10, v.cor, vivo ? 0.18 : 0.05).strokeCircle(0, 0, R + 2);
    g.fillStyle(0x000000, 1).fillCircle(0, 0, R);
    g.lineStyle(2.5, v.cor, vivo ? 1 : 0.3).strokeCircle(0, 0, R);
    if (!vivo) return;
    const ang = Math.atan2(ay, ax);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    if (v.personagem === 'veni') {
      // arco
      g.lineStyle(2.5, v.cor, 1);
      g.beginPath();
      g.arc(ca * 6, sa * 6, 13, ang - 1.1, ang + 1.1, false);
      g.strokePath();
      g.lineStyle(1, 0xffffff, 0.7).lineBetween(ca * 6 + Math.cos(ang - 1.1) * 13, sa * 6 + Math.sin(ang - 1.1) * 13, ca * 6 + Math.cos(ang + 1.1) * 13, sa * 6 + Math.sin(ang + 1.1) * 13);
      if (s?.preparada) g.lineStyle(2, 0xffa23a, 0.6 + 0.4 * pulso).strokeCircle(0, 0, R + 6);
    } else if (v.personagem === 'daniel') {
      if ((s?.escudo ?? 0) > 0) {
        // escudo: guarda-chuva aberto à frente
        const rr = HABILIDADES.escudo.raio;
        g.lineStyle(12, v.cor, 0.18).beginPath().arc(0, 0, rr, ang - ARCO_ESCUDO, ang + ARCO_ESCUDO, false).strokePath();
        g.lineStyle(4, v.cor, 1).beginPath().arc(0, 0, rr, ang - ARCO_ESCUDO, ang + ARCO_ESCUDO, false).strokePath();
        for (const k of [-1, -0.5, 0, 0.5, 1]) {
          const a2 = ang + k * ARCO_ESCUDO;
          g.lineStyle(1.5, v.cor, 0.7).lineBetween(ca * 4, sa * 4, Math.cos(a2) * rr, Math.sin(a2) * rr);
        }
      } else {
        // guarda-chuva fechado, como uma lança curta
        g.lineStyle(3, v.cor, 1).lineBetween(-ca * 4, -sa * 4, ca * 30, sa * 30);
        g.lineStyle(5, v.cor, 0.9).lineBetween(ca * 12, sa * 12, ca * 22, sa * 22);
        g.lineStyle(2, 0xc9d2e0, 0.9).beginPath().arc(-ca * 4 - sa * 3, -sa * 4 + ca * 3, 3, ang, ang + Math.PI, false).strokePath();
      }
      if (s?.rapido) g.lineStyle(2, v.cor, 0.5 + 0.5 * pulso).lineBetween(-ca * 16 - sa * 6, -sa * 16 + ca * 6, -ca * 26 - sa * 6, -sa * 26 + ca * 6).lineBetween(-ca * 16 + sa * 6, -sa * 16 - ca * 6, -ca * 26 + sa * 6, -sa * 26 - ca * 6);
    } else if (v.personagem === 'pacheco') {
      g.lineStyle(4, 0x2a7f8c, 1).lineBetween(-ca * 6 - sa * 6, -sa * 6 + ca * 6, ca * 10, sa * 10);
      g.lineStyle(3, v.cor, 1).lineBetween(ca * 10, sa * 10, ca * 22, sa * 22);
      g.fillStyle(v.cor, 0.7 + 0.3 * pulso).fillCircle(ca * 23, sa * 23, 2.5);
    } else if (v.personagem === 'lucas') {
      // faíscas elétricas girando em volta
      for (let k = 0; k < 3; k++) {
        const a0 = agora / 220 + (k * Math.PI * 2) / 3;
        const x0 = Math.cos(a0) * (R + 3);
        const y0 = Math.sin(a0) * (R + 3);
        const x1 = Math.cos(a0 + 0.35) * (R + 9);
        const y1 = Math.sin(a0 + 0.35) * (R + 9);
        g.lineStyle(2, v.cor, 0.6 + 0.4 * pulso).lineBetween(x0, y0, (x0 + x1) / 2 + 3, (y0 + y1) / 2 - 2).lineBetween((x0 + x1) / 2 + 3, (y0 + y1) / 2 - 2, x1, y1);
      }
    } else if (v.personagem === 'vini') {
      // canhão de tinta
      g.lineStyle(9, 0x9aa3b5, 1).lineBetween(ca * 6, sa * 6, ca * 24, sa * 24);
      g.lineStyle(6, v.cor, 1).lineBetween(ca * 6, sa * 6, ca * 24, sa * 24);
      g.fillStyle(v.cor, 0.8 + 0.2 * pulso).fillCircle(ca * 25, sa * 25, 3.5);
    } else if (v.personagem === 'gut') {
      // espada de fogo
      g.lineStyle(7, 0xff4d24, 0.25 + 0.15 * pulso).lineBetween(ca * 10, sa * 10, ca * 30, sa * 30);
      g.lineStyle(3, v.cor, 1).lineBetween(ca * 10, sa * 10, ca * 30, sa * 30);
      g.lineStyle(3, 0xffffff, 0.8).lineBetween(ca * 8 - sa * 5, sa * 8 + ca * 5, ca * 8 + sa * 5, sa * 8 - ca * 5);
    } else {
      this.desenharArmaGenerica(g, v, ca, sa);
    }
    this.desenharMarca(g, v);
    this.desenharEstados(g, v, agora, pulso);
    if (s?.protegido) g.lineStyle(1.5, 0x9fb0c8, 0.35 + 0.35 * pulso).strokeCircle(0, 0, R + 9);
    if (s?.forca) g.lineStyle(2, 0xb46bff, 0.5 + 0.5 * pulso).strokeCircle(0, 0, R + 4);
    if (s?.chocado) {
      const cz = cor(PERSONAGENS.lucas.cor);
      g.lineStyle(2, cz, 0.8).lineBetween(-6, -R - 4, -2, -R - 8).lineBetween(-2, -R - 8, 2, -R - 4).lineBetween(2, -R - 4, 6, -R - 8);
    }
    if (s?.queimando) g.fillStyle(0xff4d24, 0.5 + 0.4 * pulso).fillCircle(Math.sin(agora / 90) * 4, -R - 2, 3);
  }

  /** Arma dos personagens novos: cano (projétil), lâmina (corpo a corpo) ou faíscas (aura). */
  private desenharArmaGenerica(g: Phaser.GameObjects.Graphics, v: Visual, ca: number, sa: number): void {
    const a = PERSONAGENS[v.personagem].arma;
    if (a.tipo === 'corpo') {
      const largo = (a.arcoGraus ?? 30) > 50;
      g.lineStyle(3, v.cor, 1).lineBetween(ca * 6, sa * 6, ca * (8 + a.alcance * 0.33), sa * (8 + a.alcance * 0.33));
      if (largo) g.lineStyle(6, v.cor, 1).lineBetween(ca * 20 - sa * 6, sa * 20 + ca * 6, ca * 24 + sa * 2, sa * 24 - ca * 2);
      else g.lineStyle(2, 0xc9d2e0, 0.9).strokeCircle(ca * 27, sa * 27, 4);
      return;
    }
    const n = a.projeteis ?? 1;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 4;
      g.lineStyle(n > 1 ? 2.5 : 4, v.cor, 1).lineBetween(ca * 8 - sa * off, sa * 8 + ca * off, ca * 22 - sa * off, sa * 22 + ca * off);
    }
    g.fillStyle(0xc9d2e0, 0.8).fillCircle(ca * 23, sa * 23, 2);
  }

  /** Símbolo dentro da silhueta. */
  private desenharMarca(g: Phaser.GameObjects.Graphics, v: Visual): void {
    const m = PERSONAGENS[v.personagem].marca;
    const c = v.cor;
    switch (m) {
      case 'ponto':
        g.fillStyle(c, 1).fillCircle(0, 0, 3.5);
        break;
      case 'anel':
        g.lineStyle(2, c, 1).strokeCircle(0, 0, 5);
        break;
      case 'triangulo':
        g.fillStyle(c, 1).fillTriangle(0, -5, 4.5, 3.5, -4.5, 3.5);
        break;
      case 'quadrado':
        g.fillStyle(c, 1).fillRect(-3.5, -3.5, 7, 7);
        break;
      case 'losango':
        g.fillStyle(c, 1).fillPoints([{ x: 0, y: -5.5 }, { x: 4.5, y: 0 }, { x: 0, y: 5.5 }, { x: -4.5, y: 0 }], true);
        break;
      case 'cruz':
        g.fillStyle(c, 1).fillRect(-1.5, -5, 3, 10).fillRect(-5, -1.5, 10, 3);
        break;
      case 'xis':
        g.lineStyle(2.5, c, 1).lineBetween(-4, -4, 4, 4).lineBetween(-4, 4, 4, -4);
        break;
      case 'barra':
        g.fillStyle(c, 1).fillRect(-5, -1.5, 10, 3);
        break;
    }
  }

  /** Estados visíveis: congelado, preso, veneno, frio, sem habilidade, fúria, reflexo, laser, invisível. */
  private desenharEstados(g: Phaser.GameObjects.Graphics, v: Visual, agora: number, pulso: number): void {
    const est = v.snap?.estados ?? [];
    if (!est.length) {
      v.corpo.setAlpha(1);
      return;
    }
    v.corpo.setAlpha(est.includes('invisivel') ? 0.4 : 1);
    if (est.includes('congelado')) {
      g.fillStyle(0x9fe6ff, 0.35).fillCircle(0, 0, R + 5);
      g.lineStyle(2, 0xdff7ff, 1).strokeRect(-R - 4, -R - 4, (R + 4) * 2, (R + 4) * 2);
    }
    const frio = est.find((x) => x.startsWith('frio'));
    if (frio) g.lineStyle(1 + Number(frio.slice(4)), 0x9fe6ff, 0.6).strokeCircle(0, 0, R + 3);
    if (est.includes('preso')) {
      g.lineStyle(2, 0xd8c39a, 1).lineBetween(-R - 4, -R - 4, R + 4, R + 4).lineBetween(-R - 4, R + 4, R + 4, -R - 4);
    }
    if (est.includes('envenenado')) {
      for (let k = 0; k < 3; k++) g.fillStyle(0x4fd12c, 0.8).fillCircle(Math.sin(agora / 200 + k * 2) * 9, -R - 4 - ((agora / 15 + k * 7) % 10), 2);
    }
    if (est.includes('silenciado')) {
      g.lineStyle(2, 0xff6ec7, 1).strokeCircle(R + 4, -R - 4, 5).lineBetween(R + 1, -R - 1, R + 7, -R - 7);
    }
    if (est.includes('furia')) g.lineStyle(4, 0xb3122e, 0.4 + 0.4 * pulso).strokeCircle(0, 0, R + 6);
    if (est.includes('refletindo')) g.lineStyle(3, 0xe8f2ff, 0.6 + 0.4 * pulso).strokeCircle(0, 0, R + 7);
    if (est.includes('supernova')) {
      const cores = [0xff3d9a, 0xffd21f, 0x19d3e6, 0x9b5cff];
      for (let k = 0; k < 4; k++) {
        const a = agora / 120 + (k * Math.PI) / 2;
        g.lineStyle(3, cores[k]!, 0.9).beginPath().arc(0, 0, R + 8, a, a + 1.2, false).strokePath();
      }
    }
    if (est.includes('marcado')) {
      g.lineStyle(2, 0xff7f50, 1).strokeCircle(0, 0, R + 10);
      g.lineStyle(2, 0xff7f50, 1).lineBetween(0, -R - 14, 0, -R - 6).lineBetween(0, R + 6, 0, R + 14).lineBetween(-R - 14, 0, -R - 6, 0).lineBetween(R + 6, 0, R + 14, 0);
    }
    if (est.includes('cancao')) for (let k = 0; k < 3; k++) g.fillStyle(0xffb3c7, 0.8).fillCircle(Math.cos(agora / 150 + k * 2.1) * (R + 8), Math.sin(agora / 150 + k * 2.1) * (R + 8), 2.5);
    if (est.includes('sobrecarga')) g.lineStyle(2, 0xd7a6ff, 0.5 + 0.5 * pulso).strokeCircle(0, 0, R + 5);
    if (est.includes('laser')) g.lineStyle(1, 0xff3b3b, 0.7).lineBetween(0, 0, (v.snap?.ax ?? 1) * 120, (v.snap?.ay ?? 0) * 120);
  }

  /** Projétil de acordo com o estilo da arma. */
  private desenharProjetil(g: Phaser.GameObjects.Graphics, estilo: string, c: number, preparada: boolean): void {
    switch (estilo) {
      case 'gota':
        g.fillStyle(c, 0.25).fillCircle(0, 0, 5);
        g.fillStyle(c, 1).fillCircle(0, 0, 2.6);
        break;
      case 'tinta':
        g.fillStyle(c, 0.18).fillCircle(0, 0, 11);
        g.fillStyle(c, 1).fillEllipse(0, 0, 14, 10);
        g.fillStyle(c, 0.6).fillCircle(-9, 0, 3).fillCircle(-14, 1, 2);
        break;
      case 'flecha': {
        const quente = preparada ? 0xffa23a : c;
        g.lineStyle(8, quente, 0.25).lineBetween(-14, 0, 4, 0);
        g.lineStyle(2.5, quente, 1).lineBetween(-12, 0, 6, 0);
        g.fillStyle(0xd6dde8, 1).fillTriangle(6, -3, 11, 0, 6, 3);
        break;
      }
      case 'orbe':
        g.fillStyle(c, 0.2).fillCircle(0, 0, 13);
        g.fillStyle(c, 0.9).fillCircle(0, 0, 7);
        g.lineStyle(1.5, 0xffffff, 0.6).strokeCircle(0, 0, 10);
        break;
      case 'granada':
        g.fillStyle(0x000000, 0.35).fillEllipse(0, 9, 12, 5);
        g.fillStyle(c, 1).fillCircle(0, 0, 6);
        g.lineStyle(1.5, 0xffe08a, 1).lineBetween(3, -4, 6, -8);
        break;
      case 'bumerangue':
        g.lineStyle(4, c, 1).beginPath().arc(0, 0, 9, -1.2, 1.2, false).strokePath();
        break;
      case 'cristal':
        g.fillStyle(c, 0.3).fillCircle(0, 0, 8);
        g.fillStyle(c, 1).fillPoints([{ x: 8, y: 0 }, { x: 0, y: -4 }, { x: -8, y: 0 }, { x: 0, y: 4 }], true);
        break;
      case 'pulso':
        g.lineStyle(2, c, 1).strokeCircle(0, 0, 6);
        g.fillStyle(c, 0.6).fillCircle(0, 0, 3);
        break;
      case 'gancho':
        g.lineStyle(3, c, 1).lineBetween(-10, 0, 6, 0);
        g.lineStyle(3, c, 1).beginPath().arc(6, 4, 4, -Math.PI / 2, Math.PI / 2, false).strokePath();
        break;
      case 'pedra':
        g.fillStyle(c, 1).fillCircle(0, 0, 4.5);
        break;
      case 'shuriken':
        g.fillStyle(c, 1).fillPoints([{ x: 0, y: -7 }, { x: 2, y: -2 }, { x: 7, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 7 }, { x: -2, y: 2 }, { x: -7, y: 0 }, { x: -2, y: -2 }], true);
        break;
      case 'bola':
        g.fillStyle(0x000000, 0.4).fillCircle(2, 3, 8);
        g.fillStyle(c, 1).fillCircle(0, 0, 7);
        break;
      case 'bolha':
        g.lineStyle(2, c, 1).strokeCircle(0, 0, 7);
        g.fillStyle(c, 0.25).fillCircle(0, 0, 7);
        g.fillStyle(0xffffff, 0.8).fillCircle(-2, -2, 1.5);
        break;
      case 'nota':
        g.fillStyle(c, 1).fillCircle(-2, 3, 3.5);
        g.lineStyle(2, c, 1).lineBetween(1.5, 3, 1.5, -7).lineBetween(1.5, -7, 6, -5);
        break;
      case 'estrela':
        g.lineStyle(6, c, 0.25).lineBetween(-16, 0, 0, 0);
        g.fillStyle(c, 1).fillPoints([{ x: 0, y: -6 }, { x: 1.8, y: -1.8 }, { x: 6, y: 0 }, { x: 1.8, y: 1.8 }, { x: 0, y: 6 }, { x: -1.8, y: 1.8 }, { x: -6, y: 0 }, { x: -1.8, y: -1.8 }], true);
        break;
      case 'boleadeira':
        g.lineStyle(1.5, c, 0.8).lineBetween(-5, -5, 5, 5);
        g.fillStyle(c, 1).fillCircle(-5, -5, 3).fillCircle(5, 5, 3);
        break;
      case 'caco':
        g.fillStyle(c, 1).fillTriangle(6, 0, -4, -3, -2, 3);
        break;
      default:
        // bala, adaga, dardo, prego: traço fino com brilho
        g.lineStyle(6, c, 0.22).lineBetween(-10, 0, 4, 0);
        g.lineStyle(2, c, 1).lineBetween(-8, 0, 5, 0);
    }
  }

  /** Paredes, minas, drones, clones, totens, nuvens e buracos negros. */
  private atualizarEntidades(snap: Snapshot): void {
    const vistas = new Set<number>();
    const paredes = [];
    for (const e of snap.entidades) {
      vistas.add(e.id);
      if (e.tipo === 'parede') paredes.push({ x: e.x, y: e.y, w: e.w!, h: e.h!, tipo: 1 as const });
      let item = this.entidades.get(e.id);
      if (!item) {
        const g = this.add.graphics({ x: e.x, y: e.y }).setDepth(e.tipo === 'nuvem' || e.tipo === 'buraco' || e.tipo === 'totem' || e.tipo === 'mina' ? 2 : 9);
        item = { g, e };
        if (e.tipo === 'clone' && e.personagem) {
          // o clone é desenhado igual ao dono
          const corpo = this.add.graphics();
          const nome = this.add
            .text(0, -30, this.ctx.personagens[e.dono]?.apelido ?? '', { fontFamily: 'system-ui, sans-serif', fontSize: '10px', fontStyle: 'bold', color: '#e8ecf3' })
            .setOrigin(0.5, 1)
            .setResolution(3)
            .setAlpha(0.8);
          const barra = this.add.graphics();
          const container = this.add.container(e.x, e.y, [corpo, barra, nome]).setDepth(10);
          item.visual = { id: `clone${e.id}`, personagem: e.personagem, cor: cor(PERSONAGENS[e.personagem].cor), container, corpo, barra, buffer: [], snap: null };
        }
        this.entidades.set(e.id, item);
      }
      item.e = e;
      item.g.setPosition(e.x, e.y);
      if (item.visual) item.visual.container.setPosition(e.x, e.y);
    }
    for (const [id, item] of this.entidades) {
      if (vistas.has(id)) continue;
      item.g.destroy();
      item.visual?.container.destroy();
      this.entidades.delete(id);
    }
    // paredes temporárias valem também para a previsão do movimento
    this.ctx.mapa.paredesTemp = paredes;
  }

  /** Redesenha as entidades a cada quadro (algumas são animadas). */
  private desenharEntidades(agora: number): void {
    const pulso = 0.5 + 0.5 * Math.sin(agora / 160);
    for (const { g, e, visual } of this.entidades.values()) {
      const c = cor(PERSONAGENS[this.ctx.personagens[e.dono]?.personagem ?? 'veni'].cor);
      g.clear();
      const fim = e.tipo === 'meteoro' ? 1 : Math.min(1, e.restante / 600);
      switch (e.tipo) {
        case 'parede':
          if (e.estilo === 'prensa') {
            g.fillStyle(0x2a2414, 1).fillRect(0, 0, e.w!, e.h!);
            for (let k = 0; k < e.w! + e.h!; k += 16) g.lineStyle(5, 0xffd21f, 0.7).lineBetween(Math.max(0, k - e.h!), Math.min(e.h!, k), Math.min(e.w!, k), Math.max(0, k - e.w!));
            g.lineStyle(2, 0xffd21f, 1).strokeRect(0, 0, e.w!, e.h!);
            break;
          }
          if (e.estilo === 'muro') {
            const f = (e.vida ?? 1) / (e.vidaMax ?? 1);
            g.fillStyle(0x262b36, 1).fillRect(0, 0, e.w!, e.h!);
            g.lineStyle(2, 0x8a97b0, 0.8).strokeRect(1, 1, e.w! - 2, e.h! - 2);
            // rachaduras aparecem conforme o muro perde vida
            for (let k = 0; k < Math.round((1 - f) * 6); k++) {
              const x0 = ((k * 37) % Math.max(4, e.w! - 4)) + 2;
              const y0 = ((k * 23) % Math.max(4, e.h! - 4)) + 2;
              g.lineStyle(1.5, 0x0f1115, 1).lineBetween(x0, y0, x0 + 8, y0 + 6).lineBetween(x0 + 8, y0 + 6, x0 + 4, y0 + 12);
            }
            break;
          }
          g.fillStyle(0x1c2029, 1).fillRect(0, 0, e.w!, e.h!);
          g.lineStyle(2, c, 0.9).strokeRect(1, 1, e.w! - 2, e.h! - 2);
          for (let k = 8; k < Math.max(e.w!, e.h!) - 4; k += 12) {
            if (e.w! > e.h!) g.lineStyle(1, c, 0.35).lineBetween(k, 2, k, e.h! - 2);
            else g.lineStyle(1, c, 0.35).lineBetween(2, k, e.w! - 2, k);
          }
          g.setAlpha(e.restante > 0 ? Math.max(0.4, fim) : 1);
          break;
        case 'mina':
          g.lineStyle(1.5, c, 0.6).strokeCircle(0, 0, 9);
          g.fillStyle(c, 0.4 + 0.3 * pulso).fillCircle(0, 0, 3);
          break;
        case 'drone': {
          g.fillStyle(0x000000, 1).fillRect(-6, -6, 12, 12);
          g.lineStyle(2, c, 1).strokeRect(-6, -6, 12, 12);
          const a = agora / 40;
          for (const [ox, oy] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) g.lineStyle(1.5, c, 0.8).lineBetween(ox! - Math.cos(a) * 4, oy! - Math.sin(a) * 4, ox! + Math.cos(a) * 4, oy! + Math.sin(a) * 4);
          break;
        }
        case 'clone':
          if (visual) {
            // o clone copia até a barra de vida do dono, para enganar de verdade
            const vidaDono = this.visuais.get(e.dono)?.snap?.vida ?? CONFIG.vida.maxima;
            visual.snap = { vivo: true, estados: [], ax: e.ax ?? 1, ay: e.ay ?? 0, vida: vidaDono } as unknown as LutadorSnap;
            this.desenharCorpo(visual, e.ax ?? 1, e.ay ?? 0, agora);
            this.desenharBarra(visual);
            visual.container.setAlpha(fim);
          }
          break;
        case 'totem':
          g.fillStyle(c, 0.07 + 0.05 * pulso).fillCircle(0, 0, e.r!);
          g.lineStyle(2, c, 0.7).strokeCircle(0, 0, e.r!);
          g.fillStyle(c, 1).fillRect(-3, -12, 6, 24).fillRect(-9, -6, 18, 6);
          g.setAlpha(fim);
          break;
        case 'nuvem':
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2 + agora / 2000;
            g.fillStyle(c, 0.12).fillCircle(Math.cos(a) * e.r! * 0.5, Math.sin(a) * e.r! * 0.5, e.r! * 0.55);
          }
          g.lineStyle(1.5, c, 0.4).strokeCircle(0, 0, e.r!);
          g.setAlpha(fim);
          break;
        case 'meteoro': {
          const prog = 1 - Math.min(1, e.restante / (HABILIDADES.meteoro.segAviso * 1000));
          g.lineStyle(2, c, 0.8).strokeCircle(0, 0, e.r!);
          g.fillStyle(c, 0.08 + 0.2 * prog).fillCircle(0, 0, e.r! * prog);
          g.lineStyle(1, c, 0.6).lineBetween(-10, 0, 10, 0).lineBetween(0, -10, 0, 10);
          break;
        }
        case 'buraco':
          g.fillStyle(0x000000, 0.75).fillCircle(0, 0, 22);
          for (let k = 0; k < 3; k++) {
            const r = ((agora / 6 + k * 40) % 120) + 24;
            g.lineStyle(2, c, 0.6 * (1 - (r - 24) / 120)).strokeCircle(0, 0, r);
          }
          g.lineStyle(1, c, 0.25).strokeCircle(0, 0, e.r!);
          g.setAlpha(fim);
          break;
      }
    }
  }

  private idsAliados(): Set<string> {
    return new Set([...this.equipeDe.keys()].filter((id) => this.aliado(id)));
  }

  /** Mesmo time que eu? */
  private aliado(id: string): boolean {
    const a = this.equipeDe.get(id);
    return a !== undefined && a === this.equipeDe.get(this.ctx.meuId) && id !== this.ctx.meuId;
  }

  /** Cor da equipe de um jogador (ou null fora dos modos em equipe). */
  private corEquipe(id: string): number | null {
    const eq = this.equipeDe.get(id);
    return eq !== undefined && this.coresEquipe ? cor(this.coresEquipe[eq]!) : null;
  }

  /** Apagão: tudo escuro, menos em volta de quem joga e perto das luzes. */
  private desenharEscuridao(pos: { x: number; y: number }): void {
    const esc = this.ctx.mapa.escuro;
    if (!esc) return;
    const cam = this.cameras.main;
    const k = 4; // resolução baixa: 1 pixel da camada = 4 da tela
    const w = Math.ceil(cam.width / k);
    const h = Math.ceil(cam.height / k);
    if (!this.escuridao || this.escuridao.tex.width !== w || this.escuridao.tex.height !== h) {
      this.escuridao?.img.destroy();
      if (this.textures.exists('escuridao')) this.textures.remove('escuridao');
      const tex = this.textures.createCanvas('escuridao', w, h)!;
      const img = this.add.image(0, 0, 'escuridao').setOrigin(0).setDepth(80);
      this.escuridao = { tex, img };
    }
    const { tex, img } = this.escuridao;
    // a camada cobre exatamente o que a câmera mostra (em coordenadas do mundo)
    img.setScale(k / cam.zoom).setPosition(cam.worldView.x, cam.worldView.y);
    const ctx = tex.getContext();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(4,5,8,0.9)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    const furo = (x: number, y: number, raio: number) => {
      const sx = ((x - cam.worldView.x) * cam.zoom) / k;
      const sy = ((y - cam.worldView.y) * cam.zoom) / k;
      const r = (raio * cam.zoom) / k;
      if (sx < -r || sy < -r || sx > w + r || sy > h + r) return;
      const gr = ctx.createRadialGradient(sx, sy, r * 0.55, sx, sy, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    furo(pos.x, pos.y, esc.raioVisao);
    for (const l of esc.luzes) furo(l.x, l.y, l.r);
    ctx.globalCompositeOperation = 'source-over';
    tex.refresh();
  }

  /** Desenha uma vez o mapa (obstáculos, muretas, água e lava) num canvas guardado. */
  private prepararMiniMapa(): void {
    const el = document.getElementById('minimapa') as HTMLCanvasElement | null;
    if (!el) return;
    const m = this.ctx.mapa;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const largura = el.clientWidth || 150;
    const escala = largura / m.largura;
    const w = Math.round(m.largura * escala);
    const h = Math.round(m.altura * escala);
    el.width = w * dpr;
    el.height = h * dpr;
    el.style.height = `${h}px`;
    const base = document.createElement('canvas');
    base.width = el.width;
    base.height = el.height;
    const b = base.getContext('2d')!;
    b.scale(dpr * escala, dpr * escala);
    b.fillStyle = '#0b0d11';
    b.fillRect(0, 0, m.largura, m.altura);
    const cores: Record<number, string> = { 1: '#7a869f', 2: '#56607a', 3: '#1d5674', 4: '#c2410c', 5: '#1f5a2a', 6: '#4a3a22', 7: '#000000', 8: '#4f8fa8', 9: '#33363f', 10: '#33363f', 11: '#33363f', 12: '#33363f' };
    for (const o of m.obstaculos) {
      b.fillStyle = cores[o.tipo] ?? '#7a869f';
      b.fillRect(o.x, o.y, o.w, o.h);
    }
    b.strokeStyle = '#5a6478';
    b.lineWidth = 2 / escala;
    b.strokeRect(0, 0, m.largura, m.altura);
    this.mini = { ctx: el.getContext('2d')!, base, escala, dpr, ultimo: 0 };
  }

  /** A cada 100 ms: o mapa guardado e um ponto (com a direção) onde o jogador está. */
  private desenharMiniMapa(pos: { x: number; y: number }, agora: number): void {
    const mm = this.mini;
    if (!mm || agora - mm.ultimo < 100) return;
    mm.ultimo = agora;
    const { ctx, base, escala, dpr } = mm;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
    const eu = this.ctx.personagens[this.ctx.meuId];
    if (!eu) return;
    const x = pos.x * escala * dpr;
    const y = pos.y * escala * dpr;
    const r = 4 * dpr;
    const c = PERSONAGENS[eu.personagem].cor;
    // direção da mira
    ctx.strokeStyle = c;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + this.dirMira.x * r * 3, y + this.dirMira.y * r * 3);
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /** Supernova: orbe grande, brilhante e com as cores girando. */
  private desenharSupernova(agora: number): void {
    if (!this.orbe) this.orbe = this.add.graphics().setDepth(4);
    const g = this.orbe;
    g.clear();
    const s = this.supernova;
    if (!s) return;
    const pulso = 0.5 + 0.5 * Math.sin(agora / 140);
    const cores = [0xff3d9a, 0xffd21f, 0x19d3e6, 0x9b5cff, 0xa6ff2e];
    g.fillStyle(0xffffff, 0.08 + 0.08 * pulso).fillCircle(s.x, s.y, 46);
    for (let k = 0; k < cores.length; k++) {
      const a = agora / 400 + (k / cores.length) * Math.PI * 2;
      g.lineStyle(4, cores[k]!, 0.9).beginPath().arc(s.x, s.y, 26 + 4 * pulso, a, a + 1, false).strokePath();
    }
    g.fillStyle(0xffffff, 1).fillCircle(s.x, s.y, 9 + 3 * pulso);
  }

  /** Ativa a Supernova guardada (3º botão ou tecla R). */
  ativarSupernova(): void {
    if (this.meuSnap?.vivo && this.meuSnap.estados.includes('temSupernova')) this.ctx.socket.emit('jogo:supernova');
  }

  /** Cor da tinta de um lado do Pintão (equipe + 1, ou vaga + 1). */
  private corPintura(lado: number): string {
    if (this.coresEquipe) return this.coresEquipe[lado - 1] ?? '#ffffff';
    const quem = Object.values(this.ctx.personagens).find((p) => p.vaga + 1 === lado);
    return quem ? PERSONAGENS[quem.personagem].cor : '#ffffff';
  }

  /** Pintão: aplica a grade completa (quando vem) e as mudanças, e atualiza a imagem. */
  private atualizarPintura(snap: Snapshot): void {
    const p = snap.pintura;
    if (!p) return;
    if (!this.pinturaTex) {
      this.pinturaTex = this.textures.createCanvas('pintura', p.colunas, p.linhas)!;
      this.pinturaTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.add.image(0, 0, 'pintura').setOrigin(0).setScale(CASA_PINTURA).setAlpha(0.42).setDepth(-9);
      this.pinturaDono = new Uint8Array(p.colunas * p.linhas);
    }
    const ctx = this.pinturaTex.getContext();
    const dono = this.pinturaDono!;
    const pintarCasa = (i: number, lado: number) => {
      dono[i] = lado;
      const c = i % p.colunas;
      const r = Math.floor(i / p.colunas);
      if (lado === 0) ctx.clearRect(c, r, 1, 1);
      else {
        ctx.fillStyle = this.corPintura(lado);
        ctx.fillRect(c, r, 1, 1);
      }
    };
    if (p.completa) {
      const bin = atob(p.completa);
      for (let i = 0; i < bin.length; i++) {
        const lado = bin.charCodeAt(i);
        if (lado !== dono[i]) pintarCasa(i, lado);
      }
    }
    for (let k = 0; k + 1 < p.mudancas.length; k += 2) pintarCasa(p.mudancas[k]!, p.mudancas[k + 1]!);
    if (p.completa || p.mudancas.length) this.pinturaTex.refresh();
  }

  /** Cor de um lado do Pega Bandeira: jogador (cor do personagem) ou equipe ('e0'/'e1'). */
  private corDoLado(lado: string | null): number {
    if (!lado) return 0x5a6478;
    if (lado.startsWith('e') && this.coresEquipe) return cor(this.coresEquipe[Number(lado.slice(1))]!);
    const p = this.ctx.personagens[lado]?.personagem;
    return p ? cor(PERSONAGENS[p].cor) : 0xffffff;
  }

  /** Pega Bandeira: pontos de controle (dono, progresso da captura, disputa). */
  private desenharControle(snap: Snapshot): void {
    if (!snap.controle) return;
    if (!this.controle) this.controle = this.add.graphics().setDepth(3);
    const g = this.controle;
    g.clear();
    const pulso = 0.5 + 0.5 * Math.sin(performance.now() / 150);
    for (const pc of snap.controle) {
      const c = this.corDoLado(pc.dono);
      g.fillStyle(c, pc.dono ? 0.16 : 0.06).fillCircle(pc.x, pc.y, pc.r);
      g.lineStyle(pc.valor > 1 ? 4 : 3, c, 0.9).strokeCircle(pc.x, pc.y, pc.r);
      if (pc.capturando && pc.progresso > 0) {
        g.lineStyle(7, this.corDoLado(pc.capturando), 1)
          .beginPath()
          .arc(pc.x, pc.y, pc.r + 8, -Math.PI / 2, -Math.PI / 2 + pc.progresso * Math.PI * 2, false)
          .strokePath();
      }
      if (pc.disputado) g.lineStyle(2, 0xffffff, 0.4 + 0.5 * pulso).strokeCircle(pc.x, pc.y, pc.r + 14);
      // bandeira no meio (maior no ponto do centro)
      const k = pc.valor > 1 ? 1.5 : 1;
      g.lineStyle(3, 0xe8ecf3, 0.9).lineBetween(pc.x - 6 * k, pc.y + 14 * k, pc.x - 6 * k, pc.y - 16 * k);
      g.fillStyle(c, 1).fillTriangle(pc.x - 5 * k, pc.y - 16 * k, pc.x + 12 * k, pc.y - 10 * k, pc.x - 5 * k, pc.y - 4 * k);
    }
  }

  /** Neoncalypse: escurece tudo fora da zona e marca a borda. */
  private desenharZona(snap: Snapshot): void {
    if (!snap.zona) return;
    if (!this.zona) this.zona = this.add.graphics().setDepth(30);
    const z = snap.zona;
    const g = this.zona;
    g.clear();
    g.lineStyle(6000, 0x2a0016, 0.5).strokeCircle(z.x, z.y, z.raio + 3000);
    g.lineStyle(10, 0xff3d9a, 0.18).strokeCircle(z.x, z.y, z.raio);
    g.lineStyle(3, 0xff3d9a, 0.9).strokeCircle(z.x, z.y, z.raio);
  }

  private desenharBarra(v: Visual): void {
    const g = v.barra;
    g.clear();
    const s = v.snap;
    if (!s || !s.vivo) return;
    const ce = this.corEquipe(v.id);
    if (ce !== null) {
      // anel da equipe no chão
      g.lineStyle(3, ce, 0.9).strokeEllipse(0, 12, 34, 12);
      g.fillStyle(0x000000, 0.7).fillRoundedRect(-17, -26, 34, 5, 2);
      g.fillStyle(ce, 1).fillRoundedRect(-16, -25, 32 * (s.vida / (s.vidaMax || CONFIG.vida.maxima)), 3, 1.5);
      return;
    }
    const f = s.vida / (s.vidaMax || CONFIG.vida.maxima);
    g.fillStyle(0x000000, 0.7).fillRoundedRect(-17, -26, 34, 5, 2);
    g.fillStyle(v.cor, 1).fillRoundedRect(-16, -25, 32 * f, 3, 1.5);
  }

  // ------------------------------------------------------------------ rede

  private aplicarSnapshot(snap: Snapshot): void {
    const agora = performance.now();
    this.relogio = snap.t - Date.now();
    this.inicio = snap.inicio;
    this.placar = {
      modo: snap.modo,
      meta: snap.meta,
      pontos: snap.lutadores.map((l) => ({ id: l.id, pontos: l.pontos })),
      ...(snap.pontosEquipe ? { pontosEquipe: snap.pontosEquipe, coresEquipe: snap.coresEquipe } : {}),
      ...(snap.tempoRestante !== undefined ? { tempoRestante: snap.tempoRestante } : {}),
    };
    this.desenharControle(snap);
    this.supernova = snap.supernova ?? null;
    this.atualizarPintura(snap);
    for (const l of snap.lutadores) if (l.equipe !== null) this.equipeDe.set(l.id, l.equipe);
    if (snap.coresEquipe) this.coresEquipe = snap.coresEquipe;
    this.desenharZona(snap);
    for (const s of snap.lutadores) {
      const v = this.visuais.get(s.id) ?? (this.criarVisual(s.id, s.personagem), this.visuais.get(s.id)!);
      if (v.personagem !== s.personagem) {
        // corrida armada: virou outro personagem
        v.personagem = s.personagem;
        v.cor = cor(PERSONAGENS[s.personagem].cor);
        const info = this.ctx.personagens[s.id];
        if (info) info.personagem = s.personagem;
      }
      v.snap = s;
      if (s.id !== this.ctx.meuId) {
        v.buffer.push({ t: agora, x: s.x, y: s.y });
        if (v.buffer.length > 12) v.buffer.shift();
        continue;
      }
      this.meuSnap = s;
      // no salto do trampolim, a posição vem só do servidor
      if (s.estados.includes('salto')) {
        this.pendentes = [];
        this.atual = { x: s.x, y: s.y };
        this.anterior = { ...this.atual };
        this.desvio = { x: 0, y: 0 };
        this.vel = { vx: 0, vy: 0 };
        continue;
      }
      // reconciliação: posição do servidor + comandos pendentes
      this.pendentes = this.pendentes.filter((c) => c.seq > s.seq);
      let pos = { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
      for (const c of this.pendentes) {
        const tinta = s.voando ? HABILIDADES.voo.fatorVelocidade : fatorTinta(s.id, s.personagem, pos.x, pos.y, snap.pocas, this.idsAliados());
        pos = aplicarMovimento(
          this.ctx.mapa,
          s.personagem,
          pos.x,
          pos.y,
          c.x,
          c.y,
          fatorVelocidade(tinta, s.chocado, s.rapido) *
            (s.estados.includes('cancao') ? HABILIDADES.cancao.fator : 1) *
            (snap.modo === 'neoncalypse' ? 1.5 : 1) *
            (s.estados.includes('supernova') ? 1.5 : 1) *
            (s.estados.includes('corrida') ? 1.5 : 1),
          s.voando,
          { vx: pos.vx, vy: pos.vy },
        );
      }
      this.vel = { vx: pos.vx, vy: pos.vy };
      const erro = Math.hypot(pos.x - this.atual.x, pos.y - this.atual.y);
      if (erro > 0.05) {
        if (erro < 60) {
          this.desvio.x += this.atual.x - pos.x;
          this.desvio.y += this.atual.y - pos.y;
        } else this.desvio = { x: 0, y: 0 };
        this.anterior = { x: pos.x, y: pos.y };
        this.atual = { x: pos.x, y: pos.y };
      }
    }
    this.atualizarPocas(snap);
    this.atualizarEntidades(snap);
    const presentes = new Set(snap.lutadores.map((l) => l.id));
    for (const v of this.visuais.values()) if (v.id !== this.ctx.meuId) v.container.setVisible(presentes.has(v.id));
    const vistos = new Set<number>();
    for (const p of snap.projeteis) {
      vistos.add(p.id);
      let pr = this.projeteis.get(p.id);
      if (!pr) {
        const g = this.add.graphics().setDepth(20);
        const c = cor(PERSONAGENS[this.ctx.personagens[p.dono]?.personagem ?? 'veni'].cor);
        this.desenharProjetil(g, p.estilo, c, p.preparada);
        pr = { g, x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: agora };
        this.projeteis.set(p.id, pr);
      }
      Object.assign(pr, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: agora });
      pr.g.setRotation(Math.atan2(p.vy, p.vx));
    }
    for (const [id, pr] of this.projeteis) {
      if (!vistos.has(id)) {
        pr.g.destroy();
        this.projeteis.delete(id);
      }
    }
    for (const [id, ct] of this.pickups) {
      const ativo = snap.pickups.includes(id);
      ct.setAlpha(ativo ? 1 : 0.12);
    }
  }

  /** Poças de tinta: manchas brancas irregulares no chão, que somem no último segundo. */
  private atualizarPocas(snap: Snapshot): void {
    this.pocas = snap.pocas;
    const vistas = new Set<number>();
    for (const p of snap.pocas) {
      vistas.add(p.id);
      let g = this.visuaisPoca.get(p.id);
      if (!g) {
        g = this.add.graphics({ x: p.x, y: p.y }).setDepth(1);
        const c = cor(PERSONAGENS[this.ctx.personagens[p.dono]?.personagem ?? 'vini'].cor);
        g.fillStyle(c, 0.08).fillCircle(0, 0, p.r + 6);
        g.fillStyle(c, 0.32).fillCircle(0, 0, p.r);
        // borda irregular (gotas em volta), sempre igual para a mesma poça
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + (p.id % 7);
          const rr = Math.min(14, p.r * (0.18 + ((p.id * 13 + k * 7) % 10) / 60));
          g.fillStyle(c, 0.32).fillCircle(Math.cos(a) * p.r * 0.92, Math.sin(a) * p.r * 0.92, rr);
        }
        g.lineStyle(1.5, c, 0.55).strokeCircle(0, 0, p.r);
        this.visuaisPoca.set(p.id, g);
      }
      g.setAlpha(Math.min(1, p.restante / 1000));
    }
    for (const [id, g] of this.visuaisPoca) {
      if (!vistas.has(id)) {
        g.destroy();
        this.visuaisPoca.delete(id);
      }
    }
  }

  private contagem(): number {
    return Math.max(0, Math.ceil((this.inicio - (Date.now() + this.relogio)) / 1000));
  }

  private ultimaMiraEnviada = { x: 0, y: 0, t: 0 };
  /** Mira para o servidor (o escudo do Daniel segue a mira; os outros veem para onde você aponta). */
  private enviarMira(agora: number): void {
    const u = this.ultimaMiraEnviada;
    if (agora - u.t < 100) return;
    if (Math.abs(this.dirMira.x - u.x) < 0.03 && Math.abs(this.dirMira.y - u.y) < 0.03) return;
    this.ultimaMiraEnviada = { x: this.dirMira.x, y: this.dirMira.y, t: agora };
    this.ctx.socket.emit('jogo:mira', { dx: Math.round(this.dirMira.x * 100) / 100, dy: Math.round(this.dirMira.y * 100) / 100 });
  }

  /** O personagem tem tiro carregado (Atirador)? */
  private carregavel(): boolean {
    const eu = this.ctx.personagens[this.ctx.meuId];
    return !!eu && !!PERSONAGENS[eu.personagem].arma.carga;
  }

  /** Carga atual do tiro (0–1) enquanto o botão está segurado. */
  private cargaAtual(agora: number): number {
    const eu = this.ctx.personagens[this.ctx.meuId];
    const c = eu ? PERSONAGENS[eu.personagem].arma.carga : undefined;
    if (!c || this.cargaDesde === 0) return 0;
    return Math.min(1, Math.max(0, (agora - Math.max(this.cargaDesde, this.proximoTiro)) / (c.seg * 1000)));
  }

  /** Modos sem renascimento: depois de morrer, o jogador vira espectador. */
  private espectador(): boolean {
    return !!this.meuSnap && !this.meuSnap.vivo && (this.placar?.modo === 'royale' || this.placar?.modo === 'neoncalypse');
  }

  /** Passa a câmera para o próximo jogador vivo. */
  proximoEspectado(): void {
    const vivos = [...this.visuais.values()].filter((v) => v.id !== this.ctx.meuId && v.snap?.vivo && v.container.visible);
    if (!vivos.length) return;
    const i = vivos.findIndex((v) => v.id === this.espectando);
    this.espectando = vivos[(i + 1) % vivos.length]!.id;
    this.camLivre = false;
  }

  atacar(dir?: { x: number; y: number }, carga = 0): void {
    if (this.espectador()) {
      this.proximoEspectado();
      return;
    }
    const s = this.meuSnap;
    if (!s?.vivo || this.contagem() > 0) return;
    const agora = performance.now();
    if (agora < this.proximoTiro) return;
    const d = dir ?? this.dirMira;
    let fator = s.estados.includes('furia') ? HABILIDADES.furia.fatorRecarga : 1;
    if (s.estados.includes('cancao')) fator /= HABILIDADES.cancao.fator;
    if (s.estados.includes('sobrecarga')) fator *= HABILIDADES.sobrecarga.fatorRecarga;
    if (this.placar?.modo === 'neoncalypse') fator *= 0.5;
    if (s.estados.includes('supernova')) fator *= this.placar?.modo === 'neoncalypse' ? 0.75 : 0.5;
    this.proximoTiro = agora + PERSONAGENS[s.personagem].arma.recarga * 1000 * fator;
    this.ctx.socket.emit('jogo:atacar', { dx: Math.round(d.x * 100) / 100, dy: Math.round(d.y * 100) / 100, ...(carga > 0 ? { carga: Math.round(carga * 100) / 100 } : {}) });
  }

  usarAtiva(): void {
    const s = this.meuSnap;
    if (!s?.vivo || s.recargaAtiva > 0 || this.contagem() > 0) return;
    if (s.personagem === 'pacheco') this.vooLocalAte = performance.now() + HABILIDADES.voo.segDuracao * 1000 - 60;
    this.ctx.socket.emit('jogo:ativa', { dx: Math.round(this.dirMira.x * 100) / 100, dy: Math.round(this.dirMira.y * 100) / 100 });
  }

  // ------------------------------------------------------------------ quadro a quadro

  override update(_t: number, deltaMs: number): void {
    const dt = Math.min(0.25, deltaMs / 1000);
    const agora = performance.now();
    const eu = this.ctx.personagens[this.ctx.meuId];
    const vivo = this.meuSnap?.vivo ?? true;
    const contagem = this.contagem();

    this.acumulador += dt;
    while (this.acumulador >= DT) {
      this.acumulador -= DT;
      this.anterior = { ...this.atual };
      const m = vivo && contagem === 0 ? this.ctx.lerMovimento() : { x: 0, y: 0 };
      if (!eu || !vivo || contagem > 0 || this.meuSnap?.estados.includes('salto')) continue;
      if (m.x === 0 && m.y === 0 && !terrenoMove(this.ctx.mapa, this.atual.x, this.atual.y, this.vel)) {
        this.vel = { vx: 0, vy: 0 };
        continue;
      }
      this.ultimaDir = { x: m.x, y: m.y };
      const c = { seq: ++this.seq, x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100 };
      this.ctx.socket.emit('jogo:cmd', c);
      this.pendentes.push(c);
      if (this.pendentes.length > 40) this.pendentes.shift();
      const voando = !!this.meuSnap?.voando || performance.now() < this.vooLocalAte;
      const tinta = voando ? HABILIDADES.voo.fatorVelocidade : fatorTinta(this.ctx.meuId, eu.personagem, this.atual.x, this.atual.y, this.pocas, this.idsAliados());
      const f =
        fatorVelocidade(tinta, !!this.meuSnap?.chocado, !!this.meuSnap?.rapido) *
        (this.meuSnap?.estados.includes('cancao') ? HABILIDADES.cancao.fator : 1) *
        (this.placar?.modo === 'neoncalypse' ? 1.5 : 1) *
        (this.meuSnap?.estados.includes('supernova') ? 1.5 : 1) *
        (this.meuSnap?.estados.includes('corrida') ? 1.5 : 1);
      const novo = aplicarMovimento(this.ctx.mapa, eu.personagem, this.atual.x, this.atual.y, c.x, c.y, f, voando, this.vel);
      this.atual = { x: novo.x, y: novo.y };
      this.vel = { vx: novo.vx, vy: novo.vy };
    }
    const k = this.acumulador / DT;
    const amort = Math.exp(-14 * dt);
    this.desvio.x *= amort;
    this.desvio.y *= amort;
    const pos = {
      x: this.anterior.x + (this.atual.x - this.anterior.x) * k + this.desvio.x,
      y: this.anterior.y + (this.atual.y - this.anterior.y) * k + this.desvio.y,
    };

    // mira: arraste (celular), mouse (computador) ou direção do movimento
    const toque = this.ctx.lerMira();
    let atirando = this.mouseAtirando;
    let mirando = false;
    if (toque?.ativo) {
      this.dirMira = { x: toque.x, y: toque.y };
      atirando ||= toque.atirando;
      mirando = true;
      this.miraManualAte = agora + 1500;
    } else if (agora < this.miraManualAte) {
      mirando = true;
    } else if (!window.matchMedia('(pointer: coarse)').matches) {
      const w = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const dx = w.x - pos.x;
      const dy = w.y - pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) this.dirMira = { x: dx / d, y: dy / d };
      mirando = true;
    } else this.dirMira = { ...this.ultimaDir };
    // segurar o botão sem arrastar também ataca sem parar (na direção atual)
    if (toque?.atirando) atirando = true;
    if (this.carregavel()) {
      // Atirador: segurar carrega, soltar atira
      if (atirando && !this.segurando) this.cargaDesde = agora;
      if (!atirando && this.segurando) {
        this.atacar(undefined, this.cargaAtual(agora));
        this.cargaDesde = 0;
      }
      this.segurando = atirando;
    } else if (atirando) this.atacar();
    this.enviarMira(agora);
    this.desenharMira(pos, mirando, agora, dt);

    const tRender = agora - ATRASO;
    for (const v of this.visuais.values()) {
      const souEu = v.id === this.ctx.meuId;
      if (souEu) {
        v.container.setPosition(pos.x, pos.y);
        this.desenharCorpo(v, this.dirMira.x, this.dirMira.y, agora);
      } else {
        const b = v.buffer;
        let x = b[b.length - 1]!.x;
        let y = b[b.length - 1]!.y;
        for (let i = b.length - 1; i > 0; i--) {
          const a = b[i - 1]!;
          const c = b[i]!;
          if (a.t <= tRender && tRender <= c.t) {
            const f = (tRender - a.t) / Math.max(1, c.t - a.t);
            x = a.x + (c.x - a.x) * f;
            y = a.y + (c.y - a.y) * f;
            break;
          }
        }
        v.container.setPosition(x, y);
        this.desenharCorpo(v, v.snap?.ax ?? 1, v.snap?.ay ?? 0, agora);
      }
      v.container.setDepth(10 + v.container.y / 10000);
      this.desenharBarra(v);
    }
    for (const p of this.projeteis.values()) {
      const s = Math.min(0.15, (agora - p.t) / 1000);
      p.g.setPosition(p.x + p.vx * s, p.y + p.vy * s);
    }
    this.atualizarCamera(dt);
    this.desenharEscuridao(pos);
    this.desenharMiniMapa(pos, agora);
    this.desenharSupernova(agora);
    this.desenharEntidades(agora);
    this.desenharSetas(pos);
    const rec = eu ? PERSONAGENS[eu.personagem].arma.recarga * 1000 : 1;
    if (contagem !== this.ultimaContagem) {
      if (contagem > 0 && contagem <= 3) tocar('contagem');
      else if (contagem === 0 && this.ultimaContagem > 0 && this.ultimaContagem <= 3) tocar('largada');
      this.ultimaContagem = contagem;
    }
    this.ctx.aoEstado(this.meuSnap, contagem, Math.min(1, Math.max(0, 1 - (this.proximoTiro - agora) / rec)), this.placar);
  }

  private atualizarCamera(dt: number): void {
    const cam = this.cameras.main;
    const el = document.getElementById('espectador');
    if (!this.espectador()) {
      if (this.seguindo !== this.ctx.meuId) {
        const meu = this.visuais.get(this.ctx.meuId);
        if (meu) cam.startFollow(meu.container, true, 0.14, 0.14);
        this.seguindo = this.ctx.meuId;
      }
      if (el && !el.hidden) el.hidden = true;
      return;
    }
    // joystick ou WASD soltam a câmera
    const m = this.ctx.lerMovimento();
    if (m.x || m.y) {
      if (!this.camLivre) cam.stopFollow();
      this.camLivre = true;
      this.seguindo = null;
      const v = 700 / cam.zoom;
      cam.scrollX += m.x * v * dt;
      cam.scrollY += m.y * v * dt;
    } else if (!this.camLivre) {
      const alvo = this.espectando ? this.visuais.get(this.espectando) : undefined;
      if (!alvo || !alvo.snap?.vivo) this.proximoEspectado();
      const atual = this.espectando ? this.visuais.get(this.espectando) : undefined;
      if (atual && this.seguindo !== atual.id) {
        cam.startFollow(atual.container, true, 0.1, 0.1);
        this.seguindo = atual.id;
      }
    }
    if (el) {
      el.hidden = false;
      const nome = this.camLivre ? '' : (this.ctx.personagens[this.espectando ?? '']?.apelido ?? '');
      const span = el.querySelector('span');
      if (span && span.textContent !== nome) span.textContent = nome;
    }
  }

  /** Seta na borda da tela apontando para cada inimigo vivo que está fora da tela (e para a Supernova). */
  private desenharSetas(pos: { x: number; y: number }): void {
    const g = this.setas;
    g.clear();
    const wv = this.cameras.main.worldView;
    const margem = 26 / this.cameras.main.zoom;
    const s = this.supernova;
    if (s && !(s.x > wv.x && s.x < wv.right && s.y > wv.y && s.y < wv.bottom)) {
      const ang = Math.atan2(s.y - pos.y, s.x - pos.x);
      const k = Math.min((wv.width / 2 - margem) / Math.abs(Math.cos(ang) || 1e-6), (wv.height / 2 - margem) / Math.abs(Math.sin(ang) || 1e-6));
      const px = wv.centerX + Math.cos(ang) * k;
      const py = wv.centerY + Math.sin(ang) * k;
      const t = 10 / this.cameras.main.zoom;
      g.fillStyle(0xffffff, 0.3).fillCircle(px, py, t * 1.8);
      g.fillStyle(0xffffff, 1).fillCircle(px, py, t * 0.8);
    }
    for (const v of this.visuais.values()) {
      if (v.id === this.ctx.meuId || !(v.snap?.vivo ?? true) || !v.container.visible || v.snap?.estados.includes('glitch') || this.aliado(v.id)) continue;
      const { x, y } = v.container;
      if (x > wv.x && x < wv.right && y > wv.y && y < wv.bottom) continue;
      const ang = Math.atan2(y - pos.y, x - pos.x);
      // ponto na borda da área visível, na direção do inimigo
      const cx = wv.centerX;
      const cy = wv.centerY;
      const hw = wv.width / 2 - margem;
      const hh = wv.height / 2 - margem;
      const k = Math.min(hw / Math.abs(Math.cos(ang) || 1e-6), hh / Math.abs(Math.sin(ang) || 1e-6));
      const px = cx + Math.cos(ang) * k;
      const py = cy + Math.sin(ang) * k;
      const t = 14 / this.cameras.main.zoom;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      g.fillStyle(v.cor, 0.25).fillCircle(px, py, t * 1.3);
      g.fillStyle(v.cor, 1).fillTriangle(px + ca * t, py + sa * t, px - ca * t * 0.6 - sa * t * 0.7, py - sa * t * 0.6 + ca * t * 0.7, px - ca * t * 0.6 + sa * t * 0.7, py - sa * t * 0.6 - ca * t * 0.7);
    }
  }

  /** Indicador de mira (só o próprio jogador vê): curto, suave, só mostra a direção. */
  private desenharMira(pos: { x: number; y: number }, mirando: boolean, agora: number, dt: number): void {
    const g = this.mira;
    g.clear();
    const eu = this.ctx.personagens[this.ctx.meuId];
    if (!eu || !(this.meuSnap?.vivo ?? true)) return;
    // suaviza a rotação do indicador (a direção enviada ao servidor é a exata)
    const alvo = Math.atan2(this.dirMira.y, this.dirMira.x);
    const dif = Phaser.Math.Angle.Wrap(alvo - this.angMira);
    this.angMira += dif * Math.min(1, dt * 30);
    const ang = this.angMira;
    const p = PERSONAGENS[eu.personagem];
    const c = cor(p.cor);
    const pronto = agora >= this.proximoTiro;
    const a = (mirando ? 1 : 0.65) * (pronto ? 1 : 0.45);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    if (p.arma.tipo === 'aura') {
      const L = p.arma.alcance + R;
      g.fillStyle(c, 0.05 * a).fillCircle(pos.x, pos.y, L);
      g.lineStyle(1.5, c, 0.45 * a).strokeCircle(pos.x, pos.y, L);
    } else if (p.arma.tipo === 'projetil') {
      // seta curta (cresce enquanto o Atirador carrega o tiro)
      const ini = R + 8;
      const fim = 46 + this.cargaAtual(agora) * 60;
      g.lineStyle(2, c, 0.75 * a).lineBetween(pos.x + ca * ini, pos.y + sa * ini, pos.x + ca * fim, pos.y + sa * fim);
      const px = pos.x + ca * (fim + 8);
      const py = pos.y + sa * (fim + 8);
      g.fillStyle(c, 0.9 * a).fillTriangle(px, py, px - ca * 12 - sa * 6, py - sa * 12 + ca * 6, px - ca * 12 + sa * 6, py - sa * 12 - ca * 6);
    } else {
      const L = p.arma.alcance + R;
      const ab = Phaser.Math.DegToRad(p.arma.arcoGraus ?? 60);
      g.fillStyle(c, 0.1 * a).slice(pos.x, pos.y, L, ang - ab, ang + ab, false).fillPath();
      g.lineStyle(1.5, c, 0.6 * a).beginPath().arc(pos.x, pos.y, L, ang - ab, ang + ab, false).strokePath();
    }
  }

  // ------------------------------------------------------------------ efeitos

  private flutuante(x: number, y: number, texto: string, corTexto: string): void {
    const t = this.add
      .text(x, y, texto, { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: corTexto, stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5)
      .setResolution(3)
      .setDepth(60);
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: 750, ease: 'Cubic.out', onComplete: () => t.destroy() });
  }

  private posDe(id: string): { x: number; y: number } | null {
    const v = this.visuais.get(id);
    return v ? { x: v.container.x, y: v.container.y } : null;
  }

  /** Volume pela distância até o centro da câmera (quem ouve). */
  private volumeEm(x: number, y: number): number {
    const c = this.cameras.main.midPoint;
    return Math.max(0, 1 - Math.hypot(x - c.x, y - c.y) / 1000);
  }

  private somDoEfeito(e: Efeito): void {
    const pos = (id: string) => this.posDe(id);
    const em = (p: { x: number; y: number } | null, s: Som) => p && tocar(s, this.volumeEm(p.x, p.y));
    switch (e.tipo) {
      case 'disparo': {
        const per = this.ctx.personagens[e.de]?.personagem;
        const estilo = per ? PERSONAGENS[per].arma.estilo : undefined;
        const s: Som = estilo === 'flecha' ? 'flecha' : estilo === 'gota' ? 'gota' : estilo === 'tinta' ? 'tinta' : estilo === 'orbe' ? 'orbe' : estilo === 'granada' ? 'granada' : estilo === 'bala' || estilo === 'prego' ? 'bala' : 'tiro';
        em(pos(e.de) ?? e, s);
        break;
      }
      case 'linha':
        em({ x: e.x0, y: e.y0 }, 'feixe');
        break;
      case 'golpe':
        em(e, 'golpe');
        break;
      case 'giro':
        em(e, 'giro');
        break;
      case 'explosao':
        em(e, 'explosao');
        break;
      case 'teleporte':
        em({ x: e.x1, y: e.y1 }, 'teleporte');
        break;
      case 'dano':
        if (e.alvo === this.ctx.meuId) tocar(e.bloqueado ? 'bloqueio' : 'danoEu');
        else em(pos(e.alvo), e.bloqueado ? 'bloqueio' : 'dano');
        break;
      case 'morte':
        em(pos(e.alvo), 'morte');
        break;
      case 'pickup':
        if (e.alvo === this.ctx.meuId) tocar('pickup');
        break;
      case 'cura':
        if (e.alvo === this.ctx.meuId) tocar('cura', 0.6);
        break;
      case 'onda':
        em(e, 'onda');
        break;
      case 'pulso':
        em(e, 'pulso');
        break;
      case 'estatica':
        em(pos(e.de), 'zap');
        break;
      case 'voo':
        em(e, 'voo');
        break;
      case 'respingo':
      case 'balde':
        em(e, 'respingo');
        break;
      case 'anel':
        em(e, 'habilidade');
        break;
      case 'defesa':
        em(e, 'bloqueio');
        break;
      case 'supernova':
        if (e.acao === 'surgiu') tocar('vitoria', 0.5);
        else if (e.acao === 'pegou') em(e, 'pickup');
        else em(e, 'teleporte');
        break;
    }
  }

  private mostrarEfeito(e: Efeito): void {
    this.somDoEfeito(e);
    if (e.tipo === 'morte' && e.alvo === this.ctx.meuId) {
      this.espectando = e.por ?? null;
      this.camLivre = false;
    }
    // cada efeito é desenhado em volta da própria origem e posicionado no ponto certo,
    // então crescer, girar ou sumir acontece no lugar (não "sai andando" pelo mapa)
    const efeito = (x: number, y: number) => this.add.graphics({ x, y }).setDepth(40);
    const sumir = (g: Phaser.GameObjects.Graphics, dur: number, escala?: [number, number]) =>
      this.tweens.add({ targets: g, alpha: 0, ...(escala ? { scale: { from: escala[0], to: escala[1] } } : {}), duration: dur, ease: 'Cubic.out', onComplete: () => g.destroy() });
    switch (e.tipo) {
      case 'explosao': {
        const c = cor(e.cor);
        const g = efeito(e.x, e.y);
        g.fillStyle(0xffe2c4, 0.8).fillCircle(0, 0, e.raio * 0.3);
        g.fillStyle(c, 0.2).fillCircle(0, 0, e.raio);
        g.lineStyle(3, c, 1).strokeCircle(0, 0, e.raio);
        sumir(g, 320);
        this.cameras.main.shake(90, 0.002);
        break;
      }
      case 'golpe': {
        const v = this.visuais.get(e.de);
        const p = this.posDe(e.de) ?? e;
        const g = efeito(p.x, p.y);
        const ang = Math.atan2(e.dy, e.dx);
        const ab = Phaser.Math.DegToRad(e.arco);
        g.fillStyle(0xff4d24, 0.35).slice(0, 0, e.raio, ang - ab, ang + ab, false).fillPath();
        g.lineStyle(3, v?.cor ?? 0xffd21f, 1).beginPath().arc(0, 0, e.raio, ang - ab, ang + ab, false).strokePath();
        sumir(g, 170);
        break;
      }
      case 'giro': {
        // anel de fogo preso ao Gut, girando em volta dele
        const v = this.visuais.get(e.de);
        const g = this.add.graphics();
        g.fillStyle(0xff4d24, 0.08).fillCircle(0, 0, e.raio);
        for (let k = 0; k < 3; k++) {
          const a0 = (k / 3) * Math.PI * 2;
          g.lineStyle(6, 0xff4d24, 0.5).beginPath().arc(0, 0, e.raio - 4, a0, a0 + 1.4, false).strokePath();
          g.lineStyle(3, 0xffd21f, 1).beginPath().arc(0, 0, e.raio - 4, a0, a0 + 1.4, false).strokePath();
        }
        if (v) v.container.addAt(g, 0);
        else g.setPosition(e.x, e.y).setDepth(40);
        this.tweens.add({ targets: g, angle: 360, duration: 380, ease: 'Cubic.out' });
        this.tweens.add({ targets: g, alpha: 0, delay: 200, duration: 220, onComplete: () => g.destroy() });
        break;
      }
      case 'teleporte': {
        const g = this.add.graphics().setDepth(40);
        g.lineStyle(2, 0xff2e4d, 0.5).lineBetween(e.x0, e.y0, e.x1, e.y1);
        g.lineStyle(2, 0xff2e4d, 1).strokeCircle(e.x0, e.y0, R + 6).strokeCircle(e.x1, e.y1, R + 6);
        sumir(g, 380);
        if (e.de === this.ctx.meuId) {
          this.atual = { x: e.x1, y: e.y1 };
          this.anterior = { ...this.atual };
          this.desvio = { x: 0, y: 0 };
        }
        break;
      }
      case 'voo': {
        const g = efeito(e.x, e.y);
        const c = cor(PERSONAGENS.pacheco.cor);
        g.lineStyle(3, c, 0.9).strokeCircle(0, 0, e.pouso ? 22 : 16);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.fillStyle(c, 0.8).fillCircle(Math.cos(a) * 24, Math.sin(a) * 24, 2.5);
        }
        sumir(g, 280);
        break;
      }
      case 'supernova': {
        const g = efeito(e.x, e.y);
        g.lineStyle(4, 0xffffff, 0.9).strokeCircle(0, 0, e.acao === 'ativou' ? 40 : 30);
        sumir(g, 400, [1, 2]);
        break;
      }
      case 'anel': {
        const g = efeito(e.x, e.y);
        g.lineStyle(3, cor(e.cor), 0.9).strokeCircle(0, 0, e.raio);
        sumir(g, e.ms);
        break;
      }
      case 'linha': {
        const g = this.add.graphics().setDepth(40);
        if (e.largura) g.lineStyle(e.largura * 2, cor(e.cor), 0.25).lineBetween(e.x0, e.y0, e.x1, e.y1);
        g.lineStyle(e.largura ?? 2.5, cor(e.cor), 0.9).lineBetween(e.x0, e.y0, e.x1, e.y1);
        sumir(g, 260);
        break;
      }
      case 'pulso': {
        const p = this.posDe(e.de) ?? e;
        const g = efeito(p.x, p.y);
        const cz = cor(PERSONAGENS.lucas.cor);
        g.fillStyle(cz, 0.12).fillCircle(0, 0, e.raio);
        g.lineStyle(2, cz, 0.9).strokeCircle(0, 0, e.raio);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + Math.random() * 0.4;
          const r1 = e.raio * 0.35;
          const r2 = e.raio * 0.95;
          const meio = (r1 + r2) / 2;
          g.lineStyle(2, cz, 1)
            .lineBetween(Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a + 0.12) * meio, Math.sin(a + 0.12) * meio)
            .lineBetween(Math.cos(a + 0.12) * meio, Math.sin(a + 0.12) * meio, Math.cos(a) * r2, Math.sin(a) * r2);
        }
        sumir(g, 200);
        break;
      }
      case 'onda': {
        // anel que cresce no lugar onde foi solto, até o raio máximo
        const g = efeito(e.x, e.y);
        const cz = cor(PERSONAGENS.lucas.cor);
        const estado = { r: 10 };
        this.tweens.add({
          targets: estado,
          r: e.raio,
          duration: e.ms,
          ease: 'Linear',
          onUpdate: () => {
            g.clear();
            g.lineStyle(10, cz, 0.15).strokeCircle(0, 0, estado.r);
            g.lineStyle(3, cz, 0.95).strokeCircle(0, 0, estado.r);
          },
          onComplete: () => sumir(g, 200),
        });
        break;
      }
      case 'estatica': {
        const a = this.posDe(e.de);
        const b = this.posDe(e.alvo);
        if (!a || !b) return;
        const g = this.add.graphics().setDepth(40);
        const cz = cor(PERSONAGENS.lucas.cor);
        const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15;
        const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
        g.lineStyle(2.5, cz, 1).lineBetween(a.x, a.y, mx, my).lineBetween(mx, my, b.x, b.y);
        sumir(g, 180);
        break;
      }
      case 'defesa': {
        const g = efeito(e.x, e.y);
        g.lineStyle(3, cor(PERSONAGENS.daniel.cor), 1).strokeCircle(0, 0, 8);
        g.fillStyle(0xc9d2e0, 0.8).fillCircle(0, 0, 4);
        sumir(g, 220);
        break;
      }
      case 'respingo': {
        const g = efeito(e.x, e.y);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + 0.3;
          g.fillStyle(0xf2f6ff, 0.9).fillCircle(Math.cos(a) * e.raio * 0.8, Math.sin(a) * e.raio * 0.8, 3);
        }
        sumir(g, 260);
        break;
      }
      case 'balde': {
        const p = this.posDe(e.de) ?? e;
        const g = efeito(p.x, p.y);
        g.lineStyle(4, 0xf2f6ff, 0.9).strokeCircle(0, 0, e.raio);
        sumir(g, 300);
        break;
      }
      case 'disparo': {
        const p = this.posDe(e.de) ?? e;
        const g = efeito(p.x, p.y);
        g.fillStyle(0xc9d2e0, 0.7).fillCircle(0, 0, R + 3);
        sumir(g, 90);
        break;
      }
      case 'dano': {
        const p = this.posDe(e.alvo);
        if (!p) return;
        this.flutuante(p.x, p.y - 30, e.bloqueado ? '0' : `-${e.valor}`, e.bloqueado ? '#c9d2e0' : '#ff5c6c');
        if (e.alvo === this.ctx.meuId && !e.bloqueado) this.cameras.main.flash(80, 120, 0, 20);
        return;
      }
      case 'cura': {
        const p = this.posDe(e.alvo);
        if (p) this.flutuante(p.x, p.y - 30, `+${e.valor}`, '#7dffb0');
        return;
      }
      case 'pickup': {
        const p = this.pickups.get(e.pickup);
        if (!p) return;
        const g = efeito(p.x, p.y);
        g.lineStyle(3, e.item === 'vida' ? 0xe8ecf3 : 0xc9b8ff, 1).strokeCircle(0, 0, 18);
        sumir(g, 300);
        break;
      }
      case 'morte': {
        const v = this.visuais.get(e.alvo);
        const p = this.posDe(e.alvo);
        if (!p) return;
        const g = efeito(p.x, p.y);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          g.lineStyle(2, v?.cor ?? 0xffffff, 1).lineBetween(Math.cos(a) * 10, Math.sin(a) * 10, Math.cos(a) * 30, Math.sin(a) * 30);
        }
        sumir(g, 650);
        break;
      }
    }
  }
}
