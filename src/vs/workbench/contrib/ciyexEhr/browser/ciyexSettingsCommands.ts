/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';

// ─── Admin Menu (top-level menu bar) ─────────────────────────────────

const MenubarAdminMenu = new MenuId('MenubarAdminMenu');

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarAdminMenu,
	title: {
		...localize2('adminMenu', "Admin"),
		mnemonicTitle: localize2('mAdmin', "&&Admin").value,
	},
	when: ContextKeyExpr.has('ciyex.role.admin'),
	order: 7,
});

// ─── Admin Menu Items ────────────────────────────────────────────────

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openUserManagement', title: 'User Management' },
	group: 'users',
	order: 1,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openRolesPermissions', title: 'Roles & Permissions' },
	group: 'users',
	order: 2,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openMenuConfiguration', title: 'Menu Configuration' },
	group: 'layout',
	order: 3,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openChartLayout', title: 'Chart Layout' },
	group: 'layout',
	order: 4,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openEncounterSettings', title: 'Encounter Form' },
	group: 'layout',
	order: 5,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openCalendarColors', title: 'Calendar Colors' },
	group: 'settings',
	order: 6,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openPortalSettings', title: 'Patient Portal' },
	group: 'settings',
	order: 7,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.managePractice', title: 'Practice Info' },
	group: 'practice',
	order: 8,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.manageProviders', title: 'Providers' },
	group: 'practice',
	order: 9,
});

// ─── Helper ──────────────────────────────────────────────────────────

function wrapSettingsHtml(body: string): string {
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
		body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--vscode-editor-background,#1e1e1e); color:var(--vscode-editor-foreground,#ccc); padding:20px; margin:0; font-size:13px; line-height:1.5; }
		h1,h2,h3 { color:var(--vscode-editor-foreground,#fff); margin:0 0 12px; }
		.card { background:var(--vscode-editorWidget-background,#252526); border:1px solid var(--vscode-editorWidget-border,#3c3c3c); border-radius:6px; padding:16px; margin-bottom:16px; }
		.grid { display:grid; grid-template-columns:160px 1fr; gap:6px; }
		.label { color:var(--vscode-descriptionForeground,#858585); }
		table { width:100%; border-collapse:collapse; }
		th,td { padding:8px 12px; text-align:left; border-bottom:1px solid var(--vscode-editorWidget-border,#3c3c3c); }
		th { color:var(--vscode-descriptionForeground,#858585); font-weight:500; font-size:11px; text-transform:uppercase; }
		.badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; }
		.badge-active { background:#0e639c; color:#fff; }
		.badge-system { background:#3c3c3c; color:#858585; }
		.btn { padding:6px 14px; border-radius:4px; border:none; cursor:pointer; font-size:12px; }
		.btn-primary { background:#0e639c; color:#fff; }
		.btn-danger { background:#a1260d; color:#fff; }
		.btn-secondary { background:#3c3c3c; color:#ccc; border:1px solid #555; }
	</style></head><body>${body}</body></html>`;
}

// ─── Settings Commands ───────────────────────────────────────────────

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openUserManagement',
			title: localize2('manageUsers', "Manage Users"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const api = accessor.get(ICiyexApiService);
		const ws = accessor.get(IWebviewWorkbenchService);
		let body: string;
		try {
			const res = await api.fetch('/api/admin/users?page=0&size=50');
			if (res.ok) {
				const data = await res.json();
				const users = data?.data?.content || data?.content || [];
				let rows = '';
				for (const u of users) {
					const roles = (u.roles || u.groups || []).join(', ');
					const status = u.enabled !== false ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-system">Disabled</span>';
					rows += `<tr><td>${u.firstName || ''} ${u.lastName || ''}</td><td>${u.email || u.username || ''}</td><td>${roles}</td><td>${status}</td></tr>`;
				}
				body = `<h1>User Management</h1>
					<div class="card"><table>
						<thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th></tr></thead>
						<tbody>${rows || '<tr><td colspan="4">No users found</td></tr>'}</tbody>
					</table></div>`;
			} else {
				body = `<h1>User Management</h1><div class="card"><p>Failed to load users (${res.status})</p></div>`;
			}
		} catch { body = '<h1>User Management</h1><div class="card"><p>Error loading users</p></div>'; }
		const input = ws.openWebview({ title: 'User Management', options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined }, 'ciyex.userMgmt', 'User Management', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		input.webview.setHtml(wrapSettingsHtml(body));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openRolesPermissions',
			title: localize2('manageRoles', "Manage Roles & Permissions"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const api = accessor.get(ICiyexApiService);
		const ws = accessor.get(IWebviewWorkbenchService);
		let body: string;
		try {
			const res = await api.fetch('/api/admin/roles');
			if (res.ok) {
				const data = await res.json();
				const roles = data?.data || data || [];
				let cards = '';
				for (const r of (Array.isArray(roles) ? roles : [])) {
					const perms = (r.permissions || []).join(', ') || 'No permissions';
					const scopes = (r.smartScopes || []).join(', ') || 'No FHIR scopes';
					const badge = r.isSystem ? '<span class="badge badge-system">System</span>' : '';
					cards += `<div class="card">
						<h3>${r.roleLabel || r.roleName || ''} ${badge}</h3>
						<p style="color:var(--vscode-descriptionForeground);font-size:12px;">${r.description || ''}</p>
						<div class="grid"><span class="label">Permissions</span><span style="font-size:11px;">${perms}</span></div>
						<div class="grid" style="margin-top:4px;"><span class="label">FHIR Scopes</span><span style="font-size:11px;">${scopes}</span></div>
					</div>`;
				}
				body = `<h1>Roles & Permissions</h1>${cards || '<div class="card"><p>No roles found</p></div>'}`;
			} else {
				body = `<h1>Roles & Permissions</h1><div class="card"><p>Failed to load roles (${res.status})</p></div>`;
			}
		} catch { body = '<h1>Roles & Permissions</h1><div class="card"><p>Error loading roles</p></div>'; }
		const input = ws.openWebview({ title: 'Roles & Permissions', options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined }, 'ciyex.roles', 'Roles & Permissions', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		input.webview.setHtml(wrapSettingsHtml(body));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'ciyex.openMenuConfiguration', title: localize2('configMenu', "Configure Menu"), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const api = accessor.get(ICiyexApiService);
		const ws = accessor.get(IWebviewWorkbenchService);
		let body: string;
		try {
			const res = await api.fetch('/api/menus/ehr-sidebar');
			if (res.ok) {
				const items = await res.json();
				const arr = Array.isArray(items) ? items : [];
				let rows = '';
				const renderItems = (list: Array<Record<string, unknown>>, depth: number) => {
					for (const item of list) {
						const indent = '&nbsp;'.repeat(depth * 4);
						const icon = item.icon ? `<span class="codicon codicon-${item.icon}"></span>` : '';
						rows += `<tr><td>${indent}${icon} ${item.label || ''}</td><td>${item.screenSlug || ''}</td><td>${item.position || ''}</td></tr>`;
						if (Array.isArray(item.children)) {
							renderItems(item.children as Array<Record<string, unknown>>, depth + 1);
						}
					}
				};
				renderItems(arr, 0);
				body = `<h1>Menu Configuration</h1>
					<div class="card"><table>
						<thead><tr><th>Label</th><th>Route</th><th>Position</th></tr></thead>
						<tbody>${rows || '<tr><td colspan="3">No menu items</td></tr>'}</tbody>
					</table></div>`;
			} else {
				body = `<h1>Menu Configuration</h1><div class="card"><p>Failed to load menu (${res.status})</p></div>`;
			}
		} catch { body = '<h1>Menu Configuration</h1><div class="card"><p>Error loading menu</p></div>'; }
		const input = ws.openWebview({ title: 'Menu Configuration', options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined }, 'ciyex.menuConfig', 'Menu Configuration', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		input.webview.setHtml(wrapSettingsHtml(body));
	}
});

// ciyex.openChartLayout is registered in layoutSettingsEditor.ts (interactive Tab Manager)

// ciyex.openEncounterSettings and ciyex.openFieldConfig are in layoutSettingsEditor.ts

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'ciyex.openCalendarColors', title: localize2('calendarColors', "Configure Calendar Colors"), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const ws = accessor.get(IWebviewWorkbenchService);
		const body = `<h1>Calendar Colors</h1><div class="card"><p>Calendar color configuration editor coming soon.</p><p>Configure colors for visit types, providers, and locations.</p></div>`;
		const input = ws.openWebview({ title: 'Calendar Colors', options: {}, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined }, 'ciyex.calendarColors', 'Calendar Colors', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		input.webview.setHtml(wrapSettingsHtml(body));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'ciyex.openPortalSettings', title: localize2('portalSettings', "Configure Patient Portal"), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const ws = accessor.get(IWebviewWorkbenchService);
		const body = `<h1>Patient Portal Configuration</h1><div class="card"><p>Portal settings editor coming soon.</p><p>Configure branding, features, forms, and navigation for the patient portal.</p></div>`;
		const input = ws.openWebview({ title: 'Patient Portal', options: {}, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined }, 'ciyex.portalSettings', 'Patient Portal', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		input.webview.setHtml(wrapSettingsHtml(body));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'ciyex.managePractice', title: localize2('managePractice', "Manage Practice Info"), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const ws = accessor.get(IWebviewWorkbenchService);
		const body = `<h1>Practice Information</h1><div class="card"><p>Practice settings editor coming soon.</p><p>Manage practice name, address, contact info, and regional settings.</p></div>`;
		const input = ws.openWebview({ title: 'Practice Info', options: {}, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined }, 'ciyex.practice', 'Practice Info', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		input.webview.setHtml(wrapSettingsHtml(body));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'ciyex.manageProviders', title: localize2('manageProviders', "Manage Providers"), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const api = accessor.get(ICiyexApiService);
		const ws = accessor.get(IWebviewWorkbenchService);
		let body: string;
		try {
			const res = await api.fetch('/api/providers?page=0&size=50');
			if (res.ok) {
				const data = await res.json();
				const providers = data?.data?.content || data?.content || [];
				let rows = '';
				for (const p of providers) {
					rows += `<tr><td>${p.firstName || ''} ${p.lastName || ''}</td><td>${p.npi || ''}</td><td>${p.specialty || ''}</td><td>${p.status || 'Active'}</td></tr>`;
				}
				body = `<h1>Providers</h1>
					<div class="card"><table>
						<thead><tr><th>Name</th><th>NPI</th><th>Specialty</th><th>Status</th></tr></thead>
						<tbody>${rows || '<tr><td colspan="4">No providers found</td></tr>'}</tbody>
					</table></div>`;
			} else {
				body = `<h1>Providers</h1><div class="card"><p>Failed to load providers</p></div>`;
			}
		} catch { body = '<h1>Providers</h1><div class="card"><p>Error loading providers</p></div>'; }
		const input = ws.openWebview({ title: 'Providers', options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined }, 'ciyex.providers', 'Providers', undefined, { group: ACTIVE_GROUP, preserveFocus: false });
		input.webview.setHtml(wrapSettingsHtml(body));
	}
});
