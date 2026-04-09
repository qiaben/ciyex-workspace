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

const SETTINGS_ITEMS: Array<{ icon: string; label: string; description: string; command: string }> = [
	{ icon: '👥', label: 'User Management', description: 'Add, edit, delete users and assign roles', command: 'ciyex.openUserManagement' },
	{ icon: '🛡️', label: 'Roles & Permissions', description: 'Manage roles, permissions, and FHIR scopes', command: 'ciyex.openRolesConfig' },
	{ icon: '🌐', label: 'Portal Settings', description: 'Configure patient portal features and navigation', command: 'ciyex.openPortalSettings' },
	{ icon: '📋', label: 'Encounter Settings', description: 'Configure encounter form sections and fields', command: 'ciyex.openEncounterConfig' },
	{ icon: '📐', label: 'Chart Layout', description: 'Customize patient chart tabs and field layout', command: 'ciyex.openChartLayout' },
	{ icon: '📑', label: 'Menu Configuration', description: 'Customize sidebar menu items and navigation', command: 'ciyex.openMenuConfig' },
	{ icon: '🎨', label: 'Calendar Colors', description: 'Set appointment type and status colors', command: 'ciyex.openCalendarColors' },
	{ icon: '⚙️', label: 'Practice Settings', description: 'General practice configuration', command: 'ciyex.openSettings' },
];

export class SettingsListPane extends ViewPane {
	static readonly ID = 'ciyex.settings.list';

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
		this.container = DOM.append(parent, DOM.$('.settings-list-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';

		for (const item of SETTINGS_ITEMS) {
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
			arrow.textContent = '›';
			arrow.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:16px;flex-shrink:0;';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
