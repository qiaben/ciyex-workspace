/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { ICiyexInstallationsService } from '../ciyexInstallationsService.js';
import { RCM_APP_SLUG } from '../rcm/rcmApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { PatientChartEditorInput, EncounterFormEditorInput } from './ciyexEditorInput.js';
import { showVisitSummaryPanel } from './visitSummaryPanel.js';
import { URI } from '../../../../../base/common/uri.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { createCustomDropdown, createDateTimeDropdown } from '../customDropdown.js';
import { enablePickerClick, maskUsDate, usToIsoDate } from '../ciyexDateMask.js';
import { PaginationControl } from '../paginationControl.js';
import { parseSavedRecord, formatUsPhone } from '../sidebarActions.js';

// --- Types ---
interface ChartCategory { key: string; label: string; position: number; hideFromChart?: boolean; tabs: ChartTab[] }
interface ChartTab { key: string; label: string; icon: string; emoji?: string; color?: string; position: number; visible: boolean; display?: 'form' | 'list' | 'custom'; panel?: 'main' | 'bottom' | 'right'; fhirResources: string[]; apiPath?: string; columns?: Array<{ key: string; label: string; aliases?: string[] }>; readOnly?: boolean }
export interface FieldSection { key: string; title: string; columns: number; visible: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[] }
// `localOnly: true` means the field is appended even when the backend
// tab_field_config doesn't ship it — used for UX extras like priority,
// duration, BMI, URL link, attachment, "Send Via" channel. Default-off so
// keyless-collision duplicates don't sneak back in.
export interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; options?: Array<{ label: string; value: string } | string>; fhirMapping?: Record<string, string>; validation?: Record<string, unknown>; lookupConfig?: { system?: string; endpoint?: string; searchable?: boolean;[k: string]: string | boolean | undefined }; showWhen?: { field: string; equals?: string; notEquals?: string }; validationPattern?: string; validationMessage?: string; minDate?: 'today' | 'year-start' | string; defaultValue?: string | number | (() => string | number); showInTable?: boolean; localOnly?: boolean; apiPath?: string; relatedDisplayFields?: string[]; relatedField?: string; aliases?: string[]; readonly?: boolean; mergeOptions?: boolean; storeLabelAsValue?: boolean }
export interface FieldConfig { tabKey: string; sections: FieldSection[] }
interface QuickInfo { allergies: string; problems: string; history: string; vitals: string }

const FHIR_MAP: Record<string, string> = {
	'Patient': '/api/fhir-resource/demographics', 'Encounter': '/api/fhir-resource/encounters',
	'Condition': '/api/fhir-resource/conditions', 'AllergyIntolerance': '/api/fhir-resource/allergy-intolerances',
	'MedicationRequest': '/api/fhir-resource/medication-requests', 'Observation': '/api/fhir-resource/observations',
	'DiagnosticReport': '/api/fhir-resource/diagnostic-reports', 'Immunization': '/api/fhir-resource/immunizations',
	'Procedure': '/api/fhir-resource/procedures', 'DocumentReference': '/api/fhir-resource/document-references',
	'Appointment': '/api/fhir-resource/appointments', 'Coverage': '/api/fhir-resource/insurance-coverage',
	'ServiceRequest': '/api/fhir-resource/service-requests', 'CarePlan': '/api/fhir-resource/care-plans',
	'Consent': '/api/fhir-resource/consents', 'FamilyMemberHistory': '/api/fhir-resource/family-member-histories',
	'Claim': '/api/fhir-resource/claims', 'PaymentReconciliation': '/api/fhir-resource/payment-reconciliations',
	'RelatedPerson': '/api/fhir-resource/related-persons', 'Organization': '/api/fhir-resource/organizations',
	'Communication': '/api/fhir-resource/messaging', 'Invoice': '/api/fhir-resource/payments',
	'PaymentNotice': '/api/fhir-resource/statements',
};

// Default chart layout per the 05.05.26 workspace test report:
// Overview (Dashboard, Demographics, Forms, Vitals, Allergies, Problems),
// General, Clinical (..., History), Encounters (..., Referrals), Claims,
// Financial, Others. Only the Portal section stays hidden — the test report
// explicitly enumerated all the others as required dropdowns.
const DEFAULT_CATEGORIES: ChartCategory[] = [
	{
		key: 'overview', label: 'Overview', position: 0, tabs: [
			{ key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', emoji: '\u{1F4CA}', position: 0, visible: true, display: 'custom', panel: 'main', fhirResources: [] },
			{ key: 'demographics', label: 'Demographics', icon: 'User', emoji: '\u{1F464}', position: 1, visible: true, display: 'form', panel: 'main', fhirResources: ['Patient'] },
			{ key: 'forms', label: 'Forms', icon: 'FileText', emoji: '\u{1F4DD}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'] },
			{
				key: 'vitals', label: 'Vitals', icon: 'Activity', emoji: '\u{2764}\u{FE0F}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/fhir-resource/vitals',
				columns: [
					{ key: 'recordedAt', label: 'Recorded', aliases: ['recordedAt', 'effectiveDateTime', 'recordedDate', 'dateRecorded'] },
					{ key: 'bpSystolic', label: 'BP Sys', aliases: ['bpSystolic', 'systolicBP', 'systolic'] },
					{ key: 'bpDiastolic', label: 'BP Dia', aliases: ['bpDiastolic', 'diastolicBP', 'diastolic'] },
					{ key: 'pulse', label: 'Pulse', aliases: ['pulse', 'heartRate', 'hr'] },
					{ key: 'respiration', label: 'Resp', aliases: ['respiration', 'respiratoryRate', 'rr'] },
					// allow-any-unicode-next-line
					{ key: 'temperatureC', label: 'Temp (°C)', aliases: ['temperatureC', 'temperature', 'temp'] },
					{ key: 'oxygenSaturation', label: 'SpO2', aliases: ['oxygenSaturation', 'spo2', 'o2sat'] },
					{ key: 'weightKg', label: 'Wt (kg)', aliases: ['weightKg', 'weight'] },
					{ key: 'heightCm', label: 'Ht (cm)', aliases: ['heightCm', 'height'] },
					{ key: 'bmi', label: 'BMI' },
				],
			},
			{
				key: 'allergies', label: 'Allergies', icon: 'AlertTriangle', emoji: '\u{1F6A8}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['AllergyIntolerance'],
				columns: [
					{ key: 'allergyName', label: 'Allergen', aliases: ['allergyName', 'name', 'code'] },
					{ key: 'reaction', label: 'Reaction', aliases: ['reaction', 'manifestation'] },
					{ key: 'severity', label: 'Severity' },
					{ key: 'status', label: 'Status', aliases: ['status', 'clinicalStatus'] },
					// Onset/Start Date must resolve ONLY from true onset fields. `recordedDate`
					// is the FHIR resource-creation timestamp (auto-stamped ~now by HAPI), so
					// including it made a blank onset render as the current date/time. Dropped
					// it so an unspecified onset shows empty instead of "today".
					{ key: 'startDate', label: 'Start Date', aliases: ['startDate', 'onsetDate', 'onsetDateTime'] },
				],
			},
			{
				key: 'problems', label: 'Problems', icon: 'AlertCircle', emoji: '\u{26A0}\u{FE0F}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: ['Condition'],
				columns: [
					{ key: 'conditionName', label: 'Condition', aliases: ['conditionName', 'condition', 'name', 'code', 'display'] },
					{ key: 'icdCode', label: 'ICD-10 Code', aliases: ['icdCode', 'icd10Code', 'code'] },
					{ key: 'severity', label: 'Severity' },
					{ key: 'clinicalStatus', label: 'Status', aliases: ['clinicalStatus', 'status'] },
					{ key: 'onsetDate', label: 'Onset Date', aliases: ['onsetDate', 'onsetDateTime', 'recordedDate'] },
					{ key: 'resolvedDate', label: 'Resolved Date', aliases: ['resolvedDate', 'abatementDate', 'abatementDateTime'] },
				],
			},
		],
	},
	// Portal section hidden — not in the 02.05.26 test spec's expected sections.
	{
		key: 'portal', label: 'Portal', position: 1, hideFromChart: true, tabs: [
			{ key: 'portal-demographics', label: 'Demographics', icon: 'User', emoji: '\u{1F464}', position: 0, visible: false, display: 'list', panel: 'main', fhirResources: [] },
		],
	},
	{
		key: 'general', label: 'General', position: 2, tabs: [
			{
				key: 'insurance', label: 'Insurance', icon: 'Shield', emoji: '\u{1F6E1}\u{FE0F}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Coverage', 'Organization'],
				// Columns mirror web app insurance list (payer, plan, member, group,
				// tier, plan type, effective date, end date, status).
				columns: [
					{ key: 'insuranceType', label: 'Tier', aliases: ['insuranceType', 'tier', 'coverageType', 'level'] },
					{ key: 'payerName', label: 'Payer', aliases: ['payerName', 'insurerName', 'organizationDisplay', 'payor.display', 'name'] },
					{ key: 'planName', label: 'Plan', aliases: ['planName', 'plan', 'productName'] },
					{ key: 'policyType', label: 'Plan Type', aliases: ['policyType', 'planType'] },
					{ key: 'policyNumber', label: 'Member ID', aliases: ['policyNumber', 'memberId', 'subscriberId', 'identifier'] },
					{ key: 'groupNumber', label: 'Group #', aliases: ['groupNumber', 'group'] },
					{ key: 'subscriberRelationship', label: 'Relationship', aliases: ['subscriberRelationship', 'relationship'] },
					{ key: 'policyEffectiveDate', label: 'Effective', aliases: ['policyEffectiveDate', 'periodStart', 'period.start', 'effectiveDate'] },
					{ key: 'policyEndDate', label: 'End', aliases: ['policyEndDate', 'periodEnd', 'period.end'] },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'documents', label: 'Documents', icon: 'FileText', emoji: '\u{1F4C4}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'],
				columns: [
					{ key: 'description', label: 'Document Name', aliases: ['description', 'title', 'name'] },
					{ key: 'type', label: 'Type', aliases: ['type', 'documentType', 'category'] },
					{ key: 'date', label: 'Date', aliases: ['date', 'documentDate', 'created', 'createdAt'] },
					{ key: 'authorName', label: 'Author', aliases: ['authorName', 'author', 'providerName'] },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'education', label: 'Education', icon: 'BookOpen', emoji: '\u{1F4D6}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/education/assignments',
				// Match the reference EHR UI: only Status / Topic / Category / Date
				// Provided columns (plus the auto-appended Actions column).
				// NB: the list columns are auto-derived from the form fields
				// (first 6 non-textarea fields when none set showInTable), so these
				// entries primarily supply value-resolution aliases — the Delivery
				// Method / Educator columns are populated from the matching keys the
				// backend now persists (educator resolves to its display name).
				columns: [
					{ key: 'status', label: 'Status' },
					{ key: 'materialTitle', label: 'Topic / Title', aliases: ['materialTitle', 'topic', 'title', 'materialName'] },
					{ key: 'category', label: 'Category', aliases: ['category', 'materialCategory'] },
					{ key: 'deliveryMethod', label: 'Delivery Method', aliases: ['deliveryMethod', 'method', 'deliveryMethodDisplay'] },
					{ key: 'educator', label: 'Educator', aliases: ['educatorName', 'educator', 'educatorDisplay', 'providerName', 'educatorId'] },
					{ key: 'dateProvided', label: 'Date Provided', aliases: ['dateProvided', 'assignedDate', 'dateAssigned', 'createdAt'] },
				],
			},
			// Messaging uses the FHIR Communication resource via the generic FHIR controller
			// — same backend `tab_field_config` + scope enforcement as the rest of the chart,
			// and no separate patient-messages controller required.
			{
				key: 'messaging', label: 'Messaging', icon: 'MessageSquare', emoji: '\u{1F4AC}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['Communication'],
				// Explicit columns so both sent AND received messages render the
				// same way. Aliases cover the FHIR field keys (sender/recipient/
				// sent) and any display-name variants the backend resolves.
				columns: [
					{ key: 'sender', label: 'From (Provider)', aliases: ['senderName', 'sender', 'from', 'fromName', 'providerName'] },
					{ key: 'recipient', label: 'To (Patient)', aliases: ['recipientName', 'recipient', 'to', 'toName', 'patientName'] },
					{ key: 'subject', label: 'Subject', aliases: ['subject', 'topic', 'title'] },
					{ key: 'sent', label: 'Sent Date', aliases: ['sent', 'sentDate', 'sentAt', 'date', 'createdAt'] },
					{ key: 'status', label: 'Status' },
				],
			},
			{ key: 'relationships', label: 'Relationships', icon: 'Users', emoji: '\u{1F46A}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['RelatedPerson'] },
			// Facility now routes through the FHIR Location resource so CRUD
			// (PUT / DELETE) works. The legacy /api/locations endpoint is
			// read-only — that's why the test team's "delete, update option is
			// not working" was 405-ing every time. Backend tab_field_config
			// `facility` (V107) drives the form and column shape.
			// Facility is hidden from the patient chart — it is an org-level
			// resource, not patient-scoped, so it doesn't belong in the chart nav.
			{ key: 'facility', label: 'Facility', icon: 'Building', emoji: '\u{1F3E2}', position: 5, visible: false, display: 'list', panel: 'main', fhirResources: ['Location'] },
		],
	},
	{
		key: 'clinical', label: 'Clinical', position: 3, tabs: [
			// Clinical Alerts now routes through the FHIR Flag resource (V144
			// tab_field_config — fields: alertName, status, category, severity,
			// identifiedDate, endDate, author, notes). The legacy
			// `apiPath: '/api/cds/alerts'` pointed at the rule-execution log
			// (CdsAlertLogDto: ruleId / alertType / message / actedBy ...) which
			// has no overlap with the patient-chart alert fields, so saves
			// silently dropped every value the form collected. Save URL is now
			// /api/fhir-resource/clinical-alerts/patient/{id} — Flag resource
			// supports POST + PUT + DELETE for the test team's update/delete ask.
			{
				key: 'clinical-alerts', label: 'Clinical Alerts', icon: 'Bell', emoji: '\u{1F514}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Flag'],
				columns: [
					{ key: 'alertName', label: 'Alert', aliases: ['alertName', 'alert', 'name', 'title', 'code'] },
					{ key: 'status', label: 'Status' },
					{ key: 'category', label: 'Category' },
					{ key: 'severity', label: 'Severity' },
					{ key: 'identifiedDate', label: 'Identified Date', aliases: ['identifiedDate', 'date', 'period.start'] },
					{ key: 'author', label: 'Author', aliases: ['author', 'authorDisplay', 'authorName'] },
				],
			},
			{
				key: 'medications', label: 'Medications', icon: 'Pill', emoji: '\u{1F48A}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['MedicationRequest'],
				columns: [
					{ key: 'medicationName', label: 'Medication Name' },
					{ key: 'dosage', label: 'Dosage' },
					{ key: 'frequency', label: 'Frequency' },
					// The FHIR MedicationRequest read-back returns the issued date under
					// authoredOn/effectiveDateTime rather than `startDate`, so the column
					// was blank even after Date Issued was saved (QA). Resolve via alias
					// chain so whichever date key the record carries is displayed.
					{ key: 'startDate', label: 'Date Issued', aliases: ['startDate', 'authoredOn', 'effectiveDateTime', 'dateWritten', 'dateIssued', 'recordedDate'] },
					{ key: 'prescriberName', label: 'Prescriber', aliases: ['prescriberDisplay', 'prescribingDoctorDisplay', 'prescriberName', 'prescriber', 'prescribingDoctor', 'requester', 'orderedBy'] },
					{ key: 'status', label: 'Status' },
				],
			},
			// Lab Orders + Lab Results read & write the CLINICAL stores
			// (/api/lab-order, /api/lab-results) — the SAME endpoints the clinical
			// Labs page and the patient snapshot use — so a record created on any of
			// those surfaces shows up here, and vice-versa. They are plain apiPath
			// (non-FHIR) tabs filtered to the chart's patient in `_loadTabData`.
			{
				key: 'labs', label: 'Lab Orders', icon: 'TestTube', emoji: '\u{1F9EA}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/lab-order/search',
				columns: [
					{ key: 'orderNumber', label: 'Order #' },
					{ key: 'testDisplay', label: 'Test', aliases: ['testDisplay', 'testName', 'orderName'] },
					{ key: 'physicianName', label: 'Provider', aliases: ['physicianName', 'orderingProvider', 'providerName'] },
					{ key: 'priority', label: 'Priority' },
					{ key: 'status', label: 'Status' },
					{ key: 'orderDate', label: 'Order Date' },
				],
			},
			{
				key: 'lab-results', label: 'Lab Results', icon: 'TestTube', emoji: '\u{1F4CA}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/lab-results',
				columns: [
					{ key: 'testName', label: 'Test' },
					{ key: 'value', label: 'Value' },
					{ key: 'referenceRange', label: 'Range' },
					{ key: 'abnormalFlag', label: 'Flag' },
					{ key: 'status', label: 'Status' },
					{ key: 'collectedDate', label: 'Collected' },
				],
			},
			// Immunizations read & write the CLINICAL store (/api/immunizations) —
			// the SAME endpoint the clinical Immunizations page uses — so a record
			// created on either surface shows up on the other (QA issues 4 & 5).
			// Plain apiPath (non-FHIR) tab filtered to the chart's patient in
			// `_loadTabData`, mirroring the labs unification above.
			{
				key: 'immunizations', label: 'Immunizations', icon: 'Syringe', emoji: '\u{1F489}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/immunizations',
				columns: [
					{ key: 'vaccineName', label: 'Vaccine' },
					{ key: 'cvxCode', label: 'CVX Code', aliases: ['cvxCode', 'cvx', 'vaccineCode'] },
					{ key: 'administrationDate', label: 'Date Administered', aliases: ['administrationDate', 'administeredDate'] },
					{ key: 'lotNumber', label: 'Lot Number', aliases: ['lotNumber', 'lot'] },
					{ key: 'doseSeries', label: 'Dose', aliases: ['doseSeries', 'doseNumber', 'dose'] },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'procedures', label: 'Procedures', icon: 'Scissors', emoji: '\u{2702}\u{FE0F}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['Procedure'],
				columns: [
					{ key: 'procedureName', label: 'Procedure' },
					{ key: 'cptCode', label: 'CPT Code' },
					{ key: 'datePerformed', label: 'Date Performed', aliases: ['datePerformed', 'performedDateTime', 'performedPeriod'] },
					{ key: 'performerName', label: 'Performer' },
					{ key: 'status', label: 'Status' },
				],
			},
			// History tab visible per the 02.05.26 *workspace* test report
			// (Clinical sub-pages must include History after Procedures).
			{
				key: 'history', label: 'History', icon: 'History', emoji: '\u{1F4DA}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: ['FamilyMemberHistory', 'Observation'],
				columns: [
					{ key: 'relationship', label: 'Relationship' },
					{ key: 'condition', label: 'Condition' },
					{ key: 'ageOfOnset', label: 'Age of Onset' },
					{ key: 'status', label: 'Status' },
					{ key: 'notes', label: 'Notes' },
				],
			},
		],
	},
	{
		key: 'encounters', label: 'Encounters', position: 4, tabs: [
			{
				key: 'encounters', label: 'Encounters', icon: 'ClipboardList', emoji: '\u{1F4CB}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Encounter'],
				columns: [
					{ key: 'visitCategory', label: 'Visit Type', aliases: ['visitCategory', 'type', 'encounterType', 'serviceType', 'class', 'visitType'] },
					{ key: 'encounterProvider', label: 'Provider', aliases: ['encounterProvider', 'providerDisplay', 'providerName', 'practitionerName', 'performerDisplay'] },
					{ key: 'encounterDate', label: 'Date', aliases: ['encounterDate', 'startDate', 'start', 'date', 'periodStart', 'created', 'createdAt', '_lastUpdated'] },
					// End Date column removed — the encounter create/edit form has no
					// End Date field, so the column could never be populated (QA issue 3).
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'appointments', label: 'Appointments', icon: 'Calendar', emoji: '\u{1F4C5}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['Appointment'],
				columns: [
					{ key: 'appointmentType', label: 'Visit Type', aliases: ['appointmentType', 'visitType', 'type'] },
					{ key: 'start', label: 'Start', aliases: ['start', 'startDate', 'appointmentStartDate'] },
					{ key: 'end', label: 'End', aliases: ['end', 'endDate', 'appointmentEndDate'] },
					{ key: 'providerName', label: 'Provider', aliases: ['providerName', 'providerDisplay', 'practitionerName'] },
					{ key: 'locationName', label: 'Location', aliases: ['locationName', 'locationDisplay'] },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'visit-notes', label: 'Visit Notes', icon: 'FileEdit', emoji: '\u{1F4DD}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'],
				columns: [
					// Aliases so the table populates regardless of the exact field
					// names the DocumentReference list returns (QA issue 12: Visit
					// Notes table rendered blank rows).
					{ key: 'type', label: 'Note Type', aliases: ['type', 'noteType', 'documentType', 'category', 'typeDisplay', 'noteTypeDisplay', 'docType'] },
					{ key: 'date', label: 'Visit Date', aliases: ['date', 'visitDate', 'authoredOn', 'created', 'createdAt', 'effectiveDate', 'recordedDate', '_lastUpdated'] },
					{ key: 'authorName', label: 'Author', aliases: ['authorName', 'author', 'authorDisplay', 'practitionerName', 'providerName', 'performerDisplay'] },
					{ key: 'subject', label: 'Subject', aliases: ['subject', 'title', 'description', 'subjectTitle'] },
					{ key: 'status', label: 'Status', aliases: ['status', 'docStatus'] },
				],
			},
			// Referrals visible per the 02.05.26 *workspace* test report
			// (Encounters sub-pages must include Referrals after Visit Notes).
			// Referrals read & write the CLINICAL store (/api/referrals) — the SAME
			// endpoint the clinical Referrals page uses — so a record created on
			// either surface shows up on the other (QA issue 6). Plain apiPath
			// (non-FHIR) tab filtered to the chart's patient in `_loadTabData`.
			{
				key: 'referrals', label: 'Referrals', icon: 'ArrowRight', emoji: '\u{27A1}\u{FE0F}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/referrals',
				columns: [
					{ key: 'specialistName', label: 'Refer To', aliases: ['specialistName', 'referredTo', 'referTo'] },
					{ key: 'specialty', label: 'Specialty' },
					{ key: 'urgency', label: 'Priority', aliases: ['urgency', 'priority'] },
					{ key: 'status', label: 'Status' },
					{ key: 'referralDate', label: 'Date', aliases: ['referralDate', 'date'] },
				],
			},
		],
	},
	{
		key: 'claims', label: 'Claims', position: 5, tabs: [
			// Billing & Claims columns explicitly list a `providerName`-style
			// alias chain so the table never falls back to the raw provider
			// or organization ID. The 12.05.26 test report flagged ID-only
			// columns app-wide; the chart cell renderer also runs the
			// _resolveIdToName fallback as a second line of defense.
			{
				key: 'billing', label: 'Billing', icon: 'Receipt', emoji: '\u{1F9FE}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'],
				columns: [
					{ key: 'serviceDate', label: 'Service Date', aliases: ['serviceDate', 'date', 'period.start', 'created'] },
					{ key: 'cptCode', label: 'CPT', aliases: ['cptCode', 'cpt'] },
					{ key: 'icdCode', label: 'Diagnosis', aliases: ['icdCode', 'icd10Code', 'diagnosisCode'] },
					{ key: 'providerName', label: 'Provider', aliases: ['providerName', 'providerDisplay', 'practitionerName', 'performerDisplay', 'providerId'] },
					// Issue #11: prefer human-readable display fields BEFORE the bare
					// id aliases so the cell falls back to the org-cache lookup
					// only when the FHIR row genuinely lacks a display name.
					{ key: 'insuranceName', label: 'Insurance Company', aliases: ['insuranceName', 'payerName', 'insurerName', 'insuranceCompanyName', 'companyName', 'organizationDisplay', 'organizationName', 'payor.display', 'payor.0.display', 'coverage.payor.display', 'coverage.payor.0.display', 'insurerDisplay', 'payerDisplay', 'insurerId', 'payerId'] },
					{ key: 'totalAmount', label: 'Amount', aliases: ['totalAmount', 'amount', 'totalNet.value'] },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'claims', label: 'Claims', icon: 'FileCheck', emoji: '\u{1F4CB}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'],
				columns: [
					{ key: 'claimNumber', label: 'Claim #', aliases: ['claimNumber', 'identifier', 'id'] },
					{ key: 'serviceDate', label: 'Service Date', aliases: ['serviceDate', 'date', 'period.start', 'created'] },
					{ key: 'providerName', label: 'Provider', aliases: ['providerName', 'providerDisplay', 'practitionerName', 'performerDisplay', 'providerId'] },
					// Issue #11: prefer human-readable display fields BEFORE the bare
					// id aliases so the cell falls back to the org-cache lookup
					// only when the FHIR row genuinely lacks a display name.
					{ key: 'insuranceName', label: 'Insurance Company', aliases: ['insuranceName', 'payerName', 'insurerName', 'insuranceCompanyName', 'companyName', 'organizationDisplay', 'organizationName', 'payor.display', 'payor.0.display', 'coverage.payor.display', 'coverage.payor.0.display', 'insurerDisplay', 'payerDisplay', 'insurerId', 'payerId'] },
					{ key: 'totalAmount', label: 'Amount', aliases: ['totalAmount', 'amount', 'totalNet.value'] },
					{ key: 'status', label: 'Status' },
				],
			},
			// Submissions: route through the FHIR generic controller via the
			// `claim-submissions` tab_field_config row (FHIR Claim resource).
			// The legacy /api/portal/form-submissions endpoint required a
			// PortalFormSubmission shape (form_id / form_key / form_title) that
			// the generic add/edit form doesn't supply, which was producing the
			// "null value in column form_id" save error on every retest.
			{ key: 'submissions', label: 'Submissions', icon: 'Upload', emoji: '\u{1F4E4}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'] },
			// Denials are FHIR ClaimResponse resources — the same model the EHR-UI's
			// claim-denials tab uses. TAB_API_SLUG maps 'denials' → 'claim-denials',
			// so list/create/update route to /api/fhir-resource/claim-denials and the
			// backend resolves the ClaimResponse field mapping (Denial Information /
			// Adjudication Summary / Process Notes). The previous apiPath pointed at
			// /claims?status=denied (the Claim resource), which rendered the wrong,
			// minimal denial form instead of the rich EHR-UI layout.
			{ key: 'denials', label: 'Denials', icon: 'AlertCircle', emoji: '\u{26D4}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['ClaimResponse'] },
			// readOnly was true for a long time; the test team needs the Add New
			// button to manually post a remittance entry until the 835 ingestion
			// pipeline is wired up. PaymentReconciliation is FHIR-write capable.
			{ key: 'era-remittance', label: 'ERA / Remittance', icon: 'FileDown', emoji: '\u{1F4C4}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['PaymentReconciliation'] },
			// Transactions writes go through FHIR Invoice (same backend tab_field_config
			// as the Payment tab — Invoice covers both ledger entries and statements).
			// Was previously read-only with apiPath:/api/payments/transactions which has
			// no POST handler, so users couldn't create records.
			{
				key: 'transactions', label: 'Transactions', icon: 'ArrowLeftRight', emoji: '\u{1F4B3}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: ['Invoice'],
				columns: [
					{ key: 'transactionDate', label: 'Date', aliases: ['transactionDate', 'date', 'serviceDate', 'period.start', 'created', 'createdAt'] },
					{ key: 'transactionType', label: 'Type', aliases: ['transactionType', 'type'] },
					{ key: 'totalAmount', label: 'Amount', aliases: ['totalAmount', 'amount', 'totalNet.value', 'totalGross.value'] },
					{ key: 'referenceNumber', label: 'Reference', aliases: ['referenceNumber', 'identifier', 'reference'] },
					{ key: 'description', label: 'Description', aliases: ['description', 'note'] },
					{ key: 'status', label: 'Status' },
				],
			},
		],
	},
	{
		key: 'financial', label: 'Financial', position: 6, tabs: [
			// Payment + Statements both flow through FHIR (Invoice / PaymentNotice) so the
			// fields, columns, and edit form match what tab_field_config defines — same
			// source of truth as the web UI's PaymentPostingTab / StatementsTab.
			{
				key: 'payment', label: 'Payment', icon: 'CreditCard', emoji: '\u{1F4B3}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Invoice'],
				// Columns mirror web app PaymentPostingTab "existing payments" table.
				columns: [
					{ key: 'claimNumber', label: 'Claim #', aliases: ['claimNumber', 'claim.identifier', 'claimId', 'claim'] },
					{ key: 'dateOfService', label: 'DOS', aliases: ['dateOfService', 'serviceDate'] },
					{ key: 'paymentDate', label: 'Payment Date', aliases: ['paymentDate', 'date', 'transactionDate', 'created'] },
					{ key: 'paymentType', label: 'Type', aliases: ['paymentType', 'paymentMethod', 'method', 'type'] },
					{ key: 'amount', label: 'Amount', aliases: ['amount', 'totalAmount', 'totalNet.value', 'totalGross.value'] },
					{ key: 'reference', label: 'Reference', aliases: ['reference', 'referenceNumber', 'identifier', 'checkNumber'] },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'statements', label: 'Statements', icon: 'FileBarChart', emoji: '\u{1F4CA}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['PaymentNotice'],
				// Columns mirror web app StatementsTab.
				columns: [
					{ key: 'statementNumber', label: 'Statement #', aliases: ['statementNumber', 'identifier', 'id'] },
					{ key: 'statementDate', label: 'Statement Date', aliases: ['statementDate', 'date', 'created', 'createdAt'] },
					{ key: 'dueDate', label: 'Due Date', aliases: ['dueDate', 'paymentDate'] },
					{ key: 'totalCharges', label: 'Charges', aliases: ['totalCharges', 'totalGross.value'] },
					{ key: 'totalPayments', label: 'Payments', aliases: ['totalPayments', 'amount.value'] },
					{ key: 'totalAdjustments', label: 'Adjustments', aliases: ['totalAdjustments'] },
					{ key: 'balance', label: 'Balance', aliases: ['balance', 'totalNet.value'] },
					{ key: 'status', label: 'Status' },
				],
			},
		],
	},
	{
		key: 'others', label: 'Others', position: 7, tabs: [
			// Issues view rolls up Condition+AllergyIntolerance+MedicationRequest per V64;
			// the backend tab_field_config 'issues' is the source of truth for fields.
			// No apiPath override — let _tabEndpoint derive '/api/fhir-resource/issues'
			// so save-scope lookup matches the tab_key 'issues'. The previous override
			// pointed to '/conditions' which has no tab_field_config row → "Cannot
			// determine resource type for tab 'conditions' — write access denied".
			{
				key: 'issues', label: 'Issues', icon: 'CircleAlert', emoji: '\u{2757}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Condition'],
				columns: [
					{ key: 'conditionName', label: 'Issue', aliases: ['conditionName', 'name', 'code', 'display'] },
					{ key: 'severity', label: 'Severity' },
					{ key: 'clinicalStatus', label: 'Status', aliases: ['clinicalStatus', 'status'] },
					{ key: 'onsetDate', label: 'Onset Date', aliases: ['onsetDate', 'onsetDateTime', 'recordedDate'] },
				],
			},
			// Report = clinical reports (DiagnosticReport). No apiPath so the
			// generic FHIR routing picks up the TAB_API_SLUG 'report' → 'labs'
			// mapping (the only seeded tab_field_config row with a complete
			// DiagnosticReport FHIR mapping). With apiPath set, save POSTs were
			// hitting /api/fhir-resource/diagnostic-reports with no patient
			// path and the backend was picking up the wrong tab key, returning
			// "Cannot determine resource type for tab 'conditions' — write
			// access denied".
			{
				key: 'report', label: 'Report', icon: 'FileBarChart', emoji: '\u{1F4C8}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['DiagnosticReport'],
				columns: [
					{ key: 'testName', label: 'Report Name', aliases: ['testName', 'code', 'name'] },
					{ key: 'category', label: 'Category' },
					{ key: 'effectiveDate', label: 'Effective Date', aliases: ['effectiveDate', 'effectiveDateTime', 'date'] },
					{ key: 'providerName', label: 'Provider', aliases: ['providerName', 'performerDisplay'] },
					{ key: 'status', label: 'Status' },
				],
			},
		],
	},
];

const SIDEBAR_COLLAPSED_KEY = 'ciyex.patientChart.sidebarCollapsed';
const LAST_TAB_KEY_PREFIX = 'ciyex.patientChart.lastTab.';
// Collapse state for each category section in the sidebar — persisted across
// chart opens. Click a category heading to toggle. Quick Info is always visible.
const CATEGORY_COLLAPSED_KEY_PREFIX = 'ciyex.patientChart.catCollapsed.';

// Built-in field configs for tabs with a standard structure. Users can still override by dropping
// a file at ~/.ciyex/fields/{tabKey}.json — that takes precedence.
export const DEFAULT_FIELD_CONFIGS: Record<string, FieldConfig> = {
	demographics: {
		tabKey: 'demographics',
		sections: [
			{
				key: 'personal', title: 'Personal Information', columns: 3, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'firstName', label: 'First Name', type: 'text', required: true },
					{ key: 'lastName', label: 'Last Name', type: 'text', required: true },
					{ key: 'middleName', label: 'Middle Name', type: 'text' },
					{ key: 'suffix', label: 'Suffix', type: 'text' },
					{ key: 'preferredName', label: 'Preferred Name', type: 'text' },
					{ key: 'previousName', label: 'Previous / Maiden Name', type: 'text' },
					{ key: 'dateOfBirth', label: 'Date of Birth', type: 'date', required: true },
					{ key: 'gender', label: 'Sex at Birth', type: 'select', required: true, options: [{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }, { label: 'Other', value: 'Other' }, { label: 'Unknown', value: 'Unknown' }] },
					{ key: 'genderIdentity', label: 'Gender Identity', type: 'text' },
					{ key: 'pronouns', label: 'Pronouns', type: 'text' },
					{ key: 'sexualOrientation', label: 'Sexual Orientation', type: 'text' },
					{ key: 'mrn', label: 'Medical Record Number', type: 'text' },
					{ key: 'ssn', label: 'SSN', type: 'text' },
					{ key: 'maritalStatus', label: 'Marital Status', type: 'select', options: [{ label: 'Single', value: 'Single' }, { label: 'Married', value: 'Married' }, { label: 'Divorced', value: 'Divorced' }, { label: 'Widowed', value: 'Widowed' }, { label: 'Separated', value: 'Separated' }] },
					{ key: 'race', label: 'Race', type: 'text' },
					{ key: 'ethnicity', label: 'Ethnicity', type: 'text' },
					{ key: 'preferredLanguage', label: 'Preferred Language', type: 'text' },
					{ key: 'interpreterNeeded', label: 'Interpreter Needed', type: 'boolean' },
					{ key: 'tribalAffiliation', label: 'Tribal Affiliation', type: 'text' },
					{ key: 'religion', label: 'Religion', type: 'text' },
					{ key: 'veteranStatus', label: 'Veteran Status', type: 'text' },
					{ key: 'disabilityStatus', label: 'Disability Status', type: 'text' },
					{ key: 'multipleBirth', label: 'Multiple Birth', type: 'boolean' },
					{ key: 'dateOfDeath', label: 'Date of Death', type: 'date' },
				],
			},
			{
				key: 'contact', title: 'Contact Information', columns: 3, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'phoneNumber', label: 'Mobile Phone', type: 'phone', required: true },
					{ key: 'homePhone', label: 'Home Phone', type: 'phone' },
					{ key: 'workPhone', label: 'Work Phone', type: 'phone' },
					{ key: 'email', label: 'Email Address', type: 'email' },
					{ key: 'preferredContactMethod', label: 'Preferred Contact Method', type: 'select', options: [{ label: 'Phone', value: 'Phone' }, { label: 'Email', value: 'Email' }, { label: 'SMS', value: 'SMS' }, { label: 'Mail', value: 'Mail' }] },
					{ key: 'address', label: 'Address', type: 'textarea', colSpan: 3 },
				],
			},
			{
				key: 'consent', title: 'Communication Consent', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'allowSms', label: 'Allow SMS / Text Messages', type: 'boolean' },
					{ key: 'allowEmail', label: 'Allow Email Communication', type: 'boolean' },
					{ key: 'allowVoicemail', label: 'Allow Voicemail', type: 'boolean' },
					{ key: 'allowPostalMail', label: 'Allow Postal Mail', type: 'boolean' },
					{ key: 'allowPatientPortal', label: 'Allow Patient Portal', type: 'boolean' },
					{ key: 'hipaaNoticeReceived', label: 'HIPAA Notice Received', type: 'boolean' },
					{ key: 'allowHealthInfoExchange', label: 'Allow Health Info Exchange', type: 'boolean' },
					{ key: 'allowImmunizationRegistry', label: 'Allow Immunization Registry', type: 'boolean' },
					{ key: 'medicationHistoryConsent', label: 'Medication History Consent', type: 'boolean' },
				],
			},
			{
				key: 'emergency', title: 'Emergency Contact', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'emergencyContactName', label: 'Contact Name', type: 'text' },
					{ key: 'emergencyContactRelationship', label: 'Relationship', type: 'text' },
					{ key: 'emergencyContactPhone', label: 'Phone', type: 'phone' },
				],
			},
			{
				key: 'guardian', title: 'Guardian Information', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'guardianName', label: 'Guardian Name', type: 'text' },
					{ key: 'guardianRelationship', label: 'Relationship', type: 'text' },
					{ key: 'guardianPhone', label: 'Phone', type: 'phone' },
					{ key: 'guardianEmail', label: 'Email', type: 'email' },
					{ key: 'guardianAddress', label: 'Address', type: 'textarea' },
					// allow-any-unicode-next-line
					{ key: 'motherName', label: 'Mother’s Name', type: 'text' },
				],
			},
			{
				key: 'guarantor', title: 'Guarantor / Billing Responsible Party', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'guarantorFirstName', label: 'First Name', type: 'text' },
					{ key: 'guarantorLastName', label: 'Last Name', type: 'text' },
					{ key: 'guarantorRelationship', label: 'Relationship to Patient', type: 'text' },
					{ key: 'guarantorDob', label: 'Date of Birth', type: 'date' },
					{ key: 'guarantorSsn', label: 'SSN', type: 'text' },
					{ key: 'guarantorPhone', label: 'Phone', type: 'phone' },
				],
			},
			{
				key: 'pharmacy', title: 'Preferred Pharmacy', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'pharmacyName', label: 'Pharmacy Name', type: 'text' },
					{ key: 'pharmacyPhone', label: 'Phone', type: 'phone' },
					{ key: 'pharmacyFax', label: 'Fax', type: 'phone' },
					{ key: 'pharmacyAddress', label: 'Address', type: 'textarea', colSpan: 2 },
					{ key: 'mailOrderPharmacy', label: 'Mail-Order Pharmacy', type: 'text' },
				],
			},
			{
				key: 'advance', title: 'Advance Directives', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'advanceDirectiveOnFile', label: 'Advance Directive on File', type: 'boolean' },
					{ key: 'directiveType', label: 'Directive Type', type: 'text' },
					{ key: 'directiveReviewDate', label: 'Review Date', type: 'date' },
					{ key: 'healthcareProxyName', label: 'Healthcare Proxy / POA Name', type: 'text' },
					{ key: 'healthcareProxyPhone', label: 'Healthcare Proxy Phone', type: 'phone' },
					{ key: 'organDonor', label: 'Organ Donor', type: 'boolean' },
				],
			},
			{
				key: 'provider', title: 'Provider & Practice', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'assignedProvider', label: 'Assigned Provider', type: 'text' },
					{ key: 'referringProvider', label: 'Referring Provider', type: 'text' },
					{ key: 'primaryCarePhysician', label: 'Primary Care Physician', type: 'text' },
					{ key: 'status', label: 'Patient Status', type: 'select', required: true, options: [{ label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }, { label: 'Deceased', value: 'Deceased' }] },
					{ key: 'referralSource', label: 'Referral Source', type: 'text' },
					{ key: 'patientSince', label: 'Patient Since', type: 'date' },
				],
			},
			{
				key: 'employer', title: 'Employer Information', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'occupation', label: 'Occupation', type: 'text' },
					{ key: 'industry', label: 'Industry', type: 'text' },
					{ key: 'employerName', label: 'Employer Name', type: 'text' },
					{ key: 'employerPhone', label: 'Employer Phone', type: 'phone' },
					{ key: 'employerAddress', label: 'Employer Address', type: 'textarea', colSpan: 2 },
				],
			},
			{
				key: 'identifiers', title: 'Additional Identifiers', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					// allow-any-unicode-next-line
					{ key: 'driversLicense', label: 'Driver’s License #', type: 'text' },
					{ key: 'driversLicenseState', label: 'DL State', type: 'text' },
					{ key: 'medicaidId', label: 'Medicaid ID', type: 'text' },
					{ key: 'medicareBeneficiaryId', label: 'Medicare Beneficiary ID', type: 'text' },
					{ key: 'registrationDate', label: 'Registration Date', type: 'date' },
				],
			},
		],
	},
	// Field keys MUST match backend tab_field_config (V5 migration) so reads/writes
	// hit the same FHIR paths. Used as the offline fallback only — we prefer the
	// backend config from /api/tab-field-config/{tabKey} which is always authoritative.
	allergies: {
		tabKey: 'allergies',
		sections: [
			{
				key: 'details', title: 'Allergy Details', columns: 3, visible: true, collapsible: false, fields: [
					// letters + spaces only (reject numeric input like "55555"). Backend
					// migration V172 renamed this field's label to "Allergy" and added a
					// separate `allergen` field below — the validation is carried on BOTH by
					// key so whichever the tenant's config surfaces stays letters-only.
					{ key: 'allergyName', label: 'Allergy', type: 'text', required: true, placeholder: 'Allergy name', validationPattern: '^[A-Za-z][A-Za-z ]*$', validationMessage: 'Allergy may contain only letters and spaces' },
					// The "Allergen" field the QA report flagged (V172, reaction[0].substance.text).
					// This override injects the letters-only rule onto the backend `allergen`
					// field via the per-field config merge (matched by key).
					{ key: 'allergen', label: 'Allergen', type: 'text', placeholder: 'Specific allergen/substance', validationPattern: '^[A-Za-z][A-Za-z ]*$', validationMessage: 'Allergen may contain only letters and spaces' },
					{
						key: 'status', label: 'Clinical Status', type: 'select', required: true, options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Inactive', value: 'inactive' },
							{ label: 'Resolved', value: 'resolved' },
						]
					},
					{
						key: 'severity', label: 'Severity', type: 'select', options: [
							{ label: 'Mild', value: 'mild' },
							{ label: 'Moderate', value: 'moderate' },
							{ label: 'Severe', value: 'severe' },
						]
					},
					{ key: 'reaction', label: 'Reaction', type: 'text', placeholder: 'Describe reaction' },
					{ key: 'startDate', label: 'Onset Date', type: 'date' },
					{ key: 'endDate', label: 'End Date', type: 'date' },
					{ key: 'comments', label: 'Notes', type: 'textarea', placeholder: 'Notes', colSpan: 3 },
				],
			},
		],
	},
	problems: {
		tabKey: 'problems',
		sections: [
			{
				key: 'details', title: 'Problem Details', columns: 3, visible: true, collapsible: false, fields: [
					// Field key MUST be `conditionName` to match the backend tab_field_config
					// (V5 / V18 / V20 — `code.text` mapping). Sending `condition` saves no
					// value to the FHIR Condition resource so the row can't be reloaded.
					{ key: 'conditionName', label: 'Condition', type: 'text', required: true, placeholder: 'Condition name' },
					// Selecting / pasting an ICD-10 code fills the Condition name from the
					// code's description (relatedField), mirroring the CPT→procedureName wiring.
					{ key: 'icdCode', label: 'ICD-10 Code', type: 'code-search', placeholder: 'Search ICD-10 codes...', lookupConfig: { system: 'ICD10_CM' }, relatedField: 'conditionName' },
					{
						key: 'clinicalStatus', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Inactive', value: 'inactive' },
							{ label: 'Resolved', value: 'resolved' },
						]
					},
					{
						key: 'severity', label: 'Severity', type: 'select', options: [
							{ label: 'Mild', value: 'mild' },
							{ label: 'Moderate', value: 'moderate' },
							{ label: 'Severe', value: 'severe' },
						]
					},
					{ key: 'onsetDate', label: 'Onset Date', type: 'date', required: true },
					{ key: 'resolvedDate', label: 'Resolved Date', type: 'date' },
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Enter your message', colSpan: 3 },
				],
			},
		],
	},
	vitals: {
		tabKey: 'vitals',
		sections: [
			{
				key: 'measurements', title: 'Vital Signs', columns: 3, visible: true, collapsible: false, fields: [
					{ key: 'weightKg', label: 'Weight (kg)', type: 'number', required: true, placeholder: '0.0' },
					{ key: 'heightCm', label: 'Height (cm)', type: 'number', required: true, placeholder: '0.0' },
					// allow-any-unicode-next-line
					{ key: 'bmi', label: 'BMI (kg/m²)', type: 'number', placeholder: 'Auto-calculated', localOnly: true },
					{ key: 'bpSystolic', label: 'BP Systolic (mmHg)', type: 'number', required: true, placeholder: '0' },
					{ key: 'bpDiastolic', label: 'BP Diastolic (mmHg)', type: 'number', required: true, placeholder: '0' },
					{ key: 'pulse', label: 'Pulse (/min)', type: 'number', required: true, placeholder: '0' },
					{ key: 'respiration', label: 'Respiration (breaths/min)', type: 'number', required: true, placeholder: '0' },
					// allow-any-unicode-next-line
					{ key: 'temperatureC', label: 'Temperature (°C)', type: 'number', required: true, placeholder: '0.0' },
					{ key: 'oxygenSaturation', label: 'O\u{2082} Saturation (%)', type: 'number', required: true, placeholder: '0' },
					// `localOnly` so the merge always appends Notes even when the
					// backend vitals config ships it only under the dropped
					// "Recording Info" / vitals-meta section (QA issue 2: Notes
					// field missing from the create form though the flowsheet has a
					// Notes row).
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Optional notes', colSpan: 3, localOnly: true },
				],
			},
		],
	},
	// Local overrides for the V144 Flag tab_field_config row. Field keys MUST
	// match the backend so the overlay map applies (otherwise the backend's
	// plain text inputs render with no validation / search).
	'clinical-alerts': {
		tabKey: 'clinical-alerts',
		sections: [
			{
				key: 'alert-info', title: 'Clinical Alert', columns: 2, visible: true, collapsible: false, fields: [
					{
						key: 'alertName', label: 'Alert', type: 'text', required: true, placeholder: 'Alert summary',
						validationPattern: '^[A-Za-z0-9 ,.\\-/()\\[\\]+&\'!?:;]{3,256}$',
						validationMessage: 'Alert must be 3-256 characters and contain only letters, numbers, and common punctuation',
					},
					{ key: 'identifiedDate', label: 'Identified Date', type: 'date', defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'author', label: 'Author', type: 'practitioner-search', placeholder: 'Search Author' },
					{ key: 'notes', label: 'Description', type: 'textarea', colSpan: 2, placeholder: 'Detailed description' },
				],
			},
		],
	},
	medications: {
		tabKey: 'medications',
		sections: [
			{
				key: 'med', title: 'Medication', columns: 2, visible: true, collapsible: false, fields: [
					{
						key: 'medicationName', label: 'Medication Name', type: 'text', required: true, placeholder: 'Drug name',
						validationPattern: '^[A-Za-z0-9 ,.\\-/()+&\']{2,120}$',
						validationMessage: 'Medication name must be 2-120 characters and contain only letters, numbers, and common punctuation',
					},
					{
						key: 'dosage', label: 'Dosage', type: 'text', required: true, placeholder: 'e.g., 500 mg',
						// Unit is REQUIRED (no trailing `?` on the unit group) so plain
						// numbers / pure-letter / special-char inputs all fail validation.
						// The previous pattern accepted "500" alone, which the test team
						// flagged as a false positive in the negative-test cases.
						validationPattern: '^\\d+(\\.\\d+)?\\s*(mg|mcg|g|mL|ml|L|IU|units?|tablets?|tabs?|capsules?|caps?|drops?|gtt|puffs?|sprays?|patches?|%)(\\s*/\\s*\\d+(\\.\\d+)?\\s*(mL|ml|L)?)?$',
						validationMessage: 'Dosage must be a number followed by a unit (e.g. "500 mg", "10 mL", "2 tablets")',
					},
					// "Date Issued" maps to the medication's start/authored date — `startDate`
					// is the key the medications list column reads, so the new record shows its
					// date immediately in the chart list and snapshot.
					{ key: 'startDate', label: 'Date Issued', type: 'date' },
					// Prescriber: store the practitioner id under `prescribingDoctor`
					// (the key the backend medications tab_field_config maps to the
					// FHIR MedicationRequest.requester reference) so the prescriber is
					// actually persisted — the old `prescriberId` key matched no
					// backend mapping and was silently dropped, leaving the table to
					// fall back to a bare id. `relatedField` also captures the chosen
					// NAME into the `prescriberName` companion field so the table shows
					// the name immediately (optimistic merge) and after the backend
					// re-fetch returns `prescribingDoctorDisplay` (QA: name not id).
					{ key: 'prescribingDoctor', label: 'Prescriber', type: 'practitioner-search', placeholder: 'Search Prescriber', relatedField: 'prescriberName' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Draft', value: 'draft' },
							{ label: 'Active', value: 'active' },
							{ label: 'On Hold', value: 'on-hold' },
							{ label: 'Stopped', value: 'stopped' },
							{ label: 'Completed', value: 'completed' },
							{ label: 'Cancelled', value: 'cancelled' },
						]
					},
					{ key: 'instructions', label: 'Instructions', type: 'textarea', colSpan: 2, placeholder: 'Patient instructions' },
				],
			},
		],
	},
	// Lab ORDER form — matches the clinical Labs page "New Lab Order" schema so
	// the chart writes the same flat DTO to /api/lab-order that the clinical page
	// and the snapshot do (keys: orderNumber, testDisplay, testCode, status,
	// priority, orderDate, physicianName, result, specimenId, diagnosisCode,
	// procedureCode, notes). Ordering Provider is a practitioner SEARCH that
	// stores the chosen provider's NAME (storeLabelAsValue) rather than an id —
	// the clinical lab-order DTO keeps physicianName as a display string, not a
	// Practitioner reference, so the search must persist the name, not the id.
	labs: {
		tabKey: 'labs',
		sections: [
			{
				key: 'order', title: 'Lab Order', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'orderNumber', label: 'Order Number', type: 'text', placeholder: 'Auto-generated', defaultValue: () => { const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; const rand = Math.random().toString(36).slice(2, 6).toUpperCase(); return `LAB-${ymd}-${rand}`; } },
					{ key: 'labName', label: 'Lab Name', type: 'text', placeholder: 'Quest, LabCorp, etc.' },
					{ key: 'testCode', label: 'Test Code (LOINC)', type: 'code-search', required: true, placeholder: 'Search LOINC codes', lookupConfig: { system: 'LOINC' }, relatedField: 'testDisplay' },
					{ key: 'testDisplay', label: 'Test Name', type: 'text', required: true, placeholder: 'Test name', aliases: ['testName', 'orderName'] },
					{ key: 'orderDate', label: 'Order Date', type: 'date', defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'physicianName', label: 'Ordering Provider', type: 'practitioner-search', required: true, placeholder: 'Search provider', storeLabelAsValue: true, aliases: ['orderingProvider', 'providerName'] },
					{
						key: 'priority', label: 'Priority', type: 'select', options: [
							{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Active', value: 'active' }, { label: 'Pending', value: 'pending' },
							{ label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
						]
					},
					{
						key: 'result', label: 'Result Status', type: 'select', aliases: ['resultStatus'], options: [
							{ label: 'Pending', value: 'Pending' }, { label: 'Preliminary', value: 'Preliminary' },
							{ label: 'Final', value: 'Final' }, { label: 'Corrected', value: 'Corrected' }, { label: 'Amended', value: 'Amended' },
						]
					},
					{ key: 'specimenId', label: 'Specimen ID', type: 'text', placeholder: 'S-0001' },
					{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', type: 'code-search', required: true, placeholder: 'Search ICD-10 codes', lookupConfig: { system: 'ICD10_CM' } },
					{ key: 'procedureCode', label: 'Procedure Code (CPT)', type: 'code-search', required: true, placeholder: 'Search CPT codes', lookupConfig: { system: 'CPT' } },
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	// Lab RESULT form — matches the clinical Labs page "New Lab Result" schema so
	// the chart writes the same flat DTO to /api/lab-results.
	'lab-results': {
		tabKey: 'lab-results',
		sections: [
			{
				key: 'result', title: 'Lab Result', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'testName', label: 'Test Name', type: 'text', required: true, placeholder: 'e.g. CBC, Glucose' },
					{ key: 'loincCode', label: 'LOINC Code', type: 'code-search', placeholder: 'Search LOINC codes', lookupConfig: { system: 'LOINC' } },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Pending', value: 'pending' }, { label: 'Preliminary', value: 'preliminary' },
							{ label: 'Partial', value: 'partial' }, { label: 'Final', value: 'final' },
							{ label: 'Corrected', value: 'corrected' }, { label: 'Amended', value: 'amended' },
						]
					},
					{
						key: 'abnormalFlag', label: 'Abnormal Flag', type: 'select', options: [
							{ label: 'Normal', value: 'normal' }, { label: 'Low', value: 'low' },
							{ label: 'High', value: 'high' }, { label: 'Critical', value: 'critical' }, { label: 'Abnormal', value: 'abnormal' },
						]
					},
					{ key: 'value', label: 'Value', type: 'text', required: true, placeholder: 'Result value', aliases: ['resultValue'] },
					{ key: 'units', label: 'Units', type: 'text', placeholder: 'mg/dL, mmol/L...' },
					{ key: 'referenceRange', label: 'Reference Range', type: 'text', placeholder: '70-100' },
					{ key: 'specimen', label: 'Specimen', type: 'text', placeholder: 'Blood, Urine...' },
					{ key: 'collectedDate', label: 'Collected Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'reportedDate', label: 'Reported Date', type: 'date' },
					{ key: 'panelName', label: 'Panel Name', type: 'text', placeholder: 'CBC, BMP...' },
					{ key: 'recommendations', label: 'Recommendations', type: 'textarea', colSpan: 2, placeholder: 'Clinical recommendations...' },
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2, placeholder: 'Additional notes...' },
				],
			},
		],
	},
	// Immunization form — matches the clinical Immunizations page schema so the
	// chart writes the same flat DTO to /api/immunizations that the clinical
	// page uses (keys: vaccineName, cvxCode, manufacturer, lotNumber,
	// expirationDate, administrationDate, site, route, doseNumber/doseSeries,
	// administeredBy, status, notes). patientId/patientName are injected by the
	// chart's save handler; the dose split into doseNumber+doseSeries happens
	// there too.
	immunizations: {
		tabKey: 'immunizations',
		sections: [
			{
				key: 'imm', title: 'Immunization', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'cvxCode', label: 'Vaccine CVX Code', type: 'code-search', required: true, placeholder: 'Search CVX codes', lookupConfig: { system: 'CVX' }, relatedField: 'vaccineName', aliases: ['cvx', 'vaccineCode'] },
					{ key: 'vaccineName', label: 'Vaccine Name', type: 'text', placeholder: 'Influenza, inactivated' },
					{ key: 'administrationDate', label: 'Date Administered', type: 'date', required: true, aliases: ['administeredDate'] },
					{
						key: 'lotNumber', label: 'Lot Number', type: 'text', placeholder: 'e.g. FR8912',
						validationPattern: '^[A-Za-z0-9]{5,10}$',
						validationMessage: 'Lot number must be 5-10 letters and numbers only (e.g. FR8912)',
					},
					{
						// Keyed `doseSeries` (the free-text DTO column), NOT `doseNumber`:
						// the shared format validator has a built-in doseNumber rule that
						// only accepts whole 1-99 (dose-in-series), which would reject
						// "0.5 mL". The save handler derives the Integer doseNumber from
						// this text.
						key: 'doseSeries', label: 'Dose', type: 'text', placeholder: 'e.g., 0.5 mL', aliases: ['doseNumber', 'dose'],
						validationPattern: '^(?!0+(?:\\.0+)?\\s*$)\\d+(?:\\.\\d+)?(?:\\s*(mL|mg|mcg|units|IU|cc|g|%))?$',
						validationMessage: 'Dose must be a positive number (e.g., 1.5 or 0.5 mL)',
					},
					{
						key: 'route', label: 'Route', type: 'select', placeholder: 'Select route…', options: [
							{ label: 'Intramuscular (IM)', value: 'IM' },
							{ label: 'Subcutaneous (SC)', value: 'SC' },
							{ label: 'Oral', value: 'PO' },
							{ label: 'Intranasal', value: 'IN' },
							{ label: 'Intradermal', value: 'ID' },
						]
					},
					{
						key: 'site', label: 'Site', type: 'select', placeholder: 'Select site…', options: [
							{ label: 'Left Arm', value: 'left_arm' },
							{ label: 'Right Arm', value: 'right_arm' },
							{ label: 'Left Thigh', value: 'left_thigh' },
							{ label: 'Right Thigh', value: 'right_thigh' },
							{ label: 'Left Deltoid', value: 'left_deltoid' },
							{ label: 'Right Deltoid', value: 'right_deltoid' },
							{ label: 'Left Gluteal', value: 'left_gluteal' },
							{ label: 'Right Gluteal', value: 'right_gluteal' },
						]
					},
					{ key: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Pfizer' },
					{ key: 'expirationDate', label: 'Expiration Date', type: 'date' },
					// Searchable like the clinical Immunizations page's Administered By —
					// QA: a plain text box gave no way to look up the provider.
					// storeLabelAsValue: administeredBy is a NAME column in the flat
					// immunization DTO, so persist the picked display name, not the id.
					{ key: 'administeredBy', label: 'Administered By', type: 'search', placeholder: 'Search provider…', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'], storeLabelAsValue: true, aliases: ['provider', 'administeredByName', 'providerName'] },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Completed', value: 'completed' },
							{ label: 'Entered in Error', value: 'entered_in_error' },
							{ label: 'Not Done', value: 'not_done' },
						]
					},
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2, placeholder: 'Notes' },
				],
			},
		],
	},
	// Referral form — matches the clinical Referrals page schema so the chart
	// writes the same flat DTO to /api/referrals that the clinical page uses.
	// patientId/patientName are injected by the chart's save handler.
	referrals: {
		tabKey: 'referrals',
		sections: [
			{
				key: 'ref', title: 'Referral', columns: 2, visible: true, collapsible: false, fields: [
					// Provider search (stores the chosen provider's NAME — the flat
					// /api/referrals DTO carries a name string, not an FK) so the user
					// picks from the practice's providers instead of typing free text
					// (QA issue 8).
					{ key: 'referringProvider', label: 'Referring Provider', type: 'practitioner-search', required: true, placeholder: 'Search provider', storeLabelAsValue: true, aliases: ['referringProviderName', 'referringPrescriber'] },
					{ key: 'referralDate', label: 'Referral Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'specialistName', label: 'Specialist Name', type: 'text', required: true, placeholder: 'e.g. Dr. Jane Smith', validationPattern: '^[A-Za-z\\s\\-\'.]+$', validationMessage: 'Specialist name must contain only letters, spaces, hyphens, apostrophes or periods' },
					{ key: 'specialistNpi', label: 'Specialist NPI', type: 'text', placeholder: '10-digit NPI', validationPattern: '^\\d{10}$', validationMessage: 'NPI must be exactly 10 digits' },
					{
						key: 'specialty', label: 'Specialty', type: 'select', placeholder: 'Select specialty…', options: [
							{ label: 'Allergy/Immunology', value: 'Allergy/Immunology' },
							{ label: 'Cardiology', value: 'Cardiology' }, { label: 'Dermatology', value: 'Dermatology' },
							{ label: 'Endocrinology', value: 'Endocrinology' }, { label: 'ENT', value: 'ENT' },
							{ label: 'Gastroenterology', value: 'Gastroenterology' },
							{ label: 'Geriatrics', value: 'Geriatrics' },
							{ label: 'Hematology', value: 'Hematology' },
							{ label: 'Infectious Disease', value: 'Infectious Disease' },
							{ label: 'Nephrology', value: 'Nephrology' }, { label: 'Neurology', value: 'Neurology' },
							{ label: 'Obstetrics/Gynecology', value: 'Obstetrics/Gynecology' },
							{ label: 'Oncology', value: 'Oncology' }, { label: 'Ophthalmology', value: 'Ophthalmology' },
							{ label: 'Orthopedics', value: 'Orthopedics' },
							{ label: 'Pain Management', value: 'Pain Management' },
							{ label: 'Pediatrics', value: 'Pediatrics' },
							{ label: 'Physical Medicine', value: 'Physical Medicine' },
							{ label: 'Podiatry', value: 'Podiatry' }, { label: 'Psychiatry', value: 'Psychiatry' },
							{ label: 'Pulmonology', value: 'Pulmonology' }, { label: 'Radiology', value: 'Radiology' },
							{ label: 'Rheumatology', value: 'Rheumatology' },
							{ label: 'Sports Medicine', value: 'Sports Medicine' },
							{ label: 'Surgery', value: 'Surgery' }, { label: 'Urology', value: 'Urology' },
							{ label: 'Other', value: 'Other' },
						]
					},
					{ key: 'facilityName', label: 'Facility Name', type: 'text', required: true, placeholder: 'e.g. City Medical Center', validationPattern: '^[A-Za-z0-9\\s\\-\'.,&#()\\/]{2,200}$', validationMessage: 'Facility name must be 2-200 characters using only letters, numbers, and common punctuation' },
					{ key: 'facilityPhone', label: 'Facility Phone', type: 'text', placeholder: '(555) 123-4567', validationPattern: '^\\(?\\d{3}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}$', validationMessage: 'Phone must be a 10-digit US number' },
					{
						key: 'urgency', label: 'Urgency', type: 'select', options: [
							{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' },
							{ label: 'Acknowledged', value: 'acknowledged' }, { label: 'Scheduled', value: 'scheduled' },
							{ label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
							{ label: 'Denied', value: 'denied' },
						]
					},
					{ key: 'reason', label: 'Reason for Referral', type: 'textarea', required: true, colSpan: 2, placeholder: 'Reason for referral...' },
					{ key: 'clinicalNotes', label: 'Clinical Notes', type: 'textarea', colSpan: 2, placeholder: 'Relevant clinical information...' },
				],
			},
		],
	},
	procedures: {
		tabKey: 'procedures',
		sections: [
			{
				key: 'proc', title: 'Procedure', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'procedureName', label: 'Procedure Name', type: 'text', required: true, placeholder: 'Procedure name' },
					{ key: 'cptCode', label: 'CPT Code', type: 'code-search', placeholder: 'Search CPT code', lookupConfig: { system: 'CPT' }, relatedField: 'procedureName' },
					{ key: 'performedDateTime', label: 'Date Performed', type: 'date', required: true }, // key matches backend so overlay promotes datetime→date (auto-closing picker) — issue 10
					{ key: 'performerId', label: 'Performer', type: 'practitioner-search', placeholder: 'Search Performer' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'In Progress', value: 'in-progress' },
							{ label: 'Completed', value: 'completed' },
							{ label: 'Cancelled', value: 'cancelled' },
						]
					},
					{ key: 'reason', label: 'Reason', type: 'text', placeholder: 'Reason for procedure' },
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	insurance: {
		tabKey: 'insurance',
		// Field set mirrors the reference EHR-UI insurance-coverage tab_field_config
		// (ciyex V44__insurance_coverage_enhanced.sql): exactly two sections —
		// Policy Information + Subscriber Information. The earlier desktop form had
		// 5 extra sections (Insurance Company, Claims Address, Financial
		// Responsibility, Payer Contact & Claims, Insurance Card Images) that the
		// web app never shows; QA issue 11 asked for the form to match the
		// reference, so those extra sections were removed and copayAmount folded
		// back into Policy Information where the reference keeps it.
		sections: [
			{
				key: 'policy-info', title: 'Policy Information', columns: 3, visible: true, collapsible: false, fields: [
					{
						key: 'insuranceType', label: 'Insurance Tier', type: 'select', required: true, options: [
							{ label: 'Primary', value: 'primary' },
							{ label: 'Secondary', value: 'secondary' },
							{ label: 'Tertiary', value: 'tertiary' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Inactive', value: 'inactive' },
						]
					},
					// Issue #7a: searchable payer typeahead (matches ciyex-ehr-ui GenericFhirTab,
					// which rewrites the insurance payerName field to a /api/insurance-companies
					// lookup). valueField:'name' stores the company name so the existing payerName
					// text semantics (and FHIR payor.display mapping) are preserved.
					{ key: 'payerName', label: 'Insurance Company / Payer', type: 'lookup', required: true, placeholder: 'Search insurance company...', lookupConfig: { endpoint: '/api/insurance-companies', displayField: 'name', valueField: 'name', searchable: true } },
					{ key: 'planName', label: 'Plan Name', type: 'text', placeholder: 'e.g. Blue Cross PPO Gold' },
					{
						key: 'policyType', label: 'Plan Type', type: 'select', options: [
							{ label: 'HMO', value: 'HMO' },
							{ label: 'PPO', value: 'PPO' },
							{ label: 'EPO', value: 'EPO' },
							{ label: 'POS', value: 'POS' },
							{ label: 'HDHP', value: 'HDHP' },
							{ label: 'Medicare', value: 'Medicare' },
							{ label: 'Medicaid', value: 'Medicaid' },
							{ label: 'TRICARE', value: 'Tricare' },
							// allow-any-unicode-next-line
							{ label: 'Workers’ Comp', value: 'Workers-Comp' },
							{ label: 'Other', value: 'Other' },
						]
					},
					// Member IDs are catalog identifiers — letters, digits and hyphens
					// only. Without this pattern the field accepted any special
					// characters and saved unvalidated (QA issue 6).
					{ key: 'policyNumber', label: 'Policy / Member ID', type: 'text', required: true, placeholder: 'Member ID', validationPattern: '^[A-Za-z0-9][A-Za-z0-9\\-]{2,24}$', validationMessage: 'Policy / Member ID must be 3-25 characters — letters, numbers and hyphens only' },
					{ key: 'groupNumber', label: 'Group Number', type: 'text', placeholder: 'Group #' },
					{ key: 'copayAmount', label: 'Copay Amount', type: 'text', placeholder: '$0.00' },
					{ key: 'policyEffectiveDate', label: 'Effective Date', type: 'date' },
					{ key: 'policyEndDate', label: 'End Date', type: 'date' },
				],
			},
			{
				key: 'subscriber-info', title: 'Subscriber Information', columns: 3, visible: true, collapsible: true, collapsed: false, fields: [
					{
						key: 'subscriberRelationship', label: 'Relationship to Patient', type: 'select', required: true, options: [
							{ label: 'Self (Patient is Subscriber)', value: 'self' },
							{ label: 'Spouse', value: 'spouse' },
							{ label: 'Child', value: 'child' },
							{ label: 'Parent', value: 'parent' },
							{ label: 'Other', value: 'other' },
						]
					},
					{ key: 'subscriberFirstName', label: 'Subscriber First Name', type: 'text', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
					{ key: 'subscriberLastName', label: 'Subscriber Last Name', type: 'text', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
					{ key: 'subscriberDOB', label: 'Subscriber Date of Birth', type: 'date', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
					{
						key: 'subscriberGender', label: 'Subscriber Sex', type: 'select', showWhen: { field: 'subscriberRelationship', notEquals: 'self' }, options: [
							{ label: 'Male', value: 'male' },
							{ label: 'Female', value: 'female' },
							{ label: 'Other', value: 'other' },
						]
					},
					{ key: 'subscriberSSN', label: 'Subscriber SSN', type: 'text', placeholder: 'XXX-XX-XXXX', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
					{ key: 'subscriberPhone', label: 'Subscriber Phone', type: 'phone', placeholder: '(555) 123-4567', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
					{ key: 'subscriberAddress', label: 'Subscriber Address', type: 'text', colSpan: 2, placeholder: 'Full address', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
					{ key: 'subscriberEmployer', label: 'Subscriber Employer', type: 'text', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
				],
			},
		],
	},
	documents: {
		tabKey: 'documents',
		sections: [
			{
				key: 'details', title: 'Document Details', columns: 3, visible: true, collapsible: false, fields: [
					{ key: 'description', label: 'Document Name', type: 'text', required: true, placeholder: 'e.g., Lab Report, Consent Form' },
					{
						key: 'type', label: 'Document Type', type: 'select', required: true, options: [
							{ label: 'Clinical Note', value: 'clinical-note' },
							{ label: 'Lab Report', value: 'lab-report' },
							{ label: 'Imaging Report', value: 'imaging-report' },
							{ label: 'Referral', value: 'referral' },
							{ label: 'Prescription', value: 'prescription' },
							{ label: 'Discharge Summary', value: 'discharge-summary' },
							{ label: 'Consent Form', value: 'consent-form' },
							{ label: 'Insurance Card', value: 'insurance-card' },
							{ label: 'ID Document', value: 'id-document' },
							{ label: 'Other', value: 'other' },
						]
					},
					{
						key: 'category', label: 'Category', type: 'select', options: [
							{ label: 'Clinical', value: 'clinical' },
							{ label: 'Administrative', value: 'administrative' },
							{ label: 'Insurance', value: 'insurance' },
							{ label: 'Legal', value: 'legal' },
							{ label: 'Other', value: 'other' },
						]
					},
					{ key: 'date', label: 'Document Date', type: 'date', required: true },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Current', value: 'current' },
							{ label: 'Superseded', value: 'superseded' },
							{ label: 'Entered in Error', value: 'entered-in-error' },
						]
					},
					{ key: 'authorName', label: 'Author / Provider', type: 'practitioner-search', placeholder: 'Search Author' },
					{ key: 'encounterId', label: 'Encounter ID', type: 'text', placeholder: 'Optional' },
					// Single attachment input — local file picker reads the file as a
					// base64 data URL and stores it in `attachment`. The previous form
					// also exposed a `fileUrl` text box, which the test team flagged as
					// a duplicate attachment field on the Documents Add New page.
					// The backend's DocumentReference accepts inline `attachment` content
					// directly, so the URL fallback isn't needed for the common path.
					{ key: 'attachment', label: 'Attachment', type: 'file', placeholder: 'Choose file to upload', colSpan: 3, localOnly: true },
					{
						key: 'contentType', label: 'Content Type', type: 'select', options: [
							{ label: 'PDF', value: 'application/pdf' },
							{ label: 'Image (PNG)', value: 'image/png' },
							{ label: 'Image (JPEG)', value: 'image/jpeg' },
							{ label: 'Word', value: 'application/msword' },
							{ label: 'Text', value: 'text/plain' },
						]
					},
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Enter your message', colSpan: 3 },
				],
			},
		],
	},
	education: {
		tabKey: 'education',
		sections: [
			{
				key: 'details', title: 'Patient Education', columns: 2, visible: true, collapsible: false, fields: [
					// Topic / Title is a free-text input — the user types the topic
					// directly instead of picking from an existing-material dropdown.
					// The save handler (tab.key === 'education') turns the typed title
					// into an EducationMaterial (POST /api/education/materials) and
					// assigns the resulting id, since /api/education/assignments
					// requires a real materialId FK.
					{ key: 'materialTitle', label: 'Topic / Title', type: 'text', required: true, placeholder: 'Enter topic / title…' },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Select Status…', value: '' },
							{ label: 'Assigned', value: 'assigned' },
							{ label: 'Viewed', value: 'viewed' },
							{ label: 'Completed', value: 'completed' },
							{ label: 'Dismissed', value: 'dismissed' },
						]
					},
					{
						key: 'category', label: 'Category', type: 'select', options: [
							{ label: 'Select Category…', value: '' },
							{ label: 'Disease Management', value: 'disease-management' },
							{ label: 'Medication', value: 'medication' },
							{ label: 'Procedure', value: 'procedure' },
							{ label: 'Wellness', value: 'wellness' },
							{ label: 'Nutrition', value: 'nutrition' },
							{ label: 'Post-Op Care', value: 'post-op' },
							{ label: 'Other', value: 'other' },
						]
					},
					{ key: 'dateProvided', label: 'Date Provided', type: 'date', defaultValue: () => new Date().toISOString().slice(0, 10) },
					{
						key: 'deliveryMethod', label: 'Delivery Method', type: 'select', options: [
							{ label: 'Select Delivery Method…', value: '' },
							{ label: 'In Person', value: 'in_person' },
							{ label: 'Written', value: 'written' },
							{ label: 'Video', value: 'video' },
							{ label: 'Online', value: 'online' },
							{ label: 'Phone', value: 'phone' },
						]
					},
					// `educator` stores the selected provider id; `relatedField`
					// captures the chosen display NAME into the `educatorName`
					// companion field so the save payload carries both and the
					// list shows a name (not a bare id) — same pattern as the
					// medications Prescriber field.
					{ key: 'educator', label: 'Educator', type: 'search', placeholder: 'Search educator…', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'], relatedField: 'educatorName' },
					{ key: 'content', label: 'Content / Summary', type: 'textarea', placeholder: 'Enter content / summary…', colSpan: 2 },
					// URL link to the education material (matches the reference EHR UI).
					// localOnly so it's appended even when the backend tab_field_config
					// drives the form and omits this field.
					{ key: 'url', label: 'URL Link', type: 'text', placeholder: 'https://… (link to material)', colSpan: 2, localOnly: true },
					{ key: 'reasonCondition', label: 'Reason / Condition', type: 'text', placeholder: 'Enter reason / condition…' },
					{
						key: 'language', label: 'Language', type: 'select', options: [
							{ label: 'Select Language…', value: '' },
							{ label: 'English', value: 'english' },
							{ label: 'Spanish', value: 'spanish' },
							{ label: 'French', value: 'french' },
							{ label: 'Mandarin', value: 'mandarin' },
							{ label: 'Arabic', value: 'arabic' },
							{ label: 'Other', value: 'other' },
						]
					},
					{
						key: 'readingLevel', label: 'Reading Level', type: 'select', options: [
							{ label: 'Select Reading Level…', value: '' },
							{ label: 'Easy Read', value: 'easy_read' },
							{ label: 'Standard', value: 'standard' },
							{ label: 'Advanced', value: 'advanced' },
						]
					},
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes…', colSpan: 2 },
				],
			},
		],
	},
	// Field keys must match the backend tab_field_config (V107) Communication
	// FHIR mapping exactly: subject / message / sender / recipient / sent /
	// priority / status. The previous local config used recipientName, senderName,
	// sentAt and content, which the backend's FhirPathMapper couldn't resolve —
	// the create silently dropped those values, leaving HAPI to reject the empty
	// Communication with a "given id must not be null" error from the missing
	// subject/payload references.
	messaging: {
		tabKey: 'messaging',
		sections: [
			{
				key: 'details', title: 'Message', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'subject', label: 'Subject', type: 'text', required: true, colSpan: 2, placeholder: 'Message subject' },
					{ key: 'message', label: 'Message', type: 'textarea', required: true, placeholder: 'Enter your message', colSpan: 2 },
					{ key: 'sender', label: 'From', type: 'text', placeholder: 'Sender name' },
					// To: defaults to the current patient's name on a fresh form
					// (see _seedMessagingRecipient hook in _renderForm). Fixes the
					// test team's "To patient field is default which is login" ask.
					{ key: 'recipient', label: 'To (Patient)', type: 'text', placeholder: 'Recipient name' },
					{ key: 'sent', label: 'Sent Date', type: 'date' },
					{
						key: 'priority', label: 'Priority', type: 'select', options: [
							{ label: 'Routine', value: 'routine' },
							{ label: 'Urgent', value: 'urgent' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Draft', value: 'preparation' },
							{ label: 'In Progress', value: 'in-progress' },
							{ label: 'Completed', value: 'completed' },
						]
					},
					// Channel mirrors the EHR-UI's "Send Via" footer (in-app /
					// email / SMS) so the workspace can drive the same dispatch
					// flow once the backend hooks the medium field.
					{
						key: 'medium', label: 'Send Via', type: 'select', colSpan: 2, localOnly: true, options: [
							{ label: 'In-App Message', value: 'app' },
							{ label: 'Email', value: 'email' },
							{ label: 'SMS / Text', value: 'sms' },
						]
					},
				],
			},
		],
	},
	relationships: {
		tabKey: 'relationships',
		sections: [
			{
				key: 'details', title: 'Related Person', columns: 3, visible: true, collapsible: false, fields: [
					{
						key: 'firstName', label: 'First Name', type: 'text', required: true, placeholder: 'First name',
						validationPattern: '^[A-Za-z][A-Za-z\'\\- ]{0,49}$',
						validationMessage: 'First name must start with a letter and contain only letters, spaces, apostrophes or hyphens',
					},
					{
						key: 'lastName', label: 'Last Name', type: 'text', required: true, placeholder: 'Last name',
						validationPattern: '^[A-Za-z][A-Za-z\'\\- ]{0,49}$',
						validationMessage: 'Last name must start with a letter and contain only letters, spaces, apostrophes or hyphens',
					},
					{
						key: 'relationship', label: 'Relationship', type: 'select', required: true, options: [
							{ label: 'Spouse', value: 'spouse' },
							{ label: 'Parent', value: 'parent' },
							{ label: 'Child', value: 'child' },
							{ label: 'Sibling', value: 'sibling' },
							{ label: 'Guardian', value: 'guardian' },
							{ label: 'Domestic Partner', value: 'partner' },
							{ label: 'Grandparent', value: 'grandparent' },
							{ label: 'Grandchild', value: 'grandchild' },
							{ label: 'Friend', value: 'friend' },
							{ label: 'Other', value: 'other' },
						]
					},
					{
						key: 'gender', label: 'Gender', type: 'select', options: [
							{ label: 'Male', value: 'Male' },
							{ label: 'Female', value: 'Female' },
							{ label: 'Other', value: 'Other' },
							{ label: 'Unknown', value: 'Unknown' },
						]
					},
					{ key: 'birthDate', label: 'Date of Birth', type: 'date' },
					// Emergency Contact toggle moved before Phone (per the test
					// team spec) — it's the most common reason to capture a
					// related person's number, so the toggle reads first.
					{ key: 'emergencyContact', label: 'Emergency Contact', type: 'boolean' },
					{
						key: 'phoneNumber', label: 'Phone', type: 'phone', placeholder: '(555) 123-4567',
						// US phone: 10 digits, optional leading +1, with "()", "-", "." or
						// space separators. Rejects letters / wrong-length numbers.
						validationPattern: '^\\+?1?[\\s().\\-]*(?:\\d[\\s().\\-]*){10}$',
						validationMessage: 'Enter a valid 10-digit US phone number, e.g. (555) 123-4567',
					},
					{
						key: 'email', label: 'Email', type: 'email', placeholder: 'name@example.com',
						validationPattern: '^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$',
						validationMessage: 'Enter a valid email address',
					},
					{ key: 'address', label: 'Address', type: 'textarea', colSpan: 2 },
					{ key: 'active', label: 'Active', type: 'boolean' },
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes', colSpan: 3 },
				],
			},
		],
	},
	// Appointment field keys align with the V58 backend tab_field_config
	// (Appointment FHIR mapping): appointmentType / status / room / priority /
	// start / end / minutesDuration / reason / description / patient /
	// provider / location. Earlier local keys (type / date / endDate /
	// duration) didn't match, so the overlay never promoted backend's plain
	// text inputs to selects — which is why the test team saw "visit type
	// drop down not working / not listed". `endDate`/`duration` were also
	// being appended as localOnly duplicates next to backend's start/end/
	// minutesDuration, producing the "duplicate start time and end time"
	// complaint.
	appointments: {
		tabKey: 'appointments',
		sections: [
			{
				key: 'appt', title: 'Appointment Details', columns: 2, visible: true, collapsible: false, fields: [
					{
						key: 'appointmentType', label: 'Visit Type', type: 'select', required: true, options: [
							{ label: 'Consultation', value: 'Consultation' },
							{ label: 'New Patient', value: 'New Patient' },
							{ label: 'Follow-Up', value: 'Follow-up' },
							{ label: 'Annual Physical', value: 'Annual Physical' },
							{ label: 'Sick Visit', value: 'Sick Visit' },
							{ label: 'Telehealth', value: 'Telehealth' },
							{ label: 'Procedure', value: 'Procedure' },
							{ label: 'Lab Work', value: 'Lab Work' },
						]
					},
					{
						key: 'priority', label: 'Priority', type: 'select', options: [
							{ label: 'Routine', value: 'routine' },
							{ label: 'Urgent', value: 'urgent' },
							{ label: 'ASAP', value: 'asap' },
							{ label: 'STAT', value: 'stat' },
						]
					},
					{ key: 'start', label: 'Start Date/Time', type: 'datetime', required: true },
					{ key: 'end', label: 'End Date/Time', type: 'datetime', required: true },
					{ key: 'minutesDuration', label: 'Duration (min)', type: 'number', placeholder: 'Auto-calculated from start/end' },
					{ key: 'provider', label: 'Provider', type: 'practitioner-search', placeholder: 'Search Provider', required: true },
					{ key: 'location', label: 'Location', type: 'lookup', placeholder: 'Search Location', required: true, lookupConfig: { endpoint: '/api/locations', searchable: true } },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Scheduled', value: 'booked' },
							{ label: 'Confirmed', value: 'pending' },
							{ label: 'Arrived', value: 'arrived' },
							{ label: 'Checked In', value: 'checked-in' },
							{ label: 'Fulfilled', value: 'fulfilled' },
							{ label: 'Cancelled', value: 'cancelled' },
							{ label: 'No Show', value: 'noshow' },
						]
					},
					{ key: 'reason', label: 'Reason / Chief Complaint', type: 'textarea', colSpan: 2, placeholder: 'e.g., chest discomfort for 2 days' },
				],
			},
		],
	},
	'visit-notes': {
		tabKey: 'visit-notes',
		sections: [
			{
				key: 'note', title: 'Visit Note', columns: 2, visible: true, collapsible: false, fields: [
					{
						key: 'type', label: 'Note Type', type: 'select', required: true, options: [
							{ label: 'Progress Note', value: 'progress-note' },
							{ label: 'Consult Note', value: 'consult-note' },
							{ label: 'Discharge Summary', value: 'discharge-summary' },
							{ label: 'History & Physical', value: 'history-and-physical' },
							{ label: 'Procedure Note', value: 'procedure-note' },
						]
					},
					{ key: 'date', label: 'Visit Date', type: 'date', required: true },
					// Field key matches the backend visit-notes tab_field_config
					// (`author`). The previous local key `authorId` never matched
					// the overlay map, so the backend's plain text input was used
					// and the test team flagged the search as not working.
					{ key: 'author', label: 'Author', type: 'practitioner-search', placeholder: 'Search Author' },
					{
						// `mergeOptions`: the backend visit-notes tab_field_config ships
						// only Current/Superseded/Entered in Error, but the signing
						// workflow the list/table renders also needs Signed/Unsigned
						// (+ Amended). Union them so the create/edit form offers all of
						// them instead of the backend set alone (QA: add Sign/Unsign).
						key: 'status', label: 'Status', type: 'select', mergeOptions: true, options: [
							{ label: 'Unsigned', value: 'unsigned' },
							{ label: 'Signed', value: 'signed' },
							{ label: 'Amended', value: 'amended' },
							{ label: 'Entered in Error', value: 'entered-in-error' },
						]
					},
					{ key: 'subject', label: 'Subject / Title', type: 'text', colSpan: 2, placeholder: 'Brief subject line' },
					{ key: 'content', label: 'Note Content', type: 'textarea', colSpan: 2, placeholder: 'Enter the visit note...' },
				],
			},
		],
	},
	facility: {
		tabKey: 'facility',
		sections: [
			{
				key: 'details', title: 'Facility / Location', columns: 3, visible: true, collapsible: false, fields: [
					{ key: 'name', label: 'Facility Name', type: 'text', required: true, placeholder: 'e.g., Main Clinic, Hospital East Wing' },
					{
						key: 'type', label: 'Facility Type', type: 'select', required: true, options: [
							{ label: 'Clinic', value: 'clinic' },
							{ label: 'Hospital', value: 'hospital' },
							{ label: 'Laboratory', value: 'laboratory' },
							{ label: 'Imaging Center', value: 'imaging' },
							{ label: 'Pharmacy', value: 'pharmacy' },
							{ label: 'Urgent Care', value: 'urgent-care' },
							{ label: 'Specialty', value: 'specialty' },
							{ label: 'Home Health', value: 'home-health' },
							{ label: 'Other', value: 'other' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Inactive', value: 'inactive' },
							{ label: 'Suspended', value: 'suspended' },
						]
					},
					{
						key: 'phone', label: 'Phone', type: 'phone', placeholder: '(555) 123-4567',
						// US phone: 10 digits, optional leading +1, with common separators.
						validationPattern: '^\\+?1?[\\s().\\-]*(?:\\d[\\s().\\-]*){10}$',
						validationMessage: 'Enter a valid 10-digit US phone number, e.g. (555) 123-4567',
					},
					{
						key: 'fax', label: 'Fax', type: 'phone', placeholder: '(555) 123-4567',
						validationPattern: '^\\+?1?[\\s().\\-]*(?:\\d[\\s().\\-]*){10}$',
						validationMessage: 'Enter a valid 10-digit US fax number, e.g. (555) 123-4567',
					},
					{
						key: 'email', label: 'Email', type: 'email', placeholder: 'name@example.com',
						validationPattern: '^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$',
						validationMessage: 'Enter a valid email address',
					},
					{ key: 'address', label: 'Address', type: 'textarea', colSpan: 2 },
					{ key: 'zipCode', label: 'ZIP Code', type: 'text' },
					{ key: 'city', label: 'City', type: 'text' },
					{ key: 'state', label: 'State', type: 'text' },
					{ key: 'country', label: 'Country', type: 'text' },
					{ key: 'primaryContactName', label: 'Primary Contact', type: 'text' },
					{ key: 'npi', label: 'NPI', type: 'text', placeholder: 'National Provider Identifier' },
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Enter your message', colSpan: 3 },
				],
			},
		],
	},
	issues: {
		tabKey: 'issues',
		sections: [
			{
				key: 'issue', title: 'Issue', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'conditionName', label: 'Issue Name', type: 'text', required: true, placeholder: 'Issue name' },
					{ key: 'icdCode', label: 'ICD-10 Code', type: 'code-search', placeholder: 'Search ICD-10 codes', lookupConfig: { system: 'ICD10_CM' }, relatedField: 'conditionName' },
					{
						key: 'severity', label: 'Severity', type: 'select', options: [
							{ label: 'Mild', value: 'mild' },
							{ label: 'Moderate', value: 'moderate' },
							{ label: 'Severe', value: 'severe' },
						]
					},
					{
						key: 'clinicalStatus', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Recurrence', value: 'recurrence' },
							{ label: 'Relapse', value: 'relapse' },
							{ label: 'Inactive', value: 'inactive' },
							{ label: 'Resolved', value: 'resolved' },
						]
					},
					{ key: 'onsetDate', label: 'Onset Date', type: 'date' },
					{ key: 'recordedDate', label: 'Recorded Date', type: 'date', defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	report: {
		tabKey: 'report',
		sections: [
			{
				key: 'report', title: 'Diagnostic Report', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'testName', label: 'Report Name', type: 'text', required: true, placeholder: 'Report title' },
					{ key: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Radiology' },
					{ key: 'effectiveDate', label: 'Effective Date', type: 'date', required: true },
					{ key: 'providerId', label: 'Provider', type: 'practitioner-search', placeholder: 'Search Provider' },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Registered', value: 'registered' },
							{ label: 'Partial', value: 'partial' },
							{ label: 'Preliminary', value: 'preliminary' },
							{ label: 'Final', value: 'final' },
							{ label: 'Amended', value: 'amended' },
							{ label: 'Cancelled', value: 'cancelled' },
						]
					},
					{ key: 'conclusion', label: 'Conclusion', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	// Payment field keys match the V107 backend `payments` tab_field_config
	// (payment / amount / method / reference / status / note). The previous
	// keys (paymentMethod / totalAmount / referenceNumber) didn't match and
	// the overlay appended them as duplicates while leaving the backend's
	// plain text inputs in place.
	payment: {
		tabKey: 'payment',
		// Mirrors the EHR Web UI Post Payment / Collect Payment form. Fields
		// are grouped into Payment Information (always visible) and
		// Allocation & Adjustments (the line-item breakdown the test team
		// flagged as missing in the workspace). Status defaults to 'completed'
		// because both Post Payment and Collect Payment workflows record an
		// applied payment.
		sections: [
			{
				key: 'payment', title: 'Payment Information', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'paymentDate', label: 'Payment Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'dateOfService', label: 'Date of Service', type: 'date' },
					{
						key: 'paymentMethod', label: 'Payment Method', type: 'select', required: true, options: [
							{ label: 'Credit Card', value: 'credit_card' },
							{ label: 'Debit Card', value: 'debit_card' },
							{ label: 'Bank Account', value: 'bank_account' },
							{ label: 'FSA', value: 'fsa' },
							{ label: 'HSA', value: 'hsa' },
							{ label: 'Cash', value: 'cash' },
							{ label: 'Check', value: 'check' },
							{ label: 'EFT/ACH', value: 'eft' },
							{ label: 'Insurance Payment', value: 'insurance' },
							{ label: 'ERA / Remittance', value: 'era' },
							{ label: 'Patient Copay', value: 'patient_copay' },
							{ label: 'Patient Coinsurance', value: 'patient_coinsurance' },
							{ label: 'Patient Deductible', value: 'patient_deductible' },
							{ label: 'Patient Self-Pay', value: 'patient_self_pay' },
							{ label: 'Other', value: 'other' },
						], defaultValue: 'credit_card'
					},
					{ key: 'amount', label: 'Total Amount', type: 'number', required: true, placeholder: '0.00', validationPattern: '^\\d+(\\.\\d+)?$', validationMessage: 'Total Amount must be a non-negative number' },
					{ key: 'reference', label: 'Reference / Check #', type: 'text', placeholder: 'Optional' },
					{ key: 'payerName', label: 'Payer / Insurance', type: 'text', placeholder: 'Aetna, BCBS, patient self...' },
					{ key: 'claimId', label: 'Apply to Claim', type: 'lookup', placeholder: 'Search claim by number', lookupConfig: { endpoint: '/api/fhir-resource/claims', valueField: 'id', displayField: 'identifier' } },
					// Reference Type + Description + Receipt Email mirror the EHR
					// CollectPaymentModal — the test team's screenshot listed them
					// as missing from the desktop dialog.
					{
						key: 'referenceType', label: 'Reference Type', type: 'select', options: [
							{ label: 'Encounter', value: 'encounter' },
							{ label: 'Claim', value: 'claim' },
							{ label: 'Invoice', value: 'invoice' },
							{ label: 'Copay', value: 'copay' },
							{ label: 'Deductible', value: 'deductible' },
							{ label: 'Self Pay', value: 'self_pay' },
							{ label: 'Other', value: 'other' },
						]
					},
					{ key: 'invoiceNumber', label: 'Invoice Number', type: 'text', placeholder: 'INV-001' },
					{ key: 'description', label: 'Description', type: 'text', placeholder: 'Payment for visit...' },
					{ key: 'receiptEmail', label: 'Receipt Email', type: 'email', placeholder: 'patient@email.com' },
					{
						// Status options are the PaymentTransaction statuses the backend
						// accepts. The previous options were INVOICE statuses (Posted /
						// Draft / Balanced) — a transaction PUT rejects those, so the
						// snapshot silently swapped whatever the user picked back to
						// "completed" and the edit never stuck (QA issue 8).
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Completed', value: 'completed' },
							{ label: 'Pending', value: 'pending' },
							{ label: 'Processing', value: 'processing' },
							{ label: 'Failed', value: 'failed' },
							{ label: 'Refunded', value: 'refunded' },
							{ label: 'Voided', value: 'voided' },
							{ label: 'Cancelled', value: 'cancelled' },
						], defaultValue: 'completed'
					},
				],
			},
			{
				key: 'allocation', title: 'Allocation & Adjustments', columns: 2, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'allowedAmount', label: 'Allowed Amount', type: 'number', placeholder: '0.00', validationPattern: '^\\d+(\\.\\d+)?$', validationMessage: 'Allowed Amount must be a non-negative number' },
					{ key: 'paidAmount', label: 'Paid Amount', type: 'number', placeholder: '0.00', validationPattern: '^\\d+(\\.\\d+)?$', validationMessage: 'Paid Amount must be a non-negative number' },
					{ key: 'adjustmentAmount', label: 'Adjustment Amount', type: 'number', placeholder: '0.00', validationPattern: '^\\d+(\\.\\d+)?$', validationMessage: 'Adjustment Amount must be a non-negative number' },
					{
						key: 'adjustmentReason', label: 'Adjustment Reason', type: 'select', options: [
							{ label: 'None', value: '' },
							{ label: 'CO-45 — Contractual Obligation', value: 'CO-45' },
							{ label: 'PR-1 — Patient Deductible', value: 'PR-1' },
							{ label: 'PR-2 — Patient Coinsurance', value: 'PR-2' },
							{ label: 'PR-3 — Patient Copay', value: 'PR-3' },
							{ label: 'CO-97 — Bundled', value: 'CO-97' },
							{ label: 'OA-23 — Prior Payer Adjustment', value: 'OA-23' },
							{ label: 'CO-50 — Not Medically Necessary', value: 'CO-50' },
							{ label: 'Other', value: 'OTHER' },
						]
					},
					{ key: 'patientResponsibility', label: 'Patient Responsibility', type: 'number', placeholder: '0.00', validationPattern: '^\\d+(\\.\\d+)?$', validationMessage: 'Patient Responsibility must be a non-negative number' },
					{ key: 'remainingBalance', label: 'Remaining Balance', type: 'number', placeholder: '0.00', validationPattern: '^\\d+(\\.\\d+)?$', validationMessage: 'Remaining Balance must be a non-negative number' },
					{ key: 'eraReference', label: 'ERA / EFT Reference', type: 'text', placeholder: 'Optional ERA trace #' },
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Enter notes...', colSpan: 2 },
				],
			},
		],
	},
	statements: {
		tabKey: 'statements',
		// Mirrors the EHR Web UI StatementsTab — the test team flagged the
		// workspace form as "completely different from the web." Fields now
		// match the web app's New Statement modal: Statement Number,
		// Statement Date, Period, Balance summary, Status, Notes, etc.
		sections: [
			{
				key: 'statement', title: 'Statement Information', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'statementNumber', label: 'Statement Number', type: 'text', placeholder: 'STM-2026-0001', required: true },
					{ key: 'statementDate', label: 'Statement Date', type: 'date', required: true, placeholder: 'mm/dd/yyyy', defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'periodStart', label: 'Period Start', type: 'date' },
					{ key: 'periodEnd', label: 'Period End', type: 'date' },
					{ key: 'dueDate', label: 'Due Date', type: 'date' },
					{ key: 'invoiceNumber', label: 'Invoice Number', type: 'text', placeholder: 'Linked invoice...', validationPattern: '^[A-Za-z0-9][A-Za-z0-9-]*$', validationMessage: 'Invoice Number may contain only letters, numbers, and hyphens' },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Draft', value: 'draft' },
							{ label: 'Sent', value: 'sent' },
							{ label: 'Paid', value: 'paid' },
							{ label: 'Overdue', value: 'overdue' },
							{ label: 'Voided', value: 'voided' },
						], defaultValue: 'draft'
					},
					{ key: 'recipient', label: 'Recipient', type: 'text', placeholder: 'Patient or guarantor name' },
				],
			},
			{
				key: 'amounts', title: 'Balance Summary', columns: 3, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'totalCharges', label: 'Total Charges', type: 'number', placeholder: '0.00' },
					{ key: 'totalPayments', label: 'Total Payments', type: 'number', placeholder: '0.00' },
					{ key: 'totalAdjustments', label: 'Total Adjustments', type: 'number', placeholder: '0.00' },
					{ key: 'insuranceBalance', label: 'Insurance Balance', type: 'number', placeholder: '0.00' },
					{ key: 'patientBalance', label: 'Patient Balance', type: 'number', placeholder: '0.00' },
					{ key: 'balance', label: 'Balance Due', type: 'number', required: true, placeholder: '0.00' },
				],
			},
			{
				key: 'meta', title: 'Additional Details', columns: 2, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'issuer', label: 'Issuer', type: 'text', placeholder: 'Practice name' },
					{
						key: 'deliveryMethod', label: 'Delivery Method', type: 'select', options: [
							{ label: 'Mail', value: 'mail' },
							{ label: 'Email', value: 'email' },
							{ label: 'Patient Portal', value: 'portal' },
							{ label: 'Hand Delivered', value: 'hand' },
						]
					},
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Enter notes...', colSpan: 2 },
				],
			},
		],
	},
	transactions: {
		tabKey: 'transactions',
		sections: [
			{
				key: 'tx', title: 'Transaction', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'transactionDate', label: 'Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
					{
						key: 'transactionType', label: 'Type', type: 'select', required: true, options: [
							{ label: 'Charge', value: 'charge' },
							{ label: 'Payment', value: 'payment' },
							{ label: 'Adjustment', value: 'adjustment' },
							{ label: 'Refund', value: 'refund' },
							{ label: 'Write-off', value: 'write-off' },
						]
					},
					{ key: 'totalAmount', label: 'Amount', type: 'number', required: true, placeholder: '0.00' },
					{ key: 'referenceNumber', label: 'Reference', type: 'text', placeholder: 'Optional' },
					{ key: 'description', label: 'Description', type: 'text', placeholder: 'Short description' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Posted', value: 'posted' },
							{ label: 'Pending', value: 'pending' },
							{ label: 'Voided', value: 'voided' },
						]
					},
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	billing: {
		tabKey: 'billing',
		sections: [
			{
				key: 'billing', title: 'Billing', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'serviceDate', label: 'Service Date', type: 'date', required: true },
					{ key: 'cptCode', label: 'CPT Code', type: 'code-search', placeholder: 'Search CPT codes', lookupConfig: { system: 'CPT' } },
					{ key: 'icdCode', label: 'Diagnosis (ICD-10)', type: 'code-search', placeholder: 'Search ICD-10 codes', lookupConfig: { system: 'ICD10_CM' } },
					{ key: 'totalAmount', label: 'Charge Amount', type: 'number', required: true, placeholder: '0.00' },
					{ key: 'providerId', label: 'Provider', type: 'practitioner-search', placeholder: 'Search Provider' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Cancelled', value: 'cancelled' },
							{ label: 'Draft', value: 'draft' },
							{ label: 'Entered in Error', value: 'entered-in-error' },
						]
					},
				],
			},
		],
	},
	claims: {
		tabKey: 'claims',
		sections: [
			{
				key: 'claim-info', title: 'Claim Information', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'identifier', label: 'Claim Number', type: 'text', placeholder: 'Auto-assigned if blank' },
					{ key: 'serviceDate', label: 'Service Date', type: 'date', required: true },
					{
						key: 'type', label: 'Type', type: 'select', options: [
							{ label: 'Institutional', value: 'institutional' },
							{ label: 'Professional', value: 'professional' },
							{ label: 'Pharmacy', value: 'pharmacy' },
							{ label: 'Vision', value: 'vision' },
							{ label: 'Oral', value: 'oral' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Submitted', value: 'submitted' },
							{ label: 'Paid', value: 'paid' },
							{ label: 'Denied', value: 'denied' },
							{ label: 'Cancelled', value: 'cancelled' },
						]
					},
					{ key: 'totalAmount', label: 'Total Charge', type: 'number', required: true, placeholder: '0.00' },
					{ key: 'providerId', label: 'Billing Provider', type: 'practitioner-search', placeholder: 'Search Billing Provider' },
					{ key: 'facilityId', label: 'Facility', type: 'lookup', placeholder: 'Search facility', lookupConfig: { endpoint: '/api/locations', searchable: true } },
					{ key: 'payerId', label: 'Payer / Insurer', type: 'lookup', placeholder: 'Search payer', lookupConfig: { endpoint: '/api/fhir-resource/insurance-companies', valueField: 'id', displayField: 'name' } },
				],
			},
			{
				key: 'diagnosis', title: 'Diagnosis', columns: 2, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'primaryDiagnosis', label: 'Primary Diagnosis', type: 'code-search', placeholder: 'Search ICD-10 codes', lookupConfig: { system: 'ICD10_CM' } },
					{ key: 'secondaryDiagnosis', label: 'Secondary', type: 'code-search', placeholder: 'Search ICD-10 codes', lookupConfig: { system: 'ICD10_CM' } },
					{ key: 'tertiaryDiagnosis', label: 'Tertiary', type: 'code-search', placeholder: 'Search ICD-10 codes', lookupConfig: { system: 'ICD10_CM' } },
					{ key: 'quaternaryDiagnosis', label: 'Quaternary', type: 'code-search', placeholder: 'Search ICD-10 codes', lookupConfig: { system: 'ICD10_CM' } },
				],
			},
		],
	},
	// Denials mirror the EHR-UI's claim-denials tab_field_config (ciyex V17 +
	// V140/V141): a FHIR ClaimResponse with Denial Information, Adjudication
	// Summary, and Process Notes sections. Field keys MUST match the backend
	// claim-denials config — the workspace routes saves through TAB_API_SLUG
	// 'denials' → 'claim-denials' and the backend FhirPathMapper resolves these
	// keys onto ClaimResponse paths (status, outcome, disposition, created,
	// insurer, request, preAuthRef, use, type, total[*], payment.*, processNote).
	denials: {
		tabKey: 'denials',
		sections: [
			{
				key: 'denial', title: 'Denial Information', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'identifier', label: 'Claim Number', type: 'text', required: true, placeholder: 'Original claim #' },
					{ key: 'serviceDate', label: 'Service Date', type: 'date' },
					{ key: 'denialDate', label: 'Denial Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'denialReason', label: 'Denial Reason', type: 'text', required: true, placeholder: 'CARC / RARC code or text' },
					{ key: 'totalAmount', label: 'Denied Amount', type: 'number', placeholder: '0.00' },
					{ key: 'payerId', label: 'Payer', type: 'lookup', placeholder: 'Search payer', lookupConfig: { endpoint: '/api/fhir-resource/insurance-companies', valueField: 'id', displayField: 'name' } },
					{
						key: 'appealStatus', label: 'Appeal Status', type: 'select', options: [
							{ label: 'Not Appealed', value: 'not-appealed' },
							{ label: 'Appeal Pending', value: 'appeal-pending' },
							{ label: 'Appeal Approved', value: 'appeal-approved' },
							{ label: 'Appeal Denied', value: 'appeal-denied' },
						]
					},
					// Additional ClaimResponse fields ported from ciyex-ehr-ui so the
					// denials create/edit form is no longer missing fields (issue 14).
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Cancelled', value: 'cancelled' },
							{ label: 'Draft', value: 'draft' },
							{ label: 'Entered in Error', value: 'entered-in-error' },
						]
					},
					{
						key: 'outcome', label: 'Outcome', type: 'select', options: [
							{ label: 'Queued', value: 'queued' },
							{ label: 'Complete', value: 'complete' },
							{ label: 'Error', value: 'error' },
							{ label: 'Partial', value: 'partial' },
						]
					},
					{ key: 'disposition', label: 'Disposition', type: 'textarea', colSpan: 2 },
					{ key: 'created', label: 'Response Date', type: 'date' },
					{ key: 'insurer', label: 'Insurer', type: 'lookup', placeholder: 'Search insurer', lookupConfig: { endpoint: '/api/fhir-resource/insurance-companies', valueField: 'id', displayField: 'name' } },
					// Maps to ClaimResponse.request — a FHIR reference HAPI validates for
					// existence. As free text a user could type a bare claim number (e.g.
					// "345") that isn't a real Claim id, producing HAPI-1094 "Resource
					// Claim/345 not found" and failing the whole save. Make it a lookup on
					// actual claims (mirrors the backend's V145 config + the payments
					// "Apply to Claim" field above) so the value is a real Claim id, or
					// leave it blank (optional → no reference → the denial still saves).
					{ key: 'request', label: 'Original Claim', type: 'lookup', placeholder: 'Search claim by number', lookupConfig: { endpoint: '/api/fhir-resource/claims', valueField: 'id', displayField: 'identifier' } },
					{ key: 'preAuthRef', label: 'Pre-Auth Reference', type: 'text' },
					{
						key: 'use', label: 'Use', type: 'select', options: [
							{ label: 'Claim', value: 'claim' },
							{ label: 'Pre-authorization', value: 'preauthorization' },
							{ label: 'Predetermination', value: 'predetermination' },
						]
					},
					{
						key: 'type', label: 'Claim Type', type: 'select', options: [
							{ label: 'Professional', value: 'professional' },
							{ label: 'Institutional', value: 'institutional' },
							{ label: 'Oral', value: 'oral' },
						]
					},
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
			{
				key: 'adjudication', title: 'Adjudication Summary', columns: 2, visible: true, collapsible: true, fields: [
					{ key: 'totalSubmitted', label: 'Submitted Amount', type: 'number', placeholder: '0.00' },
					{ key: 'totalBenefit', label: 'Benefit Amount', type: 'number', placeholder: '0.00' },
					{ key: 'paymentAmount', label: 'Payment Amount', type: 'number', placeholder: '0.00' },
					{ key: 'paymentDate', label: 'Payment Date', type: 'date' },
					{ key: 'adjustmentAmount', label: 'Adjustment', type: 'number', placeholder: '0.00' },
					{ key: 'adjustmentReason', label: 'Adjustment Reason', type: 'text' },
				],
			},
			{
				key: 'process-notes', title: 'Process Notes', columns: 2, visible: true, collapsible: true, fields: [
					{ key: 'processNote', label: 'Process Note', type: 'textarea', colSpan: 2 },
					{ key: 'errorCode', label: 'Error Code', type: 'text' },
				],
			},
		],
	},
	'era-remittance': {
		tabKey: 'era-remittance',
		sections: [
			{
				key: 'era', title: 'ERA / Remittance', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'paymentDate', label: 'Payment Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
					{ key: 'paymentAmount', label: 'Payment Amount', type: 'number', required: true, placeholder: '0.00' },
					{ key: 'payerId', label: 'Payer', type: 'lookup', required: true, placeholder: 'Search payer', lookupConfig: { endpoint: '/api/fhir-resource/insurance-companies', valueField: 'id', displayField: 'name' } },
					{ key: 'referenceNumber', label: 'Check / EFT #', type: 'text', placeholder: 'Trace number' },
					{
						key: 'paymentMethod', label: 'Method', type: 'select', options: [
							{ label: 'Check', value: 'check' },
							{ label: 'EFT', value: 'eft' },
							{ label: 'Credit Card', value: 'credit-card' },
							{ label: 'Other', value: 'other' },
						]
					},
					// Payment Type — overlays the backend `paymentType` (default free
					// text) and promotes it to a dropdown matching ciyex-ehr-ui.
					{
						key: 'paymentType', label: 'Payment Type', type: 'select', options: [
							{ label: 'Insurance Payment', value: 'insurance-payment' },
							{ label: 'Patient Copay', value: 'patient-copay' },
							{ label: 'Patient Coinsurance', value: 'patient-coinsurance' },
							{ label: 'Patient Deductible', value: 'patient-deductible' },
							{ label: 'Patient Self-Pay', value: 'patient-self-pay' },
							{ label: 'Cash', value: 'cash' },
							{ label: 'Check', value: 'check' },
							{ label: 'Credit Card', value: 'credit-card' },
							{ label: 'EFT/ACH', value: 'eft-ach' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Active', value: 'active' },
							{ label: 'Cancelled', value: 'cancelled' },
							{ label: 'Draft', value: 'draft' },
							{ label: 'Entered in Error', value: 'entered-in-error' },
						]
					},
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	// Submissions: keys match the backend `claim-submissions` tab_field_config
	// (V16: submissionDate / status / clearinghouse / trackingNumber /
	// totalCharge / insurer). The previous keys (providerId, payerId,
	// totalAmount) didn't match the backend, so the overlay appended them as
	// extra duplicate fields and the save body had nothing the FhirPathMapper
	// could place on the Claim resource. Billing Provider stays as a local
	// addition so the test team's "Search Billing Provider" UX is preserved.
	submissions: {
		tabKey: 'submissions',
		sections: [
			{
				key: 'submission', title: 'Claim Submission', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'submissionDate', label: 'Submission Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Pending', value: 'pending' },
							{ label: 'Submitted', value: 'submitted' },
							{ label: 'Accepted', value: 'accepted' },
							{ label: 'Rejected', value: 'rejected' },
						]
					},
					{ key: 'clearinghouse', label: 'Clearinghouse', type: 'text', placeholder: 'e.g., Change Healthcare' },
					{ key: 'trackingNumber', label: 'Tracking #', type: 'text', placeholder: 'Tracking number' },
					{ key: 'totalCharge', label: 'Total Charge', type: 'number', placeholder: '0.00' },
					// Payers/insurers live in the insurance-companies catalog (Blue Cross,
					// Aetna, Cigna…), NOT /api/organizations — every other payer lookup in
					// this file uses this endpoint. The old /api/organizations target
					// returned no payers, so the "Search Payer" typeahead listed nothing.
					{ key: 'insurer', label: 'Insurer / Payer', type: 'lookup', placeholder: 'Search Payer', lookupConfig: { endpoint: '/api/fhir-resource/insurance-companies', displayField: 'name', valueField: 'id', searchable: true } },
					{ key: 'billingProvider', label: 'Billing Provider', type: 'practitioner-search', placeholder: 'Search Billing Provider' },
					// Service period (FHIR Claim.billablePeriod.start/.end) — matches
					// the ciyex-ehr-ui submission "Service From / Service To" fields.
					{ key: 'billablePeriodStart', label: 'Service From', type: 'date' },
					{ key: 'billablePeriodEnd', label: 'Service To', type: 'date' },
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	// Encounter create/edit. Patient is resolved from the URL path (the chart's
	// patient context), so we no longer ship a duplicate "Search Patient" field
	// — the test team flagged that as an unwanted duplicate when the backend
	// tab_field_config V20 started shipping its own `patient` reference. Start
	// and end dates use plain `date` (no time component) per the test report's
	// "remove time range in the start date and end date" ask.
	encounters: {
		tabKey: 'encounters',
		sections: [
			{
				key: 'encounter-details', title: 'Encounter', columns: 2, visible: true, collapsible: false, fields: [
					// Always put patient-search first so the deduplication in the
					// patientPrefillTabs path promotes this one and strips any
					// duplicate `patient` field the backend tab_field_config sends.
					{ key: 'patient', label: 'Patient', type: 'patient-search', required: true, placeholder: 'Search patient' },
					{
						key: 'type', label: 'Encounter Type', type: 'select', required: true, options: [
							{ label: 'Ambulatory', value: 'AMB' },
							{ label: 'Emergency', value: 'EMER' },
							{ label: 'Home Health', value: 'HH' },
							{ label: 'Inpatient', value: 'IMP' },
							{ label: 'Observation', value: 'OBSENC' },
							{ label: 'Short Stay', value: 'SS' },
							{ label: 'Virtual', value: 'VR' },
						]
					},
					{ key: 'reason', label: 'Reason', type: 'text', placeholder: 'Reason for visit' },
					{ key: 'provider', label: 'Provider', type: 'practitioner-search', placeholder: 'Search Provider' },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Planned', value: 'planned' },
							{ label: 'Arrived', value: 'arrived' },
							{ label: 'In Progress', value: 'in-progress' },
							{ label: 'Finished', value: 'finished' },
							{ label: 'Cancelled', value: 'cancelled' },
						]
					},
					{ key: 'startDate', label: 'Start Date', type: 'date', required: true },
					{ key: 'endDate', label: 'End Date', type: 'date' },
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2, localOnly: true },
				],
			},
		],
	},
};

export class PatientChartEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexPatientChart';

	private root!: HTMLElement;
	private headerBar!: HTMLElement;
	private sidebarEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private patientId = '';
	private patientName = '';
	private patientData: Record<string, unknown> = {};
	private categories: ChartCategory[] = [];
	private activeTab = 'dashboard';
	private sidebarCollapsed = false;
	private quickInfo: QuickInfo = { allergies: '…', problems: '…', history: '…', vitals: '…' };
	private readonly _configHome: URI;
	private readonly _tabDataCache = new Map<string, { config: FieldConfig | null; data: Record<string, unknown>[] }>();
	// Records created during this session, keyed by tab.key. HAPI FHIR search
	// indexing is eventually consistent — a resource created seconds ago is
	// often missing from the next /patient/{id} search response (and some
	// resource types report a non-zero total while returning empty content).
	// We keep created records here and merge them into every list fetch until
	// the server's own search surfaces them, so a freshly-created allergy /
	// vital / problem / insurance / relationship never disappears from the list.
	private readonly _pendingCreates = new Map<string, Array<Record<string, unknown>>>();
	private readonly _tabNavMap = new Map<string, HTMLElement>();
	private readonly _tabCountEls = new Map<string, HTMLElement>();
	private readonly _tabCounts = new Map<string, number>();
	/** Page index per list-tab; persists across renders so filter changes feel stable. */
	private readonly _listPage = new Map<string, number>();
	private readonly _quickInfoValEls = new Map<string, HTMLElement>();
	// Lookup caches: backend list endpoints return rows with `provider` /
	// `providerId` / `insurance.id` fields holding raw IDs. The test team
	// flagged the entire workspace as "showing provider id instead of name"
	// (and the same for insurance company) — cache the lookup maps so the
	// table cell renderer can swap IDs for human-readable names everywhere.
	private readonly _providerNameById = new Map<string, string>();
	private readonly _orgNameById = new Map<string, string>();
	private readonly _locationNameById = new Map<string, string>();
	private _lookupsLoaded = false;
	// Provider ids that `_resolveIdToName` saw but couldn't resolve from the
	// bulk caches (e.g. a prescriber Practitioner whose row fell outside the
	// first 500 of /api/providers). Collected during a render pass, then
	// fetched one-by-one and the list re-rendered so the table shows the
	// prescriber NAME instead of a bare id like "13656" (QA issue 9).
	private readonly _unresolvedProviderIds = new Set<string>();
	private readonly _attemptedProviderIds = new Set<string>();
	// Disposables scoped to one Dashboard render — pagination controls for the
	// "Recent Activity" and "Upcoming" feeds. Cleared (not disposed) at the
	// start of every dashboard render so re-rendering the tab doesn't leak the
	// previous render's pagers.
	private readonly _dashboardDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageSvc: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexInstallationsService private readonly installationsService: ICiyexInstallationsService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(PatientChartEditor.ID, group, telemetryService, themeService, storageSvc);
		this._configHome = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex');
		this.sidebarCollapsed = this.storageSvc.getBoolean(SIDEBAR_COLLAPSED_KEY, StorageScope.PROFILE, false);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-patient-chart.ciyex-editor-root'));
		// position:relative so absolute-positioned overlays (record dialog) anchor to this pane
		this.root.style.cssText = 'position:relative;height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header bar
		this.headerBar = DOM.append(this.root, DOM.$('.chart-header'));
		// Single-line header: nowrap + overflow hidden. Every item below is
		// white-space:nowrap and flex-shrink:0 except the demographics cluster,
		// which is the one flexible part that ellipsis-truncates when the pane is
		// narrow (e.g. the create/edit form panel open). This keeps the name,
		// pills and action buttons on ONE line and always visible — previously the
		// items shrank and their text re-wrapped, pushing the header to 3 lines.
		this.headerBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;flex-wrap:nowrap;align-items:center;gap:10px;background:var(--vscode-editor-background);overflow:hidden;white-space:nowrap;';

		// Body: sidebar + main
		const body = DOM.append(this.root, DOM.$('.chart-body'));
		body.style.cssText = 'flex:1;display:flex;overflow:hidden;min-height:0;';

		this.sidebarEl = DOM.append(body, DOM.$('.chart-sidebar'));
		this.sidebarEl.style.cssText = 'width:240px;flex-shrink:0;overflow-y:auto;scrollbar-width:none;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background, var(--vscode-editor-background));';

		this.mainEl = DOM.append(body, DOM.$('.chart-main'));
		this.mainEl.style.cssText = 'flex:1;min-width:0;overflow-y:auto;scrollbar-width:none;padding:20px 24px;';
	}

	override async setInput(input: PatientChartEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.patientId = input.patientId;
		this.patientName = input.patientName;
		this._tabDataCache.clear();
		this._pendingCreates.clear();
		this._tabNavMap.clear();
		this._quickInfoValEls.clear();
		// Initial-tab override (e.g. appointment row "Record Vitals" lands on the
		// vitals tab) takes precedence over the persisted last-visited tab.
		this.activeTab = input.initialTab
			|| this.storageSvc.get(LAST_TAB_KEY_PREFIX + this.patientId, StorageScope.PROFILE, 'dashboard');

		// Focused mode (opened from snapshot quick-action icons): hide the
		// patient header + chart sidebar so only the active tab content is
		// visible. The full chart remains available via the regular flow.
		const focused = !!input.focused;
		// Restore 'flex' (not '') when un-hiding: the header's cssText declares
		// display:flex, but setting it to '' removes the property and the <div>
		// falls back to display:block, which stacked the demographics/buttons onto
		// separate lines (the 3-line header QA flagged). Keep it a flex row.
		this.headerBar.style.display = focused ? 'none' : 'flex';
		this.sidebarEl.style.display = focused ? 'none' : '';
		if (focused) {
			this.mainEl.style.padding = '12px 18px';
		} else {
			this.mainEl.style.padding = '20px 24px';
		}

		// Kick off Quick Info immediately — its 5 fetches run in parallel with
		// the layout/patient loads below, and each row updates its DOM cell
		// independently as soon as its own response lands.
		const quickInfoPromise = this._loadQuickInfo();

		await Promise.all([this._loadLayout(), this._loadPatient(), this._loadLookups()]);
		if (token.isCancellationRequested) { return; }

		if (!focused) {
			this._renderHeader();
			this._renderSidebar();
		}
		this._renderMain();
		// Tie the quick-info promise back so a re-entrant setInput awaits it.
		void quickInfoPromise;
	}

	override clearInput(): void {
		this._tabDataCache.clear();
		this._pendingCreates.clear();
		this._tabNavMap.clear();
		this._quickInfoValEls.clear();
		super.clearInput();
	}

	// --- Data loading ---

	private async _loadLayout(): Promise<void> {
		let userCategories: ChartCategory[] = [];
		try {
			const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'chart-layout.json'));
			const json = JSON.parse(file.value.toString());
			userCategories = (json.categories || []).filter((c: ChartCategory) => !c.hideFromChart);
		} catch { /* no user config, fall through to defaults */ }

		// Merge: user categories override defaults by key; unknown user categories appended.
		const byKey = new Map<string, ChartCategory>();
		for (const cat of DEFAULT_CATEGORIES) { byKey.set(cat.key, { ...cat, tabs: [...cat.tabs] }); }
		for (const userCat of userCategories) {
			const existing = byKey.get(userCat.key);
			if (existing) {
				// Merge tabs by key, user tabs override
				const tabByKey = new Map<string, ChartTab>();
				for (const t of existing.tabs) { tabByKey.set(t.key, t); }
				for (const t of userCat.tabs || []) { tabByKey.set(t.key, t); }
				existing.tabs = Array.from(tabByKey.values());
				existing.label = userCat.label || existing.label;
				existing.position = userCat.position ?? existing.position;
			} else {
				byKey.set(userCat.key, userCat);
			}
		}
		// Clinical section must show exactly these six tabs in this order —
		// the workspace test report (12.05.26) calls out parity with the EHR
		// Web UI Clinical sidebar. Any extras shipped via user chart-layout
		// or backend layout overrides are dropped here so they can't sneak in.
		const CLINICAL_TAB_WHITELIST = ['clinical-alerts', 'medications', 'labs', 'lab-results', 'immunizations', 'procedures', 'history'];

		this.categories = Array.from(byKey.values())
			.sort((a, b) => a.position - b.position)
			.map(cat => {
				let tabs = cat.tabs.filter(t => t.visible !== false).sort((a, b) => a.position - b.position);
				// Hide the Messaging section from the patient chart for every
				// practice, regardless of any persisted/backend layout (issue 11).
				tabs = tabs.filter(t => t.key !== 'messaging');
				if (cat.key === 'clinical') {
					const byKey = new Map<string, ChartTab>();
					for (const t of tabs) { byKey.set(t.key, t); }
					tabs = CLINICAL_TAB_WHITELIST
						.map((key, idx) => {
							const tab = byKey.get(key);
							return tab ? { ...tab, position: idx } : null;
						})
						.filter((t): t is ChartTab => t !== null);
				}
				return { ...cat, tabs };
			});

		this._applyRcmTabOverrides();
	}

	/**
	 * When the org has the ciyex-rcm marketplace app installed, the chart's
	 * revenue tabs read from the RCM service (through the app-proxy) instead
	 * of the generic FHIR store, so the biller sees the SAME claims/charges/
	 * ledger the RCM work queue and claim editor operate on. Orgs without the
	 * install keep the existing FHIR-backed tabs untouched.
	 *
	 * Only tabs with a patient-scoped RCM endpoint are switched (claims,
	 * billing→charges, payment→ledger); denials / ERA / statements stay on
	 * FHIR — the RCM service exposes those org-wide, not per patient. RCM
	 * tabs are read-only: claims are created from the fee sheet flow, not the
	 * generic chart form (whose FHIR payload the RCM API won't accept).
	 */
	private _applyRcmTabOverrides(): void {
		if (!this.installationsService.isInstalled(RCM_APP_SLUG)) { return; }
		const RCM = '/api/app-proxy/ciyex-rcm/api/rcm';
		const overrides = new Map<string, Partial<ChartTab>>([
			['claims', {
				apiPath: `${RCM}/claims/patient/{patientId}`, fhirResources: [], readOnly: true,
				columns: [
					{ key: 'claimNumber', label: 'Claim #', aliases: ['claimNumber', 'id'] },
					{ key: 'dateOfService', label: 'Service Date', aliases: ['dateOfService', 'serviceDate'] },
					{ key: 'providerName', label: 'Provider', aliases: ['providerName', 'providerNpi'] },
					{ key: 'payerName', label: 'Payer', aliases: ['payerName'] },
					{ key: 'totalCharges', label: 'Charges', aliases: ['totalCharges'] },
					{ key: 'balance', label: 'Balance', aliases: ['balance'] },
					{ key: 'status', label: 'Status', aliases: ['claimStatus', 'status'] },
				],
			}],
			['billing', {
				apiPath: `${RCM}/charges/patient/{patientId}`, fhirResources: [], readOnly: true,
				columns: [
					{ key: 'dateOfService', label: 'Service Date', aliases: ['dateOfService'] },
					{ key: 'cptCode', label: 'CPT', aliases: ['cptCode'] },
					{ key: 'icd10Codes', label: 'Diagnosis', aliases: ['icd10Codes'] },
					{ key: 'description', label: 'Description', aliases: ['description'] },
					{ key: 'units', label: 'Units', aliases: ['units'] },
					{ key: 'chargeAmount', label: 'Amount', aliases: ['chargeAmount'] },
					{ key: 'status', label: 'Status' },
				],
			}],
			['payment', {
				apiPath: `${RCM}/patient-ledger/{patientId}`, fhirResources: [], readOnly: true,
				columns: [
					{ key: 'entryDate', label: 'Date', aliases: ['entryDate'] },
					{ key: 'entryType', label: 'Type', aliases: ['entryType'] },
					{ key: 'description', label: 'Description', aliases: ['description'] },
					{ key: 'claimNumber', label: 'Claim #', aliases: ['claimNumber'] },
					{ key: 'amount', label: 'Amount', aliases: ['amount'] },
					{ key: 'runningBalance', label: 'Balance', aliases: ['runningBalance'] },
					{ key: 'paymentMethod', label: 'Method', aliases: ['paymentMethod'] },
				],
			}],
		]);
		for (const cat of this.categories) {
			cat.tabs = cat.tabs.map(t => {
				const ov = overrides.get(t.key);
				return ov ? { ...t, ...ov } : t;
			});
		}
	}

	private async _loadPatient(): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/patients/${this.patientId}`);
			if (res.ok) {
				const j = await res.json();
				// Accept both ApiResponse-wrapped ({ data: {...} }) and unwrapped
				// patient bodies so `this.patientData` is reliably the full record
				// the demographics save merges over.
				const cand = (j?.data ?? j) as Record<string, unknown> | null;
				this.patientData = (cand && typeof cand === 'object' && !Array.isArray(cand)) ? cand : {};
			}
		} catch { /* */ }
	}

	/**
	 * Populate id→name maps used by the table cell renderer to swap raw
	 * provider / organization / location IDs for human-readable names. The
	 * test team called this out as a workspace-wide regression vs. the EHR
	 * Web UI which already does this resolution server-side. Loaded once
	 * per chart open; results are reused across every tab's table render.
	 */
	private _lookupsLoadingPromise: Promise<void> | null = null;
	private async _loadLookups(): Promise<void> {
		if (this._lookupsLoaded) { return; }
		// Reuse the in-flight load so concurrent callers (e.g. `_loadTabData`
		// firing before the constructor's parallel `_loadLookups()` resolves)
		// don't double-fetch and don't return early before the cache fills.
		if (this._lookupsLoadingPromise) { return this._lookupsLoadingPromise; }
		this._lookupsLoadingPromise = this._doLoadLookups();
		try { await this._lookupsLoadingPromise; } finally { this._lookupsLoadingPromise = null; }
	}
	private async _doLoadLookups(): Promise<void> {
		const safe = async (url: string): Promise<Record<string, unknown>[]> => {
			try {
				const r = await this.apiService.fetch(url);
				if (!r.ok) { return []; }
				const d = await r.json();
				const list = d?.data?.content || d?.data || d?.content || d || [];
				return Array.isArray(list) ? list as Record<string, unknown>[] : [];
			} catch { return []; }
		};
		// Pull every lookup we know about — `/api/providers` AND the FHIR list
		// (each one is missing rows the other has, depending on whether the
		// provider was created via the EHR or imported from FHIR). Insurance
		// companies have their own endpoint that the Billing/Claims forms
		// already use; load it into the org cache so "Organization/5213" rows
		// resolve to the actual insurance name.
		const [providers, providersFhir, orgs, orgsFhir, insurance, insuranceLegacy, locations] = await Promise.all([
			safe('/api/providers?size=500'),
			safe('/api/fhir-resource/practitioners?size=500'),
			safe('/api/organizations?size=500'),
			safe('/api/fhir-resource/organizations?size=500'),
			safe('/api/fhir-resource/insurance-companies?size=500'),
			// Non-FHIR insurance companies endpoint — covers ids that the FHIR
			// resource view doesn't index. (Issue #11: billing rows showed
			// "Organization/5213" because the FHIR list missed the row.)
			safe('/api/insurance-companies?size=500'),
			safe('/api/locations?size=500'),
		]);
		const addProvider = (p: Record<string, unknown>) => {
			const id = String(p.id ?? p.fhirId ?? p.providerId ?? p.practitionerId ?? '');
			const prefix = (p as Record<string, Record<string, unknown>>).identification;
			const first = String(prefix?.firstName ?? p.firstName ?? p['identification.firstName'] ?? '').trim();
			const last = String(prefix?.lastName ?? p.lastName ?? p['identification.lastName'] ?? '').trim();
			const name = (`${first} ${last}`.trim()) || String(p.displayName ?? p.name ?? p.fullName ?? p.username ?? '').trim();
			if (id && name) {
				this._providerNameById.set(id, name);
				this._providerNameById.set(`Practitioner/${id}`, name);
				this._providerNameById.set(`PractitionerRole/${id}`, name);
			}
		};
		const addOrg = (o: Record<string, unknown>) => {
			const id = String(o.id ?? o.fhirId ?? o.organizationId ?? o.insurerId ?? o.payerId ?? o.companyId ?? '');
			const name = String(o.name ?? o.organizationName ?? o.payerName ?? o.companyName ?? o.insuranceName ?? o.displayName ?? o.insuranceCompanyName ?? '').trim();
			if (id && name) {
				this._orgNameById.set(id, name);
				// Also index the FHIR-prefixed form so "Organization/5213" resolves directly.
				this._orgNameById.set(`Organization/${id}`, name);
			}
		};
		for (const p of providers) { addProvider(p); }
		for (const p of providersFhir) { addProvider(p); }
		for (const o of orgs) { addOrg(o); }
		for (const o of orgsFhir) { addOrg(o); }
		for (const o of insurance) { addOrg(o); }
		for (const o of insuranceLegacy) { addOrg(o); }
		for (const l of locations) {
			const id = String(l.id ?? l.fhirId ?? '');
			const name = String(l.name ?? l.locationName ?? '').trim();
			if (id && name) { this._locationNameById.set(id, name); }
		}
		this._lookupsLoaded = true;
	}

	/**
	 * Best-effort display NAME for an id-bearing reference field, read from a
	 * SIBLING key on the same edit record. FHIR reference fields round-trip as a
	 * bare id (e.g. claims `providerId` / `payerId`), but the backend also
	 * returns a human-readable companion (`providerName`, `insuranceName`,
	 * `payerDisplay`, a reference `.display`, …) — the list columns already alias
	 * these. The edit form used to ignore them and lean solely on id→name cache
	 * resolution, which misses when the saved id is a FHIR reference id outside
	 * the lookup cache, so the field re-opened showing the raw id (QA: billing
	 * provider / insurer changed to their id numbers after save + re-edit).
	 * Prefer the companion name here. Returns '' when none looks like a real name.
	 */
	private _referenceDisplayHint(record: Record<string, unknown>, f: FieldDef): string {
		// Only id-bearing references need a name hint. Name-valued lookups
		// (`valueField:'name'`), `storeLabelAsValue` searches, and code searches
		// already hold their display text.
		const isIdLookup = !f.storeLabelAsValue && (
			f.type === 'patient-search' || f.type === 'practitioner-search'
			|| (f.type === 'lookup' && f.lookupConfig?.valueField !== 'name')
			|| (f.type === 'search' && f.apiPath !== undefined));
		if (!isIdLookup) { return ''; }
		const isName = (s: string): boolean => {
			if (!s) { return false; }
			const looksLikeId = /^[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}$/.test(s)
				|| /^\d+$/.test(s)
				|| /^[A-Z][A-Za-z]+\/[A-Za-z0-9-]+$/.test(s);
			return !looksLikeId;
		};
		// A reference-object display on the field value itself wins.
		const rawVal = record[f.key];
		if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
			const d = (rawVal as Record<string, unknown>).display;
			if (typeof d === 'string' && isName(d.trim())) { return d.trim(); }
		}
		const key = f.key.toLowerCase();
		const base = f.key.replace(/Id$/, '');
		// Candidate sibling keys, mirroring the list columns' display aliases so
		// the edit form shows the same name the table does. Dotted paths (FHIR
		// reference `.display`) are resolved below.
		const keys = [`${base}Name`, `${base}Display`, `${f.key}Name`, `${f.key}Display`];
		if (/(provider|practitioner|performer|author|prescrib|physician|doctor|referrer|educator)/.test(key)) {
			keys.push('providerName', 'providerDisplay', 'practitionerName', 'performerDisplay');
		}
		if (/(insur|payer|payor|insurer|organization|company)/.test(key)) {
			keys.push('insuranceName', 'payerName', 'insurerName', 'payerDisplay', 'insurerDisplay', 'organizationDisplay', 'organizationName', 'insuranceCompanyName', 'payor.display', 'payor.0.display', 'coverage.payor.display', 'coverage.payor.0.display');
		}
		if (/(location|facility|site)/.test(key)) {
			keys.push('locationName', 'facilityName', 'locationDisplay');
		}
		for (const k of keys) {
			// Resolve dotted paths ("payor.0.display") the same way the list's
			// alias extractor does, so nested FHIR reference displays are picked up.
			const v = k.includes('.')
				? k.split('.').reduce<unknown>((acc, part) => (acc !== null && acc !== undefined ? (acc as Record<string, unknown>)[part] : undefined), record)
				: record[k];
			const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
			if (isName(s)) { return s; }
		}
		return '';
	}

	/**
	 * Heuristic id→name resolution applied by the table cell renderer. Returns
	 * the original value untouched when no lookup applies (so dates, free
	 * text, names, codes etc. flow through unchanged). Column-key hints
	 * narrow which lookup map is consulted so a patient id sitting in a
	 * `payerId` column doesn't accidentally pull an org name.
	 */
	private _resolveIdToName(columnKey: string, raw: unknown): unknown {
		if (raw === null || raw === undefined || raw === '') { return raw; }
		// FHIR Reference shape: { reference: 'Practitioner/abc', display?: '...' }.
		// If a display name already accompanies the reference, prefer it.
		// Otherwise drill down to the reference string for the id lookup below.
		if (typeof raw === 'object' && !Array.isArray(raw)) {
			const r = raw as Record<string, unknown>;
			const display = typeof r.display === 'string' ? r.display.trim() : '';
			if (display) { return display; }
			const ref = typeof r.reference === 'string' ? r.reference
				: typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id)
					: '';
			if (!ref) { return raw; }
			return this._resolveIdToName(columnKey, ref);
		}
		if (typeof raw !== 'string' && typeof raw !== 'number') { return raw; }
		const value = String(raw);
		// Only resolve when the value LOOKS like an id (UUID, numeric, or
		// FHIR-style "Resource/id"). Free-text names contain spaces or
		// punctuation other than dashes, so leaving them as-is is safe.
		const looksLikeId = /^[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,}$/.test(value)
			|| /^\d+$/.test(value)
			|| /^[A-Z][A-Za-z]+\/[A-Za-z0-9-]+$/.test(value);
		if (!looksLikeId) { return raw; }
		const idOnly = value.includes('/') ? value.split('/').pop() || value : value;
		// FHIR resource prefix (e.g. "Organization/5213") wins over column-key
		// heuristics — a row's `insuranceName` column carrying a literal
		// "Organization/5213" reference must always resolve via the org cache,
		// even if the column key only matches the org pattern weakly.
		const prefixMatch = /^([A-Z][A-Za-z]+)\//.exec(value);
		const prefix = prefixMatch ? prefixMatch[1] : '';
		const key = columnKey.toLowerCase();
		// `prescrib` (not `prescriber`) so the backend's medication field key
		// `prescribingDoctor` ALSO matches — it carries the raw Practitioner id
		// (e.g. "13643") and must resolve to the prescriber name. `doctor` /
		// `physician` likewise cover *Doctor / *Physician practitioner columns.
		const isProviderCol = prefix === 'Practitioner' || prefix === 'PractitionerRole'
			|| /(provider|practitioner|performer|author|prescrib|administeredby|orderedby|ordering|referrer|referredby|signedby|physician|doctor|encounterprovider|recorder|reporter|enterer|orderer|requester|educator)/.test(key);
		const isOrgCol = prefix === 'Organization'
			|| /(insur|payer|payor|organization|company)/.test(key);
		const isLocationCol = prefix === 'Location'
			|| /(location|facility|site)/.test(key);
		if (isProviderCol) {
			const name = this._providerNameById.get(idOnly);
			if (name) { return name; }
			// Not in the bulk cache — queue a targeted fetch so the table can
			// resolve it to a name on the next render pass (QA issue 9). Only
			// queue plausible provider ids (numeric / uuid), never already-tried.
			if (idOnly && !this._attemptedProviderIds.has(idOnly)) {
				this._unresolvedProviderIds.add(idOnly);
			}
		}
		if (isOrgCol) {
			const name = this._orgNameById.get(idOnly);
			if (name) { return name; }
		}
		if (isLocationCol) {
			const name = this._locationNameById.get(idOnly);
			if (name) { return name; }
		}
		// FHIR-prefixed ids that found no match: strip the prefix so the table
		// at least shows the bare id ("5213") instead of "Organization/5213".
		if (prefix) { return idOnly; }
		return raw;
	}

	// Map workspace chart-tab keys to the backend's tab_field_config.tab_key.
	// The backend's GenericFhirResourceController routes /api/fhir-resource/{tabKey}/...
	// and looks up tab_field_config by tabKey to resolve the FHIR resource type for
	// scope enforcement. If our key differs from the backend's, write/scope checks fail.
	private static readonly TAB_API_SLUG: Record<string, string> = {
		// Workspace tab.key → backend tab_field_config.tab_key.
		// Verified against ciyex/src/main/resources/db/migration/V17,V19,V42,V107.
		// Removed wrong mappings that caused "Cannot determine resource type" save errors:
		//   appointments → was 'appointment-detail' (backend has 'appointments')
		//   visit-notes  → was 'clinical-notes'    (backend has 'visit-notes')
		// V20 renamed problem-list → medicalproblems in tab_field_config, so the
		// frontend slug must also be 'medicalproblems' for save-scope checks to pass.
		// Identity mappings are no-ops; only list real overrides.
		'problems': 'medicalproblems',
		'submissions': 'claim-submissions',
		'denials': 'claim-denials',
		// The Coverage tab_field_config (FHIR paths for save/read) is seeded under
		// 'insurance-coverage' (ciyex V41/V44); the chart layout uses tab key
		// 'insurance'. Route saves/reads through the real backend key so the
		// Coverage create/update resolves its field config — without this the
		// POST to /api/fhir-resource/insurance fails getConfig("insurance").
		'insurance': 'insurance-coverage',
		// V19 only label-touched the 'report' tab_field_config row — it has no
		// FHIR mapping for DiagnosticReport. The 'labs' row is the only seeded
		// tab key with a complete DiagnosticReport mapping, so route Report
		// saves through it. Without this, Save POSTs return "Cannot determine
		// resource type for tab '...' — write access denied".
		'report': 'labs',
		// V18 renamed 'lab-results' → 'labs', so the desktop's tab.key 'labs' already
		// matches the backend tab_field_config — no override needed. The previous
		// override pointed to the defunct 'lab-results' key and caused "data null"
		// save responses when the backend couldn't find a matching field config.
		'payment': 'payments',
		// FHIR collection slugs → backend tab keys (common chart-layout.json typos)
		'related-persons': 'relationships',
		'allergy-intolerances': 'allergies',
		'medication-requests': 'medications',
		'diagnostic-reports': 'labs',
		'document-references': 'documents',
		'family-member-histories': 'history',
		'service-requests': 'referrals',
		'care-plans': 'care-plan',
	};

	private _tabEndpoint(tab: ChartTab): string | null {
		if (tab.apiPath) { return tab.apiPath; }
		if (tab.fhirResources.length > 0) {
			const slug = PatientChartEditor.TAB_API_SLUG[tab.key] || tab.key;
			return `/api/fhir-resource/${slug}`;
		}
		return null;
	}

	/** Stable record identity, tolerant of `ResourceType/123` vs bare `123`. */
	private _recordId(r: Record<string, unknown>): string {
		const raw = String((r.id ?? r.fhirId ?? r.uuid ?? r._id ?? '') as unknown);
		return raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
	}

	/**
	 * Prepend any session-created records the server hasn't surfaced yet so a
	 * just-created row keeps showing despite FHIR search-index lag. Once the
	 * server returns a record (matched by id), it's dropped from the pending
	 * set so we never render it twice.
	 */
	private _mergePendingCreates(tabKey: string, data: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const pending = this._pendingCreates.get(tabKey);
		if (!pending || pending.length === 0) { return data; }
		const haveIds = new Set(data.map(r => this._recordId(r)).filter(Boolean));
		const stillPending: Array<Record<string, unknown>> = [];
		let merged = data;
		for (const p of pending) {
			const pid = this._recordId(p);
			if (pid && haveIds.has(pid)) { continue; } // server returned it → reconciled
			stillPending.push(p);
			merged = [p, ...merged];
		}
		if (stillPending.length) { this._pendingCreates.set(tabKey, stillPending); }
		else { this._pendingCreates.delete(tabKey); }
		return merged;
	}

	// Some endpoints aren't patient-scoped (e.g. /api/locations) — don't append /patient/{id}.
	private _isFhirResourceTab(tab: ChartTab): boolean {
		// FHIR-backed when the tab lists fhirResources OR its apiPath targets the
		// generic FHIR controller (e.g. vitals -> /api/fhir-resource/vitals).
		// Such resources are patient-scoped on create/update/delete, unlike plain
		// apiPath endpoints (/api/cds/alerts, /api/education/assignments).
		return (!tab.apiPath && tab.fhirResources.length > 0) || !!tab.apiPath?.startsWith('/api/fhir-resource/');
	}

	/**
	 * Every identifier form that may key this patient's records across stores.
	 * The chart's `patientId` is often the FHIR id (the global patient search
	 * opens the chart with `fhirId || id`), but the clinical lab stores key rows
	 * by the numeric DB id / MRN. Matching a lab row's `patientId` against ANY of
	 * these makes the lab tabs show the patient's orders/results regardless of
	 * which id the row carries.
	 */
	private _patientIdSet(): Set<string> {
		const pd = this.patientData || {};
		return new Set([this.patientId, pd.id, pd.patientId, pd.mrn, pd.fhirId]
			.map(v => String(v ?? '').trim()).filter(Boolean));
	}

	/**
	 * Encounters carry a signing-workflow state, not a clinical status: the
	 * chart's Encounters table shows the SAME Signed / Unsigned the patient
	 * snapshot shows instead of the raw FHIR Encounter.status ("Finished").
	 * Mirrors PatientSnapshotEditor._normalizeEncounterStatus — "sign" (but not
	 * "unsign"), "finish" or "complet" (but not "incomplet") mean SIGNED.
	 */
	private static _encounterSignedLabel(raw: unknown): 'Signed' | 'Unsigned' {
		const s = String(raw ?? '').toLowerCase();
		return (s.includes('sign') && !s.includes('unsign')) || s.includes('finish') || (s.includes('complet') && !s.includes('incomplet'))
			? 'Signed' : 'Unsigned';
	}

	/**
	 * The patient id to write to the clinical lab stores (/api/lab-order,
	 * /api/lab-results) so a chart-created record carries the SAME patientId the
	 * clinical Labs page and the snapshot use (the patient's DB id) — without it
	 * a chart create posted under the FHIR id and the row never showed on the
	 * other surfaces. Prefer the DB `id`, fall back to the chart's patientId.
	 */
	private _clinicalPatientId(): string {
		const pd = this.patientData || {};
		const dbId = pd.id ?? pd.patientId;
		return String((dbId ?? this.patientId) || this.patientId);
	}

	private _isPatientScoped(tab: ChartTab): boolean {
		// Tabs that pull from org-level / global collections whose endpoints take
		// NO "/patient/{id}" segment. The clinical lab / immunization / referral
		// stores are global (/api/lab-order/search, /api/lab-results,
		// /api/immunizations, /api/referrals) — the chart filters their rows
		// to the current patient client-side in `_loadTabData` — so they must not
		// get a patient path appended (which would 404).
		const orgLevelTabs = new Set(['facility', 'labs', 'lab-results', 'immunizations', 'referrals']);
		if (orgLevelTabs.has(tab.key)) { return false; }
		return true;
	}

	private async _loadTabData(tab: ChartTab): Promise<{ config: FieldConfig | null; data: Record<string, unknown>[] }> {
		const cached = this._tabDataCache.get(tab.key);
		if (cached) { return cached; }
		// Wait for the org / provider / insurance lookup caches before resolving
		// FK columns. Without this gate, the first tab that renders before
		// `_loadLookups` completes paints raw IDs (e.g. `Organization/5213`)
		// because `_resolveIdToName` returns the input unchanged when the map
		// is still empty (issue #3, #12).
		await this._loadLookups();
		let config: FieldConfig | null = null;
		let data: Record<string, unknown>[] = [];

		// Field config priority:
		// 1. Backend /api/tab-field-config/{tabKey} (authoritative — matches EHR-UI behavior, ensures
		//    form keys map to the same FHIR paths the backend's create/update use).
		// 2. ~/.ciyex/fields/{tabKey}.json (user override).
		// 3. Built-in DEFAULT_FIELD_CONFIGS (offline fallback).
		// We fetch field-config by tab.key (NOT the TAB_API_SLUG remap) so tabs
		// that share a save slug still get their own fields. e.g. `report` and
		// `labs` both save through the labs slug (DiagnosticReport mapping) but
		// `report` has its own Diagnostic Report fields in DEFAULT_FIELD_CONFIGS
		// that the test team wants to see — not Lab Order columns.
		const backendSlug = tab.key;
		// Tabs where DEFAULT_FIELD_CONFIGS is the source of truth (issues 6, 7,
		// 8 from the 12.05.26 test report). The backend's tab_field_config row
		// for these is a stub — only the bare-minimum columns — so the
		// workspace form ends up missing every field the EHR Web UI shows.
		// Force-use the local config and skip the backend fetch so the
		// workspace renders the same dialog as the web app.
		const forceLocalConfigTabs = new Set([
			'payment',        // CollectPaymentModal parity
			'statements',     // StatementsTab New Statement parity
			'insurance',      // Insurance NewInsuranceModal parity
			// 12.05.26 test report issue 1: Lot Number / Dose negative test
			// cases were passing through because the backend's
			// tab_field_config row for immunizations ships without the
			// strict validation patterns the local config carries. The
			// merge logic falls back to local validationPattern only when
			// the backend row omits the key entirely — backends that
			// returned an explicit empty string left the form unguarded.
			// Force-use the rich local config so pure-number lot numbers
			// ("15") and bare-number doses ("10") are rejected client-side.
			// Immunizations + Referrals now also write to the clinical
			// /api/immunizations + /api/referrals stores whose flat DTO keys
			// are defined by the local configs — the backend tab_field_config
			// rows map to FHIR paths and would produce the wrong field keys.
			'immunizations',
			'referrals',
			// 12.05.26 test report issue 4: Education create failed with
			// "The given id must not be null" because the backend's
			// tab_field_config for education didn't expose `materialId` as
			// a `search` field — the merge produced a plain-text Topic /
			// Title input that bypassed the FK selection check. Force the
			// local config so the workspace renders a real search picker
			// bound to /api/education/materials and the save handler can
			// resolve the chosen material's FK.
			'education',
			// Procedures: the backend ships "Date Performed" as a datetime field
			// (datetime-local picker that waits for a time and never auto-closes).
			// The local config declares it as a date-only `performedDateTime`
			// field (auto-closing MM/DD/YYYY picker) — force local so the date
			// selection closes the calendar immediately. Issue 10.
			'procedures',
			// Labs now write to the clinical /api/lab-order + /api/lab-results stores,
			// whose flat DTO keys are defined by the local configs below — the backend
			// tab_field_config for 'labs' maps to FHIR DiagnosticReport paths and would
			// produce the wrong field keys.
			'labs',
			'lab-results',
			// Issues: the backend tab_field_config row ships the Issue Name field
			// without `required`, so the create/edit drawer let users save empty
			// records (no issue name). Force the rich local config so the
			// `conditionName` field renders required:true and the shared
			// required-field validation blocks submission with
			// "Issue Name is required" until it's filled.
			'issues',
		]);
		if (forceLocalConfigTabs.has(tab.key) && DEFAULT_FIELD_CONFIGS[tab.key]) {
			config = DEFAULT_FIELD_CONFIGS[tab.key];
		}
		try {
			if (config) { throw new Error('local-config-forced'); }
			const res = await this.apiService.fetch(`/api/tab-field-config/${backendSlug}`);
			if (res.ok) {
				const json = await res.json();
				const cfg = json?.data || json;
				if (cfg && cfg.fieldConfig) {
					const fieldConfig = typeof cfg.fieldConfig === 'string' ? JSON.parse(cfg.fieldConfig) : cfg.fieldConfig;
					if (fieldConfig?.sections) {
						let sections = fieldConfig.sections as FieldSection[];
						// Vitals: drop the backend's "Recording Info" / vitals-meta section.
						// recordedAt is auto-set on save, the e-signed flag is unused, and
						// notes already appears under measurements — the section just makes
						// the form too tall to fit the chart pane.
						if (tab.key === 'vitals') {
							sections = sections.filter(s => s.key !== 'vitals-meta' && !/recording info/i.test(s.title || ''));
						}
						// Encounter / appointment / visit-note / messaging / etc. forms
						// already resolve the patient from the chart's URL path, so any
						// backend-shipped `patient` / `patientId` / `subject` reference
						// field is usually a redundant manual picker. Most tabs simply
						// drop it. Encounters + Appointments are the exception — the
						// test team wants the Patient field visible (with "Search
						// Patient" placeholder) and auto-populated for the current
						// patient so the record links unambiguously even when the
						// form is opened outside a chart context.
						const patientScopedTabs = new Set([
							'visit-notes', 'medications', 'labs',
							'immunizations', 'procedures', 'clinical-alerts', 'allergies', 'problems',
							'documents', 'education', 'messaging', 'history', 'referrals',
							'billing', 'claims', 'submissions', 'denials', 'era-remittance',
							'transactions', 'payment', 'statements', 'issues', 'report',
						]);
						// 12.05.26 test report (issue 11 v2): the team now wants the
						// Encounter "Patient" field VISIBLE but as a searchable input
						// pre-filled with the current chart's patient. Same UX as the
						// Appointments form. Encounters used to be in `patientScopedTabs`
						// so the field was stripped entirely — we move it to the
						// prefill set instead.
						const patientPrefillTabs = new Set(['appointments', 'encounters']);
						if (patientScopedTabs.has(tab.key)) {
							sections = sections.map(s => ({
								...s,
								fields: s.fields.filter(f => f.key !== 'patient' && f.key !== 'patientId' && f.key !== 'subject'),
							}));
						} else if (patientPrefillTabs.has(tab.key)) {
							// Promote the patient field to a search-with-prefill UX and
							// move it to the top of the form. The chart's patient name
							// flows through `defaultValue` — the patient-search input
							// already shows the name in the visible textbox AND seeds
							// the hidden id, so a subsequent save still posts a real
							// FK reference even when the user never touches the field.
							// Patient-shaped keys the backend may ship. We promote the
							// FIRST one to `patient-search` and STRIP the rest so the
							// encounter form doesn't end up with two "PATIENT" rows.
							const patientLikeKeys = new Set(['patient', 'patientId', 'subject', 'patientRef', 'patientReference', 'patientSearch', 'patientName', 'patient_id']);
							let promoted = false;
							const ensurePatientField = (s: typeof sections[number]): typeof s => {
								if (!s.fields.some(f => patientLikeKeys.has(f.key))) {
									return s;
								}
								const fields: typeof s.fields = [];
								for (const f of s.fields) {
									if (!patientLikeKeys.has(f.key)) {
										fields.push(f);
										continue;
									}
									if (promoted) {
										// Duplicate patient field — skip so the dialog
										// stays with a single search input.
										continue;
									}
									promoted = true;
									fields.push({
										...f,
										label: f.label || 'Patient',
										type: 'patient-search',
										placeholder: 'Search patient',
										required: true,
										// Seed the hidden FK with the patient ID — NEVER the name. A name in
										// the FK reaches the backend as `Patient/<name>` and is rejected
										// with HAPI-1094 "Resource Patient/<name> not found". The visible
										// textbox is filled with the patient name by the prefill block below.
										defaultValue: this.patientId,
										// In the patient chart the record is always for the current
										// patient — lock the field to an auto-filled name display
										// (no search, no other patients selectable).
										readonly: true,
									});
								}
								return { ...s, fields };
							};
							const anyHas = sections.some(s => s.fields.some(f => patientLikeKeys.has(f.key)));
							if (anyHas) {
								sections = sections.map(ensurePatientField);
							} else if (sections.length > 0) {
								sections = sections.map((s, idx) => idx === 0
									? {
										...s,
										fields: [
											{
												key: 'patientId',
												label: 'Patient',
												type: 'patient-search',
												placeholder: 'Search patient',
												required: true,
												// Seed the hidden FK with the patient ID — NEVER the name. A name in
												// the FK reaches the backend as `Patient/<name>` and is rejected
												// with HAPI-1094 "Resource Patient/<name> not found". The visible
												// textbox is filled with the patient name by the prefill block below.
												defaultValue: this.patientId,
												// In the patient chart the record is always for the current
												// patient — lock the field to an auto-filled name display
												// (no search, no other patients selectable).
												readonly: true,
											},
											...s.fields,
										],
									}
									: s);
							}
						}
						// Documents: drop ALL backend attachment-shaped fields AND any
						// field rendered as type 'file'. Only the localOnly attachment
						// picker (appended below) should survive, avoiding duplicates.
						if (tab.key === 'documents') {
							const dupAttachKeys = new Set([
								'fileUrl', 'attachment', 'content', 'data', 'fileData', 'fileContent',
								'url', 'documentUrl', 'attachmentUrl', 'fileBase64', 'documentData',
								'file', 'fileContent', 'fileAttachment', 'contentData',
							]);
							sections = sections.map(s => ({
								...s,
								fields: s.fields.filter(f => !dupAttachKeys.has(f.key) && f.type !== 'file'),
							}));
						}
						// Per-field overlays: backend tab_field_config often omits the
						// search type, placeholder, validation pattern, default value, or
						// select options that the local fallback specifies. Carry those
						// through so the form behaves the same as the web UI.
						const localOverrides = DEFAULT_FIELD_CONFIGS[tab.key];
						if (localOverrides) {
							const overrideMap = new Map<string, FieldDef>();
							for (const sec of localOverrides.sections) {
								for (const f of sec.fields) { overrideMap.set(f.key, f); }
							}
							sections = sections.map(sec => ({
								...sec,
								fields: sec.fields.map(f => {
									const ov = overrideMap.get(f.key);
									if (!ov) { return f; }
									// Promote to code-search / practitioner-search / patient-search / lookup
									// if the local fallback says so. Backend label wins (it's a content
									// choice); local provides UX hints (placeholder, validation, options)
									// and `required` when backend left the flag unset.
									const isSearchType = ov.type === 'code-search' || ov.type === 'practitioner-search' || ov.type === 'patient-search' || ov.type === 'lookup' || ov.type === 'search';
									const backendOpts = f.options;
									const hasBackendOptions = Array.isArray(backendOpts) && backendOpts.length > 0;
									// Promote backend `text` fields to `select`/`date`/`datetime`/etc.
									// when the local override defines a richer type. The test team flagged
									// "Visit Type / Priority dropdown not showing" because the backend
									// shipped these as plain text inputs and the overlay was only swapping
									// type for search-type promotions. Anything other than text → richer
									// renders the local control with the backend label preserved.
									const backendType = (f.type || 'text').toLowerCase();
									const ovType = (ov.type || 'text').toLowerCase();
									const promoteRicher =
										ovType === 'select' && (backendType === 'text' || !backendType) ||
										ovType === 'date' && backendType === 'datetime' ||
										ovType === 'date' && backendType === 'text' ||
										ovType === 'datetime' && (backendType === 'text' || backendType === 'date' || !backendType) ||
										ovType === 'phone' && (backendType === 'text' || !backendType) ||
										ovType === 'email' && (backendType === 'text' || !backendType) ||
										ovType === 'number' && backendType === 'text' ||
										ovType === 'textarea' && backendType === 'text' ||
										ovType === 'boolean' && (backendType === 'text' || !backendType) ||
										ovType === 'file' && (backendType === 'text' || !backendType);
									return {
										...f,
										type: isSearchType ? ov.type : (promoteRicher ? ov.type : f.type),
										placeholder: f.placeholder || ov.placeholder,
										lookupConfig: f.lookupConfig || ov.lookupConfig,
										// Search-type fields need their endpoint + display mapping to render
										// as a working typeahead. The backend tab_field_config ships these
										// as plain text (no apiPath), which left Education Topic/Title +
										// Educator pickers non-searchable.
										apiPath: f.apiPath || ov.apiPath,
										relatedDisplayFields: f.relatedDisplayFields || ov.relatedDisplayFields,
										relatedField: f.relatedField || ov.relatedField,
										// Name-column search fields (e.g. immunization Administered By)
										// must persist the picked display name, not the row id.
										storeLabelAsValue: f.storeLabelAsValue ?? ov.storeLabelAsValue,
										validationPattern: f.validationPattern || ov.validationPattern,
										validationMessage: f.validationMessage || ov.validationMessage,
										defaultValue: f.defaultValue ?? ov.defaultValue,
										// `required` falls back to the local config when the backend
										// row omits it (Education materialId, Messaging subject, etc.).
										// Without this, "given id must not be null" save errors slipped
										// through because validation didn't flag the empty field.
										required: f.required ?? ov.required,
										// Options resolution: normally backend options win when present
										// and local is the fallback. But when the local override sets
										// `mergeOptions`, UNION the two (backend first, then any local
										// option whose value the backend didn't ship) — used for the
										// visit-note Status, where the backend tab_field_config only
										// ships Current/Superseded/Entered in Error but the signing
										// workflow also needs Signed/Unsigned/Amended.
										options: (ov.mergeOptions && hasBackendOptions)
											? PatientChartEditor._mergeSelectOptions(backendOpts!, ov.options)
											: (hasBackendOptions ? backendOpts : ov.options),
									};
								}),
							}));
							// SELECTIVE APPEND: only append local fields explicitly
							// flagged `localOnly: true`. Used for UX-only inputs that
							// the backend doesn't ship and that we know don't collide
							// with any backend key — appointment priority/duration/
							// endDate, vitals BMI, education URL, documents
							// attachment, messaging "Send Via" medium. The earlier
							// "append everything missing" was the source of the
							// duplicate-field complaint (backend `type` rendered
							// alongside local `appointmentType`); the FieldDef key
							// alignment work + this allow-list together avoid the
							// duplicates while still surfacing the local extras.
							const presentKeys = new Set<string>();
							for (const sec of sections) { for (const f of sec.fields) { presentKeys.add(f.key); } }
							for (const sec of localOverrides.sections) {
								const extras = sec.fields.filter(f => f.localOnly && !presentKeys.has(f.key));
								if (extras.length === 0) { continue; }
								const target = sections.find(s => s.key === sec.key);
								if (target) { target.fields = [...target.fields, ...extras]; }
								else { sections.push({ ...sec, fields: extras }); }
							}
						}
						config = { tabKey: tab.key, sections };
					}
				}
			}
		} catch { /* fall through to local config */ }

		if (!config) {
			try {
				const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'fields', `${tab.key}.json`));
				config = JSON.parse(file.value.toString());
			} catch { /* */ }
		}
		if (!config && DEFAULT_FIELD_CONFIGS[tab.key]) {
			config = DEFAULT_FIELD_CONFIGS[tab.key];
		}

		// Medical-coding modifiers (e.g. "25", "59", "GT", "E/M") are ALPHANUMERIC.
		// Some backend tab_field_config rows ship the claim modifier as a numeric
		// field (type:'number'), whose <input type="number"> blocks letters at the
		// keyboard so "GT"/"E/M" could never be typed. Coerce any modifier field to
		// plain text and drop a numeric validationPattern so letters are accepted;
		// _collectFormatErrors then validates it with the alphanumeric modifier rule.
		// Fresh copies are made so a shared DEFAULT_FIELD_CONFIGS entry isn't mutated.
		if (config?.sections) {
			const isModifier = (f: FieldDef) => /modifier/i.test(f.key) || /^modifiers?$/i.test(f.label || '');
			if (config.sections.some(sec => (sec.fields || []).some(isModifier))) {
				config = {
					...config,
					sections: config.sections.map(sec => ({
						...sec,
						fields: (sec.fields || []).map(f => isModifier(f)
							? { ...f, type: f.type === 'number' ? 'text' : f.type, validationPattern: undefined }
							: f),
					})),
				};
			}
		}

		// apiPath override (e.g. /api/cds/alerts, /api/payments/transactions) — query string safe.
		// If apiPath contains {patientId}, substitute; otherwise append /patient/{id} for patient-scoped endpoints.
		// Non-patient-scoped endpoints (facility/locations) should use {patientId}-free path as-is.
		if (tab.apiPath) {
			let url: string;
			if (tab.apiPath.includes('{patientId}')) {
				// RCM endpoints key records by the DB patient id (the id the fee
				// sheet pushes charges under), not the FHIR id the chart may have
				// been opened with — mirror _clinicalPatientId's preference.
				const pid = tab.apiPath.startsWith('/api/app-proxy/ciyex-rcm') ? this._clinicalPatientId() : this.patientId;
				url = tab.apiPath.replace('{patientId}', pid);
				url += (url.includes('?') ? '&' : '?') + 'page=0&size=100';
			} else if (this._isPatientScoped(tab)) {
				const [base, query] = tab.apiPath.split('?');
				url = `${base}/patient/${this.patientId}${query ? `?${query}&page=0&size=100` : '?page=0&size=100'}`;
			} else {
				url = tab.apiPath + (tab.apiPath.includes('?') ? '&' : '?') + 'page=0&size=100';
			}
			try {
				const res = await this.apiService.fetch(url);
				if (res.ok) {
					const json = await res.json();
					const items = json?.data?.content || json?.content || (json?.data && !Array.isArray(json.data) ? [json.data] : (Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []));
					data = data.concat(items);
				}
			} catch { /* */ }
		}

		// FHIR-backed list: hit /api/fhir-resource/{tabKey}/patient/{id} for
		// patient-scoped resources, or /api/fhir-resource/{tabKey} for
		// org-level (Facility / Location). Backend resolves the resource type
		// from tab_field_config keyed by tabKey.
		if (tab.fhirResources.length > 0 && !tab.apiPath) {
			const slug = PatientChartEditor.TAB_API_SLUG[tab.key] || tab.key;
			const patientPath = this._isPatientScoped(tab) ? `/patient/${this.patientId}` : '';
			const url = `/api/fhir-resource/${slug}${patientPath}?page=0&size=100`;
			try {
				const res = await this.apiService.fetch(url);
				if (res.ok) {
					const json = await res.json();
					const items = json?.data?.content || json?.content || (json?.data && !Array.isArray(json.data) ? [json.data] : (Array.isArray(json?.data) ? json.data : []));
					console.log(`[patientChart] ${tab.key} GET ${url} → ${items.length} record(s)`, items);
					data = data.concat(items);
				} else {
					console.warn(`[patientChart] ${tab.key} GET ${url} failed: ${res.status}`);
				}
			} catch (e) {
				console.error(`[patientChart] ${tab.key} GET ${url} threw:`, e);
			}
		}
		// Documents uploaded through System → Document Scanning & OCR live in the
		// separate /api/document-scanning store, not as FHIR DocumentReferences —
		// so a scan tagged to this patient never appeared on the chart's Documents
		// tab (QA issue 10). Merge this patient's scans in as read-only rows
		// (they are managed — OCR/delete — from the Document Scanning module).
		if (tab.key === 'documents') {
			try {
				const res = await this.apiService.fetch('/api/document-scanning?page=0&size=200');
				if (res.ok) {
					const json = await res.json();
					const scans = (json?.data?.content || json?.content || []) as Record<string, unknown>[];
					const ids = this._patientIdSet();
					for (const s of (Array.isArray(scans) ? scans : [])) {
						if (!ids.has(String(s.patientId ?? '').trim())) { continue; }
						// Carry the name/category/date under EVERY key the column
						// config may use — the table columns come from the backend
						// tab_field_config (title/category/documentDate), while the
						// local fallback uses description/type/date.
						const docName = String(s.originalFileName || s.fileName || 'Scanned document');
						const category = String(s.category || 'scanned').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
						data.push({
							id: `scan-${s.id}`,
							title: docName, description: docName, name: docName,
							type: category, category: category, documentType: category,
							date: s.createdAt, documentDate: s.createdAt, created: s.createdAt, createdAt: s.createdAt,
							authorName: 'Document Scanning', author: 'Document Scanning',
							status: 'current',
							__readonly: true,
						});
					}
				}
			} catch { /* scanning store unreachable — chart still shows FHIR documents */ }
		}
		// The deployed education backend drops `deliveryMethod` / `educator`
		// (its DTO has no such columns), so the workspace persists them inside
		// the form-unused `notes` field as JSON. Decode them back here so the
		// table columns and the edit form populate. Issue: education delivery
		// method / educator blank after refresh.
		if (tab.key === 'education') {
			data = data.map(r => this._decodeEducationMeta(r));
		}
		// The clinical lab / immunization / referral endpoints are global — keep
		// only this patient's rows (mirrors how the clinical pages and the
		// snapshot filter client-side).
		if (tab.key === 'labs' || tab.key === 'lab-results' || tab.key === 'immunizations' || tab.key === 'referrals') {
			const ids = this._patientIdSet();
			data = data.filter(r => ids.has(String(r.patientId ?? r.patient ?? '')));
		}
		data = this._mergePendingCreates(tab.key, data);
		const result = { config, data };
		this._tabDataCache.set(tab.key, result);
		return result;
	}

	/**
	 * Education assignments persist `deliveryMethod` / `educator` as a JSON blob
	 * in the otherwise-unused `notes` field (the backend DTO has no columns for
	 * them). Parse that blob back onto the record so the table and edit form see
	 * the real values; records without our marker are returned untouched.
	 */
	private _decodeEducationMeta(record: Record<string, unknown>): Record<string, unknown> {
		const notes = record['notes'];
		if (typeof notes === 'string' && notes.trim().startsWith('{')) {
			try {
				const meta = JSON.parse(notes) as Record<string, unknown>;
				if (meta && meta['__ciyexEdu']) {
					return {
						...record,
						deliveryMethod: meta['deliveryMethod'] ?? record['deliveryMethod'],
						educator: meta['educator'] ?? record['educator'],
						notes: '',
					};
				}
			} catch { /* not our JSON — leave the record as-is */ }
		}
		return record;
	}

	private async _loadQuickInfo(): Promise<void> {
		// Each Quick Info row updates as soon as its own fetch returns — we don't
		// wait on Promise.all because a single slow endpoint must not freeze the
		// whole strip. Endpoints + response shapes mirror ehr-ui's ClinicalSidebar
		// (legacy /api/allergy-intolerances and /api/medical-problems return
		// {data:{allergiesList|problemsList:[…]}}; FHIR resource endpoints return
		// {data:{content:[…], totalElements:N}}).
		const extractCount = (json: unknown, listKey?: string): number | null => {
			const j = json as { data?: Record<string, unknown> } | null;
			const d = (j?.data ?? json) as Record<string, unknown> | undefined;
			if (!d) { return null; }
			if (listKey && Array.isArray(d[listKey])) { return (d[listKey] as unknown[]).length; }
			if (typeof d.totalElements === 'number') { return d.totalElements; }
			if (Array.isArray(d.content)) { return (d.content as unknown[]).length; }
			if (Array.isArray(d)) { return d.length; }
			return null;
		};
		const update = (key: keyof QuickInfo, value: string): void => {
			this.quickInfo[key] = value;
			const el = this._quickInfoValEls.get(key);
			if (el) { el.textContent = value; }
		};
		const run = (key: keyof QuickInfo, url: string, listKey: string | undefined, empty: string): void => {
			void (async () => {
				try {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { update(key, '—'); return; }
					const json = await res.json();
					const n = extractCount(json, listKey);
					update(key, n === null ? '—' : n === 0 ? empty : String(n));
				} catch { update(key, '—'); }
			})();
		};
		// Every empty row uses the SAME "No records" label — previously each row had
		// its own wording (NKA / None / No records / No recorded vitals), which the
		// test team flagged as inconsistent for an identical "nothing on file" state.
		run('allergies', `/api/allergy-intolerances/${this.patientId}`, 'allergiesList', 'No records');
		run('problems', `/api/medical-problems/${this.patientId}`, 'problemsList', 'No records');
		run('history', `/api/fhir-resource/history/patient/${this.patientId}?page=0&size=1`, undefined, 'No records');
		run('vitals', `/api/fhir-resource/vitals/patient/${this.patientId}?page=0&size=1`, undefined, 'No records');
	}

	// --- Header ---

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		const pd = (this.patientData || {}) as Record<string, unknown>;
		const name = this.patientName || `${String(pd.firstName || '')} ${String(pd.lastName || '')}`.trim() || 'Patient';
		const dobRaw = pd.dateOfBirth;
		const gender = this._genderLabel(String(pd.gender || ''));
		const mrn = String(pd.mrn || pd.medicalRecordNumber || pd.id || this.patientId);
		const phone = String(pd.phoneNumber || pd.phone || '');
		const rawStatus = String(pd.status || 'Active');
		const status = rawStatus === 'true' || rawStatus === 'Active' ? 'Active' : rawStatus;

		// Back arrow
		const back = DOM.append(this.headerBar, DOM.$('button'));
		back.textContent = '←';
		back.title = 'Back';
		back.style.cssText = 'background:transparent;border:none;color:var(--vscode-foreground);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;flex-shrink:0;';
		back.addEventListener('mouseenter', () => { back.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
		back.addEventListener('mouseleave', () => { back.style.background = 'transparent'; });
		back.addEventListener('click', () => { this.group.closeEditor(this.input!); });

		// Name
		const nameEl = DOM.append(this.headerBar, DOM.$('span'));
		nameEl.textContent = name;
		nameEl.style.cssText = 'font-size:14px;font-weight:700;color:var(--vscode-foreground);white-space:nowrap;flex-shrink:0;';

		// MRN pill
		if (mrn) {
			const pill = DOM.append(this.headerBar, DOM.$('span'));
			pill.textContent = `MRN: ${mrn}`;
			pill.style.cssText = 'font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(59,130,246,0.12);color:#3b82f6;white-space:nowrap;flex-shrink:0;';
		}

		// Demographics cluster (DOB · Sex · Phone). Grouped in one flex row with
		// its own gap + thin bullet separators so the fields always read as
		// distinct, evenly-spaced items — relying on the header's flex gap alone
		// previously left "…11 mo)Sex: female" running together (QA spacing flag).
		const demo = DOM.append(this.headerBar, DOM.$('div'));
		// The one shrinkable item: when the pane gets narrow it clips with an
		// ellipsis instead of wrapping, so the rest of the header stays one line.
		demo.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:11px;color:var(--vscode-descriptionForeground);min-width:0;flex-shrink:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
		const addDemo = (text: string): void => {
			if (demo.childElementCount > 0) {
				const sep = DOM.append(demo, DOM.$('span'));
				// allow-any-unicode-next-line
				sep.textContent = '·';
				sep.style.cssText = 'opacity:0.5;flex-shrink:0;';
			}
			const el = DOM.append(demo, DOM.$('span'));
			el.textContent = text;
			el.style.cssText = 'white-space:nowrap;flex-shrink:0;';
		};
		if (dobRaw) {
			const dobStr = this._formatDate(dobRaw);
			const age = this._calculateAge(dobRaw);
			addDemo(`DOB: ${dobStr}${age ? ` (${age})` : ''}`);
		}
		if (gender) { addDemo(`Sex: ${gender}`); }
		if (phone) { addDemo(`Phone: ${this._formatPhoneDisplay(phone)}`); }

		// Status pill
		const statusPill = DOM.append(this.headerBar, DOM.$('span'));
		statusPill.textContent = status;
		const statusColor = status === 'Active' ? '#22c55e' : status === 'Inactive' ? '#ef4444' : '#f59e0b';
		statusPill.style.cssText = `font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;background:${statusColor}20;color:${statusColor};white-space:nowrap;flex-shrink:0;`;

		// Spacer
		DOM.append(this.headerBar, DOM.$('span')).style.flex = '1';

		// Action buttons.
		// Encounters are no longer created manually from the patient chart — they
		// are auto-created when an appointment is marked "Completed" on the
		// Appointments page. The "+ New Encounter" button was removed so the only
		// path to an encounter is the appointment workflow.
		const btnStyle = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);white-space:nowrap;flex-shrink:0;';

		// Send the patient an intake form straight from their chart — opens the
		// shared intake form prefilled with this patient (no need to go to Portal
		// Management and search for someone whose chart is already open).
		const intakeBtn = DOM.append(this.headerBar, DOM.$('button'));
		intakeBtn.textContent = '\u{1F4E4} Send Intake';
		intakeBtn.style.cssText = btnStyle + 'margin-right:8px;';
		intakeBtn.addEventListener('click', () => {
			const pd = (this.patientData || {}) as Record<string, unknown>;
			this.commandService.executeCommand('ciyex.sendIntakeForm', {
				patientId: this.patientId,
				patientName: this.patientName,
				phone: String(pd.phoneNumber || pd.phone || '') || undefined,
				email: String(pd.email || '') || undefined,
			}).catch(() => { });
		});

		const schedBtn = DOM.append(this.headerBar, DOM.$('button'));
		schedBtn.textContent = '\u{1F4C5} Schedule Appointment';
		schedBtn.style.cssText = btnStyle;
		schedBtn.addEventListener('click', () => this._navigate('appointments'));
	}

	// --- Sidebar ---

	private _renderSidebar(): void {
		DOM.clearNode(this.sidebarEl);
		this._tabNavMap.clear();
		this._tabCountEls.clear();
		this._quickInfoValEls.clear();

		// CHART heading with collapse button. When collapsed the header drops
		// the "CHART" label entirely so the expand button is centred and
		// obvious — the test team flagged the previous "<" / ">" glyphs as
		// unrecognisable. Use double-chevron icons so the affordance reads
		// the same way it does in the EHR-UI sidebar.
		const chartHdr = DOM.append(this.sidebarEl, DOM.$('div'));
		chartHdr.style.cssText = this.sidebarCollapsed
			? 'display:flex;align-items:center;justify-content:center;padding:12px 0 8px;'
			: 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;';

		if (!this.sidebarCollapsed) {
			const chartLabel = DOM.append(chartHdr, DOM.$('span'));
			chartLabel.textContent = 'CHART';
			chartLabel.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
		}

		const collapseBtn = DOM.append(chartHdr, DOM.$('button'));
		// allow-any-unicode-next-line
		collapseBtn.textContent = this.sidebarCollapsed ? '»' : '«';
		collapseBtn.title = this.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
		collapseBtn.style.cssText = 'background:transparent;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:14px;font-weight:700;padding:2px 8px;border-radius:3px;';
		collapseBtn.addEventListener('mouseenter', () => { collapseBtn.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
		collapseBtn.addEventListener('mouseleave', () => { collapseBtn.style.background = 'transparent'; });
		collapseBtn.addEventListener('click', () => this._toggleSidebar());

		if (this.sidebarCollapsed) {
			// Icon-only collapsed mode — every visible tab from every category
			// renders as a small emoji button so the user can still navigate
			// without expanding. Mirrors the EHR-UI ClinicalSidebar collapsed
			// view that the test team flagged as missing.
			this.sidebarEl.style.width = '52px';
			const collapsedList = DOM.append(this.sidebarEl, DOM.$('div'));
			collapsedList.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;';
			for (const cat of this.categories) {
				for (const tab of cat.tabs) {
					if (tab.visible === false) { continue; }
					const item = DOM.append(collapsedList, DOM.$('div'));
					item.setAttribute('data-tab', tab.key);
					item.style.cssText = 'width:36px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:5px;font-size:16px;border-left:2px solid transparent;';
					item.textContent = tab.emoji || '\u{1F4CB}';
					item.title = `${cat.label}: ${tab.label}`;
					item.addEventListener('mouseenter', () => {
						if (this.activeTab !== tab.key) { item.style.background = 'var(--vscode-list-hoverBackground)'; }
					});
					item.addEventListener('mouseleave', () => {
						if (this.activeTab !== tab.key) { item.style.background = ''; }
					});
					item.addEventListener('click', () => this._navigate(tab.key));
					this._tabNavMap.set(tab.key, item);
				}
			}
			this._highlightActiveTab();
			return;
		}
		this.sidebarEl.style.width = '240px';

		// QUICK INFO section
		const qiHeader = DOM.append(this.sidebarEl, DOM.$('div'));
		qiHeader.textContent = 'QUICK INFO';
		qiHeader.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);padding:4px 14px 6px;';

		const qiBlock = DOM.append(this.sidebarEl, DOM.$('div'));
		qiBlock.style.cssText = 'padding:0 10px 12px;display:flex;flex-direction:column;gap:4px;';
		// Quick Info rows: Allergy, Problems, History, Vitals (no Medications —
		// per the test report request to remove medication from Quick Info).
		this._renderQuickInfoRow(qiBlock, 'allergies', '\u{1F6A8}', 'Allergies', this.quickInfo.allergies);
		this._renderQuickInfoRow(qiBlock, 'problems', '\u{1F90D}', 'Problems', this.quickInfo.problems);
		this._renderQuickInfoRow(qiBlock, 'history', '\u{1F4DC}', 'History', this.quickInfo.history);
		this._renderQuickInfoRow(qiBlock, 'vitals', '\u{1FAC0}', 'Vitals', this.quickInfo.vitals);

		// Category tabs — each category heading is a clickable dropdown. Clicking
		// toggles its tab list visible / hidden. Default state: every category
		// is collapsed; only the category that contains the active tab opens
		// automatically so the user sees where they are.
		for (const cat of this.categories) {
			if (cat.tabs.length === 0) { continue; }

			const catKey = `${CATEGORY_COLLAPSED_KEY_PREFIX}${cat.key}`;
			const containsActive = cat.tabs.some(t => t.key === this.activeTab);
			// Default: collapsed (true) unless this category contains the active tab.
			const stored = this.storageSvc.get(catKey, StorageScope.PROFILE);
			const collapsed = stored === undefined ? !containsActive : stored === 'true';

			const catHdr = DOM.append(this.sidebarEl, DOM.$('div'));
			catHdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:14px 14px 6px;cursor:pointer;user-select:none;';
			catHdr.title = 'Click to expand/collapse';

			const arrow = DOM.append(catHdr, DOM.$('span'));
			// allow-any-unicode-next-line
			arrow.textContent = collapsed ? '▸' : '▾';
			arrow.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);width:10px;flex-shrink:0;';

			const label = DOM.append(catHdr, DOM.$('span'));
			label.textContent = cat.label.toUpperCase();
			label.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);flex:1;';

			const tabsContainer = DOM.append(this.sidebarEl, DOM.$('div'));
			tabsContainer.style.display = collapsed ? 'none' : '';

			catHdr.addEventListener('click', () => {
				const isHidden = tabsContainer.style.display === 'none';
				tabsContainer.style.display = isHidden ? '' : 'none';
				// allow-any-unicode-next-line
				arrow.textContent = isHidden ? '▾' : '▸';
				this.storageSvc.store(catKey, isHidden ? 'false' : 'true', StorageScope.PROFILE, StorageTarget.USER);
			});

			for (const tab of cat.tabs) {
				const item = DOM.append(tabsContainer, DOM.$('div'));
				item.setAttribute('data-tab', tab.key);
				item.style.cssText = 'padding:6px 14px 6px 28px;cursor:pointer;color:var(--vscode-foreground);display:flex;align-items:center;gap:8px;font-size:13px;border-left:2px solid transparent;';

				if (tab.emoji) {
					const ic = DOM.append(item, DOM.$('span'));
					ic.textContent = tab.emoji;
					ic.style.cssText = 'font-size:13px;width:18px;text-align:center;flex-shrink:0;';
				}

				const lbl = DOM.append(item, DOM.$('span'));
				lbl.textContent = tab.label;
				lbl.style.cssText = 'flex:1;';

				// Record count badge — populated by _refreshTabCounts()
				const cnt = DOM.append(item, DOM.$('span'));
				const cached = this._tabCounts.get(tab.key);
				cnt.textContent = cached !== undefined && cached > 0 ? String(cached) : '';
				cnt.style.cssText = 'font-size:10px;font-weight:600;min-width:18px;height:16px;padding:0 5px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';
				cnt.style.visibility = cnt.textContent ? 'visible' : 'hidden';
				this._tabCountEls.set(tab.key, cnt);

				item.addEventListener('mouseenter', () => {
					if (this.activeTab !== tab.key) { item.style.background = 'var(--vscode-list-hoverBackground)'; }
				});
				item.addEventListener('mouseleave', () => {
					if (this.activeTab !== tab.key) { item.style.background = ''; }
				});
				item.addEventListener('click', () => this._navigate(tab.key));
				this._tabNavMap.set(tab.key, item);
			}
		}
		this._highlightActiveTab();
		// Kick off background count fetch (non-blocking)
		this._refreshTabCounts();
	}

	/** Fetch record counts for every list-style tab and update the sidebar badges. */
	private async _refreshTabCounts(): Promise<void> {
		const fetches: Array<Promise<void>> = [];
		for (const cat of this.categories) {
			for (const tab of cat.tabs) {
				if (tab.display === 'form' || tab.display === 'custom') { continue; }
				const ep = this._tabEndpoint(tab);
				if (!ep) { continue; }
				const url = this._buildCountUrl(tab, ep);
				if (!url) {
					// No count endpoint (the lab tabs read global stores filtered to the
					// patient client-side) — derive the badge from the loaded list length.
					const cachedLen = this._tabDataCache.get(tab.key)?.data.length ?? 0;
					this._tabCounts.set(tab.key, cachedLen);
					const el = this._tabCountEls.get(tab.key);
					if (el) { el.textContent = cachedLen > 0 ? String(cachedLen) : ''; el.style.visibility = cachedLen > 0 ? 'visible' : 'hidden'; }
					continue;
				}
				fetches.push((async () => {
					try {
						const res = await this.apiService.fetch(url);
						if (!res.ok) { return; }
						const json = await res.json();
						const total = json?.data?.totalElements ?? json?.totalElements
							?? (Array.isArray(json?.data?.content) ? json.data.content.length : (Array.isArray(json?.data) ? json.data.length : 0));
						let count = typeof total === 'number' ? total : 0;
						// Don't undercount records we're optimistically showing while
						// the server's FHIR search index catches up — keep the badge in
						// step with the list (which includes pending creates).
						const cachedLen = this._tabDataCache.get(tab.key)?.data.length;
						if (typeof cachedLen === 'number' && cachedLen > count) { count = cachedLen; }
						this._tabCounts.set(tab.key, count);
						const el = this._tabCountEls.get(tab.key);
						if (el) {
							el.textContent = count > 0 ? String(count) : '';
							el.style.visibility = count > 0 ? 'visible' : 'hidden';
						}
					} catch { /* ignore */ }
				})());
			}
		}
		await Promise.all(fetches);
	}

	/** Mirror the URL shape used by _loadTabData so counts match what the list shows. */
	private _buildCountUrl(tab: ChartTab, ep: string): string | null {
		// Lab / immunization / referral tabs read global clinical stores and
		// filter to the patient client-side — a count query would return every
		// patient's rows. Return null so the badge derives from the
		// patient-filtered list (see caller).
		if (tab.key === 'labs' || tab.key === 'lab-results' || tab.key === 'immunizations' || tab.key === 'referrals') { return null; }
		if (tab.apiPath) {
			if (tab.apiPath.includes('{patientId}')) {
				// Keep in lockstep with _loadTabData: RCM tabs substitute the DB
				// patient id so the badge counts the same rows the list shows.
				const pid = tab.apiPath.startsWith('/api/app-proxy/ciyex-rcm') ? this._clinicalPatientId() : this.patientId;
				const base = tab.apiPath.replace('{patientId}', pid);
				return base + (base.includes('?') ? '&' : '?') + 'page=0&size=1';
			}
			if (this._isPatientScoped(tab)) {
				const [base, query] = tab.apiPath.split('?');
				return `${base}/patient/${this.patientId}${query ? `?${query}&page=0&size=1` : '?page=0&size=1'}`;
			}
			return tab.apiPath + (tab.apiPath.includes('?') ? '&' : '?') + 'page=0&size=1';
		}
		// FHIR resource path: /api/fhir-resource/<plural>/patient/{id}
		return `${ep}/patient/${this.patientId}?page=0&size=1`;
	}

	private _renderQuickInfoRow(parent: HTMLElement, key: string, icon: string, label: string, value: string): void {
		const row = DOM.append(parent, DOM.$('div'));
		row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;font-size:12px;cursor:pointer;';
		// Quick Info rows are navigation shortcuts — clicking Allergies / Problems
		// / History / Vitals jumps the chart to that tab. Mirrors the EHR-UI
		// ClinicalSidebar behaviour the test team flagged as missing.
		row.title = `Open ${label}`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });
		row.addEventListener('click', () => this._navigate(key));

		const ic = DOM.append(row, DOM.$('span'));
		ic.textContent = icon;
		ic.style.cssText = 'font-size:13px;width:18px;text-align:center;flex-shrink:0;';

		const lbl = DOM.append(row, DOM.$('span'));
		lbl.textContent = `${label}:`;
		lbl.style.cssText = 'font-weight:600;color:var(--vscode-foreground);';

		const val = DOM.append(row, DOM.$('span'));
		val.textContent = value;
		val.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:11px;';
		this._quickInfoValEls.set(key, val);
	}


	private _highlightActiveTab(): void {
		this._tabNavMap.forEach((el, key) => {
			const isActive = key === this.activeTab;
			// Active item: a MUTED, theme-following selection tint (light grey on
			// light themes, dark grey on dark) rather than `list-activeSelectionBackground`,
			// which is a saturated blue on light themes and looked out of place on
			// the white workbench (QA flag). The accent left-border + bold label
			// carry the "selected" affordance, so the background can stay subtle.
			el.style.borderLeftColor = isActive ? 'var(--vscode-focusBorder, #007acc)' : 'transparent';
			el.style.background = isActive ? 'var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground, rgba(127,127,127,0.12)))' : '';
			el.style.fontWeight = isActive ? '600' : '';
		});
	}

	private _toggleSidebar(): void {
		this.sidebarCollapsed = !this.sidebarCollapsed;
		this.storageSvc.store(SIDEBAR_COLLAPSED_KEY, this.sidebarCollapsed, StorageScope.PROFILE, StorageTarget.USER);
		this._renderSidebar();
	}

	private _navigate(tabKey: string): void {
		this.activeTab = tabKey;
		this.storageSvc.store(LAST_TAB_KEY_PREFIX + this.patientId, tabKey, StorageScope.PROFILE, StorageTarget.USER);
		this._highlightActiveTab();
		this._renderMain();
		this.mainEl.scrollTop = 0;
	}

	// --- Main panel ---

	private _renderMain(): void {
		DOM.clearNode(this.mainEl);
		const tab = this._findTab(this.activeTab);
		if (!tab) {
			const msg = DOM.append(this.mainEl, DOM.$('div'));
			msg.textContent = 'Tab not found.';
			msg.style.cssText = 'color:var(--vscode-descriptionForeground);padding:24px;';
			return;
		}

		if (tab.key === 'dashboard') {
			this._renderDashboard();
			return;
		}

		this._renderGenericTab(tab);
	}

	private _findTab(key: string): ChartTab | null {
		for (const cat of this.categories) {
			const t = cat.tabs.find(t => t.key === key);
			if (t) { return t; }
		}
		return null;
	}

	// --- Dashboard view ---

	private _renderDashboard(): void {
		// Dispose the previous render's pagination controls before building new
		// ones (this method runs on every tab switch back to the dashboard).
		this._dashboardDisposables.clear();

		// Recent & Upcoming card
		const card = DOM.append(this.mainEl, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:20px;margin-bottom:20px;';

		const title = DOM.append(card, DOM.$('h3'));
		title.textContent = 'Recent & Upcoming';
		title.style.cssText = 'margin:0 0 16px;font-size:16px;font-weight:600;color:var(--vscode-foreground);';

		const grid = DOM.append(card, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:24px;';

		// Recent Activity
		const recent = DOM.append(grid, DOM.$('div'));
		const recentHdr = DOM.append(recent, DOM.$('h4'));
		recentHdr.textContent = 'Recent Activity';
		recentHdr.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;color:#3b82f6;';
		const recentList = DOM.append(recent, DOM.$('div'));
		recentList.setAttribute('data-slot', 'recent-activity');
		const loading1 = DOM.append(recentList, DOM.$('div'));
		loading1.textContent = 'Loading...';
		loading1.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;padding:8px 0;';

		// Upcoming
		const upcoming = DOM.append(grid, DOM.$('div'));
		const upHdrRow = DOM.append(upcoming, DOM.$('div'));
		upHdrRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;';
		const upHdr = DOM.append(upHdrRow, DOM.$('h4'));
		upHdr.textContent = 'Upcoming';
		upHdr.style.cssText = 'margin:0;font-size:13px;font-weight:600;color:#3b82f6;';
		const viewAll = DOM.append(upHdrRow, DOM.$('a'));
		// allow-any-unicode-next-line
		viewAll.textContent = 'View all →';
		viewAll.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		viewAll.addEventListener('click', () => this._navigate('appointments'));

		const upList = DOM.append(upcoming, DOM.$('div'));
		upList.setAttribute('data-slot', 'upcoming-appointments');
		const upLoading = DOM.append(upList, DOM.$('div'));
		upLoading.textContent = 'Loading...';
		upLoading.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;padding:8px 0;';

		void this._loadRecentActivity(recentList);
		void this._loadUpcomingAppointments(upList);

		// Summary cards grid — mirrors the OpenEMR patient summary dashboard,
		// one widget per clinical domain. Each card pulls its own resource and
		// links to the matching chart tab via "View all".
		const cardsGrid = DOM.append(this.mainEl, DOM.$('div'));
		cardsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:16px;';
		this._renderDemographicsCard(cardsGrid);
		this._renderSummaryCard(cardsGrid, 'allergies', '\u{1F6E1}\u{FE0F}', 'Allergies', 'AllergyIntolerance', ['allergyName', 'name', 'code', 'substance'], 'NKA — No Known Allergies');
		this._renderSummaryCard(cardsGrid, 'problems', '\u{1F90D}', 'Medical Problems', 'Condition', ['conditionName', 'condition', 'code', 'display'], 'No problems recorded');
		this._renderSummaryCard(cardsGrid, 'medications', '\u{1F48A}', 'Medications', 'MedicationRequest', ['medicationName', 'medication', 'name', 'code', 'display'], 'No active medications');
		this._renderSummaryCard(cardsGrid, 'vitals', '\u{2764}\u{FE0F}', 'Vitals', 'Observation', ['vitalName', 'observationName', 'name', 'code', 'display', 'value'], 'No vitals recorded');
		this._renderSummaryCard(cardsGrid, 'lab-results', '\u{1F9EA}', 'Lab Results', 'DiagnosticReport', ['testName', 'reportName', 'name', 'code', 'display'], 'No lab results');
		this._renderSummaryCard(cardsGrid, 'immunizations', '\u{1F489}', 'Immunizations', 'Immunization', ['vaccineName', 'vaccine', 'name', 'code', 'display'], 'No immunizations');
		this._renderSummaryCard(cardsGrid, 'procedures', '\u{1FA7A}', 'Procedures', 'Procedure', ['procedureName', 'procedure', 'name', 'code', 'display'], 'No procedures');
		this._renderSummaryCard(cardsGrid, 'documents', '\u{1F4C4}', 'Documents', 'DocumentReference', ['description', 'title', 'name', 'type'], 'No documents');
		this._renderSummaryCard(cardsGrid, 'insurance', '\u{1F512}', 'Insurance', 'Coverage', ['payerName', 'insurerName', 'organizationDisplay', 'planName'], 'No insurance on file');
		this._renderPortalAccountCard(cardsGrid);
	}

	/**
	 * Demographics / contact summary card built from the already-loaded patient
	 * record (no fetch). Mirrors the OpenEMR demographics widget — the key
	 * identity + contact fields with a "View all" link to the Demographics tab.
	 */
	private _renderDemographicsCard(parent: HTMLElement): void {
		const pd = (this.patientData || {}) as Record<string, unknown>;
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;';

		const hdr = DOM.append(card, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
		const titleRow = DOM.append(hdr, DOM.$('div'));
		titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const ic = DOM.append(titleRow, DOM.$('span'));
		ic.textContent = '\u{1F464}';
		ic.style.cssText = 'font-size:16px;';
		const t = DOM.append(titleRow, DOM.$('span'));
		t.textContent = 'Demographics';
		t.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';
		const viewAll = DOM.append(hdr, DOM.$('a'));
		viewAll.textContent = 'View all';
		viewAll.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		viewAll.addEventListener('click', () => this._navigate('demographics'));

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'font-size:12px;color:var(--vscode-foreground);min-height:40px;';

		const dob = this._formatDate(pd.dateOfBirth) || String(pd.dateOfBirth || '');
		// `address` may arrive as a nested object ({ line1, line2, city, state,
		// postalCode }), a plain string, or flattened top-level fields — handle
		// all three so the card never renders a bare "[object Object]".
		const addr = (pd.address && typeof pd.address === 'object') ? pd.address as Record<string, unknown> : {};
		const addrString = typeof pd.address === 'string' ? pd.address : '';
		const address = [
			pd.addressLine1 || addr.line1 || addr.line || addrString || pd.street,
			addr.line2,
			pd.city || addr.city,
			pd.state || addr.state,
			pd.postalCode || pd.zip || pd.zipcode || addr.postalCode || addr.zip,
		].map(v => String(v || '').trim()).filter(Boolean).join(', ');
		const rows: Array<[string, string]> = [
			['MRN', String(pd.mrn || pd.medicalRecordNumber || pd.id || this.patientId)],
			['DOB', dob],
			['Sex', this._genderLabel(String(pd.gender || ''))],
			['Phone', String(pd.phoneNumber || pd.phone || '')],
			['Email', String(pd.email || '')],
			['Address', address],
		];
		let painted = 0;
		for (const [label, value] of rows) {
			if (!value) { continue; }
			painted++;
			const row = DOM.append(body, DOM.$('div'));
			row.style.cssText = 'display:flex;gap:6px;padding:3px 0;';
			const l = DOM.append(row, DOM.$('span'));
			l.textContent = `${label}:`;
			l.style.cssText = 'color:var(--vscode-descriptionForeground);flex-shrink:0;min-width:54px;';
			const v = DOM.append(row, DOM.$('span'));
			v.textContent = value;
			v.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		}
		if (painted === 0) { body.textContent = 'No demographics on file'; }
	}

	/**
	 * Wire a vertical list into `parent` backed by a {@link PaginationControl}.
	 * Returns an `update(items, done?)` callback: call it whenever the data set
	 * changes (e.g. as async sources resolve). The control is registered to
	 * `_dashboardDisposables` so it's cleaned up on the next dashboard render.
	 *
	 * While `done` is false the list shows a "Loading…" placeholder for an empty
	 * set; once `done` is true an empty set shows `opts.emptyMessage` instead.
	 */
	private _createPaginatedFeed<T>(
		parent: HTMLElement,
		renderRow: (item: T, container: HTMLElement) => void,
		opts: { pageSize?: number; itemLabel?: string; emptyMessage?: string },
	): (items: readonly T[], done?: boolean) => void {
		DOM.clearNode(parent);
		const listEl = DOM.append(parent, DOM.$('div'));
		const pagerHost = DOM.append(parent, DOM.$('div'));

		let current: readonly T[] = [];
		let finished = false;

		const showMessage = (text: string): void => {
			const el = DOM.append(listEl, DOM.$('div'));
			el.textContent = text;
			el.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;padding:8px 0;';
		};

		const renderPage = (): void => {
			DOM.clearNode(listEl);
			if (current.length === 0) {
				showMessage(finished ? (opts.emptyMessage ?? '') : 'Loading...');
				return;
			}
			for (const item of pager.slice(current)) { renderRow(item, listEl); }
		};

		const pager = this._dashboardDisposables.add(new PaginationControl({
			pageSize: opts.pageSize ?? 5,
			pageSizeOptions: [5, 10, 25],
			itemLabel: opts.itemLabel ?? 'items',
			showPageNumbers: false,
			onChange: () => renderPage(),
		}));
		pagerHost.appendChild(pager.element);
		renderPage();

		return (items: readonly T[], done = true) => {
			current = items;
			finished = done;
			pager.setTotal(items.length);
			renderPage();
		};
	}

	private async _loadRecentActivity(parent: HTMLElement): Promise<void> {
		interface ActivityItem { title: string; description: string; timestamp: string; sortKey: number; status: string; emoji: string }
		const acts: ActivityItem[] = [];

		// Fetch the most recent N records from each resource in parallel.
		// We merge them into a single timeline, sorted newest-first.
		const sources: Array<{ ep: string; emoji: string; build: (it: Record<string, unknown>) => ActivityItem | null }> = [
			{
				ep: `${FHIR_MAP['Appointment']}/patient/${this.patientId}?page=0&size=50`,
				emoji: '\u{1F4C5}',
				build: (a) => ({
					// Show just the visit type (Consultation, Telehealth, Annual
					// Physical, …) — the calendar icon already marks it as an
					// appointment, so the redundant "Appointment:" prefix is dropped.
					title: this._displayText(a.appointmentType) || this._displayText(a.visitType) || 'Appointment',
					description: String(a.appointmentStartTime || this._formatDate(a.appointmentStartDate) || ''),
					timestamp: this._formatDate(a.appointmentStartDate) || '',
					sortKey: this._toEpoch(a.appointmentStartDate),
					status: String(a.status || 'scheduled'),
					emoji: '\u{1F4C5}',
				}),
			},
			{
				ep: `${FHIR_MAP['Encounter']}/patient/${this.patientId}?page=0&size=50`,
				emoji: '\u{1F4CB}',
				build: (e) => ({
					title: `Encounter: ${this._displayText(e.visitType) || this._displayText(e.type) || 'Visit'}`,
					description: this._displayText(e.providerName) || this._displayText(e.practitionerName) || '',
					timestamp: this._formatDate(e.startDate || e.start) || '',
					sortKey: this._toEpoch(e.startDate || e.start),
					status: String(e.status || ''),
					emoji: '\u{1F4CB}',
				}),
			},
			{
				ep: `${FHIR_MAP['AllergyIntolerance']}/patient/${this.patientId}?page=0&size=50`,
				emoji: '\u{1F6A8}',
				build: (a) => {
					// Allergy display can come back as a CodeableConcept object
					// — extract `.text` / `.coding[0].display` so the dashboard
					// doesn't render "Allergy: " or "[object Object]". Same for
					// every supporting field below.
					const name = this._displayText(a.allergyName) || this._displayText(a.name) || this._displayText(a.code) || this._displayText(a.substance);
					if (!name) { return null; }
					const reaction = this._displayText(a.reaction) || this._displayText(a.manifestation) || this._displayText(a.severity) || '';
					return {
						title: `Allergy: ${name}`,
						description: reaction,
						timestamp: this._formatDate(a.startDate || a.recordedDate || a.onsetDate || a.onsetDateTime) || '',
						sortKey: this._toEpoch(a.startDate || a.recordedDate || a.onsetDate || a.onsetDateTime),
						status: this._displayText(a.status) || this._displayText(a.clinicalStatus) || 'active',
						emoji: '\u{1F6A8}',
					};
				},
			},
			{
				ep: `${FHIR_MAP['Condition']}/patient/${this.patientId}?page=0&size=50`,
				emoji: '\u{26A0}\u{FE0F}',
				build: (c) => {
					const name = this._displayText(c.conditionName) || this._displayText(c.condition) || this._displayText(c.code) || this._displayText(c.display);
					if (!name) { return null; }
					return {
						title: `Problem: ${name}`,
						description: this._displayText(c.severity) || '',
						timestamp: this._formatDate(c.onsetDate || c.onsetDateTime || c.recordedDate) || '',
						sortKey: this._toEpoch(c.onsetDate || c.onsetDateTime || c.recordedDate),
						status: this._displayText(c.clinicalStatus) || this._displayText(c.status) || 'active',
						emoji: '\u{26A0}\u{FE0F}',
					};
				},
			},
			{
				ep: `${FHIR_MAP['MedicationRequest']}/patient/${this.patientId}?page=0&size=50`,
				emoji: '\u{1F48A}',
				build: (m) => ({
					title: `Medication: ${this._displayText(m.medicationName) || this._displayText(m.medication) || ''}`,
					description: this._displayText(m.dosage) || '',
					timestamp: this._formatDate(m.startDate || m.authoredOn) || '',
					sortKey: this._toEpoch(m.startDate || m.authoredOn),
					status: String(m.status || ''),
					emoji: '\u{1F48A}',
				}),
			},
		];

		const renderRow = (act: ActivityItem, container: HTMLElement): void => {
			const row = DOM.append(container, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.08);';

			const ic = DOM.append(row, DOM.$('div'));
			ic.textContent = act.emoji;
			ic.style.cssText = 'font-size:18px;padding-top:2px;';

			const content = DOM.append(row, DOM.$('div'));
			content.style.cssText = 'flex:1;min-width:0;';

			const titleRow = DOM.append(content, DOM.$('div'));
			titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
			const t = DOM.append(titleRow, DOM.$('span'));
			t.textContent = act.title;
			t.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-foreground);';
			const badge = DOM.append(titleRow, DOM.$('span'));
			badge.textContent = act.status;
			badge.style.cssText = 'font-size:10px;padding:1px 8px;border-radius:10px;background:rgba(59,130,246,0.15);color:#3b82f6;';

			const desc = DOM.append(content, DOM.$('div'));
			desc.textContent = act.description;
			desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';

			const time = DOM.append(content, DOM.$('div'));
			time.textContent = act.timestamp;
			time.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		};

		// Paginated feed over the full merged timeline — no longer capped at 8.
		const update = this._createPaginatedFeed<ActivityItem>(parent, renderRow, { pageSize: 5, itemLabel: 'records', emptyMessage: 'No recent activity' });
		const repaint = (done: boolean): void => {
			acts.sort((a, b) => b.sortKey - a.sortKey);
			update(acts, done);
		};

		// Each source feeds its rows in as soon as its fetch returns; we no longer
		// block the whole "Recent Activity" section on the slowest endpoint.
		const tasks = sources.map(async (src) => {
			try {
				const res = await this.apiService.fetch(src.ep);
				if (!res.ok) { return; }
				const json = await res.json();
				const items = (json?.data?.content || json?.content || (Array.isArray(json?.data) ? json.data : [])) as Record<string, unknown>[];
				let added = false;
				for (const it of items) {
					const act = src.build(it);
					if (act && act.title.trim()) { acts.push(act); added = true; }
				}
				if (added) { repaint(false); }
			} catch { /* ignore source */ }
		});

		await Promise.allSettled(tasks);
		// Final repaint flips the feed to "done" so an empty timeline shows the
		// empty state instead of the loading placeholder.
		repaint(true);
	}

	/**
	 * Right-hand "Upcoming" panel on the Dashboard. Pulls the patient's
	 * scheduled appointments from the same FHIR Appointment endpoint as the
	 * Appointments tab and paints them as a paginated list (5 per page) so the
	 * full upcoming schedule is reachable, not just the next few. Empty state
	 * mirrors the ehr-ui dashboard's "Go to Appointments" call to action.
	 */
	private async _loadUpcomingAppointments(parent: HTMLElement): Promise<void> {
		const ep = `${FHIR_MAP['Appointment']}/patient/${this.patientId}?page=0&size=50`;
		try {
			const res = await this.apiService.fetch(ep);
			if (!res.ok) { throw new Error('appointments fetch failed'); }
			const json = await res.json();
			const all = (json?.data?.content || json?.content || (Array.isArray(json?.data) ? json.data : [])) as Record<string, unknown>[];
			const todayMs = Date.now();
			const items = all
				.map(a => {
					const start = String(a.appointmentStartDate || a.start || a.startDate || a.appointmentStartTime || '');
					const ms = start ? new Date(start).getTime() : 0;
					return { a, start, ms };
				})
				.filter(x => x.ms && x.ms >= todayMs - 24 * 3600 * 1000)
				.sort((x, y) => x.ms - y.ms);

			DOM.clearNode(parent);
			if (items.length === 0) {
				const upBox = DOM.append(parent, DOM.$('div'));
				upBox.style.cssText = 'background:var(--vscode-editor-background);border:1px dashed var(--vscode-editorWidget-border);border-radius:6px;padding:24px;text-align:center;';
				const upIcon = DOM.append(upBox, DOM.$('div'));
				upIcon.textContent = '\u{1F4C5}';
				upIcon.style.cssText = 'font-size:28px;margin-bottom:6px;';
				const upText = DOM.append(upBox, DOM.$('div'));
				upText.textContent = 'No upcoming appointments';
				upText.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:8px;';
				const goLink = DOM.append(upBox, DOM.$('a'));
				// allow-any-unicode-next-line
				goLink.textContent = 'Go to Appointments →';
				goLink.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
				goLink.addEventListener('click', () => this._navigate('appointments'));
				return;
			}

			const renderRow = (item: { a: Record<string, unknown>; start: string }, container: HTMLElement): void => {
				const { a, start } = item;
				const row = DOM.append(container, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.08);cursor:pointer;';
				row.addEventListener('click', () => this._navigate('appointments'));

				const ic = DOM.append(row, DOM.$('div'));
				ic.textContent = '\u{1F4C5}';
				ic.style.cssText = 'font-size:18px;padding-top:2px;';

				const content = DOM.append(row, DOM.$('div'));
				content.style.cssText = 'flex:1;min-width:0;';

				const titleRow = DOM.append(content, DOM.$('div'));
				titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
				const t = DOM.append(titleRow, DOM.$('span'));
				const visit = this._displayText(a.appointmentType) || this._displayText(a.visitType) || this._displayText(a.type) || 'Appointment';
				t.textContent = visit;
				t.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-foreground);';
				const badge = DOM.append(titleRow, DOM.$('span'));
				badge.textContent = this._displayText(a.status) || 'scheduled';
				badge.style.cssText = 'font-size:10px;padding:1px 8px;border-radius:10px;background:rgba(59,130,246,0.15);color:#3b82f6;';

				const desc = DOM.append(content, DOM.$('div'));
				const prov = this._displayText(a.providerName) || this._displayText(a.providerDisplay) || this._displayText(a.practitionerName) || '';
				desc.textContent = prov;
				desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';

				const time = DOM.append(content, DOM.$('div'));
				time.textContent = this._formatDate(start) || start;
				time.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;';
			};

			const update = this._createPaginatedFeed<{ a: Record<string, unknown>; start: string }>(parent, renderRow, { pageSize: 5, itemLabel: 'appointments' });
			update(items, true);
		} catch {
			DOM.clearNode(parent);
			const upBox = DOM.append(parent, DOM.$('div'));
			upBox.style.cssText = 'background:var(--vscode-editor-background);border:1px dashed var(--vscode-editorWidget-border);border-radius:6px;padding:24px;text-align:center;';
			const upText = DOM.append(upBox, DOM.$('div'));
			upText.textContent = 'Could not load appointments';
			upText.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:8px;';
			const goLink = DOM.append(upBox, DOM.$('a'));
			// allow-any-unicode-next-line
			goLink.textContent = 'Go to Appointments →';
			goLink.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
			goLink.addEventListener('click', () => this._navigate('appointments'));
		}
	}

	private _renderSummaryCard(parent: HTMLElement, navTab: string, icon: string, title: string, resource: string, displayFields: string | string[], emptyMsg: string): void {
		const fieldList = Array.isArray(displayFields) ? displayFields : [displayFields];
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;';

		const hdr = DOM.append(card, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';

		const titleRow = DOM.append(hdr, DOM.$('div'));
		titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const ic = DOM.append(titleRow, DOM.$('span'));
		ic.textContent = icon;
		ic.style.cssText = 'font-size:16px;';
		const t = DOM.append(titleRow, DOM.$('span'));
		t.textContent = title;
		t.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';

		const viewAll = DOM.append(hdr, DOM.$('a'));
		viewAll.textContent = 'View all';
		viewAll.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		viewAll.addEventListener('click', () => this._navigate(navTab));

		const body = DOM.append(card, DOM.$('div'));
		body.setAttribute('data-card-body', resource);
		body.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);min-height:40px;';
		body.textContent = 'Loading...';

		void (async () => {
			const renderItems = (items: Record<string, unknown>[]) => {
				DOM.clearNode(body);
				if (items.length === 0) { body.textContent = emptyMsg; return; }
				for (const item of items.slice(0, 3)) {
					const row = DOM.append(body, DOM.$('div'));
					row.style.cssText = 'padding:3px 0;font-size:12px;color:var(--vscode-foreground);';
					let text = '';
					// Vitals rows have no single "name" — they carry measurement
					// columns (weightKg, bpSystolic, pulse, …). Format a compact
					// summary instead of falling through to the raw record id.
					if (navTab === 'vitals') { text = this._formatVitalsSummary(item); }
					if (!text) { for (const f of fieldList) { text = this._displayText(item[f]); if (text) { break; } } }
					if (!text) { text = this._displayText(item.name) || this._displayText(item.code) || ''; }
					// Last-ditch: pull any string-like field off the row so a
					// FHIR record with `code.text` / `valueCodeableConcept` etc.
					// never paints as a dash even though the field-list missed
					// the actual key.
					if (!text) {
						for (const v of Object.values(item)) {
							const t = this._displayText(v);
							if (t && t.length > 1 && !/^[0-9a-f-]{20,}$/i.test(t)) { text = t; break; }
						}
					}
					row.textContent = (text || '—').substring(0, 50);
				}
			};
			// Try every endpoint shape we know — the Quick Info badge counts use
			// the legacy `/api/allergy-intolerances/{id}` (returns
			// `data.allergiesList`); the FHIR controller returns `data.content`.
			// The summary cards must paint whichever returns data so they stop
			// showing "No problems recorded" / "NKA" while the badge count is 2.
			const legacyMap: Record<string, string> = {
				'AllergyIntolerance': `/api/allergy-intolerances/${this.patientId}`,
				'Condition': `/api/medical-problems/${this.patientId}`,
			};
			const fhirEp = FHIR_MAP[resource] || `/api/fhir-resource/${resource.toLowerCase()}s`;
			const tryUrl = async (url: string): Promise<Record<string, unknown>[]> => {
				try {
					const r = await this.apiService.fetch(url);
					if (!r.ok) { return []; }
					const j = await r.json();
					const d = (j?.data ?? j ?? {}) as Record<string, unknown>;
					const out = (d.allergiesList || d.problemsList || d.content || d.list || d.items || d.records
						|| (Array.isArray(d) ? d : [])) as Record<string, unknown>[];
					return Array.isArray(out) ? out : [];
				} catch { return []; }
			};
			try {
				// Labs live in the clinical /api/lab-results store (global, filtered to
				// this patient client-side) — not a FHIR resource — so the dashboard
				// card reads them straight from there.
				if (navTab === 'lab-results' || navTab === 'labs') {
					const all = await tryUrl('/api/lab-results?page=0&size=500');
					const ids = this._patientIdSet();
					renderItems(all.filter(r => ids.has(String(r.patientId ?? r.patient ?? ''))).slice(0, 3));
					return;
				}
				// Immunizations live in the clinical /api/immunizations store
				// (global, filtered to this patient client-side) — not a FHIR
				// resource. Reading the FHIR endpoint painted rows for OTHER data
				// (a bare resource id like "15363") that the patient's
				// Immunizations tab never showed (QA issue 5).
				if (navTab === 'immunizations') {
					const all = await tryUrl('/api/immunizations?page=0&size=500');
					const ids = this._patientIdSet();
					renderItems(all.filter(r => ids.has(String(r.patientId ?? r.patient ?? ''))).slice(0, 3));
					return;
				}
				let items = await tryUrl(`${fhirEp}/patient/${this.patientId}?page=0&size=3`);
				if (items.length === 0 && legacyMap[resource]) {
					items = await tryUrl(legacyMap[resource]);
				}
				// Some resources are served under their TAB slug rather than the FHIR
				// resource name — e.g. vitals are stored under the `vitals` tab, so
				// FHIR_MAP['Observation'] → /observations returns "No configuration
				// found for tab: observations" while /vitals has the data. Fall back
				// to the nav-tab slug so the card paints the real records.
				if (items.length === 0) {
					const slugEp = `/api/fhir-resource/${navTab}`;
					if (slugEp !== fhirEp) {
						items = await tryUrl(`${slugEp}/patient/${this.patientId}?page=0&size=3`);
					}
				}
				renderItems(items);
			} catch {
				body.textContent = emptyMsg;
			}
		})();
	}

	/**
	 * Compact one-line summary of a vitals recording for the dashboard card.
	 * A vitals record carries measurement columns (bpSystolic, pulse, …) rather
	 * than a single display name, so show the recorded date plus key readings.
	 */
	private _formatVitalsSummary(item: Record<string, unknown>): string {
		const num = (k: string): string => {
			const v = item[k];
			return v === null || v === undefined ? '' : String(v).trim();
		};
		const parts: string[] = [];
		const sys = num('bpSystolic'); const dia = num('bpDiastolic');
		if (sys && dia) { parts.push(`BP ${sys}/${dia}`); }
		const hr = num('pulse'); if (hr) { parts.push(`HR ${hr}`); }
		const temp = num('temperatureC'); if (temp) { parts.push(`Temp ${temp}C`); }
		const spo2 = num('oxygenSaturation'); if (spo2) { parts.push(`SpO2 ${spo2}%`); }
		const wt = num('weightKg'); if (wt && parts.length < 3) { parts.push(`Wt ${wt}kg`); }
		if (parts.length === 0) { return ''; }
		const when = this._formatDate(num('recordedAt') || num('effectiveDateTime') || num('_lastUpdated'));
		return when ? `${when}: ${parts.join(', ')}` : parts.join(', ');
	}

	private _renderPortalAccountCard(parent: HTMLElement): void {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;';

		const hdrRow = DOM.append(card, DOM.$('div'));
		hdrRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;';
		const ic = DOM.append(hdrRow, DOM.$('span'));
		ic.textContent = '\u{2705}';
		ic.style.cssText = 'font-size:16px;';
		const t = DOM.append(hdrRow, DOM.$('span'));
		t.textContent = 'Portal Account';
		t.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';

		const email = String((this.patientData as Record<string, unknown>).email || '');
		const emailRow = DOM.append(card, DOM.$('div'));
		emailRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:12px;color:var(--vscode-foreground);';
		const dot = DOM.append(emailRow, DOM.$('span'));
		dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0;';
		const emailEl = DOM.append(emailRow, DOM.$('span'));
		emailEl.textContent = email || 'No email on file';
		emailEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		const btnRow = DOM.append(card, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';

		const mkBtn = (label: string, color: string, bg: string, fn: () => void) => {
			const b = DOM.append(btnRow, DOM.$('button'));
			b.textContent = label;
			b.style.cssText = `padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:1px solid ${color}40;background:${bg};color:${color};`;
			b.addEventListener('click', fn);
		};
		mkBtn('\u{1F511} Reset Password', 'var(--vscode-foreground)', 'var(--vscode-button-secondaryBackground)', () => this.notificationService.info('Reset Password — coming soon'));
		mkBtn('\u{2709} Email Reset', 'var(--vscode-foreground)', 'var(--vscode-button-secondaryBackground)', () => this.notificationService.info('Email Reset — coming soon'));
		mkBtn('\u{26D4} Block', '#ef4444', 'transparent', () => this.notificationService.info('Block — coming soon'));
	}

	// --- Generic tab (list or form) ---

	private _formInputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
	/** Visible MM/DD/YYYY input for each date field, keyed by field key, so the
	 *  save guard can highlight/focus an invalid date without DOM selectors. */
	private _dateVisibleByKey = new Map<string, HTMLInputElement>();
	// Parallel map of field cell containers, keyed the same way as `_formInputs`.
	// Used for inline validation (red-border + per-field error message).
	private _formCells = new Map<string, HTMLElement>();

	private async _renderGenericTab(tab: ChartTab): Promise<void> {
		// Section card header
		const card = DOM.append(this.mainEl, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const hdr = DOM.append(card, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px;background:rgba(0,122,204,0.08);border-bottom:1px solid var(--vscode-editorWidget-border);';

		if (tab.emoji) {
			const ic = DOM.append(hdr, DOM.$('span'));
			ic.textContent = tab.emoji;
			ic.style.cssText = 'font-size:16px;';
		}
		const t = DOM.append(hdr, DOM.$('span'));
		t.textContent = tab.label;
		t.style.cssText = 'font-size:14px;font-weight:600;';
		const countEl = DOM.append(hdr, DOM.$('span'));
		countEl.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';

		DOM.append(hdr, DOM.$('span')).style.flex = '1';

		const actionSlot = DOM.append(hdr, DOM.$('div'));
		actionSlot.style.cssText = 'display:flex;gap:6px;';

		const content = DOM.append(card, DOM.$('div'));
		content.style.cssText = 'padding:14px 16px;';
		// Skip the "Loading…" flash when the cache is already warm — happens after
		// an optimistic save reconciliation and on tab re-renders. Cold cache
		// hits still show the spinner so the user knows a fetch is in flight.
		if (!this._tabDataCache.has(tab.key)) {
			const loading = DOM.append(content, DOM.$('div'));
			loading.textContent = 'Loading...';
			loading.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';
		}

		// Tab with no endpoint (neither FHIR resource nor apiPath) → show placeholder, no Add button
		if (!this._tabEndpoint(tab)) {
			DOM.clearNode(content);
			const placeholder = DOM.append(content, DOM.$('div'));
			placeholder.style.cssText = 'padding:40px 16px;text-align:center;color:var(--vscode-descriptionForeground);';
			const icon = DOM.append(placeholder, DOM.$('div'));
			icon.textContent = tab.emoji || '\u{1F4CB}';
			icon.style.cssText = 'font-size:32px;margin-bottom:8px;';
			const msg = DOM.append(placeholder, DOM.$('div'));
			msg.textContent = `No ${tab.label.toLowerCase()} data source configured`;
			msg.style.cssText = 'font-size:13px;';
			return;
		}

		const { config, data } = await this._loadTabData(tab);
		// Active tab may have changed while loading
		if (tab.key !== this.activeTab) { return; }

		DOM.clearNode(content);
		countEl.textContent = data.length > 0 ? String(data.length) : '';

		const isForm = tab.display === 'form';
		if (config?.sections && isForm) {
			// Form tab (e.g. Demographics): read-only by default; click Edit to unlock, then Save/Cancel.
			this._formInputs.clear();
			this._dateVisibleByKey.clear();
			const initialRecord = data.length > 0 ? data : [{}];
			this._renderForm(content, config.sections, initialRecord);

			const primaryBtnStyle = 'padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
			const secondaryBtnStyle = 'padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);';

			const setReadOnly = (readOnly: boolean) => {
				// Lock EVERY control inside the form — not just the value-holders in
				// _formInputs. Date, lookup/search and file fields render a VISIBLE
				// input (and the date field also a native calendar picker) separate
				// from the hidden value input registered in _formInputs.
				//
				// Use `disabled` (NOT `readOnly`) for every control: a readOnly text
				// input can still be FOCUSED, and the lookup/search "dropdown" fields
				// open their results popover on focus — so a read-only-but-focusable
				// field still let the user pick a new value from the dropdown. `disabled`
				// blocks focus entirely, so text, selects, date pickers AND the
				// focus-triggered search dropdowns are all truly locked until Edit.
				// Values are still read programmatically from _formInputs on save
				// (disabled controls keep their `.value`), so nothing is lost.
				// eslint-disable-next-line no-restricted-syntax
				const controls = content.querySelectorAll('input, select, textarea');
				for (const node of Array.from(controls) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
					node.disabled = readOnly;
					node.style.opacity = readOnly ? '0.75' : '1';
					node.style.cursor = readOnly ? 'not-allowed' : '';
				}
			};

			// Snapshot values so Cancel can revert
			const snapshot = () => {
				const snap = new Map<string, string | boolean>();
				for (const [k, el] of this._formInputs) {
					if (DOM.isHTMLInputElement(el) && el.type === 'checkbox') { snap.set(k, el.checked); }
					else { snap.set(k, el.value); }
				}
				return snap;
			};
			const restore = (snap: Map<string, string | boolean>) => {
				const isoToUs = (iso: string): string => {
					const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
					return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
				};
				for (const [k, el] of this._formInputs) {
					const v = snap.get(k);
					if (DOM.isHTMLInputElement(el) && el.type === 'checkbox') { el.checked = !!v; }
					else { el.value = String(v ?? ''); }
					// Date fields keep their displayed MM/DD/YYYY value in a separate
					// visible input — revert that too, else Cancel leaves the edited
					// text on screen while the saved (hidden) value is the original.
					const vis = this._dateVisibleByKey.get(k);
					if (vis) { vis.value = isoToUs(String(v ?? '')); vis.style.borderColor = ''; }
				}
			};

			setReadOnly(true);

			const editBtn = DOM.append(actionSlot, DOM.$('button')) as HTMLButtonElement;
			editBtn.textContent = '\u{270F}\u{FE0F} Edit';
			editBtn.style.cssText = primaryBtnStyle;

			const saveBtn = DOM.append(actionSlot, DOM.$('button')) as HTMLButtonElement;
			saveBtn.textContent = '\u{1F4BE} Save';
			saveBtn.style.cssText = primaryBtnStyle;
			saveBtn.style.display = 'none';

			const cancelBtn = DOM.append(actionSlot, DOM.$('button')) as HTMLButtonElement;
			cancelBtn.textContent = 'Cancel';
			cancelBtn.style.cssText = secondaryBtnStyle;
			cancelBtn.style.display = 'none';

			let snap: Map<string, string | boolean> | null = null;

			editBtn.addEventListener('click', () => {
				snap = snapshot();
				setReadOnly(false);
				editBtn.style.display = 'none';
				saveBtn.style.display = '';
				cancelBtn.style.display = '';
			});

			cancelBtn.addEventListener('click', () => {
				if (snap) { restore(snap); }
				setReadOnly(true);
				editBtn.style.display = '';
				saveBtn.style.display = 'none';
				cancelBtn.style.display = 'none';
			});

			saveBtn.addEventListener('click', async () => {
				// Keep the form in edit mode when the save is blocked by validation
				// so the inline field errors stay visible and editable.
				const ok = await this._saveFormTab(tab, saveBtn, config);
				if (!ok) { return; }
				setReadOnly(true);
				editBtn.style.display = '';
				saveBtn.style.display = 'none';
				cancelBtn.style.display = 'none';
			});
		} else if (tab.key === 'statements') {
			// Financial > Statements: render the ciyex-ehr-ui StatementsTab layout
			// (Generate Statement action + Select Claims picker + Statement
			// History) instead of dropping the raw New-Statement field form into
			// the tab body, which QA flagged as "completely different from the web".
			await this._renderStatementsTab(content, actionSlot, tab, config, data);
		} else if (tab.key === 'payment') {
			// Financial > Payment: render credit-card grid matching ciyex-ehr-ui PaymentFlat
			this._renderPatientCreditCards(content, actionSlot);
		} else {
			// List tab: show "+ Add" unless the tab is read-only (ledgers, system
			// reports, etc.). Encounters are excluded too — they are auto-created
			// from the Appointments page ("Completed" status), never added here.
			if (!tab.readOnly && tab.key !== 'encounters') {
				const addBtn = DOM.append(actionSlot, DOM.$('button'));
				addBtn.textContent = '+ Add';
				addBtn.style.cssText = 'padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
				addBtn.addEventListener('click', () => this._openAddRecordDialog(tab, config));
			}

			// Issue #9: Vitals renders as a flowsheet (measurements as rows ×
			// recordings as columns) to match the ciyex-ehr-ui Vitals page,
			// instead of the generic one-row-per-recording list.
			if (tab.key === 'vitals') {
				this._renderVitalsFlowsheet(content, data);
			} else {
				this._renderListWithFilters(content, tab, config, data);
			}
		}
	}

	/** Statements tab — mirrors the ciyex-ehr-ui StatementsTab: a "Generate
	 *  Statement" action in the header, a "Select Claims for Statement" picker,
	 *  and a "Statement History" list (with the same empty state). "Generate
	 *  Statement" opens the existing New-Statement modal prefilled from the
	 *  selected claims, so the proven create/POST path is reused unchanged. */
	private async _renderStatementsTab(content: HTMLElement, actionSlot: HTMLElement, tab: ChartTab, config: FieldConfig | null, statements: Record<string, unknown>[]): Promise<void> {
		const getField = (obj: Record<string, unknown>, aliases: string[]): unknown => {
			for (const a of aliases) {
				const v = a.split('.').reduce<unknown>((acc, k) => (acc !== null && acc !== undefined ? (acc as Record<string, unknown>)[k] : undefined), obj);
				if (v !== undefined && v !== null && String(v) !== '') { return v; }
			}
			return undefined;
		};
		const money = (n: unknown): string => {
			const v = Number(n);
			return isFinite(v) ? `$${v.toFixed(2)}` : '$0.00';
		};

		// Generate Statement button in the header action slot.
		const genBtn = DOM.append(actionSlot, DOM.$('button')) as HTMLButtonElement;
		genBtn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
		DOM.append(genBtn, DOM.$('span.codicon.codicon-file-add')).style.cssText = 'font-size:13px;';
		const genLbl = DOM.append(genBtn, DOM.$('span')); genLbl.textContent = 'Generate Statement';

		const selectedClaims = new Map<string, Record<string, unknown>>();

		// --- Select Claims for Statement ---------------------------------------
		// Matches ciyex-ehr-ui: the claims picker is hidden on first load (only the
		// Statement History shows) and is revealed inline by the "Generate
		// Statement" button — no separate New-Statement modal is opened.
		const claimsSection = DOM.append(content, DOM.$('div'));
		claimsSection.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:14px;overflow:hidden;display:none;';
		const claimsHdr = DOM.append(claimsSection, DOM.$('div'));
		claimsHdr.style.cssText = 'padding:10px 14px;background:rgba(0,122,204,0.06);border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;font-weight:600;';
		claimsHdr.textContent = 'Select Claims for Statement';
		const claimsBody = DOM.append(claimsSection, DOM.$('div'));
		claimsBody.style.cssText = 'padding:8px 14px;max-height:240px;overflow-y:auto;';
		const claimsLoading = DOM.append(claimsBody, DOM.$('div'));
		claimsLoading.textContent = 'Loading claims…';
		claimsLoading.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:12px 0;text-align:center;';

		// Footer: Cancel hides the picker again; Save creates the statement inline
		// from the selected claims (reusing the statements POST path).
		const claimsFooter = DOM.append(claimsSection, DOM.$('div'));
		claimsFooter.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--vscode-editorWidget-border);';
		const claimsErr = DOM.append(claimsFooter, DOM.$('div'));
		claimsErr.style.cssText = 'flex:1;color:#f48771;font-size:11.5px;align-self:center;display:none;';
		const cancelGenBtn = DOM.append(claimsFooter, DOM.$('button')) as HTMLButtonElement;
		cancelGenBtn.textContent = 'Cancel';
		cancelGenBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:4px;cursor:pointer;font-size:12px;';
		const saveGenBtn = DOM.append(claimsFooter, DOM.$('button')) as HTMLButtonElement;
		saveGenBtn.textContent = 'Save Statement';
		saveGenBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';

		// --- Statement History --------------------------------------------------
		const histSection = DOM.append(content, DOM.$('div'));
		histSection.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const histHdr = DOM.append(histSection, DOM.$('div'));
		histHdr.style.cssText = 'padding:10px 14px;background:rgba(0,122,204,0.06);border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;';
		const histTitle = DOM.append(histHdr, DOM.$('span')); histTitle.textContent = 'Statement History';
		const histCount = DOM.append(histHdr, DOM.$('span'));
		histCount.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-weight:500;';
		histCount.textContent = statements.length ? `${statements.length} statement${statements.length === 1 ? '' : 's'} generated` : '0 statements generated';
		const histBody = DOM.append(histSection, DOM.$('div'));
		histBody.style.cssText = 'padding:8px 14px;';

		if (!statements || statements.length === 0) {
			const empty = DOM.append(histBody, DOM.$('div'));
			empty.style.cssText = 'text-align:center;padding:32px 16px;color:var(--vscode-descriptionForeground);';
			const ei = DOM.append(empty, DOM.$('div')); ei.textContent = '\u{1F4C4}'; ei.style.cssText = 'font-size:30px;margin-bottom:8px;opacity:0.7;';
			const em = DOM.append(empty, DOM.$('div')); em.textContent = 'No statements generated'; em.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';
			const es = DOM.append(empty, DOM.$('div')); es.textContent = 'Click "Generate Statement" to create a patient billing statement.'; es.style.cssText = 'font-size:11.5px;margin-top:4px;';
		} else {
			for (const st of statements) {
				const row = DOM.append(histBody, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:9px 4px;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;cursor:pointer;';
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
				row.addEventListener('mouseleave', () => { row.style.background = ''; });
				const num = DOM.append(row, DOM.$('span')); num.textContent = String(getField(st, ['statementNumber', 'identifier', 'id']) ?? '—'); num.style.cssText = 'font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				const date = DOM.append(row, DOM.$('span')); date.textContent = String(getField(st, ['statementDate', 'date', 'created', 'createdAt']) ?? ''); date.style.cssText = 'flex:1;color:var(--vscode-descriptionForeground);';
				const bal = DOM.append(row, DOM.$('span')); bal.textContent = money(getField(st, ['balance', 'totalNet.value', 'patientBalance'])); bal.style.cssText = 'flex:0 0 auto;font-weight:600;';
				const stat = DOM.append(row, DOM.$('span')); stat.textContent = String(getField(st, ['status']) ?? '').toUpperCase(); stat.style.cssText = 'flex:0 0 auto;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';
				row.addEventListener('click', () => this._openRecordDialog(tab, config, st));
			}
		}

		// "Generate Statement": reveal the inline claims picker (instead of opening
		// the New-Statement modal) and hide the header button while it is open,
		// matching the ciyex-ehr-ui flow.
		genBtn.addEventListener('click', () => {
			claimsSection.style.display = '';
			genBtn.style.display = 'none';
			claimsErr.style.display = 'none';
		});
		cancelGenBtn.addEventListener('click', () => {
			claimsSection.style.display = 'none';
			genBtn.style.display = '';
		});

		// Save: build the statement from the selected claims (charges summed →
		// balance) with a sequential statement number, POST it through the
		// statements endpoint, then refresh the tab.
		saveGenBtn.addEventListener('click', async () => {
			claimsErr.style.display = 'none';
			const chosen = Array.from(selectedClaims.values());
			const totalCharges = chosen.reduce((sum, c) => sum + (Number(getField(c, ['totalAmount', 'amount', 'totalNet.value'])) || 0), 0);
			const year = new Date().getFullYear();
			const seq = String(statements.length + 1).padStart(4, '0');
			const charges = totalCharges > 0 ? Number(totalCharges.toFixed(2)) : 0;
			const payload: Record<string, unknown> = {
				patientId: this.patientId,
				statementNumber: `STM-${year}-${seq}`,
				identifier: `STM-${year}-${seq}`,
				statementDate: new Date().toISOString().slice(0, 10),
				date: new Date().toISOString().slice(0, 10),
				status: 'draft',
				type: 'Statement',
				recipient: this.patientName || '',
				totalCharges: charges,
				totalGross: charges,
				patientBalance: charges,
				balance: charges,
				balanceDue: charges,
				notes: chosen.length ? `Claims: ${chosen.map(c => String(getField(c, ['claimNumber', 'identifier', 'id']) ?? '')).filter(Boolean).join(', ')}` : '',
			};
			saveGenBtn.disabled = true; saveGenBtn.textContent = 'Saving…';
			try {
				const res = await this.apiService.fetch(`${FHIR_MAP['PaymentNotice']}/patient/${this.patientId}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (res.ok) {
					this._tabDataCache.delete(tab.key);
					if (this.activeTab === tab.key) { this._renderMain(); }
				} else {
					const errData = await res.json().catch(() => ({})) as Record<string, string>;
					claimsErr.textContent = errData['message'] || `Error ${res.status}`;
					claimsErr.style.display = '';
				}
			} catch {
				claimsErr.textContent = 'Failed to save statement. Please try again.';
				claimsErr.style.display = '';
			}
			saveGenBtn.disabled = false; saveGenBtn.textContent = 'Save Statement';
		});

		// Load this patient's claims for the picker.
		try {
			const res = await this.apiService.fetch(`${FHIR_MAP['Claim']}/patient/${this.patientId}?page=0&size=100`);
			const json = res.ok ? await res.json() : null;
			const claims = (json?.data?.content || json?.content || json?.data || (Array.isArray(json) ? json : [])) as Record<string, unknown>[];
			DOM.clearNode(claimsBody);
			if (!claims || claims.length === 0) {
				const none = DOM.append(claimsBody, DOM.$('div'));
				none.textContent = 'No claims found for this patient.';
				none.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);text-align:center;padding:20px 0;';
			} else {
				for (const c of claims) {
					const id = String(getField(c, ['id', 'claimNumber', 'identifier']) ?? '');
					const rowL = DOM.append(claimsBody, DOM.$('label'));
					rowL.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;cursor:pointer;';
					const cb = DOM.append(rowL, DOM.$('input')) as HTMLInputElement;
					cb.type = 'checkbox';
					cb.style.cssText = 'flex:0 0 auto;cursor:pointer;';
					cb.addEventListener('change', () => {
						if (cb.checked) { selectedClaims.set(id, c); } else { selectedClaims.delete(id); }
					});
					const nm = DOM.append(rowL, DOM.$('span')); nm.textContent = String(getField(c, ['claimNumber', 'identifier', 'id']) ?? '—'); nm.style.cssText = 'font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					const dt = DOM.append(rowL, DOM.$('span')); dt.textContent = String(getField(c, ['serviceDate', 'date', 'period.start', 'created']) ?? ''); dt.style.cssText = 'flex:1;color:var(--vscode-descriptionForeground);';
					const amt = DOM.append(rowL, DOM.$('span')); amt.textContent = money(getField(c, ['totalAmount', 'amount', 'totalNet.value'])); amt.style.cssText = 'flex:0 0 auto;font-weight:600;';
					const stt = DOM.append(rowL, DOM.$('span')); stt.textContent = String(getField(c, ['status']) ?? '').toUpperCase(); stt.style.cssText = 'flex:0 0 auto;font-size:10px;opacity:0.8;';
				}
			}
		} catch {
			DOM.clearNode(claimsBody);
			const err = DOM.append(claimsBody, DOM.$('div'));
			err.textContent = 'Unable to load claims.';
			err.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);text-align:center;padding:20px 0;';
		}
	}

	/** Issue #9: Vitals Flowsheet — a transposed table where each row is a
	 *  measurement (Weight, Height, BMI, BP, Pulse, …) and each column is a
	 *  recording (newest first), mirroring the ciyex-ehr-ui Vitals page. */
	private _renderVitalsFlowsheet(content: HTMLElement, data: Record<string, unknown>[]): void {
		const get = (rec: Record<string, unknown>, keys: string[]): unknown => {
			for (const k of keys) { const v = rec[k]; if (v !== undefined && v !== null && v !== '') { return v; } }
			return undefined;
		};
		const dateKeys = ['recordedAt', 'effectiveDateTime', 'recordedDate', 'dateRecorded', 'createdAt'];
		// Base ordering is newest-first; the sort toggle (issue #5) flips this.
		const recsDesc = [...data].sort((a, b) => {
			const da = new Date(String(get(a, dateKeys) ?? 0)).getTime();
			const db = new Date(String(get(b, dateKeys) ?? 0)).getTime();
			return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
		});

		// Issue #5: Header carries a recording count plus an up/down arrow toggle
		// that reorders the date columns newest-first / oldest-first — mirroring
		// the ciyex-ehr-ui VitalsFlowsheet (ArrowUpDown toggle reading
		// "Newest first" / "Oldest first").
		let sortAsc = false; // false = newest first (default), true = oldest first
		const head = DOM.append(content, DOM.$('div'));
		head.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;';
		const title = DOM.append(head, DOM.$('span'));
		title.textContent = 'Vitals Flowsheet';
		title.style.cssText = 'font-size:14px;font-weight:600;color:var(--vscode-foreground);';
		const meta = DOM.append(head, DOM.$('span'));
		meta.textContent = `${recsDesc.length} recording${recsDesc.length === 1 ? '' : 's'}`;
		meta.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		if (recsDesc.length === 0) {
			const empty = DOM.append(content, DOM.$('div'));
			empty.textContent = 'No vitals records.';
			empty.style.cssText = 'padding:24px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
			return;
		}

		// Sort-order toggle: an up/down arrow glyph + label. Clicking flips the
		// column order and re-renders the table in place.
		const sortBtn = DOM.append(head, DOM.$('button'));
		sortBtn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:1px solid var(--vscode-input-border,rgba(127,127,127,0.4));border-radius:4px;background:transparent;color:var(--vscode-descriptionForeground);font-size:11px;cursor:pointer;';
		sortBtn.title = 'Toggle sort order';
		const sortArrows = DOM.append(sortBtn, DOM.$('span'));
		// allow-any-unicode-next-line
		sortArrows.textContent = '↕';
		sortArrows.style.cssText = 'font-size:12px;line-height:1;';
		const sortLabel = DOM.append(sortBtn, DOM.$('span'));
		const refreshSortBtn = () => {
			// allow-any-unicode-next-line
			sortArrows.textContent = sortAsc ? '↑' : '↓';
			sortLabel.textContent = sortAsc ? 'Oldest first' : 'Newest first';
		};
		refreshSortBtn();

		// BMI is not stored on the FHIR vitals Observation (only height + weight are),
		// so the BMI row was always blank. Compute it from this recording's weight &
		// height (kg / m^2) when no explicit value is present.
		const computeBmi = (rec: Record<string, unknown>): string => {
			const w = Number(get(rec, ['weightKg', 'weight']));
			const h = Number(get(rec, ['heightCm', 'height']));
			if (!(w > 0) || !(h > 0)) { return ''; }
			const m = h / 100;
			const bmi = w / (m * m);
			return Number.isFinite(bmi) ? bmi.toFixed(1) : '';
		};
		const rows: Array<{ label: string; keys: string[]; unit?: string; compute?: (rec: Record<string, unknown>) => string }> = [
			{ label: 'Weight', keys: ['weightKg', 'weight'], unit: ' kg' },
			{ label: 'Height', keys: ['heightCm', 'height'], unit: ' cm' },
			{ label: 'BMI', keys: ['bmi'], compute: computeBmi },
			{ label: 'BP Systolic', keys: ['bpSystolic', 'systolicBP', 'systolic'] },
			{ label: 'BP Diastolic', keys: ['bpDiastolic', 'diastolicBP', 'diastolic'] },
			{ label: 'Pulse', keys: ['pulse', 'heartRate', 'hr'] },
			{ label: 'Respiration', keys: ['respiration', 'respiratoryRate', 'rr'] },
			// allow-any-unicode-next-line
			{ label: 'Temperature', keys: ['temperatureC', 'temperature', 'temp'], unit: ' °C' },
			{ label: 'O2 Saturation', keys: ['oxygenSaturation', 'spo2', 'o2sat'], unit: '%' },
			{ label: 'Notes', keys: ['notes', 'note'] },
		];

		// Host container that the table is (re)built into. Re-rendered in place
		// whenever the sort order is toggled so the date columns reorder without
		// rebuilding the header/toggle above it.
		const tableHost = DOM.append(content, DOM.$('div'));

		const cellCss = 'padding:8px 12px;border-bottom:1px solid rgba(128,128,128,0.12);text-align:left;white-space:nowrap;';
		const firstColCss = `${cellCss}position:sticky;left:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));font-weight:500;color:var(--vscode-foreground);`;

		const renderTable = (): void => {
			DOM.clearNode(tableHost);
			// recsDesc is newest-first; reverse a copy for oldest-first.
			const recs = sortAsc ? [...recsDesc].reverse() : recsDesc;

			const wrap = DOM.append(tableHost, DOM.$('div'));
			wrap.style.cssText = 'overflow-x:auto;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';
			const table = DOM.append(wrap, DOM.$('table')) as HTMLTableElement;
			table.style.cssText = 'border-collapse:collapse;width:100%;font-size:12px;';

			// Header row
			const thead = DOM.append(table, DOM.$('thead'));
			const htr = DOM.append(thead, DOM.$('tr'));
			const corner = DOM.append(htr, DOM.$('th'));
			corner.textContent = 'Measurement';
			corner.style.cssText = `${firstColCss}background:var(--vscode-sideBar-background,var(--vscode-editor-background));text-transform:uppercase;font-size:11px;color:var(--vscode-descriptionForeground);z-index:2;`;
			for (const rec of recs) {
				const th = DOM.append(htr, DOM.$('th'));
				const raw = get(rec, dateKeys);
				let label = '—';
				if (raw) { try { label = new Date(String(raw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { label = String(raw).slice(0, 10); } }
				th.textContent = label;
				th.style.cssText = `${cellCss}text-transform:uppercase;font-size:11px;color:var(--vscode-descriptionForeground);background:var(--vscode-sideBar-background,var(--vscode-editor-background));`;
			}

			// Measurement rows
			const tbody = DOM.append(table, DOM.$('tbody'));
			const renderRow = (label: string, render: (rec: Record<string, unknown>) => string): void => {
				const tr = DOM.append(tbody, DOM.$('tr'));
				const td0 = DOM.append(tr, DOM.$('td'));
				td0.textContent = label;
				td0.style.cssText = firstColCss;
				for (const rec of recs) {
					const td = DOM.append(tr, DOM.$('td'));
					td.textContent = render(rec) || '—';
					td.style.cssText = `${cellCss}color:var(--vscode-foreground);`;
				}
			};
			for (const r of rows) {
				renderRow(r.label, (rec) => {
					const v = get(rec, r.keys);
					if (v === undefined) { return r.compute ? r.compute(rec) : ''; }
					return `${v}${r.unit ?? ''}`;
				});
			}
			// Signed row — interactive Sign / Signed toggle button per recording
			// column, mirroring the ciyex-ehr-ui VitalsFlowsheet: an unsigned
			// recording shows a "Sign" button; clicking it PUTs `signed: "final"`
			// and the cell flips to "Signed ✓" (click again to unsign).
			const signedTr = DOM.append(tbody, DOM.$('tr'));
			const signedTd0 = DOM.append(signedTr, DOM.$('td'));
			signedTd0.textContent = 'Signed';
			signedTd0.style.cssText = firstColCss;
			const isSigned = (rec: Record<string, unknown>): boolean => {
				const s = get(rec, ['signed', 'signedAt', 'isSigned']);
				return s === true || s === 'true' || s === 'final' || (typeof s === 'string' && s.length > 4);
			};
			for (const rec of recs) {
				const td = DOM.append(signedTr, DOM.$('td'));
				td.style.cssText = cellCss;
				const btn = DOM.append(td, DOM.$('button')) as HTMLButtonElement;
				const paint = () => {
					const signed = isSigned(rec);
					btn.textContent = signed ? '✓ Signed' : 'Sign';
					btn.title = signed ? 'Click to unsign' : 'Click to sign';
					btn.style.cssText = `font-size:11px;padding:2px 12px;border-radius:4px;border:1px solid transparent;cursor:pointer;font-weight:500;${signed ? 'background:rgba(34,197,94,0.15);color:#22c55e;' : 'background:rgba(127,127,127,0.18);color:var(--vscode-descriptionForeground);'}`;
				};
				paint();
				btn.addEventListener('click', async () => {
					const id = (rec['id'] ?? rec['fhirId']) as string | undefined;
					if (!id) { return; }
					const currentlySigned = isSigned(rec);
					btn.disabled = true;
					btn.textContent = '…';
					try {
						const res = await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${this.patientId}/${id}`, {
							method: 'PUT',
							body: JSON.stringify({ ...rec, signed: currentlySigned ? false : 'final' }),
						});
						if (res.ok) { rec['signed'] = currentlySigned ? false : 'final'; }
					} catch { /* network/save error — leave the prior state */ }
					btn.disabled = false;
					paint();
				});
			}
		};

		sortBtn.addEventListener('click', () => {
			sortAsc = !sortAsc;
			refreshSortBtn();
			renderTable();
		});
		renderTable();
	}

	// Status filter options per tab — different resources use different status vocabularies.
	/** Union two select-option lists, keeping backend options first and appending
	 *  any local option whose value the backend didn't already ship (case-insensitive
	 *  match on the option value). Used when a field sets `mergeOptions` so the
	 *  form offers both the backend vocabulary and the local extras. */
	private static _mergeSelectOptions(
		backend: Array<{ label: string; value: string } | string>,
		local: Array<{ label: string; value: string } | string> | undefined,
	): Array<{ label: string; value: string } | string> {
		const valOf = (o: { label: string; value: string } | string): string => (typeof o === 'string' ? o : o.value);
		const seen = new Set(backend.map(o => valOf(o).toLowerCase()));
		const extras = (local || []).filter(o => !seen.has(valOf(o).toLowerCase()));
		return [...backend, ...extras];
	}

	private _statusFilterOptions(tab: ChartTab): Array<{ label: string; value: string }> {
		switch (tab.key) {
			case 'visit-notes':
				// Visit-note rows carry the signing-workflow status the table renders
				// (UNSIGNED / SIGNED / …), NOT the FHIR DocumentReference.status
				// vocabulary — so filtering by "Current"/"Superseded" never matched a
				// single row (QA issue 4). Offer the statuses the notes actually use.
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Current', value: 'current' },
					{ label: 'Unsigned', value: 'unsigned' },
					{ label: 'Signed', value: 'signed' },
					{ label: 'Amended', value: 'amended' },
					{ label: 'Entered in Error', value: 'entered-in-error' },
				];
			case 'documents':
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Current', value: 'current' },
					{ label: 'Superseded', value: 'superseded' },
					{ label: 'Entered in Error', value: 'entered-in-error' },
				];
			case 'encounters':
				// Encounter rows render the signing-workflow state (Signed /
				// Unsigned — same as the patient snapshot), so the filter offers
				// exactly those two values instead of the generic clinical
				// statuses that never matched a row (QA issue 2).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Signed', value: 'signed' },
					{ label: 'Unsigned', value: 'unsigned' },
				];
			case 'appointments':
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Scheduled', value: 'scheduled' },
					{ label: 'Confirmed', value: 'confirmed' },
					{ label: 'Checked-in', value: 'checked-in' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Cancelled', value: 'cancelled' },
					{ label: 'No Show', value: 'no show' },
				];
			case 'medications':
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Draft', value: 'draft' },
					{ label: 'Active', value: 'active' },
					{ label: 'On Hold', value: 'on-hold' },
					{ label: 'Stopped', value: 'stopped' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Cancelled', value: 'cancelled' },
				];
			case 'immunizations':
				// Match the Immunization form's Status options (clinical
				// /api/immunizations store values — underscored, same as the
				// clinical Immunizations page).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Entered in Error', value: 'entered_in_error' },
					{ label: 'Not Done', value: 'not_done' },
				];
			case 'labs':
				// Lab ORDERS filter on the order's Status field (same vocabulary as
				// the Lab Order form's Status select) — the generic clinical default
				// ("All Clinical Statuses": Active/Inactive/Resolved) used a
				// different terminology than the form and never matched values like
				// Revoked (QA: filter said Clinical Status, form said otherwise).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Draft', value: 'draft' },
					{ label: 'Active', value: 'active' },
					{ label: 'Pending', value: 'pending' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Cancelled', value: 'cancelled' },
					{ label: 'Revoked', value: 'revoked' },
				];
			case 'lab-results':
				// Match the Lab Result form's Status options (Pending/…/Amended) —
				// the generic clinical default (Active/Inactive/Resolved) never
				// matched a result row's "Partial" etc. (QA issue 3).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Pending', value: 'pending' },
					{ label: 'Preliminary', value: 'preliminary' },
					{ label: 'Partial', value: 'partial' },
					{ label: 'Final', value: 'final' },
					{ label: 'Corrected', value: 'corrected' },
					{ label: 'Amended', value: 'amended' },
				];
			case 'education':
				// Match the Education form's Status options (Assigned/Viewed/…) —
				// the generic clinical default never matched an "Assigned" row
				// (QA issue 7).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Assigned', value: 'assigned' },
					{ label: 'Viewed', value: 'viewed' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Dismissed', value: 'dismissed' },
				];
			case 'referrals':
				// Match the clinical /api/referrals store's status workflow — the
				// generic clinical default (Active/Inactive/Resolved) never matched
				// a referral row.
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Draft', value: 'draft' },
					{ label: 'Sent', value: 'sent' },
					{ label: 'Acknowledged', value: 'acknowledged' },
					{ label: 'Scheduled', value: 'scheduled' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Cancelled', value: 'cancelled' },
					{ label: 'Denied', value: 'denied' },
				];
			case 'procedures':
				// Match the Procedure form's Status options (FHIR Procedure.status).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'In Progress', value: 'in-progress' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Cancelled', value: 'cancelled' },
				];
			case 'report':
				// Match the New/Edit Report form's Status dropdown so the table filter
				// and the create/edit form offer the SAME values (per the request to
				// align the filter to the form). NOTE: the live form (backend
				// tab-field-config) uses Complete / Pending / Error, so the filter
				// mirrors those. Reports created before this used FHIR
				// DiagnosticReport.status values (registered/final/…) and only surface
				// under "All Statuses".
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Complete', value: 'complete' },
					{ label: 'Pending', value: 'pending' },
					{ label: 'Error', value: 'error' },
				];
			case 'billing':
			case 'claims':
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Draft', value: 'draft' },
					{ label: 'Active', value: 'active' },
					{ label: 'Cancelled', value: 'cancelled' },
					{ label: 'Paid', value: 'paid' },
					{ label: 'Denied', value: 'denied' },
				];
			case 'denials':
				// ClaimResponse.status value set (matches the Denial form's Status field).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Active', value: 'active' },
					{ label: 'Cancelled', value: 'cancelled' },
					{ label: 'Draft', value: 'draft' },
					{ label: 'Entered in Error', value: 'entered-in-error' },
				];
			case 'era-remittance':
				// PaymentReconciliation.status value set — MUST match the era-remittance
				// form's Status field options (Active / Cancelled / Draft / Entered in
				// Error). Without this case the tab fell through to the generic clinical
				// default (Active / Inactive / Resolved), which never matched an ERA row
				// and disagreed with the create/edit form's Status dropdown.
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Active', value: 'active' },
					{ label: 'Cancelled', value: 'cancelled' },
					{ label: 'Draft', value: 'draft' },
					{ label: 'Entered in Error', value: 'entered-in-error' },
				];
			case 'clinical-alerts':
				// Match the Clinical Alert form's Status options EXACTLY (Active /
				// Inactive / Entered in Error) — the filter previously also offered
				// 'Resolved', which the form never sets, so the two vocabularies
				// disagreed (QA: form vs filter status mismatch).
				return [
					{ label: 'All Clinical Statuses', value: '' },
					{ label: 'Active', value: 'active' },
					{ label: 'Inactive', value: 'inactive' },
					{ label: 'Entered in Error', value: 'entered-in-error' },
				];
			case 'insurance':
				// Match the Insurance form's Status options (Active / Inactive) —
				// the generic clinical default offered a 'Resolved' choice no
				// Coverage row or form value ever uses (QA: filter had an extra
				// Resolved option the create/edit form doesn't).
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Active', value: 'active' },
					{ label: 'Inactive', value: 'inactive' },
				];
			default:
				return [
					{ label: 'All Clinical Statuses', value: '' },
					{ label: 'Active', value: 'active' },
					{ label: 'Inactive', value: 'inactive' },
					{ label: 'Resolved', value: 'resolved' },
				];
		}
	}
	// allow-any-unicode-next-line
	// ── Financial > Payment — credit-card grid (matches ciyex-ehr-ui PaymentFlat) ──

	private _chartCards: Array<Record<string, unknown>> = [];
	private _chartCardFormOverlay: HTMLElement | null = null;
	private _chartCardFormBackdrop: HTMLElement | null = null;

	private _cardTypeBadge(type: string): string {
		const t = (type || '').toUpperCase();
		if (t.includes('VISA')) { return 'VISA'; }
		if (t.includes('MASTER')) { return 'MC'; }
		if (t.includes('AMEX') || t.includes('AMERICAN')) { return 'AMEX'; }
		if (t.includes('DISCOVER')) { return 'DISC'; }
		return t.slice(0, 4) || '????';
	}

	private _isExpired(card: Record<string, unknown>): boolean {
		if (card['isExpired']) { return true; }
		const now = new Date();
		const m = Number(card['expiryMonth'] ?? 0);
		const y = Number(card['expiryYear'] ?? 0);
		return y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1);
	}

	/** Payment History for the chart Payment tab — lists completed/recorded
	 *  payment transactions from the SAME store the snapshot Financials reads
	 *  (/api/payments/transactions/patient/{id}), so a payment collected via the
	 *  snapshot appears here too (QA: chart Payment tab showed nothing). */
	private async _renderChartPaymentHistory(container: HTMLElement): Promise<void> {
		const section = DOM.append(container, DOM.$('div'));
		section.style.cssText = 'margin-bottom:18px;';
		const heading = DOM.append(section, DOM.$('div'));
		heading.textContent = 'Payment History';
		heading.style.cssText = 'font-size:12px;font-weight:700;color:var(--vscode-foreground);margin:0 0 10px;';

		let payments: Array<Record<string, unknown>> = [];
		try {
			const res = await this.apiService.fetch(`/api/payments/transactions/patient/${this.patientId}?page=0&size=50`);
			if (res.ok) {
				const data = await res.json();
				payments = (data?.data?.content || data?.data || data?.content || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
			}
		} catch { payments = []; }

		if (payments.length === 0) {
			const empty = DOM.append(section, DOM.$('div'));
			empty.style.cssText = 'text-align:center;padding:24px;color:var(--vscode-descriptionForeground);font-size:12px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';
			empty.textContent = 'No payments recorded.';
			return;
		}

		const titleCase = (v: unknown): string => { const s = String(v ?? '').trim(); return s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'; };
		const table = DOM.append(section, DOM.$('div'));
		table.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const gridCols = '120px 110px 1fr 1fr 110px';
		const hdrRow = DOM.append(table, DOM.$('div'));
		hdrRow.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(128,128,128,0.06);border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const label of ['Date', 'Amount', 'Type', 'Method', 'Status']) {
			const h = DOM.append(hdrRow, DOM.$('span'));
			h.textContent = label;
		}
		// Most-recent first.
		const sorted = [...payments].sort((a, b) => {
			const da = new Date(String(a.collectedAt || a.paymentDate || a.date || a.transactionDate || a.created || 0)).getTime();
			const db = new Date(String(b.collectedAt || b.paymentDate || b.date || b.transactionDate || b.created || 0)).getTime();
			return db - da;
		});
		for (const pay of sorted) {
			const row = DOM.append(table, DOM.$('div'));
			row.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:7px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);`;
			const dateRaw = String(pay.collectedAt || pay.paymentDate || pay.date || pay.transactionDate || pay.created || '');
			const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const amtNum = parseFloat(String(pay.amount ?? pay.totalAmount ?? ''));
			const amtStr = isNaN(amtNum) ? '—' : `$${amtNum.toFixed(2)}`;
			const method = titleCase(pay.paymentMethodType ?? pay.paymentMethod ?? pay.method ?? pay.paymentType);
			const cells = [dateStr, amtStr, titleCase(pay.transactionType ?? pay.paymentType), method, titleCase(pay.status)];
			for (const c of cells) {
				const cell = DOM.append(row, DOM.$('span'));
				cell.textContent = c;
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			}
		}
	}

	private async _renderPatientCreditCards(container: HTMLElement, actionSlot: HTMLElement): Promise<void> {
		DOM.clearNode(container);
		DOM.clearNode(actionSlot);

		// "+ Add Card" in the action slot
		const addBtn = DOM.append(actionSlot, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add Card';
		addBtn.style.cssText = 'padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';

		// Payment History — completed payments recorded for this patient. The tab
		// previously showed ONLY saved cards, so a completed payment (visible in the
		// snapshot Financials) never appeared here (QA). Render the same transactions
		// the snapshot reads before the "Payment Methods" (cards) section below.
		await this._renderChartPaymentHistory(container);

		// Payment Methods heading (cards live below the payment history).
		const cardsHeading = DOM.append(container, DOM.$('div'));
		cardsHeading.textContent = 'Payment Methods';
		cardsHeading.style.cssText = 'font-size:12px;font-weight:700;color:var(--vscode-foreground);margin:4px 0 10px;';

		// Search bar
		const filterBar = DOM.append(container, DOM.$('div'));
		filterBar.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;';
		const searchEl = DOM.append(filterBar, DOM.$('input')) as HTMLInputElement;
		searchEl.placeholder = 'Search cards…';
		searchEl.style.cssText = 'flex:1;max-width:280px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:5px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';

		// Card grid
		const grid = DOM.append(container, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;';

		const renderGrid = (q = '') => {
			DOM.clearNode(grid);
			const filtered = this._chartCards.filter(c => {
				if (!q) { return true; }
				const lq = q.toLowerCase();
				return (String(c['cardHolderName'] || '')).toLowerCase().includes(lq)
					|| (String(c['cardType'] || '')).toLowerCase().includes(lq)
					|| (String(c['maskedCardNumber'] || '')).toLowerCase().includes(lq)
					|| (String(c['billingCity'] || '')).toLowerCase().includes(lq);
			});

			if (filtered.length === 0) {
				const empty = DOM.append(grid, DOM.$('div'));
				empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:40px;color:var(--vscode-descriptionForeground);font-size:13px;';
				empty.textContent = 'No payment methods on file.';
				return;
			}

			for (const card of filtered) {
				const expired = this._isExpired(card);
				const inactive = card['isActive'] === false;
				const isDefault = !!card['isDefault'];

				let border: string; let bg: string; let opacity = '1';
				if (expired) { border = '#fca5a5'; bg = 'rgba(254,202,202,0.10)'; }
				else if (inactive) { border = 'var(--vscode-editorWidget-border,#555)'; bg = 'rgba(128,128,128,0.06)'; opacity = '0.60'; }
				else if (isDefault) { border = '#3b82f6'; bg = 'rgba(59,130,246,0.08)'; }
				else { border = 'var(--vscode-editorWidget-border,#555)'; bg = 'var(--vscode-editor-background)'; }

				const cardEl = DOM.append(grid, DOM.$('div'));
				cardEl.style.cssText = `border:1.5px solid ${border};border-radius:10px;padding:12px 14px;background:${bg};opacity:${opacity};display:flex;flex-direction:column;gap:7px;`;

				// Header: icon + type badge + status badges
				const hdr = DOM.append(cardEl, DOM.$('div'));
				hdr.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap;';
				const icon = DOM.append(hdr, DOM.$('span'));
				// allow-any-unicode-next-line
				icon.textContent = '💳';
				icon.style.cssText = 'font-size:18px;line-height:1;';
				const typeBadge = DOM.append(hdr, DOM.$('span'));
				typeBadge.textContent = this._cardTypeBadge(String(card['cardType'] || ''));
				typeBadge.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff);';
				if (isDefault) {
					const db = DOM.append(hdr, DOM.$('span'));
					db.textContent = 'Default';
					db.style.cssText = 'font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:rgba(59,130,246,0.15);color:#3b82f6;margin-left:auto;';
				}
				if (inactive) {
					const ib = DOM.append(hdr, DOM.$('span'));
					ib.textContent = 'Inactive';
					ib.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(128,128,128,0.15);color:var(--vscode-descriptionForeground);margin-left:auto;';
				}

				// Masked number
				const numEl = DOM.append(cardEl, DOM.$('div'));
				numEl.textContent = String(card['maskedCardNumber'] || '•••• •••• •••• ****');
				numEl.style.cssText = 'font-size:13px;font-weight:600;letter-spacing:2px;color:var(--vscode-foreground);font-family:monospace;';

				// Holder name
				const holderEl = DOM.append(cardEl, DOM.$('div'));
				holderEl.textContent = String(card['cardHolderName'] || '');
				holderEl.style.cssText = 'font-size:12px;color:var(--vscode-foreground);';

				// Expiry
				const mm = String(card['expiryMonth'] || 1).padStart(2, '0');
				const yy = String(card['expiryYear'] || new Date().getFullYear());
				const expRow = DOM.append(cardEl, DOM.$('div'));
				expRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground);';
				expRow.textContent = `Expires ${mm}/${yy}`;
				if (expired) {
					const et = DOM.append(expRow, DOM.$('span'));
					et.textContent = 'EXPIRED';
					et.style.cssText = 'font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.15);color:#ef4444;letter-spacing:0.5px;';
				}

				// Billing city/state/zip
				const billing = [card['billingCity'], card['billingState'], card['billingZip']].filter(Boolean).join(', ');
				if (billing) {
					const billEl = DOM.append(cardEl, DOM.$('div'));
					billEl.textContent = billing;
					billEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
				}

				// Actions row
				const acts = DOM.append(cardEl, DOM.$('div'));
				acts.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:2px;flex-wrap:wrap;';

				if (!isDefault && !inactive) {
					const defBtn = DOM.append(acts, DOM.$('button')) as HTMLButtonElement;
					defBtn.textContent = 'Set Default';
					defBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:#3b82f6;padding:0;font-weight:500;';
					defBtn.addEventListener('click', async () => {
						try {
							await this.apiService.fetch(`/api/credit-cards/${card['id']}/patient/${this.patientId}/set-default`, { method: 'PUT' });
							await this._reloadChartCards();
							renderGrid(searchEl.value);
						} catch { /* ignore */ }
					});
				}

				const editBtn = DOM.append(acts, DOM.$('button')) as HTMLButtonElement;
				editBtn.textContent = 'Edit';
				editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:var(--vscode-descriptionForeground);padding:0;';
				editBtn.addEventListener('click', () => this._openChartCardForm(card, async () => { await this._reloadChartCards(); renderGrid(searchEl.value); }));

				if (!inactive) {
					const deactBtn = DOM.append(acts, DOM.$('button')) as HTMLButtonElement;
					deactBtn.textContent = 'Deactivate';
					deactBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:#f97316;padding:0;';
					deactBtn.addEventListener('click', async () => {
						if (!DOM.getActiveWindow().confirm('Deactivate this card?')) { return; }
						try {
							await this.apiService.fetch(`/api/credit-cards/${card['id']}/deactivate`, { method: 'PUT' });
							await this._reloadChartCards();
							renderGrid(searchEl.value);
						} catch { /* ignore */ }
					});
				}

				const delBtn = DOM.append(acts, DOM.$('button')) as HTMLButtonElement;
				delBtn.textContent = 'Delete';
				delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:#ef4444;padding:0;margin-left:auto;';
				delBtn.addEventListener('click', async () => {
					if (!DOM.getActiveWindow().confirm('Delete this payment method?')) { return; }
					try {
						await this.apiService.fetch(`/api/credit-cards/${card['id']}`, { method: 'DELETE' });
						this._chartCards = this._chartCards.filter(c => c['id'] !== card['id']);
						renderGrid(searchEl.value);
					} catch { /* ignore */ }
				});
			}
		};

		searchEl.addEventListener('input', () => renderGrid(searchEl.value));
		addBtn.addEventListener('click', () => this._openChartCardForm(null, async () => { await this._reloadChartCards(); renderGrid(searchEl.value); }));

		// Initial load
		const loadingEl = DOM.append(grid, DOM.$('div'));
		loadingEl.style.cssText = 'grid-column:1/-1;text-align:center;padding:32px;color:var(--vscode-descriptionForeground);font-size:12px;';
		loadingEl.textContent = 'Loading…';
		await this._reloadChartCards();
		renderGrid();
	}

	private async _reloadChartCards(): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/credit-cards/patient/${this.patientId}?page=0&size=200`);
			if (res.ok) {
				const data = await res.json();
				this._chartCards = (data?.data?.content || data?.data || data?.content || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
			} else {
				this._chartCards = [];
			}
		} catch { this._chartCards = []; }
	}

	private _openChartCardForm(card: Record<string, unknown> | null, onSaved: () => void): void {
		this._chartCardFormOverlay?.remove();
		this._chartCardFormBackdrop?.remove();

		// Mount inside the editor root (NOT document.body) and anchor the panel
		// to the right with the same flex layout `_openRecordDialog` uses for
		// every other create/edit drawer (New Education, New Immunizations, …).
		// The previous body-mounted `position:fixed;right:0` overlay anchored to
		// the WINDOW edge instead of the editor pane, so when the chart wasn't
		// full-width the drawer slid in from the wrong side (QA issue 14).
		const overlay = DOM.append(this.root, DOM.$('div'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:200;display:flex;justify-content:flex-end;';
		this._chartCardFormOverlay = overlay;

		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';
		this._chartCardFormBackdrop = backdrop;

		const panel = DOM.append(overlay, DOM.$('div'));
		panel.style.cssText = 'position:relative;width:540px;max-width:95vw;height:100%;z-index:1;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border,#454545);box-shadow:-8px 0 24px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;';

		const close = () => { overlay.remove(); this._chartCardFormOverlay = null; this._chartCardFormBackdrop = null; };
		backdrop.addEventListener('click', close);

		// Header
		const hdr = DOM.append(panel, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--vscode-editorWidget-border,#454545);flex-shrink:0;';
		const titleEl = DOM.append(hdr, DOM.$('h3'));
		titleEl.textContent = card ? 'Edit Card' : 'Add Payment Method';
		titleEl.style.cssText = 'margin:0;font-size:15px;font-weight:600;color:var(--vscode-foreground);';
		const xBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		xBtn.textContent = '×';
		xBtn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:var(--vscode-descriptionForeground);padding:0 4px;';
		xBtn.addEventListener('click', close);

		// Body
		const body = DOM.append(panel, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;align-content:start;scrollbar-width:none;';

		const makeInput = (label: string, span2 = false, opts: Partial<HTMLInputElement> = {}): HTMLInputElement => {
			const g = DOM.append(body, DOM.$('div'));
			if (span2) { g.style.gridColumn = 'span 2'; }
			const lb = DOM.append(g, DOM.$('label'));
			lb.textContent = label;
			lb.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const el = DOM.append(g, DOM.$('input')) as HTMLInputElement;
			el.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';
			Object.assign(el, opts);
			return el;
		};
		const makeSelect = (label: string, opts: Array<{ value: string; label: string }>, span2 = false): HTMLInputElement => {
			const g = DOM.append(body, DOM.$('div'));
			if (span2) { g.style.gridColumn = 'span 2'; }
			const lb = DOM.append(g, DOM.$('label'));
			lb.textContent = label;
			lb.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			return createCustomDropdown({
				parent: g,
				options: opts,
				initialValue: opts[0]?.value || '',
				triggerStyle: 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;cursor:pointer;',
			});
		};
		const makeCheckbox = (label: string, span2 = false): HTMLInputElement => {
			const g = DOM.append(body, DOM.$('div'));
			if (span2) { g.style.gridColumn = 'span 2'; }
			g.style.cssText = 'display:flex;align-items:center;gap:8px;';
			const el = DOM.append(g, DOM.$('input')) as HTMLInputElement;
			el.type = 'checkbox';
			el.style.accentColor = 'var(--vscode-focusBorder,#007fd4)';
			const lb = DOM.append(g, DOM.$('label'));
			lb.textContent = label;
			lb.style.cssText = 'font-size:12px;color:var(--vscode-foreground);cursor:pointer;';
			lb.addEventListener('click', () => { el.checked = !el.checked; });
			return el;
		};

		const now = new Date();
		const holderEl = makeInput('Card Holder Name *', true, { maxLength: 100, placeholder: 'John Doe' });
		const numberEl = makeInput('Card Number *', true, { maxLength: 16, placeholder: '1234567890123456' });
		numberEl.addEventListener('input', () => { numberEl.value = numberEl.value.replace(/\D/g, ''); });
		const typeEl = makeSelect('Card Type', [
			{ value: 'VISA', label: 'Visa' }, { value: 'MASTERCARD', label: 'Mastercard' },
			{ value: 'AMEX', label: 'Amex' }, { value: 'DISCOVER', label: 'Discover' },
		]);
		const monthEl = makeSelect('Expiry Month *', Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1).padStart(2, '0') })));
		const yearEl = makeSelect('Expiry Year *', Array.from({ length: 16 }, (_, i) => { const y = now.getFullYear() + i; return { value: String(y), label: String(y) }; }));
		const cvvEl = makeInput('CVV *', false, { maxLength: 3, placeholder: '123' });
		// Digits only, capped at 3 (issue 16) — slice guards against paste that
		// bypasses the maxLength attribute.
		cvvEl.addEventListener('input', () => { cvvEl.value = cvvEl.value.replace(/\D/g, '').slice(0, 3); });
		const addrEl = makeInput('Billing Address', true, { placeholder: '123 Main St' });
		const cityEl = makeInput('City', false, { maxLength: 50, placeholder: 'New York' });
		const stateEl = makeInput('State', false, { maxLength: 50, placeholder: 'NY' });
		const zipEl = makeInput('Zip Code', false, { maxLength: 5, placeholder: '10001' });
		// Zip Code is numeric only — strip any non-digit as typed/pasted (maxLength
		// alone doesn't block letters) so an invalid ZIP can't be entered.
		zipEl.addEventListener('input', () => { zipEl.value = zipEl.value.replace(/\D/g, '').slice(0, 5); });
		const countryEl = makeInput('Country', false, { maxLength: 50, placeholder: 'USA' });
		const isDefaultEl = makeCheckbox('Set as default payment method', true);
		const isActiveEl = makeCheckbox('Active', true);

		// Pre-fill on edit
		if (card) {
			holderEl.value = String(card['cardHolderName'] || '');
			// Show the stored card number and CVV (the backend returns the full
			// values on the patient cards response) so the edit form reflects the
			// saved data instead of empty placeholders.
			numberEl.value = String(card['cardNumber'] || '');
			cvvEl.value = String(card['cvv'] || '');
			typeEl.value = String(card['cardType'] || 'VISA');
			monthEl.value = String(card['expiryMonth'] || 1);
			yearEl.value = String(card['expiryYear'] || now.getFullYear());
			addrEl.value = String(card['billingAddress'] || '');
			cityEl.value = String(card['billingCity'] || '');
			stateEl.value = String(card['billingState'] || '');
			zipEl.value = String(card['billingZip'] || '');
			countryEl.value = String(card['billingCountry'] || 'USA');
			isDefaultEl.checked = !!card['isDefault'];
			isActiveEl.checked = card['isActive'] !== false;
		} else {
			typeEl.value = 'VISA';
			monthEl.value = String(now.getMonth() + 1);
			yearEl.value = String(now.getFullYear());
			countryEl.value = 'USA';
			isActiveEl.checked = true;
		}

		// Error
		const errEl = DOM.append(body, DOM.$('div'));
		errEl.style.cssText = 'grid-column:span 2;color:#f48771;font-size:12px;padding:6px 10px;background:rgba(244,135,113,0.1);border:1px solid rgba(244,135,113,0.3);border-radius:4px;display:none;';

		// Footer
		const footer = DOM.append(panel, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--vscode-editorWidget-border,#454545);flex-shrink:0;';
		const cancelBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:7px 18px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', close);
		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = card ? 'Update' : 'Save';
		saveBtn.style.cssText = 'padding:7px 18px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';

		saveBtn.addEventListener('click', async () => {
			errEl.style.display = 'none';
			const holder = holderEl.value.trim();
			const num = numberEl.value.trim();
			const cvv = cvvEl.value.trim();
			const city = cityEl.value.trim();
			const state = stateEl.value.trim();
			if (!holder) { errEl.textContent = 'Card holder name is required.'; errEl.style.display = ''; return; }
			if (!card && !num) { errEl.textContent = 'Card number is required.'; errEl.style.display = ''; return; }
			if (!card && !cvv) { errEl.textContent = 'CVV is required.'; errEl.style.display = ''; return; }
			if (cvv && !/^\d{3}$/.test(cvv)) { errEl.textContent = 'CVV must be exactly 3 digits.'; errEl.style.display = ''; return; }
			// City / State: letters and spaces only — reject digits or other symbols.
			if (city && !/^[A-Za-z ]+$/.test(city)) { errEl.textContent = 'City must contain only letters and spaces.'; errEl.style.display = ''; return; }
			if (state && !/^[A-Za-z ]+$/.test(state)) { errEl.textContent = 'State must contain only letters and spaces.'; errEl.style.display = ''; return; }
			// Zip Code: numeric only (US 5-digit) — reject letters/symbols so invalid
			// billing ZIPs can't be saved.
			const zip = zipEl.value.trim();
			if (zip && !/^\d{5}$/.test(zip)) { errEl.textContent = 'Zip Code must be exactly 5 digits (e.g. 10001).'; errEl.style.display = ''; return; }

			const payload: Record<string, unknown> = {
				patientId: this.patientId,
				cardHolderName: holder,
				cardType: typeEl.value,
				expiryMonth: Number(monthEl.value),
				expiryYear: Number(yearEl.value),
				billingAddress: addrEl.value.trim() || undefined,
				billingCity: city || undefined,
				billingState: state || undefined,
				billingZip: zipEl.value.trim() || undefined,
				billingCountry: countryEl.value.trim() || 'USA',
				isDefault: isDefaultEl.checked,
				isActive: isActiveEl.checked,
			};
			if (num) { payload['cardNumber'] = num; }
			if (cvv) { payload['cvv'] = cvv; }

			saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
			try {
				const url = card ? `/api/credit-cards/${card['id']}` : '/api/credit-cards';
				const method = card ? 'PUT' : 'POST';
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				if (res.ok) { close(); onSaved(); }
				else {
					const errData = await res.json().catch(() => ({})) as Record<string, string>;
					errEl.textContent = errData['message'] || `Error ${res.status}`;
					errEl.style.display = '';
				}
			} catch {
				errEl.textContent = 'Failed to save. Please try again.';
				errEl.style.display = '';
			}
			saveBtn.disabled = false; saveBtn.textContent = card ? 'Update' : 'Save';
		});
	}

	// List tab render: search + clinical-status filter + table, all applied client-side.
	private _renderListWithFilters(container: HTMLElement, tab: ChartTab, config: FieldConfig | null, data: Record<string, unknown>[]): void {
		const inputStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';

		const filterBar = DOM.append(container, DOM.$('div'));
		filterBar.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;';

		const searchInput = DOM.append(filterBar, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = `Search by ${tab.label}...`;
		searchInput.style.cssText = inputStyle + 'flex:1;min-width:200px;max-width:320px;';

		// Status filter dropdown. Omitted on the History tab — its rows carry no
		// meaningful clinical status (and the create page has no status field), so
		// the "All Clinical Statuses" dropdown was noise there (QA request).
		let statusSel: HTMLSelectElement | undefined;
		if (tab.key !== 'history') {
			statusSel = DOM.append(filterBar, DOM.$('select')) as HTMLSelectElement;
			statusSel.style.cssText = inputStyle + 'cursor:pointer;min-width:180px;';
			// Status options differ by tab; fall back to clinical values for everything else
			const filterOpts = this._statusFilterOptions(tab);
			for (const opt of filterOpts) {
				const o = DOM.append(statusSel, DOM.$('option')) as HTMLOptionElement;
				o.value = opt.value; o.textContent = opt.label;
			}
		}

		const countBadge = DOM.append(filterBar, DOM.$('span'));
		countBadge.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-left:6px;';

		const tableWrap = DOM.append(container, DOM.$('div'));

		const matches = (item: Record<string, unknown>, q: string): boolean => {
			if (!q) { return true; }
			const hay = Object.values(item).map(v => {
				if (v === null || v === undefined) { return ''; }
				if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return ''; } }
				return String(v);
			}).join(' ').toLowerCase();
			return hay.includes(q.toLowerCase());
		};

		const statusOf = (item: Record<string, unknown>): string => {
			// Encounters filter on the same Signed / Unsigned state the table
			// renders — the raw FHIR status vocabulary never matched (QA issue 2).
			if (tab.key === 'encounters') {
				return PatientChartEditor._encounterSignedLabel(item.status).toLowerCase();
			}
			const cs = item.clinicalStatus as unknown;
			if (typeof cs === 'string') { return cs.toLowerCase(); }
			if (cs && typeof cs === 'object') {
				const obj = cs as Record<string, unknown>;
				const val = obj.code || obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.code || '';
				return String(val).toLowerCase();
			}
			const s = item.status;
			return typeof s === 'string' ? s.toLowerCase() : '';
		};

		const applyFilters = () => {
			const q = searchInput.value.trim();
			const st = statusSel ? statusSel.value : '';
			const filtered = data.filter(it => matches(it, q) && (!st || statusOf(it) === st));
			DOM.clearNode(tableWrap);
			countBadge.textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;
			if (filtered.length > 0) {
				this._listAuto(tableWrap, tab, filtered, config);
			} else {
				const empty = DOM.append(tableWrap, DOM.$('div'));
				empty.style.cssText = 'padding:40px 16px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
				const msg = DOM.append(empty, DOM.$('div'));
				msg.textContent = data.length === 0 ? `No ${tab.label.toLowerCase()} records` : 'No records match your filters';
				msg.style.cssText = 'margin-bottom:8px;';
				// Offer the inline "Create your first record" shortcut only on tabs that
				// allow in-chart creation. Encounters are excluded — they are
				// auto-created from the Appointments page ("Completed" status), never
				// added here — matching the "+ Add" button gate above. Read-only tabs
				// (ledgers, system reports) are excluded for the same reason.
				if (data.length === 0 && !tab.readOnly && tab.key !== 'encounters') {
					const link = DOM.append(empty, DOM.$('a'));
					link.textContent = 'Create your first record';
					link.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:none;font-size:12px;';
					link.addEventListener('click', () => this._openAddRecordDialog(tab, config));
				}
			}
		};

		let searchTimer: ReturnType<typeof setTimeout> | undefined;
		searchInput.addEventListener('input', () => {
			if (searchTimer) { clearTimeout(searchTimer); }
			searchTimer = setTimeout(applyFilters, 150);
		});
		statusSel?.addEventListener('change', applyFilters);
		applyFilters();
	}

	/**
	 * Validate user-entered values across a set of form sections, returning one
	 * entry per field that fails format validation. Shared by the Demographics
	 * (and other `display: 'form'` tabs) inline Save and the add/edit record
	 * drawer so phone / email / name / lot / dose negative-test inputs are
	 * blocked on every patient form rather than only in the drawer. Precedence
	 * per field: typed-but-invalid date → per-field validationPattern → implicit
	 * type=phone / type=email format → keyed fieldPatterns (name/title/lot/dose).
	 */
	private _collectFormatErrors(
		sections: FieldSection[],
		inputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
	): Array<{ key: string; label: string; el: HTMLElement; msg: string }> {
		// Letters + spaces + hyphens + apostrophes — proper-name fields.
		const namePattern = /^[A-Za-z][A-Za-z\s\-'.,()]*$/;
		// Free-text titles — letters, numbers and common punctuation.
		const titlePattern = /^[A-Za-z0-9][A-Za-z0-9\s\-'.,()/&]*$/;
		// Catalog-sourced clinical names (CPT procedure / LOINC test descriptions)
		// legitimately contain digits and symbols — e.g. "RADIOLOGIC EXAM CHEST
		// 4+ VIEWS", "Hemoglobin A1c" — so the letters-only namePattern rejected
		// the very value the code search auto-filled (QA issue 5).
		const clinicalNamePattern = /^[A-Za-z0-9][A-Za-z0-9\s\-'.,()/&+%:;]*$/;
		// Lot numbers: 5-10 letters and numbers only (e.g. FR8912, GJ8539).
		const lotPattern = /^[A-Za-z0-9]{5,10}$/;
		// Dose: positive number, optional unit suffix (e.g. "1.5" or "0.5 mL").
		const dosePattern = /^(?!0+(?:\.0+)?\s*$)\d+(?:\.\d+)?(?:\s*(mL|mg|mcg|units|IU|cc|g|%))?$/i;
		const fieldPatterns: Record<string, { rx: RegExp; msg: string }> = {
			allergyName: { rx: namePattern, msg: 'Letters only — no numbers or special characters' },
			medicationName: { rx: namePattern, msg: 'Letters only — no numbers or special characters' },
			procedureName: { rx: clinicalNamePattern, msg: 'Procedure name may contain letters, numbers and basic punctuation' },
			condition: { rx: namePattern, msg: 'Letters only — no numbers or special characters' },
			conditionName: { rx: namePattern, msg: 'Letters only — no numbers or special characters' },
			alert: { rx: namePattern, msg: 'Letters only — no numbers or special characters' },
			alertName: { rx: namePattern, msg: 'Letters only — no numbers or special characters' },
			testName: { rx: clinicalNamePattern, msg: 'Test name may contain letters, numbers and basic punctuation' },
			description: { rx: namePattern, msg: 'No special characters allowed' },
			materialTitle: { rx: titlePattern, msg: 'Title may contain letters, numbers and basic punctuation' },
			subject: { rx: namePattern, msg: 'No special characters allowed' },
			lotNumber: { rx: lotPattern, msg: 'Lot number must be 5-10 letters and numbers only (e.g. FR8912)' },
			lot_number: { rx: lotPattern, msg: 'Lot number must be 5-10 letters and numbers only (e.g. FR8912)' },
			dose: { rx: dosePattern, msg: 'Dose must be a positive number (e.g., 1.5 or 0.5 mL)' },
			doseNumber: { rx: /^[1-9]\d?$/, msg: 'Dose number must be a positive whole number between 1 and 99' },
			dose_number: { rx: /^[1-9]\d?$/, msg: 'Dose number must be a positive whole number between 1 and 99' },
			// Claim submission tracking number: digits only — reject letters/specials
			// (camelCase + snake_case so it fires whichever key the merged config emits).
			trackingNumber: { rx: /^[0-9]+$/, msg: 'Tracking number must contain digits only (0-9)' },
			tracking_number: { rx: /^[0-9]+$/, msg: 'Tracking number must contain digits only (0-9)' },
		};
		// US phone format (app-wide): exactly 10 digits, optionally with a leading
		// "+1"/"1" country code and "()", "-", ".", or whitespace separators —
		// e.g. "(555) 123-4567", "555-123-4567", "+1 555 123 4567".
		const US_PHONE_RX = /^\+?1?[\s().\-]*(?:\d[\s().\-]*){10}$/;
		const EMAIL_RX = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
		const invalid: Array<{ key: string; label: string; el: HTMLElement; msg: string }> = [];
		for (const sec of (sections || [])) {
			for (const f of (sec.fields || [])) {
				const el = inputs.get(f.key);
				if (!el) { continue; }
				const v = String(el.value ?? '').trim();
				// Claim Modifier (e.g. itemModifier): standard medical coding modifiers
				// are ALPHANUMERIC — "25", "59", "GT", "E/M". Accept letters/digits plus
				// the separators used for E/M and multi-modifier lists, and OVERRIDE any
				// stricter (e.g. numeric-only) pattern a merged config might carry, so a
				// valid modifier is never rejected in the create OR edit claim form.
				if (/modifier/i.test(f.key) || /^modifiers?$/i.test(f.label || '')) {
					if (v && !/^[A-Za-z0-9][A-Za-z0-9 ,/\-]*$/.test(v)) {
						invalid.push({ key: f.key, label: f.label, el, msg: 'Modifier accepts letters and numbers (e.g. 25, 59, GT)' });
					}
					continue;
				}
				// Catalog-sourced clinical names (CPT procedure / LOINC test
				// descriptions) legitimately contain digits and symbols — e.g.
				// "RADIOLOGIC EXAM CHEST 4+ VIEWS" auto-filled from the CPT search.
				// A merged backend tab_field_config may still carry a letters-only
				// validationPattern for these keys, which would reject the very value
				// the code search filled in — so validate them here with the clinical
				// pattern and OVERRIDE any stricter per-field pattern.
				if (f.key === 'procedureName' || f.key === 'testName' || /^(procedure|test) ?name$/i.test(f.label || '')) {
					if (v && !clinicalNamePattern.test(v)) {
						invalid.push({ key: f.key, label: f.label, el, msg: `${/test/i.test(f.key) ? 'Test' : 'Procedure'} name may contain letters, numbers and basic punctuation` });
					}
					continue;
				}
				// Reject typed-but-invalid dates (e.g. 13/33/2000) — _buildDateInput
				// flags these via dataset.invalid on the hidden ISO input.
				if (f.type === 'date' && el.dataset.invalid === '1') {
					invalid.push({ key: f.key, label: f.label, el, msg: 'Enter a valid date (MM/DD/YYYY)' });
					continue;
				}
				// A date of birth can never be in the future. Scope to birth-date
				// fields (other date fields — next appointment, follow-up — may be
				// future) by key/label. `v` is the hidden ISO yyyy-mm-dd value.
				if (f.type === 'date' && v && (/dob|birth/i.test(f.key) || /birth/i.test(f.label))) {
					const d = new Date(v);
					const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
					if (!isNaN(d.getTime()) && d.getTime() > endOfToday.getTime()) {
						invalid.push({ key: f.key, label: f.label, el, msg: 'Date of birth cannot be in the future' });
						continue;
					}
				}
				// Treat any phone/email field by TYPE or by key/label, so validation
				// holds even when the config types the field as plain text. The
				// key/label heuristic must NOT fire on non-text inputs: the boolean
				// Communication-Consent toggles "Allow Email Communication" (allowEmail)
				// and "Allow Voicemail" (allowVoicemail) both contain "email", so their
				// on/off value was being validated as an email address — it never matched
				// EMAIL_RX, so the whole Demographics form silently refused to save.
				const isTextInput = !/^(boolean|checkbox|switch|toggle|select|enum|radio|date|datetime|number|file)$/i.test(f.type || '');
				const isPhone = isTextInput && (f.type === 'phone' || /phone|mobile|fax|tel(?:ephone)?/i.test(f.key) || /phone|mobile|fax/i.test(f.label));
				const isEmail = isTextInput && (f.type === 'email' || /e-?mail/i.test(f.key) || /e-?mail/i.test(f.label));
				// Email format is canonical — enforce a real email shape for ANY
				// email-typed or email-keyed field up front, BEFORE the generic
				// validationPattern branch. The Demographics "Email Address" and
				// Guardian "Email" ship without a strict pattern, and a merged
				// backend tab_field_config could carry a permissive one, which would
				// otherwise let invalid addresses ("abc", "a@b") reach the patient
				// record because the email check used to sit behind the
				// validationPattern arm of the if/else chain.
				if (v && isEmail) {
					if (!EMAIL_RX.test(v)) {
						invalid.push({ key: f.key, label: f.label, el, msg: f.validationMessage || 'Enter a valid email address' });
					}
					continue;
				}
				// Per-field validationPattern takes precedence over the implicit
				// type/keyed checks below.
				if (v && f.validationPattern) {
					let matched = true;
					try {
						const rx = new RegExp(f.validationPattern, 'i'); // case-insensitive so unit suffixes match any casing
						matched = rx.test(v);
					} catch { /* malformed regex — skip */ }
					if (!matched) {
						invalid.push({ key: f.key, label: f.label, el, msg: f.validationMessage || 'Invalid format' });
						continue;
					}
				} else if (v && isPhone) {
					if (!US_PHONE_RX.test(v)) {
						invalid.push({ key: f.key, label: f.label, el, msg: 'Enter a valid 10-digit US phone number, e.g. (555) 123-4567' });
						continue;
					}
				}
				const rule = fieldPatterns[f.key];
				if (rule && v && !rule.rx.test(v)) {
					invalid.push({ key: f.key, label: f.label, el, msg: rule.msg });
				}
			}
		}
		return invalid;
	}

	/** Paint inline red-bordered error messages under each invalid field cell. */
	private _showFieldErrors(
		cells: Map<string, HTMLElement>,
		errors: Array<{ key: string; label: string; el: HTMLElement; msg: string }>
	): void {
		for (const p of errors) {
			p.el.style.borderColor = '#ef4444';
			const cell = cells.get(p.key);
			if (cell) {
				for (const child of Array.from(cell.children)) {
					if (child.classList.contains('field-error')) { child.remove(); }
				}
				const errMsg = DOM.append(cell, DOM.$('div.field-error'));
				errMsg.textContent = `${p.label}: ${p.msg}`;
				errMsg.style.cssText = 'color:#ef4444;font-size:11px;margin-top:3px;';
			}
		}
	}

	private async _saveFormTab(tab: ChartTab, btn: HTMLButtonElement, config: FieldConfig | null): Promise<boolean> {
		// Clear inline errors from a previous failed save attempt.
		for (const cell of this._formCells.values()) {
			for (const child of Array.from(cell.children)) {
				if (child.classList.contains('field-error')) { child.remove(); }
			}
		}
		// Block save when any date field holds a typed-but-invalid value (e.g.
		// 13/33/2000) — _buildDateInput flags these via dataset.invalid on the
		// hidden ISO input registered in _formInputs.
		for (const [key, el] of this._formInputs) {
			if (DOM.isHTMLInputElement(el) && el.dataset.invalid === '1') {
				this.notificationService.warn('Enter a valid date (MM/DD/YYYY) before saving.');
				const vis = this._dateVisibleByKey.get(key);
				if (vis) { vis.style.borderColor = '#ef4444'; vis.focus(); }
				return false;
			}
		}
		// Block save when a field fails format validation (phone / email / name /
		// lot / dose). Without this the Demographics inline Save bypassed the
		// validation the add/edit drawer enforces, letting invalid phone numbers
		// and email addresses reach the backend.
		const invalid = this._collectFormatErrors(config?.sections || [], this._formInputs);
		if (invalid.length > 0) {
			this._showFieldErrors(this._formCells, invalid);
			const first = invalid[0].el;
			first.scrollIntoView({ behavior: 'smooth', block: 'center' });
			if (typeof first.focus === 'function') { first.focus(); }
			this.notificationService.warn(`Invalid: ${invalid.map(p => p.label).join(', ')}`);
			return false;
		}
		const payload: Record<string, unknown> = {};
		for (const [key, el] of this._formInputs) {
			if (DOM.isHTMLInputElement(el) && el.type === 'checkbox') {
				payload[key] = el.checked;
			} else {
				const v = el.value;
				if (v !== '') { payload[key] = v; }
			}
		}
		if (Object.keys(payload).length === 0) {
			this.notificationService.info('No changes to save');
			return true;
		}

		btn.disabled = true;
		const prev = btn.textContent;
		btn.textContent = 'Saving...';
		let didSave = false;
		try {
			// Demographics → /api/patients/{id}, others → FHIR generic endpoint
			const isDemographics = tab.fhirResources.includes('Patient');
			const ep = this._tabEndpoint(tab);
			const path = isDemographics
				? `/api/patients/${this.patientId}`
				: `${(ep || '').split('?')[0]}/patient/${this.patientId}`;
			// Demographics PUT replaces the patient record — the backend rejects a
			// partial body ("Email is required" / "Failed to update patient", QA
			// issue 1) because required fields (email, gender, dateOfBirth, …) the
			// form didn't surface or the user didn't touch arrive null. Merge the
			// edits over the FULL patient so every field round-trips, mirroring the
			// working patientListPane edit (`{ ...patient, ...next }`). We re-fetch
			// the patient fresh here rather than trusting the cached
			// `this.patientData` — the initial `_loadPatient` can leave it empty
			// (token lapse / wrapping mismatch), which silently produced a partial
			// body and the rejected save.
			let body: Record<string, unknown> = payload;
			if (isDemographics) {
				let full: Record<string, unknown> = (this.patientData && Object.keys(this.patientData).length > 0) ? this.patientData : {};
				try {
					const cur = await this.apiService.fetch(`/api/patients/${this.patientId}`);
					if (cur.ok) {
						const j = await cur.json();
						// GET is ApiResponse-wrapped ({ data: {...} }); fall back to the
						// top-level object if a future endpoint returns it unwrapped.
						const cand = (j?.data ?? j) as Record<string, unknown> | null;
						if (cand && typeof cand === 'object' && !Array.isArray(cand) && Object.keys(cand).length > 0) { full = cand; }
					}
				} catch { /* fall back to cached patientData */ }
				body = { ...full, ...payload };
			}
			const res = await this.apiService.fetch(path, { method: 'PUT', body: JSON.stringify(body) });
			if (res.ok) {
				didSave = true;
				this.notificationService.info(`${tab.label} saved`);
				this._tabDataCache.delete(tab.key);
				if (isDemographics) {
					// Reflect the demographics edit instantly: merge the saved response
					// (falling back to the submitted body) into patientData and repaint
					// the header now, then reconcile from the server in the BACKGROUND
					// instead of blocking the render on a full re-fetch.
					const saved = await parseSavedRecord(res) ?? body;
					this.patientData = { ...(this.patientData || {}), ...saved };
					this._renderHeader();
					void this._loadPatient().then(() => this._renderHeader());
				}
				this._renderMain();
			} else {
				const err = await res.text().catch(() => 'Unknown error');
				this.notificationService.error(`Save failed: ${err.substring(0, 200)}`);
			}
		} catch (e) {
			this.notificationService.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			btn.disabled = false;
			btn.textContent = prev;
		}
		return didSave;
	}

	private _openAddRecordDialog(tab: ChartTab, config: FieldConfig | null, prefill?: Record<string, unknown>): void {
		this._openRecordDialog(tab, config, null, prefill);
	}

	private _openRecordDialog(tab: ChartTab, config: FieldConfig | null, existing: Record<string, unknown> | null, prefill?: Record<string, unknown>): void {
		const isEdit = !!existing;
		const recordId = existing ? String(existing.id || existing.fhirId || '') : '';

		// Right-side slide-in form panel — matches the Tasks "+ New Task" pattern
		// so every create/edit dialog across the EHR uses the same shape.
		const overlay = DOM.append(this.root, DOM.$('div'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:200;display:flex;justify-content:flex-end;';

		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';
		backdrop.addEventListener('click', () => overlay.remove());

		const panel = DOM.append(overlay, DOM.$('div'));
		const _themeType = this.themeService.getColorTheme().type;
		const _colorScheme = (_themeType === 'light' || _themeType === 'hcLight') ? 'light' : 'dark';
		panel.classList.add('ciyex-chart-add-panel');
		panel.style.cssText = `position:relative;width:560px;max-width:95vw;height:100%;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border);display:flex;flex-direction:column;z-index:1;box-shadow:-8px 0 24px rgba(0,0,0,0.3);color-scheme:${_colorScheme};`;
		// Force native <select> and <option> elements inside the chart dialog
		// to use the workbench dropdown colour vars. Without this, the native
		// option popup rendered with the OS's default scheme — which the
		// 12.05.26 test report flagged as the "Add New page is still light"
		// dropdown leak (issue 18) when the rest of the workspace is dark.
		const panelStyle = DOM.append(panel, DOM.$('style'));
		panelStyle.textContent = [
			'.ciyex-chart-add-panel select, .ciyex-chart-add-panel option {',
			'  background:var(--vscode-dropdown-background, var(--vscode-input-background));',
			'  color:var(--vscode-dropdown-foreground, var(--vscode-input-foreground));',
			'}',
			'.ciyex-chart-add-panel input, .ciyex-chart-add-panel textarea {',
			'  background:var(--vscode-input-background);',
			'  color:var(--vscode-input-foreground);',
			'}',
			'.ciyex-chart-add-panel input::placeholder, .ciyex-chart-add-panel textarea::placeholder {',
			'  color:var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));',
			'}',
		].join('\n');

		const hdrRow = DOM.append(panel, DOM.$('div'));
		hdrRow.style.cssText = 'display:flex;align-items:center;gap:12px;padding:18px 20px 14px;flex-shrink:0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const hdrTitle = DOM.append(hdrRow, DOM.$('h2'));
		hdrTitle.textContent = isEdit ? `Edit ${tab.label}` : `New ${tab.label}`;
		hdrTitle.style.cssText = 'margin:0;font-size:16px;font-weight:600;flex:1;';
		const closeBtn = DOM.append(hdrRow, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.title = 'Close';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;color:var(--vscode-foreground);padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const scrollArea = DOM.append(panel, DOM.$('div'));
		scrollArea.style.cssText = 'flex:1;min-height:0;overflow-y:auto;scrollbar-width:none;';
		scrollArea.classList.add('ehr-no-scrollbar');
		const formContainer = DOM.append(scrollArea, DOM.$('div'));
		formContainer.style.cssText = 'padding:20px;';

		// Save inputs to a local map (avoid clobbering the form-tab map)
		const saved = this._formInputs;
		const savedCells = this._formCells;
		this._formInputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
		this._formCells = new Map<string, HTMLElement>();

		try {
			if (config?.sections && config.sections.length > 0) {
				// Add/edit forms must render as one container per the test report.
				// Flatten any sub-sections (e.g. vitals → Vital Signs + Notes,
				// insurance → Policy + Subscriber, claims → Claim + Diagnosis) into
				// the first section. Demographics is the one exception — its 11
				// sub-sections (Personal, Contact, Emergency, Guardian, etc.) stay
				// separate because collapsing them into one card would be unwieldy.
				// In the right-side slide-in panel (~560px), 3+ columns cram fields too
				// tightly. Cap at 2 columns to keep inputs readable.
				const capCols = (s: FieldSection): FieldSection => ({ ...s, columns: Math.min(s.columns ?? 2, 2) });
				const sectionsToRender = tab.key !== 'demographics' && config.sections.length > 1
					? [capCols({
						...config.sections[0],
						collapsible: false,
						collapsed: false,
						fields: config.sections.flatMap(s => s.fields || []),
					})]
					: config.sections.map(capCols);
				// Merge prefill values into the seed record so the Add dialog
				// can pre-select fields when launched from a context-aware
				// button (e.g. Payment tab's "Post Payment" / "Collect
				// Payment" pre-set the `method` and `status` fields).
				const seed = { ...(existing || {}), ...(prefill || {}) };
				this._renderForm(formContainer, sectionsToRender, [seed]);
			} else if (existing) {
				// No field config but we have data — auto-generate editable fields from record keys
				this._renderAutoEditForm(formContainer, existing);
			} else {
				const note = DOM.append(formContainer, DOM.$('div'));
				note.textContent = `No field configuration for ${tab.label}. Set up in Settings → Field Config.`;
				note.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
			}
		} catch (e) {
			// Don't let form-render errors prevent the dialog from showing — the user still
			// needs Save/Cancel/Delete controls. Surface the error inline so it's diagnosable.
			DOM.clearNode(formContainer);
			const errBox = DOM.append(formContainer, DOM.$('div'));
			errBox.style.cssText = 'padding:14px;border:1px solid var(--vscode-editorError-border,#ef4444);border-radius:6px;background:rgba(239,68,68,0.08);color:var(--vscode-foreground);font-size:12px;';
			const title = DOM.append(errBox, DOM.$('div'));
			title.textContent = 'Could not render form fields';
			title.style.cssText = 'font-weight:600;margin-bottom:6px;';
			const detail = DOM.append(errBox, DOM.$('div'));
			detail.textContent = e instanceof Error ? e.message : String(e);
			detail.style.cssText = 'font-family:monospace;font-size:11px;color:var(--vscode-descriptionForeground);';
			// Still allow auto-edit if we have a record so user has something to work with
			if (existing) {
				try { this._renderAutoEditForm(formContainer, existing); } catch { /* */ }
			}
		}

		const dialogInputs = this._formInputs;
		const dialogCells = this._formCells;
		this._formInputs = saved;
		this._formCells = savedCells;

		const btnRow = DOM.append(panel, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;flex-shrink:0;background:var(--vscode-editorWidget-background,#252526);border-top:1px solid var(--vscode-editorWidget-border);';
		const btnRowInner = DOM.append(btnRow, DOM.$('div'));
		btnRowInner.style.cssText = 'width:100%;display:flex;gap:8px;justify-content:flex-end;padding:14px 20px;';

		// Tabs whose backend only supports create/read — no PUT/DELETE.
		// Treat them as effectively read-only on the edit dialog so we don't
		// surface buttons that lead to 405s.
		// Clinical Alerts is no longer write-once — moving to FHIR Flag means
		// the generic FHIR controller handles POST + PUT + DELETE through
		// /api/fhir-resource/clinical-alerts/patient/{id}/{recordId}, so the
		// edit dialog can show the standard Save / Delete buttons.
		const writeOnce = new Set<string>().has(tab.key);

		// Delete (edit only, and never for read-only tabs like ledgers/system reports)
		if (isEdit && recordId && !tab.readOnly && !writeOnce) {
			const delBtn = DOM.append(btnRowInner, DOM.$('button')) as HTMLButtonElement;
			delBtn.textContent = 'Delete';
			delBtn.style.cssText = 'padding:8px 20px;background:transparent;color:#ef4444;border:1px solid #ef4444;border-radius:4px;cursor:pointer;font-size:13px;margin-right:auto;';
			delBtn.addEventListener('click', async () => {
				const ep = (this._tabEndpoint(tab) || '').split('?')[0];
				if (!ep) { return; }
				try {
					// FHIR generic controller: /api/fhir-resource/{tabKey}/patient/{id}/{recordId}
					// for patient-scoped resources, /api/fhir-resource/{tabKey}/{recordId}
					// for org-level (Facility / Location).
					// apiPath endpoints (non-FHIR): /{ep}/{recordId}
					const isFhir = this._isFhirResourceTab(tab);
					const fhirPatient = isFhir && this._isPatientScoped(tab);
					// Lab orders delete at /api/lab-order/{patientId}/{id}; lab results
					// (and every other apiPath tab) use the plain {ep}/{id} shape.
					const delUrl = tab.key === 'labs'
						? `/api/lab-order/${this._clinicalPatientId()}/${recordId}`
						: isFhir
							? (fhirPatient ? `${ep}/patient/${this.patientId}/${recordId}` : `${ep}/${recordId}`)
							: `${ep}/${recordId}`;
					const res = await this.apiService.fetch(delUrl, { method: 'DELETE' });
					if (res.ok) {
						this.notificationService.info(`${tab.label} record deleted`);
						this._tabDataCache.delete(tab.key);
						overlay.remove();
						this._renderMain();
						void this._loadQuickInfo();
					} else {
						const err = await res.text().catch(() => 'Unknown error');
						this.notificationService.error(`Delete failed: ${err.substring(0, 200)}`);
					}
				} catch (e) {
					this.notificationService.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
				}
			});
		}

		const cancelBtn = DOM.append(btnRowInner, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:8px 20px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => overlay.remove());

		const saveBtn = DOM.append(btnRowInner, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
		saveBtn.style.cssText = 'padding:8px 20px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
		// Read-only tabs (ledger/transactions/system reports) are view-only.
		// Hide Save so users can't trigger 405 errors against endpoints that
		// don't accept POST/PUT. Same applies to write-once tabs on edit
		// (clinical-alerts: backend has POST but no PUT).
		if (tab.readOnly || (writeOnce && isEdit)) { saveBtn.style.display = 'none'; }
		saveBtn.disabled = dialogInputs.size === 0;
		saveBtn.addEventListener('click', async () => {
			// Validate required fields against the field config so the form catches
			// the "negative test cases" the test team flagged (empty / whitespace-only
			// inputs in required columns). Highlight the offending fields inline so
			// the user sees exactly what's missing — a toast alone wasn't enough.
			const requiredKeys: Array<{ key: string; label: string }> = [];
			for (const sec of (config?.sections || [])) {
				for (const f of (sec.fields || [])) {
					if (f.required) { requiredKeys.push({ key: f.key, label: f.label }); }
				}
			}
			// Clear any previous error state from a prior submit attempt.
			for (const [key, el] of dialogInputs) {
				const cell = dialogCells.get(key);
				if (cell) {
					const prevErr = cell.lastElementChild as HTMLElement | null;
					if (prevErr && prevErr.classList.contains('field-error')) { prevErr.remove(); }
				}
				el.style.borderColor = '';
			}
			const missing: Array<{ key: string; label: string; el: HTMLElement }> = [];
			for (const r of requiredKeys) {
				const el = dialogInputs.get(r.key);
				if (!el) { continue; }
				if (DOM.isHTMLInputElement(el) && el.type === 'checkbox') { continue; }
				const v = String(el.value ?? '').trim();
				if (!v) { missing.push({ key: r.key, label: r.label, el }); }
			}
			// ID-lookup fields MUST come from a dropdown selection — backends
			// look these up by FK, so a typed-but-not-selected value is
			// functionally empty and would otherwise produce the "given id
			// must not be null" save error the test team flagged on the
			// Education page. Same goes for patient/practitioner pickers.
			// Catch them up front regardless of the `required` flag.
			// Education's `materialId` field is registered as type `search`
			// (renders a typeahead bound to /api/education/materials). Without
			// `'search'` in the FK-type set, an un-selected entry slipped past
			// and reached the backend as a string Topic/Title — which the
			// PatientEducationService rejected with "The given id must not be
			// null" because JPA couldn't resolve the materialId FK.
			const idLookupRx = /(^|[A-Za-z])(materialId|locationId|providerId|formId|payerId|encounterId|organizationId|insurerId|educatorId)$/;
			for (const sec of (config?.sections || [])) {
				for (const f of (sec.fields || [])) {
					const isFkRef = f.type === 'patient-search' || f.type === 'practitioner-search'
						|| ((f.type === 'lookup' || f.type === 'search') && idLookupRx.test(f.key))
						|| f.key === 'materialId';
					if (!isFkRef) { continue; }
					const el = dialogInputs.get(f.key);
					if (!el) { continue; }
					const v = String(el.value ?? '').trim();
					if (!v && (f.required || f.key === 'materialId')) {
						if (!missing.some(m => m.key === f.key)) {
							missing.push({ key: f.key, label: `${f.label} (please pick from the search dropdown)`, el });
						}
					}
				}
			}
			// Format validation (phone / email / name / title / lot / dose / dates)
			// shared with the Demographics inline Save via _collectFormatErrors so
			// the negative-test inputs the team flagged are blocked identically on
			// every patient form.
			const invalidPattern = this._collectFormatErrors(config?.sections || [], dialogInputs);
			if (missing.length > 0 || invalidPattern.length > 0) {
				for (const m of missing) {
					m.el.style.borderColor = '#ef4444';
					const cell = dialogCells.get(m.key);
					if (cell) {
						const errMsg = DOM.append(cell, DOM.$('div.field-error'));
						errMsg.textContent = `${m.label} is required`;
						errMsg.style.cssText = 'color:#ef4444;font-size:11px;margin-top:3px;';
					}
				}
				this._showFieldErrors(dialogCells, invalidPattern);
				const firstEl = (missing[0]?.el ?? invalidPattern[0]?.el) as HTMLElement;
				firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
				if (typeof firstEl.focus === 'function') { firstEl.focus(); }
				const summary = [
					missing.length > 0 ? `Missing: ${missing.map(m => m.label).join(', ')}` : '',
					invalidPattern.length > 0 ? `Invalid: ${invalidPattern.map(p => p.label).join(', ')}` : '',
				].filter(Boolean).join('. ');
				this.notificationService.warn(summary);
				return;
			}

			// Appointments: the End Date/Time must not be in the past, and must come
			// after the Start — editing an appointment to a previous end date is
			// invalid (a date-comparison rule a regex pattern can't express).
			if (tab.key === 'appointments') {
				const endEl = dialogInputs.get('end');
				const startEl = dialogInputs.get('start');
				const endVal = String(endEl?.value ?? '').trim();
				const startVal = String(startEl?.value ?? '').trim();
				const endDate = endVal ? new Date(endVal) : null;
				let apptErr = '';
				if (endDate && !isNaN(endDate.getTime())) {
					if (endDate.getTime() < Date.now()) {
						apptErr = 'We can\'t assign a previous end date — choose a future date and time.';
					} else if (startVal) {
						const startDate = new Date(startVal);
						if (!isNaN(startDate.getTime()) && endDate.getTime() <= startDate.getTime()) {
							apptErr = 'End Date/Time must be after the Start Date/Time.';
						}
					}
				}
				if (apptErr) {
					const cell = dialogCells.get('end');
					if (cell) {
						const errMsg = DOM.append(cell, DOM.$('div.field-error'));
						errMsg.textContent = apptErr;
						errMsg.style.cssText = 'color:#ef4444;font-size:11px;margin-top:3px;';
					}
					const focusEl = (this._dateVisibleByKey.get('end') ?? (endEl as HTMLElement | undefined));
					if (focusEl) {
						focusEl.style.borderColor = '#ef4444';
						focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
						if (typeof focusEl.focus === 'function') { focusEl.focus(); }
					}
					this.notificationService.warn(apptErr);
					return;
				}
			}

			// Clinical Alerts: the End Date must not be earlier than the Identified
			// Date (QA issue 2: an end date before the identified date saved
			// successfully). Both fields hold ISO yyyy-mm-dd values, so a plain
			// string comparison orders correctly.
			if (tab.key === 'clinical-alerts') {
				const identifiedVal = String(dialogInputs.get('identifiedDate')?.value ?? '').trim();
				const endEl = dialogInputs.get('endDate');
				const endVal = String(endEl?.value ?? '').trim();
				if (identifiedVal && endVal && endVal < identifiedVal) {
					const alertErr = 'End Date cannot be earlier than the Identified Date.';
					const cell = dialogCells.get('endDate');
					if (cell) {
						const errMsg = DOM.append(cell, DOM.$('div.field-error'));
						errMsg.textContent = alertErr;
						errMsg.style.cssText = 'color:#ef4444;font-size:11px;margin-top:3px;';
					}
					const focusEl = (this._dateVisibleByKey.get('endDate') ?? (endEl as HTMLElement | undefined));
					if (focusEl) {
						focusEl.style.borderColor = '#ef4444';
						focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
						if (typeof focusEl.focus === 'function') { focusEl.focus(); }
					}
					this.notificationService.warn(alertErr);
					return;
				}
			}

			// Immunizations: a vaccine that expired BEFORE it was administered is a
			// documentation error — block the save (QA: an expired vaccine saved
			// without any validation). Expiry on/after the administration date is
			// allowed so historical records (long-past lots) stay editable.
			if (tab.key === 'immunizations') {
				const adminVal = String(dialogInputs.get('administrationDate')?.value ?? '').trim();
				const expEl = dialogInputs.get('expirationDate');
				const expVal = String(expEl?.value ?? '').trim();
				if (adminVal && expVal && expVal < adminVal) {
					const immErr = 'Expiration Date is before the Date Administered — an expired vaccine cannot be administered.';
					const cell = dialogCells.get('expirationDate');
					if (cell) {
						const errMsg = DOM.append(cell, DOM.$('div.field-error'));
						errMsg.textContent = immErr;
						errMsg.style.cssText = 'color:#ef4444;font-size:11px;margin-top:3px;';
					}
					const focusEl = (this._dateVisibleByKey.get('expirationDate') ?? (expEl as HTMLElement | undefined));
					if (focusEl) {
						focusEl.style.borderColor = '#ef4444';
						focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
						if (typeof focusEl.focus === 'function') { focusEl.focus(); }
					}
					this.notificationService.warn(immErr);
					return;
				}
			}

			// Problems: a Resolved Date only makes sense once the problem is no
			// longer Active — an Active problem with a (past) resolved date is
			// contradictory (QA issue 2). Also keep the date order sane: the
			// Resolved Date must not precede the Onset Date.
			if (tab.key === 'problems') {
				const statusVal = String(dialogInputs.get('clinicalStatus')?.value ?? dialogInputs.get('status')?.value ?? '').trim().toLowerCase();
				const resolvedEl = dialogInputs.get('resolvedDate');
				const resolvedVal = String(resolvedEl?.value ?? '').trim();
				const onsetVal = String(dialogInputs.get('onsetDate')?.value ?? '').trim();
				let probErr = '';
				if (resolvedVal && statusVal === 'active') {
					probErr = 'Resolved Date can only be set when the problem Status is not Active.';
				} else if (resolvedVal && onsetVal && resolvedVal < onsetVal) {
					probErr = 'Resolved Date cannot be earlier than the Onset Date.';
				}
				if (probErr) {
					const cell = dialogCells.get('resolvedDate');
					if (cell) {
						const errMsg = DOM.append(cell, DOM.$('div.field-error'));
						errMsg.textContent = probErr;
						errMsg.style.cssText = 'color:#ef4444;font-size:11px;margin-top:3px;';
					}
					const focusEl = (this._dateVisibleByKey.get('resolvedDate') ?? (resolvedEl as HTMLElement | undefined));
					if (focusEl) {
						focusEl.style.borderColor = '#ef4444';
						focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
						if (typeof focusEl.focus === 'function') { focusEl.focus(); }
					}
					this.notificationService.warn(probErr);
					return;
				}
			}

			const isFhir = this._isFhirResourceTab(tab);
			// FHIR endpoints take patientId from the URL path, not the body.
			// apiPath endpoints (e.g. /api/cds/alerts) still need patientId in the body.
			const payload: Record<string, unknown> = isFhir || isEdit ? {} : { patientId: this.patientId };
			for (const [key, el] of dialogInputs) {
				if (DOM.isHTMLInputElement(el) && el.type === 'checkbox') {
					payload[key] = el.checked;
				} else {
					const v = el.value?.trim?.() ?? el.value;
					if (v === '' || v === null || v === undefined) { continue; }
					if (DOM.isHTMLInputElement(el) && el.type === 'number') {
						const n = parseFloat(v);
						if (!isNaN(n)) { payload[key] = n; }
					} else {
						payload[key] = v;
					}
				}
			}
			// On CREATE we MUST NOT send an `id` / `fhirId` field — HAPI / JPA
			// will reject with "The given id must not be null" if it sees a null
			// or empty id, and even a stale id from a prefill seed would point
			// the server at the wrong row. Strip every id-flavoured key so the
			// backend can mint its own. See feedback_fhir_clear_id_before_create.
			if (!isEdit) {
				delete payload.id;
				delete payload.fhirId;
				delete payload.uuid;
				delete payload._id;
				delete payload.resourceId;
			}

			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';
			try {
				const ep = (this._tabEndpoint(tab) || '').split('?')[0];
				if (!ep) { throw new Error('No endpoint for this tab'); }
				// Encounter provider maps to FHIR Encounter.participant[0].individual.reference.
				// The backend's reference-type inference can't resolve the resource type for
				// an *indexed* path (participant[0].individual), so a bare practitioner id
				// reaches HAPI as "13643" and is rejected (HAPI-0505: "Does not contain
				// resource type"). Prefix it with "Practitioner/" here so the saved reference
				// is well-formed. Patient comes from the URL path, not the body.
				if (tab.key === 'encounters') {
					for (const provKey of ['provider', 'providerId']) {
						const v = payload[provKey];
						if (typeof v === 'string' && v.trim() && !v.includes('/')) {
							payload[provKey] = `Practitioner/${v.trim()}`;
						}
					}
				}
				// Medications prescriber maps to MedicationRequest.requester.reference
				// (ciyex V140 tab_field_config). The field holds a bare Practitioner
				// id (e.g. "13643") which round-trips back into the table as-is, so
				// the Prescriber column showed the raw id instead of the name. Prefix
				// it with "Practitioner/" so the stored reference is well-formed FHIR
				// and read-back yields "Practitioner/13643" — the table's id→name
				// resolver then renders the prescriber name. (Same fix shape as the
				// encounter provider above.)
				if (tab.key === 'medications') {
					const v = payload.prescribingDoctor;
					if (typeof v === 'string' && v.trim() && !v.includes('/')) {
						payload.prescribingDoctor = `Practitioner/${v.trim()}`;
					}
				}
				// Claim facility maps to FHIR Claim.facility.reference (ciyex
				// tab_field_config key `facilityReference`, backed by /api/locations).
				// The backend's reference-type inference has no rule for the
				// "facility" path, so a bare Location id reaches HAPI as "13642"
				// and is rejected (HAPI-0505: "Does not contain resource type").
				// Prefix it with "Location/" so the saved reference is well-formed.
				// (Same fix shape as the encounter provider and medication
				// prescriber above.)
				if (tab.key === 'claims') {
					for (const facKey of ['facilityReference', 'facilityId', 'facility']) {
						const v = payload[facKey];
						if (typeof v === 'string' && v.trim() && !v.includes('/')) {
							payload[facKey] = `Location/${v.trim()}`;
						}
					}
				}
				// Appointment references map to FHIR Appointment.participant[].actor.
				// Like the encounter/medication/claim references above, the backend's
				// reference-type inference can't resolve the resource type for the
				// indexed participant path, so a bare id (e.g. patient "13656",
				// practitioner / location ids) reaches HAPI as "13656" and is
				// rejected with HAPI-0505 "Does not contain resource type". Prefix
				// each with its FHIR resource type so the saved references are
				// well-formed: patient → Patient/, provider → Practitioner/,
				// location → Location/.
				if (tab.key === 'appointments') {
					const refTypes: Array<{ keys: string[]; type: string }> = [
						{ keys: ['patient', 'patientId'], type: 'Patient' },
						{ keys: ['provider', 'providerId', 'practitioner'], type: 'Practitioner' },
						{ keys: ['location', 'locationId'], type: 'Location' },
					];
					for (const { keys, type } of refTypes) {
						for (const k of keys) {
							const v = payload[k];
							if (typeof v === 'string' && v.trim() && !v.includes('/')) {
								payload[k] = `${type}/${v.trim()}`;
							}
						}
					}
				}
				if (tab.key === 'vitals' && !isEdit && !payload.recordedAt) {
					payload.recordedAt = new Date().toISOString();
				}
				// Education assignments — the backend's PatientEducationService
				// requires a real numeric materialId FK (it rejects free text with
				// "Education material is required"). The Topic / Title field is now
				// free text (`materialTitle`), so create an EducationMaterial from the
				// typed title first, then assign its returned id. flat materialId +
				// patientId then go in the body of POST /api/education/assignments.
				if (tab.key === 'education' && !isEdit) {
					const title = String(payload.materialTitle ?? '').trim();
					if (!title) {
						saveBtn.disabled = false;
						saveBtn.textContent = 'Save';
						this.notificationService.error('Please enter a Topic / Title before saving.');
						return;
					}
					// Create the education material so the assignment has a valid FK.
					try {
						const matBody: Record<string, unknown> = { title };
						if (payload.category) { matBody.category = payload.category; }
						if (payload.content) { matBody.content = payload.content; }
						if (payload.url) { matBody.externalUrl = payload.url; }
						const matRes = await this.apiService.fetch('/api/education/materials', { method: 'POST', body: JSON.stringify(matBody) });
						if (!matRes.ok) { throw new Error(`material create failed: ${matRes.status}`); }
						const matJson = await matRes.json();
						const matObj = (matJson?.data ?? matJson) as Record<string, unknown>;
						const newId = matObj?.id;
						if (newId === null || newId === undefined || newId === '') { throw new Error('material create returned no id'); }
						payload.materialId = typeof newId === 'number' ? newId : (parseInt(String(newId), 10) || newId);
					} catch {
						saveBtn.disabled = false;
						saveBtn.textContent = 'Save';
						this.notificationService.error('Could not save the education topic. Please try again.');
						return;
					}
					if (this.patientId && !payload.patientId) {
						const numPid = parseInt(this.patientId, 10) || this.patientId;
						payload.patientId = numPid;
					}
					delete payload.material;
					delete payload.patient;
				}
				// Education (create AND edit): the backend DTO has no
				// deliveryMethod/educator columns, so carry them in the unused
				// `notes` field as JSON. _decodeEducationMeta restores them on read.
				if (tab.key === 'education') {
					const dm = payload.deliveryMethod;
					const ed = payload.educator;
					const hasDm = dm !== undefined && dm !== null && dm !== '';
					const hasEd = ed !== undefined && ed !== null && ed !== '';
					if (hasDm || hasEd) {
						payload.notes = JSON.stringify({ __ciyexEdu: 1, deliveryMethod: hasDm ? dm : '', educator: hasEd ? ed : '' });
					}
				}
				// Documents — the FHIR DocumentReference URI search-parameter
				// has a uniqueness constraint on HAPI's hfj_spidx_uri index.
				// Two uploads without a distinct URL collide on that index
				// and produce HAPI-0550 ("could not execute batch") on save.
				// Inject a unique urn:uuid token whenever the form left the
				// URL blank so every record indexes cleanly.
				if (tab.key === 'documents' && !isEdit) {
					const existingUrl = String(payload.url || payload.fileUrl || '').trim();
					if (!existingUrl) {
						const uniq = `urn:uuid:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
						payload.url = uniq;
					}
					// The backend's patient-scoped DocumentReference search returns ONLY
					// status=current documents (verified against api-dev: a doc POSTed
					// with status "superseded" is created — 201, readable by id — but
					// never listed, and the endpoint ignores a ?status= override). So a
					// NEW document saved as Superseded/Entered-in-Error silently
					// disappears from the Documents module and the dashboard widget (QA
					// issue 3). A brand-new document is by definition the current one —
					// coerce create-time status and tell the user.
					const docStatus = String(payload.status ?? '').trim().toLowerCase();
					if (docStatus && docStatus !== 'current') {
						payload.status = 'current';
						this.notificationService.info('New documents are saved with status "Current" — the server only lists current documents.');
					}
					// The by-patient search is also what links the row to this patient
					// everywhere else (list + dashboard widget); carry the id in the
					// body too so the linkage never depends on the URL path alone.
					if (payload.patientId === undefined) {
						payload.patientId = parseInt(this.patientId, 10) || this.patientId;
					}
				}
				// Org-level FHIR resources (Facility / Location) skip the
				// /patient/{id} prefix — they are not patient-scoped.
				const fhirPatient = isFhir && this._isPatientScoped(tab);
				let url = isFhir
					? (fhirPatient
						? (isEdit ? `${ep}/patient/${this.patientId}/${recordId}` : `${ep}/patient/${this.patientId}`)
						: (isEdit ? `${ep}/${recordId}` : ep))
					: (isEdit ? `${ep}/${recordId}` : ep);
				// Education assignments: backend route is POST /api/education/assignments
				// — flat materialId + patientId go in the body (not the URL path).
				if (tab.key === 'education' && !isEdit) {
					url = '/api/education/assignments';
				}
				// Labs write to the clinical stores. Lab ORDERS are patient-scoped
				// WITHOUT the FHIR "/patient/" segment (/api/lab-order/{pid}[/id]); lab
				// RESULTS use the flat /api/lab-results[/id] shape the generic non-FHIR
				// url above already produced. Both carry patientId in the body so the
				// row links to this patient (the URL only carries it for orders).
				if (tab.key === 'labs') {
					const cpid = this._clinicalPatientId();
					url = isEdit ? `/api/lab-order/${cpid}/${recordId}` : `/api/lab-order/${cpid}`;
				}
				if (tab.key === 'labs' || tab.key === 'lab-results') {
					payload.patientId = this._clinicalPatientId();
				}
				// Immunizations / Referrals write to the clinical stores
				// (/api/immunizations, /api/referrals) — the same rows the clinical
				// pages list (QA issues 4 & 6). Carry the clinical patient id and
				// display name so the row links to this patient over there.
				if (tab.key === 'immunizations' || tab.key === 'referrals') {
					payload.patientId = this._clinicalPatientId();
					if (!payload.patientName) {
						const pd = this.patientData || {};
						payload.patientName = this.patientName || `${String(pd.firstName || '')} ${String(pd.lastName || '')}`.trim();
					}
				}
				// The clinical immunizations DTO stores dose-in-series as an Integer
				// (doseNumber) plus the free "0.5 mL" text in doseSeries — split it
				// exactly like the clinical page's beforeSave does, so units typed
				// in the chart don't blow up the backend's Integer column.
				if (tab.key === 'immunizations') {
					const rawDose = String(payload.doseNumber ?? payload.doseSeries ?? payload.dose ?? '').trim();
					delete payload.dose;
					if (rawDose) {
						const m = rawDose.match(/-?\d+(?:\.\d+)?/);
						const num = m ? parseFloat(m[0]) : NaN;
						payload.doseNumber = Number.isFinite(num) ? Math.round(num) : null;
						payload.doseSeries = rawDose;
					} else {
						payload.doseNumber = null;
					}
				}
				const method = isEdit ? 'PUT' : 'POST';
				let res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				// A denial's optional "Original Claim" (ClaimResponse.request) is a FHIR
				// reference HAPI validates for existence. If it points at a Claim that
				// doesn't exist (e.g. a bare claim number typed into an older text field),
				// the WHOLE save fails with HAPI-1094 "Resource Claim/<id> not found,
				// specified in path: ClaimResponse.request". The link is optional, so drop
				// it and retry once rather than losing the entire denial. Mirrors the
				// reference-prefix guards above and the upsert fallback used elsewhere.
				if (!res.ok && payload.request) {
					const errText = await res.clone().text().catch(() => '');
					if (/HAPI-1094/i.test(errText) && /request/i.test(errText)) {
						delete payload.request;
						res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
					}
				}
				if (res.ok) {
					this.notificationService.info(isEdit ? `${tab.label} updated` : `${tab.label} record created`);
					overlay.remove();

					// Optimistic update: read the create/update response and inject the
					// saved record into the in-memory cache so the table repaints with
					// the new row immediately — no "Loading…" flash, no waiting on the
					// FHIR search index. A single silent background re-fetch follows at
					// 1.5s to reconcile any server-side derived fields.
					let savedRecord: Record<string, unknown> | null = null;
					try {
						const respJson = await res.json();
						const candidate = (respJson?.data ?? respJson) as Record<string, unknown> | null;
						if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
							savedRecord = candidate;
						}
					} catch { /* response not JSON — skip optimistic merge */ }

					const merged: Record<string, unknown> = { ...payload, ...(savedRecord || {}) };
					if (isEdit && recordId) {
						const cached = this._tabDataCache.get(tab.key);
						if (cached) {
							cached.data = cached.data.map(r => {
								const id = String(r.id ?? r.fhirId ?? '');
								return id === String(recordId) ? { ...r, ...merged } : r;
							});
							this._tabDataCache.set(tab.key, cached);
						}
					} else {
						// Track this create so the list keeps showing it past the 1.5s
						// reconciliation refetch — the server's FHIR search index may
						// not have surfaced it yet. _mergePendingCreates drops it once
						// the server returns it. Only track records with a real server
						// id so reconciliation can dedupe; a tmp id would never match a
						// server record and could render a duplicate row.
						if (this._recordId(merged)) {
							const pend = this._pendingCreates.get(tab.key) || [];
							pend.unshift(merged);
							this._pendingCreates.set(tab.key, pend);
						} else {
							// No id came back — fall back to a tmp id for the optimistic
							// row so row-action handlers don't break before refresh.
							merged.id = `tmp-${Date.now()}`;
						}
						const cached = this._tabDataCache.get(tab.key);
						if (cached) {
							cached.data = [merged, ...cached.data];
							this._tabDataCache.set(tab.key, cached);
						}
					}
					if (this.activeTab === tab.key) { this._renderMain(); }

					// Broadcast the save so sibling editors on the same patient (the
					// Patient Snapshot) overlay this record immediately — their own
					// refetch can still hit the stale FHIR search index for seconds
					// (QA: problem created here missing from snapshot Active Problems).
					if (!String(merged.id ?? '').startsWith('tmp-')) {
						this.apiService.notifyClinicalRecordMutation({
							entity: tab.key,
							patientId: this.patientId,
							kind: isEdit ? 'update' : 'create',
							record: merged,
						});
					}

					// Silent reconciliation: clear the cache once, re-render. The
					// refreshed render hits a cold cache, fetches fresh data, then
					// repaints with whatever the server has (now indexed).
					DOM.getActiveWindow().setTimeout(() => {
						this._tabDataCache.delete(tab.key);
						if (this.activeTab === tab.key) { this._renderMain(); }
					}, 1500);

					void this._loadQuickInfo();
					void this._refreshTabCounts();
				} else {
					const err = await res.text().catch(() => 'Unknown error');
					this.notificationService.error(`Save failed: ${err.substring(0, 200)}`);
					saveBtn.disabled = false;
					saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
				}
			} catch (e) {
				this.notificationService.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
				saveBtn.disabled = false;
				saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
			}
		});
	}

	// Generates editable inputs from the record's own keys when no FieldConfig exists.
	private _renderAutoEditForm(container: HTMLElement, record: Record<string, unknown>): void {
		const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		const skip = new Set(['id', 'fhirId', 'patient', 'patientId', 'resourceType', 'meta', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']);

		const grid = DOM.append(container, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;';

		for (const [key, raw] of Object.entries(record)) {
			if (skip.has(key) || key.startsWith('_')) { continue; }

			const cell = DOM.append(grid, DOM.$('div'));
			cell.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

			const lbl = DOM.append(cell, DOM.$('label'));
			lbl.textContent = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
			lbl.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;';

			// Skip non-primitive values (object/array) — show read-only display
			if (raw !== null && typeof raw === 'object') {
				const ro = DOM.append(cell, DOM.$('div'));
				const obj = raw as Record<string, unknown>;
				ro.textContent = String(obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.display || JSON.stringify(raw).substring(0, 60));
				ro.style.cssText = inputStyle + 'opacity:0.7;font-style:italic;';
				continue;
			}

			if (typeof raw === 'boolean') {
				const wrap = DOM.append(cell, DOM.$('div'));
				wrap.style.cssText = 'display:flex;align-items:center;gap:8px;height:32px;';
				const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				cb.type = 'checkbox'; cb.checked = raw;
				cb.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:var(--vscode-focusBorder,#007acc);';
				this._formInputs.set(key, cb);
				continue;
			}

			const val = raw === null || raw === undefined ? '' : String(raw);
			const isDate = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw);
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = isDate ? 'date' : (typeof raw === 'number' ? 'number' : 'text');
			inp.value = isDate ? val.split('T')[0] : val;
			inp.style.cssText = inputStyle;
			this._formInputs.set(key, inp);
		}
	}

	// --- Form renderer (grid by section) ---

	private _renderForm(container: HTMLElement, sections: FieldSection[], data: Record<string, unknown>[]): void {
		const record = ((data[0] as Record<string, unknown>)?.data as Record<string, unknown>) || data[0] || {};

		// Capture the inputs map for this render. `_openRecordDialog` swaps
		// `this._formInputs` to a temporary map during render and restores the
		// main map afterward, so the deferred showWhen `applyVisibility` (which
		// fires on later user interaction) must look up controls in THIS map, not
		// `this._formInputs` at call time — otherwise conditional fields never
		// toggle in the New/Edit drawer (e.g. insurance "Relationship = Self").
		const formInputs = this._formInputs;

		// Track cells for fields with showWhen, so we can hide/show them based on another field's value.
		const conditionalFields: Array<{ field: FieldDef; cell: HTMLElement }> = [];

		for (const sec of sections) {
			// Default to visible when not explicitly set (backend tab_field_config seeds omit `visible`)
			if (sec.visible === false) { continue; }
			const cols = Math.min(sec.columns || 3, 4);
			const isCollapsible = sec.collapsible !== false; // default collapsible

			// Section card — rounded bordered block, matches the web UI's expandable panels
			const card = DOM.append(container, DOM.$('div'));
			card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin:0 0 12px;overflow:hidden;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';

			const subHeader = DOM.append(card, DOM.$('div'));
			subHeader.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 14px;font-size:13px;font-weight:600;color:var(--vscode-foreground);background:rgba(0,122,204,0.04);${isCollapsible ? 'cursor:pointer;' : ''}`;
			const titleSpan = DOM.append(subHeader, DOM.$('span'));
			titleSpan.textContent = sec.title;
			const chevron = DOM.append(subHeader, DOM.$('span'));
			chevron.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);transition:transform 0.15s;';

			const gridBody = DOM.append(card, DOM.$('div'));
			gridBody.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:10px 16px;padding:14px 16px;`;

			const applyCollapsed = (collapsed: boolean) => {
				gridBody.style.display = collapsed ? 'none' : 'grid';
				// allow-any-unicode-next-line
				chevron.textContent = collapsed ? '▸' : '▾';
			};
			applyCollapsed(!!sec.collapsed);
			if (isCollapsible) {
				subHeader.addEventListener('click', () => {
					sec.collapsed = !sec.collapsed;
					applyCollapsed(!!sec.collapsed);
				});
			} else {
				chevron.style.display = 'none';
			}

			for (const f of sec.fields) {
				// Read the value off the record. When the field is empty AND the
				// FieldDef declared a defaultValue (function or scalar), seed the
				// input with that default so the form opens with sensible
				// pre-filled values — Identified Date / Recorded Date / Payment
				// Date / etc. were rendering blank because this fallback was
				// missing, leaving "the field is required" failures and the
				// "auto-fill today's date" complaint from the test report.
				const recordVal = (record as Record<string, unknown>)[f.key];
				let val: unknown = recordVal ?? '';
				if ((val === '' || val === null || val === undefined) && f.defaultValue !== undefined) {
					try {
						val = typeof f.defaultValue === 'function' ? (f.defaultValue as () => string | number)() : f.defaultValue;
					} catch { /* default fn threw — leave blank */ }
				}

				const cell = DOM.append(gridBody, DOM.$('div'));
				cell.style.cssText = `grid-column:span ${Math.min(f.colSpan || 1, cols)};padding:4px 0;`;
				this._formCells.set(f.key, cell);

				const lbl = DOM.append(cell, DOM.$('label'));
				lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;';
				const lblText = DOM.append(lbl, DOM.$('span'));
				lblText.textContent = f.label;
				if (f.required) {
					const req = DOM.append(lbl, DOM.$('span'));
					req.textContent = ' *';
					req.style.cssText = 'color:#ef4444;';
				}

				const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:13px;height:32px;box-sizing:border-box;outline:none;';

				if (f.type === 'select') {
					// Backend tab_field_config sometimes ships option arrays as bare
					// strings (V58 appointments: ["Consultation","Follow-up",...])
					// instead of {label,value} objects. Normalize so the dropdown
					// renders something other than a list of "undefined" rows —
					// this is what was breaking the Visit Type / Priority pickers
					// on the patient-chart appointments add page.
					const rawOpts = f.options || [];
					const normOpts: Array<{ label: string; value: string }> = rawOpts.map(o => {
						if (typeof o === 'string') { return { label: o, value: o }; }
						return o as { label: string; value: string };
					});
					// Custom dropdown — native <select> popups inherit OS chrome
					// which on dark workbench themes shows non-highlighted
					// options as faint grey-on-grey (QA-reported unreadable
					// dropdown). The custom widget paints with workbench theme
					// colours and stays readable on every theme.
					const sel = createCustomDropdown({
						parent: cell,
						options: normOpts,
						initialValue: String(val),
						placeholder: `Select ${f.label}...`,
						triggerStyle: inputStyle + 'cursor:pointer;',
					});
					this._formInputs.set(f.key, sel);
				} else if (f.type === 'boolean' || f.type === 'toggle' || f.type === 'checkbox') {
					// Backend tab_field_config ships the Emergency Contact toggle as type
					// "checkbox" (V139); treat it the same as boolean so it renders a
					// checkbox instead of falling through to a plain text input.
					const wrap = DOM.append(cell, DOM.$('div'));
					wrap.style.cssText = 'display:flex;align-items:center;gap:8px;height:32px;';
					const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
					cb.type = 'checkbox'; cb.checked = !!val;
					cb.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:var(--vscode-focusBorder,#007acc);';
					const cbLabel = DOM.append(wrap, DOM.$('span'));
					cbLabel.textContent = val ? 'Yes' : 'No';
					cb.addEventListener('change', () => { cbLabel.textContent = cb.checked ? 'Yes' : 'No'; });
					this._formInputs.set(f.key, cb);
				} else if (f.type === 'textarea') {
					const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
					ta.value = String(val); ta.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					ta.style.cssText = inputStyle + 'min-height:70px;height:auto;resize:vertical;';
					this._formInputs.set(f.key, ta);
				} else if (f.type === 'date') {
					// Date-only field: mm/dd/yyyy text + native picker; hidden ISO for save.
					this._buildDateInput(cell, f, String(val).split('T')[0], inputStyle);
				} else if (f.type === 'datetime') {
					// Datetime field: combined date + custom time dropdown so the user
					// picks BOTH the date and the time, and the time half closes
					// deterministically on selection (the native datetime-local picker
					// can't be reliably auto-closed in the Electron workbench — blur()
					// is a no-op there, so it stayed open after a pick).
					const raw = String(val ?? '');
					const dt = createDateTimeDropdown({
						parent: cell,
						initialValue: raw && raw.length >= 16 ? raw.slice(0, 16) : raw,
						inputStyle,
					});
					this._formInputs.set(f.key, dt);
				} else if (f.type === 'number') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'number'; inp.value = String(val); inp.placeholder = f.placeholder || '0';
					inp.style.cssText = inputStyle;
					this._formInputs.set(f.key, inp);
				} else if (f.type === 'code-search' || f.type === 'practitioner-search' || f.type === 'patient-search' || f.type === 'lookup' || f.type === 'coded' || (f.type === 'search' && f.apiPath)) {
					// Reference fields round-trip as a bare id. Drill a reference
					// object down to its id string for the hidden save value, and
					// seed the visible input from the record's companion display
					// name so re-editing shows the name, not the id.
					let cv: unknown = val;
					if (cv && typeof cv === 'object' && !Array.isArray(cv)) {
						const r = cv as Record<string, unknown>;
						cv = (typeof r.reference === 'string' ? r.reference : r.id) ?? '';
					}
					const displayHint = this._referenceDisplayHint(record, f);
					this._buildSearchInput(cell, f, String(cv ?? ''), inputStyle, displayHint);
				} else if (f.type === 'file' || f.type === 'image' || /photo|avatar|picture/i.test(f.key) || /^image(url)?$/i.test(f.key)) {
					// File / photo upload — reads the selected file as a base64 data
					// URL and stores it on the hidden input so the save payload picks
					// it up. Issue #7: the Demographics "Photo" field used to render as
					// a plain "Photo URL" text box; photo/image fields now get an
					// image-only file picker with a live thumbnail preview, matching
					// the ciyex-ehr-ui upload control.
					const isImage = f.type === 'image' || /photo|avatar|picture/i.test(f.key) || /^image(url)?$/i.test(f.key);
					const wrap = DOM.append(cell, DOM.$('div'));
					wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
					let preview: HTMLImageElement | undefined;
					if (isImage) {
						preview = DOM.append(wrap, DOM.$('img')) as HTMLImageElement;
						preview.style.cssText = 'width:40px;height:40px;border-radius:6px;object-fit:cover;border:1px solid var(--vscode-input-border,#3c3c3c);background:rgba(127,127,127,0.08);flex-shrink:0;';
						if (val) { preview.src = String(val); } else { preview.style.display = 'none'; }
					}
					const fileInp = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
					fileInp.type = 'file';
					if (isImage) { fileInp.accept = 'image/*'; }
					fileInp.style.cssText = inputStyle + 'flex:1;height:auto;padding:4px 8px;cursor:pointer;';
					const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
					hidden.type = 'hidden';
					hidden.value = String(val ?? '');
					this._formInputs.set(f.key, hidden);
					const status = DOM.append(wrap, DOM.$('span'));
					status.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
					if (hidden.value && !isImage) { status.textContent = 'attached'; }
					fileInp.addEventListener('change', () => {
						const file = fileInp.files && fileInp.files[0];
						if (!file) {
							hidden.value = ''; status.textContent = '';
							if (preview) { preview.style.display = 'none'; preview.removeAttribute('src'); }
							return;
						}
						const reader = new FileReader();
						reader.onload = () => {
							hidden.value = String(reader.result || '');
							status.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
							if (preview) { preview.src = hidden.value; preview.style.display = ''; }
						};
						reader.readAsDataURL(file);
					});
				} else {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
					inp.value = String(val);
					// Issue #8: every phone/fax field shows a number-format placeholder
					// (e.g. "(555) 123-4567") instead of the generic "Enter <label>…",
					// so the expected input is unambiguous and consistent app-wide.
					inp.placeholder = f.placeholder || (f.type === 'phone' ? '(555) 123-4567' : `Enter ${f.label.toLowerCase()}...`);
					inp.style.cssText = inputStyle;
					if (f.type === 'phone') {
						// US phone format app-wide: auto-mask to `(555) 123-4567`, drop a
						// leading "1" country code and hard-cap at 10 digits as the user
						// types/pastes (shared formatUsPhone). Letters and over-length input
						// are rejected so the field can only hold a US number.
						inp.setAttribute('inputmode', 'tel');
						inp.maxLength = 16;
						if (inp.value) { inp.value = formatUsPhone(inp.value); }
						const maskPhone = () => { const f2 = formatUsPhone(inp.value); if (inp.value !== f2) { inp.value = f2; } };
						inp.addEventListener('input', maskPhone);
						inp.addEventListener('paste', () => setTimeout(maskPhone, 0));
					}
					this._formInputs.set(f.key, inp);
				}

				if (f.showWhen) { conditionalFields.push({ field: f, cell }); }
			}
		}

		// Vitals: auto-calculate BMI = weight(kg) / (height(m))^2 whenever weight or height changes.
		// Try both the local key and common backend alias variants.
		const weightInput = (this._formInputs.get('weightKg') ?? this._formInputs.get('weight') ?? this._formInputs.get('weightLbs')) as HTMLInputElement | undefined;
		const heightInput = (this._formInputs.get('heightCm') ?? this._formInputs.get('height') ?? this._formInputs.get('heightIn')) as HTMLInputElement | undefined;
		const bmiInput = (this._formInputs.get('bmi') ?? this._formInputs.get('bodyMassIndex')) as HTMLInputElement | undefined;
		if (weightInput && heightInput && bmiInput) {
			bmiInput.readOnly = true;
			bmiInput.style.background = 'rgba(128,128,128,0.06)';
			bmiInput.placeholder = 'Auto-calculated';
			const recalc = () => {
				const w = parseFloat(weightInput.value);
				const hCm = parseFloat(heightInput.value);
				if (!isNaN(w) && !isNaN(hCm) && hCm > 0) {
					const m = hCm / 100;
					bmiInput.value = (w / (m * m)).toFixed(1);
				} else {
					bmiInput.value = '';
				}
			};
			weightInput.addEventListener('input', recalc);
			heightInput.addEventListener('input', recalc);
			// Run once on render so editing an existing record refreshes a stale BMI.
			recalc();
		}

		// Clinical Alerts: default the Identified Date to today on a fresh form.
		const identifiedInput = this._formInputs.get('identifiedDate') as HTMLInputElement | undefined;
		if (identifiedInput && identifiedInput.type === 'date' && !identifiedInput.value) {
			identifiedInput.value = new Date().toISOString().slice(0, 10);
		}

		// Messaging: default the "To (Patient)" field to the current chart's
		// patient name on a fresh form (the test team asked for the patient to
		// be pre-filled rather than left blank).
		const messagingRecipient = this._formInputs.get('recipient') as HTMLInputElement | undefined;
		if (messagingRecipient && !messagingRecipient.value && this.patientName) {
			messagingRecipient.value = this.patientName;
		}

		// Appointments + Encounters: auto-calculate duration (minutes) from
		// start/end datetime + seed sensible defaults on a fresh form.
		// Backend tab_field_config field keys: `start` / `end` /
		// `minutesDuration` (V58 Appointment FHIR mapping). Encounter +
		// legacy keys (`date`, `endDate`, `startDate`, `duration`) are kept
		// as fallbacks so older saved data still drives the recalc.
		const startInput = (this._formInputs.get('start') || this._formInputs.get('date') || this._formInputs.get('startDate')) as HTMLInputElement | undefined;
		const endInput = (this._formInputs.get('end') || this._formInputs.get('endDate')) as HTMLInputElement | undefined;
		const durationInput = (this._formInputs.get('minutesDuration') || this._formInputs.get('duration')) as HTMLInputElement | undefined;

		// Format a Date as a LOCAL "YYYY-MM-DDTHH:mm" string (the datetime-local
		// shape the datetime dropdown stores). The previous code used
		// toISOString(), which shifts the value into UTC — so a 9:07 AM start
		// produced an End Date/Time hours off (and sometimes a different date),
		// and the auto-fill looked broken (issue 10).
		const toLocalDt = (d: Date): string => {
			const pad = (n: number) => String(n).padStart(2, '0');
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
		};

		// Default start/end on a fresh form — start = now (rounded to next 5min),
		// end = start + 15min. Reads existing record values via the hidden ISO
		// field's value so it doesn't clobber an in-progress edit.
		// Scope this to the scheduling tabs ONLY: other tabs (e.g. Allergies) also
		// key their date field `startDate`, and their Onset Date must stay blank when
		// left unspecified — not silently auto-fill to "today".
		const isSchedulingForm = this.activeTab === 'appointments' || this.activeTab === 'encounters';
		if (isSchedulingForm && startInput && !startInput.value) {
			const now = new Date();
			now.setSeconds(0, 0);
			now.setMinutes(now.getMinutes() + (5 - (now.getMinutes() % 5 || 5)));
			startInput.value = toLocalDt(now);
			if (endInput && !endInput.value) {
				endInput.value = toLocalDt(new Date(now.getTime() + 15 * 60 * 1000));
			}
		}

		if (startInput && endInput && durationInput) {
			durationInput.readOnly = true;
			durationInput.style.background = 'rgba(128,128,128,0.06)';
			durationInput.placeholder = 'Auto-calculated';
			const recalcDuration = () => {
				const s = startInput.value ? new Date(startInput.value).getTime() : NaN;
				const e = endInput.value ? new Date(endInput.value).getTime() : NaN;
				if (!isNaN(s) && !isNaN(e) && e > s) {
					durationInput.value = String(Math.round((e - s) / 60000));
				} else {
					durationInput.value = '';
				}
			};
			// Appointments default to a fixed 15-minute slot: whenever the user picks
			// a start time, snap the end to start + 15min so the End Date/Time and
			// Duration (min) auto-fill to a 15-minute appointment.
			const DEFAULT_SLOT_MIN = 15;
			const syncEndFromStart = () => {
				const s = startInput.value ? new Date(startInput.value).getTime() : NaN;
				if (!isNaN(s)) {
					// The datetime dropdown's value setter syncs its visible date +
					// time controls, so assigning here updates the End field's UI too.
					endInput.value = toLocalDt(new Date(s + DEFAULT_SLOT_MIN * 60 * 1000));
				}
				recalcDuration();
			};
			startInput.addEventListener('input', syncEndFromStart);
			startInput.addEventListener('change', syncEndFromStart);
			endInput.addEventListener('input', recalcDuration);
			endInput.addEventListener('change', recalcDuration);
			recalcDuration();
		}

		// Appointments / Encounters: pre-fill the patient field with the
		// current chart's patient on a fresh form. The patient-search input
		// stores the FK ID in a hidden sibling and the display name in the
		// visible textbox — set BOTH so the backend still receives the real
		// patientId after the user saves without touching the field.
		for (const key of ['patient', 'patientId', 'subject'] as const) {
			const hiddenInput = this._formInputs.get(key) as HTMLInputElement | undefined;
			if (!hiddenInput) { continue; }
			// Seed the FK with the real patientId when it isn't already set.
			if (!hiddenInput.value && this.patientId) {
				hiddenInput.value = this.patientId;
			}
			// Whenever the FK points at the current chart patient (freshly seeded
			// above, or pre-seeded via the field's defaultValue), show the patient
			// NAME in the visible textbox. The visible textbox lives one parent up
			// — `_buildSearchInput` appends a text input, the magnifying-glass icon,
			// then the hidden input as siblings. Walk the parent's children to find
			// the first empty visible text input so the user sees the patient name.
			if (hiddenInput.value === this.patientId && this.patientName) {
				const wrap = hiddenInput.parentElement;
				if (wrap) {
					for (const child of Array.from(wrap.children)) {
						if (DOM.isHTMLInputElement(child) && child.type === 'text' && !child.value) {
							child.value = this.patientName;
							break;
						}
					}
				}
			}
		}

		// Apply showWhen conditions and attach listeners to controlling fields
		if (conditionalFields.length > 0) {
			const applyVisibility = () => {
				for (const { field, cell } of conditionalFields) {
					const when = field.showWhen!;
					const ctrl = formInputs.get(when.field);
					const ctrlVal = DOM.isHTMLInputElement(ctrl) && ctrl.type === 'checkbox'
						? (ctrl.checked ? 'true' : 'false')
						: (ctrl?.value ?? '');
					let show = true;
					if (when.equals !== undefined) { show = ctrlVal === when.equals; }
					if (when.notEquals !== undefined) { show = ctrlVal !== when.notEquals; }
					cell.style.display = show ? '' : 'none';
				}
			};
			const listeners = new Set<string>();
			for (const { field } of conditionalFields) {
				const ctrlKey = field.showWhen!.field;
				if (listeners.has(ctrlKey)) { continue; }
				listeners.add(ctrlKey);
				const ctrl = formInputs.get(ctrlKey);
				if (ctrl) { ctrl.addEventListener('change', applyVisibility); }
			}
			applyVisibility();
		}

		// Insurance: when "Self (Patient is Subscriber)" is selected, copy the
		// patient's demographics into the subscriber fields (issue 2).
		this._wireSubscriberSelfFill();
	}

	/**
	 * When the insurance "Relationship to Patient" dropdown is set to "Self",
	 * auto-populate the subscriber identity fields from the patient's
	 * demographics so the user doesn't re-enter them. Re-runs on every change to
	 * the relationship control and once on initial render.
	 */
	private _wireSubscriberSelfFill(): void {
		const rel = this._formInputs.get('subscriberRelationship');
		if (!rel) { return; }
		const pd = (this.patientData || {}) as Record<string, unknown>;
		const isoToUs = (iso: string): string => {
			const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
			return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
		};
		const refs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined>();
		for (const k of ['subscriberFirstName', 'subscriberLastName', 'subscriberDOB', 'subscriberGender', 'subscriberSSN', 'subscriberPhone', 'subscriberAddress']) {
			refs.set(k, this._formInputs.get(k));
		}
		const setVal = (key: string, raw: unknown): void => {
			const el = refs.get(key);
			if (!el) { return; }
			const value = (raw === null || raw === undefined) ? '' : String(raw);
			el.value = value;
			// Date fields register a hidden ISO input; its visible MM/DD/YYYY
			// sibling must be updated too.
			const sib = el.previousElementSibling;
			if (el.type === 'hidden' && DOM.isHTMLInputElement(sib) && sib.placeholder === 'MM/DD/YYYY') {
				sib.value = isoToUs(value.split('T')[0]);
			}
			// Custom dropdowns refresh their visible label on a `change` event.
			el.dispatchEvent(new Event('change', { bubbles: false }));
		};
		const fillFromPatient = (): void => {
			setVal('subscriberFirstName', pd['firstName']);
			setVal('subscriberLastName', pd['lastName']);
			setVal('subscriberDOB', String(pd['dateOfBirth'] ?? '').split('T')[0]);
			setVal('subscriberGender', String(pd['gender'] ?? '').toLowerCase());
			setVal('subscriberSSN', pd['ssn']);
			setVal('subscriberPhone', pd['phoneNumber'] ?? pd['phone']);
			setVal('subscriberAddress', pd['address']);
		};
		const clearSubscriber = (): void => {
			for (const k of refs.keys()) { setVal(k, ''); }
		};
		// Keep the subscriber identity in sync with the chosen relationship when
		// the user changes it: "Self" copies the patient's demographics in; any
		// other relationship clears them so the user enters the actual subscriber's
		// details. The previous handler only filled on "self" and returned early
		// otherwise, leaving the patient's info stuck in the subscriber fields when
		// switched to Spouse/Child/Parent/Other (reported bug).
		rel.addEventListener('change', () => {
			if (String(rel.value) === 'self') { fillFromPatient(); } else { clearSubscriber(); }
		});
		// Initial render: only auto-fill when the default selection is "Self".
		// Never wipe an existing non-self subscriber loaded into an edit form.
		if (String(rel.value) === 'self') { fillFromPatient(); }
	}

	/**
	 * Build an mm/dd/yyyy text input with a calendar picker. The visible field
	 * shows the US-formatted date; a hidden ISO sibling holds the yyyy-mm-dd
	 * value the API expects. We can't trust the OS locale on `<input type="date">`
	 * (Linux Electron builds often render yyyy-mm-dd), so we render the US format
	 * ourselves.
	 */
	private _buildDateInput(cell: HTMLElement, f: FieldDef, isoValue: string, inputStyle: string): void {
		const wrap = DOM.append(cell, DOM.$('div'));
		wrap.style.cssText = 'position:relative;display:block;';

		const isoToUs = (iso: string): string => {
			const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
			return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
		};
		// usToIsoDate validates real calendar dates and returns '' for impossible
		// values (month 13, day 33, year 6676), so the hidden ISO field stays
		// empty and the field shows a red border / blocks save for those.
		const usToIso = (us: string): string => usToIsoDate(us);

		const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		visible.type = 'text';
		visible.placeholder = 'MM/DD/YYYY';
		visible.value = isoToUs(isoValue);
		// Reserve right padding so the icon doesn't overlap typed text.
		visible.style.cssText = inputStyle + 'padding-right:30px;';
		visible.setAttribute('inputmode', 'numeric');
		visible.maxLength = 10;

		// Hidden ISO field that gets registered with _formInputs so the saved
		// value is yyyy-mm-dd regardless of what the user typed.
		const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		hidden.type = 'hidden';
		hidden.value = isoValue || '';
		this._formInputs.set(f.key, hidden);
		this._dateVisibleByKey.set(f.key, visible);

		const sync = () => {
			// Auto-insert slashes and cap the year at 4 digits as the user types.
			const masked = maskUsDate(visible.value);
			if (masked !== visible.value) { visible.value = masked; }
			const iso = usToIso(visible.value);
			hidden.value = iso;
			const bad = !!visible.value && !iso;
			// Flag invalid (non-empty but unparseable) dates so the save handler
			// can reject them with a "valid date" message.
			hidden.dataset.invalid = bad ? '1' : '';
			visible.style.borderColor = bad ? '#ef4444' : '';
		};
		visible.addEventListener('input', sync);
		visible.addEventListener('blur', sync);

		// Native date picker overlaid on the right edge — opens the calendar
		// popover when the icon area is clicked. Made transparent so the visible
		// MM/DD/YYYY text input shows through.
		const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		picker.type = 'date';
		picker.value = isoValue || '';
		picker.title = 'Open calendar';
		picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
		picker.addEventListener('change', () => {
			visible.value = isoToUs(picker.value);
			hidden.value = picker.value;
			hidden.dataset.invalid = '';
			visible.style.borderColor = '';
			// Issue #6: auto-close the calendar popover once a date is chosen.
			// Native date pickers keep the popup open after selection; blurring
			// the (focused) picker collapses it immediately, matching the
			// ciyex-ehr-ui behaviour where the calendar dismisses on pick.
			picker.blur();
		});

		// Visible icon — clickable so clicking the glyph itself also opens the calendar.
		const icon = DOM.append(wrap, DOM.$('span.codicon.codicon-calendar'));
		icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--vscode-descriptionForeground);cursor:pointer;line-height:1;';

		// Open the calendar from a click anywhere in the icon column, not just the
		// native input's tiny indicator glyph.
		enablePickerClick(picker, icon);
	}

	/**
	 * Build a searchable dropdown that hits a lookup API, shows matching items,
	 * and stores the selected value in this._formInputs (visible label in the
	 * input; the underlying code/id stored in a hidden sibling we register as
	 * the form input). Used for ICD/CPT/LOINC/CVX codes and practitioner pickers.
	 */
	private _buildSearchInput(cell: HTMLElement, f: FieldDef, currentValue: string, inputStyle: string, displayHint: string = ''): void {
		// Capture the inputs map ACTIVE AT RENDER TIME. The create/edit drawer
		// renders into a temporary `_formInputs` map and then restores the original
		// on `this` (see `_openRecordDialog`), so reading `this._formInputs` later
		// from an event handler hits the WRONG map — which silently broke every
		// `relatedField` companion fill in the drawer (e.g. picking an ICD-10 code
		// not populating the Problems "Condition" name). Bind to this reference.
		const formInputs = this._formInputs;
		const wrap = DOM.append(cell, DOM.$('div'));
		wrap.style.cssText = 'position:relative;';

		// Name-search fields (patient / provider / lookup-by-name) only need
		// to display the chosen name in the input and the dropdown — the
		// underlying ID isn't useful to the user. Medical-code searches
		// (ICD-10 / CPT / HCPCS / LOINC / CVX) keep the code visible because
		// the code itself IS the value the clinician picks. Same EHR-UI
		// styling the test team referenced (clean name-only rows for
		// patient picker, code-prefixed rows for code search).
		const isCodeSearch = f.type === 'code-search' || f.type === 'coded';
		// Foreign-key reference fields hold an id that must be resolved to a name for
		// display. NAME-valued lookups (e.g. insurance `payerName`, which uses
		// `valueField:'name'`) already store the display text — resolving them as ids
		// returns null and blanked the field when re-opening edit (QA: payer /
		// insurance showed nil after saving with a value). Computed here, before the
		// value is shown, so the display logic can skip id→name resolution for them.
		// `storeLabelAsValue` fields SEARCH a reference catalog (e.g. providers)
		// but persist the chosen NAME, not the id — the lab-order DTO keeps
		// `physicianName` as a display string. Treat them like a name-valued
		// lookup for value handling (store/show the name verbatim, no id→name
		// resolution) while keeping the search dropdown.
		const isIdLookup = !f.storeLabelAsValue && (
			f.type === 'patient-search' || f.type === 'practitioner-search'
			// Every `lookup` in the chart editor points at an id-keyed catalog
			// (insurance companies, locations, claims, …) and therefore stores an
			// id that must be resolved to a name for display — EXCEPT the one
			// NAME-valued lookup (`valueField:'name'`, insurance `payerName`) which
			// already holds its display text. Keying off `valueField` rather than a
			// hardcoded list of key names fixes reference fields whose key doesn't
			// end in "Id" (e.g. submissions `insurer`, claims `facilityId`,
			// appointment `location`), which previously showed the raw id on edit.
			|| (f.type === 'lookup' && f.lookupConfig?.valueField !== 'name')
			// Generic 'search' field where the field key is a foreign-key id —
			// e.g. Patient Education materialId / educator. Selecting from the
			// dropdown is required; free text deserialises to null and the
			// backend rejects with "given id must not be null".
			|| (f.type === 'search' && f.apiPath !== undefined)
		);

		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		input.type = 'text';
		input.placeholder = f.placeholder || `Search ${f.label}...`;
		// Reserve right padding for the magnifying-glass icon.
		input.style.cssText = inputStyle + 'padding-right:30px;';
		// For id-bearing reference fields (billing provider, insurer, facility,
		// payer, …) the edit form receives the raw id. Show the resolved NAME in
		// the visible input while keeping the id in the hidden value (issue 12).
		const resolveDisplay = (): string => {
			// Only id-bearing references need id→name resolution. Code searches and
			// name-valued lookups (e.g. `payerName`) already hold their display text,
			// so showing it verbatim avoids blanking the field on edit.
			if (isCodeSearch || !isIdLookup || !currentValue) { return currentValue; }
			const r = this._resolveIdToName(f.key, currentValue);
			return r === null || r === undefined ? '' : String(r);
		};
		// A companion display name from the edit record (billing provider /
		// insurer / facility name) wins over id→name resolution: the saved id is
		// often a FHIR reference id the lookup cache can't resolve, which left the
		// raw id showing on re-edit. The hidden field still holds the id for save.
		input.value = displayHint || resolveDisplay();

		// Decorative search icon on the right edge of the input.
		const searchIcon = DOM.append(wrap, DOM.$('span'));
		searchIcon.classList.add('codicon');
		searchIcon.classList.add('codicon-search');
		searchIcon.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--vscode-input-placeholderForeground,#888);pointer-events:none;line-height:1;';

		// Hidden field that gets registered with _formInputs so the saved value
		// is the chosen code/id rather than free text.
		const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		hidden.type = 'hidden';
		hidden.value = currentValue;
		formInputs.set(f.key, hidden);
		// Companion hidden input for `relatedField` (e.g. a prescriber-search's
		// `prescriberName`). The dropdown selection handler writes the chosen
		// display NAME here so the save payload carries a human-readable name
		// alongside the id — the table then shows the name immediately instead
		// of a bare id, even before the backend re-fetch supplies *Display.
		if (f.relatedField && !formInputs.has(f.relatedField)) {
			const relHidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			relHidden.type = 'hidden';
			formInputs.set(f.relatedField, relHidden);
		}
		// Locked display (e.g. the chart's patient on appointment / encounter
		// forms): show the resolved name only — no typing, no search dropdown,
		// no other records selectable. The hidden FK is already registered above
		// and the patient-prefill block fills in the visible name.
		if (f.readonly) {
			input.readOnly = true;
			input.tabIndex = -1;
			input.style.cursor = 'default';
			input.style.opacity = '0.85';
			searchIcon.style.display = 'none';
			// Show the patient NAME (not the raw id) in the locked field. The id
			// lookup cache often doesn't hold the current chart patient, so
			// `resolveDisplay` above leaves the bare id visible — override it with
			// the known chart patient name when the FK points at that patient.
			if (this.patientName && (hidden.value === this.patientId || !hidden.value)) {
				input.value = this.patientName;
			}
			return;
		}
		// Name caches may not be loaded on first render — resolve asynchronously
		// and replace the raw id with the name once the caches populate (issue 12).
		if (!isCodeSearch && isIdLookup && currentValue && input.value === currentValue) {
			void this._loadLookups().then(async () => {
				let resolved = resolveDisplay();
				// Bulk caches only hold the first ~500 rows; a referenced record
				// outside that window (e.g. a billing provider / insurer not in the
				// first page) leaves the raw id visible. Fetch that single record by
				// id and re-resolve so the edit form shows the NAME, not the id.
				if (!resolved || resolved === currentValue) {
					const fetched = await this._fetchReferenceName(f.key, currentValue);
					if (fetched) { resolved = fetched; }
				}
				// Only overwrite while the field still shows the raw id — never clobber
				// a name the user has since typed or picked from the dropdown.
				if (resolved && resolved !== currentValue && input.value === currentValue) {
					input.value = resolved;
				}
			}).catch(() => { /* leave the id visible if lookups fail */ });
		}
		// Foreign-key references — patient / practitioner pickers and
		// `lookup` fields whose key is an id (numeric / UUID) — MUST come
		// from a dropdown selection. Free text deserialises to null on
		// the server and trips "id must not be null" (Education
		// materialId, Appointment locationId, etc.). Clear the hidden
		// whenever the user types so required-validation and the save
		// payload stay correct. Code-search keeps "store-typed-text"
		// because the value IS the code, not a foreign key.
		if (isIdLookup) {
			input.addEventListener('input', () => { hidden.value = ''; });
		} else {
			// Keep hidden in sync with raw typing so non-selected codes still save.
			input.addEventListener('input', () => { hidden.value = input.value; });
		}

		// Append dropdown to <body> with position:fixed so it isn't clipped by the
		// overlay's overflow-x:hidden / overflow-y:auto, which previously cut off
		// the right edge inside narrow 2-3 column form cells (claims facility,
		// quaternary diagnosis, claim submission billing-provider, appointment
		// patient/provider/location lookups).
		// Stronger background + heavier shadow + opaque inner so the dropdown
		// reads as a separate floating layer over neighbouring fields — the
		// test team was reporting overlap because the previous translucent
		// look made it hard to tell where the dropdown ended.
		const dropdown = DOM.append(DOM.getActiveWindow().document.body, DOM.$('div'));
		// Add the `monaco-workbench` class so the --vscode-* CSS variables below
		// resolve against the ACTIVE theme. This dropdown is mounted on
		// document.body (to escape the form's overflow/transform clipping), which
		// puts it OUTSIDE the real `.monaco-workbench` root where those vars are
		// scoped — so without the class every var fell back to its hardcoded dark
		// default (#252526) and the author/provider typeahead rendered dark even
		// on a light workbench (QA issue 6). Same fix the shared
		// createCustomDropdown helper uses for its body-mounted panel.
		dropdown.classList.add('monaco-workbench');
		// Marker class so the shared friendly-scroll CSS (ciyexCommon.css) hides
		// this body-mounted popover's vertical scrollbar when results overflow.
		dropdown.classList.add('ciyex-search-dropdown');
		// font-family is pinned because the dropdown is mounted on document.body
		// (outside the editor font scope); without it the result rows fell back to
		// the browser default serif at an inconsistent size vs the input — the
		// "big & uneven" typeahead the QA team flagged.
		// `right:auto;bottom:auto` neutralise the `inset:0` that the copied
		// `monaco-workbench` class applies (style.css). Without them this
		// position:fixed panel keeps `bottom:0`, so it stretches from its `top`
		// down to the viewport bottom and `max-height:240px` then caps it — the
		// panel always rendered a fixed ~240px tall box with empty space below
		// the few result rows instead of shrinking to fit (provider typeahead).
		// Same fix the shared customDropdown helper uses for its body-mounted panel.
		dropdown.style.cssText = 'position:fixed;right:auto;bottom:auto;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-focusBorder,var(--vscode-editorWidget-border,#454545));border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.45),0 2px 6px rgba(0,0,0,0.25);z-index:10010;max-height:240px;overflow-y:auto;display:none;padding:4px;font-family:var(--vscode-font-family, system-ui, sans-serif);';
		const positionDropdown = (): void => {
			const rect = input.getBoundingClientRect();
			const viewportWidth = DOM.getActiveWindow().innerWidth;
			const viewportHeight = DOM.getActiveWindow().innerHeight;
			// Width matches the search input so the dropdown aligns with its field
			// (and every other form input) instead of jutting past it into the
			// neighbouring column. A 220px floor keeps result rows readable in very
			// narrow cells; never exceed the input width by much, nor the viewport.
			const desiredWidth = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
			// Anchor to the input's left edge but clamp so the dropdown stays
			// inside the viewport. If the right edge would overflow, slide it
			// left so it ends 8px before the viewport edge.
			let left = rect.left;
			if (left + desiredWidth > viewportWidth - 8) {
				left = Math.max(8, viewportWidth - desiredWidth - 8);
			}
			// Vertical: prefer below the input. Flip above if there's not
			// enough room below, so the dropdown never falls off-screen.
			// Use the panel's ACTUAL rendered height (it's display:block by the
			// time we position it) rather than a fixed 280px estimate — the old
			// estimate left a large empty gap between a short result list and the
			// input when flipped above (QA "big/uneven" typeahead).
			const panelHeight = dropdown.offsetHeight || Math.min(dropdown.scrollHeight || 240, 240);
			let top = rect.bottom + 4;
			if (top + panelHeight > viewportHeight - 8 && rect.top > panelHeight + 8) {
				top = rect.top - panelHeight - 4;
			}
			dropdown.style.top = `${top}px`;
			dropdown.style.left = `${left}px`;
			dropdown.style.width = `${desiredWidth}px`;
			dropdown.style.minWidth = '';
			dropdown.style.maxWidth = '';
		};
		// Recompute on overlay/window scroll & resize so the dropdown tracks the input.
		const win = DOM.getActiveWindow();
		const onScrollOrResize = (): void => { if (dropdown.style.display !== 'none') { positionDropdown(); } };
		win.addEventListener('scroll', onScrollOrResize, true);
		win.addEventListener('resize', onScrollOrResize);
		// Clean up the body-level dropdown when the overlay closes (input is removed).
		const cleanupObserver = new MutationObserver(() => {
			if (!input.isConnected) {
				dropdown.remove();
				win.removeEventListener('scroll', onScrollOrResize, true);
				win.removeEventListener('resize', onScrollOrResize);
				cleanupObserver.disconnect();
			}
		});
		cleanupObserver.observe(win.document.body, { childList: true, subtree: true });

		// Track currently-highlighted row index for keyboard navigation
		// (ArrowDown / ArrowUp / Enter). The first row is auto-highlighted
		// when the dropdown opens — same EHR-UI behaviour the test team's
		// screenshot showed (Joseph Lopez highlighted for "jo" query).
		let highlightedIdx = -1;
		const rows: HTMLElement[] = [];
		const setHighlight = (idx: number): void => {
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				if (i === idx) {
					// Muted, theme-following highlight (matches the sidebar active
					// item) instead of the saturated `list-activeSelectionBackground`
					// blue, which read as out of place on the light workbench.
					row.style.background = 'var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground, rgba(127,127,127,0.14)))';
					row.style.borderLeftColor = 'var(--vscode-focusBorder,#007acc)';
					row.scrollIntoView({ block: 'nearest' });
				} else {
					row.style.background = '';
					row.style.borderLeftColor = 'transparent';
				}
			}
			highlightedIdx = idx;
		};

		let timer: ReturnType<typeof setTimeout> | undefined;
		const search = (q: string) => {
			if (timer) { clearTimeout(timer); }
			timer = setTimeout(async () => {
				try {
					let items: Array<{ code: string; label: string }> = [];
					if (this._isPayerLookup(f)) {
						// Payer/insurer pickers: the FHIR-resource endpoint returns a shape the
						// generic extractor can't read, so the dropdown listed nothing. Mirror
						// the sidebar's proven search — ONLY the tenant's own
						// /api/insurance-companies records (filtered client-side), so the list
						// shows just the insurance companies the tenant actually added.
						items = await this._searchPayers(q.trim(), f);
					} else {
						const url = this._buildSearchUrl(f, q.trim());
						if (!url) { return; }
						try {
							const res = await this.apiService.fetch(url);
							if (res.ok) {
								const data = await res.json();
								items = this._extractSearchItems(f, data);
							}
						} catch { /* fall through to fallback */ }
					}
					// When the ciyex-codes proxy returns nothing (e.g. the org has
					// no app_installation row so the proxy 404s, or the service is
					// unreachable), fall back to the main backend's /api/global_codes
					// search — the exact multi-tier strategy the reference EHR UI
					// uses. This is why ICD-10 / CPT / LOINC search works in
					// ciyex-ehr-ui but returned "No matches" here.
					if (items.length === 0 && isCodeSearch) {
						const gUrl = this._buildGlobalCodesUrl(f, q.trim());
						if (gUrl) {
							try {
								const gRes = await this.apiService.fetch(gUrl);
								if (gRes.ok) {
									items = this._extractSearchItems(f, await gRes.json());
								}
							} catch { /* fall through to static fallback */ }
						}
					}
					// Final fallback: filter our built-in static list locally so the
					// user still gets a usable picker (e.g. CVX when no service has
					// data loaded for this org/version).
					if (items.length === 0 && isCodeSearch) {
						items = this._codeSearchFallback(f, q.trim());
					}
					DOM.clearNode(dropdown);
					rows.length = 0;
					if (items.length === 0) {
						const empty = DOM.append(dropdown, DOM.$('div'));
						empty.textContent = 'No matches';
						empty.style.cssText = 'padding:6px 10px;color:var(--vscode-descriptionForeground);font-size:13px;line-height:18px;font-style:italic;';
					} else {
						for (const it of items) {
							const row = DOM.append(dropdown, DOM.$('div'));
							// Name-search rows are taller and show the label
							// alone — code rows are tighter and show the
							// code in monospace alongside the description.
							if (isCodeSearch) {
								row.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:13px;line-height:18px;display:flex;align-items:center;gap:10px;border-left:3px solid transparent;border-radius:4px;';
								const codeEl = DOM.append(row, DOM.$('span'));
								codeEl.textContent = it.code;
								codeEl.style.cssText = 'font-weight:600;color:var(--vscode-textLink-foreground);min-width:64px;font-family:var(--vscode-editor-font-family,monospace);flex-shrink:0;';
								const labelEl = DOM.append(row, DOM.$('span'));
								labelEl.textContent = it.label;
								labelEl.style.cssText = 'color:var(--vscode-foreground);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
							} else {
								// Match the code-row metrics (padding/font/line-height)
								// so name and code result lists are the same height —
								// they used to differ (10px/14px vs 8px/13px), reading
								// as an uneven list.
								row.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:13px;line-height:18px;color:var(--vscode-foreground);border-left:3px solid transparent;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
								row.textContent = it.label || it.code;
							}
							rows.push(row);
							const idx = rows.length - 1;
							row.addEventListener('mouseenter', () => setHighlight(idx));
							// Select on MOUSEDOWN, not click: mousedown on the row blurs
							// the input, whose blur handler hides this dropdown 150ms
							// later — any press longer than that swallowed the click, so
							// picking an option took TWO clicks (QA issue: dropdown
							// options select only on double click). preventDefault keeps
							// the input focused.
							row.addEventListener('mousedown', (e) => {
								e.preventDefault();
								if (isCodeSearch) {
									input.value = `${it.code} - ${it.label}`;
									hidden.value = it.code;
								} else {
									// Show the chosen name in the visible input. Persist
									// the underlying id for the save payload — EXCEPT
									// `storeLabelAsValue` fields (e.g. lab-order Ordering
									// Provider) which store the display NAME itself.
									input.value = it.label || it.code;
									hidden.value = f.storeLabelAsValue ? (it.label || it.code) : it.code;
								}
								// Honor relatedField — fill the companion form field
								// (e.g. materialTitle for materialId) with the display
								// label so list rendering and round-trip edits both
								// keep the human-readable name visible.
								if (f.relatedField) {
									const related = formInputs.get(f.relatedField) as HTMLInputElement | undefined;
									if (related) { related.value = it.label || it.code; }
								}
								dropdown.style.display = 'none';
							});
						}
						setHighlight(0);
					}
					// Show first, then position: positionDropdown() reads the
					// panel's real height (offsetHeight) to decide flip-above
					// placement, which is only measurable once it's display:block.
					dropdown.style.display = 'block';
					positionDropdown();
				} catch { /* ignore */ }
			}, 300);
		};
		input.addEventListener('input', () => search(input.value));
		input.addEventListener('focus', () => { search(input.value); });
		input.addEventListener('blur', () => { setTimeout(() => { dropdown.style.display = 'none'; }, 150); });
		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (dropdown.style.display === 'none' || rows.length === 0) { return; }
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setHighlight(Math.min(highlightedIdx + 1, rows.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setHighlight(Math.max(highlightedIdx - 1, 0));
			} else if (e.key === 'Enter') {
				if (highlightedIdx >= 0) {
					e.preventDefault();
					rows[highlightedIdx].click();
				}
			} else if (e.key === 'Escape') {
				dropdown.style.display = 'none';
			}
		});
		// Pasting a code (e.g. copied "E11.9" from another system) should resolve
		// it to its description and auto-fill the code + the related name field —
		// not just drop raw text that leaves the Condition name blank. The normal
		// input→search still runs (showing the dropdown); this additionally
		// auto-applies an EXACT code match so paste behaves like a pick.
		if (isCodeSearch) {
			input.addEventListener('paste', (e: ClipboardEvent) => {
				const pasted = (e.clipboardData?.getData('text') || '').trim();
				if (!pasted) { return; }
				// Defer so the pasted value has landed in the input first.
				DOM.getActiveWindow().setTimeout(() => { void this._resolvePastedCode(f, pasted, input, hidden, dropdown, formInputs); }, 0);
			});
		}
	}

	/**
	 * Resolve a pasted code-search value to a concrete code + description and
	 * apply it (fills the visible input, the hidden saved value, and any
	 * `relatedField` such as the Problems form's Condition name). Only an EXACT
	 * code match is auto-applied — anything else is left to the normal search
	 * dropdown so a partial paste doesn't silently pick the wrong code.
	 */
	private async _resolvePastedCode(f: FieldDef, text: string, input: HTMLInputElement, hidden: HTMLInputElement, dropdown: HTMLElement, formInputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): Promise<void> {
		// Codes never contain whitespace; take the first token so a pasted
		// "E11.9 - Type 2 diabetes" still resolves on the bare code.
		const code = text.split(/\s+/)[0].trim();
		if (!code) { return; }
		let items: Array<{ code: string; label: string }> = [];
		try {
			const url = this._buildSearchUrl(f, code);
			if (url) { const res = await this.apiService.fetch(url); if (res.ok) { items = this._extractSearchItems(f, await res.json()); } }
		} catch { /* fall through to other tiers */ }
		if (items.length === 0) {
			const gUrl = this._buildGlobalCodesUrl(f, code);
			if (gUrl) { try { const gRes = await this.apiService.fetch(gUrl); if (gRes.ok) { items = this._extractSearchItems(f, await gRes.json()); } } catch { /* */ } }
		}
		if (items.length === 0) { items = this._codeSearchFallback(f, code); }
		const match = items.find(it => it.code.toUpperCase() === code.toUpperCase());
		if (!match) { return; }
		input.value = `${match.code} - ${match.label}`;
		hidden.value = match.code;
		if (f.relatedField) {
			const related = formInputs.get(f.relatedField) as HTMLInputElement | undefined;
			if (related) { related.value = match.label || match.code; }
		}
		dropdown.style.display = 'none';
	}

	/**
	 * True for the payer/insurer lookup pickers (claim submission insurer, denial
	 * payer/insurer, ERA payer, claim payer, …). These need the dedicated
	 * `_searchPayers` path rather than the generic endpoint search because the
	 * tenant's insurance-company list is often near-empty and the FHIR-resource
	 * endpoint returns a shape the generic extractor can't parse.
	 */
	private _isPayerLookup(f: FieldDef): boolean {
		if (f.type !== 'lookup') { return false; }
		const ep = String(f.lookupConfig?.endpoint || '');
		if (/insurance-compan/i.test(ep)) { return true; }
		return /^(payerId|payerName|payer|insurer|insurerId|payorId|payorName)$/i.test(f.key);
	}

	/**
	 * Search payers/insurers the same way the sidebar does: ONLY the tenant's own
	 * `/api/insurance-companies` records (returned unfiltered, so we match
	 * client-side and keep each payer's real id), de-duplicated by name with empty
	 * names dropped. Built-in common-payer suggestions are intentionally NOT added
	 * — the dropdown must show only the insurance companies the tenant has actually
	 * created, so a tenant with a single "abc" payer sees exactly that one entry.
	 */
	private async _searchPayers(q: string, f: FieldDef): Promise<Array<{ code: string; label: string }>> {
		const lq = q.toLowerCase();
		const seen = new Set<string>();
		const out: Array<{ code: string; label: string }> = [];
		// Name-valued payer fields (e.g. insurance coverage `payerName`,
		// valueField:'name') must store the display name; id-keyed pickers
		// (payerId / insurer, the default) store the insurance-company id.
		const useNameAsValue = f.lookupConfig?.valueField === 'name';
		try {
			const res = await this.apiService.fetch('/api/insurance-companies');
			if (res.ok) {
				const data = await res.json() as Record<string, unknown>;
				const list = ((data?.data as Record<string, unknown>)?.content
					|| (data?.content as unknown[])
					|| (data?.data as unknown[])
					|| []) as Array<Record<string, unknown>>;
				for (const p of (Array.isArray(list) ? list : [])) {
					const name = String(p.name || p.label || '').trim();
					if (!name || (lq && !name.toLowerCase().includes(lq))) { continue; }
					const key = name.toLowerCase();
					if (seen.has(key)) { continue; }
					seen.add(key);
					out.push({ code: useNameAsValue ? name : String(p.id ?? p.payerId ?? name), label: name });
				}
			}
		} catch { /* no tenant payers reachable — return whatever matched (possibly none) */ }
		return out.slice(0, 10);
	}

	private _buildSearchUrl(f: FieldDef, q: string): string | null {
		const enc = encodeURIComponent(q);
		// Generic 'search' field with explicit apiPath (e.g. Education materialId
		// using /api/education/materials, educator using /api/providers). Send
		// both `search` and `q` to cover both backend conventions in one request.
		if (f.type === 'search' && f.apiPath) {
			const ep = f.apiPath;
			const sep = ep.includes('?') ? '&' : '?';
			return `${ep}${sep}search=${enc}&q=${enc}&page=0&size=20`;
		}
		switch (f.type) {
			case 'coded':
			case 'code-search': {
				// ciyex-codes service: GET /api/codes/{system}/search?q=...&page=0&size=20
				// system uses the CodeSystem enum (ICD10_CM, CPT, HCPCS, LOINC, CVX, ...).
				// `coded` fields from tab_field_config carry the system in fhirMapping.system as a URL —
				// map the well-known URLs to the ciyex-codes enum so the search hits the right table.
				let raw = (f.lookupConfig?.system || '').toUpperCase();
				if (!raw) {
					const fhirSystem = (f as unknown as { fhirMapping?: { system?: string } }).fhirMapping?.system || '';
					if (/icd-10-cm/i.test(fhirSystem)) { raw = 'ICD10_CM'; }
					else if (/icd-9/i.test(fhirSystem)) { raw = 'ICD9_CM'; }
					else if (/ama-assn.*cpt|cpt-?4/i.test(fhirSystem)) { raw = 'CPT'; }
					else if (/loinc/i.test(fhirSystem)) { raw = 'LOINC'; }
					else if (/cvx/i.test(fhirSystem)) { raw = 'CVX'; }
					else if (/hcpcs/i.test(fhirSystem)) { raw = 'HCPCS'; }
					else if (/snomed/i.test(fhirSystem)) { raw = 'SNOMED'; }
					else { raw = 'ICD10_CM'; }
				}
				return `/api/app-proxy/ciyex-codes/api/codes/${raw}/search?q=${enc}&page=0&size=20`;
			}
			case 'practitioner-search':
				return `/api/providers?search=${enc}&page=0&size=20`;
			case 'patient-search':
				return `/api/patients?search=${enc}&page=0&size=20`;
			case 'lookup': {
				// Backend tab_field_config emits fields like:
				//   { type: "lookup", lookupConfig: { endpoint: "/api/providers", searchable: true } }
				// Forward the search through the configured endpoint. Send both `search`
				// and `q` so we work with /api/providers (search), /api/education/materials
				// (q), and /api/locations (search) without per-endpoint config.
				const ep = f.lookupConfig?.endpoint;
				if (!ep) { return null; }
				const sep = ep.includes('?') ? '&' : '?';
				return `${ep}${sep}search=${enc}&q=${enc}&page=0&size=20`;
			}
			default:
				return null;
		}
	}

	/**
	 * Resolve the code system for a code-search field (same logic as
	 * `_buildSearchUrl`) and map it to the `codeType` the main backend's
	 * `/api/global_codes` endpoint expects.
	 */
	private _buildGlobalCodesUrl(f: FieldDef, q: string): string | null {
		if (f.type !== 'code-search' && f.type !== 'coded') { return null; }
		let raw = (f.lookupConfig?.system || '').toUpperCase();
		if (!raw) {
			const fhirSystem = (f as unknown as { fhirMapping?: { system?: string } }).fhirMapping?.system || '';
			if (/icd-10-cm/i.test(fhirSystem)) { raw = 'ICD10_CM'; }
			else if (/icd-9/i.test(fhirSystem)) { raw = 'ICD9_CM'; }
			else if (/ama-assn.*cpt|cpt-?4/i.test(fhirSystem)) { raw = 'CPT'; }
			else if (/loinc/i.test(fhirSystem)) { raw = 'LOINC'; }
			else if (/cvx/i.test(fhirSystem)) { raw = 'CVX'; }
			else if (/hcpcs/i.test(fhirSystem)) { raw = 'HCPCS'; }
			else if (/snomed/i.test(fhirSystem)) { raw = 'SNOMED'; }
			else { raw = 'ICD10_CM'; }
		}
		// /api/global_codes uses short codeType names (ICD10, ICD9) rather than
		// the ciyex-codes enum (ICD10_CM, ICD9_CM).
		const codeTypeMap: Record<string, string> = { ICD10_CM: 'ICD10', ICD10: 'ICD10', ICD9_CM: 'ICD9', ICD9: 'ICD9' };
		const codeType = codeTypeMap[raw] || raw;
		const enc = encodeURIComponent(q);
		return `/api/global_codes/search?q=${enc}&codeType=${encodeURIComponent(codeType)}&page=0&size=20`;
	}

	/**
	 * Built-in fallback used when the ciyex-codes search endpoint returns
	 * nothing (e.g. CVX dataset not yet loaded for this org). Mirrors the
	 * web app's FALLBACK_CVX_CODES so the UI degrades gracefully instead
	 * of showing an empty dropdown.
	 */
	private _codeSearchFallback(f: FieldDef, q: string): Array<{ code: string; label: string }> {
		const sysRaw = (f.lookupConfig?.system || '').toUpperCase();
		const fhirSystem = (f as unknown as { fhirMapping?: { system?: string } }).fhirMapping?.system || '';
		const sys = sysRaw || (/cvx/i.test(fhirSystem) ? 'CVX' : '');
		if (sys !== 'CVX') { return []; }
		const lq = q.toLowerCase();
		const FALLBACK_CVX_CODES: Array<{ code: string; label: string }> = [
			{ code: '03', label: 'MMR (Measles, Mumps, Rubella)' },
			{ code: '08', label: 'Hepatitis B, adolescent or pediatric' },
			{ code: '10', label: 'IPV (Poliovirus, inactivated)' },
			{ code: '17', label: 'HIB (Haemophilus influenzae type b)' },
			{ code: '20', label: 'DTaP' },
			{ code: '21', label: 'Varicella (Chickenpox)' },
			{ code: '33', label: 'Pneumococcal polysaccharide (PPV23)' },
			{ code: '43', label: 'Hepatitis B, adult' },
			{ code: '45', label: 'Hepatitis B, pediatric' },
			{ code: '49', label: 'Hib (PRP-OMP)' },
			{ code: '52', label: 'Hepatitis A, adult' },
			{ code: '62', label: 'HPV, bivalent' },
			{ code: '83', label: 'Hepatitis A, pediatric/adolescent' },
			{ code: '85', label: 'Hep A-Hep B' },
			{ code: '88', label: 'Flu, unspecified' },
			{ code: '94', label: 'MMR-Varicella (MMRV)' },
			{ code: '100', label: 'Pneumococcal conjugate (PCV7)' },
			{ code: '110', label: 'DTaP-Hepatitis B-IPV' },
			{ code: '113', label: 'Td, adult' },
			{ code: '114', label: 'Meningococcal MCV4P' },
			{ code: '115', label: 'Tdap' },
			{ code: '116', label: 'Rotavirus, pentavalent' },
			{ code: '121', label: 'Zoster (shingles), live' },
			{ code: '133', label: 'PCV13 (Pneumococcal conjugate)' },
			{ code: '135', label: 'Influenza, high dose' },
			{ code: '140', label: 'Influenza, seasonal, injectable' },
			{ code: '150', label: 'Influenza, injectable, quadrivalent' },
			{ code: '158', label: 'Influenza, injectable, quadrivalent, preservative free' },
			{ code: '162', label: 'Meningococcal B, recombinant' },
			{ code: '165', label: 'HPV9 (Human Papillomavirus 9-valent)' },
			{ code: '174', label: 'COVID-19 (Moderna)' },
			{ code: '175', label: 'COVID-19 (Pfizer-BioNTech)' },
			{ code: '176', label: 'COVID-19 Pfizer-BioNTech' },
			{ code: '207', label: 'COVID-19 Moderna' },
			{ code: '210', label: 'COVID-19 Janssen (Johnson & Johnson)' },
			{ code: '212', label: 'COVID-19 Novavax' },
			{ code: '228', label: 'Zoster (shingles), recombinant (Shingrix)' },
		];
		return FALLBACK_CVX_CODES
			.filter(c => c.code.includes(lq) || c.label.toLowerCase().includes(lq))
			.slice(0, 15);
	}

	private _extractSearchItems(f: FieldDef, payload: unknown): Array<{ code: string; label: string }> {
		const data = (payload as Record<string, unknown>);
		const list = (data?.data as Record<string, unknown>)?.content
			|| (data?.data as unknown[])
			|| (data?.content as unknown[])
			|| (Array.isArray(payload) ? payload as unknown[] : []);
		const arr = Array.isArray(list) ? list as Record<string, unknown>[] : [];
		switch (f.type) {
			case 'coded':
			case 'code-search':
				// MedicalCode entity returns: { code, shortDescription, longDescription, ... }
				return arr.map(it => ({
					code: String(it.code || ''),
					label: String(it.shortDescription || it.longDescription || it.description || ''),
				})).filter(it => it.code);
			case 'practitioner-search':
				return arr.map(it => {
					const fn = String((it as Record<string, unknown>)['identification.firstName'] || it.firstName || '');
					const ln = String((it as Record<string, unknown>)['identification.lastName'] || it.lastName || '');
					const name = `${fn} ${ln}`.trim() || String(it.name || it.fullName || it.username || '');
					return { code: String(it.id || it.fhirId || ''), label: name };
				}).filter(it => it.code);
			case 'patient-search':
				return arr.map(it => ({
					code: String(it.id || it.fhirId || ''),
					label: `${String(it.firstName || '')} ${String(it.lastName || '')}`.trim() || String(it.name || ''),
				})).filter(it => it.code);
			case 'lookup': {
				// Honor lookupConfig.displayField / valueField when the backend specifies them;
				// fall back to common name/id keys otherwise.
				const vfRaw = f.lookupConfig?.valueField;
				const dfRaw = f.lookupConfig?.displayField;
				const valueField = typeof vfRaw === 'string' ? vfRaw : 'id';
				const displayField = typeof dfRaw === 'string' ? dfRaw : 'name';
				return arr.map(it => {
					const codeVal = String(it[valueField] ?? it.id ?? it.fhirId ?? '');
					const labelVal = String(it[displayField] ?? it.name ?? it.fullName ?? '');
					return { code: codeVal, label: labelVal || codeVal };
				}).filter(it => it.code);
			}
			case 'search': {
				// Generic search field — display label uses relatedDisplayFields
				// joined with spaces, falls back to title / name / fullName.
				const displayKeys = f.relatedDisplayFields && f.relatedDisplayFields.length > 0
					? f.relatedDisplayFields
					: ['title', 'name', 'fullName'];
				return arr.map(it => {
					const labelParts = displayKeys
						.map(k => String((it as Record<string, unknown>)[k] ?? ''))
						.filter(s => s);
					const label = labelParts.join(' ').trim() || String(it.name || it.title || '');
					return { code: String(it.id || it.fhirId || ''), label };
				}).filter(it => it.code);
			}
			default:
				return [];
		}
	}

	// --- List renderer (FHIR auto-columns) ---

	private _listAuto(c: HTMLElement, tab: ChartTab, data: Record<string, unknown>[], config: FieldConfig | null): void {
		const sample = data[0] || {};
		const allKeys = Object.keys(sample);

		// Column resolution mirrors the web's GenericFhirTab.listColumns() so the
		// workspace and EHR-UI tables show the same columns (the backend's
		// tab_field_config is the source of truth):
		//   1. Fields with showInTable=true (max 8)
		//   2. Else first 6 non-group/computed/textarea/address/hidden fields
		//   3. Else SECTIONS_CONFIG.columns hardcoded override (backwards compat)
		//   4. Else auto-discover from sample data
		let usedKeys: string[];
		let cols: string[];
		// Per-column fallback aliases for resilient value extraction. Backend
		// resource shapes vary (e.g. encounter: encounterDate / startDate / start)
		// so a single primary key can leave the cell blank when the data is fine.
		let usedAliases: string[][] = [];

		const fromConfig = ((): { keys: string[]; labels: string[] } | null => {
			if (!config?.sections?.length) { return null; }
			const marked: { key: string; label: string }[] = [];
			for (const section of config.sections) {
				if (!Array.isArray(section?.fields)) { continue; }
				for (const field of section.fields) {
					if (!field) { continue; }
					if (field.showInTable) { marked.push({ key: field.key, label: field.label }); }
				}
			}
			let picked = marked.slice(0, 8);
			if (picked.length === 0) {
				// Fallback: first 6 non-group fields (matches web behaviour)
				const fallback: { key: string; label: string }[] = [];
				outer: for (const section of config.sections) {
					if (!Array.isArray(section?.fields)) { continue; }
					for (const field of section.fields) {
						if (!field) { continue; }
						if (field.type === 'group' || field.type === 'computed' || field.type === 'textarea' || field.type === 'address' || field.type === 'hidden') { continue; }
						fallback.push({ key: field.key, label: field.label });
						if (fallback.length >= 6) { break outer; }
					}
				}
				picked = fallback;
			}
			if (picked.length === 0) { return null; }
			// Encounters special-case: the encounter create/edit form has no End
			// Date field, so an End Date column from the backend tab_field_config
			// could never be filled in — drop it (QA issue 3).
			if (tab.key === 'encounters') {
				picked = picked.filter(c => !/^(endDate|end_date|end|endDateTime|periodEnd|period_end|periodEndDate)$/i.test(c.key) && !/^end\s*date$/i.test(c.label || ''));
			}
			// Allergies special-case: ensure allergen column, drop end-date columns
			if (tab.key === 'allergies' || tab.key === 'allergy-intolerances') {
				picked = picked.filter(c => !/^(endDate|end_date|end|abatement|abatementDate)$/i.test(c.key));
				const hasAllergen = picked.some(c => /^(allergen|substance)$/i.test(c.key));
				if (!hasAllergen) {
					for (const section of config.sections) {
						for (const field of section.fields || []) {
							if (field && (field.key === 'allergen' || field.key === 'substance')) {
								picked.splice(Math.min(1, picked.length), 0, { key: field.key, label: field.label || 'Allergen' });
								break;
							}
						}
						if (picked.some(c => /^(allergen|substance)$/i.test(c.key))) { break; }
					}
				}
			}
			return { keys: picked.map(c => c.key), labels: picked.map(c => c.label) };
		})();

		if (fromConfig) {
			usedKeys = fromConfig.keys;
			cols = fromConfig.labels;
			// Pull aliases from any matching SECTIONS_CONFIG entry so value resolution
			// stays resilient across FHIR field-name variants. Match by key AND by
			// label: the backend tab_field_config often names a column the same
			// (label "End Date") but with a key the data doesn't carry (e.g. the
			// field key is `endDateTime`/`period` while the list row has `endDate`).
			// Without the label fallback the End Date cell renders blank even though
			// the encounter HAS an end date (QA: encounter end date not showing).
			const aliasMap = new Map<string, string[]>();
			const aliasByLabel = new Map<string, string[]>();
			for (const c of (tab.columns || [])) {
				const chain = [c.key, ...(c.aliases || [])];
				aliasMap.set(c.key, chain);
				if (c.label) { aliasByLabel.set(c.label.toLowerCase().trim(), chain); }
			}
			usedAliases = usedKeys.map((k, i) => {
				const byKey = aliasMap.get(k);
				if (byKey) { return byKey; }
				const byLabel = aliasByLabel.get((cols[i] || '').toLowerCase().trim());
				// Try the backend key first, then the label-matched alias chain.
				return byLabel ? [k, ...byLabel] : [k];
			});
		} else if (tab.columns && tab.columns.length > 0) {
			usedKeys = tab.columns.map(c => c.key);
			cols = tab.columns.map(c => c.label);
			usedAliases = tab.columns.map(c => [c.key, ...(c.aliases || [])]);
		} else {
			const priorityKeys = ['start', 'date', 'period', 'effectiveDateTime', 'recordedDate', 'authoredOn',
				'appointmentType', 'type', 'visitType', 'class', 'serviceType', 'code', 'medicationCodeableConcept',
				'providerName', 'providerDisplay', 'practitionerName', 'patientName', 'patientDisplay',
				'status', 'clinicalStatus', 'verificationStatus', 'category', 'severity', 'criticality',
				'reason', 'note', 'description', 'text'];

			usedKeys = [];
			for (const pk of priorityKeys) {
				if (allKeys.includes(pk) && usedKeys.length < 6) { usedKeys.push(pk); }
			}
			for (const k of allKeys) {
				if (usedKeys.length >= 6) { break; }
				if (!usedKeys.includes(k) && !k.startsWith('_') && k !== 'id' && k !== 'fhirId' && k !== 'patient' && k !== 'provider' && k !== 'location') {
					usedKeys.push(k);
				}
			}
			cols = usedKeys.map(k => k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()));
			// Rename "Abatement" -> "Resolved Date" so the Problems table matches the spec.
			for (let i = 0; i < cols.length; i++) {
				if (/^abatement/i.test(cols[i])) { cols[i] = 'Resolved Date'; }
			}
		}
		cols.push('Actions');

		// Encounter row click no longer redirects to the side EncounterFormEditor.
		// The test team wants the same edit-dialog UX as every other tab — full
		// chart-side encounter editing is still reachable through the calendar's
		// "Open Chart" action when there's a linked appointment.

		// Local pagination state per-tab; reset to page 0 each time the data set changes.
		const pageSize = 20;
		const cachedPage = this._listPage.get(tab.key) || 0;
		const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
		const page = Math.min(cachedPage, totalPages - 1);
		const start = page * pageSize;
		const pageItems = data.slice(start, start + pageSize);

		// Map a select field's stored value back to its human label so list
		// cells show "In Person" / "Disease Management" rather than the raw
		// "in_person" / "disease-management" the form persists. Keyed by field
		// key; a no-op for any column without matching select options.
		const optionLabels = new Map<string, Map<string, string>>();
		for (const section of (config?.sections || [])) {
			for (const field of (section.fields || [])) {
				if (!field || field.type !== 'select' || !Array.isArray(field.options)) { continue; }
				const labels = new Map<string, string>();
				for (const opt of field.options) {
					if (typeof opt === 'string') { labels.set(opt, opt); }
					else if (opt && opt.value !== '') { labels.set(opt.value, opt.label); }
				}
				if (labels.size > 0) { optionLabels.set(field.key, labels); }
			}
		}

		const rows = pageItems.map(item => {
			const cells = usedKeys.map((k, idx) => {
				// Walk the alias chain: first non-empty value wins.
				const tryKeys = usedAliases[idx] && usedAliases[idx].length > 0 ? usedAliases[idx] : [k];
				let v: unknown = '';
				for (const tk of tryKeys) {
					const candidate = item[tk];
					if (candidate !== null && candidate !== undefined && candidate !== '') {
						v = candidate;
						break;
					}
				}
				// Encounters: show the signing-workflow state (Signed / Unsigned)
				// the patient snapshot shows, not the raw FHIR status ("Finished")
				// — QA issue 2.
				if (tab.key === 'encounters' && (k === 'status' || String(cols[idx] || '').trim().toLowerCase() === 'status')) {
					return PatientChartEditor._encounterSignedLabel(v || item.status);
				}
				// Provider / organization / location columns frequently arrive as
				// raw IDs (numeric, UUID, "Practitioner/abc-123"). Swap with the
				// resolved display name so the table never shows a bare ID in a
				// human-readable column. The resolver is a no-op for any value
				// that doesn't look like an ID.
				v = this._resolveIdToName(k, v);
				if (v === null || v === undefined || v === '') { return ''; }
				// Select fields persist the option value (e.g. "in_person"); show
				// its label (e.g. "In Person") in the table.
				if (typeof v === 'string') {
					const label = optionLabels.get(k)?.get(v);
					if (label) { v = label; }
				}
				if (typeof v === 'object') {
					const obj = v as Record<string, unknown>;
					return String(obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.display || '');
				}
				if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
					try {
						const d = new Date(v);
						// Show the time component when the value carries a real
						// (non-midnight) time — e.g. lab Collection/Result Date store a
						// timestamp and the list was dropping it (issue 11). Plain
						// date-only values (no "T", or midnight) stay date-only.
						const hasTime = /T\d{2}:\d{2}/.test(v) && !/T00:00(:00)?(\.\d+)?Z?$/.test(v);
						if (hasTime) {
							return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
						}
						return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
					} catch { /* */ }
				}
				return String(v).substring(0, 40);
			});
			// Final cell text is set by _table when onDelete is provided.
			cells.push('');

			let onClick: (() => void) | undefined = () => this._openRecordDialog(tab, config, item);

			const recordId = String(item.id || item.fhirId || '');
			// Tabs whose backend only supports create/read — no PUT or DELETE — must
			// suppress the row delete handler so users don't hit 405s.
			const writeOnceTabs = new Set<string>();
			let onDelete: (() => void) | undefined = !recordId || tab.readOnly || writeOnceTabs.has(tab.key)
				? undefined
				: () => this._deleteListRecord(tab, recordId);

			// Rows merged from a foreign store (e.g. Document Scanning scans on the
			// Documents tab) are view-only here — editing/deleting them must happen
			// in their own module, not through this tab's endpoints.
			if (item['__readonly'] === true) {
				return { cells, onClick: undefined, onDelete: undefined, extraActions: undefined };
			}

			let extraActions: Array<{ icon: string; title: string; color?: string; onClick: () => void }> | undefined;

			// Encounters are auto-created when an appointment is marked "Completed"
			// (Appointments page) — they are never added or edited through the chart's
			// generic inline dialog. Their actions expose "Open Chart" (the editable
			// SOAP encounter form, which enforces Save / Sign & Lock — once signed the
			// form is read-only) and "Visit Summary" (the read-only summary slide-over).
			// The generic edit and delete actions are suppressed so the column
			// shows exactly Open Chart + Visit Summary.
			if (tab.key === 'encounters') {
				const encId = (recordId || '').split('/').pop() || '';
				onClick = undefined;
				onDelete = undefined;
				const openChart = (): void => {
					if (!encId) { this._navigate('encounters'); return; }
					this.editorService.openEditor(
						new EncounterFormEditorInput(this.patientId, encId, this.patientName, 'Encounter'),
						{},
						SIDE_GROUP,
					);
				};
				const openSummary = (): void => {
					if (!encId) { return; }
					showVisitSummaryPanel(
						{ apiService: this.apiService, themeService: this.themeService, notificationService: this.notificationService },
						this.patientId, encId, this.patientName,
					);
				};
				extraActions = [
					// allow-any-unicode-next-line
					{ icon: '📋', title: 'Open Chart', color: '#3b82f6', onClick: openChart },
					// allow-any-unicode-next-line
					{ icon: '📝', title: 'Visit Summary', color: '#10b981', onClick: openSummary },
				];
				return { cells, onClick, onDelete, extraActions };
			}

			// Open Chart / Record Vitals / Visit Summary shortcuts for other
			// encounter-linked tabs (e.g. Billing). The set is empty by default;
			// re-add a tab key to surface the encounter shortcuts on that tab.
			const encounterLinkedTabs = new Set<string>();
			if (encounterLinkedTabs.has(tab.key)) {
				// Row may surface the encounter via different keys: `encounterId`,
				// `encounter`, `encounterRef`, `encounter.reference`, or — for the
				// Encounters tab itself — the row's own `id` / `fhirId`.
				const encFromKeys = String(item.encounterId || item.encounter || item.encounterRef || (item.encounter as Record<string, unknown> | undefined)?.reference || '').split('/').pop() || '';
				const encId = encFromKeys || (tab.key === 'encounters' ? String(item.id || item.fhirId || '').split('/').pop() : '') || '';
				const openSection = (section: string): void => {
					if (encId) {
						this.editorService.openEditor(
							new EncounterFormEditorInput(this.patientId, encId, this.patientName, 'Encounter', section),
							{},
							SIDE_GROUP,
						);
					} else {
						this._navigate('encounters');
					}
				};
				extraActions = [
					// allow-any-unicode-next-line
					// 'Open Chart' jumps to the Chief Complaint (top) section; 'Visit
					// Summary' jumps to the Assessment & Plan section — the encounter
					// form has no 'summary' section key, so the previous 'summary'
					// target matched nothing and the encounter opened blank/at-top
					// (QA issue 15). These keys mirror the appointmentsEditor flow.
					// allow-any-unicode-next-line
					{ icon: '📋', title: 'Open Chart', color: '#3b82f6', onClick: () => openSection('cc') },
					// allow-any-unicode-next-line
					{ icon: '❤️', title: 'Record Vitals', color: '#ef4444', onClick: () => openSection('vitals') },
					// allow-any-unicode-next-line
					{ icon: '📝', title: 'Visit Summary', color: '#10b981', onClick: () => openSection('plan') },
				];
			}

			return { cells, onClick, onDelete, extraActions };
		});

		this._table(c, cols, rows);

		// Pagination footer: only show when there's more than one page.
		if (totalPages > 1) {
			const bar = DOM.append(c, DOM.$('div'));
			bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 4px 0;font-size:12px;color:var(--vscode-descriptionForeground);';

			const info = DOM.append(bar, DOM.$('span'));
			const fromN = start + 1;
			const toN = Math.min(start + pageSize, data.length);
			info.textContent = `${fromN}-${toN} of ${data.length}`;
			info.style.flex = '1';

			const btn = (label: string, disabled: boolean, onClick: () => void) => {
				const b = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
				b.textContent = label;
				b.disabled = disabled;
				b.style.cssText = `padding:4px 10px;border-radius:4px;cursor:${disabled ? 'default' : 'pointer'};font-size:11px;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);opacity:${disabled ? '0.4' : '1'};`;
				b.addEventListener('click', onClick);
				return b;
			};
			btn('Prev', page <= 0, () => {
				this._listPage.set(tab.key, page - 1);
				this._renderMain();
			});
			const pageInfo = DOM.append(bar, DOM.$('span'));
			pageInfo.textContent = `Page ${page + 1} of ${totalPages}`;
			btn('Next', page >= totalPages - 1, () => {
				this._listPage.set(tab.key, page + 1);
				this._renderMain();
			});
		}

		// Any provider ids this render couldn't resolve (e.g. a prescriber whose
		// Practitioner row fell outside the bulk /api/providers page) — fetch them
		// individually, then re-render so the table shows the name (QA issue 9).
		void this._resolvePendingProviderIds(tab);
	}

	/**
	 * Fetch the names for any provider ids `_resolveIdToName` flagged as
	 * unresolved during the last render, cache them, and re-render the chart
	 * once so prescriber / provider / author columns show a name instead of a
	 * bare id. Guarded by `_attemptedProviderIds` so a genuinely-missing id is
	 * only fetched once (no render loop).
	 */
	private async _resolvePendingProviderIds(tab: ChartTab): Promise<void> {
		if (this._unresolvedProviderIds.size === 0) { return; }
		const ids = Array.from(this._unresolvedProviderIds);
		this._unresolvedProviderIds.clear();
		let resolvedAny = false;
		await Promise.all(ids.map(async id => {
			this._attemptedProviderIds.add(id);
			// Try the plain provider endpoint first, then the FHIR practitioner
			// view — each indexes ids the other can miss.
			for (const url of [`/api/providers/${id}`, `/api/fhir-resource/practitioners/${id}`]) {
				try {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { continue; }
					const d = await res.json();
					const p = (d?.data ?? d) as Record<string, unknown>;
					if (!p || typeof p !== 'object') { continue; }
					const prefix = (p as Record<string, Record<string, unknown>>).identification;
					const first = String(prefix?.firstName ?? p.firstName ?? '').trim();
					const last = String(prefix?.lastName ?? p.lastName ?? '').trim();
					const name = (`${first} ${last}`.trim())
						|| String(p.displayName ?? p.name ?? p.fullName ?? p.username ?? '').trim();
					if (name) {
						this._providerNameById.set(id, name);
						this._providerNameById.set(`Practitioner/${id}`, name);
						this._providerNameById.set(`PractitionerRole/${id}`, name);
						resolvedAny = true;
						break;
					}
				} catch { /* try next url */ }
			}
		}));
		// Only re-render if we actually learned a new name AND this tab is still
		// the one on screen, so the freshly-fetched names paint into the table.
		if (resolvedAny && this.activeTab === tab.key) { this._renderMain(); }
	}

	/**
	 * Fetch a single referenced record's display name by id when the bulk lookup
	 * caches missed it (e.g. a billing provider or insurer outside the first ~500
	 * rows loaded by `_loadLookups`). Picks the endpoint set from the field key's
	 * category — practitioner / organization-payer / location — populates the
	 * matching cache, and returns the name so the edit form can show it instead of
	 * the raw id. Returns undefined when nothing resolves (id left visible).
	 */
	private async _fetchReferenceName(fieldKey: string, rawId: string): Promise<string | undefined> {
		const id = rawId.includes('/') ? rawId.split('/').pop() || rawId : rawId;
		if (!id) { return undefined; }
		const key = fieldKey.toLowerCase();
		const isProvider = /(provider|practitioner|performer|author|prescrib|physician|doctor|orderedby|ordering|referrer|referredby|signedby|recorder|reporter|enterer|orderer|requester|educator)/.test(key);
		const isOrg = /(insur|payer|payor|organization|company)/.test(key);
		const isLocation = /(location|facility|site)/.test(key);
		const urls = isProvider ? [`/api/providers/${id}`, `/api/fhir-resource/practitioners/${id}`]
			: isOrg ? [`/api/insurance-companies/${id}`, `/api/fhir-resource/insurance-companies/${id}`, `/api/organizations/${id}`, `/api/fhir-resource/organizations/${id}`]
				: isLocation ? [`/api/locations/${id}`, `/api/fhir-resource/locations/${id}`]
					: [];
		for (const url of urls) {
			try {
				const res = await this.apiService.fetch(url);
				if (!res.ok) { continue; }
				const d = await res.json();
				const p = (d?.data ?? d) as Record<string, unknown>;
				if (!p || typeof p !== 'object') { continue; }
				const idn = (p as Record<string, Record<string, unknown>>).identification;
				const first = String(idn?.firstName ?? p.firstName ?? '').trim();
				const last = String(idn?.lastName ?? p.lastName ?? '').trim();
				const name = (`${first} ${last}`.trim())
					|| String(p.name ?? p.displayName ?? p.fullName ?? p.organizationName ?? p.payerName ?? p.companyName ?? p.insuranceName ?? p.insuranceCompanyName ?? p.locationName ?? p.username ?? '').trim();
				if (!name) { continue; }
				if (isProvider) {
					this._providerNameById.set(id, name);
					this._providerNameById.set(`Practitioner/${id}`, name);
					this._providerNameById.set(`PractitionerRole/${id}`, name);
				} else if (isOrg) {
					this._orgNameById.set(id, name);
					this._orgNameById.set(`Organization/${id}`, name);
				} else if (isLocation) {
					this._locationNameById.set(id, name);
					this._locationNameById.set(`Location/${id}`, name);
				}
				return name;
			} catch { /* try next url */ }
		}
		return undefined;
	}

	/** Delete a record from a list tab, then refresh the view + counts + Quick Info. */
	private async _deleteListRecord(tab: ChartTab, recordId: string): Promise<void> {
		const ok = DOM.getActiveWindow().confirm(`Delete this ${tab.label.toLowerCase()} record?`);
		if (!ok) { return; }
		try {
			const ep = (this._tabEndpoint(tab) || '').split('?')[0];
			if (!ep) { return; }
			const url = tab.key === 'vitals'
				? `${ep}/patient/${this.patientId}/${recordId}`
				: tab.key === 'labs'
					? `/api/lab-order/${this._clinicalPatientId()}/${recordId}`
					: `${ep}/${recordId}`;
			const res = await this.apiService.fetch(url, { method: 'DELETE' });
			if (res.ok) {
				this.notificationService.info(`${tab.label} record deleted`);
				this._tabDataCache.delete(tab.key);
				this._renderMain();
				void this._loadQuickInfo();
				void this._refreshTabCounts();
			} else {
				const err = await res.text().catch(() => 'Unknown error');
				this.notificationService.error(`Delete failed: ${err.substring(0, 200)}`);
			}
		} catch (e) {
			this.notificationService.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private _table(container: HTMLElement, columns: string[], rows: Array<{ cells: string[]; onClick?: () => void; onDelete?: () => void; extraActions?: Array<{ icon: string; title: string; color?: string; onClick: () => void }> }>): void {
		const wrap = DOM.append(container, DOM.$('div'));
		// `overflow-x:auto` keeps the Action column reachable on narrow
		// chart panes (was clipped under the chart's outer overflow:hidden);
		// the table sets its own min-width so columns don't squeeze invisibly.
		wrap.style.cssText = 'overflow-x:auto;overflow-y:visible;scrollbar-width:thin;';
		const table = DOM.append(wrap, DOM.$('table'));
		table.style.cssText = 'width:100%;min-width:760px;border-collapse:collapse;font-size:13px;';

		const thead = DOM.append(table, DOM.$('thead'));
		const hrow = DOM.append(thead, DOM.$('tr'));
		for (const col of columns) {
			const th = DOM.append(hrow, DOM.$('th'));
			th.textContent = col;
			th.style.cssText = 'text-align:left;padding:8px 12px;font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);white-space:nowrap;';
		}

		const tbody = DOM.append(table, DOM.$('tbody'));
		const lastCol = columns.length - 1;
		const lastIsActions = columns[lastCol] === 'Actions';

		for (const row of rows) {
			const tr = DOM.append(tbody, DOM.$('tr'));
			tr.style.cssText = `cursor:${row.onClick ? 'pointer' : 'default'};`;
			tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--vscode-list-hoverBackground)'; });
			tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
			if (row.onClick) {
				tr.addEventListener('click', (e) => {
					// Don't bubble through Action buttons
					if ((e.target as HTMLElement).closest?.('.row-action')) { return; }
					row.onClick!();
				});
			}

			for (let i = 0; i < row.cells.length; i++) {
				const td = DOM.append(tr, DOM.$('td'));
				td.style.cssText = 'padding:8px 12px;border-bottom:1px solid rgba(128,128,128,0.08);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;';

				const isActionsCell = lastIsActions && i === lastCol;
				if (isActionsCell) {
					td.style.maxWidth = 'none';
					td.style.textOverflow = 'clip';
					const wrap = DOM.append(td, DOM.$('div.row-action'));
					wrap.style.cssText = 'display:flex;gap:6px;align-items:center;';

					// Tab-specific extras (Open Chart / Record Vitals / Visit
					// Summary on the Appointments tab) come first so they read
					// before the generic edit / delete pair.
					if (row.extraActions) {
						for (const a of row.extraActions) {
							const b = DOM.append(wrap, DOM.$('button'));
							b.title = a.title;
							b.textContent = a.icon;
							b.style.cssText = `background:transparent;border:none;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:3px;color:${a.color || 'var(--vscode-foreground)'};`;
							b.addEventListener('mouseenter', () => { b.style.background = `${a.color || '#888'}20`; });
							b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
							b.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
						}
					}

					if (row.onClick) {
						const editBtn = DOM.append(wrap, DOM.$('button'));
						editBtn.title = 'Edit';
						// allow-any-unicode-next-line
						editBtn.textContent = '✏️';
						editBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;font-size:14px;padding:2px 4px;border-radius:3px;';
						editBtn.addEventListener('click', (e) => { e.stopPropagation(); row.onClick!(); });
					}
					if (row.onDelete) {
						const delBtn = DOM.append(wrap, DOM.$('button'));
						delBtn.title = 'Delete';
						// allow-any-unicode-next-line
						delBtn.textContent = '🗑️';
						delBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;font-size:14px;padding:2px 4px;border-radius:3px;color:#ef4444;';
						delBtn.addEventListener('click', (e) => { e.stopPropagation(); row.onDelete!(); });
					}
				} else if (columns[i] === 'Status') {
					const badge = DOM.append(td, DOM.$('span'));
					badge.textContent = row.cells[i];
					badge.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:3px;background:rgba(59,130,246,0.12);color:#3b82f6;text-transform:capitalize;';
				} else if (i === 0) {
					td.style.fontWeight = '600';
					td.textContent = row.cells[i];
				} else {
					td.textContent = row.cells[i];
				}
			}
		}
	}

	// --- Formatting helpers ---

	/**
	 * Resolve a FHIR-shaped field to a plain display string. Handles raw
	 * strings, CodeableConcept objects ({text, coding:[{display}]}), nested
	 * `valueCodeableConcept` wrappers, and arrays-of-codings. Returns '' when
	 * nothing displayable can be extracted — callers can short-circuit on
	 * empty.
	 */
	private _displayText(raw: unknown): string {
		if (raw === null || raw === undefined) { return ''; }
		if (typeof raw === 'string' || typeof raw === 'number') { return String(raw).trim(); }
		if (Array.isArray(raw)) {
			for (const item of raw) {
				const got = this._displayText(item);
				if (got) { return got; }
			}
			return '';
		}
		if (typeof raw === 'object') {
			const obj = raw as Record<string, unknown>;
			const direct = (typeof obj.text === 'string' && obj.text)
				|| (typeof obj.display === 'string' && obj.display)
				|| (typeof obj.name === 'string' && obj.name);
			if (direct) { return String(direct).trim(); }
			const coding = obj.coding as Array<Record<string, unknown>> | undefined;
			if (Array.isArray(coding)) {
				for (const c of coding) {
					if (typeof c?.display === 'string' && c.display) { return c.display.trim(); }
					if (typeof c?.code === 'string' && c.code) { return c.code.trim(); }
				}
			}
			const nestedCC = obj.valueCodeableConcept || obj.code || obj.severity || obj.clinicalStatus;
			if (nestedCC && nestedCC !== raw) { return this._displayText(nestedCC); }
		}
		return '';
	}

	private _formatDate(raw: unknown): string {
		if (!raw) { return ''; }
		if (Array.isArray(raw)) {
			const [y, m, d] = raw;
			if (typeof y === 'number' && typeof m === 'number' && typeof d === 'number') {
				return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
			}
			return '';
		}
		try { return new Date(String(raw)).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); }
		catch { return String(raw); }
	}

	/** Convert a date value (string/number/array) to a sortable epoch ms. */
	private _toEpoch(raw: unknown): number {
		if (!raw) { return 0; }
		if (Array.isArray(raw)) {
			const [y, m, d] = raw;
			if (typeof y === 'number' && typeof m === 'number' && typeof d === 'number') {
				return new Date(y, m - 1, d).getTime();
			}
			return 0;
		}
		const t = new Date(String(raw)).getTime();
		return isNaN(t) ? 0 : t;
	}

	private _calculateAge(raw: unknown): string {
		if (!raw) { return ''; }
		let birthDate: Date;
		if (Array.isArray(raw)) {
			const [y, m, d] = raw;
			if (typeof y !== 'number' || typeof m !== 'number' || typeof d !== 'number') { return ''; }
			birthDate = new Date(y, m - 1, d);
		} else {
			birthDate = new Date(String(raw));
		}
		if (isNaN(birthDate.getTime())) { return ''; }
		const now = new Date();
		let years = now.getFullYear() - birthDate.getFullYear();
		let months = now.getMonth() - birthDate.getMonth();
		let days = now.getDate() - birthDate.getDate();
		if (days < 0) { months--; const prev = new Date(now.getFullYear(), now.getMonth(), 0); days += prev.getDate(); }
		if (months < 0) { years--; months += 12; }
		if (years > 0) { return `${years} yr${years !== 1 ? 's' : ''}${months > 0 ? ` ${months} mo` : ''}`; }
		if (months > 0) { return `${months} mo${days > 0 ? ` ${days} d` : ''}`; }
		return `${days} d`;
	}

	private _formatPhoneDisplay(raw: string): string {
		// Standardize US phone display as XXX-XXX-XXXX (e.g. 555-678-9876).
		// Returns the original string unchanged when it isn't a 10-digit number.
		const digits = (raw || '').replace(/\D/g, '');
		const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
		if (ten.length !== 10) { return raw; }
		return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
	}

	private _genderLabel(g: string): string {
		if (!g) { return ''; }
		const map: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other', U: 'Unknown', Male: 'Male', Female: 'Female', Other: 'Other', Unknown: 'Unknown' };
		return map[g] || g;
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}

