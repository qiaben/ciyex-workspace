/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../../ciyexAuth/browser/ciyexAuthService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { BaseCiyexInput, AppointmentsEditorInput, StaffTvBoardEditorInput, WaitingRoomEditorInput } from './ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown, createTimeDropdown } from '../customDropdown.js';
import { parseSavedRecord } from '../sidebarActions.js';
import { enablePickerClick, maskUsDate, usToIsoDate } from '../ciyexDateMask.js';


interface Appointment {
	id: string;
	patientName: string;
	patientFirstName?: string;
	patientLastName?: string;
	appointmentType: string | { text?: string; coding?: Array<{ display?: string; code?: string }> };
	type?: string;
	status: string;
	startTime: string;
	start?: string;
	duration?: number;
	providerId?: string;
	providerName?: string;
	practitionerName?: string;
	locationId?: string;
	locationName?: string;
}

function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The backend sometimes serialises the visit-type CodeableConcept with Java's
 *  Map.toString() (e.g. "{text=Consultation, coding=[{code=Consultation,
 *  display=Consultation}]}") rather than as a JSON object. Pull the human label
 *  out of that blob, preferring `text`, then `display`, then `code`. A plain
 *  label string (e.g. "Consultation") is returned unchanged; an unparseable
 *  blob yields '' so we never render raw JSON to the user. */
function parseCodeableConceptLabel(raw: string): string {
	const s = raw.trim();
	const looksLikeBlob = s.startsWith('{') || /\b(?:text|display|code|coding)=/.test(s);
	if (!looksLikeBlob) { return s; }
	const pick = (key: string): string | undefined => {
		const m = s.match(new RegExp(`\\b${key}=([^,}\\]]+)`));
		return m ? m[1].trim() : undefined;
	};
	return pick('text') || pick('display') || pick('code') || '';
}

function getAppointmentType(apt: Appointment): string {
	const t = apt.appointmentType;
	if (typeof t === 'string') { return parseCodeableConceptLabel(t) || apt.type || ''; }
	if (t && typeof t === 'object') { return t.text || t.coding?.[0]?.display || t.coding?.[0]?.code || ''; }
	return apt.type || '';
}

/** Best-effort patient id for an existing appointment, across the assorted
 *  shapes the backend returns (flat `patientId`, a FHIR `Patient/<id>`
 *  reference on `patient`/`subject`, or a `participant[].actor.reference`).
 *  Used to detect duplicate same-day bookings for a patient. */
function resolveApptPatientId(apt: Appointment): string {
	const a = apt as unknown as Record<string, unknown>;
	if (a.patientId !== undefined && a.patientId !== null && a.patientId !== '') { return String(a.patientId); }
	const refId = (val: unknown): string => {
		const m = typeof val === 'string' ? val.match(/Patient\/(\S+)/) : null;
		return m ? m[1] : '';
	};
	for (const candidate of [a.patient, (a.patient as { reference?: string })?.reference, (a.subject as { reference?: string })?.reference]) {
		const id = refId(candidate);
		if (id) { return id; }
	}
	const participants = a.participant as Array<{ actor?: { reference?: string } }> | undefined;
	if (Array.isArray(participants)) {
		for (const p of participants) {
			const id = refId(p.actor?.reference);
			if (id) { return id; }
		}
	}
	return '';
}

/** True when the string looks like an identifier (UUID, numeric ID, or
 *  `Practitioner/<id>` reference) rather than a human-readable name —
 *  used so we can swap a bare ID for a real display name from the cache. */
function looksLikeProviderId(s: string | undefined | null): boolean {
	if (!s) { return true; }
	const t = String(s).trim();
	if (!t) { return true; }
	return /^[0-9a-f-]{8,}$/i.test(t) || /^\d+$/.test(t) || /^Practitioner\//i.test(t);
}

const TYPE_COLORS: Record<string, string> = {
	'new-patient': '#4CAF50', 'new patient': '#4CAF50',
	'follow-up': '#2196F3', 'follow up': '#2196F3',
	'sick-visit': '#FF9800', 'sick visit': '#FF9800',
	'annual-physical': '#9C27B0', 'annual physical': '#9C27B0',
	'well-child': '#00BCD4', 'well child': '#00BCD4',
	'telehealth': '#3F51B5',
	'urgent': '#F44336',
	'procedure': '#795548',
	'lab-only': '#607D8B', 'lab only': '#607D8B',
	'injection': '#E91E63',
};

const STATUS_COLORS: Record<string, string> = {
	'scheduled': '#3b82f6', 'confirmed': '#6366f1', 'arrived': '#f59e0b',
	'checked-in': '#8b5cf6', 'in-room': '#06b6d4', 'with-provider': '#22c55e',
	'fulfilled': '#6b7280', 'completed': '#6b7280',
	'cancelled': '#ef4444', 'noshow': '#dc2626', 'no-show': '#dc2626',
};

// AM vs PM shading for the day/provider timelines. Morning (AM) rows get a
// subtle neutral-grey wash while afternoon/evening (PM) rows keep the plain
// editor background, so the two halves of the day read apart at a glance. The
// tint is a theme-agnostic grey (rgba over 128,128,128) so it darkens slightly
// on light themes and lightens slightly on dark themes without hardcoding a
// theme colour — matching the existing rgba greys used for blocked/hover cells.
const AM_SLOT_BG = 'rgba(128,128,128,0.11)';
const AM_SLOT_HOVER = 'rgba(128,128,128,0.17)';
const PM_SLOT_HOVER = 'rgba(128,128,128,0.05)';

/** Friendly status label shown on timeline blocks (matches the chips users expect:
 *  Scheduled, Check In, Confirmed, Completed, No Show, Cancelled). */
function statusLabel(status: string | undefined | null): string {
	switch ((status || '').toLowerCase()) {
		case 'scheduled': case 'booked': case 'pending': case 'proposed': return 'Scheduled';
		case 'confirmed': return 'Confirmed';
		case 'arrived': case 'checked-in': case 'checkedin': return 'Check In';
		case 'in-room': return 'In Room';
		case 'with-provider': return 'With Provider';
		case 'fulfilled': case 'completed': return 'Completed';
		case 'noshow': case 'no-show': return 'No Show';
		case 'cancelled': case 'canceled': return 'Cancelled';
		default: return status || '';
	}
}

export class CalendarEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexCalendar';

	private root!: HTMLElement;
	private gridContainer!: HTMLElement;
	private headerBar!: HTMLElement;
	private currentDate = new Date();
	private viewMode: 'day' | 'week' | 'month' = 'day';
	private appointments: Appointment[] = [];
	private providerFilter: Set<string> = new Set();
	private locationFilter: Set<string> = new Set();
	private patientNameFilter = '';
	private _filterWraps: HTMLElement[] = [];
	/** Parallel to _filterWraps; holds the panel element for each filter so we
	 *  can close peers without querySelector lookups. */
	private _filterPanels: HTMLElement[] = [];
	private providers: Array<{ id: string; name: string }> = [];
	private locations: Array<{ id: string; name: string }> = [];
	private scheduleBlocks: Array<{ providerId?: string; status: string; startTime: string; endTime: string; recurrence?: { frequency: string; byWeekday?: string[] }; serviceType?: string }> = [];


	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
	) {
		super(CalendarEditor.ID, group, telemetryService, themeService, _storageService);
	}

	// Keys + helper for publishing the calendar's view state so the
	// Schedule sidebar (a separate ViewPane) can mirror what the user is
	// viewing. The sidebar reads these on its own render and re-renders
	// when they change. Workspace-scoped + machine-target so the value is
	// per-window and not synced across machines.
	private static readonly STORAGE_KEY = 'ciyex.calendar.viewState';
	/** Last view-state JSON this editor itself wrote, so the storage listener
	 *  below can ignore its own writes and only react to changes published by
	 *  other parts (e.g. the Schedule sidebar's "Go to Today" menu). */
	private _lastPublishedStateRaw = '';
	private _publishCalendarState(): void {
		try {
			const state = {
				viewMode: this.viewMode,
				currentDate: this.currentDate.toISOString(),
				updatedAt: Date.now(),
			};
			const raw = JSON.stringify(state);
			this._lastPublishedStateRaw = raw;
			this._storageService.store(CalendarEditor.STORAGE_KEY, raw, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch { /* storage write is best-effort */ }
	}

	/** Apply a view-state published by another part (Schedule sidebar's
	 *  three-dot menu: Go to Today / View Week / View Month). Without this the
	 *  sidebar updated only itself and the main grid never moved — the QA
	 *  "Today function is not working" report. */
	private _applyPublishedCalendarState(): void {
		try {
			const raw = this._storageService.get(CalendarEditor.STORAGE_KEY, StorageScope.WORKSPACE);
			if (!raw || raw === this._lastPublishedStateRaw) { return; }
			this._lastPublishedStateRaw = raw;
			const state = JSON.parse(raw) as { viewMode?: string; currentDate?: string };
			if (state.viewMode === 'day' || state.viewMode === 'week' || state.viewMode === 'month') {
				this.viewMode = state.viewMode;
			}
			if (state.currentDate) {
				const d = new Date(state.currentDate);
				if (!isNaN(d.getTime())) { this.currentDate = d; }
			}
			this._headerRendered = false;
			void this._refresh();
		} catch { /* ignore malformed state */ }
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-calendar-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header bar
		this.headerBar = DOM.append(this.root, DOM.$('.calendar-header'));
		this.headerBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		// Grid container — scroll without showing native scrollbars
		this.gridContainer = DOM.append(this.root, DOM.$('.calendar-grid'));
		this.gridContainer.style.cssText = 'flex:1;overflow:auto;position:relative;scrollbar-width:none;';

		// Render full UI skeleton immediately
		this._renderHeader();
		this._renderGrid();

		// Retry loading every 2s until providers appear, but cap the attempts so a
		// practice that legitimately has no providers yet stops polling instead of
		// refetching forever (a brand-new practice never populates this list).
		const win = DOM.getActiveWindow();
		let retryAttempts = 0;
		const retryTimer = win.setInterval(() => {
			if (this.providers.length > 0 || ++retryAttempts > 5) {
				win.clearInterval(retryTimer);
				return;
			}
			this._loadAndRender();
		}, 2000);

		// Bridge the titlebar's global "Search by name or DOB" input to the
		// calendar's in-grid patient/provider filter. The titlebar lives in
		// a separate workbench part and renders its own results dropdown;
		// it can't reach into individual editors directly, so each editor
		// that wants live-filter behavior has to subscribe to the shared
		// input. Without this hook the titlebar search field appeared to
		// do nothing on the Calendar page even though it worked elsewhere.
		this._attachTitlebarSearchBridge();

		// Also reload on auth state changes. Clear the cached provider/location
		// roster on (re)authentication so a login as a different organisation's
		// user never shows the previous org's stale providers — the root cause of
		// a phantom third provider ("steven mendosa") lingering in the day view.
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.Authenticated) {
				this.providers = [];
				this.locations = [];
				this._headerRendered = false;
				this._loadAndRender();
			}
		}));
		// React to view-state published by other parts (e.g. the Schedule
		// sidebar's "Go to Today / View Week / View Month" menu) so those
		// actions move the main calendar grid, not just the sidebar.
		this._register(this._storageService.onDidChangeValue(StorageScope.WORKSPACE, CalendarEditor.STORAGE_KEY, this._store)(() => this._applyPublishedCalendarState()));
		// Note: setInput() also calls _loadAndRender() on editor open
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		const defaultView = this.configService.getValue<string>('ciyex.calendar.defaultView') || 'day';
		this.viewMode = defaultView === 'week' ? 'week' : defaultView === 'month' ? 'month' : 'day';
		this._publishCalendarState();
		await this._loadAndRender();
	}

	/** True when the titlebar search bridge has been wired so we don't double-bind. */
	private _titlebarBridgeAttached = false;

	/** Subscribe to the titlebar's global patient search input so typing in
	 *  "Search by name or DOB" filters the calendar grid live. Retries until
	 *  the input is in the DOM (the titlebar part may mount after this editor
	 *  on the very first render). */
	private _attachTitlebarSearchBridge(): void {
		if (this._titlebarBridgeAttached) { return; }
		const win = DOM.getActiveWindow();
		const tryAttach = (): boolean => {
			// The titlebar is rendered by a separate workbench part outside
			// this editor's DOM, so we have to reach into the document to
			// find its search input. Suppress no-restricted-syntax here —
			// using `dom.ts h()` is not viable for elements owned by other
			// parts.
			// eslint-disable-next-line no-restricted-syntax
			const input = win.document.querySelector('.ehr-titlebar-controls .ehr-search-input') as HTMLInputElement | null;
			if (!input) { return false; }
			this._titlebarBridgeAttached = true;
			// Seed the calendar filter with whatever the user has already typed.
			if (input.value) {
				this.patientNameFilter = input.value.trim();
			}
			this._register(DOM.addDisposableListener(input, 'input', () => {
				this.patientNameFilter = input.value.trim();
				this._updateHeaderCount();
				this._renderGrid();
			}));
			// Reset the filter when the titlebar clears its dropdown via Escape.
			this._register(DOM.addDisposableListener(input, 'keydown', (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					this.patientNameFilter = '';
					this._updateHeaderCount();
					this._renderGrid();
				}
			}));
			return true;
		};
		if (tryAttach()) { return; }
		// Titlebar mounts asynchronously on first window load — retry briefly.
		const retry = win.setInterval(() => {
			if (tryAttach()) { win.clearInterval(retry); }
		}, 500);
		// Cap the wait so we don't keep polling forever if the titlebar is
		// disabled in some build flavor.
		win.setTimeout(() => { win.clearInterval(retry); }, 15000);
	}

	private async _loadAndRender(): Promise<void> {
		await this._loadAppointments();
		// Only rebuild header if providers/locations changed (for dropdowns)
		// Otherwise just update the count and re-render the grid
		if (this._headerRendered) {
			this._updateHeaderCount();
			this._renderGrid();
		} else {
			this._renderHeader();
			this._renderGrid();
			this._headerRendered = true;
		}
	}
	private _headerRendered = false;
	private _countEl: HTMLElement | null = null;

	private async _loadAppointments(): Promise<void> {
		try {
			// Load all appointments — provider/location filters apply client-side so the user
			// can toggle multiple selections without re-fetching.
			const loadAppts = async () => {
				const { startDate, endDate } = this._getDateRange();
				const normalize = (raw: Record<string, unknown>[]) => raw.map((a: Record<string, unknown>) => ({
					...a,
					patientName: a.patientName || a.patientDisplay || '',
					providerName: a.providerName || a.providerDisplay || '',
					practitionerName: a.practitionerName || a.providerDisplay || '',
					providerId: a.providerId || (typeof a.provider === 'string' ? (a.provider as string).replace('Practitioner/', '') : ''),
					locationId: a.locationId || (typeof a.location === 'string' ? (a.location as string).replace('Location/', '') : ''),
					locationName: a.locationName || a.locationDisplay || '',
					status: a.status || 'Scheduled',
				})) as Appointment[];

				// Try FHIR endpoint first, fall back to REST endpoint
				const urls = [
					`/api/fhir-resource/appointments?page=0&size=500&dateFrom=${startDate}&dateTo=${endDate}`,
					`/api/fhir-resource/appointments?page=0&size=500`,
					`/api/appointments?page=0&size=500&dateFrom=${startDate}&dateTo=${endDate}`,
					`/api/appointments?page=0&size=500`,
				];
				for (const url of urls) {
					try {
						const res = await this.apiService.fetch(url);
						if (!res.ok) { continue; }
						const data = await res.json();
						const raw: Record<string, unknown>[] = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
						if (raw.length > 0) {
							this.appointments = normalize(raw);
							break;
						}
					} catch { /* try next */ }
				}
				if (!this.appointments) { this.appointments = []; }
			};

			const loadProviders = async () => {
				if (this.providers.length > 0) { return; }
				// Authoritative provider roster — scoped to the CURRENT practice.
				// Lead with /api/providers/organization (org-scoped, the same primary
				// endpoint the Schedule sidebar and Patient Snapshot use) so a freshly
				// created practice only ever shows providers that actually belong to it,
				// never the previous sign-in's roster. The FHIR list is merged by ID for
				// enrichment. We must NOT derive the list from appointments — an
				// appointment can reference a provider who belongs to a different (or
				// previous) practice, which made a phantom provider such as
				// "steven mendosa" appear even though Settings → Providers lists none of
				// them. For a brand-new practice with no providers the list stays empty.
				const isActive = (p: Record<string, string>): boolean => {
					// `systemAccess.status` is the provider's LOGIN-ACCOUNT state, not
					// whether they are a schedulable practitioner — a value of "false"
					// (paired with `hasAccount: false`) just means the provider has no
					// portal login, which is normal for staff who only get scheduled.
					// So only hide providers EXPLICITLY marked inactive/disabled; a
					// missing / "false" / "0" status must NOT drop them, or every
					// login-less provider vanishes from the calendar and their
					// appointments collapse into a single "Unassigned" column.
					const raw = (p['systemAccess.status'] as string | undefined) ?? (p as { systemAccess?: { status?: string } }).systemAccess?.status;
					if (raw === null || raw === undefined || raw === '') { return true; }
					return !['INACTIVE', 'DISABLED', 'SUSPENDED', 'BLOCKED'].includes(String(raw).toUpperCase());
				};
				const toProvider = (p: Record<string, string>): { id: string; name: string } => {
					const first = (p as { identification?: { firstName?: string } }).identification?.firstName || p['identification.firstName'] || p.firstName || '';
					const last = (p as { identification?: { lastName?: string } }).identification?.lastName || p['identification.lastName'] || p.lastName || '';
					const full = `${p['identification.prefix'] || ''} ${first} ${last}`.trim();
					return {
						id: String(p.id || p.fhirId || p.username || ''),
						name: full || p.name || p.fullName || p.displayName || p.username || String(p.id || ''),
					};
				};
				const seen = new Map<string, { id: string; name: string }>();
				const providerUrls = ['/api/providers/organization?page=0&size=200', '/api/providers', '/api/fhir-resource/providers?size=200'];
				for (const url of providerUrls) {
					try {
						const res = await this.apiService.fetch(url);
						if (!res.ok) { continue; }
						const data = await res.json();
						const list = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
						for (const raw of list as Record<string, string>[]) {
							if (!isActive(raw)) { continue; }
							const prov = toProvider(raw);
							if (prov.id && prov.name && prov.name.trim().length > 0 && !seen.has(prov.id)) {
								seen.set(prov.id, prov);
							}
						}
					} catch { /* try next endpoint */ }
				}
				// Only the authoritative roster populates the list. If the practice has
				// no providers yet, leave it empty rather than back-filling from
				// appointments (which could belong to a different/previous practice).
				this.providers = Array.from(seen.values());
			};

			const loadLocations = async () => {
				if (this.locations.length > 0) { return; }
				const locationUrls = ['/api/fhir-resource/facilities?page=0&size=50', '/api/locations?page=0&size=50', '/api/fhir-resource/locations?page=0&size=50'];
				for (const url of locationUrls) {
					try {
						const res = await this.apiService.fetch(url);
						if (res.ok) {
							const data = await res.json();
							const list = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
							if (list.length > 0) {
								this.locations = list.map((l: Record<string, string>) => ({ id: l.id || '', name: l.name || l.id || '' })).filter((l: { id: string; name: string }) => l.name);
								break;
							}
						}
					} catch { /* try next */ }
				}
			};

			await Promise.all([loadAppts(), loadProviders(), loadLocations()]);

			// NOTE: intentionally no appointment-derived provider fallback here.
			// Providers must come only from the practice-scoped roster so a newly
			// created practice never inherits the previous sign-in's providers via
			// stale appointment references.

			// Load provider schedule blocks (availability) — only when filtered
			if (this.providerFilter.size === 1) {
				const onlyId = this.providerFilter.values().next().value;
				try {
					const res = await this.apiService.fetch(`/api/providers/${onlyId}/availability`);
					if (res.ok) {
						const data = await res.json();
						this.scheduleBlocks = data?.data || (Array.isArray(data) ? data : []);
					}
				} catch { this.scheduleBlocks = []; }
			} else {
				this.scheduleBlocks = [];
			}
		} catch {
			// ignore
		}
	}

	/** Resolve a friendly provider display name from the cached providers list
	 *  for the appointment, falling back to whatever readable string we have.
	 *  Returns an empty string if nothing recognisable is available so the
	 *  caller can decide whether to render anything at all. */
	private _resolveProviderName(apt: Appointment): string {
		const cached = apt.providerId
			? this.providers.find(p => String(p.id) === String(apt.providerId))
			: undefined;
		if (cached?.name && !looksLikeProviderId(cached.name)) { return cached.name; }
		if (apt.providerName && !looksLikeProviderId(apt.providerName)) { return apt.providerName; }
		if (apt.practitionerName && !looksLikeProviderId(apt.practitionerName)) { return apt.practitionerName; }
		// Last-resort: if the cache has any entry whose name happens to match the
		// raw providerName string (legacy backends use name as the key), surface it.
		if (apt.providerName) {
			const byName = this.providers.find(p => p.name === apt.providerName);
			if (byName?.name && !looksLikeProviderId(byName.name)) { return byName.name; }
		}
		return '';
	}

	/** Parse appointment start date/time robustly — handles ISO, epoch, date-only, time-only */
	private _parseAptDate(apt: Appointment): Date | null {
		const raw = apt.start || apt.startTime;
		if (!raw) { return null; }
		// If it's a number or numeric string, treat as epoch ms
		if (typeof raw === 'number' || /^\d{10,13}$/.test(String(raw))) {
			const ms = typeof raw === 'number' ? raw : (String(raw).length <= 10 ? Number(raw) * 1000 : Number(raw));
			const d = new Date(ms);
			return isNaN(d.getTime()) ? null : d;
		}
		// Standard Date parse
		const d = new Date(String(raw));
		if (!isNaN(d.getTime())) { return d; }
		// Try date-only "YYYY-MM-DD"
		if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
			const d2 = new Date(String(raw) + 'T00:00:00');
			return isNaN(d2.getTime()) ? null : d2;
		}
		return null;
	}

	/** Return appointments filtered by the current provider/location dropdown selections */
	private _getViewFilteredAppointments(): Appointment[] {
		let filtered = this.appointments;
		if (this.providerFilter.size > 0) {
			const sel = this.providerFilter;
			filtered = filtered.filter(a =>
				(a.providerId && sel.has(a.providerId)) ||
				(a.providerName && sel.has(a.providerName)) ||
				(a.practitionerName && sel.has(a.practitionerName))
			);
		}
		if (this.locationFilter.size > 0) {
			const sel = this.locationFilter;
			filtered = filtered.filter(a =>
				(a.locationId && sel.has(a.locationId)) ||
				(a.locationName && sel.has(a.locationName))
			);
		}
		if (this.patientNameFilter) {
			const q = this.patientNameFilter.toLowerCase();
			filtered = filtered.filter(a => {
				const haystack = [
					a.patientFirstName, a.patientLastName, a.patientName,
					a.providerName, a.practitionerName, this._resolveProviderName(a),
					a.locationName, a.status, getAppointmentType(a),
				].map(v => String(v ?? '')).join(' ').toLowerCase();
				return haystack.includes(q);
			});
		}
		return filtered;
	}

	private _getDateRange(): { startDate: string; endDate: string } {
		const d = new Date(this.currentDate);
		if (this.viewMode === 'day') {
			const s = localDateStr(d);
			return { startDate: s, endDate: s };
		}
		if (this.viewMode === 'month') {
			const first = new Date(d.getFullYear(), d.getMonth(), 1);
			const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
			return { startDate: localDateStr(first), endDate: localDateStr(last) };
		}
		// Week: find Monday
		const day = d.getDay();
		const monday = new Date(d);
		monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
		const sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);
		return { startDate: localDateStr(monday), endDate: localDateStr(sunday) };
	}


	private _openTvDisplay(mode: 'staff' | 'waiting'): void {
		try {
			// Open the native TV editor (Staff Board / Waiting Room) directly
			// inside the workspace. The editor pulls live data from the same
			// backend the calendar uses — no web embedding, no external redirect.
			const input = mode === 'staff' ? new StaffTvBoardEditorInput() : new WaitingRoomEditorInput();
			void this.group.openEditor(input, { pinned: true });
		} catch (err) {
			this.notificationService.notify({ severity: Severity.Error, message: `TV Display failed: ${String(err)}` });
		}
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		this._filterWraps = [];
		this._filterPanels = [];

		// Date picker — calendar popup replaces the old prev/date/next arrow nav
		this._buildDatePicker(this.headerBar);

		// Patient / provider search with a live dropdown of matches
		this._buildPatientProviderSearch(this.headerBar);

		// When the calendar has been narrowed to specific provider(s) — e.g. via the
		// search dropdown's "Filter by provider" — surface a one-click chip to clear
		// the filter and return to the all-providers view. Without it the user is
		// stranded on a single provider's column with no obvious way back home
		// (QA: no "back to all providers" option after picking a provider).
		if (this.providerFilter.size > 0) {
			const ids = Array.from(this.providerFilter);
			const labelText = ids.length === 1
				? (this.providers.find(p => p.id === ids[0] || p.name === ids[0])?.name || 'Provider')
				: `${ids.length} providers`;
			const backChip = DOM.append(this.headerBar, DOM.$('button')) as HTMLButtonElement;
			backChip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--vscode-input-border);border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-foreground);flex-shrink:0;';
			backChip.textContent = `← All Providers (${labelText})`;
			backChip.title = 'Show all providers';
			backChip.addEventListener('mouseenter', () => { backChip.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
			backChip.addEventListener('mouseleave', () => { backChip.style.background = 'var(--vscode-button-secondaryBackground,transparent)'; });
			backChip.addEventListener('click', () => {
				this.providerFilter.clear();
				this._headerRendered = false;
				this._renderHeader();
				this._updateHeaderCount();
				this._renderGrid();
			});
		}

		// Plain spacer between search and view toggles.
		const spacer = DOM.append(this.headerBar, DOM.$('span'));
		spacer.style.cssText = 'flex:1;';

		// View toggles — selected segment uses the primary button color; the
		// unselected segments are transparent with foreground text so they read
		// correctly in both light and dark themes (the old secondary-button fill
		// looked washed-out / dark in light mode). Hover uses the toolbar hover
		// background on unselected segments only.
		const viewGroup = DOM.append(this.headerBar, DOM.$('.view-group'));
		viewGroup.style.cssText = 'display:flex;border:1px solid var(--vscode-input-border);border-radius:4px;overflow:hidden;flex-shrink:0;';
		for (const mode of ['day', 'week', 'month'] as const) {
			const btn = DOM.append(viewGroup, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
			const isSelected = this.viewMode === mode;
			btn.style.cssText = `padding:3px 12px;border:none;cursor:pointer;font-size:11px;white-space:nowrap;${isSelected ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);' : 'background:transparent;color:var(--vscode-foreground);'}`;
			if (!isSelected) {
				btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
				btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
			}
			btn.addEventListener('click', () => { this.viewMode = mode; this._publishCalendarState(); this._headerRendered = false; this._renderHeader(); this._renderGrid(); });
		}

		// Provider filter — multi-select checkbox dropdown
		this._buildCheckboxFilter(this.headerBar, 'All Providers', this.providers, this.providerFilter, () => {
			this._updateHeaderCount(); this._renderGrid();
		}, true, 'organization');

		// Location filter — multi-select checkbox dropdown
		this._buildCheckboxFilter(this.headerBar, 'All Locations', this.locations, this.locationFilter, () => {
			this._updateHeaderCount(); this._renderGrid();
		}, true, 'location');

		// Right-side action icons group
		const actionsGroup = DOM.append(this.headerBar, DOM.$('.actions-group'));
		actionsGroup.style.cssText = 'display:flex;gap:4px;margin-left:auto;align-items:center;';

		const iconBtn = (parent: HTMLElement, symbol: string, title: string, primary: boolean, onClick: () => void) => {
			const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = symbol;
			btn.title = title;
			btn.style.cssText = `padding:4px 10px;border:1px solid var(--vscode-input-border);border-radius:4px;cursor:pointer;font-size:15px;display:inline-flex;align-items:center;${primary ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:700;' : 'background:transparent;color:var(--vscode-foreground);'}`;
			btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
			btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
			btn.addEventListener('click', onClick);
			return btn;
		};

		// + New Appointment
		iconBtn(actionsGroup, '+', 'New Appointment', true, async () => {
			const today = localDateStr(this.currentDate);
			await this._createAppointment(today, '09:00');
		});

		// Refresh / TV / List icon buttons — subtle, theme-driven styling. The old
		// `titleBar-activeBackground/Foreground` pair renders as a dark fill in many
		// light themes (the title bar is often dark regardless of theme), so the
		// buttons looked wrong in light mode. A transparent background with
		// foreground-colored glyphs and an input border follows the active theme,
		// and the hover uses the standard toolbar hover background.
		const calBtnStyle = 'padding:4px 8px;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;';
		const wireIconBtnHover = (btn: HTMLButtonElement) => {
			btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
			btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
		};

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

		const refreshBtn = DOM.append(actionsGroup, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.style.cssText = calBtnStyle;
		wireIconBtnHover(refreshBtn);
		const refreshSvg = mkSvg();
		svgPath(refreshSvg, 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8');
		svgPath(refreshSvg, 'M21 3v5h-5');
		svgPath(refreshSvg, 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16');
		svgPath(refreshSvg, 'M8 16H3v5');
		refreshBtn.appendChild(refreshSvg);
		refreshBtn.title = 'Refresh calendar now';
		refreshBtn.addEventListener('click', async () => {
			refreshBtn.disabled = true;
			refreshBtn.style.opacity = '0.5';
			try { this.providers = []; this.locations = []; this._headerRendered = false; await this._loadAndRender(); }
			finally { refreshBtn.disabled = false; refreshBtn.style.opacity = '1'; }
		});


		// TV Display
		const tvWrap = DOM.append(actionsGroup, DOM.$('div'));
		tvWrap.style.cssText = 'position:relative;';
		const tvBtn = DOM.append(tvWrap, DOM.$('button')) as HTMLButtonElement;
		tvBtn.style.cssText = calBtnStyle;
		wireIconBtnHover(tvBtn);
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
		const mkTvItem = (icon: string, label: string, onClick: () => void) => {
			const it = DOM.append(tvMenu, DOM.$('button')) as HTMLButtonElement;
			it.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;background:transparent;border:none;color:var(--vscode-foreground);font-size:12px;text-align:left;cursor:pointer;';
			it.addEventListener('mouseenter', () => { it.style.background = 'var(--vscode-list-hoverBackground)'; });
			it.addEventListener('mouseleave', () => { it.style.background = 'transparent'; });
			DOM.append(it, DOM.$('span')).textContent = icon;
			DOM.append(it, DOM.$('span')).textContent = label;
			it.addEventListener('click', onClick);
		};
		// allow-any-unicode-next-line
		mkTvItem('\uD83D\uDDA5', 'Staff TV Board', () => { tvMenu.style.display = 'none'; this._openTvDisplay('staff'); });
		// allow-any-unicode-next-line
		mkTvItem('\uD83D\uDCFA', 'Waiting Room', () => { tvMenu.style.display = 'none'; this._openTvDisplay('waiting'); });
		// Treat the TV menu as one of the toolbar dropdowns so opening any other
		// filter (All Providers / All Locations) auto-closes it, and vice versa —
		// only one dropdown is ever open at a time instead of overlapping.
		this._filterPanels.push(tvMenu);
		this._filterWraps.push(tvWrap);
		tvBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const isOpen = tvMenu.style.display !== 'none';
			for (const otherPanel of this._filterPanels) {
				if (otherPanel !== tvMenu) { otherPanel.style.display = 'none'; }
			}
			tvMenu.style.display = isOpen ? 'none' : 'block';
		});
		this._register(DOM.addDisposableListener(DOM.getActiveWindow().document, 'click', () => { tvMenu.style.display = 'none'; }));

		const listBtn = DOM.append(actionsGroup, DOM.$('button')) as HTMLButtonElement;
		listBtn.style.cssText = calBtnStyle;
		listBtn.title = 'Appointment List';
		const listIco = DOM.append(listBtn, DOM.$('span.codicon.codicon-list-unordered')) as HTMLElement;
		listIco.style.cssText = 'font-size:15px;color:inherit;';
		wireIconBtnHover(listBtn);
		listBtn.addEventListener('click', () => this.group.openEditor(new AppointmentsEditorInput(), { pinned: true }));

		// Appointment count (filtered by current view date range + provider/location)
		const { startDate, endDate } = this._getDateRange();
		const viewAppts = this._getViewFilteredAppointments().filter(a => {
			const d = this._parseAptDate(a);
			if (!d) { return false; }
			const ds = localDateStr(d);
			return ds >= startDate && ds <= endDate;
		});
		this._countEl = DOM.append(this.headerBar, DOM.$('span'));
		this._countEl.textContent = `${viewAppts.length} appts`;
		this._countEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
	}

	private _updateHeaderCount(): void {
		if (!this._countEl) { return; }
		const { startDate, endDate } = this._getDateRange();
		const viewAppts = this._getViewFilteredAppointments().filter(a => {
			const d = this._parseAptDate(a);
			if (!d) { return false; }
			const ds = localDateStr(d);
			return ds >= startDate && ds <= endDate;
		});
		this._countEl.textContent = `${viewAppts.length} appts`;
	}

	private _renderGrid(): void {
		DOM.clearNode(this.gridContainer);

		if (this.viewMode === 'month') {
			this._renderMonthGrid();
			return;
		}

		// Day view = all providers side-by-side
		if (this.viewMode === 'day') {
			this._renderProviderGrid();
			return;
		}

		// Time grid: full 24h in 30-minute slots (12:00 AM through 11:30 PM)
		const startHour = 0;
		const endHour = 24;
		const slotDuration = 30;
		const slotHeight = 32; // px per slot — taller rows so the patient, visit type and status all read clearly
		// hourHeight = (60 / slotDuration) * slotHeight — used for time indicator positioning

		// Week view always shows 7 days (Day view handled by _renderProviderGrid)
		const days = this._getWeekDays();

		// Pre-index appointments by date+hour+slot for O(1) lookup
		const viewAppointments = this._getViewFilteredAppointments();
		const weekIndex = new Map<string, Appointment[]>();
		for (const a of viewAppointments) {
			const d = this._parseAptDate(a);
			if (!d) { continue; }
			const ds = localDateStr(d);
			const h = d.getHours();
			const m = Math.floor(d.getMinutes() / slotDuration) * slotDuration;
			const key = `${ds}|${h}|${m}`;
			const arr = weekIndex.get(key);
			if (arr) { arr.push(a); } else { weekIndex.set(key, [a]); }
		}

		// Grid table
		const table = DOM.append(this.gridContainer, DOM.$('.cal-table'));
		table.style.cssText = 'display:grid;grid-template-columns:64px ' + days.map(() => '1fr').join(' ') + ';min-width:100%;';

		// Header row
		const corner = DOM.append(table, DOM.$('.cal-corner'));
		corner.style.cssText = 'border-bottom:1px solid var(--vscode-editorWidget-border);border-right:1px solid var(--vscode-editorWidget-border);padding:6px 4px;text-align:center;font-size:10px;color:var(--vscode-descriptionForeground);position:sticky;top:0;background:var(--vscode-editor-background);z-index:2;';

		for (const day of days) {
			const isToday = day.toDateString() === new Date().toDateString();
			const hdr = DOM.append(table, DOM.$('.cal-day-header'));
			hdr.style.cssText = `border-bottom:1px solid var(--vscode-editorWidget-border);border-right:1px solid var(--vscode-editorWidget-border);padding:6px 8px;text-align:center;position:sticky;top:0;background:var(--vscode-editor-background);z-index:2;${isToday ? 'font-weight:700;' : ''}`;
			const dayName = DOM.append(hdr, DOM.$('div'));
			dayName.textContent = day.toLocaleDateString('en-US', { weekday: 'short' });
			dayName.style.cssText = 'font-size:10px;text-transform:uppercase;color:var(--vscode-descriptionForeground);';
			const dayNum = DOM.append(hdr, DOM.$('div'));
			dayNum.textContent = String(day.getDate());
			dayNum.style.cssText = `font-size:16px;font-weight:600;${isToday ? 'color:var(--vscode-textLink-foreground);' : ''}`;
		}

		// Time rows
		for (let hour = startHour; hour < endHour; hour++) {
			for (let slot = 0; slot < 60 / slotDuration; slot++) {
				const minute = slot * slotDuration;
				const isHourStart = minute === 0;

				// Time label — show on every 30-min slot (e.g. 9:00, 9:30, 10:00)
				const timeCell = DOM.append(table, DOM.$('.cal-time'));
				timeCell.style.cssText = `height:${slotHeight}px;border-right:1px solid var(--vscode-editorWidget-border);padding:0 4px;font-size:10px;color:var(--vscode-descriptionForeground);text-align:right;line-height:${slotHeight}px;white-space:nowrap;overflow:hidden;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : ''}${!isHourStart ? 'opacity:0.7;' : ''}${hour < 12 ? `background:${AM_SLOT_BG};` : ''}`;
				{
					const h12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
					const ampm = hour >= 12 ? 'PM' : 'AM';
					// Always include AM/PM on every 30-min label (matches the EHR-UI calendar
					// where "12:30 AM" / "1:00 AM" both render with the meridiem suffix).
					timeCell.textContent = `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
				}

				// Day cells
				for (let di = 0; di < days.length; di++) {
					// Check if this slot is outside provider availability (blocked)
					const dayOfWeek = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][days[di].getDay()];
					const slotTime = hour * 60 + minute;
					const isBlocked = this.scheduleBlocks.length > 0 && !this.scheduleBlocks.some(b => {
						if (b.status !== 'active') { return false; }
						if (b.recurrence?.byWeekday && !b.recurrence.byWeekday.includes(dayOfWeek)) { return false; }
						try {
							const start = parseInt(b.startTime?.split(':')[0] || '0') * 60 + parseInt(b.startTime?.split(':')[1] || '0');
							const end = parseInt(b.endTime?.split(':')[0] || '0') * 60 + parseInt(b.endTime?.split(':')[1] || '0');
							return slotTime >= start && slotTime < end;
						} catch { return false; }
					});

					const cell = DOM.append(table, DOM.$('.cal-cell'));
					// AM rows carry a subtle grey wash; blocked (out-of-availability)
					// slots keep their own grey. Blocked wins when both apply.
					const isAM = hour < 12;
					const baseBg = isBlocked ? 'rgba(128,128,128,0.06)' : (isAM ? AM_SLOT_BG : '');
					// `cursor:pointer` so the hand shows on every empty slot — the whole
					// cell is click-to-create (see listener below), but without this it
					// rendered the default arrow and read as non-interactive.
					cell.style.cssText = `height:${slotHeight}px;border-right:1px solid rgba(128,128,128,0.1);position:relative;cursor:pointer;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : 'border-top:1px solid rgba(128,128,128,0.05);'}${baseBg ? `background:${baseBg};` : ''}`;
					if (!isBlocked) {
						// Restore the AM/PM base on leave rather than clearing it, so the
						// morning wash survives hover.
						cell.addEventListener('mouseenter', () => { cell.style.background = isAM ? AM_SLOT_HOVER : PM_SLOT_HOVER; });
						cell.addEventListener('mouseleave', () => { cell.style.background = baseBg; });
					}

					// Click to create appointment
					const dayStr = localDateStr(days[di]);
					const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
					cell.addEventListener('click', () => this._createAppointment(dayStr, timeStr));

					// O(1) lookup from pre-built index
					const slotAppts = weekIndex.get(`${dayStr}|${hour}|${minute}`) || [];

					for (let ai = 0; ai < slotAppts.length; ai++) {
						const apt = slotAppts[ai];
						const dur = apt.duration || 30;
						const typeColor = TYPE_COLORS[(getAppointmentType(apt) || '').toLowerCase()] || '#607D8B';
						const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#6b7280';

						// Precise sub-slot positioning: offset by the fractional minute within the 30-min slot
						const aptDate = this._parseAptDate(apt);
						const minuteInSlot = aptDate ? aptDate.getMinutes() % slotDuration : 0;
						const topOffset = Math.round((minuteInSlot / slotDuration) * slotHeight);
						const pixelH = Math.max(slotHeight - 2, Math.round((dur / slotDuration) * slotHeight) - 2);

						// Side-by-side when multiple appointments share the same slot
						const colW = slotAppts.length > 1 ? Math.floor(100 / slotAppts.length) : 100;
						const leftPct = ai * colW;
						const rightPct = 100 - (ai + 1) * colW;

						const visitType = getAppointmentType(apt) || '';
						const provDisplay = this._resolveProviderName(apt);
						const statusText = statusLabel(apt.status);

						const block = DOM.append(cell, DOM.$('.apt-block'));
						block.style.cssText = `position:absolute;left:calc(${leftPct}% + 2px);right:calc(${rightPct}% + 2px);top:${topOffset}px;height:${pixelH}px;background:${typeColor}20;border-left:3px solid ${typeColor};border-radius:3px;padding:3px 5px;overflow:hidden;cursor:pointer;z-index:1;font-size:11px;line-height:1.35;`;
						block.title = [apt.patientName, visitType, statusText, provDisplay].filter(Boolean).join(' \u00B7 ');
						block.addEventListener('mouseenter', () => { block.style.background = `${typeColor}35`; });
						block.addEventListener('mouseleave', () => { block.style.background = `${typeColor}20`; });
						block.addEventListener('click', (e) => { e.stopPropagation(); this._editAppointment(apt); });

						const nameEl = DOM.append(block, DOM.$('div'));
						nameEl.textContent = apt.patientName || `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim();
						nameEl.style.cssText = 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

						// Visit type (clearly visible) + status chip right beside it
						const detailLine = DOM.append(block, DOM.$('div'));
						detailLine.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;';
						const typeEl = DOM.append(detailLine, DOM.$('span'));
						typeEl.textContent = visitType;
						typeEl.style.cssText = `font-weight:500;color:${typeColor};overflow:hidden;text-overflow:ellipsis;`;
						if (statusText) {
							const pill = DOM.append(detailLine, DOM.$('span'));
							pill.textContent = statusText;
							pill.style.cssText = `flex:none;padding:0 5px;border-radius:8px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;background:${statusColor}30;color:${statusColor};`;
						}
					}
				}
			}
		}

		// Current time indicator
		this._renderTimeIndicator(table, days, startHour, slotDuration, slotHeight);
	}

	private _renderProviderGrid(): void {
		// Time grid: full 24h in 30-minute slots (12:00 AM through 11:30 PM)
		const startHour = 0;
		const endHour = 24;
		const slotDuration = 30;
		const slotHeight = 32; // taller rows so the patient, visit type and status all read clearly
		const dateStr = localDateStr(this.currentDate);

		let activeProviders = this.providers.length > 0 ? [...this.providers] : [];
		if (this.providerFilter.size > 0) {
			activeProviders = activeProviders.filter(p => this.providerFilter.has(p.id) || this.providerFilter.has(p.name));
		}

		// Day's appointments — computed up-front so appointments that don't map to
		// a loaded provider column can be surfaced under a synthetic "Unassigned"
		// column. Without this, an appointment created with no provider (or before
		// providers finish loading, or in a practice that has no providers at all)
		// is silently dropped and the day grid looks empty even though the header
		// still counts it.
		const viewAppointments = this._getViewFilteredAppointments().filter(a => {
			const d = this._parseAptDate(a);
			if (!d) { return false; }
			return localDateStr(d) === dateStr;
		});

		// Map an appointment to its provider column. Match on ANY of the provider
		// fields (id / name / practitioner) against the roster so an appointment is
		// never mis-bucketed just because its first populated field isn't the one the
		// roster is keyed by. Returns '' only when none match a loaded provider.
		const knownKeys = new Set<string>();
		for (const p of activeProviders) { knownKeys.add(String(p.id)); knownKeys.add(String(p.name)); }
		const provKeyOf = (a: Appointment): string => {
			for (const cand of [a.providerId, a.providerName, a.practitionerName]) {
				const k = String(cand ?? '');
				if (k && knownKeys.has(k)) { return k; }
			}
			return '';
		};
		// The timeline shows provider columns ONLY — no synthetic "Unassigned"
		// column (per product requirement). Appointments with no provider (or one
		// not on the practice roster) are not placed in the day grid; they remain
		// visible in the Week and Month views, which list every appointment
		// regardless of provider.

		if (activeProviders.length === 0) {
			const empty = DOM.append(this.gridContainer, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = this.providerFilter.size > 0
				? 'No matching provider found.'
				: (viewAppointments.length === 0 ? 'No appointments scheduled for this day.' : 'No providers loaded. Click Refresh to load provider data.');
			return;
		}

		// PRE-INDEX appointments by provider+slot for O(1) lookup (instead of O(N) filter per cell)
		const apptIndex = new Map<string, Appointment[]>();
		const provCounts = new Map<string, number>();
		for (const a of viewAppointments) {
			const provKey = provKeyOf(a);
			provCounts.set(provKey, (provCounts.get(provKey) || 0) + 1);
			const d = this._parseAptDate(a);
			if (!d) { continue; }
			const h = d.getHours();
			const m = Math.floor(d.getMinutes() / slotDuration) * slotDuration;
			const key = `${provKey}|${h}|${m}`;
			const arr = apptIndex.get(key);
			if (arr) { arr.push(a); } else { apptIndex.set(key, [a]); }
		}

		const table = DOM.append(this.gridContainer, DOM.$('.cal-table'));
		table.style.cssText = 'display:grid;grid-template-columns:64px ' + activeProviders.map(() => '1fr').join(' ') + ';min-width:100%;';

		const corner = DOM.append(table, DOM.$('.cal-corner'));
		corner.style.cssText = 'border-bottom:1px solid var(--vscode-editorWidget-border);border-right:1px solid var(--vscode-editorWidget-border);padding:6px 4px;position:sticky;top:0;background:var(--vscode-editor-background);z-index:2;';

		const PROVIDER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#e11d48', '#0891b2', '#a855f7'];

		for (let pi = 0; pi < activeProviders.length; pi++) {
			const prov = activeProviders[pi];
			const provColor = PROVIDER_COLORS[pi % PROVIDER_COLORS.length];
			const hdr = DOM.append(table, DOM.$('.cal-prov-header'));
			hdr.style.cssText = `border-bottom:2px solid ${provColor};border-right:1px solid var(--vscode-editorWidget-border);padding:6px 4px;text-align:center;position:sticky;top:0;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));z-index:2;`;
			const nameEl = DOM.append(hdr, DOM.$('div'));
			nameEl.textContent = prov.name;
			nameEl.style.cssText = 'font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

			const count = (provCounts.get(prov.id) || 0) + (prov.id !== prov.name ? (provCounts.get(prov.name) || 0) : 0);
			const countEl = DOM.append(hdr, DOM.$('div'));
			countEl.textContent = `${count} appts`;
			countEl.style.cssText = `font-size:9px;color:${provColor};`;
		}

		// Time rows
		for (let hour = startHour; hour < endHour; hour++) {
			for (let slot = 0; slot < 60 / slotDuration; slot++) {
				const minute = slot * slotDuration;
				const isHourStart = minute === 0;

				const timeCell = DOM.append(table, DOM.$('.cal-time'));
				timeCell.style.cssText = `height:${slotHeight}px;border-right:1px solid var(--vscode-editorWidget-border);padding:0 4px;font-size:10px;color:var(--vscode-descriptionForeground);text-align:right;line-height:${slotHeight}px;white-space:nowrap;overflow:hidden;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : ''}${!isHourStart ? 'opacity:0.7;' : ''}${hour < 12 ? `background:${AM_SLOT_BG};` : ''}`;
				{
					const h12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
					const ampm = hour >= 12 ? 'PM' : 'AM';
					// Always include AM/PM on every 30-min label (matches the EHR-UI calendar
					// where "12:30 AM" / "1:00 AM" both render with the meridiem suffix).
					timeCell.textContent = `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
				}

				// Provider cells
				for (let pi = 0; pi < activeProviders.length; pi++) {
					const prov = activeProviders[pi];
					const provColor = PROVIDER_COLORS[pi % PROVIDER_COLORS.length];
					const cell = DOM.append(table, DOM.$('.cal-cell'));
					// AM rows carry a subtle grey wash so morning reads apart from afternoon.
					const isAM = hour < 12;
					const baseBg = isAM ? AM_SLOT_BG : '';
					cell.style.cssText = `height:${slotHeight}px;border-right:1px solid rgba(128,128,128,0.1);position:relative;cursor:pointer;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : 'border-top:1px solid rgba(128,128,128,0.05);'}${baseBg ? `background:${baseBg};` : ''}`;
					cell.addEventListener('mouseenter', () => { cell.style.background = isAM ? AM_SLOT_HOVER : PM_SLOT_HOVER; });
					cell.addEventListener('mouseleave', () => { cell.style.background = baseBg; });

					const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
					cell.addEventListener('click', () => this._createAppointment(dateStr, timeStr, prov.id));

					// O(1) lookup from pre-built index
					const slotAppts = [
						...(apptIndex.get(`${prov.id}|${hour}|${minute}`) || []),
						...(prov.id !== prov.name ? (apptIndex.get(`${prov.name}|${hour}|${minute}`) || []) : []),
					];

					for (let ai = 0; ai < slotAppts.length; ai++) {
						const apt = slotAppts[ai];
						const dur = apt.duration || 30;
						const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#6b7280';

						// Precise sub-slot positioning
						const aptDate = this._parseAptDate(apt);
						const minuteInSlot = aptDate ? aptDate.getMinutes() % slotDuration : 0;
						const topOffset = Math.round((minuteInSlot / slotDuration) * slotHeight);
						const pixelH = Math.max(slotHeight - 2, Math.round((dur / slotDuration) * slotHeight) - 2);

						// Side-by-side when multiple appointments share the same provider slot
						const colW = slotAppts.length > 1 ? Math.floor(100 / slotAppts.length) : 100;
						const leftPct = ai * colW;
						const rightPct = 100 - (ai + 1) * colW;

						const visitType = getAppointmentType(apt) || '';
						const statusText = statusLabel(apt.status);

						const block = DOM.append(cell, DOM.$('.apt-block'));
						block.style.cssText = `position:absolute;left:calc(${leftPct}% + 2px);right:calc(${rightPct}% + 2px);top:${topOffset}px;height:${pixelH}px;background:${provColor}20;border-left:3px solid ${provColor};border-radius:3px;padding:3px 5px;overflow:hidden;cursor:pointer;z-index:1;font-size:11px;line-height:1.35;`;
						block.title = [apt.patientName, visitType, statusText].filter(Boolean).join(' · ');
						block.addEventListener('mouseenter', () => { block.style.background = `${provColor}35`; });
						block.addEventListener('mouseleave', () => { block.style.background = `${provColor}20`; });
						block.addEventListener('click', (e) => { e.stopPropagation(); this._editAppointment(apt); });

						const nameEl = DOM.append(block, DOM.$('div'));
						nameEl.textContent = apt.patientName || '';
						nameEl.style.cssText = 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

						// Visit type (clearly visible) + status chip right beside it
						const detailLine = DOM.append(block, DOM.$('div'));
						detailLine.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;';
						const typeEl = DOM.append(detailLine, DOM.$('span'));
						typeEl.textContent = visitType;
						typeEl.style.cssText = `font-weight:500;color:${provColor};overflow:hidden;text-overflow:ellipsis;`;
						if (statusText) {
							const pill = DOM.append(detailLine, DOM.$('span'));
							pill.textContent = statusText;
							pill.style.cssText = `flex:none;padding:0 5px;border-radius:8px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;background:${statusColor}30;color:${statusColor};`;
						}
					}
				}
			}
		}
	}

	private _renderMonthGrid(): void {
		const year = this.currentDate.getFullYear();
		const month = this.currentDate.getMonth();
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);
		// Sunday-based week to match the ciyex-ehr-ui (FullCalendar) month grid,
		// whose default `firstDay` is 0 (Sunday). The previous Monday-based layout
		// shifted every day one column to the left of where the weekday header
		// said it should be — the "misaligned / extra left column" the screenshot
		// flagged. getDay() already returns 0=Sun..6=Sat, so the leading-blank
		// count is exactly firstDay.getDay().
		const startDayOfWeek = firstDay.getDay();

		const grid = DOM.append(this.gridContainer, DOM.$('.month-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:1px;padding:8px;box-sizing:border-box;';

		// Weekday header row — uppercase short names (SUN MON TUE …) to match the
		// ehr-ui FullCalendar column headers.
		for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
			const hdr = DOM.append(grid, DOM.$('.month-header'));
			hdr.textContent = d;
			hdr.style.cssText = 'text-align:center;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);padding:6px 4px;text-transform:uppercase;letter-spacing:0.4px;';
		}

		// Empty leading cells so day 1 lands under the correct weekday column.
		for (let i = 0; i < startDayOfWeek; i++) {
			const cell = DOM.append(grid, DOM.$('.month-empty'));
			cell.style.cssText = 'min-height:96px;background:rgba(128,128,128,0.03);border-radius:3px;';
		}

		// Stable provider→color mapping shared with day/week views so the same
		// provider keeps the same color across all view modes.
		const PROVIDER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#e11d48', '#0891b2', '#a855f7'];
		const providerColorFor = (apt: Appointment): string => {
			const key = String(apt.providerId || apt.providerName || apt.practitionerName || '');
			if (!key) { return '#607D8B'; }
			const idx = this.providers.findIndex(p => p.id === key || p.name === key);
			if (idx >= 0) { return PROVIDER_COLORS[idx % PROVIDER_COLORS.length]; }
			let h = 0;
			for (let i = 0; i < key.length; i++) { h = ((h << 5) - h) + key.charCodeAt(i); }
			return PROVIDER_COLORS[Math.abs(h) % PROVIDER_COLORS.length];
		};

		// Day cells
		const monthAppointments = this._getViewFilteredAppointments();
		for (let day = 1; day <= lastDay.getDate(); day++) {
			const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
			const isToday = dateStr === localDateStr(new Date());
			const dayAppts = monthAppointments.filter(a => {
				const d = this._parseAptDate(a);
				if (!d) { return false; }
				try { return localDateStr(d) === dateStr; } catch { return false; }
			}).sort((a, b) => {
				const da = this._parseAptDate(a)?.getTime() ?? 0;
				const db = this._parseAptDate(b)?.getTime() ?? 0;
				return da - db;
			});

			const cell = DOM.append(grid, DOM.$('.month-cell'));
			cell.style.cssText = `min-height:96px;background:var(--vscode-editorWidget-background);border-radius:3px;padding:4px;cursor:pointer;display:flex;flex-direction:column;${isToday ? 'border:2px solid var(--vscode-focusBorder);' : 'border:1px solid rgba(128,128,128,0.1);'}`;
			cell.addEventListener('mouseenter', () => { cell.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.04))'; });
			cell.addEventListener('mouseleave', () => { cell.style.background = 'var(--vscode-editorWidget-background)'; });
			cell.addEventListener('click', () => { this.currentDate = new Date(dateStr + 'T00:00:00'); this.viewMode = 'day'; this._publishCalendarState(); this._refresh(); });

			// Top row: day number (left) + appointment-count pill (right) — mirrors
			// the ehr-ui `.fc-month-card-inner` layout (day number + green count
			// badge). The badge shows "N appts" so the count is self-describing.
			const topRow = DOM.append(cell, DOM.$('div'));
			topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:3px;';
			const numEl = DOM.append(topRow, DOM.$('span'));
			numEl.textContent = String(day);
			numEl.style.cssText = `font-size:13px;font-weight:${isToday ? '700' : '500'};line-height:1.5;${isToday ? 'color:var(--vscode-textLink-foreground);' : ''}`;
			if (dayAppts.length > 0) {
				const countBadge = DOM.append(topRow, DOM.$('span'));
				countBadge.textContent = `${dayAppts.length} appt${dayAppts.length > 1 ? 's' : ''}`;
				countBadge.title = `${dayAppts.length} appointment${dayAppts.length > 1 ? 's' : ''}`;
				countBadge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;height:18px;padding:0 7px;border-radius:9px;background:#22c55e;color:#fff;font-size:10px;font-weight:600;line-height:1;white-space:nowrap;';
			}

			// Appointment chips — each shows TIME · Provider · Patient (matches the
			// ehr-ui month-view event content), colored by provider.
			if (dayAppts.length > 0) {
				for (const apt of dayAppts.slice(0, 3)) {
					const aptEl = DOM.append(cell, DOM.$('div'));
					const provColor = providerColorFor(apt);
					aptEl.style.cssText = `font-size:10px;padding:1px 4px;border-radius:3px;margin-bottom:1px;background:${provColor}25;border-left:2px solid ${provColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;line-height:1.4;`;
					const parsedTime = this._parseAptDate(apt);
					const provName = this._resolveProviderName(apt);
					const parts: string[] = [];
					if (parsedTime) {
						parts.push(parsedTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
					}
					if (provName) { parts.push(provName); }
					if (apt.patientName) { parts.push(apt.patientName); }
					aptEl.textContent = parts.join(' · ') || (apt.patientName || '');
					aptEl.title = aptEl.textContent;
					aptEl.addEventListener('click', (e) => { e.stopPropagation(); this._editAppointment(apt); });
				}
				if (dayAppts.length > 3) {
					const more = DOM.append(cell, DOM.$('div'));
					more.textContent = `+${dayAppts.length - 3} more`;
					more.style.cssText = 'font-size:10px;font-weight:600;color:var(--vscode-textLink-foreground);padding:1px 4px;';
				}
			}
		}
	}

	private _renderTimeIndicator(table: HTMLElement, days: Date[], startHour: number, slotDuration: number, slotHeight: number): void {
		const now = new Date();
		const todayIdx = days.findIndex(d => d.toDateString() === now.toDateString());
		if (todayIdx < 0) { return; }

		const minutesSinceStart = (now.getHours() - startHour) * 60 + now.getMinutes();
		if (minutesSinceStart < 0) { return; }

		const top = (minutesSinceStart / slotDuration) * slotHeight + 30; // +30 for header
		const line = DOM.append(this.gridContainer, DOM.$('.time-indicator'));
		line.style.cssText = `position:absolute;left:50px;right:0;top:${top}px;height:2px;background:#ef4444;z-index:10;pointer-events:none;`;
		const dot = DOM.append(line, DOM.$('.time-dot'));
		dot.style.cssText = 'position:absolute;left:-4px;top:-3px;width:8px;height:8px;border-radius:50%;background:#ef4444;';
	}

	private _getWeekDays(): Date[] {
		const d = new Date(this.currentDate);
		const day = d.getDay();
		const monday = new Date(d);
		monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
		const days: Date[] = [];
		for (let i = 0; i < 7; i++) {
			const dd = new Date(monday);
			dd.setDate(monday.getDate() + i);
			days.push(dd);
		}
		return days;
	}

	private async _refresh(): Promise<void> {
		await this._loadAppointments();
		this._renderHeader();
		this._renderGrid();
	}

	private async _createAppointment(date: string, time: string, providerId?: string): Promise<void> {
		// Calculate end time (default 15 min)
		const [h, m] = time.split(':').map(Number);
		const endH = m + 15 >= 60 ? h + 1 : h;
		const endM = (m + 15) % 60;
		const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

		// Right-side slide-in form panel — matches the Tasks "+ New Task" pattern
		// so every create/edit dialog across the EHR uses the same shape.
		const overlay = DOM.append(this.root, DOM.$('.appt-form-overlay'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:100;display:flex;justify-content:flex-end;';

		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';
		backdrop.addEventListener('click', () => overlay.remove());

		const form = DOM.append(overlay, DOM.$('.appt-form'));
		form.style.cssText = 'position:relative;width:560px;max-width:95vw;height:100%;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border);padding:20px;overflow-y:auto;overflow-x:hidden;box-shadow:-8px 0 24px rgba(0,0,0,0.3);scrollbar-width:none;z-index:1;box-sizing:border-box;';

		// Header (title + close)
		const headerRow = DOM.append(form, DOM.$('div'));
		headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 0 16px;';
		const title = DOM.append(headerRow, DOM.$('h3'));
		title.textContent = 'Schedule Appointment';
		title.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(headerRow, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.title = 'Close';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;color:var(--vscode-foreground);padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		// Map to store form field references (avoids querySelector)
		const formFields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

		// Build a US-formatted (mm/dd/yyyy) date input. Linux Electron renders
		// native `<input type="date">` as yyyy-mm-dd; the test team requires the
		// US format. We render a visible mm/dd/yyyy text box plus a small native
		// date picker (calendar pop-up) — the hidden sibling registered in
		// formFields keeps the value as yyyy-mm-dd so the save payload stays the
		// same regardless of how the user types.
		const buildDateField = (parent: HTMLElement, id: string, isoValue: string): void => {
			const wrap = DOM.append(parent, DOM.$('div'));
			wrap.style.cssText = 'position:relative;display:block;';

			const isoToUs = (iso: string): string => {
				const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
				return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
			};
			// usToIsoDate validates real calendar dates and returns '' for
			// impossible values like 13/33/2000, so the hidden ISO field (and the
			// save-time guard below) reject them instead of forwarding
			// "2000-13-33" to the API (QA: invalid-date appointment created).
			const usToIso = (us: string): string => usToIsoDate(us);

			const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			visible.type = 'text';
			visible.placeholder = 'MM/DD/YYYY';
			visible.maxLength = 10;
			visible.value = isoToUs(isoValue);
			visible.style.cssText = 'width:100%;padding:6px 32px 6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';

			const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			hidden.type = 'hidden';
			hidden.id = id;
			hidden.value = isoValue;
			formFields.set(id, hidden);

			const sync = () => {
				// Auto-insert slashes and cap the year at 4 digits as the user types.
				const masked = maskUsDate(visible.value);
				if (masked !== visible.value) { visible.value = masked; }
				const iso = usToIso(visible.value);
				hidden.value = iso;
				const bad = !!visible.value && !iso;
				// Flag invalid (non-empty but unparseable) dates so the save handler
				// can show a "valid date" message rather than a "required" one.
				hidden.dataset.invalid = bad ? '1' : '';
				visible.style.borderColor = bad ? '#ef4444' : '';
			};
			visible.addEventListener('input', sync);
			visible.addEventListener('blur', sync);

			// Native picker overlays the calendar icon area — opacity:0 but fully
			// clickable so a direct click opens the native calendar in Electron.
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.value = isoValue;
			picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			picker.addEventListener('change', () => {
				visible.value = isoToUs(picker.value);
				hidden.value = picker.value;
				sync();
			});

			// Calendar icon — clickable so clicking the glyph itself opens the picker too
			const icon = DOM.append(wrap, DOM.$('span.codicon.codicon-calendar'));
			icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--vscode-input-placeholderForeground,#888);cursor:pointer;line-height:1;';
			// Open the calendar from a click anywhere in the icon column, not just
			// the native input's tiny indicator glyph.
			enablePickerClick(picker, icon);
		};

		// Helper: create form field
		const field = (label: string, id: string, type: string, value: string, required: boolean, options?: Array<{ value: string; label: string }>): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
			const group = DOM.append(form, DOM.$('.form-group'));
			group.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(group, DOM.$('label'));
			lbl.textContent = label + (required ? ' *' : '');
			lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--vscode-foreground);';
			const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';

			if (options) {
				// Custom dropdown — native <select> popups render with OS chrome
				// (faint grey-on-grey unreadable options on dark themes).
				const sel = createCustomDropdown({
					parent: group,
					options,
					initialValue: value,
					placeholder: `Select ${label}...`,
					required,
					triggerStyle: inputStyle,
				});
				sel.id = id;
				formFields.set(id, sel);
				return sel;
			} else if (type === 'textarea') {
				const ta = DOM.append(group, DOM.$('textarea')) as HTMLTextAreaElement;
				ta.id = id; ta.value = value; ta.rows = 3; ta.style.cssText = inputStyle + 'resize:vertical;';
				if (id === 'notes') { ta.placeholder = 'Reason for visit or scheduling notes…'; }
				formFields.set(id, ta);
				return ta;
			} else if (type === 'date') {
				buildDateField(group, id, value);
				return formFields.get(id) as HTMLInputElement;
			} else if (type === 'time') {
				const hidden = createTimeDropdown({ parent: group, initialValue: value, placeholder: `Select ${label}...`, triggerStyle: inputStyle });
				hidden.id = id;
				formFields.set(id, hidden);
				return hidden;
			} else {
				const inp = DOM.append(group, DOM.$('input')) as HTMLInputElement;
				inp.id = id; inp.type = type; inp.value = value; inp.style.cssText = inputStyle;
				formFields.set(id, inp);
				return inp;
			}
		};

		// Form row helper
		const row = (label1: string, id1: string, type1: string, val1: string, req1: boolean, label2: string, id2: string, type2: string, val2: string, req2: boolean) => {
			const r = DOM.append(form, DOM.$('.form-row'));
			r.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;';
			const g1 = DOM.append(r, DOM.$('.fg')); const g2 = DOM.append(r, DOM.$('.fg'));
			const makeField = (parent: HTMLElement, label: string, id: string, type: string, value: string, required: boolean) => {
				const lbl = DOM.append(parent, DOM.$('label'));
				lbl.textContent = label + (required ? ' *' : '');
				lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;';
				if (type === 'date') {
					buildDateField(parent, id, value);
					return formFields.get(id) as HTMLInputElement;
				}
				const fieldStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
				if (type === 'time') {
					const hidden = createTimeDropdown({ parent, initialValue: value, placeholder: `Select ${label}...`, triggerStyle: fieldStyle });
					hidden.id = id;
					formFields.set(id, hidden);
					return hidden;
				}
				const inp = DOM.append(parent, DOM.$('input')) as HTMLInputElement;
				inp.id = id; inp.type = type; inp.value = value;
				inp.style.cssText = fieldStyle;
				formFields.set(id, inp);
				return inp;
			};
			makeField(g1, label1, id1, type1, val1, req1);
			makeField(g2, label2, id2, type2, val2, req2);
		};

		// --- Form Fields ---

		// Patient search (with live results)
		const patientGroup = DOM.append(form, DOM.$('.form-group'));
		patientGroup.style.cssText = 'margin-bottom:12px;position:relative;';
		const patLabel = DOM.append(patientGroup, DOM.$('label'));
		patLabel.textContent = 'Patient *';
		patLabel.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;';
		const patInput = DOM.append(patientGroup, DOM.$('input')) as HTMLInputElement;
		patInput.id = 'patientSearch'; patInput.placeholder = 'Search by name or MRN...';
		patInput.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		const patResults = DOM.append(patientGroup, DOM.$('.pat-results'));
		patResults.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;max-height:150px;overflow-y:auto;z-index:10;display:none;';
		const patIdHidden = DOM.append(patientGroup, DOM.$('input')) as HTMLInputElement;
		patIdHidden.type = 'hidden'; patIdHidden.id = 'patientId';

		const _searchPatients = async (q: string) => {
			try {
				const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
				if (!res.ok) { return; }
				const data = await res.json();
				let patients: Array<Record<string, string>> = [];
				if (Array.isArray(data?.data?.content)) { patients = data.data.content; }
				else if (Array.isArray(data?.data)) { patients = data.data; }
				else if (Array.isArray(data?.content)) { patients = data.content; }
				else if (Array.isArray(data)) { patients = data as Array<Record<string, string>>; }
				DOM.clearNode(patResults);
				for (const p of patients) {
					const item = DOM.append(patResults, DOM.$('div'));
					item.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);';
					item.textContent = `${p.firstName || ''} ${p.lastName || ''} — DOB: ${p.dateOfBirth || ''} | MRN: ${p.mrn || p.id || ''}`;
					item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
					item.addEventListener('mouseleave', () => { item.style.background = ''; });
					item.addEventListener('click', () => {
						patInput.value = `${p.firstName || ''} ${p.lastName || ''}`.trim();
						patIdHidden.value = p.id || '';
						patResults.style.display = 'none';
					});
				}
				patResults.style.display = patients.length > 0 ? 'block' : 'none';
			} catch { /* */ }
		};

		let searchTimer: ReturnType<typeof setTimeout> | undefined;
		// Show dropdown immediately on focus
		patInput.addEventListener('focus', () => {
			if (searchTimer) { clearTimeout(searchTimer); }
			searchTimer = setTimeout(() => _searchPatients(patInput.value), 150);
		});
		patInput.addEventListener('input', () => {
			if (searchTimer) { clearTimeout(searchTimer); }
			const q = patInput.value;
			searchTimer = setTimeout(() => _searchPatients(q), 250);
		});

		// Visit Type
		const visitTypes = [
			{ value: 'Consultation', label: 'Consultation' }, { value: 'Follow-Up', label: 'Follow-Up' },
			{ value: 'New Patient', label: 'New Patient' }, { value: 'Urgent', label: 'Urgent' },
			{ value: 'Routine', label: 'Routine' }, { value: 'Annual Physical', label: 'Annual Physical' },
			{ value: 'Telehealth', label: 'Telehealth' }, { value: 'Lab Work', label: 'Lab Work' },
			{ value: 'Procedure', label: 'Procedure' }, { value: 'Referral', label: 'Referral' },
		];
		const visitTypeEl = field('Visit Type', 'visitType', 'select', 'Consultation', false, visitTypes) as HTMLSelectElement;

		// Start Date + Start Time row
		row('Start Date', 'startDate', 'date', date, true, 'Start Time', 'startTime', 'time', time, true);
		// End Date + End Time row — both required, both render as mm/dd/yyyy
		// via buildDateField. End Date defaults to the same day as Start.
		row('End Date', 'endDate', 'date', date, true, 'End Time', 'endTime', 'time', endTime, true);
		// Duration — read-only computed display (matches ehr-ui AppointmentModal).
		// Shows the gap between Start Time and End Time as "30 min" / "1h 30m" / "—".
		const durationGroup = DOM.append(form, DOM.$('.form-group'));
		durationGroup.style.cssText = 'margin-bottom:12px;';
		const durationLbl = DOM.append(durationGroup, DOM.$('label'));
		durationLbl.textContent = 'Duration';
		durationLbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--vscode-foreground);';
		const durationDisplay = DOM.append(durationGroup, DOM.$('div'));
		durationDisplay.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-descriptionForeground,#888);font-size:13px;box-sizing:border-box;';
		const hmToMinutes = (hm: string): number => {
			const [h, m] = (hm || '').split(':').map(n => parseInt(n || '0', 10));
			return (h || 0) * 60 + (m || 0);
		};
		const updateDuration = () => {
			const sT = (formFields.get('startTime') as HTMLInputElement | undefined)?.value || '';
			const eT = (formFields.get('endTime') as HTMLInputElement | undefined)?.value || '';
			const diff = hmToMinutes(eT) - hmToMinutes(sT);
			if (!sT || !eT || diff <= 0) { durationDisplay.textContent = '—'; return; }
			const h = Math.floor(diff / 60);
			const m = diff % 60;
			durationDisplay.textContent = h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m} min`;
		};
		const startTimeInput = formFields.get('startTime') as HTMLInputElement | undefined;
		const endTimeInput = formFields.get('endTime') as HTMLInputElement | undefined;
		// When Start Time changes, default End Time to start + 15 min, then recompute.
		// The custom time dropdown (createTimeDropdown) fires a 'change' event — NOT
		// 'input' — so we listen for 'change'. We also dispatch 'change' on the End
		// Time hidden input after setting its value so the dropdown's visible label
		// (which refreshes on 'change') updates too.
		startTimeInput?.addEventListener('change', () => {
			const sT = startTimeInput.value;
			if (sT && endTimeInput) {
				const total = hmToMinutes(sT) + 15;
				const nh = Math.floor(total / 60) % 24;
				const nm = total % 60;
				endTimeInput.value = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
				endTimeInput.dispatchEvent(new Event('change', { bubbles: true }));
			}
			updateDuration();
		});
		endTimeInput?.addEventListener('change', updateDuration);
		updateDuration();

		const priorityRow = DOM.append(form, DOM.$('.form-row'));
		priorityRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;';
		const priorityGroup = DOM.append(priorityRow, DOM.$('.fg'));
		const priorityLbl = DOM.append(priorityGroup, DOM.$('label'));
		priorityLbl.textContent = 'Priority';
		priorityLbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;';
		const prioritySel = createCustomDropdown({
			parent: priorityGroup,
			options: [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }],
			initialValue: 'routine',
			triggerStyle: 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;',
		});
		prioritySel.id = 'priority';
		formFields.set('priority', prioritySel);

		// Provider — pre-select the column that was clicked (if any). No explicit
		// empty option: createCustomDropdown already surfaces the `Select Provider...`
		// placeholder as a clear row, so adding one here duplicated it in the list.
		const provOptions = this.providers.map(p => ({ value: p.id, label: p.name }));
		const providerIdEl = field('Provider', 'providerId', 'select', providerId || '', true, provOptions) as HTMLSelectElement;

		// Location — same as Provider: the placeholder row is provided by the
		// dropdown itself, so we must not add a second `Select location...` option.
		const locOptions = this.locations.map(l => ({ value: l.id, label: l.name }));
		const locationIdEl = field('Location', 'locationId', 'select', '', true, locOptions) as HTMLSelectElement;

		// Status
		const statusEl = field('Status', 'status', 'select', 'scheduled', false, [
			{ value: 'scheduled', label: 'Scheduled' }, { value: 'confirmed', label: 'Confirmed' },
			{ value: 'arrived', label: 'Arrived' }, { value: 'checked-in', label: 'Checked In' },
			{ value: 'in-room', label: 'In Room' }, { value: 'with-provider', label: 'With Provider' },
			{ value: 'fulfilled', label: 'Fulfilled' }, { value: 'cancelled', label: 'Cancelled' },
			{ value: 'noshow', label: 'No Show' },
		]) as HTMLSelectElement;

		// Notes
		const notesEl = field('Reason / Notes', 'notes', 'textarea', '', false) as HTMLTextAreaElement;

		// Buttons — pinned to the bottom of the scrollable form so Cancel /
		// Schedule Appointment stay visible and reachable no matter how far the
		// form is scrolled (issue #6: the buttons used to scroll out of view).
		// `position:sticky;bottom:0` keeps them docked while the fields scroll
		// underneath; the opaque background prevents content bleeding through.
		const btnRow = DOM.append(form, DOM.$('.btn-row'));
		btnRow.style.cssText = 'position:sticky;bottom:0;display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding:14px 0 6px;border-top:1px solid var(--vscode-editorWidget-border);background:var(--vscode-editorWidget-background,#252526);z-index:3;';

		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => { overlay.remove(); });

		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Schedule Appointment';
		saveBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';

		// In-flight guard: the duplicate pre-check and the POST below are async, so
		// without a synchronous flag set before the first await, rapid repeated
		// clicks each created a separate appointment (QA: scheduling once produced
		// many). Reset only on the early-return paths that keep the overlay open;
		// the success/error paths remove the overlay (and this closure) entirely.
		let submitting = false;
		saveBtn.addEventListener('click', async () => {
			if (submitting) { return; }
			const patName = patInput.value;
			const patId = patIdHidden.value;
			const visitType = visitTypeEl.value;
			const startD = (formFields.get('startDate') as HTMLInputElement | undefined)?.value || '';
			const startT = (formFields.get('startTime') as HTMLInputElement | undefined)?.value || '';
			const endD = (formFields.get('endDate') as HTMLInputElement | undefined)?.value || startD;
			const endT = (formFields.get('endTime') as HTMLInputElement | undefined)?.value || '';
			const provId = providerIdEl.value;
			const locId = locationIdEl.value;
			const status = statusEl.value;
			const notes = notesEl.value;

			// Validate every mandatory (*) field before booking. Previously only
			// patient / start / location were checked, so an appointment could be
			// saved with no provider or end date/time. Highlight + focus the first
			// missing field and block submit.
			const startDateEl = formFields.get('startDate') as HTMLInputElement | undefined;
			const startTimeEl = formFields.get('startTime') as HTMLInputElement | undefined;
			const endDateEl = formFields.get('endDate') as HTMLInputElement | undefined;
			const endTimeEl = formFields.get('endTime') as HTMLInputElement | undefined;
			for (const el of [patInput, startDateEl, startTimeEl, endDateEl, endTimeEl, providerIdEl, locationIdEl]) {
				if (el) { el.style.borderColor = ''; }
			}
			const requireField = (ok: boolean, el: HTMLElement | undefined, message: string): boolean => {
				if (ok) { return false; }
				this.notificationService.notify({ severity: Severity.Warning, message });
				if (el) { el.style.borderColor = '#ef4444'; el.focus(); }
				return true;
			};
			// Reject impossible typed dates (e.g. 13/33/2000) with a clear message
			// before the required-empty checks — the hidden ISO field is empty for
			// these, so without this they'd wrongly read as "required".
			const invalidDate = (el: HTMLInputElement | undefined, label: string): boolean => {
				if (el?.dataset.invalid === '1') {
					this.notificationService.notify({ severity: Severity.Warning, message: `Enter a valid ${label} (MM/DD/YYYY)` });
					el.focus();
					return true;
				}
				return false;
			};
			if (invalidDate(startDateEl, 'Start Date')) { return; }
			if (invalidDate(endDateEl, 'End Date')) { return; }
			if (requireField(!!patName, patInput, 'Patient is required')) { return; }
			if (requireField(!!startD, startDateEl, 'Start Date is required')) { return; }
			if (requireField(!!startT, startTimeEl, 'Start Time is required')) { return; }
			if (requireField(!!(endDateEl?.value), endDateEl, 'End Date is required')) { return; }
			if (requireField(!!endT, endTimeEl, 'End Time is required')) { return; }
			if (requireField(!!provId, providerIdEl, 'Provider is required')) { return; }
			if (requireField(!!locId, locationIdEl, 'Location is required')) { return; }

			// End must be after start (QA issue 6: an end date/time earlier than
			// the start was saved without complaint). Date fields hold ISO values
			// and times are HH:MM, so `${date}T${time}` strings sort correctly.
			const startDT = `${startD}T${startT}`;
			const endDT = `${endD}T${endT}`;
			if (endDT <= startDT) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'End date/time must be after the start date/time' });
				if (endDateEl) { endDateEl.style.borderColor = '#ef4444'; }
				if (endTimeEl) { endTimeEl.style.borderColor = '#ef4444'; endTimeEl.focus(); }
				return;
			}

			// Reject appointments in the past (QA: with the clock at 11:45 a 9:00
			// slot on the same day was still booked). `${date}T${time}` with no zone
			// parses as local time, matching the local `new Date()` we compare to.
			const startWhen = new Date(`${startD}T${startT}`);
			if (!isNaN(startWhen.getTime()) && startWhen.getTime() < Date.now()) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Appointment cannot be scheduled in the past' });
				if (startDateEl) { startDateEl.style.borderColor = '#ef4444'; }
				if (startTimeEl) { startTimeEl.style.borderColor = '#ef4444'; startTimeEl.focus(); }
				return;
			}

			// All required fields are valid — claim the in-flight lock and disable
			// the button NOW, before the first await (the dup-check), so a second
			// click can't slip past while the check/POST are running.
			submitting = true;
			saveBtn.disabled = true;
			saveBtn.textContent = 'Scheduling...';
			const reopenForRetry = (): void => {
				submitting = false;
				saveBtn.disabled = false;
				saveBtn.textContent = 'Schedule Appointment';
			};

			// Prevent double-booking: a patient may have at most one active
			// appointment per calendar day. Check the server for the chosen day so
			// the rule holds even when that date is outside the currently loaded
			// range (cancelled appointments don't count, so a patient can be
			// re-booked after a cancellation). A flat-shape match (patientId) is
			// preferred; we fall back to name when no stable id is available.
			const matchesPatient = (a: Appointment): boolean => {
				const aPid = resolveApptPatientId(a);
				if (patId && aPid) { return String(aPid) === String(patId); }
				return !!patName && (a.patientName || '').trim().toLowerCase() === patName.trim().toLowerCase();
			};
			try {
				const dupRes = await this.apiService.fetch(`/api/appointments?page=0&size=500&dateFrom=${startD}&dateTo=${startD}`);
				if (dupRes.ok) {
					const dupData = await dupRes.json();
					const existing = (dupData?.data?.content || dupData?.content || (Array.isArray(dupData?.data) ? dupData.data : (Array.isArray(dupData) ? dupData : []))) as Appointment[];
					const clash = existing.some(a => {
						if ((a.status || '').toLowerCase() === 'cancelled') { return false; }
						const aDate = this._parseAptDate(a);
						return !!aDate && localDateStr(aDate) === startD && matchesPatient(a);
					});
					if (clash) {
						this.notificationService.notify({ severity: Severity.Warning, message: `${patName} already has an appointment on ${startD}. Only one appointment per patient per day is allowed.` });
						patInput.style.borderColor = '#ef4444';
						patInput.focus();
						reopenForRetry();
						return;
					}
				}
			} catch { /* pre-check failed (offline/API error) — let the create proceed */ }

			// Calculate duration in minutes
			const startMins = parseInt(startT.split(':')[0]) * 60 + parseInt(startT.split(':')[1]);
			const endMins = parseInt(endT.split(':')[0]) * 60 + parseInt(endT.split(':')[1]);
			const duration = endMins > startMins ? endMins - startMins : 30;

			const provName = this.providers.find(p => p.id === provId)?.name || '';

			try {
				// Try FHIR-style endpoint first, fallback to simple
				const endpoints = [
					patId ? `/api/fhir-resource/appointments/patient/${patId}` : null,
					'/api/appointments',
				].filter(Boolean) as string[];

				let success = false;
				let savedRes: Response | null = null;
				for (const endpoint of endpoints) {
					try {
						const body: Record<string, unknown> = {
							appointmentType: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0276', code: visitType, display: visitType }], text: visitType },
							status: status || 'scheduled',
							priority: (formFields.get('priority') as HTMLSelectElement | undefined)?.value || 'routine',
							start: `${startD}T${startT}:00`,
							end: `${endD}T${endT}:00`,
							reason: notes || null,
							patientName: patName,
							patientId: patId || undefined,
							providerId: provId || undefined,
							providerName: provName || undefined,
							locationId: locId || undefined,
							duration,
							participant: [
								patId ? { actor: { reference: `Patient/${patId}` }, required: 'required', status: 'accepted' } : null,
								provId ? { actor: { reference: `Practitioner/${provId}` }, required: 'required', status: 'accepted' } : null,
								locId ? { actor: { reference: `Location/${locId}` }, required: 'required', status: 'accepted' } : null,
							].filter(Boolean),
						};

						const res = await this.apiService.fetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
						if (res.ok) {
							success = true;
							savedRes = res;
							break;
						}
					} catch { /* try next */ }
				}

				overlay.remove();
				if (success) {
					this.notificationService.notify({ severity: Severity.Info, message: `Scheduled ${visitType} for ${patName} at ${startT}${provName ? ' with ' + provName : ''}` });
					// Optimistic instant reflect: surface the new appointment in the grid
					// the moment Save completes, prepending it from the save response (or a
					// fallback built from the submitted values), then reconcile in the
					// background so the user never waits on a second full-list GET.
					const saved = (savedRes ? await parseSavedRecord(savedRes) : null) ?? {
						id: `optimistic-${Date.now()}`,
						patientName: patName,
						appointmentType: visitType,
						status: status || 'scheduled',
						startTime: `${startD}T${startT}:00`,
						start: `${startD}T${startT}:00`,
						duration,
						providerId: provId || undefined,
						providerName: provName || undefined,
						locationId: locId || undefined,
					};
					this.appointments = [saved as unknown as Appointment, ...(this.appointments || [])];
					this._renderHeader();
					this._renderGrid();
					void this._refresh();
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: 'Failed to create appointment. Check API connection.' });
				}
			} catch (err) {
				overlay.remove();
				this.notificationService.notify({ severity: Severity.Error, message: `Error: ${err}` });
			}
		});

		// Close on overlay click (outside form)
		overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); } });

		// Focus patient search
		patInput.focus();
	}

	private async _editAppointment(apt: Appointment): Promise<void> {
		// A "Completed" appointment is finalized (its encounter has been created)
		// — the status-mutating actions (Change Status, Cancel, Mark No-Show) are
		// withheld so the visit can no longer move out of the Completed state.
		const isCompleted = (apt.status || '').toLowerCase() === 'completed';
		const items = [
			...(isCompleted ? [] : [{ label: 'Change Status', description: `Current: ${apt.status}` }]),
			{ label: 'Send Reminder', description: 'Email/SMS reminder to patient' },
			{ label: 'Reschedule', description: 'Move to a different time' },
			{ label: 'Create Series', description: 'Recurring appointments (e.g., 6 weekly PT)' },
			{ label: 'Add to Waitlist', description: 'Add patient to cancellation waitlist' },
			{ label: 'Edit Details' },
			...(isCompleted ? [] : [{ label: 'Cancel Appointment' }, { label: 'Mark No-Show' }]),
		];
		const pick = await this.quickInputService.pick(items, { placeHolder: `${apt.patientName} — ${getAppointmentType(apt)}` });
		if (!pick) { return; }

		if (pick.label === 'Change Status') {
			const statuses = ['scheduled', 'confirmed', 'arrived', 'checked-in', 'in-room', 'with-provider', 'fulfilled'];
			const statusPick = await this.quickInputService.pick(
				statuses.map(s => ({ label: s, description: s === apt.status ? '(current)' : '' })),
				{ placeHolder: 'Select new status' }
			);
			if (statusPick) {
				try {
					await this.apiService.fetch(`/api/appointments/${apt.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: statusPick.label }) });
					this.notificationService.notify({ severity: Severity.Info, message: `Status updated to ${statusPick.label}` });
					await this._refresh();
				} catch { /* */ }
			}
		} else if (pick.label === 'Send Reminder') {
			const channels = await this.quickInputService.pick(
				[{ label: 'Email' }, { label: 'SMS' }, { label: 'Both' }],
				{ placeHolder: 'Send reminder via' }
			);
			if (channels) {
				try {
					await this.apiService.fetch(`/api/appointments/${apt.id}/reminder`, { method: 'POST', body: JSON.stringify({ channel: channels.label.toLowerCase() }) });
					this.notificationService.notify({ severity: Severity.Info, message: `Reminder sent via ${channels.label}` });
				} catch {
					this.notificationService.notify({ severity: Severity.Warning, message: 'Reminder API not available' });
				}
			}
		} else if (pick.label === 'Reschedule') {
			const newDate = await this.quickInputService.input({ prompt: 'New date (YYYY-MM-DD)', value: localDateStr(new Date()) });
			if (!newDate) { return; }
			const newTime = await this.quickInputService.input({ prompt: 'New time (HH:MM)', value: '09:00' });
			if (!newTime) { return; }
			try {
				await this.apiService.fetch(`/api/appointments/${apt.id}`, { method: 'PUT', body: JSON.stringify({ ...apt, startTime: `${newDate}T${newTime}:00` }) });
				this.notificationService.notify({ severity: Severity.Info, message: 'Appointment rescheduled' });
				this.currentDate = new Date(newDate + 'T00:00:00');
				await this._refresh();
			} catch {
				this.notificationService.notify({ severity: Severity.Error, message: 'Failed to reschedule' });
			}
		} else if (pick.label === 'Cancel Appointment') {
			try {
				await this.apiService.fetch(`/api/appointments/${apt.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
				this.notificationService.notify({ severity: Severity.Info, message: 'Appointment cancelled' });
				await this._refresh();
			} catch { /* */ }
		} else if (pick.label === 'Mark No-Show') {
			try {
				await this.apiService.fetch(`/api/appointments/${apt.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'noshow' }) });
				this.notificationService.notify({ severity: Severity.Info, message: 'Marked as no-show' });
				await this._refresh();
			} catch { /* */ }
		} else if (pick.label === 'Create Series') {
			const count = await this.quickInputService.input({ prompt: 'Number of appointments in series', value: '6' });
			if (!count) { return; }
			const frequency = await this.quickInputService.pick(
				[{ label: 'Weekly' }, { label: 'Bi-weekly' }, { label: 'Monthly' }],
				{ placeHolder: 'Recurrence frequency' }
			);
			if (!frequency) { return; }

			const n = parseInt(count);
			const intervalDays = frequency.label === 'Weekly' ? 7 : frequency.label === 'Bi-weekly' ? 14 : 30;

			try {
				const baseDate = this._parseAptDate(apt) || new Date();
				for (let i = 1; i <= n; i++) {
					const newDate = new Date(baseDate);
					newDate.setDate(baseDate.getDate() + i * intervalDays);
					await this.apiService.fetch('/api/appointments', {
						method: 'POST',
						body: JSON.stringify({
							patientName: apt.patientName,
							appointmentType: getAppointmentType(apt),
							startTime: newDate.toISOString(),
							status: 'scheduled',
							duration: apt.duration || 30,
							providerId: apt.providerId,
							locationId: apt.locationId,
						}),
					});
				}
				this.notificationService.notify({ severity: Severity.Info, message: `Created ${n} ${frequency.label.toLowerCase()} appointments` });
				await this._refresh();
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Error, message: `Failed to create series: ${err}` });
			}
		} else if (pick.label === 'Add to Waitlist') {
			try {
				await this.apiService.fetch('/api/waitlist', {
					method: 'POST',
					body: JSON.stringify({
						patientName: apt.patientName,
						requestedType: getAppointmentType(apt),
						requestedDate: apt.startTime,
						priority: 1,
					}),
				});
				this.notificationService.notify({ severity: Severity.Info, message: `${apt.patientName} added to waitlist` });
			} catch {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Waitlist API not available' });
			}
		}
	}
	/** Date picker with calendar grid popup — replaces the prev/date/next arrow
	 *  nav. Clicking the trigger button opens a month grid; selecting a day
	 *  sets `currentDate` and re-renders the calendar. Today is highlighted. */
	private _buildDatePicker(parent: HTMLElement): void {
		const wrap = DOM.append(parent, DOM.$('.cal-date-picker'));
		wrap.style.cssText = 'position:relative;';
		this._filterWraps.push(wrap);

		const trigger = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
		trigger.title = 'Pick a date';
		trigger.style.cssText = 'padding:3px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);min-width:220px;text-align:center;';
		const updateTriggerLabel = () => {
			if (this.viewMode === 'day') {
				trigger.textContent = this.currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
			} else if (this.viewMode === 'month') {
				trigger.textContent = this.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
			} else {
				const { startDate, endDate } = this._getDateRange();
				const s = new Date(startDate + 'T00:00:00');
				const e = new Date(endDate + 'T00:00:00');
				trigger.textContent = `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
			}
		};
		updateTriggerLabel();

		const panel = DOM.append(wrap, DOM.$('.cal-date-panel'));
		panel.style.cssText = 'position:absolute;top:100%;left:0;margin-top:4px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:6px;box-shadow:0 6px 16px rgba(0,0,0,0.35);z-index:50;display:none;padding:10px;width:260px;';
		this._filterPanels.push(panel);

		// Local view state: month being browsed inside the picker (independent of currentDate)
		let viewMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);

		const renderPanel = () => {
			DOM.clearNode(panel);

			// allow-any-unicode-next-line
			// Header: ◀ / Month Year / ▶
			const header = DOM.append(panel, DOM.$('.cal-date-header'));
			header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
			const prev = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
			prev.textContent = '\u25C0';
			prev.title = 'Previous month';
			prev.style.cssText = 'padding:2px 8px;background:transparent;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:13px;';
			prev.addEventListener('click', (e) => { e.stopPropagation(); viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderPanel(); });
			const title = DOM.append(header, DOM.$('span'));
			title.textContent = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
			title.style.cssText = 'font-weight:600;font-size:13px;';
			const next = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
			next.textContent = '\u25B6';
			next.title = 'Next month';
			next.style.cssText = 'padding:2px 8px;background:transparent;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:13px;';
			next.addEventListener('click', (e) => { e.stopPropagation(); viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderPanel(); });

			// allow-any-unicode-next-line
			// Weekday header row (Sun–Sat)
			const grid = DOM.append(panel, DOM.$('.cal-date-grid'));
			grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;';
			for (const dow of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
				const cell = DOM.append(grid, DOM.$('div'));
				cell.textContent = dow;
				cell.style.cssText = 'text-align:center;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);padding:4px 0;';
			}

			// Day cells — start with the leading blanks so weekday columns align
			const firstDow = viewMonth.getDay();
			const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
			const today = new Date(); today.setHours(0, 0, 0, 0);
			for (let i = 0; i < firstDow; i++) {
				const blank = DOM.append(grid, DOM.$('div'));
				blank.style.cssText = 'height:28px;';
			}
			for (let d = 1; d <= daysInMonth; d++) {
				const dayBtn = DOM.append(grid, DOM.$('button')) as HTMLButtonElement;
				dayBtn.textContent = String(d);
				const cellDate = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d);
				const isToday = cellDate.getTime() === today.getTime();
				const isSelected = cellDate.toDateString() === this.currentDate.toDateString();
				const base = 'height:28px;border:none;border-radius:14px;cursor:pointer;font-size:12px;';
				let extra = 'background:transparent;color:var(--vscode-foreground);';
				if (isSelected) {
					extra = 'background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);font-weight:600;';
				} else if (isToday) {
					extra = 'background:transparent;color:var(--vscode-textLink-foreground);font-weight:700;';
				}
				dayBtn.style.cssText = base + extra;
				dayBtn.addEventListener('mouseenter', () => { if (!isSelected) { dayBtn.style.background = 'var(--vscode-list-hoverBackground)'; } });
				dayBtn.addEventListener('mouseleave', () => { if (!isSelected) { dayBtn.style.background = 'transparent'; } });
				dayBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.currentDate = cellDate;
					this._publishCalendarState();
					updateTriggerLabel();
					panel.style.display = 'none';
					this._headerRendered = false;
					this._renderHeader();
					this._renderGrid();
				});
			}

			// Footer: Today shortcut
			const footer = DOM.append(panel, DOM.$('.cal-date-footer'));
			footer.style.cssText = 'display:flex;justify-content:center;margin-top:8px;border-top:1px solid var(--vscode-editorWidget-border);padding-top:8px;';
			const todayBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
			todayBtn.textContent = 'Today';
			todayBtn.style.cssText = 'padding:4px 14px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;';
			todayBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.currentDate = new Date();
				this.viewMode = 'day';
				this._publishCalendarState();
				updateTriggerLabel();
				panel.style.display = 'none';
				this._headerRendered = false;
				this._renderHeader();
				this._renderGrid();
			});
		};

		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			const isOpen = panel.style.display !== 'none';
			for (const p of this._filterPanels) { if (p !== panel) { p.style.display = 'none'; } }
			if (isOpen) {
				panel.style.display = 'none';
			} else {
				viewMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
				renderPanel();
				panel.style.display = 'block';
			}
		});

		const dismiss = (ev: Event) => {
			const target = ev.target as Node;
			if (!wrap.contains(target)) { panel.style.display = 'none'; }
		};
		DOM.getActiveWindow().document.addEventListener('click', dismiss);
	}

	/** Search input with live patient/provider dropdown. Selecting a result
	 *  applies the filter and (for patients) opens the patient chart so the
	 *  user sees the related appointment context. */
	private _buildPatientProviderSearch(parent: HTMLElement): void {
		const wrap = DOM.append(parent, DOM.$('.cal-search-wrap'));
		wrap.style.cssText = 'position:relative;';
		this._filterWraps.push(wrap);

		const searchBox = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		searchBox.type = 'text';
		searchBox.placeholder = 'Search patient, provider…';
		searchBox.value = this.patientNameFilter;
		searchBox.style.cssText = 'padding:3px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;min-width:200px;outline:none;';

		const panel = DOM.append(wrap, DOM.$('.cal-search-panel'));
		panel.style.cssText = 'position:absolute;top:100%;left:0;right:0;margin-top:2px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:40;display:none;max-height:280px;overflow-y:auto;min-width:260px;';
		this._filterPanels.push(panel);

		const renderResults = () => {
			DOM.clearNode(panel);
			const q = searchBox.value.trim().toLowerCase();
			if (!q) {
				panel.style.display = 'none';
				return;
			}

			// Patient matches — derive from appointments (name+id pairs)
			const patientMap = new Map<string, { id: string; name: string }>();
			for (const a of this.appointments) {
				const name = (a.patientName || `${a.patientFirstName || ''} ${a.patientLastName || ''}`).trim();
				if (!name) { continue; }
				if (!name.toLowerCase().includes(q)) { continue; }
				const id = (a as unknown as { patientId?: string }).patientId || name;
				if (!patientMap.has(id)) { patientMap.set(id, { id, name }); }
			}
			const patients = Array.from(patientMap.values()).slice(0, 8);

			// Provider matches — from the cached providers list
			const providers = this.providers.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);

			if (patients.length === 0 && providers.length === 0) {
				const empty = DOM.append(panel, DOM.$('div'));
				empty.textContent = 'No matches';
				empty.style.cssText = 'padding:10px;text-align:center;font-size:12px;color:var(--vscode-descriptionForeground);';
				panel.style.display = 'block';
				return;
			}

			const sectionLabel = (text: string) => {
				const el = DOM.append(panel, DOM.$('div'));
				el.textContent = text;
				el.style.cssText = 'padding:6px 10px 2px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);';
				return el;
			};
			const row = (label: string, sub: string, onClick: () => void) => {
				const r = DOM.append(panel, DOM.$('.cal-search-row'));
				r.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;';
				const name = DOM.append(r, DOM.$('div'));
				name.textContent = label;
				name.style.cssText = 'font-weight:600;color:var(--vscode-foreground);';
				if (sub) {
					const s = DOM.append(r, DOM.$('div'));
					s.textContent = sub;
					s.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
				}
				r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
				r.addEventListener('mouseleave', () => { r.style.background = ''; });
				r.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
			};

			if (patients.length > 0) {
				sectionLabel('Patients');
				for (const p of patients) {
					row(p.name, 'View appointments', () => {
						searchBox.value = p.name;
						this.patientNameFilter = p.name;
						panel.style.display = 'none';
						this._updateHeaderCount();
						this._renderGrid();
					});
				}
			}
			if (providers.length > 0) {
				sectionLabel('Providers');
				for (const p of providers) {
					row(p.name, 'Filter by provider', () => {
						this.providerFilter.clear();
						this.providerFilter.add(p.id);
						this.patientNameFilter = '';
						searchBox.value = '';
						panel.style.display = 'none';
						this._headerRendered = false;
						this._renderHeader();
						this._renderGrid();
					});
				}
			}

			panel.style.display = 'block';
		};

		searchBox.addEventListener('input', () => {
			this.patientNameFilter = searchBox.value;
			this._updateHeaderCount();
			this._renderGrid();
			renderResults();
		});
		searchBox.addEventListener('focus', renderResults);
		searchBox.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				panel.style.display = 'none';
				searchBox.blur();
			}
		});

		const dismiss = (ev: Event) => {
			const target = ev.target as Node;
			if (!wrap.contains(target)) { panel.style.display = 'none'; }
		};
		DOM.getActiveWindow().document.addEventListener('click', dismiss);
	}

	/** Searchable single-select dropdown — replacement for plain <select>.
	 *  Empty value selects the "all" item. */
	private _buildCheckboxFilter(
		parent: HTMLElement,
		allLabel: string,
		items: Array<{ id: string; name: string }>,
		selected: Set<string>,
		onChange: () => void,
		symbolMode = false,
		iconId?: string,
	): void {
		const wrap = DOM.append(parent, DOM.$('.cal-filter'));
		wrap.style.cssText = symbolMode ? 'position:relative;' : 'position:relative;max-width:200px;';
		this._filterWraps.push(wrap);

		const inputStyle = 'padding:2px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;width:100%;cursor:pointer;';
		const trigger = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;

		// In symbol mode the trigger is a compact "icon + label + chevron" pill
		// (e.g. an org icon next to "All Providers" with a dropdown caret) so the
		// control reads at a glance, instead of a bare emoji glyph whose rendering
		// and meaning varied across themes and operating systems.
		let labelEl: HTMLElement;
		let iconEl: HTMLElement | undefined;
		// Subtle, theme-driven pill (transparent + foreground text). The old
		// title-bar colors rendered as a dark fill in light themes; transparent
		// with an input border follows the active theme. When a selection is
		// active the pill switches to the input-option active highlight.
		const baseStyle = 'padding:4px 8px;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
		const setPillState = () => {
			if (!symbolMode) { return; }
			const active = selected.size > 0;
			trigger.style.borderColor = active ? 'var(--vscode-inputOption-activeBorder,#007acc)' : 'var(--vscode-input-border)';
			trigger.style.background = active ? 'var(--vscode-inputOption-activeBackground,rgba(0,122,204,0.18))' : 'transparent';
		};
		if (symbolMode) {
			trigger.style.cssText = baseStyle;
			iconEl = DOM.append(trigger, DOM.$('span.codicon.codicon-' + (iconId || 'filter'))) as HTMLElement;
			iconEl.style.cssText = 'font-size:15px;color:inherit;';
			labelEl = DOM.append(trigger, DOM.$('span'));
			labelEl.style.display = 'none';
			const chevron = DOM.append(trigger, DOM.$('span.codicon.codicon-chevron-down')) as HTMLElement;
			chevron.style.cssText = 'font-size:11px;color:inherit;opacity:0.7;';
			// Hover with the toolbar hover background only when there's no active
			// selection (the active-selection highlight should stay visible).
			trigger.addEventListener('mouseenter', () => { if (selected.size === 0) { trigger.style.background = 'var(--vscode-toolbar-hoverBackground)'; } });
			trigger.addEventListener('mouseleave', () => { setPillState(); });
		} else {
			trigger.style.cssText = inputStyle + 'text-align:left;';
			labelEl = trigger;
		}
		const describe = () => {
			if (selected.size === 0) { return allLabel; }
			if (selected.size === 1) {
				const id = selected.values().next().value;
				const it = items.find(i => i.id === id);
				return it?.name || String(id);
			}
			return `${selected.size} selected`;
		};
		labelEl.textContent = describe();
		setPillState();

		const panel = DOM.append(wrap, DOM.$('.cal-filter-panel'));
		panel.style.cssText = 'position:absolute;top:100%;left:0;right:0;margin-top:2px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:30;display:none;min-width:240px;';
		this._filterPanels.push(panel);

		const search = DOM.append(panel, DOM.$('input')) as HTMLInputElement;
		search.placeholder = 'Search...';
		search.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;background:var(--vscode-input-background);border:none;border-bottom:1px solid var(--vscode-editorWidget-border);color:var(--vscode-input-foreground);font-size:12px;outline:none;';

		const list = DOM.append(panel, DOM.$('.cal-filter-list'));
		list.style.cssText = 'max-height:280px;overflow-y:auto;';

		const renderList = () => {
			DOM.clearNode(list);
			const q = search.value.trim().toLowerCase();
			const rowStyle = 'display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px;';

			// "All <label>" row — checked when no individual selection
			const allRow = DOM.append(list, DOM.$('.cal-filter-item')) as HTMLElement;
			allRow.style.cssText = rowStyle;
			const allCb = DOM.append(allRow, DOM.$('input')) as HTMLInputElement;
			allCb.type = 'checkbox';
			allCb.checked = selected.size === 0;
			const allLbl = DOM.append(allRow, DOM.$('span'));
			allLbl.textContent = allLabel;
			allLbl.style.fontWeight = '600';
			const pickAll = () => {
				selected.clear();
				labelEl.textContent = describe();
				setPillState();
				onChange();
				renderList();
			};
			allRow.addEventListener('click', (e) => { e.stopPropagation(); pickAll(); });

			for (const it of items) {
				if (q && !it.name.toLowerCase().includes(q)) { continue; }
				const row = DOM.append(list, DOM.$('.cal-filter-item')) as HTMLElement;
				row.style.cssText = rowStyle;
				const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				cb.type = 'checkbox';
				cb.checked = selected.has(it.id);
				const lbl = DOM.append(row, DOM.$('span'));
				lbl.textContent = it.name;
				const toggle = () => {
					if (selected.has(it.id)) { selected.delete(it.id); }
					else { selected.add(it.id); }
					cb.checked = selected.has(it.id);
					labelEl.textContent = describe();
					setPillState();
					onChange();
				};
				row.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
				cb.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
				row.addEventListener('mouseleave', () => { row.style.background = ''; });
			}
		};

		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			const isOpen = panel.style.display !== 'none';
			// Opening one filter closes any other filter that is currently open —
			// so the All Providers / All Locations dropdowns no longer overlap.
			for (const otherPanel of this._filterPanels) {
				if (otherPanel !== panel) { otherPanel.style.display = 'none'; }
			}
			panel.style.display = isOpen ? 'none' : 'block';
			if (!isOpen) {
				renderList();
				search.value = '';
				search.focus();
			}
		});
		search.addEventListener('input', renderList);
		search.addEventListener('click', (e) => { e.stopPropagation(); });

		// Dismiss only when clicking outside ALL filter panels — so both can stay open at once.
		const dismiss = (ev: Event) => {
			const target = ev.target as Node;
			for (const w of this._filterWraps) {
				if (w.contains(target)) { return; }
			}
			panel.style.display = 'none';
		};
		DOM.getActiveWindow().document.addEventListener('click', dismiss);
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}

	override dispose(): void {
		super.dispose();
	}
}
