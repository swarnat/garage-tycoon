import { expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { UI } from '../src/ui/UI';

it('ordnet Bedarf, Bestand, Fehlmenge und Stückpreis jeweils einer Spalte zu', () => {
  const game = Game.new(42);
  const order = game.state.orders[0]!;
  const partId = 'brake_pads__M__standard';
  game.state.inventory.stock[partId] = 1;
  order.partsNeeded = [{ partId, quantity: 4 }];
  const ui: UI = Object.assign(Object.create(UI.prototype), { getGame: () => game, partsOrderId: order.id });
  const html = ui['renderPartsPrompt']();
  expect(html).toContain('<th scope="col">Benötigte Variante</th>');
  expect([...html.matchAll(/<th scope="col" class="num(?: shortage)?">([^<]+)<\/th>/g)].map((match) => match[1]))
    .toEqual(['Bedarf', 'Verfügbar', 'Fehlt', 'EK/Stk.']);
  expect(html).toContain('<td class="num">4</td><td class="num">1</td><td class="num shortage"><strong>3</strong></td>');
  expect(html.match(/Termin:/g)).toHaveLength(1);
});
