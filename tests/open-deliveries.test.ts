import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { UI } from '../src/ui/UI';

it('zeigt im Lager offene Bestellungen aller Kategorien nach Ankunft sortiert', () => {
  const game = Game.new(42);
  const [supplier] = game.defs.suppliers;
  const brake = game.defs.parts.find((p) => p.id === 'brake_pads__M__standard')!;
  const oil = game.defs.parts.find((p) => p.id === 'motor_oil__5W30__standard')!;
  const delivery = { supplierId: supplier!.id, quantity: 2, orderedAtMinute: 480, costCents: 9900 };
  game.state.deliveries.push(
    { ...delivery, id: 'a', partId: brake.id, arriveAtMinute: 720, done: false },
    { ...delivery, id: 'b', partId: oil.id, arriveAtMinute: 540, done: false },
    { ...delivery, id: 'c', partId: brake.id, arriveAtMinute: 500, quantity: 99, done: true },
  );
  const ui: UI = Object.assign(Object.create(UI.prototype), {
    getGame: () => game, invSearch: '', invCategory: 'brake_pads', highlightParts: new Set(),
  });
  const sidebar = ui['renderInventory']().match(/<aside class="inv-deliveries"[\s\S]+?<\/aside>/)?.[0] ?? '';
  expect(sidebar).toContain('Offene Bestellungen');
  expect(sidebar).toContain(supplier!.name);
  expect(sidebar).toContain('Tag 1 · 09:00');
  expect(sidebar).toContain(`2× ${oil.name}`);
  expect(sidebar).toContain(`2× ${brake.name}`);
  expect(sidebar.indexOf(oil.name)).toBeLessThan(sidebar.indexOf(brake.name));
  expect(sidebar).not.toContain('99×');
  game.state.deliveries.forEach((d) => { d.done = true; });
  expect(ui['renderInventory']()).toContain('Keine offenen Bestellungen.');
});
