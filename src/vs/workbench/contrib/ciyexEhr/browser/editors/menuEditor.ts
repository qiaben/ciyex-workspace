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

interface MenuItem { itemKey: string; label: string; icon: string; screenSlug?: string; position: number; visible: boolean; requiredPermission?: string; fhirResources?: string[]; children?: MenuItem[] }
interface MenuConfig { items: MenuItem[] }

export class MenuEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexMenu';
	private root!: HTMLElement; private body!: HTMLElement; private config: MenuConfig = { items: [] }; private _dirty = false;
	get dirty(): boolean { return this._dirty; }

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService,
		@IFileService private readonly fileService: IFileService, @IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService, @IDialogService private readonly dialogService: IDialogService) {
		super(MenuEditor.ID, group, t, th, s);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-settings-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';
		const header = DOM.append(this.root, DOM.$('.h')); header.style.cssText = 'padding:12px 24px;max-width:1000px;width:100%;margin:0 auto;';
		const tb = DOM.append(header, DOM.$('.tb')); tb.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		DOM.append(tb, DOM.$('span')).textContent = 'Menu Configuration'; (tb.lastChild as HTMLElement).style.cssText = 'font-weight:600;font-size:14px;flex:1;';
		this._link(tb, 'Add Item', () => this._addItem()); this._link(tb, 'Save', () => this._save()); this._link(tb, 'Open JSON', () => this._openJson());
		const bc = DOM.append(this.root, DOM.$('.bc')); bc.style.cssText = 'flex:1;overflow-y:auto;';
		this.body = DOM.append(bc, DOM.$('.b')); this.body.style.cssText = 'max-width:1000px;width:100%;margin:0 auto;padding:0 24px 24px;';
	}

	override async setInput(input: CiyexConfigEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		try { const c = await this.fileService.readFile(input.fileUri); this.config = JSON.parse(c.value.toString()); } catch { /* defaults */ }
		if (!token.isCancellationRequested) { this._render(); }
	}

	private _render(): void {
		DOM.clearNode(this.body);
		this._renderItems(this.config.items, this.body, 0);
	}

	private _renderItems(items: MenuItem[], parent: HTMLElement, depth: number): void {
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const row = DOM.append(parent, DOM.$('.setting-item'));
			row.style.cssText = `padding:8px 16px;padding-left:${16 + depth * 20}px;display:flex;gap:16px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:center;${item.visible === false ? 'opacity:0.45;' : ''}`;
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const info = DOM.append(row, DOM.$('.info')); info.style.cssText = 'flex:1;';
			const nr = DOM.append(info, DOM.$('.nr')); nr.style.cssText = 'display:flex;align-items:center;gap:6px;';
			if (depth > 0) { const indent = DOM.append(nr, DOM.$('span')); indent.textContent = '\u2514'; indent.style.cssText = 'color:var(--vscode-descriptionForeground);'; }
			const n = DOM.append(nr, DOM.$('span')); n.textContent = item.label; n.style.cssText = `font-weight:${item.children && item.children.length > 0 ? '600' : '400'};`;
			const ic = DOM.append(nr, DOM.$('code')); ic.textContent = item.icon || ''; ic.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:3px;';
			if (item.screenSlug) { const sl = DOM.append(nr, DOM.$('span')); sl.textContent = item.screenSlug; sl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-family:monospace;'; }
			if (item.requiredPermission) { const p = DOM.append(nr, DOM.$('span')); p.textContent = item.requiredPermission; p.style.cssText = 'background:rgba(204,167,0,0.15);color:#cca700;padding:1px 6px;border-radius:3px;font-size:10px;'; }

			const ctrl = DOM.append(row, DOM.$('.ctrl')); ctrl.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';
			const vl = DOM.append(ctrl, DOM.$('label')); vl.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground);cursor:pointer;';
			const vc = DOM.append(vl, DOM.$('input')) as HTMLInputElement; vc.type = 'checkbox'; vc.checked = item.visible !== false; vc.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
			vc.addEventListener('change', () => { item.visible = vc.checked; this._dirty = true; this._render(); });
			DOM.append(vl, DOM.$('span')).textContent = 'Visible';

			this._slink(ctrl, 'Edit', () => this._editItem(items, i));
			this._slink(ctrl, '\u25B2', () => { if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; items.forEach((m, j) => { m.position = j; }); this._dirty = true; this._render(); } });
			this._slink(ctrl, '\u25BC', () => { if (i < items.length - 1) { [items[i], items[i + 1]] = [items[i + 1], items[i]]; items.forEach((m, j) => { m.position = j; }); this._dirty = true; this._render(); } });
			this._slink(ctrl, 'Delete', () => this._deleteItem(items, i), true);

			if (item.children && item.children.length > 0) { this._renderItems(item.children, parent, depth + 1); }
		}
	}

	private _addItem(): void {
		const label = globalThis.prompt?.('Menu item label:'); if (!label) { return; }
		const icon = globalThis.prompt?.('Icon:', 'FileText') || 'FileText';
		const slug = globalThis.prompt?.('Screen slug (e.g., /calendar):') || '';
		this.config.items.push({ itemKey: label.toLowerCase().replace(/\s+/g, '-'), label, icon, screenSlug: slug || undefined, position: this.config.items.length, visible: true, children: [] });
		this._dirty = true; this._render();
	}

	private _editItem(items: MenuItem[], i: number): void {
		const item = items[i];
		const label = globalThis.prompt?.('Label:', item.label); if (label !== null && label !== undefined) { item.label = label; }
		const icon = globalThis.prompt?.('Icon:', item.icon); if (icon) { item.icon = icon; }
		const slug = globalThis.prompt?.('Screen slug:', item.screenSlug || ''); if (slug !== null && slug !== undefined) { item.screenSlug = slug || undefined; }
		const perm = globalThis.prompt?.('Required permission:', item.requiredPermission || ''); if (perm !== null && perm !== undefined) { item.requiredPermission = perm || undefined; }
		this._dirty = true; this._render();
	}

	private async _deleteItem(items: MenuItem[], i: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete "${items[i].label}"?` }); if (!confirmed) { return; }
		items.splice(i, 1); items.forEach((m, j) => { m.position = j; }); this._dirty = true; this._render();
	}

	private async _save(): Promise<void> {
		const input = this.input as CiyexConfigEditorInput; if (!input) { return; }
		try { await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2))); this._dirty = false; this.notificationService.notify({ severity: Severity.Info, message: 'Menu saved.' }); }
		catch (e) { this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` }); }
	}
	private _openJson(): void { const i = this.input as CiyexConfigEditorInput; if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); } }
	private _link(p: HTMLElement, t: string, fn: () => void): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;'; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	private _slink(p: HTMLElement, t: string, fn: () => void, d = false): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = `color:${d ? 'var(--vscode-errorForeground)' : 'var(--vscode-textLink-foreground)'};cursor:pointer;font-size:11px;`; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
