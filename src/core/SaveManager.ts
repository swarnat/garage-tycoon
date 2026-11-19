import type { GameState } from '../entities/types';
import { SAVE_VERSION } from '../entities/types';
import {
  SAVE_KEY,
  defaultStorage,
  type StorageLike,
} from '../persistence/LocalStorageAdapter';
import { idbGet, idbPut, idbDelete } from '../persistence/IndexedDBAdapter';
import { SaveError, validateState } from '../persistence/SaveValidation';
import { migrate } from '../persistence/SaveMigration';

export { SaveError };

function savedAtOf(json: string): number {
  try {
    const raw = JSON.parse(json) as { savedAt?: unknown };
    return typeof raw.savedAt === 'number' ? raw.savedAt : 0;
  } catch {
    return 0;
  }
}

/** Versioniertes JSON-Savegame; keine Assets, nur IDs und Zustand. */
export class SaveManager {
  static serialize(state: GameState): string {
    return JSON.stringify({ ...state, version: SAVE_VERSION, savedAt: Date.now() });
  }

  static parse(json: string): GameState {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new SaveError('Spielstand ist kein gültiges JSON');
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new SaveError('Spielstand ist kein Objekt');
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.version !== 'number') {
      throw new SaveError('Spielstand-Version fehlt');
    }
    if (obj.version > SAVE_VERSION) {
      throw new SaveError(`Unbekannte Spielstand-Version ${obj.version}`);
    }
    const migrated = migrate(obj);
    validateState(migrated);
    delete migrated.savedAt;
    return migrated as unknown as GameState;
  }

  // ---- Synchrone localStorage-Variante (Fallback / Notfallsicherung) ----

  static save(state: GameState, storage: StorageLike | null = defaultStorage()): boolean {
    if (!storage) return false;
    try {
      storage.setItem(SAVE_KEY, SaveManager.serialize(state));
      return true;
    } catch {
      return false;
    }
  }

  static load(storage: StorageLike | null = defaultStorage()): GameState | null {
    if (!storage) return null;
    try {
      const json = storage.getItem(SAVE_KEY);
      if (!json) return null;
      return SaveManager.parse(json);
    } catch {
      return null;
    }
  }

  static clear(storage: StorageLike | null = defaultStorage()): void {
    try {
      storage?.removeItem(SAVE_KEY);
    } catch {
      // Speicher nicht verfügbar – egal
    }
  }

  // ---- Primär: IndexedDB, Fallback: localStorage ----

  /** Speichert in IndexedDB; bei Fehlern Fallback auf localStorage. */
  static async saveAsync(state: GameState): Promise<boolean> {
    const json = SaveManager.serialize(state);
    try {
      await idbPut(SAVE_KEY, json);
      // Alten localStorage-Stand entfernen, damit nichts divergiert
      SaveManager.clear();
      return true;
    } catch {
      return SaveManager.save(state);
    }
  }

  /**
   * Lädt den neuesten Spielstand aus IndexedDB oder localStorage
   * (Vergleich über savedAt) und migriert alte Stände nach IndexedDB.
   */
  static async loadAsync(): Promise<GameState | null> {
    let idbJson: string | null = null;
    try {
      idbJson = await idbGet(SAVE_KEY);
    } catch {
      idbJson = null;
    }
    let lsJson: string | null = null;
    const storage = defaultStorage();
    try {
      lsJson = storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      lsJson = null;
    }
    const idbAt = idbJson ? savedAtOf(idbJson) : -1;
    const lsAt = lsJson ? savedAtOf(lsJson) : -1;
    // Bei Gleichstand gewinnt localStorage (Notfallsicherung beim Verlassen)
    const newest = idbAt > lsAt ? idbJson : lsJson;
    if (!newest) return null;
    try {
      const state = SaveManager.parse(newest);
      // Alten localStorage-Stand in IndexedDB überführen
      if (newest === lsJson && idbAt < lsAt) {
        try {
          await idbPut(SAVE_KEY, newest);
          SaveManager.clear();
        } catch {
          // Fallback bleibt erhalten
        }
      }
      return state;
    } catch {
      // Defekten Primärstand ignorieren und den anderen versuchen
      const other = newest === idbJson ? lsJson : idbJson;
      if (!other) return null;
      try {
        return SaveManager.parse(other);
      } catch {
        return null;
      }
    }
  }

  /** Löscht Spielstände in IndexedDB und localStorage. */
  static async clearAsync(): Promise<void> {
    SaveManager.clear();
    try {
      await idbDelete(SAVE_KEY);
    } catch {
      // IndexedDB nicht verfügbar – egal
    }
  }
}
