/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICiyexApiService } from '../ciyexApiService.js';

/**
 * Reading a patient's insurance coverage — and the one answer to "does this
 * patient have insurance?".
 *
 * Coverage is a FHIR `Coverage` resource behind the generic FHIR controller
 * (`/api/fhir-resource/insurance-coverage`), so every field arrives loosely
 * typed and loosely named: the payer alone appears as `payerName`,
 * `insurerName`, `organizationDisplay`, `payor[0].display` and half a dozen
 * other spellings depending on which writer created the record. The alias
 * chains below are the union of what the chart, the reports and the 837P
 * exporter each match on today.
 *
 * `insuranceType` ("primary" / "secondary" / "tertiary") is the only tiering
 * mechanism, and nothing enforces one-primary-per-patient — so `activeCoverage`
 * PREFERS a primary but never requires one.
 */

/** One coverage record on a patient, normalized to stable field names. */
export interface IPatientCoverage {
	id: string;
	/** primary | secondary | tertiary (lowercased; '' when the writer omitted it). */
	tier: string;
	payerName: string;
	planName: string;
	/** Member / policy / subscriber id — what the payer knows the patient by. */
	memberId: string;
	groupNumber: string;
	/** active | inactive (lowercased; '' when the writer omitted it). */
	status: string;
	/** Fixed per-visit copay, if the policy carries one. */
	copayAmount: number;
	/** Electronic payer id, when the record happens to carry one (rare). */
	payerId: string;
}

function listOf(payload: unknown): Array<Record<string, unknown>> {
	const p = payload as { data?: unknown; content?: unknown } | unknown[] | null;
	const w = (p as { data?: unknown })?.data ?? p;
	const list = (w as { content?: unknown })?.content ?? w;
	return Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
}

/** First non-empty string among a record's aliases for one logical field. */
function alias(record: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const v = record[key];
		if (typeof v === 'string' && v.trim()) { return v.trim(); }
		// Some writers nest the payer as `payor: [{ display }]`.
		if (Array.isArray(v)) {
			const display = (v[0] as { display?: string } | undefined)?.display;
			if (display && String(display).trim()) { return String(display).trim(); }
		}
	}
	return '';
}

/**
 * `copayAmount` is a free-text field on the insurance form (no validation
 * pattern), so it can hold "$25", "25.00" or garbage — strip everything that
 * isn't a number before trusting it.
 */
function money(value: unknown): number {
	const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
	return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeCoverage(c: Record<string, unknown>): IPatientCoverage {
	return {
		id: String(c['id'] ?? ''),
		tier: alias(c, ['insuranceType', 'tier', 'coverageType', 'type', 'priority']).toLowerCase(),
		payerName: alias(c, [
			'payerName', 'insurerName', 'insuranceName', 'insuranceCompanyName', 'insuranceCompany',
			'companyName', 'organizationDisplay', 'organizationName', 'payerDisplay', 'insurerDisplay',
			'payor', 'coverageName', 'name',
		]),
		planName: alias(c, ['planName', 'plan', 'policyType']),
		memberId: alias(c, ['policyNumber', 'memberId', 'subscriberId']),
		groupNumber: alias(c, ['groupNumber', 'group']),
		status: alias(c, ['status']).toLowerCase(),
		copayAmount: money(c['copayAmount']),
		payerId: alias(c, ['payerId']),
	};
}

/**
 * Every coverage record on file for a patient, normalized. Returns an empty
 * array when the patient has none, when the request fails and when the caller
 * has no patient — "no coverage" and "could not tell" deliberately look the
 * same to callers, because both mean "do not claim this patient is insured".
 */
export async function loadPatientCoverages(apiService: ICiyexApiService, patientId: string): Promise<IPatientCoverage[]> {
	const id = String(patientId ?? '').trim();
	if (!id || id === '_') { return []; }
	try {
		const res = await apiService.fetch(`/api/fhir-resource/insurance-coverage/patient/${encodeURIComponent(id)}?page=0&size=10`);
		if (!res.ok) { return []; }
		return listOf(await res.json())
			.map(c => normalizeCoverage(c))
			// A record with neither a payer nor a member id is an empty shell the
			// form saved — it cannot be billed to anyone.
			.filter(c => c.payerName || c.memberId);
	} catch {
		return [];
	}
}

/**
 * The coverage a claim should be billed to: an ACTIVE primary first, then any
 * active policy, and only then an inactive one (which the 837P exporter has
 * always fallen back to). Returns undefined when the patient has nothing
 * billable on file — i.e. when they are self-pay.
 */
export function activeCoverage(coverages: IPatientCoverage[]): IPatientCoverage | undefined {
	const active = coverages.filter(c => /active/i.test(c.status));
	return active.find(c => /primary/i.test(c.tier)) ?? active[0] ?? coverages[0];
}

/**
 * True when the patient has an ACTIVE policy on file. Deliberately stricter
 * than `activeCoverage`, which falls back to an expired policy so the 837P
 * exporter can still name a payer: an inactive policy must NOT route a claim
 * into the insurance flow, because no EOB will ever come back for it.
 */
export function hasActiveInsurance(coverages: IPatientCoverage[]): boolean {
	return coverages.some(c => /active/i.test(c.status) && (!!c.payerName || !!c.memberId));
}

/** Short "Aetna PPO · Member ****1234" label for the Bill To control. */
export function coverageLabel(coverage: IPatientCoverage | undefined): string {
	if (!coverage) { return ''; }
	const parts = [coverage.payerName || 'Insurance'];
	if (coverage.planName && coverage.planName !== coverage.payerName) { parts.push(coverage.planName); }
	const member = coverage.memberId;
	// allow-any-unicode-next-line
	if (member) { parts.push(`Member ${member.length > 4 ? `••••${member.slice(-4)}` : member}`); }
	// allow-any-unicode-next-line
	return parts.join(' · ');
}
