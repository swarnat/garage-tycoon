import type { GameState, RepairOrder, Worker } from '../entities/types';
import {
  GAME_MINUTES_PER_REAL_SECOND,
  MINUTES_PER_DAY,
  SAVE_VERSION,
  SIM_STEP_MINUTES,
} from '../entities/types';
import { EventBus } from './EventBus';
import { GameClock } from './GameClock';
import { RandomGenerator } from './RandomGenerator';
import { TileMap, MAP_WIDTH, MAP_HEIGHT } from '../world/TileMap';
import { DEFS } from '../data';
import type { GameDefs } from '../entities/types';
import type { SimContext } from '../simulation/context';
import { notify, stationById, vehicleById } from '../simulation/context';
import { EconomySystem } from '../simulation/EconomySystem';
import { OrderSystem } from '../simulation/OrderSystem';
import { CustomerSystem } from '../simulation/CustomerSystem';
import { WorkerSystem } from '../simulation/WorkerSystem';
import { AssistantSystem } from '../simulation/AssistantSystem';
import { EventSystem } from '../simulation/EventSystem';
import { VehicleSystem } from '../simulation/VehicleSystem';
import { SupplierSystem } from '../simulation/SupplierSystem';
import { InventorySystem } from '../simulation/InventorySystem';
import { PersonnelSystem } from '../simulation/PersonnelSystem';
import { MarketSystem } from '../simulation/MarketSystem';
import { DELAY_BY_PROFILE, delayChance } from '../simulation/PartsResolver';
import { LEGACY_PART_MAP } from '../data';
import type { SkillId } from '../entities/types';
import { findPath } from '../world/Pathfinding';

/** Sinnvolle Mindestbestände: Verschleißteile häufiger, seltene Teile einzeln. */
const DEFAULT_MIN_STOCK: Record<string, number> = {
  brake_pads: 3,
  brake_discs: 2,
  brake_caliper: 1,
  brake_fluid: 2,
  spark_plugs: 3,
  ignition_coil: 1,
  oil_filter: 3,
  motor_oil: 4,
  air_filter: 2,
  accessory_belt: 1,
  water_pump: 1,
  thermostat: 1,
  battery: 2,
  alternator: 1,
  starter: 1,
  sensor: 2,
  shock_absorber: 2,
  spring: 1,
  control_arm: 1,
  wheel_bearing: 1,
  muffler: 1,
  transmission_oil: 2,
  refrigerant: 2,
};

const INITIAL_STOCK: Record<string, number> = {
  brake_pads: 4,
  brake_fluid: 3,
  oil_filter: 4,
  motor_oil: 4,
  air_filter: 3,
  spark_plugs: 8,
  battery: 2,
  sensor: 2,
  thermostat: 1,
  transmission_oil: 1,
  refrigerant: 1,
};

function startingWorker(
  id: string,
  name: string,
  skills: Worker['skills'],
  pos: { x: number; y: number },
  speed: number,
): Worker {
  return {
    id,
    name,
    role: 'mechanic',
    salaryCentsPerDay: 16000,
    skills,
    experience: 0,
    state: 'idle',
    pos,
    path: [],
    task: null,
    shiftStartMinute: 480,
    shiftEndMinute: 1080,
    speedTilesPerMinute: speed,
    workedMinutes: 0,
    onDutyMinutes: 0,
    trainingMinutes: 0,
    pendingTraining: null,
    motivation: 80,
    dailyWorkedMinutes: 0,
    dailyOnDutyMinutes: 0,
  };
}

export function createNewGame(seed: number): GameState {
  const stock: Record<string, number> = {};
  const reserved: Record<string, number> = {};
  const minStock: Record<string, number> = {};
  const marketPriceFactors: Record<string, number> = {};
  for (const p of DEFS.parts) {
    stock[p.id] = 0;
    reserved[p.id] = 0;
    minStock[p.id] = 0;
    marketPriceFactors[p.id] = 1;
  }
  // Startbestand & Mindestbestände auf die Standard-Varianten abbilden
  for (const [oldId, qty] of Object.entries(INITIAL_STOCK)) {
    const vid = LEGACY_PART_MAP[oldId];
    if (vid) stock[vid] = qty;
  }
  for (const [oldId, min] of Object.entries(DEFAULT_MIN_STOCK)) {
    const vid = LEGACY_PART_MAP[oldId];
    if (vid) minStock[vid] = min;
  }
  stock['tires__15__standard'] = 4; // ein Satz Kompakt-Reifen zum Start
  // Grundsortiment: 1 je Standard-Variante + Mindestbestand 1 (Auto bleibt aus)
  for (const p of DEFS.parts) {
    if (p.quality === 'standard') {
      stock[p.id] = Math.max(stock[p.id] ?? 0, 1);
      minStock[p.id] = Math.max(minStock[p.id] ?? 0, 1);
    }
  }
  return {
    version: SAVE_VERSION,
    seed,
    rngState: seed >>> 0,
    totalMinutes: 480,
    speed: 1,
    reputation: 50,
    economy: {
      balanceCents: 2_500_000,
      hourlyRateCents: 8500,
      partsMarkupPct: 40,
      transactions: [],
      daily: [],
      bookedIds: [],
    },
    workers: [
      startingWorker(
        'w1',
        'Alex Krause',
        { engine: 65, electrical: 45, suspension: 55, brakes: 70, transmission: 40, diagnosis: 60 },
        { x: 4, y: 6 },
        0.5,
      ),
      startingWorker(
        'w2',
        'Jonas Weber',
        { engine: 45, electrical: 70, suspension: 60, brakes: 50, transmission: 55, diagnosis: 50 },
        { x: 6, y: 7 },
        0.26,
      ),
    ],
    vehicles: [],
    orders: [],
    customers: [],
    inventory: {
      stock,
      reserved,
      minStock,
      capacity: 160,
      autoReorder: {},
      usageLog: [],
      lastOrdered: {},
      pinned: {},
      autoSupplierId: 'teileprofi',
    },
    deliveries: [],
    stations: TileMap.defaultStations(),
    candidates: [],
    orderRateFactor: 1,
    ownedTools: ['brake_bleeder'],
    marketPriceFactors,
    assistantAlertedAt: {},
    assistantNextScanAtMinute: 0,
    activeEvent: null,
    eventLog: [],
    nextEventCheckAtMinute: 0,
    eventsToday: 0,
    lastEventDay: 0,
    marketingLevel: 0,
    soundEnabled: true,
    dailySummaryPending: null,
    loans: [],
    notifications: [],
    statistics: {
      ordersCompleted: 0,
      ordersCancelled: 0,
      totalRevenueCents: 0,
      totalPartsCostCents: 0,
      totalSalaryCents: 0,
      totalFixedCostCents: 0,
      totalLaborMinutes: 0,
      satisfactionSum: 0,
      qcFailures: 0,
      complaints: 0,
      repairsByType: {},
    },
    nextOrderAttemptAtMinute: 540,
    nextAutoOrderCheckAtMinute: 540,
    lastCandidateRefreshDay: 1,
    nextId: 1,
    nextNotificationId: 1,
  };
}

/**
 * Spielorchestrierung: Fixed-Timestep-Simulation, unabhängig vom Rendering.
 * Die Simulation ist die einzige autoritative Quelle des Spielzustands.
 */
export class Game {
  readonly state: GameState;
  readonly defs: GameDefs;
  readonly bus = new EventBus();
  readonly rng: RandomGenerator;
  map: TileMap;
  private clock: GameClock;
  private acc = 0;

  constructor(state: GameState, defs: GameDefs = DEFS) {
    this.state = state;
    this.defs = defs;
    this.rng = RandomGenerator.fromState(state.seed, state.rngState);
    this.clock = new GameClock(state.totalMinutes);
    this.map = new TileMap(MAP_WIDTH, MAP_HEIGHT, state.stations);
  }

  static new(seed: number = Math.floor(Math.random() * 2 ** 31)): Game {
    const game = new Game(createNewGame(seed));
    CustomerSystem.generateOffer(game.ctx);
    game.state.candidates = PersonnelSystem.generateCandidates(game.ctx);
    return game;
  }

  get ctx(): SimContext {
    return {
      state: this.state,
      rng: this.rng,
      bus: this.bus,
      defs: this.defs,
      map: this.map,
    };
  }

  /** Rückt die Simulation in festen Schritten vor (FPS-unabhängig).
   *  Nachts läuft sie automatisch mit 16× (ohne laufende Arbeit), zu Arbeitsbeginn mit 1×. */
  tick(minutes: number): void {
    if (this.state.speed === 0) return;
    // Außerhalb der Arbeitszeit automatisch 16x – aber nie bei laufender Arbeit
    const m0 = this.state.totalMinutes % MINUTES_PER_DAY;
    const night0 = m0 >= 1080 || m0 < 480;
    const working0 = this.state.workers.some((w) => w.task);
    if (night0 && !working0 && this.state.speed !== 16) {
      this.state.speed = 16;
    } else if (night0 && working0 && this.state.speed === 16) {
      this.state.speed = 8;
    }
    this.acc += minutes;
    let guard = 0;
    while (guard++ < 40000) {
      if (this.acc < SIM_STEP_MINUTES - 1e-9) break;
      this.step(SIM_STEP_MINUTES);
      this.acc -= SIM_STEP_MINUTES;
    }
  }

  private step(dt: number): void {
    const beforeMinute = this.state.totalMinutes % MINUTES_PER_DAY;
    // Uhr mit dem (ggf. extern veränderten) Zustand synchronisieren
    this.clock.totalMinutes = this.state.totalMinutes;
    const newDays = this.clock.advance(dt);
    this.state.totalMinutes = this.clock.totalMinutes;
    for (const d of newDays) {
      EconomySystem.closeDay(this.state, d - 1);
      this.state.dailySummaryPending = EconomySystem.buildDailySummary(this.state, d - 1);
      MarketSystem.update(this.ctx);
      PersonnelSystem.dailyReview(this.ctx);
      this.bus.emit('day:started', d);
      notify(this.ctx, 'info', `Tag ${d} beginnt. Gehälter und Fixkosten wurden verbucht.`);
    }
    // Tempo-Automatik: nachts 16x (nur ohne laufende Arbeit), zu Beginn 1x
    const afterMinute = this.state.totalMinutes % MINUTES_PER_DAY;
    if (this.state.speed !== 0) {
      const night = afterMinute >= 1080 || afterMinute < 480;
      const working = this.state.workers.some((w) => w.task);
      if (night && !working) {
        if (this.state.speed !== 16) this.state.speed = 16;
      } else if (night && working && this.state.speed === 16) {
        this.state.speed = 8;
      } else if (!night && beforeMinute < 480 && afterMinute >= 480) {
        this.state.speed = 1;
      }
    }
    const ctx = this.ctx;
    SupplierSystem.update(ctx);
    InventorySystem.update(ctx);
    PersonnelSystem.update(ctx);
    CustomerSystem.update(ctx);
    OrderSystem.update(ctx);
    WorkerSystem.update(ctx, dt);
    AssistantSystem.update(ctx);
    EventSystem.update(ctx);
    VehicleSystem.update(ctx, dt);
    this.state.rngState = this.rng.state;
    // Tägliche Liquiditätswarnung um 08:00
    if (
      this.state.totalMinutes % 1440 === 480 &&
      this.state.economy.balanceCents < 150000
    ) {
      notify(this.ctx, 'danger', 'Liquiditätswarnung: Kontostand unter 1.500 €.');
      this.bus.emit('liquidity:warning', this.state.economy.balanceCents);
    }
  }

  // ---- Spieleraktionen -------------------------------------------------

  acceptOrder(orderId: string): boolean {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'incoming') return false;
    const station =
      this.state.stations.find(
        (s) => s.kind === 'diagnosis' && s.unlocked && s.orderId === null,
      ) ??
      this.state.stations.find(
        (s) => s.kind === 'parking' && s.unlocked && s.orderId === null,
      );
    if (!station) {
      notify(this.ctx, 'warning', 'Kein Stellplatz frei – Auftrag kann nicht angenommen werden.');
      return false;
    }
    const vehicle = vehicleById(this.state, order.vehicleId);
    station.orderId = order.id;
    order.stationId = station.id;
    OrderSystem.setStatus(this.state, order, 'accepted');
    order.expiresAtMinute = null;
    vehicle.state = 'driving_in';
    if (!OrderSystem.dispatchVehicle(this.ctx, vehicle, station)) {
      station.orderId = null;
      order.stationId = null;
      vehicle.state = 'incoming';
      OrderSystem.setStatus(this.state, order, 'cancelled');
      return false;
    }
    this.bus.emit('order:accepted', order.id);
    notify(this.ctx, 'success', `Auftrag ${order.id} angenommen: ${vehicle.make} ${vehicle.model}.`);
    return true;
  }

  declineOrder(orderId: string): void {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'incoming') return;
    OrderSystem.cancelOrder(this.ctx, order, 'Abgelehnt');
    this.bus.emit('order:declined', order.id);
  }

  generateOffer(): RepairOrder | null {
    const incoming = this.state.orders.filter(
      (o) => o.status === 'incoming',
    ).length;
    if (incoming >= 3) return null;
    return CustomerSystem.generateOffer(this.ctx);
  }

  orderParts(partId: string, quantity: number, supplierId: string): boolean {
    return SupplierSystem.orderParts(this.ctx, partId, quantity, supplierId);
  }

  hireCandidate(candidateId: string): boolean {
    return PersonnelSystem.hire(this.ctx, candidateId);
  }

  fireWorker(workerId: string): boolean {
    return PersonnelSystem.fire(this.ctx, workerId);
  }

  trainWorker(workerId: string, skill: SkillId): boolean {
    return PersonnelSystem.train(this.ctx, workerId, skill);
  }

  refreshCandidates(): void {
    this.state.candidates = PersonnelSystem.generateCandidates(this.ctx);
  }

  toggleAutoReorder(partId: string): void {
    const inv = this.state.inventory;
    inv.autoReorder[partId] = !inv.autoReorder[partId];
  }

  setAutoSupplier(supplierId: string): void {
    if (this.defs.suppliers.some((s) => s.id === supplierId)) {
      this.state.inventory.autoSupplierId = supplierId;
    }
  }

  buyTool(toolId: string): boolean {
    const tool = this.defs.tools.find((t) => t.id === toolId);
    if (!tool || this.state.ownedTools.includes(toolId)) return false;
    if (this.state.economy.balanceCents < tool.costCents) {
      notify(this.ctx, 'danger', `${tool.name}: Kontostand reicht nicht (${(tool.costCents / 100).toFixed(2)} €).`);
      return false;
    }
    EconomySystem.book(this.state.economy, {
      id: `tool-${toolId}`,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -tool.costCents,
      category: 'investment',
      label: `Spezialwerkzeug: ${tool.name}`,
    });
    this.state.ownedTools.push(toolId);
    this.bus.emit('upgrade:purchased', toolId);
    notify(this.ctx, 'success', `${tool.name} angeschafft – entsprechende Reparaturen sind jetzt möglich.`);
    return true;
  }

  offerDiscount(orderId: string, pct: number): boolean {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'waiting_for_approval' || !order.offerAtRisk) return false;
    if (![5, 10, 15, 20, 25].includes(pct)) return false;
    order.discountPct = pct;
    const customer = this.state.customers.find((c) => c.id === order.customerId);
    const effective = Math.round((order.estimateCents ?? 0) * (1 - pct / 100));
    // Kleine Chance, dass der Kunde auch Mehrkosten akzeptiert (Stammkunden eher)
    const extraChance = Math.min(
      0.4,
      0.15 +
        (customer && customer.visits >= 2 ? 0.15 : 0) +
        (customer && (customer.lastSatisfaction ?? 0) >= 80 ? 0.1 : 0),
    );
    if (effective <= order.budgetCents) {
      OrderSystem.approve(this.ctx, order);
      notify(this.ctx, 'success', `${customer?.name ?? 'Kunde'} nimmt das Angebot mit ${pct} % Rabatt an.`);
    } else if (this.rng.chance(extraChance)) {
      OrderSystem.approve(this.ctx, order);
      notify(this.ctx, 'success', `${customer?.name ?? 'Kunde'} akzeptiert die Mehrkosten und bleibt – mit ${pct} % Rabatt.`);
    } else {
      // Einmaliger Versuch: lehnt der Kunde ab, geht er endgültig
      OrderSystem.cancelOrder(this.ctx, order, `Rabatt ${pct} % abgelehnt – Kunde geht`);
      notify(this.ctx, 'warning', `${customer?.name ?? 'Kunde'} lehnt auch mit ${pct} % Rabatt ab und geht (Budget ${(order.budgetCents / 100).toFixed(2)} €).`);
    }
    return true;
  }

  insistPrice(orderId: string): void {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'waiting_for_approval') return;
    OrderSystem.cancelOrder(this.ctx, order, 'Preis bestanden – Kunde lehnt ab');
  }

  buyParking(): boolean {
    const park = this.state.stations.find((s) => s.kind === 'parking' && !s.unlocked);
    if (!park) return false;
    const cost = 120000;
    if (this.state.economy.balanceCents < cost) {
      notify(this.ctx, 'danger', 'Parkplatz: Kontostand reicht nicht (1.200 €).');
      return false;
    }
    EconomySystem.book(this.state.economy, {
      id: `upgrade-${park.id}`,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -cost,
      category: 'investment',
      label: `Parkplatz ${park.id.replace('park', '')} (Straße)`,
    });
    park.unlocked = true;
    this.bus.emit('upgrade:purchased', park.id);
    notify(this.ctx, 'success', `Parkplatz ${park.id.replace('park', '')} erschlossen (1.200 €).`);
    return true;
  }

  /** RNG-Zustand in den Snapshot übernehmen (Spieleraktionen ziehen Zufallszahlen). */
  syncRngState(): void {
    this.state.rngState = this.rng.state;
  }

  chooseEvent(choiceId: string): void {
    EventSystem.choose(this.ctx, choiceId);
  }

  setMarketing(level: number): void {
    this.state.marketingLevel = Math.max(0, Math.min(3, Math.round(level)));
  }

  toggleSound(): void {
    this.state.soundEnabled = !this.state.soundEnabled;
  }

  setOrderRate(value: number): void {
    this.state.orderRateFactor = Math.max(0.5, Math.min(3, Math.round(value * 10) / 10));
  }

  /** Kunde bietet wenig, soll aber bleiben: Preis = Kundenbudget. */
  acceptBudget(orderId: string): boolean {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'waiting_for_approval' || !order.offerAtRisk) return false;
    order.acceptedBudgetCents = order.budgetCents;
    OrderSystem.approve(this.ctx, order);
    const customer = this.state.customers.find((c) => c.id === order.customerId);
    notify(this.ctx, 'success', `${customer?.name ?? 'Kunde'} bleibt: Rechnung zum Budget ${(order.budgetCents / 100).toFixed(2)} € akzeptiert.`);
    return true;
  }

  /** Bestellt die Fehlmenge aller benötigten Varianten eines Auftrags. */
  orderMissingParts(orderId: string, supplierId: string): boolean {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) return false;
    let all = true;
    for (const n of order.partsNeeded) {
      const avail = InventorySystem.available(this.state.inventory, n.partId);
      const incoming = InventorySystem.openIncoming(this.state.deliveries, n.partId);
      const shortfall = n.quantity - avail - incoming;
      if (shortfall > 0) {
        const ok = SupplierSystem.orderParts(this.ctx, n.partId, shortfall, supplierId);
        if (!ok) all = false;
      }
    }
    return all;
  }

  /** Kunde um Terminaufschub bitten; bei Zusage wird bestellt. */
  requestPartsDelay(orderId: string, supplierId: string): 'accepted' | 'rejected' | 'invalid' {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'waiting_for_parts') return 'invalid';
    const customer = this.state.customers.find((c) => c.id === order.customerId);
    const profile = customer?.profile ?? 'regular';
    const chance = delayChance(this.state, profile, customer?.lastSatisfaction ?? null);
    if (!this.rng.chance(chance)) {
      OrderSystem.cancelOrder(this.ctx, order, 'Aufschub abgelehnt – Kunde geht');
      notify(this.ctx, 'warning', `${customer?.name ?? 'Kunde'} lehnt den Aufschub ab und geht.`);
      return 'rejected';
    }
    const extra = DELAY_BY_PROFILE[profile];
    order.dueAtMinute += extra;
    this.orderMissingParts(orderId, supplierId);
    notify(this.ctx, 'success', `${customer?.name ?? 'Kunde'} gewährt Aufschub (+${Math.round(extra / 60)} h). Fehlende Teile bestellt.`);
    return 'accepted';
  }

  declinePartsOrder(orderId: string): void {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) return;
    OrderSystem.cancelOrder(this.ctx, order, 'Teile fehlen – Auftrag abgewiesen');
  }

  /** Ladenhüter verkaufen: unreserved Bestand zu 60 % des Marktpreises. */
  /** Bestellt die in den letzten 48 h verbrauchten Mengen gesammelt nach (zentral). */
  restockConsumed(): { count: number; costCents: number } {
    const inv = this.state.inventory;
    const supplier = inv.autoSupplierId || 'teileprofi';
    let count = 0;
    let cost = 0;
    for (const p of this.defs.parts) {
      const used = InventorySystem.usageWithin(inv, p.id, 2880, this.state.totalMinutes);
      if (used <= 0) continue;
      const incoming = InventorySystem.openIncoming(this.state.deliveries, p.id);
      const need = Math.max(0, used - incoming);
      if (need <= 0) continue;
      const before = this.state.economy.balanceCents;
      if (SupplierSystem.orderParts(this.ctx, p.id, need, supplier, true)) {
        count += 1;
        cost += before - this.state.economy.balanceCents;
      }
    }
    if (count > 0) {
      notify(this.ctx, 'success', `Verbrauchte Mengen nachbestellt: ${count} Varianten (${(cost / 100).toFixed(2)} €).`);
    } else {
      notify(this.ctx, 'info', 'Keine verbrauchten Mengen nachzubestellen.');
    }
    return { count, costCents: cost };
  }

  /** Höherwertige Variante gleicher Kategorie+Größe, die vorrätig ist (oder null). */
  findSubstitute(partId: string): string | null {
    const part = this.defs.parts.find((p) => p.id === partId);
    if (!part) return null;
    const rank: Record<string, number> = { budget: 0, standard: 1, premium: 2 };
    const candidates = this.defs.parts
      .filter((p) => p.category === part.category && p.spec === part.spec && (rank[p.quality] ?? 0) > (rank[part.quality] ?? 0))
      .filter((p) => InventorySystem.available(this.state.inventory, p.id) > 0)
      .sort((a, b) => (rank[a.quality] ?? 0) - (rank[b.quality] ?? 0));
    return candidates[0]?.id ?? null;
  }

  /** Ersetzt eine fehlende Variante im Auftrag durch die vorgeschlagene Alternative. */
  useSubstitute(orderId: string, fromPartId: string, toPartId: string): boolean {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'waiting_for_parts') return false;
    const need = order.partsNeeded.find((n) => n.partId === fromPartId);
    const to = this.defs.parts.find((p) => p.id === toPartId);
    if (!need || !to) return false;
    if (InventorySystem.available(this.state.inventory, toPartId) < need.quantity) return false;
    need.partId = toPartId;
    order.partsReserved = false;
    order.partsPromptShown = false;
    notify(this.ctx, 'info', `Alternative verwendet: ${to.name} statt der fehlenden Variante (${order.id}).`);
    return true;
  }

  sellVariant(variantId: string): boolean {
    const part = this.defs.parts.find((p) => p.id === variantId);
    if (!part) return false;
    const inv = this.state.inventory;
    const qty = (inv.stock[variantId] ?? 0) - (inv.reserved[variantId] ?? 0);
    if (qty <= 0) return false;
    const revenue = Math.round(EconomySystem.marketBuyCents(this.state, part) * 0.6) * qty;
    EconomySystem.book(this.state.economy, {
      id: `sell-${variantId}-${this.state.nextId++}`,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: revenue,
      category: 'other',
      label: `Lagerverkauf: ${part.name} ×${qty}`,
    });
    inv.stock[variantId] = (inv.stock[variantId] ?? 0) - qty;
    notify(this.ctx, 'success', `${qty}× ${part.name} verkauft (${(revenue / 100).toFixed(2)} €).`);
    return true;
  }

  pinVariant(variantId: string): void {
    const inv = this.state.inventory;
    inv.pinned[variantId] = !inv.pinned[variantId];
  }

  takeLoan(amountCents: number): boolean {
    if (!Number.isInteger(amountCents) || amountCents <= 0) return false;
    const debt = this.state.loans.reduce((a, l) => a + l.remainingCents, 0);
    if (debt + amountCents > 5_000_000) {
      notify(this.ctx, 'warning', 'Kreditlimit ausgeschöpft (max. 50.000 € Gesamtschulden).');
      return false;
    }
    const id = `loan-${this.state.nextId++}`;
    EconomySystem.book(this.state.economy, {
      id: `loan-payout-${id}`,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents,
      category: 'other',
      label: `Kreditauszahlung (${(amountCents / 100).toFixed(2)} €)`,
    });
    this.state.loans.push({
      id,
      principalCents: amountCents,
      remainingCents: amountCents,
      interestBpPerDay: 5,
      takenAtMinute: this.state.totalMinutes,
    });
    notify(this.ctx, 'info', `Kredit aufgenommen: ${(amountCents / 100).toFixed(2)} € (0,05 % Zinsen pro Tag).`);
    return true;
  }

  repayLoan(loanId: string, amountCents: number): boolean {
    const loan = this.state.loans.find((l) => l.id === loanId);
    if (!loan) return false;
    const pay = Math.min(amountCents, loan.remainingCents, this.state.economy.balanceCents);
    if (pay <= 0) return false;
    EconomySystem.book(this.state.economy, {
      id: `loan-repay-${loanId}-${this.state.nextId++}`,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -pay,
      category: 'other',
      label: `Kreditstilgung (${(pay / 100).toFixed(2)} €)`,
    });
    loan.remainingCents -= pay;
    if (loan.remainingCents <= 0) {
      this.state.loans = this.state.loans.filter((l) => l.id !== loanId);
      notify(this.ctx, 'success', 'Kredit vollständig getilgt.');
    }
    return true;
  }


  setHourlyRate(cents: number): void {
    this.state.economy.hourlyRateCents = Math.max(
      3000,
      Math.min(20000, Math.round(cents)),
    );
  }

  setPartsMarkup(pct: number): void {
    this.state.economy.partsMarkupPct = Math.max(0, Math.min(150, Math.round(pct)));
  }

  setSpeed(speed: number): void {
    this.state.speed = speed;
  }

  buyLift(): boolean {
    const lift = this.state.stations.find((s) => s.kind === 'lift' && !s.unlocked);
    if (!lift) return false;
    const cost = 800000;
    if (this.state.economy.balanceCents < cost) {
      notify(this.ctx, 'danger', 'Hebebühne: Kontostand reicht nicht (8.000 €).');
      return false;
    }
    const n = lift.id.replace('lift', '');
    EconomySystem.book(this.state.economy, {
      id: `upgrade-${lift.id}`,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -cost,
      category: 'investment',
      label: `Hebebühne ${n}`,
    });
    lift.unlocked = true;
    this.map = new TileMap(MAP_WIDTH, MAP_HEIGHT, this.state.stations);
    this.bus.emit('upgrade:purchased', lift.id);
    notify(this.ctx, 'success', `Hebebühne ${n} installiert!`);
    return true;
  }

  buyDiagnosisBay(): boolean {
    const bay = this.state.stations.find((s) => s.kind === 'diagnosis' && !s.unlocked);
    if (!bay) return false;
    const cost = 500000;
    if (this.state.economy.balanceCents < cost) {
      notify(this.ctx, 'danger', 'Diagnoseplatz: Kontostand reicht nicht (5.000 €).');
      return false;
    }
    const n = bay.id.replace('diag', '');
    EconomySystem.book(this.state.economy, {
      id: `upgrade-${bay.id}`,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -cost,
      category: 'investment',
      label: `Diagnoseplatz ${n}`,
    });
    bay.unlocked = true;
    this.map = new TileMap(MAP_WIDTH, MAP_HEIGHT, this.state.stations);
    this.bus.emit('upgrade:purchased', bay.id);
    notify(this.ctx, 'success', `Diagnoseplatz ${n} installiert!`);
    return true;
  }

  setAllAutoReorder(on: boolean): void {
    for (const p of this.defs.parts) {
      this.state.inventory.autoReorder[p.id] = on;
    }
    notify(this.ctx, 'info', on ? 'Auto-Nachbestellung für alle Artikel aktiviert.' : 'Auto-Nachbestellung für alle Artikel deaktiviert.');
  }

  expandStorage(): boolean {
    const cost = 250000;
    if (this.state.economy.balanceCents < cost) {
      notify(this.ctx, 'danger', 'Lagerausbau: Kontostand reicht nicht (2.500 €).');
      return false;
    }
    const id = `upgrade-storage-${this.state.inventory.capacity}`;
    EconomySystem.book(this.state.economy, {
      id,
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -cost,
      category: 'investment',
      label: 'Lagererweiterung',
    });
    this.state.inventory.capacity += 60;
    this.bus.emit('upgrade:purchased', 'storage');
    notify(this.ctx, 'success', `Lager erweitert: Kapazität jetzt ${this.state.inventory.capacity} Teile.`);
    return true;
  }

  /** Pfad-Check für UI (z. B. Platzierung) – rein lesend. */
  isReachable(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    return findPath(this.map, from, to) !== null;
  }

  stationFor(orderId: string) {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order?.stationId) return null;
    return stationById(this.state, order.stationId);
  }

  /** Reale Sekunden → Spielminuten gemäß Geschwindigkeit. */
  realSecondsToGameMinutes(realSeconds: number): number {
    return realSeconds * GAME_MINUTES_PER_REAL_SECOND * this.state.speed;
  }
}
