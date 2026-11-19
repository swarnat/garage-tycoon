import type { Game } from '../core/Game';
import type { RepairOrder, Worker } from '../entities/types';
import type { Selection } from '../rendering/Renderer';
import { InventorySystem } from '../simulation/InventorySystem';
import { EconomySystem } from '../simulation/EconomySystem';
import { OrderSystem } from '../simulation/OrderSystem';

export type PanelId =
  | 'workshop'
  | 'orders'
  | 'workers'
  | 'inventory'
  | 'finance'
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
  setWorkerSpeed(id: string, delta: number): void;
  resetCamera(): void;
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
          <div class="stat"><label>Reputation</label><strong id="tb-rep"></strong></div>
          <div class="stat"><label>Aktive Aufträge</label><strong id="tb-orders"></strong></div>
        </div>
        <div class="speed-controls" id="speed-controls">
          <button data-speed="0" title="Pause (Leertaste)">⏸</button>
          <button data-speed="1">1×</button>
          <button data-speed="2">2×</button>
          <button data-speed="4">4×</button>
          <button data-speed="8">8×</button>
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
          <div class="modal-head"><h2>Ersatzteillager</h2><button class="btn small" data-action="close-modal">✕ Schließen</button></div>
          <div id="modal-body"></div>
        </div>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    `;
    this.drawer = this.root.querySelector('#drawer') as HTMLElement;
    this.toastHost = this.root.querySelector('#toasts') as HTMLElement;
    this.fileInput = this.root.querySelector('#import-file') as HTMLInputElement;

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('change', (e) => this.onChange(e));
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
    this.panel = p;
    this.selection = null;
    this.highlightParts.clear();
    this.modalOpen = p === 'inventory';
    this.refresh(true);
  }

  closeModal(): void {
    this.modalOpen = false;
    this.refresh(true);
  }

  openInventoryForParts(partIds: string[]): void {
    this.panel = 'inventory';
    this.selection = null;
    this.modalOpen = true;
    this.highlightParts = new Set(partIds);
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
      case 'toggle-auto': this.actions.toggleAuto(btn.dataset.part ?? ''); break;
      case 'auto-supplier': this.actions.setAutoSupplier(id); break;
      case 'hire': this.actions.hireCandidate(id); break;
      case 'fire': this.actions.fireWorker(id); break;
      case 'train': this.actions.trainWorker(id, btn.dataset.skill ?? ''); break;
      case 'worker-speed': this.actions.setWorkerSpeed(id, Number(btn.dataset.delta ?? '0')); break;
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
      el.classList.toggle('active', el.dataset.panel === this.panel && !this.selection && (el.dataset.panel !== 'inventory' || this.modalOpen));
    }
    // Modal (Lager) aktualisieren
    const backdrop = this.root.querySelector('#modal-backdrop') as HTMLElement;
    const modalBody = this.root.querySelector('#modal-body') as HTMLElement;
    backdrop.classList.toggle('hidden', !this.modalOpen);
    const activeEl = document.activeElement;
    const editingModal =
      activeEl && modalBody.contains(activeEl) &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT');
    if (this.modalOpen && !editingModal) {
      modalBody.innerHTML = this.renderInventory();
    }
    // Drawer nur neu aufbauen, wenn kein Eingabefeld fokussiert ist
    const editing =
      activeEl &&
      this.drawer.contains(activeEl) &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT');
    if (!editing) {
      this.drawer.innerHTML = this.selection || !this.modalOpen ? this.renderDrawer() : '';
      this.drawer.classList.toggle('hidden', this.modalOpen || (this.panel === 'workshop' && !this.selection));
    }
    this.updateToasts();
  }

  private updateToasts(): void {
    const s = this.getGame().state;
    const fresh = s.notifications.filter((n) => n.id > this.lastToastId);
    for (const n of fresh.slice(-4)) {
      this.lastToastId = Math.max(this.lastToastId, n.id);
      const div = document.createElement('div');
      div.className = `toast toast-${n.kind}`;
      div.textContent = n.text;
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
    html += `<h3 class="section">Neue Anfragen (${incoming.length})</h3>`;
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
          <div class="meta muted">Auftragswert steht nach der Diagnose fest.</div>
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
          <div>${statusChip(o.status)}</div>
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
        html += `<div class="card compact">${statusChip(o.status)} ${v ? `${esc(v.make)} ${esc(v.model)}` : o.id}${o.invoiceCents !== null ? ` · ${eur(o.invoiceCents)}` : ''}${o.satisfaction !== null ? ` · Zufriedenheit ${o.satisfaction}%` : ''}</div>`;
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
    html += `<p class="empty">Schichtzeit: 08:00–18:00. Gehälter werden täglich verbucht. Aufgaben werden automatisch nach Qualifikation, Priorität und Termin verteilt. Klick auf einen Mitarbeiter für Details und Weiterbildung.</p>`;
    html += `<h3 class="section">Kandidaten (${s.candidates.length})</h3>`;
    html += `<div class="btn-row"><button class="btn small" data-action="refresh-candidates">Neue Kandidaten anzeigen</button><span class="muted">Pool erneuert sich täglich · max. 6 Mitarbeiter</span></div>`;
    for (const c of s.candidates) {
      const top = Object.entries(c.skills).sort((a, b) => b[1] - a[1]).slice(0, 3);
      html += `<div class="card">
        <div class="card-title">${esc(c.name)}</div>
        <div class="meta">Stärken: ${top.map(([sk, v]) => `${SKILL_LABELS[sk] ?? sk} ${v}`).join(' · ')}</div>
        <div class="meta">Gehalt: ${eur(c.salaryCentsPerDay)}/Tag · Einstellungsgebühr: ${eur(c.hiringFeeCents)}</div>
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
      html += `</div><div class="meta muted">Weiterbildung: +5 Punkte für 150 €, Mitarbeiter ist 2 h nicht einsetzbar.</div>`;
      html += `<div class="meta speed-row">Lauftempo: <strong>${w.speedTilesPerMinute.toFixed(2)}</strong>
        <button class="btn small" data-action="worker-speed" data-id="${w.id}" data-delta="-0.05" title="langsamer">−</button>
        <button class="btn small" data-action="worker-speed" data-id="${w.id}" data-delta="0.05" title="schneller">+</button>
        <span class="muted">(0.20–0.60)</span></div>`;
      if (w.task) {
        html += `<div class="meta">Aktivität: ${WORKER_STATE_LABELS[w.state]} · Schritt verbleibend ca. ${Math.ceil(w.task.remainingMinutes)} Spielminuten</div>`;
      }
      html += `<div class="btn-row"><button class="btn danger" data-action="fire" data-id="${w.id}" ${s.workers.length <= 1 ? 'disabled' : ''}>Entlassen (Abfindung: 1 Tagesgehalt)</button></div>`;
    } else {
      html += `<div class="btn-row"><button class="btn small danger" data-action="fire" data-id="${w.id}" ${s.workers.length <= 1 ? 'disabled' : ''}>Entlassen</button></div>`;
    }
    html += `</div>`;
    return html;
  }

  private renderInventory(): string {
    const game = this.getGame();
    const s = game.state;
    const inv = s.inventory;
    const total = InventorySystem.totalStock(inv);
    let html = `<div class="drawer-head"><h2>Ersatzteillager</h2></div>`;
    html += `<div class="meta">Kapazität: ${total} / ${inv.capacity} Teile</div>
      <div class="bar capacity"><div style="width:${Math.min(100, (total / inv.capacity) * 100)}%"></div></div>`;
    html += `<div class="supplier-row">Lieferant (manuell):
      ${game.defs.suppliers.map((sup) => `<button class="btn small ${this.supplierId === sup.id ? 'primary' : ''}" data-action="supplier" data-id="${sup.id}">${esc(sup.name)} (${Math.round(sup.leadMinutes / 60)} h, +${Math.round((sup.priceFactor - 1) * 100)}%)</button>`).join('')}
    </div>`;
    html += `<div class="supplier-row">Auto-Nachbestellung bei ≤ Mindestmenge → Lieferant:
      ${game.defs.suppliers.map((sup) => `<button class="btn small ${inv.autoSupplierId === sup.id ? 'primary' : ''}" data-action="auto-supplier" data-id="${sup.id}">${esc(sup.name)}</button>`).join('')}
      <span class="muted">Zielbestand: 2× Mindestmenge</span>
    </div>`;
    html += `<table class="parts-table"><thead><tr><th>Teil</th><th>Bestand</th><th>Reserv.</th><th>Min</th><th>Auto</th><th>EK</th><th>VK</th><th>Bestellen</th></tr></thead><tbody>`;
    for (const p of game.defs.parts) {
      const stock = inv.stock[p.id] ?? 0;
      const reserved = inv.reserved[p.id] ?? 0;
      const min = inv.minStock[p.id] ?? 0;
      const low = stock <= min;
      const highlight = this.highlightParts.has(p.id);
      const auto = !!inv.autoReorder[p.id];
      html += `<tr class="${highlight ? 'highlight' : ''} ${low ? 'low' : ''}">
        <td>${esc(p.name)}</td>
        <td class="num">${stock}</td>
        <td class="num">${reserved}</td>
        <td><input class="min-input" type="number" min="0" max="20" value="${min}" data-field="minstock" data-part="${p.id}"></td>
        <td><button class="btn small ${auto ? 'primary' : ''}" data-action="toggle-auto" data-part="${p.id}" title="Automatisch nachbestellen">${auto ? 'AN' : 'AUS'}</button></td>
        <td class="num">${eur(p.buyCents)}</td>
        <td class="num">${eur(EconomySystem.sellPrice(p.buyCents, s.economy.partsMarkupPct))}</td>
        <td class="btn-cell">
          <button class="btn small" data-action="order-part" data-part="${p.id}" data-qty="1">+1</button>
          <button class="btn small" data-action="order-part" data-part="${p.id}" data-qty="5">+5</button>
        </td>
      </tr>`;
    }
    html += `</tbody></table>`;
    const open = s.deliveries.filter((d) => !d.done);
    html += `<h3 class="section">Offene Bestellungen (${open.length})</h3>`;
    if (open.length === 0) html += `<p class="empty">Keine offenen Bestellungen.</p>`;
    for (const d of open) {
      const p = game.defs.parts.find((x) => x.id === d.partId)!;
      const sup = game.defs.suppliers.find((x) => x.id === d.supplierId)!;
      const etaH = Math.max(0, (d.arriveAtMinute - s.totalMinutes) / 60);
      html += `<div class="card compact">${d.quantity}× ${esc(p.name)} · ${esc(sup.name)} · Lieferung in ${etaH.toFixed(1)} h · ${eur(d.costCents)}</div>`;
    }
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
      <div class="meta muted">Kontostand (Liquidität)</div>`;
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
    html += `<h3 class="section">Letzte Buchungen</h3><div class="tx-list">`;
    for (const t of [...s.economy.transactions].slice(-14).reverse()) {
      html += `<div class="tx"><span class="tx-label">${esc(t.label)}</span><span class="${t.amountCents >= 0 ? 'pos' : 'neg'}">${t.amountCents >= 0 ? '+' : ''}${eur(t.amountCents)}</span></div>`;
    }
    html += `</div>`;
    return html;
  }

  private renderUpgrades(): string {
    const s = this.getGame().state;
    const lift3 = s.stations.find((x) => x.id === 'lift3');
    let html = `<div class="drawer-head"><h2>Werkstattausbau</h2></div>`;
    html += `<div class="card">
      <div class="card-title">Dritte Hebebühne</div>
      <div class="meta">Mehr Kapazität für parallele Reparaturen. Achtung: ohne Personal und Aufträge bringt sie keinen Nutzen.</div>
      <div class="meta">Kosten: ${eur(800000)}</div>
      ${lift3?.unlocked
        ? '<div class="chip st-delivered">Bereits installiert</div>'
        : `<div class="btn-row"><button class="btn primary" data-action="buy-lift">Kaufen</button></div>`}
    </div>`;
    html += `<div class="card">
      <div class="card-title">Zweiter Diagnoseplatz</div>
      <div class="meta">Diagnosen parallel statt im Nadelöhr – besonders mit mehreren Mitarbeitern sinnvoll.</div>
      <div class="meta">Kosten: ${eur(500000)}</div>
      ${s.stations.find((x) => x.id === 'diag2')?.unlocked
        ? '<div class="chip st-delivered">Bereits installiert</div>'
        : `<div class="btn-row"><button class="btn primary" data-action="buy-diag">Kaufen</button></div>`}
    </div>`;
    html += `<div class="card">
      <div class="card-title">Lagererweiterung (+60 Teile)</div>
      <div class="meta">Aktuelle Kapazität: ${s.inventory.capacity} Teile. Mehr Lager vermeidet Wartezeiten, bindet aber Kapital.</div>
      <div class="meta">Kosten: ${eur(250000)}</div>
      <div class="btn-row"><button class="btn primary" data-action="expand-storage">Kaufen</button></div>
    </div>`;
    return html;
  }

  private renderSettings(): string {
    const s = this.getGame().state;
    return `<div class="drawer-head"><h2>Einstellungen</h2></div>
      <div class="card">
        <div class="card-title">Kalkulation</div>
        <label class="field">Stundenverrechnungssatz (€)
          <input type="number" min="30" max="200" step="5" value="${(s.economy.hourlyRateCents / 100).toFixed(0)}" data-field="rate">
        </label>
        <label class="field">Ersatzteilaufschlag (%)
          <input type="number" min="0" max="150" step="5" value="${s.economy.partsMarkupPct}" data-field="markup">
        </label>
        <div class="meta muted">Höhere Preise steigern die Marge, aber preissensible Kunden lehnen Angebote eher ab.</div>
      </div>
      <div class="card">
        <div class="card-title">Spielstand</div>
        <div class="meta">Automatische Speicherung alle 30 Sekunden und nach wichtigen Ereignissen. Primär IndexedDB (großer Browserspeicher), Fallback localStorage. Kein Server.</div>
        <div class="meta muted">Bei 8× wird die Nacht (18:00–08:00) automatisch übersprungen. Untätige Mitarbeiter warten im Pausenraum, nach Feierabend werden sie ausgeblendet.</div>
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
      <div class="card compact muted">Seed: ${s.seed} · Savegame-Version ${s.version} · Garage Tycoon MVP</div>`;
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
      <div class="meta">Baujahr ${v.year} · ${v.mileageKm.toLocaleString('de-DE')} km · Klasse ${esc(v.vehicleClass)}</div>
      <div class="meta">Kunde: ${c ? esc(c.name) : '?'} (${c ? PROFILE_LABELS[c.profile] ?? '' : ''})</div>
      <div class="complaint">„${esc(o.complaint)}“</div>
      <div>${statusChip(o.status)} ${o.priority > 1 ? '<span class="chip prio">Priorität hoch</span>' : ''}</div>
      ${o.status === 'diagnosing' && o.diagnosisExtended ? '<div class="meta overdue">Nachuntersuchung läuft – der Diagnostiker ist unerfahren.</div>' : ''}
      ${(() => { const wr = OrderSystem.waitReason(game.ctx, o); return wr ? `<div class="card compact warn-card wait-card">⏳ ${esc(wr)}</div>` : ''; })()}
      <div class="meta">${dueLabel(o, s.totalMinutes)}${worker ? ` · Mitarbeiter: ${esc(worker.name)}` : ''}</div>
    </div>`;
    if (o.revealed) {
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
        html += `<div class="btn-row"><button class="btn warn" data-action="order-missing" data-id="${o.id}">Teile im Lager bestellen</button></div>`;
      }
      html += `<div class="card compact">
        ${o.estimateCents !== null ? `<div class="meta">Kostenvoranschlag: <strong>${eur(o.estimateCents)}</strong></div>` : ''}
        ${o.invoiceCents !== null ? `<div class="meta">Rechnung: <strong>${eur(o.invoiceCents)}</strong></div>` : ''}
        ${o.satisfaction !== null ? `<div class="meta">Kundenzufriedenheit: ${o.satisfaction}%</div>` : ''}
        <div class="meta muted">Tatsächliche Arbeitszeit: ${Math.round(o.laborMinutesActual)} min</div>
      </div>`;
    } else {
      html += `<p class="empty">Defekte unbekannt. Nach der Annahme führt ein Mitarbeiter die Diagnose durch.</p>`;
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
