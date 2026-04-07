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
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Main EHR workbench contribution.
 * Loads permissions after login and registers status bar items.
 */
export class CiyexEhrContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.ciyexEhr';

	private readonly _ciyexConfigHome: URI;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ICiyexPermissionService private readonly permissionService: ICiyexPermissionService,
		@ICiyexMenuService private readonly menuService: ICiyexMenuService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// .ciyex config folder in user data home (~/.ciyex-workspace/.ciyex/)
		this._ciyexConfigHome = URI.joinPath(this.environmentService.userRoamingDataHome, '.ciyex');

		// Copy default configs on startup (before auth)
		this._ensureDefaultConfigs();

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

	/**
	 * Copy default .ciyex config files to user data home if they don't exist.
	 * Files are written only if missing — existing user configs are preserved.
	 */
	private async _ensureDefaultConfigs(): Promise<void> {
		// Try to copy from workspace .ciyex/ folder first (has full configs from repo)
		// Fall back to minimal defaults if workspace not available
		const configFiles = [
			'settings.json', 'chart-layout.json', 'encounter.json', 'menu.json',
			'colors.json', 'portal.json', 'roles.json',
		];

		try {
			// Check if workspace has .ciyex/ folder with configs
			let workspaceCiyexRoot: URI | undefined;

			// Try common workspace paths for .ciyex/ folder
			const possibleRoots = [
				URI.file('/Users/siva/ciyex-workspace/ciyex-workspace/.ciyex'),
				// Could also be process.cwd()/.ciyex but we're in browser context
			];

			for (const root of possibleRoots) {
				if (await this.fileService.exists(root)) {
					workspaceCiyexRoot = root;
					break;
				}
			}

			for (const filename of configFiles) {
				const targetUri = URI.joinPath(this._ciyexConfigHome, filename);
				if (await this.fileService.exists(targetUri)) {
					continue; // Don't overwrite existing configs
				}

				// Try to copy from workspace
				if (workspaceCiyexRoot) {
					const sourceUri = URI.joinPath(workspaceCiyexRoot, filename);
					if (await this.fileService.exists(sourceUri)) {
						const content = await this.fileService.readFile(sourceUri);
						await this.fileService.writeFile(targetUri, content.value);
						this.logService.info(`[CiyexConfig] Copied from workspace: ${filename}`);
						continue;
					}
				}

				// Fall back to minimal default
				const defaultContent = this._getMinimalDefault(filename);
				await this.fileService.writeFile(targetUri, VSBuffer.fromString(defaultContent));
				this.logService.info(`[CiyexConfig] Created minimal default: ${filename}`);
			}

			// Also copy fields/ directory if workspace has it
			if (workspaceCiyexRoot) {
				const fieldsSource = URI.joinPath(workspaceCiyexRoot, 'fields');
				if (await this.fileService.exists(fieldsSource)) {
					try {
						const fieldsDir = await this.fileService.resolve(fieldsSource);
						if (fieldsDir.children) {
							for (const child of fieldsDir.children) {
								if (child.name.endsWith('.json')) {
									const targetField = URI.joinPath(this._ciyexConfigHome, 'fields', child.name);
									if (!await this.fileService.exists(targetField)) {
										const content = await this.fileService.readFile(child.resource);
										await this.fileService.writeFile(targetField, content.value);
										this.logService.info(`[CiyexConfig] Copied field config: ${child.name}`);
									}
								}
							}
						}
					} catch { /* fields dir not accessible */ }
				}
			}

			this.logService.info(`[CiyexConfig] Config home: ${this._ciyexConfigHome.toString()}`);
		} catch (err) {
			this.logService.warn('[CiyexConfig] Failed to create default configs:', err);
		}
	}

	private _getMinimalDefault(filename: string): string {
		switch (filename) {
			case 'settings.json': return JSON.stringify({ 'ciyex.practice.name': '', 'ciyex.practice.timezone': 'America/New_York', 'ciyex.display.fontSize': 'default', 'ciyex.calendar.defaultView': 'week', 'ciyex.session.idleTimeoutMinutes': 30, 'ciyex.features.cdsHooksEnabled': true }, null, 2);
			case 'chart-layout.json': return JSON.stringify({ source: 'UNIVERSAL_DEFAULT', categories: [{ key: 'clinical', label: 'Clinical', position: 0, tabs: [{ key: 'encounters', label: 'Encounters', icon: 'ClipboardList', position: 0, visible: true, fhirResources: ['Encounter'] }, { key: 'demographics', label: 'Demographics', icon: 'User', position: 1, visible: true, fhirResources: ['Patient'] }] }] }, null, 2);
			case 'encounter.json': return JSON.stringify({ tabKey: 'encounter-form', source: 'UNIVERSAL_DEFAULT', sections: [{ key: 'cc', title: 'Chief Complaint', columns: 1, visible: true, fields: [{ key: 'chiefComplaint', label: 'Chief Complaint', type: 'textarea', required: true }] }] }, null, 2);
			case 'menu.json': return JSON.stringify({ items: [{ itemKey: 'calendar', label: 'Calendar', icon: 'Calendar', screenSlug: '/calendar', position: 0, visible: true, children: [] }, { itemKey: 'patients', label: 'Patients', icon: 'Users', screenSlug: '/patients', position: 1, visible: true, children: [] }] }, null, 2);
			case 'colors.json': return JSON.stringify({ categories: [{ key: 'visit-type', label: 'Visit Types', colors: [{ entityKey: 'new-patient', entityLabel: 'New Patient', bgColor: '#4CAF50', borderColor: '#4CAF50', textColor: '#ffffff' }] }] }, null, 2);
			case 'portal.json': return JSON.stringify({ general: { name: 'Patient Portal' }, features: { onlineBooking: true, messaging: true, labResults: true }, forms: [], navigation: [{ key: 'dashboard', label: 'Dashboard', route: '/', icon: 'Home', visible: true }] }, null, 2);
			case 'roles.json': return JSON.stringify({ roles: [{ id: 'admin', name: 'admin', label: 'Administrator', description: 'Full system access', isSystem: true, smartScopes: ['Patient.read', 'Patient.write', 'Encounter.read', 'Encounter.write'], permissions: ['patients.view', 'patients.create', 'patients.edit', 'admin.view', 'admin.edit'] }] }, null, 2);
			default: return '{}';
		}
	}

	/** Get the .ciyex config home URI for opening files */
	get ciyexConfigHome(): URI {
		return this._ciyexConfigHome;
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
