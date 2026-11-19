import type { PartDef } from '../entities/types';
import type { SimContext } from './context';

/** Dynamische Marktpreise: täglicher Random-Walk innerhalb ±15 %. */
export class MarketSystem {
  static update(ctx: SimContext): void {
    const factors = ctx.state.marketPriceFactors;
    for (const p of ctx.defs.parts) {
      const cur = factors[p.id] ?? 1;
      const next = cur + ctx.rng.range(-0.06, 0.06);
      factors[p.id] = Math.round(Math.max(0.85, Math.min(1.15, next)) * 1000) / 1000;
    }
  }

  static buyCents(ctx: SimContext, part: PartDef): number {
    return Math.round(part.buyCents * (ctx.state.marketPriceFactors[part.id] ?? 1));
  }
}
