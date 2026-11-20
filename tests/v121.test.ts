import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { UI } from '../src/ui/UI';

function runUntil(game: Game, predicate: () => boolean, maxMinutes: number): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !predicate()) game.tick(5);
}

it('wertet eine pünktliche Reparatur mit Abholung nach 18 Uhr als pünktlich', () => {
  const game = Game.new(1021);
  game.state.totalMinutes = 14 * 60;
  game.rng.chance = () => false;
  for (const partId of Object.keys(game.state.inventory.stock)) {
    game.state.inventory.stock[partId] = 20;
  }
  const order = game.generateOffer()!;
  order.defectRepairIds = ['replace_brake_pads'];
  order.budgetCents = 5_000_000;
  order.dueAtMinute = 18 * 60;
  expect(game.acceptOrder(order.id)).toBe(true);

  runUntil(game, () => order.status === 'completed', 4 * 60);
  expect(order.status).toBe('completed');
  const completedAt = order.statusLog.find((entry) => entry.status === 'completed')!.atMinute;
  expect(completedAt).toBeLessThan(order.dueAtMinute);
  expect(order.satisfaction).toBe(95);
  expect(order.satisfactionReason).not.toContain('Verspätung');

  order.pickupAtMinute = Math.max(order.dueAtMinute + 30, completedAt + 60);
  const vehicle = game.state.vehicles.find((entry) => entry.id === order.vehicleId)!;
  runUntil(game, () => game.state.totalMinutes > order.dueAtMinute && vehicle.state === 'waiting_pickup', 4 * 60);
  expect(game.state.totalMinutes).toBeGreaterThan(order.dueAtMinute);
  expect(game.state.totalMinutes).toBeLessThan(order.pickupAtMinute);
  expect(order.status).toBe('completed');
  expect(vehicle.state).toBe('waiting_pickup');
  const ui: UI = Object.assign(Object.create(UI.prototype), { getGame: () => game });
  const waitingDetail = ui['renderVehicleDetail'](order.vehicleId);
  expect(waitingDetail).toContain('Termin: Tag 1');

  runUntil(game, () => order.status === 'delivered', 4 * 60);
  expect(order.status).toBe('delivered');
  expect(game.state.totalMinutes).toBeGreaterThanOrEqual(order.pickupAtMinute);
  expect(order.satisfaction).toBe(95);
  expect(order.satisfactionReason).not.toContain('Verspätung');
  expect(waitingDetail).not.toContain('(überschritten!)');
});
