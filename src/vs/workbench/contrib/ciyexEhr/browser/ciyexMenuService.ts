/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { localize2 } from '../../../../nls.js';

export const ICiyexMenuService = createDecorator<ICiyexMenuService>('ciyexMenuService');

/**
 * Menu item as returned by the API: { items: [{ item: {...}, children: [{ item: {...}, children: [...] }] }] }
 */
export interface ICiyexMenuItem {
	id: string;
	itemKey: string;
	label: string;
	icon: string | null;
	screenSlug: string | null;
	position: number;
	requiredPermission: string | null;
	children?: ICiyexMenuItemEntry[];
}

export interface ICiyexMenuItemEntry {
	item: ICiyexMenuItem;
	children: ICiyexMenuItemEntry[];
}

export interface ICiyexMenuService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeMenus: Event<void>;
	readonly menuItems: ICiyexMenuItemEntry[];
	loadMenus(): Promise<void>;
}

export class CiyexMenuService extends Disposable implements ICiyexMenuService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMenus = this._register(new Emitter<void>());
	readonly onDidChangeMenus: Event<void> = this._onDidChangeMenus.event;

	private _menuItems: ICiyexMenuItemEntry[] = [];
	private readonly _menuDisposables = this._register(new DisposableStore());
	private readonly _dynamicMenuIds = new Map<string, MenuId>();

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
			// API returns { items: [{ item: {...}, children: [...] }] }
			this._menuItems = data?.items || data || [];
			this._registerAllMenus();
			this._onDidChangeMenus.fire();
			this.logService.info(`[CiyexMenu] Loaded ${this._menuItems.length} menu items from API`);
		} catch (err) {
			this.logService.warn('[CiyexMenu] Menu load error:', err);
		}
	}

	private _registerAllMenus(): void {
		this._menuDisposables.clear();

		// For each top-level menu item that has children, create a menu bar submenu
		// For leaf items, register as commands in a "Ciyex" menu
		let order = 2.5; // Start after Edit (2) and before View (4)

		for (const entry of this._menuItems) {
			const item = entry.item;
			const children = entry.children || [];

			if (children.length > 0) {
				// Parent with children -> create a submenu in the menu bar
				const menuId = this._getOrCreateMenuId(item.itemKey);

				// Register submenu in main menu bar
				this._menuDisposables.add(MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
					submenu: menuId,
					title: {
						...localize2(`ciyexMenu.${item.itemKey}`, item.label),
						mnemonicTitle: localize2(`ciyexMenuMn.${item.itemKey}`, `&&${item.label}`).value,
					},
					when: item.requiredPermission
						? ContextKeyExpr.and(ContextKeyExpr.has('ciyex.authenticated'), ContextKeyExpr.has(`ciyex.perm.${item.requiredPermission}`))
						: ContextKeyExpr.has('ciyex.authenticated'),
					order: order,
				}));

				// Register children as menu items in the submenu
				let childOrder = 1;
				for (const childEntry of children) {
					const child = childEntry.item;
					const commandId = `ciyex.nav.${child.itemKey}`;

					this._menuDisposables.add(MenuRegistry.addCommand({
						id: commandId,
						title: { value: child.label, original: child.label },
					}));

					const when = child.requiredPermission
						? ContextKeyExpr.has(`ciyex.perm.${child.requiredPermission}`)
						: undefined;

					this._menuDisposables.add(MenuRegistry.appendMenuItem(menuId, {
						command: { id: commandId, title: child.label },
						when,
						order: childOrder++,
					}));
				}

				order += 0.5;
			} else if (item.screenSlug) {
				// Leaf item without children -> register as a command
				const commandId = `ciyex.nav.${item.itemKey}`;
				this._menuDisposables.add(MenuRegistry.addCommand({
					id: commandId,
					title: { value: item.label, original: item.label },
				}));
			}
		}
	}

	private _getOrCreateMenuId(key: string): MenuId {
		let menuId = this._dynamicMenuIds.get(key);
		if (!menuId) {
			menuId = new MenuId(`MenubarCiyex_${key}`);
			this._dynamicMenuIds.set(key, menuId);
		}
		return menuId;
	}
}
