/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import * as DOM from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ICiyexPermissionService } from './ciyexPermissionService.js';
import { ICiyexMenuService } from './ciyexMenuService.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexInstallationsService } from './ciyexInstallationsService.js';
import { CONTEXT_RCM_INSTALLED, RCM_APP_SLUG } from './rcm/rcmApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { PatientListDataProvider } from './patientListDataProvider.js';
import { ITreeViewDescriptor, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation, IViewDescriptorService } from '../../../common/views.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { INotificationsModel, NotificationChangeType } from '../../../common/notifications.js';
import { recordNotification } from './notificationHistoryLog.js';

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
		@ICiyexInstallationsService private readonly installationsService: ICiyexInstallationsService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@ICommandService private readonly commandService: ICommandService,
		@IViewsService private readonly viewsService: IViewsService,
		@IPaneCompositePartService private readonly paneCompositeService: IPaneCompositePartService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@INotificationService private readonly notificationService: INotificationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super();

		// Practice switcher — the status bar practice badge opens a picker of the
		// practices the account can use; choosing another one signs out to the
		// login page so the user authenticates into that practice.
		this._register(CommandsRegistry.registerCommand('ciyex.switchPractice', () => this._openPracticeSwitcher()));

		// Hide the bottom panel (Terminal/Problems/Output) — not needed in the EHR app
		this.layoutService.setPartHidden(true, Parts.PANEL_PART);

		this._ciyexConfigHome = URI.joinPath(this.environmentService.userRoamingDataHome, '.ciyex');
		this._ensureDefaultConfigs();

		// `ciyex.rcmInstalled` gates every RCM surface (Billing (RCM) sidebar,
		// rcm commands). Kept in sync with the marketplace installations —
		// onDidChangeInstallations fires on login load, post-checkout polling,
		// and reset() at sign-out, so purchase/logout show/hide RCM live.
		const rcmInstalledKey = CONTEXT_RCM_INSTALLED.bindTo(this.contextKeyService);
		rcmInstalledKey.set(this.installationsService.isInstalled(RCM_APP_SLUG));
		this._register(this.installationsService.onDidChangeInstallations(() => {
			rcmInstalledKey.set(this.installationsService.isInstalled(RCM_APP_SLUG));
		}));

		// Load permissions when authenticated
		if (this.authService.state === CiyexAuthState.Authenticated) {
			this._onAuthenticated();
		}

		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.Authenticated) {
				// Account switch detection. login()/signup()/changePassword() set
				// the auth state straight to Authenticated WITHOUT passing through
				// NotAuthenticated, so when a second account is used (or a brand-new
				// practice is signed up) on the same window, _onSignedOut() never
				// runs. The previous user's editor tabs keep their cached, tenant-
				// scoped data and the permissions/menus are never reloaded -> the new
				// account sees the previous account's data across every module.
				// If the identity (user + org) changed since we last bootstrapped,
				// tear the old session down first, then re-bootstrap for the new one.
				if (this._authenticated && this._readIdentity() !== this._currentIdentity) {
					this._onSignedOut();
				}
				this._onAuthenticated();
			} else if (state === CiyexAuthState.NotAuthenticated) {
				this._onSignedOut();
			}
		}));

		// Sidebar <-> Editor pairing
		// When a sidebar container is activated, auto-open its paired editor
		this._setupSidebarEditorPairing();

		// Auto-close native time/date pickers across every create & edit form.
		this._installTimePickerAutoClose();

		// Record every workbench notification into the 30-day action log that
		// backs the notification center's "Open Full History" tab.
		this._installNotificationHistoryRecorder();
	}

	/**
	 * Persist every notification shown in this workspace (saves, signs,
	 * billing, downloads, errors…) into the local 30-day history log. The
	 * notification center's expand-to-tab action renders this log day-by-day;
	 * entries older than 30 days are pruned automatically by the store.
	 */
	private _installNotificationHistoryRecorder(): void {
		const model = (this.notificationService as unknown as { model?: INotificationsModel }).model;
		if (!model?.onDidChangeNotification) { return; }
		this._register(model.onDidChangeNotification(e => {
			if (e.kind !== NotificationChangeType.ADD || !e.item) { return; }
			const severity = e.item.severity === Severity.Error ? 'error' : e.item.severity === Severity.Warning ? 'warning' : 'info';
			recordNotification({
				ts: Date.now(),
				severity,
				message: e.item.message.raw,
				source: e.item.source || undefined,
			});
		}));
	}

	/**
	 * Globally auto-dismiss the browser-native time / datetime picker the moment
	 * a value is committed. Chromium keeps the `<input type="time">` and
	 * `<input type="datetime-local">` spinner/popup open after the user picks a
	 * value — QA reported this across many modules (Appointments Start/End Time,
	 * Labs Result Date, Tasks, Operations, System, …). A `change` event fires
	 * once a complete value is selected; blurring the input then collapses the
	 * native popup so the wheel closes the instant a time is chosen.
	 *
	 * Done once here at the workbench level (capturing `change` listener per
	 * window) so every current and future EHR form gets the behaviour without
	 * each call site having to wire it up individually.
	 */
	private _installTimePickerAutoClose(): void {
		const attach = (targetWindow: Window) => {
			const store = new DisposableStore();
			const isNativePicker = (t: EventTarget | null): t is HTMLInputElement =>
				DOM.isHTMLInputElement(t) && (t.type === 'time' || t.type === 'datetime-local');
			// Blurring the input is what collapses Chromium's native spinner/popup.
			const closePicker = (input: HTMLInputElement) => {
				if (targetWindow.document.activeElement === input) { input.blur(); }
			};
			let pendingTimer: ReturnType<Window['setTimeout']> | undefined;
			const scheduleClose = (input: HTMLInputElement, delay: number) => {
				if (pendingTimer !== undefined) { targetWindow.clearTimeout(pendingTimer); }
				pendingTimer = targetWindow.setTimeout(() => { pendingTimer = undefined; closePicker(input); }, delay);
			};
			// `change` fires once a complete value commits — close immediately
			// (deferred a microtask so sibling handlers — duration mirroring,
			// end-time defaulting — see the new value before focus leaves).
			store.add(DOM.addDisposableListener(targetWindow.document, 'change', e => {
				if (isNativePicker(e.target) && e.target.value) { scheduleClose(e.target, 0); }
			}, true));
			// `input` fires on every spinner tick. On native time / datetime-local
			// pickers `change` frequently only fires when the popup is *manually*
			// dismissed (QA: "the time option is not closed when we select the time
			// … applicable for entire application"). Debounce a close so the popup
			// collapses a short moment after the user stops adjusting — long enough
			// to scroll hour→minute→AM/PM, short enough to feel automatic.
			store.add(DOM.addDisposableListener(targetWindow.document, 'input', e => {
				if (isNativePicker(e.target) && e.target.value) { scheduleClose(e.target, 800); }
			}, true));
			return store;
		};
		this._register(Event.runAndSubscribe(DOM.onDidRegisterWindow, ({ window, disposables }) => {
			disposables.add(attach(window));
		}, { window: mainWindow, disposables: this._store }));
	}

	/**
	 * Generic bidirectional sidebar <-> editor pairing.
	 *
	 * Direction 1: Click sidebar icon -> auto-open paired editor command
	 * Direction 2: Click editor tab -> auto-switch sidebar to paired container
	 *
	 * Add new pairs here -- no other code changes needed.
	 */
	private _setupSidebarEditorPairing(): void {
		// Sidebar container ID -> editor command (sidebar click opens editor)
		const sidebarToEditor: Record<string, string> = {
			'ciyex.calendar': 'ciyex.openCalendar',
			'ciyex.appointments': 'ciyex.openAppointments',
			'ciyex.tasks': 'ciyex.openTasks',
			// 'ciyex.patients' intentionally NOT here -- chart opens on patient click, not sidebar click
			// 'ciyex.messaging' intentionally NOT here -- conversation opens on channel click, not sidebar click
			'ciyex.developer': 'ciyex.openDeveloperPortal',
		};

		// Editor typeId -> sidebar container ID (editor tab click switches sidebar)
		const editorToSidebar: Record<string, string> = {
			'workbench.input.ciyexCalendar': 'ciyex.calendar',
			'workbench.input.ciyexAppointments': 'ciyex.appointments',
			'workbench.input.ciyexPatientChart': 'ciyex.patients',
			'workbench.input.ciyexEncounterForm': 'ciyex.encounters',
			'workbench.input.ciyexTasks': 'ciyex.tasks',
			'workbench.input.ciyexMessaging': 'ciyex.messaging',
			'workbench.input.ciyexPortalSettings': 'ciyex.portal-management',
			// Clinical editors -> Clinical sidebar
			'workbench.input.ciyexPrescriptions': 'ciyex.clinical',
			'workbench.input.ciyexLabs': 'ciyex.clinical',
			'workbench.input.ciyexImmunizations': 'ciyex.clinical',
			'workbench.input.ciyexReferrals': 'ciyex.clinical',
			'workbench.input.ciyexAuthorizations': 'ciyex.clinical',
			'workbench.input.ciyexCarePlans': 'ciyex.clinical',
			'workbench.input.ciyexCds': 'ciyex.system',
			'workbench.input.ciyexEducation': 'ciyex.clinical',
			// Operations editors -> Operations sidebar
			'workbench.input.ciyexRecall': 'ciyex.operations',
			'workbench.input.ciyexCodes': 'ciyex.operations',
			'workbench.input.ciyexInventory': 'ciyex.operations',
			'workbench.input.ciyexPayments': 'ciyex.operations',
			'workbench.input.ciyexClaims': 'ciyex.operations',
			// System editors -> System sidebar
			'workbench.input.ciyexConsents': 'ciyex.system',
			'workbench.input.ciyexNotifications': 'ciyex.system',
			'workbench.input.ciyexFax': 'ciyex.system',
			'workbench.input.ciyexDocScanning': 'ciyex.system',
			'workbench.input.ciyexKiosk': 'ciyex.system',
			'workbench.input.ciyexAuditLog': 'ciyex.system',
			// Developer Portal
			'workbench.input.ciyexDeveloperPortal': 'ciyex.developer',
		};

		// Container ID -> view ID inside it (force-open view when container activates)
		const containerToView: Record<string, string> = {
			'ciyex.calendar': 'ciyex.calendar.schedule',
			'ciyex.appointments': 'ciyex.appointments.sidebar',
			'ciyex.patients': 'ciyex.patients.list',
			'ciyex.encounters': 'ciyex.encounters.view',
			'ciyex.tasks': 'ciyex.tasks.sidebar',
			'ciyex.messaging': 'ciyex.messaging.channels',
			'ciyex.portal-management': 'ciyex.portal.docreviews',
			'ciyex.clinical': 'ciyex.clinical.menu',
			'ciyex.operations': 'ciyex.operations.menu',
			'ciyex.system': 'ciyex.system.menu',
			'ciyex.developer': 'ciyex.developer.menu',
			'ciyex.settings': 'ciyex.settings.list',
		};

		let _blockUntil = 0; // Timestamp-based debounce (200ms to prevent loops)

		// Direction 1: Sidebar -> Editor + force-open view
		this._register(this.paneCompositeService.onDidPaneCompositeOpen(e => {
			if (Date.now() < _blockUntil) { return; }
			const id = e.composite.getId();
			if (e.viewContainerLocation === ViewContainerLocation.Sidebar) {
				// Force-open the view inside the container
				const viewId = containerToView[id];
				if (viewId) { this.viewsService.openView(viewId, false).catch(() => { }); }
				// Open paired editor
				const cmd = sidebarToEditor[id];
				if (cmd) {
					_blockUntil = Date.now() + 200;
					this.commandService.executeCommand(cmd).catch(() => { });
				}
			}
		}));

		// Direction 2: Editor -> Sidebar (use both events for reliability)
		const switchSidebar = () => {
			if (Date.now() < _blockUntil) { return; }
			const input = this.editorService.activeEditorPane?.input;
			const typeId = input?.typeId;
			if (!typeId || !Object.prototype.hasOwnProperty.call(editorToSidebar, typeId)) { return; }

			// Snapshot-launched side panels (focused PatientChartEditorInput
			// and any EncounterFormEditorInput) shouldn't hijack the left
			// sidebar — the user opened them from a Schedule/Snapshot context
			// and expects that context to remain visible while they work.
			if (typeId === 'workbench.input.ciyexEncounterForm') { return; }
			if (typeId === 'workbench.input.ciyexPatientChart' && (input?.resource?.path || '').endsWith('/focused')) { return; }

			const containerId = editorToSidebar[typeId];
			_blockUntil = Date.now() + 200;
			this.paneCompositeService.openPaneComposite(containerId, ViewContainerLocation.Sidebar, false).then(() => {
				// Force-open the view inside the container (fixes collapsed/hidden state)
				const viewId = containerToView[containerId];
				if (viewId) { this.viewsService.openView(viewId, false).catch(() => { }); }
			}).catch(() => { });
		};
		this._register(this.editorService.onDidActiveEditorChange(switchSidebar));
		this._register(this.editorService.onDidVisibleEditorsChange(switchSidebar));

		// When the active editor moves to a non-patient page (e.g. Calendar),
		// close any focused PatientChartEditor tabs that were spawned by the
		// Snapshot quick-action toolbar — they shouldn't keep occupying the
		// side group when the user navigates away from a patient.
		const patientContextTypeIds = new Set<string>([
			'workbench.input.ciyexPatientSnapshot',
			'workbench.input.ciyexPatientChart',
			'workbench.input.ciyexEncounterForm',
		]);
		const closeStrayFocusedCharts = () => {
			const activeTypeId = this.editorService.activeEditorPane?.input?.typeId;
			if (activeTypeId && patientContextTypeIds.has(activeTypeId)) { return; }
			const focusedCharts = this.editorService.getEditors(EditorsOrder.SEQUENTIAL).filter(({ editor }) => {
				// Detect focused PatientChartEditorInput without importing the
				// concrete class (avoids a circular import chain). Resource URI
				// for focused mode ends with `/focused` per ciyexEditorInput.ts.
				if (editor.typeId !== 'workbench.input.ciyexPatientChart') { return false; }
				const path = editor.resource?.path || '';
				return path.endsWith('/focused');
			});
			if (focusedCharts.length > 0) {
				this.editorService.closeEditors(focusedCharts, { preserveFocus: true }).catch(() => { /* */ });
			}
		};
		this._register(this.editorService.onDidActiveEditorChange(closeStrayFocusedCharts));
	}

	private _authenticated = false;
	private _currentIdentity: string | undefined;
	private _statusBarEntries: { dispose(): void }[] = [];
	private _unreadPollTimer: number | undefined;

	/**
	 * Identity of the account the EHR last bootstrapped for: user id + org alias.
	 * Used to detect an in-place account switch (login/signup that goes straight
	 * to Authenticated without a NotAuthenticated transition) so we can tear down
	 * the previous user's cached editors/services before re-bootstrapping.
	 * Note: _storeAuth() writes these localStorage keys BEFORE firing the
	 * Authenticated state change, so they are already the NEW user's values here.
	 */
	private _readIdentity(): string {
		try {
			const uid = localStorage.getItem('ciyex_user_id') || localStorage.getItem('ciyex_email') || '';
			const org = localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') || '';
			return `${uid}|${org}`;
		} catch {
			return '';
		}
	}

	private _onSignedOut(): void {
		// Tear down everything tied to the previous user so the next login
		// fully re-bootstraps. Without this, a second user logging in after
		// sign-out keeps the first user's permissions, menus, role badge,
		// and any cached service state.
		this._authenticated = false;
		this._currentIdentity = undefined;
		this.permissionService.reset();
		this.menuService.reset();
		this.installationsService.reset();
		for (const entry of this._statusBarEntries) { entry.dispose(); }
		this._statusBarEntries = [];
		if (this._unreadEntry) { this._unreadEntry.dispose(); this._unreadEntry = null; }
		if (this._unreadPollTimer !== undefined) {
			const win = DOM.getActiveWindow();
			win.clearInterval(this._unreadPollTimer);
			this._unreadPollTimer = undefined;
		}
		this._closeCiyexEditors();
	}

	// Close every open Ciyex-typed editor (typeId prefix `workbench.input.ciyex`).
	// Why: editor panes load tenant-scoped data on instantiation and don't
	// re-fetch on auth state change. Without closing them, a different user
	// logging in next sees the prior user's data in modules like Tasks,
	// Clinical, Operations, System until they hard-refresh.
	private _closeCiyexEditors(): void {
		try {
			const ciyexEditors = this.editorService.getEditors(EditorsOrder.SEQUENTIAL)
				.filter(({ editor }) => editor.typeId.startsWith('workbench.input.ciyex'));
			if (ciyexEditors.length > 0) {
				this.editorService.closeEditors(ciyexEditors, { preserveFocus: true }).catch(() => { /* */ });
			}
		} catch (err) {
			this.logService.warn('[CiyexEhr] Failed to close editors on sign-out:', err);
		}
	}

	private async _onAuthenticated(): Promise<void> {
		if (this._authenticated) { return; }
		this._authenticated = true;
		this._currentIdentity = this._readIdentity();

		// Hide developer sidebar containers immediately (no API call)
		this._hideDevSidebarContainers();

		// Open Calendar editor + expand the Schedule sidebar panel.
		// Retry with increasing delays in case the editor service isn't ready yet.
		const openCalendar = () => this.commandService.executeCommand('ciyex.openCalendar').catch(() => { });
		const openSchedule = () => this.viewsService.openView('ciyex.calendar.schedule', false).catch(() => { });
		openCalendar();
		openSchedule();
		setTimeout(() => { openCalendar(); openSchedule(); }, 500);
		setTimeout(() => { openCalendar(); openSchedule(); }, 1500);

		// Load permissions, menus, marketplace installations, patient list, and
		// status bar in parallel. Installations gate paid extensions such as
		// telehealth — once an org purchases + installs the app from the Hub,
		// `/api/app-installations` returns it as active and the feature unlocks.
		Promise.all([
			this.permissionService.loadPermissions(),
			this.menuService.loadMenus(),
			this.installationsService.loadInstallations(),
		]).then(() => {
			this._registerStatusBarItems();
			this._startUnreadPolling();
		}).catch(() => { /* non-critical */ });

		this._wirePatientList();
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
			this._statusBarEntries.push(this.statusbarService.addEntry({
				name: 'Ciyex User',
				text: `$(account) ${userName}`,
				tooltip: `Signed in as ${email}`,
				ariaLabel: `User: ${userName}`,
			}, 'ciyex.user', StatusbarAlignment.RIGHT, 100));
		}

		// Practice/tenant — clicking it opens the practice switcher (QA: "how to
		// switch from one practice to another"). Shows the same-org practice
		// record the switcher selected, falling back to the tenant alias.
		const tenant = this._getSelectedPractice() || this._getTenant();
		if (tenant) {
			this._statusBarEntries.push(this.statusbarService.addEntry({
				name: 'Ciyex Practice',
				text: `$(organization) ${tenant}`,
				tooltip: `Practice: ${tenant} — click to switch practice`,
				ariaLabel: `Practice: ${tenant}`,
				command: 'ciyex.switchPractice',
			}, 'ciyex.practice', StatusbarAlignment.RIGHT, 99));
		}

		// Role
		const role = this.permissionService.role;
		if (role) {
			this._statusBarEntries.push(this.statusbarService.addEntry({
				name: 'Ciyex Role',
				text: `$(shield) ${role}`,
				tooltip: `Role: ${role}`,
				ariaLabel: `Role: ${role}`,
			}, 'ciyex.role', StatusbarAlignment.RIGHT, 98));
		}

		// Zoom controls
		this._statusBarEntries.push(this.statusbarService.addEntry({
			name: 'Zoom In',
			text: '$(zoom-in)',
			tooltip: 'Zoom In',
			ariaLabel: 'Zoom In',
			command: 'workbench.action.zoomIn',
		}, 'ciyex.zoomIn', StatusbarAlignment.RIGHT, 95));

		this._statusBarEntries.push(this.statusbarService.addEntry({
			name: 'Reset Zoom',
			text: '$(screen-full)',
			tooltip: 'Reset Zoom',
			ariaLabel: 'Reset Zoom',
			command: 'workbench.action.zoomReset',
		}, 'ciyex.zoomReset', StatusbarAlignment.RIGHT, 94));

		this._statusBarEntries.push(this.statusbarService.addEntry({
			name: 'Zoom Out',
			text: '$(zoom-out)',
			tooltip: 'Zoom Out',
			ariaLabel: 'Zoom Out',
			command: 'workbench.action.zoomOut',
		}, 'ciyex.zoomOut', StatusbarAlignment.RIGHT, 93));
	}

	/**
	 * Practice switcher (status bar → practice badge). Lists every practice the
	 * signed-in account can use — the organizations in the JWT `organization`
	 * claim plus the org's practice records — and switches IN PLACE whenever the
	 * signed-in credentials already cover the chosen practice (QA: "we don't
	 * want login … don't redirect login page"):
	 * - chosen org is in the JWT claim → swap the tenant and reload the window
	 *   (the stored token stays valid, so no login page);
	 * - chosen practice is a practice record of the CURRENT org → same tenant,
	 *   same credentials — just remember the selection and refresh the badge;
	 * - only an org the token does NOT grant still signs out to the login page,
	 *   because that practice genuinely needs different credentials.
	 */
	private async _openPracticeSwitcher(): Promise<void> {
		const tenant = this._getTenant();
		const current = this._getSelectedPractice() || tenant;
		const slug = (s: string): string => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

		// Organizations from the JWT claim — these are the real switchable tenants.
		const aliases: string[] = [];
		try {
			const token = localStorage.getItem('ciyex_token');
			const payload = token ? JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) : null;
			const org = payload?.organization;
			for (const o of Array.isArray(org) ? org : (org ? [org] : [])) {
				if (o && !aliases.includes(String(o))) { aliases.push(String(o)); }
			}
		} catch { /* claim unreadable — fall through to the practice records */ }

		// Practice records of the current org (Settings → General → Practice).
		const practices: Array<{ name: string; alias: string }> = [];
		try {
			const res = await this.apiService.fetch('/api/practices');
			if (res.ok) {
				const j = await res.json().catch(() => null);
				const list = (j?.data?.content ?? j?.data ?? j ?? []) as Array<Record<string, unknown>>;
				for (const p of Array.isArray(list) ? list : []) {
					const name = String(p.practiceName ?? p.name ?? '').trim();
					if (name) { practices.push({ name, alias: slug(name) }); }
				}
			}
		} catch { /* practices list is optional */ }

		type PracticePick = IQuickPickItem & { alias: string };
		const picks: PracticePick[] = [];
		const seen = new Set<string>();
		const add = (alias: string, label: string) => {
			if (!alias || seen.has(alias)) { return; }
			seen.add(alias);
			picks.push({
				label: `$(organization) ${label}`,
				description: alias === current ? 'Current practice' : alias,
				alias,
			});
		};
		for (const p of practices) { add(p.alias, p.name); }
		for (const a of aliases) { add(a, a); }
		add(current, current);
		// Current practice first, then alphabetical.
		picks.sort((a, b) => (a.alias === current ? -1 : b.alias === current ? 1 : a.label.localeCompare(b.label)));

		const chosen = await this.quickInputService.pick(picks, {
			title: 'Switch Practice',
			placeHolder: 'Select the practice to sign in to',
		});
		if (!chosen || chosen.alias === current) { return; }
		const chosenLabel = chosen.label.replace('$(organization) ', '');

		// The signed-in token already grants the chosen organization — switch the
		// tenant in place and reload the window so every open surface re-scopes.
		// The stored token survives the reload, so the user never sees the login page.
		if (aliases.includes(chosen.alias)) {
			try {
				localStorage.setItem('ciyex_selected_tenant', chosen.alias);
				localStorage.removeItem('ciyex_selected_practice');
			} catch { /* */ }
			this.notificationService.notify({
				severity: Severity.Info,
				message: `Switched to ${chosenLabel}.`,
			});
			await this.commandService.executeCommand('workbench.action.reloadWindow');
			return;
		}

		// A practice record of the CURRENT organization (Settings → Practice) —
		// same tenant, same credentials. Remember the selection and refresh the
		// status bar badge; no reload and no re-login needed.
		if (practices.some(p => p.alias === chosen.alias)) {
			try { localStorage.setItem('ciyex_selected_practice', chosen.alias); } catch { /* */ }
			for (const entry of this._statusBarEntries) { entry.dispose(); }
			this._statusBarEntries = [];
			this._registerStatusBarItems();
			this.notificationService.notify({
				severity: Severity.Info,
				message: `Switched to ${chosenLabel}.`,
			});
			return;
		}

		// An organization the token does not grant — different credentials are
		// required, so remember the choice and sign out to the login page.
		try { localStorage.setItem('ciyex_preferred_tenant', chosen.alias); } catch { /* */ }
		this.notificationService.notify({
			severity: Severity.Info,
			message: `Sign in again to continue in ${chosenLabel}.`,
		});
		this.authService.signOut();
	}

	/** Practice record (same-org) selection made by the practice switcher. */
	private _getSelectedPractice(): string {
		try {
			return localStorage.getItem('ciyex_selected_practice') || '';
		} catch {
			return '';
		}
	}

	private _unreadEntry: { dispose(): void } | null = null;

	private _startUnreadPolling(): void {
		const poll = async () => {
			try {
				const res = await this.apiService.fetch('/api/channels');
				if (!res.ok) { return; }
				const data = await res.json();
				const channels = (data?.data || data?.content || data || []) as Array<{ unreadCount?: number }>;
				const total = channels.reduce((sum: number, ch: { unreadCount?: number }) => sum + (ch.unreadCount || 0), 0);

				// Update or create status bar entry
				if (this._unreadEntry) { this._unreadEntry.dispose(); }
				if (total > 0) {
					this._unreadEntry = this.statusbarService.addEntry({
						name: 'Ciyex Messages',
						text: `$(comment-discussion) ${total}`,
						tooltip: `${total} unread message${total === 1 ? '' : 's'}`,
						ariaLabel: `${total} unread messages`,
						command: 'ciyex.openMessaging',
					}, 'ciyex.messaging.unread', StatusbarAlignment.RIGHT, 97);
				}
			} catch { /* */ }
		};

		poll();
		const win = DOM.getActiveWindow();
		this._unreadPollTimer = win.setInterval(poll, 30000);
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
	 * Files are written only if missing -- existing user configs are preserved.
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
