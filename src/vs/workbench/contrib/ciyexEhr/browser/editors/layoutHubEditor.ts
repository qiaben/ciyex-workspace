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
import { IEditorOpenContext, EditorExtensions } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { LayoutHubEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IEditorPaneRegistry } from '../../../../browser/editor.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { createCiyexInlineEditorInput } from './ciyexInlineEditorInputs.js';
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
	{ key: 'template-documents', label: 'Template Documents', icon: '\u{1F4DD}', commandId: 'ciyex.openTemplateDocuments', description: 'Reusable templates for encounter notes and letters' },
	{ key: 'settings', label: 'Settings', icon: '\u{2699}', commandId: 'ciyex.openSettingsHub', description: 'General settings (Practice, Facilities, Users\u2026)' },
];

export class LayoutHubEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexLayoutHub';

	private root!: HTMLElement;
	private sidebarEl!: HTMLElement;
	private contentEl!: HTMLElement;
	/** Whether the "Layout Settings" tree group is collapsed in the sidebar. */
	private sidebarCollapsed = false;

	// Ciyex EHR: enable "embedded" mode where nav clicks mount their target
	// editor inside this hub's content area (keeping the LAYOUT SETTINGS
	// sidebar visible) rather than dispatching a command (which would open a
	// new tab). Toggled true by SettingsEditor2 when the hub is hosted inside
	// the User Settings page.
	private ciyexEmbeddedMode = false;
	setCiyexEmbeddedMode(enabled: boolean): void {
		this.ciyexEmbeddedMode = enabled;
	}

	// Currently nested editor inside contentEl (one of Chart / Menu /
	// Encounter / Portal / Template Documents / Settings).
	private nestedPane?: EditorPane;
	private nestedInput?: EditorInput;
	private nestedKey?: string;
	private contentBodyEl?: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService,
	) {
		super(LayoutHubEditor.ID, group, telemetryService, themeService, storageService);
	}

	// Click router for sidebar buttons + welcome cards. In standalone mode the
	// click dispatches the command (opens a new tab). In embedded mode it
	// mounts the target editor inside this hub's content area, preserving the
	// sub-sidebar.
	private dispatchNavCommand(item: NavItem): void {
		if (this.ciyexEmbeddedMode) {
			this.renderNested(item);
			return;
		}
		void this.commandService.executeCommand(item.commandId);
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
		nav.style.cssText = 'padding:4px;display:flex;flex-direction:column;gap:0;';

		// Collapsible "Layout" parent row (twistie) — native settings-TOC look:
		// 22px row, normal weight, subtle 0.9 opacity, indented child rows.
		const group = DOM.append(nav, DOM.$('.lh-tree-group'));
		group.style.cssText = 'display:flex;align-items:center;gap:2px;width:100%;height:22px;padding:0 8px 0 2px;cursor:pointer;user-select:none;opacity:0.9;';
		const twistie = DOM.append(group, DOM.$('span.codicon'));
		twistie.classList.add(this.sidebarCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down');
		twistie.style.cssText = 'flex-shrink:0;width:16px;font-size:16px;text-align:center;opacity:0.8;';
		const groupLabel = DOM.append(group, DOM.$('span'));
		groupLabel.textContent = 'Layout';
		groupLabel.style.cssText = 'flex:1;font-size:13px;line-height:22px;font-weight:400;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		group.addEventListener('mouseenter', () => { group.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; });
		group.addEventListener('mouseleave', () => { group.style.background = 'transparent'; });
		group.addEventListener('click', () => { this.sidebarCollapsed = !this.sidebarCollapsed; this._renderSidebar(); });

		if (this.sidebarCollapsed) { return; }

		for (const item of NAV_ITEMS) {
			const btn = DOM.append(nav, DOM.$('button'));
			const isActive = this.nestedKey === item.key;
			const baseBg = isActive ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent';
			const baseFg = isActive ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)';
			// Native settings-TOC look: 22px row; selected = selection bg + bold;
			// inactive = 0.9 opacity. Left padding (24px) indents past the twistie.
			btn.style.cssText = `display:flex;align-items:center;gap:6px;width:100%;height:22px;padding:0 8px 0 24px;background:${baseBg};border:none;cursor:pointer;text-align:left;color:${baseFg};opacity:${isActive ? '1' : '0.9'};font-size:13px;line-height:22px;font-weight:${isActive ? 'bold' : '400'};`;
			const label = DOM.append(btn, DOM.$('span'));
			label.textContent = item.label;
			label.style.cssText = 'flex:1;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			btn.addEventListener('mouseenter', () => { if (!isActive) { btn.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; } });
			btn.addEventListener('mouseleave', () => { btn.style.background = baseBg; });
			btn.addEventListener('click', () => { this.dispatchNavCommand(item); });
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
			card.addEventListener('click', () => { this.dispatchNavCommand(item); });

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
		// Forward layout to any nested editor so it resizes with the hub.
		if (this.nestedPane && this.contentBodyEl) {
			const rect = this.contentBodyEl.getBoundingClientRect();
			this.nestedPane.layout(new DOM.Dimension(rect.width || 0, rect.height || 0));
		}
	}

	// Mount the editor matching the clicked nav item inside this hub's content
	// area. Reuses createCiyexInlineEditorInput so the mapping stays in one
	// place. The LAYOUT SETTINGS sidebar remains visible at all times.
	private async renderNested(item: NavItem): Promise<void> {
		if (this.nestedKey === item.key) { return; }

		this.disposeNested();
		this.nestedKey = item.key;
		this._renderSidebar();

		// Reset the content area and host nested editor inside a body wrapper.
		DOM.clearNode(this.contentEl);
		this.contentEl.style.padding = '0';
		this.contentBodyEl = DOM.append(this.contentEl, DOM.$('.lh-nested-host'));
		this.contentBodyEl.style.cssText = 'position:relative;width:100%;height:100%;overflow:auto;';

		const input = createCiyexInlineEditorInput(item.commandId, this.instantiationService, this.environmentService);
		if (!input) {
			this.commandService.executeCommand(item.commandId);
			return;
		}

		const registry = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane);
		const descriptor = registry.getEditorPane(input);
		if (!descriptor) {
			input.dispose();
			this.commandService.executeCommand(item.commandId);
			return;
		}

		const pane = descriptor.instantiate(this.instantiationService, this.group);
		this.nestedPane = pane;
		this.nestedInput = input;

		pane.create(this.contentBodyEl);

		try {
			await pane.setInput(input, undefined, Object.create(null) as IEditorOpenContext, CancellationToken.None);
			pane.setVisible(true);
			const rect = this.contentBodyEl.getBoundingClientRect();
			pane.layout(new DOM.Dimension(rect.width || 0, rect.height || 0));
		} catch (err) {
			this.logService.error('[LayoutHubEditor] Failed to mount nested editor', err as Error);
		}
	}

	private disposeNested(): void {
		if (this.nestedPane) {
			try { this.nestedPane.clearInput(); } catch { /* ignore */ }
			try { this.nestedPane.setVisible(false); } catch { /* ignore */ }
			try { this.nestedPane.dispose(); } catch { /* ignore */ }
			this.nestedPane = undefined;
		}
		if (this.nestedInput) {
			this.nestedInput.dispose();
			this.nestedInput = undefined;
		}
		this.nestedKey = undefined;
		this.contentBodyEl = undefined;
	}

	override dispose(): void {
		this.disposeNested();
		super.dispose();
	}
}
