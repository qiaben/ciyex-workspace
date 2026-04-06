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

export interface ICiyexMenuItem {
	id: string;
	itemKey: string;
	label: string;
	icon: string | null;
	screenSlug: string | null;
	position: number;
	requiredPermission: string | null;
	children?: ICiyexMenuItem[];
}

export interface ICiyexMenuService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeMenus: Event<void>;
	readonly menuItems: ICiyexMenuItem[];
	loadMenus(): Promise<void>;
}

// Define new MenuIds for EHR top-level menus
const MenubarClinicalMenu = new MenuId('MenubarClinicalMenu');
const MenubarSchedulingMenu = new MenuId('MenubarSchedulingMenu');
const MenubarBillingMenu = new MenuId('MenubarBillingMenu');

// Clinical menu categories for grouping sidebar items into top menus
const CLINICAL_SLUGS = new Set([
	'/patients', '/all-encounters', '/prescriptions', '/labs',
	'/immunizations', '/care-plans', '/referrals', '/cds',
	'/consents', '/authorizations', '/document-scanning',
]);
const SCHEDULING_SLUGS = new Set(['/calendar', '/appointments', '/recall']);
const BILLING_SLUGS = new Set(['/payments', '/patients/claim-management']);

export class CiyexMenuService extends Disposable implements ICiyexMenuService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMenus = this._register(new Emitter<void>());
	readonly onDidChangeMenus: Event<void> = this._onDidChangeMenus.event;

	private _menuItems: ICiyexMenuItem[] = [];
	private readonly _menuDisposables = this._register(new DisposableStore());

	get menuItems(): ICiyexMenuItem[] { return this._menuItems; }

	constructor(
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Register the top-level EHR menus in the menu bar (always present, items populated dynamically)
		this._registerTopLevelMenus();
	}

	async loadMenus(): Promise<void> {
		try {
			const response = await this.apiService.fetch('/api/menus/ehr-sidebar');
			if (!response.ok) {
				this.logService.warn('[CiyexMenu] Failed to load menus:', response.status);
				return;
			}
			this._menuItems = await response.json();
			this._registerMenuItems();
			this._onDidChangeMenus.fire();
			this.logService.info(`[CiyexMenu] Loaded ${this._menuItems.length} menu items`);
		} catch (err) {
			this.logService.warn('[CiyexMenu] Menu load error:', err);
		}
	}

	private _registerTopLevelMenus(): void {
		// Clinical menu
		MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
			submenu: MenubarClinicalMenu,
			title: {
				...localize2('clinicalMenu', "Clinical"),
				mnemonicTitle: localize2('mClinical', "&&Clinical").value,
			},
			when: ContextKeyExpr.has('ciyex.authenticated'),
			order: 3, // After Edit
		});

		// Scheduling menu
		MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
			submenu: MenubarSchedulingMenu,
			title: {
				...localize2('schedulingMenu', "Scheduling"),
				mnemonicTitle: localize2('mScheduling', "&&Scheduling").value,
			},
			when: ContextKeyExpr.has('ciyex.perm.scheduling'),
			order: 2.5, // Before Clinical
		});

		// Billing menu
		MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
			submenu: MenubarBillingMenu,
			title: {
				...localize2('billingMenu', "Billing"),
				mnemonicTitle: localize2('mBilling', "&&Billing").value,
			},
			when: ContextKeyExpr.has('ciyex.perm.billing'),
			order: 5.5, // After Go
		});
	}

	private _registerMenuItems(): void {
		// Clear previous dynamic registrations
		this._menuDisposables.clear();

		const flatItems = this._flattenMenuItems(this._menuItems);

		for (const item of flatItems) {
			if (!item.screenSlug) {
				continue;
			}

			const commandId = `ciyex.nav.${item.itemKey}`;

			// Register the command
			this._menuDisposables.add(MenuRegistry.addCommand({
				id: commandId,
				title: { value: item.label, original: item.label },
			}));

			// Determine which top-level menu this item belongs to
			let targetMenu: MenuId;
			if (SCHEDULING_SLUGS.has(item.screenSlug)) {
				targetMenu = MenubarSchedulingMenu;
			} else if (BILLING_SLUGS.has(item.screenSlug)) {
				targetMenu = MenubarBillingMenu;
			} else if (CLINICAL_SLUGS.has(item.screenSlug)) {
				targetMenu = MenubarClinicalMenu;
			} else {
				continue; // Skip items that don't fit in our menus (Settings, Hub, etc.)
			}

			// Register menu item with permission gate
			const when = item.requiredPermission
				? ContextKeyExpr.has(`ciyex.perm.${item.requiredPermission}`)
				: undefined;

			this._menuDisposables.add(MenuRegistry.appendMenuItem(targetMenu, {
				command: { id: commandId, title: item.label },
				when,
				order: item.position,
			}));
		}
	}

	private _flattenMenuItems(items: ICiyexMenuItem[]): ICiyexMenuItem[] {
		const result: ICiyexMenuItem[] = [];
		for (const item of items) {
			result.push(item);
			if (item.children?.length) {
				result.push(...this._flattenMenuItems(item.children));
			}
		}
		return result;
	}
}
