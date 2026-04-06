/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { CiyexConfigEditorInput } from './ciyexEditorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface TabDef {
	key: string;
	label: string;
	icon: string;
	position: number;
	visible: boolean;
	fhirResources: string[];
}

interface CategoryDef {
	key: string;
	label: string;
	position: number;
	tabs: TabDef[];
}

interface LayoutConfig {
	source: string;
	categories: CategoryDef[];
}

const FHIR_RESOURCES = [
	'Patient', 'Encounter', 'Observation', 'Condition', 'Procedure',
	'MedicationRequest', 'AllergyIntolerance', 'Immunization', 'DiagnosticReport',
	'CarePlan', 'DocumentReference', 'Appointment', 'Schedule', 'ServiceRequest',
	'Coverage', 'Claim', 'Organization', 'Location', 'Practitioner', 'PractitionerRole',
	'RelatedPerson', 'FamilyMemberHistory', 'Goal', 'Consent', 'ImagingStudy',
	'PaymentReconciliation', 'PaymentNotice', 'Slot',
];

export class LayoutEditor extends EditorPane {

	static readonly ID = 'workbench.editor.ciyexLayout';

	private rootElement!: HTMLElement;
	private bodyElement!: HTMLElement;
	private config: LayoutConfig = { source: 'UNIVERSAL_DEFAULT', categories: [] };
	private _dirty = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(LayoutEditor.ID, group, telemetryService, themeService, storageService);
	}

	get dirty(): boolean {
		return this._dirty;
	}

	protected createEditor(parent: HTMLElement): void {
		this.rootElement = DOM.append(parent, DOM.$('.ciyex-layout-editor'));
		this.rootElement.style.cssText = 'height:100%;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);';

		// Header
		const header = DOM.append(this.rootElement, DOM.$('.ciyex-editor-header'));
		header.style.cssText = 'padding:16px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		const title = DOM.append(header, DOM.$('h2'));
		title.textContent = 'Chart Layout';
		title.style.cssText = 'margin:0;font-size:16px;flex:1;';

		// Toolbar buttons
		const toolbar = DOM.append(header, DOM.$('.toolbar'));
		toolbar.style.cssText = 'display:flex;gap:6px;';

		this._createButton(toolbar, 'Add Category', () => this._addCategory());
		this._createButton(toolbar, 'Add Tab', () => this._addTab());
		this._createButton(toolbar, 'Save', () => this._save(), true);
		this._createButton(toolbar, 'Open JSON', () => this._openJson());

		// Body
		this.bodyElement = DOM.append(this.rootElement, DOM.$('.ciyex-editor-body'));
		this.bodyElement.style.cssText = 'padding:16px 20px;';
	}

	override async setInput(input: CiyexConfigEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this._loadConfig();
		if (!token.isCancellationRequested) {
			this._render();
		}
	}

	private async _loadConfig(): Promise<void> {
		const input = this.input as CiyexConfigEditorInput;
		if (!input) { return; }
		try {
			const content = await this.fileService.readFile(input.fileUri);
			this.config = JSON.parse(content.value.toString());
		} catch {
			this.config = { source: 'UNIVERSAL_DEFAULT', categories: [] };
		}
		this._dirty = false;
	}

	private _render(): void {
		DOM.clearNode(this.bodyElement);

		if (this.config.categories.length === 0) {
			const empty = DOM.append(this.bodyElement, DOM.$('.empty-state'));
			empty.style.cssText = 'text-align:center;padding:40px;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No categories configured. Click "Add Category" to start.';
			return;
		}

		for (let ci = 0; ci < this.config.categories.length; ci++) {
			this._renderCategory(this.bodyElement, this.config.categories[ci], ci);
		}
	}

	private _renderCategory(parent: HTMLElement, cat: CategoryDef, catIdx: number): void {
		const card = DOM.append(parent, DOM.$('.category-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:6px;margin-bottom:12px;';

		// Category header
		const hdr = DOM.append(card, DOM.$('.cat-header'));
		hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		const label = DOM.append(hdr, DOM.$('span'));
		label.textContent = cat.label;
		label.style.cssText = 'font-weight:600;flex:1;';

		const count = DOM.append(hdr, DOM.$('span'));
		const visCount = cat.tabs.filter(t => t.visible).length;
		count.textContent = `${visCount}/${cat.tabs.length} visible`;
		count.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		// Category actions
		this._createIconBtn(hdr, 'Edit', () => this._editCategory(catIdx));
		this._createIconBtn(hdr, '\u25B2', () => this._moveCategory(catIdx, -1));
		this._createIconBtn(hdr, '\u25BC', () => this._moveCategory(catIdx, 1));
		this._createIconBtn(hdr, '\u2716', () => this._deleteCategory(catIdx), true);

		// Tabs
		const tabList = DOM.append(card, DOM.$('.tab-list'));
		tabList.style.cssText = 'padding:4px 0;';

		for (let ti = 0; ti < cat.tabs.length; ti++) {
			this._renderTab(tabList, cat.tabs[ti], catIdx, ti);
		}
	}

	private _renderTab(parent: HTMLElement, tab: TabDef, catIdx: number, tabIdx: number): void {
		const row = DOM.append(parent, DOM.$('.tab-row'));
		row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid rgba(255,255,255,0.04);opacity:${tab.visible ? '1' : '0.4'};`;
		row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.03)'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		// Icon
		const icon = DOM.append(row, DOM.$('span'));
		icon.textContent = tab.icon;
		icon.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:11px;width:80px;overflow:hidden;';

		// Label
		const label = DOM.append(row, DOM.$('span'));
		label.textContent = tab.label;
		label.style.cssText = 'flex:1;font-weight:500;';

		// Key
		const key = DOM.append(row, DOM.$('span'));
		key.textContent = tab.key;
		key.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:11px;font-family:monospace;';

		// FHIR badges
		for (const r of tab.fhirResources) {
			const badge = DOM.append(row, DOM.$('span'));
			badge.textContent = r;
			badge.style.cssText = 'background:#1e3a5f;color:#6bb3f0;padding:1px 6px;border-radius:3px;font-size:10px;';
		}

		// Actions
		const actions = DOM.append(row, DOM.$('.actions'));
		actions.style.cssText = 'display:flex;gap:2px;';

		this._createIconBtn(actions, 'Edit', () => this._editTab(catIdx, tabIdx));
		this._createIconBtn(actions, tab.visible ? '\u{1F441}' : '\u2014', () => this._toggleTabVisibility(catIdx, tabIdx));
		this._createIconBtn(actions, '\u25B2', () => this._moveTab(catIdx, tabIdx, -1));
		this._createIconBtn(actions, '\u25BC', () => this._moveTab(catIdx, tabIdx, 1));
		this._createIconBtn(actions, '\u2716', () => this._deleteTab(catIdx, tabIdx), true);
	}

	// --- CRUD Operations ---

	private _addCategory(): void {
		const name = globalThis.prompt?.('Category name:');
		if (!name) { return; }
		this.config.categories.push({
			key: name.toLowerCase().replace(/\s+/g, '-'),
			label: name,
			position: this.config.categories.length,
			tabs: [],
		});
		this._markDirty();
		this._render();
	}

	private _editCategory(catIdx: number): void {
		const cat = this.config.categories[catIdx];
		const name = globalThis.prompt?.('Category name:', cat.label);
		if (name === null || name === undefined) { return; }
		cat.label = name;
		cat.key = name.toLowerCase().replace(/\s+/g, '-');
		this._markDirty();
		this._render();
	}

	private _moveCategory(catIdx: number, dir: number): void {
		const newIdx = catIdx + dir;
		if (newIdx < 0 || newIdx >= this.config.categories.length) { return; }
		const cats = this.config.categories;
		[cats[catIdx], cats[newIdx]] = [cats[newIdx], cats[catIdx]];
		cats.forEach((c, i) => { c.position = i; });
		this._markDirty();
		this._render();
	}

	private async _deleteCategory(catIdx: number): Promise<void> {
		const cat = this.config.categories[catIdx];
		const { confirmed } = await this.dialogService.confirm({
			message: `Delete category "${cat.label}" and all its ${cat.tabs.length} tabs?`,
		});
		if (!confirmed) { return; }
		this.config.categories.splice(catIdx, 1);
		this.config.categories.forEach((c, i) => { c.position = i; });
		this._markDirty();
		this._render();
	}

	private _addTab(): void {
		if (this.config.categories.length === 0) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Add a category first.' });
			return;
		}

		const key = globalThis.prompt?.('Tab key (e.g., vitals):');
		if (!key) { return; }
		const label = globalThis.prompt?.('Tab label:', key.charAt(0).toUpperCase() + key.slice(1));
		if (!label) { return; }

		// Pick category
		const catNames = this.config.categories.map(c => c.label).join(', ');
		const catName = globalThis.prompt?.(`Category (${catNames}):`, this.config.categories[0].label);
		const cat = this.config.categories.find(c => c.label === catName) || this.config.categories[0];

		// Pick FHIR resources
		const fhirStr = globalThis.prompt?.(`FHIR Resources (comma-separated).\nAvailable: ${FHIR_RESOURCES.slice(0, 10).join(', ')}...`, 'Patient');
		const fhirResources = fhirStr ? fhirStr.split(',').map(s => s.trim()).filter(Boolean) : [];

		cat.tabs.push({
			key,
			label,
			icon: 'FileText',
			position: cat.tabs.length,
			visible: true,
			fhirResources,
		});
		this._markDirty();
		this._render();
	}

	private _editTab(catIdx: number, tabIdx: number): void {
		const tab = this.config.categories[catIdx].tabs[tabIdx];

		const label = globalThis.prompt?.('Tab label:', tab.label);
		if (label === null || label === undefined) { return; }
		tab.label = label;

		const icon = globalThis.prompt?.('Icon name:', tab.icon);
		if (icon) { tab.icon = icon; }

		const fhirStr = globalThis.prompt?.('FHIR Resources (comma-separated):', tab.fhirResources.join(', '));
		if (fhirStr !== null && fhirStr !== undefined) {
			tab.fhirResources = fhirStr.split(',').map(s => s.trim()).filter(Boolean);
		}

		// Move to different category?
		if (this.config.categories.length > 1) {
			const catNames = this.config.categories.map(c => c.label).join(', ');
			const currentCat = this.config.categories[catIdx].label;
			const targetCat = globalThis.prompt?.(`Move to category (${catNames}):`, currentCat);
			if (targetCat && targetCat !== currentCat) {
				const target = this.config.categories.find(c => c.label === targetCat);
				if (target) {
					this.config.categories[catIdx].tabs.splice(tabIdx, 1);
					tab.position = target.tabs.length;
					target.tabs.push(tab);
				}
			}
		}

		this._markDirty();
		this._render();
	}

	private _toggleTabVisibility(catIdx: number, tabIdx: number): void {
		const tab = this.config.categories[catIdx].tabs[tabIdx];
		tab.visible = !tab.visible;
		this._markDirty();
		this._render();
	}

	private _moveTab(catIdx: number, tabIdx: number, dir: number): void {
		const tabs = this.config.categories[catIdx].tabs;
		const newIdx = tabIdx + dir;
		if (newIdx < 0 || newIdx >= tabs.length) { return; }
		[tabs[tabIdx], tabs[newIdx]] = [tabs[newIdx], tabs[tabIdx]];
		tabs.forEach((t, i) => { t.position = i; });
		this._markDirty();
		this._render();
	}

	private async _deleteTab(catIdx: number, tabIdx: number): Promise<void> {
		const tab = this.config.categories[catIdx].tabs[tabIdx];
		const { confirmed } = await this.dialogService.confirm({
			message: `Delete tab "${tab.label}"?`,
		});
		if (!confirmed) { return; }
		this.config.categories[catIdx].tabs.splice(tabIdx, 1);
		this.config.categories[catIdx].tabs.forEach((t, i) => { t.position = i; });
		this._markDirty();
		this._render();
	}

	// --- Save / Toggle ---

	private async _save(): Promise<void> {
		const input = this.input as CiyexConfigEditorInput;
		if (!input) { return; }
		try {
			const json = JSON.stringify(this.config, null, 2);
			await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(json));
			this._dirty = false;
			this.notificationService.notify({ severity: Severity.Info, message: 'Layout saved.' });
		} catch (err) {
			this.notificationService.notify({ severity: Severity.Error, message: `Failed to save: ${err}` });
		}
	}

	private _openJson(): void {
		const input = this.input as CiyexConfigEditorInput;
		if (!input) { return; }
		this.editorService.openEditor({ resource: input.fileUri, options: { pinned: true } });
	}

	private _markDirty(): void {
		this._dirty = true;
		this.config.source = 'ORG_CUSTOM';
	}

	// --- UI Helpers ---

	private _createButton(parent: HTMLElement, text: string, onClick: () => void, primary = false): HTMLButtonElement {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = text;
		btn.style.cssText = `padding:5px 12px;border-radius:4px;border:none;cursor:pointer;font-size:12px;font-weight:600;${primary ? 'background:#0e639c;color:#fff;' : 'background:var(--vscode-button-secondaryBackground,#3c3c3c);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);'}`;
		btn.addEventListener('click', onClick);
		return btn;
	}

	private _createIconBtn(parent: HTMLElement, text: string, onClick: () => void, danger = false): void {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = text;
		btn.style.cssText = `background:none;border:none;cursor:pointer;color:${danger ? 'var(--vscode-errorForeground,#f48771)' : 'var(--vscode-descriptionForeground,#858585)'};padding:2px 5px;border-radius:3px;font-size:12px;`;
		btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.06)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
		btn.addEventListener('click', onClick);
	}

	override layout(dimension: DOM.Dimension): void {
		this.rootElement.style.height = `${dimension.height}px`;
		this.rootElement.style.width = `${dimension.width}px`;
	}
}
