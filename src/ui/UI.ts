import type { Game } from '../core/Game';
import type { RepairOrder, Worker } from '../entities/types';
import type { Selection } from '../rendering/Renderer';
import { InventorySystem } from '../simulation/InventorySystem';
import { EconomySystem } from '../simulation/EconomySystem';
import { OrderSystem } from '../simulation/OrderSystem';
import { DELAY_BY_PROFILE, delayChance } from '../simulation/PartsResolver';

export type PanelId =
  | 'workshop'
  | 'orders'
  | 'workers'
  | 'inventory'
  | 'finance'
  | 'statistics'
  | 'upgrades'
  | 'settings'
  | 'messages';

export interface UIActions {
  acceptOrder(id: string): void;
  declineOrder(id: string): void;
  cancelOrder(id: string): void;
  togglePriority(id: string): void;
  orderParts(partId: string, qty: number, supplierId: string): void;
  setSpeed(n: number): void;
  togglePause(): void;
  select(sel: Selection | null): void;
  saveNow(): void;
  exportSave(): void;
  importSave(file: File): void;
  resetGame(): void;
  buyLift(): void;
  buyDiagnosisBay(): void;
  expandStorage(): void;
  setHourlyRate(v: number): void;
  setPartsMarkup(v: number): void;
  setMinStock(partId: string, v: number): void;
  resetCamera(): void;
  offerDiscount(id: string, pct: number): void;
  acceptBudget(id: string): void;
  buyParking(): void;
  setOrderRate(v: number): void;
  setAllAuto(on: boolean): void;
  requestPartsDelay(id: string, supplierId: string): string;
  orderMissing(id: string, supplierId: string): boolean;
  declineParts(id: string): void;
  sellVariant(id: string): void;
  pinVariant(id: string): void;
  insistPrice(id: string): void;
  buyTool(id: string): void;
  takeLoan(cents: number): void;
  repayLoan(id: string, cents: number): void;
  hireCandidate(id: string): void;
  fireWorker(id: string): void;
  trainWorker(id: string, skill: string): void;
  refreshCandidates(): void;
  toggleAuto(partId: string): void;
  setAutoSupplier(id: string): void;
}

const STATUS_LABELS: Record<string, string> = {
  incoming: 'Eingehend',
  accepted: 'Angenommen',
  waiting_for_diagnosis: 'Wartet auf Diagnose',
  diagnosing: 'Diagnose läuft',
  waiting_for_approval: 'Wartet auf Freigabe',
  waiting_for_parts: 'Wartet auf Teile',
  ready_for_repair: 'Bereit zur Reparatur',
  repairing: 'In Reparatur',
  quality_check: 'Qualitätskontrolle',
  completed: 'Abgeschlossen',
  delivered: 'Ausgeliefert',
  cancelled: 'Storniert',
};

const WORKER_STATE_LABELS: Record<string, string> = {
  idle: 'Frei',
  moving: 'Unterwegs',
  diagnosing: 'Diagnose',
  repairing: 'Reparatur',
  fetching_parts: 'Holt Ersatzteile',
  quality_check: 'Qualitätskontrolle',
  waiting: 'Wartet',
  break: 'Pause',
  training: 'Weiterbildung',
  off_duty: 'Feierabend',
};

/** Kurzes Erklär-Icon mit Tooltip (Hover/Fokus). */
function help(text: string): string {
  return `<button type="button" class="help" data-help="${text.replace(/"/g, '&quot;')}">?</button>`;
}

function relTime(minutes: number): string {
  if (minutes < 60) return 'gerade eben';
  if (minutes < 1440) return `vor ${Math.round(minutes / 60)} h`;
  return `vor ${Math.round(minutes / 1440)} Tag${Math.round(minutes / 1440) === 1 ? '' : 'en'}`;
}

function tempoLabel(sp: number): string {
  return sp < 0.3 ? 'gemächlich' : sp < 0.45 ? 'normal' : 'flink';
}

const CLASS_LABELS: Record<string, string> = {
  kleinwagen: 'Kleinwagen', kompakt: 'Kompakt', mittelklasse: 'Mittelklasse',
  premium: 'Premium', suv: 'SUV', pickup: 'Pickup', transporter: 'Transporter', sport: 'Sportwagen',
};

const PROFILE_LABELS: Record<string, string> = {
  price_sensitive: 'preisbewusst',
  quality_oriented: 'qualitätsorientiert',
  time_critical: 'zeitkritisch',
  regular: 'Stammkunde',
  business: 'Geschäftskunde',
};

const TYPE_LABELS: Record<string, string> = {
  standard: 'Standardreparatur',
  maintenance: 'Wartung',
  inspection: 'Inspektion',
  diagnosis: 'Fehlerdiagnose',
  emergency: 'Notfall',
  major: 'Umfangreiche Reparatur',
};

const SKILL_LABELS: Record<string, string> = {
  engine: 'Motor',
  electrical: 'Elektrik',
  suspension: 'Fahrwerk',
  brakes: 'Bremsen',
  transmission: 'Getriebe',
  diagnosis: 'Diagnose',
};

export function eur(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gameTime(totalMinutes: number): string {
  const day = Math.floor(totalMinutes / 1440) + 1;
  const m = Math.floor(totalMinutes % 1440);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `Tag ${day} · ${hh}:${mm}`;
}

function dueLabel(order: RepairOrder, now: number): string {
  const day = Math.floor(order.dueAtMinute / 1440) + 1;
  const overdue = now > order.dueAtMinute;
  return `<span class="${overdue ? 'overdue' : ''}">Termin: Tag ${day}${overdue ? ' (überschritten!)' : ''}</span>`;
}

function statusChip(status: string): string {
  return `<span class="chip st-${status}">${STATUS_LABELS[status] ?? status}</span>`;
}

/** DOM-Oberfläche: Operate-Surface mit Statusleiste, Navigation und Detail-Drawer. */
export class UI {
  private getGame: () => Game;
  private actions: UIActions;
  private root: HTMLElement;
  private panel: PanelId = 'orders';
  private selection: Selection | null = null;
  private supplierId = 'teileprofi';
  private highlightParts = new Set<string>();
  private modalOpen = false;
  private lastRefresh = 0;
  private lastDrawerSig = '';
  private lastModalSig = '';
  private interacting = false;
  private modalKind: 'inventory' | 'tool' | 'approval' | 'parts' = 'inventory';
  private toolOrderId: string | null = null;
  private approvalOrderId: string | null = null;
  private partsOrderId: string | null = null;
  private partsSupplierId = 'teileprofi';
  private preModalSpeed = 0;
  private modalMinimized = false;
  private invCategory = 'brake_pads';
  private invSearch = '';
  private invShowAll = false;
  private lastToastId = 0;
  private toastHost!: HTMLElement;
  private drawer!: HTMLElement;
  private fileInput!: HTMLInputElement;

  constructor(root: HTMLElement, getGame: () => Game, actions: UIActions) {
    this.root = root;
    this.getGame = getGame;
    this.actions = actions;
    this.build();
  }

  private build(): void {
    this.root.innerHTML = `
      <header id="topbar">
        <div class="brand">GARAGE<span>TYCOON</span></div>
        <div class="top-stats">
          <div class="stat"><label>Kontostand</label><strong id="tb-balance"></strong></div>
          <div class="stat"><label>Spielzeit</label><strong id="tb-time"></strong></div>
          <div class="stat"><label>Reputation <button type="button" class="help" data-help="Reputation (0–100): beeinflusst Anzahl und Qualität neuer Aufträge sowie die Zahlungsbereitschaft. Steigt mit zufriedenen Kunden, sinkt bei Verspätungen und Reklamationen.">?</button></label><strong id="tb-rep"></strong></div>
          <div class="stat"><label>Aktive Aufträge</label><strong id="tb-orders"></strong></div>
        </div>
        <div class="speed-controls" id="speed-controls">
          <button data-speed="0" title="Pause (Leertaste)">⏸</button>
          <button data-speed="1">1×</button>
          <button data-speed="2">2×</button>
          <button data-speed="4">4×</button>
          <button data-speed="8">8×</button>
          <button data-speed="16">16×</button>
          <button type="button" class="help" data-help="Spieltempo: 1× = 6 Spielminuten pro Sekunde. Nachts (18–08 Uhr) automatisch 16×, solange niemand arbeitet; bei Auftragseingang und um 08:00 zurück auf 1×.">?</button>
        </div>
        <div class="save-indicator" id="save-indicator" title="Automatische Speicherung">●</div>
      </header>
      <div id="layout">
        <nav id="nav">
          <button data-panel="workshop">Werkstatt</button>
          <button data-panel="orders">Aufträge <span class="badge" id="badge-incoming"></span></button>
          <button data-panel="workers">Mitarbeiter</button>
          <button data-panel="inventory">Lager</button>
          <button data-panel="finance">Finanzen</button>
          <button data-panel="statistics">Statistiken</button>
          <button data-panel="upgrades">Ausbau</button>
          <button data-panel="messages">Meldungen</button>
          <button data-panel="settings">Einstellungen</button>
          <div class="nav-hint">Leertaste: Pause<br>Mausrad: Zoom<br>Ziehen: Verschieben<br>Klick: Details</div>
        </nav>
        <main id="canvas-host"></main>
        <aside id="drawer"></aside>
      </div>
      <div id="toasts"></div>
      <div id="modal-backdrop" class="hidden">
        <div id="modal">
          <div class="modal-head"><h2 id="modal-title">Ersatzteillager</h2><div class="btn-row"><button class="btn small" data-action="minimize-modal" title="Minimieren – Spiel läuft weiter">— Minimieren</button><button class="btn small" data-action="close-modal">✕ Schließen</button></div></div>
          <div id="modal-body"></div>
        </div>
      </div>
      <div id="modal-mini" class="hidden"><span id="modal-mini-title"></span><button class="btn small primary" data-action="restore-modal">Öffnen (Spiel pausiert)</button></div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    `;
    this.drawer = this.root.querySelector('#drawer') as HTMLElement;
    this.toastHost = this.root.querySelector('#toasts') as HTMLElement;
    this.fileInput = this.root.querySelector('#import-file') as HTMLInputElement;

    // Aktionen auf pointerdown: DOM-Neuaufbau kann den Klick nicht mehr verschlucken
    this.root.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('#drawer') || t.closest('#modal')) {
        this.interacting = true;
        // Sicherheitsnetz: falls pointerup ausbleibt, nicht dauerhaft blockieren
        setTimeout(() => { this.interacting = false; }, 1500);
      }
      this.onClick(e);
    });
    window.addEventListener('pointerup', () => { this.interacting = false; });
    // Hilfe-Tooltips als fixed-Element am Body (werden nicht vom Canvas/Drawer verdeckt)
    const showTip = (h: HTMLElement): void => {
      hideTip();
      const text = h.dataset.help;
      if (!text) return;
      const tip = document.createElement('div');
      tip.className = 'help-tooltip';
      tip.textContent = text;
      document.body.appendChild(tip);
      const r = h.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      let top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const hideTip = (): void => {
      document.querySelectorAll('.help-tooltip').forEach((t) => t.remove());
    };
    let lastHelp: HTMLElement | null = null;
    this.root.addEventListener('pointerover', (e) => {
      const h = (e.target as HTMLElement).closest('.help') as HTMLElement | null;
      if (h) { lastHelp = h; showTip(h); }
    });
    this.root.addEventListener('pointerout', (e) => {
      if ((e.target as HTMLElement).closest('.help')) { lastHelp = null; hideTip(); }
    });
    this.root.addEventListener('focusin', (e) => {
      const h = (e.target as HTMLElement).closest('.help') as HTMLElement | null;
      if (h) { lastHelp = h; showTip(h); }
    });
    this.root.addEventListener('focusout', () => { lastHelp = null; hideTip(); });
    // Scrollen (auch durch focus()) versteckt den Tooltip nicht, sondern positioniert ihn neu
    window.addEventListener('scroll', () => {
      if (lastHelp && lastHelp.isConnected) showTip(lastHelp);
      else hideTip();
    }, true);
    // Tastatur-Bedienung (Enter/Space auf Buttons) läuft weiter über click
    this.root.addEventListener('click', (e) => {
      if ((e as MouseEvent).detail === 0) this.onClick(e);
    });
    this.root.addEventListener('change', (e) => this.onChange(e));
    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.field === 'inv-search') {
        this.invSearch = t.value;
        this.refresh(true);
        // Fokus behalten: Render baut das Feld neu auf
        const again = this.root.querySelector('[data-field="inv-search"]') as HTMLInputElement | null;
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }
    });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) this.actions.importSave(f);
      this.fileInput.value = '';
    });
  }

  get canvasHost(): HTMLElement {
    return this.root.querySelector('#canvas-host') as HTMLElement;
  }

  openPanel(p: PanelId): void {
    if (p === 'inventory') {
      // Lager ist ein Modal – die Sidebar bleibt, wie sie ist
      this.modalKind = 'inventory';
      this.modalOpen = true;
      this.refresh(true);
      return;
    }
    this.panel = p;
    this.selection = null;
    this.highlightParts.clear();
    this.modalOpen = false;
    this.modalKind = 'inventory';
    this.refresh(true);
  }

  closeModal(): void {
    this.modalOpen = false;
    this.modalKind = 'inventory';
    this.toolOrderId = null;
    this.approvalOrderId = null;
    this.partsOrderId = null;
    this.modalMinimized = false;
    if (this.preModalSpeed > 0) {
      this.getGame().setSpeed(this.preModalSpeed);
      this.preModalSpeed = 0;
    }
    this.refresh(true);
  }

  openInventoryForParts(partIds: string[]): void {
    this.modalKind = 'inventory';
    this.modalOpen = true;
    this.highlightParts = new Set(partIds);
    this.refresh(true);
  }

  /** Hinweis-Modal: Reparatur braucht ein Spezialwerkzeug, das noch fehlt. */
  showToolPrompt(orderId: string): void {
    this.pauseForModal();
    this.modalKind = 'tool';
    this.toolOrderId = orderId;
    this.modalOpen = true;
    this.refresh(true);
  }

  /** Entscheidungs-Modals pausieren das Spiel, damit in Ruhe geprüft werden kann. */
  private pauseForModal(): void {
    const g = this.getGame();
    if (g.state.speed > 0) this.preModalSpeed = g.state.speed;
    g.setSpeed(0);
    this.modalMinimized = false;
  }

  /** Teile-fehlt-Modal: Aufschub bitten & bestellen, ohne Aufschub bestellen, abweisen. */
  showPartsPrompt(orderId: string): void {
    this.pauseForModal();
    this.modalKind = 'parts';
    this.partsOrderId = orderId;
    this.partsSupplierId = this.getGame().state.inventory.autoSupplierId || 'teileprofi';
    this.modalOpen = true;
    this.refresh(true);
  }

  /** Nachfrage-Modal: Kunde droht abzulehnen – Rabatt, Budget akzeptieren oder Preis bestehen. */
  showApprovalPrompt(orderId: string): void {
    this.pauseForModal();
    this.modalKind = 'approval';
    this.approvalOrderId = orderId;
    this.modalOpen = true;
    this.refresh(true);
  }

  setSelection(sel: Selection | null): void {
    this.selection = sel;
    if (sel) this.refresh(true);
  }

  flashSaveIndicator(ok: boolean): void {
    const el = this.root.querySelector('#save-indicator') as HTMLElement;
    el.classList.add(ok ? 'save-ok' : 'save-fail');
    setTimeout(() => el.classList.remove('save-ok', 'save-fail'), 1200);
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.id === 'modal-backdrop') {
      this.closeModal();
      return;
    }
    const btn = target.closest('[data-panel],[data-speed],[data-action]') as HTMLElement | null;
    if (!btn) return;
    if (btn.dataset.panel) {
      this.openPanel(btn.dataset.panel as PanelId);
      return;
    }
    if (btn.dataset.speed !== undefined) {
      const s = Number(btn.dataset.speed);
      if (s === 0) this.actions.togglePause();
      else this.actions.setSpeed(s);
      this.refresh(true);
      return;
    }
    const a = btn.dataset.action;
    const id = btn.dataset.id ?? '';
    switch (a) {
      case 'accept': this.actions.acceptOrder(id); break;
      case 'decline': this.actions.declineOrder(id); break;
      case 'cancel-order': this.actions.cancelOrder(id); break;
      case 'priority': this.actions.togglePriority(id); break;
      case 'select-vehicle': this.actions.select({ kind: 'vehicle', id }); break;
      case 'select-worker': this.actions.select({ kind: 'worker', id }); break;
      case 'order-part': {
        const qty = Number(btn.dataset.qty ?? '1');
        this.actions.orderParts(btn.dataset.part ?? '', qty, this.supplierId);
        break;
      }
      case 'supplier': this.supplierId = id; this.refresh(true); break;
      case 'close-modal': this.closeModal(); break;
      case 'close-toast': btn.closest('.toast')?.remove(); break;
      case 'minimize-modal':
        this.modalMinimized = true;
        this.getGame().setSpeed(this.preModalSpeed || 1);
        break;
      case 'restore-modal':
        this.modalMinimized = false;
        this.getGame().setSpeed(0);
        break;
      case 'parts-supplier': this.partsSupplierId = id; break;
      case 'parts-delay':
        if (this.partsOrderId) this.actions.requestPartsDelay(this.partsOrderId, this.partsSupplierId);
        this.closeModal();
        break;
      case 'parts-order':
        if (this.partsOrderId && this.actions.orderMissing(this.partsOrderId, this.partsSupplierId)) {
          this.closeModal();
        }
        break;
      case 'parts-decline':
        if (this.partsOrderId) this.actions.declineParts(this.partsOrderId);
        this.closeModal();
        break;
      case 'inv-category': this.invCategory = id; break;
      case 'inv-showall': this.invShowAll = !this.invShowAll; break;
      case 'pin-variant': this.actions.pinVariant(btn.dataset.part ?? ''); break;
      case 'sell-variant': this.actions.sellVariant(btn.dataset.part ?? ''); break;
      case 'tool-wait': this.closeModal(); break;
      case 'tool-shop': this.closeModal(); this.openPanel('upgrades'); break;
      case 'tool-decline':
        if (this.toolOrderId) this.actions.cancelOrder(this.toolOrderId);
        this.closeModal();
        break;
      case 'toggle-auto': this.actions.toggleAuto(btn.dataset.part ?? ''); break;
      case 'auto-supplier': this.actions.setAutoSupplier(id); break;
      case 'auto-all': this.actions.setAllAuto(btn.dataset.on === '1'); break;
      case 'hire': this.actions.hireCandidate(id); break;
      case 'fire': this.actions.fireWorker(id); break;
      case 'train': this.actions.trainWorker(id, btn.dataset.skill ?? ''); break;
      case 'refresh-candidates': this.actions.refreshCandidates(); break;
      case 'order-missing': {
        const order = this.getGame().state.orders.find((o) => o.id === id);
        if (order) {
          this.openInventoryForParts(order.partsNeeded.map((n) => n.partId));
        }
        break;
      }
      case 'close-detail': this.selection = null; this.refresh(true); break;
      case 'save': this.actions.saveNow(); break;
      case 'export': this.actions.exportSave(); break;
      case 'import': this.fileInput.click(); break;
      case 'reset': this.actions.resetGame(); break;
      case 'buy-lift': this.actions.buyLift(); break;
      case 'buy-diag': this.actions.buyDiagnosisBay(); break;
      case 'buy-tool': this.actions.buyTool(id); break;
      case 'offer-discount': this.actions.offerDiscount(id, Number(btn.dataset.pct ?? '0')); break;
      case 'insist-price': this.actions.insistPrice(id); break;
      case 'accept-budget': this.actions.acceptBudget(id); break;
      case 'buy-parking': this.actions.buyParking(); break;
      case 'take-loan': this.actions.takeLoan(Number(btn.dataset.amount ?? '0')); break;
      case 'repay-loan': this.actions.repayLoan(id, Number(btn.dataset.amount ?? '0')); break;
      case 'expand-storage': this.actions.expandStorage(); break;
      case 'reset-camera': this.actions.resetCamera(); break;
      default: break;
    }
    this.refresh(true);
  }

  private onChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.dataset.field === 'rate') {
      this.actions.setHourlyRate(Math.round(Number(target.value) * 100));
    } else if (target.dataset.field === 'markup') {
      this.actions.setPartsMarkup(Number(target.value));
    } else if (target.dataset.field === 'orderrate') {
      this.actions.setOrderRate(Number(target.value));
    } else if (target.dataset.field === 'minstock') {
      this.actions.setMinStock(target.dataset.part ?? '', Number(target.value));
    }
  }

  refresh(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastRefresh < 500) return;
    this.lastRefresh = now;
    const game = this.getGame();
    const s = game.state;
    const setText = (id: string, text: string): void => {
      const el = this.root.querySelector(id);
      if (el) el.textContent = text;
    };
    setText('#tb-balance', eur(s.economy.balanceCents));
    setText('#tb-time', gameTime(s.totalMinutes));
    setText('#tb-rep', `${Math.round(s.reputation)} / 100`);
    const active = s.orders.filter(
      (o) => o.status !== 'incoming' && o.status !== 'delivered' && o.status !== 'cancelled',
    ).length;
    setText('#tb-orders', String(active));
    const incoming = s.orders.filter((o) => o.status === 'incoming').length;
    const badge = this.root.querySelector('#badge-incoming') as HTMLElement;
    badge.textContent = incoming > 0 ? String(incoming) : '';
    badge.style.display = incoming > 0 ? 'inline-block' : 'none';
    for (const b of this.root.querySelectorAll('#speed-controls button')) {
      const el = b as HTMLElement;
      el.classList.toggle('active', Number(el.dataset.speed) === s.speed);
    }
    for (const b of this.root.querySelectorAll('#nav button')) {
      const el = b as HTMLElement;
      el.classList.toggle('active', el.dataset.panel === 'inventory'
        ? this.modalOpen && this.modalKind === 'inventory'
        : el.dataset.panel === this.panel && !this.selection && !this.modalOpen);
    }
    // Modal aktualisieren – nur bei Inhaltsänderung, nie während Eingabe/Zeigeraktion
    const backdrop = this.root.querySelector('#modal-backdrop') as HTMLElement;
    const modalBody = this.root.querySelector('#modal-body') as HTMLElement;
    const modalTitle = this.root.querySelector('#modal-title') as HTMLElement;
    const mini = this.root.querySelector('#modal-mini') as HTMLElement;
    const miniTitle = this.root.querySelector('#modal-mini-title') as HTMLElement;
    backdrop.classList.toggle('hidden', !this.modalOpen || this.modalMinimized);
    mini.classList.toggle('hidden', !this.modalOpen || !this.modalMinimized);
    modalTitle.textContent =
      this.modalKind === 'tool' ? 'Spezialwerkzeug benötigt'
      : this.modalKind === 'approval' ? 'Kunde droht abzulehnen'
      : this.modalKind === 'parts' ? 'Ersatzteile fehlen – Entscheidung nötig'
      : 'Ersatzteillager';
    miniTitle.textContent = modalTitle.textContent + ' (Spiel läuft)';
    // Nachfrage-Modal schließt sich, sobald die Entscheidung gefallen ist
    if (this.modalKind === 'approval' && this.modalOpen) {
      const ao = s.orders.find((x) => x.id === this.approvalOrderId);
      if (!ao || !ao.offerAtRisk || ao.status !== 'waiting_for_approval') {
        this.closeModal();
        return;
      }
    }
    if (this.modalKind === 'parts' && this.modalOpen) {
      const po = s.orders.find((x) => x.id === this.partsOrderId);
      if (!po || po.status !== 'waiting_for_parts') {
        this.closeModal();
        return;
      }
    }
    const activeEl = document.activeElement;
    const editingModal =
      activeEl && modalBody.contains(activeEl) &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT');
    const modalSig = this.modalOpen ? this.signature() : '';
    if (this.modalOpen && !this.modalMinimized && !editingModal && (force || (!this.interacting && modalSig !== this.lastModalSig))) {
      this.lastModalSig = modalSig;
      modalBody.innerHTML =
        this.modalKind === 'tool' ? this.renderToolPrompt()
        : this.modalKind === 'approval' ? this.renderApprovalPrompt()
        : this.modalKind === 'parts' ? this.renderPartsPrompt()
        : this.renderInventory();
    }
    // Drawer nur bei Inhaltsänderung neu aufbauen (verhindert Klick-Flackern)
    const editing =
      activeEl &&
      this.drawer.contains(activeEl) &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT');
    const drawerSig = this.signature();
    if (!editing && (force || (!this.interacting && drawerSig !== this.lastDrawerSig))) {
      this.lastDrawerSig = drawerSig;
      this.drawer.innerHTML = this.selection || !this.modalOpen ? this.renderDrawer() : '';
    }
    this.drawer.classList.toggle('hidden', this.modalOpen || (this.panel === 'workshop' && !this.selection));
    this.updateToasts();
  }

  /** Günstiger Änderungs-Schlüssel: DOM wird nur bei echten Änderungen neu gebaut. */
  private signature(): string {
    const s = this.getGame().state;
    const parts: (string | number)[] = [
      this.panel, this.modalKind, this.toolOrderId ?? '', this.partsOrderId ?? '', this.modalOpen ? 1 : 0, this.modalMinimized ? 1 : 0, this.invCategory, this.invSearch, this.invShowAll ? 1 : 0, this.partsSupplierId,
      this.selection ? `${this.selection.kind}:${this.selection.id}` : '',
      this.highlightParts.size,
      Math.floor(s.totalMinutes / 5), s.speed, s.economy.balanceCents, s.orderRateFactor,
      Math.floor(s.reputation), s.economy.hourlyRateCents, s.economy.partsMarkupPct,
      s.notifications.length,
    ];
    for (const o of s.orders) {
      parts.push(
        o.id, o.status, o.priority, o.offerAtRisk ? 1 : 0, o.discountPct,
        o.crewIds.length, o.jobs.filter((j) => j.done).length,
        Math.floor(o.laborMinutesActual / 5), Math.floor(o.diagnosisRemainingMinutes / 5),
        o.estimateCents ?? 0, o.invoiceCents ?? 0, o.satisfaction ?? -1,
        o.qualityIssues, o.partsReserved ? 1 : 0, o.partsAtBay ? 1 : 0,
        Math.floor((o.pickupAtMinute ?? 0) / 15), o.cancelReason ?? '', o.satisfactionReason, o.acceptedBudgetCents ?? -1,
        Math.floor((o.expiresAtMinute ?? 0) / 30),
      );
    }
    for (const w of s.workers) {
      parts.push(
        w.id, w.state, Math.floor(w.pos.x * 2), Math.floor(w.pos.y * 2),
        Math.floor(w.trainingMinutes), Math.floor(w.motivation),
        Object.values(w.skills).join(','), w.speedTilesPerMinute,
      );
    }
    for (const c of s.candidates) parts.push(c.id, c.salaryCentsPerDay);
    for (const pid of Object.keys(s.inventory.stock).sort()) {
      parts.push(
        s.inventory.stock[pid] ?? 0, s.inventory.reserved[pid] ?? 0,
        s.inventory.minStock[pid] ?? 0, s.inventory.autoReorder[pid] ? 1 : 0,
        Math.floor((s.marketPriceFactors[pid] ?? 1) * 100),
        InventorySystem.usageWithin(s.inventory, pid, 1440, s.totalMinutes),
        InventorySystem.usageWithin(s.inventory, pid, 2880, s.totalMinutes),
        s.inventory.pinned[pid] ? 1 : 0, Math.floor((s.inventory.lastOrdered[pid] ?? 0) / 60),
        s.deliveries.filter((d) => !d.done && d.partId === pid).length,
      );
    }
    for (const d of s.deliveries) parts.push(d.id, Math.floor(d.arriveAtMinute / 30));
    for (const st of s.stations) parts.push(st.id, st.unlocked ? 1 : 0, st.orderId ?? '');
    parts.push(s.ownedTools.join(','), s.inventory.autoSupplierId, s.inventory.capacity);
    for (const l of s.loans) parts.push(l.id, l.remainingCents);
    return parts.join('|');
  }

  private renderApprovalPrompt(): string {
    const game = this.getGame();
    const s = game.state;
    const o = s.orders.find((x) => x.id === this.approvalOrderId);
    if (!o) return '<p class="empty">Auftrag nicht gefunden.</p>';
    const c = s.customers.find((x) => x.id === o.customerId);
    const v = s.vehicles.find((x) => x.id === o.vehicleId);
    const history = s.orders.filter((x) => x.customerId === o.customerId && x.status === 'delivered');
    const histRevenue = history.reduce((a, x) => a + (x.invoiceCents ?? 0), 0);
    const avgSat = history.length > 0 ? Math.round(history.reduce((a, x) => a + (x.satisfaction ?? 0), 0) / history.length) : 0;
    const minsLeft = Math.max(0, Math.ceil(((o.approvalDeadline ?? 0) - s.totalMinutes)));
    let html = `<div class="card warn-card">
      <div class="card-title">⚠️ ${esc(c?.name ?? 'Kunde')} droht, das Angebot abzulehnen</div>
      <div class="meta">${v ? `${esc(v.make)} ${esc(v.model)} · ` : ''}Angebot: <strong>${eur(o.estimateCents ?? 0)}</strong> · Budget des Kunden: <strong>${eur(o.budgetCents)}</strong></div>
      <div class="meta">Kundenhistorie: ${history.length === 0 ? 'Neukunde' : `${history.length} Aufträge · Umsatz ${eur(histRevenue)} · Ø Zufriedenheit ${avgSat}%`}${(c?.visits ?? 0) >= 2 ? ' · Stammkunde' : ''}</div>
      <div class="meta">Kunde entscheidet in ${minsLeft} min – ohne Reaktion: Ablehnung. <button type="button" class="help" data-help="Ein Rabatt-Versuch ist einmalig. Lehnt der Kunde ab, geht er endgültig; selten akzeptiert er auch Mehrkosten. Budget akzeptieren hält den Kunden zum Budget-Preis.">?</button></div>
      ${(() => {
        const b = OrderSystem.profitBreakdown(game.ctx, o);
        let t = `<table class="parts-table"><thead><tr><th>Kalkulation</th><th>Kosten</th><th>Erlös</th></tr></thead><tbody>`;
        for (const n of o.partsNeeded) {
          const pd = game.defs.parts.find((x) => x.id === n.partId);
          if (!pd) continue;
          const buy = EconomySystem.marketBuyCents(s, pd);
          t += `<tr><td>${esc(pd.name)} ×${n.quantity}</td><td class="num">${eur(buy * n.quantity)}</td><td class="num">${eur(EconomySystem.sellPrice(buy, s.economy.partsMarkupPct) * n.quantity)}</td></tr>`;
        }
        t += `<tr><td>Arbeit ${Math.round(b.laborMinutes)} min</td><td class="num">${eur(b.laborCost)}</td><td class="num">${eur(b.laborRevenue)}</td></tr>`;
        t += `<tr><td>Diagnosepauschale</td><td class="num">–</td><td class="num">${eur(b.fee)}</td></tr>`;
        if (b.discount > 0) t += `<tr><td>Rabatt</td><td class="num">–</td><td class="num neg">−${eur(b.discount)}</td></tr>`;
        t += `<tr><td><strong>Summe</strong></td><td class="num"><strong>${eur(b.cost)}</strong></td><td class="num"><strong>${eur(b.revenue)}</strong></td></tr></tbody></table>`;
        t += `<div class="meta">Gewinn: <strong class="${b.profit >= 0 ? 'pos' : 'neg'}">${eur(b.profit)}</strong> (${b.revenue > 0 ? Math.round((b.profit / b.revenue) * 100) : 0} % Marge)</div>`;
        return t;
      })()}
      <div class="btn-row">
        <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="5">5 %</button>
        <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="10">10 %</button>
        <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="15">15 %</button>
        <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="20">20 %</button>
        <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="25">25 %</button>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-action="accept-budget" data-id="${o.id}">Budget akzeptieren (${eur(o.budgetCents)})</button>
        <button class="btn danger" data-action="insist-price" data-id="${o.id}">Preis bestehen – Kunde geht</button>
      </div>
    </div>`;
    return html;
  }

  private renderToolPrompt(): string {
    const game = this.getGame();
    const s = game.state;
    const o = s.orders.find((x) => x.id === this.toolOrderId);
    if (!o) return '<p class="empty">Auftrag nicht gefunden.</p>';
    const v = s.vehicles.find((x) => x.id === o.vehicleId);
    const missing = OrderSystem.missingToolsForOrder(game.ctx, o);
    let html = `<div class="card warn-card">
      <div class="card-title">⚠️ Diagnose abgeschlossen – Spezialwerkzeug fehlt</div>
      <div class="meta">Auftrag ${o.id}${v ? ` · ${esc(v.make)} ${esc(v.model)}` : ''}: „${esc(o.complaint)}“</div>
      <div class="meta">Benötigtes Werkzeug:</div>`;
    for (const tid of missing) {
      const t = game.defs.tools.find((x) => x.id === tid);
      if (!t) continue;
      html += `<div class="card compact"><strong>${esc(t.name)}</strong> – ${eur(t.costCents)}<div class="meta muted">${esc(t.description)}</div></div>`;
    }
    html += `<div class="meta">Der Auftrag wartet auf das Werkzeug.</div>
      <div class="btn-row">
        <button class="btn primary" data-action="tool-shop">Zum Ausbau – Werkzeug kaufen</button>
        <button class="btn" data-action="tool-wait">Warten – ich kümmere mich später</button>
        <button class="btn danger" data-action="tool-decline">Auftrag ablehnen</button>
      </div>
    </div>`;
    return html;
  }

  private updateToasts(): void {
    const s = this.getGame().state;
    const fresh = s.notifications.filter((n) => n.id > this.lastToastId);
    for (const n of fresh.slice(-4)) {
      this.lastToastId = Math.max(this.lastToastId, n.id);
      const div = document.createElement('div');
      div.className = `toast toast-${n.kind}`;
      div.innerHTML = `<span>${esc(n.text)}</span><button class="toast-close" data-action="close-toast" title="Schließen">✕</button>`;
      this.toastHost.appendChild(div);
      setTimeout(() => div.classList.add('show'), 10);
      setTimeout(() => {
        div.classList.remove('show');
        setTimeout(() => div.remove(), 400);
      }, 6000);
    }
    if (fresh.length > 0) this.lastToastId = s.notifications[s.notifications.length - 1]!.id;
    while (this.toastHost.children.length > 5) {
      this.toastHost.firstChild?.remove();
    }
  }

  private renderDrawer(): string {
    if (this.selection) {
      return this.selection.kind === 'vehicle'
        ? this.renderVehicleDetail(this.selection.id)
        : this.renderWorkerDetail(this.selection.id);
    }
    switch (this.panel) {
      case 'orders': return this.renderOrders();
      case 'workers': return this.renderWorkers();
      case 'inventory': return this.renderInventory();
      case 'finance': return this.renderFinance();
      case 'statistics': return this.renderStatistics();
      case 'upgrades': return this.renderUpgrades();
      case 'settings': return this.renderSettings();
      case 'messages': return this.renderMessages();
      default: return '';
    }
  }

  private renderOrders(): string {
    const game = this.getGame();
    const s = game.state;
    const incoming = s.orders.filter((o) => o.status === 'incoming');
    const active = s.orders.filter(
      (o) => o.status !== 'incoming' && o.status !== 'delivered' && o.status !== 'cancelled',
    );
    const finished = s.orders
      .filter((o) => o.status === 'delivered' || o.status === 'cancelled')
      .slice(-6)
      .reverse();
    let html = `<div class="drawer-head"><h2>Aufträge</h2></div>`;
    html += `<h3 class="section">Neue Anfragen (${incoming.length}) <button type="button" class="help" data-help="Der Auftragswert steht erst nach der Diagnose fest. Angebote laufen nach 6 Stunden ab.">?</button></h3>`;
    if (incoming.length === 0) {
      html += `<p class="empty">Keine neuen Anfragen. Kunden kommen im Laufe des Tages.</p>`;
    }
    for (const o of incoming) {
      const v = s.vehicles.find((x) => x.id === o.vehicleId)!;
      const c = s.customers.find((x) => x.id === o.customerId)!;
      const expiresIn = Math.max(0, Math.round(((o.expiresAtMinute ?? 0) - s.totalMinutes) / 60));
      html += `
        <div class="card offer">
          <div class="card-title">${esc(c.name)} <span class="muted">· ${PROFILE_LABELS[c.profile] ?? ''}</span></div>
          <div class="card-sub">${esc(v.make)} ${esc(v.model)} (${v.year}, ${v.mileageKm.toLocaleString('de-DE')} km)</div>
          <div class="complaint">„${esc(o.complaint)}“</div>
          <div class="meta">${TYPE_LABELS[o.type] ?? o.type} · ${dueLabel(o, s.totalMinutes)} · Angebot läuft ab in ${expiresIn} h</div>
          <div class="btn-row">
            <button class="btn primary" data-action="accept" data-id="${o.id}">Annehmen</button>
            <button class="btn" data-action="decline" data-id="${o.id}">Ablehnen</button>
          </div>
        </div>`;
    }
    html += `<h3 class="section">In Bearbeitung (${active.length})</h3>`;
    if (active.length === 0) html += `<p class="empty">Keine aktiven Aufträge.</p>`;
    for (const o of active) {
      const v = s.vehicles.find((x) => x.id === o.vehicleId)!;
      const worker = o.assignedWorkerId ? s.workers.find((w) => w.id === o.assignedWorkerId) : null;
      const jobsDone = o.jobs.filter((j) => j.done).length;
      html += `
        <div class="card order-row" data-action="select-vehicle" data-id="${v.id}">
          <div class="card-title">${esc(v.make)} ${esc(v.model)} <span class="muted">${o.id}</span> ${o.priority > 1 ? '<span class="chip prio">Prio</span>' : ''}</div>
          <div>${statusChip(o.status)} ${o.offerAtRisk ? '<span class="chip prio">⚠️ Kunde droht abzulehnen</span>' : ''}</div>
          ${o.revealed ? `<div class="meta">${o.jobs.map((j) => game.defs.repairs.find((r) => r.id === j.repairId)?.name ?? j.repairId).join(', ')}</div>` : `<div class="meta muted">Defekte noch unbekannt – Diagnose nötig</div>`}
          ${o.jobs.length > 0 ? `<div class="meta">Fortschritt: ${jobsDone}/${o.jobs.length} Reparaturen · ${dueLabel(o, s.totalMinutes)}</div>` : `<div class="meta">${dueLabel(o, s.totalMinutes)}</div>`}
          ${worker ? `<div class="meta">Mitarbeiter: ${esc(worker.name)}</div>` : ''}
          ${(() => { const wr = OrderSystem.waitReason(game.ctx, o); return wr ? `<div class="meta wait-reason">⏳ ${esc(wr)}</div>` : ''; })()}
          ${o.status === 'waiting_for_parts' ? `<div class="btn-row"><button class="btn warn" data-action="order-missing" data-id="${o.id}">Fehlende Teile bestellen</button></div>` : ''}
        </div>`;
    }
    if (finished.length > 0) {
      html += `<h3 class="section">Zuletzt abgeschlossen</h3>`;
      for (const o of finished) {
        const v = s.vehicles.find((x) => x.id === o.vehicleId);
        const reasonHelp = o.status === 'cancelled'
          ? help(`Storniert: ${o.cancelReason ?? 'ohne Angabe'}`)
          : o.satisfaction !== null
            ? help(`Zufriedenheit ${o.satisfaction}% – ${o.satisfactionReason || 'keine Details'}`)
            : '';
        html += `<div class="card compact">${statusChip(o.status)} ${v ? `${esc(v.make)} ${esc(v.model)}` : o.id}${o.invoiceCents !== null ? ` · ${eur(o.invoiceCents)}` : ''}${o.satisfaction !== null ? ` · Zufriedenheit ${o.satisfaction}%` : ''} ${reasonHelp}${o.status === 'cancelled' && o.cancelReason ? `<div class="meta muted">Grund: ${esc(o.cancelReason)}</div>` : ''}</div>`;
      }
    }
    return html;
  }

  private renderWorkers(): string {
    const game = this.getGame();
    const s = game.state;
    let html = `<div class="drawer-head"><h2>Mitarbeiter</h2></div>`;
    for (const w of s.workers) {
      html += this.workerCard(w, false);
    }
    html += `<p class="empty">Schicht 08:00–18:00 · Klick für Details &amp; Weiterbildung <button type="button" class="help" data-help="Gehälter werden täglich verbucht. Aufgaben werden automatisch nach Qualifikation, Priorität und Termin verteilt – der beste freie Mitarbeiter übernimmt.">?</button></p>`;
    html += `<h3 class="section">Kandidaten (${s.candidates.length})</h3>`;
    html += `<div class="btn-row"><button class="btn small" data-action="refresh-candidates">Neue Kandidaten anzeigen</button><span class="muted">Pool erneuert sich täglich · max. 6 Mitarbeiter</span></div>`;
    for (const c of s.candidates) {
      const top = Object.entries(c.skills).sort((a, b) => b[1] - a[1]).slice(0, 3);
      html += `<div class="card">
        <div class="card-title">${esc(c.name)}</div>
        <div class="meta">Stärken: ${top.map(([sk, v]) => `${SKILL_LABELS[sk] ?? sk} ${v}`).join(' · ')}</div>
        <div class="meta">Gehalt: ${eur(c.salaryCentsPerDay)}/Tag · Einstellungsgebühr: ${eur(c.hiringFeeCents)}</div>
        <div class="meta">Lauftempo: ${c.speedTilesPerMinute.toFixed(2)} (${tempoLabel(c.speedTilesPerMinute)})</div>
        <div class="btn-row"><button class="btn primary" data-action="hire" data-id="${c.id}" ${s.workers.length >= 6 ? 'disabled' : ''}>Einstellen</button></div>
      </div>`;
    }
    return html;
  }

  private workerCard(w: Worker, detailed: boolean): string {
    const s = this.getGame().state;
    const order = w.task ? s.orders.find((o) => o.id === w.task!.orderId) : null;
    const utilization = w.onDutyMinutes > 0 ? Math.round((w.workedMinutes / w.onDutyMinutes) * 100) : 0;
    let html = `
      <div class="card ${detailed ? '' : 'order-row'}" ${detailed ? '' : `data-action="select-worker" data-id="${w.id}"`}>
        <div class="card-title">${esc(w.name)} <span class="chip st-${w.state}">${WORKER_STATE_LABELS[w.state] ?? w.state}</span></div>
        <div class="meta">${order ? `Auftrag ${order.id}` : w.trainingMinutes > 0 ? `Weiterbildung: noch ${Math.ceil(w.trainingMinutes)} min` : 'Keine Aufgabe'} · Auslastung ${utilization}% · ${eur(w.salaryCentsPerDay)}/Tag</div>`;
    if (detailed) {
      html += `<div class="skills">`;
      const busy = !!w.task || w.trainingMinutes > 0;
      for (const [skill, label] of Object.entries(SKILL_LABELS)) {
        const val = w.skills[skill as keyof Worker['skills']];
        html += `<div class="skill-row"><span>${label}</span><div class="bar"><div style="width:${val}%"></div></div><span class="num">${val}</span>
          <button class="btn small" data-action="train" data-id="${w.id}" data-skill="${skill}" ${busy || val >= 100 ? 'disabled' : ''} title="Weiterbildung: +5 für 150 €, dauert 2 h">+5</button></div>`;
      }
      html += `</div>`;
      html += `<div class="meta speed-row">Lauftempo: <strong>${w.speedTilesPerMinute.toFixed(2)}</strong> <span class="muted">(${tempoLabel(w.speedTilesPerMinute)})</span> ${help('Festes Attribut, nicht veränderbar. Schnelle Mitarbeiter erreichen Fahrzeug und Lager früher – im Laufbild sichtbar.')}</div>`;
      html += `<div class="skill-row"><span>Motivation <button type="button" class="help" data-help="Motivation (0–100): beeinflusst das Arbeitstempo (±10 %). Steigt bei Erholung und Weiterbildung, sinkt bei Dauer-Überlastung (über 85 % Auslastung am Tag).">?</button></span><div class="bar"><div style="width:${w.motivation}%; background:${w.motivation < 40 ? 'var(--neg)' : w.motivation < 70 ? 'var(--warn)' : 'var(--pos)'}"></div></div><span class="num">${Math.round(w.motivation)}</span></div>`;
      if (w.task) {
        html += `<div class="meta">Aktivität: ${WORKER_STATE_LABELS[w.state]} · Schritt: noch ca. ${Math.ceil(w.task.remainingMinutes)} min</div>`;
      }
      html += `<div class="btn-row"><button class="btn danger" data-action="fire" data-id="${w.id}" ${s.workers.length <= 1 ? 'disabled' : ''}>Entlassen (Abfindung: 1 Tagesgehalt)</button></div>`;
    } else {
      html += `<div class="btn-row"><button class="btn small danger" data-action="fire" data-id="${w.id}" ${s.workers.length <= 1 ? 'disabled' : ''}>Entlassen</button></div>`;
    }
    html += `</div>`;
    return html;
  }

  private renderPartsPrompt(): string {
    const game = this.getGame();
    const s = game.state;
    const o = s.orders.find((x) => x.id === this.partsOrderId);
    if (!o) return '<p class="empty">Auftrag nicht gefunden.</p>';
    const v = s.vehicles.find((x) => x.id === o.vehicleId);
    const c = s.customers.find((x) => x.id === o.customerId);
    const profile = c?.profile ?? 'regular';
    const chance = delayChance(s, profile, c?.lastSatisfaction ?? null);
    const delayH = Math.round(DELAY_BY_PROFILE[profile] / 60);
    const history = s.orders.filter((x) => x.customerId === o.customerId && x.status === 'delivered');
    let html = `<div class="card warn-card">
      <div class="card-title">⚠️ Diagnose abgeschlossen – Ersatzteile fehlen</div>
      <div class="meta">${v ? `${esc(v.make)} ${esc(v.model)} · ` : ''}Auftrag ${o.id} · Termin: ${dueLabel(o, s.totalMinutes)}</div>
      <div class="meta">Kunde: ${esc(c?.name ?? '?')} (${PROFILE_LABELS[profile] ?? profile})${history.length > 0 ? ` · ${history.length} frühere Aufträge` : ' · Neukunde'}</div>
      <table class="parts-table"><thead><tr><th>Benötigte Variante</th><th>Bedarf</th><th>Verfügbar</th><th>Fehlt</th><th>EK</th></tr></thead><tbody>`;
    for (const n of o.partsNeeded) {
      const pd = game.defs.parts.find((x) => x.id === n.partId);
      if (!pd) continue;
      const avail = InventorySystem.available(s.inventory, n.partId);
      const missing = Math.max(0, n.quantity - avail);
      if (missing === 0) continue;
      html += `<tr class="low"><td>${esc(pd.name)}</td><td class="num">${n.quantity}</td><td class="num">${avail}</td><td class="num"><strong>${missing}</strong></td><td class="num">${eur(EconomySystem.marketBuyCents(s, pd))}</td></tr>`;
    }
    html += `</tbody></table>
      <div class="meta">Lieferant: <button type="button" class="help" data-help="Express-Aufpreis und Versandkosten zahlt die Werkstatt – sie schmälern die Marge, nicht die Rechnung.">?</button></div>
      <div class="btn-row">${game.defs.suppliers.map((sup) => `<button class="btn small ${this.partsSupplierId === sup.id ? 'primary' : ''}" data-action="parts-supplier" data-id="${sup.id}">${esc(sup.name)} (${Math.round(sup.leadMinutes / 60)} h, ${sup.priceFactor > 1 ? '+' : ''}${Math.round((sup.priceFactor - 1) * 100)} %)</button>`).join('')}</div>
      <div class="meta">Aufschub-Chance: <strong>${Math.round(chance * 100)} %</strong> (+${delayH} h bei Zusage) <button type="button" class="help" data-help="Die Chance hängt vom Kundenprofil, der Reputation und der letzten Zufriedenheit ab. Lehnt der Kunde den Aufschub ab, geht er.">?</button></div>
      <div class="btn-row">
        <button class="btn primary" data-action="parts-delay">Um Aufschub bitten &amp; bestellen</button>
        <button class="btn" data-action="parts-order">Ohne Aufschub bestellen</button>
        <button class="btn danger" data-action="parts-decline">Abweisen</button>
      </div>
    </div>`;
    return html;
  }

  private renderInventory(): string {
    const game = this.getGame();
    const s = game.state;
    const inv = s.inventory;
    const search = this.invSearch.trim().toLowerCase();
    let html = `<div class="btn-row">
      <button class="btn small ${this.invShowAll ? 'primary' : ''}" data-action="inv-showall">${this.invShowAll ? 'Alle Varianten sichtbar' : 'Nur relevante Varianten'}</button>
      <input class="inv-search" type="search" placeholder="Variante suchen…" value="${esc(this.invSearch)}" data-field="inv-search">
    </div>`;
    const allOn = game.defs.parts.every((p) => inv.autoReorder[p.id]);
    const allOff = game.defs.parts.every((p) => !inv.autoReorder[p.id]);
    html += `<div class="btn-row"><button class="btn small ${allOn ? 'primary' : ''}" data-action="auto-all" data-on="1" ${allOn ? 'disabled' : ''}>Alle Auto AN</button><button class="btn small ${allOff ? 'primary' : ''}" data-action="auto-all" data-on="0" ${allOff ? 'disabled' : ''}>Alle Auto AUS</button>
      <span class="muted">Auto-Lieferant:</span>
      ${game.defs.suppliers.map((sup) => `<button class="btn small ${inv.autoSupplierId === sup.id ? 'primary' : ''}" data-action="auto-supplier" data-id="${sup.id}">${esc(sup.name)}</button>`).join('')}
      <button type="button" class="help" data-help="Auto-Nachbestellung pro Variante: Fällt der verfügbare Bestand (Lager minus Reservierungen) unter den Mindestbestand, wird automatisch die Differenz beim gewählten Lieferanten bestellt. Zielbestand = Mindestbestand.">?</button>
    </div>`;
    html += `<div class="meta muted legend"><span class="legend-low">Gelb</span> = ≤ Mindestbestand · 🐌 Ladenhüter · 🚚 offene Lieferung <button type="button" class="help" data-help="Dunkler Hintergrund: Teil wird für einen ausgewählten Auftrag gebraucht. Ladenhüter: Bestand > 0, kein Verbrauch in 48 h, letzte Bestellung > 3 Tage her (Verkauf zu 60 % Marktpreis möglich). Ausgeblendet werden Varianten mit Bestand 0, Min 0 und keiner offenen Bestellung – über Suche oder „Alle Varianten" einblenden und mit 📌 dauerhaft sichtbar machen. 24h/48h = Verbrauch durch Reparaturen.">?</button></div>`;
    html += `<div class="inv-layout"><div class="inv-cats">`;
    for (const cat of game.defs.categories) {
      const vars = game.defs.parts.filter((p) => p.category === cat.id);
      const sum = vars.reduce((a, p) => a + (inv.stock[p.id] ?? 0), 0);
      html += `<button class="inv-cat ${this.invCategory === cat.id ? 'active' : ''}" data-action="inv-category" data-id="${cat.id}">${esc(cat.name)} <span class="muted">${sum}</span></button>`;
    }
    html += `</div><div class="inv-main">`;
    const cat = game.defs.categories.find((c) => c.id === this.invCategory) ?? game.defs.categories[0]!;
    const variants = game.defs.parts.filter((p) => p.category === cat.id);
    const visible = variants.filter((p) =>
      InventorySystem.isVisible(inv, p.id, s.deliveries, search, this.invShowAll, p.name),
    );
    const used48cat = variants.reduce((a, p) => a + InventorySystem.usageWithin(inv, p.id, 2880, s.totalMinutes), 0);
    html += `<h3 class="section">${esc(cat.name)} <span class="muted">· ${visible.length}/${variants.length} Varianten · Verbrauch 48h: ${used48cat}</span></h3>`;
    if (visible.length === 0) {
      html += `<p class="empty">Keine sichtbaren Varianten. Suche nutzen oder „Alle Varianten" einblenden.</p>`;
    } else {
      html += `<table class="parts-table"><thead><tr><th>Variante</th><th>Bestand</th><th>Reserv.</th><th>Min</th><th>Auto</th><th>EK</th><th>VK</th><th>24h</th><th>48h</th><th>Letzte Bestellung</th><th>Bestellen</th><th></th></tr></thead><tbody>`;
      for (const p of visible) {
        const stock = inv.stock[p.id] ?? 0;
        const reserved = inv.reserved[p.id] ?? 0;
        const min = inv.minStock[p.id] ?? 0;
        const low = stock <= min;
        const highlight = this.highlightParts.has(p.id);
        const auto = !!inv.autoReorder[p.id];
        const market = EconomySystem.marketBuyCents(s, p);
        const used24 = InventorySystem.usageWithin(inv, p.id, 1440, s.totalMinutes);
        const used48 = InventorySystem.usageWithin(inv, p.id, 2880, s.totalMinutes);
        const lastOrd = inv.lastOrdered[p.id];
        const lastLabel = lastOrd === undefined ? 'nie' : relTime(s.totalMinutes - lastOrd);
        const slowMover = stock > 0 && used48 === 0 && (lastOrd === undefined || s.totalMinutes - lastOrd > 4320);
        const openDel = s.deliveries.filter((d) => !d.done && d.partId === p.id);
        const pinned = !!inv.pinned[p.id];
        html += `<tr class="${highlight ? 'highlight' : ''} ${low ? 'low' : ''}">
          <td>${esc(p.name)}${slowMover ? ' <span class="chip slow" title="Ladenhüter: Bestand > 0, kein Verbrauch in 48 h, letzte Bestellung > 3 Tage her">🐌</span>' : ''}${openDel.length > 0 ? ` <span class="chip st-waiting_for_parts" title="Offene Lieferung">🚚 ${openDel.length}</span>` : ''}</td>
          <td class="num">${stock}</td>
          <td class="num">${reserved}</td>
          <td><input class="min-input" type="number" min="0" max="20" value="${min}" data-field="minstock" data-part="${p.id}"></td>
          <td><button class="btn small ${auto ? 'primary' : ''}" data-action="toggle-auto" data-part="${p.id}">${auto ? 'AN' : 'AUS'}</button></td>
          <td class="num">${eur(market)}</td>
          <td class="num">${eur(EconomySystem.sellPrice(market, s.economy.partsMarkupPct))}</td>
          <td class="num ${used24 > 0 ? 'usage-hot' : 'muted'}">${used24}</td>
          <td class="num ${used48 > 0 ? 'usage-hot' : 'muted'}">${used48}</td>
          <td class="num muted">${lastLabel}</td>
          <td class="btn-cell">
            <button class="btn small" data-action="order-part" data-part="${p.id}" data-qty="1">+1</button>
            <button class="btn small" data-action="order-part" data-part="${p.id}" data-qty="5">+5</button>
          </td>
          <td class="btn-cell">
            <button class="btn small ${pinned ? 'primary' : ''}" data-action="pin-variant" data-part="${p.id}" title="Variante dauerhaft einblenden">📌</button>
            ${slowMover ? `<button class="btn small" data-action="sell-variant" data-part="${p.id}" title="Unreserved Bestand zu 60 % Marktpreis verkaufen">Verkauf</button>` : ''}
          </td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div></div>`;
    return html;
  }

  private renderFinance(): string {
    const game = this.getGame();
    const s = game.state;
    const day = Math.floor(s.totalMinutes / 1440) + 1;
    const today = s.economy.daily.find((d) => d.day === day);
    const rev = today?.revenueCents ?? 0;
    const parts = today?.partsCostCents ?? 0;
    const salary = today?.salaryCents ?? 0;
    const fixed = today?.fixedCostCents ?? 0;
    const result = rev - parts - salary - fixed;
    const st = s.statistics;
    const avgOrder = st.ordersCompleted > 0 ? Math.round(st.totalRevenueCents / st.ordersCompleted) : 0;
    const avgSat = st.ordersCompleted > 0 ? Math.round(st.satisfactionSum / st.ordersCompleted) : 0;
    const onDuty = s.workers.reduce((a, w) => a + w.onDutyMinutes, 0);
    const worked = s.workers.reduce((a, w) => a + w.workedMinutes, 0);
    const util = onDuty > 0 ? Math.round((worked / onDuty) * 100) : 0;
    let html = `<div class="drawer-head"><h2>Finanzen</h2></div>`;
    html += `<div class="balance-big ${s.economy.balanceCents < 150000 ? 'danger' : ''}">${eur(s.economy.balanceCents)}</div>
      <div class="meta muted">Kontostand</div>`;
    html += `<h3 class="section">Heute (Tag ${day})</h3>
      <div class="finance-grid">
        <div><label>Umsatz</label><strong class="pos">${eur(rev)}</strong></div>
        <div><label>Ersatzteile</label><strong class="neg">${eur(parts)}</strong></div>
        <div><label>Personal</label><strong class="neg">${eur(salary)}</strong></div>
        <div><label>Fixkosten</label><strong class="neg">${eur(fixed)}</strong></div>
        <div class="wide"><label>Betriebsergebnis</label><strong class="${result >= 0 ? 'pos' : 'neg'}">${eur(result)}</strong></div>
      </div>`;
    html += `<h3 class="section">Gesamt</h3>
      <div class="finance-grid">
        <div><label>Abgeschl. Aufträge</label><strong>${st.ordersCompleted}</strong></div>
        <div><label>Ø Auftragswert</label><strong>${eur(avgOrder)}</strong></div>
        <div><label>Ø Zufriedenheit</label><strong>${avgSat}%</strong></div>
        <div><label>Auslastung</label><strong>${util}%</strong></div>
        <div><label>Umsatz gesamt</label><strong>${eur(st.totalRevenueCents)}</strong></div>
        <div><label>Storniert</label><strong>${st.ordersCancelled}</strong></div>
      </div>`;
    // Tagesverlauf als Sparkline
    const daily = s.economy.daily.slice(-30);
    if (daily.length >= 2) {
      const vals = daily.map((d) => d.balanceEndCents);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = Math.max(1, max - min);
      const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 260},${60 - ((v - min) / range) * 56}`).join(' ');
      html += `<h3 class="section">Kontostand-Verlauf</h3>
        <svg class="sparkline" viewBox="0 0 260 64" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#f5a623" stroke-width="2"/></svg>`;
    }
    const lastDays = s.economy.daily.slice(-7).reverse();
    if (lastDays.length > 0) {
      html += `<h3 class="section">Letzte Tage</h3><table class="parts-table"><thead><tr><th>Tag</th><th>Umsatz</th><th>Kosten</th><th>Ergebnis</th></tr></thead><tbody>`;
      for (const d of lastDays) {
        const costs = d.partsCostCents + d.salaryCents + d.fixedCostCents;
        const result = d.revenueCents - costs;
        html += `<tr><td>${d.day}</td><td class="num pos">${eur(d.revenueCents)}</td><td class="num neg">${eur(costs)}</td><td class="num ${result >= 0 ? 'pos' : 'neg'}">${eur(result)}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `<h3 class="section">Kredite <button type="button" class="help" data-help="Max. 50.000 € Gesamtschulden. Zinsen: 0,05 % pro Tag auf die Restschuld (5 Basispunkte). Tilgung jederzeit manuell – Zinsen laufen nur auf den verbleibenden Betrag.">?</button></h3>`;
    const debt = s.loans.reduce((a, l) => a + l.remainingCents, 0);
    html += `<div class="meta">Gesamtschulden: <strong class="${debt > 0 ? 'neg' : ''}">${eur(debt)}</strong></div>`;
    html += `<div class="btn-row">
      <button class="btn small" data-action="take-loan" data-amount="500000">+5.000 €</button>
      <button class="btn small" data-action="take-loan" data-amount="1000000">+10.000 €</button>
      <button class="btn small" data-action="take-loan" data-amount="2000000">+20.000 €</button>
    </div>`;
    for (const l of s.loans) {
      html += `<div class="card compact">${eur(l.remainingCents)} Restschuld (von ${eur(l.principalCents)})
        <div class="btn-row"><button class="btn small" data-action="repay-loan" data-id="${l.id}" data-amount="100000">1.000 € tilgen</button>
        <button class="btn small" data-action="repay-loan" data-id="${l.id}" data-amount="${l.remainingCents}">Komplett tilgen</button></div></div>`;
    }
    html += `<h3 class="section">Letzte Buchungen</h3><div class="tx-list">`;
    for (const t of [...s.economy.transactions].slice(-14).reverse()) {
      html += `<div class="tx"><span class="tx-label">${esc(t.label)}</span><span class="${t.amountCents >= 0 ? 'pos' : 'neg'}">${t.amountCents >= 0 ? '+' : ''}${eur(t.amountCents)}</span></div>`;
    }
    html += `</div>`;
    return html;
  }

  private renderStatistics(): string {
    const game = this.getGame();
    const s = game.state;
    const st = s.statistics;
    const avgOrder = st.ordersCompleted > 0 ? Math.round(st.totalRevenueCents / st.ordersCompleted) : 0;
    const avgSat = st.ordersCompleted > 0 ? Math.round(st.satisfactionSum / st.ordersCompleted) : 0;
    let html = `<div class="drawer-head"><h2>Statistiken</h2></div>`;
    html += `<div class="finance-grid">
      <div><label>Abgeschlossen</label><strong>${st.ordersCompleted}</strong></div>
      <div><label>Storniert</label><strong>${st.ordersCancelled}</strong></div>
      <div><label>Umsatz gesamt</label><strong>${eur(st.totalRevenueCents)}</strong></div>
      <div><label>Ø Auftragswert</label><strong>${eur(avgOrder)}</strong></div>
      <div><label>Ø Zufriedenheit</label><strong>${avgSat}%</strong></div>
      <div><label>QC-Fehlschläge <button type="button" class="help" data-help="Qualitätskontrolle nach der Reparatur: bei unerfahrenen Prüfern kann sie fehlschlagen und Nacharbeit auslösen.">?</button></label><strong class="${st.qcFailures > 0 ? 'neg' : ''}">${st.qcFailures}</strong></div>
      <div><label>Reklamationen</label><strong class="${st.complaints > 0 ? 'neg' : ''}">${st.complaints}</strong></div>
      <div><label>Arbeitsstunden</label><strong>${(st.totalLaborMinutes / 60).toFixed(1)} h</strong></div>
    </div>`;
    const topRepairs = Object.entries(st.repairsByType).sort((a, b) => b[1] - a[1]).slice(0, 8);
    html += `<h3 class="section">Häufigste Reparaturen</h3>`;
    if (topRepairs.length === 0) html += `<p class="empty">Noch keine Reparaturen abgeschlossen.</p>`;
    for (const [id, count] of topRepairs) {
      const name = game.defs.repairs.find((r) => r.id === id)?.name ?? id;
      html += `<div class="card compact">${esc(name)} <span class="muted">· ${count}×</span></div>`;
    }
    html += `<h3 class="section">Mitarbeiter-Ranking</h3><table class="parts-table"><thead><tr><th>Name</th><th>Stunden</th><th>Motivation</th><th>Auslastung</th></tr></thead><tbody>`;
    const ranking = [...s.workers].sort((a, b) => b.workedMinutes - a.workedMinutes);
    for (const w of ranking) {
      const util = w.onDutyMinutes > 0 ? Math.round((w.workedMinutes / w.onDutyMinutes) * 100) : 0;
      html += `<tr><td>${esc(w.name)}</td><td class="num">${(w.workedMinutes / 60).toFixed(1)}</td><td class="num">${Math.round(w.motivation)}%</td><td class="num">${util}%</td></tr>`;
    }
    html += `</tbody></table>`;
    html += `<h3 class="section">Kostenstruktur (gesamt)</h3>
      <div class="finance-grid">
        <div><label>Ersatzteile</label><strong>${eur(st.totalPartsCostCents)}</strong></div>
        <div><label>Personal</label><strong>${eur(st.totalSalaryCents)}</strong></div>
        <div><label>Fixkosten</label><strong>${eur(st.totalFixedCostCents)}</strong></div>
        <div><label>Reputation</label><strong>${Math.round(s.reputation)} / 100</strong></div>
      </div>`;
    return html;
  }

  private renderUpgrades(): string {
    const game = this.getGame();
    const s = game.state;
    const lifts = s.stations.filter((x) => x.kind === 'lift');
    const nextLift = lifts.find((x) => !x.unlocked);
    const diags = s.stations.filter((x) => x.kind === 'diagnosis');
    const nextDiag = diags.find((x) => !x.unlocked);
    let html = `<div class="drawer-head"><h2>Werkstattausbau</h2></div>`;
    html += `<div class="card">
      <div class="card-title">Hebebühnen (${lifts.filter((x) => x.unlocked).length}/${lifts.length})</div>
      <div class="meta">Parallele Reparaturen <button type="button" class="help" data-help="Achtung: ohne Personal und Aufträge bringt eine weitere Bühne keinen Nutzen – erst Auslastung prüfen.">?</button></div>
      <div class="meta">Kosten je weiterer Bühne: ${eur(800000)}</div>
      ${nextLift
        ? `<div class="btn-row"><button class="btn primary" data-action="buy-lift">Bühne ${nextLift.id.replace('lift', '')} kaufen</button></div>`
        : '<div class="chip st-delivered">Alle 4 Bühnen installiert</div>'}
    </div>`;
    html += `<div class="card">
      <div class="card-title">Diagnoseplätze (${diags.filter((x) => x.unlocked).length}/${diags.length})</div>
      <div class="meta">Parallele Diagnosen <button type="button" class="help" data-help="Vermeidet den Diagnose-Engpass, besonders mit mehreren Mitarbeitern.">?</button></div>
      <div class="meta">Kosten je weiterem Platz: ${eur(500000)}</div>
      ${nextDiag
        ? `<div class="btn-row"><button class="btn primary" data-action="buy-diag">Diagnose ${nextDiag.id.replace('diag', '')} kaufen</button></div>`
        : '<div class="chip st-delivered">Alle 3 Diagnoseplätze installiert</div>'}
    </div>`;
    html += `<div class="card">
      <div class="card-title">Lagererweiterung (+60 Teile)</div>
      <div class="meta">Kapazität: ${s.inventory.capacity} Teile <button type="button" class="help" data-help="Mehr Lager vermeidet Wartezeiten auf Teile, bindet aber Kapital.">?</button></div>
      <div class="meta">Kosten: ${eur(250000)}</div>
      <div class="btn-row"><button class="btn primary" data-action="expand-storage">Kaufen</button></div>
    </div>`;
    const parks = s.stations.filter((x) => x.kind === 'parking');
    const freeParks = parks.filter((x) => x.unlocked).length;
    html += `<div class="card">
      <div class="card-title">Parkplätze an der Straße</div>
      <div class="meta">${freeParks} von ${parks.length} Plätzen erschlossen <button type="button" class="help" data-help="Kunden parken nach der Reparatur dort und holen verzögert ab (1–4 h). Sind alle Plätze voll, blockiert das fertige Fahrzeug die Hebebühne.">?</button></div>
      <div class="meta">Kosten je weiterem Platz: ${eur(120000)}</div>
      ${freeParks < parks.length ? '<div class="btn-row"><button class="btn primary" data-action="buy-parking">Weiteren Parkplatz erschließen</button></div>' : '<div class="chip st-delivered">Alle Plätze erschlossen</div>'}
    </div>`;
    html += `<h3 class="section">Spezialwerkzeuge <button type="button" class="help" data-help="Bestimmte Reparaturen (Federn, Wasserpumpe, Klima, Getriebe) sind erst möglich, wenn das passende Werkzeug gekauft wurde. Fehlt es, wartet der Auftrag – die Diagnose zeigt ein Hinweis-Modal.">?</button></h3>`;
    for (const t of game.defs.tools) {
      const owned = s.ownedTools.includes(t.id);
      html += `<div class="card">
        <div class="card-title">${esc(t.name)}</div>
        <div class="meta">${esc(t.description)}</div>
        <div class="meta">Kosten: ${eur(t.costCents)}</div>
        ${owned
          ? '<div class="chip st-delivered">Im Besitz</div>'
          : `<div class="btn-row"><button class="btn primary" data-action="buy-tool" data-id="${t.id}">Kaufen</button></div>`}
      </div>`;
    }
    return html;
  }

  private renderSettings(): string {
    const s = this.getGame().state;
    return `<div class="drawer-head"><h2>Einstellungen</h2></div>
      <div class="card">
        <div class="card-title">Kalkulation</div>
        <label class="field">Stundenverrechnungssatz (€) <button type="button" class="help" data-help="Basis für alle Arbeitsleistungen. Rechnung = Arbeitszeit × Satz + Teile-VK + Diagnosepauschale. Höher = mehr Marge, aber preissensible Kunden lehnen eher ab.">?</button>
          <input type="number" min="30" max="200" step="5" value="${(s.economy.hourlyRateCents / 100).toFixed(0)}" data-field="rate">
        </label>
        <label class="field">Ersatzteilaufschlag (%) <button type="button" class="help" data-help="Verkaufspreis = Einkaufspreis × (1 + Aufschlag %). Beispiel: 50 € EK + 40 % = 70 € VK, also 20 € Rohmarge pro Teil.">?</button>
          <input type="number" min="0" max="150" step="5" value="${s.economy.partsMarkupPct}" data-field="markup">
        </label>
        <label class="field">Auftragsfrequenz (Faktor) ${help('Multiplikator für neue Kundenaufträge: 0.5 = ruhig, 1 = normal, 3 = voll. Basis hängt zusätzlich von der Reputation ab. Mehr Aufträge = mehr Umsatz, aber auch mehr Engpässe bei Personal und Parkplätzen.')}
          <input type="number" min="0.5" max="3" step="0.1" value="${s.orderRateFactor}" data-field="orderrate">
        </label>
      </div>
      <div class="card">
        <div class="card-title">Spielstand</div>
        <div class="meta">Autosave alle 30 s, offline (IndexedDB) <button type="button" class="help" data-help="Speichert automatisch alle 30 Sekunden und nach wichtigen Ereignissen. Primär IndexedDB (großer Browserspeicher), Fallback localStorage. Kein Server, keine Cloud. Export/Import als manuelle Sicherung.">?</button></div>
        <div class="meta muted">Nachts läuft das Spiel automatisch mit 16×. <button type="button" class="help" data-help="Außerhalb der Arbeitszeit (18:00–08:00) wird auf 16× beschleunigt, solange keine Reparatur läuft. Auftragseingang und Schichtbeginn (08:00) schalten auf 1×. Untätige Mitarbeiter warten im Pausenraum, nach Feierabend werden sie ausgeblendet.">?</button></div>
        <div class="btn-row">
          <button class="btn primary" data-action="save">Jetzt speichern</button>
          <button class="btn" data-action="export">Export (JSON)</button>
          <button class="btn" data-action="import">Import (JSON)</button>
        </div>
        <div class="btn-row">
          <button class="btn" data-action="reset-camera">Kamera zurücksetzen</button>
          <button class="btn danger" data-action="reset">Spiel zurücksetzen</button>
        </div>
      </div>
      <div class="card compact muted">Seed: ${s.seed} · Savegame-Version ${s.version}</div>`;
  }

  private renderMessages(): string {
    const s = this.getGame().state;
    let html = `<div class="drawer-head"><h2>Meldungen</h2></div>`;
    if (s.notifications.length === 0) html += `<p class="empty">Noch keine Meldungen.</p>`;
    for (const n of [...s.notifications].reverse()) {
      html += `<div class="card compact msg-${n.kind}"><span class="muted">${gameTime(n.atMinute)}</span> ${esc(n.text)}</div>`;
    }
    return html;
  }

  private renderVehicleDetail(vehicleId: string): string {
    const game = this.getGame();
    const s = game.state;
    const v = s.vehicles.find((x) => x.id === vehicleId);
    if (!v) return '<p class="empty">Fahrzeug nicht gefunden.</p>';
    const o = s.orders.find((x) => x.id === v.orderId);
    if (!o) return '<p class="empty">Kein Auftrag.</p>';
    const c = s.customers.find((x) => x.id === o.customerId);
    const worker = o.assignedWorkerId ? s.workers.find((w) => w.id === o.assignedWorkerId) : null;
    let html = `<div class="drawer-head"><h2>${esc(v.make)} ${esc(v.model)}</h2><button class="btn small" data-action="close-detail">✕</button></div>`;
    html += `<div class="card compact">
      <div class="meta">Baujahr ${v.year} · ${v.mileageKm.toLocaleString('de-DE')} km · ${CLASS_LABELS[v.vehicleClass] ?? esc(v.vehicleClass)}</div>
      <div class="meta">Kunde: ${c ? esc(c.name) : '?'} (${c ? PROFILE_LABELS[c.profile] ?? '' : ''})</div>
      <div class="complaint">„${esc(o.complaint)}“</div>
      <div>${statusChip(o.status)} ${o.priority > 1 ? '<span class="chip prio">Priorität hoch</span>' : ''}</div>
      ${o.status === 'diagnosing' && o.diagnosisExtended ? '<div class="meta overdue">Nachuntersuchung läuft (unerfahrene Diagnose).</div>' : ''}
      ${(() => { const wr = OrderSystem.waitReason(game.ctx, o); return wr ? `<div class="card compact warn-card wait-card">⏳ ${esc(wr)}</div>` : ''; })()}
      <div class="meta">${dueLabel(o, s.totalMinutes)}${worker ? ` · Mitarbeiter: ${esc(worker.name)}` : ''}</div>
    </div>`;
    if (o.offerAtRisk && o.status === 'waiting_for_approval') {
      const history = s.orders.filter((x) => x.customerId === o.customerId && x.status === 'delivered');
      const histRevenue = history.reduce((a, x) => a + (x.invoiceCents ?? 0), 0);
      const avgSat = history.length > 0 ? Math.round(history.reduce((a, x) => a + (x.satisfaction ?? 0), 0) / history.length) : 0;
      const minsLeft = Math.max(0, Math.ceil(((o.approvalDeadline ?? 0) - s.totalMinutes)));
      html += `<div class="card warn-card wait-card">
        <div class="card-title">⚠️ Kunde droht, das Angebot abzulehnen</div>
        <div class="meta">Angebot: <strong>${eur(o.estimateCents ?? 0)}</strong> · Budget des Kunden: ${eur(o.budgetCents)}${o.discountPct > 0 ? ` · bisheriger Rabatt: ${o.discountPct} %` : ''}</div>
        <div class="meta">Kundenhistorie: ${history.length === 0 ? 'Neukunde' : `${history.length} Aufträge · Umsatz ${eur(histRevenue)} · Ø Zufriedenheit ${avgSat}%`}${(c?.visits ?? 0) >= 2 ? ' · Stammkunde – Rabatt empfohlen' : ''}</div>
        <div class="meta">Kunde entscheidet in ${minsLeft} min – ohne Reaktion: Ablehnung.</div>
        <div class="btn-row">
          <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="5">5 %</button>
          <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="10">10 %</button>
          <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="15">15 %</button>
          <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="20">20 %</button>
          <button class="btn small" data-action="offer-discount" data-id="${o.id}" data-pct="25">25 %</button>
          <button class="btn small danger" data-action="insist-price" data-id="${o.id}">Preis bestehen</button>
        </div>
      </div>`;
    }
    if (o.revealed) {
      const b = OrderSystem.profitBreakdown(game.ctx, o);
      html += `<div class="card compact"><div class="card-title">Kalkulation ${o.billed ? '(Rechnung)' : '(Kostenvoranschlag)'}</div>
        <table class="parts-table"><thead><tr><th>Position</th><th>Kosten</th><th>Erlös</th></tr></thead><tbody>`;
      for (const n of o.partsNeeded) {
        const pd = game.defs.parts.find((x) => x.id === n.partId);
        if (!pd) continue;
        const buy = EconomySystem.marketBuyCents(s, pd);
        html += `<tr><td>${esc(pd.name)} ×${n.quantity}</td><td class="num">${eur(buy * n.quantity)}</td><td class="num">${eur(EconomySystem.sellPrice(buy, s.economy.partsMarkupPct) * n.quantity)}</td></tr>`;
      }
      html += `<tr><td>Arbeit ${Math.round(b.laborMinutes)} min × ${eur(s.economy.hourlyRateCents)}/h</td><td class="num">${eur(b.laborCost)}</td><td class="num">${eur(b.laborRevenue)}</td></tr>`;
      html += `<tr><td>Diagnosepauschale</td><td class="num">–</td><td class="num">${eur(b.fee)}</td></tr>`;
      if (b.discount > 0) html += `<tr><td>Rabatt${o.discountPct > 0 ? ` (${o.discountPct} %)` : ''}</td><td class="num">–</td><td class="num neg">−${eur(b.discount)}</td></tr>`;
      html += `<tr><td><strong>Summe</strong></td><td class="num"><strong>${eur(b.cost)}</strong></td><td class="num"><strong>${eur(b.revenue)}</strong></td></tr>`;
      html += `</tbody></table>
        <div class="meta">Gewinn: <strong class="${b.profit >= 0 ? 'pos' : 'neg'}">${eur(b.profit)}</strong> (${b.revenue > 0 ? Math.round((b.profit / b.revenue) * 100) : 0} % Marge) <button type="button" class="help" data-help="Kosten = Material-EK + anteilige Lohnkosten (Tagesgehälter auf die Arbeitszeit umgelegt). Erlös = Rechnung bzw. Kostenvoranschlag. Gewinn = Erlös − Kosten.">?</button></div>
      </div>`;
      html += `<h3 class="section">Erkannte Defekte & Reparaturen</h3>`;
      for (const j of o.jobs) {
        const def = game.defs.repairs.find((r) => r.id === j.repairId)!;
        html += `<div class="card compact"><div class="card-title">${j.done ? '✓ ' : ''}${esc(def.name)}</div>`;
        html += `<div class="steps">`;
        def.steps.forEach((step, i) => {
          const done = j.done || i < j.stepIndex;
          const current = !j.done && i === j.stepIndex;
          html += `<div class="step ${done ? 'done' : ''} ${current ? 'current' : ''}">${done ? '✓' : current ? '▶' : '·'} ${esc(step.name)} (${step.durationMinutes} min)</div>`;
        });
        html += `</div></div>`;
      }
      html += `<h3 class="section">Ersatzteilbedarf</h3>`;
      if (o.partsNeeded.length === 0) html += `<p class="empty">Keine Ersatzteile nötig.</p>`;
      for (const n of o.partsNeeded) {
        const p = game.defs.parts.find((x) => x.id === n.partId)!;
        const avail = InventorySystem.available(s.inventory, n.partId);
        const ok = o.partsAtBay || o.partsReserved || avail >= n.quantity;
        html += `<div class="card compact ${ok ? '' : 'warn-card'}">${n.quantity}× ${esc(p.name)} ${o.partsAtBay ? '· am Arbeitsplatz' : o.partsReserved ? '· reserviert' : ok ? '· auf Lager' : `· <strong>fehlt</strong> (verfügbar: ${avail})`}</div>`;
      }
      if (o.status === 'waiting_for_parts') {
        html += `<div class="btn-row"><button class="btn warn" data-action="order-missing" data-id="${o.id}">Fehlende Teile bestellen</button></div>`;
      }
      html += `<div class="card compact">
        ${o.estimateCents !== null ? `<div class="meta">Kostenvoranschlag: <strong>${eur(o.estimateCents)}</strong></div>` : ''}
        ${o.invoiceCents !== null ? `<div class="meta">Rechnung: <strong>${eur(o.invoiceCents)}</strong></div>` : ''}
        ${o.satisfaction !== null ? `<div class="meta">Kundenzufriedenheit: ${o.satisfaction}%</div>` : ''}
        ${o.qualityScore !== null ? `<div class="meta">Qualitäts-score: ${(o.qualityScore * 100).toFixed(0)}%${o.qualityIssues > 0 ? ` · ${o.qualityIssues} Nacharbeit(en)` : ''} ${help('Qualitäts-score: steigt mit dem Diagnose-Skill des Prüfers, sinkt bei QC-Nacharbeiten. Niedriger Score erhöht das Reklamationsrisiko (20 % Erstattung, Reputation −4).')}</div>` : ''}
        ${o.crewIds.length > 1 ? `<div class="meta">Team-Reparatur: ${o.crewIds.map((id) => esc(s.workers.find((w) => w.id === id)?.name ?? id)).join(', ')} ${help('Team-Reparatur: Diese Reparatur braucht 2 Mitarbeiter. Beide müssen an der Bühne sein; zusammen gibt es +15 % Arbeitsgeschwindigkeit.')}</div>` : ''}
        <div class="meta muted">Tatsächliche Arbeitszeit: ${Math.round(o.laborMinutesActual)} min</div>
      </div>`;
    } else {
      html += `<p class="empty">Defekte unbekannt – Diagnose nach Annahme.</p>`;
    }
    const cancellable = o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'completed' && o.status !== 'incoming';
    html += `<div class="btn-row">
      <button class="btn" data-action="priority" data-id="${o.id}">Priorität ${o.priority > 1 ? 'normal' : 'hoch'} setzen</button>
      ${cancellable ? `<button class="btn danger" data-action="cancel-order" data-id="${o.id}">Auftrag stornieren</button>` : ''}
    </div>`;
    return html;
  }

  private renderWorkerDetail(workerId: string): string {
    const s = this.getGame().state;
    const w = s.workers.find((x) => x.id === workerId);
    if (!w) return '<p class="empty">Mitarbeiter nicht gefunden.</p>';
    let html = `<div class="drawer-head"><h2>${esc(w.name)}</h2><button class="btn small" data-action="close-detail">✕</button></div>`;
    html += this.workerCard(w, true);
    return html;
  }
}
