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

interface DocumentReview {
	id: number;
	patientName: string;
	fileName: string;
	category: string;
	status: string;
	createdAt: string;
}

export class DocumentReviewPane extends ViewPane {
	static readonly ID = 'ciyex.portal.docreviews';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private items: DocumentReview[] = [];
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
		this.container = DOM.append(parent, DOM.$('.doc-review-pane'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		// "Open full page" button at the top so users can navigate to the full editor
		const header = DOM.append(this.container, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const lbl = DOM.append(header, DOM.$('span'));
		lbl.textContent = 'Pending';
		lbl.style.cssText = 'font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.4px;';
		const openBtn = DOM.append(header, DOM.$('button'));
		openBtn.textContent = 'View All';
		openBtn.title = 'Open Document Review full page';
		openBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;';
		openBtn.addEventListener('click', () => this.commandService.executeCommand('ciyex.openDocumentReview'));

		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._load();
		const retry = mainWindow.setInterval(() => { if (this.loaded) { mainWindow.clearInterval(retry); return; } this._load(); }, 3000);
	}

	private async _load(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/portal/document-reviews');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.items = (data?.data || data?.content || data || []) as DocumentReview[];
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
			empty.textContent = 'No pending document reviews';
			return;
		}

		for (const item of this.items) {
			const row = DOM.append(this.listEl, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(128,128,128,0.1);';

			const top = DOM.append(row, DOM.$('div'));
			top.style.cssText = 'display:flex;align-items:center;gap:6px;';

			const icon = DOM.append(top, DOM.$('span'));
			// allow-any-unicode-next-line
			icon.textContent = '\u{1F4C4}';

			const name = DOM.append(top, DOM.$('span'));
			name.textContent = item.patientName;
			name.style.cssText = 'font-weight:500;flex:1;';

			const date = DOM.append(top, DOM.$('span'));
			try { date.textContent = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { /* */ }
			date.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			const detail = DOM.append(row, DOM.$('div'));
			detail.textContent = `${item.fileName} · ${item.category || 'Document'}`;
			detail.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;padding-left:22px;';

			// Action buttons
			const actions = DOM.append(row, DOM.$('div'));
			actions.style.cssText = 'display:flex;gap:4px;margin-top:4px;padding-left:22px;';

			const acceptBtn = DOM.append(actions, DOM.$('button'));
			acceptBtn.textContent = '✓ Accept';
			acceptBtn.style.cssText = 'padding:2px 8px;background:#22c55e;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:10px;';
			acceptBtn.addEventListener('click', async () => {
				await this.apiService.fetch(`/api/portal/document-reviews/${item.id}/accept`, { method: 'PUT' });
				this._load();
			});

			const rejectBtn = DOM.append(actions, DOM.$('button'));
			// allow-any-unicode-next-line
			rejectBtn.textContent = '✗ Reject';
			rejectBtn.style.cssText = 'padding:2px 8px;background:#ef4444;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:10px;';
			rejectBtn.addEventListener('click', async () => {
				const reason = prompt('Rejection reason:');
				if (reason !== null) {
					await this.apiService.fetch(`/api/portal/document-reviews/${item.id}/reject?reason=${encodeURIComponent(reason)}`, { method: 'PUT' });
					this._load();
				}
			});
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
