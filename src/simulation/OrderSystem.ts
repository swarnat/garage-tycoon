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
    OrderSystem.reconcileParking(ctx);
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
        case 'completed': {
          const v = vehicleById(state, order.vehicleId);
          if (v.state === 'at_lift' || v.state === 'at_diagnosis') {
            OrderSystem.tryMoveToParking(ctx, order, v);
          }
          const readyToLeave =
            order.pickupAtMinute !== null && state.totalMinutes >= order.pickupAtMinute;
          if (readyToLeave && (v.state === 'waiting_pickup' || v.state === 'waiting' || v.state === 'at_lift' || v.state === 'at_diagnosis')) {
            if ((v.state === 'waiting_pickup' || v.state === 'waiting') && v.targetStationId) {
              stationById(state, v.targetStationId).orderId = null;
            } else if (order.stationId) {
              stationById(state, order.stationId).orderId = null;
              order.stationId = null;
            }
            OrderSystem.sendVehicleOut(ctx, v);
          }
          break;
        }
        case 'waiting_for_approval':
          if (order.offerAtRisk) {
            if (order.approvalDeadline !== null && state.totalMinutes > order.approvalDeadline) {
              notify(ctx, 'warning', `${order.id}: Kunde hat sich mangels Reaktion entschieden abzulehnen.`);
              OrderSystem.cancelOrder(ctx, order, 'Keine Reaktion auf Angebotsnachfrage');
            }
          } else {
            OrderSystem.decideApproval(ctx, order);
          }
          break;
        case 'diagnosing':
          // Selbstheilung: verwaiste Diagnose (z. B. nach Entlassung) neu vergeben
          if (!order.assignedWorkerId) {
            OrderSystem.setStatus(state, order, 'waiting_for_diagnosis');
          }
          break;
        case 'waiting_for_parts': {
          if (InventorySystem.reserve(state.inventory, order.partsNeeded)) {
            order.partsReserved = true;
            OrderSystem.setStatus(state, order, 'ready_for_repair');
          } else {
            OrderSystem.checkPartsPrompt(ctx, order);
            // Warten auf Teile passiert auf dem Parkplatz, nicht auf der Diagnose
            const v = vehicleById(state, order.vehicleId);
            if (v.state === 'at_diagnosis' || v.state === 'at_lift') {
              OrderSystem.tryMoveToParking(ctx, order, v);
            }
          }
          break;
        }
        case 'ready_for_repair': {
          const v = vehicleById(state, order.vehicleId);
          // Selbstheilung (z. B. nach Migration): Fahrzeug bereits an der Bühne
          if (v.state === 'at_lift' && order.stationId) {
            OrderSystem.setStatus(state, order, 'repairing');
            break;
          }
          if (!RepairSystem.orderNeedsLift(ctx, order) && v.state === 'waiting') {
            // Bodenreparatur: zurück auf einen freien Diagnoseplatz
            const diag = state.stations.find(
              (s) => s.kind === 'diagnosis' && s.unlocked && s.orderId === null,
            );
            if (diag && v.targetStationId) {
              stationById(state, v.targetStationId).orderId = null;
              diag.orderId = order.id;
              order.stationId = diag.id;
              v.state = 'driving_in';
              OrderSystem.dispatchVehicle(ctx, v, diag);
            }
          } else {
            OrderSystem.placeAtRepairStation(ctx, order);
          }
          break;
        }
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

  /** Freigabe: passt der (rabattierte) Preis ins Budget? Sonst Nachfrage. */
  static decideApproval(ctx: SimContext, order: RepairOrder): void {
    const { state } = ctx;
    const customer = state.customers.find((c) => c.id === order.customerId);
    const effective = Math.round((order.estimateCents ?? 0) * (1 - order.discountPct / 100));
    if (effective <= order.budgetCents) {
      OrderSystem.approve(ctx, order);
      return;
    }
    if (!order.offerAtRisk) {
      order.offerAtRisk = true;
      order.approvalDeadline = state.totalMinutes + 240;
      ctx.bus.emit('approval:at-risk', order.id);
      notify(
        ctx,
        'warning',
        `${customer?.name ?? 'Kunde'} droht abzulehnen: Angebot ${((order.estimateCents ?? 0) / 100).toFixed(2)} € über Budget ${(order.budgetCents / 100).toFixed(2)} €. Bitte im Auftrag reagieren (Rabatt oder Preis bestehen).`,
      );
    }
  }

  /** Kunde hat freigegeben: Teile reservieren, Reparatur vorbereiten. */
  static approve(ctx: SimContext, order: RepairOrder): void {
    const { state } = ctx;
    order.offerAtRisk = false;
    order.approvalDeadline = null;
    ctx.bus.emit('estimate:approved', order.id);
    if (InventorySystem.reserve(state.inventory, order.partsNeeded)) {
      order.partsReserved = true;
      OrderSystem.setStatus(state, order, 'ready_for_repair');
    } else {
      OrderSystem.setStatus(state, order, 'waiting_for_parts');
      OrderSystem.checkPartsPrompt(ctx, order);
      const missing = order.partsNeeded
        .filter((n) => InventorySystem.available(state.inventory, n.partId) < n.quantity)
        .map((n) => {
          const p = ctx.defs.parts.find((x) => x.id === n.partId);
          return `${n.quantity}× ${p?.name ?? n.partId}`;
        })
        .join(', ');
      notify(ctx, 'warning', `Auftrag ${order.id}: Ersatzteile fehlen (${missing}). Bitte im Lager bestellen.`);
    }
  }

  /** Fehlende Spezialwerkzeuge über alle Reparaturen des Auftrags. */
  static missingToolsForOrder(ctx: SimContext, order: RepairOrder): string[] {
    const missing = new Set<string>();
    for (const job of order.jobs) {
      const def = repairDef(ctx, job.repairId);
      for (const t of RepairSystem.missingTools(ctx, def)) missing.add(t);
    }
    return [...missing];
  }

  /** Kalkulations-Aufschlüsselung: Material, Arbeit, Gebühren, Gewinn. */
  static profitBreakdown(
    ctx: SimContext,
    order: RepairOrder,
  ): {
    materialCost: number;
    materialRevenue: number;
    laborMinutes: number;
    laborRevenue: number;
    laborCost: number;
    fee: number;
    discount: number;
    revenue: number;
    cost: number;
    profit: number;
  } {
    const { state } = ctx;
    let materialCost = 0;
    let materialRevenue = 0;
    for (const n of order.partsNeeded) {
      const p = ctx.defs.parts.find((x) => x.id === n.partId);
      if (!p) continue;
      const buy = EconomySystem.marketBuyCents(state, p);
      materialCost += buy * n.quantity;
      materialRevenue += EconomySystem.sellPrice(buy, state.economy.partsMarkupPct) * n.quantity;
    }
    const laborMinutes = order.billed
      ? order.laborMinutesActual
      : order.jobs.reduce((acc, j) => {
          const def = repairDef(ctx, j.repairId);
          return acc + def.baseDurationMinutes * (def.requiredWorkers ?? 1);
        }, 0);
    const laborRevenue = Math.round((laborMinutes / 60) * state.economy.hourlyRateCents);
    const avgSalary =
      state.workers.length > 0
        ? state.workers.reduce((a, w) => a + w.salaryCentsPerDay, 0) / state.workers.length
        : 0;
    const laborCost = Math.round(laborMinutes * (avgSalary / 600));
    const fee = DIAGNOSIS_FEE_CENTS;
    const gross = laborRevenue + materialRevenue + fee;
    const discount = order.billed
      ? Math.max(0, gross - (order.invoiceCents ?? gross))
      : Math.round((gross * order.discountPct) / 100);
    const revenue = order.billed ? order.invoiceCents ?? 0 : gross - discount;
    const cost = materialCost + laborCost;
    return {
      materialCost,
      materialRevenue,
      laborMinutes,
      laborRevenue,
      laborCost,
      fee,
      discount,
      revenue,
      cost,
      profit: revenue - cost,
    };
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
      (s) => s.kind === 'lift' && s.unlocked && s.orderId === null && (s.brokenUntilMinute ?? 0) <= state.totalMinutes,
    );
    if (!lift) return;
    const old = order.stationId ? stationById(state, order.stationId) : null;
    if (old) old.orderId = null;
    // Stand das Fahrzeug auf einem Parkplatz, wird der Platz jetzt frei
    const parkId = v.targetStationId;
    lift.orderId = order.id;
    order.stationId = lift.id;
    v.state = 'driving_to_lift';
    if (!OrderSystem.dispatchVehicle(ctx, v, lift)) {
      // Kein Pfad: Platz wieder freigeben, nächster Tick versucht es erneut
      lift.orderId = null;
      order.stationId = old ? old.id : null;
      if (old) old.orderId = order.id;
      v.state = old?.kind === 'diagnosis' ? 'at_diagnosis' : 'waiting';
    } else if (parkId) {
      const ps = stationById(state, parkId);
      if (ps.kind === 'parking') ps.orderId = null;
    }
  }

  /** Einmaliges Teile-fehlt-Modal, wenn nach der Freigabe Bestand fehlt. */
  static checkPartsPrompt(ctx: SimContext, order: RepairOrder): void {
    const { state } = ctx;
    if (order.partsPromptShown || order.status !== 'waiting_for_parts') return;
    const missing = order.partsNeeded.some(
      (n) => InventorySystem.available(state.inventory, n.partId) < n.quantity,
    );
    if (!missing) return;
    order.partsPromptShown = true;
    ctx.bus.emit('parts:missing', order.id);
  }

  /** Bereinigt Parkplatz-Belegungen, deren Auftrag/Fahrzeug nicht mehr dort ist. */
  static reconcileParking(ctx: SimContext): void {
    const { state } = ctx;
    for (const park of state.stations) {
      if (park.kind !== 'parking' || park.orderId === null) continue;
      const order = state.orders.find((o) => o.id === park.orderId);
      if (!order || order.status === 'delivered' || order.status === 'cancelled') {
        park.orderId = null;
        continue;
      }
      const v = vehicleById(state, order.vehicleId);
      const valid =
        v.targetStationId === park.id &&
        (v.state === 'waiting' || v.state === 'waiting_pickup' || v.state === 'driving_in');
      if (!valid) park.orderId = null;
    }
  }

  /** Nach der Reparatur: Fahrzeug auf einen freien Abhol-Parkplatz stellen. */
  static tryMoveToParking(ctx: SimContext, order: RepairOrder, v: Vehicle): void {
    const { state } = ctx;
    if (v.state !== 'at_lift' && v.state !== 'at_diagnosis') return;
    const park = state.stations.find(
      (s) => s.kind === 'parking' && s.unlocked && s.orderId === null,
    );
    if (!park) return; // kein Platz frei → Bühne bleibt blockiert
    if (order.stationId) {
      stationById(state, order.stationId).orderId = null;
      order.stationId = null;
    }
    park.orderId = order.id;
    v.state = 'driving_in';
    if (!OrderSystem.dispatchVehicle(ctx, v, park)) {
      park.orderId = null;
      v.state = 'at_lift';
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
    // Erst auf die Fahrspur (y15) auffahren, dann auf der Straße zur Ausfahrt
    const laneY = 15;
    const lx = Math.max(1, Math.min(ctx.map.width - 2, Math.round(vehicle.pos.x)));
    const toRoad = findPath(ctx.map, vehicle.pos, { x: lx, y: laneY }) ?? [];
    const alongRoad = findPath(
      ctx.map,
      { x: lx, y: laneY },
      { x: exit.rect.x, y: exit.rect.y },
      { vehicleTargetRect: exit.rect },
    ) ?? [];
    let path = [...toRoad, ...alongRoad];
    if (path.length === 0) {
      path = findPath(
        ctx.map,
        vehicle.pos,
        { x: exit.rect.x, y: exit.rect.y },
        { vehicleTargetRect: exit.rect },
      ) ?? [];
    }
    vehicle.path = path;
    vehicle.targetStationId = null;
    if (path.length === 0) {
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
      } else if (station?.kind === 'parking' && order.status === 'completed') {
        vehicle.state = 'waiting_pickup';
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
          const prevSat = order.satisfaction ?? 80;
          order.satisfaction = Math.max(20, prevSat - 25);
          // Kundenzufriedenheit + Statistik synchron halten (sonst gilt der
          // Kunde weiter als zufriedener Stammkunde)
          const cc = state.customers.find((c) => c.id === order.customerId);
          if (cc) cc.lastSatisfaction = order.satisfaction;
          state.statistics.satisfactionSum += order.satisfaction - prevSat;
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
    // Reservierung nur freigeben, wenn noch NICHT verbraucht (Abholung).
    // Verbrauchte Teile sind aus dem Bestand – erneutes Freigeben würde
    // die Reservierung anderer Aufträge ins Negative ziehen.
    if (order.partsReserved && !order.partsConsumed) {
      InventorySystem.release(state.inventory, order.partsNeeded);
    }
    order.partsReserved = false;
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
      if (v.targetStationId) {
        const ps = stationById(state, v.targetStationId);
        if (ps.kind === 'parking') ps.orderId = null;
      }
      if (v.state === 'incoming') {
        v.state = 'gone';
      } else if (v.state !== 'gone' && v.state !== 'driving_out') {
        OrderSystem.sendVehicleOut(ctx, v);
      }
    }
    order.cancelReason = reason;
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
        return order.offerAtRisk
          ? 'Kunde droht abzulehnen – im Fahrzeug-Detail Rabatt anbieten oder Preis bestehen.'
          : 'Kunde prüft den Kostenvoranschlag.';
      case 'waiting_for_parts': {
        const vp = vehicleById(state, order.vehicleId);
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
          const parkNote = vp.state === 'waiting' ? 'Fahrzeug wartet auf dem Parkplatz. ' : '';
          return `${parkNote}Wartet auf Ersatzteile: ${names} (Lieferung in ${(Math.max(0, eta) / 60).toFixed(1)} h).`;
        }
        const parkNote2 = vp.state === 'waiting' ? 'Fahrzeug wartet auf dem Parkplatz. ' : '';
        return `${parkNote2}Wartet auf Ersatzteile: ${names} – noch nicht bestellt!`;
      }
      case 'ready_for_repair':
        if (v?.state === 'driving_to_lift') return 'Fahrzeug fährt zur Hebebühne.';
        if (
          RepairSystem.orderNeedsLift(ctx, order) &&
          !state.stations.some((s) => s.kind === 'lift' && s.unlocked && s.orderId === null && (s.brokenUntilMinute ?? 0) <= state.totalMinutes)
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
        if (order.partsNeeded.length > 0 && !order.partsAtBay) {
          const delivering = state.workers.some(
            (w) => w.task?.kind === 'deliver' && w.task.orderId === order.id,
          );
          if (delivering) return 'Lagerhelfer bringt die Ersatzteile zur Bühne.';
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
      case 'completed': {
        const vv = vehicleById(state, order.vehicleId);
        if (vv.state === 'at_lift' || vv.state === 'at_diagnosis') {
          return 'Wartet auf freien Parkplatz für die Abholung (Parkplatz-Kapazität).';
        }
        if (vv.state === 'waiting_pickup' && order.pickupAtMinute !== null) {
          const h = Math.max(0, (order.pickupAtMinute - state.totalMinutes) / 60);
          return `Kunde holt das Fahrzeug in ca. ${h.toFixed(1)} h ab.`;
        }
        return 'Fahrzeug verlässt die Werkstatt.';
      }
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
    const invoice = order.acceptedBudgetCents !== null
      ? order.acceptedBudgetCents
      : Math.round(
          (laborCents + partsCents + DIAGNOSIS_FEE_CENTS) * (1 - order.discountPct / 100),
        );
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
    for (const j of order.jobs) {
      state.statistics.repairsByType[j.repairId] =
        (state.statistics.repairsByType[j.repairId] ?? 0) + 1;
    }
    order.qualityScore = Math.max(
      0.2,
      Math.min(1, 0.6 + qcSkill / 250 - order.qualityIssues * 0.15),
    );
    let satisfaction = 95;
    const reasons: string[] = [];
    const lateMinutes = state.totalMinutes - order.dueAtMinute;
    if (lateMinutes > 0) {
      satisfaction -= 30;
      reasons.push(`Verspätung ${Math.max(1, Math.round(lateMinutes / 60))} h (−30)`);
    }
    if (invoice > order.budgetCents * 1.15) {
      satisfaction -= 15;
      reasons.push('Rechnung mehr als 15 % über Budget (−15)');
    }
    if (order.qualityIssues > 0) {
      reasons.push(`${order.qualityIssues} Nacharbeit(en) bei der Qualitätskontrolle`);
    }
    satisfaction = Math.max(20, Math.min(100, satisfaction));
    order.satisfaction = satisfaction;
    order.satisfactionReason = reasons.length > 0 ? reasons.join('; ') : 'Pünktlich, im Budget, keine Mängel';
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
    // Kunde holt verzögert ab: erst auf den Parkplatz, dann random warten
    order.pickupAtMinute = state.totalMinutes + ctx.rng.intRange(60, 240);
    const v = vehicleById(state, order.vehicleId);
    OrderSystem.tryMoveToParking(ctx, order, v);
    ctx.bus.emit('order:completed', order.id);
    ctx.bus.emit('invoice:paid', { orderId: order.id, amountCents: invoice });
  }
}
