import { describe, expect, it, vi } from 'vitest';
import { Graphics } from 'pixi.js';
import { Game } from '../src/core/Game';
import { Renderer } from '../src/rendering/Renderer';
import { RepairSystem } from '../src/simulation/RepairSystem';
import { WorkerSystem } from '../src/simulation/WorkerSystem';
import { repairDef, stationById } from '../src/simulation/context';

function fixture() {
  const game = Game.new(42);
  game.state.totalMinutes = 600;
  const order = game.state.orders[0]!;
  const vehicle = game.state.vehicles[0]!;
  vehicle.state = 'at_lift';
  for (const worker of game.state.workers) worker.state = 'off_duty';
  const renderer = new Renderer(() => game, vi.fn());
  renderer['initialized'] = true;
  const draw = () => {
    const before = structuredClone(game.state);
    renderer.update(0);
    expect(game.state).toEqual(before);
    return renderer['vehicleSprites'].get(vehicle.id);
  };
  return { game, order, vehicle, draw };
}

describe('Gezeichnete Fahrzeugmarker', () => {
  it('zeichnet Wartemarkierungen aus Graphics und räumt sie bei Statuswechseln auf', () => {
    const { order, vehicle, draw } = fixture();
    order.status = 'waiting_for_parts';
    const waiting = draw()?.getChildByLabel('waiting');
    expect(waiting).toBeInstanceOf(Graphics);
    order.status = 'waiting_for_approval';
    expect(draw()?.getChildByLabel('waiting')).toBe(waiting);
    order.status = 'ready_for_repair';
    expect(draw()?.getChildByLabel('waiting')).toBe(waiting);
    vehicle.state = 'driving_to_lift';
    expect(draw()?.getChildByLabel('waiting')).toBeNull();
    expect(waiting?.destroyed).toBe(true);

    order.status = 'repairing';
    order.repairParking = { phase: 'parked', resumeAtMinute: 700 };
    vehicle.state = 'waiting';
    const paused = draw()?.getChildByLabel('waiting');
    expect(paused).toBeInstanceOf(Graphics);
    order.status = 'completed';
    vehicle.state = 'driving_out';
    const done = draw()?.getChildByLabel('completed');
    expect(done).toBeInstanceOf(Graphics);
    expect(paused?.destroyed).toBe(true);
    vehicle.state = 'gone';
    expect(draw()).toBeUndefined();
    expect(done?.destroyed).toBe(true);
  });

  it('wechselt von der Sanduhr zu Zahnrädern, sobald die Reparatur läuft', () => {
    const { game, order, vehicle, draw } = fixture();
    const bay = stationById(game.state, 'lift1');
    order.status = 'repairing';
    order.stationId = bay.id;
    vehicle.targetStationId = bay.id;
    order.jobs = [RepairSystem.buildJob(repairDef(game.ctx, 'replace_brake_pads'))];
    expect(draw()?.getChildByLabel('waiting')).toBeInstanceOf(Graphics);
    const worker = game.state.workers[0]!;
    worker.state = 'repairing';
    worker.task = { kind: 'repair', orderId: order.id, stationId: 'lift1', phase: 'working', remainingMinutes: 5 };
    order.crewIds = [worker.id];
    order.assignedWorkerId = worker.id;
    expect(draw()?.getChildByLabel('waiting')).toBeNull();
    const gears = draw()?.getChildByLabel('repairing');
    expect(gears).toBeInstanceOf(Graphics);
    expect(draw()?.getChildByLabel('repairing')).toBe(gears);
    worker.state = 'waiting';
    expect(draw()?.getChildByLabel('waiting')).toBeInstanceOf(Graphics);
    expect(gears?.destroyed).toBe(true);
    WorkerSystem.update(game.ctx, 0.25);
    expect(order.laborMinutesActual).toBeGreaterThan(0);
    expect(draw()?.getChildByLabel('waiting')).toBeNull();
    expect(draw()?.getChildByLabel('repairing')).toBeInstanceOf(Graphics);
  });

  it('zeigt die Lupe nur während der aktiven Diagnose', () => {
    const { game, order, vehicle, draw } = fixture();
    vehicle.state = 'at_diagnosis';
    order.status = 'diagnosing';
    const worker = game.state.workers[0]!;
    worker.state = 'diagnosing';
    worker.task = { kind: 'diagnose', orderId: order.id, stationId: 'diag1', phase: 'to_station', remainingMinutes: 5 };
    expect(draw()?.getChildByLabel('waiting')).toBeInstanceOf(Graphics);
    worker.task.phase = 'working';
    const badge = draw()?.getChildByLabel('diagnosing');
    expect(badge).toBeInstanceOf(Graphics);
    expect(draw()?.getChildByLabel('waiting')).toBeNull();
    order.status = 'waiting_for_approval';
    expect(draw()?.getChildByLabel('waiting')).toBeInstanceOf(Graphics);
    expect(badge?.destroyed).toBe(true);
  });
});
