import type {
  DailyStats,
  EconomyState,
  GameState,
  Transaction,
} from '../entities/types';
import {
  RENT_CENTS_PER_DAY,
  UTILITIES_CENTS_PER_DAY,
} from '../entities/types';

const MAX_TRANSACTIONS = 400;
const MAX_DAILY = 90;

/**
 * Alle Geldbewegungen laufen ausschließlich über book().
 * Beträge sind ganzzahlige Cent; doppelte IDs werden abgewiesen.
 */
export class EconomySystem {
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
    const d = EconomySystem.dailyFor(eco, day);
    d.balanceEndCents = eco.balanceCents;
  }

  static operatingResultToday(state: GameState): number {
    const d = state.economy.daily.find(
      (x) => x.day === Math.floor(state.totalMinutes / 1440) + 1,
    );
    if (!d) return 0;
    return (
      d.revenueCents - d.partsCostCents - d.salaryCents - d.fixedCostCents
    );
  }
}
