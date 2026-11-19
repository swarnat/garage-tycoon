import type { InventoryState, PartNeed } from '../entities/types';
import type { SimContext } from './context';
import { notify } from './context';
import { SupplierSystem } from './SupplierSystem';

/** Lagerbestand, Reservierungen, Verbrauch und automatische Nachbestellung. */
export class InventorySystem {
  static available(inv: InventoryState, partId: string): number {
    return (inv.stock[partId] ?? 0) - (inv.reserved[partId] ?? 0);
  }

  static totalStock(inv: InventoryState): number {
    return Object.values(inv.stock).reduce((a, b) => a + b, 0);
  }

  /** Reserviert alle Positionen atomar; bei Mangel bleibt alles unverändert. */
  static reserve(inv: InventoryState, needs: PartNeed[]): boolean {
    for (const n of needs) {
      if (InventorySystem.available(inv, n.partId) < n.quantity) return false;
    }
    for (const n of needs) {
      inv.reserved[n.partId] = (inv.reserved[n.partId] ?? 0) + n.quantity;
    }
    return true;
  }

  static release(inv: InventoryState, needs: PartNeed[]): void {
    for (const n of needs) {
      const cur = inv.reserved[n.partId] ?? 0;
      inv.reserved[n.partId] = Math.max(0, cur - n.quantity);
    }
  }

  /** Verbraucht reservierte Teile. Wirft bei inkonsistentem Zustand. */
  static consumeReserved(inv: InventoryState, needs: PartNeed[], atMinute = 0): void {
    for (const n of needs) {
      const stock = inv.stock[n.partId] ?? 0;
      const reserved = inv.reserved[n.partId] ?? 0;
      if (reserved < n.quantity || stock < n.quantity) {
        throw new Error(
          `Teileverbrauch ${n.partId}: Bestand/Reservierung unzureichend`,
        );
      }
    }
    for (const n of needs) {
      inv.stock[n.partId] = (inv.stock[n.partId] ?? 0) - n.quantity;
      inv.reserved[n.partId] = (inv.reserved[n.partId] ?? 0) - n.quantity;
      inv.usageLog.push({ partId: n.partId, quantity: n.quantity, atMinute });
    }
  }

  /**
   * Stündliche Prüfung: Auto-Nachbestellung exakt auf den Mindestbestand,
   * wenn verfügbarer Bestand (ohne Reservierungen) darunter liegt
   * und keine Lieferung des Teils offen ist.
   */
  /** Sichtbarkeitsregel im Lager-Modal: 0/0/0 ohne Pin/order ausgeblendet. */
  static isVisible(
    inv: InventoryState,
    variantId: string,
    deliveries: { partId: string; done: boolean }[],
    search: string,
    showAll: boolean,
    name: string,
  ): boolean {
    if (showAll) return true;
    const q = search.trim();
    if (q && name.toLowerCase().includes(q)) return true;
    if (inv.pinned[variantId]) return true;
    if ((inv.stock[variantId] ?? 0) > 0) return true;
    if ((inv.minStock[variantId] ?? 0) > 0) return true;
    if (deliveries.some((d) => !d.done && d.partId === variantId)) return true;
    return false;
  }

  /** Verbrauch eines Teils im Zeitfenster (in Spielminuten vor now). */
  static usageWithin(inv: InventoryState, partId: string, minutes: number, now: number): number {
    const cutoff = now - minutes;
    let sum = 0;
    for (const u of inv.usageLog) {
      if (u.partId === partId && u.atMinute >= cutoff) sum += u.quantity;
    }
    return sum;
  }

  static update(ctx: SimContext): void {
    const s = ctx.state;
    // Verbrauchsprotokoll: nur die letzten 48 h behalten
    const cutoff = s.totalMinutes - 2880;
    if (s.inventory.usageLog.length > 0 && s.inventory.usageLog[0]!.atMinute < cutoff) {
      s.inventory.usageLog = s.inventory.usageLog.filter((u) => u.atMinute >= cutoff);
    }
    if (s.totalMinutes < s.nextAutoOrderCheckAtMinute) return;
    s.nextAutoOrderCheckAtMinute = s.totalMinutes + 60;
    const inv = s.inventory;
    let failed = false;
    for (const p of ctx.defs.parts) {
      if (!inv.autoReorder[p.id]) continue;
      const min = inv.minStock[p.id] ?? 0;
      if (min <= 0) continue;
      const available = InventorySystem.available(inv, p.id);
      if (available >= min) continue;
      if (s.deliveries.some((d) => !d.done && d.partId === p.id)) continue;
      const qty = min - available;
      if (!SupplierSystem.orderParts(ctx, p.id, qty, inv.autoSupplierId, true)) {
        failed = true;
      }
    }
    if (failed) {
      notify(
        ctx,
        'warning',
        'Auto-Bestellung fehlgeschlagen: Kontostand oder Lagerkapazität reicht nicht.',
      );
    }
  }
}
