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
import { AppointmentsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import * as DOM from '../../../../../base/browser/dom.js';

// allow-any-unicode-next-line
// ─── Types ──────────────────────────────────────────────────────────────────

interface AppointmentDTO {
	locationDisplay?: string;
	id: number;
	visitType: string;
	patientId: number;
	providerId: number;
	appointmentStartDate: string;
	appointmentEndDate: string;
	appointmentStartTime: string;
	appointmentEndTime: string;
	priority: string;
	locationId: number;
	status: string;
	room?: string;
	reason: string;
	orgId: number;
	patientName?: string;
	encounterId?: string;
	encounterPatientId?: number;
	locationName?: string;
	patientPhone?: string;
	providerName?: string;
	start?: string;
	end?: string;
}

interface StatusOption {
	value: string;
	label: string;
	color?: string;
	triggersEncounter?: boolean;
	terminal?: boolean;
	nextStatus?: string;
	order?: number;
	/** Optional default encounter note text the backend attaches when this status fires
	 *  an encounter (e.g. Checked-in → "Patient arrived"). Backend record at
	 *  AppointmentEncounterService.StatusOption.encounterNote. */
	encounterNote?: string;
}

interface Provider { id: number; name: string }
interface Location { id: number; name: string }

const FALLBACK_STATUS_OPTIONS: StatusOption[] = [
	{ value: 'Scheduled', label: 'Scheduled', color: '#3b82f6', order: 0, nextStatus: 'Confirmed' },
	{ value: 'Confirmed', label: 'Confirmed', color: '#6366f1', order: 1, nextStatus: 'Checked-in' },
	{ value: 'Checked-in', label: 'Checked-in', color: '#f59e0b', order: 2, nextStatus: 'Completed', triggersEncounter: true },
	{ value: 'Completed', label: 'Completed', color: '#10b981', order: 3, terminal: true },
	{ value: 'Re-Scheduled', label: 'Re-Scheduled', color: '#8b5cf6', order: 4, nextStatus: 'Scheduled' },
	{ value: 'No Show', label: 'No Show', color: '#ef4444', order: 5, terminal: true },
	{ value: 'Cancelled', label: 'Cancelled', color: '#6b7280', order: 6, terminal: true },
];

const DATE_PRESETS = [
	{ label: 'Today', value: 'today' },
	{ label: 'Past', value: 'past' },
	{ label: 'Upcoming', value: 'upcoming' },
	{ label: 'Last 7 Days', value: 'last_7_days' },
	{ label: 'Current Month', value: 'current_month' },
	{ label: 'Last Month', value: 'last_month' },
	{ label: 'All Time', value: 'all_time' },
];

const REFRESH_OPTIONS = [
	{ label: 'Off', value: 0 },
	{ label: '15s', value: 15000 },
	{ label: '30s', value: 30000 },
	{ label: '60s', value: 60000 },
];

// allow-any-unicode-next-line
// ─── Utilities ──────────────────────────────────────────────────────────────

const pad2 = (n: number) => n.toString().padStart(2, '0');

function todayISO(): string {
	const d = new Date();
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatToDisplay(iso: string): string {
	if (!iso) { return ''; }
	const parts = iso.split('-');
	if (parts.length !== 3) { return iso; }
	return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function getDateRange(preset: string): { from: string; to: string } {
	const now = new Date();
	const today = todayISO();
	switch (preset) {
		case 'today': return { from: today, to: today };
		case 'past': return { from: '2020-01-01', to: today };
		case 'upcoming': {
			const future = new Date(now); future.setFullYear(future.getFullYear() + 1);
			return { from: today, to: `${future.getFullYear()}-${pad2(future.getMonth() + 1)}-${pad2(future.getDate())}` };
		}
		case 'last_7_days': {
			const d = new Date(now); d.setDate(d.getDate() - 7);
			return { from: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, to: today };
		}
		case 'current_month': {
			return { from: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`, to: today };
		}
		case 'last_month': {
			const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const lme = new Date(now.getFullYear(), now.getMonth(), 0);
			return { from: `${lm.getFullYear()}-${pad2(lm.getMonth() + 1)}-01`, to: `${lme.getFullYear()}-${pad2(lme.getMonth() + 1)}-${pad2(lme.getDate())}` };
		}
		default: return { from: '2020-01-01', to: '2030-12-31' };
	}
}

function formatTimeTo12h(t: string): string {
	if (!t) { return ''; }
	const [hStr, mStr] = t.split(':');
	let h = parseInt(hStr, 10);
	const m = mStr || '00';
	const ampm = h >= 12 ? 'PM' : 'AM';
	if (h > 12) { h -= 12; }
	if (h === 0) { h = 12; }
	return `${h}:${m} ${ampm}`;
}

function normalizeApptTimes(appt: AppointmentDTO): AppointmentDTO {
	let startDate = String(appt.appointmentStartDate || appt.start || '');
	let endDate = String(appt.appointmentEndDate || appt.end || '');
	let startTime = String(appt.appointmentStartTime || '');
	let endTime = String(appt.appointmentEndTime || '');

	if (/^\d+$/.test(startDate)) { startDate = ''; }
	if (/^\d+$/.test(endDate)) { endDate = ''; }

	if (startDate.includes('T')) {
		const d = new Date(startDate);
		if (!isNaN(d.getTime())) {
			startTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
			startDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
		}
	}
	if (endDate.includes('T')) {
		const d = new Date(endDate);
		if (!isNaN(d.getTime())) {
			endTime = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
			endDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
		}
	}

	// Extract locationId from FHIR reference
	let locationId = appt.locationId;
	const raw = appt as unknown as Record<string, unknown>;
	if (!locationId && typeof raw.locationReference === 'string') {
		const match = (raw.locationReference as string).match(/Location\/(\d+)/);
		if (match) { locationId = parseInt(match[1], 10); }
	}

	return { ...appt, appointmentStartDate: startDate, appointmentEndDate: endDate, appointmentStartTime: startTime, appointmentEndTime: endTime, locationId };
}

function normalizeVisitType(raw: unknown): string {
	if (!raw) { return ''; }
	if (typeof raw === 'string') {
		const m = raw.match(/text=([^,)]+)/);
		return m ? m[1].trim() : raw;
	}
	if (typeof raw === 'object' && raw !== null) {
		const obj = raw as Record<string, unknown>;
		if (obj.text) { return String(obj.text); }
		if (Array.isArray(obj.coding) && obj.coding.length > 0) {
			return (obj.coding[0] as Record<string, string>).display || '';
		}
	}
	return String(raw);
}

function formatWaitTime(startDate: string, startTime: string): { text: string; color: string } | null {
	if (!startDate || !startTime || startDate !== todayISO()) { return null; }
	const [h, m] = startTime.split(':').map(Number);
	const scheduled = new Date();
	scheduled.setHours(h, m, 0, 0);
	const diff = Math.floor((Date.now() - scheduled.getTime()) / 60000);
	if (diff < 0) { return { text: `Starts in ${-diff}m`, color: '#6b7280' }; }
	if (diff <= 15) { return { text: `${diff}m`, color: '#22c55e' }; }
	if (diff <= 30) { return { text: `${diff}m`, color: '#eab308' }; }
	const hrs = Math.floor(diff / 60);
	const mins = diff % 60;
	return { text: hrs > 0 ? `${hrs}h ${mins}m` : `${diff}m`, color: '#ef4444' };
}

// allow-any-unicode-next-line
// ─── Editor ─────────────────────────────────────────────────────────────────

export class AppointmentsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexAppointments';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private tableBody!: HTMLElement;
	private badgeEl!: HTMLElement;
	private pagInfoEl!: HTMLElement;
	private pagShowEl!: HTMLElement;
	private prevBtn!: HTMLButtonElement;
	private nextBtn!: HTMLButtonElement;

	private rows: AppointmentDTO[] = [];
	private providers: Provider[] = [];
	private locations: Location[] = [];
	private statusOptions: StatusOption[] = [...FALLBACK_STATUS_OPTIONS];
	private roomOptions: string[] = [];
	private visitTypes: string[] = [];

	// Filters
	private datePreset = 'all_time';
	private patientSearch = '';
	private providerFilter = '';
	private locationFilter = '';
	private typeFilter = '';
	private statusFilter = '';
	// Custom date range (only used when datePreset === 'all_time')
	private dateFromCustom = '';
	private dateToCustom = '';

	// Pagination
	private currentPage = 1;
	private pageSize = 20;
	private totalCount = 0;

	// Auto-refresh
	private refreshInterval = 30000;
	private _refreshTimer: number | null = null;

	// Inline editing
	private editingStatusId: number | null = null;
	private editingRoomId: number | null = null;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(AppointmentsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.appointments-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);';
		// Scrollable content area — pagination is rendered as a sibling and pinned
		// to the bottom (see _render). Keeps the toolbar/table scrollable while the
		// pagination bar stays visible per the EHR-UI parity requirement.
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'flex:1;overflow-y:auto;padding:20px 24px;';
	}

	private _pagBarEl: HTMLElement | null = null;

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof AppointmentsEditorInput)) { return; }
		await this._loadReferenceData();
		await this._loadAppointments();
		this._startAutoRefresh();
	}

	override dispose(): void {
		this._stopAutoRefresh();
		super.dispose();
	}

	// allow-any-unicode-next-line
	// ─── Data Loading ──────────────────────────────────────────────────────

	private async _loadReferenceData(): Promise<void> {
		try {
			const [provRes, locRes, statusRes, roomRes] = await Promise.all([
				this.apiService.fetch('/api/providers').catch(() => null),
				this.apiService.fetch('/api/locations').catch(() => null),
				this.apiService.fetch('/api/appointments/status-options').catch(() => null),
				this.apiService.fetch('/api/appointments/room-options').catch(() => null),
			]);

			if (provRes?.ok) {
				const d = await provRes.json();
				this.providers = (d?.data?.content || d?.data || d?.content || d || []) as Provider[];
			}
			if (locRes?.ok) {
				const d = await locRes.json();
				this.locations = (d?.data?.content || d?.data || d?.content || d || []) as Location[];
			}
			if (statusRes?.ok) {
				const d = await statusRes.json();
				const opts = (d?.data || d || []) as StatusOption[];
				if (opts.length > 0) { this.statusOptions = opts; }
			}
			if (roomRes?.ok) {
				const d = await roomRes.json();
				this.roomOptions = (d?.data || d || []) as string[];
			}
		} catch { /* use fallbacks */ }
	}

	private async _loadAppointments(): Promise<void> {
		try {
			const range = getDateRange(this.datePreset);
			// When "All Time" is selected and the user has filled the custom from/to
			// pickers, narrow the request to that range. Otherwise the preset's
			// implicit range (2020-2030 for all_time) applies.
			let from = range.from;
			let to = range.to;
			if (this.datePreset === 'all_time') {
				if (this.dateFromCustom) { from = this.dateFromCustom; }
				if (this.dateToCustom) { to = this.dateToCustom; }
			}
			let url = `/api/appointments?page=${this.currentPage - 1}&size=${this.pageSize}`;
			// Use date-only params (matches ehr-ui's AppointmentPage.tsx); the
			// backend treats `dateFrom`/`dateTo` as inclusive date boundaries.
			url += `&dateFrom=${from}&dateTo=${to}`;
			if (this.statusFilter) { url += `&status=${this.statusFilter}`; }

			const res = await this.apiService.fetch(url);
			if (!res.ok) { this._renderError('Failed to load appointments.'); return; }
			const data = await res.json();

			let list = (data?.data?.content || data?.data || data?.content || data || []) as AppointmentDTO[];
			list = list.map(a => normalizeApptTimes(a));

			// Normalize visit types
			for (const a of list) { a.visitType = normalizeVisitType(a.visitType); }

			// Collect unique visit types
			const types = new Set<string>();
			for (const a of list) { if (a.visitType) { types.add(a.visitType); } }
			this.visitTypes = [...types].sort();

			// Enrich with patient/provider/location names
			await this._enrichRows(list);

			this.rows = list;
			this.totalCount = data?.data?.totalElements ?? data?.totalElements ?? list.length;

			this._render();
		} catch {
			this._renderError('Waiting for login...');
		}
	}

	private async _enrichRows(rows: AppointmentDTO[]): Promise<void> {
		// Batch fetch patient info for rows missing patientName
		const patientIds = [...new Set(rows.filter(r => r.patientId && !r.patientName).map(r => r.patientId))];
		const patientMap = new Map<number, { name: string; phone?: string }>();

		const batchSize = 10;
		for (let i = 0; i < patientIds.length; i += batchSize) {
			const batch = patientIds.slice(i, i + batchSize);
			await Promise.all(batch.map(async (pid) => {
				try {
					const res = await this.apiService.fetch(`/api/patients/${pid}`);
					if (res.ok) {
						const d = await res.json();
						const p = d?.data || d || {};
						const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
						patientMap.set(pid, { name, phone: p.phoneNumber || p.phone });
					}
				} catch { /* */ }
			}));
		}

		for (const row of rows) {
			const info = patientMap.get(row.patientId);
			if (info) {
				row.patientName = row.patientName || info.name;
				row.patientPhone = row.patientPhone || info.phone;
			}
			if (!row.providerName && row.providerId) {
				const prov = this.providers.find(p => p.id === row.providerId);
				if (prov) { row.providerName = prov.name; }
			}
			if (!row.locationName) {
				if (row.locationDisplay) {
					row.locationName = row.locationDisplay;
				} else if (row.locationId !== undefined && row.locationId !== null) {
					// Match either int or string-typed id (FHIR refs sometimes return string ids).
					const loc = this.locations.find(l => String(l.id) === String(row.locationId));
					if (loc) { row.locationName = loc.name; }
				}
			}
		}
	}

	// allow-any-unicode-next-line
	// ─── Auto-refresh ──────────────────────────────────────────────────────

	private _startAutoRefresh(): void {
		this._stopAutoRefresh();
		if (this.refreshInterval > 0) {
			this._refreshTimer = DOM.getActiveWindow().setInterval(() => this._loadAppointments(), this.refreshInterval);
		}
	}

	private _stopAutoRefresh(): void {
		if (this._refreshTimer) { DOM.getActiveWindow().clearInterval(this._refreshTimer); this._refreshTimer = null; }
	}

	// allow-any-unicode-next-line
	// ─── Filtering ─────────────────────────────────────────────────────────

	private _getFilteredRows(): AppointmentDTO[] {
		return this.rows.filter(r => {
			if (this.patientSearch) {
				const name = (r.patientName || '').toLowerCase();
				if (!name.includes(this.patientSearch.toLowerCase())) { return false; }
			}
			if (this.providerFilter) {
				if (String(r.providerId) !== this.providerFilter && (r.providerName || '') !== this.providerFilter) { return false; }
			}
			if (this.locationFilter) {
				if (String(r.locationId) !== this.locationFilter && (r.locationName || '') !== this.locationFilter) { return false; }
			}
			if (this.typeFilter) {
				const tf = this.typeFilter.trim().toLowerCase();
				const vt = String(r.visitType || '').trim().toLowerCase();
				const at = String((r as unknown as Record<string, unknown>).appointmentType || '').trim().toLowerCase();
				if (vt !== tf && at !== tf && !vt.includes(tf) && !at.includes(tf)) { return false; }
			}
			return true;
		});
	}

	// allow-any-unicode-next-line
	// ─── Actions ────────────────────────────────────────────────────────────

	private async _updateStatus(id: number, newStatus: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${id}/status`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus }),
			});
			this.editingStatusId = null;
			await this._loadAppointments();
		} catch { /* */ }
	}

	private async _updateRoom(id: number, room: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${id}/room`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ room }),
			});
			this.editingRoomId = null;
			await this._loadAppointments();
		} catch { /* */ }
	}

	private _openPatientChart(patientId: number, patientName: string): void {
		this.commandService.executeCommand('ciyex.openPatientChart', String(patientId), patientName);
	}

	private _printTable(): void {
		const filtered = this._getFilteredRows();
		let html = `<!DOCTYPE html><html><head><title>Appointments</title><style>
			body{font-family:sans-serif;font-size:12px;margin:20px;}
			table{width:100%;border-collapse:collapse;}
			th,td{padding:8px 10px;text-align:left;border:1px solid #ddd;}
			th{background:#f5f5f5;font-weight:600;text-transform:uppercase;font-size:11px;}
			@media print{@page{size:landscape;}}
		</style></head><body>
		<h2>Appointments — ${this.datePreset}</h2>
		<table><thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Provider</th><th>Location</th><th>Type</th><th>Status</th><th>Room</th></tr></thead><tbody>`;
		for (const r of filtered) {
			const so = this.statusOptions.find(s => s.value === r.status);
			html += `<tr><td>${formatToDisplay(r.appointmentStartDate)}</td><td>${formatTimeTo12h(r.appointmentStartTime)}</td><td>${r.patientName || ''}</td><td>${r.providerName || ''}</td><td>${r.locationName || ''}</td><td>${r.visitType || ''}</td><td>${so?.label || r.status}</td><td>${r.room || ''}</td></tr>`;
		}
		html += '</tbody></table></body></html>';
		const w = DOM.getActiveWindow().open('', '_blank');
		if (!w) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Print failed: popup was blocked. Allow popups for this page and try again.' });
			return;
		}
		w.document.open();
		w.document.write(html);
		w.document.close();
		// Wait for rendering before invoking print; sandboxed windows often print blank otherwise
		w.onload = () => { try { w.focus(); w.print(); } catch { /* ignore */ } };
		w.setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
	}

	private _exportToCSV(): void {
		const filtered = this._getFilteredRows();
		const header = 'Date,Time,Patient,Provider,Location,Type,Status,Room\n';
		const csvRows = filtered.map(r => {
			const so = this.statusOptions.find(s => s.value === r.status);
			return [
				formatToDisplay(r.appointmentStartDate),
				formatTimeTo12h(r.appointmentStartTime),
				`"${(r.patientName || '').replace(/"/g, '""')}"`,
				`"${(r.providerName || '').replace(/"/g, '""')}"`,
				`"${(r.locationName || '').replace(/"/g, '""')}"`,
				`"${(r.visitType || '').replace(/"/g, '""')}"`,
				so?.label || r.status,
				r.room || '',
			].join(',');
		}).join('\n');

		const blob = new Blob([header + csvRows], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `appointments_${todayISO()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// allow-any-unicode-next-line
	// ─── Render ─────────────────────────────────────────────────────────────

	private _renderError(msg: string): void {
		DOM.clearNode(this.contentEl);
		// Pagination is rendered as a sibling of contentEl — clear it on error
		// so the empty state isn't shown alongside stale pagination buttons.
		if (this._pagBarEl && this._pagBarEl.parentElement) {
			this._pagBarEl.parentElement.removeChild(this._pagBarEl);
			this._pagBarEl = null;
		}
		const el = DOM.append(this.contentEl, DOM.$('div'));
		el.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
		el.textContent = msg;
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);
		const filtered = this._getFilteredRows();

		const selectStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;cursor:pointer;outline:none;';
		const inputStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;outline:none;min-width:150px;';
		const btnStyle = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;';
		// allow-any-unicode-next-line
		// ─── Header ────────────────────────────────────────────────────────
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;';

		const titleGroup = DOM.append(header, DOM.$('div'));
		titleGroup.style.cssText = 'display:flex;align-items:center;gap:12px;';

		const title = DOM.append(titleGroup, DOM.$('h2'));
		title.textContent = 'Appointments';
		title.style.cssText = 'font-size:22px;font-weight:700;margin:0;';

		this.badgeEl = DOM.append(titleGroup, DOM.$('span'));
		this.badgeEl.style.cssText = 'padding:3px 10px;border-radius:12px;font-size:12px;font-weight:500;background:var(--vscode-badge-background,#0e639c);color:var(--vscode-badge-foreground,#fff);';
		this.badgeEl.textContent = `${filtered.length} appointment${filtered.length !== 1 ? 's' : ''}`;

		const actionGroup = DOM.append(header, DOM.$('div'));
		actionGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

		// Manual refresh — clicking immediately reloads the table
		const refreshBtn = DOM.append(actionGroup, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.style.cssText = btnStyle;
		// allow-any-unicode-next-line
		refreshBtn.textContent = '⟳ Refresh';
		refreshBtn.title = 'Refresh appointments now';
		refreshBtn.addEventListener('click', () => { void this._loadAppointments(); });

		// Auto-refresh interval picker (Off / 15s / 30s / 60s)
		const refreshWrap = DOM.append(actionGroup, DOM.$('div'));
		refreshWrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
		const autoLabel = DOM.append(refreshWrap, DOM.$('span'));
		autoLabel.textContent = 'Auto:';
		autoLabel.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const refreshSel = DOM.append(refreshWrap, DOM.$('select')) as HTMLSelectElement;
		refreshSel.style.cssText = selectStyle;
		refreshSel.title = 'Auto-refresh interval';
		for (const opt of REFRESH_OPTIONS) {
			const o = DOM.append(refreshSel, DOM.$('option')) as HTMLOptionElement;
			o.value = String(opt.value); o.textContent = opt.label;
			if (opt.value === this.refreshInterval) { o.selected = true; }
		}
		refreshSel.addEventListener('change', () => {
			this.refreshInterval = parseInt(refreshSel.value, 10);
			this._startAutoRefresh();
		});

		// Print
		const printBtn = DOM.append(actionGroup, DOM.$('button'));
		printBtn.style.cssText = btnStyle;
		// allow-any-unicode-next-line
		printBtn.textContent = '🖨 Print';
		printBtn.addEventListener('click', () => {
			try { this._printTable(); }
			catch (err) { this.notificationService.notify({ severity: Severity.Error, message: `Print failed: ${String(err)}` }); }
		});

		// Export
		const exportBtn = DOM.append(actionGroup, DOM.$('button'));
		exportBtn.style.cssText = btnStyle;
		// allow-any-unicode-next-line
		exportBtn.textContent = '⬇ Export';
		exportBtn.addEventListener('click', () => this._exportToCSV());

		// TV Display — dropdown with Staff TV Board / Waiting Room
		const tvWrap = DOM.append(actionGroup, DOM.$('div'));
		tvWrap.style.cssText = 'position:relative;';
		const tvBtn = DOM.append(tvWrap, DOM.$('button')) as HTMLButtonElement;
		tvBtn.style.cssText = btnStyle;
		// allow-any-unicode-next-line
		tvBtn.textContent = '🖥 TV Display ▾';
		const tvMenu = DOM.append(tvWrap, DOM.$('div'));
		tvMenu.style.cssText = 'position:absolute;top:calc(100% + 4px);right:0;min-width:180px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.4);z-index:20;display:none;overflow:hidden;';

		const openTv = (mode: 'staff' | 'waiting') => {
			tvMenu.style.display = 'none';
			try {
				const apiUrl = this.apiService.apiUrl || '';
				// Strip trailing /api and convert *api-dev* host to *app-dev* if present
				let base = apiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
				base = base.replace(/(^https?:\/\/)api(-[^.]+)?\./, '$1app$2.');
				if (!base) { base = DOM.getActiveWindow().location.origin; }
				const url = `${base}/appointments/tv?mode=${mode}`;
				const win = DOM.getActiveWindow().open(url, '_blank');
				if (!win) {
					this.notificationService.notify({ severity: Severity.Warning, message: 'TV Display popup was blocked. Allow popups for this page and try again.' });
				}
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Error, message: `TV Display failed: ${String(err)}` });
			}
		};

		const mkTvItem = (icon: string, label: string, onClick: () => void) => {
			const it = DOM.append(tvMenu, DOM.$('button')) as HTMLButtonElement;
			it.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;background:transparent;border:none;color:var(--vscode-foreground);font-size:12px;text-align:left;cursor:pointer;';
			it.addEventListener('mouseenter', () => { it.style.background = 'var(--vscode-list-hoverBackground)'; });
			it.addEventListener('mouseleave', () => { it.style.background = 'transparent'; });
			const ic = DOM.append(it, DOM.$('span'));
			ic.textContent = icon;
			const lb = DOM.append(it, DOM.$('span'));
			lb.textContent = label;
			it.addEventListener('click', onClick);
		};
		// allow-any-unicode-next-line
		mkTvItem('🖥', 'Staff TV Board', () => openTv('staff'));
		// allow-any-unicode-next-line
		mkTvItem('📺', 'Waiting Room', () => openTv('waiting'));

		tvBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			tvMenu.style.display = tvMenu.style.display === 'none' ? 'block' : 'none';
		});
		// Dismiss on outside click
		const dismiss = (ev: Event) => {
			if (!tvWrap.contains(ev.target as Node)) { tvMenu.style.display = 'none'; }
		};
		DOM.getActiveWindow().document.addEventListener('click', dismiss, { once: false });

		// allow-any-unicode-next-line
		// ─── Filters ───────────────────────────────────────────────────────
		const filters = DOM.append(this.contentEl, DOM.$('div'));
		filters.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;padding:12px 16px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;';

		// Patient search
		const patientInput = DOM.append(filters, DOM.$('input')) as HTMLInputElement;
		patientInput.style.cssText = inputStyle;
		patientInput.placeholder = 'Search patient...';
		patientInput.value = this.patientSearch;
		patientInput.addEventListener('input', () => {
			this.patientSearch = patientInput.value;
			this._renderTableBody(this._getFilteredRows());
		});

		// Provider filter
		const provSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		provSel.style.cssText = selectStyle;
		const provAll = DOM.append(provSel, DOM.$('option')) as HTMLOptionElement;
		provAll.value = ''; provAll.textContent = 'All Providers';
		for (const p of this.providers) {
			const o = DOM.append(provSel, DOM.$('option')) as HTMLOptionElement;
			o.value = String(p.id); o.textContent = p.name;
		}
		provSel.addEventListener('change', () => {
			this.providerFilter = provSel.value;
			this._renderTableBody(this._getFilteredRows());
		});

		// Location filter
		const locSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		locSel.style.cssText = selectStyle;
		const locAll = DOM.append(locSel, DOM.$('option')) as HTMLOptionElement;
		locAll.value = ''; locAll.textContent = 'All Locations';
		for (const l of this.locations) {
			const o = DOM.append(locSel, DOM.$('option')) as HTMLOptionElement;
			o.value = String(l.id); o.textContent = l.name;
		}
		locSel.addEventListener('change', () => {
			this.locationFilter = locSel.value;
			this._renderTableBody(this._getFilteredRows());
		});

		// Type filter — fall back to a static list when no rows have loaded yet
		const typeSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		typeSel.style.cssText = selectStyle;
		const typeAll = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
		typeAll.value = ''; typeAll.textContent = 'All Types';
		const typeOptions = this.visitTypes.length > 0
			? this.visitTypes
			: ['Consultation', 'New Patient', 'Follow-Up', 'Sick Visit', 'Annual Physical', 'Telehealth', 'Procedure', 'Lab Only'];
		for (const t of typeOptions) {
			const o = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
			o.value = t; o.textContent = t;
			if (t === this.typeFilter) { o.selected = true; }
		}
		typeSel.addEventListener('change', () => {
			this.typeFilter = typeSel.value;
			this._renderTableBody(this._getFilteredRows());
		});

		// Status filter
		const statusSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		statusSel.style.cssText = selectStyle;
		const statAll = DOM.append(statusSel, DOM.$('option')) as HTMLOptionElement;
		statAll.value = ''; statAll.textContent = 'All Status';
		for (const s of this.statusOptions) {
			const o = DOM.append(statusSel, DOM.$('option')) as HTMLOptionElement;
			o.value = s.value; o.textContent = s.label;
		}
		statusSel.addEventListener('change', () => {
			this.statusFilter = statusSel.value;
			this.currentPage = 1;
			this._loadAppointments();
		});

		// allow-any-unicode-next-line
		// ─── Date Filter Row ──────────────────────────────────────────────
		// Per the EHR-UI parity spec: the date preset selector sits above the
		// DATE column on the left, and the date-range pickers (visible when the
		// preset is "All Time") sit above the ACTIONS column on the right.
		const dateRow = DOM.append(this.contentEl, DOM.$('div'));
		dateRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding:8px 16px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;';

		const dateLeft = DOM.append(dateRow, DOM.$('div'));
		dateLeft.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const dateLeftLabel = DOM.append(dateLeft, DOM.$('span'));
		dateLeftLabel.textContent = 'Date:';
		dateLeftLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;';
		const dateSel = DOM.append(dateLeft, DOM.$('select')) as HTMLSelectElement;
		dateSel.style.cssText = selectStyle;
		for (const p of DATE_PRESETS) {
			const o = DOM.append(dateSel, DOM.$('option')) as HTMLOptionElement;
			o.value = p.value; o.textContent = p.label;
			if (p.value === this.datePreset) { o.selected = true; }
		}

		const dateRight = DOM.append(dateRow, DOM.$('div'));
		dateRight.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const rangeLabel = DOM.append(dateRight, DOM.$('span'));
		rangeLabel.textContent = 'Range:';
		rangeLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;';
		const dateInputStyle = 'padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';
		const fromInput = DOM.append(dateRight, DOM.$('input')) as HTMLInputElement;
		fromInput.type = 'date';
		fromInput.value = this.dateFromCustom;
		fromInput.style.cssText = dateInputStyle;
		fromInput.title = 'From date';
		const toLbl = DOM.append(dateRight, DOM.$('span'));
		toLbl.textContent = 'to';
		toLbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const toInput = DOM.append(dateRight, DOM.$('input')) as HTMLInputElement;
		toInput.type = 'date';
		toInput.value = this.dateToCustom;
		toInput.style.cssText = dateInputStyle;
		toInput.title = 'To date';
		const clearRangeBtn = DOM.append(dateRight, DOM.$('button')) as HTMLButtonElement;
		clearRangeBtn.textContent = 'Clear';
		clearRangeBtn.style.cssText = 'padding:5px 10px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-descriptionForeground);font-size:11px;cursor:pointer;';
		clearRangeBtn.addEventListener('click', () => {
			this.dateFromCustom = '';
			this.dateToCustom = '';
			this.currentPage = 1;
			this._loadAppointments();
		});

		// Range row visible only when "All Time" is the active preset; other
		// presets define their own implicit range so the inputs would be ignored.
		const updateRangeVisibility = () => {
			dateRight.style.visibility = this.datePreset === 'all_time' ? 'visible' : 'hidden';
		};
		updateRangeVisibility();

		dateSel.addEventListener('change', () => {
			this.datePreset = dateSel.value;
			this.currentPage = 1;
			updateRangeVisibility();
			this._loadAppointments();
		});
		fromInput.addEventListener('change', () => {
			this.dateFromCustom = fromInput.value;
			this.currentPage = 1;
			this._loadAppointments();
		});
		toInput.addEventListener('change', () => {
			this.dateToCustom = toInput.value;
			this.currentPage = 1;
			this._loadAppointments();
		});

		// allow-any-unicode-next-line
		// ─── Table ─────────────────────────────────────────────────────────
		const tableWrap = DOM.append(this.contentEl, DOM.$('div'));
		// `overflow-x:auto` keeps the ACTIONS column reachable on narrow viewports
		// (it was clipped under `overflow:hidden`); `min-width` on the inner table
		// makes the row keep its 9 columns instead of squeezing them invisibly.
		tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;overflow-x:auto;overflow-y:hidden;';

		const table = DOM.append(tableWrap, DOM.$('table'));
		table.style.cssText = 'width:100%;min-width:1100px;border-collapse:collapse;';

		const thead = DOM.append(table, DOM.$('thead'));
		const headRow = DOM.append(thead, DOM.$('tr'));
		headRow.style.cssText = 'background:var(--vscode-editorWidget-background,#252526);';
		const columns = ['DATE', 'PATIENT', 'PROVIDER', 'LOCATION', 'TYPE', 'STATUS', 'ROOM', 'WAIT', 'ACTIONS'];
		for (const col of columns) {
			const th = DOM.append(headRow, DOM.$('th'));
			th.textContent = col;
			th.style.cssText = 'padding:10px 12px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--vscode-foreground);letter-spacing:0.5px;border-bottom:2px solid var(--vscode-focusBorder,#0e639c);white-space:nowrap;';
		}

		this.tableBody = DOM.append(table, DOM.$('tbody'));
		this._renderTableBody(filtered);

		// allow-any-unicode-next-line
		// ─── Pagination ────────────────────────────────────────────────────
		// Render the pagination bar as a sibling of `contentEl` (i.e. directly
		// under `root`) so it stays pinned at the bottom and doesn't scroll with
		// the table — matches the EHR-UI layout per the test report.
		if (this._pagBarEl && this._pagBarEl.parentElement) {
			this._pagBarEl.parentElement.removeChild(this._pagBarEl);
		}
		const pagBar = DOM.append(this.root, DOM.$('div'));
		this._pagBarEl = pagBar;
		pagBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 24px;border-top:1px solid var(--vscode-editorWidget-border,#3c3c3c);background:var(--vscode-editor-background);flex-shrink:0;';

		const pagLeft = DOM.append(pagBar, DOM.$('div'));
		pagLeft.style.cssText = 'display:flex;align-items:center;gap:8px;';

		this.prevBtn = DOM.append(pagLeft, DOM.$('button')) as HTMLButtonElement;
		this.prevBtn.textContent = 'Prev';
		this.prevBtn.style.cssText = btnStyle + (this.currentPage <= 1 ? 'opacity:0.4;cursor:default;' : '');
		this.prevBtn.disabled = this.currentPage <= 1;
		this.prevBtn.addEventListener('click', () => {
			if (this.currentPage > 1) { this.currentPage--; this._loadAppointments(); }
		});

		this.pagInfoEl = DOM.append(pagLeft, DOM.$('span'));
		this.pagInfoEl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		const totalPages = Math.max(1, Math.ceil(this.totalCount / this.pageSize));
		this.pagInfoEl.textContent = `Page ${this.currentPage} of ${totalPages}`;

		this.nextBtn = DOM.append(pagLeft, DOM.$('button')) as HTMLButtonElement;
		this.nextBtn.textContent = 'Next';
		this.nextBtn.style.cssText = btnStyle + (this.currentPage >= totalPages ? 'opacity:0.4;cursor:default;' : '');
		this.nextBtn.disabled = this.currentPage >= totalPages;
		this.nextBtn.addEventListener('click', () => {
			if (this.currentPage < totalPages) { this.currentPage++; this._loadAppointments(); }
		});

		const pagRight = DOM.append(pagBar, DOM.$('div'));
		pagRight.style.cssText = 'display:flex;align-items:center;gap:8px;';

		this.pagShowEl = DOM.append(pagRight, DOM.$('span'));
		this.pagShowEl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		this.pagShowEl.textContent = `Showing ${filtered.length} of ${this.totalCount}`;

		const sizeSel = DOM.append(pagRight, DOM.$('select')) as HTMLSelectElement;
		sizeSel.style.cssText = selectStyle;
		for (const s of [10, 20, 50, 100]) {
			const o = DOM.append(sizeSel, DOM.$('option')) as HTMLOptionElement;
			o.value = String(s); o.textContent = String(s);
			if (s === this.pageSize) { o.selected = true; }
		}
		sizeSel.addEventListener('change', () => {
			this.pageSize = parseInt(sizeSel.value, 10);
			this.currentPage = 1;
			this._loadAppointments();
		});
	}

	private _renderTableBody(filtered: AppointmentDTO[]): void {
		DOM.clearNode(this.tableBody);

		// Update badge
		if (this.badgeEl) {
			this.badgeEl.textContent = `${filtered.length} appointment${filtered.length !== 1 ? 's' : ''}`;
		}
		if (this.pagShowEl) {
			this.pagShowEl.textContent = `Showing ${filtered.length} of ${this.totalCount}`;
		}

		if (filtered.length === 0) {
			const tr = DOM.append(this.tableBody, DOM.$('tr'));
			const td = DOM.append(tr, DOM.$('td')) as HTMLTableCellElement;
			td.colSpan = 9;
			td.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
			td.textContent = 'No appointments match your filters.';
			return;
		}

		const cellStyle = 'padding:10px 12px;border-bottom:1px solid var(--vscode-editorWidget-border,#3c3c3c);font-size:12px;white-space:nowrap;';

		for (const row of filtered) {
			const tr = DOM.append(this.tableBody, DOM.$('tr'));
			tr.style.cssText = 'cursor:default;';
			tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--vscode-list-hoverBackground)'; });
			tr.addEventListener('mouseleave', () => { tr.style.background = ''; });

			// DATE: date, start-end time, and duration
			const tdDate = DOM.append(tr, DOM.$('td'));
			tdDate.style.cssText = cellStyle;
			const dateStr = formatToDisplay(row.appointmentStartDate);
			const startStr = formatTimeTo12h(row.appointmentStartTime);
			const endStr = formatTimeTo12h(row.appointmentEndTime);
			const dateLine = DOM.append(tdDate, DOM.$('div'));
			dateLine.textContent = dateStr;
			const timeLine = DOM.append(tdDate, DOM.$('div'));
			// allow-any-unicode-next-line
			timeLine.textContent = endStr ? `${startStr || '—'} – ${endStr}` : (startStr || '—');
			timeLine.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
			// Duration in minutes
			if (row.appointmentStartTime && row.appointmentEndTime) {
				const [sh, sm] = row.appointmentStartTime.split(':').map(Number);
				const [eh, em] = row.appointmentEndTime.split(':').map(Number);
				const mins = (eh * 60 + em) - (sh * 60 + sm);
				if (mins > 0) {
					const durLine = DOM.append(tdDate, DOM.$('div'));
					durLine.textContent = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
					durLine.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);opacity:0.8;';
				}
			}

			// PATIENT — name (link), MRN, phone
			const tdPatient = DOM.append(tr, DOM.$('td'));
			tdPatient.style.cssText = cellStyle;
			const patientLink = DOM.append(tdPatient, DOM.$('div'));
			patientLink.textContent = row.patientName || `Patient #${row.patientId}`;
			patientLink.style.cssText = 'cursor:pointer;color:var(--vscode-textLink-foreground,#3794ff);font-weight:500;';
			patientLink.addEventListener('click', () => this._openPatientChart(row.patientId, row.patientName || ''));
			const mrnLine = DOM.append(tdPatient, DOM.$('div'));
			mrnLine.textContent = `MRN: ${row.patientId}`;
			mrnLine.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			if (row.patientPhone) {
				const phoneLine = DOM.append(tdPatient, DOM.$('div'));
				phoneLine.textContent = row.patientPhone;
				phoneLine.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			}

			// PROVIDER
			const tdProv = DOM.append(tr, DOM.$('td'));
			tdProv.style.cssText = cellStyle;
			tdProv.textContent = row.providerName || '';

			// LOCATION
			const tdLoc = DOM.append(tr, DOM.$('td'));
			tdLoc.style.cssText = cellStyle;
			tdLoc.textContent = row.locationName || row.locationDisplay || '';

			// TYPE
			const tdType = DOM.append(tr, DOM.$('td'));
			tdType.style.cssText = cellStyle;
			tdType.textContent = row.visitType || '';

			// STATUS
			const tdStatus = DOM.append(tr, DOM.$('td'));
			tdStatus.style.cssText = cellStyle;
			const so = this.statusOptions.find(s => s.value === row.status);
			if (this.editingStatusId === row.id) {
				const sel = DOM.append(tdStatus, DOM.$('select')) as HTMLSelectElement;
				sel.style.cssText = 'padding:4px 6px;font-size:11px;background:var(--vscode-input-background);border:1px solid var(--vscode-focusBorder);border-radius:4px;color:var(--vscode-input-foreground);';
				for (const s of this.statusOptions) {
					const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
					o.value = s.value; o.textContent = s.label;
					if (s.value === row.status) { o.selected = true; }
				}
				sel.addEventListener('change', () => this._updateStatus(row.id, sel.value));
				sel.addEventListener('blur', () => { this.editingStatusId = null; this._renderTableBody(this._getFilteredRows()); });
				sel.focus();
			} else {
				const badge = DOM.append(tdStatus, DOM.$('span'));
				badge.textContent = so?.label || row.status;
				badge.style.cssText = `padding:3px 8px;border-radius:10px;font-size:11px;font-weight:500;cursor:pointer;color:#fff;background:${so?.color || '#6b7280'};`;
				badge.addEventListener('click', () => {
					this.editingStatusId = row.id;
					this._renderTableBody(this._getFilteredRows());
				});
			}

			// ROOM
			const tdRoom = DOM.append(tr, DOM.$('td'));
			tdRoom.style.cssText = cellStyle;
			if (this.editingRoomId === row.id) {
				if (this.roomOptions.length > 0) {
					const sel = DOM.append(tdRoom, DOM.$('select')) as HTMLSelectElement;
					sel.style.cssText = 'padding:4px 6px;font-size:11px;background:var(--vscode-input-background);border:1px solid var(--vscode-focusBorder);border-radius:4px;color:var(--vscode-input-foreground);';
					const emptyOpt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
					emptyOpt.value = ''; emptyOpt.textContent = '—';
					for (const rm of this.roomOptions) {
						const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
						o.value = rm; o.textContent = rm;
						if (rm === row.room) { o.selected = true; }
					}
					sel.addEventListener('change', () => this._updateRoom(row.id, sel.value));
					sel.addEventListener('blur', () => { this.editingRoomId = null; this._renderTableBody(this._getFilteredRows()); });
					sel.focus();
				} else {
					const inp = DOM.append(tdRoom, DOM.$('input')) as HTMLInputElement;
					inp.style.cssText = 'padding:4px 6px;font-size:11px;background:var(--vscode-input-background);border:1px solid var(--vscode-focusBorder);border-radius:4px;color:var(--vscode-input-foreground);width:60px;';
					inp.value = row.room || '';
					inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this._updateRoom(row.id, inp.value); } });
					inp.addEventListener('blur', () => { this.editingRoomId = null; this._renderTableBody(this._getFilteredRows()); });
					inp.focus();
				}
			} else {
				const roomSpan = DOM.append(tdRoom, DOM.$('span'));
				if (row.room) {
					roomSpan.textContent = row.room;
					roomSpan.style.cssText = 'cursor:pointer;color:var(--vscode-foreground);font-weight:500;';
				} else {
					roomSpan.textContent = 'Assign';
					roomSpan.style.cssText = 'cursor:pointer;color:var(--vscode-descriptionForeground);font-style:italic;opacity:0.7;';
				}
				roomSpan.addEventListener('click', () => {
					this.editingRoomId = row.id;
					this._renderTableBody(this._getFilteredRows());
				});
			}

			// WAIT
			const tdWait = DOM.append(tr, DOM.$('td'));
			tdWait.style.cssText = cellStyle;
			const wait = formatWaitTime(row.appointmentStartDate, row.appointmentStartTime);
			if (wait) {
				tdWait.style.color = wait.color;
				tdWait.style.fontWeight = '500';
				tdWait.textContent = wait.text;
			} else {
				tdWait.textContent = '—';
				tdWait.style.color = 'var(--vscode-descriptionForeground)';
			}

			// ACTIONS — Open Chart / Record Vitals / Visit Summary, matching EHR-UI
			const tdActions = DOM.append(tr, DOM.$('td'));
			tdActions.style.cssText = cellStyle + 'display:flex;gap:6px;align-items:center;';

			const iconBtn = (icon: string, title: string, color: string, onClick: () => void) => {
				const b = DOM.append(tdActions, DOM.$('button')) as HTMLButtonElement;
				b.textContent = icon;
				b.title = title;
				b.style.cssText = `background:transparent;border:none;cursor:pointer;font-size:15px;padding:4px 6px;border-radius:4px;color:${color};`;
				b.addEventListener('mouseenter', () => { b.style.background = `${color}20`; });
				b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
				b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
				return b;
			};

			// allow-any-unicode-next-line
			iconBtn('📋', 'Open Chart', '#3b82f6', () => this._openVisitChart(row));
			// allow-any-unicode-next-line
			iconBtn('❤', 'Record Vitals', '#a855f7', () => this._openVitalsForRow(row));
			// allow-any-unicode-next-line
			iconBtn('🗒', 'Visit Summary', '#f59e0b', () => this._openVisitSummary(row));
		}
	}

	/** "Open Chart" — for an appointment row, opens the encounter form (parity
	 *  with EHR-UI). Falls back to the patient chart when no encounter is linked
	 *  yet (e.g. status is still Scheduled and an encounter hasn't been created). */
	private _openVisitChart(row: AppointmentDTO): void {
		if (row.encounterId) {
			this.commandService.executeCommand('ciyex.openEncounter', String(row.patientId), String(row.encounterId), row.patientName || '');
			return;
		}
		this._openPatientChart(row.patientId, row.patientName || '');
	}

	/** "Record Vitals" — opens the encounter on the vitals section. Without an
	 *  encounter, falls back to the patient chart's Vitals tab. */
	private _openVitalsForRow(row: AppointmentDTO): void {
		if (row.encounterId) {
			this.commandService.executeCommand('ciyex.openEncounter', String(row.patientId), String(row.encounterId), row.patientName || '', 'vitals');
			return;
		}
		this._openPatientChartTab(row.patientId, row.patientName || '', 'vitals');
	}

	/** Opens the patient chart with a specific initial tab pre-selected
	 *  (used by "Record Vitals" → vitals tab, etc.). */
	private _openPatientChartTab(patientId: number, patientName: string, tabKey: string): void {
		this.commandService.executeCommand('ciyex.openPatientChart', String(patientId), patientName, tabKey);
	}

	/** "Visit Summary": if the appointment has a linked encounterId, open the
	 *  encounter form; otherwise fall back to opening the chart on Encounters. */
	private _openVisitSummary(row: AppointmentDTO): void {
		if (row.encounterId) {
			this.commandService.executeCommand('ciyex.openEncounter', String(row.patientId), String(row.encounterId), row.patientName || '');
			return;
		}
		this._openPatientChartTab(row.patientId, row.patientName || '', 'encounters');
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
