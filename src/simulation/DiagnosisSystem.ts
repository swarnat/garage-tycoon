import type { RepairOrder, Worker } from '../entities/types';
import { DIAGNOSIS_BASE_MINUTES, DIAGNOSIS_FEE_CENTS } from '../entities/types';
import { RepairSystem } from './RepairSystem';
import { OrderSystem } from './OrderSystem';
import type { SimContext } from './context';
import { notify, repairDef } from './context';

/** Diagnose: Kundenmeldung ≠ Ursache; Diagnose deckt tatsächliche Defekte auf. */
export class DiagnosisSystem {
  static start(ctx: SimContext, order: RepairOrder, worker: Worker): void {
    OrderSystem.setStatus(ctx.state, order, 'diagnosing');
    order.diagnosisRemainingMinutes =
      DIAGNOSIS_BASE_MINUTES *
      RepairSystem.durationFactor(worker.skills.diagnosis);
  }

  static complete(ctx: SimContext, order: RepairOrder): void {
    order.revealed = true;
    order.jobs = order.defectRepairIds.map((id) =>
      RepairSystem.buildJob(repairDef(ctx, id)),
    );
    const needMap = new Map<string, number>();
    for (const job of order.jobs) {
      const def = repairDef(ctx, job.repairId);
      for (const p of def.requiredParts) {
        needMap.set(p.partId, (needMap.get(p.partId) ?? 0) + p.quantity);
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
  }
}
