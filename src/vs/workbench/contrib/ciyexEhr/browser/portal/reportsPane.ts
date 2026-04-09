/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import * as DOM from '../../../../../base/browser/dom.js';

const REPORT_ITEMS: Array<{ icon: string; label: string; description: string; command?: string; apiPath?: string }> = [
	{ icon: '💊', label: 'Prescriptions', description: 'Active, completed, discontinued Rx', command: 'ciyex.openPrescriptions' },
	{ icon: '🔬', label: 'Lab Results', description: 'Lab orders and results', apiPath: '/api/lab-results' },
	{ icon: '📋', label: 'Referrals', description: 'Referral status and tracking', command: 'ciyex.openReferrals' },
	{ icon: '🛡️', label: 'Authorizations', description: 'Prior auth approvals and denials', command: 'ciyex.openAuthorizations' },
	{ icon: '💉', label: 'Immunizations', description: 'Vaccine administration records', command: 'ciyex.openImmunizations' },
	{ icon: '📅', label: 'Appointments', description: 'Appointment volume and no-shows', command: 'ciyex.openCalendar' },
	{ icon: '👥', label: 'Patient Census', description: 'Active patients and demographics', command: 'ciyex.openPatientChart' },
	{ icon: '🧠', label: 'CDS Alerts', description: 'Clinical decision support triggers', command: 'ciyex.openCds' },
	{ icon: '📝', label: 'Care Plans', description: 'Active care plan tracking', command: 'ciyex.openCarePlans' },
	{ icon: '📋', label: 'Tasks', description: 'Task completion and overdue items', command: 'ciyex.openTasks' },
];

export class ReportsPane extends ViewPane {
	static readonly ID = 'ciyex.reports.view';

	private container!: HTMLElement;
	private stats: Record<string, Record<string, number>> = {};

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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.reports-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';

		this._loadStats();
		this._render();
	}

	private async _loadStats(): Promise<void> {
		// Load stats from available endpoints
		for (const [key, path] of [
			['prescriptions', '/api/prescriptions/stats'],
			['referrals', '/api/referrals/stats'],
		]) {
			try {
				const res = await this.apiService.fetch(path);
				if (res.ok) {
					const data = await res.json();
					this.stats[key] = (data?.data || data || {}) as Record<string, number>;
				}
			} catch { /* */ }
		}
		this._render();
	}

	private _render(): void {
		DOM.clearNode(this.container);

		// Quick stats if loaded
		if (Object.keys(this.stats).length > 0) {
			const statsSection = DOM.append(this.container, DOM.$('div'));
			statsSection.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';

			for (const [category, data] of Object.entries(this.stats)) {
				const row = DOM.append(statsSection, DOM.$('div'));
				row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;';

				const label = DOM.append(row, DOM.$('span'));
				label.textContent = `${category}:`;
				label.style.cssText = 'font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:capitalize;min-width:80px;';

				for (const [k, v] of Object.entries(data)) {
					if (typeof v !== 'number') { continue; }
					const badge = DOM.append(row, DOM.$('span'));
					badge.textContent = `${k}: ${v}`;
					badge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(0,122,204,0.1);color:var(--vscode-textLink-foreground);';
				}
			}
		}

		// Report links
		for (const item of REPORT_ITEMS) {
			const row = DOM.append(this.container, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			if (item.command) {
				row.addEventListener('click', () => this.commandService.executeCommand(item.command!));
			}

			const icon = DOM.append(row, DOM.$('span'));
			icon.textContent = item.icon;
			icon.style.cssText = 'font-size:16px;width:24px;text-align:center;flex-shrink:0;';

			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;';

			const lbl = DOM.append(col, DOM.$('div'));
			lbl.textContent = item.label;
			lbl.style.cssText = 'font-weight:500;';

			const desc = DOM.append(col, DOM.$('div'));
			desc.textContent = item.description;
			desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			const arrow = DOM.append(row, DOM.$('span'));
			arrow.textContent = '›';
			arrow.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:16px;';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
