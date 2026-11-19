import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { SaveManager, SaveError } from '../src/core/SaveManager';
import type { GameState } from '../src/entities/types';

class MemoryStorage {
  private map = new Map<string, string>();
  failOnSet = false;
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failOnSet) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('Savegame-Serialisierung', () => {
  it('Roundtrip erhält den vollständigen Zustand', () => {
    const game = Game.new(55);
    const offer = game.generateOffer()!;
    game.acceptOrder(offer.id);
    game.tick(300);
    const json = SaveManager.serialize(game.state);
    const restored = SaveManager.parse(json);
    expect(restored.totalMinutes).toBe(game.state.totalMinutes);
    expect(restored.economy.balanceCents).toBe(game.state.economy.balanceCents);
    expect(restored.orders.map((o) => o.status)).toEqual(
      game.state.orders.map((o) => o.status),
    );
    expect(restored.rngState).toBe(game.state.rngState);
  });

  it('geladener Spielstand läuft konsistent weiter (Determinismus)', () => {
    const a = Game.new(55);
    const oa = a.generateOffer()!;
    a.acceptOrder(oa.id);
    a.tick(200);
    const restored = SaveManager.parse(SaveManager.serialize(a.state));
    const b = new Game(restored);
    a.tick(500);
    b.tick(500);
    expect(a.state.economy.balanceCents).toBe(b.state.economy.balanceCents);
    expect(a.state.totalMinutes).toBe(b.state.totalMinutes);
    expect(a.state.orders.map((o) => o.status)).toEqual(
      b.state.orders.map((o) => o.status),
    );
    expect(a.state.workers.map((w) => w.pos)).toEqual(
      b.state.workers.map((w) => w.pos),
    );
  });
});

describe('Importvalidierung', () => {
  it('lehnt kaputtes JSON ab', () => {
    expect(() => SaveManager.parse('{kaputt')).toThrow(SaveError);
  });

  it('lehnt fehlende Felder ab', () => {
    expect(() => SaveManager.parse('{"version":1}')).toThrow(SaveError);
  });

  it('lehnt unbekannte zukünftige Versionen ab', () => {
    const game = Game.new(1);
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.version = 999;
    expect(() => SaveManager.parse(JSON.stringify(raw))).toThrow(SaveError);
  });

  it('erkennt ungültige Referenzen zwischen Auftrag und Fahrzeug', () => {
    const game = Game.new(1);
    game.generateOffer();
    const raw = JSON.parse(SaveManager.serialize(game.state)) as GameState;
    raw.orders[0]!.vehicleId = 'gibt-es-nicht';
    expect(() => SaveManager.parse(JSON.stringify(raw))).toThrow(SaveError);
  });

  it('erkennt ungültige Auftragsstatus', () => {
    const game = Game.new(1);
    game.generateOffer();
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.orders[0].status = 'fantasie';
    expect(() => SaveManager.parse(JSON.stringify(raw))).toThrow(SaveError);
  });

  it('erkennt nicht-ganzzahlige Geldbeträge', () => {
    const game = Game.new(1);
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.economy.balanceCents = 12.5;
    expect(() => SaveManager.parse(JSON.stringify(raw))).toThrow(SaveError);
  });

  it('erkennt Reservierungen über Bestand', () => {
    const game = Game.new(1);
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.inventory.reserved['brake_pads'] = 9999;
    expect(() => SaveManager.parse(JSON.stringify(raw))).toThrow(SaveError);
  });
});

describe('Savegame-Migration', () => {
  it('migriert Version 0 auf Version 1 mit Default-Feldern', () => {
    const game = Game.new(1);
    const raw = JSON.parse(SaveManager.serialize(game.state));
    raw.version = 0;
    delete raw.notifications;
    delete raw.nextNotificationId;
    const migrated = SaveManager.parse(JSON.stringify(raw));
    expect(migrated.version).toBe(1);
    expect(Array.isArray(migrated.notifications)).toBe(true);
    expect(typeof migrated.nextNotificationId).toBe('number');
  });
});

describe('localStorage-Adapter', () => {
  it('speichert und lädt', () => {
    const storage = new MemoryStorage();
    const game = Game.new(3);
    expect(SaveManager.save(game.state, storage)).toBe(true);
    const loaded = SaveManager.load(storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.seed).toBe(3);
  });

  it('behandelt Speicherfehler ohne Absturz', () => {
    const storage = new MemoryStorage();
    storage.failOnSet = true;
    const game = Game.new(3);
    expect(SaveManager.save(game.state, storage)).toBe(false);
  });

  it('liefern null bei leerem oder defektem Speicher', () => {
    const storage = new MemoryStorage();
    expect(SaveManager.load(storage)).toBeNull();
    storage.setItem('garage-tycoon-save', '{defekt');
    expect(SaveManager.load(storage)).toBeNull();
  });

  it('löscht den Spielstand', () => {
    const storage = new MemoryStorage();
    const game = Game.new(3);
    SaveManager.save(game.state, storage);
    SaveManager.clear(storage);
    expect(SaveManager.load(storage)).toBeNull();
  });
});
