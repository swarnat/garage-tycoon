import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { SaveManager } from '../src/core/SaveManager';
import { SAVE_KEY } from '../src/persistence/LocalStorageAdapter';
import { idbGet } from '../src/persistence/IndexedDBAdapter';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

let originalLocalStorage: PropertyDescriptor | undefined;
let originalIDB: PropertyDescriptor | undefined;

beforeEach(() => {
  originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
  originalIDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
});

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
  if (originalIDB) {
    Object.defineProperty(globalThis, 'indexedDB', originalIDB);
  }
});

describe('IndexedDB-Speicherung', () => {
  it('speichert und lädt über IndexedDB und räumt localStorage ab', async () => {
    const game = Game.new(31);
    game.tick(120);
    localStorage.setItem(SAVE_KEY, 'alter-stand');
    expect(await SaveManager.saveAsync(game.state)).toBe(true);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    const loaded = await SaveManager.loadAsync();
    expect(loaded).not.toBeNull();
    expect(loaded!.totalMinutes).toBe(game.state.totalMinutes);
    expect(loaded!.economy.balanceCents).toBe(game.state.economy.balanceCents);
  });

  it('migriert einen alten localStorage-Stand nach IndexedDB', async () => {
    const game = Game.new(32);
    localStorage.setItem(SAVE_KEY, SaveManager.serialize(game.state));
    const loaded = await SaveManager.loadAsync();
    expect(loaded).not.toBeNull();
    expect(loaded!.seed).toBe(32);
    expect(await idbGet(SAVE_KEY)).not.toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it('bevorzugt den neueren Stand anhand savedAt', async () => {
    const older = Game.new(33);
    const newer = Game.new(34);
    newer.tick(500);
    const olderJson = SaveManager.serialize(older.state);
    const newerRaw = JSON.parse(SaveManager.serialize(newer.state));
    newerRaw.savedAt = Date.now() + 10_000; // eindeutig neuerer Zeitstempel
    const newerJson = JSON.stringify(newerRaw);
    // IDB enthält den älteren, localStorage den neueren Stand
    await SaveManager.saveAsync(older.state);
    localStorage.setItem(SAVE_KEY, newerJson);
    const loaded = await SaveManager.loadAsync();
    expect(loaded!.seed).toBe(34);
    expect(olderJson).not.toBe(newerJson);
  });

  it('fällt auf localStorage zurück, wenn IndexedDB fehlt', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const game = Game.new(35);
    expect(await SaveManager.saveAsync(game.state)).toBe(true);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    const loaded = await SaveManager.loadAsync();
    expect(loaded).not.toBeNull();
    expect(loaded!.seed).toBe(35);
  });

  it('clearAsync löscht beide Speicher', async () => {
    const game = Game.new(36);
    await SaveManager.saveAsync(game.state);
    localStorage.setItem(SAVE_KEY, SaveManager.serialize(game.state));
    await SaveManager.clearAsync();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(await idbGet(SAVE_KEY)).toBeNull();
    expect(await SaveManager.loadAsync()).toBeNull();
  });
});
