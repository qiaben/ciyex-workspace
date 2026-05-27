/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexInstallationsService } from './ciyexInstallationsService.js';
import { ICiyexAuthService } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { ICiyexPaymentService, CheckoutRequest, CheckoutResult, RegisteredGateway } from './ciyexPaymentService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IEditorService, ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { CalendarEditorInput, PatientChartEditorInput, EncounterFormEditorInput, MessagingEditorInput, PortalSettingsEditorInput, RolesEditorInput2, TasksEditorInput, PrescriptionsEditorInput, ImmunizationsEditorInput, ReferralsEditorInput, CarePlansEditorInput, CdsEditorInput, AuthorizationsEditorInput, AppointmentsEditorInput, LabsEditorInput, EducationEditorInput, RecallEditorInput, CodesEditorInput, InventoryEditorInput, PaymentsEditorInput, ClaimsEditorInput, ConsentsEditorInput, NotificationsEditorInput, FaxEditorInput, DocScanningEditorInput, KioskEditorInput, AuditLogEditorInput, DeveloperPortalEditorInput, PracticeSettingsEditorInput, LayoutSettingsEditorInput, SettingsHubEditorInput, LayoutHubEditorInput, DocumentReviewEditorInput, FormSubmissionEditorInput, PatientApprovalEditorInput, TelehealthEditorInput, PatientSnapshotEditorInput } from './editors/ciyexEditorInput.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Build dark-themed HTML wrapper for webview content.
 */
function wrapHtml(body: string): string {
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: var(--vscode-editor-background, #1e1e1e);
			color: var(--vscode-editor-foreground, #cccccc);
			padding: 20px;
			margin: 0;
			font-size: 13px;
			line-height: 1.5;
		}
		h1, h2, h3 { color: var(--vscode-editor-foreground, #fff); margin: 0 0 12px; }
		.card {
			background: var(--vscode-editorWidget-background, #252526);
			border: 1px solid var(--vscode-editorWidget-border, #3c3c3c);
			border-radius: 6px;
			padding: 16px;
			margin-bottom: 16px;
		}
		.grid { display: grid; grid-template-columns: 140px 1fr; gap: 6px; }
		.label { color: var(--vscode-descriptionForeground, #858585); }
		table { width: 100%; border-collapse: collapse; }
		th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-editorWidget-border, #3c3c3c); }
		th { color: var(--vscode-descriptionForeground, #858585); font-weight: 500; font-size: 11px; text-transform: uppercase; }
		.status-active { color: #4ec9b0; }
	</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * Command: Open Patient Chart
 *
 * IMPORTANT: accessor.get() must be called BEFORE any await.
 * VS Code invalidates the accessor after the synchronous run() returns.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openPatientChart',
			title: localize2('openPatientChart', "Open Patient Chart"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, patientId?: string, patientName?: string, initialTab?: string): Promise<void> {
		const editorService = accessor.get(IEditorService);

		// If no patientId, search for a patient
		if (!patientId) {
			const apiService = accessor.get(ICiyexApiService);
			try {
				const res = await apiService.fetch('/api/patients?page=0&size=20&sort=lastName,asc');
				if (res.ok) {
					const data = await res.json();
					const patients = data?.data?.content || data?.content || [];
					if (patients.length > 0) {
						// Open first patient as default
						const p = patients[0] as Record<string, string>;
						patientId = p.id || p.fhirId;
						patientName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
					}
				}
			} catch { /* */ }
			if (!patientId) { return; }
		}

		const input = new PatientChartEditorInput(patientId, patientName || `Patient ${patientId}`, initialTab);
		await editorService.openEditor(input, { pinned: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openPatientSnapshot',
			title: localize2('openPatientSnapshot', "Open Patient Snapshot"),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, patientId?: string, patientName?: string, appointmentId?: string): Promise<void> {
		const editorService = accessor.get(IEditorService);
		if (!patientId) { return; }
		const input = new PatientSnapshotEditorInput(patientId, patientName || `Patient ${patientId}`, appointmentId);
		await editorService.openEditor(input, { pinned: false });
	}
});

/* OLD webview patient chart — replaced by PatientChartEditor EditorPane */
/*registerAction2(class extends Action2_DISABLED {
	constructor() {
		super({
			id: 'ciyex.openPatientChart_OLD',
			title: localize2('openPatientChart', "Open Patient Chart"),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, patientId?: string, patientName?: string): Promise<void> {
		if (!patientId) {
			return;
		}
		const apiService = accessor.get(ICiyexApiService);
		const webviewService = accessor.get(IWebviewWorkbenchService);
		const label = patientName || `Patient ${patientId}`;

		let body: string;
		try {
			// Fetch patient + tab layout + encounters in parallel
			const [patientRes, layoutRes, encRes] = await Promise.all([
				apiService.fetch(`/api/patients/${patientId}`),
				apiService.fetch('/api/tab-field-config/layout'),
				apiService.fetch(`/api/encounters?patientId=${patientId}&page=0&size=20`),
			]);

			const p = patientRes.ok ? ((await patientRes.json())?.data || {}) : {} as Record<string, string>;
			const layout = layoutRes.ok ? ((await layoutRes.json())?.data || {}) : {} as Record<string, unknown>;
			const encounters = encRes.ok ? ((await encRes.json())?.data?.content || []) : [] as Record<string, string>[];

			// Tab buttons from layout API
			const tabGroups = (layout as Record<string, unknown>).tabConfig as Array<Record<string, unknown>> || [];
			let tabBtns = '';
			for (const group of tabGroups) {
				for (const tab of (group.tabs as Array<Record<string, unknown>> || [])) {
					if (!(tab as Record<string, boolean>).visible) { continue; }
					const key = tab.key as string;
					const lbl = tab.label as string;
					const cls = key === 'demographics' ? 'tab-active' : '';
					tabBtns += `<button class="tab-btn ${cls}" onclick="showTab('${key}')">${lbl}</button>`;
				}
			}
			if (!tabBtns) {
				tabBtns = '<button class="tab-btn tab-active" onclick="showTab(\'demographics\')">Demographics</button><button class="tab-btn" onclick="showTab(\'encounters\')">Encounters</button>';
			}

			// Encounter rows
			let encRows = '';
			for (const e of encounters) {
				encRows += `<tr><td>${(e as Record<string, string>).encounterDate || (e as Record<string, string>).startDate || ''}</td><td>${(e as Record<string, string>).encounterProvider || ''}</td><td>${(e as Record<string, string>).type || ''}</td><td>${(e as Record<string, string>).status || ''}</td></tr>`;
			}

			const hue = ((p.firstName || '').charCodeAt(0) * 7 + (p.lastName || '').charCodeAt(0) * 13) % 360;
			body = `
				<style>
					.tab-bar { display:flex; gap:0; border-bottom:2px solid var(--vscode-editorWidget-border,#3c3c3c); overflow-x:auto; }
					.tab-btn { background:none; border:none; color:var(--vscode-descriptionForeground); padding:8px 16px; font-size:12px; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px; white-space:nowrap; }
					.tab-btn:hover { color:var(--vscode-foreground); }
					.tab-btn.tab-active { color:var(--vscode-foreground); border-bottom-color:#0e639c; font-weight:600; }
					.tab-panel { display:none; }
				</style>
				<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
					<div style="width:48px;height:48px;border-radius:50%;background:hsl(${hue},50%,40%);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;">
						${(p.firstName || '')[0] || ''}${(p.lastName || '')[0] || ''}
					</div>
					<div>
						<h1 style="margin:0;">${p.firstName || ''} ${p.lastName || ''}</h1>
						<span style="color:var(--vscode-descriptionForeground);">${p.dateOfBirth || ''} | ${p.gender || ''} | ${p.status || ''}</span>
					</div>
				</div>
				<div class="tab-bar">${tabBtns}</div>
				<div class="card" style="margin-top:0;border-radius:0 0 6px 6px;">
					<div class="tab-panel" id="panel-demographics" style="display:block;">
						<div class="grid">
							<span class="label">Date of Birth</span><span>${p.dateOfBirth || 'N/A'}</span>
							<span class="label">Gender</span><span>${p.gender || 'N/A'}</span>
							<span class="label">Phone</span><span>${p.phoneNumber || 'N/A'}</span>
							<span class="label">Email</span><span>${p.email || 'N/A'}</span>
							<span class="label">Status</span><span class="status-active">${p.status || 'N/A'}</span>
							<span class="label">MRN</span><span>${p.mrn || 'N/A'}</span>
							<span class="label">SSN</span><span>${p.ssn || 'N/A'}</span>
							<span class="label">Address</span><span>${[p.addressLine1, p.city, p.state, p.postalCode].filter(Boolean).join(', ') || 'N/A'}</span>
						</div>
					</div>
					<div class="tab-panel" id="panel-encounters">
						${encounters.length > 0 ? `<table><thead><tr><th>Date</th><th>Provider</th><th>Type</th><th>Status</th></tr></thead><tbody>${encRows}</tbody></table>` : '<p>No encounters found</p>'}
					</div>
					<div class="tab-panel" id="panel-other"><p style="color:var(--vscode-descriptionForeground);">Select a tab to view content. Data loads from the Ciyex API.</p></div>
				</div>
				<script>
					function showTab(key) {
						document.querySelectorAll('.tab-panel').forEach(function(p) { p.style.display = 'none'; });
						document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('tab-active'); });
						var panel = document.getElementById('panel-' + key);
						if (panel) { panel.style.display = 'block'; }
						else { document.getElementById('panel-other').style.display = 'block'; }
						event.target.classList.add('tab-active');
					}
				</script>`;
		} catch {
			body = '<p style="color:#f48771;">Error loading patient data</p>';
		}

		const input = webviewService.openWebview(
			{ title: label, options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.patientChart',
			label,
			undefined,
			{ group: ACTIVE_GROUP, preserveFocus: false },
		);
		input.webview.setHtml(wrapHtml(body));
	}
});*/

/**
 * Command: Open Calendar
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openCalendar',
			title: localize2('openCalendar', "Open Calendar"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const inst = accessor.get(IInstantiationService);
		const env = accessor.get(IEnvironmentService);
		const uri = URI.joinPath(env.userRoamingDataHome, '.ciyex', 'calendar');
		const input = inst.createInstance(CalendarEditorInput, 'calendar', uri, 'Calendar', ThemeIcon.fromId('calendar'));
		await editorService.openEditor(input, { pinned: true });
	}
});

/**
 * Command: Open Encounter Form
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openEncounter',
			title: localize2('openEncounter', "Open Encounter"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, patientId?: string, encounterId?: string, patientName?: string, encounterLabel?: string, sectionKey?: string): Promise<void> {
		const editorService = accessor.get(IEditorService);

		// If no encounterId, fetch latest non-errored encounter
		if (!encounterId) {
			const apiService = accessor.get(ICiyexApiService);
			try {
				const res = await apiService.fetch('/api/fhir-resource/encounters?page=0&size=20');
				if (res.ok) {
					const data = await res.json();
					const items = (data?.data?.content || []) as Array<Record<string, string>>;
					// Skip entered-in-error encounters
					const valid = items.find(e => e.status !== 'entered-in-error');
					if (valid) {
						encounterId = valid.id || valid.fhirId;
						patientId = patientId || valid.patientId || '';
						patientName = patientName || valid.patientDisplay || valid.patientName || '';
						encounterLabel = encounterLabel || `${valid.type || valid.serviceType || 'Encounter'} - ${valid.providerDisplay || ''}`;
					}
				}
			} catch { /* */ }
			if (!encounterId) { return; }
		}

		const input = new EncounterFormEditorInput(
			patientId || '',
			encounterId,
			patientName || '',
			encounterLabel || `Encounter ${encounterId}`,
			sectionKey,
		);
		await editorService.openEditor(input, { pinned: true });
	}
});


/**
 * Command: New Patient
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.newPatient',
			title: localize2('newPatient', "New Patient"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const webviewService = accessor.get(IWebviewWorkbenchService);
		const body = `<h1>New Patient</h1><div class="card"><p>Patient creation form coming soon.</p></div>`;
		const input = webviewService.openWebview(
			{ title: 'New Patient', options: {}, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.newPatient', 'New Patient', undefined, { group: ACTIVE_GROUP, preserveFocus: false },
		);
		input.webview.setHtml(wrapHtml(body));
	}
});

/**
 * Command: New Appointment
 * Opens the Calendar editor which contains the full appointment creation form.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.newAppointment',
			title: localize2('newAppointment', "New Appointment"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const inst = accessor.get(IInstantiationService);
		const env = accessor.get(IEnvironmentService);
		const uri = URI.joinPath(env.userRoamingDataHome, '.ciyex', 'calendar');
		const input = inst.createInstance(CalendarEditorInput, 'calendar', uri, 'Calendar', ThemeIcon.fromId('calendar'));
		await editorService.openEditor(input, { pinned: true });
	}
});

/* OLD webview encounter command removed — replaced by EncounterFormEditor EditorPane above */

/**
 * Command: Upload Document
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.uploadDocument',
			title: localize2('uploadDocument', "Upload Document"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const webviewService = accessor.get(IWebviewWorkbenchService);
		const body = `
			<h1>Document Upload</h1>
			<div class="card">
				<p>Document scanning and upload will be available in a future update.</p>
				<p>Supported formats: PDF, JPEG, PNG, TIFF</p>
			</div>`;
		const input = webviewService.openWebview(
			{ title: 'Upload Document', options: {}, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.documentUpload', 'Upload Document', undefined, { group: ACTIVE_GROUP, preserveFocus: false },
		);
		input.webview.setHtml(wrapHtml(body));
	}
});

/**
 * Command: SMART on FHIR Launcher
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.smartLaunch',
			title: localize2('smartLaunch', "Launch SMART App"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const apiService = accessor.get(ICiyexApiService);
		const webviewService = accessor.get(IWebviewWorkbenchService);

		let body: string;
		try {
			const response = await apiService.fetch('/api/app-installations');
			if (response.ok) {
				const data = await response.json();
				const apps = data?.data || data || [];
				const smartApps = (Array.isArray(apps) ? apps : []).filter((a: Record<string, unknown>) => a.smartLaunchUrl);
				if (smartApps.length === 0) {
					body = '<h1>SMART Apps</h1><div class="card"><p>No SMART on FHIR apps installed.</p></div>';
				} else {
					let rows = '';
					for (const app of smartApps) {
						rows += `<tr><td>${app.appName || app.appSlug}</td><td>${app.status}</td><td><a href="${app.smartLaunchUrl}">Launch</a></td></tr>`;
					}
					body = `<h1>SMART Apps</h1><div class="card"><table>
						<thead><tr><th>App</th><th>Status</th><th>Action</th></tr></thead>
						<tbody>${rows}</tbody></table></div>`;
				}
			} else {
				body = '<h1>SMART Apps</h1><div class="card"><p>Failed to load installed apps.</p></div>';
			}
		} catch {
			body = '<h1>SMART Apps</h1><div class="card"><p>Error loading apps.</p></div>';
		}

		const input = webviewService.openWebview(
			{ title: 'SMART Apps', options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.smartLaunch', 'SMART Apps', undefined, { group: ACTIVE_GROUP, preserveFocus: false },
		);
		input.webview.setHtml(wrapHtml(body));
	}
});


/**
 * Command: Sign Out
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.signOut',
			title: localize2('signOut', "Sign Out"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const authService = accessor.get(ICiyexAuthService);
		await authService.signOut();
	}
});

/**
 * Command: Open Messaging (opens last channel or #general)
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openMessaging',
			title: localize2('openMessaging', "Open Messaging"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const apiService = accessor.get(ICiyexApiService);

		try {
			const res = await apiService.fetch('/api/channels');
			if (res.ok) {
				const data = await res.json();
				const channels = (data?.content || data || []) as Array<{ id: string; name: string; type: string }>;
				const first = channels[0];
				if (first) {
					const input = new MessagingEditorInput(first.id, first.name, first.type as 'public');
					await editorService.openEditor(input, { pinned: true });
					return;
				}
			}
		} catch { /* */ }

		// Fallback: open empty messaging
		const input = new MessagingEditorInput('', 'Messages', 'public');
		await editorService.openEditor(input, { pinned: true });
	}
});

/**
 * Command: Open Thread (opens thread as split editor)
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.messaging.openThread',
			title: localize2('openThread', "Open Thread"),
		});
	}

	async run(accessor: ServicesAccessor, channelId?: string, parentId?: string, channelName?: string): Promise<void> {
		if (!channelId || !parentId) { return; }
		const editorService = accessor.get(IEditorService);
		const input = new MessagingEditorInput(channelId, channelName || 'Thread', 'public', parentId);
		await editorService.openEditor(input, { pinned: false }, ACTIVE_GROUP);
	}
});

/**
 * Command: Open Portal Settings
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openPortalSettings',
			title: localize2('openPortalSettings', "Open Portal Settings"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const input = new PortalSettingsEditorInput();
		await editorService.openEditor(input, { pinned: true });
	}
});

/**
 * Command: Open Practice Settings (General settings page).
 * Loads practice information, contact info, and logo from the API.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openPracticeSettings',
			title: localize2('openPracticeSettings', "Open General Settings"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new PracticeSettingsEditorInput(), { pinned: true });
	}
});

/**
 * Command: Open Layout Settings (Tab Manager + Field Configuration).
 * API-driven editor for /api/tab-field-config/layout.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openLayoutSettings',
			title: localize2('openLayoutSettings', "Open Layout Settings"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new LayoutSettingsEditorInput(), { pinned: true });
	}
});

/**
 * Command: Open Settings Hub.
 * Mirrors the EHR `/settings` page — sidebar with all FHIR resource settings
 * (Practice / Facilities / Providers / Insurance / Referral Practices /
 * Referral Providers / Codes / Services / Template Documents) plus admin
 * pages (Users / Roles & Permissions) and built-ins (Form Options /
 * Display / Calendar Colors).
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openSettingsHub',
			title: localize2('openSettingsHub', "Open Settings"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, tabKey?: string): Promise<void> {
		await accessor.get(IEditorService).openEditor(new SettingsHubEditorInput(tabKey || ''), { pinned: true });
	}
});

/**
 * Command: Open Template Documents (opens the Settings Hub on the
 * template-documents tab). Registered separately so the Layout Hub can wire a
 * dedicated card without passing tabKey args through executeCommand.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openTemplateDocuments',
			title: localize2('openTemplateDocuments', "Open Template Documents"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new SettingsHubEditorInput('__template-documents__'), { pinned: true });
	}
});

/**
 * Command: Open Layout Hub.
 * Mirrors the EHR `/settings/layout-settings` sidebar — Chart / Menu /
 * Encounter / Portal / Settings.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openLayoutHub',
			title: localize2('openLayoutHub', "Open Layout Settings Hub"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new LayoutHubEditorInput(), { pinned: true });
	}
});

// `ciyex.openMenuConfig` is already registered in ciyexSettingsCommands.ts.
// Re-registering the same action ID here was the root cause of the blank
// workbench in Build 71/72 — `registerAction2` rejects duplicates and the
// throw at module-load time prevents the rest of the contribution chain
// (including the auth gate) from initializing, leaving a black window.
// The Settings Hub sidebar's "Menu Configuration" entry uses the existing
// command via ICommandService.executeCommand, so no new registration
// is needed here.

// REMOVED: native workbench.action.openSettings* command overrides.
//
// They were causing the workbench to render with a blank content area on
// some startup paths because VS Code's `openSettings` command is invoked
// during early layout / restored-editors initialization (before the
// auth gate has had a chance to mount). Replacing the handler routed those
// internal calls into SettingsHubEditor.setInput, which queues an
// authenticated /api/tab-field-config/all fetch — and on a fresh launch
// the request resolves to "waiting for login" while the layout pass has
// already painted nothing into the editor area, producing the empty
// dark window the test team reported on Build 71.
//
// Users still reach the Settings Hub via the dedicated `ciyex.openSettings`
// command (registered above), the Ciyex titlebar gear, and the Activity
// Bar entry — none of which fire during workbench startup.

// Note: ciyex.openUserManagement already registered in ciyexSettingsCommands.ts

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openRolesPermissions', title: localize2('openRoles', "Open Roles & Permissions"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new RolesEditorInput2(), { pinned: true });
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openTasks', title: localize2('openTasks', "Open Tasks"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new TasksEditorInput(), { pinned: true });
	}
});

// Clinical editors
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openPrescriptions', title: localize2('openRx', "Open Prescriptions"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new PrescriptionsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openImmunizations', title: localize2('openImm', "Open Immunizations"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new ImmunizationsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openReferrals', title: localize2('openRef', "Open Referrals"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new ReferralsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openCarePlans', title: localize2('openCP', "Open Care Plans"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new CarePlansEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openCds', title: localize2('openCds', "Open Clinical Decision Support"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new CdsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openAuthorizations', title: localize2('openAuth', "Open Authorizations"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new AuthorizationsEditorInput(), { pinned: true }); }
});

// Appointments
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openAppointments', title: localize2('openAppointments', "Open Appointments"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new AppointmentsEditorInput(), { pinned: true }); }
});

/**
 * Command: Open Telehealth Video Session for an appointment.
 *
 * Telehealth is a paid marketplace extension (`ciyex-telehealth`). This command
 * is gated on the org having purchased + installed that extension from the Hub.
 * If not installed, the user gets a notification with an action to open the
 * Hub product page so they can complete the purchase. After install, the
 * marketplace webhook → ciyex-api creates an active app_installation row;
 * CiyexInstallationsService picks it up on next load (or via runtime refresh)
 * and the Video Call action lights up.
 *
 * Once installed, mirrors the ciyex-ehr-ui flow at /telehealth/{appointmentId}:
 * creates or retrieves a session via the SDK-routed backend, then opens it in
 * the TelehealthEditor pane.
 */
const TELEHEALTH_APP_SLUG = 'ciyex-telehealth';

/** Derive the Hub URL from the API URL by swapping `api` → `app`. */
function _deriveHubUrl(apiUrl: string, slug: string): string {
	try {
		const u = new URL(apiUrl);
		u.hostname = u.hostname.replace(/(^|\.)api(-|\.)/, '$1app$2');
		u.pathname = `/hub/${slug}`;
		u.search = '';
		u.hash = '';
		return u.toString();
	} catch {
		return `https://app.ciyex.org/hub/${slug}`;
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openTelehealth',
			title: localize2('openTelehealth', "Open Telehealth Session"),
			f1: false,
		});
	}
	async run(accessor: ServicesAccessor, appointmentId?: string | number, patientName?: string, providerName?: string): Promise<void> {
		if (!appointmentId) { return; }

		const installations = accessor.get(ICiyexInstallationsService);
		const notifications = accessor.get(INotificationService);
		const opener = accessor.get(IOpenerService);
		const apiService = accessor.get(ICiyexApiService);

		// If installations haven't loaded yet (e.g. command fired immediately
		// after login), pull them now so first-click after install also works.
		if (!installations.loaded) {
			await installations.loadInstallations();
		}

		if (!installations.isInstalled(TELEHEALTH_APP_SLUG)) {
			const hubUrl = _deriveHubUrl(apiService.apiUrl, TELEHEALTH_APP_SLUG);
			const payments = accessor.get(ICiyexPaymentService);
			const commandService = accessor.get(ICommandService);
			const installationsService = installations;
			const inAppActions = payments.hasGateway() ? [{
				id: 'ciyex.buyTelehealth',
				label: localize2('buyAndInstall', "Buy & Install").value,
				tooltip: 'Purchase Ciyex Telehealth without leaving the app',
				class: undefined,
				enabled: true,
				run: async () => {
					await commandService.executeCommand('ciyex.payment.checkout', TELEHEALTH_APP_SLUG);
					await installationsService.loadInstallations();
				},
			}] : [];
			notifications.notify({
				severity: Severity.Info,
				message: localize2(
					'telehealthNotInstalled',
					"Telehealth requires the Ciyex Telehealth extension. Purchase it to enable video visits.",
				).value,
				actions: {
					primary: [
						...inAppActions,
						{
							id: 'ciyex.openTelehealthHub',
							label: payments.hasGateway()
								? localize2('openHubInBrowser', "Open Hub in Browser").value
								: localize2('openHub', "Open Hub").value,
							tooltip: hubUrl,
							class: undefined,
							enabled: true,
							run: async () => { await opener.open(URI.parse(hubUrl), { openExternal: true }); },
						},
					],
				},
			});
			return;
		}

		const input = new TelehealthEditorInput(String(appointmentId), patientName || '', providerName || '');
		await accessor.get(IEditorService).openEditor(input, { pinned: true });
	}
});

// Additional clinical editors
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openLabs', title: localize2('openLabs', "Open Labs"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new LabsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openEducation', title: localize2('openEducation', "Open Patient Education"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new EducationEditorInput(), { pinned: true }); }
});

// Operations editors
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openRecall', title: localize2('openRecall', "Open Patient Recall"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new RecallEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openCodes', title: localize2('openCodes', "Open Medical Codes"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new CodesEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openInventory', title: localize2('openInventory', "Open Inventory"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new InventoryEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openPayments', title: localize2('openPayments', "Open Payments"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new PaymentsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openClaims', title: localize2('openClaims', "Open Claims"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new ClaimsEditorInput(), { pinned: true }); }
});

// System editors
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openConsents', title: localize2('openConsents', "Open Consents"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new ConsentsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openNotifications', title: localize2('openNotifications', "Open Notifications"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new NotificationsEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openFax', title: localize2('openFax', "Open Fax"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new FaxEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openDocScanning', title: localize2('openDocScanning', "Open Document Scanning"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new DocScanningEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openKiosk', title: localize2('openKiosk', "Open Check-in Kiosk"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new KioskEditorInput(), { pinned: true }); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openAuditLog', title: localize2('openAuditLog', "Open Audit Log"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new AuditLogEditorInput(), { pinned: true }); }
});

// Portal Management — full-page editors
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openDocumentReview', title: localize2('openDocReview', "Open Document Reviews"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new DocumentReviewEditorInput(), { pinned: true });
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openFormSubmissions', title: localize2('openFormSub', "Open Form Reviews"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new FormSubmissionEditorInput(), { pinned: true });
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openPatientApprovals', title: localize2('openPatientApprovals', "Open Patient Approvals"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(new PatientApprovalEditorInput(), { pinned: true });
	}
});

// Developer Portal
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ciyex.openDeveloperPortal', title: localize2('openDevPortal', "Open Developer Portal"), f1: true }); }
	async run(accessor: ServicesAccessor, section?: string): Promise<void> {
		await accessor.get(IEditorService).openEditor(new DeveloperPortalEditorInput(section || 'overview'), { pinned: true });
	}
});

// allow-any-unicode-next-line
// ─── Payment Gateway Bridge Commands ─────────────────────────────────────
//
// These two commands are the only public surface between the workbench and
// any payment gateway extension (ciyex-payment-stripe, ciyex-payment-gps,
// ciyex-payment-square, ...).
//
//   ciyex.payment.registerGateway
//     Called by an extension's activate() handler. The extension passes
//     its gateway id, displayName, and the command id that will open its
//     checkout webview. The workbench remembers the registration in
//     CiyexPaymentService.
//
//   ciyex.payment.checkout
//     Called by gated workbench features (e.g. the Telehealth notification).
//     Builds a CheckoutRequest from marketplace data, picks the active
//     gateway, and forwards to that gateway's checkoutCommand. After the
//     extension resolves, refreshes installations so the gated feature
//     unlocks.
//
// New gateways plug in without touching this file — they just ship as a
// sibling extension that registers itself the same way.

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.payment.registerGateway',
			title: localize2('registerPaymentGateway', "Register Payment Gateway"),
			f1: false,
		});
	}
	async run(accessor: ServicesAccessor, gateway?: RegisteredGateway): Promise<void> {
		if (!gateway) { return; }
		accessor.get(ICiyexPaymentService).registerGateway(gateway);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.payment.checkout',
			title: localize2('paymentCheckout', "Checkout Marketplace Extension"),
			f1: false,
		});
	}
	async run(accessor: ServicesAccessor, appSlug?: string): Promise<CheckoutResult | undefined> {
		if (!appSlug) { return undefined; }

		const payments = accessor.get(ICiyexPaymentService);
		const notifications = accessor.get(INotificationService);
		const commandService = accessor.get(ICommandService);
		const apiService = accessor.get(ICiyexApiService);
		const installations = accessor.get(ICiyexInstallationsService);
		const opener = accessor.get(IOpenerService);

		const gateway = payments.getActiveGateway();
		if (!gateway) {
			notifications.notify({
				severity: Severity.Warning,
				message: localize2(
					'noPaymentGateway',
					"No payment gateway extension is installed. Install Ciyex Payment — Stripe (or another gateway) from the Extensions view.",
				).value,
				actions: {
					primary: [{
						id: 'ciyex.payment.openExtensionsView',
						label: localize2('openExtensions', "Open Extensions").value,
						tooltip: 'Show payment gateway extensions',
						class: undefined,
						enabled: true,
						run: async () => {
							await commandService.executeCommand('workbench.extensions.action.showInstalledExtensions');
						},
					}],
				},
			});
			return { status: 'error', appSlug, message: 'No payment gateway available.' };
		}

		// Resolve the app + pricing plan + clientSecret via the marketplace.
		// We do this in-line so the workbench owns marketplace I/O and the
		// gateway extensions don't need to know our REST shape.
		const checkoutRequest = await _buildCheckoutRequest(apiService, opener, appSlug);
		if (!checkoutRequest) {
			return { status: 'error', appSlug, message: 'Failed to build checkout request.' };
		}

		const result = await commandService.executeCommand<CheckoutResult>(gateway.checkoutCommand, checkoutRequest);

		if (result?.status === 'success') {
			// Poll installations for up to 30s so the gated feature lights up
			// the moment the marketplace webhook -> ciyex-api creates the row.
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline) {
				await installations.loadInstallations();
				if (installations.isInstalled(appSlug)) {
					notifications.notify({
						severity: Severity.Info,
						message: localize2('extensionInstalled', "{0} installed and ready.", checkoutRequest.appName).value,
					});
					break;
				}
				await new Promise(r => setTimeout(r, 2000));
			}
		} else if (result?.status === 'error') {
			notifications.notify({ severity: Severity.Error, message: `Payment failed: ${result.message ?? 'unknown error'}` });
		}

		return result;
	}
});

/**
 * Resolve the marketplace data needed for a checkout. Returns undefined if
 * the catalog lookup fails or there are no pricing plans — the caller has
 * already notified the user in those cases.
 *
 * NOTE: this is a placeholder shape. The marketplace endpoint that returns
 * `clientSecret` alongside the new subscription is not implemented yet; for
 * now we return the request with `clientSecret` unset so the gateway
 * extension surfaces a clear "configure the marketplace backend" error to
 * the user instead of silently failing. Once the backend ships, this
 * function POSTs to /api/v1/practices/{org}/subscriptions and forwards the
 * `clientSecret` from the response.
 */
async function _buildCheckoutRequest(_apiService: ICiyexApiService, _opener: IOpenerService, appSlug: string): Promise<CheckoutRequest | undefined> {
	// TODO: wire to marketplace once /subscriptions response includes clientSecret.
	return {
		appSlug,
		appName: appSlug,
		pricingPlanId: 'default',
		planName: 'Standard',
		priceCents: 0,
		currency: 'USD',
	};
}
