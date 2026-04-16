/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from './ciyexApiService.js';
import * as DOM from '../../../../base/browser/dom.js';

export class EncounterListPane extends ViewPane {
	static readonly ID = 'ciyex.encounters.view';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private allItems: Record<string, unknown>[] = [];
	private loaded = false;
	private filterValue = '';
	private dateFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
	private dateTo = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
	private currentPage = 0;
	private pageSize = 15;

	// FHIR type code → readable label
	private static TYPE_MAP: Record<string, string> = {
		'AMB': 'Ambulatory', 'HH': 'Home Health', 'EMER': 'Emergency',
		'SS': 'Short Stay', 'VR': 'Virtual', 'OBSENC': 'Observation',
	};

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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.encounter-list-pane'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		// Toolbar row 1: search + add
		const toolbar = DOM.append(this.container, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;flex-wrap:wrap;';

		const search = DOM.append(toolbar, DOM.$('input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Search...';
		search.style.cssText = 'flex:1;min-width:60px;padding:3px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;box-sizing:border-box;';
		search.addEventListener('input', () => { this.currentPage = 0; this._renderList(search.value); });

		const selectStyle = 'padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;cursor:pointer;';

		// Status filter
		const filter = DOM.append(toolbar, DOM.$('select')) as HTMLSelectElement;
		filter.style.cssText = selectStyle;
		for (const opt of ['All', 'SIGNED', 'UNSIGNED', 'INCOMPLETE']) {
			const o = DOM.append(filter, DOM.$('option')) as HTMLOptionElement;
			o.value = opt === 'All' ? '' : opt;
			o.textContent = opt;
		}
		filter.addEventListener('change', () => { this.filterValue = filter.value; this.currentPage = 0; this._renderList(search.value); });

		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+';
		addBtn.title = 'New Encounter';
		addBtn.style.cssText = 'padding:2px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:12px;height:24px;width:24px;';
		addBtn.addEventListener('click', () => this.commandService.executeCommand('ciyex.openEncounter'));

		// Toolbar row 2: date range
		const dateRow = DOM.append(this.container, DOM.$('div'));
		dateRow.style.cssText = 'display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;align-items:center;';
		const dateInputStyle = 'padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;box-sizing:border-box;flex:1;min-width:0;';

		const fromLabel = DOM.append(dateRow, DOM.$('span'));
		fromLabel.textContent = 'From';
		fromLabel.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);flex-shrink:0;';
		const fromInput = DOM.append(dateRow, DOM.$('input')) as HTMLInputElement;
		fromInput.type = 'date';
		fromInput.value = this.dateFrom;
		fromInput.style.cssText = dateInputStyle;
		fromInput.addEventListener('change', () => { this.dateFrom = fromInput.value; this.currentPage = 0; this._renderList(search.value); });

		const toLabel = DOM.append(dateRow, DOM.$('span'));
		toLabel.textContent = 'To';
		toLabel.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);flex-shrink:0;';
		const toInput = DOM.append(dateRow, DOM.$('input')) as HTMLInputElement;
		toInput.type = 'date';
		toInput.value = this.dateTo;
		toInput.style.cssText = dateInputStyle;
		toInput.addEventListener('change', () => { this.dateTo = toInput.value; this.currentPage = 0; this._renderList(search.value); });

		// List
		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._loadData();
		const retry = setInterval(() => {
			if (this.loaded) { clearInterval(retry); return; }
			this._loadData();
		}, 2000);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		const rowH = 34;
		const newSize = Math.max(5, Math.floor((height - 60) / rowH));
		if (newSize !== this.pageSize && this.loaded) {
			this.pageSize = newSize;
			this._renderList('');
		} else {
			this.pageSize = newSize;
		}
	}

	private async _loadData(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/fhir-resource/encounters?page=0&size=200');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.allItems = data?.data?.content || data?.content || [];
			// Map type codes + FHIR status → EHR status
			const statusMap: Record<string, string> = {
				'finished': 'SIGNED', 'completed': 'SIGNED',
				'in-progress': 'UNSIGNED', 'arrived': 'UNSIGNED', 'planned': 'UNSIGNED',
				'cancelled': 'INCOMPLETE', 'entered-in-error': 'INCOMPLETE', 'onleave': 'INCOMPLETE',
			};
			for (const item of this.allItems) {
				const t = String(item.type || '');
				if (t in EncounterListPane.TYPE_MAP) { item.type = EncounterListPane.TYPE_MAP[t]; }
				const s = String(item.status || '');
				if (s in statusMap) { item.status = statusMap[s]; }
				else if (!['SIGNED', 'UNSIGNED', 'INCOMPLETE'].includes(s)) { item.status = 'UNSIGNED'; }
			}
			// Sort by latest date first
			this.allItems.sort((a, b) => {
				const da = new Date(String(a.encounterDate || a.startDate || a.start || '0')).getTime();
				const db = new Date(String(b.encounterDate || b.startDate || b.start || '0')).getTime();
				return db - da;
			});
			this.loaded = true;
			this._renderList('');
		} catch {
			this.listEl.textContent = 'Waiting for login...';
		}
	}

	private _renderList(search: string): void {
		DOM.clearNode(this.listEl);
		const q = search.toLowerCase();
		const fromTs = this.dateFrom ? new Date(this.dateFrom).getTime() : 0;
		const toTs = this.dateTo ? new Date(this.dateTo + 'T23:59:59').getTime() : 0;
		const filtered = this.allItems.filter(item => {
			if (this.filterValue && String(item.status || '').toUpperCase() !== this.filterValue.toUpperCase()) { return false; }
			// Date range filter
			if (fromTs || toTs) {
				const ds = String(item.encounterDate || item.startDate || item.start || '');
				if (ds) {
					try {
						const ts = new Date(ds).getTime();
						if (fromTs && ts < fromTs) { return false; }
						if (toTs && ts > toTs) { return false; }
					} catch { /* keep */ }
				}
			}
			if (!q) { return true; }
			return Object.values(item).some(v => v && String(v).toLowerCase().includes(q));
		});

		if (filtered.length === 0) {
			this.listEl.textContent = this.allItems.length === 0 ? 'No encounters' : 'No matches';
			return;
		}

		const start = this.currentPage * this.pageSize;
		const page = filtered.slice(start, start + this.pageSize);

		for (const item of page) {
			const row = DOM.append(this.listEl, DOM.$('div'));
			row.style.cssText = 'padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(128,128,128,0.06);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			// Avatar (patient initials)
			const patName = String(item.patientRefDisplay || item.patientDisplay || item.patientName || item.subjectDisplay || '');
			const provName = String(item.providerDisplay || item.encounterProvider || item.provider || '').replace('Practitioner/', '');
			const initials = patName.split(' ').map(w => (w[0] || '')).join('').substring(0, 2).toUpperCase() || '?';
			const hue = Math.abs(patName.split('').reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0)) % 360;
			const av = DOM.append(row, DOM.$('span'));
			av.textContent = initials;
			av.style.cssText = `width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;color:#fff;flex-shrink:0;background:hsl(${hue},50%,40%);`;

			// Info block: patient name on top, date + reason below
			const infoCol = DOM.append(row, DOM.$('div'));
			infoCol.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

			// Primary: Patient name
			const nameEl = DOM.append(infoCol, DOM.$('div'));
			nameEl.textContent = patName || 'Unknown';
			nameEl.style.cssText = 'font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			// Secondary: date · reason · provider
			const secondaryParts: string[] = [];
			const dateStr = item.encounterDate || item.startDate || item.start || '';
			if (dateStr) {
				try { secondaryParts.push(new Date(String(dateStr)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })); } catch { secondaryParts.push(String(dateStr).substring(0, 10)); }
			}
			const reason = String(item.reason || item.reasonCode || '');
			if (reason) { secondaryParts.push(reason); }
			if (provName) { secondaryParts.push(provName); }
			if (secondaryParts.length > 0) {
				const secEl = DOM.append(infoCol, DOM.$('div'));
				secEl.textContent = secondaryParts.join(' · ');
				secEl.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			}

			// Status badge (SIGNED=green, UNSIGNED=red, INCOMPLETE=amber — matching EHR UI)
			const status = String(item.status || 'UNSIGNED');
			const color = status === 'SIGNED' ? '#22c55e' : status === 'UNSIGNED' ? '#ef4444' : status === 'INCOMPLETE' ? '#f59e0b' : '#6b7280';
			const badge = DOM.append(row, DOM.$('span'));
			badge.textContent = status;
			badge.style.cssText = `font-size:9px;padding:1px 5px;border-radius:3px;background:${color}18;color:${color};white-space:nowrap;flex-shrink:0;`;

			// Click → open encounter
			row.addEventListener('click', () => {
				const id = String(item.id || item.fhirId || '');
				const patientId = String(item.patientId || item.patientRef || '').replace('Patient/', '');
				this.commandService.executeCommand('ciyex.openEncounter', patientId, id, patName, `${provName}`);
			});
		}

		// Pagination
		const totalPages = Math.ceil(filtered.length / this.pageSize);
		if (totalPages > 1) {
			const pag = DOM.append(this.listEl, DOM.$('div'));
			pag.style.cssText = 'display:flex;align-items:center;gap:4px;padding:6px 10px;font-size:11px;color:var(--vscode-descriptionForeground);border-top:1px solid var(--vscode-editorWidget-border);';
			const info = DOM.append(pag, DOM.$('span'));
			info.textContent = `${start + 1}-${Math.min(start + this.pageSize, filtered.length)} of ${filtered.length}`;
			info.style.flex = '1';
			const prev = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
			prev.textContent = '\u25C0';
			prev.disabled = this.currentPage === 0;
			prev.style.cssText = `background:none;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:11px;opacity:${this.currentPage === 0 ? '0.3' : '1'};`;
			prev.addEventListener('click', () => { this.currentPage--; this._renderList(search); });
			const pg = DOM.append(pag, DOM.$('span'));
			pg.textContent = `${this.currentPage + 1}/${totalPages}`;
			const next = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
			next.textContent = '\u25B6';
			next.disabled = this.currentPage >= totalPages - 1;
			next.style.cssText = `background:none;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:11px;opacity:${this.currentPage >= totalPages - 1 ? '0.3' : '1'};`;
			next.addEventListener('click', () => { this.currentPage++; this._renderList(search); });
		}
	}
}
