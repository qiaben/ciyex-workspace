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
	private _patients: IPatientRow[] = [];
	private _loaded = false;
	private _searchQuery = '';
	private _statusFilter: 'all' | 'active' | 'inactive' = 'all';
	private _genderFilter: 'all' | 'male' | 'female' | 'other' = 'all';

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
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
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
			this._renderList();
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
			this._renderList();
		});
		filterRow.appendChild(statusSel);

		const genderSel = document.createElement('select');
		genderSel.style.cssText = selStyle;
		genderSel.title = 'Gender filter';
		for (const [val, label] of [['all', 'All Gender'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']] as const) {
			const o = document.createElement('option');
			o.value = val; o.textContent = label;
			if (val === this._genderFilter) { o.selected = true; }
			genderSel.appendChild(o);
		}
		genderSel.addEventListener('change', () => {
			this._genderFilter = genderSel.value as 'all' | 'male' | 'female' | 'other';
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

		const listWrap = document.createElement('div');
		listWrap.style.cssText = 'flex:1;overflow-y:auto;';
		listWrap.appendChild(loadingEl);

		this._listEl = document.createElement('div');
		listWrap.appendChild(this._listEl);
		container.appendChild(listWrap);

		// Load data
		this._loadPatients().then(() => {
			loadingEl.remove();
		});
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
				if (this._genderFilter === 'other') {
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
			const response = await this.apiService.fetch('/api/patients?page=0&size=100&sort=lastName,asc');
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

	private _renderList(): void {
		if (!this._listEl) {
			return;
		}
		while (this._listEl.firstChild) {
			this._listEl.removeChild(this._listEl.firstChild);
		}

		if (this._patients.length === 0) {
			this._showMessage('No patients found');
			return;
		}

		const rows = this._filteredPatients();
		if (rows.length === 0) {
			this._showMessage('No matches');
			return;
		}

		for (const patient of rows) {
			const row = document.createElement('div');
			Object.assign(row.style, {
				padding: '6px 16px',
				cursor: 'pointer',
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				fontSize: '12px',
				borderBottom: '1px solid var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))',
			});

			row.addEventListener('mouseenter', () => {
				row.style.background = 'var(--vscode-list-hoverBackground)';
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = '';
			});

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
			const dob = patient.dateOfBirth || '';
			detailEl.textContent = `${dob} ${g} ${age}y`;
			row.appendChild(detailEl);

			row.addEventListener('click', () => {
				this.commandService.executeCommand('ciyex.openPatientChart', patient.id, `${patient.firstName} ${patient.lastName}`);
			});

			this._listEl.appendChild(row);
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

	private _calcAge(dob: string): number {
		if (!dob) {
			return 0;
		}
		const b = new Date(dob);
		const t = new Date();
		let a = t.getFullYear() - b.getFullYear();
		if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) {
			a--;
		}
		return a;
	}
}
