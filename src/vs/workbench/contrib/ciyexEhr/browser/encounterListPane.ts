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
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { showVisitSummaryPanel } from './editors/visitSummaryPanel.js';
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
	// Date range filters start empty so the list is not pre-filtered to a fixed
	// default window — the user opts in by picking a From/To date.
	private dateFrom = '';
	private dateTo = '';
	private visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
	// patient id → display name, used to backfill encounter rows whose backend
	// display fields are empty (common right after creating an encounter).
	private patientNameById = new Map<string, string>();

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
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
		@INotificationService private readonly notificationService: INotificationService,
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
		for (const opt of ['All', 'SIGNED', 'UNSIGNED']) {
			const o = DOM.append(filter, DOM.$('option')) as HTMLOptionElement;
			o.value = opt === 'All' ? '' : opt;
			o.textContent = opt;
		}
		filter.addEventListener('change', () => { this.filterValue = filter.value; this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._renderList(search.value); });

		// No "+" create-encounter button here (QA request): encounters are created
		// from their own workflow (appointment → encounter / patient chart), not
		// from a context-less sidebar button.

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

		// Allow other components (e.g. the encounter form editor) to force a
		// re-fetch after creating/saving an encounter so the new row appears
		// without a manual reload (issue 6).
		this._register(CommandsRegistry.registerCommand('ciyex.refreshEncounters', () => {
			this.loaded = false;
			return this._loadData();
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private async _loadData(): Promise<void> {
		try {
			// Use the /api/encounters facade endpoint (not the generic
			// /api/fhir-resource/encounters): it runs enrichEncounterFields server
			// side so each row carries a resolved `patientName`. The generic
			// endpoint left the subject display empty, so the rail showed
			// "Unknown" for every encounter (new and existing practices alike).
			const res = await this.apiService.fetch('/api/encounters?status=ALL&page=0&size=200');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.allItems = data?.data?.content || data?.content || [];
			// Map type codes + FHIR status → EHR status
			const statusMap: Record<string, string> = {
				'finished': 'SIGNED', 'completed': 'SIGNED',
				'in-progress': 'UNSIGNED', 'arrived': 'UNSIGNED', 'planned': 'UNSIGNED',
				'cancelled': 'UNSIGNED', 'entered-in-error': 'UNSIGNED', 'onleave': 'UNSIGNED',
				'INCOMPLETE': 'UNSIGNED',
			};
			for (const item of this.allItems) {
				const t = String(item.type || '');
				if (Object.prototype.hasOwnProperty.call(EncounterListPane.TYPE_MAP, t)) { item.type = EncounterListPane.TYPE_MAP[t]; }
				const s = String(item.status || '');
				if (Object.prototype.hasOwnProperty.call(statusMap, s)) { item.status = statusMap[s]; }
				else if (!['SIGNED', 'UNSIGNED'].includes(s)) { item.status = 'UNSIGNED'; }
			}
			// Sort by latest date first
			this.allItems.sort((a, b) => {
				const da = new Date(String(a.encounterDate || a.startDate || a.start || '0')).getTime();
				const db = new Date(String(b.encounterDate || b.startDate || b.start || '0')).getTime();
				return db - da;
			});
			// Backfill patient names for encounters whose backend display fields are
			// empty (common right after creating one, before the FHIR subject
			// reference is denormalized) so the rail doesn't show "Unknown".
			const needsNames = this.allItems.some(it => !this._patientDisplayOf(it) && this._patientIdOf(it));
			if (needsNames) { await this._ensurePatientNameMap(); }
			this.loaded = true;
			this._renderList('');
		} catch {
			this.listEl.textContent = 'Waiting for login...';
		}
	}

	/** Patient display name from the encounter's backend fields (may be empty). */
	private _patientDisplayOf(item: Record<string, unknown>): string {
		return String(item.patientRefDisplay || item.patientDisplay || item.patientName || item.subjectDisplay || '');
	}

	/** Patient id for an encounter row, normalized (no `Patient/` prefix). */
	private _patientIdOf(item: Record<string, unknown>): string {
		return String(item.patientId || item.patientRef || item.subjectRef || item.subject || '').replace('Patient/', '');
	}

	/** Patient name for a row: prefer backend display, else the id→name fallback. */
	private _patientNameOf(item: Record<string, unknown>): string {
		const display = this._patientDisplayOf(item);
		if (display) { return display; }
		const id = this._patientIdOf(item);
		return (id && this.patientNameById.get(id)) || '';
	}

	/** Populate {@link patientNameById} from the patients API (best-effort). */
	private async _ensurePatientNameMap(): Promise<void> {
		// 1) Bulk load — covers the common case (small/medium practices) in one request.
		try {
			const res = await this.apiService.fetch('/api/patients?page=0&size=500');
			if (res.ok) {
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
				for (const p of list) {
					const id = String(p.id ?? p.patientId ?? '').replace('Patient/', '');
					const name = `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || String(p.name || '');
					if (id && name) { this.patientNameById.set(id, name); }
				}
			}
		} catch { /* fall through to the per-id fallback below */ }
		// 2) Per-id fallback for encounters whose patient the bulk page missed — e.g.
		//    practices with >500 patients, where an existing patient's encounter would
		//    otherwise still render "Unknown". Fetch those patients individually
		//    (batched) so a real patient is never shown as Unknown. Mirrors the
		//    appointments rail's enrichment.
		const missingIds = [...new Set(this.allItems
			.filter(it => !this._patientDisplayOf(it))
			.map(it => this._patientIdOf(it))
			.filter(id => id && !this.patientNameById.has(id)))];
		const batchSize = 10;
		for (let i = 0; i < missingIds.length; i += batchSize) {
			const batch = missingIds.slice(i, i + batchSize);
			await Promise.all(batch.map(async (id) => {
				try {
					const r = await this.apiService.fetch(`/api/patients/${id}`);
					if (!r.ok) { return; }
					const d = await r.json();
					const p = (d?.data || d || {}) as Record<string, unknown>;
					const name = `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || String(p.name || '');
					if (name) { this.patientNameById.set(id, name); }
				} catch { /* leave as "Unknown" if even the direct fetch fails */ }
			}));
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
			const patName = this._patientNameOf(item);
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

			// A signed encounter is permanently locked: omit the edit action so its
			// fields (and status) can no longer be changed from the list either.
			const isSigned = status === 'SIGNED';
			createOverflowMenuButton(actions, (): IOverflowMenuItem[] => [
				{ symbol: '\u{1F4DD}', label: 'Open Encounter', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', patientId, encId, patName, `${provName}`) },
				...(isSigned ? [] : [{ symbol: '\u{270F}', label: 'Edit Encounter', onClick: () => this._openEditDialog(item, encId, patName) }]),
				{ symbol: '\u{1FA7A}', label: 'Record Vitals', onClick: () => this.commandService.executeCommand('ciyex.openEncounter', patientId, encId, patName, `Vitals — ${patName}`, 'vitals') },
				{ symbol: '\u{1F5C2}', label: 'Visit Summary', onClick: () => showVisitSummaryPanel({ apiService: this.apiService, themeService: this.themeService, notificationService: this.notificationService }, patientId, encId, patName) },
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

	private _openEditDialog(item: Record<string, unknown>, encId: string, patName: string): void {
		const dateRaw = String(item.encounterDate || item.startDate || item.start || '');
		const initialDate = dateRaw ? dateRaw.slice(0, 10) : '';
		const patientId = String(item.patientId || item.patientRef || '').replace('Patient/', '');
		// Live provider typeahead — encounterProvider is stored as a display name
		// (matches ciyex-ehr-ui's encounter model), so the picker stores the name.
		const fetchProviders = async (q: string) => {
			try {
				for (const url of [`/api/providers?search=${encodeURIComponent(q)}&page=0&size=10`, `/api/fhir-resource/providers?search=${encodeURIComponent(q)}&page=0&size=10`]) {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { continue; }
					const data = await res.json();
					const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
					if (list.length === 0) { continue; }
					return list.map(p => {
						const name = (p.name || p.fullName || `${String(p.firstName || '')} ${String(p.lastName || '')}`.trim() || '') as string;
						return { value: name, label: name };
					});
				}
				return [];
			} catch { return []; }
		};
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
				{ key: 'encounterProvider', label: 'Provider', kind: 'search', placeholder: 'Search provider...', widthPct: 50, onSearch: fetchProviders },
				{
					key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
						{ value: 'SIGNED', label: 'Signed' },
						{ value: 'UNSIGNED', label: 'Unsigned' },
					]
				},
				{ key: 'reason', label: 'Reason / Chief Complaint', kind: 'textarea', widthPct: 100 },
			],
			values: {
				encounterDate: initialDate,
				type: String(item.type || item.visitCategory || 'Ambulatory'),
				encounterProvider: String(item.encounterProvider || item.providerDisplay || item.providerName || item.provider || ''),
				status: String(item.status || 'UNSIGNED'),
				reason: String(item.reason || item.reasonForVisit || item.reasonCode || ''),
			},
			onSave: async (nextRaw) => {
				// This form has only plain string fields (no composite formExtras),
				// so the values are all strings.
				const next = nextRaw as Record<string, string>;
				// Prefer the patient-scoped endpoint (matches ciyex-ehr-ui) — it
				// accepts a flat encounter with a display-name provider and the
				// UNSIGNED/SIGNED status values directly, so we avoid the FHIR
				// participant-reference mapping that rejects bare ids/names.
				if (patientId) {
					const body: Record<string, unknown> = {
						encounterDate: next.encounterDate ? new Date(next.encounterDate).toISOString() : undefined,
						visitCategory: next.type,
						encounterProvider: next.encounterProvider,
						status: next.status,
						reasonForVisit: next.reason,
					};
					const res = await this.apiService.fetch(`/api/${patientId}/encounters/${encId}`, { method: 'PUT', body: JSON.stringify(body) });
					if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
					await this._loadData();
					return;
				}
				// Fallback: no patient context — write through the generic FHIR
				// resource endpoint with FHIR-coded type/status.
				const TYPE_CODE: Record<string, string> = {
					'Ambulatory': 'AMB', 'Home Health': 'HH', 'Emergency': 'EMER',
					'Short Stay': 'SS', 'Virtual': 'VR', 'Observation': 'OBSENC',
				};
				const STATUS_CODE: Record<string, string> = {
					'SIGNED': 'finished', 'UNSIGNED': 'in-progress', 'INCOMPLETE': 'cancelled',
				};
				const payload: Record<string, unknown> = {
					id: encId,
					encounterDate: next.encounterDate,
					type: TYPE_CODE[next.type] || next.type,
					status: STATUS_CODE[next.status] || next.status,
					reason: next.reason,
					reasonCode: next.reason,
				};
				const res = await this.apiService.fetch(`/api/fhir-resource/encounters/${encId}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				await this._loadData();
			},
		});
	}
}
