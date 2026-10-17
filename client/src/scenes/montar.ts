/** Cria e destrói o Phaser sob demanda (só baixa quando a partida começa). */
import type Phaser from 'phaser';
import type { Arena, ContextoArena } from './Arena';

let jogo: Phaser.Game | null = null;
let remover: (() => void) | null = null;

export async function abrirArena(container: HTMLElement, ctx: ContextoArena): Promise<void> {
  fecharArena();
  const [{ default: P }, { Arena: Cena }] = await Promise.all([import('phaser'), import('./Arena')]);
  container.classList.add('ativo');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const tam = () => ({ w: Math.round(container.clientWidth * dpr), h: Math.round(container.clientHeight * dpr) });
  const { w, h } = tam();
  jogo = new P.Game({
    type: P.AUTO,
    parent: container,
    backgroundColor: '#0f1115',
    width: w,
    height: h,
    scale: { mode: P.Scale.NONE, zoom: 1 / dpr },
    input: { activePointers: 4 },
    render: { antialias: true },
    banner: false,
  });
  const redim = () => {
    const t = tam();
    jogo?.scale.resize(t.w, t.h);
  };
  window.addEventListener('resize', redim);
  remover = () => window.removeEventListener('resize', redim);
  jogo.scene.add('arena', Cena, true, ctx);
}

export function arena(): Arena | null {
  return (jogo?.scene.getScene('arena') as Arena | undefined) ?? null;
}

export function fecharArena(): void {
  remover?.();
  remover = null;
  jogo?.destroy(true);
  jogo = null;
  document.getElementById('jogo')?.classList.remove('ativo');
}
