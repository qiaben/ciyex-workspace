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
		const retry = setInterval(() => { if (this.loaded) { clearInterval(retry); return; } this._load(); }, 3000);
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
			icon.textContent = '📝';

			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;';

			const name = DOM.append(col, DOM.$('div'));
			name.textContent = item.name;
			name.style.cssText = 'font-weight:500;';

			const meta = DOM.append(col, DOM.$('div'));
			let updatedText = '';
			try { updatedText = new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { /* */ }
			meta.textContent = `${item.context} · ${updatedText}`;
			meta.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			// Delete button
			const delBtn = DOM.append(row, DOM.$('button'));
			delBtn.textContent = '🗑️';
			delBtn.title = 'Delete template';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:2px;opacity:0.5;';
			delBtn.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; });
			delBtn.addEventListener('mouseleave', () => { delBtn.style.opacity = '0.5'; });
			delBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				if (confirm(`Delete template "${item.name}"?`)) {
					await this.apiService.fetch(`/api/template-documents/${item.id}`, { method: 'DELETE' });
					this._load();
				}
			});
		}
	}

	private async _createTemplate(): Promise<void> {
		const name = prompt('Template name:');
		if (!name) { return; }

		try {
			await this.apiService.fetch('/api/template-documents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, context: 'PORTAL', content: '<h1>New Template</h1>' }),
			});
			this._load();
		} catch { /* */ }
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
