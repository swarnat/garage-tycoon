import { describe, expect, it } from 'vitest';
import { Game, createNewGame } from '../src/core/Game';
import { InventorySystem } from '../src/simulation/InventorySystem';
import { migrate } from '../src/persistence/SaveMigration';

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

describe('Verbrauchsstatistik im Lager (24h / 48h)', () => {
  it('Teileverbrauch wird mit Zeitstempel protokolliert', () => {
    const game = Game.new(1300);
    stockEverything(game);
    const offer = accept(game);
    const vFix = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    vFix.modelId = 'vw_golf';
    const cFix = game.state.customers.find((c) => c.id === offer.customerId)!;
    cFix.profile = 'regular';
    runUntil(game, () => offer.partsAtBay, 1440);
    const log = game.state.inventory.usageLog;
    expect(log.length).toBeGreaterThan(0);
    const pads = log.filter((u) => u.partId === 'brake_pads__M__standard');
    expect(pads.length).toBe(1);
    expect(pads[0]!.quantity).toBe(1);
    expect(pads[0]!.atMinute).toBeLessThanOrEqual(game.state.totalMinutes);
  });

  it('usageWithin zählt korrekt im 24h/48h-Fenster', () => {
    const inv = createNewGame(1301).inventory;
    inv.usageLog = [
      { partId: 'battery__60__standard', quantity: 2, atMinute: 1000 },
      { partId: 'battery__60__standard', quantity: 1, atMinute: 100 },
      { partId: 'battery__60__standard', quantity: 5, atMinute: 10 },
      { partId: 'oil_filter__M__standard', quantity: 3, atMinute: 900 },
    ];
    const now = 1500;
    expect(InventorySystem.usageWithin(inv, 'battery__60__standard', 1440, now)).toBe(3); // 2 + 1
    expect(InventorySystem.usageWithin(inv, 'battery__60__standard', 2880, now)).toBe(8); // alle
    expect(InventorySystem.usageWithin(inv, 'oil_filter__M__standard', 1440, now)).toBe(3);
    expect(InventorySystem.usageWithin(inv, 'muffler__M__standard', 2880, now)).toBe(0);
  });

  it('altes Protokoll wird nach 48h entfernt', () => {
    const game = Game.new(1302);
    game.state.inventory.usageLog = [
      { partId: 'battery__60__standard', quantity: 1, atMinute: 0 },
      { partId: 'battery__60__standard', quantity: 1, atMinute: 2000 },
    ];
    game.state.totalMinutes = 5000;
    game.tick(5);
    const log = game.state.inventory.usageLog;
    expect(log.every((u) => u.atMinute >= 5000 - 2880)).toBe(true);
    expect(log.some((u) => u.atMinute === 0)).toBe(false);
  });

  it('Neues Spiel hat leeres Protokoll', () => {
    expect(createNewGame(1303).inventory.usageLog).toEqual([]);
  });
});

describe('Save-Migration v9 → v10', () => {
  it('ergänzt usageLog', () => {
    const game = Game.new(1310);
    const raw = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    raw.version = 9;
    delete (raw.inventory as Record<string, unknown>).usageLog;
    const migrated = migrate(raw);
    expect(migrated.version).toBe(12);
    expect((migrated.inventory as Record<string, unknown>).usageLog).toEqual([]);
  });
});
