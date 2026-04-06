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
		const defaults: Record<string, string> = {
			'settings.json': JSON.stringify({
				'ciyex.practice.name': '',
				'ciyex.practice.timezone': 'America/New_York',
				'ciyex.display.fontSize': 'default',
				'ciyex.calendar.defaultView': 'week',
				'ciyex.calendar.slotDuration': 15,
				'ciyex.session.idleTimeoutMinutes': 30,
				'ciyex.features.cdsHooksEnabled': true,
			}, null, 2),
			'layout.json': JSON.stringify({
				source: 'UNIVERSAL_DEFAULT',
				categories: [
					{ key: 'overview', label: 'Overview', position: 0, tabs: [{ key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', position: 0, visible: true, fhirResources: ['Patient'] }] },
					{ key: 'clinical', label: 'Clinical', position: 1, tabs: [
						{ key: 'encounters', label: 'Encounters', icon: 'ClipboardList', position: 0, visible: true, fhirResources: ['Encounter'] },
						{ key: 'problems', label: 'Problems', icon: 'AlertCircle', position: 1, visible: true, fhirResources: ['Condition'] },
						{ key: 'allergies', label: 'Allergies', icon: 'AlertTriangle', position: 2, visible: true, fhirResources: ['AllergyIntolerance'] },
						{ key: 'medications', label: 'Medications', icon: 'Pill', position: 3, visible: true, fhirResources: ['MedicationRequest'] },
						{ key: 'vitals', label: 'Vitals', icon: 'Activity', position: 4, visible: true, fhirResources: ['Observation'] },
						{ key: 'labs', label: 'Lab Results', icon: 'TestTube', position: 5, visible: true, fhirResources: ['DiagnosticReport'] },
						{ key: 'immunizations', label: 'Immunizations', icon: 'Syringe', position: 6, visible: true, fhirResources: ['Immunization'] },
					] },
					{ key: 'general', label: 'General', position: 2, tabs: [
						{ key: 'demographics', label: 'Demographics', icon: 'User', position: 0, visible: true, fhirResources: ['Patient'] },
						{ key: 'appointments', label: 'Appointments', icon: 'Calendar', position: 1, visible: true, fhirResources: ['Appointment'] },
						{ key: 'documents', label: 'Documents', icon: 'FileText', position: 2, visible: true, fhirResources: ['DocumentReference'] },
					] },
					{ key: 'financial', label: 'Financial', position: 3, tabs: [
						{ key: 'billing', label: 'Billing', icon: 'Receipt', position: 0, visible: true, fhirResources: ['Claim'] },
						{ key: 'insurance', label: 'Insurance', icon: 'Shield', position: 1, visible: true, fhirResources: ['Coverage'] },
					] },
				]
			}, null, 2),
			'menu.json': JSON.stringify({ items: [] }, null, 2),
			'encounter.json': JSON.stringify({ tabKey: 'encounter-form', source: 'UNIVERSAL_DEFAULT', sections: [] }, null, 2),
			'colors.json': JSON.stringify({ categories: [] }, null, 2),
			'portal.json': JSON.stringify({ general: {}, features: {}, forms: [], navigation: [] }, null, 2),
			'roles.json': JSON.stringify({ roles: [] }, null, 2),
		};

		try {
			for (const [filename, content] of Object.entries(defaults)) {
				const fileUri = URI.joinPath(this._ciyexConfigHome, filename);
				const exists = await this.fileService.exists(fileUri);
				if (!exists) {
					await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));
					this.logService.info(`[CiyexConfig] Created default: ${filename}`);
				}
			}
			this.logService.info(`[CiyexConfig] Config home: ${this._ciyexConfigHome.toString()}`);
		} catch (err) {
			this.logService.warn('[CiyexConfig] Failed to create default configs:', err);
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
