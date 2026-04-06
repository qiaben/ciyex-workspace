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
import { BaseCiyexInput } from './ciyexEditorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface ColorEntry { entityKey: string; entityLabel: string; bgColor: string; borderColor: string; textColor: string }
interface ColorCategory { key: string; label: string; colors: ColorEntry[] }
interface ColorsConfig { categories: ColorCategory[] }

export class ColorsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexColors';
	private root!: HTMLElement; private body!: HTMLElement; private config: ColorsConfig = { categories: [] }; private _dirty = false;
	get dirty(): boolean { return this._dirty; }

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService,
		@IFileService private readonly fileService: IFileService, @IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService) {
		super(ColorsEditor.ID, group, t, th, s);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-settings-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';
		const header = DOM.append(this.root, DOM.$('.h')); header.style.cssText = 'padding:12px 24px;max-width:1000px;width:100%;margin:0 auto;';
		const tb = DOM.append(header, DOM.$('.tb')); tb.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		DOM.append(tb, DOM.$('span')).textContent = 'Calendar Colors'; (tb.lastChild as HTMLElement).style.cssText = 'font-weight:600;font-size:14px;flex:1;';
		this._link(tb, 'Add Color', () => this._addColor()); this._link(tb, 'Save', () => this._save()); this._link(tb, 'Open JSON', () => this._openJson());
		const bc = DOM.append(this.root, DOM.$('.bc')); bc.style.cssText = 'flex:1;overflow-y:auto;';
		this.body = DOM.append(bc, DOM.$('.b')); this.body.style.cssText = 'max-width:1000px;width:100%;margin:0 auto;padding:0 24px 24px;';
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		try { const c = await this.fileService.readFile(input.fileUri); this.config = JSON.parse(c.value.toString()); } catch { /* defaults */ }
		if (!token.isCancellationRequested) { this._render(); }
	}

	private _render(): void {
		DOM.clearNode(this.body);
		for (let ci = 0; ci < this.config.categories.length; ci++) {
			const cat = this.config.categories[ci];
			const sh = DOM.append(this.body, DOM.$('.sh'));
			sh.style.cssText = 'display:flex;align-items:center;padding:14px 0 6px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:4px;gap:8px;';
			const st = DOM.append(sh, DOM.$('h3')); st.textContent = cat.label; st.style.cssText = 'margin:0;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;flex:1;';
			this._slink(sh, 'Add', () => this._addColorToCategory(ci));

			for (let ei = 0; ei < cat.colors.length; ei++) {
				const entry = cat.colors[ei];
				const row = DOM.append(this.body, DOM.$('.setting-item'));
				row.style.cssText = 'padding:8px 16px;display:flex;gap:16px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:center;';
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
				row.addEventListener('mouseleave', () => { row.style.background = ''; });

				// Color swatch
				const swatch = DOM.append(row, DOM.$('div'));
				swatch.style.cssText = `width:28px;height:28px;border-radius:4px;background:${entry.bgColor};border:1px solid ${entry.borderColor || 'rgba(128,128,128,0.3)'};flex-shrink:0;`;

				// Label
				const info = DOM.append(row, DOM.$('.info')); info.style.cssText = 'flex:1;';
				const n = DOM.append(info, DOM.$('span')); n.textContent = entry.entityLabel; n.style.cssText = 'font-weight:500;';
				const k = DOM.append(info, DOM.$('span')); k.textContent = ` (${entry.entityKey})`; k.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

				// Color inputs
				const ctrl = DOM.append(row, DOM.$('.ctrl')); ctrl.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

				const bgInput = DOM.append(ctrl, DOM.$('input')) as HTMLInputElement;
				bgInput.type = 'color'; bgInput.value = entry.bgColor;
				bgInput.style.cssText = 'width:30px;height:24px;border:none;background:none;cursor:pointer;padding:0;';
				bgInput.addEventListener('input', () => { entry.bgColor = bgInput.value; swatch.style.background = bgInput.value; this._dirty = true; });

				const hexInput = DOM.append(ctrl, DOM.$('input')) as HTMLInputElement;
				hexInput.type = 'text'; hexInput.value = entry.bgColor;
				hexInput.style.cssText = 'width:75px;padding:2px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;font-family:monospace;';
				hexInput.addEventListener('change', () => { entry.bgColor = hexInput.value; bgInput.value = hexInput.value; swatch.style.background = hexInput.value; this._dirty = true; });

				// Preview text
				const preview = DOM.append(ctrl, DOM.$('span'));
				preview.textContent = 'Aa';
				preview.style.cssText = `background:${entry.bgColor};color:${entry.textColor || '#fff'};padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;`;

				this._slink(ctrl, 'Delete', () => { cat.colors.splice(ei, 1); this._dirty = true; this._render(); }, true);
			}
		}
	}

	private _addColor(): void {
		if (this.config.categories.length === 0) {
			this.config.categories.push({ key: 'visit-type', label: 'Visit Types', colors: [] }, { key: 'provider', label: 'Providers', colors: [] }, { key: 'location', label: 'Locations', colors: [] });
			this._dirty = true;
		}
		this._addColorToCategory(0);
	}

	private _addColorToCategory(ci: number): void {
		const label = globalThis.prompt?.('Entity name (e.g., "New Patient"):');
		if (!label) { return; }
		const color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
		const lum = this._luminance(color);
		this.config.categories[ci].colors.push({ entityKey: label.toLowerCase().replace(/\s+/g, '-'), entityLabel: label, bgColor: color, borderColor: color, textColor: lum > 0.5 ? '#000000' : '#ffffff' });
		this._dirty = true; this._render();
	}

	private _luminance(hex: string): number {
		const r = parseInt(hex.slice(1, 3), 16) / 255;
		const g = parseInt(hex.slice(3, 5), 16) / 255;
		const b = parseInt(hex.slice(5, 7), 16) / 255;
		return 0.299 * r + 0.587 * g + 0.114 * b;
	}

	private async _save(): Promise<void> {
		const input = this.input as BaseCiyexInput; if (!input) { return; }
		try { await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2))); this._dirty = false; this.notificationService.notify({ severity: Severity.Info, message: 'Colors saved.' }); }
		catch (e) { this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` }); }
	}
	private _openJson(): void { const i = this.input as BaseCiyexInput; if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); } }
	private _link(p: HTMLElement, t: string, fn: () => void): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;'; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	private _slink(p: HTMLElement, t: string, fn: () => void, d = false): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = `color:${d ? 'var(--vscode-errorForeground)' : 'var(--vscode-textLink-foreground)'};cursor:pointer;font-size:11px;`; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
