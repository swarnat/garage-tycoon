import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { OrderSystem } from '../src/simulation/OrderSystem';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) game.state.inventory.stock[k] = qty;
}

function accept(game: Game, defectId = 'replace_brake_pads') {
  let offer = game.generateOffer();
  if (!offer) {
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    offer = game.generateOffer()!;
  }
  offer.defectRepairIds = [defectId];
  offer.budgetCents = 5_000_000;
  game.acceptOrder(offer.id);
  return offer;
}

function runUntil(game: Game, pred: () => boolean, maxMinutes = 8 * 1440): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !pred()) game.tick(5);
}

function freeParks(game: Game): number {
  return game.state.stations.filter((s) => s.kind === 'parking' && s.unlocked && s.orderId === null).length;
}

describe('Parkplatz-Belegung wird korrekt freigegeben (Bugfix)', () => {
  it('Parkplatz wird frei, wenn das Fahrzeug zur Hebebühne fährt', () => {
    const game = Game.new(1400);
    stockEverything(game);
    game.state.inventory.capacity = 5000;
    game.state.inventory.stock['brake_caliper__M__standard'] = 0;
    game.state.inventory.minStock['brake_caliper__M__standard'] = 0;
    game.state.inventory.autoReorder['brake_caliper__M__standard'] = false;
    const offer = accept(game, 'replace_brake_caliper');
    const vFix = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    vFix.modelId = 'vw_golf';
    const cFix = game.state.customers.find((c) => c.id === offer.customerId)!;
    cFix.profile = 'regular';
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    runUntil(game, () => v.state === 'waiting', 240);
    const parkedAt = v.targetStationId!;
    expect(game.state.stations.find((s) => s.id === parkedAt)!.orderId).toBe(offer.id);
    // Teile liefern → Reparatur beginnt → Parkplatz muss frei sein
    game.orderParts('brake_caliper__M__standard', 1, 'expressparts');
    runUntil(game, () => offer.status === 'repairing' && v.state === 'at_lift');
    expect(game.state.stations.find((s) => s.id === parkedAt)!.orderId).toBeNull();
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.status).toBe('delivered');
  });

  it('Stornierung gibt den Parkplatz frei', () => {
    const game = Game.new(1401);
    stockEverything(game);
    game.state.inventory.capacity = 5000;
    game.state.inventory.stock['brake_caliper__M__standard'] = 0;
    game.state.inventory.minStock['brake_caliper__M__standard'] = 0;
    game.state.inventory.autoReorder['brake_caliper__M__standard'] = false;
    const offer = accept(game, 'replace_brake_caliper');
    const vFix = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    vFix.modelId = 'vw_golf';
    const cFix = game.state.customers.find((c) => c.id === offer.customerId)!;
    cFix.profile = 'regular';
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    runUntil(game, () => v.state === 'waiting', 240);
    const parkedAt = v.targetStationId!;
    const freeBefore = freeParks(game);
    OrderSystem.cancelOrder(game.ctx, offer, 'Test-Storno');
    expect(game.state.stations.find((s) => s.id === parkedAt)!.orderId).toBeNull();
    expect(freeParks(game)).toBe(freeBefore + 1);
  });

  it('verwaiste Belegung wird automatisch bereinigt (Selbstheilung)', () => {
    const game = Game.new(1402);
    const park = game.state.stations.find((s) => s.kind === 'parking' && s.unlocked)!;
    park.orderId = 'ghost-order';
    game.tick(5);
    expect(park.orderId).toBeNull();
  });

  it('zwei Teile-Warte-Aufträge hintereinander blockieren nicht alle Plätze', () => {
    const game = Game.new(1403);
    stockEverything(game);
    game.state.inventory.capacity = 5000;
    game.state.nextOrderAttemptAtMinute = 999999;
    for (let i = 0; i < 2; i++) {
      game.state.inventory.stock['brake_caliper__M__standard'] = 0;
      const offer = accept(game, 'replace_brake_caliper');
      const vFix = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
      vFix.modelId = 'vw_golf';
      const cFix = game.state.customers.find((c) => c.id === offer.customerId)!;
      cFix.profile = 'regular';
      runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
      game.orderParts('brake_caliper__M__standard', 1, 'expressparts');
      runUntil(game, () => offer.status === 'delivered');
      expect(offer.status).toBe('delivered');
    }
    // Alle 3 Start-Parkplätze müssen wieder frei sein
    expect(freeParks(game)).toBe(3);
  });
});
