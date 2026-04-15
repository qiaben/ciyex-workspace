/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { IEditorService, ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { CalendarEditorInput, PatientChartEditorInput, EncounterFormEditorInput, MessagingEditorInput, PortalSettingsEditorInput, RolesEditorInput2, TasksEditorInput, PrescriptionsEditorInput, ImmunizationsEditorInput, ReferralsEditorInput, CarePlansEditorInput, CdsEditorInput, AuthorizationsEditorInput, AppointmentsEditorInput } from './editors/ciyexEditorInput.js';
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

	async run(accessor: ServicesAccessor, patientId?: string, patientName?: string): Promise<void> {
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

		const input = new PatientChartEditorInput(patientId, patientName || `Patient ${patientId}`);
		await editorService.openEditor(input, { pinned: true });
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

	async run(accessor: ServicesAccessor, patientId?: string, encounterId?: string, patientName?: string, encounterLabel?: string): Promise<void> {
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
					body = '<h1>SMART Apps</h1><div class="card"><p>No SMART on FHIR apps installed. Visit the Ciyex Hub to install apps.</p></div>';
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
 * Command: Browse Ciyex Hub
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.browseHub',
			title: localize2('browseHub', "Browse Ciyex Hub"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const apiService = accessor.get(ICiyexApiService);
		const webviewService = accessor.get(IWebviewWorkbenchService);

		let body: string;
		try {
			// Fetch installed apps
			const installedRes = await apiService.fetch('/api/app-installations');
			const installed = installedRes.ok ? (await installedRes.json())?.data || [] : [];
			const installedApps = Array.isArray(installed) ? installed : [];

			let installedHtml = '';
			if (installedApps.length > 0) {
				let rows = '';
				for (const app of installedApps) {
					rows += `<tr>
						<td><strong>${app.appName || app.appSlug || ''}</strong></td>
						<td>${app.appCategory || ''}</td>
						<td><span class="status-active">${app.status || ''}</span></td>
					</tr>`;
				}
				installedHtml = `
					<div class="card">
						<h3>Installed Apps (${installedApps.length})</h3>
						<table>
							<thead><tr><th>App</th><th>Category</th><th>Status</th></tr></thead>
							<tbody>${rows}</tbody>
						</table>
					</div>`;
			} else {
				installedHtml = '<div class="card"><p>No apps installed yet.</p></div>';
			}

			body = `
				<h1>Ciyex Hub</h1>
				<p style="color:var(--vscode-descriptionForeground);">Healthcare App Marketplace</p>
				${installedHtml}
				<div class="card">
					<h3>Browse Marketplace</h3>
					<p>Visit <a href="https://hub.ciyex.org">hub.ciyex.org</a> to browse and install healthcare apps.</p>
					<p>Apps integrate into Ciyex Workspace via SMART on FHIR, CDS Hooks, and Plugin Slots.</p>
				</div>`;
		} catch {
			body = '<h1>Ciyex Hub</h1><div class="card"><p>Unable to load marketplace data.</p></div>';
		}

		const input = webviewService.openWebview(
			{ title: 'Ciyex Hub', options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.hub', 'Ciyex Hub', undefined, { group: ACTIVE_GROUP, preserveFocus: false },
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
		// Import auth service dynamically to avoid circular dependency
		const { ICiyexAuthService } = await import('../../ciyexAuth/browser/ciyexAuthService.js');
		const authService = accessor.get(ICiyexAuthService);
		authService.signOut();
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
