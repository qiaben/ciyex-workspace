/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { StaffTvBoardEditorInput, WaitingRoomEditorInput } from './ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

// allow-any-unicode-next-line
// ─── Types ────────────────────────────────────────────────────────────────

interface AppointmentDTO {
	id: number;
	patientId: number;
	patientName?: string;
	providerId: number;
	providerName?: string;
	locationId: number;
	locationName?: string;
	visitType: string | { text?: string; coding?: Array<{ display?: string }> };
	status: string;
	appointmentStartTime: string;
	appointmentStartDate: string;
}

interface StatusOption {
	value: string;
	label: string;
	color?: string;
	terminal?: boolean;
}

interface Provider { id: number | string; name?: string; firstName?: string; lastName?: string; identification?: { firstName?: string; lastName?: string }; displayName?: string }
interface Location { id: number | string; name?: string }

const REFRESH_INTERVAL_MS = 15000;

const pad = (n: number) => n.toString().padStart(2, '0');

function todayISO(): string {
	const d = new Date();
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getInitials(name: string): string {
	if (!name) { return '?'; }
	return name
		.split(' ')
		.filter(Boolean)
		.map(w => w[0])
		.join('.')
		.toUpperCase();
}

function formatTime(timeStr: string): string {
	if (!timeStr) { return ''; }
	const [h, m] = timeStr.split(':');
	const hour = parseInt(h, 10);
	if (isNaN(hour)) { return timeStr; }
	const ampm = hour >= 12 ? 'PM' : 'AM';
	const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
	return `${h12}:${m} ${ampm}`;
}

/** Build a stable display name from the assorted shapes the backend returns. */
function providerName(p: Provider): string {
	if (p.identification?.firstName || p.identification?.lastName) {
		return `${p.identification.firstName || ''} ${p.identification.lastName || ''}`.trim();
	}
	if (p.firstName || p.lastName) {
		return `${p.firstName || ''} ${p.lastName || ''}`.trim();
	}
	return p.name || p.displayName || String(p.id);
}

function visitTypeText(v: AppointmentDTO['visitType']): string {
	if (!v) { return ''; }
	if (typeof v === 'string') { return v; }
	return v.text || v.coding?.[0]?.display || '';
}

/** Waiting-room friendly status label (matches ciyex-ehr-ui tv page). */
function waitLabel(status: string): string {
	switch (status) {
		case 'arrived': return 'Waiting';
		case 'checked-in': return 'Checked In';
		case 'booked':
		case 'proposed':
		case 'pending': return 'Upcoming';
		default: return status;
	}
}

// allow-any-unicode-next-line
// ─── Base TV editor (shared by Staff Board + Waiting Room) ────────────────

abstract class TvDisplayEditorBase extends EditorPane {

	protected abstract readonly mode: 'staff' | 'waiting-room';

	protected root!: HTMLElement;
	protected headerEl!: HTMLElement;
	protected mainEl!: HTMLElement;
	protected practiceLabelEl!: HTMLElement;
	protected clockDateEl!: HTMLElement;
	protected clockTimeEl!: HTMLElement;

	protected appointments: AppointmentDTO[] = [];
	protected providers: Provider[] = [];
	protected locations: Location[] = [];
	protected statusOptions: StatusOption[] = [];
	protected practiceName: string = 'Practice';
	protected loading: boolean = true;

	private clockTimer: number | null = null;
	private refreshTimer: number | null = null;

	constructor(
		id: string,
		group: IEditorGroup,
		telemetryService: ITelemetryService,
		themeService: IThemeService,
		storageService: IStorageService,
		protected readonly apiService: ICiyexApiService,
	) {
		super(id, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.tv-display-editor.ciyex-editor-root'));
		// Follow the active workbench theme for both modes (QA: previously the
		// staff board was hardcoded black and the waiting room a fixed blue
		// gradient, ignoring the user's theme). The waiting room keeps a subtle
		// accent gradient layered on top of the theme background so it still
		// reads as a distinct, welcoming screen — but the gradient is built from
		// theme tokens, so it adapts to light/dark instead of being fixed blue.
		const bg = this.mode === 'staff'
			? 'var(--vscode-editor-background)'
			: 'linear-gradient(135deg, var(--vscode-editorWidget-background, var(--vscode-editor-background)) 0%, var(--vscode-editor-background) 100%)';
		this.root.style.cssText = `height:100%;display:flex;flex-direction:column;background:${bg};color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family, system-ui, -apple-system, sans-serif);`;
		this.headerEl = DOM.append(this.root, DOM.$('div'));
		this.headerEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--vscode-editorWidget-border, rgba(127,127,127,0.25));';
		this.mainEl = DOM.append(this.root, DOM.$('div'));
		this.mainEl.style.cssText = 'flex:1;overflow-y:auto;padding:24px;';
		this._renderHeader();
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._startClock();
		this._renderMain();
		await this._loadReferenceData();
		await this._loadAppointments();
		this._startAutoRefresh();
	}

	override clearInput(): void {
		this._stopClock();
		this._stopAutoRefresh();
		super.clearInput();
	}

	override dispose(): void {
		this._stopClock();
		this._stopAutoRefresh();
		super.dispose();
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.width = `${dimension.width}px`;
		this.root.style.height = `${dimension.height}px`;
	}

	// allow-any-unicode-next-line
	// ─── Header ────────────────────────────────────────────────────────────

	private _renderHeader(): void {
		DOM.clearNode(this.headerEl);

		// Practice name (left)
		this.practiceLabelEl = DOM.append(this.headerEl, DOM.$('div'));
		this.practiceLabelEl.style.cssText = 'font-size:20px;font-weight:700;';
		this.practiceLabelEl.textContent = this.practiceName;

		// Live clock (center)
		const clockWrap = DOM.append(this.headerEl, DOM.$('div'));
		clockWrap.style.cssText = 'text-align:center;';
		this.clockDateEl = DOM.append(clockWrap, DOM.$('div'));
		this.clockDateEl.style.cssText = 'font-size:14px;font-weight:500;opacity:0.8;';
		this.clockTimeEl = DOM.append(clockWrap, DOM.$('div'));
		this.clockTimeEl.style.cssText = 'font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;';
		this._updateClock();

		// Action buttons (right)
		const actions = DOM.append(this.headerEl, DOM.$('div'));
		actions.style.cssText = 'display:flex;align-items:center;gap:8px;';

		// Refresh-now
		const refreshBtn = this._makeIconButton(actions, 'Refresh', 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5');
		refreshBtn.addEventListener('click', () => { void this._loadAppointments(); });

		// Fullscreen toggle
		const fsBtn = this._makeIconButton(actions, 'Toggle Fullscreen', 'M3 7V3h4 M21 7V3h-4 M3 17v4h4 M21 17v4h-4');
		fsBtn.addEventListener('click', () => this._toggleFullscreen());

		// Close
		const closeBtn = this._makeIconButton(actions, 'Close', 'M18 6 6 18 M6 6l12 12');
		closeBtn.addEventListener('click', () => { void this.group.closeEditor(this.input!); });
	}

	private _makeIconButton(parent: HTMLElement, title: string, pathData: string): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.title = title;
		btn.setAttribute('aria-label', title);
		const btnBg = 'var(--vscode-button-secondaryBackground, rgba(127,127,127,0.12))';
		const btnHover = 'var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,0.22))';
		btn.style.cssText = `display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:${btnBg};border:1px solid var(--vscode-editorWidget-border, rgba(127,127,127,0.25));border-radius:8px;color:var(--vscode-foreground);cursor:pointer;padding:0;`;
		btn.addEventListener('mouseenter', () => { btn.style.background = btnHover; });
		btn.addEventListener('mouseleave', () => { btn.style.background = btnBg; });
		const SVG_NS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
		svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
		svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
		// Split combined "M ... M ..." path on each `M` so multi-stroke icons render
		// as separate paths (single-path with multiple "M"s also works, but each
		// path keeps the strokes cleanly separable).
		const segments = pathData.split(/(?=M)/g).map(s => s.trim()).filter(Boolean);
		for (const d of segments) {
			const p = document.createElementNS(SVG_NS, 'path');
			p.setAttribute('d', d);
			svg.appendChild(p);
		}
		btn.appendChild(svg);
		return btn;
	}

	// allow-any-unicode-next-line
	// ─── Live clock ────────────────────────────────────────────────────────

	private _updateClock(): void {
		if (!this.clockDateEl || !this.clockTimeEl) { return; }
		const now = new Date();
		this.clockDateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
		this.clockTimeEl.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
	}

	private _startClock(): void {
		this._stopClock();
		this.clockTimer = DOM.getActiveWindow().setInterval(() => this._updateClock(), 1000);
	}

	private _stopClock(): void {
		if (this.clockTimer !== null) { DOM.getActiveWindow().clearInterval(this.clockTimer); this.clockTimer = null; }
	}

	// allow-any-unicode-next-line
	// ─── Fullscreen ────────────────────────────────────────────────────────

	private _toggleFullscreen(): void {
		const doc = DOM.getActiveWindow().document;
		const target = (this.root.ownerDocument?.documentElement || doc.documentElement) as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
		const docAny = doc as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
		const isFs = !!(doc.fullscreenElement || docAny.webkitFullscreenElement);
		if (isFs) {
			(doc.exitFullscreen || docAny.webkitExitFullscreen)?.call(doc);
		} else {
			(target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
		}
	}

	// allow-any-unicode-next-line
	// ─── Auto-refresh ──────────────────────────────────────────────────────

	private _startAutoRefresh(): void {
		this._stopAutoRefresh();
		this.refreshTimer = DOM.getActiveWindow().setInterval(() => { void this._loadAppointments(); }, REFRESH_INTERVAL_MS);
	}

	private _stopAutoRefresh(): void {
		if (this.refreshTimer !== null) { DOM.getActiveWindow().clearInterval(this.refreshTimer); this.refreshTimer = null; }
	}

	// allow-any-unicode-next-line
	// ─── Data ──────────────────────────────────────────────────────────────

	private async _loadReferenceData(): Promise<void> {
		try {
			const [provRes, locRes, statusRes] = await Promise.all([
				this.apiService.fetch('/api/providers').catch(() => null),
				this.apiService.fetch('/api/locations').catch(() => null),
				this.apiService.fetch('/api/appointments/status-options').catch(() => null),
			]);

			if (provRes?.ok) {
				const d = await provRes.json();
				const raw = (d?.data?.content || d?.data || d?.content || d || []) as Provider[];
				this.providers = raw.map(p => ({ ...p, name: providerName(p) }));
			}
			if (locRes?.ok) {
				const d = await locRes.json();
				const list = (d?.data?.content || d?.data || d?.content || d || []) as Location[];
				this.locations = list;
				// Derive practice name from the first location: "Sunrise Family
				// Medicine - Main Clinic" → "Sunrise Family Medicine".
				if (list.length > 0) {
					const first = String(list[0].name || '');
					const dashIdx = first.indexOf(' - ');
					this.practiceName = dashIdx > 0 ? first.substring(0, dashIdx) : first;
					if (this.practiceLabelEl) { this.practiceLabelEl.textContent = this.practiceName || 'Practice'; }
				}
			}
			if (statusRes?.ok) {
				const d = await statusRes.json();
				const opts = (d?.data || d || []) as Array<StatusOption | string>;
				this.statusOptions = opts.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
			}
		} catch { /* fall back to empty refs */ }
	}

	private async _fetchPatientName(id: number | string): Promise<string> {
		try {
			const res = await this.apiService.fetch(`/api/patients/${id}`);
			if (!res.ok) { return String(id); }
			const data = await res.json();
			const p = data?.data || data;
			const first = p?.firstName || p?.identification?.firstName || '';
			const last = p?.lastName || p?.identification?.lastName || '';
			const full = `${first} ${last}`.trim();
			return full || String(id);
		} catch {
			return String(id);
		}
	}

	private async _loadAppointments(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/appointments?page=0&size=200');
			if (!res.ok) { return; }
			const data = await res.json();
			const list = (data?.data?.content || data?.data || data?.content || data || []) as AppointmentDTO[];

			// Filter to today only
			const todayStr = todayISO();
			const todayList = list.filter(a => {
				const d = String(a.appointmentStartDate || '');
				// Strip time portion if the backend returns full ISO
				const dateOnly = d.includes('T') ? d.split('T')[0] : d;
				return dateOnly === todayStr;
			});

			// Resolve patient/provider/location display names (patients fetched
			// individually to match the EHR-UI behavior; capped at 200 above so
			// the fan-out is bounded).
			const enriched: AppointmentDTO[] = await Promise.all(todayList.map(async a => {
				const patientName = a.patientName || await this._fetchPatientName(a.patientId);
				const provider = this.providers.find(p => String(p.id) === String(a.providerId));
				const location = this.locations.find(l => String(l.id) === String(a.locationId));
				const enrichedAppt: AppointmentDTO = {
					...a,
					patientName,
					providerName: provider?.name || String(a.providerId),
					locationName: location?.name || '',
				};
				return enrichedAppt;
			}));

			enriched.sort((a, b) => (a.appointmentStartTime || '').localeCompare(b.appointmentStartTime || ''));
			this.appointments = enriched;
			this.loading = false;
			this._renderMain();
		} catch { /* swallow — auto-refresh will retry */ }
	}

	// allow-any-unicode-next-line
	// ─── Render ────────────────────────────────────────────────────────────

	private _renderMain(): void {
		DOM.clearNode(this.mainEl);

		if (this.loading) {
			const loadingEl = DOM.append(this.mainEl, DOM.$('div'));
			loadingEl.style.cssText = 'display:flex;align-items:center;justify-content:center;height:50vh;font-size:18px;opacity:0.6;';
			loadingEl.textContent = 'Loading appointments…';
			return;
		}

		if (this.mode === 'staff') {
			this._renderStaffBoard();
		} else {
			this._renderWaitingRoom();
		}
	}

	private _getStatusOption(value: string): StatusOption | undefined {
		return this.statusOptions.find(s => s.value === value);
	}

	private _getStatusColor(value: string): string {
		return this._getStatusOption(value)?.color || '#94a3b8';
	}

	private _getStatusLabel(value: string): string {
		return this._getStatusOption(value)?.label || value;
	}

	// allow-any-unicode-next-line
	// ─── Staff Board ───────────────────────────────────────────────────────

	private _renderStaffBoard(): void {
		if (this.appointments.length === 0) {
			const empty = DOM.append(this.mainEl, DOM.$('div'));
			empty.style.cssText = 'text-align:center;padding:64px 0;font-size:18px;opacity:0.4;';
			empty.textContent = 'No appointments for today';
			return;
		}

		const table = DOM.append(this.mainEl, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;';

		const thead = DOM.append(table, DOM.$('thead'));
		const headRow = DOM.append(thead, DOM.$('tr'));
		headRow.style.cssText = 'border-bottom:1px solid var(--vscode-editorWidget-border, rgba(127,127,127,0.35));text-align:left;';
		for (const h of ['Time', 'Patient', 'Provider', 'Location', 'Type', 'Status']) {
			const th = DOM.append(headRow, DOM.$('th'));
			th.style.cssText = 'padding:12px 16px;font-size:12px;font-weight:600;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px;';
			th.textContent = h;
		}

		const tbody = DOM.append(table, DOM.$('tbody'));
		for (const a of this.appointments) {
			const tr = DOM.append(tbody, DOM.$('tr'));
			const isCancelled = a.status === 'cancelled';
			tr.style.cssText = `border-bottom:1px solid var(--vscode-editorWidget-border, rgba(127,127,127,0.15));${isCancelled ? 'opacity:0.3;' : ''}`;

			const timeCell = DOM.append(tr, DOM.$('td'));
			timeCell.style.cssText = 'padding:14px 16px;font-size:16px;font-weight:500;font-variant-numeric:tabular-nums;';
			timeCell.textContent = formatTime(a.appointmentStartTime);

			const patientCell = DOM.append(tr, DOM.$('td'));
			patientCell.style.cssText = 'padding:14px 16px;font-size:16px;font-weight:500;';
			patientCell.textContent = a.patientName || '—';

			const provCell = DOM.append(tr, DOM.$('td'));
			provCell.style.cssText = 'padding:14px 16px;font-size:14px;opacity:0.8;';
			provCell.textContent = a.providerName || '';

			const locCell = DOM.append(tr, DOM.$('td'));
			locCell.style.cssText = 'padding:14px 16px;font-size:14px;opacity:0.8;';
			locCell.textContent = a.locationName || '';

			const typeCell = DOM.append(tr, DOM.$('td'));
			typeCell.style.cssText = 'padding:14px 16px;font-size:14px;opacity:0.8;';
			typeCell.textContent = visitTypeText(a.visitType);

			const statusCell = DOM.append(tr, DOM.$('td'));
			statusCell.style.cssText = 'padding:14px 16px;';
			this._renderStatusPill(statusCell, a.status);
		}

		// Summary bar
		const summary = DOM.append(this.mainEl, DOM.$('div'));
		summary.style.cssText = 'margin-top:24px;display:flex;align-items:center;gap:24px;padding:12px 16px;background:var(--vscode-editorWidget-background, rgba(127,127,127,0.08));border:1px solid var(--vscode-editorWidget-border, rgba(127,127,127,0.2));border-radius:8px;font-size:14px;flex-wrap:wrap;';

		const counts: Record<string, number> = {};
		for (const a of this.appointments) { counts[a.status] = (counts[a.status] || 0) + 1; }
		for (const s of this.statusOptions) {
			if (!counts[s.value]) { continue; }
			const item = DOM.append(summary, DOM.$('span'));
			item.style.cssText = 'display:flex;align-items:center;gap:8px;';
			const dot = DOM.append(item, DOM.$('span'));
			dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color || '#94a3b8'};`;
			const label = DOM.append(item, DOM.$('span'));
			label.style.cssText = 'opacity:0.7;';
			label.textContent = `${s.label}:`;
			const count = DOM.append(item, DOM.$('span'));
			count.style.cssText = 'font-weight:700;';
			count.textContent = String(counts[s.value]);
		}

		const total = DOM.append(summary, DOM.$('span'));
		total.style.cssText = 'margin-left:auto;opacity:0.7;';
		const totalCount = DOM.append(total, DOM.$('span'));
		totalCount.style.cssText = 'font-weight:700;opacity:1;';
		total.appendChild(document.createTextNode('Total: '));
		total.appendChild(totalCount);
		totalCount.textContent = String(this.appointments.length);
	}

	private _renderStatusPill(parent: HTMLElement, status: string): void {
		const color = this._getStatusColor(status);
		const pill = DOM.append(parent, DOM.$('span'));
		pill.style.cssText = `display:inline-flex;align-items:center;gap:8px;padding:4px 12px;border-radius:9999px;font-size:13px;font-weight:600;background:${color}30;color:${color};`;
		const dot = DOM.append(pill, DOM.$('span'));
		dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};`;
		const label = DOM.append(pill, DOM.$('span'));
		label.textContent = this._getStatusLabel(status);
	}

	// allow-any-unicode-next-line
	// ─── Waiting Room (HIPAA-safe — initials only) ─────────────────────────

	private _renderWaitingRoom(): void {
		const welcome = DOM.append(this.mainEl, DOM.$('div'));
		welcome.style.cssText = 'text-align:center;margin-bottom:32px;';
		const welcomeH = DOM.append(welcome, DOM.$('h2'));
		welcomeH.style.cssText = 'font-size:22px;font-weight:300;opacity:0.85;margin:0;';
		welcomeH.textContent = 'Welcome! Your provider will be with you shortly.';

		const active = this.appointments.filter(a => {
			const opt = this._getStatusOption(a.status);
			return !opt?.terminal && a.status !== 'cancelled' && a.status !== 'fulfilled';
		});

		if (active.length === 0) {
			const empty = DOM.append(this.mainEl, DOM.$('div'));
			empty.style.cssText = 'text-align:center;padding:64px 0;font-size:18px;opacity:0.4;';
			empty.textContent = 'No patients currently waiting';
			return;
		}

		const grid = DOM.append(this.mainEl, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;';

		for (const a of active) {
			const color = this._getStatusColor(a.status);
			const card = DOM.append(grid, DOM.$('div'));
			card.style.cssText = `padding:20px;border-radius:12px;text-align:center;background:var(--vscode-editorWidget-background, rgba(127,127,127,0.08));border:1px solid var(--vscode-editorWidget-border, rgba(127,127,127,0.18));border-left:4px solid ${color};`;

			const initials = DOM.append(card, DOM.$('div'));
			initials.style.cssText = 'font-size:28px;font-weight:700;margin-bottom:8px;opacity:0.9;';
			initials.textContent = getInitials(a.patientName || '');

			const time = DOM.append(card, DOM.$('div'));
			time.style.cssText = 'font-size:13px;opacity:0.6;margin-bottom:12px;';
			time.textContent = formatTime(a.appointmentStartTime);

			const pill = DOM.append(card, DOM.$('span'));
			pill.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600;background:${color}30;color:${color};`;
			const dot = DOM.append(pill, DOM.$('span'));
			dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};`;
			const lbl = DOM.append(pill, DOM.$('span'));
			lbl.textContent = waitLabel(a.status);
		}

		const footer = DOM.append(this.mainEl, DOM.$('div'));
		footer.style.cssText = 'margin-top:32px;text-align:center;font-size:13px;opacity:0.5;';
		footer.textContent = `Currently Serving: ${active.length} patient${active.length !== 1 ? 's' : ''}`;
	}
}

// allow-any-unicode-next-line
// ─── Concrete editors (Staff Board + Waiting Room) ────────────────────────

export class StaffTvBoardEditor extends TvDisplayEditorBase {
	static readonly ID = 'workbench.editor.ciyexStaffTvBoard';
	protected readonly mode = 'staff';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService apiService: ICiyexApiService,
	) {
		super(StaffTvBoardEditor.ID, group, telemetryService, themeService, storageService, apiService);
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		if (!(input instanceof StaffTvBoardEditorInput)) { return; }
		await super.setInput(input, options, context, token);
	}
}

export class WaitingRoomEditor extends TvDisplayEditorBase {
	static readonly ID = 'workbench.editor.ciyexWaitingRoom';
	protected readonly mode = 'waiting-room';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService apiService: ICiyexApiService,
	) {
		super(WaitingRoomEditor.ID, group, telemetryService, themeService, storageService, apiService);
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		if (!(input instanceof WaitingRoomEditorInput)) { return; }
		await super.setInput(input, options, context, token);
	}
}
