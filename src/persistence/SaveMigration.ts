import { SAVE_VERSION } from '../entities/types';
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
  if (version !== SAVE_VERSION) {
    throw new SaveError(`Keine Migration für Version ${version} verfügbar`);
  }
  return raw;
}
