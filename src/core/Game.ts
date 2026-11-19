import type { GameState, RepairOrder, Worker } from '../entities/types';
import {
  GAME_MINUTES_PER_REAL_SECOND,
  SAVE_VERSION,
  SIM_STEP_MINUTES,
} from '../entities/types';
import { EventBus } from './EventBus';
import { GameClock } from './GameClock';
import { RandomGenerator } from './RandomGenerator';
import { TileMap } from '../world/TileMap';
import { DEFS } from '../data';
import type { GameDefs } from '../entities/types';
import type { SimContext } from '../simulation/context';
import { notify, stationById, vehicleById } from '../simulation/context';
import { EconomySystem } from '../simulation/EconomySystem';
import { OrderSystem } from '../simulation/OrderSystem';
import { CustomerSystem } from '../simulation/CustomerSystem';
import { WorkerSystem } from '../simulation/WorkerSystem';
import { VehicleSystem } from '../simulation/VehicleSystem';
import { SupplierSystem } from '../simulation/SupplierSystem';
import { InventorySystem } from '../simulation/InventorySystem';
import { PersonnelSystem } from '../simulation/PersonnelSystem';
import type { SkillId } from '../entities/types';
import { findPath } from '../world/Pathfinding';

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
): Worker {
  return {
    id,
    name,
    salaryCentsPerDay: 16000,
    skills,
    experience: 0,
    state: 'idle',
    pos,
    path: [],
    task: null,
    shiftStartMinute: 480,
    shiftEndMinute: 1080,
    speedTilesPerMinute: 0.35,
    workedMinutes: 0,
    onDutyMinutes: 0,
    trainingMinutes: 0,
    pendingTraining: null,
  };
}

export function createNewGame(seed: number): GameState {
  const stock: Record<string, number> = {};
  const reserved: Record<string, number> = {};
  const minStock: Record<string, number> = {};
  for (const p of DEFS.parts) {
    stock[p.id] = INITIAL_STOCK[p.id] ?? 0;
    reserved[p.id] = 0;
    minStock[p.id] = INITIAL_STOCK[p.id] ? 2 : 0;
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
      ),
      startingWorker(
        'w2',
        'Jonas Weber',
        { engine: 45, electrical: 70, suspension: 60, brakes: 50, transmission: 55, diagnosis: 50 },
        { x: 6, y: 7 },
      ),
    ],
    vehicles: [],
    orders: [],
    customers: [],
    inventory: {
      stock,
      reserved,
      minStock,
      capacity: 120,
      autoReorder: {},
      autoSupplierId: 'teileprofi',
    },
    deliveries: [],
    stations: TileMap.defaultStations(),
    candidates: [],
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
    this.map = new TileMap(26, 18, state.stations);
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

  /** Rückt die Simulation in festen Schritten vor (FPS-unabhängig). */
  tick(minutes: number): void {
    this.acc += minutes;
    let guard = 0;
    while (this.acc >= SIM_STEP_MINUTES - 1e-9 && guard++ < 40000) {
      this.step(SIM_STEP_MINUTES);
      this.acc -= SIM_STEP_MINUTES;
    }
  }

  private step(dt: number): void {
    // Uhr mit dem (ggf. extern veränderten) Zustand synchronisieren
    this.clock.totalMinutes = this.state.totalMinutes;
    const newDays = this.clock.advance(dt);
    this.state.totalMinutes = this.clock.totalMinutes;
    for (const d of newDays) {
      EconomySystem.closeDay(this.state, d - 1);
      this.bus.emit('day:started', d);
      notify(this.ctx, 'info', `Tag ${d} beginnt. Gehälter und Fixkosten wurden verbucht.`);
    }
    const ctx = this.ctx;
    SupplierSystem.update(ctx);
    InventorySystem.update(ctx);
    PersonnelSystem.update(ctx);
    CustomerSystem.update(ctx);
    OrderSystem.update(ctx);
    WorkerSystem.update(ctx, dt);
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
    const lift = this.state.stations.find((s) => s.id === 'lift3');
    if (!lift || lift.unlocked) return false;
    const cost = 800000;
    if (this.state.economy.balanceCents < cost) {
      notify(this.ctx, 'danger', 'Hebebühne: Kontostand reicht nicht (8.000 €).');
      return false;
    }
    EconomySystem.book(this.state.economy, {
      id: 'upgrade-lift3',
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -cost,
      category: 'investment',
      label: 'Dritte Hebebühne',
    });
    lift.unlocked = true;
    this.map = new TileMap(26, 18, this.state.stations);
    this.bus.emit('upgrade:purchased', 'lift3');
    notify(this.ctx, 'success', 'Dritte Hebebühne installiert!');
    return true;
  }

  buyDiagnosisBay(): boolean {
    const bay = this.state.stations.find((s) => s.id === 'diag2');
    if (!bay || bay.unlocked) return false;
    const cost = 500000;
    if (this.state.economy.balanceCents < cost) {
      notify(this.ctx, 'danger', 'Zweiter Diagnoseplatz: Kontostand reicht nicht (5.000 €).');
      return false;
    }
    EconomySystem.book(this.state.economy, {
      id: 'upgrade-diag2',
      day: Math.floor(this.state.totalMinutes / 1440) + 1,
      atMinute: this.state.totalMinutes,
      amountCents: -cost,
      category: 'investment',
      label: 'Zweiter Diagnoseplatz',
    });
    bay.unlocked = true;
    this.map = new TileMap(26, 18, this.state.stations);
    this.bus.emit('upgrade:purchased', 'diag2');
    notify(this.ctx, 'success', 'Zweiter Diagnoseplatz installiert!');
    return true;
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
