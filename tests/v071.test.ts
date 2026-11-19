import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { InventorySystem } from '../src/simulation/InventorySystem';
import { OrderSystem } from '../src/simulation/OrderSystem';
import { EconomySystem } from '../src/simulation/EconomySystem';

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
  const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
  v.modelId = 'ford_transit';
  const c = game.state.customers.find((x) => x.id === offer.customerId)!;
  c.profile = 'regular';
  return offer;
}

function runUntil(game: Game, pred: () => boolean, maxMinutes = 8 * 1440): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !pred()) game.tick(5);
}

describe('Lager-Sichtbarkeitsregel', () => {
  it('0/0/0 ohne Pin und Bestellung ist ausgeblendet', () => {
    const game = Game.new(1600);
    const inv = game.state.inventory;
    const vid = 'muffler__L__standard';
    inv.stock[vid] = 0;
    inv.minStock[vid] = 0;
    expect(InventorySystem.isVisible(inv, vid, [], '', false, 'Auspuff groß')).toBe(false);
    inv.stock[vid] = 1;
    expect(InventorySystem.isVisible(inv, vid, [], '', false, 'Auspuff groß')).toBe(true);
    inv.stock[vid] = 0;
    inv.minStock[vid] = 1;
    expect(InventorySystem.isVisible(inv, vid, [], '', false, 'Auspuff groß')).toBe(true);
    inv.minStock[vid] = 0;
    expect(InventorySystem.isVisible(inv, vid, [{ partId: vid, done: false }], '', false, 'Auspuff groß')).toBe(true);
    expect(InventorySystem.isVisible(inv, vid, [], '', false, 'Auspuff groß')).toBe(false);
    inv.pinned[vid] = true;
    expect(InventorySystem.isVisible(inv, vid, [], '', false, 'Auspuff groß')).toBe(true);
    inv.pinned[vid] = false;
    expect(InventorySystem.isVisible(inv, vid, [], ' auspuff ', false, 'Auspuff groß')).toBe(true);
    expect(InventorySystem.isVisible(inv, vid, [], '', true, 'Auspuff groß')).toBe(true);
  });

  it('pinVariant toggelt den Pin', () => {
    const game = Game.new(1601);
    game.pinVariant('battery__80__premium');
    expect(game.state.inventory.pinned['battery__80__premium']).toBe(true);
    game.pinVariant('battery__80__premium');
    expect(game.state.inventory.pinned['battery__80__premium']).toBe(false);
  });
});

describe('Ladenhüter-Verkauf', () => {
  it('verkauft nur unreserved Bestand zu 60 % Marktpreis', () => {
    const game = Game.new(1610);
    const vid = 'battery__80__premium';
    game.state.inventory.stock[vid] = 5;
    game.state.inventory.reserved[vid] = 2;
    const part = game.defs.parts.find((p) => p.id === vid)!;
    const expected = Math.round(EconomySystem.marketBuyCents(game.state, part) * 0.6) * 3;
    const balanceBefore = game.state.economy.balanceCents;
    expect(game.sellVariant(vid)).toBe(true);
    expect(game.state.inventory.stock[vid]).toBe(2);
    expect(game.state.inventory.reserved[vid]).toBe(2);
    expect(game.state.economy.balanceCents).toBe(balanceBefore + expected);
    expect(game.state.economy.transactions.some((t) => t.label.includes('Lagerverkauf'))).toBe(true);
    // Jetzt ist alles reserviert → kein Verkauf möglich
    expect(game.sellVariant(vid)).toBe(false);
  });
});

describe('Letzte Bestellung', () => {
  it('orderParts setzt lastOrdered', () => {
    const game = Game.new(1620);
    game.state.inventory.capacity = 5000;
    game.state.economy.balanceCents = 100_000_000;
    const vid = 'tires__18__premium';
    expect(game.state.inventory.lastOrdered[vid]).toBeUndefined();
    game.orderParts(vid, 2, 'teileprofi');
    expect(game.state.inventory.lastOrdered[vid]).toBe(game.state.totalMinutes);
  });
});

describe('Reifen & Felgen mit Montagemaschine', () => {
  it('Reifenwechsel braucht 4 passende Reifen und die Maschine', () => {
    const game = Game.new(1630);
    stockEverything(game);
    game.state.economy.balanceCents = 100_000_000;
    const offer = accept(game, 'tire_change');
    runUntil(game, () => offer.revealed, 1440);
    const need = offer.partsNeeded.find((n) => n.partId.startsWith('tires'))!;
    expect(need.quantity).toBe(4);
    expect(need.partId).toBe('tires__16C__standard'); // Transporter-Größe
    runUntil(game, () => offer.status === 'ready_for_repair' || offer.status === 'repairing', 1440);
    // Ohne Maschine wartet der Auftrag mit Werkzeug-Hinweis
    const reason = OrderSystem.waitReason(game.ctx, offer);
    expect(reason).toContain('Spezialwerkzeug');
    expect(game.buyTool('tire_machine')).toBe(true);
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.status).toBe('delivered');
    const used = game.state.inventory.usageLog.filter((u) => u.partId === 'tires__16C__standard');
    expect(used.reduce((a, u) => a + u.quantity, 0)).toBe(4);
  });

  it('Felgenwechsel nutzt die Maschine und eine Felgen-Variante', () => {
    const game = Game.new(1631);
    stockEverything(game);
    game.state.economy.balanceCents = 100_000_000;
    game.buyTool('tire_machine');
    const offer = accept(game, 'rim_replace');
    runUntil(game, () => offer.revealed, 1440);
    const need = offer.partsNeeded.find((n) => n.partId.startsWith('rims'))!;
    expect(need.partId).toBe('rims__16C__standard');
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.status).toBe('delivered');
  });
});
