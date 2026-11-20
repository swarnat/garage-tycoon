import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/Game';
import { CustomerSystem } from '../src/simulation/CustomerSystem';

function generate(type: 'standard' | 'major', seed: number, timeCritical = false) {
  const game = Game.new(seed);
  game.state.totalMinutes = 480;
  const weighted = game.rng.weighted.bind(game.rng);
  vi.spyOn(game.rng, 'weighted').mockImplementation((items, weights) => {
    if (items[0] === 'standard') return items.find((item) => item === type)!;
    if (timeCritical && items[0] === 'price_sensitive') return items.find((item) => item === 'time_critical')!;
    return weighted(items, weights);
  });
  return { game, order: CustomerSystem.generateOffer(game.ctx) };
}

describe('Zusammenhängende Reparaturen', () => {
  it.each([['standard', 2, 0.25], ['major', 3, 0.20]] as const)(
    'erzeugt bei %s ungefähr den vorgesehenen Anteil an Folgearbeiten',
    (type, count, fraction) => {
      const sample = Array.from({ length: 1000 }, (_, seed) => generate(type, seed + 1));
      const extended = sample.filter(({ order }) => order.defectRepairIds.length === count);
      expect(extended.length / sample.length).toBeGreaterThan(fraction - 0.045);
      expect(extended.length / sample.length).toBeLessThan(fraction + 0.045);
      for (const { order } of sample) {
        expect(order.defectRepairIds.length).toBeLessThanOrEqual(3);
        expect(new Set(order.defectRepairIds).size).toBe(order.defectRepairIds.length);
      }
    },
  );

  it('gewährt auch zeitkritischen Kunden die Mindestfrist und behält längere Fristen', () => {
    const orders = Array.from({ length: 120 }, (_, seed) => generate('major', seed + 1, true).order);
    for (const order of orders) {
      expect(order.dueAtMinute).toBeGreaterThanOrEqual((order.defectRepairIds.length - 1) * 1440 + 1080);
      expect(order.dueAtMinute % 1440).toBe(1080);
    }
    expect(orders.some((order) => order.dueAtMinute > 2 * 1440 + 1080)).toBe(true);
  });
});
