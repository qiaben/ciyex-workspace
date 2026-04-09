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

export interface ClinicalEditorConfig {
	title: string;
	apiPath: string;
	statsPath?: string;
	columns: ColumnDef[];
	statusTabs?: StatusTab[];
	actions?: ActionDef[];
	searchPlaceholder?: string;
}

/**
 * Base class for all clinical list editors.
 * Subclasses set `static config` and the base renders everything.
 */
export abstract class ClinicalListEditorBase extends EditorPane {
	protected abstract readonly config: ClinicalEditorConfig;

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private items: Record<string, unknown>[] = [];
	private stats: Record<string, number> = {};
	private searchValue = '';
	private statusFilter = '';
	private currentPage = 0;

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
		this.contentEl.style.cssText = 'max-width:1100px;margin:0 auto;padding:20px 24px;';
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
			const res = await this.apiService.fetch(url);
			if (!res.ok) { return; }
			const data = await res.json();
			this.items = (data?.data?.content || data?.data || data?.content || data || []) as Record<string, unknown>[];
			this._render();
		} catch { this._render(); }
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);
		const cfg = this.config;

		// Title
		const h = DOM.append(this.contentEl, DOM.$('h2'));
		h.textContent = cfg.title;
		h.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 16px;';

		// Stats
		if (Object.keys(this.stats).length > 0) {
			const row = DOM.append(this.contentEl, DOM.$('div'));
			row.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;';
			for (const [k, v] of Object.entries(this.stats)) {
				if (typeof v !== 'number') { continue; }
				const c = DOM.append(row, DOM.$('div'));
				c.style.cssText = 'padding:8px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;text-align:center;cursor:pointer;min-width:70px;';
				c.addEventListener('mouseenter', () => { c.style.background = 'var(--vscode-list-hoverBackground)'; });
				c.addEventListener('mouseleave', () => { c.style.background = ''; });
				c.addEventListener('click', () => { this.statusFilter = k; this.currentPage = 0; this._loadData(); });
				DOM.append(c, DOM.$('div')).textContent = String(v);
				(c.firstChild as HTMLElement).style.cssText = 'font-size:18px;font-weight:700;';
				const l = DOM.append(c, DOM.$('div'));
				l.textContent = k.replace(/([A-Z])/g, ' $1').trim();
				l.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);text-transform:capitalize;';
			}
		}

		// Status tabs
		if (cfg.statusTabs) {
			const tabs = DOM.append(this.contentEl, DOM.$('div'));
			tabs.style.cssText = 'display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;';
			for (const t of [{ label: 'All', value: '' }, ...cfg.statusTabs]) {
				const b = DOM.append(tabs, DOM.$('button'));
				b.textContent = t.label;
				const a = this.statusFilter === t.value;
				b.style.cssText = `padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;border:1px solid ${a ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};background:${a ? 'rgba(0,122,204,0.15)' : 'transparent'};color:var(--vscode-foreground);`;
				b.addEventListener('click', () => { this.statusFilter = t.value; this.currentPage = 0; this._loadData(); });
			}
		}

		// Search
		const tb = DOM.append(this.contentEl, DOM.$('div'));
		tb.style.cssText = 'margin-bottom:12px;';
		const s = DOM.append(tb, DOM.$('input')) as HTMLInputElement;
		s.type = 'text';
		s.placeholder = cfg.searchPlaceholder || 'Search...';
		s.value = this.searchValue;
		s.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		s.addEventListener('input', () => { this.searchValue = s.value; this.currentPage = 0; this._loadData(); });

		// Table
		const tbl = DOM.append(this.contentEl, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const cols = cfg.columns.map(c => c.width || '1fr').join(' ') + (cfg.actions ? ' 80px' : '');

		// Header
		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(0,122,204,0.05);`;
		for (const c of cfg.columns) { DOM.append(hr, DOM.$('span')).textContent = c.label; }
		if (cfg.actions) { DOM.append(hr, DOM.$('span')).textContent = 'Actions'; }

		if (this.items.length === 0) {
			const e = DOM.append(tbl, DOM.$('div'));
			e.style.cssText = 'padding:30px;text-align:center;color:var(--vscode-descriptionForeground);';
			e.textContent = 'No records found';
			return;
		}

		const statusColors: Record<string, string> = {
			active: '#22c55e', completed: '#6b7280', cancelled: '#ef4444', 'on-hold': '#f59e0b',
			discontinued: '#ef4444', pending: '#f59e0b', approved: '#22c55e', denied: '#ef4444',
			draft: '#6b7280', sent: '#3b82f6', scheduled: '#8b5cf6', expired: '#6b7280',
			routine: '#3b82f6', urgent: '#f59e0b', stat: '#ef4444',
			info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444',
		};

		for (const item of this.items) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:6px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });

			for (const c of cfg.columns) {
				const cell = DOM.append(r, DOM.$('span'));
				const v = String(item[c.key] || '');
				cell.textContent = v;
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				if (c.key === 'status' || c.key === 'priority' || c.key === 'severity') {
					const clr = statusColors[v.toLowerCase()] || '#6b7280';
					cell.style.cssText += `color:${clr};font-weight:500;`;
				}
			}

			if (cfg.actions) {
				const acts = DOM.append(r, DOM.$('div'));
				acts.style.cssText = 'display:flex;gap:2px;';
				for (const a of cfg.actions) {
					const btn = DOM.append(acts, DOM.$('button'));
					btn.textContent = a.icon;
					btn.title = a.label;
					btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:2px;';
					btn.addEventListener('click', (ev) => { ev.stopPropagation(); a.handler(item, this.apiService, () => this._loadData()); });
				}
			}
		}

		// Pagination
		const pg = DOM.append(this.contentEl, DOM.$('div'));
		pg.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:12px;';
		if (this.currentPage > 0) {
			const p = DOM.append(pg, DOM.$('button'));
			p.textContent = '◀ Previous';
			p.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
			p.addEventListener('click', () => { this.currentPage--; this._loadData(); });
		}
		if (this.items.length >= 20) {
			const n = DOM.append(pg, DOM.$('button'));
			n.textContent = 'Next ▶';
			n.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
			n.addEventListener('click', () => { this.currentPage++; this._loadData(); });
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
