/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClinicalListEditorBase, ClinicalEditorConfig } from './clinicalListEditor.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';

// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL EDITORS
// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────

export class PrescriptionsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPrescriptions';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Prescriptions', apiPath: '/api/prescriptions', statsPath: '/api/prescriptions/stats',
		searchPlaceholder: 'Search by patient, medication, pharmacy...',
		editable: true,
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'medicationName', label: 'Medication' },
			{ key: 'sig', label: 'SIG' }, { key: 'quantity', label: 'Qty', width: '60px' },
			{ key: 'refillsRemaining', label: 'Refills', width: '60px' }, { key: 'pharmacyName', label: 'Pharmacy' },
			{ key: 'prescriberName', label: 'Prescriber' },
			{ key: 'priority', label: 'Priority', width: '80px' }, { key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'On Hold', value: 'on_hold' },
			{ label: 'Completed', value: 'completed' }, { label: 'Discontinued', value: 'discontinued' },
			{ label: 'Cancelled', value: 'cancelled' },
		],
		priorityOptions: [
			{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
		],
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'providerName', label: 'Provider', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'prescriberNpi', label: 'Prescriber NPI', type: 'text', placeholder: '10-digit NPI' },
			{ key: 'medicationName', label: 'Medication Name', type: 'text', required: true, placeholder: 'e.g. Amoxicillin 500mg' },
			{
				key: 'codeSystem', label: 'Code System', type: 'select', options: [
					{ label: 'NDC', value: 'NDC' }, { label: 'RxNorm', value: 'RxNorm' },
				]
			},
			{ key: 'strength', label: 'Strength', type: 'text', placeholder: '500mg' },
			{
				key: 'dosageForm', label: 'Dosage Form', type: 'select', options: [
					{ label: 'Tablet', value: 'tablet' }, { label: 'Capsule', value: 'capsule' },
					{ label: 'Solution', value: 'solution' }, { label: 'Injection', value: 'injection' },
					{ label: 'Inhaler', value: 'inhaler' }, { label: 'Cream', value: 'cream' },
					{ label: 'Ointment', value: 'ointment' }, { label: 'Patch', value: 'patch' },
				]
			},
			{ key: 'sig', label: 'SIG (Directions)', type: 'text', required: true, placeholder: 'Take 1 tablet by mouth twice daily' },
			{ key: 'quantity', label: 'Quantity', type: 'number', placeholder: '30' },
			{ key: 'daysSupply', label: 'Days Supply', type: 'number', placeholder: '30' },
			{ key: 'refills', label: 'Total Refills', type: 'number', placeholder: '3', defaultValue: 0 },
			{
				key: 'deaSchedule', label: 'DEA Schedule', type: 'select', options: [
					{ label: 'Schedule II', value: 'II' }, { label: 'Schedule III', value: 'III' },
					{ label: 'Schedule IV', value: 'IV' }, { label: 'Schedule V', value: 'V' },
				]
			},
			{ key: 'pharmacyName', label: 'Pharmacy', type: 'text', placeholder: 'Pharmacy name' },
			{ key: 'pharmacyPhone', label: 'Pharmacy Phone', type: 'text', placeholder: 'e.g. (555) 123-4567' },
			{ key: 'pharmacyAddress', label: 'Pharmacy Address', type: 'text', placeholder: 'Pharmacy street address' },
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
				], defaultValue: 'routine'
			},
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Active', value: 'active' }, { label: 'Completed', value: 'completed' },
					{ label: 'Stopped', value: 'stopped' }, { label: 'Cancelled', value: 'cancelled' },
					{ label: 'On Hold', value: 'on-hold' },
				], defaultValue: 'active'
			},
			{ key: 'startDate', label: 'Start Date', type: 'date' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Refill', icon: '🔄', handler: async (item, api, reload) => {
					if (confirm(`Refill ${item.medicationName}?`)) {
						await api.fetch(`/api/prescriptions/${item.id}/refill`, { method: 'POST' });
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Discontinue', icon: '⏹', handler: async (item, api, reload) => {
					const reason = prompt('Reason for discontinuation:');
					if (reason) {
						await api.fetch(`/api/prescriptions/${item.id}/discontinue`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ reason }),
						});
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => {
					if (confirm('Delete this prescription?')) {
						await api.fetch(`/api/prescriptions/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(PrescriptionsEditor.ID, group, t, th, s, a); }
}

export class LabsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexLabs';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Lab Orders', apiPath: '/api/lab-order/search', statsPath: undefined,
		searchPlaceholder: 'Search by patient, test, order number...',
		editable: true,
		columns: [
			{ key: 'patientFirstName', label: 'Patient' }, { key: 'orderNumber', label: 'Order #', width: '100px' },
			{ key: 'orderName', label: 'Test', width: '1.5fr' }, { key: 'physicianName', label: 'Provider' },
			{ key: 'priority', label: 'Priority', width: '80px' }, { key: 'resultStatus', label: 'Results', width: '80px' },
			{ key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'Pending', value: 'pending' },
			{ label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
		],
		priorityOptions: [
			{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
		],
		formFields: [
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true },
			{ key: 'patientFirstName', label: 'Patient First Name', type: 'text', required: true },
			{ key: 'patientLastName', label: 'Patient Last Name', type: 'text', required: true },
			{ key: 'orderNumber', label: 'Order Number', type: 'text', placeholder: 'Auto-generated' },
			{ key: 'orderName', label: 'Order/Test Name', type: 'text', required: true, placeholder: 'e.g. CBC, BMP, Lipid Panel' },
			{ key: 'testCode', label: 'Test Code', type: 'text', placeholder: 'LOINC code' },
			{ key: 'specimenId', label: 'Specimen ID', type: 'text', placeholder: 'Specimen identifier' },
			{ key: 'labName', label: 'Lab Name', type: 'text', placeholder: 'Quest, LabCorp, etc.' },
			{ key: 'physicianName', label: 'Ordering Provider', type: 'text' },
			{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', type: 'text', placeholder: 'e.g. Z00.00' },
			{ key: 'orderDate', label: 'Order Date', type: 'date' },
			{ key: 'orderTime', label: 'Order Time', type: 'text', placeholder: 'HH:MM (24h)' },
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
				], defaultValue: 'routine'
			},
			{ key: 'notes', label: 'Notes', type: 'textarea' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm('Delete this lab order?')) { await api.fetch(`/api/lab-order/${item.patientId}/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(LabsEditor.ID, group, t, th, s, a); }
}

export class ImmunizationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexImmunizations';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Immunizations', apiPath: '/api/immunizations', searchPlaceholder: 'Search by patient, vaccine...',
		editable: true,
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'vaccineName', label: 'Vaccine', width: '1.5fr' },
			{ key: 'cvxCode', label: 'CVX', width: '60px' }, { key: 'doseNumber', label: 'Dose', width: '50px' },
			{ key: 'site', label: 'Site', width: '80px' }, { key: 'route', label: 'Route', width: '70px' },
			{ key: 'administrationDate', label: 'Date', width: '90px' }, { key: 'provider', label: 'Administered By' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not_done' }, { label: 'Entered in Error', value: 'entered_in_error' }],
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'vaccineName', label: 'Vaccine Name', type: 'text', required: true, placeholder: 'e.g. Influenza, COVID-19' },
			{ key: 'cvxCode', label: 'CVX Code', type: 'text', placeholder: 'e.g. 141, 208, 213 (enter CVX number)' },
			{ key: 'manufacturer', label: 'Manufacturer', type: 'text' },
			{ key: 'lot', label: 'Lot Number', type: 'text' },
			{ key: 'expirationDate', label: 'Expiration Date', type: 'date' },
			{ key: 'administrationDate', label: 'Administration Date', type: 'date', required: true },
			{
				key: 'site', label: 'Site', type: 'select', options: [
					{ label: 'Left Arm', value: 'left_arm' }, { label: 'Right Arm', value: 'right_arm' },
					{ label: 'Left Thigh', value: 'left_thigh' }, { label: 'Right Thigh', value: 'right_thigh' },
				]
			},
			{
				key: 'route', label: 'Route', type: 'select', options: [
					{ label: 'Intramuscular (IM)', value: 'IM' }, { label: 'Subcutaneous (SC)', value: 'SC' },
					{ label: 'Oral', value: 'PO' }, { label: 'Intranasal', value: 'IN' }, { label: 'Intradermal', value: 'ID' },
				]
			},
			{ key: 'doseNumber', label: 'Dose Number', type: 'number', placeholder: '1' },
			{ key: 'doseSeries', label: 'Dose Series', type: 'text', placeholder: 'e.g. 1 of 3' },
			{ key: 'provider', label: 'Administered By', type: 'search', required: true, placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'orderingProvider', label: 'Ordering Provider', type: 'search', placeholder: 'Search ordering provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'visDate', label: 'VIS Date', type: 'date' },
			{ key: 'refusalReason', label: 'Refusal Reason', type: 'text', placeholder: 'Reason if refused' },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not_done' },
					{ label: 'Entered in Error', value: 'entered_in_error' },
				], defaultValue: 'completed'
			},
			{ key: 'notes', label: 'Notes', type: 'textarea' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm('Delete?')) { await api.fetch(`/api/immunizations/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(ImmunizationsEditor.ID, group, t, th, s, a); }
}

export class ReferralsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexReferrals';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Referrals', apiPath: '/api/referrals', statsPath: '/api/referrals/stats',
		searchPlaceholder: 'Search by patient, specialist, facility...',
		editable: true,
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'specialistName', label: 'Specialist' },
			{ key: 'specialty', label: 'Specialty', width: '100px' }, { key: 'facilityName', label: 'Facility' },
			{ key: 'reason', label: 'Reason' },
			{ key: 'urgency', label: 'Urgency', width: '80px' }, { key: 'status', label: 'Status', width: '90px' },
			{ key: 'referralDate', label: 'Date', width: '90px' },
		],
		statusTabs: [
			{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' },
			{ label: 'Acknowledged', value: 'acknowledged' }, { label: 'Scheduled', value: 'scheduled' },
			{ label: 'Completed', value: 'completed' }, { label: 'Denied', value: 'denied' },
			{ label: 'Cancelled', value: 'cancelled' },
		],
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'referringProvider', label: 'Referring Provider', type: 'search', required: true, placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'specialistName', label: 'Specialist Name', type: 'text', required: true },
			{ key: 'specialistNpi', label: 'Specialist NPI', type: 'text', placeholder: '10-digit NPI' },
			{
				key: 'specialty', label: 'Specialty', type: 'select', options: [
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
					{ label: 'Palliative Care', value: 'Palliative Care' },
					{ label: 'Pathology', value: 'Pathology' }, { label: 'Pediatrics', value: 'Pediatrics' },
					{ label: 'Physical Medicine', value: 'Physical Medicine' },
					{ label: 'Plastic Surgery', value: 'Plastic Surgery' },
					{ label: 'Podiatry', value: 'Podiatry' }, { label: 'Psychiatry', value: 'Psychiatry' },
					{ label: 'Pulmonology', value: 'Pulmonology' }, { label: 'Radiology', value: 'Radiology' },
					{ label: 'Rheumatology', value: 'Rheumatology' },
					{ label: 'Sports Medicine', value: 'Sports Medicine' },
					{ label: 'Surgery', value: 'Surgery' }, { label: 'Urology', value: 'Urology' },
					{ label: 'Vascular Surgery', value: 'Vascular Surgery' },
					{ label: 'Other', value: 'Other' },
				]
			},
			{ key: 'facilityName', label: 'Facility Name', type: 'text' },
			{ key: 'facilityAddress', label: 'Facility Address', type: 'text', placeholder: 'Street address' },
			{ key: 'facilityPhone', label: 'Facility Phone', type: 'text' },
			{ key: 'facilityFax', label: 'Facility Fax', type: 'text' },
			{ key: 'reason', label: 'Reason for Referral', type: 'textarea', required: true },
			{ key: 'clinicalNotes', label: 'Clinical Notes', type: 'textarea' },
			{
				key: 'urgency', label: 'Urgency', type: 'select', options: [
					{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
				], defaultValue: 'routine'
			},
			{ key: 'insuranceName', label: 'Insurance Name', type: 'text' },
			{ key: 'insuranceId', label: 'Insurance ID', type: 'text', placeholder: 'Member/policy ID' },
			{ key: 'authorizationNumber', label: 'Auth Number', type: 'text' },
			{ key: 'expiryDate', label: 'Expiry Date', type: 'date' },
			{ key: 'appointmentDate', label: 'Appointment Date', type: 'date' },
			{ key: 'appointmentNotes', label: 'Appointment Notes', type: 'textarea', placeholder: 'Scheduling notes...' },
			{ key: 'followUpNotes', label: 'Follow-Up Notes', type: 'textarea', placeholder: 'Follow-up instructions...' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Send', icon: '📤', handler: async (item, api, reload) => {
					if (item.status === 'draft') {
						await api.fetch(`/api/referrals/${item.id}/status`, {
							method: 'PUT', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ status: 'sent' }),
						});
						reload();
					}
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm('Delete?')) { await api.fetch(`/api/referrals/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(ReferralsEditor.ID, group, t, th, s, a); }
}

export class CarePlansEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCarePlans';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Care Plans', apiPath: '/api/care-plans', statsPath: '/api/care-plans/stats',
		searchPlaceholder: 'Search by title, patient, author...',
		editable: true,
		columns: [
			{ key: 'title', label: 'Title', width: '1.5fr' }, { key: 'patientName', label: 'Patient' },
			{ key: 'authorName', label: 'Author' }, { key: 'category', label: 'Category', width: '120px' },
			{ key: 'startDate', label: 'Start', width: '90px' }, { key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'Draft', value: 'draft' },
			{ label: 'Completed', value: 'completed' }, { label: 'On Hold', value: 'on_hold' },
			{ label: 'Revoked', value: 'revoked' },
		],
		formFields: [
			{ key: 'title', label: 'Plan Title', type: 'text', required: true, placeholder: 'e.g. Diabetes Management Plan' },
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{
				key: 'category', label: 'Category', type: 'select', required: true, options: [
					{ label: 'Chronic Disease', value: 'chronic_disease' }, { label: 'Preventive', value: 'preventive' },
					{ label: 'Post-Surgical', value: 'post_surgical' }, { label: 'Behavioral', value: 'behavioral' },
					{ label: 'Rehabilitation', value: 'rehabilitation' }, { label: 'Palliative', value: 'palliative' },
					{ label: 'Other', value: 'other' },
				]
			},
			{ key: 'authorName', label: 'Author', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'startDate', label: 'Start Date', type: 'date' },
			{ key: 'endDate', label: 'End Date', type: 'date' },
			{ key: 'description', label: 'Description', type: 'textarea', placeholder: 'Plan description...' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Draft', value: 'draft' }, { label: 'Active', value: 'active' },
					{ label: 'On Hold', value: 'on_hold' }, { label: 'Completed', value: 'completed' },
				], defaultValue: 'draft'
			},
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm(`Delete "${item.title}"?`)) { await api.fetch(`/api/care-plans/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(CarePlansEditor.ID, group, t, th, s, a); }
}

export class CdsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCds';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Clinical Decision Support', apiPath: '/api/cds/rules',
		searchPlaceholder: 'Search by rule name...',
		editable: true,
		columns: [
			{ key: 'name', label: 'Rule Name', width: '1.5fr' }, { key: 'type', label: 'Type', width: '120px' },
			{ key: 'description', label: 'Description', width: '2fr' },
			{ key: 'severity', label: 'Severity', width: '80px' }, { key: 'status', label: 'Status', width: '70px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' },
			{ label: 'Inactive', value: 'inactive' },
			{ label: 'Draft', value: 'draft' },
		],
		formFields: [
			{ key: 'name', label: 'Rule Name', type: 'text', required: true, placeholder: 'Enter alert/rule name' },
			{
				key: 'type', label: 'Type', type: 'select', required: true, options: [
					{ label: 'Drug Interaction', value: 'drug_interaction' },
					{ label: 'Allergy Alert', value: 'allergy_alert' },
					{ label: 'Duplicate Order', value: 'duplicate_order' },
					{ label: 'Age-Based', value: 'age_based' },
					{ label: 'Lab Value', value: 'lab_value' },
					{ label: 'Preventive Care', value: 'preventive_care' },
					{ label: 'Custom', value: 'custom' },
				]
			},
			{ key: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'Describe the clinical rule or alert...' },
			{
				key: 'severity', label: 'Severity', type: 'select', required: true, options: [
					{ label: 'Info', value: 'info' },
					{ label: 'Warning', value: 'warning' },
					{ label: 'Critical', value: 'critical' },
				], defaultValue: 'warning'
			},
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Active', value: 'active' },
					{ label: 'Inactive', value: 'inactive' },
					{ label: 'Draft', value: 'draft' },
				], defaultValue: 'draft'
			},
			{ key: 'condition', label: 'Condition Expression', type: 'textarea', placeholder: 'Rule condition (e.g. age > 50 AND diagnosis contains "diabetes")' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Toggle', icon: '⏻', handler: async (item, api, reload) => { await api.fetch(`/api/cds/rules/${item.id}/toggle`, { method: 'POST' }); reload(); } },
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm(`Delete "${item.name}"?`)) { await api.fetch(`/api/cds/rules/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(CdsEditor.ID, group, t, th, s, a); }
}

export class AuthorizationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexAuthorizations';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Prior Authorizations', apiPath: '/api/prior-auth', statsPath: '/api/prior-auth/stats',
		searchPlaceholder: 'Search by auth#, patient, procedure, insurance...',
		editable: true,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'insuranceName', label: 'Insurance' }, { key: 'procedureCode', label: 'CPT', width: '70px' },
			{ key: 'procedureDescription', label: 'Procedure' },
			{ key: 'authNumber', label: 'Auth #', width: '100px' },
			{ key: 'priority', label: 'Priority', width: '70px' }, { key: 'status', label: 'Status', width: '80px' },
			{ key: 'expiryDate', label: 'Expiry', width: '90px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' }, { label: 'Submitted', value: 'submitted' },
			{ label: 'Approved', value: 'approved' }, { label: 'Denied', value: 'denied' },
			{ label: 'Appeal', value: 'appeal' }, { label: 'Expired', value: 'expired' },
		],
		priorityOptions: [
			{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
		],
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'providerName', label: 'Provider', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'insuranceName', label: 'Insurance Name', type: 'search', required: true, placeholder: 'Search insurance...', apiPath: '/api/insurance-companies', searchDisplayField: 'name' },
			{ key: 'memberId', label: 'Member ID', type: 'text' },
			{ key: 'authorizationNumber', label: 'Authorization Number', type: 'text', placeholder: 'Auth reference number' },
			{ key: 'procedureCode', label: 'CPT Code', type: 'text', required: true, placeholder: 'e.g. 99213' },
			{ key: 'procedureDescription', label: 'Procedure Description', type: 'text' },
			{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', type: 'text', placeholder: 'e.g. E11.9' },
			{ key: 'diagnosisDescription', label: 'Diagnosis Description', type: 'text' },
			{ key: 'reviewDate', label: 'Review Date', type: 'date' },
			{ key: 'approvedDate', label: 'Approved Date', type: 'date' },
			{ key: 'deniedDate', label: 'Denied Date', type: 'date' },
			{ key: 'expiryDate', label: 'Expiry Date', type: 'date' },
			{ key: 'approvedUnits', label: 'Approved Units', type: 'number', placeholder: 'Number of approved units' },
			{ key: 'usedUnits', label: 'Used Units', type: 'number', placeholder: 'Units already used' },
			{ key: 'remainingUnits', label: 'Remaining Units', type: 'number', placeholder: 'Units remaining' },
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
				], defaultValue: 'routine'
			},
			{ key: 'denialReason', label: 'Denial Reason', type: 'textarea', placeholder: 'Reason for denial if applicable' },
			{ key: 'appealDeadline', label: 'Appeal Deadline', type: 'date' },
			{ key: 'notes', label: 'Notes', type: 'textarea' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Approve', icon: '✓', handler: async (item, api, reload) => {
					const u = prompt('Approved units:', '1');
					if (u) {
						await api.fetch(`/api/prior-auth/${item.id}/approve`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ approvedUnits: Number(u) }),
						});
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Deny', icon: '✗', handler: async (item, api, reload) => {
					const r = prompt('Denial reason:');
					if (r) {
						await api.fetch(`/api/prior-auth/${item.id}/deny`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ reason: r }),
						});
						reload();
					}
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm('Delete?')) { await api.fetch(`/api/prior-auth/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(AuthorizationsEditor.ID, group, t, th, s, a); }
}

export class EducationEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexEducation';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Patient Education', apiPath: '/api/patient-education',
		searchPlaceholder: 'Search by topic, category...',
		columns: [
			{ key: 'materialTitle', label: 'Topic', width: '1.5fr' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'category', label: 'Category', width: '100px' },
			{ key: 'status', label: 'Status', width: '100px' },
			{ key: 'priority', label: 'Priority', width: '80px' },
			{ key: 'dueDate', label: 'Due Date', width: '100px' },
		],
		statusTabs: [
			{ label: 'Assigned', value: 'assigned' }, { label: 'Viewed', value: 'viewed' },
			{ label: 'Completed', value: 'completed' }, { label: 'Dismissed', value: 'dismissed' },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(EducationEditor.ID, group, t, th, s, a); }
}

// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────
// OPERATIONS EDITORS
// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────

export class RecallEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexRecall';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Patient Recall', apiPath: '/api/recalls',
		searchPlaceholder: 'Search by patient name...',
		editable: true,
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'recallTypeName', label: 'Type' },
			{ key: 'providerName', label: 'Provider' }, { key: 'dueDate', label: 'Due Date', width: '100px' },
			{ key: 'status', label: 'Status', width: '100px' }, { key: 'priority', label: 'Priority', width: '80px' },
			{ key: 'attemptCount', label: 'Attempts', width: '70px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'PENDING' }, { label: 'Overdue', value: 'OVERDUE' },
			{ label: 'Contacted', value: 'CONTACTED' }, { label: 'Scheduled', value: 'SCHEDULED' },
			{ label: 'Completed', value: 'COMPLETED' }, { label: 'Cancelled', value: 'CANCELLED' },
		],
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'text', required: true },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true },
			{ key: 'patientPhone', label: 'Phone', type: 'text' },
			{ key: 'patientEmail', label: 'Email', type: 'text' },
			{ key: 'recallTypeName', label: 'Recall Type', type: 'text', required: true, placeholder: 'e.g. Annual Physical' },
			{ key: 'providerName', label: 'Provider', type: 'text' },
			{ key: 'dueDate', label: 'Due Date', type: 'date', required: true },
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Normal', value: 'NORMAL' }, { label: 'High', value: 'HIGH' }, { label: 'Urgent', value: 'URGENT' },
				], defaultValue: 'NORMAL'
			},
			{
				key: 'preferredContact', label: 'Preferred Contact', type: 'select', options: [
					{ label: 'Phone', value: 'PHONE' }, { label: 'Email', value: 'EMAIL' }, { label: 'SMS', value: 'SMS' },
				]
			},
			{ key: 'notes', label: 'Notes', type: 'textarea' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Log Outreach', icon: '📞', handler: async (item, api, reload) => {
					const method = prompt('Outreach method (PHONE, EMAIL, SMS):');
					if (method) {
						await api.fetch(`/api/recalls/${item.id}/outreach`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ method: method.toUpperCase(), outcome: 'contacted' }),
						});
						reload();
					}
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm('Delete?')) { await api.fetch(`/api/recalls/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(RecallEditor.ID, group, t, th, s, a); }
}

export class CodesEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCodes';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Medical Codes', apiPath: '/api/global_codes',
		searchPlaceholder: 'Search by code, description...',
		columns: [
			{ key: 'code', label: 'Code', width: '100px' }, { key: 'codeType', label: 'Type', width: '80px' },
			{ key: 'shortDescription', label: 'Description', width: '2fr' },
			{ key: 'category', label: 'Category', width: '120px' },
			{ key: 'active', label: 'Active', width: '60px' },
		],
		statusTabs: [
			{ label: 'ICD-10', value: 'ICD10' }, { label: 'CPT', value: 'CPT4' },
			{ label: 'HCPCS', value: 'HCPCS' }, { label: 'CDT', value: 'CDT' },
			{ label: 'SNOMED', value: 'SNOMED' }, { label: 'LOINC', value: 'LOINC' },
			{ label: 'NDC', value: 'NDC' }, { label: 'CVX', value: 'CVX' },
			{ label: 'Custom', value: 'CUSTOM' },
		],
		formFields: [
			{ key: 'code', label: 'Code', type: 'text', required: true, placeholder: 'e.g. 99213' },
			{
				key: 'codeType', label: 'Code Type', type: 'select', required: true, options: [
					{ label: 'ICD-10', value: 'ICD10' }, { label: 'CPT', value: 'CPT4' },
					{ label: 'HCPCS', value: 'HCPCS' }, { label: 'CDT', value: 'CDT' },
					{ label: 'CUSTOM', value: 'CUSTOM' },
				]
			},
			{ key: 'shortDescription', label: 'Short Description', type: 'text', required: true },
			{ key: 'category', label: 'Category', type: 'text' },
			{ key: 'feeStandard', label: 'Fee ($)', type: 'number' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm('Delete?')) { await api.fetch(`/api/global_codes/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(CodesEditor.ID, group, t, th, s, a); }
}

export class InventoryEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexInventory';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Inventory Management', apiPath: '/api/inventory',
		searchPlaceholder: 'Search by name, SKU, barcode...',
		editable: true,
		columns: [
			{ key: 'name', label: 'Item Name', width: '1.5fr' }, { key: 'sku', label: 'SKU', width: '100px' },
			{ key: 'category', label: 'Category', width: '100px' }, { key: 'quantity', label: 'Qty', width: '60px' },
			{ key: 'minimumLevel', label: 'Min', width: '50px' }, { key: 'unitCost', label: 'Cost', width: '70px' },
			{ key: 'supplier', label: 'Supplier' }, { key: 'expirationDate', label: 'Expires', width: '90px' },
		],
		formFields: [
			{ key: 'name', label: 'Item Name', type: 'text', required: true, placeholder: 'e.g. Latex Gloves Medium' },
			{ key: 'sku', label: 'SKU', type: 'text' },
			{ key: 'barcode', label: 'Barcode', type: 'text' },
			{ key: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Supplies, Equipment' },
			{ key: 'location', label: 'Storage Location', type: 'text' },
			{ key: 'quantity', label: 'Quantity', type: 'number', required: true, defaultValue: 0 },
			{ key: 'minimumLevel', label: 'Minimum Level', type: 'number', defaultValue: 10 },
			{ key: 'reorderLevel', label: 'Reorder Level', type: 'number', defaultValue: 20 },
			{ key: 'unitCost', label: 'Unit Cost ($)', type: 'number' },
			{ key: 'supplier', label: 'Supplier', type: 'text' },
			{ key: 'expirationDate', label: 'Expiration Date', type: 'date' },
			{ key: 'notes', label: 'Notes', type: 'textarea' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Adjust Stock', icon: '📦', handler: async (item, api, reload) => {
					const qty = prompt('Adjustment quantity (positive to add, negative to remove):', '0');
					if (qty) {
						const reason = prompt('Reason for adjustment:') || 'Manual adjustment';
						await api.fetch(`/api/inventory/${item.id}/adjust`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ quantity: Number(qty), reason, adjustmentType: Number(qty) >= 0 ? 'ADD' : 'REMOVE' }),
						});
						reload();
					}
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm('Delete?')) { await api.fetch(`/api/inventory/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(InventoryEditor.ID, group, t, th, s, a); }
}

export class PaymentsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPayments';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Payments', apiPath: '/api/payments/transactions', statsPath: '/api/payments/stats',
		searchPlaceholder: 'Search by patient, transaction...',
		columns: [
			{ key: 'patientId', label: 'Patient ID' },
			{ key: 'amount', label: 'Amount', width: '80px' },
			{ key: 'transactionType', label: 'Type', width: '90px' },
			{ key: 'paymentMethodType', label: 'Method', width: '100px' },
			{ key: 'description', label: 'Description' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'collectedAt', label: 'Date', width: '100px' },
		],
		statusTabs: [
			{ label: 'Completed', value: 'completed' }, { label: 'Pending', value: 'pending' },
			{ label: 'Processing', value: 'processing' }, { label: 'Failed', value: 'failed' },
			{ label: 'Refunded', value: 'refunded' }, { label: 'Voided', value: 'voided' },
		],
		cellRenderer: (key: string, value: unknown): string => {
			if (key === 'amount' && typeof value === 'number') {
				return `$${value.toFixed(2)}`;
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Refund', icon: '↩️', handler: async (item, api, reload) => {
					const amount = prompt('Refund amount:', String(item.amount || ''));
					if (amount) {
						const reason = prompt('Refund reason:') || 'Refund';
						await api.fetch(`/api/payments/transactions/${item.id}/refund`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ amount: Number(amount), reason }),
						});
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Void', icon: '⊘', handler: async (item, api, reload) => {
					if (confirm('Void this transaction?')) {
						await api.fetch(`/api/payments/transactions/${item.id}/void`, { method: 'POST' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(PaymentsEditor.ID, group, t, th, s, a); }
}

export class ClaimsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexClaims';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Claims Management', apiPath: '/api/all-claims',
		searchPlaceholder: 'Search by patient, diagnosis, claim ID...',
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'diagnosisCode', label: 'Dx Code', width: '80px' },
			{ key: 'diagnosisDescription', label: 'Diagnosis' },
			{ key: 'type', label: 'Type', width: '90px' },
			{ key: 'planName', label: 'Plan' },
			{ key: 'provider', label: 'Provider' },
			{ key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Draft', value: 'draft' }, { label: 'Submitted', value: 'submitted' },
			{ label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' },
			{ label: 'Denied', value: 'denied' }, { label: 'Paid', value: 'paid' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Update Status', icon: '📋', handler: async (item, api, reload) => {
					const status = prompt('New status (draft, submitted, pending, approved, denied, paid):');
					if (status) {
						await api.fetch(`/api/all-claims/${item.claimId || item.id}/status`, {
							method: 'PUT', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ status }),
						});
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Send', icon: '📤', handler: async (item, api, reload) => {
					if (confirm('Send this claim to insurance?')) {
						await api.fetch(`/api/all-claims/${item.claimId || item.id}/sends`, { method: 'POST' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(ClaimsEditor.ID, group, t, th, s, a); }
}
