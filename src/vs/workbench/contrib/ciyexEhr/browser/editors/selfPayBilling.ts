/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICiyexApiService } from '../ciyexApiService.js';
import { normalizeClaimRef } from '../billing/edi837.js';

/**
 * Self-pay billing: a patient with no insurance owes the WHOLE charge, and owes
 * it the moment the fee sheet is sent to billing — there is no payer to
 * adjudicate first and no EOB will ever arrive.
 *
 * No backend change is needed for this, because the insured flow already has a
 * mechanism for "this money is the patient's": a PENDING patient-responsibility
 * payment transaction, which `_saveEobPosting` writes once the payer's EOB
 * assigns a copay / deductible. A self-pay claim is simply a claim whose
 * responsibility was assigned by the FEE SHEET instead of by an EOB, so it
 * writes the same kind of record for the full amount and tags it `selfpay=1`.
 *
 * Everything downstream then works untouched:
 *   - patientLedger  → a `patient-portion` event → `patientDue` → "Patient Due"
 *   - Payment Dashboard → `respPending` → `patientPortion` → pre-filled Pay Amount
 *   - patientCredit  → credit on the account auto-draws against it
 *   - Insurance Posting → the ONE screen that has to opt out (`selfPayClaimRefs`)
 *
 * Two deliberate choices worth knowing before editing this file:
 *
 *  - `transactionType` is `'copay'`, not a self-pay-specific value. The ledger
 *    (patientLedger.ts), the Dashboard (`_applyPaymentActivity`) and
 *    `applyPatientCredit` all match on `['copay','deductible','coinsurance']`;
 *    inventing a fourth type would make a self-pay balance invisible to all
 *    three. `_createPatientRespTransactions` set this precedent for the same
 *    reason. The `selfpay=1` tag is what tells the two apart.
 *
 *  - The description must NOT start with `EOB posting` and the type must not be
 *    `insurance_payment`, or Insurance Posting, `_applyPaymentActivity` and
 *    patientBilling would each mistake this record for a payer's remittance.
 */

/** Marker written into a self-pay responsibility record's description + notes. */
export const SELF_PAY_NOTE = 'selfpay=1';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function listOf(payload: unknown): Array<Record<string, unknown>> {
	const p = payload as { data?: unknown; content?: unknown } | unknown[] | null;
	const w = (p as { data?: unknown })?.data ?? p;
	const list = (w as { content?: unknown })?.content ?? w;
	return Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
}

/**
 * True for a patient-responsibility record created because the patient has no
 * insurance. Checks both columns the marker is written to: `notes` is the
 * durable one, `description` is what the Dashboard and the ledger display (and
 * an edit through the generic Patient Balance form can rewrite either).
 */
export function isSelfPayResponsibility(txn: Record<string, unknown>): boolean {
	return String(txn['notes'] ?? '').includes(SELF_PAY_NOTE)
		|| String(txn['description'] ?? '').includes(SELF_PAY_NOTE);
}

/** The claim a transaction settles, normalized — '' when it names none. */
function claimRefOf(txn: Record<string, unknown>): string {
	const explicit = String(txn['claimId'] ?? '').trim();
	if (explicit) { return normalizeClaimRef(explicit); }
	const fromDesc = String(txn['description'] ?? '').match(/claim[= ]([A-Za-z0-9]+-?\d+)/)?.[1] ?? '';
	return fromDesc ? normalizeClaimRef(fromDesc) : '';
}

/** True for a payer remittance rather than patient money. */
function isInsurancePosting(txn: Record<string, unknown>): boolean {
	return String(txn['transactionType'] ?? '') === 'insurance_payment'
		|| String(txn['description'] ?? '').startsWith('EOB posting');
}

/**
 * Normalized refs of every claim that carries a self-pay responsibility record.
 * This is the set Insurance Posting subtracts from its "Awaiting EOB" work list
 * and the Dashboard / chart Billing page use to badge a claim "Self-Pay".
 */
export function selfPayClaimRefs(txns: Array<Record<string, unknown>>): Set<string> {
	const refs = new Set<string>();
	for (const t of txns) {
		if (!isSelfPayResponsibility(t)) { continue; }
		const ref = claimRefOf(t);
		if (ref) { refs.add(ref); }
	}
	return refs;
}

export interface ISelfPaySyncOptions {
	patientId: string | number;
	patientName?: string;
	/** Claim the balance belongs to (`CLM-0012`). */
	claimRef: string;
	feeSheetId?: string | number;
	encounterId?: string | number;
	/** Date of service, so the ledger dates the balance to the visit. */
	serviceDate?: string;
	/**
	 * What the patient owes: the fee sheet's PROCEDURE-only total. Pass 0 to
	 * retire the marker (the sheet was switched back to insurance billing).
	 */
	due: number;
}

export interface ISelfPaySyncResult {
	action: 'created' | 'updated' | 'unchanged' | 'removed' | 'none';
	/** What the patient is left owing on this claim as self-pay. */
	amount: number;
	/**
	 * True when the caller asked to retire a self-pay balance the patient has
	 * ALREADY paid against. The records are left alone — collected money must be
	 * refunded or adjusted deliberately, never silently deleted by a re-send.
	 */
	blocked: boolean;
	/** Set when a write failed; the caller surfaces it. */
	error?: string;
}

/**
 * Make the patient's self-pay balance for one claim match `due`, idempotently.
 *
 * Idempotency is the point: Send to Billing can be pressed twice, and a fee
 * sheet can be edited and re-sent. Both must leave ONE responsibility record
 * holding the current total rather than stacking duplicates — which is exactly
 * what a second `/bill` POST does to the RCM charge list today.
 *
 *   due > 0, no marker            → create it
 *   due > 0, pending marker       → PUT the new amount (no-op when unchanged)
 *   due > 0, partly collected     → carry only the shortfall
 *   due > 0, fully collected      → drop any leftover pending record
 *   due = 0, pending marker only  → delete it (back to insurance billing)
 *   due = 0, money collected      → refuse, and say so via `blocked`
 */
export async function syncSelfPayResponsibility(apiService: ICiyexApiService, opts: ISelfPaySyncOptions): Promise<ISelfPaySyncResult> {
	const patientId = String(opts.patientId ?? '').trim();
	const wanted = normalizeClaimRef(opts.claimRef);
	const due = round2(Math.max(0, opts.due));
	if (!patientId || !wanted) {
		return { action: 'none', amount: 0, blocked: false, error: 'A self-pay balance needs both a patient and a claim.' };
	}

	let onClaim: Array<Record<string, unknown>>;
	try {
		const res = await apiService.fetch('/api/payments/transactions');
		if (!res.ok) {
			return { action: 'none', amount: 0, blocked: false, error: `The payment service returned ${res.status}.` };
		}
		onClaim = listOf(await res.json()).filter(t =>
			String(t['patientId'] ?? '') === patientId
			&& claimRefOf(t) === wanted);
	} catch (e) {
		return { action: 'none', amount: 0, blocked: false, error: e instanceof Error ? e.message : String(e) };
	}

	const statusOf = (t: Record<string, unknown>) => String(t['status'] ?? '').toLowerCase();
	const amountOf = (t: Record<string, unknown>) => Number(t['amount']) || 0;
	const pending = onClaim.filter(t => isSelfPayResponsibility(t) && statusOf(t) === 'pending');

	/**
	 * Patient money already taken against this claim — counted across EVERY
	 * completed patient-side record, not just the ones carrying the marker.
	 * A part-payment settles the marker by SHRINKING it and booking the collected
	 * slice as a separate unmarked transaction (`_settlePendingTransactions`), so
	 * counting only marked records would miss that money and re-inflate the
	 * balance back to the full charge on the next re-send.
	 */
	const collected = round2(onClaim
		.filter(t => !isInsurancePosting(t))
		.reduce((s, t) => {
			const status = statusOf(t);
			if (status === 'completed') { return s + amountOf(t); }
			// A refund puts the money back and re-opens the balance.
			if (status === 'refunded') { return s - amountOf(t); }
			return s;
		}, 0));

	if (due <= 0.005) {
		if (collected > 0.005) {
			return { action: 'none', amount: collected, blocked: true };
		}
		let removed = false;
		for (const t of pending) {
			if (await deleteTxn(apiService, t)) { removed = true; }
		}
		return { action: removed ? 'removed' : 'unchanged', amount: 0, blocked: false };
	}

	// What is still owed after whatever has already been collected.
	const target = round2(Math.max(0, due - Math.max(0, collected)));

	if (target <= 0.005) {
		// The patient has already paid the whole charge — retire any leftover
		// pending record so the claim stops advertising a balance.
		let removed = false;
		for (const t of pending) {
			if (await deleteTxn(apiService, t)) { removed = true; }
		}
		return { action: removed ? 'removed' : 'unchanged', amount: 0, blocked: false };
	}

	const description = selfPayDescription(opts.claimRef, target);
	// `due=` (not `billed=`): after a part payment this record carries the
	// SHORTFALL, which is less than what was originally charged.
	const notes = `${SELF_PAY_NOTE}; claim=${opts.claimRef}; due=${target.toFixed(2)}`;

	if (pending.length > 0) {
		// Keep the oldest record as the single carrier of the balance; a re-send
		// after an edit must not leave a second one behind.
		const [keep, ...extras] = pending;
		for (const t of extras) { await deleteTxn(apiService, t); }
		if (Math.abs((Number(keep['amount']) || 0) - target) <= 0.005 && String(keep['notes'] ?? '').includes(SELF_PAY_NOTE)) {
			return { action: 'unchanged', amount: target, blocked: false };
		}
		try {
			const res = await apiService.fetch(`/api/payments/transactions/${encodeURIComponent(String(keep['id'] ?? ''))}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ amount: target, description, notes }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null) as { message?: string } | null;
				return { action: 'none', amount: target, blocked: false, error: body?.message || `The payment service returned ${res.status}.` };
			}
			return { action: 'updated', amount: target, blocked: false };
		} catch (e) {
			return { action: 'none', amount: target, blocked: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	try {
		const res = await apiService.fetch('/api/payments/collect', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				patientId,
				patientName: opts.patientName,
				amount: target,
				// See the file header: 'copay' is what every downstream consumer
				// matches on. `selfpay=1` is what distinguishes this record.
				transactionType: 'copay',
				paymentMethodType: 'other',
				status: 'pending',
				referenceType: 'claim',
				claimId: opts.claimRef,
				feeSheetId: opts.feeSheetId,
				encounterId: opts.encounterId,
				dateOfService: opts.serviceDate || undefined,
				description,
				notes,
			}),
		});
		if (!res.ok) {
			const body = await res.json().catch(() => null) as { message?: string } | null;
			return { action: 'none', amount: target, blocked: false, error: body?.message || `The payment service returned ${res.status}.` };
		}
		return { action: 'created', amount: target, blocked: false };
	} catch (e) {
		return { action: 'none', amount: target, blocked: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * The description a self-pay balance carries. `— claim CLM-0012` is the exact
 * phrasing the ledger's and the Dashboard's claim-link regexes already match,
 * so the balance attaches to its claim on every surface.
 */
function selfPayDescription(claimRef: string, amount: number): string {
	// allow-any-unicode-next-line
	return `Self-pay balance — patient has no insurance on file, full charge due from patient `
		// allow-any-unicode-next-line
		+ `— claim ${claimRef} | ${SELF_PAY_NOTE}; due=${amount.toFixed(2)}`;
}

async function deleteTxn(apiService: ICiyexApiService, txn: Record<string, unknown>): Promise<boolean> {
	const id = String(txn['id'] ?? '').trim();
	if (!id) { return false; }
	try {
		const res = await apiService.fetch(`/api/payments/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
		return res.ok;
	} catch {
		return false;
	}
}
