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
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface ColumnDef { key: string; label: string; width?: string }
interface StatusTab { label: string; value: string }
interface ActionDef { label: string; icon: string; handler: (item: Record<string, unknown>, api: ICiyexApiService, reload: () => void) => void }

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
	/** Default value for new records */
	defaultValue?: string | number;
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

	constructor(
		id: string,
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService protected readonly apiService: ICiyexApiService,
	) {
		super(id, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.clinical-list-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
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
			let url = `${this.config.apiPath}?page=${this.currentPage}&size=20`;
			if (this.searchValue) { url += `&q=${encodeURIComponent(this.searchValue)}`; }
			if (this.statusFilter) { url += `&status=${this.statusFilter}`; }
			if (this.priorityFilter) { url += `&priority=${this.priorityFilter}`; }
			const res = await this.apiService.fetch(url);
			if (!res.ok) { return; }
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
		} catch { this._render(); }
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
				c.addEventListener('click', () => { this.statusFilter = this.statusFilter === k ? '' : k; this.currentPage = 0; this._loadData(); });
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
				b.addEventListener('click', () => { this.statusFilter = t.value; this.currentPage = 0; this._loadData(); });
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
				this._loadData();
			}, 300);
		});

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
			sel.addEventListener('change', () => { this.priorityFilter = sel.value; this.currentPage = 0; this._loadData(); });
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

		if (this.items.length === 0) {
			const e = DOM.append(tbl, DOM.$('div'));
			e.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			e.textContent = 'No records found';
			return;
		}

		for (const item of this.items) {
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
						btn.addEventListener('click', (ev) => { ev.stopPropagation(); a.handler(item, this.apiService, () => { this._loadStats(); this._loadData(); }); });
					}
				}
			}
		}

		// allow-any-unicode-next-line
		// ─── Pagination ───
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
	}

	// allow-any-unicode-next-line
	// ─── Form Dialog ───

	private _openForm(item: Record<string, unknown> | null): void {
		if (!this.config.formFields) { return; }
		this.editingItem = item;
		this._renderForm();
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
		title.textContent = isEdit ? `Edit ${cfg.title.replace(/s$/, '')}` : `New ${cfg.title.replace(/s$/, '')}`;
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
				inputEl.style.cssText = inputStyle;
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
			} else {
				inputEl = DOM.append(group, DOM.$('input')) as HTMLInputElement;
				inputEl.type = field.type === 'search' ? 'text' : field.type;
				inputEl.style.cssText = inputStyle;
				inputEl.placeholder = field.placeholder || '';
			}

			// Set value from editing item or default
			const val = isEdit && this.editingItem ? String(this.editingItem[field.key] ?? '') : String(field.defaultValue ?? '');
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

			// Build payload
			const payload: Record<string, unknown> = {};
			for (const field of fields) {
				const input = inputs.get(field.key);
				if (!input) { continue; }
				const v = input.value.trim();
				if (field.type === 'number' && v) {
					payload[field.key] = Number(v);
				} else if (v) {
					payload[field.key] = v;
				}
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
					const errData = await res.json().catch(() => null);
					errorEl.textContent = (errData as Record<string, string>)?.message || `Error: ${res.status}`;
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
		this._closeForm();
		super.dispose();
	}
}
