import type {
  GameState,
  OrderStatus,
  RepairOrder,
  Station,
  Vehicle,
} from '../entities/types';
import { DIAGNOSIS_FEE_CENTS } from '../entities/types';
import type { SimContext } from './context';
import { notify, repairDef, stationById, vehicleById } from './context';
import { InventorySystem } from './InventorySystem';
import { RepairSystem } from './RepairSystem';
import { EconomySystem } from './EconomySystem';
import { WorkerSystem } from './WorkerSystem';
import { SKILL_LABELS } from './PersonnelSystem';
import { findPath } from '../world/Pathfinding';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  incoming: ['accepted', 'cancelled'],
  accepted: ['waiting_for_diagnosis', 'cancelled'],
  waiting_for_diagnosis: ['diagnosing', 'cancelled'],
  diagnosing: ['waiting_for_approval', 'waiting_for_diagnosis', 'cancelled'],
  waiting_for_approval: ['ready_for_repair', 'waiting_for_parts', 'cancelled'],
  waiting_for_parts: ['ready_for_repair', 'cancelled'],
  ready_for_repair: ['repairing', 'cancelled'],
  repairing: ['quality_check', 'cancelled'],
  quality_check: ['completed', 'repairing', 'cancelled'],
  completed: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Auftragsstatusmaschine und Platzverwaltung. */
export class OrderSystem {
  static canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  static setStatus(
    state: GameState,
    order: RepairOrder,
    next: OrderStatus,
  ): void {
    if (!OrderSystem.canTransition(order.status, next)) {
      throw new Error(
        `Ungültiger Statusübergang ${order.status} → ${next} (${order.id})`,
      );
    }
    order.status = next;
    order.statusLog.push({ atMinute: state.totalMinutes, status: next });
    if (order.statusLog.length > 30) {
      order.statusLog.splice(0, order.statusLog.length - 30);
    }
  }

  static update(ctx: SimContext): void {
    const { state } = ctx;
    for (const order of [...state.orders]) {
      switch (order.status) {
        case 'incoming':
          if (
            order.expiresAtMinute !== null &&
            state.totalMinutes >= order.expiresAtMinute
          ) {
            OrderSystem.cancelOrder(ctx, order, 'Angebot abgelaufen');
          }
          break;
        case 'accepted': {
          const v = vehicleById(state, order.vehicleId);
          if (v.state === 'waiting') OrderSystem.tryDiagnosisPlacement(ctx, order);
          break;
        }
        case 'waiting_for_approval':
          OrderSystem.decideApproval(ctx, order);
          break;
        case 'diagnosing':
          // Selbstheilung: verwaiste Diagnose (z. B. nach Entlassung) neu vergeben
          if (!order.assignedWorkerId) {
            OrderSystem.setStatus(state, order, 'waiting_for_diagnosis');
          }
          break;
        case 'waiting_for_parts':
          if (InventorySystem.reserve(state.inventory, order.partsNeeded)) {
            order.partsReserved = true;
            OrderSystem.setStatus(state, order, 'ready_for_repair');
          }
          break;
        case 'ready_for_repair':
          OrderSystem.placeAtRepairStation(ctx, order);
          break;
        default:
          break;
      }
    }
    // Alte abgeschlossene Aufträge aufräumen (Fahrzeuge/Referenzen bleiben konsistent)
    if (state.orders.length > 80) {
      const keep = state.orders.filter(
        (o) => o.status !== 'delivered' && o.status !== 'cancelled',
      );
      const archive = state.orders
        .filter((o) => o.status === 'delivered' || o.status === 'cancelled')
        .slice(-40);
      state.orders = [...keep, ...archive];
      const keepIds = new Set(state.orders.map((o) => o.id));
      state.vehicles = state.vehicles.filter(
        (v) => keepIds.has(v.orderId) || v.state !== 'gone',
      );
    }
  }

  static tryDiagnosisPlacement(ctx: SimContext, order: RepairOrder): void {
    const { state } = ctx;
    const diag = state.stations.find(
      (s) => s.kind === 'diagnosis' && s.unlocked && s.orderId === null,
    );
    if (!diag) return;
    const v = vehicleById(state, order.vehicleId);
    const old = order.stationId ? stationById(state, order.stationId) : null;
    if (old) old.orderId = null;
    diag.orderId = order.id;
    order.stationId = diag.id;
    v.state = 'driving_in';
    OrderSystem.dispatchVehicle(ctx, v, diag);
  }

  static decideApproval(ctx: SimContext, order: RepairOrder): void {
    const { state } = ctx;
    const estimate = order.estimateCents ?? 0;
    if (estimate <= order.budgetCents) {
      ctx.bus.emit('estimate:approved', order.id);
      if (InventorySystem.reserve(state.inventory, order.partsNeeded)) {
        order.partsReserved = true;
        OrderSystem.setStatus(state, order, 'ready_for_repair');
      } else {
        OrderSystem.setStatus(state, order, 'waiting_for_parts');
        const missing = order.partsNeeded
          .filter(
            (n) =>
              InventorySystem.available(state.inventory, n.partId) < n.quantity,
          )
          .map((n) => {
            const p = ctx.defs.parts.find((x) => x.id === n.partId);
            return `${n.quantity}× ${p?.name ?? n.partId}`;
          })
          .join(', ');
        notify(ctx, 'warning', `Auftrag ${order.id}: Ersatzteile fehlen (${missing}). Bitte im Lager bestellen.`);
      }
    } else {
      ctx.bus.emit('estimate:rejected', order.id);
      notify(
        ctx,
        'warning',
        `Kunde lehnt Kostenvoranschlag für ${order.id} ab (${(estimate / 100).toFixed(2)} € über Budget).`,
      );
      OrderSystem.cancelOrder(ctx, order, 'Kostenvoranschlag abgelehnt');
    }
  }

  static placeAtRepairStation(ctx: SimContext, order: RepairOrder): void {
    const { state } = ctx;
    const v = vehicleById(state, order.vehicleId);
    if (!RepairSystem.orderNeedsLift(ctx, order)) {
      if (v.state === 'at_diagnosis') {
        OrderSystem.setStatus(state, order, 'repairing');
      }
      return;
    }
    if (v.state !== 'at_diagnosis' && v.state !== 'waiting') return;
    const lift = state.stations.find(
      (s) => s.kind === 'lift' && s.unlocked && s.orderId === null,
    );
    if (!lift) return;
    const old = order.stationId ? stationById(state, order.stationId) : null;
    if (old) old.orderId = null;
    lift.orderId = order.id;
    order.stationId = lift.id;
    v.state = 'driving_to_lift';
    if (!OrderSystem.dispatchVehicle(ctx, v, lift)) {
      // Kein Pfad: Platz wieder freigeben, nächster Tick versucht es erneut
      lift.orderId = null;
      order.stationId = old ? old.id : null;
      if (old) old.orderId = order.id;
      v.state = old?.kind === 'diagnosis' ? 'at_diagnosis' : 'waiting';
    }
  }

  static dispatchVehicle(
    ctx: SimContext,
    vehicle: Vehicle,
    station: Station,
  ): boolean {
    const goal = { x: station.rect.x, y: station.rect.y };
    const path = findPath(ctx.map, vehicle.pos, goal, {
      vehicleTargetRect: station.rect,
    });
    if (!path) return false;
    vehicle.path = path;
    vehicle.targetStationId = station.id;
    return true;
  }

  static sendVehicleOut(ctx: SimContext, vehicle: Vehicle): void {
    const exit = ctx.state.stations.find((s) => s.kind === 'exit');
    if (!exit) return;
    vehicle.state = 'driving_out';
    const path = findPath(
      ctx.map,
      vehicle.pos,
      { x: exit.rect.x, y: exit.rect.y },
      { vehicleTargetRect: exit.rect },
    );
    vehicle.path = path ?? [];
    vehicle.targetStationId = null;
    if (!path) {
      vehicle.state = 'gone';
    }
  }

  static onVehicleArrived(ctx: SimContext, vehicle: Vehicle): void {
    const { state } = ctx;
    const order = state.orders.find((o) => o.id === vehicle.orderId);
    if (!order) {
      vehicle.state = 'gone';
      return;
    }
    if (vehicle.state === 'driving_in') {
      const station = vehicle.targetStationId
        ? stationById(state, vehicle.targetStationId)
        : null;
      if (station?.kind === 'diagnosis') {
        vehicle.state = 'at_diagnosis';
        if (order.status === 'accepted') {
          OrderSystem.setStatus(state, order, 'waiting_for_diagnosis');
        }
      } else {
        vehicle.state = 'waiting';
      }
    } else if (vehicle.state === 'driving_to_lift') {
      vehicle.state = 'at_lift';
      if (order.status === 'ready_for_repair') {
        OrderSystem.setStatus(state, order, 'repairing');
        notify(ctx, 'info', `${vehicle.make} ${vehicle.model} steht auf der Hebebühne (${order.id}).`);
      }
    } else if (vehicle.state === 'driving_out') {
      vehicle.state = 'gone';
      vehicle.path = [];
      if (order.stationId) {
        stationById(state, order.stationId).orderId = null;
        order.stationId = null;
      }
      if (order.status === 'completed') {
        OrderSystem.setStatus(state, order, 'delivered');
        ctx.bus.emit('order:delivered', order.id);
        // Reklamation: unwahrscheinlich bei guter Qualität, teuer bei schlechter
        const complaintChance = Math.max(0, 0.2 - (order.qualityScore ?? 0.8) * 0.15);
        if (ctx.rng.chance(complaintChance)) {
          const refund = Math.round((order.invoiceCents ?? 0) * 0.2);
          EconomySystem.book(state.economy, {
            id: `complaint-${order.id}`,
            day: Math.floor(state.totalMinutes / 1440) + 1,
            atMinute: state.totalMinutes,
            amountCents: -refund,
            category: 'other',
            label: `Reklamation ${order.id} (20 % Erstattung)`,
            orderId: order.id,
          });
          state.statistics.complaints += 1;
          state.reputation = Math.max(0, state.reputation - 4);
          order.satisfaction = Math.max(20, (order.satisfaction ?? 80) - 25);
          notify(ctx, 'danger', `Reklamation zu ${order.id}: ${(refund / 100).toFixed(2)} € erstattet, Reputation −4.`);
        }
        notify(
          ctx,
          'success',
          `Auftrag ${order.id} ausgeliefert. Rechnung: ${(order.invoiceCents! / 100).toFixed(2)} €`,
        );
      }
    }
  }

  static cancelOrder(
    ctx: SimContext,
    order: RepairOrder,
    reason: string,
  ): void {
    const { state } = ctx;
    if (order.status === 'cancelled' || order.status === 'delivered') return;
    if (order.partsReserved && !order.partsAtBay) {
      InventorySystem.release(state.inventory, order.partsNeeded);
      order.partsReserved = false;
    }
    if (order.assignedWorkerId) {
      WorkerSystem.releaseWorker(ctx, order);
    }
    order.crewIds = [];
    if (order.stationId) {
      stationById(state, order.stationId).orderId = null;
      order.stationId = null;
    }
    const v = state.vehicles.find((x) => x.id === order.vehicleId);
    if (v) {
      if (v.state === 'incoming') {
        v.state = 'gone';
      } else if (v.state !== 'gone' && v.state !== 'driving_out') {
        OrderSystem.sendVehicleOut(ctx, v);
      }
    }
    OrderSystem.setStatus(state, order, 'cancelled');
    state.statistics.ordersCancelled += 1;
    ctx.bus.emit('order:cancelled', { orderId: order.id, reason });
  }

  /** Beschreibt, worauf ein Auftrag aktuell wartet (null = läuft normal). */
  static waitReason(ctx: SimContext, order: RepairOrder): string | null {
    const { state } = ctx;
    const v = state.vehicles.find((x) => x.id === order.vehicleId);
    const m = state.totalMinutes % 1440;
    const onDuty = (w: (typeof state.workers)[number]): boolean =>
      m >= w.shiftStartMinute && m < w.shiftEndMinute;
    const freeWorkers = state.workers.filter(
      (w) => !w.task && w.trainingMinutes <= 0 && onDuty(w),
    );
    const worker = order.assignedWorkerId
      ? state.workers.find((w) => w.id === order.assignedWorkerId)
      : null;
    switch (order.status) {
      case 'accepted':
        if (v?.state === 'driving_in') return 'Fahrzeug fährt in die Werkstatt.';
        if (v?.state === 'waiting') return 'Wartet auf einen freien Diagnoseplatz.';
        return null;
      case 'waiting_for_diagnosis':
        if (state.workers.length > 0 && state.workers.every((w) => w.trainingMinutes > 0)) {
          return 'Alle Mitarbeiter sind in Weiterbildung.';
        }
        if (freeWorkers.length === 0) {
          return state.workers.some(onDuty)
            ? 'Wartet auf freien Mitarbeiter für die Diagnose (alle gebunden).'
            : 'Außerhalb der Arbeitszeit (08:00–18:00).';
        }
        return 'Wartet auf freien Mitarbeiter für die Diagnose.';
      case 'diagnosing':
        if (order.diagnosisExtended) return 'Nachuntersuchung läuft – unerfahrene Diagnose.';
        if (!worker) return 'Wartet auf Mitarbeiter für die Diagnose.';
        return null;
      case 'waiting_for_approval':
        return 'Kunde prüft den Kostenvoranschlag.';
      case 'waiting_for_parts': {
        const missing = order.partsNeeded.filter(
          (n) => InventorySystem.available(state.inventory, n.partId) < n.quantity,
        );
        const names = missing
          .map((n) => {
            const p = ctx.defs.parts.find((x) => x.id === n.partId);
            return `${n.quantity}× ${p?.name ?? n.partId}`;
          })
          .join(', ');
        const open = state.deliveries.filter(
          (d) => !d.done && missing.some((n) => n.partId === d.partId),
        );
        if (open.length > 0) {
          const eta = Math.min(...open.map((d) => d.arriveAtMinute)) - state.totalMinutes;
          return `Wartet auf Ersatzteile: ${names} (Lieferung in ${(Math.max(0, eta) / 60).toFixed(1)} h).`;
        }
        return `Wartet auf Ersatzteile: ${names} – noch nicht bestellt!`;
      }
      case 'ready_for_repair':
        if (v?.state === 'driving_to_lift') return 'Fahrzeug fährt zur Hebebühne.';
        if (
          RepairSystem.orderNeedsLift(ctx, order) &&
          !state.stations.some((s) => s.kind === 'lift' && s.unlocked && s.orderId === null)
        ) {
          return 'Wartet auf eine freie Hebebühne.';
        }
        return null;
      case 'repairing': {
        const job = RepairSystem.currentJob(order);
        if (job) {
          const def = repairDef(ctx, job.repairId);
          if (!RepairSystem.toolsAvailable(ctx, def)) {
            const names = RepairSystem.missingTools(ctx, def)
              .map((t) => ctx.defs.tools.find((x) => x.id === t)?.name ?? t)
              .join(', ');
            return `Benötigt Spezialwerkzeug: ${names} (im Ausbau kaufen).`;
          }
          const needed = def.requiredWorkers ?? 1;
          if (order.crewIds.length > 0 && order.crewIds.length < needed) {
            return `Wartet auf zweiten Mitarbeiter (Team-Reparatur, ${order.crewIds.length}/${needed}).`;
          }
        }
        if (!worker) {
          if (job) {
            const def = repairDef(ctx, job.repairId);
            const qualified = state.workers.filter(
              (w) => w.skills[def.requiredSkill] >= def.minimumSkillLevel,
            );
            if (qualified.length === 0) {
              return `Kein Mitarbeiter qualifiziert: ${SKILL_LABELS[def.requiredSkill]} ≥ ${def.minimumSkillLevel} benötigt.`;
            }
            return `Wartet auf freien Mitarbeiter (${SKILL_LABELS[def.requiredSkill]}).`;
          }
          return 'Wartet auf Mitarbeiter.';
        }
        if (worker.state === 'waiting') return 'Wartet auf Team-Kollegen an der Hebebühne.';
        if (worker.task?.phase === 'to_storage') return 'Mitarbeiter holt Ersatzteile aus dem Lager.';
        if (worker.task?.phase === 'to_station') return 'Mitarbeiter ist unterwegs zum Fahrzeug.';
        return null;
      }
      case 'quality_check':
        if (!worker) return 'Wartet auf Mitarbeiter für die Qualitätskontrolle.';
        if (worker.task?.phase === 'to_station') return 'Mitarbeiter ist unterwegs zur Qualitätskontrolle.';
        return null;
      case 'completed':
        return 'Fahrzeug verlässt die Werkstatt.';
      default:
        return null;
    }
  }

  /** Qualitätskontrolle bestanden → Rechnung (genau einmal) → Auslieferung. */
  static completeAndInvoice(ctx: SimContext, order: RepairOrder, qcSkill = 50): void {
    const { state } = ctx;
    if (order.billed) return;
    const laborCents = Math.round(
      (order.laborMinutesActual / 60) * state.economy.hourlyRateCents,
    );
    const partsCents = RepairSystem.partsSellTotal(ctx, order);
    const invoice = laborCents + partsCents + DIAGNOSIS_FEE_CENTS;
    const booked = EconomySystem.book(state.economy, {
      id: `invoice-${order.id}`,
      day: Math.floor(state.totalMinutes / 1440) + 1,
      atMinute: state.totalMinutes,
      amountCents: invoice,
      category: 'revenue',
      label: `Rechnung ${order.id}`,
      orderId: order.id,
    });
    if (!booked) return;
    order.invoiceCents = invoice;
    order.billed = true;
    order.qualityScore = Math.max(
      0.2,
      Math.min(1, 0.6 + qcSkill / 250 - order.qualityIssues * 0.15),
    );
    let satisfaction = 95;
    if (state.totalMinutes > order.dueAtMinute) satisfaction -= 30;
    if (invoice > order.budgetCents * 1.15) satisfaction -= 15;
    satisfaction = Math.max(20, Math.min(100, satisfaction));
    order.satisfaction = satisfaction;
    const customer = state.customers.find((c) => c.id === order.customerId);
    if (customer) customer.lastSatisfaction = satisfaction;
    state.reputation = Math.max(
      0,
      Math.min(100, state.reputation + (satisfaction - 60) / 25),
    );
    state.statistics.ordersCompleted += 1;
    state.statistics.totalRevenueCents += invoice;
    state.statistics.totalLaborMinutes += order.laborMinutesActual;
    state.statistics.satisfactionSum += satisfaction;
    EconomySystem.dailyFor(
      state.economy,
      Math.floor(state.totalMinutes / 1440) + 1,
    ).ordersCompleted += 1;
    OrderSystem.setStatus(state, order, 'completed');
    const v = vehicleById(state, order.vehicleId);
    OrderSystem.sendVehicleOut(ctx, v);
    ctx.bus.emit('order:completed', order.id);
    ctx.bus.emit('invoice:paid', { orderId: order.id, amountCents: invoice });
  }
}
