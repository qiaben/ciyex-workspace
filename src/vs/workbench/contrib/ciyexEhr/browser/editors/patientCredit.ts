/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICiyexApiService } from '../ciyexApiService.js';

/**
 * Patient credit balances: money the front desk collected (typically a copay)
 * that is NOT yet attached to a claim, plus the automatic deductions that draw
 * it down on later visits.
 *
 * Nothing here needs a backend change. The `payment_transaction` table has no
 * enum constraint on `transactionType` / `referenceType` and carries free-text
 * `description` / `notes` / `claimId` columns, so the whole credit account is
 * expressed with two shapes of ordinary payment transaction:
 *
 *  1. CREDIT RECEIVED  - `transactionType: 'credit'`, `referenceType: 'balance'`,
 *     `status: 'completed'`, no claim and no date of service (the team asked for
 *     DOS to be optional on a patient payment). This is the real money in.
 *
 *  2. CREDIT DEDUCTION - any completed transaction whose `paymentMethodType` is
 *     `'credit'` (a `creditapply=1` note is written too, so an edit that rewrites
 *     the method can't orphan the record). It carries the claim it settles and an
 *     `original=` / `deducted=` / `remaining=` breakdown in its description, which
 *     is the audit trail the team asked for.
 *
 * The available balance is ALWAYS recomputed from those records (received minus
 * deducted, replayed oldest-first), never stored — so a failed write can never
 * leave a patient with a phantom balance, and the number can't go negative.
 */

/** Pseudo claim reference the ledger groups credit activity under. */
export const CREDIT_CLAIM_REF = 'CREDIT';

/** `transactionType` of a credit RECEIVED record. */
export const CREDIT_TXN_TYPE = 'credit';

/** `paymentMethodType` of a credit DEDUCTION record. */
export const CREDIT_METHOD = 'credit';

/** Secondary marker written into a deduction's notes. */
const CREDIT_APPLY_NOTE = 'creditapply=1';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function listOf(payload: unknown): Array<Record<string, unknown>> {
	const p = payload as { data?: unknown; content?: unknown } | unknown[] | null;
	const w = (p as { data?: unknown })?.data ?? p;
	const list = (w as { content?: unknown })?.content ?? w;
	return Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
}

/** Today as `yyyy-mm-dd` — the date a deduction actually happened. */
function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function isoDate(value: unknown): string {
	const s = String(value ?? '');
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) { return s.slice(0, 10); }
	const t = new Date(s).getTime();
	return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

/** Money a transaction is worth once a refund/void is taken into account. */
function usableStatus(txn: Record<string, unknown>): boolean {
	return String(txn['status'] ?? '').toLowerCase() === 'completed';
}

/** True for a "credit received" record: unallocated money sitting on the account. */
export function isCreditTransaction(txn: Record<string, unknown>): boolean {
	return String(txn['transactionType'] ?? '') === CREDIT_TXN_TYPE;
}

/** True for a record that DEDUCTED credit (a copay auto-paid from the balance). */
export function isCreditApplication(txn: Record<string, unknown>): boolean {
	if (isCreditTransaction(txn)) { return false; }
	return String(txn['paymentMethodType'] ?? '') === CREDIT_METHOD
		|| String(txn['notes'] ?? '').includes(CREDIT_APPLY_NOTE);
}

/** One collected credit and how much of it is left. */
export interface PatientCreditSource {
	id: string;
	/** Date the money was collected. */
	date: string;
	/** Cash / card / check / ... the patient actually paid with. */
	method: string;
	description: string;
	/** Amount originally collected. */
	original: number;
	/** How much of it has been drawn down. */
	applied: number;
	/** original - applied, never below zero. */
	remaining: number;
}

/** One automatic (or manual) deduction taken out of the credit balance. */
export interface PatientCreditApplication {
	id: string;
	date: string;
	/** Claim the deduction settled ('' when it was applied to a bare visit copay). */
	claimRef: string;
	encounterId: string;
	/** What the deduction was for: copay / deductible / coinsurance / payment. */
	kind: string;
	description: string;
	amount: number;
	/** Credit balance left across the whole account right after this deduction. */
	balanceAfter: number;
	/** Ids of the collected credits this deduction drew from, oldest first. */
	sourceIds: string[];
}

/** A patient's whole credit account: what came in, what went out, what is left. */
export interface PatientCreditAccount {
	patientId: string;
	patientName: string;
	received: number;
	applied: number;
	/** received - applied, clamped at zero (the balance can never go negative). */
	available: number;
	sources: PatientCreditSource[];
	applications: PatientCreditApplication[];
	/** Most recent credit activity (ISO date), for sorting the Credits list. */
	lastActivity: string;
}

/**
 * Roll a raw transaction list up into one credit account per patient. Deductions
 * are replayed oldest-first against the collected credits oldest-first (FIFO), so
 * every collected credit knows how much of itself is left and every deduction
 * knows which credits funded it.
 */
export function buildCreditAccounts(txns: Array<Record<string, unknown>>): Map<string, PatientCreditAccount> {
	const accounts = new Map<string, PatientCreditAccount>();
	const account = (txn: Record<string, unknown>): PatientCreditAccount => {
		const pid = String(txn['patientId'] ?? '');
		let a = accounts.get(pid);
		if (!a) {
			a = {
				patientId: pid, patientName: String(txn['patientName'] ?? ''),
				received: 0, applied: 0, available: 0, sources: [], applications: [], lastActivity: '',
			};
			accounts.set(pid, a);
		}
		if (!a.patientName && txn['patientName']) { a.patientName = String(txn['patientName']); }
		return a;
	};

	const when = (txn: Record<string, unknown>): string => isoDate(txn['collectedAt'] ?? txn['transactionDate'] ?? txn['createdAt']);

	for (const txn of txns) {
		if (!usableStatus(txn)) { continue; }
		const amount = round2(Number(txn['amount']) || 0);
		if (amount <= 0) { continue; }
		if (isCreditTransaction(txn)) {
			const a = account(txn);
			a.sources.push({
				id: String(txn['id'] ?? ''),
				date: when(txn),
				method: String(txn['paymentMethodType'] ?? 'cash'),
				description: String(txn['description'] ?? ''),
				original: amount, applied: 0, remaining: amount,
			});
		} else if (isCreditApplication(txn)) {
			const a = account(txn);
			const desc = String(txn['description'] ?? '');
			a.applications.push({
				id: String(txn['id'] ?? ''),
				date: when(txn),
				claimRef: String(txn['claimId'] ?? '') || desc.match(/claim[= ]([A-Za-z0-9-]+)/)?.[1] || '',
				encounterId: String(txn['encounterId'] ?? '') || desc.match(/encounter\s+([A-Za-z0-9-]+)/i)?.[1] || '',
				kind: String(txn['transactionType'] ?? 'copay'),
				description: desc,
				amount, balanceAfter: 0, sourceIds: [],
			});
		}
	}

	for (const a of accounts.values()) {
		a.sources.sort((x, y) => (x.date || '').localeCompare(y.date || '') || Number(x.id) - Number(y.id));
		a.applications.sort((x, y) => (x.date || '').localeCompare(y.date || '') || Number(x.id) - Number(y.id));
		a.received = round2(a.sources.reduce((s, x) => s + x.original, 0));
		a.applied = round2(a.applications.reduce((s, x) => s + x.amount, 0));
		// FIFO drawdown: the oldest collected credit is consumed first.
		let cursor = 0;
		let running = a.received;
		for (const app of a.applications) {
			let left = app.amount;
			while (left > 0.005 && cursor < a.sources.length) {
				const src = a.sources[cursor];
				const take = Math.min(left, src.remaining);
				if (take > 0.005) {
					src.applied = round2(src.applied + take);
					src.remaining = round2(src.remaining - take);
					app.sourceIds.push(src.id);
					left = round2(left - take);
				}
				if (src.remaining <= 0.005) { cursor++; } else { break; }
			}
			running = round2(Math.max(0, running - app.amount));
			app.balanceAfter = running;
		}
		// Never negative: a deduction recorded without a matching credit (hand-edited
		// data) reduces the balance to zero rather than below it.
		a.available = round2(Math.max(0, a.received - a.applied));
		a.lastActivity = [...a.sources.map(s => s.date), ...a.applications.map(x => x.date)]
			.filter(Boolean).sort().pop() || '';
	}
	return accounts;
}

/** Load every patient's credit account from the shared transaction list. */
export async function loadCreditAccounts(apiService: ICiyexApiService): Promise<Map<string, PatientCreditAccount>> {
	try {
		const res = await apiService.fetch('/api/payments/transactions');
		if (!res.ok) { return new Map(); }
		return buildCreditAccounts(listOf(await res.json()));
	} catch {
		return new Map();
	}
}

/** Available (unapplied) credit for one patient. */
export async function availableCredit(apiService: ICiyexApiService, patientId: string): Promise<number> {
	const accounts = await loadCreditAccounts(apiService);
	return accounts.get(String(patientId))?.available ?? 0;
}

export interface IRecordCreditOptions {
	patientId: string | number;
	patientName?: string;
	amount: number;
	/** How the patient actually paid: cash / check / credit_card / ... */
	method: string;
	/** Optional free-text note kept on the transaction. */
	note?: string;
	receiptEmail?: string;
}

/**
 * Record money collected from the patient as an unallocated CREDIT. No claim and
 * no date of service are attached - the payment is deliberately not tied to an
 * encounter until a copay comes due.
 */
export async function recordPatientCredit(apiService: ICiyexApiService, opts: IRecordCreditOptions): Promise<{ ok: boolean; error?: string }> {
	const amount = round2(opts.amount);
	if (amount <= 0) { return { ok: false, error: 'Enter an amount greater than 0.' }; }
	const methodLabel = opts.method.replace(/_/g, ' ');
	const payload: Record<string, unknown> = {
		patientId: opts.patientId,
		patientName: opts.patientName,
		amount,
		transactionType: CREDIT_TXN_TYPE,
		paymentMethodType: opts.method,
		status: 'completed',
		referenceType: 'balance',
		// allow-any-unicode-next-line
		description: `Patient credit — ${methodLabel} payment held on account${opts.note ? ` — ${opts.note}` : ''}`,
		notes: `credit=${amount.toFixed(2)}`,
		receiptEmail: opts.receiptEmail || undefined,
	};
	try {
		const res = await apiService.fetch('/api/payments/collect', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
		});
		if (res.ok) { return { ok: true }; }
		// The backend rejects a card collection without a saved payment method, so
		// its message is worth showing rather than a generic failure.
		const body = await res.json().catch(() => null) as { message?: string } | null;
		return { ok: false, error: body?.message || `The payment service returned ${res.status}.` };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export interface IApplyCreditOptions {
	patientId: string | number;
	patientName?: string;
	/** How much the visit needs. The deduction is capped at the available credit. */
	due: number;
	/** Claim the copay belongs to ('' for a bare visit copay with no claim yet). */
	claimRef?: string;
	encounterId?: string | number;
	/** Date of service of the visit the copay is for (optional). */
	serviceDate?: string;
	/** copay (default) / deductible / coinsurance / payment. */
	kind?: string;
	/** Short reason shown in the transaction description. */
	reason?: string;
}

export interface IApplyCreditResult {
	/** How much credit was actually deducted. */
	applied: number;
	/** Credit left on the account afterwards. */
	remaining: number;
	/** Part of `due` the credit could NOT cover - stays as patient responsibility. */
	shortfall: number;
}

/**
 * Deduct a visit's copay from the patient's available credit.
 *
 * Business rules, in order:
 *  - never deduct more than is available (the balance can never go negative);
 *  - settle the claim's already-recorded PENDING responsibility first, converting
 *    those records in place so the money isn't counted twice;
 *  - a record the credit only partly covers is shrunk to its remainder, so what
 *    the patient still owes stays exact;
 *  - anything still uncovered comes back as `shortfall` for the caller to charge.
 */
export async function applyPatientCredit(apiService: ICiyexApiService, opts: IApplyCreditOptions): Promise<IApplyCreditResult> {
	const patientId = String(opts.patientId);
	const due = round2(opts.due);
	const accounts = await loadCreditAccounts(apiService);
	const account = accounts.get(patientId);
	const available = account?.available ?? 0;
	if (due <= 0.005 || available <= 0.005) {
		return { applied: 0, remaining: available, shortfall: Math.max(0, due) };
	}

	const target = round2(Math.min(due, available));
	const claimRef = String(opts.claimRef ?? '');
	const kind = opts.kind || 'copay';
	const patientName = opts.patientName ?? account?.patientName ?? '';
	// The credit each slice is drawn from, for the transaction's audit line.
	const openSources = (account?.sources ?? []).filter(s => s.remaining > 0.005);
	let sourceCursor = 0;
	let sourceLeft = openSources[0]?.remaining ?? 0;

	/** Audit text: which credit funded this slice and what is left afterwards. */
	const auditFor = (slice: number, balanceBefore: number): string => {
		const src = openSources[sourceCursor];
		const original = src ? src.original : balanceBefore;
		return `original=${original.toFixed(2)}; deducted=${slice.toFixed(2)}; `
			+ `remaining=${round2(balanceBefore - slice).toFixed(2)}${src ? `; src=${src.id}` : ''}`;
	};
	const consumeSource = (slice: number): void => {
		let left = slice;
		while (left > 0.005 && sourceCursor < openSources.length) {
			const take = Math.min(left, sourceLeft);
			left = round2(left - take);
			sourceLeft = round2(sourceLeft - take);
			if (sourceLeft <= 0.005) {
				sourceCursor++;
				sourceLeft = openSources[sourceCursor]?.remaining ?? 0;
			}
		}
	};

	let balance = available;
	let remainingToApply = target;

	// -- 1. Convert the claim's PENDING patient-responsibility records ---------
	const pendings = claimRef ? await loadPendingResponsibility(apiService, patientId, claimRef) : [];
	for (const p of pendings) {
		if (remainingToApply <= 0.005) { break; }
		const owed = round2(Number(p['amount']) || 0);
		if (owed <= 0) { continue; }
		if (remainingToApply + 0.005 >= owed) {
			// Fully covered: the pending record BECOMES the deduction (converting it
			// rather than adding a second record keeps the claim from double-paying).
			const ok = await apiService.fetch(`/api/payments/transactions/${p['id']}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: 'completed',
					paymentMethodType: CREDIT_METHOD,
					// The EOB's pending record carries the claim only in its text; make
					// the link explicit now that it has become a real deduction.
					claimId: claimRef,
					// Re-date it to TODAY. The record was created when the EOB posted,
					// which is usually before the credit was even collected — leaving
					// that date made the ledger show the credit being spent before it
					// arrived, and the running balances read backwards.
					collectedAt: today(),
					// allow-any-unicode-next-line
					description: `Patient credit applied — claim ${claimRef}`
						+ `${opts.encounterId ? ` (encounter ${opts.encounterId})` : ''}; ${auditFor(owed, balance)}`,
					notes: `${CREDIT_APPLY_NOTE}; claim=${claimRef}`,
				}),
			}).then(r => r.ok).catch(() => false);
			if (!ok) { break; }
			consumeSource(owed);
			balance = round2(balance - owed);
			remainingToApply = round2(remainingToApply - owed);
			continue;
		}
		// Partly covered: shrink what is still owed, then book the covered slice.
		const slice = remainingToApply;
		const shrunk = await apiService.fetch(`/api/payments/transactions/${p['id']}`, {
			method: 'PUT', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ amount: round2(owed - slice) }),
		}).then(r => r.ok).catch(() => false);
		if (!shrunk) { break; }
		const booked = await bookDeduction(apiService, {
			patientId, patientName, amount: slice, claimRef, encounterId: opts.encounterId,
			serviceDate: opts.serviceDate, kind: String(p['transactionType'] ?? kind),
			audit: auditFor(slice, balance), reason: opts.reason,
		});
		if (!booked) { break; }
		consumeSource(slice);
		balance = round2(balance - slice);
		remainingToApply = 0;
	}

	// -- 2. Anything left is a copay with no pending record behind it ----------
	if (remainingToApply > 0.005) {
		const slice = remainingToApply;
		const booked = await bookDeduction(apiService, {
			patientId, patientName, amount: slice, claimRef, encounterId: opts.encounterId,
			serviceDate: opts.serviceDate, kind, audit: auditFor(slice, balance), reason: opts.reason,
		});
		if (booked) {
			consumeSource(slice);
			balance = round2(balance - slice);
			remainingToApply = 0;
		}
	}

	const applied = round2(target - remainingToApply);
	return { applied, remaining: round2(Math.max(0, available - applied)), shortfall: round2(Math.max(0, due - applied)) };
}

/** The claim's still-open patient-responsibility records, oldest first. */
async function loadPendingResponsibility(apiService: ICiyexApiService, patientId: string, claimRef: string): Promise<Array<Record<string, unknown>>> {
	try {
		const res = await apiService.fetch('/api/payments/transactions');
		if (!res.ok) { return []; }
		const wanted = claimRef.trim().toLowerCase();
		return listOf(await res.json()).filter(t =>
			String(t['patientId'] ?? '') === patientId
			&& String(t['status'] ?? '').toLowerCase() === 'pending'
			&& ['copay', 'deductible', 'coinsurance'].includes(String(t['transactionType'] ?? ''))
			&& (String(t['claimId'] ?? '').trim().toLowerCase() === wanted
				|| String(t['description'] ?? '').toLowerCase().includes(`claim ${wanted}`)));
	} catch {
		return [];
	}
}

/** POST one credit deduction transaction. */
async function bookDeduction(apiService: ICiyexApiService, opts: {
	patientId: string; patientName: string; amount: number; claimRef: string;
	encounterId?: string | number; serviceDate?: string; kind: string; audit: string; reason?: string;
}): Promise<boolean> {
	const where = opts.claimRef
		// allow-any-unicode-next-line
		? ` — claim ${opts.claimRef}${opts.encounterId ? ` (encounter ${opts.encounterId})` : ''}`
		// allow-any-unicode-next-line
		: opts.encounterId ? ` — encounter ${opts.encounterId}` : '';
	const payload: Record<string, unknown> = {
		patientId: opts.patientId,
		patientName: opts.patientName,
		amount: opts.amount,
		transactionType: opts.kind,
		paymentMethodType: CREDIT_METHOD,
		status: 'completed',
		referenceType: opts.claimRef ? 'claim' : 'balance',
		claimId: opts.claimRef || undefined,
		dateOfService: opts.serviceDate || undefined,
		encounterId: opts.encounterId,
		// allow-any-unicode-next-line
		description: `Patient credit applied${where}; ${opts.audit}${opts.reason ? `; ${opts.reason}` : ''}`,
		notes: `${CREDIT_APPLY_NOTE}${opts.claimRef ? `; claim=${opts.claimRef}` : ''}`,
	};
	try {
		const res = await apiService.fetch('/api/payments/collect', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Refund unapplied credit back to the patient. Booked as a refund transaction so
 * the money leaves the credit balance and the ledger shows where it went.
 */
export async function refundPatientCredit(apiService: ICiyexApiService, opts: {
	patientId: string | number; patientName?: string; amount: number; method: string; reason?: string;
}): Promise<boolean> {
	const amount = round2(opts.amount);
	if (amount <= 0) { return false; }
	try {
		const res = await apiService.fetch('/api/payments/collect', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				patientId: opts.patientId, patientName: opts.patientName, amount,
				transactionType: 'refund', paymentMethodType: CREDIT_METHOD, status: 'completed',
				referenceType: 'balance',
				// allow-any-unicode-next-line
				description: `Unused patient credit refunded — ${opts.method.replace(/_/g, ' ')}${opts.reason ? ` — ${opts.reason}` : ''}; deducted=${amount.toFixed(2)}`,
				notes: `${CREDIT_APPLY_NOTE}; refund=1`,
			}),
		});
		return res.ok;
	} catch {
		return false;
	}
}

// allow-any-unicode-next-line
// -- Recurring per-visit copay -----------------------------------------------

/** Marker written into a payment plan's notes: `copayPlan=<amount>~<visits>`. */
const COPAY_PLAN_NOTE = /copayPlan=(\d+(?:\.\d+)?)(?:~(\d+))?/;

/** A plan that charges the same copay on every visit (e.g. $30 per visit). */
export interface IRecurringCopayPlan {
	/** Fixed copay charged per visit. */
	perVisit: number;
	/** How many visits the plan covers (0 = open-ended). */
	visits: number;
	/** Where the amount came from, for the tooltip. */
	source: 'plan' | 'coverage';
	label: string;
}

/**
 * The copay this patient owes for a visit. A "recurring copay" payment plan wins
 * (that is the explicit per-visit arrangement); otherwise the active insurance
 * coverage's `copayAmount` is used. Returns null when neither is set.
 */
export async function resolveVisitCopay(apiService: ICiyexApiService, patientId: string): Promise<IRecurringCopayPlan | null> {
	const money = (v: unknown): number => round2(Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0);
	try {
		const res = await apiService.fetch(`/api/payments/plans/patient/${encodeURIComponent(patientId)}`);
		if (res.ok) {
			for (const plan of listOf(await res.json())) {
				if (String(plan['status'] ?? '').toLowerCase() !== 'active') { continue; }
				const m = COPAY_PLAN_NOTE.exec(String(plan['notes'] ?? ''));
				if (!m) { continue; }
				const perVisit = round2(Number(m[1]) || 0);
				if (perVisit <= 0) { continue; }
				return {
					perVisit, visits: Number(m[2]) || 0, source: 'plan',
					label: String(plan['planName'] ?? 'Recurring copay plan'),
				};
			}
		}
	} catch { /* fall through to the coverage copay */ }

	try {
		const res = await apiService.fetch(`/api/fhir-resource/insurance-coverage/patient/${encodeURIComponent(patientId)}?page=0&size=10`);
		if (!res.ok) { return null; }
		const coverages = listOf(await res.json());
		const active = coverages.find(c => /active/i.test(String(c['status'] ?? ''))) || coverages[0];
		const perVisit = money(active?.['copayAmount']);
		if (!active || perVisit <= 0) { return null; }
		return {
			perVisit, visits: 0, source: 'coverage',
			label: String(active['payerName'] ?? active['insuranceName'] ?? 'Insurance plan'),
		};
	} catch {
		return null;
	}
}

/** Build the `notes` value that marks a payment plan as a recurring copay plan. */
export function copayPlanNote(perVisit: number, visits: number, existingNotes = ''): string {
	const marker = `copayPlan=${round2(perVisit).toFixed(2)}~${Math.max(0, Math.round(visits))}`;
	const stripped = existingNotes.replace(COPAY_PLAN_NOTE, '').replace(/\s*\|\s*$/, '').trim();
	return stripped ? `${stripped} | ${marker}` : marker;
}

/** Read a recurring-copay marker back off a payment plan's notes. */
export function readCopayPlanNote(notes: unknown): { perVisit: number; visits: number } | null {
	const m = COPAY_PLAN_NOTE.exec(String(notes ?? ''));
	if (!m) { return null; }
	const perVisit = round2(Number(m[1]) || 0);
	return perVisit > 0 ? { perVisit, visits: Number(m[2]) || 0 } : null;
}
