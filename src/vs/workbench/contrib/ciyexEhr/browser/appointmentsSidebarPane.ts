/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import * as DOM from '../../../../base/browser/dom.js';
import { createActionIconButton, createOverflowMenuButton, createRowActionsContainer, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE, IOverflowMenuItem } from './sidebarActions.js';

interface FhirActor {
	reference?: string;
	display?: string;
}

interface FhirParticipant {
	actor?: FhirActor;
	type?: Array<{ coding?: Array<{ code?: string; system?: string }> }>;
}

interface Appointment {
	id: number | string;
	patientId?: number | string;
	patientName?: string;
	patientFirstName?: string;
	patientLastName?: string;
	providerName?: string;
	practitionerName?: string;
	locationName?: string;
	visitType?: string;
	appointmentType?: string | { text?: string; coding?: Array<{ display?: string; code?: string }> };
	type?: string;
	status?: string;
	room?: string;
	appointmentStartDate?: string;
	appointmentStartTime?: string;
	appointmentEndTime?: string;
	start?: string;
	startTime?: string;
	end?: string;
	encounterId?: string;
	// FHIR fields — flat format returned by /api/fhir-resource/appointments
	patient?: string;          // e.g. "Patient/1146"
	provider?: string;         // e.g. "Practitioner/12"
	location?: string;
	patientDisplay?: string;   // human-readable patient name
	providerDisplay?: string;
	locationDisplay?: string;
	// Full FHIR participant/subject format (alternative response shape)
	participant?: FhirParticipant[];
	subject?: FhirActor;
}

type DateFilter = 'all' | 'today' | 'past' | 'upcoming' | 'last7' | 'thisMonth' | 'lastMonth';

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
	{ value: 'all', label: 'All Time' },
	{ value: 'today', label: 'Today' },
	{ value: 'past', label: 'Past' },
	{ value: 'upcoming', label: 'Upcoming' },
	{ value: 'last7', label: 'Last 7 Days' },
	{ value: 'thisMonth', label: 'Current Month' },
	{ value: 'lastMonth', label: 'Last Month' },
];

const STATUS_COLORS: Record<string, string> = {
	scheduled: '#3b82f6',
	confirmed: '#6366f1',
	arrived: '#f59e0b',
	'checked-in': '#8b5cf6',
	'in-room': '#06b6d4',
	'with-provider': '#22c55e',
	fulfilled: '#6b7280',
	completed: '#6b7280',
	cancelled: '#ef4444',
	noshow: '#dc2626',
	'no-show': '#dc2626',
};

function getAppointmentType(apt: Appointment): string {
	const t = apt.appointmentType;
	if (typeof t === 'string') { return t; }
	if (t && typeof t === 'object') { return t.text || t.coding?.[0]?.display || t.coding?.[0]?.code || ''; }
	return apt.visitType || apt.type || '';
}

function patientNameOf(apt: Appointment): string {
	// Flat FHIR format: patientDisplay field
	if (apt.patientDisplay) { return apt.patientDisplay; }
	// Legacy direct fields
	if (apt.patientName) { return apt.patientName; }
	const fromNames = `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim();
	if (fromNames) { return fromNames; }
	// Full FHIR participant array
	if (apt.participant) {
		for (const p of apt.participant) {
			const ref = p.actor?.reference || '';
			if (ref.startsWith('Patient/') && p.actor?.display) { return p.actor.display; }
		}
		for (const p of apt.participant) {
			if (p.actor?.display) { return p.actor.display; }
		}
	}
	if (apt.subject?.display) { return apt.subject.display; }
	return 'Unknown';
}

/** Resolve the patient ID from any supported field or FHIR reference string. */
function resolvePatientId(apt: Appointment): string | undefined {
	// Flat FHIR format: "patient": "Patient/1146"
	if (apt.patient) {
		const match = /^Patient\/(.+)$/.exec(apt.patient);
		if (match) { return match[1]; }
	}
	if (apt.patientId !== undefined && apt.patientId !== null && String(apt.patientId).trim() !== '') {
		return String(apt.patientId);
	}
	if (apt.participant) {
		for (const p of apt.participant) {
			const match = /^Patient\/(.+)$/.exec(p.actor?.reference || '');
			if (match) { return match[1]; }
		}
	}
	if (apt.subject?.reference) {
		const match = /^Patient\/(.+)$/.exec(apt.subject.reference);
		if (match) { return match[1]; }
	}
	return undefined;
}

function providerNameOf(apt: Appointment): string {
	return apt.providerDisplay || apt.providerName || apt.practitionerName || '';
}

function locationOf(apt: Appointment): string {
	return apt.locationDisplay || apt.locationName || '';
}

function parseStart(apt: Appointment): Date | null {
	const raw = apt.start || apt.startTime;
	if (raw) {
		const d = new Date(String(raw));
		if (!isNaN(d.getTime())) { return d; }
	}
	if (apt.appointmentStartDate) {
		const dt = apt.appointmentStartTime ? `${apt.appointmentStartDate}T${apt.appointmentStartTime}` : apt.appointmentStartDate;
		const d = new Date(dt);
		if (!isNaN(d.getTime())) { return d; }
	}
	return null;
}

export class AppointmentsSidebarPane extends ViewPane {

	static readonly ID = 'ciyex.appointments.sidebar';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private searchInput?: HTMLInputElement;
	private appointments: Appointment[] = [];
	private loaded = false;
	private searchValue = '';
	private dateFilter: DateFilter = 'all';
	private statusFilter = '';
	private visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
	private statusOptions: string[] = [];
	private refreshTimer: number | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ILogService private readonly logService: ILogService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Clear cached appointments + status options on logout so a re-login
		// as a different user doesn't surface the previous user's schedule.
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.NotAuthenticated) {
				this.appointments = [];
				this.loaded = false;
				this.statusOptions = [];
				this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
			} else if (state === CiyexAuthState.Authenticated) {
				this.appointments = [];
				this.loaded = false;
				this.statusOptions = [];
				this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
				if (this.container) {
					void this._loadAll();
				}
			}
		}));
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.appts-sidebar.ciyex-editor-root'));
		this.container.style.cssText = 'padding:0;height:100%;font-size:12px;display:flex;flex-direction:column;';
		this._render();

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try { if (!localStorage.getItem('ciyex_token')) { return; } } catch { return; }
			if (!this.loaded) {
				this._loadAll();
			} else {
				win.clearInterval(poll);
				this.refreshTimer = win.setInterval(() => this._loadAll(), 30000);
			}
		}, 2000);

		this._loadAll();
	}

	private async _loadAll(): Promise<void> {
		await Promise.all([this._loadAppointments(), this._loadStatusOptions()]);
		this._render();
		// Fetch names for any appointments still showing Unknown (FHIR responses
		// sometimes omit display text — fall back to the patient demographics API)
		await this._enrichPatientNames();
		this._render();
	}

	private async _enrichPatientNames(): Promise<void> {
		const missing = this.appointments.filter(a => patientNameOf(a) === 'Unknown');
		const ids = [...new Set(missing.map(a => resolvePatientId(a)).filter((id): id is string => !!id))];
		if (ids.length === 0) { return; }

		const batchSize = 10;
		for (let i = 0; i < ids.length; i += batchSize) {
			const batch = ids.slice(i, i + batchSize);
			await Promise.all(batch.map(async (pid) => {
				try {
					const res = await this.apiService.fetch(`/api/patients/${pid}`);
					if (res.ok) {
						const d = await res.json();
						const p = d?.data || d || {};
						const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
						if (name) {
							for (const apt of this.appointments) {
								if (resolvePatientId(apt) === pid && patientNameOf(apt) === 'Unknown') {
									apt.patientName = name;
								}
							}
						}
					}
				} catch { /* non-critical */ }
			}));
		}
	}

	private async _loadAppointments(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/fhir-resource/appointments?page=0&size=500');
			if (res.ok) {
				const data = await res.json();
				const raw: Appointment[] = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
				this.appointments = raw;
				this.loaded = true;
			}
		} catch (err) {
			this.logService.warn('[Appts] failed to load appointments:', err);
		}
	}

	private async _loadStatusOptions(): Promise<void> {
		if (this.statusOptions.length > 0) { return; }
		try {
			const res = await this.apiService.fetch('/api/appointments/status-options');
			if (res.ok) {
				const data = await res.json();
				const opts = (data?.data || data || []) as Array<string | { value: string; label?: string }>;
				this.statusOptions = opts.map(o => typeof o === 'string' ? o : (o.value || o.label || '')).filter(Boolean);
			}
		} catch { /* */ }
		if (this.statusOptions.length === 0) {
			this.statusOptions = ['Scheduled', 'Confirmed', 'Arrived', 'Checked-in', 'In Room', 'With Provider', 'Completed', 'No Show', 'Cancelled'];
		}
	}

	private _isInDateRange(apt: Appointment): boolean {
		if (this.dateFilter === 'all') { return true; }
		const d = parseStart(apt);
		if (!d) { return false; }
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const dDay = new Date(d);
		dDay.setHours(0, 0, 0, 0);

		switch (this.dateFilter) {
			case 'today': return dDay.getTime() === today.getTime();
			case 'past': return d.getTime() < new Date().getTime();
			case 'upcoming': return d.getTime() >= new Date().getTime();
			case 'last7': {
				const start = new Date(today); start.setDate(today.getDate() - 7);
				return d >= start && d <= new Date(today.getTime() + 86400000);
			}
			case 'thisMonth': {
				const first = new Date(today.getFullYear(), today.getMonth(), 1);
				const last = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
				return d >= first && d <= last;
			}
			case 'lastMonth': {
				const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
				const last = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
				return d >= first && d <= last;
			}
			default: return true;
		}
	}

	private _getFiltered(): Appointment[] {
		const q = this.searchValue.toLowerCase();
		let out = this.appointments.filter(a => this._isInDateRange(a));
		if (q) {
			out = out.filter(a =>
				patientNameOf(a).toLowerCase().includes(q) ||
				providerNameOf(a).toLowerCase().includes(q) ||
				getAppointmentType(a).toLowerCase().includes(q),
			);
		}
		if (this.statusFilter) {
			out = out.filter(a => (a.status || '').toLowerCase() === this.statusFilter.toLowerCase());
		}
		// Sort upcoming first (closest to now), then by time
		out.sort((a, b) => {
			const da = parseStart(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
			const db = parseStart(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
			return da - db;
		});
		return out;
	}

	private _render(): void {
		DOM.clearNode(this.container);
		this._renderHeader();
		this._renderStats();
		this._renderSearch();
		this._renderFilters();
		this._renderList();
		this._renderPagination();
	}

	private _renderHeader(): void {
		// Title is already shown by the VS Code view container + view pane headers;
		// here we only need the action toolbar (new + refresh) aligned to the right.
		const header = DOM.append(this.container, DOM.$('.menu-header'));
		header.style.cssText = 'padding:6px 10px;display:flex;align-items:center;justify-content:flex-end;gap:6px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		createActionIconButton(header, '+', 'New Appointment', () => this.commandService.executeCommand('ciyex.openAppointments'));
		createActionIconButton(header, '\u{21BB}', 'Refresh', () => this._loadAll());
	}

	private _renderStats(): void {
		const bar = DOM.append(this.container, DOM.$('.stats-bar'));
		bar.style.cssText = 'display:flex;gap:2px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const filtered = this._getFiltered();
		const total = filtered.length;
		const upcoming = filtered.filter(a => { const d = parseStart(a); return d && d.getTime() >= Date.now(); }).length;
		const completed = filtered.filter(a => ['completed', 'fulfilled'].includes((a.status || '').toLowerCase())).length;
		const cancelled = filtered.filter(a => ['cancelled', 'noshow', 'no-show'].includes((a.status || '').toLowerCase())).length;

		this._statBadge(bar, String(total), 'Total', 'var(--vscode-foreground)');
		this._statBadge(bar, String(upcoming), 'Upcoming', '#3b82f6');
		this._statBadge(bar, String(completed), 'Done', '#22c55e');
		if (cancelled > 0) { this._statBadge(bar, String(cancelled), 'Cancel', '#ef4444'); }
	}

	private _statBadge(parent: HTMLElement, value: string, label: string, color: string): void {
		const badge = DOM.append(parent, DOM.$('.stat'));
		badge.style.cssText = 'flex:1;text-align:center;padding:4px 2px;border-radius:4px;background:rgba(128,128,128,0.08);';
		const val = DOM.append(badge, DOM.$('div'));
		val.textContent = value;
		val.style.cssText = `font-size:15px;font-weight:700;color:${color};line-height:1.2;`;
		const lbl = DOM.append(badge, DOM.$('div'));
		lbl.textContent = label;
		lbl.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;';
	}

	private _renderSearch(): void {
		const wrap = DOM.append(this.container, DOM.$('.search-row'));
		wrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		this.searchInput = input;
		input.type = 'text';
		input.placeholder = 'Search patient, provider, type...';
		input.value = this.searchValue;
		input.style.cssText = 'width:100%;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;box-sizing:border-box;';
		input.addEventListener('input', () => {
			this.searchValue = input.value;
			this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
			this._render();
			if (this.searchInput) { this.searchInput.focus(); this.searchInput.setSelectionRange(this.searchValue.length, this.searchValue.length); }
		});
	}

	private _renderFilters(): void {
		const wrap = DOM.append(this.container, DOM.$('.filters'));
		wrap.style.cssText = 'display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		// Date filter dropdown
		const dateSel = DOM.append(wrap, DOM.$('select')) as HTMLSelectElement;
		dateSel.style.cssText = 'flex:1;padding:3px 4px;background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border,#3c3c3c);border-radius:3px;color:var(--vscode-dropdown-foreground);font-size:11px;cursor:pointer;';
		for (const opt of DATE_OPTIONS) {
			const o = DOM.append(dateSel, DOM.$('option')) as HTMLOptionElement;
			o.value = opt.value;
			o.textContent = opt.label;
			if (opt.value === this.dateFilter) { o.selected = true; }
		}
		dateSel.addEventListener('change', () => {
			this.dateFilter = dateSel.value as DateFilter;
			this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
			this._render();
		});

		// Status filter dropdown
		const statusSel = DOM.append(wrap, DOM.$('select')) as HTMLSelectElement;
		statusSel.style.cssText = 'flex:1;padding:3px 4px;background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border,#3c3c3c);border-radius:3px;color:var(--vscode-dropdown-foreground);font-size:11px;cursor:pointer;';
		const allOpt = DOM.append(statusSel, DOM.$('option')) as HTMLOptionElement;
		allOpt.value = '';
		allOpt.textContent = 'All Status';
		for (const s of this.statusOptions) {
			const o = DOM.append(statusSel, DOM.$('option')) as HTMLOptionElement;
			o.value = s;
			o.textContent = s;
			if (s === this.statusFilter) { o.selected = true; }
		}
		statusSel.addEventListener('change', () => {
			this.statusFilter = statusSel.value;
			this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
			this._render();
		});
	}

	private _renderList(): void {
		this.listEl = DOM.append(this.container, DOM.$('.appt-list'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;min-height:0;';

		const filtered = this._getFiltered();
		if (filtered.length === 0) {
			const empty = DOM.append(this.listEl, DOM.$('.empty'));
			empty.style.cssText = 'padding:20px 10px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
			empty.textContent = this.loaded ? 'No appointments match the filters' : 'Loading...';
			return;
		}

		const visible = Math.min(this.visibleCount, filtered.length);
		for (let i = 0; i < visible; i++) { this._renderRow(filtered[i]); }
	}

	private _renderRow(apt: Appointment): void {
		const statusKey = (apt.status || 'scheduled').toLowerCase();
		const statusColor = STATUS_COLORS[statusKey] || '#6b7280';

		const row = DOM.append(this.listEl, DOM.$('.appt-row'));
		row.style.cssText = `padding:7px 10px;border-left:3px solid ${statusColor};border-bottom:1px solid rgba(128,128,128,0.06);cursor:pointer;position:relative;`;

		// Top: DATE/TIME PATIENT STATUS
		const top = DOM.append(row, DOM.$('.top'));
		top.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px;';

		const d = parseStart(apt);
		const time = DOM.append(top, DOM.$('span'));
		time.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-foreground);flex-shrink:0;';
		if (d) {
			const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
			time.textContent = `${dateStr} ${timeStr}`;
		} else {
			time.textContent = '--';
		}

		const name = DOM.append(top, DOM.$('span'));
		name.textContent = patientNameOf(apt);
		name.style.cssText = 'flex:1;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-foreground);';

		const badge = DOM.append(top, DOM.$('span'));
		badge.textContent = (apt.status || 'scheduled').replace(/-/g, ' ');
		badge.style.cssText = `font-size:9px;padding:1px 5px;border-radius:3px;text-transform:capitalize;background:${statusColor};color:#fff;font-weight:500;white-space:nowrap;flex-shrink:0;`;

		// ⋯ actions button — hidden until row hover, placed at far-right of the top bar
		const actions = createRowActionsContainer(top);
		actions.style.cssText = 'display:flex;gap:2px;align-items:center;margin-left:4px;flex-shrink:0;opacity:0;transition:opacity 0.1s;';

		row.addEventListener('mouseenter', () => {
			row.style.background = 'var(--vscode-list-hoverBackground)';
			actions.style.opacity = '1';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = '';
			actions.style.opacity = '0';
		});
		row.addEventListener('click', (e) => {
			if (actions.contains(e.target as Node)) { return; }
			this._openChart(apt);
		});

		// Middle: TYPE PROVIDER LOCATION ROOM
		const mid = DOM.append(row, DOM.$('.mid'));
		mid.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:4px;flex-wrap:wrap;';

		const type = getAppointmentType(apt);
		if (type) {
			const t = DOM.append(mid, DOM.$('span'));
			t.textContent = type;
		}
		const prov = providerNameOf(apt);
		if (prov) {
			if (type) { DOM.append(mid, DOM.$('span')).textContent = '·'; }
			const p = DOM.append(mid, DOM.$('span'));
			p.textContent = prov;
		}
		const loc = locationOf(apt);
		if (loc) {
			DOM.append(mid, DOM.$('span')).textContent = '·';
			const l = DOM.append(mid, DOM.$('span'));
			l.textContent = loc;
			l.style.cssText = 'overflow:hidden;text-overflow:ellipsis;max-width:140px;';
		}
		if (apt.room) {
			const room = DOM.append(mid, DOM.$('span'));
			room.textContent = apt.room;
			room.style.cssText = 'margin-left:auto;font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(99,102,241,0.8);color:#fff;font-weight:500;';
		}

		createOverflowMenuButton(actions, (): IOverflowMenuItem[] => {
			const items: IOverflowMenuItem[] = [];
			const isTele = (getAppointmentType(apt) || '').toLowerCase() === 'telehealth';
			if (isTele) {
				items.push({ symbol: '\u{1F4F9}', label: 'Join Video Visit', onClick: () => this._joinTelehealth(apt) });
			}
			items.push({ symbol: '\u{1F5C2}', label: 'Open Chart', onClick: () => this._openChart(apt) });
			if (!isTele) {
				items.push({ symbol: '\u{1FA7A}', label: 'Record Vitals', onClick: () => this._recordVitals(apt) });
				items.push({ symbol: '\u{1F4DD}', label: 'Visit Summary', onClick: () => this._visitSummary(apt) });
			}
			if (!apt.encounterId) {
				items.push({ separator: true });
				items.push({ symbol: '\u{1F4C3}', label: 'New Encounter', onClick: () => this._newEncounter(apt) });
			}
			return items;
		});
	}

	private _joinTelehealth(apt: Appointment): void {
		this.commandService.executeCommand(
			'ciyex.openTelehealth',
			String(apt.id),
			patientNameOf(apt),
			providerNameOf(apt),
		);
	}

	private _renderPagination(): void {
		const filtered = this._getFiltered();
		const bar = DOM.append(this.container, DOM.$('.pagination'));
		bar.style.cssText = 'border-top:1px solid var(--vscode-editorWidget-border);flex-shrink:0;background:var(--vscode-sideBar-background);';
		renderShowMoreFooter(
			bar,
			{ visibleCount: Math.min(this.visibleCount, filtered.length), totalCount: filtered.length },
			(next) => { this.visibleCount = next; this._render(); },
			() => { this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._render(); },
		);
	}

	// Action handlers match appointmentsEditor.ts row actions 

	private _openChart(apt: Appointment): void {
		const name = patientNameOf(apt);
		const pid = resolvePatientId(apt);
		const label = `Visit — ${name}`;
		if (apt.encounterId && pid) {
			this.commandService.executeCommand('ciyex.openEncounter', pid, String(apt.encounterId), name, label);
			return;
		}
		if (pid) {
			// Pass 'encounters' so the chart always opens on the encounters tab
			// rather than the last-visited tab (which could be payment/billing).
			this.commandService.executeCommand('ciyex.openPatientChart', pid, name, 'encounters');
			return;
		}
		// No patient linked yet — fall back to the appointments editor.
		this.commandService.executeCommand('ciyex.openAppointments');
	}

	private _recordVitals(apt: Appointment): void {
		const name = patientNameOf(apt);
		const pid = resolvePatientId(apt);
		if (apt.encounterId && pid) {
			this.commandService.executeCommand('ciyex.openEncounter', pid, String(apt.encounterId), name, `Vitals — ${name}`, 'vitals');
			return;
		}
		if (pid) {
			this.commandService.executeCommand('ciyex.openPatientChart', pid, name, 'vitals');
			return;
		}
		this.commandService.executeCommand('ciyex.openAppointments');
	}

	private _visitSummary(apt: Appointment): void {
		const name = patientNameOf(apt);
		const pid = resolvePatientId(apt);
		if (apt.encounterId && pid) {
			this.commandService.executeCommand('ciyex.openEncounter', pid, String(apt.encounterId), name, `Summary — ${name}`, 'plan');
			return;
		}
		if (pid) {
			this.commandService.executeCommand('ciyex.openPatientChart', pid, name, 'encounters');
			return;
		}
		this.commandService.executeCommand('ciyex.openAppointments');
	}

	private async _newEncounter(apt: Appointment): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${apt.id}/encounter`, { method: 'POST' });
		} catch { /* */ }
		await this._loadAppointments();
		this._render();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.container) {
			this.container.style.height = `${height}px`;
		}
	}

	override dispose(): void {
		if (this.refreshTimer) {
			DOM.getActiveWindow().clearInterval(this.refreshTimer);
		}
		super.dispose();
	}
}
