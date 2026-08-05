/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { RcmClaimEditorInput } from './ciyexEditorInput.js';
import { ICiyexRcmApiService } from '../rcm/rcmApiService.js';
import { showThemedModal, IThemedModalField } from './clinicalListEditor.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface RcmValidationIssue { severity?: string; field?: string; code?: string; message?: string; lineNumber?: number }
interface RcmClaimLine { lineNumber?: number; cptCode?: string; modifier1?: string; modifier2?: string; description?: string; diagnosisPointers?: string; units?: number; chargeAmount?: number; paidAmount?: number; denialCode?: string }
interface RcmClaim {
	id?: string; claimNumber?: string; patientId?: string; patientName?: string; providerName?: string; providerNpi?: string;
	payerName?: string; subscriberId?: string; claimType?: string; placeOfService?: string; dateOfService?: string;
	totalCharges?: number; totalPaid?: number; patientResponsibility?: number; balance?: number;
	claimStatus?: string; billingStatus?: string; scrubScore?: number; submissionCount?: number;
	submittedDate?: string; paidDate?: string; denialDate?: string; lines?: RcmClaimLine[];
}

const STATUS_COLORS: Record<string, string> = {
	DRAFT: '#6b7280', VALIDATED: '#3b82f6', SCRUBBED: '#06b6d4', READY: '#0ea5e9',
	SUBMITTED: '#f59e0b', ACCEPTED: '#22c55e', PAID: '#16a34a', DENIED: '#ef4444', REJECTED: '#ef4444',
};

/**
 * RCM claim workup editor — the biller's claim screen: header + service lines
 * + the claim-lifecycle actions (Validate → Scrub → Submit → Refresh Status)
 * against the ciyex-rcm `/api/rcm/claims/{id}/…` endpoints through the
 * app-proxy. Validation/scrub issues render in an issues panel so the biller
 * can fix-and-retry before submitting to the clearinghouse.
 */
export class RcmClaimEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexRcmClaim';

	private root!: HTMLElement;
	private headerBar!: HTMLElement;
	private scrollArea!: HTMLElement;
	private issuesHost!: HTMLElement;
	private footerBar!: HTMLElement;

	private claimId = '';
	private claim: RcmClaim | null = null;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexRcmApiService private readonly rcmApi: ICiyexRcmApiService,
	) {
		super(RcmClaimEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-rcm-claim.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		this.headerBar = DOM.append(this.root, DOM.$('div'));
		this.headerBar.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		this.scrollArea = DOM.append(this.root, DOM.$('div'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px;';

		this.footerBar = DOM.append(this.root, DOM.$('div'));
		this.footerBar.style.cssText = 'padding:10px 16px;border-top:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;gap:8px;align-items:center;';
	}

	override async setInput(input: RcmClaimEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.claimId = input.claimId;
		this.claim = null;
		await this._loadClaim();
		if (token.isCancellationRequested) { return; }
		this._renderAll();
	}

	private async _loadClaim(): Promise<void> {
		try {
			const json = await this.rcmApi.fetchJson<{ data?: RcmClaim }>(`/api/rcm/claims/${encodeURIComponent(this.claimId)}`);
			this.claim = (json?.data ?? json) as RcmClaim;
		} catch {
			this.claim = null;
		}
	}

	private _renderAll(): void {
		this._renderHeader();
		this._renderBody();
		this._renderFooter();
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		const c = this.claim;
		const titleRow = DOM.append(this.headerBar, DOM.$('div'));
		titleRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
		const title = DOM.append(titleRow, DOM.$('span'));
		title.style.cssText = 'font-size:15px;font-weight:600;';
		title.textContent = c ? `Claim ${c.claimNumber || this.claimId} — ${c.patientName || 'Unknown patient'}` : 'Claim not found';
		if (c?.claimStatus) {
			const badge = DOM.append(titleRow, DOM.$('span'));
			badge.textContent = String(c.claimStatus);
			badge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:9px;background:${STATUS_COLORS[String(c.claimStatus).toUpperCase()] || '#6b7280'};color:#fff;font-weight:600;`;
		}
		if (c?.billingStatus) {
			const bs = DOM.append(titleRow, DOM.$('span'));
			bs.textContent = `Billing: ${c.billingStatus}`;
			bs.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
		}
		if (typeof c?.scrubScore === 'number') {
			const ss = DOM.append(titleRow, DOM.$('span'));
			ss.textContent = `Scrub score: ${c.scrubScore}/100`;
			ss.style.cssText = `font-size:10px;font-weight:600;color:${c.scrubScore >= 90 ? '#22c55e' : c.scrubScore >= 70 ? '#f59e0b' : '#ef4444'};`;
		}
	}

	private _infoCell(parent: HTMLElement, label: string, value: string): void {
		const cell = DOM.append(parent, DOM.$('div'));
		const l = DOM.append(cell, DOM.$('div'));
		l.textContent = label;
		l.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:2px;';
		const v = DOM.append(cell, DOM.$('div'));
		v.textContent = value || '—';
		v.style.cssText = 'font-size:12px;font-weight:500;';
	}

	private _money(v: unknown): string {
		const n = Number(v);
		return isNaN(n) ? '—' : `$${n.toFixed(2)}`;
	}

	private _renderBody(): void {
		DOM.clearNode(this.scrollArea);
		const c = this.claim;
		if (!c) {
			const empty = DOM.append(this.scrollArea, DOM.$('div'));
			empty.textContent = 'This claim could not be loaded from the RCM service.';
			empty.style.cssText = 'padding:24px;color:var(--vscode-descriptionForeground);font-style:italic;';
			return;
		}

		// Claim details grid
		const grid = DOM.append(this.scrollArea, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;padding:4px 0 16px;';
		this._infoCell(grid, 'Payer', String(c.payerName ?? ''));
		this._infoCell(grid, 'Subscriber ID', String(c.subscriberId ?? ''));
		this._infoCell(grid, 'Provider', String(c.providerName ?? c.providerNpi ?? ''));
		this._infoCell(grid, 'Type', String(c.claimType ?? ''));
		this._infoCell(grid, 'Date of Service', String(c.dateOfService ?? ''));
		this._infoCell(grid, 'Place of Service', String(c.placeOfService ?? ''));
		this._infoCell(grid, 'Submitted', c.submittedDate ? String(c.submittedDate).slice(0, 10) : '—');
		this._infoCell(grid, 'Submissions', String(c.submissionCount ?? 0));

		// Financial summary
		const fin = DOM.append(this.scrollArea, DOM.$('div'));
		fin.style.cssText = 'display:flex;gap:24px;padding:10px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;flex-wrap:wrap;';
		this._infoCell(fin, 'Total Charges', this._money(c.totalCharges));
		this._infoCell(fin, 'Paid', this._money(c.totalPaid));
		this._infoCell(fin, 'Patient Responsibility', this._money(c.patientResponsibility));
		this._infoCell(fin, 'Balance', this._money(c.balance));

		// Service lines
		const linesTitle = DOM.append(this.scrollArea, DOM.$('div'));
		linesTitle.textContent = 'SERVICE LINES';
		linesTitle.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.6px;color:var(--vscode-descriptionForeground);margin:6px 0 8px;';
		const table = DOM.append(this.scrollArea, DOM.$('div'));
		table.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;margin-bottom:16px;';
		const COLS = '40px 80px 90px minmax(160px,1.6fr) 70px 60px 90px 90px 80px';
		const header = DOM.append(table, DOM.$('div'));
		header.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;padding:8px 10px;background:rgba(0,122,204,0.05);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);`;
		for (const h of ['#', 'CPT', 'Modifiers', 'Description', 'Dx Ptr', 'Units', 'Charge', 'Paid', 'Denial']) {
			DOM.append(header, DOM.$('span')).textContent = h;
		}
		const lines = Array.isArray(c.lines) ? c.lines : [];
		if (lines.length === 0) {
			const empty = DOM.append(table, DOM.$('div'));
			empty.textContent = 'No service lines on this claim.';
			empty.style.cssText = 'padding:14px 10px;color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';
		}
		for (const ln of lines) {
			const row = DOM.append(table, DOM.$('div'));
			row.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;align-items:center;padding:6px 10px;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;`;
			DOM.append(row, DOM.$('span')).textContent = String(ln.lineNumber ?? '');
			const cpt = DOM.append(row, DOM.$('span'));
			cpt.textContent = String(ln.cptCode ?? '');
			cpt.style.cssText = 'font-weight:600;font-family:var(--vscode-editor-font-family,monospace);';
			DOM.append(row, DOM.$('span')).textContent = [ln.modifier1, ln.modifier2].filter(Boolean).join(', ');
			const desc = DOM.append(row, DOM.$('span'));
			desc.textContent = String(ln.description ?? '');
			desc.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			desc.title = String(ln.description ?? '');
			DOM.append(row, DOM.$('span')).textContent = String(ln.diagnosisPointers ?? '');
			DOM.append(row, DOM.$('span')).textContent = String(ln.units ?? '');
			DOM.append(row, DOM.$('span')).textContent = this._money(ln.chargeAmount);
			DOM.append(row, DOM.$('span')).textContent = this._money(ln.paidAmount);
			const dn = DOM.append(row, DOM.$('span'));
			dn.textContent = String(ln.denialCode ?? '');
			dn.style.color = ln.denialCode ? '#ef4444' : '';
		}

		// Issues panel (filled by Validate / Scrub / Submit)
		this.issuesHost = DOM.append(this.scrollArea, DOM.$('div'));
	}

	private _renderIssues(title: string, issues: RcmValidationIssue[], ok: boolean, okMessage: string): void {
		DOM.clearNode(this.issuesHost);
		const t = DOM.append(this.issuesHost, DOM.$('div'));
		t.textContent = title.toUpperCase();
		t.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.6px;color:var(--vscode-descriptionForeground);margin:6px 0 8px;';
		const box = DOM.append(this.issuesHost, DOM.$('div'));
		box.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		if (issues.length === 0) {
			const okRow = DOM.append(box, DOM.$('div'));
			okRow.textContent = ok ? `\u{2705} ${okMessage}` : okMessage;
			okRow.style.cssText = `padding:12px;font-size:12px;color:${ok ? '#22c55e' : '#ef4444'};font-weight:500;`;
			return;
		}
		// Say why it stopped, above the issues. Without this the panel showed a
		// "Submission Blocked" heading over a list of warnings that had not blocked
		// anything — the real reason (no clearinghouse configured) lived only in a
		// toast that then disappeared, so the warnings looked like the cause.
		if (!ok && okMessage) {
			const reason = DOM.append(box, DOM.$('div'));
			reason.textContent = okMessage;
			reason.style.cssText = 'padding:12px;font-size:12px;color:#ef4444;font-weight:500;border-left:3px solid #ef4444;';
		}
		for (const issue of issues) {
			const row = DOM.append(box, DOM.$('div'));
			const isError = String(issue.severity ?? 'ERROR').toUpperCase() === 'ERROR';
			row.style.cssText = `padding:8px 12px;border-top:1px solid rgba(128,128,128,0.08);display:flex;gap:10px;align-items:baseline;font-size:12px;border-left:3px solid ${isError ? '#ef4444' : '#f59e0b'};`;
			const sev = DOM.append(row, DOM.$('span'));
			sev.textContent = isError ? 'ERROR' : 'WARNING';
			sev.style.cssText = `font-size:9px;font-weight:700;color:${isError ? '#ef4444' : '#f59e0b'};min-width:56px;`;
			const msg = DOM.append(row, DOM.$('span'));
			msg.textContent = `${issue.field ? `[${issue.field}] ` : ''}${issue.message || issue.code || ''}${issue.lineNumber ? ` (line ${issue.lineNumber})` : ''}`;
			msg.style.flex = '1';
		}
	}

	private _renderFooter(): void {
		DOM.clearNode(this.footerBar);
		if (!this.claim) { return; }

		this._actionButton('\u{2714} Validate', '#3b82f6', async () => {
			const json = await this.rcmApi.fetchJson<{ data?: { valid?: boolean; errors?: RcmValidationIssue[]; warnings?: RcmValidationIssue[] } }>(`/api/rcm/claims/${encodeURIComponent(this.claimId)}/validate`, { method: 'POST' });
			const r = json?.data ?? {};
			const issues = [...(r.errors || []), ...(r.warnings || [])];
			this._renderIssues('Validation Result', issues, r.valid !== false, 'Claim is valid — ready to scrub.');
		});

		this._actionButton('\u{1F9F9} Scrub', '#06b6d4', async () => {
			const json = await this.rcmApi.fetchJson<{ data?: { passedScrub?: boolean; score?: number; issues?: RcmValidationIssue[] } }>(`/api/rcm/claims/${encodeURIComponent(this.claimId)}/scrub`, { method: 'POST' });
			const r = json?.data ?? {};
			this._renderIssues(`Scrub Result — Score ${r.score ?? '?'} / 100`, r.issues || [], r.passedScrub !== false, 'Clean claim — ready to submit.');
			await this._refresh();
		});

		this._actionButton('\u{1F4E4} Submit', '#2e7d32', async () => {
			const res = await this.rcmApi.fetch(`/api/rcm/claims/${encodeURIComponent(this.claimId)}/submit`, { method: 'POST' });
			const json = await res.json().catch(() => null) as { message?: string; data?: { submitted?: boolean; submissionMethod?: string; controlNumber?: string; errorMessage?: string; validationResult?: { errors?: RcmValidationIssue[] }; scrubResult?: { issues?: RcmValidationIssue[] } } } | null;
			const r = json?.data;
			if (res.ok && r?.submitted) {
				this.notificationService.notify({ severity: Severity.Info, message: `Claim submitted via ${r.submissionMethod || 'EDI'}${r.controlNumber ? ` (control #${r.controlNumber})` : ''}.` });
				this._renderIssues('Submission Result', [], true, `Submitted via ${r.submissionMethod || 'EDI'}.`);
			} else {
				const issues = [...(r?.validationResult?.errors || []), ...(r?.scrubResult?.issues || [])];
				this._renderIssues('Submission Blocked', issues, false, r?.errorMessage || json?.message || 'Submission failed.');
				this.notificationService.notify({ severity: Severity.Error, message: r?.errorMessage || json?.message || 'Claim submission failed.' });
			}
			await this._refresh();
		});

		// A claim can only be paid or denied once it has actually been billed, so
		// these two stay hidden until it has been sent. Before this the second half
		// of the revenue cycle had no screen at all: an insurer's cheque and a
		// denial could only be recorded by calling the API by hand.
		if (this._hasBeenBilled()) {
			// allow-any-unicode-next-line
			this._actionButton('\u{1F4B5} Post Payment', '#0d9488', () => this._postInsurancePayment());
			// allow-any-unicode-next-line
			this._actionButton('\u{26D4} Record Denial', '#b91c1c', () => this._recordDenial());
		}

		this._actionButton('\u{21BB} Refresh Status', '#6b7280', async () => {
			await this._refresh();
			this.notificationService.notify({ severity: Severity.Info, message: `Claim status: ${this.claim?.claimStatus || 'unknown'}.` });
		});
	}

	/**
	 * Could a payer have seen this claim yet?
	 *
	 * <p>Not the same as "we transmitted it". A practice with no clearinghouse account
	 * files by downloading the 837 and uploading it on the payer's portal, and a
	 * cheque comes back all the same — so gating on our own submission would leave
	 * those practices no way to record the money. A claim that has passed scrubbing is
	 * billable by any route, so that is where these actions open up.
	 */
	private _hasBeenBilled(): boolean {
		if (!this.claim) { return false; }
		if (this.claim.submittedDate || (this.claim.submissionCount ?? 0) > 0) { return true; }
		const status = String(this.claim.claimStatus || '').toUpperCase();
		return !['DRAFT', 'VALIDATED', 'VOID'].includes(status);
	}

	private static _today(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	private static _money(v: string | undefined): number {
		const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
		return Number.isFinite(n) ? n : 0;
	}

	/**
	 * Record what the insurer actually paid, line by line.
	 *
	 * The per-line split is not busywork: RCM works out the patient's share from it,
	 * and the same figures are mirrored into the EHR ledger so the front desk collects
	 * the remainder from the one balance they already work from.
	 */
	private async _postInsurancePayment(): Promise<void> {
		const claim = this.claim;
		if (!claim) { return; }
		const lines = (claim.lines || []).filter(l => l.cptCode);

		const fields: IThemedModalField[] = [
			{ key: 'payerName', label: 'Payer', type: 'text', value: claim.payerName || '', required: true },
			{ key: 'checkNumber', label: 'Cheque / EFT number', type: 'text', required: true, placeholder: 'e.g. 4417823' },
			{ key: 'checkDate', label: 'Cheque date', type: 'date', value: RcmClaimEditor._today(), required: true },
			{ key: 'checkAmount', label: 'Cheque amount', type: 'number', required: true, placeholder: '0.00' },
		];
		for (const line of lines) {
			const cpt = String(line.cptCode);
			const billed = line.chargeAmount ?? 0;
			fields.push(
				{ key: `billed_${cpt}`, label: `${cpt} — billed`, type: 'number', value: String(billed) },
				{ key: `allowed_${cpt}`, label: `${cpt} — allowed`, type: 'number', placeholder: '0.00' },
				{ key: `paid_${cpt}`, label: `${cpt} — paid`, type: 'number', placeholder: '0.00' },
				{ key: `patient_${cpt}`, label: `${cpt} — patient responsibility`, type: 'number', placeholder: '0.00' },
			);
		}

		const values = await showThemedModal({
			title: 'Post Insurance Payment',
			subtitle: `${claim.claimNumber || ''}${claim.patientName ? ` — ${claim.patientName}` : ''}`,
			fields,
			confirmLabel: 'Post Payment',
			confirmColor: '#0d9488',
			anchor: this.root,
		});
		if (!values) { return; }

		const procedures = lines.map(line => {
			const cpt = String(line.cptCode);
			const billed = RcmClaimEditor._money(values[`billed_${cpt}`]);
			const allowed = RcmClaimEditor._money(values[`allowed_${cpt}`]);
			const paid = RcmClaimEditor._money(values[`paid_${cpt}`]);
			const patient = RcmClaimEditor._money(values[`patient_${cpt}`]);
			return {
				cptCode: cpt,
				billedAmount: billed,
				allowedAmount: allowed,
				paidAmount: paid,
				patientResponsibility: patient,
				// What the payer knocked off the bill and nobody owes. Derived rather
				// than typed: a biller entering it by hand is how ledgers stop balancing.
				adjustmentAmount: Math.max(0, Number((billed - allowed).toFixed(2))),
			};
		});

		const res = await this.rcmApi.fetch('/api/rcm/payments/manual/insurance', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				claimId: this.claimId,
				payerName: values.payerName,
				checkNumber: values.checkNumber,
				checkDate: values.checkDate,
				checkAmount: RcmClaimEditor._money(values.checkAmount),
				paymentMethod: 'CHECK',
				postedBy: 'workspace',
				procedures,
			}),
		});
		const json = await res.json().catch(() => null) as { message?: string } | null;
		if (!res.ok) {
			this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Could not post the payment.' });
			return;
		}
		this.notificationService.notify({
			severity: Severity.Info,
			message: `Payment posted against ${claim.claimNumber || 'the claim'}. The patient's share is now collectable in Payments.`,
		});
		await this._refresh();
	}

	/** Record a denial so it lands in the Denials queue with an appeal deadline. */
	private async _recordDenial(): Promise<void> {
		const claim = this.claim;
		if (!claim) { return; }

		const values = await showThemedModal({
			title: 'Record Denial',
			subtitle: `${claim.claimNumber || ''}${claim.patientName ? ` — ${claim.patientName}` : ''}`,
			fields: [
				{ key: 'denialCode', label: 'Denial code (CARC)', type: 'text', required: true, placeholder: 'e.g. CO-97' },
				{ key: 'denialReason', label: 'Reason given', type: 'textarea', rows: 3, required: true },
				{ key: 'denialDate', label: 'Date denied', type: 'date', value: RcmClaimEditor._today(), required: true },
				{ key: 'deniedAmount', label: 'Amount denied', type: 'number', value: String(claim.balance ?? claim.totalCharges ?? 0) },
				{
					key: 'denialCategory', label: 'Category', type: 'select', value: 'CLINICAL',
					options: [
						{ label: 'Clinical', value: 'CLINICAL' },
						{ label: 'Administrative', value: 'ADMINISTRATIVE' },
						{ label: 'Eligibility', value: 'ELIGIBILITY' },
						{ label: 'Coding', value: 'CODING' },
						{ label: 'Timely filing', value: 'TIMELY_FILING' },
					],
				},
			],
			confirmLabel: 'Record Denial',
			confirmColor: '#b91c1c',
			anchor: this.root,
		});
		if (!values) { return; }

		const res = await this.rcmApi.fetch(`/api/rcm/denials/claim/${encodeURIComponent(this.claimId)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				denialCode: values.denialCode,
				denialReason: values.denialReason,
				denialDate: values.denialDate,
				deniedAmount: RcmClaimEditor._money(values.deniedAmount),
				denialCategory: values.denialCategory,
				denialSource: 'MANUAL',
			}),
		});
		const json = await res.json().catch(() => null) as { message?: string } | null;
		if (!res.ok) {
			this.notificationService.notify({ severity: Severity.Error, message: json?.message || 'Could not record the denial.' });
			return;
		}
		this.notificationService.notify({
			severity: Severity.Info,
			message: `Denial recorded. ${claim.claimNumber || 'The claim'} is now in the Denials queue with an appeal deadline.`,
		});
		await this._refresh();
	}

	private async _refresh(): Promise<void> {
		await this._loadClaim();
		this._renderHeader();
		// Preserve the issues panel across refreshes: re-render the body only.
		const issuesSnapshot = this.issuesHost;
		this._renderBody();
		if (issuesSnapshot && issuesSnapshot.childNodes.length > 0) {
			// Move previous issue nodes into the freshly-created host.
			while (issuesSnapshot.firstChild) { this.issuesHost.appendChild(issuesSnapshot.firstChild); }
		}
	}

	private _actionButton(label: string, bg: string, onClick: () => Promise<void>): void {
		const b = DOM.append(this.footerBar, DOM.$('button')) as HTMLButtonElement;
		b.textContent = label;
		b.style.cssText = `padding:7px 16px;background:${bg};color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:500;`;
		b.addEventListener('click', async () => {
			b.disabled = true;
			b.style.opacity = '0.6';
			try {
				await onClick();
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `${label.replace(/^\S+\s/, '')} failed: ${e instanceof Error ? e.message : e}` });
			}
			b.disabled = false;
			b.style.opacity = '1';
		});
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
