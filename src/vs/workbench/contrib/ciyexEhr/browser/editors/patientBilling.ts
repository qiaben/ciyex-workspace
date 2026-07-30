/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { claimNumberForFeeSheet, normalizeClaimRef } from '../billing/edi837.js';
import { createCustomDropdown } from '../customDropdown.js';
import {
	ILedgerActionsHost, ILedgerExportHost, ILedgerStatementInfo, LedgerClaimGroup, LedgerEvent,
	LEDGER_STATEMENT_PRINT_CSS, buildLedgerEventsFrom, fetchLedgerSources, groupLedgerByClaim,
	ledgerStatementHtml, ledgerWorkbook,
} from './patientLedger.js';
import { selfPayClaimRefs } from './selfPayBilling.js';

/**
 * The patient chart's Billing page — the ONE revenue surface in the chart.
 *
 * The chart used to carry a whole "Claims" section (Billing / Claims /
 * Submissions / Denials / ERA-Remittance / Transactions), every page of it a
 * generic FHIR list. Those FHIR resources are never written by this app's
 * billing flow, so all six read empty: the real money records live in
 * `/api/fee-sheets` (what was charged) and `/api/payments/transactions` (EOB
 * postings, patient payments, credits, patient responsibility). That is why
 * the Billing tab showed "No billing records" on a patient who had been billed
 * and paid. The test team asked for one Billing page instead of six, so this
 * module composes the SAME two stores the Fee Sheet, Insurance Posting and
 * Ledger flows use into a single per-patient billing view:
 *
 *   Fee Sheet (charges)  →  Send to Billing (claim)  →  Insurance Posting (EOB:
 *   allowed / paid / write-off / copay / deductible / coinsurance)  →  secondary
 *   payer  →  patient responsibility  →  patient payment / credit  →  balance.
 *
 * One card per claim, in that workflow order, with the fee sheet's service
 * lines and the EOB adjudication side by side, so a biller can answer "what
 * was billed, what did insurance do with it, and what does the patient owe?"
 * without leaving the chart.
 *
 * The money maths (events, per-claim rollup, statement, workbook) is NOT
 * re-implemented here — it is imported from patientLedger.ts so the chart's
 * Billing page, the chart's Ledger page and the Payments editor can never
 * disagree about a balance.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

/** Money owed reads plain; money the account is ahead by reads as a credit. */
function balanceLabel(balance: number): string {
	return balance < -0.005 ? `${money(Math.abs(balance))} CR` : money(Math.max(balance, 0));
}

function usDate(iso: string): string {
	const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
	// allow-any-unicode-next-line
	return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '—');
}

function isoDate(value: unknown): string {
	const s = String(value ?? '');
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) { return s.slice(0, 10); }
	const t = new Date(s).getTime();
	return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

/** Parse a `key=value` number out of an EOB posting description. */
function eobNumber(text: string, field: string): number | undefined {
	const m = String(text ?? '').match(new RegExp(`${field}=(-?\\d+(?:\\.\\d+)?)`));
	return m ? Number(m[1]) : undefined;
}

/** Parse a `key=value` string out of an EOB posting description. */
function eobText(text: string, field: string): string {
	return String(text ?? '').match(new RegExp(`${field}=([^;|]+)`))?.[1]?.trim() || '';
}

// allow-any-unicode-next-line
// ── Model ──────────────────────────────────────────────────────────────────

/** One billable line of the claim, with the payer's adjudication of it. */
export interface BillingServiceLine {
	/** CPT / HCPCS code billed. */
	code: string;
	description: string;
	modifiers: string;
	qty: number;
	/** Unit price from the fee sheet. */
	price: number;
	/** price x qty — what was billed for this line. */
	billed: number;
	/** Diagnosis pointer(s) justifying the procedure. */
	justify: string;
	/** True once an EOB has been posted against the claim (the columns below are real). */
	adjudicated: boolean;
	allowed: number;
	insPaid: number;
	writeOff: number;
	copay: number;
	deductible: number;
	coinsurance: number;
}

/**
 * Billing status of a claim, in workflow order. This is NOT the fee sheet's raw
 * `billingStatus` column (which only ever says Unbilled/Billed) — it is derived
 * from where the claim actually sits in the revenue cycle.
 */
export type BillingClaimStatus =
	| 'unbilled'
	| 'awaiting-insurance'
	| 'insurance-pending'
	| 'denied'
	| 'patient-due'
	| 'open'
	| 'settled'
	| 'credit';

const STATUS_META: Record<BillingClaimStatus, { label: string; color: string; hint: string }> = {
	'unbilled': { label: 'Not Billed', color: '#94a3b8', hint: 'Charges captured on a fee sheet but never sent to billing — no claim exists yet.' },
	'awaiting-insurance': { label: 'Awaiting Insurance', color: '#3b9edd', hint: 'Claim submitted; the payer has not returned an EOB yet.' },
	'insurance-pending': { label: 'Secondary Pending', color: '#8b5cf6', hint: 'The primary payer left coinsurance, which carries to the secondary insurance — not patient responsibility until that EOB posts.' },
	'denied': { label: 'Denied', color: '#ef4444', hint: 'The payer denied the claim. Rework and resubmit, or bill the patient.' },
	'patient-due': { label: 'Patient Due', color: '#f59e0b', hint: 'Insurance has adjudicated; copay / deductible is assigned to the patient and not yet collected.' },
	'open': { label: 'Open Balance', color: '#ef4444', hint: 'Money is still outstanding on this claim.' },
	'settled': { label: 'Settled', color: '#22c55e', hint: 'Nothing left to collect on this claim.' },
	'credit': { label: 'Credit', color: '#14b8a6', hint: 'The account is ahead on this claim — money collected exceeds what was charged.' },
};

/** One claim (a billed fee sheet), or an unbilled fee sheet / the credit bucket. */
export interface BillingClaim {
	key: string;
	/** CLM-#### — derived from the fee-sheet id when the claim was billed. */
	claimRef: string;
	feeSheetId: string;
	encounterId: string;
	/** Date of service of the visit the charges came from. */
	serviceDate: string;
	/** Most recent posting date on the claim. */
	lastActivity: string;
	sortKey: number;
	providerName: string;
	/** Primary payer — from the posted EOB, else the patient's coverage on file. */
	payerName: string;
	secondaryPayerName: string;
	checkNumber: string;
	denialReason: string;
	/** Coinsurance the primary payer carried to the secondary insurance. */
	carriedCoinsurance: number;
	secondaryPosted: boolean;
	/** ICD-10 codes on the fee sheet, as `CODE — description`. */
	diagnoses: string[];
	lines: BillingServiceLine[];
	charges: number;
	insurancePaid: number;
	adjustments: number;
	patientPaid: number;
	patientDue: number;
	balance: number;
	status: BillingClaimStatus;
	/** The money postings behind the numbers above (charge, EOB, payments). */
	events: LedgerEvent[];
	/** Fee sheet captured but never sent to billing — no claim, no money yet. */
	isUnbilled: boolean;
	/** The synthetic "patient credit on account" card (no claim behind it). */
	isCredit: boolean;
	/**
	 * Billed with no payer because the patient has no insurance: the whole charge
	 * is their balance. Unlike the absence of coverage, this IS proof — the fee
	 * sheet recorded the responsibility explicitly when it was sent to billing.
	 */
	isSelfPay: boolean;
}

/** Coverage on file for the patient, as shown in the Billing page header. */
export interface BillingCoverage {
	tier: string;
	payerName: string;
	planName: string;
	memberId: string;
	groupNumber: string;
	status: string;
}

/** Everything the Billing page renders. */
export interface PatientBillingModel {
	claims: BillingClaim[];
	coverage: BillingCoverage[];
	totals: {
		charges: number;
		insurancePaid: number;
		adjustments: number;
		patientPaid: number;
		patientDue: number;
		availableCredit: number;
		outstanding: number;
		/** Charges sitting on unbilled fee sheets — real work, not yet receivable. */
		unbilled: number;
	};
	/** The ledger claim groups, reused verbatim for the statement / workbook exports. */
	groups: LedgerClaimGroup[];
}

function listOf(payload: unknown): Array<Record<string, unknown>> {
	const p = payload as { data?: unknown; content?: unknown } | unknown[] | null;
	const w = (p as { data?: unknown })?.data ?? p;
	const list = (w as { content?: unknown })?.content ?? w;
	return Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
}

/**
 * Per-CPT EOB detail lives in the transaction's `notes` column as
 * `lines=CODE~billed~allowed~paid~copay~deductible~coinsurance~writeOff;…`
 * (written by the Insurance Posting flow in clinicalEditors.ts, which is the
 * encoding's source of truth). Older postings carried fewer segments — the
 * missing figures read 0.
 */
function parseEobLineDetail(notes: string): Map<string, { allowed: number; paid: number; copay: number; deductible: number; coinsurance: number; writeOff?: number; billed: number }> {
	const out = new Map<string, { allowed: number; paid: number; copay: number; deductible: number; coinsurance: number; writeOff?: number; billed: number }>();
	const m = String(notes ?? '').match(/lines=([^|]+)/);
	if (!m) { return out; }
	for (const part of m[1].split(';')) {
		const [code, billed, allowed, paid, copay, deductible, coinsurance, writeOff] = part.split('~');
		if (!code?.trim()) { continue; }
		out.set(code.trim(), {
			billed: Number(billed) || 0,
			allowed: Number(allowed) || 0,
			paid: Number(paid) || 0,
			copay: Number(copay) || 0,
			deductible: Number(deductible) || 0,
			coinsurance: Number(coinsurance) || 0,
			writeOff: writeOff !== undefined ? (Number(writeOff) || 0) : undefined,
		});
	}
	return out;
}

/** Secondary-payer state out of the notes `sec=payer~check~date~posted` segment. */
function parseSecondaryState(notes: string): { payer: string; posted: boolean } {
	const m = String(notes ?? '').match(/(?:^|\| ?)sec=([^|]+)/);
	if (!m) { return { payer: '', posted: false }; }
	const [payer, , , posted] = m[1].split('~');
	return { payer: (payer || '').trim(), posted: posted?.trim() === '1' };
}

/** Options that let the host chart resolve ids the billing records only carry numerically. */
export interface IBuildPatientBillingOptions {
	/** Resolve a rendering-provider id to a display name (the chart's lookup cache). */
	providerName?: (id: string) => string;
}

/**
 * Assemble the patient's complete billing picture from the fee sheets, the
 * payment transactions and the coverage on file.
 */
export async function buildPatientBilling(apiService: ICiyexApiService, patientId: string, opts: IBuildPatientBillingOptions = {}): Promise<PatientBillingModel> {
	const [sources, coverageRaw] = await Promise.all([
		fetchLedgerSources(apiService),
		apiService.fetch(`/api/fhir-resource/insurance-coverage?patientId=${encodeURIComponent(patientId)}&size=50`)
			.then(async r => r.ok ? await r.json() : null).catch(() => null),
	]);

	// Money side: the SAME events + per-claim rollup the Ledger renders.
	const events = buildLedgerEventsFrom(sources, patientId);
	const groups = groupLedgerByClaim(events);
	const groupByRef = new Map<string, LedgerClaimGroup>();
	for (const g of groups) {
		if (!g.isCredit) { groupByRef.set(normalizeClaimRef(g.claimRef), g); }
	}

	// Coverage on file — the payer shown before any EOB names one.
	const coverage: BillingCoverage[] = listOf(coverageRaw)
		.filter(c => !patientId || String(c['patientId'] ?? c['patient'] ?? patientId) === String(patientId))
		.map(c => ({
			tier: String(c['insuranceType'] ?? c['tier'] ?? c['coverageType'] ?? ''),
			payerName: String(c['payerName'] ?? c['insurerName'] ?? c['organizationDisplay'] ?? c['name'] ?? ''),
			planName: String(c['planName'] ?? c['plan'] ?? ''),
			memberId: String(c['policyNumber'] ?? c['memberId'] ?? c['subscriberId'] ?? ''),
			groupNumber: String(c['groupNumber'] ?? c['group'] ?? ''),
			status: String(c['status'] ?? ''),
		}))
		.filter(c => c.payerName || c.memberId);
	const primaryCoverage = coverage.find(c => /primary/i.test(c.tier)) || coverage[0];
	const secondaryCoverage = coverage.find(c => /secondary/i.test(c.tier));

	// Claims the fee sheet billed straight to the patient because they have no
	// insurance. Derived from the transactions already fetched above — no extra
	// request.
	const selfPayRefs = selfPayClaimRefs(sources.txns.filter(t => String(t['patientId'] ?? '') === String(patientId)));

	// EOB postings, indexed by the claim they settle, so a claim card can show
	// the payer, the check, the denial reason and the per-code adjudication.
	interface EobMeta {
		payer: string; check: string; denial: string; coinsurance: number;
		secondaryPayer: string; secondaryPosted: boolean;
		lines: ReturnType<typeof parseEobLineDetail>;
	}
	const eobByClaim = new Map<string, EobMeta>();
	for (const t of sources.txns) {
		if (String(t['patientId'] ?? '') !== String(patientId)) { continue; }
		const desc = String(t['description'] ?? '');
		const notes = String(t['notes'] ?? '');
		const isEob = String(t['transactionType'] ?? '') === 'insurance_payment' || desc.startsWith('EOB posting');
		if (!isEob) { continue; }
		const ref = normalizeClaimRef(eobText(desc, 'claim'));
		if (!ref) { continue; }
		const lines = parseEobLineDetail(notes);
		const claimCoins = eobNumber(desc, 'coinsurance') ?? 0;
		const lineCoins = round2([...lines.values()].reduce((s, l) => s + l.coinsurance, 0));
		const sec = parseSecondaryState(notes);
		eobByClaim.set(ref, {
			payer: eobText(desc, 'payer'),
			check: eobText(desc, 'check') || notes.match(/(?:^|\| ?)check=([^|;]+)/)?.[1]?.trim() || '',
			denial: eobText(desc, 'denial'),
			coinsurance: claimCoins > 0 ? claimCoins : lineCoins,
			secondaryPayer: sec.payer || eobText(desc, 'payer2'),
			secondaryPosted: sec.posted,
			lines,
		});
	}

	// Charge side: one card per fee sheet (billed or not).
	const claims: BillingClaim[] = [];
	const usedGroups = new Set<string>();
	let unbilled = 0;
	for (const s of sources.sheets) {
		if (String(s['patientId'] ?? '') !== String(patientId)) { continue; }
		const feeSheetId = String(s['id'] ?? '');
		const claimRef = String(s['claimNumber'] ?? '') || claimNumberForFeeSheet(feeSheetId);
		const norm = normalizeClaimRef(claimRef);
		const group = groupByRef.get(norm);
		if (group) { usedGroups.add(group.key); }
		const billed = /^(billed|paid|eob)/i.test(String(s['billingStatus'] ?? ''));
		const eob = eobByClaim.get(norm);
		const isSelfPay = selfPayRefs.has(norm);

		const items = (s['items'] as Array<Record<string, unknown>>) || [];
		const diagnoses: string[] = [];
		const lines: BillingServiceLine[] = [];
		for (const it of items) {
			const code = String(it['code'] ?? '');
			if (!code) { continue; }
			const description = String(it['description'] ?? '');
			if (String(it['type'] ?? '') === 'ICD10') {
				// allow-any-unicode-next-line
				diagnoses.push(description ? `${code} — ${description}` : code);
				continue;
			}
			const qty = Number(it['qty'] ?? 1) || 1;
			const price = Number(it['price'] ?? 0) || 0;
			const adj = eob?.lines.get(code);
			const lineBilled = round2(price * qty);
			lines.push({
				code, description,
				modifiers: String(it['modifiers'] ?? ''),
				qty, price, billed: lineBilled,
				justify: String(it['justify'] ?? ''),
				adjudicated: !!adj,
				allowed: adj?.allowed ?? 0,
				insPaid: adj?.paid ?? 0,
				// An explicit per-code write-off wins; otherwise it is the
				// contractual difference the payer allowed away.
				writeOff: adj ? (adj.writeOff !== undefined ? adj.writeOff : Math.max(round2(lineBilled - adj.allowed), 0)) : 0,
				copay: adj?.copay ?? 0,
				deductible: adj?.deductible ?? 0,
				coinsurance: adj?.coinsurance ?? 0,
			});
		}

		const charges = group ? group.charges : round2(lines.reduce((sum, l) => sum + l.billed, 0));
		if (!billed && !group) { unbilled += charges; }
		const serviceDate = isoDate(s['encounterDate'] ?? s['serviceDate'] ?? s['dateOfService'] ?? s['createdAt']);
		const lastActivity = group?.lastActivity || isoDate(s['updatedAt'] ?? s['createdAt']) || serviceDate;
		const providerId = String(s['renderingProvider'] ?? '');
		const status = billingStatusOf({
			isUnbilled: !billed && !group,
			hasEob: !!eob,
			denial: eob?.denial || '',
			carriedCoinsurance: eob && !eob.secondaryPosted ? eob.coinsurance : 0,
			balance: group?.balance ?? 0,
			patientDue: group?.patientDue ?? 0,
			isSelfPay,
		});

		claims.push({
			key: `fs-${feeSheetId}`,
			claimRef: billed || group ? claimRef : '',
			feeSheetId,
			encounterId: String(s['encounterId'] ?? ''),
			serviceDate,
			lastActivity,
			sortKey: new Date(lastActivity || serviceDate || 0).getTime(),
			providerName: String(s['renderingProviderName'] ?? '') || opts.providerName?.(providerId) || '',
			// A self-pay claim has no payer by definition — say so rather than
			// naming a coverage record that was deliberately not billed.
			payerName: eob?.payer || (isSelfPay ? 'Self-Pay' : primaryCoverage?.payerName || ''),
			secondaryPayerName: eob?.secondaryPayer || secondaryCoverage?.payerName || '',
			checkNumber: eob?.check || '',
			denialReason: eob?.denial || '',
			carriedCoinsurance: eob && !eob.secondaryPosted ? eob.coinsurance : 0,
			secondaryPosted: eob?.secondaryPosted ?? false,
			diagnoses,
			lines,
			charges,
			insurancePaid: group?.insurancePaid ?? 0,
			adjustments: group?.adjustments ?? 0,
			patientPaid: group?.patientPaid ?? 0,
			patientDue: group?.patientDue ?? 0,
			balance: group?.balance ?? (billed ? charges : 0),
			status,
			events: group?.events ?? [],
			isUnbilled: !billed && !group,
			isCredit: false,
			isSelfPay,
		});
	}

	// Ledger groups with no fee sheet behind them: the patient-credit bucket and
	// any money posted against a claim whose sheet is gone. They still belong on
	// the billing page — the account balance includes them.
	for (const g of groups) {
		if (usedGroups.has(g.key)) { continue; }
		claims.push({
			key: `grp-${g.key}`,
			claimRef: g.isCredit ? '' : g.claimRef,
			feeSheetId: '', encounterId: '',
			serviceDate: g.serviceDate, lastActivity: g.lastActivity, sortKey: g.sortKey,
			providerName: '', payerName: '', secondaryPayerName: '', checkNumber: '', denialReason: '',
			carriedCoinsurance: 0, secondaryPosted: false,
			diagnoses: [], lines: [],
			charges: g.charges, insurancePaid: g.insurancePaid, adjustments: g.adjustments,
			patientPaid: g.patientPaid, patientDue: g.patientDue, balance: g.balance,
			status: g.isCredit ? 'credit' : billingStatusOf({
				isUnbilled: false, hasEob: g.insurancePaid > 0, denial: '',
				carriedCoinsurance: 0, balance: g.balance, patientDue: g.patientDue,
			}),
			events: g.events,
			isUnbilled: false,
			// The fee sheet behind this group is gone, so there is nothing left to
			// prove it was self-pay.
			isSelfPay: false,
			isCredit: g.isCredit,
		});
	}

	claims.sort((a, b) => b.sortKey - a.sortKey || (b.claimRef || '').localeCompare(a.claimRef || ''));

	// Account totals come from the CLAIM rollups (not a second pass over the raw
	// events) so every tile agrees with the sum of the cards under it.
	const real = claims.filter(c => !c.isUnbilled);
	const sum = (pick: (c: BillingClaim) => number) => round2(real.reduce((s, c) => s + pick(c), 0));
	const credit = claims.find(c => c.isCredit);
	return {
		claims, coverage, groups,
		totals: {
			charges: sum(c => c.charges),
			insurancePaid: sum(c => c.insurancePaid),
			adjustments: sum(c => c.adjustments),
			patientPaid: sum(c => c.patientPaid),
			patientDue: sum(c => c.patientDue),
			availableCredit: credit ? round2(Math.max(0, -credit.balance)) : 0,
			outstanding: sum(c => (c.isCredit ? 0 : c.balance)),
			unbilled: round2(unbilled),
		},
	};
}

/** Where a claim sits in the revenue cycle. */
function billingStatusOf(c: { isUnbilled: boolean; hasEob: boolean; denial: string; carriedCoinsurance: number; balance: number; patientDue: number; isSelfPay?: boolean }): BillingClaimStatus {
	if (c.isUnbilled) { return 'unbilled'; }
	if (c.denial) { return 'denied'; }
	if (c.balance < -0.005) { return 'credit'; }
	if (c.balance <= 0.005) { return 'settled'; }
	// Coinsurance carried to the secondary payer is an INSURANCE balance, not
	// patient responsibility — it must not read as "Patient Due" (QA 23-Jul).
	if (c.carriedCoinsurance > 0.005) { return 'insurance-pending'; }
	if (c.patientDue > 0.005) { return 'patient-due'; }
	// A self-pay claim is never waiting on a payer: with no EOB and no recorded
	// due left, whatever remains is simply an open patient balance.
	if (!c.hasEob && !c.isSelfPay) { return 'awaiting-insurance'; }
	return 'open';
}

// allow-any-unicode-next-line
// ── Rendering ──────────────────────────────────────────────────────────────

/** Filter choices in the Billing toolbar — the revenue-cycle stages, in order. */
const STATUS_FILTERS: Array<{ value: string; label: string }> = [
	{ value: '', label: 'All Statuses' },
	{ value: 'unbilled', label: 'Not Billed' },
	{ value: 'awaiting-insurance', label: 'Awaiting Insurance' },
	{ value: 'insurance-pending', label: 'Secondary Pending' },
	{ value: 'denied', label: 'Denied' },
	{ value: 'patient-due', label: 'Patient Due' },
	{ value: 'open', label: 'Open Balance' },
	{ value: 'settled', label: 'Settled' },
];

export interface IRenderPatientBillingOptions {
	/** Patient name used in the statement header. */
	accountName?: string;
	/** Statement (PDF) + Excel downloads — the same two the Ledger offers. */
	exportHost?: ILedgerExportHost;
	/** Hidden-entry storage; only `notify` and `confirmDelete` are used here. */
	actionsHost?: ILedgerActionsHost;
	/** Open the fee sheet behind a claim (chart → Fee Sheet editor). */
	openFeeSheet?: (claim: BillingClaim) => void;
	/** Open Payments → Insurance Posting to post / edit the payer's EOB. */
	openInsurancePosting?: (claim: BillingClaim) => void;
	/** Re-run the whole page (toolbar Refresh). */
	reload?: () => void;
}

const CARD_COLS = '104px 80px minmax(110px,1fr) minmax(100px,1fr) 78px 78px 74px 78px 78px 86px 118px';
/**
 * Widest the claim grid can get before the Status column would be clipped. The
 * chart pane is often narrow (chat panel open, split editor), and the global
 * CSS hides scrollbars — so without an explicit min-width + `overflow-x:auto`
 * host the right-hand money columns silently disappeared off the card edge.
 */
const CARD_MIN_WIDTH = '1000px';
const LINE_MIN_WIDTH = '900px';
const EVENT_MIN_WIDTH = '720px';

/** A horizontally scrollable host for a fixed-width grid table. */
function scrollHost(parent: HTMLElement, minWidth: string): HTMLElement {
	const outer = DOM.append(parent, DOM.$('div'));
	outer.style.cssText = 'overflow-x:auto;overflow-y:hidden;max-width:100%;';
	const inner = DOM.append(outer, DOM.$('div'));
	inner.style.cssText = `min-width:${minWidth};`;
	return inner;
}

/** Render the whole Billing page into `host`. */
export function renderPatientBilling(host: HTMLElement, model: PatientBillingModel, opts: IRenderPatientBillingOptions): void {
	DOM.clearNode(host);
	const doc = host.ownerDocument;

	// allow-any-unicode-next-line
	// ── Account summary ────────────────────────────────────────────────────
	const cards = DOM.append(host, DOM.$('div'));
	cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;';
	const tile = (label: string, value: string, color: string, hint: string) => {
		const c = DOM.append(cards, DOM.$('div'));
		c.title = hint;
		c.style.cssText = `border:1px solid var(--vscode-editorWidget-border);border-top:3px solid ${color};border-radius:8px;padding:10px 14px;background:var(--vscode-editorWidget-background,transparent);`;
		const v = DOM.append(c, DOM.$('div')); v.textContent = value; v.style.cssText = `font-size:18px;font-weight:700;color:${color};`;
		const l = DOM.append(c, DOM.$('div')); l.textContent = label;
		l.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-top:3px;';
	};
	const t = model.totals;
	tile('Total Charges', money(t.charges), 'var(--vscode-foreground)', 'Everything billed to insurance or the patient on this account.');
	tile('Insurance Paid', money(t.insurancePaid), '#3b9edd', 'Primary + secondary payer payments received.');
	tile('Write-offs / Adj', money(t.adjustments), '#8b5cf6', 'Contractual adjustments the patient never owes.');
	tile('Patient Paid', money(t.patientPaid), '#22c55e', 'Money collected from the patient (refunds subtracted).');
	tile('Patient Due Now', money(t.patientDue), '#f59e0b', 'Copay / deductible assigned by an EOB and not yet collected.');
	tile('Available Credit', money(t.availableCredit), '#14b8a6', 'Money collected from the patient that is not yet applied to a visit. It carries forward until it is used up.');
	tile('Unbilled Charges', money(t.unbilled), '#94a3b8', 'Charges captured on a fee sheet that was never sent to billing. Not part of the balance yet.');
	tile('Account Balance', balanceLabel(t.outstanding), t.outstanding > 0.005 ? '#ef4444' : '#22c55e', 'Charges minus insurance payments, adjustments and patient payments.');

	// allow-any-unicode-next-line
	// ── Coverage on file ───────────────────────────────────────────────────
	const cov = DOM.append(host, DOM.$('div'));
	cov.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;';
	const covLabel = DOM.append(cov, DOM.$('span'));
	covLabel.textContent = 'Coverage:';
	covLabel.style.cssText = 'color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;font-size:10px;font-weight:700;';
	if (model.coverage.length === 0) {
		const none = DOM.append(cov, DOM.$('span'));
		// allow-any-unicode-next-line
		none.textContent = 'Self-pay — no insurance on file';
		none.style.cssText = 'padding:3px 10px;border-radius:12px;border:1px dashed var(--vscode-editorWidget-border);color:var(--vscode-descriptionForeground);';
	} else {
		for (const c of model.coverage) {
			const chip = DOM.append(cov, DOM.$('span'));
			// The stored tier is a raw value ("secondary"); the chip is a label.
			const tier = c.tier ? c.tier.charAt(0).toUpperCase() + c.tier.slice(1) : 'Coverage';
			const bits = [tier, c.payerName, c.planName, c.memberId ? `#${c.memberId}` : ''].filter(Boolean);
			// allow-any-unicode-next-line
			chip.textContent = bits.join(' · ');
			chip.title = [c.tier, c.payerName, c.planName, c.memberId && `Member ${c.memberId}`, c.groupNumber && `Group ${c.groupNumber}`, c.status]
				// allow-any-unicode-next-line
				.filter(Boolean).join(' · ');
			chip.style.cssText = 'padding:3px 10px;border-radius:12px;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';
		}
	}

	// allow-any-unicode-next-line
	// ── Toolbar ────────────────────────────────────────────────────────────
	const bar = DOM.append(host, DOM.$('div'));
	bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;';
	const search = DOM.append(bar, DOM.$('input')) as HTMLInputElement;
	search.placeholder = 'Filter by claim #, CPT / ICD code, payer, provider...';
	search.style.cssText = 'flex:0 0 300px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;';

	const statusHost = DOM.append(bar, DOM.$('div'));
	statusHost.style.cssText = 'flex:0 0 178px;position:relative;';
	let statusFilter = '';
	const statusInput = createCustomDropdown({
		parent: statusHost,
		options: STATUS_FILTERS.map(s => ({ value: s.value, label: s.label })),
		initialValue: '',
		placeholder: 'All Statuses',
		triggerStyle: 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;cursor:pointer;',
		onChange: value => { statusFilter = value; statusInput.value = value; apply(); },
	});

	const countEl = DOM.append(bar, DOM.$('span'));
	countEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

	const toolBtn = (label: string, tip: string, primary: boolean): HTMLButtonElement => {
		const b = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
		b.textContent = label;
		b.title = tip;
		b.style.cssText = primary
			? 'padding:5px 12px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;'
			: 'padding:5px 10px;background:transparent;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:11px;';
		return b;
	};
	const expandBtn = toolBtn('Expand All', 'Show the service lines and postings on every claim', false);
	if (opts.reload) {
		toolBtn('Refresh', 'Reload charges and postings', false).addEventListener('click', () => opts.reload?.());
	}
	DOM.append(bar, DOM.$('span')).style.cssText = 'flex:1;';
	if (opts.exportHost) {
		const host2 = opts.exportHost;
		toolBtn('Download Statement (PDF)', 'Save this billing summary as a printable patient statement', true)
			.addEventListener('click', () => void downloadStatement(host2, model, opts.accountName));
		toolBtn('Download Excel', 'Save the billing detail as an Excel (.xlsx) workbook', false)
			.addEventListener('click', () => void downloadWorkbook(host2, model));
	}

	// allow-any-unicode-next-line
	// ── Claim list ─────────────────────────────────────────────────────────
	const tableHost = scrollHost(host, CARD_MIN_WIDTH);
	const headRow = DOM.append(tableHost, DOM.$('div'));
	headRow.style.cssText = `display:grid;grid-template-columns:${CARD_COLS};gap:8px;padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);`;
	for (const h of ['Claim #', 'DOS', 'Provider', 'Payer', 'Charges', 'Ins Paid', 'Adj', 'Pat Paid', 'Pat Due', 'Balance', 'Status']) {
		const c = DOM.append(headRow, DOM.$('div'));
		c.textContent = h;
		if (['Charges', 'Ins Paid', 'Adj', 'Pat Paid', 'Pat Due', 'Balance'].includes(h)) { c.style.textAlign = 'right'; }
	}

	const listEl = DOM.append(tableHost, DOM.$('div'));
	listEl.style.cssText = 'display:flex;flex-direction:column;';

	const expanded = new Set<string>();
	let expandAll = false;

	const matches = (c: BillingClaim, q: string): boolean => {
		if (!q) { return true; }
		const hay = [
			c.claimRef, c.providerName, c.payerName, c.secondaryPayerName, c.checkNumber, c.denialReason,
			STATUS_META[c.status].label, c.serviceDate, usDate(c.serviceDate),
			...c.diagnoses, ...c.lines.map(l => `${l.code} ${l.description}`),
			...c.events.map(e => e.description),
		].join(' ').toLowerCase();
		return hay.includes(q);
	};

	function apply(): void {
		const q = search.value.trim().toLowerCase();
		const rows = model.claims.filter(c => (!statusFilter || c.status === statusFilter) && matches(c, q));
		DOM.clearNode(listEl);
		countEl.textContent = rows.length === model.claims.length
			? `${rows.length} claim${rows.length === 1 ? '' : 's'}`
			: `${rows.length} of ${model.claims.length} claims`;
		if (rows.length === 0) {
			const empty = DOM.append(listEl, DOM.$('div'));
			empty.style.cssText = 'padding:36px 16px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
			const icon = DOM.append(empty, DOM.$('div'));
			// allow-any-unicode-next-line
			icon.textContent = '🧾';
			icon.style.cssText = 'font-size:28px;margin-bottom:8px;';
			const msg = DOM.append(empty, DOM.$('div'));
			msg.textContent = model.claims.length === 0
				? 'No charges billed for this patient yet. Add codes on the Fee Sheet for a visit and use "Send to Billing" to create the first claim.'
				: 'No claims match this filter.';
			return;
		}
		for (const c of rows) { renderClaimCard(listEl, c); }
	}

	function renderClaimCard(parent: HTMLElement, c: BillingClaim): void {
		const meta = STATUS_META[c.status];
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'border-bottom:1px solid var(--vscode-editorWidget-border);';

		const row = DOM.append(card, DOM.$('div'));
		row.style.cssText = `display:grid;grid-template-columns:${CARD_COLS};gap:8px;padding:9px 12px;align-items:center;font-size:12px;cursor:pointer;border-left:3px solid ${meta.color};`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
		row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

		const cell = (text: string, style = ''): HTMLElement => {
			const el = DOM.append(row, DOM.$('div'));
			el.textContent = text;
			el.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${style}`;
			return el;
		};
		const isOpen = () => expandAll || expanded.has(c.key);
		const caret = DOM.append(row, DOM.$('div'));
		caret.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600;overflow:hidden;';
		const arrow = DOM.append(caret, DOM.$('span'));
		// allow-any-unicode-next-line
		arrow.textContent = isOpen() ? '▾' : '▸';
		arrow.style.cssText = 'font-size:10px;opacity:0.7;flex-shrink:0;';
		const refEl = DOM.append(caret, DOM.$('span'));
		// allow-any-unicode-next-line
		refEl.textContent = c.claimRef
			|| (c.isCredit ? 'Credit' : c.isUnbilled ? `Fee Sheet #${c.feeSheetId}` : 'Unlinked');
		refEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		cell(usDate(c.serviceDate));
		// allow-any-unicode-next-line
		cell(c.providerName || '—');
		// Self-pay is asserted ONLY when the claim carries the responsibility record
		// the fee sheet wrote for it (`isSelfPay`). Absence of an EOB and of
		// coverage still proves nothing on its own, and `billedMode` defaults to
		// "cash" on every sheet so it can't be read as self-pay either — for those
		// claims, say nothing.
		// allow-any-unicode-next-line
		const payerCell = cell(c.payerName || '—', c.isSelfPay ? 'color:#f59e0b;font-weight:600;' : '');
		if (c.isSelfPay) {
			payerCell.title = 'Billed directly to the patient — they have no insurance on file, so the full charge is their responsibility. No claim was sent to a payer.';
		} else if (!c.payerName) {
			payerCell.title = 'No payer on the EOB and no coverage on file for this patient.';
		}
		cell(money(c.charges), 'text-align:right;');
		cell(money(c.insurancePaid), 'text-align:right;color:#3b9edd;');
		cell(money(c.adjustments), 'text-align:right;color:#8b5cf6;');
		cell(money(c.patientPaid), 'text-align:right;color:#22c55e;');
		cell(money(c.patientDue), `text-align:right;${c.patientDue > 0.005 ? 'color:#f59e0b;font-weight:600;' : ''}`);
		cell(balanceLabel(c.balance), `text-align:right;font-weight:700;${c.balance > 0.005 ? 'color:#ef4444;' : ''}`);

		const badgeCell = DOM.append(row, DOM.$('div'));
		const badge = DOM.append(badgeCell, DOM.$('span'));
		badge.textContent = meta.label;
		badge.title = meta.hint;
		badge.style.cssText = `display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${meta.color}22;color:${meta.color};border:1px solid ${meta.color}55;white-space:nowrap;`;

		const detail = DOM.append(card, DOM.$('div'));
		detail.style.cssText = 'display:none;padding:4px 16px 16px 30px;background:var(--vscode-editorWidget-background,rgba(127,127,127,0.04));';

		const sync = () => {
			const open = isOpen();
			// allow-any-unicode-next-line
			arrow.textContent = open ? '▾' : '▸';
			detail.style.display = open ? 'block' : 'none';
			if (open && !detail.hasChildNodes()) { renderClaimDetail(detail, c); }
		};
		row.addEventListener('click', () => {
			if (expandAll) {
				// Collapsing one card out of "Expand All" turns the bulk toggle off and
				// keeps every OTHER card open — otherwise the click closed the whole list.
				expandAll = false;
				for (const other of model.claims) { expanded.add(other.key); }
				// allow-any-unicode-next-line
				expandBtn.textContent = 'Expand All';
			}
			if (expanded.has(c.key)) { expanded.delete(c.key); } else { expanded.add(c.key); }
			apply();
		});
		sync();
	}

	function renderClaimDetail(host2: HTMLElement, c: BillingClaim): void {
		// -- Claim facts the header row can't fit --
		const facts: Array<[string, string]> = [];
		if (c.encounterId) { facts.push(['Encounter', c.encounterId]); }
		if (c.feeSheetId) { facts.push(['Fee Sheet', `#${c.feeSheetId}`]); }
		if (c.checkNumber) { facts.push(['Check / EFT', c.checkNumber]); }
		if (c.secondaryPayerName) { facts.push([c.secondaryPosted ? 'Secondary (posted)' : 'Secondary (pending)', c.secondaryPayerName]); }
		// Split the claim's Ins Paid by payer so it reconciles with the per-code
		// Primary Paid column below (which never includes the secondary).
		const secondaryPaid = round2(c.events.filter(e => e.type === 'ins-payment-secondary').reduce((s, e) => s + e.credit, 0));
		if (secondaryPaid > 0.005) {
			facts.push(['Primary paid', money(round2(c.insurancePaid - secondaryPaid))]);
			facts.push(['Secondary paid', money(secondaryPaid)]);
		}
		if (c.carriedCoinsurance > 0.005) { facts.push(['Coinsurance carried to secondary', money(c.carriedCoinsurance)]); }
		if (c.denialReason) { facts.push(['Denial reason', c.denialReason]); }
		if (c.lastActivity) { facts.push(['Last activity', usDate(c.lastActivity)]); }
		if (facts.length) {
			const f = DOM.append(host2, DOM.$('div'));
			f.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 18px;margin:8px 0 12px;font-size:11px;';
			for (const [k, v] of facts) {
				const item = DOM.append(f, DOM.$('div'));
				const kk = DOM.append(item, DOM.$('span'));
				kk.textContent = `${k}: `;
				kk.style.cssText = 'color:var(--vscode-descriptionForeground);';
				const vv = DOM.append(item, DOM.$('span'));
				vv.textContent = v;
				vv.style.cssText = 'font-weight:600;';
			}
		}

		if (c.diagnoses.length) {
			const dx = DOM.append(host2, DOM.$('div'));
			dx.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px;';
			const lbl = DOM.append(dx, DOM.$('span'));
			lbl.textContent = 'Diagnoses';
			lbl.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
			for (const d of c.diagnoses) {
				const chip = DOM.append(dx, DOM.$('span'));
				chip.textContent = d;
				chip.style.cssText = 'padding:2px 8px;border-radius:10px;font-size:10.5px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';
			}
		}

		// -- Service lines: what was billed, and what the payer did with each code --
		if (c.lines.length) {
			section(host2, 'Service Lines', 'Every billable code on the fee sheet, adjudicated by the PRIMARY payer. The claim totals in the row above include the secondary payer too.');
			const LINE_COLS = '80px minmax(150px,1fr) 62px 42px 76px 76px 84px 76px 80px 70px';
			const table = scrollHost(host2, LINE_MIN_WIDTH);
			table.style.cssText += 'font-size:11.5px;';
			const head = DOM.append(table, DOM.$('div'));
			head.style.cssText = `display:grid;grid-template-columns:${LINE_COLS};gap:6px;padding:5px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);`;
			// "Primary Paid", not "Ins Paid": the per-code figures come from the
			// primary payer's EOB only (the secondary EOB is stored per code in a
			// separate `sl=` segment), so a column called "Ins Paid" here would
			// disagree with the claim's Ins Paid total whenever a secondary paid.
			for (const h of ['Code', 'Description', 'Modifiers', 'Qty', 'Billed', 'Allowed', 'Primary Paid', 'Write-off', 'Copay/Ded', 'Coins']) {
				const hc = DOM.append(head, DOM.$('div'));
				hc.textContent = h;
				if (h !== 'Code' && h !== 'Description' && h !== 'Modifiers') { hc.style.textAlign = 'right'; }
			}
			for (const l of c.lines) {
				const r = DOM.append(table, DOM.$('div'));
				r.style.cssText = `display:grid;grid-template-columns:${LINE_COLS};gap:6px;padding:5px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);`;
				const lc = (text: string, style = '') => {
					const el = DOM.append(r, DOM.$('div'));
					el.textContent = text;
					el.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${style}`;
					el.title = text;
				};
				lc(l.code, 'font-weight:600;');
				// allow-any-unicode-next-line
				lc(l.description || '—');
				// allow-any-unicode-next-line
				lc(l.modifiers || '—');
				lc(String(l.qty), 'text-align:right;');
				lc(money(l.billed), 'text-align:right;');
				// An un-adjudicated line shows a dash, not $0.00 — "the payer allowed
				// nothing" and "the payer hasn't answered yet" are different facts.
				// allow-any-unicode-next-line
				lc(l.adjudicated ? money(l.allowed) : '—', 'text-align:right;');
				// allow-any-unicode-next-line
				lc(l.adjudicated ? money(l.insPaid) : '—', 'text-align:right;color:#3b9edd;');
				// allow-any-unicode-next-line
				lc(l.adjudicated ? money(l.writeOff) : '—', 'text-align:right;color:#8b5cf6;');
				// allow-any-unicode-next-line
				lc(l.adjudicated ? money(round2(l.copay + l.deductible)) : '—', 'text-align:right;color:#f59e0b;');
				// allow-any-unicode-next-line
				lc(l.adjudicated ? money(l.coinsurance) : '—', 'text-align:right;');
			}
			const totalRow = DOM.append(table, DOM.$('div'));
			totalRow.style.cssText = `display:grid;grid-template-columns:${LINE_COLS};gap:6px;padding:6px 8px;font-weight:700;`;
			const tc = (text: string, style = '') => {
				const el = DOM.append(totalRow, DOM.$('div'));
				el.textContent = text;
				el.style.cssText = style;
			};
			tc('Total'); tc(''); tc(''); tc('');
			tc(money(round2(c.lines.reduce((s, l) => s + l.billed, 0))), 'text-align:right;');
			tc(money(round2(c.lines.reduce((s, l) => s + l.allowed, 0))), 'text-align:right;');
			tc(money(round2(c.lines.reduce((s, l) => s + l.insPaid, 0))), 'text-align:right;color:#3b9edd;');
			tc(money(round2(c.lines.reduce((s, l) => s + l.writeOff, 0))), 'text-align:right;color:#8b5cf6;');
			tc(money(round2(c.lines.reduce((s, l) => s + l.copay + l.deductible, 0))), 'text-align:right;color:#f59e0b;');
			tc(money(round2(c.lines.reduce((s, l) => s + l.coinsurance, 0))), 'text-align:right;');
		}

		// -- Postings: the money that moved on this claim, in workflow order --
		if (c.events.length) {
			section(host2, 'Activity', 'Every posting behind the numbers above, in the order a biller works the claim.');
			const EV_COLS = '84px 148px minmax(170px,1fr) 84px 88px 88px';
			const table = scrollHost(host2, EVENT_MIN_WIDTH);
			table.style.cssText += 'font-size:11.5px;';
			const head = DOM.append(table, DOM.$('div'));
			head.style.cssText = `display:grid;grid-template-columns:${EV_COLS};gap:6px;padding:5px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);`;
			for (const h of ['Date', 'Type', 'Description', 'Charge', 'Payment', 'Balance']) {
				const hc = DOM.append(head, DOM.$('div'));
				hc.textContent = h;
				if (['Charge', 'Payment', 'Balance'].includes(h)) { hc.style.textAlign = 'right'; }
			}
			for (const e of c.events) {
				const r = DOM.append(table, DOM.$('div'));
				r.style.cssText = `display:grid;grid-template-columns:${EV_COLS};gap:6px;padding:5px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);`;
				const ec = (text: string, style = '') => {
					const el = DOM.append(r, DOM.$('div'));
					el.textContent = text;
					el.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${style}`;
					el.title = text;
				};
				ec(usDate(e.date));
				ec(EVENT_LABEL[e.type] || e.type, 'font-weight:600;');
				// allow-any-unicode-next-line
				ec(e.description || '—');
				// allow-any-unicode-next-line
				ec(e.debit > 0 ? money(e.debit) : '—', 'text-align:right;');
				// A patient-portion row is informational — it is due, not paid, so it
				// moves no balance. Show it in the "due" colour, not as a payment.
				// allow-any-unicode-next-line
				ec(e.credit > 0 ? money(e.credit) : e.info > 0 ? `${money(e.info)} due` : '—',
					`text-align:right;${e.info > 0 && e.credit === 0 ? 'color:#f59e0b;' : e.credit > 0 ? 'color:#22c55e;' : ''}`);
				ec(balanceLabel(e.claimBalance), 'text-align:right;font-weight:600;');
			}
		}

		// -- Row actions --
		const actions = DOM.append(host2, DOM.$('div'));
		actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;';
		const act = (label: string, tip: string, run: () => void) => {
			const b = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			b.title = tip;
			b.style.cssText = 'padding:4px 12px;background:transparent;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;color:var(--vscode-foreground);cursor:pointer;font-size:11px;';
			b.addEventListener('click', ev => { ev.stopPropagation(); run(); });
		};
		if (opts.openFeeSheet && c.feeSheetId) {
			act(c.isUnbilled ? 'Open Fee Sheet (send to billing)' : 'Open Fee Sheet', 'Open the fee sheet for this visit — the charges behind this claim.', () => opts.openFeeSheet?.(c));
		}
		// A self-pay claim is deliberately absent from Insurance Posting, so offering
		// to post an EOB against it would send the biller to a screen that does not
		// list it. An already-posted EOB still gets its Edit action.
		const hasEobPosting = c.events.some(e => e.type === 'ins-payment');
		if (opts.openInsurancePosting && !c.isUnbilled && !c.isCredit && (hasEobPosting || !c.isSelfPay)) {
			act(hasEobPosting ? 'Edit EOB Posting' : 'Post Insurance Payment',
				'Open Payments → Insurance Posting to record an EOB against this claim.',
				() => opts.openInsurancePosting?.(c));
		}
		if (c.isUnbilled) {
			const note = DOM.append(actions, DOM.$('span'));
			note.textContent = 'These charges are not on a claim yet.';
			note.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);align-self:center;';
		} else if (c.isSelfPay && !hasEobPosting) {
			const note = DOM.append(actions, DOM.$('span'));
			note.textContent = 'Self-pay — collect the balance in Payments → Dashboard. To bill this to insurance instead, add the coverage, then re-send the fee sheet with Bill To set to "Insurance Claim".';
			note.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);align-self:center;';
		}
	}

	function section(parent: HTMLElement, title: string, hint: string): void {
		const h = DOM.append(parent, DOM.$('div'));
		h.textContent = title;
		h.title = hint;
		h.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin:12px 0 4px;';
	}

	expandBtn.addEventListener('click', () => {
		expandAll = !expandAll;
		if (!expandAll) { expanded.clear(); }
		expandBtn.textContent = expandAll ? 'Collapse All' : 'Expand All';
		apply();
	});
	search.addEventListener('input', () => apply());
	// Keep the hidden dropdown value in sync when the page is re-rendered.
	statusInput.value = statusFilter;
	doc.defaultView?.setTimeout(() => search.focus(), 0);
	apply();
}

const EVENT_LABEL: Record<string, string> = {
	'charge': 'Charge',
	'ins-payment': 'Insurance Payment',
	'ins-payment-secondary': 'Secondary Ins Payment',
	'writeoff': 'Write-off / Adj',
	'patient-payment': 'Patient Payment',
	'patient-portion': 'Patient Portion Due',
	'patient-credit': 'Credit Collected',
	'credit-applied': 'Paid from Credit',
	'credit-drawdown': 'Credit Drawdown',
};

/**
 * Statement + workbook reuse the LEDGER's builders (same document the Ledger
 * page and the Payments editor produce) so a patient never receives two
 * differently-formatted statements from the same practice.
 */
async function downloadStatement(host: ILedgerExportHost, model: PatientBillingModel, accountName?: string): Promise<void> {
	try {
		let info: ILedgerStatementInfo | undefined;
		if (host.loadStatementInfo) {
			const ids = [...new Set(model.groups.map(g => g.patientId).filter(Boolean))];
			info = await host.loadStatementInfo(ids);
		}
		const html = ledgerStatementHtml(model.groups, { accountName, info });
		const stamp = new Date().toISOString().slice(0, 10);
		await host.savePdf(`statement-${stamp}.pdf`, html, LEDGER_STATEMENT_PRINT_CSS);
	} catch (e) {
		host.notify(`Could not build the statement: ${e instanceof Error ? e.message : String(e)}`);
	}
}

async function downloadWorkbook(host: ILedgerExportHost, model: PatientBillingModel): Promise<void> {
	try {
		const data = ledgerWorkbook(model.groups, false);
		const stamp = new Date().toISOString().slice(0, 10);
		await host.saveWorkbook(`billing-${stamp}.xlsx`, data);
	} catch (e) {
		host.notify(`Could not build the workbook: ${e instanceof Error ? e.message : String(e)}`);
	}
}
