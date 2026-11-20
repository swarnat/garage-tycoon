import type { SimContext } from './context';
import { VEHICLE_SPEED_TILES_PER_MINUTE } from '../entities/types';
import { OrderSystem } from './OrderSystem';
import { moveAlongPath } from './WorkerSystem';

/** Fahrzeugbewegung; Arrival-Logik liegt im OrderSystem. */
export class VehicleSystem {
  static update(ctx: SimContext, dt: number): void {
    const departures = ctx.state.orders.filter((o) => o.repairParking?.phase === 'outbound' && o.stationId);
    for (const v of ctx.state.vehicles) {
      if (
        v.state !== 'driving_in' &&
        v.state !== 'driving_to_lift' &&
        v.state !== 'driving_out'
      ) {
        continue;
      }
      if (v.path.length === 0) {
        OrderSystem.onVehicleArrived(ctx, v);
        continue;
      }
      moveAlongPath(v.pos, v.path, VEHICLE_SPEED_TILES_PER_MINUTE * dt);
      const departure = departures.find((o) => o.id === v.orderId);
      if (departure) OrderSystem.releaseParkingDeparture(ctx, departure, v);
      if (v.path.length === 0) {
        OrderSystem.onVehicleArrived(ctx, v);
      }
    }
  }
}
