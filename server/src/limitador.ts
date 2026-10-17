/** Balde de fichas: limita a frequência de eventos por chave (socket ou IP). */
export class Limitador {
  private baldes = new Map<string, { fichas: number; atualizado: number }>();

  constructor(
    private readonly porSegundo: number,
    private readonly rajada: number,
    private readonly agora: () => number = Date.now,
  ) {}

  permitir(chave: string, custo = 1): boolean {
    const t = this.agora();
    const b = this.baldes.get(chave) ?? { fichas: this.rajada, atualizado: t };
    b.fichas = Math.min(this.rajada, b.fichas + ((t - b.atualizado) / 1000) * this.porSegundo);
    b.atualizado = t;
    const ok = b.fichas >= custo;
    if (ok) b.fichas -= custo;
    this.baldes.set(chave, b);
    return ok;
  }

  esquecer(chave: string): void {
    this.baldes.delete(chave);
  }
}
