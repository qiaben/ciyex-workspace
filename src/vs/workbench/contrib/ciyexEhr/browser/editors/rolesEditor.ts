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

interface RoleDef { id: string; name: string; label: string; description: string; isSystem?: boolean; smartScopes: string[]; permissions: string[] }
interface RolesConfig { roles: RoleDef[] }

export class RolesEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexRoles';
	private root!: HTMLElement; private body!: HTMLElement; private config: RolesConfig = { roles: [] }; private _dirty = false;
	get dirty(): boolean { return this._dirty; }

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService,
		@IFileService private readonly fileService: IFileService, @IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService, @IDialogService private readonly dialogService: IDialogService) {
		super(RolesEditor.ID, group, t, th, s);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-settings-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';
		const header = DOM.append(this.root, DOM.$('.h')); header.style.cssText = 'padding:12px 24px;max-width:1000px;width:100%;margin:0 auto;';
		const tb = DOM.append(header, DOM.$('.tb')); tb.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		DOM.append(tb, DOM.$('span')).textContent = 'Roles & Permissions'; (tb.lastChild as HTMLElement).style.cssText = 'font-weight:600;font-size:14px;flex:1;';
		this._link(tb, 'Add Role', () => this._addRole()); this._link(tb, 'Save', () => this._save()); this._link(tb, 'Open JSON', () => this._openJson());
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
		for (let ri = 0; ri < this.config.roles.length; ri++) {
			const role = this.config.roles[ri];
			const row = DOM.append(this.body, DOM.$('.setting-item'));
			row.style.cssText = 'padding:12px 16px;border-bottom:1px solid rgba(128,128,128,0.1);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			// Header row
			const hr = DOM.append(row, DOM.$('.hr')); hr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
			const n = DOM.append(hr, DOM.$('span')); n.textContent = role.label; n.style.cssText = 'font-weight:600;font-size:14px;';
			const k = DOM.append(hr, DOM.$('code')); k.textContent = role.name; k.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:3px;';
			if (role.isSystem) { const s = DOM.append(hr, DOM.$('span')); s.textContent = 'System'; s.style.cssText = 'background:rgba(128,128,128,0.2);color:var(--vscode-descriptionForeground);padding:1px 6px;border-radius:3px;font-size:10px;'; }
			const spacer = DOM.append(hr, DOM.$('span')); spacer.style.cssText = 'flex:1;';
			this._slink(hr, 'Edit', () => this._editRole(ri));
			if (!role.isSystem) { this._slink(hr, 'Delete', () => this._deleteRole(ri), true); }

			// Description
			if (role.description) { const d = DOM.append(row, DOM.$('div')); d.textContent = role.description; d.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:6px;'; }

			// FHIR Scopes
			const scopes = DOM.append(row, DOM.$('.scopes')); scopes.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;';
			const scopeLabel = DOM.append(scopes, DOM.$('span')); scopeLabel.textContent = 'FHIR Scopes:'; scopeLabel.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-weight:500;width:100%;';
			for (const s of role.smartScopes.slice(0, 12)) {
				const b = DOM.append(scopes, DOM.$('span')); b.textContent = s;
				b.style.cssText = 'background:rgba(14,99,156,0.15);color:var(--vscode-textLink-foreground);padding:1px 6px;border-radius:3px;font-size:10px;';
			}
			if (role.smartScopes.length > 12) { const m = DOM.append(scopes, DOM.$('span')); m.textContent = `+${role.smartScopes.length - 12} more`; m.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);'; }

			// Permissions
			const perms = DOM.append(row, DOM.$('.perms')); perms.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
			const permLabel = DOM.append(perms, DOM.$('span')); permLabel.textContent = 'Permissions:'; permLabel.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-weight:500;width:100%;';
			for (const p of role.permissions.slice(0, 12)) {
				const b = DOM.append(perms, DOM.$('span')); b.textContent = p;
				b.style.cssText = 'background:rgba(46,160,67,0.15);color:#3fb950;padding:1px 6px;border-radius:3px;font-size:10px;';
			}
			if (role.permissions.length > 12) { const m = DOM.append(perms, DOM.$('span')); m.textContent = `+${role.permissions.length - 12} more`; m.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);'; }
		}
	}

	private _addRole(): void {
		const name = globalThis.prompt?.('Role name (e.g., physician):'); if (!name) { return; }
		const label = globalThis.prompt?.('Display label:', name.charAt(0).toUpperCase() + name.slice(1)); if (!label) { return; }
		const desc = globalThis.prompt?.('Description:') || '';
		this.config.roles.push({ id: name, name, label, description: desc, isSystem: false, smartScopes: [], permissions: [] });
		this._dirty = true; this._render();
	}

	private _editRole(ri: number): void {
		const role = this.config.roles[ri];
		const label = globalThis.prompt?.('Label:', role.label); if (label !== null && label !== undefined) { role.label = label; }
		const desc = globalThis.prompt?.('Description:', role.description); if (desc !== null && desc !== undefined) { role.description = desc; }
		const scopes = globalThis.prompt?.('FHIR Scopes (comma-separated):', role.smartScopes.join(', '));
		if (scopes !== null && scopes !== undefined) { role.smartScopes = scopes.split(',').map(s => s.trim()).filter(Boolean); }
		const perms = globalThis.prompt?.('Permissions (comma-separated):', role.permissions.join(', '));
		if (perms !== null && perms !== undefined) { role.permissions = perms.split(',').map(s => s.trim()).filter(Boolean); }
		this._dirty = true; this._render();
	}

	private async _deleteRole(ri: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete role "${this.config.roles[ri].label}"?` }); if (!confirmed) { return; }
		this.config.roles.splice(ri, 1); this._dirty = true; this._render();
	}

	private async _save(): Promise<void> {
		const input = this.input as CiyexConfigEditorInput; if (!input) { return; }
		try { await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2))); this._dirty = false; this.notificationService.notify({ severity: Severity.Info, message: 'Roles saved.' }); }
		catch (e) { this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` }); }
	}
	private _openJson(): void { const i = this.input as CiyexConfigEditorInput; if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); } }
	private _link(p: HTMLElement, t: string, fn: () => void): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;'; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	private _slink(p: HTMLElement, t: string, fn: () => void, d = false): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = `color:${d ? 'var(--vscode-errorForeground)' : 'var(--vscode-textLink-foreground)'};cursor:pointer;font-size:11px;`; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
