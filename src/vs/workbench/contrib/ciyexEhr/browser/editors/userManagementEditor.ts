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
import { UserManagementEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface User {
	id: string;
	username: string;
	email: string;
	firstName?: string;
	lastName?: string;
	role?: string;
	enabled: boolean;
	createdAt?: string;
}

export class UserManagementEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexUserMgmt';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private users: User[] = [];
	private roles: Array<{ id: string; name: string }> = [];
	private searchValue = '';
	private currentPage = 0;
	private pageSize = 20;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(UserManagementEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.user-mgmt-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:900px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof UserManagementEditorInput)) { return; }
		await this._loadRoles();
		await this._loadUsers();
	}

	private async _loadRoles(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/admin/roles');
			if (res.ok) {
				const data = await res.json();
				this.roles = (data?.data || data || []) as Array<{ id: string; name: string }>;
			}
		} catch { /* */ }
	}

	private async _loadUsers(): Promise<void> {
		try {
			const search = this.searchValue ? `&search=${encodeURIComponent(this.searchValue)}` : '';
			const res = await this.apiService.fetch(`/api/admin/users?page=${this.currentPage}&size=${this.pageSize}${search}`);
			if (!res.ok) { this.contentEl.textContent = 'Failed to load users.'; return; }
			const data = await res.json();
			this.users = (data?.data?.content || data?.data || data?.content || data || []) as User[];
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login...';
		}
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		// Title
		const title = DOM.append(this.contentEl, DOM.$('h2'));
		title.textContent = 'User Management';
		title.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 16px;';

		// Toolbar
		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;align-items:center;';

		const search = DOM.append(toolbar, DOM.$('input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Search users...';
		search.value = this.searchValue;
		search.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';
		search.addEventListener('input', () => { this.searchValue = search.value; this.currentPage = 0; this._loadUsers(); });

		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+ Add User';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		addBtn.addEventListener('click', () => this._addUser());

		// Table
		const table = DOM.append(this.contentEl, DOM.$('div'));
		table.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		// Header
		const headerRow = DOM.append(table, DOM.$('div'));
		headerRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 120px 80px 100px;gap:8px;padding:10px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(0,122,204,0.05);';
		for (const col of ['Name', 'Email', 'Role', 'Status', 'Actions']) {
			DOM.append(headerRow, DOM.$('span')).textContent = col;
		}

		if (this.users.length === 0) {
			const empty = DOM.append(table, DOM.$('div'));
			empty.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No users found';
			return;
		}

		for (const user of this.users) {
			const row = DOM.append(table, DOM.$('div'));
			row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 120px 80px 100px;gap:8px;padding:8px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:13px;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			// Name
			const nameEl = DOM.append(row, DOM.$('span'));
			nameEl.textContent = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
			nameEl.style.cssText = 'font-weight:500;';

			// Email
			DOM.append(row, DOM.$('span')).textContent = user.email || '';

			// Role
			const roleEl = DOM.append(row, DOM.$('span'));
			roleEl.textContent = user.role || 'N/A';
			roleEl.style.cssText = 'font-size:11px;';

			// Status
			const statusEl = DOM.append(row, DOM.$('span'));
			statusEl.textContent = user.enabled ? 'Active' : 'Disabled';
			statusEl.style.cssText = `font-size:11px;color:${user.enabled ? '#22c55e' : '#ef4444'};`;

			// Actions
			const actions = DOM.append(row, DOM.$('div'));
			actions.style.cssText = 'display:flex;gap:4px;';

			const editBtn = DOM.append(actions, DOM.$('button'));
			editBtn.textContent = '✏️';
			editBtn.title = 'Edit';
			editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px;';

			const keyBtn = DOM.append(actions, DOM.$('button'));
			keyBtn.textContent = '🔑';
			keyBtn.title = 'Reset password';
			keyBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px;';
			keyBtn.addEventListener('click', async () => {
				if (confirm(`Reset password for ${user.email}?`)) {
					await this.apiService.fetch(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' });
				}
			});

			const delBtn = DOM.append(actions, DOM.$('button'));
			delBtn.textContent = '🗑️';
			delBtn.title = 'Delete';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px;';
			delBtn.addEventListener('click', async () => {
				if (confirm(`Delete user ${user.email}?`)) {
					await this.apiService.fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
					this._loadUsers();
				}
			});
		}
	}

	private async _addUser(): Promise<void> {
		const email = prompt('User email:');
		if (!email) { return; }
		const role = prompt(`Role (${this.roles.map(r => r.name).join(', ')}):`, this.roles[0]?.name || 'staff');
		if (!role) { return; }

		try {
			await this.apiService.fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role }),
			});
			this._loadUsers();
		} catch { /* */ }
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
