import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { SaveManager } from '../src/core/SaveManager';
import { InventorySystem } from '../src/simulation/InventorySystem';
import { OrderSystem } from '../src/simulation/OrderSystem';
import { RepairSystem } from '../src/simulation/RepairSystem';
import { VehicleSystem } from '../src/simulation/VehicleSystem';
import { WorkerSystem } from '../src/simulation/WorkerSystem';
import { repairDef, stationById, vehicleById } from '../src/simulation/context';
import { UI } from '../src/ui/UI';

function fixture(ground = false) {
  const game = Game.new(42);
  const order = game.state.orders[0]!;
  const vehicle = vehicleById(game.state, order.vehicleId);
  const bay = stationById(game.state, ground ? 'diag1' : 'lift1');
  const repairId = ground ? 'inspection' : 'replace_brake_pads';
  order.defectRepairIds = [repairId];
  order.revealed = true;
  order.jobs = [RepairSystem.buildJob(repairDef(game.ctx, repairId))];
  order.jobs[0]!.stepIndex = 1;
  order.jobs[0]!.stepRemainingMinutes = 7;
  order.laborMinutesActual = 12;
  order.status = 'repairing';
  order.stationId = bay.id;
  bay.orderId = order.id;
  vehicle.state = ground ? 'at_diagnosis' : 'at_lift';
  vehicle.targetStationId = bay.id;
  vehicle.pos = { x: bay.rect.x, y: bay.rect.y };
  const worker = game.state.workers[0]!;
  order.crewIds = [worker.id];
  order.assignedWorkerId = worker.id;
  worker.state = 'repairing';
  worker.task = { kind: 'repair', orderId: order.id, stationId: bay.id, phase: 'working', remainingMinutes: 7 };
  return { game, order, vehicle, bay, worker };
}

function reload(game: Game) {
  return new Game(SaveManager.parse(SaveManager.serialize(game.state)));
}

describe('Reparatur für zwei Stunden parken', () => {
  it('bietet die Aktion an und lehnt unerreichbare oder belegte Plätze ohne Zustandsänderung ab', () => {
    const { game, order, vehicle } = fixture();
    const ui: UI = Object.assign(Object.create(UI.prototype), { getGame: () => game });
    expect(ui['renderVehicleDetail'](vehicle.id)).toContain('Für 2 Stunden parken');

    const parks = game.state.stations.filter((s) => s.kind === 'parking' && s.unlocked);
    for (const park of parks) park.orderId = order.id;
    const full = structuredClone(game.state);
    expect(game.parkRepair(order.id)).toMatch(/Parkplatz/);
    expect(game.state).toEqual(full);

    for (const park of parks) {
      park.orderId = null;
      park.rect.x = -1;
    }
    const unreachable = structuredClone(game.state);
    expect(game.parkRepair(order.id)).toMatch(/erreichbar/);
    expect(game.state).toEqual(unreachable);
  });

  it('hält die Bühne bis zur Abfahrt und zählt ab Ankunft genau 120 Minuten', () => {
    let { game, order, vehicle, bay, worker } = fixture();
    const deadline = order.dueAtMinute;
    const parts = [{ partId: 'brake_pads__M__standard', quantity: 1 }];
    order.partsNeeded = parts;
    expect(InventorySystem.reserve(game.state.inventory, parts)).toBe(true);
    order.partsReserved = true;
    const before = structuredClone(order.jobs);
    expect(game.parkRepair(order.id)).toBeNull();
    expect(worker.task).toBeNull();
    expect(order.crewIds).toEqual([]);
    expect(bay.orderId).toBe(order.id);
    expect(game.parkRepair(order.id)).toMatch(/Reparatur/);
    const parkId = vehicle.targetStationId!;

    game = reload(game);
    order = game.state.orders[0]!;
    vehicle = vehicleById(game.state, order.vehicleId);
    bay = stationById(game.state, bay.id);
    worker = game.state.workers[0]!;
    OrderSystem.reconcileParking(game.ctx);
    expect(stationById(game.state, parkId).orderId).toBe(order.id);
    VehicleSystem.update(game.ctx, 0);
    expect(bay.orderId).toBe(order.id);
    VehicleSystem.update(game.ctx, 1);
    expect(bay.orderId).toBeNull();

    game.state.totalMinutes += 15;
    VehicleSystem.update(game.ctx, 100);
    expect(vehicle.state).toBe('waiting');
    const resume = game.state.totalMinutes + 120;
    expect(order.repairParking).toEqual({ phase: 'parked', resumeAtMinute: resume });
    expect(order.dueAtMinute).toBe(deadline);
    expect(reload(game).state.orders[0]!.repairParking).toEqual(order.repairParking);
    expect(stationById(game.state, parkId).orderId).toBe(order.id);

    game.state.totalMinutes = resume - 0.25;
    OrderSystem.update(game.ctx);
    expect(vehicle.state).toBe('waiting');

    const other = stationById(game.state, 'lift2');
    other.orderId = 'anderer-auftrag';
    bay.brokenUntilMinute = resume + 1;
    game.state.totalMinutes = resume;
    OrderSystem.update(game.ctx);
    expect(vehicle.state).toBe('waiting');
    expect(other.orderId).toBe('anderer-auftrag');

    game.state.totalMinutes += 1;
    OrderSystem.update(game.ctx);
    expect(vehicle.state).toBe('driving_to_lift');
    expect(bay.orderId).toBe(order.id);
    expect(stationById(game.state, parkId).orderId).toBeNull();
    WorkerSystem.update(game.ctx, 0.25);
    expect(worker.task).toBeNull();

    other.orderId = null;
    game = reload(game);
    order = game.state.orders[0]!;
    vehicle = vehicleById(game.state, order.vehicleId);
    VehicleSystem.update(game.ctx, 100);
    expect(vehicle.state).toBe('at_lift');
    expect(order.status).toBe('repairing');
    expect(order.repairParking).toBeNull();
    expect(order.jobs).toEqual(before);
    expect(order.laborMinutesActual).toBe(12);
    expect(order.partsReserved).toBe(true);
    expect(game.state.inventory.reserved[parts[0]!.partId]).toBe(1);
    expect(order.dueAtMinute).toBe(deadline);
    WorkerSystem.update(game.ctx, 0.25);
    expect(game.state.workers.some((w) => w.task?.kind === 'repair' && w.task.orderId === order.id)).toBe(true);
  });

  it('überspringt unerreichbare freie Plätze auf beiden Fahrten', () => {
    const { game, order, vehicle, bay } = fixture();
    const firstPark = stationById(game.state, 'park1');
    firstPark.rect.x = -1;
    expect(game.parkRepair(order.id)).toBeNull();
    expect(vehicle.targetStationId).toBe('park2');
    expect(firstPark.orderId).toBeNull();
    VehicleSystem.update(game.ctx, 100);
    bay.rect.x = -1;
    game.state.totalMinutes += 120;
    OrderSystem.update(game.ctx);
    expect(vehicle.targetStationId).toBe('lift2');
    expect(bay.orderId).toBeNull();
    VehicleSystem.update(game.ctx, 100);
    expect(vehicle.state).toBe('at_lift');
    expect(order.repairParking).toBeNull();
  });

  it('kehrt nach einer Bodenreparatur zum passenden Diagnoseplatz zurück, ohne erneut zu diagnostizieren', () => {
    const { game, order, bay, vehicle } = fixture(true);
    expect(game.parkRepair(order.id)).toBeNull();
    VehicleSystem.update(game.ctx, 100);
    game.state.totalMinutes += 120;
    OrderSystem.update(game.ctx);
    expect(order.stationId).toBe(bay.id);
    VehicleSystem.update(game.ctx, 100);
    expect(vehicle.state).toBe('at_diagnosis');
    expect(order.status).toBe('repairing');
    expect(order.jobs[0]).toMatchObject({ stepIndex: 1, stepRemainingMinutes: 7 });
  });

  it('löst laufenden Teiletransport ab und verbraucht bereits entnommene Teile nur einmal', () => {
    const { game, order, bay, worker } = fixture();
    const partId = 'brake_pads__M__standard';
    const parts = [{ partId, quantity: 1 }];
    order.partsNeeded = parts;
    order.partsReserved = true;
    expect(InventorySystem.reserve(game.state.inventory, parts)).toBe(true);
    InventorySystem.consumeReserved(game.state.inventory, parts, game.state.totalMinutes);
    order.partsConsumed = true;
    expect(InventorySystem.reserve(game.state.inventory, parts)).toBe(true); // anderer Auftrag
    const inventory = structuredClone(game.state.inventory);
    const helper = game.state.workers[1]!;
    helper.role = 'warehouse';
    helper.state = 'moving';
    helper.task = { kind: 'deliver', orderId: order.id, stationId: bay.id, phase: 'to_station', remainingMinutes: 0 };
    expect(game.parkRepair(order.id)).toBeNull();
    expect(helper.task).toBeNull();
    expect(worker.task).toBeNull();
    WorkerSystem.update(game.ctx, 0.25);
    expect(game.state.workers.every((w) => w.task === null)).toBe(true);
    VehicleSystem.update(game.ctx, 100);
    game.state.totalMinutes += 120;
    OrderSystem.update(game.ctx);
    VehicleSystem.update(game.ctx, 100);
    for (let i = 0; i < 1000 && !order.partsAtBay; i++) WorkerSystem.update(game.ctx, 0.25);
    expect(order.partsAtBay).toBe(true);
    expect(game.state.inventory).toEqual(inventory);
    OrderSystem.cancelOrder(game.ctx, order, 'Test');
    expect(game.state.inventory.reserved[partId]).toBe(1);
  });

  it.each(['outbound', 'parked', 'returning'] as const)('räumt beim Storno in Phase %s alle Plätze und Reservierungen auf', (phase) => {
    const { game, order, vehicle } = fixture();
    const parts = [{ partId: 'brake_pads__M__standard', quantity: 1 }];
    order.partsNeeded = parts;
    order.partsReserved = InventorySystem.reserve(game.state.inventory, parts);
    expect(game.parkRepair(order.id)).toBeNull();
    if (phase !== 'outbound') VehicleSystem.update(game.ctx, 100);
    if (phase === 'returning') {
      game.state.totalMinutes += 120;
      OrderSystem.update(game.ctx);
    }
    expect(order.repairParking?.phase).toBe(phase);
    OrderSystem.cancelOrder(game.ctx, order, 'Test');
    OrderSystem.reconcileParking(game.ctx);
    expect(order.status).toBe('cancelled');
    expect(order.repairParking).toBeNull();
    expect(game.state.stations.every((s) => s.orderId !== order.id)).toBe(true);
    expect(InventorySystem.available(game.state.inventory, parts[0]!.partId)).toBe(game.state.inventory.stock[parts[0]!.partId]);
    VehicleSystem.update(game.ctx, 100);
    expect(vehicle.state).toBe('gone');
  });

  it('lädt alte laufende Reparaturen ohne Parkpause', () => {
    const { game, order } = fixture();
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.version = 14;
    delete raw.orders[0].repairParking;
    const loaded = SaveManager.parse(JSON.stringify(raw));
    expect(loaded.orders[0]).toMatchObject({ status: 'repairing', repairParking: null, jobs: order.jobs });
  });
});
