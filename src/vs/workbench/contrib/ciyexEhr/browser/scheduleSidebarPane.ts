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
	duration?: number;
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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.schedule-sidebar'));
		this.container.style.cssText = 'padding:0;overflow-y:auto;height:100%;font-size:12px;';

		this._loadAndRender();

		// Auto-refresh every 60 seconds
		this.refreshTimer = setInterval(() => this._loadAndRender(), 60000);
	}

	private async _loadAndRender(): Promise<void> {
		const today = new Date().toISOString().split('T')[0];
		try {
			const res = await this.apiService.fetch(`/api/appointments?date=${today}&page=0&size=100`);
			if (res.ok) {
				const data = await res.json();
				this.appointments = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
			}
		} catch (err) {
			this.logService.warn('[Schedule] Failed to load appointments:', err);
		}
		this._render();
	}

	private _render(): void {
		DOM.clearNode(this.container);

		// -- Quick Stats Bar --
		this._renderStats();

		// -- Today's Timeline --
		this._renderTimeline();

		// -- Upcoming Days --
		this._renderUpcoming();

		// -- Actions --
		this._renderActions();
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

	private _renderTimeline(): void {
		const section = DOM.append(this.container, DOM.$('.timeline-section'));
		section.style.cssText = 'padding:8px 0;';

		// Section header
		const header = DOM.append(section, DOM.$('.section-header'));
		header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
		const now = new Date();
		header.textContent = `Today \u2014 ${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;

		if (this.appointments.length === 0) {
			const empty = DOM.append(section, DOM.$('.empty'));
			empty.style.cssText = 'padding:16px 10px;color:var(--vscode-descriptionForeground);text-align:center;';
			empty.textContent = 'No appointments today';
			return;
		}

		// Sort by time
		const sorted = [...this.appointments].sort((a, b) => {
			const ta = a.startTime || '';
			const tb = b.startTime || '';
			return ta.localeCompare(tb);
		});

		for (const apt of sorted) {
			this._renderAppointmentRow(section, apt);
		}
	}

	private _renderAppointmentRow(parent: HTMLElement, apt: Appointment): void {
		const row = DOM.append(parent, DOM.$('.apt-row'));
		row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;border-left:3px solid transparent;';

		const statusColor = STATUS_COLORS[apt.status?.toLowerCase()] || '#6b7280';
		row.style.borderLeftColor = statusColor;

		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });
		row.addEventListener('click', () => {
			this.commandService.executeCommand('ciyex.openCalendar');
		});

		// Time
		const time = DOM.append(row, DOM.$('.time'));
		time.style.cssText = 'width:42px;font-size:11px;font-weight:500;color:var(--vscode-foreground);flex-shrink:0;';
		try {
			const d = new Date(apt.startTime);
			time.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
		} catch {
			time.textContent = apt.startTime || '--:--';
		}

		// Patient info
		const info = DOM.append(row, DOM.$('.info'));
		info.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

		const name = DOM.append(info, DOM.$('.name'));
		name.textContent = apt.patientName || `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim() || 'Unknown';
		name.style.cssText = 'font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

		const type = DOM.append(info, DOM.$('.type'));
		type.textContent = apt.appointmentType || apt.type || '';
		type.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		// Status badge
		const badge = DOM.append(row, DOM.$('.status-badge'));
		badge.textContent = (apt.status || 'scheduled').replace(/-/g, ' ');
		badge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:3px;text-transform:capitalize;white-space:nowrap;background:${statusColor}22;color:${statusColor};font-weight:500;`;
	}

	private _renderUpcoming(): void {
		const section = DOM.append(this.container, DOM.$('.upcoming-section'));
		section.style.cssText = 'padding:8px 0;border-top:1px solid var(--vscode-editorWidget-border);';

		const header = DOM.append(section, DOM.$('.section-header'));
		header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
		header.textContent = 'Upcoming';

		// Show next 3 days
		const today = new Date();
		for (let i = 1; i <= 3; i++) {
			const date = new Date(today);
			date.setDate(date.getDate() + i);
			const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

			const row = DOM.append(section, DOM.$('.upcoming-row'));
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;cursor:pointer;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const dayEl = DOM.append(row, DOM.$('span'));
			dayEl.textContent = dayName;
			dayEl.style.cssText = 'flex:1;font-size:12px;';

			const countEl = DOM.append(row, DOM.$('span'));
			countEl.textContent = '\u2014'; // Will be filled by API call later
			countEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}
	}

	private _renderActions(): void {
		const actions = DOM.append(this.container, DOM.$('.actions-bar'));
		actions.style.cssText = 'padding:8px 10px;border-top:1px solid var(--vscode-editorWidget-border);display:flex;gap:6px;';

		const newBtn = DOM.append(actions, DOM.$('button'));
		newBtn.textContent = '+ New Appointment';
		newBtn.style.cssText = 'flex:1;padding:5px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;';
		newBtn.addEventListener('click', () => this.commandService.executeCommand('ciyex.newAppointment'));

		const calBtn = DOM.append(actions, DOM.$('button'));
		calBtn.textContent = 'Open Calendar';
		calBtn.style.cssText = 'flex:1;padding:5px;background:var(--vscode-button-secondaryBackground,#3c3c3c);color:var(--vscode-button-secondaryForeground,#ccc);border:none;border-radius:4px;cursor:pointer;font-size:11px;';
		calBtn.addEventListener('click', () => this.commandService.executeCommand('ciyex.openCalendar'));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.container) {
			this.container.style.height = `${height}px`;
		}
	}

	override dispose(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
		}
		super.dispose();
	}
}
