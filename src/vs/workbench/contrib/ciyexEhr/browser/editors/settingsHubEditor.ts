/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { SettingsHubEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface FieldDef {
	key: string;
	label: string;
	type?: string;
	required?: boolean;
	options?: Array<string | { value: string; label: string }>;
	placeholder?: string;
	showInTable?: boolean;
	readOnly?: boolean;
	rows?: number;
}

interface SectionDef {
	key?: string;
	label?: string;
	fields: FieldDef[];
}

interface FieldConfig {
	sections?: SectionDef[];
	singleton?: boolean;
}

interface TabFieldConfig {
	tabKey: string;
	label?: string;
	icon?: string;
	category?: string;
	fhirResources?: Array<unknown>;
	fieldConfig?: FieldConfig | string;
}

interface SidebarItem {
	key: string;
	label: string;
	icon: string;
	kind: 'fhir' | 'admin' | 'builtin' | 'command';
	commandId?: string;
}

const ADMIN_ITEMS: SidebarItem[] = [
	{ key: '__users__', label: 'Users', icon: '\u{1F465}', kind: 'admin' },
	{ key: '__roles__', label: 'Roles & Permissions', icon: '\u{1F6E1}', kind: 'admin' },
];

// Mirror the Ciyex web /settings sidebar: every item that has its own
// dedicated editor in the workspace shows up as a navigation row that runs
// the matching command. That keeps the sidebar 1:1 with the EHR-UI even
// though each click opens a dedicated editor (instead of swapping the hub's
// right pane). Command IDs are the same ones the gear menu / Ctrl+, used to
// expose individually before the Settings Hub redirect.
const BUILTIN_ITEMS: SidebarItem[] = [
	{ key: '__form-options__', label: 'Form Options', icon: '\u{2699}', kind: 'builtin' },
	{ key: '__display__', label: 'Display', icon: '\u{1F5A5}', kind: 'builtin' },
	{ key: '__calendar-colors__', label: 'Calendar Colors', icon: '\u{1F3A8}', kind: 'builtin' },
	{ key: '__layout-settings__', label: 'Layout Settings', icon: '\u{1F9F1}', kind: 'command', commandId: 'ciyex.openLayoutSettings' },
	{ key: '__layout-hub__', label: 'Layout Configuration', icon: '\u{1F4D0}', kind: 'command', commandId: 'ciyex.openLayoutHub' },
	{ key: '__menu-config__', label: 'Menu Configuration', icon: '\u{1F4DC}', kind: 'command', commandId: 'ciyex.openMenuConfig' },
	{ key: '__portal-settings__', label: 'Portal Settings', icon: '\u{1F310}', kind: 'command', commandId: 'ciyex.openPortalSettings' },
	{ key: '__practice-settings__', label: 'Practice Settings', icon: '\u{1F3E2}', kind: 'command', commandId: 'ciyex.openPracticeSettings' },
];

const ICON_MAP: Record<string, string> = {
	'Building2': '\u{1F3E2}',
	'Building': '\u{1F3E2}',
	'User': '\u{1F464}',
	'Users': '\u{1F465}',
	'Shield': '\u{1F6E1}',
	'CreditCard': '\u{1F4B3}',
	'Hash': '#',
	'FileText': '\u{1F4C4}',
	'Briefcase': '\u{1F4BC}',
	'Stethoscope': '\u{1FA7A}',
	'MapPin': '\u{1F4CD}',
	'ExternalLink': '\u{1F517}',
	'UserPlus': '\u{1F464}+',
	'Activity': '\u{2764}',
	'Heart': '\u{2764}',
	'Pill': '\u{1F48A}',
	'Calendar': '\u{1F4C5}',
	'Settings': '\u{2699}',
	'AlertCircle': '\u{26A0}',
	'AlertTriangle': '\u{26A0}',
	'Globe': '\u{1F310}',
	'Mail': '\u{1F4E7}',
};

type Mode = 'list' | 'view' | 'create' | 'edit';

export class SettingsHubEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexSettingsHub';

	private root!: HTMLElement;
	private sidebarEl!: HTMLElement;
	private contentEl!: HTMLElement;
	private fhirItems: SidebarItem[] = [];
	private activeKey: string = '';
	private mode: Mode = 'list';

	// Per-tab state
	private currentConfig: TabFieldConfig | null = null;
	private currentFieldConfig: FieldConfig | null = null;
	private records: Record<string, unknown>[] = [];
	private formData: Record<string, unknown> = {};
	private selectedRecord: Record<string, unknown> | null = null;
	private page: number = 0;
	private pageSize: number = 25;
	private totalElements: number = 0;
	private saving: boolean = false;
	private searchTerm: string = '';
	private validationErrors: Record<string, string> = {};

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(SettingsHubEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.settings-hub-editor'));
		this.root.style.cssText = 'height:100%;display:flex;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';

		this.sidebarEl = DOM.append(this.root, DOM.$('.sh-sidebar'));
		this.sidebarEl.style.cssText = 'width:224px;flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background,rgba(0,0,0,0.06));overflow-y:auto;';

		this.contentEl = DOM.append(this.root, DOM.$('.sh-content'));
		this.contentEl.style.cssText = 'flex:1;overflow-y:auto;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof SettingsHubEditorInput)) { return; }
		if (input.initialTab) {
			this.activeKey = input.initialTab;
		}
		await this._loadSidebar();
	}

	private async _loadSidebar(): Promise<void> {
		this._renderSidebarLoading();
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/all');
			if (res.ok) {
				const data: TabFieldConfig[] = await res.json();
				this.fhirItems = data
					.filter(d => d.category === 'Settings' && Array.isArray(d.fhirResources) && d.fhirResources.length > 0)
					.map(d => ({
						key: d.tabKey,
						label: d.label || this._titleCase(d.tabKey),
						icon: ICON_MAP[d.icon || 'FileText'] || '\u{1F4C4}',
						kind: 'fhir' as const,
					}));
			}
			if (!this.activeKey && this.fhirItems.length > 0) {
				this.activeKey = this.fhirItems[0].key;
			}
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login\u2026';
		}
	}

	private _renderSidebarLoading(): void {
		DOM.clearNode(this.sidebarEl);
		const loading = DOM.append(this.sidebarEl, DOM.$('div'));
		loading.textContent = 'Loading\u2026';
		loading.style.cssText = 'padding:16px;color:var(--vscode-descriptionForeground);';
	}

	private _render(): void {
		this._renderSidebar();
		this._renderContent();
	}

	private _renderSidebar(): void {
		DOM.clearNode(this.sidebarEl);

		const header = DOM.append(this.sidebarEl, DOM.$('.sh-sb-header'));
		header.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const headerText = DOM.append(header, DOM.$('h2'));
		headerText.textContent = '\u{2699} SETTINGS';
		headerText.style.cssText = 'margin:0;font-size:11px;font-weight:600;letter-spacing:1px;color:var(--vscode-descriptionForeground);';

		const nav = DOM.append(this.sidebarEl, DOM.$('nav'));
		nav.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:2px;';

		// FHIR-resource settings (Practice, Facilities, Providers, Insurance, etc.)
		for (const item of this.fhirItems) {
			this._renderSidebarBtn(nav, item);
		}

		// Divider
		if (this.fhirItems.length > 0) {
			const divider = DOM.append(nav, DOM.$('hr'));
			divider.style.cssText = 'border:none;border-top:1px solid var(--vscode-editorWidget-border);margin:8px 0;';
		}

		// Admin items
		for (const item of ADMIN_ITEMS) {
			this._renderSidebarBtn(nav, item);
		}

		const divider2 = DOM.append(nav, DOM.$('hr'));
		divider2.style.cssText = 'border:none;border-top:1px solid var(--vscode-editorWidget-border);margin:8px 0;';

		// Built-in
		for (const item of BUILTIN_ITEMS) {
			this._renderSidebarBtn(nav, item);
		}
	}

	private _renderSidebarBtn(parent: HTMLElement, item: SidebarItem): void {
		const btn = DOM.append(parent, DOM.$('button'));
		btn.dataset.key = item.key;
		const isActive = this.activeKey === item.key;
		btn.style.cssText = `display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;background:${isActive ? 'var(--vscode-list-activeSelectionBackground,#0e639c)' : 'transparent'};color:${isActive ? 'var(--vscode-list-activeSelectionForeground,#fff)' : 'var(--vscode-foreground)'};border:none;border-radius:4px;cursor:pointer;text-align:left;font-size:13px;`;
		const icon = DOM.append(btn, DOM.$('span'));
		icon.textContent = item.icon;
		icon.style.cssText = 'flex-shrink:0;width:16px;font-size:12px;text-align:center;';
		const label = DOM.append(btn, DOM.$('span'));
		label.textContent = item.label;
		label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		btn.addEventListener('mouseenter', () => { if (!isActive) { btn.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; } });
		btn.addEventListener('mouseleave', () => { if (!isActive) { btn.style.background = 'transparent'; } });
		btn.addEventListener('click', () => {
			// Command-kind items run their registered command (which opens
			// the dedicated editor for Layout Settings / Portal Settings /
			// Practice Settings / Menu Configuration / Layout Hub) instead
			// of swapping the hub's right pane.
			if (item.kind === 'command' && item.commandId) {
				void this.commandService.executeCommand(item.commandId);
				return;
			}
			this._onSidebarClick(item.key);
		});
	}

	private _onSidebarClick(key: string): void {
		this.activeKey = key;
		this.mode = 'list';
		this.formData = {};
		this.selectedRecord = null;
		this.searchTerm = '';
		this.page = 0;
		this.records = [];
		this.currentConfig = null;
		this.currentFieldConfig = null;
		this._render();
	}

	private _renderContent(): void {
		DOM.clearNode(this.contentEl);
		const key = this.activeKey;
		if (!key) {
			const ph = DOM.append(this.contentEl, DOM.$('div'));
			ph.style.cssText = 'padding:60px;text-align:center;color:var(--vscode-descriptionForeground);';
			ph.textContent = 'Select a settings page from the left.';
			return;
		}

		if (key === '__users__') { this._renderUsers(); return; }
		if (key === '__roles__') { this._renderRolesPermissions(); return; }
		if (key === '__form-options__') { this._renderFormOptions(); return; }
		if (key === '__display__') { this._renderDisplay(); return; }
		if (key === '__calendar-colors__') { this._renderCalendarColors(); return; }

		// FHIR resource settings — generic list/form
		this._renderFhirSection(key);
	}

	// allow-any-unicode-next-line
	// ─────────── FHIR Generic Section ───────────

	private listBodyEl: HTMLElement | null = null;

	private async _renderFhirSection(tabKey: string): Promise<void> {
		// Show a loading state
		const wrap = DOM.append(this.contentEl, DOM.$('div'));
		wrap.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';
		const loadEl = DOM.append(wrap, DOM.$('div'));
		loadEl.textContent = 'Loading\u2026';
		loadEl.style.cssText = 'color:var(--vscode-descriptionForeground);';

		// Load tab config if missing
		if (!this.currentConfig || this.currentConfig.tabKey !== tabKey) {
			try {
				const res = await this.apiService.fetch(`/api/tab-field-config/${encodeURIComponent(tabKey)}`);
				if (res.ok) {
					const json = await res.json();
					const c: TabFieldConfig = json.data || json;
					this.currentConfig = c;
					this.currentFieldConfig = typeof c.fieldConfig === 'string'
						? JSON.parse(c.fieldConfig)
						: (c.fieldConfig as FieldConfig | undefined) || null;
				}
			} catch { /* fall through */ }
			await this._fetchFhirRecords(tabKey);
		}

		DOM.clearNode(this.contentEl);
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		// Header
		const header = DOM.append(root, DOM.$('.sh-fhir-header'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;';

		const left = DOM.append(header, DOM.$('div'));
		const title = DOM.append(left, DOM.$('h1'));
		const item = this.fhirItems.find(i => i.key === tabKey);
		title.textContent = item?.label || this._titleCase(tabKey);
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(left, DOM.$('p'));
		sub.textContent = `${this.totalElements} record${this.totalElements === 1 ? '' : 's'}`;
		sub.style.cssText = 'margin:0;font-size:13px;color:var(--vscode-descriptionForeground);';

		const right = DOM.append(header, DOM.$('div'));
		right.style.cssText = 'display:flex;gap:8px;align-items:center;';

		if (this.mode === 'list') {
			// Search
			const search = DOM.append(right, DOM.$('input')) as HTMLInputElement;
			search.type = 'search';
			search.placeholder = 'Search\u2026';
			search.value = this.searchTerm;
			search.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;width:220px;outline:none;';
			search.addEventListener('input', () => { this.searchTerm = search.value; this._renderListBody(root); });

			const addBtn = DOM.append(right, DOM.$('button')) as HTMLButtonElement;
			addBtn.textContent = '+ Add';
			addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			addBtn.addEventListener('click', () => { this.mode = 'create'; this.formData = {}; this.selectedRecord = null; this._renderContent(); });
		} else {
			const backBtn = DOM.append(right, DOM.$('button'));
			backBtn.textContent = '← Back to list';
			backBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
			backBtn.addEventListener('click', () => { this.mode = 'list'; this.validationErrors = {}; this._renderContent(); });
		}

		if (this.mode === 'list') {
			this._renderListBody(root);
		} else {
			this._renderFormBody(root);
		}
	}

	private async _fetchFhirRecords(tabKey: string): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/fhir-resource/${encodeURIComponent(tabKey)}?page=${this.page}&size=${this.pageSize}`);
			if (res.ok) {
				const json = await res.json();
				const payload = json.data || json;
				if (payload.content) {
					this.records = payload.content;
					this.totalElements = payload.totalElements || this.records.length;
				} else if (Array.isArray(payload)) {
					this.records = payload;
					this.totalElements = payload.length;
				} else {
					this.records = [];
					this.totalElements = 0;
				}
			}
		} catch { /* ignore */ }
	}

	private _renderListBody(root: HTMLElement): void {
		// Clear body but keep header
		if (this.listBodyEl && this.listBodyEl.parentElement === root) {
			this.listBodyEl.remove();
		}
		const body = DOM.append(root, DOM.$('.sh-list-body'));
		this.listBodyEl = body;

		// Determine columns
		const cols = this._tableColumns();
		const filtered = this.searchTerm
			? this.records.filter(r => Object.values(this._flatten(r)).some(v => (v !== null && v !== undefined) && String(v).toLowerCase().includes(this.searchTerm.toLowerCase())))
			: this.records;

		if (filtered.length === 0) {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = this.searchTerm ? 'No records match your search.' : 'No records yet. Click + Add to create one.';
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
			return;
		}

		const tableWrap = DOM.append(body, DOM.$('div'));
		tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const table = DOM.append(tableWrap, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

		// Header row
		const thead = DOM.append(table, DOM.$('thead'));
		const tr = DOM.append(thead, DOM.$('tr'));
		tr.style.cssText = 'background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
		for (const col of cols) {
			const th = DOM.append(tr, DOM.$('th'));
			th.textContent = col.label;
			th.style.cssText = 'padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
		}
		const thActions = DOM.append(tr, DOM.$('th'));
		thActions.textContent = '';
		thActions.style.cssText = 'padding:10px 12px;width:160px;';

		// Body rows
		const tbody = DOM.append(table, DOM.$('tbody'));
		for (const r of filtered) {
			const flat = this._flatten(r);
			const row = DOM.append(tbody, DOM.$('tr'));
			row.style.cssText = 'border-bottom:1px solid rgba(128,128,128,0.1);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			for (const col of cols) {
				const td = DOM.append(row, DOM.$('td'));
				td.textContent = this._formatValue(flat[col.key]);
				td.style.cssText = 'padding:10px 12px;';
			}

			const actionsTd = DOM.append(row, DOM.$('td'));
			actionsTd.style.cssText = 'padding:10px 12px;text-align:right;white-space:nowrap;';

			this._tableAction(actionsTd, '\u{1F441}', 'View', () => { this._openRecord(r, 'view'); });
			this._tableAction(actionsTd, '\u270F', 'Edit', () => { this._openRecord(r, 'edit'); });
			this._tableAction(actionsTd, '\u{1F5D1}', 'Delete', () => { this._deleteRecord(r); }, 'danger');
		}

		// Pagination
		const totalPages = Math.max(1, Math.ceil(this.totalElements / this.pageSize));
		if (totalPages > 1) {
			const pag = DOM.append(body, DOM.$('div'));
			pag.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:14px;';
			const info = DOM.append(pag, DOM.$('span'));
			info.textContent = `Page ${this.page + 1} of ${totalPages} (${this.totalElements} total)`;
			info.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
			const ctrls = DOM.append(pag, DOM.$('div'));
			ctrls.style.cssText = 'display:flex;gap:6px;';
			const prev = DOM.append(ctrls, DOM.$('button')) as HTMLButtonElement;
			prev.textContent = '← Prev';
			prev.disabled = this.page === 0;
			prev.style.cssText = 'padding:5px 10px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:11px;';
			prev.addEventListener('click', async () => { this.page--; await this._fetchFhirRecords(this.activeKey); this._renderContent(); });
			const next = DOM.append(ctrls, DOM.$('button')) as HTMLButtonElement;
			next.textContent = 'Next \u2192';
			next.disabled = this.page >= totalPages - 1;
			next.style.cssText = 'padding:5px 10px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:11px;';
			next.addEventListener('click', async () => { this.page++; await this._fetchFhirRecords(this.activeKey); this._renderContent(); });
		}
	}

	private _tableAction(parent: HTMLElement, icon: string, title: string, fn: () => void, kind: 'normal' | 'danger' = 'normal'): void {
		const btn = DOM.append(parent, DOM.$('button'));
		btn.textContent = icon;
		btn.title = title;
		const color = kind === 'danger' ? 'var(--vscode-errorForeground,#f48771)' : 'var(--vscode-foreground)';
		btn.style.cssText = `background:transparent;border:none;cursor:pointer;color:${color};opacity:0.7;font-size:13px;padding:3px 8px;margin-left:2px;border-radius:3px;`;
		btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.06))'; btn.style.opacity = '1'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = ''; btn.style.opacity = '0.7'; });
		btn.addEventListener('click', () => fn());
	}

	private _tableColumns(): { key: string; label: string }[] {
		const cols: { key: string; label: string }[] = [];
		const fc = this.currentFieldConfig;
		if (fc?.sections?.length) {
			const hasShowInTable = fc.sections.some(s => s.fields.some(f => f.showInTable));
			for (const s of fc.sections) {
				for (const f of s.fields) {
					if (f.type === 'group' || f.type === 'computed' || f.type === 'textarea' || f.type === 'address') { continue; }
					if (hasShowInTable && !f.showInTable) { continue; }
					cols.push({ key: f.key, label: f.label });
					if (cols.length >= 6) { return cols; }
				}
			}
			if (cols.length > 0) { return cols; }
		}
		// Auto-detect from first record
		if (this.records.length > 0) {
			const first = this._flatten(this.records[0]);
			const skip = new Set(['id', 'fhirId', 'orgAlias', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'resourceType', 'meta']);
			for (const k of Object.keys(first)) {
				if (skip.has(k)) { continue; }
				const v = first[k];
				if (v && typeof v === 'object') { continue; }
				cols.push({ key: k, label: this._titleCase(k.replace(/\./g, ' ')) });
				if (cols.length >= 6) { break; }
			}
		}
		return cols;
	}

	private _openRecord(r: Record<string, unknown>, mode: Mode): void {
		this.selectedRecord = r;
		this.formData = { ...r, ...this._flatten(r) };
		this.mode = mode;
		this.validationErrors = {};
		this._renderContent();
	}

	private async _deleteRecord(r: Record<string, unknown>): Promise<void> {
		const id = (r as { id?: string; fhirId?: string }).id || (r as { fhirId?: string }).fhirId;
		if (!id) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Record has no ID \u2014 cannot delete.' });
			return;
		}
		const { confirmed } = await this.dialogService.confirm({ message: 'Delete this record? This cannot be undone.' });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/fhir-resource/${encodeURIComponent(this.activeKey)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
			if (res.ok) {
				await this._fetchFhirRecords(this.activeKey);
				this._renderContent();
				this.notificationService.notify({ severity: Severity.Info, message: 'Record deleted.' });
			} else {
				const err = await res.json().catch(() => null);
				this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Delete failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	// allow-any-unicode-next-line
	// ─────────── Form rendering ───────────

	private _renderFormBody(root: HTMLElement): void {
		const wrap = DOM.append(root, DOM.$('div'));
		wrap.style.cssText = 'background:var(--vscode-editor-background);';

		const fc = this.currentFieldConfig;
		const isView = this.mode === 'view';

		if (!fc?.sections?.length) {
			const note = DOM.append(wrap, DOM.$('div'));
			note.textContent = 'No field configuration defined for this resource. Edit the JSON directly via the API.';
			note.style.cssText = 'padding:24px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
			return;
		}

		for (const section of fc.sections) {
			const panel = DOM.append(wrap, DOM.$('.sh-form-panel'));
			panel.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;overflow:hidden;';

			const head = DOM.append(panel, DOM.$('div'));
			head.style.cssText = 'padding:10px 16px;background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
			const ht = DOM.append(head, DOM.$('h3'));
			ht.textContent = section.label || this._titleCase(section.key || '');
			ht.style.cssText = 'margin:0;font-size:13px;font-weight:600;';

			const body = DOM.append(panel, DOM.$('div'));
			body.style.cssText = 'padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px;';

			for (const field of section.fields) {
				if (field.type === 'group') { continue; }
				this._renderField(body, field, isView);
			}
		}

		// Action bar
		const actions = DOM.append(wrap, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px;';

		if (!isView) {
			const cancel = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			cancel.textContent = 'Cancel';
			cancel.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
			cancel.addEventListener('click', () => { this.mode = 'list'; this.validationErrors = {}; this._renderContent(); });

			const save = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			save.textContent = this.saving ? 'Saving\u2026' : (this.mode === 'create' ? 'Create' : 'Save');
			save.disabled = this.saving;
			save.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			save.addEventListener('click', () => this._saveRecord());
		}
	}

	private _renderField(parent: HTMLElement, field: FieldDef, isView: boolean): void {
		const span = field.type === 'textarea' || field.type === 'address' ? 2 : 1;
		const cell = DOM.append(parent, DOM.$('div'));
		cell.style.cssText = `grid-column:span ${span};`;

		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const lblText = DOM.append(lbl, DOM.$('span'));
		lblText.textContent = field.label;
		if (field.required) {
			const req = DOM.append(lbl, DOM.$('span'));
			req.textContent = ' *';
			req.style.color = 'var(--vscode-errorForeground,#f48771)';
		}

		const value = this.formData[field.key];
		const error = this.validationErrors[field.key];

		const inputStyle = `width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid ${error ? 'var(--vscode-errorForeground,#f48771)' : 'var(--vscode-input-border,#3c3c3c)'};border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;`;

		const t = field.type || 'text';

		// Special: active/isActive/enabled fields → toggle button
		const isActiveKey = field.key === 'active' || field.key === 'isActive' || field.key === 'enabled';
		if (isActiveKey && t !== 'boolean' && t !== 'checkbox' && t !== 'switch') {
			const isEnabled = value === true || value === 'true' || value === 1 || (value !== false && value !== 'false' && value !== 0 && value !== null && value !== undefined && value !== '');
			const wrap = DOM.append(cell, DOM.$('div'));
			wrap.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 0;';
			const sw = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
			let swVal = isEnabled;
			const updateSw = (v: boolean) => {
				sw.style.cssText = `position:relative;width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;background:${v ? '#22c55e' : 'rgba(128,128,128,0.4)'};transition:background 120ms;flex-shrink:0;`;
				DOM.clearNode(sw);
				const knob = DOM.append(sw, DOM.$('span'));
				knob.style.cssText = `position:absolute;top:3px;${v ? 'right:3px;' : 'left:3px;'}width:16px;height:16px;border-radius:50%;background:#fff;transition:right 120ms,left 120ms;`;
			};
			updateSw(swVal);
			if (!isView && !field.readOnly) {
				sw.addEventListener('click', () => { swVal = !swVal; updateSw(swVal); this.formData[field.key] = swVal; });
			} else {
				sw.disabled = true;
			}
			const statusLbl = DOM.append(wrap, DOM.$('span'));
			statusLbl.textContent = isEnabled ? 'Active' : 'Inactive';
			statusLbl.style.cssText = `font-size:12px;color:${isEnabled ? '#22c55e' : 'var(--vscode-descriptionForeground)'};font-weight:500;`;
			if (error) {
				const e = DOM.append(cell, DOM.$('div'));
				e.textContent = error;
				e.style.cssText = 'font-size:11px;color:var(--vscode-errorForeground,#f48771);margin-top:4px;';
			}
			return;
		}

		// Special: photo/photoUrl fields → file upload with preview
		const isPhotoKey = field.key === 'photo' || field.key === 'photoUrl' || field.key === 'logo' || field.key === 'logoUrl' || field.key === 'image' || field.key === 'imageUrl';
		if (isPhotoKey) {
			const wrap = DOM.append(cell, DOM.$('div'));
			wrap.style.cssText = 'display:flex;align-items:center;gap:10px;';
			const photoSrc = (value as string) || '';
			if (photoSrc) {
				const img = DOM.append(wrap, DOM.$('img')) as HTMLImageElement;
				img.src = photoSrc;
				img.style.cssText = 'width:48px;height:48px;border-radius:6px;object-fit:cover;border:1px solid var(--vscode-editorWidget-border);';
				img.onerror = () => { img.style.display = 'none'; };
			}
			if (!isView && !field.readOnly) {
				const fileInput = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				fileInput.type = 'file';
				fileInput.accept = 'image/*';
				fileInput.style.cssText = 'font-size:11px;color:var(--vscode-foreground);';
				fileInput.addEventListener('change', () => {
					const file = fileInput.files?.[0];
					if (!file) { return; }
					const reader = new FileReader();
					reader.onload = () => { this.formData[field.key] = reader.result as string; };
					reader.readAsDataURL(file);
				});
			} else {
				const urlEl = DOM.append(wrap, DOM.$('span'));
				urlEl.textContent = photoSrc || '-';
				urlEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);word-break:break-all;';
			}
			if (error) {
				const e = DOM.append(cell, DOM.$('div'));
				e.textContent = error;
				e.style.cssText = 'font-size:11px;color:var(--vscode-errorForeground,#f48771);margin-top:4px;';
			}
			return;
		}

		if (t === 'textarea') {
			const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
			ta.value = ((value === null || value === undefined) ? '' : String(value));
			ta.rows = field.rows || 3;
			ta.placeholder = field.placeholder || '';
			ta.readOnly = isView || !!field.readOnly;
			ta.style.cssText = inputStyle + 'font-family:inherit;resize:vertical;';
			ta.addEventListener('input', () => { this.formData[field.key] = ta.value; });
		} else if (t === 'select' || t === 'enum' || (Array.isArray(field.options) && field.options.length > 0)) {
			const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
			sel.disabled = isView || !!field.readOnly;
			sel.style.cssText = inputStyle.replace('var(--vscode-input-background)', 'var(--vscode-dropdown-background,var(--vscode-input-background))') + 'cursor:pointer;';
			const placeholder = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			placeholder.value = '';
			placeholder.textContent = field.placeholder || '\u2014 Select \u2014';
			for (const o of field.options || []) {
				const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				if (typeof o === 'string') { opt.value = o; opt.textContent = o; }
				else { opt.value = o.value; opt.textContent = o.label; }
				if (String(value || '') === opt.value) { opt.selected = true; }
			}
			sel.addEventListener('change', () => { this.formData[field.key] = sel.value; });
		} else if (t === 'boolean' || t === 'checkbox' || t === 'switch') {
			const wrap = DOM.append(cell, DOM.$('label'));
			wrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;';
			const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = !!value;
			cb.disabled = isView || !!field.readOnly;
			cb.addEventListener('change', () => { this.formData[field.key] = cb.checked; });
			const span = DOM.append(wrap, DOM.$('span'));
			span.textContent = cb.checked ? 'Enabled' : 'Disabled';
			cb.addEventListener('change', () => { span.textContent = cb.checked ? 'Enabled' : 'Disabled'; });
		} else if (t === 'number') {
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = 'number';
			inp.value = (value === null || value === undefined) ? '' : String(value);
			inp.placeholder = field.placeholder || '';
			inp.readOnly = isView || !!field.readOnly;
			inp.style.cssText = inputStyle;
			inp.addEventListener('input', () => { this.formData[field.key] = inp.value === '' ? null : parseFloat(inp.value); });
		} else if (t === 'date') {
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = 'date';
			const v = (value as string | null) || '';
			inp.value = typeof v === 'string' && v.length >= 10 ? v.substring(0, 10) : '';
			inp.readOnly = isView || !!field.readOnly;
			inp.style.cssText = inputStyle;
			inp.addEventListener('input', () => { this.formData[field.key] = inp.value || null; });
		} else {
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = t === 'email' ? 'email' : t === 'phone' || t === 'tel' ? 'tel' : t === 'url' ? 'url' : 'text';
			inp.value = (value === null || value === undefined) ? '' : String(value);
			inp.placeholder = field.placeholder || '';
			inp.readOnly = isView || !!field.readOnly;
			inp.style.cssText = inputStyle;
			inp.addEventListener('input', () => { this.formData[field.key] = inp.value; });
		}

		if (error) {
			const e = DOM.append(cell, DOM.$('div'));
			e.textContent = error;
			e.style.cssText = 'font-size:11px;color:var(--vscode-errorForeground,#f48771);margin-top:4px;';
		}
	}

	private async _saveRecord(): Promise<void> {
		// Required validation
		const errors: Record<string, string> = {};
		const fc = this.currentFieldConfig;
		if (fc?.sections) {
			for (const s of fc.sections) {
				for (const f of s.fields) {
					if (f.required) {
						const v = this.formData[f.key];
						if ((v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))) {
							errors[f.key] = `${f.label} is required`;
						}
					}
				}
			}
		}
		this.validationErrors = errors;
		if (Object.keys(errors).length > 0) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Please fill in required fields.' });
			this._renderContent();
			return;
		}

		this.saving = true;
		this._renderContent();
		try {
			const isEdit = this.mode === 'edit' && this.selectedRecord;
			const id = isEdit ? ((this.selectedRecord as { id?: string }).id || (this.selectedRecord as { fhirId?: string }).fhirId) : null;
			const url = isEdit
				? `/api/fhir-resource/${encodeURIComponent(this.activeKey)}/${encodeURIComponent(id || '')}`
				: `/api/fhir-resource/${encodeURIComponent(this.activeKey)}`;
			const method = isEdit ? 'PUT' : 'POST';
			const res = await this.apiService.fetch(url, { method, body: JSON.stringify(this.formData) });
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Saved.' });
				await this._fetchFhirRecords(this.activeKey);
				this.mode = 'list';
				this.formData = {};
				this.selectedRecord = null;
			} else {
				const err = await res.json().catch(() => null);
				this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
		this.saving = false;
		this._renderContent();
	}

	// allow-any-unicode-next-line
	// ─────────── Built-in pages ───────────

	private async _renderUsers(): Promise<void> {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		const title = DOM.append(titleCol, DOM.$('h1'));
		title.textContent = 'Users';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(titleCol, DOM.$('p'));
		sub.textContent = 'Manage user accounts, roles, and portal access.';
		sub.style.cssText = 'margin:0;color:var(--vscode-descriptionForeground);font-size:12px;';

		const headerRight = DOM.append(header, DOM.$('div'));
		headerRight.style.cssText = 'display:flex;gap:8px;align-items:center;';

		const searchInput = DOM.append(headerRight, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'search';
		searchInput.placeholder = 'Search users\u2026';
		searchInput.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;width:200px;outline:none;';

		const addBtn = DOM.append(headerRight, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add User';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		addBtn.addEventListener('click', () => this._showAddUserDialog(root));

		const loading = DOM.append(root, DOM.$('div'));
		loading.textContent = 'Loading users\u2026';
		loading.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';

		try {
			const res = await this.apiService.fetch('/api/admin/users?page=0&size=100');
			if (!res.ok) {
				const errText = await res.text().catch(() => '');
				loading.textContent = `Failed to load users (${res.status}). ${errText.substring(0, 200)}`;
				return;
			}
			const json = await res.json();
			const allList: Array<Record<string, unknown>> = Array.isArray(json?.data)
				? json.data
				: (json?.data?.content || json?.content || (Array.isArray(json) ? json : []));
			loading.remove();

			const HIDDEN_ROLES = new Set(['default-roles-ciyex', 'offline_access', 'uma_authorization']);

			const tableWrap = DOM.append(root, DOM.$('div'));
			tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
			const table = DOM.append(tableWrap, DOM.$('table'));
			table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

			const thead = DOM.append(table, DOM.$('thead'));
			const tr = DOM.append(thead, DOM.$('tr'));
			tr.style.cssText = 'background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
			for (const col of ['Username', 'Name', 'Email', 'Roles', 'Status', 'Actions']) {
				const th = DOM.append(tr, DOM.$('th'));
				th.textContent = col;
				th.style.cssText = 'padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
			}

			const tbody = DOM.append(table, DOM.$('tbody'));

			const renderRows = (filterTerm: string) => {
				DOM.clearNode(tbody);
				const list = filterTerm
					? allList.filter(u => {
						const s = filterTerm.toLowerCase();
						const user = u as { username?: string; firstName?: string; lastName?: string; email?: string };
						return (user.username || '').toLowerCase().includes(s)
							|| (user.email || '').toLowerCase().includes(s)
							|| ([user.firstName, user.lastName].join(' ')).toLowerCase().includes(s);
					})
					: allList;

				if (list.length === 0) {
					const emptyRow = DOM.append(tbody, DOM.$('tr'));
					const td = DOM.append(emptyRow, DOM.$('td'));
					td.colSpan = 6;
					td.textContent = filterTerm ? 'No users match your search.' : 'No users found.';
					td.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);';
					return;
				}

				for (const u of list) {
					const user = u as {
						id?: string;
						username?: string;
						firstName?: string;
						lastName?: string;
						email?: string;
						roles?: string[];
						npi?: string;
						enabled?: boolean;
					};
					const row = DOM.append(tbody, DOM.$('tr'));
					row.style.cssText = 'border-bottom:1px solid rgba(128,128,128,0.1);';
					row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
					row.addEventListener('mouseleave', () => { row.style.background = ''; });

					this._appendCell(row, user.username || '-');
					this._appendCell(row, [user.firstName, user.lastName].filter(Boolean).join(' ') || '-');
					this._appendCell(row, user.email || '-');
					const roleList = (user.roles || []).filter(r => !HIDDEN_ROLES.has(r));
					this._appendCell(row, roleList.length > 0 ? roleList.slice(0, 2).join(', ') + (roleList.length > 2 ? ` +${roleList.length - 2}` : '') : '-');

					// Status badge
					const statusTd = DOM.append(row, DOM.$('td'));
					statusTd.style.cssText = 'padding:10px 12px;';
					const isActive = user.enabled !== false;
					const badge = DOM.append(statusTd, DOM.$('span'));
					badge.textContent = isActive ? 'Active' : 'Inactive';
					badge.style.cssText = `display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${isActive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};color:${isActive ? '#22c55e' : '#ef4444'};`;

					// Actions
					const actionsTd = DOM.append(row, DOM.$('td'));
					actionsTd.style.cssText = 'padding:6px 12px;white-space:nowrap;';
					this._tableAction(actionsTd, '\u270f', 'Edit', () => this._showEditUserDialog(root, user as Record<string, unknown>));
					this._tableAction(actionsTd, '\u{1F511}', 'Reset Password', () => this._resetUserPassword(user.id || ''));
					this._tableAction(actionsTd, '\u{1F5D1}', 'Delete', () => this._deleteUser(user.id || '', user.username || ''), 'danger');
				}
			};

			renderRows('');
			searchInput.addEventListener('input', () => renderRows(searchInput.value));

			if (allList.length === 0) {
				const empty = DOM.append(root, DOM.$('div'));
				empty.textContent = 'No users found.';
				empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;margin-top:16px;';
			}
		} catch {
			loading.textContent = 'Waiting for login\u2026';
		}
	}

	private _showAddUserDialog(root: HTMLElement): void {
		const overlay = DOM.append(root, DOM.$('.sh-dialog-overlay'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('div'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:24px;width:420px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
		const t = DOM.append(dialog, DOM.$('h3'));
		t.textContent = 'Add User';
		t.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';
		const fields: Array<[string, string, string]> = [
			['Username', 'username', ''],
			['First Name', 'firstName', ''],
			['Last Name', 'lastName', ''],
			['Email', 'email', ''],
			['Password', 'password', ''],
		];
		const inputs: Record<string, HTMLInputElement> = {};
		for (const [label, key, placeholder] of fields) {
			const wrap = DOM.append(dialog, DOM.$('div'));
			wrap.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(wrap, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const inp = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			inp.type = key === 'password' ? 'password' : 'text';
			inp.placeholder = placeholder;
			inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
			inputs[key] = inp;
		}
		const btnRow = DOM.append(dialog, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Create User';
		saveBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		saveBtn.addEventListener('click', async () => {
			const body: Record<string, string> = {};
			for (const [k, inp] of Object.entries(inputs)) { body[k] = inp.value.trim(); }
			if (!body.username || !body.email) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Username and email are required.' });
				return;
			}
			try {
				const res = await this.apiService.fetch('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
				if (res.ok) {
					overlay.remove();
					this.notificationService.notify({ severity: Severity.Info, message: 'User created.' });
					this._onSidebarClick('__users__');
				} else {
					const err = await res.json().catch(() => null);
					this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Create failed (${res.status})` });
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Create failed: ${e}` });
			}
		});
		setTimeout(() => inputs['username']?.focus(), 50);
	}

	private _showEditUserDialog(root: HTMLElement, user: Record<string, unknown>): void {
		const overlay = DOM.append(root, DOM.$('.sh-dialog-overlay'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('div'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:24px;width:420px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
		const t = DOM.append(dialog, DOM.$('h3'));
		t.textContent = 'Edit User';
		t.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';
		const fields: Array<[string, string]> = [['First Name', 'firstName'], ['Last Name', 'lastName'], ['Email', 'email']];
		const inputs: Record<string, HTMLInputElement> = {};
		for (const [label, key] of fields) {
			const wrap = DOM.append(dialog, DOM.$('div'));
			wrap.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(wrap, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const inp = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			inp.type = 'text';
			inp.value = (user[key] as string) || '';
			inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
			inputs[key] = inp;
		}
		const btnRow = DOM.append(dialog, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Save';
		saveBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		saveBtn.addEventListener('click', async () => {
			const body: Record<string, unknown> = { ...user };
			for (const [k, inp] of Object.entries(inputs)) { body[k] = inp.value.trim(); }
			const id = user.id as string;
			try {
				const res = await this.apiService.fetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
				if (res.ok) {
					overlay.remove();
					this.notificationService.notify({ severity: Severity.Info, message: 'User updated.' });
					this._onSidebarClick('__users__');
				} else {
					const err = await res.json().catch(() => null);
					this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Update failed (${res.status})` });
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Update failed: ${e}` });
			}
		});
	}

	private async _resetUserPassword(userId: string): Promise<void> {
		if (!userId) { return; }
		const { confirmed } = await this.dialogService.confirm({ message: 'Send password reset email to this user?' });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Password reset email sent.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Failed to send reset email (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Failed: ${e}` });
		}
	}

	private async _deleteUser(userId: string, username: string): Promise<void> {
		if (!userId) { return; }
		const { confirmed } = await this.dialogService.confirm({ message: `Delete user "${username}"? This cannot be undone.` });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'User deleted.' });
				this._onSidebarClick('__users__');
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Delete failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	private async _renderRolesPermissions(): Promise<void> {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
		const titleEl = DOM.append(header, DOM.$('h1'));
		titleEl.textContent = 'Roles & Permissions';
		titleEl.style.cssText = 'margin:0;font-size:22px;font-weight:600;';
		const newRoleBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
		newRoleBtn.textContent = '+ New Role';
		newRoleBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		newRoleBtn.addEventListener('click', () => this._showRoleDialog(root, null));

		const sub = DOM.append(root, DOM.$('p'));
		sub.textContent = 'Manage roles, FHIR permissions, and SMART scopes.';
		sub.style.cssText = 'margin:0 0 24px;color:var(--vscode-descriptionForeground);font-size:13px;';

		const loading = DOM.append(root, DOM.$('div'));
		loading.textContent = 'Loading roles\u2026';
		loading.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';

		try {
			const res = await this.apiService.fetch('/api/admin/roles');
			if (!res.ok) {
				const errText = await res.text().catch(() => '');
				loading.textContent = `Failed to load roles (${res.status}). ${errText.substring(0, 200)}`;
				return;
			}
			const json = await res.json();
			const list: Array<Record<string, unknown>> = Array.isArray(json?.data)
				? json.data
				: (json?.content || (Array.isArray(json) ? json : []));
			loading.remove();

			if (list.length === 0) {
				const empty = DOM.append(root, DOM.$('div'));
				empty.textContent = 'No roles configured. Click "+ New Role" to create one.';
				empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
				return;
			}

			const grid = DOM.append(root, DOM.$('div'));
			grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;';
			for (const r of list) {
				const role = r as {
					id?: string | number;
					roleName?: string;
					roleLabel?: string;
					description?: string;
					permissions?: string[];
					smartScopes?: string[];
					isActive?: boolean;
				};
				const card = DOM.append(grid, DOM.$('div'));
				card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;background:var(--vscode-editor-background);position:relative;';
				card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--vscode-focusBorder)'; });
				card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--vscode-editorWidget-border)'; });

				// Action buttons top-right
				const cardActions = DOM.append(card, DOM.$('div'));
				cardActions.style.cssText = 'position:absolute;top:10px;right:10px;display:flex;gap:4px;';
				this._tableAction(cardActions, '\u270f', 'Edit', () => this._showRoleDialog(root, r));
				this._tableAction(cardActions, '\u{1F5D1}', 'Delete', () => this._deleteRole(r.id as string, role.roleName || ''), 'danger');

				// Header: label + name
				const headRow = DOM.append(card, DOM.$('div'));
				headRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;padding-right:60px;';
				const lbl = DOM.append(headRow, DOM.$('span'));
				lbl.textContent = role.roleLabel || role.roleName || '(unnamed)';
				lbl.style.cssText = 'font-weight:600;font-size:14px;';
				const code = DOM.append(headRow, DOM.$('code'));
				code.textContent = role.roleName || '';
				code.style.cssText = 'font-size:10px;font-family:var(--vscode-editor-font-family,monospace);color:var(--vscode-descriptionForeground);background:rgba(128,128,128,0.1);padding:1px 5px;border-radius:3px;';
				if (role.isActive === false) {
					const inactive = DOM.append(headRow, DOM.$('span'));
					inactive.textContent = 'INACTIVE';
					inactive.style.cssText = 'font-size:9px;font-weight:600;background:rgba(248,113,113,0.2);color:var(--vscode-errorForeground,#f48771);padding:1px 5px;border-radius:3px;letter-spacing:0.5px;';
				}

				if (role.description) {
					const d = DOM.append(card, DOM.$('div'));
					d.textContent = role.description;
					d.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:10px;';
				}

				const stats = DOM.append(card, DOM.$('div'));
				stats.style.cssText = 'display:flex;gap:14px;font-size:11px;color:var(--vscode-descriptionForeground);margin-top:8px;';
				const permCount = (role.permissions || []).length;
				const scopeCount = (role.smartScopes || []).length;
				const permEl = DOM.append(stats, DOM.$('span'));
				permEl.textContent = `${permCount} permission${permCount === 1 ? '' : 's'}`;
				const scopeEl = DOM.append(stats, DOM.$('span'));
				scopeEl.textContent = `${scopeCount} FHIR scope${scopeCount === 1 ? '' : 's'}`;

				// Show first few permissions as pills
				const perms = (role.permissions || []).slice(0, 4);
				if (perms.length > 0) {
					const pillRow = DOM.append(card, DOM.$('div'));
					pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;';
					for (const p of perms) {
						const pill = DOM.append(pillRow, DOM.$('span'));
						pill.textContent = p;
						pill.style.cssText = 'background:rgba(55,148,255,0.1);color:var(--vscode-textLink-foreground,#3794ff);padding:1px 6px;border-radius:3px;font-size:10px;';
					}
					if ((role.permissions || []).length > 4) {
						const more = DOM.append(pillRow, DOM.$('span'));
						more.textContent = `+${(role.permissions || []).length - 4} more`;
						more.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:10px;padding:1px 6px;';
					}
				}
			}
		} catch {
			loading.textContent = 'Waiting for login\u2026';
		}
	}

	private _showRoleDialog(root: HTMLElement, role: Record<string, unknown> | null): void {
		const isEdit = role !== null;
		const overlay = DOM.append(root, DOM.$('.sh-dialog-overlay'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('div'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:24px;width:480px;box-shadow:0 8px 24px rgba(0,0,0,0.4);max-height:80vh;overflow-y:auto;';
		const t = DOM.append(dialog, DOM.$('h3'));
		t.textContent = isEdit ? 'Edit Role' : 'New Role';
		t.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';

		const mkField = (label: string, key: string, val?: string) => {
			const wrap = DOM.append(dialog, DOM.$('div'));
			wrap.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(wrap, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const inp = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			inp.type = 'text';
			inp.value = val || '';
			inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
			return { inp, key };
		};

		const nameField = mkField('Role Name (key)', 'roleName', role?.roleName as string);
		const labelField = mkField('Role Label (display)', 'roleLabel', role?.roleLabel as string);
		const descField = mkField('Description', 'description', role?.description as string);

		const permWrap = DOM.append(dialog, DOM.$('div'));
		permWrap.style.cssText = 'margin-bottom:12px;';
		const permLbl = DOM.append(permWrap, DOM.$('label'));
		permLbl.textContent = 'Permissions (comma-separated)';
		permLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const permArea = DOM.append(permWrap, DOM.$('textarea')) as HTMLTextAreaElement;
		permArea.value = ((role?.permissions || []) as string[]).join(', ');
		permArea.rows = 3;
		permArea.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;box-sizing:border-box;outline:none;font-family:inherit;resize:vertical;';

		const btnRow = DOM.append(dialog, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save' : 'Create Role';
		saveBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		saveBtn.addEventListener('click', async () => {
			const perms = permArea.value.split(',').map(s => s.trim()).filter(Boolean);
			const body = {
				roleName: nameField.inp.value.trim(),
				roleLabel: labelField.inp.value.trim(),
				description: descField.inp.value.trim(),
				permissions: perms,
				isActive: true,
			};
			if (!body.roleName) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Role name is required.' });
				return;
			}
			try {
				const method = isEdit ? 'PUT' : 'POST';
				const url = isEdit ? `/api/admin/roles/${role!.id}` : '/api/admin/roles';
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(body) });
				if (res.ok) {
					overlay.remove();
					this.notificationService.notify({ severity: Severity.Info, message: isEdit ? 'Role updated.' : 'Role created.' });
					this._onSidebarClick('__roles__');
				} else {
					const err = await res.json().catch(() => null);
					this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${res.status})` });
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
			}
		});
		setTimeout(() => nameField.inp.focus(), 50);
	}

	private async _deleteRole(roleId: string, roleName: string): Promise<void> {
		if (!roleId) { return; }
		const { confirmed } = await this.dialogService.confirm({ message: `Delete role "${roleName}"? This cannot be undone.` });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/roles/${roleId}`, { method: 'DELETE' });
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Role deleted.' });
				this._onSidebarClick('__roles__');
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Delete failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	private async _renderFormOptions(): Promise<void> {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:900px;margin:0 auto;';

		const title = DOM.append(root, DOM.$('h1'));
		title.textContent = 'Form Options';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(root, DOM.$('p'));
		sub.textContent = 'Edit option lists used by select / radio / checkbox fields across all forms.';
		sub.style.cssText = 'margin:0 0 24px;color:var(--vscode-descriptionForeground);font-size:13px;';

		const loading = DOM.append(root, DOM.$('div'));
		loading.textContent = 'Loading option lists\u2026';
		loading.style.cssText = 'color:var(--vscode-descriptionForeground);';

		try {
			const res = await this.apiService.fetch('/api/list-options');
			if (!res.ok) {
				loading.textContent = `Failed to load option lists (${res.status})`;
				return;
			}
			const json = await res.json();
			const lists: Array<Record<string, unknown>> = json?.data || json?.content || (Array.isArray(json) ? json : []);
			loading.remove();

			if (lists.length === 0) {
				const empty = DOM.append(root, DOM.$('div'));
				empty.textContent = 'No option lists configured.';
				empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
				return;
			}

			for (const list of lists) {
				const l = list as { listName?: string; options?: Array<{ value?: string; label?: string }> };
				const panel = DOM.append(root, DOM.$('div'));
				panel.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:12px;overflow:hidden;';
				const head = DOM.append(panel, DOM.$('div'));
				head.style.cssText = 'padding:10px 14px;background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
				const ht = DOM.append(head, DOM.$('h3'));
				ht.textContent = l.listName || '(unnamed list)';
				ht.style.cssText = 'margin:0;font-size:13px;font-weight:600;';
				const body = DOM.append(panel, DOM.$('div'));
				body.style.cssText = 'padding:14px;display:flex;flex-wrap:wrap;gap:6px;';
				for (const opt of (l.options || [])) {
					const chip = DOM.append(body, DOM.$('span'));
					chip.textContent = `${opt.label || opt.value} (${opt.value || ''})`;
					chip.style.cssText = 'background:rgba(128,128,128,0.15);padding:3px 8px;border-radius:12px;font-size:11px;';
				}
			}
		} catch {
			loading.textContent = 'Waiting for login\u2026';
		}
	}

	private _renderDisplay(): void {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:900px;margin:0 auto;';

		const title = DOM.append(root, DOM.$('h1'));
		title.textContent = 'Display';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(root, DOM.$('p'));
		sub.textContent = 'Adjust display preferences for the EHR interface.';
		sub.style.cssText = 'margin:0 0 24px;color:var(--vscode-descriptionForeground);font-size:13px;';

		const panel = DOM.append(root, DOM.$('div'));
		panel.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const mkRow = (label: string, desc: string, control: HTMLElement) => {
			const row = DOM.append(panel, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(128,128,128,0.1);';
			const left = DOM.append(row, DOM.$('div'));
			const lbl = DOM.append(left, DOM.$('div'));
			lbl.textContent = label;
			lbl.style.cssText = 'font-size:13px;font-weight:500;';
			const d = DOM.append(left, DOM.$('div'));
			d.textContent = desc;
			d.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
			row.appendChild(control);
		};

		const mkSelect = (options: string[], currentVal: string, key: string) => {
			const sel = DOM.document.createElement('select');
			sel.style.cssText = 'padding:5px 8px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:12px;cursor:pointer;';
			for (const opt of options) {
				const o = DOM.document.createElement('option');
				o.value = opt;
				o.textContent = opt;
				if (opt === currentVal) { o.selected = true; }
				sel.appendChild(o);
			}
			sel.addEventListener('change', () => { /* preference stored in-memory only */ });
			return sel;
		};

		const mkToggle = (currentVal: boolean) => {
			const sw = DOM.document.createElement('button') as HTMLButtonElement;
			let val = currentVal;
			const update = (v: boolean) => {
				sw.style.cssText = `position:relative;width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;background:${v ? 'var(--vscode-focusBorder,#0e639c)' : 'rgba(128,128,128,0.4)'};flex-shrink:0;`;
				DOM.clearNode(sw);
				const knob = DOM.document.createElement('span');
				knob.style.cssText = `position:absolute;top:3px;${v ? 'right:3px;' : 'left:3px;'}width:16px;height:16px;border-radius:50%;background:#fff;`;
				sw.appendChild(knob);
			};
			update(val);
			sw.addEventListener('click', () => { val = !val; update(val); });
			return sw;
		};

		mkRow('Font Size', 'Base font size for all EHR text', mkSelect(['11px', '12px', '13px', '14px', '15px', '16px'], '13px', 'fontSize'));
		mkRow('Date Format', 'How dates are displayed throughout the app', mkSelect(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MMM DD, YYYY'], 'MM/DD/YYYY', 'dateFormat'));
		mkRow('Time Format', 'How times are displayed', mkSelect(['12-hour (AM/PM)', '24-hour'], '12-hour (AM/PM)', 'timeFormat'));
		mkRow('Compact Mode', 'Reduce padding and margins for denser display', mkToggle(false));
		mkRow('Show Avatars', 'Display profile photos next to names', mkToggle(true));
		mkRow('Sidebar Collapsed', 'Start with navigation sidebar collapsed', mkToggle(false));
		mkRow('Show Record Count', 'Display total record counts in section headers', mkToggle(true));
	}

	private _renderCalendarColors(): void {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:900px;margin:0 auto;';
		const title = DOM.append(root, DOM.$('h1'));
		title.textContent = 'Calendar Colors';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(root, DOM.$('p'));
		sub.textContent = 'Customize appointment colors by visit type, provider, or location.';
		sub.style.cssText = 'margin:0 0 20px;color:var(--vscode-descriptionForeground);font-size:13px;';

		// Tab bar
		type ColorTab = 'visit-type' | 'provider' | 'location';
		let activeColorTab: ColorTab = 'visit-type';
		const tabBar = DOM.append(root, DOM.$('div'));
		tabBar.style.cssText = 'display:flex;gap:4px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:20px;';
		const colorTabBody = DOM.append(root, DOM.$('div'));

		const renderColorTab = (tab: ColorTab) => {
			DOM.clearNode(colorTabBody);
			DOM.clearNode(tabBar);

			const tabs: Array<[ColorTab, string]> = [['visit-type', 'Visit Types'], ['provider', 'Providers'], ['location', 'Locations']];
			for (const [key, lbl] of tabs) {
				const btn = DOM.append(tabBar, DOM.$('button'));
				btn.textContent = lbl;
				const isActive = tab === key;
				btn.style.cssText = `padding:8px 16px;background:transparent;border:none;border-bottom:2px solid ${isActive ? 'var(--vscode-focusBorder)' : 'transparent'};color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};cursor:pointer;font-size:13px;font-weight:500;margin-bottom:-1px;`;
				btn.addEventListener('click', () => { activeColorTab = key; renderColorTab(key); });
			}

			const endpoint = tab === 'visit-type' ? '/api/appointment-types' : tab === 'provider' ? '/api/providers?page=0&size=50' : '/api/locations';

			const loading = DOM.append(colorTabBody, DOM.$('div'));
			loading.textContent = 'Loading\u2026';
			loading.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);';

			this.apiService.fetch(endpoint).then(async res => {
				loading.remove();
				if (!res.ok) {
					const msg = DOM.append(colorTabBody, DOM.$('div'));
					msg.textContent = `Failed to load (${res.status})`;
					msg.style.cssText = 'padding:24px;color:var(--vscode-descriptionForeground);';
					return;
				}
				const json = await res.json();
				const items: Array<Record<string, unknown>> = Array.isArray(json?.data?.content)
					? json.data.content
					: (Array.isArray(json?.data) ? json.data : (json?.content || (Array.isArray(json) ? json : [])));

				if (items.length === 0) {
					const empty = DOM.append(colorTabBody, DOM.$('div'));
					empty.textContent = 'No items found.';
					empty.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);';
					return;
				}

				const grid = DOM.append(colorTabBody, DOM.$('div'));
				grid.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

				for (const item of items) {
					const name = (item.name || item.displayName || item.firstName + ' ' + item.lastName || item.visitTypeName || item.locationName || item.typeName || item.id || '(unnamed)') as string;
					const currentColor = (item.color || item.calendarColor || '#3b82f6') as string;

					const row = DOM.append(grid, DOM.$('div'));
					row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;';

					const nameEl = DOM.append(row, DOM.$('span'));
					nameEl.textContent = name.trim() || String(item.id || '');
					nameEl.style.cssText = 'font-size:13px;font-weight:500;flex:1;';

					const right = DOM.append(row, DOM.$('div'));
					right.style.cssText = 'display:flex;align-items:center;gap:8px;';

					const swatch = DOM.append(right, DOM.$('div'));
					swatch.style.cssText = `width:24px;height:24px;border-radius:4px;background:${currentColor};border:1px solid rgba(0,0,0,0.2);`;

					const colorInput = DOM.append(right, DOM.$('input')) as HTMLInputElement;
					colorInput.type = 'color';
					colorInput.value = /^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : '#3b82f6';
					colorInput.style.cssText = 'width:32px;height:28px;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;cursor:pointer;background:transparent;padding:1px;';
					colorInput.addEventListener('input', () => {
						swatch.style.background = colorInput.value;
					});

					const saveColorBtn = DOM.append(right, DOM.$('button')) as HTMLButtonElement;
					saveColorBtn.textContent = 'Apply';
					saveColorBtn.style.cssText = 'padding:3px 10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:11px;';
					saveColorBtn.addEventListener('click', async () => {
						const id = item.id as string;
						if (!id) { return; }
						const colorEndpoint = tab === 'visit-type' ? `/api/appointment-types/${id}` : tab === 'provider' ? `/api/providers/${id}` : `/api/locations/${id}`;
						try {
							const patchRes = await this.apiService.fetch(colorEndpoint, {
								method: 'PATCH',
								body: JSON.stringify({ color: colorInput.value }),
							});
							if (patchRes.ok) {
								this.notificationService.notify({ severity: Severity.Info, message: 'Color saved.' });
							} else {
								this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${patchRes.status})` });
							}
						} catch (e) {
							this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
						}
					});
				}
			}).catch(() => {
				loading.textContent = 'Waiting for login\u2026';
			});
		};

		renderColorTab(activeColorTab);
	}

	// allow-any-unicode-next-line
	// ─────────── Helpers ───────────

	private _appendCell(row: HTMLElement, text: string): void {
		const td = DOM.append(row, DOM.$('td'));
		td.textContent = text;
		td.style.cssText = 'padding:10px 12px;font-size:12px;';
	}

	private _flatten(obj: unknown, prefix: string = ''): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		if (!obj || typeof obj !== 'object') { return out; }
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			const key = prefix ? `${prefix}.${k}` : k;
			if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
				Object.assign(out, this._flatten(v, key));
			} else {
				out[key] = v;
			}
		}
		// Also keep top-level key
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			if (!Object.prototype.hasOwnProperty.call(out, k)) { out[k] = v; }
		}
		return out;
	}

	private _formatValue(v: unknown): string {
		if (v === null || v === undefined) { return '-'; }
		if (typeof v === 'boolean') { return v ? 'Yes' : 'No'; }
		if (Array.isArray(v)) {
			if (v.length >= 3 && typeof v[0] === 'number' && (v[0] as number) > 1900) {
				try {
					const d = new Date(v[0] as number, ((v[1] as number) || 1) - 1, (v[2] as number) || 1);
					return d.toLocaleDateString();
				} catch { /* keep */ }
			}
			return `[${v.length}]`;
		}
		if (typeof v === 'object') {
			const o = v as { line1?: string; city?: string; state?: string };
			if (o.line1) { return [o.line1, o.city, o.state].filter(Boolean).join(', '); }
			return JSON.stringify(v);
		}
		const s = String(v);
		return s.length > 60 ? s.substring(0, 60) + '\u2026' : s;
	}

	private _titleCase(s: string): string {
		return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
