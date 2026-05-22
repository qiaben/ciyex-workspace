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
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import * as DOM from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { createOverflowMenuButton, createRowActionsContainer, openRecordEditDialog, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE, IOverflowMenuItem } from './sidebarActions.js';

export class EncounterListPane extends ViewPane {
	static readonly ID = 'ciyex.encounters.view';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private allItems: Record<string, unknown>[] = [];
	private loaded = false;
	private filterValue = '';
	private dateFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
	private dateTo = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
	private visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;

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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Wipe encounters on logout and refetch on next sign-in so user-2
		// never sees user-1's encounter list.
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.NotAuthenticated) {
				this.allItems = [];
				this.loaded = false;
				this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
			} else if (state === CiyexAuthState.Authenticated) {
				this.allItems = [];
				this.loaded = false;
				this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
				if (this.listEl) {
					void this._loadData();
				}
			}
		}));
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.encounter-list-pane.ciyex-editor-root'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		// Toolbar row 1: search + add
		const toolbar = DOM.append(this.container, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;flex-wrap:wrap;';

		const search = DOM.append(toolbar, DOM.$('input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Search...';
		search.style.cssText = 'flex:1;min-width:60px;padding:3px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;box-sizing:border-box;';
		search.addEventListener('input', () => { this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._renderList(search.value); });

		const selectStyle = 'padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;cursor:pointer;';

		// Status filter
		const filter = DOM.append(toolbar, DOM.$('select')) as HTMLSelectElement;
		filter.style.cssText = selectStyle;
		for (const opt of ['All', 'SIGNED', 'UNSIGNED', 'INCOMPLETE']) {
			const o = DOM.append(filter, DOM.$('option')) as HTMLOptionElement;
			o.value = opt === 'All' ? '' : opt;
			o.textContent = opt;
		}
		filter.addEventListener('change', () => { this.filterValue = filter.value; this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._renderList(search.value); });

		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+';
		addBtn.title = 'New Encounter';
		addBtn.style.cssText = 'padding:2px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:12px;height:24px;width:24px;';
		// Without a patient context, calling `ciyex.openEncounter` would fall
		// back to "first non-errored encounter" and load some arbitrary
		// patient's chart (the test team saw "James Lee" appear no matter who
		// clicked +). Prompt for a patient first so the new-encounter flow
		// always lands on the right chart.
		addBtn.addEventListener('click', () => void this._pickPatientAndOpenEncounter());

		// Toolbar row 2: date range
		const dateRow = DOM.append(this.container, DOM.$('div'));
		dateRow.style.cssText = 'display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;align-items:center;';
		const dateInputStyle = 'padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;box-sizing:border-box;flex:1;min-width:0;';

		const buildIconDateInput = (parent: HTMLElement, isoValue: string, onChange: (iso: string) => void): void => {
			const wrap = DOM.append(parent, DOM.$('div'));
			wrap.style.cssText = 'position:relative;display:inline-flex;flex:1;min-width:0;';
			const isoToUs = (iso: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };
			const usToIso = (us: string): string => { const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us); if (!m) { return ''; } return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
			const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			visible.type = 'text';
			visible.placeholder = 'MM/DD/YYYY';
			visible.maxLength = 10;
			visible.value = isoToUs(isoValue);
			visible.style.cssText = dateInputStyle + 'padding-right:24px;';
			visible.addEventListener('input', () => {
				const iso = usToIso(visible.value);
				visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
				onChange(iso);
			});
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.value = isoValue || '';
			picker.style.cssText = 'position:absolute;top:0;right:0;width:24px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			picker.addEventListener('change', () => { visible.value = isoToUs(picker.value); onChange(picker.value); });
			const icon = DOM.append(wrap, DOM.$('span'));
			icon.textContent = '\u{1F4C5}';
			icon.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--vscode-descriptionForeground);pointer-events:none;line-height:1;';
		};

		const fromLabel = DOM.append(dateRow, DOM.$('span'));
		fromLabel.textContent = 'From';
		fromLabel.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);flex-shrink:0;';
		buildIconDateInput(dateRow, this.dateFrom, (iso) => { this.dateFrom = iso; this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._renderList(search.value); });

		const toLabel = DOM.append(dateRow, DOM.$('span'));
		toLabel.textContent = 'To';
		toLabel.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);flex-shrink:0;';
		buildIconDateInput(dateRow, this.dateTo, (iso) => { this.dateTo = iso; this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._renderList(search.value); });

		// List
		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._loadData();
		const retry = mainWindow.setInterval(() => {
			if (this.loaded) { mainWindow.clearInterval(retry); return; }
			this._loadData();
		}, 2000);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
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
				if (Object.prototype.hasOwnProperty.call(EncounterListPane.TYPE_MAP, t)) { item.type = EncounterListPane.TYPE_MAP[t]; }
				const s = String(item.status || '');
				if (Object.prototype.hasOwnProperty.call(statusMap, s)) { item.status = statusMap[s]; }
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

		const visible = Math.min(this.visibleCount, filtered.length);
		const page = filtered.slice(0, visible);

		for (const item of page) {
			const row = DOM.append(this.listEl, DOM.$('div'));
			row.style.cssText = 'padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(128,128,128,0.06);position:relative;';

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

			// Status badge — solid colour background with white text
			const status = String(item.status || 'UNSIGNED');
			const color = status === 'SIGNED' ? '#22c55e' : status === 'UNSIGNED' ? '#ef4444' : status === 'INCOMPLETE' ? '#f59e0b' : '#6b7280';
			const badge = DOM.append(row, DOM.$('span'));
			badge.textContent = status;
			badge.style.cssText = `font-size:9px;padding:1px 5px;border-radius:3px;background:${color};color:#fff;white-space:nowrap;flex-shrink:0;`;

			// ⋯ actions — hidden until hover, Teams-style
			const encId = String(item.id || item.fhirId || '');
			const patientId = String(item.patientId || item.patientRef || '').replace('Patient/', '');
			const actions = createRowActionsContainer(row);
			actions.style.cssText = 'display:flex;gap:2px;align-items:center;flex-shrink:0;opacity:0;transition:opacity 0.1s;';

			createOverflowMenuButton(actions, (): IOverflowMenuItem[] => [
				{ symbol: '\u{1F4DD}', label: 'Open Encounter', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', patientId, encId, patName, `${provName}`) },
				{ symbol: '\u{270F}', label: 'Edit Encounter', onClick: () => this._openEditDialog(item, encId, patName) },
				{ symbol: '\u{1FA7A}', label: 'Record Vitals', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', patientId, encId, patName, `Vitals — ${patName}`, 'vitals') },
				{ symbol: '\u{1F5C2}', label: 'Visit Summary', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', patientId, encId, patName, `Summary — ${patName}`, 'plan') },
			]);

			row.addEventListener('mouseenter', () => {
				row.style.background = 'var(--vscode-list-hoverBackground)';
				actions.style.opacity = '1';
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = '';
				actions.style.opacity = '0';
			});
			row.addEventListener('click', (e) => {
				if (actions.contains(e.target as Node)) { return; }
				this.commandService.executeCommand('ciyex.openEncounter', patientId, encId, patName, `${provName}`);
			});
		}

		// Show More footer \u2014 replaces prev/next pagination so this rail
		// matches the unified sidebar convention.
		const footerWrap = DOM.append(this.listEl, DOM.$('div'));
		footerWrap.style.cssText = 'border-top:1px solid var(--vscode-editorWidget-border);';
		renderShowMoreFooter(
			footerWrap,
			{ visibleCount: visible, totalCount: filtered.length },
			(next) => { this.visibleCount = next; this._renderList(search); },
			() => { this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._renderList(search); },
		);
	}

	private async _pickPatientAndOpenEncounter(): Promise<void> {
		const pick = this.quickInputService.createQuickPick<IQuickPickItem & { patientId: string }>();
		pick.placeholder = 'Search patient to create an encounter for…';
		pick.matchOnDescription = true;
		pick.matchOnDetail = true;
		pick.busy = true;
		pick.show();
		try {
			const res = await this.apiService.fetch('/api/patients?page=0&size=50');
			if (res.ok) {
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
				pick.items = list.map(p => {
					const pid = String(p.id ?? p.patientId ?? '');
					const name = `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || String(p.name || pid);
					const dob = p.dateOfBirth ? ` · DOB ${p.dateOfBirth}` : '';
					return { label: name, description: pid ? `MRN ${pid}${dob}` : dob, patientId: pid };
				});
			}
		} catch { /* */ }
		pick.busy = false;
		pick.onDidAccept(() => {
			const sel = pick.selectedItems[0];
			pick.hide();
			if (!sel || !sel.patientId) { return; }
			this.commandService.executeCommand('ciyex.openPatientChart', sel.patientId, sel.label, 'encounters');
		});
	}

	private _openEditDialog(item: Record<string, unknown>, encId: string, patName: string): void {
		const dateRaw = String(item.encounterDate || item.startDate || item.start || '');
		const initialDate = dateRaw ? dateRaw.slice(0, 10) : '';
		openRecordEditDialog({
			title: `Edit Encounter — ${patName}`,
			themeAnchor: this.container,
			fields: [
				{ key: 'encounterDate', label: 'Encounter Date', kind: 'date', required: true, widthPct: 50 },
				{
					key: 'type', label: 'Visit Type', kind: 'select', widthPct: 50, options: [
						{ value: 'Ambulatory', label: 'Ambulatory' },
						{ value: 'Home Health', label: 'Home Health' },
						{ value: 'Emergency', label: 'Emergency' },
						{ value: 'Short Stay', label: 'Short Stay' },
						{ value: 'Virtual', label: 'Virtual' },
						{ value: 'Observation', label: 'Observation' },
					]
				},
				{
					key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
						{ value: 'SIGNED', label: 'Signed' },
						{ value: 'UNSIGNED', label: 'Unsigned' },
						{ value: 'INCOMPLETE', label: 'Incomplete' },
					]
				},
				{ key: 'reason', label: 'Reason / Chief Complaint', kind: 'textarea', widthPct: 100 },
			],
			values: {
				encounterDate: initialDate,
				type: String(item.type || 'Ambulatory'),
				status: String(item.status || 'UNSIGNED'),
				reason: String(item.reason || item.reasonCode || ''),
			},
			onSave: async (next) => {
				// Map workspace labels back to FHIR codes so the encounter PUT
				// doesn't reject the payload with a 500. Spreading the full
				// `item` here would re-send display-only fields (patientDisplay,
				// providerDisplay, etc.) that the backend rejects as unknown
				// — only ship the user-edited fields.
				const TYPE_CODE: Record<string, string> = {
					'Ambulatory': 'AMB', 'Home Health': 'HH', 'Emergency': 'EMER',
					'Short Stay': 'SS', 'Virtual': 'VR', 'Observation': 'OBSENC',
				};
				const STATUS_CODE: Record<string, string> = {
					'SIGNED': 'finished', 'UNSIGNED': 'in-progress', 'INCOMPLETE': 'cancelled',
				};
				const payload: Record<string, unknown> = {
					encounterDate: next.encounterDate,
					type: TYPE_CODE[next.type] || next.type,
					status: STATUS_CODE[next.status] || next.status,
					reason: next.reason,
					reasonCode: next.reason,
				};
				const res = await this.apiService.fetch(`/api/encounters/${encId}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				await this._loadData();
			},
		});
	}
}
