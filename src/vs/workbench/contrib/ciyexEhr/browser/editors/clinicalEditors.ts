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
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';

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
		clientSideFilter: ['patientName', 'medicationName', 'sig', 'pharmacyName', 'prescriberName', 'status', 'priority', 'id'],
		editable: true,
		refetchOnEdit: true,
		createDefaults: { intent: 'order' },
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
			{
				key: 'prescriberName', label: 'Prescriber', type: 'search', placeholder: 'Search prescriber...',
				apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'],
				relatedFieldsMap: { prescriberNpi: 'npi' },
				aliases: ['providerName', 'prescribingDoctor', 'prescriber', 'renderingProvider'],
			},
			{ key: 'prescriberNpi', label: 'Prescriber NPI', type: 'text', required: true, placeholder: '10-digit NPI', aliases: ['providerNpi', 'npi'], validationPattern: '^\\d{10}$', validationMessage: 'NPI must be exactly 10 digits' },
			{ key: 'medicationName', label: 'Medication Name', type: 'text', required: true, placeholder: 'e.g. Amoxicillin 500mg', validationPattern: '^[A-Za-z0-9 ,.\\-/()\\[\\]+&\']{2,128}$', validationMessage: 'Medication Name must be 2-128 characters and contain only letters, numbers, and common punctuation' },
			{
				key: 'medicationSystem', label: 'Code System', type: 'select', aliases: ['codeSystem', 'system'], options: [
					{ label: 'NDC', value: 'NDC' }, { label: 'RxNorm', value: 'RxNorm' },
				]
			},
			{ key: 'strength', label: 'Strength / Dosage', type: 'text', placeholder: '500mg', aliases: ['dosage'], validationPattern: '^[0-9]+(\\.[0-9]+)?\\s?(mg|mcg|g|ml|mL|IU|units?|%)?$', validationMessage: 'Dosage must be a number with optional unit (e.g. 500mg, 5ml, 10 units)' },
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
			{ key: 'pharmacyName', label: 'Pharmacy', type: 'text', required: true, placeholder: 'Pharmacy name', validationPattern: '^[A-Za-z0-9 ,.\\-/()&\']{2,128}$', validationMessage: 'Pharmacy Name must be 2-128 valid characters' },
			{ key: 'pharmacyPhone', label: 'Pharmacy Phone', type: 'text', required: true, placeholder: '(555) 123-4567', validationPattern: '^\\(?\\d{3}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}$', validationMessage: 'Phone must be in (US) format: (555) 123-4567 or 555-123-4567' },
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
				label: 'Refill', icon: '🔄', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: `Refill ${item.medicationName}?`, type: 'question' });
					if (r.confirmed) {
						await api.fetch(`/api/prescriptions/${item.id}/refill`, { method: 'POST' });
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Discontinue', icon: '⏹', handler: async (item, api, reload, dlg) => {
					const r = await dlg.input({ type: 'question', message: 'Reason for discontinuation', inputs: [{ placeholder: 'Reason...' }] });
					const reason = r.confirmed ? r.values?.[0]?.trim() : undefined;
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
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: 'Delete this prescription?', type: 'warning', primaryButton: 'Delete' });
					if (r.confirmed) {
						await api.fetch(`/api/prescriptions/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(PrescriptionsEditor.ID, group, t, th, s, a, d); }
}

export class LabsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexLabs';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Lab Orders', apiPath: '/api/lab-order/search', statsPath: undefined,
		searchPlaceholder: 'Search by patient, test, order number...',
		clientSideFilter: ['patientFirstName', 'patientLastName', 'orderNumber', 'orderName', 'physicianName', 'status', 'priority', 'result', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Backend is patient-scoped: POST /api/lab-order/{patientId}, PUT/GET/DELETE /api/lab-order/{patientId}/{orderId}.
		buildItemUrl: (item) => `/api/lab-order/${item.patientId}/${item.id}`,
		buildCreateUrl: (payload) => `/api/lab-order/${payload.patientId}`,
		columns: [
			{ key: 'patientFirstName', label: 'Patient' }, { key: 'orderNumber', label: 'Order #', width: '100px' },
			{ key: 'orderName', label: 'Test', width: '1.5fr' }, { key: 'physicianName', label: 'Provider' },
			{ key: 'priority', label: 'Priority', width: '80px' }, { key: 'result', label: 'Results', width: '80px' },
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
			// Patient Information
			{
				key: 'patientFirstName', label: 'Patient', type: 'search', required: true,
				placeholder: 'Search patient by name, MRN or ID...',
				apiPath: '/api/patients', relatedField: 'patientId',
				relatedDisplayFields: ['firstName', 'lastName'],
				relatedFieldsMap: { patientLastName: 'lastName' },
			},
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'patientLastName', label: 'Patient Last Name', type: 'text', placeholder: 'Auto-filled from patient search' },
			// Order Meta
			{ key: 'labName', label: 'Lab Name', type: 'text', placeholder: 'Quest, LabCorp, etc.' },
			{
				key: 'orderNumber', label: 'Order Number', type: 'text', required: true,
				placeholder: 'Auto-generated',
				defaultValue: () => {
					const d = new Date();
					const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
					const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
					return `LAB-${ymd}-${rand}`;
				},
			},
			{ key: 'orderName', label: 'Order Name', type: 'text', placeholder: 'Order name' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
			// Test Details
			{
				key: 'testDisplay', label: 'Test Name', type: 'search', required: true,
				placeholder: 'Search LOINC test (e.g. CBC, glucose)...',
				apiPath: '/api/app-proxy/ciyex-codes/api/codes/LOINC/search',
				searchParam: 'q',
				searchDisplayField: 'shortDescription',
				searchValueField: 'code',
				relatedField: 'testCode',
				relatedDisplayFields: ['code', 'shortDescription'],
				validationPattern: '^[A-Za-z0-9 ,.\\-/()\\[\\]+&\']{2,}$',
				validationMessage: 'Test Name must be at least 2 characters and contain only letters/numbers/punctuation',
			},
			{ key: 'testCode', label: 'Test Code (LOINC)', type: 'text', required: true, placeholder: 'Auto-filled from test search', validationPattern: '^[0-9A-Za-z\\-]{1,16}$', validationMessage: 'Invalid LOINC code format' },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Draft', value: 'draft' }, { label: 'Active', value: 'active' },
					{ label: 'Pending', value: 'pending' }, { label: 'Completed', value: 'completed' },
					{ label: 'Cancelled', value: 'cancelled' }, { label: 'Revoked', value: 'revoked' },
				], defaultValue: 'active'
			},
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
				], defaultValue: 'routine'
			},
			{ key: 'orderDate', label: 'Order Date', type: 'date', defaultValue: () => new Date().toISOString().slice(0, 10) },
			{ key: 'orderTime', label: 'Order Time', type: 'text', placeholder: 'HH:MM (24h)', defaultValue: () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } },
			{
				key: 'physicianName', label: 'Ordering Provider', type: 'search', required: true,
				placeholder: 'Search provider...', apiPath: '/api/providers',
				relatedDisplayFields: ['firstName', 'lastName'],
				aliases: ['orderingProvider', 'providerName', 'renderingProvider', 'prescribingDoctor'],
			},
			{ key: 'specimenId', label: 'Specimen ID', type: 'text', placeholder: 'S-0001' },
			{
				key: 'result', label: 'Result Status', type: 'select', aliases: ['resultStatus'], options: [
					{ label: 'Pending', value: 'Pending' }, { label: 'Preliminary', value: 'Preliminary' },
					{ label: 'Partial', value: 'Partial' }, { label: 'Final', value: 'Final' },
					{ label: 'Corrected', value: 'Corrected' }, { label: 'Amended', value: 'Amended' },
				], defaultValue: 'Pending'
			},
			// Diagnosis — backed by ciyex-codes search so users can pick valid codes.
			{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', type: 'search', placeholder: 'Search ICD-10 codes', apiPath: '/api/app-proxy/ciyex-codes/api/codes/ICD10_CM/search', searchParam: 'q', searchDisplayField: 'shortDescription', searchValueField: 'code', relatedDisplayFields: ['code', 'shortDescription'] },
			{ key: 'procedureCode', label: 'Procedure Code (CPT)', type: 'search', placeholder: 'Search CPT codes', apiPath: '/api/app-proxy/ciyex-codes/api/codes/CPT/search', searchParam: 'q', searchDisplayField: 'shortDescription', searchValueField: 'code', relatedDisplayFields: ['code', 'shortDescription'] },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this lab order?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/lab-order/${item.patientId}/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(LabsEditor.ID, group, t, th, s, a, d); }
}

export class ImmunizationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexImmunizations';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Immunizations', apiPath: '/api/immunizations', searchPlaceholder: 'Search by patient, vaccine...',
		clientSideFilter: ['patientName', 'vaccineName', 'cvxCode', 'site', 'route', 'administeredBy', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'vaccineName', label: 'Vaccine', width: '1.5fr' },
			{ key: 'cvxCode', label: 'CVX', width: '60px' }, { key: 'doseNumber', label: 'Dose', width: '50px' },
			{ key: 'site', label: 'Site', width: '80px' }, { key: 'route', label: 'Route', width: '70px' },
			{ key: 'administrationDate', label: 'Date', width: '90px' }, { key: 'administeredBy', label: 'Administered By' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not_done' }, { label: 'Entered in Error', value: 'entered_in_error' }],
		formFields: [
			// Patient Information
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient by name...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			// Vaccine Information
			{ key: 'vaccineName', label: 'Vaccine Name', type: 'text', required: true, placeholder: 'Influenza, inactivated' },
			{
				key: 'cvxCode', label: 'CVX Code', type: 'search', required: true,
				placeholder: 'Search CVX vaccine code...',
				apiPath: '/api/app-proxy/ciyex-codes/api/codes/CVX/search',
				searchParam: 'q',
				searchDisplayField: 'shortDescription',
				searchValueField: 'code',
				relatedField: 'cvxCodeId',
				relatedDisplayFields: ['code', 'shortDescription'],
				relatedFieldsMap: { vaccineName: 'shortDescription' },
				validationPattern: '^[0-9]{1,4}$',
				validationMessage: 'CVX code must be 1-4 digits',
			},
			{ key: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Pfizer' },
			{ key: 'lotNumber', label: 'Lot Number', type: 'text', placeholder: 'ABC123', aliases: ['lot'], validationPattern: '^[A-Za-z0-9\\-]{2,32}$', validationMessage: 'Lot Number must be 2-32 alphanumeric characters' },
			{ key: 'expirationDate', label: 'Expiration Date', type: 'date' },
			// Administration Details
			{ key: 'administrationDate', label: 'Administration Date', type: 'date', required: true },
			{
				key: 'site', label: 'Site', type: 'select', options: [
					{ label: 'Select site...', value: '' },
					{ label: 'Left Arm', value: 'left_arm' }, { label: 'Right Arm', value: 'right_arm' },
					{ label: 'Left Thigh', value: 'left_thigh' }, { label: 'Right Thigh', value: 'right_thigh' },
					{ label: 'Left Deltoid', value: 'left_deltoid' }, { label: 'Right Deltoid', value: 'right_deltoid' },
					{ label: 'Left Gluteal', value: 'left_gluteal' }, { label: 'Right Gluteal', value: 'right_gluteal' },
				]
			},
			{
				key: 'route', label: 'Route', type: 'select', options: [
					{ label: 'Intramuscular (IM)', value: 'IM' }, { label: 'Subcutaneous (SC)', value: 'SC' },
					{ label: 'Oral', value: 'PO' }, { label: 'Intranasal', value: 'IN' }, { label: 'Intradermal', value: 'ID' },
				]
			},
			{ key: 'doseNumber', label: 'Dose Number', type: 'number', placeholder: '1' },
			{ key: 'doseSeries', label: 'Dose Series', type: 'text', placeholder: '1 of 3 or booster' },
			// Provider Information
			{
				key: 'administeredBy', label: 'Administered By', type: 'search', required: true,
				placeholder: 'Search provider...', apiPath: '/api/providers',
				relatedDisplayFields: ['firstName', 'lastName'],
				aliases: ['provider', 'administeredByName', 'performer', 'practitionerName', 'providerName'],
			},
			{
				key: 'orderingProvider', label: 'Ordering Provider', type: 'search',
				placeholder: 'Search provider...', apiPath: '/api/providers',
				relatedDisplayFields: ['firstName', 'lastName'],
				aliases: ['orderedBy', 'orderingProviderName'],
			},
			// Status & Notes
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not_done' },
					{ label: 'Entered in Error', value: 'entered_in_error' },
				], defaultValue: 'completed'
			},
			{ key: 'visDate', label: 'VIS Date', type: 'date' },
			{ key: 'refusalReason', label: 'Refusal Reason', type: 'text', placeholder: 'Patient declined...' },
			{ key: 'reaction', label: 'Reaction', type: 'text', placeholder: 'None observed' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this immunization?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/immunizations/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(ImmunizationsEditor.ID, group, t, th, s, a, d); }
}

export class ReferralsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexReferrals';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Referrals', apiPath: '/api/referrals', statsPath: '/api/referrals/stats',
		searchPlaceholder: 'Search by patient, specialist, facility...',
		clientSideFilter: ['patientName', 'specialistName', 'specialty', 'facilityName', 'reason', 'urgency', 'status', 'id'],
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
			{ key: 'authorizationNumber', label: 'Authorization Number', type: 'text' },
			{ key: 'expiryDate', label: 'Expiry Date', type: 'date' },
			{ key: 'appointmentDate', label: 'Appointment Date', type: 'date' },
			{ key: 'appointmentNotes', label: 'Appointment Notes', type: 'textarea', placeholder: 'Scheduling notes...' },
			{ key: 'followUpNotes', label: 'Follow-Up Notes', type: 'textarea', placeholder: 'Follow-up instructions...' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Send', icon: '📤', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (current === 'sent' || current === 'acknowledged' || current === 'completed') {
						await dlg.info(`Referral is already ${current}.`);
						return;
					}
					const r = await dlg.confirm({ message: 'Send this referral?', type: 'question' });
					if (!r.confirmed) { return; }
					// Try the dedicated send endpoint first, fall back to the status transition.
					let res = await api.fetch(`/api/referrals/${item.id}/send`, { method: 'POST' });
					if (!res.ok) {
						res = await api.fetch(`/api/referrals/${item.id}/status`, {
							method: 'PUT', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ status: 'sent' }),
						});
					}
					if (!res.ok) {
						const err = await res.json().catch(() => null) as Record<string, unknown> | null;
						await dlg.error(String(err?.['message'] || 'Failed to send referral'));
						return;
					}
					reload();
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this referral?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/referrals/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(ReferralsEditor.ID, group, t, th, s, a, d); }
}

export class CarePlansEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCarePlans';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Care Plans', apiPath: '/api/care-plans', statsPath: '/api/care-plans/stats',
		searchPlaceholder: 'Search by title, patient, author...',
		clientSideFilter: ['title', 'patientName', 'authorName', 'category', 'status', 'id'],
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
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: `Delete "${item.title}"?`, type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/care-plans/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(CarePlansEditor.ID, group, t, th, s, a, d); }
}

export class CdsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCds';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Clinical Decision Support', apiPath: '/api/cds/rules',
		searchPlaceholder: 'Search by rule name...',
		clientSideFilter: ['name', 'type', 'description', 'severity', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Backend DTO commonly requires ruleType / actionType / appliesTo / isActive / conditions
		// even when the form doesn't surface them. Provide safe defaults so create succeeds.
		createDefaults: {
			ruleType: 'custom',
			actionType: 'alert',
			appliesTo: 'all',
			isActive: true,
			conditions: [],
		},
		beforeSave: (payload, isEdit) => {
			// Drop nullish/empty optional fields that can cause backend validation errors.
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(payload)) {
				if (v === '' || v === null || v === undefined) { continue; }
				out[k] = v;
			}
			// Map "type" to "ruleType" if backend expects ruleType but form sends type.
			if (out.type && !out.ruleType) { out.ruleType = out.type; }
			// Mirror status -> isActive boolean.
			if (typeof out.status === 'string') {
				out.isActive = out.status === 'active';
			}
			return out;
		},
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
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: `Delete "${item.name}"?`, type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/cds/rules/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(CdsEditor.ID, group, t, th, s, a, d); }
}

export class AuthorizationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexAuthorizations';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Prior Authorizations', apiPath: '/api/prior-auth', statsPath: '/api/prior-auth/stats',
		searchPlaceholder: 'Search by auth#, patient, procedure, insurance...',
		clientSideFilter: ['patientName', 'insuranceName', 'procedureCode', 'procedureDescription', 'authorizationNumber', 'priority', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'insuranceName', label: 'Insurance' }, { key: 'procedureCode', label: 'CPT', width: '70px' },
			{ key: 'procedureDescription', label: 'Procedure' },
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
			{
				key: 'procedureDescription', label: 'Procedure', type: 'search', required: true,
				placeholder: 'Search CPT procedure (e.g. office visit)...',
				apiPath: '/api/app-proxy/ciyex-codes/api/codes/CPT/search',
				searchParam: 'q',
				searchDisplayField: 'shortDescription',
				searchValueField: 'code',
				relatedField: 'procedureCode',
				relatedDisplayFields: ['code', 'shortDescription'],
				validationPattern: '^[A-Za-z0-9 ,.\\-/()\\[\\]+&\']{2,}$',
				validationMessage: 'Procedure must be at least 2 characters and contain only letters/numbers/punctuation',
			},
			{ key: 'procedureCode', label: 'CPT Code', type: 'text', required: true, placeholder: 'Auto-filled', validationPattern: '^[0-9A-Z]{4,7}$', validationMessage: 'CPT code must be 4-7 alphanumerics (e.g. 99213, J0696)' },
			{
				key: 'diagnosisDescription', label: 'Diagnosis', type: 'search',
				placeholder: 'Search ICD-10 diagnosis...',
				apiPath: '/api/app-proxy/ciyex-codes/api/codes/ICD10_CM/search',
				searchParam: 'q',
				searchDisplayField: 'shortDescription',
				searchValueField: 'code',
				relatedField: 'diagnosisCode',
				relatedDisplayFields: ['code', 'shortDescription'],
			},
			{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', type: 'text', placeholder: 'Auto-filled', validationPattern: '^[A-Z][0-9][0-9A-Z](\\.[0-9A-Z]{1,4})?$', validationMessage: 'ICD-10 format: e.g. E11.9, J18.9' },
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
				label: 'Approve', icon: '✓', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({ type: 'question', message: 'Approve authorization', inputs: [{ placeholder: 'Approved units', value: '1' }] });
					const u = res.confirmed ? res.values?.[0]?.trim() : undefined;
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
				label: 'Deny', icon: '✗', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({ type: 'question', message: 'Deny authorization', inputs: [{ placeholder: 'Denial reason' }] });
					const r = res.confirmed ? res.values?.[0]?.trim() : undefined;
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
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this authorization?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/prior-auth/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(AuthorizationsEditor.ID, group, t, th, s, a, d); }
}

export class EducationEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexEducation';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Patient Education', apiPath: '/api/education/assignments',
		searchPlaceholder: 'Search by topic, category...',
		clientSideFilter: ['materialTitle', 'patientName', 'category', 'status', 'priority', 'id'],
		editable: true,
		refetchOnEdit: true,
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
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{
				key: 'materialTitle', label: 'Topic / Material', type: 'search', required: true,
				placeholder: 'Search education material...',
				apiPath: '/api/education/materials',
				relatedField: 'materialId',
				searchDisplayField: 'title',
				relatedFieldsMap: { category: 'category' },
			},
			{ key: 'materialId', label: 'Material ID', type: 'text', required: true, placeholder: 'Auto-filled from material search' },
			{
				key: 'category', label: 'Category', type: 'select', options: [
					{ label: 'Disease Management', value: 'disease_management' },
					{ label: 'Medication', value: 'medication' },
					{ label: 'Procedure', value: 'procedure' },
					{ label: 'Lifestyle', value: 'lifestyle' },
					{ label: 'Preventive', value: 'preventive' },
					{ label: 'Other', value: 'other' },
				]
			},
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' },
				], defaultValue: 'routine'
			},
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Assigned', value: 'assigned' }, { label: 'Viewed', value: 'viewed' },
					{ label: 'Completed', value: 'completed' }, { label: 'Dismissed', value: 'dismissed' },
				], defaultValue: 'assigned'
			},
			{ key: 'dueDate', label: 'Due Date', type: 'date' },
			{ key: 'assignedBy', label: 'Assigned By', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Instructions for the patient...' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this assignment?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/education/assignments/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(EducationEditor.ID, group, t, th, s, a, d); }
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
		clientSideFilter: ['patientName', 'recallTypeName', 'providerName', 'status', 'priority', 'id'],
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
			{
				key: 'patientName', label: 'Patient Name', type: 'search', required: true,
				placeholder: 'Search patient...', apiPath: '/api/patients',
				relatedField: 'patientId',
				relatedDisplayFields: ['firstName', 'lastName'],
				relatedFieldsMap: { patientPhone: 'phone', patientEmail: 'email' },
			},
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'patientPhone', label: 'Phone', type: 'text', placeholder: 'Auto-filled' },
			{ key: 'patientEmail', label: 'Email', type: 'text', placeholder: 'Auto-filled' },
			{ key: 'recallTypeName', label: 'Recall Type', type: 'text', required: true, placeholder: 'e.g. Annual Physical' },
			{
				key: 'providerName', label: 'Provider', type: 'search',
				placeholder: 'Search provider...', apiPath: '/api/providers',
				relatedDisplayFields: ['firstName', 'lastName'],
			},
			{ key: 'dueDate', label: 'Due Date', type: 'date', required: true },
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Normal', value: 'NORMAL' }, { label: 'High', value: 'HIGH' }, { label: 'Urgent', value: 'URGENT' },
				], defaultValue: 'NORMAL'
			},
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Pending', value: 'PENDING' }, { label: 'Overdue', value: 'OVERDUE' },
					{ label: 'Contacted', value: 'CONTACTED' }, { label: 'Scheduled', value: 'SCHEDULED' },
					{ label: 'Completed', value: 'COMPLETED' }, { label: 'Cancelled', value: 'CANCELLED' },
				], defaultValue: 'PENDING'
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
				label: 'Log Outreach', icon: '📞', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({ type: 'question', message: 'Log outreach', detail: 'Allowed: PHONE, EMAIL, SMS', inputs: [{ placeholder: 'e.g. PHONE' }] });
					const method = res.confirmed ? res.values?.[0]?.trim() : undefined;
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
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this recall?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/recalls/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(RecallEditor.ID, group, t, th, s, a, d); }
}

export class CodesEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCodes';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Medical Codes', apiPath: '/api/global_codes',
		searchPlaceholder: 'Search by code, description...',
		// "Status tabs" here are actually code-type categories, so filter on codeType.
		filterKey: 'codeType',
		clientSideFilter: ['code', 'codeType', 'shortDescription', 'category', 'id'],
		editable: true,
		refetchOnEdit: true,
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
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this code?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/global_codes/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(CodesEditor.ID, group, t, th, s, a, d); }
}

export class InventoryEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexInventory';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Inventory Management', apiPath: '/api/inventory',
		searchPlaceholder: 'Search by name, SKU, barcode, category...',
		clientSideFilter: ['name', 'sku', 'barcode', 'description', 'categoryName', 'locationName', 'manufacturer', 'unit', 'status', 'id'],
		editable: true,
		mergeOnEdit: true,
		refetchOnEdit: true,
		columns: [
			{ key: 'name', label: 'Item Name', width: '1.5fr' },
			{ key: 'sku', label: 'SKU', width: '100px' },
			{ key: 'categoryName', label: 'Category', width: '110px' },
			{ key: 'stockOnHand', label: 'Stock', width: '60px' },
			{ key: 'minStock', label: 'Min', width: '50px' },
			{ key: 'unit', label: 'Unit', width: '70px' },
			{ key: 'costPerUnit', label: 'Cost', width: '70px' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' },
			{ label: 'Inactive', value: 'inactive' },
		],
		formFields: [
			{ key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Latex Gloves Medium' },
			{ key: 'sku', label: 'SKU', type: 'text', required: true, placeholder: 'e.g. GLV-M-001' },
			{ key: 'description', label: 'Description', type: 'text' },
			{ key: 'unit', label: 'Unit', type: 'text', required: true, placeholder: 'pcs / box / vial' },
			{ key: 'costPerUnit', label: 'Cost Per Unit ($)', type: 'number' },
			{ key: 'stockOnHand', label: 'Stock On Hand', type: 'number', required: true, defaultValue: 0 },
			{ key: 'minStock', label: 'Min Stock', type: 'number', required: true, defaultValue: 0 },
			{ key: 'maxStock', label: 'Max Stock', type: 'number' },
			{ key: 'reorderPoint', label: 'Reorder Point', type: 'number' },
			{ key: 'reorderQty', label: 'Reorder Qty', type: 'number' },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Active', value: 'active' },
					{ label: 'Inactive', value: 'inactive' },
				], defaultValue: 'active'
			},
			{
				key: 'itemType', label: 'Item Type', type: 'select', options: [
					{ label: 'Consumable', value: 'consumable' },
					{ label: 'Durable', value: 'durable' },
					{ label: 'Medication', value: 'medication' },
					{ label: 'Equipment', value: 'equipment' },
				], defaultValue: 'consumable'
			},
			{ key: 'barcode', label: 'Barcode', type: 'text' },
			{ key: 'manufacturer', label: 'Manufacturer', type: 'text' },
			{
				key: 'costMethod', label: 'Cost Method', type: 'select', options: [
					{ label: 'FIFO', value: 'fifo' },
					{ label: 'LIFO', value: 'lifo' },
					{ label: 'Average', value: 'avg' },
				], defaultValue: 'fifo'
			},
			{ key: 'categoryId', label: 'Category ID', type: 'number', aliases: ['category.id'] },
			{ key: 'locationId', label: 'Location ID', type: 'number', aliases: ['location.id'] },
			{ key: 'supplierId', label: 'Supplier ID', type: 'number', aliases: ['supplier.id'] },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Adjust Stock', icon: '📦', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({
						type: 'question', message: 'Adjust stock',
						detail: 'Positive to add, negative to remove. Reason is optional.',
						inputs: [
							{ placeholder: 'Quantity', value: '0' },
							{ placeholder: 'Reason (optional)' },
						],
					});
					if (!res.confirmed) { return; }
					const qty = res.values?.[0]?.trim();
					const reason = res.values?.[1]?.trim() || 'Manual adjustment';
					if (qty) {
						await api.fetch(`/api/inventory/${item.id}/adjust`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ quantity: Number(qty), reason, adjustmentType: Number(qty) >= 0 ? 'ADD' : 'REMOVE' }),
						});
						reload();
					}
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this inventory item?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/inventory/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(InventoryEditor.ID, group, t, th, s, a, d); }
}

export class PaymentsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPayments';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Payments', apiPath: '/api/payments/transactions', statsPath: '/api/payments/stats',
		searchPlaceholder: 'Search by patient, transaction...',
		// Backend doesn't filter on status= / q=, so do it client-side.
		clientSideFilter: ['patientId', 'patientName', 'transactionType', 'paymentMethodType', 'description', 'status', 'transactionId', 'id'],
		// Backend `transactionStats()` returns 9 keys; only the *Count ones map to a
		// `status` filter. Totals, today*, and month* are aggregates → info-only.
		statsFilterMap: {
			pendingCount: 'pending',
			completedCount: 'completed',
			failedCount: 'failed',
			refundedCount: 'refunded',
		},
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
				label: 'Refund', icon: '↩️', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({
						type: 'question', message: 'Issue a refund',
						inputs: [
							{ placeholder: 'Amount', value: String(item.amount || '') },
							{ placeholder: 'Reason (optional)' },
						],
					});
					if (!res.confirmed) { return; }
					const amount = res.values?.[0]?.trim();
					const reason = res.values?.[1]?.trim() || 'Refund';
					if (amount) {
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
				label: 'Void', icon: '⊘', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: 'Void this transaction?', type: 'warning', primaryButton: 'Void' });
					if (r.confirmed) {
						await api.fetch(`/api/payments/transactions/${item.id}/void`, { method: 'POST' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(PaymentsEditor.ID, group, t, th, s, a, d); }
}

export class ClaimsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexClaims';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Claims Management', apiPath: '/api/all-claims',
		searchPlaceholder: 'Search by patient, diagnosis, claim ID...',
		editable: true,
		// Claims are derived from invoices/encounters — backend has no POST handler.
		// Status updates and Send work via the actions; manual creation is disabled.
		creatable: false,
		// /api/all-claims doesn't support server-side q=/status= — filter client-side
		// across the fields the user searches by (matches ciyex-ehr-ui behavior).
		clientSideFilter: ['patientName', 'provider', 'payerName', 'diagnosisCode', 'policyNumber', 'planName', 'id'],
		mergeOnEdit: true,
		editTitle: (item) => `Edit Claim #${String(item.id || '')}`,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'diagnosisCode', label: 'Dx Code', width: '80px' },
			{ key: 'payerName', label: 'Payer' },
			{ key: 'type', label: 'Type', width: '110px' },
			{ key: 'planName', label: 'Plan' },
			{ key: 'provider', label: 'Provider' },
			{ key: 'policyNumber', label: 'Policy #', width: '110px' },
			{ key: 'status', label: 'Status', width: '100px' },
		],
		statusTabs: [
			{ label: 'Draft', value: 'draft' }, { label: 'Submitted', value: 'submitted' },
			{ label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' },
			{ label: 'Denied', value: 'denied' }, { label: 'Paid', value: 'paid' },
		],
		formFields: [
			{
				key: 'patientName', label: 'Patient Name', type: 'search', required: true,
				placeholder: 'Search patient...', apiPath: '/api/patients',
				relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'],
			},
			{ key: 'patientId', label: 'Patient ID', type: 'text', placeholder: 'Auto-filled from patient search' },
			{
				key: 'provider', label: 'Provider', type: 'search', required: true,
				placeholder: 'Search provider...', apiPath: '/api/providers',
				relatedField: 'providerId', relatedDisplayFields: ['firstName', 'lastName'],
				aliases: ['providerName', 'renderingProvider'],
			},
			{ key: 'providerId', label: 'Provider ID', type: 'text', placeholder: 'Auto-filled from provider search' },
			{ key: 'payerName', label: 'Payer Name', type: 'text', placeholder: 'Insurance payer' },
			{ key: 'diagnosisCode', label: 'Diagnosis Code', type: 'text', placeholder: 'e.g. Z00.00' },
			{ key: 'diagnosisDescription', label: 'Diagnosis Description', type: 'text' },
			{ key: 'policyNumber', label: 'Policy Number', type: 'text', placeholder: 'Policy number' },
			{ key: 'planName', label: 'Plan Name', type: 'text', placeholder: 'Plan name' },
			{
				key: 'type', label: 'Type', type: 'select', options: [
					{ label: 'Professional', value: 'professional' },
					{ label: 'Institutional', value: 'institutional' },
					{ label: 'Dental', value: 'dental' },
					{ label: 'Pharmacy', value: 'pharmacy' },
				], defaultValue: 'professional'
			},
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Draft', value: 'draft' }, { label: 'Submitted', value: 'submitted' },
					{ label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' },
					{ label: 'Denied', value: 'denied' }, { label: 'Paid', value: 'paid' },
				], defaultValue: 'draft'
			},
			{ key: 'totalAmount', label: 'Total Amount ($)', type: 'number' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Update Status', icon: '📋', handler: async (item, api, reload, dlg) => {
					const statuses = ['draft', 'submitted', 'pending', 'approved', 'denied', 'paid'];
					const res = await dlg.prompt<string>({
						type: 'question',
						message: 'Update claim status',
						detail: `Current status: ${String(item.status || '—')}`,
						buttons: statuses.map(v => ({ label: v.charAt(0).toUpperCase() + v.slice(1), run: () => v })),
						cancelButton: true,
					});
					const status = res.result;
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
				label: 'Send', icon: '📤', handler: async (item, api, reload, dlg) => {
					const res = await dlg.confirm({ message: 'Send this claim to insurance?', type: 'question' });
					if (res.confirmed) {
						await api.fetch(`/api/all-claims/${item.claimId || item.id}/sends`, { method: 'POST' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(ClaimsEditor.ID, group, t, th, s, a, d); }
}
