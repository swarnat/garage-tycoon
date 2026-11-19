import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { OrderSystem } from '../src/simulation/OrderSystem';
import { InventorySystem } from '../src/simulation/InventorySystem';
import { RepairSystem } from '../src/simulation/RepairSystem';
import { EconomySystem } from '../src/simulation/EconomySystem';
import type { GameState, RepairOrder } from '../src/entities/types';

function stockEverything(state: GameState, qty = 20): void {
  for (const key of Object.keys(state.inventory.stock)) {
    state.inventory.stock[key] = qty;
  }
}

/** Spielt einen Auftrag komplett durch (Teile auf Lager vorausgesetzt). */
function playUntilDelivered(game: Game, orderId: string, maxDays = 6): RepairOrder {
  const order = game.state.orders.find((o) => o.id === orderId)!;
  const limit = game.state.totalMinutes + maxDays * 1440;
  while (
    game.state.totalMinutes < limit &&
    order.status !== 'delivered' &&
    order.status !== 'cancelled'
  ) {
    game.tick(15);
  }
  return order;
}

describe('Auftragsstatus', () => {
  it('erlaubt nur definierte Statusübergänge', () => {
    expect(OrderSystem.canTransition('incoming', 'accepted')).toBe(true);
    expect(OrderSystem.canTransition('accepted', 'waiting_for_diagnosis')).toBe(true);
    expect(OrderSystem.canTransition('repairing', 'quality_check')).toBe(true);
    expect(OrderSystem.canTransition('quality_check', 'completed')).toBe(true);
    expect(OrderSystem.canTransition('completed', 'delivered')).toBe(true);
    expect(OrderSystem.canTransition('incoming', 'repairing')).toBe(false);
    expect(OrderSystem.canTransition('delivered', 'repairing')).toBe(false);
    expect(OrderSystem.canTransition('completed', 'repairing')).toBe(false);
  });

  it('wirft bei ungültigem Übergang', () => {
    const game = Game.new(1);
    const offer = game.generateOffer()!;
    expect(() => OrderSystem.setStatus(game.state, offer, 'repairing')).toThrow();
  });

  it('protokolliert Statuswechsel', () => {
    const game = Game.new(1);
    const offer = game.generateOffer()!;
    game.acceptOrder(offer.id);
    expect(offer.status).toBe('accepted');
    expect(offer.statusLog.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Auftragsannahme', () => {
  it('erzeugt Angebot mit Fahrzeug, Kunde und versteckten Defekten', () => {
    const game = Game.new(7);
    const offer = game.generateOffer()!;
    expect(offer.status).toBe('incoming');
    expect(offer.defectRepairIds.length).toBeGreaterThan(0);
    expect(offer.revealed).toBe(false);
    expect(offer.complaint.length).toBeGreaterThan(0);
    const vehicle = game.state.vehicles.find((v) => v.id === offer.vehicleId);
    expect(vehicle).toBeDefined();
    expect(game.state.customers.some((c) => c.id === offer.customerId)).toBe(true);
  });

  it('lehnt Annahme ab, wenn kein Platz frei ist', () => {
    const game = Game.new(7);
    for (const s of game.state.stations) {
      if (s.kind === 'diagnosis' || s.kind === 'parking') s.orderId = 'blocker';
    }
    const offer = game.generateOffer()!;
    expect(game.acceptOrder(offer.id)).toBe(false);
    expect(offer.status).toBe('incoming');
  });

  it('Ablehnen entfernt den Auftrag ohne Kosten', () => {
    const game = Game.new(7);
    const offer = game.generateOffer()!;
    const balance = game.state.economy.balanceCents;
    game.declineOrder(offer.id);
    expect(offer.status).toBe('cancelled');
    expect(game.state.economy.balanceCents).toBe(balance);
  });
});

describe('Lager & Reservierungen', () => {
  it('reserviert nur, was verfügbar ist (alles oder nichts)', () => {
    const game = Game.new(3);
    const inv = game.state.inventory;
    inv.stock['brake_pads'] = 1;
    inv.reserved['brake_pads'] = 0;
    const ok = InventorySystem.reserve(inv, [{ partId: 'brake_pads', quantity: 1 }]);
    expect(ok).toBe(true);
    const again = InventorySystem.reserve(inv, [{ partId: 'brake_pads', quantity: 1 }]);
    expect(again).toBe(false);
    expect(inv.reserved['brake_pads']).toBe(1);
  });

  it('gibt bei Fehlschlag keine Teilreservierung zurück', () => {
    const game = Game.new(3);
    const inv = game.state.inventory;
    inv.stock['brake_pads'] = 5;
    inv.stock['battery'] = 0;
    const ok = InventorySystem.reserve(inv, [
      { partId: 'brake_pads', quantity: 2 },
      { partId: 'battery', quantity: 1 },
    ]);
    expect(ok).toBe(false);
    expect(inv.reserved['brake_pads'] ?? 0).toBe(0);
  });

  it('verbraucht reservierte Teile genau einmal', () => {
    const game = Game.new(3);
    const inv = game.state.inventory;
    inv.stock['brake_pads'] = 3;
    InventorySystem.reserve(inv, [{ partId: 'brake_pads', quantity: 2 }]);
    InventorySystem.consumeReserved(inv, [{ partId: 'brake_pads', quantity: 2 }]);
    expect(inv.stock['brake_pads']).toBe(1);
    expect(inv.reserved['brake_pads']).toBe(0);
    expect(() =>
      InventorySystem.consumeReserved(inv, [{ partId: 'brake_pads', quantity: 2 }]),
    ).toThrow();
  });
});

describe('Bestellungen & Lieferungen', () => {
  it('bucht Einkaufskosten sofort und liefert nach Lieferzeit', () => {
    const game = Game.new(5);
    const before = game.state.economy.balanceCents;
    const stockBefore = game.state.inventory.stock['battery'] ?? 0;
    expect(game.orderParts('battery', 2, 'teileprofi')).toBe(true);
    expect(game.state.economy.balanceCents).toBeLessThan(before);
    expect(game.state.deliveries).toHaveLength(1);
    game.tick(479);
    expect(game.state.inventory.stock['battery']).toBe(stockBefore);
    game.tick(2);
    expect(game.state.inventory.stock['battery']).toBe(stockBefore + 2);
    expect(game.state.deliveries[0]!.done).toBe(true);
  });

  it('Expresslieferung ist schneller und teurer', () => {
    const game = Game.new(5);
    game.orderParts('battery', 1, 'teileprofi');
    game.orderParts('battery', 1, 'expressparts');
    const [std, exp] = game.state.deliveries;
    expect(exp!.arriveAtMinute).toBeLessThan(std!.arriveAtMinute);
    expect(exp!.costCents).toBeGreaterThan(std!.costCents);
  });

  it('kann keine Bestellung bei fehlendem Geld auslösen', () => {
    const game = Game.new(5);
    game.state.economy.balanceCents = 100;
    expect(game.orderParts('alternator', 5, 'teileprofi')).toBe(false);
    expect(game.state.deliveries).toHaveLength(0);
  });
});

describe('Reparaturlogik', () => {
  it('Arbeitszeitfaktor sinkt mit Qualifikation', () => {
    expect(RepairSystem.durationFactor(0)).toBeGreaterThan(RepairSystem.durationFactor(50));
    expect(RepairSystem.durationFactor(50)).toBeGreaterThan(RepairSystem.durationFactor(100));
    expect(RepairSystem.durationFactor(50)).toBeCloseTo(1.0);
  });

  it('Reparaturarbeit beginnt erst, wenn Teile am Arbeitsplatz sind', () => {
    const game = Game.new(9);
    stockEverything(game.state);
    const offer = game.generateOffer()!;
    offer.budgetCents = 5_000_000;
    game.acceptOrder(offer.id);
    const limit = game.state.totalMinutes + 3 * 1440;
    while (game.state.totalMinutes < limit && offer.laborMinutesActual <= 0) {
      game.tick(15);
      if (offer.status === 'cancelled') break;
    }
    expect(offer.laborMinutesActual).toBeGreaterThan(0);
    expect(offer.partsAtBay).toBe(true);
    expect(offer.partsReserved).toBe(true);
  });
});

describe('Mitarbeiter & Arbeitsplätze', () => {
  it('ein Mitarbeiter hat höchstens eine Aufgabe, ein Platz höchstens einen Auftrag', () => {
    const game = Game.new(11);
    stockEverything(game.state);
    for (let i = 0; i < 4; i++) {
      const o = game.generateOffer();
      if (o) game.acceptOrder(o.id);
    }
    for (let i = 0; i < 200; i++) {
      game.tick(10);
      for (const w of game.state.workers) {
        const tasks = w.task ? 1 : 0;
        expect(tasks).toBeLessThanOrEqual(1);
      }
      const assigned = game.state.orders.filter((o) => o.assignedWorkerId);
      const workerIds = assigned.map((o) => o.assignedWorkerId);
      expect(new Set(workerIds).size).toBe(workerIds.length);
      for (const s of game.state.stations) {
        const orders = game.state.orders.filter((o) => o.stationId === s.id);
        expect(orders.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('Mitarbeiter arbeiten nicht außerhalb ihrer Schicht (neue Aufgaben)', () => {
    const game = Game.new(13);
    game.state.totalMinutes = 22 * 60; // 22:00
    stockEverything(game.state);
    const o = game.generateOffer();
    if (o) game.acceptOrder(o.id);
    game.tick(60);
    for (const w of game.state.workers) {
      expect(w.task).toBeNull();
      expect(w.state).toBe('off_duty');
    }
  });
});

describe('Spielzeit & Determinismus', () => {
  it('Ergebnis ist unabhängig von der Tick-Stückelung (FPS-Unabhängigkeit)', () => {
    const a = Game.new(21);
    const b = Game.new(21);
    stockEverything(a.state);
    stockEverything(b.state);
    const oa = a.generateOffer()!;
    const ob = b.generateOffer()!;
    a.acceptOrder(oa.id);
    b.acceptOrder(ob.id);
    a.tick(600);
    for (let i = 0; i < 2400; i++) b.tick(0.25);
    expect(a.state.totalMinutes).toBe(b.state.totalMinutes);
    expect(a.state.economy.balanceCents).toBe(b.state.economy.balanceCents);
    expect(a.state.orders.map((o) => o.status)).toEqual(b.state.orders.map((o) => o.status));
    expect(a.state.workers.map((w) => w.state)).toEqual(b.state.workers.map((w) => w.state));
  });

  it('gleicher Seed erzeugt gleiche Angebote', () => {
    const a = Game.new(99);
    const b = Game.new(99);
    const oa = a.generateOffer()!;
    const ob = b.generateOffer()!;
    expect(oa.defectRepairIds).toEqual(ob.defectRepairIds);
    expect(oa.budgetCents).toBe(ob.budgetCents);
  });
});

describe('Vertikaler Gameplay-Durchlauf (Definition of Done)', () => {
  it('Diagnose → Freigabe → Reparatur → QC → Abrechnung → Auslieferung', () => {
    const game = Game.new(42);
    stockEverything(game.state);
    const offer = game.generateOffer()!;
    expect(game.acceptOrder(offer.id)).toBe(true);
    offer.budgetCents = 5_000_000; // Freigabe für den Loop-Test sicherstellen
    const balanceBefore = game.state.economy.balanceCents;
    const result = playUntilDelivered(game, offer.id);
    expect(result.status).toBe('delivered');
    expect(result.revealed).toBe(true);
    expect(result.billed).toBe(true);
    expect(result.invoiceCents).not.toBeNull();
    expect(result.invoiceCents!).toBeGreaterThan(0);
    expect(result.satisfaction).not.toBeNull();
    // Rechnung genau einmal gebucht
    const invoiceTx = game.state.economy.transactions.filter(
      (t) => t.id === `invoice-${offer.id}`,
    );
    expect(invoiceTx).toHaveLength(1);
    // Doppelbuchung wird abgewiesen
    expect(
      EconomySystem.book(game.state.economy, {
        id: `invoice-${offer.id}`,
        day: 1,
        atMinute: 0,
        amountCents: 999999,
        category: 'revenue',
        label: 'doppelt',
      }),
    ).toBe(false);
    expect(game.state.economy.balanceCents).toBeGreaterThan(balanceBefore);
    expect(game.state.statistics.ordersCompleted).toBe(1);
    // Fahrzeug hat die Werkstatt verlassen, Platz ist frei
    const vehicle = game.state.vehicles.find((v) => v.id === offer.vehicleId)!;
    expect(vehicle.state).toBe('gone');
    expect(game.state.stations.every((s) => s.orderId !== offer.id)).toBe(true);
    // Mitarbeiter haben gearbeitet
    expect(game.state.workers.some((w) => w.workedMinutes > 0)).toBe(true);
  });

  it('Auftrag mit fehlenden Teilen wartet auf Lieferung und wird dann fertig', () => {
    const game = Game.new(42);
    const offer = game.generateOffer()!;
    // Lager leeren, bevor reserviert werden kann
    for (const k of Object.keys(game.state.inventory.stock)) {
      game.state.inventory.stock[k] = 0;
    }
    game.acceptOrder(offer.id);
    offer.budgetCents = 5_000_000;
    // Defekte aufdecken lassen (Diagnose läuft auch ohne Teile)
    for (let i = 0; i < 100 && !offer.revealed; i++) game.tick(15);
    expect(offer.revealed).toBe(true);
    for (let i = 0; i < 40 && offer.status !== 'waiting_for_parts'; i++) game.tick(15);
    expect(offer.status).toBe('waiting_for_parts');
    // Alles bestellen
    for (const need of offer.partsNeeded) {
      expect(game.orderParts(need.partId, need.quantity, 'expressparts')).toBe(true);
    }
    const result = playUntilDelivered(game, offer.id);
    expect(result.status).toBe('delivered');
  });

  it('mehrere Aufträge laufen parallel durch', () => {
    const game = Game.new(77);
    stockEverything(game.state);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = game.generateOffer();
      if (o && game.acceptOrder(o.id)) {
        o.budgetCents = 5_000_000;
        ids.push(o.id);
      }
    }
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const limit = game.state.totalMinutes + 6 * 1440;
    while (game.state.totalMinutes < limit) {
      game.tick(30);
      const allDone = ids.every((id) => {
        const o = game.state.orders.find((x) => x.id === id)!;
        return o.status === 'delivered' || o.status === 'cancelled';
      });
      if (allDone) break;
    }
    const delivered = ids.filter(
      (id) => game.state.orders.find((x) => x.id === id)!.status === 'delivered',
    );
    expect(delivered.length).toBeGreaterThanOrEqual(2);
  });

  it('Kunde lehnt Kostenvoranschlag über Budget ab', () => {
    const game = Game.new(42);
    stockEverything(game.state);
    const offer = game.generateOffer()!;
    offer.budgetCents = 1; // unerfüllbar
    game.acceptOrder(offer.id);
    for (let i = 0; i < 100 && offer.status !== 'cancelled'; i++) game.tick(15);
    expect(offer.status).toBe('cancelled');
    expect(offer.billed).toBe(false);
  });
});
