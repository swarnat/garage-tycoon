import type { RepairOrder, Vec, Worker } from '../entities/types';
import { QC_BASE_MINUTES } from '../entities/types';
import type { SimContext } from './context';
import { notify, repairDef, stationById, vehicleById } from './context';
import { OrderSystem } from './OrderSystem';
import { DiagnosisSystem } from './DiagnosisSystem';
import { RepairSystem } from './RepairSystem';
import { InventorySystem } from './InventorySystem';
import { findPath } from '../world/Pathfinding';

/** Bewegung entlang eines Tile-Pfads mit_fractionalem Fortschritt. */
export function moveAlongPath(pos: Vec, path: Vec[], distance: number): void {
  let remaining = distance;
  while (remaining > 0 && path.length > 0) {
    const next = path[0] as Vec;
    const dx = next.x - pos.x;
    const dy = next.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= remaining || d < 1e-9) {
      pos.x = next.x;
      pos.y = next.y;
      path.shift();
      remaining -= d;
    } else {
      pos.x += (dx / d) * remaining;
      pos.y += (dy / d) * remaining;
      remaining = 0;
    }
  }
}

function isOnDuty(state: { totalMinutes: number }, w: Worker): boolean {
  const m = state.totalMinutes % 1440;
  return m >= w.shiftStartMinute && m < w.shiftEndMinute;
}

function orderAtWorkstation(ctx: SimContext, order: RepairOrder): boolean {
  const v = vehicleById(ctx.state, order.vehicleId);
  if (v.state === 'at_lift') return true;
  return (
    v.state === 'at_diagnosis' && !RepairSystem.orderNeedsLift(ctx, order)
  );
}

/** Mitarbeiter: Schichten, Bewegung, Aufgabenplanung, Arbeitsausführung. */
export class WorkerSystem {
  static update(ctx: SimContext, dt: number): void {
    const { state } = ctx;
    for (const w of state.workers) {
      const onDuty = isOnDuty(state, w);
      if (onDuty) w.onDutyMinutes += dt;
      if (!onDuty && !w.task) {
        w.state = 'off_duty';
        continue;
      }
      if (onDuty && w.state === 'off_duty') w.state = 'idle';
      if (w.task) {
        WorkerSystem.progressTask(ctx, w, dt, onDuty);
      }
    }
    WorkerSystem.schedule(ctx);
  }

  private static progressTask(
    ctx: SimContext,
    w: Worker,
    dt: number,
    onDuty: boolean,
  ): void {
    const task = w.task;
    if (!task) return;
    const order = ctx.state.orders.find((o) => o.id === task.orderId);
    if (!order || order.status === 'cancelled' || order.status === 'delivered') {
      w.task = null;
      w.path = [];
      w.state = onDuty ? 'idle' : 'off_duty';
      return;
    }
    if (w.path.length > 0) {
      moveAlongPath(w.pos, w.path, w.speedTilesPerMinute * dt);
      w.state = task.phase === 'to_storage' ? 'fetching_parts' : 'moving';
      return;
    }
    if (task.phase === 'to_storage') {
      InventorySystem.consumeReserved(ctx.state.inventory, order.partsNeeded);
      order.partsAtBay = true;
      for (const n of order.partsNeeded) {
        const stock = ctx.state.inventory.stock[n.partId] ?? 0;
        const min = ctx.state.inventory.minStock[n.partId] ?? 0;
        if (stock <= min) {
          const p = ctx.defs.parts.find((x) => x.id === n.partId);
          notify(ctx, 'warning', `Lagerbestand niedrig: ${p?.name ?? n.partId} (${stock} Stück)`);
          ctx.bus.emit('parts:low', n.partId);
        }
      }
      const station = stationById(ctx.state, task.stationId);
      const path = findPath(ctx.map, w.pos, station.interact);
      if (!path) {
        // Sollte nicht vorkommen; Aufgabe sicher abbrechen
        WorkerSystem.releaseWorker(ctx, order);
        return;
      }
      w.path = path;
      task.phase = 'to_station';
      w.state = 'moving';
      return;
    }
    if (task.phase === 'to_station') {
      task.phase = 'working';
      w.state =
        task.kind === 'diagnose'
          ? 'diagnosing'
          : task.kind === 'repair'
            ? 'repairing'
            : 'quality_check';
      if (task.kind === 'repair') {
        ctx.bus.emit('repair:started', order.id);
      }
      return;
    }
    // working
    w.workedMinutes += dt;
    if (task.kind === 'repair') order.laborMinutesActual += dt;
    task.remainingMinutes -= dt;
    if (task.remainingMinutes > 0) return;

    if (task.kind === 'diagnose') {
      DiagnosisSystem.complete(ctx, order);
      WorkerSystem.releaseWorker(ctx, order);
      return;
    }
    if (task.kind === 'repair') {
      const allDone = RepairSystem.advanceStep(ctx, order, w);
      if (allDone) {
        OrderSystem.setStatus(ctx.state, order, 'quality_check');
        order.qcRemainingMinutes = QC_BASE_MINUTES;
        ctx.bus.emit('repair:completed', order.id);
        notify(ctx, 'info', `Reparatur abgeschlossen (${order.id}). Qualitätskontrolle steht an.`);
        WorkerSystem.releaseWorker(ctx, order);
      } else {
        const job = RepairSystem.currentJob(order);
        task.remainingMinutes = job ? job.stepRemainingMinutes : 0;
      }
      return;
    }
    // quality_check
    ctx.bus.emit('quality_check:completed', order.id);
    OrderSystem.completeAndInvoice(ctx, order);
    WorkerSystem.releaseWorker(ctx, order);
  }

  /** Zentrale, atomare Aufgabenverteilung: QC > Reparatur > Diagnose. */
  private static schedule(ctx: SimContext): void {
    const { state } = ctx;
    const candidates = state.orders
      .filter((o) => !o.assignedWorkerId)
      .filter((o) => {
        if (o.status === 'quality_check' || o.status === 'repairing') {
          return orderAtWorkstation(ctx, o);
        }
        if (o.status === 'waiting_for_diagnosis') {
          return vehicleById(state, o.vehicleId).state === 'at_diagnosis';
        }
        return false;
      })
      .sort((a, b) => b.priority - a.priority || a.dueAtMinute - b.dueAtMinute);

    for (const w of state.workers) {
      if (w.task || !isOnDuty(state, w) || w.state === 'off_duty') continue;
      for (const order of candidates) {
        if (order.assignedWorkerId) continue;
        if (order.status === 'repairing') {
          const job = RepairSystem.currentJob(order);
          if (!job) continue;
          const def = repairDef(ctx, job.repairId);
          if (!RepairSystem.canWorkerDo(w, def)) continue;
          WorkerSystem.assignRepair(ctx, w, order);
          break;
        }
        if (order.status === 'quality_check') {
          WorkerSystem.assignQualityCheck(ctx, w, order);
          break;
        }
        if (order.status === 'waiting_for_diagnosis') {
          WorkerSystem.assignDiagnosis(ctx, w, order);
          break;
        }
      }
    }
  }

  private static assignDiagnosis(
    ctx: SimContext,
    w: Worker,
    order: RepairOrder,
  ): void {
    DiagnosisSystem.start(ctx, order, w);
    const station = stationById(ctx.state, order.stationId!);
    order.assignedWorkerId = w.id;
    w.task = {
      kind: 'diagnose',
      orderId: order.id,
      stationId: station.id,
      phase: 'to_station',
      remainingMinutes: order.diagnosisRemainingMinutes,
    };
    w.path = findPath(ctx.map, w.pos, station.interact) ?? [];
    w.state = 'moving';
  }

  private static assignRepair(
    ctx: SimContext,
    w: Worker,
    order: RepairOrder,
  ): void {
    const job = RepairSystem.currentJob(order);
    if (!job || !order.stationId) return;
    const def = repairDef(ctx, job.repairId);
    const step = def.steps[job.stepIndex];
    if (!step) return;
    const station = stationById(ctx.state, order.stationId);
    const needsFetch = !order.partsAtBay && order.partsNeeded.length > 0;
    const target = needsFetch
      ? ctx.state.stations.find((s) => s.kind === 'storage')!.interact
      : station.interact;
    order.assignedWorkerId = w.id;
    w.task = {
      kind: 'repair',
      orderId: order.id,
      stationId: station.id,
      phase: needsFetch ? 'to_storage' : 'to_station',
      remainingMinutes:
        step.durationMinutes *
        RepairSystem.durationFactor(w.skills[def.requiredSkill]),
    };
    w.path = findPath(ctx.map, w.pos, target) ?? [];
    w.state = needsFetch ? 'fetching_parts' : 'moving';
  }

  private static assignQualityCheck(
    ctx: SimContext,
    w: Worker,
    order: RepairOrder,
  ): void {
    if (!order.stationId) return;
    const station = stationById(ctx.state, order.stationId);
    order.assignedWorkerId = w.id;
    w.task = {
      kind: 'quality_check',
      orderId: order.id,
      stationId: station.id,
      phase: 'to_station',
      remainingMinutes:
        (order.qcRemainingMinutes || QC_BASE_MINUTES) *
        RepairSystem.durationFactor(w.skills.diagnosis),
    };
    w.path = findPath(ctx.map, w.pos, station.interact) ?? [];
    w.state = 'moving';
  }

  static releaseWorker(ctx: SimContext, order: RepairOrder): void {
    if (!order.assignedWorkerId) return;
    const w = ctx.state.workers.find((x) => x.id === order.assignedWorkerId);
    order.assignedWorkerId = null;
    if (!w) return;
    w.task = null;
    w.path = [];
    w.state = isOnDuty(ctx.state, w) ? 'idle' : 'off_duty';
    ctx.bus.emit('worker:available', w.id);
  }
}
