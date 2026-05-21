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
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createActionIconButton, createOverflowMenuButton, createRowActionsContainer, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE } from '../sidebarActions.js';

type DataRow = Record<string, unknown> & { id?: string; fhirId?: string };

type RowActionKind =
	| { kind: 'edit' }
	| { kind: 'delete'; path: (r: DataRow) => string; confirm?: string }
	| { kind: 'method'; method: 'PUT' | 'POST'; path: (r: DataRow) => string; body?: Record<string, unknown>; confirm?: string };

interface RowAction { symbol: string; label: string; color: string; action: RowActionKind }

interface OperationsItem {
	id: string;
	icon: string;
	label: string;
	description: string;
	command: string;
	color: string;
	apiPath: string;
	titleField: string[];
	subtitleField?: string[];
	actions: RowAction[];
}

// Action sets per resource mirror the editor's Actions column exactly
// allow-any-unicode-next-line
const ITEMS: OperationsItem[] = [
	{
		// Patient Recall: \u{270F} Edit + Log Outreach + Delete (clinicalEditors.ts:2039)
		id: 'recall',
		// allow-any-unicode-next-line
		icon: '\u{1F514}',
		label: 'Patient Recall',
		description: 'Follow-up, outreach, compliance',
		command: 'ciyex.openRecall',
		color: '#f59e0b',
		apiPath: '/api/recalls?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['recallTypeName', 'status'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4DE}', label: 'Log Outreach', color: '#3b82f6', action: { kind: 'method', method: 'POST', path: r => `/api/recalls/${r.id}/outreach`, body: { method: 'phone', note: 'Logged from sidebar' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/recalls/${r.id}`, confirm: 'Delete this recall?' } },
		],
	},
	{
		// Medical Codes: \u{270F} Edit + Delete (clinicalEditors.ts:2144)
		id: 'codes',
		// allow-any-unicode-next-line
		icon: '\u{1F4D6}',
		label: 'Medical Codes',
		description: 'ICD-10, CPT, HCPCS, SNOMED',
		command: 'ciyex.openCodes',
		color: '#3b82f6',
		apiPath: '/api/global_codes?page=0&size=10',
		titleField: ['code'],
		subtitleField: ['description', 'codeType'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/global_codes/${r.id}`, confirm: 'Delete this code?' } },
		],
	},
	{
		// Inventory: \u{270F} Edit + Adjust Stock + Delete (clinicalEditors.ts:2243)
		id: 'inventory',
		// allow-any-unicode-next-line
		icon: '\u{1F4E6}',
		label: 'Inventory',
		description: 'Supplies, stock, orders',
		command: 'ciyex.openInventory',
		color: '#a855f7',
		apiPath: '/api/inventory?page=0&size=10',
		titleField: ['name', 'item'],
		subtitleField: ['quantity', 'status'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4E6}', label: 'Adjust Stock', color: '#06b6d4', action: { kind: 'method', method: 'POST', path: r => `/api/inventory/${r.id}/adjust`, body: { delta: 0, note: 'Adjusted from sidebar' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/inventory/${r.id}`, confirm: 'Delete this inventory item?' } },
		],
	},
	{
		// Payments (Transactions): \u{270F} Edit + \u{21A9} Refund + \u{2298} Void (clinicalEditors.ts:2690)
		id: 'payments',
		// allow-any-unicode-next-line
		icon: '\u{1F4B3}',
		label: 'Payments',
		description: 'Transactions, plans, ledger',
		command: 'ciyex.openPayments',
		color: '#22c55e',
		apiPath: '/api/payments/transactions?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['amount', 'status'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{21A9}', label: 'Refund', color: '#f59e0b', action: { kind: 'method', method: 'POST', path: r => `/api/payments/transactions/${r.id}/refund`, confirm: 'Refund this payment?' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2298}', label: 'Void', color: '#ef4444', action: { kind: 'method', method: 'POST', path: r => `/api/payments/transactions/${r.id}/void`, confirm: 'Void this payment?' } },
		],
	},
	{
		// Claims: \u{270F} Edit + Update Status + Send + \u{21BA} Void & Recreate (clinicalEditors.ts:3354)
		id: 'claims',
		// allow-any-unicode-next-line
		icon: '\u{1F4C4}',
		label: 'Claims',
		description: 'Claim submission, status tracking',
		command: 'ciyex.openClaims',
		color: '#06b6d4',
		apiPath: '/api/all-claims?page=0&size=10',
		titleField: ['claimNumber', 'patientName'],
		subtitleField: ['payerName', 'status'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4CB}', label: 'Update Status', color: '#3b82f6', action: { kind: 'method', method: 'PUT', path: r => `/api/all-claims/${r.id}/status`, body: { status: 'submitted' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4E4}', label: 'Send', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/all-claims/${r.id}/send` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{21BA}', label: 'Void & Recreate', color: '#f59e0b', action: { kind: 'method', method: 'POST', path: r => `/api/all-claims/${r.id}/void-recreate`, confirm: 'Void this claim and create a new one?' } },
		],
	},
];

export class OperationsMenuPane extends ViewPane {
	static readonly ID = 'ciyex.operations.menu';
	private container!: HTMLElement;
	private searchInput?: HTMLInputElement;
	private searchValue = '';
	private collapsed = new Set<string>();
	private counts = new Map<string, number>();
	private data = new Map<string, DataRow[]>();
	private loading = new Set<string>();
	private visibleCounts = new Map<string, number>();

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService k: IKeybindingService,
		@IContextMenuService cm: IContextMenuService,
		@IConfigurationService c: IConfigurationService,
		@IContextKeyService ck: IContextKeyService,
		@IViewDescriptorService v: IViewDescriptorService,
		@IInstantiationService i: IInstantiationService,
		@IOpenerService o: IOpenerService,
		@IThemeService t: IThemeService,
		@IHoverService h: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(options, k, cm, c, ck, v, i, o, t, h);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.operations-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';
		this._render();

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try { if (!localStorage.getItem('ciyex_token')) { return; } } catch { return; }
			win.clearInterval(poll);
			this._loadAllData();
		}, 2000);
	}

	private async _loadAllData(): Promise<void> {
		for (const item of ITEMS) { await this._loadItemData(item); }
	}

	private async _loadItemData(item: OperationsItem): Promise<void> {
		if (this.loading.has(item.id)) { return; }
		this.loading.add(item.id);
		try {
			const res = await this.apiService.fetch(item.apiPath);
			if (res.ok) {
				const data = await res.json();
				const rows = (data?.data?.content || data?.content || data?.data || (Array.isArray(data) ? data : [])) as DataRow[];
				this.data.set(item.id, rows);
				const total = data?.data?.totalElements ?? data?.totalElements ?? rows.length;
				this.counts.set(item.id, total);
			}
		} catch { /* */ }
		this.loading.delete(item.id);
		this._render();
	}

	private _render(): void {
		DOM.clearNode(this.container);
		this._renderHeader();
		this._renderSearch();
		this._renderQuickActions();
		this._renderItems();
	}

	private _renderHeader(): void {
		// Title is already shown by the VS Code view container + view pane headers.
		const header = DOM.append(this.container, DOM.$('.menu-header'));
		header.style.cssText = 'padding:6px 10px;display:flex;align-items:center;justify-content:flex-end;gap:6px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		createActionIconButton(header, '\u{21BB}', 'Refresh', () => this._loadAllData());
		createActionIconButton(header, '\u{21D5}', 'Collapse / Expand All', () => {
			if (this.collapsed.size === ITEMS.length) { this.collapsed.clear(); }
			else { ITEMS.forEach(i => this.collapsed.add(i.id)); }
			this._render();
		});
	}

	private _renderSearch(): void {
		const wrap = DOM.append(this.container, DOM.$('.search-row'));
		wrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		this.searchInput = input;
		input.type = 'text';
		input.placeholder = 'Filter operations...';
		input.value = this.searchValue;
		input.style.cssText = 'width:100%;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;box-sizing:border-box;';
		input.addEventListener('input', () => {
			this.searchValue = input.value;
			this._render();
			if (this.searchInput) { this.searchInput.focus(); this.searchInput.setSelectionRange(this.searchValue.length, this.searchValue.length); }
		});
	}

	private _renderQuickActions(): void {
		const bar = DOM.append(this.container, DOM.$('.quick-actions'));
		bar.style.cssText = 'display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const actions: Array<{ icon: string; label: string; command: string; color: string }> = [
			// allow-any-unicode-next-line
			{ icon: '\u{1F514}', label: 'Recall', command: 'ciyex.openRecall', color: '#f59e0b' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F4B3}', label: 'Pay', command: 'ciyex.openPayments', color: '#22c55e' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F4C4}', label: 'Claim', command: 'ciyex.openClaims', color: '#06b6d4' },
		];
		for (const a of actions) {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.title = `Quick: ${a.label}`;
			btn.style.cssText = `flex:1;padding:4px 6px;border:none;border-radius:3px;background:${a.color};color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;`;
			const ic = DOM.append(btn, DOM.$('span'));
			ic.textContent = a.icon;
			const lbl = DOM.append(btn, DOM.$('span'));
			lbl.textContent = a.label;
			lbl.style.cssText = 'font-weight:600;';
			btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
			btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
			btn.addEventListener('click', (e) => { e.stopPropagation(); this.commandService.executeCommand(a.command); });
		}
	}

	private _renderItems(): void {
		const q = this.searchValue.toLowerCase();
		const filtered = ITEMS.filter(i => !q || i.label.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
		if (filtered.length === 0) {
			const empty = DOM.append(this.container, DOM.$('.empty'));
			empty.style.cssText = 'padding:20px 10px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
			empty.textContent = 'No matching operations';
			return;
		}
		for (const item of filtered) { this._renderItem(item); }
	}

	private _renderItem(item: OperationsItem): void {
		const isCollapsed = this.collapsed.has(item.id);
		const row = DOM.append(this.container, DOM.$('.ops-row'));
		row.style.cssText = `padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);border-left:3px solid ${item.color};`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });
		row.addEventListener('click', () => this.commandService.executeCommand(item.command));

		const icon = DOM.append(row, DOM.$('span'));
		icon.textContent = item.icon;
		icon.style.cssText = `font-size:16px;width:24px;text-align:center;flex-shrink:0;color:${item.color};`;

		const col = DOM.append(row, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;';
		const labelRow = DOM.append(col, DOM.$('div'));
		labelRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const label = DOM.append(labelRow, DOM.$('span'));
		label.textContent = item.label;
		label.style.cssText = 'font-weight:500;font-size:12px;';

		const count = this.counts.get(item.id);
		if (typeof count === 'number') {
			const badge = DOM.append(labelRow, DOM.$('span'));
			badge.textContent = String(count);
			badge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:8px;background:${item.color};color:#fff;font-weight:600;`;
		}

		const desc = DOM.append(col, DOM.$('div'));
		desc.textContent = item.description;
		desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		const actionsEl = createRowActionsContainer(row);
		createActionIconButton(actionsEl, '+', `New ${item.label}`, () => this.commandService.executeCommand(item.command));
		createActionIconButton(actionsEl, '\u{21BB}', `Reload ${item.label}`, () => this._loadItemData(item));
		createActionIconButton(actionsEl, isCollapsed ? '\u{203A}' : '\u{2304}', isCollapsed ? 'Expand' : 'Collapse', () => {
			if (isCollapsed) {
				this.collapsed.delete(item.id);
				if (!this.data.has(item.id)) { this._loadItemData(item); }
			} else { this.collapsed.add(item.id); }
			this._render();
		});

		if (!isCollapsed) { this._renderDataRows(item); }
	}

	private _renderDataRows(item: OperationsItem): void {
		const sub = DOM.append(this.container, DOM.$('.sub-items'));
		sub.style.cssText = `padding:4px 0;border-bottom:1px solid rgba(128,128,128,0.06);background:rgba(128,128,128,0.03);`;
		const rows = this.data.get(item.id);
		if (!rows) {
			const loading = DOM.append(sub, DOM.$('div'));
			loading.style.cssText = 'padding:8px 10px 8px 38px;color:var(--vscode-descriptionForeground);font-size:11px;';
			loading.textContent = 'Loading...';
			return;
		}
		if (rows.length === 0) {
			const empty = DOM.append(sub, DOM.$('div'));
			empty.style.cssText = 'padding:8px 10px 8px 38px;color:var(--vscode-descriptionForeground);font-size:11px;';
			empty.textContent = `No ${item.label.toLowerCase()} yet`;
			return;
		}
		const visible = Math.min(this.visibleCounts.get(item.id) ?? SIDEBAR_INITIAL_PAGE_SIZE, rows.length);
		for (let i = 0; i < visible; i++) { this._renderDataRow(sub, item, rows[i]); }
		renderShowMoreFooter(
			sub,
			{ visibleCount: visible, totalCount: rows.length },
			(next) => { this.visibleCounts.set(item.id, next); this._render(); },
			() => { this.visibleCounts.set(item.id, SIDEBAR_INITIAL_PAGE_SIZE); this._render(); },
		);
	}

	private _getField(row: DataRow, fields: string[]): string {
		for (const f of fields) {
			const v = row[f];
			if (v !== undefined && v !== null && String(v).trim() !== '') { return String(v); }
		}
		return '';
	}

	private _renderDataRow(parent: HTMLElement, item: OperationsItem, row: DataRow): void {
		const dataRow = DOM.append(parent, DOM.$('.data-row'));
		dataRow.style.cssText = `padding:6px 10px 6px 38px;display:flex;align-items:center;gap:6px;border-left:2px solid ${item.color}44;cursor:pointer;`;
		dataRow.addEventListener('mouseenter', () => { dataRow.style.background = 'var(--vscode-list-hoverBackground)'; });
		dataRow.addEventListener('mouseleave', () => { dataRow.style.background = ''; });
		dataRow.addEventListener('click', () => this.commandService.executeCommand(item.command));

		const col = DOM.append(dataRow, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;overflow:hidden;';
		const title = DOM.append(col, DOM.$('div'));
		title.textContent = this._getField(row, item.titleField) || '(no title)';
		title.style.cssText = 'font-size:11px;font-weight:500;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		if (item.subtitleField) {
			const sub = DOM.append(col, DOM.$('div'));
			sub.textContent = this._getField(row, item.subtitleField);
			sub.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		}

		const status = String(row.status || '').toLowerCase();
		if (status) {
			const badge = DOM.append(dataRow, DOM.$('span'));
			badge.textContent = status;
			const statusColor = status.includes('active') || status.includes('completed') || status.includes('approved') || status.includes('paid') ? '#22c55e'
				: status.includes('cancel') || status.includes('void') || status.includes('denied') ? '#ef4444'
					: status.includes('pending') || status.includes('hold') ? '#f59e0b' : '#6b7280';
			badge.style.cssText = `font-size:8px;padding:1px 5px;border-radius:3px;background:${statusColor};color:#fff;font-weight:600;text-transform:capitalize;flex-shrink:0;`;
		}

		const actions = createRowActionsContainer(dataRow);
		createOverflowMenuButton(actions, () => item.actions.map(a => ({
			symbol: a.symbol,
			label: a.label,
			onClick: () => this._executeAction(item, row, a),
		})));
	}

	private async _executeAction(item: OperationsItem, row: DataRow, a: RowAction): Promise<void> {
		const k = a.action;
		if (k.kind === 'edit') { this.commandService.executeCommand(item.command); return; }
		if (k.kind === 'delete') {
			if (k.confirm) {
				const r = await this.dialogService.confirm({ message: k.confirm, type: 'warning', primaryButton: 'Delete' });
				if (!r.confirmed) { return; }
			}
			try { await this.apiService.fetch(k.path(row), { method: 'DELETE' }); } catch { /* */ }
			const current = this.data.get(item.id) || [];
			this.data.set(item.id, current.filter(r => (r.id || r.fhirId) !== (row.id || row.fhirId)));
			this._render();
			return;
		}
		if (k.kind === 'method') {
			if (k.confirm) {
				const r = await this.dialogService.confirm({ message: k.confirm, type: 'question' });
				if (!r.confirmed) { return; }
			}
			try {
				await this.apiService.fetch(k.path(row), {
					method: k.method,
					headers: k.body ? { 'Content-Type': 'application/json' } : undefined,
					body: k.body ? JSON.stringify(k.body) : undefined,
				});
			} catch { /* */ }
			await this._loadItemData(item);
		}
	}

	protected override layoutBody(h: number, w: number): void { super.layoutBody(h, w); }
}
