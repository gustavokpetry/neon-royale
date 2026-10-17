import { describe, expect, it } from 'vitest';
import { CONFIG } from '@shared/config';
import { mover, posicaoLivre } from '@shared/colisao';
import { MAPAS } from '@shared/mapa';

const M = MAPAS.praca;
const OBSTACULOS = M.obstaculos;
const PICKUPS = M.pickups;
const INICIOS = M.nascimentos;
const AREAS_SEGURAS = M.areas;
import type { Efeito } from '@shared/protocolo';
import { aplicarDano, atacar, criarJogo, escudoCobre, mirar, protegido, receberComando, tick, usarAtiva, type EstadoJogo } from '../server/src/jogo';
import { HABILIDADES } from '@shared/personagens';
import { fatorVelocidade } from '@shared/movimento';

const T0 = 1_000_000;
const JA = T0 + CONFIG.partida.segContagem * 1000 + 10; // depois da contagem
function jogo(): EstadoJogo {
  return criarJogo([{ id: 'V', personagem: 'veni' }, { id: 'G', personagem: 'gut' }], T0);
}
/** Coloca os dois numa faixa aberta no alto da arena (y = 100, x de 360 a 910 sem obstáculos). */
function frente(e: EstadoJogo, dist: number) {
  const v = e.lutadores.get('V')!;
  const g = e.lutadores.get('G')!;
  v.x = 480;
  v.y = 100;
  g.x = 480 + dist;
  g.y = 100;
  return { v, g };
}
function rodar(e: EstadoJogo, seg: number, t0 = JA): Efeito[] {
  const efs: Efeito[] = [];
  for (let i = 1; i <= seg * 20; i++) tick(e, t0 + i * 50, efs);
  return efs;
}

describe('arena', () => {
  it('inícios livres, áreas seguras sem obstáculos e pickups acessíveis', () => {
    for (const n of INICIOS) expect(posicaoLivre(M, n.x, n.y)).toBe(true);
    for (const pk of PICKUPS) expect(posicaoLivre(M, pk.x, pk.y), pk.id).toBe(true);
    for (const a of AREAS_SEGURAS) expect(posicaoLivre(M, a.x, a.y)).toBe(true);
    expect(OBSTACULOS.length).toBeGreaterThan(10);
    for (let x = 360; x <= 1200; x += 10) expect(posicaoLivre(M, x, 100), `faixa x=${x}`).toBe(true);
  });

  it('deslizar numa parede nunca anda mais que o passo', () => {
    let p = { x: 480, y: 100 };
    for (let i = 0; i < 300; i++) {
      const a = (i / 30) * Math.PI;
      const n = mover(M, p.x, p.y, Math.cos(a) * 9, Math.sin(a) * 9);
      expect(Math.hypot(n.x - p.x, n.y - p.y)).toBeLessThanOrEqual(9.01);
      p = n;
    }
  });
});

describe('partida', () => {
  it('ninguém age durante a contagem', () => {
    const e = jogo();
    const g = e.lutadores.get('G')!;
    expect(atacar(e, g, -1, 0, T0 + 100, [])).toBe(false);
    receberComando(g, { seq: 1, x: -1, y: 0 });
    const x0 = g.x;
    tick(e, T0 + 150, []);
    expect(g.x).toBe(x0);
  });

  it('Gut é 40% mais rápido', () => {
    const e = jogo();
    const { v, g } = frente(e, 0);
    for (let i = 1; i <= 10; i++) {
      receberComando(v, { seq: i, x: 1, y: 0 });
      receberComando(g, { seq: i, x: 1, y: 0 });
    }
    const vx = v.x;
    const gx = g.x;
    rodar(e, 1);
    expect((g.x - gx) / (v.x - vx)).toBeCloseTo(1.4, 1);
  });

  it('flecha da Veni voa na direção da mira e explode em quem acerta', () => {
    const e = jogo();
    const { v, g } = frente(e, 200);
    expect(atacar(e, v, 1, 0, JA, [])).toBe(true);
    const efs = rodar(e, 1);
    expect(efs.some((x) => x.tipo === 'explosao')).toBe(true);
    expect(g.vida).toBeLessThan(CONFIG.vida.maxima);
  });

  it('sem mira automática: atirar para o lado errado não acerta', () => {
    const e = jogo();
    const { v, g } = frente(e, 200);
    atacar(e, v, 0, 1, JA, []);
    rodar(e, 1.5);
    expect(g.vida).toBe(CONFIG.vida.maxima);
  });

  it('teletransporte foge do inimigo mais próximo, com distância mínima', () => {
    const e = jogo();
    const { v, g } = frente(e, 300);
    const x0 = v.x;
    const y0 = v.y;
    const antes = Math.hypot(g.x - v.x, g.y - v.y);
    expect(usarAtiva(e, v, 1, 0, JA, [])).toBe(true);
    expect(Math.hypot(v.x - x0, v.y - y0)).toBeGreaterThanOrEqual(HABILIDADES.teletransporte.minimo - 1);
    expect(Math.hypot(g.x - v.x, g.y - v.y)).toBeGreaterThan(antes + 200);
    expect(posicaoLivre(M, v.x, v.y)).toBe(true);
    expect(v.preparada).toBe(true);
    expect(usarAtiva(e, v, 1, 0, JA + 1000, [])).toBe(false); // recarga
  });

  it('flecha preparada causa +50%', () => {
    const e = jogo();
    const { v, g } = frente(e, 300);
    v.preparada = true;
    atacar(e, v, 1, 0, JA, []);
    expect(v.preparada).toBe(false);
    rodar(e, 1);
    expect(CONFIG.vida.maxima - g.vida).toBeGreaterThanOrEqual(30); // 22 × 1,5
  });

  it('espada do Gut acerta só no arco à frente e deixa queimando', () => {
    const e = jogo();
    const { v, g } = frente(e, -40);
    atacar(e, g, 1, 0, JA, []);
    expect(v.vida).toBe(CONFIG.vida.maxima - 15);
    rodar(e, 3.5);
    expect(v.vida).toBe(CONFIG.vida.maxima - 15 - 9);
    const vida = v.vida;
    atacar(e, g, -1, 0, JA + 5000, []); // de costas
    expect(v.vida).toBe(vida);
  });

  it('giro do Gut acerta em volta e empurra', () => {
    const e = jogo();
    const { v, g } = frente(e, -50);
    const dist0 = Math.hypot(v.x - g.x, v.y - g.y);
    usarAtiva(e, g, 1, 0, JA, []);
    expect(v.vida).toBe(CONFIG.vida.maxima - 14);
    expect(Math.hypot(v.x - g.x, v.y - g.y)).toBeGreaterThan(dist0 + 40);
  });

  it('área segura protege o dono; atacar de lá desliga a proteção; no máximo 8 s seguidos', () => {
    const e = jogo();
    const v = e.lutadores.get('V')!;
    const g = e.lutadores.get('G')!;
    tick(e, JA, []);
    expect(protegido(v, JA)).toBe(true);
    g.x = v.x + 40;
    g.y = v.y;
    atacar(e, g, -1, 0, JA, []);
    expect(v.vida).toBe(CONFIG.vida.maxima);
    // a Veni atira de dentro da área: o tiro sai, mas ela perde a proteção
    expect(atacar(e, v, 1, 0, JA + 100, [])).toBe(true);
    expect(protegido(v, JA + 100)).toBe(false);
    // sair e voltar devolve a proteção
    v.x += 400;
    tick(e, JA + 150, []);
    v.x -= 400;
    tick(e, JA + 200, []);
    expect(protegido(v, JA + 200)).toBe(true);
    const depois = JA + 200 + CONFIG.areaSegura.segMaxSeguidos * 1000 + 50;
    tick(e, depois, []);
    expect(protegido(v, depois)).toBe(false);
  });

  it('pickups: vida cura e some por um tempo; força aumenta o dano', () => {
    const e = jogo();
    const { v, g } = frente(e, 200);
    const pv = PICKUPS.find((p) => p.tipo === 'vida')!;
    g.vida = 50;
    g.x = pv.x;
    g.y = pv.y;
    tick(e, JA, []);
    expect(g.vida).toBe(85);
    const pf = PICKUPS.find((p) => p.tipo === 'forca')!;
    g.x = pf.x;
    g.y = pf.y;
    tick(e, JA + 50, []);
    expect(g.forcaAte).toBeGreaterThan(JA);
    g.x = v.x + 40;
    g.y = v.y;
    atacar(e, g, -1, 0, JA + 100, []);
    expect(v.vida).toBe(CONFIG.vida.maxima - 23); // 15 × 1,5 = 22,5 → 23
  });

  it('qualquer obstáculo (inclusive o baixo) para a flecha e a espada', () => {
    const e = jogo();
    const baixo = OBSTACULOS.find((o) => o.tipo === 2 && o.h === 32 && o.w >= 128)!; // faixa horizontal
    const v = e.lutadores.get('V')!;
    const g = e.lutadores.get('G')!;
    const cx = baixo.x + baixo.w / 2;
    v.x = cx;
    v.y = baixo.y - 40;
    g.x = cx;
    g.y = baixo.y + baixo.h + 40;
    atacar(e, v, 0, 1, JA, []);
    rodar(e, 1);
    expect(g.vida).toBe(CONFIG.vida.maxima);
    g.y = baixo.y + baixo.h + 14;
    v.y = baixo.y - 14;
    atacar(e, g, 0, -1, JA + 2000, []);
    expect(v.vida).toBe(CONFIG.vida.maxima);
  });

  it('morte encerra a partida com o vencedor', () => {
    const e = jogo();
    const { v, g } = frente(e, -40);
    v.vida = 10;
    atacar(e, g, 1, 0, JA, []);
    expect(v.vivo).toBe(false);
    expect(e.fim).toEqual({ vencedorId: 'G' });
  });
});

describe('Vini', () => {
  function tres(): EstadoJogo {
    return criarJogo([{ id: 'V', personagem: 'veni' }, { id: 'G', personagem: 'gut' }, { id: 'W', personagem: 'vini' }], T0);
  }
  /** Vini e Gut na faixa aberta (y = 100); Veni longe. */
  function posicionar(e: EstadoJogo, dist: number) {
    const w = e.lutadores.get('W')!;
    const g = e.lutadores.get('G')!;
    w.x = 480;
    w.y = 100;
    g.x = 480 + dist;
    g.y = 100;
    const v = e.lutadores.get('V')!;
    v.x = 300;
    v.y = 700;
    return { w, g };
  }

  it('canhão: acerto direto causa dano e deixa poça onde caiu', () => {
    const e = tres();
    const { w, g } = posicionar(e, 200);
    expect(atacar(e, w, 1, 0, JA, [])).toBe(true);
    const efs = rodar(e, 1);
    expect(g.vida).toBe(CONFIG.vida.maxima - 14);
    expect(e.pocas).toHaveLength(1);
    expect(Math.abs(e.pocas[0]!.x - g.x)).toBeLessThan(20);
    expect(efs.some((x) => x.tipo === 'respingo')).toBe(true);
  });

  it('poça some depois de 4 s e no máximo 5 poças do canhão', () => {
    const e = tres();
    const { w } = posicionar(e, 2000);
    for (let k = 0; k < 7; k++) atacar(e, w, 1, 0, JA + k * 1000, []);
    rodar(e, 6);
    expect(e.pocas.filter((p) => p.dono === 'W').length).toBeLessThanOrEqual(HABILIDADES.tinta.maxPocas);
    rodar(e, 6, JA + 6000);
    expect(e.pocas).toHaveLength(0);
  });

  it('inimigo na poça anda 50% mais devagar; o Vini anda 30% mais rápido na própria tinta', () => {
    const e = tres();
    const { w, g } = posicionar(e, 300);
    e.pocas.push({ id: 99, dono: 'W', x: 700, y: 100, r: 400, ate: JA + 60_000, balde: true });
    const gx = g.x;
    const wx = w.x;
    for (let i = 1; i <= 10; i++) {
      receberComando(g, { seq: i, x: 1, y: 0 });
      receberComando(w, { seq: i, x: -1, y: 0 });
    }
    rodar(e, 0.5);
    const passoNormal = CONFIG.movimento.velocidadeBase * CONFIG.movimento.dtComando * 10;
    expect(g.x - gx).toBeCloseTo(passoNormal * 1.4 * HABILIDADES.tinta.lentidao, 0);
    expect(wx - w.x).toBeCloseTo(passoNormal * 1.3, 0);
  });

  it('Balde: poça grande em volta e empurra quem está perto', () => {
    const e = tres();
    const { w, g } = posicionar(e, 50);
    const d0 = Math.hypot(g.x - w.x, g.y - w.y);
    expect(usarAtiva(e, w, 1, 0, JA, [])).toBe(true);
    expect(e.pocas.some((p) => p.balde && p.r === HABILIDADES.balde.raio)).toBe(true);
    expect(Math.hypot(g.x - w.x, g.y - w.y)).toBeGreaterThan(d0 + 30);
    expect(usarAtiva(e, w, 1, 0, JA + 2000, [])).toBe(false);
  });

  it('partida com 3 jogadores termina quando sobra um', () => {
    const e = tres();
    e.lutadores.get('V')!.vida = 1;
    e.lutadores.get('G')!.vida = 1;
    const { w, g } = posicionar(e, 40);
    atacar(e, g, -1, 0, JA, []); // Gut acerta o Vini, não mata
    expect(e.fim).toBeNull();
    w.vida = 100;
    e.lutadores.get('V')!.vivo = false;
    atacar(e, w, 1, 0, JA + 10, []);
    rodar(e, 1);
    expect(e.fim).toEqual({ vencedorId: 'W' });
  });
});

describe('Daniel', () => {
  function jogoD(): EstadoJogo {
    return criarJogo([{ id: 'D', personagem: 'daniel' }, { id: 'G', personagem: 'gut' }, { id: 'V', personagem: 'veni' }], T0);
  }
  function lado(e: EstadoJogo, dist: number) {
    const d = e.lutadores.get('D')!;
    const g = e.lutadores.get('G')!;
    d.x = 480;
    d.y = 100;
    g.x = 480 + dist;
    g.y = 100;
    const v = e.lutadores.get('V')!;
    v.x = 300;
    v.y = 700;
    return { d, g, v };
  }

  it('estocada: alcance médio e arco estreito', () => {
    const e = jogoD();
    const { d, g } = lado(e, 75);
    atacar(e, d, 1, 0, JA, []);
    expect(g.vida).toBe(CONFIG.vida.maxima - 16);
    g.y = 140; // 40 px para o lado: fora do arco de 20°
    atacar(e, d, 1, 0, JA + 1000, []);
    expect(g.vida).toBe(CONFIG.vida.maxima - 16);
  });

  it('escudo bloqueia golpes de todos os lados', () => {
    const e = jogoD();
    const { d, g } = lado(e, 40);
    expect(usarAtiva(e, d, 1, 0, JA, [])).toBe(true);
    atacar(e, g, -1, 0, JA + 10, []);
    expect(d.vida).toBe(CONFIG.vida.maxima);
    g.x = d.x - 40; // atrás
    atacar(e, g, 1, 0, JA + 1000, []);
    expect(d.vida).toBe(CONFIG.vida.maxima);
  });

  it('escudo destrói a flecha que vem de frente e o Daniel pode atacar com ele erguido', () => {
    const e = jogoD();
    const { d, v } = lado(e, 400);
    v.x = d.x + 300;
    v.y = d.y;
    usarAtiva(e, d, 1, 0, JA, []);
    atacar(e, v, -1, 0, JA, []);
    const efs = rodar(e, 1);
    expect(efs.some((x) => x.tipo === 'defesa')).toBe(true);
    expect(d.vida).toBe(CONFIG.vida.maxima);
    expect(atacar(e, d, 1, 0, JA + 1000, [])).toBe(true);
  });

  it('o escudo acaba depois de 5 s', () => {
    const e = jogoD();
    const { d, g } = lado(e, 40);
    usarAtiva(e, d, 1, 0, JA, []);
    mirar(d, -1, 0);
    expect(escudoCobre(d, d.x + 40, d.y, JA + 4900)).toBe(true);
    expect(escudoCobre(d, d.x + 40, d.y, JA + 5100)).toBe(false);
    atacar(e, g, -1, 0, JA + 5100, []);
    expect(d.vida).toBe(CONFIG.vida.maxima - 15);
  });

  it('Chuva de agulhas: quando o escudo acaba, solta 12 projéteis em volta (3 cada)', () => {
    const e = jogoD();
    const { d, g } = lado(e, 120);
    usarAtiva(e, d, 1, 0, JA, []);
    rodar(e, 4.9);
    expect(e.projeteis).toHaveLength(0);
    rodar(e, 0.6, JA + 4900);
    expect(g.vida).toBe(CONFIG.vida.maxima - 3);
    expect(d.escudoAte).toBe(0);
  });

});

describe('Lucas', () => {
  function jogoL(): EstadoJogo {
    return criarJogo([{ id: 'L', personagem: 'lucas' }, { id: 'G', personagem: 'gut' }, { id: 'D', personagem: 'daniel' }], T0);
  }
  function lado(e: EstadoJogo, dist: number) {
    const l = e.lutadores.get('L')!;
    const g = e.lutadores.get('G')!;
    l.x = 640;
    l.y = 100;
    g.x = 640 + dist;
    g.y = 100;
    const d = e.lutadores.get('D')!;
    d.x = 300;
    d.y = 700;
    return { l, g, d };
  }

  it('raios acertam em volta, sem mira, e deixam lento por 1,2 s', () => {
    const e = jogoL();
    const { l, g, d } = lado(e, -60); // Gut à esquerda; o Lucas "mira" para a direita
    d.x = l.x + 70;
    d.y = l.y;
    atacar(e, l, 1, 0, JA, []);
    expect(g.vida).toBe(CONFIG.vida.maxima - 5);
    expect(d.vida).toBe(CONFIG.vida.maxima - 5);
    expect(g.chocadoAte).toBe(JA + 1200);
    const gx = g.x;
    receberComando(g, { seq: 1, x: -1, y: 0 });
    tick(e, JA + 50, []);
    expect(gx - g.x).toBeCloseTo(CONFIG.movimento.velocidadeBase * 1.4 * 0.7 * CONFIG.movimento.dtComando, 1);
  });

  it('tinta e choque não se somam: vale a maior lentidão', () => {
    expect(fatorVelocidade(0.65, true, false)).toBe(0.65);
    expect(fatorVelocidade(1, true, false)).toBe(0.7);
    expect(fatorVelocidade(1.3, true, false)).toBe(0.7); // choque anula o surfista
    expect(fatorVelocidade(1, false, true)).toBe(1.5);
  });

  it('onda de choque se expande com o tempo, causa dano e empurra; obstáculo protege', () => {
    const e = jogoL();
    const { l, g } = lado(e, 300);
    expect(usarAtiva(e, l, 1, 0, JA, [])).toBe(true);
    expect(g.vida).toBe(CONFIG.vida.maxima); // ainda não chegou a 300 px
    const x0 = g.x;
    rodar(e, 0.6);
    expect(g.vida).toBe(CONFIG.vida.maxima - 16);
    expect(g.x - x0).toBeGreaterThan(100);
    // atrás de um obstáculo: protegido
    const e2 = jogoL();
    const o = OBSTACULOS.find((x) => x.tipo === 1 && x.w === 32 && x.h >= 160)!; // parede vertical
    const l2 = e2.lutadores.get('L')!;
    const g2 = e2.lutadores.get('G')!;
    l2.x = o.x - 60;
    l2.y = o.y + o.h / 2;
    g2.x = o.x + o.w + 60;
    g2.y = l2.y;
    usarAtiva(e2, l2, 1, 0, JA, []);
    rodar(e2, 0.8);
    expect(g2.vida).toBe(CONFIG.vida.maxima);
  });

  it('estática: quem acerta o Lucas (com qualquer ataque) leva 2 de volta', () => {
    const e = jogoL();
    const { l, g, d } = lado(e, 40);
    atacar(e, g, -1, 0, JA, []);
    expect(l.vida).toBe(CONFIG.vida.maxima - 15);
    expect(g.vida).toBe(CONFIG.vida.maxima - 2);
    // projétil também: a estocada do Daniel é corpo a corpo, então troca para dano de projétil
    aplicarDano(e, l, 5, JA + 100, [], { x: d.x, y: d.y }, { autor: d, tipo: 'projetil' });
    expect(d.vida).toBe(CONFIG.vida.maxima - 2);
  });
});

describe('Pacheco', () => {
  const ARQ = MAPAS.arquipelago;
  function jogoP(mapa = M): EstadoJogo {
    return criarJogo([{ id: 'P', personagem: 'pacheco' }, { id: 'G', personagem: 'gut' }], T0, mapa);
  }
  function andar(e: EstadoJogo, id: string, dx: number, dy: number, seg: number, t0 = JA): void {
    const l = e.lutadores.get(id)!;
    const n = Math.round(seg * 20);
    for (let i = 1; i <= n; i++) {
      receberComando(l, { seq: l.seq + 1, x: dx, y: dy });
      tick(e, t0 + i * 50, []);
    }
  }
  const lago = ARQ.obstaculos.find((o) => o.tipo === 3 && o.w === 16 * 16)!; // lago grande (16 × 10 blocos)

  it('mangueira: 1 de dano por gota, 15 gotas por segundo', () => {
    const e = jogoP();
    const p = e.lutadores.get('P')!;
    const g = e.lutadores.get('G')!;
    p.x = 480;
    p.y = 100;
    g.x = 680;
    g.y = 100;
    expect(atacar(e, p, 1, 0, JA, [])).toBe(true);
    expect(atacar(e, p, 1, 0, JA + 50, [])).toBe(false);
    expect(atacar(e, p, 1, 0, JA + 67, [])).toBe(true);
    rodar(e, 1);
    expect(g.vida).toBe(CONFIG.vida.maxima - 2);
  });

  it('anda sobre a água; os outros não', () => {
    const e = jogoP(ARQ);
    const p = e.lutadores.get('P')!;
    const g = e.lutadores.get('G')!;
    for (const l of [p, g]) {
      l.x = lago.x - 30;
      l.y = lago.y + lago.h / 2;
    }
    g.y += 0.5;
    andar(e, 'P', 1, 0, 1);
    andar(e, 'G', 1, 0, 1);
    expect(p.x).toBeGreaterThan(lago.x + 60); // entrou no lago
    expect(g.x).toBeLessThanOrEqual(lago.x - 12 + 0.01); // parou na margem
  });

  it('voo passa por cima de paredes, mas não da borda, e pousa num ponto livre', () => {
    const e = jogoP();
    const p = e.lutadores.get('P')!;
    const parede = OBSTACULOS.find((o) => o.tipo === 1 && o.w === 32 && o.h >= 160)!;
    p.x = parede.x - 20;
    p.y = parede.y + parede.h / 2;
    expect(usarAtiva(e, p, 1, 0, JA, [])).toBe(true);
    andar(e, 'P', 1, 0, 0.6);
    expect(p.x).toBeGreaterThan(parede.x + parede.w); // atravessou
    // borda: voando para a esquerda até o limite
    const e2 = jogoP();
    const p2 = e2.lutadores.get('P')!;
    p2.x = 60;
    p2.y = 600;
    usarAtiva(e2, p2, -1, 0, JA, []);
    andar(e2, 'P', -1, 0, 1);
    expect(p2.x).toBeGreaterThanOrEqual(16 + 12 - 0.01);
    // pouso: termina o voo dentro da parede e é colocado num ponto livre
    const e3 = jogoP();
    const p3 = e3.lutadores.get('P')!;
    usarAtiva(e3, p3, 1, 0, JA, []);
    p3.x = parede.x + parede.w / 2;
    p3.y = parede.y + parede.h / 2;
    const efs = rodar(e3, 4.5);
    expect(posicaoLivre(M, p3.x, p3.y)).toBe(true);
    expect(efs.some((x) => x.tipo === 'voo' && x.pouso)).toBe(true);
  });
});
