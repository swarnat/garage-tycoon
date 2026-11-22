import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { RepairSystem } from '../src/simulation/RepairSystem';
import { UI } from '../src/ui/UI';

it('zeigt Reifen- und Felgenarbeiten in den Fahrzeugdetails an', () => {
  const game = Game.new(42);
  const order = game.state.orders[0]!;
  order.revealed = true;
  order.jobs = ['tire_change', 'rim_replace'].map((id) =>
    RepairSystem.buildJob(game.defs.repairs.find((r) => r.id === id)!),
  );
  const ui: UI = Object.assign(Object.create(UI.prototype), { getGame: () => game });
  const html = ui['renderVehicleDetail'](order.vehicleId);
  expect(html).toContain('Räder auswuchten');
  expect(html).toContain('Felge tauschen');
  expect(game.defs.repairs.flatMap((r) => r.steps.filter((s) => !s.name?.trim()).map((s) => `${r.id}/${s.id}`))).toEqual([]);
});

it('zeigt bei einem leeren Schrittnamen einen Ersatztext', () => {
  const game = Game.new(42);
  const order = game.state.orders[0]!;
  const repair = game.defs.repairs.find((r) => r.id === 'tire_change')!;
  order.revealed = true;
  order.jobs = [RepairSystem.buildJob(repair)];
  const defs = { ...game.defs, repairs: game.defs.repairs.map((r) => r === repair
    ? { ...r, steps: r.steps.map((step, i) => i === 0 ? { ...step, name: '' } : step) }
    : r) };
  const ui: UI = Object.assign(Object.create(UI.prototype), { getGame: () => ({ state: game.state, defs, ctx: { ...game.ctx, defs } }) });
  expect(ui['renderVehicleDetail'](order.vehicleId)).toContain('Arbeitsschritt 1 (15 min)');
});
