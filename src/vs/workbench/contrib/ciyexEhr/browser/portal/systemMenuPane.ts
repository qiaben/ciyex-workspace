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
import { mainWindow } from '../../../../../base/browser/window.js';

type DataRow = Record<string, unknown> & { id?: string; fhirId?: string };

type RowActionKind =
	| { kind: 'edit' }
	| { kind: 'delete'; path: (r: DataRow) => string; confirm?: string }
	| { kind: 'method'; method: 'PUT' | 'POST' | 'GET'; path: (r: DataRow) => string; body?: Record<string, unknown>; confirm?: string };

interface RowAction { symbol: string; label: string; color: string; action: RowActionKind }

interface SystemItem {
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
// (systemEditors.ts + clinicalEditors.ts CdsEditor)
// allow-any-unicode-next-line
const SYSTEM_ITEMS: SystemItem[] = [
	{
		// Clinical Alerts (CDS): \u{270F} Edit + \u{23FB} Toggle + Delete (clinicalEditors.ts:1297)
		id: 'alerts',
		// allow-any-unicode-next-line
		icon: '\u{26A0}',
		label: 'Clinical Alerts',
		description: 'CDS alerts and triggers',
		command: 'ciyex.openCds',
		color: '#f59e0b',
		apiPath: '/api/cds/rules?page=0&size=10',
		titleField: ['name', 'summary'],
		subtitleField: ['triggerType', 'severity'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{23FB}', label: 'Toggle', color: '#3b82f6', action: { kind: 'method', method: 'POST', path: r => `/api/cds/rules/${r.id}/toggle` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/cds/rules/${r.id}`, confirm: 'Delete this CDS rule?' } },
		],
	},
	{
		// Consents: \u{270F} Edit + \u{270D} Sign + Revoke + Delete (systemEditors.ts:205)
		id: 'consents',
		// allow-any-unicode-next-line
		icon: '\u{1F4DC}',
		label: 'Consents',
		description: 'HIPAA, treatment, research consents',
		command: 'ciyex.openConsents',
		color: '#3b82f6',
		apiPath: '/api/consents?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['category', 'status'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{270D}', label: 'Sign', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/consents/${r.id}/sign` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F6AB}', label: 'Revoke', color: '#f59e0b', action: { kind: 'method', method: 'POST', path: r => `/api/consents/${r.id}/revoke`, confirm: 'Revoke this consent?' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/consents/${r.id}`, confirm: 'Delete this consent?' } },
		],
	},
	{
		// Notifications: \u{270F} Edit + \u{2713} Mark Read + Delete
		id: 'notifications',
		// allow-any-unicode-next-line
		icon: '\u{1F514}',
		label: 'Notifications',
		description: 'System and portal notifications',
		command: 'ciyex.openNotifications',
		color: '#a855f7',
		apiPath: '/api/portal/notifications/my?page=0&size=10',
		titleField: ['title', 'message'],
		subtitleField: ['type', 'createdAt'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2713}', label: 'Mark Read', color: '#22c55e', action: { kind: 'method', method: 'PUT', path: r => `/api/portal/notifications/${r.id}/read` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/portal/notifications/${r.id}`, confirm: 'Delete this notification?' } },
		],
	},
	{
		// Fax: \u{270F} Edit + Assign to Patient + \u{2705} Mark Processed + Delete (systemEditors.ts:317)
		id: 'fax',
		// allow-any-unicode-next-line
		icon: '\u{1F4E0}',
		label: 'Fax',
		description: 'Inbound/outbound fax queue',
		command: 'ciyex.openFax',
		color: '#22c55e',
		apiPath: '/api/fax?page=0&size=10',
		titleField: ['to', 'from', 'subject'],
		subtitleField: ['status', 'createdAt'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F464}', label: 'Assign to Patient', color: '#3b82f6', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2705}', label: 'Mark Processed', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/fax/${r.id}/processed` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/fax/${r.id}`, confirm: 'Delete this fax?' } },
		],
	},
	{
		// Document Scanning: \u{270F} Edit + Re-OCR + Delete (systemEditors.ts:445)
		id: 'docscan',
		// allow-any-unicode-next-line
		icon: '\u{1F4F7}',
		label: 'Document Scanning',
		description: 'OCR upload and processing',
		command: 'ciyex.openDocScanning',
		color: '#06b6d4',
		apiPath: '/api/doc-scanning?page=0&size=10',
		titleField: ['patientName', 'description'],
		subtitleField: ['category', 'status'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F504}', label: 'Re-OCR', color: '#3b82f6', action: { kind: 'method', method: 'POST', path: r => `/api/doc-scanning/${r.id}/ocr` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/doc-scanning/${r.id}`, confirm: 'Delete this document?' } },
		],
	},
	{
		// Kiosk: \u{270F} Edit only (KioskEditor has its own UI)
		id: 'kiosk',
		// allow-any-unicode-next-line
		icon: '\u{1F5A5}',
		label: 'Check-in Kiosk',
		description: 'Kiosk config and check-ins',
		command: 'ciyex.openKiosk',
		color: '#ec4899',
		apiPath: '/api/kiosk/check-ins?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['status', 'checkedInAt'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
		],
	},
	{
		// Audit Log: Export CSV only (no per-row actions in editor; systemEditors.ts:629)
		id: 'audit',
		// allow-any-unicode-next-line
		icon: '\u{1F4CB}',
		label: 'Audit Log',
		description: 'System activity and compliance',
		command: 'ciyex.openAuditLog',
		color: '#6b7280',
		apiPath: '/api/admin/audit-log?page=0&size=10',
		titleField: ['user', 'username', 'action'],
		subtitleField: ['action', 'timestamp'],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4E5}', label: 'Export CSV', color: '#6b7280', action: { kind: 'method', method: 'GET', path: () => `/api/admin/audit-log/export` } },
		],
	},
];

export class SystemMenuPane extends ViewPane {
	static readonly ID = 'ciyex.system.menu';
	private container!: HTMLElement;
	private searchInput?: HTMLInputElement;
	private searchValue = '';
	private collapsed = new Set<string>();
	private counts = new Map<string, number>();
	private data = new Map<string, DataRow[]>();
	private loading = new Set<string>();

	private static _scrollbarStyleInjected = false;

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
		this.container = DOM.append(parent, DOM.$('.system-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;scrollbar-width:none;-ms-overflow-style:none;';
		if (!SystemMenuPane._scrollbarStyleInjected) {
			SystemMenuPane._scrollbarStyleInjected = true;
			const style = mainWindow.document.createElement('style');
			style.textContent = '.system-menu-pane::-webkit-scrollbar{display:none;width:0;height:0;}';
			mainWindow.document.head.appendChild(style);
		}
		this._render();

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try { if (!localStorage.getItem('ciyex_token')) { return; } } catch { return; }
			win.clearInterval(poll);
			this._loadAllData();
		}, 2000);
	}

	private async _loadAllData(): Promise<void> {
		for (const item of SYSTEM_ITEMS) { await this._loadItemData(item); }
	}

	private async _loadItemData(item: SystemItem): Promise<void> {
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
		const header = DOM.append(this.container, DOM.$('.menu-header'));
		header.style.cssText = 'padding:8px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;gap:6px;';
		const title = DOM.append(header, DOM.$('span'));
		title.textContent = 'System';
		title.style.cssText = 'flex:1;';
		this._headerBtn(header, '\u{21BB}', 'Refresh', () => this._loadAllData());
		this._headerBtn(header, '\u{21D5}', 'Collapse / Expand All', () => {
			if (this.collapsed.size === SYSTEM_ITEMS.length) { this.collapsed.clear(); }
			else { SYSTEM_ITEMS.forEach(i => this.collapsed.add(i.id)); }
			this._render();
		});
	}

	private _headerBtn(parent: HTMLElement, symbol: string, label: string, fn: () => void): void {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = symbol;
		btn.title = label;
		btn.style.cssText = 'padding:2px 6px;border:none;border-radius:3px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
		btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-list-hoverBackground)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
		btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
	}

	private _renderSearch(): void {
		const wrap = DOM.append(this.container, DOM.$('.search-row'));
		wrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		this.searchInput = input;
		input.type = 'text';
		input.placeholder = 'Filter system modules...';
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
			{ icon: '\u{26A0}', label: 'CDS', command: 'ciyex.openCds', color: '#f59e0b' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F514}', label: 'Alerts', command: 'ciyex.openNotifications', color: '#a855f7' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F4E0}', label: 'Fax', command: 'ciyex.openFax', color: '#22c55e' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F4CB}', label: 'Audit', command: 'ciyex.openAuditLog', color: '#6b7280' },
		];
		for (const a of actions) {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.title = `Quick: ${a.label}`;
			btn.style.cssText = `flex:1;padding:4px 6px;border:1px solid var(--vscode-editorWidget-border);border-radius:3px;background:transparent;color:${a.color};cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;`;
			const ic = DOM.append(btn, DOM.$('span'));
			ic.textContent = a.icon;
			const lbl = DOM.append(btn, DOM.$('span'));
			lbl.textContent = a.label;
			lbl.style.cssText = 'font-weight:600;';
			btn.addEventListener('mouseenter', () => { btn.style.background = `${a.color}15`; });
			btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
			btn.addEventListener('click', (e) => { e.stopPropagation(); this.commandService.executeCommand(a.command); });
		}
	}

	private _renderItems(): void {
		const q = this.searchValue.toLowerCase();
		const filtered = SYSTEM_ITEMS.filter(i => !q || i.label.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
		if (filtered.length === 0) {
			const empty = DOM.append(this.container, DOM.$('.empty'));
			empty.style.cssText = 'padding:20px 10px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
			empty.textContent = 'No matching modules';
			return;
		}
		for (const item of filtered) { this._renderItem(item); }
	}

	private _renderItem(item: SystemItem): void {
		const isCollapsed = this.collapsed.has(item.id);
		const row = DOM.append(this.container, DOM.$('.system-row'));
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
			badge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:8px;background:${item.color}22;color:${item.color};font-weight:600;`;
		}

		const desc = DOM.append(col, DOM.$('div'));
		desc.textContent = item.description;
		desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		const actionsEl = DOM.append(row, DOM.$('.row-actions'));
		actionsEl.style.cssText = 'display:flex;gap:2px;flex-shrink:0;';

		const newBtn = DOM.append(actionsEl, DOM.$('button')) as HTMLButtonElement;
		newBtn.textContent = '+';
		newBtn.title = `New ${item.label}`;
		newBtn.style.cssText = `padding:2px 6px;border:none;border-radius:3px;cursor:pointer;font-size:11px;background:${item.color}15;color:${item.color};font-weight:600;`;
		newBtn.addEventListener('mouseenter', () => { newBtn.style.background = `${item.color}30`; });
		newBtn.addEventListener('mouseleave', () => { newBtn.style.background = `${item.color}15`; });
		newBtn.addEventListener('click', (e) => { e.stopPropagation(); this.commandService.executeCommand(item.command); });

		const refreshBtn = DOM.append(actionsEl, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.textContent = '\u{21BB}';
		refreshBtn.title = `Reload ${item.label}`;
		refreshBtn.style.cssText = 'padding:2px 6px;border:none;border-radius:3px;cursor:pointer;font-size:11px;background:transparent;color:var(--vscode-descriptionForeground);';
		refreshBtn.addEventListener('mouseenter', () => { refreshBtn.style.background = 'var(--vscode-list-hoverBackground)'; });
		refreshBtn.addEventListener('mouseleave', () => { refreshBtn.style.background = 'transparent'; });
		refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); this._loadItemData(item); });

		const arrow = DOM.append(actionsEl, DOM.$('button')) as HTMLButtonElement;
		arrow.textContent = isCollapsed ? '\u{203A}' : '\u{2304}';
		arrow.title = isCollapsed ? 'Expand' : 'Collapse';
		arrow.style.cssText = 'padding:2px 6px;border:none;border-radius:3px;cursor:pointer;font-size:14px;background:transparent;color:var(--vscode-descriptionForeground);';
		arrow.addEventListener('click', (e) => {
			e.stopPropagation();
			if (isCollapsed) {
				this.collapsed.delete(item.id);
				if (!this.data.has(item.id)) { this._loadItemData(item); }
			} else { this.collapsed.add(item.id); }
			this._render();
		});

		if (!isCollapsed) { this._renderDataRows(item); }
	}

	private _renderDataRows(item: SystemItem): void {
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
		for (const data of rows) { this._renderDataRow(sub, item, data); }
	}

	private _getField(row: DataRow, fields: string[]): string {
		for (const f of fields) {
			const v = row[f];
			if (v !== undefined && v !== null && String(v).trim() !== '') { return String(v); }
		}
		return '';
	}

	private _renderDataRow(parent: HTMLElement, item: SystemItem, row: DataRow): void {
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

		const status = String(row.status || row.indicator || row.severity || '').toLowerCase();
		if (status) {
			const badge = DOM.append(dataRow, DOM.$('span'));
			badge.textContent = status;
			const statusColor = status.includes('active') || status.includes('completed') || status.includes('success') ? '#22c55e'
				: status.includes('critical') || status.includes('failed') || status.includes('cancelled') ? '#ef4444'
					: status.includes('warning') || status.includes('pending') ? '#f59e0b' : '#6b7280';
			badge.style.cssText = `font-size:8px;padding:1px 5px;border-radius:3px;background:${statusColor}22;color:${statusColor};font-weight:600;text-transform:capitalize;flex-shrink:0;`;
		}

		const actions = DOM.append(dataRow, DOM.$('.row-actions'));
		actions.style.cssText = 'display:flex;gap:2px;flex-shrink:0;';

		for (const a of item.actions) {
			const btn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = a.symbol;
			btn.title = a.label;
			btn.style.cssText = `padding:2px 5px;border:none;border-radius:3px;cursor:pointer;font-size:11px;background:${a.color}15;color:${a.color};font-weight:600;`;
			btn.addEventListener('mouseenter', () => { btn.style.background = `${a.color}30`; });
			btn.addEventListener('mouseleave', () => { btn.style.background = `${a.color}15`; });
			btn.addEventListener('click', (e) => { e.stopPropagation(); this._executeAction(item, row, a); });
		}
	}

	private async _executeAction(item: SystemItem, row: DataRow, a: RowAction): Promise<void> {
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
