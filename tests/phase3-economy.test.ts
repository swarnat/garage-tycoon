import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { SaveManager } from '../src/core/SaveManager';
import { EconomySystem } from '../src/simulation/EconomySystem';
import { RepairSystem } from '../src/simulation/RepairSystem';

describe('Auto-Nachbestellung: Zielbestand = Mindestbestand', () => {
  it('bestellt exakt auf den Mindestbestand auf (nicht 2x)', () => {
    const game = Game.new(501);
    const inv = game.state.inventory;
    inv.stock['brake_pads__M__standard'] = 2;
    inv.minStock['brake_pads__M__standard'] = 3;
    inv.autoReorder['brake_pads__M__standard'] = true;
    game.tick(61);
    const d = game.state.deliveries.filter((x) => x.partId === 'brake_pads__M__standard');
    expect(d).toHaveLength(1);
    expect(d[0]!.quantity).toBe(1); // 3 - 2 = 1, nicht 4
  });

  it('bestellt nichts, wenn Bestand den Mindestbestand erreicht', () => {
    const game = Game.new(502);
    const inv = game.state.inventory;
    inv.stock['brake_pads__M__standard'] = 3;
    inv.minStock['brake_pads__M__standard'] = 3;
    inv.autoReorder['brake_pads__M__standard'] = true;
    game.tick(180);
    expect(game.state.deliveries.filter((x) => x.partId === 'brake_pads__M__standard')).toHaveLength(0);
  });

  it('berücksichtigt Reservierungen beim Auffüllen', () => {
    const game = Game.new(503);
    const inv = game.state.inventory;
    inv.stock['battery__60__standard'] = 4;
    inv.minStock['battery__60__standard'] = 3;
    inv.autoReorder['battery__60__standard'] = true;
    inv.reserved['battery__60__standard'] = 3; // verfügbar = 1
    game.tick(61);
    const d = game.state.deliveries.filter((x) => x.partId === 'battery__60__standard');
    expect(d).toHaveLength(1);
    expect(d[0]!.quantity).toBe(2); // verfügbar 1 -> Ziel 3
  });
});

describe('Dynamische Marktpreise', () => {
  it('Preise schwanken täglich innerhalb von ±15 %', () => {
    const game = Game.new(510);
    const before = { ...game.state.marketPriceFactors };
    game.tick(1440);
    const after = game.state.marketPriceFactors;
    let changed = 0;
    for (const p of game.defs.parts) {
      expect(after[p.id]).toBeGreaterThanOrEqual(0.85);
      expect(after[p.id]).toBeLessThanOrEqual(1.15);
      if (after[p.id] !== before[p.id]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('Einkaufspreis folgt dem Marktfaktor', () => {
    const game = Game.new(511);
    game.state.marketPriceFactors['battery__60__standard'] = 1.1;
    const cost = EconomySystem.marketBuyCents(game.state, game.defs.parts.find((p) => p.id === 'battery__60__standard')!);
    expect(cost).toBe(12100); // 11000 * 1.1
    game.orderParts('battery__60__standard', 1, 'teileprofi');
    const d = game.state.deliveries[0]!;
    expect(d.costCents).toBe(12100 + 990);
  });
});

describe('Kredite', () => {
  it('Kredit aufnehmen erhöht Kontostand und Schulden', () => {
    const game = Game.new(520);
    const before = game.state.economy.balanceCents;
    expect(game.takeLoan(1000000)).toBe(true);
    expect(game.state.economy.balanceCents).toBe(before + 1000000);
    expect(game.state.loans).toHaveLength(1);
    expect(game.state.loans[0]!.remainingCents).toBe(1000000);
  });

  it('Kreditlimit wird eingehalten', () => {
    const game = Game.new(521);
    expect(game.takeLoan(2000000)).toBe(true);
    expect(game.takeLoan(2000000)).toBe(true);
    expect(game.takeLoan(2000000)).toBe(false); // > 50.000 EUR Limit
    expect(game.state.loans).toHaveLength(2);
  });

  it('Zinsen werden täglich verbucht', () => {
    const game = Game.new(522);
    game.takeLoan(1000000);
    game.tick(1440);
    const interest = game.state.economy.transactions.filter((t) => t.label.includes('Kreditzinsen'));
    expect(interest.length).toBeGreaterThanOrEqual(1);
    expect(interest[0]!.amountCents).toBe(-500); // 0.05 % von 10.000 EUR
  });

  it('Tilgung reduziert die Restschuld', () => {
    const game = Game.new(523);
    game.takeLoan(1000000);
    const id = game.state.loans[0]!.id;
    expect(game.repayLoan(id, 400000)).toBe(true);
    expect(game.state.loans[0]!.remainingCents).toBe(600000);
    expect(game.repayLoan(id, 600000)).toBe(true);
    expect(game.state.loans).toHaveLength(0);
  });

  it('Tilgung nie über Kontostand oder Restschuld', () => {
    const game = Game.new(524);
    game.takeLoan(500000);
    const id = game.state.loans[0]!.id;
    game.state.economy.balanceCents = 10000;
    game.repayLoan(id, 500000);
    expect(game.state.loans[0]!.remainingCents).toBe(490000);
  });
});

describe('Motivation', () => {
  it('sinkt bei Überlastung, steigt bei Erholung', () => {
    const game = Game.new(530);
    const w = game.state.workers[0]!;
    w.motivation = 80;
    w.dailyWorkedMinutes = 550;
    w.dailyOnDutyMinutes = 600; // 92 % Auslastung
    game.state.totalMinutes = 1439;
    game.tick(2); // Tagesabschluss
    expect(w.motivation).toBeLessThan(80);
    const afterHeavy = w.motivation;
    w.dailyWorkedMinutes = 100;
    w.dailyOnDutyMinutes = 600; // 17 %
    game.state.totalMinutes = 2 * 1440 - 1;
    game.tick(2);
    expect(w.motivation).toBeGreaterThan(afterHeavy);
  });

  it('Motivation beeinflusst die Arbeitsgeschwindigkeit', () => {
    const motivated = RepairSystem.workRate(90, 90);
    const unmotivated = RepairSystem.workRate(90, 20);
    expect(motivated).toBeGreaterThan(unmotivated);
  });
});

describe('Komplexe Defekte (Folgeschäden)', () => {
  it('Wasserpumpe kann Thermostat-Schaden nach sich ziehen', () => {
    const game = Game.new(540);
    game.rng.chance = () => true;
    const offer = game.generateOffer()!;
    offer.defectRepairIds = ['replace_water_pump'];
    // Defekt-Ketten werden bei der Generierung angewandt; hier direkt prüfen:
    const def = game.defs.repairs.find((r) => r.id === 'replace_water_pump')!;
    expect(def.followUps).toBeDefined();
    expect(def.followUps!.some((f) => f.repairId === 'replace_thermostat')).toBe(true);
  });

  it('generierte Aufträge enthalten Folgeschäden bei aktiviertem Zufall', () => {
    const game = Game.new(541);
    // Erzwingen: erster Defekt Wasserpumpe, alle Chancen true
    const origWeighted = game.rng.weighted.bind(game.rng);
    game.rng.weighted = <T,>(items: readonly T[], weights: readonly number[]): T => {
      if (items.includes('standard' as unknown as T)) return 'standard' as unknown as T;
      const pump = items.find((i) => (i as { id?: string }).id === 'replace_water_pump');
      return (pump ?? origWeighted(items, weights)) as T;
    };
    game.rng.chance = () => true;
    const offer = game.generateOffer()!;
    expect(offer.defectRepairIds).toContain('replace_water_pump');
    expect(offer.defectRepairIds).toContain('replace_thermostat');
  });
});

describe('Save-Migration v4 → v5', () => {
  it('ergänzt Werkzeuge, Marktpreise, Kredite, Motivation, Statistik', () => {
    const game = Game.new(550);
    const raw = JSON.parse(JSON.stringify(game.state));
    raw.version = 4;
    delete raw.ownedTools;
    delete raw.marketPriceFactors;
    delete raw.loans;
    for (const w of raw.workers) {
      delete w.motivation;
      delete w.dailyWorkedMinutes;
      delete w.dailyOnDutyMinutes;
    }
    for (const o of raw.orders) {
      delete o.crewIds;
      delete o.qualityIssues;
    }
    delete raw.statistics.qcFailures;
    delete raw.statistics.complaints;
    delete raw.statistics.repairsByType;
    const migrated = SaveManager.parse(JSON.stringify(raw));
    expect(migrated.version).toBe(14);
    expect(Array.isArray(migrated.ownedTools)).toBe(true);
    expect(Array.isArray(migrated.loans)).toBe(true);
    expect(migrated.workers[0]!.motivation).toBe(80);
    expect(migrated.orders[0]!.crewIds).toEqual([]);
    expect(migrated.statistics.qcFailures).toBe(0);
  });
});
