import type { SimContext } from './context';
import { notify } from './context';
import { MarketSystem } from './MarketSystem';

const SCAN_INTERVAL_MINUTES = 60;
const CHEAP_FACTOR = 0.9;
const ALERT_COOLDOWN_MINUTES = 1440;
const MAX_ALERTS_PER_SCAN = 2;

/** Assistent (max. 1): beobachtet die Marktpreise und meldet Schnäppchen
 *  für relevante Varianten (Bestand, Mindestbestand oder Pin). */
export class AssistantSystem {
  static update(ctx: SimContext): void {
    const { state } = ctx;
    const assistant = state.workers.find((w) => w.role === 'assistant');
    if (!assistant) return;
    if ((assistant.sickUntilMinute ?? 0) > state.totalMinutes) return;
    const m = state.totalMinutes % 1440;
    if (m < assistant.shiftStartMinute || m >= assistant.shiftEndMinute) return;
    if (state.totalMinutes < state.assistantNextScanAtMinute) return;
    state.assistantNextScanAtMinute = state.totalMinutes + SCAN_INTERVAL_MINUTES;

    const inv = state.inventory;
    const cheap = ctx.defs.parts
      .map((p) => ({ p, f: state.marketPriceFactors[p.id] ?? 1 }))
      .filter(
        ({ p, f }) =>
          f <= CHEAP_FACTOR &&
          ((inv.stock[p.id] ?? 0) > 0 ||
            (inv.minStock[p.id] ?? 0) > 0 ||
            inv.pinned[p.id] === true) &&
          (state.assistantAlertedAt[p.id] ?? -ALERT_COOLDOWN_MINUTES) +
            ALERT_COOLDOWN_MINUTES <=
            state.totalMinutes,
      )
      .sort((a, b) => a.f - b.f)
      .slice(0, MAX_ALERTS_PER_SCAN);

    for (const { p, f } of cheap) {
      state.assistantAlertedAt[p.id] = state.totalMinutes;
      const buy = MarketSystem.buyCents(ctx, p);
      const pct = Math.round((1 - f) * 100);
      notify(
        ctx,
        'info',
        `📉 Assistent ${assistant.name}: ${p.name} gerade ${pct} % unter Normalpreis (${(buy / 100).toFixed(2)} € statt ${(p.buyCents / 100).toFixed(2)} €) – jetzt bestellen lohnt sich.`,
      );
    }
  }
}
