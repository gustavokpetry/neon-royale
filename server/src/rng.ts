import { randomBytes, randomInt } from 'node:crypto';
export interface Rng { inteiro(min: number, max: number): number }

/** RNG do servidor (criptográfico). Todos os dados do jogo são sorteados aqui. */
export const rngServidor: Rng = { inteiro: (min, max) => randomInt(min, max + 1) };

export const gerarToken = (): string => randomBytes(24).toString('base64url');
export const gerarId = (): string => randomBytes(8).toString('hex');
