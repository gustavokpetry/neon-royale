// server/src/index.ts
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import QRCode from "qrcode";
import { Server } from "socket.io";

// shared/src/config.ts
var CONFIG = {
  sala: {
    tamanhoCodigo: 6,
    alfabetoCodigo: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    prazoReconexaoMs: 12e4,
    encerrarSalaVaziaMs: 12e4,
    tamanhoMaxApelido: 16,
    maxTentativasEntradaPorMinuto: 12,
    intervaloLimpezaMs: 5e3,
    /** Uma vaga por personagem (Veni, Gut, Vini, Daniel, Lucas, Pacheco); a partida começa com 2 ou mais. */
    jogadores: 6,
    minimoJogadores: 2
  },
  rede: {
    taxaSimulacaoHz: 20,
    maxBytesMensagem: 8e3,
    maxEventosPorSegundo: 30,
    rajadaEventos: 60,
    /** Comandos de movimento: 20/s normalmente; a folga absorve rajadas depois de travadas do navegador. */
    maxComandosPorSegundo: 40,
    intervaloPingMs: 2e3
  },
  movimento: {
    /** Passo fixo de cada comando de movimento. */
    dtComando: 0.05,
    velocidadeBase: 190,
    raioJogador: 12,
    /** Comandos aplicados por tick, no máximo (contra trapaça de velocidade). */
    maxComandosPorTick: 4
  },
  vida: { maxima: 100 },
  areaSegura: {
    raio: 96,
    /** Proteção por no máximo este tempo seguido; volta ao sair e entrar de novo. */
    segMaxSeguidos: 8
  },
  pickups: {
    raioColeta: 22,
    vida: { cura: 35, segReaparecer: 20 },
    forca: { bonusDano: 0.5, segDuracao: 8, segReaparecer: 30 }
  },
  queimadura: { segIntervalo: 1 },
  partida: { segContagem: 3 }
};

// shared/src/esquemas.ts
import { z } from "zod";

// shared/src/mapa.ts
var BLOCO = 16;
var T = { LIVRE: 0, ALTO: 1, MURETA: 2, AGUA: 3, LAVA: 4, MATO: 5, LAMA: 6, ABISMO: 7, GELO: 8, ESTEIRA_D: 9, ESTEIRA_E: 10, ESTEIRA_B: 11, ESTEIRA_C: 12 };
var ESTEIRAS = { 9: [1, 0], 10: [-1, 0], 11: [0, 1], 12: [0, -1] };
var IDS_MAPAS = [
  "praca",
  "fortaleza",
  "arquipelago",
  "labirinto",
  "cidade",
  "rio",
  "colmeia",
  "encruzilhada",
  "ruinas",
  "vulcao",
  "cratera",
  "desfiladeiro",
  "coliseu",
  "fortes",
  "ilhasLava",
  "selva",
  "pantano",
  "abismo",
  "portais",
  "trampolins",
  "gelo",
  "fabrica",
  "apagao",
  "labirintoVivo",
  "demolicao"
];
function sala(c, r, w, h, porta = 6) {
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
    [c + w - 2, r + b + porta, 2, h - b - porta, 1]
  ];
}
function construirMapa(d) {
  const C = d.colunas ?? 200;
  const L = d.linhas ?? 140;
  const espelhar = (p2) => {
    if (d.assimetrico) return [p2];
    const [c, r, w, h, ...resto] = p2;
    const espH = (x) => x === 9 ? 10 : x === 10 ? 9 : x;
    const espV = (x) => x === 11 ? 12 : x === 12 ? 11 : x;
    const copias = [
      [c, r, w, h, ...resto],
      [C - c - w, r, w, h, ...resto.map(espH)],
      [c, L - r - h, w, h, ...resto.map(espV)],
      [C - c - w, L - r - h, w, h, ...resto.map((x) => espH(espV(x)))]
    ];
    const vistos = /* @__PURE__ */ new Set();
    return copias.filter((x) => {
      const k = x.slice(0, 4).join(",");
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };
  const pecas = d.quadrante.flatMap((p2) => espelhar(p2));
  const obstaculos = pecas.map(([c, r, w, h, tipo]) => ({ x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, tipo }));
  const grade = new Uint8Array(C * L);
  for (let r = 0; r < L; r++) for (let c = 0; c < C; c++) if (r === 0 || c === 0 || r === L - 1 || c === C - 1) grade[r * C + c] = 1;
  for (const [c, r, w, h, tipo] of pecas) {
    for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) grade[rr * C + cc] = tipo;
  }
  const p = (c, r) => ({ x: c * BLOCO, y: r * BLOCO });
  const nascimentos = [p(8, 8), p(C - 8, L - 8), p(C - 8, 8), p(8, L - 8), p(8, L / 2), p(C - 8, L / 2)];
  const areas = nascimentos.map((n2, vaga) => ({ vaga, ...n2, raio: 96 }));
  let n = 0;
  const pickups = [];
  for (const pk of d.pickups) {
    for (const [c, r] of espelhar([pk.c, pk.r, 0, 0])) {
      pickups.push({ id: `${pk.tipo[0]}${++n}`, tipo: pk.tipo, x: c * BLOCO, y: r * BLOCO });
    }
  }
  for (const pk of d.pickupsCentro) pickups.push({ id: `${pk.tipo[0]}${++n}`, tipo: pk.tipo, x: pk.c * BLOCO, y: pk.r * BLOCO });
  const zonas = d.zonas.flatMap((z2) => espelhar(z2)).map(([c, r, w, h, cor]) => ({ x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, cor }));
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
    dinamicas: (d.dinamicas ?? []).flatMap(
      (x) => espelhar([...x.peca, 0]).map(([c, r, w, h]) => ({
        ret: { x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, tipo: 1 },
        periodo: x.periodo,
        fechado: x.fechado,
        fase: x.fase ?? 0
      }))
    ),
    destrutiveis: (d.destrutiveis ?? []).flatMap((x) => espelhar([...x, 0]).map(([c, r, w, h]) => ({ x: c * BLOCO, y: r * BLOCO, w: w * BLOCO, h: h * BLOCO, tipo: 1 }))),
    ...d.escuro ? {
      escuro: {
        raioVisao: d.escuro.raioVisao,
        luzes: d.escuro.luzes.flatMap(([c, r, raio]) => espelhar([c, r, 0, 0, raio]).map(([x, y, , , rr]) => ({ x: x * BLOCO, y: y * BLOCO, r: rr })))
      }
    } : {},
    ...d.controle ? { controle: d.controle.map(([c, r]) => ({ x: c * BLOCO, y: r * BLOCO })) } : {}
  };
}
var pilares = (c0, r0, nc, nr, passo, tam = 2) => {
  const out = [];
  for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) out.push([c0 + i * passo, r0 + j * passo, tam, tam, 1]);
  return out;
};
var PRACA = construirMapa({
  id: "praca",
  nome: "Pra\xE7a",
  descricao: "Pra\xE7a central com pilares, galp\xF5es com portas, bosque de pilares e muretas.",
  quadrante: [
    ...sala(24, 18, 22, 16),
    // galpão
    ...pilares(56, 10, 4, 3, 7),
    // bosque de pilares
    [60, 38, 14, 2, 2],
    // muretas
    [40, 46, 2, 12, 2],
    [86, 24, 2, 14, 1],
    // corredor para o centro
    [84, 54, 3, 3, 1],
    // pilares da praça central
    [92, 6, 8, 2, 1],
    // marco no meio da borda
    [20, 56, 2, 10, 1],
    // cobertura perto do nascimento do meio
    [62, 62, 8, 2, 2],
    ...sala(64, 44, 14, 12),
    // quiosque perto do centro
    [8, 30, 10, 2, 2],
    [30, 64, 10, 2, 1]
  ],
  pickups: [
    { tipo: "vida", c: 35, r: 26 },
    { tipo: "forca", c: 60, r: 14 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [
    [80, 50, 20, 20, "#1a1e27"],
    // praça central
    [26, 20, 18, 12, "#171b22"],
    // dentro do galpão
    [54, 8, 28, 22, "#141a17"]
    // bosque
  ]
});
var FORTALEZA = construirMapa({
  id: "fortaleza",
  nome: "Fortaleza",
  descricao: "Muralha no centro com quatro port\xF5es, corredores longos e quart\xE9is.",
  quadrante: [
    [72, 42, 24, 2, 1],
    // muralha (portão norte entre as metades)
    [72, 42, 2, 24, 1],
    // muralha (portão oeste)
    [88, 58, 3, 3, 1],
    // pilares dentro da fortaleza
    [26, 14, 34, 2, 1],
    // corredor
    [26, 24, 34, 2, 1],
    ...sala(30, 40, 20, 16),
    // quartel
    [56, 34, 10, 2, 2],
    [60, 56, 2, 8, 2],
    [96, 8, 4, 6, 1],
    [22, 58, 2, 8, 1],
    ...pilares(8, 32, 2, 2, 8),
    // pilares perto do nascimento
    [62, 8, 2, 10, 1],
    [38, 64, 12, 2, 2]
  ],
  pickups: [
    { tipo: "vida", c: 40, r: 48 },
    { tipo: "forca", c: 44, r: 19 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [
    [74, 44, 26, 26, "#1b1d24"],
    // pátio da fortaleza
    [26, 16, 34, 8, "#16191f"],
    // corredor
    [32, 42, 16, 12, "#181b21"]
    // quartel
  ]
});
var ARQUIPELAGO = construirMapa({
  id: "arquipelago",
  nome: "Arquip\xE9lago",
  descricao: "Lagos que bloqueiam a passagem mas n\xE3o os tiros, rochas e ilhas.",
  quadrante: [
    [30, 20, 16, 10, 3],
    // lago
    [60, 44, 12, 12, 3],
    // lago
    [84, 50, 8, 6, 3],
    // lagos em volta do centro (caminhos em cruz)
    [52, 12, 3, 3, 1],
    // rochas
    [56, 16, 3, 3, 1],
    [50, 18, 3, 3, 1],
    [20, 40, 4, 2, 1],
    [24, 44, 2, 4, 1],
    [70, 24, 12, 2, 2],
    [40, 58, 2, 8, 2],
    [92, 10, 8, 3, 1],
    [22, 56, 2, 8, 1],
    [8, 26, 6, 8, 3],
    // lagoa perto do nascimento
    [76, 30, 3, 3, 1],
    [34, 64, 6, 2, 2],
    [74, 8, 3, 3, 1]
  ],
  pickups: [
    { tipo: "vida", c: 38, r: 34 },
    { tipo: "forca", c: 66, r: 38 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [
    [78, 48, 22, 22, "#191c22"],
    [48, 10, 14, 12, "#18181c"]
  ]
});
var LABIRINTO = construirMapa({
  id: "labirinto",
  nome: "Labirinto",
  descricao: "An\xE9is de muros em volta do centro, com passagens estreitas e becos.",
  quadrante: [
    [44, 16, 48, 2, 1],
    // anel externo (topo e lado), com aberturas no canto e no meio
    [30, 26, 2, 30, 1],
    [60, 30, 32, 2, 1],
    // anel do meio
    [60, 30, 2, 32, 1],
    [80, 46, 8, 2, 1],
    // anel interno (pedaços)
    [76, 50, 2, 8, 1],
    [92, 22, 2, 8, 1],
    // gargalos perto do eixo
    [44, 40, 12, 2, 1],
    [40, 26, 2, 10, 1],
    [66, 40, 8, 2, 2],
    [20, 44, 6, 2, 1],
    [70, 18, 2, 8, 1]
  ],
  pickups: [
    { tipo: "vida", c: 46, r: 46 },
    { tipo: "forca", c: 70, r: 36 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [
    [62, 32, 38, 38, "#181a22"],
    [32, 18, 28, 12, "#15181e"]
  ]
});
var quarteiroes = () => {
  const out = [];
  for (const c of [20, 38, 56, 74]) for (const r of [16, 32, 48]) out.push([c, r, 12, 10, 1]);
  return out;
};
var CIDADE = construirMapa({
  id: "cidade",
  nome: "Cidade",
  descricao: "Quarteir\xF5es em grade com ruas retas, cercas baixas e uma pra\xE7a no centro.",
  quadrante: [
    ...quarteiroes(),
    [38, 60, 12, 2, 2],
    // cercas
    [58, 62, 2, 6, 2],
    [26, 28, 2, 3, 2]
  ],
  pickups: [
    { tipo: "vida", c: 34, r: 29 },
    { tipo: "forca", c: 52, r: 44 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [
    [86, 58, 14, 12, "#1a1e27"],
    // praça
    [18, 26, 82, 6, "#14171c"]
    // avenida
  ]
});
var RIO = construirMapa({
  id: "rio",
  nome: "Rio",
  descricao: "Rios cruzando o mapa com pontes estreitas; campos abertos com poucas pedras.",
  quadrante: [
    [14, 30, 26, 6, 3],
    // rio horizontal com duas pontes
    [48, 30, 28, 6, 3],
    [84, 30, 16, 6, 3],
    [46, 42, 6, 10, 3],
    // rio vertical com ponte
    [46, 58, 6, 12, 3],
    [24, 12, 3, 3, 1],
    // pedras
    [60, 14, 3, 3, 1],
    [70, 48, 3, 3, 1],
    [30, 50, 3, 3, 1],
    [86, 52, 3, 3, 1],
    [62, 20, 10, 2, 2]
  ],
  pickups: [
    { tipo: "vida", c: 40, r: 22 },
    { tipo: "forca", c: 60, r: 42 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [
    [52, 36, 48, 34, "#161b18"],
    [14, 36, 32, 34, "#171a16"]
  ]
});
var sorteio = (i, j, n) => ((i * 73856093 ^ j * 19349663 ^ 1540483477) >>> 0) % n;
function praca(pc, pr, raio = 9, tipo = 2) {
  const out = [];
  const lado = raio - 3;
  out.push([pc - raio, pr - raio, lado, 2, tipo], [pc + 3, pr - raio, lado, 2, tipo]);
  out.push([pc - raio, pr + raio - 2, lado, 2, tipo], [pc + 3, pr + raio - 2, lado, 2, tipo]);
  out.push([pc - raio, pr - raio, 2, lado, tipo], [pc - raio, pr + 3, 2, lado, tipo]);
  out.push([pc + raio - 2, pr - raio, 2, lado, tipo], [pc + raio - 2, pr + 3, 2, lado, tipo]);
  return out.filter(([c, r, w, h]) => c + w <= 100 && r + h <= 70);
}
var COLMEIA = construirMapa({
  id: "colmeia",
  nome: "Colmeia",
  descricao: "Feito para o Pega Bandeira: 7 pra\xE7as muradas, cada uma com um ponto, ligadas por corredores.",
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
    [66, 52, 2, 6, 1]
  ],
  controle: [[100, 70], [55, 70], [145, 70], [77, 35], [123, 35], [77, 105], [123, 105]],
  pickups: [
    { tipo: "vida", c: 40, r: 20 },
    { tipo: "forca", c: 30, r: 52 }
  ],
  pickupsCentro: [],
  zonas: [
    [68, 26, 18, 18, "#191c24"],
    [46, 61, 18, 9, "#191c24"],
    [88, 58, 12, 12, "#1b1e28"]
  ]
});
var ENCRUZILHADA = construirMapa({
  id: "encruzilhada",
  nome: "Encruzilhada",
  descricao: "Feito para o Pega Bandeira: 3 caminhos largos com 2 pontos cada e o maior no cruzamento do centro.",
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
    [20, 52, 2, 6, 2]
  ],
  controle: [[100, 70], [55, 70], [145, 70], [70, 20], [130, 20], [70, 120], [130, 120]],
  pickups: [
    { tipo: "vida", c: 100, r: 20 },
    { tipo: "forca", c: 40, r: 70 }
  ],
  pickupsCentro: [],
  zonas: [
    [0, 0, 100, 40, "#141720"],
    [0, 42, 100, 28, "#171a22"]
  ]
});
var ruinas = () => {
  const out = [];
  for (let c = 14; c < 96; c += 7) {
    for (let r = 12; r < 68; r += 7) {
      if (Math.hypot(c - 100, r - 70) < 16) continue;
      if (c < 18 && (r < 20 || r > 54)) continue;
      const s = sorteio(c, r, 6);
      if (s === 0) continue;
      const peca = s === 1 ? [c, r, 4, 2, 1] : s === 2 ? [c, r, 2, 4, 1] : s === 3 ? [c, r, 3, 3, 1] : s === 4 ? [c, r, 4, 2, 2] : [c, r, 2, 2, 1];
      if (peca[0] + peca[2] > 100 || peca[1] + peca[3] > 70) continue;
      out.push(peca);
    }
  }
  return out;
};
var RUINAS = construirMapa({
  id: "ruinas",
  nome: "Ru\xEDnas",
  descricao: "Muitos obst\xE1culos: pilares e muros quebrados por todo lado. Linhas de tiro curtas e emboscadas.",
  quadrante: ruinas(),
  pickups: [
    { tipo: "vida", c: 47, r: 31 },
    { tipo: "forca", c: 54, r: 52 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [[80, 50, 20, 20, "#1a1c22"]]
});
var vulcao = () => {
  const out = [];
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
var VULCAO = construirMapa({
  id: "vulcao",
  nome: "Vulc\xE3o",
  descricao: "Dezenas de po\xE7as de lava (8 de dano por segundo) entre pedras. Cuidado com empurr\xF5es.",
  quadrante: vulcao(),
  pickups: [
    { tipo: "vida", c: 30, r: 30 },
    { tipo: "forca", c: 59, r: 39 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [[84, 56, 16, 14, "#1f1614"]]
});
var cratera = () => {
  const out = [];
  const dentro = 15;
  const fora = 36;
  for (let r = 34; r < 67; r++) {
    const dy = 70 - r - 0.5;
    if (Math.abs(dy) > fora) continue;
    const xFora = Math.sqrt(fora * fora - dy * dy) * 1.25;
    const xDentro = Math.abs(dy) < dentro ? Math.sqrt(dentro * dentro - dy * dy) * 1.25 : 0;
    const c0 = Math.max(0, Math.ceil(100 - xFora));
    const c1 = Math.min(97, Math.floor(100 - xDentro));
    if (c1 > c0) out.push([c0, r, c1 - c0, 1, 4]);
  }
  out.push([16, 18, 16, 10, 4], [44, 8, 12, 8, 4], [14, 44, 10, 10, 4]);
  out.push([60, 24, 3, 3, 1], [36, 34, 3, 3, 1]);
  return out;
};
var CRATERA = construirMapa({
  id: "cratera",
  nome: "Cratera",
  descricao: "Lago de lava gigante em volta da ilha do centro, com 4 pontes, e po\xE7as grandes nas bordas.",
  quadrante: cratera(),
  pickups: [
    { tipo: "vida", c: 40, r: 26 },
    { tipo: "forca", c: 30, r: 62 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [[88, 59, 12, 11, "#1d1a1a"]]
});
var DESFILADEIRO = construirMapa({
  id: "desfiladeiro",
  nome: "Desfiladeiro",
  descricao: "Assim\xE9trico: campo aberto \xE0 esquerda, c\xE2nion estreito e cheio de cobertura \xE0 direita, rio com uma ponte embaixo.",
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
    [150, 74, 10, 6, 4]
  ],
  controle: [[100, 70], [55, 60], [150, 30], [60, 118], [140, 102], [35, 20], [176, 66]],
  pickups: [
    { tipo: "vida", c: 50, r: 50 },
    { tipo: "vida", c: 160, r: 104 },
    { tipo: "forca", c: 140, r: 40 },
    { tipo: "forca", c: 80, r: 120 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [
    [0, 0, 88, 140, "#151a17"],
    [122, 0, 78, 140, "#1b1820"]
  ]
});
function faixas(cols, linhas, tipoEm) {
  const out = [];
  for (let r = 0; r < linhas; r++) {
    let c = 0;
    while (c < cols) {
      const tipo = tipoEm(c, r);
      let fim = c + 1;
      while (fim < cols && tipoEm(fim, r) === tipo) fim++;
      if (tipo !== 0) out.push([c, r, fim - c, 1, tipo]);
      c = fim;
    }
  }
  return out;
}
var distSeg = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
};
var COLISEU = construirMapa({
  id: "coliseu",
  nome: "Coliseu",
  descricao: "Arena pequena e quase vazia. Partidas r\xE1pidas e diretas, \xF3tima para 1\xD71 e 2\xD72.",
  colunas: 100,
  linhas: 70,
  quadrante: [
    [18, 13, 3, 3, 1],
    [30, 22, 2, 2, 1],
    [24, 7, 6, 2, 2],
    [16, 22, 2, 6, 2]
  ],
  pickups: [{ tipo: "vida", c: 22, r: 22 }],
  pickupsCentro: [{ tipo: "forca", c: 50, r: 35 }],
  zonas: [[30, 20, 20, 15, "#1a1d25"]]
});
var FORTES = construirMapa({
  id: "fortes",
  nome: "Fortes",
  descricao: "Duas bases muradas, uma de cada lado, com port\xF5es e torres. Pensado para equipes.",
  quadrante: [
    [14, 18, 14, 2, 1],
    // muro de cima do forte (portão no meio)
    [34, 18, 14, 2, 1],
    [46, 18, 2, 40, 1],
    // muro da frente (portão perto do centro)
    [24, 30, 4, 4, 1],
    // torres
    [36, 44, 4, 4, 1],
    [20, 52, 8, 2, 2],
    [70, 30, 3, 3, 1],
    // campo do meio
    [80, 50, 6, 2, 2],
    [62, 62, 2, 6, 2],
    [88, 20, 2, 10, 1]
  ],
  pickups: [
    { tipo: "vida", c: 30, r: 40 },
    { tipo: "forca", c: 76, r: 40 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [[14, 20, 32, 50, "#181b22"]]
});
var ILHAS_LAVA = construirMapa({
  id: "ilhasLava",
  nome: "Ilhas de lava",
  descricao: "Quase tudo \xE9 lava, com ilhas ligadas por pontes estreitas. Empurr\xF5es viram a principal arma.",
  quadrante: faixas(100, 70, (c, r) => {
    const ilhas = [[8, 8, 14], [8, 70, 13], [40, 25, 9], [70, 45, 9], [45, 58, 8], [100, 70, 15]];
    if (ilhas.some(([x, y, raio]) => Math.hypot(c - x, r - y) <= raio)) return 0;
    const pontes = [[8, 8, 40, 25], [40, 25, 70, 45], [70, 45, 100, 70], [8, 70, 45, 58], [45, 58, 70, 45], [40, 25, 100, 25], [70, 45, 70, 70]];
    if (pontes.some(([ax, ay, bx, by]) => distSeg(c, r, ax, ay, bx, by) <= 2.2)) return 0;
    return 4;
  }),
  pickups: [
    { tipo: "vida", c: 40, r: 25 },
    { tipo: "forca", c: 70, r: 45 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: []
});
var selva = () => {
  const out = [];
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
  out.push([30, 32, 20, 3, 3]);
  return out;
};
var SELVA = construirMapa({
  id: "selva",
  nome: "Selva",
  descricao: "Moitas por todo lado: quem est\xE1 dentro de uma fica invis\xEDvel para quem est\xE1 longe. Atacar revela.",
  quadrante: selva(),
  pickups: [
    { tipo: "vida", c: 40, r: 44 },
    { tipo: "forca", c: 74, r: 22 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [[0, 0, 100, 70, "#121813"]]
});
var PANTANO = construirMapa({
  id: "pantano",
  nome: "P\xE2ntano",
  descricao: "Grandes \xE1reas de lama (40% mais lento), lagoas e \xE1rvores mortas.",
  quadrante: [
    [18, 16, 24, 14, 6],
    // lama
    [56, 10, 20, 10, 6],
    [40, 40, 22, 16, 6],
    [74, 32, 16, 18, 6],
    [62, 22, 6, 6, 3],
    // lagoas
    [24, 46, 8, 6, 3],
    [50, 28, 3, 3, 1],
    // árvores mortas
    [34, 36, 2, 2, 1],
    [86, 58, 3, 3, 1]
  ],
  pickups: [
    { tipo: "vida", c: 30, r: 36 },
    { tipo: "forca", c: 70, r: 60 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [[0, 0, 100, 70, "#14170f"]]
});
var ABISMO = construirMapa({
  id: "abismo",
  nome: "Abismo",
  descricao: "Buracos sem fundo: cair \xE9 morte na hora, e o abate vai para quem empurrou.",
  quadrante: [
    [20, 18, 14, 10, 7],
    [46, 10, 10, 8, 7],
    [60, 26, 16, 8, 7],
    [24, 40, 10, 14, 7],
    [44, 48, 16, 6, 7],
    [76, 44, 8, 14, 7],
    [86, 18, 6, 8, 7],
    [40, 32, 3, 3, 1],
    [66, 58, 3, 3, 1]
  ],
  pickups: [
    { tipo: "vida", c: 40, r: 22 },
    { tipo: "forca", c: 66, r: 40 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: []
});
var PORTAIS = construirMapa({
  id: "portais",
  nome: "Portais",
  descricao: "Pares de portais ligam lados opostos do mapa: atalhos para atacar e fugir.",
  quadrante: [
    [30, 30, 2, 16, 1],
    [44, 20, 16, 2, 1],
    [62, 40, 3, 3, 1],
    [80, 26, 2, 12, 1],
    [50, 56, 12, 2, 2]
  ],
  portais: [
    [[30, 18], [170, 122]],
    [[170, 18], [30, 122]],
    [[100, 14], [100, 126]],
    [[22, 70], [178, 70]]
  ],
  pickups: [
    { tipo: "vida", c: 40, r: 40 },
    { tipo: "forca", c: 70, r: 20 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: []
});
var TRAMPOLINS = construirMapa({
  id: "trampolins",
  nome: "Trampolins",
  descricao: "C\xE2maras separadas por muros; trampolins lan\xE7am por cima deles at\xE9 o outro lado.",
  quadrante: [
    [40, 0, 2, 30, 1],
    // muros entre câmaras (com passagens)
    [40, 38, 2, 32, 1],
    [42, 34, 30, 2, 1],
    [80, 34, 20, 2, 1],
    [20, 22, 3, 3, 1],
    [60, 14, 3, 3, 1],
    [60, 52, 3, 3, 1]
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
    [[140, 110], [140, 96]]
  ],
  pickups: [
    { tipo: "vida", c: 20, r: 40 },
    { tipo: "forca", c: 70, r: 22 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: []
});
var GELO = construirMapa({
  id: "gelo",
  nome: "Pista de gelo",
  descricao: "Pistas de gelo por todo o mapa: o personagem escorrega e demora para frear.",
  quadrante: [
    ...faixas(100, 70, (c, r) => Math.hypot((c - 100) / 1.3, r - 70) < 34 ? 8 : 0),
    [16, 18, 22, 14, 8],
    [50, 6, 20, 10, 8],
    [44, 22, 3, 3, 1],
    [30, 46, 3, 3, 1],
    [20, 40, 2, 8, 2]
  ],
  pickups: [
    { tipo: "vida", c: 28, r: 54 },
    { tipo: "forca", c: 40, r: 10 }
  ],
  pickupsCentro: [],
  zonas: []
});
var FABRICA = construirMapa({
  id: "fabrica",
  nome: "F\xE1brica",
  descricao: "Esteiras arrastam quem est\xE1 em cima; prensas fecham de tempos em tempos.",
  quadrante: [
    [20, 20, 40, 4, 9],
    // esteira para a direita
    [60, 20, 4, 24, 11],
    // desce
    [24, 44, 36, 4, 10],
    // volta para a esquerda
    [70, 52, 26, 4, 9],
    [30, 30, 6, 6, 1],
    // máquinas
    [46, 30, 6, 6, 1],
    [80, 30, 4, 10, 1],
    [14, 56, 8, 2, 2]
  ],
  dinamicas: [
    { peca: [66, 26, 2, 12], periodo: 6, fechado: 2 },
    { peca: [36, 52, 12, 2], periodo: 6, fechado: 2, fase: 3 }
  ],
  pickups: [
    { tipo: "vida", c: 40, r: 38 },
    { tipo: "forca", c: 76, r: 46 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: [[0, 0, 100, 70, "#16171b"]]
});
var APAGAO = construirMapa({
  id: "apagao",
  nome: "Apag\xE3o",
  descricao: "Mapa escuro: cada um s\xF3 v\xEA em volta de si e perto dos postes de luz.",
  quadrante: [
    ...quarteiroes().filter((_, i) => i % 2 === 0),
    [56, 30, 2, 8, 2],
    [30, 62, 8, 2, 2]
  ],
  escuro: {
    raioVisao: 300,
    luzes: [
      [100, 70, 260],
      [34, 29, 160],
      [70, 46, 160]
    ]
  },
  pickups: [
    { tipo: "vida", c: 34, r: 29 },
    { tipo: "forca", c: 70, r: 46 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: []
});
var LABIRINTO_VIVO = construirMapa({
  id: "labirintoVivo",
  nome: "Labirinto vivo",
  descricao: "Paredes que abrem e fecham a cada 10 s, trocando os caminhos durante a partida.",
  quadrante: [
    [30, 16, 2, 20, 1],
    [30, 46, 24, 2, 1],
    [60, 20, 20, 2, 1],
    [70, 34, 2, 14, 1],
    [88, 50, 2, 10, 1]
  ],
  dinamicas: [
    // conjunto A fecha nos primeiros 10 s de cada 20; o B, nos outros 10
    { peca: [32, 26, 18, 2], periodo: 20, fechado: 10 },
    { peca: [54, 46, 2, 14], periodo: 20, fechado: 10 },
    { peca: [44, 30, 2, 16], periodo: 20, fechado: 10, fase: 10 },
    { peca: [72, 34, 16, 2], periodo: 20, fechado: 10, fase: 10 }
  ],
  pickups: [
    { tipo: "vida", c: 42, r: 38 },
    { tipo: "forca", c: 78, r: 28 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: []
});
var DEMOLICAO = construirMapa({
  id: "demolicao",
  nome: "Demoli\xE7\xE3o",
  descricao: "Muros que quebram com tiros e explos\xF5es: o mapa vai se abrindo durante a partida.",
  quadrante: [
    [20, 20, 3, 3, 1],
    [70, 18, 3, 3, 1],
    [50, 56, 3, 3, 1]
  ],
  destrutiveis: [
    [30, 14, 2, 22],
    [36, 34, 20, 2],
    [60, 20, 2, 20],
    [64, 44, 18, 2],
    [84, 22, 2, 14],
    [20, 46, 14, 2],
    [44, 50, 2, 14]
  ],
  pickups: [
    { tipo: "vida", c: 46, r: 26 },
    { tipo: "forca", c: 74, r: 34 }
  ],
  pickupsCentro: [{ tipo: "forca", c: 100, r: 70 }],
  zonas: []
});
var MAPAS = {
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
  demolicao: DEMOLICAO
};
var LISTA_MAPAS = Object.values(MAPAS);
function mapaAceitaModo(m, modo) {
  return modo === "bandeira" || modo === "bandeiraEquipe" ? m.paraBandeira : true;
}
var MAPA_PADRAO = "praca";
function bloco(m, c, r) {
  if (c < 0 || r < 0 || c >= m.colunas || r >= m.linhas) return 1;
  return m.grade[r * m.colunas + c];
}
function copiaDoMapa(m) {
  return { ...m, paredesTemp: [] };
}
function dentroDaArea(m, vaga, x, y) {
  const a = m.areas[vaga];
  return !!a && Math.hypot(x - a.x, y - a.y) <= a.raio;
}

// shared/src/personagens.ts
var P = (p) => p;
var PERSONAGENS = {
  // ------------------------------------------------------------ os 6 originais
  veni: P({
    id: "veni",
    nome: "Veni",
    cor: "#ff2e4d",
    marca: "nada",
    velocidade: 1,
    arma: { nome: "Arco explosivo", tipo: "projetil", dano: 20, recarga: 1.5, alcance: 440, velocidadeProjetil: 560, estilo: "flecha", explosao: { raio: 58, danoBorda: 10 } },
    ativa: { nome: "Teletransporte", descricao: "Salta para o ponto mais longe dos inimigos mais pr\xF3ximos (atravessa obst\xE1culos).", recarga: 10 },
    passiva: { nome: "Flecha preparada", descricao: "A primeira flecha depois de teletransportar causa +50% de dano e explode maior." }
  }),
  gut: P({
    id: "gut",
    nome: "Gut",
    cor: "#ffd21f",
    marca: "nada",
    velocidade: 1.4,
    arma: { nome: "Espada de fogo", tipo: "corpo", dano: 15, recarga: 0.75, alcance: 58, arcoGraus: 60, queimadura: { dano: 3, tiques: 3 } },
    ativa: { nome: "Giro flamejante", descricao: "Golpe em 360\xB0 que empurra e deixa queimando por 3 s.", recarga: 8 },
    passiva: { nome: "Velocidade alta", descricao: "Anda 40% mais r\xE1pido." }
  }),
  vini: P({
    id: "vini",
    nome: "Vini",
    cor: "#f2f6ff",
    marca: "nada",
    velocidade: 1,
    arma: { nome: "Canh\xE3o de tinta", tipo: "projetil", dano: 14, recarga: 0.9, alcance: 380, velocidadeProjetil: 420, estilo: "tinta", tinta: true },
    ativa: { nome: "Balde", descricao: "Espalha uma po\xE7a grande em volta e empurra quem estiver perto.", recarga: 7 },
    passiva: { nome: "Surfista de tinta", descricao: "Anda 30% mais r\xE1pido sobre a pr\xF3pria tinta. A tinta revela invis\xEDveis." }
  }),
  daniel: P({
    id: "daniel",
    nome: "Daniel",
    cor: "#ff8a00",
    marca: "nada",
    velocidade: 1,
    arma: { nome: "Guarda-chuva", tipo: "corpo", dano: 16, recarga: 0.6, alcance: 70, arcoGraus: 20 },
    ativa: { nome: "Escudo", descricao: "Abre o guarda-chuva em volta de si: bloqueia dano e proj\xE9teis de todos os lados por 5 s.", recarga: 10 },
    passiva: { nome: "Chuva de agulhas", descricao: "Quando o escudo acaba, solta 12 proj\xE9teis em todas as dire\xE7\xF5es (3 de dano cada)." }
  }),
  lucas: P({
    id: "lucas",
    nome: "Lucas",
    cor: "#a6ff2e",
    marca: "nada",
    velocidade: 1,
    arma: { nome: "Raios el\xE9tricos", tipo: "aura", dano: 5, recarga: 0.6, alcance: 75 },
    ativa: { nome: "Onda de choque", descricao: "Um anel el\xE9trico que se expande longe, causa dano e empurra.", recarga: 10 },
    passiva: { nome: "Est\xE1tica", descricao: "Quem acerta o Lucas (com qualquer ataque) leva 2 de dano de volta." }
  }),
  pacheco: P({
    id: "pacheco",
    nome: "Pacheco",
    cor: "#19d3e6",
    marca: "nada",
    velocidade: 1,
    arma: { nome: "Mangueira", tipo: "projetil", dano: 1, recarga: 1 / 18, alcance: 280, velocidadeProjetil: 620, estilo: "gota", agua: true },
    ativa: { nome: "Voo", descricao: "Voa por 4 s por cima de obst\xE1culos e \xE1gua (a borda do mapa segura).", recarga: 7 },
    passiva: { nome: "Nadador", descricao: "Anda sobre a \xE1gua, mas a lava queima o dobro." }
  }),
  // ------------------------------------------------------------ 6 novos (primeira leva)
  sombra: P({
    id: "sombra",
    nome: "Sombra",
    cor: "#9b5cff",
    marca: "triangulo",
    velocidade: 1.05,
    arma: { nome: "Adagas", tipo: "projetil", dano: 5, recarga: 0.5, alcance: 200, velocidadeProjetil: 720, estilo: "adaga", projeteis: 2, leque: 7 },
    ativa: { nome: "Invis\xEDvel", descricao: "Some por 5 s. Atacar revela; o primeiro acerto causa +50%. Tinta, dano e faro revelam.", recarga: 10 },
    passiva: { nome: "Pelas costas", descricao: "+30% de dano em quem est\xE1 de costas para ela." }
  }),
  vampiro: P({
    id: "vampiro",
    nome: "Vampiro",
    cor: "#ff2fb4",
    marca: "cruz",
    velocidade: 1,
    arma: { nome: "Seringa", tipo: "projetil", dano: 12, recarga: 0.9, alcance: 360, velocidadeProjetil: 600, estilo: "dardo", rouboVida: 0.4 },
    ativa: { nome: "Totem de sangue", descricao: "\xC1rea que cura 5 por segundo s\xF3 para ele, por 5 s.", recarga: 7 },
    passiva: { nome: "Sede", descricao: "Recupera 10 de vida ao eliminar algu\xE9m." }
  }),
  engenheiro: P({
    id: "engenheiro",
    nome: "Engenheiro",
    cor: "#3d6bff",
    marca: "quadrado",
    velocidade: 1,
    arma: { nome: "Pistola de pregos", tipo: "projetil", dano: 4, recarga: 0.9, alcance: 340, velocidadeProjetil: 800, estilo: "prego", projeteis: 3, leque: 4 },
    ativa: { nome: "Parede", descricao: "Ergue \xE0 frente uma parede s\xF3lida por 5 s, que bloqueia tudo.", recarga: 6 },
    passiva: { nome: "Blindado", descricao: "Leva 20% menos dano de proj\xE9teis." }
  }),
  pescador: P({
    id: "pescador",
    nome: "Pescador",
    cor: "#c0c8d8",
    marca: "anel",
    velocidade: 1,
    arma: { nome: "Rede", tipo: "corpo", dano: 10, recarga: 0.8, alcance: 78, arcoGraus: 35 },
    ativa: { nome: "Gancho", descricao: "Lan\xE7a um gancho que puxa o inimigo atingido at\xE9 ele.", recarga: 2 },
    passiva: { nome: "\xCDm\xE3", descricao: "Pega pickups a at\xE9 150 px de dist\xE2ncia." }
  }),
  gravidade: P({
    id: "gravidade",
    nome: "Gravidade",
    cor: "#00c98d",
    marca: "ponto",
    velocidade: 0.95,
    arma: { nome: "Orbe", tipo: "projetil", dano: 9, recarga: 1.2, alcance: 400, velocidadeProjetil: 260, estilo: "orbe", atravessa: true },
    ativa: { nome: "Buraco negro", descricao: "Por 2 s, puxa todos os inimigos para um ponto \xE0 frente.", recarga: 8 },
    passiva: { nome: "Massa", descricao: "Imune a empurr\xF5es e pux\xF5es." }
  }),
  ilusionista: P({
    id: "ilusionista",
    nome: "Ilusionista",
    cor: "#e08a4f",
    marca: "losango",
    velocidade: 1,
    arma: { nome: "Bumerangue", tipo: "projetil", dano: 9, recarga: 1.1, alcance: 300, velocidadeProjetil: 520, estilo: "bumerangue", bumerangue: true },
    ativa: { nome: "Clones", descricao: "5 c\xF3pias saem em dire\xE7\xF5es diferentes por 4 s e enganam os outros.", recarga: 6 },
    passiva: { nome: "Fuga", descricao: "Uma vez por partida, ao cair abaixo de 25 de vida, fica invis\xEDvel por 1,5 s." }
  }),
  // ------------------------------------------------------------ 10 novos (segunda leva)
  atirador: P({
    id: "atirador",
    nome: "Atirador",
    cor: "#2a9bb0",
    marca: "xis",
    velocidade: 1,
    arma: { nome: "Rifle", tipo: "projetil", dano: 14, recarga: 1, alcance: 520, velocidadeProjetil: 1100, estilo: "bala", carga: { seg: 1.5, bonus: 1.5, bonusAlcance: 0.4 } },
    ativa: { nome: "Corrida", descricao: "Anda 50% mais r\xE1pido por 3 s.", recarga: 8 },
    passiva: { nome: "Paci\xEAncia", descricao: "Parado por 1 s, o pr\xF3ximo tiro causa +25%. Leva 25% mais dano de golpes corpo a corpo." }
  }),
  granadeiro: P({
    id: "granadeiro",
    nome: "Granadeiro",
    cor: "#8ea33a",
    marca: "quadrado",
    velocidade: 1,
    arma: { nome: "Granada", tipo: "projetil", dano: 18, recarga: 1.6, alcance: 300, velocidadeProjetil: 480, estilo: "granada", arco: true, explosao: { raio: 55, danoBorda: 8 } },
    ativa: { nome: "Chuva de granadas", descricao: "5 granadas espalhadas numa \xE1rea \xE0 frente.", recarga: 8 },
    passiva: { nome: "Explos\xE3o final", descricao: "Ao ser eliminado, explode e causa 20 de dano em volta." }
  }),
  armadilheiro: P({
    id: "armadilheiro",
    nome: "Armadilheiro",
    cor: "#d8c39a",
    marca: "barra",
    velocidade: 1,
    arma: { nome: "Besta", tipo: "projetil", dano: 11, recarga: 0.85, alcance: 420, velocidadeProjetil: 650, estilo: "dardo" },
    ativa: { nome: "Mina", descricao: "Mina quase invis\xEDvel: prende quem pisar por 1,5 s e causa 10. At\xE9 3 minas.", recarga: 6 },
    passiva: { nome: "Faro", descricao: "V\xEA minas e invis\xEDveis a at\xE9 150 px." }
  }),
  gelo: P({
    id: "gelo",
    nome: "Gelo",
    cor: "#9fe6ff",
    marca: "losango",
    velocidade: 1,
    arma: { nome: "Cristais", tipo: "projetil", dano: 7, recarga: 0.6, alcance: 380, velocidadeProjetil: 650, estilo: "cristal", frio: true },
    ativa: { nome: "Congelar", descricao: "Congela por 1,5 s todos em volta e causa 8.", recarga: 8 },
    passiva: { nome: "Pele fria", descricao: "Quem o acerta corpo a corpo ganha 2 camadas de frio." }
  }),
  veneno: P({
    id: "veneno",
    nome: "Veneno",
    cor: "#4fd12c",
    marca: "triangulo",
    velocidade: 1,
    arma: { nome: "Zarabatana", tipo: "projetil", dano: 3, recarga: 0.7, alcance: 400, velocidadeProjetil: 600, estilo: "dardo", veneno: { dano: 2, tiques: 4 } },
    ativa: { nome: "Nuvem t\xF3xica", descricao: "Nuvem \xE0 frente que causa 5 por segundo a quem estiver dentro, por 6 s.", recarga: 8 },
    passiva: { nome: "Ant\xEDdoto", descricao: "Imune a veneno e queimadura." }
  }),
  hacker: P({
    id: "hacker",
    nome: "Hacker",
    cor: "#ff6ec7",
    marca: "xis",
    velocidade: 1,
    arma: { nome: "Pistola de pulso", tipo: "projetil", dano: 8, recarga: 0.55, alcance: 400, velocidadeProjetil: 750, estilo: "pulso" },
    ativa: { nome: "Pane", descricao: "Disparo que deixa o atingido sem habilidade ativa por 4 s e causa 5.", recarga: 3 },
    passiva: { nome: "Glitch", descricao: "N\xE3o aparece nas setas dos inimigos." }
  }),
  relojoeiro: P({
    id: "relojoeiro",
    nome: "Relojoeiro",
    cor: "#e0b84a",
    marca: "anel",
    velocidade: 1,
    arma: { nome: "Ponteiros", tipo: "projetil", dano: 5, recarga: 0.8, alcance: 320, velocidadeProjetil: 680, estilo: "adaga", projeteis: 3, leque: 10 },
    ativa: { nome: "Voltar no tempo", descricao: "Volta para onde estava 5 s atr\xE1s (e recupera a vida, se era maior).", recarga: 9 },
    passiva: { nome: "Eco", descricao: "Ao voltar no tempo, solta uma pequena onda de choque que causa 5." }
  }),
  berserker: P({
    id: "berserker",
    nome: "Berserker",
    cor: "#b3122e",
    marca: "cruz",
    velocidade: 1,
    arma: { nome: "Machado", tipo: "corpo", dano: 18, recarga: 1, alcance: 66, arcoGraus: 75 },
    ativa: { nome: "F\xFAria", descricao: "Por 4 s, ataca 40% mais r\xE1pido e recupera 30% do dano causado.", recarga: 13 },
    passiva: { nome: "Sangue quente", descricao: "Quanto menos vida, mais dano (at\xE9 +50%)." }
  }),
  domador: P({
    id: "domador",
    nome: "Domador",
    cor: "#9b6a3c",
    marca: "ponto",
    velocidade: 1,
    arma: { nome: "Estilingue", tipo: "projetil", dano: 12, recarga: 0.8, alcance: 360, velocidadeProjetil: 520, estilo: "pedra" },
    ativa: { nome: "Drone", descricao: "Um drone segue o Domador por 8 s e atira no inimigo mais pr\xF3ximo.", recarga: 14 },
    passiva: { nome: "Companheiro", descricao: "Cada elimina\xE7\xE3o tira 5 s da recarga do drone." }
  }),
  espelho: P({
    id: "espelho",
    nome: "Espelho",
    cor: "#a9c6e8",
    marca: "barra",
    velocidade: 1,
    arma: { nome: "Cacos", tipo: "projetil", dano: 5, recarga: 0.8, alcance: 260, velocidadeProjetil: 700, estilo: "caco", projeteis: 3, leque: 8 },
    ativa: { nome: "Reflexo", descricao: "Por 3 s, devolve os proj\xE9teis para quem atirou.", recarga: 8 },
    passiva: { nome: "Duplicata", descricao: "Ao levar dano, 35% de chance de deixar um reflexo que confunde." }
  }),
  // ------------------------------------------------------------ 8 novos (terceira leva)
  ninja: P({
    id: "ninja",
    nome: "Ninja",
    cor: "#5c7cfa",
    marca: "xis",
    velocidade: 1.15,
    arma: { nome: "Shuriken", tipo: "projetil", dano: 7, recarga: 0.55, alcance: 380, velocidadeProjetil: 700, estilo: "shuriken", ricochete: 2 },
    ativa: { nome: "Avan\xE7o", descricao: "Avan\xE7a 200 px, atravessando inimigos e cortando quem estiver no caminho.", recarga: 7 },
    passiva: { nome: "Leveza", descricao: "Anda 15% mais r\xE1pido. As shurikens quicam 2 vezes nas paredes." }
  }),
  tanque: P({
    id: "tanque",
    nome: "Tanque",
    cor: "#8c96a8",
    marca: "quadrado",
    velocidade: 0.85,
    vida: 140,
    arma: { nome: "Canh\xE3o", tipo: "projetil", dano: 24, recarga: 1.4, alcance: 360, velocidadeProjetil: 380, estilo: "bola", explosao: { raio: 40, danoBorda: 10 } },
    ativa: { nome: "Investida", descricao: "Avan\xE7a 160 px, empurrando e causando 12 em quem estiver no caminho.", recarga: 11 },
    passiva: { nome: "Coura\xE7a", descricao: "140 de vida, mas anda 15% mais devagar." }
  }),
  medico: P({
    id: "medico",
    nome: "M\xE9dico",
    cor: "#7dffcf",
    marca: "cruz",
    velocidade: 1,
    arma: { nome: "Dardo", tipo: "projetil", dano: 9, recarga: 0.7, alcance: 380, velocidadeProjetil: 650, estilo: "dardo" },
    ativa: { nome: "Kit", descricao: "Cura 30 e remove efeitos ruins (veneno, queimadura, frio, pris\xE3o, lentid\xE3o, pane, marca).", recarga: 14 },
    passiva: { nome: "Regenera\xE7\xE3o", descricao: "Recupera 2 de vida por segundo depois de 3 s sem levar dano." }
  }),
  cacador: P({
    id: "cacador",
    nome: "Ca\xE7ador",
    cor: "#ff7f50",
    marca: "triangulo",
    velocidade: 1,
    arma: { nome: "Boleadeira", tipo: "projetil", dano: 10, recarga: 1, alcance: 340, velocidadeProjetil: 560, estilo: "boleadeira", prende: 0.6 },
    ativa: { nome: "Marcar", descricao: "Tiro que marca o alvo por 5 s: ele leva +25% de dano de todos e n\xE3o fica invis\xEDvel; as boleadeiras do Ca\xE7ador viram teleguiadas at\xE9 ele, com metade do dano.", recarga: 12 },
    passiva: { nome: "Rastreador", descricao: "+20% de dano em alvos lentos ou presos." }
  }),
  laserista: P({
    id: "laserista",
    nome: "Laserista",
    cor: "#d7a6ff",
    marca: "barra",
    velocidade: 1,
    arma: { nome: "Feixe", tipo: "projetil", dano: 6, recarga: 0.45, alcance: 360, instantaneo: true },
    ativa: { nome: "Sobrecarga", descricao: "Por 3 s, o feixe recarrega na metade do tempo.", recarga: 10 },
    passiva: { nome: "Foco", descricao: "Acertos seguidos no mesmo alvo causam +1 cada (at\xE9 +4)." }
  }),
  trocador: P({
    id: "trocador",
    nome: "Trocador",
    cor: "#00e5c0",
    marca: "losango",
    velocidade: 1,
    arma: { nome: "Bolhas", tipo: "projetil", dano: 10, recarga: 0.8, alcance: 360, velocidadeProjetil: 480, estilo: "bolha" },
    ativa: { nome: "Troca", descricao: "Troca de lugar com o inimigo mais pr\xF3ximo (at\xE9 700 px).", recarga: 5 },
    passiva: { nome: "Desorientar", descricao: "Depois da troca, o inimigo fica 30% mais lento por 1,5 s." }
  }),
  bardo: P({
    id: "bardo",
    nome: "Bardo",
    cor: "#ffb3c7",
    marca: "anel",
    velocidade: 1,
    arma: { nome: "Notas", tipo: "projetil", dano: 8, recarga: 0.65, alcance: 380, velocidadeProjetil: 560, estilo: "nota" },
    ativa: { nome: "Can\xE7\xE3o", descricao: "Por 4 s, anda e ataca 35% mais r\xE1pido.", recarga: 7 },
    passiva: { nome: "Refr\xE3o", descricao: "A cada 4 acertos, a nota causa o dobro." }
  }),
  astro: P({
    id: "astro",
    nome: "Astro",
    cor: "#ffe9a8",
    marca: "losango",
    velocidade: 1,
    arma: { nome: "Estrela cadente", tipo: "projetil", dano: 16, recarga: 1.3, alcance: 420, velocidadeProjetil: 620, estilo: "estrela" },
    ativa: { nome: "Meteoro", descricao: "Depois de 1 s de aviso, um meteoro cai \xE0 frente: 30 no centro, 12 na borda.", recarga: 12 },
    passiva: { nome: "Constela\xE7\xE3o", descricao: "Cada elimina\xE7\xE3o recarrega o meteoro na hora." }
  })
};
var LISTA_PERSONAGENS = Object.values(PERSONAGENS);
var vidaMaxima = (id) => PERSONAGENS[id].vida ?? 100;
var IDS_PERSONAGENS = Object.keys(PERSONAGENS);
var HABILIDADES = {
  teletransporte: { minimo: 260, maximo: 560 },
  flechaPreparada: { bonusDano: 0.5, bonusRaio: 0.4 },
  giro: { raio: 82, dano: 14, empurrao: 90, queimadura: { dano: 4, tiques: 3 } },
  /** Poças de tinta do Vini. `lentidao` = fator de velocidade dos inimigos dentro da poça. */
  tinta: { raio: 40, segDuracao: 4, maxPocas: 5, lentidao: 0.5, surfista: 1.3 },
  balde: { raio: 110, segDuracao: 5, empurrao: 40 },
  /** Escudo do Daniel: protege um arco em volta da mira (180° para cada lado = 360°, todos os lados). */
  escudo: { segDuracao: 5, arcoGraus: 180, raio: 26 },
  adrenalina: { fator: 1.5, segDuracao: 1.5, segRecarga: 5 },
  /** Lentidão do choque do Lucas (fica no inimigo; com a tinta, vale a maior). */
  choque: { lentidao: 0.7, segDuracao: 1.2 },
  onda: { raioMax: 380, segExpansao: 0.5, dano: 16, empurrao: 130 },
  estatica: { dano: 2 },
  voo: { segDuracao: 4, fatorVelocidade: 1.25 },
  // novos
  invisivel: { segDuracao: 5, bonusEmboscada: 0.5 },
  costas: { bonus: 0.3 },
  totem: { raio: 90, segDuracao: 5, curaPorSeg: 5 },
  sede: { cura: 10 },
  parede: { comprimento: 96, espessura: 16, distancia: 48, segDuracao: 5 },
  blindado: { reducao: 0.2 },
  gancho: { alcance: 420, velocidade: 850, dano: 6, distanciaFinal: 34 },
  ima: { raio: 150 },
  buraco: { distancia: 220, raio: 260, segDuracao: 2, puxaoPorSeg: 150, danoPorSeg: 4 },
  clone: { segDuracao: 4, quantidade: 5 },
  fuga: { limiteVida: 25, segDuracao: 1.5 },
  laser: { segDuracao: 3 },
  corrida: { segDuracao: 3, fator: 1.5 },
  corpoAtirador: { extra: 0.25 },
  paciencia: { segParado: 1, bonus: 0.25 },
  chuva: { distancia: 240, espalhamento: 90, quantidade: 5, intervalo: 0.15, raio: 45, dano: 12 },
  explosaoFinal: { raio: 80, dano: 20 },
  mina: { maximo: 3, raioGatilho: 22, raioVisivel: 70, dano: 10, segPreso: 1.5 },
  faro: { raio: 150 },
  /** Frio: cada camada = 10% de lentidão, até 5 camadas; dura 3 s (renova a cada acerto). */
  frio: { porCamada: 0.1, maxCamadas: 5, segDuracao: 3 },
  congelar: { raio: 140, segDuracao: 1.5, dano: 8 },
  peleFria: { camadas: 2 },
  nuvem: { distancia: 200, raio: 110, segDuracao: 6, danoPorSeg: 5 },
  pane: { segDuracao: 4, dano: 5, velocidade: 900, alcance: 450 },
  rebobinar: { segAtras: 5 },
  eco: { raio: 90, dano: 5 },
  furia: { segDuracao: 4, fatorRecarga: 1 / 1.4, rouboVida: 0.3 },
  sangueQuente: { bonusMax: 0.5 },
  drone: { segDuracao: 8, intervalo: 0.7, alcance: 300, dano: 4, velocidade: 600, distancia: 34 },
  companheiro: { reducaoSeg: 5 },
  reflexo: { segDuracao: 3 },
  duplicata: { chance: 0.35, segDuracao: 2 },
  agulhas: { quantidade: 12, dano: 3, alcance: 260, velocidade: 600 },
  lavaPacheco: { fator: 2 },
  guiado: { fatorDano: 0.5, giroPorSeg: 6 },
  avanco: { distancia: 200, dano: 10, largura: 24 },
  investida: { distancia: 160, dano: 12, empurrao: 80, largura: 28 },
  kit: { cura: 30 },
  regeneracao: { segSemDano: 3, porSeg: 2 },
  marca: { segDuracao: 5, bonus: 0.25, dano: 6, velocidade: 700, alcance: 420 },
  rastreador: { bonus: 0.2 },
  sobrecarga: { segDuracao: 3, fatorRecarga: 0.5 },
  foco: { maximo: 4 },
  troca: { velocidade: 700, alcance: 700, dano: 4, segDesorientado: 1.5 },
  cancao: { segDuracao: 4, fator: 1.35 },
  refrao: { cada: 4 },
  meteoro: { distancia: 260, segAviso: 1, raio: 110, dano: 30, danoBorda: 12 }
};

// shared/src/esquemas.ts
var S = CONFIG.sala;
var apelido = z.string().transform((s) => s.normalize("NFC").replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(S.tamanhoMaxApelido).regex(/^[^<>&"'`]+$/u));
var codigo = z.string().transform((s) => s.trim().toUpperCase()).pipe(z.string().length(S.tamanhoCodigo).regex(new RegExp(`^[${S.alfabetoCodigo}]+$`)));
var direcao = z.object({ dx: z.number().min(-1.5).max(1.5), dy: z.number().min(-1.5).max(1.5) }).strict();
var ESQUEMAS = {
  "sala:criar": z.object({ apelido }).strict(),
  "sala:entrar": z.object({ codigo, apelido }).strict(),
  "sala:reconectar": z.object({ token: z.string().min(16).max(128) }).strict(),
  "sala:sair": z.object({}).strict(),
  "sala:expulsar": z.object({ jogadorId: z.string().min(1).max(64) }).strict(),
  "lobby:personagem": z.object({ personagem: z.enum(IDS_PERSONAGENS).nullable() }).strict(),
  "lobby:pronto": z.object({ pronto: z.boolean() }).strict(),
  "lobby:mapa": z.object({ mapa: z.enum(IDS_MAPAS) }).strict(),
  "lobby:modo": z.object({ modo: z.enum(["royale", "abates", "corrida", "equipes", "neoncalypse", "bandeira", "bandeiraEquipe", "pintao", "pintaoEquipe"]) }).strict(),
  "lobby:equipe": z.object({ equipe: z.number().int().min(0).max(1) }).strict(),
  "lobby:corEquipe": z.object({ cor: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict(),
  "jogo:personagem": z.object({ personagem: z.enum(IDS_PERSONAGENS) }).strict(),
  "lobby:iniciar": z.object({}).strict(),
  "jogo:cmd": z.object({ seq: z.number().int().nonnegative(), x: z.number().min(-1.5).max(1.5), y: z.number().min(-1.5).max(1.5) }).strict(),
  "jogo:atacar": z.object({ dx: z.number().min(-1.5).max(1.5), dy: z.number().min(-1.5).max(1.5), carga: z.number().min(0).max(1).optional() }).strict(),
  "jogo:mira": direcao,
  "jogo:ativa": direcao
};

// shared/src/colisao.ts
var R = CONFIG.movimento.raioJogador;
function solido(m, c, r, passa) {
  if (passa === "tudo") return c <= 0 || r <= 0 || c >= m.colunas - 1 || r >= m.linhas - 1;
  const b = bloco(m, c, r);
  return b === 1 || b === 2 || b === 3 && passa !== "agua";
}
function empurrar(x, y, r, x0, y0, x1, y1) {
  const px = Math.max(x0, Math.min(x, x1));
  const py = Math.max(y0, Math.min(y, y1));
  const dx = x - px;
  const dy = y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return [x, y];
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    return [x + dx * k, y + dy * k];
  }
  const opc = [
    [x0 - r, y, x - x0],
    [x1 + r, y, x1 - x],
    [x, y0 - r, y - y0],
    [x, y1 + r, y1 - y]
  ];
  opc.sort((a, b) => a[2] - b[2]);
  return [opc[0][0], opc[0][1]];
}
function resolver(m, x, y, r = R, passa = "nada") {
  for (let it = 0; it < 3; it++) {
    const c0 = Math.floor((x - r) / BLOCO) - 1;
    const c1 = Math.floor((x + r) / BLOCO) + 1;
    const r0 = Math.floor((y - r) / BLOCO) - 1;
    const r1 = Math.floor((y + r) / BLOCO) + 1;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (solido(m, cc, rr, passa)) [x, y] = empurrar(x, y, r, cc * BLOCO, rr * BLOCO, (cc + 1) * BLOCO, (rr + 1) * BLOCO);
      }
    }
    if (passa !== "tudo") for (const p of m.paredesTemp) [x, y] = empurrar(x, y, r, p.x, p.y, p.x + p.w, p.y + p.h);
  }
  return [x, y];
}
function posicaoLivre(m, x, y, r = R, passa = "nada") {
  const [nx, ny] = resolver(m, x, y, r, passa);
  return Math.abs(nx - x) < 0.01 && Math.abs(ny - y) < 0.01;
}
function mover(m, x, y, dx, dy, passa = "nada") {
  const dist = Math.hypot(dx, dy);
  const passos = Math.max(1, Math.ceil(dist / 3));
  let cx = x;
  let cy = y;
  for (let i = 0; i < passos; i++) [cx, cy] = resolver(m, cx + dx / passos, cy + dy / passos, R, passa);
  return { x: Math.round(cx * 1e3) / 1e3, y: Math.round(cy * 1e3) / 1e3 };
}
function destinoFuga(m, x, y, inimigos2, minimo, maximo, dx, dy) {
  let melhor = null;
  const aneis = 4;
  for (let a = 0; a < 32; a++) {
    const ang = a / 32 * Math.PI * 2;
    for (let k = 0; k <= aneis; k++) {
      const d = minimo + (maximo - minimo) * k / aneis;
      const px = x + Math.cos(ang) * d;
      const py = y + Math.sin(ang) * d;
      if (!posicaoLivre(m, px, py)) continue;
      const nota = inimigos2.length ? Math.min(...inimigos2.map((i) => Math.hypot(i.x - px, i.y - py))) : Math.cos(ang) * dx + Math.sin(ang) * dy + d / 1e4;
      if (!melhor || nota > melhor.nota) melhor = { x: px, y: py, nota };
    }
  }
  return melhor ? { x: melhor.x, y: melhor.y } : { x, y };
}
function bloqueiaTiro(m, x, y) {
  const b = bloco(m, Math.floor(x / BLOCO), Math.floor(y / BLOCO));
  if (b === 1 || b === 2) return true;
  for (const p of m.paredesTemp) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
  return false;
}
function linhaLivre(m, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d / 4));
  for (let i = 1; i < n; i++) {
    if (bloqueiaTiro(m, ax + (bx - ax) * i / n, ay + (by - ay) * i / n)) return false;
  }
  return true;
}
function pontoLivrePerto(m, x, y, passa = "nada") {
  if (posicaoLivre(m, x, y, R, passa)) return { x, y };
  for (let d = 8; d < 600; d += 8) {
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      if (posicaoLivre(m, px, py, R, passa)) return { x: px, y: py };
    }
  }
  return { x, y };
}

// shared/src/movimento.ts
function fatorTinta(jogadorId, personagem, x, y, pocas, aliados2) {
  let propria = false;
  let inimiga = false;
  for (const p of pocas) {
    if ((x - p.x) ** 2 + (y - p.y) ** 2 > p.r * p.r) continue;
    if (p.dono === jogadorId) propria = true;
    else if (!aliados2?.has(p.dono)) inimiga = true;
  }
  if (inimiga) return HABILIDADES.tinta.lentidao;
  if (propria && personagem === "vini") return HABILIDADES.tinta.surfista;
  return 1;
}
function fatorVelocidade(tinta, chocado, adrenalina, outra = 1) {
  let f = tinta;
  if (chocado) f = Math.min(f, HABILIDADES.choque.lentidao);
  if (outra < 1) f = Math.min(f, outra);
  return f * (adrenalina ? HABILIDADES.adrenalina.fator : 1);
}
function passagemDe(personagem, voando) {
  if (voando) return "tudo";
  return personagem === "pacheco" ? "agua" : "nada";
}
var TERRENO = { lama: 0.6, aderenciaGelo: 0.12, esteira: 130 };
function aplicarMovimento(mapa, personagem, x, y, cx, cy, fator = 1, voando = false, vel = { vx: 0, vy: 0 }) {
  const dt = CONFIG.movimento.dtComando;
  const piso = voando ? 0 : bloco(mapa, Math.floor(x / BLOCO), Math.floor(y / BLOCO));
  const m = Math.hypot(cx, cy);
  const k = m > 1 ? 1 / m : 1;
  const vMax = CONFIG.movimento.velocidadeBase * PERSONAGENS[personagem].velocidade * fator * (piso === T.LAMA ? TERRENO.lama : 1);
  const alvoX = cx * k * vMax;
  const alvoY = cy * k * vMax;
  const gelo = piso === T.GELO;
  let vx = gelo ? vel.vx + (alvoX - vel.vx) * TERRENO.aderenciaGelo : alvoX;
  let vy = gelo ? vel.vy + (alvoY - vel.vy) * TERRENO.aderenciaGelo : alvoY;
  let dx = vx * dt;
  let dy = vy * dt;
  const esteira = ESTEIRAS[piso];
  if (esteira) {
    dx += esteira[0] * TERRENO.esteira * dt;
    dy += esteira[1] * TERRENO.esteira * dt;
  }
  const p = mover(mapa, x, y, dx, dy, passagemDe(personagem, voando));
  if (gelo) {
    vx = (p.x - x) / dt;
    vy = (p.y - y) / dt;
  }
  return { x: p.x, y: p.y, vx: Math.round(vx * 100) / 100, vy: Math.round(vy * 100) / 100 };
}

// shared/src/protocolo.ts
var MODOS_EQUIPE = ["equipes", "bandeiraEquipe", "pintaoEquipe"];
var MODOS_TROCA = ["equipes", "bandeira", "bandeiraEquipe", "pintao", "pintaoEquipe"];
var CASA_PINTURA = 32;
var CORES_EQUIPE = ["#ff3d9a", "#19d3e6", "#ffd21f", "#a6ff2e", "#ff8a00", "#9b5cff", "#f2f6ff", "#ff2e4d"];

// server/src/jogo.ts
var R2 = CONFIG.movimento.raioJogador;
var H = HABILIDADES;
var BANDEIRA = { segCaptura: 3, meta: 300, segPartida: 300, raio: 70, raioCentro: 110, valor: 1, valorCentro: 3 };
var ehBandeira = (m) => m === "bandeira" || m === "bandeiraEquipe";
var PINTAO = { segPartida: 180, raioRastro: 24, raioImpacto: 40 };
var ehPintao = (m) => m === "pintao" || m === "pintaoEquipe";
function criarPintura(m) {
  const colunas = Math.ceil(m.largura / CASA_PINTURA);
  const linhas = Math.ceil(m.altura / CASA_PINTURA);
  const pintavel = new Uint8Array(colunas * linhas);
  let pintaveis = 0;
  for (let r = 0; r < linhas; r++) {
    for (let c = 0; c < colunas; c++) {
      const bx = Math.floor((c + 0.5) * CASA_PINTURA / BLOCO);
      const by = Math.floor((r + 0.5) * CASA_PINTURA / BLOCO);
      if (bloco(m, bx, by) === 0) {
        pintavel[r * colunas + c] = 1;
        pintaveis++;
      }
    }
  }
  return { colunas, linhas, dono: new Uint8Array(colunas * linhas), pintor: new Uint8Array(colunas * linhas), pintavel, pintaveis, contagem: new Array(8).fill(0), mudancas: [], proximaCompleta: 0, enviarCompleta: true };
}
var ladoPintura = (l) => l.equipe !== null ? l.equipe + 1 : l.vaga + 1;
function pintar(e, l, x, y, raio) {
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
      p.contagem[p.dono[i]]--;
      p.dono[i] = lado;
      p.pintor[i] = pintor;
      p.contagem[lado]++;
      p.mudancas.push(i, lado);
    }
  }
}
function apagarPintura(e, l) {
  const p = e.pintura;
  if (!p) return;
  const pintor = l.vaga + 1;
  for (let i = 0; i < p.dono.length; i++) {
    if (p.pintor[i] !== pintor) continue;
    p.contagem[p.dono[i]]--;
    p.contagem[0]++;
    p.dono[i] = 0;
    p.pintor[i] = 0;
    p.mudancas.push(i, 0);
  }
}
function limparMudancasPintura(e) {
  if (!e.pintura) return;
  e.pintura.mudancas = [];
  e.pintura.enviarCompleta = false;
}
var SUPERNOVA = { segIntervalo: 30, segDuracao: 5, dano: 2, recarga: 0.5, movimento: 1.5, danoNeon: 1.5, recargaNeon: 0.75, raioColeta: 34 };
var LAVA = { danoPorSeg: 8, segCredito: 3 };
var MURO = { vida: 60 };
var SALTO = { segDuracao: 0.7, raio: 24 };
var PORTAL = { raio: 24, segEspera: 1 };
var MOITA = { raioVisto: 120, segRevelado: 1.5 };
function criarJogo(participantes, agora, mapa = MAPAS[MAPA_PADRAO], modo = "royale", coresEquipe = ["#ff3d9a", "#19d3e6"], ladosTrocados = false) {
  const m = copiaDoMapa(mapa);
  const lutadores = /* @__PURE__ */ new Map();
  const emEquipe = MODOS_EQUIPE.includes(modo);
  const vagasEquipe = ladosTrocados ? [[2, 1, 5], [0, 3, 4]] : [[0, 3, 4], [2, 1, 5]];
  const usadas = [0, 0];
  participantes.forEach((p, i) => {
    const equipe = emEquipe ? p.equipe ?? i % 2 : null;
    const vaga = p.vaga ?? (equipe !== null ? vagasEquipe[equipe][usadas[equipe]++ % 3] : i);
    const ini = m.nascimentos[vaga % m.nascimentos.length];
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
      fora: false
    };
    Object.defineProperty(l, "queimadura", { get: () => l.dots.find((d) => d.tipo === "fogo") ?? null, enumerable: false });
    lutadores.set(p.id, l);
  });
  const estado = {
    mapa: m,
    modo,
    pintura: ehPintao(modo) ? criarPintura(m) : null,
    muros: m.destrutiveis.map((ret, i) => ({ id: -1e3 - i, ret, vida: MURO.vida })),
    supernova: null,
    proximaSupernova: agora + (CONFIG.partida.segContagem + SUPERNOVA.segIntervalo) * 1e3,
    controle: ehBandeira(modo) ? pontosDeControle(m) : [],
    fimEm: ehBandeira(modo) ? agora + (CONFIG.partida.segContagem + BANDEIRA.segPartida) * 1e3 : ehPintao(modo) ? agora + (CONFIG.partida.segContagem + PINTAO.segPartida) * 1e3 : 0,
    proximoPontoControle: 0,
    pontosEquipe: [0, 0],
    coresEquipe,
    proximoDanoZona: 0,
    meta: modo === "abates" ? 10 : modo === "corrida" ? IDS_PERSONAGENS.length : modo === "equipes" ? 25 : ehBandeira(modo) ? BANDEIRA.meta : 0,
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
    aleatorio: Math.random
  };
  if (estado.pintura) {
    estado.pintura.contagem[0] = estado.pintura.pintaveis;
    estado.meta = estado.pintura.pintaveis;
  }
  return estado;
}
function aliados(a, b) {
  return !!a && !!b && a.id !== b.id && a.equipe !== null && a.equipe === b.equipe;
}
function idsAliados(e, l) {
  return new Set([...e.lutadores.values()].filter((o) => aliados(o, l)).map((o) => o.id));
}
var NEON = { dano: 2, recarga: 0.5, movimento: 1.5 };
var neon = (e) => e.modo === "neoncalypse";
function raioZona(e, agora) {
  const r0 = Math.hypot(e.mapa.largura / 2, e.mapa.altura / 2) + 60;
  const t = Math.max(0, (agora - e.inicio) / 1e3 - CONFIG.partida.segContagem);
  const etapa = Math.floor(t / 30);
  const dentro = Math.min(1, (t - etapa * 30) / 10);
  const de = r0 * 0.72 ** Math.max(0, etapa - 1);
  const ate = r0 * 0.72 ** etapa;
  return Math.max(140, etapa === 0 ? r0 : de + (ate - de) * dentro);
}
function pontosDeControle(m) {
  const cx = m.largura / 2;
  const cy = m.altura / 2;
  const livre = (x, y) => pontoLivrePerto(m, x, y, "nada");
  const lado = livre(cx - 780, cy);
  const diag = livre(cx - 400, cy - 640);
  const pts = m.controle ? m.controle.map((p, i) => [p.x, p.y, i === 0]) : [
    [cx, cy, true],
    [lado.x, cy, false],
    [m.largura - lado.x, cy, false],
    [diag.x, diag.y, false],
    [m.largura - diag.x, diag.y, false],
    [diag.x, m.altura - diag.y, false],
    [m.largura - diag.x, m.altura - diag.y, false]
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
    disputado: false
  }));
}
var ladoDe = (l) => l.equipe !== null ? `e${l.equipe}` : l.id;
function atualizarControle(e, dt, agora, efeitos) {
  for (const pc of e.controle) {
    const lados = /* @__PURE__ */ new Set();
    for (const l of e.lutadores.values()) if (l.vivo && Math.hypot(l.x - pc.x, l.y - pc.y) <= pc.r) lados.add(ladoDe(l));
    pc.disputado = lados.size > 1;
    if (lados.size === 1) {
      const lado = [...lados][0];
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
          efeitos.push({ tipo: "anel", x: pc.x, y: pc.y, raio: pc.r, cor: corDoLado(e, lado), ms: 500 });
        }
      }
    } else if (lados.size === 0 && pc.capturando) {
      pc.progresso = Math.max(0, pc.progresso - dt / (BANDEIRA.segCaptura * 2));
      if (pc.progresso === 0) pc.capturando = null;
    }
  }
  if (agora >= e.proximoPontoControle) {
    e.proximoPontoControle = agora + 1e3;
    for (const pc of e.controle) {
      if (!pc.dono) continue;
      if (pc.dono.startsWith("e")) e.pontosEquipe[Number(pc.dono.slice(1))] += pc.valor;
      else {
        const l = e.lutadores.get(pc.dono);
        if (l) l.pontos += pc.valor;
      }
    }
  }
  const emEquipe = e.modo === "bandeiraEquipe";
  const placar = emEquipe ? e.pontosEquipe.map((p, i) => ({ lado: i, p })) : [...e.lutadores.values()].filter((l) => !l.fora).map((l) => ({ lado: l.id, p: l.pontos }));
  const lider = [...placar].sort((a, b) => b.p - a.p);
  const venceu = (x) => e.fim = emEquipe ? { vencedorId: null, ...x ? { equipe: x.lado } : {} } : { vencedorId: x?.lado ?? null };
  if (lider[0] && lider[0].p >= e.meta) venceu(lider[0]);
  else if (agora >= e.fimEm) venceu(lider[0] && lider[1] && lider[0].p === lider[1].p ? void 0 : lider[0]);
}
function corDoLado(e, lado) {
  if (lado.startsWith("e")) return e.coresEquipe[Number(lado.slice(1))] ?? "#ffffff";
  const l = e.lutadores.get(lado);
  return l ? PERSONAGENS[l.personagem].cor : "#ffffff";
}
var comecou = (e, agora) => agora >= e.inicio + CONFIG.partida.segContagem * 1e3;
function outraLentidao(l, agora) {
  if (l.congeladoAte > agora || l.presoAte > agora) return 0;
  if (l.frio.ate > agora && l.frio.camadas > 0) return 1 - H.frio.porCamada * l.frio.camadas;
  return 1;
}
function aplicarComando(m, l, c, pocas = [], agora = 0, extra = 1, amigos) {
  const voando = l.voandoAte > agora;
  const tinta = voando ? H.voo.fatorVelocidade : fatorTinta(l.id, l.personagem, l.x, l.y, pocas, amigos);
  const f = fatorVelocidade(tinta, l.chocadoAte > agora, l.rapidoAte > agora, outraLentidao(l, agora)) * (l.cancaoAte > agora ? H.cancao.fator : 1) * extra;
  return aplicarMovimento(m, l.personagem, l.x, l.y, c.x, c.y, f, voando, { vx: l.vx, vy: l.vy });
}
function receberComando(l, c) {
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || c.seq <= l.seq) return;
  if (l.fila.length && c.seq <= l.fila[l.fila.length - 1].seq) return;
  l.fila.push(c);
  if (l.fila.length > 20) l.fila.shift();
}
function mirar(l, dx, dy) {
  const m = Math.hypot(dx, dy);
  if (l.vivo && m > 0.1) l.mira = { x: dx / m, y: dy / m };
}
function protegido(l, agora, semAreas = false) {
  return !semAreas && l.vivo && l.areaDesde !== null && !l.areaSuspensa && agora - l.areaDesde < CONFIG.areaSegura.segMaxSeguidos * 1e3;
}
function escudoCobre(l, ox, oy, agora) {
  if (l.escudoAte <= agora) return false;
  const vx = ox - l.x;
  const vy = oy - l.y;
  const d = Math.hypot(vx, vy);
  if (d < 0.01) return true;
  const cos = (vx * l.mira.x + vy * l.mira.y) / d;
  return cos >= Math.cos(H.escudo.arcoGraus * Math.PI / 180) - 1e-9;
}
function deslocar(e, o, dx, dy, agora) {
  if (o.personagem === "gravidade") return;
  const novo = mover(e.mapa, o.x, o.y, dx, dy, passagemDe(o.personagem, o.voandoAte > agora));
  o.x = novo.x;
  o.y = novo.y;
}
function vencedorSe(e) {
  if (e.fim) return;
  const vivos = [...e.lutadores.values()].filter((l) => l.vivo);
  if (vivos.length <= 1) e.fim = { vencedorId: vivos[0]?.id ?? null };
}
var multForca = (l, agora) => l && l.forcaAte > agora ? 1 + CONFIG.pickups.forca.bonusDano : 1;
function aplicarDano(e, alvo, valor, agora, efeitos, origem, op = {}) {
  if (!alvo.vivo) return 0;
  if (op.autor && aliados(op.autor, alvo)) return 0;
  if (protegido(alvo, agora, neon(e)) || origem && escudoCobre(alvo, origem.x, origem.y, agora)) {
    efeitos.push({ tipo: "dano", alvo: alvo.id, valor: 0, bloqueado: true });
    return 0;
  }
  let mult = 1;
  const a = op.autor;
  if (a && a.id !== alvo.id && op.tipo !== "lava") {
    if (a.personagem === "sombra") {
      const vx = a.x - alvo.x;
      const vy = a.y - alvo.y;
      if (vx * alvo.mira.x + vy * alvo.mira.y < 0) mult *= 1 + H.costas.bonus;
    }
    if (a.personagem === "berserker") mult *= 1 + H.sangueQuente.bonusMax * (1 - a.vida / vidaMaxima(a.personagem));
  }
  if (alvo.personagem === "engenheiro" && op.tipo === "projetil") mult *= 1 - H.blindado.reducao;
  if (alvo.personagem === "atirador" && op.tipo === "corpo") mult *= 1 + H.corpoAtirador.extra;
  if (alvo.marcadoAte > agora) mult *= 1 + H.marca.bonus;
  if (neon(e) && op.autor && op.tipo !== "lava") mult *= NEON.dano;
  if (op.autor && op.autor.supernovaAte > agora && op.tipo !== "lava") mult *= neon(e) ? SUPERNOVA.danoNeon : SUPERNOVA.dano;
  if (op.autor && op.autor.id !== alvo.id) alvo.ultimoAtacante = { id: op.autor.id, ate: agora + LAVA.segCredito * 1e3 };
  if (a?.personagem === "cacador" && estaLento(e, alvo, agora)) mult *= 1 + H.rastreador.bonus;
  alvo.ultimoDanoRecebido = agora;
  const v = Math.max(1, Math.round(valor * mult));
  const vidaAntes = alvo.vida;
  alvo.vida = Math.max(0, alvo.vida - v);
  alvo.invisivelAte = 0;
  efeitos.push({ tipo: "dano", alvo: alvo.id, valor: v, bloqueado: false });
  let roubo = op.rouboVida ?? 0;
  if (a?.personagem === "berserker" && a.furiaAte > agora) roubo += H.furia.rouboVida;
  if (a && a.vivo && roubo > 0) curar(a, Math.min(v, vidaAntes) * roubo, efeitos);
  if (alvo.personagem === "lucas" && a && a.vivo && a.id !== alvo.id && (op.tipo === "projetil" || op.tipo === "corpo" || op.tipo === "area")) {
    efeitos.push({ tipo: "estatica", de: alvo.id, alvo: a.id });
    aplicarDano(e, a, H.estatica.dano, agora, efeitos, alvo, { autor: alvo, tipo: "estatica" });
  }
  if (alvo.personagem === "espelho" && alvo.vida > 0 && e.aleatorio() < H.duplicata.chance) {
    e.entidades.push({ tipo: "clone", id: e.proximaEntidade++, dono: alvo.id, personagem: alvo.personagem, x: alvo.x + 18, y: alvo.y, dx: 0, dy: 0, ate: agora + H.duplicata.segDuracao * 1e3, parado: true });
  }
  if (alvo.personagem === "ilusionista" && !alvo.fugaUsada && alvo.vida > 0 && alvo.vida < H.fuga.limiteVida) {
    alvo.fugaUsada = true;
    alvo.invisivelAte = agora + H.fuga.segDuracao * 1e3;
  }
  if (alvo.vida <= 0) morrer(e, alvo, a, agora, efeitos);
  return v;
}
function estaLento(e, l, agora) {
  return l.chocadoAte > agora || l.presoAte > agora || l.congeladoAte > agora || l.frio.ate > agora && l.frio.camadas > 0 || e.pocas.some((p) => p.dono !== l.id && Math.hypot(l.x - p.x, l.y - p.y) <= p.r);
}
function curar(l, quanto, efeitos) {
  const antes = l.vida;
  l.vida = Math.min(vidaMaxima(l.personagem), l.vida + Math.round(quanto));
  if (l.vida > antes) efeitos.push({ tipo: "cura", alvo: l.id, valor: l.vida - antes });
}
function morrer(e, alvo, autor, agora, efeitos) {
  alvo.vivo = false;
  alvo.temSupernova = false;
  alvo.supernovaAte = 0;
  alvo.dots = [];
  alvo.fila = [];
  efeitos.push({ tipo: "morte", alvo: alvo.id, ...autor && autor.id !== alvo.id ? { por: autor.id } : {} });
  e.entidades = e.entidades.filter((x) => !(x.tipo === "drone" && x.dono === alvo.id));
  if (autor && autor.id !== alvo.id && autor.vivo) {
    if (autor.personagem === "vampiro") curar(autor, H.sede.cura, efeitos);
    if (autor.personagem === "domador") autor.recargaAtivaAte -= H.companheiro.reducaoSeg * 1e3;
    if (autor.personagem === "astro") autor.recargaAtivaAte = agora;
  }
  if (renasce(e)) {
    if (!alvo.fora) alvo.renascerEm = agora + (MODOS_TROCA.includes(e.modo) ? 3e3 : 2e3);
    if (ehPintao(e.modo)) apagarPintura(e, alvo);
    if (autor && autor.id !== alvo.id && !aliados(autor, alvo) && !ehBandeira(e.modo) && !ehPintao(e.modo)) {
      autor.pontos++;
      if (autor.equipe !== null) {
        e.pontosEquipe[autor.equipe]++;
        if (e.pontosEquipe[autor.equipe] >= e.meta) e.fim = { vencedorId: null, equipe: autor.equipe };
      } else if (autor.pontos >= e.meta) e.fim = { vencedorId: autor.id };
      else if (e.modo === "corrida") transformar(e, autor, proximoPersonagem(autor.personagem), agora);
    }
  }
  if (alvo.personagem === "granadeiro") {
    const f = H.explosaoFinal;
    explosaoEm(e, alvo.x, alvo.y, f.raio, f.dano, f.dano, alvo, PERSONAGENS.granadeiro.cor, agora, efeitos);
  }
  if (!renasce(e)) vencedorSe(e);
  else if (!e.fim) fimPorAbandono(e);
}
var renasce = (e) => e.modo !== "royale" && e.modo !== "neoncalypse";
function fimPorAbandono(e) {
  const ativos = [...e.lutadores.values()].filter((l) => !l.fora);
  if (MODOS_EQUIPE.includes(e.modo)) {
    const equipes = new Set(ativos.map((l) => l.equipe));
    if (equipes.size <= 1) e.fim = { vencedorId: null, ...ativos[0] ? { equipe: ativos[0].equipe } : {} };
  } else if (ativos.length <= 1) e.fim = { vencedorId: ativos[0]?.id ?? null };
}
function trocarPersonagemAoRenascer(e, l, novo) {
  if (!MODOS_TROCA.includes(e.modo) || l.vivo || l.fora) return false;
  transformar(e, l, novo, Date.now());
  return true;
}
function proximoPersonagem(atual) {
  return IDS_PERSONAGENS[(IDS_PERSONAGENS.indexOf(atual) + 1) % IDS_PERSONAGENS.length];
}
function transformar(e, l, novo, agora) {
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
  e.entidades = e.entidades.filter((x) => !((x.tipo === "drone" || x.tipo === "clone") && x.dono === l.id));
}
function renascer(e, l, agora, efeitos) {
  const n = e.mapa.nascimentos[l.vaga % e.mapa.nascimentos.length];
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
    invisivelAte: 0
  });
  efeitos.push({ tipo: "anel", x: n.x, y: n.y, raio: 30, cor: PERSONAGENS[l.personagem].cor, ms: 400 });
}
function danoEmMuro(e, x, y, raio, dano, efeitos) {
  if (!e.muros.length) return;
  for (const m of e.muros) {
    const px = Math.max(m.ret.x, Math.min(x, m.ret.x + m.ret.w));
    const py = Math.max(m.ret.y, Math.min(y, m.ret.y + m.ret.h));
    if (Math.hypot(px - x, py - y) > raio + 2) continue;
    m.vida -= dano;
    if (m.vida <= 0) efeitos.push({ tipo: "explosao", x: m.ret.x + m.ret.w / 2, y: m.ret.y + m.ret.h / 2, raio: Math.max(m.ret.w, m.ret.h) / 2, cor: "#8a97b0" });
  }
  e.muros = e.muros.filter((m) => m.vida > 0);
}
function atualizarParedes(e, agora) {
  const t = Math.max(0, (agora - e.inicio) / 1e3);
  const fechadas = e.mapa.dinamicas.filter((d) => (t + d.fase) % d.periodo < d.fechado).map((d) => d.ret);
  const doEngenheiro = e.entidades.filter((x) => x.tipo === "parede").map((x) => x.ret);
  e.mapa.paredesTemp = [...doEngenheiro, ...fechadas, ...e.muros.map((m) => m.ret)];
}
function explosaoEm(e, x, y, raio, danoCentro, danoBorda, autor, cor, agora, efeitos, mult = 1) {
  efeitos.push({ tipo: "explosao", x, y, raio, cor });
  danoEmMuro(e, x, y, raio, danoCentro * mult, efeitos);
  for (const o of e.lutadores.values()) {
    if (o.id === autor?.id || !o.vivo || aliados(o, autor)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d > raio + R2 || !linhaLivre(e.mapa, x, y, o.x, o.y)) continue;
    const f = Math.min(1, Math.max(0, (d - R2) / raio));
    aplicarDano(e, o, (danoCentro + (danoBorda - danoCentro) * f) * mult, agora, efeitos, { x, y }, { autor, tipo: "area" });
  }
}
function aplicarDot(alvo, tipo, q, de, agora) {
  if (alvo.personagem === "veneno") return;
  alvo.dots = alvo.dots.filter((d) => d.tipo !== tipo);
  alvo.dots.push({ tipo, dano: q.dano, tiques: q.tiques, proximo: agora + CONFIG.queimadura.segIntervalo * 1e3, de });
}
function aplicarFrio(alvo, camadas, agora) {
  const f = alvo.frio.ate > agora ? alvo.frio.camadas : 0;
  alvo.frio = { camadas: Math.min(H.frio.maxCamadas, f + camadas), ate: agora + H.frio.segDuracao * 1e3 };
}
function reacaoCorpo(e, alvo, atacante, agora, efeitos) {
  if (!atacante.vivo) return;
  if (alvo.personagem === "gelo") aplicarFrio(atacante, H.peleFria.camadas, agora);
}
function normalizar(dx, dy, padrao) {
  const m = Math.hypot(dx, dy);
  return m > 0.1 ? { x: dx / m, y: dy / m } : padrao;
}
function inimigos(e, l) {
  return [...e.lutadores.values()].filter((o) => o.id !== l.id && o.vivo && !aliados(o, l));
}
function novoProjetil(e, dono, dir, base) {
  const pr = {
    id: e.proximoProjetil++,
    dono: dono.id,
    x: dono.x + dir.x * (R2 + 4),
    y: dono.y + dir.y * (R2 + 4),
    dx: dir.x,
    dy: dir.y,
    restante: base.alcance,
    mult: 1,
    inicio: 0,
    preparada: false,
    tinta: false,
    agua: false,
    atravessa: false,
    atingidos: /* @__PURE__ */ new Set(),
    bumerangue: null,
    arco: null,
    explosao: null,
    ...base
  };
  e.projeteis.push(pr);
  return pr;
}
function atacar(e, l, dx, dy, agora, efeitos, carga = 0) {
  if (e.fim || !l.vivo || !comecou(e, agora) || agora < l.recargaAtaqueAte || l.congeladoAte > agora) return false;
  if (l.areaDesde !== null) l.areaSuspensa = true;
  const p = PERSONAGENS[l.personagem];
  const dir = normalizar(dx, dy, l.mira);
  l.mira = dir;
  const prontoDesde = l.recargaAtaqueAte;
  l.recargaAtaqueAte = agora + p.arma.recarga * 1e3 * fatorRecargaAtaque(l, agora) * (neon(e) ? NEON.recarga : 1) * fatorSupernova(e, l, agora);
  l.reveladoAte = agora + MOITA.segRevelado * 1e3;
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
  if (p.arma.tipo === "projetil") {
    const a = p.arma;
    let alcance = a.alcance;
    if (a.carga) {
      const permitido = Math.min(1, Math.max(0, (agora - prontoDesde) / (a.carga.seg * 1e3)));
      const c = Math.min(Math.max(0, carga), permitido);
      mult *= 1 + a.carga.bonus * c;
      alcance *= 1 + a.carga.bonusAlcance * c;
    }
    if (l.personagem === "atirador" && agora - l.ultimoMovimento >= H.paciencia.segParado * 1e3) mult *= 1 + H.paciencia.bonus;
    const n = a.projeteis ?? 1;
    const abre = (a.leque ?? 0) * Math.PI / 180;
    const ang0 = Math.atan2(dir.y, dir.x);
    for (let k = 0; k < n; k++) {
      const ang = ang0 + (k - (n - 1) / 2) * abre;
      const d = { x: Math.cos(ang), y: Math.sin(ang) };
      novoProjetil(e, l, d, {
        dano: a.dano,
        vel: a.velocidadeProjetil ?? 500,
        alcance,
        estilo: a.estilo ?? "bala",
        mult,
        preparada: l.preparada,
        tinta: !!a.tinta,
        agua: !!a.agua,
        atravessa: !!a.atravessa || l.personagem === "atirador" && l.laserAte > agora,
        bumerangue: a.bumerangue ? { voltando: false, atingidosVolta: /* @__PURE__ */ new Set() } : null,
        arco: a.arco ? { x0: l.x, y0: l.y, total: alcance } : null,
        explosao: a.explosao ? { ...a.explosao } : null,
        veneno: a.veneno,
        frio: a.frio,
        rouboVida: a.rouboVida,
        ricochetes: a.ricochete,
        prende: a.prende,
        ...l.marcaAlvo && l.marcaAlvo.ate > agora && e.lutadores.get(l.marcaAlvo.id)?.vivo ? { guiado: l.marcaAlvo.id, mult: mult * H.guiado.fatorDano } : {}
      });
      if (a.arco) {
        const pr = e.projeteis[e.projeteis.length - 1];
        pr.x = l.x;
        pr.y = l.y;
      }
    }
    l.preparada = false;
    efeitos.push({ tipo: "disparo", de: l.id, x: l.x, y: l.y });
    return true;
  }
  if (p.arma.tipo === "aura") {
    const raioAura = p.arma.alcance + R2;
    efeitos.push({ tipo: "pulso", de: l.id, x: l.x, y: l.y, raio: raioAura });
    for (const o of inimigos(e, l)) {
      if (Math.hypot(o.x - l.x, o.y - l.y) > raioAura || !linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
      const feito = aplicarDano(e, o, p.arma.dano * mult, agora, efeitos, l, { autor: l, tipo: "area" });
      if (feito > 0) o.chocadoAte = agora + H.choque.segDuracao * 1e3;
    }
    return true;
  }
  const raio = p.arma.alcance + R2;
  const cosArco = Math.cos((p.arma.arcoGraus ?? 60) * Math.PI / 180);
  efeitos.push({ tipo: "golpe", de: l.id, x: l.x, y: l.y, dx: dir.x, dy: dir.y, raio, arco: p.arma.arcoGraus ?? 60 });
  for (const o of inimigos(e, l)) {
    const vx = o.x - l.x;
    const vy = o.y - l.y;
    const d = Math.hypot(vx, vy);
    if (d > raio) continue;
    if (d > R2 * 2 && (vx * dir.x + vy * dir.y) / d < cosArco) continue;
    if (!linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
    const feito = aplicarDano(e, o, p.arma.dano * mult, agora, efeitos, l, { autor: l, tipo: "corpo" });
    if (feito > 0 && p.arma.queimadura) aplicarDot(o, "fogo", p.arma.queimadura, l.id, agora);
    if (feito > 0) reacaoCorpo(e, o, l, agora, efeitos);
  }
  e.entidades = e.entidades.filter((x) => !(x.tipo === "clone" && x.dono !== l.id && Math.hypot(x.x - l.x, x.y - l.y) <= raio));
  return true;
}
function fatorSupernova(e, l, agora) {
  return l.supernovaAte > agora ? neon(e) ? SUPERNOVA.recargaNeon : SUPERNOVA.recarga : 1;
}
function ativarSupernova(e, l, agora, efeitos) {
  if (!l.vivo || !l.temSupernova || e.fim) return false;
  l.temSupernova = false;
  l.supernovaAte = agora + SUPERNOVA.segDuracao * 1e3;
  efeitos.push({ tipo: "supernova", acao: "ativou", x: l.x, y: l.y, de: l.id });
  return true;
}
function lugarSupernova(e) {
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
function fatorRecargaAtaque(l, agora) {
  let f = 1;
  if (l.furiaAte > agora) f *= H.furia.fatorRecarga;
  if (l.cancaoAte > agora) f /= H.cancao.fator;
  if (l.sobrecargaAte > agora) f *= H.sobrecarga.fatorRecarga;
  return f;
}
function feixe(e, l, dir, alcance, dano, agora, efeitos) {
  let x = l.x;
  let y = l.y;
  for (let d = R2; d <= alcance; d += 4) {
    const nx = l.x + dir.x * d;
    const ny = l.y + dir.y * d;
    if (bloqueiaTiro(e.mapa, nx, ny)) break;
    x = nx;
    y = ny;
    const clone = e.entidades.find((c) => c.tipo === "clone" && c.dono !== l.id && Math.hypot(c.x - nx, c.y - ny) <= R2 + 10);
    if (clone) {
      e.entidades = e.entidades.filter((c) => c !== clone);
      break;
    }
    const alvo = [...e.lutadores.values()].find((o) => o.id !== l.id && o.vivo && !aliados(o, l) && Math.hypot(o.x - nx, o.y - ny) <= R2 + 10);
    if (alvo) {
      l.foco = l.foco?.alvo === alvo.id ? { alvo: alvo.id, n: Math.min(H.foco.maximo, l.foco.n + 1) } : { alvo: alvo.id, n: 0 };
      aplicarDano(e, alvo, dano + l.foco.n, agora, efeitos, l, { autor: l, tipo: "projetil" });
      break;
    }
  }
  efeitos.push({ tipo: "linha", x0: l.x, y0: l.y, x1: x, y1: y, cor: PERSONAGENS[l.personagem].cor, largura: 8 });
}
function avancar(e, l, dir, dist, largura, agora, efeitos, aoAcertar) {
  const x0 = l.x;
  const y0 = l.y;
  const fim = mover(e.mapa, l.x, l.y, dir.x * dist, dir.y * dist, passagemDe(l.personagem, false));
  l.x = fim.x;
  l.y = fim.y;
  efeitos.push({ tipo: "linha", x0, y0, x1: fim.x, y1: fim.y, cor: PERSONAGENS[l.personagem].cor });
  const vx = fim.x - x0;
  const vy = fim.y - y0;
  const len2 = vx * vx + vy * vy || 1;
  for (const o of inimigos(e, l)) {
    const t = Math.max(0, Math.min(1, ((o.x - x0) * vx + (o.y - y0) * vy) / len2));
    if (Math.hypot(o.x - (x0 + vx * t), o.y - (y0 + vy * t)) <= largura) aoAcertar(o);
  }
}
function usarAtiva(e, l, dx, dy, agora, efeitos) {
  if (e.fim || !l.vivo || !comecou(e, agora) || agora < l.recargaAtivaAte) return false;
  if (l.silenciadoAte > agora || l.congeladoAte > agora) return false;
  const p = PERSONAGENS[l.personagem];
  const dir = normalizar(dx, dy, l.mira);
  l.recargaAtivaAte = agora + p.ativa.recarga * 1e3 * (neon(e) ? NEON.recarga : 1) * fatorSupernova(e, l, agora);
  const cor = p.cor;
  const ataque = () => {
    if (l.areaDesde !== null) l.areaSuspensa = true;
  };
  const pontoAFrente = (dist) => ({ x: Math.min(e.mapa.largura - 24, Math.max(24, l.x + dir.x * dist)), y: Math.min(e.mapa.altura - 24, Math.max(24, l.y + dir.y * dist)) });
  switch (l.personagem) {
    case "veni": {
      const t = H.teletransporte;
      const destino = destinoFuga(e.mapa, l.x, l.y, inimigos(e, l), t.minimo, t.maximo, dir.x, dir.y);
      efeitos.push({ tipo: "teleporte", de: l.id, x0: l.x, y0: l.y, x1: destino.x, y1: destino.y });
      l.x = destino.x;
      l.y = destino.y;
      l.preparada = true;
      return true;
    }
    case "gut": {
      ataque();
      const g = H.giro;
      efeitos.push({ tipo: "giro", de: l.id, x: l.x, y: l.y, raio: g.raio + R2 });
      for (const o of inimigos(e, l)) {
        const vx = o.x - l.x;
        const vy = o.y - l.y;
        const d = Math.hypot(vx, vy);
        if (d > g.raio + R2 || !linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
        const feito = aplicarDano(e, o, g.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: "corpo" });
        if (feito > 0) reacaoCorpo(e, o, l, agora, efeitos);
        if (feito <= 0 || !o.vivo) continue;
        aplicarDot(o, "fogo", g.queimadura, l.id, agora);
        const n = d > 0.01 ? { x: vx / d, y: vy / d } : dir;
        deslocar(e, o, n.x * g.empurrao, n.y * g.empurrao, agora);
      }
      return true;
    }
    case "vini": {
      ataque();
      const b = H.balde;
      criarPoca(e, l.id, l.x, l.y, b.raio, b.segDuracao, true, agora);
      efeitos.push({ tipo: "balde", de: l.id, x: l.x, y: l.y, raio: b.raio });
      for (const o of inimigos(e, l)) {
        const vx = o.x - l.x;
        const vy = o.y - l.y;
        const d = Math.hypot(vx, vy);
        if (d > b.raio + R2 || d < 0.01) continue;
        deslocar(e, o, vx / d * b.empurrao, vy / d * b.empurrao, agora);
      }
      return true;
    }
    case "daniel":
      l.mira = dir;
      l.escudoAte = agora + H.escudo.segDuracao * 1e3;
      return true;
    case "lucas": {
      ataque();
      const o = H.onda;
      e.ondas.push({ dono: l.id, x: l.x, y: l.y, inicio: agora, atingidos: /* @__PURE__ */ new Set() });
      efeitos.push({ tipo: "onda", de: l.id, x: l.x, y: l.y, raio: o.raioMax, ms: o.segExpansao * 1e3 });
      avancarOndas(e, agora, efeitos);
      return true;
    }
    case "pacheco":
      l.voandoAte = agora + H.voo.segDuracao * 1e3;
      efeitos.push({ tipo: "voo", de: l.id, x: l.x, y: l.y, pouso: false });
      return true;
    case "sombra":
      l.invisivelAte = agora + H.invisivel.segDuracao * 1e3;
      l.emboscada = true;
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: 30, cor, ms: 300 });
      return true;
    case "vampiro": {
      const t = H.totem;
      e.entidades.push({ tipo: "totem", id: e.proximaEntidade++, dono: l.id, x: l.x, y: l.y, r: t.raio, ate: agora + t.segDuracao * 1e3, proximo: agora });
      return true;
    }
    case "engenheiro": {
      const pa = H.parede;
      const c = pontoAFrente(pa.distancia);
      const vertical = Math.abs(dir.x) >= Math.abs(dir.y);
      const w = vertical ? pa.espessura : pa.comprimento;
      const h = vertical ? pa.comprimento : pa.espessura;
      const ret = { x: c.x - w / 2, y: c.y - h / 2, w, h, tipo: 1 };
      e.mapa.paredesTemp.push(ret);
      e.entidades.push({ tipo: "parede", id: e.proximaEntidade++, dono: l.id, ret, ate: agora + pa.segDuracao * 1e3 });
      return true;
    }
    case "pescador": {
      ataque();
      const g = H.gancho;
      novoProjetil(e, l, dir, { dano: g.dano, vel: g.velocidade, alcance: g.alcance, estilo: "gancho", gancho: true, mult: multForca(l, agora) });
      return true;
    }
    case "gravidade": {
      ataque();
      const b = H.buraco;
      const c = pontoAFrente(b.distancia);
      e.entidades.push({ tipo: "buraco", id: e.proximaEntidade++, dono: l.id, x: c.x, y: c.y, r: b.raio, ate: agora + b.segDuracao * 1e3, proximo: agora + 1e3 });
      return true;
    }
    case "ilusionista": {
      const a0 = Math.atan2(dir.y, dir.x);
      for (let k = 0; k < H.clone.quantidade; k++) {
        const a = a0 + k / H.clone.quantidade * Math.PI * 2;
        e.entidades.push({ tipo: "clone", id: e.proximaEntidade++, dono: l.id, personagem: l.personagem, x: l.x, y: l.y, dx: Math.cos(a), dy: Math.sin(a), ate: agora + H.clone.segDuracao * 1e3, parado: false });
      }
      return true;
    }
    case "atirador":
      l.corridaAte = agora + H.corrida.segDuracao * 1e3;
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: 26, cor, ms: 250 });
      return true;
    case "granadeiro": {
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
          vel: PERSONAGENS.granadeiro.arma.velocidadeProjetil,
          alcance: d,
          estilo: "granada",
          mult: multForca(l, agora),
          arco: { x0: l.x, y0: l.y, total: d },
          explosao: { raio: c.raio, danoBorda: c.dano / 2 },
          inicio: agora + k * c.intervalo * 1e3
        });
        pr.x = l.x;
        pr.y = l.y;
      }
      return true;
    }
    case "armadilheiro": {
      const minhas = e.entidades.filter((x) => x.tipo === "mina" && x.dono === l.id);
      if (minhas.length >= H.mina.maximo) e.entidades = e.entidades.filter((x) => x !== minhas[0]);
      e.entidades.push({ tipo: "mina", id: e.proximaEntidade++, dono: l.id, x: l.x, y: l.y, armadaEm: agora + 500 });
      return true;
    }
    case "gelo": {
      ataque();
      const g = H.congelar;
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: g.raio, cor, ms: 350 });
      for (const o of inimigos(e, l)) {
        if (Math.hypot(o.x - l.x, o.y - l.y) > g.raio + R2 || !linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) continue;
        const feito = aplicarDano(e, o, g.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: "area" });
        if (feito > 0) o.congeladoAte = agora + g.segDuracao * 1e3;
      }
      return true;
    }
    case "veneno": {
      ataque();
      const n = H.nuvem;
      const c = pontoAFrente(n.distancia);
      e.entidades.push({ tipo: "nuvem", id: e.proximaEntidade++, dono: l.id, x: c.x, y: c.y, r: n.raio, ate: agora + n.segDuracao * 1e3, proximo: agora + 1e3 });
      return true;
    }
    case "hacker": {
      ataque();
      const pn = H.pane;
      novoProjetil(e, l, dir, { dano: pn.dano, vel: pn.velocidade, alcance: pn.alcance, estilo: "pulso", pane: true, mult: multForca(l, agora) });
      return true;
    }
    case "relojoeiro": {
      const alvoT = agora - H.rebobinar.segAtras * 1e3;
      const antigo = l.historico.find((h) => h.t >= alvoT) ?? l.historico[0];
      if (!antigo) return true;
      const p0 = pontoLivrePerto(e.mapa, antigo.x, antigo.y, passagemDe(l.personagem, false));
      efeitos.push({ tipo: "linha", x0: l.x, y0: l.y, x1: p0.x, y1: p0.y, cor });
      l.x = p0.x;
      l.y = p0.y;
      l.vida = Math.max(l.vida, antigo.vida);
      l.dots = [];
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: H.eco.raio, cor, ms: 300 });
      for (const o of inimigos(e, l)) {
        if (Math.hypot(o.x - l.x, o.y - l.y) <= H.eco.raio + R2 && linhaLivre(e.mapa, l.x, l.y, o.x, o.y)) {
          aplicarDano(e, o, H.eco.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: "area" });
        }
      }
      return true;
    }
    case "berserker":
      l.furiaAte = agora + H.furia.segDuracao * 1e3;
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: 34, cor, ms: 300 });
      return true;
    case "domador": {
      e.entidades = e.entidades.filter((x) => !(x.tipo === "drone" && x.dono === l.id));
      e.entidades.push({ tipo: "drone", id: e.proximaEntidade++, dono: l.id, x: l.x, y: l.y - H.drone.distancia, ate: agora + H.drone.segDuracao * 1e3, proximoTiro: agora + 300 });
      return true;
    }
    case "espelho":
      l.refletindoAte = agora + H.reflexo.segDuracao * 1e3;
      return true;
    case "ninja":
      avancar(e, l, dir, H.avanco.distancia, H.avanco.largura, agora, efeitos, (o) => {
        const feito = aplicarDano(e, o, H.avanco.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: "corpo" });
        if (feito > 0) reacaoCorpo(e, o, l, agora, efeitos);
      });
      ataque();
      return true;
    case "tanque":
      ataque();
      avancar(e, l, dir, H.investida.distancia, H.investida.largura, agora, efeitos, (o) => {
        const feito = aplicarDano(e, o, H.investida.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: "corpo" });
        if (feito > 0 && o.vivo) deslocar(e, o, dir.x * H.investida.empurrao, dir.y * H.investida.empurrao, agora);
      });
      return true;
    case "medico":
      curar(l, H.kit.cura, efeitos);
      l.dots = [];
      l.frio = { camadas: 0, ate: 0 };
      l.chocadoAte = 0;
      l.presoAte = 0;
      l.congeladoAte = 0;
      l.silenciadoAte = 0;
      l.marcadoAte = 0;
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: 30, cor, ms: 350 });
      return true;
    case "cacador": {
      ataque();
      const mc = H.marca;
      novoProjetil(e, l, dir, { dano: mc.dano, vel: mc.velocidade, alcance: mc.alcance, estilo: "boleadeira", marca: true, mult: multForca(l, agora) });
      return true;
    }
    case "laserista":
      l.sobrecargaAte = agora + H.sobrecarga.segDuracao * 1e3;
      return true;
    case "trocador": {
      const tr = H.troca;
      const alvo = inimigos(e, l).filter((o) => visivelPara(e, o, l, agora) && Math.hypot(o.x - l.x, o.y - l.y) <= tr.alcance).sort((a, b) => Math.hypot(a.x - l.x, a.y - l.y) - Math.hypot(b.x - l.x, b.y - l.y))[0];
      if (!alvo) {
        l.recargaAtivaAte = 0;
        return false;
      }
      ataque();
      efeitos.push({ tipo: "linha", x0: l.x, y0: l.y, x1: alvo.x, y1: alvo.y, cor });
      const feito = aplicarDano(e, alvo, tr.dano * multForca(l, agora), agora, efeitos, l, { autor: l, tipo: "area" });
      if (feito > 0 && alvo.vivo && alvo.personagem !== "gravidade") {
        const [px, py] = [l.x, l.y];
        l.x = alvo.x;
        l.y = alvo.y;
        alvo.x = px;
        alvo.y = py;
        alvo.chocadoAte = agora + tr.segDesorientado * 1e3;
      }
      return true;
    }
    case "bardo":
      l.cancaoAte = agora + H.cancao.segDuracao * 1e3;
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: 34, cor, ms: 300 });
      return true;
    case "astro": {
      ataque();
      const mt = H.meteoro;
      const c = pontoAFrente(mt.distancia);
      e.entidades.push({ tipo: "meteoro", id: e.proximaEntidade++, dono: l.id, x: c.x, y: c.y, r: mt.raio, ate: agora + mt.segAviso * 1e3 });
      return true;
    }
  }
  return false;
}
function criarPoca(e, dono, x, y, r, seg, balde, agora) {
  e.pocas.push({ id: e.proximaPoca++, dono, x, y, r, ate: agora + seg * 1e3, balde });
  if (!balde) {
    const doCanhao = e.pocas.filter((p) => p.dono === dono && !p.balde);
    if (doCanhao.length > H.tinta.maxPocas) e.pocas = e.pocas.filter((p) => p !== doCanhao[0]);
  }
}
function avancarOndas(e, agora, efeitos) {
  const o = H.onda;
  const vivas = [];
  for (const w of e.ondas) {
    const raio = Math.min(o.raioMax, o.raioMax * (agora - w.inicio) / (o.segExpansao * 1e3));
    const dono = e.lutadores.get(w.dono);
    for (const alvo of e.lutadores.values()) {
      if (alvo.id === w.dono || !alvo.vivo || w.atingidos.has(alvo.id) || aliados(alvo, dono)) continue;
      const vx = alvo.x - w.x;
      const vy = alvo.y - w.y;
      const d = Math.hypot(vx, vy);
      if (d > raio + R2 || !linhaLivre(e.mapa, w.x, w.y, alvo.x, alvo.y)) continue;
      w.atingidos.add(alvo.id);
      const feito = aplicarDano(e, alvo, o.dano * multForca(dono, agora), agora, efeitos, { x: w.x, y: w.y }, { autor: dono, tipo: "area" });
      if (feito <= 0 || !alvo.vivo) continue;
      const n = d > 0.01 ? { x: vx / d, y: vy / d } : { x: 1, y: 0 };
      deslocar(e, alvo, n.x * o.empurrao, n.y * o.empurrao, agora);
    }
    if (raio < o.raioMax) vivas.push(w);
  }
  e.ondas = vivas;
}
function acertoDireto(e, pr, alvo, agora, efeitos) {
  const dono = e.lutadores.get(pr.dono);
  const origem = { x: pr.x - pr.dx * 20, y: pr.y - pr.dy * 20 };
  let mult = pr.mult;
  if (dono?.personagem === "bardo" && pr.estilo === "nota") {
    dono.refrao++;
    if (dono.refrao % H.refrao.cada === 0) mult *= 2;
  }
  const feito = aplicarDano(e, alvo, pr.dano * mult, agora, efeitos, origem, { autor: dono, tipo: "projetil", rouboVida: pr.rouboVida });
  if (feito <= 0) return;
  if (pr.prende) alvo.presoAte = agora + pr.prende * 1e3;
  if (pr.marca) {
    alvo.marcadoAte = agora + H.marca.segDuracao * 1e3;
    if (dono) dono.marcaAlvo = { id: alvo.id, ate: alvo.marcadoAte };
  }
  if (pr.troca && dono && dono.vivo && alvo.vivo && alvo.personagem !== "gravidade") {
    const px = dono.x;
    const py = dono.y;
    efeitos.push({ tipo: "linha", x0: px, y0: py, x1: alvo.x, y1: alvo.y, cor: PERSONAGENS.trocador.cor });
    dono.x = alvo.x;
    dono.y = alvo.y;
    alvo.x = px;
    alvo.y = py;
    alvo.chocadoAte = agora + H.troca.segDesorientado * 1e3;
  }
  if (pr.veneno) aplicarDot(alvo, "veneno", pr.veneno, pr.dono, agora);
  if (pr.frio) aplicarFrio(alvo, 1, agora);
}
function impacto(e, pr, x, y, alvo, agora, efeitos) {
  const dono = e.lutadores.get(pr.dono);
  if (e.pintura && dono) pintar(e, dono, x, y, pr.explosao ? Math.max(PINTAO.raioImpacto, pr.explosao.raio) : PINTAO.raioImpacto);
  if (pr.explosao) {
    const fp = H.flechaPreparada;
    const raio = pr.explosao.raio * (pr.preparada ? 1 + fp.bonusRaio : 1);
    const mult = pr.mult * (pr.preparada ? 1 + fp.bonusDano : 1);
    explosaoEm(e, x, y, raio, pr.dano, pr.explosao.danoBorda, dono, dono ? PERSONAGENS[dono.personagem].cor : "#ffffff", agora, efeitos, mult);
    return;
  }
  if (pr.tinta) {
    if (alvo) acertoDireto(e, pr, alvo, agora, efeitos);
    const t = H.tinta;
    criarPoca(e, pr.dono, x, y, t.raio, t.segDuracao, false, agora);
    efeitos.push({ tipo: "respingo", x, y, raio: t.raio });
    return;
  }
  if (!alvo) return;
  if (pr.gancho) {
    acertoDireto(e, pr, alvo, agora, efeitos);
    if (dono && alvo.vivo) {
      const vx = dono.x - alvo.x;
      const vy = dono.y - alvo.y;
      const d = Math.hypot(vx, vy);
      const puxar = d - H.gancho.distanciaFinal;
      efeitos.push({ tipo: "linha", x0: dono.x, y0: dono.y, x1: alvo.x, y1: alvo.y, cor: PERSONAGENS.pescador.cor });
      if (puxar > 0) deslocar(e, alvo, vx / d * puxar, vy / d * puxar, agora);
    }
    return;
  }
  if (pr.pane) {
    acertoDireto(e, pr, alvo, agora, efeitos);
    alvo.silenciadoAte = agora + H.pane.segDuracao * 1e3;
    return;
  }
  acertoDireto(e, pr, alvo, agora, efeitos);
}
function avancarProjeteis(e, dt, agora, efeitos) {
  const vivos = [];
  for (const pr of e.projeteis) {
    if (pr.inicio > agora) {
      vivos.push(pr);
      continue;
    }
    let dist = pr.vel * dt;
    let ativo = true;
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
      if (pr.guiado) {
        const g = e.lutadores.get(pr.guiado);
        if (g?.vivo) {
          const vx = g.x - pr.x;
          const vy = g.y - pr.y;
          const d = Math.hypot(vx, vy) || 1;
          const k = Math.min(1, H.guiado.giroPorSeg * passo / pr.vel);
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
      const escudo = [...e.lutadores.values()].find(
        (o) => o.id !== pr.dono && o.vivo && !aliados(o, dono) && Math.hypot(o.x - nx, o.y - ny) <= H.escudo.raio && escudoCobre(o, nx, ny, agora)
      );
      if (escudo) {
        efeitos.push({ tipo: "defesa", alvo: escudo.id, x: nx, y: ny });
        ativo = false;
        break;
      }
      const espelho = [...e.lutadores.values()].find(
        (o) => o.id !== pr.dono && o.vivo && !aliados(o, dono) && o.refletindoAte > agora && Math.hypot(o.x - nx, o.y - ny) <= R2 + 4
      );
      if (espelho && !pr.gancho) {
        pr.dono = espelho.id;
        pr.dx = -pr.dx;
        pr.dy = -pr.dy;
        pr.restante = pr.alcance;
        pr.atingidos = /* @__PURE__ */ new Set();
        pr.bumerangue = null;
        efeitos.push({ tipo: "anel", x: nx, y: ny, raio: 16, cor: PERSONAGENS.espelho.cor, ms: 200 });
        dist -= passo;
        continue;
      }
      const clone = e.entidades.find((x) => x.tipo === "clone" && x.dono !== pr.dono && !aliados(e.lutadores.get(x.dono), dono) && Math.hypot(x.x - nx, x.y - ny) <= R2 + 3);
      if (clone) {
        e.entidades = e.entidades.filter((x) => x !== clone);
        efeitos.push({ tipo: "anel", x: nx, y: ny, raio: 18, cor: "#c9d2e0", ms: 220 });
        ativo = false;
        break;
      }
      pr.x = nx;
      pr.y = ny;
      pr.restante -= passo;
      dist -= passo;
      const jaAcertados = pr.bumerangue?.voltando ? pr.bumerangue.atingidosVolta : pr.atingidos;
      const podeAcertar = (o) => o.id !== pr.dono && o.vivo && !aliados(o, dono) && !jaAcertados.has(o.id) && Math.hypot(o.x - nx, o.y - ny) <= R2 + 3;
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
function avancarEntidades(e, dt, agora, efeitos) {
  const ficam = [];
  for (const x of e.entidades) {
    const dono = e.lutadores.get(x.dono);
    if (x.tipo !== "mina" && "ate" in x && x.ate <= agora) {
      if (x.tipo === "parede") e.mapa.paredesTemp = e.mapa.paredesTemp.filter((p) => p !== x.ret);
      if (x.tipo === "meteoro") {
        const mt = H.meteoro;
        explosaoEm(e, x.x, x.y, mt.raio, mt.dano, mt.danoBorda, dono, PERSONAGENS.astro.cor, agora, efeitos, multForca(dono, agora));
      }
      continue;
    }
    switch (x.tipo) {
      case "mina": {
        if (agora < x.armadaEm) break;
        const vitima = [...e.lutadores.values()].find((o) => o.id !== x.dono && o.vivo && !aliados(o, dono) && o.voandoAte <= agora && Math.hypot(o.x - x.x, o.y - x.y) <= H.mina.raioGatilho + R2);
        if (vitima) {
          efeitos.push({ tipo: "anel", x: x.x, y: x.y, raio: 30, cor: PERSONAGENS.armadilheiro.cor, ms: 300 });
          aplicarDano(e, vitima, H.mina.dano * multForca(dono, agora), agora, efeitos, { x: x.x, y: x.y }, { autor: dono, tipo: "area" });
          vitima.presoAte = agora + H.mina.segPreso * 1e3;
          continue;
        }
        break;
      }
      case "drone": {
        if (!dono || !dono.vivo) continue;
        const ang = agora / 400;
        x.x = dono.x + Math.cos(ang) * H.drone.distancia;
        x.y = dono.y + Math.sin(ang) * H.drone.distancia;
        if (agora >= x.proximoTiro) {
          const alvo = inimigos(e, dono).filter((o) => visivelPara(e, o, dono, agora) && Math.hypot(o.x - x.x, o.y - x.y) <= H.drone.alcance && linhaLivre(e.mapa, x.x, x.y, o.x, o.y)).sort((a, b) => Math.hypot(a.x - x.x, a.y - x.y) - Math.hypot(b.x - x.x, b.y - x.y))[0];
          if (alvo) {
            const d = Math.hypot(alvo.x - x.x, alvo.y - x.y) || 1;
            const pr = novoProjetil(e, dono, { x: (alvo.x - x.x) / d, y: (alvo.y - x.y) / d }, {
              dano: H.drone.dano,
              vel: H.drone.velocidade,
              alcance: H.drone.alcance + 20,
              estilo: "bala",
              mult: multForca(dono, agora),
              drone: true
            });
            pr.x = x.x;
            pr.y = x.y;
            x.proximoTiro = agora + H.drone.intervalo * 1e3;
          }
        }
        break;
      }
      case "clone": {
        if (!x.parado) {
          const p = PERSONAGENS[x.personagem];
          const v = CONFIG.movimento.velocidadeBase * p.velocidade * dt;
          const novo = mover(e.mapa, x.x, x.y, x.dx * v, x.dy * v);
          x.x = novo.x;
          x.y = novo.y;
        }
        break;
      }
      case "totem":
        if (agora >= x.proximo) {
          x.proximo = agora + 1e3;
          if (dono?.vivo && Math.hypot(dono.x - x.x, dono.y - x.y) <= x.r) curar(dono, H.totem.curaPorSeg, efeitos);
        }
        break;
      case "nuvem":
        if (agora >= x.proximo) {
          x.proximo = agora + 1e3;
          for (const o of e.lutadores.values()) {
            if (o.id === x.dono || !o.vivo || aliados(o, dono) || Math.hypot(o.x - x.x, o.y - x.y) > x.r + R2) continue;
            aplicarDano(e, o, H.nuvem.danoPorSeg, agora, efeitos, void 0, { autor: dono, tipo: "area" });
          }
        }
        break;
      case "buraco": {
        const b = H.buraco;
        for (const o of e.lutadores.values()) {
          if (o.id === x.dono || !o.vivo || aliados(o, dono)) continue;
          const vx = x.x - o.x;
          const vy = x.y - o.y;
          const d = Math.hypot(vx, vy);
          if (d > x.r || d < 4) continue;
          const passo = Math.min(d - 4, b.puxaoPorSeg * dt);
          deslocar(e, o, vx / d * passo, vy / d * passo, agora);
        }
        if (agora >= x.proximo) {
          x.proximo = agora + 1e3;
          for (const o of e.lutadores.values()) {
            if (o.id === x.dono || !o.vivo || aliados(o, dono) || Math.hypot(o.x - x.x, o.y - x.y) > x.r) continue;
            aplicarDano(e, o, b.danoPorSeg, agora, efeitos, { x: x.x, y: x.y }, { autor: dono, tipo: "area" });
          }
        }
        break;
      }
      case "parede":
      case "meteoro":
        break;
    }
    ficam.push(x);
  }
  e.entidades = ficam;
}
function tick(e, agora, efeitos) {
  const dt = Math.min(0.1, Math.max(0, (agora - e.ultimoTick) / 1e3));
  e.ultimoTick = agora;
  if (e.fim) return;
  const jogando = comecou(e, agora);
  if (e.mapa.dinamicas.length || e.muros.length || e.mapa.paredesTemp.length) atualizarParedes(e, agora);
  for (const l of e.lutadores.values()) {
    if (!l.vivo) {
      if (renasce(e) && !l.fora && l.renascerEm && agora >= l.renascerEm) renascer(e, l, agora, efeitos);
      continue;
    }
    if (neon(e) && jogando && agora >= e.proximoDanoZona && Math.hypot(l.x - e.mapa.largura / 2, l.y - e.mapa.altura / 2) > raioZona(e, agora)) {
      const etapa = Math.floor(Math.max(0, (agora - e.inicio) / 1e3 - CONFIG.partida.segContagem) / 30);
      aplicarDano(e, l, 3 + 2 * etapa, agora, efeitos, void 0, { tipo: "area" });
      if (e.fim) return;
      if (!l.vivo) continue;
    }
    let n = 0;
    while (l.fila.length && n < CONFIG.movimento.maxComandosPorTick) {
      const c = l.fila.shift();
      n++;
      l.seq = c.seq;
      if (!jogando || l.salto) continue;
      const extra = (neon(e) ? NEON.movimento : 1) * (l.supernovaAte > agora ? SUPERNOVA.movimento : 1) * (l.corridaAte > agora ? H.corrida.fator : 1);
      const novo = aplicarComando(e.mapa, l, c, e.pocas, agora, extra, l.equipe !== null ? idsAliados(e, l) : void 0);
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
    if (l.salto) {
      const s = l.salto;
      const f = Math.min(1, (agora - s.inicio) / s.dur);
      l.x = s.x0 + (s.x1 - s.x0) * f;
      l.y = s.y0 + (s.y1 - s.y0) * f;
      if (f >= 1) l.salto = null;
    } else if (jogando) {
      const tr = e.mapa.trampolins.find((p) => Math.hypot(p.x - l.x, p.y - l.y) <= SALTO.raio);
      if (tr && agora >= l.portalPronto) {
        l.salto = { x0: l.x, y0: l.y, x1: tr.destino.x, y1: tr.destino.y, inicio: agora, dur: SALTO.segDuracao * 1e3 };
        l.voandoAte = agora + SALTO.segDuracao * 1e3 + 30;
        l.portalPronto = agora + SALTO.segDuracao * 1e3 + 600;
        l.vx = 0;
        l.vy = 0;
        efeitos.push({ tipo: "voo", de: l.id, x: l.x, y: l.y, pouso: false });
      }
      for (const p of e.mapa.portais) {
        if (agora < l.portalPronto) break;
        const [de, para] = Math.hypot(p.a.x - l.x, p.a.y - l.y) <= PORTAL.raio ? [p.a, p.b] : Math.hypot(p.b.x - l.x, p.b.y - l.y) <= PORTAL.raio ? [p.b, p.a] : [null, null];
        if (!de || !para) continue;
        efeitos.push({ tipo: "linha", x0: de.x, y0: de.y, x1: para.x, y1: para.y, cor: "#c9b8ff" });
        efeitos.push({ tipo: "anel", x: para.x, y: para.y, raio: 30, cor: "#c9b8ff", ms: 300 });
        l.x = para.x;
        l.y = para.y;
        l.portalPronto = agora + PORTAL.segEspera * 1e3;
        break;
      }
      if (l.voandoAte <= agora && bloco(e.mapa, Math.floor(l.x / BLOCO), Math.floor(l.y / BLOCO)) === T.ABISMO) {
        const credito = l.ultimoAtacante && l.ultimoAtacante.ate > agora ? e.lutadores.get(l.ultimoAtacante.id) : void 0;
        l.areaDesde = null;
        aplicarDano(e, l, 9999, agora, efeitos, void 0, { autor: credito, tipo: "lava" });
        if (e.fim) return;
        if (!l.vivo) continue;
      }
    }
    if (l.escudoAte !== 0 && agora >= l.escudoAte) {
      l.escudoAte = 0;
      const ag = H.agulhas;
      for (let k = 0; k < ag.quantidade; k++) {
        const a = k / ag.quantidade * Math.PI * 2;
        novoProjetil(e, l, { x: Math.cos(a), y: Math.sin(a) }, { dano: ag.dano, vel: ag.velocidade, alcance: ag.alcance, estilo: "adaga", mult: multForca(l, agora) });
      }
      efeitos.push({ tipo: "anel", x: l.x, y: l.y, raio: 30, cor: PERSONAGENS[l.personagem].cor, ms: 300 });
    }
    if (jogando && l.voandoAte <= agora && bloco(e.mapa, Math.floor(l.x / BLOCO), Math.floor(l.y / BLOCO)) === 4 && agora >= l.proximaLava) {
      l.proximaLava = agora + 500;
      const credito = l.ultimoAtacante && l.ultimoAtacante.ate > agora ? e.lutadores.get(l.ultimoAtacante.id) : void 0;
      aplicarDano(e, l, LAVA.danoPorSeg / 2 * (l.personagem === "pacheco" ? H.lavaPacheco.fator : 1), agora, efeitos, void 0, { autor: credito, tipo: "lava" });
      if (e.fim) return;
      if (!l.vivo) continue;
    }
    if (e.supernova && !l.temSupernova && Math.hypot(l.x - e.supernova.x, l.y - e.supernova.y) <= SUPERNOVA.raioColeta) {
      efeitos.push({ tipo: "supernova", acao: "pegou", x: e.supernova.x, y: e.supernova.y, de: l.id });
      l.temSupernova = true;
      e.supernova = null;
      e.proximaSupernova = agora + SUPERNOVA.segIntervalo * 1e3;
    }
    if (e.pintura && jogando) pintar(e, l, l.x, l.y, PINTAO.raioRastro);
    if (l.voandoAte !== 0 && agora >= l.voandoAte) {
      l.voandoAte = 0;
      const p = pontoLivrePerto(e.mapa, l.x, l.y, passagemDe(l.personagem, false));
      l.x = p.x;
      l.y = p.y;
      efeitos.push({ tipo: "voo", de: l.id, x: l.x, y: l.y, pouso: true });
    }
    if (e.mapa.paredesTemp.length && l.voandoAte <= agora && !posicaoLivre(e.mapa, l.x, l.y, R2, passagemDe(l.personagem, false))) {
      const p = pontoLivrePerto(e.mapa, l.x, l.y, passagemDe(l.personagem, false));
      l.x = p.x;
      l.y = p.y;
    }
    if (dentroDaArea(e.mapa, l.vaga, l.x, l.y)) l.areaDesde ??= agora;
    else {
      l.areaDesde = null;
      l.areaSuspensa = false;
    }
    if (l.frio.ate <= agora) l.frio.camadas = 0;
    for (const d of [...l.dots]) {
      if (agora < d.proximo) continue;
      d.tiques--;
      d.proximo = agora + CONFIG.queimadura.segIntervalo * 1e3;
      if (d.tiques <= 0) l.dots = l.dots.filter((x) => x !== d);
      aplicarDano(e, l, d.dano, agora, efeitos, void 0, { autor: e.lutadores.get(d.de), tipo: "dot" });
      if (e.fim || !l.vivo) break;
    }
    if (!l.vivo) continue;
    if (l.personagem === "medico" && agora - l.ultimoDanoRecebido >= H.regeneracao.segSemDano * 1e3 && agora >= l.proximaRegen) {
      l.proximaRegen = agora + 1e3;
      if (l.vida < vidaMaxima(l.personagem)) curar(l, H.regeneracao.porSeg, efeitos);
    }
    if (l.personagem === "relojoeiro") {
      l.historico.push({ t: agora, x: l.x, y: l.y, vida: l.vida });
      const limite = agora - (H.rebobinar.segAtras + 1) * 1e3;
      while (l.historico.length && l.historico[0].t < limite) l.historico.shift();
    }
    const alcancePickup = l.personagem === "pescador" ? H.ima.raio : CONFIG.pickups.raioColeta + R2;
    for (const pk of e.mapa.pickups) {
      if ((e.pickups.get(pk.id) ?? 0) > agora) continue;
      if (Math.hypot(l.x - pk.x, l.y - pk.y) > alcancePickup) continue;
      if (pk.tipo === "vida") {
        if (l.vida >= vidaMaxima(l.personagem)) continue;
        curar(l, CONFIG.pickups.vida.cura, efeitos);
        e.pickups.set(pk.id, agora + CONFIG.pickups.vida.segReaparecer * 1e3);
      } else {
        l.forcaAte = agora + CONFIG.pickups.forca.segDuracao * 1e3;
        e.pickups.set(pk.id, agora + CONFIG.pickups.forca.segReaparecer * 1e3);
      }
      efeitos.push({ tipo: "pickup", alvo: l.id, pickup: pk.id, item: pk.tipo });
    }
  }
  if (e.fim) return;
  if (neon(e) && agora >= e.proximoDanoZona) e.proximoDanoZona = agora + 1e3;
  if (jogando && !e.supernova && agora >= e.proximaSupernova) {
    e.supernova = lugarSupernova(e);
    e.proximaSupernova = agora + SUPERNOVA.segIntervalo * 1e3;
    if (e.supernova) efeitos.push({ tipo: "supernova", acao: "surgiu", ...e.supernova });
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
      p.proximaCompleta = agora + 2e3;
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
function eliminar(e, id, agora, efeitos) {
  const l = e.lutadores.get(id);
  if (!l || l.fora) return;
  l.fora = true;
  if (!l.vivo) {
    if (renasce(e) && !e.fim) fimPorAbandono(e);
    return;
  }
  l.vida = 0;
  morrer(e, l, void 0, agora, efeitos);
}
function visivelPara(e, alvo, obs, agora) {
  if (!obs || obs.id === alvo.id || alvo.marcadoAte > agora || aliados(obs, alvo)) return true;
  const d = Math.hypot(alvo.x - obs.x, alvo.y - obs.y);
  const esc = e.mapa.escuro;
  if (esc && d > esc.raioVisao && !esc.luzes.some((l) => Math.hypot(alvo.x - l.x, alvo.y - l.y) <= l.r)) return false;
  if (alvo.reveladoAte <= agora && d > MOITA.raioVisto && bloco(e.mapa, Math.floor(alvo.x / BLOCO), Math.floor(alvo.y / BLOCO)) === T.MATO) return false;
  if (alvo.invisivelAte <= agora) return true;
  if (e.pocas.some((p) => Math.hypot(alvo.x - p.x, alvo.y - p.y) <= p.r)) return true;
  return obs.personagem === "armadilheiro" && Math.hypot(alvo.x - obs.x, alvo.y - obs.y) <= H.faro.raio;
}
function estadosDe(l, agora) {
  const s = [];
  if (l.invisivelAte > agora) s.push("invisivel");
  if (l.congeladoAte > agora) s.push("congelado");
  if (l.presoAte > agora) s.push("preso");
  if (l.dots.some((d) => d.tipo === "veneno")) s.push("envenenado");
  if (l.silenciadoAte > agora) s.push("silenciado");
  if (l.furiaAte > agora) s.push("furia");
  if (l.refletindoAte > agora) s.push("refletindo");
  if (l.laserAte > agora) s.push("laser");
  if (l.personagem === "hacker") s.push("glitch");
  if (l.marcadoAte > agora) s.push("marcado");
  if (l.cancaoAte > agora) s.push("cancao");
  if (l.sobrecargaAte > agora) s.push("sobrecarga");
  if (l.supernovaAte > agora) s.push("supernova");
  if (l.corridaAte > agora) s.push("corrida");
  if (l.salto) s.push("salto");
  if (l.marcaAlvo && l.marcaAlvo.ate > agora) s.push("ca\xE7ando");
  if (l.temSupernova) s.push("temSupernova");
  if (l.frio.ate > agora && l.frio.camadas > 0) s.push(`frio${l.frio.camadas}`);
  return s;
}
function snapshot(e, agora, paraId) {
  const obs = paraId ? e.lutadores.get(paraId) : void 0;
  const lutadores = [];
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
      queimando: l.dots.some((d) => d.tipo === "fogo"),
      preparada: l.preparada,
      escudo: Math.max(0, l.escudoAte - agora),
      rapido: l.rapidoAte > agora,
      chocado: l.chocadoAte > agora,
      voando: l.voandoAte > agora,
      recargaAtaque: Math.max(0, l.recargaAtaqueAte - agora),
      recargaAtiva: Math.max(0, l.recargaAtivaAte - agora)
    });
  }
  const entidades = [];
  for (const x of e.entidades) {
    if (x.tipo === "mina") {
      const raioVer = obs?.personagem === "armadilheiro" ? H.faro.raio : H.mina.raioVisivel;
      if (obs && x.dono !== obs.id && Math.hypot(obs.x - x.x, obs.y - x.y) > raioVer) continue;
      entidades.push({ id: x.id, tipo: "mina", dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), restante: 0 });
      continue;
    }
    const restante = Math.max(0, x.ate - agora);
    if (x.tipo === "parede") entidades.push({ id: x.id, tipo: "parede", dono: x.dono, x: x.ret.x, y: x.ret.y, w: x.ret.w, h: x.ret.h, restante });
    else if (x.tipo === "clone") {
      const d = e.lutadores.get(x.dono);
      entidades.push({ id: x.id, tipo: "clone", dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), restante, personagem: x.personagem, ax: d?.mira.x ?? 1, ay: d?.mira.y ?? 0 });
    } else if (x.tipo === "drone") entidades.push({ id: x.id, tipo: "drone", dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), restante });
    else entidades.push({ id: x.id, tipo: x.tipo, dono: x.dono, x: Math.round(x.x), y: Math.round(x.y), r: x.r, restante });
  }
  const t = Math.max(0, (agora - e.inicio) / 1e3);
  e.mapa.dinamicas.forEach((d, i) => {
    if ((t + d.fase) % d.periodo < d.fechado)
      entidades.push({ id: -1 - i, tipo: "parede", dono: "", x: d.ret.x, y: d.ret.y, w: d.ret.w, h: d.ret.h, restante: Math.round((d.fechado - (t + d.fase) % d.periodo) * 1e3), estilo: "prensa" });
  });
  for (const m of e.muros) entidades.push({ id: m.id, tipo: "parede", dono: "", x: m.ret.x, y: m.ret.y, w: m.ret.w, h: m.ret.h, restante: 0, estilo: "muro", vida: Math.round(m.vida), vidaMax: MURO.vida });
  return {
    t: agora,
    inicio: e.inicio,
    modo: e.modo,
    meta: e.meta,
    supernova: e.supernova,
    ...MODOS_EQUIPE.includes(e.modo) ? { pontosEquipe: [...e.pontosEquipe], coresEquipe: e.coresEquipe } : {},
    ...ehBandeira(e.modo) ? { controle: e.controle.map((c) => ({ ...c, progresso: Math.round(c.progresso * 100) / 100 })), tempoRestante: Math.max(0, e.fimEm - agora) } : {},
    ...e.pintura ? {
      tempoRestante: Math.max(0, e.fimEm - agora),
      pintura: {
        colunas: e.pintura.colunas,
        linhas: e.pintura.linhas,
        mudancas: e.pintura.mudancas,
        pintaveis: e.pintura.pintaveis,
        ...e.pintura.enviarCompleta ? { completa: Buffer.from(e.pintura.dono).toString("base64") } : {}
      }
    } : {},
    ...neon(e) ? { zona: { x: e.mapa.largura / 2, y: e.mapa.altura / 2, raio: Math.round(raioZona(e, agora)) } } : {},
    lutadores,
    projeteis: e.projeteis.filter((p) => p.inicio <= agora).map((p) => ({
      id: p.id,
      dono: p.dono,
      x: Math.round(p.x),
      y: Math.round(p.y),
      vx: Math.round(p.dx * p.vel),
      vy: Math.round(p.dy * p.vel),
      preparada: p.preparada,
      tinta: p.tinta,
      agua: p.agua,
      estilo: p.estilo
    })),
    pocas: e.pocas.map((p) => ({ id: p.id, dono: p.dono, x: Math.round(p.x), y: Math.round(p.y), r: p.r, restante: Math.max(0, p.ate - agora) })),
    entidades,
    pickups: e.mapa.pickups.filter((p) => (e.pickups.get(p.id) ?? 0) <= agora).map((p) => p.id)
  };
}

// server/src/limitador.ts
var Limitador = class {
  constructor(porSegundo, rajada, agora = Date.now) {
    this.porSegundo = porSegundo;
    this.rajada = rajada;
    this.agora = agora;
  }
  baldes = /* @__PURE__ */ new Map();
  permitir(chave, custo = 1) {
    const t = this.agora();
    const b = this.baldes.get(chave) ?? { fichas: this.rajada, atualizado: t };
    b.fichas = Math.min(this.rajada, b.fichas + (t - b.atualizado) / 1e3 * this.porSegundo);
    b.atualizado = t;
    const ok = b.fichas >= custo;
    if (ok) b.fichas -= custo;
    this.baldes.set(chave, b);
    return ok;
  }
  esquecer(chave) {
    this.baldes.delete(chave);
  }
};

// server/src/rede.ts
import { networkInterfaces } from "node:os";
function enderecosRedeLocal(porta) {
  const out = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(`http://${i.address}:${porta}`);
    }
  }
  return out.sort((a, b) => Number(!/\/\/192\.168\./.test(a)) - Number(!/\/\/192\.168\./.test(b)));
}

// server/src/rng.ts
import { randomBytes, randomInt } from "node:crypto";
var rngServidor = { inteiro: (min, max) => randomInt(min, max + 1) };
var gerarToken = () => randomBytes(24).toString("base64url");
var gerarId = () => randomBytes(8).toString("hex");

// server/src/salas.ts
var ErroSala = class extends Error {
  constructor(codigo2, mensagem) {
    super(mensagem);
    this.codigo = codigo2;
  }
  get json() {
    return { codigo: this.codigo, mensagem: this.message };
  }
};
var erro = (c, m) => {
  throw new ErroSala(c, m);
};
var Salas = class {
  constructor(rng, agora = Date.now, prazoReconexaoMs = CONFIG.sala.prazoReconexaoMs) {
    this.rng = rng;
    this.agora = agora;
    this.prazoReconexaoMs = prazoReconexaoMs;
  }
  salas = /* @__PURE__ */ new Map();
  porToken = /* @__PURE__ */ new Map();
  todas() {
    return this.salas.values();
  }
  sessao(token) {
    const codigo2 = this.porToken.get(token);
    const sala2 = codigo2 ? this.salas.get(codigo2) : void 0;
    const jogador = sala2?.jogadores.find((j) => j.token === token);
    return sala2 && jogador ? { sala: sala2, jogador } : void 0;
  }
  criar(apelido2, socketId) {
    let codigo2 = "";
    do {
      codigo2 = Array.from({ length: CONFIG.sala.tamanhoCodigo }, () => CONFIG.sala.alfabetoCodigo[this.rng.inteiro(0, CONFIG.sala.alfabetoCodigo.length - 1)]).join("");
    } while (this.salas.has(codigo2));
    const jogador = this.novo(apelido2, socketId);
    jogador.personagem = "veni";
    const sala2 = { codigo: codigo2, anfitriaoId: jogador.id, jogadores: [jogador], jogo: null, mapa: MAPA_PADRAO, modo: "royale", coresEquipe: [CORES_EQUIPE[0], CORES_EQUIPE[1]], ladosTrocados: false, semConectadosDesde: null };
    this.salas.set(codigo2, sala2);
    this.porToken.set(jogador.token, codigo2);
    return { sala: sala2, jogador };
  }
  entrar(codigo2, apelido2, socketId) {
    const sala2 = this.salas.get(codigo2) ?? erro("CODIGO_INVALIDO", "Sala n\xE3o encontrada.");
    if (sala2.jogo) erro("PARTIDA_INICIADA", "A partida j\xE1 come\xE7ou.");
    if (sala2.jogadores.length >= CONFIG.sala.jogadores) erro("SALA_CHEIA", "Sala cheia.");
    let nome = apelido2;
    for (let n = 2; sala2.jogadores.some((j) => j.apelido.toLowerCase() === nome.toLowerCase()); n++) nome = `${apelido2.slice(0, 13)} ${n}`;
    const jogador = this.novo(nome, socketId);
    const livre = IDS_PERSONAGENS.find((p) => !sala2.jogadores.some((j) => j.personagem === p));
    jogador.personagem = livre ?? null;
    jogador.equipe = sala2.jogadores.filter((j) => j.equipe === 0).length <= sala2.jogadores.filter((j) => j.equipe === 1).length ? 0 : 1;
    sala2.jogadores.push(jogador);
    this.porToken.set(jogador.token, codigo2);
    return { sala: sala2, jogador };
  }
  reconectar(token, socketId) {
    const s = this.sessao(token) ?? erro("SESSAO_INVALIDA", "Sess\xE3o expirada.");
    s.jogador.socketId = socketId;
    s.jogador.desconectadoEm = null;
    s.sala.semConectadosDesde = null;
    return s;
  }
  desconectar(socketId) {
    for (const sala2 of this.salas.values()) {
      const j = sala2.jogadores.find((x) => x.socketId === socketId);
      if (!j) continue;
      j.socketId = null;
      j.desconectadoEm = this.agora();
      if (!sala2.jogadores.some((x) => x.socketId)) sala2.semConectadosDesde = this.agora();
      return sala2;
    }
    return void 0;
  }
  sair(token) {
    const { sala: sala2, jogador } = this.sessao(token) ?? erro("FORA_DA_SALA", "Voc\xEA n\xE3o est\xE1 numa sala.");
    this.remover(sala2, jogador);
    return sala2;
  }
  /** O anfitrião expulsa um jogador (no lobby ou no meio da partida). Devolve o socket de quem saiu. */
  expulsar(token, jogadorId) {
    const s = this.sessao(token) ?? erro("FORA_DA_SALA", "Voc\xEA n\xE3o est\xE1 numa sala.");
    if (s.jogador.id !== s.sala.anfitriaoId) erro("NAO_AUTORIZADO", "S\xF3 o anfitri\xE3o expulsa jogadores.");
    const alvo = s.sala.jogadores.find((j) => j.id === jogadorId) ?? erro("DADOS_INVALIDOS", "Jogador n\xE3o encontrado.");
    if (alvo === s.jogador) erro("DADOS_INVALIDOS", "Para sair, use o bot\xE3o de sair.");
    const socketId = alvo.socketId;
    this.remover(s.sala, alvo);
    return { sala: s.sala, socketId };
  }
  escolher(token, personagem) {
    const { sala: sala2, jogador } = this.lobby(token);
    if (personagem && sala2.jogadores.some((j) => j !== jogador && j.personagem === personagem)) erro("PERSONAGEM_OCUPADO", "Personagem j\xE1 escolhido.");
    jogador.personagem = personagem;
    jogador.pronto = false;
    return sala2;
  }
  pronto(token, pronto) {
    const { sala: sala2, jogador } = this.lobby(token);
    if (pronto && !jogador.personagem) erro("NAO_PODE_INICIAR", "Escolha um personagem.");
    jogador.pronto = pronto;
    return sala2;
  }
  /** O anfitrião escolhe o mapa no lobby. */
  escolherMapa(token, mapa) {
    const { sala: sala2, jogador } = this.lobby(token);
    if (jogador.id !== sala2.anfitriaoId) erro("NAO_AUTORIZADO", "S\xF3 o anfitri\xE3o escolhe o mapa.");
    if (!mapaAceitaModo(MAPAS[mapa], sala2.modo)) erro("NAO_PODE_INICIAR", "Este mapa n\xE3o \xE9 feito para o Pega Bandeira.");
    sala2.mapa = mapa;
    return sala2;
  }
  /** O anfitrião escolhe o modo no lobby. */
  escolherModo(token, modo) {
    const { sala: sala2, jogador } = this.lobby(token);
    if (jogador.id !== sala2.anfitriaoId) erro("NAO_AUTORIZADO", "S\xF3 o anfitri\xE3o escolhe o modo.");
    sala2.modo = modo;
    if (!mapaAceitaModo(MAPAS[sala2.mapa], modo)) sala2.mapa = "colmeia";
    return sala2;
  }
  /** Troca de equipe no lobby (no máximo 3 por equipe). */
  trocarEquipe(token, equipe) {
    const { sala: sala2, jogador } = this.lobby(token);
    if (sala2.jogadores.filter((j) => j.equipe === equipe && j !== jogador).length >= 3) erro("SALA_CHEIA", "Equipe cheia.");
    jogador.equipe = equipe;
    jogador.pronto = false;
    return sala2;
  }
  /** O líder (o primeiro da equipe) escolhe a cor; as duas equipes não podem ter a mesma cor. */
  corEquipe(token, cor) {
    const { sala: sala2, jogador } = this.lobby(token);
    const lider = sala2.jogadores.find((j) => j.equipe === jogador.equipe);
    if (lider !== jogador) erro("NAO_AUTORIZADO", "S\xF3 o l\xEDder da equipe escolhe a cor.");
    if (!CORES_EQUIPE.includes(cor)) erro("DADOS_INVALIDOS", "Cor inv\xE1lida.");
    if (sala2.coresEquipe[1 - jogador.equipe] === cor) erro("DADOS_INVALIDOS", "A outra equipe j\xE1 usa essa cor.");
    sala2.coresEquipe[jogador.equipe] = cor;
    return sala2;
  }
  podeIniciar(sala2) {
    return !sala2.jogo && sala2.jogadores.length >= CONFIG.sala.minimoJogadores && mapaAceitaModo(MAPAS[sala2.mapa], sala2.modo) && (!MODOS_EQUIPE.includes(sala2.modo) || sala2.jogadores.some((j) => j.equipe === 0) && sala2.jogadores.some((j) => j.equipe === 1)) && sala2.jogadores.every((j) => j.socketId && j.personagem && (j.pronto || j.id === sala2.anfitriaoId));
  }
  iniciar(token) {
    const { sala: sala2, jogador } = this.lobby(token);
    if (jogador.id !== sala2.anfitriaoId) erro("NAO_AUTORIZADO", "S\xF3 o anfitri\xE3o inicia.");
    if (!this.podeIniciar(sala2)) erro("NAO_PODE_INICIAR", "Aguardando os jogadores ficarem prontos.");
    sala2.jogo = criarJogo(
      sala2.jogadores.map((j) => ({ id: j.id, personagem: j.personagem, equipe: j.equipe })),
      this.agora(),
      MAPAS[sala2.mapa],
      sala2.modo,
      [...sala2.coresEquipe],
      sala2.ladosTrocados
    );
    return sala2;
  }
  /** Volta ao lobby depois do fim da partida. */
  encerrarJogo(sala2) {
    if (sala2.jogo && MODOS_EQUIPE.includes(sala2.modo)) sala2.ladosTrocados = !sala2.ladosTrocados;
    sala2.jogo = null;
    for (const j of sala2.jogadores) j.pronto = false;
  }
  /** Expira desconexões e salas vazias. Retorna salas alteradas e encerradas. */
  manutencao() {
    const t = this.agora();
    const alteradas = [];
    const encerradas = [];
    for (const sala2 of this.salas.values()) {
      let mudou = false;
      for (const j of [...sala2.jogadores]) {
        if (j.desconectadoEm !== null && t - j.desconectadoEm >= this.prazoReconexaoMs) {
          this.remover(sala2, j);
          mudou = true;
        }
      }
      const ociosa = sala2.semConectadosDesde !== null && t - sala2.semConectadosDesde >= CONFIG.sala.encerrarSalaVaziaMs;
      if (!sala2.jogadores.length || ociosa) {
        for (const j of sala2.jogadores) this.porToken.delete(j.token);
        this.salas.delete(sala2.codigo);
        encerradas.push(sala2);
      } else if (mudou) alteradas.push(sala2);
    }
    return { alteradas, encerradas };
  }
  publica(sala2) {
    return {
      codigo: sala2.codigo,
      estado: sala2.jogo ? "partida" : "lobby",
      mapa: sala2.mapa,
      modo: sala2.modo,
      coresEquipe: [...sala2.coresEquipe],
      ladosTrocados: sala2.ladosTrocados,
      jogadores: sala2.jogadores.map((j) => ({
        id: j.id,
        apelido: j.apelido,
        personagem: j.personagem,
        pronto: j.pronto,
        conectado: j.socketId !== null,
        anfitriao: j.id === sala2.anfitriaoId,
        equipe: j.equipe
      })),
      podeIniciar: this.podeIniciar(sala2)
    };
  }
  lobby(token) {
    const s = this.sessao(token) ?? erro("FORA_DA_SALA", "Voc\xEA n\xE3o est\xE1 numa sala.");
    if (s.sala.jogo) erro("PARTIDA_INICIADA", "A partida j\xE1 come\xE7ou.");
    return s;
  }
  remover(sala2, j) {
    sala2.jogadores = sala2.jogadores.filter((x) => x !== j);
    this.porToken.delete(j.token);
    if (sala2.jogo) eliminar(sala2.jogo, j.id, this.agora(), []);
    if (j.id === sala2.anfitriaoId && sala2.jogadores[0]) sala2.anfitriaoId = sala2.jogadores[0].id;
  }
  novo(apelido2, socketId) {
    return { id: gerarId(), token: gerarToken(), apelido: apelido2, socketId, desconectadoEm: null, personagem: null, pronto: false, equipe: 0 };
  }
};

// server/src/index.ts
var VERSAO = "0.16.2";
function origemPermitida(origem, host) {
  if (!origem) return true;
  try {
    return new URL(origem).host === host;
  } catch {
    return false;
  }
}
async function iniciarServidor(op) {
  const app = express();
  app.disable("x-powered-by");
  const http = createServer(app);
  const io = new Server(http, {
    maxHttpBufferSize: CONFIG.rede.maxBytesMensagem,
    pingInterval: 1e4,
    pingTimeout: 8e3,
    allowRequest: (req, cb) => cb(null, origemPermitida(req.headers.origin, req.headers.host))
  });
  const salas = new Salas(rngServidor, Date.now, op.prazoReconexaoMs ?? CONFIG.sala.prazoReconexaoMs);
  const limGeral = new Limitador(CONFIG.rede.maxEventosPorSegundo, CONFIG.rede.rajadaEventos);
  const limCmd = new Limitador(CONFIG.rede.maxComandosPorSegundo, CONFIG.rede.maxComandosPorSegundo * 2);
  const limEntrada = new Limitador(CONFIG.sala.maxTentativasEntradaPorMinuto / 60, CONFIG.sala.maxTentativasEntradaPorMinuto);
  const tokenDe = /* @__PURE__ */ new Map();
  const canal = (s) => `sala:${s.codigo}`;
  const publicar = (s) => io.to(canal(s)).emit("sala:estado", salas.publica(s));
  const emitirEfeitos = (s, efs) => {
    for (const e of efs) io.to(canal(s)).emit("jogo:efeito", e);
  };
  io.on("connection", (socket) => {
    const ip = socket.handshake.address;
    const sessaoAtual = () => {
      const t = tokenDe.get(socket.id);
      return t ? salas.sessao(t) : void 0;
    };
    function tratar(evento, fn, extra) {
      return (bruto, ack) => {
        const responder = (r) => typeof ack === "function" && ack(r);
        if (!limGeral.permitir(socket.id) || extra && !extra()) return responder({ ok: false, erro: { codigo: "LIMITE_EXCEDIDO", mensagem: "Aguarde." } });
        const v = ESQUEMAS[evento].safeParse(bruto ?? {});
        if (!v.success) {
          const campo = v.error.issues[0]?.path[0];
          const codigo2 = campo === "codigo" ? "CODIGO_INVALIDO" : campo === "apelido" ? "APELIDO_INVALIDO" : "DADOS_INVALIDOS";
          return responder({ ok: false, erro: { codigo: codigo2, mensagem: codigo2 === "CODIGO_INVALIDO" ? "C\xF3digo inv\xE1lido." : codigo2 === "APELIDO_INVALIDO" ? "Apelido inv\xE1lido." : "Mensagem inv\xE1lida." } });
        }
        try {
          responder({ ok: true, dados: fn(v.data) ?? null });
        } catch (e) {
          if (e instanceof ErroSala) return responder({ ok: false, erro: e.json });
          console.error(e);
          responder({ ok: false, erro: { codigo: "DADOS_INVALIDOS", mensagem: "Erro no servidor." } });
        }
      };
    }
    const entrarNoCanal = (s, token) => {
      for (const r of socket.rooms) if (r.startsWith("sala:")) void socket.leave(r);
      void socket.join(canal(s));
      tokenDe.set(socket.id, token);
      publicar(s);
      return { token, jogadorId: s.jogadores.find((j) => j.token === token).id, sala: salas.publica(s) };
    };
    socket.on("sala:criar", tratar("sala:criar", ({ apelido: apelido2 }) => {
      const { sala: sala2, jogador } = salas.criar(apelido2, socket.id);
      return entrarNoCanal(sala2, jogador.token);
    }));
    socket.on("sala:entrar", tratar("sala:entrar", ({ codigo: codigo2, apelido: apelido2 }) => {
      const { sala: sala2, jogador } = salas.entrar(codigo2, apelido2, socket.id);
      return entrarNoCanal(sala2, jogador.token);
    }, () => limEntrada.permitir(ip)));
    socket.on("sala:reconectar", tratar("sala:reconectar", ({ token }) => {
      const anterior = salas.sessao(token)?.jogador.socketId;
      const { sala: sala2 } = salas.reconectar(token, socket.id);
      if (anterior && anterior !== socket.id) io.sockets.sockets.get(anterior)?.disconnect(true);
      return entrarNoCanal(sala2, token);
    }));
    socket.on("sala:sair", tratar("sala:sair", () => {
      const t = tokenDe.get(socket.id);
      if (!t) throw new ErroSala("FORA_DA_SALA", "Voc\xEA n\xE3o est\xE1 numa sala.");
      const sala2 = salas.sair(t);
      tokenDe.delete(socket.id);
      void socket.leave(canal(sala2));
      publicar(sala2);
      return null;
    }));
    socket.on("sala:expulsar", tratar("sala:expulsar", ({ jogadorId }) => {
      const t = tokenDe.get(socket.id);
      if (!t) throw new ErroSala("FORA_DA_SALA", "Voc\xEA n\xE3o est\xE1 numa sala.");
      const { sala: sala2, socketId } = salas.expulsar(t, jogadorId);
      if (socketId) {
        io.to(socketId).emit("sala:encerrada", { motivo: "Voc\xEA foi expulso da sala pelo anfitri\xE3o." });
        tokenDe.delete(socketId);
        io.sockets.sockets.get(socketId)?.leave(canal(sala2));
      }
      publicar(sala2);
      return null;
    }));
    const lobby = (fn) => (d) => {
      const t = tokenDe.get(socket.id);
      if (!t) throw new ErroSala("FORA_DA_SALA", "Voc\xEA n\xE3o est\xE1 numa sala.");
      publicar(fn(t, d));
      return null;
    };
    socket.on("lobby:personagem", tratar("lobby:personagem", lobby((t, d) => salas.escolher(t, d.personagem))));
    socket.on("lobby:pronto", tratar("lobby:pronto", lobby((t, d) => salas.pronto(t, d.pronto))));
    socket.on("lobby:mapa", tratar("lobby:mapa", lobby((t, d) => salas.escolherMapa(t, d.mapa))));
    socket.on("lobby:modo", tratar("lobby:modo", lobby((t, d) => salas.escolherModo(t, d.modo))));
    socket.on("lobby:equipe", tratar("lobby:equipe", lobby((t, d) => salas.trocarEquipe(t, d.equipe))));
    socket.on("lobby:corEquipe", tratar("lobby:corEquipe", lobby((t, d) => salas.corEquipe(t, d.cor))));
    socket.on("lobby:iniciar", tratar("lobby:iniciar", lobby((t) => salas.iniciar(t))));
    socket.on("jogo:cmd", (bruto) => {
      if (!limCmd.permitir(socket.id)) return;
      const v = ESQUEMAS["jogo:cmd"].safeParse(bruto);
      const s = sessaoAtual();
      const l = s?.sala.jogo?.lutadores.get(s.jogador.id);
      if (v.success && l) receberComando(l, v.data);
    });
    socket.on("jogo:mira", (bruto) => {
      if (!limCmd.permitir(socket.id)) return;
      const v = ESQUEMAS["jogo:mira"].safeParse(bruto);
      const s = sessaoAtual();
      const l = s?.sala.jogo?.lutadores.get(s.jogador.id);
      if (v.success && l) mirar(l, v.data.dx, v.data.dy);
    });
    const acao = (evento) => (bruto) => {
      if (!limGeral.permitir(socket.id)) return;
      const v = ESQUEMAS[evento].safeParse(bruto);
      const s = sessaoAtual();
      const jogo = s?.sala.jogo;
      const l = jogo?.lutadores.get(s.jogador.id);
      if (!v.success || !jogo || !l) return;
      const efs = [];
      if (evento === "jogo:atacar") atacar(jogo, l, v.data.dx, v.data.dy, Date.now(), efs, v.data.carga ?? 0);
      else usarAtiva(jogo, l, v.data.dx, v.data.dy, Date.now(), efs);
      emitirEfeitos(s.sala, efs);
    };
    socket.on("jogo:atacar", acao("jogo:atacar"));
    socket.on("jogo:supernova", () => {
      if (!limGeral.permitir(socket.id)) return;
      const s = sessaoAtual();
      const jogo = s?.sala.jogo;
      const l = jogo?.lutadores.get(s.jogador.id);
      if (!jogo || !l) return;
      const efs = [];
      ativarSupernova(jogo, l, Date.now(), efs);
      emitirEfeitos(s.sala, efs);
    });
    socket.on("jogo:personagem", (bruto) => {
      if (!limGeral.permitir(socket.id)) return;
      const v = ESQUEMAS["jogo:personagem"].safeParse(bruto);
      const s = sessaoAtual();
      const jogo = s?.sala.jogo;
      const l = jogo?.lutadores.get(s.jogador.id);
      if (v.success && jogo && l) trocarPersonagemAoRenascer(jogo, l, v.data.personagem);
    });
    socket.on("jogo:ativa", acao("jogo:ativa"));
    socket.on("ping", (t, ack) => typeof ack === "function" && typeof t === "number" && ack(t));
    socket.on("disconnect", () => {
      tokenDe.delete(socket.id);
      limGeral.esquecer(socket.id);
      limCmd.esquecer(socket.id);
      const sala2 = salas.desconectar(socket.id);
      if (sala2) publicar(sala2);
    });
  });
  let porta = op.porta;
  app.get("/api/info", (_q, res) => res.json({ enderecos: enderecosRedeLocal(porta), porta, versao: VERSAO }));
  if (op.pastaCliente && existsSync(op.pastaCliente)) {
    app.use(
      express.static(op.pastaCliente, {
        index: "index.html",
        setHeaders: (res, caminho) => res.setHeader("Cache-Control", caminho.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable")
      })
    );
    app.get("*", (_q, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(resolve(op.pastaCliente, "index.html"));
    });
  }
  const fimEnviado = /* @__PURE__ */ new WeakSet();
  const laco = setInterval(() => {
    const agora = Date.now();
    for (const sala2 of salas.todas()) {
      const jogo = sala2.jogo;
      if (!jogo) continue;
      const efs = [];
      tick(jogo, agora, efs);
      emitirEfeitos(sala2, efs);
      for (const j of sala2.jogadores) {
        if (j.socketId) io.to(j.socketId).volatile.emit("jogo:snapshot", snapshot(jogo, agora, j.id));
      }
      limparMudancasPintura(jogo);
      if (jogo.fim && !fimEnviado.has(jogo)) {
        fimEnviado.add(jogo);
        io.to(canal(sala2)).emit("jogo:fim", { vencedorId: jogo.fim.vencedorId, ...jogo.fim.equipe !== void 0 ? { equipe: jogo.fim.equipe } : {} });
        setTimeout(() => {
          if (sala2.jogo === jogo) {
            salas.encerrarJogo(sala2);
            publicar(sala2);
          }
        }, 5e3);
      }
    }
  }, 1e3 / CONFIG.rede.taxaSimulacaoHz);
  const manut = setInterval(() => {
    const { alteradas, encerradas } = salas.manutencao();
    for (const s of alteradas) publicar(s);
    for (const s of encerradas) io.to(canal(s)).emit("sala:encerrada", { motivo: "Sala encerrada." });
  }, CONFIG.sala.intervaloLimpezaMs);
  laco.unref();
  manut.unref();
  await new Promise((ok, falha) => {
    http.once("error", falha);
    http.listen(op.porta, op.host, () => ok());
  });
  const end = http.address();
  if (end && typeof end === "object") porta = end.port;
  return {
    http,
    io,
    salas,
    porta,
    fechar: async () => {
      clearInterval(laco);
      clearInterval(manut);
      await new Promise((ok) => io.close(() => ok()));
    }
  };
}
async function main() {
  const porta = Number(process.env.PORT || 3100);
  const pastaCliente = resolve(dirname(fileURLToPath(import.meta.url)), "../client");
  const s = await iniciarServidor({ porta, host: process.env.HOST || "0.0.0.0", pastaCliente });
  const dev = !existsSync(pastaCliente);
  const enderecos = enderecosRedeLocal(dev ? 5173 : s.porta);
  console.log(`
Neon Royale v${VERSAO} \u2014 porta ${s.porta}${dev ? " (dev: abra pela porta 5173)" : ""}`);
  for (const e of enderecos) console.log(`  ${e}`);
  if (enderecos[0]) console.log(await QRCode.toString(enderecos[0], { type: "terminal", small: true }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
export {
  VERSAO,
  iniciarServidor,
  origemPermitida
};
//# sourceMappingURL=index.js.map
