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
import carKleinwagenSvg from '../assets/sprites/car_kleinwagen.svg?raw';
import carLimousineSvg from '../assets/sprites/car_limousine.svg?raw';
import carSuvSvg from '../assets/sprites/car_suv.svg?raw';
import carPickupSvg from '../assets/sprites/car_pickup.svg?raw';
import carTransporterSvg from '../assets/sprites/car_transporter.svg?raw';
import { ROOM_DEFS } from '../world/TileMap';
import { CLASS_SPRITES } from '../data';

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
  training: 0xb39ddb,
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
  private vehicleBaseScale = new Map<string, number>();
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
      ['car_kleinwagen', carKleinwagenSvg],
      ['car_limousine', carLimousineSvg],
      ['car_suv', carSuvSvg],
      ['car_pickup', carPickupSvg],
      ['car_transporter', carTransporterSvg],
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
    // Hof (Asphalt) als Basis innerhalb der Außenwand
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const isWall =
          x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
        let color = (x + y) % 2 === 0 ? 0x1c1f24 : 0x1e2127;
        if (isWall) color = 0x0c0e12;
        g.rect(x * TILE, y * TILE, TILE, TILE).fill(color);
      }
    }
    // Werkstatthalle: heller Betonboden über den Arbeitsflächen
    const hall = { x: 7, y: 1, w: 24, h: 12 };
    for (let y = hall.y; y < hall.y + hall.h; y++) {
      for (let x = hall.x; x < hall.x + hall.w; x++) {
        const color = (x + y) % 2 === 0 ? 0x2a2e36 : 0x2c3039;
        g.rect(x * TILE, y * TILE, TILE, TILE).fill(color);
      }
    }
    g.rect(hall.x * TILE, hall.y * TILE, hall.w * TILE, hall.h * TILE)
      .stroke({ width: 3, color: 0x3d434e });
    // dezente Gridlinien nur in der Halle
    for (let x = hall.x; x <= hall.x + hall.w; x++) {
      g.moveTo(x * TILE, hall.y * TILE).lineTo(x * TILE, (hall.y + hall.h) * TILE).stroke({ width: 1, color: 0x333842, alpha: 0.4 });
    }
    for (let y = hall.y; y <= hall.y + hall.h; y++) {
      g.moveTo(hall.x * TILE, y * TILE).lineTo((hall.x + hall.w) * TILE, y * TILE).stroke({ width: 1, color: 0x333842, alpha: 0.4 });
    }
    // Räume: Innenboden, Wandring, Türschwelle
    for (const room of ROOM_DEFS) {
      for (let y = room.y1 + 1; y < room.y2; y++) {
        for (let x = room.x1 + 1; x < room.x2; x++) {
          g.rect(x * TILE, y * TILE, TILE, TILE).fill((x + y) % 2 === 0 ? 0x262a33 : 0x282c36);
        }
      }
      for (let x = room.x1; x <= room.x2; x++) {
        for (const y of [room.y1, room.y2]) {
          if (x === room.door.x && y === room.door.y) continue;
          g.rect(x * TILE, y * TILE, TILE, TILE).fill(0x0c0e12);
          g.rect(x * TILE, y * TILE, TILE, 4).fill(0x3d434e);
        }
      }
      for (let y = room.y1; y <= room.y2; y++) {
        for (const x of [room.x1, room.x2]) {
          if (x === room.door.x && y === room.door.y) continue;
          g.rect(x * TILE, y * TILE, TILE, TILE).fill(0x0c0e12);
          g.rect(x * TILE, y * TILE, 4, TILE).fill(0x3d434e);
        }
      }
      // Türschwelle (braun) + Rahmen
      const dx = room.door.x * TILE;
      const dy = room.door.y * TILE;
      g.rect(dx + 2, dy + 2, TILE - 4, TILE - 4).fill(0x262a33);
      g.rect(dx + 4, dy + TILE / 2 - 3, TILE - 8, 6).fill(0x8a5a33);
    }
    // Wartebereich vor dem Büro
    g.rect(2 * TILE + 6, 6 * TILE + 8, 2 * TILE - 12, 10).fill(0x3a4150);
    g.rect(2 * TILE + 6, 7 * TILE + 4, 2 * TILE - 12, 10).fill(0x3a4150);
    // Fahrspur mit Mittelstrich
    g.rect(TILE, 15 * TILE + 4, (map.width - 2) * TILE, TILE - 8).fill({ color: 0x23262e, alpha: 0.9 });
    for (let x = 2; x < map.width - 2; x += 2) {
      g.rect(x * TILE, 15 * TILE + TILE / 2 - 1, TILE - 8, 2).fill({ color: 0xd9a441, alpha: 0.35 });
    }
    // Parkplätze: weiße Buchten
    for (const s of game.state.stations) {
      if (s.kind !== 'parking') continue;
      g.rect(s.rect.x * TILE + 2, s.rect.y * TILE + 2, s.rect.w * TILE - 4, s.rect.h * TILE - 4)
        .stroke({ width: 2, color: 0x8b93a3, alpha: 0.5 });
    }
    this.staticLayer.addChild(g);
    // Raum-Labels
    for (const room of ROOM_DEFS) {
      this.staticLayer.addChild(
        this.label(room.label.toUpperCase(), (room.x1 + room.x2 + 1) * TILE / 2, (room.y1 + 0.15) * TILE, 9, 0x9aa3b2),
      );
    }
    this.staticLayer.addChild(this.label('WARTEBEREICH', 3 * TILE, 7 * TILE + 18, 8, 0x6b7280));
    // Tore (Einfahrt links, Ausfahrt rechts): Pfosten mit Warnstreifen + Sturz
    const gates = new Graphics();
    for (const gx of [0, map.width - 1]) {
      for (const gy of [14, 16]) {
        const px = gx * TILE;
        const py = gy * TILE;
        gates.rect(px, py, TILE, TILE).fill(0x1a1d23);
        for (let i = 0; i < 3; i++) {
          const x0 = px + i * 10;
          gates.poly([x0, py + TILE, x0 + 5, py + TILE, x0 + 14, py, x0 + 9, py]).fill({ color: 0xd9a441, alpha: 0.9 });
        }
        gates.rect(px + 1, py + 1, TILE - 2, TILE - 2).stroke({ width: 2, color: 0x0c0e12 });
      }
      // Sturz über dem Tor
      gates.rect(gx * TILE, 15 * TILE - 5, TILE, 5).fill(0x3d434e);
    }
    this.staticLayer.addChild(gates);
    this.staticLayer.addChild(this.label('EINFAHRT', 1.6 * TILE, 13.4 * TILE, 9, 0x6fdc8c));
    this.staticLayer.addChild(this.label('AUSFAHRT', (map.width - 1.6) * TILE, 13.4 * TILE, 9, 0xff7b72));

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
    if (s.kind === 'parking' && !s.unlocked) {
      const g = new Graphics();
      g.rect(px + 2, py + 2, pw - 4, ph - 4).stroke({ width: 2, color: 0x3a3f4a, alpha: 0.7 });
      c.addChild(g);
      c.addChild(this.label('P (Ausbau)', px + pw / 2, py + ph / 2 - 6, 8, 0x5a6170));
      return c;
    }
    if (s.kind === 'lift' && !s.unlocked) {
      const g = new Graphics();
      g.rect(px + 3, py + 3, pw - 6, ph - 6).fill({ color: 0x1b1e24, alpha: 0.5 });
      g.rect(px + 3, py + 3, pw - 6, ph - 6).stroke({ width: 2, color: 0x3a3f4a, alpha: 0.8 });
      c.addChild(g);
      c.addChild(this.label(`BÜHNE ${s.id.replace('lift', '')}`, px + pw / 2, py + ph / 2 - 14, 10, 0x5a6170));
      c.addChild(this.label('(Ausbau)', px + pw / 2, py + ph / 2 + 2, 9, 0x5a6170));
      return c;
    }
    if (s.kind === 'diagnosis' && !s.unlocked) {
      const g = new Graphics();
      g.rect(px + 3, py + 3, pw - 6, ph - 6).fill({ color: 0x1b1e24, alpha: 0.5 });
      g.rect(px + 3, py + 3, pw - 6, ph - 6).stroke({ width: 2, color: 0x3a3f4a, alpha: 0.8 });
      c.addChild(g);
      c.addChild(this.label(`DIAGNOSE ${s.id.replace('diag', '')}`, px + pw / 2, py + ph / 2 - 14, 10, 0x5a6170));
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
        c.addChild(this.label(`BÜHNE ${s.id.replace('lift', '')}`, px + pw / 2, py + ph + 2, 9, 0xd9a441));
        break;
      case 'diagnosis':
        c.addChild(this.label(`DIAGNOSE ${s.id.replace('diag', '')}`, px + pw / 2, py + ph + 2, 9, 0x4fc3f7));
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

  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const newScale = Math.max(this.baseScale * 0.5, Math.min(this.baseScale * 3.5, this.world.scale.x * factor));
    const wx = (mx - this.world.x) / this.world.scale.x;
    const wy = (my - this.world.y) / this.world.scale.y;
    this.world.scale.set(newScale);
    this.world.x = mx - wx * newScale;
    this.world.y = my - wy * newScale;
  }

  private bindInput(): void {
    const canvas = this.app.canvas;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (this.activePointers.size === 2) {
        const [a, b] = [...this.activePointers.values()];
        this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        this.dragging = false;
      } else {
        this.dragging = true;
        this.dragMoved = 0;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activePointers.size === 2) {
        // Pinch-Zoom (Touch)
        const [a, b] = [...this.activePointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (this.pinchDist > 0 && d > 0) {
          this.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, d / this.pinchDist);
        }
        this.pinchDist = d;
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.world.x += dx;
      this.world.y += dy;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    const release = (e: PointerEvent): void => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) this.pinchDist = 0;
      if (this.activePointers.size === 0) {
        this.dragging = false;
        if (this.dragMoved < 6) this.handleClick(e);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
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
    shadow.ellipse(0, 5, 34, 13).fill({ color: 0x000000, alpha: 0.28 });
    c.addChild(shadow);
    const key = CLASS_SPRITES[v.vehicleClass] ?? 'car';
    const tex = this.textures.get(key) ?? this.textures.get('car');
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.rotation = Math.PI / 2; // Front zeigt nach rechts (Fahrtrichtung)
      // Klassenabhängige Länge; Skalierung aus tatsächlichen Texturmaßen (3x rasterisiert)
      const lengthTiles =
        v.vehicleClass === 'transporter' ? 3.0 :
        v.vehicleClass === 'pickup' ? 2.6 :
        v.vehicleClass === 'suv' ? 2.5 : 2.4;
      const base = (lengthTiles * TILE) / tex.height;
      sp.scale.set(base);
      this.vehicleBaseScale.set(v.id, base);
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
        (v.state === 'at_lift' || v.state === 'at_diagnosis' || v.state === 'waiting' || v.state === 'waiting_pickup') &&
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
      // Parkende Fahrzeuge passen in die Buchtenhöhe (1 Tile an der Straße)
      const body = sprite.children[1] as Sprite | undefined;
      const base = this.vehicleBaseScale.get(v.id);
      if (body && base !== undefined) {
        if (v.state === 'waiting' || v.state === 'waiting_pickup') {
          body.scale.set(Math.min(base, (0.92 * TILE) / body.texture.width));
        } else {
          body.scale.set(base);
        }
      }
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

    // Mitarbeiter (Feierabend = ausgeblendet)
    const seenW = new Set<string>();
    for (const w of state.workers) {
      if (w.state === 'off_duty') continue;
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
