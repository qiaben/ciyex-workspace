/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { localize2 } from '../../../../nls.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

// Map API item keys to sidebar view IDs
const ITEM_KEY_TO_VIEW: Record<string, string> = {
	'calendar': 'ciyex.calendar.view',
	'appointments': 'ciyex.appointments.view',
	'patients': 'ciyex.patients.list',
	'encounters': 'ciyex.encounters.view',
	'tasks': 'ciyex.tasks.view',
	'messaging': 'ciyex.messaging.view',
	'reports': 'ciyex.reports.view',
	'hub': 'ciyex.hub.view',
	'developer-portal': 'ciyex.developer.view',
	// Children map to their parent container's views
	'prescriptions': 'ciyex.clinical.prescriptions',
	'labs': 'ciyex.clinical.labs',
	'immunizations': 'ciyex.clinical.immunizations',
	'referrals': 'ciyex.clinical.referrals',
	'authorizations': 'ciyex.clinical.authorizations',
	'care-plans': 'ciyex.clinical.careplans',
	'education': 'ciyex.clinical.education',
	'recall': 'ciyex.operations.recall',
	'codes': 'ciyex.operations.codes',
	'inventory-management': 'ciyex.operations.inventory',
	'payments': 'ciyex.operations.payments',
	'claim-management': 'ciyex.operations.claims',
	'clinical-alerts': 'ciyex.system.alerts',
	'consents': 'ciyex.system.consents',
	'notifications': 'ciyex.system.notifications',
	'fax': 'ciyex.system.fax',
	'document-scanning': 'ciyex.system.docscanning',
	'kiosk': 'ciyex.system.kiosk',
	'audit-log': 'ciyex.system.auditlog',
	'document-reviews': 'ciyex.portal.docreviews',
};

export const ICiyexMenuService = createDecorator<ICiyexMenuService>('ciyexMenuService');

export interface ICiyexMenuItemEntry {
	item: {
		id: string;
		itemKey: string;
		label: string;
		icon: string | null;
		screenSlug: string | null;
		position: number;
		requiredPermission: string | null;
	};
	children: ICiyexMenuItemEntry[];
}

export interface ICiyexMenuService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeMenus: Event<void>;
	readonly menuItems: ICiyexMenuItemEntry[];
	loadMenus(): Promise<void>;
}

// --- Static MenuIds for EHR menus (registered at module load) ----------
// These MUST be registered statically so the native macOS menu bar
// includes them when it's first built. Items are populated dynamically.

// Single "Ciyex" top-level menu with ALL items organized by section
const MenubarCiyexMenu = new MenuId('MenubarCiyexMenu');

// Also keep individual submenus for nested menus within Ciyex
const MenubarClinicalMenu = new MenuId('MenubarClinicalMenu');
const MenubarOperationsMenu = new MenuId('MenubarOperationsMenu');
const MenubarSystemMenu = new MenuId('MenubarSystemMenu');
const MenubarPortalMenu = new MenuId('MenubarPortalMenu');
const MenubarEhrSettingsMenu = new MenuId('MenubarEhrSettingsMenu');

// "Ciyex" menu for leaf items (Calendar, Appointments, Patients, etc.)
MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarCiyexMenu,
	title: { ...localize2('ciyexMenu', "Ciyex"), mnemonicTitle: localize2('mCiyex', "&&Ciyex").value },
	order: 0.5,
});

// Parent items with children become TOP-LEVEL menus (not nested inside Ciyex)
MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarClinicalMenu,
	title: { ...localize2('clinicalMenu', "Clinical"), mnemonicTitle: localize2('mClinical', "&&Clinical").value },
	order: 1,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarOperationsMenu,
	title: { ...localize2('operationsMenu', "Operations"), mnemonicTitle: localize2('mOperations', "&&Operations").value },
	order: 1.5,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarSystemMenu,
	title: { ...localize2('systemMenu', "System"), mnemonicTitle: localize2('mSystem', "S&&ystem").value },
	order: 2,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarPortalMenu,
	title: { ...localize2('portalMenu', "Portal"), mnemonicTitle: localize2('mPortal', "&&Portal").value },
	order: 2.5,
});

// Settings as submenu inside Ciyex menu (and also available via gear menu)
MenuRegistry.appendMenuItem(MenubarCiyexMenu, {
	submenu: MenubarEhrSettingsMenu,
	title: { ...localize2('settingsSubmenu', "Settings"), mnemonicTitle: localize2('mSettings', "&&Settings").value },
	group: '2_settings',
	order: 1,
});

// Static admin settings items in the Settings submenu
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openUserManagement', title: localize2('menuUserMgmt', "User Management").value },
	when: ContextKeyExpr.has('ciyex.role.admin'),
	group: '1_users',
	order: 1,
});
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openRolesConfig', title: localize2('menuRoles', "Roles & Permissions").value },
	when: ContextKeyExpr.has('ciyex.role.admin'),
	group: '1_users',
	order: 2,
});
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openMenuConfig', title: localize2('menuConfig', "Menu Configuration").value },
	when: ContextKeyExpr.has('ciyex.role.admin'),
	group: '2_layout',
	order: 3,
});
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openChartLayout', title: localize2('menuChartLayout', "Chart Layout").value },
	group: '2_layout',
	order: 4,
});
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openEncounterConfig', title: localize2('menuEncounter', "Encounter Form").value },
	group: '2_layout',
	order: 5,
});
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openCalendarColors', title: localize2('menuCalColors', "Calendar Colors").value },
	group: '3_settings',
	order: 6,
});
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openPortalConfig', title: localize2('menuPortal', "Patient Portal").value },
	group: '3_settings',
	order: 7,
});
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, {
	command: { id: 'ciyex.openSettings', title: localize2('menuSettings', "Settings").value },
	group: '4_settings',
	order: 8,
});

// Static gear menu items (all settings accessible from gear menu)
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: { id: 'ciyex.openSettings', title: localize2('gearSettings', "Ciyex Settings").value },
	group: '3_ciyex_settings',
	order: 1,
});
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: { id: 'ciyex.openChartLayout', title: localize2('gearChartLayout', "Chart Layout").value },
	group: '3_ciyex_settings',
	order: 2,
});
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: { id: 'ciyex.openEncounterConfig', title: localize2('gearEncounter', "Encounter Form").value },
	group: '3_ciyex_settings',
	order: 3,
});
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: { id: 'ciyex.openMenuConfig', title: localize2('gearMenuConfig', "Menu Config").value },
	group: '3_ciyex_settings',
	order: 4,
});
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: { id: 'ciyex.openCalendarColors', title: localize2('gearCalColors', "Calendar Colors").value },
	group: '3_ciyex_settings',
	order: 5,
});
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: { id: 'ciyex.openPortalConfig', title: localize2('gearPortal', "Patient Portal").value },
	group: '3_ciyex_settings',
	order: 6,
});
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	command: { id: 'ciyex.openRolesConfig', title: localize2('gearRoles', "Roles & Permissions").value },
	when: ContextKeyExpr.has('ciyex.role.admin'),
	group: '3_ciyex_settings',
	order: 7,
});

// Placeholder commands so menus aren't empty at startup (disposable - cleared when real items load)
CommandsRegistry.registerCommand('ciyex.nav._placeholder', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_clinical', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_operations', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_system', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_portal', () => { });

// Store placeholder menu items so they can be removed when real items load
const _placeholderDisposables: IDisposable[] = [];
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarCiyexMenu, { command: { id: 'ciyex.nav._placeholder', title: 'Loading...' }, group: '1_nav', order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarClinicalMenu, { command: { id: 'ciyex.nav._placeholder_clinical', title: 'Loading...' }, order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarOperationsMenu, { command: { id: 'ciyex.nav._placeholder_operations', title: 'Loading...' }, order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarSystemMenu, { command: { id: 'ciyex.nav._placeholder_system', title: 'Loading...' }, order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarPortalMenu, { command: { id: 'ciyex.nav._placeholder_portal', title: 'Loading...' }, order: 0 }));

// Static items in Ciyex menu (always visible, not from API)
MenuRegistry.appendMenuItem(MenubarCiyexMenu, {
	command: { id: 'workbench.action.newWindow', title: localize2('newWindow', "New Window").value },
	group: '0_window',
	order: 1,
});

MenuRegistry.appendMenuItem(MenubarCiyexMenu, {
	command: { id: 'workbench.action.closeWindow', title: localize2('closeWindow', "Close Window").value },
	group: '0_window',
	order: 2,
});

MenuRegistry.appendMenuItem(MenubarCiyexMenu, {
	command: { id: 'ciyex.signOut', title: localize2('signOutMenu', "Sign Out").value },
	group: '9_account',
	order: 99,
});

// --- Map API parent keys to static MenuIds --------------------------
const MENU_MAP: Record<string, MenuId> = {
	'clinical': MenubarClinicalMenu,
	'operations': MenubarOperationsMenu,
	'system': MenubarSystemMenu,
	'portal-management': MenubarPortalMenu,
	'settings': MenubarEhrSettingsMenu,
};

// --- Service Implementation -----------------------------------------

export class CiyexMenuService extends Disposable implements ICiyexMenuService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMenus = this._register(new Emitter<void>());
	readonly onDidChangeMenus: Event<void> = this._onDidChangeMenus.event;

	private _menuItems: ICiyexMenuItemEntry[] = [];
	private readonly _menuDisposables = this._register(new DisposableStore());

	get menuItems(): ICiyexMenuItemEntry[] { return this._menuItems; }

	constructor(
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async loadMenus(): Promise<void> {
		try {
			const response = await this.apiService.fetch('/api/menus/ehr-sidebar');
			if (!response.ok) {
				this.logService.warn('[CiyexMenu] Failed to load menus:', response.status);
				return;
			}
			const data = await response.json();
			this._menuItems = data?.items || data || [];
			this._populateMenus();
			this._onDidChangeMenus.fire();
			this.logService.info(`[CiyexMenu] Loaded ${this._menuItems.length} menu items from API`);

			// Force menu bar refresh after a delay (macOS native menu bar needs focus + rebuild)
			setTimeout(() => {
				window.focus();
			}, 1000);
		} catch (err) {
			this.logService.warn('[CiyexMenu] Menu load error:', err);
		}
	}

	private _populateMenus(): void {
		this._menuDisposables.clear();

		// Remove "Loading..." placeholders
		for (const d of _placeholderDisposables) {
			d.dispose();
		}
		_placeholderDisposables.length = 0;

		// Only "Settings" menu items go in the gear menu (GlobalActivity)
		// Everything else goes in the top menu bar and sidebar only
		let gearOrder = 10;
		for (const entry of this._menuItems) {
			const item = entry.item;
			const children = entry.children || [];

			// Only the "settings" parent goes into the gear menu
			if (item.itemKey === 'settings' && children.length > 0) {
				for (const childEntry of children) {
					const child = childEntry.item;
					const cmdId = `ciyex.gear.${child.itemKey}`;
					this._menuDisposables.add(MenuRegistry.addCommand({ id: cmdId, title: { value: child.label, original: child.label } }));
					this._menuDisposables.add(CommandsRegistry.registerCommand(cmdId, (accessor) => {
						const viewsService = accessor.get(IViewsService);
						const viewId = ITEM_KEY_TO_VIEW[child.itemKey];
						if (viewId) {
							viewsService.openView(viewId, true);
						}
						this.logService.info(`[CiyexMenu] Settings: ${child.label} -> ${viewId || child.screenSlug}`);
					}));
					this._menuDisposables.add(MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
						command: { id: cmdId, title: child.label },
						group: '3_ciyex_settings',
						order: gearOrder++,
					}));
				}
			}
		}

		// Register leaf items directly in the Ciyex menu (top group)
		let leafOrder = 1;
		for (const entry of this._menuItems) {
			const item = entry.item;
			const children = entry.children || [];

			if (children.length === 0 && item.screenSlug) {
				const commandId = `ciyex.nav.${item.itemKey}`;
				this._menuDisposables.add(MenuRegistry.addCommand({ id: commandId, title: { value: item.label, original: item.label } }));
				this._menuDisposables.add(CommandsRegistry.registerCommand(commandId, (accessor) => {
					const viewsService = accessor.get(IViewsService);
					const viewId = ITEM_KEY_TO_VIEW[item.itemKey];
					if (viewId) {
						viewsService.openView(viewId, true);
					}
					this.logService.info(`[CiyexMenu] Navigate: ${item.label} -> ${viewId || item.screenSlug}`);
				}));
				this._menuDisposables.add(MenuRegistry.appendMenuItem(MenubarCiyexMenu, {
					command: { id: commandId, title: item.label },
					group: '1_nav',
					order: leafOrder++,
				}));
			}
		}

		// Register parent menus in their submenus (Clinical, Operations, System, etc.)
		for (const entry of this._menuItems) {
			const item = entry.item;
			const children = entry.children || [];

			if (children.length === 0) {
				continue;
			}

			// Find the static MenuId for this parent
			const targetMenu = MENU_MAP[item.itemKey];
			if (!targetMenu) {
				this.logService.trace(`[CiyexMenu] No static menu for parent: ${item.itemKey}`);
				continue;
			}

			// Register children into the static menu
			let childOrder = 1;
			for (const childEntry of children) {
				const child = childEntry.item;
				const commandId = `ciyex.nav.${child.itemKey}`;
				const slug = child.screenSlug || '';

				// Register command metadata + handler
				this._menuDisposables.add(MenuRegistry.addCommand({
					id: commandId,
					title: { value: child.label, original: child.label },
				}));

				this._menuDisposables.add(CommandsRegistry.registerCommand(commandId, (accessor) => {
					const viewsService = accessor.get(IViewsService);
					const viewId = ITEM_KEY_TO_VIEW[child.itemKey];
					if (viewId) {
						viewsService.openView(viewId, true);
					}
					this.logService.info(`[CiyexMenu] Navigate: ${child.label} -> ${viewId || slug}`);
				}));

				// Register menu item
				const when = child.requiredPermission
					? ContextKeyExpr.has(`ciyex.perm.${child.requiredPermission}`)
					: undefined;

				this._menuDisposables.add(MenuRegistry.appendMenuItem(targetMenu, {
					command: { id: commandId, title: child.label },
					when,
					order: childOrder++,
				}));
			}
		}
	}
}
