import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { InventorySystem } from '../src/simulation/InventorySystem';
import { UI } from '../src/ui/UI';

it('zeigt Lagerbestand, offene Liefermengen und freien Platz im Lagerfenster', () => {
  const game = Game.new(42);
  const s = game.state;
  const partId = 'brake_pads__M__standard';
  const stock = InventorySystem.totalStock(s.inventory);
  s.inventory.capacity = stock + 5;
  expect(game.orderParts(partId, 3, 'teileprofi')).toBe(true);
  s.deliveries.push({ ...s.deliveries[0]!, id: 'done', quantity: 20, done: true });
  const ui: UI = Object.assign(Object.create(UI.prototype), {
    getGame: () => game, highlightParts: new Set(), invCategory: 'brake_pads', invSearch: '',
  });
  const html = () => ui['renderInventory']();
  expect(html()).toContain(`${stock} im Lager · 3 unterwegs · 2 frei`);
  expect(html()).not.toContain('Lager voll');
  expect(game.orderParts(partId, 2, 'teileprofi')).toBe(true);
  expect(html()).toContain(`${stock} im Lager · 5 unterwegs · 0 frei`);
  expect(html()).toContain('Lager voll');
});
