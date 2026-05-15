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
const BTN_SUCCESS = 'padding:6px 14px;background:#22c55e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
const CARD_STYLE = 'padding:16px;border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:8px;margin-bottom:12px;';

type DevSection = 'overview' | 'api-keys' | 'submissions' | 'sandboxes' | 'team' | 'analytics' | 'webhook-logs' | 'review-queue';

const STATUS_COLORS: Record<string, string> = {
	draft: '#94a3b8',
	submitted: '#3b82f6',
	in_review: '#f59e0b',
	approved: '#22c55e',
	rejected: '#ef4444',
	revisions_requested: '#f97316',
	active: '#22c55e',
	pending: '#f59e0b',
	owner: '#8b5cf6',
	admin: '#3b82f6',
	developer: '#22c55e',
	viewer: '#94a3b8',
};

const STATUS_LABELS: Record<string, string> = {
	draft: 'Draft',
	submitted: 'Submitted',
	in_review: 'In Review',
	approved: 'Approved',
	rejected: 'Rejected',
	revisions_requested: 'Revisions Requested',
};

interface ColumnDef {
	key: string;
	label: string;
}

interface ActionDef {
	label: string;
	style: string;
	handler: (item: Record<string, string>) => void | Promise<void>;
	visible?: (item: Record<string, string>) => boolean;
}

export class DeveloperPortalEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexDeveloperPortal';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private tabBar!: HTMLElement;
	private activeSection: DevSection = 'overview';
	private detailSubmissionId: string | null = null;

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
		this.root = DOM.append(parent, DOM.$('.developer-portal-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;overflow-x:hidden;background:var(--vscode-editor-background);scrollbar-width:none;-ms-overflow-style:none;scroll-behavior:smooth;overscroll-behavior:contain;';

		const wrapper = DOM.append(this.root, DOM.$('div'));
		wrapper.style.cssText = 'max-width:1200px;margin:0 auto;padding:20px 24px;';

		const header = DOM.append(wrapper, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:6px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		titleCol.style.flex = '1';
		const title = DOM.append(titleCol, DOM.$('h1'));
		title.textContent = 'Developer Portal';
		title.style.cssText = 'margin:0;font-size:22px;font-weight:600;';
		const subtitle = DOM.append(titleCol, DOM.$('div'));
		subtitle.textContent = 'Build and manage your Ciyex Hub apps';
		subtitle.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		const browseBtn = DOM.append(header, DOM.$('button'));
		browseBtn.textContent = 'Browse Hub';
		browseBtn.style.cssText = BTN_SECONDARY;

		this.tabBar = DOM.append(wrapper, DOM.$('div'));
		this.tabBar.style.cssText = 'display:flex;gap:0;border-bottom:2px solid var(--vscode-editorWidget-border,#3c3c3c);margin:14px 0 16px;overflow-x:auto;';

		this.contentEl = DOM.append(wrapper, DOM.$('div'));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof DeveloperPortalEditorInput)) { return; }
		if (input.section) {
			this.activeSection = input.section as DevSection;
		}
		this.detailSubmissionId = null;
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
				this.detailSubmissionId = null;
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
			case 'review-queue':
				if (this.detailSubmissionId) { await this._renderReviewDetail(this.detailSubmissionId); }
				else { await this._renderReviewQueue(); }
				break;
		}
	}

	// allow-any-unicode-next-line
	// ─── Overview ───

	private async _renderOverview(): Promise<void> {
		// Quick stats row
		const statsRow = DOM.append(this.contentEl, DOM.$('div'));
		statsRow.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;';

		const stats: Array<{ label: string; key: 'apiKeys' | 'submissions' | 'sandboxes' | 'team' }> = [
			{ label: 'API Keys', key: 'apiKeys' },
			{ label: 'Submissions', key: 'submissions' },
			{ label: 'Sandboxes', key: 'sandboxes' },
			{ label: 'Team Members', key: 'team' },
		];
		const counts: Record<string, number> = { apiKeys: 0, submissions: 0, sandboxes: 0, team: 0 };
		try {
			const [a, s, sb, t] = await Promise.all([
				this.apiService.fetch('/api/v1/vendors/me/api-keys').then(r => r.ok ? r.json() : null).catch(() => null),
				this.apiService.fetch('/api/v1/vendors/me/submissions?page=0&size=1').then(r => r.ok ? r.json() : null).catch(() => null),
				this.apiService.fetch('/api/v1/vendors/me/sandboxes').then(r => r.ok ? r.json() : null).catch(() => null),
				this.apiService.fetch('/api/v1/vendors/me/team').then(r => r.ok ? r.json() : null).catch(() => null),
			]);
			counts.apiKeys = (a?.data || a || []).length || 0;
			counts.submissions = s?.data?.totalElements || s?.totalElements || (s?.data?.content || s?.content || []).length || 0;
			counts.sandboxes = (sb?.data || sb || []).length || 0;
			counts.team = (t?.data || t || []).length || 0;
		} catch { /* ignore */ }

		for (const stat of stats) {
			const card = DOM.append(statsRow, DOM.$('div'));
			card.style.cssText = `${CARD_STYLE}border-left:3px solid ${COLORS[stats.indexOf(stat) % COLORS.length]};`;
			const val = DOM.append(card, DOM.$('div'));
			val.textContent = String(counts[stat.key]);
			val.style.cssText = 'font-size:24px;font-weight:700;';
			const lbl = DOM.append(card, DOM.$('div'));
			lbl.textContent = stat.label;
			lbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
		}

		// Navigation cards
		const navHeader = DOM.append(this.contentEl, DOM.$('h3'));
		navHeader.textContent = 'Manage';
		navHeader.style.cssText = 'font-size:14px;font-weight:600;margin:8px 0 10px;';

		const navGrid = DOM.append(this.contentEl, DOM.$('div'));
		navGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;';

		const navItems: Array<{ section: DevSection; label: string; desc: string }> = [
			{ section: 'api-keys', label: 'API Keys', desc: 'Manage API keys for authenticating your apps' },
			{ section: 'submissions', label: 'App Submissions', desc: 'Submit new apps or updates for review' },
			{ section: 'sandboxes', label: 'Sandboxes', desc: 'FHIR sandbox environments for testing' },
			{ section: 'team', label: 'Team', desc: 'Manage your vendor team members' },
			{ section: 'analytics', label: 'Analytics', desc: 'Track app performance, revenue, and subscriber trends' },
			{ section: 'webhook-logs', label: 'Webhook Logs', desc: 'View webhook delivery history and debug issues' },
			{ section: 'review-queue', label: 'Review Queue', desc: 'Admin: review and approve app submissions' },
		];
		for (const nav of navItems) {
			const card = DOM.append(navGrid, DOM.$('div'));
			card.style.cssText = `${CARD_STYLE}cursor:pointer;`;
			card.addEventListener('mouseenter', () => { card.style.background = 'var(--vscode-list-hoverBackground)'; });
			card.addEventListener('mouseleave', () => { card.style.background = ''; });
			card.addEventListener('click', () => { this.activeSection = nav.section; this._renderTabs(); this._renderSection(); });

			const lbl = DOM.append(card, DOM.$('div'));
			lbl.textContent = nav.label;
			lbl.style.cssText = 'font-size:14px;font-weight:600;';
			const desc = DOM.append(card, DOM.$('div'));
			desc.textContent = nav.desc;
			desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
		}
	}

	// allow-any-unicode-next-line
	// ─── API Keys ───

	private async _renderApiKeys(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:16px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		titleCol.style.flex = '1';
		const h2 = DOM.append(titleCol, DOM.$('h2'));
		h2.textContent = 'API Keys';
		h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const subtitle = DOM.append(titleCol, DOM.$('div'));
		subtitle.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		const createBtn = DOM.append(header, DOM.$('button'));
		createBtn.textContent = '+ Create Key';
		createBtn.style.cssText = BTN_PRIMARY;
		createBtn.addEventListener('click', () => this._showCreateApiKeyForm());

		const tableEl = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch('/api/v1/vendors/me/api-keys');
			if (!res.ok) { this._showEmpty(tableEl, 'No API keys found. Create one to get started.'); return; }
			const data = await res.json();
			const keys = (data?.data || data || []) as Record<string, string>[];
			subtitle.textContent = `${keys.length} active key(s)`;

			if (keys.length === 0) { this._showEmpty(tableEl, 'No API keys found. Create one to get started.'); return; }

			this._renderTable(tableEl, keys, [
				{ key: 'name', label: 'Name' },
				{ key: 'keyPrefix', label: 'Prefix' },
				{ key: 'scopes', label: 'Scopes' },
				{ key: 'createdAt', label: 'Created' },
				{ key: 'expiresAt', label: 'Expires' },
			], [
				{
					label: 'Revoke', style: BTN_DANGER, handler: async (item) => {
						if (confirm(`Revoke API key "${item.name}"?`)) {
							await this.apiService.fetch(`/api/v1/vendors/me/api-keys/${item.id}`, { method: 'DELETE' });
							await this._renderSection();
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

		const nameInput = this._addFormField(form, 'Name', 'text', 'e.g., Production Key');

		// Scopes checkboxes
		const scopesWrapper = DOM.append(form, DOM.$('div'));
		scopesWrapper.style.cssText = 'margin-bottom:10px;';
		const scopesLabel = DOM.append(scopesWrapper, DOM.$('label'));
		scopesLabel.textContent = 'Scopes';
		scopesLabel.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:6px;';
		const scopesRow = DOM.append(scopesWrapper, DOM.$('div'));
		scopesRow.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;';
		const scopeInputs: HTMLInputElement[] = [];
		for (const scope of ['read', 'write', 'admin']) {
			const lbl = DOM.append(scopesRow, DOM.$('label'));
			lbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;';
			const cb = DOM.append(lbl, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.value = scope;
			if (scope === 'read') { cb.checked = true; }
			cb.style.cssText = 'cursor:pointer;';
			DOM.append(lbl, DOM.$('span')).textContent = scope;
			scopeInputs.push(cb);
		}

		// Expires dropdown
		const expiryWrapper = DOM.append(form, DOM.$('div'));
		expiryWrapper.style.cssText = 'margin-bottom:10px;';
		const expiryLabel = DOM.append(expiryWrapper, DOM.$('label'));
		expiryLabel.textContent = 'Expires in (days)';
		expiryLabel.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const expirySelect = DOM.append(expiryWrapper, DOM.$('select')) as HTMLSelectElement;
		expirySelect.style.cssText = INPUT_STYLE + 'width:100%;cursor:pointer;';
		for (const opt of [{ v: '30', l: '30 days' }, { v: '90', l: '90 days' }, { v: '180', l: '180 days' }, { v: '365', l: '365 days' }, { v: '0', l: 'Never' }]) {
			const o = DOM.append(expirySelect, DOM.$('option')) as HTMLOptionElement;
			o.value = opt.v;
			o.textContent = opt.l;
			if (opt.v === '90') { o.selected = true; }
		}

		const btnRow = DOM.append(form, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;margin-top:14px;';
		const createBtn = DOM.append(btnRow, DOM.$('button'));
		createBtn.textContent = 'Create Key';
		createBtn.style.cssText = BTN_PRIMARY;
		createBtn.addEventListener('click', async () => {
			const days = parseInt(expirySelect.value);
			const body = {
				name: nameInput.value || 'Untitled Key',
				scopes: scopeInputs.filter(c => c.checked).map(c => c.value),
				expiresInDays: days > 0 ? days : null,
			};
			try {
				const res = await this.apiService.fetch('/api/v1/vendors/me/api-keys', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
				if (res.ok) {
					const data = await res.json();
					const rawKey = data?.data?.rawKey || data?.rawKey || data?.data?.apiKey || data?.apiKey || '';
					if (rawKey) {
						this._showRawKeyAlert(rawKey);
						return;
					}
				}
			} catch { /* ignore */ }
			await this._renderSection();
		});
		const cancelBtn = DOM.append(btnRow, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = BTN_SECONDARY;
		cancelBtn.addEventListener('click', () => this._renderSection());
	}

	private _showRawKeyAlert(rawKey: string): void {
		DOM.clearNode(this.contentEl);
		const card = DOM.append(this.contentEl, DOM.$('div'));
		card.style.cssText = `${CARD_STYLE}max-width:600px;border-left:3px solid #f59e0b;background:rgba(245,158,11,0.05);`;
		const h = DOM.append(card, DOM.$('h3'));
		h.textContent = 'API Key Created';
		h.style.cssText = 'margin:0 0 8px;font-size:14px;font-weight:600;color:#f59e0b;';
		const msg = DOM.append(card, DOM.$('div'));
		msg.textContent = 'Copy your API key now — it won\'t be shown again.';
		msg.style.cssText = 'font-size:12px;margin-bottom:10px;';
		const keyRow = DOM.append(card, DOM.$('div'));
		keyRow.style.cssText = 'display:flex;gap:6px;align-items:center;background:var(--vscode-input-background);padding:8px 10px;border-radius:4px;border:1px solid var(--vscode-input-border);';
		const keyText = DOM.append(keyRow, DOM.$('code'));
		keyText.textContent = rawKey;
		keyText.style.cssText = 'flex:1;font-family:monospace;font-size:12px;word-break:break-all;';
		const copyBtn = DOM.append(keyRow, DOM.$('button'));
		copyBtn.textContent = 'Copy';
		copyBtn.style.cssText = BTN_SECONDARY;
		copyBtn.addEventListener('click', () => {
			try { navigator.clipboard.writeText(rawKey); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); } catch { /* ignore */ }
		});
		const ok = DOM.append(card, DOM.$('button'));
		ok.textContent = 'Done';
		ok.style.cssText = BTN_PRIMARY + 'margin-top:14px;';
		ok.addEventListener('click', () => this._renderSection());
	}

	// allow-any-unicode-next-line
	// ─── Submissions ───

	private async _renderSubmissions(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:16px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		titleCol.style.flex = '1';
		const h2 = DOM.append(titleCol, DOM.$('h2'));
		h2.textContent = 'App Submissions';
		h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const subtitle = DOM.append(titleCol, DOM.$('div'));
		subtitle.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		const newBtn = DOM.append(header, DOM.$('button'));
		newBtn.textContent = '+ New Submission';
		newBtn.style.cssText = BTN_PRIMARY;
		newBtn.addEventListener('click', () => this._showNewSubmissionForm());

		const listEl = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch('/api/v1/vendors/me/submissions?page=0&size=50');
			if (!res.ok) { this._showEmpty(listEl, 'No submissions found.'); return; }
			const data = await res.json();
			const submissions = (data?.data?.content || data?.content || data?.data || []) as Record<string, string>[];
			subtitle.textContent = `${submissions.length} submission(s)`;

			if (submissions.length === 0) { this._showEmpty(listEl, 'No app submissions yet. Create your first app!'); return; }

			for (const sub of submissions) {
				const card = DOM.append(listEl, DOM.$('div'));
				card.style.cssText = CARD_STYLE;
				const row = DOM.append(card, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:flex-start;gap:12px;';

				const statusColor = STATUS_COLORS[sub.status || 'draft'] || '#94a3b8';
				const statusBar = DOM.append(row, DOM.$('div'));
				statusBar.style.cssText = `width:4px;height:50px;background:${statusColor};border-radius:2px;flex-shrink:0;margin-top:2px;`;

				const main = DOM.append(row, DOM.$('div'));
				main.style.cssText = 'flex:1;min-width:0;';
				const titleRow = DOM.append(main, DOM.$('div'));
				titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
				const appName = DOM.append(titleRow, DOM.$('strong'));
				appName.textContent = sub.appName || 'Untitled';
				appName.style.cssText = 'font-size:14px;';
				if (sub.version) {
					const ver = DOM.append(titleRow, DOM.$('span'));
					ver.textContent = `v${sub.version}`;
					ver.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
				}
				const badge = DOM.append(titleRow, DOM.$('span'));
				badge.textContent = STATUS_LABELS[sub.status || 'draft'] || sub.status || 'Draft';
				badge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:10px;background:${statusColor};color:#fff;text-transform:uppercase;letter-spacing:0.5px;`;

				const meta = DOM.append(main, DOM.$('div'));
				meta.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
				const parts: string[] = [];
				if (sub.submissionType) { parts.push(sub.submissionType); }
				if (sub.category) { parts.push(sub.category); }
				if (sub.appSlug) { parts.push(sub.appSlug); }
				if (sub.createdAt) { parts.push(this._fmtDate(sub.createdAt)); }
				meta.textContent = parts.join(' • ');

				if (sub.status === 'rejected' && sub.rejectionReason) {
					const rej = DOM.append(main, DOM.$('div'));
					rej.style.cssText = 'font-size:11px;color:#ef4444;margin-top:6px;padding:6px 10px;background:rgba(239,68,68,0.1);border-radius:4px;';
					rej.textContent = `Rejection reason: ${sub.rejectionReason}`;
				}

				const actions = DOM.append(row, DOM.$('div'));
				actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';
				if (sub.status === 'draft') {
					const submitBtn = DOM.append(actions, DOM.$('button'));
					submitBtn.textContent = 'Submit';
					submitBtn.style.cssText = BTN_PRIMARY + 'font-size:11px;padding:4px 10px;';
					submitBtn.addEventListener('click', async () => {
						await this.apiService.fetch(`/api/v1/vendors/me/submissions/${sub.id}/submit`, { method: 'POST' });
						await this._renderSection();
					});
				}
			}
		} catch {
			this._showEmpty(listEl, 'Failed to load submissions.');
		}
	}

	private _showNewSubmissionForm(): void {
		DOM.clearNode(this.contentEl);

		const form = DOM.append(this.contentEl, DOM.$('div'));
		form.style.cssText = `${CARD_STYLE}max-width:700px;`;

		const h3 = DOM.append(form, DOM.$('h3'));
		h3.textContent = 'New App Submission';
		h3.style.cssText = 'margin:0 0 4px;font-size:16px;font-weight:600;';
		const sub = DOM.append(form, DOM.$('div'));
		sub.textContent = 'Fill out the details to submit your app for review';
		sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:14px;';

		// Basic Information
		this._addSectionTitle(form, 'Basic Information');
		const basicGrid = DOM.append(form, DOM.$('div'));
		basicGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
		const appName = this._addFormField(basicGrid, 'App Name *', 'text', 'My Healthcare App');
		const appSlug = this._addFormField(basicGrid, 'App Slug *', 'text', 'my-healthcare-app');
		appName.addEventListener('input', () => {
			appSlug.value = appName.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		});

		const subTypeWrapper = DOM.append(basicGrid, DOM.$('div'));
		subTypeWrapper.style.cssText = 'margin-bottom:10px;';
		const subTypeLabel = DOM.append(subTypeWrapper, DOM.$('label'));
		subTypeLabel.textContent = 'Submission Type';
		subTypeLabel.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const subTypeSelect = DOM.append(subTypeWrapper, DOM.$('select')) as HTMLSelectElement;
		subTypeSelect.style.cssText = INPUT_STYLE + 'width:100%;cursor:pointer;';
		for (const t of [{ v: 'new', l: 'New App' }, { v: 'update', l: 'Update' }, { v: 'new_version', l: 'New Version' }]) {
			const o = DOM.append(subTypeSelect, DOM.$('option')) as HTMLOptionElement;
			o.value = t.v; o.textContent = t.l;
		}

		const version = this._addFormField(basicGrid, 'Version', 'text', '1.0.0');
		version.value = '1.0.0';

		const categoryWrapper = DOM.append(basicGrid, DOM.$('div'));
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

		const iconUrl = this._addFormField(form, 'Icon URL', 'url', 'https://example.com/icon.png');
		const description = this._addFormTextarea(form, 'Description *', 'Describe what your app does...', 4);

		// Features
		this._addSectionTitle(form, 'Features');
		const featuresList = this._buildListEditor(form, 'Features', 'e.g., Real-time lab results');

		// Integration
		this._addSectionTitle(form, 'Integration');
		const smartLaunchUrl = this._addFormField(form, 'SMART Launch URL', 'url', 'https://myapp.com/launch');
		const fhirScopes = this._addFormField(form, 'FHIR Scopes', 'text', 'patient/*.read user/Practitioner.read');
		const fhirResourcesList = this._buildListEditor(form, 'FHIR Resources', 'e.g., Patient, Observation');
		const extensionPointsList = this._buildListEditor(form, 'Extension Points', 'e.g., patient-chart:tab');

		// Buttons
		const btnRow = DOM.append(form, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;margin-top:18px;';
		const saveBtn = DOM.append(btnRow, DOM.$('button'));
		saveBtn.textContent = 'Save as Draft';
		saveBtn.style.cssText = BTN_PRIMARY;
		saveBtn.addEventListener('click', async () => {
			const body = {
				appName: appName.value,
				appSlug: appSlug.value,
				submissionType: subTypeSelect.value,
				version: version.value || '1.0.0',
				category: categorySelect.value,
				iconUrl: iconUrl.value,
				description: description.value,
				features: featuresList(),
				smartLaunchUrl: smartLaunchUrl.value,
				fhirScopes: fhirScopes.value,
				fhirResources: fhirResourcesList(),
				extensionPoints: extensionPointsList(),
			};
			try {
				await this.apiService.fetch('/api/v1/vendors/me/submissions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
			} catch { /* ignore */ }
			await this._renderSection();
		});
		const cancelBtn = DOM.append(btnRow, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = BTN_SECONDARY;
		cancelBtn.addEventListener('click', () => this._renderSection());
	}

	// allow-any-unicode-next-line
	// ─── Sandboxes ───

	private async _renderSandboxes(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:16px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		titleCol.style.flex = '1';
		const h2 = DOM.append(titleCol, DOM.$('h2'));
		h2.textContent = 'Sandbox Environments';
		h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const subtitle = DOM.append(titleCol, DOM.$('div'));
		subtitle.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		const createBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
		createBtn.textContent = '+ Create Sandbox';
		createBtn.style.cssText = BTN_PRIMARY;

		const listEl = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch('/api/v1/vendors/me/sandboxes');
			if (!res.ok) { this._showEmpty(listEl, 'No sandboxes found.'); return; }
			const data = await res.json();
			const sandboxes = (data?.data || data || []) as Record<string, string>[];
			const active = sandboxes.filter(s => s.status === 'active' || !s.status).length;
			subtitle.textContent = `${active} of 3 sandboxes active`;

			createBtn.disabled = active >= 3;
			if (active >= 3) {
				createBtn.style.cssText = BTN_PRIMARY + 'opacity:0.5;cursor:not-allowed;';
			}
			createBtn.addEventListener('click', async () => {
				if (active >= 3) { return; }
				try {
					const r = await this.apiService.fetch('/api/v1/vendors/me/sandboxes', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ sampleData: 'standard' }),
					});
					if (r.ok) {
						const d = await r.json();
						const secret = d?.data?.clientSecret || d?.clientSecret || '';
						if (secret) { this._showClientSecretAlert(secret); return; }
					}
				} catch { /* ignore */ }
				await this._renderSection();
			});

			if (sandboxes.length === 0) { this._showEmpty(listEl, 'No sandboxes yet. Create one to start testing your app.'); return; }

			for (const sb of sandboxes) {
				const card = DOM.append(listEl, DOM.$('div'));
				card.style.cssText = CARD_STYLE;

				const head = DOM.append(card, DOM.$('div'));
				head.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
				const nameEl = DOM.append(head, DOM.$('strong'));
				nameEl.textContent = sb.name || `Sandbox ${sb.id?.substring(0, 8)}`;
				nameEl.style.cssText = 'font-size:14px;flex:1;';
				const statusBadge = DOM.append(head, DOM.$('span'));
				const sbActive = (sb.status || 'active') === 'active';
				statusBadge.textContent = sbActive ? 'Active' : 'Inactive';
				statusBadge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:10px;background:${sbActive ? '#22c55e' : '#94a3b8'};color:#fff;text-transform:uppercase;letter-spacing:0.5px;`;

				const fields: Array<{ label: string; value: string; copy?: boolean }> = [
					{ label: 'FHIR Base URL', value: sb.fhirBaseUrl || '', copy: true },
					{ label: 'Client ID', value: sb.clientId || '', copy: true },
					{ label: 'Sample Data', value: sb.sampleData || 'Standard' },
					{ label: 'Expires', value: sb.expiresAt ? this._fmtDate(sb.expiresAt) : 'Never' },
				];
				for (const f of fields) {
					const fr = DOM.append(card, DOM.$('div'));
					fr.style.cssText = 'display:grid;grid-template-columns:140px 1fr auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.06);';
					const fl = DOM.append(fr, DOM.$('span'));
					fl.textContent = f.label;
					fl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
					const fv = DOM.append(fr, DOM.$('code'));
					fv.textContent = f.value;
					fv.style.cssText = 'font-family:monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					if (f.copy && f.value) {
						const cb = DOM.append(fr, DOM.$('button'));
						cb.textContent = 'Copy';
						cb.style.cssText = BTN_SECONDARY + 'font-size:10px;padding:3px 8px;';
						cb.addEventListener('click', () => {
							try { navigator.clipboard.writeText(f.value); cb.textContent = '✓'; setTimeout(() => { cb.textContent = 'Copy'; }, 1200); } catch { /* */ }
						});
					} else {
						DOM.append(fr, DOM.$('span'));
					}
				}

				const actions = DOM.append(card, DOM.$('div'));
				actions.style.cssText = 'display:flex;gap:6px;margin-top:10px;';
				const reset = DOM.append(actions, DOM.$('button'));
				reset.textContent = 'Reset Credentials';
				reset.style.cssText = BTN_SECONDARY;
				reset.addEventListener('click', async () => {
					if (confirm('Reset credentials? The current client secret will be invalidated.')) {
						const r = await this.apiService.fetch(`/api/v1/vendors/me/sandboxes/${sb.id}/reset`, { method: 'POST' });
						if (r.ok) {
							try {
								const d = await r.json();
								const secret = d?.data?.clientSecret || d?.clientSecret || '';
								if (secret) { this._showClientSecretAlert(secret); return; }
							} catch { /* */ }
						}
						await this._renderSection();
					}
				});
				const del = DOM.append(actions, DOM.$('button'));
				del.textContent = 'Delete';
				del.style.cssText = BTN_DANGER;
				del.addEventListener('click', async () => {
					if (confirm(`Delete sandbox "${sb.name}"?`)) {
						await this.apiService.fetch(`/api/v1/vendors/me/sandboxes/${sb.id}`, { method: 'DELETE' });
						await this._renderSection();
					}
				});
			}
		} catch {
			this._showEmpty(listEl, 'Failed to load sandboxes.');
		}
	}

	private _showClientSecretAlert(secret: string): void {
		DOM.clearNode(this.contentEl);
		const card = DOM.append(this.contentEl, DOM.$('div'));
		card.style.cssText = `${CARD_STYLE}max-width:600px;border-left:3px solid #f59e0b;background:rgba(245,158,11,0.05);`;
		const h = DOM.append(card, DOM.$('h3'));
		h.textContent = 'Client Secret Generated';
		h.style.cssText = 'margin:0 0 8px;font-size:14px;font-weight:600;color:#f59e0b;';
		const msg = DOM.append(card, DOM.$('div'));
		msg.textContent = 'Copy it now — it won\'t be shown again.';
		msg.style.cssText = 'font-size:12px;margin-bottom:10px;';
		const row = DOM.append(card, DOM.$('div'));
		row.style.cssText = 'display:flex;gap:6px;align-items:center;background:var(--vscode-input-background);padding:8px 10px;border-radius:4px;border:1px solid var(--vscode-input-border);';
		const code = DOM.append(row, DOM.$('code'));
		code.textContent = secret;
		code.style.cssText = 'flex:1;font-family:monospace;font-size:12px;word-break:break-all;';
		const copy = DOM.append(row, DOM.$('button'));
		copy.textContent = 'Copy';
		copy.style.cssText = BTN_SECONDARY;
		copy.addEventListener('click', () => {
			try { navigator.clipboard.writeText(secret); copy.textContent = 'Copied!'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); } catch { /* */ }
		});
		const ok = DOM.append(card, DOM.$('button'));
		ok.textContent = 'Done';
		ok.style.cssText = BTN_PRIMARY + 'margin-top:14px;';
		ok.addEventListener('click', () => this._renderSection());
	}

	// allow-any-unicode-next-line
	// ─── Team ───

	private async _renderTeam(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:16px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		titleCol.style.flex = '1';
		const h2 = DOM.append(titleCol, DOM.$('h2'));
		h2.textContent = 'Team Members';
		h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const subtitle = DOM.append(titleCol, DOM.$('div'));
		subtitle.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';
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
			subtitle.textContent = `${members.length} member(s)`;

			if (members.length === 0) { this._showEmpty(tableEl, 'No team members yet. Invite someone to collaborate.'); return; }

			// Custom render: Email | Role | Status | Joined | Actions
			const tbl = DOM.append(tableEl, DOM.$('div'));
			tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;';
			const gridCols = '2fr 1.2fr 1fr 1fr auto';

			const hdr = DOM.append(tbl, DOM.$('div'));
			hdr.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);`;
			for (const lbl of ['Email', 'Role', 'Status', 'Joined', 'Actions']) {
				DOM.append(hdr, DOM.$('span')).textContent = lbl;
			}

			for (const m of members) {
				const r = DOM.append(tbl, DOM.$('div'));
				r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);align-items:center;`;
				const emailCell = DOM.append(r, DOM.$('span'));
				emailCell.textContent = m.email || '';
				emailCell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

				const roleCell = DOM.append(r, DOM.$('div'));
				if (m.role === 'owner') {
					const ownerBadge = DOM.append(roleCell, DOM.$('span'));
					ownerBadge.textContent = 'Owner';
					ownerBadge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:10px;background:${STATUS_COLORS.owner};color:#fff;text-transform:uppercase;letter-spacing:0.5px;`;
				} else {
					const roleSel = DOM.append(roleCell, DOM.$('select')) as HTMLSelectElement;
					roleSel.style.cssText = INPUT_STYLE + 'cursor:pointer;font-size:11px;padding:3px 6px;';
					for (const r2 of ['admin', 'developer', 'viewer']) {
						const o = DOM.append(roleSel, DOM.$('option')) as HTMLOptionElement;
						o.value = r2; o.textContent = r2.charAt(0).toUpperCase() + r2.slice(1);
						if (m.role === r2) { o.selected = true; }
					}
					roleSel.addEventListener('change', async () => {
						await this.apiService.fetch(`/api/v1/vendors/me/team/${m.id}/role`, {
							method: 'PUT',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ role: roleSel.value }),
						});
					});
				}

				const statusCell = DOM.append(r, DOM.$('span'));
				const isActive = (m.status || 'active') === 'active';
				// allow-any-unicode-next-line
				statusCell.textContent = isActive ? '✓ Active' : '⏳ Pending';
				statusCell.style.cssText = `font-size:11px;color:${isActive ? '#22c55e' : '#f59e0b'};`;

				const joinedCell = DOM.append(r, DOM.$('span'));
				joinedCell.textContent = m.acceptedAt ? this._fmtDate(m.acceptedAt) : (m.invitedAt ? `${this._fmtDate(m.invitedAt)} (invited)` : '—');
				joinedCell.style.cssText = 'font-size:11px;';

				const actionsCell = DOM.append(r, DOM.$('div'));
				if (m.role !== 'owner') {
					const removeBtn = DOM.append(actionsCell, DOM.$('button'));
					removeBtn.textContent = 'Remove';
					removeBtn.style.cssText = BTN_DANGER;
					removeBtn.addEventListener('click', async () => {
						if (confirm(`Remove "${m.email}" from the team?`)) {
							await this.apiService.fetch(`/api/v1/vendors/me/team/${m.id}`, { method: 'DELETE' });
							await this._renderSection();
						}
					});
				}
			}
		} catch {
			this._showEmpty(tableEl, 'Failed to load team.');
		}
	}

	private _showInviteForm(): void {
		DOM.clearNode(this.contentEl);

		const form = DOM.append(this.contentEl, DOM.$('div'));
		form.style.cssText = `${CARD_STYLE}max-width:450px;`;

		const h3 = DOM.append(form, DOM.$('h3'));
		h3.textContent = 'Invite Team Member';
		h3.style.cssText = 'margin:0 0 12px;font-size:14px;font-weight:600;';

		const emailInput = this._addFormField(form, 'Email', 'email', 'colleague@company.com');

		const roleWrapper = DOM.append(form, DOM.$('div'));
		roleWrapper.style.cssText = 'margin-bottom:10px;';
		const roleLabel = DOM.append(roleWrapper, DOM.$('label'));
		roleLabel.textContent = 'Role';
		roleLabel.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const roleSelect = DOM.append(roleWrapper, DOM.$('select')) as HTMLSelectElement;
		roleSelect.style.cssText = INPUT_STYLE + 'width:100%;cursor:pointer;';
		for (const role of [{ v: 'admin', l: 'Admin' }, { v: 'developer', l: 'Developer' }, { v: 'viewer', l: 'Viewer' }]) {
			const opt = DOM.append(roleSelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = role.v;
			opt.textContent = role.l;
			if (role.v === 'developer') { opt.selected = true; }
		}

		const btnRow = DOM.append(form, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;margin-top:14px;';
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
			await this._renderSection();
		});
		const cancelBtn = DOM.append(btnRow, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = BTN_SECONDARY;
		cancelBtn.addEventListener('click', () => this._renderSection());
	}

	// allow-any-unicode-next-line
	// ─── Analytics ───

	private async _renderAnalytics(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		titleCol.style.flex = '1';
		const h2 = DOM.append(titleCol, DOM.$('h2'));
		h2.textContent = 'Analytics';
		h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const sub = DOM.append(titleCol, DOM.$('div'));
		sub.textContent = 'Track your app performance and revenue';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		// Period selector
		const periodRow = DOM.append(header, DOM.$('div'));
		periodRow.style.cssText = 'display:flex;gap:0;border:1px solid var(--vscode-input-border);border-radius:4px;overflow:hidden;';
		let period = 30;
		const periodButtons: HTMLButtonElement[] = [];
		const setPeriod = (p: number) => {
			period = p;
			periodButtons.forEach(b => {
				const active = parseInt(b.dataset['period'] || '0') === p;
				b.style.cssText = `padding:5px 12px;background:${active ? 'var(--vscode-button-background)' : 'transparent'};color:${active ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)'};border:none;cursor:pointer;font-size:11px;`;
			});
			loadAll();
		};
		for (const p of [7, 30, 90]) {
			const b = DOM.append(periodRow, DOM.$('button')) as HTMLButtonElement;
			b.textContent = `${p}d`;
			b.dataset['period'] = String(p);
			b.addEventListener('click', () => setPeriod(p));
			periodButtons.push(b);
		}

		const contentArea = DOM.append(this.contentEl, DOM.$('div'));

		const loadAll = async (): Promise<void> => {
			DOM.clearNode(contentArea);
			try {
				const [summaryRes, trendsRes, usageRes] = await Promise.all([
					this.apiService.fetch('/api/v1/vendors/me/analytics').catch(() => null),
					this.apiService.fetch(`/api/v1/vendors/me/analytics/trends?days=${period}`).catch(() => null),
					this.apiService.fetch(`/api/v1/vendors/me/usage?days=${period}`).catch(() => null),
				]);

				const summary = (summaryRes && summaryRes.ok ? await summaryRes.json() : {}) as Record<string, unknown>;
				const summaryData = (summary?.data || summary || {}) as Record<string, number>;

				// 5-card metric row
				const kpiRow = DOM.append(contentArea, DOM.$('div'));
				kpiRow.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px;';
				const kpis: Array<{ label: string; value: string; sub?: string; color: string }> = [
					{ label: 'Active Apps', value: String(summaryData['activeApps'] ?? '0'), sub: `${summaryData['totalApps'] ?? 0} total`, color: COLORS[0] },
					{ label: 'Subscribers', value: String(summaryData['totalSubscribers'] ?? '0'), sub: `${summaryData['totalApps'] ?? 0} total`, color: COLORS[1] },
					{ label: 'Net Revenue', value: `$${Number(summaryData['netRevenue'] ?? 0).toLocaleString()}`, color: COLORS[2] },
					{ label: 'Avg Rating', value: String(summaryData['avgRating'] ?? '—'), sub: `${summaryData['reviewCount'] ?? 0} reviews`, color: COLORS[3] },
					{ label: 'Payouts', value: String(summaryData['payoutCount'] ?? '0'), color: COLORS[4] },
				];
				for (const k of kpis) {
					const card = DOM.append(kpiRow, DOM.$('div'));
					card.style.cssText = `${CARD_STYLE}border-left:3px solid ${k.color};margin-bottom:0;`;
					const v = DOM.append(card, DOM.$('div'));
					v.textContent = k.value;
					v.style.cssText = 'font-size:22px;font-weight:700;line-height:1.2;';
					const l = DOM.append(card, DOM.$('div'));
					l.textContent = k.label;
					l.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
					if (k.sub) {
						const s = DOM.append(card, DOM.$('div'));
						s.textContent = k.sub;
						s.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
					}
				}

				// Trend charts
				if (trendsRes && trendsRes.ok) {
					const trends = await trendsRes.json();
					const trendData = (trends?.data || trends || []) as Array<Record<string, number | string>>;
					if (trendData.length > 0) {
						const trendGrid = DOM.append(contentArea, DOM.$('div'));
						trendGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;';

						const subscriberCard = DOM.append(trendGrid, DOM.$('div'));
						subscriberCard.style.cssText = CARD_STYLE + 'margin-bottom:0;';
						const subTitle = DOM.append(subscriberCard, DOM.$('h3'));
						subTitle.textContent = 'Subscriber Growth';
						subTitle.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;';
						this._renderBarChart(subscriberCard, trendData.map(d => ({ label: String(d['date'] || ''), value: Number(d['subscribers'] ?? d['count'] ?? 0) })), COLORS[0]);

						const revCard = DOM.append(trendGrid, DOM.$('div'));
						revCard.style.cssText = CARD_STYLE + 'margin-bottom:0;';
						const revTitle = DOM.append(revCard, DOM.$('h3'));
						revTitle.textContent = 'Revenue Events';
						revTitle.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;';
						this._renderBarChart(revCard, trendData.map(d => ({ label: String(d['date'] || ''), value: Number(d['revenue'] ?? d['count'] ?? 0) })), COLORS[1]);
					}
				}

				// Usage breakdown
				if (usageRes && usageRes.ok) {
					const usage = await usageRes.json();
					const usageData = (usage?.data || usage || []) as Array<Record<string, string | number>>;
					if (usageData.length > 0) {
						const usageCard = DOM.append(contentArea, DOM.$('div'));
						usageCard.style.cssText = CARD_STYLE;
						const usageTitle = DOM.append(usageCard, DOM.$('h3'));
						usageTitle.textContent = 'Usage Metering';
						usageTitle.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;';

						this._renderTable(usageCard, usageData as Record<string, string>[], [
							{ key: 'appName', label: 'App' },
							{ key: 'eventType', label: 'Event Type' },
							{ key: 'count', label: 'Count' },
						]);
					}
				}

				// App performance
				const appsCard = DOM.append(contentArea, DOM.$('div'));
				appsCard.style.cssText = CARD_STYLE;
				const appsTitle = DOM.append(appsCard, DOM.$('h3'));
				appsTitle.textContent = 'App Performance';
				appsTitle.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;';
				const apps = (summaryData['apps'] as unknown as Array<Record<string, string>>) || [];
				if (apps.length > 0) {
					this._renderTable(appsCard, apps, [
						{ key: 'appName', label: 'App' },
						{ key: 'subscribers', label: 'Subscribers' },
						{ key: 'revenue', label: 'Revenue' },
						{ key: 'rating', label: 'Rating' },
					]);
				} else {
					this._showEmpty(appsCard, 'No app performance data yet.');
				}
			} catch {
				this._showEmpty(contentArea, 'Failed to load analytics data.');
			}
		};

		setPeriod(30);
	}

	private _renderBarChart(parent: HTMLElement, data: Array<{ label: string; value: number }>, color: string): void {
		if (data.length === 0) {
			const e = DOM.append(parent, DOM.$('div'));
			e.textContent = 'No data';
			e.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;padding:20px 0;';
			return;
		}
		const chart = DOM.append(parent, DOM.$('div'));
		chart.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:120px;';
		const max = Math.max(...data.map(d => d.value), 1);
		for (let i = 0; i < Math.min(data.length, 30); i++) {
			const d = data[i];
			const h = Math.max((d.value / max) * 110, 3);
			const bar = DOM.append(chart, DOM.$('div'));
			bar.style.cssText = `flex:1;height:${h}px;background:${color};border-radius:2px 2px 0 0;min-width:0;`;
			bar.title = `${d.label}: ${d.value}`;
		}
	}

	// allow-any-unicode-next-line
	// ─── Webhook Logs ───

	private async _renderWebhookLogs(): Promise<void> {
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'margin-bottom:16px;';
		const h2 = DOM.append(header, DOM.$('h2'));
		h2.textContent = 'Webhook Delivery Logs';
		h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const sub = DOM.append(header, DOM.$('div'));
		sub.textContent = 'Track webhook deliveries and debug failures';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';

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

				const tbl = DOM.append(tableEl, DOM.$('div'));
				tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;';
				const gridCols = 'auto 1fr 2fr auto auto auto auto';

				const hdr = DOM.append(tbl, DOM.$('div'));
				hdr.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:10px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);`;
				for (const lbl of ['Status', 'Event', 'URL', 'HTTP', 'Duration', 'Attempt', 'Time']) {
					DOM.append(hdr, DOM.$('span')).textContent = lbl;
				}

				for (const log of logs) {
					const r = DOM.append(tbl, DOM.$('div'));
					r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:10px;padding:8px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);align-items:center;`;
					const success = log.success === 'true' || log.success === true as unknown as string;
					const statusCell = DOM.append(r, DOM.$('span'));
					// allow-any-unicode-next-line
					statusCell.textContent = success ? '✓' : '✗';
					statusCell.style.cssText = `font-size:14px;font-weight:700;color:${success ? '#22c55e' : '#ef4444'};`;
					const evCell = DOM.append(r, DOM.$('code'));
					evCell.textContent = log.eventType || '';
					evCell.style.cssText = 'font-family:monospace;font-size:11px;background:rgba(128,128,128,0.1);padding:2px 6px;border-radius:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					const urlCell = DOM.append(r, DOM.$('span'));
					urlCell.textContent = log.requestUrl || log.url || '';
					urlCell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;';
					urlCell.title = log.requestUrl || log.url || '';
					const httpCell = DOM.append(r, DOM.$('span'));
					const status = log.responseStatus || log.httpStatus || '';
					const sNum = parseInt(status);
					httpCell.textContent = String(status);
					httpCell.style.cssText = `font-size:11px;font-weight:600;color:${sNum >= 200 && sNum < 300 ? '#22c55e' : sNum >= 400 ? '#ef4444' : 'var(--vscode-foreground)'};`;
					const durCell = DOM.append(r, DOM.$('span'));
					durCell.textContent = log.durationMs ? `${log.durationMs}ms` : '—';
					durCell.style.cssText = 'font-size:11px;';
					const attemptCell = DOM.append(r, DOM.$('span'));
					attemptCell.textContent = log.attemptNumber || log.attempt || '1';
					if (log.nextRetryAt) {
						attemptCell.textContent += ' (retry)';
					}
					attemptCell.style.cssText = 'font-size:11px;';
					const timeCell = DOM.append(r, DOM.$('span'));
					timeCell.textContent = log.createdAt ? this._fmtDate(log.createdAt) : '';
					timeCell.style.cssText = 'font-size:11px;';
				}

				if (totalPages > 1) {
					const pag = DOM.append(tableEl, DOM.$('div'));
					pag.style.cssText = 'display:flex;gap:8px;justify-content:center;align-items:center;margin-top:12px;';
					const prev = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
					prev.textContent = '← Previous';
					prev.style.cssText = BTN_SECONDARY + (page === 0 ? 'opacity:0.5;cursor:not-allowed;' : '');
					prev.disabled = page === 0;
					prev.addEventListener('click', () => loadPage(page - 1));
					const info = DOM.append(pag, DOM.$('span'));
					info.textContent = `Page ${page + 1} of ${totalPages}`;
					info.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
					const next = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
					next.textContent = 'Next →';
					next.style.cssText = BTN_SECONDARY + (page >= totalPages - 1 ? 'opacity:0.5;cursor:not-allowed;' : '');
					next.disabled = page >= totalPages - 1;
					next.addEventListener('click', () => loadPage(page + 1));
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
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'margin-bottom:16px;';
		const h2 = DOM.append(header, DOM.$('h2'));
		h2.textContent = 'Submission Review Queue';
		h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const sub = DOM.append(header, DOM.$('div'));
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		const listEl = DOM.append(this.contentEl, DOM.$('div'));
		let page = 0;

		const loadPage = async (p: number) => {
			DOM.clearNode(listEl);
			page = p;

			try {
				const res = await this.apiService.fetch(`/api/v1/admin/submissions?page=${page}&size=20`);
				if (!res.ok) { this._showEmpty(listEl, 'No submissions to review. (Admin access required)'); return; }
				const data = await res.json();
				const submissions = (data?.data?.content || data?.content || data?.data || []) as Record<string, string>[];
				const totalPages = data?.data?.totalPages || data?.totalPages || 1;
				const totalElements = data?.data?.totalElements || data?.totalElements || submissions.length;
				sub.textContent = `${totalElements} submission(s) pending review`;

				if (submissions.length === 0) { this._showEmpty(listEl, 'No pending submissions to review.'); return; }

				for (const s of submissions) {
					const card = DOM.append(listEl, DOM.$('div'));
					card.style.cssText = CARD_STYLE + 'cursor:pointer;';
					card.addEventListener('mouseenter', () => { card.style.background = 'var(--vscode-list-hoverBackground)'; });
					card.addEventListener('mouseleave', () => { card.style.background = ''; });
					card.addEventListener('click', () => { this.detailSubmissionId = s.id; this._renderSection(); });

					const row = DOM.append(card, DOM.$('div'));
					row.style.cssText = 'display:flex;align-items:center;gap:12px;';

					const statusColor = STATUS_COLORS[s.status || 'submitted'];
					const statusBar = DOM.append(row, DOM.$('div'));
					statusBar.style.cssText = `width:4px;height:50px;background:${statusColor};border-radius:2px;flex-shrink:0;`;

					const main = DOM.append(row, DOM.$('div'));
					main.style.cssText = 'flex:1;min-width:0;';
					const titleRow = DOM.append(main, DOM.$('div'));
					titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
					const appName = DOM.append(titleRow, DOM.$('strong'));
					appName.textContent = s.appName || 'Untitled';
					appName.style.cssText = 'font-size:14px;';
					if (s.version) {
						const ver = DOM.append(titleRow, DOM.$('span'));
						ver.textContent = `v${s.version}`;
						ver.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
					}
					const badge = DOM.append(titleRow, DOM.$('span'));
					badge.textContent = STATUS_LABELS[s.status || 'submitted'] || s.status;
					badge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:10px;background:${statusColor};color:#fff;text-transform:uppercase;letter-spacing:0.5px;`;

					const meta = DOM.append(main, DOM.$('div'));
					meta.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
					const parts: string[] = [];
					if (s.submissionType) { parts.push(s.submissionType); }
					if (s.category) { parts.push(s.category); }
					if (s.appSlug) { parts.push(s.appSlug); }
					if (s.submittedAt) { parts.push(`submitted ${this._fmtDate(s.submittedAt)}`); }
					meta.textContent = parts.join(' • ');

					const arrow = DOM.append(row, DOM.$('span'));
					arrow.textContent = '→';
					arrow.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:18px;';
				}

				if (totalPages > 1) {
					const pag = DOM.append(listEl, DOM.$('div'));
					pag.style.cssText = 'display:flex;gap:8px;justify-content:center;align-items:center;margin-top:12px;';
					const prev = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
					prev.textContent = '← Previous';
					prev.style.cssText = BTN_SECONDARY + (page === 0 ? 'opacity:0.5;cursor:not-allowed;' : '');
					prev.disabled = page === 0;
					prev.addEventListener('click', () => loadPage(page - 1));
					const info = DOM.append(pag, DOM.$('span'));
					info.textContent = `Page ${page + 1} of ${totalPages}`;
					info.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
					const next = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
					next.textContent = 'Next →';
					next.style.cssText = BTN_SECONDARY + (page >= totalPages - 1 ? 'opacity:0.5;cursor:not-allowed;' : '');
					next.disabled = page >= totalPages - 1;
					next.addEventListener('click', () => loadPage(page + 1));
				}
			} catch {
				this._showEmpty(listEl, 'Failed to load review queue. Admin access required.');
			}
		};

		await loadPage(0);
	}

	private async _renderReviewDetail(submissionId: string): Promise<void> {
		const backRow = DOM.append(this.contentEl, DOM.$('div'));
		backRow.style.cssText = 'margin-bottom:14px;';
		const back = DOM.append(backRow, DOM.$('button'));
		back.textContent = '← Back to Queue';
		back.style.cssText = BTN_SECONDARY;
		back.addEventListener('click', () => { this.detailSubmissionId = null; this._renderSection(); });

		const container = DOM.append(this.contentEl, DOM.$('div'));

		try {
			const res = await this.apiService.fetch(`/api/v1/admin/submissions/${submissionId}`);
			if (!res.ok) { this._showEmpty(container, 'Failed to load submission.'); return; }
			const data = await res.json();
			const s = (data?.data || data || {}) as Record<string, unknown>;

			// Title
			const titleRow = DOM.append(container, DOM.$('div'));
			titleRow.style.cssText = 'margin-bottom:14px;';
			const title = DOM.append(titleRow, DOM.$('h2'));
			title.textContent = `Review: ${String(s['appName'] || 'Untitled')}`;
			title.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
			const meta = DOM.append(titleRow, DOM.$('div'));
			meta.textContent = `${s['submissionType'] || ''} submission • ${s['appSlug'] || ''} • v${s['version'] || ''}`;
			meta.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';

			// Overview card
			const overview = DOM.append(container, DOM.$('div'));
			overview.style.cssText = CARD_STYLE;
			const overRow = DOM.append(overview, DOM.$('div'));
			overRow.style.cssText = 'display:flex;gap:14px;align-items:flex-start;';
			const iconBox = DOM.append(overRow, DOM.$('div'));
			iconBox.style.cssText = `width:64px;height:64px;border-radius:12px;background:linear-gradient(135deg,${COLORS[0]},${COLORS[4]});display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;flex-shrink:0;`;
			iconBox.textContent = String(s['appName'] || 'A').substring(0, 1).toUpperCase();
			const overInfo = DOM.append(overRow, DOM.$('div'));
			overInfo.style.cssText = 'flex:1;';
			const nameRow = DOM.append(overInfo, DOM.$('div'));
			nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
			const name = DOM.append(nameRow, DOM.$('strong'));
			name.textContent = String(s['appName'] || '');
			name.style.cssText = 'font-size:16px;';
			if (s['category']) {
				const catBadge = DOM.append(nameRow, DOM.$('span'));
				catBadge.textContent = String(s['category']);
				catBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;background:rgba(59,130,246,0.15);color:#3b82f6;';
			}
			const desc = DOM.append(overInfo, DOM.$('p'));
			desc.textContent = String(s['description'] || '');
			desc.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin:6px 0 0;';

			// Features
			const features = s['features'] as string[] | undefined;
			if (features && features.length > 0) {
				const fCard = DOM.append(container, DOM.$('div'));
				fCard.style.cssText = CARD_STYLE;
				this._addSectionTitle(fCard, 'Features');
				const fList = DOM.append(fCard, DOM.$('ul'));
				fList.style.cssText = 'margin:0;padding-left:18px;';
				for (const f of features) {
					const li = DOM.append(fList, DOM.$('li'));
					li.textContent = f;
					li.style.cssText = 'font-size:12px;margin-bottom:3px;';
				}
			}

			// Integration
			const intCard = DOM.append(container, DOM.$('div'));
			intCard.style.cssText = CARD_STYLE;
			this._addSectionTitle(intCard, 'Integration');
			this._renderDetailField(intCard, 'SMART Launch URL', String(s['smartLaunchUrl'] || ''));
			this._renderDetailField(intCard, 'FHIR Scopes', String(s['fhirScopes'] || ''));
			const fhirResources = s['fhirResources'] as string[] | undefined;
			if (fhirResources && fhirResources.length > 0) {
				this._renderDetailBadges(intCard, 'FHIR Resources', fhirResources);
			}
			const extPoints = s['extensionPoints'] as string[] | undefined;
			if (extPoints && extPoints.length > 0) {
				this._renderDetailBadges(intCard, 'Extension Points', extPoints);
			}

			// Decision panel
			const status = String(s['status'] || '');
			if (status === 'submitted' || status === 'in_review') {
				const decisionCard = DOM.append(container, DOM.$('div'));
				decisionCard.style.cssText = CARD_STYLE;
				this._addSectionTitle(decisionCard, 'Review Decision');
				const notesArea = this._addFormTextarea(decisionCard, 'Review Notes', 'Add review notes (optional)', 3);
				const rejReasonWrap = DOM.append(decisionCard, DOM.$('div'));
				rejReasonWrap.style.cssText = 'display:none;';
				const rejReason = this._addFormTextarea(rejReasonWrap, 'Rejection Reason', 'Reason shown to vendor', 2);

				const btnRow = DOM.append(decisionCard, DOM.$('div'));
				btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';
				const approve = DOM.append(btnRow, DOM.$('button'));
				approve.textContent = 'Approve & Publish';
				approve.style.cssText = BTN_SUCCESS;
				approve.addEventListener('click', async () => {
					await this.apiService.fetch(`/api/v1/admin/submissions/${submissionId}/review`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'approve', notes: notesArea.value }),
					});
					this.detailSubmissionId = null;
					await this._renderSection();
				});

				const reject = DOM.append(btnRow, DOM.$('button'));
				reject.textContent = 'Reject';
				reject.style.cssText = BTN_DANGER + 'padding:6px 14px;font-size:12px;';
				let rejecting = false;
				reject.addEventListener('click', async () => {
					if (!rejecting) {
						rejReasonWrap.style.display = '';
						reject.textContent = 'Confirm Reject';
						rejecting = true;
						return;
					}
					await this.apiService.fetch(`/api/v1/admin/submissions/${submissionId}/review`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'reject', notes: notesArea.value, rejectionReason: rejReason.value }),
					});
					this.detailSubmissionId = null;
					await this._renderSection();
				});

				const requestRev = DOM.append(btnRow, DOM.$('button'));
				requestRev.textContent = 'Request Revisions';
				requestRev.style.cssText = BTN_SECONDARY;
				requestRev.addEventListener('click', async () => {
					await this.apiService.fetch(`/api/v1/admin/submissions/${submissionId}/review`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'request_revisions', notes: notesArea.value }),
					});
					this.detailSubmissionId = null;
					await this._renderSection();
				});
			} else {
				const reviewedCard = DOM.append(container, DOM.$('div'));
				reviewedCard.style.cssText = CARD_STYLE;
				const result = DOM.append(reviewedCard, DOM.$('strong'));
				result.textContent = `Review: ${STATUS_LABELS[status] || status}`;
				result.style.cssText = `color:${STATUS_COLORS[status] || 'inherit'};`;
				if (s['reviewedAt']) {
					const w = DOM.append(reviewedCard, DOM.$('div'));
					w.textContent = `Reviewed on ${this._fmtDate(String(s['reviewedAt']))}`;
					w.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
				}
				if (s['reviewNotes']) {
					const n = DOM.append(reviewedCard, DOM.$('div'));
					n.textContent = `Notes: ${s['reviewNotes']}`;
					n.style.cssText = 'font-size:12px;margin-top:8px;';
				}
				if (s['rejectionReason']) {
					const rr = DOM.append(reviewedCard, DOM.$('div'));
					rr.textContent = `Rejection reason: ${s['rejectionReason']}`;
					rr.style.cssText = 'font-size:12px;margin-top:6px;color:#ef4444;';
				}
			}
		} catch {
			this._showEmpty(container, 'Failed to load submission detail.');
		}
	}

	private _renderDetailField(parent: HTMLElement, label: string, value: string): void {
		if (!value) { return; }
		const row = DOM.append(parent, DOM.$('div'));
		row.style.cssText = 'display:grid;grid-template-columns:160px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.06);';
		const l = DOM.append(row, DOM.$('span'));
		l.textContent = label;
		l.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const v = DOM.append(row, DOM.$('span'));
		v.textContent = value;
		v.style.cssText = 'font-size:12px;word-break:break-all;';
	}

	private _renderDetailBadges(parent: HTMLElement, label: string, items: string[]): void {
		const row = DOM.append(parent, DOM.$('div'));
		row.style.cssText = 'display:grid;grid-template-columns:160px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.06);';
		const l = DOM.append(row, DOM.$('span'));
		l.textContent = label;
		l.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const badges = DOM.append(row, DOM.$('div'));
		badges.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
		for (const item of items) {
			const b = DOM.append(badges, DOM.$('span'));
			b.textContent = item;
			b.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(59,130,246,0.15);color:#3b82f6;';
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

	private _addFormTextarea(parent: HTMLElement, label: string, placeholder: string, rows = 4): HTMLTextAreaElement {
		const wrapper = DOM.append(parent, DOM.$('div'));
		wrapper.style.cssText = 'margin-bottom:10px;';
		const lbl = DOM.append(wrapper, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const textarea = DOM.append(wrapper, DOM.$('textarea')) as HTMLTextAreaElement;
		textarea.placeholder = placeholder;
		textarea.rows = rows;
		textarea.style.cssText = INPUT_STYLE + 'width:100%;box-sizing:border-box;resize:vertical;';
		return textarea;
	}

	private _buildListEditor(parent: HTMLElement, label: string, placeholder: string): () => string[] {
		const wrapper = DOM.append(parent, DOM.$('div'));
		wrapper.style.cssText = 'margin-bottom:10px;';
		const lbl = DOM.append(wrapper, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
		const list = DOM.append(wrapper, DOM.$('div'));
		const inputs: HTMLInputElement[] = [];

		const addRow = (val = ''): void => {
			const row = DOM.append(list, DOM.$('div'));
			row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;';
			const input = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			input.type = 'text';
			input.placeholder = placeholder;
			input.value = val;
			input.style.cssText = INPUT_STYLE + 'flex:1;';
			inputs.push(input);
			const del = DOM.append(row, DOM.$('button'));
			// allow-any-unicode-next-line
			del.textContent = '−';
			del.style.cssText = BTN_SECONDARY + 'padding:5px 10px;';
			del.addEventListener('click', () => {
				const idx = inputs.indexOf(input);
				if (idx >= 0) { inputs.splice(idx, 1); }
				row.remove();
			});
		};
		addRow();
		const addBtn = DOM.append(wrapper, DOM.$('button'));
		addBtn.textContent = '+ Add';
		addBtn.style.cssText = BTN_SECONDARY + 'font-size:11px;padding:4px 10px;margin-top:4px;';
		addBtn.addEventListener('click', () => addRow());

		return () => inputs.map(i => i.value).filter(v => v.trim().length > 0);
	}

	private _addSectionTitle(parent: HTMLElement, title: string): void {
		const h = DOM.append(parent, DOM.$('h4'));
		h.textContent = title;
		h.style.cssText = 'margin:14px 0 8px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--vscode-editorWidget-border);padding-bottom:4px;';
	}

	private _showEmpty(parent: HTMLElement, message: string): void {
		const el = DOM.append(parent, DOM.$('div'));
		el.style.cssText = 'padding:40px 20px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
		el.textContent = message;
	}

	private _fmtDate(s: string): string {
		try {
			const d = new Date(s);
			if (isNaN(d.getTime())) { return s; }
			return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
		} catch { return s; }
	}

	private _renderTable(parent: HTMLElement, items: Record<string, string>[], columns: ColumnDef[], actions?: ActionDef[]): void {
		const tbl = DOM.append(parent, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;';

		const cols = actions && actions.length > 0 ? [...columns, { key: '__actions', label: 'Actions' }] : columns;
		const gridCols = cols.map(c => c.key === '__actions' ? 'auto' : '1fr').join(' ');

		const hdr = DOM.append(tbl, DOM.$('div'));
		hdr.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const c of cols) { DOM.append(hdr, DOM.$('span')).textContent = c.label; }

		for (const item of items) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:6px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);align-items:center;`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });

			for (const c of cols) {
				if (c.key === '__actions' && actions) {
					const actRow = DOM.append(r, DOM.$('div'));
					actRow.style.cssText = 'display:flex;gap:4px;';
					for (const act of actions) {
						if (act.visible && !act.visible(item)) { continue; }
						const btn = DOM.append(actRow, DOM.$('button'));
						btn.textContent = act.label;
						btn.style.cssText = act.style;
						btn.addEventListener('click', (e) => { e.stopPropagation(); act.handler(item); });
					}
				} else {
					const cell = DOM.append(r, DOM.$('span'));
					let val = String(item[c.key] ?? '');
					if ((c.key.endsWith('At') || c.key.endsWith('Date')) && val && !isNaN(Date.parse(val))) {
						val = this._fmtDate(val);
					}
					if (val.startsWith('[')) {
						try { val = (JSON.parse(val) as string[]).join(', '); } catch { /* */ }
					}
					if (Array.isArray(item[c.key] as unknown)) {
						val = (item[c.key] as unknown as string[]).join(', ');
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
