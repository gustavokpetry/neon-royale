import { describe, expect, it } from 'vitest';
import { CONFIG } from '@shared/config';
import { MAPAS } from '@shared/mapa';
import { posicaoLivre as posicaoLivreM } from '@shared/colisao';
import { HABILIDADES as H, type IdPersonagem } from '@shared/personagens';
import type { Efeito } from '@shared/protocolo';
import { ativarSupernova, aplicarDano, atacar, criarJogo, raioZona, receberComando, snapshot, tick, trocarPersonagemAoRenascer, usarAtiva, type EstadoJogo, type Lutador } from '../server/src/jogo';

const T0 = 1_000_000;
const JA = T0 + CONFIG.partida.segContagem * 1000 + 10;
const MAX = CONFIG.vida.maxima;

/** Partida com os personagens dados; o primeiro fica em (480, 100) e os outros à direita, numa faixa aberta. */
function partida(...ps: IdPersonagem[]): { e: EstadoJogo; L: Lutador[] } {
  const e = criarJogo(ps.map((personagem, i) => ({ id: `J${i}`, personagem })), T0, MAPAS.praca);
  const L = ps.map((_, i) => e.lutadores.get(`J${i}`)!);
  L.forEach((l, i) => {
    l.x = 480 + i * 200;
    l.y = 100;
  });
  return { e, L };
}
function rodar(e: EstadoJogo, seg: number, t0 = JA): Efeito[] {
  const efs: Efeito[] = [];
  for (let i = 1; i <= Math.round(seg * 20); i++) tick(e, t0 + i * 50, efs);
  return efs;
}
function andar(e: EstadoJogo, l: Lutador, dx: number, dy: number, seg: number, t0 = JA): void {
  for (let i = 1; i <= Math.round(seg * 20); i++) {
    receberComando(l, { seq: l.seq + 1, x: dx, y: dy });
    tick(e, t0 + i * 50, []);
  }
}

describe('Sombra', () => {
  it('invisível some para os inimigos; atacar revela e o primeiro acerto causa +50%', () => {
    const { e, L: [s, g] } = partida('sombra', 'gut');
    g!.x = s!.x + 120;
    expect(usarAtiva(e, s!, 1, 0, JA, [])).toBe(true);
    expect(snapshot(e, JA, g!.id).lutadores.some((l) => l.id === s!.id)).toBe(false);
    expect(snapshot(e, JA, s!.id).lutadores.some((l) => l.id === s!.id)).toBe(true);
    atacar(e, s!, 1, 0, JA + 10, []);
    expect(snapshot(e, JA + 20, g!.id).lutadores.some((l) => l.id === s!.id)).toBe(true);
    rodar(e, 0.5);
    expect(g!.vida).toBe(MAX - 2 * Math.round(5 * 1.5)); // duas adagas com emboscada
  });

  it('pelas costas causa +30%', () => {
    const { e, L: [s, g] } = partida('sombra', 'gut');
    g!.x = s!.x + 120;
    g!.mira = { x: 1, y: 0 }; // o Gut está de costas para a Sombra
    atacar(e, s!, 1, 0, JA, []);
    rodar(e, 0.5);
    expect(g!.vida).toBe(MAX - 2 * Math.round(5 * 1.3));
  });
});

describe('Vampiro', () => {
  it('a seringa recupera 40% do dano; eliminar cura 10; o totem cura 5 por segundo', () => {
    const { e, L: [v, g] } = partida('vampiro', 'gut', 'veni');
    v!.vida = 50;
    atacar(e, v!, 1, 0, JA, []);
    rodar(e, 0.6);
    expect(g!.vida).toBe(MAX - 12);
    expect(v!.vida).toBe(50 + Math.round(12 * 0.4));
    const antes = v!.vida;
    g!.vida = 5;
    atacar(e, v!, 1, 0, JA + 2000, []);
    rodar(e, 0.6, JA + 2000);
    expect(g!.vivo).toBe(false);
    expect(v!.vida).toBe(antes + 2 + H.sede.cura); // 40% de 5 = 2, mais a Sede
    const v2 = v!.vida;
    usarAtiva(e, v!, 1, 0, JA + 3000, []);
    rodar(e, 2.1, JA + 3000);
    expect(v!.vida).toBe(Math.min(MAX, v2 + 3 * H.totem.curaPorSeg));
  });
});

describe('Engenheiro', () => {
  it('a parede bloqueia tiros e passagem; Blindado reduz dano de projéteis em 20%', () => {
    const { e, L: [eng, vam] } = partida('engenheiro', 'vampiro');
    expect(usarAtiva(e, eng!, 1, 0, JA, [])).toBe(true);
    expect(e.mapa.paredesTemp).toHaveLength(1);
    atacar(e, vam!, -1, 0, JA, []);
    rodar(e, 0.6);
    expect(eng!.vida).toBe(MAX); // a seringa bateu na parede
    vam!.x = eng!.x + 100;
    andar(e, vam!, -1, 0, 1, JA + 600);
    expect(vam!.x).toBeGreaterThan(e.mapa.paredesTemp[0]!.x + 16 - 0.01);
    rodar(e, 6, JA + 2000);
    expect(e.mapa.paredesTemp).toHaveLength(0); // sumiu depois de 5 s
    aplicarDano(e, eng!, 10, JA + 9000, [], undefined, { tipo: 'projetil' });
    expect(eng!.vida).toBe(MAX - 8);
  });
});

describe('Pescador', () => {
  it('o gancho puxa o inimigo até ele; o Gravidade não é puxado; o ímã pega pickups de longe', () => {
    const { e, L: [p, g, gr] } = partida('pescador', 'gut', 'gravidade');
    g!.x = p!.x + 300;
    gr!.y = 600;
    usarAtiva(e, p!, 1, 0, JA, []);
    rodar(e, 0.5);
    expect(g!.vida).toBe(MAX - H.gancho.dano);
    expect(Math.hypot(g!.x - p!.x, g!.y - p!.y)).toBeLessThan(H.gancho.distanciaFinal + 2);
    // Gravidade: Massa
    const { e: e2, L: [p2, gr2] } = partida('pescador', 'gravidade');
    gr2!.x = p2!.x + 300;
    usarAtiva(e2, p2!, 1, 0, JA, []);
    rodar(e2, 0.5);
    expect(gr2!.x).toBeCloseTo(p2!.x + 300, 0);
    // Ímã
    const pk = e.mapa.pickups.find((x) => x.tipo === 'forca')!;
    p!.x = pk.x - 140;
    p!.y = pk.y;
    tick(e, JA + 3000, []);
    expect(p!.forcaAte).toBeGreaterThan(JA + 3000);
  });
});

describe('Gravidade', () => {
  it('o orbe atravessa vários inimigos; o buraco negro puxa; Massa ignora empurrões', () => {
    const { e, L: [gr, a, b] } = partida('gravidade', 'veni', 'vini');
    a!.x = gr!.x + 100;
    b!.x = gr!.x + 200;
    atacar(e, gr!, 1, 0, JA, []);
    rodar(e, 1.6);
    expect(a!.vida).toBe(MAX - 9);
    expect(b!.vida).toBe(MAX - 9);
    // buraco negro a 220 px: quem está a 400 px é puxado
    const { e: e2, L: [g2, v2] } = partida('gravidade', 'veni');
    v2!.x = g2!.x + 400;
    usarAtiva(e2, g2!, 1, 0, JA, []);
    rodar(e2, 1.5);
    expect(v2!.x).toBeLessThan(g2!.x + 400 - 100);
    // Massa: o giro do Gut não empurra
    const { e: e3, L: [g3, gut] } = partida('gravidade', 'gut');
    gut!.x = g3!.x + 40;
    const x0 = g3!.x;
    usarAtiva(e3, gut!, -1, 0, JA, []);
    expect(g3!.x).toBe(x0);
  });
});

describe('Ilusionista', () => {
  it('o bumerangue acerta na ida e na volta; o clone absorve tiros; Fuga deixa invisível uma vez', () => {
    const { e, L: [il, g] } = partida('ilusionista', 'gut');
    g!.x = il!.x + 150;
    atacar(e, il!, 1, 0, JA, []);
    rodar(e, 1.6);
    expect(g!.vida).toBe(MAX - 18);
    // clone na frente absorve a seringa
    const { e: e2, L: [i2, vam] } = partida('ilusionista', 'vampiro');
    usarAtiva(e2, i2!, 1, 0, JA, []);
    expect(e2.entidades.filter((x) => x.tipo === 'clone')).toHaveLength(5);
    // os outros clones saem de perto; o primeiro fica parado na frente da seringa
    for (const c of e2.entidades) if (c.tipo === 'clone') c.y += 400;
    const primeiro = e2.entidades.find((x) => x.tipo === 'clone') as { x: number; y: number; parado: boolean };
    primeiro.x = i2!.x + 100;
    primeiro.y = i2!.y;
    primeiro.parado = true;
    atacar(e2, vam!, -1, 0, JA, []);
    rodar(e2, 0.6);
    expect(i2!.vida).toBe(MAX);
    expect(e2.entidades.filter((x) => x.tipo === 'clone')).toHaveLength(4);
    // Fuga
    aplicarDano(e2, i2!, 80, JA + 1000, []);
    expect(i2!.invisivelAte).toBeGreaterThan(JA + 1000);
    i2!.invisivelAte = 0;
    aplicarDano(e2, i2!, 5, JA + 2000, []);
    expect(i2!.invisivelAte).toBe(0); // só uma vez por partida
  });
});

describe('Atirador', () => {
  it('tiro carregado causa até +150%; a carga não passa do tempo segurado; Paciência; Corrida; frágil no corpo a corpo', () => {
    const { e, L: [at, g] } = partida('atirador', 'gut', 'veni');
    g!.x = at!.x + 300;
    at!.ultimoMovimento = JA + 1400; // acabou de andar: sem Paciência
    atacar(e, at!, 1, 0, JA + 1500, [], 1); // pronto desde 0: pode carregar tudo
    rodar(e, 0.5, JA + 1500);
    expect(g!.vida).toBe(MAX - 35);
    at!.ultimoMovimento = JA + 2000;
    atacar(e, at!, 1, 0, JA + 2600, [], 1); // só 0,1 s depois de pronto: carga ≈ 0,07
    rodar(e, 0.5, JA + 2600);
    expect(MAX - 35 - g!.vida).toBeLessThan(17);
    // Paciência: parado há mais de 1 s
    const { e: e2, L: [a2, g2] } = partida('atirador', 'gut');
    g2!.x = a2!.x + 300;
    a2!.ultimoMovimento = JA - 2000;
    atacar(e2, a2!, 1, 0, JA, []);
    rodar(e2, 0.5);
    expect(g2!.vida).toBe(MAX - Math.round(14 * 1.25));
    // Corrida: +50% por 3 s; e leva 25% mais de golpes corpo a corpo
    const { e: e3, L: [a3, gut] } = partida('atirador', 'gut');
    usarAtiva(e3, a3!, 1, 0, JA, []);
    const x0 = a3!.x;
    receberComando(a3!, { seq: 1, x: 1, y: 0 });
    tick(e3, JA + 50, []);
    expect(a3!.x - x0).toBeCloseTo(CONFIG.movimento.velocidadeBase * 1.5 * CONFIG.movimento.dtComando, 1);
    gut!.x = a3!.x + 40;
    gut!.y = a3!.y;
    atacar(e3, gut!, -1, 0, JA + 100, []);
    expect(a3!.vida).toBe(MAX - Math.round(15 * 1.25));
  });
});

describe('Granadeiro', () => {
  it('a granada passa por cima de paredes; chuva de 5; explode ao ser eliminado', () => {
    const { e, L: [gr, v] } = partida('granadeiro', 'veni');
    const parede = e.mapa.obstaculos.find((o) => o.tipo === 1 && o.w === 32 && o.h >= 160)!;
    gr!.x = parede.x - 60;
    gr!.y = parede.y + parede.h / 2;
    v!.x = gr!.x + 300;
    v!.y = gr!.y;
    atacar(e, gr!, 1, 0, JA, []);
    rodar(e, 1);
    expect(v!.vida).toBe(MAX - 18);
    const { e: e2, L: [g2] } = partida('granadeiro', 'veni');
    e2.aleatorio = () => 0.5;
    usarAtiva(e2, g2!, 1, 0, JA, []);
    const efs = rodar(e2, 2);
    expect(efs.filter((x) => x.tipo === 'explosao')).toHaveLength(5);
    const { e: e3, L: [g3, v3] } = partida('granadeiro', 'veni');
    v3!.x = g3!.x + 40;
    aplicarDano(e3, g3!, 200, JA, [], undefined, { autor: v3 });
    expect(v3!.vida).toBe(MAX - H.explosaoFinal.dano);
  });
});

describe('Armadilheiro', () => {
  it('a mina só aparece de perto, prende e causa dano; Faro vê invisíveis', () => {
    const { e, L: [ar, g] } = partida('armadilheiro', 'gut');
    usarAtiva(e, ar!, 1, 0, JA, []);
    ar!.x += 300;
    expect(snapshot(e, JA, g!.id).entidades.some((x) => x.tipo === 'mina')).toBe(false); // Gut a 200 px
    expect(snapshot(e, JA, ar!.id).entidades.some((x) => x.tipo === 'mina')).toBe(true);
    g!.x = 480;
    rodar(e, 1);
    expect(g!.vida).toBe(MAX - H.mina.dano);
    expect(g!.presoAte).toBeGreaterThan(JA);
    const { e: e2, L: [a2, s2] } = partida('armadilheiro', 'sombra');
    usarAtiva(e2, s2!, 1, 0, JA, []);
    expect(snapshot(e2, JA, a2!.id).lutadores.some((l) => l.id === s2!.id)).toBe(false); // a 200 px
    s2!.x = a2!.x + 120;
    expect(snapshot(e2, JA, a2!.id).lutadores.some((l) => l.id === s2!.id)).toBe(true);
  });
});

describe('Gelo', () => {
  it('cada acerto acumula frio; Congelar pega todos em volta por 1,5 s; Pele fria', () => {
    const { e, L: [ge, g, v] } = partida('gelo', 'gut', 'veni');
    g!.x = ge!.x + 100;
    v!.x = ge!.x - 100;
    atacar(e, ge!, 1, 0, JA, []);
    atacar(e, ge!, 1, 0, JA + 600, []);
    rodar(e, 1);
    expect(g!.frio.camadas).toBe(2);
    usarAtiva(e, ge!, 1, 0, JA + 1100, []);
    expect(g!.congeladoAte).toBe(JA + 1100 + 1500);
    expect(v!.congeladoAte).toBe(JA + 1100 + 1500); // agora congela todos em volta, com ou sem frio
    expect(atacar(e, g!, -1, 0, JA + 1200, [])).toBe(false); // congelado não ataca
    // Pele fria
    g!.congeladoAte = 0;
    g!.frio = { camadas: 0, ate: 0 };
    g!.x = ge!.x + 40;
    atacar(e, g!, -1, 0, JA + 5000, []);
    expect(g!.frio.camadas).toBe(H.peleFria.camadas);
  });
});

describe('Veneno', () => {
  it('veneno contínuo; nuvem tóxica; Antídoto ignora queimadura', () => {
    const { e, L: [ve, g] } = partida('veneno', 'gut');
    g!.x = ve!.x + 200;
    atacar(e, ve!, 1, 0, JA, []);
    rodar(e, 5);
    expect(g!.vida).toBe(MAX - 3 - 2 * 4);
    const { e: e2, L: [v2, g2] } = partida('veneno', 'gut');
    g2!.x = v2!.x + 200;
    usarAtiva(e2, v2!, 1, 0, JA, []);
    rodar(e2, 3.1);
    expect(g2!.vida).toBe(MAX - 3 * H.nuvem.danoPorSeg);
    g2!.x = v2!.x + 40;
    atacar(e2, g2!, -1, 0, JA + 4000, []);
    expect(v2!.dots).toHaveLength(0);
  });
});

describe('Hacker', () => {
  it('Pane deixa sem habilidade por 4 s; Glitch', () => {
    const { e, L: [h, v] } = partida('hacker', 'veni');
    v!.x = h!.x + 200;
    usarAtiva(e, h!, 1, 0, JA, []);
    rodar(e, 0.5);
    expect(v!.vida).toBe(MAX - H.pane.dano);
    expect(usarAtiva(e, v!, -1, 0, JA + 600, [])).toBe(false);
    expect(usarAtiva(e, v!, -1, 0, JA + 4700, [])).toBe(true);
    expect(snapshot(e, JA, v!.id).lutadores.find((l) => l.id === h!.id)!.estados).toContain('glitch');
  });
});

describe('Relojoeiro', () => {
  it('volta para onde estava 3 s atrás e recupera a vida se era maior', () => {
    const { e, L: [r] } = partida('relojoeiro', 'veni');
    rodar(e, 0.5);
    const x0 = r!.x;
    andar(e, r!, 0, 1, 3, JA + 500);
    r!.vida = 40;
    tick(e, JA + 3600, []);
    expect(usarAtiva(e, r!, 1, 0, JA + 3600, [])).toBe(true);
    expect(r!.x).toBeCloseTo(x0, 0);
    expect(r!.y).toBeLessThan(200);
    expect(r!.vida).toBe(MAX);
  });
});

describe('Berserker', () => {
  it('Sangue quente: mais dano com menos vida; Fúria acelera e rouba vida', () => {
    const { e, L: [b, g] } = partida('berserker', 'gut');
    g!.x = b!.x + 50;
    b!.vida = 50;
    atacar(e, b!, 1, 0, JA, []);
    expect(g!.vida).toBe(MAX - Math.round(18 * 1.25));
    usarAtiva(e, b!, 1, 0, JA + 1000, []);
    atacar(e, b!, 1, 0, JA + 1000, []);
    expect(b!.recargaAtaqueAte - (JA + 1000)).toBeCloseTo(1000 / 1.4, 0);
    expect(b!.vida).toBeGreaterThan(50);
  });
});

describe('Domador', () => {
  it('o drone atira sozinho no inimigo mais próximo; eliminar reduz a recarga em 5 s', () => {
    const { e, L: [d, g] } = partida('domador', 'gut', 'veni');
    g!.x = d!.x + 150;
    usarAtiva(e, d!, 1, 0, JA, []);
    rodar(e, 2);
    expect(g!.vida).toBeLessThan(MAX);
    const antes = d!.recargaAtivaAte;
    g!.vida = 1;
    atacar(e, d!, 1, 0, JA + 3000, []);
    rodar(e, 0.5, JA + 3000);
    expect(g!.vivo).toBe(false);
    expect(d!.recargaAtivaAte).toBe(antes - 5000);
  });
});

describe('Espelho', () => {
  it('Reflexo devolve o projétil para quem atirou; Duplicata deixa um reflexo', () => {
    const { e, L: [es, vam] } = partida('espelho', 'vampiro');
    usarAtiva(e, es!, 1, 0, JA, []);
    atacar(e, vam!, -1, 0, JA, []);
    rodar(e, 1);
    expect(es!.vida).toBe(MAX);
    expect(vam!.vida).toBe(MAX - 12);
    e.aleatorio = () => 0;
    aplicarDano(e, es!, 5, JA + 2000, []);
    expect(e.entidades.some((x) => x.tipo === 'clone' && x.dono === es!.id)).toBe(true);
  });
});

// ------------------------------------------------------------------ terceira leva
describe('Ninja', () => {
  it('shuriken quica na parede; Avanço corta quem está no caminho', () => {
    const { e, L: [n, g] } = partida('ninja', 'gut');
    // atira para cima: quica na borda e volta para baixo, onde está o Gut
    n!.y = 60;
    g!.x = n!.x;
    g!.y = 200;
    atacar(e, n!, 0, -1, JA, []);
    rodar(e, 1);
    expect(g!.vida).toBe(MAX - 7);
    const { e: e2, L: [n2, g2] } = partida('ninja', 'gut');
    g2!.x = n2!.x + 100;
    const x0 = n2!.x;
    usarAtiva(e2, n2!, 1, 0, JA, []);
    expect(n2!.x - x0).toBeGreaterThan(190);
    expect(g2!.vida).toBe(MAX - H.avanco.dano);
  });
});

describe('Tanque', () => {
  it('140 de vida, mais lento; a investida empurra e causa dano', () => {
    const { e, L: [t, g] } = partida('tanque', 'gut');
    expect(t!.vida).toBe(140);
    g!.x = t!.x + 80;
    const gx = g!.x;
    usarAtiva(e, t!, 1, 0, JA, []);
    expect(g!.vida).toBe(MAX - H.investida.dano);
    expect(g!.x).toBeGreaterThan(gx + 40);
  });
});

describe('Médico', () => {
  it('o kit cura e limpa efeitos; regenera depois de 3 s sem dano', () => {
    const { e, L: [m] } = partida('medico', 'gut');
    m!.vida = 40;
    m!.presoAte = JA + 5000;
    m!.dots = [{ tipo: 'veneno', dano: 2, tiques: 4, proximo: JA + 1000, de: 'J1' }];
    usarAtiva(e, m!, 1, 0, JA, []);
    expect(m!.vida).toBe(70);
    expect(m!.presoAte).toBe(0);
    expect(m!.dots).toHaveLength(0);
    m!.ultimoDanoRecebido = JA;
    rodar(e, 2.5);
    expect(m!.vida).toBe(70);
    rodar(e, 2, JA + 2500);
    expect(m!.vida).toBeGreaterThan(70);
  });
});

describe('Caçador', () => {
  it('boleadeira prende; Marcar dá +25% de dano de todos; Rastreador +20% em alvos lentos', () => {
    const { e, L: [c, g, v] } = partida('cacador', 'gut', 'vini');
    g!.x = c!.x + 200;
    v!.y = 600;
    atacar(e, c!, 1, 0, JA, []);
    rodar(e, 0.6);
    expect(g!.presoAte).toBeGreaterThan(JA);
    expect(g!.vida).toBe(MAX - 10);
    usarAtiva(e, c!, 1, 0, JA + 1000, []);
    rodar(e, 0.6, JA + 1000);
    expect(g!.marcadoAte).toBeGreaterThan(JA + 1000);
    const vida = g!.vida;
    aplicarDano(e, g!, 20, JA + 2000, [], undefined, { autor: v });
    expect(vida - g!.vida).toBe(25);
  });
});

describe('Laserista', () => {
  it('feixe instantâneo; Foco aumenta o dano no mesmo alvo; Sobrecarga recarrega na metade', () => {
    const { e, L: [l, g] } = partida('laserista', 'gut');
    g!.x = l!.x + 200;
    atacar(e, l!, 1, 0, JA, []);
    expect(g!.vida).toBe(MAX - 6);
    atacar(e, l!, 1, 0, JA + 500, []);
    expect(g!.vida).toBe(MAX - 6 - 7);
    usarAtiva(e, l!, 1, 0, JA + 1000, []);
    atacar(e, l!, 1, 0, JA + 1000, []);
    expect(l!.recargaAtaqueAte - (JA + 1000)).toBe(450 * 0.5);
  });
});

describe('Trocador', () => {
  it('Troca: trocam de lugar e o alvo fica lento', () => {
    const { e, L: [t, g] } = partida('trocador', 'gut');
    g!.x = t!.x + 200;
    const [tx, gx] = [t!.x, g!.x];
    usarAtiva(e, t!, 1, 0, JA, []);
    rodar(e, 0.5);
    expect(t!.x).toBeCloseTo(gx, 0);
    expect(g!.x).toBeCloseTo(tx, 0);
    expect(g!.chocadoAte).toBeGreaterThan(JA);
  });
});

describe('Bardo', () => {
  it('Refrão: o 4º acerto causa o dobro; Canção acelera', () => {
    const { e, L: [b, g] } = partida('bardo', 'gut');
    g!.x = b!.x + 150;
    for (let k = 0; k < 4; k++) atacar(e, b!, 1, 0, JA + k * 700, []);
    rodar(e, 3.5);
    expect(g!.vida).toBe(MAX - 8 * 3 - 16);
    usarAtiva(e, b!, 1, 0, JA + 4000, []);
    atacar(e, b!, 1, 0, JA + 4000, []);
    expect(b!.recargaAtaqueAte - (JA + 4000)).toBeCloseTo(650 / 1.35, 0);
  });
});

describe('Astro', () => {
  it('o meteoro cai depois de 1 s de aviso; eliminar recarrega na hora', () => {
    const { e, L: [a, g] } = partida('astro', 'gut', 'veni');
    g!.x = a!.x + 260;
    usarAtiva(e, a!, 1, 0, JA, []);
    rodar(e, 0.8);
    expect(g!.vida).toBe(MAX);
    rodar(e, 0.4, JA + 800);
    expect(g!.vida).toBe(MAX - H.meteoro.dano);
    g!.vida = 1;
    atacar(e, a!, 1, 0, JA + 2000, []);
    rodar(e, 1, JA + 2000);
    expect(g!.vivo).toBe(false);
    expect(a!.recargaAtivaAte).toBeLessThanOrEqual(JA + 3000);
  });
});

// ------------------------------------------------------------------ modos
describe('modos de jogo', () => {
  it('abates: quem morre renasce no próprio nascimento; o primeiro a 10 vence', () => {
    const e = criarJogo([{ id: 'A', personagem: 'gut' }, { id: 'B', personagem: 'veni' }], T0, MAPAS.praca, 'abates');
    const a = e.lutadores.get('A')!;
    const b = e.lutadores.get('B')!;
    expect(e.meta).toBe(10);
    b.vida = 1;
    aplicarDano(e, b, 5, JA, [], undefined, { autor: a });
    expect(b.vivo).toBe(false);
    expect(a.pontos).toBe(1);
    expect(e.fim).toBeNull();
    rodar(e, 2.2);
    expect(b.vivo).toBe(true);
    expect(b.x).toBe(MAPAS.praca.nascimentos[1]!.x);
    expect(b.vida).toBe(MAX);
    a.pontos = 9;
    b.vida = 1;
    b.x = 1000; // fora da área segura (lá dentro ele estaria protegido)
    b.areaDesde = null;
    aplicarDano(e, b, 5, JA + 3000, [], undefined, { autor: a });
    expect(e.fim).toEqual({ vencedorId: 'A' });
  });

  it('corrida: cada abate troca para o próximo personagem; morrer não troca; vence com todos', () => {
    const e = criarJogo([{ id: 'A', personagem: 'gut' }, { id: 'B', personagem: 'veni' }], T0, MAPAS.praca, 'corrida');
    const a = e.lutadores.get('A')!;
    const b = e.lutadores.get('B')!;
    expect(e.meta).toBe(30);
    b.vida = 1;
    aplicarDano(e, b, 5, JA, [], undefined, { autor: a });
    expect(a.personagem).toBe('vini'); // o próximo da lista depois do Gut
    expect(b.personagem).toBe('veni'); // quem morreu continua igual
    a.pontos = 29;
    rodar(e, 2.2);
    b.vida = 1;
    b.x = 1000;
    b.areaDesde = null;
    aplicarDano(e, b, 5, JA + 3000, [], undefined, { autor: a });
    expect(e.fim).toEqual({ vencedorId: 'A' });
  });
});

// ------------------------------------------------------------------ fase 2: equipes e Neoncalypse
describe('mata-mata em equipe', () => {
  function equipes() {
    const e = criarJogo(
      [
        { id: 'A1', personagem: 'veni', equipe: 0 },
        { id: 'B1', personagem: 'gut', equipe: 1 },
        { id: 'A2', personagem: 'lucas', equipe: 0 },
      ],
      T0,
      MAPAS.praca,
      'equipes',
      ['#ff3d9a', '#19d3e6'],
    );
    return { e, a1: e.lutadores.get('A1')!, b1: e.lutadores.get('B1')!, a2: e.lutadores.get('A2')! };
  }

  it('cada equipe nasce de um lado do mapa', () => {
    const { e, a1, a2, b1 } = equipes();
    const meio = e.mapa.largura / 2;
    expect(a1.x).toBeLessThan(meio);
    expect(a2.x).toBeLessThan(meio);
    expect(b1.x).toBeGreaterThan(meio);
  });

  it('sem fogo amigo: projétil atravessa o aliado, explosão e raios não ferem aliados', () => {
    const { e, a1, a2, b1 } = equipes();
    a1.x = 480;
    a1.y = 100;
    a2.x = 600;
    a2.y = 100;
    b1.x = 760;
    b1.y = 100;
    atacar(e, a1, 1, 0, JA, []); // a flecha passa pelo aliado e explode no inimigo
    rodar(e, 1);
    expect(a2.vida).toBe(MAX);
    expect(b1.vida).toBeLessThan(MAX);
    a2.x = b1.x - 40;
    atacar(e, a2, 1, 0, JA + 2000, []); // pulso do Lucas
    expect(b1.chocadoAte).toBeGreaterThan(JA + 2000);
    a1.x = a2.x - 50;
    a1.y = a2.y;
    atacar(e, a2, 1, 0, JA + 3000, []);
    expect(a1.vida).toBe(MAX);
    expect(a1.chocadoAte).toBe(0);
  });

  it('abates contam para a equipe; 25 vence; morto pode trocar de personagem antes de renascer', () => {
    const { e, a1, b1 } = equipes();
    expect(e.meta).toBe(25);
    b1.x = 1000;
    b1.vida = 1;
    aplicarDano(e, b1, 5, JA, [], undefined, { autor: a1 });
    expect(e.pontosEquipe).toEqual([1, 0]);
    expect(trocarPersonagemAoRenascer(e, b1, 'tanque')).toBe(true);
    expect(b1.personagem).toBe('tanque');
    rodar(e, 3.2);
    expect(b1.vivo).toBe(true);
    expect(b1.vida).toBe(140);
    expect(trocarPersonagemAoRenascer(e, b1, 'gut')).toBe(false); // vivo não troca
    e.pontosEquipe[0] = 24;
    b1.x = 1000;
    b1.areaDesde = null;
    b1.vida = 1;
    aplicarDano(e, b1, 5, JA + 4000, [], undefined, { autor: a1 });
    expect(e.fim).toEqual({ vencedorId: null, equipe: 0 });
  });
});

describe('Neoncalypse', () => {
  function neonJogo() {
    const e = criarJogo([{ id: 'A', personagem: 'gut' }, { id: 'B', personagem: 'veni' }], T0, MAPAS.praca, 'neoncalypse');
    return { e, a: e.lutadores.get('A')!, b: e.lutadores.get('B')! };
  }

  it('dano em dobro e recargas pela metade; sem área segura', () => {
    const { e, a, b } = neonJogo();
    tick(e, JA, []);
    expect(snapshot(e, JA).lutadores.find((l) => l.id === 'B')!.protegido).toBe(false);
    b.x = a.x - 40;
    b.y = a.y;
    atacar(e, a, -1, 0, JA, []);
    expect(b.vida).toBe(MAX - 30);
    expect(a.recargaAtaqueAte - JA).toBe(750 * 0.5);
    usarAtiva(e, a, 1, 0, JA + 100, []);
    expect(a.recargaAtivaAte - (JA + 100)).toBe(8_000 * 0.5);
  });

  it('a zona fecha para o centro e machuca quem está fora; quem morre não renasce', () => {
    const { e, a, b } = neonJogo();
    const r0 = raioZona(e, JA);
    expect(raioZona(e, JA + 45_000)).toBeLessThan(r0 * 0.8);
    expect(raioZona(e, JA + 400_000)).toBe(140);
    // depois de 2 minutos, os cantos ficam fora
    const t = JA + 120_000;
    e.ultimoTick = t - 50;
    tick(e, t, []);
    expect(a.vida).toBeLessThan(MAX);
    b.vida = 1;
    tick(e, t + 1100, []);
    expect(b.vivo).toBe(false);
    tick(e, t + 5000, []);
    expect(b.vivo).toBe(false);
  });
});

// ------------------------------------------------------------------ fase 3: Pega Bandeira
describe('Pega Bandeira', () => {
  function bandeira(modo: 'bandeira' | 'bandeiraEquipe' = 'bandeira') {
    const e = criarJogo(
      [
        { id: 'A', personagem: 'gut', equipe: 0 },
        { id: 'B', personagem: 'veni', equipe: 1 },
      ],
      T0,
      MAPAS.praca,
      modo,
    );
    return { e, a: e.lutadores.get('A')!, b: e.lutadores.get('B')! };
  }

  it('7 pontos livres em todos os mapas (simétricos nos mapas simétricos); o do centro é maior e vale mais', () => {
    for (const m of Object.values(MAPAS)) {
      const e = criarJogo([{ id: 'A', personagem: 'gut' }, { id: 'B', personagem: 'veni' }], T0, m, 'bandeira');
      expect(e.controle).toHaveLength(7);
      const centro = e.controle[0]!;
      expect(centro.x).toBe(m.largura / 2);
      expect(centro.r).toBeGreaterThan(e.controle[1]!.r);
      expect(centro.valor).toBe(3);
      for (const pc of e.controle) expect(posicaoLivreM(m, pc.x, pc.y), `${m.id} ${pc.id}`).toBe(true);
      if (m.simetrico) expect(e.controle[1]!.x + e.controle[2]!.x).toBe(m.largura);
    }
  });

  it('captura em 3 s sozinho; com outro jogador o ponto fica disputado', () => {
    const { e, a, b } = bandeira();
    const pc = e.controle[1]!;
    a.x = pc.x;
    a.y = pc.y;
    rodar(e, 2);
    expect(pc.dono).toBeNull();
    expect(pc.progresso).toBeGreaterThan(0.5);
    rodar(e, 1.2, JA + 2000);
    expect(pc.dono).toBe('A');
    // outro ponto: os dois em cima = disputado, ninguém captura
    const pc2 = e.controle[3]!;
    a.x = pc2.x;
    a.y = pc2.y;
    b.x = pc2.x + 10;
    b.y = pc2.y;
    rodar(e, 4, JA + 3200);
    expect(pc2.disputado).toBe(true);
    expect(pc2.dono).toBeNull();
  });

  it('pontos por segundo (centro vale 3); abates não pontuam; vence quem chega a 300', () => {
    const { e, a, b } = bandeira();
    e.controle[0]!.dono = 'A';
    e.controle[1]!.dono = 'B';
    a.x = 1000;
    b.x = 1200;
    rodar(e, 5);
    expect(a.pontos).toBeGreaterThanOrEqual(12);
    expect(b.pontos).toBeGreaterThanOrEqual(4);
    expect(a.pontos).toBe(b.pontos * 3);
    const pa = a.pontos;
    b.x = 1000;
    b.y = 600;
    b.areaDesde = null;
    b.vida = 1;
    aplicarDano(e, b, 5, JA + 5100, [], undefined, { autor: a });
    expect(a.pontos).toBe(pa);
    expect(trocarPersonagemAoRenascer(e, b, 'astro')).toBe(true);
    a.pontos = 299;
    rodar(e, 1.1, JA + 6000);
    expect(e.fim).toEqual({ vencedorId: 'A' });
  });

  it('em equipe, os pontos vão para a equipe; no fim do tempo vence quem tem mais', () => {
    const { e, a } = bandeira('bandeiraEquipe');
    e.controle[2]!.dono = 'e1';
    a.x = 1000;
    rodar(e, 2);
    expect(e.pontosEquipe[1]).toBeGreaterThan(0);
    e.ultimoTick = e.fimEm - 50;
    tick(e, e.fimEm, []);
    expect(e.fim).toEqual({ vencedorId: null, equipe: 1 });
  });
});

// ------------------------------------------------------------------ fase 4: Pintão
describe('Pintão', () => {
  function pintao(modo: 'pintao' | 'pintaoEquipe' = 'pintao') {
    const e = criarJogo(
      [
        { id: 'A', personagem: 'gut', equipe: 0 },
        { id: 'B', personagem: 'veni', equipe: 1 },
        { id: 'C', personagem: 'vini', equipe: 0 },
      ],
      T0,
      MAPAS.praca,
      modo,
    );
    return { e, a: e.lutadores.get('A')!, b: e.lutadores.get('B')!, c: e.lutadores.get('C')! };
  }

  it('andar pinta o chão; a meta é a área pintável; 3 minutos de partida', () => {
    const { e, a } = pintao();
    expect(e.meta).toBe(e.pintura!.pintaveis);
    expect(e.fimEm - T0).toBe((CONFIG.partida.segContagem + 180) * 1000);
    a.x = 480;
    a.y = 100;
    andar(e, a, 1, 0, 2);
    expect(a.pontos).toBeGreaterThan(15);
    expect(e.pintura!.mudancas.length).toBeGreaterThan(0);
  });

  it('tiros pintam onde caem; ao morrer perde o que pintou', () => {
    const { e, a, b } = pintao();
    b.x = 480;
    b.y = 100;
    atacar(e, b, 1, 0, JA, []);
    rodar(e, 1);
    expect(b.pontos).toBeGreaterThan(5);
    a.x = 1000;
    a.y = 600;
    andar(e, a, 0, 1, 1, JA + 1000);
    const pintadoA = a.pontos;
    expect(pintadoA).toBeGreaterThan(0);
    a.areaDesde = null;
    a.vida = 1;
    aplicarDano(e, a, 5, JA + 2100, [], undefined, { autor: b });
    tick(e, JA + 2150, []);
    expect(a.pontos).toBe(0);
    expect(b.pontos).toBeGreaterThan(5); // o do outro continua
  });

  it('em equipe, a tinta vai para a equipe; quem morre só apaga o que ele pintou; no fim vence a maior área', () => {
    const { e, a, c } = pintao('pintaoEquipe');
    a.x = 480;
    a.y = 100;
    c.x = 480;
    c.y = 600;
    andar(e, a, 1, 0, 1);
    andar(e, c, 1, 0, 1, JA + 1000);
    tick(e, JA + 2100, []);
    const total = e.pontosEquipe[0];
    expect(total).toBeGreaterThan(20);
    c.areaDesde = null;
    c.vida = 1;
    aplicarDano(e, c, 5, JA + 2200, [], undefined, { autor: e.lutadores.get('B') });
    tick(e, JA + 2250, []);
    expect(e.pontosEquipe[0]).toBeLessThan(total);
    expect(e.pontosEquipe[0]).toBeGreaterThan(0); // o que o A pintou continua
    e.ultimoTick = e.fimEm - 50;
    tick(e, e.fimEm, []);
    expect(e.fim).toEqual({ vencedorId: null, equipe: 0 });
  });

  it('snapshot leva as mudanças e, a cada 2 s, a grade completa', () => {
    const { e, a } = pintao();
    a.x = 480;
    a.y = 100;
    tick(e, JA, []);
    const s = snapshot(e, JA, a.id);
    expect(s.pintura!.completa).toBeDefined();
    expect(Buffer.from(s.pintura!.completa!, 'base64')).toHaveLength(s.pintura!.colunas * s.pintura!.linhas);
  });
});

// ------------------------------------------------------------------ lava, Supernova, lados
describe('lava', () => {
  it('queima 8 por segundo; quem foi empurrado para a lava dá o abate para quem empurrou', () => {
    const e = criarJogo([{ id: 'A', personagem: 'gut' }, { id: 'B', personagem: 'veni' }], T0, MAPAS.cratera, 'abates');
    const a = e.lutadores.get('A')!;
    const b = e.lutadores.get('B')!;
    const lava = e.mapa.obstaculos.find((o) => o.tipo === 4 && o.w >= 160)!;
    b.x = lava.x + lava.w / 2;
    b.y = lava.y + lava.h / 2;
    a.x = 300;
    a.y = 300;
    rodar(e, 0.95); // tiques de 4 a cada 0,5 s
    expect(b.vida).toBe(MAX - 8);
    // o Gut acerta a Veni e ela morre queimando: o abate é do Gut
    aplicarDano(e, b, 1, JA + 1100, [], { x: b.x - 10, y: b.y }, { autor: a });
    b.vida = 3;
    rodar(e, 1, JA + 1100);
    expect(b.vivo).toBe(false);
    expect(a.pontos).toBe(1);
  });

  it('o Pacheco voando não se queima', () => {
    const e = criarJogo([{ id: 'P', personagem: 'pacheco' }, { id: 'B', personagem: 'veni' }], T0, MAPAS.cratera);
    const p = e.lutadores.get('P')!;
    const lava = e.mapa.obstaculos.find((o) => o.tipo === 4 && o.w >= 160)!;
    usarAtiva(e, p, 1, 0, JA, []);
    p.x = lava.x + lava.w / 2;
    p.y = lava.y + lava.h / 2;
    rodar(e, 1);
    expect(p.vida).toBe(MAX);
  });
});

describe('Supernova', () => {
  it('aparece a cada 30 s num lugar livre; quem pega guarda; ao ativar: 5 s de dano em dobro, recargas pela metade e +50% de velocidade', () => {
    const { e, L: [g, v] } = partida('gut', 'veni');
    e.aleatorio = (() => {
      let s = 7;
      return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    })();
    tick(e, JA + 29_000, []);
    expect(e.supernova).toBeNull();
    e.ultimoTick = JA + 30_950;
    const efs: Efeito[] = [];
    tick(e, JA + 31_000, efs);
    expect(e.supernova).not.toBeNull();
    expect(efs.some((x) => x.tipo === 'supernova' && x.acao === 'surgiu')).toBe(true);
    g!.x = e.supernova!.x;
    g!.y = e.supernova!.y;
    tick(e, JA + 31_050, []);
    expect(g!.temSupernova).toBe(true);
    expect(e.supernova).toBeNull();
    // ativar
    expect(ativarSupernova(e, g!, JA + 32_000, [])).toBe(true);
    expect(g!.temSupernova).toBe(false);
    v!.x = g!.x - 40;
    v!.y = g!.y;
    v!.areaDesde = null;
    atacar(e, g!, -1, 0, JA + 32_000, []);
    expect(v!.vida).toBe(MAX - 30);
    expect(g!.recargaAtaqueAte - (JA + 32_000)).toBe(750 * 0.5);
    expect(ativarSupernova(e, g!, JA + 33_000, [])).toBe(false); // só uma vez
  });

  it('quem morre segurando a Supernova perde', () => {
    const { e, L: [g, v] } = partida('gut', 'veni');
    g!.temSupernova = true;
    g!.vida = 1;
    aplicarDano(e, g!, 5, JA, [], undefined, { autor: v });
    expect(g!.temSupernova).toBe(false);
  });
});

describe('equipes trocam de lado', () => {
  it('com os lados trocados, a equipe 0 nasce à direita', () => {
    const e = criarJogo([{ id: 'A', personagem: 'gut', equipe: 0 }, { id: 'B', personagem: 'veni', equipe: 1 }], T0, MAPAS.desfiladeiro, 'equipes', ['#ff3d9a', '#19d3e6'], true);
    expect(e.lutadores.get('A')!.x).toBeGreaterThan(e.mapa.largura / 2);
    expect(e.lutadores.get('B')!.x).toBeLessThan(e.mapa.largura / 2);
  });
});

describe('ajustes de equilíbrio', () => {
  it('Caçador: depois de marcar, as boleadeiras fazem curva até o alvo, com metade do dano', () => {
    const { e, L: [c, g] } = partida('cacador', 'gut');
    g!.x = c!.x + 200;
    usarAtiva(e, c!, 1, 0, JA, []);
    rodar(e, 0.6);
    expect(c!.marcaAlvo?.id).toBe(g!.id);
    const vida = g!.vida;
    g!.y = c!.y + 150; // saiu da linha de tiro
    atacar(e, c!, 1, 0, JA + 1000, []); // atira reto, mas a boleadeira segue o alvo
    rodar(e, 1.2, JA + 1000);
    expect(vida - g!.vida).toBe(Math.round(10 * 0.5 * 1.25));
  });

  it('Trocador: troca com o inimigo mais próximo; sem ninguém perto, não gasta', () => {
    const { e, L: [t, g, v] } = partida('trocador', 'gut', 'veni');
    v!.x = t!.x + 600;
    g!.x = t!.x + 200;
    const [tx, gx] = [t!.x, g!.x];
    expect(usarAtiva(e, t!, -1, 0, JA, [])).toBe(true);
    expect(t!.x).toBeCloseTo(gx, 0);
    expect(g!.x).toBeCloseTo(tx, 0);
    const { e: e2, L: [t2, g2] } = partida('trocador', 'gut');
    g2!.x = t2!.x + 900;
    expect(usarAtiva(e2, t2!, 1, 0, JA, [])).toBe(false);
    expect(t2!.recargaAtivaAte).toBe(0);
  });

  it('Relojoeiro: volta 5 s e solta um eco de 5 de dano onde chega', () => {
    const { e, L: [r, g] } = partida('relojoeiro', 'gut');
    rodar(e, 0.5);
    const [x0, y0] = [r!.x, r!.y];
    g!.x = x0 + 50;
    g!.y = y0;
    g!.vida = MAX;
    andar(e, r!, 0, 1, 4.5, JA + 500);
    tick(e, JA + 5100, []);
    usarAtiva(e, r!, 1, 0, JA + 5100, []);
    expect(r!.x).toBeCloseTo(x0, 0);
    expect(g!.vida).toBe(MAX - 5);
  });

  it('Pacheco: a lava queima o dobro', () => {
    const e = criarJogo([{ id: 'P', personagem: 'pacheco' }, { id: 'B', personagem: 'veni' }], T0, MAPAS.cratera);
    const p = e.lutadores.get('P')!;
    const lava = e.mapa.obstaculos.find((o) => o.tipo === 4 && o.w >= 160)!;
    p.x = lava.x + lava.w / 2;
    p.y = lava.y + lava.h / 2;
    rodar(e, 0.95);
    expect(p.vida).toBe(MAX - 16);
  });
});

// ------------------------------------------------------------------ mapas com mecânicas
describe('mecânicas dos mapas', () => {
  function em(mapa: keyof typeof MAPAS, ...ps: IdPersonagem[]) {
    const e = criarJogo(ps.map((personagem, i) => ({ id: `J${i}`, personagem })), T0, MAPAS[mapa]);
    return { e, L: ps.map((_, i) => e.lutadores.get(`J${i}`)!) };
  }
  const centroDe = (o: { x: number; y: number; w: number; h: number }) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });
  const passo = CONFIG.movimento.velocidadeBase * CONFIG.movimento.dtComando;

  it('lama deixa 40% mais lento', () => {
    const { e, L: [a] } = em('pantano', 'veni', 'vini');
    const lama = e.mapa.obstaculos.find((o) => o.tipo === 6 && o.w >= 300)!;
    Object.assign(a!, centroDe(lama));
    const x0 = a!.x;
    receberComando(a!, { seq: 1, x: 1, y: 0 });
    tick(e, JA + 50, []);
    expect(a!.x - x0).toBeCloseTo(passo * 0.6, 1);
  });

  it('gelo escorrega: depois de soltar o comando, continua andando', () => {
    const { e, L: [a] } = em('gelo', 'veni', 'vini');
    a!.x = 1600 - 200;
    a!.y = 1120;
    for (let i = 1; i <= 20; i++) {
      receberComando(a!, { seq: i, x: 1, y: 0 });
      tick(e, JA + i * 50, []);
    }
    const x0 = a!.x;
    for (let i = 21; i <= 26; i++) {
      receberComando(a!, { seq: i, x: 0, y: 0 });
      tick(e, JA + i * 50, []);
    }
    expect(a!.x - x0).toBeGreaterThan(20);
  });

  it('esteira arrasta quem está parado em cima', () => {
    const { e, L: [a] } = em('fabrica', 'veni', 'vini');
    const est = e.mapa.obstaculos.find((o) => o.tipo === 9 && o.w >= 300)!;
    Object.assign(a!, centroDe(est));
    const x0 = a!.x;
    for (let i = 1; i <= 10; i++) {
      receberComando(a!, { seq: i, x: 0, y: 0 });
      tick(e, JA + i * 50, []);
    }
    expect(a!.x - x0).toBeGreaterThan(50);
  });

  it('abismo: cair é morte na hora, e o abate vai para quem acertou', () => {
    const { e, L: [a, b] } = em('abismo', 'gut', 'veni');
    const e2 = criarJogo([{ id: 'A', personagem: 'gut' }, { id: 'B', personagem: 'veni' }], T0, MAPAS.abismo, 'abates');
    const [ga, vb] = [e2.lutadores.get('A')!, e2.lutadores.get('B')!];
    const buraco = e2.mapa.obstaculos.find((o) => o.tipo === 7)!;
    aplicarDano(e2, vb, 1, JA, [], undefined, { autor: ga });
    Object.assign(vb, centroDe(buraco));
    tick(e2, JA + 50, []);
    expect(vb.vivo).toBe(false);
    expect(ga.pontos).toBe(1);
    void e;
    void a;
    void b;
  });

  it('portal leva ao outro lado; trampolim lança até o destino por cima do muro', () => {
    const { e, L: [a] } = em('portais', 'veni', 'vini');
    const p = e.mapa.portais[0]!;
    Object.assign(a!, p.a);
    tick(e, JA, []);
    expect(Math.hypot(a!.x - p.b.x, a!.y - p.b.y)).toBeLessThan(2);
    const { e: e2, L: [b] } = em('trampolins', 'veni', 'vini');
    const tr = e2.mapa.trampolins[0]!;
    b!.x = tr.x;
    b!.y = tr.y;
    rodar(e2, 1.2);
    expect(Math.hypot(b!.x - tr.destino.x, b!.y - tr.destino.y)).toBeLessThan(20);
  });

  it('moita esconde de quem está longe; atacar revela; escuridão esconde fora da luz', () => {
    const { e, L: [a, b] } = em('selva', 'veni', 'vini');
    const mato = e.mapa.obstaculos.find((o) => o.tipo === 5)!;
    Object.assign(a!, centroDe(mato));
    b!.x = a!.x + 300;
    b!.y = a!.y;
    expect(snapshot(e, JA, b!.id).lutadores.some((l) => l.id === a!.id)).toBe(false);
    b!.x = a!.x + 80;
    expect(snapshot(e, JA, b!.id).lutadores.some((l) => l.id === a!.id)).toBe(true);
    b!.x = a!.x + 300;
    atacar(e, a!, 1, 0, JA, []);
    expect(snapshot(e, JA + 100, b!.id).lutadores.some((l) => l.id === a!.id)).toBe(true);
    // Apagão: longe e fora das luzes, ninguém vê
    const { e: e2, L: [c, d] } = em('apagao', 'veni', 'vini');
    c!.x = 400;
    c!.y = 1500;
    d!.x = 400 + 500;
    d!.y = 1500;
    expect(snapshot(e2, JA, d!.id).lutadores.some((l) => l.id === c!.id)).toBe(false);
    d!.x = 400 + 200;
    expect(snapshot(e2, JA, d!.id).lutadores.some((l) => l.id === c!.id)).toBe(true);
  });

  it('paredes dinâmicas abrem e fecham; muros quebram com tiros', () => {
    const { e } = em('labirintoVivo', 'veni', 'vini');
    const din = e.mapa.dinamicas[0]!;
    tick(e, T0 + 1000, []);
    const fechada1 = e.mapa.paredesTemp.includes(din.ret);
    e.ultimoTick = T0 + 11_000;
    tick(e, T0 + 11_050, []);
    const fechada2 = e.mapa.paredesTemp.includes(din.ret);
    expect(fechada1).not.toBe(fechada2);
    // Demolição: o Tanque derruba um muro em alguns tiros
    const { e: e2, L: [t] } = em('demolicao', 'tanque', 'vini');
    const muro = e2.muros[0]!;
    t!.x = muro.ret.x - 80;
    t!.y = muro.ret.y + muro.ret.h / 2;
    for (let k = 0; k < 4; k++) atacar(e2, t!, 1, 0, JA + k * 1500, []);
    rodar(e2, 7);
    expect(e2.muros.some((m) => m.id === muro.id)).toBe(false);
  });
});
