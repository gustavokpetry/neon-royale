/**
 * Entrada do jogador: teclado (WASD/setas) no computador e joystick virtual no celular.
 * O joystick é DOM puro: segue o dedo mesmo fora da área inicial (pointer capture)
 * e aceita vários toques ao mesmo tempo (um dedo no joystick, outro nos botões).
 */
export interface Vetor {
  x: number;
  y: number;
}

export const ehToque = (): boolean => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

export class Entrada {
  private teclas = new Set<string>();
  private joystick: Vetor = { x: 0, y: 0 };
  private ponteiroJoystick: number | null = null;
  private origem = { x: 0, y: 0 };
  private readonly raioJoystick = 56;
  private readonly limpar: Array<() => void> = [];

  constructor(
    private readonly zona: HTMLElement,
    private readonly base: HTMLElement,
    private readonly pino: HTMLElement,
    private readonly aoInteragir: () => void,
    private readonly aoMochila: () => void,
    private readonly aoAtacar: () => void = () => {},
    private readonly aoTrocarArma: () => void = () => {},
  ) {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.teclas.add(k);
        e.preventDefault();
      }
      if ((k === 'e' || k === 'enter') && !e.repeat) {
        e.preventDefault();
        this.aoInteragir();
      }
      if (k === ' ' && !e.repeat) {
        e.preventDefault();
        this.aoAtacar();
      }
      if (k === 'q' && !e.repeat) {
        e.preventDefault();
        this.aoTrocarArma();
      }
      if ((k === 'tab' || k === 'i') && !e.repeat) {
        e.preventDefault();
        this.aoMochila();
      }
    };
    const up = (e: KeyboardEvent) => this.teclas.delete(e.key.toLowerCase());
    const blur = () => {
      this.teclas.clear();
      this.soltarJoystick();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.limpar.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });

    const pd = (e: PointerEvent) => {
      if (this.ponteiroJoystick !== null) return;
      this.ponteiroJoystick = e.pointerId;
      try {
        zona.setPointerCapture(e.pointerId);
      } catch {
        /* alguns navegadores recusam a captura; o joystick continua funcionando dentro da zona */
      }
      this.origem = { x: e.clientX, y: e.clientY };
      base.style.left = `${e.clientX}px`;
      base.style.top = `${e.clientY}px`;
      base.classList.add('ativo');
      this.atualizarJoystick(e.clientX, e.clientY);
      e.preventDefault();
    };
    const pm = (e: PointerEvent) => {
      if (e.pointerId !== this.ponteiroJoystick) return;
      this.atualizarJoystick(e.clientX, e.clientY);
      e.preventDefault();
    };
    const pu = (e: PointerEvent) => {
      if (e.pointerId === this.ponteiroJoystick) this.soltarJoystick();
    };
    zona.addEventListener('pointerdown', pd);
    zona.addEventListener('pointermove', pm);
    zona.addEventListener('pointerup', pu);
    zona.addEventListener('pointercancel', pu);
    this.limpar.push(() => {
      zona.removeEventListener('pointerdown', pd);
      zona.removeEventListener('pointermove', pm);
      zona.removeEventListener('pointerup', pu);
      zona.removeEventListener('pointercancel', pu);
    });
  }

  private atualizarJoystick(x: number, y: number): void {
    let dx = x - this.origem.x;
    let dy = y - this.origem.y;
    const d = Math.hypot(dx, dy);
    // Se o dedo passar muito do limite, a base acompanha (joystick "flutuante").
    if (d > this.raioJoystick * 1.6) {
      const k = (d - this.raioJoystick) / d;
      this.origem.x += dx * k;
      this.origem.y += dy * k;
      this.base.style.left = `${this.origem.x}px`;
      this.base.style.top = `${this.origem.y}px`;
      dx = x - this.origem.x;
      dy = y - this.origem.y;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / this.raioJoystick);
    const ang = Math.atan2(dy, dx);
    // zona morta pequena; intensidade controla a velocidade
    const intensidade = m < 0.15 ? 0 : (m - 0.15) / 0.85;
    this.joystick = { x: Math.cos(ang) * intensidade, y: Math.sin(ang) * intensidade };
    this.pino.style.transform = `translate(${Math.cos(ang) * m * this.raioJoystick}px, ${Math.sin(ang) * m * this.raioJoystick}px)`;
  }

  private soltarJoystick(): void {
    this.ponteiroJoystick = null;
    this.joystick = { x: 0, y: 0 };
    this.pino.style.transform = 'translate(0, 0)';
    this.base.classList.remove('ativo');
  }

  vetor(): Vetor {
    let x = 0;
    let y = 0;
    if (this.teclas.has('a') || this.teclas.has('arrowleft')) x -= 1;
    if (this.teclas.has('d') || this.teclas.has('arrowright')) x += 1;
    if (this.teclas.has('w') || this.teclas.has('arrowup')) y -= 1;
    if (this.teclas.has('s') || this.teclas.has('arrowdown')) y += 1;
    if (x !== 0 || y !== 0) {
      const m = Math.hypot(x, y);
      return { x: x / m, y: y / m };
    }
    return this.joystick;
  }

  destruir(): void {
    for (const f of this.limpar) f();
  }
}

/**
 * Botão de ataque do celular (estilo "twin-stick"), medido a partir de onde o dedo encostou:
 * - toque rápido (sem arrastar): um ataque na direção atual;
 * - segurar sem arrastar: ataca sem parar na direção atual;
 * - arrastar: mira na direção do arraste e ataca sem parar.
 * Não existe mira automática.
 */
export class MiraToque {
  private ponteiro: number | null = null;
  private origem = { x: 0, y: 0 };
  private inicio = 0;
  private arrastou = false;
  private delta = { x: 0, y: 0 };
  private ultimo: Vetor = { x: 1, y: 0 };
  /** Distância do arraste (px) para começar a mirar. */
  private readonly limiar = 14;
  private readonly raio = 52;
  private readonly limpar: Array<() => void> = [];

  constructor(
    private readonly botao: HTMLElement,
    private readonly pino: HTMLElement,
    private readonly aoToqueRapido: () => void,
  ) {
    const pd = (e: PointerEvent) => {
      if (this.ponteiro !== null) return;
      this.ponteiro = e.pointerId;
      try {
        botao.setPointerCapture(e.pointerId);
      } catch {
        /* segue sem captura */
      }
      this.origem = { x: e.clientX, y: e.clientY };
      this.inicio = performance.now();
      this.arrastou = false;
      this.delta = { x: 0, y: 0 };
      botao.classList.add('mirando');
      e.preventDefault();
    };
    const pm = (e: PointerEvent) => {
      if (e.pointerId !== this.ponteiro) return;
      this.delta = { x: e.clientX - this.origem.x, y: e.clientY - this.origem.y };
      const d = Math.hypot(this.delta.x, this.delta.y);
      if (d > this.limiar) {
        this.arrastou = true;
        this.ultimo = { x: this.delta.x / d, y: this.delta.y / d };
      }
      const m = Math.min(1, d / this.raio);
      const k = d > 0 ? (m * this.raio * 0.6) / d : 0;
      this.pino.style.transform = `translate(${this.delta.x * k}px, ${this.delta.y * k}px)`;
      e.preventDefault();
    };
    const pu = (e: PointerEvent) => {
      if (e.pointerId !== this.ponteiro) return;
      if (!this.arrastou && performance.now() - this.inicio < 260) this.aoToqueRapido();
      this.ponteiro = null;
      this.delta = { x: 0, y: 0 };
      this.arrastou = false;
      this.pino.style.transform = 'translate(0, 0)';
      botao.classList.remove('mirando');
    };
    botao.addEventListener('pointerdown', pd);
    botao.addEventListener('pointermove', pm);
    botao.addEventListener('pointerup', pu);
    botao.addEventListener('pointercancel', pu);
    this.limpar.push(() => {
      botao.removeEventListener('pointerdown', pd);
      botao.removeEventListener('pointermove', pm);
      botao.removeEventListener('pointerup', pu);
      botao.removeEventListener('pointercancel', pu);
    });
  }

  /**
   * `ativo` = o dedo está mirando (arrastou); `x, y` = direção do arraste.
   * `atirando` = arrastou, ou está segurando há mais de 260 ms sem arrastar.
   */
  estado(): { x: number; y: number; ativo: boolean; atirando: boolean } {
    const segurando = this.ponteiro !== null;
    return {
      x: this.ultimo.x,
      y: this.ultimo.y,
      ativo: segurando && this.arrastou,
      atirando: segurando && (this.arrastou || performance.now() - this.inicio >= 260),
    };
  }

  destruir(): void {
    for (const f of this.limpar) f();
  }
}
