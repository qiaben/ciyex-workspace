/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createActionIconButton, createOverflowMenuButton, createRowActionsContainer, openRecordEditDialog, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE, IEditFieldDef } from '../sidebarActions.js';

type DataRow = Record<string, unknown> & { id?: string; fhirId?: string; patientId?: string };

type RowActionKind =
	| { kind: 'edit' }
	| { kind: 'delete'; path: (r: DataRow) => string; confirm?: string }
	| { kind: 'method'; method: 'PUT' | 'POST'; path: (r: DataRow) => string; body?: Record<string, unknown>; confirm?: string };

interface RowAction { symbol: string; label: string; color: string; action: RowActionKind }

interface ClinicalItem {
	id: string;
	icon: string;
	label: string;
	description: string;
	command: string;
	color: string;
	apiPath: string;
	titleField: string[];
	subtitleField?: string[];
	actions: RowAction[];
	/** Explicit edit-drawer schema mirroring the full editor formFields. */
	editFields?: IEditFieldDef[];
}

// Action sets per resource mirror the editor's Actions column exactly
// (clinicalEditors.ts / systemEditors.ts).

// allow-any-unicode-next-line
const CLINICAL_ITEMS: ClinicalItem[] = [
	{
		// Prescriptions: \u{270F} Edit + \u{23F9} Discontinue + Delete (clinicalEditors.ts:383)
		id: 'prescriptions',
		// allow-any-unicode-next-line
		icon: '\u{1F48A}',
		label: 'Prescriptions',
		description: 'Active Rx, refills, discontinue',
		command: 'ciyex.openPrescriptions',
		color: '#f97316',
		apiPath: '/api/prescriptions?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['medicationName', 'status'],
		editFields: [
			{ key: 'patientName', label: 'Patient Name', required: true, placeholder: 'Search patient...', widthPct: 50 },
			{ key: 'patientId', label: 'Patient ID', required: true, placeholder: 'Auto-filled from patient search', widthPct: 50 },
			{ key: 'prescriberName', label: 'Prescriber', placeholder: 'Search prescriber...', widthPct: 50 },
			{ key: 'prescriberNpi', label: 'Prescriber NPI', required: true, placeholder: '10-digit NPI', widthPct: 50 },
			{ key: 'medicationName', label: 'Medication Name', required: true, placeholder: 'e.g. Amoxicillin 500mg', widthPct: 100 },
			{ key: 'medicationCode', label: 'Medication Code', placeholder: 'e.g. NDC or RxNorm code', widthPct: 50 },
			{
				key: 'medicationSystem', label: 'Code System', kind: 'select', widthPct: 50, options: [
					{ value: '', label: 'Select...' },
					{ value: 'NDC', label: 'NDC' },
					{ value: 'RxNorm', label: 'RxNorm' },
				]
			},
			{ key: 'strength', label: 'Strength / Dosage', placeholder: '500mg', widthPct: 50 },
			{
				key: 'dosageForm', label: 'Dosage Form', kind: 'select', widthPct: 50, options: [
					{ value: '', label: 'Select...' },
					{ value: 'tablet', label: 'Tablet' }, { value: 'capsule', label: 'Capsule' },
					{ value: 'solution', label: 'Solution' }, { value: 'injection', label: 'Injection' },
					{ value: 'inhaler', label: 'Inhaler' }, { value: 'cream', label: 'Cream' },
					{ value: 'ointment', label: 'Ointment' }, { value: 'patch', label: 'Patch' },
				]
			},
			{ key: 'sig', label: 'SIG (Directions)', required: true, placeholder: 'Take 1 tablet by mouth twice daily', widthPct: 100 },
			{ key: 'quantity', label: 'Quantity', kind: 'number', placeholder: '30', widthPct: 50 },
			{ key: 'daysSupply', label: 'Days Supply', kind: 'number', placeholder: '30', widthPct: 50 },
			{ key: 'refills', label: 'Total Refills', kind: 'number', placeholder: '3', widthPct: 50 },
			{
				key: 'deaSchedule', label: 'DEA Schedule', kind: 'select', widthPct: 50, options: [
					{ value: '', label: 'Select...' },
					{ value: 'II', label: 'Schedule II' }, { value: 'III', label: 'Schedule III' },
					{ value: 'IV', label: 'Schedule IV' }, { value: 'V', label: 'Schedule V' },
				]
			},
			{ key: 'pharmacyName', label: 'Pharmacy', required: true, placeholder: 'Pharmacy name', widthPct: 50 },
			{ key: 'pharmacyPhone', label: 'Pharmacy Phone', kind: 'tel', required: true, placeholder: '(555) 123-4567', widthPct: 50 },
			{ key: 'pharmacyAddress', label: 'Pharmacy Address', placeholder: 'Pharmacy street address', widthPct: 100 },
			{
				key: 'priority', label: 'Priority', kind: 'select', widthPct: 50, options: [
					{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'stat', label: 'STAT' },
				]
			},
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' },
					{ value: 'stopped', label: 'Stopped' }, { value: 'cancelled', label: 'Cancelled' },
					{ value: 'on-hold', label: 'On Hold' },
				]
			},
			{ key: 'startDate', label: 'Start Date', kind: 'date', widthPct: 50 },
			{ key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Additional notes...', widthPct: 100 },
		],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{23F9}', label: 'Discontinue', color: '#f59e0b', action: { kind: 'method', method: 'POST', path: r => `/api/prescriptions/${r.id}/discontinue`, body: { reason: 'Discontinued from sidebar' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/prescriptions/${r.id}`, confirm: 'Delete this prescription?' } },
		],
	},
	{
		// Lab Orders: \u{270F} Edit + Update Status + Print Order + View Results + Delete (clinicalEditors.ts:539)
		id: 'labs',
		// allow-any-unicode-next-line
		icon: '\u{1F52C}',
		label: 'Lab Orders & Results',
		description: 'Order volume, status, turnaround',
		command: 'ciyex.openLabs',
		color: '#3b82f6',
		apiPath: '/api/lab-order/search?page=0&size=10',
		titleField: ['patientFirstName', 'patientName'],
		subtitleField: ['orderName', 'status'],
		editFields: [
			{ key: 'patientFirstName', label: 'Patient First Name', required: true, placeholder: 'Search patient...', widthPct: 50 },
			{ key: 'patientLastName', label: 'Patient Last Name', placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'patientId', label: 'Patient ID', kind: 'number', required: true, placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'labName', label: 'Lab Name', placeholder: 'Quest, LabCorp, etc.', widthPct: 50 },
			{ key: 'orderNumber', label: 'Order Number', required: true, placeholder: 'Auto-generated', widthPct: 50 },
			{ key: 'orderName', label: 'Order Name', placeholder: 'Order name', widthPct: 50 },
			{ key: 'testDisplay', label: 'Test Name', required: true, placeholder: 'Search LOINC test...', widthPct: 50 },
			{ key: 'testCode', label: 'Test Code (LOINC)', required: true, placeholder: 'Auto-filled', widthPct: 50 },
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' },
					{ value: 'pending', label: 'Pending' }, { value: 'completed', label: 'Completed' },
					{ value: 'cancelled', label: 'Cancelled' }, { value: 'revoked', label: 'Revoked' },
				]
			},
			{
				key: 'priority', label: 'Priority', kind: 'select', widthPct: 50, options: [
					{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'stat', label: 'STAT' },
				]
			},
			{ key: 'orderDate', label: 'Order Date', kind: 'date', widthPct: 50 },
			{ key: 'orderTime', label: 'Order Time', placeholder: 'HH:MM (24h)', widthPct: 50 },
			{ key: 'physicianName', label: 'Ordering Provider', required: true, placeholder: 'Search provider...', widthPct: 50 },
			{ key: 'specimenId', label: 'Specimen ID', placeholder: 'S-0001', widthPct: 50 },
			{
				key: 'result', label: 'Result Status', kind: 'select', widthPct: 50, options: [
					{ value: 'Pending', label: 'Pending' }, { value: 'Preliminary', label: 'Preliminary' },
					{ value: 'Partial', label: 'Partial' }, { value: 'Final', label: 'Final' },
					{ value: 'Corrected', label: 'Corrected' }, { value: 'Amended', label: 'Amended' },
				]
			},
			{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', placeholder: 'Search ICD-10 codes', widthPct: 50 },
			{ key: 'procedureCode', label: 'Procedure Code (CPT)', placeholder: 'Search CPT codes', widthPct: 50 },
			{ key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Additional notes...', widthPct: 100 },
		],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F504}', label: 'Update Status', color: '#3b82f6', action: { kind: 'method', method: 'PUT', path: r => `/api/lab-order/${r.patientId}/${r.id}/status`, body: { status: 'completed' } } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5A8}', label: 'Print Order', color: '#6b7280', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4CA}', label: 'View Results', color: '#06b6d4', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/lab-order/${r.patientId}/${r.id}`, confirm: 'Delete this lab order?' } },
		],
	},
	{
		// Immunizations: \u{270F} Edit + Delete (clinicalEditors.ts:855)
		id: 'immunizations',
		// allow-any-unicode-next-line
		icon: '\u{1F489}',
		label: 'Immunizations',
		description: 'Vaccine records, CVX codes',
		command: 'ciyex.openImmunizations',
		color: '#22c55e',
		apiPath: '/api/immunizations?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['vaccineName', 'status'],
		editFields: [
			{ key: 'patientName', label: 'Patient Name', required: true, placeholder: 'Search patient by name...', widthPct: 50 },
			{ key: 'patientId', label: 'Patient ID', required: true, placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'vaccineName', label: 'Vaccine Name', placeholder: 'Influenza, inactivated', widthPct: 50 },
			{ key: 'cvxCode', label: 'CVX Code', required: true, placeholder: 'Search CVX vaccine code...', widthPct: 50 },
			{ key: 'manufacturer', label: 'Manufacturer', placeholder: 'Pfizer', widthPct: 50 },
			{ key: 'lotNumber', label: 'Lot Number', placeholder: 'ABC123', widthPct: 50 },
			{ key: 'expirationDate', label: 'Expiration Date', kind: 'date', widthPct: 50 },
			{ key: 'administrationDate', label: 'Admin Date', kind: 'date', required: true, widthPct: 50 },
			{
				key: 'site', label: 'Site', kind: 'select', widthPct: 50, options: [
					{ value: '', label: 'Select site...' },
					{ value: 'left_arm', label: 'Left Arm' }, { value: 'right_arm', label: 'Right Arm' },
					{ value: 'left_thigh', label: 'Left Thigh' }, { value: 'right_thigh', label: 'Right Thigh' },
					{ value: 'left_deltoid', label: 'Left Deltoid' }, { value: 'right_deltoid', label: 'Right Deltoid' },
					{ value: 'left_gluteal', label: 'Left Gluteal' }, { value: 'right_gluteal', label: 'Right Gluteal' },
				]
			},
			{
				key: 'route', label: 'Route', kind: 'select', widthPct: 50, options: [
					{ value: 'IM', label: 'Intramuscular (IM)' }, { value: 'SC', label: 'Subcutaneous (SC)' },
					{ value: 'PO', label: 'Oral' }, { value: 'IN', label: 'Intranasal' }, { value: 'ID', label: 'Intradermal' },
				]
			},
			{ key: 'doseNumber', label: 'Dose Number', placeholder: 'e.g. 0.5 mL or 1', widthPct: 50 },
			{ key: 'administeredBy', label: 'Administered By', placeholder: 'Search provider...', widthPct: 50 },
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'completed', label: 'Completed' },
					{ value: 'not_done', label: 'Not Done' },
					{ value: 'entered_in_error', label: 'Entered in Error' },
				]
			},
			{ key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Additional notes...', widthPct: 100 },
		],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/immunizations/${r.id}`, confirm: 'Delete this immunization?' } },
		],
	},
	{
		// Referrals: \u{270F} Edit + Send + \u{2705} Acknowledge + Schedule + Complete + Cancel + Delete (clinicalEditors.ts:986)
		id: 'referrals',
		// allow-any-unicode-next-line
		icon: '\u{1F4CB}',
		label: 'Referrals',
		description: 'Status workflow, specialist tracking',
		command: 'ciyex.openReferrals',
		color: '#a855f7',
		apiPath: '/api/referrals?page=0&size=10',
		titleField: ['patientName'],
		subtitleField: ['specialistName', 'status'],
		editFields: [
			{ key: 'patientName', label: 'Patient Name', required: true, placeholder: 'Search patient...', widthPct: 50 },
			{ key: 'patientId', label: 'Patient ID', required: true, placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'referringProvider', label: 'Referring Provider', required: true, placeholder: 'Search provider...', widthPct: 50 },
			{ key: 'referralDate', label: 'Referral Date', kind: 'date', required: true, widthPct: 50 },
			{ key: 'specialistName', label: 'Specialist Name', required: true, widthPct: 50 },
			{ key: 'specialistNpi', label: 'Specialist NPI', placeholder: '10-digit NPI', widthPct: 50 },
			{
				key: 'specialty', label: 'Specialty', kind: 'select', widthPct: 50, options: [
					{ value: 'Allergy/Immunology', label: 'Allergy/Immunology' },
					{ value: 'Cardiology', label: 'Cardiology' }, { value: 'Dermatology', label: 'Dermatology' },
					{ value: 'Endocrinology', label: 'Endocrinology' }, { value: 'ENT', label: 'ENT' },
					{ value: 'Gastroenterology', label: 'Gastroenterology' },
					{ value: 'Geriatrics', label: 'Geriatrics' }, { value: 'Hematology', label: 'Hematology' },
					{ value: 'Infectious Disease', label: 'Infectious Disease' },
					{ value: 'Nephrology', label: 'Nephrology' }, { value: 'Neurology', label: 'Neurology' },
					{ value: 'Obstetrics/Gynecology', label: 'Obstetrics/Gynecology' },
					{ value: 'Oncology', label: 'Oncology' }, { value: 'Ophthalmology', label: 'Ophthalmology' },
					{ value: 'Orthopedics', label: 'Orthopedics' }, { value: 'Pain Management', label: 'Pain Management' },
					{ value: 'Palliative Care', label: 'Palliative Care' }, { value: 'Pathology', label: 'Pathology' },
					{ value: 'Pediatrics', label: 'Pediatrics' }, { value: 'Physical Medicine', label: 'Physical Medicine' },
					{ value: 'Plastic Surgery', label: 'Plastic Surgery' }, { value: 'Podiatry', label: 'Podiatry' },
					{ value: 'Psychiatry', label: 'Psychiatry' }, { value: 'Pulmonology', label: 'Pulmonology' },
					{ value: 'Radiology', label: 'Radiology' }, { value: 'Rheumatology', label: 'Rheumatology' },
					{ value: 'Sports Medicine', label: 'Sports Medicine' }, { value: 'Surgery', label: 'Surgery' },
					{ value: 'Urology', label: 'Urology' }, { value: 'Vascular Surgery', label: 'Vascular Surgery' },
					{ value: 'Other', label: 'Other' },
				]
			},
			{ key: 'facilityName', label: 'Facility Name', required: true, widthPct: 50 },
			{ key: 'facilityAddress', label: 'Facility Address', placeholder: 'Street address', widthPct: 100 },
			{ key: 'facilityPhone', label: 'Facility Phone', kind: 'tel', widthPct: 50 },
			{ key: 'facilityFax', label: 'Facility Fax', kind: 'tel', widthPct: 50 },
			{
				key: 'urgency', label: 'Urgency', kind: 'select', widthPct: 50, options: [
					{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'stat', label: 'STAT' },
				]
			},
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'draft', label: 'Draft' }, { value: 'pending', label: 'Pending' },
					{ value: 'sent', label: 'Sent' }, { value: 'acknowledged', label: 'Acknowledged' },
					{ value: 'scheduled', label: 'Scheduled' }, { value: 'completed', label: 'Completed' },
					{ value: 'cancelled', label: 'Cancelled' },
				]
			},
			{ key: 'reason', label: 'Reason for Referral', kind: 'textarea', required: true, widthPct: 100 },
			{ key: 'clinicalNotes', label: 'Clinical Notes', kind: 'textarea', widthPct: 100 },
		],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4E4}', label: 'Send', color: '#3b82f6', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/send` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2705}', label: 'Acknowledge', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/acknowledge` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F4C5}', label: 'Schedule', color: '#06b6d4', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/schedule` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F3C1}', label: 'Complete', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/complete` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F6AB}', label: 'Cancel', color: '#f59e0b', action: { kind: 'method', method: 'POST', path: r => `/api/referrals/${r.id}/cancel` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/referrals/${r.id}`, confirm: 'Delete this referral?' } },
		],
	},
	{
		// Prior Authorizations: \u{270F} Edit + \u{2713} Approve + \u{2717} Deny + Delete (clinicalEditors.ts:1400)
		id: 'authorizations',
		// allow-any-unicode-next-line
		icon: '\u{1F6E1}',
		label: 'Authorizations',
		description: 'Prior auth, approve/deny/appeal',
		command: 'ciyex.openAuthorizations',
		color: '#0ea5e9',
		apiPath: '/api/prior-auth?page=0&size=10',
		titleField: ['patientName', 'authNumber'],
		subtitleField: ['procedure', 'status'],
		editFields: [
			{ key: 'patientName', label: 'Patient Name', required: true, placeholder: 'Search patient...', widthPct: 50 },
			{ key: 'patientId', label: 'Patient ID', required: true, placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'providerName', label: 'Provider', placeholder: 'Search provider...', widthPct: 50 },
			{ key: 'insuranceName', label: 'Insurance Name', required: true, placeholder: 'Search insurance...', widthPct: 50 },
			{ key: 'memberId', label: 'Member ID', widthPct: 50 },
			{ key: 'authorizationNumber', label: 'Authorization Number', placeholder: 'Auth reference number', widthPct: 50 },
			{ key: 'procedureDescription', label: 'Procedure', required: true, placeholder: 'Search CPT procedure...', widthPct: 50 },
			{ key: 'procedureCode', label: 'CPT Code', required: true, placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'diagnosisDescription', label: 'Diagnosis', placeholder: 'Search ICD-10 diagnosis...', widthPct: 50 },
			{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', placeholder: 'Auto-filled', widthPct: 50 },
			{ key: 'reviewDate', label: 'Review Date', kind: 'date', widthPct: 50 },
			{ key: 'approvedDate', label: 'Approved Date', kind: 'date', widthPct: 50 },
			{ key: 'deniedDate', label: 'Denied Date', kind: 'date', widthPct: 50 },
			{ key: 'expiryDate', label: 'Expiry Date', kind: 'date', widthPct: 50 },
			{ key: 'approvedUnits', label: 'Approved Units', kind: 'number', widthPct: 50 },
			{ key: 'usedUnits', label: 'Used Units', kind: 'number', widthPct: 50 },
			{ key: 'remainingUnits', label: 'Remaining Units', kind: 'number', widthPct: 50 },
			{
				key: 'priority', label: 'Priority', kind: 'select', widthPct: 50, options: [
					{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }, { value: 'stat', label: 'STAT' },
				]
			},
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'pending', label: 'Pending' }, { value: 'submitted', label: 'Submitted' },
					{ value: 'approved', label: 'Approved' }, { value: 'denied', label: 'Denied' },
					{ value: 'appealed', label: 'Appealed' }, { value: 'expired', label: 'Expired' },
					{ value: 'cancelled', label: 'Cancelled' },
				]
			},
			{ key: 'appealDeadline', label: 'Appeal Deadline', kind: 'date', widthPct: 50 },
			{ key: 'denialReason', label: 'Denial Reason', kind: 'textarea', placeholder: 'Reason for denial if applicable', widthPct: 100 },
			{ key: 'notes', label: 'Notes', kind: 'textarea', widthPct: 100 },
		],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2713}', label: 'Approve', color: '#22c55e', action: { kind: 'method', method: 'POST', path: r => `/api/prior-auth/${r.id}/approve` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{2717}', label: 'Deny', color: '#ef4444', action: { kind: 'method', method: 'POST', path: r => `/api/prior-auth/${r.id}/deny` } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/prior-auth/${r.id}`, confirm: 'Delete this authorization?' } },
		],
	},
	{
		// Care Plans: \u{270F} Edit + Delete (clinicalEditors.ts:1120)
		id: 'careplans',
		// allow-any-unicode-next-line
		icon: '\u{2764}',
		label: 'Care Plans',
		description: 'Goals, interventions, categories',
		command: 'ciyex.openCarePlans',
		color: '#ef4444',
		apiPath: '/api/care-plans?page=0&size=10',
		titleField: ['title', 'patientName'],
		subtitleField: ['patientName', 'status'],
		editFields: [
			{ key: 'title', label: 'Plan Title', required: true, placeholder: 'e.g. Diabetes Management Plan', widthPct: 100 },
			{ key: 'patientName', label: 'Patient Name', required: true, placeholder: 'Search patient...', widthPct: 50 },
			{ key: 'patientId', label: 'Patient ID', required: true, placeholder: 'Auto-filled', widthPct: 50 },
			{
				key: 'category', label: 'Category', kind: 'select', required: true, widthPct: 50, options: [
					{ value: 'chronic_disease', label: 'Chronic Disease' }, { value: 'preventive', label: 'Preventive' },
					{ value: 'post_surgical', label: 'Post-Surgical' }, { value: 'behavioral', label: 'Behavioral' },
					{ value: 'rehabilitation', label: 'Rehabilitation' }, { value: 'palliative', label: 'Palliative' },
					{ value: 'other', label: 'Other' },
				]
			},
			{ key: 'authorName', label: 'Author', placeholder: 'Search provider...', widthPct: 50 },
			{ key: 'startDate', label: 'Start Date', kind: 'date', widthPct: 50 },
			{ key: 'endDate', label: 'End Date', kind: 'date', widthPct: 50 },
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' },
					{ value: 'on_hold', label: 'On Hold' }, { value: 'completed', label: 'Completed' },
				]
			},
			{ key: 'description', label: 'Description', kind: 'textarea', placeholder: 'Plan description...', widthPct: 100 },
			{ key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Additional notes...', widthPct: 100 },
		],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/care-plans/${r.id}`, confirm: 'Delete this care plan?' } },
		],
	},
	{
		// Patient Education (Library): \u{270F} Edit + Delete (clinicalEditors.ts:1556)
		id: 'education',
		// allow-any-unicode-next-line
		icon: '\u{1F4DA}',
		label: 'Patient Education',
		description: 'Education materials and handouts',
		command: 'ciyex.openEducation',
		color: '#eab308',
		apiPath: '/api/education/materials?page=0&size=10',
		titleField: ['title'],
		subtitleField: ['category'],
		editFields: [
			{ key: 'title', label: 'Title', required: true, placeholder: 'Material title', widthPct: 100 },
			{
				key: 'category', label: 'Category', kind: 'select', widthPct: 50, options: [
					{ value: 'disease_management', label: 'Disease Management' }, { value: 'medication', label: 'Medication' },
					{ value: 'procedure', label: 'Procedure' }, { value: 'lifestyle', label: 'Lifestyle' },
					{ value: 'preventive', label: 'Preventive' }, { value: 'mental_health', label: 'Mental Health' },
					{ value: 'nutrition', label: 'Nutrition' }, { value: 'other', label: 'Other' },
				]
			},
			{
				key: 'contentType', label: 'Content Type', kind: 'select', widthPct: 50, options: [
					{ value: 'article', label: 'Article' }, { value: 'video', label: 'Video' },
					{ value: 'pdf', label: 'PDF' }, { value: 'link', label: 'Link' },
					{ value: 'handout', label: 'Handout' }, { value: 'infographic', label: 'Infographic' },
				]
			},
			{ key: 'source', label: 'Source', placeholder: 'Source / author', widthPct: 50 },
			{ key: 'url', label: 'URL / Path', placeholder: 'https://... or /files/...', widthPct: 50 },
			{
				key: 'isActive', label: 'Active', kind: 'select', widthPct: 50, options: [
					{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' },
				]
			},
			{ key: 'tags', label: 'Tags', placeholder: 'Comma-separated tags', widthPct: 100 },
			{ key: 'description', label: 'Description', kind: 'textarea', placeholder: 'Brief description...', widthPct: 100 },
		],
		actions: [
			// allow-any-unicode-next-line
			{ symbol: '\u{270F}', label: 'Edit', color: '#a855f7', action: { kind: 'edit' } },
			// allow-any-unicode-next-line
			{ symbol: '\u{1F5D1}', label: 'Delete', color: '#ef4444', action: { kind: 'delete', path: r => `/api/education/materials/${r.id}`, confirm: 'Delete this material?' } },
		],
	},
];

export class ClinicalMenuPane extends ViewPane {
	static readonly ID = 'ciyex.clinical.menu';

	private container!: HTMLElement;
	private searchInput?: HTMLInputElement;
	private searchValue = '';
	private collapsed = new Set<string>();
	private counts = new Map<string, number>();
	private data = new Map<string, DataRow[]>();
	private loading = new Set<string>();
	private visibleCounts = new Map<string, number>();

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.clinical-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';
		this._render();

		// Auto-expand all on first show so user sees the data + action buttons
		for (const item of CLINICAL_ITEMS) { this.collapsed.delete(item.id); }

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try {
				const token = localStorage.getItem('ciyex_token');
				if (!token) { return; }
			} catch { return; }
			win.clearInterval(poll);
			this._loadAllData();
		}, 2000);
	}

	private async _loadAllData(): Promise<void> {
		for (const item of CLINICAL_ITEMS) {
			await this._loadItemData(item);
		}
	}

	private async _loadItemData(item: ClinicalItem): Promise<void> {
		if (this.loading.has(item.id)) { return; }
		this.loading.add(item.id);
		try {
			const res = await this.apiService.fetch(item.apiPath);
			if (res.ok) {
				const data = await res.json();
				const rows = (data?.data?.content || data?.content || data?.data || (Array.isArray(data) ? data : [])) as DataRow[];
				this.data.set(item.id, rows);
				const total = data?.data?.totalElements ?? data?.totalElements ?? rows.length;
				this.counts.set(item.id, total);
			}
		} catch { /* */ }
		this.loading.delete(item.id);
		this._render();
	}

	private _render(): void {
		DOM.clearNode(this.container);
		this._renderHeader();
		this._renderSearch();
		this._renderQuickActions();
		this._renderItems();
	}

	private _renderHeader(): void {
		// Title is already shown by the VS Code view container + view pane headers.
		const header = DOM.append(this.container, DOM.$('.menu-header'));
		header.style.cssText = 'padding:6px 10px;display:flex;align-items:center;justify-content:flex-end;gap:6px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		createActionIconButton(header, '\u{21BB}', 'Refresh', () => this._loadAllData());
		createActionIconButton(header, '\u{21D5}', 'Collapse / Expand All', () => {
			if (this.collapsed.size === CLINICAL_ITEMS.length) { this.collapsed.clear(); }
			else { CLINICAL_ITEMS.forEach(i => this.collapsed.add(i.id)); }
			this._render();
		});
	}

	private _renderSearch(): void {
		const wrap = DOM.append(this.container, DOM.$('.search-row'));
		wrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		this.searchInput = input;
		input.type = 'text';
		input.placeholder = 'Filter clinical modules...';
		input.value = this.searchValue;
		input.style.cssText = 'width:100%;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;box-sizing:border-box;';
		input.addEventListener('input', () => {
			this.searchValue = input.value;
			this._render();
			// After _render, this.searchInput has been replaced with the new element.
			if (this.searchInput) { this.searchInput.focus(); this.searchInput.setSelectionRange(this.searchValue.length, this.searchValue.length); }
		});
	}

	private _renderQuickActions(): void {
		const bar = DOM.append(this.container, DOM.$('.quick-actions'));
		bar.style.cssText = 'display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-wrap:wrap;';

		const actions: Array<{ icon: string; label: string; command: string; color: string }> = [
			// allow-any-unicode-next-line
			{ icon: '\u{1F48A}', label: 'Rx', command: 'ciyex.openPrescriptions', color: '#f97316' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F52C}', label: 'Lab', command: 'ciyex.openLabs', color: '#3b82f6' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F489}', label: 'Imm', command: 'ciyex.openImmunizations', color: '#22c55e' },
			// allow-any-unicode-next-line
			{ icon: '\u{1F4CB}', label: 'Ref', command: 'ciyex.openReferrals', color: '#a855f7' },
		];

		for (const a of actions) {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.title = `Quick: ${a.label}`;
			btn.style.cssText = `flex:1;padding:4px 6px;border:none;border-radius:3px;background:${a.color};color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;font-size:11px;min-width:50px;`;
			const ic = DOM.append(btn, DOM.$('span'));
			ic.textContent = a.icon;
			const lbl = DOM.append(btn, DOM.$('span'));
			lbl.textContent = a.label;
			lbl.style.cssText = 'font-weight:600;';
			btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
			btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
			btn.addEventListener('click', (e) => { e.stopPropagation(); this.commandService.executeCommand(a.command); });
		}
	}

	private _renderItems(): void {
		const q = this.searchValue.toLowerCase();
		const filtered = CLINICAL_ITEMS.filter(i => !q || i.label.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));

		if (filtered.length === 0) {
			const empty = DOM.append(this.container, DOM.$('.empty'));
			empty.style.cssText = 'padding:20px 10px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
			empty.textContent = 'No matching modules';
			return;
		}

		for (const item of filtered) {
			this._renderItem(item);
		}
	}

	private _renderItem(item: ClinicalItem): void {
		const isCollapsed = this.collapsed.has(item.id);

		const row = DOM.append(this.container, DOM.$('.clinical-row'));
		row.style.cssText = `padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);border-left:3px solid ${item.color};`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });
		row.addEventListener('click', () => this.commandService.executeCommand(item.command));

		const icon = DOM.append(row, DOM.$('span'));
		icon.textContent = item.icon;
		icon.style.cssText = `font-size:16px;width:24px;text-align:center;flex-shrink:0;color:${item.color};`;

		const col = DOM.append(row, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;';

		const labelRow = DOM.append(col, DOM.$('div'));
		labelRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

		const label = DOM.append(labelRow, DOM.$('span'));
		label.textContent = item.label;
		label.style.cssText = 'font-weight:500;font-size:12px;';

		const count = this.counts.get(item.id);
		if (typeof count === 'number') {
			const badge = DOM.append(labelRow, DOM.$('span'));
			badge.textContent = String(count);
			badge.style.cssText = `font-size:9px;padding:1px 6px;border-radius:8px;background:${item.color};color:#fff;font-weight:600;`;
		}

		const desc = DOM.append(col, DOM.$('div'));
		desc.textContent = item.description;
		desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		const actionsEl = createRowActionsContainer(row);
		// The "New X" + button used to navigate to the full editor tab, which
		// the test team reported as "not working" — they expected an inline
		// create form (parity with the Edit drawer). Open the same drawer in
		// create mode so the user lands on a populated form right away.
		createActionIconButton(actionsEl, '+', `New ${item.label}`, () => this._openCreateDialog(item));
		createActionIconButton(actionsEl, '\u{21BB}', `Reload ${item.label}`, () => this._loadItemData(item));
		createActionIconButton(actionsEl, isCollapsed ? '\u{203A}' : '\u{2304}', isCollapsed ? 'Expand' : 'Collapse', () => {
			if (isCollapsed) {
				this.collapsed.delete(item.id);
				if (!this.data.has(item.id)) { this._loadItemData(item); }
			} else { this.collapsed.add(item.id); }
			this._render();
		});

		if (!isCollapsed) {
			this._renderDataRows(item);
		}
	}

	private _renderDataRows(item: ClinicalItem): void {
		const sub = DOM.append(this.container, DOM.$('.sub-items'));
		sub.style.cssText = `padding:4px 0 4px 0;border-bottom:1px solid rgba(128,128,128,0.06);background:rgba(128,128,128,0.03);`;

		const rows = this.data.get(item.id);
		if (!rows) {
			const loading = DOM.append(sub, DOM.$('div'));
			loading.style.cssText = 'padding:8px 10px 8px 38px;color:var(--vscode-descriptionForeground);font-size:11px;';
			loading.textContent = 'Loading...';
			return;
		}

		if (rows.length === 0) {
			const empty = DOM.append(sub, DOM.$('div'));
			empty.style.cssText = 'padding:8px 10px 8px 38px;color:var(--vscode-descriptionForeground);font-size:11px;';
			empty.textContent = `No ${item.label.toLowerCase()} yet`;
			return;
		}

		const visible = Math.min(this.visibleCounts.get(item.id) ?? SIDEBAR_INITIAL_PAGE_SIZE, rows.length);
		for (let i = 0; i < visible; i++) {
			this._renderDataRow(sub, item, rows[i]);
		}
		renderShowMoreFooter(
			sub,
			{ visibleCount: visible, totalCount: rows.length },
			(next) => { this.visibleCounts.set(item.id, next); this._render(); },
			() => { this.visibleCounts.set(item.id, SIDEBAR_INITIAL_PAGE_SIZE); this._render(); },
		);
	}

	private _getField(row: DataRow, fields: string[]): string {
		for (const f of fields) {
			const v = row[f];
			if (v !== undefined && v !== null && String(v).trim() !== '') { return String(v); }
		}
		return '';
	}

	private _renderDataRow(parent: HTMLElement, item: ClinicalItem, row: DataRow): void {
		const dataRow = DOM.append(parent, DOM.$('.data-row'));
		dataRow.style.cssText = `padding:6px 10px 6px 38px;display:flex;align-items:center;gap:6px;border-left:2px solid ${item.color}44;cursor:pointer;`;
		dataRow.addEventListener('mouseenter', () => { dataRow.style.background = 'var(--vscode-list-hoverBackground)'; });
		dataRow.addEventListener('mouseleave', () => { dataRow.style.background = ''; });
		dataRow.addEventListener('click', () => this.commandService.executeCommand(item.command));

		const col = DOM.append(dataRow, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

		const title = DOM.append(col, DOM.$('div'));
		title.textContent = this._getField(row, item.titleField) || '(no title)';
		title.style.cssText = 'font-size:11px;font-weight:500;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		if (item.subtitleField) {
			const sub = DOM.append(col, DOM.$('div'));
			sub.textContent = this._getField(row, item.subtitleField);
			sub.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		}

		const status = String(row.status || '').toLowerCase();
		if (status) {
			const badge = DOM.append(dataRow, DOM.$('span'));
			badge.textContent = status;
			const statusColor = status.includes('active') || status.includes('completed') ? '#22c55e'
				: status.includes('cancel') || status.includes('void') || status.includes('discontinue') ? '#ef4444'
					: status.includes('pending') || status.includes('hold') ? '#f59e0b' : '#6b7280';
			badge.style.cssText = `font-size:8px;padding:1px 5px;border-radius:3px;background:${statusColor};color:#fff;font-weight:600;text-transform:capitalize;flex-shrink:0;`;
		}

		const actions = createRowActionsContainer(dataRow);
		createOverflowMenuButton(actions, () => item.actions.map(a => ({
			symbol: a.symbol,
			label: a.label,
			onClick: () => this._executeAction(item, row, a),
		})));
	}

	private async _executeAction(item: ClinicalItem, row: DataRow, a: RowAction): Promise<void> {
		const k = a.action;
		if (k.kind === 'edit') {
			this._openEditDialog(item, row);
			return;
		}
		if (k.kind === 'delete') {
			if (k.confirm) {
				const r = await this.dialogService.confirm({ message: k.confirm, type: 'warning', primaryButton: 'Delete' });
				if (!r.confirmed) { return; }
			}
			try { await this.apiService.fetch(k.path(row), { method: 'DELETE' }); } catch { /* */ }
			const current = this.data.get(item.id) || [];
			this.data.set(item.id, current.filter(r => (r.id || r.fhirId) !== (row.id || row.fhirId)));
			this._render();
			return;
		}
		if (k.kind === 'method') {
			if (k.confirm) {
				const r = await this.dialogService.confirm({ message: k.confirm, type: 'question' });
				if (!r.confirmed) { return; }
			}
			try {
				await this.apiService.fetch(k.path(row), {
					method: k.method,
					headers: k.body ? { 'Content-Type': 'application/json' } : undefined,
					body: k.body ? JSON.stringify(k.body) : undefined,
				});
			} catch { /* */ }
			await this._loadItemData(item);
		}
	}

	private _openCreateDialog(item: ClinicalItem): void {
		if (!item.editFields || item.editFields.length === 0) {
			// No drawer schema configured — fall back to the full editor.
			this.commandService.executeCommand(item.command);
			return;
		}
		const initialValues: Record<string, unknown> = {};
		for (const f of item.editFields) { initialValues[f.key] = ''; }
		const basePath = item.apiPath.split('?')[0].replace(/\/$/, '');
		openRecordEditDialog({
			title: `New ${item.label.replace(/s$/, '') || item.label}`,
			themeAnchor: this.container,
			fields: this._withSearch(item.editFields),
			values: initialValues,
			primaryLabel: 'Create',
			onSave: async (next) => {
				const res = await this.apiService.fetch(basePath, { method: 'POST', body: JSON.stringify(next) });
				if (!res.ok) { throw new Error(`Create failed (${res.status})`); }
				await this._loadItemData(item);
			},
		});
	}

	/**
	 * Walk a field schema and inject `kind: 'search'` + an `onSearch`/`onSelect`
	 * callback for well-known typeahead fields (patient, provider, prescriber,
	 * CVX, ICD-10, CPT, insurance). Lets every clinical sidebar drawer get
	 * search-typeahead behaviour without each entry having to repeat the
	 * fetch wiring.
	 *
	 * Called both from the New (create) and Edit drawers — the test team
	 * specifically flagged Rx / Lab / Imm / Referral / Authorization as
	 * "search not working" on the original plain text inputs.
	 */
	private _withSearch(fields: IEditFieldDef[]): IEditFieldDef[] {
		const fetchPatients = async (q: string): Promise<Array<{ value: string; label: string; description?: string; details?: Record<string, string> }>> => {
			try {
				const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
				if (!res.ok) { return []; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
				return list.map(p => {
					const name = `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || String(p.name || p.id);
					const pid = String(p.id ?? p.patientId ?? '');
					return { value: name, label: name, description: pid ? `MRN ${pid}` : undefined, details: { patientId: pid, firstName: (p.firstName as string) || '', lastName: (p.lastName as string) || '' } };
				});
			} catch { return []; }
		};
		const fetchProviders = async (q: string): Promise<Array<{ value: string; label: string; description?: string; details?: Record<string, string> }>> => {
			try {
				const urls = [`/api/providers?search=${encodeURIComponent(q)}&page=0&size=10`, `/api/fhir-resource/providers?search=${encodeURIComponent(q)}&page=0&size=10`];
				for (const url of urls) {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { continue; }
					const data = await res.json();
					const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
					if (list.length === 0) { continue; }
					return list.map(p => {
						const name = (p.name || p.fullName || `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || '') as string;
						const npi = (p.npi as string) || '';
						return { value: name, label: name, description: npi ? `NPI ${npi}` : undefined, details: { npi, firstName: (p.firstName as string) || '', lastName: (p.lastName as string) || '' } };
					});
				}
				return [];
			} catch { return []; }
		};
		const fetchCodes = async (path: string, q: string): Promise<Array<{ value: string; label: string; description?: string; details?: Record<string, string> }>> => {
			try {
				const res = await this.apiService.fetch(`${path}?search=${encodeURIComponent(q)}&page=0&size=10`);
				if (!res.ok) { return []; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
				return list.map(c => {
					const code = String(c.code || c.id || '');
					const desc = String(c.description || c.display || c.name || '');
					return { value: desc || code, label: desc || code, description: code, details: { code } };
				});
			} catch { return []; }
		};

		return fields.map(f => {
			const k = f.key.toLowerCase();
			// Patient-name typeahead — fills patientId on select.
			if (k === 'patientname' || k === 'patientfirstname') {
				return {
					...f,
					kind: 'search' as const,
					onSearch: fetchPatients,
					onSelectSearchResult: (item, all) => {
						const set = (key: string, val: string) => { const i = all.get(key); if (i) { i.value = val; } };
						set('patientId', item.details?.patientId || '');
						set('patientFirstName', item.details?.firstName || '');
						set('patientLastName', item.details?.lastName || '');
					},
				};
			}
			// Provider / prescriber typeahead — fills NPI when known.
			if (['prescribername', 'providername', 'referringprovider', 'physicianname', 'administeredby', 'authorname'].includes(k)) {
				return {
					...f,
					kind: 'search' as const,
					onSearch: fetchProviders,
					onSelectSearchResult: (item, all) => {
						const npi = item.details?.npi || '';
						if (npi) {
							for (const key of ['prescriberNpi', 'providerNpi', 'npi']) {
								const i = all.get(key);
								if (i && !i.value) { i.value = npi; }
							}
						}
					},
				};
			}
			// CVX vaccine code search.
			if (k === 'cvxcode') {
				return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodes('/api/codes/cvx', q) };
			}
			// CPT procedure code search.
			if (k === 'procedurecode' || k === 'cptcode') {
				return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodes('/api/codes/cpt', q) };
			}
			// ICD-10 diagnosis code search.
			if (k === 'diagnosiscode' || k === 'icd10' || k === 'icdcode') {
				return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodes('/api/codes/icd10', q) };
			}
			// LOINC lab test code search.
			if (k === 'testcode' || k === 'loinc') {
				return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodes('/api/codes/loinc', q) };
			}
			// Insurance search.
			if (k === 'insurancename') {
				return {
					...f,
					kind: 'search' as const,
					onSearch: async (q) => {
						try {
							const res = await this.apiService.fetch(`/api/insurances?search=${encodeURIComponent(q)}&page=0&size=10`);
							if (!res.ok) { return []; }
							const data = await res.json();
							const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
							return list.map(p => ({ value: String(p.name || p.label || ''), label: String(p.name || p.label || ''), description: String(p.payerId || p.id || '') }));
						} catch { return []; }
					},
				};
			}
			return f;
		});
	}

	private _openEditDialog(item: ClinicalItem, row: DataRow): void {
		// Prefer the explicit editFields schema (mirrors the full editor's
		// formFields). Fall back to deriving from titleField + subtitleField +
		// Status when the resource doesn't define one yet.
		let fields: IEditFieldDef[];
		if (item.editFields && item.editFields.length > 0) {
			fields = item.editFields;
		} else {
			const fieldKeys = [...item.titleField];
			if (item.subtitleField) {
				for (const k of item.subtitleField) { if (!fieldKeys.includes(k)) { fieldKeys.push(k); } }
			}
			fields = fieldKeys
				.filter(k => k !== 'status')
				.map(k => ({ key: k, label: humaniseFieldKey(k), widthPct: 100 } satisfies IEditFieldDef));
			fields.push({ key: 'status', label: 'Status', widthPct: 100 });
		}

		const initialValues: Record<string, unknown> = {};
		for (const f of fields) { initialValues[f.key] = row[f.key] ?? ''; }

		const id = row.id || row.fhirId;
		const basePath = item.apiPath.split('?')[0].replace(/\/$/, '');
		openRecordEditDialog({
			title: `Edit ${item.label}`,
			themeAnchor: this.container,
			fields: this._withSearch(fields),
			values: initialValues,
			onSave: async (next) => {
				const payload = { ...row, ...next };
				const res = await this.apiService.fetch(`${basePath}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				await this._loadItemData(item);
			},
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

/** Turn a camelCase key into a Title Cased label for the edit dialog. */
function humaniseFieldKey(key: string): string {
	return key
		.replace(/([A-Z])/g, ' $1')
		.replace(/[_-]+/g, ' ')
		.replace(/^./, c => c.toUpperCase())
		.trim();
}
