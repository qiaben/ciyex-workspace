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
		this.root = DOM.append(parent, DOM.$('.ciyex-settings-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';
		const header = DOM.append(this.root, DOM.$('.h')); header.style.cssText = 'padding:12px 24px;max-width:1000px;width:100%;margin:0 auto;';
		const tb = DOM.append(header, DOM.$('.tb')); tb.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		DOM.append(tb, DOM.$('span')).textContent = 'Menu Configuration'; (tb.lastChild as HTMLElement).style.cssText = 'font-weight:600;font-size:14px;flex:1;';
		this._link(tb, 'Add Item', () => this._addItem()); this._link(tb, 'Save', () => this._save()); this._link(tb, 'Open JSON', () => this._openJson());
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
		this._inlineDialog('Add Menu Item', [
			{ label: 'Label', key: 'label', placeholder: 'e.g., Calendar' },
			{ label: 'Icon', key: 'icon', placeholder: 'FileText', value: 'FileText' },
			{ label: 'Screen Slug (route)', key: 'slug', placeholder: '/calendar' },
			{ label: 'Required Permission (optional)', key: 'perm', placeholder: 'rx.read' },
		], values => {
			if (!values.label) { return; }
			this.config.items.push({
				itemKey: values.label.toLowerCase().replace(/\s+/g, '-'),
				label: values.label,
				icon: values.icon || 'FileText',
				screenSlug: values.slug || undefined,
				requiredPermission: values.perm || undefined,
				position: this.config.items.length,
				visible: true,
				children: [],
			});
			this._dirty = true;
			this._render();
		});
	}

	private _editItem(items: MenuItem[], i: number): void {
		const item = items[i];
		this._inlineDialog('Edit Menu Item', [
			{ label: 'Label', key: 'label', value: item.label, placeholder: item.label },
			{ label: 'Icon', key: 'icon', value: item.icon || '', placeholder: 'FileText' },
			{ label: 'Screen Slug (route)', key: 'slug', value: item.screenSlug || '', placeholder: '/calendar' },
			{ label: 'Required Permission', key: 'perm', value: item.requiredPermission || '', placeholder: 'rx.read' },
		], values => {
			if (values.label) { item.label = values.label; }
			item.icon = values.icon || item.icon;
			item.screenSlug = values.slug || undefined;
			item.requiredPermission = values.perm || undefined;
			this._dirty = true;
			this._render();
		});
	}

	private _inlineDialog(title: string, fields: Array<{ label: string; key: string; placeholder?: string; value?: string }>, onConfirm: (values: Record<string, string>) => void): void {
		const overlay = DOM.append(this.root, DOM.$('.menu-dialog-overlay'));
		overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('.menu-dialog'));
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

	private async _deleteItem(items: MenuItem[], i: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete "${items[i].label}"?` }); if (!confirmed) { return; }
		items.splice(i, 1); items.forEach((m, j) => { m.position = j; }); this._dirty = true; this._render();
	}

	private async _save(): Promise<void> {
		const input = this.input as BaseCiyexInput; if (!input) { return; }
		try { await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2))); this._dirty = false; this.notificationService.notify({ severity: Severity.Info, message: 'Menu saved.' }); }
		catch (e) { this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` }); }
	}
	private _openJson(): void { const i = this.input as BaseCiyexInput; if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); } }
	private _link(p: HTMLElement, t: string, fn: () => void): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;'; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	private _slink(p: HTMLElement, t: string, fn: () => void, d = false): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = `color:${d ? 'var(--vscode-errorForeground)' : 'var(--vscode-textLink-foreground)'};cursor:pointer;font-size:11px;`; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
