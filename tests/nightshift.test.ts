import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';

describe('Nacht-Skip bei 8×', () => {
  it('nachts wird auf 8x geschaltet und Ereignisse werden verarbeitet', () => {
    const game = Game.new(401);
    game.state.totalMinutes = 18 * 60; // 18:00, Feierabend
    game.setSpeed(2);
    game.orderParts('battery', 1, 'teileprofi'); // +480 min → 02:00 nachts
    const stockBefore = game.state.inventory.stock['battery'] ?? 0;
    game.tick(1);
    expect(game.state.speed).toBe(8);
    game.tick(840); // bis 08:00 nächsten Tages
    expect(Math.floor(game.state.totalMinutes / 1440)).toBe(1);
    expect(game.state.inventory.stock['battery']).toBe(stockBefore + 1);
    expect(game.state.economy.transactions.some((t) => t.id === 'fixed-d1')).toBe(true);
    expect(game.state.speed).toBe(1); // Arbeitsbeginn
  });

  it('schaltet auch abends um 22:00 auf 8x', () => {
    const game = Game.new(402);
    game.state.totalMinutes = 22 * 60;
    game.setSpeed(2);
    game.tick(1);
    expect(game.state.speed).toBe(8);
  });

  it('tagsüber bleibt die gewählte Geschwindigkeit erhalten', () => {
    const game = Game.new(403);
    game.state.totalMinutes = 10 * 60;
    game.state.nextOrderAttemptAtMinute = 99999; // keine Angebote
    game.setSpeed(4);
    game.tick(60);
    expect(game.state.totalMinutes % 1440).toBe(11 * 60);
    expect(game.state.speed).toBe(4);
  });

  it('bei Pause wird nicht übersprungen', () => {
    const game = Game.new(404);
    game.state.totalMinutes = 20 * 60;
    game.setSpeed(0);
    game.tick(120);
    expect(game.state.totalMinutes % 1440).toBe(20 * 60);
  });
});

describe('Pausenraum für untätige Mitarbeiter', () => {
  it('idle Mitarbeiter laufen in den Pausenraum', () => {
    const game = Game.new(410);
    game.tick(180);
    for (const w of game.state.workers) {
      expect(w.state).toBe('break');
      expect(w.pos.y).toBeGreaterThan(10);
      expect(w.pos.x).toBeGreaterThan(1.5);
      expect(w.pos.x).toBeLessThan(5);
    }
  });

  it('Mitarbeiter im Pausenraum werden für Aufträge eingeteilt', () => {
    const game = Game.new(411);
    game.tick(180);
    expect(game.state.workers.every((w) => w.state === 'break')).toBe(true);
    for (const k of Object.keys(game.state.inventory.stock)) {
      game.state.inventory.stock[k] = 20;
    }
    const offer = game.generateOffer()!;
    offer.budgetCents = 5_000_000;
    game.acceptOrder(offer.id);
    const limit = game.state.totalMinutes + 1440;
    while (game.state.totalMinutes < limit && offer.status !== 'diagnosing') game.tick(5);
    expect(offer.status).toBe('diagnosing');
    expect(offer.assignedWorkerId).not.toBeNull();
  });

  it('nach Feierabend sind Mitarbeiter off_duty (werden ausgeblendet)', () => {
    const game = Game.new(412);
    game.state.totalMinutes = 19 * 60;
    game.tick(5);
    for (const w of game.state.workers) {
      expect(w.state).toBe('off_duty');
    }
  });
});

describe('Individuelle Geschwindigkeit', () => {
  it('Mitarbeiter haben unterschiedliches Tempo und laufen unterschiedlich schnell', () => {
    const game = Game.new(420);
    const [w1, w2] = game.state.workers;
    game.setWorkerSpeed(w1!.id, 0.6);
    game.setWorkerSpeed(w2!.id, 0.2);
    expect(w1!.speedTilesPerMinute).toBe(0.6);
    expect(w2!.speedTilesPerMinute).toBe(0.2);
    game.tick(10);
    // beide laufen Richtung Pausenraum, unterschiedlich weit
    expect(w1!.pos).not.toEqual(w2!.pos);
    const d1 = Math.hypot(w1!.pos.x - 4, w1!.pos.y - 6);
    const d2 = Math.hypot(w2!.pos.x - 6, w2!.pos.y - 7);
    expect(d1).toBeGreaterThan(d2);
  });

  it('Geschwindigkeit wird begrenzt', () => {
    const game = Game.new(421);
    game.setWorkerSpeed('w1', 5);
    expect(game.state.workers[0]!.speedTilesPerMinute).toBeLessThanOrEqual(0.6);
    game.setWorkerSpeed('w1', 0.01);
    expect(game.state.workers[0]!.speedTilesPerMinute).toBeGreaterThanOrEqual(0.2);
  });

  it('eingestellte Mitarbeiter bringen eigenes Tempo mit', () => {
    const game = Game.new(422);
    game.state.economy.balanceCents = 100_000_000;
    game.hireCandidate(game.state.candidates[0]!.id);
    const hired = game.state.workers[2]!;
    expect(hired.speedTilesPerMinute).toBeGreaterThanOrEqual(0.2);
    expect(hired.speedTilesPerMinute).toBeLessThanOrEqual(0.6);
  });
});
