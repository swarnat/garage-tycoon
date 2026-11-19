import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { notify } from '../src/simulation/context';
import { SupplierSystem } from '../src/simulation/SupplierSystem';

describe('Niedrigbestand-Meldung mit Lager-Link', () => {
  it('notify trägt optional eine partId für den Lagereintrag-Link', () => {
    const game = Game.new(2100);
    notify(game.ctx, 'warning', 'Lagerbestand niedrig: Bremsbeläge (1 Stück)', 'brake_pads__M__standard');
    const n = game.state.notifications[game.state.notifications.length - 1]!;
    expect(n.partId).toBe('brake_pads__M__standard');
  });

  it('notify ohne partId lässt das Feld weg', () => {
    const game = Game.new(2101);
    notify(game.ctx, 'info', 'Hallo');
    const n = game.state.notifications[game.state.notifications.length - 1]!;
    expect(n.partId).toBeUndefined();
  });
});

describe('Manuelle Bestellung mit Lieferantenwahl', () => {
  it('ExpressParts liefert in 60 min (Eiligung möglich)', () => {
    const game = Game.new(2102);
    game.state.inventory.capacity = 5000;
    const ok = SupplierSystem.orderParts(game.ctx, 'brake_pads__M__standard', 2, 'expressparts', false);
    expect(ok).toBe(true);
    const d = game.state.deliveries[game.state.deliveries.length - 1]!;
    expect(d.supplierId).toBe('expressparts');
    expect(d.arriveAtMinute - game.state.totalMinutes).toBe(60);
  });

  it('TeileProfi liefert in 480 min', () => {
    const game = Game.new(2103);
    game.state.inventory.capacity = 5000;
    SupplierSystem.orderParts(game.ctx, 'brake_pads__M__standard', 2, 'teileprofi', false);
    const d = game.state.deliveries[game.state.deliveries.length - 1]!;
    expect(d.supplierId).toBe('teileprofi');
    expect(d.arriveAtMinute - game.state.totalMinutes).toBe(480);
  });
});
