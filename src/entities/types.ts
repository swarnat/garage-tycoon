/** Zentrale Datenmodelle. Geldbeträge sind immer ganzzahlige Cent-Werte. */

export interface Vec {
  x: number;
  y: number;
}

export type SkillId =
  | 'engine'
  | 'electrical'
  | 'suspension'
  | 'brakes'
  | 'transmission'
  | 'diagnosis';

export type OrderStatus =
  | 'incoming'
  | 'accepted'
  | 'waiting_for_diagnosis'
  | 'diagnosing'
  | 'waiting_for_approval'
  | 'waiting_for_parts'
  | 'ready_for_repair'
  | 'repairing'
  | 'quality_check'
  | 'completed'
  | 'delivered'
  | 'cancelled';

export type OrderType =
  | 'standard'
  | 'maintenance'
  | 'inspection'
  | 'diagnosis'
  | 'emergency'
  | 'major';

export type WorkerState =
  | 'idle'
  | 'moving'
  | 'diagnosing'
  | 'repairing'
  | 'fetching_parts'
  | 'quality_check'
  | 'waiting'
  | 'break'
  | 'off_duty';

export type StationKind =
  | 'lift'
  | 'diagnosis'
  | 'storage'
  | 'office'
  | 'break_room'
  | 'parking'
  | 'entry'
  | 'exit';

export type CustomerProfile =
  | 'price_sensitive'
  | 'quality_oriented'
  | 'time_critical'
  | 'regular'
  | 'business';

export interface Transaction {
  id: string;
  day: number;
  atMinute: number;
  /** Vorzeichenbehafteter Betrag in Cent. */
  amountCents: number;
  category:
    | 'revenue'
    | 'parts_purchase'
    | 'salary'
    | 'fixed_costs'
    | 'investment'
    | 'other';
  label: string;
  orderId?: string;
}

export interface DailyStats {
  day: number;
  revenueCents: number;
  partsCostCents: number;
  salaryCents: number;
  fixedCostCents: number;
  investmentCents: number;
  ordersCompleted: number;
  balanceEndCents: number;
}

export interface EconomyState {
  balanceCents: number;
  hourlyRateCents: number;
  partsMarkupPct: number;
  transactions: Transaction[];
  daily: DailyStats[];
  bookedIds: string[];
}

export interface WorkerTask {
  kind: 'diagnose' | 'repair' | 'quality_check';
  orderId: string;
  stationId: string;
  phase: 'to_storage' | 'to_station' | 'working';
  /** Verbleibende Spielminuten des aktuellen Schritts. */
  remainingMinutes: number;
}

export interface Worker {
  id: string;
  name: string;
  salaryCentsPerDay: number;
  skills: Record<SkillId, number>;
  experience: number;
  state: WorkerState;
  pos: Vec;
  path: Vec[];
  task: WorkerTask | null;
  shiftStartMinute: number;
  shiftEndMinute: number;
  speedTilesPerMinute: number;
  workedMinutes: number;
  onDutyMinutes: number;
}

export interface RepairJob {
  repairId: string;
  stepIndex: number;
  stepRemainingMinutes: number;
  done: boolean;
}

export interface PartNeed {
  partId: string;
  quantity: number;
}

export interface RepairOrder {
  id: string;
  customerId: string;
  vehicleId: string;
  type: OrderType;
  complaint: string;
  /** Tatsächliche Defekte (Reparatur-IDs), vor Diagnose verborgen. */
  defectRepairIds: string[];
  revealed: boolean;
  status: OrderStatus;
  createdAtMinute: number;
  dueAtMinute: number;
  priority: number;
  jobs: RepairJob[];
  partsNeeded: PartNeed[];
  partsReserved: boolean;
  partsAtBay: boolean;
  estimateCents: number | null;
  invoiceCents: number | null;
  budgetCents: number;
  satisfaction: number | null;
  assignedWorkerId: string | null;
  stationId: string | null;
  diagnosisRemainingMinutes: number;
  qcRemainingMinutes: number;
  billed: boolean;
  laborMinutesActual: number;
  expiresAtMinute: number | null;
  statusLog: { atMinute: number; status: OrderStatus }[];
}

export type VehicleState =
  | 'incoming'
  | 'driving_in'
  | 'waiting'
  | 'at_diagnosis'
  | 'driving_to_lift'
  | 'at_lift'
  | 'driving_out'
  | 'gone';

export interface Vehicle {
  id: string;
  modelId: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  vehicleClass: string;
  color: number;
  ownerId: string;
  orderId: string;
  pos: Vec;
  path: Vec[];
  state: VehicleState;
  targetStationId: string | null;
}

export interface Customer {
  id: string;
  name: string;
  profile: CustomerProfile;
  visits: number;
}

export interface Station {
  id: string;
  kind: StationKind;
  rect: { x: number; y: number; w: number; h: number };
  interact: Vec;
  orderId: string | null;
  unlocked: boolean;
}

export interface Delivery {
  id: string;
  partId: string;
  quantity: number;
  supplierId: string;
  orderedAtMinute: number;
  arriveAtMinute: number;
  costCents: number;
  done: boolean;
}

export interface InventoryState {
  stock: Record<string, number>;
  reserved: Record<string, number>;
  minStock: Record<string, number>;
  capacity: number;
}

export interface GameNotification {
  id: number;
  atMinute: number;
  kind: 'info' | 'success' | 'warning' | 'danger';
  text: string;
}

export interface GameStatistics {
  ordersCompleted: number;
  ordersCancelled: number;
  totalRevenueCents: number;
  totalPartsCostCents: number;
  totalSalaryCents: number;
  totalFixedCostCents: number;
  totalLaborMinutes: number;
  satisfactionSum: number;
}

export interface GameState {
  version: number;
  seed: number;
  rngState: number;
  totalMinutes: number;
  speed: number;
  reputation: number;
  economy: EconomyState;
  workers: Worker[];
  vehicles: Vehicle[];
  orders: RepairOrder[];
  customers: Customer[];
  inventory: InventoryState;
  deliveries: Delivery[];
  stations: Station[];
  notifications: GameNotification[];
  statistics: GameStatistics;
  nextOrderAttemptAtMinute: number;
  nextId: number;
  nextNotificationId: number;
}

export interface RepairStepDef {
  id: string;
  name: string;
  durationMinutes: number;
  dependsOn?: string[];
}

export interface RepairDef {
  id: string;
  name: string;
  category: SkillId;
  baseDurationMinutes: number;
  requiredSkill: SkillId;
  minimumSkillLevel: number;
  requiredWorkstation: 'lift' | 'diagnosis' | 'floor';
  requiredParts: PartNeed[];
  steps: RepairStepDef[];
  complaints: string[];
}

export interface PartDef {
  id: string;
  name: string;
  category: string;
  buyCents: number;
}

export interface VehicleModelDef {
  id: string;
  make: string;
  model: string;
  vehicleClass: string;
  years: [number, number];
  colors: number[];
}

export interface SupplierDef {
  id: string;
  name: string;
  leadMinutes: number;
  priceFactor: number;
  shippingCents: number;
}

export interface GameDefs {
  vehicles: VehicleModelDef[];
  parts: PartDef[];
  repairs: RepairDef[];
  suppliers: SupplierDef[];
}

export const SAVE_VERSION = 1;
export const MINUTES_PER_DAY = 1440;
export const GAME_MINUTES_PER_REAL_SECOND = 6;
export const SIM_STEP_MINUTES = 0.25;
export const DIAGNOSIS_BASE_MINUTES = 45;
export const DIAGNOSIS_FEE_CENTS = 4900;
export const QC_BASE_MINUTES = 15;
export const RENT_CENTS_PER_DAY = 9000;
export const UTILITIES_CENTS_PER_DAY = 3000;
export const WORKER_SPEED_TILES_PER_MINUTE = 0.35;
export const VEHICLE_SPEED_TILES_PER_MINUTE = 1.6;
