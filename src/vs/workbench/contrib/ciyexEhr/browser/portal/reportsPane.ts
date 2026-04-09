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
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ReportsEditorInput } from '../editors/ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface ReportCategory {
	label: string;
	color: string;
	reports: Array<{ label: string; description: string }>;
}

const REPORT_CATEGORIES: ReportCategory[] = [
	{
		label: 'Clinical', color: '#3b82f6',
		reports: [
			{ label: 'Patient Demographics', description: 'Population by age, gender, status, insurance' },
			{ label: 'Encounter Summary', description: 'Encounters by type, provider, status, trends' },
			{ label: 'Lab Orders & Results', description: 'Order volume, status, turnaround times' },
			{ label: 'Medication & Prescriptions', description: 'Prescribing patterns, drug classes, refills' },
			{ label: 'Referral Tracking', description: 'Completion rates, turnaround, outgoing/incoming' },
			{ label: 'Immunizations', description: 'Vaccine coverage, compliance rates, overdue' },
			{ label: 'Care Gaps', description: 'Preventive care opportunities, HEDIS measures' },
			{ label: 'No-Show Analysis', description: 'No-show rates, patterns, productivity impact' },
			{ label: 'Problem List', description: 'Active diagnoses, patient conditions' },
		],
	},
	{
		label: 'Financial', color: '#10b981',
		reports: [
			{ label: 'Revenue Overview', description: 'Monthly revenue, charge trends, payer mix' },
			{ label: 'Payer Mix', description: 'Claims by payer, collection rates, denials' },
			{ label: 'CPT Utilization', description: 'Procedure code usage, top procedures, revenue' },
			{ label: 'AR Aging', description: 'Receivable aging buckets (0-30, 31-60, 61-90, 90+)' },
		],
	},
	{
		label: 'Operational', color: '#8b5cf6',
		reports: [
			{ label: 'Appointment Volume', description: 'Booking trends, scheduling utilization' },
			{ label: 'Provider Productivity', description: 'Encounters/revenue per provider, RVU tracking' },
			{ label: 'Document Completion', description: 'Unsigned notes, incomplete encounters' },
		],
	},
	{
		label: 'Compliance', color: '#f59e0b',
		reports: [
			{ label: 'Quality Measures', description: 'MIPS measures, performance benchmarking' },
			{ label: 'Audit Log', description: 'System activity, user actions, compliance' },
		],
	},
	{
		label: 'Population Health', color: '#ec4899',
		reports: [
			{ label: 'Risk Stratification', description: 'Risk scoring, high-risk patients, interventions' },
			{ label: 'Disease Registry', description: 'Chronic conditions, enrolled populations, outcomes' },
		],
	},
	{
		label: 'Administrative', color: '#64748b',
		reports: [
			{ label: 'Portal Usage', description: 'Enrollment, active users, message volume' },
			{ label: 'AI Usage', description: 'Token usage, model costs, performance metrics' },
		],
	},
];

export class ReportsPane extends ViewPane {
	static readonly ID = 'ciyex.reports.view';

	private container!: HTMLElement;

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
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.reports-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';
		this._render();
	}

	private _render(): void {
		DOM.clearNode(this.container);

		for (const cat of REPORT_CATEGORIES) {
			// Category header
			const header = DOM.append(this.container, DOM.$('div'));
			header.style.cssText = `padding:8px 10px 4px;display:flex;align-items:center;gap:6px;`;

			const dot = DOM.append(header, DOM.$('span'));
			dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${cat.color};flex-shrink:0;`;

			const label = DOM.append(header, DOM.$('span'));
			label.textContent = cat.label;
			label.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);letter-spacing:0.5px;';

			const count = DOM.append(header, DOM.$('span'));
			count.textContent = `${cat.reports.length}`;
			count.style.cssText = 'font-size:9px;padding:0 4px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';

			// Report items
			for (const report of cat.reports) {
				const row = DOM.append(this.container, DOM.$('div'));
				row.style.cssText = 'padding:6px 10px 6px 24px;cursor:pointer;display:flex;align-items:center;gap:6px;';
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
				row.addEventListener('mouseleave', () => { row.style.background = ''; });
				row.addEventListener('click', () => {
					const key = report.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
					const input = new ReportsEditorInput(key, report.label, cat.label);
					this.editorService.openEditor(input, { pinned: true });
				});

				const col = DOM.append(row, DOM.$('div'));
				col.style.cssText = 'flex:1;min-width:0;';

				const name = DOM.append(col, DOM.$('div'));
				name.textContent = report.label;
				name.style.cssText = 'font-weight:500;font-size:12px;';

				const desc = DOM.append(col, DOM.$('div'));
				desc.textContent = report.description;
				desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

				const arrow = DOM.append(row, DOM.$('span'));
				arrow.textContent = '›';
				arrow.style.cssText = 'color:var(--vscode-descriptionForeground);flex-shrink:0;';
			}
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
