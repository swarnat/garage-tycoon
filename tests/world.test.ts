import { describe, expect, it } from 'vitest';
import { TileMap } from '../src/world/TileMap';
import { findPath } from '../src/world/Pathfinding';

describe('TileMap & Wegfindung', () => {
  it('baut eine Werkstatt mit begehbarem Innenraum und blockierten Wänden', () => {
    const map = TileMap.createDefault();
    expect(map.width).toBeGreaterThan(10);
    expect(map.height).toBeGreaterThan(10);
    expect(map.isBlocked(0, 0)).toBe(true);
    expect(map.isBlocked(6, 7)).toBe(false);
  });

  it('findet einen Weg um Hindernisse herum (A*)', () => {
    const map = TileMap.createDefault();
    const storage = map.stations.find((s) => s.kind === 'storage');
    expect(storage).toBeDefined();
    const start = { x: 4, y: 6 };
    const path = findPath(map, start, storage!.interact);
    expect(path).not.toBeNull();
    if (!path) return;
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1]!;
    expect(last).toEqual(storage!.interact);
    for (const p of path) {
      expect(map.isBlocked(p.x, p.y)).toBe(false);
    }
  });

  it('liefert null für unerreichbare Ziele', () => {
    const map = TileMap.createDefault();
    const path = findPath(map, { x: 6, y: 7 }, { x: 0, y: 0 });
    expect(path).toBeNull();
  });

  it('erlaubt Fahrzeugen das Betreten des Ziel-Arbeitsplatzes', () => {
    const map = TileMap.createDefault();
    const lift = map.stations.find((s) => s.kind === 'lift' && s.unlocked)!;
    const goal = { x: lift.rect.x, y: lift.rect.y };
    const path = findPath(map, { x: 1, y: 15 }, goal, {
      vehicleTargetRect: lift.rect,
    });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual(goal);
  });
});
