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
    if (incoming >= 3 || active >= 8) return;
    const chance = 0.16 + state.reputation / 400;
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

    const firstDef = ctx.defs.repairs.find((r) => r.id === defectIds[0])!;
    const complaint = rng.pick(firstDef.complaints);
    const profile = rng.weighted<CustomerProfile>(
      ['price_sensitive', 'quality_oriented', 'time_critical', 'regular', 'business'],
      [25, 20, 15, 25, 15],
    );
    const customer: Customer = {
      id: `c${state.nextId++}`,
      name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      profile,
      visits: 1,
    };
    state.customers.push(customer);
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

    // Fairer Referenzpreis für das Kundenbudget
    let fair = DIAGNOSIS_FEE_CENTS;
    for (const id of defectIds) {
      const def = ctx.defs.repairs.find((r) => r.id === id)!;
      fair += Math.round((def.baseDurationMinutes / 60) * state.economy.hourlyRateCents);
      for (const p of def.requiredParts) {
        const part = ctx.defs.parts.find((x) => x.id === p.partId)!;
        fair += EconomySystem.sellPrice(part.buyCents, state.economy.partsMarkupPct) * p.quantity;
      }
    }
    const budgetCents = Math.round(
      fair * PROFILE_FACTORS[profile] * rng.range(0.95, 1.3),
    );
    const dueAtMinute =
      state.totalMinutes +
      (profile === 'time_critical' ? 720 : rng.intRange(1, 3) * 1440);

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
      qcRemainingMinutes: 0,
      billed: false,
      laborMinutesActual: 0,
      expiresAtMinute: state.totalMinutes + 360,
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
    return order;
  }
}
