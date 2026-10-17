import { describe, expect, it } from 'vitest';
import { posicaoLivre } from '@shared/colisao';
import { BLOCO, LISTA_MAPAS, bloco, ehPerigo, type Mapa } from '@shared/mapa';

/** Pisável e sem perigo (chão, mato, lama, gelo, esteira). */
const seguro = (b: number) => b === 0 || b === 5 || b === 6 || b >= 8;

/** Blocos onde o personagem cabe, ligados entre si (busca em largura). */
function alcancaveis(m: Mapa, de: { x: number; y: number }): Set<number> {
  // lava conta como bloqueio: todo lugar importante precisa ser alcançável sem se queimar
  const semLava = (c: number, r: number) => [-1, 0, 1].every((dc) => [-1, 0, 1].every((dr) => !ehPerigo(bloco(m, c + dc, r + dr))));
  const livre = (c: number, r: number) => posicaoLivre(m, c * BLOCO + BLOCO / 2, r * BLOCO + BLOCO / 2) && semLava(c, r);
  const ini = [Math.floor(de.x / BLOCO), Math.floor(de.y / BLOCO)] as const;
  const vistos = new Set<number>([ini[1] * m.colunas + ini[0]]);
  const fila: Array<readonly [number, number]> = [ini];
  while (fila.length) {
    const [c, r] = fila.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const k = nr * m.colunas + nc;
      if (vistos.has(k) || !livre(nc, nr)) continue;
      vistos.add(k);
      fila.push([nc, nr]);
    }
  }
  return vistos;
}

describe.each(LISTA_MAPAS.map((m) => [m.nome, m] as const))('mapa %s', (_nome, m) => {
  it('é maior que o antigo e simétrico nos dois eixos (menos o Desfiladeiro, de propósito)', () => {
    expect(m.largura).toBeGreaterThanOrEqual(1600);
    if (!m.simetrico) return;
    for (let r = 0; r < m.linhas; r++) {
      for (let c = 0; c < m.colunas; c++) {
        // esteiras espelhadas trocam de direção: compara só o tipo de chão
        const k = (b: number) => (b >= 9 ? 9 : b);
        expect(k(bloco(m, c, r))).toBe(k(bloco(m, m.colunas - 1 - c, r)));
        expect(k(bloco(m, c, r))).toBe(k(bloco(m, c, m.linhas - 1 - r)));
      }
    }
  });

  it('centro aberto (raio de 10 blocos sem obstáculo)', () => {
    const cc = m.colunas / 2;
    const cr = m.linhas / 2;
    for (let r = cr - 10; r < cr + 10; r++) for (let c = cc - 10; c < cc + 10; c++) if (Math.hypot(c - cc + 0.5, r - cr + 0.5) <= 10) expect(seguro(bloco(m, c, r)), `${c},${r}`).toBe(true);
  });

  it('nascimentos, áreas seguras e pickups livres e todos ligados entre si', () => {
    const inicio = m.nascimentos[0]!;
    const rede = alcancaveis(m, inicio);
    const chave = (p: { x: number; y: number }) => Math.floor(p.y / BLOCO) * m.colunas + Math.floor(p.x / BLOCO);
    const extras = [...m.portais.flatMap((p) => [p.a, p.b]), ...m.trampolins.flatMap((t) => [{ x: t.x, y: t.y }, t.destino])];
    for (const p of [...m.nascimentos, ...m.pickups, ...(m.controle ?? []), ...extras]) {
      expect(posicaoLivre(m, p.x, p.y), JSON.stringify(p)).toBe(true);
      expect(seguro(bloco(m, Math.floor(p.x / BLOCO), Math.floor(p.y / BLOCO))), `em cima de perigo: ${JSON.stringify(p)}`).toBe(true);
      expect(rede.has(chave(p)), `inalcançável: ${JSON.stringify(p)}`).toBe(true);
    }
    for (const a of m.areas) {
      for (const o of [...m.obstaculos.filter((x) => x.tipo !== 5 && x.tipo !== 6 && x.tipo !== 8), ...m.dinamicas.map((d) => d.ret), ...m.destrutiveis]) {
        const px = Math.max(o.x, Math.min(a.x, o.x + o.w));
        const py = Math.max(o.y, Math.min(a.y, o.y + o.h));
        expect(Math.hypot(px - a.x, py - a.y), `obstáculo dentro da área da vaga ${a.vaga}`).toBeGreaterThan(a.raio);
      }
    }
  });
});
