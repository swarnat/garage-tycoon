import { expect, it, vi } from 'vitest';
import { Game } from '../src/core/Game';
import { UI } from '../src/ui/UI';

function fixture() {
  const game = Game.new(42);
  const ui: UI = Object.assign(Object.create(UI.prototype), {
    getGame: () => game, invSearch: '', invCategory: 'brake_pads',
    highlightParts: new Set(), root: { querySelector: () => null }, refresh: vi.fn(),
  });
  return { game, ui };
}

it('findet auch verborgene Varianten außerhalb der gewählten Kategorie und filtert andere aus', () => {
  const { game, ui } = fixture();
  const part = game.defs.parts.find((p) => p.id === 'motor_oil__5W30__standard')!;
  game.state.inventory.stock[part.id] = 0;
  game.state.inventory.minStock[part.id] = 0;
  ui['invSearch'] = part.name.toUpperCase();
  ui['invShowAll'] = true;
  const html = ui['renderInventory']();
  expect(html).toContain(`data-part="${part.id}"`);
  expect(html).not.toContain('data-part="brake_pads__M__standard"');
});

it('zeigt beim Bestelllink nur fehlende Varianten aus allen Kategorien, markiert sie und ignoriert alte Filter', () => {
  const { game, ui } = fixture();
  const order = game.state.orders[0]!;
  const ids = ['motor_oil__5W30__standard', 'brake_pads__M__premium', 'brake_pads__M__standard'];
  game.state.inventory.stock[ids[0]!] = 0;
  order.partsNeeded = ids.map((partId) => ({ partId, quantity: 1 }));
  game.state.inventory.stock[ids[2]!] = 1;
  ui['invSearch'] = 'kein Treffer';
  ui['invShowUsage'] = true;
  ui['modalMinimized'] = true;
  const button = { dataset: { action: 'order-missing', id: order.id } };
  ui['onClick']({ target: { closest: () => button } } as unknown as Event);
  const html = ui['renderInventory']();
  expect(ui['modalMinimized']).toBe(false);
  expect(html).toContain('Fehlende Varianten');
  expect(html.match(/<tr class="highlight/g)).toHaveLength(2);
  expect(html).toContain(`data-part="${ids[0]}"`);
  expect(html).toContain(`data-part="${ids[1]}"`);
  expect(html).not.toContain(`data-part="${ids[2]}"`);
});
