import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { OrderSystem } from '../src/simulation/OrderSystem';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) {
    game.state.inventory.stock[k] = qty;
  }
}

function accept(game: Game, defectId = 'replace_brake_pads') {
  let offer = game.generateOffer();
  if (!offer) {
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    offer = game.generateOffer()!;
  }
  offer.defectRepairIds = [defectId];
  game.acceptOrder(offer.id);
  return offer;
}

function runUntil(game: Game, pred: () => boolean, maxMinutes = 6 * 1440): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !pred()) game.tick(5);
}

describe('Nacht-Automatik (8x außerhalb, 1x bei Auftrag/Arbeitsbeginn)', () => {
  it('schaltet außerhalb der Arbeitszeit auf 8x', () => {
    const game = Game.new(701);
    game.state.totalMinutes = 19 * 60;
    game.setSpeed(2);
    game.tick(1);
    expect(game.state.speed).toBe(16);
  });

  it('schaltet um 08:00 auf 1x', () => {
    const game = Game.new(702);
    game.state.totalMinutes = 7 * 60 + 59;
    game.state.nextOrderAttemptAtMinute = 99999; // keine Angebote
    game.setSpeed(16);
    game.tick(2);
    expect(game.state.totalMinutes % 1440).toBeGreaterThanOrEqual(480);
    expect(game.state.speed).toBe(1);
  });

  it('schaltet bei Auftragseingang sofort auf 1x', () => {
    const game = Game.new(703);
    game.setSpeed(4);
    game.state.nextOrderAttemptAtMinute = game.state.totalMinutes;
    game.rng.chance = () => true;
    game.tick(1);
    expect(game.state.orders.some((o) => o.status === 'incoming')).toBe(true);
    expect(game.state.speed).toBe(1);
  });

  it('Pause bleibt Pause (auch nachts)', () => {
    const game = Game.new(704);
    game.state.totalMinutes = 20 * 60;
    game.setSpeed(0);
    game.tick(120);
    expect(game.state.totalMinutes % 1440).toBe(20 * 60);
    expect(game.state.speed).toBe(0);
  });

  it('nachts läuft die Zeit mit 8x weiter (Ereignisse bleiben erhalten)', () => {
    const game = Game.new(705);
    game.state.totalMinutes = 18 * 60;
    game.setSpeed(8);
    game.orderParts('battery', 1, 'teileprofi'); // kommt 02:00 nachts
    const before = game.state.inventory.stock['battery'] ?? 0;
    game.tick(840); // bis 08:00 nächsten Tages
    expect(game.state.inventory.stock['battery']).toBe(before + 1);
    expect(game.state.speed).toBe(1);
  });
});

describe('Drohende Angebotsablehnung: Nachfrage statt Auto-Cancel', () => {
  it('wartet auf Spielerentscheidung statt sofort zu stornieren', () => {
    const game = Game.new(710);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1; // unerfüllbar
    runUntil(game, () => offer.status === 'waiting_for_approval', 1440);
    game.tick(30);
    expect(offer.status).toBe('waiting_for_approval');
    expect(offer.offerAtRisk).toBe(true);
    expect(offer.approvalDeadline).not.toBeNull();
  });

  it('Rabatt bringt den Preis ins Budget → Freigabe mit Rabatt-Rechnung', () => {
    const game = Game.new(711);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    offer.budgetCents = Math.round(offer.estimateCents! * 0.92); // 10 % Rabatt reicht
    expect(game.offerDiscount(offer.id, 10)).toBe(true);
    expect(offer.discountPct).toBe(10);
    expect(['ready_for_repair', 'waiting_for_parts']).toContain(offer.status);
    runUntil(game, () => offer.status === 'delivered', 6 * 1440);
    expect(offer.status).toBe('delivered');
    const gross = offer.invoiceCents! / (1 - 0.1);
    expect(Math.abs(offer.invoiceCents! - Math.round(gross * 0.9))).toBeLessThan(200);
  });

  it('Preis bestehen → Kunde lehnt ab → storniert', () => {
    const game = Game.new(712);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    game.insistPrice(offer.id);
    expect(offer.status).toBe('cancelled');
  });

  it('ohne Reaktion läuft die Frist ab und der Kunde geht', () => {
    const game = Game.new(713);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 1;
    runUntil(game, () => offer.offerAtRisk, 1440);
    game.tick(300);
    expect(offer.status).toBe('cancelled');
  });

  it('Kundenhistorie ist aus den Aufträgen ableitbar', () => {
    const game = Game.new(714);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 5_000_000;
    runUntil(game, () => offer.status === 'delivered', 6 * 1440);
    const history = game.state.orders.filter(
      (o) => o.customerId === offer.customerId && o.status === 'delivered',
    );
    expect(history.length).toBe(1);
    expect(history[0]!.invoiceCents).toBeGreaterThan(0);
  });
});

describe('Kalkulations-Aufschlüsselung mit Gewinn', () => {
  it('weist Material, Arbeit, Gebühren und Gewinn aus', () => {
    const game = Game.new(720);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 5_000_000;
    runUntil(game, () => offer.revealed, 1440);
    const b = OrderSystem.profitBreakdown(game.ctx, offer);
    expect(b.materialCost).toBeGreaterThan(0);
    expect(b.materialRevenue).toBeGreaterThan(b.materialCost);
    expect(b.laborRevenue).toBeGreaterThan(0);
    expect(b.laborCost).toBeGreaterThan(0);
    expect(b.fee).toBe(4900);
    expect(b.revenue).toBe(b.laborRevenue + b.materialRevenue + b.fee - b.discount);
    expect(b.profit).toBe(b.revenue - b.cost);
    expect(b.profit).toBeGreaterThan(0);
  });

  it('Rabatt mindert den Gewinn', () => {
    const game = Game.new(721);
    stockEverything(game);
    const offer = accept(game);
    offer.budgetCents = 5_000_000;
    runUntil(game, () => offer.revealed, 1440);
    const before = OrderSystem.profitBreakdown(game.ctx, offer).profit;
    offer.discountPct = 10;
    const after = OrderSystem.profitBreakdown(game.ctx, offer).profit;
    expect(after).toBeLessThan(before);
  });
});

describe('Diagnose: Mitarbeiter wartet auf anfahrendes Fahrzeug', () => {
  it('bester Diagnose-Mitarbeiter wartet an der Diagnose, statt in die Pause zu gehen', () => {
    const game = Game.new(730);
    const offer = accept(game);
    game.tick(2);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    expect(v.state).toBe('driving_in');
    const best = [...game.state.workers].sort((a, b) => b.skills.diagnosis - a.skills.diagnosis)[0]!;
    expect(best.state).toBe('waiting');
    expect(best.task).toBeNull();
    // Nach Ankunft übernimmt er die Diagnose
    runUntil(game, () => offer.status === 'diagnosing', 1440);
    expect(offer.assignedWorkerId).toBe(best.id);
  });
});

describe('Laufgeschwindigkeit als deutliches Attribut', () => {
  it('Startmitarbeiter haben deutlich unterschiedliches Tempo', () => {
    const game = Game.new(740);
    const [a, b] = game.state.workers;
    expect(Math.abs(a!.speedTilesPerMinute - b!.speedTilesPerMinute)).toBeGreaterThanOrEqual(0.2);
  });

  it('Kandidaten bringen eigenes Tempo (0.2–0.6) mit', () => {
    const game = Game.new(741);
    for (const c of game.state.candidates) {
      expect(c.speedTilesPerMinute).toBeGreaterThanOrEqual(0.2);
      expect(c.speedTilesPerMinute).toBeLessThanOrEqual(0.6);
    }
    game.state.economy.balanceCents = 100_000_000;
    const cand = game.state.candidates[0]!;
    game.hireCandidate(cand.id);
    const hired = game.state.workers[game.state.workers.length - 1]!;
    expect(hired.speedTilesPerMinute).toBe(cand.speedTilesPerMinute);
  });
});
