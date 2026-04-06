/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';

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
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, patientId?: string, patientName?: string): Promise<void> {
		if (!patientId) {
			return;
		}

		// Get ALL services BEFORE any await
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
});

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
		// Get ALL services BEFORE any await
		const apiService = accessor.get(ICiyexApiService);
		const webviewService = accessor.get(IWebviewWorkbenchService);

		let body: string;
		try {
			const today = new Date().toISOString().split('T')[0];
			const response = await apiService.fetch(`/api/appointments?date=${today}&page=0&size=50`);
			if (response.ok) {
				const data = await response.json();
				const appointments = data?.data?.content || data?.content || [];
				if (appointments.length === 0) {
					body = `<h1>Calendar</h1><div class="card"><p>No appointments for today (${today})</p></div>`;
				} else {
					let rows = '';
					for (const apt of appointments) {
						const time = apt.startTime ? new Date(apt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
						const name = apt.patientName || `${apt.patientFirstName || ''} ${apt.patientLastName || ''}`.trim();
						rows += `<tr><td>${time}</td><td>${name}</td><td>${apt.appointmentType || apt.type || ''}</td><td>${apt.status || ''}</td></tr>`;
					}
					body = `<h1>Today's Appointments</h1>
						<p style="color:var(--vscode-descriptionForeground);">${today} &mdash; ${appointments.length} appointments</p>
						<div class="card"><table>
							<thead><tr><th>Time</th><th>Patient</th><th>Type</th><th>Status</th></tr></thead>
							<tbody>${rows}</tbody>
						</table></div>`;
				}
			} else {
				body = `<h1>Calendar</h1><p style="color:#f48771;">Failed to load: ${response.status}</p>`;
			}
		} catch {
			body = '<h1>Calendar</h1><p style="color:#f48771;">Error loading appointments</p>';
		}

		const input = webviewService.openWebview(
			{ title: 'Calendar', options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.calendar',
			'Calendar',
			undefined,
			{ group: ACTIVE_GROUP, preserveFocus: false },
		);
		input.webview.setHtml(wrapHtml(body));
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
		const webviewService = accessor.get(IWebviewWorkbenchService);
		const body = `<h1>New Appointment</h1><div class="card"><p>Appointment creation form coming soon.</p></div>`;
		const input = webviewService.openWebview(
			{ title: 'New Appointment', options: {}, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.newAppointment', 'New Appointment', undefined, { group: ACTIVE_GROUP, preserveFocus: false },
		);
		input.webview.setHtml(wrapHtml(body));
	}
});

/**
 * Command: Open Encounter
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openEncounter',
			title: localize2('openEncounter', "Open Encounter"),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, encounterId?: string, encounterLabel?: string): Promise<void> {
		if (!encounterId) {
			return;
		}
		const apiService = accessor.get(ICiyexApiService);
		const webviewService = accessor.get(IWebviewWorkbenchService);
		const label = encounterLabel || `Encounter ${encounterId}`;

		let body: string;
		try {
			const response = await apiService.fetch(`/api/encounters/${encounterId}`);
			if (response.ok) {
				const data = await response.json();
				const e = data?.data || data;
				body = `
					<h1>Encounter: ${e.patientName || e.patientRefDisplay || ''}</h1>
					<div class="card">
						<h3>Details</h3>
						<div class="grid">
							<span class="label">Date</span><span>${e.encounterDate || e.startDate || 'N/A'}</span>
							<span class="label">Type</span><span>${e.visitCategory || e.type || 'N/A'}</span>
							<span class="label">Provider</span><span>${e.encounterProvider || e.providerDisplay || 'N/A'}</span>
							<span class="label">Status</span><span class="status-active">${e.status || 'N/A'}</span>
							<span class="label">Reason</span><span>${e.reason || 'N/A'}</span>
							<span class="label">FHIR ID</span><span>${e.fhirId || e.id || 'N/A'}</span>
						</div>
					</div>`;
			} else {
				body = `<p style="color:#f48771;">Failed to load encounter: ${response.status}</p>`;
			}
		} catch {
			body = '<p style="color:#f48771;">Error loading encounter</p>';
		}

		const input = webviewService.openWebview(
			{ title: label, options: { enableFindWidget: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.encounter', label, undefined, { group: ACTIVE_GROUP, preserveFocus: false },
		);
		input.webview.setHtml(wrapHtml(body));
	}
});

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
