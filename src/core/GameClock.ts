import { MINUTES_PER_DAY } from '../entities/types';

/** Zentrale Spieluhr. Tag 1 beginnt bei totalMinutes = 0 (00:00). */
export class GameClock {
  totalMinutes: number;

  constructor(totalMinutes = 0) {
    this.totalMinutes = totalMinutes;
  }

  get day(): number {
    return Math.floor(this.totalMinutes / MINUTES_PER_DAY) + 1;
  }

  get minuteOfDay(): number {
    return this.totalMinutes % MINUTES_PER_DAY;
  }

  get hourOfDay(): number {
    return Math.floor(this.minuteOfDay / 60);
  }

  /** Rückt die Uhr vor und liefert die Nummern der neu begonnenen Tage. */
  advance(minutes: number): number[] {
    const before = this.day;
    this.totalMinutes += minutes;
    const after = this.day;
    const days: number[] = [];
    for (let d = before + 1; d <= after; d++) days.push(d);
    return days;
  }

  formatTime(): string {
    const m = Math.floor(this.minuteOfDay);
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}
