/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, IViewDescriptorService } from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { codiconsLibrary as Codicon } from '../../../../base/common/codiconsLibrary.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import * as DOM from '../../../../base/browser/dom.js';

const configIcon = registerIcon('ciyex-config', Codicon.settingsGear, localize('cConfig', 'Ciyex Configuration'));

interface ConfigItem {
	label: string;
	icon: string;
	commandId: string;
	description?: string;
	children?: ConfigItem[];
}

const CONFIG_ITEMS: ConfigItem[] = [
	// Ciyex Settings excluded — already in VS Code Settings (Cmd+,), search "@ciyex"
	{ label: 'Chart Layout', icon: 'codicon-preview', commandId: 'ciyex.openChartLayout', description: 'Tabs and categories' },
	{ label: 'Encounter Form', icon: 'codicon-note', commandId: 'ciyex.openEncounterConfig', description: '17 sections, ROS, PE' },
	{ label: 'Menu Configuration', icon: 'codicon-list-tree', commandId: 'ciyex.openMenuConfig', description: 'Sidebar navigation' },
	// Calendar Colors, Patient Portal, Roles & Permissions moved to VS Code Settings (Cmd+,)
	{
		label: 'FIELD CONFIGURATIONS', icon: '', commandId: '', children: [
			{ label: 'Demographics', icon: 'codicon-person', commandId: 'ciyex.openFieldConfig', description: 'Patient info fields' },
			{ label: 'Vitals', icon: 'codicon-pulse', commandId: 'ciyex.openFieldConfig', description: 'Vital signs' },
			{ label: 'Problems', icon: 'codicon-warning', commandId: 'ciyex.openFieldConfig', description: 'Conditions' },
			{ label: 'Allergies', icon: 'codicon-circle-slash', commandId: 'ciyex.openFieldConfig', description: 'Allergy intolerance' },
			{ label: 'Medications', icon: 'codicon-diff-added', commandId: 'ciyex.openFieldConfig', description: 'Prescriptions' },
			{ label: 'Immunizations', icon: 'codicon-shield', commandId: 'ciyex.openFieldConfig', description: 'Vaccines' },
			{ label: 'Lab Results', icon: 'codicon-beaker', commandId: 'ciyex.openFieldConfig', description: 'Diagnostic reports' },
			{ label: 'Appointments', icon: 'codicon-calendar', commandId: 'ciyex.openFieldConfig', description: 'Scheduling' },
			{ label: 'Insurance', icon: 'codicon-credit-card', commandId: 'ciyex.openFieldConfig', description: 'Coverage' },
			{ label: 'Providers', icon: 'codicon-account', commandId: 'ciyex.openFieldConfig', description: 'Practitioners' },
			{ label: 'Facilities', icon: 'codicon-home', commandId: 'ciyex.openFieldConfig', description: 'Locations' },
			{ label: 'Documents', icon: 'codicon-file-text', commandId: 'ciyex.openFieldConfig', description: 'File uploads' },
			{ label: 'Referrals', icon: 'codicon-link-external', commandId: 'ciyex.openFieldConfig', description: 'Service requests' },
			{ label: 'History', icon: 'codicon-history', commandId: 'ciyex.openFieldConfig', description: 'Family, social, surgical' },
			{ label: 'Visit Notes', icon: 'codicon-edit', commandId: 'ciyex.openFieldConfig', description: 'Clinical notes' },
			{ label: 'Practice', icon: 'codicon-organization', commandId: 'ciyex.openFieldConfig', description: 'Organization info' },
			{ label: 'Referral Providers', icon: 'codicon-person-add', commandId: 'ciyex.openFieldConfig', description: 'External providers' },
			{ label: 'Referral Practices', icon: 'codicon-remote', commandId: 'ciyex.openFieldConfig', description: 'External orgs' },
		]
	},
];

class CiyexConfigPane extends ViewPane {
	static readonly ID = 'ciyex.config.tree';

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

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const list = DOM.append(container, DOM.$('.ciyex-config-list'));
		list.style.cssText = 'padding:4px 0;';

		for (const item of CONFIG_ITEMS) {
			if (item.children) {
				// Section header
				const header = DOM.append(list, DOM.$('.section-header'));
				header.style.cssText = 'padding:12px 12px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
				header.textContent = item.label;

				for (const child of item.children) {
					this._renderItem(list, child, true);
				}
			} else {
				this._renderItem(list, item, false);
			}
		}
	}

	private _renderItem(parent: HTMLElement, item: ConfigItem, isChild: boolean): void {
		const row = DOM.append(parent, DOM.$('.config-item'));
		row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 12px;padding-left:${isChild ? '24px' : '12px'};cursor:pointer;border-radius:3px;`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });
		row.addEventListener('click', () => {
			if (item.commandId === 'ciyex.openFieldConfig') {
				const tabKey = item.label.toLowerCase().replace(/\s+/g, '-');
				this.commandService.executeCommand(item.commandId, tabKey);
			} else if (item.commandId) {
				this.commandService.executeCommand(item.commandId);
			}
		});

		const icon = DOM.append(row, DOM.$('span.codicon.' + item.icon));
		icon.style.cssText = 'font-size:14px;width:16px;text-align:center;color:var(--vscode-icon-foreground);';

		const label = DOM.append(row, DOM.$('span'));
		label.textContent = item.label;
		label.style.cssText = 'flex:1;font-size:13px;';

		if (item.description) {
			const desc = DOM.append(row, DOM.$('span'));
			desc.textContent = item.description;
			desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

// Register
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

const CONFIG_CONTAINER = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.config',
	title: localize2('ciyexConfig', "Ciyex Config"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.config', {}]),
	icon: configIcon,
	order: 100,
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: CiyexConfigPane.ID,
	name: localize2('configFiles', "Configuration"),
	ctorDescriptor: new SyncDescriptor(CiyexConfigPane),
	canToggleVisibility: true,
	canMoveView: true,
	order: 0,
}], CONFIG_CONTAINER);
