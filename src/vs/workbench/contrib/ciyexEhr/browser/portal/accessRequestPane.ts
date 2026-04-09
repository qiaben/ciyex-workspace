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

interface AccessRequest {
	id: number;
	patientName: string;
	email: string;
	phone?: string;
	dateOfBirth?: string;
	status: string;
	createdAt: string;
}

export class AccessRequestPane extends ViewPane {
	static readonly ID = 'ciyex.portal.accessrequests';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private items: AccessRequest[] = [];
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
		this.container = DOM.append(parent, DOM.$('.access-request-pane'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._load();
		const retry = setInterval(() => { if (this.loaded) { clearInterval(retry); return; } this._load(); }, 3000);
	}

	private async _load(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/portal/requests?status=pending&size=50');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.items = (data?.data?.content || data?.data || data?.content || data || []) as AccessRequest[];
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
			empty.textContent = 'No pending access requests';
			return;
		}

		for (const item of this.items) {
			const row = DOM.append(this.listEl, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(128,128,128,0.1);';

			const top = DOM.append(row, DOM.$('div'));
			top.style.cssText = 'display:flex;align-items:center;gap:6px;';

			const icon = DOM.append(top, DOM.$('span'));
			icon.textContent = '👤';

			const name = DOM.append(top, DOM.$('span'));
			name.textContent = item.patientName || item.email;
			name.style.cssText = 'font-weight:500;flex:1;';

			const date = DOM.append(top, DOM.$('span'));
			try { date.textContent = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { /* */ }
			date.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			const detail = DOM.append(row, DOM.$('div'));
			const parts = [item.email];
			if (item.dateOfBirth) { parts.push(`DOB: ${item.dateOfBirth}`); }
			detail.textContent = parts.join(' · ');
			detail.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;padding-left:22px;';

			// Actions
			const actions = DOM.append(row, DOM.$('div'));
			actions.style.cssText = 'display:flex;gap:4px;margin-top:4px;padding-left:22px;';

			const approveBtn = DOM.append(actions, DOM.$('button'));
			approveBtn.textContent = '✓ Approve';
			approveBtn.style.cssText = 'padding:2px 8px;background:#22c55e;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:10px;';
			approveBtn.addEventListener('click', async () => {
				await this.apiService.fetch(`/api/portal/requests/${item.id}/approve`, { method: 'POST' });
				this._load();
			});

			const denyBtn = DOM.append(actions, DOM.$('button'));
			denyBtn.textContent = '✗ Deny';
			denyBtn.style.cssText = 'padding:2px 8px;background:#ef4444;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:10px;';
			denyBtn.addEventListener('click', async () => {
				const reason = prompt('Denial reason:');
				if (reason !== null) {
					await this.apiService.fetch(`/api/portal/requests/${item.id}/deny`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ reason }),
					});
					this._load();
				}
			});
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
