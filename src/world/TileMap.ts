import type { Station, Vec } from '../entities/types';

/** Räume (Büro, Pause, Lager): Wandring mit einer Tür. */
export interface RoomDef {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  door: Vec;
  label: string;
}

export const MAP_WIDTH = 32;
export const MAP_HEIGHT = 18;

export const ROOM_DEFS: RoomDef[] = [
  { id: 'office', x1: 1, y1: 1, x2: 6, y2: 5, door: { x: 4, y: 5 }, label: 'Büro & Annahme' },
  { id: 'break_room', x1: 1, y1: 8, x2: 5, y2: 12, door: { x: 5, y: 10 }, label: 'Pausenraum' },
  { id: 'storage', x1: 26, y1: 1, x2: 30, y2: 6, door: { x: 26, y: 5 }, label: 'Ersatzteillager' },
];

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
    // Ein-/Ausfahrt als Lücken in der Wand (Tore)
    this.unblock(0, 15);
    this.unblock(width - 1, 15);
    // Räume: Wandring mit Tür
    for (const room of ROOM_DEFS) {
      for (let x = room.x1; x <= room.x2; x++) {
        this.block(x, room.y1);
        this.block(x, room.y2);
      }
      for (let y = room.y1; y <= room.y2; y++) {
        this.block(room.x1, y);
        this.block(room.x2, y);
      }
      this.unblock(room.door.x, room.door.y);
    }
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
      { id: 'break_room', kind: 'break_room', rect: { x: 2, y: 10, w: 2, h: 2 }, interact: { x: 3, y: 9 }, orderId: null, unlocked: true },
      { id: 'storage', kind: 'storage', rect: { x: 27, y: 2, w: 3, h: 2 }, interact: { x: 27, y: 4 }, orderId: null, unlocked: true },
      // Diagnose vorn (nahe Einfahrt), Hebebühnen hinten
      { id: 'diag1', kind: 'diagnosis', rect: { x: 8, y: 9, w: 3, h: 2 }, interact: { x: 9, y: 11 }, orderId: null, unlocked: true },
      { id: 'diag2', kind: 'diagnosis', rect: { x: 13, y: 9, w: 3, h: 2 }, interact: { x: 14, y: 11 }, orderId: null, unlocked: false },
      { id: 'diag3', kind: 'diagnosis', rect: { x: 18, y: 9, w: 3, h: 2 }, interact: { x: 19, y: 11 }, orderId: null, unlocked: false },
      { id: 'lift1', kind: 'lift', rect: { x: 8, y: 3, w: 3, h: 2 }, interact: { x: 9, y: 5 }, orderId: null, unlocked: true },
      { id: 'lift2', kind: 'lift', rect: { x: 13, y: 3, w: 3, h: 2 }, interact: { x: 14, y: 5 }, orderId: null, unlocked: true },
      { id: 'lift3', kind: 'lift', rect: { x: 18, y: 3, w: 3, h: 2 }, interact: { x: 19, y: 5 }, orderId: null, unlocked: false },
      { id: 'lift4', kind: 'lift', rect: { x: 23, y: 3, w: 3, h: 2 }, interact: { x: 24, y: 5 }, orderId: null, unlocked: false },
      // Längs-Parkplätze an der Fahrspur (y15), 6 frei + 2 kaufbar
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `park${i + 1}`,
        kind: 'parking' as const,
        rect: { x: 1 + i * 3, y: 16, w: 3, h: 1 },
        interact: { x: 2 + i * 3, y: 16 },
        orderId: null,
        unlocked: i < 3,
      })),
      { id: 'entry', kind: 'entry', rect: { x: 0, y: 15, w: 1, h: 1 }, interact: { x: 1, y: 15 }, orderId: null, unlocked: true },
      { id: 'exit', kind: 'exit', rect: { x: 31, y: 15, w: 1, h: 1 }, interact: { x: 30, y: 15 }, orderId: null, unlocked: true },
    ];
  }

  static createDefault(): TileMap {
    return new TileMap(MAP_WIDTH, MAP_HEIGHT, TileMap.defaultStations());
  }
}

export function tileCenter(v: Vec): Vec {
  return { x: v.x + 0.5, y: v.y + 0.5 };
}
