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
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { RcmRemittanceEditorInput } from './ciyexEditorInput.js';
import { ICiyexRcmApiService } from '../rcm/rcmApiService.js';
import * as DOM from '../../../../../base/browser/dom.js';

/** One claim on the remittance, as `/payments/batches/{id}/review` describes it. */
interface EraReviewLine {
	lineId?: string;
	patientName?: string;
	patientId?: string;
	memberId?: string;
	dateOfService?: string;
	cptCode?: string;
	claimNumber?: string;
	payerClaimControlNumber?: string;
	encounterId?: string;
	feeSheetId?: string;
	billed?: number;
	allowed?: number;
	paid?: number;
	deductible?: number;
	coinsurance?: number;
	copay?: number;
	writeOff?: number;
	adjustmentDetail?: string;
	remarkCodes?: string;
	matched?: boolean;
	claimId?: string;
	matchConfidence?: string;
	forwardedToAnotherPayer?: boolean;
	forwardedToPayer?: string;
	patientWillOwe?: number;
	insuranceStillOwes?: number;
	outcome?: string;
	warnings?: string[];
	balances?: boolean;
}

interface EraBatch {
	id?: string;
	batchNumber?: string;
	payerName?: string;
	checkNumber?: string;
	checkAmount?: number;
	checkDate?: string;
	status?: string;
	totalClaims?: number;
}

const money = (n: number | undefined) => `$${(Number(n) || 0).toFixed(2)}`;

/**
 * A remittance, read before it is posted.
 *
 * <p>Posting an ERA is not a preview: it credits claims, changes what the front desk asks
 * the patient for, and can send a statement. This screen is the moment to catch the things
 * that are painful afterwards — a payment matched to the wrong claim, figures that do not
 * reconcile, and above all a claim the payer has passed to a second insurer, where the
 * leftover balance is emphatically not the patient's.
 *
 * <p>Rows can be excluded. Whatever stays selected is what posts.
 */
export class RcmRemittanceEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexRcmRemittance';

	private root!: HTMLElement;
	private headerBar!: HTMLElement;
	private scrollArea!: HTMLElement;
	private footerBar!: HTMLElement;

	private batchId = '';
	private batch: EraBatch | null = null;
	private rows: EraReviewLine[] = [];
	/** Line ids the biller has excluded from this posting. */
	private readonly excluded = new Set<string>();
	private loading = true;
	private posting = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ICiyexRcmApiService private readonly rcmApi: ICiyexRcmApiService,
	) {
		super(RcmRemittanceEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-rcm-remittance.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		this.headerBar = DOM.append(this.root, DOM.$('div'));
		this.headerBar.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		this.scrollArea = DOM.append(this.root, DOM.$('div'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px;';

		this.footerBar = DOM.append(this.root, DOM.$('div'));
		this.footerBar.style.cssText = 'padding:10px 16px;border-top:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
	}

	override async setInput(input: RcmRemittanceEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.batchId = input.batchId;
		this.excluded.clear();
		await this._load();
		if (token.isCancellationRequested) { return; }
		this._renderAll();
	}

	private async _load(): Promise<void> {
		this.loading = true;
		try {
			const [batchJson, reviewJson] = await Promise.all([
				this.rcmApi.fetchJson<{ data?: EraBatch }>(`/api/rcm/payments/batches/${encodeURIComponent(this.batchId)}`),
				this.rcmApi.fetchJson<{ data?: EraReviewLine[] }>(`/api/rcm/payments/batches/${encodeURIComponent(this.batchId)}/review`),
			]);
			this.batch = (batchJson?.data ?? batchJson ?? null) as EraBatch | null;
			const rows = reviewJson?.data ?? reviewJson;
			this.rows = Array.isArray(rows) ? rows : [];
			// Nothing that cannot post should start selected — an unmatched payment has no
			// claim to credit, so leaving it ticked only invites a click that fails.
			for (const r of this.rows) {
				if (!r.matched && r.lineId) { this.excluded.add(r.lineId); }
			}
		} catch (e) {
			this.batch = null;
			this.rows = [];
			this.notificationService.notify({
				severity: Severity.Error,
				message: `Could not read this remittance: ${e instanceof Error ? e.message : e}`,
			});
		}
		this.loading = false;
	}

	private _renderAll(): void {
		this._renderHeader();
		this._renderBody();
		this._renderFooter();
	}

	// ------------------------------------------------------------------ header

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		const b = this.batch;

		const titleRow = DOM.append(this.headerBar, DOM.$('div'));
		titleRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
		const title = DOM.append(titleRow, DOM.$('span'));
		title.style.cssText = 'font-size:15px;font-weight:600;';
		title.textContent = b
			? `${b.payerName || 'Remittance'} — cheque ${b.checkNumber || '—'} for ${money(b.checkAmount)}`
			: 'Remittance not found';

		if (b?.status) {
			const badge = DOM.append(titleRow, DOM.$('span'));
			const posted = b.status === 'POSTED';
			badge.style.cssText = `padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${posted ? '#16a34a' : '#f59e0b'};`;
			badge.textContent = b.status;
		}

		const sub = DOM.append(this.headerBar, DOM.$('div'));
		sub.style.cssText = 'margin-top:4px;opacity:0.75;font-size:12px;';
		const parts: string[] = [];
		if (b?.checkDate) { parts.push(`Paid ${String(b.checkDate).slice(0, 10)}`); }
		parts.push(`${this.rows.length} claim${this.rows.length === 1 ? '' : 's'}`);
		const forwarded = this.rows.filter(r => r.forwardedToAnotherPayer).length;
		if (forwarded > 0) { parts.push(`${forwarded} forwarded to another insurer`); }
		const unmatched = this.rows.filter(r => !r.matched).length;
		if (unmatched > 0) { parts.push(`${unmatched} with no matching claim`); }
		sub.textContent = parts.join(' · ');
	}

	// -------------------------------------------------------------------- body

	private _renderBody(): void {
		DOM.clearNode(this.scrollArea);

		if (this.loading) {
			const l = DOM.append(this.scrollArea, DOM.$('div'));
			l.style.cssText = 'opacity:0.7;';
			l.textContent = 'Reading the remittance…';
			return;
		}
		if (!this.rows.length) {
			const l = DOM.append(this.scrollArea, DOM.$('div'));
			l.style.cssText = 'opacity:0.7;';
			l.textContent = 'This remittance has no claims on it.';
			return;
		}

		for (const row of this.rows) {
			this._renderRow(row);
		}
	}

	private _renderRow(row: EraReviewLine): void {
		const excluded = row.lineId ? this.excluded.has(row.lineId) : false;
		const card = DOM.append(this.scrollArea, DOM.$('div'));
		card.style.cssText = `border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:12px 14px;margin-bottom:10px;opacity:${excluded ? '0.5' : '1'};`;

		// --- line 1: who, and whether it will post -------------------------
		const top = DOM.append(card, DOM.$('div'));
		top.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

		const tick = DOM.append(top, DOM.$('input')) as HTMLInputElement;
		tick.type = 'checkbox';
		tick.checked = !excluded;
		tick.disabled = !row.matched || this.posting;
		tick.title = row.matched ? 'Include this claim when posting' : 'Cannot post — no matching claim';
		tick.onchange = () => {
			if (!row.lineId) { return; }
			if (tick.checked) { this.excluded.delete(row.lineId); } else { this.excluded.add(row.lineId); }
			this._renderAll();
		};

		const name = DOM.append(top, DOM.$('span'));
		name.style.cssText = 'font-weight:600;';
		name.textContent = row.patientName || 'Unknown patient';

		const dos = DOM.append(top, DOM.$('span'));
		dos.style.cssText = 'opacity:0.75;font-size:12px;';
		dos.textContent = row.dateOfService ? `DOS ${String(row.dateOfService).slice(0, 10)}` : 'no date of service';

		if (row.cptCode) {
			const cpt = DOM.append(top, DOM.$('span'));
			cpt.style.cssText = 'opacity:0.75;font-size:12px;';
			cpt.textContent = row.cptCode;
		}

		// The outcome badge — the one thing worth reading if nothing else is.
		const outcome = DOM.append(top, DOM.$('span'));
		const colour = !row.matched ? '#ef4444'
			: row.forwardedToAnotherPayer ? '#8b5cf6'
				: (row.patientWillOwe || 0) > 0 ? '#f59e0b' : '#16a34a';
		outcome.style.cssText = `margin-left:auto;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${colour};`;
		outcome.textContent = !row.matched ? 'No matching claim'
			: row.forwardedToAnotherPayer ? `Held for ${row.forwardedToPayer || 'next insurer'}`
				: (row.patientWillOwe || 0) > 0 ? `Patient owes ${money(row.patientWillOwe)}` : 'Settled';

		// --- line 2: the identifiers that let a payment be traced ----------
		const ids = DOM.append(card, DOM.$('div'));
		ids.style.cssText = 'margin-top:6px;font-size:11px;opacity:0.75;display:flex;gap:14px;flex-wrap:wrap;';
		const idParts: string[] = [];
		if (row.claimNumber) { idParts.push(`Claim ${row.claimNumber}`); }
		// The payer's own reference — the number they will ask for on the phone.
		if (row.payerClaimControlNumber) { idParts.push(`Payer ICN ${row.payerClaimControlNumber}`); }
		if (row.encounterId) { idParts.push(`Encounter ${row.encounterId}`); }
		if (row.feeSheetId) { idParts.push(`Fee sheet ${row.feeSheetId}`); }
		if (row.memberId) { idParts.push(`Member ${row.memberId}`); }
		if (row.matchConfidence && row.matched) { idParts.push(`Matched: ${row.matchConfidence}`); }
		ids.textContent = idParts.join('   ·   ');

		// --- line 3: the money ---------------------------------------------
		const figures = DOM.append(card, DOM.$('div'));
		figures.style.cssText = 'margin-top:8px;display:flex;gap:18px;flex-wrap:wrap;font-size:12px;';
		this._figure(figures, 'Billed', money(row.billed));
		this._figure(figures, 'Allowed', money(row.allowed));
		this._figure(figures, 'Paid', money(row.paid), '#16a34a');
		this._figure(figures, 'Write-off', money(row.writeOff));
		if ((row.copay || 0) > 0) { this._figure(figures, 'Copay', money(row.copay)); }
		if ((row.deductible || 0) > 0) { this._figure(figures, 'Deductible', money(row.deductible)); }
		if ((row.coinsurance || 0) > 0) {
			// Labelled by where it is going, because that is the question a biller has.
			this._figure(figures, row.forwardedToAnotherPayer ? 'Coinsurance → next insurer' : 'Coinsurance',
				money(row.coinsurance), row.forwardedToAnotherPayer ? '#8b5cf6' : undefined);
		}

		if (row.adjustmentDetail) {
			const adj = DOM.append(card, DOM.$('div'));
			adj.style.cssText = 'margin-top:6px;font-size:11px;opacity:0.7;';
			adj.textContent = `Adjustments: ${row.adjustmentDetail}`;
		}

		// --- line 4: what happens, in words --------------------------------
		if (row.outcome) {
			const words = DOM.append(card, DOM.$('div'));
			words.style.cssText = 'margin-top:6px;font-size:12px;';
			words.textContent = row.outcome;
		}

		for (const warning of row.warnings ?? []) {
			const warn = DOM.append(card, DOM.$('div'));
			warn.style.cssText = 'margin-top:6px;font-size:12px;color:#f59e0b;';
			warn.textContent = `⚠ ${warning}`;
		}
	}

	private _figure(host: HTMLElement, label: string, value: string, colour?: string): void {
		const wrap = DOM.append(host, DOM.$('div'));
		const l = DOM.append(wrap, DOM.$('div'));
		l.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.6;';
		l.textContent = label;
		const v = DOM.append(wrap, DOM.$('div'));
		v.style.cssText = `font-size:13px;font-weight:600;${colour ? `color:${colour};` : ''}`;
		v.textContent = value;
	}

	// ------------------------------------------------------------------ footer

	private _renderFooter(): void {
		DOM.clearNode(this.footerBar);

		const selectable = this.rows.filter(r => r.matched);
		const selected = selectable.filter(r => !r.lineId || !this.excluded.has(r.lineId));
		const willPay = selected.reduce((s, r) => s + (r.paid || 0), 0);
		const willBillPatient = selected.reduce((s, r) => s + (r.patientWillOwe || 0), 0);
		const heldForNext = selected.reduce((s, r) => s + (r.insuranceStillOwes || 0), 0);

		const summary = DOM.append(this.footerBar, DOM.$('span'));
		summary.style.cssText = 'font-size:12px;opacity:0.85;';
		summary.textContent = `${selected.length} of ${selectable.length} selected · posting ${money(willPay)} · `
			+ `patients billed ${money(willBillPatient)}`
			+ (heldForNext > 0 ? ` · ${money(heldForNext)} held for other insurers` : '');

		const spacer = DOM.append(this.footerBar, DOM.$('span'));
		spacer.style.cssText = 'flex:1;';

		const alreadyPosted = this.batch?.status === 'POSTED';
		const post = DOM.append(this.footerBar, DOM.$('button')) as HTMLButtonElement;
		post.textContent = this.posting ? 'Posting…' : 'Post selected claims';
		post.disabled = this.posting || alreadyPosted || selected.length === 0;
		post.style.cssText = `padding:6px 14px;border:none;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${post.disabled ? '#6b7280' : '#16a34a'};cursor:${post.disabled ? 'default' : 'pointer'};`;
		post.onclick = () => this._post(selected.length, willBillPatient);

		if (alreadyPosted) {
			const note = DOM.append(this.footerBar, DOM.$('span'));
			note.style.cssText = 'font-size:12px;opacity:0.7;';
			note.textContent = 'Already posted.';
		}
	}

	/**
	 * Post what is selected. Confirmed first, and the confirmation says what it will do to
	 * patients rather than only how much money moves — that is the part that is awkward to
	 * undo, because a patient who has been billed has usually been told.
	 */
	private async _post(count: number, patientTotal: number): Promise<void> {
		const confirmed = await this.dialogService.confirm({
			message: `Post ${count} claim${count === 1 ? '' : 's'} from this remittance?`,
			detail: patientTotal > 0
				? `${money(patientTotal)} will become patient balances and may be statemented.`
				: 'No patient balances arise from this remittance.',
			primaryButton: 'Post',
		});
		if (!confirmed.confirmed) { return; }

		this.posting = true;
		this._renderFooter();
		try {
			// Excluded lines are marked so the batch's own posting pass skips them, then
			// the standard post runs — the same path a manual posting takes, so an
			// automatic posting and a hand-made one cannot end up different.
			const excludedIds = [...this.excluded];
			const res = await this.rcmApi.fetch(`/api/rcm/payments/batches/${encodeURIComponent(this.batchId)}/post-reviewed`, {
				method: 'POST',
				body: JSON.stringify({ excludeLineIds: excludedIds }),
			});
			const payload = await res.json().catch(() => null) as { message?: string; success?: boolean } | null;
			if (!res.ok || payload?.success === false) {
				throw new Error(payload?.message || `Posting failed (${res.status}).`);
			}
			this.notificationService.notify({
				severity: Severity.Info,
				message: payload?.message || `Posted ${count} claim${count === 1 ? '' : 's'} from this remittance.`,
			});
			await this._load();
		} catch (e) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: `The remittance was not posted: ${e instanceof Error ? e.message : e}`,
			});
		} finally {
			this.posting = false;
			this._renderAll();
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
