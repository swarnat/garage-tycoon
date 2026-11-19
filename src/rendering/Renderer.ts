import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from 'pixi.js';
import type { Game } from '../core/Game';
import type { Station, Vehicle, Worker } from '../entities/types';
import { DIAGNOSIS_BASE_MINUTES, QC_BASE_MINUTES } from '../entities/types';
import carSvg from '../assets/sprites/car.svg?raw';
import mechanicSvg from '../assets/sprites/mechanic.svg?raw';
import mechanicGreenSvg from '../assets/sprites/mechanic_green.svg?raw';
import liftSvg from '../assets/sprites/lift.svg?raw';
import diagnosisSvg from '../assets/sprites/diagnosis.svg?raw';
import storageSvg from '../assets/sprites/storage.svg?raw';
import receptionSvg from '../assets/sprites/reception.svg?raw';
import parkingSvg from '../assets/sprites/parking.svg?raw';
import vendingSvg from '../assets/sprites/vending.svg?raw';

/** Rasterisiert ein SVG bei hoher Auflösung in eine Pixi-Textur. */
async function svgTexture(svg: string, scale = 3): Promise<Texture> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG konnte nicht geladen werden'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D-Kontext nicht verfügbar');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return Texture.from(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const TILE = 36;

export interface Selection {
  kind: 'vehicle' | 'worker';
  id: string;
}

const STATE_COLORS: Record<string, number> = {
  idle: 0x7d8aa0,
  moving: 0x5aa2ff,
  diagnosing: 0x4fc3f7,
  repairing: 0xf5a623,
  fetching_parts: 0xc98a4b,
  quality_check: 0x9ccc65,
  waiting: 0x7d8aa0,
  break: 0x7d8aa0,
  off_duty: 0x4a5160,
};

/** PixiJS-Rendering: zeigt nur den Simulationszustand, keine Spiellogik. */
export class Renderer {
  private app = new Application();
  private world = new Container();
  private staticLayer = new Container();
  private vehicleLayer = new Container();
  private workerLayer = new Container();
  private fxLayer = new Container();
  private vehicleSprites = new Map<string, Container>();
  private workerSprites = new Map<string, Container>();
  private getGame: () => Game;
  private onSelect: (sel: Selection | null) => void;
  private selection: Selection | null = null;
  private textures = new Map<string, Texture>();
  private baseScale = 1;
  private dragging = false;
  private dragMoved = 0;
  private lastPointer = { x: 0, y: 0 };
  private initialized = false;

  constructor(getGame: () => Game, onSelect: (sel: Selection | null) => void) {
    this.getGame = getGame;
    this.onSelect = onSelect;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: 0x101216,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.staticLayer, this.vehicleLayer, this.workerLayer, this.fxLayer);
    const entries: [string, string][] = [
      ['car', carSvg],
      ['mechanic', mechanicSvg],
      ['mechanic_green', mechanicGreenSvg],
      ['lift', liftSvg],
      ['diagnosis', diagnosisSvg],
      ['storage', storageSvg],
      ['reception', receptionSvg],
      ['parking', parkingSvg],
      ['vending', vendingSvg],
    ];
    for (const [name, svg] of entries) {
      this.textures.set(name, await svgTexture(svg));
    }
    this.rebuildStatic();
    this.fitCamera();
    this.bindInput();
    this.initialized = true;
  }

  rebuildStatic(): void {
    this.staticLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const game = this.getGame();
    const map = game.map;
    const g = new Graphics();
    // Boden
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const blocked = map.isBlocked(x, y);
        const isWall =
          x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
        let color = (x + y) % 2 === 0 ? 0x23262d : 0x252930;
        if (isWall) color = 0x0c0e12;
        else if (blocked) color = 0x1b1e24;
        g.rect(x * TILE, y * TILE, TILE, TILE).fill(color);
      }
    }
    // Dezente Gridlinien
    for (let x = 0; x <= map.width; x++) {
      g.moveTo(x * TILE, 0).lineTo(x * TILE, map.height * TILE).stroke({ width: 1, color: 0x2c3038, alpha: 0.35 });
    }
    for (let y = 0; y <= map.height; y++) {
      g.moveTo(0, y * TILE).lineTo(map.width * TILE, y * TILE).stroke({ width: 1, color: 0x2c3038, alpha: 0.35 });
    }
    // Fahrspur Markierung
    g.rect(TILE, 15 * TILE + 4, (map.width - 2) * TILE, TILE - 8).fill({ color: 0x2a2e37, alpha: 0.6 });
    this.staticLayer.addChild(g);

    for (const s of game.state.stations) {
      this.staticLayer.addChild(this.drawStation(s));
    }
    // Ein-/Ausfahrt Pfeile
    const arrows = new Graphics();
    arrows.poly([4, 15 * TILE + 10, 20, 15 * TILE + 18, 4, 15 * TILE + 26]).fill(0x6fdc8c);
    arrows.poly([map.width * TILE - 4, 15 * TILE + 10, map.width * TILE - 20, 15 * TILE + 18, map.width * TILE - 4, 15 * TILE + 26]).fill(0xff7b72);
    this.staticLayer.addChild(arrows);
  }

  private label(text: string, x: number, y: number, size = 10, color = 0x9aa3b2): Text {
    const t = new Text({
      text,
      resolution: 3,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fill: color, fontWeight: '600' },
    });
    t.anchor.set(0.5, 0);
    t.x = x;
    t.y = y;
    return t;
  }

  private drawStation(s: Station): Container {
    const c = new Container();
    const { x, y, w, h } = s.rect;
    const px = x * TILE;
    const py = y * TILE;
    const pw = w * TILE;
    const ph = h * TILE;
    if (s.kind === 'lift' && !s.unlocked) {
      const g = new Graphics();
      g.rect(px + 3, py + 3, pw - 6, ph - 6).fill({ color: 0x1b1e24, alpha: 0.5 });
      g.rect(px + 3, py + 3, pw - 6, ph - 6).stroke({ width: 2, color: 0x3a3f4a, alpha: 0.8 });
      c.addChild(g);
      c.addChild(this.label('BÜHNE 3', px + pw / 2, py + ph / 2 - 14, 10, 0x5a6170));
      c.addChild(this.label('(Ausbau)', px + pw / 2, py + ph / 2 + 2, 9, 0x5a6170));
      return c;
    }
    const spriteKeys: Partial<Record<Station['kind'], string>> = {
      lift: 'lift',
      diagnosis: 'diagnosis',
      storage: 'storage',
      office: 'reception',
      break_room: 'vending',
      parking: 'parking',
    };
    const key = spriteKeys[s.kind];
    const tex = key ? this.textures.get(key) : undefined;
    if (tex) {
      const sp = new Sprite(tex);
      sp.x = px;
      sp.y = py;
      sp.width = pw;
      sp.height = ph;
      c.addChild(sp);
    }
    switch (s.kind) {
      case 'lift':
        c.addChild(this.label(s.id === 'lift1' ? 'BÜHNE 1' : s.id === 'lift2' ? 'BÜHNE 2' : 'BÜHNE 3', px + pw / 2, py + ph + 2, 9, 0xd9a441));
        break;
      case 'diagnosis':
        c.addChild(this.label('DIAGNOSE', px + pw / 2, py + ph + 2, 9, 0x4fc3f7));
        break;
      case 'storage':
        c.addChild(this.label('ERSATZTEILLAGER', px + pw / 2, py + ph + 2, 9, 0xc98a4b));
        break;
      case 'office':
        c.addChild(this.label('BÜRO & ANNAHME', px + pw / 2, py + ph + 2, 9));
        break;
      case 'break_room':
        c.addChild(this.label('PAUSENRAUM', px + pw / 2, py + ph + 2, 9));
        break;
      default:
        break;
    }
    return c;
  }

  private fitCamera(): void {
    const game = this.getGame();
    const w = game.map.width * TILE;
    const h = game.map.height * TILE;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.baseScale = Math.min(sw / w, sh / h) * 0.96;
    this.world.scale.set(this.baseScale);
    this.world.x = (sw - w * this.baseScale) / 2;
    this.world.y = (sh - h * this.baseScale) / 2;
  }

  private bindInput(): void {
    const canvas = this.app.canvas;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      this.dragging = true;
      this.dragMoved = 0;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.world.x += dx;
      this.world.y += dy;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e: PointerEvent) => {
      this.dragging = false;
      if (this.dragMoved < 6) {
        this.handleClick(e);
      }
    });
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.max(this.baseScale * 0.5, Math.min(this.baseScale * 3.5, this.world.scale.x * factor));
      const wx = (mx - this.world.x) / this.world.scale.x;
      const wy = (my - this.world.y) / this.world.scale.y;
      this.world.scale.set(newScale);
      this.world.x = mx - wx * newScale;
      this.world.y = my - wy * newScale;
    }, { passive: false });
  }

  private handleClick(e: PointerEvent | FederatedPointerEvent): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - this.world.x) / this.world.scale.x / TILE;
    const wy = (e.clientY - rect.top - this.world.y) / this.world.scale.y / TILE;
    const game = this.getGame();
    let best: Selection | null = null;
    let bestDist = 1.1;
    for (const w of game.state.workers) {
      const d = Math.hypot(w.pos.x + 0.5 - wx, w.pos.y + 0.5 - wy);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: 'worker', id: w.id };
      }
    }
    for (const v of game.state.vehicles) {
      if (v.state === 'incoming' || v.state === 'gone') continue;
      const d = Math.hypot(v.pos.x + 1 - wx, v.pos.y + 0.5 - wy);
      if (d < Math.max(bestDist, 1.4)) {
        bestDist = d;
        best = { kind: 'vehicle', id: v.id };
      }
    }
    this.selection = best;
    this.onSelect(best);
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel;
  }

  private drawVehicle(v: Vehicle): Container {
    const c = new Container();
    const shadow = new Graphics();
    shadow.ellipse(0, 6, 42, 18).fill({ color: 0x000000, alpha: 0.28 });
    c.addChild(shadow);
    const tex = this.textures.get('car');
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.rotation = Math.PI / 2; // Front zeigt nach rechts (Fahrtrichtung)
      // Skalierung aus tatsächlichen Texturmaßen (SVG ist 3x rasterisiert)
      sp.scale.set((2.4 * TILE) / tex.height);
      sp.tint = v.color;
      c.addChild(sp);
    }
    return c;
  }

  private drawWorker(w: Worker): Container {
    const c = new Container();
    const tex = this.textures.get(w.id === 'w2' ? 'mechanic_green' : 'mechanic');
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.scale.set(34 / tex.height);
      sp.y = 12;
      c.addChild(sp);
    }
    const ring = new Graphics();
    ring.name = 'ring';
    c.addChild(ring);
    const name = new Text({
      text: w.name.split(' ')[0] ?? w.name,
      resolution: 3,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 10, fill: 0xdfe5ee, fontWeight: '600' },
    });
    name.anchor.set(0.5, 0);
    name.y = 16;
    c.addChild(name);
    return c;
  }

  update(timeSec: number): void {
    if (!this.initialized) return;
    const game = this.getGame();
    const state = game.state;

    // Fahrzeuge
    const seenV = new Set<string>();
    for (const v of state.vehicles) {
      if (v.state === 'incoming' || v.state === 'gone') continue;
      seenV.add(v.id);
      let sprite = this.vehicleSprites.get(v.id);
      if (!sprite) {
        sprite = this.drawVehicle(v);
        this.vehicleSprites.set(v.id, sprite);
        this.vehicleLayer.addChild(sprite);
      }
      // Im Stand mittig auf dem Arbeitsplatz; fahrend folgt die Mitte dem Pfad
      let cx = v.pos.x + 1;
      let cy = v.pos.y + 0.5;
      if (
        (v.state === 'at_lift' || v.state === 'at_diagnosis' || v.state === 'waiting') &&
        v.targetStationId
      ) {
        const st = state.stations.find((s) => s.id === v.targetStationId);
        if (st) {
          cx = st.rect.x + st.rect.w / 2;
          cy = st.rect.y + st.rect.h / 2;
        }
      }
      sprite.x = cx * TILE;
      sprite.y = cy * TILE;
      const sel = this.selection?.kind === 'vehicle' && this.selection.id === v.id;
      sprite.alpha = 1;
      sprite.scale.set(sel ? 1.04 : 1);
    }
    for (const [id, sprite] of this.vehicleSprites) {
      if (!seenV.has(id)) {
        sprite.destroy({ children: true });
        this.vehicleSprites.delete(id);
      }
    }

    // Mitarbeiter
    const seenW = new Set<string>();
    for (const w of state.workers) {
      seenW.add(w.id);
      let sprite = this.workerSprites.get(w.id);
      if (!sprite) {
        sprite = this.drawWorker(w);
        this.workerSprites.set(w.id, sprite);
        this.workerLayer.addChild(sprite);
      }
      const working = w.state === 'repairing' || w.state === 'diagnosing' || w.state === 'quality_check';
      const bob = working ? Math.sin(timeSec * 9) * 1.6 : 0;
      sprite.x = (w.pos.x + 0.5) * TILE;
      sprite.y = (w.pos.y + 0.5) * TILE + bob;
      const ring = sprite.getChildByName('ring') as Graphics | null;
      if (ring) {
        ring.clear();
        const color = STATE_COLORS[w.state] ?? 0x7d8aa0;
        ring.circle(0, -4, 15).stroke({ width: 2, color, alpha: 0.95 });
        const sel = this.selection?.kind === 'worker' && this.selection.id === w.id;
        if (sel) ring.circle(0, -4, 19).stroke({ width: 2, color: 0xf5a623 });
      }
    }
    for (const [id, sprite] of this.workerSprites) {
      if (!seenW.has(id)) {
        sprite.destroy({ children: true });
        this.workerSprites.delete(id);
      }
    }

    // Fortschrittsanzeigen über aktiven Arbeitsplätzen
    this.fxLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const fx = new Graphics();
    for (const s of state.stations) {
      if (!s.orderId) continue;
      const order = state.orders.find((o) => o.id === s.orderId);
      if (!order) continue;
      const px = s.rect.x * TILE;
      const py = s.rect.y * TILE - 12;
      const pw = s.rect.w * TILE;
      let frac = 0;
      let indeterminate = false;
      let color = 0xf5a623;
      if (order.status === 'diagnosing') {
        frac = 1 - order.diagnosisRemainingMinutes / (DIAGNOSIS_BASE_MINUTES * 1.5);
        color = 0x4fc3f7;
        indeterminate = true;
      } else if (order.status === 'repairing') {
        const total = order.jobs.length || 1;
        const done = order.jobs.filter((j) => j.done).length;
        const job = order.jobs.find((j) => !j.done);
        let stepFrac = 0;
        if (job) {
          const def = game.defs.repairs.find((r) => r.id === job.repairId);
          const steps = def?.steps.length ?? 1;
          stepFrac = (job.stepIndex + (1 - Math.min(1, job.stepRemainingMinutes / 60))) / steps;
        }
        frac = (done + Math.min(1, stepFrac)) / total;
      } else if (order.status === 'quality_check') {
        frac = 1 - order.qcRemainingMinutes / (QC_BASE_MINUTES * 1.5);
        color = 0x9ccc65;
        indeterminate = true;
      } else {
        continue;
      }
      fx.roundRect(px, py, pw, 7, 3).fill(0x0e1116);
      if (indeterminate) {
        const t = (timeSec * 0.6) % 1;
        fx.roundRect(px + t * (pw - 24), py + 1, 24, 5, 2).fill(color);
      } else {
        fx.roundRect(px + 1, py + 1, Math.max(2, (pw - 2) * Math.min(1, frac)), 5, 2).fill(color);
      }
      // Arbeitsfunken
      if (order.status === 'repairing' && order.assignedWorkerId) {
        const w = state.workers.find((x) => x.id === order.assignedWorkerId);
        if (w && w.state === 'repairing') {
          const sparkPhase = Math.floor(timeSec * 6) % 3;
          for (let i = 0; i < sparkPhase + 1; i++) {
            fx.circle(
              (w.pos.x + 0.5) * TILE + 8 + i * 4,
              (w.pos.y + 0.5) * TILE - 6 - (i % 2) * 5,
              1.6,
            ).fill(0xffd54f);
          }
        }
      }
    }
    this.fxLayer.addChild(fx);
  }

  resize(): void {
    // resizeTo übernimmt das Canvas-Resizing; Kamera bei Bedarf neu einpassen
  }

  resetCamera(): void {
    this.fitCamera();
  }
}
