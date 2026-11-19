/** Dezente WebAudio-Sounds (offline, keine Assets). Optional, per Toggle. */
export class SoundSystem {
  private ctx: AudioContext | null = null;
  enabled = true;

  resume(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* Audio nicht verfügbar – still ignorieren */
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.06, when = 0): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {
      /* ignore */
    }
  }

  invoice(): void { this.tone(880, 0.09); this.tone(1320, 0.14, 'sine', 0.06, 0.09); }
  event(): void { this.tone(440, 0.1, 'square', 0.05); this.tone(330, 0.14, 'square', 0.05, 0.11); }
  order(): void { this.tone(660, 0.07, 'triangle', 0.05); }
  click(): void { this.tone(520, 0.04, 'triangle', 0.03); }
}
