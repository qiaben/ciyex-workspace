/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ICiyexPermissionService } from './ciyexPermissionService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';

/**
 * Main EHR workbench contribution.
 * Loads permissions after login and registers status bar items.
 */
export class CiyexEhrContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.ciyexEhr';

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ICiyexPermissionService private readonly permissionService: ICiyexPermissionService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
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

		// Register status bar items
		this._registerStatusBarItems();
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
