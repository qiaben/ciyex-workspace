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

interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; fhirMapping?: { resource: string; path: string; type: string; [k: string]: unknown }; validation?: Record<string, unknown>; options?: Array<{ label: string; value: string }>; [k: string]: unknown }
interface SectionDef { key: string; title: string; columns?: number; visible?: boolean; collapsible?: boolean; fields: FieldDef[] }
interface FieldConfig { tabKey: string; fhirResources: string[]; sections: SectionDef[] }

const FIELD_TYPES = ['text', 'number', 'date', 'datetime', 'select', 'multiselect', 'checkbox', 'radio', 'textarea', 'phone', 'email', 'boolean', 'toggle', 'lookup', 'coded', 'quantity', 'file', 'computed', 'combobox', 'code-lookup', 'diagnosis-list', 'plan-items', 'ros-grid', 'exam-grid', 'family-history-list', 'address', 'group'];

export class FieldConfigEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexFieldConfig';
	private root!: HTMLElement;
	private body!: HTMLElement;
	private config: FieldConfig = { tabKey: '', fhirResources: [], sections: [] };
	private _dirty = false;
	get dirty(): boolean { return this._dirty; }

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService,
		@IFileService private readonly fileService: IFileService, @IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService, @IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService) {
		super(FieldConfigEditor.ID, group, t, th, s);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-settings-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';
		const header = DOM.append(this.root, DOM.$('.h'));
		header.style.cssText = 'padding:12px 24px;max-width:1000px;width:100%;margin:0 auto;';
		const tb = DOM.append(header, DOM.$('.tb'));
		tb.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const tl = DOM.append(tb, DOM.$('span'));
		tl.textContent = 'Field Configuration';
		tl.style.cssText = 'font-weight:600;font-size:14px;flex:1;';
		this._link(tb, 'Add Section', () => this._addSection());
		this._link(tb, 'Save', () => this._save());
		this._link(tb, 'Open JSON', () => this._openJson());
		const bc = DOM.append(this.root, DOM.$('.bc'));
		bc.style.cssText = 'flex:1;overflow-y:auto;';
		this.body = DOM.append(bc, DOM.$('.b'));
		this.body.style.cssText = 'max-width:1000px;width:100%;margin:0 auto;padding:0 24px 24px;';
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		try { const c = await this.fileService.readFile(input.fileUri); this.config = JSON.parse(c.value.toString()); } catch { /* defaults */ }
		if (!token.isCancellationRequested) { this._render(); }
	}

	private _render(): void {
		DOM.clearNode(this.body);

		// FHIR resources bar
		const fbar = DOM.append(this.body, DOM.$('.fbar'));
		fbar.style.cssText = 'padding:12px 0;font-size:12px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
		DOM.append(fbar, DOM.$('span')).textContent = `Tab: ${this.config.tabKey} \u00B7 FHIR Resources:`;
		for (const r of this.config.fhirResources) {
			const b = DOM.append(fbar, DOM.$('span'));
			b.textContent = r;
			b.style.cssText = 'background:rgba(14,99,156,0.15);color:var(--vscode-textLink-foreground);padding:1px 6px;border-radius:3px;font-size:10px;';
		}

		for (let si = 0; si < this.config.sections.length; si++) {
			this._renderSection(si);
		}
	}

	private _renderSection(si: number): void {
		const sec = this.config.sections[si];

		// Section header
		const sh = DOM.append(this.body, DOM.$('.sh'));
		sh.style.cssText = 'display:flex;align-items:center;padding:14px 0 6px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:4px;gap:8px;';
		const st = DOM.append(sh, DOM.$('h3'));
		st.textContent = `${sec.title} (${sec.fields.length} fields, ${sec.columns || 1} cols)`;
		st.style.cssText = 'margin:0;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-settings-headerForeground);flex:1;';
		this._slink(sh, 'Add Field', () => this._addField(si));
		this._slink(sh, 'Edit', () => this._editSection(si));
		this._slink(sh, '\u25B2', () => this._moveSection(si, -1));
		this._slink(sh, '\u25BC', () => this._moveSection(si, 1));
		this._slink(sh, 'Delete', () => this._deleteSection(si), true);

		// Fields
		for (let fi = 0; fi < sec.fields.length; fi++) {
			this._renderField(sec.fields[fi], si, fi);
		}
	}

	private _renderField(field: FieldDef, si: number, fi: number): void {
		const row = DOM.append(this.body, DOM.$('.setting-item'));
		row.style.cssText = 'padding:8px 16px;display:flex;gap:16px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:flex-start;';
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		const info = DOM.append(row, DOM.$('.info'));
		info.style.cssText = 'flex:1;';

		const nameRow = DOM.append(info, DOM.$('.nr'));
		nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px;';
		const n = DOM.append(nameRow, DOM.$('span'));
		n.textContent = field.label;
		n.style.cssText = 'font-weight:500;';
		if (field.required) { const r = DOM.append(nameRow, DOM.$('span')); r.textContent = '*'; r.style.cssText = 'color:var(--vscode-errorForeground);'; }
		const k = DOM.append(nameRow, DOM.$('code'));
		k.textContent = field.key;
		k.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:3px;';
		const tb = DOM.append(nameRow, DOM.$('span'));
		tb.textContent = field.type;
		tb.style.cssText = 'background:rgba(128,128,128,0.15);color:var(--vscode-descriptionForeground);padding:1px 6px;border-radius:3px;font-size:10px;';

		const desc = DOM.append(info, DOM.$('.d'));
		desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);display:flex;gap:6px;flex-wrap:wrap;';
		if (field.colSpan && field.colSpan > 1) { DOM.append(desc, DOM.$('span')).textContent = `span:${field.colSpan}`; }
		if (field.fhirMapping) { const fb = DOM.append(desc, DOM.$('span')); fb.textContent = `${field.fhirMapping.resource}.${field.fhirMapping.path}`; fb.style.cssText = 'color:var(--vscode-textLink-foreground);font-size:10px;'; }
		if (field.placeholder) { DOM.append(desc, DOM.$('span')).textContent = `"${field.placeholder}"`; }

		const ctrl = DOM.append(row, DOM.$('.ctrl'));
		ctrl.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';
		this._slink(ctrl, 'Edit', () => this._editField(si, fi));
		this._slink(ctrl, '\u25B2', () => this._moveField(si, fi, -1));
		this._slink(ctrl, '\u25BC', () => this._moveField(si, fi, 1));
		this._slink(ctrl, 'Delete', () => this._deleteField(si, fi), true);
	}

	// --- CRUD ---
	private async _addSection(): Promise<void> {
		const title = await this.quickInputService.input({ prompt: 'Section title:' });
		if (!title) { return; }
		this.config.sections.push({ key: title.toLowerCase().replace(/\s+/g, '_'), title, columns: 2, visible: true, fields: [] });
		this._dirty = true; this._render();
	}

	private async _editSection(si: number): Promise<void> {
		const s = this.config.sections[si];
		const title = await this.quickInputService.input({ prompt: 'Section title:', value: s.title });
		if (title !== null && title !== undefined) { s.title = title; s.key = title.toLowerCase().replace(/\s+/g, '_'); }
		const cols = await this.quickInputService.input({ prompt: 'Columns (1-4):', value: String(s.columns || 1) });
		if (cols) { s.columns = parseInt(cols) || 1; }
		this._dirty = true; this._render();
	}

	private _moveSection(si: number, dir: number): void {
		const ni = si + dir;
		if (ni < 0 || ni >= this.config.sections.length) { return; }
		[this.config.sections[si], this.config.sections[ni]] = [this.config.sections[ni], this.config.sections[si]];
		this._dirty = true; this._render();
	}

	private async _deleteSection(si: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete section "${this.config.sections[si].title}" and all its fields?` });
		if (!confirmed) { return; }
		this.config.sections.splice(si, 1);
		this._dirty = true; this._render();
	}

	private async _addField(si: number): Promise<void> {
		const key = await this.quickInputService.input({ prompt: 'Field key:' });
		if (!key) { return; }
		const label = await this.quickInputService.input({ prompt: 'Field label:', value: key });
		if (!label) { return; }
		const type = await this.quickInputService.input({ prompt: `Field type (${FIELD_TYPES.slice(0, 8).join(', ')}...)`, value: 'text' });
		if (!type) { return; }
		const req = true;
		const fhirRes = await this.quickInputService.input({ prompt: 'FHIR resource (or leave blank):' });
		const fhirPath = fhirRes ? await this.quickInputService.input({ prompt: 'FHIR path:' }) : null;
		const field: FieldDef = { key, label, type, required: req, colSpan: 1 };
		if (fhirRes && fhirPath) { field.fhirMapping = { resource: fhirRes, path: fhirPath, type: 'string' }; }
		this.config.sections[si].fields.push(field);
		this._dirty = true; this._render();
	}

	private async _editField(si: number, fi: number): Promise<void> {
		const f = this.config.sections[si].fields[fi];
		const label = await this.quickInputService.input({ prompt: 'Label:', value: f.label });
		if (label !== null && label !== undefined) { f.label = label; }
		const type = await this.quickInputService.input({ prompt: 'Type:', value: f.type });
		if (type) { f.type = type; }
		const key = await this.quickInputService.input({ prompt: 'Key:', value: f.key });
		if (key) { f.key = key; }
		const colSpan = await this.quickInputService.input({ prompt: 'Column span:', value: String(f.colSpan || 1) });
		if (colSpan) { f.colSpan = parseInt(colSpan) || 1; }
		const fhirRes = await this.quickInputService.input({ prompt: 'FHIR resource:', value: f.fhirMapping?.resource || '' });
		if (fhirRes) {
			const fhirPath = await this.quickInputService.input({ prompt: 'FHIR path:', value: f.fhirMapping?.path || '' });
			if (fhirPath) { f.fhirMapping = { resource: fhirRes, path: fhirPath, type: f.fhirMapping?.type || 'string' }; }
		}
		this._dirty = true; this._render();
	}

	private _moveField(si: number, fi: number, dir: number): void {
		const fields = this.config.sections[si].fields;
		const ni = fi + dir;
		if (ni < 0 || ni >= fields.length) { return; }
		[fields[fi], fields[ni]] = [fields[ni], fields[fi]];
		this._dirty = true; this._render();
	}

	private async _deleteField(si: number, fi: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete field "${this.config.sections[si].fields[fi].label}"?` });
		if (!confirmed) { return; }
		this.config.sections[si].fields.splice(fi, 1);
		this._dirty = true; this._render();
	}

	private async _save(): Promise<void> {
		const input = this.input as BaseCiyexInput;
		if (!input) { return; }
		try { await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2))); this._dirty = false; this.notificationService.notify({ severity: Severity.Info, message: 'Field config saved.' }); }
		catch (e) { this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` }); }
	}
	private _openJson(): void { const i = this.input as BaseCiyexInput; if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); } }
	private _link(p: HTMLElement, t: string, fn: () => void): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;'; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	private _slink(p: HTMLElement, t: string, fn: () => void, d = false): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = `color:${d ? 'var(--vscode-errorForeground)' : 'var(--vscode-textLink-foreground)'};cursor:pointer;font-size:11px;`; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
