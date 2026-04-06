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
];

export class LayoutEditor extends EditorPane {

	static readonly ID = 'workbench.editor.ciyexLayout';

	private rootElement!: HTMLElement;
	private settingsBody!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private config: LayoutConfig = { source: 'UNIVERSAL_DEFAULT', categories: [] };
	private _dirty = false;

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
		DOM.clearNode(this.settingsBody);

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

		// Tab settings rows
		for (let ti = 0; ti < cat.tabs.length; ti++) {
			this._renderTabSetting(section, cat.tabs[ti], ci, ti);
		}
	}

	private _renderTabSetting(parent: HTMLElement, tab: TabDef, ci: number, ti: number): void {
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
	}

	// ---- CRUD Operations ----

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

	private _editCategory(ci: number): void {
		const cat = this.config.categories[ci];
		const name = globalThis.prompt?.('Category name:', cat.label);
		if (name === null || name === undefined) { return; }
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
		const key = globalThis.prompt?.('Tab key (e.g., vitals):');
		if (!key) { return; }
		const label = globalThis.prompt?.('Tab label:', key.charAt(0).toUpperCase() + key.slice(1));
		if (!label) { return; }
		const catNames = this.config.categories.map(c => c.label).join(', ');
		const catName = globalThis.prompt?.(`Category (${catNames}):`, this.config.categories[0].label);
		const cat = this.config.categories.find(c => c.label === catName) || this.config.categories[0];
		const fhirStr = globalThis.prompt?.(`FHIR Resources (comma-separated):\nAvailable: ${FHIR_RESOURCES.slice(0, 10).join(', ')}...`, 'Patient');
		const fhirResources = fhirStr ? fhirStr.split(',').map(s => s.trim()).filter(Boolean) : [];
		cat.tabs.push({ key, label, icon: 'FileText', position: cat.tabs.length, visible: true, fhirResources });
		this._markDirty();
		this._render();
	}

	private _editTab(ci: number, ti: number): void {
		const tab = this.config.categories[ci].tabs[ti];
		const label = globalThis.prompt?.('Tab label:', tab.label);
		if (label === null || label === undefined) { return; }
		tab.label = label;
		const icon = globalThis.prompt?.('Icon name:', tab.icon);
		if (icon) { tab.icon = icon; }
		const key = globalThis.prompt?.('Tab key:', tab.key);
		if (key) { tab.key = key; }
		const fhirStr = globalThis.prompt?.('FHIR Resources (comma-separated):', tab.fhirResources.join(', '));
		if (fhirStr !== null && fhirStr !== undefined) {
			tab.fhirResources = fhirStr.split(',').map(s => s.trim()).filter(Boolean);
		}
		this._markDirty();
		this._render();
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
		const sections = this.settingsBody.querySelectorAll('.settings-section');
		for (const section of sections) {
			const items = section.querySelectorAll('.setting-item');
			let anyVisible = false;
			for (const item of items) {
				const key = (item as HTMLElement).dataset.key || '';
				const text = item.textContent?.toLowerCase() || '';
				const match = !query || text.includes(query) || key.includes(query);
				(item as HTMLElement).style.display = match ? '' : 'none';
				if (match) { anyVisible = true; }
			}
			(section as HTMLElement).style.display = anyVisible || !query ? '' : 'none';
		}
	}

	// ---- Save / JSON toggle ----

	private async _save(): Promise<void> {
		const input = this.input as CiyexConfigEditorInput;
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
		const input = this.input as CiyexConfigEditorInput;
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
