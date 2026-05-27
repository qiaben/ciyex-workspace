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
import { mainWindow } from '../../../../../base/browser/window.js';
import { createCustomDropdown, findWorkbenchRoot } from '../customDropdown.js';

interface ColumnDef { key: string; label: string; width?: string; onClick?: (item: Record<string, unknown>, api: ICiyexApiService, reload: () => void, dlg: IDialogService) => void; emptyLabel?: string }
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
	/** For 'search' type: query parameter name for live search. Defaults to 'search'.
	 * ciyex-codes uses 'q', most other backends use 'search'. */
	searchParam?: string;
	/** For 'search' type: regex pattern of acceptable input values (e.g. for negative-case validation). */
	pattern?: string;
	/** Validation pattern for non-search inputs (regex source). When set, save fails if value doesn't match. */
	validationPattern?: string;
	/** Error message for validationPattern mismatch. */
	validationMessage?: string;
	/**
	 * For 'search' type: client-side fallback options used when the API returns empty/fails.
	 * Items are filtered against the typed query (substring match against displayField/value).
	 * Useful for code systems (CVX, etc.) when the backend dataset is incomplete.
	 */
	fallbackOptions?: Array<Record<string, string>>;
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
	/** Minimum allowed numeric value. Maps to HTML `min` attribute and is enforced on save. */
	minValue?: number;
	/** Maximum allowed numeric value. Maps to HTML `max` attribute and is enforced on save. */
	maxValue?: number;
	/** Render the field off-screen. Used for fields that should only be filled via auto-fill
	 * from a related `search`-type field (e.g. patientId, materialId). */
	hidden?: boolean;
	/** Regex (as string) that each individual typed character must match.
	 * When set, keydown/paste/input guards enforce this at input time so
	 * invalid characters never land in the field. */
	typingPattern?: string;
}

export interface FilterDropdownDef {
	/** Field key to filter on (must exist on list items) */
	key: string;
	/** Placeholder shown as the "All" option */
	placeholder: string;
	options: Array<{ label: string; value: string }>;
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
	/**
	 * Whether new records can be created via this editor (shows the "+ New" button).
	 * Defaults to `true` when formFields is set. Use `false` for editors that share
	 * a form schema with edit but where the backend doesn't support direct creation
	 * (e.g. claims, which are derived from invoices/encounters).
	 */
	creatable?: boolean;
	/** Whether editing existing items is supported */
	editable?: boolean;
	/** Custom render for a cell value */
	cellRenderer?: (key: string, value: unknown, item: Record<string, unknown>) => string;
	/** Priority filter options */
	priorityOptions?: Array<{ label: string; value: string }>;
	/** Extra dropdown filters shown in the toolbar alongside Search. Client-side only. */
	additionalFilters?: FilterDropdownDef[];
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
	/**
	 * URL builder for GET-by-id (refetch on edit) and PUT (update). Use when the
	 * backend isn't a flat REST resource (e.g. patient-scoped /api/lab-order/{patientId}/{orderId}).
	 * Defaults to `${apiPath}/${item.id}`.
	 */
	buildItemUrl?: (item: Record<string, unknown>) => string;
	/**
	 * URL builder for POST (create). Same use-case as buildItemUrl.
	 * Defaults to `apiPath`.
	 */
	buildCreateUrl?: (payload: Record<string, unknown>) => string;
	/**
	 * Maps stats-card keys to status-filter values. Keys present in the map are
	 * clickable filters; keys NOT in the map render as info-only (e.g. aggregates
	 * like totals/sums). When unset, every stats key is clickable and uses the
	 * raw key as its filter (legacy behavior — works only if stats keys match
	 * status values directly).
	 */
	statsFilterMap?: Record<string, string>;
	/**
	 * When true, the toolbar renders the status filter as a dropdown (using
	 * `statusTabs` as the option list) instead of as a row of pill buttons.
	 * Matches the web app's Labs page where Status / Priority / Result are
	 * shown as inline `<select>` controls.
	 */
	statusAsDropdown?: boolean;
	/**
	 * When true, KPI / stats cards render in a compact mode (~half the normal
	 * vertical height, smaller fonts). Used on dense KPI strips like the
	 * Patient Recall board where 7+ cards would otherwise dominate the page.
	 */
	compactStats?: boolean;
	/**
	 * When set, applied as `min-width` on the table grid so the outer wrapper
	 * can scroll horizontally instead of crushing columns. Use for pages with
	 * many columns plus an Actions column that must stay visible (e.g. the
	 * Patient Education Library — issue #24).
	 */
	tableMinWidth?: string;
	/**
	 * Hook for rendering custom DOM (e.g. dynamic Goals / Interventions lists
	 * on Care Plans — issue #23) inside the dialog body. The hook is called
	 * once per dialog open and should return a `collect()` callback that
	 * produces extra fields for the save payload.
	 */
	formExtras?: (container: HTMLElement, editingItem: Record<string, unknown> | null) => FormExtrasHandle;
}

export interface FormExtrasHandle {
	/** Called at save time to merge dynamic-list data into the payload. */
	collect: () => Record<string, unknown>;
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

	protected root!: HTMLElement;
	protected contentEl!: HTMLElement;
	private items: Record<string, unknown>[] = [];
	private stats: Record<string, number> = {};
	private searchValue = '';
	private statusFilter = '';
	private priorityFilter = '';
	private currentPage = 0;
	private totalPages = 1;
	private clientPageSize = 20;
	private formOverlay: HTMLElement | null = null;
	private editingItem: Record<string, unknown> | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private searchDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private refocusSearchAfterRender = false;
	private additionalFilterValues = new Map<string, string>();

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
		// Subclasses can override `wrapContent` to inject decoration (e.g. a
		// sidebar). Default returns parent unchanged.
		const contentHost = this.wrapContent(parent);
		this.root = DOM.append(contentHost, DOM.$('.clinical-list-editor.ciyex-editor-root'));
		// Outer container hides scrollbars by default; the inner content scrolls only
		// when it actually overflows. Matches ciyex-ehr-ui where pages don't double-scroll.
		this.root.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;background:var(--vscode-editor-background);position:relative;';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;width:100%;padding:20px 24px;box-sizing:border-box;';
	}

	/**
	 * Hook for subclasses to wrap the editor in additional UI such as a left
	 * sidebar. The returned element becomes the parent of the standard content.
	 * Default implementation returns `parent` unchanged.
	 */
	protected wrapContent(parent: HTMLElement): HTMLElement {
		return parent;
	}

	/** Reload list data (and stats if configured). Exposed for subclasses that
	 * mutate state (e.g. sidebar view-switch) and need to trigger a refresh. */
	protected reload(): void {
		if (this.config.statsPath) { this._loadStats(); }
		this._loadData();
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
				// Try to extract server-supplied error message so users see what really
				// failed (e.g. "Org alias not present" vs the generic HTTP 500 wrapper).
				let detail = '';
				try {
					const errData = await res.json() as Record<string, unknown> | null;
					if (errData) {
						detail = String(errData['message'] || errData['error'] || '');
					}
				} catch { /* non-JSON body */ }
				const base = `Failed to load data (HTTP ${res.status}).`;
				this._renderError(detail ? `${base} ${detail}` : `${base} The API endpoint may be unavailable.`);
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

	/** Call from a subclass (e.g. after switching a view) to reset state and reload. */
	protected _resetAndReload(): void {
		this.currentPage = 0;
		this.statusFilter = '';
		this.searchValue = '';
		this.priorityFilter = '';
		this.additionalFilterValues.clear();
		if (this.config.statsPath) { this._loadStats(); }
		this._loadData();
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

		if (cfg.formFields && cfg.formFields.length > 0 && cfg.creatable !== false) {
			const createBtn = DOM.append(titleBar, DOM.$('button'));
			createBtn.textContent = cfg.createLabel || `+ New ${cfg.title.replace(/s$/, '')}`;
			createBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			createBtn.addEventListener('mouseenter', () => { createBtn.style.background = '#1177bb'; });
			createBtn.addEventListener('mouseleave', () => { createBtn.style.background = '#0e639c'; });
			createBtn.addEventListener('click', () => this._openForm(null));
		}

		// allow-any-unicode-next-line
		// ─── Stats cards ───
		// Grid layout gives every card an equal width — the previous flex/wrap layout
		// sized cards to their content, which the QA team flagged as misaligned cards
		// with inconsistent spacing on the Referrals page.
		let numericStats = Object.entries(this.stats).filter(([, v]) => typeof v === 'number');
		if (numericStats.length > 0) {
			const row = DOM.append(this.contentEl, DOM.$('div'));
			// compactStats halves the vertical footprint for pages like Recall that
			// surface 7+ KPI cards — otherwise the strip dominates the viewport.
			const compact = !!cfg.compactStats;
			// In compact mode, only show stats that map to a filter value (clickable
			// KPI cards). Info-only aggregates (totals, sums) are omitted to keep
			// the strip to a single row. Issue #22: authorization/referrals.
			if (compact && cfg.statsFilterMap) {
				const mapped = new Set(Object.keys(cfg.statsFilterMap));
				numericStats = numericStats.filter(([k]) => mapped.has(k));
			}
			const cols = Math.min(numericStats.length, compact ? 8 : 6);
			const gap = compact ? 6 : 8;
			const marginB = compact ? 8 : 12;
			row.style.cssText = `display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap}px;margin-bottom:${marginB}px;`;
			// Compact card sizes (issues #17, #22): halve vertical footprint with
			// padding 8px 16px and 12px body font so the strip doesn't dominate.
			const cardPad = compact ? '3px 8px' : '8px 16px';
			const cardMinH = compact ? '24px' : '0';
			const cardGap = compact ? 1 : 6;
			const numFs = compact ? 13 : 12;
			const lblFs = compact ? 9 : 12;
			for (const [k, v] of numericStats) {
				// If statsFilterMap is set, only mapped keys are clickable filters; the
				// rest are info-only aggregates (e.g. total counts, sums). Without a
				// map, fall back to the legacy behavior of using the raw key.
				const filterValue = cfg.statsFilterMap ? cfg.statsFilterMap[k] : k;
				const clickable = filterValue !== undefined;
				const c = DOM.append(row, DOM.$('div'));
				const isActive = clickable && this.statusFilter === filterValue;
				// Default layout uses an inline row (number + label side-by-side) to
				// halve the vertical footprint. compactStats keeps the column layout
				// for KPI-heavy pages where the label needs its own line.
				const cardDir = compact ? 'column' : 'row';
				c.style.cssText = `padding:${cardPad};border:1px solid ${isActive ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};border-radius:6px;text-align:center;cursor:${clickable ? 'pointer' : 'default'};background:${isActive ? 'rgba(0,122,204,0.12)' : 'transparent'};transition:background 0.15s,border-color 0.15s;${clickable ? '' : 'opacity:0.85;'};display:flex;flex-direction:${cardDir};align-items:center;justify-content:center;gap:${cardGap}px;min-height:${cardMinH};`;
				if (clickable) {
					c.addEventListener('mouseenter', () => { if (!isActive) { c.style.background = 'var(--vscode-list-hoverBackground)'; } });
					c.addEventListener('mouseleave', () => { if (!isActive) { c.style.background = ''; } });
					c.addEventListener('click', () => { this.statusFilter = this.statusFilter === filterValue ? '' : filterValue!; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
				}
				const numEl = DOM.append(c, DOM.$('span'));
				numEl.textContent = String(v);
				numEl.style.cssText = `font-size:${numFs}px;font-weight:700;color:${STATUS_COLORS[k.toLowerCase()] || 'var(--vscode-foreground)'};line-height:1;`;
				const l = DOM.append(c, DOM.$('span'));
				l.textContent = k.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
				l.style.cssText = `font-size:${lblFs}px;color:var(--vscode-descriptionForeground);text-transform:capitalize;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;line-height:1;`;
			}
		}

		// allow-any-unicode-next-line
		// ─── Status tabs ───
		// Even spacing and consistent padding so the "subtopic" pills align
		// uniformly. Previously the 4px gap and varying padding made them feel
		// crowded (Medical Codes QA report).
		// When `statusAsDropdown` is set, the status filter is rendered inside the
		// toolbar as a <select> instead of pills (mirrors the web app's Labs page).
		if (cfg.statusTabs && !cfg.statusAsDropdown) {
			const tabs = DOM.append(this.contentEl, DOM.$('div'));
			tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;align-items:center;';
			for (const t of [{ label: 'All', value: '' }, ...cfg.statusTabs]) {
				const b = DOM.append(tabs, DOM.$('button'));
				b.textContent = t.label;
				const a = this.statusFilter === t.value;
				b.style.cssText = `padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;border:1px solid ${a ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};background:${a ? 'rgba(0,122,204,0.15)' : 'transparent'};color:var(--vscode-foreground);transition:all 0.15s;white-space:nowrap;`;
				b.addEventListener('mouseenter', () => { if (!a) { b.style.background = 'var(--vscode-list-hoverBackground)'; } });
				b.addEventListener('mouseleave', () => { if (!a) { b.style.background = 'transparent'; } });
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

		// Status dropdown — mirrors the web app's Labs page where Status sits
		// in the toolbar alongside Priority and Result.
		if (cfg.statusAsDropdown && cfg.statusTabs) {
			const sel = DOM.append(tb, DOM.$('select')) as HTMLSelectElement;
			sel.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;min-width:130px;';
			sel.title = 'Status';
			const allOpt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			allOpt.value = '';
			allOpt.textContent = 'All Status';
			for (const t of cfg.statusTabs) {
				const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				opt.value = t.value;
				opt.textContent = t.label;
				if (this.statusFilter === t.value) { opt.selected = true; }
			}
			sel.addEventListener('change', () => { this.statusFilter = sel.value; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
		}

		if (cfg.priorityOptions) {
			const sel = DOM.append(tb, DOM.$('select')) as HTMLSelectElement;
			sel.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;min-width:130px;';
			sel.title = 'Priority';
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

		// Additional dropdown filters (e.g. Type, Severity for CDS)
		if (cfg.additionalFilters) {
			for (const fd of cfg.additionalFilters) {
				const sel = DOM.append(tb, DOM.$('select')) as HTMLSelectElement;
				sel.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
				const allOpt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				allOpt.value = '';
				allOpt.textContent = fd.placeholder;
				const current = this.additionalFilterValues.get(fd.key) || '';
				for (const o of fd.options) {
					const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
					opt.value = o.value;
					opt.textContent = o.label;
					if (current === o.value) { opt.selected = true; }
				}
				sel.addEventListener('change', () => {
					this.additionalFilterValues.set(fd.key, sel.value);
					this.currentPage = 0;
					this._render();
				});
			}
		}

		// allow-any-unicode-next-line
		// ─── Table ───
		// Outer wrapper handles horizontal scrolling (issue #24): when the column
		// set is wider than the viewport, the user can scroll sideways instead of
		// the Actions column being clipped. Vertical scroll lives on the outer
		// editor root.
		const tbl = DOM.append(this.contentEl, DOM.$('div'));
		tbl.className = 'cle-table-wrap';
		tbl.style.cssText = 'flex:1;min-height:0;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow-x:auto;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;';
		const tblStyle = DOM.append(tbl, DOM.$('style'));
		tblStyle.textContent = '.cle-table-wrap{scrollbar-width:none;-ms-overflow-style:none;}.cle-table-wrap::-webkit-scrollbar{display:none;width:0;height:0;}';
		// `minmax(0,1fr)` lets flexible columns shrink below their content width.
		// Without this, an overflowing cell on one row would expand its column and
		// shift the others, so the header and data rows no longer aligned
		// (Medical Codes QA report: "Alignment issues between subtopics").
		const colWidths = cfg.columns.map(c => c.width || 'minmax(0,1fr)').join(' ');
		// Fixed actions-column width so header and data rows align (each row is its own
		// grid; `auto` would size independently per row and shift columns left/right).
		const actionCount = (cfg.actions?.length || 0) + (cfg.editable && cfg.formFields ? 1 : 0);
		const cols = colWidths + (actionCount > 0 ? ` ${Math.max(80, actionCount * 26 + 8)}px` : '');
		// Optional minimum table width (issue #24). Pages with many columns or a
		// must-show Actions column (e.g. Patient Education library) set this so the
		// outer wrap can scroll horizontally instead of collapsing the Actions cell.
		const tableMinW = cfg.tableMinWidth ? `min-width:${cfg.tableMinWidth};` : '';

		// Header
		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));text-transform:uppercase;letter-spacing:0.3px;position:sticky;top:0;z-index:2;${tableMinW}`;
		for (const c of cfg.columns) { DOM.append(hr, DOM.$('span')).textContent = c.label; }
		if (cfg.actions || cfg.editable) { DOM.append(hr, DOM.$('span')).textContent = 'Actions'; }

		const filteredItems = this._visibleItems();
		// Client-side pagination: slice the filtered set into pages so every editor
		// shows a consistent page-by-page experience even when clientSideFilter loads
		// the full list. Server-side editors (no clientSideFilter) already paginate
		// via _loadData, so this branch is skipped for them.
		const isClientPaginated = !!cfg.clientSideFilter;
		let pageItems: Record<string, unknown>[] = filteredItems;
		let clientTotalPages = 1;
		if (isClientPaginated) {
			clientTotalPages = Math.max(1, Math.ceil(filteredItems.length / this.clientPageSize));
			if (this.currentPage >= clientTotalPages) { this.currentPage = clientTotalPages - 1; }
			const start = this.currentPage * this.clientPageSize;
			pageItems = filteredItems.slice(start, start + this.clientPageSize);
		}
		const visibleItems = pageItems;

		if (visibleItems.length === 0) {
			const e = DOM.append(tbl, DOM.$('div'));
			e.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			e.textContent = 'No records found';
			// Pagination still shown below for empty pages so the user can navigate back.
		}

		for (const item of visibleItems) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:6px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;transition:background 0.1s;${tableMinW}`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });

			for (const c of cfg.columns) {
				const cell = DOM.append(r, DOM.$('span'));
				const rawVal = item[c.key];
				// Normalize raw booleans to human-readable text before rendering
				let displayVal: string;
				if (cfg.cellRenderer) {
					displayVal = cfg.cellRenderer(c.key, rawVal, item);
				} else if (typeof rawVal === 'boolean') {
					// isActive → Active/Inactive; other booleans → Yes/No
					const lk = c.key.toLowerCase();
					if (lk === 'isactive' || lk === 'active') {
						displayVal = rawVal ? 'Active' : 'Inactive';
					} else if (lk === 'enabled' || lk === 'available' || lk === 'published') {
						displayVal = rawVal ? 'Enabled' : 'Disabled';
					} else {
						displayVal = rawVal ? 'Yes' : 'No';
					}
				} else {
					displayVal = String(rawVal ?? '');
				}
				if (c.onClick) {
					const isEmpty = !rawVal || String(rawVal).trim() === '';
					const linkText = isEmpty ? (c.emptyLabel || '') : displayVal;
					cell.textContent = linkText;
					cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					if (linkText) {
						cell.style.cssText += 'color:#3b82f6;cursor:pointer;font-weight:500;';
						cell.addEventListener('click', (ev) => { ev.stopPropagation(); c.onClick!(item, this.apiService, () => { this._loadStats(); this._loadData(); }, this.dialogService); });
					}
				} else {
					cell.textContent = displayVal;
					cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					const lowerKey = c.key.toLowerCase();
					const v = displayVal;
					if (lowerKey === 'status' || lowerKey === 'priority' || lowerKey === 'severity' || lowerKey === 'urgency') {
						const clr = STATUS_COLORS[v.toLowerCase().replace(/\s+/g, '_')] || '#6b7280';
						cell.style.cssText += `color:${clr};font-weight:500;text-transform:capitalize;`;
					}
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
		// ─── Pagination ───
		const pg = DOM.append(this.contentEl, DOM.$('div'));
		pg.style.cssText = 'flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 4px 0;border-top:1px solid var(--vscode-editorWidget-border);margin-top:4px;';

		const recordsInfo = DOM.append(pg, DOM.$('span'));
		recordsInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		const navWrap = DOM.append(pg, DOM.$('div'));
		navWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';

		if (isClientPaginated) {
			const total = filteredItems.length;
			const start = total === 0 ? 0 : this.currentPage * this.clientPageSize + 1;
			const end = Math.min(total, (this.currentPage + 1) * this.clientPageSize);
			recordsInfo.textContent = `Showing ${start}-${end} of ${total} records`;

			const mkBtn = (label: string, disabled: boolean, onClick: () => void) => {
				const b = DOM.append(navWrap, DOM.$('button'));
				b.textContent = label;
				b.style.cssText = `padding:4px 10px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;font-size:12px;background:transparent;color:var(--vscode-foreground);cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '0.5' : '1'};`;
				if (!disabled) { b.addEventListener('click', onClick); }
			};
			mkBtn('Previous', this.currentPage <= 0, () => { this.currentPage--; this._render(); });
			const pageInfo = DOM.append(navWrap, DOM.$('span'));
			pageInfo.textContent = `Page ${this.currentPage + 1} of ${clientTotalPages}`;
			pageInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);padding:0 4px;';
			mkBtn('Next', this.currentPage >= clientTotalPages - 1, () => { this.currentPage++; this._render(); });
		} else {
			recordsInfo.textContent = `${this.items.length} record${this.items.length === 1 ? '' : 's'}`;

			const mkBtn = (label: string, disabled: boolean, onClick: () => void) => {
				const b = DOM.append(navWrap, DOM.$('button'));
				b.textContent = label;
				b.style.cssText = `padding:4px 10px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;font-size:12px;background:transparent;color:var(--vscode-foreground);cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '0.5' : '1'};`;
				if (!disabled) { b.addEventListener('click', onClick); }
			};
			const noNext = this.items.length < 20 && (this.totalPages <= this.currentPage + 1);
			mkBtn('Previous', this.currentPage <= 0, () => { this.currentPage--; this._loadData(); });
			const pageInfo = DOM.append(navWrap, DOM.$('span'));
			pageInfo.textContent = `Page ${this.currentPage + 1}${this.totalPages > 1 ? ` of ${this.totalPages}` : ''}`;
			pageInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);padding:0 4px;';
			mkBtn('Next', noNext, () => { this.currentPage++; this._loadData(); });
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
			// Additional dropdown filters (e.g. ruleType, severity)
			for (const [k, v] of this.additionalFilterValues.entries()) {
				if (!v) { continue; }
				const nv = norm(v);
				// Check the primary key and common alias (ruleType ↔ type)
				const candidates = [item[k], k === 'ruleType' ? item['type'] : undefined, k === 'type' ? item['ruleType'] : undefined];
				if (!candidates.some(c => c !== undefined && norm(c) === nv)) { return false; }
			}
			if (q) {
				const hit = cfg.clientSideFilter!.some(field => String(item[field] ?? '').toLowerCase().includes(q));
				if (!hit) { return false; }
			}
			return true;
		});
	}

	// allow-any-unicode-next-line
	// ─── Form Dialog ───

	protected async _openForm(item: Record<string, unknown> | null): Promise<void> {
		if (!this.config.formFields) { return; }
		// Optionally refetch full record by ID so the edit form has all relational fields.
		if (item && this.config.refetchOnEdit && item.id !== undefined && item.id !== null) {
			try {
				const itemUrl = this.config.buildItemUrl ? this.config.buildItemUrl(item) : `${this.config.apiPath}/${item.id}`;
				const res = await this.apiService.fetch(itemUrl);
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

		// Right-side slide-in form panel — matches the Tasks "+ New Task" pattern
		// so every create/edit dialog across the EHR uses the same shape.
		// Mount inside `.monaco-workbench` so workbench CSS variables
		// (--vscode-sideBar-background, --vscode-foreground, …) resolve to
		// the active theme. Body-mount used to fall back to the dark hex
		// defaults inline-styled below, producing a dark drawer on a light
		// workbench (QA-flagged on clinical / operations / system create
		// drawers).
		const overlayDoc = mainWindow.document;
		const overlayMount = findWorkbenchRoot(this.root, overlayDoc);
		this.formOverlay = DOM.append(overlayMount, DOM.$('div'));
		// Mirror the real workbench's classList onto the overlay so it
		// re-declares every workbench CSS variable on itself — keeps the
		// drawer's children themed even if the mount root above falls back
		// to body.
		if (overlayMount.classList.contains('monaco-workbench')) {
			this.formOverlay.className = overlayMount.className;
		} else {
			this.formOverlay.className = 'monaco-workbench';
		}
		this.formOverlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;justify-content:flex-end;';

		const backdrop = DOM.append(this.formOverlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';
		backdrop.addEventListener('click', () => this._closeForm());

		// Dialog (right-side panel) — flex column so header+footer are sticky and
		// only the body scrolls. overflow:hidden on the dialog itself removes the
		// outer scrollbar the user reported.
		// color-scheme follows the active workbench theme so native form chrome
		// (option popup, date picker, scrollbars) renders in the same mode as
		// the dialog. Hard-coding `dark` produced light-on-light forms when the
		// user was on a light theme (issue #18).
		const themeType = this.themeService.getColorTheme().type;
		const colorScheme = themeType === 'light' || themeType === 'hcLight' ? 'light' : 'dark';
		const dialog = DOM.append(this.formOverlay, DOM.$('div'));
		dialog.className = 'cle-form-dialog';
		dialog.style.cssText = `position:relative;width:560px;max-width:95vw;height:100%;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));border-left:1px solid var(--vscode-editorWidget-border);display:flex;flex-direction:column;overflow:hidden;box-shadow:-8px 0 24px rgba(0,0,0,0.3);z-index:1;color:var(--vscode-foreground);color-scheme:${colorScheme};`;
		// Force native <option> backgrounds to use the VS Code dropdown vars so
		// the dropdown popup matches the rest of the dialog rather than rendering
		// white on dark themes.
		const dialogStyle = DOM.append(dialog, DOM.$('style'));
		dialogStyle.textContent = [
			'.cle-form-dialog select, .cle-form-dialog option {',
			'  background:var(--vscode-dropdown-background, var(--vscode-input-background));',
			'  color:var(--vscode-dropdown-foreground, var(--vscode-input-foreground));',
			'}',
			'.cle-form-dialog input, .cle-form-dialog textarea {',
			'  background:var(--vscode-input-background);',
			'  color:var(--vscode-input-foreground);',
			'}',
			'.cle-form-dialog input::placeholder, .cle-form-dialog textarea::placeholder {',
			'  color:var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));',
			'}',
		].join('\n');

		// Header
		const header = DOM.append(dialog, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));z-index:2;';

		const title = DOM.append(header, DOM.$('h3'));
		if (isEdit && cfg.editTitle && this.editingItem) {
			title.textContent = cfg.editTitle(this.editingItem);
		} else {
			title.textContent = isEdit ? `Edit ${cfg.title.replace(/s$/, '')}` : `New ${cfg.title.replace(/s$/, '')}`;
		}
		title.style.cssText = 'margin:0;font-size:16px;font-weight:600;';

		const closeBtn = DOM.append(header, DOM.$('button'));
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:var(--vscode-foreground);padding:2px 6px;';
		closeBtn.addEventListener('click', () => this._closeForm());

		// Form body — flex:1 fills the space between header and footer.
		// Two-column grid lets form fields sit side-by-side (use width:'span 2'
		// on a field to make it span both columns).
		// Scrollbar is hidden via scrollbar-width + -webkit trick so the panel
		// never shows an outer scrollbar — content still scrolls when needed.
		const body = DOM.append(dialog, DOM.$('div'));
		body.className = 'cle-form-body';
		body.style.cssText = 'flex:1;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start;';
		const bodyStyleEl = DOM.append(dialog, DOM.$('style'));
		bodyStyleEl.textContent = 'div.cle-form-body::-webkit-scrollbar{display:none;width:0;height:0;}';

		const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
		// For date fields we hold direct refs to the visible mm/dd/yyyy input and the
		// picker so we can seed them when editing — `inputs` only carries the hidden
		// ISO field so save logic stays type-uniform.
		const dateRefs = new Map<string, { visible: HTMLInputElement; picker: HTMLInputElement }>();

		for (const field of fields) {
			const group = DOM.append(body, DOM.$('div'));
			group.style.cssText = field.width ? `grid-column:${field.width};` : '';
			if (field.hidden) {
				// Render an off-screen input so `inputs.get(...)` still resolves it for
				// auto-fill from search results, but keep the field invisible to the user.
				group.style.cssText += ';position:absolute;left:-9999px;visibility:hidden;';
			}

			const label = DOM.append(group, DOM.$('label'));
			label.textContent = field.label + (field.required ? ' *' : '');
			label.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';

			const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
			let inputEl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

			if (field.type === 'select' && field.options) {
				// Use the shared custom dropdown instead of a native <select>.
				// Native <option> popups are rendered by the OS using its own
				// colour scheme — on dark workbench themes that produces faint
				// grey-on-grey non-highlighted options, which the QA team
				// flagged as the unreadable dropdown across every create/edit
				// form drawer.
				inputEl = createCustomDropdown({
					parent: group,
					options: field.options,
					initialValue: '',
					placeholder: `Select ${field.label}...`,
					triggerStyle: inputStyle + 'min-width:200px;',
				});
			} else if (field.type === 'textarea') {
				inputEl = DOM.append(group, DOM.$('textarea')) as HTMLTextAreaElement;
				// Issue #17: 60px was too tall — the prescription dialog felt
				// dominated by the Notes textarea. 40px keeps two visible lines
				// and the user can still drag-resize for longer entries.
				inputEl.style.cssText = inputStyle + 'min-height:40px;max-height:120px;resize:vertical;font-family:inherit;';
				inputEl.placeholder = field.placeholder || '';
			} else if (field.type === 'search' && (field.apiPath || field.searchApiPath)) {
				// Search field with live autocomplete dropdown. The match
				// dropdown is mounted on document.body with position:fixed
				// so it escapes the form grid's overflow / transform stack
				// and never renders behind the next row's label — the bug
				// QA reported where "Michael John" appeared overlapping the
				// "Priority" label below the Provider input.
				const searchWrapper = DOM.append(group, DOM.$('div'));
				searchWrapper.style.cssText = 'position:relative;';

				inputEl = DOM.append(searchWrapper, DOM.$('input')) as HTMLInputElement;
				inputEl.type = 'text';
				inputEl.style.cssText = inputStyle;
				inputEl.placeholder = field.placeholder || `Search ${field.label}...`;

				const ownerDoc = group.ownerDocument || document;
				const dropdown = ownerDoc.createElement('div');
				const searchWorkbenchRoot = findWorkbenchRoot(group, ownerDoc);
				dropdown.className = searchWorkbenchRoot.classList && searchWorkbenchRoot.classList.contains('monaco-workbench') ? searchWorkbenchRoot.className : 'monaco-workbench';
				dropdown.style.cssText = 'position:fixed;max-height:220px;overflow-y:auto;background:var(--vscode-editorWidget-background,#1e1e1e);color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,0.35));border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.45);z-index:10000;display:none;';
				searchWorkbenchRoot.appendChild(dropdown);
				const positionDropdown = () => {
					const rect = (inputEl as HTMLInputElement).getBoundingClientRect();
					dropdown.style.left = `${rect.left}px`;
					dropdown.style.top = `${rect.bottom + 2}px`;
					dropdown.style.width = `${rect.width}px`;
				};
				const repositionDropdown = () => { if (dropdown.style.display === 'block') { positionDropdown(); } };
				const win = ownerDoc.defaultView;
				win?.addEventListener('scroll', repositionDropdown, true);
				win?.addEventListener('resize', repositionDropdown);
				// Detach the body-mounted dropdown + listeners once the
				// search input is removed from the DOM (dialog closed).
				const dropdownObserver = new MutationObserver(() => {
					if (!(inputEl as HTMLInputElement).isConnected) {
						dropdownObserver.disconnect();
						win?.removeEventListener('scroll', repositionDropdown, true);
						win?.removeEventListener('resize', repositionDropdown);
						if (dropdown.parentElement) { dropdown.parentElement.removeChild(dropdown); }
					}
				});
				if (searchWrapper.parentNode) { dropdownObserver.observe(searchWrapper.parentNode, { childList: true, subtree: true }); }
				const showDropdown = () => { positionDropdown(); dropdown.style.display = 'block'; };

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
						let results: Record<string, unknown>[] = [];
						try {
							const param = field.searchParam || 'search';
							const sep = searchEndpoint.includes('?') ? '&' : '?';
							const res = await this.apiService.fetch(`${searchEndpoint}${sep}${param}=${encodeURIComponent(query)}`);
							if (res.ok) {
								const data = await res.json();
								const wrapper = data?.data || data;
								results = wrapper?.content || (Array.isArray(wrapper) ? wrapper : []);
							}
						} catch {
							// fall through to fallback
						}
						// Client-side fallback when API returns empty/fails (e.g. CVX codes
						// when ciyex-codes has no CVX data loaded).
						if (results.length === 0 && field.fallbackOptions && field.fallbackOptions.length > 0) {
							const lq = query.toLowerCase();
							results = field.fallbackOptions
								.filter(opt => Object.values(opt).some(v => String(v).toLowerCase().includes(lq)))
								.slice(0, 15);
						}
						DOM.clearNode(dropdown);
						if (results.length === 0) {
							const noRes = DOM.append(dropdown, DOM.$('div'));
							noRes.textContent = 'No results found';
							noRes.style.cssText = 'padding:8px 10px;font-size:12px;color:var(--vscode-descriptionForeground);';
							showDropdown();
							return;
						}
						{
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
							showDropdown();
						}
					}, 300));
				});

				// Hide dropdown on blur (with delay for click)
				inputEl.addEventListener('blur', () => {
					setTimeout(() => { dropdown.style.display = 'none'; }, 200);
				});
				inputEl.addEventListener('focus', () => {
					if (dropdown.childElementCount > 0) { showDropdown(); }
				});
			} else if (field.type === 'date') {
				// mm/dd/yyyy text + calendar icon inside the field. Native `<input type="date">`
				// renders in OS-locale order on Linux Electron (yyyy-mm-dd), so we render
				// the US format ourselves and overlay a hidden picker that opens via the icon.
				const wrap = DOM.append(group, DOM.$('div'));
				wrap.style.cssText = 'position:relative;display:block;';
				const isoToUs = (iso: string): string => {
					const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
					return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
				};
				const usToIso = (us: string): string => {
					const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us);
					if (!m) { return ''; }
					return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
				};
				const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				visible.type = 'text';
				visible.placeholder = 'MM/DD/YYYY';
				// Reserve right padding so the icon doesn't overlap typed text.
				visible.style.cssText = inputStyle + 'padding-right:30px;';
				visible.maxLength = 10;
				const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				hidden.type = 'hidden';
				visible.addEventListener('input', () => {
					const iso = usToIso(visible.value);
					hidden.value = iso;
					visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
				});
				// Native picker — fully overlaid on top of the icon area so clicking
				// the icon opens the calendar. We hide the native chrome via opacity:0.
				const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				picker.type = 'date';
				picker.title = 'Open calendar';
				picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
				picker.addEventListener('change', () => {
					visible.value = isoToUs(picker.value);
					hidden.value = picker.value;
				});
				// Visible icon (decorative) — sits behind the transparent picker so
				// clicks fall through to the picker. pointer-events:none keeps the
				// real input click target on the underlying picker.
				const icon = DOM.append(wrap, DOM.$('span'));
				icon.textContent = '\u{1F4C5}';
				icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--vscode-descriptionForeground);pointer-events:none;line-height:1;';
				dateRefs.set(field.key, { visible, picker });
				inputEl = hidden;
			} else {
				inputEl = DOM.append(group, DOM.$('input')) as HTMLInputElement;
				inputEl.type = field.type;
				inputEl.style.cssText = inputStyle;
				inputEl.placeholder = field.placeholder || '';
				// typingPattern: enforce allowed characters at keystroke/paste/input level.
				if (field.typingPattern) {
					const tpRe = new RegExp(field.typingPattern);
					const navKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
					inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
						if (navKeys.includes(e.key) || e.ctrlKey || e.metaKey) { return; }
						if (!tpRe.test(e.key)) { e.preventDefault(); }
					});
					inputEl.addEventListener('paste', (e: ClipboardEvent) => {
						e.preventDefault();
						const t = e.clipboardData?.getData('text') ?? '';
						const filtered = t.split('').filter(c => tpRe.test(c)).join('');
						if (filtered) { DOM.getActiveWindow().document.execCommand('insertText', false, filtered); }
					});
					inputEl.addEventListener('input', () => {
						const clean = (inputEl as HTMLInputElement).value.split('').filter(c => tpRe.test(c)).join('');
						if (clean !== (inputEl as HTMLInputElement).value) { (inputEl as HTMLInputElement).value = clean; }
					});
				}
				if (field.type === 'number') {
					// Do NOT set HTML5 min/max attributes — Chromium silently clears
					// the input value when the typed value falls outside [min,max],
					// which makes our required-check fire with "field is required"
					// instead of the field-specific range message. All range validation
					// is handled explicitly in the save-click handler below.
					inputEl.setAttribute('data-min', String(field.minValue ?? ''));
					inputEl.setAttribute('data-max', String(field.maxValue ?? ''));
					// Positive-integer fields (minValue >= 1) must never accept
					// alphabets, negatives, decimals, or scientific notation.
					// Three-layer defence:
					//   1. keydown — blocks individual keystrokes before they land
					//      (covers -, ., e, E, + and all letter keys).
					//   2. paste — strips non-digits from pasted content so
					//      clipboard paste cannot bypass the keydown guard.
					//   3. input — final backstop that scrubs any character that
					//      slips through (e.g. IME, drag-and-drop).
					if ((field.minValue ?? 0) >= 1) {
						inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
							const nav = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
								'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
							if (nav.includes(e.key) || e.ctrlKey || e.metaKey) { return; }
							if (!/^\d$/.test(e.key)) { e.preventDefault(); }
						});
						inputEl.addEventListener('paste', (e: ClipboardEvent) => {
							e.preventDefault();
							const text = e.clipboardData?.getData('text') ?? '';
							const digitsOnly = text.replace(/\D/g, '');
							if (digitsOnly) {
								DOM.getActiveWindow().document.execCommand('insertText', false, digitsOnly);
							}
						});
						inputEl.addEventListener('input', () => {
							const clean = inputEl.value.replace(/\D/g, '');
							if (clean !== inputEl.value) { inputEl.value = clean; }
						});
					}
				}
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
			// For date fields the registered input is the hidden ISO field — also seed
			// the visible mm/dd/yyyy text and the picker so the user sees the current
			// value when editing.
			if (field.type === 'date' && val) {
				const iso = val.split('T')[0];
				const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
				const refs = dateRefs.get(field.key);
				if (m && refs) {
					refs.visible.value = `${m[2]}/${m[3]}/${m[1]}`;
					refs.picker.value = iso;
				}
			}

			inputs.set(field.key, inputEl);
		}

		// formExtras hook (issue #23) — lets configs (e.g. Care Plans) render
		// dynamic Goals / Interventions lists inside the dialog and contribute
		// extra payload fields at save time.
		const extrasHost = DOM.append(body, DOM.$('div'));
		extrasHost.style.cssText = 'grid-column:span 2;';
		const extras = cfg.formExtras ? cfg.formExtras(extrasHost, this.editingItem) : null;

		// Error area — spans both columns so it's always visible above the footer.
		const errorEl = DOM.append(body, DOM.$('div'));
		errorEl.style.cssText = 'grid-column:span 2;color:#f48771;font-size:12px;display:none;';

		// Footer
		const footer = DOM.append(dialog, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--vscode-editorWidget-border);position:sticky;bottom:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));z-index:2;';

		const cancelBtn = DOM.append(footer, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
		cancelBtn.addEventListener('click', () => this._closeForm());

		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
		saveBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			// Reset prior validation state
			const clearError = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined) => {
				if (!input) { return; }
				input.style.borderColor = '';
				input.addEventListener('input', () => { input.style.borderColor = ''; }, { once: true });
				input.addEventListener('change', () => { input.style.borderColor = ''; }, { once: true });
			};
			for (const input of inputs.values()) { clearError(input); }
			const failValidation = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined, msg: string, field: FormFieldDef) => {
				errorEl.textContent = msg;
				errorEl.style.display = 'block';
				if (input) {
					input.style.borderColor = '#ef4444';
					if (!field.hidden) { input.focus(); }
				}
			};
			// Validate required fields + patterns + ranges
			for (const field of fields) {
				if (field.required) {
					const input = inputs.get(field.key);
					if (!input || !input.value.trim()) {
						failValidation(input, field.validationMessage || `${field.label} is required`, field);
						return;
					}
				}
				if (field.validationPattern) {
					const input = inputs.get(field.key);
					const v = input?.value.trim() || '';
					if (v && !new RegExp(field.validationPattern).test(v)) {
						failValidation(input, field.validationMessage || `${field.label} format is invalid`, field);
						return;
					}
				}
				if (field.type === 'number') {
					const input = inputs.get(field.key);
					const v = input?.value.trim() || '';
					if (v) {
						const n = Number(v);
						if (!isFinite(n) || isNaN(n)) {
							failValidation(input, field.validationMessage || `${field.label} must be a valid number`, field);
							return;
						}
						if (!Number.isInteger(n) && field.validationPattern && /^\[1-9\]/.test(field.validationPattern)) {
							failValidation(input, field.validationMessage || `${field.label} must be a whole number`, field);
							return;
						}
						const minV = field.minValue !== undefined ? field.minValue : undefined;
						if (minV !== undefined && n < minV) {
							failValidation(input, field.validationMessage || `${field.label} must be ${minV} or greater`, field);
							return;
						}
						if (field.maxValue !== undefined && n > field.maxValue) {
							failValidation(input, field.validationMessage || `${field.label} must be ${field.maxValue} or less`, field);
							return;
						}
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
			// Merge dynamic-list fields contributed by formExtras (issue #23).
			if (extras) {
				const extraValues = extras.collect();
				for (const [k, v] of Object.entries(extraValues)) {
					formValues[k] = v;
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
				let url: string;
				if (isEdit) {
					// Use the original record's identifiers for the URL — the resource being
					// updated is identified by its DB-side IDs (patientId, id), which are
					// immutable post-create. Form-edited values go in the body, not the path.
					url = cfg.buildItemUrl
						? cfg.buildItemUrl(this.editingItem!)
						: `${cfg.apiPath}/${this.editingItem!.id}`;
				} else {
					url = cfg.buildCreateUrl ? cfg.buildCreateUrl(payload) : cfg.apiPath;
				}
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
		const parentW = this.root.parentElement ? this.root.parentElement.clientWidth : dimension.width;
		if (parentW > 0 && parentW < dimension.width) {
			this.root.style.width = `${parentW}px`;
		}
	}

	override dispose(): void {
		if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
		for (const timer of this.searchDebounceTimers.values()) { clearTimeout(timer); }
		this.searchDebounceTimers.clear();
		this._closeForm();
		super.dispose();
	}
}
