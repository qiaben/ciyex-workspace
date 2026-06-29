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
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface AccessRequest {
	id: number | string;
	patientName?: string;
	firstName?: string;
	lastName?: string;
	email: string;
	phone?: string;
	dateOfBirth?: string;
	status?: string;
	createdAt?: string;
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
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.access-request-pane'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		// "Open full page" button matches DocumentReview / FormSubmission panes —
		// gives users a one-click path to the Patient Approvals queue editor.
		const header = DOM.append(this.container, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const lbl = DOM.append(header, DOM.$('span'));
		lbl.textContent = 'Pending';
		lbl.style.cssText = 'font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.4px;';
		const openBtn = DOM.append(header, DOM.$('button'));
		openBtn.textContent = 'View All';
		openBtn.title = 'Open Patient Approvals full page';
		openBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;';
		openBtn.addEventListener('click', () => this.commandService.executeCommand('ciyex.openPatientApprovals'));

		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._load();
		const retry = mainWindow.setInterval(() => { if (this.loaded) { mainWindow.clearInterval(retry); return; } this._load(); }, 3000);
	}

	private async _load(): Promise<void> {
		try {
			// Backend exposes pending portal-user link approvals at
			// /api/portal/approvals/pending — the previous /api/portal/requests
			// path was a 404 and left the sidebar stuck on "Loading...".
			const res = await this.apiService.fetch('/api/portal/approvals/pending');
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
			// allow-any-unicode-next-line
			icon.textContent = '👤';

			const name = DOM.append(top, DOM.$('span'));
			const fullName = item.patientName || `${item.firstName || ''} ${item.lastName || ''}`.trim();
			name.textContent = fullName || item.email;
			name.style.cssText = 'font-weight:500;flex:1;';

			const date = DOM.append(top, DOM.$('span'));
			try { if (item.createdAt) { date.textContent = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } } catch { /* */ }
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
			// allow-any-unicode-next-line
			approveBtn.textContent = '✓ Approve';
			approveBtn.style.cssText = 'padding:2px 8px;background:#22c55e;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:10px;';
			approveBtn.addEventListener('click', async () => {
				const res = await this.apiService.fetch(`/api/portal/approvals/approve/${item.id}`, { method: 'PUT' });
				if (res.ok) {
					// Optimistic: drop the approved row immediately, reconcile in background.
					this.items = this.items.filter(i => i.id !== item.id);
					this._render();
					void this._load();
				}
			});

			const denyBtn = DOM.append(actions, DOM.$('button'));
			// allow-any-unicode-next-line
			denyBtn.textContent = '✗ Deny';
			denyBtn.style.cssText = 'padding:2px 8px;background:#ef4444;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:10px;';
			denyBtn.addEventListener('click', async () => {
				const reason = prompt('Denial reason:');
				if (reason !== null) {
					const res = await this.apiService.fetch(
						`/api/portal/approvals/reject/${item.id}?reason=${encodeURIComponent(reason || 'No reason provided')}`,
						{ method: 'PUT' },
					);
					if (res.ok) {
						// Optimistic: drop the denied row immediately, reconcile in background.
						this.items = this.items.filter(i => i.id !== item.id);
						this._render();
						void this._load();
					}
				}
			});
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
