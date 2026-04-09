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
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { RolesEditorInput2 } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface Role {
	id: string;
	name: string;
	label?: string;
	description?: string;
	isSystem?: boolean;
	permissions?: string[];
	smartScopes?: string[];
}

export class RolesPermissionsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexRolesPerms';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private roles: Role[] = [];

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(RolesPermissionsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.roles-perms-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:900px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof RolesEditorInput2)) { return; }
		await this._loadRoles();
	}

	private async _loadRoles(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/admin/roles');
			if (!res.ok) { this.contentEl.textContent = 'Failed to load roles.'; return; }
			const data = await res.json();
			this.roles = (data?.data || data || []) as Role[];
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login...';
		}
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		const title = DOM.append(this.contentEl, DOM.$('h2'));
		title.textContent = 'Roles & Permissions';
		title.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 16px;';

		// Add role button
		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:16px;';
		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+ New Role';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		addBtn.addEventListener('click', () => this._addRole());

		for (const role of this.roles) {
			this._renderRole(role);
		}
	}

	private _renderRole(role: Role): void {
		const card = DOM.append(this.contentEl, DOM.$('div'));
		card.style.cssText = 'margin-bottom:12px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		// Header
		const header = DOM.append(card, DOM.$('div'));
		header.style.cssText = 'padding:10px 16px;background:rgba(0,122,204,0.08);display:flex;align-items:center;gap:8px;cursor:pointer;';

		const nameEl = DOM.append(header, DOM.$('span'));
		nameEl.textContent = role.label || role.name;
		nameEl.style.cssText = 'font-weight:600;font-size:14px;flex:1;';

		if (role.isSystem) {
			const badge = DOM.append(header, DOM.$('span'));
			badge.textContent = 'System';
			badge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';
		}

		if (!role.isSystem) {
			const delBtn = DOM.append(header, DOM.$('button'));
			delBtn.textContent = '🗑️';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;';
			delBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				if (confirm(`Delete role "${role.name}"?`)) {
					await this.apiService.fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
					this._loadRoles();
				}
			});
		}

		// Body (expandable)
		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'padding:12px 16px;display:none;';

		header.addEventListener('click', () => {
			body.style.display = body.style.display === 'none' ? 'block' : 'none';
		});

		// Description
		if (role.description) {
			const desc = DOM.append(body, DOM.$('p'));
			desc.textContent = role.description;
			desc.style.cssText = 'margin:0 0 12px;font-size:12px;color:var(--vscode-descriptionForeground);';
		}

		// Permissions
		const permLabel = DOM.append(body, DOM.$('div'));
		permLabel.textContent = 'Permissions:';
		permLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';

		const permList = DOM.append(body, DOM.$('div'));
		permList.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;';
		for (const perm of (role.permissions || [])) {
			const tag = DOM.append(permList, DOM.$('span'));
			tag.textContent = perm;
			tag.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(0,122,204,0.1);color:var(--vscode-textLink-foreground);';
		}

		// FHIR Scopes
		if (role.smartScopes && role.smartScopes.length > 0) {
			const scopeLabel = DOM.append(body, DOM.$('div'));
			scopeLabel.textContent = 'FHIR Scopes:';
			scopeLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';

			const scopeList = DOM.append(body, DOM.$('div'));
			scopeList.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
			for (const scope of role.smartScopes) {
				const tag = DOM.append(scopeList, DOM.$('span'));
				tag.textContent = scope;
				tag.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(34,197,94,0.1);color:#22c55e;';
			}
		}
	}

	private async _addRole(): Promise<void> {
		const name = prompt('Role name:');
		if (!name) { return; }
		const description = prompt('Description:', '');

		try {
			await this.apiService.fetch('/api/admin/roles', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, label: name, description, permissions: [], smartScopes: [] }),
			});
			this._loadRoles();
		} catch { /* */ }
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
