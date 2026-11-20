import type {
  DailyStats,
  DailySummary,
  EconomyState,
  GameState,
  PartNeed,
  Transaction,
} from '../entities/types';
import {
  RENT_CENTS_PER_DAY,
  UTILITIES_CENTS_PER_DAY,
} from '../entities/types';

import { partDef, type SimContext } from './context';

const MAX_TRANSACTIONS = 400;
const MARKETING_COST_CENTS = [0, 5000, 15000, 30000];
const MAX_DAILY = 90;

/**
 * Alle Geldbewegungen laufen ausschließlich über book().
 * Beträge sind ganzzahlige Cent; doppelte IDs werden abgewiesen.
 */
export class EconomySystem {
  static surchargeCents(baseCents: number, surchargePct: number): number {
    return Math.round(baseCents * surchargePct / 100);
  }

  static discountedCents(grossCents: number, discountPct: number): number {
    return Math.round(grossCents * (100 - discountPct) / 100);
  }

  static book(eco: EconomyState, tx: Transaction): boolean {
    if (!Number.isInteger(tx.amountCents)) {
      throw new Error(`Buchung ${tx.id}: Betrag muss ganzzahlige Cent sein`);
    }
    if (eco.bookedIds.includes(tx.id)) return false;
    eco.bookedIds.push(tx.id);
    eco.balanceCents += tx.amountCents;
    eco.transactions.push(tx);
    if (eco.transactions.length > MAX_TRANSACTIONS) {
      eco.transactions.splice(0, eco.transactions.length - MAX_TRANSACTIONS);
    }
    if (eco.bookedIds.length > MAX_TRANSACTIONS * 2) {
      eco.bookedIds.splice(0, eco.bookedIds.length - MAX_TRANSACTIONS * 2);
    }
    const day = EconomySystem.dailyFor(eco, tx.day);
    if (tx.amountCents > 0) {
      if (tx.category === 'revenue') day.revenueCents += tx.amountCents;
    } else {
      const cost = -tx.amountCents;
      switch (tx.category) {
        case 'parts_purchase':
          day.partsCostCents += cost;
          break;
        case 'salary':
          day.salaryCents += cost;
          break;
        case 'fixed_costs':
          day.fixedCostCents += cost;
          break;
        case 'investment':
          day.investmentCents += cost;
          break;
        default:
          break;
      }
    }
    return true;
  }

  static dailyFor(eco: EconomyState, day: number): DailyStats {
    let d = eco.daily.find((x) => x.day === day);
    if (!d) {
      d = {
        day,
        revenueCents: 0,
        partsCostCents: 0,
        partsUsedCents: 0,
        salaryCents: 0,
        fixedCostCents: 0,
        investmentCents: 0,
        ordersCompleted: 0,
        balanceEndCents: eco.balanceCents,
      };
      eco.daily.push(d);
      if (eco.daily.length > MAX_DAILY) {
        eco.daily.splice(0, eco.daily.length - MAX_DAILY);
      }
    }
    return d;
  }

  static sellPrice(buyCents: number, markupPct: number): number {
    return Math.round(buyCents * (1 + markupPct / 100));
  }

  /** Aktueller Markteinkaufspreis (Basispreis × Marktfaktor). */
  static marketBuyCents(state: GameState, part: { id: string; buyCents: number }): number {
    return Math.round(part.buyCents * (state.marketPriceFactors[part.id] ?? 1));
  }

  /** Materialentnahme ist Verbrauch, keine zweite Zahlung. */
  static recordPartsUsage(ctx: SimContext, needs: PartNeed[]): void {
    const { state } = ctx;
    const day = EconomySystem.dailyFor(state.economy, Math.floor(state.totalMinutes / 1440) + 1);
    // Eine alte, bereits angebrochene Tageszeile wäre unvollständig.
    if (day.partsUsedCents === undefined) return;
    day.partsUsedCents += needs.reduce((sum, n) =>
      sum + EconomySystem.marketBuyCents(state, partDef(ctx, n.partId)) * n.quantity, 0);
  }

  static operatingResult(d: DailyStats): number | null {
    return d.partsUsedCents === undefined ? null :
      d.revenueCents - d.partsUsedCents - d.salaryCents - d.fixedCostCents;
  }

  /** Tagesabschluss: Gehälter + Fixkosten, Statistik. */
  static closeDay(state: GameState, day: number): void {
    const eco = state.economy;
    for (const w of state.workers) {
      EconomySystem.book(eco, {
        id: `salary-${w.id}-d${day}`,
        day,
        atMinute: state.totalMinutes,
        amountCents: -w.salaryCentsPerDay,
        category: 'salary',
        label: `Gehalt ${w.name}`,
      });
      state.statistics.totalSalaryCents += w.salaryCentsPerDay;
    }
    const fixed = RENT_CENTS_PER_DAY + UTILITIES_CENTS_PER_DAY;
    EconomySystem.book(eco, {
      id: `fixed-d${day}`,
      day,
      atMinute: state.totalMinutes,
      amountCents: -fixed,
      category: 'fixed_costs',
      label: 'Miete & Betriebskosten',
    });
    state.statistics.totalFixedCostCents += fixed;
    // Kreditzinsen (Basispunkte pro Tag auf die Restschuld)
    for (const loan of state.loans) {
      const interest = Math.ceil((loan.remainingCents * loan.interestBpPerDay) / 10000);
      if (interest > 0) {
        EconomySystem.book(eco, {
          id: `loan-interest-${loan.id}-d${day}`,
          day,
          atMinute: state.totalMinutes,
          amountCents: -interest,
          category: 'other',
          label: `Kreditzinsen (${(loan.remainingCents / 100).toFixed(0)} € Restschuld)`,
        });
      }
    }
    const marketing = MARKETING_COST_CENTS[state.marketingLevel] ?? 0;
    if (marketing > 0) {
      EconomySystem.book(eco, {
        id: `marketing-d${day}`, day, atMinute: state.totalMinutes,
        amountCents: -marketing, category: 'fixed_costs',
        label: `Marketing (Level ${state.marketingLevel})`,
      });
    }
    const d = EconomySystem.dailyFor(eco, day);
    d.balanceEndCents = eco.balanceCents;
  }

  /** Tagesabschluss-Zusammenfassung für das Modal (vor dailyReview aufrufen). */
  static buildDailySummary(state: GameState, day: number): DailySummary {
    const d = EconomySystem.dailyFor(state.economy, day);
    const profit = EconomySystem.operatingResult(d) ?? (d.revenueCents - d.partsCostCents - d.salaryCents - d.fixedCostCents);
    let best: { name: string; min: number } | null = null;
    for (const w of state.workers) {
      if (!best || w.dailyWorkedMinutes > best.min) best = { name: w.name, min: w.dailyWorkedMinutes };
    }
    const delivered = state.orders.filter((o) => o.status === 'delivered' && o.satisfaction !== null);
    const avg = delivered.length > 0
      ? Math.round(delivered.reduce((a, o) => a + (o.satisfaction ?? 0), 0) / delivered.length)
      : null;
    const feedback = profit > 30000
      ? 'Starker Tag – die Werkstatt wirft Gewinn ab.'
      : profit > 0
        ? 'Solider Tag mit kleinem Plus.'
        : profit > -20000
          ? 'Knapp gehalten – Kosten im Blick behalten.'
          : 'Verlusttag – Auslastung oder Preise prüfen.';
    return {
      day,
      revenueCents: d.revenueCents,
      profitCents: profit,
      ordersCompleted: d.ordersCompleted,
      bestWorkerName: best && best.min > 0 ? best.name : null,
      avgSatisfaction: avg,
      feedback,
    };
  }

  /** Lagerwert zum Markteinkaufspreis (Bestand × EK). */
  static inventoryValueCents(state: GameState, parts: { id: string; buyCents: number }[]): number {
    let sum = 0;
    for (const p of parts) {
      const qty = state.inventory.stock[p.id] ?? 0;
      if (qty > 0) sum += EconomySystem.marketBuyCents(state, p) * qty;
    }
    return sum;
  }

  /** Einfache Bilanz: Umlaufvermögen (Kasse + Lager) vs. Schulden → Eigenkapital. */
  static balanceSheet(state: GameState, parts: { id: string; buyCents: number }[]): {
    cash: number; inventoryValue: number; assets: number; debt: number; equity: number;
  } {
    const cash = state.economy.balanceCents;
    const inventoryValue = EconomySystem.inventoryValueCents(state, parts);
    const debt = state.loans.reduce((a, l) => a + l.remainingCents, 0);
    const assets = cash + inventoryValue;
    return { cash, inventoryValue, assets, debt, equity: assets - debt };
  }

  static operatingResultToday(state: GameState): number | null {
    const d = state.economy.daily.find(
      (x) => x.day === Math.floor(state.totalMinutes / 1440) + 1,
    );
    if (!d) return 0;
    return EconomySystem.operatingResult(d);
  }
}
