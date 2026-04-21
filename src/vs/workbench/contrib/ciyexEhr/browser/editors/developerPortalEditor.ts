/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { DeveloperPortalEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
const INPUT_STYLE = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';
const BTN_PRIMARY = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
const BTN_SECONDARY = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
const BTN_DANGER = 'padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;';
const CARD_STYLE = 'padding:16px;border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;margin-bottom:12px;';

type DevSection = 'overview' | 'api-keys' | 'submissions' | 'sandboxes' | 'team' | 'analytics' | 'webhook-logs' | 'review-queue';

// allow-any-unicode-next-line
/**
 * Developer Portal Editor — Full developer portal with tabs for
 * API Keys, App Submissions, Sandboxes, Team, Analytics, Webhook Logs, Review Queue.
 */
export class DeveloperPortalEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexDeveloperPortal';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private tabBar!: HTMLElement;
	private activeSection: DevSection = 'overview';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(DeveloperPortalEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.developer-portal-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';

		const wrapper = DOM.append(this.root, DOM.$('div'));
		wrapper.style.cssText = 'max-width:1200px;margin:0 auto;padding:20px 24px;';

		// Header
		const header = DOM.append(wrapper, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;';
		const icon = DOM.append(header, DOM.$('span'));
		icon.textContent = '</>';
		icon.style.cssText = 'font-size:20px;font-weight:700;color:var(--vscode-textLink-foreground);';
		const titleCol = DOM.append(header, DOM.$('div'));
		titleCol.style.flex = '1';
		const title = DOM.append(titleCol, DOM.$('h1'));
		title.textContent = 'Developer Portal';
		title.style.cssText = 'margin:0;font-size:20px;font-weight:600;';
		const subtitle = DOM.append(titleCol, DOM.$('div'));
		subtitle.textContent = 'Build and manage your Ciyex Hub apps';
		subtitle.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

		// Tab bar
		this.tabBar = DOM.append(wrapper, DOM.$('div'));
		this.tabBar.style.cssText = 'display:flex;gap:0;border-bottom:2px solid var(--vscode-editorWidget-border,#3c3c3c);margin-bottom:16px;overflow-x:auto;';

		// Content area
		this.contentEl = DOM.append(wrapper, DOM.$('div'));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof DeveloperPortalEditorInput)) { return; }
		if (input.section) {
			this.activeSection = input.section as DevSection;
		}
		this._renderTabs();
		await this._renderSection();
	}

	private _renderTabs(): void {
		DOM.clearNode(this.tabBar);
		const tabs: Array<{ key: DevSection; label: string }> = [
			{ key: 'overview', label: 'Overview' },
			{ key: 'api-keys', label: 'API Keys' },
			{ key: 'submissions', label: 'Submissions' },
			{ key: 'sandboxes', label: 'Sandboxes' },
			{ key: 'team', label: 'Team' },
			{ key: 'analytics', label: 'Analytics' },
			{ key: 'webhook-logs', label: 'Webhook Logs' },
			{ key: 'review-queue', label: 'Review Queue' },
		];

		for (const tab of tabs) {
			const btn = DOM.append(this.tabBar, DOM.$('button'));
			btn.textContent = tab.label;
			const isActive = this.activeSection === tab.key;
			btn.style.cssText = `background:none;border:none;padding:8px 16px;font-size:12px;cursor:pointer;border-bottom:2px solid ${isActive ? 'var(--vscode-textLink-foreground)' : 'transparent'};margin-bottom:-2px;white-space:nowrap;color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};font-weight:${isActive ? '600' : '400'};`;
			btn.addEventListener('click', () => {
				this.activeSection = tab.key;
				this._renderTabs();
				this._renderSection();
			});
		}
	}

	private async _renderSection(): Promise<void> {
		DOM.clearNode(this.contentEl);

		switch (this.activeSection) {
			case 'overview': await this._renderOverview(); break;
			case 'api-keys': await this._renderApiKeys(); break;
			case 'submissions': await this._renderSubmissions(); break;
			case 'sandboxes': await this._renderSandboxes(); break;
			case 'team': await this._renderTeam(); break;
			case 'analytics': await this._renderAnalytics(); break;
			case 'webhook-logs': await this._renderWebhookLogs(); break;
			case 'review-queue': await this._renderReviewQueue(); break;
		}
	}

	// allow-any-unicode-next-line
	// ─── Overview ───

	private async _renderOverview(): Promise<void> {
		// Quick stats
		const statsRow = DOM.append(this.contentEl, DOM.$('div'));
		statsRow.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;';

		const statCards: Array<{ label: string; icon: string; color: string; section: DevSection }> = [
			// allow-any-unicode-next-line
			{ label: 'API Keys', icon: '🔑', color: '#f59e0b', section: 'api-keys' },
			// allow-any-unicode-next-line
			{ label: 'App Submissions', icon: '📤', color: '#3b82f6', section: 'submissions' },
			// allow-any-unicode-next-line
			{ label: 'Sandboxes', icon: '🧪', color: '#22c55e', section: 'sandboxes' },
			// allow-any-unicode-next-line
			{ label: 'Team Members', icon: '👥', color: '#8b5cf6', section: 'team' },
			// allow-any-unicode-next-line
			{ label: 'Analytics', icon: '📊', color: '#06b6d4', section: 'analytics' },
			// allow-any-unicode-next-line
			{ label: 'Webhook Logs', icon: '🔔', color: '#ec4899', section: 'webhook-logs' },
			// allow-any-unicode-next-line
			{ label: 'Review Queue', icon: '✅', color: '#64748b', section: 'review-queue' },
		];

		for (const stat of statCards) {
			const card = DOM.append(statsRow, DOM.$('div'));
			card.style.cssText = `${CARD_STYLE}cursor:pointer;border-left:3px solid ${stat.color};transition:background 0.15s;`;
			card.addEventListener('mouseenter', () => { card.style.background = 'var(--vscode-list-hoverBackground)'; });
			card.addEventListener('mouseleave', () => { card.style.background = ''; });
			card.addEventListener('click', () => { this.activeSection = stat.section; this._renderTabs(); this._renderSection(); });

			const icon = DOM.append(card, DOM.$('div'));
			icon.textContent = stat.icon;
			icon.style.cssText = 'font-size:24px;margin-bottom:8px;';
			const label = DOM.append(card, DOM.$('div'));
			label.textContent = stat.label;
			label.style.cssText = 'font-size:13px;font-weight:600;';
			const desc = DOM.append(card, DOM.$('div'));
			desc.textContent = `Manage ${stat.label.toLowerCase()}`;
			desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';

			const arrow = DOM.append(card, DOM.$('div'));
			// allow-any-unicode-next-line
			arrow.textContent = '→';
			arrow.style.cssText = 'text-align:right;color:var(--vscode-descriptionForeground);margin-top:8px;';
		}
	}

	// allow-any-unicode-next-line
	// ─── API Keys ───

	private async _renderApiKeys(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';
		const h2 = DOM.append(header, DOM.$('h2'));
		h2.textContent = 'API Keys';
		h2.style.cssText = 'margin:0;font-size:16px;font-weight:600;flex:1;';
		const createBtn = DOM.append(header, DOM.$('button'));
		createBtn.textContent = '+ Create API Key';
		createBtn.style.cssText = BTN_PRIMARY;
		createBtn.addEventListener('click', () => this._showCreateApiKeyForm());

		const tableEl = DOM.append(this.contentEl, DOM.$('div'));
		tableEl.id = 'api-keys-table';

		try {
			const res = await this.apiService.fetch('/api/v1/vendors/me/api-keys');
			if (!res.ok) { this._showEmpty(tableEl, 'No API keys found. Create one to get started.'); return; }
			const data = await res.json();
			const keys = (data?.data || data || []) as Record<string, string>[];

			if (keys.length === 0) { this._showEmpty(tableEl, 'No API keys found. Create one to get started.'); return; }

			this._renderTable(tableEl, keys, [
				{ key: 'name', label: 'Name' },
				{ key: 'keyPrefix', label: 'Key Prefix' },
				{ key: 'scopes', label: 'Scopes' },
				{ key: 'createdAt', label: 'Created' },
				{ key: 'expiresAt', label: 'Expires' },
			], [
				{
					label: 'Revoke', style: BTN_DANGER, handler: async (item) => {
						if (confirm(`Revoke API key "${item.name}"?`)) {
							await this.apiService.fetch(`/api/v1/vendors/me/api-keys/${item.id}`, { method: 'DELETE' });
							await this._renderApiKeys();
						}
					}
				},
			]);
		} catch {
			this._showEmpty(tableEl, 'Failed to load API keys.');
		}
	}

	private _showCreateApiKeyForm(): void {
		DOM.clearNode(this.contentEl);

		const form = DOM.append(this.contentEl, DOM.$('div'));
		form.style.cssText = `${CARD_STYLE}max-width:500px;`;

		const h3 = DOM.append(form, DOM.$('h3'));
		h3.textContent = 'Create API Key';
		h3.style.cssText = 'margin:0 0 12px;font-size:14px;font-weight:600;';

		const nameInput = this._addFormField(form, 'Key Name', 'text', 'my-api-key');
		const scopeInput = this._addFormField(form, 'Scopes', 'text', 'read,write');
		const expiryInput = this._addFormField(form, 'Expires In (days)', 'number', '365');

		const btnRow = DOM.append(form, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
		const createBtn = DOM.append(btnRow, DOM.$('button'));
		createBtn.textContent = 'Create';
		createBtn.style.cssText = BTN_PRIMARY;
		createBtn.addEventListener('click', async () => {
			const body = {
				name: nameInput.value,
				scopes: scopeInput.value.split(',').map(s => s.trim()),
				expiresInDays: parseInt(expiryInput.value) || 365,
			};
			try {
				const res = await this.apiService.fetch('/api/v1/vendors/me/api-keys', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
				if (res.ok) {
					const data = await res.json();
					const rawKey = data?.data?.rawKey || data?.rawKey || '';
					if (rawKey) { alert(`API Key created! Copy this key (it will not be shown again):\n\n${rawKey}`); }
				}
			} catch { /* */ }
			await this._renderApiKeys();
		});
		const cancelBtn = DOM.append(btnRow, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = BTN_SECONDARY;
		cancelBtn.addEventListener('click', () => this._renderApiKeys());
	}

	// allow-any-unicode-next-line
	// ─── Submissions ───

	private async _renderSubmissions(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';
		const h2 = DOM.append(header, DOM.$('h2'));
		h2.textContent = 'App Submissions';
		h2.style.cssText = 'margin:0;font-size:16px;font-weight:600;flex:1;';
		const newBtn = DOM.append(header, DOM.$('button'));
		newBtn.textContent = '+ New Submission';
		newBtn.style.cssText = BTN_PRIMARY;
		newBtn.addEventListener('click', () => this._showNewSubmissionForm());

		const tableEl = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch('/api/v1/vendors/me/submissions?page=0&size=50');
			if (!res.ok) { this._showEmpty(tableEl, 'No submissions found.'); return; }
			const data = await res.json();
			const submissions = (data?.data?.content || data?.content || data?.data || []) as Record<string, string>[];

			if (submissions.length === 0) { this._showEmpty(tableEl, 'No app submissions yet. Create your first app!'); return; }

			this._renderTable(tableEl, submissions, [
				{ key: 'appName', label: 'App Name' },
				{ key: 'appSlug', label: 'Slug' },
				{ key: 'version', label: 'Version' },
				{ key: 'category', label: 'Category' },
				{ key: 'status', label: 'Status' },
				{ key: 'createdAt', label: 'Submitted' },
			], [
				{
					label: 'Submit for Review', style: BTN_PRIMARY + 'font-size:10px;padding:3px 8px;', handler: async (item) => {
						if (item.status !== 'draft') { return; }
						await this.apiService.fetch(`/api/v1/vendors/me/submissions/${item.id}/submit`, { method: 'POST' });
						await this._renderSubmissions();
					}
				},
			]);
		} catch {
			this._showEmpty(tableEl, 'Failed to load submissions.');
		}
	}

	private _showNewSubmissionForm(): void {
		DOM.clearNode(this.contentEl);

		const form = DOM.append(this.contentEl, DOM.$('div'));
		form.style.cssText = `${CARD_STYLE}max-width:600px;`;

		const h3 = DOM.append(form, DOM.$('h3'));
		h3.textContent = 'New App Submission';
		h3.style.cssText = 'margin:0 0 4px;font-size:14px;font-weight:600;';
		const sub = DOM.append(form, DOM.$('div'));
		sub.textContent = 'Fill out the details to submit your app for review.';
		sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:14px;';

		// Section: Basic Information
		this._addSectionTitle(form, 'Basic Information');
		const grid = DOM.append(form, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;';
		const appName = this._addFormField(grid, 'App Name *', 'text', 'My Healthcare App');
		const appSlug = this._addFormField(grid, 'App Slug *', 'text', 'my-healthcare-app');
		appName.addEventListener('input', () => {
			appSlug.value = appName.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		});

		const grid2 = DOM.append(form, DOM.$('div'));
		grid2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;';
		const version = this._addFormField(grid2, 'Version', 'text', '1.0.0');

		const categoryWrapper = DOM.append(grid2, DOM.$('div'));
		categoryWrapper.style.cssText = 'margin-bottom:10px;';
		const catLabel = DOM.append(categoryWrapper, DOM.$('label'));
		catLabel.textContent = 'Category *';
		catLabel.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const categorySelect = DOM.append(categoryWrapper, DOM.$('select')) as HTMLSelectElement;
		categorySelect.style.cssText = INPUT_STYLE + 'width:100%;cursor:pointer;';
		for (const cat of ['Clinical', 'Billing', 'Scheduling', 'Analytics', 'Communication', 'Lab Integration', 'Imaging', 'Pharmacy', 'Telehealth', 'Other']) {
			const opt = DOM.append(categorySelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = cat.toLowerCase().replace(/\s+/g, '_');
			opt.textContent = cat;
		}

		const iconUrl = this._addFormField(form, 'Icon URL', 'text', 'https://...');
		const description = this._addFormTextarea(form, 'Description *', 'Describe what your app does...');

		// Section: Features
		this._addSectionTitle(form, 'Features');
		const featuresInput = this._addFormField(form, 'Features (comma separated)', 'text', 'e.g., Real-time lab results, Patient scheduling');

		// Section: Integration
		this._addSectionTitle(form, 'Integration');
		const smartLaunchUrl = this._addFormField(form, 'SMART Launch URL', 'text', 'https://myapp.com/launch');
		const fhirScopes = this._addFormField(form, 'FHIR Scopes', 'text', 'patient/*.read user/Practitioner.read');
		const fhirResources = this._addFormField(form, 'FHIR Resources (comma separated)', 'text', 'Patient, Encounter, Observation');

		// Buttons
		const btnRow = DOM.append(form, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
		const saveBtn = DOM.append(btnRow, DOM.$('button'));
		saveBtn.textContent = 'Save as Draft';
		saveBtn.style.cssText = BTN_PRIMARY;
		saveBtn.addEventListener('click', async () => {
			const body = {
				appName: appName.value,
				appSlug: appSlug.value,
				version: version.value || '1.0.0',
				category: categorySelect.value,
				iconUrl: iconUrl.value,
				description: description.value,
				features: featuresInput.value.split(',').map(f => f.trim()).filter(Boolean),
				smartLaunchUrl: smartLaunchUrl.value,
				fhirScopes: fhirScopes.value,
				fhirResources: fhirResources.value.split(',').map(r => r.trim()).filter(Boolean),
				submissionType: 'new',
			};
			try {
				await this.apiService.fetch('/api/v1/vendors/me/submissions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
			} catch { /* */ }
			await this._renderSubmissions();
		});
		const cancelBtn = DOM.append(btnRow, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = BTN_SECONDARY;
		cancelBtn.addEventListener('click', () => this._renderSubmissions());
	}

	// allow-any-unicode-next-line
	// ─── Sandboxes ───

	private async _renderSandboxes(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';
		const h2 = DOM.append(header, DOM.$('h2'));
		h2.textContent = 'FHIR Sandboxes';
		h2.style.cssText = 'margin:0;font-size:16px;font-weight:600;flex:1;';
		const createBtn = DOM.append(header, DOM.$('button'));
		createBtn.textContent = '+ Create Sandbox';
		createBtn.style.cssText = BTN_PRIMARY;
		createBtn.addEventListener('click', async () => {
			const name = prompt('Sandbox name:');
			if (name) {
				await this.apiService.fetch('/api/v1/vendors/me/sandboxes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name, includeSampleData: true }),
				});
				await this._renderSandboxes();
			}
		});

		const tableEl = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch('/api/v1/vendors/me/sandboxes');
			if (!res.ok) { this._showEmpty(tableEl, 'No sandboxes found.'); return; }
			const data = await res.json();
			const sandboxes = (data?.data || data || []) as Record<string, string>[];

			if (sandboxes.length === 0) { this._showEmpty(tableEl, 'No sandboxes yet. Create one to start testing.'); return; }

			this._renderTable(tableEl, sandboxes, [
				{ key: 'name', label: 'Name' },
				{ key: 'fhirBaseUrl', label: 'FHIR Base URL' },
				{ key: 'clientId', label: 'Client ID' },
				{ key: 'status', label: 'Status' },
				{ key: 'createdAt', label: 'Created' },
			], [
				{
					label: 'Reset', style: BTN_SECONDARY + 'font-size:10px;padding:3px 8px;', handler: async (item) => {
						if (confirm(`Reset sandbox "${item.name}"? This will regenerate credentials.`)) {
							await this.apiService.fetch(`/api/v1/vendors/me/sandboxes/${item.id}/reset`, { method: 'POST' });
							await this._renderSandboxes();
						}
					}
				},
				{
					label: 'Delete', style: BTN_DANGER, handler: async (item) => {
						if (confirm(`Delete sandbox "${item.name}"?`)) {
							await this.apiService.fetch(`/api/v1/vendors/me/sandboxes/${item.id}`, { method: 'DELETE' });
							await this._renderSandboxes();
						}
					}
				},
			]);
		} catch {
			this._showEmpty(tableEl, 'Failed to load sandboxes.');
		}
	}

	// allow-any-unicode-next-line
	// ─── Team ───

	private async _renderTeam(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';
		const h2 = DOM.append(header, DOM.$('h2'));
		h2.textContent = 'Team Members';
		h2.style.cssText = 'margin:0;font-size:16px;font-weight:600;flex:1;';
		const inviteBtn = DOM.append(header, DOM.$('button'));
		inviteBtn.textContent = '+ Invite Member';
		inviteBtn.style.cssText = BTN_PRIMARY;
		inviteBtn.addEventListener('click', () => this._showInviteForm());

		const tableEl = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch('/api/v1/vendors/me/team');
			if (!res.ok) { this._showEmpty(tableEl, 'No team members found.'); return; }
			const data = await res.json();
			const members = (data?.data || data || []) as Record<string, string>[];

			if (members.length === 0) { this._showEmpty(tableEl, 'No team members yet.'); return; }

			this._renderTable(tableEl, members, [
				{ key: 'name', label: 'Name' },
				{ key: 'email', label: 'Email' },
				{ key: 'role', label: 'Role' },
				{ key: 'status', label: 'Status' },
				{ key: 'joinedAt', label: 'Joined' },
			], [
				{
					label: 'Remove', style: BTN_DANGER, handler: async (item) => {
						if (confirm(`Remove "${item.name || item.email}" from the team?`)) {
							await this.apiService.fetch(`/api/v1/vendors/me/team/${item.id}`, { method: 'DELETE' });
							await this._renderTeam();
						}
					}
				},
			]);
		} catch {
			this._showEmpty(tableEl, 'Failed to load team.');
		}
	}

	private _showInviteForm(): void {
		DOM.clearNode(this.contentEl);

		const form = DOM.append(this.contentEl, DOM.$('div'));
		form.style.cssText = `${CARD_STYLE}max-width:400px;`;

		const h3 = DOM.append(form, DOM.$('h3'));
		h3.textContent = 'Invite Team Member';
		h3.style.cssText = 'margin:0 0 12px;font-size:14px;font-weight:600;';

		const emailInput = this._addFormField(form, 'Email Address', 'email', 'dev@example.com');

		const roleWrapper = DOM.append(form, DOM.$('div'));
		roleWrapper.style.cssText = 'margin-bottom:10px;';
		const roleLabel = DOM.append(roleWrapper, DOM.$('label'));
		roleLabel.textContent = 'Role';
		roleLabel.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const roleSelect = DOM.append(roleWrapper, DOM.$('select')) as HTMLSelectElement;
		roleSelect.style.cssText = INPUT_STYLE + 'width:100%;cursor:pointer;';
		for (const role of ['developer', 'admin', 'viewer']) {
			const opt = DOM.append(roleSelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = role;
			opt.textContent = role.charAt(0).toUpperCase() + role.slice(1);
		}

		const btnRow = DOM.append(form, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
		const sendBtn = DOM.append(btnRow, DOM.$('button'));
		sendBtn.textContent = 'Send Invite';
		sendBtn.style.cssText = BTN_PRIMARY;
		sendBtn.addEventListener('click', async () => {
			try {
				await this.apiService.fetch('/api/v1/vendors/me/team/invite', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: emailInput.value, role: roleSelect.value }),
				});
			} catch { /* */ }
			await this._renderTeam();
		});
		const cancelBtn = DOM.append(btnRow, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = BTN_SECONDARY;
		cancelBtn.addEventListener('click', () => this._renderTeam());
	}

	// allow-any-unicode-next-line
	// ─── Analytics ───

	private async _renderAnalytics(): Promise<void> {
		const h2 = DOM.append(this.contentEl, DOM.$('h2'));
		h2.textContent = 'Analytics';
		h2.style.cssText = 'margin:0 0 16px;font-size:16px;font-weight:600;';

		// Period selector
		const filterRow = DOM.append(this.contentEl, DOM.$('div'));
		filterRow.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;align-items:center;';
		const periodLabel = DOM.append(filterRow, DOM.$('span'));
		periodLabel.textContent = 'Period:';
		periodLabel.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		const periodSelect = DOM.append(filterRow, DOM.$('select')) as HTMLSelectElement;
		periodSelect.style.cssText = INPUT_STYLE + 'cursor:pointer;';
		for (const [val, label] of [['7', '7 days'], ['30', '30 days'], ['60', '60 days'], ['90', '90 days']]) {
			const opt = DOM.append(periodSelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = val;
			opt.textContent = label;
			if (val === '30') { opt.selected = true; }
		}

		const contentArea = DOM.append(this.contentEl, DOM.$('div'));

		const renderAnalytics = async () => {
			DOM.clearNode(contentArea);
			const days = parseInt(periodSelect.value) || 30;

			try {
				// Fetch summary + trends in parallel
				const [summaryRes, trendsRes, usageRes] = await Promise.all([
					this.apiService.fetch('/api/v1/vendors/me/analytics'),
					this.apiService.fetch(`/api/v1/vendors/me/analytics/trends?days=${days}`),
					this.apiService.fetch(`/api/v1/vendors/me/usage?days=${days}`),
				]);

				// Summary KPIs
				const summary = summaryRes.ok ? await summaryRes.json() : {};
				const summaryData = summary?.data || summary || {};
				const kpiRow = DOM.append(contentArea, DOM.$('div'));
				kpiRow.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;';

				const kpis: Array<{ label: string; key: string; color: string; prefix?: string }> = [
					{ label: 'Total Apps', key: 'totalApps', color: COLORS[0] },
					{ label: 'Active Apps', key: 'activeApps', color: COLORS[1] },
					{ label: 'Subscribers', key: 'totalSubscribers', color: COLORS[2] },
					{ label: 'Revenue', key: 'totalRevenue', color: COLORS[3], prefix: '$' },
					{ label: 'Net Revenue', key: 'netRevenue', color: COLORS[4], prefix: '$' },
					{ label: 'Avg Rating', key: 'avgRating', color: COLORS[5] },
				];

				for (const kpi of kpis) {
					const card = DOM.append(kpiRow, DOM.$('div'));
					card.style.cssText = `${CARD_STYLE}border-left:3px solid ${kpi.color};`;
					const val = DOM.append(card, DOM.$('div'));
					// allow-any-unicode-next-line
					val.textContent = `${kpi.prefix || ''}${summaryData[kpi.key] ?? '—'}`;
					val.style.cssText = 'font-size:20px;font-weight:700;';
					const lbl = DOM.append(card, DOM.$('div'));
					lbl.textContent = kpi.label;
					lbl.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
				}

				// Trends chart
				if (trendsRes.ok) {
					const trends = await trendsRes.json();
					const trendData = (trends?.data || trends || []) as Array<Record<string, number>>;
					if (trendData.length > 0) {
						const chartCard = DOM.append(contentArea, DOM.$('div'));
						chartCard.style.cssText = `${CARD_STYLE}`;
						const chartTitle = DOM.append(chartCard, DOM.$('h3'));
						chartTitle.textContent = `Revenue & Subscriber Trends (${days} days)`;
						chartTitle.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;';

						const chart = DOM.append(chartCard, DOM.$('div'));
						chart.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:120px;';
						const maxRev = Math.max(...trendData.map(d => d.revenue || 0), 1);
						for (let i = 0; i < Math.min(trendData.length, 30); i++) {
							const d = trendData[i];
							const bar = DOM.append(chart, DOM.$('div'));
							const h = Math.max(((d.revenue || 0) / maxRev) * 100, 3);
							bar.style.cssText = `flex:1;height:${h}px;background:${COLORS[0]};border-radius:2px 2px 0 0;min-width:0;`;
							bar.title = `${d.date || ''}: $${d.revenue || 0}, ${d.subscribers || 0} subscribers`;
						}
					}
				}

				// Usage breakdown
				if (usageRes.ok) {
					const usage = await usageRes.json();
					const usageData = (usage?.data || usage || []) as Array<Record<string, string | number>>;
					if (usageData.length > 0) {
						const usageCard = DOM.append(contentArea, DOM.$('div'));
						usageCard.style.cssText = `${CARD_STYLE}`;
						const usageTitle = DOM.append(usageCard, DOM.$('h3'));
						usageTitle.textContent = 'App Usage Breakdown';
						usageTitle.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;';

						this._renderTable(usageCard, usageData as Record<string, string>[], [
							{ key: 'appName', label: 'App' },
							{ key: 'eventType', label: 'Event Type' },
							{ key: 'count', label: 'Count' },
						]);
					}
				}
			} catch {
				this._showEmpty(contentArea, 'Failed to load analytics data.');
			}
		};

		periodSelect.addEventListener('change', renderAnalytics);
		await renderAnalytics();
	}

	// allow-any-unicode-next-line
	// ─── Webhook Logs ───

	private async _renderWebhookLogs(): Promise<void> {
		const h2 = DOM.append(this.contentEl, DOM.$('h2'));
		h2.textContent = 'Webhook Delivery Logs';
		h2.style.cssText = 'margin:0 0 16px;font-size:16px;font-weight:600;';

		const tableEl = DOM.append(this.contentEl, DOM.$('div'));
		let page = 0;

		const loadPage = async (p: number) => {
			DOM.clearNode(tableEl);
			page = p;

			try {
				const res = await this.apiService.fetch(`/api/v1/vendors/me/webhook-logs?page=${page}&size=20`);
				if (!res.ok) { this._showEmpty(tableEl, 'No webhook logs found.'); return; }
				const data = await res.json();
				const logs = (data?.data?.content || data?.content || data?.data || []) as Record<string, string>[];
				const totalPages = data?.data?.totalPages || data?.totalPages || 1;

				if (logs.length === 0) { this._showEmpty(tableEl, 'No webhook delivery logs.'); return; }

				this._renderTable(tableEl, logs, [
					{ key: 'eventType', label: 'Event' },
					{ key: 'url', label: 'URL' },
					{ key: 'httpStatus', label: 'Status' },
					{ key: 'responseCode', label: 'Response' },
					{ key: 'durationMs', label: 'Duration (ms)' },
					{ key: 'attempt', label: 'Attempt' },
					{ key: 'createdAt', label: 'Time' },
				]);

				// Pagination
				if (totalPages > 1) {
					const pagRow = DOM.append(tableEl, DOM.$('div'));
					pagRow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:12px;';
					if (page > 0) {
						const prev = DOM.append(pagRow, DOM.$('button'));
						// allow-any-unicode-next-line
						prev.textContent = '← Previous';
						prev.style.cssText = BTN_SECONDARY;
						prev.addEventListener('click', () => loadPage(page - 1));
					}
					const info = DOM.append(pagRow, DOM.$('span'));
					info.textContent = `Page ${page + 1} of ${totalPages}`;
					info.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);line-height:30px;';
					if (page < totalPages - 1) {
						const next = DOM.append(pagRow, DOM.$('button'));
						// allow-any-unicode-next-line
						next.textContent = 'Next →';
						next.style.cssText = BTN_SECONDARY;
						next.addEventListener('click', () => loadPage(page + 1));
					}
				}
			} catch {
				this._showEmpty(tableEl, 'Failed to load webhook logs.');
			}
		};

		await loadPage(0);
	}

	// allow-any-unicode-next-line
	// ─── Review Queue (Admin) ───

	private async _renderReviewQueue(): Promise<void> {
		const h2 = DOM.append(this.contentEl, DOM.$('h2'));
		h2.textContent = 'Review Queue (Admin)';
		h2.style.cssText = 'margin:0 0 16px;font-size:16px;font-weight:600;';

		const tableEl = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch('/api/v1/admin/submissions?page=0&size=50');
			if (!res.ok) { this._showEmpty(tableEl, 'No submissions to review. (Admin access required)'); return; }
			const data = await res.json();
			const submissions = (data?.data?.content || data?.content || data?.data || []) as Record<string, string>[];

			if (submissions.length === 0) { this._showEmpty(tableEl, 'No pending submissions to review.'); return; }

			this._renderTable(tableEl, submissions, [
				{ key: 'appName', label: 'App Name' },
				{ key: 'vendorName', label: 'Vendor' },
				{ key: 'version', label: 'Version' },
				{ key: 'category', label: 'Category' },
				{ key: 'status', label: 'Status' },
				{ key: 'submittedAt', label: 'Submitted' },
			], [
				{
					label: 'Approve', style: BTN_PRIMARY + 'font-size:10px;padding:3px 8px;background:#22c55e;', handler: async (item) => {
						await this.apiService.fetch(`/api/v1/admin/submissions/${item.id}/review`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ action: 'approve', notes: '' }),
						});
						await this._renderReviewQueue();
					}
				},
				{
					label: 'Reject', style: BTN_DANGER + 'font-size:10px;padding:3px 8px;', handler: async (item) => {
						const reason = prompt('Rejection reason:');
						if (reason) {
							await this.apiService.fetch(`/api/v1/admin/submissions/${item.id}/review`, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ action: 'reject', notes: reason }),
							});
							await this._renderReviewQueue();
						}
					}
				},
				{
					label: 'Request Revisions', style: BTN_SECONDARY + 'font-size:10px;padding:3px 8px;', handler: async (item) => {
						const notes = prompt('What revisions are needed?');
						if (notes) {
							await this.apiService.fetch(`/api/v1/admin/submissions/${item.id}/review`, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ action: 'request_revisions', notes }),
							});
							await this._renderReviewQueue();
						}
					}
				},
			]);
		} catch {
			this._showEmpty(tableEl, 'Failed to load review queue. Admin access required.');
		}
	}

	// allow-any-unicode-next-line
	// ─── Utility methods ───

	private _addFormField(parent: HTMLElement, label: string, type: string, placeholder: string): HTMLInputElement {
		const wrapper = DOM.append(parent, DOM.$('div'));
		wrapper.style.cssText = 'margin-bottom:10px;';
		const lbl = DOM.append(wrapper, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const input = DOM.append(wrapper, DOM.$('input')) as HTMLInputElement;
		input.type = type;
		input.placeholder = placeholder;
		input.style.cssText = INPUT_STYLE + 'width:100%;box-sizing:border-box;';
		return input;
	}

	private _addFormTextarea(parent: HTMLElement, label: string, placeholder: string): HTMLTextAreaElement {
		const wrapper = DOM.append(parent, DOM.$('div'));
		wrapper.style.cssText = 'margin-bottom:10px;';
		const lbl = DOM.append(wrapper, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const textarea = DOM.append(wrapper, DOM.$('textarea')) as HTMLTextAreaElement;
		textarea.placeholder = placeholder;
		textarea.rows = 4;
		textarea.style.cssText = INPUT_STYLE + 'width:100%;box-sizing:border-box;resize:vertical;';
		return textarea;
	}

	private _addSectionTitle(parent: HTMLElement, title: string): void {
		const h = DOM.append(parent, DOM.$('h4'));
		h.textContent = title;
		h.style.cssText = 'margin:16px 0 8px;font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--vscode-editorWidget-border);padding-bottom:4px;';
	}

	private _showEmpty(parent: HTMLElement, message: string): void {
		const el = DOM.append(parent, DOM.$('div'));
		el.style.cssText = 'padding:40px 20px;text-align:center;color:var(--vscode-descriptionForeground);';
		el.textContent = message;
	}

	private _renderTable(parent: HTMLElement, items: Record<string, string>[], columns: Array<{ key: string; label: string }>, actions?: Array<{ label: string; style: string; handler: (item: Record<string, string>) => void }>): void {
		const tbl = DOM.append(parent, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;';

		const cols = actions && actions.length > 0 ? [...columns, { key: '__actions', label: 'Actions' }] : columns;
		const gridCols = cols.map(c => c.key === '__actions' ? 'auto' : '1fr').join(' ');

		// Header
		const hdr = DOM.append(tbl, DOM.$('div'));
		hdr.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const c of cols) { DOM.append(hdr, DOM.$('span')).textContent = c.label; }

		// Rows
		for (const item of items) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:5px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);align-items:center;`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });

			for (const c of cols) {
				if (c.key === '__actions' && actions) {
					const actRow = DOM.append(r, DOM.$('div'));
					actRow.style.cssText = 'display:flex;gap:4px;';
					for (const act of actions) {
						const btn = DOM.append(actRow, DOM.$('button'));
						btn.textContent = act.label;
						btn.style.cssText = act.style;
						btn.addEventListener('click', (e) => { e.stopPropagation(); act.handler(item); });
					}
				} else {
					const cell = DOM.append(r, DOM.$('span'));
					let val = String(item[c.key] ?? '');
					// Format dates
					if ((c.key.endsWith('At') || c.key.endsWith('Date')) && val && !isNaN(Date.parse(val))) {
						try { val = new Date(val).toLocaleDateString(); } catch { /* */ }
					}
					// Format arrays
					if (val.startsWith('[')) {
						try { val = JSON.parse(val).join(', '); } catch { /* */ }
					}
					cell.textContent = val;
					cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				}
			}
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
