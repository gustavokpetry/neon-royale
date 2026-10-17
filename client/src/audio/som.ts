/**
 * Sonoplastia gerada no navegador (Web Audio), sem arquivos de áudio.
 * Cada som é uma combinação curta de osciladores e ruído filtrado.
 * O navegador só libera o áudio depois do primeiro toque/tecla (`destravar`).
 */
export type Som =
  | 'flecha' | 'bala' | 'gota' | 'tinta' | 'feixe' | 'orbe' | 'granada' | 'tiro'
  | 'golpe' | 'giro' | 'explosao' | 'teleporte' | 'dano' | 'danoEu' | 'bloqueio' | 'morte'
  | 'pickup' | 'cura' | 'onda' | 'pulso' | 'voo' | 'respingo' | 'habilidade' | 'zap'
  | 'contagem' | 'largada' | 'vitoria' | 'derrota';

const CHAVE_MUDO = 'neon:mudo';
let ctx: AudioContext | null = null;
let mestre: GainNode | null = null;
let ruidoBuffer: AudioBuffer | null = null;
let mudo = (() => {
  try {
    return localStorage.getItem(CHAVE_MUDO) === '1';
  } catch {
    return false;
  }
})();

/** Libera o áudio (chamar num toque ou tecla). */
export function destravar(): void {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      ctx = new C();
      mestre = ctx.createGain();
      mestre.gain.value = mudo ? 0 : 0.5;
      mestre.connect(ctx.destination);
      // 1 s de ruído branco reaproveitado por todos os sons
      ruidoBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = ruidoBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function estaMudo(): boolean {
  return mudo;
}

export function alternarMudo(): boolean {
  mudo = !mudo;
  try {
    localStorage.setItem(CHAVE_MUDO, mudo ? '1' : '0');
  } catch {
    /* sem armazenamento */
  }
  if (mestre && ctx) mestre.gain.setTargetAtTime(mudo ? 0 : 0.5, ctx.currentTime, 0.02);
  return mudo;
}

/** Oscilador com envelope e varredura de frequência. */
function tom(tipo: OscillatorType, f0: number, f1: number, dur: number, vol: number, atraso = 0): void {
  if (!ctx || !mestre) return;
  const t = ctx.currentTime + atraso;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(mestre);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Ruído filtrado (explosões, golpes, respingos). */
function ruido(dur: number, vol: number, f0: number, f1: number, filtro: BiquadFilterType = 'lowpass', atraso = 0): void {
  if (!ctx || !mestre || !ruidoBuffer) return;
  const t = ctx.currentTime + atraso;
  const s = ctx.createBufferSource();
  s.buffer = ruidoBuffer;
  const f = ctx.createBiquadFilter();
  f.type = filtro;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(mestre);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

/** Toca um som; `vol` (0–1) vem da distância até quem ouve. */
export function tocar(nome: Som, vol = 1): void {
  if (mudo || !ctx || vol <= 0.02) return;
  const v = Math.min(1, vol);
  switch (nome) {
    case 'flecha':
      tom('triangle', 900, 300, 0.12, 0.25 * v);
      ruido(0.06, 0.15 * v, 6000, 2000, 'highpass');
      break;
    case 'bala':
      ruido(0.05, 0.3 * v, 4000, 800, 'bandpass');
      tom('square', 300, 120, 0.05, 0.08 * v);
      break;
    case 'gota':
      tom('sine', 1400, 900, 0.04, 0.08 * v);
      break;
    case 'tinta':
      ruido(0.12, 0.25 * v, 900, 200);
      tom('sine', 220, 90, 0.12, 0.15 * v);
      break;
    case 'feixe':
      tom('sawtooth', 1800, 600, 0.09, 0.12 * v);
      break;
    case 'orbe':
      tom('sine', 180, 120, 0.3, 0.2 * v);
      tom('sine', 270, 200, 0.3, 0.1 * v);
      break;
    case 'granada':
      tom('sine', 160, 90, 0.12, 0.2 * v);
      break;
    case 'tiro':
      tom('square', 700, 350, 0.06, 0.1 * v);
      break;
    case 'golpe':
      ruido(0.12, 0.25 * v, 3000, 600, 'bandpass');
      break;
    case 'giro':
      ruido(0.3, 0.3 * v, 600, 3000, 'bandpass');
      tom('sawtooth', 200, 500, 0.3, 0.06 * v);
      break;
    case 'explosao':
      ruido(0.5, 0.6 * v, 1200, 60);
      tom('sine', 110, 35, 0.45, 0.45 * v);
      break;
    case 'teleporte':
      tom('sine', 300, 1600, 0.18, 0.2 * v);
      tom('triangle', 600, 2400, 0.18, 0.08 * v, 0.03);
      break;
    case 'dano':
      tom('square', 180, 90, 0.07, 0.12 * v);
      break;
    case 'danoEu':
      tom('sawtooth', 160, 60, 0.15, 0.25 * v);
      ruido(0.1, 0.2 * v, 800, 200);
      break;
    case 'bloqueio':
      tom('triangle', 1800, 1700, 0.15, 0.15 * v);
      tom('sine', 2600, 2500, 0.12, 0.08 * v);
      break;
    case 'morte':
      tom('sawtooth', 400, 50, 0.6, 0.3 * v);
      ruido(0.4, 0.3 * v, 2000, 100);
      break;
    case 'pickup':
      tom('sine', 660, 660, 0.08, 0.2 * v);
      tom('sine', 990, 990, 0.12, 0.2 * v, 0.07);
      break;
    case 'cura':
      tom('sine', 520, 780, 0.25, 0.15 * v);
      break;
    case 'onda':
      tom('sine', 900, 120, 0.5, 0.3 * v);
      ruido(0.4, 0.15 * v, 4000, 300, 'bandpass');
      break;
    case 'pulso':
    case 'zap':
      tom('square', 1200, 300, 0.08, 0.1 * v);
      ruido(0.06, 0.12 * v, 8000, 3000, 'highpass');
      break;
    case 'voo':
      ruido(0.35, 0.2 * v, 300, 2500, 'bandpass');
      break;
    case 'respingo':
      ruido(0.18, 0.3 * v, 1200, 150);
      break;
    case 'habilidade':
      tom('triangle', 440, 880, 0.15, 0.15 * v);
      break;
    case 'contagem':
      tom('square', 660, 660, 0.12, 0.15 * v);
      break;
    case 'largada':
      tom('square', 990, 990, 0.3, 0.18 * v);
      break;
    case 'vitoria':
      [523, 659, 784, 1046].forEach((f, i) => tom('triangle', f, f, 0.22, 0.2 * v, i * 0.11));
      break;
    case 'derrota':
      [392, 330, 262].forEach((f, i) => tom('triangle', f, f * 0.98, 0.3, 0.2 * v, i * 0.16));
      break;
  }
}

/** Libera o áudio no primeiro toque ou tecla. */
export function instalarDestrave(): void {
  const f = () => destravar();
  window.addEventListener('pointerdown', f, { passive: true });
  window.addEventListener('keydown', f);
}
