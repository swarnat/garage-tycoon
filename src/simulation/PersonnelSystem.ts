import type { Candidate, SkillId } from '../entities/types';
import type { SimContext } from './context';
import { notify } from './context';
import { EconomySystem } from './EconomySystem';

const FIRST_NAMES = [
  'Lena', 'Murat', 'Sven', 'Aylin', 'Dennis', 'Miriam', 'Tobias', 'Elif',
  'Kai', 'Sonja', 'Ralf', 'Ines', 'Oleg', 'Tanja', 'Felix', 'Nadine',
];
const LAST_NAMES = [
  'Schneider', 'Yilmaz', 'Brandt', 'Kowalski', 'Fuchs', 'Alvarez', 'Lindner',
  'Demir', 'Hartmann', 'Novak', 'Siebert', 'Krause', 'Weiss', 'Bauer',
];

const SKILLS: SkillId[] = [
  'engine', 'electrical', 'suspension', 'brakes', 'transmission', 'diagnosis',
];

export const SKILL_LABELS: Record<SkillId, string> = {
  engine: 'Motor',
  electrical: 'Elektrik',
  suspension: 'Fahrwerk',
  brakes: 'Bremsen',
  transmission: 'Getriebe',
  diagnosis: 'Diagnose',
};

export const MAX_WORKERS = 6;
export const TRAINING_COST_CENTS = 15000;
export const TRAINING_MINUTES = 120;
export const TRAINING_AMOUNT = 5;

/** Personal: Kandidaten, Einstellung, Entlassung, Weiterbildung. */
export class PersonnelSystem {
  static generateCandidates(ctx: SimContext, count = 3): Candidate[] {
    const out: Candidate[] = [];
    for (let i = 0; i < count; i++) {
      const skills = {} as Record<SkillId, number>;
      for (const sk of SKILLS) skills[sk] = ctx.rng.intRange(15, 60);
      const specialty = ctx.rng.pick(SKILLS);
      skills[specialty] = Math.min(90, skills[specialty] + ctx.rng.intRange(15, 30));
      const avg = SKILLS.reduce((a, sk) => a + skills[sk], 0) / SKILLS.length;
      const salary = 10000 + Math.round(avg * 130);
      out.push({
        id: `cand${ctx.state.nextId++}`,
        name: `${ctx.rng.pick(FIRST_NAMES)} ${ctx.rng.pick(LAST_NAMES)}`,
        skills,
        salaryCentsPerDay: salary,
        hiringFeeCents: salary * 2,
      });
    }
    return out;
  }

  /** Kandidatenpool erneuert sich täglich. */
  static update(ctx: SimContext): void {
    const day = Math.floor(ctx.state.totalMinutes / 1440) + 1;
    if (day !== ctx.state.lastCandidateRefreshDay) {
      ctx.state.lastCandidateRefreshDay = day;
      ctx.state.candidates = PersonnelSystem.generateCandidates(ctx);
    }
  }

  static hire(ctx: SimContext, candidateId: string): boolean {
    const { state } = ctx;
    if (state.workers.length >= MAX_WORKERS) {
      notify(ctx, 'warning', `Maximal ${MAX_WORKERS} Mitarbeiter – die Werkstatt ist voll.`);
      return false;
    }
    const idx = state.candidates.findIndex((c) => c.id === candidateId);
    if (idx < 0) return false;
    const cand = state.candidates[idx] as Candidate;
    if (state.economy.balanceCents < cand.hiringFeeCents) {
      notify(ctx, 'danger', `Einstellung ${cand.name}: Gebühr ${(cand.hiringFeeCents / 100).toFixed(2)} € nicht verfügbar.`);
      return false;
    }
    EconomySystem.book(state.economy, {
      id: `hire-${cand.id}`,
      day: Math.floor(state.totalMinutes / 1440) + 1,
      atMinute: state.totalMinutes,
      amountCents: -cand.hiringFeeCents,
      category: 'salary',
      label: `Einstellungsgebühr ${cand.name}`,
    });
    state.workers.push({
      id: `w${state.nextId++}`,
      name: cand.name,
      salaryCentsPerDay: cand.salaryCentsPerDay,
      skills: { ...cand.skills },
      experience: 0,
      state: 'idle',
      pos: { x: 3, y: 4 },
      path: [],
      task: null,
      shiftStartMinute: 480,
      shiftEndMinute: 1080,
      speedTilesPerMinute: 0.35,
      workedMinutes: 0,
      onDutyMinutes: 0,
      trainingMinutes: 0,
      pendingTraining: null,
    });
    state.candidates.splice(idx, 1);
    notify(ctx, 'success', `${cand.name} eingestellt (${(cand.salaryCentsPerDay / 100).toFixed(2)} €/Tag).`);
    return true;
  }

  static fire(ctx: SimContext, workerId: string): boolean {
    const { state } = ctx;
    if (state.workers.length <= 1) {
      notify(ctx, 'warning', 'Mindestens ein Mitarbeiter muss bleiben.');
      return false;
    }
    const idx = state.workers.findIndex((w) => w.id === workerId);
    if (idx < 0) return false;
    const w = state.workers[idx] as (typeof state.workers)[number];
    // Laufende Aufgabe sauber an den Pool zurückgeben
    if (w.task) {
      const order = state.orders.find((o) => o.id === w.task!.orderId);
      if (order) order.assignedWorkerId = null;
    }
    const day = Math.floor(state.totalMinutes / 1440) + 1;
    EconomySystem.book(state.economy, {
      id: `severance-${w.id}-d${day}`,
      day,
      atMinute: state.totalMinutes,
      amountCents: -w.salaryCentsPerDay,
      category: 'salary',
      label: `Abfindung ${w.name}`,
    });
    state.workers.splice(idx, 1);
    notify(ctx, 'warning', `${w.name} entlassen (Abfindung: ${(w.salaryCentsPerDay / 100).toFixed(2)} €).`);
    return true;
  }

  static train(ctx: SimContext, workerId: string, skill: SkillId): boolean {
    const { state } = ctx;
    const w = state.workers.find((x) => x.id === workerId);
    if (!w || w.task || w.trainingMinutes > 0) {
      notify(ctx, 'warning', 'Weiterbildung nur möglich, wenn der Mitarbeiter gerade frei ist.');
      return false;
    }
    if (w.skills[skill] >= 100) return false;
    if (state.economy.balanceCents < TRAINING_COST_CENTS) {
      notify(ctx, 'danger', 'Weiterbildung: Kontostand reicht nicht (150 €).');
      return false;
    }
    EconomySystem.book(state.economy, {
      id: `train-${w.id}-${skill}-${state.nextId++}`,
      day: Math.floor(state.totalMinutes / 1440) + 1,
      atMinute: state.totalMinutes,
      amountCents: -TRAINING_COST_CENTS,
      category: 'salary',
      label: `Weiterbildung ${w.name} (${SKILL_LABELS[skill]})`,
    });
    w.trainingMinutes = TRAINING_MINUTES;
    w.pendingTraining = { skill, amount: TRAINING_AMOUNT };
    notify(ctx, 'info', `${w.name} bildet sich weiter: ${SKILL_LABELS[skill]} +${TRAINING_AMOUNT} (2 h).`);
    return true;
  }
}
