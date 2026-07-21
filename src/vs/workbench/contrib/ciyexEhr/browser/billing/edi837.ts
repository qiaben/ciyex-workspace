/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Client-side ANSI X12 005010X222A1 837P (Professional claim) generator.
 *
 * This runs entirely in the workbench so the BASIC claims tier works WITHOUT
 * the paid ciyex-rcm subscription: a practice captures charges on the Fee
 * Sheet, "Send to Billing" creates the native claim, and this module turns
 * that claim into a downloadable 837P EDI file the practice hands to its OWN
 * clearinghouse. Mirrors the segment structure of ciyex-rcm's server-side
 * Edi837PGenerator so a claim exported here is interchangeable with one the
 * RCM service would have produced.
 *
 * Scope note: this builds a single-claim 837P envelope with the fields the
 * EHR has on hand (charges, diagnoses, subscriber, payer, billing/rendering
 * provider). Site-specific identifiers the fee sheet doesn't carry (submitter
 * id, receiver/clearinghouse id, billing NPI + tax id, practice address) come
 * from the `ciyex.billing.*` settings. Fields left blank are the ones a
 * clearinghouse typically enriches or the practice fills in its portal.
 */

/** X12 delimiters (5010 defaults). */
const ELEMENT = '*';
const SUB_ELEMENT = ':';
const SEGMENT = '~';
const REPETITION = '^';

/** Accumulates X12 segments and renders the interchange. */
class X12Builder {
	private readonly segments: string[] = [];

	/** Add a segment from its elements; trailing empty elements are trimmed. */
	add(...elements: string[]): void {
		let last = elements.length;
		while (last > 0 && (elements[last - 1] === undefined || elements[last - 1] === '')) { last--; }
		this.segments.push(elements.slice(0, last).map(e => e ?? '').join(ELEMENT));
	}

	/** Add a pre-composed segment (e.g. the HI diagnosis segment). */
	addRaw(segment: string): void {
		this.segments.push(segment);
	}

	/** Segment count excluding ISA/GS/GE/IEA — used for the SE trailer. */
	get stCount(): number {
		return this.segments.filter(s => !/^(ISA|GS|GE|IEA)\b/.test(s)).length;
	}

	build(): string {
		return this.segments.map(s => s + SEGMENT).join('\n') + '\n';
	}
}

/** A billable service line (one CPT/HCPCS procedure). */
export interface Edi837ServiceLine {
	cptCode: string;
	modifiers?: string[];
	chargeAmount: number;
	units: number;
	placeOfService?: string;
	/** 1-based diagnosis pointers into the claim's diagnosis list. */
	diagnosisPointers?: number[];
	dateOfService?: string;
}

/** Everything needed to render one 837P professional claim. */
export interface Edi837Claim {
	// Submitter / receiver. Interchange IDs (submitterId/receiverId) are
	// clearinghouse-assigned and come from the ciyex.billing.* settings; the
	// names/contact come from the practice record.
	submitterId: string;
	submitterName: string;
	submitterContactName?: string;
	submitterPhone?: string;
	submitterEmail?: string;
	receiverId: string;
	receiverName: string;
	usageIndicator?: 'P' | 'T';

	// Billing provider (the practice)
	billingName: string;
	billingNpi: string;
	billingTaxId: string;
	billingAddress1?: string;
	billingAddress2?: string;
	billingCity?: string;
	billingState?: string;
	billingZip?: string;

	// Subscriber / patient (subscriber === patient in the basic self-insured case)
	patientFirstName: string;
	patientLastName: string;
	patientDob?: string;
	patientGender?: string;
	patientAddress1?: string;
	patientCity?: string;
	patientState?: string;
	patientZip?: string;
	subscriberId: string;
	groupNumber?: string;

	// Payer
	payerName: string;
	payerId?: string;

	// Claim header
	claimNumber: string;
	totalCharge: number;
	placeOfService?: string;
	dateOfService?: string;
	authorizationNumber?: string;
	renderingProviderNpi?: string;
	renderingProviderFirstName?: string;
	renderingProviderLastName?: string;
	/** Provider taxonomy code (PXC) for the rendering provider PRV segment. */
	renderingProviderTaxonomy?: string;
	referringProviderNpi?: string;

	/** ICD-10 diagnosis codes, ordered (first = principal). */
	diagnoses: string[];
	lines: Edi837ServiceLine[];
}

/** yyyy-MM-dd (or Date-ish string) → CCYYMMDD. Empty for unparseable input. */
function formatDate(value?: string): string {
	if (!value) { return ''; }
	const d = String(value).slice(0, 10).replace(/[^0-9]/g, '');
	return d.length === 8 ? d : '';
}

/** Two-decimal charge string with no thousands separators. */
function formatAmount(n: number): string {
	return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function pad(value: string, width: number, right: boolean): string {
	const v = (value || '').slice(0, width);
	const fill = ' '.repeat(Math.max(0, width - v.length));
	return right ? v + fill : fill + v;
}

/** Monotonic-ish control number without Date.now (unavailable in some hosts). */
function controlNumber(seed: number): string {
	return String(100000000 + (Math.abs(seed) % 899999999));
}

/**
 * Render a single professional claim as an 837P interchange string.
 * `now` is passed in (Date usage is centralized at the call site) so this
 * stays pure and testable.
 */
export function generate837P(claim: Edi837Claim, now: Date): string {
	const b = new X12Builder();
	const ctrl = controlNumber(now.getTime());
	const ccyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
	const yymmdd = ccyymmdd.slice(2);
	const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
	const usage = claim.usageIndicator || 'T';

	// ISA - Interchange Control Header (fixed-width elements)
	b.add('ISA', '00', pad('', 10, true), '00', pad('', 10, true),
		'ZZ', pad(claim.submitterId, 15, true), 'ZZ', pad(claim.receiverId, 15, true),
		yymmdd, hhmm, REPETITION, '00501', pad(ctrl, 9, false), '0', usage, SUB_ELEMENT);

	// GS - Functional Group Header
	b.add('GS', 'HC', claim.submitterId, claim.receiverId, ccyymmdd, hhmm, ctrl, 'X', '005010X222A1');

	// ST - Transaction Set Header
	b.add('ST', '837', '0001', '005010X222A1');

	// BHT - Beginning of Hierarchical Transaction
	b.add('BHT', '0019', '00', claim.claimNumber, ccyymmdd, hhmm, 'CH');

	// 1000A Submitter / 1000B Receiver
	b.add('NM1', '41', '2', claim.submitterName, '', '', '', '', '46', claim.submitterId);
	// PER - Submitter contact: name + phone (TE) + email (EM) when known.
	const contact = ['PER', 'IC', claim.submitterContactName || claim.submitterName];
	const phone = (claim.submitterPhone || '').replace(/[^0-9]/g, '');
	if (phone) { contact.push('TE', phone); }
	if (claim.submitterEmail) { contact.push('EM', claim.submitterEmail); }
	b.add(...contact);
	b.add('NM1', '40', '2', claim.receiverName, '', '', '', '', '46', claim.receiverId);

	// 2000A Billing Provider HL
	b.add('HL', '1', '', '20', '1');
	b.add('NM1', '85', '2', claim.billingName, '', '', '', '', 'XX', claim.billingNpi);
	if (claim.billingAddress1) { b.add('N3', claim.billingAddress1, claim.billingAddress2 || ''); }
	if (claim.billingCity || claim.billingState || claim.billingZip) {
		b.add('N4', claim.billingCity || '', claim.billingState || '', (claim.billingZip || '').replace(/[^0-9]/g, ''));
	}
	b.add('REF', 'EI', claim.billingTaxId);

	// 2000B Subscriber HL (subscriber === patient for the basic tier)
	b.add('HL', '2', '1', '22', '0');
	b.add('SBR', 'P', '18', claim.groupNumber || '', '', '', '', '', '', 'CI');
	b.add('NM1', 'IL', '1', claim.patientLastName, claim.patientFirstName, '', '', '', 'MI', claim.subscriberId);
	if (claim.patientAddress1) { b.add('N3', claim.patientAddress1); }
	if (claim.patientCity || claim.patientState || claim.patientZip) {
		b.add('N4', claim.patientCity || '', claim.patientState || '', (claim.patientZip || '').replace(/[^0-9]/g, ''));
	}
	if (claim.patientDob || claim.patientGender) {
		b.add('DMG', 'D8', formatDate(claim.patientDob), (claim.patientGender || '').charAt(0).toUpperCase() || 'U');
	}
	// 2010BB Payer
	b.add('NM1', 'PR', '2', claim.payerName, '', '', '', '', 'PI', claim.payerId || '');

	// 2300 Claim Information
	const pos = (claim.placeOfService || '11');
	b.add('CLM', claim.claimNumber, formatAmount(claim.totalCharge), '', '',
		`${pos}${SUB_ELEMENT}B${SUB_ELEMENT}1`, 'Y', 'A', 'Y', 'I');
	if (claim.dateOfService) { b.add('DTP', '434', 'D8', formatDate(claim.dateOfService)); }
	if (claim.authorizationNumber) { b.add('REF', 'G1', claim.authorizationNumber); }

	// HI - Diagnosis Codes (up to 12; ABK principal, ABF subsequent)
	const dx = claim.diagnoses.filter(Boolean).slice(0, 12);
	if (dx.length) {
		const hi = ['HI'];
		dx.forEach((code, i) => {
			hi.push(`${i === 0 ? 'ABK' : 'ABF'}${SUB_ELEMENT}${code.replace(/\./g, '')}`);
		});
		b.addRaw(hi.join(ELEMENT));
	}

	// Referring / rendering provider (claim level)
	if (claim.referringProviderNpi) { b.add('NM1', 'DN', '1', '', '', '', '', '', 'XX', claim.referringProviderNpi); }
	if (claim.renderingProviderNpi || claim.renderingProviderLastName) {
		// 2310B Rendering Provider — name + NPI (XX qualifier when NPI present).
		b.add('NM1', '82', '1', claim.renderingProviderLastName || '', claim.renderingProviderFirstName || '',
			'', '', '', claim.renderingProviderNpi ? 'XX' : '', claim.renderingProviderNpi || '');
		// PRV*PE - Rendering provider taxonomy (specialty).
		if (claim.renderingProviderTaxonomy) { b.add('PRV', 'PE', 'PXC', claim.renderingProviderTaxonomy); }
	}

	// 2400 Service Lines
	claim.lines.forEach((line, idx) => {
		const lineNum = idx + 1;
		b.add('LX', String(lineNum));
		const proc = ['HC', line.cptCode, ...(line.modifiers || []).filter(Boolean)].join(SUB_ELEMENT);
		const pointers = (line.diagnosisPointers && line.diagnosisPointers.length ? line.diagnosisPointers : [1]).join(SUB_ELEMENT);
		b.add('SV1', proc, formatAmount(line.chargeAmount), 'UN', String(line.units || 1),
			line.placeOfService || pos, '', pointers);
		const dos = line.dateOfService || claim.dateOfService;
		if (dos) { b.add('DTP', '472', 'D8', formatDate(dos)); }
		b.add('REF', '6R', `${claim.claimNumber}-${lineNum}`);
	});

	// SE / GE / IEA trailers (+1 on stCount to include the SE segment itself)
	b.add('SE', String(b.stCount + 1), '0001');
	b.add('GE', '1', ctrl);
	b.add('IEA', '1', pad(ctrl, 9, false));

	return b.build();
}

/**
 * Claim number for a fee sheet. Derived from the auto-increment fee-sheet id,
 * so claim numbers are themselves auto-incrementing (CLM-0001, CLM-0002, …)
 * without a separate claim registry — in the RCM-lite flow the billed fee
 * sheet IS the claim.
 */
export function claimNumberForFeeSheet(feeSheetId: string | number): string {
	const raw = String(feeSheetId ?? '').trim();
	const digits = raw.replace(/\D/g, '');
	return digits ? `CLM-${digits.padStart(4, '0')}` : `CLM-${raw}`;
}

/**
 * Canonical form of a claim reference for matching EOB postings to fee
 * sheets: `CLM-0012`, `clm12`, `FS12` and `12` all normalize to `12` (older
 * postings used `FS{id}` claim numbers). Non-numeric refs (e.g. encounter
 * UUIDs) normalize to their lowercased alphanumeric form.
 */
export function normalizeClaimRef(ref: string | number): string {
	const s = String(ref ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
	const m = s.match(/^(?:clm|fs)?0*(?<id>\d+)$/);
	return m?.groups?.id ?? s;
}

/** Trigger a browser download of the EDI text as a .837 file. */
export function downloadEdi(targetWindow: Window, filename: string, content: string): void {
	const blob = new Blob([content], { type: 'application/edi-x12' });
	const url = URL.createObjectURL(blob);
	const a = targetWindow.document.createElement('a');
	a.href = url;
	a.download = filename;
	targetWindow.document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoke on the next tick so the click's navigation has consumed the URL.
	targetWindow.setTimeout(() => URL.revokeObjectURL(url), 0);
}
