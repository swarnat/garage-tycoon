import { SAVE_VERSION } from '../entities/types';
import { TileMap } from '../world/TileMap';
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
  if (version !== SAVE_VERSION) {
    throw new SaveError(`Keine Migration für Version ${version} verfügbar`);
  }
  return raw;
}
