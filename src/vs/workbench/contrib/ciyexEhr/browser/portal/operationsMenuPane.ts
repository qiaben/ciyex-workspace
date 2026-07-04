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
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createActionIconButton, createOverflowMenuButton, createRowActionsContainer, openRecordEditDialog, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE, IEditFieldDef, withTypeaheadSearch, loadFieldOptions, formFieldsToEditFields, resolveFieldDefault, parseSavedRecord } from '../sidebarActions.js';
import { RECALL_FORM_FIELDS, MEDICAL_CODES_FORM_FIELDS, PAYMENTS_FORM_FIELDS, INVENTORY_FORM_FIELDS, setMedicalCodeActiveOverride, applyMedicalCodeActiveOverrides } from '../editors/clinicalEditors.js';

type DataRow = Record<string, unknown> & { id?: string; fhirId?: string };

type RowActionKind =
	| { kind: 'edit' }
	| { kind: 'delete'; path: (r: DataRow) => string; confirm?: string }
	| { kind: 'method'; method: 'PUT' | 'POST'; path: (r: DataRow) => string; body?: Record<string, unknown>; confirm?: string };

interface RowAction { symbol: string; label: string; color: string; action: RowActionKind }

/**
 * Per-resource edit form schema. When provided, the edit drawer renders this
 * exact list of fields instead of deriving them from titleField/subtitleField.
 * Use this to match the full schema the web EHR UI exposes (e.g. the Patient
 * Recall drawer shows Patient/Phone/Email/RecallType/Provider/DueDate/
 * Priority/Status/PreferredContact/Notes).
 */
interface OperationsItem {
	id: string;
	icon: string;
	label: string;
	/** Short label for the top quick-action button bar. Falls back to {@link label}. */
	short?: string;
	description: string;
	command: string;
	color: string;
	apiPath: string;
	/**
	 * Endpoint the "+" create drawer POSTs to, when it differs from the list
	 * {@link apiPath}. Mirrors the matching editor config's `buildCreateUrl`
	 * override — e.g. Payments lists at `/api/payments/transactions` (GET only)
	 * but creates via `/api/payments/collect` (the list path has no POST handler,
	 * so posting there 500s). Defaults to the list path's base when unset.
	 */
	createApiPath?: string;
	titleField: string[];
	subtitleField?: string[];
	actions: RowAction[];
	/** Optional explicit field schema for the Edit drawer. */
	editFields?: IEditFieldDef[];
	/**
	 * Whether this resource can be created from the sidebar "+" button. Defaults
	 * to true. Set false for read-only / derived resources (e.g. Claims, which
	 * are generated from invoices — `/api/all-claims` has no create endpoint, so
	 * a POST there 500s). Mirrors the `creatable: false` rule on the matching
	 * editor config.
	 */
	creatable?: boolean;
	/**
	 * Command-only entries open their editor on click but have no backing list
	 * resource (e.g. Fee Sheet, which is created per-encounter). They skip the
	 * data fetch, count badge, create/reload/collapse controls and data rows —
	 * the row is just a labeled nav button.
	 */
	commandOnly?: boolean;
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
		short: 'Recall',
		description: 'Follow-up, outreach, compliance',
		command: 'ciyex.openRecall',
		color: '#f59e0b',
		apiPath: '/api/recalls?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['recallTypeName', 'status'],
		editFields: formFieldsToEditFields(RECALL_FORM_FIELDS),
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
		short: 'Codes',
		description: 'ICD-10, CPT, HCPCS, SNOMED',
		command: 'ciyex.openCodes',
		color: '#3b82f6',
		apiPath: '/api/global_codes?page=0&size=10',
		titleField: ['code'],
		subtitleField: ['description', 'codeType'],
		editFields: formFieldsToEditFields(MEDICAL_CODES_FORM_FIELDS),
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
		short: 'Inv',
		description: 'Supplies, stock, orders',
		command: 'ciyex.openInventory',
		color: '#a855f7',
		apiPath: '/api/inventory?page=0&size=10',
		titleField: ['name', 'item'],
		subtitleField: ['quantity', 'status'],
		// Single source: derive the `+` drawer fields from the editor's
		// INVENTORY_FORM_FIELDS so the quick-create drawer is identical to the
		// "New Inventory" editor form (same fields, options, defaults, layout).
		editFields: formFieldsToEditFields(INVENTORY_FORM_FIELDS),
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4E6}', label: 'Adjust Stock', color: '#06b6d4', action: { kind: 'method', method: 'POST', path: r => `/api/inventory/${r.id}/adjust`, body: { delta: 0, note: 'Adjusted from sidebar' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/inventory/${r.id}`, confirm: 'Delete this inventory item?' } },
		],
	},
	// {
	// 	// Fee Sheet: command-only — opens a blank/manual fee sheet. Per-encounter
	// 	// fee sheets are created from the encounter chart, so there is no list.
	// 	id: 'fee-sheet',
	// 	// allow-any-unicode-next-line
	// 	icon: '\u{1F4B2}',
	// 	label: 'Fee Sheet',
	// 	description: 'Encounter charges & billing',
	// 	command: 'ciyex.openFeeSheet',
	// 	color: '#10b981',
	// 	apiPath: '',
	// 	titleField: [],
	// 	actions: [],
	// 	commandOnly: true,
	// 	creatable: false,
	// },
	{
		// Payments (Transactions): \u{270F} Edit + \u{21A9} Refund + \u{2298} Void (clinicalEditors.ts:2690)
		id: 'payments',
		// allow-any-unicode-next-line
		icon: '\u{1F4B3}',
		label: 'Payments',
		short: 'Pay',
		description: 'Transactions, plans, ledger',
		command: 'ciyex.openPayments',
		color: '#22c55e',
		apiPath: '/api/payments/transactions?page=0&size=10',
		// Create POSTs to /collect (the transactions list path has no POST handler);
		// mirrors PaymentsEditor `_transactionsConfig.buildCreateUrl`.
		createApiPath: '/api/payments/collect',
		titleField: ['patientName'],
		subtitleField: ['amount', 'status'],
		editFields: formFieldsToEditFields(PAYMENTS_FORM_FIELDS),
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
		short: 'Claim',
		description: 'Claim submission, status tracking',
		command: 'ciyex.openClaims',
		color: '#06b6d4',
		// Claims are derived from invoices via the patient flow — /api/all-claims
		// has no create route, so POSTing a new claim 500s. Mirror the Claims
		// editor's `creatable: false` and hide the sidebar "+" (QA #20).
		creatable: false,
		apiPath: '/api/all-claims?page=0&size=10',
		titleField: ['claimNumber', 'patientName'],
		subtitleField: ['payerName', 'status'],
		editFields: [
			{ key: 'patientName', label: 'Patient Name', required: true, placeholder: 'Search patient...', widthPct: 50 },
			{ key: 'patientId', label: 'Patient ID', placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'provider', label: 'Provider', required: true, placeholder: 'Search provider...', widthPct: 50 },
			{ key: 'providerId', label: 'Provider ID', placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'payerName', label: 'Payer Name', placeholder: 'Insurance payer', widthPct: 50 },
			{ key: 'diagnosisCode', label: 'Diagnosis Code', placeholder: 'e.g. Z00.00', widthPct: 50 },
			{ key: 'diagnosisDescription', label: 'Diagnosis Description', widthPct: 100 },
			{ key: 'policyNumber', label: 'Policy Number', placeholder: 'Policy number', widthPct: 50 },
			{ key: 'planName', label: 'Plan Name', placeholder: 'Plan name', widthPct: 50 },
			{
				key: 'type', label: 'Type', kind: 'select', widthPct: 50, options: [
					{ value: 'professional', label: 'Professional' }, { value: 'institutional', label: 'Institutional' },
					{ value: 'dental', label: 'Dental' }, { value: 'pharmacy', label: 'Pharmacy' },
				]
			},
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'DRAFT', label: 'Draft' }, { value: 'IN_PROCESS', label: 'In Process' },
					{ value: 'READY_FOR_SUBMISSION', label: 'Ready for Submission' },
					{ value: 'SUBMITTED', label: 'Submitted' }, { value: 'CLOSED', label: 'Closed' },
					{ value: 'VOID', label: 'Void' },
				]
			},
			{ key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Linked invoice number', widthPct: 50 },
			{ key: 'totalAmount', label: 'Total Amount ($)', kind: 'number', widthPct: 50 },
			{ key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Additional notes...', widthPct: 100 },
		],
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
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, k, cm, c, ck, v, i, o, t, h);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.operations-menu-pane'));
		// Keep scroll capability but hide the visible scrollbar so the operations
		// side menu reads as a clean nav list (issue: operations sidemenu scrollbar).
		this.container.style.cssText = 'height:100%;overflow-y:auto;overflow-x:hidden;font-size:12px;scrollbar-width:none;-ms-overflow-style:none;';
		this._render();

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try { if (!localStorage.getItem('ciyex_token')) { return; } } catch { return; }
			win.clearInterval(poll);
			this._loadAllData();
		}, 2000);
	}

	private async _loadAllData(): Promise<void> {
		// Fetch every section concurrently — they're independent endpoints, so a
		// serial `for…await` made the rail's total load time the SUM of all
		// section round-trips. Each `_loadItemData` re-renders as it resolves, so
		// sections still appear progressively.
		await Promise.all(ITEMS.filter(item => !item.commandOnly).map(item => this._loadItemData(item)));
	}

	/**
	 * Reflect a just-saved record in a section's cached rows *immediately* so the
	 * UI updates the instant Save completes, then reconcile with the server in
	 * the background to pick up any server-computed fields. `mode: 'create'`
	 * prepends; `'update'` patches the matching row in place.
	 */
	private _applyOptimistic(item: OperationsItem, record: DataRow, mode: 'create' | 'update'): void {
		const rows = this.data.get(item.id) || [];
		const idOf = (r: DataRow) => r.id ?? r.fhirId;
		if (mode === 'create') {
			this.data.set(item.id, [record, ...rows]);
			this.counts.set(item.id, (this.counts.get(item.id) ?? rows.length) + 1);
		} else {
			const target = idOf(record);
			this.data.set(item.id, rows.map(r => idOf(r) === target ? { ...r, ...record } : r));
		}
		this._render();
		// Background reconcile — non-blocking so the user never waits on it.
		void this._loadItemData(item);
	}

	private async _loadItemData(item: OperationsItem): Promise<void> {
		if (this.loading.has(item.id)) { return; }
		this.loading.add(item.id);
		try {
			const res = await this.apiService.fetch(item.apiPath);
			if (res.ok) {
				const data = await res.json();
				let rows = (data?.data?.content || data?.content || data?.data || (Array.isArray(data) ? data : [])) as DataRow[];
				// Medical Codes Active/Inactive isn't persisted by the backend, so
				// re-apply the locally-stored choice (shared with the Codes editor).
				if (item.id === 'codes') { rows = applyMedicalCodeActiveOverrides(rows as Record<string, unknown>[]) as DataRow[]; }
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
		// Equal-width grid columns so every button is the same size regardless of
		// its label length. Columns fill the row and wrap onto extra rows.
		bar.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		// One quick button per operations module (derived from ITEMS) so the bar
		// mirrors the full menu below. The bar wraps onto extra rows as needed.
		for (const item of ITEMS) {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.title = `Quick: ${item.label}`;
			btn.style.cssText = `padding:4px 6px;border:none;border-radius:3px;background:${item.color};color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;overflow:hidden;`;
			const ic = DOM.append(btn, DOM.$('span'));
			ic.textContent = item.icon;
			const lbl = DOM.append(btn, DOM.$('span'));
			lbl.textContent = item.short || item.label;
			lbl.style.cssText = 'font-weight:600;';
			btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
			btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
			btn.addEventListener('click', (e) => { e.stopPropagation(); this.commandService.executeCommand(item.command); });
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

		// Command-only entries (e.g. Fee Sheet) are pure nav buttons — no create /
		// reload / collapse controls and no data rows.
		if (item.commandOnly) { return; }

		const actionsEl = createRowActionsContainer(row);
		// Match the clinical pane: open the inline create drawer when an
		// editFields schema is defined, otherwise fall back to the full editor.
		// The previous version always called `executeCommand` which opened the
		// editor tab but didn't trigger its New form — the test team reported
		// these as "+ button not working".
		// Read-only / derived resources (creatable === false, e.g. Claims) get no
		// "+" button — their backing endpoint has no create route, so a POST 500s.
		if (item.creatable !== false) {
			createActionIconButton(actionsEl, '+', `New ${item.label}`, () => { void this._openCreateDialog(item); });
		}
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
			{ visibleCount: visible, totalCount: rows.length, noun: item.label.toLowerCase() },
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
		if (k.kind === 'edit') { await this._openEditDialog(item, row); return; }
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
			// Previously the result was ignored (errors swallowed, res.ok never
			// checked), so a failed action — e.g. voiding a payment whose status
			// isn't pending/completed (400), or a missing scope (403) — looked
			// like "nothing happened". Surface success and the backend's error
			// message so the action's outcome is always visible.
			try {
				const res = await this.apiService.fetch(k.path(row), {
					method: k.method,
					headers: k.body ? { 'Content-Type': 'application/json' } : undefined,
					body: k.body ? JSON.stringify(k.body) : undefined,
				});
				if (res.ok) {
					this.notificationService.notify({ severity: Severity.Info, message: `${a.label} succeeded.` });
				} else {
					const detail = await res.json().catch(() => null) as { message?: string } | null;
					this.notificationService.notify({ severity: Severity.Error, message: detail?.message || `${a.label} failed (${res.status}).` });
				}
			} catch {
				this.notificationService.notify({ severity: Severity.Error, message: `${a.label} failed. Please try again.` });
			}
			// Reconcile in the background so the menu stays responsive.
			void this._loadItemData(item);
		}
	}

	private async _openCreateDialog(item: OperationsItem): Promise<void> {
		if (!item.editFields || item.editFields.length === 0) {
			// No drawer schema defined yet — fall back to the full editor tab.
			this.commandService.executeCommand(item.command);
			return;
		}
		const initialValues: Record<string, unknown> = {};
		// Seed each field with its editor-defined default (e.g. payment Method=Cash,
		// Type=Payment, Status=Completed). The editor's create form applies these on
		// open; without them required selects (e.g. Method) start empty and the
		// create POST is rejected.
		for (const f of item.editFields) { initialValues[f.key] = resolveFieldDefault(f) ?? ''; }
		const basePath = item.apiPath.split('?')[0].replace(/\/$/, '');
		// Some resources create through a different endpoint than their list path
		// (e.g. Payments: list GET /transactions, create POST /collect). Posting to
		// the list path when it has no POST handler returns 500.
		const createPath = item.createApiPath ?? basePath;
		const fields = withTypeaheadSearch(await loadFieldOptions(item.editFields, this.apiService), this.apiService);
		// Keys backed by a boolean select (options are exactly true/false) — their
		// form value is the STRING 'true'/'false', but the backend model field is a
		// boolean, and any non-empty string is truthy. Coerce on create so a new
		// Medical Code created as Inactive actually persists as `false` (mirrors
		// the same coercion in _openEditDialog).
		const boolKeys = new Set(fields
			.filter(f => f.kind === 'select' && (f.options || []).length > 0
				&& (f.options || []).every(o => o.value === 'true' || o.value === 'false'))
			.map(f => f.key));
		openRecordEditDialog({
			title: `New ${item.label.replace(/s$/, '') || item.label}`,
			themeAnchor: this.container,
			fields,
			values: initialValues,
			primaryLabel: 'Create',
			onSave: async (next) => {
				for (const k of boolKeys) {
					if (Object.prototype.hasOwnProperty.call(next, k)) { next[k] = next[k] === 'true' || next[k] === true; }
				}
				const res = await this.apiService.fetch(createPath, { method: 'POST', body: JSON.stringify(next) });
				if (!res.ok) { throw new Error(`Create failed (${res.status})`); }
				// Show the new record instantly using the POST response (falling back
				// to the submitted values), then reconcile in the background.
				const saved = await parseSavedRecord(res) ?? { ...next };
				// Medical Codes: the backend ignores `active`, so persist the choice
				// locally (re-applied on every load).
				if (item.id === 'codes' && Object.prototype.hasOwnProperty.call(saved, 'active')) {
					setMedicalCodeActiveOverride((saved as DataRow).id ?? (saved as DataRow).fhirId, (saved as Record<string, unknown>).active === true);
				}
				this._applyOptimistic(item, saved as DataRow, 'create');
			},
		});
	}

	private async _openEditDialog(item: OperationsItem, row: DataRow): Promise<void> {
		// Prefer the per-resource editFields schema when defined (e.g. Patient
		// Recall ships the full Patient/Phone/Email/Recall Type/... grid that
		// the web EHR drawer renders). Otherwise fall back to deriving fields
		// from the displayed title + subtitle keys plus a Status select.
		let fields: IEditFieldDef[];
		if (item.editFields && item.editFields.length > 0) {
			fields = await loadFieldOptions(item.editFields, this.apiService);
		} else {
			const fieldKeys = [...item.titleField];
			if (item.subtitleField) {
				for (const k of item.subtitleField) { if (!fieldKeys.includes(k)) { fieldKeys.push(k); } }
			}
			fields = fieldKeys
				.filter(k => k !== 'status')
				.map(k => ({ key: k, label: humaniseFieldKey(k), widthPct: 100 } satisfies IEditFieldDef));
			fields.push({ key: 'status', label: 'Status', widthPct: 100 });
		}

		const initialValues: Record<string, unknown> = {};
		for (const f of fields) { initialValues[f.key] = row[f.key] ?? ''; }

		const id = row.id || row.fhirId;
		const basePath = item.apiPath.split('?')[0].replace(/\/$/, '');
		// Keys backed by a boolean select (options are exactly true/false) — their
		// form value is the STRING 'true'/'false', but the backend model field is a
		// boolean, and any non-empty string is truthy. Coerce them on save so e.g.
		// toggling a Medical Code Active→Inactive actually persists as `false`.
		const boolKeys = new Set(fields
			.filter(f => f.kind === 'select' && (f.options || []).length > 0
				&& (f.options || []).every(o => o.value === 'true' || o.value === 'false'))
			.map(f => f.key));
		openRecordEditDialog({
			title: `Edit ${item.label}`,
			themeAnchor: this.container,
			fields: withTypeaheadSearch(fields, this.apiService),
			values: initialValues,
			onSave: async (next) => {
				for (const k of boolKeys) {
					if (Object.prototype.hasOwnProperty.call(next, k)) { next[k] = next[k] === 'true' || next[k] === true; }
				}
				const payload = { ...row, ...next };
				const res = await this.apiService.fetch(`${basePath}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				// Patch the edited row in place instantly, then reconcile.
				const saved = await parseSavedRecord(res) ?? payload;
				// Medical Codes: backend ignores `active`; persist Active/Inactive
				// locally so it sticks across reloads (matches the Codes editor).
				if (item.id === 'codes' && Object.prototype.hasOwnProperty.call(next, 'active')) {
					setMedicalCodeActiveOverride(id, next.active === true);
					(saved as Record<string, unknown>).active = next.active === true;
				}
				this._applyOptimistic(item, saved as DataRow, 'update');
			},
		});
	}

	protected override layoutBody(h: number, w: number): void { super.layoutBody(h, w); }
}

function humaniseFieldKey(key: string): string {
	return key
		.replace(/([A-Z])/g, ' $1')
		.replace(/[_-]+/g, ' ')
		.replace(/^./, c => c.toUpperCase())
		.trim();
}
