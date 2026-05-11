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
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { LayoutSettingsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface TabItem {
	key: string;
	label: string;
	icon?: string;
	visible: boolean;
	position: number;
	fhirResources?: Array<string | { type?: string }>;
	display?: string;
	panel?: string;
}

interface TabCategory {
	key?: string;
	label: string;
	position: number;
	tabs: TabItem[];
}

interface AvailableTab {
	tabKey: string;
	label?: string;
	fhirResources?: Array<unknown>;
}

type Section = 'tab-manager' | 'field-config';

const SOURCE_LABELS: Record<string, string> = {
	'ORG_CUSTOM': 'Custom Config',
	'PRACTICE_TYPE_DEFAULT': 'Practice Default',
	'CLONED_FROM_DEFAULT': 'Cloned from Default',
	'UNIVERSAL_DEFAULT': 'Universal Default',
};

export class LayoutSettingsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexLayoutSettings';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private categories: TabCategory[] = [];
	private source: string = 'UNIVERSAL_DEFAULT';
	private availableTabs: AvailableTab[] = [];
	private activeSection: Section = 'tab-manager';
	private selectedFieldTab: string = '';
	private fieldConfig: Record<string, unknown> | null = null;
	private fieldConfigFhir: string[] = [];
	private _saving = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(LayoutSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.layout-settings-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';

		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1100px;margin:0 auto;padding:24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof LayoutSettingsEditorInput)) { return; }
		await this._load();
	}

	private async _load(): Promise<void> {
		this.contentEl.textContent = 'Loading layout settings\u2026';
		this.contentEl.style.color = 'var(--vscode-descriptionForeground)';
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/layout');
			if (res.ok) {
				const data = await res.json();
				this.categories = Array.isArray(data?.tabConfig) ? data.tabConfig : [];
				this.source = data?.source || 'UNIVERSAL_DEFAULT';
			}
			try {
				const tabsRes = await this.apiService.fetch('/api/tab-field-config/tabs');
				if (tabsRes.ok) {
					this.availableTabs = await tabsRes.json();
				}
			} catch { /* optional */ }
			this.contentEl.style.color = '';
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login\u2026';
		}
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		// Header
		const headerWrap = DOM.append(this.contentEl, DOM.$('.ls-header'));
		headerWrap.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';

		const headerLeft = DOM.append(headerWrap, DOM.$('div'));
		const title = DOM.append(headerLeft, DOM.$('h1'));
		title.textContent = '\u2699 Chart';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;display:flex;align-items:center;gap:6px;';
		const subtitle = DOM.append(headerLeft, DOM.$('p'));
		subtitle.textContent = 'Configure patient chart layout, tabs, and field mappings';
		subtitle.style.cssText = 'margin:0;font-size:13px;color:var(--vscode-descriptionForeground);';

		const headerRight = DOM.append(headerWrap, DOM.$('div'));
		headerRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const sourceBadge = DOM.append(headerRight, DOM.$('span'));
		sourceBadge.textContent = SOURCE_LABELS[this.source] || this.source;
		const isCustom = this.source === 'ORG_CUSTOM';
		sourceBadge.style.cssText = `padding:4px 10px;border-radius:999px;font-size:11px;font-weight:500;background:${isCustom ? 'rgba(14,99,156,0.15)' : 'rgba(128,128,128,0.15)'};color:${isCustom ? 'var(--vscode-textLink-foreground,#3794ff)' : 'var(--vscode-descriptionForeground)'};`;

		// Section tabs
		const sectionTabs = DOM.append(this.contentEl, DOM.$('.ls-section-tabs'));
		sectionTabs.style.cssText = 'display:flex;gap:4px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:16px;';
		this._sectionTab(sectionTabs, 'tab-manager', '\u{1F441} Tab Manager');
		this._sectionTab(sectionTabs, 'field-config', '\u{1F4D1} Field Configuration');

		if (this.activeSection === 'tab-manager') {
			this._renderTabManager();
		} else {
			this._renderFieldConfig();
		}
	}

	private _sectionTab(parent: HTMLElement, key: Section, label: string): void {
		const btn = DOM.append(parent, DOM.$('button'));
		btn.textContent = label;
		const isActive = this.activeSection === key;
		btn.style.cssText = `padding:8px 16px;background:transparent;border:none;border-bottom:2px solid ${isActive ? 'var(--vscode-focusBorder)' : 'transparent'};color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};cursor:pointer;font-size:13px;font-weight:500;margin-bottom:-1px;`;
		btn.addEventListener('click', () => { this.activeSection = key; this._render(); });
	}

	// allow-any-unicode-next-line
	// ─── Tab Manager ───────────────────────────────────────────────

	private _renderTabManager(): void {
		// Toolbar row
		const toolbar = DOM.append(this.contentEl, DOM.$('.ls-toolbar'));
		toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
		const toolTitle = DOM.append(toolbar, DOM.$('h3'));
		toolTitle.textContent = 'Manage Tabs';
		toolTitle.style.cssText = 'margin:0;font-size:15px;font-weight:600;';

		const actions = DOM.append(toolbar, DOM.$('div'));
		actions.style.cssText = 'display:flex;gap:8px;';

		const resetBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		resetBtn.textContent = '\u21BA Reset to Defaults';
		resetBtn.disabled = this._saving || this.source === 'UNIVERSAL_DEFAULT';
		resetBtn.style.cssText = 'padding:5px 12px;background:transparent;border:1px solid var(--vscode-button-border,var(--vscode-input-border,#3c3c3c));border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		if (resetBtn.disabled) { resetBtn.style.opacity = '0.5'; resetBtn.style.cursor = 'not-allowed'; }
		resetBtn.addEventListener('click', () => this._resetDefaults());

		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = this._saving ? 'Saving\u2026' : '\u{1F4BE} Save Changes';
		saveBtn.disabled = this._saving;
		saveBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', () => this._saveLayout());

		// Categories list
		if (this.categories.length === 0) {
			const empty = DOM.append(this.contentEl, DOM.$('.ls-empty'));
			empty.textContent = 'No groups configured. Click "Add Group" below to start.';
			empty.style.cssText = 'padding:40px 0;text-align:center;color:var(--vscode-descriptionForeground);';
		} else {
			for (let ci = 0; ci < this.categories.length; ci++) {
				this._renderCategory(ci);
			}
		}

		// "Add Group" button at the bottom
		const addGroupBtn = DOM.append(this.contentEl, DOM.$('button')) as HTMLButtonElement;
		addGroupBtn.textContent = '+ Add Group';
		addGroupBtn.style.cssText = 'display:block;width:100%;margin-top:12px;padding:10px;background:transparent;border:2px dashed var(--vscode-editorWidget-border);border-radius:8px;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;font-size:13px;font-weight:500;';
		addGroupBtn.addEventListener('mouseenter', () => { addGroupBtn.style.background = 'rgba(55,148,255,0.05)'; });
		addGroupBtn.addEventListener('mouseleave', () => { addGroupBtn.style.background = 'transparent'; });
		addGroupBtn.addEventListener('click', () => this._addCategory());
	}

	private _renderCategory(ci: number): void {
		const cat = this.categories[ci];

		const section = DOM.append(this.contentEl, DOM.$('.ls-category'));
		section.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:12px;overflow:hidden;';

		// Category header
		const head = DOM.append(section, DOM.$('.ls-cat-head'));
		head.style.cssText = 'display:flex;align-items:center;padding:10px 14px;background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);gap:10px;';

		// Move arrows
		const upBtn = DOM.append(head, DOM.$('button'));
		upBtn.textContent = '\u25B2';
		upBtn.title = 'Move up';
		upBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.6;font-size:11px;';
		upBtn.addEventListener('click', () => this._moveCategory(ci, -1));

		const downBtn = DOM.append(head, DOM.$('button'));
		downBtn.textContent = '\u25BC';
		downBtn.title = 'Move down';
		downBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.6;font-size:11px;';
		downBtn.addEventListener('click', () => this._moveCategory(ci, 1));

		// Editable label
		const labelInput = DOM.append(head, DOM.$('input')) as HTMLInputElement;
		labelInput.value = cat.label;
		labelInput.style.cssText = 'flex:1;padding:4px 8px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--vscode-foreground);font-size:14px;font-weight:600;outline:none;';
		labelInput.addEventListener('focus', () => { labelInput.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; labelInput.style.background = 'var(--vscode-input-background)'; });
		labelInput.addEventListener('blur', () => { labelInput.style.borderColor = 'transparent'; labelInput.style.background = 'transparent'; });
		labelInput.addEventListener('input', () => { cat.label = labelInput.value; });

		// Tab count
		const visible = cat.tabs.filter(t => t.visible).length;
		const count = DOM.append(head, DOM.$('span'));
		count.textContent = `${visible}/${cat.tabs.length} visible`;
		count.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		// Add tab
		const addTabBtn = DOM.append(head, DOM.$('button'));
		addTabBtn.textContent = '+';
		addTabBtn.title = 'Add tab';
		addTabBtn.style.cssText = 'background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;width:22px;height:22px;cursor:pointer;color:var(--vscode-foreground);font-size:12px;';
		addTabBtn.addEventListener('click', () => this._addTab(ci));

		// Delete category
		const delBtn = DOM.append(head, DOM.$('button'));
		delBtn.textContent = '\u{1F5D1}';
		delBtn.title = 'Delete category';
		delBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-errorForeground,#f48771);font-size:11px;';
		delBtn.addEventListener('click', () => this._deleteCategory(ci));

		// Tabs list
		for (let ti = 0; ti < cat.tabs.length; ti++) {
			this._renderTabRow(section, ci, ti);
		}
		if (cat.tabs.length === 0) {
			const empty = DOM.append(section, DOM.$('div'));
			empty.textContent = 'No tabs in this category.';
			empty.style.cssText = 'padding:14px;color:var(--vscode-descriptionForeground);font-size:12px;';
		}
	}

	private _renderTabRow(parent: HTMLElement, ci: number, ti: number): void {
		const tab = this.categories[ci].tabs[ti];
		const row = DOM.append(parent, DOM.$('.ls-tab-row'));
		row.style.cssText = `display:flex;align-items:center;padding:8px 14px;border-bottom:1px solid rgba(128,128,128,0.1);gap:10px;${tab.visible ? '' : 'opacity:0.5;'}`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		// Drag handle
		const grip = DOM.append(row, DOM.$('span'));
		grip.textContent = '\u22EE\u22EE';
		grip.style.cssText = 'opacity:0.3;font-size:11px;letter-spacing:-2px;';

		// Icon (text only)
		const icon = DOM.append(row, DOM.$('span'));
		icon.textContent = tab.icon || '\u{1F4C4}';
		icon.style.cssText = 'opacity:0.7;font-size:13px;';

		// Label
		const label = DOM.append(row, DOM.$('span'));
		label.textContent = tab.label;
		label.style.cssText = 'font-weight:500;flex:1;';

		// FHIR resource badges
		const fhirList = (tab.fhirResources || []).map(r => typeof r === 'string' ? r : (r?.type || ''));
		for (const r of fhirList.filter(Boolean)) {
			const badge = DOM.append(row, DOM.$('span'));
			badge.textContent = r;
			badge.style.cssText = 'background:rgba(14,99,156,0.15);color:var(--vscode-textLink-foreground,#3794ff);padding:1px 6px;border-radius:3px;font-size:10px;';
		}

		// Tab key
		const keyEl = DOM.append(row, DOM.$('code'));
		keyEl.textContent = tab.key;
		keyEl.style.cssText = 'background:rgba(128,128,128,0.1);color:var(--vscode-descriptionForeground);padding:1px 5px;border-radius:3px;font-size:10px;font-family:var(--vscode-editor-font-family,monospace);';

		// Move up
		const upBtn = DOM.append(row, DOM.$('button'));
		upBtn.textContent = '\u25B2';
		upBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.5;font-size:10px;';
		upBtn.addEventListener('click', () => this._moveTab(ci, ti, -1));

		// Move down
		const downBtn = DOM.append(row, DOM.$('button'));
		downBtn.textContent = '\u25BC';
		downBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.5;font-size:10px;';
		downBtn.addEventListener('click', () => this._moveTab(ci, ti, 1));

		// Edit
		const editBtn = DOM.append(row, DOM.$('button'));
		editBtn.textContent = '\u270F';
		editBtn.title = 'Edit tab';
		editBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-textLink-foreground,#3794ff);font-size:11px;';
		editBtn.addEventListener('click', () => this._editTab(ci, ti));

		// Visibility
		const visBtn = DOM.append(row, DOM.$('button'));
		visBtn.textContent = tab.visible ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}';
		visBtn.title = tab.visible ? 'Hide tab' : 'Show tab';
		visBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.7;font-size:11px;';
		visBtn.addEventListener('click', () => { tab.visible = !tab.visible; this._render(); });

		// Delete
		const delBtn = DOM.append(row, DOM.$('button'));
		delBtn.textContent = '\u{1F5D1}';
		delBtn.title = 'Delete tab';
		delBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-errorForeground,#f48771);font-size:11px;';
		delBtn.addEventListener('click', () => this._deleteTab(ci, ti));
	}

	private _inlineDialog(title: string, fields: Array<{ label: string; key: string; placeholder?: string; value?: string }>, onConfirm: (values: Record<string, string>) => void): void {
		const overlay = DOM.append(this.root, DOM.$('.ls-dialog-overlay'));
		overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('.ls-dialog'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:20px;min-width:340px;max-width:480px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
		const titleEl = DOM.append(dialog, DOM.$('h3'));
		titleEl.textContent = title;
		titleEl.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';
		const inputs: Record<string, HTMLInputElement> = {};
		for (const field of fields) {
			const wrap = DOM.append(dialog, DOM.$('div'));
			wrap.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(wrap, DOM.$('label'));
			lbl.textContent = field.label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			input.type = 'text';
			input.value = field.value || '';
			input.placeholder = field.placeholder || '';
			input.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
			inputs[field.key] = input;
		}
		const btnRow = DOM.append(dialog, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const confirmBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		confirmBtn.textContent = 'OK';
		confirmBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		const close = () => overlay.remove();
		cancelBtn.addEventListener('click', close);
		overlay.addEventListener('click', e => { if (e.target === overlay) { close(); } });
		confirmBtn.addEventListener('click', () => {
			const values: Record<string, string> = {};
			for (const [key, input] of Object.entries(inputs)) { values[key] = input.value.trim(); }
			close();
			onConfirm(values);
		});
		const inputArr = Object.values(inputs);
		if (inputArr.length > 0) { setTimeout(() => inputArr[0].focus(), 50); }
		inputArr[inputArr.length - 1]?.addEventListener('keydown', e => { if (e.key === 'Enter') { confirmBtn.click(); } });
	}

	private _moveCategory(ci: number, dir: number): void {
		const newIdx = ci + dir;
		if (newIdx < 0 || newIdx >= this.categories.length) { return; }
		[this.categories[ci], this.categories[newIdx]] = [this.categories[newIdx], this.categories[ci]];
		this.categories.forEach((c, i) => { c.position = i; });

		this._render();
	}

	private _moveTab(ci: number, ti: number, dir: number): void {
		const tabs = this.categories[ci].tabs;
		const newIdx = ti + dir;
		if (newIdx < 0 || newIdx >= tabs.length) { return; }
		[tabs[ti], tabs[newIdx]] = [tabs[newIdx], tabs[ti]];
		tabs.forEach((t, i) => { t.position = i; });

		this._render();
	}

	private _addCategory(): void {
		this._inlineDialog('Add Group', [
			{ label: 'Group Name', key: 'name', placeholder: 'e.g., Clinical' },
		], values => {
			if (!values.name) { return; }
			this.categories.push({
				key: values.name.toLowerCase().replace(/\s+/g, '-'),
				label: values.name,
				position: this.categories.length,
				tabs: [],
			});
			this._render();
		});
	}

	private async _deleteCategory(ci: number): Promise<void> {
		const cat = this.categories[ci];
		const { confirmed } = await this.dialogService.confirm({ message: `Delete category "${cat.label}" and all ${cat.tabs.length} tabs?` });
		if (!confirmed) { return; }
		this.categories.splice(ci, 1);
		this.categories.forEach((c, i) => { c.position = i; });

		this._render();
	}

	private _addTab(ci: number): void {
		this._inlineDialog('Add Tab', [
			{ label: 'Tab Key (e.g., vitals)', key: 'key', placeholder: 'vitals' },
			{ label: 'Tab Label', key: 'label', placeholder: 'Vitals' },
			{ label: 'FHIR Resource Type (optional)', key: 'fhir', placeholder: 'Observation' },
		], values => {
			if (!values.key) { return; }
			const label = values.label || (values.key.charAt(0).toUpperCase() + values.key.slice(1));
			const fhirResources = values.fhir ? values.fhir.split(',').map(s => s.trim()).filter(Boolean) : [];
			this.categories[ci].tabs.push({ key: values.key, label, icon: 'FileText', position: this.categories[ci].tabs.length, visible: true, fhirResources });
			this._render();
		});
	}

	private _editTab(ci: number, ti: number): void {
		const tab = this.categories[ci].tabs[ti];
		const fhirNames = (tab.fhirResources || []).map(r => typeof r === 'string' ? r : (r?.type || '')).filter(Boolean);
		this._inlineDialog('Edit Tab', [
			{ label: 'Tab Label', key: 'label', value: tab.label, placeholder: tab.label },
			{ label: 'Icon Name', key: 'icon', value: tab.icon || '', placeholder: 'FileText' },
			{ label: 'FHIR Resources (comma-separated)', key: 'fhir', value: fhirNames.join(', '), placeholder: 'Observation' },
		], values => {
			if (values.label) { tab.label = values.label; }
			tab.icon = values.icon;
			tab.fhirResources = values.fhir ? values.fhir.split(',').map(s => s.trim()).filter(Boolean) : [];
			this._render();
		});
	}

	private async _deleteTab(ci: number, ti: number): Promise<void> {
		const tab = this.categories[ci].tabs[ti];
		const { confirmed } = await this.dialogService.confirm({ message: `Delete tab "${tab.label}"?` });
		if (!confirmed) { return; }
		this.categories[ci].tabs.splice(ti, 1);
		this.categories[ci].tabs.forEach((t, i) => { t.position = i; });

		this._render();
	}

	private async _saveLayout(): Promise<void> {
		if (this._saving) { return; }
		this._saving = true;
		this._render();
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/layout', {
				method: 'PUT',
				body: JSON.stringify({ tabConfig: this.categories }),
			});
			if (res.ok) {
				this.source = 'ORG_CUSTOM';

				this.notificationService.notify({ severity: Severity.Info, message: 'Layout saved.' });
			} else {
				const err = await res.json().catch(() => null);
				this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
		this._saving = false;
		this._render();
	}

	private async _resetDefaults(): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: 'Reset to practice type defaults? Your custom tab layout will be removed.' });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/layout', { method: 'DELETE' });
			if (res.ok) {
				await this._load();
				this.notificationService.notify({ severity: Severity.Info, message: 'Reset to defaults.' });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Reset failed: ${e}` });
		}
	}

	// allow-any-unicode-next-line
	// ─── Field Configuration ───────────────────────────────────────────────

	private _renderFieldConfig(): void {
		const wrap = DOM.append(this.contentEl, DOM.$('.ls-fc'));
		wrap.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

		// Tab selector
		const selectorRow = DOM.append(wrap, DOM.$('.ls-fc-selector'));
		selectorRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
		const selLbl = DOM.append(selectorRow, DOM.$('label'));
		selLbl.textContent = 'Tab:';
		selLbl.style.cssText = 'font-size:12px;font-weight:500;';

		const select = DOM.append(selectorRow, DOM.$('select')) as HTMLSelectElement;
		select.style.cssText = 'padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:13px;cursor:pointer;min-width:240px;';
		const placeholder = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
		placeholder.value = '';
		placeholder.textContent = '\u2014 Select a tab \u2014';
		for (const t of this.availableTabs) {
			const opt = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			opt.value = t.tabKey;
			opt.textContent = t.label || t.tabKey;
			if (t.tabKey === this.selectedFieldTab) { opt.selected = true; }
		}
		select.addEventListener('change', () => { this.selectedFieldTab = select.value; this._loadFieldConfig(); });

		const saveFcBtn = DOM.append(selectorRow, DOM.$('button')) as HTMLButtonElement;
		saveFcBtn.textContent = this._saving ? 'Saving\u2026' : '\u{1F4BE} Save Fields';
		saveFcBtn.disabled = this._saving || !this.selectedFieldTab || !this.fieldConfig;
		saveFcBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		if (saveFcBtn.disabled) { saveFcBtn.style.opacity = '0.5'; }
		saveFcBtn.addEventListener('click', () => this._saveFieldConfig());

		// Render JSON editor / message
		const editorWrap = DOM.append(wrap, DOM.$('.ls-fc-editor'));
		editorWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		if (!this.selectedFieldTab) {
			const placeholder = DOM.append(editorWrap, DOM.$('div'));
			placeholder.textContent = 'Select a tab above to view and edit its field configuration.';
			placeholder.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
			return;
		}

		if (!this.fieldConfig) {
			const loading = DOM.append(editorWrap, DOM.$('div'));
			loading.textContent = 'Loading field config\u2026';
			loading.style.cssText = 'padding:24px;text-align:center;color:var(--vscode-descriptionForeground);';
			return;
		}

		// Show current FHIR resources
		const fhirRow = DOM.append(editorWrap, DOM.$('div'));
		fhirRow.style.cssText = 'padding:10px 14px;background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;display:flex;align-items:center;gap:8px;';
		const fhirLbl = DOM.append(fhirRow, DOM.$('span'));
		fhirLbl.textContent = 'FHIR Resources:';
		fhirLbl.style.cssText = 'font-weight:500;color:var(--vscode-descriptionForeground);';
		for (const r of this.fieldConfigFhir) {
			const badge = DOM.append(fhirRow, DOM.$('span'));
			badge.textContent = r;
			badge.style.cssText = 'background:rgba(14,99,156,0.15);color:var(--vscode-textLink-foreground,#3794ff);padding:1px 6px;border-radius:3px;font-size:10px;';
		}

		// JSON textarea editor
		const jsonArea = DOM.append(editorWrap, DOM.$('textarea')) as HTMLTextAreaElement;
		jsonArea.value = JSON.stringify(this.fieldConfig, null, 2);
		jsonArea.spellcheck = false;
		jsonArea.style.cssText = 'width:100%;min-height:420px;padding:12px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:none;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;resize:vertical;outline:none;line-height:1.5;box-sizing:border-box;';
		jsonArea.addEventListener('input', () => {
			try {
				this.fieldConfig = JSON.parse(jsonArea.value);

				jsonArea.style.borderLeft = '3px solid transparent';
			} catch {
				jsonArea.style.borderLeft = '3px solid var(--vscode-errorForeground,#f48771)';
			}
		});
	}

	private async _loadFieldConfig(): Promise<void> {
		this.fieldConfig = null;
		this.fieldConfigFhir = [];
		this._render();
		if (!this.selectedFieldTab) { return; }
		try {
			const res = await this.apiService.fetch(`/api/tab-field-config/${encodeURIComponent(this.selectedFieldTab)}`);
			if (res.ok) {
				const data = await res.json();
				this.fieldConfig = data?.fieldConfig || data?.data?.fieldConfig || {};
				const resources = data?.fhirResources || data?.data?.fhirResources || [];
				this.fieldConfigFhir = (resources as Array<unknown>).map(r => typeof r === 'string' ? r : ((r as { type?: string })?.type || '')).filter(Boolean);
				this._render();
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Failed to load field config (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Failed to load: ${e}` });
		}
	}

	private async _saveFieldConfig(): Promise<void> {
		if (!this.selectedFieldTab || !this.fieldConfig || this._saving) { return; }
		this._saving = true;
		this._render();
		try {
			const res = await this.apiService.fetch(`/api/tab-field-config/${encodeURIComponent(this.selectedFieldTab)}`, {
				method: 'PUT',
				body: JSON.stringify({ fieldConfig: this.fieldConfig }),
			});
			if (res.ok) {

				this.notificationService.notify({ severity: Severity.Info, message: 'Field config saved.' });
			} else {
				const err = await res.json().catch(() => null);
				this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
		this._saving = false;
		this._render();
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
