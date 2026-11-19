import type { Station, Vec } from '../entities/types';

/**
 * Statischer Werkstattgrundriss (MVP: festes Layout, freischaltbare Plätze).
 * Koordinaten in Tiles; blockierte Tiles sind Wände und Objektflächen.
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly stations: Station[];
  private blocked: Set<number>;

  constructor(width: number, height: number, stations: Station[]) {
    this.width = width;
    this.height = height;
    this.stations = stations;
    this.blocked = new Set();
    for (let x = 0; x < width; x++) {
      this.block(x, 0);
      this.block(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      this.block(0, y);
      this.block(width - 1, y);
    }
    // Ein-/Ausfahrt als Lücken in der Wand
    this.unblock(0, 15);
    this.unblock(width - 1, 15);
    for (const s of stations) {
      if (s.kind === 'entry' || s.kind === 'exit' || s.kind === 'parking') continue;
      if (!s.unlocked) continue; // gesperrte Ausbauplätze bleiben begehbarer Boden
      for (let dy = 0; dy < s.rect.h; dy++) {
        for (let dx = 0; dx < s.rect.w; dx++) {
          this.block(s.rect.x + dx, s.rect.y + dy);
        }
      }
    }
  }

  private key(x: number, y: number): number {
    return y * this.width + x;
  }

  private block(x: number, y: number): void {
    this.blocked.add(this.key(x, y));
  }

  private unblock(x: number, y: number): void {
    this.blocked.delete(this.key(x, y));
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.blocked.has(this.key(x, y));
  }

  static defaultStations(): Station[] {
    return [
      { id: 'office', kind: 'office', rect: { x: 2, y: 2, w: 4, h: 2 }, interact: { x: 3, y: 4 }, orderId: null, unlocked: true },
      { id: 'break_room', kind: 'break_room', rect: { x: 2, y: 10, w: 3, h: 2 }, interact: { x: 3, y: 12 }, orderId: null, unlocked: true },
      { id: 'storage', kind: 'storage', rect: { x: 20, y: 2, w: 4, h: 3 }, interact: { x: 21, y: 5 }, orderId: null, unlocked: true },
      { id: 'diag1', kind: 'diagnosis', rect: { x: 9, y: 3, w: 3, h: 2 }, interact: { x: 10, y: 5 }, orderId: null, unlocked: true },
      { id: 'diag2', kind: 'diagnosis', rect: { x: 14, y: 3, w: 3, h: 2 }, interact: { x: 15, y: 5 }, orderId: null, unlocked: false },
      { id: 'lift1', kind: 'lift', rect: { x: 8, y: 9, w: 3, h: 2 }, interact: { x: 9, y: 11 }, orderId: null, unlocked: true },
      { id: 'lift2', kind: 'lift', rect: { x: 13, y: 9, w: 3, h: 2 }, interact: { x: 14, y: 11 }, orderId: null, unlocked: true },
      { id: 'lift3', kind: 'lift', rect: { x: 18, y: 9, w: 3, h: 2 }, interact: { x: 19, y: 11 }, orderId: null, unlocked: false },
      { id: 'park1', kind: 'parking', rect: { x: 4, y: 13, w: 3, h: 2 }, interact: { x: 4, y: 13 }, orderId: null, unlocked: true },
      { id: 'park2', kind: 'parking', rect: { x: 8, y: 13, w: 3, h: 2 }, interact: { x: 8, y: 13 }, orderId: null, unlocked: true },
      { id: 'park3', kind: 'parking', rect: { x: 12, y: 13, w: 3, h: 2 }, interact: { x: 12, y: 13 }, orderId: null, unlocked: true },
      { id: 'entry', kind: 'entry', rect: { x: 0, y: 15, w: 1, h: 1 }, interact: { x: 1, y: 15 }, orderId: null, unlocked: true },
      { id: 'exit', kind: 'exit', rect: { x: 25, y: 15, w: 1, h: 1 }, interact: { x: 24, y: 15 }, orderId: null, unlocked: true },
    ];
  }

  static createDefault(): TileMap {
    return new TileMap(26, 18, TileMap.defaultStations());
  }
}

export function tileCenter(v: Vec): Vec {
  return { x: v.x + 0.5, y: v.y + 0.5 };
}
