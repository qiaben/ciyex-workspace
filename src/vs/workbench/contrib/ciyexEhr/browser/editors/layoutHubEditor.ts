/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { LayoutHubEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface NavItem {
	key: string;
	label: string;
	icon: string;
	commandId: string;
	description: string;
}

const NAV_ITEMS: NavItem[] = [
	{ key: 'chart', label: 'Chart', icon: '\u{1F4CA}', commandId: 'ciyex.openLayoutSettings', description: 'Tab manager and patient chart layout' },
	{ key: 'menu', label: 'Menu', icon: '\u{2630}', commandId: 'ciyex.openMenuConfig', description: 'Sidebar navigation items' },
	{ key: 'encounter', label: 'Encounter', icon: '\u{1F4CB}', commandId: 'ciyex.openEncounterConfig', description: 'Encounter form sections (CC, HPI, ROS, Plan\u2026)' },
	{ key: 'portal', label: 'Portal', icon: '\u{1F310}', commandId: 'ciyex.openPortalSettings', description: 'Patient portal \u2014 features, forms, navigation' },
	{ key: 'settings', label: 'Settings', icon: '\u{2699}', commandId: 'ciyex.openSettingsHub', description: 'General settings (Practice, Facilities, Users\u2026)' },
];

export class LayoutHubEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexLayoutHub';

	private root!: HTMLElement;
	private sidebarEl!: HTMLElement;
	private contentEl!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(LayoutHubEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.layout-hub-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';

		this.sidebarEl = DOM.append(this.root, DOM.$('.lh-sidebar'));
		this.sidebarEl.style.cssText = 'width:200px;flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background,rgba(0,0,0,0.06));overflow-y:auto;';

		this.contentEl = DOM.append(this.root, DOM.$('.lh-content'));
		this.contentEl.style.cssText = 'flex:1;overflow-y:auto;padding:32px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof LayoutHubEditorInput)) { return; }
		this._render();
	}

	private _render(): void {
		this._renderSidebar();
		this._renderWelcome();
	}

	private _renderSidebar(): void {
		DOM.clearNode(this.sidebarEl);

		const header = DOM.append(this.sidebarEl, DOM.$('div'));
		header.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const headerText = DOM.append(header, DOM.$('h2'));
		headerText.textContent = '\u{1F4CA} LAYOUT SETTINGS';
		headerText.style.cssText = 'margin:0;font-size:11px;font-weight:600;letter-spacing:1px;color:var(--vscode-descriptionForeground);';

		const nav = DOM.append(this.sidebarEl, DOM.$('nav'));
		nav.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:2px;';

		for (const item of NAV_ITEMS) {
			const btn = DOM.append(nav, DOM.$('button'));
			btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;background:transparent;border:none;border-radius:4px;cursor:pointer;text-align:left;color:var(--vscode-foreground);font-size:13px;';
			const icon = DOM.append(btn, DOM.$('span'));
			icon.textContent = item.icon;
			icon.style.cssText = 'flex-shrink:0;width:16px;text-align:center;';
			const label = DOM.append(btn, DOM.$('span'));
			label.textContent = item.label;
			label.style.cssText = 'flex:1;font-weight:500;';
			btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; });
			btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
			btn.addEventListener('click', () => { void this.commandService.executeCommand(item.commandId); });
		}
	}

	private _renderWelcome(): void {
		DOM.clearNode(this.contentEl);

		const title = DOM.append(this.contentEl, DOM.$('h1'));
		title.textContent = 'Layout Settings';
		title.style.cssText = 'margin:0 0 8px;font-size:24px;font-weight:600;';
		const sub = DOM.append(this.contentEl, DOM.$('p'));
		sub.textContent = 'Configure how the EHR is laid out for your practice. Choose a section from the sidebar.';
		sub.style.cssText = 'margin:0 0 32px;color:var(--vscode-descriptionForeground);font-size:14px;';

		const grid = DOM.append(this.contentEl, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;max-width:900px;';

		for (const item of NAV_ITEMS) {
			const card = DOM.append(grid, DOM.$('button'));
			card.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;background:transparent;color:var(--vscode-foreground);cursor:pointer;font-family:inherit;font-size:13px;transition:background 120ms;';
			card.addEventListener('mouseenter', () => { card.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; });
			card.addEventListener('mouseleave', () => { card.style.background = 'transparent'; });
			card.addEventListener('click', () => { void this.commandService.executeCommand(item.commandId); });

			const head = DOM.append(card, DOM.$('div'));
			head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
			const icon = DOM.append(head, DOM.$('span'));
			icon.textContent = item.icon;
			icon.style.cssText = 'font-size:16px;';
			const name = DOM.append(head, DOM.$('span'));
			name.textContent = item.label;
			name.style.cssText = 'font-weight:600;font-size:14px;';

			const desc = DOM.append(card, DOM.$('span'));
			desc.textContent = item.description;
			desc.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;';
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
