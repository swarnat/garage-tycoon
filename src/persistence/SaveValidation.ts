import type { GameState, OrderStatus } from '../entities/types';
import { SAVE_VERSION } from '../entities/types';
import { DEFS } from '../data';

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

const ORDER_STATUSES: OrderStatus[] = [
  'incoming', 'accepted', 'waiting_for_diagnosis', 'diagnosing',
  'waiting_for_approval', 'waiting_for_parts', 'ready_for_repair',
  'repairing', 'quality_check', 'completed', 'delivered', 'cancelled',
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(msg: string): never {
  throw new SaveError(msg);
}

/** Vollständige Struktur-, Werte- und Referenzprüfung vor dem Laden. */
export function validateState(raw: unknown): asserts raw is GameState {
  if (!isObj(raw)) fail('Spielstand ist kein Objekt');
  const s = raw as Record<string, unknown>;
  if (typeof s.version !== 'number' || !Number.isInteger(s.version)) {
    fail('Version fehlt oder ungültig');
  }
  if (s.version > SAVE_VERSION) fail(`Unbekannte Spielstand-Version ${s.version}`);
  for (const k of ['seed', 'rngState', 'totalMinutes', 'speed', 'reputation', 'nextOrderAttemptAtMinute', 'nextId']) {
    if (typeof s[k] !== 'number' || !Number.isFinite(s[k] as number)) {
      fail(`Feld ${k} fehlt oder ist keine Zahl`);
    }
  }
  if ((s.totalMinutes as number) < 0) fail('Spielzeit ist negativ');
  for (const k of ['workers', 'vehicles', 'orders', 'customers', 'deliveries', 'stations', 'notifications', 'candidates']) {
    if (!Array.isArray(s[k])) fail(`Feld ${k} ist kein Array`);
  }
  const eco = s.economy;
  if (!isObj(eco)) fail('Wirtschaftsdaten fehlen');
  for (const k of ['balanceCents', 'hourlyRateCents', 'partsMarkupPct']) {
    if (typeof eco[k] !== 'number' || !Number.isInteger(eco[k] as number)) {
      fail(`Wirtschaftsfeld ${k} muss ganzzahlig sein`);
    }
  }
  if (!Array.isArray(eco.transactions) || !Array.isArray(eco.daily) || !Array.isArray(eco.bookedIds)) {
    fail('Transaktionslisten fehlen');
  }
  for (const t of eco.transactions as unknown[]) {
    if (!isObj(t) || typeof t.amountCents !== 'number' || !Number.isInteger(t.amountCents)) {
      fail('Transaktion mit ungültigem Cent-Betrag');
    }
  }
  const inv = s.inventory;
  if (!isObj(inv) || !isObj(inv.stock) || !isObj(inv.reserved) || !isObj(inv.minStock) || typeof inv.capacity !== 'number') {
    fail('Lagerdaten fehlen');
  }
  const stock = inv.stock as Record<string, number>;
  const reserved = inv.reserved as Record<string, number>;
  for (const [partId, r] of Object.entries(reserved)) {
    if (typeof r !== 'number' || r < 0) fail(`Ungültige Reservierung für ${partId}`);
    if (r > (stock[partId] ?? 0)) fail(`Reservierung über Bestand: ${partId}`);
  }
  if (!isObj(s.statistics)) fail('Statistiken fehlen');

  const orders = s.orders as Record<string, unknown>[];
  const vehicles = s.vehicles as Record<string, unknown>[];
  const workers = s.workers as Record<string, unknown>[];
  const customers = s.customers as Record<string, unknown>[];
  const stations = s.stations as Record<string, unknown>[];
  const orderIds = new Set<string>();
  const vehicleIds = new Set(vehicles.map((v) => v.id as string));
  const workerIds = new Set(workers.map((w) => w.id as string));
  const customerIds = new Set(customers.map((c) => c.id as string));
  const stationIds = new Set(stations.map((x) => x.id as string));
  const repairIds = new Set(DEFS.repairs.map((r) => r.id));
  const partIds = new Set(DEFS.parts.map((p) => p.id));
  const modelIds = new Set(DEFS.vehicles.map((v) => v.id));

  for (const o of orders) {
    if (typeof o.id !== 'string') fail('Auftrag ohne ID');
    if (orderIds.has(o.id)) fail(`Doppelte Auftrags-ID ${o.id}`);
    orderIds.add(o.id);
    if (!ORDER_STATUSES.includes(o.status as OrderStatus)) {
      fail(`Ungültiger Auftragsstatus: ${String(o.status)}`);
    }
    if (!vehicleIds.has(o.vehicleId as string)) fail(`Auftrag ${o.id}: Fahrzeugreferenz ungültig`);
    if (!customerIds.has(o.customerId as string)) fail(`Auftrag ${o.id}: Kundenreferenz ungültig`);
    if (o.stationId !== null && !stationIds.has(o.stationId as string)) {
      fail(`Auftrag ${o.id}: Arbeitsplatzreferenz ungültig`);
    }
    if (o.assignedWorkerId !== null && !workerIds.has(o.assignedWorkerId as string)) {
      fail(`Auftrag ${o.id}: Mitarbeiterreferenz ungültig`);
    }
    if (!Array.isArray(o.defectRepairIds)) fail(`Auftrag ${o.id}: Defektliste fehlt`);
    for (const rid of o.defectRepairIds as unknown[]) {
      if (!repairIds.has(rid as string)) fail(`Auftrag ${o.id}: unbekannte Reparatur ${String(rid)}`);
    }
    if (!Array.isArray(o.partsNeeded)) fail(`Auftrag ${o.id}: Teilebedarf fehlt`);
    for (const n of o.partsNeeded as Record<string, unknown>[]) {
      if (!partIds.has(n.partId as string)) fail(`Auftrag ${o.id}: unbekanntes Teil ${String(n.partId)}`);
    }
    if (o.urgencySurchargePct !== 0 && (o.urgencySurchargePct !== 15 || o.type !== 'emergency')) {
      fail(`Auftrag ${o.id}: Dringlichkeitszuschlag ungültig`);
    }
    if (o.repairParking !== null) {
      const pause = o.repairParking;
      const vehicle = vehicles.find((v) => v.id === o.vehicleId);
      const target = stations.find((st) => st.id === vehicle?.targetStationId);
      if (!isObj(pause) || o.status !== 'repairing' || !vehicle || !target || target.orderId !== o.id) {
        fail(`Auftrag ${o.id}: Parkpause ungültig`);
      }
      switch (pause.phase) {
        case 'outbound':
          if (vehicle.state !== 'driving_in' || target.kind !== 'parking' ||
              (o.stationId !== null && !stations.some((st) =>
                st.id === o.stationId && st.orderId === o.id && (st.kind === 'lift' || st.kind === 'diagnosis'),
              ))) fail(`Auftrag ${o.id}: Fahrt zum Parkplatz ungültig`);
          break;
        case 'parked':
          if (vehicle.state !== 'waiting' || target.kind !== 'parking' || o.stationId !== null ||
              typeof pause.resumeAtMinute !== 'number' || !Number.isFinite(pause.resumeAtMinute) ||
              pause.resumeAtMinute < 0) fail(`Auftrag ${o.id}: Parkdauer oder Parkplatz ungültig`);
          break;
        case 'returning':
          if (o.stationId !== target.id ||
              !((target.kind === 'lift' && vehicle.state === 'driving_to_lift') ||
                (target.kind === 'diagnosis' && vehicle.state === 'driving_in'))) {
            fail(`Auftrag ${o.id}: Rückfahrt ungültig`);
          }
          break;
        default:
          fail(`Auftrag ${o.id}: Parkphase ungültig`);
      }
    }
    if (typeof o.budgetCents !== 'number' || !Number.isInteger(o.budgetCents)) {
      fail(`Auftrag ${o.id}: Budget ungültig`);
    }
  }
  for (const v of vehicles) {
    if (!orderIds.has(v.orderId as string)) fail(`Fahrzeug ${String(v.id)}: Auftragsreferenz ungültig`);
    if (!modelIds.has(v.modelId as string)) fail(`Fahrzeug ${String(v.id)}: unbekanntes Modell`);
  }
  for (const w of workers) {
    if (w.task !== null && w.task !== undefined) {
      const t = w.task as Record<string, unknown>;
      if (!orderIds.has(t.orderId as string)) fail(`Mitarbeiter ${String(w.id)}: Aufgabenreferenz ungültig`);
    }
  }
  for (const st of stations) {
    if (st.orderId !== null && !orderIds.has(st.orderId as string)) {
      fail(`Arbeitsplatz ${String(st.id)}: Auftragsreferenz ungültig`);
    }
  }
}
