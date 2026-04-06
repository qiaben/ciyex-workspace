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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.style.overflow = 'auto';

		// Loading message
		const loadingEl = document.createElement('div');
		loadingEl.style.padding = '12px 16px';
		loadingEl.style.color = 'var(--vscode-descriptionForeground)';
		loadingEl.style.fontSize = '12px';
		loadingEl.textContent = 'Loading patients...';
		container.appendChild(loadingEl);

		this._listEl = document.createElement('div');
		container.appendChild(this._listEl);

		// Load data
		this._loadPatients().then(() => {
			loadingEl.remove();
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

		for (const patient of this._patients) {
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

			// Icon
			const icon = document.createElement('span');
			icon.className = 'codicon codicon-person';
			icon.style.opacity = '0.6';
			row.appendChild(icon);

			// Name
			const nameEl = document.createElement('span');
			nameEl.style.flex = '1';
			nameEl.style.color = 'var(--vscode-foreground)';
			nameEl.textContent = `${patient.lastName}, ${patient.firstName}`;
			row.appendChild(nameEl);

			// Details
			const detailEl = document.createElement('span');
			detailEl.style.color = 'var(--vscode-descriptionForeground)';
			detailEl.style.fontSize = '11px';
			const age = this._calcAge(patient.dateOfBirth);
			const g = patient.gender === 'male' ? 'M' : patient.gender === 'female' ? 'F' : '';
			detailEl.textContent = `${g} ${age}y`;
			row.appendChild(detailEl);

			row.addEventListener('click', () => {
				console.log(`[CiyexEHR] Open patient: ${patient.firstName} ${patient.lastName} (${patient.id})`);
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
