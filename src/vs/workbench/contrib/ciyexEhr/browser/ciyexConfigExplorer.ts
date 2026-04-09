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
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import * as DOM from '../../../../base/browser/dom.js';

// Changed from settingsGear to avoid duplicate gear icon in sidebar
const configIcon = registerIcon('ciyex-config', Codicon.json, localize('cConfig', 'Ciyex Configuration'));

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

	private listElement!: HTMLElement;

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
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.listElement = DOM.append(container, DOM.$('.ciyex-config-list'));
		this.listElement.style.cssText = 'padding:4px 0;';
		this._renderList();
	}

	private _renderList(): void {
		DOM.clearNode(this.listElement);

		for (const item of CONFIG_ITEMS) {
			if (item.children) {
				// Section header with + button
				const headerRow = DOM.append(this.listElement, DOM.$('.section-header'));
				headerRow.style.cssText = 'padding:12px 12px 4px;display:flex;align-items:center;gap:6px;';
				const headerText = DOM.append(headerRow, DOM.$('span'));
				headerText.textContent = item.label;
				headerText.style.cssText = 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);flex:1;';
				// + New button
				const addBtn = DOM.append(headerRow, DOM.$('span.codicon.codicon-add'));
				addBtn.style.cssText = 'font-size:14px;cursor:pointer;color:var(--vscode-descriptionForeground);border-radius:3px;padding:1px;';
				addBtn.title = 'Add new field configuration';
				addBtn.addEventListener('mouseenter', () => { addBtn.style.color = 'var(--vscode-icon-foreground)'; addBtn.style.background = 'var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1))'; });
				addBtn.addEventListener('mouseleave', () => { addBtn.style.color = 'var(--vscode-descriptionForeground)'; addBtn.style.background = ''; });
				addBtn.addEventListener('click', () => this._addFieldConfig());

				for (const child of item.children) {
					this._renderItem(this.listElement, child, true);
				}
			} else {
				this._renderItem(this.listElement, item, false);
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

		// Delete button for field configs (show on hover)
		if (isChild && item.commandId === 'ciyex.openFieldConfig') {
			const del = DOM.append(row, DOM.$('span.codicon.codicon-close'));
			del.style.cssText = 'font-size:12px;cursor:pointer;color:var(--vscode-descriptionForeground);opacity:0;padding:1px;border-radius:3px;';
			del.title = 'Delete this field configuration';
			row.addEventListener('mouseenter', () => { del.style.opacity = '1'; });
			row.addEventListener('mouseleave', () => { del.style.opacity = '0'; });
			del.addEventListener('mouseenter', () => { del.style.color = 'var(--vscode-errorForeground)'; del.style.background = 'rgba(255,255,255,0.06)'; });
			del.addEventListener('mouseleave', () => { del.style.color = 'var(--vscode-descriptionForeground)'; del.style.background = ''; });
			del.addEventListener('click', (e) => {
				e.stopPropagation();
				const tabKey = item.label.toLowerCase().replace(/\s+/g, '-');
				this._deleteFieldConfig(tabKey, item.label);
			});
		}
	}

	private async _addFieldConfig(): Promise<void> {
		const name = await this.quickInputService.input({
			placeHolder: 'e.g., social-history',
			prompt: 'Enter a name for the new field configuration (lowercase, hyphens)',
			validateInput: async (v) => {
				if (!v) { return 'Name is required'; }
				if (!/^[a-z][a-z0-9-]*$/.test(v)) { return 'Use lowercase letters, numbers, and hyphens only'; }
				return undefined;
			}
		});
		if (!name) { return; }

		const label = await this.quickInputService.input({
			placeHolder: 'e.g., Social History',
			prompt: 'Display label for this configuration',
			value: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
		});
		if (!label) { return; }

		const fhirResource = await this.quickInputService.input({
			placeHolder: 'e.g., Patient, Observation',
			prompt: 'FHIR resource type (comma-separated)',
			value: 'Patient',
		});

		const template = {
			tabKey: name,
			fhirResources: fhirResource ? fhirResource.split(',').map(s => s.trim()).filter(Boolean) : [],
			sections: [{
				key: 'main',
				title: label,
				columns: 2,
				visible: true,
				fields: []
			}]
		};

		const fileUri = URI.joinPath(this.environmentService.userRoamingDataHome, '.ciyex', 'fields', `${name}.json`);
		await this.fileService.writeFile(fileUri, VSBuffer.fromString(JSON.stringify(template, null, 2)));

		// Open the new config in the visual editor
		this.commandService.executeCommand('ciyex.openFieldConfig', name);
	}

	private async _deleteFieldConfig(tabKey: string, label: string): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: `Delete field configuration "${label}"?`,
			detail: 'This will permanently delete the configuration file.',
		});
		if (!confirmed) { return; }

		const fileUri = URI.joinPath(this.environmentService.userRoamingDataHome, '.ciyex', 'fields', `${tabKey}.json`);
		try {
			await this.fileService.del(fileUri);
		} catch {
			// File might not exist
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
