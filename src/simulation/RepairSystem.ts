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

  /** Tatsächliche Arbeitsrate inkl. Motivation (0.9–1.1).
   *  Hoeherer Skill = schneller: Rate ist der Kehrwert des Zeitfaktors. */
  static workRate(skill: number, motivation: number): number {
    return (1 / RepairSystem.durationFactor(skill)) * (0.9 + motivation / 500);
  }

  static canWorkerDo(worker: Worker, def: RepairDef): boolean {
    return worker.skills[def.requiredSkill] >= def.minimumSkillLevel;
  }

  static toolsAvailable(ctx: SimContext, def: RepairDef): boolean {
    return (def.requiredTools ?? []).every((t) => ctx.state.ownedTools.includes(t));
  }

  static missingTools(ctx: SimContext, def: RepairDef): string[] {
    return (def.requiredTools ?? []).filter((t) => !ctx.state.ownedTools.includes(t));
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
      sum += EconomySystem.sellPrice(EconomySystem.marketBuyCents(ctx.state, p), ctx.state.economy.partsMarkupPct) * n.quantity;
    }
    return sum;
  }

  static laborEstimateCents(ctx: SimContext, order: RepairOrder): number {
    const minutes = order.jobs.reduce((sum, j) => {
      const def = repairDef(ctx, j.repairId);
      return sum + def.baseDurationMinutes * (def.requiredWorkers ?? 1);
    }, 0);
    return Math.round((minutes / 60) * ctx.state.economy.hourlyRateCents);
  }

  /**
   * Schließt den aktuellen Schritt ab und rückt zum nächsten vor.
   * Schrittzeiten werden in Basisminuten geführt (Faktor pro Mitarbeiter).
   * Liefert true, wenn damit alle Reparaturen des Auftrags fertig sind.
   */
  static advanceStep(
    ctx: SimContext,
    order: RepairOrder,
    _worker: Worker,
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
      next.stepRemainingMinutes = step.durationMinutes;
      return false;
    }
    const step = def.steps[job.stepIndex];
    if (!step) throw new Error('Schritt fehlt');
    job.stepRemainingMinutes = step.durationMinutes;
    return false;
  }
}
