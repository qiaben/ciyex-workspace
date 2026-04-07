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
import { ICiyexApiService } from './ciyexApiService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import * as DOM from '../../../../base/browser/dom.js';

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
	providerName?: string;
	practitionerName?: string;
	patientId?: string;
	encounterId?: string;
	room?: string;
	visitType?: string;
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
	private refreshTimer: ReturnType<typeof setInterval> | undefined;

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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.schedule-sidebar'));
		this.container.style.cssText = 'padding:0;overflow-y:auto;height:100%;font-size:12px;';

		this._loadAndRender();

		// Auto-refresh every 30 seconds
		this.refreshTimer = setInterval(() => this._loadAndRender(), 30000);
	}

	private currentPage = 0;
	private pageSize = 25;
	private totalAppointments = 0;
	private hasMore = false;

	private async _loadAndRender(append = false): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/appointments?page=${this.currentPage}&size=${this.pageSize}`);
			if (res.ok) {
				const data = await res.json();
				const page = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
				this.totalAppointments = data?.data?.totalElements || data?.totalElements || page.length;
				if (append) {
					this.appointments = [...this.appointments, ...page];
				} else {
					this.appointments = page;
				}
				this.hasMore = page.length === this.pageSize;
			}
		} catch (err) {
			this.logService.warn('[Schedule] Failed to load appointments:', err);
		}

		// Load status options from API (once)
		if (this.statusOptions.length === 0) {
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
			// Terminal statuses are the last 3 typically
			this.terminalStatuses = new Set(this.statusOptions.filter(s => ['completed', 'no show', 'cancelled', 'fulfilled'].includes(s.toLowerCase())).map(s => s.toLowerCase()));
			if (this.terminalStatuses.size === 0) {
				this.terminalStatuses = new Set(['completed', 'fulfilled', 'cancelled', 'noshow', 'no-show']);
			}
		}

		// Load room options (once)
		if (this.roomOptions.length === 0) {
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
		}

		// Load waitlist
		try {
			const res = await this.apiService.fetch('/api/waitlist?page=0&size=20');
			if (res.ok) {
				const data = await res.json();
				this.waitlist = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
			}
		} catch {
			// Waitlist API may not exist yet
			this.waitlist = [];
		}

		this._render();
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

		// Sort by time (upcoming first)
		filtered.sort((a, b) => {
			const ta = a.start || a.startTime || '';
			const tb = b.start || b.startTime || '';
			return ta.localeCompare(tb);
		});

		return filtered;
	}

	private _render(): void {
		DOM.clearNode(this.container);

		// -- Quick Stats Bar (very top) --
		this._renderStats();

		// -- Icon Action Buttons --
		this._renderActions();

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

		const total = this.totalAppointments || this.appointments.length;
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
			btn.addEventListener('click', () => { this.showFilter = f; this._render(); });
		}
	}

	private _renderTimeline(): void {
		const section = DOM.append(this.container, DOM.$('.timeline-section'));
		section.style.cssText = 'padding:4px 0;';

		const filtered = this._getFilteredAppointments();

		// Section header
		const header = DOM.append(section, DOM.$('.section-header'));
		header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);display:flex;';
		const now = new Date();
		const headerText = DOM.append(header, DOM.$('span'));
		headerText.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
		headerText.style.cssText = 'flex:1;';
		const countText = DOM.append(header, DOM.$('span'));
		countText.textContent = `${filtered.length} appts`;
		countText.style.cssText = 'font-size:10px;';

		if (filtered.length === 0) {
			const empty = DOM.append(section, DOM.$('.empty'));
			empty.style.cssText = 'padding:12px 10px;color:var(--vscode-descriptionForeground);text-align:center;font-size:12px;';
			empty.textContent = this.showFilter === 'active' ? 'No active appointments' : this.showFilter === 'completed' ? 'No completed appointments' : 'No appointments';
			return;
		}

		for (const apt of filtered) {
			this._renderAppointmentRow(section, apt);
		}
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
		try {
			const d = new Date(apt.start || apt.startTime);
			time.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
		} catch { time.textContent = '--:--'; }

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
		typeEl.textContent = apt.appointmentType || apt.type || '';

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

		// Action icons row
		const actions = DOM.append(row, DOM.$('.actions'));
		actions.style.cssText = 'display:flex;gap:3px;opacity:0;transition:opacity 0.1s;';
		row.addEventListener('mouseenter', () => { actions.style.opacity = '1'; });
		row.addEventListener('mouseleave', () => { actions.style.opacity = '0'; });

		const iconBtn = (parent: HTMLElement, label: string, symbol: string, color: string, onClick: () => void) => {
			const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = symbol;
			btn.title = label;
			btn.style.cssText = `padding:2px 5px;border:none;border-radius:3px;cursor:pointer;font-size:11px;background:${color}15;color:${color};`;
			btn.addEventListener('mouseenter', () => { btn.style.background = `${color}30`; });
			btn.addEventListener('mouseleave', () => { btn.style.background = `${color}15`; });
			btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
		};

		// Check-in (if not already checked in)
		if (!this.terminalStatuses.has(apt.status?.toLowerCase()) && apt.status?.toLowerCase() !== 'checked-in' && apt.status?.toLowerCase() !== 'in-room' && apt.status?.toLowerCase() !== 'with-provider') {
			iconBtn(actions, 'Check In', '\u2713', '#22c55e', () => this._changeStatus(apt, 'Checked-in'));
		}

		// Open Patient Chart
		iconBtn(actions, 'Patient Chart', '\u{1F4CB}', '#3b82f6', () => {
			if (apt.patientId) { this.commandService.executeCommand('ciyex.openPatientChart', apt.patientId); }
		});

		// Record Vitals
		if (apt.encounterId) {
			iconBtn(actions, 'Record Vitals', '\u2764', '#a855f7', () => {
				this.commandService.executeCommand('ciyex.openEncounter', apt.encounterId);
			});
		}

		// Create Encounter (if none exists)
		if (!apt.encounterId && !this.terminalStatuses.has(apt.status?.toLowerCase())) {
			iconBtn(actions, 'Create Encounter', '\u2795', '#22c55e', async () => {
				try {
					await this.apiService.fetch(`/api/appointments/${apt.id}/encounter`, { method: 'POST' });
					await this._loadAndRender();
				} catch { /* */ }
			});
		}

		// Telehealth (if visit type includes telehealth/virtual)
		const vt = (apt.appointmentType || apt.type || apt.visitType || '').toLowerCase();
		if (vt.includes('telehealth') || vt.includes('virtual') || vt.includes('video')) {
			iconBtn(actions, 'Video Call', '\u{1F4F9}', '#22c55e', () => {
				this.commandService.executeCommand('ciyex.openTelehealth', apt.id);
			});
		}

		// No Show
		if (!this.terminalStatuses.has(apt.status?.toLowerCase())) {
			iconBtn(actions, 'No Show', '\u2716', '#ef4444', () => this._changeStatus(apt, 'No Show'));
		}
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

	private _renderActions(): void {
		const bar = DOM.append(this.container, DOM.$('.actions-bar'));
		bar.style.cssText = 'display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		const iconBtn = (symbol: string, label: string, primary: boolean, onClick: () => void) => {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = symbol;
			btn.title = label;
			btn.style.cssText = `flex:1;padding:6px;border:none;border-radius:4px;cursor:pointer;font-size:14px;text-align:center;${primary ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);' : 'background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);'}`;
			btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
			btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
			btn.addEventListener('click', onClick);
		};

		iconBtn('+', 'New Appointment', true, () => this.commandService.executeCommand('ciyex.openCalendar'));
		iconBtn('\u{1F4C5}', 'Open Calendar', false, () => this.commandService.executeCommand('ciyex.openCalendar'));
		iconBtn('\u{1F4FA}', 'TV Display (Flow Board)', false, () => this._openTvDisplay());
		iconBtn('\u21BB', 'Refresh', false, () => { this.currentPage = 0; this._loadAndRender(); });
	}

	private _openTvDisplay(): void {
		// Open patient flow board as a full-screen webview
		const body = this._buildFlowBoardHtml();
		// Use a new browser window for TV display
		const w = globalThis.open('', 'flowboard', 'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no');
		if (w) {
			w.document.write(body);
			w.document.close();
		}
	}

	private _buildFlowBoardHtml(): string {
		const filtered = this._getFilteredAppointments();
		const now = new Date();

		let rows = '';
		for (const apt of filtered) {
			const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#6b7280';
			let timeStr = '--:--';
			try { timeStr = new Date(apt.start || apt.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); } catch { /* */ }

			rows += `<tr>
				<td style="font-weight:600;">${timeStr}</td>
				<td>${apt.patientName || ''}</td>
				<td>${apt.appointmentType || apt.type || ''}</td>
				<td>${apt.providerName || apt.practitionerName || ''}</td>
				<td style="color:${statusColor};font-weight:600;">${apt.room || '-'}</td>
				<td><span style="background:${statusColor}22;color:${statusColor};padding:4px 12px;border-radius:6px;font-weight:600;">${(apt.status || '').replace(/-/g, ' ')}</span></td>
			</tr>`;
		}

		const total = this.totalAppointments || this.appointments.length;
		const done = this.appointments.filter(a => this.terminalStatuses.has(a.status?.toLowerCase())).length;
		const active = total - done;

		return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="30">
		<title>Patient Flow Board</title>
		<style>
			* { margin:0; padding:0; box-sizing:border-box; }
			body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#0f172a; color:#e2e8f0; }
			.header { display:flex; align-items:center; padding:20px 32px; background:#1e293b; border-bottom:2px solid #334155; }
			.header h1 { font-size:24px; flex:1; }
			.header .time { font-size:20px; font-weight:300; }
			.stats { display:flex; gap:16px; padding:16px 32px; }
			.stat { flex:1; text-align:center; padding:16px; background:#1e293b; border-radius:12px; }
			.stat .num { font-size:36px; font-weight:700; }
			.stat .label { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-top:4px; }
			table { width:100%; border-collapse:collapse; margin:0 32px; }
			th { text-align:left; padding:12px 16px; font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#64748b; border-bottom:1px solid #334155; }
			td { padding:14px 16px; font-size:16px; border-bottom:1px solid #1e293b; }
			tr:hover td { background:#1e293b; }
			.footer { position:fixed; bottom:0; left:0; right:0; padding:12px 32px; background:#1e293b; text-align:center; font-size:12px; color:#64748b; }
		</style></head><body>
		<div class="header">
			<h1>\u{1F3E5} Patient Flow Board</h1>
			<div class="time">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} \u2014 ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
		</div>
		<div class="stats">
			<div class="stat"><div class="num" style="color:#3b82f6;">${total}</div><div class="label">Total</div></div>
			<div class="stat"><div class="num" style="color:#22c55e;">${done}</div><div class="label">Completed</div></div>
			<div class="stat"><div class="num" style="color:#f59e0b;">${active}</div><div class="label">Active</div></div>
			<div class="stat"><div class="num" style="color:#ef4444;">${this.appointments.filter(a => a.status?.toLowerCase() === 'noshow' || a.status?.toLowerCase() === 'no-show' || a.status?.toLowerCase() === 'no show').length}</div><div class="label">No Show</div></div>
		</div>
		<table>
			<thead><tr><th>Time</th><th>Patient</th><th>Type</th><th>Provider</th><th>Room</th><th>Status</th></tr></thead>
			<tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:40px;color:#64748b;">No appointments</td></tr>'}</tbody>
		</table>
		<div class="footer">Auto-refreshes every 30 seconds \u2014 Ciyex Workspace Flow Board</div>
		</body></html>`;
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
			clearInterval(this.refreshTimer);
		}
		super.dispose();
	}
}
