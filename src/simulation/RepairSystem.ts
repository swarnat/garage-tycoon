import type {
  RepairDef,
  RepairJob,
  RepairOrder,
  Worker,
} from '../entities/types';
import { EconomySystem } from './EconomySystem';
import type { SimContext } from './context';
import { repairDef } from './context';

/** Reparaturdefinitionen, Arbeitszeiten und Schrittfortschritt. */
export class RepairSystem {
  /** Qualifikationsfaktor: Skill 50 = 1.0, 100 = 0.5, 0 = 1.5. */
  static durationFactor(skill: number): number {
    return Math.max(0.5, 1.5 - skill / 100);
  }

  static canWorkerDo(worker: Worker, def: RepairDef): boolean {
    return worker.skills[def.requiredSkill] >= def.minimumSkillLevel;
  }

  static buildJob(def: RepairDef): RepairJob {
    const first = def.steps[0];
    if (!first) throw new Error(`Reparatur ${def.id} hat keine Schritte`);
    return {
      repairId: def.id,
      stepIndex: 0,
      stepRemainingMinutes: first.durationMinutes,
      done: false,
    };
  }

  static currentJob(order: RepairOrder): RepairJob | null {
    return order.jobs.find((j) => !j.done) ?? null;
  }

  static orderNeedsLift(ctx: SimContext, order: RepairOrder): boolean {
    return order.jobs.some(
      (j) => repairDef(ctx, j.repairId).requiredWorkstation === 'lift',
    );
  }

  static partsSellTotal(ctx: SimContext, order: RepairOrder): number {
    let sum = 0;
    for (const n of order.partsNeeded) {
      const p = ctx.defs.parts.find((x) => x.id === n.partId);
      if (!p) throw new Error(`Teil ${n.partId} fehlt in Definitionen`);
      sum += EconomySystem.sellPrice(p.buyCents, ctx.state.economy.partsMarkupPct) * n.quantity;
    }
    return sum;
  }

  static laborEstimateCents(ctx: SimContext, order: RepairOrder): number {
    const minutes = order.jobs.reduce((sum, j) => {
      const def = repairDef(ctx, j.repairId);
      return sum + def.baseDurationMinutes;
    }, 0);
    return Math.round((minutes / 60) * ctx.state.economy.hourlyRateCents);
  }

  /**
   * Schließt den aktuellen Schritt ab und rückt zum nächsten vor.
   * Liefert true, wenn damit alle Reparaturen des Auftrags fertig sind.
   */
  static advanceStep(
    ctx: SimContext,
    order: RepairOrder,
    worker: Worker,
  ): boolean {
    const job = RepairSystem.currentJob(order);
    if (!job) return true;
    const def = repairDef(ctx, job.repairId);
    job.stepIndex += 1;
    if (job.stepIndex >= def.steps.length) {
      job.done = true;
      const next = RepairSystem.currentJob(order);
      if (!next) return true;
      const nextDef = repairDef(ctx, next.repairId);
      const step = nextDef.steps[next.stepIndex];
      if (!step) throw new Error('Schritt fehlt');
      next.stepRemainingMinutes =
        step.durationMinutes *
        RepairSystem.durationFactor(worker.skills[nextDef.requiredSkill]);
      return false;
    }
    const step = def.steps[job.stepIndex];
    if (!step) throw new Error('Schritt fehlt');
    job.stepRemainingMinutes =
      step.durationMinutes *
      RepairSystem.durationFactor(worker.skills[def.requiredSkill]);
    return false;
  }
}
