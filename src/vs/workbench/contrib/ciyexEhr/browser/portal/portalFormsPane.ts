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

interface PortalForm {
	id: number;
	title: string;
	formType: string;
	formKey: string;
	active: boolean;
	position: number;
}

export class PortalFormsPane extends ViewPane {
	static readonly ID = 'ciyex.portal.forms';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private items: PortalForm[] = [];
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
		this.container = DOM.append(parent, DOM.$('.portal-forms-pane'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		// Toolbar
		const toolbar = DOM.append(this.container, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;padding:6px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		DOM.append(toolbar, DOM.$('span')).style.flex = '1';
		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+ New Form';
		addBtn.style.cssText = 'padding:2px 8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:11px;';
		addBtn.addEventListener('click', () => this._createForm());

		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._load();
		const retry = setInterval(() => { if (this.loaded) { clearInterval(retry); return; } this._load(); }, 3000);
	}

	private async _load(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/portal/config/forms');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.items = (data?.data || data?.content || data || []) as PortalForm[];
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
			empty.textContent = 'No forms configured';
			return;
		}

		for (const item of this.items) {
			const row = DOM.append(this.listEl, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(128,128,128,0.1);display:flex;align-items:center;gap:8px;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const icon = DOM.append(row, DOM.$('span'));
			icon.textContent = '📋';

			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;min-width:0;';

			const title = DOM.append(col, DOM.$('div'));
			title.textContent = item.title;
			title.style.cssText = 'font-weight:500;';

			const meta = DOM.append(col, DOM.$('div'));
			meta.textContent = `${item.formType} · ${item.formKey}`;
			meta.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			// Active toggle
			const toggle = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			toggle.type = 'checkbox';
			toggle.checked = item.active;
			toggle.title = item.active ? 'Active' : 'Inactive';
			toggle.style.cssText = 'cursor:pointer;';
			toggle.addEventListener('change', async () => {
				await this.apiService.fetch(`/api/portal/config/forms/${item.id}/toggle?active=${toggle.checked}`, { method: 'PATCH' });
				this._load();
			});
		}
	}

	private async _createForm(): Promise<void> {
		const title = prompt('Form title:');
		if (!title) { return; }
		const formType = prompt('Form type (intake/consent/custom):', 'intake');
		if (!formType) { return; }

		try {
			await this.apiService.fetch('/api/portal/config/forms', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, formType, formKey: title.toLowerCase().replace(/\s+/g, '-'), active: true }),
			});
			this._load();
		} catch { /* */ }
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
