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
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { createOverflowMenuButton, createRowActionsContainer, openRecordEditDialog, renderShowMoreFooter, IOverflowMenuItem } from './sidebarActions.js';

interface IPatientRow {
	id: string;
	firstName: string;
	lastName: string;
	dateOfBirth: string;
	gender: string;
	status: string;
}

export class PatientListPane extends ViewPane {

	static readonly ID = 'ciyex.patients.list';

	private _listEl: HTMLElement | undefined;
	private _footerEl: HTMLElement | undefined;
	private _patients: IPatientRow[] = [];
	private _loaded = false;
	private _searchQuery = '';
	private _statusFilter: 'all' | 'active' | 'inactive' = 'all';
	private _genderFilter: 'all' | 'male' | 'female' | 'unknown' = 'all';
	// Patient list shows more rows by default than other sidebars since users
	// need to scroll a roster, not just a day's schedule.
	private _visibleCount = 25;
	private _searchTimer: ReturnType<typeof setTimeout> | undefined;

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
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Drop cached patients when the user signs out, and refetch on the
		// next sign-in so the second user never sees the first user's roster.
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.NotAuthenticated) {
				this._patients = [];
				this._loaded = false;
				this._visibleCount = 25;
			} else if (state === CiyexAuthState.Authenticated) {
				this._loaded = false;
				this._patients = [];
				this._visibleCount = 25;
				if (this._listEl) {
					this._renderList(); // immediately wipe stale rows before async fetch
					void this._loadPatients();
				}
			}
		}));

		// Allow other components (e.g. the titlebar "Add Patient" overlay) to
		// force a re-fetch after creating a patient so the new row appears
		// without a manual reload. Without this the roster stayed on its cached
		// (often empty, for a brand-new practice) result until sign-out.
		this._register(CommandsRegistry.registerCommand('ciyex.refreshPatients', () => {
			this._loaded = false;
			if (this._listEl) {
				return this._loadPatients();
			}
			return undefined;
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('ciyex-editor-root');
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		container.style.overflow = 'hidden';

		// Filter bar — search + status + gender. Match the EHR-UI patient page so
		// the desktop workspace exposes the same filters per the test report.
		const filterBar = document.createElement('div');
		filterBar.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		const searchInput = document.createElement('input');
		searchInput.type = 'text';
		searchInput.placeholder = 'Search by name or DOB (MM/DD/YYYY)...';
		searchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;outline:none;';
		searchInput.addEventListener('input', () => {
			this._searchQuery = searchInput.value.trim();
			this._visibleCount = 25;
			this._renderList();
			// Debounce server-side search for queries that might not be in the
			// already-loaded batch (e.g. large patient rosters > 500).
			if (this._searchTimer !== undefined) { clearTimeout(this._searchTimer); }
			if (this._searchQuery.length >= 2) {
				this._searchTimer = setTimeout(() => this._searchPatients(this._searchQuery), 300);
			}
		});
		filterBar.appendChild(searchInput);

		const filterRow = document.createElement('div');
		filterRow.style.cssText = 'display:flex;gap:4px;';

		const selStyle = 'flex:1;padding:3px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;cursor:pointer;outline:none;';

		const statusSel = document.createElement('select');
		statusSel.style.cssText = selStyle;
		statusSel.title = 'Status filter';
		for (const [val, label] of [['all', 'All Status'], ['active', 'Active'], ['inactive', 'Inactive']] as const) {
			const o = document.createElement('option');
			o.value = val; o.textContent = label;
			if (val === this._statusFilter) { o.selected = true; }
			statusSel.appendChild(o);
		}
		statusSel.addEventListener('change', () => {
			this._statusFilter = statusSel.value as 'all' | 'active' | 'inactive';
			this._visibleCount = 25;
			this._renderList();
		});
		filterRow.appendChild(statusSel);

		const genderSel = document.createElement('select');
		genderSel.style.cssText = selStyle;
		genderSel.title = 'Gender filter';
		for (const [val, label] of [['all', 'All Gender'], ['male', 'Male'], ['female', 'Female'], ['unknown', 'Unknown']] as const) {
			const o = document.createElement('option');
			o.value = val; o.textContent = label;
			if (val === this._genderFilter) { o.selected = true; }
			genderSel.appendChild(o);
		}
		genderSel.addEventListener('change', () => {
			this._genderFilter = genderSel.value as 'all' | 'male' | 'female' | 'unknown';
			this._visibleCount = 25;
			this._renderList();
		});
		filterRow.appendChild(genderSel);

		filterBar.appendChild(filterRow);
		container.appendChild(filterBar);

		// Loading message
		const loadingEl = document.createElement('div');
		loadingEl.style.padding = '12px 16px';
		loadingEl.style.color = 'var(--vscode-descriptionForeground)';
		loadingEl.style.fontSize = '12px';
		loadingEl.textContent = 'Loading patients...';

		// Wrapper scrolls vertically when the rendered rows exceed the pane,
		// but hides the OS scrollbar so the patient list stays clean (matches
		// the web ehr-ui where the list scrolls without a visible track).
		const listWrap = document.createElement('div');
		listWrap.classList.add('ciyex-patient-list-scroll');
		listWrap.style.cssText = 'flex:1;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;';
		const hideScrollbarStyle = document.createElement('style');
		hideScrollbarStyle.textContent = '.ciyex-patient-list-scroll::-webkit-scrollbar{display:none;width:0;height:0;}';
		listWrap.appendChild(hideScrollbarStyle);
		listWrap.appendChild(loadingEl);

		this._listEl = document.createElement('div');
		listWrap.appendChild(this._listEl);
		container.appendChild(listWrap);

		// Pagination footer — fixed at the bottom of the pane, mirrors the
		// EHR-UI patient table pagination (Page X of Y, prev/next, total count).
		this._footerEl = document.createElement('div');
		this._footerEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-top:1px solid var(--vscode-editorWidget-border);background:var(--vscode-editorWidget-background,var(--vscode-editor-background));font-size:11px;flex-shrink:0;';
		container.appendChild(this._footerEl);

		// Load data
		this._loadPatients().then(() => {
			loadingEl.remove();
		});
	}

	private _renderFooter(filteredTotal: number): void {
		if (!this._footerEl) { return; }
		while (this._footerEl.firstChild) {
			this._footerEl.removeChild(this._footerEl.firstChild);
		}
		renderShowMoreFooter(
			this._footerEl,
			{ visibleCount: Math.min(this._visibleCount, filteredTotal), totalCount: filteredTotal },
			(next) => { this._visibleCount = next; this._renderList(); },
			() => { this._visibleCount = 25; this._renderList(); },
		);
	}

	private _filteredPatients(): IPatientRow[] {
		const q = this._searchQuery.toLowerCase();
		// Convert "12/31/1990" → "1990-12-31" so MM/DD/YYYY queries match the ISO DOB
		const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(this._searchQuery);
		const isoFromUs = usDate ? `${usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}` : '';
		return this._patients.filter(p => {
			if (this._statusFilter !== 'all') {
				const s = (p.status || 'active').toLowerCase();
				const isActive = s === 'active' || s === '' || s === 'true';
				if (this._statusFilter === 'active' && !isActive) { return false; }
				if (this._statusFilter === 'inactive' && isActive) { return false; }
			}
			if (this._genderFilter !== 'all') {
				const g = (p.gender || '').toLowerCase();
				if (this._genderFilter === 'unknown') {
					// Match anything that isn't explicitly male/female — covers
					// nulls, "unknown", legacy "other" values, and unset records.
					if (g === 'male' || g === 'female') { return false; }
				} else if (g !== this._genderFilter) {
					return false;
				}
			}
			if (q) {
				const fullName = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
				const dobMatch = isoFromUs && p.dateOfBirth && p.dateOfBirth.startsWith(isoFromUs);
				if (!fullName.includes(q) && !(p.dateOfBirth || '').includes(q) && !dobMatch) {
					return false;
				}
			}
			return true;
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private async _loadPatients(): Promise<void> {
		if (this._loaded) {
			return;
		}
		try {
			const response = await this.apiService.fetch('/api/patients?page=0&size=500&sort=lastName,asc');
			if (!response.ok) {
				this._showMessage('Failed to load patients');
				return;
			}
			const data = await response.json();
			const content = data?.data?.content || data?.content || [];
			this._patients = content;
			this._loaded = true;
			this._renderList();
		} catch {
			this._showMessage('Unable to connect to server');
		}
	}

	private async _searchPatients(query: string): Promise<void> {
		if (!query || query.length < 2) { return; }
		try {
			const encoded = encodeURIComponent(query);
			const res = await this.apiService.fetch(`/api/patients?page=0&size=500&search=${encoded}&sort=lastName,asc`);
			if (!res.ok) { return; }
			const data = await res.json();
			const content = data?.data?.content || data?.content || [];
			if (content.length > 0 && this._searchQuery === query) {
				// Merge server results with local list (de-duplicate by id)
				const existing = new Set(this._patients.map((p: IPatientRow) => p.id));
				const merged = [...this._patients];
				for (const p of content) {
					if (!existing.has(p.id)) { merged.push(p); }
				}
				this._patients = merged;
				this._renderList();
			}
		} catch { /* silent — local filter still works */ }
	}

	private _renderList(): void {
		if (!this._listEl) {
			return;
		}
		while (this._listEl.firstChild) {
			this._listEl.removeChild(this._listEl.firstChild);
		}

		if (this._patients.length === 0) {
			this._showMessage('No patients found');
			this._renderFooter(0);
			return;
		}

		const rows = this._filteredPatients();
		if (rows.length === 0) {
			this._showMessage('No matches');
			this._renderFooter(0);
			return;
		}

		// Render only the first `_visibleCount` rows; the footer (Show More)
		// reveals the rest.
		const pageRows = rows.slice(0, Math.min(this._visibleCount, rows.length));
		this._renderFooter(rows.length);
		for (const patient of pageRows) {
			const row = document.createElement('div');
			row.style.cssText = 'padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;border-bottom:1px solid var(--vscode-list-hoverBackground,rgba(255,255,255,0.04));position:relative;';

			// Avatar circle with initials. Guard against missing first/last name —
			// `charCodeAt` returns NaN on an empty string and breaks the hue calc.
			const avatar = document.createElement('span');
			const initials = `${(patient.firstName || '')[0] || ''}${(patient.lastName || '')[0] || ''}`.toUpperCase() || '?';
			const fnCode = (patient.firstName || '?').charCodeAt(0) || 65;
			const lnCode = (patient.lastName || '?').charCodeAt(0) || 65;
			const hue = (fnCode * 7 + lnCode * 13) % 360;
			Object.assign(avatar.style, {
				width: '24px', height: '24px', borderRadius: '50%',
				display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
				fontSize: '10px', fontWeight: '600', color: '#fff', flexShrink: '0',
				background: `hsl(${hue}, 50%, 40%)`,
			});
			avatar.textContent = initials;
			row.appendChild(avatar);

			// Name
			const nameEl = document.createElement('span');
			nameEl.style.flex = '1';
			nameEl.style.color = 'var(--vscode-foreground)';
			nameEl.textContent = `${patient.lastName}, ${patient.firstName}`;
			row.appendChild(nameEl);

			// DOB + Age + Gender
			const detailEl = document.createElement('span');
			detailEl.style.color = 'var(--vscode-descriptionForeground)';
			detailEl.style.fontSize = '11px';
			detailEl.style.whiteSpace = 'nowrap';
			const age = this._calcAge(patient.dateOfBirth);
			const g = patient.gender === 'male' ? 'M' : patient.gender === 'female' ? 'F' : '';
			const dob = this._formatDob(patient.dateOfBirth || '');
			detailEl.textContent = `${dob} ${g} ${age}y`;
			row.appendChild(detailEl);

			const fullName = `${patient.firstName} ${patient.lastName}`.trim();
			const isActive = (patient.status || 'active').toLowerCase() !== 'inactive';

			// ⋯ actions — hidden until hover, placed in the name row at the far right
			const actions = createRowActionsContainer(row);
			actions.style.cssText = 'display:flex;gap:2px;align-items:center;flex-shrink:0;opacity:0;transition:opacity 0.1s;';

			createOverflowMenuButton(actions, (): IOverflowMenuItem[] => [
				{ symbol: '\u{1F5C2}', label: 'View Chart', onClick: () => this.commandService.executeCommand('ciyex.openPatientChart', patient.id, fullName) },
				{ symbol: '\u{1F4DD}', label: 'Edit Patient', onClick: () => this._openEditDialog(patient) },
				{ separator: true },
				{
					symbol: isActive ? '\u{1F6AB}' : '\u{2713}',
					label: isActive ? 'Deactivate Patient' : 'Activate Patient',
					onClick: () => this._togglePatientStatus(patient, isActive),
				},
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
				this.commandService.executeCommand('ciyex.openPatientChart', patient.id, fullName);
			});

			this._listEl.appendChild(row);
		}
	}

	private _openEditDialog(patient: IPatientRow): void {
		openRecordEditDialog({
			title: `Edit Patient — ${patient.firstName} ${patient.lastName}`.trim(),
			themeAnchor: this._listEl,
			fields: [
				{ key: 'firstName', label: 'First Name', required: true, widthPct: 50 },
				{ key: 'lastName', label: 'Last Name', required: true, widthPct: 50 },
				{ key: 'dateOfBirth', label: 'Date of Birth', kind: 'date', widthPct: 50 },
				{
					key: 'gender', label: 'Gender', kind: 'select', widthPct: 50, options: [
						{ value: '', label: 'Unknown' },
						{ value: 'male', label: 'Male' },
						{ value: 'female', label: 'Female' },
						{ value: 'other', label: 'Other' },
					]
				},
				// Phone + email were missing from the drawer (QA report issue 30).
				// Field keys match ciyex-ehr-ui's patient edit page (email / phoneNumber)
				// so the backend PUT /api/patients/{id} accepts them unchanged.
				{ key: 'email', label: 'Email', kind: 'email', widthPct: 50, placeholder: 'name@example.com' },
				{ key: 'phoneNumber', label: 'Phone', kind: 'tel', widthPct: 50, placeholder: '(555) 123-4567' },
				{
					key: 'status', label: 'Status', kind: 'select', widthPct: 100, options: [
						{ value: 'active', label: 'Active' },
						{ value: 'inactive', label: 'Inactive' },
					]
				},
			],
			values: patient as unknown as Record<string, unknown>,
			onSave: async (next) => {
				const payload = { ...patient, ...next };
				const res = await this.apiService.fetch(`/api/patients/${patient.id}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				Object.assign(patient, next);
				this._renderList();
			},
		});
	}

	private async _togglePatientStatus(patient: IPatientRow, isActive: boolean): Promise<void> {
		const next = isActive ? 'inactive' : 'active';
		try {
			await this.apiService.fetch(`/api/patients/${patient.id}/status`, {
				method: 'PUT',
				body: JSON.stringify({ status: next }),
			});
			patient.status = next;
			this._renderList();
		} catch {
			// Swallow errors here — toggle is a soft action and the next list
			// reload will pick up the canonical status from the backend anyway.
		}
	}

	private _showMessage(msg: string): void {
		if (!this._listEl) {
			return;
		}
		const el = document.createElement('div');
		el.style.padding = '12px 16px';
		el.style.color = 'var(--vscode-descriptionForeground)';
		el.style.fontSize = '12px';
		el.textContent = msg;
		this._listEl.appendChild(el);
	}

	/** Display an ISO date-only DOB (YYYY-MM-DD) as MM/DD/YYYY to match the rest of the EHR. */
	private _formatDob(dob: string): string {
		if (!dob) {
			return '';
		}
		const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
		if (iso) {
			return `${iso[2]}/${iso[3]}/${iso[1]}`;
		}
		return dob;
	}

	private _calcAge(dob: string): number {
		if (!dob) {
			return 0;
		}
		// Parse ISO date-only strings as local dates to avoid UTC-midnight timezone shift.
		const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
		const b = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(dob);
		const t = new Date();
		let a = t.getFullYear() - b.getFullYear();
		if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) {
			a--;
		}
		return a;
	}
}
