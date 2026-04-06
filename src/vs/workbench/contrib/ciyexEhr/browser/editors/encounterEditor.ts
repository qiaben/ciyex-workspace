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
import { BaseCiyexInput } from './ciyexEditorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; [k: string]: unknown }
interface SectionDef { key: string; title: string; columns?: number; visible?: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[]; sectionComponent?: string; [k: string]: unknown }
interface EncounterConfig { tabKey: string; source: string; sections: SectionDef[] }

export class EncounterEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexEncounter';
	private root!: HTMLElement;
	private body!: HTMLElement;
	private config: EncounterConfig = { tabKey: 'encounter-form', source: 'UNIVERSAL_DEFAULT', sections: [] };
	private _dirty = false;
	get dirty(): boolean { return this._dirty; }

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService,
		@IFileService private readonly fileService: IFileService, @IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService, @IDialogService private readonly dialogService: IDialogService) {
		super(EncounterEditor.ID, group, t, th, s);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-settings-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';
		const header = DOM.append(this.root, DOM.$('.header'));
		header.style.cssText = 'padding:12px 24px;max-width:1000px;width:100%;margin:0 auto;';
		const tb = DOM.append(header, DOM.$('.tb'));
		tb.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const t = DOM.append(tb, DOM.$('span'));
		t.textContent = 'Encounter Form';
		t.style.cssText = 'font-weight:600;font-size:14px;flex:1;';
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
		if (this.config.sections.length === 0) {
			const e = DOM.append(this.body, DOM.$('p'));
			e.textContent = 'No sections. Click "Add Section" to start.';
			e.style.cssText = 'color:var(--vscode-descriptionForeground);padding:40px 0;text-align:center;';
			return;
		}
		for (let i = 0; i < this.config.sections.length; i++) { this._renderSection(i); }
	}

	private _renderSection(si: number): void {
		const sec = this.config.sections[si];
		const row = DOM.append(this.body, DOM.$('.setting-item'));
		row.style.cssText = `padding:10px 16px;display:flex;gap:16px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:flex-start;${sec.visible === false ? 'opacity:0.45;' : ''}`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		const info = DOM.append(row, DOM.$('.info'));
		info.style.cssText = 'flex:1;';
		const name = DOM.append(info, DOM.$('span'));
		name.textContent = sec.title;
		name.style.cssText = 'font-weight:500;';
		const desc = DOM.append(info, DOM.$('div'));
		desc.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		desc.textContent = `${sec.fields.length} fields \u00B7 ${sec.columns || 1} columns${sec.collapsible ? ' \u00B7 Collapsible' : ''}${sec.collapsed ? ' (collapsed)' : ''}`;

		const ctrl = DOM.append(row, DOM.$('.ctrl'));
		ctrl.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

		// Visible checkbox
		const vl = DOM.append(ctrl, DOM.$('label'));
		vl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground);cursor:pointer;';
		const vc = DOM.append(vl, DOM.$('input')) as HTMLInputElement;
		vc.type = 'checkbox'; vc.checked = sec.visible !== false;
		vc.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
		vc.addEventListener('change', () => { sec.visible = vc.checked; this._dirty = true; this._render(); });
		DOM.append(vl, DOM.$('span')).textContent = 'Visible';

		// Columns dropdown
		const cl = DOM.append(ctrl, DOM.$('label'));
		cl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground);';
		DOM.append(cl, DOM.$('span')).textContent = 'Cols';
		const cs = DOM.append(cl, DOM.$('select')) as HTMLSelectElement;
		cs.style.cssText = 'padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:12px;';
		for (const n of [1, 2, 3, 4]) { const o = DOM.append(cs, DOM.$('option')) as HTMLOptionElement; o.value = String(n); o.textContent = String(n); o.selected = (sec.columns || 1) === n; }
		cs.addEventListener('change', () => { sec.columns = parseInt(cs.value); this._dirty = true; });

		// Collapsible checkbox
		const col = DOM.append(ctrl, DOM.$('label'));
		col.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground);cursor:pointer;';
		const colc = DOM.append(col, DOM.$('input')) as HTMLInputElement;
		colc.type = 'checkbox'; colc.checked = !!sec.collapsible;
		colc.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
		colc.addEventListener('change', () => { sec.collapsible = colc.checked; if (!colc.checked) { sec.collapsed = false; } this._dirty = true; this._render(); });
		DOM.append(col, DOM.$('span')).textContent = 'Collapsible';

		// Position
		const pl = DOM.append(ctrl, DOM.$('label'));
		pl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground);';
		DOM.append(pl, DOM.$('span')).textContent = 'Pos';
		const pi = DOM.append(pl, DOM.$('input')) as HTMLInputElement;
		pi.type = 'number'; pi.value = String(si); pi.min = '0'; pi.max = String(this.config.sections.length - 1);
		pi.style.cssText = 'width:40px;padding:2px 4px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:12px;text-align:center;';
		pi.addEventListener('change', () => { const n = parseInt(pi.value); if (!isNaN(n) && n !== si && n >= 0 && n < this.config.sections.length) { const [s] = this.config.sections.splice(si, 1); this.config.sections.splice(n, 0, s); this._dirty = true; this._render(); } });

		this._slink(ctrl, 'Edit', () => this._editSection(si));
		this._slink(ctrl, 'Delete', () => this._deleteSection(si), true);
	}

	private _addSection(): void {
		const title = globalThis.prompt?.('Section title:');
		if (!title) { return; }
		this.config.sections.push({ key: title.toLowerCase().replace(/\s+/g, '-'), title, columns: 1, visible: true, collapsible: true, fields: [] });
		this._dirty = true; this._render();
	}

	private _editSection(si: number): void {
		const sec = this.config.sections[si];
		const title = globalThis.prompt?.('Section title:', sec.title);
		if (title !== null && title !== undefined) { sec.title = title; sec.key = title.toLowerCase().replace(/\s+/g, '-'); this._dirty = true; this._render(); }
	}

	private async _deleteSection(si: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete section "${this.config.sections[si].title}"?` });
		if (!confirmed) { return; }
		this.config.sections.splice(si, 1);
		this._dirty = true; this._render();
	}

	private async _save(): Promise<void> {
		const input = this.input as BaseCiyexInput;
		if (!input) { return; }
		try { await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2))); this._dirty = false; this.notificationService.notify({ severity: Severity.Info, message: 'Encounter form saved.' }); }
		catch (e) { this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` }); }
	}

	private _openJson(): void { const i = this.input as BaseCiyexInput; if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); } }
	private _link(p: HTMLElement, t: string, fn: () => void): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;'; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	private _slink(p: HTMLElement, t: string, fn: () => void, d = false): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = `color:${d ? 'var(--vscode-errorForeground)' : 'var(--vscode-textLink-foreground)'};cursor:pointer;font-size:11px;`; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
