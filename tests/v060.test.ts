import { describe, expect, it } from 'vitest';
import { Game, createNewGame } from '../src/core/Game';
import { DEFS, CLASS_SPRITES } from '../src/data';
import { TileMap, ROOM_DEFS } from '../src/world/TileMap';
import { findPath } from '../src/world/Pathfinding';
import { OrderSystem } from '../src/simulation/OrderSystem';
import { migrate } from '../src/persistence/SaveMigration';

describe('Neues Spiel: Lager-Defaults', () => {
  it('jeder Artikel hat einen sinnvollen Mindestbestand (>= 1)', () => {
    const state = createNewGame(900);
    for (const p of DEFS.parts) {
      expect(state.inventory.minStock[p.id]).toBeGreaterThanOrEqual(1);
    }
  });

  it('Auto-Bestellung ist für alle Artikel standardmäßig deaktiviert', () => {
    const state = createNewGame(901);
    for (const p of DEFS.parts) {
      expect(state.inventory.autoReorder[p.id] ?? false).toBe(false);
    }
  });

  it('Verschleißteile haben höhere Mindestbestände als seltene Teile', () => {
    const state = createNewGame(902);
    expect(state.inventory.minStock['brake_pads']).toBeGreaterThanOrEqual(2);
    expect(state.inventory.minStock['motor_oil']).toBeGreaterThanOrEqual(2);
    expect(state.inventory.minStock['alternator']).toBe(1);
  });

  it('Startbestand ist deterministisch und unabhängig von früherem Spiel', () => {
    const a = createNewGame(903);
    const b = createNewGame(904);
    expect(a.inventory.stock).toEqual(b.inventory.stock);
  });
});

describe('Räume mit Wänden und Türen', () => {
  it('Raumwände blockieren, Türen sind begehbar', () => {
    const map = TileMap.createDefault();
    for (const room of ROOM_DEFS) {
      expect(map.isBlocked(room.door.x, room.door.y)).toBe(false);
      // Eine Wandecke des Raums ist blockiert
      expect(map.isBlocked(room.x1, room.y1)).toBe(true);
    }
  });

  it('Lager, Pause und Büro sind durch die Tür erreichbar', () => {
    const map = TileMap.createDefault();
    const stations = TileMap.defaultStations();
    for (const id of ['storage', 'break_room', 'office']) {
      const st = stations.find((s) => s.id === id)!;
      expect(map.isBlocked(st.interact.x, st.interact.y)).toBe(false);
      const path = findPath(map, { x: 10, y: 12 }, st.interact);
      expect(path).not.toBeNull();
      for (const p of path!) expect(map.isBlocked(p.x, p.y)).toBe(false);
    }
  });

  it('Fahrzeug-Korridore bleiben frei (Parkplätze nicht verbaut)', () => {
    const map = TileMap.createDefault();
    for (const x of [4, 5, 6, 8, 9, 10, 12, 13, 14]) {
      expect(map.isBlocked(x, 13)).toBe(false);
      expect(map.isBlocked(x, 14)).toBe(false);
    }
    const path = findPath(map, { x: 1, y: 15 }, { x: 10, y: 5 });
    expect(path).not.toBeNull();
  });
});

describe('Spezialwerkzeug-Hinweis bei Diagnose', () => {
  it('missingToolsForOrder listet fehlende Werkzeuge über alle Jobs', () => {
    const game = Game.new(910);
    const offer = game.generateOffer()!;
    offer.defectRepairIds = ['replace_water_pump', 'replace_springs'];
    offer.revealed = true;
    offer.jobs = offer.defectRepairIds.map((id) => {
      const def = DEFS.repairs.find((r) => r.id === id)!;
      return { repairId: id, stepIndex: 0, stepRemainingMinutes: def.steps[0]!.durationMinutes, done: false };
    });
    const missing = OrderSystem.missingToolsForOrder(game.ctx, offer);
    expect(missing).toContain('timing_tool');
    expect(missing).toContain('spring_compressor');
    game.state.economy.balanceCents = 100_000_000;
    game.buyTool('timing_tool');
    expect(OrderSystem.missingToolsForOrder(game.ctx, offer)).toEqual(['spring_compressor']);
  });

  it('toolPromptShown ist initial false (Modal nur einmal)', () => {
    const game = Game.new(911);
    const offer = game.generateOffer()!;
    expect(offer.toolPromptShown).toBe(false);
  });
});

describe('Fahrzeugklassen-Sprites', () => {
  it('jede Fahrzeugklasse hat ein Sprite-Mapping', () => {
    for (const v of DEFS.vehicles) {
      expect(CLASS_SPRITES[v.vehicleClass]).toBeTruthy();
    }
  });

  it('alle fünf Klassen-Sprites sind vorhanden', () => {
    expect(Object.keys(CLASS_SPRITES)).toEqual(
      expect.arrayContaining(['kleinwagen', 'limousine', 'suv', 'pickup', 'transporter']),
    );
  });
});

describe('Save-Migration v6 → v7', () => {
  it('ergänzt toolPromptShown und korrigiert den Pausenraum-Interaktionspunkt', () => {
    const game = Game.new(920);
    const raw = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    raw.version = 6;
    const orders = raw.orders as Array<Record<string, unknown>>;
    for (const o of orders) delete o.toolPromptShown;
    const stations = raw.stations as Array<Record<string, unknown>>;
    const br = stations.find((s) => s.id === 'break_room')!;
    br.interact = { x: 3, y: 12 }; // alter Punkt wäre jetzt eine Wand
    const migrated = migrate(raw);
    expect(migrated.version).toBe(9);
    expect((migrated.orders as Array<Record<string, unknown>>)[0]!.toolPromptShown).toBe(false);
    const mbr = (migrated.stations as Array<Record<string, unknown>>).find((s) => s.id === 'break_room')!;
    expect(mbr.interact).toEqual({ x: 3, y: 9 });
  });
});
