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
import { RcmDashboardEditorInput } from './ciyexEditorInput.js';
import { ICiyexRcmApiService } from '../rcm/rcmApiService.js';
import * as DOM from '../../../../../base/browser/dom.js';

type Dict = Record<string, unknown>;

/**
 * RCM billing dashboard — the practice manager's money view: KPI cards
 * (charges, collected, days in A/R, denial rate), A/R aging buckets, payer
 * mix, and the work-queue summary with click-through to the claim editor.
 * All data comes from `/api/rcm/reports/*` + `/api/rcm/work-queue` through
 * the app-proxy.
 */
export class RcmDashboardEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexRcmDashboard';

	private root!: HTMLElement;
	private scrollArea!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexRcmApiService private readonly rcmApi: ICiyexRcmApiService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(RcmDashboardEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-rcm-dashboard.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';
		this.scrollArea = DOM.append(this.root, DOM.$('div'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;padding:18px 22px;';
	}

	override async setInput(input: RcmDashboardEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		DOM.clearNode(this.scrollArea);
		const loading = DOM.append(this.scrollArea, DOM.$('div'));
		loading.textContent = 'Loading RCM dashboard…';
		loading.style.cssText = 'color:var(--vscode-descriptionForeground);padding:8px 0;';

		// Independent widgets — fetch concurrently, each fails soft.
		const [kpi, aging, payerMix, workQueue] = await Promise.all([
			this._tryData<Dict>('/api/rcm/reports/kpi-dashboard'),
			this._tryData<Dict>('/api/rcm/reports/ar-aging'),
			this._tryList('/api/rcm/reports/payer-mix'),
			this._tryList('/api/rcm/work-queue?page=0&size=15'),
		]);
		if (token.isCancellationRequested) { return; }

		DOM.clearNode(this.scrollArea);
		this._renderTitleRow();
		this._renderKpiCards(kpi);
		const twoCol = DOM.append(this.scrollArea, DOM.$('div'));
		twoCol.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-top:16px;';
		this._renderAging(twoCol, aging);
		this._renderPayerMix(twoCol, payerMix);
		this._renderWorkQueue(workQueue);
	}

	private async _tryData<T>(path: string): Promise<T | null> {
		try {
			const json = await this.rcmApi.fetchJson<{ data?: T }>(path);
			return (json?.data ?? json) as T;
		} catch {
			return null;
		}
	}

	private async _tryList(path: string): Promise<Dict[]> {
		try {
			const json = await this.rcmApi.fetchJson<unknown>(path);
			return this.rcmApi.listOf(json);
		} catch {
			return [];
		}
	}

	private _money(v: unknown): string {
		const n = Number(v);
		return isNaN(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
	}

	private _renderTitleRow(): void {
		const row = DOM.append(this.scrollArea, DOM.$('div'));
		row.style.cssText = 'display:flex;align-items:baseline;gap:12px;margin-bottom:14px;';
		const title = DOM.append(row, DOM.$('span'));
		title.textContent = 'Billing Dashboard';
		title.style.cssText = 'font-size:17px;font-weight:600;';
		const sub = DOM.append(row, DOM.$('span'));
		sub.textContent = 'Revenue Cycle Management';
		sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
	}

	private _kpiCard(parent: HTMLElement, label: string, value: string, color: string): void {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = `padding:12px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;border-left:3px solid ${color};`;
		const v = DOM.append(card, DOM.$('div'));
		v.textContent = value;
		v.style.cssText = 'font-size:19px;font-weight:700;';
		const l = DOM.append(card, DOM.$('div'));
		l.textContent = label;
		l.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-top:2px;';
	}

	private _renderKpiCards(kpi: Dict | null): void {
		const grid = DOM.append(this.scrollArea, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;';
		if (!kpi) {
			const empty = DOM.append(grid, DOM.$('div'));
			empty.textContent = 'KPI data unavailable — is the RCM service reachable?';
			empty.style.cssText = 'color:var(--vscode-descriptionForeground);font-style:italic;grid-column:1/-1;';
			return;
		}
		this._kpiCard(grid, 'Total Charges', this._money(kpi.totalCharges), '#3b82f6');
		this._kpiCard(grid, 'Collected', this._money(kpi.totalCollected), '#22c55e');
		this._kpiCard(grid, 'Outstanding', this._money(kpi.totalPending), '#f59e0b');
		this._kpiCard(grid, 'Days in A/R', String(kpi.avgDaysInAr ?? '—'), '#06b6d4');
		this._kpiCard(grid, 'Collection Rate', kpi.collectionRate !== undefined ? `${kpi.collectionRate}%` : '—', '#16a34a');
		this._kpiCard(grid, 'Denial Rate', kpi.denialRate !== undefined ? `${kpi.denialRate}%` : '—', '#ef4444');
		this._kpiCard(grid, 'Clean Claim Rate', kpi.cleanClaimRate !== undefined ? `${kpi.cleanClaimRate}%` : '—', '#a855f7');
		this._kpiCard(grid, 'Claims', `${kpi.totalClaims ?? '—'}`, '#6b7280');
		this._kpiCard(grid, 'Denied Claims', `${kpi.deniedClaims ?? '—'}`, '#ef4444');
		this._kpiCard(grid, 'Open Tasks', `${Number(kpi.pendingTasks ?? 0) + Number(kpi.inProgressTasks ?? 0)}`, '#f59e0b');
	}

	private _panel(parent: HTMLElement, title: string): HTMLElement {
		const panel = DOM.append(parent, DOM.$('div'));
		panel.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const head = DOM.append(panel, DOM.$('div'));
		head.textContent = title;
		head.style.cssText = 'padding:9px 12px;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
		return panel;
	}

	private _emptyRow(panel: HTMLElement, message: string): void {
		const empty = DOM.append(panel, DOM.$('div'));
		empty.textContent = message;
		empty.style.cssText = 'padding:14px 12px;color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';
	}

	private _renderAging(parent: HTMLElement, aging: Dict | null): void {
		const panel = this._panel(parent, `A/R Aging${aging?.totalAr !== undefined ? ` — Total ${this._money(aging.totalAr)}` : ''}`);
		const buckets = (aging?.agingBuckets ?? {}) as Record<string, number>;
		const counts = (aging?.agingCounts ?? {}) as Record<string, number>;
		const labels = Object.keys(buckets);
		if (labels.length === 0) {
			this._emptyRow(panel, 'No open A/R.');
			return;
		}
		const max = Math.max(...labels.map(l => Number(buckets[l]) || 0), 1);
		for (const label of labels) {
			const amount = Number(buckets[label]) || 0;
			const row = DOM.append(panel, DOM.$('div'));
			row.style.cssText = 'padding:7px 12px;display:grid;grid-template-columns:64px 1fr 110px 60px;gap:10px;align-items:center;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;';
			DOM.append(row, DOM.$('span')).textContent = `${label} d`;
			const barWrap = DOM.append(row, DOM.$('div'));
			barWrap.style.cssText = 'height:8px;background:rgba(128,128,128,0.15);border-radius:4px;overflow:hidden;';
			const bar = DOM.append(barWrap, DOM.$('div'));
			const pct = Math.round((amount / max) * 100);
			bar.style.cssText = `height:100%;width:${pct}%;background:${label.startsWith('0') ? '#22c55e' : label.startsWith('3') ? '#06b6d4' : label.startsWith('6') ? '#f59e0b' : '#ef4444'};`;
			const amt = DOM.append(row, DOM.$('span'));
			amt.textContent = this._money(amount);
			amt.style.cssText = 'text-align:right;font-weight:600;';
			const cnt = DOM.append(row, DOM.$('span'));
			cnt.textContent = `${counts[label] ?? 0} clm`;
			cnt.style.cssText = 'text-align:right;color:var(--vscode-descriptionForeground);font-size:10px;';
		}
	}

	private _renderPayerMix(parent: HTMLElement, payerMix: Dict[]): void {
		const panel = this._panel(parent, 'Payer Mix');
		if (payerMix.length === 0) {
			this._emptyRow(panel, 'No payer data yet.');
			return;
		}
		for (const p of payerMix.slice(0, 10)) {
			const row = DOM.append(panel, DOM.$('div'));
			row.style.cssText = 'padding:7px 12px;display:flex;justify-content:space-between;gap:10px;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;';
			const name = DOM.append(row, DOM.$('span'));
			name.textContent = String(p.payerName ?? p.payer ?? p.name ?? 'Unknown');
			name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			const val = DOM.append(row, DOM.$('span'));
			const amount = p.totalCharges ?? p.charges ?? p.amount ?? p.total;
			const share = p.percentage ?? p.share;
			val.textContent = `${amount !== undefined ? this._money(amount) : ''}${share !== undefined ? ` (${share}%)` : ''}` || String(p.claimCount ?? p.count ?? '');
			val.style.cssText = 'font-weight:600;flex-shrink:0;';
		}
	}

	private _renderWorkQueue(items: Dict[]): void {
		const panel = this._panel(this.scrollArea, 'Work Queue');
		(panel.style as CSSStyleDeclaration).marginTop = '16px';
		if (items.length === 0) {
			this._emptyRow(panel, 'Work queue is empty — nothing to fix today.');
			return;
		}
		for (const item of items) {
			const row = DOM.append(panel, DOM.$('div'));
			row.style.cssText = 'padding:8px 12px;display:grid;grid-template-columns:110px 1fr 130px 90px 80px;gap:10px;align-items:center;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;cursor:pointer;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			const type = DOM.append(row, DOM.$('span'));
			type.textContent = String(item.taskType ?? '').replace(/_/g, ' ');
			type.style.cssText = 'font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);';
			const desc = DOM.append(row, DOM.$('span'));
			desc.textContent = String(item.description ?? item.claimNumber ?? '');
			desc.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			desc.title = String(item.description ?? '');
			DOM.append(row, DOM.$('span')).textContent = String(item.patientName ?? '');
			const pr = DOM.append(row, DOM.$('span'));
			pr.textContent = String(item.priority ?? '');
			pr.style.cssText = `font-size:10px;font-weight:600;color:${String(item.priority).toUpperCase() === 'HIGH' || String(item.priority).toUpperCase() === 'URGENT' ? '#ef4444' : 'var(--vscode-descriptionForeground)'};`;
			const st = DOM.append(row, DOM.$('span'));
			st.textContent = String(item.status ?? '').replace(/_/g, ' ').toLowerCase();
			st.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);text-transform:capitalize;';
			if (item.claimId) {
				row.addEventListener('click', () => {
					this.commandService.executeCommand('ciyex.rcm.openClaim', String(item.claimId), String(item.claimNumber ?? ''));
				});
			}
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
