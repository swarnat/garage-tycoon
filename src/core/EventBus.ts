export type GameEvent =
  | 'order:created'
  | 'order:accepted'
  | 'order:declined'
  | 'order:cancelled'
  | 'diagnosis:completed'
  | 'estimate:approved'
  | 'estimate:rejected'
  | 'approval:at-risk'
  | 'parts:ordered'
  | 'parts:delivered'
  | 'parts:low'
  | 'repair:started'
  | 'repair:completed'
  | 'quality_check:completed'
  | 'order:completed'
  | 'invoice:paid'
  | 'order:delivered'
  | 'worker:available'
  | 'day:started'
  | 'liquidity:warning'
  | 'save:completed'
  | 'upgrade:purchased';

type Handler = (payload: unknown) => void;

/** Einfacher typisierter Event-Bus für Simulation → UI. */
export class EventBus {
  private handlers = new Map<GameEvent, Set<Handler>>();

  on(event: GameEvent, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  emit(event: GameEvent, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) h(payload);
  }
}
