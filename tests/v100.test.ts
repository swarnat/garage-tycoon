import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { EventSystem } from '../src/simulation/EventSystem';
import { EconomySystem } from '../src/simulation/EconomySystem';
import { CustomerSystem } from '../src/simulation/CustomerSystem';
import { migrate } from '../src/persistence/SaveMigration';
import { SAVE_VERSION } from '../src/entities/types';
import type { GameEvent } from '../src/entities/types';

function forceEvent(game: Game, defId: string): GameEvent {
  const ev = EventSystem.spawn(game.ctx, defId)!;
  expect(ev).not.toBeNull();
  return ev;
}

describe('Migration v12 -> v13 (Ereignisse, Marketing, Sound)', () => {
  it('ergänzt Ereignis-/Marketing-/Sound-Felder', () => {
    const game = Game.new(2000);
    const raw = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    raw.version = 12;
    delete raw.activeEvent;
    delete raw.eventLog;
    delete raw.marketingLevel;
    delete raw.soundEnabled;
    const m = migrate(raw);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.activeEvent).toBeNull();
    expect(m.eventLog).toEqual([]);
    expect(m.marketingLevel).toBe(0);
    expect(m.soundEnabled).toBe(true);
  });
});

describe('Ereignisse:.spawnen und entscheiden', () => {
  it('Hebebühne defekt: Express fixt sofort, eigene Crew mit Ausfallzeit', () => {
    const game = Game.new(2001);
    const ev = forceEvent(game, 'lift_breakdown');
    const station = game.state.stations.find((s) => s.id === ev.targetStationId)!;
    expect(station.brokenUntilMinute).toBeGreaterThan(game.state.totalMinutes);
    const before = game.state.economy.balanceCents;
    EventSystem.choose(game.ctx, 'express');
    expect(game.state.activeEvent).toBeNull();
    expect(station.brokenUntilMinute).toBeLessThanOrEqual(game.state.totalMinutes);
    expect(game.state.economy.balanceCents).toBe(before - 25000);
    expect(game.state.eventLog.length).toBe(1);
  });

  it('Hebebühne defekt: eigene Crew repariert günstiger, aber mit Ausfall', () => {
    const game = Game.new(2002);
    const ev = forceEvent(game, 'lift_breakdown');
    const station = game.state.stations.find((s) => s.id === ev.targetStationId)!;
    const before = game.state.economy.balanceCents;
    EventSystem.choose(game.ctx, 'crew');
    expect(game.state.economy.balanceCents).toBe(before);
    expect(station.brokenUntilMinute).toBeGreaterThan(game.state.totalMinutes);
  });

  it('kaputte Bühne wird nicht für Reparaturen zugeteilt', () => {
    const game = Game.new(2003);
    const lift = game.state.stations.find((s) => s.kind === 'lift' && s.unlocked)!;
    lift.brokenUntilMinute = game.state.totalMinutes + 500;
    // freie, nicht kaputte Bühne muss es geben (lift1 defekt, andere frei)
    const brokenFree = game.state.stations.filter(
      (s) => s.kind === 'lift' && s.unlocked && s.orderId === null && (s.brokenUntilMinute ?? 0) > game.state.totalMinutes,
    );
    expect(brokenFree.length).toBeGreaterThan(0);
  });

  it('Mitarbeiter krank: Auskurieren vs. Halbtags', () => {
    const game = Game.new(2004);
    const ev = forceEvent(game, 'worker_sick');
    const w = game.state.workers.find((x) => x.id === ev.targetWorkerId)!;
    EventSystem.choose(game.ctx, 'rest');
    expect(w.sickUntilMinute).toBeGreaterThan(game.state.totalMinutes);
    expect(game.state.workers.every((x) => x.motivation >= 80)).toBe(true);
  });

  it('Lieferverzug: Express-Umleitung stellt ursprüngliche ETA wieder her', () => {
    const game = Game.new(2005);
    game.state.deliveries.push({
      id: 'd-test', partId: 'brake_pads__M__standard', quantity: 2, supplierId: 'teileprofi',
      orderedAtMinute: game.state.totalMinutes, arriveAtMinute: game.state.totalMinutes + 480,
      costCents: 9000, done: false,
    });
    const ev = forceEvent(game, 'supplier_delay');
    const d = game.state.deliveries.find((x) => x.id === ev.targetDeliveryId)!;
    expect(d.arriveAtMinute).toBeGreaterThan(game.state.totalMinutes + 480);
    EventSystem.choose(game.ctx, 'express');
    expect(d.arriveAtMinute).toBe(game.state.totalMinutes + 480);
  });

  it('Inspektion: Ignorieren kostet Reputation und Bußgeld', () => {
    const game = Game.new(2006);
    forceEvent(game, 'inspection');
    const repBefore = game.state.reputation;
    const balBefore = game.state.economy.balanceCents;
    EventSystem.choose(game.ctx, 'ignore');
    expect(game.state.reputation).toBeLessThan(repBefore);
    expect(game.state.economy.balanceCents).toBeLessThan(balBefore);
  });

  it('Großauftrag: Annehmen erzeugt mehrere Aufträge', () => {
    const game = Game.new(2007);
    forceEvent(game, 'fleet_offer');
    const before = game.state.orders.length;
    EventSystem.choose(game.ctx, 'accept');
    expect(game.state.orders.length).toBeGreaterThanOrEqual(before + 3);
  });

  it('Ablauf: ohne Entscheidung wird die Default-Option automatisch gewählt', () => {
    const game = Game.new(2008);
    const ev = forceEvent(game, 'inspection');
    game.state.totalMinutes = ev.expiresAtMinute + 1;
    EventSystem.update(game.ctx);
    expect(game.state.activeEvent).toBeNull();
    expect(game.state.eventLog[0]?.chosenId).toBe(ev.defaultChoiceId);
  });

  it('maximal 2 Ereignisse pro Tag, nur eines gleichzeitig aktiv', () => {
    const game = Game.new(2009);
    forceEvent(game, 'inspection');
    expect(EventSystem.spawn(game.ctx, 'inspection')).toBeNull();
  });
});

describe('Marketing', () => {
  it('höheres Marketing-Level erzeugt mehr Aufträge', () => {
    const count = (level: number): number => {
      const g = Game.new(2010);
      g.state.marketingLevel = level;
      g.state.reputation = 50;
      let n = 0;
      for (let i = 0; i < 300; i++) {
        g.state.nextOrderAttemptAtMinute = 0;
        g.state.totalMinutes = 600;
        g.state.orders = [];
        CustomerSystem.update(g.ctx);
        n += g.state.orders.length;
      }
      return n;
    };
    expect(count(3)).toBeGreaterThan(count(0));
  });

  it('Marketing-Kosten werden täglich verbucht (Level 0 = keine)', () => {
    const high = Game.new(2010);
    high.state.marketingLevel = 3;
    EconomySystem.closeDay(high.state, 1);
    const marketingTx = high.state.economy.transactions.find((t) => t.label.includes('Marketing'));
    expect(marketingTx).toBeDefined();
    expect(marketingTx!.amountCents).toBeLessThan(0);
    const low = Game.new(2010);
    EconomySystem.closeDay(low.state, 1);
    expect(low.state.economy.transactions.some((t) => t.label.includes('Marketing'))).toBe(false);
  });
});

describe('Tagesabschluss-Zusammenfassung', () => {
  it('liefert Umsatz, Gewinn, Aufträge und besten Mitarbeiter', () => {
    const game = Game.new(2011);
    const day = 1;
    const d = EconomySystem.dailyFor(game.state.economy, day);
    d.revenueCents = 50000;
    d.partsCostCents = 10000;
    d.salaryCents = 16000;
    d.fixedCostCents = 5000;
    d.ordersCompleted = 3;
    game.state.workers[0]!.dailyWorkedMinutes = 300;
    game.state.workers[1]!.dailyWorkedMinutes = 100;
    const summary = EconomySystem.buildDailySummary(game.state, day);
    expect(summary.day).toBe(day);
    expect(summary.revenueCents).toBe(50000);
    expect(summary.profitCents).toBe(50000 - 10000 - 16000 - 5000);
    expect(summary.ordersCompleted).toBe(3);
    expect(summary.bestWorkerName).toBe(game.state.workers[0]!.name);
  });
});
