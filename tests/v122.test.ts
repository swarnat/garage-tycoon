import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { CustomerSystem } from '../src/simulation/CustomerSystem';
import { EconomySystem } from '../src/simulation/EconomySystem';
import { UI } from '../src/ui/UI';

describe('Einstiegsbalancing', () => {
  it('bietet zum Start seltener, aber weiterhin Arbeiten mit fehlendem Spezialwerkzeug an', () => {
    function count(day: number): number {
      return Array.from({ length: 500 }, (_, seed) => {
        const game = Game.new(seed);
        game.state.totalMinutes = (day - 1) * 1440 + 480;
        const order = CustomerSystem.generateOffer(game.ctx);
        return order.defectRepairIds.some((id) => game.defs.repairs.find((r) => r.id === id)?.requiredTools?.some((t) => !game.state.ownedTools.includes(t)));
      }).filter(Boolean).length;
    }
    const early = count(1);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(count(29) / 2);
  });

  it('berechnet 1.500 € für den zweiten Diagnoseplatz und weiterhin 5.000 € für den dritten', () => {
    const game = Game.new(42);
    game.state.economy.balanceCents = 150000;
    expect(game.buyDiagnosisBay()).toBe(true);
    expect(game.state.economy.balanceCents).toBe(0);
    game.state.economy.balanceCents = 500000;
    expect(game.buyDiagnosisBay()).toBe(true);
    expect(game.state.economy.balanceCents).toBe(0);
  });

  it('zeigt Einkauf und Verbrauch getrennt und belastet das Ergebnis nur mit Verbrauch', () => {
    const game = Game.new(42);
    const part = game.defs.parts.find((p) => p.id === 'brake_pads__M__standard')!;
    EconomySystem.book(game.state.economy, { id: 'buy-test', day: 1, atMinute: 480, amountCents: -12300, category: 'parts_purchase', label: 'Test' });
    const cash = game.state.economy.balanceCents;
    const ui: UI = Object.assign(Object.create(UI.prototype), { getGame: () => game });
    expect(ui['renderFinance']()).toContain('Teileeinkauf');
    expect(EconomySystem.operatingResultToday(game.state)).toBe(0);
    EconomySystem.recordPartsUsage(game.ctx, [{ partId: part.id, quantity: 2 }]);
    expect(EconomySystem.operatingResultToday(game.state)).toBe(-2 * part.buyCents);
    expect(game.state.economy.balanceCents).toBe(cash);
    expect(ui['renderFinance']()).toContain('Teileverbrauch');
  });
});
