import type { SimContext } from './context';
import { notify, partDef } from './context';
import { InventorySystem } from './InventorySystem';
import { EconomySystem } from './EconomySystem';

/** Bestellungen und Lieferungen. */
export class SupplierSystem {
  static orderParts(
    ctx: SimContext,
    partId: string,
    quantity: number,
    supplierId: string,
  ): boolean {
    const part = ctx.defs.parts.find((p) => p.id === partId);
    const supplier = ctx.defs.suppliers.find((s) => s.id === supplierId);
    if (!part || !supplier || quantity <= 0 || !Number.isInteger(quantity)) {
      return false;
    }
    const cost =
      Math.round(part.buyCents * supplier.priceFactor) * quantity +
      supplier.shippingCents;
    if (ctx.state.economy.balanceCents < cost) {
      notify(ctx, 'danger', `Bestellung ${part.name}: Kontostand reicht nicht.`);
      return false;
    }
    if (
      InventorySystem.totalStock(ctx.state.inventory) + quantity >
      ctx.state.inventory.capacity
    ) {
      notify(ctx, 'warning', `Lager voll: ${part.name} passt nicht mehr ins Lager.`);
      return false;
    }
    const id = `po-${ctx.state.nextId++}`;
    EconomySystem.book(ctx.state.economy, {
      id,
      day: Math.floor(ctx.state.totalMinutes / 1440) + 1,
      atMinute: ctx.state.totalMinutes,
      amountCents: -cost,
      category: 'parts_purchase',
      label: `${quantity}× ${part.name} (${supplier.name})`,
    });
    ctx.state.statistics.totalPartsCostCents += cost;
    ctx.state.deliveries.push({
      id,
      partId,
      quantity,
      supplierId,
      orderedAtMinute: ctx.state.totalMinutes,
      arriveAtMinute: ctx.state.totalMinutes + supplier.leadMinutes,
      costCents: cost,
      done: false,
    });
    ctx.bus.emit('parts:ordered', { partId, quantity, supplierId });
    notify(
      ctx,
      'info',
      `Bestellt: ${quantity}× ${part.name} bei ${supplier.name} (Lieferung in ${Math.round(supplier.leadMinutes / 60)} h, ${(cost / 100).toFixed(2)} €)`,
    );
    return true;
  }

  static update(ctx: SimContext): void {
    for (const d of ctx.state.deliveries) {
      if (d.done || d.arriveAtMinute > ctx.state.totalMinutes) continue;
      d.done = true;
      const inv = ctx.state.inventory;
      inv.stock[d.partId] = (inv.stock[d.partId] ?? 0) + d.quantity;
      ctx.bus.emit('parts:delivered', d);
      notify(
        ctx,
        'success',
        `Lieferung eingetroffen: ${d.quantity}× ${partDef(ctx, d.partId).name}`,
      );
    }
    if (ctx.state.deliveries.length > 60) {
      ctx.state.deliveries = ctx.state.deliveries.filter((d) => !d.done).slice(-40);
    }
  }
}
