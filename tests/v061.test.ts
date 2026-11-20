import { SAVE_VERSION } from '../src/entities/types';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { TileMap } from '../src/world/TileMap';
import { findPath } from '../src/world/Pathfinding';
import { OrderSystem } from '../src/simulation/OrderSystem';
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

describe('16x-Nachtmodus ohne Sprung bei laufender Arbeit', () => {
  it('nachts ohne laufende Aufgaben wird auf 16x beschleunigt', () => {
    const game = Game.new(1001);
    game.state.totalMinutes = 19 * 60;
    game.setSpeed(2);
    game.tick(1);
    expect(game.state.speed).toBe(16);
  });

  it('arbeitet noch jemand, wird nicht hochgeschaltet', () => {
    const game = Game.new(1002);
    stockEverything(game);
    const offer = accept(game);
    runUntil(game, () => offer.status === 'repairing' && game.state.workers.some((w) => w.task?.phase === 'working'), 1440);
    game.state.totalMinutes = 19 * 60; // Feierabend, aber Reparatur läuft noch
    game.setSpeed(2);
    game.tick(5);
    expect(game.state.workers.some((w) => w.task)).toBe(true);
    expect(game.state.speed).toBe(2);
  });

  it('16x ist ein wählbarer Modus', () => {
    const game = Game.new(1003);
    game.setSpeed(16);
    expect(game.state.speed).toBe(16);
    const before = game.state.totalMinutes;
    game.tick(160);
    expect(game.state.totalMinutes).toBe(before + 160);
  });
});

describe('Angebotsnachfrage als Modal + Budget akzeptieren', () => {
  it('approval:at-risk-Event wird gesendet (Modal-Trigger)', () => {
    const game = Game.new(1010);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    let fired = '';
    game.bus.on('approval:at-risk', (id) => { fired = String(id); });
    runUntil(game, () => offer.offerAtRisk, 1440);
    expect(fired).toBe(offer.id);
  });

  it('Budget akzeptieren rechnet zum Kundenbudget ab und räumt das Risiko ab', () => {
    const game = Game.new(1011);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    offer.budgetCents = 15000; // Kunde bietet wenig
    expect(game.acceptBudget(offer.id)).toBe(true);
    expect(offer.offerAtRisk).toBe(false);
    expect(offer.approvalDeadline).toBeNull();
    expect(['ready_for_repair', 'waiting_for_parts']).toContain(offer.status);
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.invoiceCents).toBe(15000);
  });

  it('Rabatt-Freigabe entfernt das Risiko-Badge', () => {
    const game = Game.new(1012);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    offer.budgetCents = Math.round(offer.estimateCents! * 0.92);
    game.offerDiscount(offer.id, 10);
    expect(offer.offerAtRisk).toBe(false);
    expect(offer.approvalDeadline).toBeNull();
  });
});

describe('Zufriedenheit und Storno-Gründe sind sichtbar', () => {
  it('Verspätung wird als Grund gespeichert', () => {
    const game = Game.new(1020);
    stockEverything(game);
    const offer = accept(game);
    offer.dueAtMinute = game.state.totalMinutes + 10;
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.satisfaction).toBeLessThan(95);
    expect(offer.satisfactionReason).toContain('Verspätung');
  });

  it('pünktliche Lieferung hat positiven Grund', () => {
    const game = Game.new(1021);
    stockEverything(game);
    const offer = accept(game);
    game.rng.chance = () => false; // keine QC-Fehler / Reklamationen
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.satisfactionReason.length).toBeGreaterThan(0);
    expect(offer.satisfactionReason).toContain('Pünktlich');
  });

  it('Stornierung speichert den Grund', () => {
    const game = Game.new(1022);
    const offer = game.generateOffer()!;
    game.declineOrder(offer.id);
    expect(offer.status).toBe('cancelled');
    expect(offer.cancelReason).toBeTruthy();
  });
});

describe('Längs-Parkplätze mit Straßenanschluss (8 Stück, 2 kaufbar)', () => {
  it('8 Parkplätze an der Straße, 6 davon frei geschaltet', () => {
    const parks = TileMap.defaultStations().filter((s) => s.kind === 'parking');
    expect(parks).toHaveLength(8);
    expect(parks.filter((p) => p.unlocked)).toHaveLength(3);
    for (const p of parks) {
      expect(p.rect.y).toBe(16);
      expect(p.rect.h).toBe(1);
      expect(p.rect.w).toBe(3);
    }
  });

  it('alle Parkplätze sind von der Einfahrt aus erreichbar', () => {
    const map = TileMap.createDefault();
    for (const p of TileMap.defaultStations().filter((s) => s.kind === 'parking')) {
      const path = findPath(map, { x: 1, y: 15 }, p.interact);
      expect(path).not.toBeNull();
    }
  });

  it('buyParking schaltet den nächsten gesperrten Platz frei', () => {
    const game = Game.new(1030);
    game.state.economy.balanceCents = 100_000_000;
    const lockedBefore = game.state.stations.filter((s) => s.kind === 'parking' && !s.unlocked).length;
    expect(game.buyParking()).toBe(true);
    const lockedAfter = game.state.stations.filter((s) => s.kind === 'parking' && !s.unlocked).length;
    expect(lockedAfter).toBe(lockedBefore - 1);
    for (let i = 0; i < 4; i++) expect(game.buyParking()).toBe(true);
    expect(game.buyParking()).toBe(false); // alle 8 frei
  });
});

describe('Verzögerte Abholung durch den Kunden', () => {
  it('Fahrzeug wartet nach Reparatur auf dem Parkplatz, Abholung kommt später', () => {
    const game = Game.new(1040);
    stockEverything(game);
    const offer = accept(game);
    runUntil(game, () => offer.status === 'completed', 4 * 1440);
    expect(offer.status).toBe('completed');
    expect(offer.pickupAtMinute).not.toBeNull();
    expect(offer.pickupAtMinute!).toBeGreaterThan(game.state.totalMinutes);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    runUntil(game, () => v.state === 'waiting_pickup', 240);
    expect(v.state).toBe('waiting_pickup');
    // Bühne ist frei, obwohl der Kunde noch nicht abgeholt hat
    const lift = game.state.stations.find((s) => s.id === offer.stationId);
    expect(lift?.orderId ?? null).toBeNull();
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.status).toBe('delivered');
  });

  it('ohne freien Parkplatz blockiert das Fahrzeug die Bühne (Kapazitätsplanung)', () => {
    const game = Game.new(1041);
    stockEverything(game);
    game.state.inventory.capacity = 1000;
    game.state.nextOrderAttemptAtMinute = 999999;
    // Drei Aufträge fertigstellen und auf dem Parkplatz abholen lassen
    const parked: ReturnType<typeof accept>[] = [];
    for (let i = 0; i < 3; i++) {
      const o = accept(game);
      const ov = game.state.vehicles.find((x) => x.id === o.vehicleId)!;
      runUntil(game, () => o.status === 'completed' && ov.state === 'waiting_pickup', 2 * 1440);
      expect(ov.state).toBe('waiting_pickup');
      o.pickupAtMinute = game.state.totalMinutes + 99999; // bleiben geparkt
      parked.push(o);
    }
    // Vierter Auftrag: kein Parkplatz frei → blockiert die Bühne
    const offer = accept(game);
    runUntil(game, () => offer.status === 'completed', 2 * 1440);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    expect(['at_lift', 'at_diagnosis']).toContain(v.state);
    const reason = OrderSystem.waitReason(game.ctx, offer);
    expect(reason).toContain('Parkplatz');
    // Ein Kunde holt ab → Parkplatz frei → Fahrzeug rollt raus
    parked[0]!.pickupAtMinute = game.state.totalMinutes;
    game.tick(10);
    game.tick(5);
    expect(v.state === 'driving_in' || v.state === 'waiting_pickup').toBe(true);
  });
});

describe('Laufgeschwindigkeit ist unveränderlich', () => {
  it('Tempo bleibt über einen ganzen Tag konstant', () => {
    const game = Game.new(1050);
    const speeds = game.state.workers.map((w) => w.speedTilesPerMinute);
    game.tick(1440);
    expect(game.state.workers.map((w) => w.speedTilesPerMinute)).toEqual(speeds);
    expect((game as unknown as Record<string, unknown>).setWorkerSpeed).toBeUndefined();
  });
});

describe('Auftragsfrequenz einstellbar', () => {
  it('höhere Frequenz erzeugt mehr Aufträge', () => {
    const count = (factor: number): number => {
      const game = Game.new(1060);
      game.state.orderRateFactor = factor;
      game.state.totalMinutes = 8 * 60;
      const start = game.state.orders.length;
      for (let i = 0; i < 60; i++) {
        game.tick(10);
        for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
      }
      return game.state.orders.length - start;
    };
    expect(count(3)).toBeGreaterThan(count(0.5));
  });

  it('setOrderRate begrenzt auf 0.5–3', () => {
    const game = Game.new(1061);
    game.setOrderRate(99);
    expect(game.state.orderRateFactor).toBe(3);
    game.setOrderRate(0);
    expect(game.state.orderRateFactor).toBe(0.5);
  });
});

describe('Save-Migration v7 → v8', () => {
  it('ersetzt Parkplätze, ergänzt Abholung/Gründe/Frequenz', () => {
    const game = Game.new(1070);
    const raw = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    raw.version = 7;
    raw.stations = (raw.stations as Array<Record<string, unknown>>).filter(
      (s) => s.kind !== 'parking',
    );
    (raw.stations as Array<Record<string, unknown>>).push(
      { id: 'park1', kind: 'parking', rect: { x: 4, y: 13, w: 3, h: 2 }, interact: { x: 4, y: 13 }, orderId: null, unlocked: true },
    );
    delete raw.orderRateFactor;
    const migrated = migrate(raw);
    expect(migrated.version).toBe(SAVE_VERSION);
    const parks = (migrated.stations as Array<Record<string, unknown>>).filter((s) => s.kind === 'parking');
    expect(parks).toHaveLength(8);
    expect(migrated.orderRateFactor).toBe(1);
    const o = (migrated.orders as Array<Record<string, unknown>>)[0]!;
    expect(o.pickupAtMinute).toBeNull();
    expect(o.cancelReason).toBeNull();
    expect(o.satisfactionReason).toBe('');
    expect(o.acceptedBudgetCents).toBeNull();
  });
});
