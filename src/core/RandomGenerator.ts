/** Deterministischer PRNG (mulberry32) mit serialisierbarem Zustand. */
export class RandomGenerator {
  readonly seed: number;
  private s: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = this.seed;
  }

  static fromState(seed: number, state: number): RandomGenerator {
    const r = new RandomGenerator(seed);
    r.s = state >>> 0;
    return r;
  }

  get state(): number {
    return this.s;
  }

  /** Gleitkommawert in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Ganzzahl in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  intRange(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    const v = arr[this.int(arr.length)];
    if (v === undefined) throw new Error('pick from empty array');
    return v;
  }

  /** Gewichtete Auswahl; weights parallel zu items. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }
}
