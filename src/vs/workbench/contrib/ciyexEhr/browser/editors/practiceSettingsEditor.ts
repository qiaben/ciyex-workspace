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
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { PracticeSettingsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';

interface PracticeData {
	id?: string;
	name?: string;
	practiceType?: string;
	npi?: string;
	taxId?: string;
	dba?: string;
	active?: boolean;
	phone?: string;
	fax?: string;
	email?: string;
	website?: string;
	addressLine1?: string;
	addressLine2?: string;
	city?: string;
	state?: string;
	zip?: string;
	country?: string;
}

const PRACTICE_TYPES: Array<[string, string]> = [
	['', 'Select practice type'],
	['family-medicine', 'Family Medicine'],
	['internal-medicine', 'Internal Medicine'],
	['pediatrics', 'Pediatrics'],
	['cardiology', 'Cardiology'],
	['dermatology', 'Dermatology'],
	['dental', 'Dental'],
	['orthopedics', 'Orthopedics'],
	['psychiatry', 'Psychiatry'],
	['urgent-care', 'Urgent Care'],
	['other', 'Other'],
];

export class PracticeSettingsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexPracticeSettings';

	/** Inject the no-scrollbar stylesheet exactly once per browser session. */
	private static _scrollbarStyleInjected = false;
	private static _injectNoScrollbarStyle(): void {
		if (this._scrollbarStyleInjected) { return; }
		this._scrollbarStyleInjected = true;
		const styleEl = mainWindow.document.createElement('style');
		styleEl.textContent = '.ciyex-no-scrollbar::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none; }';
		mainWindow.document.head.appendChild(styleEl);
	}

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private practice: PracticeData = {};
	private logoData: string | null = null;
	private _saving = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(PracticeSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.practice-settings-editor.ciyex-editor-root'));
		// Hide the native vertical scrollbar (team flagged it as visible cruft
		// on the Practice Settings page) while preserving scroll. The
		// .ciyex-no-scrollbar class is wired in the shared stylesheet below
		// — Firefox uses `scrollbar-width:none`, Webkit uses ::-webkit-scrollbar.
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;scrollbar-width:none;';
		this.root.classList.add('ciyex-no-scrollbar');
		PracticeSettingsEditor._injectNoScrollbarStyle();

		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1000px;margin:0 auto;padding:24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof PracticeSettingsEditorInput)) { return; }
		await this._load();
	}

	private async _load(): Promise<void> {
		this.contentEl.textContent = 'Loading practice settings\u2026';
		this.contentEl.style.color = 'var(--vscode-descriptionForeground)';

		try {
			// Fetch practice via tab-field-config "practice" page
			const res = await this.apiService.fetch('/api/fhir-resource/practice?page=0&size=1');
			let row: Record<string, unknown> | null = null;
			if (res.ok) {
				const body = await res.json();
				const list = body?.data?.content || body?.content || [];
				if (list.length > 0) { row = list[0]; }
			}
			this.practice = (row || {}) as PracticeData;

			// Fetch logo
			try {
				const logoRes = await this.apiService.fetch('/api/practice-logo');
				if (logoRes.ok) {
					const json = await logoRes.json();
					this.logoData = json?.data?.logoData || null;
				}
			} catch { /* no logo */ }

			this.contentEl.style.color = '';
			this._render();
		} catch (e) {
			this.contentEl.textContent = 'Waiting for login\u2026';
		}
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		// Header
		const header = DOM.append(this.contentEl, DOM.$('.ps-header'));
		header.style.cssText = 'margin-bottom:24px;';
		const title = DOM.append(header, DOM.$('h1'));
		title.textContent = 'General';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const subtitle = DOM.append(header, DOM.$('p'));
		subtitle.textContent = 'Practice information, contact details, and branding';
		subtitle.style.cssText = 'margin:0;font-size:13px;color:var(--vscode-descriptionForeground);';

		// Logo section
		this._renderLogoSection();

		// Edit Practice section
		const editTitle = DOM.append(this.contentEl, DOM.$('.section-title-row'));
		editTitle.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:24px 0 12px;';
		const editLabel = DOM.append(editTitle, DOM.$('h2'));
		editLabel.textContent = 'Edit Practice';
		editLabel.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const saveBtn = DOM.append(editTitle, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = this._saving ? 'Saving\u2026' : '\u{1F4BE} Save';
		saveBtn.disabled = this._saving;
		saveBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;';
		saveBtn.addEventListener('click', () => this._save());

		// Practice Information panel
		this._renderPanel('Practice Information', () => this._renderPracticeInfoFields());

		// Contact Information panel
		this._renderPanel('Contact Information', () => this._renderContactFields());

		// Address panel
		this._renderPanel('Address', () => this._renderAddressFields());
	}

	private _renderLogoSection(): void {
		const wrap = DOM.append(this.contentEl, DOM.$('.ps-logo-section'));
		wrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;padding:16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;';

		// Logo preview box
		const preview = DOM.append(wrap, DOM.$('.ps-logo-preview'));
		preview.style.cssText = 'width:120px;height:120px;border:2px dashed var(--vscode-editorWidget-border);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--vscode-editor-background);overflow:hidden;';
		if (this.logoData) {
			const img = DOM.append(preview, DOM.$('img')) as HTMLImageElement;
			img.src = this.logoData;
			img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
		} else {
			const icon = DOM.append(preview, DOM.$('span'));
			icon.textContent = '\u{1F5BC}\uFE0F';
			icon.style.cssText = 'font-size:32px;opacity:0.4;';
		}

		// Info + actions
		const info = DOM.append(wrap, DOM.$('.ps-logo-info'));
		info.style.cssText = 'flex:1;';
		const lbl = DOM.append(info, DOM.$('div'));
		lbl.textContent = 'Practice Logo';
		lbl.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:4px;';
		const desc = DOM.append(info, DOM.$('div'));
		desc.textContent = 'Upload your practice logo. It will appear on printed documents and reports. Max 2MB, PNG/JPG/SVG.';
		desc.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:12px;';

		const actions = DOM.append(info, DOM.$('.ps-logo-actions'));
		actions.style.cssText = 'display:flex;gap:8px;';

		const fileInput = DOM.append(info, DOM.$('input')) as HTMLInputElement;
		fileInput.type = 'file';
		fileInput.accept = 'image/*';
		fileInput.style.display = 'none';
		fileInput.addEventListener('change', () => this._onLogoSelect(fileInput));

		const uploadBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		uploadBtn.textContent = '\u{2B06} Upload';
		uploadBtn.style.cssText = 'padding:5px 12px;background:transparent;border:1px solid var(--vscode-button-border,var(--vscode-input-border,#3c3c3c));border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		uploadBtn.addEventListener('click', () => fileInput.click());

		if (this.logoData) {
			const removeBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			removeBtn.textContent = '\u{1F5D1} Remove';
			removeBtn.style.cssText = 'padding:5px 12px;background:transparent;border:1px solid var(--vscode-errorForeground,#f48771);border-radius:4px;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:12px;';
			removeBtn.addEventListener('click', () => this._onLogoRemove());
		}
	}

	private async _onLogoSelect(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		if (!file) { return; }
		if (file.size > 2 * 1024 * 1024) {
			this.notificationService.notify({ severity: Severity.Error, message: 'Logo must be under 2MB.' });
			return;
		}
		try {
			const formData = new FormData();
			formData.append('file', file);
			const url = `${this.apiService.apiUrl}/api/practice-logo`;
			const token = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_token') : '') || '';
			const tenant = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') : '') || '';
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					...(tenant ? { 'X-Tenant-Name': tenant } : {}),
				},
				body: formData,
			});
			if (res.ok) {
				const json = await res.json();
				this.logoData = json?.data?.logoData || null;
				this._render();
				this.notificationService.notify({ severity: Severity.Info, message: 'Practice logo uploaded.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Upload failed (${res.status}).` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Upload failed: ${e}` });
		}
	}

	private async _onLogoRemove(): Promise<void> {
		try {
			await this.apiService.fetch('/api/practice-logo', { method: 'DELETE' });
			this.logoData = null;
			this._render();
		} catch { /* ignore */ }
	}

	private _renderPanel(title: string, body: () => HTMLElement): void {
		const panel = DOM.append(this.contentEl, DOM.$('.ps-panel'));
		panel.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;overflow:hidden;';

		const head = DOM.append(panel, DOM.$('.ps-panel-head'));
		head.style.cssText = 'padding:12px 16px;background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;justify-content:space-between;';
		const headTitle = DOM.append(head, DOM.$('h3'));
		headTitle.textContent = title;
		headTitle.style.cssText = 'margin:0;font-size:13px;font-weight:600;';
		const chev = DOM.append(head, DOM.$('span'));
		chev.textContent = '\u25BE';
		chev.style.cssText = 'opacity:0.5;font-size:11px;';

		const bodyEl = DOM.append(panel, DOM.$('.ps-panel-body'));
		bodyEl.style.cssText = 'padding:16px;';
		bodyEl.appendChild(body());
	}

	private _renderPracticeInfoFields(): HTMLElement {
		const grid = DOM.$('div');
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:start;';

		// Practice Name (required, full row)
		this._gridField(grid, 'name', 'Practice Name *', this.practice.name || '', 'text', 3);

		// Active toggle (right-aligned, single row)
		const activeRow = DOM.append(grid, DOM.$('.ps-active-row'));
		activeRow.style.cssText = 'grid-column:span 3;display:flex;align-items:center;gap:8px;';
		const activeLabel = DOM.append(activeRow, DOM.$('label'));
		activeLabel.textContent = 'Active';
		activeLabel.style.cssText = 'font-size:12px;font-weight:500;';
		const activeToggle = DOM.append(activeRow, DOM.$('input')) as HTMLInputElement;
		activeToggle.type = 'checkbox';
		activeToggle.checked = this.practice.active !== false;
		activeToggle.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
		activeToggle.addEventListener('change', () => { this.practice.active = activeToggle.checked; });

		// Practice Type (select)
		this._gridSelect(grid, 'practiceType', 'Practice Type', this.practice.practiceType || '', PRACTICE_TYPES);
		// NPI
		this._gridField(grid, 'npi', 'NPI', this.practice.npi || '', 'text', 1);
		// Tax ID
		this._gridField(grid, 'taxId', 'Tax ID (EIN)', this.practice.taxId || '', 'text', 1);
		// DBA
		this._gridField(grid, 'dba', 'DBA / Alias', this.practice.dba || '', 'text', 3);

		return grid;
	}

	private _renderContactFields(): HTMLElement {
		const grid = DOM.$('div');
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;';

		this._gridField(grid, 'phone', 'Phone *', this.practice.phone || '', 'tel', 1);
		this._gridField(grid, 'fax', 'Fax', this.practice.fax || '', 'tel', 1);
		this._gridField(grid, 'email', 'Email', this.practice.email || '', 'email', 1);
		this._gridField(grid, 'website', 'Website', this.practice.website || '', 'url', 3);

		return grid;
	}

	private _renderAddressFields(): HTMLElement {
		const grid = DOM.$('div');
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;';

		this._gridField(grid, 'addressLine1', 'Address Line 1', this.practice.addressLine1 || '', 'text', 4);
		this._gridField(grid, 'addressLine2', 'Address Line 2', this.practice.addressLine2 || '', 'text', 4);
		this._gridField(grid, 'city', 'City', this.practice.city || '', 'text', 2);
		this._gridField(grid, 'state', 'State', this.practice.state || '', 'text', 1);
		this._gridField(grid, 'zip', 'ZIP', this.practice.zip || '', 'text', 1);

		return grid;
	}

	private _gridField(parent: HTMLElement, key: keyof PracticeData, label: string, value: string, type: string, span: number): void {
		const cell = DOM.append(parent, DOM.$('.ps-field'));
		cell.style.cssText = `grid-column:span ${span};`;
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const input = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
		input.type = type;
		input.value = value;
		input.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
		input.addEventListener('focus', () => { input.style.borderColor = 'var(--vscode-focusBorder)'; });
		input.addEventListener('blur', () => { input.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });
		input.addEventListener('input', () => {
			(this.practice as Record<string, unknown>)[key as string] = input.value;

		});
	}

	private _gridSelect(parent: HTMLElement, key: keyof PracticeData, label: string, value: string, options: Array<[string, string]>): void {
		const cell = DOM.append(parent, DOM.$('.ps-field'));
		cell.style.cssText = 'grid-column:span 1;';
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const select = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
		select.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:13px;outline:none;cursor:pointer;';
		for (const [v, label] of options) {
			const opt = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			opt.value = v;
			opt.textContent = label;
			if (v === value) { opt.selected = true; }
		}
		select.addEventListener('change', () => {
			(this.practice as Record<string, unknown>)[key as string] = select.value;

		});
	}

	private async _save(): Promise<void> {
		if (this._saving) { return; }
		if (!this.practice.name) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Practice name is required.' });
			return;
		}
		this._saving = true;
		this._render();
		try {
			const id = this.practice.id;
			const path = id
				? `/api/fhir-resource/practice/${encodeURIComponent(id)}`
				: '/api/fhir-resource/practice';
			const method = id ? 'PUT' : 'POST';
			const res = await this.apiService.fetch(path, {
				method,
				body: JSON.stringify(this.practice),
			});
			if (res.ok) {
				const body = await res.json().catch(() => null);
				const saved = (body?.data || body || {}) as { id?: string };
				if (saved && typeof saved.id === 'string') {
					this.practice.id = saved.id;
				}

				this.notificationService.notify({ severity: Severity.Info, message: 'Practice settings saved.' });
			} else {
				const errBody = await res.json().catch(() => null);
				const msg = errBody?.message || errBody?.error || `Save failed (${res.status})`;
				this.notificationService.notify({ severity: Severity.Error, message: msg });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		} finally {
			this._saving = false;
			this._render();
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
