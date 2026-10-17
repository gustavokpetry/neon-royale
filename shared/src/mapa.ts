/**
 * Mapas: sandbox cinza escuro, simétricos nos dois eixos (o que está num quadrante se repete
 * espelhado nos outros três), centro aberto e áreas com cara própria.
 * Gerados em código (determinísticos): o mesmo mapa no servidor e no cliente, sem arquivos de arte.
 * Grade de blocos de 16 px para colisão.
 */

export const BLOCO = 16;

/**
 * Tipos de bloco. Sólidos: 1 (obstáculo), 2 (mureta), 3 (água; o Pacheco atravessa).
 * Pisáveis: 0 (chão), 4 (lava: queima), 5 (mato: esconde), 6 (lama: deixa lento), 7 (abismo: cair é morte),
 * 8 (gelo: escorrega), 9–12 (esteira para direita, esquerda, baixo, cima).
 */
export type Bloco = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export const T = { LIVRE: 0, ALTO: 1, MURETA: 2, AGUA: 3, LAVA: 4, MATO: 5, LAMA: 6, ABISMO: 7, GELO: 8, ESTEIRA_D: 9, ESTEIRA_E: 10, ESTEIRA_B: 11, ESTEIRA_C: 12 } as const;
/** Direção de cada esteira. */
export const ESTEIRAS: Record<number, [number, number]> = { 9: [1, 0], 10: [-1, 0], 11: [0, 1], 12: [0, -1] };
/** Perigos: lugares importantes (nascimentos, pickups, pontos) nunca ficam neles. */
export const ehPerigo = (b: number) => b === T.LAVA || b === T.ABISMO;
export const IDS_MAPAS = [
  'praca', 'fortaleza', 'arquipelago', 'labirinto', 'cidade', 'rio', 'colmeia', 'encruzilhada', 'ruinas', 'vulcao', 'cratera', 'desfiladeiro',
  'coliseu', 'fortes', 'ilhasLava', 'selva', 'pantano', 'abismo', 'portais', 'trampolins', 'gelo', 'fabrica', 'apagao', 'labirintoVivo', 'demolicao',
] as const;
export type IdMapa = (typeof IDS_MAPAS)[number];

export interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
  tipo: Bloco;
}

/** Área segura de uma vaga (0–5); a cor é a do personagem de quem ocupa a vaga. */
export interface AreaSegura {
  vaga: number;
  x: number;
  y: number;
  raio: number;
}

export interface PontoPickup {
  id: string;
  tipo: 'vida' | 'forca';
  x: number;
  y: number;
}

/** Piso decorativo de uma área do mapa (só visual). */
export interface Zona {
  x: number;
  y: number;
  w: number;
  h: number;
  cor: string;
}

export interface Mapa {
  id: IdMapa;
  nome: string;
  descricao: string;
  colunas: number;
  linhas: number;
  largura: number;
  altura: number;
  grade: Uint8Array;
  obstaculos: Retangulo[];
  areas: AreaSegura[];
  /** 6 nascimentos simétricos, um por vaga (ordem de entrada na sala). */
  nascimentos: Array<{ x: number; y: number }>;
  pickups: PontoPickup[];
  zonas: Zona[];
  /** Paredes temporárias da partida (Engenheiro). Cada partida usa a sua cópia do mapa. */
  paredesTemp: Retangulo[];
  /** Mapas espelhados nos dois eixos (o Desfiladeiro não é). */
  simetrico: boolean;
  /** Pontos do Pega Bandeira desenhados à mão (o primeiro é o maior); senão são posicionados sozinhos. */
  controle?: Array<{ x: number; y: number }>;
  /** Feito para o Pega Bandeira: só estes mapas aceitam esse modo. */
  paraBandeira: boolean;
  /** Portais: entrar num leva ao outro do par. */
  portais: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>;
  /** Trampolins: pisar lança o jogador até o destino, por cima de tudo. */
  trampolins: Array<{ x: number; y: number; destino: { x: number; y: number } }>;
  /** Paredes que abrem e fecham: fechadas quando (tempo + fase) % periodo < fechado (segundos). */
  dinamicas: Array<{ ret: Retangulo; periodo: number; fechado: number; fase: number }>;
  /** Muros que quebram com tiros e explosões. */
  destrutiveis: Retangulo[];
  /** Mapa escuro: só se vê perto de si e perto das luzes. */
  escuro?: { raioVisao: number; luzes: Array<{ x: number; y: number; r: number }> };
}

/** Peça em blocos: coluna, linha, largura, altura, tipo. */
export type Peca = [number, number, number, number, Bloco];

/** Sala com paredes de 2 blocos e uma porta no meio de cada lado. */
function sala(c: number, r: number, w: number, h: number, porta = 6): Peca[] {
  const a = Math.floor((w - porta) / 2);
  const b = Math.floor((h - porta) / 2);
  return [
    [c, r, a, 2, 1],
    [c + a + porta, r, w - a - porta, 2, 1],
    [c, r + h - 2, a, 2, 1],
    [c + a + porta, r + h - 2, w - a - porta, 2, 1],
    [c, r, 2, b, 1],
    [c, r + b + porta, 2, h - b - porta, 1],
    [c + w - 2, r, 2, b, 1],
    [c + w - 2, r + b + porta, 2, h - b - porta, 1],
  ];
}

export interface DefinicaoMapa {
  id: IdMapa;
  nome: string;
  descricao: string;
  colunas?: number;
  linhas?: number;
  /** Peças do quadrante superior esquerdo (espelhadas para os outros três). */
  quadrante: Peca[];
  /** Pickups do quadrante (espelhados) e do centro. */
  pickups: Array<{ tipo: 'vida' | 'forca'; c: number; r: number }>;
  pickupsCentro: Array<{ tipo: 'vida' | 'forca'; c: number; r: number }>;
  zonas: Array<[number, number, number, number, string]>;
  /** Sem espelhamento: as peças, pickups e zonas valem para o mapa inteiro. */
  assimetrico?: boolean;
  /** Pontos do Pega Bandeira em blocos (o primeiro é o maior). */
  controle?: Array<[number, number]>;
  /** Mapa feito para o Pega Bandeira. */
  paraBandeira?: boolean;
  /** Pares de portais e trampolins (em blocos, mapa inteiro, sem espelhar). */
  portais?: Array<[[number, number], [number, number]]>;
  trampolins?: Array<[[number, number], [number, number]]>;
  /** Paredes dinâmicas e muros destrutíveis (do quadrante; espelhados como as peças). */
  dinamicas?: Array<{ peca: [number, number, number, number]; periodo: number; fechado: number; fase?: number }>;
  destrutiveis?: Array<[number, number, number, number]>;
  /** Escuridão: raio de visão (px) e luzes do quadrante [coluna, linha, raio em px]. */
  escuro?: { raioVisao: number; luzes: Array<[number, number, number]> };
}

/** Monta um mapa simétrico a partir de um quadrante (também usado nos testes). */
export function construirMapa(d: DefinicaoMapa): Mapa {
  const C = d.colunas ?? 200;
  const L = d.linhas ?? 140;
  const espelhar = <T extends [number, number, number, number, ...unknown[]]>(p: T): T[] => {
    if (d.assimetrico) return [p];
    const [c, r, w, h, ...resto] = p;
    // esteiras: no espelho horizontal, direita vira esquerda; no vertical, baixo vira cima
    const espH = (x: unknown) => (x === 9 ? 10 : x === 10 ? 9 : x);
    const espV = (x: unknown) => (x === 11 ? 12 : x === 12 ? 11 : x);
    const copias = [
      [c, r, w, h, ...resto],
      [C - c - w, r, w, h, ...resto.map(espH)],
      [c, L - r - h, w, h, ...resto.map(espV)],
      [C - c - w, L - r - h, w, h, ...resto.map((x) => espH(espV(x)))],
    ] as T[];
    const vistos = new Set<string>();
    return copias.filter((x) => {
      const k = x.slice(0, 4).join(',');
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };
  const pecas = d.quadrante.flatMap((p) => espelhar(p));
  const obstaculos: Retangulo[] = pecas.map(([c, r, w, h, tipo]) => ({ x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, tipo }));

  const grade = new Uint8Array(C * L);
  for (let r = 0; r < L; r++) for (let c = 0; c < C; c++) if (r === 0 || c === 0 || r === L - 1 || c === C - 1) grade[r * C + c] = 1;
  for (const [c, r, w, h, tipo] of pecas) {
    for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) grade[rr * C + cc] = tipo;
  }

  // nascimentos simétricos: 4 cantos e o meio das bordas esquerda e direita
  const p = (c: number, r: number) => ({ x: c * BLOCO, y: r * BLOCO });
  const nascimentos = [p(8, 8), p(C - 8, L - 8), p(C - 8, 8), p(8, L - 8), p(8, L / 2), p(C - 8, L / 2)];
  const areas: AreaSegura[] = nascimentos.map((n, vaga) => ({ vaga, ...n, raio: 96 }));

  let n = 0;
  const pickups: PontoPickup[] = [];
  for (const pk of d.pickups) {
    for (const [c, r] of espelhar([pk.c, pk.r, 0, 0] as [number, number, number, number])) {
      pickups.push({ id: `${pk.tipo[0]}${++n}`, tipo: pk.tipo, x: c * BLOCO, y: r * BLOCO });
    }
  }
  for (const pk of d.pickupsCentro) pickups.push({ id: `${pk.tipo[0]}${++n}`, tipo: pk.tipo, x: pk.c * BLOCO, y: pk.r * BLOCO });

  const zonas: Zona[] = d.zonas.flatMap((z) => espelhar(z)).map(([c, r, w, h, cor]) => ({ x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, cor }));

  return {
    id: d.id,
    nome: d.nome,
    descricao: d.descricao,
    colunas: C,
    linhas: L,
    largura: C * BLOCO,
    altura: L * BLOCO,
    grade,
    obstaculos,
    areas,
    nascimentos,
    pickups,
    zonas,
    paredesTemp: [],
    simetrico: !d.assimetrico,
    paraBandeira: !!d.paraBandeira,
    portais: (d.portais ?? []).map(([a, b]) => ({ a: { x: a[0] * BLOCO, y: a[1] * BLOCO }, b: { x: b[0] * BLOCO, y: b[1] * BLOCO } })),
    trampolins: (d.trampolins ?? []).map(([a, b]) => ({ x: a[0] * BLOCO, y: a[1] * BLOCO, destino: { x: b[0] * BLOCO, y: b[1] * BLOCO } })),
    dinamicas: (d.dinamicas ?? []).flatMap((x) =>
      espelhar([...x.peca, 0] as [number, number, number, number, number]).map(([c, r, w, h]) => ({
        ret: { x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, tipo: 1 as Bloco },
        periodo: x.periodo,
        fechado: x.fechado,
        fase: x.fase ?? 0,
      })),
    ),
    destrutiveis: (d.destrutiveis ?? []).flatMap((x) => espelhar([...x, 0] as [number, number, number, number, number]).map(([c, r, w, h]) => ({ x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, tipo: 1 as Bloco }))),
    ...(d.escuro
      ? {
          escuro: {
            raioVisao: d.escuro.raioVisao,
            luzes: d.escuro.luzes.flatMap(([c, r, raio]) => espelhar([c, r, 0, 0, raio] as [number, number, number, number, number]).map(([x, y, , , rr]) => ({ x: x * BLOCO, y: y * BLOCO, r: rr as number }))),
          },
        }
      : {}),
    ...(d.controle ? { controle: d.controle.map(([c, r]) => ({ x: c * BLOCO, y: r * BLOCO })) } : {}),
  };
}

const pilares = (c0: number, r0: number, nc: number, nr: number, passo: number, tam = 2): Peca[] => {
  const out: Peca[] = [];
  for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) out.push([c0 + i * passo, r0 + j * passo, tam, tam, 1]);
  return out;
};

const PRACA = construirMapa({
  id: 'praca',
  nome: 'Praça',
  descricao: 'Praça central com pilares, galpões com portas, bosque de pilares e muretas.',
  quadrante: [
    ...sala(24, 18, 22, 16), // galpão
    ...pilares(56, 10, 4, 3, 7), // bosque de pilares
    [60, 38, 14, 2, 2], // muretas
    [40, 46, 2, 12, 2],
    [86, 24, 2, 14, 1], // corredor para o centro
    [84, 54, 3, 3, 1], // pilares da praça central
    [92, 6, 8, 2, 1], // marco no meio da borda
    [20, 56, 2, 10, 1], // cobertura perto do nascimento do meio
    [62, 62, 8, 2, 2],
    ...sala(64, 44, 14, 12), // quiosque perto do centro
    [8, 30, 10, 2, 2],
    [30, 64, 10, 2, 1],
  ],
  pickups: [
    { tipo: 'vida', c: 35, r: 26 },
    { tipo: 'forca', c: 60, r: 14 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [
    [80, 50, 20, 20, '#1a1e27'], // praça central
    [26, 20, 18, 12, '#171b22'], // dentro do galpão
    [54, 8, 28, 22, '#141a17'], // bosque
  ],
});

const FORTALEZA = construirMapa({
  id: 'fortaleza',
  nome: 'Fortaleza',
  descricao: 'Muralha no centro com quatro portões, corredores longos e quartéis.',
  quadrante: [
    [72, 42, 24, 2, 1], // muralha (portão norte entre as metades)
    [72, 42, 2, 24, 1], // muralha (portão oeste)
    [88, 58, 3, 3, 1], // pilares dentro da fortaleza
    [26, 14, 34, 2, 1], // corredor
    [26, 24, 34, 2, 1],
    ...sala(30, 40, 20, 16), // quartel
    [56, 34, 10, 2, 2],
    [60, 56, 2, 8, 2],
    [96, 8, 4, 6, 1],
    [22, 58, 2, 8, 1],
    ...pilares(8, 32, 2, 2, 8), // pilares perto do nascimento
    [62, 8, 2, 10, 1],
    [38, 64, 12, 2, 2],
  ],
  pickups: [
    { tipo: 'vida', c: 40, r: 48 },
    { tipo: 'forca', c: 44, r: 19 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [
    [74, 44, 26, 26, '#1b1d24'], // pátio da fortaleza
    [26, 16, 34, 8, '#16191f'], // corredor
    [32, 42, 16, 12, '#181b21'], // quartel
  ],
});

const ARQUIPELAGO = construirMapa({
  id: 'arquipelago',
  nome: 'Arquipélago',
  descricao: 'Lagos que bloqueiam a passagem mas não os tiros, rochas e ilhas.',
  quadrante: [
    [30, 20, 16, 10, 3], // lago
    [60, 44, 12, 12, 3], // lago
    [84, 50, 8, 6, 3], // lagos em volta do centro (caminhos em cruz)
    [52, 12, 3, 3, 1], // rochas
    [56, 16, 3, 3, 1],
    [50, 18, 3, 3, 1],
    [20, 40, 4, 2, 1],
    [24, 44, 2, 4, 1],
    [70, 24, 12, 2, 2],
    [40, 58, 2, 8, 2],
    [92, 10, 8, 3, 1],
    [22, 56, 2, 8, 1],
    [8, 26, 6, 8, 3], // lagoa perto do nascimento
    [76, 30, 3, 3, 1],
    [34, 64, 6, 2, 2],
    [74, 8, 3, 3, 1],
  ],
  pickups: [
    { tipo: 'vida', c: 38, r: 34 },
    { tipo: 'forca', c: 66, r: 38 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [
    [78, 48, 22, 22, '#191c22'],
    [48, 10, 14, 12, '#18181c'],
  ],
});

const LABIRINTO = construirMapa({
  id: 'labirinto',
  nome: 'Labirinto',
  descricao: 'Anéis de muros em volta do centro, com passagens estreitas e becos.',
  quadrante: [
    [44, 16, 48, 2, 1], // anel externo (topo e lado), com aberturas no canto e no meio
    [30, 26, 2, 30, 1],
    [60, 30, 32, 2, 1], // anel do meio
    [60, 30, 2, 32, 1],
    [80, 46, 8, 2, 1], // anel interno (pedaços)
    [76, 50, 2, 8, 1],
    [92, 22, 2, 8, 1], // gargalos perto do eixo
    [44, 40, 12, 2, 1],
    [40, 26, 2, 10, 1],
    [66, 40, 8, 2, 2],
    [20, 44, 6, 2, 1],
    [70, 18, 2, 8, 1],
  ],
  pickups: [
    { tipo: 'vida', c: 46, r: 46 },
    { tipo: 'forca', c: 70, r: 36 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [
    [62, 32, 38, 38, '#181a22'],
    [32, 18, 28, 12, '#15181e'],
  ],
});

/** Quarteirões (12 × 10 blocos) separados por ruas de 6. */
const quarteiroes = (): Peca[] => {
  const out: Peca[] = [];
  for (const c of [20, 38, 56, 74]) for (const r of [16, 32, 48]) out.push([c, r, 12, 10, 1]);
  return out;
};

const CIDADE = construirMapa({
  id: 'cidade',
  nome: 'Cidade',
  descricao: 'Quarteirões em grade com ruas retas, cercas baixas e uma praça no centro.',
  quadrante: [
    ...quarteiroes(),
    [38, 60, 12, 2, 2], // cercas
    [58, 62, 2, 6, 2],
    [26, 28, 2, 3, 2],
  ],
  pickups: [
    { tipo: 'vida', c: 34, r: 29 },
    { tipo: 'forca', c: 52, r: 44 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [
    [86, 58, 14, 12, '#1a1e27'], // praça
    [18, 26, 82, 6, '#14171c'], // avenida
  ],
});

const RIO = construirMapa({
  id: 'rio',
  nome: 'Rio',
  descricao: 'Rios cruzando o mapa com pontes estreitas; campos abertos com poucas pedras.',
  quadrante: [
    [14, 30, 26, 6, 3], // rio horizontal com duas pontes
    [48, 30, 28, 6, 3],
    [84, 30, 16, 6, 3],
    [46, 42, 6, 10, 3], // rio vertical com ponte
    [46, 58, 6, 12, 3],
    [24, 12, 3, 3, 1], // pedras
    [60, 14, 3, 3, 1],
    [70, 48, 3, 3, 1],
    [30, 50, 3, 3, 1],
    [86, 52, 3, 3, 1],
    [62, 20, 10, 2, 2],
  ],
  pickups: [
    { tipo: 'vida', c: 40, r: 22 },
    { tipo: 'forca', c: 60, r: 42 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [
    [52, 36, 48, 34, '#161b18'],
    [14, 36, 32, 34, '#171a16'],
  ],
});

/** Sorteio fixo (sempre o mesmo para a mesma posição): deixa os mapas "irregulares" e iguais em toda partida. */
const sorteio = (i: number, j: number, n: number) => (((i * 73856093) ^ (j * 19349663) ^ 0x5bd1e995) >>> 0) % n;

/** Mureta em volta de um ponto do Pega Bandeira, com 4 entradas (só a parte que cai no quadrante). */
function praca(pc: number, pr: number, raio = 9, tipo: 1 | 2 = 2): Peca[] {
  const out: Peca[] = [];
  const lado = raio - 3;
  out.push([pc - raio, pr - raio, lado, 2, tipo], [pc + 3, pr - raio, lado, 2, tipo]);
  out.push([pc - raio, pr + raio - 2, lado, 2, tipo], [pc + 3, pr + raio - 2, lado, 2, tipo]);
  out.push([pc - raio, pr - raio, 2, lado, tipo], [pc - raio, pr + 3, 2, lado, tipo]);
  out.push([pc + raio - 2, pr - raio, 2, lado, tipo], [pc + raio - 2, pr + 3, 2, lado, tipo]);
  // só o que fica no quadrante superior esquerdo (o resto vem do espelhamento)
  return out.filter(([c, r, w, h]) => c + w <= 100 && r + h <= 70);
}

const COLMEIA = construirMapa({
  id: 'colmeia',
  nome: 'Colmeia',
  descricao: 'Feito para o Pega Bandeira: 7 praças muradas, cada uma com um ponto, ligadas por corredores.',
  paraBandeira: true,
  quadrante: [
    ...praca(77, 35),
    ...praca(55, 70),
    [86, 56, 8, 2, 2],
    [86, 56, 2, 8, 2],
    [62, 20, 2, 8, 1],
    [40, 40, 10, 2, 1],
    [30, 22, 3, 3, 1],
    [90, 30, 3, 3, 1],
    [66, 52, 2, 6, 1],
  ],
  controle: [[100, 70], [55, 70], [145, 70], [77, 35], [123, 35], [77, 105], [123, 105]],
  pickups: [
    { tipo: 'vida', c: 40, r: 20 },
    { tipo: 'forca', c: 30, r: 52 },
  ],
  pickupsCentro: [],
  zonas: [
    [68, 26, 18, 18, '#191c24'],
    [46, 61, 18, 9, '#191c24'],
    [88, 58, 12, 12, '#1b1e28'],
  ],
});

const ENCRUZILHADA = construirMapa({
  id: 'encruzilhada',
  nome: 'Encruzilhada',
  descricao: 'Feito para o Pega Bandeira: 3 caminhos largos com 2 pontos cada e o maior no cruzamento do centro.',
  paraBandeira: true,
  quadrante: [
    [20, 40, 30, 2, 1],
    [58, 40, 34, 2, 1],
    [35, 18, 3, 3, 1],
    [85, 26, 3, 3, 1],
    [52, 12, 6, 2, 2],
    [30, 58, 3, 3, 1],
    [78, 54, 3, 3, 1],
    [84, 60, 6, 2, 2],
    [20, 52, 2, 6, 2],
  ],
  controle: [[100, 70], [55, 70], [145, 70], [70, 20], [130, 20], [70, 120], [130, 120]],
  pickups: [
    { tipo: 'vida', c: 100, r: 20 },
    { tipo: 'forca', c: 40, r: 70 },
  ],
  pickupsCentro: [],
  zonas: [
    [0, 0, 100, 40, '#141720'],
    [0, 42, 100, 28, '#171a22'],
  ],
});

/** Ruínas: pilares e muros quebrados num padrão denso (com passagens de pelo menos 3 blocos). */
const ruinas = (): Peca[] => {
  const out: Peca[] = [];
  for (let c = 14; c < 96; c += 7) {
    for (let r = 12; r < 68; r += 7) {
      if (Math.hypot(c - 100, r - 70) < 16) continue;
      if (c < 18 && (r < 20 || r > 54)) continue;
      const s = sorteio(c, r, 6);
      if (s === 0) continue;
      const peca: Peca = s === 1 ? [c, r, 4, 2, 1] : s === 2 ? [c, r, 2, 4, 1] : s === 3 ? [c, r, 3, 3, 1] : s === 4 ? [c, r, 4, 2, 2] : [c, r, 2, 2, 1];
      if (peca[0] + peca[2] > 100 || peca[1] + peca[3] > 70) continue;
      out.push(peca);
    }
  }
  return out;
};

const RUINAS = construirMapa({
  id: 'ruinas',
  nome: 'Ruínas',
  descricao: 'Muitos obstáculos: pilares e muros quebrados por todo lado. Linhas de tiro curtas e emboscadas.',
  quadrante: ruinas(),
  pickups: [
    { tipo: 'vida', c: 47, r: 31 },
    { tipo: 'forca', c: 54, r: 52 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [[80, 50, 20, 20, '#1a1c22']],
});

/** Vulcão: muitas poças de lava pequenas e médias, com pedras entre elas. */
const vulcao = (): Peca[] => {
  const out: Peca[] = [];
  for (let c = 16; c < 96; c += 9) {
    for (let r = 14; r < 68; r += 9) {
      if (Math.hypot(c - 100, r - 70) < 18) continue;
      if (c < 20 && r > 50) continue;
      const s = sorteio(c, r, 5);
      if (s === 0) continue;
      const w = 3 + sorteio(r, c, 4);
      const h = 3 + sorteio(c + r, r, 3);
      if (c + w > 100 || r + h > 70) continue;
      out.push([c, r, w, h, s === 1 ? 1 : 4]);
    }
  }
  return out;
};

const VULCAO = construirMapa({
  id: 'vulcao',
  nome: 'Vulcão',
  descricao: 'Dezenas de poças de lava (8 de dano por segundo) entre pedras. Cuidado com empurrões.',
  quadrante: vulcao(),
  pickups: [
    { tipo: 'vida', c: 30, r: 30 },
    { tipo: 'forca', c: 59, r: 39 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [[84, 56, 16, 14, '#1f1614']],
});

/** Cratera: lago de lava em anel em volta da ilha do centro, com 4 pontes, e poças grandes nas bordas. */
const cratera = (): Peca[] => {
  const out: Peca[] = [];
  const dentro = 15;
  const fora = 36;
  for (let r = 34; r < 67; r++) {
    const dy = 70 - r - 0.5;
    if (Math.abs(dy) > fora) continue;
    const xFora = Math.sqrt(fora * fora - dy * dy) * 1.25;
    const xDentro = Math.abs(dy) < dentro ? Math.sqrt(dentro * dentro - dy * dy) * 1.25 : 0;
    const c0 = Math.max(0, Math.ceil(100 - xFora));
    const c1 = Math.min(97, Math.floor(100 - xDentro)); // ponte norte/sul: colunas 97–102; oeste/leste: linhas 67–72
    if (c1 > c0) out.push([c0, r, c1 - c0, 1, 4]);
  }
  out.push([16, 18, 16, 10, 4], [44, 8, 12, 8, 4], [14, 44, 10, 10, 4]);
  out.push([60, 24, 3, 3, 1], [36, 34, 3, 3, 1]);
  return out;
};

const CRATERA = construirMapa({
  id: 'cratera',
  nome: 'Cratera',
  descricao: 'Lago de lava gigante em volta da ilha do centro, com 4 pontes, e poças grandes nas bordas.',
  quadrante: cratera(),
  pickups: [
    { tipo: 'vida', c: 40, r: 26 },
    { tipo: 'forca', c: 30, r: 62 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [[88, 59, 12, 11, '#1d1a1a']],
});

/** Desfiladeiro: o lado esquerdo é aberto; o direito, estreito e cheio de cobertura; um rio com ponte num canto só. */
const DESFILADEIRO = construirMapa({
  id: 'desfiladeiro',
  nome: 'Desfiladeiro',
  descricao: 'Assimétrico: campo aberto à esquerda, cânion estreito e cheio de cobertura à direita, rio com uma ponte embaixo.',
  assimetrico: true,
  quadrante: [
    [40, 30, 4, 4, 1],
    [60, 90, 4, 4, 1],
    [30, 100, 8, 2, 2],
    [20, 104, 6, 14, 3],
    [20, 125, 6, 14, 3],
    [26, 104, 30, 6, 3],
    [90, 40, 4, 22, 1],
    [90, 78, 4, 22, 1],
    [120, 10, 2, 40, 1],
    [120, 60, 2, 20, 1],
    [120, 90, 2, 40, 1],
    [130, 20, 8, 2, 1],
    [146, 34, 2, 10, 1],
    [158, 18, 10, 2, 1],
    [134, 50, 2, 8, 2],
    [150, 60, 8, 2, 1],
    [170, 44, 2, 10, 1],
    [132, 88, 10, 2, 1],
    [152, 96, 2, 10, 1],
    [166, 110, 8, 2, 1],
    [140, 116, 2, 8, 2],
    [176, 84, 3, 3, 1],
    [150, 74, 10, 6, 4],
  ],
  controle: [[100, 70], [55, 60], [150, 30], [60, 118], [140, 102], [35, 20], [176, 66]],
  pickups: [
    { tipo: 'vida', c: 50, r: 50 },
    { tipo: 'vida', c: 160, r: 104 },
    { tipo: 'forca', c: 140, r: 40 },
    { tipo: 'forca', c: 80, r: 120 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [
    [0, 0, 88, 140, '#151a17'],
    [122, 0, 78, 140, '#1b1820'],
  ],
});

/** Transforma uma função (coluna, linha) → tipo em retângulos (faixas por linha) para o quadrante. */
function faixas(cols: number, linhas: number, tipoEm: (c: number, r: number) => number): Peca[] {
  const out: Peca[] = [];
  for (let r = 0; r < linhas; r++) {
    let c = 0;
    while (c < cols) {
      const tipo = tipoEm(c, r);
      let fim = c + 1;
      while (fim < cols && tipoEm(fim, r) === tipo) fim++;
      if (tipo !== 0) out.push([c, r, fim - c, 1, tipo as Bloco]);
      c = fim;
    }
  }
  return out;
}

/** Distância de um ponto a um segmento (para pontes e corredores). */
const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
};

const COLISEU = construirMapa({
  id: 'coliseu',
  nome: 'Coliseu',
  descricao: 'Arena pequena e quase vazia. Partidas rápidas e diretas, ótima para 1×1 e 2×2.',
  colunas: 100,
  linhas: 70,
  quadrante: [
    [18, 13, 3, 3, 1],
    [30, 22, 2, 2, 1],
    [24, 7, 6, 2, 2],
    [16, 22, 2, 6, 2],
  ],
  pickups: [{ tipo: 'vida', c: 22, r: 22 }],
  pickupsCentro: [{ tipo: 'forca', c: 50, r: 35 }],
  zonas: [[30, 20, 20, 15, '#1a1d25']],
});

const FORTES = construirMapa({
  id: 'fortes',
  nome: 'Fortes',
  descricao: 'Duas bases muradas, uma de cada lado, com portões e torres. Pensado para equipes.',
  quadrante: [
    [14, 18, 14, 2, 1], // muro de cima do forte (portão no meio)
    [34, 18, 14, 2, 1],
    [46, 18, 2, 40, 1], // muro da frente (portão perto do centro)
    [24, 30, 4, 4, 1], // torres
    [36, 44, 4, 4, 1],
    [20, 52, 8, 2, 2],
    [70, 30, 3, 3, 1], // campo do meio
    [80, 50, 6, 2, 2],
    [62, 62, 2, 6, 2],
    [88, 20, 2, 10, 1],
  ],
  pickups: [
    { tipo: 'vida', c: 30, r: 40 },
    { tipo: 'forca', c: 76, r: 40 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [[14, 20, 32, 50, '#181b22']],
});

/** Ilhas de lava: quase tudo é lava; ilhas ligadas por pontes estreitas. */
const ILHAS_LAVA = construirMapa({
  id: 'ilhasLava',
  nome: 'Ilhas de lava',
  descricao: 'Quase tudo é lava, com ilhas ligadas por pontes estreitas. Empurrões viram a principal arma.',
  quadrante: faixas(100, 70, (c, r) => {
    const ilhas: Array<[number, number, number]> = [[8, 8, 14], [8, 70, 13], [40, 25, 9], [70, 45, 9], [45, 58, 8], [100, 70, 15]];
    if (ilhas.some(([x, y, raio]) => Math.hypot(c - x, r - y) <= raio)) return 0;
    const pontes: Array<[number, number, number, number]> = [[8, 8, 40, 25], [40, 25, 70, 45], [70, 45, 100, 70], [8, 70, 45, 58], [45, 58, 70, 45], [40, 25, 100, 25], [70, 45, 70, 70]];
    if (pontes.some(([ax, ay, bx, by]) => distSeg(c, r, ax, ay, bx, by) <= 2.2)) return 0;
    return 4;
  }),
  pickups: [
    { tipo: 'vida', c: 40, r: 25 },
    { tipo: 'forca', c: 70, r: 45 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [],
});

/** Selva: moitas (escondem quem está dentro), árvores e um riacho. */
const selva = (): Peca[] => {
  const out: Peca[] = [];
  for (let c = 16; c < 94; c += 12) {
    for (let r = 12; r < 66; r += 11) {
      if (Math.hypot(c - 100, r - 70) < 22) continue;
      if (c < 22 && r > 54) continue;
      const s = sorteio(c, r, 4);
      if (s === 0) continue;
      const w = 5 + sorteio(r, c, 4);
      const h = 4 + sorteio(c + 3, r, 3);
      if (c + w > 100 || r + h > 70) continue;
      out.push([c, r, w, h, 5]);
      if (s === 3) out.push([c + w + 1, r + 1, 2, 2, 1]);
    }
  }
  out.push([30, 32, 20, 3, 3]); // riacho
  return out;
};
const SELVA = construirMapa({
  id: 'selva',
  nome: 'Selva',
  descricao: 'Moitas por todo lado: quem está dentro de uma fica invisível para quem está longe. Atacar revela.',
  quadrante: selva(),
  pickups: [
    { tipo: 'vida', c: 40, r: 44 },
    { tipo: 'forca', c: 74, r: 22 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [[0, 0, 100, 70, '#121813']],
});

const PANTANO = construirMapa({
  id: 'pantano',
  nome: 'Pântano',
  descricao: 'Grandes áreas de lama (40% mais lento), lagoas e árvores mortas.',
  quadrante: [
    [18, 16, 24, 14, 6], // lama
    [56, 10, 20, 10, 6],
    [40, 40, 22, 16, 6],
    [74, 32, 16, 18, 6],
    [62, 22, 6, 6, 3], // lagoas
    [24, 46, 8, 6, 3],
    [50, 28, 3, 3, 1], // árvores mortas
    [34, 36, 2, 2, 1],
    [86, 58, 3, 3, 1],
  ],
  pickups: [
    { tipo: 'vida', c: 30, r: 36 },
    { tipo: 'forca', c: 70, r: 60 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [[0, 0, 100, 70, '#14170f']],
});

const ABISMO = construirMapa({
  id: 'abismo',
  nome: 'Abismo',
  descricao: 'Buracos sem fundo: cair é morte na hora, e o abate vai para quem empurrou.',
  quadrante: [
    [20, 18, 14, 10, 7],
    [46, 10, 10, 8, 7],
    [60, 26, 16, 8, 7],
    [24, 40, 10, 14, 7],
    [44, 48, 16, 6, 7],
    [76, 44, 8, 14, 7],
    [86, 18, 6, 8, 7],
    [40, 32, 3, 3, 1],
    [66, 58, 3, 3, 1],
  ],
  pickups: [
    { tipo: 'vida', c: 40, r: 22 },
    { tipo: 'forca', c: 66, r: 40 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [],
});

const PORTAIS = construirMapa({
  id: 'portais',
  nome: 'Portais',
  descricao: 'Pares de portais ligam lados opostos do mapa: atalhos para atacar e fugir.',
  quadrante: [
    [30, 30, 2, 16, 1],
    [44, 20, 16, 2, 1],
    [62, 40, 3, 3, 1],
    [80, 26, 2, 12, 1],
    [50, 56, 12, 2, 2],
  ],
  portais: [
    [[30, 18], [170, 122]],
    [[170, 18], [30, 122]],
    [[100, 14], [100, 126]],
    [[22, 70], [178, 70]],
  ],
  pickups: [
    { tipo: 'vida', c: 40, r: 40 },
    { tipo: 'forca', c: 70, r: 20 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [],
});

const TRAMPOLINS = construirMapa({
  id: 'trampolins',
  nome: 'Trampolins',
  descricao: 'Câmaras separadas por muros; trampolins lançam por cima deles até o outro lado.',
  quadrante: [
    [40, 0, 2, 30, 1], // muros entre câmaras (com passagens)
    [40, 38, 2, 32, 1],
    [42, 34, 30, 2, 1],
    [80, 34, 20, 2, 1],
    [20, 22, 3, 3, 1],
    [60, 14, 3, 3, 1],
    [60, 52, 3, 3, 1],
  ],
  trampolins: [
    [[34, 20], [52, 20]],
    [[48, 24], [30, 24]],
    [[166, 20], [148, 20]],
    [[152, 24], [170, 24]],
    [[34, 120], [52, 120]],
    [[48, 116], [30, 116]],
    [[166, 120], [148, 120]],
    [[152, 116], [170, 116]],
    [[60, 30], [60, 44]],
    [[140, 30], [140, 44]],
    [[60, 110], [60, 96]],
    [[140, 110], [140, 96]],
  ],
  pickups: [
    { tipo: 'vida', c: 20, r: 40 },
    { tipo: 'forca', c: 70, r: 22 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [],
});

const GELO = construirMapa({
  id: 'gelo',
  nome: 'Pista de gelo',
  descricao: 'Pistas de gelo por todo o mapa: o personagem escorrega e demora para frear.',
  quadrante: [
    ...faixas(100, 70, (c, r) => (Math.hypot((c - 100) / 1.3, r - 70) < 34 ? 8 : 0)),
    [16, 18, 22, 14, 8],
    [50, 6, 20, 10, 8],
    [44, 22, 3, 3, 1],
    [30, 46, 3, 3, 1],
    [20, 40, 2, 8, 2],
  ],
  pickups: [
    { tipo: 'vida', c: 28, r: 54 },
    { tipo: 'forca', c: 40, r: 10 },
  ],
  pickupsCentro: [],
  zonas: [],
});

const FABRICA = construirMapa({
  id: 'fabrica',
  nome: 'Fábrica',
  descricao: 'Esteiras arrastam quem está em cima; prensas fecham de tempos em tempos.',
  quadrante: [
    [20, 20, 40, 4, 9], // esteira para a direita
    [60, 20, 4, 24, 11], // desce
    [24, 44, 36, 4, 10], // volta para a esquerda
    [70, 52, 26, 4, 9],
    [30, 30, 6, 6, 1], // máquinas
    [46, 30, 6, 6, 1],
    [80, 30, 4, 10, 1],
    [14, 56, 8, 2, 2],
  ],
  dinamicas: [
    { peca: [66, 26, 2, 12], periodo: 6, fechado: 2 },
    { peca: [36, 52, 12, 2], periodo: 6, fechado: 2, fase: 3 },
  ],
  pickups: [
    { tipo: 'vida', c: 40, r: 38 },
    { tipo: 'forca', c: 76, r: 46 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [[0, 0, 100, 70, '#16171b']],
});

const APAGAO = construirMapa({
  id: 'apagao',
  nome: 'Apagão',
  descricao: 'Mapa escuro: cada um só vê em volta de si e perto dos postes de luz.',
  quadrante: [
    ...quarteiroes().filter((_, i) => i % 2 === 0),
    [56, 30, 2, 8, 2],
    [30, 62, 8, 2, 2],
  ],
  escuro: {
    raioVisao: 300,
    luzes: [
      [100, 70, 260],
      [34, 29, 160],
      [70, 46, 160],
    ],
  },
  pickups: [
    { tipo: 'vida', c: 34, r: 29 },
    { tipo: 'forca', c: 70, r: 46 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [],
});

const LABIRINTO_VIVO = construirMapa({
  id: 'labirintoVivo',
  nome: 'Labirinto vivo',
  descricao: 'Paredes que abrem e fecham a cada 10 s, trocando os caminhos durante a partida.',
  quadrante: [
    [30, 16, 2, 20, 1],
    [30, 46, 24, 2, 1],
    [60, 20, 20, 2, 1],
    [70, 34, 2, 14, 1],
    [88, 50, 2, 10, 1],
  ],
  dinamicas: [
    // conjunto A fecha nos primeiros 10 s de cada 20; o B, nos outros 10
    { peca: [32, 26, 18, 2], periodo: 20, fechado: 10 },
    { peca: [54, 46, 2, 14], periodo: 20, fechado: 10 },
    { peca: [44, 30, 2, 16], periodo: 20, fechado: 10, fase: 10 },
    { peca: [72, 34, 16, 2], periodo: 20, fechado: 10, fase: 10 },
  ],
  pickups: [
    { tipo: 'vida', c: 42, r: 38 },
    { tipo: 'forca', c: 78, r: 28 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [],
});

const DEMOLICAO = construirMapa({
  id: 'demolicao',
  nome: 'Demolição',
  descricao: 'Muros que quebram com tiros e explosões: o mapa vai se abrindo durante a partida.',
  quadrante: [
    [20, 20, 3, 3, 1],
    [70, 18, 3, 3, 1],
    [50, 56, 3, 3, 1],
  ],
  destrutiveis: [
    [30, 14, 2, 22],
    [36, 34, 20, 2],
    [60, 20, 2, 20],
    [64, 44, 18, 2],
    [84, 22, 2, 14],
    [20, 46, 14, 2],
    [44, 50, 2, 14],
  ],
  pickups: [
    { tipo: 'vida', c: 46, r: 26 },
    { tipo: 'forca', c: 74, r: 34 },
  ],
  pickupsCentro: [{ tipo: 'forca', c: 100, r: 70 }],
  zonas: [],
});

export const MAPAS: Record<IdMapa, Mapa> = {
  praca: PRACA,
  fortaleza: FORTALEZA,
  arquipelago: ARQUIPELAGO,
  labirinto: LABIRINTO,
  cidade: CIDADE,
  rio: RIO,
  colmeia: COLMEIA,
  encruzilhada: ENCRUZILHADA,
  ruinas: RUINAS,
  vulcao: VULCAO,
  cratera: CRATERA,
  desfiladeiro: DESFILADEIRO,
  coliseu: COLISEU,
  fortes: FORTES,
  ilhasLava: ILHAS_LAVA,
  selva: SELVA,
  pantano: PANTANO,
  abismo: ABISMO,
  portais: PORTAIS,
  trampolins: TRAMPOLINS,
  gelo: GELO,
  fabrica: FABRICA,
  apagao: APAGAO,
  labirintoVivo: LABIRINTO_VIVO,
  demolicao: DEMOLICAO,
};


export const LISTA_MAPAS = Object.values(MAPAS);

/** O Pega Bandeira só é jogado nos mapas feitos para ele; os outros modos aceitam qualquer mapa. */
export function mapaAceitaModo(m: Mapa, modo: string): boolean {
  return modo === 'bandeira' || modo === 'bandeiraEquipe' ? m.paraBandeira : true;
}
export const MAPA_PADRAO: IdMapa = 'praca';

export function bloco(m: Mapa, c: number, r: number): Bloco {
  if (c < 0 || r < 0 || c >= m.colunas || r >= m.linhas) return 1;
  return m.grade[r * m.colunas + c] as Bloco;
}

/** Cópia do mapa para uma partida (as paredes temporárias não vazam entre partidas). */
export function copiaDoMapa(m: Mapa): Mapa {
  return { ...m, paredesTemp: [] };
}

export function dentroDaArea(m: Mapa, vaga: number, x: number, y: number): boolean {
  const a = m.areas[vaga];
  return !!a && Math.hypot(x - a.x, y - a.y) <= a.raio;
}
