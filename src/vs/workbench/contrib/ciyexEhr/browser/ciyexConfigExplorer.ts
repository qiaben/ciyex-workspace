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
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import * as DOM from '../../../../base/browser/dom.js';

// --- Icon ---
const configExplorerIcon = registerIcon('ciyex-config', Codicon.settingsGear, localize('cConfig', 'Ciyex Configuration'));

// --- Config file definitions ---

interface ConfigEntry {
	readonly label: string;
	readonly description: string;
	readonly icon: string;
	readonly relativePath: string;
	readonly children?: ConfigEntry[];
}

const CONFIG_ENTRIES: ConfigEntry[] = [
	{ label: 'Settings', description: 'Practice, display, features', icon: 'settings-gear', relativePath: 'settings.json' },
	{ label: 'Chart Layout', description: 'Tabs and categories', icon: 'layout', relativePath: 'layout.json' },
	{ label: 'Encounter Form', description: '17 sections, ROS, PE', icon: 'notebook', relativePath: 'encounter.json' },
	{ label: 'Menu Configuration', description: 'Sidebar navigation', icon: 'list-tree', relativePath: 'menu.json' },
	{ label: 'Calendar Colors', description: 'Visit type, provider, location', icon: 'symbol-color', relativePath: 'colors.json' },
	{ label: 'Patient Portal', description: 'Branding, features, forms', icon: 'globe', relativePath: 'portal.json' },
	{ label: 'Roles & Permissions', description: 'FHIR scopes, features', icon: 'shield', relativePath: 'roles.json' },
	{
		label: 'Field Configurations', description: '', icon: 'symbol-field', relativePath: '', children: [
			{ label: 'Demographics', description: 'Patient info', icon: 'person', relativePath: 'fields/demographics.json' },
			{ label: 'Vitals', description: 'Vital signs', icon: 'pulse', relativePath: 'fields/vitals.json' },
			{ label: 'Problems', description: 'Conditions', icon: 'warning', relativePath: 'fields/problems.json' },
			{ label: 'Allergies', description: 'Allergy intolerance', icon: 'alert', relativePath: 'fields/allergies.json' },
			{ label: 'Medications', description: 'Prescriptions', icon: 'symbol-method', relativePath: 'fields/medications.json' },
			{ label: 'Immunizations', description: 'Vaccines', icon: 'syringe', relativePath: 'fields/immunizations.json' },
			{ label: 'Lab Results', description: 'Diagnostic reports', icon: 'beaker', relativePath: 'fields/labs.json' },
			{ label: 'Appointments', description: 'Scheduling', icon: 'calendar', relativePath: 'fields/appointments.json' },
			{ label: 'Visit Notes', description: 'Clinical notes', icon: 'edit', relativePath: 'fields/visit-notes.json' },
			{ label: 'Documents', description: 'File uploads', icon: 'file', relativePath: 'fields/documents.json' },
			{ label: 'Referrals', description: 'Service requests', icon: 'link-external', relativePath: 'fields/referrals.json' },
			{ label: 'History', description: 'Family, social, surgical', icon: 'history', relativePath: 'fields/history.json' },
			{ label: 'Insurance', description: 'Coverage', icon: 'shield', relativePath: 'fields/insurance.json' },
			{ label: 'Practice', description: 'Organization info', icon: 'home', relativePath: 'fields/practice.json' },
			{ label: 'Providers', description: 'Practitioners', icon: 'account', relativePath: 'fields/providers.json' },
			{ label: 'Facilities', description: 'Locations', icon: 'server', relativePath: 'fields/facilities.json' },
			{ label: 'Referral Providers', description: 'External providers', icon: 'person-add', relativePath: 'fields/referral-providers.json' },
			{ label: 'Referral Practices', description: 'External orgs', icon: 'organization', relativePath: 'fields/referral-practices.json' },
		]
	},
];

// --- ViewPane: Config Explorer List ---

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
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const list = DOM.append(container, DOM.$('.ciyex-config-list'));
		list.style.padding = '8px 0';

		for (const entry of CONFIG_ENTRIES) {
			this._renderEntry(list, entry, 0);
		}
	}

	private _renderEntry(parent: HTMLElement, entry: ConfigEntry, depth: number): void {
		const row = DOM.append(parent, DOM.$('.ciyex-config-item'));
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.padding = '4px 12px';
		row.style.paddingLeft = `${12 + depth * 16}px`;
		row.style.cursor = entry.relativePath ? 'pointer' : 'default';
		row.style.gap = '8px';
		row.style.fontSize = '13px';
		row.style.borderRadius = '3px';

		if (entry.relativePath) {
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => this._openFile(entry.relativePath));
		}

		// Icon
		const iconEl = DOM.append(row, DOM.$('.codicon.codicon-' + entry.icon));
		iconEl.style.fontSize = '14px';
		iconEl.style.width = '16px';
		iconEl.style.color = 'var(--vscode-descriptionForeground)';

		// Label
		const label = DOM.append(row, DOM.$('span'));
		label.textContent = entry.label;
		if (!entry.relativePath && entry.children) {
			label.style.fontWeight = '600';
			label.style.textTransform = 'uppercase';
			label.style.fontSize = '11px';
			label.style.letterSpacing = '0.5px';
			label.style.color = 'var(--vscode-descriptionForeground)';
			label.style.marginTop = '8px';
		}

		// Description
		if (entry.description && entry.relativePath) {
			const desc = DOM.append(row, DOM.$('span'));
			desc.textContent = entry.description;
			desc.style.color = 'var(--vscode-descriptionForeground)';
			desc.style.fontSize = '11px';
			desc.style.marginLeft = 'auto';
		}

		// Children
		if (entry.children) {
			for (const child of entry.children) {
				this._renderEntry(parent, child, depth + 1);
			}
		}
	}

	private _openFile(relativePath: string): void {
		const workspace = this.workspaceService.getWorkspace();
		const root = workspace.folders[0]?.uri || URI.file('.');
		const fileUri = URI.joinPath(root, '.ciyex', relativePath);
		this.editorService.openEditor({ resource: fileUri, options: { pinned: true } });
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

// --- Register ViewContainer + View ---

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

const CONFIG_CONTAINER = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.config',
	title: localize2('ciyexConfig', "Ciyex Config"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.config', {}]),
	icon: configExplorerIcon,
	order: 100,
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: CiyexConfigPane.ID,
	name: localize2('configFiles', "Configuration Files"),
	ctorDescriptor: new SyncDescriptor(CiyexConfigPane),
	when: ContextKeyExpr.has('ciyex.role.admin'),
	canToggleVisibility: true,
	canMoveView: true,
	order: 0,
}], CONFIG_CONTAINER);
