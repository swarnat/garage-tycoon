import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/Game';
import { DIAGNOSIS_FEE_CENTS } from '../src/entities/types';
import { SaveManager } from '../src/core/SaveManager';
import { CustomerSystem } from '../src/simulation/CustomerSystem';
import { DiagnosisSystem } from '../src/simulation/DiagnosisSystem';
import { OrderSystem } from '../src/simulation/OrderSystem';
import { RepairSystem } from '../src/simulation/RepairSystem';
import { UI } from '../src/ui/UI';

function intake(type: 'standard' | 'emergency') {
  const game = Game.new(123);
  const weighted = game.rng.weighted.bind(game.rng);
  vi.spyOn(game.rng, 'weighted').mockImplementation((items, weights) =>
    items[0] === 'standard' ? items.find((item) => item === type)! : weighted(items, weights));
  const chance = game.rng.chance.bind(game.rng);
  vi.spyOn(game.rng, 'chance').mockImplementation((probability) => probability === 0.25 ? false : chance(probability));
  const order = CustomerSystem.generateOffer(game.ctx);
  return { game, order };
}

function diagnose({ game, order }: ReturnType<typeof intake>) {
  order.status = 'diagnosing';
  const worker = game.state.workers[0]!;
  worker.skills.diagnosis = 50;
  DiagnosisSystem.complete(game.ctx, order, worker);
}

function invoice({ game, order }: ReturnType<typeof intake>) {
  order.status = 'quality_check';
  order.laborMinutesActual = 60;
  OrderSystem.completeAndInvoice(game.ctx, order);
}

describe('Dringlichkeitszuschlag', () => {
  it('erhöht Budget und Angebot nur bei der Auftragsart Notfall', () => {
    const standard = intake('standard');
    const urgent = intake('emergency');
    expect(urgent.order.defectRepairIds).toEqual(standard.order.defectRepairIds);
    expect(urgent.order.budgetCents).toBeCloseTo(standard.order.budgetCents * 1.15, -0.5);
    standard.order.priority = 2;
    urgent.order.priority = 1;
    diagnose(standard);
    diagnose(urgent);
    expect(urgent.order.estimateCents).toBe(Math.round(standard.order.estimateCents! * 1.15));
    const ui: UI = Object.assign(Object.create(UI.prototype), { getGame: () => urgent.game });
    expect(ui['renderVehicleDetail'](urgent.order.vehicleId)).toContain('Dringlichkeitszuschlag (15 %)');
  });

  it('berechnet den Rabatt auf Angebot und Rechnung inklusive Zuschlag', () => {
    const fixture = intake('emergency');
    const { game, order } = fixture;
    diagnose(fixture);
    order.budgetCents = Math.round(order.estimateCents! * 0.9);
    order.offerAtRisk = true;
    expect(game.offerDiscount(order.id, 10)).toBe(true);
    expect(order.status).not.toBe('cancelled');
    expect(OrderSystem.profitBreakdown(game.ctx, order).revenue).toBe(order.budgetCents);
    invoice(fixture);
    const base = game.state.economy.hourlyRateCents + RepairSystem.partsSellTotal(game.ctx, order) + DIAGNOSIS_FEE_CENTS;
    expect(order.invoiceCents).toBe(Math.round(Math.round(base * 1.15) * 0.9));
  });

  it('belässt den akzeptierten Budgetfestpreis und migrierte Notfallpreise', () => {
    const fixture = intake('emergency');
    const { game, order } = fixture;
    diagnose(fixture);
    order.offerAtRisk = true;
    order.budgetCents = 12345;
    expect(game.acceptBudget(order.id)).toBe(true);
    invoice(fixture);
    expect(order.invoiceCents).toBe(12345);

    const legacy = intake('emergency');
    diagnose(legacy);
    legacy.order.estimateCents = 10000;
    legacy.order.status = 'ready_for_repair';
    const raw = JSON.parse(SaveManager.serialize(legacy.game.state));
    raw.version = 14;
    delete raw.orders.find((o: { id: string }) => o.id === legacy.order.id).urgencySurchargePct;
    const loaded = new Game(SaveManager.parse(JSON.stringify(raw)));
    const loadedOrder = loaded.state.orders.find((o) => o.id === legacy.order.id)!;
    expect(loadedOrder).toMatchObject({ estimateCents: 10000, urgencySurchargePct: 0 });
    invoice({ game: loaded, order: loadedOrder });
    expect(loadedOrder.invoiceCents).toBe(
      loaded.state.economy.hourlyRateCents + RepairSystem.partsSellTotal(loaded.ctx, loadedOrder) + DIAGNOSIS_FEE_CENTS,
    );
  });
});
