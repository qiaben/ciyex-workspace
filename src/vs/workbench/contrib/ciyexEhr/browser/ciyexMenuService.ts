/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
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

const MenubarClinicalMenu = new MenuId('MenubarClinicalMenu');
const MenubarOperationsMenu = new MenuId('MenubarOperationsMenu');
const MenubarSystemMenu = new MenuId('MenubarSystemMenu');
const MenubarPortalMenu = new MenuId('MenubarPortalMenu');
const MenubarEhrSettingsMenu = new MenuId('MenubarEhrSettingsMenu');

// Register top-level EHR menus in the menu bar (STATIC - at module load)
// These show after login via 'ciyex.authenticated' context key

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarClinicalMenu,
	title: { ...localize2('clinicalMenu', "Clinical"), mnemonicTitle: localize2('mClinical', "&&Clinical").value },
	order: 2.5,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarOperationsMenu,
	title: { ...localize2('operationsMenu', "Operations"), mnemonicTitle: localize2('mOperations', "&&Operations").value },
	order: 3.5,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarSystemMenu,
	title: { ...localize2('systemMenu', "System"), mnemonicTitle: localize2('mSystem', "&&System").value },
	order: 5.5,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarPortalMenu,
	title: { ...localize2('portalMenu', "Portal"), mnemonicTitle: localize2('mPortal', "&&Portal").value },
	order: 6,
});

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
	submenu: MenubarEhrSettingsMenu,
	title: { ...localize2('ehrSettingsMenu', "EHR Settings"), mnemonicTitle: localize2('mEhrSettings', "EHR &&Settings").value },
	when: ContextKeyExpr.has('ciyex.role.admin'),
	order: 6.5,
});

// Placeholder commands so menus aren't empty at startup (empty = hidden by native menu bar)
CommandsRegistry.registerCommand('ciyex.nav._placeholder_clinical', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_operations', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_system', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_portal', () => { });
CommandsRegistry.registerCommand('ciyex.nav._placeholder_settings', () => { });

MenuRegistry.appendMenuItem(MenubarClinicalMenu, { command: { id: 'ciyex.nav._placeholder_clinical', title: 'Loading...' }, order: 0 });
MenuRegistry.appendMenuItem(MenubarOperationsMenu, { command: { id: 'ciyex.nav._placeholder_operations', title: 'Loading...' }, order: 0 });
MenuRegistry.appendMenuItem(MenubarSystemMenu, { command: { id: 'ciyex.nav._placeholder_system', title: 'Loading...' }, order: 0 });
MenuRegistry.appendMenuItem(MenubarPortalMenu, { command: { id: 'ciyex.nav._placeholder_portal', title: 'Loading...' }, order: 0 });
MenuRegistry.appendMenuItem(MenubarEhrSettingsMenu, { command: { id: 'ciyex.nav._placeholder_settings', title: 'Loading...' }, order: 0 });

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

		// Also register ALL menu items in the GlobalActivity (gear) menu
		let gearOrder = 10;
		for (const entry of this._menuItems) {
			const item = entry.item;
			const children = entry.children || [];

			if (children.length > 0) {
				// Parent with children: register each child in gear menu under 'ciyex_' group
				for (const childEntry of children) {
					const child = childEntry.item;
					const cmdId = `ciyex.gear.${child.itemKey}`;
					this._menuDisposables.add(MenuRegistry.addCommand({ id: cmdId, title: { value: `${item.label}: ${child.label}`, original: `${item.label}: ${child.label}` } }));
					this._menuDisposables.add(CommandsRegistry.registerCommand(cmdId, () => {
						this.logService.info(`[CiyexMenu] Gear: ${child.label} -> ${child.screenSlug}`);
					}));
					this._menuDisposables.add(MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
						command: { id: cmdId, title: `${item.label}: ${child.label}` },
						group: `5_ciyex_${item.itemKey}`,
						order: gearOrder++,
					}));
				}
			} else if (item.screenSlug) {
				// Leaf item: register directly in gear menu
				const cmdId = `ciyex.gear.${item.itemKey}`;
				this._menuDisposables.add(MenuRegistry.addCommand({ id: cmdId, title: { value: item.label, original: item.label } }));
				this._menuDisposables.add(CommandsRegistry.registerCommand(cmdId, () => {
					this.logService.info(`[CiyexMenu] Gear: ${item.label} -> ${item.screenSlug}`);
				}));
				this._menuDisposables.add(MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
					command: { id: cmdId, title: item.label },
					group: '5_ciyex_nav',
					order: gearOrder++,
				}));
			}
		}

		// Now register in top-level menu bar submenus
		for (const entry of this._menuItems) {
			const item = entry.item;
			const children = entry.children || [];

			if (children.length === 0) {
				continue; // Leaf items handled above and by sidebar ViewContainers
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
