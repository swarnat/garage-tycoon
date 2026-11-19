import type { EventChoice, GameEvent } from '../entities/types';
import type { SimContext } from './context';
import { notify } from './context';
import { EconomySystem } from './EconomySystem';
import { CustomerSystem } from './CustomerSystem';
import { WorkerSystem } from './WorkerSystem';

const EVENT_CHANCE = 0.12;
const EVENT_LIFETIME_MINUTES = 240;
const MAX_EVENTS_PER_DAY = 2;

interface EventDef {
  id: string;
  title: string;
  weight: number;
  defaultChoiceId: string;
  choices: EventChoice[];
}

const DEFS: EventDef[] = [
  {
    id: 'lift_breakdown', title: 'Hebebühne ausgefallen', weight: 3, defaultChoiceId: 'crew',
    choices: [
      { id: 'express', label: 'Express-Techniker (250 €)', detail: 'Sofort wieder einsatzbereit.', costCents: 25000, effects: [{ type: 'fixStation', delayMinutes: 0 }] },
      { id: 'crew', label: 'Eigene Crew reparieren (kostenlos)', detail: 'Bühne fällt ca. 2 h aus.', effects: [{ type: 'fixStation', delayMinutes: 120 }] },
    ],
  },
  {
    id: 'worker_sick', title: 'Mitarbeiter krank', weight: 3, defaultChoiceId: 'rest',
    choices: [
      { id: 'rest', label: 'Auskurieren lassen', detail: 'Fällt 8 h aus, Gehalt läuft weiter. Team-Moral +3.', effects: [{ type: 'sick', hours: 8 }, { type: 'motivationAll', delta: 3 }] },
      { id: 'halfday', label: 'Halbtags kommen lassen', detail: 'Nur 4 h Ausfall, aber Moral −6.', effects: [{ type: 'sick', hours: 4 }, { type: 'motivationAll', delta: -6 }] },
    ],
  },
  {
    id: 'supplier_delay', title: 'Lieferverzug', weight: 3, defaultChoiceId: 'wait',
    choices: [
      { id: 'express', label: 'Express-Umleitung (60 €)', detail: 'Ursprüngliche Lieferzeit wird gehalten.', costCents: 6000, effects: [{ type: 'deliveryExpress' }] },
      { id: 'wait', label: 'Abwarten (+4 h)', detail: 'Lieferung kommt später, keine Kosten.', effects: [] },
    ],
  },
  {
    id: 'inspection', title: 'Werkstatt-Inspektion', weight: 2, defaultChoiceId: 'ignore',
    choices: [
      { id: 'prepare', label: 'Gründlich vorbereiten (150 €)', detail: 'Reputation +6.', costCents: 15000, effects: [{ type: 'reputation', delta: 6 }] },
      { id: 'bribe', label: 'Bestechen (80 €)', detail: 'Riskant: 60 % Reputation +2, 40 % −12 + 200 € Bußgeld.', costCents: 8000, effects: [{ type: 'bribe' }] },
      { id: 'ignore', label: 'Ignorieren', detail: 'Reputation −8 und 100 € Bußgeld.', effects: [{ type: 'reputation', delta: -8 }, { type: 'fine', cents: 10000 }] },
    ],
  },
  {
    id: 'angry_customer', title: 'Öffentliche Beschwerde', weight: 2, defaultChoiceId: 'dismiss',
    choices: [
      { id: 'goodwill', label: 'Kulanz: 20 % erstatten', detail: 'Reputation +5, Kunde zufriedener.', effects: [{ type: 'refund', pct: 20 }, { type: 'reputation', delta: 5 }, { type: 'satisfaction', delta: 20 }] },
      { id: 'dismiss', label: 'Abwimmeln', detail: 'Reputation −7, Kunde verärgert.', effects: [{ type: 'reputation', delta: -7 }, { type: 'satisfaction', delta: -15 }] },
    ],
  },
  {
    id: 'fleet_offer', title: 'Großauftrag angeboten', weight: 1, defaultChoiceId: 'decline',
    choices: [
      { id: 'accept', label: 'Annehmen (3 Aufträge)', detail: 'Drei Fahrzeuge auf einen Schlag, gute Budgets.', effects: [{ type: 'spawnOrders', count: 3, budgetFactor: 1.3 }] },
      { id: 'decline', label: 'Ablehnen', detail: 'Kapazität schonen, kein Risiko.', effects: [] },
    ],
  },
];

/** Zufällige Ereignisse mit Entscheidungen – durchbricht die Zuschauer-Phase. */
export class EventSystem {
  static update(ctx: SimContext): void {
    const { state } = ctx;
    const day = Math.floor(state.totalMinutes / 1440) + 1;
    if (day !== state.lastEventDay) {
      state.lastEventDay = day;
      state.eventsToday = 0;
    }
    if (state.activeEvent) {
      if (state.totalMinutes >= state.activeEvent.expiresAtMinute) {
        EventSystem.choose(ctx, state.activeEvent.defaultChoiceId, true);
      }
      return;
    }
    const m = state.totalMinutes % 1440;
    if (m < 480 || m >= 1080) return;
    if (state.eventsToday >= MAX_EVENTS_PER_DAY) return;
    if (state.totalMinutes < state.nextEventCheckAtMinute) return;
    state.nextEventCheckAtMinute = state.totalMinutes + 60;
    if (!ctx.rng.chance(EVENT_CHANCE)) return;
    const eligible = DEFS.filter((d) => EventSystem.canSpawn(ctx, d.id));
    if (eligible.length === 0) return;
    const def = ctx.rng.weighted(eligible, eligible.map((d) => d.weight));
    EventSystem.spawn(ctx, def.id);
  }

  private static canSpawn(ctx: SimContext, defId: string): boolean {
    const { state } = ctx;
    switch (defId) {
      case 'lift_breakdown':
        return state.stations.some((s) => s.kind === 'lift' && s.unlocked && s.orderId === null && (s.brokenUntilMinute ?? 0) <= state.totalMinutes);
      case 'worker_sick':
        return state.workers.some((w) => (w.sickUntilMinute ?? 0) <= state.totalMinutes);
      case 'supplier_delay':
        return state.deliveries.some((d) => !d.done && d.arriveAtMinute > state.totalMinutes);
      case 'angry_customer':
        return state.orders.some((o) => o.status === 'delivered' && o.satisfaction !== null && o.satisfaction < 70);
      default:
        return true;
    }
  }

  /** Erzeugt ein konkretes Ereignis (mit aufgelösten Zielen). Public für Tests. */
  static spawn(ctx: SimContext, defId: string): GameEvent | null {
    const { state } = ctx;
    if (state.activeEvent || state.eventsToday >= MAX_EVENTS_PER_DAY) return null;
    const def = DEFS.find((d) => d.id === defId);
    if (!def || !EventSystem.canSpawn(ctx, defId)) return null;
    const ev: GameEvent = {
      id: `ev${state.nextId++}`,
      defId,
      title: def.title,
      text: '',
      choices: def.choices,
      defaultChoiceId: def.defaultChoiceId,
      createdAtMinute: state.totalMinutes,
      expiresAtMinute: state.totalMinutes + EVENT_LIFETIME_MINUTES,
    };
    switch (defId) {
      case 'lift_breakdown': {
        const pool = state.stations.filter((s) => s.kind === 'lift' && s.unlocked && s.orderId === null && (s.brokenUntilMinute ?? 0) <= state.totalMinutes);
        const st = ctx.rng.pick(pool);
        st.brokenUntilMinute = state.totalMinutes + 1440;
        ev.targetStationId = st.id;
        ev.text = `Hebebühne ${st.id.replace('lift', '')} meldet einen Hydraulikschaden und ist ausgefallen. Wie soll sie repariert werden?`;
        break;
      }
      case 'worker_sick': {
        const pool = state.workers.filter((w) => (w.sickUntilMinute ?? 0) <= state.totalMinutes);
        const w = ctx.rng.pick(pool);
        ev.targetWorkerId = w.id;
        ev.text = `${w.name} meldet sich krank und kann heute nicht arbeiten. Wie gehst du damit um?`;
        break;
      }
      case 'supplier_delay': {
        const pool = state.deliveries.filter((d) => !d.done && d.arriveAtMinute > state.totalMinutes);
        const d = ctx.rng.pick(pool);
        ev.targetDeliveryId = d.id;
        ev.targetDeliveryEta = d.arriveAtMinute;
        d.arriveAtMinute += 240;
        const part = ctx.defs.parts.find((p) => p.id === d.partId);
        ev.text = `Der Lieferant meldet eine Verzögerung für ${part?.name ?? d.partId} (+4 h). Express-Umleitung möglich.`;
        break;
      }
      case 'angry_customer': {
        const pool = state.orders.filter((o) => o.status === 'delivered' && o.satisfaction !== null && o.satisfaction < 70);
        const o = ctx.rng.pick(pool);
        ev.targetOrderId = o.id;
        const c = state.customers.find((x) => x.id === o.customerId);
        const v = state.vehicles.find((x) => x.id === o.vehicleId);
        ev.text = `${c?.name ?? 'Ein Kunde'} beschwert sich öffentlich über die Reparatur am ${v?.make ?? ''} ${v?.model ?? ''}. Wie reagierst du?`;
        break;
      }
      case 'inspection':
        ev.text = 'Das Gewerbeamt kündigt eine Werkstatt-Inspektion an. Vorbereitung, Bestechung oder ignorieren?';
        break;
      case 'fleet_offer':
        ev.text = 'Ein Autohaus bietet einen Großauftrag: 3 Fahrzeuge auf einen Schlag, mit guten Budgets. Annehmen?';
        break;
    }
    state.activeEvent = ev;
    state.eventsToday += 1;
    ctx.bus.emit('event:created', ev.id);
    notify(ctx, 'warning', `⚡ Ereignis: ${ev.title} – Entscheidung nötig.`);
    if (state.speed !== 0 && state.speed !== 1) state.speed = 1;
    return ev;
  }

  /** Wendet eine Entscheidung an (auch automatisch bei Ablauf). */
  static choose(ctx: SimContext, choiceId: string, auto = false): void {
    const { state } = ctx;
    const ev = state.activeEvent;
    if (!ev) return;
    const choice = ev.choices.find((c) => c.id === choiceId) ?? ev.choices.find((c) => c.id === ev.defaultChoiceId)!;
    const day = Math.floor(state.totalMinutes / 1440) + 1;
    if (choice.costCents) {
      EconomySystem.book(state.economy, {
        id: `event-${ev.id}-${choice.id}`, day, atMinute: state.totalMinutes,
        amountCents: -choice.costCents, category: 'other', label: `${ev.title}: ${choice.label}`,
      });
    }
    for (const eff of choice.effects) EventSystem.apply(ctx, ev, eff, day);
    state.eventLog.push({ defId: ev.defId, title: ev.title, chosenId: choice.id, atMinute: state.totalMinutes });
    if (state.eventLog.length > 60) state.eventLog.splice(0, state.eventLog.length - 60);
    state.activeEvent = null;
    ctx.bus.emit('event:resolved', ev.id);
    notify(ctx, 'info', `${auto ? 'Ereignis abgelaufen – automatisch: ' : 'Ereignis entschieden: '}${ev.title} → ${choice.label}`);
  }

  private static apply(ctx: SimContext, ev: GameEvent, eff: import('../entities/types').EventEffect, day: number): void {
    const { state } = ctx;
    const clampRep = (): void => { state.reputation = Math.max(0, Math.min(100, state.reputation)); };
    switch (eff.type) {
      case 'reputation':
        state.reputation += eff.delta; clampRep(); break;
      case 'motivationAll':
        for (const w of state.workers) w.motivation = Math.max(0, Math.min(100, w.motivation + eff.delta));
        break;
      case 'fixStation': {
        const st = state.stations.find((s) => s.id === ev.targetStationId);
        if (st) st.brokenUntilMinute = state.totalMinutes + eff.delayMinutes;
        break;
      }
      case 'sick': {
        const worker = state.workers.find((w) => w.id === ev.targetWorkerId);
        if (worker) {
          worker.sickUntilMinute = state.totalMinutes + eff.hours * 60;
          if (worker.task) {
            const order = state.orders.find((o) => o.id === worker.task!.orderId);
            if (order) WorkerSystem.releaseSpecific(ctx, order, worker);
          }
        }
        break;
      }
      case 'deliveryExpress': {
        const d = state.deliveries.find((x) => x.id === ev.targetDeliveryId);
        if (d && ev.targetDeliveryEta !== undefined) d.arriveAtMinute = ev.targetDeliveryEta;
        break;
      }
      case 'spawnOrders':
        for (let i = 0; i < eff.count; i++) {
          const o = CustomerSystem.generateOffer(ctx);
          o.budgetCents = Math.round(o.budgetCents * eff.budgetFactor);
        }
        break;
      case 'refund': {
        const o = state.orders.find((x) => x.id === ev.targetOrderId);
        if (o && o.invoiceCents) {
          const amount = Math.round(o.invoiceCents * eff.pct / 100);
          EconomySystem.book(state.economy, {
            id: `event-refund-${ev.id}`, day, atMinute: state.totalMinutes,
            amountCents: -amount, category: 'other', label: `Kulanz-Erstattung (${ev.title})`,
          });
        }
        break;
      }
      case 'satisfaction': {
        const o = state.orders.find((x) => x.id === ev.targetOrderId);
        if (o && o.satisfaction !== null) o.satisfaction = Math.max(0, Math.min(100, o.satisfaction + eff.delta));
        break;
      }
      case 'bribe':
        if (ctx.rng.chance(0.6)) {
          state.reputation += 2; clampRep();
          notify(ctx, 'info', 'Die Bestechung bleibt unbemerkt – Reputation +2.');
        } else {
          state.reputation -= 12; clampRep();
          EconomySystem.book(state.economy, {
            id: `event-bribe-fine-${ev.id}`, day, atMinute: state.totalMinutes,
            amountCents: -20000, category: 'other', label: 'Bußgeld (Bestechung aufgeflogen)',
          });
          notify(ctx, 'danger', 'Bestechung aufgeflogen! Reputation −12 und 200 € Bußgeld.');
        }
        break;
      case 'fine':
        EconomySystem.book(state.economy, {
          id: `event-fine-${ev.id}`, day, atMinute: state.totalMinutes,
          amountCents: -eff.cents, category: 'other', label: `Bußgeld (${ev.title})`,
        });
        break;
    }
  }
}
