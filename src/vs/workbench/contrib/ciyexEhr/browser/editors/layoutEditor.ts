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
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { BaseCiyexInput } from './ciyexEditorInput.js';
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

// Available FHIR resource types for tab assignment
// const FHIR_RESOURCES = ['Patient', 'Encounter', 'Observation', 'Condition', 'Procedure', 'MedicationRequest', 'AllergyIntolerance', 'Immunization', 'DiagnosticReport', 'CarePlan', 'DocumentReference', 'Appointment', 'Schedule', 'ServiceRequest', 'Coverage', 'Claim', 'Organization', 'Location', 'Practitioner', 'PractitionerRole', 'RelatedPerson', 'FamilyMemberHistory', 'Goal', 'Consent', 'ImagingStudy'];

export class LayoutEditor extends EditorPane {

	static readonly ID = 'workbench.editor.ciyexLayout';

	private rootElement!: HTMLElement;
	private settingsBody!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private config: LayoutConfig = { source: 'UNIVERSAL_DEFAULT', categories: [] };
	private _dirty = false;
	// Direct references to rendered section/item DOM nodes — used by the search
	// filter so we don't have to querySelectorAll(.settings-section).
	private _sectionNodes: Array<{ section: HTMLElement; items: HTMLElement[] }> = [];

	get dirty(): boolean { return this._dirty; }

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super(LayoutEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.rootElement = DOM.append(parent, DOM.$('.ciyex-settings-editor'));
		this.rootElement.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);font-size:13px;';

		// Header (like Settings editor header)
		const header = DOM.append(this.rootElement, DOM.$('.settings-header'));
		header.style.cssText = 'padding:12px 24px 0;max-width:1000px;width:100%;margin:0 auto;';

		// Search bar
		const searchContainer = DOM.append(header, DOM.$('.search-container'));
		searchContainer.style.cssText = 'position:relative;margin-bottom:8px;';

		this.searchInput = DOM.append(searchContainer, DOM.$('input.settings-search')) as HTMLInputElement;
		this.searchInput.type = 'text';
		this.searchInput.placeholder = 'Search chart layout settings...';
		this.searchInput.style.cssText = 'width:100%;padding:6px 12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;outline:none;';
		this.searchInput.addEventListener('input', () => this._filterSettings());
		this.searchInput.addEventListener('focus', () => { this.searchInput.style.borderColor = 'var(--vscode-focusBorder)'; });
		this.searchInput.addEventListener('blur', () => { this.searchInput.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });

		// Toolbar row
		const toolbar = DOM.append(header, DOM.$('.settings-toolbar'));
		toolbar.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-settings-headerBorder,var(--vscode-editorWidget-border));';

		const titleEl = DOM.append(toolbar, DOM.$('span'));
		titleEl.textContent = 'Chart Layout';
		titleEl.style.cssText = 'font-weight:600;font-size:14px;flex:1;';

		this._addHeaderLink(toolbar, 'Add Category', () => this._addCategory());
		this._addHeaderLink(toolbar, 'Add Tab', () => this._addTab());
		this._addHeaderLink(toolbar, 'Save', () => this._save());
		this._addHeaderLink(toolbar, 'Open JSON', () => this._openJson());

		// Body (settings list)
		const bodyContainer = DOM.append(this.rootElement, DOM.$('.settings-body-container'));
		bodyContainer.style.cssText = 'flex:1;overflow-y:auto;';

		this.settingsBody = DOM.append(bodyContainer, DOM.$('.settings-body'));
		this.settingsBody.style.cssText = 'max-width:1000px;width:100%;margin:0 auto;padding:0 24px 24px;';
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this._loadConfig();
		if (!token.isCancellationRequested) {
			this._render();
		}
	}

	private async _loadConfig(): Promise<void> {
		const input = this.input as BaseCiyexInput;
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
		DOM.clearNode(this.settingsBody);
		this._sectionNodes = [];

		if (this.config.categories.length === 0) {
			const empty = DOM.append(this.settingsBody, DOM.$('.settings-empty'));
			empty.style.cssText = 'padding:40px 0;color:var(--vscode-descriptionForeground);text-align:center;';
			empty.textContent = 'No categories configured. Click "Add Category" to start building your chart layout.';
			return;
		}

		for (let ci = 0; ci < this.config.categories.length; ci++) {
			this._renderCategorySection(ci);
		}
	}

	private _renderCategorySection(ci: number): void {
		const cat = this.config.categories[ci];

		// Section header (like VS Code's "Editor", "Workbench" headers)
		const section = DOM.append(this.settingsBody, DOM.$('.settings-section'));
		section.dataset.category = cat.key;

		const sectionHeader = DOM.append(section, DOM.$('.settings-section-header'));
		sectionHeader.style.cssText = 'display:flex;align-items:center;padding:16px 0 8px;border-bottom:1px solid var(--vscode-settings-headerBorder,var(--vscode-editorWidget-border));margin-bottom:4px;gap:8px;';

		const sectionTitle = DOM.append(sectionHeader, DOM.$('h3'));
		sectionTitle.textContent = cat.label;
		sectionTitle.style.cssText = 'margin:0;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-settings-headerForeground,var(--vscode-foreground));flex:1;';

		const countBadge = DOM.append(sectionHeader, DOM.$('span'));
		const vis = cat.tabs.filter(t => t.visible).length;
		countBadge.textContent = `${vis}/${cat.tabs.length} visible`;
		countBadge.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		// Category actions as text links
		this._addSmallLink(sectionHeader, '\u25B2', () => this._moveCategory(ci, -1));
		this._addSmallLink(sectionHeader, '\u25BC', () => this._moveCategory(ci, 1));
		this._addSmallLink(sectionHeader, 'Rename', () => this._editCategory(ci));
		this._addSmallLink(sectionHeader, 'Delete', () => this._deleteCategory(ci), true);

		// Tab settings rows — track each row's DOM node so _filterSettings can
		// show/hide them without querySelectorAll (forbidden by VSCode lint rules).
		const items: HTMLElement[] = [];
		for (let ti = 0; ti < cat.tabs.length; ti++) {
			const row = this._renderTabSetting(section, cat.tabs[ti], ci, ti);
			items.push(row);
		}
		this._sectionNodes.push({ section, items });
	}

	private _renderTabSetting(parent: HTMLElement, tab: TabDef, ci: number, ti: number): HTMLElement {
		// Setting row (like a VS Code setting item)
		const row = DOM.append(parent, DOM.$('.setting-item'));
		row.dataset.key = tab.key;
		row.style.cssText = `padding:10px 16px;display:flex;gap:16px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:flex-start;${tab.visible ? '' : 'opacity:0.45;'}`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		// Left side: setting info
		const info = DOM.append(row, DOM.$('.setting-info'));
		info.style.cssText = 'flex:1;min-width:0;';

		// Setting name (bold, like "editor.fontSize")
		const nameRow = DOM.append(info, DOM.$('.setting-name'));
		nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px;';

		const nameEl = DOM.append(nameRow, DOM.$('span'));
		nameEl.textContent = tab.label;
		nameEl.style.cssText = 'font-weight:500;color:var(--vscode-settings-headerForeground,var(--vscode-foreground));';

		const keyEl = DOM.append(nameRow, DOM.$('code'));
		keyEl.textContent = tab.key;
		keyEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family,monospace);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:3px;';

		// Description line: icon + FHIR resources
		const descEl = DOM.append(info, DOM.$('.setting-desc'));
		descEl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

		const iconSpan = DOM.append(descEl, DOM.$('span'));
		iconSpan.textContent = `Icon: ${tab.icon}`;

		if (tab.fhirResources.length > 0) {
			const sep = DOM.append(descEl, DOM.$('span'));
			sep.textContent = '\u00B7';

			for (const r of tab.fhirResources) {
				const badge = DOM.append(descEl, DOM.$('span'));
				badge.textContent = r;
				badge.style.cssText = 'background:rgba(14,99,156,0.15);color:var(--vscode-textLink-foreground,#3794ff);padding:1px 6px;border-radius:3px;font-size:10px;';
			}
		}

		// Right side: controls (like VS Code setting controls)
		const controls = DOM.append(row, DOM.$('.setting-controls'));
		controls.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

		// Visible toggle (checkbox like VS Code boolean settings)
		const visLabel = DOM.append(controls, DOM.$('label'));
		visLabel.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:var(--vscode-descriptionForeground);';
		const visCheckbox = DOM.append(visLabel, DOM.$('input')) as HTMLInputElement;
		visCheckbox.type = 'checkbox';
		visCheckbox.checked = tab.visible;
		visCheckbox.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
		visCheckbox.addEventListener('change', () => { this._toggleVisibility(ci, ti); });
		const visText = DOM.append(visLabel, DOM.$('span'));
		visText.textContent = 'Visible';

		// Position (number input like VS Code number settings)
		const posLabel = DOM.append(controls, DOM.$('label'));
		posLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground);';
		const posText = DOM.append(posLabel, DOM.$('span'));
		posText.textContent = 'Position';
		const posInput = DOM.append(posLabel, DOM.$('input')) as HTMLInputElement;
		posInput.type = 'number';
		posInput.value = String(ti);
		posInput.min = '0';
		posInput.max = String(this.config.categories[ci].tabs.length - 1);
		posInput.style.cssText = 'width:45px;padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:12px;text-align:center;';
		posInput.addEventListener('change', () => {
			const newPos = parseInt(posInput.value);
			if (!isNaN(newPos) && newPos !== ti) {
				this._reorderTab(ci, ti, newPos);
			}
		});

		// Action links
		this._addSmallLink(controls, 'Edit', () => this._editTab(ci, ti));
		this._addSmallLink(controls, 'Delete', () => this._deleteTab(ci, ti), true);
		return row;
	}

	// ---- CRUD Operations ----

	private async _addCategory(): Promise<void> {
		const name = await this.quickInputService.input({ prompt: 'Category name' });
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

	private async _editCategory(ci: number): Promise<void> {
		const cat = this.config.categories[ci];
		const name = await this.quickInputService.input({ prompt: 'Category name', value: cat.label });
		if (!name) { return; }
		cat.label = name;
		cat.key = name.toLowerCase().replace(/\s+/g, '-');
		this._markDirty();
		this._render();
	}

	private _moveCategory(ci: number, dir: number): void {
		const newIdx = ci + dir;
		if (newIdx < 0 || newIdx >= this.config.categories.length) { return; }
		const cats = this.config.categories;
		[cats[ci], cats[newIdx]] = [cats[newIdx], cats[ci]];
		cats.forEach((c, i) => { c.position = i; });
		this._markDirty();
		this._render();
	}

	private async _deleteCategory(ci: number): Promise<void> {
		const cat = this.config.categories[ci];
		const { confirmed } = await this.dialogService.confirm({ message: `Delete category "${cat.label}" and all ${cat.tabs.length} tabs?` });
		if (!confirmed) { return; }
		this.config.categories.splice(ci, 1);
		this.config.categories.forEach((c, i) => { c.position = i; });
		this._markDirty();
		this._render();
	}

	private _addTab(): void {
		if (this.config.categories.length === 0) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Add a category first.' });
			return;
		}
		this._openTabFormModal(null, -1, -1);
	}

	private _editTab(ci: number, ti: number): void {
		this._openTabFormModal(this.config.categories[ci].tabs[ti], ci, ti);
	}

	/**
	 * Open a modal form to add or edit a tab. Matches the EHR Web UI layout-settings
	 * "Add Item" dialog: all fields visible at once (Key, Label, Icon, Category,
	 * FHIR Resources, Visible), not a chain of quick-input prompts.
	 */
	private _openTabFormModal(existing: TabDef | null, ci: number, ti: number): void {
		const isEdit = existing !== null;
		const overlay = DOM.append(this.rootElement, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:520px;max-width:94vw;max-height:88vh;overflow-y:auto;padding:22px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = isEdit ? 'Edit Item' : 'Add Item';
		ht.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const labelStyle = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;margin-top:10px;';
		const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';

		const keyLbl = DOM.append(modal, DOM.$('label'));
		keyLbl.textContent = 'Tab Key *';
		keyLbl.style.cssText = labelStyle;
		const keyInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		keyInp.value = existing?.key || '';
		keyInp.placeholder = 'e.g. vitals, allergies';
		keyInp.style.cssText = inputStyle;
		keyInp.disabled = isEdit;

		const labelLbl = DOM.append(modal, DOM.$('label'));
		labelLbl.textContent = 'Tab Label *';
		labelLbl.style.cssText = labelStyle;
		const labelInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		labelInp.value = existing?.label || '';
		labelInp.placeholder = 'e.g. Vitals';
		labelInp.style.cssText = inputStyle;

		const iconLbl = DOM.append(modal, DOM.$('label'));
		iconLbl.textContent = 'Icon Name';
		iconLbl.style.cssText = labelStyle;
		const iconInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		iconInp.value = existing?.icon || 'FileText';
		iconInp.placeholder = 'lucide icon name (e.g. FileText, Heart, Pill)';
		iconInp.style.cssText = inputStyle;

		const catLbl = DOM.append(modal, DOM.$('label'));
		catLbl.textContent = 'Category *';
		catLbl.style.cssText = labelStyle;
		const catSel = DOM.append(modal, DOM.$('select')) as HTMLSelectElement;
		catSel.style.cssText = inputStyle + 'cursor:pointer;';
		for (let i = 0; i < this.config.categories.length; i++) {
			const c = this.config.categories[i];
			const o = DOM.append(catSel, DOM.$('option')) as HTMLOptionElement;
			o.value = String(i);
			o.textContent = c.label;
			if (isEdit ? i === ci : i === 0) { o.selected = true; }
		}

		const fhirLbl = DOM.append(modal, DOM.$('label'));
		fhirLbl.textContent = 'FHIR Resources';
		fhirLbl.style.cssText = labelStyle;
		const fhirInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		fhirInp.value = existing ? existing.fhirResources.join(', ') : 'Patient';
		fhirInp.placeholder = 'Comma-separated (e.g. Observation, Condition)';
		fhirInp.style.cssText = inputStyle;
		const fhirHint = DOM.append(modal, DOM.$('div'));
		fhirHint.textContent = 'Examples: Patient, Observation, Condition, Procedure, AllergyIntolerance, Immunization';
		fhirHint.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);margin-top:3px;';

		const visWrap = DOM.append(modal, DOM.$('label'));
		visWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px;cursor:pointer;font-size:13px;';
		const visCb = DOM.append(visWrap, DOM.$('input')) as HTMLInputElement;
		visCb.type = 'checkbox';
		visCb.checked = existing ? existing.visible : true;
		const visTxt = DOM.append(visWrap, DOM.$('span'));
		visTxt.textContent = 'Visible in chart';

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;';
		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());

		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save' : 'Add Item';
		saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', () => {
			const key = keyInp.value.trim();
			const label = labelInp.value.trim();
			if (!key || !label) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Tab Key and Label are required.' });
				return;
			}
			const fhirResources = fhirInp.value.split(',').map(s => s.trim()).filter(Boolean);
			const tab: TabDef = {
				key,
				label,
				icon: iconInp.value.trim() || 'FileText',
				position: existing ? existing.position : this.config.categories[Number(catSel.value)].tabs.length,
				visible: visCb.checked,
				fhirResources,
			};
			const newCi = Number(catSel.value);
			if (isEdit) {
				if (newCi === ci) {
					this.config.categories[ci].tabs[ti] = tab;
				} else {
					this.config.categories[ci].tabs.splice(ti, 1);
					this.config.categories[ci].tabs.forEach((t, i) => { t.position = i; });
					tab.position = this.config.categories[newCi].tabs.length;
					this.config.categories[newCi].tabs.push(tab);
				}
			} else {
				this.config.categories[newCi].tabs.push(tab);
			}
			this._markDirty();
			this._render();
			overlay.remove();
		});

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		setTimeout(() => (isEdit ? labelInp : keyInp).focus(), 50);
	}

	private _toggleVisibility(ci: number, ti: number): void {
		this.config.categories[ci].tabs[ti].visible = !this.config.categories[ci].tabs[ti].visible;
		this._markDirty();
		this._render();
	}

	private _reorderTab(ci: number, fromIdx: number, toIdx: number): void {
		const tabs = this.config.categories[ci].tabs;
		if (toIdx < 0 || toIdx >= tabs.length) { return; }
		const [tab] = tabs.splice(fromIdx, 1);
		tabs.splice(toIdx, 0, tab);
		tabs.forEach((t, i) => { t.position = i; });
		this._markDirty();
		this._render();
	}

	private async _deleteTab(ci: number, ti: number): Promise<void> {
		const tab = this.config.categories[ci].tabs[ti];
		const { confirmed } = await this.dialogService.confirm({ message: `Delete tab "${tab.label}"?` });
		if (!confirmed) { return; }
		this.config.categories[ci].tabs.splice(ti, 1);
		this.config.categories[ci].tabs.forEach((t, i) => { t.position = i; });
		this._markDirty();
		this._render();
	}

	private _filterSettings(): void {
		const query = this.searchInput.value.toLowerCase();
		// Walk our tracked DOM references rather than querying by selector — the
		// VSCode codebase forbids querySelectorAll because string selectors are
		// fragile (no-restricted-syntax in eslint.config.js).
		for (const { section, items } of this._sectionNodes) {
			let anyVisible = false;
			for (const item of items) {
				const key = item.dataset.key || '';
				const text = item.textContent?.toLowerCase() || '';
				const match = !query || text.includes(query) || key.includes(query);
				item.style.display = match ? '' : 'none';
				if (match) { anyVisible = true; }
			}
			section.style.display = anyVisible || !query ? '' : 'none';
		}
	}

	// ---- Save / JSON toggle ----

	private async _save(): Promise<void> {
		const input = this.input as BaseCiyexInput;
		if (!input) { return; }
		try {
			await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2)));
			this._dirty = false;
			this.notificationService.notify({ severity: Severity.Info, message: 'Chart layout saved.' });
		} catch (err) {
			this.notificationService.notify({ severity: Severity.Error, message: `Failed to save: ${err}` });
		}
	}

	private _openJson(): void {
		const input = this.input as BaseCiyexInput;
		if (!input) { return; }
		this.editorService.openEditor({ resource: input.fileUri, options: { pinned: true } });
	}

	private _markDirty(): void {
		this._dirty = true;
		this.config.source = 'ORG_CUSTOM';
	}

	// ---- UI Helpers ----

	private _addHeaderLink(parent: HTMLElement, text: string, onClick: () => void): void {
		const link = DOM.append(parent, DOM.$('a.settings-link'));
		link.textContent = text;
		link.style.cssText = 'color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;font-size:12px;text-decoration:none;';
		link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
		link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
		link.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
	}

	private _addSmallLink(parent: HTMLElement, text: string, onClick: () => void, danger = false): void {
		const link = DOM.append(parent, DOM.$('a'));
		link.textContent = text;
		link.style.cssText = `color:${danger ? 'var(--vscode-errorForeground,#f48771)' : 'var(--vscode-textLink-foreground,#3794ff)'};cursor:pointer;font-size:11px;text-decoration:none;`;
		link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
		link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
		link.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
	}

	override layout(dimension: DOM.Dimension): void {
		this.rootElement.style.height = `${dimension.height}px`;
		this.rootElement.style.width = `${dimension.width}px`;
	}
}
