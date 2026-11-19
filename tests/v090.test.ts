import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { PersonnelSystem } from '../src/simulation/PersonnelSystem';
import { migrate } from '../src/persistence/SaveMigration';
import { SAVE_VERSION } from '../src/entities/types';
import type { Candidate, Worker, WorkerRole } from '../src/entities/types';

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

function addWorker(game: Game, role: WorkerRole, speed = 0.6): Worker {
  const base = game.state.workers[0]!;
  const w: Worker = {
    ...JSON.parse(JSON.stringify(base)),
    id: `wtest${game.state.nextId++}`,
    name: role === 'warehouse' ? 'Lagerhelfer Test' : role === 'assistant' ? 'Assistent Test' : 'Mechaniker Test',
    role,
    speedTilesPerMinute: speed,
    task: null,
    path: [],
    state: 'idle',
    pos: { x: 3, y: 4 },
    workedMinutes: 0,
    onDutyMinutes: 0,
    dailyWorkedMinutes: 0,
    dailyOnDutyMinutes: 0,
    trainingMinutes: 0,
    pendingTraining: null,
  };
  game.state.workers.push(w);
  return w;
}

describe('Migration v11 -> v12 (Rollen)', () => {
  it('bestehende Mitarbeiter werden Mechaniker, Assistenten-Felder ergänzt', () => {
    const game = Game.new(1900);
    const raw = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    raw.version = 11;
    for (const w of raw.workers as Record<string, unknown>[]) delete w.role;
    delete raw.assistantAlertedAt;
    delete raw.assistantNextScanAtMinute;
    const m = migrate(raw);
    expect(m.version).toBe(SAVE_VERSION);
    for (const w of m.workers as Worker[]) expect(w.role).toBe('mechanic');
    expect(m.assistantAlertedAt).toEqual({});
    expect(m.assistantNextScanAtMinute).toBe(0);
  });
});

describe('Lagerhelfer: Teile-Logistik', () => {
  it('Lagerhelfer holt die Teile, Mechaniker bleibt an der Bühne', () => {
    const game = Game.new(1901);
    stockEverything(game);
    const helper = addWorker(game, 'warehouse', 0.7);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.status === 'repairing');
    expect(offer.status).toBe('repairing');
    const mech = game.state.workers.find((w) => w.id === offer.crewIds[0])!;
    expect(mech.role).toBe('mechanic');
    expect(mech.task!.phase).not.toBe('to_storage');
    expect(helper.task).not.toBeNull();
    expect(helper.task!.kind).toBe('deliver');
    runUntil(game, () => offer.partsAtBay, 2 * 1440);
    expect(offer.partsAtBay).toBe(true);
    expect(helper.task).toBeNull();
    runUntil(game, () => offer.status === 'quality_check' || offer.status === 'completed', 2 * 1440);
    expect(['quality_check', 'completed']).toContain(offer.status);
  });

  it('ohne Lagerhelfer holt der Mechaniker selbst (Fallback)', () => {
    const game = Game.new(1902);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.status === 'repairing');
    const mech = game.state.workers.find((w) => w.id === offer.crewIds[0])!;
    expect(mech.task!.phase).toBe('to_storage');
  });

  it('Lagerhelfer und Assistent werden nie für Diagnose/Reparatur/QC eingeteilt', () => {
    const game = Game.new(1903);
    stockEverything(game);
    const helper = addWorker(game, 'warehouse', 0.7);
    for (const sk of Object.keys(helper.skills)) helper.skills[sk as keyof Worker['skills']] = 95;
    const assist = addWorker(game, 'assistant', 0.4);
    for (const sk of Object.keys(assist.skills)) assist.skills[sk as keyof Worker['skills']] = 95;
    const offer = accept(game, 'replace_brake_caliper');
    runUntil(game, () => offer.status === 'repairing');
    expect(offer.crewIds).not.toContain(helper.id);
    expect(offer.crewIds).not.toContain(assist.id);
    expect(offer.assignedWorkerId).not.toBe(helper.id);
    expect(offer.assignedWorkerId).not.toBe(assist.id);
    runUntil(game, () => offer.status === 'completed' || offer.status === 'delivered', 4 * 1440);
    expect(offer.crewIds.every((id) => game.state.workers.find((w) => w.id === id)?.role !== 'warehouse')).toBe(true);
  });

  it('Lagerhelfer-Kandidaten sind schneller als Mechaniker-Durchschnitt', () => {
    let warehouseSum = 0, warehouseN = 0, mechSum = 0, mechN = 0;
    for (let seed = 1910; seed < 1940; seed++) {
      const game = Game.new(seed);
      for (const c of PersonnelSystem.generateCandidates(game.ctx, 6)) {
        if (c.role === 'warehouse') { warehouseSum += c.speedTilesPerMinute; warehouseN++; }
        if (c.role === 'mechanic') { mechSum += c.speedTilesPerMinute; mechN++; }
      }
    }
    expect(warehouseN).toBeGreaterThan(0);
    expect(warehouseSum / warehouseN).toBeGreaterThan(mechSum / mechN);
  });
});

describe('Assistent: Markt-Beobachtung', () => {
  it('meldet günstige Marktpreise relevanter Varianten', () => {
    const game = Game.new(1904);
    addWorker(game, 'assistant', 0.4);
    const vid = 'brake_pads__M__standard';
    game.state.marketPriceFactors[vid] = 0.86;
    game.state.inventory.minStock[vid] = 2;
    game.state.assistantNextScanAtMinute = 0;
    game.tick(5);
    const alerts = game.state.notifications.filter((n) => n.text.includes('Assistent'));
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((n) => n.text.includes('unter Normalpreis'))).toBe(true);
    expect(game.state.assistantAlertedAt[vid]).toBeDefined();
  });

  it('Cooldown: gleiche Variante wird innerhalb eines Tages nicht erneut gemeldet', () => {
    const game = Game.new(1905);
    addWorker(game, 'assistant', 0.4);
    const vid = 'brake_pads__M__standard';
    game.state.marketPriceFactors[vid] = 0.86;
    game.state.inventory.minStock[vid] = 2;
    game.state.assistantNextScanAtMinute = 0;
    game.tick(5);
    const count1 = game.state.notifications.filter((n) => n.text.includes('Assistent')).length;
    expect(count1).toBeGreaterThan(0);
    game.state.assistantNextScanAtMinute = 0;
    game.tick(5);
    const count2 = game.state.notifications.filter((n) => n.text.includes('Assistent')).length;
    expect(count2).toBe(count1);
  });

  it('nur ein Assistent anstellbar', () => {
    const game = Game.new(1906);
    addWorker(game, 'assistant', 0.4);
    const cand: Candidate = {
      id: 'cand-test', name: 'Zweiter Assistent', role: 'assistant',
      skills: { engine: 10, electrical: 10, suspension: 10, brakes: 10, transmission: 10, diagnosis: 10 },
      salaryCentsPerDay: 6000, hiringFeeCents: 12000, speedTilesPerMinute: 0.4,
    };
    game.state.candidates.push(cand);
    expect(PersonnelSystem.hire(game.ctx, 'cand-test')).toBe(false);
  });

  it('Kandidatenpool enthält Assistent nur solange keiner angestellt ist', () => {
    let sawAssistant = false;
    for (let seed = 1920; seed < 1950; seed++) {
      const game = Game.new(seed);
      const pool = PersonnelSystem.generateCandidates(game.ctx, 6);
      const assistants = pool.filter((c) => c.role === 'assistant');
      expect(assistants.length).toBeLessThanOrEqual(1);
      if (assistants.length > 0) sawAssistant = true;
    }
    expect(sawAssistant).toBe(true);
    const game = Game.new(1921);
    addWorker(game, 'assistant', 0.4);
    for (let i = 0; i < 10; i++) {
      const pool = PersonnelSystem.generateCandidates(game.ctx, 6);
      expect(pool.some((c) => c.role === 'assistant')).toBe(false);
    }
  });

  it('Weiterbildung nur für Mechaniker', () => {
    const game = Game.new(1907);
    const helper = addWorker(game, 'warehouse', 0.7);
    const assist = addWorker(game, 'assistant', 0.4);
    expect(PersonnelSystem.train(game.ctx, helper.id, 'brakes')).toBe(false);
    expect(PersonnelSystem.train(game.ctx, assist.id, 'diagnosis')).toBe(false);
  });
});
