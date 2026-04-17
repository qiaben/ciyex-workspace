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
import * as DOM from '../../../../../base/browser/dom.js';

const CLINICAL_ITEMS: Array<{ icon: string; label: string; description: string; command: string }> = [
	// allow-any-unicode-next-line
	{ icon: '💊', label: 'Prescriptions', description: 'Active Rx, refills, discontinue', command: 'ciyex.openPrescriptions' },
	// allow-any-unicode-next-line
	{ icon: '🔬', label: 'Lab Orders & Results', description: 'Order volume, status, turnaround', command: 'ciyex.openLabs' },
	// allow-any-unicode-next-line
	{ icon: '💉', label: 'Immunizations', description: 'Vaccine records, CVX codes', command: 'ciyex.openImmunizations' },
	// allow-any-unicode-next-line
	{ icon: '📋', label: 'Referrals', description: 'Status workflow, specialist tracking', command: 'ciyex.openReferrals' },
	// allow-any-unicode-next-line
	{ icon: '🛡️', label: 'Authorizations', description: 'Prior auth, approve/deny/appeal', command: 'ciyex.openAuthorizations' },
	// allow-any-unicode-next-line
	{ icon: '❤️', label: 'Care Plans', description: 'Goals, interventions, categories', command: 'ciyex.openCarePlans' },
	// allow-any-unicode-next-line
	{ icon: '🧠', label: 'CDS Rules & Alerts', description: 'Clinical decision support rules', command: 'ciyex.openCds' },
	// allow-any-unicode-next-line
	{ icon: '📚', label: 'Patient Education', description: 'Education materials and handouts', command: 'ciyex.openEducation' },
];

export class ClinicalMenuPane extends ViewPane {
	static readonly ID = 'ciyex.clinical.menu';

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
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.clinical-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';

		for (const item of CLINICAL_ITEMS) {
			const row = DOM.append(this.container, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => this.commandService.executeCommand(item.command));

			const icon = DOM.append(row, DOM.$('span'));
			icon.textContent = item.icon;
			icon.style.cssText = 'font-size:16px;width:24px;text-align:center;flex-shrink:0;';

			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;min-width:0;';

			const label = DOM.append(col, DOM.$('div'));
			label.textContent = item.label;
			label.style.cssText = 'font-weight:500;';

			const desc = DOM.append(col, DOM.$('div'));
			desc.textContent = item.description;
			desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			const arrow = DOM.append(row, DOM.$('span'));
			// allow-any-unicode-next-line
			arrow.textContent = '›';
			arrow.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:16px;flex-shrink:0;';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
