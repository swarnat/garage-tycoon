import { describe, expect, it } from 'vitest';
import { RandomGenerator } from '../src/core/RandomGenerator';
import { GameClock } from '../src/core/GameClock';
import { EventBus } from '../src/core/EventBus';
import { EconomySystem } from '../src/simulation/EconomySystem';
import type { EconomyState } from '../src/entities/types';

function emptyEconomy(): EconomyState {
  return {
    balanceCents: 2_500_000,
    hourlyRateCents: 8500,
    partsMarkupPct: 40,
    transactions: [],
    daily: [],
    bookedIds: [],
  };
}

describe('RandomGenerator', () => {
  it('ist deterministisch bei gleichem Seed', () => {
    const a = new RandomGenerator(42);
    const b = new RandomGenerator(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('liefert Werte in [0,1) und int(n) in [0,n)', () => {
    const r = new RandomGenerator(7);
    for (let i = 0; i < 500; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('serialisiert und restauriert seinen Zustand', () => {
    const r = new RandomGenerator(123);
    for (let i = 0; i < 10; i++) r.next();
    const snapshot = r.state;
    const expected = Array.from({ length: 5 }, () => r.next());
    const restored = RandomGenerator.fromState(123, snapshot);
    const actual = Array.from({ length: 5 }, () => restored.next());
    expect(actual).toEqual(expected);
  });
});

describe('GameClock', () => {
  it('rechnet Spielminuten in Tag und Uhrzeit um', () => {
    const clock = new GameClock(0);
    expect(clock.day).toBe(1);
    expect(clock.minuteOfDay).toBe(0);
    clock.advance(9 * 60 + 30);
    expect(clock.day).toBe(1);
    expect(clock.minuteOfDay).toBe(570);
    expect(clock.formatTime()).toBe('09:30');
    clock.advance(1440 - 570);
    expect(clock.day).toBe(2);
    expect(clock.minuteOfDay).toBe(0);
  });

  it('liefert Tageswechsel-Ereignisse beim Advance', () => {
    const clock = new GameClock(1430);
    const days = clock.advance(20);
    expect(days).toEqual([2]);
  });
});

describe('EventBus', () => {
  it('liefert Ereignisse an Abonnenten und erlaubt Abmelden', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.on('order:created', (p) => seen.push(String(p)));
    bus.emit('order:created', 'A');
    off();
    bus.emit('order:created', 'B');
    expect(seen).toEqual(['A']);
  });
});

describe('EconomySystem', () => {
  it('bucht Beträge in Cent und aktualisiert den Kontostand', () => {
    const eco = emptyEconomy();
    EconomySystem.book(eco, {
      id: 'tx1',
      day: 1,
      atMinute: 100,
      amountCents: -5000,
      category: 'parts_purchase',
      label: 'Bremsbeläge',
    });
    expect(eco.balanceCents).toBe(2_495_000);
    expect(eco.transactions).toHaveLength(1);
  });

  it('verhindert doppelte Buchungen über die Transaktions-ID', () => {
    const eco = emptyEconomy();
    const tx = {
      id: 'invoice-o1',
      day: 1,
      atMinute: 100,
      amountCents: 20000,
      category: 'revenue' as const,
      label: 'Rechnung o1',
      orderId: 'o1',
    };
    expect(EconomySystem.book(eco, tx)).toBe(true);
    expect(EconomySystem.book(eco, tx)).toBe(false);
    expect(eco.balanceCents).toBe(2_520_000);
    expect(eco.transactions).toHaveLength(1);
  });

  it('berechnet Ersatzteil-Verkaufspreise mit Aufschlag', () => {
    expect(EconomySystem.sellPrice(5000, 40)).toBe(7000);
    expect(EconomySystem.sellPrice(4500, 40)).toBe(6300);
  });

  it('lehnt nicht-ganzzahlige Cent-Beträge ab', () => {
    const eco = emptyEconomy();
    expect(() =>
      EconomySystem.book(eco, {
        id: 'bad',
        day: 1,
        atMinute: 0,
        amountCents: 10.5,
        category: 'other',
        label: 'kaputt',
      }),
    ).toThrow();
  });
});
