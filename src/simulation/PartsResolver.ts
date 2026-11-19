import type { CustomerProfile, GameState, PartDef, PartQuality, VehicleModelDef } from '../entities/types';
import type { SimContext } from './context';

/** Qualitätsklasse je Kundenprofil: preisbewusst → Budget, Qualität → Premium. */
export function qualityForProfile(profile: CustomerProfile): PartQuality {
  if (profile === 'price_sensitive') return 'budget';
  if (profile === 'quality_oriented') return 'premium';
  return 'standard';
}

/** Aufschub-Gewährung je Profil (Spielminuten). */
export const DELAY_BY_PROFILE: Record<CustomerProfile, number> = {
  time_critical: 360,
  price_sensitive: 720,
  regular: 1440,
  quality_oriented: 1440,
  business: 1440,
};

const DELAY_BASE: Record<CustomerProfile, number> = {
  regular: 0.75,
  quality_oriented: 0.65,
  business: 0.55,
  price_sensitive: 0.45,
  time_critical: 0.2,
};

/** Wahrscheinlichkeit, dass der Kunde einen Terminaufschub akzeptiert. */
export function delayChance(state: GameState, profile: CustomerProfile, lastSatisfaction: number | null): number {
  const base =
    DELAY_BASE[profile] +
    (state.reputation / 100) * 0.2 +
    (lastSatisfaction !== null && lastSatisfaction >= 80 ? 0.1 : 0);
  return Math.max(0.05, Math.min(0.95, base));
}

/**
 * Löst eine Teile-Kategorie auf die konkrete Variante auf:
 * Spec aus dem Fahrzeug-Steckbrief, Qualität aus dem Kundenprofil.
 * Fallback: Standard-Qualität, dann irgendeine passende Spec-Variante.
 */
export function resolveVariant(
  ctx: SimContext,
  categoryId: string,
  model: VehicleModelDef,
  profile: CustomerProfile,
): PartDef | null {
  const spec = model.partSpecs[categoryId] ?? 'M';
  const quality = qualityForProfile(profile);
  const inCat = ctx.defs.parts.filter((p) => p.category === categoryId);
  return (
    inCat.find((p) => p.spec === spec && p.quality === quality) ??
    inCat.find((p) => p.spec === spec && p.quality === 'standard') ??
    inCat.find((p) => p.spec === spec) ??
    inCat.find((p) => p.quality === 'standard') ??
    inCat[0] ??
    null
  );
}
