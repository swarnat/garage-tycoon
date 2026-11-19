import type { GameDefs, GameNotification, GameState } from '../entities/types';
import type { EventBus } from '../core/EventBus';
import type { RandomGenerator } from '../core/RandomGenerator';
import type { TileMap } from '../world/TileMap';

/** Kontext für alle Simulationsysteme – keine DOM-/Pixi-Abhängigkeiten. */
export interface SimContext {
  state: GameState;
  rng: RandomGenerator;
  bus: EventBus;
  defs: GameDefs;
  map: TileMap;
}

const MAX_NOTIFICATIONS = 40;

export function notify(
  ctx: SimContext,
  kind: GameNotification['kind'],
  text: string,
): void {
  ctx.state.notifications.push({
    id: ctx.state.nextNotificationId++,
    atMinute: ctx.state.totalMinutes,
    kind,
    text,
  });
  if (ctx.state.notifications.length > MAX_NOTIFICATIONS) {
    ctx.state.notifications.splice(
      0,
      ctx.state.notifications.length - MAX_NOTIFICATIONS,
    );
  }
}

export function partDef(ctx: SimContext, partId: string) {
  const p = ctx.defs.parts.find((x) => x.id === partId);
  if (!p) throw new Error(`Unbekanntes Teil: ${partId}`);
  return p;
}

export function repairDef(ctx: SimContext, repairId: string) {
  const r = ctx.defs.repairs.find((x) => x.id === repairId);
  if (!r) throw new Error(`Unbekannte Reparatur: ${repairId}`);
  return r;
}

export function orderById(state: GameState, id: string) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) throw new Error(`Unbekannter Auftrag: ${id}`);
  return o;
}

export function stationById(state: GameState, id: string) {
  const s = state.stations.find((x) => x.id === id);
  if (!s) throw new Error(`Unbekannter Arbeitsplatz: ${id}`);
  return s;
}

export function vehicleById(state: GameState, id: string) {
  const v = state.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`Unbekanntes Fahrzeug: ${id}`);
  return v;
}
