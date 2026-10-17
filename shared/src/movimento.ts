import { CONFIG } from './config';
import { mover, type Passagem } from './colisao';
import { BLOCO, ESTEIRAS, T, bloco, type Mapa } from './mapa';
import { HABILIDADES, PERSONAGENS, type IdPersonagem } from './personagens';

/** Poça de tinta (como o servidor envia e o cliente usa na previsão). */
export interface Poca {
  id: number;
  dono: string;
  x: number;
  y: number;
  r: number;
}

/**
 * Fator de velocidade por causa da tinta no ponto (x, y):
 * dentro de poça de outro jogador = lento; o Vini sobre a própria tinta = mais rápido.
 */
export function fatorTinta(jogadorId: string, personagem: IdPersonagem, x: number, y: number, pocas: readonly Poca[], aliados?: ReadonlySet<string>): number {
  let propria = false;
  let inimiga = false;
  for (const p of pocas) {
    if ((x - p.x) ** 2 + (y - p.y) ** 2 > p.r * p.r) continue;
    if (p.dono === jogadorId) propria = true;
    else if (!aliados?.has(p.dono)) inimiga = true;
  }
  if (inimiga) return HABILIDADES.tinta.lentidao;
  if (propria && personagem === 'vini') return HABILIDADES.tinta.surfista;
  return 1;
}

/**
 * Fator final de velocidade: tinta e choque não se somam (vale a lentidão maior);
 * o choque também anula o bônus de surfista; a adrenalina multiplica no fim.
 */
export function fatorVelocidade(tinta: number, chocado: boolean, adrenalina: boolean, outra = 1): number {
  let f = tinta;
  if (chocado) f = Math.min(f, HABILIDADES.choque.lentidao);
  // outras lentidões (frio, preso, congelado): também vale a maior
  if (outra < 1) f = Math.min(f, outra);
  return f * (adrenalina ? HABILIDADES.adrenalina.fator : 1);
}

/** Um comando de movimento (vetor com módulo ≤ 1) aplicado com o passo fixo. Igual no cliente e no servidor. */
/** O que cada personagem atravessa ao andar (o Pacheco anda na água; voando, passa por tudo). */
export function passagemDe(personagem: IdPersonagem, voando: boolean): Passagem {
  if (voando) return 'tudo';
  return personagem === 'pacheco' ? 'agua' : 'nada';
}

/** Terreno: a lama deixa 40% mais lento; o gelo dá inércia; as esteiras arrastam. */
export const TERRENO = { lama: 0.6, aderenciaGelo: 0.12, esteira: 130 } as const;

/** Velocidade carregada entre comandos (o gelo precisa dela). */
export interface Vel {
  vx: number;
  vy: number;
}

/**
 * Um comando de movimento (vetor com módulo ≤ 1) aplicado com o passo fixo, considerando o terreno.
 * Igual no cliente e no servidor. Devolve a posição nova e a velocidade (para o gelo).
 */
export function aplicarMovimento(
  mapa: Mapa,
  personagem: IdPersonagem,
  x: number,
  y: number,
  cx: number,
  cy: number,
  fator = 1,
  voando = false,
  vel: Vel = { vx: 0, vy: 0 },
): { x: number; y: number; vx: number; vy: number } {
  const dt = CONFIG.movimento.dtComando;
  const piso = voando ? 0 : bloco(mapa, Math.floor(x / BLOCO), Math.floor(y / BLOCO));
  const m = Math.hypot(cx, cy);
  const k = m > 1 ? 1 / m : 1;
  const vMax = CONFIG.movimento.velocidadeBase * PERSONAGENS[personagem].velocidade * fator * (piso === T.LAMA ? TERRENO.lama : 1);
  const alvoX = cx * k * vMax;
  const alvoY = cy * k * vMax;
  // no gelo, a velocidade só muda aos poucos (escorrega); fora dele, é a do comando
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
    // bater numa parede no gelo zera a velocidade naquela direção
    vx = (p.x - x) / dt;
    vy = (p.y - y) / dt;
  }
  return { x: p.x, y: p.y, vx: Math.round(vx * 100) / 100, vy: Math.round(vy * 100) / 100 };
}

/** Terreno onde dá para ficar parado e ainda assim se mover (o aparelho precisa mandar comandos vazios). */
export function terrenoMove(mapa: Mapa, x: number, y: number, vel: Vel): boolean {
  const piso = bloco(mapa, Math.floor(x / BLOCO), Math.floor(y / BLOCO));
  return !!ESTEIRAS[piso] || (piso === T.GELO && Math.hypot(vel.vx, vel.vy) > 6);
}
