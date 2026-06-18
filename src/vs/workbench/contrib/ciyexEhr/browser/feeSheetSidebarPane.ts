/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import * as DOM from '../../../../base/browser/dom.js';

interface FeeSheetSummary {
	id: string;
	encounterId: string;
	patientId: string;
	patientName: string;
	encounterDate: string;
	total: number;
}

/**
 * Fee Sheet activity-bar pane. Gives the Fee Sheet its own sidebar icon: a
 * "New Fee Sheet" button plus a list of saved fee sheets (when the backend
 * /api/fee-sheets endpoint is available). Each row reopens that fee sheet.
 */
export class FeeSheetSidebarPane extends ViewPane {

	static readonly ID = 'ciyex.fee-sheet.sidebar';

	private container!: HTMLElement;
	private listHost!: HTMLElement;
	private sheets: FeeSheetSummary[] = [];
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
		@ICommandService private readonly commandService: ICommandService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.NotAuthenticated) {
				this.sheets = [];
				this.loaded = false;
			} else if (state === CiyexAuthState.Authenticated) {
				this.sheets = [];
				this.loaded = false;
				if (this.container) { void this._loadAndRender(); }
			}
		}));
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.fee-sheet-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;overflow-x:hidden;font-size:12px;scrollbar-width:none;-ms-overflow-style:none;';

		const actionBar = DOM.append(this.container, DOM.$('div'));
		actionBar.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const newBtn = DOM.append(actionBar, DOM.$('button')) as HTMLButtonElement;
		newBtn.textContent = '+ New Fee Sheet';
		newBtn.style.cssText = 'width:100%;padding:6px 10px;border:none;border-radius:4px;background:#10b981;color:#fff;cursor:pointer;font-size:12px;font-weight:600;';
		newBtn.addEventListener('mouseenter', () => { newBtn.style.opacity = '0.85'; });
		newBtn.addEventListener('mouseleave', () => { newBtn.style.opacity = '1'; });
		newBtn.addEventListener('click', () => { this.commandService.executeCommand('ciyex.openFeeSheet'); });

		const hint = DOM.append(this.container, DOM.$('div'));
		hint.textContent = 'Fee sheets capture encounter charges and push them to billing.';
		hint.style.cssText = 'padding:8px 10px;color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.4;';

		this.listHost = DOM.append(this.container, DOM.$('div'));
		void this._loadAndRender();
	}

	private async _loadAndRender(): Promise<void> {
		if (!this.loaded) {
			try {
				const res = await this.apiService.fetch('/api/fee-sheets');
				if (res.ok) {
					const data = await res.json();
					const w = data?.data ?? data;
					const list = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
					this.sheets = list.map(d => ({
						id: d.id !== undefined && d.id !== null ? String(d.id) : '',
						encounterId: String(d.encounterId ?? ''),
						patientId: String(d.patientId ?? ''),
						patientName: String(d.patientName ?? d.patient ?? ''),
						encounterDate: String(d.encounterDate ?? d.serviceDate ?? d.createdAt ?? '').slice(0, 10),
						total: Number(d.total ?? d.totalFee ?? 0) || 0,
					}));
				}
				this.loaded = true;
			} catch {
				// Not authenticated / endpoint unavailable — show the empty state.
			}
		}
		this._renderList();
	}

	private _renderList(): void {
		if (!this.listHost) { return; }
		DOM.clearNode(this.listHost);

		if (this.sheets.length === 0) {
			const empty = DOM.append(this.listHost, DOM.$('div'));
			empty.textContent = 'No saved fee sheets yet.';
			empty.style.cssText = 'padding:14px 10px;color:var(--vscode-descriptionForeground);font-size:11px;font-style:italic;';
			return;
		}

		const header = DOM.append(this.listHost, DOM.$('div'));
		header.textContent = 'SAVED FEE SHEETS';
		header.style.cssText = 'padding:8px 10px 4px;font-size:10px;font-weight:700;letter-spacing:0.6px;color:var(--vscode-descriptionForeground);';

		for (const fs of this.sheets) {
			const row = DOM.append(this.listHost, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;cursor:pointer;border-bottom:1px solid rgba(128,128,128,0.06);border-left:3px solid #10b981;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => {
				this.commandService.executeCommand('ciyex.openFeeSheet', fs.encounterId, fs.patientId, fs.patientName, fs.encounterDate ? `Encounter ${fs.encounterDate}` : undefined);
			});
			const title = DOM.append(row, DOM.$('div'));
			title.textContent = fs.patientName || `Patient #${fs.patientId}`;
			title.style.cssText = 'font-weight:500;font-size:12px;';
			const sub = DOM.append(row, DOM.$('div'));
			sub.textContent = `${fs.encounterDate || ''}${fs.total ? ` · $${fs.total.toFixed(2)}` : ''}`.trim();
			sub.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
		}
	}
}
