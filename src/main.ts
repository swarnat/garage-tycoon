import './styles/main.css';
import { Game } from './core/Game';
import { SaveManager } from './core/SaveManager';
import { Renderer, type Selection } from './rendering/Renderer';
import { UI, type UIActions } from './ui/UI';
import { OrderSystem } from './simulation/OrderSystem';
import { notify } from './simulation/context';

declare global {
  interface Window {
    __garage?: { readonly game: Game };
  }
}

let game: Game;
let renderer: Renderer;
let ui: UI;
let lastSpeed = 1;
let lastFrame = performance.now();
let lastAutosave = performance.now();
let lastSaveAttempt = 0;
let saveDirty = false;

async function saveNow(): Promise<void> {
  const ok = await SaveManager.saveAsync(game.state);
  ui.flashSaveIndicator(ok);
  lastAutosave = performance.now();
  lastSaveAttempt = performance.now();
  saveDirty = false;
}

function bindBus(): void {
  game.bus.on('upgrade:purchased', () => renderer.rebuildStatic());
  game.bus.on('invoice:paid', () => { saveDirty = true; });
  game.bus.on('parts:delivered', () => { saveDirty = true; });
  game.bus.on('order:accepted', () => { saveDirty = true; });
  game.bus.on('order:delivered', () => { saveDirty = true; });
}

function replaceGame(next: Game, message: string): void {
  game = next;
  bindBus();
  renderer.rebuildStatic();
  renderer.resetCamera();
  renderer.setSelection(null);
  ui.openPanel('orders');
  notify(game.ctx, 'info', message);
  saveNow();
  ui.refresh(true);
}

const actions: UIActions = {
  acceptOrder: (id) => { game.acceptOrder(id); },
  declineOrder: (id) => { game.declineOrder(id); },
  cancelOrder: (id) => {
    const o = game.state.orders.find((x) => x.id === id);
    if (o) {
      OrderSystem.cancelOrder(game.ctx, o, 'Vom Spieler storniert');
      notify(game.ctx, 'warning', `Auftrag ${id} storniert.`);
    }
  },
  togglePriority: (id) => {
    const o = game.state.orders.find((x) => x.id === id);
    if (o) o.priority = o.priority > 1 ? 1 : 2;
  },
  orderParts: (partId, qty, supplierId) => { game.orderParts(partId, qty, supplierId); },
  setSpeed: (n) => { game.setSpeed(n); lastSpeed = n; },
  togglePause: () => {
    if (game.state.speed === 0) {
      game.setSpeed(lastSpeed || 1);
    } else {
      lastSpeed = game.state.speed;
      game.setSpeed(0);
    }
  },
  select: (sel: Selection | null) => {
    ui.setSelection(sel);
    renderer.setSelection(sel);
  },
  saveNow,
  exportSave: () => {
    const blob = new Blob([SaveManager.serialize(game.state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `garage-tycoon-tag${Math.floor(game.state.totalMinutes / 1440) + 1}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  importSave: (file: File) => {
    file.text().then((text) => {
      try {
        const state = SaveManager.parse(text);
        replaceGame(new Game(state), 'Spielstand importiert.');
      } catch (err) {
        notify(game.ctx, 'danger', `Import fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
        ui.refresh(true);
      }
    });
  },
  resetGame: () => {
    if (!window.confirm('Spielstand wirklich löschen und ein neues Spiel starten?')) return;
    void SaveManager.clearAsync().then(() => {
      replaceGame(Game.new(), 'Neues Spiel gestartet. Viel Erfolg!');
    });
  },
  buyLift: () => { game.buyLift(); },
  buyDiagnosisBay: () => { game.buyDiagnosisBay(); },
  expandStorage: () => { game.expandStorage(); },
  setHourlyRate: (v) => { game.setHourlyRate(v); },
  setPartsMarkup: (v) => { game.setPartsMarkup(v); },
  setMinStock: (partId, v) => {
    game.state.inventory.minStock[partId] = Math.max(0, Math.min(20, Math.round(v)));
  },
  setWorkerSpeed: (id, delta) => {
    const w = game.state.workers.find((x) => x.id === id);
    if (w) game.setWorkerSpeed(id, w.speedTilesPerMinute + delta);
  },
  resetCamera: () => renderer.resetCamera(),
  hireCandidate: (id) => { game.hireCandidate(id); },
  fireWorker: (id) => { game.fireWorker(id); },
  trainWorker: (id, skill) => { game.trainWorker(id, skill as Parameters<Game['trainWorker']>[1]); },
  refreshCandidates: () => { game.refreshCandidates(); },
  toggleAuto: (partId) => { game.toggleAutoReorder(partId); },
  setAutoSupplier: (id) => { game.setAutoSupplier(id); },
};

function advanceSimulation(now: number): void {
  const dt = Math.min(2, (now - lastFrame) / 1000);
  lastFrame = now;
  if (game.state.speed > 0) {
    game.tick(game.realSecondsToGameMinutes(dt));
  }
  // Autosave: alle 30 s oder zeitnah nach wichtigen Ereignissen
  if (
    now - lastAutosave > 30000 ||
    (saveDirty && now - lastSaveAttempt > 5000)
  ) {
    void saveNow();
  }
}

function frame(now: number): void {
  advanceSimulation(now);
  renderer.update(now / 1000);
  ui.refresh();
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  const loaded = await SaveManager.loadAsync();
  game = loaded ? new Game(loaded) : Game.new();
  ui = new UI(document.getElementById('app') as HTMLElement, () => game, actions);
  renderer = new Renderer(
    () => game,
    (sel) => {
      ui.setSelection(sel);
      renderer.setSelection(sel);
    },
  );
  await renderer.init(ui.canvasHost);
  bindBus();
  window.__garage = {
    get game() {
      return game;
    },
  };
  notify(
    game.ctx,
    'info',
    loaded
      ? 'Spielstand geladen. Willkommen zurück!'
      : 'Neues Spiel gestartet. Nimm den ersten Auftrag an!',
  );
  ui.refresh(true);

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      actions.togglePause();
      ui.refresh(true);
    } else if (e.key === '1') actions.setSpeed(1);
    else if (e.key === '2') actions.setSpeed(2);
    else if (e.key === '3') actions.setSpeed(4);
    else if (e.key === '4') actions.setSpeed(8);
    else if (e.key === 'Escape') {
      ui.closeModal();
      actions.select(null);
    }
  });
  window.addEventListener('beforeunload', () => {
    // Synchrone Notfallsicherung; beim nächsten Start wird der neuere
    // Stand (savedAt-Vergleich) automatisch nach IndexedDB migriert.
    SaveManager.save(game.state);
  });

  lastFrame = performance.now();
  requestAnimationFrame(frame);
  // Fallback: Simulation läuft weiter, wenn der Tab im Hintergrund ist
  // (Browser drosseln requestAnimationFrame in versteckten Tabs).
  setInterval(() => {
    if (document.hidden && game) {
      advanceSimulation(performance.now());
    }
  }, 500);
}

boot().catch((err) => {
  const host = document.getElementById('app');
  if (host) {
    host.innerHTML = `<div style="padding:40px;font-family:system-ui;color:#dfe5ee"><h1>Garage Tycoon konnte nicht starten</h1><pre>${String(err)}</pre></div>`;
  }
  console.error(err);
});
