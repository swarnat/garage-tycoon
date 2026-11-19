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

/** Erzwingt einen bestimmten Defekt bei der Angebotserzeugung. */
function forceDefect(game: Game, repairId: string): void {
  const orig = game.rng.weighted.bind(game.rng);
  game.rng.weighted = <T,>(items: readonly T[], weights: readonly number[]): T => {
    if (items.includes('standard' as unknown as T)) return 'standard' as unknown as T;
    const want = items.find((i) => (i as { id?: string }).id === repairId);
    return (want ?? orig(items, weights)) as T;
  };
}

describe('Rabatt: 5–25 %, einmalig, kleine Chance auf Mehrkosten-Akzeptanz', () => {
  it('25 % Rabatt ist erlaubt, 30 % nicht', () => {
    const game = Game.new(1200);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    offer.budgetCents = Math.round(offer.estimateCents! * 0.76); // 25 % Rabatt passt deterministisch
    expect(game.offerDiscount(offer.id, 30)).toBe(false);
    expect(game.offerDiscount(offer.id, 25)).toBe(true);
    expect(offer.discountPct).toBe(25);
    expect(['ready_for_repair', 'waiting_for_parts']).toContain(offer.status);
  });

  it('abgelehnter Rabatt = Kunde geht sofort (kein zweiter Versuch)', () => {
    const game = Game.new(1201);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    game.rng.chance = () => false;
    expect(game.offerDiscount(offer.id, 25)).toBe(true);
    expect(offer.status).toBe('cancelled');
    expect(offer.cancelReason).toContain('Rabatt');
    // Kein erneutes Modal: Auftrag ist final
    expect(game.offerDiscount(offer.id, 25)).toBe(false);
  });

  it('kleine Wahrscheinlichkeit: Kunde akzeptiert auch über Budget', () => {
    const game = Game.new(1202);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    for (const w of game.state.workers) w.skills.diagnosis = 90;
    // Nur die Mehrkosten-Chance (0.15) auslösen, QC-Fehler (0.025) nicht
    game.rng.chance = (p: number) => p >= 0.1 && p < 0.2;
    expect(game.offerDiscount(offer.id, 5)).toBe(true);
    expect(offer.offerAtRisk).toBe(false);
    expect(['ready_for_repair', 'waiting_for_parts']).toContain(offer.status);
    const estimate = offer.estimateCents!;
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.invoiceCents!).toBeLessThan(estimate);
  });
});

describe('Realistische Termine', () => {
  it('Kleinauftrag vor 11 Uhr: selber Tag 18:00', () => {
    const game = Game.new(1210);
    game.state.totalMinutes = 9 * 60;
    forceDefect(game, 'replace_brake_pads'); // 90 min, klein
    const offer = game.generateOffer()!;
    expect(offer.dueAtMinute).toBe(18 * 60);
  });

  it('Kleinauftrag nach 11 Uhr: Folgetag', () => {
    const game = Game.new(1211);
    game.state.totalMinutes = 14 * 60;
    forceDefect(game, 'replace_brake_pads');
    const offer = game.generateOffer()!;
    expect(offer.dueAtMinute % 1440).toBe(18 * 60);
    expect(offer.dueAtMinute).toBeGreaterThanOrEqual(1440 + 18 * 60);
  });

  it('Große Arbeit (>= 240 min): 1–2 Tage, 18:00', () => {
    const game = Game.new(1212);
    game.state.totalMinutes = 9 * 60;
    forceDefect(game, 'replace_brake_discs'); // 150 min x 2 Mitarbeiter = 300
    const offer = game.generateOffer()!;
    const dueDay = Math.floor(offer.dueAtMinute / 1440);
    expect([1, 2, 3]).toContain(dueDay);
    expect(offer.dueAtMinute % 1440).toBe(18 * 60);
  });
});

describe('Fahrzeuge verlassen den Parkplatz über die Straße', () => {
  it('Pfad vom Parkplatz zur Ausfahrt bleibt auf der Fahrspur (y15)', () => {
    const game = Game.new(1220);
    const offer = accept(game);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    v.pos = { x: 4, y: 16 };
    v.state = 'waiting_pickup';
    v.path = [];
    OrderSystem.sendVehicleOut(game.ctx, v);
    expect(v.path.length).toBeGreaterThan(0);
    // Erst hoch auf die Straße, dann nur noch auf y15 bis zur Ausfahrt
    const onRoad = v.path.filter((p) => p.y === 15);
    expect(onRoad.length).toBeGreaterThanOrEqual(v.path.length - 1);
    const last = v.path[v.path.length - 1]!;
    expect(last.y).toBe(15);
    expect(last.x).toBe(31);
    // Kein Tile abseits der Straße nach dem Auffahren
    let reachedRoad = false;
    for (const p of v.path) {
      if (p.y === 15) reachedRoad = true;
      else expect(reachedRoad).toBe(false);
    }
  });
});

describe('Kalkulation im Nachfrage-Modal', () => {
  it('profitBreakdown ist im Freigabe-Stadium verfügbar', () => {
    const game = Game.new(1230);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    const b = OrderSystem.profitBreakdown(game.ctx, offer);
    expect(b.materialCost).toBeGreaterThan(0);
    expect(b.laborRevenue).toBeGreaterThan(0);
    expect(b.profit).toBe(b.revenue - b.cost);
  });
});
