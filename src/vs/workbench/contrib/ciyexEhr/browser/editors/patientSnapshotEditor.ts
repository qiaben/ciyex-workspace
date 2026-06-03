/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IEditorOpenContext, EditorsOrder } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { PatientSnapshotEditorInput, PatientChartEditorInput, EncounterFormEditorInput } from './ciyexEditorInput.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { IEditorService, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditFieldDef, IListColumn, openListAndFormDialog, openRecordEditDialog, withTypeaheadSearch } from '../sidebarActions.js';
import { DEFAULT_FIELD_CONFIGS, FieldConfig, FieldDef } from './patientChartEditor.js';

interface QuickAction {
	icon: string;
	customClass?: string;
	title: string;
	onClick: () => void;
}

interface EntitySpec {
	title: string;
	/** Key into `DEFAULT_FIELD_CONFIGS` (chart editor schemas). */
	configKey: string;
	/** Base FHIR / API path used by the chart editor's `apiPath`. */
	basePath: string;
	/** True for FHIR resources scoped per-patient ({base}/patient/{id}). */
	fhirPatientScoped: boolean;
	/** True when the resource is *not* served by the generic FHIR controller
	 *  (e.g. medical-problems lives at /api/medical-problems/{patientId}). */
	nonFhir?: boolean;
	/** List columns shown in the popup's list view. */
	columns: IListColumn[];
	/** Endpoint that returns the existing rows for the patient. */
	listPath: (patientId: string) => string;
}

export class PatientSnapshotEditor extends EditorPane {

	static readonly ID = 'workbench.editor.ciyexPatientSnapshot';

	private root!: HTMLElement;
	private _currentPatientId = '';
	private _currentPatientName = '';
	private readonly _pageState = new Map<string, number>();
	/** IDs of records the user just deleted on this patient. Filtered out of
	 *  every list render until a fresh fetch confirms the server has removed
	 *  them — covers HAPI's eventual-consistency search index lag. */
	private readonly _deletedIds = new Map<string, Set<string>>();
	/** Records created in this session that the server's search index may not
	 *  have surfaced yet. Merged into every list render until a subsequent
	 *  fetch returns the same id, mirroring the chart editor's _pendingCreates. */
	private readonly _pendingCreates = new Map<string, Array<Record<string, unknown>>>();
	private static readonly PAGE_SIZE = 5;

	constructor(
		group: import('../../../../services/editor/common/editorGroupsService.js').IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(PatientSnapshotEditor.ID, group, telemetryService, themeService, storageService);
	}

	private _openChartAt(tab: string): void {
		if (!this._currentPatientId) { return; }
		const input = new PatientChartEditorInput(this._currentPatientId, this._currentPatientName, tab, /*focused*/ true);
		this._openInSidePanel(input);
	}

	// --- Popup CRUD --------------------------------------------------------
	//
	// Every entity surfaced on the snapshot dashboard routes through one
	// shared popup (`openListAndFormDialog`) that toggles between a list of
	// existing records and a create / edit form — the user sees a single
	// popup, never a side tab. Field schemas come from the chart editor's
	// `DEFAULT_FIELD_CONFIGS` so the popup form is exactly the same shape as
	// the full chart editor (no missing fields).

	private static readonly _ENTITY_REGISTRY: Record<string, EntitySpec> = {
		vitals: {
			title: 'Vitals', configKey: 'vitals', basePath: '/api/fhir-resource/vitals', fhirPatientScoped: true,
			columns: [
				{ key: 'recordedAt', label: 'Recorded', width: '140px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'bpSystolic', label: 'BP', width: '90px', format: (_v, r) => (r.bpSystolic && r.bpDiastolic) ? `${r.bpSystolic}/${r.bpDiastolic}` : '—' },
				{ key: 'pulse', label: 'Pulse', width: '60px' },
				{ key: 'temperatureC', label: 'Temp', width: '60px' },
				{ key: 'oxygenSaturation', label: 'O2 %', width: '60px' },
			],
			listPath: (pid) => `/api/fhir-resource/vitals/patient/${pid}?page=0&size=50`,
		},
		problems: {
			// V20: tab_field_config slug is 'medicalproblems', so writes go to
			// /api/fhir-resource/medicalproblems. Reads use the legacy
			// /api/medical-problems endpoint (returns { problemsList: [...] }).
			title: 'Problems', configKey: 'problems', basePath: '/api/fhir-resource/medicalproblems', fhirPatientScoped: true,
			columns: [
				{ key: 'conditionName', label: 'Condition', width: '2fr' },
				{ key: 'icdCode', label: 'ICD-10', width: '100px' },
				{ key: 'clinicalStatus', label: 'Status', width: '90px' },
				{ key: 'onsetDate', label: 'Onset', width: '110px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
			],
			listPath: (pid) => `/api/medical-problems/${pid}`,
		},
		medications: {
			title: 'Medications', configKey: 'medications', basePath: '/api/fhir-resource/medications', fhirPatientScoped: true,
			columns: [
				{ key: 'medicationName', label: 'Medication', width: '2fr' },
				{ key: 'dosage', label: 'Dosage', width: '100px' },
				{ key: 'frequency', label: 'Frequency', width: '120px' },
				{ key: 'status', label: 'Status', width: '90px' },
			],
			listPath: (pid) => `/api/fhir-resource/medications/patient/${pid}?page=0&size=50`,
		},
		insurance: {
			// Chart editor: tab.key 'insurance' → /api/fhir-resource/insurance
			// (no TAB_API_SLUG remap). The 'insurance-coverage' read path is a
			// legacy alias the snapshot uses for fetching; writes must go to
			// /api/fhir-resource/insurance to match backend tab_field_config.
			title: 'Insurance Coverage', configKey: 'insurance', basePath: '/api/fhir-resource/insurance', fhirPatientScoped: true,
			columns: [
				{ key: 'payerName', label: 'Payor', width: '2fr' },
				{ key: 'policyNumber', label: 'Member ID', width: '140px' },
				{ key: 'groupNumber', label: 'Group #', width: '120px' },
				{ key: 'insuranceType', label: 'Priority', width: '100px' },
			],
			listPath: (pid) => `/api/fhir-resource/insurance/patient/${pid}?page=0&size=20`,
		},
		labs: {
			title: 'Lab Orders', configKey: 'labs', basePath: '/api/fhir-resource/labs', fhirPatientScoped: true,
			columns: [
				{ key: 'testName', label: 'Test', width: '2fr' },
				{ key: 'testCode', label: 'LOINC', width: '110px' },
				{ key: 'collectionDate', label: 'Collected', width: '110px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'status', label: 'Status', width: '100px' },
			],
			listPath: (pid) => `/api/fhir-resource/labs/patient/${pid}?page=0&size=50`,
		},
		'visit-notes': {
			title: 'Visit Notes', configKey: 'visit-notes', basePath: '/api/fhir-resource/visit-notes', fhirPatientScoped: true,
			columns: [
				{ key: 'date', label: 'Date', width: '120px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'type', label: 'Type', width: '160px' },
				{ key: 'subject', label: 'Subject', width: '2fr' },
				{ key: 'status', label: 'Status', width: '110px' },
			],
			listPath: (pid) => `/api/fhir-resource/visit-notes/patient/${pid}?page=0&size=50`,
		},
		statements: {
			title: 'Statements', configKey: 'statements', basePath: '/api/fhir-resource/statements', fhirPatientScoped: true,
			columns: [
				{ key: 'statementNumber', label: 'Statement #', width: '160px' },
				{ key: 'statementDate', label: 'Date', width: '120px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'balance', label: 'Balance', width: '110px', format: (v) => { const n = parseFloat(String(v)); return isNaN(n) ? '—' : `$${n.toFixed(2)}`; } },
				{ key: 'status', label: 'Status', width: '110px' },
			],
			listPath: (pid) => `/api/fhir-resource/statements/patient/${pid}?page=0&size=20`,
		},
		claims: {
			title: 'Claims', configKey: 'claims', basePath: '/api/fhir-resource/claims', fhirPatientScoped: true,
			columns: [
				{ key: 'identifier', label: 'Claim #', width: '140px' },
				{ key: 'type', label: 'Type', width: '120px' },
				{ key: 'serviceDate', label: 'Service Date', width: '120px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'totalAmount', label: 'Total', width: '100px', format: (v) => { const n = parseFloat(String(v)); return isNaN(n) ? '—' : `$${n.toFixed(2)}`; } },
				{ key: 'status', label: 'Status', width: '110px' },
			],
			listPath: (pid) => `/api/fhir-resource/claims/patient/${pid}?page=0&size=50`,
		},
		payment: {
			title: 'Payments', configKey: 'payment', basePath: '/api/fhir-resource/payments', fhirPatientScoped: true,
			columns: [
				{ key: 'paymentDate', label: 'Date', width: '120px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'amount', label: 'Amount', width: '100px', format: (v) => { const n = parseFloat(String(v)); return isNaN(n) ? '—' : `$${n.toFixed(2)}`; } },
				{ key: 'paymentMethod', label: 'Method', width: '140px' },
				{ key: 'reference', label: 'Reference', width: '160px' },
				{ key: 'status', label: 'Status', width: '110px' },
			],
			listPath: (pid) => `/api/fhir-resource/payments/patient/${pid}?page=0&size=50`,
		},
		demographics: {
			title: 'Demographics', configKey: 'demographics', basePath: '/api/patients', fhirPatientScoped: false, nonFhir: true,
			columns: [
				{ key: 'firstName', label: 'First Name', width: '1fr' },
				{ key: 'lastName', label: 'Last Name', width: '1fr' },
				{ key: 'dateOfBirth', label: 'DOB', width: '110px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'gender', label: 'Sex', width: '80px' },
			],
			// Demographics is a single record (the patient), not a list — we
			// still surface it through the same popup so users get the full
			// field set, but the list view shows just that one record.
			listPath: (pid) => `/api/patients/${pid}`,
		},
		encounters: {
			title: 'Encounters', configKey: 'encounters', basePath: '/api/fhir-resource/encounters', fhirPatientScoped: true,
			columns: [
				{ key: 'startDate', label: 'Date', width: '120px', format: (v, r) => { const raw = v || r.start || r.periodStart || r.encounterDate; return raw ? new Date(String(raw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; } },
				{ key: 'type', label: 'Type', width: '120px' },
				{ key: 'reason', label: 'Reason', width: '2fr' },
				{ key: 'status', label: 'Status', width: '110px' },
			],
			listPath: (pid) => `/api/fhir-resource/encounters/patient/${pid}?page=0&size=50`,
		},
	};

	/**
	 * Flatten a chart-editor `FieldConfig` (sections + fields) into the
	 * flat `IEditFieldDef[]` shape the popup form understands. The chart
	 * editor uses richer types (`practitioner-search`, `code-search`,
	 * `boolean`, `phone`, `lookup`, …) — map them to the closest popup
	 * equivalent so the popup form still feels native.
	 */
	private _flattenChartConfig(cfg: FieldConfig): IEditFieldDef[] {
		const out: IEditFieldDef[] = [];
		for (const section of cfg.sections) {
			for (const f of section.fields) {
				if (f.localOnly) { continue; }
				out.push(this._toPopupField(f, section.columns));
			}
		}
		return out;
	}

	private _toPopupField(f: FieldDef, sectionCols: number): IEditFieldDef {
		// Width: chart uses colSpan / sectionCols; popup uses widthPct. A
		// half-row field (one column in a two-column section) is widthPct=50.
		const span = f.colSpan ?? 1;
		const widthPct = Math.min(100, Math.round((span / Math.max(1, sectionCols)) * 100));

		let kind: IEditFieldDef['kind'];
		let options: IEditFieldDef['options'];
		switch (f.type) {
			case 'textarea': kind = 'textarea'; break;
			case 'number': kind = 'number'; break;
			case 'email': kind = 'email'; break;
			case 'phone': kind = 'tel'; break;
			case 'date': kind = 'date'; break;
			case 'datetime': kind = 'date'; break; // popup has no datetime — fall back to date
			case 'select':
				kind = 'select';
				options = (f.options || []).map(o => typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label });
				break;
			case 'boolean':
				kind = 'select';
				options = [
					{ value: '', label: '—' },
					{ value: 'true', label: 'Yes' },
					{ value: 'false', label: 'No' },
				];
				break;
			case 'practitioner-search':
			case 'patient-search':
			case 'code-search':
			case 'lookup':
				kind = 'search';
				break;
			default:
				kind = 'text';
		}

		return {
			key: f.key,
			label: f.label,
			kind,
			options,
			required: f.required,
			placeholder: f.placeholder,
			widthPct,
		};
	}

	private _entityFields(entity: string): IEditFieldDef[] {
		// Encounters have a much richer clinical form than the 7-field chart
		// editor default — we surface the full EncounterFormEditor schema
		// (CC, HPI, Vitals, PMH, FH, SH, Assessment, Plan, Provider Notes,
		// Procedures) so the popup matches the dedicated encounter editor.
		if (entity === 'encounters') {
			return withTypeaheadSearch(PatientSnapshotEditor._encounterFormFields(), this.apiService);
		}
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		if (!reg) { return []; }
		const cfg = DEFAULT_FIELD_CONFIGS[reg.configKey];
		if (!cfg) { return []; }
		const fields = this._flattenChartConfig(cfg);
		return withTypeaheadSearch(fields, this.apiService);
	}

	/**
	 * Full encounter-form schema mirrored from {@link encounterFormEditor.ts}
	 * `_defaultSections`. Composite types (ros-grid, exam-grid, diagnosis-list,
	 * plan-items, procedure-list) collapse to textareas so the popup stays
	 * usable — users get a free-text capture that downstream encounter editing
	 * can promote into the structured grid components.
	 */
	private static _encounterFormFields(): IEditFieldDef[] {
		return [
			// --- Encounter meta ---
			{
				key: 'type', label: 'Encounter Type', kind: 'select', widthPct: 50, options: [
					{ value: 'AMB', label: 'Ambulatory' },
					{ value: 'EMER', label: 'Emergency' },
					{ value: 'HH', label: 'Home Health' },
					{ value: 'IMP', label: 'Inpatient' },
					{ value: 'OBSENC', label: 'Observation' },
					{ value: 'SS', label: 'Short Stay' },
					{ value: 'VR', label: 'Virtual' },
				]
			},
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'planned', label: 'Planned' },
					{ value: 'arrived', label: 'Arrived' },
					{ value: 'in-progress', label: 'In Progress' },
					{ value: 'finished', label: 'Finished' },
					{ value: 'cancelled', label: 'Cancelled' },
				]
			},
			{ key: 'startDate', label: 'Start Date', kind: 'date', required: true, widthPct: 50 },
			{ key: 'endDate', label: 'End Date', kind: 'date', widthPct: 50 },
			{ key: 'provider', label: 'Provider', kind: 'search', placeholder: 'Search Provider', widthPct: 100 },

			// --- Chief Complaint ---
			{ key: 'chiefComplaint', label: 'Chief Complaint', kind: 'textarea', required: true, placeholder: 'Why is the patient being seen today?', widthPct: 100 },

			// --- History of Present Illness ---
			{ key: 'hpi_onset', label: 'HPI: Onset', placeholder: 'When did it start?', widthPct: 50 },
			{ key: 'hpi_location', label: 'HPI: Location', placeholder: 'Where is it?', widthPct: 50 },
			{ key: 'hpi_duration', label: 'HPI: Duration', placeholder: 'How long?', widthPct: 50 },
			{ key: 'hpi_character', label: 'HPI: Character', placeholder: 'What does it feel like?', widthPct: 50 },
			{
				key: 'hpi_severity', label: 'HPI: Severity', kind: 'select', widthPct: 50, options: [
					{ value: '', label: '-' },
					{ value: 'mild', label: 'Mild' },
					{ value: 'moderate', label: 'Moderate' },
					{ value: 'severe', label: 'Severe' },
				]
			},
			{ key: 'hpi_timing', label: 'HPI: Timing', placeholder: 'Constant, intermittent?', widthPct: 50 },
			{ key: 'hpi_context', label: 'HPI: Context', placeholder: 'What were you doing?', widthPct: 50 },
			{ key: 'hpi_modifying', label: 'HPI: Modifying Factors', placeholder: 'What makes it better/worse?', widthPct: 50 },
			{ key: 'hpi_associated', label: 'HPI: Associated Signs/Symptoms', placeholder: 'Any other symptoms?', widthPct: 100 },
			{ key: 'hpi_narrative', label: 'HPI: Narrative', kind: 'textarea', placeholder: 'Free-text narrative...', widthPct: 100 },

			// --- Review of Systems (grid collapsed to textarea) ---
			{ key: 'ros_data', label: 'Review of Systems', kind: 'textarea', placeholder: 'Constitutional, HEENT, cardiovascular, respiratory, GI, GU, musculoskeletal, skin, neurological, psychiatric, endocrine, hematologic/lymphatic, allergic/immunologic...', widthPct: 100 },

			// --- Vitals ---
			{ key: 'vitals_bp_systolic', label: 'BP Systolic (mmHg)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_bp_diastolic', label: 'BP Diastolic (mmHg)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_heart_rate', label: 'Heart Rate (bpm)', kind: 'number', widthPct: 25 },
			// allow-any-unicode-next-line
			{ key: 'vitals_temperature', label: 'Temperature (°F)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_spo2', label: 'SpO2 (%)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_respiratory_rate', label: 'Respiratory Rate (/min)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_weight', label: 'Weight (kg)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_height', label: 'Height (cm)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_bmi', label: 'BMI', kind: 'number', placeholder: 'Auto-calculated', widthPct: 25 },
			{ key: 'vitals_pain_level', label: 'Pain Level (0-10)', kind: 'number', widthPct: 25 },
			{ key: 'vitals_notes', label: 'Vitals Notes', placeholder: 'Additional notes...', widthPct: 50 },

			// --- Physical Exam (grid collapsed to textarea) ---
			{ key: 'pe_data', label: 'Physical Exam', kind: 'textarea', placeholder: 'General, head/eyes/ears/nose/throat, neck, chest, cardiovascular, abdomen, extremities, neurological, skin, psychiatric...', widthPct: 100 },

			// --- Past Medical / Surgical History ---
			{ key: 'pmh_conditions', label: 'PMH: Medical Conditions', kind: 'textarea', placeholder: 'List past medical conditions...', widthPct: 50 },
			{ key: 'pmh_surgeries', label: 'PMH: Surgical History', kind: 'textarea', placeholder: 'List past surgeries...', widthPct: 50 },
			{ key: 'pmh_allergies', label: 'PMH: Allergies', kind: 'textarea', placeholder: 'List known allergies...', widthPct: 50 },
			{ key: 'pmh_medications', label: 'PMH: Current Medications', kind: 'textarea', placeholder: 'List current medications...', widthPct: 50 },

			// --- Family History ---
			{ key: 'fh_father', label: 'FH: Father', placeholder: 'Health conditions...', widthPct: 50 },
			{ key: 'fh_mother', label: 'FH: Mother', placeholder: 'Health conditions...', widthPct: 50 },
			{ key: 'fh_siblings', label: 'FH: Siblings', placeholder: 'Health conditions...', widthPct: 50 },
			{ key: 'fh_notes', label: 'FH: Additional Notes', kind: 'textarea', widthPct: 100 },

			// --- Social History ---
			{
				key: 'sh_smoking', label: 'SH: Smoking', kind: 'select', widthPct: 33, options: [
					{ value: '', label: '-' },
					{ value: 'never', label: 'Never' },
					{ value: 'former', label: 'Former' },
					{ value: 'current', label: 'Current' },
				]
			},
			{
				key: 'sh_alcohol', label: 'SH: Alcohol', kind: 'select', widthPct: 33, options: [
					{ value: '', label: '-' },
					{ value: 'none', label: 'None' },
					{ value: 'social', label: 'Social' },
					{ value: 'daily', label: 'Daily' },
				]
			},
			{
				key: 'sh_exercise', label: 'SH: Exercise', kind: 'select', widthPct: 33, options: [
					{ value: '', label: '-' },
					{ value: 'none', label: 'None' },
					{ value: '1-2', label: '1-2x/week' },
					{ value: '3-5', label: '3-5x/week' },
					{ value: 'daily', label: 'Daily' },
				]
			},
			{ key: 'sh_occupation', label: 'SH: Occupation', widthPct: 50 },
			{
				key: 'sh_drugs', label: 'SH: Recreational Drugs', kind: 'select', widthPct: 50, options: [
					{ value: '', label: '-' },
					{ value: 'none', label: 'None' },
					{ value: 'past', label: 'Past' },
					{ value: 'current', label: 'Current' },
				]
			},
			{ key: 'sh_notes', label: 'SH: Additional Notes', kind: 'textarea', widthPct: 100 },

			// --- Assessment & Diagnosis ---
			{ key: 'assessment_diagnoses', label: 'Diagnoses (ICD-10)', kind: 'textarea', placeholder: 'One diagnosis per line: e.g. E11.9 — Type 2 Diabetes', widthPct: 100 },
			{ key: 'assessment_notes', label: 'Assessment Notes', kind: 'textarea', placeholder: 'Clinical assessment narrative...', widthPct: 100 },

			// --- Plan ---
			{ key: 'plan_items', label: 'Plan Items', kind: 'textarea', placeholder: 'One action item per line...', widthPct: 100 },
			{ key: 'plan_medications', label: 'Plan: Medications Prescribed', kind: 'textarea', placeholder: 'Medications prescribed or changed...', widthPct: 50 },
			{ key: 'plan_labs', label: 'Plan: Labs / Imaging Ordered', kind: 'textarea', placeholder: 'Lab tests, imaging, or diagnostics ordered...', widthPct: 50 },
			{ key: 'plan_referrals', label: 'Plan: Referrals', kind: 'textarea', placeholder: 'Specialist referrals...', widthPct: 50 },
			{ key: 'plan_followup', label: 'Plan: Follow-up', placeholder: 'Return in 2 weeks, PRN, etc.', widthPct: 50 },
			{ key: 'plan_patient_education', label: 'Plan: Patient Education', kind: 'textarea', placeholder: 'Education and instructions provided...', widthPct: 100 },
			{ key: 'plan_notes', label: 'Plan Notes', kind: 'textarea', placeholder: 'Additional plan details...', widthPct: 100 },

			// --- Provider Notes ---
			{ key: 'provider_narrative', label: 'Provider Narrative', kind: 'textarea', placeholder: 'Free-text provider notes...', widthPct: 100 },

			// --- Procedures ---
			{ key: 'procedures_data', label: 'Procedures (CPT/HCPCS)', kind: 'textarea', placeholder: 'One procedure per line: e.g. 99213 — Office visit, established patient', widthPct: 100 },
			{ key: 'procedures_notes', label: 'Procedure Notes', kind: 'textarea', placeholder: 'Procedure details and notes...', widthPct: 100 },

			// --- Reason (kept for parity with the simple FHIR Encounter resource) ---
			{ key: 'reason', label: 'Reason for Visit', placeholder: 'Reason summary', widthPct: 100 },
		];
	}

	/**
	 * Pull the existing records for an entity. Demographics returns a
	 * single-element array so the list view still shows something.
	 * Filters out IDs we've just deleted so HAPI's eventual-consistency
	 * search index lag doesn't show records that were already removed.
	 */
	private async _loadEntityList(entity: string): Promise<Array<Record<string, unknown>>> {
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		if (!reg || !this._currentPatientId) { return []; }
		const raw = await this._fetch(reg.listPath(this._currentPatientId));
		if (!raw) { return []; }
		// Demographics returns the patient object directly.
		if (entity === 'demographics') {
			const p = (raw.data ?? raw) as Record<string, unknown>;
			return p ? [p] : [];
		}
		const inner = (raw.data ?? raw) as Record<string, unknown>;
		const arr = (inner.problemsList || inner.allergiesList || inner.content || inner.list || inner.items || inner.records || (Array.isArray(inner) ? inner : Array.isArray(raw) ? raw : [])) as unknown;
		const items = Array.isArray(arr) ? arr as Array<Record<string, unknown>> : [];
		return this._mergePending(entity, this._filterDeleted(entity, items));
	}

	private _filterDeleted(entity: string, items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const set = this._deletedIds.get(entity);
		if (!set || set.size === 0) { return items; }
		const remaining: typeof items = [];
		const stillPresent = new Set<string>();
		for (const r of items) {
			const id = String(r.id ?? r.fhirId ?? '');
			if (id && set.has(id)) {
				stillPresent.add(id);
				continue;
			}
			remaining.push(r);
		}
		// Drop tracked IDs the server no longer returns — the index caught up,
		// so we no longer need to filter them locally.
		for (const id of Array.from(set)) {
			if (!stillPresent.has(id)) { set.delete(id); }
		}
		return remaining;
	}

	private _trackDeleted(entity: string, id: string): void {
		let set = this._deletedIds.get(entity);
		if (!set) { set = new Set<string>(); this._deletedIds.set(entity, set); }
		set.add(id);
	}

	private _trackCreated(entity: string, record: Record<string, unknown>): void {
		const id = String(record.id ?? record.fhirId ?? '');
		if (!id) { return; }
		const arr = this._pendingCreates.get(entity) || [];
		// Replace any prior entry with the same id (covers create-then-edit).
		const filtered = arr.filter(r => String(r.id ?? r.fhirId ?? '') !== id);
		filtered.unshift(record);
		this._pendingCreates.set(entity, filtered);
	}

	private _mergePending(entity: string, items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const pending = this._pendingCreates.get(entity);
		if (!pending || pending.length === 0) { return items; }
		const seen = new Set(items.map(r => String(r.id ?? r.fhirId ?? '')).filter(Boolean));
		const stillPending: typeof items = [];
		const out = [...items];
		for (const p of pending) {
			const pid = String(p.id ?? p.fhirId ?? '');
			if (pid && seen.has(pid)) { continue; } // server caught up
			stillPending.push(p);
			out.unshift(p);
		}
		if (stillPending.length) { this._pendingCreates.set(entity, stillPending); }
		else { this._pendingCreates.delete(entity); }
		return out;
	}

	/**
	 * Two-step encounter save (matches EncounterFormEditor):
	 *
	 *  1. If no existing id, POST `/api/{patientId}/encounters` to mint a real
	 *     FHIR Encounter resource. HAPI rejects compositions that reference
	 *     `Encounter/new`, so we must create the encounter first.
	 *  2. POST or PUT `/api/fhir-resource/encounter-form/patient/{pid}` (with
	 *     `?encounterRef={encounterId}` on create) to persist the rich
	 *     clinical fields (CC, HPI, ROS, vitals, PE, PMH, FH, SH, assessment,
	 *     plan, provider narrative, procedures).
	 */
	private async _saveEncounterComposition(values: Record<string, string>, existingId: string | undefined): Promise<Response> {
		const pid = this._currentPatientId;
		let encounterId = existingId || '';
		if (!encounterId) {
			const reason = String(values['chiefComplaint'] || values['reason'] || '').trim();
			const startDate = values['startDate'] || new Date().toISOString();
			const createRes = await this.apiService.fetch(`/api/${pid}/encounters`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					visitCategory: values['type'] || 'AMB',
					encounterDate: startDate,
					status: 'UNSIGNED',
					reasonForVisit: reason,
				}),
			});
			if (!createRes.ok) { return createRes; }
			const created = await createRes.json().catch(() => null);
			encounterId = String(created?.data?.id || created?.id || '');
			if (!encounterId) { throw new Error('Encounter created but server returned no id'); }
		}
		const url = existingId
			? `/api/fhir-resource/encounter-form/patient/${pid}/${encounterId}`
			: `/api/fhir-resource/encounter-form/patient/${pid}?encounterRef=${encounterId}`;
		return this.apiService.fetch(url, {
			method: existingId ? 'PUT' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...values, patientId: pid, id: encounterId }),
		});
	}

	/** Build the create / update URL the same way the full chart editor does. */
	private _saveUrl(entity: string, existingId: string | undefined): { url: string; method: 'POST' | 'PUT' } {
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		const isEdit = !!existingId;
		const ep = reg.basePath;
		if (reg.nonFhir) {
			// Non-FHIR: medical-problems / patients use plain {base} or {base}/{id}.
			if (entity === 'demographics') {
				return { url: `${ep}/${this._currentPatientId}`, method: 'PUT' };
			}
			return { url: isEdit ? `${ep}/${existingId}` : ep, method: isEdit ? 'PUT' : 'POST' };
		}
		if (reg.fhirPatientScoped) {
			return {
				url: isEdit ? `${ep}/patient/${this._currentPatientId}/${existingId}` : `${ep}/patient/${this._currentPatientId}`,
				method: isEdit ? 'PUT' : 'POST',
			};
		}
		return { url: isEdit ? `${ep}/${existingId}` : ep, method: isEdit ? 'PUT' : 'POST' };
	}

	/** Open the unified list+form popup for an entity. */
	private _openManager(entity: string, initialMode: 'list' | 'create' = 'list'): void {
		if (!this._currentPatientId) { return; }
		// Demographics is the patient record itself — there is no list to manage,
		// so clicking it should jump straight to the patient's Demographics tab
		// in the chart editor rather than surfacing a single-record popup.
		if (entity === 'demographics') { this._openChartAt('demographics'); return; }
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		if (!reg) { this._openChartAt(entity); return; }
		const fields = this._entityFields(entity);
		if (fields.length === 0) { this._openChartAt(entity); return; }

		openListAndFormDialog({
			title: reg.title,
			themeAnchor: this.root,
			fields,
			listColumns: reg.columns,
			initialMode: entity === 'demographics' ? 'create' : initialMode,
			loadList: () => this._loadEntityList(entity),
			saveRecord: async (next, existingId) => {
				// Encounters need a two-step save (mirrors EncounterFormEditor):
				//   1. POST /api/{patientId}/encounters to mint a real Encounter id
				//   2. POST /api/fhir-resource/encounter-form/patient/{pid}?encounterRef={id}
				//      to persist the clinical composition (CC, HPI, ROS, …).
				// Without step 1, the composition references "Encounter/new" and
				// HAPI rejects with HAPI-1094 "Resource Encounter/new not found".
				if (entity === 'encounters') {
					const res = await this._saveEncounterComposition(next, existingId);
					if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
					let saved: Record<string, unknown> | null = null;
					try {
						const j = await res.json();
						const cand = (j?.data ?? j) as Record<string, unknown> | null;
						if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
					} catch { /* */ }
					if (!existingId && saved) { this._trackCreated(entity, { ...next, ...saved }); }
					this.notificationService.notify({ severity: Severity.Info, message: `Encounter ${existingId ? 'updated' : 'created'}.` });
					this._rerender();
					return;
				}
				const { url, method } = this._saveUrl(entity, existingId);
				const payload: Record<string, unknown> = { ...next };
				// Backend `vitals` POST without recordedAt is rejected by the
				// FhirPathMapper validation — chart editor injects this exact
				// fallback, so mirror it here.
				if (entity === 'vitals' && method === 'POST' && !payload.recordedAt) {
					payload.recordedAt = new Date().toISOString();
				}
				if (!reg.nonFhir && entity !== 'demographics') {
					payload.patientId = this._currentPatientId;
				}
				const res = await this.apiService.fetch(url, {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
				// Read the saved record off the response so we can show it on
				// the dashboard immediately, mirroring the chart editor's
				// optimistic-merge pattern. FHIR search indexing is eventually
				// consistent — without this, the just-created row would not
				// appear until HAPI caught up.
				let saved: Record<string, unknown> | null = null;
				try {
					const j = await res.json();
					const cand = (j?.data ?? j) as Record<string, unknown> | null;
					if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
				} catch { /* response body wasn't JSON */ }
				if (method === 'POST' && saved) {
					this._trackCreated(entity, { ...payload, ...saved });
				}
				this.notificationService.notify({ severity: Severity.Info, message: `${reg.title.replace(/s$/, '')} ${method === 'POST' ? 'created' : 'updated'}.` });
				this._rerender();
			},
			deleteRecord: entity === 'demographics' ? undefined : async (id) => {
				const confirm = await this.dialogService.confirm({
					message: `Delete this ${reg.title.replace(/s$/, '').toLowerCase()}?`,
					type: 'warning',
					primaryButton: 'Delete',
				});
				if (!confirm.confirmed) { return; }
				const delUrl = reg.fhirPatientScoped
					? `${reg.basePath}/patient/${this._currentPatientId}/${id}`
					: `${reg.basePath}/${id}`;
				const res = await this.apiService.fetch(delUrl, { method: 'DELETE' });
				if (!res.ok) { throw new Error(`Delete failed (${res.status})`); }
				this._trackDeleted(entity, id);
				this.notificationService.notify({ severity: Severity.Info, message: `${reg.title.replace(/s$/, '')} deleted.` });
				this._rerender();
			},
			onChanged: () => this._rerender(),
		});
	}

	private _openCreateModal(entity: string): void {
		this._openManager(entity, 'create');
	}

	private _openEditModal(entity: string, item: Record<string, unknown>): void {
		if (!this._currentPatientId) { return; }
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		if (!reg) { return; }
		const fields = this._entityFields(entity);
		if (fields.length === 0) { return; }
		openListAndFormDialog({
			title: reg.title,
			themeAnchor: this.root,
			fields,
			listColumns: reg.columns,
			initialMode: 'edit',
			initialItem: item,
			loadList: () => this._loadEntityList(entity),
			saveRecord: async (next, existingId) => {
				if (entity === 'encounters') {
					const res = await this._saveEncounterComposition(next, existingId);
					if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
					let saved: Record<string, unknown> | null = null;
					try {
						const j = await res.json();
						const cand = (j?.data ?? j) as Record<string, unknown> | null;
						if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
					} catch { /* */ }
					this._trackCreated(entity, { ...item, ...next, ...(saved || {}) });
					this.notificationService.notify({ severity: Severity.Info, message: 'Encounter updated.' });
					this._rerender();
					return;
				}
				const { url, method } = this._saveUrl(entity, existingId);
				const payload: Record<string, unknown> = { ...item, ...next };
				if (!reg.nonFhir && entity !== 'demographics') {
					payload.patientId = this._currentPatientId;
				}
				const res = await this.apiService.fetch(url, {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
				// Track the updated record so the dashboard reflects the edit
				// immediately, before the FHIR search index catches up.
				let saved: Record<string, unknown> | null = null;
				try {
					const j = await res.json();
					const cand = (j?.data ?? j) as Record<string, unknown> | null;
					if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
				} catch { /* */ }
				this._trackCreated(entity, { ...payload, ...(saved || {}) });
				this.notificationService.notify({ severity: Severity.Info, message: `${reg.title.replace(/s$/, '')} updated.` });
				this._rerender();
			},
			deleteRecord: entity === 'demographics' ? undefined : async (id) => {
				const confirm = await this.dialogService.confirm({
					message: `Delete this ${reg.title.replace(/s$/, '').toLowerCase()}?`,
					type: 'warning',
					primaryButton: 'Delete',
				});
				if (!confirm.confirmed) { return; }
				const delUrl = reg.fhirPatientScoped
					? `${reg.basePath}/patient/${this._currentPatientId}/${id}`
					: `${reg.basePath}/${id}`;
				const res = await this.apiService.fetch(delUrl, { method: 'DELETE' });
				if (!res.ok) { throw new Error(`Delete failed (${res.status})`); }
				this._trackDeleted(entity, id);
				this.notificationService.notify({ severity: Severity.Info, message: `${reg.title.replace(/s$/, '')} deleted.` });
				this._rerender();
			},
			onChanged: () => this._rerender(),
		});
	}

	private async _deleteItem(entity: string, item: Record<string, unknown>): Promise<void> {
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		if (!reg) { return; }
		const id = String(item.id || item.fhirId || '');
		if (!id) { return; }
		const r = await this.dialogService.confirm({
			message: `Delete this ${reg.title.replace(/s$/, '').toLowerCase()}?`,
			type: 'warning',
			primaryButton: 'Delete',
		});
		if (!r.confirmed) { return; }
		try {
			const delUrl = reg.fhirPatientScoped
				? `${reg.basePath}/patient/${this._currentPatientId}/${id}`
				: `${reg.basePath}/${id}`;
			const res = await this.apiService.fetch(delUrl, { method: 'DELETE' });
			if (!res.ok) { throw new Error(`Delete failed (${res.status})`); }
			this._trackDeleted(entity, id);
			this.notificationService.notify({ severity: Severity.Info, message: `${reg.title.replace(/s$/, '')} deleted.` });
			this._rerender();
		} catch (err) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}


	private _findReusableSideEditor(): { editor: EditorInput; groupId: number } | undefined {
		// Any focused PatientChartEditorInput or EncounterFormEditorInput for
		// this patient counts as the snapshot's reusable side-panel slot.
		for (const { editor, groupId } of this.editorService.getEditors(EditorsOrder.SEQUENTIAL)) {
			if (editor instanceof PatientChartEditorInput && editor.focused && editor.patientId === this._currentPatientId) {
				return { editor, groupId };
			}
			if (editor instanceof EncounterFormEditorInput && editor.patientId === this._currentPatientId) {
				return { editor, groupId };
			}
		}
		return undefined;
	}

	private _openInSidePanel(input: EditorInput): void {
		const existing = this._findReusableSideEditor();
		if (existing) {
			void this.editorService.replaceEditors([{ editor: existing.editor, replacement: input }], existing.groupId);
			return;
		}
		this.editorService.openEditor(input, {}, SIDE_GROUP);
	}

	private _paginate<T>(key: string, items: T[]): { page: T[]; pageIdx: number; pageCount: number; total: number } {
		const total = items.length;
		const pageCount = Math.max(1, Math.ceil(total / PatientSnapshotEditor.PAGE_SIZE));
		const pageIdx = Math.min(this._pageState.get(key) ?? 0, pageCount - 1);
		const start = pageIdx * PatientSnapshotEditor.PAGE_SIZE;
		return { page: items.slice(start, start + PatientSnapshotEditor.PAGE_SIZE), pageIdx, pageCount, total };
	}

	private _renderPagerFooter(parent: HTMLElement, key: string, pageIdx: number, pageCount: number, total: number): void {
		if (pageCount <= 1) { return; }
		const bar = DOM.append(parent, DOM.$('div'));
		bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;margin-top:6px;border-top:1px solid var(--vscode-editorWidget-border);font-size:11px;color:var(--vscode-descriptionForeground);';

		const info = DOM.append(bar, DOM.$('span'));
		const from = pageIdx * PatientSnapshotEditor.PAGE_SIZE + 1;
		const to = Math.min(from + PatientSnapshotEditor.PAGE_SIZE - 1, total);
		// allow-any-unicode-next-line
		info.textContent = `${from}–${to} of ${total}`;

		const btns = DOM.append(bar, DOM.$('div'));
		btns.style.cssText = 'display:flex;gap:4px;align-items:center;';

		const mkBtn = (label: string, disabled: boolean, onClick: () => void): void => {
			const b = DOM.append(btns, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			b.disabled = disabled;
			b.style.cssText = `min-width:24px;height:22px;padding:0 6px;font-size:11px;border-radius:4px;border:1px solid var(--vscode-editorWidget-border);background:${disabled ? 'transparent' : 'var(--vscode-button-secondaryBackground)'};color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? '0.4' : '1'};`;
			b.addEventListener('click', (e) => { e.stopPropagation(); if (!disabled) { onClick(); } });
		};
		// allow-any-unicode-next-line
		mkBtn('‹', pageIdx <= 0, () => { this._pageState.set(key, pageIdx - 1); this._rerender(); });
		const pageLbl = DOM.append(btns, DOM.$('span'));
		pageLbl.textContent = `${pageIdx + 1} / ${pageCount}`;
		pageLbl.style.cssText = 'padding:0 6px;font-weight:600;color:var(--vscode-foreground);';
		// allow-any-unicode-next-line
		mkBtn('›', pageIdx >= pageCount - 1, () => { this._pageState.set(key, pageIdx + 1); this._rerender(); });
	}

	private _lastRenderArgs: { patientId: string; patientName: string; appointmentId?: string } | null = null;
	private _rerender(): void {
		if (!this._lastRenderArgs) { return; }
		const { patientId, patientName, appointmentId } = this._lastRenderArgs;
		void this._loadAndRender(patientId, patientName, appointmentId);
	}


	protected override createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-snapshot.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,"Segoe UI",sans-serif);font-size:13px;';
	}

	override async setInput(input: PatientSnapshotEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) { return; }
		if (this._currentPatientId !== input.patientId) {
			this._pageState.clear();
		}
		this._currentPatientId = input.patientId;
		this._currentPatientName = input.patientName;
		DOM.clearNode(this.root);
		this._renderSkeleton(input.patientName);
		await this._loadAndRender(input.patientId, input.patientName, input.appointmentId);
	}

	private _getInitials(name: string): string {
		const parts = (name || '?').trim().split(/\s+/);
		if (parts.length >= 2) {
			return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
		}
		return parts[0].charAt(0).toUpperCase();
	}

	private _renderSkeleton(name: string): void {
		const hdr = DOM.append(this.root, DOM.$('.snap-header'));
		hdr.style.cssText = 'padding:18px 24px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;gap:14px;';
		const av = DOM.append(hdr, DOM.$('div'));
		av.style.cssText = 'width:48px;height:48px;border-radius:50%;background:var(--vscode-button-background,#0e639c);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;flex-shrink:0;';
		av.textContent = this._getInitials(name);
		const info = DOM.append(hdr, DOM.$('div'));
		info.style.cssText = 'flex:1;min-width:0;';
		const nameEl = DOM.append(info, DOM.$('div'));
		nameEl.textContent = name || 'Loading…';
		nameEl.style.cssText = 'font-size:20px;font-weight:700;color:var(--vscode-editor-foreground);';
		const sub = DOM.append(info, DOM.$('div'));
		sub.textContent = 'Loading patient data…';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:3px;';
	}

	private async _fetchTodayAppointment(patientId: string, appointmentId?: string): Promise<Record<string, unknown> | null> {
		// If a specific appointment ID is provided, fetch it directly.
		if (appointmentId) {
			const raw = await this._fetch(`/api/appointments/${appointmentId}`);
			if (raw) {
				// Unwrap { data: {...} } if needed
				return ((raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data))
					? raw.data as Record<string, unknown>
					: raw);
			}
		}
		// Fallback: fetch today's appointments for this patient.
		const today = new Date().toISOString().split('T')[0];
		const urls = [
			`/api/appointments?patientId=${patientId}&dateFrom=${today}&dateTo=${today}&page=0&size=5`,
			`/api/appointments?patientId=${patientId}&date=${today}&page=0&size=5`,
			`/api/fhir-resource/appointments?patientId=${patientId}&dateFrom=${today}&dateTo=${today}&page=0&size=5`,
		];
		for (const url of urls) {
			try {
				const raw = await this._fetch(url);
				if (!raw) { continue; }
				const inner = (raw.data ?? raw) as Record<string, unknown>;
				const arr: Record<string, unknown>[] = (inner.content || inner.list || inner.items || inner.records ||
					(Array.isArray(inner) ? inner : Array.isArray(raw) ? raw : [])) as Record<string, unknown>[];
				if (arr.length > 0) { return arr[0]; }
			} catch { /* try next */ }
		}
		return null;
	}

	private async _loadAndRender(patientId: string, patientName: string, appointmentId?: string): Promise<void> {
		this._lastRenderArgs = { patientId, patientName, appointmentId };
		const [patient, conditions, medications, vitals, encounters, labs, payments, statements, coverage] = await Promise.allSettled([
			this._fetch(`/api/patients/${patientId}`),
			this._fetch(`/api/medical-problems/${patientId}`),
			this._fetch(`/api/fhir-resource/medications/patient/${patientId}?page=0&size=50`),
			this._fetch(`/api/fhir-resource/vitals/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/encounters/patient/${patientId}?page=0&size=50`),
			this._fetch(`/api/fhir-resource/labs/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/payments/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/statements/patient/${patientId}?page=0&size=1`),
			this._fetch(`/api/fhir-resource/insurance-coverage/patient/${patientId}?page=0&size=1`),
		]);

		const apt = await this._fetchTodayAppointment(patientId, appointmentId);

		if (this._currentPatientId !== patientId) { return; }

		// Patient API may wrap the body in { data: {...} } depending on the
		// backend version — unwrap here so the header can read fields like
		// dateOfBirth / mrn directly.
		const patientRaw = patient.status === 'fulfilled' ? patient.value : null;
		const p = ((patientRaw?.data ?? patientRaw) as Record<string, unknown> | null);
		const conds = this._mergePending('problems', this._filterDeleted('problems', this._list(conditions)));
		const meds = this._mergePending('medications', this._filterDeleted('medications', this._list(medications)));
		const vit = this._mergePending('vitals', this._filterDeleted('vitals', this._list(vitals)));
		const encs = this._mergePending('encounters', this._filterDeleted('encounters', this._list(encounters)));
		const labList = this._mergePending('labs', this._filterDeleted('labs', this._list(labs)));
		const payList = this._mergePending('payment', this._filterDeleted('payment', this._list(payments)));
		const stmtList = this._list(statements);
		const cov = this._list(coverage);

		DOM.clearNode(this.root);
		this._renderHeader(p, patientName, apt, cov);
		this._renderGrid(p, conds, meds, vit, encs, labList, payList, stmtList, apt);
	}

	private _renderHeader(p: Record<string, unknown> | null, fallbackName: string, apt: Record<string, unknown> | null, cov: Record<string, unknown>[]): void {
		const name = (p?.name || p?.fullName || p?.displayName || `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || fallbackName) as string;
		const dob = p?.dateOfBirth || p?.birthDate || p?.dob || '';
		const mrn = p?.mrn || p?.medicalRecordNumber || p?.id || '';
		const gender = p?.gender || p?.sex || '';
		let age = '';
		if (dob) {
			try {
				const y = new Date().getFullYear() - new Date(String(dob)).getFullYear();
				age = `${y} yrs`;
			} catch { /* */ }
		}
		const allergies = (p?.allergies as string[] | undefined) || [];
		const insurance = (cov[0] as Record<string, unknown> | undefined);
		const insName = insurance?.payorName || insurance?.name || insurance?.coverageName || '';

		const hdr = DOM.append(this.root, DOM.$('.snap-header'));
		hdr.style.cssText = 'position:relative;padding:18px 24px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);background:var(--vscode-editor-background);';

		// Left-aligned identity block: avatar on the left, name + meta row
		// (DOB / MRN / sex / insurance) stacked to its right. Action icons
		// are anchored top-right via absolute positioning.
		const idRow = DOM.append(hdr, DOM.$('div'));
		idRow.style.cssText = 'display:flex;align-items:center;gap:14px;padding-right:260px;';

		const av = DOM.append(idRow, DOM.$('div'));
		av.style.cssText = 'width:52px;height:52px;border-radius:50%;background:var(--vscode-button-background,#0e639c);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;flex-shrink:0;';
		av.textContent = this._getInitials(name);

		const info = DOM.append(idRow, DOM.$('div'));
		info.style.cssText = 'flex:1;min-width:0;';

		const nameEl = DOM.append(info, DOM.$('div'));
		nameEl.textContent = name;
		nameEl.style.cssText = 'font-size:22px;font-weight:700;color:var(--vscode-editor-foreground);';

		const metaRow = DOM.append(info, DOM.$('div'));
		metaRow.style.cssText = 'display:flex;gap:14px;margin-top:4px;flex-wrap:wrap;font-size:12px;color:var(--vscode-descriptionForeground);';
		const meta: string[] = [];
		if (dob) {
			const dobStr = new Date(String(dob)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
			meta.push(age ? `DOB ${dobStr} (${age})` : `DOB ${dobStr}`);
		}
		if (mrn) { meta.push(`MRN ${mrn}`); }
		if (gender) { meta.push(String(gender).charAt(0).toUpperCase() + String(gender).slice(1)); }
		// allow-any-unicode-next-line
		if (insName) { meta.push(`🏥 ${insName}`); }
		for (const m of meta) {
			const sp = DOM.append(metaRow, DOM.$('span'));
			sp.textContent = m;
			sp.style.cssText = 'font-weight:500;';
		}

		if (allergies.length > 0) {
			const allergyRow = DOM.append(info, DOM.$('div'));
			allergyRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;';
			for (const a of allergies) {
				const badge = DOM.append(allergyRow, DOM.$('span'));
				badge.textContent = `⚠ ${a}`;
				badge.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;background:#ef444420;color:#ef4444;font-weight:600;';
			}
		}

		this._renderHeaderActions(hdr);
	}

	private _renderHeaderActions(hdr: HTMLElement): void {
		const actions = DOM.append(hdr, DOM.$('.snap-header-actions'));
		actions.style.cssText = 'position:absolute;top:18px;right:24px;display:flex;align-items:center;gap:6px;flex-shrink:0;';

		const primary: QuickAction[] = [
			{ icon: 'add', title: 'New Encounter', onClick: () => this._openCreateModal('encounters') },
			{ icon: '', customClass: 'ehr-patient-icon', title: 'Open Demographics', onClick: () => this._openChartAt('demographics') },
			{ icon: 'credit-card', title: 'Add Payment / Statement', onClick: () => this._openCreateModal('payment') },
			{ icon: 'file-text', title: 'Billing & Claims', onClick: () => this._openCreateModal('claims') },
		];
		for (const a of primary) {
			this._renderIconBtn(actions, a);
		}

		const overflowItems: QuickAction[] = [
			{ icon: 'pulse', title: 'Record Vitals', onClick: () => this._openCreateModal('vitals') },
			{ icon: 'warning', title: 'Add Problem', onClick: () => this._openCreateModal('problems') },
			{ icon: 'symbol-method', title: 'Add Medication', onClick: () => this._openCreateModal('medications') },
			{ icon: 'shield', title: 'Add Insurance Coverage', onClick: () => this._openCreateModal('insurance') },
			{ icon: 'beaker', title: 'Order Lab', onClick: () => this._openCreateModal('labs') },
			{ icon: 'note', title: 'Add Visit Note', onClick: () => this._openCreateModal('visit-notes') },
			{ icon: 'file-symlink-file', title: 'Add Statement', onClick: () => this._openCreateModal('statements') },
			{ icon: 'file-binary', title: 'Submit Claim', onClick: () => this._openCreateModal('claims') },
		];
		this._renderOverflowBtn(actions, overflowItems);
	}

	private _renderIconBtn(parent: HTMLElement, a: QuickAction): HTMLButtonElement {
		const b = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		b.title = a.title;
		b.setAttribute('aria-label', a.title);
		b.style.cssText = 'width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;cursor:pointer;color:var(--vscode-foreground);transition:background 0.15s;';
		let ico: HTMLElement;
		if (a.customClass) {
			ico = DOM.append(b, DOM.$('span.' + a.customClass)) as HTMLElement;
			ico.style.cssText = 'width:20px;height:20px;';
		} else {
			ico = DOM.append(b, DOM.$('span.codicon.codicon-' + a.icon)) as HTMLElement;
			ico.style.cssText = 'font-size:20px;';
		}
		b.addEventListener('mouseenter', () => { b.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.22))'; });
		b.addEventListener('mouseleave', () => { b.style.background = 'var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08))'; });
		b.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
		return b;
	}

	private _renderOverflowBtn(parent: HTMLElement, items: QuickAction[]): void {
		const wrap = DOM.append(parent, DOM.$('div'));
		wrap.style.cssText = 'position:relative;';
		const trigger = this._renderIconBtn(wrap, {
			icon: 'ellipsis',
			title: 'More actions',
			onClick: () => { /* toggle below */ },
		});

		const menu = DOM.append(wrap, DOM.$('div'));
		menu.style.cssText = 'position:absolute;top:44px;right:0;min-width:220px;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));border:1px solid var(--vscode-menu-border,var(--vscode-editorWidget-border));border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.28);padding:4px;z-index:1000;display:none;';

		const closeMenu = (): void => { menu.style.display = 'none'; };
		const docClick = (e: Event): void => {
			if (!wrap.contains(e.target as Node)) { closeMenu(); }
		};
		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			const open = menu.style.display === 'block';
			if (open) {
				closeMenu();
				DOM.getActiveWindow().document.removeEventListener('click', docClick);
			} else {
				menu.style.display = 'block';
				DOM.getActiveWindow().document.addEventListener('click', docClick);
			}
		});

		for (const item of items) {
			const row = DOM.append(menu, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:13px;color:var(--vscode-menu-foreground,var(--vscode-foreground));';
			const ico = DOM.append(row, DOM.$('span.codicon.codicon-' + item.icon));
			(ico as HTMLElement).style.cssText = 'font-size:14px;color:var(--vscode-descriptionForeground);';
			const lbl = DOM.append(row, DOM.$('span'));
			lbl.textContent = item.title;
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				closeMenu();
				DOM.getActiveWindow().document.removeEventListener('click', docClick);
				item.onClick();
			});
		}
	}

	private async _updateAppointmentStatus(id: string, status: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${id}/status`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status }),
			});
		} catch { /* */ }
	}

	private async _updateAppointmentRoom(id: string, room: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/appointments/${id}/room`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ room }),
			});
		} catch { /* */ }
	}

	private async _fetchRoomOptions(): Promise<string[]> {
		const fallback = ['Exam 1', 'Exam 2', 'Exam 3', 'Exam 4', 'Lab', 'Procedure Room', 'Triage'];
		for (const url of ['/api/rooms', '/api/appointments/room-options']) {
			try {
				const res = await this.apiService.fetch(url);
				if (!res.ok) { continue; }
				const data = await res.json();
				const arr = (data?.data || data || []) as Record<string, string>[];
				const rooms = arr.map((r: Record<string, string>) => r.name || r.roomName || r.id || String(r)).filter(Boolean);
				if (rooms.length > 0) { return rooms; }
			} catch { /* try next */ }
		}
		return fallback;
	}

	/** Resolve a human visit-type label from the raw appointment, tolerating the
	 *  FHIR CodeableConcept blob the appointments API sometimes returns. */
	private _apptTypeStr(apt: Record<string, unknown>): string {
		const t = apt.visitType || apt.appointmentType || apt.type;
		if (typeof t === 'string' && t.trim()) { return t; }
		if (t && typeof t === 'object') {
			const cc = t as { text?: string; coding?: Array<{ display?: string; code?: string }> };
			return cc.text || cc.coding?.[0]?.display || cc.coding?.[0]?.code || '—';
		}
		return '—';
	}

	/** PUT a new appointment status, then refresh the dashboard so the card,
	 *  status pill and available actions all reflect the new state. */
	private async _changeApptStatus(id: string, status: string): Promise<void> {
		if (!id) { return; }
		await this._updateAppointmentStatus(id, status);
		this._rerender();
	}

	/** Create a FHIR encounter from the appointment, open it, then refresh. */
	private async _createEncounterFromAppointment(apt: Record<string, unknown>): Promise<void> {
		const id = String(apt.id || apt.appointmentId || '');
		if (!id) { return; }
		try {
			const res = await this.apiService.fetch(`/api/appointments/${id}/encounter`, { method: 'POST' });
			let encounterId: string | undefined;
			if (res.ok) {
				try {
					const data = await res.json();
					const payload = (data?.data ?? data) as Record<string, unknown>;
					encounterId = (payload?.id || payload?.encounterId) as string | undefined;
				} catch { /* empty body — fall through to refresh */ }
			}
			if (encounterId) {
				void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, String(encounterId), this._currentPatientName);
			}
			this._rerender();
		} catch {
			this.notificationService.notify({ severity: Severity.Error, message: 'Failed to create encounter from appointment.' });
		}
	}

	/** Fetch provider display names for the edit dialog dropdown. */
	private async _fetchProviderOptions(): Promise<string[]> {
		const names = new Set<string>();
		for (const url of ['/api/providers/organization?page=0&size=100', '/api/fhir-resource/providers?page=0&size=100', '/api/providers?page=0&size=100']) {
			try {
				const res = await this.apiService.fetch(url);
				if (!res.ok) { continue; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
				for (const p of list) {
					const nm = (p.name || p.providerName || p.fullName || `${p.firstName || ''} ${p.lastName || ''}`).toString().trim();
					if (nm) { names.add(nm); }
				}
				if (names.size > 0) { break; }
			} catch { /* try next */ }
		}
		return Array.from(names);
	}

	/** Open the appointment edit popup (date / time / type / status / room /
	 *  provider) — mirrors the schedule pane's edit dialog. */
	private async _openApptEdit(apt: Record<string, unknown>): Promise<void> {
		const id = String(apt.id || apt.appointmentId || '');
		if (!id) { return; }
		const startIso = String(apt.start || apt.startTime || '');
		const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(startIso);
		const initialDate = m ? m[1] : '';
		const initialTime = m ? m[2] : '';

		const [rooms, providers] = await Promise.all([this._fetchRoomOptions(), this._fetchProviderOptions()]);
		let statusOpts = ['Scheduled', 'Confirmed', 'Arrived', 'Checked-in', 'In Room', 'With Provider', 'Completed', 'Re-Scheduled', 'No Show', 'Cancelled'];
		try {
			const res = await this.apiService.fetch('/api/appointments/status-options');
			if (res.ok) {
				const data = await res.json();
				const opts = ((data?.data || data || []) as Array<{ label?: string; value?: string } | string>)
					.map(o => (typeof o === 'string' ? o : o.label || o.value || '')).filter(Boolean);
				if (opts.length > 0) { statusOpts = opts; }
			}
		} catch { /* keep defaults */ }

		const visitTypes = ['Consultation', 'Follow-Up', 'New Patient', 'Urgent', 'Routine', 'Annual Physical', 'Telehealth', 'Lab Work', 'Procedure', 'Referral'];
		const currentType = this._apptTypeStr(apt);
		const typeOptions = visitTypes.map(t => ({ value: t, label: t }));
		if (currentType && currentType !== '—' && !typeOptions.find(o => o.value === currentType)) { typeOptions.unshift({ value: currentType, label: currentType }); }
		const currentStatus = String(apt.status || apt.appointmentStatus || 'Scheduled');
		const statusOptions = statusOpts.map(s => ({ value: s, label: s }));
		if (currentStatus && !statusOptions.find(o => o.value.toLowerCase() === currentStatus.toLowerCase())) { statusOptions.unshift({ value: currentStatus, label: currentStatus }); }
		const currentProvider = String(apt.providerName || apt.practitionerName || '');
		const providerOptions = [{ value: '', label: 'Unassigned' }, ...providers.map(p => ({ value: p, label: p }))];
		if (currentProvider && !providerOptions.find(o => o.value === currentProvider)) { providerOptions.push({ value: currentProvider, label: currentProvider }); }
		const currentRoom = String(apt.room || apt.roomName || '');

		openRecordEditDialog({
			title: `Edit Appointment — ${this._currentPatientName || 'Appointment'}`,
			themeAnchor: this.root,
			variant: 'modal',
			fields: [
				{ key: 'appointmentDate', label: 'Date', kind: 'date', required: true, widthPct: 50 },
				{ key: 'appointmentTime', label: 'Start Time', kind: 'time', widthPct: 50 },
				{ key: 'duration', label: 'Duration (min)', kind: 'number', widthPct: 50 },
				{ key: 'appointmentType', label: 'Visit Type', kind: 'select', widthPct: 50, options: typeOptions },
				{ key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: statusOptions },
				{ key: 'providerName', label: 'Provider', kind: 'select', widthPct: 50, options: providerOptions },
				{ key: 'room', label: 'Room', kind: 'select', widthPct: 50, options: [{ value: '', label: 'Unassigned' }, ...rooms.map(r => ({ value: r, label: r }))] },
				{ key: 'reason', label: 'Reason / Chief Complaint', kind: 'textarea', widthPct: 100 },
				{ key: 'notes', label: 'Notes', kind: 'textarea', widthPct: 100 },
			],
			values: {
				appointmentDate: initialDate,
				appointmentTime: initialTime,
				duration: String(apt.duration || ''),
				appointmentType: currentType === '—' ? '' : currentType,
				status: currentStatus,
				providerName: currentProvider,
				room: currentRoom,
				reason: String(apt.reason || apt.chiefComplaint || apt.reasonForVisit || apt.description || ''),
				notes: String(apt.notes || apt.note || apt.comment || ''),
			},
			onSave: async (next) => {
				const startTime = next.appointmentTime ? `${next.appointmentDate}T${next.appointmentTime}:00` : startIso;
				const payload = {
					...apt,
					start: startTime,
					startTime,
					duration: next.duration ? Number(next.duration) : apt.duration,
					status: next.status,
					appointmentType: next.appointmentType,
					visitType: next.appointmentType,
					providerName: next.providerName,
					room: next.room,
					reason: next.reason,
					notes: next.notes,
				};
				const res = await this.apiService.fetch(`/api/appointments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				this._rerender();
			},
		});
	}

	private _renderAppointmentCard(parent: HTMLElement, apt: Record<string, unknown>): void {
		const appointmentId = String(apt.id || apt.appointmentId || this._lastRenderArgs?.appointmentId || '');

		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span 4;';
		this._cardHeader(card, 'calendar', 'Today\'s Appointment', 1, undefined);

		// --- All appointment fields, shown as label / value pairs --------------
		const startRaw = String(apt.start || apt.startTime || '');
		let dateStr = '—';
		let timeStr = '—';
		let endStr = '';
		if (startRaw) {
			try {
				const d = new Date(startRaw);
				dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
				timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
				const dur = Number(apt.duration || 0);
				if (dur > 0) {
					const end = new Date(d.getTime() + dur * 60000);
					endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
				}
			} catch { /* */ }
		}
		const durVal = Number(apt.duration || 0);
		const reason = String(apt.reason || apt.chiefComplaint || apt.reasonForVisit || apt.description || '').trim();
		const notes = String(apt.notes || apt.note || apt.comment || '').trim();
		const location = String(apt.locationName || apt.location || apt.facility || '').trim();
		const room = String(apt.room || apt.roomName || '').trim();
		const provider = String(apt.providerName || apt.practitionerName || '').trim();
		const hasEncounter = !!(apt.encounterId);

		const fields: Array<[string, string]> = [
			['Date', dateStr],
			// allow-any-unicode-next-line
			['Time', endStr ? `${timeStr} – ${endStr}` : timeStr],
			['Visit Type', this._apptTypeStr(apt)],
			['Provider', provider || '—'],
			['Duration', durVal > 0 ? `${durVal} min` : '—'],
			['Location', location || '—'],
			['Room', room || '— Unassigned —'],
			['Encounter', hasEncounter ? 'Linked' : 'Not started'],
		];
		if (reason) { fields.push(['Reason', reason]); }
		if (notes) { fields.push(['Notes', notes]); }

		const detailGrid = DOM.append(card, DOM.$('div'));
		detailGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px;margin:6px 0 12px;';
		for (const [label, value] of fields) {
			const isWide = label === 'Reason' || label === 'Notes';
			const cell = DOM.append(detailGrid, DOM.$('div'));
			cell.style.cssText = isWide ? 'grid-column:1 / -1;min-width:0;' : 'min-width:0;';
			const l = DOM.append(cell, DOM.$('div'));
			l.textContent = label;
			l.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:2px;';
			const v = DOM.append(cell, DOM.$('div'));
			v.textContent = value;
			v.style.cssText = `font-size:12.5px;font-weight:600;color:var(--vscode-editor-foreground);${isWide ? '' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}`;
			if (label === 'Encounter') { v.style.color = hasEncounter ? '#22c55e' : 'var(--vscode-descriptionForeground)'; }
		}

		// --- Inline status + room controls -------------------------------------
		const controls = DOM.append(card, DOM.$('div'));
		controls.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;padding-top:10px;border-top:1px solid var(--vscode-editorWidget-border);';

		const statusGroup = DOM.append(controls, DOM.$('div'));
		statusGroup.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:170px;';
		const statusLbl = DOM.append(statusGroup, DOM.$('div'));
		statusLbl.textContent = 'STATUS';
		statusLbl.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:0.05em;color:var(--vscode-descriptionForeground);';
		const currentStatus = String(apt.status || apt.appointmentStatus || 'Scheduled');
		const statusSelect = DOM.append(statusGroup, DOM.$('select')) as HTMLSelectElement;
		statusSelect.style.cssText = 'background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-editorWidget-border));border-radius:7px;padding:6px 9px;font-size:12px;cursor:pointer;outline:none;';
		const populateStatuses = (opts: string[]) => {
			DOM.clearNode(statusSelect);
			for (const s of opts) {
				const opt = DOM.append(statusSelect, DOM.$('option')) as HTMLOptionElement;
				opt.value = s;
				opt.textContent = s;
				if (s.toLowerCase() === currentStatus.toLowerCase()) { opt.selected = true; }
			}
		};
		populateStatuses(['Scheduled', 'Confirmed', 'Arrived', 'Checked-in', 'In Room', 'With Provider', 'Completed', 'No Show', 'Cancelled']);
		void (async () => {
			try {
				const res = await this.apiService.fetch('/api/appointments/status-options');
				if (res.ok) {
					const data = await res.json();
					const opts = ((data?.data || data || []) as Array<{ label?: string; value?: string } | string>)
						.map(o => (typeof o === 'string' ? o : o.label || o.value || ''))
						.filter(Boolean);
					if (opts.length > 0) { populateStatuses(opts); }
				}
			} catch { /* keep defaults */ }
		})();
		statusSelect.addEventListener('change', () => {
			if (!appointmentId) { return; }
			void this._changeApptStatus(appointmentId, statusSelect.value);
		});

		const roomGroup = DOM.append(controls, DOM.$('div'));
		roomGroup.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:220px;flex:1;';
		const roomLbl = DOM.append(roomGroup, DOM.$('div'));
		roomLbl.textContent = 'ROOM';
		roomLbl.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:0.05em;color:var(--vscode-descriptionForeground);';
		const roomRow = DOM.append(roomGroup, DOM.$('div'));
		roomRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const currentRoom = String(apt.room || apt.roomName || '');
		const roomSelect = DOM.append(roomRow, DOM.$('select')) as HTMLSelectElement;
		roomSelect.style.cssText = 'flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-editorWidget-border));border-radius:7px;padding:6px 9px;font-size:12px;cursor:pointer;outline:none;min-width:0;';
		const loadingOpt = DOM.append(roomSelect, DOM.$('option')) as HTMLOptionElement;
		loadingOpt.value = '';
		loadingOpt.textContent = 'Loading rooms…';
		loadingOpt.disabled = true;
		loadingOpt.selected = true;
		void this._fetchRoomOptions().then(rooms => {
			DOM.clearNode(roomSelect);
			const blankOpt = DOM.append(roomSelect, DOM.$('option')) as HTMLOptionElement;
			blankOpt.value = '';
			blankOpt.textContent = '— Select room —';
			for (const r of rooms) {
				const opt = DOM.append(roomSelect, DOM.$('option')) as HTMLOptionElement;
				opt.value = r;
				opt.textContent = r;
				if (r === currentRoom) { opt.selected = true; }
			}
			if (!currentRoom) { blankOpt.selected = true; }
		});
		const assignBtn = DOM.append(roomRow, DOM.$('button')) as HTMLButtonElement;
		assignBtn.textContent = 'Assign';
		assignBtn.style.cssText = 'padding:6px 12px;font-size:11px;font-weight:700;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:7px;cursor:pointer;white-space:nowrap;flex-shrink:0;';
		assignBtn.addEventListener('mouseenter', () => { assignBtn.style.opacity = '0.85'; });
		assignBtn.addEventListener('mouseleave', () => { assignBtn.style.opacity = '1'; });
		assignBtn.addEventListener('click', async e => {
			e.stopPropagation();
			if (!appointmentId || !roomSelect.value) { return; }
			assignBtn.disabled = true;
			assignBtn.textContent = 'Saving…';
			await this._updateAppointmentRoom(appointmentId, roomSelect.value);
			assignBtn.disabled = false;
			assignBtn.textContent = 'Assign';
			this._rerender();
		});

		// --- Full appointment action toolbar -----------------------------------
		this._renderAppointmentActions(card, apt, appointmentId);
	}

	/** Render the complete appointment workflow action bar — status
	 *  progression, encounter, chart, telehealth and destructive actions —
	 *  mirroring the schedule pane's per-appointment menu. */
	private _renderAppointmentActions(card: HTMLElement, apt: Record<string, unknown>, appointmentId: string): void {
		const status = String(apt.status || apt.appointmentStatus || '').toLowerCase();
		const terminal = new Set(['completed', 'fulfilled', 'cancelled', 'canceled', 'noshow', 'no-show', 'no show']);
		const isTerminal = terminal.has(status);
		const hasEncounter = !!(apt.encounterId);
		const encounterId = String(apt.encounterId || '');
		const vt = this._apptTypeStr(apt).toLowerCase();
		const isTele = vt.includes('telehealth') || vt.includes('virtual') || vt.includes('video');

		const bar = DOM.append(card, DOM.$('div'));
		bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--vscode-editorWidget-border);';

		const mkBtn = (icon: string, label: string, onClick: () => void, tone: 'default' | 'primary' | 'danger' = 'default'): void => {
			const b = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			b.style.cssText = [
				'display:flex;align-items:center;gap:5px;padding:6px 11px;font-size:11.5px;font-weight:600;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background 0.12s,border-color 0.12s;',
				tone === 'primary'
					? 'background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:1px solid transparent;'
					: tone === 'danger'
						? 'background:transparent;color:#ef4444;border:1px solid rgba(239,68,68,0.4);'
						: 'background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08));color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);',
			].join('');
			const ico = DOM.append(b, DOM.$('span.codicon.codicon-' + icon));
			(ico as HTMLElement).style.cssText = 'font-size:13px;';
			const lbl = DOM.append(b, DOM.$('span'));
			lbl.textContent = label;
			b.addEventListener('mouseenter', () => {
				if (tone === 'primary') { b.style.background = 'var(--vscode-button-hoverBackground,#1177bb)'; }
				else if (tone === 'danger') { b.style.background = 'rgba(239,68,68,0.12)'; }
				else { b.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.22))'; }
			});
			b.addEventListener('mouseleave', () => {
				if (tone === 'primary') { b.style.background = 'var(--vscode-button-background,#0e639c)'; }
				else if (tone === 'danger') { b.style.background = 'transparent'; }
				else { b.style.background = 'var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08))'; }
			});
			b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
		};

		// Status progression — only meaningful while the visit is live.
		if (!isTerminal) {
			if (status !== 'arrived' && status !== 'checked-in' && status !== 'in-room' && status !== 'with-provider') {
				mkBtn('person', 'Mark Arrived', () => void this._changeApptStatus(appointmentId, 'Arrived'));
			}
			if (status !== 'checked-in' && status !== 'in-room' && status !== 'with-provider') {
				mkBtn('check', 'Check In', () => void this._changeApptStatus(appointmentId, 'Checked-in'), 'primary');
			}
			if (status === 'checked-in' || status === 'arrived') {
				mkBtn('home', 'Move to Room', () => void this._changeApptStatus(appointmentId, 'In Room'));
			}
			if (status !== 'with-provider') {
				mkBtn('account', 'With Provider', () => void this._changeApptStatus(appointmentId, 'With Provider'));
			}
			mkBtn('pass', 'Mark Completed', () => void this._changeApptStatus(appointmentId, 'Completed'));
		}

		// Encounter + navigation
		if (hasEncounter) {
			mkBtn('note', 'Open Encounter', () => void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, encounterId, this._currentPatientName));
			mkBtn('pulse', 'Record Vitals', () => void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, encounterId, this._currentPatientName, 'Vitals', 'vitals'));
		} else if (!isTerminal) {
			mkBtn('add', 'Create Encounter', () => void this._createEncounterFromAppointment(apt), 'primary');
		}
		mkBtn('edit', 'Edit', () => void this._openApptEdit(apt));
		mkBtn('book', 'Open Chart', () => this._openChartAt('demographics'));
		if (isTele) {
			mkBtn('device-camera-video', 'Video Call', () => void this.commandService.executeCommand('ciyex.openTelehealth', appointmentId, this._currentPatientName, String(apt.providerName || apt.practitionerName || '')));
		}

		// Destructive actions
		if (!isTerminal) {
			mkBtn('circle-slash', 'No Show', () => void this._changeApptStatus(appointmentId, 'No Show'), 'danger');
			mkBtn('trash', 'Cancel', () => void this._changeApptStatus(appointmentId, 'Cancelled'), 'danger');
		}
	}

	private _renderGrid(
		_p: Record<string, unknown> | null,
		conds: Record<string, unknown>[],
		meds: Record<string, unknown>[],
		vit: Record<string, unknown>[],
		encs: Record<string, unknown>[],
		labs: Record<string, unknown>[],
		payments: Record<string, unknown>[],
		statements: Record<string, unknown>[],
		apt?: Record<string, unknown> | null,
	): void {
		const grid = DOM.append(this.root, DOM.$('.snap-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:18px 24px;';

		if (apt) {
			this._renderAppointmentCard(grid, apt);
		}

		const activeProblems = conds.filter(c => {
			const s = String(c.status || c.clinicalStatus || '').toLowerCase();
			return !s || s === 'active';
		});
		this._renderCard(grid, 'problems', 'stethoscope', 'Active Problems', activeProblems, (c) => {
			const name = c.conditionName || c.condition || c.name || c.display || (c.code as Record<string, unknown>)?.text || '—';
			const onset = c.onsetDate || c.onsetDateTime || c.recordedDate || '';
			const yr = onset ? new Date(String(onset)).getFullYear() : '';
			return { primary: String(name), secondary: yr ? String(yr) : '', badge: { text: 'Active', color: '#22c55e' } };
		}, () => this._openCreateModal('problems'), 'problems');

		this._renderCard(grid, 'medications', 'symbol-method', 'Medications', meds, (m) => {
			const name = m.medicationName || m.name || '—';
			const dose = m.dosage || '';
			const freq = m.frequency || '';
			return { primary: String(name), secondary: [dose, freq].filter(Boolean).join(' · ') };
		}, () => this._openCreateModal('medications'), 'medications');

		this._renderVitalsCard(grid, vit);
		this._renderPaymentsCard(grid, payments, statements);

		// Middle row: Visit History (2 cols) + Encounter History (2 cols)
		const visitCard = this._renderWideCard(grid, 'history', 'Visit History', 2, encs.length, () => this._openCreateModal('encounters'));
		this._renderEncounterRows(visitCard, encs);

		const encCard = this._renderWideCard(grid, 'notebook', 'Encounter History', 2, encs.length, () => this._openCreateModal('encounters'));
		this._renderEncounterClinicalRows(encCard, encs);

		// Bottom row: Lab Results (full width)
		const labCard = this._renderWideCard(grid, 'beaker', 'Lab Results', 4, labs.length, () => this._openCreateModal('labs'));
		this._renderLabRows(labCard, labs);
	}

	private _renderEncounterClinicalRows(card: HTMLElement, encs: Record<string, unknown>[]): void {
		if (encs.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No encounters found';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		table.style.cssText = 'display:grid;grid-template-columns:110px 1fr 80px 56px;gap:0;';
		for (const lbl of ['Date', 'Chief Complaint / Diagnosis', 'Status', '']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		const { page, pageIdx, pageCount, total } = this._paginate('encounter-clinical', encs);
		for (const enc of page) {
			const dateRaw = enc.encounterDate || enc.startDate || enc.start || enc.date || enc.periodStart || enc.createdAt || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const cc = enc.chiefComplaint || enc.reason || enc.reasonCode || '';
			const dx = enc.diagnosis || enc.primaryDiagnosis || enc.icdCode || '';
			const detail = [cc, dx].filter(Boolean).map(String).join(' · ') || enc.notes || '—';
			const status = enc.status || 'Unknown';
			const statusLower = String(status).toLowerCase();
			const sColor = statusLower.includes('finish') || statusLower.includes('complet') ? '#22c55e' : statusLower.includes('cancel') ? '#ef4444' : '#3b9edd';

			const dateCell = DOM.append(table, DOM.$('div'));
			dateCell.textContent = dateStr;
			dateCell.style.cssText = 'padding:6px 8px 6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;color:var(--vscode-editor-foreground);white-space:nowrap;';

			const detailCell = DOM.append(table, DOM.$('div'));
			detailCell.textContent = String(detail).slice(0, 120);
			detailCell.style.cssText = 'padding:6px 8px 6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;color:var(--vscode-editor-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			const statusCell = DOM.append(table, DOM.$('div'));
			statusCell.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const sb = DOM.append(statusCell, DOM.$('span'));
			sb.textContent = String(status);
			sb.style.cssText = `font-size:10px;padding:2px 6px;border-radius:8px;background:${sColor}20;color:${sColor};font-weight:700;`;

			this._renderGridRowActions(table, 'visit-notes', enc);
		}
		this._renderPagerFooter(card, 'encounter-clinical', pageIdx, pageCount, total);
	}

	private _renderCard(
		parent: HTMLElement,
		pageKey: string,
		icon: string,
		title: string,
		items: Record<string, unknown>[],
		row: (item: Record<string, unknown>) => { primary: string; secondary: string; badge?: { text: string; color: string } },
		onAdd?: () => void,
		entity?: string,
	): HTMLElement {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;display:flex;flex-direction:column;min-height:140px;';

		this._cardHeader(card, icon, title, items.length, onAdd);

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:260px;';

		if (items.length === 0) {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = 'None recorded';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return card;
		}

		const { page, pageIdx, pageCount, total } = this._paginate(pageKey, items);
		for (const item of page) {
			const r = row(item);
			const rowEl = DOM.append(body, DOM.$('div'));
			rowEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const textCol = DOM.append(rowEl, DOM.$('div'));
			textCol.style.cssText = 'flex:1;min-width:0;';
			const pri = DOM.append(textCol, DOM.$('div'));
			pri.textContent = r.primary;
			pri.style.cssText = 'font-size:12px;font-weight:500;color:var(--vscode-editor-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			if (r.secondary) {
				const sec = DOM.append(textCol, DOM.$('div'));
				sec.textContent = r.secondary;
				sec.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px;';
			}
			if (r.badge) {
				const b = DOM.append(rowEl, DOM.$('span'));
				b.textContent = r.badge.text;
				b.style.cssText = `font-size:9px;padding:2px 6px;border-radius:8px;background:${r.badge.color}20;color:${r.badge.color};font-weight:700;white-space:nowrap;flex-shrink:0;`;
			}
			if (entity) { this._attachRowActions(rowEl, entity, item); }
		}
		this._renderPagerFooter(card, pageKey, pageIdx, pageCount, total);
		return card;
	}

	/**
	 * Append hover-reveal Edit + Delete icons to a dashboard card row, and
	 * wire row-click to the edit modal. Keeps the row compact in its idle
	 * state and only surfaces actions when the user hovers/focuses.
	 */
	private _attachRowActions(rowEl: HTMLElement, entity: string, item: Record<string, unknown>): void {
		const actions = DOM.append(rowEl, DOM.$('div'));
		actions.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;opacity:0;transition:opacity 0.12s ease-out;';

		const mkBtn = (codicon: string, title: string, onClick: (e: Event) => void): HTMLButtonElement => {
			const b = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			b.title = title;
			b.setAttribute('aria-label', title);
			b.style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;color:var(--vscode-foreground);padding:0;';
			const ico = DOM.append(b, DOM.$('span.codicon.codicon-' + codicon));
			(ico as HTMLElement).style.cssText = 'font-size:13px;';
			b.addEventListener('mouseenter', () => { b.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; b.style.borderColor = 'var(--vscode-editorWidget-border)'; });
			b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.borderColor = 'transparent'; });
			b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
			return b;
		};

		mkBtn('edit', 'Edit', () => this._openEditModal(entity, item));
		mkBtn('trash', 'Delete', () => { void this._deleteItem(entity, item); });

		rowEl.style.cursor = 'pointer';
		rowEl.addEventListener('mouseenter', () => {
			actions.style.opacity = '1';
			rowEl.style.background = 'var(--vscode-list-hoverBackground,rgba(128,128,128,0.08))';
		});
		rowEl.addEventListener('mouseleave', () => {
			actions.style.opacity = '0';
			rowEl.style.background = '';
		});
		rowEl.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('button')) { return; }
			this._openEditModal(entity, item);
		});
	}

	private _renderVitalsCard(parent: HTMLElement, vit: Record<string, unknown>[]): void {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;min-height:140px;display:flex;flex-direction:column;';
		this._cardHeader(card, 'pulse', 'Latest Vitals', vit.length, () => this._openCreateModal('vitals'));

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:260px;';

		const latest = vit[0] as Record<string, unknown> | undefined;
		if (!latest) {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = 'No vitals recorded';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}

		const bpVal = (latest.bpSystolic && latest.bpDiastolic) ? `${latest.bpSystolic}/${latest.bpDiastolic}` : '';
		const vitalRows: Array<[string, unknown, string?]> = [
			['BP', bpVal, 'mmHg'],
			['Weight', latest.weightKg, 'kg'],
			['Height', latest.heightCm, 'cm'],
			// allow-any-unicode-next-line
			['BMI', latest.bmi, 'kg/m²'],
			['O2 Sat', latest.oxygenSaturation, '%'],
			// allow-any-unicode-next-line
			['Temp', latest.temperatureC, '°C'],
			['Pulse', latest.pulse, '/min'],
			['Resp', latest.respiration, '/min'],
		];

		const grid2 = DOM.append(body, DOM.$('div'));
		grid2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin-top:4px;';
		for (const [lbl, val, unit] of vitalRows) {
			if (!val) { continue; }
			const cell = DOM.append(grid2, DOM.$('div'));
			cell.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const l = DOM.append(cell, DOM.$('div'));
			l.textContent = lbl;
			l.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;';
			const v = DOM.append(cell, DOM.$('div'));
			v.textContent = `${val}${unit ? ' ' + unit : ''}`;
			v.style.cssText = 'font-size:13px;font-weight:700;color:var(--vscode-editor-foreground);';
		}

		// History: remaining vitals readings (paginated)
		const history = vit.slice(1);
		if (history.length > 0) {
			const histLabel = DOM.append(body, DOM.$('div'));
			histLabel.textContent = 'VITALS HISTORY';
			histLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-top:10px;margin-bottom:4px;';
			const { page, pageIdx, pageCount, total } = this._paginate('vitals-history', history);
			for (const v of page) {
				const dateRaw = v.recordedAt || v.effectiveDateTime || v.recordedDate || v.dateRecorded || v.date || '';
				const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
				const bp = (v.bpSystolic && v.bpDiastolic) ? `${v.bpSystolic}/${v.bpDiastolic}` : '';
				const wt = v.weightKg || '';
				const summary = [bp ? `BP ${bp}` : '', wt ? `Wt ${wt} kg` : ''].filter(Boolean).join(' · ') || '—';
				const row = DOM.append(body, DOM.$('div'));
				row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:11px;';
				const dateEl = DOM.append(row, DOM.$('span'));
				dateEl.textContent = dateStr;
				dateEl.style.cssText = 'color:var(--vscode-descriptionForeground);';
				const summaryEl = DOM.append(row, DOM.$('span'));
				summaryEl.textContent = summary;
				summaryEl.style.cssText = 'color:var(--vscode-editor-foreground);font-weight:500;flex:1;text-align:right;';
				this._attachRowActions(row, 'vitals', v);
			}
			this._renderPagerFooter(card, 'vitals-history', pageIdx, pageCount, total);
		}
	}

	private _renderPaymentsCard(parent: HTMLElement, payments: Record<string, unknown>[], statements: Record<string, unknown>[]): void {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;min-height:140px;display:flex;flex-direction:column;';
		this._cardHeader(card, 'credit-card', 'Financials', payments.length, () => this._openCreateModal('payment'));

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:260px;';

		// Outstanding balance from the latest statement
		const stmt = statements[0] as Record<string, unknown> | undefined;
		const balance = stmt?.balance ?? stmt?.['totalNet.value'] ?? '—';
		const balNum = parseFloat(String(balance));

		const balRow = DOM.append(body, DOM.$('div'));
		balRow.style.cssText = 'margin-top:4px;margin-bottom:8px;';
		const balLabel = DOM.append(balRow, DOM.$('div'));
		balLabel.textContent = 'OUTSTANDING BALANCE';
		balLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);';
		const balVal = DOM.append(balRow, DOM.$('div'));
		balVal.textContent = isNaN(balNum) ? '—' : `$${balNum.toFixed(2)}`;
		balVal.style.cssText = `font-size:22px;font-weight:800;color:${!isNaN(balNum) && balNum > 0 ? '#ef4444' : '#22c55e'};margin-top:2px;`;

		if (payments.length > 0) {
			const histLabel = DOM.append(body, DOM.$('div'));
			histLabel.textContent = 'PAYMENT HISTORY';
			histLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-top:6px;margin-bottom:4px;border-top:1px solid var(--vscode-editorWidget-border);padding-top:8px;';
			const { page, pageIdx, pageCount, total } = this._paginate('payments', payments);
			for (const pay of page) {
				const dateRaw = (pay.paymentDate || pay.date || pay.transactionDate || pay.created || '') as string;
				const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
				const amt = pay.amount || pay.totalAmount || '';
				const method = pay.paymentType || pay.paymentMethod || pay.method || '';
				const r = DOM.append(body, DOM.$('div'));
				r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
				const left = DOM.append(r, DOM.$('div'));
				const dateEl = DOM.append(left, DOM.$('div'));
				dateEl.textContent = dateStr;
				dateEl.style.cssText = 'font-size:12px;color:var(--vscode-editor-foreground);font-weight:500;';
				if (method) {
					const methEl = DOM.append(left, DOM.$('div'));
					methEl.textContent = String(method);
					methEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px;';
				}
				if (amt) {
					const amtEl = DOM.append(r, DOM.$('span'));
					const amtNum = parseFloat(String(amt));
					amtEl.textContent = isNaN(amtNum) ? String(amt) : `$${amtNum.toFixed(2)}`;
					amtEl.style.cssText = 'font-size:13px;font-weight:700;color:#22c55e;';
				}
				this._attachRowActions(r, 'payment', pay);
			}
			this._renderPagerFooter(card, 'payments', pageIdx, pageCount, total);
		} else {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = 'No payment history';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
		}
	}

	private _renderWideCard(parent: HTMLElement, icon: string, title: string, cols: number, count: number, onAdd?: () => void): HTMLElement {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = `background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span ${cols};`;
		this._cardHeader(card, icon, title, count, onAdd);
		return card;
	}

	private _renderEncounterRows(card: HTMLElement, encs: Record<string, unknown>[]): void {
		if (encs.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No encounters found';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		table.style.cssText = 'display:grid;grid-template-columns:120px 1fr 140px 80px 80px 56px;gap:0;';
		for (const lbl of ['Date', 'Type / Provider', 'Location', 'Status', 'Notes', '']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		const { page, pageIdx, pageCount, total } = this._paginate('encounters', encs);
		for (const enc of page) {
			const dateRaw = enc.encounterDate || enc.startDate || enc.start || enc.date || enc.periodStart || enc.createdAt || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const type = enc.visitCategory || enc.encounterType || enc.type || enc.serviceType || enc.class || '—';
			const prov = enc.encounterProvider || enc.providerDisplay || enc.providerName || enc.practitionerName || '';
			const loc = enc.locationName || enc.location || enc.facility || '—';
			const status = enc.status || 'Unknown';
			const notes = enc.notes || enc.chiefComplaint || enc.reason || '';
			const statusLower = String(status).toLowerCase();
			const sColor = statusLower.includes('finish') || statusLower.includes('complet') ? '#22c55e' : statusLower.includes('cancel') ? '#ef4444' : '#3b9edd';
			const rowCells: Array<{ txt: string; isStatus?: boolean; isNotes?: boolean }> = [
				{ txt: dateStr },
				{ txt: prov ? `${type} · ${prov}` : String(type) },
				{ txt: String(loc) },
				{ txt: String(status), isStatus: true },
				{ txt: String(notes).slice(0, 40) || '—', isNotes: true },
			];
			for (const { txt, isStatus, isNotes } of rowCells) {
				const cell = DOM.append(table, DOM.$('div'));
				cell.style.cssText = `padding:6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;${isNotes ? '' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}padding-right:8px;`;
				if (isStatus) {
					const b = DOM.append(cell, DOM.$('span'));
					b.textContent = txt;
					b.style.cssText = `font-size:10px;padding:2px 6px;border-radius:8px;background:${sColor}20;color:${sColor};font-weight:700;`;
				} else {
					cell.textContent = txt;
					if (isNotes) { cell.style.color = 'var(--vscode-descriptionForeground)'; cell.style.fontSize = '11px'; }
				}
			}
			this._renderGridRowActions(table, 'visit-notes', enc);
		}
		this._renderPagerFooter(card, 'encounters', pageIdx, pageCount, total);
	}

	/**
	 * Append a trailing actions cell to a grid-layout row. Used by the
	 * encounter / lab tables on the snapshot dashboard so users can edit or
	 * delete records inline without leaving the page.
	 */
	private _renderGridRowActions(table: HTMLElement, entity: string, item: Record<string, unknown>): void {
		const cell = DOM.append(table, DOM.$('div'));
		cell.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;justify-content:flex-end;gap:2px;';

		const mkBtn = (codicon: string, title: string, onClick: () => void): HTMLButtonElement => {
			const b = DOM.append(cell, DOM.$('button')) as HTMLButtonElement;
			b.title = title;
			b.setAttribute('aria-label', title);
			b.style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;color:var(--vscode-foreground);padding:0;';
			const ico = DOM.append(b, DOM.$('span.codicon.codicon-' + codicon));
			(ico as HTMLElement).style.cssText = 'font-size:12px;';
			b.addEventListener('mouseenter', () => { b.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; b.style.borderColor = 'var(--vscode-editorWidget-border)'; });
			b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.borderColor = 'transparent'; });
			b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
			return b;
		};

		mkBtn('edit', 'Edit', () => this._openEditModal(entity, item));
		mkBtn('trash', 'Delete', () => { void this._deleteItem(entity, item); });
	}

	private _renderLabRows(card: HTMLElement, labs: Record<string, unknown>[]): void {
		if (labs.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No lab results found';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		table.style.cssText = 'display:grid;grid-template-columns:1fr 100px 80px 50px 56px;gap:0;';
		for (const lbl of ['Test', 'Date', 'Value', 'Flag', '']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		const { page, pageIdx, pageCount, total } = this._paginate('labs', labs);
		for (const lab of page) {
			const name = lab.testName || lab.display || lab.name || (lab.code as Record<string, unknown>)?.text || '—';
			const dateRaw = lab.resultDate || lab.collectionDate || lab.date || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const resultVal = lab.result || lab.value || '—';
			const units = lab.units || '';
			const val = units ? `${resultVal} ${units}` : String(resultVal);
			const labStatus = String(lab.status || '').toLowerCase();
			const isAbnormal = labStatus && !['final', 'ordered', ''].includes(labStatus);
			const cells: Array<{ txt: string; isFlag?: boolean }> = [
				{ txt: String(name) },
				{ txt: dateStr },
				{ txt: val },
				{ txt: isAbnormal ? labStatus.toUpperCase() : '', isFlag: true },
			];
			for (const { txt, isFlag } of cells) {
				const cell = DOM.append(table, DOM.$('div'));
				cell.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:6px;';
				if (isFlag && isAbnormal) {
					const b = DOM.append(cell, DOM.$('span'));
					b.textContent = txt;
					b.style.cssText = 'font-size:9px;padding:2px 5px;border-radius:6px;background:#ef444420;color:#ef4444;font-weight:700;';
				} else {
					cell.textContent = txt;
				}
			}
			this._renderGridRowActions(table, 'labs', lab);
		}
		this._renderPagerFooter(card, 'labs', pageIdx, pageCount, total);
	}

	private _cardHeader(card: HTMLElement, icon: string, title: string, count: number, onAdd?: () => void): void {
		const hdr = DOM.append(card, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';
		const ico = DOM.append(hdr, DOM.$('span.codicon.codicon-' + icon));
		(ico as HTMLElement).style.cssText = 'font-size:14px;color:var(--vscode-descriptionForeground);';
		const lbl = DOM.append(hdr, DOM.$('span'));
		lbl.textContent = title;
		lbl.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--vscode-descriptionForeground);flex:1;';
		if (count > 0) {
			const badge = DOM.append(hdr, DOM.$('span'));
			badge.textContent = String(count);
			badge.style.cssText = 'font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;background:var(--vscode-badge-background,rgba(128,128,128,0.2));color:var(--vscode-badge-foreground,var(--vscode-editor-foreground));';
		}
		if (onAdd) {
			const addBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
			addBtn.title = `Add ${title}`;
			addBtn.setAttribute('aria-label', `Add ${title}`);
			addBtn.style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;color:var(--vscode-foreground);padding:0;';
			const addIco = DOM.append(addBtn, DOM.$('span.codicon.codicon-add'));
			(addIco as HTMLElement).style.cssText = 'font-size:13px;';
			addBtn.addEventListener('mouseenter', () => { addBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; addBtn.style.borderColor = 'var(--vscode-editorWidget-border)'; });
			addBtn.addEventListener('mouseleave', () => { addBtn.style.background = 'transparent'; addBtn.style.borderColor = 'transparent'; });
			addBtn.addEventListener('click', (e) => { e.stopPropagation(); onAdd(); });
		}
	}

	private async _fetch(path: string): Promise<Record<string, unknown> | null> {
		try {
			const res = await this.apiService.fetch(path);
			if (!res.ok) { return null; }
			const data = await res.json();
			return data as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	private _list(result: PromiseSettledResult<Record<string, unknown> | null>): Record<string, unknown>[] {
		if (result.status !== 'fulfilled' || !result.value) { return []; }
		const d = result.value as Record<string, unknown>;
		const inner = (d?.data ?? d) as Record<string, unknown>;
		const arr = inner?.problemsList || inner?.allergiesList || inner?.content || inner?.list || inner?.items || inner?.records
			|| (Array.isArray(inner) ? inner : Array.isArray(d) ? d : []);
		return Array.isArray(arr) ? arr as Record<string, unknown>[] : [];
	}

	override layout(dimension: import('../../../../../base/browser/dom.js').Dimension): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
	}
}


