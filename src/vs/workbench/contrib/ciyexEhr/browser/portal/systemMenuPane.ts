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

const ITEMS: Array<{ icon: string; label: string; description: string; command: string }> = [
	{ icon: '⚠️', label: 'Clinical Alerts', description: 'CDS alerts and triggers', command: 'ciyex.openCds' },
	{ icon: '📜', label: 'Consents', description: 'HIPAA, treatment, research consents', command: 'ciyex.openCalendar' },
	{ icon: '🔔', label: 'Notifications', description: 'System and portal notifications', command: 'ciyex.openCalendar' },
	{ icon: '📠', label: 'Fax', description: 'Inbound/outbound fax queue', command: 'ciyex.openCalendar' },
	{ icon: '📷', label: 'Document Scanning', description: 'OCR upload and processing', command: 'ciyex.openCalendar' },
	{ icon: '🖥️', label: 'Check-in Kiosk', description: 'Kiosk config and check-ins', command: 'ciyex.openCalendar' },
	{ icon: '📋', label: 'Audit Log', description: 'System activity and compliance', command: 'ciyex.openCalendar' },
];

const SETTINGS_ITEMS: Array<{ icon: string; label: string; description: string; command: string }> = [
	{ icon: '👥', label: 'User Management', description: 'Add, edit, delete users and assign roles', command: 'ciyex.openUserManagement' },
	{ icon: '🛡️', label: 'Roles & Permissions', description: 'Manage roles, permissions, FHIR scopes', command: 'ciyex.openRolesConfig' },
	{ icon: '🌐', label: 'Portal Settings', description: 'Patient portal features and navigation', command: 'ciyex.openPortalSettings' },
	{ icon: '📋', label: 'Encounter Settings', description: 'Encounter form sections and fields', command: 'ciyex.openEncounterConfig' },
	{ icon: '📐', label: 'Chart Layout', description: 'Patient chart tabs and field layout', command: 'ciyex.openChartLayout' },
	{ icon: '📑', label: 'Menu Configuration', description: 'Sidebar menu items and navigation', command: 'ciyex.openMenuConfig' },
	{ icon: '🎨', label: 'Calendar Colors', description: 'Appointment type and status colors', command: 'ciyex.openCalendarColors' },
	{ icon: '⚙️', label: 'Practice Settings', description: 'General practice configuration', command: 'ciyex.openSettings' },
];

export class SystemMenuPane extends ViewPane {
	static readonly ID = 'ciyex.system.menu';
	private container!: HTMLElement;

	constructor(options: IViewPaneOptions, @IKeybindingService k: IKeybindingService, @IContextMenuService cm: IContextMenuService, @IConfigurationService c: IConfigurationService, @IContextKeyService ck: IContextKeyService, @IViewDescriptorService v: IViewDescriptorService, @IInstantiationService i: IInstantiationService, @IOpenerService o: IOpenerService, @IThemeService t: IThemeService, @IHoverService h: IHoverService, @ICommandService private readonly commandService: ICommandService) {
		super(options, k, cm, c, ck, v, i, o, t, h);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.system-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';
		this._renderSection('System', ITEMS);
		this._renderSection('Settings', SETTINGS_ITEMS);
	}

	private _renderSection(title: string, items: typeof ITEMS): void {
		const header = DOM.append(this.container, DOM.$('div'));
		header.style.cssText = 'padding:8px 10px 4px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);letter-spacing:0.5px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		header.textContent = title;

		for (const item of items) {
			const row = DOM.append(this.container, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => this.commandService.executeCommand(item.command));
			DOM.append(row, DOM.$('span')).textContent = item.icon;
			(row.lastChild as HTMLElement).style.cssText = 'font-size:16px;width:24px;text-align:center;flex-shrink:0;';
			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;';
			DOM.append(col, DOM.$('div')).textContent = item.label;
			(col.firstChild as HTMLElement).style.cssText = 'font-weight:500;';
			DOM.append(col, DOM.$('div')).textContent = item.description;
			(col.lastChild as HTMLElement).style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			DOM.append(row, DOM.$('span')).textContent = '›';
			(row.lastChild as HTMLElement).style.cssText = 'color:var(--vscode-descriptionForeground);font-size:16px;flex-shrink:0;';
		}
	}

	protected override layoutBody(h: number, w: number): void { super.layoutBody(h, w); }
}
