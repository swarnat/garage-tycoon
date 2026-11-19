import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';

function forceDefect(game: Game, repairId: string): void {
  const orig = game.rng.weighted.bind(game.rng);
  game.rng.weighted = <T,>(items: readonly T[], weights: readonly number[]): T => {
    if (items.includes('standard' as unknown as T)) return 'standard' as unknown as T;
    const want = items.find((i) => (i as { id?: string }).id === repairId);
    return (want ?? orig(items, weights)) as T;
  };
}

describe('Termine: Feierabend-Deadline + probabilistisch mehr Zeit', () => {
  it('alle Termine liegen auf 18:00 (Überfälligkeit erst zum Feierabend)', () => {
    for (let seed = 1700; seed < 1720; seed++) {
      const game = Game.new(seed);
      game.state.totalMinutes = 14 * 60;
      const offer = game.generateOffer()!;
      expect(offer.dueAtMinute % 1440).toBe(18 * 60);
    }
  });

  it('Kleinauftrag nach 11 Uhr bekommt manchmal mehr als einen Tag', () => {
    let extended = 0;
    let base = 0;
    for (let seed = 1730; seed < 1770; seed++) {
      const game = Game.new(seed);
      game.state.totalMinutes = 14 * 60;
      forceDefect(game, 'replace_brake_pads');
      const offer = game.generateOffer()!;
      const days = Math.floor(offer.dueAtMinute / 1440);
      if (days > 1) extended += 1;
      else base += 1;
    }
    expect(extended).toBeGreaterThan(0);
    expect(base).toBeGreaterThan(0);
  });

  it('zeitkritische Kunden: selber Tag 18:00, wenn vor Feierabend', () => {
    const game = Game.new(1780);
    game.state.totalMinutes = 9 * 60;
    const offer = game.generateOffer()!;
    const customer = game.state.customers.find((c) => c.id === offer.customerId)!;
    customer.profile = 'time_critical';
    // Neues Angebot mit time_critical-Profil erzwingen
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    const origPick = game.rng.pick.bind(game.rng);
    game.rng.pick = <T,>(arr: readonly T[]): T => {
      if (arr.includes('time_critical' as unknown as T)) return 'time_critical' as unknown as T;
      return origPick(arr);
    };
    const next = game.generateOffer()!;
    expect(next.dueAtMinute).toBe(18 * 60);
  });

  it('große Arbeiten können bis zu 3 Tage Zeit bekommen', () => {
    let maxDays = 0;
    for (let seed = 1790; seed < 1830; seed++) {
      const game = Game.new(seed);
      game.state.totalMinutes = 9 * 60;
      forceDefect(game, 'replace_brake_discs');
      const offer = game.generateOffer()!;
      maxDays = Math.max(maxDays, Math.floor(offer.dueAtMinute / 1440));
      expect(offer.dueAtMinute % 1440).toBe(18 * 60);
    }
    expect(maxDays).toBeGreaterThanOrEqual(2);
  });
});
