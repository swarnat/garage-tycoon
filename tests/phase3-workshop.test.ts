import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) {
    game.state.inventory.stock[k] = qty;
  }
}

function accept(game: Game, defectId: string) {
  let offer = game.generateOffer();
  if (!offer) {
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    offer = game.generateOffer()!;
  }
  offer.budgetCents = 5_000_000;
  offer.defectRepairIds = [defectId];
  game.acceptOrder(offer.id);
  return offer;
}

function runUntil(game: Game, pred: () => boolean, maxMinutes = 6 * 1440): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !pred()) game.tick(5);
}

describe('Spezialwerkzeuge', () => {
  it('Reparatur mit Werkzeugbedarf wartet, bis das Werkzeug gekauft ist', () => {
    const game = Game.new(601);
    stockEverything(game);
    const offer = accept(game, 'ac_service'); // braucht Klimaservice-Station
    runUntil(game, () => offer.status === 'repairing', 1440);
    expect(offer.status).toBe('repairing');
    expect(offer.assignedWorkerId).toBeNull();
    expect(game.state.ownedTools).not.toContain('ac_station');
    // Werkzeug kaufen → Reparatur läuft an
    expect(game.buyTool('ac_station')).toBe(true);
    runUntil(game, () => offer.assignedWorkerId !== null, 1440);
    expect(offer.assignedWorkerId).not.toBeNull();
  });

  it('Werkzeugkauf kostet Geld und ist nur einmal möglich', () => {
    const game = Game.new(602);
    const before = game.state.economy.balanceCents;
    expect(game.buyTool('spring_compressor')).toBe(true);
    expect(game.state.economy.balanceCents).toBeLessThan(before);
    expect(game.buyTool('spring_compressor')).toBe(false);
  });

  it('Startwerkstatt besitzt Basis-Entlüftungsgerät', () => {
    const game = Game.new(603);
    expect(game.state.ownedTools).toContain('brake_bleeder');
  });
});

describe('Mehrmann-Reparaturen', () => {
  it('Team-Reparatur braucht zwei Mitarbeiter und läuft dann', () => {
    const game = Game.new(610);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_discs'); // requiredWorkers 2
    runUntil(game, () => offer.status === 'repairing' && offer.crewIds.length === 2, 1440);
    expect(offer.crewIds).toHaveLength(2);
    runUntil(game, () => offer.status === 'delivered', 6 * 1440);
    expect(offer.status).toBe('delivered');
    expect(game.state.statistics.repairsByType['replace_brake_discs']).toBe(1);
  });

  it('bricht ein Teammitglied weg, wartet der Rest auf Ersatz', () => {
    const game = Game.new(611);
    stockEverything(game);
    game.state.economy.balanceCents = 100_000_000;
    const offer = accept(game, 'replace_brake_discs');
    runUntil(game, () => offer.status === 'repairing' && offer.crewIds.length === 2 && offer.laborMinutesActual > 10, 1440);
    const job = offer.jobs[0]!;
    const victim = offer.crewIds[1]!;
    expect(game.fireWorker(victim)).toBe(true);
    expect(offer.crewIds).toHaveLength(1);
    const remaining = job.stepRemainingMinutes;
    game.tick(60);
    // Ohne zweiten Mann kein Fortschritt
    expect(job.stepRemainingMinutes).toBeCloseTo(remaining, 1);
    // Neuen qualifizierten Mitarbeiter einstellen → es geht weiter
    game.refreshCandidates();
    const cand = game.state.candidates[0]!;
    game.hireCandidate(cand.id);
    const hired = game.state.workers[game.state.workers.length - 1]!;
    hired.skills.brakes = 70;
    runUntil(game, () => offer.crewIds.length === 2, 1440);
    expect(offer.crewIds).toHaveLength(2);
    runUntil(game, () => offer.status === 'delivered', 6 * 1440);
    expect(offer.status).toBe('delivered');
  });
});

describe('Qualitätsprobleme und Reklamationen', () => {
  it('QC kann fehlschlagen → Nacharbeit statt Abschluss', () => {
    const game = Game.new(620);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_pads');
    runUntil(game, () => offer.status === 'quality_check', 1440);
    game.rng.chance = () => true; // QC-Fehlschlag erzwingen
    runUntil(game, () => offer.qualityIssues > 0, 1440);
    expect(offer.qualityIssues).toBeGreaterThan(0);
    expect(game.state.statistics.qcFailures).toBeGreaterThan(0);
    expect(offer.status).not.toBe('completed');
    game.rng.chance = () => false;
    runUntil(game, () => offer.status === 'delivered', 6 * 1440);
    expect(offer.status).toBe('delivered');
  });

  it('Reklamation nach Auslieferung kostet Geld und Reputation', () => {
    const game = Game.new(621);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_pads');
    // Qualität niedrig halten: QC-Skill des Workers runter
    for (const w of game.state.workers) w.skills.diagnosis = 5;
    // Nur kleine Chancen (Reklamation ~0.11) auslösen, QC-Fehler (0.24) nicht
    game.rng.chance = (p: number) => p < 0.2;
    runUntil(game, () => offer.status === 'delivered', 6 * 1440);
    expect(offer.status).toBe('delivered');
    expect(game.state.statistics.complaints).toBeGreaterThan(0);
    const refund = game.state.economy.transactions.find((t) => t.id === `complaint-${offer.id}`);
    expect(refund).toBeDefined();
    expect(refund!.amountCents).toBeLessThan(0);
  });

  it('bei perfekter Qualität keine Reklamation', () => {
    const game = Game.new(622);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_pads');
    for (const w of game.state.workers) w.skills.diagnosis = 100;
    game.rng.chance = () => false;
    runUntil(game, () => offer.status === 'delivered', 6 * 1440);
    expect(game.state.statistics.complaints).toBe(0);
  });
});
