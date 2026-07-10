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
import { createActionIconButton, createOverflowMenuButton, createRowActionsContainer, openRecordEditDialog, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE, IEditFieldDef, withTypeaheadSearch, formFieldsToEditFields, resolveFieldDefault, parseSavedRecord } from '../sidebarActions.js';
import {
	PRESCRIPTIONS_FORM_FIELDS, LAB_ORDER_FORM_FIELDS, IMMUNIZATIONS_FORM_FIELDS,
	REFERRALS_FORM_FIELDS, CARE_PLANS_FORM_FIELDS, AUTHORIZATIONS_FORM_FIELDS, EDUCATION_FORM_FIELDS,
	renderCarePlanExtras,
} from '../editors/clinicalEditors.js';

type DataRow = Record<string, unknown> & { id?: string; fhirId?: string; patientId?: string };

type RowActionKind =
	| { kind: 'edit' }
	| { kind: 'delete'; path: (r: DataRow) => string; confirm?: string }
	| { kind: 'method'; method: 'PUT' | 'POST'; path: (r: DataRow) => string; body?: Record<string, unknown>; confirm?: string };

interface RowAction { symbol: string; label: string; color: string; action: RowActionKind }

interface ClinicalItem {
	id: string;
	icon: string;
	label: string;
	/** Short label for the top quick-action button bar (e.g. "Rx" for
	 *  Prescriptions). Falls back to {@link label} when omitted. */
	short?: string;
	description: string;
	command: string;
	color: string;
	apiPath: string;
	/**
	 * Endpoint the "+" create drawer POSTs to, derived from the submitted form
	 * values, when it differs from the list {@link apiPath}. Mirrors the editor
	 * config's `buildCreateUrl` — e.g. Lab Orders list at `/api/lab-order/search`
	 * but create at `/api/lab-order/{patientId}` (POSTing to the search path 500s).
	 */
	buildCreateUrl?: (payload: Record<string, unknown>) => string;
	/**
	 * Endpoint the Edit drawer PUTs to for a given row, when it differs from
	 * `{apiPath}/{id}`. Mirrors the editor config's `buildItemUrl` — e.g. Lab
	 * Orders edit at `/api/lab-order/{patientId}/{id}`.
	 */
	buildItemUrl?: (row: Record<string, unknown>) => string;
	titleField: string[];
	subtitleField?: string[];
	actions: RowAction[];
	/** Explicit edit-drawer schema mirroring the full editor formFields. */
	editFields?: IEditFieldDef[];
	/**
	 * Composite sections (e.g. Care Plans Goals / Interventions) rendered in the
	 * `+` create drawer below {@link editFields}, mirroring the full editor's
	 * `formExtras` hook so the quick-create form matches the editor form. Takes
	 * the pane's apiService so the sections can do their own lookups.
	 */
	formExtras?: (host: HTMLElement, editing: Record<string, unknown> | null, api: ICiyexApiService) => { collect: () => Record<string, unknown> };
}

// Action sets per resource mirror the editor's Actions column exactly
// (clinicalEditors.ts / systemEditors.ts).

// allow-any-unicode-next-line
const CLINICAL_ITEMS: ClinicalItem[] = [
	{
		// Prescriptions: \u{270F} Edit + \u{23F9} Discontinue + Delete (clinicalEditors.ts:383)
		id: 'prescriptions',
		// allow-any-unicode-next-line
		icon: '\u{1F48A}',
		label: 'Prescriptions',
		short: 'Rx',
		description: 'Active Rx, refills, discontinue',
		command: 'ciyex.openPrescriptions',
		color: '#f97316',
		apiPath: '/api/prescriptions?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['medicationName', 'status'],
		editFields: formFieldsToEditFields(PRESCRIPTIONS_FORM_FIELDS),
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{23F9}', label: 'Discontinue', color: '#f59e0b', action: { kind: 'method', method: 'POST', path: r => `/api/prescriptions/${r.id}/discontinue`, body: { reason: 'Discontinued from sidebar' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/prescriptions/${r.id}`, confirm: 'Delete this prescription?' } },
		],
	},
	{
		// Lab Orders: \u{270F} Edit + Update Status + Print Order + View Results + Delete (clinicalEditors.ts:539)
		id: 'labs',
		// allow-any-unicode-next-line
		icon: '\u{1F52C}',
		label: 'Lab Orders & Results',
		short: 'Lab',
		description: 'Order volume, status, turnaround',
		command: 'ciyex.openLabs',
		color: '#3b82f6',
		apiPath: '/api/lab-order/search?page=0&size=10',
		// Lab orders are patient-scoped on create/edit (mirrors LabsEditor):
		// POST /api/lab-order/{patientId}, PUT /api/lab-order/{patientId}/{id}.
		// The list/search path has no POST handler, so the `+` drawer was 500ing.
		buildCreateUrl: (p) => `/api/lab-order/${p.patientId}`,
		buildItemUrl: (r) => `/api/lab-order/${r.patientId}/${r.id}`,
		titleField: ['patientFirstName', 'patientName'],
		subtitleField: ['orderName', 'status'],
		editFields: formFieldsToEditFields(LAB_ORDER_FORM_FIELDS),
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F504}', label: 'Update Status', color: '#3b82f6', action: { kind: 'method', method: 'PUT', path: r => `/api/lab-order/${r.patientId}/${r.id}/status`, body: { status: 'completed' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5A8}', label: 'Print Order', color: '#6b7280', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4CA}', label: 'View Results', color: '#06b6d4', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/lab-order/${r.patientId}/${r.id}`, confirm: 'Delete this lab order?' } },
		],
	},
	{
		// Immunizations: \u{270F} Edit + Delete (clinicalEditors.ts:855)
		id: 'immunizations',
		// allow-any-unicode-next-line
		icon: '\u{1F489}',
		label: 'Immunizations',
		short: 'Imm',
		description: 'Vaccine records, CVX codes',
		command: 'ciyex.openImmunizations',
		color: '#22c55e',
		apiPath: '/api/immunizations?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['vaccineName', 'status'],
		editFields: formFieldsToEditFields(IMMUNIZATIONS_FORM_FIELDS),
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/immunizations/${r.id}`, confirm: 'Delete this immunization?' } },
		],
	},
	{
		// Referrals: \u{270F} Edit + Send + \u{2705} Acknowledge + Schedule + Complete + Cancel + Delete (clinicalEditors.ts:986)
		id: 'referrals',
		// allow-any-unicode-next-line
		icon: '\u{1F4CB}',
		label: 'Referrals',
		short: 'Ref',
		description: 'Status workflow, specialist tracking',
		command: 'ciyex.openReferrals',
		color: '#a855f7',
		apiPath: '/api/referrals?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['specialistName', 'status'],
		editFields: formFieldsToEditFields(REFERRALS_FORM_FIELDS),
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4E4}', label: 'Send', color: '#3b82f6', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/send` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2705}', label: 'Acknowledge', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/acknowledge` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4C5}', label: 'Schedule', color: '#06b6d4', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/schedule` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F3C1}', label: 'Complete', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/complete` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F6AB}', label: 'Cancel', color: '#f59e0b', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/cancel` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/referrals/${r.id}`, confirm: 'Delete this referral?' } },
		],
	},
	{
		// Prior Authorizations: \u{270F} Edit + \u{2713} Approve + \u{2717} Deny + Delete (clinicalEditors.ts:1400)
		id: 'authorizations',
		// allow-any-unicode-next-line
		icon: '\u{1F6E1}',
		label: 'Authorizations',
		short: 'Auth',
		description: 'Prior auth, approve/deny/appeal',
		command: 'ciyex.openAuthorizations',
		color: '#0ea5e9',
		apiPath: '/api/prior-auth?page=0&size=10',
		titleField: ['patientName', 'authNumber'],
		subtitleField: ['procedure', 'status'],
		editFields: formFieldsToEditFields(AUTHORIZATIONS_FORM_FIELDS),
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2713}', label: 'Approve', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/prior-auth/${r.id}/approve` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2717}', label: 'Deny', color: '#ef4444', action: { kind: 'method', method: 'POST', path: r => `/api/prior-auth/${r.id}/deny` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/prior-auth/${r.id}`, confirm: 'Delete this authorization?' } },
		],
	},
	{
		// Care Plans: \u{270F} Edit + Delete (clinicalEditors.ts:1120)
		id: 'careplans',
		// allow-any-unicode-next-line
		icon: '\u{2764}',
		label: 'Care Plans',
		short: 'Care',
		description: 'Goals, interventions, categories',
		command: 'ciyex.openCarePlans',
		color: '#ef4444',
		apiPath: '/api/care-plans?page=0&size=10',
		titleField: ['title', 'patientName'],
		subtitleField: ['patientName', 'status'],
		editFields: formFieldsToEditFields(CARE_PLANS_FORM_FIELDS),
		// Goals + Interventions mirror the editor's "New Care Plan" form (issue #23).
		formExtras: renderCarePlanExtras,
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/care-plans/${r.id}`, confirm: 'Delete this care plan?' } },
		],
	},
	{
		// Patient Education (Library): \u{270F} Edit + Delete (clinicalEditors.ts:1556)
		id: 'education',
		// allow-any-unicode-next-line
		icon: '\u{1F4DA}',
		label: 'Patient Education',
		short: 'Educ',
		description: 'Education materials and handouts',
		command: 'ciyex.openEducation',
		color: '#eab308',
		apiPath: '/api/education/materials?page=0&size=10',
		titleField: ['title'],
		subtitleField: ['category'],
		editFields: formFieldsToEditFields(EDUCATION_FORM_FIELDS),
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/education/materials/${r.id}`, confirm: 'Delete this material?' } },
		],
	},
];

export class ClinicalMenuPane extends ViewPane {
	static readonly ID = 'ciyex.clinical.menu';

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
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.clinical-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';
		this._render();

		// Auto-expand all on first show so user sees the data + action buttons
		for (const item of CLINICAL_ITEMS) { this.collapsed.delete(item.id); }

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try {
				const token = localStorage.getItem('ciyex_token');
				if (!token) { return; }
			} catch { return; }
			win.clearInterval(poll);
			this._loadAllData();
		}, 2000);
	}

	private async _loadAllData(): Promise<void> {
		// Concurrent section fetches — each endpoint is independent, so a serial
		// `for…await` made the rail's load time the SUM of all round-trips. Each
		// `_loadItemData` re-renders as it resolves, so sections appear progressively.
		await Promise.all(CLINICAL_ITEMS.map(item => this._loadItemData(item)));
	}

	/**
	 * Reflect a just-saved record in a section's cached rows immediately so the UI
	 * updates the instant Save completes, then reconcile with the server in the
	 * background. `mode: 'create'` prepends; `'update'` patches in place.
	 */
	private _applyOptimistic(item: ClinicalItem, record: DataRow, mode: 'create' | 'update'): void {
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
		void this._loadItemData(item);
	}

	private async _loadItemData(item: ClinicalItem): Promise<void> {
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
			if (this.collapsed.size === CLINICAL_ITEMS.length) { this.collapsed.clear(); }
			else { CLINICAL_ITEMS.forEach(i => this.collapsed.add(i.id)); }
			this._render();
		});
	}

	private _renderSearch(): void {
		const wrap = DOM.append(this.container, DOM.$('.search-row'));
		wrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		this.searchInput = input;
		input.type = 'text';
		input.placeholder = 'Filter clinical modules...';
		input.value = this.searchValue;
		input.style.cssText = 'width:100%;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;box-sizing:border-box;';
		input.addEventListener('input', () => {
			this.searchValue = input.value;
			this._render();
			// After _render, this.searchInput has been replaced with the new element.
			if (this.searchInput) { this.searchInput.focus(); this.searchInput.setSelectionRange(this.searchValue.length, this.searchValue.length); }
		});
	}

	private _renderQuickActions(): void {
		const bar = DOM.append(this.container, DOM.$('.quick-actions'));
		// Equal-width grid columns so every button is the same size regardless of
		// its label length. Columns fill the row and wrap onto extra rows.
		bar.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		// One quick button per clinical module (derived from CLINICAL_ITEMS) so the
		// bar always mirrors the full menu below instead of a hardcoded subset. The
		// bar wraps, so extra modules flow onto a second row.
		for (const item of CLINICAL_ITEMS) {
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
		const filtered = CLINICAL_ITEMS.filter(i => !q || i.label.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));

		if (filtered.length === 0) {
			const empty = DOM.append(this.container, DOM.$('.empty'));
			empty.style.cssText = 'padding:20px 10px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
			empty.textContent = 'No matching modules';
			return;
		}

		for (const item of filtered) {
			this._renderItem(item);
		}
	}

	private _renderItem(item: ClinicalItem): void {
		const isCollapsed = this.collapsed.has(item.id);

		const row = DOM.append(this.container, DOM.$('.clinical-row'));
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
		// The "New X" + button used to navigate to the full editor tab, which
		// the test team reported as "not working" — they expected an inline
		// create form (parity with the Edit drawer). Open the same drawer in
		// create mode so the user lands on a populated form right away.
		createActionIconButton(actionsEl, '+', `New ${item.label}`, () => this._openCreateDialog(item));
		createActionIconButton(actionsEl, '\u{21BB}', `Reload ${item.label}`, () => this._loadItemData(item));
		createActionIconButton(actionsEl, isCollapsed ? '\u{203A}' : '\u{2304}', isCollapsed ? 'Expand' : 'Collapse', () => {
			if (isCollapsed) {
				this.collapsed.delete(item.id);
				if (!this.data.has(item.id)) { this._loadItemData(item); }
			} else { this.collapsed.add(item.id); }
			this._render();
		});

		if (!isCollapsed) {
			this._renderDataRows(item);
		}
	}

	private _renderDataRows(item: ClinicalItem): void {
		const sub = DOM.append(this.container, DOM.$('.sub-items'));
		sub.style.cssText = `padding:4px 0 4px 0;border-bottom:1px solid rgba(128,128,128,0.06);background:rgba(128,128,128,0.03);`;

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
		for (let i = 0; i < visible; i++) {
			this._renderDataRow(sub, item, rows[i]);
		}
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

	private _renderDataRow(parent: HTMLElement, item: ClinicalItem, row: DataRow): void {
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
			const statusColor = status.includes('active') || status.includes('completed') ? '#22c55e'
				: status.includes('cancel') || status.includes('void') || status.includes('discontinue') ? '#ef4444'
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

	private async _executeAction(item: ClinicalItem, row: DataRow, a: RowAction): Promise<void> {
		const k = a.action;
		if (k.kind === 'edit') {
			this._openEditDialog(item, row);
			return;
		}
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
			void this._loadItemData(item);
		}
	}

	private _openCreateDialog(item: ClinicalItem): void {
		if (!item.editFields || item.editFields.length === 0) {
			// No drawer schema configured — fall back to the full editor.
			this.commandService.executeCommand(item.command);
			return;
		}
		const initialValues: Record<string, unknown> = {};
		// Resolve dynamic defaults (e.g. an auto-generated lab order number) fresh
		// per drawer open, so a new order gets a NEW number rather than one frozen
		// at config-build time.
		for (const f of item.editFields) { initialValues[f.key] = resolveFieldDefault(f) ?? ''; }
		const basePath = item.apiPath.split('?')[0].replace(/\/$/, '');
		openRecordEditDialog({
			title: `New ${item.label.replace(/s$/, '') || item.label}`,
			themeAnchor: this.container,
			fields: withTypeaheadSearch(item.editFields, this.apiService),
			values: initialValues,
			primaryLabel: 'Create',
			formExtras: item.formExtras ? (host, values) => item.formExtras!(host, values, this.apiService) : undefined,
			onSave: async (next) => {
				// Some resources create through a payload-derived endpoint (e.g. Lab
				// Orders: POST /api/lab-order/{patientId}); POSTing to the list/search
				// path 500s.
				const url = item.buildCreateUrl ? item.buildCreateUrl(next) : basePath;
				const res = await this.apiService.fetch(url, { method: 'POST', body: JSON.stringify(next) });
				if (!res.ok) { throw new Error(`Create failed (${res.status})`); }
				const saved = await parseSavedRecord(res) ?? { ...next };
				this._applyOptimistic(item, saved as DataRow, 'create');
				// Broadcast so an open module editor (e.g. Clinical > Prescriptions
				// list) reloads and shows the new record immediately.
				this.apiService.notifyClinicalRecordMutation({ entity: basePath, patientId: String((saved as Record<string, unknown>)['patientId'] ?? ''), kind: 'create', record: saved as Record<string, unknown> });
			},
		});
	}

	private _openEditDialog(item: ClinicalItem, row: DataRow): void {
		// Prefer the explicit editFields schema (mirrors the full editor's
		// formFields). Fall back to deriving from titleField + subtitleField +
		// Status when the resource doesn't define one yet.
		let fields: IEditFieldDef[];
		if (item.editFields && item.editFields.length > 0) {
			fields = item.editFields;
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
		openRecordEditDialog({
			title: `Edit ${item.label}`,
			themeAnchor: this.container,
			fields: withTypeaheadSearch(fields, this.apiService),
			values: initialValues,
			onSave: async (next) => {
				const payload = { ...row, ...next };
				const url = item.buildItemUrl ? item.buildItemUrl(payload) : `${basePath}/${id}`;
				const res = await this.apiService.fetch(url, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				const saved = await parseSavedRecord(res) ?? payload;
				this._applyOptimistic(item, saved as DataRow, 'update');
				// Broadcast so an already-open module editor reloads: a status
				// edited through this sidebar dialog persisted server-side but the
				// open Prescriptions editor kept showing the OLD status until a
				// manual reload (QA: prescription status not updated after editing).
				this.apiService.notifyClinicalRecordMutation({ entity: basePath, patientId: String((saved as Record<string, unknown>)['patientId'] ?? ''), kind: 'update', record: saved as Record<string, unknown> });
			},
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

/** Turn a camelCase key into a Title Cased label for the edit dialog. */
function humaniseFieldKey(key: string): string {
	return key
		.replace(/([A-Z])/g, ' $1')
		.replace(/[_-]+/g, ' ')
		.replace(/^./, c => c.toUpperCase())
		.trim();
}
