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
	appointmentType: string;
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
	private viewMode: 'day' | 'week' | 'month' | 'providers' = 'day';
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
	) {
		super(CalendarEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-calendar-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header bar
		this.headerBar = DOM.append(this.root, DOM.$('.calendar-header'));
		this.headerBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		// Grid container
		this.gridContainer = DOM.append(this.root, DOM.$('.calendar-grid'));
		this.gridContainer.style.cssText = 'flex:1;overflow:auto;position:relative;';

		// Render empty grid, then load data once ready
		this._renderHeader();
		this._renderGrid();
		globalThis.setTimeout(() => this._loadAndRender(), 500);
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		const defaultView = this.configService.getValue<string>('ciyex.calendar.defaultView') || 'week';
		this.viewMode = defaultView === 'day' ? 'day' : defaultView === 'month' ? 'month' : 'week';
		await this._loadAndRender();
	}

	private async _loadAndRender(): Promise<void> {
		await this._loadAppointments();
		this._renderHeader();
		this._renderGrid();
	}

	private async _loadAppointments(): Promise<void> {
	  try {
		console.log('[Calendar] _loadAppointments called, viewMode:', this.viewMode, 'date:', this.currentDate);
		const { startDate } = this._getDateRange();
		console.log('[Calendar] startDate:', startDate);
		let provLoc = '';
		if (this.providerFilter) { provLoc += `&providerId=${this.providerFilter}`; }
		if (this.locationFilter) { provLoc += `&locationId=${this.locationFilter}`; }

		// Load all appointments (no date filter - API hangs with date params)
		// Filter by date client-side
		const url = `/api/appointments?page=0&size=200${provLoc}`;
		console.log('[Calendar] Fetching:', url);

		try {
			const res = await this.apiService.fetch(url);
			if (res.ok) {
				const data = await res.json();
				this.appointments = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
			}
		} catch { this.appointments = []; }
		if (!this.appointments) { this.appointments = []; }

		console.log('[Calendar] Appointments loaded:', this.appointments?.length, '- now loading providers...');
		// Load providers (try multiple endpoints)
		if (this.providers.length === 0) {
			const providerUrls = ['/api/fhir-resource/providers?page=0&size=100', '/api/providers?page=0&size=100'];
			for (const url of providerUrls) {
				try {
					console.log('[Calendar] Fetching providers from:', url);
					const res = await this.apiService.fetch(url);
					console.log('[Calendar] Provider response:', res.status, res.ok);
					if (res.ok) {
						const data = await res.json();
						const list = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
						console.log('[Calendar] Provider list length:', list.length, 'from', url);
						if (list.length > 0) {
							this.providers = list.map((p: Record<string, string>) => ({
								id: p.id || p.fhirId || p.username || '',
								name: `${p['identification.prefix'] || ''} ${p['identification.firstName'] || p.firstName || ''} ${p['identification.lastName'] || p.lastName || ''}`.trim() || p.name || p.fullName || p.username || p.id,
							})).filter((p: { id: string; name: string }) => p.name && p.name.trim().length > 0);
							console.log('[Calendar] Loaded providers:', this.providers.length, this.providers.map(p => p.name));
							break;
						}
					}
				} catch { /* try next */ }
			}
			// Also extract unique providers from appointments
			if (this.providers.length === 0 && this.appointments.length > 0) {
				const provMap = new Map<string, string>();
				for (const a of this.appointments) {
					if (a.providerName) { provMap.set(a.providerId || a.providerName, a.providerName); }
				}
				this.providers = Array.from(provMap.entries()).map(([id, name]) => ({ id, name }));
			}
		}

		// Load locations (try multiple endpoints)
		if (this.locations.length === 0) {
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
		}

		// Load provider schedule blocks (availability)
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
	  } catch (err) {
		console.error('[Calendar] _loadAppointments error:', err);
	  }
	}

	private _getDateRange(): { startDate: string; endDate: string } {
		const d = new Date(this.currentDate);
		if (this.viewMode === 'day') {
			const s = d.toISOString().split('T')[0];
			return { startDate: s, endDate: s };
		}
		if (this.viewMode === 'month') {
			const first = new Date(d.getFullYear(), d.getMonth(), 1);
			const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
			return { startDate: first.toISOString().split('T')[0], endDate: last.toISOString().split('T')[0] };
		}
		// Week: find Monday
		const day = d.getDay();
		const monday = new Date(d);
		monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
		const sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);
		return { startDate: monday.toISOString().split('T')[0], endDate: sunday.toISOString().split('T')[0] };
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);

		// Nav buttons
		const prevBtn = this._btn(this.headerBar, '\u25C0', () => this._navigate(-1));
		prevBtn.title = 'Previous';
		const todayBtn = this._btn(this.headerBar, 'Today', () => { this.currentDate = new Date(); this._refresh(); });
		todayBtn.style.fontWeight = '600';
		const nextBtn = this._btn(this.headerBar, '\u25B6', () => this._navigate(1));
		nextBtn.title = 'Next';

		// Date label
		const label = DOM.append(this.headerBar, DOM.$('span'));
		label.style.cssText = 'font-size:15px;font-weight:600;flex:1;text-align:center;';
		if (this.viewMode === 'day' || this.viewMode === 'providers') {
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
		for (const mode of ['day', 'week', 'month', 'providers'] as const) {
			const btn = DOM.append(viewGroup, DOM.$('button'));
			btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
			btn.style.cssText = `padding:3px 10px;border:none;cursor:pointer;font-size:11px;${this.viewMode === mode ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);' : 'background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);'}`;
			btn.addEventListener('click', () => { this.viewMode = mode; this._refresh(); });
		}

		// Provider filter
		const provSelect = DOM.append(this.headerBar, DOM.$('select')) as HTMLSelectElement;
		provSelect.style.cssText = 'padding:2px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;max-width:140px;';
		const provAll = DOM.append(provSelect, DOM.$('option')) as HTMLOptionElement;
		provAll.value = ''; provAll.textContent = 'All Providers';
		for (const p of this.providers) {
			const opt = DOM.append(provSelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = p.id; opt.textContent = p.name; opt.selected = p.id === this.providerFilter;
		}
		provSelect.addEventListener('change', () => { this.providerFilter = provSelect.value; this._refresh(); });

		// Location filter
		const locSelect = DOM.append(this.headerBar, DOM.$('select')) as HTMLSelectElement;
		locSelect.style.cssText = 'padding:2px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;max-width:140px;';
		const locAll = DOM.append(locSelect, DOM.$('option')) as HTMLOptionElement;
		locAll.value = ''; locAll.textContent = 'All Locations';
		for (const l of this.locations) {
			const opt = DOM.append(locSelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = l.id; opt.textContent = l.name; opt.selected = l.id === this.locationFilter;
		}
		locSelect.addEventListener('change', () => { this.locationFilter = locSelect.value; this._refresh(); });

		// Refresh button
		this._btn(this.headerBar, '\u21BB', () => { this.providers = []; this.locations = []; this._loadAndRender(); }).title = 'Refresh';

		// Find slot button
		this._btn(this.headerBar, 'Find Slot', () => { this._findAvailableSlot(); });

		// Stats button
		this._btn(this.headerBar, 'Stats', () => { this._showStats(); });

		// New appointment button
		const newBtn = this._btn(this.headerBar, '+ New', async () => {
			const today = this.currentDate.toISOString().split('T')[0];
			await this._createAppointment(today, '09:00');
		});
		newBtn.style.background = 'var(--vscode-button-background)';
		newBtn.style.color = 'var(--vscode-button-foreground)';
		newBtn.style.fontWeight = '600';

		// Appointment count
		const count = DOM.append(this.headerBar, DOM.$('span'));
		count.textContent = `${this.appointments.length} appts`;
		count.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
	}

	private _renderGrid(): void {
		DOM.clearNode(this.gridContainer);

		if (this.viewMode === 'month') {
			this._renderMonthGrid();
			return;
		}

		if (this.viewMode === 'providers') {
			this._renderProviderGrid();
			return;
		}

		const startHour = this.configService.getValue<number>('ciyex.calendar.startHour') ?? 8;
		const endHour = this.configService.getValue<number>('ciyex.calendar.endHour') ?? 18;
		const slotDuration = this.configService.getValue<number>('ciyex.calendar.slotDuration') ?? 15;
		const slotHeight = 20; // px per slot
		// hourHeight = (60 / slotDuration) * slotHeight — used for time indicator positioning

		const days = this.viewMode === 'day' ? [new Date(this.currentDate)] : this._getWeekDays();

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
					const dayStr = days[di].toISOString().split('T')[0];
					const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
					cell.addEventListener('click', () => this._createAppointment(dayStr, timeStr));

					// Render appointments in this slot
					const slotAppts = this.appointments.filter(a => {
						try {
							const d = new Date(a.start || a.startTime);
							return d.toISOString().split('T')[0] === dayStr &&
								d.getHours() === hour &&
								d.getMinutes() >= minute &&
								d.getMinutes() < minute + slotDuration;
						} catch { return false; }
					});

					for (const apt of slotAppts) {
						const dur = apt.duration || 30;
						const slots = Math.max(1, Math.ceil(dur / slotDuration));
						const block = DOM.append(cell, DOM.$('.apt-block'));
						const typeColor = TYPE_COLORS[(apt.appointmentType || apt.type || '').toLowerCase()] || '#607D8B';
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
						const parts = [apt.appointmentType || apt.type || ''];
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
		const slotDuration = this.configService.getValue<number>('ciyex.calendar.slotDuration') ?? 15;
		const slotHeight = 20;
		const dateStr = this.currentDate.toISOString().split('T')[0];

		// Get providers that have appointments today (or all if none filtered)
		const activeProviders = this.providers.length > 0 ? this.providers : [];
		if (activeProviders.length === 0) {
			const empty = DOM.append(this.gridContainer, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No providers loaded. Click Refresh to load provider data.';
			return;
		}

		const table = DOM.append(this.gridContainer, DOM.$('.cal-table'));
		table.style.cssText = 'display:grid;grid-template-columns:50px ' + activeProviders.map(() => '1fr').join(' ') + ';min-width:100%;';

		// Header: empty corner + provider names
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

			// Count today's appointments for this provider
			const provAppts = this.appointments.filter(a => {
				const aProvId = a.providerId || '';
				const aProvName = a.providerName || a.practitionerName || '';
				return (aProvId === prov.id || aProvName === prov.name);
			});
			const countEl = DOM.append(hdr, DOM.$('div'));
			countEl.textContent = `${provAppts.length} appts`;
			countEl.style.cssText = `font-size:9px;color:${provColor};`;
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

					// Find appointments for this provider at this time
					const slotAppts = this.appointments.filter(a => {
						const aProvId = a.providerId || '';
						const aProvName = a.providerName || a.practitionerName || '';
						if (aProvId !== prov.id && aProvName !== prov.name) { return false; }
						try {
							const d = new Date(a.start || a.startTime);
							return d.getHours() === hour && d.getMinutes() >= minute && d.getMinutes() < minute + slotDuration;
						} catch { return false; }
					});

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
						typeEl.textContent = apt.appointmentType || apt.type || '';
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
		for (let day = 1; day <= lastDay.getDate(); day++) {
			const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
			const isToday = dateStr === new Date().toISOString().split('T')[0];
			const dayAppts = this.appointments.filter(a => {
				try { return new Date(a.start || a.startTime).toISOString().split('T')[0] === dateStr; } catch { return false; }
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
					const typeColor = TYPE_COLORS[(apt.appointmentType || apt.type || '').toLowerCase()] || '#607D8B';
					aptEl.style.cssText = `font-size:9px;padding:1px 3px;border-radius:2px;margin-bottom:1px;background:${typeColor}20;border-left:2px solid ${typeColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
					try {
						const time = new Date(apt.start || apt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
						aptEl.textContent = `${time} ${apt.patientName || ''}`;
					} catch {
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
		if (this.viewMode === 'day' || this.viewMode === 'providers') {
			this.currentDate.setDate(this.currentDate.getDate() + dir);
		} else if (this.viewMode === 'month') {
			this.currentDate.setMonth(this.currentDate.getMonth() + dir);
		} else {
			this.currentDate.setDate(this.currentDate.getDate() + dir * 7);
		}
		this._refresh();
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
		form.style.cssText = 'background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:20px;width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

		// Title
		const title = DOM.append(form, DOM.$('h3'));
		title.textContent = 'Schedule Appointment';
		title.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';

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
				return sel;
			} else if (type === 'textarea') {
				const ta = DOM.append(group, DOM.$('textarea')) as HTMLTextAreaElement;
				ta.id = id; ta.value = value; ta.rows = 3; ta.style.cssText = inputStyle + 'resize:vertical;';
				return ta;
			} else {
				const inp = DOM.append(group, DOM.$('input')) as HTMLInputElement;
				inp.id = id; inp.type = type; inp.value = value; inp.style.cssText = inputStyle;
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
		field('Visit Type', 'visitType', 'select', 'Consultation', false, visitTypes);

		// Date + Time row
		row('Date', 'startDate', 'date', date, true, 'Start Time', 'startTime', 'time', time, true);
		row('End Time', 'endTime', 'time', endTime, true, 'Priority', 'priority', 'text', 'Routine', false);

		// Provider
		const provOptions = [{ value: '', label: 'Select provider...' }, ...this.providers.map(p => ({ value: p.id, label: p.name }))];
		field('Provider', 'providerId', 'select', '', true, provOptions);

		// Location
		const locOptions = [{ value: '', label: 'Select location...' }, ...this.locations.map(l => ({ value: l.id, label: l.name }))];
		field('Location', 'locationId', 'select', '', true, locOptions);

		// Status
		field('Status', 'status', 'select', 'scheduled', false, [
			{ value: 'scheduled', label: 'Scheduled' }, { value: 'confirmed', label: 'Confirmed' },
		]);

		// Notes
		field('Reason / Notes', 'notes', 'textarea', '', false);

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
			const visitType = (form.querySelector('#visitType') as HTMLSelectElement)?.value;
			const startD = (form.querySelector('#startDate') as HTMLInputElement)?.value;
			const startT = (form.querySelector('#startTime') as HTMLInputElement)?.value;
			const endT = (form.querySelector('#endTime') as HTMLInputElement)?.value;
			const provId = (form.querySelector('#providerId') as HTMLSelectElement)?.value;
			const locId = (form.querySelector('#locationId') as HTMLSelectElement)?.value;
			const status = (form.querySelector('#status') as HTMLSelectElement)?.value;
			const notes = (form.querySelector('#notes') as HTMLTextAreaElement)?.value;

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
							priority: (form.querySelector('#priority') as HTMLInputElement)?.value || 'routine',
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
			const newDate = await this.quickInputService.input({ prompt: 'New date (YYYY-MM-DD)', value: new Date().toISOString().split('T')[0] });
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
				const baseDate = new Date(apt.start || apt.startTime);
				for (let i = 1; i <= n; i++) {
					const newDate = new Date(baseDate);
					newDate.setDate(baseDate.getDate() + i * intervalDays);
					await this.apiService.fetch('/api/appointments', {
						method: 'POST',
						body: JSON.stringify({
							patientName: apt.patientName,
							appointmentType: apt.appointmentType || apt.type,
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
						requestedType: apt.appointmentType || apt.type,
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
			const t = a.appointmentType || a.type || 'Unknown';
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
		const searchDate = this.currentDate.toISOString().split('T')[0];
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

	private _btn(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = text;
		btn.style.cssText = 'padding:3px 8px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:3px;cursor:pointer;font-size:11px;';
		btn.addEventListener('click', onClick);
		return btn;
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
