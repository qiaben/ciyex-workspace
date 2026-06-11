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
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

// allow-any-unicode-next-line
const TABS = ['Message Log', 'Campaigns', 'Templates', 'Event Preferences', 'Configuration'] as const;
// allow-any-unicode-next-line
const TAB_ICONS = ['✈', '👥', '📋', '📅', '⚙'] as const;

const STATUS_COLORS: Record<string, string> = {
	queued: '#f59e0b', sent: '#3b82f6', delivered: '#22c55e', failed: '#ef4444', bounced: '#ef4444',
	draft: '#6b7280', scheduled: '#3b82f6', sending: '#f59e0b', completed: '#22c55e', cancelled: '#ef4444',
};

const EVENT_TYPES = [
	{ key: 'appointment_reminder', label: 'Appointment Reminder', desc: 'Sent before a scheduled appointment' },
	{ key: 'appointment_confirmation', label: 'Appointment Confirmation', desc: 'Sent when an appointment is booked' },
	{ key: 'lab_result_ready', label: 'Lab Result Ready', desc: 'Sent when lab results are available' },
	{ key: 'prescription_ready', label: 'Prescription Ready', desc: 'Sent when a prescription is ready for pickup' },
	{ key: 'recall_due', label: 'Recall Due', desc: 'Sent when a patient recall is due' },
	{ key: 'billing_statement', label: 'Billing Statement', desc: 'Sent with billing statement' },
];

const TIMING_OPTIONS = [
	{ value: 'immediate', label: 'Immediate' }, { value: '1h_before', label: '1 hour before' },
	{ value: '2h_before', label: '2 hours before' }, { value: '24h_before', label: '24 hours before' },
	{ value: '48h_before', label: '48 hours before' }, { value: '72h_before', label: '72 hours before' },
	{ value: '1w_before', label: '1 week before' },
];

interface ProviderField { key: string; label: string; type?: string; placeholder?: string }
const PROVIDER_FIELDS: Record<string, ProviderField[]> = {
	smtp: [
		{ key: 'host', label: 'SMTP Host', placeholder: 'smtp.gmail.com' },
		{ key: 'port', label: 'Port', type: 'number', placeholder: '587' },
		{ key: 'username', label: 'Username', placeholder: 'user@example.com' },
		{ key: 'password', label: 'Password', type: 'password', placeholder: 'App password' },
		{ key: 'from_email', label: 'From Email', placeholder: 'noreply@example.com' },
		{ key: 'from_name', label: 'From Name', placeholder: 'Practice Name' },
	],
	sendgrid: [{ key: 'api_key', label: 'API Key', type: 'password' }, { key: 'from_email', label: 'From Email' }, { key: 'from_name', label: 'From Name' }],
	mailgun: [{ key: 'api_key', label: 'API Key', type: 'password' }, { key: 'domain', label: 'Domain' }, { key: 'from_email', label: 'From Email' }, { key: 'from_name', label: 'From Name' }],
	twilio: [{ key: 'account_sid', label: 'Account SID' }, { key: 'auth_token', label: 'Auth Token', type: 'password' }, { key: 'from_number', label: 'From Number' }],
	vonage: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'API Secret', type: 'password' }, { key: 'from_number', label: 'From Number' }],
};

const TEMPLATE_VARIABLES = [
	'{{patientName}}', '{{providerName}}', '{{appointmentDate}}', '{{appointmentTime}}',
	'{{practiceName}}', '{{practicePhone}}', '{{portalLink}}', '{{labResultUrl}}',
	'{{prescriptionName}}', '{{pickupLocation}}', '{{recallDueDate}}', '{{balanceAmount}}',
];

const inputStyle = 'width:100%;padding:7px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
const btnPrimary = 'padding:7px 16px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
const btnSecondary = 'padding:7px 16px;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;';

/**
 * Full-featured Notifications editor with 5 tabs matching the EHR web UI.
 */
export class NotificationsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexNotifications';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private activeTab = 0;

	// Data
	private logs: Record<string, unknown>[] = [];
	private logStats: Record<string, number> = {};
	private logPage = 0;
	private logFilter = '';
	private campaigns: Record<string, unknown>[] = [];
	private templates: Record<string, unknown>[] = [];
	private preferences: Record<string, unknown>[] = [];
	private emailConfig: Record<string, unknown> = {};
	private smsConfig: Record<string, unknown> = {};
	private editingTemplate: Record<string, unknown> | null = null;
	private creatingCampaign = false;
	private campaignForm: Record<string, unknown> = {};
	private editingTemplateActive = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super(NotificationsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.notifications-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1200px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._loadTab();
	}

	private async _loadTab(): Promise<void> {
		switch (this.activeTab) {
			case 0: await this._loadMessageLog(); break;
			case 1: await this._loadCampaigns(); break;
			case 2: await this._loadTemplates(); break;
			case 3: await this._loadPreferences(); break;
			case 4: await this._loadConfig(); break;
		}
		this._render();
	}

	private async _loadMessageLog(): Promise<void> {
		try {
			let url = `/api/notifications/log?page=${this.logPage}&size=20`;
			if (this.logFilter) { url += `&status=${this.logFilter}`; }
			const [logRes, statsRes] = await Promise.all([
				this.apiService.fetch(url),
				this.apiService.fetch('/api/notifications/log/stats'),
			]);
			if (logRes.ok) { const d = await logRes.json(); this.logs = d?.data?.content || d?.content || d?.data || []; }
			if (statsRes.ok) { this.logStats = (await statsRes.json())?.data || {}; }
		} catch { /* */ }
	}

	private async _loadCampaigns(): Promise<void> {
		try {
			const [campRes, templRes] = await Promise.all([
				this.apiService.fetch('/api/notifications/campaigns'),
				this.apiService.fetch('/api/notifications/config/templates'),
			]);
			if (campRes.ok) { const d = await campRes.json(); this.campaigns = d?.data?.content || d?.content || d?.data || []; }
			if (templRes.ok) { const d = await templRes.json(); this.templates = d?.data?.content || d?.content || d?.data || []; }
		} catch { /* */ }
	}

	private async _loadTemplates(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/notifications/config/templates');
			if (res.ok) { const d = await res.json(); this.templates = d?.data?.content || d?.content || d?.data || []; }
		} catch { /* */ }
	}

	private async _loadPreferences(): Promise<void> {
		try {
			const [prefRes, templRes] = await Promise.all([
				this.apiService.fetch('/api/notifications/config/preferences'),
				this.apiService.fetch('/api/notifications/config/templates'),
			]);
			if (prefRes.ok) { const d = await prefRes.json(); this.preferences = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : []; }
			if (templRes.ok) { const d = await templRes.json(); this.templates = d?.data?.content || d?.content || d?.data || []; }
		} catch { /* */ }
	}

	private async _loadConfig(): Promise<void> {
		try {
			const [emailRes, smsRes] = await Promise.all([
				this.apiService.fetch('/api/notifications/config/email'),
				this.apiService.fetch('/api/notifications/config/sms'),
			]);
			if (emailRes.ok) { this.emailConfig = (await emailRes.json())?.data || {}; }
			if (smsRes.ok) { this.smsConfig = (await smsRes.json())?.data || {}; }
		} catch { /* */ }
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		// Header
		const hdr = DOM.append(this.contentEl, DOM.$('div'));
		hdr.style.cssText = 'margin-bottom:16px;';
		const h = DOM.append(hdr, DOM.$('h2'));
		h.textContent = 'Notifications';
		h.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 4px;';
		const sub = DOM.append(hdr, DOM.$('div'));
		sub.textContent = 'Email & SMS configuration, templates, and delivery log';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

		// Tabs
		const tabBar = DOM.append(this.contentEl, DOM.$('div'));
		tabBar.style.cssText = 'display:flex;gap:0;border-bottom:2px solid var(--vscode-editorWidget-border);margin-bottom:16px;overflow-x:auto;';
		for (let i = 0; i < TABS.length; i++) {
			const btn = DOM.append(tabBar, DOM.$('button'));
			const active = i === this.activeTab;
			// allow-any-unicode-next-line
			btn.textContent = `${TAB_ICONS[i]} ${TABS[i]}`;
			btn.style.cssText = `padding:8px 16px;border:none;background:none;cursor:pointer;font-size:12px;border-bottom:2px solid ${active ? '#0e639c' : 'transparent'};margin-bottom:-2px;color:${active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};font-weight:${active ? '600' : '400'};white-space:nowrap;`;
			btn.addEventListener('click', () => { this.activeTab = i; this.creatingCampaign = false; this.editingTemplate = null; this.editingTemplateActive = false; this._loadTab(); });
		}

		// Tab content
		switch (this.activeTab) {
			case 0: this._renderMessageLog(); break;
			case 1: this._renderCampaigns(); break;
			case 2: this._renderTemplates(); break;
			case 3: this._renderEventPreferences(); break;
			case 4: this._renderConfiguration(); break;
		}
	}

	// allow-any-unicode-next-line
	// ─── Tab 0: Message Log ───
	private _renderMessageLog(): void {
		// Stats cards
		const statsRow = DOM.append(this.contentEl, DOM.$('div'));
		statsRow.style.cssText = 'display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;';
		for (const [key, color] of [['totalSent', '#3b82f6'], ['totalDelivered', '#22c55e'], ['totalFailed', '#ef4444'], ['totalBounced', '#ef4444'], ['totalQueued', '#f59e0b']] as const) {
			const card = DOM.append(statsRow, DOM.$('div'));
			card.style.cssText = `flex:1;min-width:120px;padding:12px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;`;
			const num = DOM.append(card, DOM.$('div'));
			num.textContent = String(this.logStats[key] || 0);
			num.style.cssText = `font-size:20px;font-weight:700;color:${color};`;
			const lbl = DOM.append(card, DOM.$('div'));
			lbl.textContent = key.replace('total', '');
			lbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}

		// Filter tabs
		const filters = DOM.append(this.contentEl, DOM.$('div'));
		filters.style.cssText = 'display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;';
		for (const f of [{ label: 'All', value: '' }, { label: 'Queued', value: 'queued' }, { label: 'Sent', value: 'sent' }, { label: 'Delivered', value: 'delivered' }, { label: 'Failed', value: 'failed' }, { label: 'Bounced', value: 'bounced' }]) {
			const btn = DOM.append(filters, DOM.$('button'));
			btn.textContent = f.label;
			const act = this.logFilter === f.value;
			btn.style.cssText = `padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;border:1px solid ${act ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};background:${act ? 'rgba(0,122,204,0.15)' : 'transparent'};color:var(--vscode-foreground);`;
			btn.addEventListener('click', () => { this.logFilter = f.value; this.logPage = 0; this._loadTab(); });
		}

		// Table
		this._renderTable(this.contentEl, this.logs,
			[{ key: 'channelType', label: 'Channel', w: '70px' }, { key: 'recipientName', label: 'Recipient' }, { key: 'recipient', label: 'Address' }, { key: 'subject', label: 'Subject', w: '1.5fr' }, { key: 'status', label: 'Status', w: '90px' }, { key: 'sentAt', label: 'Sent At', w: '130px' }],
			(item) => {
				const acts = document.createElement('div');
				acts.style.cssText = 'display:flex;gap:4px;';
				const view = DOM.append(acts, DOM.$('button'));
				// allow-any-unicode-next-line
				view.textContent = '👁';
				view.title = 'View details';
				view.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;';
				view.addEventListener('click', e => { e.stopPropagation(); this._showLogDetail(item); });
				if (item.status === 'failed' || item.status === 'bounced') {
					const retry = DOM.append(acts, DOM.$('button'));
					// allow-any-unicode-next-line
					retry.textContent = '🔄';
					retry.title = 'Retry';
					retry.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;';
					retry.addEventListener('click', async e => {
						e.stopPropagation();
						const res = await this.apiService.fetch(`/api/notifications/${item.id}/retry`, { method: 'POST' });
						const json = await res.json().catch(() => ({}));
						if (res.ok && json?.success !== false) {
							this.notificationService.notify({ severity: Severity.Info, message: 'Message requeued for retry.' });
						} else {
							this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Retry failed.' });
						}
						this._loadTab();
					});
				}
				return acts;
			},
			item => this._showLogDetail(item),
		);

		// Pagination
		this._renderPagination(this.contentEl, this.logPage, this.logs.length >= 20, () => { this.logPage--; this._loadTab(); }, () => { this.logPage++; this._loadTab(); });
	}

	private _showLogDetail(item: Record<string, unknown>): void {
		// Modal overlay — attach to the active window so multi-window scenarios work
		const win = DOM.getWindow(this.root) ?? DOM.getActiveWindow();
		const overlay = DOM.append(win.document.body, DOM.$('.ciyex-log-detail-overlay'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:min(720px,90vw);max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,0.4);';

		const hdr = DOM.append(modal, DOM.$('div'));
		hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const title = DOM.append(hdr, DOM.$('h3'));
		title.textContent = 'Message details';
		title.style.cssText = 'margin:0;font-size:14px;font-weight:600;';
		const closeBtn = DOM.append(hdr, DOM.$('button'));
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = 'background:none;border:none;color:var(--vscode-foreground);font-size:16px;cursor:pointer;';
		const close = () => overlay.remove();
		closeBtn.addEventListener('click', close);
		overlay.addEventListener('click', e => { if (e.target === overlay) { close(); } });

		const content = DOM.append(modal, DOM.$('div'));
		content.style.cssText = 'padding:16px 18px;overflow-y:auto;display:grid;grid-template-columns:140px 1fr;gap:8px 14px;font-size:12px;';

		const status = String(item.status || '').toLowerCase();
		const statusColor = STATUS_COLORS[status] || '#6b7280';

		const addRow = (label: string, value: string, opts?: { mono?: boolean; color?: string; multiline?: boolean }) => {
			const l = DOM.append(content, DOM.$('div'));
			l.textContent = label;
			l.style.cssText = 'font-weight:600;color:var(--vscode-descriptionForeground);';
			const v = DOM.append(content, DOM.$('div'));
			v.textContent = value || '—';
			let css = 'word-break:break-word;';
			if (opts?.mono) { css += 'font-family:var(--vscode-editor-font-family,monospace);'; }
			if (opts?.color) { css += `color:${opts.color};font-weight:600;`; }
			if (opts?.multiline) { css += 'white-space:pre-wrap;background:rgba(128,128,128,0.08);padding:8px;border-radius:4px;max-height:200px;overflow:auto;'; }
			v.style.cssText = css;
		};

		addRow('Status', String(item.status || ''), { color: statusColor });
		addRow('Channel', String(item.channelType || '').toUpperCase());
		addRow('Recipient', `${item.recipientName ? String(item.recipientName) + ' · ' : ''}${String(item.recipient || '')}`);
		if (item.subject) { addRow('Subject', String(item.subject)); }
		if (item.patientName || item.patientId) {
			addRow('Patient', String(item.patientName || `#${item.patientId}`));
		}
		if (item.triggerType) { addRow('Trigger', String(item.triggerType)); }
		if (item.templateKey) { addRow('Template', String(item.templateKey)); }
		if (item.sentBy) { addRow('Sent by', String(item.sentBy)); }
		if (item.sentAt) {
			try { addRow('Sent at', new Date(String(item.sentAt)).toLocaleString()); }
			catch { addRow('Sent at', String(item.sentAt)); }
		}
		if (item.deliveredAt) {
			try { addRow('Delivered', new Date(String(item.deliveredAt)).toLocaleString()); }
			catch { addRow('Delivered', String(item.deliveredAt)); }
		}
		if (item.externalId) { addRow('External ID', String(item.externalId), { mono: true }); }
		if (item.body) { addRow('Body', String(item.body), { multiline: true }); }
		if (item.errorMessage) { addRow('Error', String(item.errorMessage), { multiline: true, color: '#ef4444' }); }
	}

	// allow-any-unicode-next-line
	// ─── Tab 1: Campaigns ───
	private _renderCampaigns(): void {
		if (this.creatingCampaign) {
			this._renderCampaignForm();
			return;
		}

		// Header row with "+ New Campaign" button
		const hdrRow = DOM.append(this.contentEl, DOM.$('div'));
		hdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
		const hdrTitle = DOM.append(hdrRow, DOM.$('h3'));
		// allow-any-unicode-next-line
		hdrTitle.textContent = '👥 Bulk Campaigns';
		hdrTitle.style.cssText = 'margin:0;font-size:14px;font-weight:600;';
		const newBtn = DOM.append(hdrRow, DOM.$('button'));
		// allow-any-unicode-next-line
		newBtn.textContent = '+ New Campaign';
		newBtn.style.cssText = btnPrimary;
		newBtn.addEventListener('click', () => { this.creatingCampaign = true; this.campaignForm = { name: '', channelType: 'email', subject: '', body: '' }; this._render(); });

		// Campaign list / empty state
		if (this.campaigns.length === 0) {
			const empty = DOM.append(this.contentEl, DOM.$('div'));
			empty.textContent = 'No campaigns yet. Create your first one.';
			empty.style.cssText = 'text-align:center;color:var(--vscode-descriptionForeground);padding:60px 40px;font-size:13px;';
			return;
		}

		this._renderTable(this.contentEl, this.campaigns,
			[{ key: 'name', label: 'Name' }, { key: 'channelType', label: 'Channel', w: '70px' }, { key: 'status', label: 'Status', w: '90px' }, { key: 'totalRecipients', label: 'Recipients', w: '80px' }, { key: 'sentCount', label: 'Sent', w: '60px' }, { key: 'failedCount', label: 'Failed', w: '60px' }],
			(item) => {
				const d = document.createElement('div');
				d.style.cssText = 'display:flex;gap:4px;';
				const view = DOM.append(d, DOM.$('button'));
				// allow-any-unicode-next-line
				view.textContent = '👁';
				view.title = 'View Campaign';
				view.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;';
				view.addEventListener('click', e => { e.stopPropagation(); this.creatingCampaign = true; this.campaignForm = { ...item }; this._render(); });
				if (item.status === 'draft' || item.status === 'scheduled') {
					const start = DOM.append(d, DOM.$('button'));
					start.textContent = 'Start';
					start.title = 'Start Campaign';
					start.style.cssText = 'padding:2px 8px;background:#22c55e;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
					start.addEventListener('click', async e => { e.stopPropagation(); await this.apiService.fetch(`/api/notifications/campaigns/${item.id}/start`, { method: 'POST' }); this._loadTab(); });
				}
				if (item.status === 'draft' || item.status === 'scheduled' || item.status === 'sending') {
					const cancel = DOM.append(d, DOM.$('button'));
					cancel.textContent = 'Cancel';
					cancel.title = 'Cancel Campaign';
					cancel.style.cssText = 'padding:2px 8px;background:#ef4444;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
					cancel.addEventListener('click', async e => { e.stopPropagation(); await this.apiService.fetch(`/api/notifications/campaigns/${item.id}/cancel`, { method: 'POST' }); this._loadTab(); });
				}
				return d;
			},
		);
	}

	private _renderCampaignForm(): void {
		const form = this.campaignForm;
		const formCard = DOM.append(this.contentEl, DOM.$('div'));
		formCard.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:16px;margin-bottom:16px;';

		const fTitleRow = DOM.append(formCard, DOM.$('div'));
		fTitleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
		const fTitle = DOM.append(fTitleRow, DOM.$('h3'));
		fTitle.textContent = 'New Campaign';
		fTitle.style.cssText = 'margin:0;font-size:14px;font-weight:600;';
		const closeBtn = DOM.append(fTitleRow, DOM.$('button'));
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = 'background:none;border:none;color:var(--vscode-foreground);font-size:16px;cursor:pointer;';
		closeBtn.addEventListener('click', () => { this.creatingCampaign = false; this._render(); });

		// Name + Channel
		const grid = DOM.append(formCard, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';
		const nameIn = this._addInput(grid, 'Campaign Name', 'text', '', String(form.name || ''));
		const channelSel = this._addSelect(grid, 'Channel', [{ label: 'Email', value: 'email' }, { label: 'SMS', value: 'sms' }]);
		channelSel.value = String(form.channelType || 'email');

		// Template (optional)
		const templateSel = this._addSelect(formCard, 'Template (optional)', []);
		(templateSel.parentElement as HTMLElement).style.marginTop = '12px';
		const populateTemplates = () => {
			DOM.clearNode(templateSel);
			const none = DOM.append(templateSel, DOM.$('option')) as HTMLOptionElement;
			none.value = ''; none.textContent = '-- None --';
			for (const t of this.templates) {
				if (t.isActive === false) { continue; }
				if (String(t.channelType) !== channelSel.value) { continue; }
				const opt = DOM.append(templateSel, DOM.$('option')) as HTMLOptionElement;
				opt.value = String(t.id); opt.textContent = String(t.name);
			}
			templateSel.value = String(form.templateId ?? '');
		};
		populateTemplates();

		// Subject (email only)
		const subjectGrp = DOM.append(formCard, DOM.$('div'));
		subjectGrp.style.cssText = 'margin-top:12px;';
		const sLbl = DOM.append(subjectGrp, DOM.$('label'));
		sLbl.textContent = 'Subject';
		sLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const subjectIn = DOM.append(subjectGrp, DOM.$('input')) as HTMLInputElement;
		subjectIn.style.cssText = inputStyle;
		subjectIn.value = String(form.subject || '');

		const toggleSubject = () => { subjectGrp.style.display = channelSel.value === 'sms' ? 'none' : 'block'; };
		toggleSubject();
		channelSel.addEventListener('change', () => { populateTemplates(); toggleSubject(); });

		// Recipients
		const recipientsGrp = DOM.append(formCard, DOM.$('div'));
		recipientsGrp.style.cssText = 'margin-top:12px;';
		const rLbl = DOM.append(recipientsGrp, DOM.$('label'));
		rLbl.textContent = 'Recipients';
		rLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const recipientsIn = DOM.append(recipientsGrp, DOM.$('textarea')) as HTMLTextAreaElement;
		recipientsIn.placeholder = 'Enter recipient emails, one per line or comma-separated';
		recipientsIn.style.cssText = inputStyle + 'min-height:60px;resize:vertical;font-family:inherit;';
		const tc = form.targetCriteria as Record<string, unknown> | undefined;
		recipientsIn.value = String(tc?.recipientEmails ?? '');
		const rHelp = DOM.append(recipientsGrp, DOM.$('p'));
		rHelp.textContent = 'Enter patient emails separated by commas or newlines';
		rHelp.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin:4px 0 0;';

		// Body
		const bodyGrp = DOM.append(formCard, DOM.$('div'));
		bodyGrp.style.cssText = 'margin-top:12px;';
		const bLbl = DOM.append(bodyGrp, DOM.$('label'));
		bLbl.textContent = 'Body';
		bLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const bodyIn = DOM.append(bodyGrp, DOM.$('textarea')) as HTMLTextAreaElement;
		bodyIn.style.cssText = inputStyle + 'min-height:100px;resize:vertical;font-family:var(--vscode-editor-font-family,monospace);';
		bodyIn.value = String(form.body || '');

		// Actions
		const formBtns = DOM.append(formCard, DOM.$('div'));
		formBtns.style.cssText = 'display:flex;gap:8px;margin-top:14px;';
		const cancelBtn = DOM.append(formBtns, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = btnSecondary;
		cancelBtn.addEventListener('click', () => { this.creatingCampaign = false; this._render(); });
		const createBtn = DOM.append(formBtns, DOM.$('button')) as HTMLButtonElement;
		createBtn.textContent = 'Create Campaign';
		createBtn.style.cssText = btnPrimary;
		createBtn.addEventListener('click', async () => {
			if (!nameIn.value.trim()) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Campaign name is required.' });
				return;
			}
			createBtn.disabled = true;
			createBtn.textContent = 'Creating...';
			try {
				const payload: Record<string, unknown> = {
					name: nameIn.value,
					channelType: channelSel.value,
					subject: channelSel.value === 'email' ? subjectIn.value : '',
					body: bodyIn.value,
					status: 'draft',
				};
				if (templateSel.value) { payload.templateId = Number(templateSel.value); }
				// Backend expects targetCriteria as a JSON string
				payload.targetCriteria = JSON.stringify({ recipientEmails: recipientsIn.value });
				const res = await this.apiService.fetch('/api/notifications/campaigns', {
					method: 'POST', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				const json = await res.json().catch(() => ({}));
				if (res.ok && json?.success !== false) {
					this.notificationService.notify({ severity: Severity.Info, message: 'Campaign created.' });
					this.creatingCampaign = false;
					this._loadTab();
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Create failed.' });
				}
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Error, message: `Network error: ${String(err)}` });
			} finally {
				createBtn.disabled = false;
				createBtn.textContent = 'Create Campaign';
			}
		});
	}

	// allow-any-unicode-next-line
	// ─── Tab 2: Templates ───
	private _renderTemplates(): void {
		// Default: list view + "+ New Template" button. The form is shown only
		// when the user clicks "+ New Template" or edits an existing template.
		if (!this.editingTemplateActive) {
			this._renderTemplateList();
			return;
		}
		this._renderTemplateForm();
	}

	private _renderTemplateList(): void {
		// Header row with "+ New Template" button
		const hdrRow = DOM.append(this.contentEl, DOM.$('div'));
		hdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
		const hdrTitle = DOM.append(hdrRow, DOM.$('h3'));
		// allow-any-unicode-next-line
		hdrTitle.textContent = '📋 Message Templates';
		hdrTitle.style.cssText = 'margin:0;font-size:14px;font-weight:600;';
		const newBtn = DOM.append(hdrRow, DOM.$('button'));
		// allow-any-unicode-next-line
		newBtn.textContent = '+ New Template';
		newBtn.style.cssText = btnPrimary;
		newBtn.addEventListener('click', () => { this.editingTemplate = null; this.editingTemplateActive = true; this._render(); });

		if (this.templates.length === 0) {
			const empty = DOM.append(this.contentEl, DOM.$('div'));
			empty.textContent = 'No templates yet. Create your first one.';
			empty.style.cssText = 'text-align:center;color:var(--vscode-descriptionForeground);padding:60px 40px;font-size:13px;';
			return;
		}

		this._renderTable(this.contentEl, this.templates,
			[{ key: 'name', label: 'Name' }, { key: 'templateKey', label: 'Key' }, { key: 'channelType', label: 'Channel', w: '70px' }, { key: 'subject', label: 'Subject' }, { key: 'isActive', label: 'Active', w: '60px' }],
			(item) => {
				const d = document.createElement('div');
				d.style.cssText = 'display:flex;gap:4px;';
				const edit = DOM.append(d, DOM.$('button'));
				// allow-any-unicode-next-line
				edit.textContent = '✎';
				edit.title = 'Edit';
				edit.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;color:var(--vscode-foreground);';
				edit.addEventListener('click', e => { e.stopPropagation(); this.editingTemplate = item; this.editingTemplateActive = true; this._render(); });
				const del = DOM.append(d, DOM.$('button'));
				// allow-any-unicode-next-line
				del.textContent = '🗑️';
				del.title = 'Delete';
				del.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;';
				del.addEventListener('click', async e => {
					e.stopPropagation();
					const { confirmed } = await this.dialogService.confirm({ message: `Delete template "${String(item.name)}"?` });
					if (!confirmed) { return; }
					const res = await this.apiService.fetch(`/api/notifications/config/templates/${item.id}`, { method: 'DELETE' });
					const json = await res.json().catch(() => ({}));
					if (res.ok && json?.success !== false) {
						this.notificationService.notify({ severity: Severity.Info, message: 'Template deleted.' });
					} else {
						this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Delete failed.' });
					}
					this._loadTab();
				});
				return d;
			},
		);
	}

	private _renderTemplateForm(): void {
		const editing = this.editingTemplate;
		const isEdit = !!editing?.id;

		// Form card (handles both create and edit)
		const formCard = DOM.append(this.contentEl, DOM.$('div'));
		formCard.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:16px;margin-bottom:16px;';

		const fTitleRow = DOM.append(formCard, DOM.$('div'));
		fTitleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
		const fTitle = DOM.append(fTitleRow, DOM.$('h3'));
		fTitle.textContent = isEdit ? `Edit Template: ${String(editing?.name || '')}` : 'New Template';
		fTitle.style.cssText = 'margin:0;font-size:14px;font-weight:600;';

		const closeBtn = DOM.append(fTitleRow, DOM.$('button'));
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.title = 'Close';
		closeBtn.style.cssText = 'background:none;border:none;color:var(--vscode-foreground);font-size:16px;cursor:pointer;';
		closeBtn.addEventListener('click', () => { this.editingTemplate = null; this.editingTemplateActive = false; this._render(); });

		const grid = DOM.append(formCard, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;';

		const nameIn = this._addInput(grid, 'Name', 'text', 'Template name', String(editing?.name || ''));
		const keyIn = this._addInput(grid, 'Template Key', 'text', 'e.g. appointment_reminder', String(editing?.templateKey || ''));
		const channelSel = this._addSelect(grid, 'Channel', [{ label: 'Email', value: 'email' }, { label: 'SMS', value: 'sms' }]);
		channelSel.value = String(editing?.channelType || 'email');

		// isActive toggle (visible when editing)
		const statusRow = DOM.append(formCard, DOM.$('label'));
		statusRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;margin-top:12px;cursor:pointer;';
		const activeCb = DOM.append(statusRow, DOM.$('input')) as HTMLInputElement;
		activeCb.type = 'checkbox';
		activeCb.checked = editing?.isActive !== false;
		const activeLbl = DOM.append(statusRow, DOM.$('span'));
		activeLbl.textContent = 'Active';
		if (editing?.isDefault) {
			const defaultBadge = DOM.append(statusRow, DOM.$('span'));
			defaultBadge.textContent = 'DEFAULT';
			defaultBadge.style.cssText = 'margin-left:8px;padding:2px 6px;font-size:9px;font-weight:600;color:#3b82f6;background:rgba(59,130,246,0.15);border-radius:3px;';
		}

		// Subject (email only)
		const subjectGrp = DOM.append(formCard, DOM.$('div'));
		subjectGrp.style.cssText = 'margin-top:12px;';
		const sLbl = DOM.append(subjectGrp, DOM.$('label'));
		sLbl.textContent = 'Subject';
		sLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const subjectIn = DOM.append(subjectGrp, DOM.$('input')) as HTMLInputElement;
		subjectIn.style.cssText = inputStyle;
		subjectIn.value = String(editing?.subject || '');

		const toggleSubject = () => { subjectGrp.style.display = channelSel.value === 'sms' ? 'none' : 'block'; };
		toggleSubject();
		channelSel.addEventListener('change', toggleSubject);

		// Variable insertion buttons
		const varRow = DOM.append(formCard, DOM.$('div'));
		varRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;';
		const varLbl = DOM.append(varRow, DOM.$('div'));
		varLbl.textContent = 'Insert variable: ';
		varLbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);width:100%;margin-bottom:2px;';
		let lastFocused: HTMLInputElement | HTMLTextAreaElement | null = null;

		// Body (plain text)
		const bodyGrp = DOM.append(formCard, DOM.$('div'));
		bodyGrp.style.cssText = 'margin-top:12px;';
		const bLbl = DOM.append(bodyGrp, DOM.$('label'));
		bLbl.textContent = 'Body (plain text)';
		bLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const bodyIn = DOM.append(bodyGrp, DOM.$('textarea')) as HTMLTextAreaElement;
		bodyIn.style.cssText = inputStyle + 'min-height:100px;resize:vertical;font-family:inherit;';
		bodyIn.value = String(editing?.body || '');

		// HTML body (email only)
		const htmlGrp = DOM.append(formCard, DOM.$('div'));
		htmlGrp.style.cssText = 'margin-top:12px;';
		const hLbl = DOM.append(htmlGrp, DOM.$('label'));
		hLbl.textContent = 'HTML Body (optional)';
		hLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const htmlIn = DOM.append(htmlGrp, DOM.$('textarea')) as HTMLTextAreaElement;
		htmlIn.style.cssText = inputStyle + 'min-height:100px;resize:vertical;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;';
		htmlIn.value = String(editing?.htmlBody || '');

		const toggleHtml = () => { htmlGrp.style.display = channelSel.value === 'sms' ? 'none' : 'block'; };
		toggleHtml();
		channelSel.addEventListener('change', toggleHtml);

		// Track focus across body/subject/html so variable insertion targets the right field
		subjectIn.addEventListener('focus', () => { lastFocused = subjectIn; });
		bodyIn.addEventListener('focus', () => { lastFocused = bodyIn; });
		htmlIn.addEventListener('focus', () => { lastFocused = htmlIn; });
		lastFocused = bodyIn;

		for (const v of TEMPLATE_VARIABLES) {
			const btn = DOM.append(varRow, DOM.$('button'));
			btn.textContent = v;
			btn.style.cssText = 'padding:3px 8px;background:rgba(0,122,204,0.1);color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:3px;cursor:pointer;font-size:10px;font-family:var(--vscode-editor-font-family,monospace);';
			btn.addEventListener('click', e => {
				e.preventDefault();
				const target = lastFocused || bodyIn;
				const start = target.selectionStart || 0;
				const end = target.selectionEnd || 0;
				target.value = target.value.slice(0, start) + v + target.value.slice(end);
				const pos = start + v.length;
				target.focus();
				target.setSelectionRange(pos, pos);
			});
		}

		// Save buttons
		const formBtns = DOM.append(formCard, DOM.$('div'));
		formBtns.style.cssText = 'display:flex;gap:8px;margin-top:14px;';

		const cancelBtn = DOM.append(formBtns, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = btnSecondary;
		cancelBtn.addEventListener('click', () => { this.editingTemplate = null; this.editingTemplateActive = false; this._render(); });

		const saveBtn = DOM.append(formBtns, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Update Template' : 'Create Template';
		saveBtn.style.cssText = btnPrimary;
		saveBtn.addEventListener('click', async () => {
			if (!nameIn.value.trim() || !keyIn.value.trim()) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Name and Template Key are required.' });
				return;
			}
			saveBtn.disabled = true;
			const payload: Record<string, unknown> = {
				name: nameIn.value.trim(),
				templateKey: keyIn.value.trim(),
				channelType: channelSel.value,
				subject: channelSel.value === 'email' ? subjectIn.value : null,
				body: bodyIn.value,
				htmlBody: channelSel.value === 'email' ? htmlIn.value : null,
				isActive: activeCb.checked,
			};
			try {
				const url = isEdit ? `/api/notifications/config/templates/${editing!.id}` : '/api/notifications/config/templates';
				const res = await this.apiService.fetch(url, {
					method: isEdit ? 'PUT' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				const json = await res.json().catch(() => ({}));
				if (res.ok && json?.success !== false) {
					this.notificationService.notify({ severity: Severity.Info, message: isEdit ? 'Template updated.' : 'Template created.' });
					this.editingTemplate = null;
					this.editingTemplateActive = false;
					this._loadTab();
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Failed to save template.' });
				}
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${String(err)}` });
			} finally {
				saveBtn.disabled = false;
			}
		});
	}

	// allow-any-unicode-next-line
	// ─── Tab 3: Event Preferences ───
	private _renderEventPreferences(): void {
		const card = DOM.append(this.contentEl, DOM.$('div'));
		card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		// Header
		const hdrRow = DOM.append(card, DOM.$('div'));
		hdrRow.style.cssText = 'display:grid;grid-template-columns:1.5fr 80px 80px 140px 140px;gap:8px;padding:10px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);text-transform:uppercase;';
		for (const h of ['Event', 'Email', 'SMS', 'Timing', 'Template']) { DOM.append(hdrRow, DOM.$('span')).textContent = h; }

		const prefMap = new Map<string, Record<string, unknown>>();
		for (const p of this.preferences) { prefMap.set(String(p.eventType), p); }
		const inputs: Array<{ eventType: string; emailCb: HTMLInputElement; smsCb: HTMLInputElement; timingSel: HTMLSelectElement; templateSel: HTMLSelectElement }> = [];

		for (const evt of EVENT_TYPES) {
			const pref = prefMap.get(evt.key) || {};
			const row = DOM.append(card, DOM.$('div'));
			row.style.cssText = 'display:grid;grid-template-columns:1.5fr 80px 80px 140px 140px;gap:8px;padding:8px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;';

			const evtCol = DOM.append(row, DOM.$('div'));
			DOM.append(evtCol, DOM.$('div')).textContent = evt.label;
			(evtCol.lastChild as HTMLElement).style.cssText = 'font-weight:500;';
			DOM.append(evtCol, DOM.$('div')).textContent = evt.desc;
			(evtCol.lastChild as HTMLElement).style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			const emailCb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			emailCb.type = 'checkbox';
			emailCb.checked = !!pref.emailEnabled;

			const smsCb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			smsCb.type = 'checkbox';
			smsCb.checked = !!pref.smsEnabled;

			const timingSel = DOM.append(row, DOM.$('select')) as HTMLSelectElement;
			timingSel.style.cssText = 'padding:4px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:11px;';
			for (const t of TIMING_OPTIONS) {
				const opt = DOM.append(timingSel, DOM.$('option')) as HTMLOptionElement;
				opt.value = t.value; opt.textContent = t.label;
				if (pref.timing === t.value) { opt.selected = true; }
			}

			const templateSel = DOM.append(row, DOM.$('select')) as HTMLSelectElement;
			templateSel.style.cssText = timingSel.style.cssText;
			(DOM.append(templateSel, DOM.$('option')) as HTMLOptionElement).textContent = '-- Default --';
			for (const tmpl of this.templates) {
				const opt = DOM.append(templateSel, DOM.$('option')) as HTMLOptionElement;
				opt.value = String(tmpl.id); opt.textContent = String(tmpl.name);
				if (pref.templateId && String(pref.templateId) === String(tmpl.id)) { opt.selected = true; }
			}

			inputs.push({ eventType: evt.key, emailCb, smsCb, timingSel, templateSel });
		}

		// Save All button
		const footer = DOM.append(this.contentEl, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px;';
		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Save All';
		saveBtn.style.cssText = btnPrimary;
		saveBtn.addEventListener('click', async () => {
			const prefs = inputs.map(i => ({
				eventType: i.eventType,
				emailEnabled: i.emailCb.checked,
				smsEnabled: i.smsCb.checked,
				timing: i.timingSel.value,
				templateId: i.templateSel.value || null,
			}));
			saveBtn.disabled = true;
			try {
				const res = await this.apiService.fetch('/api/notifications/config/preferences', {
					method: 'PUT', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(prefs),
				});
				const json = await res.json().catch(() => ({}));
				if (res.ok && json?.success !== false) {
					this.notificationService.notify({ severity: Severity.Info, message: 'Event preferences saved.' });
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Failed to save preferences.' });
				}
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${String(err)}` });
			} finally {
				saveBtn.disabled = false;
				this._loadTab();
			}
		});
	}

	// allow-any-unicode-next-line
	// ─── Tab 4: Configuration ───
	private _renderConfiguration(): void {
		const grid = DOM.append(this.contentEl, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;';

		this._renderProviderConfig(grid, 'Email Configuration', 'email', this.emailConfig, [{ label: 'SMTP', value: 'smtp' }, { label: 'SendGrid', value: 'sendgrid' }, { label: 'Mailgun', value: 'mailgun' }]);
		this._renderProviderConfig(grid, 'SMS Configuration', 'sms', this.smsConfig, [{ label: 'Twilio', value: 'twilio' }, { label: 'Vonage', value: 'vonage' }]);
	}

	private _renderProviderConfig(parent: HTMLElement, title: string, channel: string, config: Record<string, unknown>, providers: Array<{ label: string; value: string }>): void {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:16px;';

		// Header row with title + enabled toggle
		const hdrRow = DOM.append(card, DOM.$('div'));
		hdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
		const h = DOM.append(hdrRow, DOM.$('h3'));
		h.textContent = title;
		h.style.cssText = 'margin:0;font-size:14px;font-weight:600;';

		const enabledWrap = DOM.append(hdrRow, DOM.$('label'));
		enabledWrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;';
		const enabledCb = DOM.append(enabledWrap, DOM.$('input')) as HTMLInputElement;
		enabledCb.type = 'checkbox';
		enabledCb.checked = config.enabled !== false;
		const enabledLbl = DOM.append(enabledWrap, DOM.$('span'));
		enabledLbl.textContent = 'Enabled';

		// Daily usage badge (read-only)
		if (config.sentToday !== undefined || config.dailyLimit) {
			const usage = DOM.append(card, DOM.$('div'));
			const sentToday = Number(config.sentToday || 0);
			const limit = Number(config.dailyLimit || 0);
			const pct = limit > 0 ? Math.min(100, Math.round((sentToday / limit) * 100)) : 0;
			const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
			usage.style.cssText = `font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:10px;padding:6px 10px;background:rgba(128,128,128,0.08);border-radius:4px;border-left:3px solid ${color};`;
			usage.textContent = `Today: ${sentToday}${limit ? ` / ${limit}` : ''} sent${config.lastResetDate ? ` · last reset ${config.lastResetDate}` : ''}`;
		}

		const existingConfig: Record<string, unknown> = typeof config.config === 'string'
			? JSON.parse((config.config as string) || '{}')
			: ((config.config as Record<string, unknown>) || {});
		const currentProvider = String(config.provider || providers[0].value);

		const provSel = this._addSelect(card, 'Provider', providers);
		provSel.value = currentProvider;

		const fieldsContainer = DOM.append(card, DOM.$('div'));
		fieldsContainer.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;';

		const fieldInputs = new Map<string, HTMLInputElement>();
		let useTlsCb: HTMLInputElement | undefined;

		const renderFields = () => {
			DOM.clearNode(fieldsContainer);
			fieldInputs.clear();
			useTlsCb = undefined;
			const fields = PROVIDER_FIELDS[provSel.value] || [];
			for (const f of fields) {
				const inp = this._addInput(fieldsContainer, f.label, f.type || 'text', f.placeholder || '', String(existingConfig[f.key] ?? ''));
				fieldInputs.set(f.key, inp);
			}
			// SMTP gets an additional "Use TLS" checkbox stored under `use_tls`
			if (provSel.value === 'smtp') {
				const tlsWrap = DOM.append(fieldsContainer, DOM.$('label'));
				tlsWrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding-top:18px;';
				useTlsCb = DOM.append(tlsWrap, DOM.$('input')) as HTMLInputElement;
				useTlsCb.type = 'checkbox';
				// Default to true unless explicitly false
				useTlsCb.checked = existingConfig.use_tls !== false && existingConfig.use_tls !== 'false';
				const tlsLbl = DOM.append(tlsWrap, DOM.$('span'));
				tlsLbl.textContent = 'Use TLS/STARTTLS';
			}
		};
		renderFields();
		provSel.addEventListener('change', renderFields);

		// Sender fields
		const senderGrid = DOM.append(card, DOM.$('div'));
		senderGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 100px;gap:8px;margin-top:8px;';
		const senderName = this._addInput(senderGrid, 'Sender Name', 'text', '', String(config.senderName || ''));
		const senderAddr = this._addInput(senderGrid, 'Sender Address', 'text', channel === 'email' ? 'noreply@example.com' : '+1234567890', String(config.senderAddress || ''));
		const dailyLimit = this._addInput(senderGrid, 'Daily Limit', 'number', '500', String(config.dailyLimit || '500'));

		// Buttons
		const btns = DOM.append(card, DOM.$('div'));
		btns.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';

		const buildConfigPayload = (): Record<string, unknown> => {
			const cfgObj: Record<string, unknown> = {};
			for (const [k, inp] of fieldInputs) {
				const f = (PROVIDER_FIELDS[provSel.value] || []).find(p => p.key === k);
				cfgObj[k] = f?.type === 'number' ? Number(inp.value) : inp.value;
			}
			if (provSel.value === 'smtp' && useTlsCb) {
				cfgObj.use_tls = useTlsCb.checked;
			}
			return {
				provider: provSel.value,
				enabled: enabledCb.checked,
				config: JSON.stringify(cfgObj),
				senderName: senderName.value,
				senderAddress: senderAddr.value,
				dailyLimit: Number(dailyLimit.value),
			};
		};

		const testBtn = DOM.append(btns, DOM.$('button')) as HTMLButtonElement;
		testBtn.textContent = 'Test Connection';
		testBtn.style.cssText = btnSecondary;
		testBtn.addEventListener('click', async () => {
			testBtn.disabled = true;
			testBtn.textContent = 'Testing…';
			try {
				// Save first so the test uses the current form values
				await this.apiService.fetch(`/api/notifications/config/${channel}`, {
					method: 'PUT', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(buildConfigPayload()),
				});
				const res = await this.apiService.fetch(`/api/notifications/config/${channel}/test`, { method: 'POST' });
				const json = await res.json().catch(() => ({}));
				if (json?.success) {
					this.notificationService.notify({ severity: Severity.Info, message: json.message || `${channel.toUpperCase()} connection test passed.` });
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: json?.message || `${channel.toUpperCase()} connection test failed.` });
				}
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Error, message: `Test failed: ${String(err)}` });
			} finally {
				testBtn.disabled = false;
				testBtn.textContent = 'Test Connection';
			}
		});

		// Send Test Email (email channel only) - prompts for recipient & sends real test
		if (channel === 'email') {
			const sendTestBtn = DOM.append(btns, DOM.$('button')) as HTMLButtonElement;
			sendTestBtn.textContent = 'Send Test Email';
			sendTestBtn.style.cssText = btnSecondary;
			sendTestBtn.addEventListener('click', async () => {
				const to = await this.quickInputService.input({
					prompt: 'Recipient email for test message',
					value: String(existingConfig.from_email || senderAddr.value || ''),
					placeHolder: 'you@example.com',
				});
				if (!to) { return; }
				sendTestBtn.disabled = true;
				sendTestBtn.textContent = 'Sending…';
				try {
					await this.apiService.fetch(`/api/notifications/config/${channel}`, {
						method: 'PUT', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(buildConfigPayload()),
					});
					const res = await this.apiService.fetch(`/api/notifications/send-test`, {
						method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ channelType: channel, recipient: to, subject: 'Ciyex SMTP test', body: 'This is a test message from the Ciyex notifications configuration.' }),
					});
					const json = await res.json().catch(() => ({}));
					if (res.ok && json?.success !== false) {
						this.notificationService.notify({ severity: Severity.Info, message: `Test email sent to ${to}.` });
					} else {
						this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Failed to send test email.' });
					}
				} catch (err) {
					this.notificationService.notify({ severity: Severity.Error, message: `Send failed: ${String(err)}` });
				} finally {
					sendTestBtn.disabled = false;
					sendTestBtn.textContent = 'Send Test Email';
				}
			});
		}

		const saveBtn = DOM.append(btns, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Save Configuration';
		saveBtn.style.cssText = btnPrimary;
		saveBtn.addEventListener('click', async () => {
			saveBtn.disabled = true;
			try {
				const res = await this.apiService.fetch(`/api/notifications/config/${channel}`, {
					method: 'PUT', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(buildConfigPayload()),
				});
				const json = await res.json().catch(() => ({}));
				if (res.ok && json?.success !== false) {
					this.notificationService.notify({ severity: Severity.Info, message: `${title} saved.` });
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Failed to save configuration.' });
				}
			} catch (err) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${String(err)}` });
			} finally {
				saveBtn.disabled = false;
				this._loadTab();
			}
		});
	}

	// allow-any-unicode-next-line
	// ─── Helpers ───

	private _addInput(parent: HTMLElement, label: string, type: string, placeholder = '', value = ''): HTMLInputElement {
		const grp = DOM.append(parent, DOM.$('div'));
		const lbl = DOM.append(grp, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const inp = DOM.append(grp, DOM.$('input')) as HTMLInputElement;
		inp.type = type;
		inp.placeholder = placeholder;
		inp.value = value;
		inp.style.cssText = inputStyle;
		return inp;
	}

	private _addSelect(parent: HTMLElement, label: string, options: Array<{ label: string; value: string }>): HTMLSelectElement {
		const grp = DOM.append(parent, DOM.$('div'));
		const lbl = DOM.append(grp, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const sel = DOM.append(grp, DOM.$('select')) as HTMLSelectElement;
		sel.style.cssText = inputStyle;
		for (const o of options) { const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement; opt.value = o.value; opt.textContent = o.label; }
		return sel;
	}

	private _renderTable(parent: HTMLElement, items: Record<string, unknown>[], cols: Array<{ key: string; label: string; w?: string }>, actionRenderer?: (item: Record<string, unknown>) => HTMLElement, onRowClick?: (item: Record<string, unknown>) => void): void {
		const tbl = DOM.append(parent, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const colWidths = cols.map(c => c.w || '1fr').join(' ') + (actionRenderer ? ' auto' : '');

		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${colWidths};gap:8px;padding:8px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(0,122,204,0.05);text-transform:uppercase;`;
		for (const c of cols) { DOM.append(hr, DOM.$('span')).textContent = c.label; }
		if (actionRenderer) { DOM.append(hr, DOM.$('span')).textContent = 'Actions'; }

		if (items.length === 0) {
			const e = DOM.append(tbl, DOM.$('div'));
			e.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			e.textContent = 'No records found';
			return;
		}

		for (const item of items) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${colWidths};gap:8px;padding:6px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;transition:background 0.1s;${onRowClick ? 'cursor:pointer;' : ''}`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });
			if (onRowClick) { r.addEventListener('click', () => onRowClick(item)); }

			for (const c of cols) {
				const cell = DOM.append(r, DOM.$('span'));
				const v = String(item[c.key] ?? '');
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				if (c.key === 'status') {
					cell.textContent = v;
					const clr = STATUS_COLORS[v.toLowerCase()] || '#6b7280';
					cell.style.cssText += `color:${clr};font-weight:500;text-transform:capitalize;`;
				} else if (c.key === 'channelType') {
					cell.textContent = v.toUpperCase();
				} else if (c.key === 'sentAt' || c.key === 'createdAt') {
					try { cell.textContent = v ? new Date(v).toLocaleString() : ''; } catch { cell.textContent = v; }
				} else if (c.key === 'isActive') {
					// allow-any-unicode-next-line
					cell.textContent = item[c.key] ? '✓' : '✗';
					cell.style.cssText += `color:${item[c.key] ? '#22c55e' : '#6b7280'};`;
				} else {
					cell.textContent = v;
				}
			}

			if (actionRenderer) {
				const actEl = actionRenderer(item);
				r.appendChild(actEl);
			}
		}
	}

	private _renderPagination(parent: HTMLElement, page: number, hasMore: boolean, onPrev: () => void, onNext: () => void): void {
		const pg = DOM.append(parent, DOM.$('div'));
		pg.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:12px;align-items:center;';
		if (page > 0) {
			const prev = DOM.append(pg, DOM.$('button'));
			prev.textContent = 'Previous';
			prev.style.cssText = btnSecondary;
			prev.addEventListener('click', onPrev);
		}
		const info = DOM.append(pg, DOM.$('span'));
		info.textContent = `Page ${page + 1}`;
		info.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		if (hasMore) {
			const next = DOM.append(pg, DOM.$('button'));
			next.textContent = 'Next';
			next.style.cssText = btnSecondary;
			next.addEventListener('click', onNext);
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
