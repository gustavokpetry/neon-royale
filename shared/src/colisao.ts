/**
 * Movimento livre com colisão círculo × blocos sólidos: empurra pela menor distância,
 * então o personagem desliza em paredes e cantos. Determinístico (servidor e cliente iguais).
 */
//a
import { CONFIG } from './config';
import { BLOCO, bloco, type Mapa } from './mapa';

const R = CONFIG.movimento.raioJogador;

/** O que o personagem atravessa: 'nada' (normal), 'agua' (Pacheco) ou 'tudo' (voo: só a borda segura). */
export type Passagem = 'nada' | 'agua' | 'tudo';

function solido(m: Mapa, c: number, r: number, passa: Passagem): boolean {
  if (passa === 'tudo') return c <= 0 || r <= 0 || c >= m.colunas - 1 || r >= m.linhas - 1;
  const b = bloco(m, c, r);
  // sólidos: obstáculo, mureta e água (o Pacheco nada); o resto é pisável
  return b === 1 || b === 2 || (b === 3 && passa !== 'agua');
}

function empurrar(x: number, y: number, r: number, x0: number, y0: number, x1: number, y1: number): [number, number] {
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
  const opc: Array<[number, number, number]> = [
    [x0 - r, y, x - x0],
    [x1 + r, y, x1 - x],
    [x, y0 - r, y - y0],
    [x, y1 + r, y1 - y],
  ];
  opc.sort((a, b) => a[2] - b[2]);
  return [opc[0]![0], opc[0]![1]];
}

function resolver(m: Mapa, x: number, y: number, r: number = R, passa: Passagem = 'nada'): [number, number] {
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
    // paredes temporárias (Engenheiro): sólidas para todos, menos para quem voa
    if (passa !== 'tudo') for (const p of m.paredesTemp) [x, y] = empurrar(x, y, r, p.x, p.y, p.x + p.w, p.y + p.h);
  }
  return [x, y];
}

export function posicaoLivre(m: Mapa, x: number, y: number, r: number = R, passa: Passagem = 'nada'): boolean {
  const [nx, ny] = resolver(m, x, y, r, passa);
  return Math.abs(nx - x) < 0.01 && Math.abs(ny - y) < 0.01;
}

/** Move (x, y) por (dx, dy) em passos curtos, deslizando nos obstáculos. */
export function mover(m: Mapa, x: number, y: number, dx: number, dy: number, passa: Passagem = 'nada'): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  const passos = Math.max(1, Math.ceil(dist / 3));
  let cx = x;
  let cy = y;
  for (let i = 0; i < passos; i++) [cx, cy] = resolver(m, cx + dx / passos, cy + dy / passos, R, passa);
  return { x: Math.round(cx * 1000) / 1000, y: Math.round(cy * 1000) / 1000 };
}


/**
 * Teletransporte de fuga: entre os pontos livres a uma distância [minimo, maximo] de (x, y),
 * escolhe o que fica mais longe do inimigo mais próximo. Sem inimigos, vai na direção (dx, dy).
 */
export function destinoFuga(
  m: Mapa,
  x: number,
  y: number,
  inimigos: ReadonlyArray<{ x: number; y: number }>,
  minimo: number,
  maximo: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  let melhor: { x: number; y: number; nota: number } | null = null;
  const aneis = 4;
  for (let a = 0; a < 32; a++) {
    const ang = (a / 32) * Math.PI * 2;
    for (let k = 0; k <= aneis; k++) {
      const d = minimo + ((maximo - minimo) * k) / aneis;
      const px = x + Math.cos(ang) * d;
      const py = y + Math.sin(ang) * d;
      if (!posicaoLivre(m, px, py)) continue;
      const nota = inimigos.length
        ? Math.min(...inimigos.map((i) => Math.hypot(i.x - px, i.y - py)))
        : Math.cos(ang) * dx + Math.sin(ang) * dy + d / 10000;
      if (!melhor || nota > melhor.nota) melhor = { x: px, y: py, nota };
    }
  }
  return melhor ? { x: melhor.x, y: melhor.y } : { x, y };
}

/** Obstáculos, muretas e a borda param tiros, golpes e explosões; a água (3) não. */
export function bloqueiaTiro(m: Mapa, x: number, y: number): boolean {
  const b = bloco(m, Math.floor(x / BLOCO), Math.floor(y / BLOCO));
  if (b === 1 || b === 2) return true;
  for (const p of m.paredesTemp) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
  return false;
}

/** Linha livre de obstáculos altos (para golpes corpo a corpo e explosões). */
export function linhaLivre(m: Mapa, ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(d / 4));
  for (let i = 1; i < n; i++) {
    if (bloqueiaTiro(m, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false;
  }
  return true;
}

/** Ponto livre mais próximo (espiral), para pousar depois do voo. */
export function pontoLivrePerto(m: Mapa, x: number, y: number, passa: Passagem = 'nada'): { x: number; y: number } {
  if (posicaoLivre(m, x, y, R, passa)) return { x, y };
  for (let d = 8; d < 600; d += 8) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      if (posicaoLivre(m, px, py, R, passa)) return { x: px, y: py };
    }
  }
  return { x, y };
}
