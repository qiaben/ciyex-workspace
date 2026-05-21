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
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexInstallationsService } from './ciyexInstallationsService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import * as DOM from '../../../../base/browser/dom.js';
import { createOverflowMenuButton, createRowActionsContainer, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE, IOverflowMenuItem } from './sidebarActions.js';

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
}

function getAppointmentType(apt: Appointment): string {
	const t = apt.appointmentType;
	if (typeof t === 'string') { return t; }
	if (t && typeof t === 'object') { return t.text || t.coding?.[0]?.display || t.coding?.[0]?.code || ''; }
	return apt.type || '';
}

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
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexInstallationsService private readonly installationsService: ICiyexInstallationsService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
		@ILogService private readonly logService: ILogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
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
				this.currentPage = 0;
				this.totalAppointments = 0;
			} else if (state === CiyexAuthState.Authenticated) {
				this.appointments = [];
				this.statusOptions = [];
				this.roomOptions = [];
				this.waitlist = [];
				this.currentPage = 0;
				this.totalAppointments = 0;
				if (this.container) {
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

	private currentPage = 0;
	private pageSize = 25;
	private totalAppointments = 0;
	private hasMore = false;
	private visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;

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
					this.totalAppointments = this.appointments.length;
					this.hasMore = false;
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
			this.statusOptions = this.statusOptions.map(s => typeof s === 'string' ? s : String(s || '')).filter(s => s.length > 0);
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

		this._render();

		// Load secondary data in background (rooms, waitlist) — don't block render
		Promise.all([loadRooms(), loadWaitlist()]).catch(() => { });
	}

	private waitlist: Array<{ id: string; patientName: string; requestedType: string; requestedDate?: string; priority?: number }> = [];
	private showFilter: 'active' | 'completed' | 'all' = 'active';

	private statusOptions: string[] = [];
	private roomOptions: string[] = [];
	private terminalStatuses = new Set(['completed', 'fulfilled', 'cancelled', 'noshow', 'no-show']);

	private _getFilteredAppointments(): Appointment[] {
		let filtered = [...this.appointments];

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

	private _render(): void {
		DOM.clearNode(this.container);

		// -- Quick Stats Bar (very top) --
		this._renderStats();

		// -- Filter Bar --
		this._renderFilterBar();

		// -- Today's Timeline --
		this._renderTimeline();

		// -- Load More --
		if (this.hasMore) {
			this._renderLoadMore();
		}

		// -- Waitlist --
		this._renderWaitlist();
	}

	private _renderStats(): void {
		const stats = DOM.append(this.container, DOM.$('.stats-bar'));
		stats.style.cssText = 'display:flex;gap:2px;padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		const total = this.appointments.length;
		const completed = this.appointments.filter(a => ['fulfilled', 'completed', 'checked-out'].includes(a.status?.toLowerCase())).length;
		const noShows = this.appointments.filter(a => ['noshow', 'no-show'].includes(a.status?.toLowerCase())).length;
		const remaining = total - completed - noShows;

		this._statBadge(stats, String(total), 'Total', 'var(--vscode-foreground)');
		this._statBadge(stats, String(completed), 'Done', '#22c55e');
		this._statBadge(stats, String(remaining), 'Left', '#3b82f6');
		if (noShows > 0) {
			this._statBadge(stats, String(noShows), 'No-Show', '#ef4444');
		}

		// Average wait time (estimate from arrived appointments)
		const arrived = this.appointments.filter(a => {
			const s = a.status?.toLowerCase();
			return s === 'arrived' || s === 'checked-in' || s === 'in-room';
		});
		if (arrived.length > 0) {
			const avgWait = Math.round(arrived.length * 8); // estimate 8 min per waiting patient
			this._statBadge(stats, `${avgWait}m`, 'Avg Wait', '#f59e0b');
		}
	}

	private _statBadge(parent: HTMLElement, value: string, label: string, color: string): void {
		const badge = DOM.append(parent, DOM.$('.stat'));
		badge.style.cssText = `flex:1;text-align:center;padding:4px 2px;border-radius:4px;background:rgba(128,128,128,0.08);`;
		const val = DOM.append(badge, DOM.$('div'));
		val.textContent = value;
		val.style.cssText = `font-size:16px;font-weight:700;color:${color};line-height:1.2;`;
		const lbl = DOM.append(badge, DOM.$('div'));
		lbl.textContent = label;
		lbl.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;';
	}

	private _renderFilterBar(): void {
		const bar = DOM.append(this.container, DOM.$('.filter-bar'));
		bar.style.cssText = 'display:flex;gap:2px;padding:4px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		for (const f of ['active', 'completed', 'all'] as const) {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = f === 'active' ? 'Active' : f === 'completed' ? 'Done' : 'All';
			const isActive = this.showFilter === f;
			btn.style.cssText = `flex:1;padding:3px;border:none;border-radius:3px;cursor:pointer;font-size:10px;font-weight:500;${isActive ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);' : 'background:transparent;color:var(--vscode-descriptionForeground);'}`;
			btn.addEventListener('click', () => { this.showFilter = f; this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._render(); });
		}
	}

	private _renderTimeline(): void {
		const section = DOM.append(this.container, DOM.$('.timeline-section'));
		section.style.cssText = 'padding:4px 0;';

		const filtered = this._getFilteredAppointments();

		// Section header — reflects the calendar editor's current view + range
		// instead of always saying "today" so users can tell at a glance which
		// span the sidebar list represents (Day / Week of MMM dd-dd / MMM YYYY).
		const header = DOM.append(section, DOM.$('.section-header'));
		header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:6px;';
		const headerText = DOM.append(header, DOM.$('span'));
		headerText.textContent = this._getRange().rangeLabel;
		headerText.style.cssText = 'flex:1;';
		const modeBadge = DOM.append(header, DOM.$('span'));
		modeBadge.textContent = this.viewMode;
		modeBadge.style.cssText = 'padding:1px 6px;border-radius:8px;background:rgba(128,128,128,0.18);color:var(--vscode-foreground);font-size:9px;letter-spacing:0.4px;';
		const countText = DOM.append(header, DOM.$('span'));
		countText.textContent = `${filtered.length} appts`;
		countText.style.cssText = 'font-size:10px;';

		if (filtered.length === 0) {
			const empty = DOM.append(section, DOM.$('.empty'));
			empty.style.cssText = 'padding:12px 10px;color:var(--vscode-descriptionForeground);text-align:center;font-size:12px;';
			empty.textContent = this.showFilter === 'active' ? 'No active appointments' : this.showFilter === 'completed' ? 'No completed appointments' : 'No appointments';
			return;
		}

		const visible = Math.min(this.visibleCount, filtered.length);
		for (let i = 0; i < visible; i++) {
			this._renderAppointmentRow(section, filtered[i]);
		}
		renderShowMoreFooter(
			section,
			{ visibleCount: visible, totalCount: filtered.length },
			(next) => { this.visibleCount = next; this._render(); },
			() => { this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._render(); },
		);
	}

	private async _changeStatus(apt: Appointment, newStatus: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${apt.id}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
		} catch {
			try { await this.apiService.fetch(`/api/appointments/${apt.id}`, { method: 'PUT', body: JSON.stringify({ ...apt, status: newStatus }) }); } catch { /* */ }
		}
		await this._loadAndRender();
	}

	private async _assignRoom(apt: Appointment, room: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${apt.id}/room`, { method: 'PUT', body: JSON.stringify({ room }) });
		} catch {
			try { await this.apiService.fetch(`/api/appointments/${apt.id}`, { method: 'PUT', body: JSON.stringify({ ...apt, room }) }); } catch { /* */ }
		}
		await this._loadAndRender();
	}

	private _renderAppointmentRow(parent: HTMLElement, apt: Appointment): void {
		const row = DOM.append(parent, DOM.$('.apt-row'));
		row.style.cssText = 'padding:6px 10px;border-left:3px solid transparent;border-bottom:1px solid rgba(128,128,128,0.06);';

		const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#6b7280';
		row.style.borderLeftColor = statusColor;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		// Top line: time + name + status badge
		const topLine = DOM.append(row, DOM.$('.top'));
		topLine.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px;';

		const time = DOM.append(topLine, DOM.$('span'));
		time.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-foreground);width:50px;flex-shrink:0;';
		// Try direct date parsing
		const rawTime = apt.start || apt.startTime;
		if (rawTime && typeof rawTime === 'string') {
			try {
				const d = new Date(rawTime);
				if (!isNaN(d.getTime())) {
					time.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
				} else {
					time.textContent = '--:--';
				}
			} catch {
				time.textContent = '--:--';
			}
		} else {
			time.textContent = '--:--';
		}

		const name = DOM.append(topLine, DOM.$('span'));
		name.textContent = apt.patientName || `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim() || 'Unknown';
		name.style.cssText = 'flex:1;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

		// Status badge (clickable - advances to next status)
		const badge = DOM.append(topLine, DOM.$('span'));
		badge.textContent = (apt.status || 'scheduled').replace(/-/g, ' ');
		badge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:3px;text-transform:capitalize;cursor:pointer;background:${statusColor}22;color:${statusColor};font-weight:500;white-space:nowrap;`;
		badge.title = 'Click to advance status';
		// Find next status in workflow
		const currentIdx = this.statusOptions.findIndex(s => s.toLowerCase() === apt.status?.toLowerCase());
		const nextStatus = currentIdx >= 0 && currentIdx < this.statusOptions.length - 1 ? this.statusOptions[currentIdx + 1] : null;
		if (nextStatus && !this.terminalStatuses.has(apt.status?.toLowerCase())) {
			badge.addEventListener('click', () => this._changeStatus(apt, nextStatus));
		}

		// Middle line: type + provider + room
		const midLine = DOM.append(row, DOM.$('.mid'));
		midLine.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';

		const typeEl = DOM.append(midLine, DOM.$('span'));
		typeEl.textContent = getAppointmentType(apt);

		if (apt.providerName || apt.practitionerName) {
			DOM.append(midLine, DOM.$('span')).textContent = '\u00B7';
			const provEl = DOM.append(midLine, DOM.$('span'));
			provEl.textContent = apt.providerName || apt.practitionerName || '';
		}

		// Room badge (clickable to assign)
		const roomBadge = DOM.append(midLine, DOM.$('span'));
		roomBadge.style.cssText = `margin-left:auto;font-size:9px;padding:1px 5px;border-radius:3px;cursor:pointer;${apt.room ? 'background:rgba(99,102,241,0.15);color:#818cf8;' : 'background:rgba(128,128,128,0.1);color:var(--vscode-descriptionForeground);'}`;
		roomBadge.textContent = apt.room || 'Room';
		roomBadge.title = 'Click to assign room';
		roomBadge.addEventListener('click', async () => {
			const items = this.roomOptions.map(r => ({ label: r }));
			const pick = await this.quickInputService.pick(items, { placeHolder: 'Assign room' });
			if (pick) { await this._assignRoom(apt, pick.label); }
		});

		// Actions live behind a Teams-style \u22ef overflow menu \u2014 opens a labelled
		// popup with one icon + name per action.
		const actions = createRowActionsContainer(row);
		actions.style.marginLeft = 'auto';
		createOverflowMenuButton(actions, (): IOverflowMenuItem[] => {
			const items: IOverflowMenuItem[] = [];
			const status = apt.status?.toLowerCase();
			const isTerminal = this.terminalStatuses.has(status);

			if (!isTerminal && status !== 'checked-in' && status !== 'in-room' && status !== 'with-provider') {
				items.push({ symbol: '\u2713', label: 'Check In', onClick: () => this._changeStatus(apt, 'Checked-in') });
			}
			items.push({
				// allow-any-unicode-next-line
				symbol: '\u{1F4CB}', label: 'Open Patient Chart', onClick: () => {
					if (apt.patientId) { this.commandService.executeCommand('ciyex.openPatientChart', apt.patientId); }
				},
			});
			if (apt.encounterId) {
				items.push({ symbol: '\u2764', label: 'Record Vitals', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', apt.encounterId) });
			}
			if (!apt.encounterId && !isTerminal) {
				items.push({
					symbol: '\u2795', label: 'Create Encounter', onClick: async () => {
						try {
							await this.apiService.fetch(`/api/appointments/${apt.id}/encounter`, { method: 'POST' });
							await this._loadAndRender();
						} catch { /* */ }
					},
				});
			}
			const vt = (getAppointmentType(apt) || apt.visitType || '').toLowerCase();
			const isTele = vt.includes('telehealth') || vt.includes('virtual') || vt.includes('video');
			if (isTele && this.installationsService.isInstalled('ciyex-telehealth')) {
				items.push({
					// allow-any-unicode-next-line
					symbol: '\u{1F4F9}', label: 'Video Call', onClick: () => {
						this.commandService.executeCommand('ciyex.openTelehealth', apt.id, apt.patientName, apt.providerName || apt.practitionerName);
					},
				});
			}
			if (!isTerminal) {
				items.push({ separator: true });
				items.push({ symbol: '\u2716', label: 'No Show', onClick: () => this._changeStatus(apt, 'No Show') });
			}
			return items;
		});
	}

	private _renderLoadMore(): void {
		const loadMore = DOM.append(this.container, DOM.$('.load-more'));
		loadMore.style.cssText = 'padding:8px 10px;text-align:center;border-top:1px solid var(--vscode-editorWidget-border);';

		const btn = DOM.append(loadMore, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = `Load More (${this.appointments.length} of ${this.totalAppointments})`;
		btn.style.cssText = 'padding:4px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;width:100%;';
		btn.addEventListener('click', async () => {
			this.currentPage++;
			btn.textContent = 'Loading...';
			btn.disabled = true;
			await this._loadAndRender(true);
		});
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
