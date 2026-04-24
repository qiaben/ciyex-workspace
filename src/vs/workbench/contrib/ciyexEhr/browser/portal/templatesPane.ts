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
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface TemplateDoc {
	id: number;
	name: string;
	context: string;
	updatedAt: string;
}

export class TemplatesPane extends ViewPane {
	static readonly ID = 'ciyex.portal.templates';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private items: TemplateDoc[] = [];
	private loaded = false;

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
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.templates-pane'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		// Toolbar
		const toolbar = DOM.append(this.container, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;padding:6px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		DOM.append(toolbar, DOM.$('span')).style.flex = '1';
		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+ New Template';
		addBtn.style.cssText = 'padding:2px 8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:11px;';
		addBtn.addEventListener('click', () => this._createTemplate());

		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._load();
		const win = DOM.getActiveWindow();
		const retry = win.setInterval(() => { if (this.loaded) { win.clearInterval(retry); return; } this._load(); }, 3000);
	}

	private async _load(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/template-documents?context=PORTAL');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.items = (data?.data || data?.content || data || []) as TemplateDoc[];
			this.loaded = true;
			this._render();
		} catch {
			this.listEl.textContent = 'Waiting for login...';
		}
	}

	private _render(): void {
		DOM.clearNode(this.listEl);
		if (this.items.length === 0) {
			const empty = DOM.append(this.listEl, DOM.$('div'));
			empty.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No portal templates';
			return;
		}

		for (const item of this.items) {
			const row = DOM.append(this.listEl, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(128,128,128,0.1);display:flex;align-items:center;gap:8px;cursor:pointer;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const icon = DOM.append(row, DOM.$('span'));
			icon.textContent = '\u{1F4DD}';

			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;';

			const name = DOM.append(col, DOM.$('div'));
			name.textContent = item.name;
			name.style.cssText = 'font-weight:500;';

			const meta = DOM.append(col, DOM.$('div'));
			let updatedText = '';
			try { updatedText = new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { /* */ }
			meta.textContent = `${item.context} \xb7 ${updatedText}`;
			meta.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			// Delete button
			const delBtn = DOM.append(row, DOM.$('button'));
			delBtn.textContent = '\u2715';
			delBtn.title = 'Delete template';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:2px 4px;color:var(--vscode-descriptionForeground);opacity:0.5;';
			delBtn.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; delBtn.style.color = '#ef4444'; });
			delBtn.addEventListener('mouseleave', () => { delBtn.style.opacity = '0.5'; delBtn.style.color = 'var(--vscode-descriptionForeground)'; });
			delBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const confirmed = await new Promise<boolean>(resolve => {
					const picker = this.quickInputService.createQuickPick<IQuickPickItem>();
					picker.title = `Delete template "${item.name}"?`;
					picker.placeholder = 'Type "delete" to confirm';
					picker.onDidAccept(() => {
						resolve(picker.value.toLowerCase() === 'delete');
						picker.dispose();
					});
					picker.onDidHide(() => { resolve(false); picker.dispose(); });
					picker.show();
				});
				if (confirmed) {
					try {
						await this.apiService.fetch(`/api/template-documents/${item.id}`, { method: 'DELETE' });
						this.notificationService.notify({ severity: Severity.Info, message: `Template "${item.name}" deleted` });
						this._load();
					} catch {
						this.notificationService.notify({ severity: Severity.Error, message: 'Failed to delete template' });
					}
				}
			});
		}
	}

	private async _createTemplate(): Promise<void> {
		const name = await new Promise<string | undefined>(resolve => {
			const inputBox = this.quickInputService.createInputBox();
			inputBox.title = 'Create New Template';
			inputBox.prompt = 'Enter template name';
			inputBox.placeholder = 'e.g., Welcome Letter';
			inputBox.onDidAccept(() => { resolve(inputBox.value.trim() || undefined); inputBox.dispose(); });
			inputBox.onDidHide(() => { resolve(undefined); inputBox.dispose(); });
			inputBox.show();
		});
		if (!name) { return; }

		try {
			const res = await this.apiService.fetch('/api/template-documents', {
				method: 'POST',
				body: JSON.stringify({ name, context: 'PORTAL', content: '<h1>New Template</h1>' }),
			});
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: `Template "${name}" created` });
				this._load();
			} else {
				const err = await res.text().catch(() => 'Unknown error');
				this.notificationService.notify({ severity: Severity.Error, message: `Failed to create template: ${err}` });
			}
		} catch {
			this.notificationService.notify({ severity: Severity.Error, message: 'Failed to create template' });
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
