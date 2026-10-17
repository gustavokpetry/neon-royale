/** Validação das mensagens recebidas pelo servidor (o cliente nunca é confiável). */
import { z } from 'zod';
import { CONFIG } from './config';
import { IDS_MAPAS } from './mapa';
import { IDS_PERSONAGENS } from './personagens';

const S = CONFIG.sala;
const apelido = z
  .string()
  .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(S.tamanhoMaxApelido).regex(/^[^<>&"'`]+$/u));
const codigo = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().length(S.tamanhoCodigo).regex(new RegExp(`^[${S.alfabetoCodigo}]+$`)));
const direcao = z.object({ dx: z.number().min(-1.5).max(1.5), dy: z.number().min(-1.5).max(1.5) }).strict();

export const ESQUEMAS = {
  'sala:criar': z.object({ apelido }).strict(),
  'sala:entrar': z.object({ codigo, apelido }).strict(),
  'sala:reconectar': z.object({ token: z.string().min(16).max(128) }).strict(),
  'sala:sair': z.object({}).strict(),
  'sala:expulsar': z.object({ jogadorId: z.string().min(1).max(64) }).strict(),
  'lobby:personagem': z.object({ personagem: z.enum(IDS_PERSONAGENS).nullable() }).strict(),
  'lobby:pronto': z.object({ pronto: z.boolean() }).strict(),
  'lobby:mapa': z.object({ mapa: z.enum(IDS_MAPAS) }).strict(),
  'lobby:modo': z.object({ modo: z.enum(['royale', 'abates', 'corrida', 'equipes', 'neoncalypse', 'bandeira', 'bandeiraEquipe', 'pintao', 'pintaoEquipe']) }).strict(),
  'lobby:equipe': z.object({ equipe: z.number().int().min(0).max(1) }).strict(),
  'lobby:corEquipe': z.object({ cor: z.string().regex(/^#[0-9a-f]{6}$/i) }).strict(),
  'jogo:personagem': z.object({ personagem: z.enum(IDS_PERSONAGENS) }).strict(),
  'lobby:iniciar': z.object({}).strict(),
  'jogo:cmd': z.object({ seq: z.number().int().nonnegative(), x: z.number().min(-1.5).max(1.5), y: z.number().min(-1.5).max(1.5) }).strict(),
  'jogo:atacar': z.object({ dx: z.number().min(-1.5).max(1.5), dy: z.number().min(-1.5).max(1.5), carga: z.number().min(0).max(1).optional() }).strict(),
  'jogo:mira': direcao,
  'jogo:ativa': direcao,
} as const;
