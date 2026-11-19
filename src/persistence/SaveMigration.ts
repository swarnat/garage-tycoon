import { SAVE_VERSION } from '../entities/types';
import { TileMap } from '../world/TileMap';
import { LEGACY_PART_MAP } from '../data';
import { DEFS } from '../data';
import { SaveError } from './SaveValidation';

/** Versionierte Migrationen: jede Stufe hebt die Version um 1 an. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let version = raw.version as number;
  if (version === 0) {
    // v0 → v1: Benachrichtigungsfelder ergänzen
    if (!Array.isArray(raw.notifications)) raw.notifications = [];
    if (typeof raw.nextNotificationId !== 'number') raw.nextNotificationId = 1;
    version = 1;
    raw.version = version;
  }
  if (version === 1) {
    // v1 → v2: Parkplätze an die größeren Fahrzeug-Sprites anpassen (3×2 statt 2×1)
    const parkingRects: Record<string, { x: number; y: number; w: number; h: number }> = {
      park1: { x: 4, y: 13, w: 3, h: 2 },
      park2: { x: 8, y: 13, w: 3, h: 2 },
      park3: { x: 12, y: 13, w: 3, h: 2 },
    };
    if (Array.isArray(raw.stations)) {
      for (const s of raw.stations as Record<string, unknown>[]) {
        const rect = parkingRects[s.id as string];
        if (s.kind === 'parking' && rect) {
          s.rect = rect;
          s.interact = { x: rect.x, y: rect.y };
        }
      }
    }
    version = 2;
    raw.version = version;
  }
  if (version === 2) {
    // v2 → v3: Auto-Nachbestellung, Kandidaten, Weiterbildung
    version = 3;
    raw.version = version;
  }
  if (version === 3) {
    // v3 → v4: erweiterte Diagnosen, Stammkunden, zweiter Diagnoseplatz
    version = 4;
    raw.version = version;
  }
  if (version === 4) {
    // v4 → v5: Werkzeuge, Marktpreise, Kredite, Motivation, Team-Reparaturen, Qualität
    version = 5;
    raw.version = version;
  }
  if (version === 5) {
    for (const o of (raw.orders as Array<Record<string, unknown>>) ?? []) {
      o.offerAtRisk ??= false;
      o.approvalDeadline ??= null;
      o.discountPct ??= 0;
    }
    for (const c of (raw.candidates as Array<Record<string, unknown>>) ?? []) {
      c.speedTilesPerMinute ??= 0.35;
    }
    version = 6;
    raw.version = version;
  }
  if (version === 6) {
    for (const o of (raw.orders as Array<Record<string, unknown>>) ?? []) {
      o.toolPromptShown ??= false;
    }
    // Pausenraum-Interaktionspunkt lag ab v7 in einer Wand
    for (const s of (raw.stations as Array<Record<string, unknown>>) ?? []) {
      if (s.id === 'break_room') s.interact = { x: 3, y: 9 };
    }
    version = 7;
    raw.version = version;
  }
  if (version === 7) {
    const stations = (raw.stations as Array<Record<string, unknown>>) ?? [];
    const oldParks = stations.filter((s) => s.kind === 'parking');
    const kept = stations.filter((s) => s.kind !== 'parking');
    const newParks = TileMap.defaultStations().filter((s) => s.kind === 'parking');
    const vehicles = (raw.vehicles as Array<Record<string, unknown>>) ?? [];
    let pi = 0;
    for (const v of vehicles) {
      if (v.state === 'waiting' && v.targetStationId) {
        const old = oldParks.find((p) => p.id === v.targetStationId);
        if (old) {
          const np = newParks[pi % newParks.length]!;
          pi += 1;
          v.targetStationId = np.id;
          v.pos = { x: np.rect.x + 1, y: 16 };
          np.orderId = (v.orderId as string | null) ?? null;
        }
      }
    }
    raw.stations = [...kept, ...newParks];
    for (const o of (raw.orders as Array<Record<string, unknown>>) ?? []) {
      o.pickupAtMinute ??= null;
      o.cancelReason ??= null;
      o.satisfactionReason ??= '';
      o.acceptedBudgetCents ??= null;
    }
    raw.orderRateFactor ??= 1;
    version = 8;
    raw.version = version;
  }
  if (version === 8) {
    // Neues Layout: Diagnose vorn, 4 Hebebühnen hinten, längere Halle (32 Tiles)
    const oldStations = (raw.stations as Array<Record<string, unknown>>) ?? [];
    const newStations = TileMap.defaultStations() as unknown as Array<Record<string, unknown>>;
    for (const ns of newStations) {
      const old = oldStations.find((o) => o.id === ns.id);
      if (old) {
        ns.unlocked = old.unlocked ?? ns.unlocked;
        ns.orderId = old.orderId ?? null;
      }
    }
    raw.stations = newStations;
    // Fahrzeuge auf die neuen Stationspositionen umsetzen
    const orders = (raw.orders as Array<Record<string, unknown>>) ?? [];
    for (const v of (raw.vehicles as Array<Record<string, unknown>>) ?? []) {
      const st = v.state === 'gone' || v.state === 'incoming' ? null : newStations.find((x) => x.id === v.targetStationId);
      if (!st) continue;
      const rect = st.rect as { x: number; y: number };
      v.pos = { x: rect.x, y: rect.y };
      v.path = [];
      if (v.state === 'driving_in') v.state = st.kind === 'diagnosis' ? 'at_diagnosis' : 'waiting';
      else if (v.state === 'driving_to_lift') v.state = 'at_lift';
      else if (v.state === 'driving_out') { v.state = 'waiting'; v.targetStationId = null; v.pos = { x: 30, y: 15 }; }
    }
    void orders;
    version = 9;
    raw.version = version;
  }
  if (version === 9) {
    const inv = raw.inventory as Record<string, unknown> | undefined;
    if (inv) inv.usageLog ??= [];
    version = 10;
    raw.version = version;
  }
  if (version === 10) {
    const inv = raw.inventory as Record<string, unknown> | undefined;
    if (inv) {
      const mapKeys = (rec: unknown): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries((rec as Record<string, unknown>) ?? {})) {
          out[LEGACY_PART_MAP[k] ?? k] = v;
        }
        return out;
      };
      inv.stock = mapKeys(inv.stock);
      inv.reserved = mapKeys(inv.reserved);
      inv.minStock = mapKeys(inv.minStock);
      inv.autoReorder = mapKeys(inv.autoReorder);
      inv.lastOrdered ??= {};
      inv.pinned ??= {};
      for (const u of (inv.usageLog as Array<Record<string, unknown>>) ?? []) {
        u.partId = LEGACY_PART_MAP[u.partId as string] ?? u.partId;
      }
    }
    for (const d of (raw.deliveries as Array<Record<string, unknown>>) ?? []) {
      d.partId = LEGACY_PART_MAP[d.partId as string] ?? d.partId;
    }
    for (const o of (raw.orders as Array<Record<string, unknown>>) ?? []) {
      o.partsPromptShown ??= false;
      for (const n of (o.partsNeeded as Array<Record<string, unknown>>) ?? []) {
        n.partId = LEGACY_PART_MAP[n.partId as string] ?? n.partId;
      }
    }
    version = 11;
    raw.version = version;
  }
  // Idempotente Normalisierung neuer Felder (auch für aktuelle Version)
  const inv = raw.inventory as Record<string, unknown> | undefined;
  if (inv && typeof inv === 'object') {
    if (typeof inv.autoReorder !== 'object' || inv.autoReorder === null) inv.autoReorder = {};
    if (typeof inv.autoSupplierId !== 'string') inv.autoSupplierId = 'teileprofi';
  }
  if (!Array.isArray(raw.candidates)) raw.candidates = [];
  if (typeof raw.nextAutoOrderCheckAtMinute !== 'number') {
    raw.nextAutoOrderCheckAtMinute = (raw.totalMinutes as number) ?? 480;
  }
  if (typeof raw.lastCandidateRefreshDay !== 'number') {
    raw.lastCandidateRefreshDay = Math.floor(((raw.totalMinutes as number) ?? 480) / 1440) + 1;
  }
  if (Array.isArray(raw.workers)) {
    for (const w of raw.workers as Record<string, unknown>[]) {
      if (typeof w.trainingMinutes !== 'number') w.trainingMinutes = 0;
      if (w.pendingTraining === undefined) w.pendingTraining = null;
    }
  }
  if (Array.isArray(raw.orders)) {
    for (const o of raw.orders as Record<string, unknown>[]) {
      if (typeof o.diagnosisExtended !== 'boolean') o.diagnosisExtended = false;
    }
  }
  if (Array.isArray(raw.customers)) {
    for (const c of raw.customers as Record<string, unknown>[]) {
      if (c.lastSatisfaction === undefined) c.lastSatisfaction = null;
    }
  }
  if (Array.isArray(raw.stations)) {
    const stations = raw.stations as Record<string, unknown>[];
    if (!stations.some((s) => s.id === 'diag2')) {
      const diag2 = TileMap.defaultStations().find((s) => s.id === 'diag2');
      if (diag2) stations.push(JSON.parse(JSON.stringify(diag2)));
    }
  }
  if (!Array.isArray(raw.ownedTools)) raw.ownedTools = ['brake_bleeder'];
  if (typeof raw.marketPriceFactors !== 'object' || raw.marketPriceFactors === null) {
    raw.marketPriceFactors = {};
  }
  const factors = raw.marketPriceFactors as Record<string, unknown>;
  for (const p of DEFS.parts) {
    if (typeof factors[p.id] !== 'number') factors[p.id] = 1;
  }
  if (!Array.isArray(raw.loans)) raw.loans = [];
  if (Array.isArray(raw.workers)) {
    for (const w of raw.workers as Record<string, unknown>[]) {
      if (typeof w.motivation !== 'number') w.motivation = 80;
      if (typeof w.dailyWorkedMinutes !== 'number') w.dailyWorkedMinutes = 0;
      if (typeof w.dailyOnDutyMinutes !== 'number') w.dailyOnDutyMinutes = 0;
    }
  }
  if (Array.isArray(raw.orders)) {
    for (const o of raw.orders as Record<string, unknown>[]) {
      if (!Array.isArray(o.crewIds)) o.crewIds = [];
      if (typeof o.qualityIssues !== 'number') o.qualityIssues = 0;
      if (o.qualityScore === undefined) o.qualityScore = null;
    }
  }
  const stats = raw.statistics as Record<string, unknown> | undefined;
  if (stats && typeof stats === 'object') {
    if (typeof stats.qcFailures !== 'number') stats.qcFailures = 0;
    if (typeof stats.complaints !== 'number') stats.complaints = 0;
    if (typeof stats.repairsByType !== 'object' || stats.repairsByType === null) stats.repairsByType = {};
  }
  if (version !== SAVE_VERSION) {
    throw new SaveError(`Keine Migration für Version ${version} verfügbar`);
  }
  return raw;
}
