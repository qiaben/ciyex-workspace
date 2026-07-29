/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { claimNumberForFeeSheet } from '../billing/edi837.js';
import { buildXlsx, IXlsxColumn, XlsxRow } from '../billing/xlsx.js';
import { findWorkbenchRoot } from '../customDropdown.js';
import { CREDIT_CLAIM_REF, isCreditApplication, isCreditTransaction } from './patientCredit.js';

/**
 * Shared patient-ledger view: one financial record built from the billed fee
 * sheets (charges) and the payment transactions (insurance postings, patient
 * payments, write-offs, patient portions). Used by BOTH the Payments editor's
 * Ledger tab (all patients) and the patient chart's Financial > Ledger page
 * (one patient) so the two stay identical.
 *
 * The ledger reads CLAIM-FIRST (QA 27-Jul: "make one claim means all the
 * transaction include that"): every claim is one card showing what was charged,
 * what insurance paid, what was written off, what the patient paid and what is
 * still owed, and it expands to the individual postings behind those numbers.
 * The old flat, newest-first event list with a per-patient running balance was
 * the reason the balance column "did not show properly" — in an all-patients
 * list the running total jumped between patients on adjacent rows.
 *
 * The EOB `key=value` description fields and the notes `sec=`/`sl=` segments
 * parsed here are written by the Insurance Posting flow in clinicalEditors.ts
 * (_saveEobPosting / _postSecondaryEob) — that file is the encoding's source
 * of truth.
 */

/**
 * `patient-credit` / `credit-applied` / `credit-drawdown` are the copay
 * auto-deductible postings (see patientCredit.ts). A credit collected at the
 * front desk is real money on the account (`patient-credit`), and every later
 * deduction produces a PAIR of postings so the money is never counted twice:
 * `credit-applied` credits the claim it settles, `credit-drawdown` debits the
 * credit bucket by the same amount. Net effect on the account balance is zero -
 * the money was already counted when it was collected.
 */
export type LedgerEventType = 'charge' | 'ins-payment' | 'ins-payment-secondary' | 'writeoff' | 'patient-payment' | 'patient-portion'
	| 'patient-credit' | 'credit-applied' | 'credit-drawdown';

export interface LedgerEvent {
	/** Stable per-entry id (type + patient + claim + date + amounts) used to persist local deletes. */
	id: string;
	/** ISO date (yyyy-mm-dd) the event happened (posting / transaction date). */
	date: string;
	/** ISO date of the underlying service / encounter (DOS); '' when it can't be resolved. */
	serviceDate: string;
	/** Millisecond timestamp for ordering (events on the same day keep charge then payment order). */
	sortKey: number;
	patientId: string;
	patientName: string;
	type: LedgerEventType;
	claimRef: string;
	description: string;
	/** Amount charged to the account (increases the balance). */
	debit: number;
	/** Amount paid / adjusted off the account (reduces the balance). */
	credit: number;
	/** Informational amount for patient-portion rows — due, not yet paid, so it moves no balance. */
	info: number;
	/** Service codes billed on a charge posting; absent on money postings. */
	codes?: string;
	/** Running balance of THIS PATIENT's account after the event. */
	balance: number;
	/** Running balance of THIS CLAIM after the event (what the claim card expands to show). */
	claimBalance: number;
}

export interface LedgerTotals {
	charges: number;
	insurancePaid: number;
	patientPaid: number;
	adjustments: number;
	patientPortionDue: number;
	outstanding: number;
	/** Unapplied patient credit still sitting on the account (carried forward). */
	availableCredit: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

/** Parse a `key=value` number out of an EOB posting description. */
function descField(description: string, field: string): number | undefined {
	const m = description.match(new RegExp(`${field}=(-?\\d+(?:\\.\\d+)?)`));
	return m ? Number(m[1]) : undefined;
}

/** Parse a `key=value` string out of an EOB posting description. */
function descText(description: string, field: string): string {
	return description.match(new RegExp(`${field}=([^;|]+)`))?.[1]?.trim() || '';
}

/** Total the secondary payer's payments out of the notes `sl=` segment (0 when not posted). */
function secondaryPaid(notes: string): { payer: string; check: string; paid: number; posted: boolean } {
	const raw = String(notes ?? '');
	const sec = raw.match(/(?:^|\| ?)sec=([^|]+)/);
	if (!sec) { return { payer: '', check: '', paid: 0, posted: false }; }
	const [payer, check, , posted] = sec[1].split('~');
	let paid = 0;
	const sl = raw.match(/(?:^|\| ?)sl=([^|]+)/);
	if (sl) {
		for (const part of sl[1].split(';')) {
			const seg = part.split('~');
			paid += Number(seg[2]) || 0;
		}
	}
	return { payer: (payer || '').trim(), check: (check || '').trim(), paid: round2(paid), posted: posted?.trim() === '1' };
}

function isoDate(value: unknown): string {
	const s = String(value ?? '');
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) { return s.slice(0, 10); }
	const t = new Date(s).getTime();
	if (Number.isFinite(t)) { return new Date(t).toISOString().slice(0, 10); }
	return '';
}

function usDate(iso: string): string {
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	// allow-any-unicode-next-line
	return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '—');
}

function listOf(payload: unknown): Array<Record<string, unknown>> {
	const p = payload as { data?: unknown; content?: unknown } | unknown[] | null;
	const w = (p as { data?: unknown })?.data ?? p;
	const list = (w as { content?: unknown })?.content ?? w;
	return Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
}

/**
 * Build the ledger events from the fee sheets + payment transactions.
 * With `patientId` set only that patient's events are returned; the running
 * balance is always computed per patient either way.
 */
export async function buildLedgerEvents(apiService: ICiyexApiService, patientId?: string): Promise<LedgerEvent[]> {
	const [txnsRaw, sheetsRaw] = await Promise.all([
		apiService.fetch('/api/payments/transactions').then(async r => r.ok ? await r.json() : null).catch(() => null),
		apiService.fetch('/api/fee-sheets').then(async r => r.ok ? await r.json() : null).catch(() => null),
	]);
	const txns = listOf(txnsRaw);
	const sheets = listOf(sheetsRaw);

	const events: LedgerEvent[] = [];
	const wanted = (pid: string) => !patientId || String(pid) === String(patientId);
	// claimRef -> date of service, so payment/EOB rows can show the DOS of the
	// charge they settle even though the transaction record only has a post date.
	const serviceDateByClaim = new Map<string, string>();
	// encounter id / fee-sheet id -> claim ref. A payment transaction has no
	// fee-sheet column, so Dashboard collections identify themselves only through
	// their description ("Encounter 15868 — …"). Without this map those payments
	// landed under "Unlinked activity" and the claim they settled kept showing the
	// full balance, which is why the ledger and the Dashboard disagreed.
	const claimByRef = new Map<string, string>();

	// -- Charges: every billed fee sheet is a charge on the patient account --
	for (const s of sheets) {
		// A sheet that already carries collected money belongs on the ledger even
		// if its billing status was never advanced past "Unbilled" — otherwise the
		// payment credit landed with no matching charge and drove the running
		// balance negative (QA 27-Jul: "balance also not properly showing").
		const billed = /^(billed|paid|eob)/i.test(String(s['billingStatus'] ?? ''));
		const collected = Number(s['totalPaid'] ?? s['paidAmount'] ?? 0) || 0;
		if (!billed && collected <= 0) { continue; }
		const pid = String(s['patientId'] ?? '');
		if (!wanted(pid)) { continue; }
		const items = (s['items'] as Array<Record<string, unknown>>) || [];
		const codes: string[] = [];
		let charge = 0;
		for (const it of items) {
			if (String(it['type'] ?? '') === 'ICD10' || !it['code']) { continue; }
			codes.push(String(it['code']));
			charge += (Number(it['price'] ?? 0) || 0) * (Number(it['qty'] ?? 1) || 1);
		}
		charge = round2(charge);
		if (charge <= 0) { continue; }
		const date = isoDate(s['billedAt'] ?? s['encounterDate'] ?? s['serviceDate'] ?? s['updatedAt'] ?? s['createdAt']);
		const serviceDate = isoDate(s['serviceDate'] ?? s['encounterDate'] ?? s['dateOfService'] ?? s['billedAt'] ?? s['createdAt']);
		const claimRef = String(s['claimNumber'] ?? '') || claimNumberForFeeSheet(String(s['id'] ?? ''));
		if (claimRef && serviceDate) { serviceDateByClaim.set(claimRef, serviceDate); }
		if (claimRef) {
			if (s['id'] !== undefined && s['id'] !== null) { claimByRef.set(String(s['id']).toLowerCase(), claimRef); }
			if (s['encounterId']) { claimByRef.set(String(s['encounterId']).toLowerCase(), claimRef); }
		}
		events.push({
			id: '', date, serviceDate, sortKey: new Date(date || 0).getTime(),
			patientId: pid, patientName: String(s['patientName'] ?? ''),
			type: 'charge',
			claimRef,
			// allow-any-unicode-next-line
			description: `Charges billed — ${codes.join(', ') || 'services'}`,
			codes: codes.join(', '),
			debit: charge, credit: 0, info: 0, balance: 0, claimBalance: 0,
		});
	}

	// -- Transactions: insurance postings, patient payments, patient portions --
	for (const t of txns) {
		const pid = String(t['patientId'] ?? '');
		if (!wanted(pid)) { continue; }
		const desc = String(t['description'] ?? '');
		const notes = String(t['notes'] ?? '');
		const patientName = String(t['patientName'] ?? '');
		const status = String(t['status'] ?? '').toLowerCase();
		const date = isoDate(t['collectedAt'] ?? t['transactionDate'] ?? t['createdAt']);
		const sortKey = new Date(date || 0).getTime() + 1; // same-day payments sort after the charge
		const amount = Number(t['amount']) || 0;
		const isEob = String(t['transactionType'] ?? '') === 'insurance_payment' || desc.startsWith('EOB posting');

		// DOS of the settled claim (falls back to the transaction's own date when unknown).
		const svc = (ref: string) => serviceDateByClaim.get(ref) || isoDate(t['serviceDate'] ?? t['dateOfService']) || '';

		// Money collected but not yet attached to a claim: it sits on the account
		// as available credit until a copay comes due (patientCredit.ts).
		if (isCreditTransaction(t)) {
			if (status === 'completed' && amount > 0) {
				events.push({
					id: '', date, serviceDate: isoDate(t['serviceDate'] ?? t['dateOfService']), sortKey,
					patientId: pid, patientName, type: 'patient-credit', claimRef: CREDIT_CLAIM_REF,
					description: desc || `Patient credit (${String(t['paymentMethodType'] ?? 'payment')})`,
					debit: 0, credit: round2(amount), info: 0, balance: 0, claimBalance: 0,
				});
			} else if (status === 'refunded' && amount > 0) {
				events.push({
					id: '', date, serviceDate: '', sortKey, patientId: pid, patientName,
					type: 'credit-drawdown', claimRef: CREDIT_CLAIM_REF,
					// allow-any-unicode-next-line
					description: `Credit refunded to patient — ${desc || 'unused credit'}`,
					debit: round2(amount), credit: 0, info: 0, balance: 0, claimBalance: 0,
				});
			}
			continue;
		}

		// A copay auto-paid out of the credit balance. Two postings, so the claim
		// gets the money without the account being credited a second time.
		if (isCreditApplication(t) && status === 'completed' && amount > 0) {
			const creditClaim = String(t['claimId'] ?? '') || desc.match(/claim[= ]([A-Za-z0-9-]+)/)?.[1] || '';
			const isRefund = /refund=1/.test(notes) || String(t['transactionType'] ?? '') === 'refund';
			if (!isRefund) {
				events.push({
					id: '', date, serviceDate: svc(creditClaim), sortKey: sortKey + 3, patientId: pid, patientName,
					type: 'credit-applied', claimRef: creditClaim,
					description: desc || 'Copay paid from patient credit',
					debit: 0, credit: round2(amount), info: 0, balance: 0, claimBalance: 0,
				});
			}
			events.push({
				id: '', date, serviceDate: '', sortKey: sortKey + 2, patientId: pid, patientName,
				type: 'credit-drawdown', claimRef: CREDIT_CLAIM_REF,
				description: isRefund
					// allow-any-unicode-next-line
					? `Credit refunded to patient — ${money(amount)}`
					// allow-any-unicode-next-line
					: `Applied to ${creditClaim ? `claim ${creditClaim}` : 'a visit copay'} — ${money(amount)}`,
				debit: round2(amount), credit: 0, info: 0, balance: 0, claimBalance: 0,
			});
			continue;
		}

		if (isEob) {
			const claimRef = descText(desc, 'claim');
			const payer = descText(desc, 'payer');
			const check = descText(desc, 'check');
			const sec = secondaryPaid(notes);
			const combinedPaid = descField(desc, 'paid') ?? amount;
			const primaryPaid = round2(combinedPaid - (sec.posted ? sec.paid : 0));
			const writeOff = descField(desc, 'writeoff') ?? 0;
			if (primaryPaid > 0) {
				events.push({
					id: '', date, serviceDate: svc(claimRef), sortKey, patientId: pid, patientName, type: 'ins-payment', claimRef,
					// allow-any-unicode-next-line
					description: `Insurance payment — ${payer || 'payer'}${check ? `, check ${check}` : ''}`,
					debit: 0, credit: primaryPaid, info: 0, balance: 0, claimBalance: 0,
				});
			}
			if (sec.posted && sec.paid > 0) {
				events.push({
					id: '', date, serviceDate: svc(claimRef), sortKey: sortKey + 1, patientId: pid, patientName, type: 'ins-payment-secondary', claimRef,
					// allow-any-unicode-next-line
					description: `Secondary insurance payment — ${sec.payer || 'secondary payer'}${sec.check ? `, check ${sec.check}` : ''}`,
					debit: 0, credit: sec.paid, info: 0, balance: 0, claimBalance: 0,
				});
			}
			if (writeOff > 0) {
				events.push({
					id: '', date, serviceDate: svc(claimRef), sortKey: sortKey + 2, patientId: pid, patientName, type: 'writeoff', claimRef,
					// allow-any-unicode-next-line
					description: `Contractual write-off / adjustment — ${payer || 'payer'}`,
					debit: 0, credit: writeOff, info: 0, balance: 0, claimBalance: 0,
				});
			}
			continue;
		}

		// Pending patient-responsibility records = the PATIENT PORTION still due.
		// Resolve the claim from every reference a transaction can carry: an
		// explicit `claimId`, "claim CLM-0018" in the description, or the encounter
		// / fee-sheet id a Dashboard collection names instead.
		const claimFromDesc = String(t['claimId'] ?? '')
			|| desc.match(/claim[= ]([A-Za-z0-9]+-?\d+)/)?.[1]
			|| claimByRef.get((desc.match(/encounter\s+([A-Za-z0-9-]+)/i)?.[1] || '').toLowerCase())
			|| claimByRef.get(String(t['feeSheetId'] ?? '').toLowerCase())
			|| claimByRef.get(String(t['encounterId'] ?? '').toLowerCase())
			|| '';
		if (status === 'pending' && ['copay', 'deductible', 'coinsurance'].includes(String(t['transactionType'] ?? ''))) {
			events.push({
				id: '', date, serviceDate: svc(claimFromDesc), sortKey: sortKey + 3, patientId: pid, patientName, type: 'patient-portion', claimRef: claimFromDesc,
				description: desc || 'Patient responsibility due',
				debit: 0, credit: 0, info: round2(amount), balance: 0, claimBalance: 0,
			});
			continue;
		}

		// Actual patient money: completed payments credit the account, refunds re-open it.
		if (status === 'completed' && amount > 0) {
			events.push({
				id: '', date, serviceDate: svc(claimFromDesc), sortKey: sortKey + 3, patientId: pid, patientName, type: 'patient-payment', claimRef: claimFromDesc,
				description: desc || `Patient payment (${String(t['paymentMethodType'] ?? 'payment')})`,
				debit: 0, credit: round2(amount), info: 0, balance: 0, claimBalance: 0,
			});
		} else if (status === 'refunded' && amount > 0) {
			events.push({
				id: '', date, serviceDate: svc(claimFromDesc), sortKey: sortKey + 3, patientId: pid, patientName, type: 'patient-payment', claimRef: claimFromDesc,
				// allow-any-unicode-next-line
				description: `Refund to patient — ${desc || 'refunded payment'}`,
				debit: round2(amount), credit: 0, info: 0, balance: 0, claimBalance: 0,
			});
		}
	}

	// -- Per-patient + per-claim running balances, oldest to newest --
	events.sort((a, b) => a.sortKey - b.sortKey);
	assignBalances(events);
	const idSeen = new Map<string, number>();
	for (const e of events) {
		// Stable id (survives reloads) so a local delete keeps hiding the same row.
		const base = `${e.type}|${e.patientId}|${e.claimRef}|${e.date}|${e.debit}|${e.credit}|${e.info}`;
		const n = (idSeen.get(base) || 0) + 1;
		idSeen.set(base, n);
		e.id = n > 1 ? `${base}#${n}` : base;
	}
	// Newest first for display.
	events.reverse();
	return events;
}

/** Assign per-patient and per-claim running balances over an OLDEST-FIRST list. */
function assignBalances(oldestFirst: LedgerEvent[]): void {
	const byPatient = new Map<string, number>();
	const byClaim = new Map<string, number>();
	for (const e of oldestFirst) {
		const delta = e.debit - e.credit;
		const p = round2((byPatient.get(e.patientId) || 0) + delta);
		byPatient.set(e.patientId, p);
		e.balance = p;
		const ck = claimKey(e);
		const c = round2((byClaim.get(ck) || 0) + delta);
		byClaim.set(ck, c);
		e.claimBalance = c;
	}
}

/** Recompute running balances over a newest-first event list (used after local deletes). */
function recomputeBalances(newestFirst: LedgerEvent[]): void {
	assignBalances([...newestFirst].reverse());
}

/** Column totals across a set of ledger events. */
export function ledgerTotals(events: LedgerEvent[]): LedgerTotals {
	let charges = 0; let insurancePaid = 0; let patientPaid = 0; let adjustments = 0; let portion = 0;
	let creditIn = 0; let creditOut = 0;
	for (const e of events) {
		switch (e.type) {
			case 'charge': charges += e.debit; break;
			case 'ins-payment':
			case 'ins-payment-secondary': insurancePaid += e.credit; break;
			case 'writeoff': adjustments += e.credit; break;
			case 'patient-payment': patientPaid += e.credit - e.debit; break;
			case 'patient-portion': portion += e.info; break;
			// Credit collected is real money in; the drawdown that funds a claim's
			// `credit-applied` posting takes it straight back out, so the pair nets
			// to zero and only the UNAPPLIED remainder shows as patient money.
			case 'patient-credit': patientPaid += e.credit; creditIn += e.credit; break;
			case 'credit-applied': patientPaid += e.credit; break;
			case 'credit-drawdown': patientPaid -= e.debit; creditOut += e.debit; break;
		}
	}
	return {
		charges: round2(charges),
		insurancePaid: round2(insurancePaid),
		patientPaid: round2(patientPaid),
		adjustments: round2(adjustments),
		patientPortionDue: round2(portion),
		outstanding: round2(charges - insurancePaid - adjustments - patientPaid),
		availableCredit: round2(Math.max(0, creditIn - creditOut)),
	};
}

const TYPE_META: Record<LedgerEventType, { label: string; color: string }> = {
	'charge': { label: 'Charge', color: '#3b82f6' },
	'ins-payment': { label: 'Insurance Payment', color: '#3b9edd' },
	'ins-payment-secondary': { label: 'Secondary Ins Payment', color: '#8b5cf6' },
	'writeoff': { label: 'Write-off / Adj', color: '#a78bfa' },
	'patient-payment': { label: 'Patient Payment', color: '#22c55e' },
	'patient-portion': { label: 'Patient Portion Due', color: '#f59e0b' },
	'patient-credit': { label: 'Credit Collected', color: '#14b8a6' },
	'credit-applied': { label: 'Paid from Credit', color: '#0ea5e9' },
	'credit-drawdown': { label: 'Credit Drawdown', color: '#14b8a6' },
};

/**
 * Order the postings inside a claim card read in, top to bottom: the charge
 * comes first, then the money that settles it in the sequence a biller works
 * it (primary EOB, secondary EOB, contractual write-off, patient payment) and
 * finally what the patient still owes (QA 29-Jul). A newest-first list put the
 * charge — the thing every other row refers to — at the BOTTOM of the card.
 */
const TYPE_ORDER: Record<LedgerEventType, number> = {
	'charge': 0,
	'ins-payment': 1,
	'ins-payment-secondary': 2,
	'writeoff': 3,
	'credit-applied': 4,
	'patient-payment': 5,
	'patient-portion': 6,
	// Credit-bucket postings only ever appear inside the CREDIT card, where the
	// collected credit must come before the drawdowns that spend it.
	'patient-credit': 0,
	'credit-drawdown': 1,
};

/** Workflow order first, then oldest-to-newest inside a type (repeat postings keep their sequence). */
function compareForClaimCard(a: LedgerEvent, b: LedgerEvent): number {
	return (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || (a.sortKey - b.sortKey);
}

// allow-any-unicode-next-line
// ── Claim grouping ─────────────────────────────────────────────────────────

/** Grouping key: a claim belongs to exactly one patient. */
function claimKey(e: LedgerEvent): string {
	return `${e.patientId}|${e.claimRef || 'unlinked'}`;
}

export type LedgerClaimStatus = 'paid' | 'patient-due' | 'awaiting-insurance' | 'open' | 'credit';

/** One claim (or a patient's unlinked activity) with every posting behind it. */
export interface LedgerClaimGroup {
	key: string;
	claimRef: string;
	patientId: string;
	patientName: string;
	/** Date of service of the claim's charge (falls back to the earliest posting). */
	serviceDate: string;
	/** Most recent posting date in the group — the list is ordered by this. */
	lastActivity: string;
	sortKey: number;
	/** Postings in workflow order: charge, insurance, secondary, write-off, patient payment, patient due. */
	events: LedgerEvent[];
	charges: number;
	insurancePaid: number;
	adjustments: number;
	patientPaid: number;
	/** Patient responsibility still sitting unpaid (pending copay/deductible/coinsurance). */
	patientDue: number;
	/** charges - insurance - adjustments - patient payments. */
	balance: number;
	status: LedgerClaimStatus;
	/** True for the synthetic "patient credit on account" card (no claim behind it). */
	isCredit: boolean;
}

const STATUS_META: Record<LedgerClaimStatus, { label: string; color: string }> = {
	'paid': { label: 'Settled', color: '#22c55e' },
	'patient-due': { label: 'Patient Due', color: '#f59e0b' },
	'awaiting-insurance': { label: 'Awaiting Insurance', color: '#3b9edd' },
	'open': { label: 'Open Balance', color: '#ef4444' },
	'credit': { label: 'Credit Balance', color: '#14b8a6' },
};

/**
 * Money owed reads as a plain amount; money the account is AHEAD by reads as a
 * credit ("$25.00 CR") rather than a bare minus sign, which billers misread as
 * a broken balance.
 */
function balanceLabel(balance: number): string {
	return balance < -0.005 ? `${money(Math.abs(balance))} CR` : money(Math.max(balance, 0));
}

/** Roll a flat event list up into one entry per claim, newest activity first. */
export function groupLedgerByClaim(events: LedgerEvent[]): LedgerClaimGroup[] {
	const groups = new Map<string, LedgerClaimGroup>();
	for (const e of events) {
		const key = claimKey(e);
		let g = groups.get(key);
		if (!g) {
			g = {
				key, claimRef: e.claimRef, patientId: e.patientId, patientName: e.patientName,
				serviceDate: '', lastActivity: '', sortKey: 0, events: [],
				charges: 0, insurancePaid: 0, adjustments: 0, patientPaid: 0, patientDue: 0,
				balance: 0, status: 'open', isCredit: e.claimRef === CREDIT_CLAIM_REF,
			};
			groups.set(key, g);
		}
		if (!g.patientName && e.patientName) { g.patientName = e.patientName; }
		g.events.push(e);
		if (e.sortKey > g.sortKey) { g.sortKey = e.sortKey; g.lastActivity = e.date; }
		if (e.type === 'charge' && e.serviceDate) { g.serviceDate = e.serviceDate; }
		else if (!g.serviceDate && e.serviceDate) { g.serviceDate = e.serviceDate; }
		switch (e.type) {
			case 'charge': g.charges += e.debit; break;
			case 'ins-payment':
			case 'ins-payment-secondary': g.insurancePaid += e.credit; break;
			case 'writeoff': g.adjustments += e.credit; break;
			case 'patient-payment': g.patientPaid += e.credit - e.debit; break;
			case 'patient-portion': g.patientDue += e.info; break;
			// On the credit card these read as money in / money spent; on a claim
			// card `credit-applied` is just another patient payment.
			case 'patient-credit':
			case 'credit-applied': g.patientPaid += e.credit; break;
			case 'credit-drawdown': g.patientPaid -= e.debit; break;
		}
	}
	const out = [...groups.values()];
	for (const g of out) {
		g.charges = round2(g.charges);
		g.insurancePaid = round2(g.insurancePaid);
		g.adjustments = round2(g.adjustments);
		g.patientPaid = round2(g.patientPaid);
		// Money already collected settles the recorded responsibility first, so a
		// claim the front desk has collected on stops advertising a patient due.
		g.patientDue = round2(Math.max(0, g.patientDue - g.patientPaid));
		g.balance = round2(g.charges - g.insurancePaid - g.adjustments - g.patientPaid);
		g.events.sort(compareForClaimCard);
		// The credit card is not a claim: it is either holding money ("Credit
		// Balance") or fully spent ("Settled"), never an open receivable.
		if (g.isCredit) {
			g.status = g.balance < -0.005 ? 'credit' : 'paid';
			continue;
		}
		g.status = g.balance < -0.005 ? 'credit'
			: g.balance <= 0.005 ? 'paid'
				: g.patientDue > 0.005 ? 'patient-due'
					: (g.insurancePaid > 0 || g.adjustments > 0) ? 'open'
						: 'awaiting-insurance';
	}
	out.sort((a, b) => b.sortKey - a.sortKey);
	return out;
}

/**
 * Host services the ledger's per-row Actions column needs. Supplied by both the
 * Payments editor and the patient chart (each backs it with its own storage,
 * file service and dialogs) so the shared table can offer View / Delete
 * without depending on VS Code services directly.
 */
export interface ILedgerActionsHost {
	/** Locally-hidden entry ids (kept per patient in the host's storage). */
	readHidden(): Set<string>;
	/** Persist the updated hidden-id set. */
	writeHidden(ids: Set<string>): void;
	/** Save a generated statement file locally (no native Save dialog). */
	saveStatement(fileName: string, html: string): Promise<void>;
	/** Confirm a delete; resolve true to proceed. */
	confirmDelete(message: string): Promise<boolean>;
	/** Brief info toast. */
	notify(message: string): void;
}

/**
 * Build an {@link ILedgerActionsHost} from primitive, service-backed callbacks
 * so each editor keeps its own storage / file / dialog services while sharing
 * the hidden-id (de)serialization. `loadHidden`/`storeHidden` persist a JSON
 * array of deleted entry ids — key it per patient for a patient-scoped ledger.
 */
export function makeLedgerActionsHost(deps: {
	loadHidden: () => string;
	storeHidden: (json: string) => void;
	saveFile: (fileName: string, html: string) => Promise<void>;
	confirmDelete: (message: string) => Promise<boolean>;
	notify: (message: string) => void;
}): ILedgerActionsHost {
	return {
		readHidden: () => {
			try {
				const parsed = JSON.parse(deps.loadHidden() || '[]');
				return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
			} catch {
				return new Set<string>();
			}
		},
		writeHidden: ids => deps.storeHidden(JSON.stringify([...ids])),
		saveStatement: deps.saveFile,
		confirmDelete: deps.confirmDelete,
		notify: deps.notify,
	};
}

/**
 * The ledger's two — and only two — download options (QA 27-Jul): the statement
 * as a PDF and the same ledger as an Excel workbook.
 */
export interface ILedgerExportHost {
	/** Render printable statement HTML to a PDF through the native host, behind `printCss`. */
	savePdf(fileName: string, html: string, printCss: string): Promise<void>;
	/** Resolve the practice / guarantor letterhead for the statement (best-effort). */
	loadStatementInfo?(patientIds: string[]): Promise<ILedgerStatementInfo>;
	/** Write an Excel workbook's bytes to disk. */
	saveWorkbook(fileName: string, data: Uint8Array): Promise<void>;
	notify(message: string): void;
}

export interface IRenderLedgerOptions {
	/** Show the Patient column (all-patients view); off for the chart's single-patient page. */
	showPatientColumn: boolean;
	/** Initial text filter (e.g. the Payments patient bar selection). */
	initialFilter?: string;
	/**
	 * Called on every filter edit so the host can remember what the user typed.
	 * The ledger re-renders whenever it reloads (Refresh, tab switch, patient
	 * pick) and without this the box fell back to `initialFilter` — which is
	 * what made a cleared filter reappear on its own (QA 27-Jul).
	 */
	onFilterChange?: (value: string) => void;
	/** When set, render a per-row Actions column (View / Delete) backed by this host. */
	actionsHost?: ILedgerActionsHost;
	/** When set, the toolbar offers the Statement (PDF) + Excel downloads. */
	exportHost?: ILedgerExportHost;
	/** Name used in the statement header (single-patient ledgers). */
	accountName?: string;
}

/**
 * Render summary cards + a claim-grouped ledger into `host`. Each claim card
 * carries the money summary for that claim and expands to the postings behind
 * it (charge, insurance payment, write-off, patient payment, patient portion).
 */
export function renderLedger(host: HTMLElement, events: LedgerEvent[], opts: IRenderLedgerOptions): void {
	DOM.clearNode(host);

	// -- Summary cards --
	const cards = DOM.append(host, DOM.$('div'));
	cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px;margin-bottom:12px;';
	const card = (label: string, value: string, color: string, hint: string) => {
		const c = DOM.append(cards, DOM.$('div'));
		c.title = hint;
		c.style.cssText = `border:1px solid var(--vscode-editorWidget-border);border-top:3px solid ${color};border-radius:8px;padding:10px 14px;background:var(--vscode-editorWidget-background,transparent);`;
		const v = DOM.append(c, DOM.$('div')); v.textContent = value; v.style.cssText = `font-size:18px;font-weight:700;color:${color};`;
		const l = DOM.append(c, DOM.$('div')); l.textContent = label; l.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-top:3px;';
		return v;
	};
	const totalsEls = {
		charges: card('Total Charges', money(0), 'var(--vscode-foreground)', 'Everything billed on the visible claims.'),
		insurancePaid: card('Insurance Paid', money(0), '#3b9edd', 'Primary + secondary payer payments received.'),
		adjustments: card('Write-offs / Adj', money(0), '#8b5cf6', 'Contractual adjustments the patient never owes.'),
		patientPaid: card('Patient Paid', money(0), '#22c55e', 'Money collected from the patient (refunds subtracted).'),
		patientPortionDue: card('Patient Due Now', money(0), '#f59e0b', 'Copay / deductible / coinsurance assigned by an EOB and not yet collected.'),
		availableCredit: card('Available Credit', money(0), '#14b8a6', 'Money collected from the patient that is not yet applied to a visit. It carries forward until it is used up.'),
		outstanding: card('Outstanding Balance', money(0), '#ef4444', 'Charges minus insurance payments, adjustments and patient payments.'),
	};

	// -- Toolbar: filter + the two downloads --
	const bar = DOM.append(host, DOM.$('div'));
	bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;';
	const search = DOM.append(bar, DOM.$('input')) as HTMLInputElement;
	search.placeholder = opts.showPatientColumn ? 'Filter by patient, claim #, type, description...' : 'Filter by claim #, type, description...';
	search.value = opts.initialFilter || '';
	search.style.cssText = 'flex:0 0 320px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;';
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
	// Clear button — clearing the box must STAY cleared (the host is told, so a
	// later reload doesn't restore the patient-bar name).
	const clearBtn = toolBtn('Clear', 'Clear the ledger filter', false);
	const expandBtn = toolBtn('Expand All', 'Show every posting on every claim', false);
	const spacer = DOM.append(bar, DOM.$('span'));
	spacer.style.cssText = 'flex:1;';
	let pdfBtn: HTMLButtonElement | undefined;
	let xlsBtn: HTMLButtonElement | undefined;
	if (opts.exportHost) {
		pdfBtn = toolBtn('Download Statement (PDF)', 'Save the visible ledger as a printable patient statement PDF', true);
		xlsBtn = toolBtn('Download Excel', 'Save the visible ledger as an Excel (.xlsx) workbook', false);
	}

	// -- Claim list --
	const actions = opts.actionsHost;
	const scroll = DOM.append(host, DOM.$('div'));
	scroll.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px;';

	/** Claim keys currently expanded. */
	const expanded = new Set<string>();
	let allExpanded = false;
	/** What the export buttons act on — kept in sync with what is on screen. */
	let visibleGroups: LedgerClaimGroup[] = [];

	const renderRows = () => {
		DOM.clearNode(scroll);
		const q = search.value.trim().toLowerCase();
		// Locally-deleted rows are hidden and the balances recomputed over what's
		// left, so the ledger stays internally consistent after a delete.
		const hidden = actions ? actions.readHidden() : new Set<string>();
		const active = hidden.size ? events.filter(e => !hidden.has(e.id)) : events;
		if (hidden.size) { recomputeBalances(active); }
		const matches = active.filter(e => {
			if (!q) { return true; }
			return `${e.patientName} ${e.claimRef} ${TYPE_META[e.type].label} ${e.description} ${e.date} ${e.serviceDate}`.toLowerCase().includes(q);
		});

		const totals = ledgerTotals(matches);
		totalsEls.charges.textContent = money(totals.charges);
		totalsEls.insurancePaid.textContent = money(totals.insurancePaid);
		totalsEls.patientPaid.textContent = money(totals.patientPaid);
		totalsEls.adjustments.textContent = money(totals.adjustments);
		totalsEls.patientPortionDue.textContent = money(totals.patientPortionDue);
		totalsEls.availableCredit.textContent = money(totals.availableCredit);
		// A patient who has paid ahead reads as a credit, not a minus sign.
		totalsEls.outstanding.textContent = balanceLabel(totals.outstanding);

		const groups = groupLedgerByClaim(matches);
		visibleGroups = groups;
		// The Patient Due card must agree with the claim cards below it: a claim
		// that has already been collected on no longer advertises a due amount.
		totalsEls.patientPortionDue.textContent = money(round2(groups.reduce((s, g) => s + g.patientDue, 0)));
		const entryCount = matches.length;
		countEl.textContent = `${groups.length} claim${groups.length === 1 ? '' : 's'} / ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}`;
		if (pdfBtn) { pdfBtn.disabled = groups.length === 0; }
		if (xlsBtn) { xlsBtn.disabled = groups.length === 0; }
		expandBtn.textContent = allExpanded ? 'Collapse All' : 'Expand All';

		if (groups.length === 0) {
			const e = DOM.append(scroll, DOM.$('div'));
			e.textContent = q
				? 'No ledger entries match the filter.'
				: 'No financial activity yet — bill a fee sheet and its charges, payments and adjustments show here.';
			e.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;';
			return;
		}

		for (const g of groups) { renderClaimCard(g); }
	};

	const renderClaimCard = (g: LedgerClaimGroup): void => {
		const meta = STATUS_META[g.status];
		const open = allExpanded || expanded.has(g.key);
		const cardEl = DOM.append(scroll, DOM.$('div'));
		// `flex-shrink:0` is required: the scroller is a flex column, so without it
		// every card shrinks to share the visible height and the claim's
		// patient/DOS sub-line is clipped away.
		cardEl.style.cssText = `flex:0 0 auto;border:1px solid var(--vscode-editorWidget-border);border-left:4px solid ${meta.color};border-radius:8px;overflow:hidden;background:var(--vscode-editorWidget-background,transparent);`;

		// -- Header: claim identity on the left, the money summary on the right --
		const head = DOM.append(cardEl, DOM.$('div'));
		head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;cursor:pointer;flex-wrap:wrap;';
		head.title = open ? 'Hide this claim\'s postings' : 'Show every posting on this claim';
		head.addEventListener('mouseenter', () => { head.style.background = 'var(--vscode-list-hoverBackground)'; });
		head.addEventListener('mouseleave', () => { head.style.background = ''; });
		head.addEventListener('click', () => {
			if (open) { expanded.delete(g.key); allExpanded = false; } else { expanded.add(g.key); }
			renderRows();
		});

		const chevron = DOM.append(head, DOM.$('span'));
		// allow-any-unicode-next-line
		chevron.textContent = open ? '⌄' : '›';
		chevron.style.cssText = 'width:12px;color:var(--vscode-descriptionForeground);font-size:13px;flex-shrink:0;';

		const ident = DOM.append(head, DOM.$('div'));
		ident.style.cssText = 'flex:1 1 210px;min-width:180px;';
		const claimLine = DOM.append(ident, DOM.$('div'));
		claimLine.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
		const claimEl = DOM.append(claimLine, DOM.$('span'));
		// allow-any-unicode-next-line
		claimEl.textContent = g.isCredit ? 'Patient Credit — on account' : (g.claimRef || 'Unlinked activity');
		claimEl.title = g.isCredit
			? 'Copays and payments collected without a claim, and every automatic deduction taken out of them.'
			: '';
		claimEl.style.cssText = `font-family:var(--vscode-editor-font-family,monospace);font-size:13px;font-weight:700;${g.isCredit ? 'color:#14b8a6;' : ''}`;
		const badge = DOM.append(claimLine, DOM.$('span'));
		badge.textContent = meta.label;
		badge.style.cssText = `padding:1px 8px;border-radius:9px;font-size:10px;font-weight:600;color:${meta.color};border:1px solid ${meta.color}55;background:${meta.color}14;white-space:nowrap;`;
		const subLine = DOM.append(ident, DOM.$('div'));
		const who = opts.showPatientColumn ? (g.patientName || (g.patientId ? `Patient #${g.patientId}` : 'Unknown patient')) : '';
		// allow-any-unicode-next-line
		// A credit is deliberately not tied to a date of service (the team asked for
		// DOS to be optional on a patient payment), so the card says so instead.
		const dos = g.isCredit ? 'no date of service' : (g.serviceDate ? `DOS ${usDate(g.serviceDate)}` : '');
		// allow-any-unicode-next-line
		const last = g.lastActivity ? `last activity ${usDate(g.lastActivity)}` : '';
		// allow-any-unicode-next-line
		subLine.textContent = [who, dos, last].filter(Boolean).join('  ·  ');
		subLine.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		if (opts.showPatientColumn && who) {
			subLine.title = 'Filter the ledger to this patient';
			subLine.style.cursor = 'pointer';
			subLine.addEventListener('click', e => {
				e.stopPropagation();
				search.value = g.patientName || g.patientId;
				opts.onFilterChange?.(search.value);
				renderRows();
			});
		}

		const figures = DOM.append(head, DOM.$('div'));
		figures.style.cssText = 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:flex-end;';
		const figure = (label: string, value: number, color: string, dim: boolean, text?: string) => {
			const f = DOM.append(figures, DOM.$('div'));
			f.style.cssText = 'min-width:82px;text-align:right;';
			const v = DOM.append(f, DOM.$('div'));
			v.textContent = text ?? money(value);
			v.style.cssText = `font-size:13px;font-weight:${dim ? '500' : '700'};color:${dim && value <= 0 ? 'var(--vscode-descriptionForeground)' : color};`;
			const l = DOM.append(f, DOM.$('div'));
			l.textContent = label;
			l.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);';
		};
		if (g.isCredit) {
			// The credit card answers three questions: how much came in, how much
			// has been auto-deducted, and how much is still available to carry
			// forward to the next visit.
			const collected = round2(g.events.filter(e => e.type === 'patient-credit').reduce((s, e) => s + e.credit, 0));
			const spent = round2(g.events.filter(e => e.type === 'credit-drawdown').reduce((s, e) => s + e.debit, 0));
			figure('Credit Collected', collected, '#14b8a6', true);
			figure('Applied to Visits', spent, '#0ea5e9', true);
			figure('Available Credit', round2(Math.max(0, collected - spent)), '#14b8a6', false);
		} else {
			figure('Charges', g.charges, 'var(--vscode-foreground)', true);
			figure('Insurance', g.insurancePaid, '#3b9edd', true);
			figure('Adjustments', g.adjustments, '#8b5cf6', true);
			figure('Patient Paid', g.patientPaid, '#22c55e', true);
			figure('Patient Due', g.patientDue, '#f59e0b', true);
			figure('Balance', g.balance, g.balance > 0.005 ? '#ef4444' : g.balance < -0.005 ? '#14b8a6' : '#22c55e', false, balanceLabel(g.balance));
		}

		if (!open) { return; }

		// -- Expanded: every posting behind those figures --
		const body = DOM.append(cardEl, DOM.$('div'));
		body.style.cssText = 'border-top:1px solid var(--vscode-editorWidget-border);background:rgba(128,128,128,0.04);';
		const COLS = `88px 92px 150px minmax(180px,1.6fr) 90px 90px 96px${actions ? ' 70px' : ''}`;
		const header = DOM.append(body, DOM.$('div'));
		header.style.cssText = `display:grid;grid-template-columns:${COLS};gap:8px;padding:7px 12px 7px 28px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const h of ['Date', 'Service Date', 'Type', 'Description', 'Charge', 'Paid / Adj', 'Claim Balance', ...(actions ? ['Actions'] : [])]) {
			DOM.append(header, DOM.$('span')).textContent = h;
		}

		for (const ev of g.events) {
			const tmeta = TYPE_META[ev.type];
			const r = DOM.append(body, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${COLS};gap:8px;align-items:center;padding:6px 12px 6px 28px;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;`;
			DOM.append(r, DOM.$('span')).textContent = usDate(ev.date);
			const dosEl = DOM.append(r, DOM.$('span'));
			// allow-any-unicode-next-line
			dosEl.textContent = ev.serviceDate ? usDate(ev.serviceDate) : '—';
			dosEl.style.cssText = 'color:var(--vscode-descriptionForeground);';
			const typeEl = DOM.append(r, DOM.$('span'));
			const tb = DOM.append(typeEl, DOM.$('span'));
			tb.textContent = tmeta.label;
			tb.style.cssText = `display:inline-block;padding:2px 8px;border-radius:9px;font-size:10px;font-weight:600;color:${tmeta.color};border:1px solid ${tmeta.color}55;background:${tmeta.color}14;white-space:nowrap;`;
			const descEl = DOM.append(r, DOM.$('span'));
			descEl.textContent = ev.description;
			descEl.title = ev.description;
			descEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);';
			const debitEl = DOM.append(r, DOM.$('span'));
			debitEl.textContent = ev.debit > 0 ? money(ev.debit) : '';
			debitEl.style.cssText = 'text-align:right;font-weight:600;';
			const creditEl = DOM.append(r, DOM.$('span'));
			// A due-from-patient row carries its amount here as context ("due $x")
			// so billers see it without it moving the math.
			creditEl.textContent = ev.credit > 0 ? money(ev.credit) : (ev.type === 'patient-portion' ? `due ${money(ev.info)}` : '');
			creditEl.style.cssText = `text-align:right;font-weight:600;color:${ev.type === 'patient-portion' ? '#f59e0b' : '#22c55e'};`;
			const balEl = DOM.append(r, DOM.$('span'));
			balEl.textContent = balanceLabel(ev.claimBalance);
			balEl.title = `Balance on claim ${g.claimRef || '(unlinked)'} after this posting. Account balance: ${money(ev.balance)}`;
			balEl.style.cssText = `text-align:right;font-weight:700;color:${ev.claimBalance > 0.005 ? '#ef4444' : ev.claimBalance < -0.005 ? '#14b8a6' : 'var(--vscode-foreground)'};`;

			// -- Actions: View (detail) - Delete (local hide) --
			if (actions) {
				const act = DOM.append(r, DOM.$('span'));
				act.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;';
				const actBtn = (icon: string, tip: string, color: string, run: () => void) => {
					const b = DOM.append(act, DOM.$('button')) as HTMLButtonElement;
					b.textContent = icon;
					b.title = tip;
					b.style.cssText = `background:transparent;border:1px solid ${color}44;color:${color};border-radius:5px;width:26px;height:24px;cursor:pointer;font-size:13px;line-height:1;padding:0;`;
					b.addEventListener('click', e => { e.stopPropagation(); run(); });
					return b;
				};
				actBtn('\u{1F441}', 'View full details', 'var(--vscode-foreground)', () => showLedgerEntry(host, ev, opts.showPatientColumn));
				actBtn('\u{1F5D1}', 'Delete from this ledger view', '#ef4444', async () => {
					const ok = await actions.confirmDelete(`Remove this ${TYPE_META[ev.type].label.toLowerCase()} entry from the ledger view? It won't affect the underlying charge or payment record.`);
					if (!ok) { return; }
					const set = actions.readHidden();
					set.add(ev.id);
					actions.writeHidden(set);
					actions.notify('Ledger entry removed from the view.');
					renderRows();
				});
			}
		}
	};

	search.addEventListener('input', () => { opts.onFilterChange?.(search.value); renderRows(); });
	clearBtn.addEventListener('click', () => {
		search.value = '';
		opts.onFilterChange?.('');
		renderRows();
		search.focus();
	});
	expandBtn.addEventListener('click', () => {
		allExpanded = !allExpanded;
		if (!allExpanded) { expanded.clear(); }
		renderRows();
	});

	const exportHost = opts.exportHost;
	if (exportHost && pdfBtn && xlsBtn) {
		const stamp = new Date().toISOString().slice(0, 10);
		const who = (opts.accountName || search.value.trim() || 'all-patients').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
		pdfBtn.addEventListener('click', async () => {
			try {
				// The letterhead (practice + guarantor addresses) is only needed when a
				// statement is actually generated, so it is fetched on click.
				const patientIds = [...new Set(visibleGroups.map(g => g.patientId).filter(Boolean))];
				const info = await exportHost.loadStatementInfo?.(patientIds);
				await exportHost.savePdf(`patient-statement-${who}-${stamp}.pdf`,
					ledgerStatementHtml(visibleGroups, { accountName: opts.accountName || (search.value.trim() || undefined), info }),
					LEDGER_STATEMENT_PRINT_CSS);
			} catch (e) {
				exportHost.notify(`Could not create the statement PDF: ${e instanceof Error ? e.message : String(e)}`);
			}
		});
		xlsBtn.addEventListener('click', async () => {
			try {
				await exportHost.saveWorkbook(`ledger-${who}-${stamp}.xlsx`, ledgerWorkbook(visibleGroups, opts.showPatientColumn));
			} catch (e) {
				exportHost.notify(`Could not create the Excel file: ${e instanceof Error ? e.message : String(e)}`);
			}
		});
	}

	renderRows();
}

// allow-any-unicode-next-line
// ── Exports: statement PDF + Excel workbook ────────────────────────────────

function escapeHtml(v: string): string {
	return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Practice block printed on the statement's return-address corner. */
export interface IStatementPractice {
	name: string;
	addressLine1: string;
	addressLine2: string;
	phone: string;
}

/** Guarantor block printed in the statement's mailing window. */
export interface IStatementPatient {
	name: string;
	/** Short account label shown in the payment slip ("Account"). */
	account: string;
	addressLine1: string;
	addressLine2: string;
}

/** Practice + patient identity the statement's letterhead and payment slip need. */
export interface ILedgerStatementInfo {
	practice: IStatementPractice;
	/** patientId -> guarantor block. Missing ids fall back to the ledger's own name. */
	patients: Record<string, IStatementPatient>;
}

/**
 * Load the letterhead data for a statement: the practice profile once, plus the
 * demographics of every patient the statement covers. Shared by the Payments
 * editor and the patient chart so both statements are identical. Everything is
 * best-effort — a failed lookup just leaves that line off the statement.
 */
export async function loadLedgerStatementInfo(apiService: ICiyexApiService, patientIds: string[]): Promise<ILedgerStatementInfo> {
	const get = async (path: string): Promise<Record<string, unknown> | null> => {
		try {
			const r = await apiService.fetch(path);
			if (!r.ok) { return null; }
			const j = await r.json();
			const data = (j?.data ?? j) as Record<string, unknown> | undefined;
			const list = (data?.['content'] ?? data) as unknown;
			if (Array.isArray(list)) { return (list[0] as Record<string, unknown>) ?? null; }
			return (data ?? null) as Record<string, unknown> | null;
		} catch {
			return null;
		}
	};
	const str = (v: unknown): string => (v === undefined || v === null) ? '' : String(v).trim();
	/** Address fields arrive nested (`address:{line1,…}`) or flattened, depending on the endpoint. */
	const addressOf = (rec: Record<string, unknown>): { line1: string; cityStateZip: string } => {
		const a = (rec['address'] && typeof rec['address'] === 'object') ? rec['address'] as Record<string, unknown> : {};
		const line1 = [str(rec['addressLine1'] || a['line1'] || a['line'] || rec['street']), str(rec['addressLine2'] || a['line2'])].filter(Boolean).join(', ');
		const city = str(rec['city'] || a['city']);
		const state = str(rec['state'] || a['state']);
		const zip = str(rec['zip'] || rec['postalCode'] || rec['zipcode'] || a['postalCode'] || a['zip']);
		const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
		return { line1, cityStateZip };
	};

	const [practiceRec, patientRecs] = await Promise.all([
		get('/api/fhir-resource/practice?page=0&size=1').then(p => p ?? get('/api/practices?page=0&size=1')),
		Promise.all(patientIds.map(async id => [id, await get(`/api/patients/${encodeURIComponent(id)}`)] as const)),
	]);

	const pa = practiceRec ? addressOf(practiceRec) : { line1: '', cityStateZip: '' };
	const practice: IStatementPractice = {
		name: practiceRec ? str(practiceRec['name'] || practiceRec['practiceName'] || practiceRec['dba']) : '',
		addressLine1: pa.line1,
		addressLine2: pa.cityStateZip,
		phone: practiceRec ? str(practiceRec['phone'] || practiceRec['phoneNumber'] || practiceRec['telephone']) : '',
	};

	const patients: Record<string, IStatementPatient> = {};
	for (const [id, rec] of patientRecs) {
		if (!rec) { continue; }
		const ident = (rec['identification'] && typeof rec['identification'] === 'object') ? rec['identification'] as Record<string, unknown> : {};
		const first = str(rec['firstName'] || ident['firstName']);
		const last = str(rec['lastName'] || ident['lastName']);
		const addr = addressOf(rec);
		patients[id] = {
			// Statements address the guarantor "Last, First", the way a mailing label reads.
			name: [last, first].filter(Boolean).join(', ') || str(rec['name'] || rec['fullName']),
			account: str(rec['mrn'] || rec['medicalRecordNumber'] || ident['mrn']) || `#${id}`,
			addressLine1: addr.line1,
			addressLine2: addr.cityStateZip,
		};
	}
	return { practice, patients };
}

/** `$-30.00` for money that came off the account, `$0.00` / `$135.00` otherwise (matches the statement convention). */
function signedMoney(n: number): string {
	const v = Number.isFinite(n) ? round2(n) : 0;
	return v < 0 ? `$-${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`;
}

/** Whole days between two ISO dates (0 when either is missing). */
function daysBetween(fromIso: string, to: Date): number {
	const t = new Date(`${fromIso}T00:00:00`).getTime();
	if (!fromIso || !Number.isFinite(t)) { return 0; }
	return Math.max(0, Math.floor((to.getTime() - t) / 86400000));
}

/** Aging buckets over the claims that still carry a balance, by age of the service date. */
function agingBuckets(groups: LedgerClaimGroup[], asOf: Date): { current: number; d31: number; d61: number; d91: number; d120: number } {
	const b = { current: 0, d31: 0, d61: 0, d91: 0, d120: 0 };
	for (const g of groups) {
		if (g.balance <= 0.005) { continue; }
		const age = daysBetween(g.serviceDate || g.lastActivity, asOf);
		if (age <= 30) { b.current += g.balance; }
		else if (age <= 60) { b.d31 += g.balance; }
		else if (age <= 90) { b.d61 += g.balance; }
		else if (age <= 120) { b.d91 += g.balance; }
		else { b.d120 += g.balance; }
	}
	return { current: round2(b.current), d31: round2(b.d31), d61: round2(b.d61), d91: round2(b.d91), d120: round2(b.d120) };
}

/** The CPT / service codes billed on a claim, as printed in the statement's description column. */
function claimServiceCodes(g: LedgerClaimGroup): string {
	return g.events.find(e => e.type === 'charge')?.codes?.trim() || 'Services rendered';
}

/**
 * One printable statement page per patient, laid out like the billing
 * statements practices already mail (team reference, 29-Jul): a return-address
 * letterhead beside a detachable payment slip, the guarantor's mailing block,
 * the statement-detail table, then the account summary and aging boxes.
 *
 * `info` supplies the practice / guarantor identity; without it the page still
 * prints, just with the ledger's own patient name and no addresses.
 */
export function ledgerStatementHtml(groups: LedgerClaimGroup[], opts: { accountName?: string; info?: ILedgerStatementInfo }): string {
	const asOf = new Date();
	const statementDate = usDate(asOf.toISOString().slice(0, 10));
	const practice = opts.info?.practice;

	// One page per patient — a statement is an account document, so an
	// all-patients ledger prints as a stack of per-account statements.
	const byPatient = new Map<string, LedgerClaimGroup[]>();
	for (const g of groups) {
		const key = g.patientId || g.patientName || 'unknown';
		byPatient.set(key, [...(byPatient.get(key) || []), g]);
	}
	const pages = [...byPatient.entries()];

	const pageHtml = (key: string, allGroups: LedgerClaimGroup[], pageNo: number): string => {
		// The credit card is not a claim, so it never gets a statement detail line;
		// its unapplied balance is reported in the summary's "Patient Credit" box.
		const claims = allGroups.filter(g => !g.isCredit);
		const creditOnAccount = round2(allGroups
			.filter(g => g.isCredit)
			.reduce((s, g) => s + Math.max(0, -g.balance), 0));
		const totals = claims.reduce((acc, g) => ({
			charges: acc.charges + g.charges,
			insurance: acc.insurance + g.insurancePaid,
			adjustments: acc.adjustments + g.adjustments,
			patientPaid: acc.patientPaid + g.patientPaid,
			patientDue: acc.patientDue + g.patientDue,
			balance: acc.balance + g.balance,
		}), { charges: 0, insurance: 0, adjustments: 0, patientPaid: 0, patientDue: 0, balance: 0 });
		for (const k of Object.keys(totals) as Array<keyof typeof totals>) { totals[k] = round2(totals[k]); }
		// A patient who has overpaid carries a credit; it is not a negative balance
		// owed. Unapplied credit collected at the front desk counts here too.
		const credit = round2(creditOnAccount + Math.max(0, -claims.reduce((s, g) => s + Math.min(g.balance, 0), 0)));
		// Credit on hand is applied against what the patient is asked to pay — a
		// statement must never bill money the practice is already holding.
		const due = round2(Math.max(0, (totals.patientDue > 0 ? totals.patientDue : Math.max(totals.balance, 0)) - creditOnAccount));

		const guarantor = opts.info?.patients[key];
		// A patient whose only activity is an unapplied credit has no claim groups,
		// so the identity falls back to the whole set rather than to a blank page.
		const identity = claims[0] ?? allGroups[0];
		const displayName = guarantor?.name || identity?.patientName || opts.accountName || '';
		const account = guarantor?.account || (identity?.patientId ? `#${identity.patientId}` : '');

		// Oldest first: a statement reads down the account's history.
		const detail = [...claims].sort((a, b) => (a.serviceDate || a.lastActivity).localeCompare(b.serviceDate || b.lastActivity));
		const rows = detail.map(g => `<tr>
<td>${escapeHtml(usDate(g.serviceDate || g.lastActivity))}</td>
<td class="desc">${escapeHtml(`${g.claimRef || 'Unlinked activity'} - ${claimServiceCodes(g)}`)}</td>
<td class="amt">${signedMoney(g.charges)}</td>
<td class="amt">${signedMoney(-g.patientPaid)}</td>
<td class="amt">${signedMoney(-g.insurancePaid)}</td>
<td class="amt">${signedMoney(-g.adjustments)}</td>
<td class="amt">${escapeHtml(balanceLabel(g.balance))}</td>
</tr>`).join('\n');

		const aging = agingBuckets(claims, asOf);
		// "Days late" counts from the oldest service date that still owes money.
		const oldestOwed = detail.find(g => g.balance > 0.005);
		const daysLate = oldestOwed ? daysBetween(oldestOwed.serviceDate || oldestOwed.lastActivity, asOf) : 0;

		return `<div class="stmt-page">
<div class="stmt-remit">
<div class="remit-left">
<div class="prac-name">${escapeHtml(practice?.name || 'Practice')}</div>
${practice?.addressLine1 ? `<div>${escapeHtml(practice.addressLine1)}</div>` : ''}
${practice?.addressLine2 ? `<div>${escapeHtml(practice.addressLine2)}</div>` : ''}
<div class="rsr">RETURN SERVICE REQUESTED</div>
<div class="rsr">Billing Questions Call: ${escapeHtml(practice?.phone || '')}</div>
<div class="guarantor">
<div class="g-name">${escapeHtml(displayName)}</div>
${guarantor?.addressLine1 ? `<div>${escapeHtml(guarantor.addressLine1)}</div>` : ''}
${guarantor?.addressLine2 ? `<div>${escapeHtml(guarantor.addressLine2)}</div>` : ''}
</div>
</div>
<div class="remit-right">
<div class="remit-hint">Please complete payment information.</div>
<table class="slip">
<tr><th>Account</th><th>Statement Date</th><th>Acc. Balance</th><th>Payment Due</th></tr>
<tr><td class="ctr">${escapeHtml(account)}</td><td class="ctr">${escapeHtml(statementDate)}</td><td class="amt">${escapeHtml(balanceLabel(totals.balance))}</td><td class="amt">${money(due)}</td></tr>
</table>
<table class="slip pay">
<tr><td class="lbl" rowspan="3">CREDIT CARD</td><td colspan="2" class="cards">Select Card &nbsp; [ ] Visa &nbsp; [ ] Mastercard &nbsp; [ ] Discover &nbsp; [ ] American Express</td></tr>
<tr><td class="fld">Card No.</td><td class="fld">Exp. Date &nbsp;&nbsp; CVV</td></tr>
<tr><td class="fld" colspan="2">Signature</td></tr>
<tr><td class="lbl">CHECK</td><td class="fld">Check No.</td><td class="fld">Amount Paid</td></tr>
<tr><td class="lbl payto">Make checks payable to:</td><td class="fld" colspan="2">${escapeHtml(practice?.name || '')}</td></tr>
</table>
</div>
</div>
<div class="detach">
<div class="detach-note">[ ] Check if your billing information has changed.<br>Provide update(s) above or on reverse side.</div>
<div class="detach-msg">Please detach and return top portion with payment.</div>
</div>
${daysLate > 30 ? `<div class="late">You are ${daysLate} days late</div>` : ''}
<div class="det-head"><span class="det-title">Statement Details</span><span class="det-meta">Statement Date: ${escapeHtml(statementDate)} &nbsp;&nbsp; Account: ${escapeHtml(account)}</span></div>
<table class="details">
<thead><tr><th>Date</th><th>Description</th><th class="amt">Charges</th><th class="amt">Patient pmt</th><th class="amt">Ins. pmt</th><th class="amt">Adjustments</th><th class="amt">Balance</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<table class="summary-box">
<tr><th class="cnr">Account<br>Summary</th><th>Total<br>Charges</th><th>Total<br>Payments</th><th>Total<br>Adjustments</th><th>Total<br>Balance</th><th>* Patient<br>Portion</th><th>Patient<br>Credit</th><th>Payment Due<br>Amount</th></tr>
<tr><td></td><td class="amt">${signedMoney(totals.charges)}</td><td class="amt">${signedMoney(-(totals.patientPaid + totals.insurance))}</td><td class="amt">${signedMoney(-totals.adjustments)}</td><td class="amt">${escapeHtml(balanceLabel(totals.balance))}</td><td class="amt">${money(totals.patientDue)}</td><td class="amt">${money(credit)}</td><td class="amt due-amt">${money(due)}</td></tr>
</table>
<table class="summary-box aging">
<tr><th class="cnr">Aging</th><th>Current</th><th>31-60</th><th>61-90</th><th>91-120</th><th>120+</th></tr>
<tr><td></td><td class="amt">${money(aging.current)}</td><td class="amt">${money(aging.d31)}</td><td class="amt">${money(aging.d61)}</td><td class="amt">${money(aging.d91)}</td><td class="amt">${money(aging.d120)}</td></tr>
</table>
<div class="foot-note">* Patient portion is what your insurance assigned to you. Amounts still pending with your insurance are not due yet and may change after processing.</div>
<div class="page-num">Page ${pageNo} of ${pages.length}</div>
</div>`;
	};

	return `<div class="stmt">${pages.map(([key, claims], i) => pageHtml(key, claims, i + 1)).join('\n')}</div>`;
}

/**
 * Print rules for {@link ledgerStatementHtml}. Passed to the printable-document
 * helper, which appends it AFTER its generic reset — the reset flattens every
 * colour with `.ciyex-printable-doc *`, so every rule here is class-scoped (one
 * specificity step higher) to keep the statement's navy rules and shaded
 * headers on the page.
 */
export const LEDGER_STATEMENT_PRINT_CSS = [
	'  .ciyex-printable-doc .stmt{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1a1a1a !important;}',
	'  .ciyex-printable-doc .stmt-page{break-after:page;page-break-after:always;}',
	'  .ciyex-printable-doc .stmt-page:last-child{break-after:auto;page-break-after:auto;}',
	'  .ciyex-printable-doc .stmt-remit{display:flex;gap:14px;align-items:flex-start;}',
	'  .ciyex-printable-doc .remit-left{width:46%;line-height:1.5;}',
	'  .ciyex-printable-doc .remit-right{width:54%;}',
	'  .ciyex-printable-doc .prac-name{font-weight:700;font-size:11px;}',
	'  .ciyex-printable-doc .rsr{font-size:8px;letter-spacing:0.3px;margin-top:6px;color:#444 !important;}',
	'  .ciyex-printable-doc .guarantor{margin-top:26px;line-height:1.5;}',
	'  .ciyex-printable-doc .g-name{font-weight:700;}',
	'  .ciyex-printable-doc .remit-hint{font-size:8px;text-align:center;margin-bottom:2px;}',
	'  .ciyex-printable-doc .slip{border-collapse:collapse;width:100%;font-size:8px;table-layout:fixed;}',
	'  .ciyex-printable-doc .slip th,.ciyex-printable-doc .slip td{border:1px solid #1f3b8a !important;padding:3px 4px;color:#1f3b8a !important;}',
	'  .ciyex-printable-doc .slip th{font-weight:700;text-align:center;}',
	'  .ciyex-printable-doc .slip td{color:#1a1a1a !important;}',
	'  .ciyex-printable-doc .slip .ctr{text-align:center;}',
	'  .ciyex-printable-doc .slip .lbl{font-weight:700;color:#1f3b8a !important;width:82px;vertical-align:middle;}',
	'  .ciyex-printable-doc .slip .fld{height:15px;color:#1f3b8a !important;font-size:7px;vertical-align:top;}',
	'  .ciyex-printable-doc .slip .payto{font-size:7px;font-weight:400;}',
	'  .ciyex-printable-doc .slip .cards{font-size:7px;color:#1f3b8a !important;}',
	'  .ciyex-printable-doc .slip.pay{margin-top:2px;}',
	'  .ciyex-printable-doc .detach{display:flex;justify-content:space-between;gap:12px;border-top:1px dashed #666 !important;margin:10px 0 8px;padding-top:5px;font-size:8px;color:#333 !important;}',
	'  .ciyex-printable-doc .detach-msg{font-style:italic;}',
	'  .ciyex-printable-doc .late{font-weight:700;font-size:11px;color:#b00020 !important;margin:8px 0;}',
	'  .ciyex-printable-doc .det-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1f3b8a !important;padding-bottom:3px;margin-top:10px;}',
	'  .ciyex-printable-doc .det-title{font-weight:700;font-size:12px;color:#1f3b8a !important;}',
	'  .ciyex-printable-doc .det-meta{font-size:9px;color:#333 !important;}',
	'  .ciyex-printable-doc .details{border-collapse:collapse;width:100%;font-size:9px;margin-top:6px;table-layout:fixed;}',
	'  .ciyex-printable-doc .details th,.ciyex-printable-doc .details td{border:1px solid #1f3b8a !important;padding:4px 5px;vertical-align:top;}',
	'  .ciyex-printable-doc .details thead th{background:#dde5f7 !important;color:#1f3b8a !important;font-weight:700;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
	'  .ciyex-printable-doc .details th:first-child,.ciyex-printable-doc .details td:first-child{width:64px;}',
	'  .ciyex-printable-doc .details tbody tr:nth-child(even) td{background:#f4f7fd !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
	'  .ciyex-printable-doc .details .desc{word-break:break-word;}',
	'  .ciyex-printable-doc .details .amt{text-align:right;white-space:nowrap;width:64px;}',
	'  .ciyex-printable-doc .summary-box{border-collapse:collapse;width:100%;font-size:9px;margin-top:14px;}',
	'  .ciyex-printable-doc .summary-box th,.ciyex-printable-doc .summary-box td{border:1px solid #1f3b8a !important;padding:4px 6px;text-align:center;}',
	'  .ciyex-printable-doc .summary-box th{background:#dde5f7 !important;color:#1f3b8a !important;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
	'  .ciyex-printable-doc .summary-box .cnr{background:#1f3b8a !important;color:#fff !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
	'  .ciyex-printable-doc .summary-box .amt{text-align:right;white-space:nowrap;}',
	'  .ciyex-printable-doc .summary-box .due-amt{font-weight:700;}',
	'  .ciyex-printable-doc .summary-box.aging{margin-top:8px;}',
	'  .ciyex-printable-doc .foot-note{font-size:8px;color:#444 !important;margin-top:10px;}',
	'  .ciyex-printable-doc .page-num{text-align:right;font-size:8px;color:#444 !important;margin-top:10px;}',
].join('\n');

/** How a group identifies itself in an export (the credit card has no claim #). */
function groupLabel(g: LedgerClaimGroup): string {
	return g.isCredit ? 'PATIENT CREDIT' : (g.claimRef || 'Unlinked');
}

/** Excel columns for the ledger export — one row per posting, claim-ordered. */
const LEDGER_SHEET_COLUMNS: IXlsxColumn[] = [
	{ header: 'Claim #', width: 14 },
	{ header: 'Patient', width: 24 },
	{ header: 'Claim Status', width: 18 },
	{ header: 'Service Date', width: 13 },
	{ header: 'Posting Date', width: 13 },
	{ header: 'Type', width: 22 },
	{ header: 'Description', width: 46 },
	{ header: 'Charge', width: 12, kind: 'money' },
	{ header: 'Paid / Adjusted', width: 15, kind: 'money' },
	{ header: 'Patient Due', width: 12, kind: 'money' },
	{ header: 'Claim Balance', width: 14, kind: 'money' },
];

/**
 * The visible ledger as an Excel workbook: every posting as a row, plus one
 * bold-free TOTAL row per claim so the sheet reconciles claim by claim.
 */
export function ledgerWorkbook(groups: LedgerClaimGroup[], showPatient: boolean): Uint8Array {
	const rows: XlsxRow[] = [];
	for (const g of groups) {
		const patient = showPatient ? (g.patientName || (g.patientId ? `Patient #${g.patientId}` : '')) : (g.patientName || '');
		for (const ev of g.events) {
			rows.push([
				groupLabel(g),
				patient,
				STATUS_META[g.status].label,
				ev.serviceDate ? usDate(ev.serviceDate) : '',
				usDate(ev.date),
				TYPE_META[ev.type].label,
				ev.description,
				ev.debit > 0 ? ev.debit : null,
				ev.credit > 0 ? ev.credit : null,
				ev.type === 'patient-portion' ? ev.info : null,
				ev.claimBalance,
			]);
		}
		rows.push([
			groupLabel(g), patient, STATUS_META[g.status].label, '', '', g.isCredit ? 'CREDIT TOTAL' : 'CLAIM TOTAL', '',
			g.charges, round2(g.insurancePaid + g.adjustments + g.patientPaid), g.patientDue, g.balance,
		]);
	}
	return buildXlsx('Ledger', LEDGER_SHEET_COLUMNS, rows);
}

/** The full field list for one ledger entry (shared by the View modal). */
function ledgerEntryFields(ev: LedgerEvent, showPatient: boolean): Array<[string, string]> {
	const rows: Array<[string, string]> = [
		['Type', TYPE_META[ev.type].label],
		['Posting Date', usDate(ev.date)],
		// allow-any-unicode-next-line
		['Date of Service', ev.serviceDate ? usDate(ev.serviceDate) : '—'],
	];
	// allow-any-unicode-next-line
	if (showPatient) { rows.push(['Patient', ev.patientName || (ev.patientId ? `Patient #${ev.patientId}` : '—')]); }
	rows.push(
		// allow-any-unicode-next-line
		['Claim #', ev.claimRef || '—'],
		// allow-any-unicode-next-line
		['Description', ev.description || '—'],
		// allow-any-unicode-next-line
		['Debit (charge)', ev.debit > 0 ? money(ev.debit) : '—'],
		// allow-any-unicode-next-line
		['Credit (paid / adjusted)', ev.credit > 0 ? money(ev.credit) : '—'],
	);
	if (ev.type === 'patient-portion') { rows.push(['Patient portion due', money(ev.info)]); }
	rows.push(['Claim Balance', money(ev.claimBalance)]);
	rows.push(['Account Balance', money(ev.balance)]);
	return rows;
}

/**
 * Modal listing every field of a ledger entry, mounted on the workbench root so
 * it escapes the editor's clipping. It must NOT go on `document.body`: the
 * `--vscode-*` theme variables live on `.monaco-workbench`, so a body-mounted
 * box resolved every `var(--vscode-editor-background)` to nothing and rendered
 * see-through over the ledger (QA 27-Jul: "the view page is showing like
 * transparent — add the background colour theme wise"). Mounting inside the
 * workbench (and copying its class) makes the panel opaque in every theme.
 */
function showLedgerEntry(host: HTMLElement, ev: LedgerEvent, showPatient: boolean): void {
	const doc = host.ownerDocument;
	const mount = findWorkbenchRoot(host, doc);
	const overlay = DOM.append(mount, DOM.$('div'));
	overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
	// The copied workbench class also carries an opaque page background — reset it
	// so only the scrim below dims the ledger behind the modal.
	overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;color:var(--vscode-foreground);';
	const close = () => overlay.remove();
	overlay.addEventListener('click', e => { if (e.target === overlay) { close(); } });

	const box = DOM.append(overlay, DOM.$('div'));
	box.style.cssText = 'width:460px;max-width:92vw;max-height:82vh;overflow:auto;background:var(--vscode-editorWidget-background, var(--vscode-editor-background, var(--vscode-menu-background)));color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
	const head = DOM.append(box, DOM.$('div'));
	head.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);`;
	const title = DOM.append(head, DOM.$('div'));
	title.textContent = 'Ledger Entry';
	title.style.cssText = 'font-size:15px;font-weight:600;';
	const meta = TYPE_META[ev.type];
	const badge = DOM.append(head, DOM.$('span'));
	badge.textContent = meta.label;
	badge.style.cssText = `margin-left:auto;padding:2px 9px;border-radius:9px;font-size:10px;font-weight:600;color:${meta.color};border:1px solid ${meta.color}55;background:${meta.color}14;`;
	const x = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
	x.textContent = '\u{2715}';
	x.style.cssText = 'background:transparent;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:15px;';
	x.addEventListener('click', close);

	const grid = DOM.append(box, DOM.$('div'));
	grid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:8px 16px;padding:16px;font-size:13px;';
	for (const [label, value] of ledgerEntryFields(ev, showPatient)) {
		const l = DOM.append(grid, DOM.$('div')); l.textContent = label;
		l.style.cssText = 'color:var(--vscode-descriptionForeground);white-space:nowrap;';
		const v = DOM.append(grid, DOM.$('div')); v.textContent = value;
		v.style.cssText = 'font-weight:500;word-break:break-word;';
	}
}
