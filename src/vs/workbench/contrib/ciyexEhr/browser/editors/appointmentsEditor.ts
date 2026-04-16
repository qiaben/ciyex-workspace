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
import * as DOM from '../../../../../base/browser/dom.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AppointmentDTO {
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
}

interface Provider { id: number; name: string; }
interface Location { id: number; name: string; }

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
	private datePreset = 'today';
	private patientSearch = '';
	private providerFilter = '';
	private locationFilter = '';
	private typeFilter = '';
	private statusFilter = '';

	// Pagination
	private currentPage = 1;
	private pageSize = 20;
	private totalCount = 0;

	// Auto-refresh
	private refreshInterval = 30000;
	private _refreshTimer: ReturnType<typeof setInterval> | null = null;

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
	) {
		super(AppointmentsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.appointments-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1400px;margin:0 auto;padding:20px 24px;';
	}

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
			let url = `/api/appointments?page=${this.currentPage - 1}&size=${this.pageSize}`;
			url += `&dateFrom=${range.from}T00:00:00&dateTo=${range.to}T23:59:59`;
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
			if (!row.locationName && row.locationId) {
				const loc = this.locations.find(l => l.id === row.locationId);
				if (loc) { row.locationName = loc.name; }
			}
		}
	}

	// ─── Auto-refresh ──────────────────────────────────────────────────────

	private _startAutoRefresh(): void {
		this._stopAutoRefresh();
		if (this.refreshInterval > 0) {
			this._refreshTimer = setInterval(() => this._loadAppointments(), this.refreshInterval);
		}
	}

	private _stopAutoRefresh(): void {
		if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
	}

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
				if (r.visitType !== this.typeFilter) { return false; }
			}
			return true;
		});
	}

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
		const w = window.open('', '_blank');
		if (w) { w.document.write(html); w.document.close(); w.print(); }
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

	// ─── Render ─────────────────────────────────────────────────────────────

	private _renderError(msg: string): void {
		DOM.clearNode(this.contentEl);
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

		// Auto-refresh
		const refreshWrap = DOM.append(actionGroup, DOM.$('div'));
		refreshWrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
		const refreshIcon = DOM.append(refreshWrap, DOM.$('span'));
		refreshIcon.textContent = '⟳';
		refreshIcon.style.cssText = 'font-size:14px;color:var(--vscode-descriptionForeground);';
		const refreshSel = DOM.append(refreshWrap, DOM.$('select')) as HTMLSelectElement;
		refreshSel.style.cssText = selectStyle;
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
		printBtn.textContent = '🖨 Print';
		printBtn.addEventListener('click', () => this._printTable());

		// Export
		const exportBtn = DOM.append(actionGroup, DOM.$('button'));
		exportBtn.style.cssText = btnStyle;
		exportBtn.textContent = '⬇ Export';
		exportBtn.addEventListener('click', () => this._exportToCSV());

		// TV Display
		const tvBtn = DOM.append(actionGroup, DOM.$('button'));
		tvBtn.style.cssText = btnStyle;
		tvBtn.textContent = '🖥 TV Display';
		tvBtn.addEventListener('click', () => {
			// Open TV display in a new window (or could be a command)
			try {
				const apiUrl = this.apiService.apiUrl;
				const base = apiUrl.replace('/api', '').replace('api-dev', 'app-dev');
				window.open(`${base}/appointments/tv?mode=staff`, '_blank');
			} catch { /* */ }
		});

		// ─── Filters ───────────────────────────────────────────────────────
		const filters = DOM.append(this.contentEl, DOM.$('div'));
		filters.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;padding:12px 16px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;';

		// Date preset
		const dateSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		dateSel.style.cssText = selectStyle;
		for (const p of DATE_PRESETS) {
			const o = DOM.append(dateSel, DOM.$('option')) as HTMLOptionElement;
			o.value = p.value; o.textContent = p.label;
			if (p.value === this.datePreset) { o.selected = true; }
		}
		dateSel.addEventListener('change', () => {
			this.datePreset = dateSel.value;
			this.currentPage = 1;
			this._loadAppointments();
		});

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

		// Type filter
		const typeSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		typeSel.style.cssText = selectStyle;
		const typeAll = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
		typeAll.value = ''; typeAll.textContent = 'All Types';
		for (const t of this.visitTypes) {
			const o = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
			o.value = t; o.textContent = t;
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

		// ─── Table ─────────────────────────────────────────────────────────
		const tableWrap = DOM.append(this.contentEl, DOM.$('div'));
		tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;overflow:hidden;';

		const table = DOM.append(tableWrap, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;';

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

		// ─── Pagination ────────────────────────────────────────────────────
		const pagBar = DOM.append(this.contentEl, DOM.$('div'));
		pagBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 0;margin-top:8px;';

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

			// DATE
			const tdDate = DOM.append(tr, DOM.$('td'));
			tdDate.style.cssText = cellStyle;
			const dateStr = formatToDisplay(row.appointmentStartDate);
			const timeStr = formatTimeTo12h(row.appointmentStartTime);
			const dateLine = DOM.append(tdDate, DOM.$('div'));
			dateLine.textContent = dateStr;
			const timeLine = DOM.append(tdDate, DOM.$('div'));
			timeLine.textContent = timeStr;
			timeLine.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

			// PATIENT
			const tdPatient = DOM.append(tr, DOM.$('td'));
			tdPatient.style.cssText = cellStyle;
			const patientLink = DOM.append(tdPatient, DOM.$('span'));
			patientLink.textContent = row.patientName || `Patient #${row.patientId}`;
			patientLink.style.cssText = 'cursor:pointer;color:var(--vscode-textLink-foreground,#3794ff);';
			patientLink.addEventListener('click', () => this._openPatientChart(row.patientId, row.patientName || ''));

			// PROVIDER
			const tdProv = DOM.append(tr, DOM.$('td'));
			tdProv.style.cssText = cellStyle;
			tdProv.textContent = row.providerName || '';

			// LOCATION
			const tdLoc = DOM.append(tr, DOM.$('td'));
			tdLoc.style.cssText = cellStyle;
			tdLoc.textContent = row.locationName || '';

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
				roomSpan.textContent = row.room || '—';
				roomSpan.style.cssText = 'cursor:pointer;color:var(--vscode-descriptionForeground);';
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

			// ACTIONS
			const tdActions = DOM.append(tr, DOM.$('td'));
			tdActions.style.cssText = cellStyle + 'display:flex;gap:4px;';

			// Quick status advance button
			if (so?.nextStatus && !so?.terminal) {
				const advBtn = DOM.append(tdActions, DOM.$('button'));
				const nextSo = this.statusOptions.find(s => s.value === so.nextStatus);
				advBtn.textContent = `→ ${nextSo?.label || so.nextStatus}`;
				advBtn.title = `Move to ${nextSo?.label || so.nextStatus}`;
				advBtn.style.cssText = `padding:3px 8px;font-size:10px;border:none;border-radius:4px;cursor:pointer;background:${nextSo?.color || '#0e639c'};color:#fff;white-space:nowrap;`;
				advBtn.addEventListener('click', () => this._updateStatus(row.id, so.nextStatus!));
			}

			// Open chart
			const chartBtn = DOM.append(tdActions, DOM.$('button'));
			chartBtn.textContent = '📋';
			chartBtn.title = 'Open Patient Chart';
			chartBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px;';
			chartBtn.addEventListener('click', () => this._openPatientChart(row.patientId, row.patientName || ''));
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
