import { describe, expect, it } from 'vitest';
import { Game, createNewGame } from '../src/core/Game';
import { DEFS } from '../src/data';
import { resolveVariant, qualityForProfile, delayChance } from '../src/simulation/PartsResolver';
import { RepairSystem } from '../src/simulation/RepairSystem';
import { DIAGNOSIS_FEE_CENTS } from '../src/entities/types';
import { migrate } from '../src/persistence/SaveMigration';

function stockEverything(game: Game, qty = 20): void {
  for (const k of Object.keys(game.state.inventory.stock)) game.state.inventory.stock[k] = qty;
  game.state.inventory.capacity = 5000;
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

const model = (id: string) => DEFS.vehicles.find((v) => v.id === id)!;

describe('Varianten-Auflösung nach Fahrzeug-Steckbrief', () => {
  it('Reifengröße unterscheidet Kleinwagen, Transporter und Sportwagen', () => {
    const game = Game.new(1500);
    const klein = resolveVariant(game.ctx, 'tires', model('opel_corsa'), 'regular')!;
    const trans = resolveVariant(game.ctx, 'tires', model('ford_transit'), 'regular')!;
    const sport = resolveVariant(game.ctx, 'tires', model('porsche_911'), 'regular')!;
    expect(klein.spec).toBe('14');
    expect(trans.spec).toBe('16C');
    expect(sport.spec).toBe('18');
    expect(klein.id).not.toBe(trans.id);
  });

  it('Bremsscheiben-Größen und Öl-Specs folgen dem Modell', () => {
    const game = Game.new(1501);
    expect(resolveVariant(game.ctx, 'brake_discs', model('opel_corsa'), 'regular')!.spec).toBe('240');
    expect(resolveVariant(game.ctx, 'brake_discs', model('porsche_911'), 'regular')!.spec).toBe('320');
    expect(resolveVariant(game.ctx, 'motor_oil', model('ford_transit'), 'regular')!.spec).toBe('10W40');
    expect(resolveVariant(game.ctx, 'motor_oil', model('porsche_911'), 'regular')!.spec).toBe('0W40');
  });

  it('Qualitätsklasse folgt dem Kundenprofil', () => {
    expect(qualityForProfile('price_sensitive')).toBe('budget');
    expect(qualityForProfile('quality_oriented')).toBe('premium');
    expect(qualityForProfile('regular')).toBe('standard');
    const game = Game.new(1502);
    expect(resolveVariant(game.ctx, 'brake_pads', model('vw_golf'), 'price_sensitive')!.quality).toBe('budget');
    expect(resolveVariant(game.ctx, 'brake_pads', model('vw_golf'), 'quality_oriented')!.quality).toBe('premium');
  });

  it('Felgen gibt es in Stahl / Alu / Premium-Alu je Größe', () => {
    const rims = DEFS.parts.filter((p) => p.category === 'rims');
    const qualities = new Set(rims.map((r) => r.quality));
    expect(qualities).toEqual(new Set(['budget', 'standard', 'premium']));
    expect(rims.some((r) => r.spec === '16C')).toBe(true);
    expect(rims.find((r) => r.quality === 'budget')!.name).toContain('Stahl');
  });

  it('Diagnose löst Defekte auf konkrete Varianten auf', () => {
    const game = Game.new(1503);
    stockEverything(game);
    const offer = accept(game);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    v.modelId = 'opel_corsa';
    const customer = game.state.customers.find((c) => c.id === offer.customerId)!;
    customer.profile = 'regular';
    runUntil(game, () => offer.revealed, 1440);
    expect(offer.partsNeeded.length).toBeGreaterThan(0);
    expect(offer.partsNeeded[0]!.partId).toBe('brake_pads__S__standard');
  });
});

describe('Teile-fehlt-Modal und Aufschub', () => {
  it('parts:missing wird einmalig ausgelöst', () => {
    const game = Game.new(1510);
    stockEverything(game);
    const offer = accept(game);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    v.modelId = 'opel_corsa';
    const customer = game.state.customers.find((c) => c.id === offer.customerId)!;
    customer.profile = 'regular';
    game.state.inventory.stock['brake_pads__S__standard'] = 0;
    game.state.inventory.minStock['brake_pads__S__standard'] = 0;
    game.state.inventory.autoReorder['brake_pads__S__standard'] = false;
    let fired = 0;
    game.bus.on('parts:missing', () => { fired += 1; });
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    game.tick(120);
    expect(fired).toBe(1);
    expect(offer.partsPromptShown).toBe(true);
  });

  it('Aufschub angenommen: Termin +1 Tag (regular) und Bestellung ausgelöst', () => {
    const game = Game.new(1511);
    stockEverything(game);
    const offer = accept(game);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    v.modelId = 'opel_corsa';
    const customer = game.state.customers.find((c) => c.id === offer.customerId)!;
    customer.profile = 'regular';
    game.state.inventory.stock['brake_pads__S__standard'] = 0;
    game.state.inventory.minStock['brake_pads__S__standard'] = 0;
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    const dueBefore = offer.dueAtMinute;
    game.rng.chance = () => true;
    expect(game.requestPartsDelay(offer.id, 'teileprofi')).toBe('accepted');
    expect(offer.dueAtMinute).toBe(dueBefore + 1440);
    expect(game.state.deliveries.some((d) => d.partId === 'brake_pads__S__standard')).toBe(true);
  });

  it('Aufschub abgelehnt: Kunde geht, Auftrag storniert', () => {
    const game = Game.new(1512);
    stockEverything(game);
    const offer = accept(game);
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    v.modelId = 'vw_golf';
    const customer = game.state.customers.find((c) => c.id === offer.customerId)!;
    customer.profile = 'regular';
    game.state.inventory.stock['brake_pads__M__standard'] = 0;
    game.state.inventory.minStock['brake_pads__M__standard'] = 0;
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    game.rng.chance = () => false;
    expect(game.requestPartsDelay(offer.id, 'teileprofi')).toBe('rejected');
    expect(offer.status).toBe('cancelled');
    expect(offer.cancelReason).toContain('Aufschub');
  });

  it('zeitkritische Kunden gewähren nur 6 h Aufschub', () => {
    const game = Game.new(1513);
    stockEverything(game);
    const offer = accept(game);
    const customer = game.state.customers.find((c) => c.id === offer.customerId)!;
    customer.profile = 'time_critical';
    const vid = offer.partsNeeded[0]?.partId;
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    if (offer.status === 'waiting_for_parts' && vid) {
      const dueBefore = offer.dueAtMinute;
      game.rng.chance = () => true;
      game.requestPartsDelay(offer.id, 'expressparts');
      expect(offer.dueAtMinute).toBe(dueBefore + 360);
    }
  });

  it('Aufschub-Chance hängt von Profil und Reputation ab', () => {
    const game = Game.new(1514);
    const regular = delayChance(game.state, 'regular', null);
    const critical = delayChance(game.state, 'time_critical', null);
    expect(regular).toBeGreaterThan(critical);
    game.state.reputation = 100;
    expect(delayChance(game.state, 'regular', 90)).toBeGreaterThan(regular);
  });
});

describe('Express-Aufpreis zahlt die Werkstatt', () => {
  it('Rechnung enthält keine Versandkosten oder Express-Aufschlag', () => {
    const game = Game.new(1520);
    stockEverything(game);
    const offer = accept(game, 'replace_brake_caliper');
    const v = game.state.vehicles.find((x) => x.id === offer.vehicleId)!;
    v.modelId = 'vw_golf';
    const customer = game.state.customers.find((c) => c.id === offer.customerId)!;
    customer.profile = 'regular';
    const vid = 'brake_caliper__M__standard';
    game.state.inventory.stock[vid] = 0;
    game.state.inventory.minStock[vid] = 0;
    runUntil(game, () => offer.status === 'waiting_for_parts', 1440);
    game.orderMissingParts(offer.id, 'expressparts');
    runUntil(game, () => offer.status === 'delivered');
    expect(offer.status).toBe('delivered');
    const expected =
      Math.round((offer.laborMinutesActual / 60) * game.state.economy.hourlyRateCents) +
      RepairSystem.partsSellTotal(game.ctx, offer) +
      DIAGNOSIS_FEE_CENTS;
    expect(offer.invoiceCents).toBe(expected);
  });
});

describe('Neues Spiel & Migration mit Varianten', () => {
  it('Startbestand enthält einen Satz Kompakt-Reifen', () => {
    const s = createNewGame(1530);
    expect(s.inventory.stock['tires__15__standard']).toBe(4);
    expect(s.inventory.lastOrdered).toEqual({});
    expect(s.inventory.pinned).toEqual({});
  });

  it('Migration v10 → v11 überträgt Bestand auf Standard-Varianten', () => {
    const game = Game.new(1531);
    const raw = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    raw.version = 10;
    const inv = raw.inventory as Record<string, unknown>;
    inv.stock = { brake_pads: 5, motor_oil: 2 };
    inv.minStock = { brake_pads: 3 };
    inv.autoReorder = { brake_pads: true };
    inv.usageLog = [{ partId: 'brake_pads__M__standard', quantity: 1, atMinute: 100 }];
    delete inv.lastOrdered;
    delete inv.pinned;
    raw.deliveries = [{ id: 'd1', partId: 'brake_pads__M__standard', quantity: 1, supplierId: 'teileprofi', orderedAtMinute: 0, arriveAtMinute: 480, costCents: 100, done: false }];
    const migrated = migrate(raw);
    expect(migrated.version).toBe(12);
    const mi = migrated.inventory as Record<string, Record<string, unknown>>;
    expect(mi.stock!['brake_pads__M__standard']).toBe(5);
    expect(mi.stock!['motor_oil__5W30__standard']).toBe(2);
    expect(mi.minStock!['brake_pads__M__standard']).toBe(3);
    expect(mi.autoReorder!['brake_pads__M__standard']).toBe(true);
    expect(mi.lastOrdered).toEqual({});
    expect((migrated.deliveries as Array<Record<string, unknown>>)[0]!.partId).toBe('brake_pads__M__standard');
  });
});
