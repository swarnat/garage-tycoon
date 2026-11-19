import type { Vec } from '../entities/types';
import type { TileMap } from './TileMap';

interface PathOptions {
  /** Fahrzeug: Ziel-Rechteck darf betreten werden, auch wenn blockiert. */
  vehicleTargetRect?: { x: number; y: number; w: number; h: number };
}

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

/** A* auf dem Tile-Grid (4 Richtungen, Manhattan-Heuristik). */
export function findPath(
  map: TileMap,
  start: Vec,
  goal: Vec,
  opts: PathOptions = {},
): Vec[] | null {
  const sx = Math.round(start.x);
  const sy = Math.round(start.y);
  const gx = Math.round(goal.x);
  const gy = Math.round(goal.y);
  if (!map.inBounds(gx, gy)) return null;

  const inTargetRect = (x: number, y: number): boolean => {
    const r = opts.vehicleTargetRect;
    if (!r) return false;
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  };
  const passable = (x: number, y: number): boolean =>
    map.inBounds(x, y) && (!map.isBlocked(x, y) || inTargetRect(x, y));

  if (!passable(gx, gy)) return null;
  if (sx === gx && sy === gy) return [];

  const key = (x: number, y: number): number => y * map.width + x;
  const open: Node[] = [];
  const best = new Map<number, number>();
  const closed = new Set<number>();
  const h = (x: number, y: number): number => Math.abs(x - gx) + Math.abs(y - gy);
  const startNode: Node = { x: sx, y: sy, g: 0, f: h(sx, sy), parent: null };
  open.push(startNode);
  best.set(key(sx, sy), 0);

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  let guard = 0;
  while (open.length > 0 && guard++ < 20000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if ((open[i] as Node).f < (open[bi] as Node).f) bi = i;
    }
    const current = open.splice(bi, 1)[0] as Node;
    const ck = key(current.x, current.y);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (current.x === gx && current.y === gy) {
      const path: Vec[] = [];
      let n: Node | null = current;
      while (n && n.parent) {
        path.push({ x: n.x, y: n.y });
        n = n.parent;
      }
      path.reverse();
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!passable(nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const g = current.g + 1;
      const prev = best.get(nk);
      if (prev !== undefined && prev <= g) continue;
      best.set(nk, g);
      open.push({ x: nx, y: ny, g, f: g + h(nx, ny), parent: current });
    }
  }
  return null;
}
