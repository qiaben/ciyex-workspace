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
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexInstallationsService } from './ciyexInstallationsService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import * as DOM from '../../../../base/browser/dom.js';
import { createOverflowMenuButton, createRowActionsContainer, openRecordEditDialog, IOverflowMenuItem } from './sidebarActions.js';

// Storage key the calendar editor writes to so the sidebar can mirror its
// view mode + selected date. Keep in sync with CalendarEditor.STORAGE_KEY.
const CALENDAR_VIEW_STATE_KEY = 'ciyex.calendar.viewState';
type CalendarViewMode = 'day' | 'week' | 'month';
interface CalendarViewState { viewMode: CalendarViewMode; currentDate: string; updatedAt: number }

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
	providerName?: string;
	practitionerName?: string;
	patientId?: string;
	encounterId?: string;
	room?: string;
	visitType?: string;
	locationName?: string;
}

function getAppointmentType(apt: Appointment): string {
	const t = apt.appointmentType;
	if (typeof t === 'string') { return t; }
	if (t && typeof t === 'object') { return t.text || t.coding?.[0]?.display || t.coding?.[0]?.code || ''; }
	return apt.type || '';
}

/** Predefined visit-type catalog used by the Edit Appointment dropdown so the
 *  field renders as a proper select even when the live appointment data has
 *  an unparseable FHIR CodeableConcept blob in `appointmentType`. */
const SCHEDULE_VISIT_TYPES = [
	'Consultation', 'Follow-Up', 'New Patient', 'Urgent',
	'Routine', 'Annual Physical', 'Telehealth', 'Lab Work',
	'Procedure', 'Referral',
];

/** Fallback status options when /api/appointments/status-options hasn't
 *  returned yet — keeps the Edit Appointment Status dropdown populated. */
const DEFAULT_STATUS_OPTIONS = [
	'Scheduled', 'Confirmed', 'Arrived', 'Checked-in', 'In Room',
	'With Provider', 'Completed', 'Re-Scheduled', 'No Show', 'Cancelled',
];

const STATUS_COLORS: Record<string, string> = {
	'scheduled': '#3b82f6',
	'confirmed': '#6366f1',
	'arrived': '#f59e0b',
	'checked-in': '#8b5cf6',
	'in-room': '#06b6d4',
	'with-provider': '#22c55e',
	'fulfilled': '#6b7280',
	'completed': '#6b7280',
	'cancelled': '#ef4444',
	'noshow': '#dc2626',
	'no-show': '#dc2626',
};

export class ScheduleSidebarPane extends ViewPane {

	static readonly ID = 'ciyex.calendar.schedule';

	private container!: HTMLElement;
	private appointments: Appointment[] = [];
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
		@IContextMenuService private readonly ctxMenuService: IContextMenuService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexInstallationsService private readonly installationsService: ICiyexInstallationsService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Clear the cached schedule + cached lookup options on logout so a
		// re-login as a different user doesn't keep the prior schedule.
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.NotAuthenticated) {
				this.appointments = [];
				this.statusOptions = [];
				this.roomOptions = [];
				this.waitlist = [];
			} else if (state === CiyexAuthState.Authenticated) {
				this.appointments = [];
				this._providerOptions = [];
				this.statusOptions = [];
				this.roomOptions = [];
				this.waitlist = [];
				if (this.container) {
					this._render(); // immediately wipe stale rows before async fetch
					void this._loadAndRender();
				}
			}
		}));

		// When the org installs or uninstalls a marketplace extension at runtime
		// (e.g. ciyex-telehealth purchased from the Hub), re-render so the
		// gated row actions like Video Call appear or disappear without
		// requiring a sign-out.
		this._register(this.installationsService.onDidChangeInstallations(() => {
			if (this.container) { void this._loadAndRender(); }
		}));
	}

	// View mode + reference date sourced from the calendar editor's published
	// state (workspace-scoped storage). Defaults to today / day so the sidebar
	// is useful even before the calendar has been opened in this session.
	private viewMode: CalendarViewMode = 'day';
	private currentDate: Date = new Date();

	private _readCalendarState(): void {
		const raw = this.storageService.get(CALENDAR_VIEW_STATE_KEY, StorageScope.WORKSPACE);
		if (!raw) { this.viewMode = 'day'; this.currentDate = new Date(); return; }
		try {
			const s = JSON.parse(raw) as Partial<CalendarViewState>;
			this.viewMode = (s.viewMode === 'week' || s.viewMode === 'month') ? s.viewMode : 'day';
			const d = s.currentDate ? new Date(s.currentDate) : new Date();
			this.currentDate = isNaN(d.getTime()) ? new Date() : d;
		} catch {
			this.viewMode = 'day';
			this.currentDate = new Date();
		}
	}

	/** Mirror of CalendarEditor._publishCalendarState — write the new view
	 *  mode / date so the main calendar editor's storage listener picks the
	 *  change up. Without this, toggling Week/Month from the sidebar's
	 *  three-dot menu would only update the sidebar.
	 */
	private _publishCalendarState(): void {
		try {
			const state: CalendarViewState = {
				viewMode: this.viewMode,
				currentDate: this.currentDate.toISOString(),
				updatedAt: Date.now(),
			};
			this.storageService.store(CALENDAR_VIEW_STATE_KEY, JSON.stringify(state), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch { /* best effort */ }
	}

	private _getRange(): { startDate: string; endDate: string; rangeLabel: string } {
		const d = new Date(this.currentDate);
		const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
		if (this.viewMode === 'day') {
			const s = iso(d);
			return { startDate: s, endDate: s, rangeLabel: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) };
		}
		if (this.viewMode === 'month') {
			const first = new Date(d.getFullYear(), d.getMonth(), 1);
			const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
			return { startDate: iso(first), endDate: iso(last), rangeLabel: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
		}
		// Week: Monday → Sunday
		const day = d.getDay();
		const monday = new Date(d);
		monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
		const sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);
		const sFmt = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		const eFmt = sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		// allow-any-unicode-next-line
		return { startDate: iso(monday), endDate: iso(sunday), rangeLabel: `${sFmt} – ${eFmt}` };
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.schedule-sidebar.ciyex-editor-root'));
		this.container.style.cssText = 'padding:0;overflow-y:auto;height:100%;font-size:12px;';

		// Mirror the calendar editor's view state (day / week / month + the
		// reference date the user is browsing). Re-render whenever the
		// calendar publishes a new value so flipping Week/Month from the
		// calendar header updates the sidebar's range immediately.
		this._readCalendarState();
		this._register(this.storageService.onDidChangeValue(StorageScope.WORKSPACE, CALENDAR_VIEW_STATE_KEY, this._store)(() => {
			this._readCalendarState();
			void this._loadAndRender();
		}));

		// Render skeleton, then poll every 2s until data loads
		this._render();
		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try {
				const token = localStorage.getItem('ciyex_token');
				if (!token) { return; } // Wait for login
			} catch { return; }

			if (this.appointments.length === 0) {
				this._loadAndRender();
			} else {
				win.clearInterval(poll);
				// Switch to 30s auto-refresh
				this.refreshTimer = win.setInterval(() => this._loadAndRender(), 30000);
			}
		}, 2000);
	}

	private pageSize = 25;

	private async _loadAndRender(append = false): Promise<void> {
		// Range matches the calendar editor's view (day = today, week =
		// Mon-Sun of currentDate, month = full calendar month). When the
		// user toggles Week / Month in the calendar header the sidebar
		// re-runs this loader via the storage-change listener above.
		const { startDate, endDate } = this._getRange();

		// Load appointments + status options only (rooms/waitlist are secondary)
		const loadAppts = async () => {
			try {
				const res = await this.apiService.fetch('/api/fhir-resource/appointments?page=0&size=500');
				if (res.ok) {
					const data = await res.json();
					const raw = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
					// Normalize FHIR field names to flat field names
					const page = raw.map((a: Record<string, unknown>) => ({
						...a,
						patientName: a.patientName || a.patientDisplay || '',
						// FHIR returns `patient` / `subject` as `"Patient/{uuid}"` reference strings.
						// Without this fallback `patientId` is undefined and the row click handler
						// (which gates on `if (apt.patientId)`) silently no-ops, so clicking an
						// appointment never opens the patient snapshot.
						patientId: a.patientId
							|| (typeof a.patient === 'string' ? (a.patient as string).replace('Patient/', '') : '')
							|| (typeof a.subject === 'string' ? (a.subject as string).replace('Patient/', '') : ''),
						providerName: a.providerName || a.providerDisplay || '',
						practitionerName: a.practitionerName || a.providerDisplay || '',
						providerId: a.providerId || (typeof a.provider === 'string' ? (a.provider as string).replace('Practitioner/', '') : ''),
						locationId: a.locationId || (typeof a.location === 'string' ? (a.location as string).replace('Location/', '') : ''),
						locationName: a.locationName || a.locationDisplay || '',
						status: a.status || 'Scheduled',
					}));
					// Client-side filter: keep appointments whose start date
					// falls inside [startDate, endDate]. Use local-date strings
					// so DST / TZ shifts don't drop edge rows the way an ISO
					// `toISOString().split('T')[0]` slice would.
					const inRange = (a: Appointment): boolean => {
						const raw = a.start || a.startTime;
						if (!raw) { return false; }
						const d = new Date(String(raw));
						if (isNaN(d.getTime())) { return false; }
						const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
						return local >= startDate && local <= endDate;
					};
					const filtered = page.filter(inRange);
					if (append) {
						this.appointments = [...this.appointments, ...filtered];
					} else {
						this.appointments = filtered;
					}
				}
			} catch (err) {
				this.logService.warn('[Schedule] Failed to load appointments:', err);
			}
		};

		const loadStatusOptions = async () => {
			if (this.statusOptions.length > 0) { return; }
			try {
				const res = await this.apiService.fetch('/api/appointments/status-options');
				if (res.ok) {
					const data = await res.json();
					this.statusOptions = data?.data || data || [];
				}
			} catch { /* use fallback */ }
			if (this.statusOptions.length === 0) {
				this.statusOptions = ['Scheduled', 'Confirmed', 'Arrived', 'Checked-in', 'In Room', 'With Provider', 'Completed', 'Re-Scheduled', 'No Show', 'Cancelled'];
			}
			this.statusOptions = this.statusOptions.map((s: unknown): string => {
				if (typeof s === 'string') { return s; }
				if (s && typeof s === 'object') {
					const r = s as Record<string, unknown>;
					return String(r.display || r.label || r.name || r.value || r.code || r.id || '');
				}
				return String(s || '');
			}).filter(s => s.length > 0);
			this.terminalStatuses = new Set(this.statusOptions.filter(s => ['completed', 'no show', 'cancelled', 'fulfilled'].includes(s.toLowerCase())).map(s => s.toLowerCase()));
			if (this.terminalStatuses.size === 0) {
				this.terminalStatuses = new Set(['completed', 'fulfilled', 'cancelled', 'noshow', 'no-show']);
			}
		};

		const loadRooms = async () => {
			if (this.roomOptions.length > 0) { return; }
			try {
				const res = await this.apiService.fetch('/api/rooms');
				if (res.ok) {
					const data = await res.json();
					this.roomOptions = (data?.data || data || []).map((r: Record<string, string>) => r.name || r.id || r);
				}
			} catch { /* use fallback */ }
			if (this.roomOptions.length === 0) {
				this.roomOptions = ['Exam 1', 'Exam 2', 'Exam 3', 'Exam 4', 'Lab', 'Procedure Room', 'Triage'];
			}
		};

		const loadWaitlist = async () => {
			try {
				const res = await this.apiService.fetch('/api/waitlist?page=0&size=20');
				if (res.ok) {
					const data = await res.json();
					this.waitlist = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
				}
			} catch {
				this.waitlist = [];
			}
		};

		try {
			await Promise.all([loadAppts(), loadStatusOptions()]);
		} catch (err) {
			this.logService.warn('[Schedule] Load error:', err);
		}

		// Seed provider dropdown from observed appointments so the Edit dialog's
		// Provider select has something to show even before /api/providers
		// responds.
		const seenProviders = new Set<string>(this._providerOptions);
		for (const apt of this.appointments) {
			const name = apt.providerName || apt.practitionerName;
			if (name) { seenProviders.add(name); }
		}
		this._providerOptions = Array.from(seenProviders).sort();

		this._render();

		// Load secondary data in background (rooms, waitlist, providers) — don't block render
		Promise.all([loadRooms(), loadWaitlist(), this._loadProviders()]).catch(() => { });
	}

	private waitlist: Array<{ id: string; patientName: string; requestedType: string; requestedDate?: string; priority?: number }> = [];
	private showFilter: 'active' | 'completed' | 'all' = 'all';
	// Status filter set via the header dropdown button. Empty string means "all".
	private statusFilter: string = '';

	private statusOptions: string[] = [];
	private roomOptions: string[] = [];
	private terminalStatuses = new Set(['completed', 'fulfilled', 'cancelled', 'noshow', 'no-show']);

	private _getFilteredAppointments(): Appointment[] {
		let filtered = [...this.appointments];

		// Explicit status filter from the header dropdown
		if (this.statusFilter) {
			const target = this.statusFilter.toLowerCase();
			filtered = filtered.filter(a => (a.status || '').toLowerCase() === target);
		}

		// Filter
		if (this.showFilter === 'active') {
			filtered = filtered.filter(a => !this.terminalStatuses.has(a.status?.toLowerCase()));
		} else if (this.showFilter === 'completed') {
			filtered = filtered.filter(a => this.terminalStatuses.has(a.status?.toLowerCase()));
		}

		// Sort by time (upcoming first, no-time at bottom)
		filtered.sort((a, b) => {
			const ta = a.start || a.startTime || '';
			const tb = b.start || b.startTime || '';
			if (!ta && tb) { return 1; }
			if (ta && !tb) { return -1; }
			return ta.localeCompare(tb);
		});

		return filtered;
	}

	private _miniCalendarCollapsed = false;
	private _formViewActive = false;

	private _render(): void {
		DOM.clearNode(this.container);
		if (this._formViewActive) {
			this._renderFormView();
		} else {
			this._renderMiniCalendar();
			this._renderTimeline();
			this._renderWaitlist();
		}
	}

	private _renderFormView(): void {
		const wrap = DOM.append(this.container, DOM.$('div'));
		wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

		// Header
		const hdr = DOM.append(wrap, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;padding:10px 10px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);gap:6px;flex-shrink:0;';

		const title = DOM.append(hdr, DOM.$('span'));
		title.textContent = 'APPOINTMENTS';
		title.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--vscode-descriptionForeground);flex:1;text-transform:uppercase;';

		const calBtn = DOM.append(hdr, DOM.$('div'));
		calBtn.title = 'Calendar view';
		calBtn.textContent = '\u229E';
		calBtn.style.cssText = 'width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;color:var(--vscode-editor-foreground);transition:background 0.1s;flex-shrink:0;';
		calBtn.addEventListener('mouseenter', () => { calBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15))'; });
		calBtn.addEventListener('mouseleave', () => { calBtn.style.background = ''; });
		calBtn.addEventListener('click', () => { this._formViewActive = false; this._render(); });

		// Stats row
		const all = this.appointments;
		const terminal = new Set(['completed', 'fulfilled', 'cancelled', 'noshow', 'no-show', 'canceled']);
		const upcoming = all.filter(a => !terminal.has((a.status || '').toLowerCase())).length;
		const done = all.filter(a => ['completed', 'fulfilled'].includes((a.status || '').toLowerCase())).length;
		const cancelled = all.filter(a => ['cancelled', 'canceled', 'noshow', 'no-show'].includes((a.status || '').toLowerCase())).length;

		const statsRow = DOM.append(wrap, DOM.$('div'));
		statsRow.style.cssText = 'display:flex;gap:10px;padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const stat = (val: number, lbl: string, color: string) => {
			const s = DOM.append(statsRow, DOM.$('div'));
			s.style.cssText = 'display:flex;flex-direction:column;align-items:center;flex:1;';
			const v = DOM.append(s, DOM.$('span'));
			v.textContent = String(val);
			v.style.cssText = `font-size:18px;font-weight:700;color:${color};line-height:1.2;`;
			const l = DOM.append(s, DOM.$('span'));
			l.textContent = lbl;
			l.style.cssText = 'font-size:9px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--vscode-descriptionForeground);';
		};
		stat(all.length, 'TOTAL', 'var(--vscode-editor-foreground)');
		stat(upcoming, 'UPCOMING', '#3b9edd');
		stat(done, 'DONE', '#4caf50');
		stat(cancelled, 'CANCEL', '#f44336');

		// Search
		const searchWrap = DOM.append(wrap, DOM.$('div'));
		searchWrap.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const searchInput = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
		searchInput.placeholder = 'Search patient, provider, type...';
		searchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--vscode-input-border,rgba(128,128,128,0.3));border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font-size:11px;outline:none;';

		// List
		const listEl = DOM.append(wrap, DOM.$('div'));
		listEl.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0;';

		const renderList = (filter: string) => {
			DOM.clearNode(listEl);
			const query = filter.toLowerCase();
			const apts = [...this.appointments].sort((a, b) => {
				const ta = a.start || a.startTime || '';
				const tb = b.start || b.startTime || '';
				return ta.localeCompare(tb);
			}).filter(a => {
				if (!query) { return true; }
				const name = a.patientName || '';
				const prov = a.providerName || a.practitionerName || '';
				const type = getAppointmentType(a);
				return name.toLowerCase().includes(query) || prov.toLowerCase().includes(query) || type.toLowerCase().includes(query);
			});

			for (const apt of apts) {
				const row = DOM.append(listEl, DOM.$('div'));
				row.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.1));cursor:pointer;transition:background 0.1s;';

				// Top row: date · patient name · status chip · room chip · 3-dot
				const topRow = DOM.append(row, DOM.$('div'));
				topRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:nowrap;min-width:0;';

				const startRaw = apt.start || apt.startTime || '';
				let dateStr = '';
				if (startRaw) {
					try {
						const d = new Date(startRaw);
						dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
					} catch { dateStr = startRaw; }
				}
				const dateEl = DOM.append(topRow, DOM.$('span'));
				dateEl.textContent = dateStr;
				dateEl.style.cssText = 'font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);white-space:nowrap;flex-shrink:0;';

				const patientEl = DOM.append(topRow, DOM.$('span'));
				patientEl.textContent = apt.patientName || `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim() || '';
				patientEl.style.cssText = 'font-size:13px;font-weight:700;color:var(--vscode-editor-foreground);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;';

				const status = apt.status || 'Scheduled';
				const statusLower = status.toLowerCase();
				const isTerminal = terminal.has(statusLower);
				const statusColor = statusLower === 'cancelled' || statusLower === 'canceled' || statusLower === 'noshow' || statusLower === 'no-show' ? '#f44336'
					: statusLower === 'completed' || statusLower === 'fulfilled' ? '#22c55e' : '#3b9edd';
				const badge = DOM.append(topRow, DOM.$('span'));
				badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
				badge.style.cssText = `font-size:9px;padding:2px 7px;border-radius:10px;background:${statusColor};color:#fff;font-weight:700;white-space:nowrap;flex-shrink:0;`;

				if (apt.room) {
					const roomBadge = DOM.append(topRow, DOM.$('span'));
					roomBadge.textContent = apt.room;
					roomBadge.style.cssText = 'font-size:9px;padding:2px 7px;border-radius:10px;background:#6366f1;color:#fff;font-weight:700;white-space:nowrap;flex-shrink:0;';
				}

				// 3-dot overflow menu — inline, visible on row hover
				const actionsWrap = createRowActionsContainer(topRow);
				actionsWrap.style.cssText = 'display:flex;flex-shrink:0;align-items:center;opacity:0;transition:opacity 0.1s;';
				createOverflowMenuButton(actionsWrap, (): IOverflowMenuItem[] => {
					const items: IOverflowMenuItem[] = [];
					if (apt.patientId) {
						items.push({ symbol: 'person', label: 'Open Chart', onClick: () => this.commandService.executeCommand('ciyex.openPatientChart', apt.patientId, apt.patientName).catch(() => { }) });
					}
					items.push({ symbol: 'edit', label: 'Edit Appointment', onClick: () => this._openEditDialog(apt) });
					items.push({
						symbol: 'pulse', label: 'Record Vitals', disabled: !apt.encounterId && isTerminal,
						onClick: async () => {
							if (apt.encounterId) {
								this.commandService.executeCommand('ciyex.openEncounter', apt.encounterId, apt.patientName, 'Vitals', 'vitals').catch(() => { });
							} else {
								try {
									const res = await this.apiService.fetch(`/api/appointments/${apt.id}/encounter`, { method: 'POST' });
									if (res.ok) {
										try { const d = await res.json(); const id = (d?.data ?? d)?.id; if (id) { void this.commandService.executeCommand('ciyex.openEncounter', id, apt.patientName, 'Vitals', 'vitals'); } } catch { /* */ }
										await this._loadAndRender();
									}
								} catch { /* */ }
							}
						}
					});
					items.push({
						symbol: 'notebook', label: 'Visit Summary', disabled: !apt.encounterId && isTerminal,
						onClick: async () => {
							if (apt.encounterId) {
								this.commandService.executeCommand('ciyex.openEncounter', apt.encounterId, apt.patientName).catch(() => { });
							} else {
								try {
									const res = await this.apiService.fetch(`/api/appointments/${apt.id}/encounter`, { method: 'POST' });
									if (res.ok) {
										try { const d = await res.json(); const id = (d?.data ?? d)?.id; if (id) { void this.commandService.executeCommand('ciyex.openEncounter', id, apt.patientName); } } catch { /* */ }
										await this._loadAndRender();
									}
								} catch { /* */ }
							}
						}
					});
					if (!isTerminal) {
						items.push({
							symbol: 'file-add', label: 'New Encounter', onClick: async () => {
								try {
									const res = await this.apiService.fetch(`/api/appointments/${apt.id}/encounter`, { method: 'POST' });
									if (res.ok) { await this._loadAndRender(); }
								} catch { /* */ }
							}
						});
					}
					return items;
				});

				// Sub-row: type \u00B7 provider \u00B7 location
				const subRow = DOM.append(row, DOM.$('div'));
				subRow.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;';
				const typeParts: string[] = [];
				const aptType = getAppointmentType(apt);
				if (aptType) { typeParts.push(aptType); }
				const provName = apt.providerName || apt.practitionerName || '';
				if (provName) { typeParts.push(provName); }
				if (apt.locationName) { typeParts.push(apt.locationName); }
				subRow.textContent = typeParts.join(' \u00B7 ');

				row.addEventListener('mouseenter', () => {
					row.style.background = 'var(--vscode-list-hoverBackground,rgba(128,128,128,0.06))';
					actionsWrap.style.opacity = '1';
				});
				row.addEventListener('mouseleave', () => {
					row.style.background = '';
					actionsWrap.style.opacity = '0';
				});
				row.addEventListener('click', (e) => {
					if (actionsWrap.contains(e.target as Node)) { return; }
					if (apt.patientId) { this.commandService.executeCommand('ciyex.openPatientSnapshot', apt.patientId, apt.patientName, apt.id).catch(() => { }); }
				});
			}

			if (apts.length === 0) {
				const empty = DOM.append(listEl, DOM.$('div'));
				empty.textContent = 'No appointments found';
				empty.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
			}
		};

		renderList('');
		searchInput.addEventListener('input', () => renderList(searchInput.value.trim()));
	}

	private _renderMiniCalendar(): void {
		const wrap = DOM.append(this.container, DOM.$('.mini-cal'));
		wrap.style.cssText = 'padding:10px 8px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		// Header row: month name + +/... buttons
		const hdr = DOM.append(wrap, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;margin-bottom:8px;';
		const monthName = DOM.append(hdr, DOM.$('span'));
		const today = this.currentDate;
		monthName.textContent = today.toLocaleDateString('en-US', { month: 'long' });
		monthName.style.cssText = 'font-size:14px;font-weight:600;flex:1;color:var(--vscode-editor-foreground);';
		// Status filter button - shows a dropdown of statuses (Scheduled, Checked-in, ...)
		// to filter the appointments list. Highlighted in blue when a filter is active.
		const filterBtn = DOM.append(hdr, DOM.$('div'));
		const hasActiveFilter = this.statusFilter !== '';
		filterBtn.title = hasActiveFilter ? `Status filter: ${this.statusFilter}` : 'Filter by status';
		filterBtn.textContent = '\u2261';
		filterBtn.style.cssText = `width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:17px;cursor:pointer;color:${hasActiveFilter ? '#0078d4' : 'var(--vscode-editor-foreground)'};transition:background 0.1s;flex-shrink:0;margin-right:2px;${hasActiveFilter ? 'background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15));' : ''}`;
		filterBtn.addEventListener('mouseenter', () => { filterBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15))'; });
		filterBtn.addEventListener('mouseleave', () => { filterBtn.style.background = hasActiveFilter ? 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15))' : ''; });
		filterBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const statuses = this.statusOptions.length ? this.statusOptions : DEFAULT_STATUS_OPTIONS;
			const checkMark = '\u2713 ';
			const dot = '   ';
			const isActive = (s: string) => this.statusFilter.toLowerCase() === s.toLowerCase();
			const actions = [
				{ id: 'all', label: `${this.statusFilter === '' ? checkMark : dot}All Statuses`, tooltip: '', class: '', enabled: true, run: () => { this.statusFilter = ''; this._render(); } },
				...statuses.map(s => ({
					id: s,
					label: `${isActive(s) ? checkMark : dot}${s}`,
					tooltip: '', class: '', enabled: true,
					run: () => { this.statusFilter = s; this._render(); },
				})),
			];
			this.ctxMenuService.showContextMenu({
				getAnchor: () => filterBtn,
				getActions: () => actions,
			});
		});
		// + add button
		const addBtn = DOM.append(hdr, DOM.$('div'));
		addBtn.textContent = '+';
		addBtn.title = 'New Appointment';
		addBtn.style.cssText = 'width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:300;cursor:pointer;color:var(--vscode-editor-foreground);transition:background 0.1s;flex-shrink:0;';
		addBtn.addEventListener('mouseenter', () => { addBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15))'; });
		addBtn.addEventListener('mouseleave', () => { addBtn.style.background = ''; });
		addBtn.addEventListener('click', () => this.commandService.executeCommand('ciyex.showAddAppointmentForm').catch(() => { }));

		// ... actions button
		const moreBtn = DOM.append(hdr, DOM.$('div'));
		moreBtn.textContent = '···';
		moreBtn.title = 'More actions';
		moreBtn.style.cssText = 'width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;color:var(--vscode-editor-foreground);letter-spacing:1px;transition:background 0.1s;margin-left:2px;flex-shrink:0;';
		moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.15))'; });
		moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = ''; });
		moreBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.ctxMenuService.showContextMenu({
				getAnchor: () => moreBtn,
				getActions: () => [
					{ id: 'today', label: 'Go to Today', tooltip: '', class: '', enabled: true, run: () => { this.currentDate = new Date(); this._publishCalendarState(); void this._loadAndRender(); } },
					{ id: 'week', label: 'View Week', tooltip: '', class: '', enabled: true, run: () => { this.viewMode = 'week'; this._publishCalendarState(); void this._loadAndRender(); } },
					{ id: 'month', label: 'View Month', tooltip: '', class: '', enabled: true, run: () => { this.viewMode = 'month'; this._publishCalendarState(); void this._loadAndRender(); } },
					{ id: 'refresh', label: 'Refresh', tooltip: '', class: '', enabled: true, run: () => { void this._loadAndRender(); } },
				],
			});
		});

		// Chevron toggle — collapses/expands the date grid. Rendered in BOTH states
		// (a down caret to reveal when collapsed, an up caret to hide when expanded)
		// so a collapsed calendar can always be brought back. Previously the chevron
		// lived below the grid, so collapsing removed it and left no way to reopen.
		const renderToggleChevron = () => {
			const chevWrap = DOM.append(wrap, DOM.$('div'));
			chevWrap.style.cssText = 'text-align:center;margin-top:6px;cursor:pointer;';
			const chev = DOM.append(chevWrap, DOM.$('span'));
			// allow-any-unicode-next-line
			chev.textContent = this._miniCalendarCollapsed ? '⌄' : '⌃';
			chev.title = this._miniCalendarCollapsed ? 'Show calendar' : 'Hide calendar';
			chev.style.cssText = 'font-size:13px;line-height:1;color:var(--vscode-descriptionForeground);';
			chevWrap.addEventListener('mouseenter', () => { chev.style.color = 'var(--vscode-editor-foreground)'; });
			chevWrap.addEventListener('mouseleave', () => { chev.style.color = 'var(--vscode-descriptionForeground)'; });
			chevWrap.addEventListener('click', () => { this._miniCalendarCollapsed = !this._miniCalendarCollapsed; this._render(); });
		};

		if (this._miniCalendarCollapsed) { renderToggleChevron(); return; }

		// Day-of-week headers
		const dayHdr = DOM.append(wrap, DOM.$('div'));
		dayHdr.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px;';
		for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
			const cell = DOM.append(dayHdr, DOM.$('span'));
			cell.textContent = d;
			cell.style.cssText = 'text-align:center;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);padding:2px 0;';
		}

		// Build 2-week grid: week containing today + next week
		const now = new Date();
		const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const startSunday = new Date(now);
		startSunday.setDate(now.getDate() - now.getDay()); // this Sunday
		const grid = DOM.append(wrap, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:1px;';

		for (let i = 0; i < 14; i++) {
			const d = new Date(startSunday);
			d.setDate(startSunday.getDate() + i);
			const dIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			const isToday = dIso === todayIso;
			const isSelected = dIso === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
			const cell = DOM.append(grid, DOM.$('span'));
			cell.textContent = String(d.getDate());
			cell.style.cssText = `text-align:center;font-size:12px;padding:3px 0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;width:26px;height:26px;margin:1px auto;${isToday ? 'background:#0078d4;color:#fff;font-weight:700;' : isSelected && !isToday ? 'background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-editor-foreground);' : 'color:var(--vscode-editor-foreground);'}`;
			cell.addEventListener('click', () => {
				this.currentDate = new Date(d);
				this.viewMode = 'day';
				this._render();
			});
			cell.addEventListener('mouseenter', () => { if (!isToday) { cell.style.background = 'var(--vscode-toolbar-hoverBackground)'; } });
			cell.addEventListener('mouseleave', () => { if (!isToday) { cell.style.background = isSelected && !isToday ? 'var(--vscode-toolbar-hoverBackground)' : ''; } });
		}

		// Chevron at bottom toggles the calendar closed (and back open).
		renderToggleChevron();
	}

	private _renderTimeline(): void {
		const section = DOM.append(this.container, DOM.$('.timeline-section'));
		section.style.cssText = 'padding:0;overflow-y:auto;';

		const filtered = this._getFilteredAppointments();
		const now = new Date();
		const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

		// Group appointments by local date
		const byDay = new Map<string, Appointment[]>();
		for (const apt of filtered) {
			const raw = apt.start || apt.startTime;
			if (!raw) { continue; }
			const d = new Date(String(raw));
			if (isNaN(d.getTime())) { continue; }
			const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			if (!byDay.has(iso)) { byDay.set(iso, []); }
			byDay.get(iso)!.push(apt);
		}

		// For day view show today; for week/month show the range days
		const { startDate, endDate } = this._getRange();
		const daysToShow: string[] = [];
		const cursor = new Date(startDate + 'T00:00:00');
		const end = new Date(endDate + 'T00:00:00');
		while (cursor <= end) {
			daysToShow.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
			cursor.setDate(cursor.getDate() + 1);
		}

		for (const dayIso of daysToShow) {
			const dayDate = new Date(dayIso + 'T00:00:00');
			const apts = byDay.get(dayIso) || [];

			// Day header label
			const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
			const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
			let dayLabel: string;
			if (dayIso === todayIso) {
				dayLabel = `Today • ${dayDate.toLocaleDateString('en-US', { weekday: 'long' })} • ${dayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
			} else if (dayIso === tomorrowIso) {
				dayLabel = `Tomorrow • ${dayDate.toLocaleDateString('en-US', { weekday: 'long' })} • ${dayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
			} else {
				dayLabel = `${dayDate.toLocaleDateString('en-US', { weekday: 'long' })} • ${dayDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
			}

			const dayHdr = DOM.append(section, DOM.$('div'));
			const isToday = dayIso === todayIso;
			dayHdr.style.cssText = `padding:8px 12px 4px;font-size:12px;font-weight:600;${isToday ? 'color:#0078d4;' : 'color:var(--vscode-foreground);'}`;
			dayHdr.textContent = dayLabel;

			if (apts.length === 0) {
				const empty = DOM.append(section, DOM.$('div'));
				empty.style.cssText = 'padding:4px 12px 10px;font-size:12px;color:var(--vscode-descriptionForeground);';
				empty.textContent = 'No events scheduled';
			} else {
				for (const apt of apts) {
					this._renderTeamsStyleRow(section, apt);
				}
			}
		}
	}

	private _renderTeamsStyleRow(parent: HTMLElement, apt: Appointment): void {
		const row = DOM.append(parent, DOM.$('.apt-row'));
		row.style.cssText = 'display:flex;gap:10px;padding:8px 12px;border-bottom:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.12));cursor:pointer;align-items:flex-start;';

		// Left: time + duration column
		const timeCol = DOM.append(row, DOM.$('div'));
		timeCol.style.cssText = 'width:52px;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;padding-top:2px;';
		const rawTime = apt.start || apt.startTime;
		let timeStr = '';
		let durStr = '';
		if (rawTime) {
			try {
				const d = new Date(String(rawTime));
				if (!isNaN(d.getTime())) {
					timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
					const dur = apt.duration || 30;
					durStr = `${dur}m`;
				}
			} catch { /* */ }
		}
		const timeEl = DOM.append(timeCol, DOM.$('span'));
		timeEl.textContent = timeStr || '--:--';
		timeEl.style.cssText = 'font-size:11px;font-weight:500;color:var(--vscode-editor-foreground);white-space:nowrap;';
		const durEl = DOM.append(timeCol, DOM.$('span'));
		durEl.textContent = durStr;
		durEl.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		// Colored accent bar
		const bar = DOM.append(row, DOM.$('div'));
		const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#f97316';
		bar.style.cssText = `width:3px;border-radius:2px;background:${statusColor};flex-shrink:0;min-height:36px;align-self:stretch;`;

		// Right: content
		const content = DOM.append(row, DOM.$('div'));
		content.style.cssText = 'flex:1;min-width:0;';

		const title = DOM.append(content, DOM.$('div'));
		title.textContent = apt.patientName || `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim() || 'Unknown Patient';
		title.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-editor-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

		const sub = DOM.append(content, DOM.$('div'));
		sub.textContent = getAppointmentType(apt) || (apt.providerName || apt.practitionerName || '');
		sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

		// Status badge
		const statusBadge = DOM.append(content, DOM.$('span'));
		statusBadge.textContent = (apt.status || 'Scheduled').replace(/-/g, ' ');
		statusBadge.style.cssText = `display:inline-block;margin-top:4px;font-size:9px;padding:1px 6px;border-radius:3px;text-transform:capitalize;background:${statusColor}22;color:${statusColor};font-weight:600;letter-spacing:0.3px;`;

		// Provider avatar row
		if (apt.providerName || apt.practitionerName) {
			const avatarRow = DOM.append(content, DOM.$('div'));
			avatarRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px;';
			const av = DOM.append(avatarRow, DOM.$('div'));
			const provName = apt.providerName || apt.practitionerName || '';
			av.textContent = provName.split(' ').map((p: string) => p[0] || '').slice(0, 2).join('').toUpperCase();
			av.style.cssText = `width:18px;height:18px;border-radius:50%;background:${statusColor};color:#fff;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
			av.title = provName;
			const provLabel = DOM.append(avatarRow, DOM.$('span'));
			provLabel.textContent = provName;
			provLabel.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
		}

		// Actions container — hidden until row hover
		const actionsWrap = createRowActionsContainer(row);
		actionsWrap.style.cssText = 'display:flex;gap:2px;flex-shrink:0;align-items:center;opacity:0;transition:opacity 0.1s;padding-top:2px;';

		createOverflowMenuButton(actionsWrap, (): IOverflowMenuItem[] => {
			const status = apt.status?.toLowerCase() || '';
			const isTerminal = this.terminalStatuses.has(status);
			const items: IOverflowMenuItem[] = [];

			// Status progression
			if (!isTerminal) {
				if (status !== 'arrived' && status !== 'checked-in' && status !== 'in-room' && status !== 'with-provider') {
					items.push({ symbol: '\u{1F6B6}', label: 'Mark Arrived', onClick: () => this._changeStatus(apt, 'Arrived') });
				}
				if (status !== 'checked-in' && status !== 'in-room' && status !== 'with-provider') {
					items.push({ symbol: '\u{2713}', label: 'Check In', onClick: () => this._changeStatus(apt, 'Checked-in') });
				}
				if (status === 'checked-in' || status === 'arrived') {
					items.push({ symbol: '\u{1F6AA}', label: 'Move to Room', onClick: () => this._changeStatus(apt, 'In Room') });
				}
				if (status !== 'with-provider') {
					items.push({ symbol: '\u{1FA7A}', label: 'With Provider', onClick: () => this._changeStatus(apt, 'With Provider') });
				}
				items.push({ symbol: '\u{2714}', label: 'Mark Completed', onClick: () => this._changeStatus(apt, 'Completed') });
				items.push({ separator: true });
			}

			// Navigation
			if (apt.patientId) {
				items.push({ symbol: '\u{1F5C2}', label: 'Open Patient Chart', onClick: () => this.commandService.executeCommand('ciyex.openPatientChart', apt.patientId, apt.patientName).catch(() => { }) });
			}
			items.push({ symbol: '\u{1F4DD}', label: 'Edit Appointment', onClick: () => this._openEditDialog(apt) });
			if (apt.encounterId) {
				items.push({ symbol: '\u{1F4DD}', label: 'Open Encounter', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', apt.encounterId) });
				items.push({ symbol: '\u{1FA7A}', label: 'Record Vitals', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', apt.encounterId, apt.patientName, 'Vitals', 'vitals') });
			} else if (!isTerminal) {
				items.push({
					symbol: '\u{1F4C3}', label: 'Create Encounter', onClick: async () => {
						try {
							const res = await this.apiService.fetch(`/api/appointments/${apt.id}/encounter`, { method: 'POST' });
							let newEncounterId: string | undefined;
							if (res.ok) {
								try {
									const data = await res.json();
									const payload = (data?.data ?? data) as Record<string, unknown>;
									newEncounterId = (payload?.id || payload?.encounterId) as string | undefined;
								} catch { /* response may be empty — fall through to reload */ }
							}
							await this._loadAndRender();
							if (newEncounterId && apt.patientId) {
								void this.commandService.executeCommand('ciyex.openEncounter', apt.patientId, String(newEncounterId), apt.patientName);
							}
						} catch { /* */ }
					}
				});
			}

			// Telehealth
			const vt = (getAppointmentType(apt) || apt.visitType || '').toLowerCase();
			const isTele = vt.includes('telehealth') || vt.includes('virtual') || vt.includes('video');
			if (isTele && this.installationsService.isInstalled('ciyex-telehealth')) {
				items.push({ symbol: '\u{1F4F9}', label: 'Video Call', onClick: () => this.commandService.executeCommand('ciyex.openTelehealth', apt.id, apt.patientName, apt.providerName || apt.practitionerName) });
			}

			// Destructive actions
			if (!isTerminal) {
				items.push({ separator: true });
				items.push({ symbol: '\u{1F6B7}', label: 'No Show', onClick: () => this._changeStatus(apt, 'No Show') });
				items.push({ symbol: '\u{1F5D1}', label: 'Cancel Appointment', onClick: () => this._changeStatus(apt, 'Cancelled') });
			}

			return items;
		});

		// Show/hide actions on row hover; click row to open chart (not when clicking actions)
		row.addEventListener('mouseenter', () => {
			row.style.background = 'var(--vscode-list-hoverBackground,rgba(128,128,128,0.06))';
			actionsWrap.style.opacity = '1';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = '';
			actionsWrap.style.opacity = '0';
		});
		row.addEventListener('click', (e) => {
			if (actionsWrap.contains(e.target as Node)) { return; }
			if (apt.patientId) { this.commandService.executeCommand('ciyex.openPatientSnapshot', apt.patientId, apt.patientName, apt.id).catch(() => { }); }
		});
	}

	private _openEditDialog(apt: Appointment): void {
		const startIso = (apt.start || apt.startTime || '') as string;
		const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(startIso);
		const initialDate = m ? m[1] : '';
		const initialTime = m ? m[2] : '';

		// Build option lists once so the dropdowns render correctly even when
		// the upstream data has FHIR CodeableConcept objects in the visit-type
		// or status fields (which used to render as "[object Object]").
		const visitTypeOptions = SCHEDULE_VISIT_TYPES.map(t => ({ value: t, label: t }));
		const currentVisitType = getAppointmentType(apt);
		if (currentVisitType && !visitTypeOptions.find(o => o.value === currentVisitType)) {
			visitTypeOptions.unshift({ value: currentVisitType, label: currentVisitType });
		}
		const statusOptions = (this.statusOptions.length ? this.statusOptions : DEFAULT_STATUS_OPTIONS).map(s => ({ value: s, label: s }));
		const initialStatus = (typeof apt.status === 'string' ? apt.status : '') || 'Scheduled';
		if (initialStatus && !statusOptions.find(o => o.value.toLowerCase() === initialStatus.toLowerCase())) {
			statusOptions.unshift({ value: initialStatus, label: initialStatus });
		}
		const providerOptions = [
			{ value: '', label: 'Unassigned' },
			...this._providerOptions.map(p => ({ value: p, label: p })),
		];
		const initialProvider = apt.providerName || apt.practitionerName || '';
		if (initialProvider && !providerOptions.find(o => o.value === initialProvider)) {
			providerOptions.push({ value: initialProvider, label: initialProvider });
		}

		openRecordEditDialog({
			title: `Edit Appointment — ${apt.patientName || 'Appointment'}`,
			themeAnchor: this.container,
			fields: [
				{ key: 'appointmentDate', label: 'Date', kind: 'date', required: true, widthPct: 50 },
				{ key: 'appointmentTime', label: 'Start Time', kind: 'time', widthPct: 50 },
				{ key: 'appointmentType', label: 'Visit Type', kind: 'select', widthPct: 50, options: visitTypeOptions },
				{ key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: statusOptions },
				{ key: 'room', label: 'Room', kind: 'select', widthPct: 50, options: [{ value: '', label: 'Unassigned' }, ...this.roomOptions.map(r => ({ value: r, label: r }))] },
				{ key: 'providerName', label: 'Provider', kind: 'select', widthPct: 50, options: providerOptions },
			],
			values: {
				appointmentDate: initialDate,
				appointmentTime: initialTime,
				appointmentType: currentVisitType,
				status: initialStatus,
				room: apt.room || '',
				providerName: initialProvider,
			},
			onSave: async (next) => {
				const startTime = next.appointmentTime ? `${next.appointmentDate}T${next.appointmentTime}:00` : startIso;
				// Update both `start` and `startTime`; the FHIR-normalized appointments
				// API may read either, and leaving one stale caused the time field to
				// "revert" on subsequent loads.
				const payload = {
					...apt,
					start: startTime,
					startTime,
					status: next.status,
					appointmentType: next.appointmentType,
					visitType: next.appointmentType,
					room: next.room,
					providerName: next.providerName,
				};
				const res = await this.apiService.fetch(`/api/appointments/${apt.id}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				await this._loadAndRender();
			},
		});
	}

	/** Cached provider name list — populated from /api/providers and
	 *  augmented with provider names observed on the loaded appointments. */
	private _providerOptions: string[] = [];
	private async _loadProviders(): Promise<void> {
		try {
			const urls = ['/api/providers/organization?page=0&size=100', '/api/fhir-resource/providers?page=0&size=100', '/api/providers?page=0&size=100'];
			for (const url of urls) {
				try {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { continue; }
					const data = await res.json();
					const list = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
					const names = new Set<string>();
					for (const p of list) {
						const r = p as Record<string, unknown>;
						const name = (r.name || r.fullName || r.displayName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || '') as string;
						if (name) { names.add(name); }
					}
					if (names.size > 0) {
						this._providerOptions = Array.from(names).sort();
						return;
					}
				} catch { /* try next */ }
			}
		} catch { /* best effort */ }
	}

	private async _changeStatus(apt: Appointment, newStatus: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${apt.id}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
		} catch {
			try { await this.apiService.fetch(`/api/appointments/${apt.id}`, { method: 'PUT', body: JSON.stringify({ ...apt, status: newStatus }) }); } catch { /* */ }
		}
		await this._loadAndRender();
	}

	private _renderWaitlist(): void {
		if (this.waitlist.length === 0) { return; }

		const section = DOM.append(this.container, DOM.$('.waitlist-section'));
		section.style.cssText = 'padding:8px 0;border-top:1px solid var(--vscode-editorWidget-border);';

		const header = DOM.append(section, DOM.$('.section-header'));
		header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:4px;';
		header.textContent = `Waitlist (${this.waitlist.length})`;

		for (const item of this.waitlist) {
			const row = DOM.append(section, DOM.$('.waitlist-row'));
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;cursor:pointer;border-left:3px solid #f59e0b;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const info = DOM.append(row, DOM.$('.info'));
			info.style.cssText = 'flex:1;min-width:0;';

			const name = DOM.append(info, DOM.$('.name'));
			name.textContent = item.patientName || 'Unknown';
			name.style.cssText = 'font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

			const type = DOM.append(info, DOM.$('.type'));
			type.textContent = item.requestedType || '';
			type.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			if (item.priority) {
				const pri = DOM.append(row, DOM.$('span'));
				pri.textContent = `P${item.priority}`;
				pri.style.cssText = 'font-size:9px;padding:1px 4px;border-radius:2px;background:rgba(245,158,11,0.15);color:#f59e0b;font-weight:600;';
			}
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.container) {
			this.container.style.height = `${height}px`;
		}
		// Calculate how many appointments fit: ~35px per row, minus ~180px for header/stats/upcoming
		const availableHeight = Math.max(height - 180, 200);
		const rowHeight = 35;
		const newPageSize = Math.max(10, Math.floor(availableHeight / rowHeight));
		if (newPageSize !== this.pageSize && this.appointments.length === 0) {
			this.pageSize = newPageSize;
		}
	}

	override dispose(): void {
		if (this.refreshTimer) {
			DOM.getActiveWindow().clearInterval(this.refreshTimer);
		}
		super.dispose();
	}
}
