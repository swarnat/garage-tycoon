import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { OrderSystem } from '../src/simulation/OrderSystem';
import { SupplierSystem } from '../src/simulation/SupplierSystem';
import { validateState } from '../src/persistence/SaveValidation';
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
  const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
  v.modelId = 'ford_transit';
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

describe('#1 Unterbrochener Lagertransport', () => {
  it('Lagerhelfer nach Abholung entlassen -> Auftrag wird trotzdem fertig', () => {
    const game = Game.new(2200);
    stockEverything(game);
    const helper = addWorker(game, 'warehouse', 0.7);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.status === 'repairing' && !!helper.task, 1440);
    // warten bis Teile abgeholt (partsConsumed), aber noch nicht an der Bühne
    runUntil(game, () => offer.partsConsumed === true && !offer.partsAtBay, 1440);
    expect(offer.partsConsumed).toBe(true);
    game.fireWorker(helper.id);
    runUntil(game, () => offer.status === 'completed' || offer.status === 'delivered', 4 * 1440);
    expect(['completed', 'delivered']).toContain(offer.status);
  });

  it('Storno während Transport beschädigt keine fremde Reservierung', () => {
    const game = Game.new(2201);
    stockEverything(game);
    addWorker(game, 'warehouse', 0.7);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.partsConsumed === true && !offer.partsAtBay, 2 * 1440);
    const partId = offer.partsNeeded[0]!.partId;
    const reservedBefore = game.state.inventory.reserved[partId] ?? 0;
    OrderSystem.cancelOrder(game.ctx, offer, 'Test');
    const reservedAfter = game.state.inventory.reserved[partId] ?? 0;
    expect(reservedAfter).toBeGreaterThanOrEqual(0);
    expect(reservedAfter).toBe(reservedBefore);
  });
});

describe('#2 Kunden-Cleanup lässt Archiv nicht verweisen', () => {
  it('viele Kunden + Archivaufträge -> Spielstand bleibt valide', () => {
    const game = Game.new(2202);
    for (let i = 0; i < 130; i++) {
      game.state.nextOrderAttemptAtMinute = 0;
      game.state.totalMinutes = 600;
      const o = game.generateOffer()!;
      game.declineOrder(o.id);
    }
    // Archiv + Kunden bereinigen lassen
    game.state.totalMinutes = 600;
    OrderSystem.update(game.ctx);
    expect(() => validateState(game.state)).not.toThrow();
  });
});

describe('#3 Lieferungen: bezahlte offene bleiben, Kapazität zählt Transit', () => {
  it('Pruning löscht keine offene Lieferung', () => {
    const game = Game.new(2203);
    game.state.inventory.capacity = 5000;
    for (let i = 0; i < 45; i++) {
      game.state.deliveries.push({
        id: `d${i}`, partId: 'brake_pads__M__standard', quantity: 1, supplierId: 'teileprofi',
        orderedAtMinute: 0, arriveAtMinute: 100000, costCents: 100, done: false,
      });
    }
    for (let i = 0; i < 25; i++) {
      game.state.deliveries.push({
        id: `done${i}`, partId: 'brake_pads__M__standard', quantity: 1, supplierId: 'teileprofi',
        orderedAtMinute: 0, arriveAtMinute: 0, costCents: 100, done: true,
      });
    }
    SupplierSystem.update(game.ctx);
    const open = game.state.deliveries.filter((d) => !d.done).length;
    expect(open).toBe(45);
  });

  it('Kapazitätsprüfung zählt offene Lieferungen mit', () => {
    const game = Game.new(2204);
    const inv = game.state.inventory;
    inv.capacity = 10;
    for (const k of Object.keys(inv.stock)) inv.stock[k] = 0;
    inv.stock['brake_pads__M__standard'] = 5;
    expect(SupplierSystem.orderParts(game.ctx, 'brake_pads__M__standard', 5, 'teileprofi', false)).toBe(true);
    // 5 Bestand + 5 unterwegs = voll -> weitere 5 müssen abgelehnt werden
    expect(SupplierSystem.orderParts(game.ctx, 'brake_pads__M__standard', 5, 'teileprofi', false)).toBe(false);
  });
});

describe('#6 Fehlende Teile: keine Doppelbestellung', () => {
  it('offene Lieferung wird beim Bedarf angerechnet', () => {
    const game = Game.new(2205);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.status === 'waiting_for_parts', 2 * 1440);
    const partId = offer.partsNeeded[0]!.partId;
    game.state.inventory.stock[partId] = 0;
    game.state.inventory.reserved[partId] = 0;
    game.state.economy.balanceCents = 100_000_000;
    expect(game.orderMissingParts(offer.id, 'teileprofi')).toBe(true);
    const deliveriesAfterFirst = game.state.deliveries.filter((d) => d.partId === partId && !d.done).length;
    game.orderMissingParts(offer.id, 'teileprofi');
    const deliveriesAfterSecond = game.state.deliveries.filter((d) => d.partId === partId && !d.done).length;
    expect(deliveriesAfterSecond).toBe(deliveriesAfterFirst);
  });
});

describe('#5 Migration: ready_for_repair + at_lift heilt sich', () => {
  it('Auftrag wechselt zu repairing statt die Bühne zu blockieren', () => {
    const game = Game.new(2206);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.status === 'ready_for_repair', 2 * 1440);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    // Migrationszustand erzwingen: Fahrzeug schon an der Bühne, Pfad leer,
    // Auftrag noch ready_for_repair (genau der v8->v9-Fall)
    const lift = game.state.stations.find((s) => s.kind === 'lift' && s.unlocked)!;
    lift.orderId = offer.id;
    offer.stationId = lift.id;
    v.state = 'at_lift';
    v.targetStationId = lift.id;
    v.path = [];
    offer.status = 'ready_for_repair';
    OrderSystem.update(game.ctx);
    expect(offer.status).toBe('repairing');
  });
});

describe('Assistent krank meldet nichts', () => {
  it('sickUntilMinute blockiert den Scan', () => {
    const game = Game.new(2207);
    const assist = addWorker(game, 'assistant', 0.4);
    assist.sickUntilMinute = game.state.totalMinutes + 500;
    const vid = 'brake_pads__M__standard';
    game.state.marketPriceFactors[vid] = 0.86;
    game.state.inventory.minStock[vid] = 2;
    game.state.assistantNextScanAtMinute = 0;
    game.tick(5);
    expect(game.state.notifications.some((n) => n.text.includes('Assistent'))).toBe(false);
  });
});

describe('#7 RNG-Sync beim Speichern', () => {
  it('syncRngState übernimmt den laufenden RNG-Zustand', () => {
    const game = Game.new(2208);
    game.refreshCandidates();
    const live = game.rng.state;
    expect(game.state.rngState).not.toBe(live);
    game.syncRngState();
    expect(game.state.rngState).toBe(live);
  });
});
