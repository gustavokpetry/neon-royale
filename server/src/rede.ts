import { networkInterfaces } from 'node:os';

/** Endereços IPv4 da rede local deste computador (para mostrar aos jogadores). */
export function enderecosRedeLocal(porta: number): string[] {
  const out: string[] = [];
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${porta}`);
    }
  }
  // Redes domésticas comuns primeiro.
  return out.sort((a, b) => Number(!/\/\/192\.168\./.test(a)) - Number(!/\/\/192\.168\./.test(b)));
}
