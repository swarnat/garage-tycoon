import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { InventorySystem } from '../src/simulation/InventorySystem';

describe('Start-Grundsortiment', () => {
  it('alle Standard-Varianten starten mit Bestand >= 1 und Min >= 1', () => {
    const game = Game.new(2300);
    const standard = game.defs.parts.filter((p) => p.quality === 'standard');
    expect(standard.length).toBeGreaterThan(50);
    for (const p of standard) {
      expect(game.state.inventory.stock[p.id]).toBeGreaterThanOrEqual(1);
      expect(game.state.inventory.minStock[p.id]).toBeGreaterThanOrEqual(1);
    }
  });

  it('Auto-Nachbestellung bleibt standardmäßig AUS', () => {
    const game = Game.new(2301);
    expect(Object.values(game.state.inventory.autoReorder).every((v) => !v)).toBe(true);
  });
});

describe('Verbrauchte Mengen nachbestellen', () => {
  it('bestellt die 48h-Verbrauchsmengen gesammelt mit einer Meldung', () => {
    const game = Game.new(2302);
    const inv = game.state.inventory;
    inv.capacity = 5000;
    game.state.economy.balanceCents = 100_000_000;
    const a = 'brake_pads__M__standard';
    const b = 'oil_filter__M__standard';
    inv.stock[a] = 0; inv.reserved[a] = 0;
    inv.stock[b] = 0; inv.reserved[b] = 0;
    inv.usageLog.push({ partId: a, quantity: 3, atMinute: game.state.totalMinutes - 60 });
    inv.usageLog.push({ partId: b, quantity: 2, atMinute: game.state.totalMinutes - 120 });
    const notifBefore = game.state.notifications.length;
    const res = game.restockConsumed();
    expect(res.count).toBeGreaterThanOrEqual(2);
    const da = game.state.deliveries.find((d) => d.partId === a && !d.done);
    const db = game.state.deliveries.find((d) => d.partId === b && !d.done);
    expect(da?.quantity).toBe(3);
    expect(db?.quantity).toBe(2);
    const summary = game.state.notifications.slice(notifBefore).filter((n) => n.text.includes('Verbrauchte Mengen'));
    expect(summary.length).toBe(1);
  });

  it('zieht offene Lieferungen ab (keine Doppelbestellung)', () => {
    const game = Game.new(2303);
    const inv = game.state.inventory;
    inv.capacity = 5000;
    game.state.economy.balanceCents = 100_000_000;
    const a = 'brake_pads__M__standard';
    inv.stock[a] = 0;
    inv.usageLog.push({ partId: a, quantity: 3, atMinute: game.state.totalMinutes - 60 });
    game.restockConsumed();
    const open1 = InventorySystem.openIncoming(game.state.deliveries, a);
    game.restockConsumed();
    const open2 = InventorySystem.openIncoming(game.state.deliveries, a);
    expect(open2).toBe(open1);
  });
});

describe('Verbrauch-Filter (zentrale Sicht)', () => {
  it('listet nur Varianten mit Verbrauch, kategorienübergreifend', () => {
    const game = Game.new(2304);
    const inv = game.state.inventory;
    const a = 'brake_pads__M__standard';
    const b = 'motor_oil__5W30__standard';
    inv.usageLog.push({ partId: a, quantity: 1, atMinute: game.state.totalMinutes - 60 });
    inv.usageLog.push({ partId: b, quantity: 1, atMinute: game.state.totalMinutes - 60 });
    const ids = game.defs.parts.map((p) => p.id);
    const consumed = InventorySystem.consumedVariants(inv, ids, game.state.totalMinutes, 2880);
    expect(consumed).toContain(a);
    expect(consumed).toContain(b);
    expect(consumed.length).toBe(2);
  });
});

describe('Höherwertige Alternative gleiche Größe', () => {
  it('findet Premium gleiche Größe wenn Standard fehlt und Premium da ist', () => {
    const game = Game.new(2305);
    const inv = game.state.inventory;
    const std = 'brake_pads__M__standard';
    const prem = 'brake_pads__M__premium';
    inv.stock[std] = 0;
    inv.stock[prem] = 2;
    const sub = game.findSubstitute(std);
    expect(sub).toBe(prem);
  });

  it('keine Alternative wenn nichts Höherwertiges da ist', () => {
    const game = Game.new(2306);
    const inv = game.state.inventory;
    inv.stock['brake_pads__M__standard'] = 0;
    inv.stock['brake_pads__M__premium'] = 0;
    expect(game.findSubstitute('brake_pads__M__standard')).toBeNull();
  });

  it('useSubstitute tauscht die Variante im Auftrag', () => {
    const game = Game.new(2307);
    let offer = game.generateOffer()!;
    offer.defectRepairIds = ['replace_brake_pads'];
    offer.budgetCents = 5_000_000;
    game.acceptOrder(offer.id);
    game.state.vehicles.find((x) => x.id === offer.vehicleId)!.modelId = 'vw_golf';
    // Auftrag manuell in waiting_for_parts mit benötigter Standard-Variante
    const std = 'brake_pads__M__standard';
    const prem = 'brake_pads__M__premium';
    offer.partsNeeded = [{ partId: std, quantity: 1 }];
    offer.status = 'waiting_for_parts';
    game.state.inventory.stock[std] = 0;
    game.state.inventory.stock[prem] = 2;
    expect(game.useSubstitute(offer.id, std, prem)).toBe(true);
    expect(offer.partsNeeded[0]!.partId).toBe(prem);
  });
});
