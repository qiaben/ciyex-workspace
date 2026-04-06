/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { CiyexConfigEditorInput } from './editors/ciyexEditorInput.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

// Admin Menu
const MenubarAdminMenu = new MenuId('MenubarAdminMenu');

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarAdminMenu,
	title: { ...localize2('adminMenu', "Admin"), mnemonicTitle: localize2('mAdmin', "&&Admin").value },
	when: ContextKeyExpr.has('ciyex.role.admin'),
	order: 7,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openUserManagement', title: 'User Management' }, group: 'users', order: 1 });
MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openRolesConfig', title: 'Roles & Permissions' }, group: 'users', order: 2 });
MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openMenuConfig', title: 'Menu Configuration' }, group: 'layout', order: 3 });
MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openChartLayout', title: 'Chart Layout' }, group: 'layout', order: 4 });
MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openEncounterConfig', title: 'Encounter Form' }, group: 'layout', order: 5 });
MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openCalendarColors', title: 'Calendar Colors' }, group: 'settings', order: 6 });
MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openPortalConfig', title: 'Patient Portal' }, group: 'settings', order: 7 });
MenuRegistry.appendMenuItem(MenubarAdminMenu, { command: { id: 'ciyex.openSettings', title: 'Settings' }, group: 'practice', order: 8 });

// Helpers

function openVisual(accessor: ServicesAccessor, path: string, label: string, icon: string, editorId: string): void {
	const editorService = accessor.get(IEditorService);
	const env = accessor.get(IEnvironmentService);
	const inst = accessor.get(IInstantiationService);
	const uri = URI.joinPath(env.userRoamingDataHome, '.ciyex', path);
	const input = inst.createInstance(CiyexConfigEditorInput, path, uri, label, ThemeIcon.fromId(icon), editorId);
	editorService.openEditor(input);
}

function openJson(accessor: ServicesAccessor, path: string): void {
	const editorService = accessor.get(IEditorService);
	const env = accessor.get(IEnvironmentService);
	editorService.openEditor({ resource: URI.joinPath(env.userRoamingDataHome, '.ciyex', path), options: { pinned: true } });
}

// Commands - Visual Editors

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openSettings', title: localize2('openSettings', "Open Ciyex Settings"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openJson(accessor, 'settings.json'); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openChartLayout', title: localize2('chartLayout', "Open Chart Layout"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openVisual(accessor, 'layout.json', 'Chart Layout', 'layout', 'workbench.editor.ciyexLayout'); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openEncounterConfig', title: localize2('encounterConfig', "Open Encounter Form"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openVisual(accessor, 'encounter.json', 'Encounter Form', 'notebook', 'workbench.editor.ciyexEncounter'); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openMenuConfig', title: localize2('menuConfig', "Open Menu Configuration"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openVisual(accessor, 'menu.json', 'Menu Configuration', 'list-tree', 'workbench.editor.ciyexMenu'); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openCalendarColors', title: localize2('calendarColors', "Open Calendar Colors"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openVisual(accessor, 'colors.json', 'Calendar Colors', 'symbol-color', 'workbench.editor.ciyexColors'); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openPortalConfig', title: localize2('portalConfig', "Open Patient Portal"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openJson(accessor, 'portal.json'); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openRolesConfig', title: localize2('rolesConfig', "Open Roles & Permissions"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openVisual(accessor, 'roles.json', 'Roles & Permissions', 'shield', 'workbench.editor.ciyexRoles'); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openFieldConfig', title: localize2('fieldConfig', "Open Field Configuration"), f1: true }); }
	async run(accessor: ServicesAccessor, tabKey?: string): Promise<void> {
		const key = tabKey || 'demographics';
		openVisual(accessor, `fields/${key}.json`, `Fields: ${key}`, 'symbol-field', 'workbench.editor.ciyexFieldConfig');
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openUserManagement', title: localize2('manageUsers', "Manage Users"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { openVisual(accessor, 'roles.json', 'Roles & Permissions', 'shield', 'workbench.editor.ciyexRoles'); }
});
