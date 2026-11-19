import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { TileMap, ROOM_DEFS, MAP_WIDTH } from '../src/world/TileMap';
import { findPath } from '../src/world/Pathfinding';
import { migrate } from '../src/persistence/SaveMigration';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) game.state.inventory.stock[k] = qty;
}

function accept(game: Game, defectId = 'replace_brake_pads') {
  let offer = game.generateOffer();
  if (!offer) {
    for (const o of game.state.orders.filter((x) => x.status === 'incoming')) game.declineOrder(o.id);
    offer = game.generateOffer()!;
  }
  offer.defectRepairIds = [defectId];
  offer.budgetCents = 5_000_000;
  game.acceptOrder(offer.id);
  return offer;
}

function runUntil(game: Game, pred: () => boolean, maxMinutes = 8 * 1440): void {
  const limit = game.state.totalMinutes + maxMinutes;
  while (game.state.totalMinutes < limit && !pred()) game.tick(5);
}

describe('Start: nur 3 Parkplätze', () => {
  it('3 von 8 Plätzen frei, 5 kaufbar', () => {
    const game = Game.new(1100);
    const parks = game.state.stations.filter((s) => s.kind === 'parking');
    expect(parks).toHaveLength(8);
    expect(parks.filter((p) => p.unlocked)).toHaveLength(3);
    game.state.economy.balanceCents = 100_000_000;
    for (let i = 0; i < 5; i++) expect(game.buyParking()).toBe(true);
    expect(game.buyParking()).toBe(false);
    expect(game.state.stations.filter((s) => s.kind === 'parking' && s.unlocked)).toHaveLength(8);
  });
});

describe('Neues Layout: Diagnose vorn, Bühnen hinten, 4+3 Plätze', () => {
  it('Werkstatt ist verlängert (32 Tiles)', () => {
    expect(MAP_WIDTH).toBe(32);
    const map = TileMap.createDefault();
    expect(map.width).toBe(32);
  });

  it('Diagnoseplätze liegen vorn (y9), Hebebühnen hinten (y3)', () => {
    const st = TileMap.defaultStations();
    const diags = st.filter((s) => s.kind === 'diagnosis');
    const lifts = st.filter((s) => s.kind === 'lift');
    expect(diags).toHaveLength(3);
    expect(lifts).toHaveLength(4);
    for (const d of diags) expect(d.rect.y).toBe(9);
    for (const l of lifts) expect(l.rect.y).toBe(3);
    expect(diags.filter((d) => d.unlocked)).toHaveLength(1);
    expect(lifts.filter((l) => l.unlocked)).toHaveLength(2);
  });

  it('Lagertür zeigt Richtung Hebebühnen (linke Wand)', () => {
    const room = ROOM_DEFS.find((r) => r.id === 'storage')!;
    expect(room.door.x).toBe(room.x1); // Tür in der linken Wand
    const storage = TileMap.defaultStations().find((s) => s.id === 'storage')!;
    const map = TileMap.createDefault();
    expect(map.isBlocked(room.door.x, room.door.y)).toBe(false);
    const path = findPath(map, { x: 24, y: 6 }, storage.interact);
    expect(path).not.toBeNull();
  });

  it('Einfahrt erreicht Diagnose, Bühne 4 und Lager', () => {
    const map = TileMap.createDefault();
    const st = TileMap.defaultStations();
    for (const id of ['diag1', 'lift4', 'storage']) {
      const target = st.find((s) => s.id === id)!;
      const path = findPath(map, { x: 1, y: 15 }, target.interact);
      expect(path).not.toBeNull();
    }
  });

  it('Ausbau: Bühne 3+4 und Diagnose 2+3 kaufbar', () => {
    const game = Game.new(1101);
    game.state.economy.balanceCents = 100_000_000;
    expect(game.buyLift()).toBe(true);
    expect(game.state.stations.find((s) => s.id === 'lift3')!.unlocked).toBe(true);
    expect(game.buyLift()).toBe(true);
    expect(game.state.stations.find((s) => s.id === 'lift4')!.unlocked).toBe(true);
    expect(game.buyLift()).toBe(false);
    expect(game.buyDiagnosisBay()).toBe(true);
    expect(game.state.stations.find((s) => s.id === 'diag2')!.unlocked).toBe(true);
    expect(game.buyDiagnosisBay()).toBe(true);
    expect(game.state.stations.find((s) => s.id === 'diag3')!.unlocked).toBe(true);
    expect(game.buyDiagnosisBay()).toBe(false);
  });
});

describe('Warten auf Teile passiert auf dem Parkplatz', () => {
  it('Fahrzeug gibt die Diagnose frei und wartet auf dem Parkplatz', () => {
    const game = Game.new(1110);
    stockEverything(game);
    game.state.inventory.capacity = 5000;
    const offer = accept(game, 'replace_brake_caliper');
    const vFix = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    vFix.modelId = 'vw_golf';
    const cFix = game.state.customers.find((c) => c.id === offer.customerId)!;
    cFix.profile = 'regular';
    // Benötigtes Teil komplett leeren (inkl. Reservierungspuffer)
    game.state.inventory.stock['brake_caliper__M__standard'] = 0;
    game.state.inventory.minStock['brake_caliper__M__standard'] = 0;
    game.state.inventory.autoReorder['brake_caliper__M__standard'] = false;
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    runUntil(game, () => v.state === 'waiting', 240);
    expect(v.state).toBe('waiting');
    const diag = game.state.stations.find((s) => s.id === 'diag1')!;
    expect(diag.orderId).toBeNull();
    // Lieferung kommt → Reparatur läuft → Auftrag wird fertig
    game.orderParts('brake_caliper__M__standard', 1, 'expressparts');
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.status).toBe('delivered');
  });
});

describe('Lager: Alle Auto an/aus', () => {
  it('setAllAutoReorder schaltet alle Artikel', () => {
    const game = Game.new(1120);
    game.setAllAutoReorder(true);
    for (const p of game.defs.parts) {
      expect(game.state.inventory.autoReorder[p.id]).toBe(true);
    }
    game.setAllAutoReorder(false);
    for (const p of game.defs.parts) {
      expect(game.state.inventory.autoReorder[p.id]).toBe(false);
    }
  });
});

describe('Save-Migration v8 → v9', () => {
  it('übernimmt Layout und behält Freischaltungen', () => {
    const game = Game.new(1130);
    game.state.economy.balanceCents = 100_000_000;
    game.buyLift(); // lift3 frei
    const raw = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    raw.version = 8;
    // Altes Layout simulieren: lift3 hinten auf y9
    const stations = raw.stations as Array<Record<string, unknown>>;
    const l3 = stations.find((s) => s.id === 'lift3')!;
    l3.rect = { x: 18, y: 9, w: 3, h: 2 };
    const migrated = migrate(raw);
    expect(migrated.version).toBe(14);
    const m3 = (migrated.stations as Array<Record<string, unknown>>).find((s) => s.id === 'lift3')!;
    expect(m3.unlocked).toBe(true);
    expect(m3.rect).toEqual({ x: 18, y: 3, w: 3, h: 2 });
    const lifts = (migrated.stations as Array<Record<string, unknown>>).filter((s) => s.kind === 'lift');
    expect(lifts).toHaveLength(4);
    const parks = (migrated.stations as Array<Record<string, unknown>>).filter((s) => s.kind === 'parking');
    expect(parks.filter((p) => p.unlocked)).toHaveLength(3);
  });
});
