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

export class PrescriptionsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPrescriptions';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Prescriptions', apiPath: '/api/prescriptions', statsPath: '/api/prescriptions/stats',
		searchPlaceholder: 'Search by patient, medication, pharmacy...',
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'medicationName', label: 'Medication' },
			{ key: 'sig', label: 'SIG' }, { key: 'quantity', label: 'Qty', width: '60px' },
			{ key: 'refills', label: 'Refills', width: '60px' }, { key: 'prescriberName', label: 'Prescriber' },
			{ key: 'priority', label: 'Priority', width: '80px' }, { key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'On Hold', value: 'on-hold' },
			{ label: 'Completed', value: 'completed' }, { label: 'Discontinued', value: 'discontinued' },
		],
		actions: [
			{ label: 'Refill', icon: '🔄', handler: async (item, api, reload) => { if (confirm(`Refill ${item.medicationName}?`)) { await api.fetch(`/api/prescriptions/${item.id}/refill`, { method: 'POST' }); reload(); } } },
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm(`Delete?`)) { await api.fetch(`/api/prescriptions/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(PrescriptionsEditor.ID, group, t, th, s, a); }
}

export class ImmunizationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexImmunizations';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Immunizations', apiPath: '/api/immunizations', searchPlaceholder: 'Search by patient, vaccine...',
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'vaccineName', label: 'Vaccine', width: '1.5fr' },
			{ key: 'cvxCode', label: 'CVX', width: '60px' }, { key: 'doseNumber', label: 'Dose', width: '50px' },
			{ key: 'route', label: 'Route', width: '70px' }, { key: 'administrationDate', label: 'Date', width: '90px' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not-done' }],
		actions: [{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm(`Delete?`)) { await api.fetch(`/api/immunizations/${item.id}`, { method: 'DELETE' }); reload(); } } }],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(ImmunizationsEditor.ID, group, t, th, s, a); }
}

export class ReferralsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexReferrals';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Referrals', apiPath: '/api/referrals', statsPath: '/api/referrals/stats',
		searchPlaceholder: 'Search by patient, specialist, facility...',
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'specialistName', label: 'Specialist' },
			{ key: 'specialty', label: 'Specialty', width: '100px' }, { key: 'facility', label: 'Facility' },
			{ key: 'urgency', label: 'Urgency', width: '80px' }, { key: 'status', label: 'Status', width: '90px' },
			{ key: 'referralDate', label: 'Date', width: '90px' },
		],
		statusTabs: [
			{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' },
			{ label: 'Acknowledged', value: 'acknowledged' }, { label: 'Scheduled', value: 'scheduled' },
			{ label: 'Completed', value: 'completed' }, { label: 'Denied', value: 'denied' },
		],
		actions: [{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm(`Delete?`)) { await api.fetch(`/api/referrals/${item.id}`, { method: 'DELETE' }); reload(); } } }],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(ReferralsEditor.ID, group, t, th, s, a); }
}

export class CarePlansEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCarePlans';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Care Plans', apiPath: '/api/care-plans', statsPath: '/api/care-plans/stats',
		searchPlaceholder: 'Search by title, patient, author...',
		columns: [
			{ key: 'title', label: 'Title', width: '1.5fr' }, { key: 'patientName', label: 'Patient' },
			{ key: 'author', label: 'Author' }, { key: 'category', label: 'Category', width: '120px' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [{ label: 'Active', value: 'active' }, { label: 'Draft', value: 'draft' }, { label: 'Completed', value: 'completed' }],
		actions: [{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm(`Delete "${item.title}"?`)) { await api.fetch(`/api/care-plans/${item.id}`, { method: 'DELETE' }); reload(); } } }],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(CarePlansEditor.ID, group, t, th, s, a); }
}

export class CdsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCds';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Clinical Decision Support', apiPath: '/api/cds/rules',
		searchPlaceholder: 'Search by rule name...',
		columns: [
			{ key: 'name', label: 'Rule Name', width: '1.5fr' }, { key: 'type', label: 'Type', width: '120px' },
			{ key: 'description', label: 'Description', width: '2fr' },
			{ key: 'severity', label: 'Severity', width: '80px' }, { key: 'status', label: 'Status', width: '70px' },
		],
		actions: [
			{ label: 'Toggle', icon: '⏻', handler: async (item, api, reload) => { await api.fetch(`/api/cds/rules/${item.id}/toggle`, { method: 'POST' }); reload(); } },
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
		columns: [
			{ key: 'authNumber', label: 'Auth #', width: '100px' }, { key: 'patientName', label: 'Patient' },
			{ key: 'insuranceName', label: 'Insurance' }, { key: 'procedureCode', label: 'CPT', width: '70px' },
			{ key: 'priority', label: 'Priority', width: '70px' }, { key: 'status', label: 'Status', width: '80px' },
			{ key: 'approvedUnits', label: 'Appr', width: '50px' }, { key: 'expiryDate', label: 'Expiry', width: '90px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' },
			{ label: 'Denied', value: 'denied' }, { label: 'Appeal', value: 'appeal' },
		],
		actions: [
			{ label: 'Approve', icon: '✓', handler: async (item, api, reload) => { const u = prompt('Approved units:', '1'); if (u) { await api.fetch(`/api/prior-auth/${item.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvedUnits: Number(u) }) }); reload(); } } },
			{ label: 'Deny', icon: '✗', handler: async (item, api, reload) => { const r = prompt('Denial reason:'); if (r) { await api.fetch(`/api/prior-auth/${item.id}/deny`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: r }) }); reload(); } } },
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => { if (confirm(`Delete?`)) { await api.fetch(`/api/prior-auth/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(AuthorizationsEditor.ID, group, t, th, s, a); }
}
