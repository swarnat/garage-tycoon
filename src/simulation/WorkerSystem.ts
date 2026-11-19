import type { RepairOrder, Vec, Worker } from '../entities/types';
import { QC_BASE_MINUTES } from '../entities/types';
import type { SimContext } from './context';
import { notify, repairDef, stationById, vehicleById } from './context';
import { OrderSystem } from './OrderSystem';
import { DiagnosisSystem } from './DiagnosisSystem';
import { RepairSystem } from './RepairSystem';
import { InventorySystem } from './InventorySystem';
import { SKILL_LABELS } from './PersonnelSystem';
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
      // Weiterbildung: blockiert neue Aufgaben, zählt nur während der Schicht
      if (w.trainingMinutes > 0) {
        if (onDuty) {
          w.state = 'training';
          w.trainingMinutes -= dt;
          if (w.trainingMinutes <= 0) {
            w.trainingMinutes = 0;
            if (w.pendingTraining) {
              const t = w.pendingTraining;
              w.skills[t.skill] = Math.min(100, w.skills[t.skill] + t.amount);
              w.experience += 1;
              notify(ctx, 'success', `${w.name}: Weiterbildung ${SKILL_LABELS[t.skill]} abgeschlossen (+${t.amount}).`);
              w.pendingTraining = null;
            }
            w.state = 'idle';
          }
        } else {
          w.state = 'off_duty';
        }
        continue;
      }
      if (!onDuty && !w.task) {
        w.state = 'off_duty';
        continue;
      }
      if (onDuty && w.state === 'off_duty') w.state = 'idle';
      if (w.task) {
        WorkerSystem.progressTask(ctx, w, dt, onDuty);
      } else if (onDuty) {
        WorkerSystem.goToBreak(ctx, w, dt);
      }
    }
    WorkerSystem.schedule(ctx);
  }

  /** Untätige Mitarbeiter sammeln sich im Pausenraum (mit persönlichem Platz). */
  private static goToBreak(ctx: SimContext, w: Worker, dt: number): void {
    const br = ctx.state.stations.find((s) => s.kind === 'break_room');
    if (!br) {
      w.state = 'idle';
      return;
    }
    const idx = ctx.state.workers.indexOf(w);
    const target = {
      x: br.interact.x + ((idx % 3) - 1) * 0.7,
      y: br.interact.y + Math.floor(idx / 3) * 0.6,
    };
    const dInteract = Math.hypot(w.pos.x - br.interact.x, w.pos.y - br.interact.y);
    if (w.path.length === 0 && dInteract > 1.0) {
      w.path = findPath(ctx.map, w.pos, br.interact) ?? [];
    }
    if (w.path.length > 0) {
      moveAlongPath(w.pos, w.path, w.speedTilesPerMinute * dt);
    } else {
      const dx = target.x - w.pos.x;
      const dy = target.y - w.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.05) {
        const step = Math.min(w.speedTilesPerMinute * dt, d);
        w.pos.x += (dx / d) * step;
        w.pos.y += (dy / d) * step;
      }
    }
    w.state = 'break';
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
      const finished = DiagnosisSystem.complete(ctx, order, w);
      if (finished) {
        WorkerSystem.releaseWorker(ctx, order);
      } else {
        task.remainingMinutes = order.diagnosisRemainingMinutes;
      }
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

  /** Zentrale Aufgabenverteilung: bester freier Mitarbeiter je Auftrag,
   *  bei hoher Priorität wird von niedriger Priorität durchgewechselt. */
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

    const isFree = (w: Worker): boolean =>
      !w.task && w.trainingMinutes <= 0 && isOnDuty(state, w) && w.state !== 'off_duty';
    const free = state.workers.filter(isFree);
    const distance = (w: Worker, order: RepairOrder): number => {
      const st = order.stationId ? stationById(state, order.stationId) : null;
      return st ? Math.abs(w.pos.x - st.interact.x) + Math.abs(w.pos.y - st.interact.y) : 0;
    };
    const bestFor = (order: RepairOrder, pool: Worker[]): Worker | null => {
      if (pool.length === 0) return null;
      if (order.status === 'repairing') {
        const job = RepairSystem.currentJob(order);
        if (!job) return null;
        const def = repairDef(ctx, job.repairId);
        const qualified = pool.filter((w) => RepairSystem.canWorkerDo(w, def));
        if (qualified.length === 0) return null;
        return [...qualified].sort(
          (a, b) =>
            b.skills[def.requiredSkill] - a.skills[def.requiredSkill] ||
            distance(a, order) - distance(b, order),
        )[0] as Worker;
      }
      // Diagnose und Qualitätskontrolle: höchste Diagnose-Kompetenz
      return [...pool].sort(
        (a, b) => b.skills.diagnosis - a.skills.diagnosis || distance(a, order) - distance(b, order),
      )[0] as Worker;
    };
    const assign = (w: Worker, order: RepairOrder): void => {
      if (order.status === 'repairing') WorkerSystem.assignRepair(ctx, w, order);
      else if (order.status === 'quality_check') WorkerSystem.assignQualityCheck(ctx, w, order);
      else WorkerSystem.assignDiagnosis(ctx, w, order);
    };

    for (const order of candidates) {
      if (order.assignedWorkerId) continue;
      const w = bestFor(order, free);
      if (!w) continue;
      free.splice(free.indexOf(w), 1);
      assign(w, order);
    }

    // Durchwechseln: Auftrag mit hoher Priorität bekommt den besten Mitarbeiter
    // von einem Auftrag mit niedrigerer Priorität (Fortschritt bleibt erhalten).
    for (const order of candidates) {
      if (order.assignedWorkerId || order.priority <= 1) continue;
      const busy = state.workers.filter(
        (w) => w.task && w.trainingMinutes <= 0 && isOnDuty(state, w),
      );
      const eligible = busy.filter((w) => {
        const cur = state.orders.find((o) => o.id === w.task!.orderId);
        if (!cur || cur.priority >= order.priority) return false;
        if (order.status === 'repairing') {
          const job = RepairSystem.currentJob(order);
          if (!job) return false;
          return RepairSystem.canWorkerDo(w, repairDef(ctx, job.repairId));
        }
        return true;
      });
      const pick = bestFor(order, eligible);
      if (!pick || !pick.task) continue;
      const cur = state.orders.find((o) => o.id === pick.task!.orderId);
      if (!cur) continue;
      WorkerSystem.releaseWorker(ctx, cur);
      assign(pick, order);
    }
  }

  private static assignDiagnosis(
    ctx: SimContext,
    w: Worker,
    order: RepairOrder,
  ): void {
    DiagnosisSystem.start(ctx, order);
    const station = stationById(ctx.state, order.stationId!);
    order.assignedWorkerId = w.id;
    w.task = {
      kind: 'diagnose',
      orderId: order.id,
      stationId: station.id,
      phase: 'to_station',
      remainingMinutes:
        order.diagnosisRemainingMinutes *
        RepairSystem.durationFactor(w.skills.diagnosis),
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
        job.stepRemainingMinutes *
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

  /** Gibt den Mitarbeiter frei und konserviert den Arbeitsfortschritt im Auftrag. */
  static releaseWorker(ctx: SimContext, order: RepairOrder): void {
    if (!order.assignedWorkerId) return;
    const w = ctx.state.workers.find((x) => x.id === order.assignedWorkerId);
    order.assignedWorkerId = null;
    if (!w) return;
    const task = w.task;
    if (task && task.orderId === order.id && task.remainingMinutes > 0) {
      // Zurückrechnen auf Basisminuten (ohne Qualifikationsfaktor)
      if (task.kind === 'diagnose') {
        order.diagnosisRemainingMinutes =
          task.remainingMinutes / RepairSystem.durationFactor(w.skills.diagnosis);
        if (order.status === 'diagnosing') {
          OrderSystem.setStatus(ctx.state, order, 'waiting_for_diagnosis');
        }
      } else if (task.kind === 'repair') {
        const job = RepairSystem.currentJob(order);
        if (job) {
          const def = repairDef(ctx, job.repairId);
          job.stepRemainingMinutes =
            task.remainingMinutes / RepairSystem.durationFactor(w.skills[def.requiredSkill]);
        }
      } else {
        order.qcRemainingMinutes =
          task.remainingMinutes / RepairSystem.durationFactor(w.skills.diagnosis);
      }
    }
    w.task = null;
    w.path = [];
    w.state = isOnDuty(ctx.state, w) ? 'idle' : 'off_duty';
    ctx.bus.emit('worker:available', w.id);
  }
}
