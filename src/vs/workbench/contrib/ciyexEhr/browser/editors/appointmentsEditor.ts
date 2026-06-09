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
import { AppointmentsEditorInput, CalendarEditorInput, StaffTvBoardEditorInput, WaitingRoomEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { editorBackground, editorForeground, editorWidgetBackground, editorWidgetBorder } from '../../../../../platform/theme/common/colors/editorColors.js';
import { descriptionForeground, errorForeground, textLinkForeground } from '../../../../../platform/theme/common/colors/baseColors.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown } from '../customDropdown.js';

// allow-any-unicode-next-line
// ─── Types ──────────────────────────────────────────────────────────────────

interface VisitSummaryMeta {
	visitCategory?: string;
	type?: string;
	facility?: string;
	dateOfService?: string;
	reasonForVisit?: string;
}

interface VisitSummaryChiefComplaint {
	title?: string;
	complaint?: string;
	notes?: string;
}

interface VisitSummaryDTO {
	meta?: VisitSummaryMeta;
	chiefComplaints?: VisitSummaryChiefComplaint[];
}

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

interface Provider {
	id: number;
	name: string;
	firstName?: string;
	lastName?: string;
	fullName?: string;
	displayName?: string;
	username?: string;
	'identification.prefix'?: string;
	'identification.firstName'?: string;
	'identification.lastName'?: string;
}
interface Location { id: number; name: string }

/** Build a provider display name from any of the assorted field shapes the
 *  backend may return (`identification.*` flat keys, `firstName`/`lastName`,
 *  `name`, `fullName`, etc.). Falls back to `username` and finally the ID. */
function buildProviderName(p: Provider | undefined | null): string {
	if (!p) { return ''; }
	const prefix = p['identification.prefix'] || '';
	const fn = p['identification.firstName'] || p.firstName || '';
	const ln = p['identification.lastName'] || p.lastName || '';
	const composed = `${prefix} ${fn} ${ln}`.trim();
	if (composed) { return composed; }
	return p.displayName || p.fullName || p.name || p.username || (p.id !== null && p.id !== undefined ? String(p.id) : '');
}

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
		// Strip the trailing `}` / `]` / `)` that comes from a HashMap.toString()
		// representation, e.g. "{coding=[{...}], text=Routine}" — the test team
		// reported this rendering as "Routine}" in the appointments table.
		const m = raw.match(/text=([^,}\])]+)/);
		if (m) { return m[1].trim(); }
		const d = raw.match(/display=([^,}\])]+)/);
		if (d) { return d[1].trim(); }
		return raw;
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

/** Coerce a FHIR-ish status value into a clean lowercase string. Same
 *  defensive logic as {@link normalizeVisitType} — the upstream may send a
 *  CodeableConcept blob ("{coding=[...], text=Checked-in}") that renders as
 *  "[object Object]" or "Checked-in}" in the status badge. */
function normalizeStatus(raw: unknown): string {
	if (!raw) { return ''; }
	if (typeof raw === 'string') {
		const m = raw.match(/text=([^,}\])]+)/);
		if (m) { return m[1].trim(); }
		const d = raw.match(/display=([^,}\])]+)/);
		if (d) { return d[1].trim(); }
		const c = raw.match(/code=([^,}\])]+)/);
		if (c) { return c[1].trim(); }
		return raw;
	}
	if (typeof raw === 'object' && raw !== null) {
		const obj = raw as Record<string, unknown>;
		if (obj.text) { return String(obj.text); }
		if (Array.isArray(obj.coding) && obj.coding.length > 0) {
			const c0 = obj.coding[0] as Record<string, string>;
			return c0.display || c0.code || '';
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
	private datePreset = 'today';
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
	private _countdownTimer: number | null = null;
	private _nextRefreshAt = 0;
	private countdownEl: HTMLElement | null = null;

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
		this.root = DOM.append(parent, DOM.$('.appointments-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);';
		// Flex column so the toolbar/filters keep their natural height and the
		// table wrapper flex-fills the remaining space and owns the vertical
		// scroll. Scrolling the table inside its own wrapper (rather than the
		// whole content area) is what lets the table header stay sticky — a
		// sticky <thead> only pins relative to its nearest scroll container.
		// Pagination is rendered as a pinned sibling of contentEl (see _render).
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;padding:20px 24px;min-height:0;';
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
				const raw = (d?.data?.content || d?.data || d?.content || d || []) as Provider[];
				// Backends return assorted shapes (`identification.firstName`,
				// `firstName`/`lastName`, sometimes just `username`). Build a
				// canonical `name` on the cached entries so every row render
				// resolves to a real display string instead of falling back to
				// the ID.
				this.providers = raw.map(p => ({ ...p, name: buildProviderName(p) }));
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

			// Normalize visit types + status — FHIR CodeableConcept blobs would
			// otherwise render as "[object Object]" / "Routine}" in the table.
			for (const a of list) {
				a.visitType = normalizeVisitType(a.visitType);
				a.status = normalizeStatus(a.status);
			}

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
			// Always try to resolve a friendly provider name — the backend
			// sometimes populates `providerName` with the ID/UUID itself, so
			// we replace it when a real name is available from the cache.
			const looksLikeId = (s: string | undefined): boolean => {
				if (!s) { return true; }
				const t = s.trim();
				if (!t) { return true; }
				// UUID / numeric ID / "Practitioner/<id>" reference
				return /^[0-9a-f-]{8,}$/i.test(t) || /^\d+$/.test(t) || /^Practitioner\//i.test(t);
			};
			if (row.providerId !== undefined && row.providerId !== null) {
				const prov = this.providers.find(p => String(p.id) === String(row.providerId));
				if (prov && prov.name && (looksLikeId(row.providerName) || !row.providerName)) {
					row.providerName = prov.name;
				}
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
			const win = DOM.getActiveWindow();
			this._nextRefreshAt = Date.now() + this.refreshInterval;
			this._refreshTimer = win.setInterval(() => {
				this._nextRefreshAt = Date.now() + this.refreshInterval;
				void this._loadAppointments();
			}, this.refreshInterval);
			// Countdown ticker — updates the visible "30s" label every second.
			this._countdownTimer = win.setInterval(() => this._updateCountdownLabel(), 1000);
		}
		this._updateCountdownLabel();
	}

	private _stopAutoRefresh(): void {
		const win = DOM.getActiveWindow();
		if (this._refreshTimer) { win.clearInterval(this._refreshTimer); this._refreshTimer = null; }
		if (this._countdownTimer) { win.clearInterval(this._countdownTimer); this._countdownTimer = null; }
		this._nextRefreshAt = 0;
		this._updateCountdownLabel();
	}

	private _updateCountdownLabel(): void {
		if (!this.countdownEl) { return; }
		if (this.refreshInterval <= 0 || this._nextRefreshAt === 0) {
			this.countdownEl.textContent = '';
			return;
		}
		const seconds = Math.max(0, Math.ceil((this._nextRefreshAt - Date.now()) / 1000));
		this.countdownEl.textContent = `(${seconds}s)`;
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
				// `appointmentType` on the raw row can be a FHIR CodeableConcept
				// object — stringifying it produced "[object Object]" which never
				// matched. Normalize it the same way as `visitType` so the filter
				// compares against the displayable text.
				const rawAt = (r as unknown as Record<string, unknown>).appointmentType;
				const at = normalizeVisitType(rawAt).trim().toLowerCase();
				const tp = String((r as unknown as Record<string, unknown>).type || '').trim().toLowerCase();
				if (vt !== tf && at !== tf && tp !== tf && !vt.includes(tf) && !at.includes(tf) && !tp.includes(tf)) { return false; }
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
			// When the new status creates an encounter (e.g. Checked-in), redirect
			// to the encounter screen for that appointment so the provider lands on
			// the chart instead of having to open it manually. Prefer the backend's
			// flag, falling back to the built-in status table if it isn't provided.
			const loaded = this.statusOptions.find(s => s.value === newStatus);
			const fallback = FALLBACK_STATUS_OPTIONS.find(s => s.value === newStatus);
			const triggersEncounter = loaded?.triggersEncounter ?? fallback?.triggersEncounter ?? false;
			if (triggersEncounter) {
				const row = this.rows.find(r => r.id === id);
				if (row) { this._openVisitChart(row); }
			}
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

	private _openPatientChart(row: AppointmentDTO): void {
		const patientId = this._resolveActionPatientId(row);
		if (!patientId) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'No patient is linked to this appointment yet.' });
			return;
		}
		this.commandService.executeCommand('ciyex.openPatientChart', patientId, row.patientName || '')
			.catch(err => this.notificationService.notify({ severity: Severity.Error, message: `Open Patient Chart failed: ${String(err)}` }));
	}

	private _printTable(): void {
		// Render the print template into a VISIBLE modal preview before
		// invoking the system print dialog. The hidden-iframe approach
		// previously used here never surfaced the PDF template to the user
		// (test team flagged "Print … not showing the pdf template"); the
		// modal mirrors the EHR Web UI's print-preview behavior — the
		// template is shown on screen, then the user can use the in-modal
		// "Print / Save as PDF" button to trigger the OS dialog.
		const filtered = this._getFilteredRows();
		const doc = DOM.getActiveWindow().document;

		// Modal backdrop — full-viewport dimmer; click outside to dismiss.
		const backdrop = DOM.append(doc.body, DOM.$('div.ciyex-print-backdrop'));
		backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;display:flex;align-items:center;justify-content:center;';

		const sheet = DOM.append(backdrop, DOM.$('div.ciyex-print-sheet'));
		sheet.style.cssText = 'background:#fff;color:#222;width:min(960px,92vw);max-height:88vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.4);display:flex;flex-direction:column;overflow:hidden;font-family:sans-serif;';

		const toolbar = DOM.append(sheet, DOM.$('div.ciyex-print-toolbar'));
		toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e5e5e5;background:#f7f7f7;flex-shrink:0;';
		const toolbarTitle = DOM.append(toolbar, DOM.$('span'));
		toolbarTitle.textContent = `Print Preview — ${filtered.length} appointment${filtered.length !== 1 ? 's' : ''}`;
		toolbarTitle.style.cssText = 'font-size:13px;font-weight:600;color:#222;flex:1;';
		const doPrintBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		doPrintBtn.textContent = 'Print / Save as PDF';
		doPrintBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
		const closePrintBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		closePrintBtn.textContent = 'Close';
		closePrintBtn.style.cssText = 'padding:6px 14px;background:#e5e5e5;color:#222;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:12px;';

		const preview = DOM.append(sheet, DOM.$('div.ciyex-print-preview'));
		preview.style.cssText = 'overflow:auto;padding:24px 28px;flex:1;background:#fff;';
		const previewHeading = DOM.append(preview, DOM.$('h2'));
		// allow-any-unicode-next-line
		previewHeading.textContent = `Appointments — ${this.datePreset}`;
		previewHeading.style.cssText = 'margin:0 0 16px;font-size:18px;color:#222;';
		const previewMeta = DOM.append(preview, DOM.$('div'));
		previewMeta.style.cssText = 'margin-bottom:14px;font-size:11px;color:#666;';
		previewMeta.textContent = `Generated ${new Date().toLocaleString()}`;
		const previewTable = DOM.append(preview, DOM.$('table'));
		previewTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;color:#222;';
		const previewThead = DOM.append(previewTable, DOM.$('thead'));
		const previewHeadRow = DOM.append(previewThead, DOM.$('tr'));
		for (const label of ['Date', 'Time', 'Patient', 'Provider', 'Location', 'Type', 'Status', 'Room']) {
			const th = DOM.append(previewHeadRow, DOM.$('th'));
			th.textContent = label;
			th.style.cssText = 'padding:8px 10px;text-align:left;border:1px solid #ddd;background:#f5f5f5;font-weight:600;text-transform:uppercase;font-size:11px;';
		}
		const previewTbody = DOM.append(previewTable, DOM.$('tbody'));
		for (const r of filtered) {
			const so = this.statusOptions.find(s => s.value === r.status);
			const tr = DOM.append(previewTbody, DOM.$('tr'));
			const cells: string[] = [
				formatToDisplay(r.appointmentStartDate),
				formatTimeTo12h(r.appointmentStartTime),
				r.patientName || '',
				r.providerName || '',
				r.locationName || '',
				r.visitType || '',
				so?.label || r.status || '',
				r.room || '',
			];
			for (const c of cells) {
				const td = DOM.append(tr, DOM.$('td'));
				td.textContent = String(c);
				td.style.cssText = 'padding:8px 10px;text-align:left;border:1px solid #ddd;';
			}
		}
		if (filtered.length === 0) {
			const emptyRow = DOM.append(previewTbody, DOM.$('tr'));
			const emptyTd = DOM.append(emptyRow, DOM.$('td')) as HTMLTableCellElement;
			emptyTd.colSpan = 8;
			emptyTd.textContent = 'No appointments match the current filters.';
			emptyTd.style.cssText = 'padding:18px;text-align:center;color:#888;border:1px solid #ddd;';
		}

		const dismissPrint = () => { try { doc.body.removeChild(backdrop); } catch { /* ignore */ } };
		closePrintBtn.addEventListener('click', dismissPrint);
		backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { dismissPrint(); } });
		doPrintBtn.addEventListener('click', () => {
			// Add a transient print stylesheet that hides the workbench and
			// the modal toolbar so only the preview sheet ends up on paper /
			// the saved PDF. window.print() then opens the OS dialog.
			const printStyle = doc.createElement('style');
			printStyle.textContent = [
				'@media print{',
				'  body>*:not(.ciyex-print-backdrop){display:none !important;}',
				'  .ciyex-print-backdrop{position:static !important;background:#fff !important;display:block !important;inset:auto !important;}',
				'  .ciyex-print-sheet{box-shadow:none !important;border-radius:0 !important;width:100% !important;max-height:none !important;}',
				'  .ciyex-print-toolbar{display:none !important;}',
				'  .ciyex-print-preview{overflow:visible !important;padding:0 !important;}',
				'  @page{size:landscape;margin:14mm;}',
				'}',
			].join('');
			doc.head.appendChild(printStyle);
			try { DOM.getActiveWindow().print(); }
			finally { try { doc.head.removeChild(printStyle); } catch { /* ignore */ } }
		});
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

		// SVG helpers — avoid innerHTML to comply with VS Code Trusted Types policy
		const SVG_NS = 'http://www.w3.org/2000/svg';
		const mkSvg = (): SVGSVGElement => {
			const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
			svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
			svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
			svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
			svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
			return svg;
		};
		const svgPath = (svg: SVGSVGElement, d: string) => { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); };
		const svgRect = (svg: SVGSVGElement, x: string, y: string, w: string, h: string, rx: string) => { const r = document.createElementNS(SVG_NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('rx', rx); svg.appendChild(r); };
		// allow-any-unicode-next-line
		// ─── Header ────────────────────────────────────────────────────────
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;flex-shrink:0;';

		const titleGroup = DOM.append(header, DOM.$('div'));
		titleGroup.style.cssText = 'display:flex;align-items:center;gap:12px;';

		const backBtn = DOM.append(titleGroup, DOM.$('button')) as HTMLButtonElement;
		backBtn.title = 'Back to Calendar';
		backBtn.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 10px;background:transparent;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		backBtn.textContent = '← Calendar';
		backBtn.addEventListener('mouseenter', () => { backBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15))'; });
		backBtn.addEventListener('mouseleave', () => { backBtn.style.background = 'transparent'; });
		backBtn.addEventListener('click', () => { this.group.openEditor(new CalendarEditorInput(), { pinned: false }); });

		const title = DOM.append(titleGroup, DOM.$('h2'));
		title.textContent = 'Appointments';
		title.style.cssText = 'font-size:22px;font-weight:700;margin:0;';

		this.badgeEl = DOM.append(titleGroup, DOM.$('span'));
		this.badgeEl.style.cssText = 'padding:3px 10px;border-radius:12px;font-size:12px;font-weight:500;background:var(--vscode-badge-background,#0e639c);color:var(--vscode-badge-foreground,#fff);';
		this.badgeEl.textContent = `${filtered.length} appointment${filtered.length !== 1 ? 's' : ''}`;

		const actionGroup = DOM.append(header, DOM.$('div'));
		actionGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

		// Manual refresh — clicking immediately reloads the table. Provide a
		// visible "spinning" feedback so the user can tell the click landed.
		const refreshBtn = DOM.append(actionGroup, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.style.cssText = btnStyle;
		const refreshSvg = mkSvg();
		svgPath(refreshSvg, 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8');
		svgPath(refreshSvg, 'M21 3v5h-5');
		svgPath(refreshSvg, 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16');
		svgPath(refreshSvg, 'M8 16H3v5');
		refreshBtn.appendChild(refreshSvg);
		refreshBtn.title = 'Refresh appointments now';
		refreshBtn.addEventListener('click', async () => {
			refreshBtn.disabled = true;
			refreshBtn.style.opacity = '0.5';
			try { await this._loadAppointments(); }
			finally {
				refreshBtn.disabled = false;
				refreshBtn.style.opacity = '1';
			}
		});

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
		// Visible countdown so the team can confirm auto-refresh is firing.
		this.countdownEl = DOM.append(refreshWrap, DOM.$('span'));
		this.countdownEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);min-width:36px;font-variant-numeric:tabular-nums;';
		this._updateCountdownLabel();
		refreshSel.addEventListener('change', () => {
			this.refreshInterval = parseInt(refreshSel.value, 10);
			this._startAutoRefresh();
			// Immediate reload on selection so the user sees the action take
			// effect — otherwise picking "30s" looks broken until the timer fires.
			if (this.refreshInterval > 0) { void this._loadAppointments(); }
		});

		// Print — icon-only button (tooltip provides the label).
		const printBtn = DOM.append(actionGroup, DOM.$('button')) as HTMLButtonElement;
		printBtn.style.cssText = btnStyle;
		printBtn.title = 'Print';
		printBtn.setAttribute('aria-label', 'Print');
		const printSvg = mkSvg();
		svgPath(printSvg, 'M6 9V2h12v7');
		svgPath(printSvg, 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2');
		svgRect(printSvg, '6', '14', '12', '8', '0');
		printBtn.appendChild(printSvg);
		printBtn.addEventListener('click', () => {
			try { this._printTable(); }
			catch (err) { this.notificationService.notify({ severity: Severity.Error, message: `Print failed: ${String(err)}` }); }
		});

		// Export — icon-only button (tooltip provides the label).
		const exportBtn = DOM.append(actionGroup, DOM.$('button')) as HTMLButtonElement;
		exportBtn.style.cssText = btnStyle;
		exportBtn.title = 'Export to CSV';
		exportBtn.setAttribute('aria-label', 'Export');
		const exportSvg = mkSvg();
		svgPath(exportSvg, 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
		svgPath(exportSvg, 'M7 10l5 5 5-5');
		svgPath(exportSvg, 'M12 15V3');
		exportBtn.appendChild(exportSvg);
		exportBtn.addEventListener('click', () => this._exportToCSV());

		// TV Display — dropdown with Staff TV Board / Waiting Room
		const tvWrap = DOM.append(actionGroup, DOM.$('div'));
		tvWrap.style.cssText = 'position:relative;';
		const tvBtn = DOM.append(tvWrap, DOM.$('button')) as HTMLButtonElement;
		tvBtn.style.cssText = btnStyle;
		const tvSvg = mkSvg();
		svgRect(tvSvg, '2', '3', '20', '14', '2');
		svgPath(tvSvg, 'M8 21h8m-4-4v4');
		tvBtn.appendChild(tvSvg);
		const tvChevron = DOM.append(tvBtn, DOM.$('span'));
		// allow-any-unicode-next-line
		tvChevron.textContent = '▾';
		tvChevron.style.cssText = 'font-size:9px;margin-left:1px;';
		const tvMenu = DOM.append(tvWrap, DOM.$('div'));
		tvMenu.style.cssText = 'position:absolute;top:calc(100% + 4px);right:0;min-width:180px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.4);z-index:20;display:none;overflow:hidden;';

		const openTv = (mode: 'staff' | 'waiting') => {
			tvMenu.style.display = 'none';
			try {
				// Open the native TV editor (Staff Board / Waiting Room) directly
				// inside the workspace. No web load, no Simple Browser, no external
				// redirect — the editor talks to the same backend API this view does.
				const input = mode === 'staff' ? new StaffTvBoardEditorInput() : new WaitingRoomEditorInput();
				void this.group.openEditor(input, { pinned: true });
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
		filters.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;padding:12px 16px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;flex-shrink:0;';

		// Patient search
		const patientInput = DOM.append(filters, DOM.$('input')) as HTMLInputElement;
		patientInput.style.cssText = inputStyle;
		patientInput.placeholder = 'Search patient...';
		patientInput.value = this.patientSearch;
		patientInput.addEventListener('input', () => {
			this.patientSearch = patientInput.value;
			this._renderTableBody(this._getFilteredRows());
		});

		// Date preset filter — placed before the Provider filter so the date
		// selector lives inline with the other filters rather than on a
		// separate row above the table.
		const dateSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		dateSel.style.cssText = selectStyle;
		dateSel.title = 'Date range';
		for (const p of DATE_PRESETS) {
			const o = DOM.append(dateSel, DOM.$('option')) as HTMLOptionElement;
			o.value = p.value; o.textContent = p.label;
			if (p.value === this.datePreset) { o.selected = true; }
		}

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

		// Type filter — show the full configured catalog plus any extras observed
		// in the current page. The test team flagged that "All Types" only ever
		// showed the few types present in the current dataset; merging the
		// predefined catalog with `visitTypes` gives parity with the EHR-UI.
		const typeSel = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		typeSel.style.cssText = selectStyle;
		const typeAll = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
		typeAll.value = ''; typeAll.textContent = 'All Types';
		if (!this.typeFilter) { typeAll.selected = true; }
		const PREDEFINED_VISIT_TYPES = [
			'Consultation', 'Follow-Up', 'New Patient', 'Urgent',
			'Routine', 'Annual Physical', 'Telehealth', 'Lab Work',
			'Procedure', 'Referral',
		];
		const mergedTypes = Array.from(new Set([...PREDEFINED_VISIT_TYPES, ...this.visitTypes])).sort();
		// Ensure the currently-selected filter value is always present in the
		// option list even if it isn't in the predefined catalog and isn't in
		// the current page of data — otherwise the <select> falls back to the
		// first option ("All Types") and the visual selection appears reset.
		if (this.typeFilter && !mergedTypes.includes(this.typeFilter)) {
			mergedTypes.push(this.typeFilter);
			mergedTypes.sort();
		}
		for (const t of mergedTypes) {
			const o = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
			o.value = t; o.textContent = t;
			if (t === this.typeFilter) { o.selected = true; }
		}
		// Sync the native <select>'s value explicitly — setting `o.selected = true`
		// on an option mid-construction is ignored by some browsers if a later
		// append re-evaluates the default; assigning `typeSel.value` after the
		// loop guarantees the visual state matches `this.typeFilter`.
		typeSel.value = this.typeFilter || '';
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
		// ─── Date Range Row ───────────────────────────────────────────────
		// Custom from/to date pickers, only visible when the preset is
		// "All Time". The date preset selector itself now lives in the
		// filters row above, immediately before the Provider filter.
		const dateRow = DOM.append(this.contentEl, DOM.$('div'));
		dateRow.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:8px;padding:8px 16px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;flex-shrink:0;';

		const dateRight = DOM.append(dateRow, DOM.$('div'));
		dateRight.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const rangeLabel = DOM.append(dateRight, DOM.$('span'));
		rangeLabel.textContent = 'Range:';
		rangeLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;';
		const dateInputStyle = 'padding:5px 30px 5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;outline:none;width:120px;';
		const buildRangeDateInput = (parent: HTMLElement, isoValue: string, titleText: string): HTMLInputElement => {
			const wrap = DOM.append(parent, DOM.$('div'));
			wrap.style.cssText = 'position:relative;display:inline-block;';
			const isoToUs = (iso: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };
			const usToIso = (us: string): string => { const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us); if (!m) { return ''; } return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
			const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			visible.type = 'text';
			visible.placeholder = 'MM/DD/YYYY';
			visible.maxLength = 10;
			visible.value = isoToUs(isoValue);
			visible.style.cssText = dateInputStyle;
			visible.title = titleText;
			const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			hidden.type = 'hidden';
			hidden.value = isoValue || '';
			visible.addEventListener('input', () => {
				const iso = usToIso(visible.value);
				hidden.value = iso;
				visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
				visible.dispatchEvent(new CustomEvent('iso-change', { detail: iso }));
			});
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.value = isoValue || '';
			picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			picker.title = titleText;
			picker.addEventListener('change', () => {
				visible.value = isoToUs(picker.value);
				hidden.value = picker.value;
				visible.dispatchEvent(new CustomEvent('iso-change', { detail: picker.value }));
			});
			const icon = DOM.append(wrap, DOM.$('span'));
			icon.textContent = '\u{1F4C5}';
			icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--vscode-descriptionForeground);pointer-events:none;line-height:1;';
			return hidden;
		};
		const fromInput = buildRangeDateInput(dateRight, this.dateFromCustom, 'From date');
		const toLbl = DOM.append(dateRight, DOM.$('span'));
		toLbl.textContent = 'to';
		toLbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const toInput = buildRangeDateInput(dateRight, this.dateToCustom, 'To date');
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
		// Hide the entire row (not just the pickers) so the otherwise-empty
		// bordered band doesn't sit between the filters and the table.
		const updateRangeVisibility = () => {
			dateRow.style.display = this.datePreset === 'all_time' ? 'flex' : 'none';
		};
		updateRangeVisibility();

		dateSel.addEventListener('change', () => {
			this.datePreset = dateSel.value;
			this.currentPage = 1;
			updateRangeVisibility();
			this._loadAppointments();
		});
		(fromInput.previousElementSibling as HTMLInputElement | null)?.addEventListener('iso-change', () => {
			this.dateFromCustom = fromInput.value;
			this.currentPage = 1;
			this._loadAppointments();
		});
		(toInput.previousElementSibling as HTMLInputElement | null)?.addEventListener('iso-change', () => {
			this.dateToCustom = toInput.value;
			this.currentPage = 1;
			this._loadAppointments();
		});

		// allow-any-unicode-next-line
		// ─── Table ─────────────────────────────────────────────────────────
		const tableWrap = DOM.append(this.contentEl, DOM.$('div'));
		// `ciyex-thin-h-scroll` opts the wrap back into a visible horizontal
		// scrollbar — without it the global `.ciyex-editor-root` rules in
		// ciyexCommon.css hide *every* scrollbar with `!important`, so Windows
		// users (whose mouse wheel does not scroll horizontally by default) lose
		// access to the ACTIONS / ROOM / WAIT columns.
		tableWrap.classList.add('appt-table-wrap', 'ciyex-thin-h-scroll');
		// This wrapper is the scroll container for BOTH axes: horizontal so the
		// ACTIONS/ROOM/WAIT columns stay reachable, vertical so the sticky <thead>
		// (below) pins to the top of the wrapper while the rows scroll under it.
		// `flex:1;min-height:0` lets it fill the remaining height inside the flex
		// column so the body scrolls instead of the whole page.
		tableWrap.style.cssText = 'flex:1;min-height:0;border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;overflow:auto;';

		const table = DOM.append(tableWrap, DOM.$('table'));
		// `table-layout:fixed` honours the column widths set via <colgroup> so all
		// rows stay aligned even when individual cells contain multi-line content.
		table.style.cssText = 'width:100%;min-width:980px;border-collapse:collapse;table-layout:fixed;';

		// Column widths — matched between <colgroup> and the renderTableBody
		// cell order (DATE, PATIENT, PROVIDER, LOCATION, TYPE, STATUS, ROOM, WAIT, ACTIONS).
		const colWidths = ['120px', '170px', '130px', '120px', '100px', '100px', '80px', '70px', '120px'];
		const colgroup = DOM.append(table, DOM.$('colgroup'));
		for (const w of colWidths) {
			const col = DOM.append(colgroup, DOM.$('col')) as HTMLTableColElement;
			col.style.width = w;
		}

		const thead = DOM.append(table, DOM.$('thead'));
		thead.style.cssText = 'position:sticky;top:0;z-index:2;';
		const headRow = DOM.append(thead, DOM.$('tr'));
		headRow.style.cssText = 'background:var(--vscode-editorWidget-background,#252526);';
		const columns = ['DATE', 'PATIENT', 'PROVIDER', 'LOCATION', 'TYPE', 'STATUS', 'ROOM', 'WAIT', 'ACTIONS'];
		for (const col of columns) {
			const th = DOM.append(headRow, DOM.$('th'));
			th.textContent = col;
			// Sticky-friendly background: each <th> repeats the row background so the
			// header looks solid as it stays pinned during vertical scroll.
			th.style.cssText = 'padding:10px 12px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--vscode-foreground);letter-spacing:0.5px;border-bottom:2px solid var(--vscode-focusBorder,#0e639c);white-space:nowrap;background:var(--vscode-editorWidget-background,#252526);';
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

		const cellStyle = 'padding:10px 12px;border-bottom:1px solid var(--vscode-editorWidget-border,#3c3c3c);font-size:12px;vertical-align:top;overflow:hidden;text-overflow:ellipsis;';

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
			patientLink.addEventListener('click', () => this._openPatientChart(row));
			const mrnLine = DOM.append(tdPatient, DOM.$('div'));
			mrnLine.textContent = `MRN: ${row.patientId}`;
			mrnLine.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			if (row.patientPhone) {
				const phoneLine = DOM.append(tdPatient, DOM.$('div'));
				phoneLine.textContent = row.patientPhone;
				phoneLine.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			}

			// PROVIDER — prefer the enriched name; fall back to a live cache
			// lookup so we don't render a bare UUID/ID when `providerName`
			// is missing or itself looks like an identifier.
			const tdProv = DOM.append(tr, DOM.$('td'));
			tdProv.style.cssText = cellStyle;
			const provLookup = row.providerId !== undefined && row.providerId !== null
				? this.providers.find(p => String(p.id) === String(row.providerId))
				: undefined;
			const provFromCache = buildProviderName(provLookup);
			const providerCellName = (() => {
				const candidate = (row.providerName || '').trim();
				if (!candidate) { return provFromCache || (row.providerId ? `Provider #${row.providerId}` : ''); }
				// `candidate` looks like a UUID / numeric ID / FHIR reference → swap for the resolved name.
				const isIdLike = /^[0-9a-f-]{8,}$/i.test(candidate) || /^\d+$/.test(candidate) || /^Practitioner\//i.test(candidate);
				return isIdLike && provFromCache ? provFromCache : candidate;
			})();
			tdProv.textContent = providerCellName;

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
					// Compact, theme-aware popover (createCustomDropdown) instead of the
					// native <select>, whose OS-rendered popup looked oversized and
					// inconsistent on the workbench themes the QA team flagged.
					const wrap = DOM.append(tdRoom, DOM.$('div'));
					wrap.style.cssText = 'min-width:120px;max-width:150px;';
					const hidden = createCustomDropdown({
						parent: wrap,
						options: this.roomOptions.map(rm => ({ value: rm, label: rm })),
						initialValue: row.room || '',
						placeholder: 'Unassigned',
						triggerStyle: 'width:100%;box-sizing:border-box;padding:4px 8px;font-size:11px;background:var(--vscode-input-background);border:1px solid var(--vscode-focusBorder);border-radius:4px;color:var(--vscode-input-foreground);cursor:pointer;',
						onChange: (value) => this._updateRoom(row.id, value),
					});
					// Open the popover immediately so the single click that switched the
					// cell into edit mode also reveals the choices.
					const trigger = (hidden as unknown as { ciyexDropdownTrigger?: HTMLElement }).ciyexDropdownTrigger;
					if (trigger) { trigger.focus(); trigger.click(); }
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

			// ACTIONS — Open Chart / Record Vitals / Visit Summary, matching EHR-UI.
			// `display:flex` on the td itself breaks the native table layout, so the
			// flex container is an inner div and the cell keeps its standard table-cell box.
			const tdActions = DOM.append(tr, DOM.$('td'));
			tdActions.style.cssText = cellStyle;
			const actionsWrap = DOM.append(tdActions, DOM.$('div'));
			actionsWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';

			const iconBtn = (icon: string, title: string, color: string, onClick: () => void) => {
				const b = DOM.append(actionsWrap, DOM.$('button')) as HTMLButtonElement;
				// A plain lowercase/hyphenated identifier (e.g. "device-camera-video")
				// is treated as a codicon name and rendered as a crisp icon glyph;
				// anything else (emoji) is rendered as text.
				if (/^[a-z][a-z-]+$/.test(icon)) {
					const ic = DOM.append(b, DOM.$('span.codicon.codicon-' + icon));
					ic.style.cssText = 'font-size:16px;';
				} else {
					b.textContent = icon;
				}
				b.title = title;
				b.style.cssText = `background:transparent;border:none;cursor:pointer;font-size:15px;padding:4px 6px;border-radius:4px;color:${color};display:inline-flex;align-items:center;`;
				b.addEventListener('mouseenter', () => { b.style.background = `${color}20`; });
				b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
				b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
				return b;
			};

			// Telehealth visits only get the join + start-session controls so the
			// user is funnelled into the video session instead of paper-chart flows.
			if ((row.visitType || '').toLowerCase() === 'telehealth') {
				iconBtn('device-camera-video', 'Join Video Visit', '#10b981', () => this._joinTelehealth(row));
				// allow-any-unicode-next-line
				iconBtn('📋', 'Open Chart', '#3b82f6', () => this._openVisitChart(row));
			} else {
				// allow-any-unicode-next-line
				iconBtn('📋', 'Open Chart', '#3b82f6', () => this._openVisitChart(row));
				// allow-any-unicode-next-line
				iconBtn('❤', 'Record Vitals', '#a855f7', () => this._openVitalsForRow(row));
				// allow-any-unicode-next-line
				iconBtn('🗒', 'Visit Summary', '#f59e0b', () => this._openVisitSummary(row));
			}
		}
	}

	/** Join the telehealth video session for an appointment row. */
	private _joinTelehealth(row: AppointmentDTO): void {
		this.commandService.executeCommand(
			'ciyex.openTelehealth',
			String(row.id),
			row.patientName || '',
			row.providerName || '',
		);
	}

	/** Resolve the patient id for a row's actions. When an appointment has a
	 *  linked encounter the encounter's own patient (`encounterPatientId`) is the
	 *  authoritative id — the appointment-level `patientId` can be 0/undefined for
	 *  FHIR-sourced rows, which previously made the action buttons open with a
	 *  `"undefined"` id (the row actions appeared to do nothing). Mirrors the
	 *  EHR-UI `r.encounterPatientId || r.patientId` resolution. */
	private _resolveActionPatientId(row: AppointmentDTO): string {
		const id = row.encounterPatientId ?? row.patientId;
		return (id !== undefined && id !== null) ? String(id) : '';
	}

	/** "Open Chart" — for an appointment row, opens the encounter form (parity
	 *  with EHR-UI). Falls back to the patient chart when no encounter is linked
	 *  yet (e.g. status is still Scheduled and an encounter hasn't been created). */
	private _openVisitChart(row: AppointmentDTO): void {
		const patientId = this._resolveActionPatientId(row);
		const label = row.patientName ? `Visit — ${row.patientName}` : `Encounter ${row.encounterId || ''}`;
		if (row.encounterId) {
			this.commandService.executeCommand('ciyex.openEncounter', patientId, String(row.encounterId), row.patientName || '', label)
				.catch(err => this.notificationService.notify({ severity: Severity.Error, message: `Open Chart failed: ${String(err)}` }));
			return;
		}
		// Always open on encounters tab so payment/billing tab is never shown unexpectedly.
		this._openPatientChartTab(patientId, row.patientName || '', 'encounters');
	}

	/** "Record Vitals" — opens the encounter form (which has a Vitals
	 *  section). Without an encounter, opens the patient chart on the Vitals
	 *  tab so the user lands somewhere they can record values. */
	private _openVitalsForRow(row: AppointmentDTO): void {
		const patientId = this._resolveActionPatientId(row);
		const label = row.patientName ? `Vitals — ${row.patientName}` : `Encounter ${row.encounterId || ''}`;
		if (row.encounterId) {
			this.commandService.executeCommand('ciyex.openEncounter', patientId, String(row.encounterId), row.patientName || '', label, 'vitals')
				.catch(err => this.notificationService.notify({ severity: Severity.Error, message: `Record Vitals failed: ${String(err)}` }));
			return;
		}
		this._openPatientChartTab(patientId, row.patientName || '', 'vitals');
	}

	/** Opens the patient chart with a specific initial tab pre-selected
	 *  (used by "Record Vitals" → vitals tab, etc.). */
	private _openPatientChartTab(patientId: string, patientName: string, tabKey: string): void {
		if (!patientId) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'No patient is linked to this appointment yet.' });
			return;
		}
		this.commandService.executeCommand('ciyex.openPatientChart', patientId, patientName, tabKey)
			.catch(err => this.notificationService.notify({ severity: Severity.Error, message: `Open Patient Chart failed: ${String(err)}` }));
	}

	/** "Visit Summary": opens a themed slide-over panel showing the encounter's
	 *  read-only summary (Encounter Summary section with Type, Facility, Chief
	 *  Complaint, etc.) fetched from the backend, plus a Print button — mirroring
	 *  the EHR-UI `Encountersummary` slide-over. It deliberately does NOT redirect
	 *  to the encounter editor or patient chart. */
	private _openVisitSummary(row: AppointmentDTO): void {
		const patientId = this._resolveActionPatientId(row);
		if (!patientId || !row.encounterId) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'No encounter is linked to this appointment yet.' });
			return;
		}
		this._showVisitSummaryPanel(patientId, String(row.encounterId), row.patientName || 'Patient');
	}

	/** Resolve concrete theme colours for the visit-summary slide-over.
	 *  The panel is mounted on `document.body`, which sits OUTSIDE the workbench
	 *  element that scopes the `--vscode-*` CSS variables — so a bare
	 *  `var(--vscode-editor-background)` resolves to nothing and the panel paints
	 *  transparent (QA report). Resolving real hex values from the active theme
	 *  keeps the panel opaque and theme-aware in every theme. */
	private _summaryColors(): { bg: string; widgetBg: string; fg: string; border: string; desc: string; link: string; error: string } {
		const theme = this.themeService.getColorTheme();
		const c = (id: string, fallback: string): string => {
			const col = theme.getColor(id);
			return col ? col.toString() : fallback;
		};
		return {
			bg: c(editorBackground, '#1e1e1e'),
			widgetBg: c(editorWidgetBackground, '#252526'),
			fg: c(editorForeground, '#d4d4d4'),
			border: c(editorWidgetBorder, '#454545'),
			desc: c(descriptionForeground, '#999999'),
			link: c(textLinkForeground, '#3794ff'),
			error: c(errorForeground, '#f48771'),
		};
	}

	/** Builds the Visit Summary slide-over (panel + backdrop) and loads its data.
	 *  Reuses the body-mounted overlay pattern used by `_printTable`. */
	private _showVisitSummaryPanel(patientId: string, encounterId: string, patientName: string): void {
		const doc = DOM.getActiveWindow().document;
		const col = this._summaryColors();

		// Backdrop dimmer — click outside to dismiss.
		const backdrop = DOM.append(doc.body, DOM.$('div.ciyex-summary-backdrop'));
		backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9998;display:flex;justify-content:flex-end;';

		// Right-anchored slide-over sheet.
		const sheet = DOM.append(backdrop, DOM.$('div.ciyex-summary-sheet'));
		sheet.style.cssText = `background:${col.bg};color:${col.fg};width:min(720px,65vw);height:100%;box-shadow:-8px 0 32px rgba(0,0,0,0.35);display:flex;flex-direction:column;overflow:hidden;font-family:var(--vscode-font-family);`;

		// Header: title + a single, icon-only Close control. The action buttons
		// (Download / Print) were moved to a bottom footer toolbar: on the
		// Windows/Mac desktop exe this slide-over reaches the very top of the
		// window, so header buttons sat directly under the native window controls
		// (minimise / maximise / close) and crowded them — exactly the
		// "not user-friendly" overlap QA flagged. A footer toolbar never collides
		// with the OS titlebar and gives the actions room to breathe.
		const header = DOM.append(sheet, DOM.$('div.ciyex-summary-header'));
		header.style.cssText = `display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid ${col.border};background:${col.widgetBg};flex-shrink:0;`;
		const headerTitle = DOM.append(header, DOM.$('span'));
		// allow-any-unicode-next-line
		headerTitle.textContent = `Visit Summary — ${patientName}`;
		headerTitle.style.cssText = `font-size:14px;font-weight:600;color:${col.fg};flex:1;`;
		const closeBtn = DOM.append(header, DOM.$('button.codicon.codicon-close')) as HTMLButtonElement;
		closeBtn.title = 'Close';
		closeBtn.setAttribute('aria-label', 'Close');
		// Extra right margin keeps the × clear of the desktop window controls.
		closeBtn.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:transparent;color:${col.desc};border:none;border-radius:5px;cursor:pointer;font-size:15px;margin-right:96px;`;
		closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; closeBtn.style.color = col.fg; });
		closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = col.desc; });

		// Scrollable body where the summary content is rendered.
		const body = DOM.append(sheet, DOM.$('div.ciyex-summary-body'));
		body.style.cssText = `overflow:auto;padding:20px 22px;flex:1;background:${col.bg};`;
		const loading = DOM.append(body, DOM.$('div'));
		loading.textContent = 'Loading encounter summary…';
		loading.style.cssText = `font-size:13px;color:${col.desc};`;

		// Footer action toolbar — clearly-labelled Download / Print buttons.
		const footer = DOM.append(sheet, DOM.$('div.ciyex-summary-footer'));
		footer.style.cssText = `display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;border-top:1px solid ${col.border};background:${col.widgetBg};flex-shrink:0;`;
		const makeFooterBtn = (codicon: string, label: string, primary: boolean): { btn: HTMLButtonElement; lbl: HTMLElement } => {
			const btn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
			btn.style.cssText = primary
				? 'display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;'
				: `display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid ${col.border};border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;`;
			const ic = DOM.append(btn, DOM.$('span.codicon.codicon-' + codicon));
			ic.style.cssText = 'font-size:14px;';
			const lbl = DOM.append(btn, DOM.$('span'));
			lbl.textContent = label;
			return { btn, lbl };
		};
		const { btn: downloadBtn, lbl: downloadLbl } = makeFooterBtn('cloud-download', 'Download PDF', true);
		const { btn: printBtn } = makeFooterBtn('printer', 'Print', false);

		const dismiss = () => { try { doc.body.removeChild(backdrop); } catch { /* ignore */ } };
		closeBtn.addEventListener('click', dismiss);
		backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { dismiss(); } });

		// Download: fetch the server-generated PDF (same endpoint the EHR-UI uses)
		// and save it. Falls back to the print dialog if the endpoint is missing,
		// so "Download" no longer just re-opens the print dialog (QA: Download did
		// not actually download).
		downloadBtn.addEventListener('click', async () => {
			const original = downloadLbl.textContent;
			downloadLbl.textContent = 'Generating…';
			downloadBtn.disabled = true;
			try {
				const res = await this.apiService.fetch(`/api/encounters/${patientId}/${encounterId}/summary/print`, {
					headers: { Accept: 'application/pdf' },
				});
				if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
				const blob = await res.blob();
				const blobUrl = URL.createObjectURL(blob);
				const a = DOM.append(doc.body, DOM.$('a')) as HTMLAnchorElement;
				a.href = blobUrl;
				a.download = `encounter-${encounterId}-summary.pdf`;
				a.style.display = 'none';
				a.click();
				URL.revokeObjectURL(blobUrl);
				a.remove();
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Warning, message: `Could not generate PDF (${String(err)}). Use Print to save as PDF instead.` });
			} finally {
				downloadLbl.textContent = original;
				downloadBtn.disabled = false;
			}
		});

		printBtn.addEventListener('click', () => {
			// Transient print stylesheet: hide the workbench + chrome so only the
			// summary body lands on paper / the saved PDF.
			const printStyle = doc.createElement('style');
			printStyle.textContent = [
				'@media print{',
				'  body>*:not(.ciyex-summary-backdrop){display:none !important;}',
				'  .ciyex-summary-backdrop{position:static !important;background:#fff !important;display:block !important;inset:auto !important;}',
				'  .ciyex-summary-sheet{box-shadow:none !important;width:100% !important;height:auto !important;}',
				'  .ciyex-summary-header button,.ciyex-summary-footer{display:none !important;}',
				'  .ciyex-summary-body{overflow:visible !important;padding:0 !important;}',
				'  @page{margin:14mm;}',
				'}',
			].join('');
			doc.head.appendChild(printStyle);
			try { DOM.getActiveWindow().print(); }
			finally { try { doc.head.removeChild(printStyle); } catch { /* ignore */ } }
		});

		void this._loadVisitSummary(patientId, encounterId, body, loading);
	}

	/** Fetches the encounter summary and renders it into the panel body. */
	private async _loadVisitSummary(patientId: string, encounterId: string, body: HTMLElement, loading: HTMLElement): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/encounters/${patientId}/${encounterId}/summary`);
			const json = res.ok ? await res.json() : null;
			const data = json?.success ? (json.data ?? null) : null;
			loading.remove();
			if (!data) {
				const errMsg = DOM.append(body, DOM.$('div'));
				errMsg.textContent = json?.message || 'Unable to load encounter summary.';
				errMsg.style.cssText = `font-size:13px;color:${this._summaryColors().error};`;
				return;
			}
			this._renderVisitSummary(body, data);
		} catch (err) {
			loading.textContent = `Failed to load encounter summary: ${String(err)}`;
			loading.style.color = this._summaryColors().error;
		}
	}

	/** Renders the Encounter Summary card (Type / Facility / Chief Complaint, …)
	 *  from the EncounterSummaryDto returned by the backend. */
	private _renderVisitSummary(body: HTMLElement, data: VisitSummaryDTO): void {
		const meta = data.meta || {};
		const chiefComplaints = data.chiefComplaints || [];
		const col = this._summaryColors();

		// Encounter Summary card.
		const card = DOM.append(body, DOM.$('div'));
		card.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};padding:18px;margin-bottom:16px;`;
		const cardTitle = DOM.append(card, DOM.$('div'));
		cardTitle.textContent = 'Encounter Summary';
		cardTitle.style.cssText = `font-size:16px;font-weight:700;color:${col.link};border-bottom:2px solid ${col.border};padding-bottom:8px;margin-bottom:14px;`;

		const fields: Array<[string, string | undefined]> = [
			['Visit Category', meta.visitCategory],
			['Type', meta.type],
			['Facility', meta.facility],
			['Date of Service', meta.dateOfService],
			['Reason for Visit', meta.reasonForVisit],
		];
		const grid = DOM.append(card, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;';
		let anyMeta = false;
		for (const [label, value] of fields) {
			if (!value) { continue; }
			anyMeta = true;
			const fieldRow = DOM.append(grid, DOM.$('div'));
			fieldRow.style.cssText = 'display:flex;font-size:13px;';
			const lbl = DOM.append(fieldRow, DOM.$('span'));
			lbl.textContent = `${label}:`;
			lbl.style.cssText = `font-weight:600;color:${col.desc};min-width:140px;`;
			const val = DOM.append(fieldRow, DOM.$('span'));
			val.textContent = String(value);
			val.style.cssText = `color:${col.fg};`;
		}
		if (!anyMeta) {
			const none = DOM.append(grid, DOM.$('div'));
			none.textContent = 'No encounter details recorded.';
			none.style.cssText = `font-size:13px;color:${col.desc};`;
		}

		// Chief Complaint section.
		if (chiefComplaints.length > 0) {
			const ccCard = DOM.append(body, DOM.$('div'));
			ccCard.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.bg};padding:16px;box-shadow:0 1px 2px rgba(0,0,0,0.05);`;
			const ccTitle = DOM.append(ccCard, DOM.$('div'));
			ccTitle.textContent = 'Chief Complaint';
			ccTitle.style.cssText = `font-weight:600;color:${col.fg};margin-bottom:8px;font-size:14px;`;
			for (const cc of chiefComplaints) {
				const item = DOM.append(ccCard, DOM.$('div'));
				item.style.cssText = 'font-size:13px;margin-bottom:6px;';
				const t = DOM.append(item, DOM.$('div'));
				t.textContent = cc.title || cc.complaint || 'Chief Complaint';
				t.style.cssText = `font-weight:500;color:${col.fg};`;
				if (cc.notes) {
					const n = DOM.append(item, DOM.$('div'));
					n.textContent = cc.notes;
					n.style.cssText = `color:${col.desc};white-space:pre-wrap;`;
				}
			}
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
