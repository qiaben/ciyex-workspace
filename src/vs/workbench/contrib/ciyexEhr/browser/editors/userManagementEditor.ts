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
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { UserManagementEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';

interface User {
	id: string;
	username: string;
	email: string;
	firstName?: string;
	lastName?: string;
	role?: string;
	roles?: string[];
	enabled: boolean;
	createdAt?: string;
}

interface ResetPasswordData {
	userId: string;
	username: string;
	temporaryPassword: string;
	resetDate?: string;
}

export class UserManagementEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexUserMgmt';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private users: User[] = [];
	private roles: Array<{ id: string; name: string; label?: string }> = [];
	private searchValue = '';
	private currentPage = 0;
	private pageSize = 20;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IClipboardService private readonly clipboardService: IClipboardService,
	) {
		super(UserManagementEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.user-mgmt-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1000px;margin:0 auto;padding:20px 24px;';
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
				this.roles = (data?.data || data || []) as Array<{ id: string; name: string; label?: string }>;
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

		// Header (title + subtitle)
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'margin:0 0 16px;';
		const title = DOM.append(header, DOM.$('h1'));
		title.textContent = 'Users';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const subtitle = DOM.append(header, DOM.$('p'));
		subtitle.textContent = 'Manage user accounts, roles, and portal access';
		subtitle.style.cssText = 'margin:0;font-size:13px;color:var(--vscode-descriptionForeground);';

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
		addBtn.addEventListener('click', () => this._openUserModal(null));

		// Table — wrapped so horizontal overflow is scrollable. Use fixed
		// column widths (no flex columns) so the table really does exceed the
		// container when emails/roles get long, which is what triggers the
		// horizontal scrollbar. Previously the columns used `1fr`, so they
		// shrank to fit and the Actions column was hidden behind the
		// container edge with no way to scroll.
		const tableScroll = DOM.append(this.contentEl, DOM.$('div'));
		tableScroll.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;';
		const table = DOM.append(tableScroll, DOM.$('div'));
		table.style.cssText = 'min-width:1100px;';

		// Header — fixed column widths so the table always exceeds the
		// container width and the scrollbar appears.
		const gridCols = 'grid-template-columns:240px 280px 220px 160px 160px;';
		const headerRow = DOM.append(table, DOM.$('div'));
		headerRow.style.cssText = `display:grid;${gridCols}gap:8px;padding:10px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(0,122,204,0.05);`;
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
			row.style.cssText = `display:grid;${gridCols}gap:8px;padding:8px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:13px;`;
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const nameEl = DOM.append(row, DOM.$('span'));
			nameEl.textContent = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
			nameEl.style.cssText = 'font-weight:500;';

			DOM.append(row, DOM.$('span')).textContent = user.email || '';

			const roleEl = DOM.append(row, DOM.$('span'));
			const roleNames = (user.roles && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : []))
				.filter(r => !['default-roles-ciyex', 'offline_access', 'uma_authorization'].includes(r));
			roleEl.textContent = roleNames.join(', ') || 'N/A';
			roleEl.style.cssText = 'font-size:11px;';

			const statusEl = DOM.append(row, DOM.$('span'));
			statusEl.textContent = user.enabled ? 'Active' : 'Disabled';
			statusEl.style.cssText = `font-size:11px;color:${user.enabled ? '#22c55e' : '#ef4444'};`;

			const actions = DOM.append(row, DOM.$('div'));
			actions.style.cssText = 'display:flex;gap:4px;';

			this._iconBtn(actions, '\u270F', 'Edit', () => this._openUserModal(user));
			this._iconBtn(actions, '\u{1F511}', 'Reset password', () => this._resetPassword(user));
			this._iconBtn(actions, '\u{1F4E7}', 'Send reset email', () => this._sendResetEmail(user));
			this._iconBtn(actions, '\u{1F5D1}', 'Delete', () => this._deleteUser(user), 'danger');
		}
	}

	private _iconBtn(parent: HTMLElement, icon: string, title: string, fn: () => void, kind: 'normal' | 'danger' = 'normal'): void {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = icon;
		btn.title = title;
		const color = kind === 'danger' ? 'var(--vscode-errorForeground,#f48771)' : 'var(--vscode-foreground)';
		btn.style.cssText = `background:transparent;border:none;cursor:pointer;color:${color};opacity:0.7;font-size:13px;padding:3px 6px;border-radius:3px;`;
		btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-list-hoverBackground)'; btn.style.opacity = '1'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = ''; btn.style.opacity = '0.7'; });
		btn.addEventListener('click', fn);
	}

	private _openUserModal(user: User | null): void {
		const isEdit = !!user;
		const overlay = DOM.append(this.contentEl, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:480px;max-width:92vw;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = isEdit ? 'Edit User' : 'Add User';
		ht.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const fields: Array<{ key: keyof User; label: string; type?: string; required?: boolean }> = [
			{ key: 'firstName', label: 'First Name', required: !isEdit },
			{ key: 'lastName', label: 'Last Name', required: !isEdit },
			{ key: 'email', label: 'Email', type: 'email', required: !isEdit },
		];
		const form: Record<string, unknown> = user ? { ...user } : {};

		for (const f of fields) {
			const lbl = DOM.append(modal, DOM.$('label'));
			lbl.textContent = f.label + (f.required ? ' *' : '');
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-top:8px;margin-bottom:4px;';
			const inp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
			inp.type = f.type || 'text';
			inp.value = String(form[f.key] || '');
			inp.disabled = isEdit && f.key === 'email';
			inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
			inp.addEventListener('input', () => { form[f.key] = inp.value; });
		}

		// Role
		const roleLbl = DOM.append(modal, DOM.$('label'));
		roleLbl.textContent = 'Role *';
		roleLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-top:8px;margin-bottom:4px;';
		const roleSel = DOM.append(modal, DOM.$('select')) as HTMLSelectElement;
		roleSel.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:12px;';
		const currentRole = (user?.roles && user.roles[0]) || user?.role || (this.roles[0]?.name || '');
		for (const r of this.roles) {
			const o = DOM.append(roleSel, DOM.$('option')) as HTMLOptionElement;
			o.value = r.name;
			o.textContent = r.label || r.name;
			if (r.name === currentRole) { o.selected = true; }
		}
		form['role'] = currentRole;
		roleSel.addEventListener('change', () => { form['role'] = roleSel.value; });

		// Options (create only)
		let sendWelcomeEmail = true;
		let generatePrint = true;
		if (!isEdit) {
			const optsWrap = DOM.append(modal, DOM.$('div'));
			optsWrap.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:6px;';
			const mkCb = (id: string, label: string, checked: boolean, setter: (v: boolean) => void): void => {
				const wrap = DOM.append(optsWrap, DOM.$('label'));
				wrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;';
				const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				cb.type = 'checkbox';
				cb.id = id;
				cb.checked = checked;
				cb.addEventListener('change', () => setter(cb.checked));
				const t = DOM.append(wrap, DOM.$('span'));
				t.textContent = label;
			};
			mkCb('lu-welcome', 'Send welcome email with credentials', sendWelcomeEmail, v => { sendWelcomeEmail = v; });
			mkCb('lu-print', 'Generate printable credentials', generatePrint, v => { generatePrint = v; });
		}

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';
		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());

		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save' : 'Create Login';
		saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			if (!isEdit && !form['email']) {
				this.notificationService.notify({ severity: Severity.Error, message: 'Email is required.' });
				return;
			}
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving…';
			try {
				const url = isEdit ? `/api/admin/users/${user!.id}` : '/api/admin/users';
				const method = isEdit ? 'PUT' : 'POST';
				const payload: Record<string, unknown> = { ...form, sendWelcomeEmail, generatePrint };
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				const json = await res.json().catch(() => null);
				if (res.ok && (json?.success !== false)) {
					overlay.remove();
					this.notificationService.notify({ severity: Severity.Info, message: isEdit ? 'User updated.' : 'User created.' });
					if (!isEdit && json?.data?.temporaryPassword) {
						this._showCredentialsModal({
							userId: json.data.id,
							username: json.data.email || String(form['email']),
							temporaryPassword: json.data.temporaryPassword,
							resetDate: new Date().toISOString().split('T')[0],
						});
					}
					await this._loadUsers();
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: json?.message || `Save failed (${res.status})` });
					saveBtn.disabled = false;
					saveBtn.textContent = isEdit ? 'Save' : 'Create Login';
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				saveBtn.disabled = false;
				saveBtn.textContent = isEdit ? 'Save' : 'Create Login';
			}
		});

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
	}

	/** Reset a user's password and show the temporary credentials (with Print). */
	private async _resetPassword(user: User): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Reset password for ${user.email}? A new temporary password will be generated.` });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' });
			const json = await res.json().catch(() => null);
			if (res.ok && json?.data?.temporaryPassword) {
				this._showCredentialsModal(json.data);
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: json?.message || `Reset failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Reset failed: ${e}` });
		}
	}

	private async _sendResetEmail(user: User): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/admin/users/${user.id}/send-reset-email`, { method: 'POST' });
			let json: { success?: boolean; message?: string } | null = null;
			try { json = await res.json(); } catch { /* ignore */ }
			if (res.ok && json?.success !== false) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Password reset email sent.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: json?.message || `Send failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Send failed: ${e}` });
		}
	}

	private async _deleteUser(user: User): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: `Delete user ${user.email}?`,
			detail: 'This will permanently remove the user account from Keycloak and the database. This cannot be undone.',
			primaryButton: 'Delete',
			type: 'warning',
		});
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
			if (res.ok || res.status === 204) {
				this.notificationService.notify({ severity: Severity.Info, message: `User ${user.email} deleted.` });
				await this._loadUsers();
				return;
			}
			// Try to get a useful error message
			let msg = `Delete failed (${res.status})`;
			try {
				const json = await res.json();
				if (json?.message) {
					msg = json.message;
				} else if (json?.error) {
					msg = json.error;
				}
			} catch { /* keep status-only msg */ }
			// Helpful hint for 500 — usually Keycloak/DB constraint
			if (res.status === 500) {
				msg += ' — Backend error. The user may have linked FHIR records or audit history that prevent deletion. Consider disabling the account instead.';
			} else if (res.status === 403) {
				msg += ' — Permission denied. Only admins can delete users.';
			} else if (res.status === 404) {
				msg += ' — User no longer exists. Refreshing list.';
				await this._loadUsers();
			}
			this.notificationService.notify({ severity: Severity.Error, message: msg });
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	/**
	 * Show a credentials modal that mirrors the EHR UI's `ResetPasswordModal`
	 * (Username on top, prominent monospace temporary password with a
	 * one-click copy icon, red change-on-first-login note, then Close /
	 * Print Credentials actions).
	 */
	private _showCredentialsModal(data: ResetPasswordData): void {
		// Attach to document.body, not contentEl: editor panes use CSS
		// transforms which make `position:fixed` resolve relative to the
		// editor (causing the backdrop to look "transparent" because it
		// only covered the editor surface, not the surrounding workbench).
		const overlay = DOM.append(mainWindow.document.body, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.65);display:flex;align-items:center;justify-content:center;z-index:100000;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:#ffffff;color:#0f172a;border-radius:14px;width:460px;max-width:92vw;box-shadow:0 24px 48px rgba(15,23,42,0.35);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

		// Header
		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:16px 22px;border-bottom:1px solid #e2e8f0;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = 'Password Reset';
		ht.style.cssText = 'margin:0;font-size:17px;font-weight:600;color:#1e293b;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:18px;color:#64748b;cursor:pointer;padding:4px 8px;border-radius:6px;';
		closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#f1f5f9'; });
		closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; });
		closeBtn.addEventListener('click', () => overlay.remove());

		// Body
		const body = DOM.append(modal, DOM.$('div'));
		body.style.cssText = 'padding:22px;';

		const card = DOM.append(body, DOM.$('div'));
		card.style.cssText = 'background:#f8fafc;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:14px;';

		// Username block
		const userBlock = DOM.append(card, DOM.$('div'));
		const userLabel = DOM.append(userBlock, DOM.$('div'));
		userLabel.textContent = 'Username';
		userLabel.style.cssText = 'font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;';
		const userVal = DOM.append(userBlock, DOM.$('div'));
		userVal.textContent = data.username;
		userVal.style.cssText = 'font-size:14px;font-weight:600;color:#0f172a;margin-top:4px;word-break:break-all;';

		// Temporary password block
		const pwBlock = DOM.append(card, DOM.$('div'));
		const pwLabel = DOM.append(pwBlock, DOM.$('div'));
		pwLabel.textContent = 'Temporary Password';
		pwLabel.style.cssText = 'font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;';
		const pwRow = DOM.append(pwBlock, DOM.$('div'));
		pwRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px;';
		const pwCode = DOM.append(pwRow, DOM.$('code'));
		pwCode.textContent = data.temporaryPassword;
		pwCode.title = 'Click to copy';
		// `user-select:all` lets a single click select the whole password so
		// users can fall back to Ctrl/Cmd+C if the clipboard API path fails.
		pwCode.style.cssText = 'font-family:"SF Mono","Menlo","Consolas",monospace;font-size:16px;font-weight:700;color:#2563eb;background:#dbeafe;padding:8px 14px;border-radius:6px;letter-spacing:0.5px;user-select:all;-webkit-user-select:all;cursor:pointer;';
		const copyBtn = DOM.append(pwRow, DOM.$('button')) as HTMLButtonElement;
		copyBtn.title = 'Copy to clipboard';
		copyBtn.textContent = '\u{1F4CB}';
		copyBtn.style.cssText = 'background:#eff6ff;border:1px solid #bfdbfe;cursor:pointer;font-size:14px;color:#1d4ed8;padding:6px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:6px;';
		copyBtn.addEventListener('mouseenter', () => { copyBtn.style.background = '#dbeafe'; });
		copyBtn.addEventListener('mouseleave', () => { copyBtn.style.background = '#eff6ff'; });
		const doCopy = async (): Promise<void> => {
			const ok = await this._copyToClipboard(data.temporaryPassword);
			if (ok) {
				const prev = copyBtn.textContent;
				copyBtn.textContent = '\u2713 Copied';
				copyBtn.style.color = '#16a34a';
				setTimeout(() => { copyBtn.textContent = prev; copyBtn.style.color = '#1d4ed8'; }, 1800);
			}
		};
		copyBtn.addEventListener('click', () => { void doCopy(); });
		// Single click on the password chip also copies \u2014 matches EHR UI behavior
		// where the password is highlighted + copied without needing the icon.
		pwCode.addEventListener('click', () => { void doCopy(); });

		// Warning
		const warn = DOM.append(card, DOM.$('p'));
		warn.textContent = 'User must change password on first login.';
		warn.style.cssText = 'margin:0;padding-top:10px;border-top:1px solid #e2e8f0;font-size:12px;font-weight:600;color:#dc2626;';

		// Footer actions
		const actions = DOM.append(body, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px;';

		const closeAction = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		closeAction.textContent = 'Close';
		closeAction.style.cssText = 'padding:8px 16px;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;color:#334155;cursor:pointer;font-size:13px;font-weight:500;';
		closeAction.addEventListener('mouseenter', () => { closeAction.style.background = '#f8fafc'; });
		closeAction.addEventListener('mouseleave', () => { closeAction.style.background = '#ffffff'; });
		closeAction.addEventListener('click', () => overlay.remove());

		const printBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		printBtn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#2563eb;color:#ffffff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;';
		printBtn.addEventListener('mouseenter', () => { printBtn.style.background = '#1d4ed8'; });
		printBtn.addEventListener('mouseleave', () => { printBtn.style.background = '#2563eb'; });
		const printIcon = DOM.append(printBtn, DOM.$('span'));
		printIcon.textContent = '\u{1F5A8}';
		const printText = DOM.append(printBtn, DOM.$('span'));
		printText.textContent = 'Print Credentials';
		printBtn.addEventListener('click', () => this._printCredentials(data));

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
	}

	/**
	 * Copy text to the system clipboard with the highest-success-rate path
	 * available. Packaged Electron builds sometimes report
	 * "Clipboard unavailable" from `navigator.clipboard` (no secure context
	 * or permissions), so we prefer VS Code's own `IClipboardService` which
	 * uses Electron's native clipboard API, then fall back to a hidden
	 * textarea + `execCommand('copy')` (works in webviews / older Chromium),
	 * and finally the `navigator.clipboard` Web API. Notifies the user on
	 * total failure with the password preselected so they can copy manually.
	 */
	private async _copyToClipboard(text: string): Promise<boolean> {
		try {
			await this.clipboardService.writeText(text);
			return true;
		} catch { /* fall through */ }
		try {
			const doc = mainWindow.document;
			const ta = doc.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.top = '0';
			ta.style.left = '0';
			ta.style.opacity = '0';
			doc.body.appendChild(ta);
			ta.focus();
			ta.select();
			const ok = doc.execCommand('copy');
			doc.body.removeChild(ta);
			if (ok) { return true; }
		} catch { /* fall through */ }
		try {
			await mainWindow.navigator.clipboard.writeText(text);
			return true;
		} catch { /* fall through */ }
		this.notificationService.notify({ severity: Severity.Warning, message: 'Clipboard unavailable. Select the password text and press Ctrl/Cmd + C to copy.' });
		return false;
	}

	/** Open a printable popup with the user's credentials. */
	private _printCredentials(data: ResetPasswordData): void {
		const w = mainWindow.open('', '_blank', 'width=600,height=500');
		if (!w) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Pop-up blocked. Please allow pop-ups to print credentials.' });
			return;
		}
		const doc = w.document;
		doc.open();
		// Build print page safely using DOM APIs only.
		const html = doc.createElement('html');
		const head = doc.createElement('head');
		const title = doc.createElement('title');
		title.textContent = 'Login Credentials';
		head.appendChild(title);
		const style = doc.createElement('style');
		style.textContent = `
			body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a2e; }
			h1 { font-size: 22px; margin: 0 0 8px; }
			h2 { font-size: 14px; color: #6b7280; font-weight: normal; margin: 0 0 30px; }
			.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; max-width: 460px; }
			.row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
			.row:last-child { border-bottom: none; }
			.k { font-weight: 600; min-width: 130px; color: #6b7280; }
			.v { font-family: 'Courier New', monospace; font-weight: 600; }
			.note { margin-top: 24px; font-size: 12px; color: #6b7280; }
		`;
		head.appendChild(style);
		const body = doc.createElement('body');
		const h1 = doc.createElement('h1');
		h1.textContent = 'Login Credentials';
		const h2 = doc.createElement('h2');
		h2.textContent = 'Ciyex EHR / Workspace';
		const card = doc.createElement('div');
		card.className = 'card';
		const rows: Array<[string, string]> = [
			['Username', data.username],
			['Password', data.temporaryPassword],
		];
		if (data.resetDate) { rows.push(['Issued', data.resetDate]); }
		for (const [k, v] of rows) {
			const r = doc.createElement('div');
			r.className = 'row';
			const ke = doc.createElement('div');
			ke.className = 'k';
			ke.textContent = k;
			const ve = doc.createElement('div');
			ve.className = 'v';
			ve.textContent = v;
			r.appendChild(ke);
			r.appendChild(ve);
			card.appendChild(r);
		}
		const note = doc.createElement('div');
		note.className = 'note';
		note.textContent = 'This is a temporary password. The user will be prompted to change it on first login. Please keep these credentials secure.';
		body.appendChild(h1);
		body.appendChild(h2);
		body.appendChild(card);
		body.appendChild(note);
		html.appendChild(head);
		html.appendChild(body);
		doc.documentElement.replaceWith(html);
		doc.close();
		w.focus();
		w.print();
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
