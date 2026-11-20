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

export type WorkerRole = 'mechanic' | 'warehouse' | 'assistant';

export type WorkerState =
  | 'idle'
  | 'moving'
  | 'diagnosing'
  | 'repairing'
  | 'fetching_parts'
  | 'quality_check'
  | 'waiting'
  | 'break'
  | 'training'
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
  /** Verbrauch zum Markt-EK bei Entnahme; fehlt in älteren Spielständen. */
  partsUsedCents?: number;
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
  kind: 'diagnose' | 'repair' | 'quality_check' | 'deliver';
  orderId: string;
  stationId: string;
  phase: 'to_storage' | 'to_station' | 'working';
  /** Verbleibende Spielminuten des aktuellen Schritts. */
  remainingMinutes: number;
}

export interface PendingTraining {
  skill: SkillId;
  amount: number;
}

export interface Worker {
  id: string;
  name: string;
  role: WorkerRole;
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
  trainingMinutes: number;
  pendingTraining: PendingTraining | null;
  motivation: number;
  dailyWorkedMinutes: number;
  dailyOnDutyMinutes: number;
  /** Krank (Ereignis): nicht einsetzbar bis zu diesem Zeitpunkt. */
  sickUntilMinute?: number;
}

export interface Candidate {
  id: string;
  name: string;
  role: WorkerRole;
  skills: Record<SkillId, number>;
  salaryCentsPerDay: number;
  hiringFeeCents: number;
  speedTilesPerMinute: number;
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
  /** Teile wurden bereits aus dem Lager verbraucht (Abholung), ggf. noch unterwegs. */
  partsConsumed?: boolean;
  estimateCents: number | null;
  invoiceCents: number | null;
  budgetCents: number;
  satisfaction: number | null;
  assignedWorkerId: string | null;
  stationId: string | null;
  diagnosisRemainingMinutes: number;
  diagnosisExtended: boolean;
  qcRemainingMinutes: number;
  billed: boolean;
  /** Kunde droht abzulehnen – Spieler muss mit Rabatt/Preis reagieren. */
  offerAtRisk: boolean;
  approvalDeadline: number | null;
  discountPct: number;
  /** Werkzeug-Hinweis-Modal wurde bereits angezeigt. */
  toolPromptShown: boolean;
  /** Teile-fehlt-Modal wurde bereits angezeigt. */
  partsPromptShown: boolean;
  /** Kunde holt das Fahrzeug zu diesem Zeitpunkt ab (verzögert). */
  pickupAtMinute: number | null;
  cancelReason: string | null;
  satisfactionReason: string;
  /** Spieler hat das (niedrige) Kundenbudget als Preis akzeptiert. */
  acceptedBudgetCents: number | null;
  laborMinutesActual: number;
  expiresAtMinute: number | null;
  crewIds: string[];
  qualityIssues: number;
  qualityScore: number | null;
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
  | 'waiting_pickup'
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
  lastSatisfaction: number | null;
}

export interface Station {
  id: string;
  kind: StationKind;
  rect: { x: number; y: number; w: number; h: number };
  interact: Vec;
  orderId: string | null;
  unlocked: boolean;
  /** Defekt (Ereignis): gesperrt bis zu diesem Zeitpunkt (Spielminute). */
  brokenUntilMinute?: number;
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

export interface PartUsage {
  partId: string;
  quantity: number;
  atMinute: number;
}

export interface InventoryState {
  stock: Record<string, number>;
  reserved: Record<string, number>;
  minStock: Record<string, number>;
  capacity: number;
  autoReorder: Record<string, boolean>;
  autoSupplierId: string;
  /** Verbrauch durch Reparaturen (letzte 48 h), fuer die Lagerstatistik. */
  usageLog: PartUsage[];
  /** Zeitpunkt der letzten Bestellung je Variante (Ladenhüter-Erkennung). */
  lastOrdered: Record<string, number>;
  /** Manuell eingeblendete Varianten (sonst ausgeblendet bei 0/0/0). */
  pinned: Record<string, boolean>;
}

export interface GameNotification {
  id: number;
  atMinute: number;
  kind: 'info' | 'success' | 'warning' | 'danger';
  text: string;
  /** Optional: Bezug zu einer Teile-Variante (Lagereintrag-Link). */
  partId?: string;
}

export interface Loan {
  id: string;
  principalCents: number;
  remainingCents: number;
  interestBpPerDay: number;
  takenAtMinute: number;
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
  qcFailures: number;
  complaints: number;
  repairsByType: Record<string, number>;
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
  orderRateFactor: number;
  inventory: InventoryState;
  deliveries: Delivery[];
  stations: Station[];
  candidates: Candidate[];
  ownedTools: string[];
  marketPriceFactors: Record<string, number>;
  loans: Loan[];
  notifications: GameNotification[];
  statistics: GameStatistics;
  nextOrderAttemptAtMinute: number;
  nextAutoOrderCheckAtMinute: number;
  lastCandidateRefreshDay: number;
  nextId: number;
  nextNotificationId: number;
  /** Assistent: letzter Alert je Variante (Spielminute) – Cooldown 1 Tag. */
  assistantAlertedAt: Record<string, number>;
  assistantNextScanAtMinute: number;
  activeEvent: GameEvent | null;
  eventLog: EventLogEntry[];
  nextEventCheckAtMinute: number;
  eventsToday: number;
  lastEventDay: number;
  marketingLevel: number;
  soundEnabled: boolean;
  dailySummaryPending: DailySummary | null;
}

export type EventEffect =
  | { type: 'reputation'; delta: number }
  | { type: 'motivationAll'; delta: number }
  | { type: 'fixStation'; delayMinutes: number }
  | { type: 'sick'; hours: number }
  | { type: 'deliveryExpress' }
  | { type: 'spawnOrders'; count: number; budgetFactor: number }
  | { type: 'refund'; pct: number }
  | { type: 'satisfaction'; delta: number }
  | { type: 'bribe' }
  | { type: 'fine'; cents: number };

export interface EventChoice {
  id: string;
  label: string;
  detail: string;
  costCents?: number;
  effects: EventEffect[];
}

export interface GameEvent {
  id: string;
  defId: string;
  title: string;
  text: string;
  choices: EventChoice[];
  defaultChoiceId: string;
  createdAtMinute: number;
  expiresAtMinute: number;
  targetStationId?: string;
  targetWorkerId?: string;
  targetDeliveryId?: string;
  targetDeliveryEta?: number;
  targetOrderId?: string;
}

export interface EventLogEntry {
  defId: string;
  title: string;
  chosenId: string;
  atMinute: number;
}

export interface DailySummary {
  day: number;
  revenueCents: number;
  profitCents: number;
  ordersCompleted: number;
  bestWorkerName: string | null;
  avgSatisfaction: number | null;
  feedback: string;
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
  requiredTools?: string[];
  requiredWorkers?: number;
  followUps?: { repairId: string; chance: number }[];
  steps: RepairStepDef[];
  complaints: string[];
}

export interface ToolDef {
  id: string;
  name: string;
  costCents: number;
  description: string;
}

export type PartQuality = 'budget' | 'standard' | 'premium';

export interface PartDef {
  id: string;
  name: string;
  /** Kategorie = frühere generische Teil-ID (z. B. brake_pads). */
  category: string;
  /** Größen-/Typ-Token (z. B. 15, 280, 5W30, S/M/L). */
  spec: string;
  quality: PartQuality;
  buyCents: number;
}

export interface PartCategoryDef {
  id: string;
  name: string;
}

export interface VehicleModelDef {
  id: string;
  make: string;
  model: string;
  vehicleClass: string;
  years: [number, number];
  colors: number[];
  /** Festgelegte Teile-Specs je Kategorie (bei Ankunft bekannt). */
  partSpecs: Record<string, string>;
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
  categories: PartCategoryDef[];
  repairs: RepairDef[];
  suppliers: SupplierDef[];
  tools: ToolDef[];
}

export const SAVE_VERSION = 14;
export const MINUTES_PER_DAY = 1440;
export const GAME_MINUTES_PER_REAL_SECOND = 6;
export const SIM_STEP_MINUTES = 0.25;
export const DIAGNOSIS_BASE_MINUTES = 45;
export function diagnosisBayCostCents(id: string): number {
  return id === 'diag2' ? 150000 : 500000;
}
export const DIAGNOSIS_FEE_CENTS = 4900;
export const QC_BASE_MINUTES = 15;
export const RENT_CENTS_PER_DAY = 9000;
export const UTILITIES_CENTS_PER_DAY = 3000;
export const WORKER_SPEED_TILES_PER_MINUTE = 0.35;
export const VEHICLE_SPEED_TILES_PER_MINUTE = 1.6;
