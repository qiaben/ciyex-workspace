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
const BTN_PRIMARY = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
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
	 * When true, after the main fetch we enrich each patient row with its insurance/payer name
	 * by loading coverage data (the `/api/patients` endpoint does not include insurance). This
	 * mirrors ciyex-ehr-ui's patient-demographics report which joins coverage data.
	 */
	enrichInsurance?: boolean;
}

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
				columns: [
					{ key: 'name', label: 'Name' },
					{ key: 'gender', label: 'Gender' },
					{ key: 'birthDate', label: 'Date of Birth' },
					{ key: 'ageGroup', label: 'Age Group' },
					{ key: 'active', label: 'Status' },
					{ key: 'insurance', label: 'Insurance' },
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
				apiPath: '/api/payments/transactions?page=0&size=1000',
				// Columns match ciyex-ehr-ui: Date, Patient, Provider, Payer, Charges, Payments, Adjustments, Balance
				columns: [
					{ key: 'collectedAt', label: 'Date' },
					{ key: 'patientName', label: 'Patient' },
					{ key: 'providerName', label: 'Provider' },
					{ key: 'payerDisplay', label: 'Payer' },
					{ key: 'amount', label: 'Charges' },
					{ key: 'paidAmount', label: 'Payments' },
					{ key: 'adjustmentAmount', label: 'Adjustments' },
					{ key: 'balanceAmount', label: 'Balance' },
				],
				filters: [DATE_FROM, DATE_TO, PROVIDER_FILTER, PAYER_FILTER, PATIENT_FILTER],
				kpis: [
					{ label: 'Gross Charges', calc: items => fmtMoney(items.reduce((s, i) => s + Number(i.totalAmount || i.amount || 0), 0)), color: COLORS[0] },
					{ label: 'Net Collections', calc: items => fmtMoney(items.reduce((s, i) => s + Number(i.paidAmount || 0), 0)), color: COLORS[1] },
					{
						label: 'Collection Rate', calc: items => {
							const charges = items.reduce((s, i) => s + Number(i.totalAmount || i.amount || 0), 0);
							const paid = items.reduce((s, i) => s + Number(i.paidAmount || 0), 0);
							return charges ? fmtPct(100 * paid / charges) : '0%';
						}, color: COLORS[2]
					},
					{
						label: 'Avg / Visit', calc: items => {
							const visits = new Set(items.map(i => i.encounterId || i.id).filter(Boolean)).size || items.length;
							const charges = items.reduce((s, i) => s + Number(i.totalAmount || i.amount || 0), 0);
							return visits ? fmtMoney(charges / visits) : '$0';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: 'providerName', label: 'Revenue by Provider' },
					{ type: 'pie', groupKey: 'patientName', label: 'By Patient' },
					{ type: 'area', groupKey: '', label: 'Monthly Revenue', aggregate: 'month', dateField: 'serviceDate' },
				],
			};

		case 'ar-aging':
		case 'accounts-receivable':
			return {
				apiPath: '/api/payments/transactions?page=0&size=1000',
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
				apiPath: '/api/encounters/report/encounterAll?page=0&size=1000',
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
			return {
				apiPath: '/api/patients?page=0&size=500',
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
					{
						type: 'select', key: 'gapType', label: 'Gap Type', options: [
							{ value: '', label: 'All Gap Type' },
							{ value: 'screenings', label: 'Screenings' },
							{ value: 'immunizations', label: 'Immunizations' },
							{ value: 'follow-ups', label: 'Follow-ups' },
						]
					},
					{ type: 'select', key: 'description', label: 'Description', searchable: true, dynamic: true },
				],
				kpis: [
					{ label: 'Total Open Gaps', calc: items => String(items.length), color: COLORS[0] },
					{
						label: 'Closed This Month', calc: items => {
							const now = new Date(); const mStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
							return String(countWhere(items, i => /closed/i.test(i.status || '') && new Date(i.closedAt || 0).getTime() >= mStart));
						}, color: COLORS[1]
					},
					{
						label: 'Closure Rate', calc: items => {
							const c = countWhere(items, i => /closed/i.test(i.status || ''));
							return items.length ? fmtPct(100 * c / items.length) : '0%';
						}, color: COLORS[2]
					},
					{ label: 'Revenue Opportunity', calc: items => fmtMoney(items.length * 200), color: COLORS[3] },
				],
				charts: [
					{ type: 'bar', groupKey: 'gapType', label: 'Gaps by Type' },
					{ type: 'area', groupKey: '', label: 'Gap Closure Trend', aggregate: 'month', dateField: 'closedAt' },
					{ type: 'horizontalBar', groupKey: 'providerName', label: 'Open Gaps by Provider', limit: 10 },
					{ type: 'pie', groupKey: 'gapType', label: 'By Gap Type' },
				],
			};

		case 'audit-log':
			return {
				apiPath: '/api/audit-log?page=0&size=500',
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
			return {
				apiPath: '/api/patients?page=0&size=500',
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
					{ label: 'Rising Risk', calc: items => String(countWhere(items, i => /rising/i.test(i.riskTrend || ''))), color: COLORS[2] },
					{
						label: 'Avg Risk Score', calc: items => {
							const scores = items.map(i => Number(i.riskScore || 0)).filter(n => n > 0);
							return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '0';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'pie', groupKey: 'riskTier', label: 'Risk Tier Distribution' },
					{ type: 'horizontalBar', groupKey: 'topRiskFactor', label: 'Top Risk Factors', limit: 10 },
					{ type: 'bar', groupKey: '', label: 'Risk Migration Trend', aggregate: 'month', dateField: 'recordedDate' },
				],
			};

		// allow-any-unicode-next-line
		// ─── ADMINISTRATIVE ───
		case 'portal-usage':
			return {
				apiPath: '/api/patients?page=0&size=1000',
				columns: [
					{ key: 'feature', label: 'Feature' },
					{ key: 'totalUsage', label: 'Total Usage' },
					{ key: 'uniqueUsers', label: 'Unique Users' },
					{ key: 'avgPerUser', label: 'Avg/User' },
					{ key: 'trend30d', label: '30d Trend (%)' },
				],
				filters: [
					DATE_FROM, DATE_TO,
					{
						type: 'select', key: 'feature', label: 'Feature', options: [
							{ value: '', label: 'All Feature' },
							{ value: 'view-chart', label: 'View Chart' },
							{ value: 'schedule-appointment', label: 'Schedule Appointment' },
							{ value: 'refill-prescription', label: 'Refill Prescription' },
							{ value: 'bill-payment', label: 'Bill Payment' },
							{ value: 'download-records', label: 'Download Records' },
							{ value: 'message', label: 'Message' },
						]
					},
				],
				kpis: [
					{
						label: 'Enrolled %', calc: items => {
							const enrolled = countWhere(items, i => i.portalEnrolled === 'true' || /enrolled/i.test(i.portalStatus || ''));
							return items.length ? fmtPct(100 * enrolled / items.length) : '0%';
						}, color: COLORS[0]
					},
					{ label: 'Active Users (30d)', calc: items => String(countWhere(items, i => !!i.lastPortalLogin)), color: COLORS[1] },
					{ label: 'Messages Sent', calc: items => String(items.reduce((s, i) => s + Number(i.messageCount || 0), 0)), color: COLORS[2] },
					{ label: 'Online Bookings', calc: items => String(items.reduce((s, i) => s + Number(i.onlineBookings || 0), 0)), color: COLORS[3] },
				],
				charts: [
					{ type: 'bar', groupKey: 'feature', label: 'Feature Usage' },
					{ type: 'line', groupKey: '', label: 'Enrollment Trend', aggregate: 'month', dateField: 'createdAt' },
					{ type: 'pie', groupKey: 'ageGroup', label: 'Active Users by Age' },
				],
			};

		case 'document-completion':
			return {
				apiPath: '/api/encounters/report/encounterAll?page=0&size=1000',
				columns: [
					{ key: 'providerDisplay', label: 'Provider' },
					{ key: 'unsigned', label: 'Unsigned' },
					{ key: 'avgAgeDays', label: 'Avg Age (days)' },
					{ key: 'oldestDays', label: 'Oldest (days)' },
					{ key: 'signedToday', label: 'Signed Today' },
				],
				filters: DEFAULT_FILTERS,
				kpis: [
					{ label: 'Unsigned Notes', calc: items => String(countWhere(items, i => /unsigned|in[-_ ]?progress|draft/i.test(i.status || ''))), color: COLORS[0] },
					{ label: 'Incomplete Encounters', calc: items => String(countWhere(items, i => !/complet|signed|finished/i.test(i.status || ''))), color: COLORS[1] },
					{
						label: 'Avg Sign Time (hrs)', calc: items => {
							const times = items.map(i => Number(i.signTimeHours || 0)).filter(n => n > 0);
							return times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : '0';
						}, color: COLORS[2]
					},
					{
						label: 'On-Time Rate', calc: items => {
							const onTime = countWhere(items, i => Number(i.signTimeHours || 0) <= 24);
							return items.length ? fmtPct(100 * onTime / items.length) : '0%';
						}, color: COLORS[3]
					},
				],
				charts: [
					{ type: 'bar', groupKey: 'providerDisplay', label: 'Unsigned by Provider' },
					{ type: 'bar', groupKey: 'unsignedAgeBucket', label: 'Unsigned Note Aging' },
					{ type: 'line', groupKey: '', label: 'Completion Rate Trend', aggregate: 'month', dateField: 'startDate' },
				],
			};

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

		await this._loadData();
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
			const usToIso = (us: string): string => { const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us); if (!m) { return ''; } return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
			const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			visible.type = 'text';
			visible.placeholder = 'MM/DD/YYYY';
			visible.maxLength = 10;
			visible.value = isoToUs(this.filterValues[key] || '');
			visible.style.cssText = INPUT_STYLE + 'padding-right:30px;width:130px;';
			visible.addEventListener('input', () => {
				const iso = usToIso(visible.value);
				visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
				this.filterValues[key] = iso;
				this.currentPage = 0;
				this._render();
			});
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.value = this.filterValues[key] || '';
			picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			picker.addEventListener('change', () => {
				visible.value = isoToUs(picker.value);
				this.filterValues[key] = picker.value;
				this.currentPage = 0;
				this._render();
			});
			const icon = DOM.append(wrap, DOM.$('span'));
			icon.textContent = '\u{1F4C5}';
			icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--vscode-descriptionForeground);pointer-events:none;line-height:1;';
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

		const spacer = DOM.append(this.filtersEl, DOM.$('span'));
		spacer.style.flex = '1';

		// Single "Generate" button matching ciyex-ehr-ui: it re-fetches data with the
		// current filters and re-renders. There is no separate "Clear Filters" / "Refresh".
		const generateBtn = DOM.append(this.filtersEl, DOM.$('button')) as HTMLButtonElement;
		generateBtn.textContent = 'Generate';
		generateBtn.style.cssText = BTN_PRIMARY + 'font-weight:600;padding:6px 18px;';
		generateBtn.addEventListener('click', async () => {
			generateBtn.disabled = true;
			generateBtn.textContent = 'Loading...';
			generateBtn.style.opacity = '0.6';
			try {
				await this._loadData();
				this._buildFilters();
				this._populateProviderFilter();
				this._render();
			} finally {
				generateBtn.disabled = false;
				generateBtn.textContent = 'Generate';
				generateBtn.style.opacity = '';
			}
		});
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
			if (this.reportDef.enrichInsurance) { await this._enrichInsurance(); }
		} catch { this.items = []; }
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
			const pFirst = pickFirst(out['patientFirstName'], out['patient.firstName']);
			const pLast = pickFirst(out['patientLastName'], out['patient.lastName']);
			out['patientName'] = `${pFirst} ${pLast}`.trim() || pickFirst(out['patientDisplay'], out['patientRefDisplay'], out['subjectDisplay'], out['patient.name'], out['patient']);
		}
		if (!out['patientDisplay']) { out['patientDisplay'] = pickFirst(out['patientName'], out['patientRefDisplay'], out['subjectDisplay']); }
		if (!out['patientRefDisplay']) { out['patientRefDisplay'] = pickFirst(out['patientDisplay'], out['patientName'], out['subjectDisplay']); }

		if (!out['providerName']) { out['providerName'] = pickFirst(out['encounterProvider'], out['providerDisplay'], out['practitionerName'], out['orderingProvider'], out['prescriberName'], out['referringProvider'], out['provider']); }
		if (!out['providerDisplay']) { out['providerDisplay'] = pickFirst(out['encounterProvider'], out['providerName'], out['practitionerName'], out['prescriberName']); }
		if (!out['prescriberName']) { out['prescriberName'] = pickFirst(out['providerName'], out['providerDisplay']); }
		if (!out['orderingProvider']) { out['orderingProvider'] = pickFirst(out['providerName'], out['providerDisplay']); }

		if (!out['payerDisplay']) { out['payerDisplay'] = pickFirst(out['insurerName'], out['insuranceName'], out['organizationDisplay'], out['payerName'], out['payor.display'], out['insurance'], out['primaryInsurance'], out['insuranceProvider'], out['payer']); }
		if (!out['insurance']) { out['insurance'] = pickFirst(out['payerDisplay'], out['insurerName'], out['insuranceName'], out['primaryInsurance'], out['insuranceProvider']); }
		if (!out['payerName']) { out['payerName'] = pickFirst(out['payerDisplay'], out['insurerName'], out['insuranceName']); }

		if (!out['specialistName']) { out['specialistName'] = pickFirst(out['specialist'], out['providerName'], out['referredTo']); }
		if (!out['specialty']) { out['specialty'] = pickFirst(out['specialtyDisplay'], out['practiceArea']); }

		if (!out['user']) { out['user'] = pickFirst(out['userName'], out['userId']); }
		if (!out['userName']) { out['userName'] = pickFirst(out['user'], out['userId']); }

		if (!out['code']) { out['code'] = pickFirst(out['display'], out['text'], out['diagnosisCode'], out['icdCode'], out['conditionCode']); }
		if (!out['icdCode']) { out['icdCode'] = pickFirst(out['diagnosisCode'], out['code'], out['conditionCode']); }
		if (!out['description']) { out['description'] = pickFirst(out['display'], out['text'], out['shortDescription'], out['conditionName'], out['diagnosisDescription']); }
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
		if (!out['type']) { out['type'] = pickFirst(out['typeDisplay'], out['encounterType'], out['visitCategory'], out['serviceType'], out['appointmentType']); }
		if (!out['appointmentType']) { out['appointmentType'] = pickFirst(out['type'], out['serviceType'], out['encounterType']); }
		if (!out['clinicalStatus']) { out['clinicalStatus'] = pickFirst(out['conditionStatus'], out['status']); }

		if (!out['totalAmount']) { out['totalAmount'] = pickFirst(out['amount'], out['totalGross'], out['totalNet'], out['total'], out['charges']); }

		if (!out['createdAt']) { out['createdAt'] = pickFirst(out['audit.createdDate'], out['createdDate'], out['registrationDate'], out['_lastUpdated'], out['timestamp']); }
		if (!out['startDate']) { out['startDate'] = pickFirst(out['start'], out['period.start'], out['effectiveDate']); }
		if (!out['serviceDate']) { out['serviceDate'] = pickFirst(out['serviced'], out['servicedDate'], out['period.start'], out['date']); }
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
			const dir = this.sortDir === 'asc' ? 1 : -1;
			result = [...result].sort((a, b) => {
				const av = a[this.sortKey] || '';
				const bv = b[this.sortKey] || '';
				const an = Number(av); const bn = Number(bv);
				if (!isNaN(an) && !isNaN(bn) && av && bv) { return (an - bn) * dir; }
				return av.localeCompare(bv) * dir;
			});
		}

		return result;
	}

	private _render(): void {
		const filtered = this._filteredItems();

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
		tableTitle.textContent = `Detail Data (${filtered.length} records)`;
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
		const pageItems = filtered.slice(start, end);
		if (pageItems.length === 0) {
			const empty = DOM.append(tbl, DOM.$('div'));
			empty.style.cssText = 'padding:30px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No records match the current filters';
		}
		for (const item of pageItems) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:5px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });
			for (const c of cols) {
				const cell = DOM.append(r, DOM.$('span'));
				let val = String(item[c.key] || '');
				if ((c.key.endsWith('Date') || c.key === 'createdAt' || c.key === 'recordedDate') && val && !isNaN(Date.parse(val))) {
					try { val = new Date(val).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); } catch { /* ignore */ }
				}
				cell.textContent = val;
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			}
		}

		// Pagination
		const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
		if (filtered.length > 0) {
			const pag = DOM.append(this.tableEl, DOM.$('div'));
			pag.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 4px;justify-content:space-between;';
			const info = DOM.append(pag, DOM.$('span'));
			info.textContent = `Showing ${Math.min(start + 1, filtered.length)}-${Math.min(end, filtered.length)} of ${filtered.length} records`;
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
				const raw = (df && i[df]) || i.startDate || i.serviceDate || i.referralDate || i.administrationDate
					|| i.orderDate || i.appointmentDate || i.recordedDate || i.createdAt || '';
				if (!raw) { continue; }
				const m = /^(\d{4})-(\d{2})/.exec(raw);
				if (!m) { continue; }
				const key = `${m[1]}-${m[2]}`;
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
				valEl.style.cssText = 'font-size:10px;font-weight:600;';
				const lblEl = DOM.append(col, DOM.$('div'));
				// allow-any-unicode-next-line
				lblEl.textContent = label.length > 12 ? label.substring(0, 12) + '…' : label;
				lblEl.style.cssText = 'font-size:8px;color:var(--vscode-descriptionForeground);text-align:center;max-width:100%;overflow:hidden;';
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
		fromInput.style.cssText = INPUT_STYLE + 'color-scheme:dark light;';

		const toSep = DOM.append(filters, DOM.$('span'));
		toSep.textContent = 'to';
		toSep.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		const toInput = DOM.append(filters, DOM.$('input')) as HTMLInputElement;
		toInput.type = 'date';
		toInput.value = isoOf(today);
		toInput.style.cssText = INPUT_STYLE + 'color-scheme:dark light;';

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
				if ((c.key === 'createdAt' || c.key.endsWith('Date')) && val && !isNaN(Date.parse(val))) {
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
