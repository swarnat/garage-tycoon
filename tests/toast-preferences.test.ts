import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { notify } from '../src/simulation/context';
import { ToastPreferences } from '../src/ui/ToastPreferences';

function testStorage() {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}

it('filtert Einblendungen nach Ursache statt Schweregrad und lässt den Verlauf unverändert', () => {
  const game = Game.new(42);
  game.state.notifications.length = 0;
  const prefs = new ToastPreferences(testStorage());
  notify(game.ctx, 'warning', 'Teil fehlt', 'stock', 'brake_pads__M__standard');
  notify(game.ctx, 'warning', 'Entscheidung nötig', 'events');
  prefs.set('stock', false);
  expect(prefs.visible(game.state.notifications).map((n) => n.text)).toEqual(['Entscheidung nötig']);
  expect(game.state.notifications[0]?.partId).toBe('brake_pads__M__standard');
  prefs.set('stock', true);
  expect(prefs.visible(game.state.notifications)).toHaveLength(2);
});

it('behält die Auswahl beim Neuladen und behandelt alte Meldungen als Sonstiges', () => {
  const storage = testStorage();
  const old = { id: 1, atMinute: 480, kind: 'info' as const, text: 'Alte Meldung' };
  const prefs = new ToastPreferences(storage);
  expect(prefs.visible([old])).toEqual([old]);
  prefs.set('system', false);
  const reloaded = new ToastPreferences(storage);
  expect(reloaded.visible([old])).toEqual([]);
  expect(reloaded.enabled('events')).toBe(true);
});

it('führt abgeschaltete Meldungen nicht auf Kosten sichtbarer Meldungen im Popup-Limit', () => {
  const game = Game.new(42);
  game.state.notifications.length = 0;
  const prefs = new ToastPreferences(testStorage());
  prefs.set('stock', false);
  notify(game.ctx, 'success', 'Lieferung da', 'deliveries');
  for (let i = 0; i < 6; i++) notify(game.ctx, 'warning', 'Teil fehlt', 'stock');
  expect(prefs.visible(game.state.notifications).map((n) => n.text)).toEqual(['Lieferung da']);
});
