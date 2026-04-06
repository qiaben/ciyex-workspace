/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { CiyexConfigEditorInput } from './editors/ciyexEditorInput.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

// --- Admin Menu (top-level menu bar) ---------------------------------

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

// --- Admin Menu Items ------------------------------------------------

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openUserManagement', title: 'User Management' },
	group: 'users',
	order: 1,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openRolesConfig', title: 'Roles & Permissions' },
	group: 'users',
	order: 2,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openMenuConfig', title: 'Menu Configuration' },
	group: 'layout',
	order: 3,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openChartLayout', title: 'Chart Layout' },
	group: 'layout',
	order: 4,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openEncounterConfig', title: 'Encounter Form' },
	group: 'layout',
	order: 5,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openCalendarColors', title: 'Calendar Colors' },
	group: 'settings',
	order: 6,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openPortalConfig', title: 'Patient Portal' },
	group: 'settings',
	order: 7,
});

MenuRegistry.appendMenuItem(MenubarAdminMenu, {
	command: { id: 'ciyex.openSettings', title: 'Settings' },
	group: 'practice',
	order: 8,
});


// --- Helper: open a .ciyex JSON file in Monaco editor ----------------

async function openCiyexConfig(accessor: ServicesAccessor, relativePath: string): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const environmentService = accessor.get(IEnvironmentService);

	// Open from user data home: ~/.ciyex-workspace/.ciyex/{file}
	const fileUri = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex', relativePath);

	await editorService.openEditor({
		resource: fileUri,
		options: { pinned: true },
	});
}

// --- Settings Commands (open .ciyex/*.json in Monaco) ----------------

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openSettings',
			title: localize2('openSettings', "Open Ciyex Settings"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await openCiyexConfig(accessor, 'settings.json');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openChartLayout',
			title: localize2('chartLayout', "Open Chart Layout"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const environmentService = accessor.get(IEnvironmentService);
		const instantiationService = accessor.get(IInstantiationService);
		const fileUri = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex', 'layout.json');
		const input = instantiationService.createInstance(CiyexConfigEditorInput, 'layout', fileUri, 'Chart Layout', ThemeIcon.fromId('layout'));
		await editorService.openEditor(input);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openEncounterConfig',
			title: localize2('encounterConfig', "Open Encounter Form Config"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await openCiyexConfig(accessor, 'encounter.json');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openMenuConfig',
			title: localize2('menuConfig', "Open Menu Configuration"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await openCiyexConfig(accessor, 'menu.json');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openCalendarColors',
			title: localize2('calendarColors', "Open Calendar Colors"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await openCiyexConfig(accessor, 'colors.json');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openPortalConfig',
			title: localize2('portalConfig', "Open Patient Portal Config"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await openCiyexConfig(accessor, 'portal.json');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openRolesConfig',
			title: localize2('rolesConfig', "Open Roles & Permissions"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await openCiyexConfig(accessor, 'roles.json');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openFieldConfig',
			title: localize2('fieldConfig', "Open Field Configuration"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor, tabKey?: string): Promise<void> {
		await openCiyexConfig(accessor, `fields/${tabKey || 'demographics'}.json`);
	}
});

// --- User Management (still needs webview — CRUD list, not a JSON file) --

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openUserManagement',
			title: localize2('manageUsers', "Manage Users"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		// User management is a CRUD list view — not a JSON config file.
		// This will be implemented as a proper VS Code view/panel later.
		// For now, open roles.json as the closest config.
		await openCiyexConfig(accessor, 'roles.json');
	}
});
