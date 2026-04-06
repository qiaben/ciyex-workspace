/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ICiyexPermissionService } from './ciyexPermissionService.js';
import { ICiyexMenuService } from './ciyexMenuService.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { PatientListDataProvider } from './patientListDataProvider.js';
import { ITreeViewDescriptor, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * Main EHR workbench contribution.
 * Loads permissions after login and registers status bar items.
 */
export class CiyexEhrContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.ciyexEhr';

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ICiyexPermissionService private readonly permissionService: ICiyexPermissionService,
		@ICiyexMenuService private readonly menuService: ICiyexMenuService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		// Load permissions when authenticated
		if (this.authService.state === CiyexAuthState.Authenticated) {
			this._onAuthenticated();
		}

		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.Authenticated) {
				this._onAuthenticated();
			}
		}));
	}

	private async _onAuthenticated(): Promise<void> {
		// Load permissions and set context keys
		await this.permissionService.loadPermissions();

		// Load API-driven menus
		await this.menuService.loadMenus();

		// Hide developer sidebar containers (Explorer, Search, SCM, Debug)
		this._hideDevSidebarContainers();

		// Wire patient list TreeView with API data
		this._wirePatientList();

		// Register status bar items
		this._registerStatusBarItems();
	}

	private _hideDevSidebarContainers(): void {
		// Only hide if showDevMenus is not enabled
		const showDev = this.contextKeyService.getContextKeyValue<boolean>('ciyex.showDevMenus');
		if (showDev) {
			return;
		}

		// Move default VS Code containers to auxiliary bar (right sidebar) so they don't clutter the main sidebar
		const devContainerIds = [
			'workbench.view.explorer',    // File Explorer
			'workbench.view.search',      // Search
			'workbench.view.scm',         // Source Control (Git)
			'workbench.view.debug',       // Run/Debug
		];

		for (const containerId of devContainerIds) {
			try {
				const container = this.viewDescriptorService.getViewContainerById(containerId);
				if (container) {
					this.viewDescriptorService.moveViewContainerToLocation(container, ViewContainerLocation.AuxiliaryBar, undefined, 'Ciyex EHR hides developer containers');
				}
			} catch {
				// Container might not exist or already moved
			}
		}
	}

	private _wirePatientList(): void {
		try {
			const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
			const viewDescriptor = viewsRegistry.getView('ciyex.patients.list');
			if (viewDescriptor) {
				const treeViewDescriptor = viewDescriptor as ITreeViewDescriptor;
				if (treeViewDescriptor.treeView) {
					const dataProvider = this._register(new PatientListDataProvider(this.apiService));
					treeViewDescriptor.treeView.dataProvider = dataProvider;
				}
			}
		} catch {
			// TreeView not ready yet, skip
		}
	}

	private _registerStatusBarItems(): void {
		const userName = this._getUserName();
		const email = this.authService.userEmail || '';

		// User info
		if (userName) {
			this.statusbarService.addEntry({
				name: 'Ciyex User',
				text: `$(account) ${userName}`,
				tooltip: `Signed in as ${email}`,
				ariaLabel: `User: ${userName}`,
			}, 'ciyex.user', StatusbarAlignment.RIGHT, 100);
		}

		// Practice/tenant
		const tenant = this._getTenant();
		if (tenant) {
			this.statusbarService.addEntry({
				name: 'Ciyex Practice',
				text: `$(organization) ${tenant}`,
				tooltip: `Practice: ${tenant}`,
				ariaLabel: `Practice: ${tenant}`,
			}, 'ciyex.practice', StatusbarAlignment.RIGHT, 99);
		}

		// Role
		const role = this.permissionService.role;
		if (role) {
			this.statusbarService.addEntry({
				name: 'Ciyex Role',
				text: `$(shield) ${role}`,
				tooltip: `Role: ${role}`,
				ariaLabel: `Role: ${role}`,
			}, 'ciyex.role', StatusbarAlignment.RIGHT, 98);
		}
	}

	private _getUserName(): string {
		try {
			return localStorage.getItem('ciyex_user_name') || '';
		} catch {
			return '';
		}
	}

	private _getTenant(): string {
		try {
			return localStorage.getItem('ciyex_selected_tenant') ||
				localStorage.getItem('ciyex_tenant') || '';
		} catch {
			return '';
		}
	}
}
