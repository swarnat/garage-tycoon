import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { EconomySystem } from '../src/simulation/EconomySystem';
import type { Worker, WorkerRole } from '../src/entities/types';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) game.state.inventory.stock[k] = qty;
  game.state.inventory.capacity = 5000;
}
function accept(game: Game, defectId: string) {
  let offer = game.generateOffer();
  if (!offer) {
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    offer = game.generateOffer()!;
  }
  offer.defectRepairIds = [defectId];
  offer.budgetCents = 5_000_000;
  game.acceptOrder(offer.id);
  game.state.vehicles.find((x) => x.id === offer.vehicleId)!.modelId = 'ford_transit';
  game.state.customers.find((x) => x.id === offer.customerId)!.profile = 'regular';
  return offer;
}
function runUntil(game: Game, pred: () => boolean, maxMinutes = 8 * 1440): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !pred()) game.tick(5);
}
function addWorker(game: Game, role: WorkerRole, speed = 0.7): Worker {
  const base = game.state.workers[0]!;
  const w: Worker = {
    ...JSON.parse(JSON.stringify(base)),
    id: `wtest${game.state.nextId++}`, name: 'Helper', role,
    speedTilesPerMinute: speed, task: null, path: [], state: 'idle', pos: { x: 3, y: 4 },
    workedMinutes: 0, onDutyMinutes: 0, dailyWorkedMinutes: 0, dailyOnDutyMinutes: 0,
    trainingMinutes: 0, pendingTraining: null,
  };
  game.state.workers.push(w);
  return w;
}

describe('Lagerwert & Bilanz', () => {
  it('Lagerwert = Bestand × Markteinkaufspreis', () => {
    const game = Game.new(2400);
    const inv = game.state.inventory;
    for (const k of Object.keys(inv.stock)) inv.stock[k] = 0;
    const p = game.defs.parts.find((x) => x.id === 'brake_pads__M__standard')!;
    inv.stock[p.id] = 3;
    game.state.marketPriceFactors[p.id] = 1;
    const value = EconomySystem.inventoryValueCents(game.state, game.defs.parts);
    expect(value).toBe(p.buyCents * 3);
  });

  it('Bilanz: Eigenkapital = Kontostand + Lagerwert − Schulden', () => {
    const game = Game.new(2401);
    const bs = EconomySystem.balanceSheet(game.state, game.defs.parts);
    expect(bs.assets).toBe(bs.cash + bs.inventoryValue);
    expect(bs.equity).toBe(bs.assets - bs.debt);
    expect(bs.cash).toBe(game.state.economy.balanceCents);
  });
});

describe('Proaktive Lagerhelfer-Anlieferung', () => {
  it('Lagerhelfer liefert schon vor der Reparatur (ready_for_repair)', () => {
    const game = Game.new(2402);
    stockEverything(game);
    addWorker(game, 'warehouse', 0.7);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.status === 'repairing', 3 * 1440);
    const mech = game.state.workers.find((w) => w.id === offer.crewIds[0])!;
    // Mechaniker holt nicht selbst – Lagerhelfer liefert (proaktiv), Mechaniker wartet/an der Bühne
    expect(mech.task!.phase).not.toBe('to_storage');
    const helper = game.state.workers.find((w) => w.role === 'warehouse')!;
    expect(offer.partsAtBay || helper.task?.kind === 'deliver').toBe(true);
    // Teile kommen an, ohne dass der Mechaniker zum Lager läuft
    runUntil(game, () => offer.partsAtBay, 2 * 1440);
    expect(offer.partsAtBay).toBe(true);
  });

  it('Mechaniker startet ohne Lagergang wenn Teile schon an der Bühne', () => {
    const game = Game.new(2403);
    stockEverything(game);
    addWorker(game, 'warehouse', 0.9);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.partsAtBay, 3 * 1440);
    expect(offer.partsAtBay).toBe(true);
    runUntil(game, () => offer.status === 'repairing', 1440);
    const mech = game.state.workers.find((w) => w.id === offer.crewIds[0])!;
    expect(mech.task!.phase).not.toBe('to_storage');
  });
});
