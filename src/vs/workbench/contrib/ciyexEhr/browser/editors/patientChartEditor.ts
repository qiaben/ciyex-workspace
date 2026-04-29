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
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { PatientChartEditorInput, EncounterFormEditorInput } from './ciyexEditorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import * as DOM from '../../../../../base/browser/dom.js';

// --- Types ---
interface ChartCategory { key: string; label: string; position: number; hideFromChart?: boolean; tabs: ChartTab[] }
interface ChartTab { key: string; label: string; icon: string; emoji?: string; color?: string; position: number; visible: boolean; display?: 'form' | 'list' | 'custom'; panel?: 'main' | 'bottom' | 'right'; fhirResources: string[]; apiPath?: string; columns?: Array<{ key: string; label: string; aliases?: string[] }>; readOnly?: boolean }
interface FieldSection { key: string; title: string; columns: number; visible: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[] }
interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; options?: Array<{ label: string; value: string }>; fhirMapping?: Record<string, string>; validation?: Record<string, unknown>; lookupConfig?: Record<string, string>; showWhen?: { field: string; equals?: string; notEquals?: string } }
interface FieldConfig { tabKey: string; sections: FieldSection[] }
interface QuickInfo { allergies: string; problems: string; medications: string; history: string; vitals: string }

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

// Default chart layout. Order is fixed per the test team spec:
// Overview, Portal, General, Clinical, Encounters, Claims, Financial, Others.
const DEFAULT_CATEGORIES: ChartCategory[] = [
	{
		key: 'overview', label: 'Overview', position: 0, tabs: [
			{ key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', emoji: '\u{1F4CA}', position: 0, visible: true, display: 'custom', panel: 'main', fhirResources: [] },
			{ key: 'demographics', label: 'Demographics', icon: 'User', emoji: '\u{1F464}', position: 1, visible: true, display: 'form', panel: 'main', fhirResources: ['Patient'] },
			{ key: 'forms', label: 'Forms', icon: 'FileText', emoji: '\u{1F4DD}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'] },
			{ key: 'vitals', label: 'Vitals', icon: 'Activity', emoji: '\u{2764}\u{FE0F}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/fhir-resource/vitals' },
			{
				key: 'allergies', label: 'Allergies', icon: 'AlertTriangle', emoji: '\u{1F6A8}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['AllergyIntolerance'],
				columns: [
					{ key: 'allergyName', label: 'Allergen', aliases: ['allergyName', 'name', 'code'] },
					{ key: 'reaction', label: 'Reaction', aliases: ['reaction', 'manifestation'] },
					{ key: 'severity', label: 'Severity' },
					{ key: 'status', label: 'Status', aliases: ['status', 'clinicalStatus'] },
					{ key: 'startDate', label: 'Start Date', aliases: ['startDate', 'recordedDate', 'onsetDate', 'onsetDateTime'] },
				],
			},
			{
				key: 'problems', label: 'Problems', icon: 'AlertCircle', emoji: '\u{26A0}\u{FE0F}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: ['Condition'],
				columns: [
					{ key: 'condition', label: 'Condition', aliases: ['condition', 'name', 'code', 'display'] },
					{ key: 'icdCode', label: 'ICD-10 Code', aliases: ['icdCode', 'icd10Code', 'code'] },
					{ key: 'severity', label: 'Severity' },
					{ key: 'clinicalStatus', label: 'Status', aliases: ['clinicalStatus', 'status'] },
					{ key: 'onsetDate', label: 'Onset Date', aliases: ['onsetDate', 'onsetDateTime', 'recordedDate'] },
					{ key: 'resolvedDate', label: 'Resolved Date', aliases: ['resolvedDate', 'abatementDate', 'abatementDateTime'] },
				],
			},
		],
	},
	{
		key: 'portal', label: 'Portal', position: 1, tabs: [
			{ key: 'portal-demographics', label: 'Demographics', icon: 'User', emoji: '\u{1F464}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: [] },
		],
	},
	{
		key: 'general', label: 'General', position: 2, tabs: [
			{ key: 'insurance', label: 'Insurance', icon: 'Shield', emoji: '\u{1F6E1}\u{FE0F}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Coverage', 'Organization'] },
			{ key: 'documents', label: 'Documents', icon: 'FileText', emoji: '\u{1F4C4}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'] },
			{ key: 'education', label: 'Education', icon: 'BookOpen', emoji: '\u{1F4D6}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/education/assignments' },
			// Messaging uses the FHIR Communication resource via the generic FHIR controller
			// — same backend `tab_field_config` + scope enforcement as the rest of the chart,
			// and no separate patient-messages controller required.
			{ key: 'messaging', label: 'Messaging', icon: 'MessageSquare', emoji: '\u{1F4AC}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['Communication'] },
			{ key: 'relationships', label: 'Relationships', icon: 'Users', emoji: '\u{1F46A}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['RelatedPerson'] },
			{ key: 'facility', label: 'Facility', icon: 'Building', emoji: '\u{1F3E2}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/locations' },
		],
	},
	{
		key: 'clinical', label: 'Clinical', position: 3, tabs: [
			{
				key: 'clinical-alerts', label: 'Clinical Alerts', icon: 'Bell', emoji: '\u{1F514}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/cds/alerts',
				columns: [
					{ key: 'alert', label: 'Alert' },
					{ key: 'severity', label: 'Severity' },
					{ key: 'identifiedDate', label: 'Identified Date' },
					{ key: 'authorName', label: 'Author' },
				],
			},
			{
				key: 'medications', label: 'Medications', icon: 'Pill', emoji: '\u{1F48A}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['MedicationRequest'],
				columns: [
					{ key: 'medicationName', label: 'Medication Name' },
					{ key: 'dosage', label: 'Dosage' },
					{ key: 'frequency', label: 'Frequency' },
					{ key: 'startDate', label: 'Start Date' },
					{ key: 'prescriberName', label: 'Prescriber' },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'labs', label: 'Labs', icon: 'TestTube', emoji: '\u{1F9EA}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['DiagnosticReport', 'Observation'],
				columns: [
					{ key: 'testName', label: 'Test Name' },
					{ key: 'testCode', label: 'Test Code' },
					{ key: 'collectionDate', label: 'Collection Date' },
					{ key: 'resultDate', label: 'Result Date' },
					{ key: 'providerName', label: 'Provider' },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'immunizations', label: 'Immunizations', icon: 'Syringe', emoji: '\u{1F489}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['Immunization'],
				columns: [
					{ key: 'vaccineName', label: 'Vaccine' },
					{ key: 'cvxCode', label: 'CVX Code' },
					{ key: 'administeredDate', label: 'Date Administered' },
					{ key: 'lotNumber', label: 'Lot Number' },
					{ key: 'dose', label: 'Dose' },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'procedures', label: 'Procedures', icon: 'Scissors', emoji: '\u{2702}\u{FE0F}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['Procedure'],
				columns: [
					{ key: 'procedureName', label: 'Procedure' },
					{ key: 'cptCode', label: 'CPT Code' },
					{ key: 'datePerformed', label: 'Date Performed' },
					{ key: 'performerName', label: 'Performer' },
					{ key: 'status', label: 'Status' },
				],
			},
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
					{ key: 'endDate', label: 'End Date', aliases: ['endDate', 'end', 'periodEnd'] },
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
					{ key: 'type', label: 'Note Type' },
					{ key: 'date', label: 'Visit Date' },
					{ key: 'authorName', label: 'Author' },
					{ key: 'subject', label: 'Subject' },
					{ key: 'status', label: 'Status' },
				],
			},
			{
				key: 'referrals', label: 'Referrals', icon: 'ArrowRight', emoji: '\u{27A1}\u{FE0F}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['ServiceRequest'],
				columns: [
					{ key: 'referralType', label: 'Referral Type' },
					{ key: 'specialty', label: 'Specialty' },
					{ key: 'referredTo', label: 'Referred To' },
					{ key: 'date', label: 'Date' },
					{ key: 'status', label: 'Status' },
				],
			},
		],
	},
	{
		key: 'claims', label: 'Claims', position: 5, tabs: [
			{ key: 'billing', label: 'Billing', icon: 'Receipt', emoji: '\u{1F9FE}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'] },
			{ key: 'claims', label: 'Claims', icon: 'FileCheck', emoji: '\u{1F4CB}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'] },
			{ key: 'submissions', label: 'Submissions', icon: 'Upload', emoji: '\u{1F4E4}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/portal/form-submissions' },
			{ key: 'denials', label: 'Denials', icon: 'AlertCircle', emoji: '\u{26D4}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'], apiPath: '/api/fhir-resource/claims?status=denied' },
			{ key: 'era-remittance', label: 'ERA / Remittance', icon: 'FileDown', emoji: '\u{1F4C4}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['PaymentReconciliation'], readOnly: true },
			{ key: 'transactions', label: 'Transactions', icon: 'ArrowLeftRight', emoji: '\u{1F4B3}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: [], apiPath: '/api/payments/transactions', readOnly: true },
		],
	},
	{
		key: 'financial', label: 'Financial', position: 6, tabs: [
			// Payment + Statements both flow through FHIR (Invoice / PaymentNotice) so the
			// fields, columns, and edit form match what tab_field_config defines — same
			// source of truth as the web UI's PaymentPostingTab / StatementsTab.
			{ key: 'payment', label: 'Payment', icon: 'CreditCard', emoji: '\u{1F4B3}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Invoice'] },
			{ key: 'statements', label: 'Statements', icon: 'FileBarChart', emoji: '\u{1F4CA}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['PaymentNotice'] },
		],
	},
	{
		key: 'others', label: 'Others', position: 7, tabs: [
			// Issues view rolls up Condition+AllergyIntolerance+MedicationRequest per V64;
			// the backend tab_field_config 'issues' is the source of truth for fields.
			{ key: 'issues', label: 'Issues', icon: 'CircleAlert', emoji: '\u{2757}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Condition'], readOnly: true },
			// Report = clinical reports (DiagnosticReport).
			{ key: 'report', label: 'Report', icon: 'FileBarChart', emoji: '\u{1F4C8}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['DiagnosticReport'], readOnly: true },
		],
	},
];

const SIDEBAR_COLLAPSED_KEY = 'ciyex.patientChart.sidebarCollapsed';
const LAST_TAB_KEY_PREFIX = 'ciyex.patientChart.lastTab.';

// Built-in field configs for tabs with a standard structure. Users can still override by dropping
// a file at ~/.ciyex/fields/{tabKey}.json — that takes precedence.
const DEFAULT_FIELD_CONFIGS: Record<string, FieldConfig> = {
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
					{ key: 'allergyName', label: 'Allergen', type: 'text', required: true, placeholder: 'Allergen name' },
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
					{ key: 'condition', label: 'Condition', type: 'text', required: true, placeholder: 'Condition name' },
					{ key: 'icdCode', label: 'ICD-10 Code', type: 'code-search', placeholder: 'Search ICD-10 codes...', lookupConfig: { system: 'ICD10_CM' } },
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
					{ key: 'bmi', label: 'BMI (kg/m²)', type: 'number', placeholder: 'Auto-calculated' },
					{ key: 'bpSystolic', label: 'BP Systolic (mmHg)', type: 'number', required: true, placeholder: '0' },
					{ key: 'bpDiastolic', label: 'BP Diastolic (mmHg)', type: 'number', required: true, placeholder: '0' },
					{ key: 'pulse', label: 'Pulse (/min)', type: 'number', required: true, placeholder: '0' },
					{ key: 'respiration', label: 'Respiration (breaths/min)', type: 'number', required: true, placeholder: '0' },
					// allow-any-unicode-next-line
					{ key: 'temperatureC', label: 'Temperature (°C)', type: 'number', required: true, placeholder: '0.0' },
					{ key: 'oxygenSaturation', label: 'O\u{2082} Saturation (%)', type: 'number', required: true, placeholder: '0' },
				],
			},
			{
				key: 'notes', title: 'Notes', columns: 1, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Optional notes' },
				],
			},
		],
	},
	'clinical-alerts': {
		tabKey: 'clinical-alerts',
		sections: [
			{
				key: 'alert', title: 'Clinical Alert', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'alert', label: 'Alert', type: 'text', required: true, placeholder: 'Alert summary' },
					{
						key: 'severity', label: 'Severity', type: 'select', options: [
							{ label: 'Low', value: 'low' },
							{ label: 'Medium', value: 'medium' },
							{ label: 'High', value: 'high' },
							{ label: 'Critical', value: 'critical' },
						]
					},
					{ key: 'identifiedDate', label: 'Identified Date', type: 'date', required: true },
					{ key: 'authorId', label: 'Author', type: 'practitioner-search', placeholder: 'Search Author' },
					{ key: 'description', label: 'Description', type: 'textarea', colSpan: 2, placeholder: 'Detailed description' },
				],
			},
		],
	},
	medications: {
		tabKey: 'medications',
		sections: [
			{
				key: 'med', title: 'Medication', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'medicationName', label: 'Medication Name', type: 'text', required: true, placeholder: 'Drug name' },
					{ key: 'dosage', label: 'Dosage', type: 'text', required: true, placeholder: 'e.g., 500 mg' },
					{ key: 'route', label: 'Route', type: 'text', placeholder: 'e.g., Oral' },
					{ key: 'frequency', label: 'Frequency', type: 'text', placeholder: 'e.g., Twice daily' },
					{ key: 'startDate', label: 'Start Date', type: 'date' },
					{ key: 'endDate', label: 'End Date', type: 'date' },
					{ key: 'prescriberId', label: 'Prescriber', type: 'practitioner-search', placeholder: 'Search Prescriber' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Active', value: 'active' },
							{ label: 'On Hold', value: 'on-hold' },
							{ label: 'Stopped', value: 'stopped' },
							{ label: 'Completed', value: 'completed' },
						]
					},
					{ key: 'instructions', label: 'Instructions', type: 'textarea', colSpan: 2, placeholder: 'Patient instructions' },
				],
			},
		],
	},
	labs: {
		tabKey: 'labs',
		sections: [
			{
				key: 'lab', title: 'Lab Order / Result', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'testName', label: 'Test Name', type: 'text', required: true, placeholder: 'Test name' },
					{ key: 'testCode', label: 'Test Code (LOINC)', type: 'code-search', placeholder: 'Search LOINC codes', lookupConfig: { system: 'LOINC' } },
					{ key: 'collectionDate', label: 'Collection Date', type: 'date' },
					{ key: 'resultDate', label: 'Result Date', type: 'date' },
					{ key: 'providerId', label: 'Provider', type: 'practitioner-search', placeholder: 'Search Provider' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Ordered', value: 'ordered' },
							{ label: 'In Progress', value: 'in-progress' },
							{ label: 'Final', value: 'final' },
							{ label: 'Cancelled', value: 'cancelled' },
						]
					},
					{ key: 'result', label: 'Result', type: 'text', placeholder: 'Result value' },
					{ key: 'units', label: 'Units', type: 'text', placeholder: 'e.g., mg/dL' },
					{ key: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
				],
			},
		],
	},
	immunizations: {
		tabKey: 'immunizations',
		sections: [
			{
				key: 'imm', title: 'Immunization', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'vaccineName', label: 'Vaccine Name', type: 'text', required: true, placeholder: 'Vaccine name' },
					{ key: 'cvxCode', label: 'Vaccine CVX Code', type: 'code-search', placeholder: 'Search CVX codes', lookupConfig: { system: 'CVX' } },
					{ key: 'administeredDate', label: 'Date Administered', type: 'date', required: true },
					{ key: 'lotNumber', label: 'Lot Number', type: 'text', required: true, placeholder: 'Lot #' },
					{ key: 'dose', label: 'Dose', type: 'text', required: true, placeholder: 'e.g., 0.5 mL' },
					{ key: 'route', label: 'Route', type: 'text', placeholder: 'e.g., IM' },
					{ key: 'site', label: 'Site', type: 'text', placeholder: 'e.g., Left deltoid' },
					{ key: 'manufacturer', label: 'Manufacturer', type: 'text' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Completed', value: 'completed' },
							{ label: 'Entered in Error', value: 'entered-in-error' },
							{ label: 'Not Done', value: 'not-done' },
						]
					},
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
					{ key: 'cptCode', label: 'CPT Code', type: 'code-search', placeholder: 'Search CPT code', lookupConfig: { system: 'CPT' } },
					{ key: 'datePerformed', label: 'Date Performed', type: 'date', required: true },
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
							{ label: 'Cancelled', value: 'cancelled' },
							{ label: 'Draft', value: 'draft' },
							{ label: 'Entered in Error', value: 'entered-in-error' },
						]
					},
					{
						key: 'payerName', label: 'Insurance Company / Payer', type: 'select', required: true, options: [
							{ label: 'Aetna', value: 'Aetna' },
							{ label: 'Anthem Blue Cross', value: 'Anthem Blue Cross' },
							{ label: 'Blue Cross Blue Shield', value: 'Blue Cross Blue Shield' },
							{ label: 'Cigna', value: 'Cigna' },
							{ label: 'Humana', value: 'Humana' },
							{ label: 'Kaiser Permanente', value: 'Kaiser Permanente' },
							{ label: 'Medicaid', value: 'Medicaid' },
							{ label: 'Medicare', value: 'Medicare' },
							{ label: 'Molina Healthcare', value: 'Molina Healthcare' },
							{ label: 'Oscar Health', value: 'Oscar Health' },
							{ label: 'UnitedHealthcare', value: 'UnitedHealthcare' },
							{ label: 'Tricare', value: 'Tricare' },
							{ label: 'Centene', value: 'Centene' },
							{ label: 'Wellcare', value: 'Wellcare' },
							{ label: 'Ambetter', value: 'Ambetter' },
							{ label: 'Bright Health', value: 'Bright Health' },
							{ label: 'Clover Health', value: 'Clover Health' },
							{ label: 'Friday Health Plans', value: 'Friday Health Plans' },
							{ label: 'WellPoint', value: 'WellPoint' },
						]
					},
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
					{ key: 'policyNumber', label: 'Policy / Member ID', type: 'text', required: true, placeholder: 'Member ID' },
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
						key: 'subscriberGender', label: 'Subscriber Sex', type: 'select', options: [
							{ label: 'Male', value: 'male' },
							{ label: 'Female', value: 'female' },
							{ label: 'Other', value: 'other' },
						], showWhen: { field: 'subscriberRelationship', notEquals: 'self' }
					},
					{ key: 'subscriberSSN', label: 'Subscriber SSN', type: 'text', placeholder: 'XXX-XX-XXXX', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
					{ key: 'subscriberPhone', label: 'Subscriber Phone', type: 'phone', showWhen: { field: 'subscriberRelationship', notEquals: 'self' } },
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
					{ key: 'authorName', label: 'Author / Provider', type: 'text', placeholder: 'Author name' },
					{ key: 'encounterId', label: 'Encounter ID', type: 'text', placeholder: 'Optional' },
					{ key: 'fileUrl', label: 'File URL', type: 'text', placeholder: 'https://... or storage key', colSpan: 2 },
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
				key: 'details', title: 'Education Assignment', columns: 3, visible: true, collapsible: false, fields: [
					// materialId picks an existing material from the catalog. The backend's
					// PatientEducationService.assign requires it (else "id must not be null").
					{ key: 'materialId', label: 'Education Material', type: 'lookup', required: true, placeholder: 'Search materials…', lookupConfig: { endpoint: '/api/education/materials', displayField: 'title', valueField: 'id' } },
					{ key: 'materialTitle', label: 'Material Title', type: 'text', required: false, placeholder: 'Auto-filled from material' },
					{
						key: 'materialCategory', label: 'Category', type: 'select', options: [
							{ label: 'Disease Management', value: 'disease-management' },
							{ label: 'Medication', value: 'medication' },
							{ label: 'Procedure', value: 'procedure' },
							{ label: 'Wellness', value: 'wellness' },
							{ label: 'Nutrition', value: 'nutrition' },
							{ label: 'Post-Op Care', value: 'post-op' },
							{ label: 'Other', value: 'other' },
						]
					},
					{
						key: 'materialContentType', label: 'Content Type', type: 'select', options: [
							{ label: 'Article', value: 'article' },
							{ label: 'Video', value: 'video' },
							{ label: 'PDF', value: 'pdf' },
							{ label: 'Handout', value: 'handout' },
							{ label: 'Link', value: 'link' },
						]
					},
					{ key: 'assignedBy', label: 'Assigned By', type: 'text', placeholder: 'Provider name' },
					{ key: 'assignedDate', label: 'Assigned Date', type: 'date', required: true },
					{ key: 'dueDate', label: 'Due Date', type: 'date' },
					{
						key: 'status', label: 'Status', type: 'select', required: true, options: [
							{ label: 'Assigned', value: 'assigned' },
							{ label: 'Viewed', value: 'viewed' },
							{ label: 'Completed', value: 'completed' },
							{ label: 'Dismissed', value: 'dismissed' },
						]
					},
					{ key: 'encounterId', label: 'Encounter ID', type: 'text', placeholder: 'Optional' },
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Notes', colSpan: 3 },
					{ key: 'patientFeedback', label: 'Patient Feedback', type: 'textarea', placeholder: 'Feedback from the patient', colSpan: 3 },
				],
			},
		],
	},
	messaging: {
		tabKey: 'messaging',
		sections: [
			{
				key: 'details', title: 'Message', columns: 2, visible: true, collapsible: false, fields: [
					{ key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Message subject' },
					{ key: 'recipientName', label: 'To', type: 'text', required: true, placeholder: 'Recipient name or role' },
					{ key: 'senderName', label: 'From', type: 'text', placeholder: 'Sender name' },
					{
						key: 'priority', label: 'Priority', type: 'select', options: [
							{ label: 'Normal', value: 'normal' },
							{ label: 'High', value: 'high' },
							{ label: 'Urgent', value: 'urgent' },
						]
					},
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Draft', value: 'draft' },
							{ label: 'Sent', value: 'sent' },
							{ label: 'Read', value: 'read' },
							{ label: 'Archived', value: 'archived' },
						]
					},
					{ key: 'sentAt', label: 'Sent At', type: 'date' },
					{ key: 'content', label: 'Message', type: 'textarea', required: true, placeholder: 'Enter your message', colSpan: 2 },
				],
			},
		],
	},
	relationships: {
		tabKey: 'relationships',
		sections: [
			{
				key: 'details', title: 'Related Person', columns: 3, visible: true, collapsible: false, fields: [
					{ key: 'firstName', label: 'First Name', type: 'text', required: true, placeholder: 'First name' },
					{ key: 'lastName', label: 'Last Name', type: 'text', required: true, placeholder: 'Last name' },
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
					{ key: 'phoneNumber', label: 'Phone', type: 'phone' },
					{ key: 'email', label: 'Email', type: 'email' },
					{ key: 'address', label: 'Address', type: 'textarea', colSpan: 2 },
					{ key: 'emergencyContact', label: 'Emergency Contact', type: 'boolean' },
					{ key: 'active', label: 'Active', type: 'boolean' },
					{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes', colSpan: 3 },
				],
			},
		],
	},
	appointments: {
		tabKey: 'appointments',
		sections: [
			{
				key: 'appt', title: 'Appointment Details', columns: 2, visible: true, collapsible: false, fields: [
					{
						key: 'appointmentType', label: 'Visit Type', type: 'select', required: true, options: [
							{ label: 'Consultation', value: 'Consultation' },
							{ label: 'New Patient', value: 'New Patient' },
							{ label: 'Follow-Up', value: 'Follow-Up' },
							{ label: 'Annual Physical', value: 'Annual Physical' },
							{ label: 'Sick Visit', value: 'Sick Visit' },
							{ label: 'Telehealth', value: 'Telehealth' },
							{ label: 'Procedure', value: 'Procedure' },
							{ label: 'Lab Work', value: 'Lab Work' },
						]
					},
					{
						key: 'priority', label: 'Priority', type: 'select', options: [
							{ label: 'Routine', value: 'Routine' },
							{ label: 'Urgent', value: 'Urgent' },
						]
					},
					{ key: 'start', label: 'Start Date/Time', type: 'datetime', required: true },
					{ key: 'end', label: 'End Date/Time', type: 'datetime', required: true },
					{ key: 'providerId', label: 'Provider', type: 'text', placeholder: 'Search Provider', required: true },
					{ key: 'locationId', label: 'Location', type: 'text', placeholder: 'Search Location', required: true },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Scheduled', value: 'Scheduled' },
							{ label: 'Confirmed', value: 'Confirmed' },
							{ label: 'Checked-in', value: 'Checked-in' },
							{ label: 'Completed', value: 'Completed' },
							{ label: 'Re-Scheduled', value: 'Re-Scheduled' },
							{ label: 'No Show', value: 'No Show' },
							{ label: 'Cancelled', value: 'Cancelled' },
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
					{ key: 'authorName', label: 'Author', type: 'text', placeholder: 'Search Author' },
					{
						key: 'status', label: 'Status', type: 'select', options: [
							{ label: 'Current', value: 'current' },
							{ label: 'Superseded', value: 'superseded' },
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
					{ key: 'phone', label: 'Phone', type: 'phone' },
					{ key: 'fax', label: 'Fax', type: 'phone' },
					{ key: 'email', label: 'Email', type: 'email' },
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
	private quickInfo: QuickInfo = { allergies: '…', problems: '…', medications: '…', history: '…', vitals: '…' };
	private readonly _configHome: URI;
	private readonly _tabDataCache = new Map<string, { config: FieldConfig | null; data: Record<string, unknown>[] }>();
	private readonly _tabNavMap = new Map<string, HTMLElement>();
	private readonly _tabCountEls = new Map<string, HTMLElement>();
	private readonly _tabCounts = new Map<string, number>();
	/** Page index per list-tab; persists across renders so filter changes feel stable. */
	private readonly _listPage = new Map<string, number>();
	private readonly _quickInfoValEls = new Map<string, HTMLElement>();

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
	) {
		super(PatientChartEditor.ID, group, telemetryService, themeService, storageSvc);
		this._configHome = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex');
		this.sidebarCollapsed = this.storageSvc.getBoolean(SIDEBAR_COLLAPSED_KEY, StorageScope.PROFILE, false);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-patient-chart'));
		// position:relative so absolute-positioned overlays (record dialog) anchor to this pane
		this.root.style.cssText = 'position:relative;height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header bar
		this.headerBar = DOM.append(this.root, DOM.$('.chart-header'));
		this.headerBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;align-items:center;gap:10px;background:var(--vscode-editor-background);';

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
		this._tabNavMap.clear();
		this._quickInfoValEls.clear();
		// Initial-tab override (e.g. appointment row "Record Vitals" lands on the
		// vitals tab) takes precedence over the persisted last-visited tab.
		this.activeTab = input.initialTab
			|| this.storageSvc.get(LAST_TAB_KEY_PREFIX + this.patientId, StorageScope.PROFILE, 'dashboard');

		// Kick off Quick Info immediately — its 5 fetches run in parallel with
		// the layout/patient loads below, and each row updates its DOM cell
		// independently as soon as its own response lands.
		const quickInfoPromise = this._loadQuickInfo();

		await Promise.all([this._loadLayout(), this._loadPatient()]);
		if (token.isCancellationRequested) { return; }

		this._renderHeader();
		this._renderSidebar();
		this._renderMain();
		// Tie the quick-info promise back so a re-entrant setInput awaits it.
		void quickInfoPromise;
	}

	override clearInput(): void {
		this._tabDataCache.clear();
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
		this.categories = Array.from(byKey.values())
			.sort((a, b) => a.position - b.position)
			.map(cat => ({ ...cat, tabs: cat.tabs.filter(t => t.visible !== false).sort((a, b) => a.position - b.position) }));
	}

	private async _loadPatient(): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/patients/${this.patientId}`);
			if (res.ok) { this.patientData = (await res.json())?.data || {}; }
		} catch { /* */ }
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
		//   problems     → was 'medicalproblems'   (backend has 'problem-list')
		// Identity mappings are no-ops; only list real overrides.
		'problems': 'problem-list',
		'submissions': 'claim-submissions',
		'denials': 'claim-denials',
		'labs': 'lab-results',
		'payment': 'payments',
		// FHIR collection slugs → backend tab keys (common chart-layout.json typos)
		'related-persons': 'relationships',
		'allergy-intolerances': 'allergies',
		'medication-requests': 'medications',
		'diagnostic-reports': 'lab-results',
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

	// Some endpoints aren't patient-scoped (e.g. /api/locations) — don't append /patient/{id}.
	private _isPatientScoped(tab: ChartTab): boolean {
		// Tabs that pull from org-level collections
		const orgLevelTabs = new Set(['facility']);
		if (orgLevelTabs.has(tab.key)) { return false; }
		return true;
	}

	private async _loadTabData(tab: ChartTab): Promise<{ config: FieldConfig | null; data: Record<string, unknown>[] }> {
		const cached = this._tabDataCache.get(tab.key);
		if (cached) { return cached; }
		let config: FieldConfig | null = null;
		let data: Record<string, unknown>[] = [];

		// Field config priority:
		// 1. Backend /api/tab-field-config/{tabKey} (authoritative — matches EHR-UI behavior, ensures
		//    form keys map to the same FHIR paths the backend's create/update use).
		// 2. ~/.ciyex/fields/{tabKey}.json (user override).
		// 3. Built-in DEFAULT_FIELD_CONFIGS (offline fallback).
		const backendSlug = PatientChartEditor.TAB_API_SLUG[tab.key] || tab.key;
		try {
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

		// apiPath override (e.g. /api/cds/alerts, /api/payments/transactions) — query string safe.
		// If apiPath contains {patientId}, substitute; otherwise append /patient/{id} for patient-scoped endpoints.
		// Non-patient-scoped endpoints (facility/locations) should use {patientId}-free path as-is.
		if (tab.apiPath) {
			let url: string;
			if (tab.apiPath.includes('{patientId}')) {
				url = tab.apiPath.replace('{patientId}', this.patientId);
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

		// FHIR-backed list: hit /api/fhir-resource/{tabKey}/patient/{id}. Backend resolves
		// the resource type from tab_field_config keyed by tabKey.
		if (tab.fhirResources.length > 0 && !tab.apiPath) {
			const slug = PatientChartEditor.TAB_API_SLUG[tab.key] || tab.key;
			const url = `/api/fhir-resource/${slug}/patient/${this.patientId}?page=0&size=100`;
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
		const result = { config, data };
		this._tabDataCache.set(tab.key, result);
		return result;
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
		run('allergies', `/api/allergy-intolerances/${this.patientId}`, 'allergiesList', 'NKA');
		run('problems', `/api/medical-problems/${this.patientId}`, 'problemsList', 'None');
		run('medications', `/api/fhir-resource/medications/patient/${this.patientId}?page=0&size=1`, undefined, 'None');
		run('history', `/api/fhir-resource/history/patient/${this.patientId}?page=0&size=1`, undefined, 'No records');
		run('vitals', `/api/fhir-resource/vitals/patient/${this.patientId}?page=0&size=1`, undefined, 'No recorded vitals');
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
		back.style.cssText = 'background:transparent;border:none;color:var(--vscode-foreground);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;';
		back.addEventListener('mouseenter', () => { back.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
		back.addEventListener('mouseleave', () => { back.style.background = 'transparent'; });
		back.addEventListener('click', () => { this.group.closeEditor(this.input!); });

		// Name
		const nameEl = DOM.append(this.headerBar, DOM.$('span'));
		nameEl.textContent = name;
		nameEl.style.cssText = 'font-size:14px;font-weight:700;color:var(--vscode-foreground);';

		// MRN pill
		if (mrn) {
			const pill = DOM.append(this.headerBar, DOM.$('span'));
			pill.textContent = `MRN: ${mrn}`;
			pill.style.cssText = 'font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(59,130,246,0.12);color:#3b82f6;';
		}

		// DOB + age
		if (dobRaw) {
			const dobStr = this._formatDate(dobRaw);
			const age = this._calculateAge(dobRaw);
			const el = DOM.append(this.headerBar, DOM.$('span'));
			el.textContent = `DOB: ${dobStr}${age ? ` (${age})` : ''}`;
			el.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}
		if (gender) {
			const el = DOM.append(this.headerBar, DOM.$('span'));
			el.textContent = `Sex: ${gender}`;
			el.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}
		if (phone) {
			const el = DOM.append(this.headerBar, DOM.$('span'));
			el.textContent = phone;
			el.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}

		// Status pill
		const statusPill = DOM.append(this.headerBar, DOM.$('span'));
		statusPill.textContent = status;
		const statusColor = status === 'Active' ? '#22c55e' : status === 'Inactive' ? '#ef4444' : '#f59e0b';
		statusPill.style.cssText = `font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;background:${statusColor}20;color:${statusColor};`;

		// Spacer
		DOM.append(this.headerBar, DOM.$('span')).style.flex = '1';

		// Action buttons
		const newEnc = DOM.append(this.headerBar, DOM.$('button'));
		newEnc.textContent = '+ New Encounter';
		newEnc.style.cssText = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
		newEnc.addEventListener('click', () => this._openNewEncounter());

		const schedBtn = DOM.append(this.headerBar, DOM.$('button'));
		schedBtn.textContent = '\u{1F4C5} Schedule Appointment';
		schedBtn.style.cssText = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);';
		schedBtn.addEventListener('click', () => this._navigate('appointments'));
	}

	// --- Sidebar ---

	private _renderSidebar(): void {
		DOM.clearNode(this.sidebarEl);
		this._tabNavMap.clear();
		this._tabCountEls.clear();
		this._quickInfoValEls.clear();

		// CHART heading with collapse button
		const chartHdr = DOM.append(this.sidebarEl, DOM.$('div'));
		chartHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;';

		const chartLabel = DOM.append(chartHdr, DOM.$('span'));
		chartLabel.textContent = 'CHART';
		chartLabel.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';

		const collapseBtn = DOM.append(chartHdr, DOM.$('button'));
		collapseBtn.textContent = this.sidebarCollapsed ? '>' : '<';
		collapseBtn.title = this.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
		collapseBtn.style.cssText = 'background:transparent;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:10px;padding:2px 6px;border-radius:3px;';
		collapseBtn.addEventListener('click', () => this._toggleSidebar());

		if (this.sidebarCollapsed) {
			this.sidebarEl.style.width = '48px';
			return;
		}
		this.sidebarEl.style.width = '240px';

		// QUICK INFO section
		const qiHeader = DOM.append(this.sidebarEl, DOM.$('div'));
		qiHeader.textContent = 'QUICK INFO';
		qiHeader.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);padding:4px 14px 6px;';

		const qiBlock = DOM.append(this.sidebarEl, DOM.$('div'));
		qiBlock.style.cssText = 'padding:0 10px 12px;display:flex;flex-direction:column;gap:4px;';
		this._renderQuickInfoRow(qiBlock, 'allergies', '\u{1F6A8}', 'Allergies', this.quickInfo.allergies);
		this._renderQuickInfoRow(qiBlock, 'problems', '\u{1F90D}', 'Problems', this.quickInfo.problems);
		this._renderQuickInfoRow(qiBlock, 'medications', '\u{1F48A}', 'Medications', this.quickInfo.medications);
		this._renderQuickInfoRow(qiBlock, 'history', '\u{1F4DC}', 'History', this.quickInfo.history);
		this._renderQuickInfoRow(qiBlock, 'vitals', '\u{1FAC0}', 'Vitals', this.quickInfo.vitals);

		// Category tabs
		for (const cat of this.categories) {
			if (cat.tabs.length === 0) { continue; }

			const catHdr = DOM.append(this.sidebarEl, DOM.$('div'));
			catHdr.textContent = cat.label.toUpperCase();
			catHdr.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);padding:14px 14px 6px;';

			for (const tab of cat.tabs) {
				const item = DOM.append(this.sidebarEl, DOM.$('div'));
				item.setAttribute('data-tab', tab.key);
				item.style.cssText = 'padding:6px 14px 6px 20px;cursor:pointer;color:var(--vscode-foreground);display:flex;align-items:center;gap:8px;font-size:13px;border-left:2px solid transparent;';

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
				if (!url) { continue; }
				fetches.push((async () => {
					try {
						const res = await this.apiService.fetch(url);
						if (!res.ok) { return; }
						const json = await res.json();
						const total = json?.data?.totalElements ?? json?.totalElements
							?? (Array.isArray(json?.data?.content) ? json.data.content.length : (Array.isArray(json?.data) ? json.data.length : 0));
						const count = typeof total === 'number' ? total : 0;
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
		if (tab.apiPath) {
			if (tab.apiPath.includes('{patientId}')) {
				const base = tab.apiPath.replace('{patientId}', this.patientId);
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
		row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;font-size:12px;';

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
			el.style.borderLeftColor = isActive ? 'var(--vscode-focusBorder, #007acc)' : 'transparent';
			el.style.background = isActive ? 'var(--vscode-list-activeSelectionBackground, rgba(0,120,212,0.15))' : '';
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
		viewAll.textContent = 'View all →';
		viewAll.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		viewAll.addEventListener('click', () => this._navigate('appointments'));

		const upBox = DOM.append(upcoming, DOM.$('div'));
		upBox.style.cssText = 'background:var(--vscode-editor-background);border:1px dashed var(--vscode-editorWidget-border);border-radius:6px;padding:24px;text-align:center;';
		const upIcon = DOM.append(upBox, DOM.$('div'));
		upIcon.textContent = '\u{1F4C5}';
		upIcon.style.cssText = 'font-size:28px;margin-bottom:6px;';
		const upText = DOM.append(upBox, DOM.$('div'));
		upText.textContent = 'View upcoming appointments';
		upText.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:8px;';
		const goLink = DOM.append(upBox, DOM.$('a'));
		goLink.textContent = 'Go to Appointments →';
		goLink.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		goLink.addEventListener('click', () => this._navigate('appointments'));

		void this._loadRecentActivity(recentList);

		// Summary cards grid
		const cardsGrid = DOM.append(this.mainEl, DOM.$('div'));
		cardsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:16px;';
		this._renderSummaryCard(cardsGrid, 'allergies', '\u{1F6E1}\u{FE0F}', 'Allergies', 'AllergyIntolerance', 'allergyName', 'NKA — No Known Allergies');
		this._renderSummaryCard(cardsGrid, 'problems', '\u{1F90D}', 'Medical Problems', 'Condition', 'code', 'No problems recorded');
		this._renderSummaryCard(cardsGrid, 'insurance', '\u{1F512}', 'Insurance', 'Coverage', 'payerName', 'No insurance on file');
		this._renderPortalAccountCard(cardsGrid);
	}

	private async _loadRecentActivity(parent: HTMLElement): Promise<void> {
		interface ActivityItem { title: string; description: string; timestamp: string; sortKey: number; status: string; emoji: string }
		const acts: ActivityItem[] = [];

		// Fetch the most recent N records from each resource in parallel.
		// We merge them into a single timeline, sorted newest-first.
		const sources: Array<{ ep: string; emoji: string; build: (it: Record<string, unknown>) => ActivityItem | null }> = [
			{
				ep: `${FHIR_MAP['Appointment']}/patient/${this.patientId}?page=0&size=5`,
				emoji: '\u{1F4C5}',
				build: (a) => ({
					title: `Appointment: ${String(a.visitType || a.appointmentType || 'Visit')}`,
					description: String(a.appointmentStartTime || this._formatDate(a.appointmentStartDate) || ''),
					timestamp: this._formatDate(a.appointmentStartDate) || '',
					sortKey: this._toEpoch(a.appointmentStartDate),
					status: String(a.status || 'scheduled'),
					emoji: '\u{1F4C5}',
				}),
			},
			{
				ep: `${FHIR_MAP['Encounter']}/patient/${this.patientId}?page=0&size=5`,
				emoji: '\u{1F4CB}',
				build: (e) => ({
					title: `Encounter: ${String(e.visitType || e.type || 'Visit')}`,
					description: String(e.providerName || e.practitionerName || ''),
					timestamp: this._formatDate(e.startDate || e.start) || '',
					sortKey: this._toEpoch(e.startDate || e.start),
					status: String(e.status || ''),
					emoji: '\u{1F4CB}',
				}),
			},
			{
				ep: `${FHIR_MAP['AllergyIntolerance']}/patient/${this.patientId}?page=0&size=5`,
				emoji: '\u{1F6A8}',
				build: (a) => ({
					title: `Allergy: ${String(a.allergyName || '')}`,
					description: String(a.reaction || a.severity || ''),
					timestamp: this._formatDate(a.startDate || a.recordedDate) || '',
					sortKey: this._toEpoch(a.startDate || a.recordedDate),
					status: String(a.status || 'active'),
					emoji: '\u{1F6A8}',
				}),
			},
			{
				ep: `${FHIR_MAP['Condition']}/patient/${this.patientId}?page=0&size=5`,
				emoji: '\u{26A0}\u{FE0F}',
				build: (c) => ({
					title: `Problem: ${String(c.condition || c.code || '')}`,
					description: String(c.severity || ''),
					timestamp: this._formatDate(c.onsetDate || c.recordedDate) || '',
					sortKey: this._toEpoch(c.onsetDate || c.recordedDate),
					status: String(c.clinicalStatus || c.status || ''),
					emoji: '\u{26A0}\u{FE0F}',
				}),
			},
			{
				ep: `${FHIR_MAP['MedicationRequest']}/patient/${this.patientId}?page=0&size=5`,
				emoji: '\u{1F48A}',
				build: (m) => ({
					title: `Medication: ${String(m.medicationName || '')}`,
					description: String(m.dosage || ''),
					timestamp: this._formatDate(m.startDate || m.authoredOn) || '',
					sortKey: this._toEpoch(m.startDate || m.authoredOn),
					status: String(m.status || ''),
					emoji: '\u{1F48A}',
				}),
			},
		];

		const renderRow = (act: ActivityItem): void => {
			const row = DOM.append(parent, DOM.$('div'));
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

		const repaint = (): void => {
			DOM.clearNode(parent);
			acts.sort((a, b) => b.sortKey - a.sortKey);
			const top = acts.slice(0, 8);
			if (top.length === 0) { return; }
			for (const act of top) { renderRow(act); }
		};

		// Each source paints its rows as soon as its fetch returns; we no longer
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
				if (added) { repaint(); }
			} catch { /* ignore source */ }
		});

		await Promise.allSettled(tasks);
		// Final repaint: if every source returned 0 items, show the empty state.
		if (acts.length === 0) {
			DOM.clearNode(parent);
			const empty = DOM.append(parent, DOM.$('div'));
			empty.textContent = 'No recent activity';
			empty.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;padding:8px 0;';
		}
	}

	private _renderSummaryCard(parent: HTMLElement, _key: string, icon: string, title: string, resource: string, displayField: string, emptyMsg: string): void {
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
		const tabKey = title === 'Allergies' ? 'allergies' : title === 'Medical Problems' ? 'problems' : 'insurance';
		viewAll.addEventListener('click', () => this._navigate(tabKey));

		const body = DOM.append(card, DOM.$('div'));
		body.setAttribute('data-card-body', resource);
		body.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);min-height:40px;';
		body.textContent = 'Loading...';

		void (async () => {
			try {
				const ep = FHIR_MAP[resource] || `/api/fhir-resource/${resource.toLowerCase()}s`;
				const res = await this.apiService.fetch(`${ep}/patient/${this.patientId}?page=0&size=3`);
				if (res.ok) {
					const json = await res.json();
					const items: Record<string, unknown>[] = json?.data?.content || json?.content || [];
					DOM.clearNode(body);
					if (items.length === 0) {
						body.textContent = emptyMsg;
						return;
					}
					for (const item of items.slice(0, 3)) {
						const row = DOM.append(body, DOM.$('div'));
						row.style.cssText = 'padding:3px 0;font-size:12px;color:var(--vscode-foreground);';
						const v = item[displayField];
						let text: string;
						if (v && typeof v === 'object') {
							const obj = v as Record<string, unknown>;
							text = String(obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.display || JSON.stringify(v).substring(0, 40));
						} else {
							text = String(v || item.name || item.code || '—');
						}
						row.textContent = text.substring(0, 50);
					}
				} else {
					body.textContent = emptyMsg;
				}
			} catch {
				body.textContent = emptyMsg;
			}
		})();
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
			const initialRecord = data.length > 0 ? data : [{}];
			this._renderForm(content, config.sections, initialRecord);

			const primaryBtnStyle = 'padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
			const secondaryBtnStyle = 'padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);';

			const setReadOnly = (readOnly: boolean) => {
				for (const el of this._formInputs.values()) {
					if (DOM.isHTMLInputElement(el) && el.type === 'checkbox') {
						el.disabled = readOnly;
					} else if (el.tagName === 'SELECT') {
						(el as HTMLSelectElement).disabled = readOnly;
					} else {
						(el as HTMLInputElement | HTMLTextAreaElement).readOnly = readOnly;
					}
					el.style.opacity = readOnly ? '0.75' : '1';
					el.style.cursor = readOnly ? 'not-allowed' : '';
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
				for (const [k, el] of this._formInputs) {
					const v = snap.get(k);
					if (DOM.isHTMLInputElement(el) && el.type === 'checkbox') { el.checked = !!v; }
					else { el.value = String(v ?? ''); }
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
				await this._saveFormTab(tab, saveBtn);
				setReadOnly(true);
				editBtn.style.display = '';
				saveBtn.style.display = 'none';
				cancelBtn.style.display = 'none';
			});
		} else {
			// List tab: show "+ Add" unless the tab is read-only (ledgers, system reports, etc.).
			if (!tab.readOnly) {
				const addBtn = DOM.append(actionSlot, DOM.$('button'));
				addBtn.textContent = '+ Add';
				addBtn.style.cssText = 'padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
				addBtn.addEventListener('click', () => this._openAddRecordDialog(tab, config));
			}

			this._renderListWithFilters(content, tab, config, data);
		}
	}

	// Status filter options per tab — different resources use different status vocabularies.
	private _statusFilterOptions(tab: ChartTab): Array<{ label: string; value: string }> {
		switch (tab.key) {
			case 'documents':
			case 'visit-notes':
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Current', value: 'current' },
					{ label: 'Superseded', value: 'superseded' },
					{ label: 'Entered in Error', value: 'entered-in-error' },
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
					{ label: 'Active', value: 'active' },
					{ label: 'On Hold', value: 'on-hold' },
					{ label: 'Stopped', value: 'stopped' },
					{ label: 'Completed', value: 'completed' },
				];
			case 'billing':
			case 'claims':
			case 'denials':
				return [
					{ label: 'All Statuses', value: '' },
					{ label: 'Draft', value: 'draft' },
					{ label: 'Active', value: 'active' },
					{ label: 'Cancelled', value: 'cancelled' },
					{ label: 'Paid', value: 'paid' },
					{ label: 'Denied', value: 'denied' },
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

	// List tab render: search + clinical-status filter + table, all applied client-side.
	private _renderListWithFilters(container: HTMLElement, tab: ChartTab, config: FieldConfig | null, data: Record<string, unknown>[]): void {
		const inputStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';

		const filterBar = DOM.append(container, DOM.$('div'));
		filterBar.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;';

		const searchInput = DOM.append(filterBar, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = `Search by ${tab.label}...`;
		searchInput.style.cssText = inputStyle + 'flex:1;min-width:200px;max-width:320px;';

		const statusSel = DOM.append(filterBar, DOM.$('select')) as HTMLSelectElement;
		statusSel.style.cssText = inputStyle + 'cursor:pointer;min-width:180px;';
		// Status options differ by tab; fall back to clinical values for everything else
		const filterOpts = this._statusFilterOptions(tab);
		for (const opt of filterOpts) {
			const o = DOM.append(statusSel, DOM.$('option')) as HTMLOptionElement;
			o.value = opt.value; o.textContent = opt.label;
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
			const st = statusSel.value;
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
				if (data.length === 0) {
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
		statusSel.addEventListener('change', applyFilters);
		applyFilters();
	}

	private async _saveFormTab(tab: ChartTab, btn: HTMLButtonElement): Promise<void> {
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
			return;
		}

		btn.disabled = true;
		const prev = btn.textContent;
		btn.textContent = 'Saving...';
		try {
			// Demographics → /api/patients/{id}, others → FHIR generic endpoint
			const isDemographics = tab.fhirResources.includes('Patient');
			const ep = this._tabEndpoint(tab);
			const path = isDemographics
				? `/api/patients/${this.patientId}`
				: `${(ep || '').split('?')[0]}/patient/${this.patientId}`;
			const res = await this.apiService.fetch(path, { method: 'PUT', body: JSON.stringify(payload) });
			if (res.ok) {
				this.notificationService.info(`${tab.label} saved`);
				this._tabDataCache.delete(tab.key);
				if (isDemographics) {
					await this._loadPatient();
					this._renderHeader();
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
	}

	private _openAddRecordDialog(tab: ChartTab, config: FieldConfig | null): void {
		this._openRecordDialog(tab, config, null);
	}

	private _openRecordDialog(tab: ChartTab, config: FieldConfig | null, existing: Record<string, unknown> | null): void {
		const isEdit = !!existing;
		const recordId = existing ? String(existing.id || existing.fhirId || '') : '';

		// Overlay + panel
		const overlay = DOM.append(this.root, DOM.$('div'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:200;display:flex;justify-content:flex-end;';
		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';
		backdrop.addEventListener('click', () => overlay.remove());

		const panel = DOM.append(overlay, DOM.$('div'));
		// Flex column so the footer (Save/Cancel) stays pinned at the bottom even when the form is tall.
		panel.style.cssText = 'position:relative;width:540px;max-width:95vw;height:100%;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border);display:flex;flex-direction:column;z-index:1;';

		const hdrRow = DOM.append(panel, DOM.$('div'));
		hdrRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:20px 20px 12px;flex-shrink:0;';
		const hdrTitle = DOM.append(hdrRow, DOM.$('h3'));
		hdrTitle.textContent = isEdit ? `Edit ${tab.label}` : `New ${tab.label}`;
		hdrTitle.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(hdrRow, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;color:var(--vscode-foreground);';
		closeBtn.addEventListener('click', () => overlay.remove());

		// Scrollable form area — only the form scrolls; the footer buttons stay visible.
		const formContainer = DOM.append(panel, DOM.$('div'));
		formContainer.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:0 20px 12px;scrollbar-width:none;';

		// Save inputs to a local map (avoid clobbering the form-tab map)
		const saved = this._formInputs;
		const savedCells = this._formCells;
		this._formInputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
		this._formCells = new Map<string, HTMLElement>();

		try {
			if (config?.sections && config.sections.length > 0) {
				this._renderForm(formContainer, config.sections, [existing || {}]);
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
		// Sticky footer — flex-shrink:0 so it never collapses when the form is tall.
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;padding:14px 20px 18px;background:var(--vscode-editorWidget-background,#252526);border-top:1px solid var(--vscode-editorWidget-border);';

		// Tabs whose backend only supports create/read — no PUT/DELETE.
		// Treat them as effectively read-only on the edit dialog so we don't
		// surface buttons that lead to 405s.
		const writeOnce = new Set(['clinical-alerts']).has(tab.key);

		// Delete (edit only, and never for read-only tabs like ledgers/system reports)
		if (isEdit && recordId && !tab.readOnly && !writeOnce) {
			const delBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
			delBtn.textContent = 'Delete';
			delBtn.style.cssText = 'padding:8px 20px;background:transparent;color:#ef4444;border:1px solid #ef4444;border-radius:4px;cursor:pointer;font-size:13px;margin-right:auto;';
			delBtn.addEventListener('click', async () => {
				const ep = (this._tabEndpoint(tab) || '').split('?')[0];
				if (!ep) { return; }
				try {
					// FHIR generic controller: /api/fhir-resource/{tabKey}/patient/{id}/{recordId}
					// apiPath endpoints (non-FHIR): /{ep}/{recordId}
					const isFhir = !tab.apiPath && tab.fhirResources.length > 0;
					const delUrl = isFhir
						? `${ep}/patient/${this.patientId}/${recordId}`
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

		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:8px 20px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => overlay.remove());

		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
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
			if (missing.length > 0) {
				for (const m of missing) {
					m.el.style.borderColor = '#ef4444';
					const cell = dialogCells.get(m.key);
					if (cell) {
						const errMsg = DOM.append(cell, DOM.$('div.field-error'));
						errMsg.textContent = `${m.label} is required`;
						errMsg.style.cssText = 'color:#ef4444;font-size:11px;margin-top:3px;';
					}
				}
				const firstEl = missing[0].el;
				firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
				if (typeof (firstEl as HTMLElement).focus === 'function') { (firstEl as HTMLElement).focus(); }
				this.notificationService.warn(`Please fill in required field${missing.length > 1 ? 's' : ''}: ${missing.map(m => m.label).join(', ')}`);
				return;
			}

			const isFhir = !tab.apiPath && tab.fhirResources.length > 0;
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

			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';
			try {
				const ep = (this._tabEndpoint(tab) || '').split('?')[0];
				if (!ep) { throw new Error('No endpoint for this tab'); }
				if (tab.key === 'vitals' && !isEdit && !payload.recordedAt) {
					payload.recordedAt = new Date().toISOString();
				}
				const url = isFhir
					? (isEdit ? `${ep}/patient/${this.patientId}/${recordId}` : `${ep}/patient/${this.patientId}`)
					: (isEdit ? `${ep}/${recordId}` : ep);
				const method = isEdit ? 'PUT' : 'POST';
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
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

					const cached = this._tabDataCache.get(tab.key);
					if (cached) {
						const merged: Record<string, unknown> = { ...payload, ...(savedRecord || {}) };
						if (isEdit && recordId) {
							cached.data = cached.data.map(r => {
								const id = String(r.id ?? r.fhirId ?? '');
								return id === String(recordId) ? { ...r, ...merged } : r;
							});
						} else {
							// Ensure the optimistic row has *some* id so row-action handlers
							// don't break before the silent refresh lands.
							if (!merged.id && !merged.fhirId) { merged.id = `tmp-${Date.now()}`; }
							cached.data = [merged, ...cached.data];
						}
						this._tabDataCache.set(tab.key, cached);
					}
					if (this.activeTab === tab.key) { this._renderMain(); }

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
				const val = (record as Record<string, unknown>)[f.key] ?? '';

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
					const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
					sel.style.cssText = inputStyle + 'cursor:pointer;';
					for (const o of [{ label: `Select ${f.label}...`, value: '' }, ...(f.options || [])]) {
						const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
						opt.value = o.value; opt.textContent = o.label; opt.selected = String(val) === o.value;
					}
					this._formInputs.set(f.key, sel);
				} else if (f.type === 'boolean' || f.type === 'toggle') {
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
				} else if (f.type === 'date' || f.type === 'datetime') {
					this._buildDateInput(cell, f, String(val).split('T')[0], inputStyle);
				} else if (f.type === 'number') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'number'; inp.value = String(val); inp.placeholder = f.placeholder || '0';
					inp.style.cssText = inputStyle;
					this._formInputs.set(f.key, inp);
				} else if (f.type === 'code-search' || f.type === 'practitioner-search' || f.type === 'patient-search' || f.type === 'lookup' || f.type === 'coded') {
					this._buildSearchInput(cell, f, String(val ?? ''), inputStyle);
				} else {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
					inp.value = String(val); inp.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					inp.style.cssText = inputStyle;
					this._formInputs.set(f.key, inp);
				}

				if (f.showWhen) { conditionalFields.push({ field: f, cell }); }
			}
		}

		// Vitals: auto-calculate BMI = weight(kg) / (height(m))^2 whenever weight or height changes.
		const weightInput = this._formInputs.get('weightKg') as HTMLInputElement | undefined;
		const heightInput = this._formInputs.get('heightCm') as HTMLInputElement | undefined;
		const bmiInput = this._formInputs.get('bmi') as HTMLInputElement | undefined;
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

		// Apply showWhen conditions and attach listeners to controlling fields
		if (conditionalFields.length > 0) {
			const applyVisibility = () => {
				for (const { field, cell } of conditionalFields) {
					const when = field.showWhen!;
					const ctrl = this._formInputs.get(when.field);
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
				const ctrl = this._formInputs.get(ctrlKey);
				if (ctrl) { ctrl.addEventListener('change', applyVisibility); }
			}
			applyVisibility();
		}
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
		wrap.style.cssText = 'position:relative;display:flex;align-items:center;gap:6px;';

		const isoToUs = (iso: string): string => {
			const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
			return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
		};
		const usToIso = (us: string): string => {
			const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us);
			if (!m) { return ''; }
			const mm = m[1].padStart(2, '0');
			const dd = m[2].padStart(2, '0');
			return `${m[3]}-${mm}-${dd}`;
		};

		const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		visible.type = 'text';
		visible.placeholder = 'mm/dd/yyyy';
		visible.value = isoToUs(isoValue);
		visible.style.cssText = inputStyle + 'flex:1;';
		visible.setAttribute('inputmode', 'numeric');
		visible.maxLength = 10;

		// Hidden ISO field that gets registered with _formInputs so the saved
		// value is yyyy-mm-dd regardless of what the user typed.
		const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		hidden.type = 'hidden';
		hidden.value = isoValue || '';
		this._formInputs.set(f.key, hidden);

		const sync = () => {
			const iso = usToIso(visible.value);
			hidden.value = iso;
			visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
		};
		visible.addEventListener('input', sync);
		visible.addEventListener('blur', sync);

		// Native date picker as the calendar trigger. We hide its text part and
		// keep only the picker indicator visible — clicking opens a real
		// calendar popover that writes back to the visible mm/dd/yyyy field.
		const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		picker.type = 'date';
		picker.value = isoValue || '';
		picker.style.cssText = 'width:28px;height:32px;padding:0;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;background:var(--vscode-input-background);cursor:pointer;color-scheme:dark light;';
		picker.title = 'Open calendar';
		picker.addEventListener('change', () => {
			visible.value = isoToUs(picker.value);
			hidden.value = picker.value;
		});
	}

	/**
	 * Build a searchable dropdown that hits a lookup API, shows matching items,
	 * and stores the selected value in this._formInputs (visible label in the
	 * input; the underlying code/id stored in a hidden sibling we register as
	 * the form input). Used for ICD/CPT/LOINC/CVX codes and practitioner pickers.
	 */
	private _buildSearchInput(cell: HTMLElement, f: FieldDef, currentValue: string, inputStyle: string): void {
		const wrap = DOM.append(cell, DOM.$('div'));
		wrap.style.cssText = 'position:relative;';

		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		input.type = 'text';
		input.placeholder = f.placeholder || `Search ${f.label}...`;
		input.style.cssText = inputStyle;
		input.value = currentValue;

		// Hidden field that gets registered with _formInputs so the saved value is the
		// chosen code/id rather than free text — falls back to the typed text if nothing
		// is picked.
		const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		hidden.type = 'hidden';
		hidden.value = currentValue;
		this._formInputs.set(f.key, hidden);
		// Keep hidden in sync with raw typing so non-selected codes/names still save.
		input.addEventListener('input', () => { hidden.value = input.value; });

		const dropdown = DOM.append(wrap, DOM.$('div'));
		dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;margin-top:2px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;box-shadow:0 4px 8px rgba(0,0,0,0.3);z-index:10001;max-height:240px;overflow-y:auto;display:none;';

		let timer: ReturnType<typeof setTimeout> | undefined;
		const search = (q: string) => {
			if (timer) { clearTimeout(timer); }
			if (q.trim().length < 2) { dropdown.style.display = 'none'; return; }
			timer = setTimeout(async () => {
				try {
					const url = this._buildSearchUrl(f, q.trim());
					if (!url) { return; }
					const res = await this.apiService.fetch(url);
					if (!res.ok) { return; }
					const data = await res.json();
					const items = this._extractSearchItems(f, data);
					DOM.clearNode(dropdown);
					if (items.length === 0) {
						const empty = DOM.append(dropdown, DOM.$('div'));
						empty.textContent = 'No matches';
						empty.style.cssText = 'padding:8px 12px;color:var(--vscode-descriptionForeground);font-size:12px;';
					} else {
						for (const it of items) {
							const row = DOM.append(dropdown, DOM.$('div'));
							row.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.08);';
							const codeEl = DOM.append(row, DOM.$('span'));
							codeEl.textContent = it.code;
							codeEl.style.cssText = 'font-weight:600;margin-right:6px;color:var(--vscode-textLink-foreground);';
							const labelEl = DOM.append(row, DOM.$('span'));
							labelEl.textContent = it.label;
							labelEl.style.cssText = 'color:var(--vscode-foreground);';
							row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
							row.addEventListener('mouseleave', () => { row.style.background = ''; });
							row.addEventListener('click', () => {
								input.value = `${it.code} - ${it.label}`;
								hidden.value = it.code;
								dropdown.style.display = 'none';
							});
						}
					}
					dropdown.style.display = 'block';
				} catch { /* ignore */ }
			}, 300);
		};
		input.addEventListener('input', () => search(input.value));
		input.addEventListener('focus', () => { if (input.value.trim().length >= 2) { search(input.value); } });
		input.addEventListener('blur', () => { setTimeout(() => { dropdown.style.display = 'none'; }, 150); });
	}

	private _buildSearchUrl(f: FieldDef, q: string): string | null {
		const enc = encodeURIComponent(q);
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
				return `/api/codes/${raw}/search?q=${enc}&page=0&size=20`;
			}
			case 'practitioner-search':
				return `/api/providers?search=${enc}&page=0&size=20`;
			case 'patient-search':
				return `/api/patients?search=${enc}&page=0&size=20`;
			case 'lookup': {
				// Backend tab_field_config emits fields like:
				//   { type: "lookup", lookupConfig: { endpoint: "/api/providers", searchable: true } }
				// Forward the search through the configured endpoint.
				const ep = f.lookupConfig?.endpoint;
				if (!ep) { return null; }
				const sep = ep.includes('?') ? '&' : '?';
				return `${ep}${sep}search=${enc}&page=0&size=20`;
			}
			default:
				return null;
		}
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
				const valueField = f.lookupConfig?.valueField || 'id';
				const displayField = f.lookupConfig?.displayField || 'name';
				return arr.map(it => {
					const codeVal = String(it[valueField] ?? it.id ?? it.fhirId ?? '');
					const labelVal = String(it[displayField] ?? it.name ?? it.fullName ?? '');
					return { code: codeVal, label: labelVal || codeVal };
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

		// Honor explicit per-tab column override when provided. Otherwise auto-pick
		// up to 6 priority keys from the record sample.
		let usedKeys: string[];
		let cols: string[];
		// Per-column fallback aliases for resilient value extraction. Backend
		// resource shapes vary (e.g. encounter: encounterDate / startDate / start)
		// so a single primary key can leave the cell blank when the data is fine.
		let usedAliases: string[][] = [];
		if (tab.columns && tab.columns.length > 0) {
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

		const isEncounter = tab.fhirResources.includes('Encounter');

		// Local pagination state per-tab; reset to page 0 each time the data set changes.
		const pageSize = 20;
		const cachedPage = this._listPage.get(tab.key) || 0;
		const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
		const page = Math.min(cachedPage, totalPages - 1);
		const start = page * pageSize;
		const pageItems = data.slice(start, start + pageSize);

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
				if (v === null || v === undefined || v === '') { return ''; }
				if (typeof v === 'object') {
					const obj = v as Record<string, unknown>;
					return String(obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.display || '');
				}
				if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
					try { return new Date(v).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); } catch { /* */ }
				}
				return String(v).substring(0, 40);
			});
			// Final cell text is set by _table when onDelete is provided.
			cells.push('');

			const onClick = isEncounter
				? () => {
					const id = String(item.id || item.fhirId || '');
					this.editorService.openEditor(new EncounterFormEditorInput(this.patientId, id, this.patientName, `Encounter ${id}`), {}, SIDE_GROUP);
				}
				: () => this._openRecordDialog(tab, config, item);

			const recordId = String(item.id || item.fhirId || '');
			// Tabs whose backend only supports create/read — no PUT or DELETE — must
			// suppress the row delete handler so users don't hit 405s. Currently:
			// clinical-alerts (CDS alerts can be acknowledged but not modified/removed).
			const writeOnceTabs = new Set(['clinical-alerts']);
			const onDelete = isEncounter || !recordId || tab.readOnly || writeOnceTabs.has(tab.key)
				? undefined
				: () => this._deleteListRecord(tab, recordId);

			return { cells, onClick, onDelete };
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

	private _table(container: HTMLElement, columns: string[], rows: Array<{ cells: string[]; onClick?: () => void; onDelete?: () => void }>): void {
		const wrap = DOM.append(container, DOM.$('div'));
		wrap.style.cssText = 'overflow-x:auto;scrollbar-width:none;';
		const table = DOM.append(wrap, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';

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

	private _openNewEncounter(): void {
		this.editorService.openEditor(new EncounterFormEditorInput(this.patientId, 'new', this.patientName, 'New Encounter'), {}, SIDE_GROUP);
	}

	// --- Formatting helpers ---

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
