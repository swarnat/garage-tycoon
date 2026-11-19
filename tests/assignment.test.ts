import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { OrderSystem } from '../src/simulation/OrderSystem';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) {
    game.state.inventory.stock[k] = qty;
  }
}

function acceptWithBudget(game: Game, defectId?: string) {
  const offer = game.generateOffer()!;
  offer.budgetCents = 5_000_000;
  if (defectId) offer.defectRepairIds = [defectId];
  game.acceptOrder(offer.id);
  return offer;
}

function runUntil(game: Game, pred: () => boolean, maxMinutes = 4 * 1440): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !pred()) game.tick(10);
}

describe('Bug: Diagnose bleibt nach Mitarbeiter-Entlassung hängen', () => {
  it('Auftrag wird nach Entlassung des Diagnostikers neu zugewiesen', () => {
    const game = Game.new(301);
    stockEverything(game);
    const offer = acceptWithBudget(game);
    runUntil(game, () => offer.status === 'diagnosing' && !!offer.assignedWorkerId);
    expect(offer.status).toBe('diagnosing');
    const victim = offer.assignedWorkerId!;
    expect(game.fireWorker(victim)).toBe(true);
    // Darf nicht dauerhaft in diagnosing ohne Mitarbeiter hängen
    runUntil(game, () => offer.revealed, 1440);
    expect(offer.revealed).toBe(true);
    expect(offer.assignedWorkerId).not.toBe(victim);
  });

  it('Selbstheilung: diagnosing ohne Mitarbeiter wird zurückgesetzt', () => {
    const game = Game.new(302);
    stockEverything(game);
    const offer = acceptWithBudget(game);
    runUntil(game, () => offer.status === 'diagnosing' && !!offer.assignedWorkerId);
    // Künstlich verwaisten Zustand erzeugen (z. B. aus altem Save)
    const w = game.state.workers.find((x) => x.id === offer.assignedWorkerId)!;
    w.task = null;
    w.state = 'idle';
    offer.assignedWorkerId = null;
    game.tick(20);
    expect(offer.assignedWorkerId).not.toBeNull();
  });
});

describe('Kompetenzbasierte Zuweisung', () => {
  it('Reparatur übernimmt der freie Mitarbeiter mit der höchsten Kompetenz', () => {
    const game = Game.new(310);
    stockEverything(game);
    const [w1, w2] = game.state.workers;
    w1!.skills.brakes = 25;
    w2!.skills.brakes = 85;
    const offer = acceptWithBudget(game, 'replace_brake_pads');
    runUntil(game, () => offer.status === 'repairing' && !!offer.assignedWorkerId);
    expect(offer.assignedWorkerId).toBe(w2!.id);
  });

  it('Diagnose übernimmt der freie Mitarbeiter mit der höchsten Diagnose-Kompetenz', () => {
    const game = Game.new(311);
    stockEverything(game);
    const [w1, w2] = game.state.workers;
    w1!.skills.diagnosis = 20;
    w2!.skills.diagnosis = 80;
    const offer = acceptWithBudget(game);
    runUntil(game, () => offer.status === 'diagnosing' && !!offer.assignedWorkerId);
    expect(offer.assignedWorkerId).toBe(w2!.id);
  });

  it('hohe Priorität wechselt den Mitarbeiter durch (Fortschritt bleibt erhalten)', () => {
    const game = Game.new(312);
    stockEverything(game);
    // Nur ein Mitarbeiter → muss durchwechseln
    expect(game.fireWorker('w2')).toBe(true);
    const low = acceptWithBudget(game, 'replace_brake_pads');
    low.priority = 1;
    runUntil(game, () => low.status === 'repairing' && low.laborMinutesActual > 5);
    const job = low.jobs[0]!;
    const def = game.defs.repairs.find((r) => r.id === job.repairId)!;
    // Zweiter Auftrag mit hoher Priorität, gleiche Qualifikation nötig
    const high = acceptWithBudget(game, 'replace_brake_discs');
    high.priority = 2;
    runUntil(game, () => high.status === 'repairing' && !!high.assignedWorkerId, 1440);
    expect(high.assignedWorkerId).toBe('w1');
    expect(low.assignedWorkerId).toBeNull();
    // Fortschritt des unterbrochenen Auftrags ist konserviert (Schritt nicht neu gestartet)
    expect(job.stepRemainingMinutes).toBeGreaterThan(0);
    expect(
      job.stepIndex > 0 ||
      job.stepRemainingMinutes < def.steps[job.stepIndex]!.durationMinutes,
    ).toBe(true);
    // Beide werden nacheinander fertig
    runUntil(game, () => low.status === 'delivered' && high.status === 'delivered', 6 * 1440);
    expect(low.status).toBe('delivered');
    expect(high.status).toBe('delivered');
  });
});

describe('Wartegrund-Anzeige', () => {
  it('waiting_for_parts nennt fehlende Teile und Lieferstatus', () => {
    const game = Game.new(320);
    const offer = acceptWithBudget(game, 'replace_brake_caliper');
    for (const k of Object.keys(game.state.inventory.stock)) {
      game.state.inventory.stock[k] = 0;
    }
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    expect(offer.status).toBe('waiting_for_parts');
    const reason = OrderSystem.waitReason(game.ctx, offer);
    expect(reason).toContain('Bremssattel');
    expect(reason).toMatch(/nicht bestellt|Lieferung/);
    game.orderParts('brake_caliper', 1, 'expressparts');
    game.orderParts('brake_fluid', 1, 'expressparts');
    const reason2 = OrderSystem.waitReason(game.ctx, offer);
    expect(reason2).toContain('Lieferung');
  });

  it('ready_for_repair ohne freie Bühne nennt die Hebebühne', () => {
    const game = Game.new(321);
    stockEverything(game);
    const offer = acceptWithBudget(game, 'replace_brake_pads');
    for (const s of game.state.stations) {
      if (s.kind === 'lift') s.orderId = 'blocker';
    }
    runUntil(game, () => offer.status === 'ready_for_repair', 1440);
    const reason = OrderSystem.waitReason(game.ctx, offer);
    expect(reason).toContain('Hebebühne');
  });

  it('repairing ohne qualifizierten Mitarbeiter nennt den benötigten Skill', () => {
    const game = Game.new(322);
    stockEverything(game);
    for (const w of game.state.workers) w.skills.engine = 10;
    const offer = acceptWithBudget(game, 'replace_water_pump'); // braucht engine >= 50
    runUntil(game, () => offer.status === 'repairing', 1440);
    expect(offer.status).toBe('repairing');
    expect(offer.assignedWorkerId).toBeNull();
    const reason = OrderSystem.waitReason(game.ctx, offer);
    expect(reason).toContain('Motor');
    expect(reason).toContain('50');
  });

  it('wartende Diagnose nennt den Mitarbeitermangel', () => {
    const game = Game.new(323);
    stockEverything(game);
    const offer = acceptWithBudget(game);
    // waiting_for_diagnosis existiert nur einen Sim-Schritt lang → fein ticken
    const limit = game.state.totalMinutes + 1440;
    while (game.state.totalMinutes < limit && offer.status !== 'waiting_for_diagnosis') {
      game.tick(0.25);
    }
    expect(offer.status).toBe('waiting_for_diagnosis');
    // Alle Mitarbeiter in Weiterbildung setzen
    for (const w of game.state.workers) {
      w.task = null;
      w.trainingMinutes = 500;
      w.pendingTraining = { skill: 'brakes', amount: 5 };
    }
    offer.assignedWorkerId = null;
    game.tick(5);
    const reason = OrderSystem.waitReason(game.ctx, offer);
    expect(reason).toContain('Weiterbildung');
  });
});
