import type { GameNotification, NotificationCategory } from '../entities/types';

export const TOAST_CATEGORIES = {
  orders: 'Aufträge und Kunden',
  workshop: 'Diagnose, Reparatur und Qualitätskontrolle',
  stock: 'Lagerbestand und fehlende Teile',
  deliveries: 'Bestellungen und Lieferungen',
  market: 'Preistipps des Assistenten',
  personnel: 'Personal',
  finance: 'Finanzen und Ausbauten',
  events: 'Werkstatt-Ereignisse',
  system: 'Spielstand und sonstige Hinweise',
} satisfies Record<NotificationCategory, string>;

export function isToastCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && Object.hasOwn(TOAST_CATEGORIES, value);
}

const KEY = 'garage-tycoon:muted-toasts';
type ToastStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class ToastPreferences {
  private readonly muted = new Set<NotificationCategory>();

  constructor(private readonly storage?: ToastStorage) {
    try {
      const saved: unknown = JSON.parse((this.storage ?? globalThis.localStorage)?.getItem(KEY) ?? '[]');
      if (Array.isArray(saved)) saved.filter(isToastCategory).forEach((c) => this.muted.add(c));
    } catch { /* Ohne Browserspeicher bleiben alle Kategorien standardmäßig an. */ }
  }

  enabled(category: NotificationCategory): boolean {
    return !this.muted.has(category);
  }

  set(category: NotificationCategory, enabled: boolean): void {
    if (enabled) this.muted.delete(category);
    else this.muted.add(category);
    try {
      (this.storage ?? globalThis.localStorage)?.setItem(KEY, JSON.stringify([...this.muted]));
    } catch { /* Die Auswahl gilt weiterhin für die laufende Sitzung. */ }
  }

  visible(notifications: readonly GameNotification[]): GameNotification[] {
    return notifications.filter((n) => this.enabled(n.category ?? 'system'));
  }
}
