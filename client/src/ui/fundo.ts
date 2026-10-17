/** Fundo animado da tela inicial: silhuetas neon flutuando com as cores dos personagens. */
import { LISTA_PERSONAGENS } from '@shared/personagens';

let canvas: HTMLCanvasElement | null = null;
let quadro = 0;

interface Bolha {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  cor: string;
  fase: number;
}

export function iniciarFundo(): void {
  if (canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fundo-neon';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ajustar = () => {
    canvas!.width = innerWidth * dpr;
    canvas!.height = innerHeight * dpr;
  };
  ajustar();
  window.addEventListener('resize', ajustar);
  const bolhas: Bolha[] = Array.from({ length: 22 }, (_, i) => {
    const p = LISTA_PERSONAGENS[i % LISTA_PERSONAGENS.length]!;
    return {
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      vx: (Math.random() - 0.5) * 18,
      vy: (Math.random() - 0.5) * 18,
      r: 8 + Math.random() * 14,
      cor: p.cor,
      fase: Math.random() * 6,
    };
  });
  let ultimo = performance.now();
  const passo = (agora: number) => {
    if (!canvas) return;
    const dt = Math.min(0.05, (agora - ultimo) / 1000);
    ultimo = agora;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    // grade de perspectiva sutil
    ctx.strokeStyle = 'rgba(255,61,154,0.07)';
    ctx.lineWidth = 1;
    for (let x = ((agora / 60) % 64) - 64; x < innerWidth; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, innerHeight);
      ctx.stroke();
    }
    for (let y = ((agora / 90) % 64) - 64; y < innerHeight; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(innerWidth, y);
      ctx.stroke();
    }
    for (const b of bolhas) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -40) b.x = innerWidth + 40;
      if (b.x > innerWidth + 40) b.x = -40;
      if (b.y < -40) b.y = innerHeight + 40;
      if (b.y > innerHeight + 40) b.y = -40;
      const brilho = 0.35 + 0.25 * Math.sin(agora / 700 + b.fase);
      ctx.shadowColor = b.cor;
      ctx.shadowBlur = 18;
      ctx.globalAlpha = brilho;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = b.cor;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    quadro = requestAnimationFrame(passo);
  };
  quadro = requestAnimationFrame(passo);
  (canvas as HTMLCanvasElement & { parar?: () => void }).parar = () => window.removeEventListener('resize', ajustar);
}

export function pararFundo(): void {
  if (!canvas) return;
  cancelAnimationFrame(quadro);
  (canvas as HTMLCanvasElement & { parar?: () => void }).parar?.();
  canvas.remove();
  canvas = null;
}
