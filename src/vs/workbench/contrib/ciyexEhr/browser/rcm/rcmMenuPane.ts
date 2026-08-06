/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createActionIconButton, createOverflowMenuButton, createRowActionsContainer, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE } from '../sidebarActions.js';
import { ICiyexRcmApiService } from './rcmApiService.js';

type DataRow = Record<string, unknown> & { id?: string };

/** One `{severity, field, code, message}` entry from a validate/scrub result. */
interface RcmIssue { severity?: string; field?: string; message?: string }

/** What an action actually did, as opposed to whether the request was accepted. */
interface RcmActionOutcome {
	/** True only when the claim really advanced (valid / clean / submitted). */
	ok: boolean;
	/** Human summary shown either way — the reasons when `ok` is false. */
	detail: string;
}

interface RcmMethodAction {
	symbol: string;
	label: string;
	method: 'POST' | 'PUT';
	path: (r: DataRow) => string;
	/**
	 * Read the real outcome out of the response body. The RCM lifecycle
	 * endpoints answer HTTP 200 for "I ran your request" and report whether it
	 * worked in the payload — a rejected submission comes back
	 * `200 {"success":false,"message":"Claim submission failed"}`. Without this,
	 * `res.ok` alone reports every failure as a success.
	 */
	outcome: (data: Record<string, unknown>) => RcmActionOutcome;
}

/** "3 errors: Place of service is required; Billing provider NPI is required; +1 more." */
function summarizeIssues(raw: unknown, noun: string): string {
	const issues = (Array.isArray(raw) ? raw : []) as RcmIssue[];
	const blocking = issues.filter(i => !i.severity || /error/i.test(i.severity));
	const shown = (blocking.length ? blocking : issues).slice(0, 2)
		.map(i => i.message || i.field || '').filter(Boolean);
	const total = blocking.length || issues.length;
	if (!total) { return `no ${noun} reported`; }
	const more = total - shown.length;
	return `${total} ${noun}${total === 1 ? '' : 's'}: ${shown.join('; ')}${more > 0 ? `; +${more} more` : ''}`;
}

/**
 * Work-queue task types and priorities arrive as raw enum names. The RCM web app
 * shows them as prose, so mirror it here rather than making a biller read
 * CLAIM_FOLLOW_UP in one product and "Claim Follow-up" in the other. Unknown
 * values fall back to a de-underscored, title-cased form so a new task type
 * added server-side still reads sensibly.
 */
const TASK_LABELS: Record<string, string> = {
	CLAIM_FOLLOW_UP: 'Claim Follow-up',
	DENIAL_FOLLOW_UP: 'Denial Follow-up',
	PAYMENT_POSTING: 'Payment Posting',
	ELIGIBILITY_CHECK: 'Eligibility Check',
	PRIOR_AUTH: 'Prior Auth',
	CODING_REVIEW: 'Coding Review',
	PATIENT_BILLING: 'Patient Billing',
	PATIENT_STATEMENT: 'Patient Statement',
	CLAIM_REVIEW: 'Claim Review',
	CLAIM_STATUS_CHECK: 'Claim Status Check',
	APPEAL_DEADLINE: 'Appeal Deadline',
	AR_FOLLOW_UP: 'A/R Follow-up',
	SECONDARY_BILLING: 'Secondary Billing',
	CREDENTIAL_RENEWAL: 'Credential Renewal',
	CREDIT_BALANCE_REVIEW: 'Credit Balance Review',
	BANK_RECONCILIATION: 'Bank Reconciliation',
	NCCI_OVERRIDE: 'NCCI Override',
	AI_REVIEW: 'AI Review',
	APPEAL: 'Appeal',
};

function humanizeEnum(value: string): string {
	const known = TASK_LABELS[value];
	if (known) { return known; }
	if (!/^[A-Z][A-Z0-9_]*$/.test(value)) { return value; }
	return value.toLowerCase().split('_')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

interface RcmItem {
	id: string;
	icon: string;
	label: string;
	short?: string;
	description: string;
	color: string;
	/**
	 * RCM list endpoint (relative `/api/rcm/...`); empty for command-only rows.
	 * Every paged list sorts newest-first: these sections show only the first
	 * page, so without a sort the claim a biller just created is buried among
	 * hundreds of older ones and looks like it was never created at all.
	 */
	apiPath: string;
	titleField: string[];
	subtitleField?: string[];
	/** Row overflow actions POSTing back to the RCM service. */
	actions?: RcmMethodAction[];
	/** Command executed on row/section click (rows pass id + label args). */
	command?: string;
	/** Fields used as (claimId, label) args when a data row is clicked. */
	rowArgs?: (r: DataRow) => unknown[];
	/** Button on the section header, for work that creates rows rather than acting on one. */
	sectionAction?: { symbol: string; label: string; run: (pane: RcmMenuPane) => Promise<void> };
	commandOnly?: boolean;
}

// allow-any-unicode-next-line
const ITEMS: RcmItem[] = [
	{
		id: 'dashboard',
		// allow-any-unicode-next-line
		icon: '\u{1F4CA}',
		label: 'Dashboard',
		short: 'Dash',
		description: 'KPIs, A/R aging, payer mix',
		color: '#3b82f6',
		apiPath: '',
		titleField: [],
		command: 'ciyex.rcm.openDashboard',
		commandOnly: true,
	},
	{
		id: 'work-queue',
		// allow-any-unicode-next-line
		icon: '\u{1F4E5}',
		label: 'Work Queue',
		short: 'Queue',
		// allow-any-unicode-next-line
		description: 'Denials, follow-ups, today’s fixes',
		color: '#f59e0b',
		apiPath: '/api/rcm/work-queue?page=0&size=10&sort=createdAt,desc',
		titleField: ['patientName', 'claimNumber', 'description'],
		subtitleField: ['claimNumber', 'taskType', 'priority'],
		command: 'ciyex.rcm.openClaim',
		rowArgs: r => [r.claimId, r.claimNumber],
	},
	{
		id: 'claims',
		// allow-any-unicode-next-line
		icon: '\u{1F4CB}',
		label: 'Claims',
		short: 'Claims',
		description: 'Validate, scrub, submit, track',
		color: '#06b6d4',
		apiPath: '/api/rcm/claims?page=0&size=10&sort=createdAt,desc',
		titleField: ['claimNumber', 'patientName'],
		subtitleField: ['patientName', 'payerName', 'totalCharges'],
		command: 'ciyex.rcm.openClaim',
		rowArgs: r => [r.id, r.claimNumber],
		actions: [
			{
				// allow-any-unicode-next-line
				symbol: '\u{2714}', label: 'Validate', method: 'POST', path: r => `/api/rcm/claims/${r.id}/validate`,
				// `valid !== false` rather than `=== true`: matches the claim editor,
				// so both surfaces agree on a payload that omits the flag.
				outcome: d => d.valid !== false
					? { ok: true, detail: 'claim is valid — ready to scrub' }
					: { ok: false, detail: summarizeIssues(d.errors, 'error') },
			},
			{
				// allow-any-unicode-next-line
				symbol: '\u{1F9F9}', label: 'Scrub', method: 'POST', path: r => `/api/rcm/claims/${r.id}/scrub`,
				outcome: d => {
					const score = d.score === undefined || d.score === null ? '' : ` (score ${d.score}/100)`;
					return d.passedScrub !== false
						? { ok: true, detail: `clean claim${score} — ready to submit` }
						: { ok: false, detail: `${summarizeIssues(d.issues, 'issue')}${score}` };
				},
			},
			{
				// allow-any-unicode-next-line
				symbol: '\u{1F4E4}', label: 'Submit', method: 'POST', path: r => `/api/rcm/claims/${r.id}/submit`,
				// Submission is the one action that must prove it happened: a claim
				// that never reached the payer must never read as submitted.
				outcome: d => d.submitted
					? { ok: true, detail: `submitted via ${d.submissionMethod || 'EDI'}` }
					: { ok: false, detail: String(d.errorMessage || 'the payer did not accept it') },
			},
		],
	},
	{
		id: 'denials',
		// allow-any-unicode-next-line
		icon: '\u{26D4}',
		label: 'Denials',
		short: 'Denials',
		description: 'Denied claims to work',
		color: '#ef4444',
		apiPath: '/api/rcm/claims?status=DENIED&page=0&size=10&sort=createdAt,desc',
		titleField: ['claimNumber', 'patientName'],
		subtitleField: ['payerName', 'denialDate'],
		command: 'ciyex.rcm.openClaim',
		rowArgs: r => [r.id, r.claimNumber],
	},
	{
		id: 'era',
		// allow-any-unicode-next-line
		icon: '\u{1F4B5}',
		label: 'Insurance Payments',
		short: 'ERA',
		description: 'ERA / payment batches',
		color: '#22c55e',
		apiPath: '/api/rcm/payments/batches?page=0&size=10&sort=createdAt,desc',
		// Lead with the claim the money is against, not the batch number: a biller
		// looking at Insurance Payments wants to know which claim was paid. The
		// claim and patient live on the batch's lines, hence the dotted paths.
		titleField: ['lines.0.claimNumber', 'batchNumber', 'id'],
		// `totalAmount` does not exist on a batch — the field is `checkAmount`, so
		// the amount never rendered and the row showed only a status, which the
		// badge was already displaying beside it.
		subtitleField: ['lines.0.patientName', 'payerName', 'checkAmount'],
		// A remittance opens for review rather than posting on the spot: it credits
		// claims, changes what the front desk asks the patient for and can send a
		// statement, none of which is comfortably undone.
		command: 'ciyex.rcm.openRemittance',
		rowArgs: r => [r.id, r.checkNumber || r.batchNumber],
	},
	{
		id: 'statements',
		// allow-any-unicode-next-line
		icon: '\u{2709}',
		label: 'Statements',
		short: 'Stmts',
		description: 'Patient statement batches',
		color: '#a855f7',
		apiPath: '/api/rcm/statements/batches?page=0&size=10&sort=createdAt,desc',
		titleField: ['batchNumber', 'name', 'id'],
		// `status` is dropped: the badge to the right of every row already shows it,
		// so naming it here printed it twice.
		subtitleField: ['totalStatements', 'generatedDate'],
		// Nothing in the workspace could produce a statement, so this section was
		// permanently empty and patients with a balance were never billed for it.
		// Generate builds the batch, fills it with the outstanding balances and
		// renders each statement; sending remains a separate, deliberate step.
		sectionAction: {
			// allow-any-unicode-next-line
			symbol: '\u{2795}', label: 'Generate statements for outstanding balances',
			run: pane => pane.generateStatements(),
		},
	},
];

/**
 * "Billing (RCM)" sidebar — the biller's home inside the EHR. Only visible
 * when the org's ciyex-rcm marketplace app is installed (view `when` clause
 * on `ciyex.rcmInstalled`). Mirrors the Operations pane interaction model:
 * quick-action bar, expandable sections with live counts, row actions.
 * All data flows through ICiyexRcmApiService (app-proxy → RCM service).
 */
export class RcmMenuPane extends ViewPane {
	static readonly ID = 'ciyex.rcm.menu';
	private container!: HTMLElement;
	private collapsed = new Set<string>();
	private counts = new Map<string, number>();
	private data = new Map<string, DataRow[]>();
	private loading = new Set<string>();
	private visibleCounts = new Map<string, number>();

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService k: IKeybindingService,
		@IContextMenuService cm: IContextMenuService,
		@IConfigurationService c: IConfigurationService,
		@IContextKeyService ck: IContextKeyService,
		@IViewDescriptorService v: IViewDescriptorService,
		@IInstantiationService i: IInstantiationService,
		@IOpenerService o: IOpenerService,
		@IThemeService t: IThemeService,
		@IHoverService h: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@ICiyexRcmApiService private readonly rcmApi: ICiyexRcmApiService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, k, cm, c, ck, v, i, o, t, h);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.rcm-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;overflow-x:hidden;font-size:12px;scrollbar-width:none;-ms-overflow-style:none;';
		this._render();

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try { if (!localStorage.getItem('ciyex_token')) { return; } } catch { return; }
			win.clearInterval(poll);
			this._loadAllData();
		}, 2000);
	}

	private async _loadAllData(): Promise<void> {
		await Promise.all(ITEMS.filter(item => !item.commandOnly).map(item => this._loadItemData(item)));
	}

	/**
	 * Build a statement run for every patient carrying a balance, and render each one.
	 *
	 * Two calls, because RCM separates them: `generate-batch` creates the run and
	 * decides who is in it, `populate` works out the lines and renders the statement.
	 * A batch without the second step exists but has nothing in it, which is worse
	 * than no batch at all — it reads as "statements were produced" when none were.
	 *
	 * Sending is deliberately NOT done here. Posting or emailing a patient is not
	 * something a biller should trigger by clicking a plus sign.
	 */
	async generateStatements(): Promise<void> {
		const section = ITEMS.find(i => i.id === 'statements')!;
		try {
			const created = await this.rcmApi.fetchJson<{ data?: { id?: string; batchNumber?: string } }>(
				'/api/rcm/statements/generate-batch', { method: 'POST' });
			const batch = created?.data;
			if (!batch?.id) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'No statement batch was created.' });
				return;
			}

			const filled = await this.rcmApi.fetchJson<{ data?: { totalStatements?: number } }>(
				`/api/rcm/statements/batches/${encodeURIComponent(batch.id)}/populate`, { method: 'POST' });
			// `totalStatements` is what a batch actually carries — `statementCount`
			// does not exist on it and would have read as zero every time.
			const count = filled?.data?.totalStatements ?? 0;

			await this._loadItemData(section);

			if (count === 0) {
				this.notificationService.notify({
					severity: Severity.Info,
					message: `Batch ${batch.batchNumber || ''} created, but no patient currently has a balance to bill.`,
				});
				return;
			}
			this.notificationService.notify({
				severity: Severity.Info,
				message: `${count} statement${count === 1 ? '' : 's'} ready in batch ${batch.batchNumber || ''}. Review them before sending.`,
			});
		} catch (err) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: `Could not generate statements: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	private async _loadItemData(item: RcmItem): Promise<void> {
		if (this.loading.has(item.id)) { return; }
		this.loading.add(item.id);
		try {
			const res = await this.rcmApi.fetch(item.apiPath);
			if (res.ok) {
				const payload = await res.json();
				const rows = this.rcmApi.listOf(payload) as DataRow[];
				this.data.set(item.id, rows);
				const p = payload as { data?: { totalElements?: number }; totalElements?: number };
				this.counts.set(item.id, p?.data?.totalElements ?? p?.totalElements ?? rows.length);
			}
		} catch { /* RCM unreachable — section shows as empty */ }
		this.loading.delete(item.id);
		this._render();
	}

	private _render(): void {
		DOM.clearNode(this.container);
		this._renderHeader();
		this._renderQuickActions();
		for (const item of ITEMS) { this._renderItem(item); }
	}

	private _renderHeader(): void {
		const header = DOM.append(this.container, DOM.$('.menu-header'));
		header.style.cssText = 'padding:6px 10px;display:flex;align-items:center;justify-content:flex-end;gap:6px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		createActionIconButton(header, '\u{21BB}', 'Refresh', () => this._loadAllData());
		createActionIconButton(header, '\u{21D5}', 'Collapse / Expand All', () => {
			if (this.collapsed.size === ITEMS.length) { this.collapsed.clear(); }
			else { ITEMS.forEach(i => this.collapsed.add(i.id)); }
			this._render();
		});
	}

	private _renderQuickActions(): void {
		const bar = DOM.append(this.container, DOM.$('.quick-actions'));
		bar.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		for (const item of ITEMS) {
			if (!item.command && !item.commandOnly) { continue; }
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.title = `Quick: ${item.label}`;
			btn.style.cssText = `padding:4px 6px;border:none;border-radius:3px;background:${item.color};color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;overflow:hidden;`;
			DOM.append(btn, DOM.$('span')).textContent = item.icon;
			const lbl = DOM.append(btn, DOM.$('span'));
			lbl.textContent = item.short || item.label;
			lbl.style.cssText = 'font-weight:600;';
			btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
			btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				// Section quick buttons without their own editor land on the dashboard.
				this.commandService.executeCommand(item.commandOnly ? item.command! : 'ciyex.rcm.openDashboard');
			});
		}
	}

	private _renderItem(item: RcmItem): void {
		const isCollapsed = this.collapsed.has(item.id);
		const row = DOM.append(this.container, DOM.$('.rcm-row'));
		row.style.cssText = `padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);border-left:3px solid ${item.color};`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });
		row.addEventListener('click', () => this.commandService.executeCommand(item.commandOnly && item.command ? item.command : 'ciyex.rcm.openDashboard'));

		const icon = DOM.append(row, DOM.$('span'));
		icon.textContent = item.icon;
		icon.style.cssText = `font-size:16px;width:24px;text-align:center;flex-shrink:0;color:${item.color};`;

		const col = DOM.append(row, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;';
		const labelRow = DOM.append(col, DOM.$('div'));
		labelRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const label = DOM.append(labelRow, DOM.$('span'));
		label.textContent = item.label;
		label.style.cssText = 'font-weight:500;font-size:12px;';
		const count = this.counts.get(item.id);
		if (typeof count === 'number') {
			const badge = DOM.append(labelRow, DOM.$('span'));
			badge.textContent = String(count);
			badge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:8px;background:${item.color};color:#fff;font-weight:600;`;
		}
		const desc = DOM.append(col, DOM.$('div'));
		desc.textContent = item.description;
		desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		if (item.commandOnly) { return; }

		const actionsEl = createRowActionsContainer(row);
		if (item.sectionAction) {
			const act = item.sectionAction;
			createActionIconButton(actionsEl, act.symbol, act.label, () => void act.run(this));
		}
		createActionIconButton(actionsEl, '\u{21BB}', `Reload ${item.label}`, () => this._loadItemData(item));
		createActionIconButton(actionsEl, isCollapsed ? '\u{203A}' : '\u{2304}', isCollapsed ? 'Expand' : 'Collapse', () => {
			if (isCollapsed) {
				this.collapsed.delete(item.id);
				if (!this.data.has(item.id)) { this._loadItemData(item); }
			} else { this.collapsed.add(item.id); }
			this._render();
		});

		if (!isCollapsed) { this._renderDataRows(item); }
	}

	private _renderDataRows(item: RcmItem): void {
		const sub = DOM.append(this.container, DOM.$('.sub-items'));
		sub.style.cssText = 'padding:4px 0;border-bottom:1px solid rgba(128,128,128,0.06);background:rgba(128,128,128,0.03);';
		const rows = this.data.get(item.id);
		if (!rows) {
			const loading = DOM.append(sub, DOM.$('div'));
			loading.style.cssText = 'padding:8px 10px 8px 38px;color:var(--vscode-descriptionForeground);font-size:11px;';
			loading.textContent = 'Loading...';
			return;
		}
		if (rows.length === 0) {
			const empty = DOM.append(sub, DOM.$('div'));
			empty.style.cssText = 'padding:8px 10px 8px 38px;color:var(--vscode-descriptionForeground);font-size:11px;';
			empty.textContent = `No ${item.label.toLowerCase()} yet`;
			return;
		}
		const visible = Math.min(this.visibleCounts.get(item.id) ?? SIDEBAR_INITIAL_PAGE_SIZE, rows.length);
		for (let i = 0; i < visible; i++) { this._renderDataRow(sub, item, rows[i]); }
		renderShowMoreFooter(
			sub,
			{ visibleCount: visible, totalCount: rows.length, noun: item.label.toLowerCase() },
			(next) => { this.visibleCounts.set(item.id, next); this._render(); },
			() => { this.visibleCounts.set(item.id, SIDEBAR_INITIAL_PAGE_SIZE); this._render(); },
		);
	}

	/**
	 * First non-empty of the named fields. Names may be dotted paths so a row can
	 * show something from a nested record — a payment batch keeps the claim number
	 * and patient on its lines, and without this the biller saw a batch number and
	 * a status and no way to tell which claim had been paid.
	 */
	private _getField(row: DataRow, fields: string[]): string {
		for (const f of fields) {
			const v = f.includes('.')
				? f.split('.').reduce<unknown>((acc, key) => {
					if (acc === null || acc === undefined) { return undefined; }
					return (acc as Record<string, unknown>)[key];
				}, row)
				: row[f];
			if (v !== undefined && v !== null && String(v).trim() !== '') { return String(v); }
		}
		return '';
	}

	private _renderDataRow(parent: HTMLElement, item: RcmItem, row: DataRow): void {
		const dataRow = DOM.append(parent, DOM.$('.data-row'));
		dataRow.style.cssText = `padding:6px 10px 6px 38px;display:flex;align-items:center;gap:6px;border-left:2px solid ${item.color}44;cursor:pointer;`;
		dataRow.addEventListener('mouseenter', () => { dataRow.style.background = 'var(--vscode-list-hoverBackground)'; });
		dataRow.addEventListener('mouseleave', () => { dataRow.style.background = ''; });
		dataRow.addEventListener('click', () => {
			if (item.command && item.rowArgs) {
				const args = item.rowArgs(row).map(a => a === undefined || a === null ? undefined : String(a));
				if (args[0]) {
					this.commandService.executeCommand(item.command, ...args);
					return;
				}
			}
			this.commandService.executeCommand('ciyex.rcm.openDashboard');
		});

		const col = DOM.append(dataRow, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;overflow:hidden;';
		const title = DOM.append(col, DOM.$('div'));
		title.textContent = this._getField(row, item.titleField) || '(no title)';
		title.style.cssText = 'font-size:11px;font-weight:500;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		if (item.subtitleField) {
			const sub = DOM.append(col, DOM.$('div'));
			sub.textContent = item.subtitleField.map(f => humanizeEnum(this._getField(row, [f]))).filter(Boolean).join(' \u{00B7} ');
			sub.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		}

		const status = String(row.claimStatus || row.status || '').toLowerCase();
		if (status) {
			const badge = DOM.append(dataRow, DOM.$('span'));
			badge.textContent = status;
			const statusColor = status.includes('paid') || status.includes('accepted') || status.includes('posted') || status.includes('completed') ? '#22c55e'
				: status.includes('denied') || status.includes('rejected') || status.includes('void') ? '#ef4444'
					: status.includes('submitted') || status.includes('pending') ? '#f59e0b' : '#6b7280';
			badge.style.cssText = `font-size:8px;padding:1px 5px;border-radius:3px;background:${statusColor};color:#fff;font-weight:600;text-transform:capitalize;flex-shrink:0;`;
		}

		if (item.actions && item.actions.length > 0) {
			const actions = createRowActionsContainer(dataRow);
			createOverflowMenuButton(actions, () => item.actions!.map(a => ({
				symbol: a.symbol,
				label: a.label,
				onClick: () => this._executeAction(item, row, a),
			})));
		}
	}

	private async _executeAction(item: RcmItem, row: DataRow, a: RcmMethodAction): Promise<void> {
		const claimLabel = this._getField(row, item.titleField) || 'claim';
		try {
			const res = await this.rcmApi.fetch(a.path(row), { method: a.method });
			const payload = await res.json().catch(() => null) as { message?: string; success?: boolean; data?: Record<string, unknown> } | null;
			if (!res.ok) {
				this.notificationService.notify({ severity: Severity.Error, message: payload?.message || `${a.label} failed (${res.status}).` });
			} else {
				// A `success: false` envelope means the service ran the request and it
				// did not work — the payload never gets far enough to be read.
				const outcome: RcmActionOutcome = payload?.success === false
					? { ok: false, detail: payload.message || 'the service rejected it' }
					: a.outcome(payload?.data ?? {});
				this.notificationService.notify(outcome.ok
					? { severity: Severity.Info, message: `${a.label} — ${claimLabel}: ${outcome.detail}.` }
					: {
						severity: Severity.Error,
						message: `${a.label} did not go through for ${claimLabel} — ${outcome.detail}. The claim has not moved on.`,
						actions: row.id ? {
							primary: [{
								id: 'ciyex.rcm.openFailedClaim', label: 'Open Claim', tooltip: '', class: undefined, enabled: true,
								run: () => this.commandService.executeCommand('ciyex.rcm.openClaim', String(row.id), claimLabel),
							}],
						} : undefined,
					});
			}
		} catch {
			this.notificationService.notify({ severity: Severity.Error, message: `${a.label} failed. Please try again.` });
		}
		void this._loadItemData(item);
	}

	protected override layoutBody(h: number, w: number): void { super.layoutBody(h, w); }
}
