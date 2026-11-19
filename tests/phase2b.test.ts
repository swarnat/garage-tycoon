import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { SaveManager } from '../src/core/SaveManager';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) {
    game.state.inventory.stock[k] = qty;
  }
}

function bringToDiagnosing(game: Game) {
  stockEverything(game);
  const offer = game.generateOffer()!;
  offer.budgetCents = 5_000_000;
  game.acceptOrder(offer.id);
  const limit = game.state.totalMinutes + 1440;
  while (
    game.state.totalMinutes < limit &&
    !(offer.status === 'diagnosing' && offer.assignedWorkerId)
  ) {
    game.tick(5);
  }
  expect(offer.status).toBe('diagnosing');
  const worker = game.state.workers.find((w) => w.id === offer.assignedWorkerId)!;
  return { offer, worker };
}

describe('Erweiterte Diagnosen', () => {
  it('schwache Diagnose-Skills können eine Nachuntersuchung auslösen', () => {
    const game = Game.new(201);
    const { offer, worker } = bringToDiagnosing(game);
    worker.skills.diagnosis = 0;
    game.rng.chance = () => true; // Nachuntersuchung erzwingen
    game.tick(80); // erste Diagnose (~40 min) durch, Nachuntersuchung (~51 min) läuft noch
    expect(offer.diagnosisExtended).toBe(true);
    expect(offer.status).toBe('diagnosing');
    expect(offer.revealed).toBe(false);
    expect(offer.assignedWorkerId).toBe(worker.id);
    game.tick(120); // Zusatzzeit abwarten
    expect(offer.revealed).toBe(true);
    expect(offer.status).not.toBe('diagnosing');
  });

  it('ohne Nachuntersuchung wird normal abgeschlossen', () => {
    const game = Game.new(202);
    const { offer, worker } = bringToDiagnosing(game);
    worker.skills.diagnosis = 0;
    game.rng.chance = () => false;
    game.tick(120);
    expect(offer.revealed).toBe(true);
    expect(offer.diagnosisExtended).toBe(false);
  });

  it('qualifizierte Mitarbeiter brauchen keine Nachuntersuchung', () => {
    const game = Game.new(203);
    const { offer, worker } = bringToDiagnosing(game);
    worker.skills.diagnosis = 60;
    game.rng.chance = () => true;
    game.tick(120);
    expect(offer.revealed).toBe(true);
    expect(offer.diagnosisExtended).toBe(false);
  });

  it('Nachuntersuchung passiert höchstens einmal pro Auftrag', () => {
    const game = Game.new(204);
    const { offer, worker } = bringToDiagnosing(game);
    worker.skills.diagnosis = 0;
    game.rng.chance = () => true;
    game.tick(300);
    expect(offer.diagnosisExtended).toBe(true);
    expect(offer.revealed).toBe(true);
    expect(['waiting_for_approval', 'ready_for_repair', 'waiting_for_parts', 'repairing', 'quality_check']).toContain(offer.status);
  });
});

describe('Zusätzliche Lieferanten', () => {
  it('gibt drei Lieferanten mit unterschiedlichen Konditionen', () => {
    const game = Game.new(210);
    expect(game.defs.suppliers.length).toBe(3);
    const budget = game.defs.suppliers.find((s) => s.id === 'budgetteile');
    expect(budget).toBeDefined();
    expect(budget!.priceFactor).toBeLessThan(1);
    expect(budget!.leadMinutes).toBeGreaterThan(480);
  });

  it('Budget-Lieferant ist billiger, aber langsamer', () => {
    const game = Game.new(211);
    game.orderParts('battery', 1, 'teileprofi');
    game.orderParts('battery', 1, 'budgetteile');
    const [std, budget] = game.state.deliveries;
    expect(budget!.costCents).toBeLessThan(std!.costCents);
    expect(budget!.arriveAtMinute).toBeGreaterThan(std!.arriveAtMinute);
  });
});

describe('Werkstattausbau: zweiter Diagnoseplatz', () => {
  it('existiert gesperrt und wird per Kauf freigeschaltet', () => {
    const game = Game.new(220);
    const diag2 = game.state.stations.find((s) => s.id === 'diag2');
    expect(diag2).toBeDefined();
    expect(diag2!.unlocked).toBe(false);
    const balanceBefore = game.state.economy.balanceCents;
    expect(game.buyDiagnosisBay()).toBe(true);
    expect(diag2!.unlocked).toBe(true);
    expect(game.state.economy.balanceCents).toBe(balanceBefore - 500000);
    expect(game.buyDiagnosisBay()).toBe(false); // schon gekauft
    expect(game.map.isBlocked(14, 3)).toBe(true); // Karte neu gebaut
  });

  it('wird bei belegter erster Diagnose für Aufträge genutzt', () => {
    const game = Game.new(221);
    game.buyDiagnosisBay();
    const diag1 = game.state.stations.find((s) => s.id === 'diag1')!;
    diag1.orderId = 'blocker';
    const offer = game.generateOffer()!;
    expect(game.acceptOrder(offer.id)).toBe(true);
    expect(offer.stationId).toBe('diag2');
  });

  it('Kauf scheitert bei fehlendem Geld', () => {
    const game = Game.new(222);
    game.state.economy.balanceCents = 1000;
    expect(game.buyDiagnosisBay()).toBe(false);
  });
});

describe('Stammkunden', () => {
  it('zufriedene Kunden kommen wieder', () => {
    const game = Game.new(230);
    stockEverything(game);
    const offer = game.generateOffer()!;
    offer.budgetCents = 5_000_000;
    offer.defectRepairIds = ['replace_brake_pads'];
    game.acceptOrder(offer.id);
    const limit = game.state.totalMinutes + 6 * 1440;
    while (game.state.totalMinutes < limit && offer.status !== 'delivered') {
      game.tick(15);
    }
    expect(offer.status).toBe('delivered');
    expect(offer.satisfaction).toBeGreaterThanOrEqual(80);
    const happyId = offer.customerId;
    const customer = game.state.customers.find((c) => c.id === happyId)!;
    expect(customer.lastSatisfaction).toBe(offer.satisfaction);
    // Rückkehr-Wahrscheinlichkeit erzwingen; Anfragen-Cap leeren
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    game.rng.chance = () => true;
    const next = game.generateOffer()!;
    expect(next.customerId).toBe(happyId);
    expect(customer.visits).toBe(2);
  });

  it('unzufriedene Kunden kommen nicht wieder', () => {
    const game = Game.new(231);
    stockEverything(game);
    const offer = game.generateOffer()!;
    offer.budgetCents = 5_000_000;
    offer.defectRepairIds = ['replace_brake_pads'];
    offer.dueAtMinute = game.state.totalMinutes + 10; // extrem knapp → wird spät
    game.acceptOrder(offer.id);
    const limit = game.state.totalMinutes + 6 * 1440;
    while (game.state.totalMinutes < limit && offer.status !== 'delivered') {
      game.tick(15);
    }
    expect(offer.status).toBe('delivered');
    expect(offer.satisfaction).toBeLessThan(80);
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    game.rng.chance = () => true;
    const next = game.generateOffer()!;
    expect(next.customerId).not.toBe(offer.customerId);
  });
});

describe('Save-Migration v3 → v4', () => {
  it('ergänzt Diagnose-Flag, Kundenzufriedenheit und zweiten Diagnoseplatz', () => {
    const game = Game.new(240);
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.version = 3;
    for (const o of raw.orders) delete o.diagnosisExtended;
    for (const c of raw.customers) delete c.lastSatisfaction;
    raw.stations = raw.stations.filter((s: { id: string }) => s.id !== 'diag2');
    const migrated = SaveManager.parse(JSON.stringify(raw));
    expect(migrated.version).toBe(8);
    expect(migrated.orders[0]!.diagnosisExtended).toBe(false);
    expect(migrated.customers[0]!.lastSatisfaction).toBeNull();
    const diag2 = migrated.stations.find((s) => s.id === 'diag2');
    expect(diag2).toBeDefined();
    expect(diag2!.unlocked).toBe(false);
  });
});
