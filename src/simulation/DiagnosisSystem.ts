import type { RepairOrder, Worker } from '../entities/types';
import { DIAGNOSIS_BASE_MINUTES, DIAGNOSIS_FEE_CENTS } from '../entities/types';
import { resolveVariant } from './PartsResolver';
import { vehicleById } from './context';
import { RepairSystem } from './RepairSystem';
import { OrderSystem } from './OrderSystem';
import type { SimContext } from './context';
import { notify, repairDef } from './context';

/** Diagnose: Kundenmeldung ≠ Ursache; Diagnose deckt tatsächliche Defekte auf. */
export class DiagnosisSystem {
  static start(ctx: SimContext, order: RepairOrder): void {
    if (order.status === 'waiting_for_diagnosis') {
      OrderSystem.setStatus(ctx.state, order, 'diagnosing');
    }
    // Fortschritt bewahren (Basisminuten); nur initial auf die Basiszeit setzen
    if (order.diagnosisRemainingMinutes <= 0) {
      order.diagnosisRemainingMinutes = DIAGNOSIS_BASE_MINUTES;
    }
  }

  /**
   * Schließt die Diagnose ab. Liefert false, wenn eine Nachuntersuchung
   * nötig ist (unerfahrene Diagnostiker, einmal pro Auftrag).
   */
  static complete(ctx: SimContext, order: RepairOrder, worker: Worker): boolean {
    if (!order.diagnosisExtended && worker.skills.diagnosis < 40) {
      const chance = 0.5 - worker.skills.diagnosis / 100;
      if (ctx.rng.chance(chance)) {
        order.diagnosisExtended = true;
        order.diagnosisRemainingMinutes = DIAGNOSIS_BASE_MINUTES * 0.75;
        notify(
          ctx,
          'warning',
          `Nachuntersuchung nötig (${order.id}): ${worker.name} ist in Diagnose unerfahren und braucht mehr Zeit.`,
        );
        return false;
      }
    }
    order.revealed = true;
    order.jobs = order.defectRepairIds.map((id) =>
      RepairSystem.buildJob(repairDef(ctx, id)),
    );
    // Konkrete Varianten aus Fahrzeug-Steckbrief + Kundenprofil auflösen
    const vehicle = vehicleById(ctx.state, order.vehicleId);
    const model = ctx.defs.vehicles.find((m) => m.id === vehicle.modelId);
    const customer = ctx.state.customers.find((c) => c.id === order.customerId);
    const profile = customer?.profile ?? 'regular';
    const needMap = new Map<string, number>();
    for (const job of order.jobs) {
      const def = repairDef(ctx, job.repairId);
      for (const p of def.requiredParts) {
        const variant = model ? resolveVariant(ctx, p.partId, model, profile) : null;
        const key = variant?.id ?? p.partId;
        needMap.set(key, (needMap.get(key) ?? 0) + p.quantity);
      }
    }
    order.partsNeeded = [...needMap.entries()].map(([partId, quantity]) => ({
      partId,
      quantity,
    }));
    order.estimateCents =
      RepairSystem.laborEstimateCents(ctx, order) +
      RepairSystem.partsSellTotal(ctx, order) +
      DIAGNOSIS_FEE_CENTS;
    OrderSystem.setStatus(ctx.state, order, 'waiting_for_approval');
    ctx.bus.emit('diagnosis:completed', order.id);
    const names = order.jobs
      .map((j) => repairDef(ctx, j.repairId).name)
      .join(', ');
    notify(
      ctx,
      'info',
      `Diagnose abgeschlossen (${order.id}: ${names}). Kostenvoranschlag ${(order.estimateCents / 100).toFixed(2)} €`,
    );
    return true;
  }
}
