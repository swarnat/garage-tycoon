import type {
  Customer,
  CustomerProfile,
  OrderType,
  RepairOrder,
  Vehicle,
} from '../entities/types';
import { DIAGNOSIS_FEE_CENTS } from '../entities/types';
import type { SimContext } from './context';
import { notify } from './context';
import { EconomySystem } from './EconomySystem';

const FIRST_NAMES = [
  'Petra', 'Michael', 'Sabine', 'Thomas', 'Anna', 'Frank', 'Julia', 'Stefan',
  'Claudia', 'Markus', 'Nina', 'Jörg', 'Laura', 'Bernd', 'Sophie', 'Uwe',
];
const LAST_NAMES = [
  'Schmidt', 'Müller', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann',
  'Schulz', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Braun', 'Krüger',
];

const PROFILE_FACTORS: Record<CustomerProfile, number> = {
  price_sensitive: 0.85,
  quality_oriented: 1.25,
  time_critical: 1.1,
  regular: 1.05,
  business: 1.35,
};

const WEAR_REPAIRS = new Set([
  'replace_brake_pads',
  'replace_brake_discs',
  'replace_shock_absorbers',
  'replace_wheel_bearing',
  'replace_accessory_belt',
  'oil_change',
  'replace_battery',
]);

/** Kundengenerierung, Auftragsangebote und Budgetentscheidungen. */
export class CustomerSystem {
  static update(ctx: SimContext): void {
    const { state } = ctx;
    if (state.totalMinutes < state.nextOrderAttemptAtMinute) return;
    state.nextOrderAttemptAtMinute = state.totalMinutes + 60;
    const hour = Math.floor((state.totalMinutes % 1440) / 60);
    if (hour < 8 || hour >= 18) return;
    const incoming = state.orders.filter((o) => o.status === 'incoming').length;
    const active = state.orders.filter(
      (o) =>
        o.status !== 'incoming' &&
        o.status !== 'delivered' &&
        o.status !== 'cancelled',
    ).length;
    if (incoming >= 4 || active >= 8) return;
    const chance = (0.25 + state.reputation / 300) * state.orderRateFactor;
    if (ctx.rng.chance(chance)) {
      CustomerSystem.generateOffer(ctx);
    }
  }

  static generateOffer(ctx: SimContext): RepairOrder {
    const { state, rng } = ctx;
    const model = rng.pick(ctx.defs.vehicles);
    const year = rng.intRange(model.years[0], model.years[1]);
    const mileageKm = rng.intRange(15_000, 220_000);
    const type = rng.weighted<OrderType>(
      ['standard', 'maintenance', 'diagnosis', 'emergency', 'major', 'inspection'],
      [45, 20, 10, 10, 10, 5],
    );

    let defectIds: string[];
    if (type === 'maintenance') {
      defectIds = [rng.chance(0.7) ? 'oil_change' : 'replace_air_filter'];
    } else if (type === 'inspection') {
      defectIds = ['inspection'];
    } else {
      const pool = ctx.defs.repairs.filter((r) => r.id !== 'inspection');
      const weights = pool.map(
        (r) => 1 + (mileageKm > 120_000 && WEAR_REPAIRS.has(r.id) ? 1.2 : 0),
      );
      const first = rng.weighted(pool, weights);
      defectIds = [first.id];
      if (type === 'major') {
        const rest = pool.filter((r) => r.id !== first.id);
        const second = rng.weighted(
          rest,
          rest.map((r) => 1 + (WEAR_REPAIRS.has(r.id) ? 0.8 : 0)),
        );
        defectIds.push(second.id);
      }
    }

    // Komplexe Defekte: Folgeschäden mit definierter Wahrscheinlichkeit
    for (const id of [...defectIds]) {
      const def = ctx.defs.repairs.find((r) => r.id === id);
      for (const f of def?.followUps ?? []) {
        if (defectIds.length >= 3) break;
        if (!defectIds.includes(f.repairId) && rng.chance(f.chance)) {
          defectIds.push(f.repairId);
        }
      }
    }

    const firstDef = ctx.defs.repairs.find((r) => r.id === defectIds[0])!;
    const complaint = rng.pick(firstDef.complaints);
    const profile = rng.weighted<CustomerProfile>(
      ['price_sensitive', 'quality_oriented', 'time_critical', 'regular', 'business'],
      [25, 20, 15, 25, 15],
    );
    // Stammkunden: zufriedene Kunden (>= 80) kommen mit 25 % wieder
    const returningPool = state.customers.filter(
      (c) => (c.lastSatisfaction ?? 0) >= 80,
    );
    let customer: Customer;
    if (returningPool.length > 0 && rng.chance(0.25)) {
      customer = rng.pick(returningPool);
      customer.visits += 1;
    } else {
      customer = {
        id: `c${state.nextId++}`,
        name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
        profile,
        visits: 1,
        lastSatisfaction: null,
      };
      state.customers.push(customer);
    }
    if (state.customers.length > 120) {
      const activeIds = new Set(
        state.orders
          .filter((o) => o.status !== 'delivered' && o.status !== 'cancelled')
          .map((o) => o.customerId),
      );
      state.customers = state.customers.filter(
        (c) => activeIds.has(c.id) || state.customers.indexOf(c) >= state.customers.length - 60,
      );
    }

    const vehicle: Vehicle = {
      id: `v${state.nextId++}`,
      modelId: model.id,
      make: model.make,
      model: model.model,
      year,
      mileageKm,
      vehicleClass: model.vehicleClass,
      color: rng.pick(model.colors),
      ownerId: customer.id,
      orderId: '',
      pos: { x: 0, y: 15 },
      path: [],
      state: 'incoming',
      targetStationId: null,
    };

    // Fairer Referenzpreis für das Kundenbudget (Team-Reparaturen kosten mehr)
    let fair = DIAGNOSIS_FEE_CENTS;
    for (const id of defectIds) {
      const def = ctx.defs.repairs.find((r) => r.id === id)!;
      fair += Math.round(((def.baseDurationMinutes * (def.requiredWorkers ?? 1)) / 60) * state.economy.hourlyRateCents);
      for (const p of def.requiredParts) {
        // Kategorie-Preis (Standard-Variante) für die faire Schätzung vor der Diagnose
        const part =
          ctx.defs.parts.find((x) => x.category === p.partId && x.quality === 'standard' && x.spec === 'M') ??
          ctx.defs.parts.find((x) => x.category === p.partId && x.quality === 'standard') ??
          ctx.defs.parts.find((x) => x.category === p.partId)!;
        fair += EconomySystem.sellPrice(EconomySystem.marketBuyCents(state, part), state.economy.partsMarkupPct) * p.quantity;
      }
    }
    const budgetCents = Math.round(
      fair * PROFILE_FACTORS[profile] * rng.range(0.95, 1.3),
    );
    // Termine: große Arbeiten (>= 240 min) 1-2 Tage; Kleines vor 11 Uhr noch
    // am selben Tag (18:00), danach immer am Folgetag (12:00)
    const laborMinutes = defectIds.reduce((acc, id) => {
      const d = ctx.defs.repairs.find((r) => r.id === id);
      return acc + (d ? d.baseDurationMinutes * (d.requiredWorkers ?? 1) : 0);
    }, 0);
    const day = Math.floor(state.totalMinutes / 1440);
    const minuteOfDay = state.totalMinutes % 1440;
    // Alle Terminen liegen auf 18:00 (Feierabend) – Überfälligkeit gibt es
    // erst zum Ende des Arbeitstags, nicht schon mittags.
    let dueAtMinute: number;
    if (laborMinutes >= 240) {
      dueAtMinute = (day + rng.intRange(1, 2)) * 1440 + 1080;
      if (rng.chance(0.3)) dueAtMinute += 1440; // manchmal zusätzlich Zeit
    } else if (minuteOfDay < 660) {
      dueAtMinute = day * 1440 + 1080;
    } else {
      dueAtMinute = (day + 1) * 1440 + 1080;
      // Wahrscheinlichkeit für mehr Zeit: 50 % Basis, 35 % +1 Tag, 15 % +2 Tage
      const roll = rng.next();
      if (roll < 0.15) dueAtMinute += 2 * 1440;
      else if (roll < 0.5) dueAtMinute += 1440;
    }
    if (profile === 'time_critical') {
      // Zeitkritisch: knapp, aber ebenfalls zum Feierabend
      dueAtMinute = (minuteOfDay < 1080 ? day : day + 1) * 1440 + 1080;
    }

    const order: RepairOrder = {
      id: `o${state.nextId++}`,
      customerId: customer.id,
      vehicleId: vehicle.id,
      type,
      complaint,
      defectRepairIds: defectIds,
      revealed: false,
      status: 'incoming',
      createdAtMinute: state.totalMinutes,
      dueAtMinute,
      priority: type === 'emergency' ? 2 : 1,
      jobs: [],
      partsNeeded: [],
      partsReserved: false,
      partsAtBay: false,
      estimateCents: null,
      invoiceCents: null,
      budgetCents,
      satisfaction: null,
      assignedWorkerId: null,
      stationId: null,
      diagnosisRemainingMinutes: 0,
      diagnosisExtended: false,
      qcRemainingMinutes: 0,
      billed: false,
      offerAtRisk: false,
      approvalDeadline: null,
      discountPct: 0,
      toolPromptShown: false,
      partsPromptShown: false,
      pickupAtMinute: null,
      cancelReason: null,
      satisfactionReason: '',
      acceptedBudgetCents: null,
      laborMinutesActual: 0,
      expiresAtMinute: state.totalMinutes + 360,
      crewIds: [],
      qualityIssues: 0,
      qualityScore: null,
      statusLog: [{ atMinute: state.totalMinutes, status: 'incoming' }],
    };
    vehicle.orderId = order.id;
    state.vehicles.push(vehicle);
    state.orders.push(order);
    ctx.bus.emit('order:created', order.id);
    notify(
      ctx,
      'info',
      `Neuer Auftrag: ${customer.name} mit ${vehicle.make} ${vehicle.model} – „${complaint}“`,
    );
    // Auftragseingang: sofort auf 1x schalten, damit der Spieler reagieren kann
    if (state.speed !== 0 && state.speed !== 1) {
      state.speed = 1;
      notify(ctx, 'info', 'Neuer Auftrag eingegangen – Tempo auf 1× gestellt.');
    }
    return order;
  }
}
