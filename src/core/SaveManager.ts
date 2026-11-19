import type { GameState } from '../entities/types';
import { SAVE_VERSION } from '../entities/types';
import {
  SAVE_KEY,
  defaultStorage,
  type StorageLike,
} from '../persistence/LocalStorageAdapter';
import { SaveError, validateState } from '../persistence/SaveValidation';
import { migrate } from '../persistence/SaveMigration';

export { SaveError };

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
}
