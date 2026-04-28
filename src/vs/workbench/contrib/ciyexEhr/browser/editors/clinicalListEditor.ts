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
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface ColumnDef { key: string; label: string; width?: string }
interface StatusTab { label: string; value: string }
interface ActionDef {
	label: string;
	icon: string;
	handler: (item: Record<string, unknown>, api: ICiyexApiService, reload: () => void, dlg: IDialogService) => void;
}

export interface FormFieldDef {
	key: string;
	label: string;
	type: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'search';
	required?: boolean;
	placeholder?: string;
	options?: Array<{ label: string; value: string }>;
	/** For 'search' type: API path to search. Expects { data: { content: [...] } } or array */
	searchApiPath?: string;
	/** For 'search' type: which field to display from results */
	searchDisplayField?: string;
	/** For 'search' type: which field to use as value */
	searchValueField?: string;
	/** For 'search' type: API endpoint path for live search (appends ?search=) */
	apiPath?: string;
	/** For 'search' type: field key to auto-fill when a result is selected (e.g. patientId) */
	relatedField?: string;
	/** For 'search' type: fields from API response to display in dropdown */
	relatedDisplayFields?: string[];
	/**
	 * For 'search' type: map of additional form-field keys to fill from a selected result.
	 * Key is the form field to fill, value is the property key on the result object.
	 * Example: { patientLastName: 'lastName', patientPhone: 'phone' }
	 */
	relatedFieldsMap?: Record<string, string>;
	/**
	 * When populating an edit form, if `key` is missing/empty on the record, try these
	 * alternate keys in order. Supports dot paths for nested objects (e.g. `category.id`).
	 */
	aliases?: string[];
	/** Default value for new records (or a factory function for dynamic values like timestamps). */
	defaultValue?: string | number | (() => string | number);
	/** Width hint */
	width?: string;
}

export interface ClinicalEditorConfig {
	title: string;
	apiPath: string;
	statsPath?: string;
	columns: ColumnDef[];
	statusTabs?: StatusTab[];
	actions?: ActionDef[];
	searchPlaceholder?: string;
	/** Form fields for create/edit dialog. If not set, no create/edit button is shown. */
	formFields?: FormFieldDef[];
	/** Label for the create button. Default: "+ New" */
	createLabel?: string;
	/** Whether editing existing items is supported */
	editable?: boolean;
	/** Custom render for a cell value */
	cellRenderer?: (key: string, value: unknown, item: Record<string, unknown>) => string;
	/** Priority filter options */
	priorityOptions?: Array<{ label: string; value: string }>;
	/** Key used for status tab filtering. Defaults to 'status'. E.g. audit logs use 'action'. */
	filterKey?: string;
	/**
	 * When set, the editor loads all records in one call and filters client-side
	 * against these fields. Use for small datasets where the backend doesn't
	 * support `q=` / status params. Status tabs still filter on `filterKey` (default: status).
	 */
	clientSideFilter?: string[];
	/**
	 * When true, the edit save payload is the merge of the original record and
	 * the form values (instead of only the form values). Also strips nested
	 * objects whose `id` is null to avoid backend "id cannot be null" errors.
	 * Needed when the backend requires a complete record on PUT.
	 */
	mergeOnEdit?: boolean;
	/** Custom dialog title for edit. Default: `Edit ${title without trailing s}`. */
	editTitle?: (item: Record<string, unknown>) => string;
	/**
	 * When true, on Edit click the editor refetches `${apiPath}/${id}` and merges the
	 * response onto the row before opening the form. Use when list responses are
	 * partial (missing relational fields like provider name, code system, etc).
	 */
	refetchOnEdit?: boolean;
	/**
	 * Extra default values applied to every create payload (POST). Useful when the
	 * backend requires fields not surfaced in the form (e.g. CDS `appliesTo: 'all'`).
	 */
	createDefaults?: Record<string, unknown>;
	/**
	 * Optional payload transformer: rewrites the request body before save.
	 * Receives the merged form values and returns the final payload.
	 */
	beforeSave?: (payload: Record<string, unknown>, isEdit: boolean) => Record<string, unknown>;
}

const STATUS_COLORS: Record<string, string> = {
	active: '#22c55e', completed: '#6b7280', cancelled: '#ef4444', 'on-hold': '#f59e0b', 'on_hold': '#f59e0b',
	discontinued: '#ef4444', pending: '#f59e0b', approved: '#22c55e', denied: '#ef4444',
	draft: '#6b7280', sent: '#3b82f6', scheduled: '#8b5cf6', expired: '#6b7280',
	routine: '#3b82f6', urgent: '#f59e0b', stat: '#ef4444',
	info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444',
	overdue: '#ef4444', notified: '#3b82f6',
	low: '#22c55e', normal: '#3b82f6', high: '#f59e0b',
	submitted: '#3b82f6', appeal: '#8b5cf6',
	// Inventory
	in_stock: '#22c55e', low_stock: '#f59e0b', out_of_stock: '#ef4444',
	// Payments
	processing: '#3b82f6', failed: '#ef4444', refunded: '#8b5cf6', voided: '#6b7280',
	partial_refund: '#8b5cf6',
	// Lab
	final: '#22c55e', preliminary: '#f59e0b', corrected: '#3b82f6',
	// Education
	'in-progress': '#3b82f6', preparation: '#f59e0b', 'not-done': '#6b7280',
};

/**
 * Base class for all clinical list editors.
 * Subclasses set `config` and the base renders everything:
 * stats cards, status tabs, search, table, pagination, create/edit form dialog.
 */
export abstract class ClinicalListEditorBase extends EditorPane {
	protected abstract readonly config: ClinicalEditorConfig;

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private items: Record<string, unknown>[] = [];
	private stats: Record<string, number> = {};
	private searchValue = '';
	private statusFilter = '';
	private priorityFilter = '';
	private currentPage = 0;
	private totalPages = 1;
	private formOverlay: HTMLElement | null = null;
	private editingItem: Record<string, unknown> | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private searchDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private refocusSearchAfterRender = false;

	constructor(
		id: string,
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService protected readonly apiService: ICiyexApiService,
		@IDialogService protected readonly dialogService: IDialogService,
	) {
		super(id, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.clinical-list-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);position:relative;';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1200px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (this.config.statsPath) { this._loadStats(); }
		this._loadData();
	}

	private async _loadStats(): Promise<void> {
		try {
			const res = await this.apiService.fetch(this.config.statsPath!);
			if (res.ok) { this.stats = ((await res.json())?.data || {}) as Record<string, number>; }
		} catch { /* */ }
	}

	private async _loadData(): Promise<void> {
		try {
			const clientFilter = this.config.clientSideFilter;
			let url: string;
			if (clientFilter) {
				// Client-side mode: load all in one page, skip server search/status params.
				url = `${this.config.apiPath}?page=0&size=500`;
			} else {
				url = `${this.config.apiPath}?page=${this.currentPage}&size=20`;
				if (this.searchValue) { url += `&q=${encodeURIComponent(this.searchValue)}`; }
				if (this.statusFilter) { const fk = this.config.filterKey || 'status'; url += `&${fk}=${this.statusFilter}`; }
				if (this.priorityFilter) { url += `&priority=${this.priorityFilter}`; }
			}
			const res = await this.apiService.fetch(url);
			if (!res.ok) {
				this.items = [];
				this.totalPages = 1;
				this._renderError(`Failed to load data (HTTP ${res.status}). The API endpoint may be unavailable.`);
				return;
			}
			const data = await res.json();
			const wrapper = data?.data || data;
			if (wrapper?.content) {
				this.items = wrapper.content as Record<string, unknown>[];
				this.totalPages = wrapper.totalPages || 1;
			} else if (Array.isArray(wrapper)) {
				this.items = wrapper;
				this.totalPages = 1;
			} else {
				this.items = [];
				this.totalPages = 1;
			}
			this._render();
		} catch {
			this.items = [];
			this.totalPages = 1;
			this._renderError('Unable to load data. Please check your connection and try again.');
		}
	}

	private _renderError(message: string): void {
		DOM.clearNode(this.contentEl);

		const titleBar = DOM.append(this.contentEl, DOM.$('div'));
		titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
		const h = DOM.append(titleBar, DOM.$('h2'));
		h.textContent = this.config.title;
		h.style.cssText = 'font-size:20px;font-weight:600;margin:0;';

		const errorBox = DOM.append(this.contentEl, DOM.$('div'));
		errorBox.style.cssText = 'padding:24px;text-align:center;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-top:12px;';

		// allow-any-unicode-next-line
		const iconEl = DOM.append(errorBox, DOM.$('div'));
		// allow-any-unicode-next-line
		iconEl.textContent = '⚠';
		iconEl.style.cssText = 'font-size:28px;margin-bottom:8px;';

		const msgEl = DOM.append(errorBox, DOM.$('div'));
		msgEl.textContent = message;
		msgEl.style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);margin-bottom:12px;';

		const retryBtn = DOM.append(errorBox, DOM.$('button'));
		retryBtn.textContent = 'Retry';
		retryBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		retryBtn.addEventListener('click', () => this._loadData());
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);
		const cfg = this.config;

		// allow-any-unicode-next-line
		// ─── Title bar with create button ───
		const titleBar = DOM.append(this.contentEl, DOM.$('div'));
		titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';

		const h = DOM.append(titleBar, DOM.$('h2'));
		h.textContent = cfg.title;
		h.style.cssText = 'font-size:20px;font-weight:600;margin:0;';

		if (cfg.formFields && cfg.formFields.length > 0) {
			const createBtn = DOM.append(titleBar, DOM.$('button'));
			createBtn.textContent = cfg.createLabel || `+ New ${cfg.title.replace(/s$/, '')}`;
			createBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			createBtn.addEventListener('mouseenter', () => { createBtn.style.background = '#1177bb'; });
			createBtn.addEventListener('mouseleave', () => { createBtn.style.background = '#0e639c'; });
			createBtn.addEventListener('click', () => this._openForm(null));
		}

		// allow-any-unicode-next-line
		// ─── Stats cards ───
		if (Object.keys(this.stats).length > 0) {
			const row = DOM.append(this.contentEl, DOM.$('div'));
			row.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;';
			for (const [k, v] of Object.entries(this.stats)) {
				if (typeof v !== 'number') { continue; }
				const c = DOM.append(row, DOM.$('div'));
				const isActive = this.statusFilter === k;
				c.style.cssText = `padding:8px 14px;border:1px solid ${isActive ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};border-radius:6px;text-align:center;cursor:pointer;min-width:70px;background:${isActive ? 'rgba(0,122,204,0.12)' : 'transparent'};transition:background 0.15s;`;
				c.addEventListener('mouseenter', () => { if (!isActive) { c.style.background = 'var(--vscode-list-hoverBackground)'; } });
				c.addEventListener('mouseleave', () => { if (!isActive) { c.style.background = ''; } });
				c.addEventListener('click', () => { this.statusFilter = this.statusFilter === k ? '' : k; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
				const numEl = DOM.append(c, DOM.$('div'));
				numEl.textContent = String(v);
				numEl.style.cssText = `font-size:18px;font-weight:700;color:${STATUS_COLORS[k.toLowerCase()] || 'var(--vscode-foreground)'};`;
				const l = DOM.append(c, DOM.$('div'));
				l.textContent = k.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
				l.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);text-transform:capitalize;';
			}
		}

		// allow-any-unicode-next-line
		// ─── Status tabs ───
		if (cfg.statusTabs) {
			const tabs = DOM.append(this.contentEl, DOM.$('div'));
			tabs.style.cssText = 'display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;';
			for (const t of [{ label: 'All', value: '' }, ...cfg.statusTabs]) {
				const b = DOM.append(tabs, DOM.$('button'));
				b.textContent = t.label;
				const a = this.statusFilter === t.value;
				b.style.cssText = `padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;border:1px solid ${a ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};background:${a ? 'rgba(0,122,204,0.15)' : 'transparent'};color:var(--vscode-foreground);transition:all 0.15s;`;
				b.addEventListener('click', () => { this.statusFilter = t.value; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
			}
		}

		// allow-any-unicode-next-line
		// ─── Toolbar: Search + Priority filter ───
		const tb = DOM.append(this.contentEl, DOM.$('div'));
		tb.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;align-items:center;';

		const s = DOM.append(tb, DOM.$('input')) as HTMLInputElement;
		s.type = 'text';
		s.placeholder = cfg.searchPlaceholder || 'Search...';
		s.value = this.searchValue;
		s.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		s.addEventListener('input', () => {
			if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
			this.debounceTimer = setTimeout(() => {
				this.searchValue = s.value;
				this.currentPage = 0;
				// Client-side filter: just re-render the already-loaded items.
				// Server-side: re-query with ?q=...
				if (cfg.clientSideFilter) {
					this.refocusSearchAfterRender = true;
					this._render();
				} else {
					this._loadData();
				}
			}, 300);
		});
		if (this.refocusSearchAfterRender) {
			this.refocusSearchAfterRender = false;
			const caret = this.searchValue.length;
			setTimeout(() => { s.focus(); s.setSelectionRange(caret, caret); }, 0);
		}

		if (cfg.priorityOptions) {
			const sel = DOM.append(tb, DOM.$('select')) as HTMLSelectElement;
			sel.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
			const allOpt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			allOpt.value = '';
			allOpt.textContent = 'All Priority';
			for (const p of cfg.priorityOptions) {
				const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				opt.value = p.value;
				opt.textContent = p.label;
				if (this.priorityFilter === p.value) { opt.selected = true; }
			}
			sel.addEventListener('change', () => { this.priorityFilter = sel.value; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
		}

		// allow-any-unicode-next-line
		// ─── Table ───
		const tbl = DOM.append(this.contentEl, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const colWidths = cfg.columns.map(c => c.width || '1fr').join(' ');
		const cols = colWidths + (cfg.actions || cfg.editable ? ' auto' : '');

		// Header
		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(0,122,204,0.05);text-transform:uppercase;letter-spacing:0.3px;`;
		for (const c of cfg.columns) { DOM.append(hr, DOM.$('span')).textContent = c.label; }
		if (cfg.actions || cfg.editable) { DOM.append(hr, DOM.$('span')).textContent = 'Actions'; }

		const visibleItems = this._visibleItems();

		if (visibleItems.length === 0) {
			const e = DOM.append(tbl, DOM.$('div'));
			e.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			e.textContent = 'No records found';
			return;
		}

		for (const item of visibleItems) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:6px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;transition:background 0.1s;`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });

			for (const c of cfg.columns) {
				const cell = DOM.append(r, DOM.$('span'));
				const v = String(item[c.key] ?? '');
				if (cfg.cellRenderer) {
					cell.textContent = cfg.cellRenderer(c.key, item[c.key], item);
				} else {
					cell.textContent = v;
				}
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				const lowerKey = c.key.toLowerCase();
				if (lowerKey === 'status' || lowerKey === 'priority' || lowerKey === 'severity' || lowerKey === 'urgency') {
					const clr = STATUS_COLORS[v.toLowerCase().replace(/\s+/g, '_')] || '#6b7280';
					cell.style.cssText += `color:${clr};font-weight:500;text-transform:capitalize;`;
				}
			}

			if (cfg.actions || cfg.editable) {
				const acts = DOM.append(r, DOM.$('div'));
				acts.style.cssText = 'display:flex;gap:2px;';

				if (cfg.editable && cfg.formFields) {
					const editBtn = DOM.append(acts, DOM.$('button'));
					// allow-any-unicode-next-line
					editBtn.textContent = '✏️';
					editBtn.title = 'Edit';
					editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:2px;';
					editBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this._openForm(item); });
				}

				if (cfg.actions) {
					for (const a of cfg.actions) {
						const btn = DOM.append(acts, DOM.$('button'));
						btn.textContent = a.icon;
						btn.title = a.label;
						btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:2px;';
						btn.addEventListener('click', (ev) => { ev.stopPropagation(); a.handler(item, this.apiService, () => { this._loadStats(); this._loadData(); }, this.dialogService); });
					}
				}
			}
		}

		// allow-any-unicode-next-line
		// ─── Pagination ─── (skipped in client-side-filter mode — all records loaded at once)
		if (!cfg.clientSideFilter) {
			const pg = DOM.append(this.contentEl, DOM.$('div'));
			pg.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:12px;align-items:center;';
			if (this.currentPage > 0) {
				const p = DOM.append(pg, DOM.$('button'));
				// allow-any-unicode-next-line
				p.textContent = '◀ Previous';
				p.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
				p.addEventListener('click', () => { this.currentPage--; this._loadData(); });
			}

			const pageInfo = DOM.append(pg, DOM.$('span'));
			pageInfo.textContent = `Page ${this.currentPage + 1}${this.totalPages > 1 ? ` of ${this.totalPages}` : ''}`;
			pageInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

			if (this.items.length >= 20) {
				const n = DOM.append(pg, DOM.$('button'));
				// allow-any-unicode-next-line
				n.textContent = 'Next ▶';
				n.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
				n.addEventListener('click', () => { this.currentPage++; this._loadData(); });
			}
		} else {
			const info = DOM.append(this.contentEl, DOM.$('span'));
			info.textContent = `${visibleItems.length} of ${this.items.length} records`;
			info.style.cssText = 'display:block;text-align:center;margin-top:12px;font-size:11px;color:var(--vscode-descriptionForeground);';
		}
	}

	// Apply search + status + priority filters in memory when clientSideFilter is set.
	// Status filters use the configured filterKey (default 'status') and fall back to
	// common alternate keys (state, paymentStatus, etc) so backend naming differences
	// don't silently produce an empty filtered view.
	private _visibleItems(): Record<string, unknown>[] {
		const cfg = this.config;
		if (!cfg.clientSideFilter) { return this.items; }
		const q = this.searchValue.trim().toLowerCase();
		const fk = cfg.filterKey || 'status';
		const fallbackKeys = ['state', 'paymentStatus', 'orderStatus', 'currentStatus'];
		const statusF = this.statusFilter.toLowerCase().replace(/[-_\s]/g, '');
		const priF = this.priorityFilter.toLowerCase().replace(/[-_\s]/g, '');
		const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[-_\s]/g, '');
		return this.items.filter(item => {
			if (statusF) {
				const candidates = [item[fk], ...fallbackKeys.map(k => item[k])];
				const match = candidates.some(c => norm(c) === statusF);
				if (!match) { return false; }
			}
			if (priF && norm(item['priority']) !== priF) { return false; }
			if (q) {
				const hit = cfg.clientSideFilter!.some(field => String(item[field] ?? '').toLowerCase().includes(q));
				if (!hit) { return false; }
			}
			return true;
		});
	}

	// allow-any-unicode-next-line
	// ─── Form Dialog ───

	private async _openForm(item: Record<string, unknown> | null): Promise<void> {
		if (!this.config.formFields) { return; }
		// Optionally refetch full record by ID so the edit form has all relational fields.
		if (item && this.config.refetchOnEdit && item.id !== undefined && item.id !== null) {
			try {
				const res = await this.apiService.fetch(`${this.config.apiPath}/${item.id}`);
				if (res.ok) {
					const json = await res.json().catch(() => null);
					const full = (json && (json.data ?? json)) as Record<string, unknown> | null;
					if (full && typeof full === 'object') {
						item = { ...item, ...full };
					}
				}
			} catch { /* fall through with row data */ }
		}
		this.editingItem = item;
		this._renderForm();
	}

	/** Resolve a (possibly dot-pathed) key against the editing record. */
	private _readFieldValue(field: FormFieldDef): unknown {
		const item = this.editingItem;
		if (!item) { return undefined; }
		const direct = (item as Record<string, unknown>)[field.key];
		if (direct !== undefined && direct !== null && direct !== '') { return direct; }
		if (!field.aliases) { return direct; }
		for (const alias of field.aliases) {
			const v = alias.includes('.')
				? alias.split('.').reduce<unknown>((acc, part) => {
					if (acc && typeof acc === 'object') { return (acc as Record<string, unknown>)[part]; }
					return undefined;
				}, item)
				: (item as Record<string, unknown>)[alias];
			if (v !== undefined && v !== null && v !== '') { return v; }
		}
		return direct;
	}

	private _renderForm(): void {
		if (this.formOverlay) {
			this.formOverlay.remove();
			this.formOverlay = null;
		}

		const cfg = this.config;
		const fields = cfg.formFields!;
		const isEdit = this.editingItem !== null;

		// Overlay
		this.formOverlay = DOM.append(this.root, DOM.$('div'));
		this.formOverlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding-top:40px;overflow-y:auto;';

		// Dialog
		const dialog = DOM.append(this.formOverlay, DOM.$('div'));
		dialog.style.cssText = 'background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:560px;max-height:calc(100vh - 100px);overflow-y:auto;';

		// Header
		const header = DOM.append(dialog, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		const title = DOM.append(header, DOM.$('h3'));
		if (isEdit && cfg.editTitle && this.editingItem) {
			title.textContent = cfg.editTitle(this.editingItem);
		} else {
			title.textContent = isEdit ? `Edit ${cfg.title.replace(/s$/, '')}` : `New ${cfg.title.replace(/s$/, '')}`;
		}
		title.style.cssText = 'margin:0;font-size:14px;font-weight:600;';

		const closeBtn = DOM.append(header, DOM.$('button'));
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:var(--vscode-foreground);padding:2px 6px;';
		closeBtn.addEventListener('click', () => this._closeForm());

		// Form body
		const body = DOM.append(dialog, DOM.$('div'));
		body.style.cssText = 'padding:16px;display:grid;gap:12px;';

		const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

		for (const field of fields) {
			const group = DOM.append(body, DOM.$('div'));
			group.style.cssText = field.width ? `grid-column:${field.width};` : '';

			const label = DOM.append(group, DOM.$('label'));
			label.textContent = field.label + (field.required ? ' *' : '');
			label.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';

			const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
			let inputEl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

			if (field.type === 'select' && field.options) {
				inputEl = DOM.append(group, DOM.$('select')) as HTMLSelectElement;
				inputEl.style.cssText = inputStyle + 'min-width:200px;';
				const emptyOpt = DOM.append(inputEl, DOM.$('option')) as HTMLOptionElement;
				emptyOpt.value = '';
				emptyOpt.textContent = `Select ${field.label}...`;
				for (const opt of field.options) {
					const optEl = DOM.append(inputEl, DOM.$('option')) as HTMLOptionElement;
					optEl.value = opt.value;
					optEl.textContent = opt.label;
				}
			} else if (field.type === 'textarea') {
				inputEl = DOM.append(group, DOM.$('textarea')) as HTMLTextAreaElement;
				inputEl.style.cssText = inputStyle + 'min-height:60px;resize:vertical;font-family:inherit;';
				inputEl.placeholder = field.placeholder || '';
			} else if (field.type === 'search' && (field.apiPath || field.searchApiPath)) {
				// Search field with live autocomplete dropdown
				const searchWrapper = DOM.append(group, DOM.$('div'));
				searchWrapper.style.cssText = 'position:relative;';

				inputEl = DOM.append(searchWrapper, DOM.$('input')) as HTMLInputElement;
				inputEl.type = 'text';
				inputEl.style.cssText = inputStyle;
				inputEl.placeholder = field.placeholder || `Search ${field.label}...`;

				const dropdown = DOM.append(searchWrapper, DOM.$('div'));
				dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;max-height:180px;overflow-y:auto;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border);border-radius:0 0 4px 4px;z-index:200;display:none;';

				const searchEndpoint = field.apiPath || field.searchApiPath || '';
				const displayField = field.searchDisplayField || 'name';
				const valueField = field.searchValueField || 'id';

				inputEl.addEventListener('input', () => {
					const timerKey = field.key;
					const existing = this.searchDebounceTimers.get(timerKey);
					if (existing) { clearTimeout(existing); }
					const query = (inputEl as HTMLInputElement).value.trim();
					if (query.length < 2) {
						dropdown.style.display = 'none';
						DOM.clearNode(dropdown);
						return;
					}
					this.searchDebounceTimers.set(timerKey, setTimeout(async () => {
						try {
							const res = await this.apiService.fetch(`${searchEndpoint}?search=${encodeURIComponent(query)}`);
							if (!res.ok) { return; }
							const data = await res.json();
							const wrapper = data?.data || data;
							const results: Record<string, unknown>[] = wrapper?.content || (Array.isArray(wrapper) ? wrapper : []);
							DOM.clearNode(dropdown);
							if (results.length === 0) {
								const noRes = DOM.append(dropdown, DOM.$('div'));
								noRes.textContent = 'No results found';
								noRes.style.cssText = 'padding:8px 10px;font-size:12px;color:var(--vscode-descriptionForeground);';
								dropdown.style.display = 'block';
								return;
							}
							for (const result of results.slice(0, 15)) {
								const item = DOM.append(dropdown, DOM.$('div'));
								// Build display text
								let displayText = String(result[displayField] ?? '');
								if (field.relatedDisplayFields) {
									const parts = field.relatedDisplayFields.map(f => String(result[f] ?? '')).filter(Boolean);
									if (parts.length > 0) { displayText = parts.join(' '); }
								}
								if (!displayText) {
									// Fallback: try firstName + lastName
									const fn = String(result['firstName'] ?? '');
									const ln = String(result['lastName'] ?? '');
									displayText = [fn, ln].filter(Boolean).join(' ') || String(result[valueField] ?? '');
								}
								item.textContent = displayText;
								item.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.08);';
								item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
								item.addEventListener('mouseleave', () => { item.style.background = ''; });
								item.addEventListener('click', () => {
									(inputEl as HTMLInputElement).value = displayText;
									dropdown.style.display = 'none';
									// Auto-fill related field (e.g. patientId)
									if (field.relatedField) {
										const relatedInput = inputs.get(field.relatedField);
										if (relatedInput) {
											relatedInput.value = String(result[valueField] ?? '');
										}
									}
									// Auto-fill additional related fields from the result (e.g. patientLastName, phone)
									if (field.relatedFieldsMap) {
										for (const [formKey, resultKey] of Object.entries(field.relatedFieldsMap)) {
											const relatedInput = inputs.get(formKey);
											if (relatedInput) {
												const v = (result as Record<string, unknown>)[resultKey];
												relatedInput.value = String(v ?? '');
											}
										}
									}
								});
							}
							dropdown.style.display = 'block';
						} catch {
							// Silently ignore search errors
						}
					}, 300));
				});

				// Hide dropdown on blur (with delay for click)
				inputEl.addEventListener('blur', () => {
					setTimeout(() => { dropdown.style.display = 'none'; }, 200);
				});
				inputEl.addEventListener('focus', () => {
					if (dropdown.childElementCount > 0) { dropdown.style.display = 'block'; }
				});
			} else {
				inputEl = DOM.append(group, DOM.$('input')) as HTMLInputElement;
				inputEl.type = field.type;
				inputEl.style.cssText = inputStyle;
				inputEl.placeholder = field.placeholder || '';
			}

			// Set value from editing item (with alias lookup) or default
			let val: string;
			if (isEdit) {
				const resolved = this._readFieldValue(field);
				val = resolved === undefined || resolved === null ? '' : String(resolved);
			} else {
				const dv = field.defaultValue;
				val = typeof dv === 'function' ? String((dv as () => string | number)()) : String(dv ?? '');
			}
			inputEl.value = val;

			inputs.set(field.key, inputEl);
		}

		// Error area
		const errorEl = DOM.append(body, DOM.$('div'));
		errorEl.style.cssText = 'color:#f48771;font-size:12px;display:none;';

		// Footer
		const footer = DOM.append(dialog, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--vscode-editorWidget-border);';

		const cancelBtn = DOM.append(footer, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
		cancelBtn.addEventListener('click', () => this._closeForm());

		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
		saveBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			// Validate required fields
			for (const field of fields) {
				if (field.required) {
					const input = inputs.get(field.key);
					if (!input || !input.value.trim()) {
						errorEl.textContent = `${field.label} is required`;
						errorEl.style.display = 'block';
						input?.focus();
						return;
					}
				}
			}

			// Build payload from form values
			const formValues: Record<string, unknown> = {};
			for (const field of fields) {
				const input = inputs.get(field.key);
				if (!input) { continue; }
				const v = input.value.trim();
				if (field.type === 'number') {
					formValues[field.key] = v === '' ? null : Number(v);
				} else {
					formValues[field.key] = v;
				}
			}

			let payload: Record<string, unknown>;
			if (isEdit && cfg.mergeOnEdit && this.editingItem) {
				// Merge form values onto the original record; strip nested objects
				// with null/undefined id (backend rejects them with "id cannot be null").
				const merged = { ...this.editingItem, ...formValues };
				payload = {};
				for (const [k, v] of Object.entries(merged)) {
					if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
						const obj = v as Record<string, unknown>;
						if (Object.prototype.hasOwnProperty.call(obj, 'id')) {
							const nestedId = obj.id;
							if (nestedId === null || nestedId === undefined) { continue; }
						}
					}
					payload[k] = v;
				}
			} else {
				payload = formValues;
			}

			// Apply create-time defaults for fields the form doesn't surface.
			if (!isEdit && cfg.createDefaults) {
				for (const [k, v] of Object.entries(cfg.createDefaults)) {
					if (payload[k] === undefined || payload[k] === null || payload[k] === '') {
						payload[k] = v;
					}
				}
			}
			if (cfg.beforeSave) {
				payload = cfg.beforeSave(payload, isEdit);
			}

			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';

			try {
				const url = isEdit ? `${cfg.apiPath}/${this.editingItem!.id}` : cfg.apiPath;
				const method = isEdit ? 'PUT' : 'POST';
				const res = await this.apiService.fetch(url, {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (res.ok) {
					this._closeForm();
					if (cfg.statsPath) { this._loadStats(); }
					this._loadData();
				} else {
					const errData = await res.json().catch(() => null) as Record<string, unknown> | null;
					const msg = (errData?.['message'] as string)
						|| (errData?.['error'] as string)
						|| (Array.isArray(errData?.['errors']) ? (errData!['errors'] as string[]).join('; ') : '')
						|| `Error: ${res.status}`;
					errorEl.textContent = String(msg);
					errorEl.style.display = 'block';
				}
			} catch (err) {
				errorEl.textContent = 'Network error';
				errorEl.style.display = 'block';
			} finally {
				saveBtn.disabled = false;
				saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
			}
		});

		// Close on overlay click
		this.formOverlay.addEventListener('click', (ev) => {
			if (ev.target === this.formOverlay) { this._closeForm(); }
		});
	}

	private _closeForm(): void {
		if (this.formOverlay) {
			this.formOverlay.remove();
			this.formOverlay = null;
		}
		this.editingItem = null;
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}

	override dispose(): void {
		if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
		for (const timer of this.searchDebounceTimers.values()) { clearTimeout(timer); }
		this.searchDebounceTimers.clear();
		this._closeForm();
		super.dispose();
	}
}
