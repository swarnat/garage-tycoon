import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { SaveManager } from '../src/core/SaveManager';
import { InventorySystem } from '../src/simulation/InventorySystem';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) {
    game.state.inventory.stock[k] = qty;
  }
}

describe('Automatische Nachbestellung', () => {
  it('bestellt nach, wenn Bestand <= Mindestmenge und Auto aktiv ist', () => {
    const game = Game.new(101);
    const inv = game.state.inventory;
    inv.stock['brake_pads'] = 2;
    inv.minStock['brake_pads'] = 3;
    inv.autoReorder['brake_pads'] = true;
    const balanceBefore = game.state.economy.balanceCents;
    game.tick(61);
    const deliveries = game.state.deliveries.filter((d) => d.partId === 'brake_pads');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.quantity).toBe(1); // Ziel Mindestmenge 3, Bestand 2
    expect(game.state.economy.balanceCents).toBeLessThan(balanceBefore);
  });

  it('bestellt nicht doppelt, solange eine Lieferung offen ist', () => {
    const game = Game.new(102);
    const inv = game.state.inventory;
    inv.stock['brake_pads'] = 1;
    inv.minStock['brake_pads'] = 3;
    inv.autoReorder['brake_pads'] = true;
    game.tick(180);
    expect(game.state.deliveries.filter((d) => d.partId === 'brake_pads')).toHaveLength(1);
  });

  it('bestellt nach Lieferung erneut, wenn Bestand wieder niedrig ist', () => {
    const game = Game.new(103);
    const inv = game.state.inventory;
    inv.stock['brake_pads'] = 1;
    inv.minStock['brake_pads'] = 3;
    inv.autoReorder['brake_pads'] = true;
    game.tick(61);
    // Verbrauch simulieren: Lieferung ankommen lassen, dann Bestand leeren
    game.tick(500);
    expect(inv.stock['brake_pads']).toBeGreaterThanOrEqual(3);
    inv.stock['brake_pads'] = 0;
    game.tick(61);
    const all = game.state.deliveries.filter((d) => d.partId === 'brake_pads');
    expect(all.length).toBe(2);
  });

  it('ist standardmäßig deaktiviert', () => {
    const game = Game.new(104);
    const inv = game.state.inventory;
    inv.stock['brake_pads'] = 0;
    inv.minStock['brake_pads'] = 3;
    game.tick(180);
    expect(game.state.deliveries.filter((d) => d.partId === 'brake_pads')).toHaveLength(0);
  });

  it('bestellt nicht bei fehlendem Geld und stürzt nicht ab', () => {
    const game = Game.new(105);
    const inv = game.state.inventory;
    inv.stock['alternator'] = 0;
    inv.minStock['alternator'] = 2;
    inv.autoReorder['alternator'] = true;
    game.state.economy.balanceCents = 500;
    expect(() => game.tick(180)).not.toThrow();
    expect(game.state.deliveries.filter((d) => d.partId === 'alternator')).toHaveLength(0);
  });

  it('reservierte Teile zählen nicht als verfügbarer Bestand für die Mindestmenge', () => {
    const game = Game.new(106);
    const inv = game.state.inventory;
    inv.stock['battery'] = 4;
    inv.minStock['battery'] = 3;
    inv.autoReorder['battery'] = true;
    InventorySystem.reserve(inv, [{ partId: 'battery', quantity: 3 }]);
    // verfügbar = 1 <= 3 → Nachbestellung
    game.tick(61);
    expect(game.state.deliveries.filter((d) => d.partId === 'battery')).toHaveLength(1);
  });
});

describe('Personal: Einstellen und Entlassen', () => {
  it('startet mit drei Kandidaten und stellt gegen Gebühr ein', () => {
    const game = Game.new(110);
    expect(game.state.candidates).toHaveLength(3);
    const cand = game.state.candidates[0]!;
    const balanceBefore = game.state.economy.balanceCents;
    expect(game.hireCandidate(cand.id)).toBe(true);
    expect(game.state.workers).toHaveLength(3);
    expect(game.state.candidates.find((c) => c.id === cand.id)).toBeUndefined();
    expect(game.state.economy.balanceCents).toBe(balanceBefore - cand.hiringFeeCents);
    const hired = game.state.workers[2]!;
    expect(hired.name).toBe(cand.name);
    expect(hired.skills.brakes).toBe(cand.skills.brakes);
  });

  it('begrenzt die Belegschaft auf sechs Mitarbeiter', () => {
    const game = Game.new(111);
    game.state.economy.balanceCents = 100_000_000;
    while (game.state.workers.length < 6) {
      if (game.state.candidates.length === 0) game.refreshCandidates();
      expect(game.hireCandidate(game.state.candidates[0]!.id)).toBe(true);
    }
    if (game.state.candidates.length === 0) game.refreshCandidates();
    expect(game.hireCandidate(game.state.candidates[0]!.id)).toBe(false);
    expect(game.state.workers).toHaveLength(6);
  });

  it('entlässt keinen letzten Mitarbeiter', () => {
    const game = Game.new(112);
    expect(game.fireWorker('w1')).toBe(true);
    expect(game.state.workers).toHaveLength(1);
    expect(game.fireWorker('w2')).toBe(false);
    expect(game.state.workers).toHaveLength(1);
  });

  it('entlassener Mitarbeiter gibt Auftrag frei; Reparatur wird fortgesetzt', () => {
    const game = Game.new(113);
    stockEverything(game);
    const offer = game.generateOffer()!;
    offer.budgetCents = 5_000_000;
    offer.defectRepairIds = ['replace_brake_pads'];
    game.acceptOrder(offer.id);
    const limit = game.state.totalMinutes + 1440;
    while (game.state.totalMinutes < limit && offer.status !== 'repairing') game.tick(10);
    expect(offer.status).toBe('repairing');
    // Beide Mitarbeiter entlassen geht nicht (min 1) – einen einstellen, dann den aktiven feuern
    game.state.economy.balanceCents = 100_000_000;
    game.refreshCandidates();
    game.hireCandidate(game.state.candidates[0]!.id);
    const assigned = offer.assignedWorkerId;
    if (assigned) {
      expect(game.fireWorker(assigned)).toBe(true);
      expect(offer.assignedWorkerId).not.toBe(assigned);
    }
    const end = game.state.totalMinutes + 4 * 1440;
    while (game.state.totalMinutes < end && offer.status !== 'delivered' && offer.status !== 'cancelled') {
      game.tick(15);
    }
    expect(offer.status).toBe('delivered');
  });
});

describe('Weiterbildung', () => {
  it('bildet weiter: blockiert Aufgaben, erhöht Skill nach Abschluss', () => {
    const game = Game.new(120);
    const w = game.state.workers[0]!;
    const before = w.skills.brakes;
    expect(game.trainWorker(w.id, 'brakes')).toBe(true);
    expect(w.trainingMinutes).toBeGreaterThan(0);
    expect(w.pendingTraining).not.toBeNull();
    // Arbeit verfügbar machen: während der Weiterbildung darf keine Aufgabe kommen
    stockEverything(game);
    const offer = game.generateOffer()!;
    offer.budgetCents = 5_000_000;
    game.acceptOrder(offer.id);
    game.tick(30);
    expect(w.task).toBeNull();
    expect(w.state).toBe('training');
    expect(w.skills.brakes).toBe(before);
    game.tick(200);
    expect(w.skills.brakes).toBe(Math.min(100, before + 5));
    expect(w.pendingTraining).toBeNull();
    expect(w.trainingMinutes).toBe(0);
  });

  it('lehnt Weiterbildung während einer Aufgabe ab', () => {
    const game = Game.new(121);
    stockEverything(game);
    const offer = game.generateOffer()!;
    offer.budgetCents = 5_000_000;
    game.acceptOrder(offer.id);
    const limit = game.state.totalMinutes + 1440;
    while (game.state.totalMinutes < limit && !game.state.workers.some((w) => w.task)) {
      game.tick(10);
    }
    const busy = game.state.workers.find((w) => w.task)!;
    expect(game.trainWorker(busy.id, 'engine')).toBe(false);
  });

  it('kostet Geld und begrenzt Skills auf 100', () => {
    const game = Game.new(122);
    const w = game.state.workers[0]!;
    w.skills.brakes = 98;
    const balanceBefore = game.state.economy.balanceCents;
    expect(game.trainWorker(w.id, 'brakes')).toBe(true);
    expect(game.state.economy.balanceCents).toBeLessThan(balanceBefore);
    game.tick(200);
    expect(w.skills.brakes).toBe(100);
  });
});

describe('Save-Migration v2 → v3', () => {
  it('ergänzt Auto-Bestellung, Kandidaten und Weiterbildungsfelder', () => {
    const game = Game.new(130);
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.version = 2;
    delete raw.candidates;
    delete raw.inventory.autoReorder;
    delete raw.inventory.autoSupplierId;
    delete raw.nextAutoOrderCheckAtMinute;
    delete raw.lastCandidateRefreshDay;
    for (const w of raw.workers) {
      delete w.trainingMinutes;
      delete w.pendingTraining;
    }
    const migrated = SaveManager.parse(JSON.stringify(raw));
    expect(migrated.version).toBe(6);
    expect(migrated.inventory.autoReorder).toEqual({});
    expect(migrated.inventory.autoSupplierId).toBe('teileprofi');
    expect(Array.isArray(migrated.candidates)).toBe(true);
    expect(migrated.workers[0]!.trainingMinutes).toBe(0);
    expect(migrated.workers[0]!.pendingTraining).toBeNull();
  });
});
