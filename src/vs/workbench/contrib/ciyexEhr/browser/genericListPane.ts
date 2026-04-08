/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

/**
 * Configuration for a generic EHR list pane.
 */
export interface IGenericListConfig {
	apiPath: string;
	columns: Array<{
		key: string;
		label?: string;
		width?: string;
	}>;
	onClickCommand?: string;
	onClickIdField?: string;
	onClickLabelField?: string;
	emptyMessage?: string;
	iconId?: string;
	avatarFields?: [string, string]; // [firstNameField, lastNameField] for avatar circle
	labelMap?: Record<string, string>; // Map codes to readable labels (e.g. AMB → Ambulatory)
	filters?: Array<{ key: string; label: string; options: string[] }>; // Filter dropdowns
}

/**
 * A reusable ViewPane that fetches a list from an API endpoint and renders rows.
 * Used for Encounters, Labs, Prescriptions, Immunizations, etc.
 */
export class GenericListPane extends ViewPane {

	private _listEl: HTMLElement | undefined;
	private _config: IGenericListConfig;

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
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Configuration is set via a static registry keyed by view ID
		this._config = GenericListPane.configs.get(options.id) || {
			apiPath: '/api/patients',
			columns: [{ key: 'name' }],
		};
	}

	// Static config registry - set before view is instantiated
	static readonly configs = new Map<string, IGenericListConfig>();

	private _allItems: Record<string, unknown>[] = [];
	private _filterValue = '';
	private _paginationEl: HTMLElement | undefined;
	private _currentPage = 0;
	private _pageSize = 20;

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.style.cssText = 'overflow:auto;display:flex;flex-direction:column;height:100%;';

		// Toolbar: search + filter + action
		const toolbar = document.createElement('div');
		toolbar.style.cssText = 'display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;flex-wrap:wrap;';
		container.appendChild(toolbar);

		// Search
		const search = document.createElement('input');
		search.type = 'text';
		search.placeholder = 'Search...';
		search.style.cssText = 'flex:1;min-width:60px;padding:3px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;box-sizing:border-box;';
		search.addEventListener('input', () => this._filterAndRender(search.value));
		toolbar.appendChild(search);

		// Status filter dropdown
		if (this._config.apiPath.includes('encounter')) {
			const filter = document.createElement('select');
			filter.style.cssText = 'padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;cursor:pointer;';
			for (const opt of ['All', 'SIGNED', 'UNSIGNED', 'INCOMPLETE']) {
				const o = document.createElement('option');
				o.value = opt === 'All' ? '' : opt;
				o.textContent = opt;
				filter.appendChild(o);
			}
			filter.addEventListener('change', () => { this._filterValue = filter.value; this._filterAndRender(search.value); });
			toolbar.appendChild(filter);
		}

		// + New button
		if (this._config.onClickCommand) {
			const addBtn = document.createElement('button');
			addBtn.textContent = '+';
			addBtn.title = 'New';
			addBtn.style.cssText = 'padding:2px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:12px;height:24px;width:24px;';
			addBtn.addEventListener('click', () => this.commandService.executeCommand(this._config.onClickCommand!));
			toolbar.appendChild(addBtn);
		}

		this._listEl = document.createElement('div');
		this._listEl.style.cssText = 'flex:1;overflow-y:auto;';
		container.appendChild(this._listEl);

		// Pagination bar
		this._paginationEl = document.createElement('div');
		this._paginationEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;border-top:1px solid var(--vscode-editorWidget-border);flex-shrink:0;font-size:11px;color:var(--vscode-descriptionForeground);';
		container.appendChild(this._paginationEl);

		this._showMsg('Loading...');
		this._loadData();

		const retry = setInterval(() => {
			if (this._loaded) { clearInterval(retry); return; }
			this._loadData();
		}, 2000);
	}

	private _loaded = false;

	private _filterAndRender(search: string): void {
		if (!this._listEl || this._allItems.length === 0) { return; }
		const q = search.toLowerCase();
		const filtered = this._allItems.filter(item => {
			if (this._filterValue && String(item.status || '').toUpperCase() !== this._filterValue) { return false; }
			if (!q) { return true; }
			return Object.values(item).some(v => v && String(v).toLowerCase().includes(q));
		});
		this._currentPage = 0;
		this._renderPage(filtered);
	}

	private _renderPage(items: Record<string, unknown>[]): void {
		const start = this._currentPage * this._pageSize;
		const pageItems = items.slice(start, start + this._pageSize);
		this._renderItems(pageItems);

		// Pagination controls
		if (this._paginationEl) {
			this._paginationEl.innerHTML = '';
			const total = items.length;
			const totalPages = Math.ceil(total / this._pageSize);
			if (totalPages <= 1) { return; }

			const info = document.createElement('span');
			info.textContent = `${start + 1}-${Math.min(start + this._pageSize, total)} of ${total}`;
			info.style.flex = '1';
			this._paginationEl.appendChild(info);

			const prevBtn = document.createElement('button');
			prevBtn.textContent = '\u25C0';
			prevBtn.disabled = this._currentPage === 0;
			prevBtn.style.cssText = 'background:none;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:11px;padding:2px 4px;opacity:' + (this._currentPage === 0 ? '0.3' : '1');
			prevBtn.addEventListener('click', () => { this._currentPage--; this._renderPage(items); });
			this._paginationEl.appendChild(prevBtn);

			const pageInfo = document.createElement('span');
			pageInfo.textContent = `${this._currentPage + 1}/${totalPages}`;
			this._paginationEl.appendChild(pageInfo);

			const nextBtn = document.createElement('button');
			nextBtn.textContent = '\u25B6';
			nextBtn.disabled = this._currentPage >= totalPages - 1;
			nextBtn.style.cssText = 'background:none;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:11px;padding:2px 4px;opacity:' + (this._currentPage >= totalPages - 1 ? '0.3' : '1');
			nextBtn.addEventListener('click', () => { this._currentPage++; this._renderPage(items); });
			this._paginationEl.appendChild(nextBtn);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		// Dynamic page size: ~34px per row, minus toolbar(34px) + pagination(28px)
		const rowHeight = 34;
		const overhead = 62;
		const newPageSize = Math.max(5, Math.floor((height - overhead) / rowHeight));
		if (newPageSize !== this._pageSize && this._loaded) {
			this._pageSize = newPageSize;
			this._currentPage = 0;
			this._renderPage(this._allItems);
		} else {
			this._pageSize = newPageSize;
		}
	}

	private async _loadData(): Promise<void> {
		try {
			const url = this._config.apiPath.includes('?') ? this._config.apiPath : `${this._config.apiPath}?page=0&size=100`;
			const response = await this.apiService.fetch(url);
			if (!response.ok) {
				this._showMsg(`Failed to load (${response.status})`);
				return;
			}
			const data = await response.json();
			const items = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
			if (items.length === 0) {
				this._showMsg(this._config.emptyMessage || 'No items found');
				return;
			}
			// Apply label map (e.g. AMB → Ambulatory, HH → Home Health)
			if (this._config.labelMap) {
				const map = this._config.labelMap;
				for (const item of items) {
					for (const col of this._config.columns) {
						const val = String((item as Record<string, unknown>)[col.key] || '');
						if (val in map) { (item as Record<string, unknown>)[col.key] = map[val]; }
					}
				}
			}
			this._allItems = items;
			this._loaded = true;
			this._currentPage = 0;
			this._renderPage(items);
		} catch (err) {
			const msg = String(err).includes('Not authenticated') ? 'Waiting for login...' : 'Unable to connect to server';
			this._showMsg(msg);
		}
	}

	private _renderItems(items: Record<string, unknown>[]): void {
		if (!this._listEl) {
			return;
		}
		this._listEl.innerHTML = '';
		if (items.length === 0) {
			this._showMsg(this._config.emptyMessage || 'No items found');
			return;
		}

		for (const item of items) {
			const row = document.createElement('div');
			Object.assign(row.style, {
				padding: '6px 16px', cursor: 'pointer', display: 'flex',
				alignItems: 'center', gap: '8px', fontSize: '12px',
				borderBottom: '1px solid var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))',
			});
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			// Avatar or icon
			if (this._config.avatarFields) {
				const [fnField, lnField] = this._config.avatarFields;
				const fn = String(item[fnField] || '');
				const ln = String(item[lnField] || '');
				const initials = `${fn[0] || ''}${ln[0] || ''}`.toUpperCase();
				const hue = ((fn.charCodeAt(0) || 0) * 7 + (ln.charCodeAt(0) || 0) * 13) % 360;
				const av = document.createElement('span');
				Object.assign(av.style, {
					width: '22px', height: '22px', borderRadius: '50%',
					display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
					fontSize: '9px', fontWeight: '600', color: '#fff', flexShrink: '0',
					background: `hsl(${hue}, 50%, 40%)`,
				});
				av.textContent = initials;
				row.appendChild(av);
			} else if (this._config.iconId) {
				const icon = document.createElement('span');
				icon.className = `codicon codicon-${this._config.iconId}`;
				icon.style.opacity = '0.6';
				row.appendChild(icon);
			}

			// Columns
			for (let i = 0; i < this._config.columns.length; i++) {
				const col = this._config.columns[i];
				let val = this._resolveValue(item, col.key);
				// Format dates
				if ((col.key.includes('date') || col.key.includes('Date')) && val && /^\d{4}-\d{2}/.test(val)) {
					try { val = new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { /* */ }
				}
				const span = document.createElement('span');
				// Status column → color-coded badge (SIGNED=green, UNSIGNED=red, INCOMPLETE=amber)
				if (col.key === 'status') {
					const s = val.toUpperCase();
					const color = s === 'SIGNED' || s === 'FINISHED' ? '#22c55e' : s === 'UNSIGNED' || s === 'ENTERED-IN-ERROR' || s === 'CANCELLED' ? '#ef4444' : s === 'INCOMPLETE' || s === 'IN-PROGRESS' || s === 'ARRIVED' ? '#f59e0b' : '#6b7280';
					span.textContent = val;
					Object.assign(span.style, { fontSize: '9px', padding: '1px 6px', borderRadius: '3px', background: `${color}18`, color: color, textTransform: 'capitalize', whiteSpace: 'nowrap', fontWeight: '500' });
				} else if (i === 0) {
					span.textContent = val;
					span.style.flex = '1';
					span.style.color = 'var(--vscode-foreground)';
					span.style.overflow = 'hidden';
					span.style.textOverflow = 'ellipsis';
					span.style.whiteSpace = 'nowrap';
				} else {
					span.textContent = val;
					span.style.color = 'var(--vscode-descriptionForeground)';
					span.style.fontSize = '11px';
					span.style.whiteSpace = 'nowrap';
					span.style.overflow = 'hidden';
					span.style.textOverflow = 'ellipsis';
					if (col.width) { span.style.width = col.width; }
				}
				row.appendChild(span);
			}

			// Click handler
			if (this._config.onClickCommand) {
				const id = String(item[this._config.onClickIdField || 'id'] || '');
				const label = String(item[this._config.onClickLabelField || 'name'] || '');
				row.addEventListener('click', () => {
					this.commandService.executeCommand(this._config.onClickCommand!, id, label);
				});
			}

			this._listEl.appendChild(row);
		}
	}

	private _resolveValue(item: Record<string, unknown>, key: string): string {
		const val = item[key];
		if (val === null || val === undefined) {
			return '';
		}
		return String(val);
	}

	private _showMsg(msg: string): void {
		if (!this._listEl) {
			return;
		}
		this._listEl.innerHTML = '';
		const el = document.createElement('div');
		el.style.padding = '12px 16px';
		el.style.color = 'var(--vscode-descriptionForeground)';
		el.style.fontSize = '12px';
		el.textContent = msg;
		this._listEl.appendChild(el);
	}
}
