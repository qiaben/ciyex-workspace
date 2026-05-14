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
import { mainWindow } from '../../../../../base/browser/window.js';

interface MenuItem {
	icon: string;
	label: string;
	description: string;
	command: string;
	args?: unknown[];
}

// allow-any-unicode-next-line
// "System" section — mirrors the System menu in the EHR Web UI
const SYSTEM_ITEMS: MenuItem[] = [
	// allow-any-unicode-next-line
	{ icon: '⚠️', label: 'Clinical Alerts', description: 'CDS alerts and triggers', command: 'ciyex.openCds' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F4DC}', label: 'Consents', description: 'HIPAA, treatment, research consents', command: 'ciyex.openConsents' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F514}', label: 'Notifications', description: 'System and portal notifications', command: 'ciyex.openNotifications' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F4E0}', label: 'Fax', description: 'Inbound/outbound fax queue', command: 'ciyex.openFax' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F4F7}', label: 'Document Scanning', description: 'OCR upload and processing', command: 'ciyex.openDocScanning' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F5A5}️', label: 'Check-in Kiosk', description: 'Kiosk config and check-ins', command: 'ciyex.openKiosk' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F4CB}', label: 'Audit Log', description: 'System activity and compliance', command: 'ciyex.openAuditLog' },
];

// allow-any-unicode-next-line
// "Settings" section — mirrors the EHR Web UI /settings page sidebar exactly:
//   FHIR resource settings (from /api/tab-field-config category=Settings),
//   then admin pages (Users / Roles & Permissions),
//   then built-ins (Form Options / Display / Calendar Colors).
// Each item opens the Settings Hub editor (`ciyex.openSettingsHub`) on the
// matching tab so the right pane is the same form/list the EHR UI shows.
const SETTINGS_ITEMS: MenuItem[] = [
	// allow-any-unicode-next-line
	{ icon: '\u{1F3E5}', label: 'Practice', description: 'Practice info, contact, logo', command: 'ciyex.openSettingsHub', args: ['practice'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F3E2}', label: 'Facilities', description: 'Locations and facility records', command: 'ciyex.openSettingsHub', args: ['facilities'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1FA7A}', label: 'Providers', description: 'Practitioners and credentials', command: 'ciyex.openSettingsHub', args: ['providers'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F6E1}️', label: 'Insurance', description: 'Payer directory and coverage rules', command: 'ciyex.openSettingsHub', args: ['insurance'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F3EB}', label: 'Referral Practices', description: 'External practices for referrals', command: 'ciyex.openSettingsHub', args: ['referral-practices'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F464}', label: 'Referral Providers', description: 'External providers for referrals', command: 'ciyex.openSettingsHub', args: ['referral-providers'] },
	// allow-any-unicode-next-line
	{ icon: '#', label: 'Codes', description: 'ICD-10, CPT, HCPCS, CDT lookups', command: 'ciyex.openSettingsHub', args: ['codes'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F4BC}', label: 'Services', description: 'Service catalog and pricing', command: 'ciyex.openSettingsHub', args: ['services'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F4C4}', label: 'Template Documents', description: 'Document templates and merge fields', command: 'ciyex.openSettingsHub', args: ['template-documents'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F465}', label: 'Users', description: 'User accounts and access', command: 'ciyex.openSettingsHub', args: ['__users__'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F6E1}', label: 'Roles & Permissions', description: 'RBAC, FHIR scopes', command: 'ciyex.openSettingsHub', args: ['__roles__'] },
	// allow-any-unicode-next-line
	{ icon: '⚙', label: 'Form Options', description: 'Option lists for select / radio fields', command: 'ciyex.openSettingsHub', args: ['__form-options__'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F5A5}', label: 'Display', description: 'Theme, font size, layout preferences', command: 'ciyex.openSettingsHub', args: ['__display__'] },
	// allow-any-unicode-next-line
	{ icon: '\u{1F3A8}', label: 'Calendar Colors', description: 'Customize calendar appointment colors', command: 'ciyex.openSettingsHub', args: ['__calendar-colors__'] },
];

// allow-any-unicode-next-line
// "Layout Settings" section — mirrors EHR Web UI /settings/layout-settings sidebar
const LAYOUT_ITEMS: MenuItem[] = [
	// allow-any-unicode-next-line
	{ icon: '\u{1F4CA}', label: 'Chart', description: 'Patient chart tabs and field mappings', command: 'ciyex.openLayoutSettings' },
	// allow-any-unicode-next-line
	{ icon: '☰', label: 'Menu', description: 'Sidebar navigation items', command: 'ciyex.openMenuConfig' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F4CB}', label: 'Encounter', description: 'Encounter form sections (CC, HPI, ROS, Plan)', command: 'ciyex.openEncounterConfig' },
	// allow-any-unicode-next-line
	{ icon: '\u{1F310}', label: 'Portal', description: 'Patient portal — features, forms, navigation', command: 'ciyex.openPortalSettings' },
];

export class SystemMenuPane extends ViewPane {
	static readonly ID = 'ciyex.system.menu';
	private container!: HTMLElement;

	/** Inject the WebKit scrollbar-hider stylesheet exactly once per session. */
	private static _scrollbarStyleInjected = false;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService k: IKeybindingService,
		@IContextMenuService cm: IContextMenuService,
		@IConfigurationService c: IConfigurationService,
		@IContextKeyService ck: IContextKeyService,
		@IViewDescriptorService v: IViewDescriptorService,
		@IInstantiationService i: IInstantiationService,
		@IOpenerService o: IOpenerService,
		@IThemeService t: IThemeService,
		@IHoverService h: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, k, cm, c, ck, v, i, o, t, h);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.system-menu-pane'));
		// Hide the visible scrollbar but keep wheel/scroll behavior working —
		// matches the EHR web UI's global "no scrollbar" rule. The `.system-menu-pane`
		// class lets the WebKit/Firefox-specific rules below target this pane only.
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;scrollbar-width:none;-ms-overflow-style:none;';
		// WebKit scrollbar hider — must be injected via stylesheet since the
		// `::-webkit-scrollbar` pseudo-element can't be set via element.style.
		if (!SystemMenuPane._scrollbarStyleInjected) {
			SystemMenuPane._scrollbarStyleInjected = true;
			const style = mainWindow.document.createElement('style');
			style.textContent = '.system-menu-pane::-webkit-scrollbar{display:none;width:0;height:0;}';
			mainWindow.document.head.appendChild(style);
		}
		this._renderSection('System', SYSTEM_ITEMS);
		this._renderSection('Settings', SETTINGS_ITEMS);
		this._renderSection('Layout Settings', LAYOUT_ITEMS);
	}

	private _renderSection(title: string, items: MenuItem[]): void {
		const header = DOM.append(this.container, DOM.$('div'));
		header.style.cssText = 'padding:8px 10px 4px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);letter-spacing:0.5px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		header.textContent = title;

		for (const item of items) {
			const row = DOM.append(this.container, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => this.commandService.executeCommand(item.command, ...(item.args || [])));
			DOM.append(row, DOM.$('span')).textContent = item.icon;
			(row.lastChild as HTMLElement).style.cssText = 'font-size:16px;width:24px;text-align:center;flex-shrink:0;';
			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;';
			DOM.append(col, DOM.$('div')).textContent = item.label;
			(col.firstChild as HTMLElement).style.cssText = 'font-weight:500;';
			DOM.append(col, DOM.$('div')).textContent = item.description;
			(col.lastChild as HTMLElement).style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			// allow-any-unicode-next-line
			DOM.append(row, DOM.$('span')).textContent = '›';
			(row.lastChild as HTMLElement).style.cssText = 'color:var(--vscode-descriptionForeground);font-size:16px;flex-shrink:0;';
		}
	}

	protected override layoutBody(h: number, w: number): void { super.layoutBody(h, w); }
}
