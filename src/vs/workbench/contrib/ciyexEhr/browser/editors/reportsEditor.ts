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
import { enablePickerClick, usToIsoDate, maskUsDate } from '../ciyexDateMask.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { ReportsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createTrustedTypesPolicy } from '../../../../../base/browser/trustedTypes.js';

const _printTtPolicy = createTrustedTypesPolicy('ciyexEhrPrint', { createHTML: (html: string) => html });

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#14b8a6'];
const INPUT_STYLE = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';
const BTN_SECONDARY = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';

interface ColumnDef {
	key: string;
	label: string;
}

interface FilterDef {
	type: 'date-from' | 'date-to' | 'select';
	key: string;
	label: string;
	options?: Array<{ value: string; label: string }>;
	/** When true, render a popover with a search input above the option list. */
	searchable?: boolean;
	/** When true, derive the option list from the loaded items using `dynamicKey` (or `key`). */
	dynamic?: boolean;
	dynamicKey?: string;
	/** Placeholder shown inside the search box. */
	searchPlaceholder?: string;
}

interface KpiDef {
	label: string;
	calc: (items: Record<string, string>[]) => string;
	color?: string;
}

interface ChartDef {
	type: 'bar' | 'pie' | 'donut' | 'horizontalBar' | 'line' | 'area';
	/** Field key used for grouping. Ignored for time-series/day-of-week (`dateField` is used). */
	groupKey: string;
	label: string;
	/**
	 * Aggregation mode. 'count' (default) groups by `groupKey` and counts items.
	 * 'month' aggregates by YYYY-MM extracted from `dateField`.
	 * 'day-of-week' aggregates by Mon..Sun extracted from `dateField`.
	 * 'hour' aggregates by 0..23 extracted from `dateField`.
	 */
	aggregate?: 'count' | 'month' | 'day-of-week' | 'hour';
	/** Date field used by month/day-of-week/hour aggregation. */
	dateField?: string;
	/** Maximum bars to show for bar/horizontalBar charts. Defaults to 12 (or 10 for top-N). */
	limit?: number;
	/** When true and aggregate is 'count', only show the top N most-common values. */
	topN?: boolean;
}

interface ReportDef {
	apiPath: string;
	columns: ColumnDef[];
	filters: FilterDef[];
	kpis: KpiDef[];
	charts: ChartDef[];
	pageSize?: number;
	/**
	 * Message shown in the table body when the report loads zero rows (as opposed to
	 * the user's filters excluding everything). Reports that legitimately compute an
	 * empty result set — e.g. derived Care Gaps when no patient is overdue — set this
	 * so the table reads as an intentional "nothing due" state rather than looking
	 * broken. When unset, the generic "No records match the current filters" is used.
	 */
	emptyMessage?: string;
	/**
	 * When true, after the main fetch we enrich each patient row with its insurance/payer name
	 * by loading coverage data (the `/api/patients` endpoint does not include insurance). This
	 * mirrors ciyex-ehr-ui's patient-demographics report which joins coverage data.
	 */
	enrichInsurance?: boolean;
	/**
	 * When true, after the main fetch we fill each row's `patientName` from its
	 * `patientId` by joining the patient list. Payment-transaction endpoints
	 * return `patientName: null` (only `patientId`), so the Patient column would
	 * otherwise render blank.
	 */
	enrichPatient?: boolean;
	/**
	 * When true, after the main fetch we fill each patient row's provider
	 * (`providerDisplay`/`providerName`) by joining the encounter list — the
	 * `/api/patients` endpoint carries no provider, so the Provider column would
	 * otherwise render blank. The most recent encounter's `providerDisplay` wins.
	 */
	enrichProvider?: boolean;
	/**
	 * When true, derive A/R aging fields client-side from each payment row. The
	 * backend exposes no A/R ledger (`/api/invoices`, `/api/*ar-aging` all 500),
	 * so the days0_30 / days31_60 / days61_90 / days90Plus buckets, `payerDisplay`
	 * and `outstandingAmount` are computed from the transaction amount and the age
	 * of its collected date — otherwise those columns render blank.
	 */
	computeArAging?: boolean;
	/**
	 * When true, the TABLE renders one aggregated row per provider (grouped on
	 * `providerDisplay`) instead of one row per raw encounter — filling the
	 * per-provider `encounters` count and `patientsPerDay` that don't exist on an
	 * individual encounter (why the Provider Productivity table looked empty
	 * beyond the Provider column). KPIs and charts keep using the raw rows, so the
	 * "Encounters by Provider" counts stay correct. wRVU/charges/collections have
	 * no encounter-side source and remain blank.
	 */
	groupByProvider?: boolean;

	/**
	 * When set, the Payer Mix table collapses raw patient rows into one row per
	 * payer with a `patientCount` and `patientPct` that don't exist on an
	 * individual patient (why the table looked empty beyond the Payer column).
	 * KPIs and charts keep using the raw rows, so the by-payer counts stay
	 * correct. revenue/revenuePct/avgReimbRate have no patient-side source (they
	 * need a payments join the backend doesn't expose) and remain blank.
	 */
	groupByPayer?: boolean;

	/**
	 * When set, the Scheduling Utilization table collapses raw appointment rows
	 * into one row per provider with `booked` (count), `completed` (count) and
	 * `utilization` (kept ÷ booked) that don't exist on an individual appointment
	 * (why the table looked empty beyond the Provider column). KPIs and charts
	 * keep using the raw rows. `availableSlots` (no free-slot feed) and `revenue`
	 * (needs a payments join the backend doesn't expose) remain blank.
	 */
	groupBySchedule?: boolean;

	/**
	 * When set, the Disease Registry table collapses raw encounter rows into one
	 * row per condition (`totalPatients` = distinct patients, `avgDaysSinceVisit`
	 * = mean days since each patient's most recent visit for that condition).
	 * `controlled`/`controlPct` have no encounter-side source and stay blank.
	 */
	groupByCondition?: boolean;
	/**
	 * When set, join the encounter list once and stamp each patient row with
	 * `lastVisit` / `daysSinceVisit` / `visitCount12mo` / `edVisits12mo`. Powers
	 * the derived Care Gaps and Risk Stratification reports (the patient feed
	 * carries no visit history).
	 */
	enrichEncounterStats?: boolean;
	/**
	 * When set, derive real, actionable care gaps per patient from data that ships:
	 * an overdue wellness visit (>180d since last visit, or never seen), a chronic-
	 * condition follow-up lapse (>90d with a chronic problem/complaint on record) and
	 * a missing immunization (needs {@link enrichEncounterStats}; the immunization gap
	 * also needs {@link enrichImmunizations}). A patient can surface more than one gap
	 * — each is its own row. Patients with no open gap are dropped so the table lists
	 * only actionable items — the backend has no care-gap engine, so this is the
	 * honest, computable substitute ({@link _deriveCareGaps}).
	 */
	deriveCareGaps?: boolean;
	/**
	 * When set, derive a utilization-based risk score/tier per patient from visit
	 * and ED-visit frequency (needs {@link enrichEncounterStats}). The backend has
	 * no risk-scoring engine; this is a transparent proxy, not a clinical model.
	 */
	deriveRisk?: boolean;
	/**
	 * When set, fill each patient row's `conditions` from its problem list. There is
	 * no bulk conditions endpoint (GenericFhirResourceController only exposes
	 * patient-scoped routes), so this fans out one `/api/fhir-resource/conditions/patient/{id}`
	 * request per row — batched and capped ({@link _enrichConditions}) — and degrades
	 * to a blank cell when a tenant records no problems.
	 */
	enrichConditions?: boolean;
	/**
	 * When set, join the practice immunization feed (`/api/immunizations`) by patient
	 * id and stamp each row's `hasImmunization` flag ({@link _enrichImmunizations}).
	 * Powers the Care Gaps "Immunization" gap type (a patient with no immunization on
	 * record is an open gap). Degrades to "no gap" when the feed is empty/unavailable.
	 */
	enrichImmunizations?: boolean;
	/**
	 * When set, replace the loaded claim rows with one row per claim LINE, fetched
	 * from the deployed `/api/all-claims/{claimId}/line-details` endpoint. CPT/
	 * procedure codes live on claim line items, not on the bulk claim record, and
	 * the practice-wide invoice-line report endpoint is unbuilt on api-dev — so the
	 * CPT Utilization report fans out per-claim line lookups ({@link _deriveCptFromClaimLines})
	 * to assemble cptCode/description/provider/charge/date rows from data that
	 * actually ships. Degrades to an empty table when no claims carry line items.
	 */
	deriveCptFromClaimLines?: boolean;
}

// FHIR v3 ActEncounterCode class codes — the /api/encounters/report/encounterAll
// endpoint returns these raw codes (AMB/VR/EMER/…) in the `type` field, which
// rendered as cryptic codes in the Encounter Summary "Visit Type" column. Map
// them to the human-readable labels the rest of the app uses.
const ENCOUNTER_CLASS_LABELS: Record<string, string> = {
	AMB: 'Ambulatory',
	VR: 'Virtual',
	VIRTUAL: 'Virtual',
	EMER: 'Emergency',
	IMP: 'Inpatient',
	ACUTE: 'Inpatient Acute',
	NONAC: 'Inpatient Non-acute',
	OBSENC: 'Observation',
	PRENC: 'Pre-admission',
	SS: 'Short Stay',
	HH: 'Home Health',
	FLD: 'Field',
};

const DATE_FROM: FilterDef = { type: 'date-from', key: 'dateFrom', label: 'From' };
const DATE_TO: FilterDef = { type: 'date-to', key: 'dateTo', label: 'To' };
const PROVIDER_FILTER: FilterDef = { type: 'select', key: 'provider', label: 'Provider', searchable: true, dynamic: true };
const PATIENT_FILTER: FilterDef = { type: 'select', key: 'patient', label: 'Patient', searchable: true, dynamic: true };
const PAYER_FILTER: FilterDef = { type: 'select', key: 'payer', label: 'Payer', searchable: true, dynamic: true };

const DEFAULT_FILTERS: FilterDef[] = [DATE_FROM, DATE_TO, PROVIDER_FILTER];

const STATUS_FILTER = (options: Array<{ value: string; label: string }>): FilterDef => (
	{ type: 'select', key: 'status', label: 'Status', options }
);

const countWhere = (items: Record<string, string>[], pred: (i: Record<string, string>) => boolean): number => items.filter(pred).length;

const fmtMoney = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (n: number): string => `${n.toFixed(1)}%`;

function getReportDef(key: string): ReportDef {
	switch (key) {
		// allow-any-unicode-next-line
		// ─── CLINICAL ───
		case 'patient-demographics':
			return {
				apiPath: '/api/patients?page=0&size=1000',
				enrichInsurance: true,
				enrichProvider: true,
				columns: [
					{ key: 'name', label: 'Name' },
					{ key: 'gender', label: 'Gender' },
					{ key: 'birthDate', label: 'Date of Birth' },
					{ key: 'ageGroup', label: 'Age Group' },
					{ key: 'active', label: 'Status' },
					{ key: 'insurance', label: 'Insurance' },
					{ key: 'providerDisplay', label: 'Provider' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER,
					{
						type: 'select', key: 'gender', label: 'Gender', options: [
							{ value: '', label: 'All Gender' },
							{ value: 'male', label: 'Male' },
							{ value: 'female', label: 'Female' },
							{ value: 'other', label: 'Other' },
							{ value: 'unknown', label: 'Unknown' },
						]
					},
					{
						type: 'select', key: 'ageGroup', label: 'Age Group', options: [
							{ value: '', label: 'All Age Group' },
							{ value: '0-17', label: '0-17' },
							{ value: '18-29', label: '18-29' },
							{ value: '30-49', label: '30-49' },
							{ value: '50-64', label: '50-64' },
							{ value: '65+', label: '65+' },
						]
					},
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'Active', label: 'Active' },
						{ value: 'Inactive', label: 'Inactive' },
					]),
					{ type: 'select', key: 'insurance', label: 'Insurance', searchable: true, dynamic: true },
				],
				kpis: [
					{ label: 'Total Patients', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Active', calc: items => String(countWhere(items, i => /active/i.test(i.active || ''))), color: COLORS[1] },
					{
						label: 'New This Month', calc: items => {
							const now = new Date(); const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
							return String(countWhere(items, i => { const d = i.createdAt || i.registrationDate; return !!d && new Date(d).getTime() >= mStart; }));
						}, color: COLORS[2]
					},
					{
						label: 'Avg Age', calc: items => {
							const now = new Date();
							const ages = items.map(i => i.birthDate).filter(Boolean).map(d => now.getFullYear() - new Date(d).getFullYear()).filter(a => a > 0 && a < 130);
							if (ages.length === 0) { return '0'; }
							return String(Math.round(ages.reduce((a, b) => a + b, 0) / ages.length));
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: 'ageGroup', label: 'Age Distribution' },
					{ type: 'pie', groupKey: 'gender', label: 'Gender Distribution' },
					{ type: 'donut', groupKey: 'active', label: 'Patient Status' },
					{ type: 'donut', groupKey: 'ageGroup', label: 'By Age Group' },
				],
			};

		case 'encounter-summary':
			return {
				apiPath: '/api/encounters/report/encounterAll?page=0&size=1000',
				columns: [
					{ key: 'startDate', label: 'Date' },
					{ key: 'patientRefDisplay', label: 'Patient' },
					{ key: 'providerDisplay', label: 'Provider' },
					{ key: 'type', label: 'Visit Type' },
					{ key: 'status', label: 'Status' },
					{ key: 'diagnosis', label: 'Diagnosis' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER,
					{ type: 'select', key: 'visitType', label: 'Visit Type', searchable: true, dynamic: true },
					// Status values come from the backend encounterAll endpoint: SIGNED / UNSIGNED / INCOMPLETE.
					// (matched case-insensitively against the row's status). Include both raw and friendly labels.
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'signed', label: 'Signed' },
						{ value: 'unsigned', label: 'Unsigned' },
						{ value: 'incomplete', label: 'Incomplete' },
						{ value: 'completed', label: 'Completed' },
						{ value: 'cancelled', label: 'Cancelled' },
						{ value: 'pending', label: 'Pending' },
					]),
					// Diagnosis filter (dynamic, derived from the loaded encounter rows' diagnosis field)
					{ type: 'select', key: 'diagnosis', label: 'Diagnosis', searchable: true, dynamic: true, searchPlaceholder: 'Search diagnosis...' },
				],
				kpis: [
					{ label: 'Total Encounters', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Completed', calc: items => String(countWhere(items, i => /complet|finished|signed/i.test(i.status || ''))), color: COLORS[1] },
					{ label: 'Unsigned', calc: items => String(countWhere(items, i => /unsigned|in[-_ ]?progress|draft/i.test(i.status || ''))), color: COLORS[2] },
					{
						label: 'Avg / Day', calc: items => {
							const dates = new Set(items.map(i => (i.startDate || '').slice(0, 10)).filter(Boolean));
							return dates.size ? (items.length / dates.size).toFixed(1) : '0';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'area', groupKey: '', label: 'Monthly Volume', aggregate: 'month', dateField: 'startDate' },
					{ type: 'bar', groupKey: 'type', label: 'By Visit Type' },
					{ type: 'pie', groupKey: 'status', label: 'By Status' },
					{ type: 'bar', groupKey: '', label: 'By Day of Week', aggregate: 'day-of-week', dateField: 'startDate' },
				],
			};

		case 'lab-orders---results':
		case 'lab-orders-results':
			return {
				apiPath: '/api/lab-order/search?q=',
				columns: [
					{ key: 'orderDate', label: 'Order Date' },
					{ key: 'patientName', label: 'Patient' },
					{ key: 'testDisplay', label: 'Test' },
					{ key: 'status', label: 'Status' },
					{ key: 'priority', label: 'Priority' },
					{ key: 'orderingProvider', label: 'Ordering Provider' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER,
					{ type: 'select', key: 'test', label: 'Test', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'active', label: 'Active' },
						{ value: 'completed', label: 'Completed' },
						{ value: 'cancelled', label: 'Cancelled' },
						{ value: 'pending', label: 'Pending' },
					]),
					{
						type: 'select', key: 'priority', label: 'Priority', options: [
							{ value: '', label: 'All Priority' },
							{ value: 'routine', label: 'Routine' },
							{ value: 'stat', label: 'STAT' },
							{ value: 'urgent', label: 'Urgent' },
						]
					},
				],
				kpis: [
					{ label: 'Total Orders', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Pending Results', calc: items => String(countWhere(items, i => /pending|in[-_ ]?progress|active/i.test(i.status || ''))), color: COLORS[1] },
					{ label: 'Completed', calc: items => String(countWhere(items, i => /complet|final|resulted/i.test(i.status || ''))), color: COLORS[2] },
					{ label: 'STAT Orders', calc: items => String(countWhere(items, i => /stat/i.test(i.priority || ''))), color: COLORS[3] },
				],
				charts: [
					{ type: 'pie', groupKey: 'status', label: 'By Status' },
					{ type: 'bar', groupKey: 'priority', label: 'By Priority' },
					{ type: 'line', groupKey: '', label: 'Monthly Volume', aggregate: 'month', dateField: 'orderDate' },
					{ type: 'donut', groupKey: 'testDisplay', label: 'By Test' },
				],
			};

		case 'medication---prescriptions':
		case 'medication-prescriptions':
			return {
				apiPath: '/api/prescriptions?page=0&size=1000',
				columns: [
					{ key: 'createdAt', label: 'Date' },
					{ key: 'patientName', label: 'Patient' },
					{ key: 'medicationName', label: 'Medication' },
					{ key: 'status', label: 'Status' },
					{ key: 'prescriberName', label: 'Prescriber' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER, PATIENT_FILTER,
					{ type: 'select', key: 'medication', label: 'Medication', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'active', label: 'Active' },
						{ value: 'completed', label: 'Completed' },
						{ value: 'discontinued', label: 'Discontinued' },
						{ value: 'on-hold', label: 'On Hold' },
					]),
					{ type: 'select', key: 'prescriber', label: 'Prescriber', searchable: true, dynamic: true },
				],
				kpis: [
					{ label: 'Total Prescriptions', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Active', calc: items => String(countWhere(items, i => /active/i.test(i.status || ''))), color: COLORS[1] },
					{ label: 'Refill Requests', calc: items => String(countWhere(items, i => /refill/i.test(i.status || '') || /refill/i.test(i.requestType || ''))), color: COLORS[2] },
					{ label: 'Controlled', calc: items => String(countWhere(items, i => /controll|schedule[-_ ]?[ivx]/i.test(i.medicationName || '') || i.controlled === 'true')), color: COLORS[3] },
				],
				charts: [
					{ type: 'donut', groupKey: 'status', label: 'By Status' },
					{ type: 'horizontalBar', groupKey: 'medicationName', label: 'Top Medications', limit: 10 },
					{ type: 'pie', groupKey: 'patientName', label: 'By Patient' },
					{ type: 'pie', groupKey: 'prescriberName', label: 'By Prescriber' },
					{ type: 'area', groupKey: '', label: 'Monthly Prescribing Volume', aggregate: 'month', dateField: 'createdAt' },
				],
			};

		case 'referral-tracking':
			return {
				apiPath: '/api/referrals?page=0&size=1000',
				// Columns match ciyex-ehr-ui: Date, Patient, Referred To, Specialty, Status, Urgency
				columns: [
					{ key: 'referralDate', label: 'Date' },
					{ key: 'patientName', label: 'Patient' },
					{ key: 'specialistName', label: 'Referred To' },
					{ key: 'specialty', label: 'Specialty' },
					{ key: 'status', label: 'Status' },
					{ key: 'urgency', label: 'Urgency' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER, PATIENT_FILTER,
					{ type: 'select', key: 'referredTo', label: 'Referred To', searchable: true, dynamic: true },
					{ type: 'select', key: 'specialty', label: 'Specialty', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'sent', label: 'Sent' },
						{ value: 'draft', label: 'Draft' },
						{ value: 'scheduled', label: 'Scheduled' },
						{ value: 'acknowledged', label: 'Acknowledged' },
						{ value: 'completed', label: 'Completed' },
						{ value: 'denied', label: 'Denied' },
					]),
					{
						type: 'select', key: 'urgency', label: 'Urgency', options: [
							{ value: '', label: 'All Urgency' },
							{ value: 'routine', label: 'Routine' },
							{ value: 'urgent', label: 'Urgent' },
							{ value: 'stat', label: 'STAT' },
						]
					},
				],
				kpis: [
					{ label: 'Total Referrals', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Completed', calc: items => String(countWhere(items, i => /complet/i.test(i.status || ''))), color: COLORS[1] },
					{ label: 'Pending', calc: items => String(countWhere(items, i => /pending|sent|scheduled/i.test(i.status || ''))), color: COLORS[2] },
					{
						label: 'Completion Rate', calc: items => {
							const c = countWhere(items, i => /complet/i.test(i.status || ''));
							return items.length ? fmtPct(100 * c / items.length) : '0%';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'pie', groupKey: 'status', label: 'By Status' },
					{ type: 'horizontalBar', groupKey: 'specialty', label: 'By Specialty', limit: 10 },
					{ type: 'line', groupKey: '', label: 'Monthly Volume', aggregate: 'month', dateField: 'referralDate' },
					{ type: 'pie', groupKey: 'patientName', label: 'By Patient' },
				],
			};

		case 'immunizations':
			return {
				apiPath: '/api/immunizations?page=0&size=1000',
				// Columns match ciyex-ehr-ui immunization report: Date, Patient, Vaccine, Dose, Site, Provider
				columns: [
					{ key: 'administrationDate', label: 'Date' },
					{ key: 'patientName', label: 'Patient' },
					{ key: 'vaccineName', label: 'Vaccine' },
					{ key: 'doseNumber', label: 'Dose' },
					{ key: 'site', label: 'Site' },
					{ key: 'administeredBy', label: 'Provider' },
				],
				filters: [
					DATE_FROM, DATE_TO,
					{ ...PROVIDER_FILTER, label: 'Provider', dynamicKey: 'administeredBy' },
					PATIENT_FILTER,
					{ type: 'select', key: 'vaccine', label: 'Vaccine Type', searchable: true, dynamic: true, dynamicKey: 'vaccineName' },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'completed', label: 'Completed' },
						{ value: 'not_done', label: 'Not Done' },
						{ value: 'entered_in_error', label: 'Entered in Error' },
					]),
				],
				kpis: [
					{ label: 'Administered', calc: items => String(countWhere(items, i => /complet/i.test(i.status || ''))), color: COLORS[0] },
					{ label: 'Patients Overdue', calc: items => String(countWhere(items, i => /overdue/i.test(i.status || ''))), color: COLORS[1] },
					{
						label: 'Up-to-Date Rate', calc: items => {
							const done = countWhere(items, i => /complet/i.test(i.status || ''));
							return items.length ? fmtPct(100 * done / items.length) : '0%';
						}, color: COLORS[2]
					},
					{
						label: 'This Month', calc: items => {
							const now = new Date(); const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
							return String(countWhere(items, i => { const d = i.administrationDate; return !!d && new Date(d).getTime() >= mStart; }));
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: 'vaccineName', label: 'By Vaccine Type', limit: 10 },
					{ type: 'area', groupKey: '', label: 'Monthly Administered', aggregate: 'month', dateField: 'administrationDate' },
					{ type: 'pie', groupKey: 'site', label: 'By Site' },
					{ type: 'donut', groupKey: 'status', label: 'By Status' },
				],
			};

		case 'problem-list':
			// NOTE: there is no bulk `/api/fhir-resource/conditions` list endpoint
			// (GenericFhirResourceController only exposes patient-scoped routes), which is why
			// this page was blank. ciyex-ehr-ui derives the problem list from encounters' diagnosis
			// field, so we use the working encounterAll endpoint here too.
			return {
				apiPath: '/api/encounters/report/encounterAll?page=0&size=1000',
				// Per-diagnosis rows derived from encounters: Diagnosis, Patient, Provider, Date, Status
				columns: [
					{ key: 'diagnosis', label: 'Diagnosis' },
					{ key: 'patientRefDisplay', label: 'Patient' },
					{ key: 'providerDisplay', label: 'Provider' },
					{ key: 'startDate', label: 'Date' },
					{ key: 'status', label: 'Status' },
				],
				filters: [
					DATE_FROM, DATE_TO,
					// Searchable provider filter matching reference
					{ type: 'select', key: 'provider', label: 'Provider', searchable: true, dynamic: true, searchPlaceholder: 'Search provider name...' },
					// Diagnosis searchable dropdown (derived from loaded encounter rows)
					{ type: 'select', key: 'diagnosis', label: 'Diagnosis', searchable: true, dynamic: true, searchPlaceholder: 'Search diagnosis...' },
				],
				kpis: [
					{ label: 'Total Diagnoses', calc: items => String(countWhere(items, i => !!i.diagnosis)), color: COLORS[0] },
					{ label: 'Unique Conditions', calc: items => String(new Set(items.map(i => i.diagnosis).filter(Boolean)).size), color: COLORS[1] },
					{ label: 'Chronic Conditions', calc: items => String(countWhere(items, i => /chronic|long[-_ ]?term|persistent/i.test(i.diagnosis || ''))), color: COLORS[2] },
					{ label: 'Patients w/ Dx', calc: items => String(new Set(items.filter(i => i.diagnosis).map(i => i.patientId || i.patientRefDisplay).filter(Boolean)).size), color: COLORS[3] },
				],
				charts: [
					{ type: 'horizontalBar', groupKey: 'diagnosis', label: 'Top 15 Diagnoses', limit: 15, topN: true },
					{ type: 'donut', groupKey: 'status', label: 'By Status' },
				],
				pageSize: 25,
			};

		// allow-any-unicode-next-line
		// ─── FINANCIAL ───
		case 'revenue-overview':
			return {
				// The workspace only exposes payment transactions (no charge/AR ledger
				// endpoint exists — /api/invoices, /api/billing/charges all 404/500).
				// The ehr-ui Charges/Payments/Adjustments/Balance and Provider/Payer
				// columns have no backing data here and rendered blank, so the table
				// reflects collected payments using the fields this endpoint returns.
				apiPath: '/api/payments/transactions?page=0&size=1000',
				enrichPatient: true,
				columns: [
					{ key: 'collectedAt', label: 'Date' },
					{ key: 'patientName', label: 'Patient' },
					{ key: 'description', label: 'Description' },
					{ key: 'paymentMethodLabel', label: 'Method' },
					{ key: 'transactionType', label: 'Type' },
					{ key: 'amount', label: 'Amount' },
					{ key: 'status', label: 'Status' },
				],
				filters: [
					DATE_FROM, DATE_TO, PATIENT_FILTER,
					{ type: 'select', key: 'paymentMethodType', label: 'Method', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'completed', label: 'Completed' },
						{ value: 'pending', label: 'Pending' },
						{ value: 'voided', label: 'Voided' },
						{ value: 'refunded', label: 'Refunded' },
						{ value: 'failed', label: 'Failed' },
					]),
				],
				kpis: [
					{ label: 'Total Collected', calc: items => fmtMoney(items.filter(i => /complet/i.test(i.status || '')).reduce((s, i) => s + Number(i.amount || 0), 0)), color: COLORS[0] },
					{ label: 'Transactions', calc: items => String(items.length), color: COLORS[1] },
					{ label: 'Refunded', calc: items => fmtMoney(items.reduce((s, i) => s + Number(i.refundAmount || 0), 0)), color: COLORS[2] },
					{
						label: 'Avg Payment', calc: items => {
							const paid = items.filter(i => /complet/i.test(i.status || ''));
							const sum = paid.reduce((s, i) => s + Number(i.amount || 0), 0);
							return paid.length ? fmtMoney(sum / paid.length) : '$0';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'pie', groupKey: 'paymentMethodType', label: 'By Payment Method' },
					{ type: 'pie', groupKey: 'status', label: 'By Status' },
					{ type: 'area', groupKey: '', label: 'Monthly Collections', aggregate: 'month', dateField: 'collectedAt' },
				],
			};

		case 'ar-aging':
		case 'accounts-receivable':
			return {
				apiPath: '/api/payments/transactions?page=0&size=1000',
				enrichPatient: true,
				computeArAging: true,
				columns: [
					{ key: 'payerDisplay', label: 'Payer' },
					{ key: 'days0_30', label: '0-30 Days' },
					{ key: 'days31_60', label: '31-60 Days' },
					{ key: 'days61_90', label: '61-90 Days' },
					{ key: 'days90Plus', label: '90+ Days' },
					{ key: 'totalAmount', label: 'Total' },
				],
				filters: [DATE_FROM, DATE_TO, PAYER_FILTER, PROVIDER_FILTER],
				kpis: [
					{ label: 'Total A/R', calc: items => fmtMoney(items.reduce((s, i) => s + Number(i.outstandingAmount || i.totalAmount || 0), 0)), color: COLORS[0] },
					{
						label: 'Days in A/R', calc: items => {
							const ars = items.map(i => Number(i.daysInAR || 0)).filter(n => n > 0);
							return ars.length ? Math.round(ars.reduce((a, b) => a + b, 0) / ars.length).toString() : '0';
						}, color: COLORS[1]
					},
					{
						label: 'Over 90 Days', calc: items => fmtMoney(items.filter(i => Number(i.daysInAR || 0) > 90).reduce((s, i) => s + Number(i.outstandingAmount || 0), 0)), color: COLORS[2]
					},
					{
						label: 'Clean Claim Rate', calc: items => {
							const total = items.length;
							const clean = countWhere(items, i => !/denied|rejected|reject/i.test(i.status || ''));
							return total ? fmtPct(100 * clean / total) : '0%';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: 'agingBucket', label: 'A/R Aging Buckets' },
					{ type: 'horizontalBar', groupKey: 'payerDisplay', label: 'A/R by Payer', limit: 10 },
					{ type: 'line', groupKey: '', label: 'Days in A/R Trend', aggregate: 'month', dateField: 'serviceDate' },
				],
			};

		case 'denial-management':
			return {
				// Try dedicated denial endpoint first; fall back to general claims with denied status
				apiPath: '/api/all-claims?page=0&size=1000&status=SUBMITTED',
				// Columns match ciyex-ehr-ui: Denial Reason, Count, Amount, Appealed, Recovered
				columns: [
					{ key: 'denialReason', label: 'Denial Reason' },
					{ key: 'patientName', label: 'Patient' },
					{ key: 'payerName', label: 'Payer' },
					{ key: 'totalAmount', label: 'Amount' },
					{ key: 'status', label: 'Status' },
					{ key: 'serviceDate', label: 'Date' },
				],
				filters: [
					DATE_FROM, DATE_TO,
					{ ...PAYER_FILTER, dynamicKey: 'payerName' },
					{ type: 'select', key: 'denialReason', label: 'Denial Reason', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'DRAFT', label: 'Draft' },
						{ value: 'SUBMITTED', label: 'Submitted' },
						{ value: 'CLOSED', label: 'Closed' },
						{ value: 'VOID', label: 'Void' },
					]),
				],
				kpis: [
					{
						label: 'Denial Rate', calc: items => {
							const denied = countWhere(items, i => /deni/i.test(i.status || ''));
							return items.length ? fmtPct(100 * denied / items.length) : '0%';
						}, color: COLORS[0]
					},
					{ label: 'Total Denied', calc: items => fmtMoney(items.reduce((s, i) => s + Number(i.totalAmount || 0), 0)), color: COLORS[1] },
					{ label: 'Recovered', calc: items => fmtMoney(items.filter(i => /recover/i.test(i.appealStatus || '')).reduce((s, i) => s + Number(i.totalAmount || 0), 0)), color: COLORS[2] },
					{
						label: 'Recovery Rate', calc: items => {
							const total = items.reduce((s, i) => s + Number(i.totalAmount || 0), 0);
							const rec = items.filter(i => /recover/i.test(i.appealStatus || '')).reduce((s, i) => s + Number(i.totalAmount || 0), 0);
							return total ? fmtPct(100 * rec / total) : '0%';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'horizontalBar', groupKey: 'denialReason', label: 'Top Denial Reasons', limit: 10 },
					{ type: 'line', groupKey: '', label: 'Denial Trend', aggregate: 'month', dateField: 'serviceDate' },
					{ type: 'bar', groupKey: 'payerDisplay', label: 'By Payer' },
				],
			};

		case 'payer-mix':
			return {
				apiPath: '/api/patients?page=0&size=1000',
				// `/api/patients` carries no insurance, so without the Coverage join
				// every row's `payerDisplay` was blank — the Payer column, the payer
				// KPIs and all three by-payer charts came up empty ("data not
				// loading"). Join coverage the same way patient-demographics does so
				// each patient resolves to its payer (Self-Pay when uncovered).
				enrichInsurance: true,
				// The raw feed is one row per patient; pivot to one row per payer so
				// the Patients / Patient % columns populate instead of staying blank.
				groupByPayer: true,
				columns: [
					{ key: 'payerDisplay', label: 'Payer' },
					{ key: 'patientCount', label: 'Patients' },
					{ key: 'patientPct', label: 'Patient %' },
					{ key: 'revenue', label: 'Revenue' },
					{ key: 'revenuePct', label: 'Revenue %' },
					{ key: 'avgReimbRate', label: 'Avg Reimb Rate' },
				],
				filters: [DATE_FROM, DATE_TO, PROVIDER_FILTER, PAYER_FILTER],
				kpis: [
					{ label: 'Active Payers', calc: items => String(new Set(items.map(i => i.payerDisplay).filter(Boolean)).size), color: COLORS[0] },
					{
						label: 'Top Payer %', calc: items => {
							const counts: Record<string, number> = {};
							for (const i of items) { const k = i.payerDisplay || 'Unknown'; counts[k] = (counts[k] || 0) + 1; }
							const top = Math.max(0, ...Object.values(counts));
							return items.length ? fmtPct(100 * top / items.length) : '0%';
						}, color: COLORS[1]
					},
					{
						label: 'Self-Pay %', calc: items => {
							const sp = countWhere(items, i => /self[-_ ]?pay/i.test(i.payerDisplay || ''));
							return items.length ? fmtPct(100 * sp / items.length) : '0%';
						}, color: COLORS[2]
					},
					{
						label: 'Medicare %', calc: items => {
							const med = countWhere(items, i => /medicare/i.test(i.payerDisplay || ''));
							return items.length ? fmtPct(100 * med / items.length) : '0%';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'pie', groupKey: 'payerDisplay', label: 'Patients by Payer' },
					{ type: 'donut', groupKey: 'payerDisplay', label: 'Revenue by Payer' },
					{ type: 'bar', groupKey: 'payerDisplay', label: 'Avg Reimbursement Rate' },
				],
			};

		case 'cpt-utilization':
			return {
				// CPT codes live on claim/invoice LINE items, not on encounters or the
				// bulk claim record. The practice-wide `/api/reports/cpt-utilization`
				// endpoint was only ever local/uncommitted backend work (not deployed
				// to api-dev), so the report came up empty. Instead load the deployed
				// bulk claim list and fan out to `/api/all-claims/{id}/line-details`
				// (deriveCptFromClaimLines) to build one row per procedure line
				// (cptCode / description / providerDisplay / totalAmount / startDate)
				// from data that actually ships. (wRVU and E&M level stay unbacked —
				// no endpoint exposes them — so those KPI/chart stay empty.)
				apiPath: '/api/all-claims',
				deriveCptFromClaimLines: true,
				// Columns match ciyex-ehr-ui: CPT Code, Description, Volume, Total Charges, wRVU
				columns: [
					{ key: 'cptCode', label: 'CPT Code' },
					{ key: 'description', label: 'Description' },
					{ key: 'providerDisplay', label: 'Provider' },
					{ key: 'totalAmount', label: 'Total Charges' },
					{ key: 'startDate', label: 'Date' },
				],
				filters: [
					DATE_FROM, DATE_TO,
					{ type: 'select', key: 'provider', label: 'Provider', searchable: true, dynamic: true, searchPlaceholder: 'Search provider...' },
					{ type: 'select', key: 'cptCode', label: 'CPT Code', searchable: true, dynamic: true, searchPlaceholder: 'Search CPT code...' },
				],
				kpis: [
					{ label: 'Total Procedures', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Unique CPT Codes', calc: items => String(new Set(items.map(i => i.cptCode).filter(Boolean)).size), color: COLORS[1] },
					{ label: 'Total wRVU', calc: items => items.reduce((s, i) => s + Number(i.wRVU || 0), 0).toFixed(1), color: COLORS[2] },
					{
						label: 'Avg wRVU/Visit', calc: items => {
							const total = items.reduce((s, i) => s + Number(i.wRVU || 0), 0);
							return items.length ? (total / items.length).toFixed(2) : '0.00';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'horizontalBar', groupKey: 'cptCode', label: 'Top 10 CPT Codes', limit: 10 },
					{ type: 'bar', groupKey: 'emLevel', label: 'E&M Level Distribution' },
					{ type: 'donut', groupKey: 'cptCode', label: 'By CPT Code' },
					{ type: 'donut', groupKey: 'description', label: 'By Description' },
				],
			};

		// allow-any-unicode-next-line
		// ─── OPERATIONAL ───
		case 'appointment-volume':
			return {
				apiPath: '/api/appointments?page=0&size=1000',
				columns: [
					{ key: 'appointmentDate', label: 'Date' },
					{ key: 'appointmentTime', label: 'Time' },
					{ key: 'patientDisplay', label: 'Patient' },
					{ key: 'providerName', label: 'Provider' },
					{ key: 'appointmentType', label: 'Visit Type' },
					{ key: 'status', label: 'Status' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER,
					{ type: 'select', key: 'visitType', label: 'Visit Type', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'scheduled', label: 'Scheduled' },
						{ value: 'confirmed', label: 'Confirmed' },
						{ value: 'checked-in', label: 'Checked-In' },
						{ value: 'completed', label: 'Completed' },
						{ value: 'cancelled', label: 'Cancelled' },
						{ value: 'no-show', label: 'No-Show' },
					]),
				],
				kpis: [
					{ label: 'Total Scheduled', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Completed', calc: items => String(countWhere(items, i => /complet|fulfilled/i.test(i.status || ''))), color: COLORS[1] },
					{ label: 'Cancelled', calc: items => String(countWhere(items, i => /cancel/i.test(i.status || ''))), color: COLORS[2] },
					{
						label: 'Utilization Rate', calc: items => {
							const completed = countWhere(items, i => /complet|fulfilled/i.test(i.status || ''));
							return items.length ? fmtPct(100 * completed / items.length) : '0%';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'area', groupKey: '', label: 'Daily Volume', aggregate: 'month', dateField: 'appointmentDate' },
					{ type: 'donut', groupKey: 'status', label: 'By Status' },
					{ type: 'bar', groupKey: '', label: 'By Day of Week', aggregate: 'day-of-week', dateField: 'appointmentDate' },
					{ type: 'pie', groupKey: 'appointmentType', label: 'By Visit Type' },
				],
			};

		case 'no-show-analysis':
			return {
				apiPath: '/api/appointments?page=0&size=500',
				columns: [
					{ key: 'appointmentDate', label: 'Date' },
					{ key: 'appointmentTime', label: 'Time' },
					{ key: 'patientDisplay', label: 'Patient' },
					{ key: 'providerName', label: 'Provider' },
					{ key: 'appointmentType', label: 'Visit Type' },
					{ key: 'status', label: 'Status' },
					{ key: 'cancelReason', label: 'Reason' },
					{ key: 'estImpact', label: 'Est. Impact' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER,
					{
						type: 'select', key: 'time', label: 'Time', options: [
							{ value: '', label: 'All Time' },
							{ value: 'morning', label: 'Morning (6am-12pm)' },
							{ value: 'afternoon', label: 'Afternoon (12pm-5pm)' },
							{ value: 'evening', label: 'Evening (5pm-9pm)' },
						]
					},
					PATIENT_FILTER,
					{ type: 'select', key: 'visitType', label: 'Visit Type', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'no-show', label: 'No-Show' },
						{ value: 'cancelled', label: 'Cancelled' },
					]),
					{ type: 'select', key: 'reason', label: 'Reason', searchable: true, dynamic: true },
				],
				kpis: [
					{
						label: 'No-Show Rate', calc: items => {
							const ns = countWhere(items, i => /no[-_ ]?show/i.test(i.status || ''));
							return items.length ? fmtPct(100 * ns / items.length) : '0%';
						}, color: COLORS[0]
					},
					{
						label: 'Cancel Rate', calc: items => {
							const c = countWhere(items, i => /cancel/i.test(i.status || ''));
							return items.length ? fmtPct(100 * c / items.length) : '0%';
						}, color: COLORS[1]
					},
					{
						label: 'Est. Lost Revenue', calc: items => fmtMoney(150 * countWhere(items, i => /no[-_ ]?show|cancel/i.test(i.status || ''))), color: COLORS[2]
					},
					{
						label: 'Repeat No-Shows', calc: items => {
							const counts: Record<string, number> = {};
							for (const i of items.filter(i => /no[-_ ]?show/i.test(i.status || ''))) {
								const k = i.patientId || i.patientDisplay || '';
								if (k) { counts[k] = (counts[k] || 0) + 1; }
							}
							return String(Object.values(counts).filter(c => c > 1).length);
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'line', groupKey: '', label: 'No-Show Rate Trend', aggregate: 'month', dateField: 'appointmentDate' },
					{ type: 'bar', groupKey: '', label: 'By Day of Week', aggregate: 'day-of-week', dateField: 'appointmentDate' },
					{ type: 'horizontalBar', groupKey: 'providerName', label: 'By Provider', limit: 10 },
					{ type: 'pie', groupKey: 'cancelReason', label: 'Cancellation Reasons' },
				],
			};

		case 'provider-productivity':
			return {
				apiPath: '/api/encounters/report/encounterAll?page=0&size=1000',
				// Encounters come back one row each; the table needs one row PER
				// PROVIDER with the encounter count + patients/day, so aggregate for the
				// table (charts/KPIs still count the raw encounter rows).
				groupByProvider: true,
				columns: [
					{ key: 'providerDisplay', label: 'Provider' },
					{ key: 'encounters', label: 'Encounters' },
					{ key: 'patientsPerDay', label: 'Pts/Day' },
					{ key: 'wRVU', label: 'wRVU' },
					{ key: 'charges', label: 'Charges' },
					{ key: 'collections', label: 'Collections' },
				],
				filters: [DATE_FROM, DATE_TO, PROVIDER_FILTER],
				kpis: [
					{ label: 'Active Providers', calc: items => String(new Set(items.map(i => i.providerDisplay).filter(Boolean)).size), color: COLORS[0] },
					{
						label: 'Avg Encounters/Day', calc: items => {
							const dates = new Set(items.map(i => (i.startDate || '').slice(0, 10)).filter(Boolean));
							return dates.size ? (items.length / dates.size).toFixed(1) : '0';
						}, color: COLORS[1]
					},
					{ label: 'Total wRVU', calc: items => items.reduce((s, i) => s + Number(i.wRVU || 0), 0).toFixed(1), color: COLORS[2] },
					{
						label: 'Avg Revenue/Provider', calc: items => {
							const provs = new Set(items.map(i => i.providerDisplay).filter(Boolean));
							const total = items.reduce((s, i) => s + Number(i.charges || 0), 0);
							return provs.size ? fmtMoney(total / provs.size) : '$0';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: 'providerDisplay', label: 'Encounters by Provider' },
					{ type: 'bar', groupKey: 'providerDisplay', label: 'wRVU by Provider' },
					{ type: 'bar', groupKey: 'providerDisplay', label: 'Revenue by Provider' },
				],
			};

		case 'scheduling-utilization':
			return {
				apiPath: '/api/appointments?page=0&size=1000',
				// The raw feed is one row per appointment; pivot to one row per
				// provider so Booked / Completed / Utilization % populate instead of
				// staying blank.
				groupBySchedule: true,
				columns: [
					{ key: 'providerName', label: 'Provider' },
					{ key: 'availableSlots', label: 'Available Slots' },
					{ key: 'booked', label: 'Booked' },
					{ key: 'completed', label: 'Completed' },
					{ key: 'utilization', label: 'Utilization %' },
					{ key: 'revenue', label: 'Revenue' },
				],
				filters: [DATE_FROM, DATE_TO, PROVIDER_FILTER],
				kpis: [
					{
						label: 'Utilization Rate', calc: items => {
							const c = countWhere(items, i => !/cancel|no[-_ ]?show/i.test(i.status || ''));
							return items.length ? fmtPct(100 * c / items.length) : '0%';
						}, color: COLORS[0]
					},
					{ label: 'Open Slots', calc: items => String(countWhere(items, i => /available|free|open/i.test(i.status || ''))), color: COLORS[1] },
					{ label: 'Overbooked Days', calc: () => '0', color: COLORS[2] },
					{
						label: 'New Patient %', calc: items => {
							const np = countWhere(items, i => /new/i.test(i.appointmentType || ''));
							return items.length ? fmtPct(100 * np / items.length) : '0%';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: 'providerName', label: 'Utilization by Provider' },
					{ type: 'bar', groupKey: '', label: 'Utilization by Day', aggregate: 'day-of-week', dateField: 'appointmentDate' },
					{ type: 'line', groupKey: '', label: 'Utilization Trend', aggregate: 'month', dateField: 'appointmentDate' },
				],
			};

		// allow-any-unicode-next-line
		// ─── COMPLIANCE ───
		case 'quality-measures':
			return {
				apiPath: '/api/quality-measures?page=0&size=100',
				columns: [
					{ key: 'measure', label: 'Measure' },
					{ key: 'numerator', label: 'Numerator' },
					{ key: 'denominator', label: 'Denominator' },
					{ key: 'performance', label: 'Performance %' },
					{ key: 'benchmark', label: 'Benchmark %' },
					{ key: 'status', label: 'Status' },
				],
				filters: [
					PROVIDER_FILTER,
					{ type: 'select', key: 'measure', label: 'Measure', searchable: true, dynamic: true },
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'meeting', label: 'Meeting Benchmark' },
						{ value: 'below', label: 'Below Benchmark' },
					]),
				],
				kpis: [
					{ label: 'MIPS Score', calc: () => '0', color: COLORS[0] },
					{ label: 'Measures Tracked', calc: items => String(items.length), color: COLORS[1] },
					{ label: 'Meeting Benchmark', calc: items => String(countWhere(items, i => Number(i.performance || 0) >= Number(i.benchmark || 0))), color: COLORS[2] },
					{ label: 'Below Benchmark', calc: items => String(countWhere(items, i => Number(i.performance || 0) < Number(i.benchmark || 0))), color: COLORS[3] },
				],
				charts: [
					{ type: 'bar', groupKey: 'measure', label: 'Measure Performance vs. Benchmark' },
					{ type: 'line', groupKey: '', label: 'MIPS Score Trend', aggregate: 'month', dateField: 'recordedDate' },
					{ type: 'pie', groupKey: 'status', label: 'By Status' },
				],
			};

		case 'care-gaps':
		case 'care-gaps-analysis':
			// No backend care-gap engine exists, so gaps are derived from real data:
			// an overdue preventive visit (>180d or never seen), a chronic-condition
			// follow-up lapse (>90d with a chronic problem on record) and a missing
			// immunization. Provider + visit stats are joined from the encounter list
			// and immunizations from the immunization feed. See _deriveCareGaps.
			return {
				apiPath: '/api/patients?page=0&size=500',
				enrichProvider: true,
				enrichEncounterStats: true,
				enrichImmunizations: true,
				deriveCareGaps: true,
				emptyMessage: 'No open care gaps — every patient is current on preventive visits, chronic-care follow-ups and immunizations.',
				columns: [
					{ key: 'patientName', label: 'Patient' },
					{ key: 'gapType', label: 'Gap Type' },
					{ key: 'description', label: 'Description' },
					{ key: 'dueDate', label: 'Due Date' },
					{ key: 'daysOverdue', label: 'Days Overdue' },
					{ key: 'providerName', label: 'Provider' },
				],
				filters: [
					PROVIDER_FILTER,
					{ type: 'select', key: 'gapType', label: 'Gap Type', searchable: true, dynamic: true },
					{ type: 'select', key: 'description', label: 'Description', searchable: true, dynamic: true },
				],
				kpis: [
					{ label: 'Total Open Gaps', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Overdue > 90 Days', calc: items => String(countWhere(items, i => Number(i.daysOverdue || 0) > 90)), color: COLORS[1] },
					{
						label: 'Avg Days Overdue', calc: items => {
							const d = items.map(i => Number(i.daysOverdue || 0)).filter(n => n > 0);
							return d.length ? String(Math.round(d.reduce((a, b) => a + b, 0) / d.length)) : '0';
						}, color: COLORS[2]
					},
					{ label: 'Never Seen', calc: items => String(countWhere(items, i => /no visit/i.test(i.description || ''))), color: COLORS[3] },
				],
				charts: [
					{ type: 'bar', groupKey: 'gapType', label: 'Gaps by Type' },
					{ type: 'horizontalBar', groupKey: 'providerName', label: 'Open Gaps by Provider', limit: 10 },
					{ type: 'pie', groupKey: 'description', label: 'By Gap Reason' },
				],
			};

		case 'audit-log':
			return {
				// size raised from 500 → 5000: the tenant already has ~690 audit rows,
				// so size=500 silently dropped ~190 of them (and grows over time). The
				// endpoint returns a single page, so the page size must cover the full
				// set for the table / KPIs / charts to reflect all activity.
				apiPath: '/api/audit-log?page=0&size=5000',
				columns: [
					{ key: 'createdAt', label: 'Timestamp' },
					{ key: 'userName', label: 'User' },
					{ key: 'action', label: 'Action' },
					{ key: 'resourceType', label: 'Resource' },
					{ key: 'resourceName', label: 'Details' },
					{ key: 'ipAddress', label: 'IP Address' },
				],
				filters: [
					DATE_FROM, DATE_TO,
					{ type: 'select', key: 'user', label: 'User', searchable: true, dynamic: true },
					{ type: 'select', key: 'action', label: 'Action', searchable: true, dynamic: true },
					{ type: 'select', key: 'resource', label: 'Resource', searchable: true, dynamic: true },
					{ type: 'select', key: 'ipAddress', label: 'IP Address', searchable: true, dynamic: true },
				],
				kpis: [
					{ label: 'Total Actions', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Unique Users', calc: items => String(new Set(items.map(i => i.userName).filter(Boolean)).size), color: COLORS[1] },
					{ label: 'Chart Accesses', calc: items => String(countWhere(items, i => /view|chart/i.test(i.action || ''))), color: COLORS[2] },
					{
						label: 'After-Hours Access', calc: items => String(countWhere(items, i => {
							if (!i.createdAt) { return false; }
							const h = new Date(i.createdAt).getHours();
							return h < 7 || h > 19;
						})), color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: '', label: 'Activity by Hour of Day', aggregate: 'hour', dateField: 'createdAt' },
					{ type: 'pie', groupKey: 'action', label: 'By Action Type' },
					{ type: 'area', groupKey: '', label: 'Daily Activity Trend', aggregate: 'month', dateField: 'createdAt' },
					{ type: 'pie', groupKey: 'resourceType', label: 'By Resource' },
				],
			};

		// allow-any-unicode-next-line
		// ─── POPULATION HEALTH ───
		case 'disease-registry':
			return {
				apiPath: '/api/encounters/report/encounterAll?page=0&size=1000',
				// One row per raw encounter; pivot to one row per condition so Total
				// Patients / Avg Days Since Visit populate instead of staying blank.
				groupByCondition: true,
				columns: [
					{ key: 'condition', label: 'Condition' },
					{ key: 'totalPatients', label: 'Total Patients' },
					{ key: 'controlled', label: 'Controlled' },
					{ key: 'controlPct', label: 'Control %' },
					{ key: 'avgDaysSinceVisit', label: 'Avg Days Since Visit' },
				],
				filters: [
					PROVIDER_FILTER,
					{ type: 'select', key: 'condition', label: 'Condition', searchable: true, dynamic: true },
				],
				kpis: [
					{ label: 'Registry Patients', calc: items => String(new Set(items.map(i => i.patientId || i.patientName).filter(Boolean)).size), color: COLORS[0] },
					{
						label: 'Controlled %', calc: items => {
							const c = countWhere(items, i => /controlled/i.test(i.controlStatus || ''));
							return items.length ? fmtPct(100 * c / items.length) : '0%';
						}, color: COLORS[1]
					},
					{
						label: 'Uncontrolled %', calc: items => {
							const c = countWhere(items, i => /uncontrolled/i.test(i.controlStatus || ''));
							return items.length ? fmtPct(100 * c / items.length) : '0%';
						}, color: COLORS[2]
					},
					{ label: 'Overdue for Visit', calc: () => '0', color: COLORS[3] },
				],
				charts: [
					{ type: 'bar', groupKey: 'condition', label: 'Patients by Condition' },
					{ type: 'bar', groupKey: 'condition', label: 'Control Rates' },
					{ type: 'line', groupKey: '', label: 'Control Rate Trend', aggregate: 'month', dateField: 'recordedDate' },
				],
			};

		case 'risk-stratification':
			// No backend risk engine exists, so the score/tier is a transparent
			// utilization proxy derived from 12-month visit + ED-visit frequency
			// (see _deriveRisk) — not a clinical model. `conditions` has no bulk
			// endpoint, so it's filled per-patient from the problem list
			// (see _enrichConditions) and stays blank where a tenant records none.
			return {
				apiPath: '/api/patients?page=0&size=500',
				enrichEncounterStats: true,
				// Stamp each patient's most-recent-visit provider so the Provider
				// filter has real names to list (the /api/patients feed carries none).
				enrichProvider: true,
				enrichConditions: true,
				deriveRisk: true,
				columns: [
					{ key: 'patientName', label: 'Patient' },
					{ key: 'riskScore', label: 'Risk Score' },
					{ key: 'riskTier', label: 'Risk Tier' },
					{ key: 'conditions', label: 'Conditions' },
					{ key: 'edVisits', label: 'ED Visits (12mo)' },
					{ key: 'lastVisit', label: 'Last Visit' },
				],
				filters: [
					PROVIDER_FILTER,
					{
						type: 'select', key: 'riskTier', label: 'Risk Tier', options: [
							{ value: '', label: 'All Risk Tier' },
							{ value: 'low', label: 'Low' },
							{ value: 'moderate', label: 'Moderate' },
							{ value: 'high', label: 'High' },
							{ value: 'very-high', label: 'Very High' },
						]
					},
				],
				kpis: [
					{ label: 'Total Patients', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'High Risk', calc: items => String(countWhere(items, i => /high/i.test(i.riskTier || ''))), color: COLORS[1] },
					{ label: 'With ED Visits', calc: items => String(countWhere(items, i => Number(i.edVisits || 0) > 0)), color: COLORS[2] },
					{
						label: 'Avg Risk Score', calc: items => {
							const scores = items.map(i => Number(i.riskScore || 0)).filter(n => n > 0);
							return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '0';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'pie', groupKey: 'riskTier', label: 'Risk Tier Distribution' },
					{ type: 'bar', groupKey: 'riskTier', label: 'Patients by Risk Tier' },
					{ type: 'line', groupKey: '', label: 'Visit Volume Trend', aggregate: 'month', dateField: 'lastVisit' },
				],
			};

		// allow-any-unicode-next-line
		// ─── ADMINISTRATIVE ───
		case 'portal-usage':
			// Patient-portal enrollment overview. There is no backend portal-usage
			// analytics endpoint (all portal routes are patient-facing /me|/my) and no
			// ehr-ui equivalent report, so the previous per-feature columns (feature /
			// totalUsage / uniqueUsers / avgPerUser / trend30d) had no data source and
			// every cell rendered blank. Instead we surface the real, resolvable patient
			// data the /api/patients endpoint returns — who can be reached on the portal
			// (email/phone on file), when they registered, and whether they're active.
			return {
				apiPath: '/api/patients?page=0&size=1000',
				columns: [
					{ key: 'name', label: 'Patient' },
					{ key: 'email', label: 'Email' },
					{ key: 'phone', label: 'Phone' },
					{ key: 'createdAt', label: 'Registered' },
					{ key: 'active', label: 'Status' },
				],
				filters: [
					DATE_FROM, DATE_TO,
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'Active', label: 'Active' },
						{ value: 'Inactive', label: 'Inactive' },
					]),
				],
				kpis: [
					{ label: 'Total Patients', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Active', calc: items => String(countWhere(items, i => /active/i.test(i.active || ''))), color: COLORS[1] },
					{
						label: 'Reachable %', calc: items => {
							const reachable = countWhere(items, i => !!(i.email || i.phone));
							return items.length ? fmtPct(100 * reachable / items.length) : '0%';
						}, color: COLORS[2]
					},
					{
						label: 'New This Month', calc: items => {
							const now = new Date(); const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
							return String(countWhere(items, i => { const d = i.createdAt || i.registrationDate; return !!d && new Date(d).getTime() >= mStart; }));
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'line', groupKey: '', label: 'Registration Trend', aggregate: 'month', dateField: 'createdAt' },
					{ type: 'donut', groupKey: 'active', label: 'Patient Status' },
					{ type: 'pie', groupKey: 'ageGroup', label: 'By Age Group' },
				],
			};

		case 'document-completion': {
			// Per-encounter detail rows (mirrors ciyex-ehr-ui's Encounter report, which
			// lists Patient / Date / Provider / Type / Status / Diagnosis). The columns
			// previously read aggregate keys (unsigned / avgAgeDays / oldestDays /
			// signedToday) that the /api/encounters/report/encounterAll rows don't carry,
			// so every cell rendered blank ("details data not visible"). The keys below
			// are all resolved by _normalizeRow from the encounterAll row shape.
			const isSigned = (i: Record<string, string>): boolean => {
				const st = (i.status || '').toLowerCase();
				return /complet|finished/.test(st) || (st.includes('signed') && !st.includes('unsigned'));
			};
			return {
				apiPath: '/api/encounters/report/encounterAll?page=0&size=1000',
				columns: [
					{ key: 'patientRefDisplay', label: 'Patient' },
					{ key: 'startDate', label: 'Date' },
					{ key: 'providerDisplay', label: 'Provider' },
					{ key: 'type', label: 'Visit Type' },
					{ key: 'status', label: 'Status' },
					{ key: 'diagnosis', label: 'Diagnosis' },
				],
				filters: [
					DATE_FROM, DATE_TO, PROVIDER_FILTER,
					// Signed / Unsigned / Incomplete — the essence of a document-completion
					// report and the same toggle ciyex-ehr-ui offers on the Encounter page.
					STATUS_FILTER([
						{ value: '', label: 'All Status' },
						{ value: 'signed', label: 'Signed' },
						{ value: 'unsigned', label: 'Unsigned' },
						{ value: 'incomplete', label: 'Incomplete' },
					]),
				],
				kpis: [
					{ label: 'Total Notes', calc: items => String(items.length), color: COLORS[0] },
					{ label: 'Signed', calc: items => String(countWhere(items, isSigned)), color: COLORS[1] },
					{ label: 'Unsigned', calc: items => String(countWhere(items, i => /unsigned|in[-_ ]?progress|draft|pending/i.test(i.status || ''))), color: COLORS[2] },
					{ label: 'Completion %', calc: items => items.length ? fmtPct(100 * countWhere(items, isSigned) / items.length) : '0%', color: COLORS[3] },
				],
				charts: [
					{ type: 'bar', groupKey: 'providerDisplay', label: 'Encounters by Provider' },
					{ type: 'pie', groupKey: 'status', label: 'By Completion Status' },
					{ type: 'line', groupKey: '', label: 'Completion Trend', aggregate: 'month', dateField: 'startDate' },
				],
			};
		}

		// allow-any-unicode-next-line
		// ─── AI USAGE ─── (handled separately by _renderAiUsage)
		case 'ai-usage':
			return {
				apiPath: '/api/app-proxy/ask-ciya/api/ai/usage/log?page=0&size=20',
				columns: [],
				filters: [],
				kpis: [],
				charts: [],
			};

		default:
			return {
				apiPath: '/api/patients?page=0&size=50',
				columns: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }],
				filters: DEFAULT_FILTERS,
				kpis: [{ label: 'Total Records', calc: items => String(items.length), color: COLORS[0] }],
				charts: [{ type: 'bar', groupKey: 'status', label: 'Data Distribution' }],
			};
	}
}

export class ReportsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexReport';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private filtersEl!: HTMLElement;
	private kpiEl!: HTMLElement;
	private chartsEl!: HTMLElement;
	private tableEl!: HTMLElement;
	private items: Record<string, string>[] = [];
	private reportDef!: ReportDef;
	private currentInput: ReportsEditorInput | null = null;
	private filterValues: Record<string, string> = {};
	private currentPage = 0;
	private readonly pageSize = 25;
	private sortKey = '';
	private sortDir: 'asc' | 'desc' = 'desc';
	private providerSelect: HTMLSelectElement | null = null;
	/** Full provider roster (display names) for the current practice, fetched once
	 *  from the authoritative endpoint so the Provider filter lists every provider,
	 *  not just the ones that happen to appear in the loaded report rows. */
	private _providerRoster: string[] = [];

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(ReportsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.reports-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1200px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof ReportsEditorInput)) { return; }
		this.currentInput = input;
		this.reportDef = getReportDef(input.reportKey);
		this.filterValues = {};
		this.currentPage = 0;
		this.sortKey = '';

		if (input.reportKey === 'ai-usage') {
			await this._renderAiUsage();
			return;
		}
		await this._loadAndRender();
	}

	private async _loadAndRender(): Promise<void> {
		const input = this.currentInput;
		if (!input) { return; }
		DOM.clearNode(this.contentEl);

		// Header
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;';
		const catBadge = DOM.append(header, DOM.$('span'));
		catBadge.textContent = input.category;
		catBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(0,122,204,0.1);color:var(--vscode-textLink-foreground);text-transform:uppercase;letter-spacing:0.5px;';
		const title = DOM.append(header, DOM.$('h2'));
		title.textContent = input.reportLabel;
		title.style.cssText = 'font-size:20px;font-weight:600;margin:0;flex:1;';

		const exportBtn = DOM.append(header, DOM.$('button'));
		exportBtn.textContent = 'Export CSV';
		exportBtn.style.cssText = BTN_SECONDARY;
		exportBtn.addEventListener('click', () => this._exportCsv(input.reportLabel));
		const printBtn = DOM.append(header, DOM.$('button'));
		printBtn.textContent = 'Print';
		printBtn.style.cssText = BTN_SECONDARY;
		printBtn.addEventListener('click', () => this._printReport(input.reportLabel));

		// Filters
		this.filtersEl = DOM.append(this.contentEl, DOM.$('div'));
		this.filtersEl.style.cssText = 'display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;background:rgba(0,122,204,0.03);';
		this._buildFilters();

		// KPI cards
		this.kpiEl = DOM.append(this.contentEl, DOM.$('div'));
		this.kpiEl.style.cssText = 'margin-bottom:16px;';

		// Charts
		this.chartsEl = DOM.append(this.contentEl, DOM.$('div'));
		this.chartsEl.style.cssText = 'margin-bottom:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;';

		// Table
		this.tableEl = DOM.append(this.contentEl, DOM.$('div'));

		await Promise.all([this._loadData(), this._loadProviderRoster()]);
		this._populateProviderFilter();
		this._render();
	}

	private _buildFilters(): void {
		DOM.clearNode(this.filtersEl);
		this.providerSelect = null;
		const buildIconDateInput = (parent: HTMLElement, key: string, labelText: string): void => {
			const labelEl = DOM.append(parent, DOM.$('label'));
			labelEl.textContent = labelText;
			labelEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-right:4px;';
			const wrap = DOM.append(parent, DOM.$('div'));
			wrap.style.cssText = 'position:relative;display:inline-block;';
			const isoToUs = (iso: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };
			const usToIso = (us: string): string => usToIsoDate(us);
			const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			visible.type = 'text';
			visible.placeholder = 'MM/DD/YYYY';
			visible.maxLength = 10;
			visible.value = isoToUs(this.filterValues[key] || '');
			visible.style.cssText = INPUT_STYLE + 'padding-right:30px;width:130px;';
			// Inline validation message — usToIsoDate returns '' for an impossible
			// calendar date (e.g. 12/45/2000), so we flag the field red AND surface a
			// readable "Invalid date" hint below it instead of silently swallowing the
			// value (QA: report filters accept invalid dates with no error).
			const errEl = DOM.append(wrap, DOM.$('div'));
			errEl.style.cssText = 'position:absolute;top:100%;left:0;margin-top:2px;font-size:10px;color:#ef4444;white-space:nowrap;display:none;z-index:5;';
			visible.addEventListener('input', () => {
				// Auto-insert the slashes as the user types (06122004 → 06/12/2004),
				// matching every other manually-typed date field. Without this the
				// field never formed MM/DD/YYYY on its own, so validation flagged
				// "Invalid date" on each keystroke (QA: typing the from/to date shows
				// invalid).
				const masked = maskUsDate(visible.value);
				if (masked !== visible.value) { visible.value = masked; }
				const iso = usToIso(visible.value);
				// Only flag invalid once a FULL MM/DD/YYYY (10 chars) is typed but
				// doesn't parse (e.g. 13/45/2000) — a half-typed date must not error.
				const bad = visible.value.length === 10 && !iso;
				visible.style.borderColor = bad ? '#ef4444' : '';
				errEl.textContent = bad ? 'Invalid date — use MM/DD/YYYY' : '';
				errEl.style.display = bad ? 'block' : 'none';
				if (iso) {
					// Valid date — apply the filter.
					this.filterValues[key] = iso;
					this.currentPage = 0;
					this._render();
				} else if (visible.value === '' && this.filterValues[key]) {
					// Cleared — drop the filter and refresh.
					this.filterValues[key] = '';
					this.currentPage = 0;
					this._render();
				}
				// Half-typed / invalid: leave the previous filter untouched (no error
				// thrash, no table reset until the date is complete or cleared).
			});
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.value = this.filterValues[key] || '';
			picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			picker.addEventListener('change', () => {
				visible.value = isoToUs(picker.value);
				visible.style.borderColor = '';
				errEl.textContent = '';
				errEl.style.display = 'none';
				this.filterValues[key] = picker.value;
				this.currentPage = 0;
				this._render();
			});
			const icon = DOM.append(wrap, DOM.$('span.codicon.codicon-calendar'));
			icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--vscode-descriptionForeground);cursor:pointer;line-height:1;';
			// Open the calendar from a click anywhere in the icon column, not just
			// the native input's tiny indicator glyph.
			enablePickerClick(picker, icon);
		};

		for (const f of this.reportDef.filters) {
			if (f.type === 'date-from' || f.type === 'date-to') {
				buildIconDateInput(this.filtersEl, f.key, f.label);
			} else if (f.type === 'select') {
				const labelEl = DOM.append(this.filtersEl, DOM.$('label'));
				labelEl.textContent = f.label;
				labelEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-right:4px;';
				if (f.searchable) {
					this._buildSearchableFilter(this.filtersEl, f);
				} else {
					const sel = DOM.append(this.filtersEl, DOM.$('select')) as HTMLSelectElement;
					sel.style.cssText = INPUT_STYLE + 'cursor:pointer;';
					for (const opt of f.options || []) {
						const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
						o.value = opt.value;
						o.textContent = opt.label;
					}
					sel.value = this.filterValues[f.key] || '';
					sel.addEventListener('change', () => {
						this.filterValues[f.key] = sel.value;
						this.currentPage = 0;
						this._render();
					});
					if (f.key === 'provider') { this.providerSelect = sel; }
				}
			}
		}

		// No "Generate" button: changing any filter dropdown re-renders immediately.
	}

	/** Fetch the authoritative provider roster for the current practice so the
	 *  Provider filter can list every provider, even those with no rows in the
	 *  current report. Mirrors the calendar's org-scoped roster lookup: lead with
	 *  the org endpoint and fall back to the flat/FHIR lists, merging by name. */
	private async _loadProviderRoster(): Promise<void> {
		const urls = ['/api/providers/organization?page=0&size=200', '/api/providers?page=0&size=200', '/api/fhir-resource/providers?size=200'];
		const names = new Set<string>();
		for (const url of urls) {
			try {
				const res = await this.apiService.fetch(url);
				if (!res.ok) { continue; }
				const data = await res.json();
				const list = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
				for (const raw of list as Record<string, unknown>[]) {
					const p = raw as Record<string, string> & { identification?: { firstName?: string; lastName?: string } };
					// Build "First Last" (no prefix) to match the provider display used in
					// report rows (e.g. "Geetha K"), so selecting a roster provider that has
					// rows filters correctly rather than mismatching on a "Dr." prefix.
					const first = p.identification?.firstName || p['identification.firstName'] || p.firstName || '';
					const last = p.identification?.lastName || p['identification.lastName'] || p.lastName || '';
					const full = `${first} ${last}`.trim();
					const name = full || p.name || p.fullName || p.displayName || '';
					if (name && name.trim().length > 0) { names.add(name.trim()); }
				}
				if (names.size > 0) { break; }
			} catch { /* try next endpoint */ }
		}
		this._providerRoster = Array.from(names);
	}

	private _populateProviderFilter(): void {
		const sel = this.providerSelect;
		if (!sel) { return; }
		const existing = new Set<string>();
		Array.from(sel.options).forEach(o => existing.add(o.value));
		const providers = new Set<string>();
		for (const i of this.items) {
			const p = i.providerName || i.providerDisplay || i.prescriberName || i.orderingProvider;
			if (p && !existing.has(p)) { providers.add(p); }
		}
		for (const p of Array.from(providers).sort()) {
			const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			o.value = p;
			o.textContent = p;
		}
	}

	private _searchableOpenPopup: HTMLElement | null = null;

	private _dynamicOptions(filter: FilterDef): Array<{ value: string; label: string }> {
		const sourceKey = filter.dynamicKey || filter.key;
		const accessors: Record<string, (i: Record<string, string>) => string> = {
			provider: i => i.providerName || i.providerDisplay || i.encounterProvider || i.prescriberName || i.orderingProvider || '',
			patient: i => i.patientName || i.patientDisplay || i.patientRefDisplay || '',
			medication: i => i.medicationName || '',
			prescriber: i => i.prescriberName || i.providerName || '',
			specialist: i => i.specialistName || '',
			specialty: i => i.specialty || '',
			vaccine: i => i.vaccineName || '',
			site: i => i.site || i.bodySite || '',
			payer: i => i.payerDisplay || i.insurance || '',
			insurance: i => i.insurance || i.payerDisplay || '',
			diagnosis: i => i.diagnosis || '',
			test: i => i.testDisplay || i.orderName || i.code || '',
			cptCode: i => i.cptCode || i.code || '',
			description: i => i.description || i.code || '',
			user: i => i.userName || i.user || '',
			ipAddress: i => i.ipAddress || '',
			resource: i => i.resourceType || '',
			action: i => i.action || '',
			feature: i => i.feature || '',
			condition: i => i.condition || i.code || '',
			riskTier: i => i.riskTier || '',
			gapType: i => i.gapType || '',
			measure: i => i.measure || '',
			category: i => i.category || '',
			denialReason: i => i.denialReason || '',
			reason: i => i.cancelReason || i.reason || '',
			time: i => i.appointmentTime || '',
			visitType: i => i.appointmentType || i.type || '',
			referredTo: i => i.specialistName || i.referredTo || '',
			urgency: i => i.urgency || '',
			administeredBy: i => i.administeredBy || i.performerName || i.providerName || '',
		};
		const accessor = accessors[sourceKey] || ((i: Record<string, string>) => i[sourceKey] || '');
		const set = new Set<string>();
		for (const i of this.items) {
			const v = accessor(i);
			if (v) { set.add(v); }
		}
		// Provider filters list the full practice roster, not just providers that
		// appear in the loaded rows, so a provider with no records is still selectable.
		if (sourceKey === 'provider') {
			for (const name of this._providerRoster) { set.add(name); }
		}
		const out: Array<{ value: string; label: string }> = Array.from(set).sort().map(v => ({ value: v, label: v }));
		return out;
	}

	private _buildSearchableFilter(parent: HTMLElement, filter: FilterDef): void {
		const wrap = DOM.append(parent, DOM.$('div'));
		wrap.style.cssText = 'position:relative;display:inline-block;';

		const allLabel = `All ${filter.label}`;
		const trigger = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
		trigger.style.cssText = INPUT_STYLE + 'cursor:pointer;min-width:140px;text-align:left;display:inline-flex;align-items:center;gap:6px;padding-right:24px;position:relative;';
		const txt = DOM.append(trigger, DOM.$('span'));
		txt.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const caret = DOM.append(trigger, DOM.$('span'));
		// allow-any-unicode-next-line
		caret.textContent = '▾';
		caret.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:9px;color:var(--vscode-descriptionForeground);';

		const setLabelText = (): void => {
			const v = this.filterValues[filter.key];
			const allOpts: Array<{ value: string; label: string }> = filter.dynamic ? this._dynamicOptions(filter) : (filter.options || []);
			const match = allOpts.find(o => o.value === v);
			txt.textContent = v ? (match ? match.label : v) : allLabel;
		};
		setLabelText();

		const renderPopup = (): HTMLElement => {
			const popup = DOM.$('div');
			popup.style.cssText = 'position:absolute;top:100%;left:0;margin-top:2px;z-index:1000;width:240px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border,#3c3c3c);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.3);overflow:hidden;';

			const searchWrap = DOM.append(popup, DOM.$('div'));
			searchWrap.style.cssText = 'padding:6px;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const searchInput = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
			searchInput.type = 'text';
			searchInput.placeholder = filter.searchPlaceholder || `Search ${filter.label.toLowerCase()}...`;
			searchInput.style.cssText = INPUT_STYLE + 'width:100%;box-sizing:border-box;';

			const list = DOM.append(popup, DOM.$('div'));
			list.style.cssText = 'max-height:240px;overflow-y:auto;';

			const renderOptions = (): void => {
				DOM.clearNode(list);
				const baseOpts: Array<{ value: string; label: string }> = filter.dynamic ? this._dynamicOptions(filter) : (filter.options || []).slice();
				if (!baseOpts.some(o => o.value === '')) {
					baseOpts.unshift({ value: '', label: allLabel });
				}
				const q = searchInput.value.toLowerCase();
				const filtered = q ? baseOpts.filter(o => o.label.toLowerCase().includes(q) || o.value === '') : baseOpts;

				if (filtered.length === 0 || (filtered.length === 1 && filtered[0].value === '')) {
					if (filtered.length === 0) {
						const empty = DOM.append(list, DOM.$('div'));
						empty.textContent = 'No matches';
						empty.style.cssText = 'padding:14px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
						return;
					}
				}
				for (const opt of filtered) {
					const row = DOM.append(list, DOM.$('div'));
					row.textContent = opt.label;
					const isSel = (this.filterValues[filter.key] || '') === opt.value;
					row.style.cssText = `padding:6px 12px;font-size:12px;cursor:pointer;${isSel ? 'background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);' : ''}`;
					row.addEventListener('mouseenter', () => { if (!isSel) { row.style.background = 'var(--vscode-list-hoverBackground)'; } });
					row.addEventListener('mouseleave', () => { if (!isSel) { row.style.background = ''; } });
					row.addEventListener('click', () => {
						this.filterValues[filter.key] = opt.value;
						setLabelText();
						closePopup();
						this.currentPage = 0;
						this._render();
					});
				}
			};
			searchInput.addEventListener('input', renderOptions);
			renderOptions();
			setTimeout(() => { try { searchInput.focus(); } catch { /* ignore */ } }, 0);
			return popup;
		};

		const closePopup = (): void => {
			if (this._searchableOpenPopup && this._searchableOpenPopup.parentElement) {
				this._searchableOpenPopup.parentElement.removeChild(this._searchableOpenPopup);
			}
			this._searchableOpenPopup = null;
		};

		const onDocClick = (e: MouseEvent): void => {
			if (!this._searchableOpenPopup) { return; }
			const t = e.target as Node | null;
			if (t && (this._searchableOpenPopup.contains(t) || trigger.contains(t))) { return; }
			closePopup();
			DOM.getActiveWindow().document.removeEventListener('mousedown', onDocClick, true);
		};

		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this._searchableOpenPopup) {
				closePopup();
				DOM.getActiveWindow().document.removeEventListener('mousedown', onDocClick, true);
				return;
			}
			const popup = renderPopup();
			wrap.appendChild(popup);
			this._searchableOpenPopup = popup;
			DOM.getActiveWindow().document.addEventListener('mousedown', onDocClick, true);
		});
	}

	private async _loadData(): Promise<void> {
		try {
			const res = await this.apiService.fetch(this.reportDef.apiPath);
			if (!res.ok) { this.items = []; return; }
			const json = await res.json();
			const raw = json?.data?.content || json?.data || json?.content || json || [];
			const arr = Array.isArray(raw) ? raw : [];
			this.items = arr.map((r: Record<string, unknown>) => this._normalizeRow(r)) as Record<string, string>[];
			if (this.reportDef.deriveCptFromClaimLines) { await this._deriveCptFromClaimLines(); }
			if (this.reportDef.enrichInsurance) { await this._enrichInsurance(); }
			if (this.reportDef.enrichProvider) { await this._enrichProvider(); }
			if (this.reportDef.enrichPatient) { await this._enrichPatient(); }
			if (this.reportDef.enrichEncounterStats) { await this._enrichEncounterStats(); }
			if (this.reportDef.enrichImmunizations) { await this._enrichImmunizations(); }
			if (this.reportDef.enrichConditions) { await this._enrichConditions(); }
			if (this.reportDef.computeArAging) { this._computeArAging(); }
			if (this.reportDef.deriveCareGaps) { this._deriveCareGaps(); }
			if (this.reportDef.deriveRisk) { this._deriveRisk(); }
		} catch { this.items = []; }
	}

	/**
	 * Derive A/R aging columns from payment rows. The backend has no A/R ledger
	 * (invoices / ar-aging endpoints 500), so each transaction's amount is placed
	 * into the bucket matching the age of its collected date, with the other three
	 * buckets shown as $0 so no cell is blank. Also fills `payerDisplay`
	 * (Self-Pay fallback), `outstandingAmount` / `daysInAR` for the KPIs and
	 * `agingBucket` for the aging-buckets chart.
	 */
	private _computeArAging(): void {
		const now = Date.now();
		const DAY = 24 * 60 * 60 * 1000;
		for (const item of this.items) {
			const amount = Number(item.amount || item.totalAmount || 0) || 0;
			const dateStr = item.collectedAt || item.paymentDate || item.transactionDate || item.createdAt || '';
			const t = dateStr ? Date.parse(dateStr) : NaN;
			const ageDays = isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / DAY));
			let bucket: 'days0_30' | 'days31_60' | 'days61_90' | 'days90Plus';
			let bucketLabel: string;
			if (ageDays <= 30) { bucket = 'days0_30'; bucketLabel = '0-30'; }
			else if (ageDays <= 60) { bucket = 'days31_60'; bucketLabel = '31-60'; }
			else if (ageDays <= 90) { bucket = 'days61_90'; bucketLabel = '61-90'; }
			else { bucket = 'days90Plus'; bucketLabel = '90+'; }
			// Every bucket cell gets a value ($0 when not this row's bucket) so the
			// table never shows a blank aging column.
			item.days0_30 = fmtMoney(bucket === 'days0_30' ? amount : 0);
			item.days31_60 = fmtMoney(bucket === 'days31_60' ? amount : 0);
			item.days61_90 = fmtMoney(bucket === 'days61_90' ? amount : 0);
			item.days90Plus = fmtMoney(bucket === 'days90Plus' ? amount : 0);
			item.totalAmount = fmtMoney(amount);
			// Numeric copies the KPI calculators read via Number(...).
			item.outstandingAmount = String(amount);
			item.daysInAR = String(ageDays);
			item.agingBucket = bucketLabel;
			if (!item.payerDisplay) { item.payerDisplay = item.insurance || 'Self-Pay'; }
		}
	}

	/**
	 * Fill `patientName` from `patientId` for rows whose name the endpoint left
	 * blank (payment transactions return `patientName: null`). Loads the patient
	 * list once and builds an id → name map, so the Patient column populates
	 * without a per-row request. Falls back to the patient id when the name can't
	 * be resolved so the column is never blank for a real patient.
	 */
	private async _enrichPatient(): Promise<void> {
		// Only bother if at least one row is actually missing a name.
		const missing = this.items.filter(i => !i.patientName && i.patientId);
		if (missing.length === 0) { return; }
		try {
			const res = await this.apiService.fetch('/api/patients?page=0&size=2000');
			if (!res.ok) { return; }
			const json = await res.json();
			const raw = json?.data?.content || json?.data || json?.content || json || [];
			const patients = Array.isArray(raw) ? raw : [];
			const byId: Record<string, string> = {};
			for (const p of patients) {
				const o = p as Record<string, unknown>;
				const id = String(o.id ?? o.patientId ?? '');
				if (!id) { continue; }
				const name = `${String(o.firstName ?? '')} ${String(o.lastName ?? '')}`.trim()
					|| String(o.fullName ?? o.displayName ?? o.name ?? '');
				if (name) { byId[id] = name; }
			}
			for (const item of this.items) {
				if (item.patientName || !item.patientId) { continue; }
				item.patientName = byId[item.patientId] || `Patient #${item.patientId}`;
				if (!item.patientDisplay) { item.patientDisplay = item.patientName; }
			}
		} catch { /* patient list unavailable — leave names as-is */ }
	}

	/**
	 * Patient records from `/api/patients` do not carry insurance. Join the Coverage list
	 * (`/api/fhir-resource/insurance-coverage`) by patient id so the Insurance column and
	 * "All Insurance" filter populate. NOTE: `/api/coverages` returns insurance *companies*
	 * (Organization resources, no patientId) — it is the wrong endpoint for this join.
	 */
	private async _enrichInsurance(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/fhir-resource/insurance-coverage?page=0&size=2000');
			if (!res.ok) { return; }
			const json = await res.json();
			const raw = json?.data?.content || json?.data || json?.content || json || [];
			const coverages = Array.isArray(raw) ? raw : [];
			const byPatient: Record<string, string> = {};
			const refId = (v: unknown): string => {
				if (!v) { return ''; }
				if (typeof v === 'string') { return v.includes('/') ? v.substring(v.lastIndexOf('/') + 1) : v; }
				const o = v as Record<string, unknown>;
				const r = o.reference;
				return typeof r === 'string' ? (r.includes('/') ? r.substring(r.lastIndexOf('/') + 1) : r) : '';
			};
			const payerName = (c: Record<string, unknown>): string => {
				// `payerName` is the company name on a Coverage record; the others are
				// fallbacks for older/alternate shapes.
				const direct = c.payerName || c.provider || c.insurerName || c.insuranceName || c.companyName
					|| c.planName || c.coverageName;
				if (typeof direct === 'string' && direct) { return direct; }
				if (Array.isArray(c.payor) && c.payor.length > 0) {
					const p = c.payor[0] as Record<string, unknown>;
					if (typeof p?.display === 'string' && p.display) { return p.display; }
				}
				return '';
			};
			// Coverage records use `insuranceType` ("primary"/"secondary"); fall back
			// to `coverageType`/`type` for alternate shapes.
			const isPrimary = (c: Record<string, unknown>): boolean =>
				String(c.insuranceType || c.coverageType || c.type || '').toUpperCase() === 'PRIMARY';
			const primaryPatients = new Set<string>();
			for (const cov of coverages) {
				const c = cov as Record<string, unknown>;
				const pid = String(c.patientId || c.beneficiaryId || refId(c.beneficiary) || refId(c.subscriber) || '');
				if (!pid) { continue; }
				const name = payerName(c);
				if (!name) { continue; }
				// Prefer the PRIMARY coverage; otherwise keep the first one we encounter.
				if (isPrimary(c)) { byPatient[pid] = name; primaryPatients.add(pid); }
				else if (!byPatient[pid] && !primaryPatients.has(pid)) { byPatient[pid] = name; }
			}
			if (Object.keys(byPatient).length === 0) { return; }
			for (const item of this.items) {
				const pid = item.id || item.patientId || item.fhirId;
				const ins = (pid && byPatient[pid]) || '';
				if (ins) { item.insurance = ins; item.payerDisplay = ins; }
				else if (!item.insurance) { item.insurance = 'Self-Pay'; }
			}
		} catch { /* coverage endpoint may be unavailable — leave insurance as-is */ }
	}

	/**
	 * Patient records from `/api/patients` do not carry a provider. Join the
	 * encounter list (`/api/fhir-resource/encounters`) by patient id so the
	 * Provider column populates with the patient's most-recent treating provider
	 * (each encounter ships `providerDisplay` + `patientId`/`patientRef`).
	 */
	private async _enrichProvider(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/fhir-resource/encounters?page=0&size=2000');
			if (!res.ok) { return; }
			const json = await res.json();
			const raw = json?.data?.content || json?.data || json?.content || json || [];
			const encounters = Array.isArray(raw) ? raw : [];
			const refId = (v: unknown): string => {
				if (!v) { return ''; }
				if (typeof v === 'string') { return v.includes('/') ? v.substring(v.lastIndexOf('/') + 1) : v; }
				const o = v as Record<string, unknown>;
				const r = o.reference;
				return typeof r === 'string' ? (r.includes('/') ? r.substring(r.lastIndexOf('/') + 1) : r) : '';
			};
			// patientId → { provider, when } keeping the most recent encounter's provider.
			const byPatient: Record<string, { provider: string; when: number }> = {};
			for (const enc of encounters) {
				const e = enc as Record<string, unknown>;
				const pid = String(e.patientId || refId(e.patientRef) || refId(e.subject) || '');
				if (!pid) { continue; }
				const provider = String(e.providerDisplay || e.providerName || e.practitionerName || '').trim();
				if (!provider) { continue; }
				const when = Date.parse(String(e.startDate || e.start || e.date || e.periodStart || e._lastUpdated || '')) || 0;
				const cur = byPatient[pid];
				if (!cur || when >= cur.when) { byPatient[pid] = { provider, when }; }
			}
			if (Object.keys(byPatient).length === 0) { return; }
			for (const item of this.items) {
				if (item.providerDisplay || item.providerName) { continue; }
				const pid = item.id || item.patientId || item.fhirId;
				const prov = (pid && byPatient[pid]?.provider) || '';
				if (prov) { item.providerDisplay = prov; item.providerName = prov; }
			}
		} catch { /* encounters endpoint may be unavailable — leave provider as-is */ }
	}

	/**
	 * Join the encounter list once and stamp each patient row with the visit
	 * history the `/api/patients` feed lacks: `lastVisit` (ISO date),
	 * `daysSinceVisit`, `visitCount12mo` and `edVisits12mo`. Powers the derived
	 * Care Gaps and Risk Stratification reports.
	 */
	private async _enrichEncounterStats(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/fhir-resource/encounters?page=0&size=2000');
			if (!res.ok) { return; }
			const json = await res.json();
			const raw = json?.data?.content || json?.data || json?.content || json || [];
			const encounters = Array.isArray(raw) ? raw : [];
			const refId = (v: unknown): string => {
				if (!v) { return ''; }
				if (typeof v === 'string') { return v.includes('/') ? v.substring(v.lastIndexOf('/') + 1) : v; }
				const o = v as Record<string, unknown>;
				const r = o.reference;
				return typeof r === 'string' ? (r.includes('/') ? r.substring(r.lastIndexOf('/') + 1) : r) : '';
			};
			const now = Date.now();
			const DAY = 24 * 60 * 60 * 1000;
			const YEAR = 365 * DAY;
			const stats: Record<string, { last: number; visits12: number; ed12: number; complaints: Set<string> }> = {};
			for (const enc of encounters) {
				const e = enc as Record<string, unknown>;
				const pid = String(e.patientId || refId(e.patientRef) || refId(e.subject) || '');
				if (!pid) { continue; }
				const when = Date.parse(String(e.startDate || e.start || e.date || e.periodStart || e._lastUpdated || '')) || 0;
				const type = String(e.type || e.encounterType || e.class || e.visitCategory || '').toLowerCase();
				const isED = /emer|emergency|urgent/.test(type);
				let s = stats[pid];
				if (!s) { s = { last: 0, visits12: 0, ed12: 0, complaints: new Set<string>() }; stats[pid] = s; }
				if (when > s.last) { s.last = when; }
				if (when && now - when <= YEAR) { s.visits12++; if (isED) { s.ed12++; } }
				// Collect the encounter's clinical signal (diagnosis > chief complaint >
				// reason for visit) so reports whose formal problem list is empty can
				// still surface what the patient was seen for. See _cleanComplaints.
				for (const c of this._cleanComplaints(e.diagnosis, e.cc_text, e.reason)) { s.complaints.add(c); }
			}
			for (const item of this.items) {
				const pid = item.id || item.patientId || item.fhirId;
				const s = pid ? stats[pid] : undefined;
				if (s && s.last) {
					item.lastVisit = new Date(s.last).toISOString().slice(0, 10);
					item.daysSinceVisit = String(Math.max(0, Math.floor((now - s.last) / DAY)));
				} else {
					item.lastVisit = '';
					item.daysSinceVisit = '';
				}
				item.visitCount12mo = String(s?.visits12 || 0);
				item.edVisits12mo = String(s?.ed12 || 0);
				// Stash a chief-complaint/reason fallback for the Conditions column
				// (consumed by _enrichConditions when the problem list is empty).
				item.conditionsFallback = s ? [...s.complaints].slice(0, 3).join(', ') : '';
				// Full lowercase complaint text (not capped) so _deriveCareGaps can scan
				// for chronic-condition keywords across the whole visit history.
				item.complaintsAll = s ? [...s.complaints].join(' | ').toLowerCase() : '';
			}
		} catch { /* encounters endpoint may be unavailable — leave stats blank */ }
	}

	/**
	 * Join the practice immunization feed once (`/api/immunizations`) and stamp each
	 * patient row with `hasImmunization` = whether the patient has any immunization on
	 * record. The Care Gaps report uses this to flag patients with no recorded
	 * immunizations. Degrades to "no immunizations known" (all rows left unflagged)
	 * when the feed is empty or unavailable, so the gap simply doesn't fire.
	 */
	private async _enrichImmunizations(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/immunizations?page=0&size=2000');
			if (!res.ok) { return; }
			const json = await res.json();
			const raw = json?.data?.content || json?.data || json?.content || json || [];
			const rows = Array.isArray(raw) ? raw : [];
			const refId = (v: unknown): string => {
				if (!v) { return ''; }
				if (typeof v === 'string') { return v.includes('/') ? v.substring(v.lastIndexOf('/') + 1) : v; }
				const o = v as Record<string, unknown>;
				const r = o.reference;
				return typeof r === 'string' ? (r.includes('/') ? r.substring(r.lastIndexOf('/') + 1) : r) : '';
			};
			const vaccinated = new Set<string>();
			for (const row of rows) {
				const r = row as Record<string, unknown>;
				const pid = String(r.patientId || refId(r.patientRef) || refId(r.patient) || refId(r.subject) || '');
				if (pid) { vaccinated.add(pid); }
			}
			// No immunization data at all → we can't distinguish "no record" from "feed
			// empty", so leave every row unflagged (the immunization gap won't fire).
			if (vaccinated.size === 0) { return; }
			for (const item of this.items) {
				const pid = item.id || item.patientId || item.fhirId;
				item.hasImmunization = pid && vaccinated.has(pid) ? '1' : '';
				item.immunizationsKnown = '1';
			}
		} catch { /* immunization endpoint may be unavailable — leave rows unflagged */ }
	}

	/**
	 * Replace the loaded claim rows with one row per claim LINE for the CPT
	 * Utilization report. CPT/procedure codes are not on the bulk claim record, so
	 * we fan out one deployed `/api/all-claims/{claimId}/line-details` request per
	 * claim (batched and capped like {@link _enrichConditions}) and flatten each
	 * ClaimLineDetailDto into the report's columns. Claims with no line items
	 * contribute nothing; a tenant with no billed procedures yields an empty table.
	 */
	private async _deriveCptFromClaimLines(): Promise<void> {
		const MAX_CLAIMS = 500;
		const BATCH = 8;
		const claims = this.items.slice(0, MAX_CLAIMS);
		const lines: Record<string, string>[] = [];
		for (let i = 0; i < claims.length; i += BATCH) {
			const batch = claims.slice(i, i + BATCH);
			await Promise.all(batch.map(async claim => {
				const cid = String(claim.id || claim.claimId || claim.invoiceId || '').replace('Claim/', '').trim();
				if (!cid) { return; }
				try {
					const res = await this.apiService.fetch(`/api/all-claims/${cid}/line-details`);
					if (!res.ok) { return; }
					const json = await res.json();
					const raw = json?.data?.content || json?.data || json?.content || json || [];
					const rows = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];
					for (const ln of rows) {
						const code = String(ln.code ?? ln.cptCode ?? ln.cpt ?? ln.procedureCode ?? '').trim();
						const desc = String(ln.description ?? ln.treatment ?? ln.procedureDescription ?? '').trim();
						if (!code && !desc) { continue; }
						const amt = ln.totalSubmittedAmount ?? ln.totalAmount ?? ln.charge ?? ln.amount;
						const dos = String(ln.dos ?? ln.serviceDate ?? ln.startDate ?? '').trim();
						lines.push({
							cptCode: code,
							description: desc,
							providerDisplay: String(ln.provider ?? claim.provider ?? claim.providerDisplay ?? '').trim(),
							totalAmount: amt !== undefined && amt !== null && amt !== '' ? String(amt) : '',
							startDate: dos ? dos.split('T')[0] : '',
							patientId: String(claim.patientId ?? ''),
							patientName: String(claim.patientName ?? ''),
						});
					}
				} catch { /* per-claim line fetch failed — skip this claim */ }
			}));
		}
		this.items = lines;
	}

	/**
	 * Normalize an encounter's free-text clinical fields (diagnosis / chief
	 * complaint / reason-for-visit) into distinct, human-readable problem strings.
	 * Reason values often bundle noise (`"fever | Manual encounter"`) or carry only
	 * a visit-type token (`"AMB"`, `"Consultation"`), so we split on `|` and drop
	 * generic scheduling/visit-type words, keeping just the presenting problems.
	 */
	private _cleanComplaints(...raw: unknown[]): string[] {
		const NOISE = /^(manual encounter|amb|ambulatory|inpatient|outpatient|office( visit)?|clinic|consultation|consult|telehealth|virtual|scheduled visit|test scheduled visit|test|follow[- ]?up|new patient|established patient|routine|encounter|visit|n\/?a|none|unknown)$/i;
		const out: string[] = [];
		const seen = new Set<string>();
		for (const field of raw) {
			for (const part of String(field ?? '').split('|')) {
				const s = part.trim();
				if (s.length < 3 || /^\d+$/.test(s) || NOISE.test(s)) { continue; }
				const label = s.charAt(0).toUpperCase() + s.slice(1);
				const key = label.toLowerCase();
				if (!seen.has(key)) { seen.add(key); out.push(label); }
			}
		}
		return out;
	}

	/**
	 * Fill each patient row's `conditions` from its problem list. The FHIR resource
	 * controller exposes conditions only per-patient, so we fan out one request per
	 * row — batched for throughput and capped so a large practice can't fire hundreds
	 * of calls on a single report open. Where the problem list is empty (the tenant
	 * records no formal conditions), fall back to the encounter-derived chief
	 * complaint / reason stamped by {@link _enrichEncounterStats} so the column
	 * reflects the best available clinical signal instead of a blank cell.
	 */
	private async _enrichConditions(): Promise<void> {
		const MAX_PATIENTS = 250;
		const BATCH = 8;
		const targets = this.items
			.filter(i => (i.id || i.patientId || i.fhirId) && !i.conditions)
			.slice(0, MAX_PATIENTS);
		const label = (c: Record<string, unknown>): string => {
			const code = c.code as Record<string, unknown> | string | undefined;
			if (code && typeof code === 'object') {
				const coding = (code.coding as Array<Record<string, string>> | undefined)?.[0];
				const nested = String(code.text || coding?.display || '');
				if (nested) { return nested; }
			}
			return String(c.conditionName || c.display || c.text || (typeof code === 'string' ? code : '') || c.diagnosis || '').trim();
		};
		for (let i = 0; i < targets.length; i += BATCH) {
			const batch = targets.slice(i, i + BATCH);
			await Promise.all(batch.map(async item => {
				const pid = String(item.id || item.patientId || item.fhirId || '').replace('Patient/', '');
				if (!pid) { return; }
				try {
					const res = await this.apiService.fetch(`/api/fhir-resource/conditions/patient/${pid}?page=0&size=50`);
					if (!res.ok) { return; }
					const json = await res.json();
					const raw = json?.data?.content || json?.data || json?.content || json || [];
					const rows = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];
					const names = [...new Set(rows.map(label).filter(Boolean))];
					if (names.length) { item.conditions = names.join(', '); }
				} catch { /* per-patient fetch failed — leave this cell blank */ }
			}));
		}
		// Where the formal problem list yielded nothing, fall back to the
		// encounter-derived chief complaint / reason (stamped by
		// _enrichEncounterStats) so the Conditions column shows the best available
		// clinical signal rather than an empty cell.
		for (const item of this.items) {
			if (!item.conditions && item.conditionsFallback) { item.conditions = item.conditionsFallback; }
			delete item.conditionsFallback;
		}
	}

	/**
	 * Derive real "overdue for visit" care gaps from each patient's last-visit
	 * date (stamped by {@link _enrichEncounterStats}). A patient more than a year
	 * past their last visit — or never seen and registered over a year ago — is an
	 * open gap; everyone else is dropped so the table lists only actionable gaps.
	 * The backend has no care-gap engine, so this is the honest computable stand-in.
	 */
	private _deriveCareGaps(): void {
		// Thresholds (days) after which each gap becomes "open". A wellness visit is
		// expected yearly, but a 365-day window means an active practice — where most
		// patients were seen recently — shows an empty report, which reads as broken.
		// A 180-day window surfaces patients genuinely due for a preventive visit while
		// still being clinically meaningful; chronic patients are held to a tighter
		// 90-day follow-up cadence.
		const WELLNESS_DAYS = 180;
		const CHRONIC_DAYS = 90;
		const now = Date.now();
		const DAY = 24 * 60 * 60 * 1000;
		// Keywords that mark a chronic condition needing regular follow-up. Matched
		// against the patient's problem list / chief-complaint history (complaintsAll).
		const CHRONIC = /\b(diabet|a1c|hypertens|htn|high blood pressure|copd|asthma|chf|heart failure|cardiac|coronary|ckd|kidney disease|renal|hyperlipid|cholesterol|depress|anxiety|thyroid|hypothyroid|obes|cancer|oncolog|hiv|hepatitis|arthritis|seizure|epilep)\b/;
		const gaps: Record<string, string>[] = [];
		const push = (item: Record<string, string>, gapType: string, description: string, dueTs: number, overdue: number): void => {
			gaps.push({
				...item,
				gapType,
				description,
				dueDate: new Date(dueTs).toISOString().slice(0, 10),
				daysOverdue: String(Math.max(0, Math.round(overdue))),
				status: 'open',
			});
		};
		for (const item of this.items) {
			const hasVisit = !!item.lastVisit;
			const daysSince = Number(item.daysSinceVisit || 0);
			const lastTs = hasVisit ? (Date.parse(item.lastVisit) || 0) : 0;
			const regTs = Date.parse(item.createdAt || item.registrationDate || '') || 0;

			// 1) Overdue wellness / preventive visit.
			if (hasVisit) {
				if (daysSince > WELLNESS_DAYS && lastTs) {
					push(item, 'Wellness Visit', 'Overdue for preventive visit', lastTs + WELLNESS_DAYS * DAY, daysSince - WELLNESS_DAYS);
				}
			} else if (regTs && now - regTs > WELLNESS_DAYS * DAY) {
				// Never seen but registered long enough ago to be due.
				const dueTs = regTs + WELLNESS_DAYS * DAY;
				push(item, 'Wellness Visit', 'No visit on record', dueTs, (now - dueTs) / DAY);
			}

			// 2) Chronic-condition follow-up lapse — tighter cadence than wellness.
			if (hasVisit && lastTs && daysSince > CHRONIC_DAYS && CHRONIC.test(item.complaintsAll || '')) {
				push(item, 'Chronic Care Follow-up', 'Chronic condition without recent follow-up', lastTs + CHRONIC_DAYS * DAY, daysSince - CHRONIC_DAYS);
			}

			// 3) Missing immunization — only when the feed is known (see
			// _enrichImmunizations); otherwise we can't tell "none" from "unknown".
			if (item.immunizationsKnown && !item.hasImmunization) {
				const dueTs = regTs || lastTs || now;
				push(item, 'Immunization', 'No immunization on record', dueTs, (now - dueTs) / DAY);
			}
		}
		// Drop the per-patient scratch fields the derived gap rows don't display.
		for (const g of gaps) {
			delete g.complaintsAll; delete g.immunizationsKnown; delete g.hasImmunization; delete g.conditionsFallback;
		}
		this.items = gaps;
	}

	/**
	 * Derive a transparent, utilization-based risk score/tier per patient from the
	 * 12-month visit and ED-visit counts stamped by {@link _enrichEncounterStats}:
	 * +10 per visit, +25 per ED visit, capped at 100. This is an explainable proxy,
	 * NOT a clinical risk model (the backend exposes no risk-scoring engine).
	 * `conditions` needs a bulk problem-list endpoint that doesn't exist → blank.
	 */
	private _deriveRisk(): void {
		for (const item of this.items) {
			const visits = Number(item.visitCount12mo || 0);
			const ed = Number(item.edVisits12mo || 0);
			const score = Math.min(100, visits * 10 + ed * 25);
			item.riskScore = String(score);
			item.riskTier = score >= 75 ? 'Very High' : score >= 50 ? 'High' : score >= 25 ? 'Moderate' : 'Low';
			item.edVisits = String(ed);
			if (!item.conditions) { item.conditions = ''; }
		}
	}

	/** Collapse raw encounter rows into one row per condition for the Disease
	 *  Registry table: `totalPatients` = distinct patients, `avgDaysSinceVisit` =
	 *  mean days since each patient's most recent visit for that condition.
	 *  `controlled`/`controlPct` have no encounter-side source and stay blank. */
	private _aggregateByCondition(rows: Record<string, string>[]): Record<string, string>[] {
		const now = Date.now();
		const DAY = 24 * 60 * 60 * 1000;
		const groups = new Map<string, { patients: Set<string>; recentByPatient: Map<string, number> }>();
		for (const r of rows) {
			const key = r.condition || r.diagnosis || r.code || 'Unspecified';
			let g = groups.get(key);
			if (!g) { g = { patients: new Set<string>(), recentByPatient: new Map<string, number>() }; groups.set(key, g); }
			const pid = r.patientId || r.patientName || r.patientRefDisplay || '';
			if (pid) { g.patients.add(pid); }
			const when = Date.parse(r.startDate || r.recordedDate || r.serviceDate || '') || 0;
			if (pid && when) { const cur = g.recentByPatient.get(pid) || 0; if (when > cur) { g.recentByPatient.set(pid, when); } }
		}
		const out: Record<string, string>[] = [];
		for (const [condition, g] of groups) {
			const recents = [...g.recentByPatient.values()];
			const avgDays = recents.length ? Math.round(recents.reduce((sum, w) => sum + Math.max(0, (now - w) / DAY), 0) / recents.length) : 0;
			out.push({
				condition,
				totalPatients: String(g.patients.size),
				controlled: '',
				controlPct: '',
				avgDaysSinceVisit: recents.length ? String(avgDays) : '',
			});
		}
		out.sort((a, b) => Number(b.totalPatients) - Number(a.totalPatients));
		return out;
	}

	private _normalizeRow(r: Record<string, unknown>): Record<string, string> {
		const isPlainObject = (v: unknown): v is Record<string, unknown> =>
			v !== null && typeof v === 'object' && !Array.isArray(v);

		const s = (v: unknown): string => {
			if (v === null || v === undefined) { return ''; }
			if (Array.isArray(v)) {
				if (v.length >= 3 && typeof v[0] === 'number' && typeof v[1] === 'number') {
					const [y, m, d] = v as number[];
					return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
				}
				return v.map(x => s(x)).filter(Boolean).join(', ');
			}
			if (typeof v === 'object') {
				const o = v as Record<string, unknown>;
				return String(o.text || o.display || (o.coding as Array<Record<string, string>>)?.[0]?.display || JSON.stringify(o).substring(0, 60));
			}
			return String(v);
		};

		const out: Record<string, string> = {};
		const walk = (val: unknown, prefix: string): void => {
			if (!isPlainObject(val)) { return; }
			for (const [k, v] of Object.entries(val)) {
				const dotKey = prefix ? `${prefix}.${k}` : k;
				if (isPlainObject(v)) {
					out[dotKey] = s(v);
					walk(v, dotKey);
					if (!out[k]) { out[k] = s(v); }
				} else {
					const str = s(v);
					out[dotKey] = str;
					if (!out[k] || out[k] === '[object Object]') { out[k] = str; }
				}
			}
		};
		walk(r, '');

		const pickFirst = (...vals: string[]): string => { for (const v of vals) { if (v) { return v; } } return ''; };

		const firstName = pickFirst(out['firstName'], out['given']);
		const lastName = pickFirst(out['lastName'], out['family']);
		if (!out['name']) { out['name'] = `${firstName} ${lastName}`.trim() || pickFirst(out['displayName'], out['fullName']); }
		if (!out['phone']) { out['phone'] = pickFirst(out['phoneNumber'], out['phoneHome'], out['phoneMobile'], out['mobile'], out['contact.phone'], out['contact.phoneNumber']); }
		if (!out['birthDate']) { out['birthDate'] = pickFirst(out['dateOfBirth'], out['dob']); }
		if (!out['gender']) { out['gender'] = pickFirst(out['sex']); }
		if (out['active'] === 'true') { out['active'] = 'Active'; }
		else if (out['active'] === 'false') { out['active'] = 'Inactive'; }
		if (!out['active']) { out['active'] = pickFirst(out['status']); }

		if (!out['patientName']) {
			// For patient-feed reports (Risk Stratification, Care Gaps) the row *is*
			// the patient, so its name is the top-level `firstName`/`lastName` (or the
			// backend's pre-joined `name`/`fullName`) — not a `patient*`-prefixed field.
			// Include those here so the Patient column isn't blank on `/api/patients` rows.
			const pFirst = pickFirst(out['patientFirstName'], out['patient.firstName'], out['firstName']);
			const pLast = pickFirst(out['patientLastName'], out['patient.lastName'], out['lastName']);
			out['patientName'] = `${pFirst} ${pLast}`.trim() || pickFirst(out['patientDisplay'], out['patientRefDisplay'], out['subjectDisplay'], out['patient.name'], out['patient'], out['fullName'], out['name']);
		}
		if (!out['patientDisplay']) { out['patientDisplay'] = pickFirst(out['patientName'], out['patientRefDisplay'], out['subjectDisplay']); }
		if (!out['patientRefDisplay']) { out['patientRefDisplay'] = pickFirst(out['patientDisplay'], out['patientName'], out['subjectDisplay']); }
		// Some encounter rows carry the patient's name directly in `patientRef`
		// rather than a "Patient/<id>" reference — fall back to it so the Patient
		// column isn't blank.
		if (!out['patientRefDisplay'] && out['patientRef'] && !out['patientRef'].includes('/')) {
			out['patientRefDisplay'] = out['patientRef'];
			if (!out['patientName']) { out['patientName'] = out['patientRef']; }
			if (!out['patientDisplay']) { out['patientDisplay'] = out['patientRef']; }
		}

		if (!out['providerName']) { out['providerName'] = pickFirst(out['encounterProvider'], out['providerDisplay'], out['practitionerName'], out['orderingProvider'], out['physicianName'], out['prescriberName'], out['referringProvider'], out['provider']); }
		if (!out['providerDisplay']) { out['providerDisplay'] = pickFirst(out['encounterProvider'], out['providerName'], out['practitionerName'], out['prescriberName']); }
		if (!out['prescriberName']) { out['prescriberName'] = pickFirst(out['providerName'], out['providerDisplay']); }
		if (!out['orderingProvider']) { out['orderingProvider'] = pickFirst(out['physicianName'], out['providerName'], out['providerDisplay']); }

		if (!out['payerDisplay']) { out['payerDisplay'] = pickFirst(out['insurerName'], out['insuranceName'], out['organizationDisplay'], out['payerName'], out['payor.display'], out['insurance'], out['primaryInsurance'], out['insuranceProvider'], out['payer']); }
		if (!out['insurance']) { out['insurance'] = pickFirst(out['payerDisplay'], out['insurerName'], out['insuranceName'], out['primaryInsurance'], out['insuranceProvider']); }
		if (!out['payerName']) { out['payerName'] = pickFirst(out['payerDisplay'], out['insurerName'], out['insuranceName']); }

		if (!out['specialistName']) { out['specialistName'] = pickFirst(out['specialist'], out['providerName'], out['referredTo']); }
		if (!out['specialty']) { out['specialty'] = pickFirst(out['specialtyDisplay'], out['practiceArea']); }

		if (!out['user']) { out['user'] = pickFirst(out['userName'], out['userId']); }
		if (!out['userName']) { out['userName'] = pickFirst(out['user'], out['userId']); }

		if (!out['code']) { out['code'] = pickFirst(out['display'], out['text'], out['diagnosisCode'], out['icdCode'], out['conditionCode']); }
		if (!out['icdCode']) { out['icdCode'] = pickFirst(out['diagnosisCode'], out['code'], out['conditionCode']); }
		// CPT Utilization: the invoice-line feed exposes the procedure code under
		// varying keys depending on the backend build (`cptCode` in the newer map,
		// but `cpt4`/`cpt`/`code`/`procedureCode` in the deployed invoice-line
		// shape), which left the CPT Code column blank. Resolve it from any alias.
		if (!out['cptCode']) { out['cptCode'] = pickFirst(out['cpt4'], out['cpt'], out['procedureCode'], out['lineCode'], out['hcpcs'], out['billingCode'], out['code']); }
		// Description likewise arrives as `treatment`/`procedureDescription`/etc. on
		// the invoice-line shape; fall back to those before the diagnosis-side keys.
		if (!out['description']) { out['description'] = pickFirst(out['treatment'], out['procedureDescription'], out['lineTreatment'], out['cptDescription'], out['procedureName'], out['serviceDescription'], out['display'], out['text'], out['shortDescription'], out['conditionName'], out['diagnosisDescription']); }
		// diagnosis column for encounter summary — map from FHIR Encounter reasonCode/diagnoses
		if (!out['diagnosis']) {
			out['diagnosis'] = pickFirst(
				out['reasonCode'], out['reasonCodeDisplay'], out['diagnosisCode'], out['diagnosis.condition.display'],
				out['reasonDisplay'], out['diagnosisDescription'], out['code'],
				// The /api/encounters/report/encounterAll endpoint carries no coded
				// diagnosis — fall back to the chief complaint (cc_text) and then the
				// reason-for-visit so the Diagnosis column isn't blank.
				out['cc_text'], out['chiefComplaint'], out['reasonForVisit'], out['reason'],
			);
		}
		// Disease Registry groups on `condition`; encounterAll carries the dx under
		// `diagnosis`/`code`, so mirror it here or the Condition column is blank.
		if (!out['condition']) { out['condition'] = pickFirst(out['diagnosis'], out['code'], out['conditionName'], out['reasonCode'], out['reasonDisplay']); }
		// Prefer a readable display/category, then the raw `type`, and translate any
		// FHIR class code (AMB/VR/EMER/…) to a friendly label so the Visit Type
		// column shows e.g. "Ambulatory" instead of "AMB".
		const chosenType = pickFirst(out['typeDisplay'], out['encounterType'], out['visitCategory'], out['type'], out['serviceType'], out['appointmentType']);
		out['type'] = ENCOUNTER_CLASS_LABELS[chosenType.toUpperCase()] || chosenType;
		if (!out['appointmentType']) { out['appointmentType'] = pickFirst(out['type'], out['serviceType'], out['encounterType']); }
		if (!out['clinicalStatus']) { out['clinicalStatus'] = pickFirst(out['conditionStatus'], out['status']); }

		if (!out['totalAmount']) { out['totalAmount'] = pickFirst(out['amount'], out['totalGross'], out['totalNet'], out['total'], out['charges']); }

		// Payment-method label for the Revenue report: "Visa ••4242" for cards,
		// otherwise the plain method type (cash/check/…).
		if (!out['paymentMethodLabel']) {
			const brand = pickFirst(out['cardBrand']);
			const last4 = pickFirst(out['lastFour']);
			out['paymentMethodLabel'] = brand && last4 ? `${brand} ••${last4}` : pickFirst(out['paymentMethodType'], brand);
		}

		if (!out['createdAt']) { out['createdAt'] = pickFirst(out['audit.createdDate'], out['createdDate'], out['createdOn'], out['registrationDate'], out['_lastUpdated'], out['timestamp']); }
		if (!out['startDate']) { out['startDate'] = pickFirst(out['start'], out['period.start'], out['effectiveDate']); }
		// `/api/all-claims` (PatientClaimDto) carries only `createdOn` as its date —
		// no serviced/period — so fall back to it, otherwise the denial-management
		// Date column and the "Denial Trend" chart (dateField: serviceDate) come up
		// empty ("No data") even though rows load.
		if (!out['serviceDate']) { out['serviceDate'] = pickFirst(out['serviced'], out['servicedDate'], out['period.start'], out['date'], out['createdOn']); }
		if (!out['orderDate']) { out['orderDate'] = pickFirst(out['orderDateTime'], out['authoredOn'], out['date']); }
		if (!out['referralDate']) { out['referralDate'] = pickFirst(out['authoredOn'], out['createdAt'], out['createdDate']); }
		if (!out['administrationDate']) { out['administrationDate'] = pickFirst(out['occurrenceDate'], out['date'], out['administeredDate'], out['administrationDate']); }
		if (!out['administeredBy']) { out['administeredBy'] = pickFirst(out['performerName'], out['providerName'], out['providerDisplay'], out['practitionerName']); }
		if (!out['recordedDate']) { out['recordedDate'] = pickFirst(out['recorded'], out['createdAt']); }
		if (!out['onsetDate']) { out['onsetDate'] = pickFirst(out['onsetDateTime'], out['onset']); }
		if (!out['appointmentDate']) { out['appointmentDate'] = pickFirst(out['date'], out['start'], out['startDate']); }
		if (!out['appointmentTime']) {
			const start = pickFirst(out['start'], out['startTime'], out['appointmentTime']);
			if (start) {
				const m = /T(\d{2}):(\d{2})/.exec(start);
				if (m) { out['appointmentTime'] = `${m[1]}:${m[2]}`; }
			}
		}

		// Age group derived from birthDate
		if (!out['ageGroup'] && out['birthDate']) {
			const yr = new Date(out['birthDate']).getFullYear();
			if (!isNaN(yr)) {
				const age = new Date().getFullYear() - yr;
				if (age < 18) { out['ageGroup'] = '0-17'; }
				else if (age < 30) { out['ageGroup'] = '18-29'; }
				else if (age < 50) { out['ageGroup'] = '30-49'; }
				else if (age < 65) { out['ageGroup'] = '50-64'; }
				else { out['ageGroup'] = '65+'; }
			}
		}

		if (!out['vaccineName']) { out['vaccineName'] = pickFirst(out['vaccineCode'], out['name']); }
		if (!out['medicationName']) { out['medicationName'] = pickFirst(out['drugName'], out['medication'], out['name']); }

		return out;
	}

	private _filteredItems(): Record<string, string>[] {
		let result = this.items;
		const rowDate = (i: Record<string, string>): string =>
			i.startDate || i.start || i.referralDate || i.administrationDate || i.serviceDate
			|| i.orderDate || i.appointmentDate || i.recordedDate || i.onsetDate
			|| i.timestamp || i.createdAt || '';

		if (this.filterValues['dateFrom']) {
			const from = new Date(this.filterValues['dateFrom']).getTime();
			result = result.filter(i => { const d = rowDate(i); return d ? new Date(d).getTime() >= from : true; });
		}
		if (this.filterValues['dateTo']) {
			const to = new Date(this.filterValues['dateTo'] + 'T23:59:59').getTime();
			result = result.filter(i => { const d = rowDate(i); return d ? new Date(d).getTime() <= to : true; });
		}

		const fieldAccessors: Record<string, (i: Record<string, string>) => string> = {
			provider: i => i.providerName || i.providerDisplay || i.encounterProvider || i.prescriberName || i.orderingProvider || '',
			status: i => i.status || i.clinicalStatus || '',
			diagnosis: i => i.diagnosis || '',
			patient: i => i.patientName || i.patientDisplay || i.patientRefDisplay || '',
			medication: i => i.medicationName || '',
			prescriber: i => i.prescriberName || i.providerName || '',
			specialty: i => i.specialty || '',
			vaccine: i => i.vaccineName || '',
			site: i => i.site || i.bodySite || '',
			payer: i => i.payerDisplay || i.insurance || '',
			insurance: i => i.insurance || i.payerDisplay || '',
			test: i => i.testDisplay || i.orderName || i.code || '',
			cptCode: i => i.cptCode || i.code || '',
			description: i => i.description || i.code || '',
			user: i => i.userName || i.user || '',
			ipAddress: i => i.ipAddress || '',
			resource: i => i.resourceType || '',
			action: i => i.action || '',
			feature: i => i.feature || '',
			condition: i => i.condition || i.code || '',
			riskTier: i => i.riskTier || '',
			gapType: i => i.gapType || '',
			measure: i => i.measure || '',
			category: i => i.category || '',
			denialReason: i => i.denialReason || '',
			reason: i => i.cancelReason || i.reason || '',
			time: i => i.appointmentTime || '',
			visitType: i => i.appointmentType || i.type || '',
			referredTo: i => i.specialistName || i.referredTo || '',
			urgency: i => i.urgency || '',
			gender: i => i.gender || '',
			ageGroup: i => i.ageGroup || '',
			priority: i => i.priority || '',
			administeredBy: i => i.administeredBy || i.performerName || i.providerName || '',
		};

		for (const f of this.reportDef.filters) {
			if (f.type !== 'select') { continue; }
			const raw = this.filterValues[f.key];
			if (!raw) { continue; }
			const v = raw.toLowerCase();
			const accessor = fieldAccessors[f.key] || ((i: Record<string, string>) => i[f.key] || '');
			result = result.filter(i => accessor(i).toLowerCase().includes(v));
		}

		if (this.sortKey) {
			result = this._sortRows(result);
		}

		return result;
	}

	/** Apply the active column sort to any row set (used for both the raw list and
	 *  the aggregated Provider Productivity table). */
	private _sortRows(rows: Record<string, string>[]): Record<string, string>[] {
		if (!this.sortKey) { return rows; }
		const dir = this.sortDir === 'asc' ? 1 : -1;
		return [...rows].sort((a, b) => {
			const av = a[this.sortKey] || '';
			const bv = b[this.sortKey] || '';
			const an = Number(av); const bn = Number(bv);
			if (!isNaN(an) && !isNaN(bn) && av && bv) { return (an - bn) * dir; }
			return av.localeCompare(bv) * dir;
		});
	}

	/** Collapse raw encounter rows into one row per provider for the Provider
	 *  Productivity table: `encounters` = count, `patientsPerDay` = distinct
	 *  patients / distinct service days. wRVU/charges/collections have no
	 *  encounter-side source, so they stay blank (not a misleading 0). */
	private _aggregateByProvider(rows: Record<string, string>[]): Record<string, string>[] {
		const groups = new Map<string, { encounters: number; patients: Set<string>; days: Set<string> }>();
		for (const r of rows) {
			const key = r.providerDisplay || r.encounterProvider || 'Unassigned';
			let g = groups.get(key);
			if (!g) { g = { encounters: 0, patients: new Set<string>(), days: new Set<string>() }; groups.set(key, g); }
			g.encounters++;
			const pid = r.patientId || r.patientName;
			if (pid) { g.patients.add(pid); }
			const day = (r.startDate || r.encounterDate || '').slice(0, 10);
			if (day) { g.days.add(day); }
		}
		const out: Record<string, string>[] = [];
		for (const [provider, g] of groups) {
			const days = g.days.size || 1;
			const patients = g.patients.size || g.encounters;
			out.push({
				providerDisplay: provider,
				encounters: String(g.encounters),
				patientsPerDay: (patients / days).toFixed(1),
				wRVU: '',
				charges: '',
				collections: '',
			});
		}
		// Busiest providers first when the user hasn't picked a sort column.
		out.sort((a, b) => Number(b.encounters) - Number(a.encounters));
		return out;
	}

	/** Collapse raw patient rows into one row per payer for the Payer Mix table:
	 *  `patientCount` = patients with that payer, `patientPct` = share of the
	 *  total. revenue/revenuePct/avgReimbRate have no patient-side source (they
	 *  need a payments join the backend doesn't expose), so they stay blank
	 *  rather than a misleading 0. */
	private _aggregateByPayer(rows: Record<string, string>[]): Record<string, string>[] {
		const groups = new Map<string, number>();
		for (const r of rows) {
			const key = r.payerDisplay || r.insurance || 'Self-Pay';
			groups.set(key, (groups.get(key) || 0) + 1);
		}
		const total = rows.length || 1;
		const out: Record<string, string>[] = [];
		for (const [payer, count] of groups) {
			out.push({
				payerDisplay: payer,
				patientCount: String(count),
				patientPct: fmtPct(100 * count / total),
				revenue: '',
				revenuePct: '',
				avgReimbRate: '',
			});
		}
		// Largest payers first when the user hasn't picked a sort column.
		out.sort((a, b) => Number(b.patientCount) - Number(a.patientCount));
		return out;
	}

	/** Collapse raw appointment rows into one row per provider for the Scheduling
	 *  Utilization table: `booked` = appointments, `completed` = fulfilled count,
	 *  `utilization` = kept (non-cancel/no-show) ÷ booked — the same measure as
	 *  this report's Utilization Rate KPI. `availableSlots` (no free-slot feed)
	 *  and `revenue` (needs a payments join) have no source, so they stay blank
	 *  rather than a misleading 0. */
	private _aggregateBySchedule(rows: Record<string, string>[]): Record<string, string>[] {
		const groups = new Map<string, { booked: number; completed: number; kept: number }>();
		for (const r of rows) {
			const key = r.providerName || r.providerDisplay || 'Unassigned';
			let g = groups.get(key);
			if (!g) { g = { booked: 0, completed: 0, kept: 0 }; groups.set(key, g); }
			g.booked++;
			const status = r.status || '';
			if (/complet|fulfilled/i.test(status)) { g.completed++; }
			if (!/cancel|no[-_ ]?show/i.test(status)) { g.kept++; }
		}
		const out: Record<string, string>[] = [];
		for (const [provider, g] of groups) {
			out.push({
				providerName: provider,
				availableSlots: '',
				booked: String(g.booked),
				completed: String(g.completed),
				utilization: g.booked ? fmtPct(100 * g.kept / g.booked) : '0%',
				revenue: '',
			});
		}
		// Busiest providers first when the user hasn't picked a sort column.
		out.sort((a, b) => Number(b.booked) - Number(a.booked));
		return out;
	}

	private _render(): void {
		const filtered = this._filteredItems();
		// The table can show an aggregated view (one row per provider) while the
		// KPIs and charts keep counting the raw rows below.
		const tableRows = this.reportDef.groupByProvider
			? this._sortRows(this._aggregateByProvider(filtered))
			: this.reportDef.groupByPayer
				? this._sortRows(this._aggregateByPayer(filtered))
				: this.reportDef.groupBySchedule
					? this._sortRows(this._aggregateBySchedule(filtered))
					: this.reportDef.groupByCondition
						? this._sortRows(this._aggregateByCondition(filtered))
						: filtered;

		// KPIs
		DOM.clearNode(this.kpiEl);
		const kpiRow = DOM.append(this.kpiEl, DOM.$('div'));
		kpiRow.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;';
		for (const kpi of this.reportDef.kpis) {
			const card = DOM.append(kpiRow, DOM.$('div'));
			card.style.cssText = `padding:14px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;border-left:3px solid ${kpi.color || COLORS[0]};`;
			const val = DOM.append(card, DOM.$('div'));
			val.textContent = kpi.calc(filtered);
			val.style.cssText = 'font-size:22px;font-weight:700;line-height:1.2;';
			const lbl = DOM.append(card, DOM.$('div'));
			lbl.textContent = kpi.label;
			lbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
		}

		// Charts
		DOM.clearNode(this.chartsEl);
		for (const chart of this.reportDef.charts) {
			const sorted = this._computeChartData(filtered, chart);
			this._renderChart(this.chartsEl, chart, sorted);
		}

		// Table
		DOM.clearNode(this.tableEl);
		const tableHeader = DOM.append(this.tableEl, DOM.$('div'));
		tableHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
		const tableTitle = DOM.append(tableHeader, DOM.$('h3'));
		tableTitle.textContent = `Detail Data (${tableRows.length} records)`;
		tableTitle.style.cssText = 'font-size:13px;font-weight:600;margin:0;flex:1;';

		const tbl = DOM.append(this.tableEl, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;';
		const cols = this.reportDef.columns;
		const gridCols = cols.map(() => '1fr').join(' ');

		const hdr = DOM.append(tbl, DOM.$('div'));
		hdr.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const c of cols) {
			const span = DOM.append(hdr, DOM.$('span'));
			// allow-any-unicode-next-line
			span.textContent = c.label + (this.sortKey === c.key ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
			span.style.cssText = 'cursor:pointer;user-select:none;';
			span.addEventListener('click', () => {
				if (this.sortKey === c.key) { this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'; }
				else { this.sortKey = c.key; this.sortDir = 'desc'; }
				this._render();
			});
		}

		const start = this.currentPage * this.pageSize;
		const end = start + this.pageSize;
		const pageItems = tableRows.slice(start, end);
		if (pageItems.length === 0) {
			const empty = DOM.append(tbl, DOM.$('div'));
			empty.style.cssText = 'padding:30px;text-align:center;color:var(--vscode-descriptionForeground);';
			// Distinguish "the report itself produced no rows" (show the report's own
			// intentional-empty message, e.g. no care gaps due) from "the user's
			// filters excluded everything" (the generic message).
			empty.textContent = this.items.length === 0 && this.reportDef.emptyMessage
				? this.reportDef.emptyMessage
				: 'No records match the current filters';
		}
		for (const item of pageItems) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:5px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });
			for (const c of cols) {
				const cell = DOM.append(r, DOM.$('span'));
				let val = String(item[c.key] || '');
				if ((c.key.endsWith('Date') || c.key.endsWith('At') || c.key === 'recordedDate') && val && !isNaN(Date.parse(val))) {
					try { val = new Date(val).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); } catch { /* ignore */ }
				}
				cell.textContent = val;
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			}
		}

		// Pagination
		const totalPages = Math.max(1, Math.ceil(tableRows.length / this.pageSize));
		if (tableRows.length > 0) {
			const pag = DOM.append(this.tableEl, DOM.$('div'));
			pag.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 4px;justify-content:space-between;';
			const info = DOM.append(pag, DOM.$('span'));
			info.textContent = `Showing ${Math.min(start + 1, tableRows.length)}-${Math.min(end, tableRows.length)} of ${tableRows.length} records`;
			info.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

			const pagBtns = DOM.append(pag, DOM.$('div'));
			pagBtns.style.cssText = 'display:flex;gap:6px;align-items:center;';
			const prev = DOM.append(pagBtns, DOM.$('button')) as HTMLButtonElement;
			prev.textContent = '← Previous';
			prev.style.cssText = BTN_SECONDARY + (this.currentPage === 0 ? 'opacity:0.5;cursor:not-allowed;' : '');
			prev.disabled = this.currentPage === 0;
			prev.addEventListener('click', () => { if (this.currentPage > 0) { this.currentPage--; this._render(); } });

			const pageInfo = DOM.append(pagBtns, DOM.$('span'));
			pageInfo.textContent = `Page ${this.currentPage + 1} of ${totalPages}`;
			pageInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);padding:0 8px;';

			const next = DOM.append(pagBtns, DOM.$('button')) as HTMLButtonElement;
			next.textContent = 'Next →';
			next.style.cssText = BTN_SECONDARY + (this.currentPage >= totalPages - 1 ? 'opacity:0.5;cursor:not-allowed;' : '');
			next.disabled = this.currentPage >= totalPages - 1;
			next.addEventListener('click', () => { if (this.currentPage < totalPages - 1) { this.currentPage++; this._render(); } });
		}
	}

	private _computeChartData(items: Record<string, string>[], chart: ChartDef): Array<[string, number]> {
		const aggregate = chart.aggregate || 'count';
		if (aggregate === 'month') {
			const counts: Record<string, number> = {};
			const df = chart.dateField;
			for (const i of items) {
				const raw = (df && i[df]) || i.collectedAt || i.paymentDate || i.transactionDate || i.collectedDate
					|| i.startDate || i.serviceDate || i.referralDate || i.administrationDate
					|| i.orderDate || i.appointmentDate || i.recordedDate || i.createdAt || i.date || '';
				if (!raw) { continue; }
				// Prefer the ISO-leading YYYY-MM (avoids timezone drift). Fall back to a
				// full date parse so non-ISO formats (e.g. "06/30/2026", "Jun 30, 2026",
				// epoch millis) still bucket — matching the date-tolerant table column
				// and the day-of-week / hour branches, which already use Date.parse.
				let key = '';
				const m = /^(\d{4})-(\d{2})/.exec(raw);
				if (m) {
					key = `${m[1]}-${m[2]}`;
				} else {
					const t = Date.parse(raw);
					if (isNaN(t)) { continue; }
					const d = new Date(t);
					key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
				}
				counts[key] = (counts[key] || 0) + 1;
			}
			return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
		}
		if (aggregate === 'day-of-week') {
			const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
			const counts: Record<string, number> = {};
			for (const d of days) { counts[d] = 0; }
			const df = chart.dateField;
			for (const i of items) {
				const raw = (df && i[df]) || i.startDate || i.serviceDate || i.referralDate || i.administrationDate
					|| i.orderDate || i.appointmentDate || i.recordedDate || i.createdAt || '';
				if (!raw) { continue; }
				const t = Date.parse(raw);
				if (isNaN(t)) { continue; }
				const day = days[new Date(t).getDay()];
				counts[day]++;
			}
			return days.map(d => [d, counts[d]] as [string, number]);
		}
		if (aggregate === 'hour') {
			const counts = new Array(24).fill(0);
			const df = chart.dateField;
			for (const i of items) {
				const raw = (df && i[df]) || i.startDate || i.timestamp || i.createdAt || '';
				if (!raw) { continue; }
				const t = Date.parse(raw);
				if (isNaN(t)) { continue; }
				counts[new Date(t).getHours()]++;
			}
			return counts.map((n, h) => [`${String(h).padStart(2, '0')}:00`, n] as [string, number]);
		}
		// Default: count by groupKey
		const counts: Record<string, number> = {};
		for (const item of items) {
			const v = String(item[chart.groupKey] || 'Other');
			counts[v] = (counts[v] || 0) + 1;
		}
		const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
		const limit = chart.limit ?? (chart.topN ? 10 : undefined);
		return limit ? sorted.slice(0, limit) : sorted;
	}

	private _renderChart(parent: HTMLElement, chart: ChartDef, sorted: Array<[string, number]>): void {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'padding:14px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;background:var(--vscode-editor-background);';
		const title = DOM.append(card, DOM.$('h3'));
		title.textContent = chart.label;
		title.style.cssText = 'font-size:13px;font-weight:600;margin:0 0 10px;';

		if (sorted.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No data';
			empty.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;padding:20px 0;';
			return;
		}

		if (chart.type === 'horizontalBar') {
			const barData = sorted.slice(0, chart.limit ?? 15);
			const max = Math.max(...barData.map(d => d[1]), 1);
			const chartEl = DOM.append(card, DOM.$('div'));
			chartEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
			for (let i = 0; i < barData.length; i++) {
				const [label, value] = barData[i];
				const row = DOM.append(chartEl, DOM.$('div'));
				row.style.cssText = 'display:grid;grid-template-columns:120px 1fr 40px;gap:8px;align-items:center;';
				const lblEl = DOM.append(row, DOM.$('span'));
				lblEl.textContent = label.length > 18 ? label.substring(0, 18) + '…' : label;
				lblEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				lblEl.title = label;
				const barWrap = DOM.append(row, DOM.$('div'));
				barWrap.style.cssText = 'height:14px;background:rgba(128,128,128,0.08);border-radius:3px;overflow:hidden;';
				const bar = DOM.append(barWrap, DOM.$('div'));
				bar.style.cssText = `width:${(value / max) * 100}%;height:100%;background:${COLORS[i % COLORS.length]};`;
				bar.title = `${label}: ${value}`;
				const valEl = DOM.append(row, DOM.$('span'));
				valEl.textContent = String(value);
				valEl.style.cssText = 'font-size:11px;font-weight:600;text-align:right;';
			}
		} else if (chart.type === 'bar') {
			const barData = sorted.slice(0, chart.limit ?? 12);
			const max = Math.max(...barData.map(d => d[1]), 1);
			const chartEl = DOM.append(card, DOM.$('div'));
			chartEl.style.cssText = 'display:flex;align-items:flex-end;gap:4px;height:140px;';
			for (let i = 0; i < barData.length; i++) {
				const [label, value] = barData[i];
				const col = DOM.append(chartEl, DOM.$('div'));
				col.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;';
				const bar = DOM.append(col, DOM.$('div'));
				bar.style.cssText = `width:100%;max-width:50px;height:${Math.max((value / max) * 110, 3)}px;background:${COLORS[i % COLORS.length]};border-radius:3px 3px 0 0;`;
				bar.title = `${label}: ${value}`;
				const valEl = DOM.append(col, DOM.$('div'));
				valEl.textContent = String(value);
				valEl.style.cssText = 'font-size:10px;font-weight:600;line-height:12px;height:12px;';
				const lblEl = DOM.append(col, DOM.$('div'));
				lblEl.textContent = label;
				lblEl.title = label;
				// Fixed single-line label height so a longer condition name can't wrap to
				// two lines and push its bar/value up (the columns are bottom-aligned) —
				// keeping every bar and value number on a shared baseline across the chart.
				lblEl.style.cssText = 'font-size:8px;color:var(--vscode-descriptionForeground);text-align:center;width:100%;height:11px;line-height:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			}
		} else if (chart.type === 'line' || chart.type === 'area') {
			// Time-series: render as area-fill polygon over horizontally-laid points.
			// Inputs are ordered chronologically (or alphabetically for non-month keys).
			const data = sorted.slice(0, chart.limit ?? 60);
			const max = Math.max(...data.map(d => d[1]), 1);
			const w = 100; const h = 140;
			const wrap = DOM.append(card, DOM.$('div'));
			wrap.style.cssText = 'position:relative;height:140px;';
			const svg = DOM.append(wrap, DOM.$('svg')) as unknown as SVGSVGElement;
			svg.setAttribute('viewBox', `0 0 ${w * data.length} ${h}`);
			svg.setAttribute('preserveAspectRatio', 'none');
			svg.setAttribute('width', '100%');
			svg.setAttribute('height', String(h));
			const points = data.map((d, idx) => {
				const x = idx * w + w / 2;
				const y = h - 10 - (d[1] / max) * (h - 20);
				return `${x},${y}`;
			});
			if (chart.type === 'area') {
				const ns = 'http://www.w3.org/2000/svg';
				const poly = DOM.getActiveWindow().document.createElementNS(ns, 'polygon');
				const closed = `0,${h} ${points.join(' ')} ${w * data.length},${h}`;
				poly.setAttribute('points', closed);
				poly.setAttribute('fill', COLORS[0] + '33');
				svg.appendChild(poly);
			}
			const ns2 = 'http://www.w3.org/2000/svg';
			const line = DOM.getActiveWindow().document.createElementNS(ns2, 'polyline');
			line.setAttribute('points', points.join(' '));
			line.setAttribute('fill', 'none');
			line.setAttribute('stroke', COLORS[0]);
			line.setAttribute('stroke-width', '6');
			line.setAttribute('stroke-linecap', 'round');
			line.setAttribute('stroke-linejoin', 'round');
			svg.appendChild(line);
			// Point markers + value labels, overlaid as HTML on the (position:relative)
			// wrapper rather than SVG circles — the svg uses preserveAspectRatio="none"
			// so any <circle> would stretch into an ellipse. Markers make every point
			// visible, including the single-bucket case (e.g. all payments in one month)
			// where a one-point polyline draws no line and the chart looked empty.
			for (let idx = 0; idx < data.length; idx++) {
				const value = data[idx][1];
				const leftPct = ((idx + 0.5) / data.length) * 100;
				const topPx = h - 10 - (value / max) * (h - 20);
				const dot = DOM.append(wrap, DOM.$('div'));
				dot.style.cssText = `position:absolute;left:${leftPct}%;top:${topPx}px;width:8px;height:8px;border-radius:50%;background:${COLORS[0]};transform:translate(-50%,-50%);`;
				dot.title = `${data[idx][0]}: ${value}`;
				const valLabel = DOM.append(wrap, DOM.$('div'));
				valLabel.textContent = String(value);
				valLabel.style.cssText = `position:absolute;left:${leftPct}%;top:${topPx - 8}px;transform:translate(-50%,-100%);font-size:10px;font-weight:600;color:var(--vscode-foreground);white-space:nowrap;`;
			}
			// X-axis labels (first/middle/last)
			const labelRow = DOM.append(card, DOM.$('div'));
			labelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:9px;color:var(--vscode-descriptionForeground);margin-top:4px;';
			if (data.length > 0) {
				const first = DOM.append(labelRow, DOM.$('span'));
				first.textContent = data[0][0];
				if (data.length > 2) {
					const mid = DOM.append(labelRow, DOM.$('span'));
					mid.textContent = data[Math.floor(data.length / 2)][0];
				}
				if (data.length > 1) {
					const last = DOM.append(labelRow, DOM.$('span'));
					last.textContent = data[data.length - 1][0];
				}
			}
		} else {
			// pie or donut
			const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
			const row = DOM.append(card, DOM.$('div'));
			row.style.cssText = 'display:flex;gap:16px;align-items:center;';
			const pie = DOM.append(row, DOM.$('div'));
			let gradient = '';
			let angle = 0;
			for (let i = 0; i < sorted.length; i++) {
				const pct = (sorted[i][1] / total) * 360;
				gradient += `${COLORS[i % COLORS.length]} ${angle}deg ${angle + pct}deg, `;
				angle += pct;
			}
			const innerHole = chart.type === 'donut' ? 'mask:radial-gradient(circle 28px at center, transparent 99%, black 100%);-webkit-mask:radial-gradient(circle 28px at center, transparent 99%, black 100%);' : '';
			pie.style.cssText = `width:120px;height:120px;border-radius:50%;background:conic-gradient(${gradient.slice(0, -2)});flex-shrink:0;${innerHole}`;
			const legend = DOM.append(row, DOM.$('div'));
			legend.style.cssText = 'flex:1;min-width:0;';
			for (let i = 0; i < Math.min(sorted.length, 8); i++) {
				const item = DOM.append(legend, DOM.$('div'));
				item.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
				const dot = DOM.append(item, DOM.$('span'));
				dot.style.cssText = `width:8px;height:8px;border-radius:2px;background:${COLORS[i % COLORS.length]};flex-shrink:0;`;
				const text = DOM.append(item, DOM.$('span'));
				text.textContent = `${sorted[i][0]}: ${sorted[i][1]} (${Math.round(sorted[i][1] / total * 100)}%)`;
				text.style.cssText = 'font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			}
		}
	}

	private async _renderAiUsage(): Promise<void> {
		DOM.clearNode(this.contentEl);

		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'margin-bottom:16px;';
		const titleRow = DOM.append(header, DOM.$('div'));
		titleRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
		const dot = DOM.append(titleRow, DOM.$('span'));
		dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#3b82f6;flex-shrink:0;';
		const title = DOM.append(titleRow, DOM.$('h2'));
		title.textContent = 'AI Token Usage';
		title.style.cssText = 'font-size:20px;font-weight:600;margin:0;flex:1;';
		const subtitle = DOM.append(header, DOM.$('div'));
		subtitle.textContent = 'Monitor AI model usage, token costs, and performance';
		subtitle.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin:4px 0 0 20px;';

		// Filters: From / to / To + refresh icon
		const filters = DOM.append(this.contentEl, DOM.$('div'));
		filters.style.cssText = 'display:flex;gap:10px;margin-bottom:16px;align-items:center;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;background:rgba(0,122,204,0.03);';

		const today = new Date();
		const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
		const isoOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

		const fromInput = DOM.append(filters, DOM.$('input')) as HTMLInputElement;
		fromInput.type = 'date';
		fromInput.value = isoOf(monthAgo);
		fromInput.style.cssText = INPUT_STYLE + 'color-scheme:dark light;cursor:pointer;';
		// Open the calendar from a click anywhere in the field, not just the tiny indicator.
		enablePickerClick(fromInput);

		const toSep = DOM.append(filters, DOM.$('span'));
		toSep.textContent = 'to';
		toSep.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		const toInput = DOM.append(filters, DOM.$('input')) as HTMLInputElement;
		toInput.type = 'date';
		toInput.value = isoOf(today);
		toInput.style.cssText = INPUT_STYLE + 'color-scheme:dark light;cursor:pointer;';
		// Open the calendar from a click anywhere in the field, not just the tiny indicator.
		enablePickerClick(toInput);

		const spacer = DOM.append(filters, DOM.$('span'));
		spacer.style.flex = '1';
		const refreshBtn = DOM.append(filters, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.title = 'Refresh';
		// allow-any-unicode-next-line
		refreshBtn.textContent = '↻';
		refreshBtn.style.cssText = INPUT_STYLE + 'cursor:pointer;font-size:14px;width:30px;height:28px;display:flex;align-items:center;justify-content:center;';

		// KPIs row
		const kpiRow = DOM.append(this.contentEl, DOM.$('div'));
		kpiRow.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;';

		// Usage by Model card (with empty state)
		const modelCard = DOM.append(this.contentEl, DOM.$('div'));
		modelCard.style.cssText = 'padding:14px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;';

		// Daily trend chart card
		const trendCard = DOM.append(this.contentEl, DOM.$('div'));
		trendCard.style.cssText = 'padding:14px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;';
		const trendTitle = DOM.append(trendCard, DOM.$('h3'));
		trendTitle.textContent = 'Daily Usage Trend';
		trendTitle.style.cssText = 'font-size:13px;font-weight:600;margin:0 0 10px;';
		const trendChart = DOM.append(trendCard, DOM.$('div'));

		// Recent calls table card
		const callsCard = DOM.append(this.contentEl, DOM.$('div'));
		callsCard.style.cssText = 'padding:14px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';
		const callsTitle = DOM.append(callsCard, DOM.$('h3'));
		callsTitle.textContent = 'Recent AI Calls';
		callsTitle.style.cssText = 'font-size:13px;font-weight:600;margin:0 0 10px;';
		const callsTbl = DOM.append(callsCard, DOM.$('div'));

		const modelTbl = modelCard;

		let callsPage = 0;
		const callsPageSize = 20;

		const tryFetch = async (path: string): Promise<unknown> => {
			try {
				const r = await this.apiService.fetch(path);
				if (!r.ok) { return null; }
				return await r.json();
			} catch { return null; }
		};

		const loadAll = async (): Promise<void> => {
			const qs = (extra = ''): string => {
				const p: string[] = [];
				if (fromInput.value) { p.push(`from=${fromInput.value}`); }
				if (toInput.value) { p.push(`to=${toInput.value}`); }
				return p.length ? `${extra}${extra.includes('?') ? '&' : '?'}${p.join('&')}` : extra;
			};

			// Summary
			DOM.clearNode(kpiRow);
			const summary = await tryFetch(`/api/app-proxy/ask-ciya/api/ai/usage/summary${qs('')}`) as Record<string, number> | null;
			const summaryData = (summary as { data?: Record<string, number> } | null)?.data || summary || {};
			const kpiDefs = [
				{ label: 'Total Requests', value: String(summaryData['totalRequests'] ?? '0'), color: COLORS[0] },
				{ label: 'Total Tokens', value: String(summaryData['totalTokens'] ?? '0'), color: COLORS[2] },
				{ label: 'Estimated Cost', value: `$${Number(summaryData['totalCost'] ?? 0).toFixed(4)}`, color: COLORS[1] },
				{ label: 'Avg Latency', value: `${Math.round(Number(summaryData['avgLatency'] ?? 0))}ms`, color: COLORS[3] },
			];
			for (const k of kpiDefs) {
				const card = DOM.append(kpiRow, DOM.$('div'));
				card.style.cssText = `padding:14px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;border-left:3px solid ${k.color};`;
				const lbl = DOM.append(card, DOM.$('div'));
				lbl.textContent = k.label;
				lbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;';
				const v = DOM.append(card, DOM.$('div'));
				v.textContent = k.value;
				v.style.cssText = `font-size:22px;font-weight:700;line-height:1.3;color:${k.color};margin-top:4px;`;
			}

			// By Model
			DOM.clearNode(modelTbl);
			const modelTitle = DOM.append(modelTbl, DOM.$('h3'));
			modelTitle.textContent = 'Usage by Model';
			modelTitle.style.cssText = 'font-size:13px;font-weight:600;margin:0 0 10px;';
			const byModel = (summaryData['byModel'] as unknown as Array<Record<string, string | number>> | undefined) || [];
			if (byModel.length === 0) {
				const e = DOM.append(modelTbl, DOM.$('div'));
				e.style.cssText = 'padding:30px 0;text-align:center;color:var(--vscode-descriptionForeground);';
				const msg = DOM.append(e, DOM.$('div'));
				msg.textContent = 'No usage data for this period';
				msg.style.cssText = 'font-size:12px;';
			} else {
				this._renderSimpleTable(modelTbl, byModel, [
					{ key: 'model', label: 'Model' },
					{ key: 'vendor', label: 'Vendor' },
					{ key: 'requests', label: 'Requests' },
					{ key: 'promptTokens', label: 'Prompt Tokens' },
					{ key: 'completionTokens', label: 'Completion Tokens' },
					{ key: 'totalTokens', label: 'Total Tokens' },
					{ key: 'cost', label: 'Est. Cost' },
					{ key: 'avgLatency', label: 'Avg Latency' },
				]);
			}

			// Daily trend
			DOM.clearNode(trendChart);
			const daily = await tryFetch(`/api/app-proxy/ask-ciya/api/ai/usage/daily${qs('')}`) as { data?: Array<Record<string, number | string>> } | Array<Record<string, number | string>> | null;
			const dailyData = (daily as { data?: Array<Record<string, number | string>> })?.data || (Array.isArray(daily) ? daily : []) || [];
			if (dailyData.length === 0) {
				const e = DOM.append(trendChart, DOM.$('div'));
				e.textContent = 'No usage data for this period';
				e.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);text-align:center;padding:30px 0;';
			} else {
				const max = Math.max(...dailyData.map(d => Number(d['totalTokens'] ?? 0)), 1);
				trendChart.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:120px;';
				for (let i = 0; i < dailyData.length; i++) {
					const d = dailyData[i];
					const h = Math.max((Number(d['totalTokens'] ?? 0) / max) * 110, 3);
					const bar = DOM.append(trendChart, DOM.$('div'));
					bar.style.cssText = `flex:1;height:${h}px;background:${COLORS[0]};border-radius:2px 2px 0 0;min-width:0;`;
					bar.title = `${d['date']}: ${d['totalTokens']} tokens`;
				}
			}

			// Recent calls
			const loadCalls = async (): Promise<void> => {
				DOM.clearNode(callsTbl);
				const callsResp = await tryFetch(`/api/app-proxy/ask-ciya/api/ai/usage/log${qs('')}${qs('').includes('?') ? '&' : '?'}page=${callsPage}&size=${callsPageSize}`) as { data?: { content?: Array<Record<string, string | number>>; totalPages?: number }; content?: Array<Record<string, string | number>>; totalPages?: number } | null;
				const callsContent = callsResp?.data?.content || callsResp?.content || [];
				const totalPages = callsResp?.data?.totalPages || callsResp?.totalPages || 1;
				if (callsContent.length === 0) {
					const e = DOM.append(callsTbl, DOM.$('div'));
					e.textContent = 'No AI calls recorded yet';
					e.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);text-align:center;padding:30px 0;';
					return;
				}
				this._renderSimpleTable(callsTbl, callsContent, [
					{ key: 'createdAt', label: 'Time' },
					{ key: 'userName', label: 'User' },
					{ key: 'model', label: 'Model' },
					{ key: 'vendor', label: 'Vendor' },
					{ key: 'complexity', label: 'Complexity' },
					{ key: 'promptTokens', label: 'Prompt Tokens' },
					{ key: 'completionTokens', label: 'Completion Tokens' },
					{ key: 'totalTokens', label: 'Total' },
					{ key: 'cost', label: 'Cost' },
					{ key: 'latencyMs', label: 'Latency' },
					{ key: 'status', label: 'Status' },
				]);
				if (totalPages > 1) {
					const pag = DOM.append(callsTbl, DOM.$('div'));
					pag.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 4px;justify-content:flex-end;';
					const prev = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
					prev.textContent = '← Previous';
					prev.style.cssText = BTN_SECONDARY + (callsPage === 0 ? 'opacity:0.5;cursor:not-allowed;' : '');
					prev.disabled = callsPage === 0;
					prev.addEventListener('click', () => { if (callsPage > 0) { callsPage--; loadCalls(); } });
					const info = DOM.append(pag, DOM.$('span'));
					info.textContent = `Page ${callsPage + 1} of ${totalPages}`;
					info.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);padding:0 8px;';
					const next = DOM.append(pag, DOM.$('button')) as HTMLButtonElement;
					next.textContent = 'Next →';
					next.style.cssText = BTN_SECONDARY + (callsPage >= totalPages - 1 ? 'opacity:0.5;cursor:not-allowed;' : '');
					next.disabled = callsPage >= totalPages - 1;
					next.addEventListener('click', () => { if (callsPage < totalPages - 1) { callsPage++; loadCalls(); } });
				}
			};
			callsPage = 0;
			await loadCalls();
		};

		refreshBtn.addEventListener('click', loadAll);
		await loadAll();
	}

	private _renderSimpleTable(parent: HTMLElement, items: Array<Record<string, string | number>>, columns: ColumnDef[]): void {
		if (!items || items.length === 0) {
			const e = DOM.append(parent, DOM.$('div'));
			e.textContent = 'No data';
			e.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;padding:20px 0;';
			return;
		}
		const tbl = DOM.append(parent, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;';
		const gridCols = columns.map(() => '1fr').join(' ');
		const hdr = DOM.append(tbl, DOM.$('div'));
		hdr.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const c of columns) { DOM.append(hdr, DOM.$('span')).textContent = c.label; }
		for (const item of items) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:5px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);`;
			for (const c of columns) {
				const cell = DOM.append(r, DOM.$('span'));
				let val = String(item[c.key] ?? '');
				if ((c.key.endsWith('At') || c.key.endsWith('Date')) && val && !isNaN(Date.parse(val))) {
					try { val = new Date(val).toLocaleString('en-US'); } catch { /* */ }
				}
				cell.textContent = val;
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			}
		}
	}

	private _printReport(reportName: string): void {
		const cols = this.reportDef.columns;
		const items = this._filteredItems();
		const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] || c));
		let rows = '';
		for (const item of items) {
			rows += '<tr>' + cols.map(c => `<td>${esc(String(item[c.key] || ''))}</td>`).join('') + '</tr>';
		}

		// Resolve theme colours from live CSS variables so the preview matches the active theme.
		const activeWindow = DOM.getActiveWindow();
		const activeDoc = activeWindow.document;
		// VS Code scopes its theme CSS variables under `.monaco-workbench`, NOT on
		// documentElement/:root — reading from documentElement returned empty so
		// every var fell back to the dark defaults and the preview was always dark
		// regardless of theme (QA report). Resolve them from the workbench element.
		// eslint-disable-next-line no-restricted-syntax
		const themeHost = (activeDoc.getElementsByClassName('monaco-workbench')[0] as HTMLElement | undefined) || activeDoc.body;
		const cs = activeWindow.getComputedStyle(themeHost);
		const get = (v: string, fallback: string) => cs.getPropertyValue(v).trim() || fallback;
		const themeBg = get('--vscode-editor-background', '#1e1e1e');
		const themeFg = get('--vscode-editor-foreground', '#cccccc');
		const themeBorder = get('--vscode-editorWidget-border', '#454545');
		const themeSubtle = get('--vscode-descriptionForeground', '#999');
		const themeThBg = get('--vscode-editorGroupHeader-tabsBackground', themeBg);

		// Preview HTML uses theme colours; @media print overrides to black-on-white for paper.
		const previewHtml = `<!DOCTYPE html><html><head><title>${esc(reportName)}</title><style>
			body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;margin:20px;background:${themeBg};color:${themeFg};}
			h1{font-size:18px;margin:0 0 4px;}
			.meta{color:${themeSubtle};font-size:11px;margin-bottom:14px;}
			table{width:100%;border-collapse:collapse;}
			th,td{padding:6px 8px;text-align:left;border:1px solid ${themeBorder};}
			th{background:${themeThBg};font-weight:600;text-transform:uppercase;font-size:10px;}
			@media print{
				@page{size:landscape;margin:12mm;}
				body{background:#fff!important;color:#000!important;}
				th,td{border-color:#ddd!important;}
				th{background:#f5f5f5!important;}
				.meta{color:#666!important;}
			}
		</style></head><body>
			<h1>${esc(reportName)}</h1>
			<div class="meta">Generated ${new Date().toLocaleString()} • ${items.length} records</div>
			<table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
		</body></html>`;

		// Show a print preview modal that follows the active theme.
		const overlay = activeDoc.createElement('div');
		overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';

		const modal = activeDoc.createElement('div');
		modal.style.cssText = `background:${themeBg};color:${themeFg};border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.4);width:90vw;max-width:960px;height:85vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid ${themeBorder};`;

		// Modal header
		const mHeader = activeDoc.createElement('div');
		mHeader.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid ${themeBorder};flex-shrink:0;`;
		const mTitle = activeDoc.createElement('span');
		mTitle.textContent = `Print Preview — ${reportName}`;
		mTitle.style.cssText = 'font-weight:600;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
		const mMeta = activeDoc.createElement('span');
		mMeta.textContent = `${items.length} record${items.length !== 1 ? 's' : ''}`;
		mMeta.style.cssText = `font-size:12px;color:${themeSubtle};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;`;

		const btnGroup = activeDoc.createElement('div');
		btnGroup.style.cssText = 'display:flex;gap:8px;';

		const closeBtn = activeDoc.createElement('button');
		closeBtn.textContent = 'Close';
		closeBtn.style.cssText = `padding:6px 16px;border:1px solid ${themeBorder};border-radius:4px;background:${themeBg};color:${themeFg};cursor:pointer;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;`;

		const doPrintBtn = activeDoc.createElement('button');
		// allow-any-unicode-next-line
		doPrintBtn.textContent = '🖨 Print';
		doPrintBtn.style.cssText = `padding:6px 16px;border:none;border-radius:4px;background:${get('--vscode-button-background', '#0078d4')};color:${get('--vscode-button-foreground', '#fff')};cursor:pointer;font-size:13px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;`;

		const close = () => overlay.remove();
		closeBtn.addEventListener('click', close);
		overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); } });

		const trustedHtml = _printTtPolicy?.createHTML(previewHtml) ?? previewHtml;

		doPrintBtn.addEventListener('click', () => {
			const iframe = activeDoc.createElement('iframe');
			iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;border:none;';
			activeDoc.body.appendChild(iframe);
			const doc = iframe.contentDocument;
			if (!doc) { iframe.remove(); return; }
			doc.open(); doc.write(trustedHtml as string); doc.close();
			const iw = iframe.contentWindow;
			if (!iw) { iframe.remove(); return; }
			iw.focus();
			iw.print();
			setTimeout(() => iframe.remove(), 2000);
		});

		// Preview iframe — srcdoc requires TrustedHTML; blob:/data: src blocked by CSP frame-src.
		const preview = activeDoc.createElement('iframe');
		preview.style.cssText = `flex:1;border:none;background:${themeBg};`;
		preview.srcdoc = trustedHtml as unknown as string;

		btnGroup.append(closeBtn, doPrintBtn);
		mHeader.append(mTitle, mMeta, btnGroup);
		modal.append(mHeader, preview);
		overlay.appendChild(modal);
		activeDoc.body.appendChild(overlay);
	}

	private _exportCsv(reportName: string): void {
		const cols = this.reportDef.columns;
		const items = this._filteredItems();
		let csv = '\uFEFF' + cols.map(c => c.label).join(',') + '\n';
		for (const item of items) {
			csv += cols.map(c => `"${String(item[c.key] || '').replace(/"/g, '""')}"`).join(',') + '\n';
		}
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${reportName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
