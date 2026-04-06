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

// ─── Static MenuIds for EHR menus (registered at module load) ──────────
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

// Settings stays in gear menu only (not top-level)

// Placeholder commands so menus aren't empty at startup (disposable - cleared when real items load)
CommandsRegistry.registerCommand('ciyex.nav._placeholder', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_clinical', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_operations', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_system', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_portal', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_settings', () => { });

// Store placeholder menu items so they can be removed when real items load
const _placeholderDisposables: IDisposable[] = [];
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarCiyexMenu, { command: { id: 'ciyex.nav._placeholder', title: 'Loading...' }, group: '1_nav', order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarClinicalMenu, { command: { id: 'ciyex.nav._placeholder_clinical', title: 'Loading...' }, order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarOperationsMenu, { command: { id: 'ciyex.nav._placeholder_operations', title: 'Loading...' }, order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarSystemMenu, { command: { id: 'ciyex.nav._placeholder_system', title: 'Loading...' }, order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarPortalMenu, { command: { id: 'ciyex.nav._placeholder_portal', title: 'Loading...' }, order: 0 }));
_placeholderDisposables.push(MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, { command: { id: 'ciyex.nav._placeholder_settings', title: 'Loading...' }, order: 0 }));

// ─── Map API parent keys to static MenuIds ──────────────────────────
const MENU_MAP: Record<string, MenuId> = {
	'clinical': MenubarClinicalMenu,
	'operations': MenubarOperationsMenu,
	'system': MenubarSystemMenu,
	'portal-management': MenubarPortalMenu,
	'settings': MenubarEhrSettingsMenu,
};

// ─── Service Implementation ─────────────────────────────────────────

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
					this._menuDisposables.add(CommandsRegistry.registerCommand(cmdId, () => {
						this.logService.info(`[CiyexMenu] Settings: ${child.label} -> ${child.screenSlug}`);
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
				this._menuDisposables.add(CommandsRegistry.registerCommand(commandId, () => {
					this.logService.info(`[CiyexMenu] Navigate: ${item.label} -> ${item.screenSlug}`);
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

				this._menuDisposables.add(CommandsRegistry.registerCommand(commandId, () => {
					this.logService.info(`[CiyexMenu] Navigate: ${child.label} -> ${slug}`);
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
