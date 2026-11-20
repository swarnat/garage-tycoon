import type { RepairOrder, Vec, Worker } from '../entities/types';
import { QC_BASE_MINUTES } from '../entities/types';
import type { SimContext } from './context';
import { notify, repairDef, stationById, vehicleById } from './context';
import { OrderSystem } from './OrderSystem';
import { DiagnosisSystem } from './DiagnosisSystem';
import { RepairSystem } from './RepairSystem';
import { EconomySystem } from './EconomySystem';
import { InventorySystem } from './InventorySystem';
import { SKILL_LABELS } from './PersonnelSystem';
import { findPath } from '../world/Pathfinding';

/** Bewegung entlang eines Tile-Pfads mit fractionalem Fortschritt. */
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
  if ((w.sickUntilMinute ?? 0) > state.totalMinutes) return false;
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

const TEAM_BONUS = 1.15;

/** Mitarbeiter: Schichten, Bewegung, Aufgabenplanung, Team-Reparaturen. */
export class WorkerSystem {
  static update(ctx: SimContext, dt: number): void {
    const { state } = ctx;
    for (const w of state.workers) {
      if ((w.sickUntilMinute ?? 0) > state.totalMinutes) {
        if (w.task) {
          const order = state.orders.find((o) => o.id === w.task!.orderId);
          if (order) WorkerSystem.releaseSpecific(ctx, order, w);
        }
        w.state = 'off_duty';
        continue;
      }
      const onDuty = isOnDuty(state, w);
      if (onDuty) {
        w.onDutyMinutes += dt;
        w.dailyOnDutyMinutes += dt;
      }
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
              w.motivation = Math.min(100, w.motivation + 5);
              notify(ctx, 'success', `${w.name}: Weiterbildung ${SKILL_LABELS[t.skill]} abgeschlossen (+${t.amount}).`, 'personnel');
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
        if (!WorkerSystem.waitForArrivingDiagnosis(ctx, w, dt)) {
          WorkerSystem.goToBreak(ctx, w, dt);
        }
      }
    }
    WorkerSystem.schedule(ctx);
  }

  /** Fährt ein Fahrzeug zur Diagnose an, wartet der beste Diagnose-Mitarbeiter
   *  bereits an der Diagnose, statt in die Pause zu gehen. */
  private static waitForArrivingDiagnosis(ctx: SimContext, w: Worker, dt: number): boolean {
    const { state } = ctx;
    const arriving = state.orders.find((o) => {
      if (o.status !== 'accepted' || !o.stationId) return false;
      const v = vehicleById(state, o.vehicleId);
      if (v.state !== 'driving_in') return false;
      return stationById(state, o.stationId).kind === 'diagnosis';
    });
    if (!arriving) return false;
    const free = state.workers.filter(
      (x) => x.role === 'mechanic' && !x.task && x.trainingMinutes <= 0 && x.state !== 'off_duty',
    );
    const best = [...free].sort((a, b) => b.skills.diagnosis - a.skills.diagnosis)[0];
    if (!best || best.id !== w.id) return false;
    const station = stationById(state, arriving.stationId!);
    const d = Math.hypot(w.pos.x - station.interact.x, w.pos.y - station.interact.y);
    if (d > 0.4) {
      if (w.path.length === 0) w.path = findPath(ctx.map, w.pos, station.interact) ?? [];
      moveAlongPath(w.pos, w.path, w.speedTilesPerMinute * dt);
    }
    w.state = 'waiting';
    return true;
  }

  /** Untätige Mitarbeiter sammeln sich im Pausenraum (mit persönlichem Platz). */
  private static goToBreak(ctx: SimContext, w: Worker, dt: number): void {
    const br = ctx.state.stations.find((s) =>
      s.kind === (w.role === 'assistant' ? 'office' : 'break_room'),
    );
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
    const { state } = ctx;
    const order = state.orders.find((o) => o.id === task.orderId);
    if (!order || order.status === 'cancelled' || order.status === 'delivered') {
      w.task = null;
      w.path = [];
      w.state = onDuty ? 'idle' : 'off_duty';
      return;
    }
    if (task.kind === 'deliver' && onDuty) {
      w.workedMinutes += dt;
      w.dailyWorkedMinutes += dt;
    }
    if (w.path.length > 0) {
      moveAlongPath(w.pos, w.path, w.speedTilesPerMinute * dt);
      w.state = task.phase === 'to_storage' ? 'fetching_parts' : 'moving';
      return;
    }
    if (task.phase === 'to_storage') {
      // Verbrauch genau einmal – auch bei neu vergebenem, unterbrochenem Transport
      if (!order.partsConsumed) {
        InventorySystem.consumeReserved(state.inventory, order.partsNeeded, state.totalMinutes);
        EconomySystem.recordPartsUsage(ctx, order.partsNeeded);
        order.partsConsumed = true;
      }
      // Lagerhelfer liefern erst an der Bühne ab; Mechaniker tragen selbst.
      if (task.kind !== 'deliver') order.partsAtBay = true;
      for (const n of order.partsNeeded) {
        const stock = state.inventory.stock[n.partId] ?? 0;
        const min = state.inventory.minStock[n.partId] ?? 0;
        if (stock <= min) {
          const p = ctx.defs.parts.find((x) => x.id === n.partId);
          notify(ctx, 'warning', `Lagerbestand niedrig: ${p?.name ?? n.partId} (${stock} Stück)`, 'stock', n.partId);
          ctx.bus.emit('parts:low', n.partId);
        }
      }
      const station = stationById(state, task.stationId);
      const path = findPath(ctx.map, w.pos, station.interact);
      if (!path) {
        WorkerSystem.releaseSpecific(ctx, order, w);
        return;
      }
      w.path = path;
      task.phase = 'to_station';
      w.state = 'moving';
      return;
    }
    if (task.phase === 'to_station') {
      if (task.kind === 'deliver') {
        order.partsAtBay = true;
        const station = stationById(state, task.stationId);
        const stationLabel = station.kind === 'lift' ? 'die Hebebühne' : 'den Diagnoseplatz';
        notify(ctx, 'info', `Lagerhelfer ${w.name}: Ersatzteile an ${stationLabel} geliefert (${order.id}).`, 'workshop');
        ctx.bus.emit('parts:delivered', order.id);
        w.task = null;
        w.path = [];
        w.state = onDuty ? 'idle' : 'off_duty';
        return;
      }
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

    // ---- working: Reparatur (ggf. im Team) ----
    if (task.kind === 'repair') {
      if (order.partsNeeded.length > 0 && !order.partsAtBay) {
        w.state = 'waiting';
        return;
      }
      const job = RepairSystem.currentJob(order);
      if (!job) {
        WorkerSystem.releaseCrew(ctx, order);
        return;
      }
      const def = repairDef(ctx, job.repairId);
      const needed = def.requiredWorkers ?? 1;
      const crew = order.crewIds
        .map((id) => state.workers.find((x) => x.id === id))
        .filter((x): x is Worker => !!x && !!x.task && x.task.orderId === order.id);
      const allWorking =
        crew.length >= needed && crew.every((c) => c.task!.phase === 'working');
      if (!allWorking) {
        w.state = 'waiting';
        return;
      }
      w.state = 'repairing';
      const rate =
        (crew.reduce(
          (a, c) => a + RepairSystem.workRate(c.skills[def.requiredSkill], c.motivation),
          0,
        ) /
          crew.length) *
        (needed > 1 ? TEAM_BONUS : 1);
      job.stepRemainingMinutes -= dt * rate;
      order.laborMinutesActual += dt;
      w.workedMinutes += dt;
      w.dailyWorkedMinutes += dt;
      task.remainingMinutes =
        Math.max(0, job.stepRemainingMinutes) *
        RepairSystem.durationFactor(w.skills[def.requiredSkill]);
      if (job.stepRemainingMinutes <= 0) {
        const prevRepairId = job.repairId;
        const allDone = RepairSystem.advanceStep(ctx, order, w);
        if (allDone) {
          OrderSystem.setStatus(state, order, 'quality_check');
          order.qcRemainingMinutes = QC_BASE_MINUTES;
          ctx.bus.emit('repair:completed', order.id);
          notify(ctx, 'info', `Reparatur abgeschlossen (${order.id}). Qualitätskontrolle steht an.`, 'workshop');
          WorkerSystem.releaseCrew(ctx, order);
        } else {
          const nextJob = RepairSystem.currentJob(order);
          if (nextJob && nextJob.repairId !== prevRepairId) {
            // Folgejob mit anderem Werkzeug/Skill/Teamgröße: Crew freigeben,
            // der Scheduler teilt mit erneuter Prüfung neu ein.
            WorkerSystem.releaseCrew(ctx, order);
            return;
          }
          task.remainingMinutes =
            job.stepRemainingMinutes *
            RepairSystem.durationFactor(w.skills[def.requiredSkill]);
        }
      }
      return;
    }

    // ---- working: Diagnose / Qualitätskontrolle ----
    w.workedMinutes += dt;
    w.dailyWorkedMinutes += dt;
    task.remainingMinutes -= dt;
    if (task.remainingMinutes > 0) return;

    if (task.kind === 'diagnose') {
      const finished = DiagnosisSystem.complete(ctx, order, w);
      if (finished) {
        WorkerSystem.releaseSpecific(ctx, order, w);
      } else {
        task.remainingMinutes =
          order.diagnosisRemainingMinutes *
          RepairSystem.durationFactor(w.skills.diagnosis);
      }
      return;
    }

    // quality_check: kann fehlschlagen → Nacharbeit
    const failChance = Math.max(0, 0.25 - w.skills.diagnosis / 400);
    if (ctx.rng.chance(failChance)) {
      order.qualityIssues += 1;
      state.statistics.qcFailures += 1;
      const lastJob = order.jobs[order.jobs.length - 1];
      if (lastJob) {
        const d = repairDef(ctx, lastJob.repairId);
        lastJob.done = false;
        lastJob.stepIndex = d.steps.length - 1;
        lastJob.stepRemainingMinutes =
          0.4 * (d.steps[lastJob.stepIndex]?.durationMinutes ?? 20);
      }
      OrderSystem.setStatus(state, order, 'repairing');
      order.crewIds = [];
      notify(ctx, 'warning', `Qualitätskontrolle fehlgeschlagen (${order.id}) – Nacharbeit nötig.`, 'workshop');
      WorkerSystem.releaseSpecific(ctx, order, w);
      return;
    }
    ctx.bus.emit('quality_check:completed', order.id);
    OrderSystem.completeAndInvoice(ctx, order, w.skills.diagnosis);
    WorkerSystem.releaseSpecific(ctx, order, w);
  }

  /** Zentrale Aufgabenverteilung: bester freier Mitarbeiter je Auftrag,
   *  Team-Reparaturen werden aufgefüllt, hohe Priorität wechselt durch. */
  private static schedule(ctx: SimContext): void {
    const { state } = ctx;
    const candidates = state.orders
      .filter((o) => {
        if (o.status === 'quality_check') {
          return !o.assignedWorkerId && orderAtWorkstation(ctx, o);
        }
        if (o.status === 'repairing') {
          if (!orderAtWorkstation(ctx, o)) return false;
          const job = RepairSystem.currentJob(o);
          if (!job) return false;
          const def = repairDef(ctx, job.repairId);
          if (!RepairSystem.toolsAvailable(ctx, def)) return false;
          return o.crewIds.length < (def.requiredWorkers ?? 1);
        }
        if (o.status === 'waiting_for_diagnosis') {
          return !o.assignedWorkerId && vehicleById(state, o.vehicleId).state === 'at_diagnosis';
        }
        return false;
      })
      .sort((a, b) => b.priority - a.priority || a.dueAtMinute - b.dueAtMinute);

    const isFree = (w: Worker): boolean =>
      w.role === 'mechanic' &&
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
    const crewNeeded = (order: RepairOrder): number => {
      const job = RepairSystem.currentJob(order);
      if (!job) return 1;
      return repairDef(ctx, job.repairId).requiredWorkers ?? 1;
    };

    for (const order of candidates) {
      if (order.status === 'repairing') {
        while (order.crewIds.length < crewNeeded(order)) {
          const w = bestFor(order, free);
          if (!w) break;
          free.splice(free.indexOf(w), 1);
          WorkerSystem.assignRepair(ctx, w, order);
        }
      } else {
        if (order.assignedWorkerId) continue;
        const w = bestFor(order, free);
        if (!w) continue;
        free.splice(free.indexOf(w), 1);
        assign(w, order);
      }
    }

    // Durchwechseln: hohe Priorität bekommt Mitarbeiter von niedrigerer Priorität
    for (const order of candidates) {
      if (order.priority <= 1) continue;
      const needsWorker =
        order.status === 'repairing'
          ? order.crewIds.length < crewNeeded(order)
          : !order.assignedWorkerId;
      if (!needsWorker) continue;
      const busy = state.workers.filter(
        (w) => w.role === 'mechanic' && w.task && w.trainingMinutes <= 0 && isOnDuty(state, w),
      );
      const eligible = busy.filter((w) => {
        const cur = state.orders.find((o) => o.id === w.task!.orderId);
        if (!cur || cur.id === order.id || cur.priority >= order.priority) return false;
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
      WorkerSystem.releaseSpecific(ctx, cur, pick);
      assign(pick, order);
    }

    WorkerSystem.scheduleDeliveries(ctx);
  }

  /** Stellt sicher, dass angeforderte Teile immer zur Bühne kommen – auch nach
   *  unterbrochenem Transport (Lagerhelfer entlassen/krank). Verbrauch bleibt einmalig. */
  private static scheduleDeliveries(ctx: SimContext): void {
    const { state } = ctx;
    const storage = state.stations.find((s) => s.kind === 'storage');
    if (!storage) return;
    for (const order of state.orders) {
      if (order.repairParking || (order.status !== 'repairing' && order.status !== 'ready_for_repair') ||
          order.partsNeeded.length === 0 || order.partsAtBay) continue;
      if (!order.stationId) continue;
      const hasCarrier = state.workers.some(
        (w) => w.task?.kind === 'deliver' && w.task.orderId === order.id,
      );
      if (hasCarrier) continue;
      const helper = state.workers.find(
        (w) => w.role === 'warehouse' && !w.task && w.trainingMinutes <= 0 &&
          isOnDuty(state, w) && w.state !== 'off_duty',
      );
      if (helper) {
        helper.task = { kind: 'deliver', orderId: order.id, stationId: order.stationId, phase: 'to_storage', remainingMinutes: 0 };
        helper.path = findPath(ctx.map, helper.pos, storage.interact) ?? [];
        helper.state = 'fetching_parts';
        continue;
      }
      // Kein Lagerhelfer frei: wartenden Mechaniker selbst zum Lager schicken
      const mech = order.crewIds
        .map((id) => state.workers.find((w) => w.id === id))
        .find((w) => w?.task?.kind === 'repair' && w.task.phase === 'working' && w.state === 'waiting');
      if (mech && mech.task) {
        mech.task.phase = 'to_storage';
        mech.path = findPath(ctx.map, mech.pos, storage.interact) ?? [];
        mech.state = 'fetching_parts';
      }
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
    if (!order.crewIds.includes(w.id)) order.crewIds.push(w.id);
    order.assignedWorkerId = order.crewIds[0] ?? null;
    // Nur das erste Crew-Mitglied holt die Teile; die anderen warten an der Bühne.
    // Ist ein Lagerhelfer frei, übernimmt er den Gang zum Lager und zur Bühne.
    // Liefern Teile bereits (proaktiver Lagerhelfer), wartet der Mechaniker an der Bühne.
    const carrierActive = ctx.state.workers.some(
      (x) => x.task?.kind === 'deliver' && x.task.orderId === order.id,
    );
    const needsFetch =
      !order.partsAtBay && order.partsNeeded.length > 0 && order.crewIds.length === 1 && !carrierActive;
    const helper = needsFetch
      ? ctx.state.workers.find(
          (x) =>
            x.role === 'warehouse' &&
            !x.task &&
            x.trainingMinutes <= 0 &&
            isOnDuty(ctx.state, x) &&
            x.state !== 'off_duty',
        )
      : undefined;
    if (helper) {
      const storage = ctx.state.stations.find((s) => s.kind === 'storage')!;
      helper.task = {
        kind: 'deliver',
        orderId: order.id,
        stationId: station.id,
        phase: 'to_storage',
        remainingMinutes: 0,
      };
      helper.path = findPath(ctx.map, helper.pos, storage.interact) ?? [];
      helper.state = 'fetching_parts';
    }
    const selfFetch = needsFetch && !helper;
    const target = selfFetch
      ? ctx.state.stations.find((s) => s.kind === 'storage')!.interact
      : station.interact;
    w.task = {
      kind: 'repair',
      orderId: order.id,
      stationId: station.id,
      phase: selfFetch ? 'to_storage' : 'to_station',
      remainingMinutes:
        job.stepRemainingMinutes *
        RepairSystem.durationFactor(w.skills[def.requiredSkill]),
    };
    w.path = findPath(ctx.map, w.pos, target) ?? [];
    w.state = selfFetch ? 'fetching_parts' : 'moving';
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

  /** Gibt ein bestimmtes Crew-Mitglied frei; Fortschritt bleibt im Auftrag. */
  static releaseSpecific(ctx: SimContext, order: RepairOrder, w: Worker): void {
    order.crewIds = order.crewIds.filter((id) => id !== w.id);
    if (order.assignedWorkerId === w.id) {
      order.assignedWorkerId = order.crewIds[0] ?? null;
    }
    const task = w.task;
    if (task && task.orderId === order.id && task.remainingMinutes > 0) {
      // Zurückrechnen auf Basisminuten (ohne Qualifikationsfaktor)
      if (task.kind === 'diagnose') {
        order.diagnosisRemainingMinutes =
          task.remainingMinutes / RepairSystem.durationFactor(w.skills.diagnosis);
        if (order.status === 'diagnosing' && !order.assignedWorkerId) {
          OrderSystem.setStatus(ctx.state, order, 'waiting_for_diagnosis');
        }
      } else if (task.kind === 'quality_check') {
        order.qcRemainingMinutes =
          task.remainingMinutes / RepairSystem.durationFactor(w.skills.diagnosis);
      }
      // Reparatur: job.stepRemainingMinutes führt den Basisfortschritt bereits
    }
    w.task = null;
    w.path = [];
    w.state = isOnDuty(ctx.state, w) ? 'idle' : 'off_duty';
    ctx.bus.emit('worker:available', w.id);
  }

  /** Löst auch den Teiletransport, der nicht zur Reparaturcrew gehört. */
  static releaseOrderTasks(ctx: SimContext, order: RepairOrder): void {
    for (const w of ctx.state.workers) {
      if (w.task?.orderId === order.id) WorkerSystem.releaseSpecific(ctx, order, w);
    }
    order.crewIds = [];
    order.assignedWorkerId = null;
  }

  /** Komplette Crew freigeben (nach Reparaturabschluss). */
  static releaseCrew(ctx: SimContext, order: RepairOrder): void {
    for (const id of [...order.crewIds]) {
      const w = ctx.state.workers.find((x) => x.id === id);
      if (!w) continue;
      w.task = null;
      w.path = [];
      w.state = isOnDuty(ctx.state, w) ? 'idle' : 'off_duty';
      ctx.bus.emit('worker:available', w.id);
    }
    order.crewIds = [];
    order.assignedWorkerId = null;
  }
}
