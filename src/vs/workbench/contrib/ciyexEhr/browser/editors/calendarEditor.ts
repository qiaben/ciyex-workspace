/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../../ciyexAuth/browser/ciyexAuthService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { BaseCiyexInput } from './ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

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

function getAppointmentType(apt: Appointment): string {
	const t = apt.appointmentType;
	if (typeof t === 'string') { return t; }
	if (t && typeof t === 'object') { return t.text || t.coding?.[0]?.display || t.coding?.[0]?.code || ''; }
	return apt.type || '';
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

export class CalendarEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexCalendar';

	private root!: HTMLElement;
	private gridContainer!: HTMLElement;
	private headerBar!: HTMLElement;
	private currentDate = new Date();
	private viewMode: 'day' | 'week' | 'month' = 'day';
	private appointments: Appointment[] = [];
	private providerFilter = '';
	private locationFilter = '';
	private providers: Array<{ id: string; name: string }> = [];
	private locations: Array<{ id: string; name: string }> = [];
	private scheduleBlocks: Array<{ providerId?: string; status: string; startTime: string; endTime: string; recurrence?: { frequency: string; byWeekday?: string[] }; serviceType?: string }> = [];

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
	) {
		super(CalendarEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-calendar-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Mark body so titlebar search hides on calendar (CSS rule in ehrTitlebar.css)
		DOM.getActiveWindow().document.body.classList.add('ehr-on-calendar');

		// Header bar
		this.headerBar = DOM.append(this.root, DOM.$('.calendar-header'));
		this.headerBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		// Grid container — scroll without showing native scrollbars
		this.gridContainer = DOM.append(this.root, DOM.$('.calendar-grid'));
		this.gridContainer.style.cssText = 'flex:1;overflow:auto;position:relative;scrollbar-width:none;';

		// Render full UI skeleton immediately
		this._renderHeader();
		this._renderGrid();

		// Retry loading every 2s until providers appear (no cap)
		const win = DOM.getActiveWindow();
		const retryTimer = win.setInterval(() => {
			if (this.providers.length > 0) {
				win.clearInterval(retryTimer);
				return;
			}
			this._loadAndRender();
		}, 2000);

		// Also reload on auth state changes
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.Authenticated) {
				this._loadAndRender();
			}
		}));
		// Note: setInput() also calls _loadAndRender() on editor open
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		const defaultView = this.configService.getValue<string>('ciyex.calendar.defaultView') || 'day';
		this.viewMode = defaultView === 'week' ? 'week' : defaultView === 'month' ? 'month' : 'day';
		await this._loadAndRender();
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
			let provLoc = '';
			if (this.providerFilter) { provLoc += `&providerId=${this.providerFilter}`; }
			if (this.locationFilter) { provLoc += `&locationId=${this.locationFilter}`; }

			// Load appointments, providers, and locations in PARALLEL
			const loadAppts = async () => {
				try {
					const res = await this.apiService.fetch(`/api/fhir-resource/appointments?page=0&size=200${provLoc}`);
					if (res.ok) {
						const data = await res.json();
						const raw = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
						// Normalize FHIR field names
						this.appointments = raw.map((a: Record<string, unknown>) => ({
							...a,
							patientName: a.patientName || a.patientDisplay || '',
							providerName: a.providerName || a.providerDisplay || '',
							practitionerName: a.practitionerName || a.providerDisplay || '',
							providerId: a.providerId || (typeof a.provider === 'string' ? (a.provider as string).replace('Practitioner/', '') : ''),
							locationId: a.locationId || (typeof a.location === 'string' ? (a.location as string).replace('Location/', '') : ''),
							locationName: a.locationName || a.locationDisplay || '',
							status: a.status || 'Scheduled',
						})) as Appointment[];
					}
				} catch { /* */ }
				if (!this.appointments) { this.appointments = []; }
			};

			const loadProviders = async () => {
				if (this.providers.length > 0) { return; }
				const providerUrls = ['/api/fhir-resource/providers?page=0&size=100', '/api/providers?page=0&size=100'];
				for (const url of providerUrls) {
					try {
						const res = await this.apiService.fetch(url);
						if (res.ok) {
							const data = await res.json();
							const list = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
							if (list.length > 0) {
								this.providers = list.map((p: Record<string, string>) => ({
									id: p.id || p.fhirId || p.username || '',
									name: `${p['identification.prefix'] || ''} ${p['identification.firstName'] || p.firstName || ''} ${p['identification.lastName'] || p.lastName || ''}`.trim() || p.name || p.fullName || p.username || p.id,
								})).filter((p: { id: string; name: string }) => p.name && p.name.trim().length > 0);
								break;
							}
						}
					} catch { /* try next */ }
				}
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

			// Extract providers from appointments as fallback
			if (this.providers.length === 0 && this.appointments.length > 0) {
				const provMap = new Map<string, string>();
				for (const a of this.appointments) {
					const pName = a.providerName || a.practitionerName || '';
					if (pName) { provMap.set(a.providerId || pName, pName); }
				}
				this.providers = Array.from(provMap.entries()).map(([id, name]) => ({ id, name }));
			}

			// Load provider schedule blocks (availability) — only when filtered
			if (this.providerFilter) {
				try {
					const res = await this.apiService.fetch(`/api/providers/${this.providerFilter}/availability`);
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
		if (this.providerFilter) {
			filtered = filtered.filter(a =>
				a.providerId === this.providerFilter ||
				a.providerName === this.providerFilter ||
				a.practitionerName === this.providerFilter
			);
		}
		if (this.locationFilter) {
			filtered = filtered.filter(a =>
				a.locationId === this.locationFilter ||
				a.locationName === this.locationFilter
			);
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

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);

		// Nav buttons — Today | [Prev|Next] | Date (no longer between arrows)
		const rerender = () => { this._headerRendered = false; this._renderHeader(); this._renderGrid(); };
		const todayBtn = this._btn(this.headerBar, 'Today', () => { this.currentDate = new Date(); rerender(); });
		todayBtn.style.fontWeight = '600';
		const navGroup = DOM.append(this.headerBar, DOM.$('.cal-nav-group'));
		navGroup.style.cssText = 'display:flex;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;overflow:hidden;';
		const prevBtn = this._btn(navGroup, '\u25C0', () => { this._navigate(-1); });
		prevBtn.title = 'Previous';
		prevBtn.style.borderRadius = '0';
		prevBtn.style.borderRight = '1px solid var(--vscode-editorWidget-border)';
		const nextBtn = this._btn(navGroup, '\u25B6', () => { this._navigate(1); });
		nextBtn.title = 'Next';
		nextBtn.style.borderRadius = '0';

		// Date label — left-aligned, no longer between arrows
		const label = DOM.append(this.headerBar, DOM.$('span'));
		label.style.cssText = 'font-size:15px;font-weight:600;flex:1;';
		if (this.viewMode === 'day') {
			label.textContent = this.currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
		} else if (this.viewMode === 'month') {
			label.textContent = this.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
		} else {
			const { startDate, endDate } = this._getDateRange();
			const s = new Date(startDate + 'T00:00:00');
			const e = new Date(endDate + 'T00:00:00');
			label.textContent = `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
		}

		// View toggles
		const viewGroup = DOM.append(this.headerBar, DOM.$('.view-group'));
		viewGroup.style.cssText = 'display:flex;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;overflow:hidden;';
		for (const mode of ['day', 'week', 'month'] as const) {
			const btn = DOM.append(viewGroup, DOM.$('button'));
			btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
			btn.style.cssText = `padding:3px 10px;border:none;cursor:pointer;font-size:11px;${this.viewMode === mode ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);' : 'background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);'}`;
			btn.addEventListener('click', () => { this.viewMode = mode; this._headerRendered = false; this._renderHeader(); this._renderGrid(); });
		}

		// Provider filter — searchable dropdown
		this._buildSearchableFilter(this.headerBar, 'All Providers', this.providers, this.providerFilter, (val) => {
			this.providerFilter = val; this._updateHeaderCount(); this._renderGrid();
		});

		// Location filter — searchable dropdown
		this._buildSearchableFilter(this.headerBar, 'All Locations', this.locations, this.locationFilter, (val) => {
			this.locationFilter = val; this._updateHeaderCount(); this._renderGrid();
		});

		// Right-side action icons group
		const actionsGroup = DOM.append(this.headerBar, DOM.$('.actions-group'));
		actionsGroup.style.cssText = 'display:flex;gap:4px;margin-left:auto;align-items:center;';

		const iconBtn = (parent: HTMLElement, symbol: string, title: string, primary: boolean, onClick: () => void) => {
			const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = symbol;
			btn.title = title;
			btn.style.cssText = `padding:4px 10px;border:none;border-radius:4px;cursor:pointer;font-size:14px;${primary ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-weight:600;' : 'background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);'}`;
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

		// Calendar (Find Slot)
		iconBtn(actionsGroup, '\u{1F4C5}', 'Find Available Slot', false, () => { this._findAvailableSlot(); });

		// TV Display (Flow Board)
		iconBtn(actionsGroup, '\u{1F4FA}', 'TV Display (Flow Board)', false, () => { this._openFlowBoard(); });

		// Stats
		iconBtn(actionsGroup, '\u{1F4CA}', 'Stats', false, () => { this._showStats(); });

		// Refresh
		iconBtn(actionsGroup, '\u21BB', 'Refresh', false, () => { this.providers = []; this.locations = []; this._headerRendered = false; this._loadAndRender(); });

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

		const startHour = this.configService.getValue<number>('ciyex.calendar.startHour') ?? 0;
		const endHour = this.configService.getValue<number>('ciyex.calendar.endHour') ?? 24;
		const slotDuration = this.configService.getValue<number>('ciyex.calendar.slotDuration') ?? 30;
		const slotHeight = 20; // px per slot
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
		table.style.cssText = 'display:grid;grid-template-columns:50px ' + days.map(() => '1fr').join(' ') + ';min-width:100%;';

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

				// Time label
				const timeCell = DOM.append(table, DOM.$('.cal-time'));
				timeCell.style.cssText = `height:${slotHeight}px;border-right:1px solid var(--vscode-editorWidget-border);padding:0 4px;font-size:10px;color:var(--vscode-descriptionForeground);text-align:right;line-height:${slotHeight}px;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : ''}`;
				if (isHourStart) {
					const h = hour > 12 ? hour - 12 : hour;
					const ampm = hour >= 12 ? 'PM' : 'AM';
					timeCell.textContent = `${h}${ampm}`;
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
					cell.style.cssText = `height:${slotHeight}px;border-right:1px solid rgba(128,128,128,0.1);position:relative;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : 'border-top:1px solid rgba(128,128,128,0.05);'}${isBlocked ? 'background:rgba(128,128,128,0.06);' : ''}`;
					if (!isBlocked) {
						cell.addEventListener('mouseenter', () => { cell.style.background = 'rgba(128,128,128,0.04)'; });
						cell.addEventListener('mouseleave', () => { cell.style.background = ''; });
					}

					// Click to create appointment
					const dayStr = localDateStr(days[di]);
					const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
					cell.addEventListener('click', () => this._createAppointment(dayStr, timeStr));

					// O(1) lookup from pre-built index
					const slotAppts = weekIndex.get(`${dayStr}|${hour}|${minute}`) || [];

					for (const apt of slotAppts) {
						const dur = apt.duration || 30;
						const slots = Math.max(1, Math.ceil(dur / slotDuration));
						const block = DOM.append(cell, DOM.$('.apt-block'));
						const typeColor = TYPE_COLORS[(getAppointmentType(apt) || '').toLowerCase()] || '#607D8B';
						const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#6b7280';

						block.style.cssText = `position:absolute;left:2px;right:2px;top:0;height:${slots * slotHeight - 2}px;background:${typeColor}20;border-left:3px solid ${typeColor};border-radius:3px;padding:2px 4px;overflow:hidden;cursor:pointer;z-index:1;font-size:10px;line-height:1.3;`;
						block.addEventListener('mouseenter', () => { block.style.background = `${typeColor}35`; });
						block.addEventListener('mouseleave', () => { block.style.background = `${typeColor}20`; });
						block.addEventListener('click', (e) => { e.stopPropagation(); this._editAppointment(apt); });

						const nameEl = DOM.append(block, DOM.$('div'));
						nameEl.textContent = apt.patientName || `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim();
						nameEl.style.cssText = 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

						const detailLine = DOM.append(block, DOM.$('div'));
						detailLine.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground);';
						const parts = [getAppointmentType(apt) || ''];
						if (apt.providerName) { parts.push(apt.providerName); }
						detailLine.textContent = parts.filter(Boolean).join(' \u00B7 ');

						// Status dot
						const dot = DOM.append(block, DOM.$('span'));
						dot.style.cssText = `position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:${statusColor};`;
						dot.title = apt.status;
					}
				}
			}
		}

		// Current time indicator
		this._renderTimeIndicator(table, days, startHour, slotDuration, slotHeight);
	}

	private _renderProviderGrid(): void {
		const startHour = this.configService.getValue<number>('ciyex.calendar.startHour') ?? 0;
		const endHour = this.configService.getValue<number>('ciyex.calendar.endHour') ?? 24;
		const slotDuration = this.configService.getValue<number>('ciyex.calendar.slotDuration') ?? 30;
		const slotHeight = 20;
		const dateStr = localDateStr(this.currentDate);

		let activeProviders = this.providers.length > 0 ? [...this.providers] : [];
		if (this.providerFilter) {
			activeProviders = activeProviders.filter(p => p.id === this.providerFilter);
		}
		if (activeProviders.length === 0) {
			const empty = DOM.append(this.gridContainer, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = this.providerFilter ? 'No matching provider found.' : 'No providers loaded. Click Refresh to load provider data.';
			return;
		}

		// PRE-INDEX appointments by provider+slot for O(1) lookup (instead of O(N) filter per cell)
		// Filter to only the selected day
		const viewAppointments = this._getViewFilteredAppointments().filter(a => {
			const d = this._parseAptDate(a);
			if (!d) { return false; }
			return localDateStr(d) === dateStr;
		});
		const apptIndex = new Map<string, Appointment[]>();
		const provCounts = new Map<string, number>();
		for (const a of viewAppointments) {
			const provKey = a.providerId || a.providerName || a.practitionerName || '';
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
		table.style.cssText = 'display:grid;grid-template-columns:50px ' + activeProviders.map(() => '1fr').join(' ') + ';min-width:100%;';

		const corner = DOM.append(table, DOM.$('.cal-corner'));
		corner.style.cssText = 'border-bottom:1px solid var(--vscode-editorWidget-border);border-right:1px solid var(--vscode-editorWidget-border);padding:6px 4px;position:sticky;top:0;background:var(--vscode-editor-background);z-index:2;';

		const PROVIDER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#e11d48', '#0891b2', '#a855f7'];

		for (let pi = 0; pi < activeProviders.length; pi++) {
			const prov = activeProviders[pi];
			const provColor = PROVIDER_COLORS[pi % PROVIDER_COLORS.length];
			const hdr = DOM.append(table, DOM.$('.cal-prov-header'));
			hdr.style.cssText = `border-bottom:2px solid ${provColor};border-right:1px solid var(--vscode-editorWidget-border);padding:6px 4px;text-align:center;position:sticky;top:0;background:var(--vscode-editor-background);z-index:2;`;
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
				timeCell.style.cssText = `height:${slotHeight}px;border-right:1px solid var(--vscode-editorWidget-border);padding:0 4px;font-size:10px;color:var(--vscode-descriptionForeground);text-align:right;line-height:${slotHeight}px;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : ''}`;
				if (isHourStart) {
					const h = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
					const ampm = hour >= 12 ? 'PM' : 'AM';
					timeCell.textContent = `${h}${ampm}`;
				}

				// Provider cells
				for (let pi = 0; pi < activeProviders.length; pi++) {
					const prov = activeProviders[pi];
					const provColor = PROVIDER_COLORS[pi % PROVIDER_COLORS.length];
					const cell = DOM.append(table, DOM.$('.cal-cell'));
					cell.style.cssText = `height:${slotHeight}px;border-right:1px solid rgba(128,128,128,0.1);position:relative;${isHourStart ? 'border-top:1px solid var(--vscode-editorWidget-border);' : 'border-top:1px solid rgba(128,128,128,0.05);'}`;
					cell.addEventListener('mouseenter', () => { cell.style.background = 'rgba(128,128,128,0.04)'; });
					cell.addEventListener('mouseleave', () => { cell.style.background = ''; });

					const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
					cell.addEventListener('click', () => this._createAppointment(dateStr, timeStr));

					// O(1) lookup from pre-built index
					const slotAppts = [
						...(apptIndex.get(`${prov.id}|${hour}|${minute}`) || []),
						...(prov.id !== prov.name ? (apptIndex.get(`${prov.name}|${hour}|${minute}`) || []) : []),
					];

					for (const apt of slotAppts) {
						const dur = apt.duration || 30;
						const slots = Math.max(1, Math.ceil(dur / slotDuration));
						const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#6b7280';
						const block = DOM.append(cell, DOM.$('.apt-block'));
						block.style.cssText = `position:absolute;left:2px;right:2px;top:0;height:${slots * slotHeight - 2}px;background:${provColor}20;border-left:3px solid ${provColor};border-radius:3px;padding:2px 4px;overflow:hidden;cursor:pointer;z-index:1;font-size:10px;line-height:1.3;`;
						block.addEventListener('mouseenter', () => { block.style.background = `${provColor}35`; });
						block.addEventListener('mouseleave', () => { block.style.background = `${provColor}20`; });
						block.addEventListener('click', (e) => { e.stopPropagation(); this._editAppointment(apt); });

						const nameEl = DOM.append(block, DOM.$('div'));
						nameEl.textContent = apt.patientName || '';
						nameEl.style.cssText = 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

						const typeEl = DOM.append(block, DOM.$('div'));
						typeEl.textContent = getAppointmentType(apt) || '';
						typeEl.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground);';

						const dot = DOM.append(block, DOM.$('span'));
						dot.style.cssText = `position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:${statusColor};`;
						dot.title = apt.status;
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
		const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday-based

		const grid = DOM.append(this.gridContainer, DOM.$('.month-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:1px;padding:8px;';

		// Day headers
		for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
			const hdr = DOM.append(grid, DOM.$('.month-header'));
			hdr.textContent = d;
			hdr.style.cssText = 'text-align:center;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);padding:4px;text-transform:uppercase;';
		}

		// Empty cells before first day
		for (let i = 0; i < startDayOfWeek; i++) {
			const cell = DOM.append(grid, DOM.$('.month-empty'));
			cell.style.cssText = 'min-height:80px;background:rgba(128,128,128,0.03);border-radius:3px;';
		}

		// Day cells
		const monthAppointments = this._getViewFilteredAppointments();
		for (let day = 1; day <= lastDay.getDate(); day++) {
			const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
			const isToday = dateStr === localDateStr(new Date());
			const dayAppts = monthAppointments.filter(a => {
				const d = this._parseAptDate(a);
				if (!d) { return false; }
				try { return localDateStr(d) === dateStr; } catch { return false; }
			});

			const cell = DOM.append(grid, DOM.$('.month-cell'));
			cell.style.cssText = `min-height:80px;background:var(--vscode-editorWidget-background);border-radius:3px;padding:4px;cursor:pointer;${isToday ? 'border:2px solid var(--vscode-focusBorder);' : 'border:1px solid rgba(128,128,128,0.1);'}`;
			cell.addEventListener('mouseenter', () => { cell.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.04))'; });
			cell.addEventListener('mouseleave', () => { cell.style.background = 'var(--vscode-editorWidget-background)'; });
			cell.addEventListener('click', () => { this.currentDate = new Date(dateStr + 'T00:00:00'); this.viewMode = 'day'; this._refresh(); });

			// Day number
			const numEl = DOM.append(cell, DOM.$('div'));
			numEl.textContent = String(day);
			numEl.style.cssText = `font-size:13px;font-weight:${isToday ? '700' : '500'};${isToday ? 'color:var(--vscode-textLink-foreground);' : ''}margin-bottom:2px;`;

			// Appointment count + previews
			if (dayAppts.length > 0) {
				const countBadge = DOM.append(cell, DOM.$('div'));
				countBadge.textContent = `${dayAppts.length} appt${dayAppts.length > 1 ? 's' : ''}`;
				countBadge.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);margin-bottom:2px;';

				// Show first 3 appointments
				for (const apt of dayAppts.slice(0, 3)) {
					const aptEl = DOM.append(cell, DOM.$('div'));
					const typeColor = TYPE_COLORS[(getAppointmentType(apt) || '').toLowerCase()] || '#607D8B';
					aptEl.style.cssText = `font-size:9px;padding:1px 3px;border-radius:2px;margin-bottom:1px;background:${typeColor}20;border-left:2px solid ${typeColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
					const parsedTime = this._parseAptDate(apt);
					if (parsedTime) {
						const time = parsedTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
						aptEl.textContent = `${time} ${apt.patientName || ''}`;
					} else {
						aptEl.textContent = apt.patientName || '';
					}
				}
				if (dayAppts.length > 3) {
					const more = DOM.append(cell, DOM.$('div'));
					more.textContent = `+${dayAppts.length - 3} more`;
					more.style.cssText = 'font-size:9px;color:var(--vscode-textLink-foreground);';
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

	private _navigate(dir: number): void {
		if (this.viewMode === 'day') {
			this.currentDate.setDate(this.currentDate.getDate() + dir);
		} else if (this.viewMode === 'month') {
			this.currentDate.setMonth(this.currentDate.getMonth() + dir);
		} else {
			this.currentDate.setDate(this.currentDate.getDate() + dir * 7);
		}
		this._headerRendered = false;
		this._renderHeader();
		this._renderGrid();
	}

	private async _refresh(): Promise<void> {
		await this._loadAppointments();
		this._renderHeader();
		this._renderGrid();
	}

	private async _createAppointment(date: string, time: string): Promise<void> {
		// Calculate end time (default 30 min)
		const [h, m] = time.split(':').map(Number);
		const endH = m + 30 >= 60 ? h + 1 : h;
		const endM = (m + 30) % 60;
		const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

		// Build form overlay
		const overlay = DOM.append(this.root, DOM.$('.appt-form-overlay'));
		overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;';

		const form = DOM.append(overlay, DOM.$('.appt-form'));
		form.style.cssText = 'background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:20px;width:520px;max-width:90vw;max-height:85vh;overflow-y:auto;overflow-x:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.4);scrollbar-width:none;';

		// Title
		const title = DOM.append(form, DOM.$('h3'));
		title.textContent = 'Schedule Appointment';
		title.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';

		// Map to store form field references (avoids querySelector)
		const formFields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

		// Helper: create form field
		const field = (label: string, id: string, type: string, value: string, required: boolean, options?: Array<{ value: string; label: string }>): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
			const group = DOM.append(form, DOM.$('.form-group'));
			group.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(group, DOM.$('label'));
			lbl.textContent = label + (required ? ' *' : '');
			lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--vscode-foreground);';
			const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';

			if (options) {
				const sel = DOM.append(group, DOM.$('select')) as HTMLSelectElement;
				sel.id = id; sel.style.cssText = inputStyle;
				for (const opt of options) { const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement; o.value = opt.value; o.textContent = opt.label; o.selected = opt.value === value; }
				formFields.set(id, sel);
				return sel;
			} else if (type === 'textarea') {
				const ta = DOM.append(group, DOM.$('textarea')) as HTMLTextAreaElement;
				ta.id = id; ta.value = value; ta.rows = 3; ta.style.cssText = inputStyle + 'resize:vertical;';
				formFields.set(id, ta);
				return ta;
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
				const inp = DOM.append(parent, DOM.$('input')) as HTMLInputElement;
				inp.id = id; inp.type = type; inp.value = value;
				inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
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

		let searchTimer: ReturnType<typeof setTimeout> | undefined;
		patInput.addEventListener('input', () => {
			if (searchTimer) { clearTimeout(searchTimer); }
			const q = patInput.value;
			if (q.length < 2) { patResults.style.display = 'none'; return; }
			searchTimer = setTimeout(async () => {
				try {
					const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
					if (res.ok) {
						const data = await res.json();
						const patients = data?.data?.content || data?.content || [];
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
					}
				} catch { /* */ }
			}, 300);
		});

		// Visit Type
		const visitTypes = [
			{ value: 'Consultation', label: 'Consultation' }, { value: 'New Patient', label: 'New Patient' },
			{ value: 'Follow-Up', label: 'Follow-Up' }, { value: 'Sick Visit', label: 'Sick Visit' },
			{ value: 'Annual Physical', label: 'Annual Physical' }, { value: 'Well Child', label: 'Well Child' },
			{ value: 'Telehealth', label: 'Telehealth' }, { value: 'Urgent', label: 'Urgent' },
			{ value: 'Procedure', label: 'Procedure' }, { value: 'Lab Only', label: 'Lab Only' },
			{ value: 'Injection', label: 'Injection' },
		];
		const visitTypeEl = field('Visit Type', 'visitType', 'select', 'Consultation', false, visitTypes) as HTMLSelectElement;

		// Date + Time row
		row('Date', 'startDate', 'date', date, true, 'Start Time', 'startTime', 'time', time, true);
		// End Time + Priority in a manual row
		const endPriorityRow = DOM.append(form, DOM.$('.form-row'));
		endPriorityRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;';
		const endTimeGroup = DOM.append(endPriorityRow, DOM.$('.fg'));
		const endTimeLbl = DOM.append(endTimeGroup, DOM.$('label'));
		endTimeLbl.textContent = 'End Time *';
		endTimeLbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;';
		const endTimeInp = DOM.append(endTimeGroup, DOM.$('input')) as HTMLInputElement;
		endTimeInp.id = 'endTime'; endTimeInp.type = 'time'; endTimeInp.value = endTime;
		endTimeInp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		formFields.set('endTime', endTimeInp);
		const priorityGroup = DOM.append(endPriorityRow, DOM.$('.fg'));
		const priorityLbl = DOM.append(priorityGroup, DOM.$('label'));
		priorityLbl.textContent = 'Priority';
		priorityLbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;';
		const prioritySel = DOM.append(priorityGroup, DOM.$('select')) as HTMLSelectElement;
		prioritySel.id = 'priority';
		prioritySel.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		for (const opt of [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }]) {
			const o = DOM.append(prioritySel, DOM.$('option')) as HTMLOptionElement;
			o.value = opt.value; o.textContent = opt.label; o.selected = opt.value === 'routine';
		}
		formFields.set('priority', prioritySel);

		// Provider
		const provOptions = [{ value: '', label: 'Select provider...' }, ...this.providers.map(p => ({ value: p.id, label: p.name }))];
		const providerIdEl = field('Provider', 'providerId', 'select', '', true, provOptions) as HTMLSelectElement;

		// Location
		const locOptions = [{ value: '', label: 'Select location...' }, ...this.locations.map(l => ({ value: l.id, label: l.name }))];
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

		// Buttons
		const btnRow = DOM.append(form, DOM.$('.btn-row'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';

		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => { overlay.remove(); });

		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Schedule Appointment';
		saveBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';

		saveBtn.addEventListener('click', async () => {
			const patName = patInput.value;
			const patId = patIdHidden.value;
			const visitType = visitTypeEl.value;
			const startD = (formFields.get('startDate') as HTMLInputElement | undefined)?.value || '';
			const startT = (formFields.get('startTime') as HTMLInputElement | undefined)?.value || '';
			const endT = (formFields.get('endTime') as HTMLInputElement | undefined)?.value || '';
			const provId = providerIdEl.value;
			const locId = locationIdEl.value;
			const status = statusEl.value;
			const notes = notesEl.value;

			if (!patName) { this.notificationService.notify({ severity: Severity.Warning, message: 'Patient is required' }); return; }
			if (!startD || !startT) { this.notificationService.notify({ severity: Severity.Warning, message: 'Date and time are required' }); return; }

			// Calculate duration in minutes
			const startMins = parseInt(startT.split(':')[0]) * 60 + parseInt(startT.split(':')[1]);
			const endMins = parseInt(endT.split(':')[0]) * 60 + parseInt(endT.split(':')[1]);
			const duration = endMins > startMins ? endMins - startMins : 30;

			const provName = this.providers.find(p => p.id === provId)?.name || '';

			saveBtn.disabled = true;
			saveBtn.textContent = 'Scheduling...';

			try {
				// Try FHIR-style endpoint first, fallback to simple
				const endpoints = [
					patId ? `/api/fhir-resource/appointments/patient/${patId}` : null,
					'/api/appointments',
				].filter(Boolean) as string[];

				let success = false;
				for (const endpoint of endpoints) {
					try {
						const body: Record<string, unknown> = {
							appointmentType: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0276', code: visitType, display: visitType }], text: visitType },
							status: status || 'scheduled',
							priority: (formFields.get('priority') as HTMLSelectElement | undefined)?.value || 'routine',
							start: `${startD}T${startT}:00`,
							end: `${startD}T${endT}:00`,
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
							break;
						}
					} catch { /* try next */ }
				}

				overlay.remove();
				if (success) {
					this.notificationService.notify({ severity: Severity.Info, message: `Scheduled ${visitType} for ${patName} at ${startT}${provName ? ' with ' + provName : ''}` });
					await this._refresh();
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
		const items = [
			{ label: 'Change Status', description: `Current: ${apt.status}` },
			{ label: 'Send Reminder', description: 'Email/SMS reminder to patient' },
			{ label: 'Reschedule', description: 'Move to a different time' },
			{ label: 'Create Series', description: 'Recurring appointments (e.g., 6 weekly PT)' },
			{ label: 'Add to Waitlist', description: 'Add patient to cancellation waitlist' },
			{ label: 'Edit Details' },
			{ label: 'Cancel Appointment' },
			{ label: 'Mark No-Show' },
		];
		const pick = await this.quickInputService.pick(items, { placeHolder: `${apt.patientName} — ${apt.appointmentType}` });
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

	private async _showStats(): Promise<void> {
		const total = this.appointments.length;
		const completed = this.appointments.filter(a => ['fulfilled', 'completed'].includes(a.status?.toLowerCase())).length;
		const noShows = this.appointments.filter(a => ['noshow', 'no-show'].includes(a.status?.toLowerCase())).length;
		const cancelled = this.appointments.filter(a => a.status?.toLowerCase() === 'cancelled').length;
		const scheduled = total - completed - noShows - cancelled;

		// Count by type
		const byType: Record<string, number> = {};
		for (const a of this.appointments) {
			const t = getAppointmentType(a) || 'Unknown';
			byType[t] = (byType[t] || 0) + 1;
		}

		// Count by provider
		const byProvider: Record<string, number> = {};
		for (const a of this.appointments) {
			const p = a.providerName || 'Unassigned';
			byProvider[p] = (byProvider[p] || 0) + 1;
		}

		const noShowRate = total > 0 ? Math.round((noShows / total) * 100) : 0;
		const cancelRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
		const fillRate = total > 0 ? Math.round((scheduled + completed) / total * 100) : 0;

		const items = [
			{ label: `Total: ${total}`, description: `Completed: ${completed}, Scheduled: ${scheduled}` },
			{ label: `No-Show Rate: ${noShowRate}%`, description: `${noShows} no-shows` },
			{ label: `Cancellation Rate: ${cancelRate}%`, description: `${cancelled} cancelled` },
			{ label: `Fill Rate: ${fillRate}%`, description: 'Scheduled + completed / total' },
			{ label: '--- By Type ---', description: '' },
			...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ label: t, description: `${c} appointments` })),
			{ label: '--- By Provider ---', description: '' },
			...Object.entries(byProvider).sort((a, b) => b[1] - a[1]).map(([p, c]) => ({ label: p, description: `${c} appointments` })),
		];

		await this.quickInputService.pick(items, { placeHolder: `Schedule Statistics (${this._getDateRange().startDate} to ${this._getDateRange().endDate})` });
	}

	private async _findAvailableSlot(): Promise<void> {
		// Pick appointment type
		const types = ['New Patient', 'Follow-Up', 'Sick Visit', 'Annual Physical', 'Telehealth', 'Procedure'];
		const typePick = await this.quickInputService.pick(
			types.map(t => ({ label: t })),
			{ placeHolder: 'What type of appointment?' }
		);
		if (!typePick) { return; }

		// Pick provider (optional)
		const provItems = [{ label: 'Any Provider', id: '' }, ...this.providers.map(p => ({ label: p.name, id: p.id }))];
		const provPick = await this.quickInputService.pick(
			provItems.map(p => ({ label: p.label, description: p.id ? '' : '(first available)' })),
			{ placeHolder: 'Select provider' }
		);

		// Search for available slots
		const searchDate = localDateStr(this.currentDate);
		let slotsUrl = `/api/slots/available?date=${searchDate}&type=${encodeURIComponent(typePick.label)}&days=14`;
		const selectedProv = provItems.find(p => p.label === provPick?.label);
		if (selectedProv?.id) { slotsUrl += `&providerId=${selectedProv.id}`; }

		try {
			const res = await this.apiService.fetch(slotsUrl);
			if (res.ok) {
				const data = await res.json();
				const slots = data?.data || data?.content || (Array.isArray(data) ? data : []);

				if (slots.length === 0) {
					this.notificationService.notify({ severity: Severity.Info, message: 'No available slots found in the next 14 days.' });
					return;
				}

				// Show available slots as QuickPick
				const slotItems = slots.slice(0, 20).map((s: Record<string, string>) => {
					const d = new Date(s.start || s.startTime);
					return {
						label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
						description: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (s.providerName ? ` — ${s.providerName}` : ''),
						slot: s,
					};
				});

				const slotPick = await this.quickInputService.pick(slotItems, { placeHolder: `${slots.length} slots available` });
				if (slotPick) {
					// Navigate calendar to the selected slot
					const slotData = (slotPick as unknown as { slot: Record<string, string> }).slot;
					const slotDate = new Date(slotData.start || slotData.startTime);
					this.currentDate = slotDate;
					this.viewMode = 'day';
					await this._refresh();
					this.notificationService.notify({ severity: Severity.Info, message: `Showing ${slotPick.label} ${slotPick.description}` });
				}
			} else {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Slot search not available. Create appointment manually.' });
			}
		} catch {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Slot search API not available.' });
		}
	}

	private _openFlowBoard(): void {
		const STATUS_CLR: Record<string, string> = {
			'scheduled': '#3b82f6', 'confirmed': '#6366f1', 'arrived': '#f59e0b',
			'checked-in': '#8b5cf6', 'in-room': '#06b6d4', 'with-provider': '#22c55e',
			'fulfilled': '#6b7280', 'completed': '#6b7280', 'cancelled': '#ef4444',
			'noshow': '#dc2626', 'no-show': '#dc2626',
		};

		const overlay = DOM.append(this.root, DOM.$('.flowboard-overlay'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:200;background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;overflow-y:auto;';

		// Close button
		const closeBtn = DOM.append(overlay, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715 Close';
		closeBtn.style.cssText = 'position:fixed;top:12px;right:24px;z-index:210;padding:8px 16px;background:#334155;color:#e2e8f0;border:none;border-radius:6px;cursor:pointer;font-size:13px;';
		closeBtn.addEventListener('click', () => { overlay.remove(); });

		// Header
		const hdr = DOM.append(overlay, DOM.$('.fb-header'));
		hdr.style.cssText = 'display:flex;align-items:center;padding:20px 32px;background:#1e293b;border-bottom:2px solid #334155;';
		const h1 = DOM.append(hdr, DOM.$('h1'));
		h1.textContent = '\u{1F3E5} Patient Flow Board';
		h1.style.cssText = 'font-size:24px;flex:1;margin:0;';
		const timeEl = DOM.append(hdr, DOM.$('div'));
		const now = new Date();
		timeEl.textContent = `${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} \u2014 ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
		timeEl.style.cssText = 'font-size:20px;font-weight:300;';

		// Stats
		const filtered = this._getViewFilteredAppointments();
		const total = filtered.length;
		const done = filtered.filter(a => ['fulfilled', 'completed', 'cancelled'].includes(a.status?.toLowerCase())).length;
		const noShows = filtered.filter(a => ['noshow', 'no-show'].includes(a.status?.toLowerCase())).length;
		const active = total - done - noShows;

		const statsBar = DOM.append(overlay, DOM.$('.fb-stats'));
		statsBar.style.cssText = 'display:flex;gap:16px;padding:16px 32px;';
		const addStat = (val: string, lbl: string, color: string) => {
			const card = DOM.append(statsBar, DOM.$('.fb-stat'));
			card.style.cssText = 'flex:1;text-align:center;padding:16px;background:#1e293b;border-radius:12px;';
			const numEl = DOM.append(card, DOM.$('div'));
			numEl.textContent = val;
			numEl.style.cssText = `font-size:36px;font-weight:700;color:${color};`;
			const lblEl = DOM.append(card, DOM.$('div'));
			lblEl.textContent = lbl;
			lblEl.style.cssText = 'font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-top:4px;';
		};
		addStat(String(total), 'Total', '#3b82f6');
		addStat(String(done), 'Completed', '#22c55e');
		addStat(String(active), 'Active', '#f59e0b');
		addStat(String(noShows), 'No Show', '#ef4444');

		// Table
		const tbl = DOM.append(overlay, DOM.$('table'));
		tbl.style.cssText = 'width:calc(100% - 64px);margin:0 32px;border-collapse:collapse;';
		const thead = DOM.append(tbl, DOM.$('thead'));
		const headRow = DOM.append(thead, DOM.$('tr'));
		for (const col of ['Time', 'Patient', 'Type', 'Provider', 'Room', 'Status']) {
			const th = DOM.append(headRow, DOM.$('th'));
			th.textContent = col;
			th.style.cssText = 'text-align:left;padding:12px 16px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#64748b;border-bottom:1px solid #334155;';
		}
		const tbody = DOM.append(tbl, DOM.$('tbody'));

		for (const apt of filtered) {
			const statusColor = STATUS_CLR[apt.status?.toLowerCase()] || '#6b7280';
			const tr = DOM.append(tbody, DOM.$('tr'));
			tr.style.cssText = 'border-bottom:1px solid #1e293b;';
			tr.addEventListener('mouseenter', () => { tr.style.background = '#1e293b'; });
			tr.addEventListener('mouseleave', () => { tr.style.background = ''; });

			const tdStyle = 'padding:14px 16px;font-size:16px;';
			const pd = this._parseAptDate(apt);
			const timeStr = pd ? pd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '--:--';

			const timeTd = DOM.append(tr, DOM.$('td'));
			timeTd.textContent = timeStr;
			timeTd.style.cssText = tdStyle + 'font-weight:600;';

			const nameTd = DOM.append(tr, DOM.$('td'));
			nameTd.textContent = apt.patientName || '';
			nameTd.style.cssText = tdStyle;

			const typeTd = DOM.append(tr, DOM.$('td'));
			typeTd.textContent = getAppointmentType(apt);
			typeTd.style.cssText = tdStyle;

			const provTd = DOM.append(tr, DOM.$('td'));
			provTd.textContent = apt.providerName || apt.practitionerName || '';
			provTd.style.cssText = tdStyle;

			const roomTd = DOM.append(tr, DOM.$('td'));
			roomTd.textContent = '-';
			roomTd.style.cssText = tdStyle + `color:${statusColor};font-weight:600;`;

			const statusTd = DOM.append(tr, DOM.$('td'));
			statusTd.style.cssText = tdStyle;
			const badge = DOM.append(statusTd, DOM.$('span'));
			badge.textContent = (apt.status || '').replace(/-/g, ' ');
			badge.style.cssText = `background:${statusColor}22;color:${statusColor};padding:4px 12px;border-radius:6px;font-weight:600;text-transform:capitalize;`;
		}

		if (filtered.length === 0) {
			const emptyRow = DOM.append(tbody, DOM.$('tr'));
			const emptyTd = DOM.append(emptyRow, DOM.$('td')) as HTMLTableCellElement;
			emptyTd.colSpan = 6;
			emptyTd.textContent = 'No appointments';
			emptyTd.style.cssText = 'text-align:center;padding:40px;color:#64748b;font-size:16px;';
		}
	}

	private _btn(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = text;
		btn.style.cssText = 'padding:3px 8px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:3px;cursor:pointer;font-size:11px;';
		btn.addEventListener('click', onClick);
		return btn;
	}

	/** Searchable single-select dropdown — replacement for plain <select>.
	 *  Empty value selects the "all" item. */
	private _buildSearchableFilter(
		parent: HTMLElement,
		allLabel: string,
		items: Array<{ id: string; name: string }>,
		current: string,
		onChange: (val: string) => void,
	): void {
		const wrap = DOM.append(parent, DOM.$('.cal-filter'));
		wrap.style.cssText = 'position:relative;max-width:180px;';

		const inputStyle = 'padding:2px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;width:100%;cursor:pointer;';
		const trigger = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
		trigger.style.cssText = inputStyle + 'text-align:left;';
		const chosen = items.find(i => i.id === current);
		trigger.textContent = chosen ? chosen.name : allLabel;

		const panel = DOM.append(wrap, DOM.$('.cal-filter-panel'));
		panel.style.cssText = 'position:absolute;top:100%;left:0;right:0;margin-top:2px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:30;display:none;min-width:200px;';

		const search = DOM.append(panel, DOM.$('input')) as HTMLInputElement;
		search.placeholder = 'Search...';
		search.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;background:var(--vscode-input-background);border:none;border-bottom:1px solid var(--vscode-editorWidget-border);color:var(--vscode-input-foreground);font-size:12px;outline:none;';

		const list = DOM.append(panel, DOM.$('.cal-filter-list'));
		list.style.cssText = 'max-height:240px;overflow-y:auto;';

		const renderList = () => {
			DOM.clearNode(list);
			const q = search.value.trim().toLowerCase();
			const allRow = DOM.append(list, DOM.$('.cal-filter-item')) as HTMLElement;
			allRow.textContent = allLabel;
			allRow.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;';
			allRow.addEventListener('mouseenter', () => { allRow.style.background = 'var(--vscode-list-hoverBackground)'; });
			allRow.addEventListener('mouseleave', () => { allRow.style.background = ''; });
			allRow.addEventListener('click', () => {
				trigger.textContent = allLabel;
				panel.style.display = 'none';
				onChange('');
			});
			for (const it of items) {
				if (q && !it.name.toLowerCase().includes(q)) { continue; }
				const row = DOM.append(list, DOM.$('.cal-filter-item')) as HTMLElement;
				row.textContent = it.name;
				row.style.cssText = `padding:6px 10px;cursor:pointer;font-size:12px;${it.id === current ? 'background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);' : ''}`;
				row.addEventListener('mouseenter', () => { if (it.id !== current) { row.style.background = 'var(--vscode-list-hoverBackground)'; } });
				row.addEventListener('mouseleave', () => { if (it.id !== current) { row.style.background = ''; } });
				row.addEventListener('click', () => {
					trigger.textContent = it.name;
					panel.style.display = 'none';
					onChange(it.id);
				});
			}
		};

		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			const open = panel.style.display !== 'none';
			panel.style.display = open ? 'none' : 'block';
			if (!open) {
				renderList();
				search.value = '';
				search.focus();
			}
		});
		search.addEventListener('input', renderList);
		search.addEventListener('click', (e) => { e.stopPropagation(); });

		// Dismiss on outside click
		const dismiss = (ev: Event) => {
			if (!wrap.contains(ev.target as Node)) { panel.style.display = 'none'; }
		};
		DOM.getActiveWindow().document.addEventListener('click', dismiss);
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}

	override dispose(): void {
		DOM.getActiveWindow().document.body.classList.remove('ehr-on-calendar');
		super.dispose();
	}
}
