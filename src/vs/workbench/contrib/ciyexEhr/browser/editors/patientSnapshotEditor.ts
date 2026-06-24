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

/** State backing the "Visit Pipeline" card — the revenue-cycle stages for the
 *  on-screen visit (appointment → encounter → sign → fee sheet → billing →
 *  payment). All fields are best-effort: any may be null when that stage hasn't
 *  been reached yet. */
interface VisitPipelineState {
	encounter: Record<string, unknown> | null;
	feeSheet: Record<string, unknown> | null;
	statement: Record<string, unknown> | null;
	payments: Record<string, unknown>[];
}

/** One step of the single, strictly-ordered visit workflow. The pipeline runs
 *  Scheduled → Completed → Encounter → Sign & Lock → Fee Sheet → Billing →
 *  Payment; every step's `done` is derived from THIS appointment's own state so
 *  the strip can never light a later step before an earlier one (the bug where a
 *  scheduled visit showed Encounter / Sign / Fee Sheet as done). `action` opens
 *  the module that owns the step, so the snapshot and each module stay linked. */
interface VisitStage {
	key: string;
	label: string;
	icon: string;
	role: string;
	/** Hint shown while the step is still to-do. */
	sub: string;
	/** Hint shown once the step is done. */
	doneSub: string;
	done: boolean;
	action?: () => void;
}

/**
 * Resolve a single, human-readable payment-method label from a transaction
 * record. Recent Payments and Payment History previously read different fields
 * (`paymentType`/`paymentMethod` vs the raw `paymentMethodType` enum), so the
 * SAME transaction showed e.g. "debit card" in one place and "other" in the
 * other. Both now route through here: prefer the descriptive method field, fall
 * back to the stored enum, and title-case it ("debit_card" → "Debit Card").
 */
function formatPaymentMethod(pay: Record<string, unknown>): string {
	const raw = String(
		pay.paymentMethod ?? pay.paymentType ?? pay.method ?? pay.paymentMethodType ?? ''
	).trim();
	if (!raw) { return '—'; }
	return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
	// The encounter Edit popup renders the composition's structured fields
	// (diagnoses/procedures code arrays, plan-item lists, ROS/PE grids) as plain
	// textareas. We keep the raw structured values loaded for the encounter under
	// edit here so that, on save, fields the user did NOT touch are written back
	// in their original structured shape instead of a lossy text round-trip
	// (which previously rendered as "[object Object]" and broke the link with the
	// dedicated Encounter form page).
	private _encounterComplexOriginals: Record<string, unknown> = {};
	// The encounter-form Composition id for the encounter currently under edit,
	// scoped to the Encounter id it was loaded for. The endpoint wraps
	// composition(s) in a paginated envelope, so we capture the id of the
	// most-recent one on load and PUT back to it on save (mirrors
	// EncounterFormEditor) — without it the save targeted the Encounter id, 404'd,
	// and fell back to creating a DUPLICATE composition that lost prior codes. The
	// `encId` guard stops a cached id from a previous edit leaking into a save for
	// a different encounter (the records-list flow never reloads it).
	private _encounterCompositionRef: { encId: string; compId: string | undefined } | undefined;
	// id → display name for Locations, so appointment / encounter rows can show
	// the location NAME instead of the raw "Location/{id}" reference (QA 4 & 5).
	private readonly _locationNames = new Map<string, string>();
	private readonly _pageState = new Map<string, number>();
	/** IDs of records the user just deleted on this patient. Filtered out of
	 *  every list render until a fresh fetch confirms the server has removed
	 *  them — covers HAPI's eventual-consistency search index lag. */
	private readonly _deletedIds = new Map<string, Set<string>>();
	/** Records created in this session that the server's search index may not
	 *  have surfaced yet. Merged into every list render until a subsequent
	 *  fetch returns the same id, mirroring the chart editor's _pendingCreates. */
	private readonly _pendingCreates = new Map<string, Array<Record<string, unknown>>>();
	/** Appointment edits applied this session, keyed by appointment id. The
	 *  status sub-resource lags (or a completed appointment's status only takes
	 *  via the full PUT), and the search index can return stale provider/room/etc.,
	 *  so the refetched appointment may still show pre-edit values. Overlay the
	 *  changed fields so the card reflects them immediately and a Completed
	 *  appointment can still be moved to any status. */
	private readonly _apptStatusOverride = new Map<string, Record<string, unknown>>();
	/** Provider display name -> id, so an appointment provider CHANGE persists
	 *  (the API keys off the id/reference, not the display name). */
	private readonly _providerIdByName = new Map<string, string>();
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

	/** Open the full patient chart *page* (left-rail navigation + patient
	 *  header) in the main editor area, landing on a specific section. Unlike
	 *  {@link _openChartAt} this is NOT the narrow focused side-panel — it's
	 *  the full dashboard page, matching `ciyex.openPatientChart`. */
	private _openPatientChartPage(tab: string): void {
		if (!this._currentPatientId) { return; }
		const input = new PatientChartEditorInput(this._currentPatientId, this._currentPatientName, tab);
		void this.editorService.openEditor(input, { pinned: true });
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
			// The Coverage tab_field_config (FHIR paths for save/read) is seeded
			// under the backend slug 'insurance-coverage' (ciyex V41/V44), NOT
			// 'insurance'. The chart editor routes both saves and reads through
			// it via TAB_API_SLUG ('insurance' → 'insurance-coverage'). Writing to
			// /api/fhir-resource/insurance returns a hollow 201 (no id, nothing
			// persisted) because the backend can't resolve the field config, and
			// reading it 400s (HAPI-0524 "subject" param). Use insurance-coverage
			// for both so Coverage create/read actually resolve.
			title: 'Insurance Coverage', configKey: 'insurance', basePath: '/api/fhir-resource/insurance-coverage', fhirPatientScoped: true,
			columns: [
				{ key: 'payerName', label: 'Payor', width: '2fr' },
				{ key: 'policyNumber', label: 'Member ID', width: '140px' },
				{ key: 'groupNumber', label: 'Group #', width: '120px' },
				{ key: 'insuranceType', label: 'Priority', width: '100px' },
			],
			listPath: (pid) => `/api/fhir-resource/insurance-coverage/patient/${pid}?page=0&size=20`,
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
			// Payments are NOT a FHIR resource: the backend tab_field_config has no
			// resource type for 'payments', so POST /api/fhir-resource/payments
			// 403s ("Cannot determine resource type for tab 'payments'"). The
			// workspace records payments via POST /api/payments/collect (see the
			// clinicalEditors PAYMENTS config) and lists them at
			// /api/payments/transactions/patient/{id}. Create is special-cased in
			// _savePayment; edit/delete fall through to /api/payments/transactions/{id}.
			title: 'Payments', configKey: 'payment', basePath: '/api/payments/transactions', fhirPatientScoped: false, nonFhir: true,
			columns: [
				{ key: 'collectedAt', label: 'Date', width: '120px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'amount', label: 'Amount', width: '100px', format: (v) => { const n = parseFloat(String(v)); return isNaN(n) ? '—' : `$${n.toFixed(2)}`; } },
				{ key: 'transactionType', label: 'Type', width: '110px', format: (v) => { const s = String(v ?? '').trim(); return s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'; } },
				{ key: 'paymentMethodType', label: 'Method', width: '130px', format: (_v, r) => formatPaymentMethod(r) },
				{ key: 'status', label: 'Status', width: '110px', format: (v) => { const s = String(v ?? '').trim(); return s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'; } },
			],
			listPath: (pid) => `/api/payments/transactions/patient/${pid}?page=0&size=50`,
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
				// Include `localOnly` fields too (e.g. vitals BMI) so the popup
				// form renders exactly the same fields the full chart editor
				// does. `_toPopupField` marks them read-only / auto-computed so
				// they behave like the chart editor's derived inputs.
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

		const out: IEditFieldDef = {
			key: f.key,
			label: f.label,
			kind,
			options,
			required: f.required,
			placeholder: f.placeholder,
			widthPct,
		};

		// Carry conditional visibility (e.g. insurance subscriber fields that the
		// chart editor hides when "Relationship to Patient" is "Self") so the
		// snapshot popup form behaves the same as the full chart editor form.
		if (f.showWhen) { out.showWhen = f.showWhen; }

		// Derived / display-only fields (chart editor marks these `localOnly`)
		// render read-only so the user can't hand-edit a computed value.
		if (f.localOnly) { out.readonly = true; }

		// BMI is auto-calculated from height (cm) & weight (kg) — exactly as the
		// chart editor does — so the snapshot popup shows the same live value.
		if (f.key === 'bmi') {
			out.readonly = true;
			out.compute = (vals) => PatientSnapshotEditor._computeBmi(vals['heightCm'], vals['weightKg']);
		}

		return out;
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
		// Snapshot-only: adding a medication here requires naming a prescriber.
		// `_flattenChartConfig` returns fresh field copies, so marking it required
		// here keeps the change scoped to this form (the shared chart-editor config
		// is untouched).
		if (entity === 'medications') {
			const prescriber = fields.find(f => f.key === 'prescribingDoctor');
			if (prescriber) { prescriber.required = true; }
		}
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
				// Encounters are tracked with just two states across the workspace —
				// Signed (locked / finalized) and Unsigned (still open). The earlier
				// FHIR-code list (planned/arrived/in-progress/finished/cancelled) could
				// not represent the "SIGNED" value the encounter actually loads with, so
				// the dropdown showed a current value missing from its own option list.
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'SIGNED', label: 'Signed' },
					{ value: 'UNSIGNED', label: 'Unsigned' },
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
	 * Encounter-form keys whose value the dedicated {@link EncounterFormEditor}
	 * stores as a structured array/object (code lists, plan items, ROS/PE grids)
	 * but which the flat list/form popup can only render as a textarea. These get
	 * serialised to readable text on load and parsed back on save so the two
	 * surfaces stay linked.
	 */
	private static readonly _ENCOUNTER_TEXT_FIELDS = ['assessment_diagnoses', 'procedures_data', 'plan_items', 'ros_data', 'pe_data'];

	/**
	 * True when a lab row is an actual RESULT (has a value, or a terminal/result
	 * status), false when it's still just an open ORDER awaiting results. Orders
	 * carry statuses like ordered/pending/in-progress/collected and no value yet;
	 * they belong in "Pending Items", not the Lab Results list. Without this an
	 * unresolved order showed in Lab Results with value "—" and an IN-PROGRESS
	 * flag, reading as a stale result the user never entered.
	 */
	private static _isLabResult(lab: Record<string, unknown>): boolean {
		const v = lab.result ?? lab.value;
		const valStr = String(v ?? '').trim();
		const hasValue = valStr !== '' && valStr !== '—';
		if (hasValue) { return true; }
		return !PatientSnapshotEditor._isLabOrderPending(String(lab.status || ''));
	}

	/**
	 * True when a lab status means "order placed, result not in yet" — these rows
	 * belong in Pending Items, never the Lab Results list. Covers the FHIR
	 * Observation/DiagnosticReport order states (registered/unknown) plus the
	 * app's own order statuses (ordered/pending/in-progress/collected/active).
	 */
	private static _isLabOrderPending(status: string): boolean {
		const s = status.toLowerCase();
		return s === '' || s === 'registered' || s === 'unknown' || s === 'ordered'
			|| s === 'pending' || s === 'in-progress' || s === 'collected' || s === 'active';
	}

	/**
	 * Collapse any encounter status onto the two states the workspace tracks:
	 * SIGNED (finalized / locked) and UNSIGNED (still open). Accepts FHIR codes
	 * ('finished', 'completed', 'in-progress', 'planned', …) and the EHR values
	 * ('SIGNED'/'UNSIGNED'/'INCOMPLETE'); anything not clearly signed is unsigned.
	 */
	private static _normalizeEncounterStatus(raw: unknown): string {
		const s = String(raw ?? '').toLowerCase();
		return (s.includes('sign') && !s.includes('unsign')) || s.includes('finish') || s.includes('complet')
			? 'SIGNED'
			: 'UNSIGNED';
	}

	/**
	 * Render a structured composition value as the multi-line text the popup
	 * textareas display. Diagnoses/procedures become "CODE — Description" lines,
	 * plan items one-per-line, and ROS/PE grids "System: finding" lines. Strings
	 * pass through untouched; this is what kills the old "[object Object]" output.
	 */
	private static _encounterFieldToText(key: string, value: unknown): string {
		if (value === undefined || value === null) { return ''; }
		if (typeof value === 'string') { return value; }
		const clean = (v: unknown): string => String(v ?? '').trim();
		switch (key) {
			case 'assessment_diagnoses': {
				if (!Array.isArray(value)) { return ''; }
				return value.map(d => {
					const o = (d ?? {}) as Record<string, unknown>;
					const code = clean(o.code ?? o.codeValue ?? o.icdCode);
					const desc = clean(o.description ?? o.display ?? o.shortDescription ?? o.longDescription);
					return code && desc ? `${code} — ${desc}` : (code || desc);
				}).filter(Boolean).join('\n');
			}
			case 'procedures_data': {
				if (!Array.isArray(value)) { return ''; }
				return value.map(p => {
					const o = (p ?? {}) as Record<string, unknown>;
					const code = clean(o.code ?? o.codeValue ?? o.cptCode);
					const desc = clean(o.description ?? o.display ?? o.shortDescription);
					const units = Number(o.units ?? 1) || 1;
					const base = code && desc ? `${code} — ${desc}` : (code || desc);
					if (!base) { return ''; }
					return units > 1 ? `${base} ×${units}` : base;
				}).filter(Boolean).join('\n');
			}
			case 'plan_items': {
				if (!Array.isArray(value)) { return ''; }
				return value.map(i => typeof i === 'string' ? i.trim() : clean((i as Record<string, unknown>)?.text ?? (i as Record<string, unknown>)?.item)).filter(Boolean).join('\n');
			}
			case 'ros_data':
			case 'pe_data': {
				if (typeof value !== 'object' || Array.isArray(value)) { return ''; }
				return Object.entries(value as Record<string, unknown>)
					.filter(([, v]) => clean(v) !== '')
					.map(([k, v]) => `${k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${clean(v)}`)
					.join('\n');
			}
		}
		return '';
	}

	/**
	 * Inverse of {@link _encounterFieldToText}: parse the popup textarea text back
	 * into the structured shape the composition stores, so an edit made here lands
	 * in the same place the dedicated Encounter form reads from.
	 */
	private static _textToEncounterField(key: string, text: string): unknown {
		const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
		switch (key) {
			case 'assessment_diagnoses':
			case 'procedures_data': {
				return lines.map(line => {
					// Split "CODE — Description" on the first hyphen / en-dash / em-dash.
					const m = /^(\S+)\s*[\u2014\u2013-]\s*(.*)$/.exec(line);
					let code = '';
					let desc = line;
					if (m) { code = m[1].trim(); desc = m[2].trim(); }
					if (key === 'procedures_data') {
						let units = 1;
						const um = /[×x]\s*(\d+)\s*$/i.exec(desc);
						if (um) { units = Number(um[1]) || 1; desc = desc.replace(/\s*[×x]\s*\d+\s*$/i, '').trim(); }
						return { code, description: desc, units };
					}
					return { code, description: desc };
				});
			}
			case 'plan_items':
				return lines;
			case 'ros_data':
			case 'pe_data': {
				const obj: Record<string, string> = {};
				for (const line of lines) {
					const idx = line.indexOf(':');
					if (idx < 0) { continue; }
					const sysKey = line.slice(0, idx).trim().toLowerCase().replace(/[^a-z]/g, '_');
					if (sysKey) { obj[sysKey] = line.slice(idx + 1).trim(); }
				}
				return obj;
			}
		}
		return text;
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
		const out = [...items];
		const indexById = new Map<string, number>();
		out.forEach((r, i) => { const id = String(r.id ?? r.fhirId ?? ''); if (id) { indexById.set(id, i); } });
		for (const p of pending) {
			const pid = String(p.id ?? p.fhirId ?? '');
			if (pid && indexById.has(pid)) {
				// The server already returns this row — but for an EDIT its search
				// index may still hold the stale values (e.g. the old date). Overlay
				// our locally-saved copy so the user's change is reflected instead of
				// being discarded as "server caught up" (QA: edited date not showing).
				const i = indexById.get(pid)!;
				out[i] = { ...out[i], ...p };
			} else {
				// A create the server hasn't indexed yet — surface it at the top.
				out.unshift(p);
			}
		}
		// Keep the overlay for the session: it's small, replaces by id, and clears
		// when the editor is reopened. This avoids a stale-vs-fresh flip-flop.
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
		// The Status dropdown is two-state (Signed/Unsigned); the patient-scoped
		// encounter endpoint accepts those values directly (see encounterListPane).
		const statusVal = PatientSnapshotEditor._normalizeEncounterStatus(values['status'] || 'UNSIGNED');
		if (!encounterId) {
			const reason = String(values['chiefComplaint'] || values['reason'] || '').trim();
			const startDate = values['startDate'] || new Date().toISOString();
			const createRes = await this.apiService.fetch(`/api/${pid}/encounters`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					visitCategory: values['type'] || 'AMB',
					encounterDate: startDate,
					status: statusVal,
					reasonForVisit: reason,
				}),
			});
			if (!createRes.ok) { return createRes; }
			const created = await createRes.json().catch(() => null);
			encounterId = String(created?.data?.id || created?.id || '');
			if (!encounterId) { throw new Error('Encounter created but server returned no id'); }
		} else {
			// Editing an existing encounter — persist the encounter-level status
			// (Signed/Unsigned) through the patient-scoped endpoint, since the
			// encounter-form composition save below only carries clinical content,
			// not the Encounter's own status. Mirrors encounterListPane's PUT.
			const reason = String(values['chiefComplaint'] || values['reason'] || '').trim();
			await this.apiService.fetch(`/api/${pid}/encounters/${encounterId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					visitCategory: values['type'] || undefined,
					encounterDate: values['startDate'] || undefined,
					encounterProvider: String(values['provider'] || '').trim() || undefined,
					status: statusVal,
					reasonForVisit: reason || undefined,
				}),
			}).catch(() => { /* non-fatal: the composition save below still runs */ });
		}
		const headers = { 'Content-Type': 'application/json' };
		// Convert the structured-field textareas (diagnoses/procedures/plan/ROS/PE)
		// back into the arrays/objects the composition stores. An edit field whose
		// text is unchanged from what we loaded is written back in its original
		// structured shape (no lossy re-parse); a changed field is parsed from text.
		const payload: Record<string, unknown> = { ...values };
		const isCreate = !existingId;
		for (const key of PatientSnapshotEditor._ENCOUNTER_TEXT_FIELDS) {
			const text = values[key];
			if (text === undefined) { continue; }
			if (!isCreate) {
				const orig = this._encounterComplexOriginals[key];
				if (orig !== undefined && text === PatientSnapshotEditor._encounterFieldToText(key, orig)) {
					payload[key] = orig;
					continue;
				}
			}
			payload[key] = PatientSnapshotEditor._textToEncounterField(key, text);
		}
		const body = JSON.stringify({ ...payload, patientId: pid, id: encounterId });
		const createUrl = `/api/fhir-resource/encounter-form/patient/${pid}?encounterRef=${encounterId}`;
		if (!existingId) {
			return this.apiService.fetch(createUrl, { method: 'POST', headers, body });
		}
		// Updating an existing encounter. PUT must target the encounter-form
		// Composition's OWN id (captured on load in `_encounterCompositionRef`), not
		// the Encounter id — they differ, so PUT-ing to the Encounter id 404'd, fell
		// through to POST-create, and minted a DUPLICATE composition that lost the
		// previously-saved codes (QA: edited encounter dropped diagnoses/procedures,
		// signed encounters appeared un-editable). Mirrors EncounterFormEditor.
		//
		// Encounters minted via the simple POST /api/{pid}/encounters ("Manual
		// encounter" rows, or any appointment whose chart was never opened) have NO
		// composition yet, so there is no id to PUT to — go straight to POST-create.
		// And if the PUT still 404s (composition deleted server-side), upsert via POST
		// so the edit persists either way.
		// Prefer the id captured on load (edit-pencil flow); fall back to a fresh
		// lookup for the records-list edit flow, which never calls _loadEncounterForEdit
		// and so has no cached composition id.
		let compId = this._encounterCompositionRef?.encId === encounterId ? this._encounterCompositionRef.compId : undefined;
		if (!compId) {
			const form = await this._fetch(`/api/fhir-resource/encounter-form/patient/${pid}?encounterRef=${encounterId}`);
			compId = this._extractEncounterComposition(form).compId;
		}
		if (!compId) {
			return this.apiService.fetch(createUrl, { method: 'POST', headers, body });
		}
		const updateRes = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${pid}/${compId}`, { method: 'PUT', headers, body });
		if (updateRes.status === 404) {
			return this.apiService.fetch(createUrl, { method: 'POST', headers, body });
		}
		return updateRes;
	}

	/**
	 * Collect a payment for the current patient. Payments are not a FHIR
	 * resource — the workspace records them via POST /api/payments/collect
	 * (mirrors the clinicalEditors PAYMENTS config). Maps the chart-editor
	 * payment form keys (paymentMethod / amount / reference / …) onto the
	 * collect endpoint's transaction shape.
	 */
	private async _savePayment(values: Record<string, string>): Promise<Response> {
		// This form RECORDS an already-applied payment (no live Stripe charge), so
		// there is never a saved card on hand. /api/payments/collect rejects
		// `credit_card`/`debit_card` unless a paymentMethodId is supplied ("A saved
		// payment method is required for card payments" → 400). Downgrade those two
		// to `other` so a recorded card payment posts; every other method (cash,
		// check, ach, fsa, hsa, bank_account, insurance, …) is accepted as-is.
		const METHOD_MAP: Record<string, string> = {
			credit_card: 'other', debit_card: 'other', cash: 'cash',
			check: 'check', eft: 'ach', ach: 'ach', bank_account: 'bank_account',
			fsa: 'fsa', hsa: 'hsa',
		};
		const rawMethod = String(values['paymentMethod'] || '').trim();
		// The RCM-style New Payment form has no plain "amount" field — it captures
		// Paid / Allowed amounts. Fall back through them so the backend doesn't
		// receive amount:0 (which fails with "A valid payment amount is required").
		const amount = Number(
			values['amount'] || values['paidAmount'] || values['allowedAmount'] || 0
		);
		if (!(amount > 0)) {
			// Surface a client-side validation error instead of POSTing a 400.
			return new Response(
				JSON.stringify({ message: 'Enter a payment amount greater than 0.' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}
		// Only send fields PaymentTransactionDto recognises. `invoiceNumber` (not
		// `invoiceId`) and `referenceType` are the real DTO keys.
		const payload: Record<string, unknown> = {
			patientId: this._currentPatientId,
			amount,
			transactionType: 'payment',
			paymentMethodType: METHOD_MAP[rawMethod] || (rawMethod || 'other'),
			referenceType: String(values['referenceType'] || '').trim() || undefined,
			description: String(values['description'] || values['payerName'] || '').trim() || undefined,
			invoiceNumber: String(values['invoiceNumber'] || '').trim() || undefined,
			receiptEmail: String(values['receiptEmail'] || '').trim() || undefined,
			notes: String(values['notes'] || values['reference'] || '').trim() || undefined,
			status: String(values['status'] || '').trim() || 'completed',
		};
		return this.apiService.fetch('/api/payments/collect', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	}

	/**
	 * Map a stored payment transaction record onto the chart-editor payment form
	 * keys so the Edit form pre-fills. The backend `PaymentTransactionDto` renames
	 * a couple of fields: the form uses `paymentDate` / `paymentMethod`, the DTO
	 * stores `collectedAt` / `paymentMethodType`. Without this remap the Edit
	 * Payment form opened with Payment Date and Method blank (Payment Date is
	 * required, so the form could not even be saved).
	 */
	private _normalizePaymentForEdit(item: Record<string, unknown>): Record<string, unknown> {
		const dateOnly = (v: unknown): string => { const s = String(v ?? '').trim(); return s ? s.slice(0, 10) : ''; };
		const out: Record<string, unknown> = { ...item };
		out.paymentDate = dateOnly(item.paymentDate ?? item.collectedAt ?? item.transactionDate ?? item.date ?? item.createdAt);
		if (item.dateOfService) { out.dateOfService = dateOnly(item.dateOfService); }
		if (!out.paymentMethod) { out.paymentMethod = String(item.paymentMethod ?? item.paymentMethodType ?? item.method ?? ''); }
		if (out.amount === undefined || out.amount === null || out.amount === '') { out.amount = item.amount ?? item.totalAmount ?? ''; }
		return out;
	}

	/**
	 * Map the payment Edit form values back onto the transaction DTO keys so an
	 * edited Payment Date / Method actually persists on PUT
	 * /api/payments/transactions/{id} (inverse of {@link _normalizePaymentForEdit}).
	 */
	private _applyPaymentEditKeys(payload: Record<string, unknown>): Record<string, unknown> {
		const out = { ...payload };
		if (out.paymentDate) { out.collectedAt = out.paymentDate; }
		const method = out.paymentMethod ?? out.paymentMethodType;
		if (method) { out.paymentMethodType = method; }
		if (out.amount !== undefined && out.amount !== '') { out.amount = Number(out.amount); }
		return out;
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
		// so clicking it should jump straight to the patient's full chart page
		// (Demographics section) rather than surfacing a single-record popup or
		// the narrow side-panel view.
		if (entity === 'demographics') { this._openPatientChartPage('demographics'); return; }
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
			// Adding a record via a card's "+" opens this dialog straight in create
			// mode — close it after a successful save instead of dropping the user
			// into the records list (same close-on-save behaviour as the edit-pencil
			// flow). List-mode entries (Payment History, Pending items) keep their
			// list view so users can keep managing the collection.
			closeOnSave: initialMode === 'create',
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
				// Payment create routes through /api/payments/collect (not a FHIR
				// resource). Edits fall through to the generic PUT on
				// /api/payments/transactions/{id}.
				if (entity === 'payment' && !existingId) {
					const res = await this._savePayment(next);
					if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
					let saved: Record<string, unknown> | null = null;
					try {
						const j = await res.json();
						const cand = (j?.data ?? j) as Record<string, unknown> | null;
						if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
					} catch { /* non-JSON body */ }
					if (saved) { this._trackCreated(entity, { ...next, ...saved }); }
					this.notificationService.notify({ severity: Severity.Info, message: 'Payment collected.' });
					this._rerender();
					return;
				}
				const { url, method } = this._saveUrl(entity, existingId);
				let payload: Record<string, unknown> = { ...next };
				// Payment edit (PUT): map form keys back to the transaction DTO keys
				// so an edited Payment Date / Method persists (create goes through
				// _savePayment above; this branch only runs for edits).
				if (entity === 'payment') { payload = this._applyPaymentEditKeys(payload); }
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

	private async _openEditModal(entity: string, item: Record<string, unknown>): Promise<void> {
		if (!this._currentPatientId) { return; }
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		if (!reg) { return; }
		const fields = this._entityFields(entity);
		if (fields.length === 0) { return; }
		// Encounters: the dashboard list record only carries the bare FHIR
		// Encounter columns (date, status, reason). The rich clinical fields the
		// edit form shows — start/end date, provider, vitals and the HPI/ROS/PE/
		// assessment/plan composition — live on the encounter-form Composition and
		// the full Encounter resource, so load and merge them before opening the
		// form (QA issue 2: encounter edit opened with start/end date, provider
		// and vitals all blank).
		const initialItem = entity === 'encounters' ? await this._loadEncounterForEdit(item)
			: entity === 'payment' ? this._normalizePaymentForEdit(item)
				: item;
		openListAndFormDialog({
			title: reg.title,
			themeAnchor: this.root,
			fields,
			listColumns: reg.columns,
			initialMode: 'edit',
			initialItem,
			// Focused edit from the snapshot's edit-pencil: close after saving
			// instead of dropping the user into the full records list.
			closeOnSave: true,
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
					// The dashboard reads the encounter date from any of these keys; map
					// the edited start date onto all of them so the overlay shows the
					// new date immediately even though `saved` (the form Composition)
					// and the stale search index still carry the old one.
					const overlay: Record<string, unknown> = { ...item, ...next, ...(saved || {}) };
					const newStart = (next['startDate'] ?? next['date']) as string | undefined;
					if (newStart) {
						for (const k of ['encounterDate', 'startDate', 'start', 'date', 'periodStart', 'dateOfService']) {
							overlay[k] = newStart;
						}
					}
					this._trackCreated(entity, overlay);
					this.notificationService.notify({ severity: Severity.Info, message: 'Encounter updated.' });
					this._rerender();
					return;
				}
				const { url, method } = this._saveUrl(entity, existingId);
				let payload: Record<string, unknown> = { ...item, ...next };
				// Payment edit: map the form keys (paymentDate/paymentMethod) back to
				// the transaction DTO keys (collectedAt/paymentMethodType) so changes
				// persist (mirrors _normalizePaymentForEdit on the way in).
				if (entity === 'payment') { payload = this._applyPaymentEditKeys(payload); }
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

	/**
	 * Unwrap the encounter-form endpoint response to the single most-recent
	 * Composition. The endpoint returns a paginated envelope ({ content, page,
	 * size, … }); older responses returned the bare object. Picks the most
	 * recently updated composition along with its id, so the save path can PUT back
	 * to the SAME composition rather than minting a duplicate. Pure (no instance
	 * state) — callers store the id where they need it. Mirrors
	 * EncounterFormEditor._loadEncounterData's composition pick.
	 */
	private _extractEncounterComposition(form: Record<string, unknown> | null): { comp: Record<string, unknown>; compId: string | undefined } {
		const dd = (form?.data ?? form ?? {}) as Record<string, unknown>;
		const content = Array.isArray(dd.content) ? dd.content as Array<Record<string, unknown>> : null;
		const picked = content && content.length
			? [...content].sort((a, b) => String(b._lastUpdated ?? '').localeCompare(String(a._lastUpdated ?? '')))[0]
			: dd;
		const comp = (picked && typeof picked === 'object' && !Array.isArray(picked)) ? picked : {};
		return { comp, compId: comp.id ? String(comp.id) : undefined };
	}

	/**
	 * Build the initial values for the encounter edit form. The snapshot list
	 * record only has the bare Encounter columns, so we fetch the full Encounter
	 * resource and its encounter-form Composition (mirrors EncounterFormEditor's
	 * `_loadEncounterData`) and normalise everything onto the form field keys
	 * (`startDate`, `endDate`, `provider`, `type`, `status`, `vitals_*`, the
	 * HPI/ROS/PE/assessment/plan composition, …). Best-effort: a failed fetch
	 * falls back to whatever the list record already carried.
	 */
	private async _loadEncounterForEdit(item: Record<string, unknown>): Promise<Record<string, unknown>> {
		const pid = this._currentPatientId;
		const encId = String(item.id ?? item.fhirId ?? '');
		const merged: Record<string, unknown> = { ...item };
		if (!pid || !encId) { return merged; }

		const [detail, ehr, form] = await Promise.all([
			this._fetch(`/api/fhir-resource/encounters/${encId}`),
			// The EHR endpoint runs enrichEncounterFields() on the server, returning
			// mapped flat keys the form needs (startDate/encounterDate, visitCategory,
			// encounterProvider/providerDisplay, mapped status) — the raw generic
			// FHIR resource above does not. Without this the Edit Encounter modal's
			// start/end date, provider and status came up blank (QA issue 6).
			this._fetch(`/api/${pid}/encounters/${encId}`),
			this._fetch(`/api/fhir-resource/encounter-form/patient/${pid}?encounterRef=${encId}`),
		]);
		const detailData = (detail?.data ?? detail ?? {}) as Record<string, unknown>;
		const ehrData = (ehr?.data ?? ehr ?? {}) as Record<string, unknown>;
		// The encounter-form endpoint wraps the composition(s) in a paginated
		// envelope ({ content, page, size, … }). Pick the most recently updated
		// composition so ALL saved data — including the full assessment_diagnoses /
		// procedures_data code arrays — is loaded back. Reading `form.data` directly
		// returned the envelope (no clinical fields), so the edit modal came up with
		// only the encounter's primary diagnosis and dropped the rest (QA: 3 codes
		// captured, only 2 shown). Mirrors EncounterFormEditor._loadEncounterData.
		const { comp: formData, compId } = this._extractEncounterComposition(form);
		this._encounterCompositionRef = { encId, compId };
		// Composition wins over the enriched EHR encounter, which wins over the bare
		// FHIR resource, which wins over the list row.
		Object.assign(merged, detailData, ehrData, formData);
		// Flatten a nested FHIR period ({start,end}) onto the keys `pick` looks for.
		const period = (detailData['period'] ?? ehrData['period']) as Record<string, unknown> | undefined;
		if (period && typeof period === 'object') {
			if (period['start'] && !merged['periodStart']) { merged['periodStart'] = period['start']; }
			if (period['end'] && !merged['periodEnd']) { merged['periodEnd'] = period['end']; }
		}
		// The encounter-form Composition carries its OWN id — never let it clobber
		// the Encounter id, which the save path uses to PUT the composition back.
		merged.id = encId;
		if (item.fhirId) { merged.fhirId = item.fhirId; }

		const pick = (...keys: string[]): string => {
			for (const k of keys) {
				const v = merged[k];
				if (v !== undefined && v !== null && String(v) !== '') { return String(v); }
			}
			return '';
		};
		// HTML date inputs need a bare YYYY-MM-DD value.
		const dateOnly = (v: string): string => {
			if (!v) { return ''; }
			const dt = new Date(v);
			return isNaN(dt.getTime()) ? v.slice(0, 10) : dt.toISOString().slice(0, 10);
		};

		merged.startDate = dateOnly(pick('startDate', 'start', 'periodStart', 'encounterDate', 'date', 'createdAt'));
		const end = pick('endDate', 'end', 'periodEnd');
		if (end) { merged.endDate = dateOnly(end); }
		merged.type = pick('type', 'visitCategory', 'encounterType', 'class') || merged.type;
		// Collapse whatever status the encounter loads with (FHIR codes like
		// 'finished'/'in-progress', or the EHR 'SIGNED'/'UNSIGNED'/'INCOMPLETE')
		// onto the two-state model the Status dropdown offers.
		merged.status = PatientSnapshotEditor._normalizeEncounterStatus(pick('status') || merged.status);
		// Provider: prefer a human-readable display over the raw "Practitioner/{id}"
		// reference so the search field shows a name (QA issue 2: provider blank/raw).
		merged.provider = pick('providerDisplay', 'providerName', 'practitionerName', 'encounterProvider', 'provider');
		merged.chiefComplaint = pick('chiefComplaint', 'reason', 'reasonForVisit', 'reasonCode');

		// Stash the raw structured values and replace them with readable text so the
		// popup textareas render the diagnoses/procedures/plan/ROS/PE instead of
		// "[object Object]". The originals let the save path leave untouched fields
		// in their structured shape (see `_saveEncounterComposition`).
		this._encounterComplexOriginals = {};
		for (const key of PatientSnapshotEditor._ENCOUNTER_TEXT_FIELDS) {
			const raw = merged[key];
			if (raw === undefined) { continue; }
			this._encounterComplexOriginals[key] = raw;
			merged[key] = PatientSnapshotEditor._encounterFieldToText(key, raw);
		}

		return merged;
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
		// The backend has no GET /api/appointments/{id} (it 500s with "Request
		// method 'GET' is not supported"), so resolve the appointment from a list
		// and match by id when one was provided.
		const today = new Date().toISOString().split('T')[0];
		const readList = async (url: string): Promise<Record<string, unknown>[]> => {
			try {
				const raw = await this._fetch(url);
				if (!raw) { return []; }
				const inner = (raw.data ?? raw) as Record<string, unknown>;
				return (inner.content || inner.list || inner.items || inner.records ||
					(Array.isArray(inner) ? inner : Array.isArray(raw) ? raw : [])) as Record<string, unknown>[];
			} catch { return []; }
		};

		// When a specific appointment was requested (the user clicked THAT visit),
		// it may not be today's — e.g. a future Scheduled appointment. Searching only
		// today's window made those fall back to today's (often Completed) visit, so
		// a freshly-scheduled appointment wrongly rendered as completed with an
		// encounter. Search the patient's FULL appointment list first and return the
		// exact match so the snapshot always reflects the appointment that was opened.
		if (appointmentId) {
			for (const url of [
				`/api/appointments?patientId=${patientId}&page=0&size=100`,
				`/api/fhir-resource/appointments?patientId=${patientId}&page=0&size=100`,
			]) {
				const match = (await readList(url)).find(a => String(a.id ?? a.appointmentId ?? '') === String(appointmentId));
				if (match) { return match; }
			}
		}

		// No id (or id not found): fall back to today's appointment for this patient.
		for (const url of [
			`/api/appointments?patientId=${patientId}&dateFrom=${today}&dateTo=${today}&page=0&size=5`,
			`/api/appointments?patientId=${patientId}&date=${today}&page=0&size=5`,
			`/api/fhir-resource/appointments?patientId=${patientId}&dateFrom=${today}&dateTo=${today}&page=0&size=5`,
		]) {
			const arr = await readList(url);
			if (arr.length > 0) { return arr[0]; }
		}
		return null;
	}

	private async _loadAndRender(patientId: string, patientName: string, appointmentId?: string): Promise<void> {
		this._lastRenderArgs = { patientId, patientName, appointmentId };
		const [patient, conditions, medications, vitals, encounters, labs, payments, statements, coverage, appointments] = await Promise.allSettled([
			this._fetch(`/api/patients/${patientId}`),
			this._fetch(`/api/medical-problems/${patientId}`),
			this._fetch(`/api/fhir-resource/medications/patient/${patientId}?page=0&size=50`),
			this._fetch(`/api/fhir-resource/vitals/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/encounters/patient/${patientId}?page=0&size=50`),
			this._fetch(`/api/fhir-resource/labs/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/payments/transactions/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/statements/patient/${patientId}?page=0&size=1`),
			this._fetch(`/api/fhir-resource/insurance-coverage/patient/${patientId}?page=0&size=1`),
			// Full appointment history for this patient — powers the Visit History
			// card (which lists VISITS, distinct from the clinical Encounter History).
			this._fetch(`/api/appointments?patientId=${patientId}&page=0&size=50`),
		]);

		const apt = await this._fetchTodayAppointment(patientId, appointmentId);
		// Reflect any status change made this session, since the refetched
		// appointment may still carry the pre-change status (index lag / a
		// Completed status that only the full PUT accepted).
		if (apt) {
			const aptId = String(apt.id ?? apt.appointmentId ?? '');
			const override = aptId ? this._apptStatusOverride.get(aptId) : undefined;
			if (override) {
				Object.assign(apt, override);
				if (override.status !== undefined) { apt.appointmentStatus = override.status; }
			}
			// Authoritatively resolve the appointment ↔ encounter link. The
			// appointment LIST record does not reliably carry `encounterId` (it lags
			// the index, and visits completed elsewhere may never have it), so the
			// whole workflow downstream of "Encounter" would stay locked. The
			// dedicated GET /api/appointments/{id}/encounter endpoint is the source of
			// truth for the link — backfill from it whenever the record has no id yet.
			if (aptId && !String(apt.encounterId ?? '').trim()) {
				const linkedId = await this._resolveAppointmentEncounterId(aptId);
				if (linkedId) { apt.encounterId = linkedId; }
			}
		}
		await this._ensureLocationNames();

		if (this._currentPatientId !== patientId) { return; }

		// Patient API may wrap the body in { data: {...} } depending on the
		// backend version — unwrap here so the header can read fields like
		// dateOfBirth / mrn directly.
		const patientRaw = patient.status === 'fulfilled' ? patient.value : null;
		const p = ((patientRaw?.data ?? patientRaw) as Record<string, unknown> | null);
		const conds = this._mergePending('problems', this._filterDeleted('problems', this._list(conditions)));
		const meds = this._mergePending('medications', this._filterDeleted('medications', this._list(medications)));
		const vit = this._mergePending('vitals', this._filterDeleted('vitals', this._list(vitals)));
		const encs = this._filterToPatient(this._mergePending('encounters', this._filterDeleted('encounters', this._list(encounters))), patientId);
		const labList = this._mergePending('labs', this._filterDeleted('labs', this._list(labs)));
		const payList = this._mergePending('payment', this._filterDeleted('payment', this._list(payments)));
		const stmtList = this._list(statements);
		const cov = this._list(coverage);
		const apptList = this._list(appointments);

		// Resolve the encounter tied to TODAY's visit (by appointment link, else a
		// same-day encounter) and load its fee sheet so the Visit Pipeline card can
		// show how far along the revenue cycle this visit is.
		const todayEnc = this._todayEncounter(apt, encs);
		const todayEncId = todayEnc ? String(todayEnc.id ?? todayEnc.fhirId ?? '') : String(apt?.encounterId ?? '');
		let feeSheet: Record<string, unknown> | null = null;
		if (todayEncId) {
			try {
				const fsRaw = await this._fetch(`/api/fee-sheets/encounter/${encodeURIComponent(todayEncId)}`);
				const fsInner = (fsRaw?.data ?? fsRaw) as unknown;
				const fs = (Array.isArray(fsInner) ? fsInner[0] : fsInner) as Record<string, unknown> | null | undefined;
				// Treat a non-empty object carrying an id (or line items) as a real fee sheet.
				if (fs && (fs.id !== undefined || Array.isArray(fs.items) || Array.isArray(fs.lines))) { feeSheet = fs; }
			} catch { /* no fee sheet yet */ }

			// Vitals captured in the encounter form (the `vitals_*` keys on the
			// encounter-form Composition) are NOT FHIR vitals Observations, so they
			// never showed in Today's Vitals. When a visit is completed an encounter
			// is auto-created and the provider records vitals there — surface those by
			// mapping the composition's `vitals_*` onto a synthetic vitals record, but
			// only when no FHIR vitals were recorded for today (the inline form writes
			// real Observations, which take precedence).
			if (this._todaysVitals(vit).length === 0) {
				try {
					const form = await this._fetch(`/api/fhir-resource/encounter-form/patient/${patientId}?encounterRef=${encodeURIComponent(todayEncId)}`);
					const { comp } = this._extractEncounterComposition(form);
					const encDate = todayEnc?.encounterDate || todayEnc?.startDate || todayEnc?.start || todayEnc?.date || todayEnc?.periodStart;
					const encVitals = this._compositionVitalsRecord(comp, encDate);
					if (encVitals) { vit.unshift(encVitals); }
				} catch { /* no encounter-form vitals */ }
			}
		}
		if (this._currentPatientId !== patientId) { return; }

		const pipeline: VisitPipelineState = { encounter: todayEnc, feeSheet, statement: stmtList[0] ?? null, payments: payList };
		DOM.clearNode(this.root);
		this._renderHeader(p, patientName, apt, cov);
		this._renderWorkflowBanner(apt, vit, encs, pipeline);
		this._renderGrid(p, conds, meds, vit, encs, labList, payList, stmtList, apt, apptList, pipeline);
	}

	/** The encounter that belongs to today's visit: the appointment's linked
	 *  encounter if present, otherwise a same-day encounter from the chart. */
	private _todayEncounter(apt: Record<string, unknown> | null, encs: Record<string, unknown>[]): Record<string, unknown> | null {
		const linkedId = String(apt?.encounterId ?? '');
		if (linkedId) {
			const byId = encs.find(e => String(e.id ?? e.fhirId ?? '') === linkedId);
			if (byId) { return byId; }
		}
		return encs.find(e => this._isToday(e.encounterDate || e.startDate || e.start || e.date || e.periodStart)) ?? null;
	}

	// --- Workflow model (demo) --------------------------------------------
	//
	// The redesign is workflow-driven: Front Desk → Medical Staff → Doctor.
	// Every action card derives its state from these five ordered steps so the
	// UI can highlight the *next* required action and disable steps that are
	// not yet reachable.

	private _isToday(dateRaw: unknown): boolean {
		if (!dateRaw) { return false; }
		try {
			const d = new Date(String(dateRaw));
			const now = new Date();
			return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
		} catch { return false; }
	}

	/** Vitals recorded during today's visit only — the redesign deliberately
	 *  hides older imported readings from the "Today's Vitals" card. */
	private _todaysVitals(vit: Record<string, unknown>[]): Record<string, unknown>[] {
		return vit.filter(v => this._isToday(v.recordedAt || v.effectiveDateTime || v.recordedDate || v.dateRecorded || v.date));
	}

	/**
	 * Map an encounter-form Composition's `vitals_*` fields onto the FHIR-vitals
	 * record shape the Today's Vitals card reads (heightCm/weightKg/bpSystolic/…).
	 * This is the inverse of EncounterFormEditor._mapLatestVitals. Stamps the
	 * record with the encounter date so `_todaysVitals` keeps it when it is today's.
	 * Returns null when the composition carries no vitals at all.
	 */
	private _compositionVitalsRecord(comp: Record<string, unknown>, encDate: unknown): Record<string, unknown> | null {
		const num = (key: string): number | undefined => {
			const v = comp[key];
			if (v === undefined || v === null || String(v).trim() === '') { return undefined; }
			const n = Number(v);
			return Number.isFinite(n) ? n : undefined;
		};
		const mapping: Array<[string, string]> = [
			['bpSystolic', 'vitals_bp_systolic'],
			['bpDiastolic', 'vitals_bp_diastolic'],
			['pulse', 'vitals_heart_rate'],
			['temperatureC', 'vitals_temperature'],
			['oxygenSaturation', 'vitals_spo2'],
			['respiration', 'vitals_respiratory_rate'],
			['weightKg', 'vitals_weight'],
			['heightCm', 'vitals_height'],
			['bmi', 'vitals_bmi'],
		];
		const out: Record<string, unknown> = {};
		for (const [target, src] of mapping) {
			const n = num(src);
			if (n !== undefined) { out[target] = n; }
		}
		if (Object.keys(out).length === 0) { return null; }
		// Tag as today's reading so it surfaces in the Today's Vitals card, and mark
		// the source so it is never treated as an editable FHIR Observation.
		out.recordedAt = (encDate ? String(encDate) : new Date().toISOString());
		out._source = 'encounter-form';
		return out;
	}

	/** Extract the patient id an encounter is linked to, tolerant of the many
	 *  shapes the FHIR backend returns (`patientId`, `patientRef`, FHIR
	 *  `subject.reference`, etc.). The leading `Patient/` reference prefix is
	 *  stripped so it can be compared to the raw patient id. Returns '' when the
	 *  encounter carries no patient reference at all. */
	private _encounterPatientId(enc: Record<string, unknown>): string {
		const strip = (v: unknown): string => String(v ?? '').replace(/^Patient\//, '').trim();
		const direct = enc.patientId ?? enc.patient ?? enc.subjectId ?? enc.patientRef ?? enc.subjectReference;
		if (direct) { return strip(direct); }
		const subj = enc.subject as Record<string, unknown> | string | undefined;
		if (typeof subj === 'string') { return strip(subj); }
		if (subj && typeof subj === 'object') { return strip(subj.reference ?? subj.id); }
		return '';
	}

	/** Keep only the encounters that belong to the patient on screen. The
	 *  `/encounters/patient/{id}` endpoint can return cross-patient rows (the
	 *  "history shows everyone's visits" report), so the snapshot filters them
	 *  client-side. Safety valve: if some rows carry a patient reference but NONE
	 *  match this patient, the id formats differ (FHIR id vs internal) — leave the
	 *  list untouched rather than blanking the entire history. */
	private _filterToPatient(encs: Record<string, unknown>[], patientId: string): Record<string, unknown>[] {
		const pid = String(patientId);
		const refs = encs.map(e => this._encounterPatientId(e));
		const anyRef = refs.some(r => r);
		const anyMatch = refs.some(r => r === pid);
		if (anyRef && !anyMatch) { return encs; }
		return encs.filter((_e, i) => !refs[i] || refs[i] === pid);
	}

	/** Slim "next action" banner pinned above the grid. It reads from the SAME
	 *  {@link _buildVisitStages} model as the Visit Workflow strip, so the two can
	 *  never disagree (they previously had separate step lists — the banner said
	 *  "Assign Room" while the strip showed Encounter/Sign as done). It names the
	 *  one next step and offers a single button that performs it. */
	private _renderWorkflowBanner(apt: Record<string, unknown> | null, vit: Record<string, unknown>[], encs: Record<string, unknown>[], st: VisitPipelineState): void {
		if (!apt) { return; }
		const { stages, currentIdx } = this._buildVisitStages(apt, vit, encs, st);
		const next = currentIdx < stages.length ? stages[currentIdx] : null;

		const banner = DOM.append(this.root, DOM.$('.snap-workflow-banner'));
		banner.style.cssText = 'margin:14px 24px 0;padding:12px 16px;border-radius:10px;border:1px solid var(--vscode-editorWidget-border);background:linear-gradient(90deg,rgba(14,99,156,0.16),rgba(14,99,156,0.04));display:flex;align-items:center;gap:16px;flex-wrap:wrap;';

		const lead = DOM.append(banner, DOM.$('div'));
		lead.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:200px;flex:1;';
		const leadIco = DOM.append(lead, DOM.$('span.codicon.codicon-' + (next ? 'arrow-right' : 'check-all')));
		(leadIco as HTMLElement).style.cssText = `font-size:20px;color:${next ? '#3b9edd' : '#22c55e'};`;
		const leadText = DOM.append(lead, DOM.$('div'));
		const leadLbl = DOM.append(leadText, DOM.$('div'));
		leadLbl.textContent = next ? `NEXT ACTION · STEP ${currentIdx + 1} OF ${stages.length}` : 'WORKFLOW COMPLETE';
		leadLbl.style.cssText = 'font-size:9.5px;font-weight:800;letter-spacing:0.08em;color:var(--vscode-descriptionForeground);';
		const leadVal = DOM.append(leadText, DOM.$('div'));
		leadVal.textContent = next ? `${next.label} — ${next.sub}` : 'All steps done — visit fully processed';
		leadVal.style.cssText = `font-size:16px;font-weight:800;color:${next ? 'var(--vscode-editor-foreground)' : '#22c55e'};`;

		// Single action button for the one next step — keeps the banner a clear
		// "do this next" prompt rather than a second copy of the workflow strip.
		if (next?.action) {
			const go = DOM.append(banner, DOM.$('button')) as HTMLButtonElement;
			go.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 16px;font-size:12.5px;font-weight:700;border-radius:8px;border:1px solid transparent;cursor:pointer;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);';
			const goIco = DOM.append(go, DOM.$('span.codicon.codicon-' + next.icon));
			(goIco as HTMLElement).style.cssText = 'font-size:14px;';
			const goLbl = DOM.append(go, DOM.$('span'));
			goLbl.textContent = next.label;
			go.addEventListener('mouseenter', () => { go.style.background = 'var(--vscode-button-hoverBackground,#1177bb)'; });
			go.addEventListener('mouseleave', () => { go.style.background = 'var(--vscode-button-background,#0e639c)'; });
			go.addEventListener('click', (e) => { e.stopPropagation(); next.action?.(); });
		}
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
			{ icon: '', customClass: 'ehr-patient-icon', title: 'Open Demographics', onClick: () => this._openPatientChartPage('demographics') },
			{ icon: 'credit-card', title: 'Add Payment / Statement', onClick: () => this._openCreateModal('payment') },
			{ icon: 'file-text', title: 'Billing & Claims', onClick: () => this._openCreateModal('claims') },
		];
		for (const a of primary) {
			this._renderIconBtn(actions, a);
		}

		// NOTE: "Record Vitals" is deliberately omitted here — vitals are captured
		// through the inline entry form on the Today's Vitals card and the
		// Quick Actions "Record Vitals" tile, so a third duplicate menu entry
		// only adds confusion (per QA feedback).
		const overflowItems: QuickAction[] = [
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

	/** Merge changed appointment fields into the session overlay (keyed by id). */
	private _setApptOverride(id: string, patch: Record<string, unknown>): void {
		if (!id) { return; }
		this._apptStatusOverride.set(id, { ...(this._apptStatusOverride.get(id) || {}), ...patch });
	}

	private async _updateAppointmentStatus(id: string, status: string, apt?: Record<string, unknown>): Promise<boolean> {
		if (!id) { return false; }
		// Primary path: the dedicated status sub-resource.
		try {
			const res = await this.apiService.fetch(`/api/appointments/${id}/status`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status }),
			});
			if (res.ok) { this._setApptOverride(id, { status }); return true; }
		} catch { /* fall through to the full-update fallback */ }
		// Fallback: re-issue as a full appointment PUT (the same call the Edit
		// dialog uses). The `/status` sub-resource can reject a transition once the
		// appointment is terminal (Completed / Cancelled), and the previous silent
		// `catch` left the pill reverting to the old status with no feedback — the
		// "can't update a completed appointment's status" report. The full PUT has
		// no such guard, so the status can always be corrected.
		if (apt) {
			try {
				const res = await this.apiService.fetch(`/api/appointments/${id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...apt, status }),
				});
				if (res.ok) { this._setApptOverride(id, { status }); return true; }
			} catch { /* surfaced below */ }
		}
		this.notificationService.notify({ severity: Severity.Error, message: 'Could not update the appointment status. Please try again.' });
		return false;
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

	/** Appointment status options — backend list with a sensible fallback. Shared
	 *  by the edit dialog and the inline Status dropdown on the appointment card. */
	private async _fetchStatusOptions(): Promise<string[]> {
		const fallback = ['Scheduled', 'Confirmed', 'Arrived', 'Checked-in', 'In Room', 'With Provider', 'Completed', 'Re-Scheduled', 'No Show', 'Cancelled'];
		try {
			const res = await this.apiService.fetch('/api/appointments/status-options');
			if (res.ok) {
				const data = await res.json();
				const opts = ((data?.data || data || []) as Array<{ label?: string; value?: string } | string>)
					.map(o => (typeof o === 'string' ? o : o.label || o.value || '')).filter(Boolean);
				if (opts.length > 0) { return opts; }
			}
		} catch { /* keep fallback */ }
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

	/** Resolve the appointment duration (minutes) from whichever field the
	 *  backend supplied — a numeric duration, or the gap between start and end.
	 *  The card previously read only `apt.duration`, which the appointments API
	 *  often omits, so Duration always showed "—" (QA report). */
	private _apptDurationMin(apt: Record<string, unknown>): number {
		const direct = Number(apt.duration ?? apt.minutesDuration ?? apt.durationMinutes ?? apt.lengthMinutes ?? 0);
		if (direct > 0) { return Math.round(direct); }
		const startRaw = String(apt.start || apt.startTime || '');
		const endRaw = String(apt.end || apt.endTime || apt.appointmentEndTime || '');
		if (startRaw && endRaw) {
			const s = new Date(startRaw).getTime();
			let e = new Date(endRaw).getTime();
			if (isNaN(e)) {
				// `end` may be a bare "HH:mm" — combine it with the start's date.
				const tm = /^(\d{2}):(\d{2})/.exec(endRaw);
				const dm = /^(\d{4}-\d{2}-\d{2})/.exec(startRaw);
				if (tm && dm) { e = new Date(`${dm[1]}T${tm[1]}:${tm[2]}:00`).getTime(); }
			}
			if (!isNaN(s) && !isNaN(e) && e > s) { return Math.round((e - s) / 60000); }
		}
		return 0;
	}

	/** PUT a new appointment status, then refresh the dashboard so the card,
	 *  status pill and available actions all reflect the new state. */
	private async _changeApptStatus(id: string, status: string, apt?: Record<string, unknown>): Promise<void> {
		if (!id) { return; }
		await this._updateAppointmentStatus(id, status, apt);
		this._rerender();
	}

	/** True when an appointment status string denotes a finished visit. */
	private static _isCompletedStatus(status: unknown): boolean {
		const s = String(status || '').toLowerCase().replace(/[_-]/g, ' ').trim();
		return s === 'completed' || s === 'complete' || s === 'fulfilled' || s === 'finished';
	}

	/** True when the appointment already has a linked encounter (either on the
	 *  appointment itself or as a same-day encounter in the chart). */
	private _appointmentHasEncounter(apt: Record<string, unknown>, encs?: Record<string, unknown>[]): boolean {
		if (apt.encounterId) { return true; }
		if (encs && encs.some(e => this._isToday(e.encounterDate || e.startDate || e.start || e.date || e.periodStart))) { return true; }
		return false;
	}

	/** Mark the appointment Completed and, when no encounter exists yet,
	 *  automatically spin one up from the appointment and open it. This is the
	 *  "select Completed → encounter feature" integration: completing a visit
	 *  always leaves a documented encounter behind. */
	private async _completeAppointmentWithEncounter(apt: Record<string, unknown>): Promise<void> {
		const id = String(apt.id || apt.appointmentId || '');
		if (!id) { return; }
		await this._updateAppointmentStatus(id, 'Completed', apt);
		// Already linked → nothing to create, just refresh.
		if (apt.encounterId) {
			this._rerender();
			return;
		}
		// _createEncounterFromAppointment is idempotent (checks apt.encounterId then
		// a read-only GET before creating) — it mints the FHIR encounter, links it to
		// the appointment + patient, and rerenders the dashboard so the Encounter
		// status reads "Created". This is the ONLY place the snapshot creates one.
		await this._createEncounterFromAppointment(apt);
	}

	/** Apply a status chosen from the inline Status dropdown. Selecting a
	 *  completed status routes through the auto-encounter flow; everything else
	 *  is a plain status change. */
	private async _applyStatusSelection(apt: Record<string, unknown>, appointmentId: string, status: string): Promise<void> {
		if (!appointmentId || !status) { return; }
		if (PatientSnapshotEditor._isCompletedStatus(status)) {
			// Only the FIRST transition into Completed spins up the encounter. If the
			// appointment is ALREADY completed, re-selecting Completed must NOT create
			// another one — the backend's POST /encounter has no dedupe, so re-running
			// the flow is exactly what produced the duplicate encounters (QA report).
			// Re-completing just re-saves the status (effectively a no-op).
			const wasCompleted = PatientSnapshotEditor._isCompletedStatus(apt.status ?? apt.appointmentStatus);
			if (wasCompleted) {
				await this._changeApptStatus(appointmentId, status, apt);
				return;
			}
			await this._completeAppointmentWithEncounter({ ...apt, status });
			return;
		}
		await this._changeApptStatus(appointmentId, status, apt);
	}

	/** Resolve a color for a status string (green=completed, red=cancel/no-show,
	 *  blue=in-flight, muted=unknown). */
	private static _statusColor(status: string): string {
		const s = status.toLowerCase();
		if (s.includes('complet') || s.includes('fulfil') || s.includes('finish')) { return '#22c55e'; }
		if (s.includes('cancel') || s.includes('no show') || s.includes('noshow')) { return '#ef4444'; }
		if (s === '—' || s === '') { return 'var(--vscode-descriptionForeground)'; }
		return '#3b9edd';
	}

	/** Render the appointment Status as a clickable pill that opens a dropdown of
	 *  status options. Selecting one applies it inline (no modal) — mirrors the
	 *  page's other inline editors (e.g. vitals entry). */
	private _renderStatusDropdown(cell: HTMLElement, apt: Record<string, unknown>, appointmentId: string, currentStatus: string): void {
		const wrap = DOM.append(cell, DOM.$('div'));
		wrap.style.cssText = 'position:relative;display:inline-block;margin-top:1px;';
		const color = PatientSnapshotEditor._statusColor(currentStatus);

		// Once a visit is Completed the status is LOCKED — completing the
		// appointment is what creates/finalizes its encounter, so re-opening the
		// status (and re-running that flow) would risk duplicate encounters and
		// breaks the "complete means complete" rule. Render a static, non-clickable
		// chip with a lock glyph instead of the editable pill.
		const locked = PatientSnapshotEditor._isCompletedStatus(currentStatus);
		const interactive = !!appointmentId && !locked;

		const trigger = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
		trigger.title = locked ? 'Status locked — this visit is Completed' : 'Change appointment status';
		trigger.disabled = !interactive;
		trigger.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:12px;border:1px solid ${color}66;background:${color}1f;color:${color};font-size:12px;font-weight:700;cursor:${interactive ? 'pointer' : 'default'};max-width:100%;`;
		if (locked) {
			const lockIco = DOM.append(trigger, DOM.$('span.codicon.codicon-lock'));
			(lockIco as HTMLElement).style.cssText = 'font-size:11px;flex-shrink:0;';
		}
		const txt = DOM.append(trigger, DOM.$('span'));
		txt.textContent = currentStatus;
		txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		if (interactive) {
			const caret = DOM.append(trigger, DOM.$('span.codicon.codicon-chevron-down'));
			(caret as HTMLElement).style.cssText = 'font-size:11px;flex-shrink:0;';
		}
		// Locked → no menu wiring at all; the chip is purely informational.
		if (!interactive) { return; }

		// `position:fixed` (not absolute) so the menu escapes the appointment
		// card's `overflow:hidden` — otherwise the card clips the lower options
		// and the list can't be scrolled to (QA: status dropdown not scrollable).
		// Positioned from the trigger's rect each time it opens / the page scrolls.
		const menu = DOM.append(wrap, DOM.$('div'));
		menu.style.cssText = 'position:fixed;min-width:180px;max-height:280px;overflow-y:auto;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));border:1px solid var(--vscode-menu-border,var(--vscode-editorWidget-border));border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.28);padding:4px;z-index:1000;display:none;';

		// Place the menu under (or above, if there's no room below) the trigger,
		// capping its height to the available viewport space so it stays fully
		// visible and internally scrollable.
		const positionMenu = (): void => {
			const r = trigger.getBoundingClientRect();
			const win = DOM.getActiveWindow();
			const vh = win.innerHeight;
			const spaceBelow = vh - r.bottom - 8;
			const spaceAbove = r.top - 8;
			const useAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
			menu.style.maxHeight = `${Math.max(120, Math.min(280, useAbove ? spaceAbove : spaceBelow))}px`;
			menu.style.left = `${r.left}px`;
			if (useAbove) { menu.style.top = 'auto'; menu.style.bottom = `${vh - r.top + 4}px`; }
			else { menu.style.bottom = 'auto'; menu.style.top = `${r.bottom + 4}px`; }
		};

		const onReposition = (): void => { if (menu.style.display === 'block') { positionMenu(); } };
		const closeMenu = (): void => {
			menu.style.display = 'none';
			const win = DOM.getActiveWindow();
			win.removeEventListener('scroll', onReposition, true);
			win.removeEventListener('resize', onReposition);
		};
		const docClick = (e: Event): void => {
			if (!wrap.contains(e.target as Node) && !menu.contains(e.target as Node)) {
				closeMenu();
				DOM.getActiveWindow().document.removeEventListener('click', docClick);
			}
		};

		let populated = false;
		const populate = async (): Promise<void> => {
			if (populated) { return; }
			populated = true;
			const opts = await this._fetchStatusOptions();
			if (currentStatus && currentStatus !== '—' && !opts.find(o => o.toLowerCase() === currentStatus.toLowerCase())) {
				opts.unshift(currentStatus);
			}
			for (const opt of opts) {
				const isCur = opt.toLowerCase() === currentStatus.toLowerCase();
				const oColor = PatientSnapshotEditor._statusColor(opt);
				const row = DOM.append(menu, DOM.$('div'));
				row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12.5px;color:var(--vscode-menu-foreground,var(--vscode-foreground));${isCur ? 'background:var(--vscode-list-hoverBackground,rgba(128,128,128,0.12));font-weight:700;' : ''}`;
				const dot = DOM.append(row, DOM.$('span'));
				dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${oColor};flex-shrink:0;`;
				const lbl = DOM.append(row, DOM.$('span'));
				lbl.textContent = opt;
				lbl.style.cssText = 'flex:1;';
				if (isCur) {
					const chk = DOM.append(row, DOM.$('span.codicon.codicon-check'));
					(chk as HTMLElement).style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);';
				}
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground,rgba(128,128,128,0.18)))'; });
				row.addEventListener('mouseleave', () => { row.style.background = isCur ? 'var(--vscode-list-hoverBackground,rgba(128,128,128,0.12))' : ''; });
				row.addEventListener('click', (e) => {
					e.stopPropagation();
					closeMenu();
					DOM.getActiveWindow().document.removeEventListener('click', docClick);
					if (!isCur) { void this._applyStatusSelection(apt, appointmentId, opt); }
				});
			}
		};

		trigger.addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!appointmentId) { return; }
			const open = menu.style.display === 'block';
			if (open) {
				closeMenu();
				DOM.getActiveWindow().document.removeEventListener('click', docClick);
			} else {
				await populate();
				menu.style.display = 'block';
				positionMenu();
				const win = DOM.getActiveWindow();
				win.document.addEventListener('click', docClick);
				// Reposition while open so the fixed menu tracks the trigger when the
				// snapshot page scrolls (capture phase catches the inner scroll container).
				win.addEventListener('scroll', onReposition, true);
				win.addEventListener('resize', onReposition);
			}
		});
	}

	/** Read-only resolve of the encounter already linked to an appointment, via the
	 *  authoritative GET /api/appointments/{id}/encounter endpoint. Returns '' when
	 *  none is linked. Used to backfill `apt.encounterId` so the workflow reflects an
	 *  existing link the appointment LIST record didn't carry. */
	private async _resolveAppointmentEncounterId(appointmentId: string): Promise<string> {
		try {
			const res = await this.apiService.fetch(`/api/appointments/${appointmentId}/encounter`);
			if (!res.ok) { return ''; }
			const j = await res.json();
			const p = (j?.data ?? j) as Record<string, unknown>;
			return String(p?.encounterId || p?.id || '').trim();
		} catch { return ''; }
	}

	/** Create a FHIR encounter from the appointment (or reuse the existing one),
	 *  open it, then refresh. Idempotent: the backend's POST
	 *  `/api/appointments/{id}/encounter` creates a NEW encounter on every call
	 *  (no dedupe), so completing an appointment more than once would otherwise
	 *  leave a trail of duplicate encounters. We first check the appointment's own
	 *  `encounterId`, then a read-only GET on the same endpoint ("Encounter
	 *  found"), and only POST to create when neither resolves one. */
	private async _createEncounterFromAppointment(apt: Record<string, unknown>): Promise<void> {
		const id = String(apt.id || apt.appointmentId || '');
		if (!id) { return; }
		try {
			// 1) Reuse an encounter already linked to this appointment.
			let existingId = String(apt.encounterId || '');
			// 2) Otherwise ask the backend (read-only) whether one exists.
			if (!existingId) {
				try {
					const lookup = await this.apiService.fetch(`/api/appointments/${id}/encounter`);
					if (lookup.ok) {
						const lj = await lookup.json();
						const lp = (lj?.data ?? lj) as Record<string, unknown>;
						existingId = String(lp?.encounterId || lp?.id || '');
					}
				} catch { /* fall through to create */ }
			}
			let encounterId = existingId || undefined;
			let created = false;
			if (!encounterId) {
				// 3) None exists yet — create one.
				const res = await this.apiService.fetch(`/api/appointments/${id}/encounter`, { method: 'POST' });
				if (res.ok) {
					try {
						const data = await res.json();
						const payload = (data?.data ?? data) as Record<string, unknown>;
						encounterId = (payload?.id || payload?.encounterId) as string | undefined;
						created = !!encounterId;
						// The endpoint creates the Encounter with no patient subject, so it
						// never appears on the patient chart's Encounters tab. Link it via
						// `patientRef` (FHIR Encounter.subject) so the new encounter is
						// patient-searchable and shows up in the chart. We also stamp the
						// appointment time so the encounter is dated to the visit (not "now").
						const encPatient = String((payload?.encounterPatientId ?? payload?.patientId ?? this._currentPatientId) || '');
						if (encounterId && encPatient) {
							const apptStart = String(apt.start || apt.startTime || apt.scheduledStart || '').trim();
							const link: Record<string, unknown> = { id: encounterId, patientId: encPatient, patientRef: `Patient/${encPatient}` };
							// A fresh encounter is in-progress (the provider still has to
							// document and Sign & Lock it); the appointment itself is what
							// gets marked Completed below.
							const full: Record<string, unknown> = { ...link, status: 'in-progress' };
							if (apptStart) {
								full.encounterDate = apptStart;
								full.startDate = apptStart;
								full.period = { start: apptStart };
							}
							const put = (body: Record<string, unknown>) => this.apiService.fetch(`/api/fhir-resource/encounters/${encounterId}`, {
								method: 'PUT',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify(body),
							});
							const res2 = await put(full).catch(() => null);
							// If the enriched PUT was rejected (e.g. backend status enum
							// validation), still ensure the patient link lands.
							if (!res2 || !res2.ok) { await put(link).catch(() => { /* best-effort link */ }); }
						}
					} catch { /* empty body — fall through to refresh */ }
				}
			}
			// Single-action rule: creating the encounter finalizes the front-desk
			// visit — the appointment is automatically marked Completed (and its
			// status field then locks, see _renderStatusDropdown). This is the only
			// place that creates an encounter from the snapshot, so the appointment
			// can never be "completed without an encounter" or vice-versa.
			const alreadyCompleted = PatientSnapshotEditor._isCompletedStatus(apt.status ?? apt.appointmentStatus);
			if (encounterId && !alreadyCompleted) {
				await this._updateAppointmentStatus(id, 'Completed', apt);
			}
			// Stamp the link locally so the very next render shows the Encounter step
			// done (and unlocks Sign & Lock) even though the appointment LIST index
			// still lags and won't echo `encounterId` for a moment.
			if (encounterId) { this._setApptOverride(id, { encounterId }); }
			// We do NOT navigate into the encounter editor here — completing the
			// visit on the snapshot only creates + links the encounter and refreshes
			// the dashboard so the Encounter status reads "Created". Opening/editing
			// the encounter is done from the Sign & Lock step (or the chart).
			if (encounterId && created) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Encounter created for this appointment. The appointment is now Completed.' });
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
					if (nm) {
						names.add(nm);
						const pid = (p.id || p.providerId || p.practitionerId || p.fhirId || '') as string;
						if (pid) { this._providerIdByName.set(nm, String(pid)); }
					}
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

		const [rooms, providers, statusOpts] = await Promise.all([this._fetchRoomOptions(), this._fetchProviderOptions(), this._fetchStatusOptions()]);

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
				duration: (() => { const d = this._apptDurationMin(apt); return d > 0 ? String(d) : ''; })(),
				appointmentType: currentType === '—' ? '' : currentType,
				status: currentStatus,
				providerName: currentProvider,
				room: currentRoom,
				reason: String(apt.reason || apt.chiefComplaint || apt.reasonForVisit || apt.description || ''),
				notes: String(apt.notes || apt.note || apt.comment || ''),
			},
			onSave: async (next) => {
				const startTime = next.appointmentTime ? `${next.appointmentDate}T${next.appointmentTime}:00` : startIso;
				// The API persists the provider by id/reference, not by display name —
				// resolve the id so a provider CHANGE actually sticks (QA: changed
				// provider not showing).
				const provName = String(next.providerName || '');
				const provId = provName ? (this._providerIdByName.get(provName) || '') : '';
				const payload: Record<string, unknown> = {
					...apt,
					start: startTime,
					startTime,
					duration: next.duration ? Number(next.duration) : apt.duration,
					status: next.status,
					appointmentType: next.appointmentType,
					visitType: next.appointmentType,
					providerName: provName,
					room: next.room,
					reason: next.reason,
					notes: next.notes,
				};
				if (provId) {
					payload.providerId = provId;
					payload.provider = `Practitioner/${provId}`;
					payload.practitionerName = provName;
				} else if (!provName) {
					payload.providerId = '';
					payload.provider = '';
				}
				const res = await this.apiService.fetch(`/api/appointments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				// Overlay the edit so it shows on the rerender even if the search index
				// still serves stale values.
				this._setApptOverride(id, {
					start: startTime, startTime, status: next.status,
					appointmentType: next.appointmentType, visitType: next.appointmentType,
					providerName: provName, practitionerName: provName, providerId: provId,
					room: next.room, reason: next.reason, notes: next.notes,
				});
				// Selecting "Completed" in the status dropdown auto-spins up an
				// encounter (and opens it) when the visit doesn't have one yet —
				// the same integration the Quick Actions "Complete" tile performs.
				const wasCompleted = PatientSnapshotEditor._isCompletedStatus(apt.status || apt.appointmentStatus);
				if (PatientSnapshotEditor._isCompletedStatus(next.status) && !wasCompleted && !this._appointmentHasEncounter(apt)) {
					await this._createEncounterFromAppointment({ ...apt, status: next.status });
					return;
				}
				this._rerender();
			},
		});
	}

	private _renderAppointmentCard(parent: HTMLElement, apt: Record<string, unknown>): void {
		const appointmentId = String(apt.id || apt.appointmentId || this._lastRenderArgs?.appointmentId || '');

		const card = DOM.append(parent, DOM.$('.snap-card.snap-appointment-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:0;grid-column:span 4;overflow:hidden;';

		// Strong, separated header bar — Siva: the title blended into the card.
		const titleBar = DOM.append(card, DOM.$('div'));
		titleBar.style.cssText = 'display:flex;align-items:center;gap:9px;padding:11px 16px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);';
		const tIco = DOM.append(titleBar, DOM.$('span.codicon.codicon-calendar'));
		(tIco as HTMLElement).style.cssText = 'font-size:16px;';
		const tLbl = DOM.append(titleBar, DOM.$('span'));
		// The snapshot can be opened for any of the patient's appointments (not just
		// today's), so only say "TODAY'S" when it really is today.
		tLbl.textContent = this._isToday(apt.start || apt.startTime) ? 'TODAY\'S APPOINTMENT' : 'APPOINTMENT';
		tLbl.style.cssText = 'font-size:13px;font-weight:800;letter-spacing:0.09em;';
		const hasEnc0 = !!(apt.encounterId);
		const encPill = DOM.append(titleBar, DOM.$('span'));
		encPill.style.cssText = `margin-left:auto;display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;background:rgba(255,255,255,0.18);`;
		const epIco = DOM.append(encPill, DOM.$('span.codicon.codicon-' + (hasEnc0 ? 'link' : 'link-external')));
		(epIco as HTMLElement).style.cssText = 'font-size:12px;';
		const epTxt = DOM.append(encPill, DOM.$('span'));
		epTxt.textContent = hasEnc0 ? 'Encounter Created' : 'No Encounter Yet';

		// Body wrapper (header is full-bleed; content keeps its padding).
		const body0 = DOM.append(card, DOM.$('div'));
		body0.style.cssText = 'padding:14px 16px 16px;';
		const cardBody = body0; // alias so the remaining code appends into the padded body

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
				const dur = this._apptDurationMin(apt);
				if (dur > 0) {
					const end = new Date(d.getTime() + dur * 60000);
					endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
				}
			} catch { /* */ }
		}
		const durVal = this._apptDurationMin(apt);
		const reason = String(apt.reason || apt.chiefComplaint || apt.reasonForVisit || apt.description || '').trim();
		const notes = String(apt.notes || apt.note || apt.comment || '').trim();
		const location = this._apptLocationName(apt);
		const room = String(apt.room || apt.roomName || '').trim();
		const provider = String(apt.providerName || apt.practitionerName || '').trim();
		const hasEncounter = !!(apt.encounterId);
		const statusRaw = String(apt.status || apt.appointmentStatus || '').trim();
		const statusStr = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1) : '—';

		const fields: Array<[string, string]> = [
			['Date', dateStr],
			// allow-any-unicode-next-line
			['Time', endStr ? `${timeStr} – ${endStr}` : timeStr],
			['Visit Type', this._apptTypeStr(apt)],
			['Provider', provider || '—'],
			['Status', statusStr],
			['Duration', durVal > 0 ? `${durVal} min` : '—'],
			['Location', location || '—'],
			['Room', room || '— Unassigned —'],
			['Encounter', hasEncounter ? 'Created' : 'Not created'],
		];
		if (reason) { fields.push(['Reason', reason]); }
		if (notes) { fields.push(['Notes', notes]); }

		const detailGrid = DOM.append(cardBody, DOM.$('div'));
		detailGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px;margin:6px 0 12px;';
		for (const [label, value] of fields) {
			const isWide = label === 'Reason' || label === 'Notes';
			const cell = DOM.append(detailGrid, DOM.$('div'));
			cell.style.cssText = isWide ? 'grid-column:1 / -1;min-width:0;' : 'min-width:0;';
			const l = DOM.append(cell, DOM.$('div'));
			l.textContent = label;
			l.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:2px;';
			// Status is an inline editable dropdown — click to pick a new status.
			if (label === 'Status') {
				this._renderStatusDropdown(cell, apt, appointmentId, statusStr);
				continue;
			}
			const v = DOM.append(cell, DOM.$('div'));
			v.textContent = value;
			v.style.cssText = `font-size:12.5px;font-weight:600;color:var(--vscode-editor-foreground);${isWide ? '' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}`;
			if (label === 'Encounter') { v.style.color = hasEncounter ? '#22c55e' : 'var(--vscode-descriptionForeground)'; }
		}

		// NOTE: All forward workflow actions (Check In, Assign Room, Record
		// Vitals, Open Encounter, Complete) live in ONE place — the Quick
		// Actions card below — so staff never hunt across duplicate controls.
		// The appointment card keeps only secondary / correction actions.
		this._renderAppointmentActions(cardBody, apt, appointmentId);
	}

	/** Secondary / correction actions only. The main workflow (Check In →
	 *  Room → Vitals → Encounter → Complete) lives in the Quick Actions card,
	 *  so this bar is intentionally short: Edit, Video, No Show, Cancel. */
	private _renderAppointmentActions(card: HTMLElement, apt: Record<string, unknown>, appointmentId: string): void {
		// A Completed appointment is finalized — hide the status-changing actions
		// (No Show / Cancel) so the status can't be altered after completion (which
		// would otherwise re-trigger encounter creation).
		const status = String(apt.status || apt.appointmentStatus || '').toLowerCase();
		const terminal = new Set(['completed', 'fulfilled', 'cancelled', 'canceled', 'noshow', 'no-show', 'no show']);
		const isTerminal = terminal.has(status);
		const vt = this._apptTypeStr(apt).toLowerCase();
		const isTele = vt.includes('telehealth') || vt.includes('virtual') || vt.includes('video');

		const bar = DOM.append(card, DOM.$('div'));
		bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;padding-top:12px;border-top:1px solid var(--vscode-editorWidget-border);';

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

		// Edit appointment details (date / time / provider / reason …)
		mkBtn('edit', 'Edit Details', () => void this._openApptEdit(apt));
		if (isTele) {
			mkBtn('device-camera-video', 'Video Call', () => void this.commandService.executeCommand('ciyex.openTelehealth', appointmentId, this._currentPatientName, String(apt.providerName || apt.practitionerName || '')));
		}

		// Front-desk / medical-staff side steps. These are NOT part of the strict
		// arrival → payment workflow strip (Scheduled → Completed → … → Payment),
		// but the visit still needs check-in, a room and vitals — so they live here
		// as optional secondary actions, available right up until the visit is
		// completed (after which the appointment is locked).
		if (!isTerminal) {
			const checkedIn = ['checked-in', 'checked in', 'arrived', 'in-room', 'with-provider'].includes(status);
			if (!checkedIn) {
				mkBtn('sign-in', 'Check In', () => void this._changeApptStatus(appointmentId, 'Checked-in', apt));
			}
			mkBtn('home', 'Assign Room', () => void this._openRoomPicker(appointmentId, String(apt.room || apt.roomName || '')));
			mkBtn('pulse', 'Record Vitals', () => this._focusVitalsEntry());
		}

		// Destructive / correction actions — hidden once the appointment is
		// terminal (Completed / Cancelled / No Show) so the status is locked.
		if (!isTerminal) {
			mkBtn('circle-slash', 'No Show', () => void this._changeApptStatus(appointmentId, 'No Show', apt), 'danger');
			mkBtn('trash', 'Cancel', () => void this._changeApptStatus(appointmentId, 'Cancelled', apt), 'danger');
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
		appts: Record<string, unknown>[] = [],
		pipeline?: VisitPipelineState,
	): void {
		const grid = DOM.append(this.root, DOM.$('.snap-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:18px 24px;';

		if (apt) {
			this._renderAppointmentCard(grid, apt);
			// ONE unified workflow strip — the former "Quick Actions" (Check In →
			// Assign Room → Record Vitals → …) and "Visit Pipeline" (… → Encounter →
			// Sign → Fee Sheet → Billing → Payment) were two overlapping step rows;
			// they are now a single end-to-end flow so staff follow one line from
			// arrival to payment.
			this._renderVisitWorkflow(grid, apt, vit, encs, pipeline ?? { encounter: this._todayEncounter(apt, encs), feeSheet: null, statement: statements[0] ?? null, payments });
		}

		// Today's Vitals + Financials pair (recommended layout row 1)
		this._renderTodayVitalsCard(grid, vit);
		this._renderFinancialsCard(grid, payments, statements);

		// Visit History (2) lists the patient's APPOINTMENTS (the visits), while
		// Encounter History (2) lists the clinical encounters — the two were
		// previously the same encounter list, which read as a duplicate. Falls
		// back to today's appointment when the history endpoint returns nothing.
		const visitList = appts.length > 0 ? appts : (apt ? [apt] : []);
		const visitCard = this._renderWideCard(grid, 'history', 'Visit History', 2, visitList.length, undefined);
		this._renderAppointmentHistoryRows(visitCard, visitList);

		const encCard = this._renderWideCard(grid, 'notebook', 'Encounter History', 2, encs.length, undefined);
		this._renderEncounterClinicalRows(encCard, encs);

		// Active Problems (2) + Medications (2)
		const activeProblems = conds.filter(c => {
			const s = String(c.status || c.clinicalStatus || '').toLowerCase();
			return !s || s === 'active';
		});
		this._renderCard(grid, 'problems', 'stethoscope', 'Active Problems', activeProblems, (c) => {
			const name = c.conditionName || c.condition || c.name || c.display || (c.code as Record<string, unknown>)?.text || '—';
			const onset = c.onsetDate || c.onsetDateTime || c.recordedDate || '';
			const yr = onset ? new Date(String(onset)).getFullYear() : '';
			return { primary: String(name), secondary: yr ? String(yr) : '', badge: { text: 'Active', color: '#22c55e' } };
		}, () => this._openCreateModal('problems'), 'problems', 2);

		this._renderCard(grid, 'medications', 'symbol-method', 'Medications', meds, (m) => {
			const name = m.medicationName || m.name || '—';
			const dose = m.dosage || '';
			const freq = m.frequency || '';
			return { primary: String(name), secondary: [dose, freq].filter(Boolean).join(' · ') };
		}, () => this._openCreateModal('medications'), 'medications', 2);

		// Pending Items — unfinished work the doctor must action (full width)
		this._renderPendingItems(grid, labs, encs);

		// Bottom row: Lab Results (full width). Show only actual results — open
		// orders still awaiting results live in "Pending Items" above, so they must
		// not also appear here as value-less "results".
		const labResults = labs.filter(l => PatientSnapshotEditor._isLabResult(l));
		const labCard = this._renderWideCard(grid, 'beaker', 'Lab Results', 4, labResults.length, () => this._openCreateModal('labs'));
		this._renderLabRows(labCard, labResults);
	}

	/** The single, unified visit workflow — one continuous strip from arrival to
	 *  payment. It merges the old "Quick Actions" (Check In → Assign Room → Record
	 *  Vitals) with the revenue-cycle "Visit Pipeline" (Encounter → Sign & Lock →
	 *  Fee Sheet → Billing → Payment) so the front desk and clinical/billing steps
	 *  are one line, not two overlapping rows. Each stage shows done / next / todo /
	 *  locked state and carries a one-click action. */
	private _renderVisitWorkflow(grid: HTMLElement, apt: Record<string, unknown>, vit: Record<string, unknown>[], encs: Record<string, unknown>[], st: VisitPipelineState): void {
		const { stages, currentIdx } = this._buildVisitStages(apt, vit, encs, st);

		const card = DOM.append(grid, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span 4;';
		this._cardHeader(card, 'rocket', 'Visit Workflow', 0, undefined);

		// One-line legend so the colour coding reads at a glance for any role.
		const legend = DOM.append(card, DOM.$('div'));
		legend.textContent = currentIdx >= stages.length
			? 'All steps complete — this visit is fully processed.'
			: `Step ${currentIdx + 1} of ${stages.length}: ${stages[currentIdx].label}. Steps run in order — finish the highlighted one to unlock the next.`;
		legend.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin:2px 0 10px;';

		const row = DOM.append(card, DOM.$('div'));
		row.style.cssText = `display:grid;grid-template-columns:repeat(${stages.length},1fr);gap:7px;margin-top:4px;`;
		stages.forEach((s, i) => {
			// Strictly sequential: everything before the current step is done, the
			// current step is "next" (actionable), everything after is locked. This
			// is what guarantees a later step can never render done before an
			// earlier one, no matter what stray same-day/patient-level data exists.
			const state: 'done' | 'next' | 'locked' = i < currentIdx ? 'done' : i === currentIdx ? 'next' : 'locked';
			// Done steps stay clickable (revisit the module); the current step is
			// clickable when it has an action; locked steps are inert.
			const clickable = state !== 'locked' && !!s.action;
			const tile = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			tile.disabled = !clickable;
			tile.title = state === 'locked' ? `Locked — finish "${stages[currentIdx]?.label ?? ''}" first` : s.action ? `Open ${s.label}` : s.label;
			tile.style.cssText = [
				'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 6px;border-radius:9px;text-align:center;min-height:90px;cursor:' + (clickable ? 'pointer' : 'default') + ';transition:background 0.12s,border-color 0.12s;',
				state === 'done'
					? 'background:rgba(34,197,94,0.10);border:1px solid rgba(34,197,94,0.45);color:#22c55e;'
					: state === 'next'
						? 'background:var(--vscode-button-background,#0e639c);border:1px solid transparent;color:var(--vscode-button-foreground,#fff);box-shadow:0 0 0 2px rgba(59,158,221,0.35);'
						: 'background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.05));border:1px dashed var(--vscode-editorWidget-border);color:var(--vscode-descriptionForeground);opacity:0.55;',
			].join('');
			const glyph = state === 'done' ? 'pass-filled' : state === 'locked' ? 'lock' : s.icon;
			const ico = DOM.append(tile, DOM.$('span.codicon.codicon-' + glyph));
			(ico as HTMLElement).style.cssText = 'font-size:22px;';
			const lbl = DOM.append(tile, DOM.$('div'));
			lbl.textContent = `${i + 1} · ${s.label}`;
			lbl.style.cssText = 'font-size:12px;font-weight:700;';
			const subEl = DOM.append(tile, DOM.$('div'));
			subEl.textContent = state === 'done' ? s.doneSub : s.sub;
			subEl.style.cssText = 'font-size:9.5px;font-weight:600;opacity:0.85;';
			if (clickable) {
				tile.addEventListener('mouseenter', () => { if (state !== 'next') { tile.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.22))'; } });
				tile.addEventListener('mouseleave', () => {
					if (state === 'done') { tile.style.background = 'rgba(34,197,94,0.10)'; }
					else if (state !== 'next') { tile.style.background = 'var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08))'; }
				});
				tile.addEventListener('click', (e) => { e.stopPropagation(); s.action?.(); });
			}
		});
	}

	/** Build the single, strictly-ordered visit workflow — the ONE source of truth
	 *  shared by the top "next action" banner and the Visit Workflow strip so they
	 *  can never disagree. Every step's `done` is derived ONLY from this
	 *  appointment's own state (its status, its linked encounter, that encounter's
	 *  fee sheet / billing / payment) — never from a stray same-day encounter or a
	 *  patient-level statement, which is what previously lit later steps early.
	 *
	 *  `currentIdx` is the first not-done step. Because the strip renders every
	 *  step after `currentIdx` as locked, the workflow always reads top-to-bottom:
	 *  Scheduled → Completed → Encounter → Sign & Lock → Fee Sheet → Billing →
	 *  Payment, exactly the order the clinic works the visit. */
	private _buildVisitStages(apt: Record<string, unknown>, vit: Record<string, unknown>[], encs: Record<string, unknown>[], st: VisitPipelineState): { stages: VisitStage[]; currentIdx: number } {
		const appointmentId = String(apt.id || apt.appointmentId || this._lastRenderArgs?.appointmentId || '');
		const apptStatus = String(apt.status || apt.appointmentStatus || '').toLowerCase();

		// The encounter belongs to this visit ONLY when it is linked to the
		// appointment (apt.encounterId) — set when the visit is marked Completed
		// and the encounter is auto-created. We never fall back to "any same-day
		// encounter": that cross-contamination is exactly what showed Sign & Lock /
		// Fee Sheet as done for a visit that had not reached them.
		const linkedEncId = String(apt.encounterId ?? '').trim();
		const enc = linkedEncId ? (encs.find(e => String(e.id ?? e.fhirId ?? '') === linkedEncId) ?? st.encounter) : null;
		const encId = linkedEncId;
		const encStatus = String(enc?.status ?? '').toLowerCase();
		const encName = enc ? `${enc.type || enc.serviceType || 'Encounter'}`.trim() : 'Encounter';

		const completed = PatientSnapshotEditor._isCompletedStatus(apptStatus);
		const hasEncounter = !!linkedEncId;
		const signed = ['signed', 'finished', 'complete', 'completed', 'locked'].includes(encStatus);
		const vitalsDone = this._todaysVitals(vit).length > 0;
		const hasFeeSheet = !!st.feeSheet;
		// Billing/payment only count once THIS visit has a fee sheet — a stray
		// patient-level statement must not light up the last steps before any
		// charges were captured for the encounter.
		const billed = hasFeeSheet && (!!st.feeSheet?.billed || String(st.feeSheet?.status ?? '').toLowerCase().includes('bill') || !!st.statement);
		const balance = Number(st.statement?.balance ?? st.statement?.outstandingBalance ?? st.statement?.amountDue ?? NaN);
		const paid = billed && ((!Number.isNaN(balance) && balance <= 0) || st.payments.some(p => this._isToday(p.date || p.paidAt || p.createdAt || p.transactionDate)));

		const startRaw = String(apt.start || apt.startTime || '');
		let whenStr = 'Booked';
		if (startRaw) { try { whenStr = new Date(startRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { /* keep default */ } }

		const openEncounter = (mode: 'edit' | 'signoff') => encId
			? () => void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, encId, this._currentPatientName, encName, mode)
			: undefined;
		const openFeeSheet = encId
			? () => void this.commandService.executeCommand('ciyex.openFeeSheet', encId, this._currentPatientId, this._currentPatientName, encName)
			: undefined;

		const stages: VisitStage[] = [
			{
				key: 'scheduled', label: 'Scheduled', role: 'Front desk', icon: 'calendar', done: true,
				sub: whenStr, doneSub: whenStr, action: () => void this._openApptEdit(apt),
			},
			{
				key: 'completed', label: 'Completed', role: 'Front desk', icon: 'check', done: completed,
				sub: 'Mark complete', doneSub: 'Visit complete',
				// Marking Completed auto-creates + links the encounter (single-action
				// rule). Already-completed re-selects are a no-op inside _applyStatusSelection.
				action: completed ? undefined : () => void this._applyStatusSelection(apt, appointmentId, 'Completed'),
			},
			{
				key: 'encounter', label: 'Encounter', role: 'Provider', icon: 'note', done: hasEncounter,
				sub: 'Auto on complete', doneSub: 'Created',
				action: openEncounter('edit'),
			},
			{
				key: 'sign', label: 'Sign & Lock', role: 'Provider', icon: 'pulse', done: signed,
				// Vitals & codes are documented inside the encounter before signing —
				// surface whether vitals are in yet so the provider knows what's left.
				sub: vitalsDone ? 'Vitals in · sign' : 'Vitals, codes & sign', doneSub: 'Signed',
				action: openEncounter('signoff'),
			},
			{
				key: 'feesheet', label: 'Fee Sheet', role: 'Billing', icon: 'list-flat', done: hasFeeSheet,
				sub: 'Add charges', doneSub: 'Charges set', action: openFeeSheet,
			},
			{
				key: 'billing', label: 'Billing', role: 'Billing', icon: 'file-symlink-file', done: billed,
				sub: 'Send to billing', doneSub: 'Billed', action: openFeeSheet,
			},
			{
				key: 'payment', label: 'Payment', role: 'Front desk', icon: 'credit-card', done: paid,
				sub: 'Collect', doneSub: 'Paid', action: () => this._openCreateModal('payment'),
			},
		];
		const firstNotDone = stages.findIndex(s => !s.done);
		const currentIdx = firstNotDone === -1 ? stages.length : firstNotDone;
		return { stages, currentIdx };
	}

	/** One-field room picker — clearer than a buried dropdown for busy front
	 *  desks. Picks a room and assigns it in two clicks. */
	private async _openRoomPicker(appointmentId: string, currentRoom: string): Promise<void> {
		if (!appointmentId) { return; }
		const rooms = await this._fetchRoomOptions();
		const options = [{ value: '', label: '— Select Room —' }, ...rooms.map(r => ({ value: r, label: r }))];
		if (currentRoom && !options.find(o => o.value === currentRoom)) { options.push({ value: currentRoom, label: currentRoom }); }
		openRecordEditDialog({
			title: `Assign Room — ${this._currentPatientName || 'Patient'}`,
			themeAnchor: this.root,
			variant: 'modal',
			fields: [{ key: 'room', label: 'Room', kind: 'select', required: true, widthPct: 100, options }],
			values: { room: currentRoom },
			onSave: async (next) => {
				if (!next.room) { return; }
				await this._updateAppointmentRoom(appointmentId, String(next.room));
				this._rerender();
			},
		});
	}

	/** Scroll to the Today's Vitals card and focus its first inline input, so
	 *  the MA can start typing vitals immediately (no modal). Uses direct
	 *  element references captured at render time (no DOM querying). */
	private _focusVitalsEntry(): void {
		const card = this._vitalsCardEl;
		if (card) {
			card.scrollIntoView({ behavior: 'smooth', block: 'center' });
			card.style.transition = 'box-shadow 0.3s';
			card.style.boxShadow = '0 0 0 2px rgba(59,158,221,0.6)';
			setTimeout(() => { card.style.boxShadow = ''; }, 1400);
		}
		this._revealVitalsEntry?.();
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

			// Encounter History rows are Encounters — edit/delete must target the
			// encounters entity (not visit-notes), so the pencil opens the
			// Encounter edit form (QA issue 7).
			this._renderGridRowActions(table, 'encounters', enc);
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
		cols: number = 1,
	): HTMLElement {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = `background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;display:flex;flex-direction:column;min-height:140px;grid-column:span ${cols};`;

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

		mkBtn('edit', 'Edit', () => void this._openEditModal(entity, item));
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
			void this._openEditModal(entity, item);
		});
	}

	// Vital signs captured by the inline entry form. Keys match the backend
	// FHIR vitals resource exactly (verified against the chart editor's
	// DEFAULT_FIELD_CONFIGS['vitals']). 'bp' is split into systolic/diastolic
	// on save.
	private static readonly _VITAL_INPUTS: Array<{ key: string; label: string; unit: string; step?: string }> = [
		{ key: 'heightCm', label: 'Height', unit: 'cm', step: '0.1' },
		{ key: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1' },
		{ key: 'bpSystolic', label: 'BP Systolic', unit: 'mmHg' },
		{ key: 'bpDiastolic', label: 'BP Diastolic', unit: 'mmHg' },
		{ key: 'pulse', label: 'Pulse', unit: '/min' },
		{ key: 'respiration', label: 'Respiration', unit: '/min' },
		// allow-any-unicode-next-line
		{ key: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1' },
		{ key: 'oxygenSaturation', label: 'SpO2', unit: '%' },
	];

	/** BMI = weight(kg) / height(m)^2. Returns a 1-decimal string, or '' when
	 *  either input is missing/invalid so callers can fall back to a dash. */
	private static _computeBmi(heightCm: unknown, weightKg: unknown): string {
		const h = Number(heightCm);
		const w = Number(weightKg);
		if (!h || !w || h <= 0 || w <= 0) { return ''; }
		const m = h / 100;
		const bmi = w / (m * m);
		if (!isFinite(bmi) || bmi <= 0) { return ''; }
		return bmi.toFixed(1);
	}

	/** Direct references for {@link _focusVitalsEntry} — captured at render
	 *  time so the Quick Action "Record Vitals" can scroll/focus without
	 *  querying the DOM (hygiene forbids querySelector). */
	private _vitalsCardEl: HTMLElement | null = null;
	private _revealVitalsEntry: (() => void) | null = null;

	/** Today's Vitals only — older imported readings are hidden behind a link.
	 *  When none are recorded for today, an INLINE entry form lets the MA type
	 *  values straight in and save (no modal). */
	private _renderTodayVitalsCard(parent: HTMLElement, vit: Record<string, unknown>[]): void {
		const todays = this._todaysVitals(vit);
		const card = DOM.append(parent, DOM.$('.snap-card.snap-vitals-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;min-height:140px;display:flex;flex-direction:column;grid-column:span 2;';
		this._cardHeader(card, 'pulse', 'Today\'s Vitals', todays.length, undefined);
		this._vitalsCardEl = card;

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:320px;';

		const latest = todays[0] as Record<string, unknown> | undefined;
		if (!latest) {
			const msg = DOM.append(body, DOM.$('div'));
			msg.textContent = 'No vitals recorded for today\'s visit — enter below:';
			msg.style.cssText = 'font-size:12.5px;color:var(--vscode-descriptionForeground);font-weight:500;margin-bottom:8px;';
			const firstInput = this._renderInlineVitalsForm(body);
			this._revealVitalsEntry = () => firstInput?.focus();
			this._renderVitalsHistoryLink(body, vit);
			return;
		}

		const bpVal = (latest.bpSystolic && latest.bpDiastolic) ? `${latest.bpSystolic}/${latest.bpDiastolic}` : '';
		const bmiVal = PatientSnapshotEditor._computeBmi(latest.heightCm, latest.weightKg);
		const vitalRows: Array<[string, unknown, string?]> = [
			['Height', latest.heightCm, 'cm'],
			['Weight', latest.weightKg, 'kg'],
			// allow-any-unicode-next-line
			['BMI', bmiVal, bmiVal ? 'kg/m²' : ''],
			['BP', bpVal, 'mmHg'],
			['Pulse', latest.pulse, '/min'],
			['Respiration', latest.respiration, '/min'],
			// allow-any-unicode-next-line
			['Temperature', latest.temperatureC, '°C'],
			['SpO2', latest.oxygenSaturation, '%'],
		];

		const grid2 = DOM.append(body, DOM.$('div'));
		grid2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:4px;';
		for (const [lbl, val, unit] of vitalRows) {
			const cell = DOM.append(grid2, DOM.$('div'));
			cell.style.cssText = 'padding:8px 10px;border-radius:8px;background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.07));border:1px solid var(--vscode-editorWidget-border);';
			const l = DOM.append(cell, DOM.$('div'));
			l.textContent = lbl;
			l.style.cssText = 'font-size:9.5px;color:var(--vscode-descriptionForeground);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;';
			const v = DOM.append(cell, DOM.$('div'));
			v.textContent = val ? `${val}${unit ? ' ' + unit : ''}` : '—';
			v.style.cssText = `font-size:15px;font-weight:800;color:${val ? 'var(--vscode-editor-foreground)' : 'var(--vscode-descriptionForeground)'};margin-top:2px;`;
		}

		// "Edit / new reading" reveals the inline entry form below, PREFILLED with
		// today's latest values so the MA can adjust any vital and save — the read
		// -only grid is no longer a dead end (QA: make today's vitals editable).
		const addToggle = DOM.append(body, DOM.$('button')) as HTMLButtonElement;
		addToggle.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:10px;padding:6px 0;background:transparent;border:none;color:var(--vscode-textLink-foreground,#3b9edd);font-size:12px;font-weight:600;cursor:pointer;';
		DOM.append(addToggle, DOM.$('span.codicon.codicon-edit'));
		const atl = DOM.append(addToggle, DOM.$('span')); atl.textContent = 'Edit';
		const formHolder = DOM.append(body, DOM.$('div'));
		formHolder.style.display = 'none';
		const hideForm = (): void => { formHolder.style.display = 'none'; };
		let formFirstInput: HTMLInputElement | null = null;
		const revealForm = (): void => {
			formHolder.style.display = '';
			// Pass a cancel handler so the revealed editor gets a Close button —
			// previously the form could only be dismissed by re-clicking the
			// toggle, which QA flagged as "no close button" (issue 8).
			if (!formHolder.hasChildNodes()) { formFirstInput = this._renderInlineVitalsForm(formHolder, latest, hideForm); }
			formFirstInput?.focus();
		};
		addToggle.addEventListener('click', (e) => {
			e.stopPropagation();
			if (formHolder.style.display === 'none') { revealForm(); }
			else { hideForm(); }
		});
		this._revealVitalsEntry = revealForm;

		this._renderVitalsHistoryLink(body, vit);
	}

	/** Inline number inputs for the core vital signs + a Save button that POSTs
	 *  a new vitals reading directly — no modal, no leaving the page. Returns
	 *  the first input so callers can focus it. */
	private _renderInlineVitalsForm(container: HTMLElement, initial?: Record<string, unknown>, onCancel?: () => void): HTMLInputElement | null {
		const inputs = new Map<string, HTMLInputElement>();
		let firstInput: HTMLInputElement | null = null;
		const formGrid = DOM.append(container, DOM.$('div'));
		formGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;';
		for (const f of PatientSnapshotEditor._VITAL_INPUTS) {
			const cell = DOM.append(formGrid, DOM.$('div'));
			cell.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
			const l = DOM.append(cell, DOM.$('label'));
			l.textContent = `${f.label} (${f.unit})`;
			l.style.cssText = 'font-size:9.5px;color:var(--vscode-descriptionForeground);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;';
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = 'number';
			if (f.step) { inp.step = f.step; }
			inp.placeholder = '—';
			// Prefill with today's value so the user edits rather than re-keys.
			const seed = initial ? initial[f.key] : undefined;
			if (seed !== undefined && seed !== null && String(seed) !== '') { inp.value = String(seed); }
			inp.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 9px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-editorWidget-border));border-radius:6px;font-size:13px;font-weight:600;outline:none;';
			inputs.set(f.key, inp);
			if (!firstInput) { firstInput = inp; }
		}

		// Live, read-only BMI cell — recomputed from Height & Weight as they change.
		const bmiCell = DOM.append(formGrid, DOM.$('div'));
		bmiCell.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
		const bmiLabel = DOM.append(bmiCell, DOM.$('label'));
		// allow-any-unicode-next-line
		bmiLabel.textContent = 'BMI (kg/m²)';
		bmiLabel.style.cssText = 'font-size:9.5px;color:var(--vscode-descriptionForeground);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;';
		const bmiOut = DOM.append(bmiCell, DOM.$('div'));
		bmiOut.style.cssText = 'box-sizing:border-box;padding:7px 9px;border:1px dashed var(--vscode-input-border,var(--vscode-editorWidget-border));border-radius:6px;font-size:13px;font-weight:700;color:var(--vscode-editor-foreground);opacity:0.85;';
		const refreshBmi = (): void => {
			const bmi = PatientSnapshotEditor._computeBmi(inputs.get('heightCm')?.value, inputs.get('weightKg')?.value);
			// allow-any-unicode-next-line
			bmiOut.textContent = bmi || '—';
		};
		inputs.get('heightCm')?.addEventListener('input', refreshBmi);
		inputs.get('weightKg')?.addEventListener('input', refreshBmi);
		refreshBmi();

		const footer = DOM.append(container, DOM.$('div'));
		footer.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:10px;';
		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 16px;font-size:12.5px;font-weight:700;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:7px;cursor:pointer;';
		DOM.append(saveBtn, DOM.$('span.codicon.codicon-check'));
		const sl = DOM.append(saveBtn, DOM.$('span')); sl.textContent = 'Save Vitals';
		// Close button for the revealed editor (QA issue 8) — only shown when the
		// form is opened as a dismissible editor (the standalone "no vitals yet"
		// entry form passes no onCancel and stays open).
		if (onCancel) {
			const cancelBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
			cancelBtn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 16px;font-size:12.5px;font-weight:600;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:7px;cursor:pointer;';
			DOM.append(cancelBtn, DOM.$('span.codicon.codicon-close'));
			const cl = DOM.append(cancelBtn, DOM.$('span')); cl.textContent = 'Close';
			cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); onCancel(); });
		}
		const note = DOM.append(footer, DOM.$('span'));
		note.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		saveBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			const payload: Record<string, unknown> = {};
			for (const [key, inp] of inputs) {
				const raw = inp.value.trim();
				if (raw !== '') { payload[key] = Number(raw); }
			}
			if (Object.keys(payload).length === 0) { note.textContent = 'Enter at least one value.'; note.style.color = '#ef4444'; return; }
			saveBtn.disabled = true; sl.textContent = 'Saving…'; note.textContent = '';
			try {
				await this._saveInlineVitals(payload);
				this.notificationService.notify({ severity: Severity.Info, message: 'Vitals recorded.' });
				this._rerender();
			} catch (err) {
				note.textContent = err instanceof Error ? err.message : 'Save failed.'; note.style.color = '#ef4444';
				saveBtn.disabled = false; sl.textContent = 'Save Vitals';
			}
		});
		return firstInput;
	}

	/** POST a new vitals reading for the current patient. Mirrors the chart
	 *  editor: injects recordedAt (FhirPathMapper rejects empty) + patientId. */
	private async _saveInlineVitals(payload: Record<string, unknown>): Promise<void> {
		const pid = this._currentPatientId;
		if (!pid) { throw new Error('No patient.'); }
		const body = { ...payload, patientId: pid, recordedAt: new Date().toISOString() };
		const res = await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${pid}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
		let saved: Record<string, unknown> | null = null;
		try {
			const j = await res.json();
			const cand = (j?.data ?? j) as Record<string, unknown> | null;
			if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
		} catch { /* non-JSON body */ }
		this._trackCreated('vitals', { ...body, ...(saved || {}) });
	}

	/** "View historical vitals" link — older readings live in a popup so they
	 *  don't clutter the today's-visit view. */
	private _renderVitalsHistoryLink(body: HTMLElement, vit: Record<string, unknown>[]): void {
		const todaysIds = new Set(this._todaysVitals(vit).map(v => String(v.id ?? v.fhirId ?? '')));
		const history = vit.filter(v => !todaysIds.has(String(v.id ?? v.fhirId ?? '')));
		if (history.length === 0) { return; }
		const link = DOM.append(body, DOM.$('button')) as HTMLButtonElement;
		link.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:12px;padding:6px 0;background:transparent;border:none;color:var(--vscode-textLink-foreground,#3b9edd);font-size:12px;font-weight:600;cursor:pointer;';
		DOM.append(link, DOM.$('span.codicon.codicon-history'));
		const ll = DOM.append(link, DOM.$('span'));
		ll.textContent = `View historical vitals (${history.length})`;
		link.addEventListener('click', (e) => { e.stopPropagation(); this._openManager('vitals', 'list'); });
	}

	/** Financials with action capability — Front Desk collects payment without
	 *  leaving the snapshot. */
	private _renderFinancialsCard(parent: HTMLElement, payments: Record<string, unknown>[], statements: Record<string, unknown>[]): void {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;min-height:140px;display:flex;flex-direction:column;grid-column:span 2;';
		this._cardHeader(card, 'credit-card', 'Financials', payments.length, () => this._openCreateModal('payment'));

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:300px;';

		// Outstanding balance from the latest statement
		const stmt = statements[0] as Record<string, unknown> | undefined;
		const balance = stmt?.balance ?? stmt?.['totalNet.value'] ?? '—';
		const balNum = parseFloat(String(balance));

		const balRow = DOM.append(body, DOM.$('div'));
		balRow.style.cssText = 'margin-top:4px;margin-bottom:10px;';
		const balLabel = DOM.append(balRow, DOM.$('div'));
		balLabel.textContent = 'OUTSTANDING BALANCE';
		balLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);';
		const balVal = DOM.append(balRow, DOM.$('div'));
		balVal.textContent = isNaN(balNum) ? '—' : `$${balNum.toFixed(2)}`;
		balVal.style.cssText = `font-size:26px;font-weight:800;color:${!isNaN(balNum) && balNum > 0 ? '#ef4444' : '#22c55e'};margin-top:2px;`;

		// Action buttons — collect payment / add card / payment history.
		const actions = DOM.append(body, DOM.$('div'));
		actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;';
		const finBtn = (icon: string, label: string, tone: 'primary' | 'default', onClick: () => void): void => {
			const b = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			b.style.cssText = `display:flex;align-items:center;gap:6px;padding:8px 14px;font-size:12px;font-weight:700;border-radius:7px;cursor:pointer;white-space:nowrap;${tone === 'primary' ? 'background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:1px solid transparent;' : 'background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08));color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);'}`;
			DOM.append(b, DOM.$('span.codicon.codicon-' + icon));
			const l = DOM.append(b, DOM.$('span')); l.textContent = label;
			b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
		};
		finBtn('credit-card', 'Collect Payment', 'primary', () => this._openCreateModal('payment'));
		// "Pay Now (Card)" is the ONLY UI path that exercises the real payment
		// gateway: it hands the patient balance to the active gateway extension
		// (ciyex-payment-stripe / ciyex-payment-paypal) via
		// `ciyex.patientPay.collectPayment`, which mints an intent and opens the
		// gateway's CSP-locked checkout webview. "Collect Payment" above only
		// records a manual transaction. If no gateway extension is installed the
		// command notifies the user to install one from the Extensions view.
		const payInvoiceId = String(stmt?.invoiceId ?? stmt?.id ?? '');
		finBtn('zap', 'Pay Now (Card)', 'default', () => {
			void this.commandService.executeCommand('ciyex.patientPay.collectPayment', payInvoiceId ? { invoiceId: payInvoiceId } : undefined);
		});
		finBtn('add', 'Add Credit Card', 'default', () => this._openAddCardForm());
		finBtn('history', 'Payment History', 'default', () => this._openManager('payment', 'list'));

		// Cards on file — after a card is added it shows here card-wise (mirrors
		// the chart editor's payment page). Loaded async into its own holder so
		// the rest of the financials card paints immediately.
		const cardsHolder = DOM.append(body, DOM.$('div'));
		void this._renderCardsOnFile(cardsHolder);

		if (payments.length > 0) {
			const histLabel = DOM.append(body, DOM.$('div'));
			histLabel.textContent = 'RECENT PAYMENTS';
			histLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-top:2px;margin-bottom:4px;border-top:1px solid var(--vscode-editorWidget-border);padding-top:8px;';
			const { page, pageIdx, pageCount, total } = this._paginate('payments', payments);
			for (const pay of page) {
				const dateRaw = (pay.collectedAt || pay.paymentDate || pay.date || pay.transactionDate || pay.created || '') as string;
				const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
				const amt = pay.amount || pay.totalAmount || '';
				// Title-case helper so type/status read the same way as the Payment
				// History modal columns (e.g. "payment" → "Payment").
				const titleCase = (v: unknown): string => { const s = String(v ?? '').trim(); return s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''; };
				// Method is resolved through the SAME helper as the Payment History
				// modal so a single transaction never shows two different methods
				// (was "debit card" here vs "other" there).
				const method = formatPaymentMethod(pay);
				const type = titleCase(pay.transactionType ?? pay.paymentType);
				const status = titleCase(pay.status);
				const r = DOM.append(body, DOM.$('div'));
				r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
				const left = DOM.append(r, DOM.$('div'));
				const dateEl = DOM.append(left, DOM.$('div'));
				dateEl.textContent = dateStr;
				dateEl.style.cssText = 'font-size:12px;color:var(--vscode-editor-foreground);font-weight:500;';
				// Full details line: type · method · status (omitting blanks).
				const detailParts = [type, method && method !== '—' ? method : '', status].filter(Boolean);
				if (detailParts.length > 0) {
					const methEl = DOM.append(left, DOM.$('div'));
					methEl.textContent = detailParts.join(' · ');
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

	/** Add a credit card on file — uses the SAME fields and endpoint as the
	 *  workspace's card-on-file form (POST /api/credit-cards): cardholder, card
	 *  number, type, expiry, CVV, billing. This is the correct card-capture
	 *  form (distinct from recording a payment transaction). */
	private _openAddCardForm(): void {
		const now = new Date();
		const months = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1).padStart(2, '0') }));
		const years = Array.from({ length: 16 }, (_, i) => ({ value: String(now.getFullYear() + i), label: String(now.getFullYear() + i) }));
		openRecordEditDialog({
			title: `Add Payment Method — ${this._currentPatientName || 'Patient'}`,
			themeAnchor: this.root,
			variant: 'modal',
			fields: [
				{ key: 'cardHolderName', label: 'Card Holder Name', kind: 'text', required: true, placeholder: 'John Doe', widthPct: 100 },
				{ key: 'cardNumber', label: 'Card Number', kind: 'text', required: true, placeholder: '1234567890123456', widthPct: 100 },
				{
					key: 'cardType', label: 'Card Type', kind: 'select', widthPct: 50, options: [
						{ value: 'VISA', label: 'Visa' }, { value: 'MASTERCARD', label: 'Mastercard' },
						{ value: 'AMEX', label: 'Amex' }, { value: 'DISCOVER', label: 'Discover' },
					]
				},
				{ key: 'cvv', label: 'CVV', kind: 'text', required: true, placeholder: '123', widthPct: 50 },
				{ key: 'expiryMonth', label: 'Expiry Month', kind: 'select', required: true, widthPct: 50, options: months },
				{ key: 'expiryYear', label: 'Expiry Year', kind: 'select', required: true, widthPct: 50, options: years },
				{ key: 'billingAddress', label: 'Billing Address', kind: 'text', placeholder: '123 Main St', widthPct: 100 },
				{ key: 'billingCity', label: 'City', kind: 'text', widthPct: 50 },
				{ key: 'billingState', label: 'State', kind: 'text', widthPct: 50 },
				{ key: 'billingZip', label: 'Zip Code', kind: 'text', widthPct: 50 },
				{ key: 'billingCountry', label: 'Country', kind: 'text', widthPct: 50 },
				{ key: 'isDefault', label: 'Set as default', kind: 'select', widthPct: 100, options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
			],
			values: {
				cardType: 'VISA',
				expiryMonth: String(now.getMonth() + 1),
				expiryYear: String(now.getFullYear()),
				billingCountry: 'USA',
				isDefault: 'false',
			},
			onSave: async (next) => {
				// Card-on-file is tied to a patient: the backend CreditCard entity
				// requires a non-null patientId (FK). Omitting it 500s — mirror the
				// chart editor's payload, which always sends patientId.
				if (!this._currentPatientId) { throw new Error('No patient selected.'); }
				const num = String(next.cardNumber || '').replace(/\D/g, '');
				const cvv = String(next.cvv || '').replace(/\D/g, '');
				if (!String(next.cardHolderName || '').trim()) { throw new Error('Card holder name is required.'); }
				if (!num) { throw new Error('Card number is required.'); }
				if (!cvv) { throw new Error('CVV is required.'); }
				// Match the backend CreditCardDto constraints so a malformed card
				// fails here with a clear message instead of an opaque 400. The
				// inline form only checked presence, so a short/long number or a
				// 1-2 digit CVV reached the server and bounced as "Save failed".
				if (!/^\d{13,16}$/.test(num)) { throw new Error('Card number must be 13-16 digits.'); }
				if (!/^\d{3,4}$/.test(cvv)) { throw new Error('CVV must be 3 or 4 digits.'); }
				const payload: Record<string, unknown> = {
					patientId: this._currentPatientId,
					cardHolderName: String(next.cardHolderName).trim(),
					cardNumber: num,
					cvv,
					cardType: next.cardType || 'VISA',
					expiryMonth: Number(next.expiryMonth),
					expiryYear: Number(next.expiryYear),
					billingAddress: String(next.billingAddress || '').trim() || undefined,
					billingCity: String(next.billingCity || '').trim() || undefined,
					billingState: String(next.billingState || '').trim() || undefined,
					billingZip: String(next.billingZip || '').trim() || undefined,
					billingCountry: String(next.billingCountry || '').trim() || 'USA',
					isDefault: next.isDefault === 'true',
					isActive: true,
				};
				const res = await this.apiService.fetch('/api/credit-cards', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (!res.ok) {
					// Surface the backend's real reason instead of a bare status.
					// CreditCardController returns { message, data: { field: msg } }
					// for @Valid failures and { message } for IllegalArgumentException.
					let msg = `Save failed (${res.status})`;
					try {
						const err = await res.json() as { message?: string; data?: Record<string, string> };
						const fieldErrs = err?.data && typeof err.data === 'object' ? Object.values(err.data).filter(Boolean) : [];
						if (fieldErrs.length) { msg = fieldErrs.join(' '); }
						else if (err?.message) { msg = err.message; }
					} catch { /* non-JSON body — keep the generic status message */ }
					throw new Error(msg);
				}
				this.notificationService.notify({ severity: Severity.Info, message: 'Card on file saved.' });
				// Refresh so the new card shows up in the "Cards on File" list
				// immediately (mirrors the chart editor's payment page).
				this._rerender();
			},
		});
	}

	/** Short card-type badge (VISA / MC / AMEX / DISC) — mirrors the chart
	 *  editor's `_cardTypeBadge`. */
	private _cardTypeBadge(type: string): string {
		const t = (type || '').toUpperCase();
		if (t.includes('VISA')) { return 'VISA'; }
		if (t.includes('MASTER')) { return 'MC'; }
		if (t.includes('AMEX') || t.includes('AMERICAN')) { return 'AMEX'; }
		if (t.includes('DISCOVER')) { return 'DISC'; }
		return t.slice(0, 4) || '????';
	}

	/** True when a card-on-file is past its expiry (matches the chart editor). */
	private _isCardExpired(card: Record<string, unknown>): boolean {
		if (card['isExpired']) { return true; }
		const now = new Date();
		const m = Number(card['expiryMonth'] ?? 0);
		const y = Number(card['expiryYear'] ?? 0);
		return y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1);
	}

	/**
	 * Render the patient's saved cards card-wise under the Financials actions.
	 * Loads from the SAME endpoint the chart editor's payment page uses
	 * (`/api/credit-cards/patient/{id}`) and supports Set Default / Delete so a
	 * just-added card is immediately visible and manageable — the gap QA hit
	 * where "added card is not visible like the chart editor's payment page".
	 */
	private async _renderCardsOnFile(holder: HTMLElement): Promise<void> {
		const pid = this._currentPatientId;
		if (!pid) { return; }
		let cards: Array<Record<string, unknown>> = [];
		try {
			const res = await this.apiService.fetch(`/api/credit-cards/patient/${pid}?page=0&size=200`);
			if (res.ok) {
				const data = await res.json();
				cards = (data?.data?.content || data?.data || data?.content || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
			}
		} catch { /* no cards / endpoint unavailable */ }
		if (this._currentPatientId !== pid) { return; }
		DOM.clearNode(holder);
		if (!Array.isArray(cards) || cards.length === 0) { return; }

		const label = DOM.append(holder, DOM.$('div'));
		label.textContent = `CARDS ON FILE (${cards.length})`;
		label.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-top:2px;margin-bottom:6px;border-top:1px solid var(--vscode-editorWidget-border);padding-top:8px;';

		const grid = DOM.append(holder, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:10px;';

		for (const card of cards) {
			const expired = this._isCardExpired(card);
			const inactive = card['isActive'] === false;
			const isDefault = !!card['isDefault'];
			let border: string; let bg: string; let opacity = '1';
			if (expired) { border = '#fca5a5'; bg = 'rgba(254,202,202,0.10)'; }
			else if (inactive) { border = 'var(--vscode-editorWidget-border)'; bg = 'rgba(128,128,128,0.06)'; opacity = '0.6'; }
			else if (isDefault) { border = '#3b82f6'; bg = 'rgba(59,130,246,0.08)'; }
			else { border = 'var(--vscode-editorWidget-border)'; bg = 'var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.05))'; }

			const cardEl = DOM.append(grid, DOM.$('div'));
			cardEl.style.cssText = `border:1.5px solid ${border};border-radius:9px;padding:10px 12px;background:${bg};opacity:${opacity};display:flex;flex-direction:column;gap:5px;`;

			const hdr = DOM.append(cardEl, DOM.$('div'));
			hdr.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
			// allow-any-unicode-next-line
			const icon = DOM.append(hdr, DOM.$('span')); icon.textContent = '💳'; icon.style.cssText = 'font-size:15px;line-height:1;';
			const typeBadge = DOM.append(hdr, DOM.$('span'));
			typeBadge.textContent = this._cardTypeBadge(String(card['cardType'] || ''));
			typeBadge.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.5px;padding:2px 5px;border-radius:4px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff);';
			if (isDefault) {
				const db = DOM.append(hdr, DOM.$('span'));
				db.textContent = 'Default';
				db.style.cssText = 'font-size:9px;font-weight:600;padding:2px 5px;border-radius:4px;background:rgba(59,130,246,0.15);color:#3b82f6;margin-left:auto;';
			} else if (inactive) {
				const ib = DOM.append(hdr, DOM.$('span'));
				ib.textContent = 'Inactive';
				ib.style.cssText = 'font-size:9px;padding:2px 5px;border-radius:4px;background:rgba(128,128,128,0.15);color:var(--vscode-descriptionForeground);margin-left:auto;';
			}

			const numEl = DOM.append(cardEl, DOM.$('div'));
			numEl.textContent = String(card['maskedCardNumber'] || '•••• •••• •••• ****');
			numEl.style.cssText = 'font-size:12px;font-weight:600;letter-spacing:1.5px;color:var(--vscode-foreground);font-family:monospace;';

			const holderEl = DOM.append(cardEl, DOM.$('div'));
			holderEl.textContent = String(card['cardHolderName'] || '');
			holderEl.style.cssText = 'font-size:11px;color:var(--vscode-foreground);';

			const mm = String(card['expiryMonth'] || 1).padStart(2, '0');
			const yy = String(card['expiryYear'] || new Date().getFullYear());
			const expRow = DOM.append(cardEl, DOM.$('div'));
			expRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--vscode-descriptionForeground);';
			expRow.textContent = `Expires ${mm}/${yy}`;
			if (expired) {
				const et = DOM.append(expRow, DOM.$('span'));
				et.textContent = 'EXPIRED';
				et.style.cssText = 'font-size:8px;font-weight:700;padding:1px 4px;border-radius:3px;background:rgba(239,68,68,0.15);color:#ef4444;letter-spacing:0.5px;';
			}

			const acts = DOM.append(cardEl, DOM.$('div'));
			acts.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:2px;flex-wrap:wrap;';
			if (!isDefault && !inactive) {
				const defBtn = DOM.append(acts, DOM.$('button')) as HTMLButtonElement;
				defBtn.textContent = 'Set Default';
				defBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;color:#3b82f6;padding:0;font-weight:500;';
				defBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					try {
						await this.apiService.fetch(`/api/credit-cards/${card['id']}/patient/${pid}/set-default`, { method: 'PUT' });
						this._rerender();
					} catch { /* ignore */ }
				});
			}
			const delBtn = DOM.append(acts, DOM.$('button')) as HTMLButtonElement;
			delBtn.textContent = 'Delete';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;color:#ef4444;padding:0;margin-left:auto;';
			delBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const confirm = await this.dialogService.confirm({ message: 'Delete this payment method?', type: 'warning', primaryButton: 'Delete' });
				if (!confirm.confirmed) { return; }
				try {
					await this.apiService.fetch(`/api/credit-cards/${card['id']}`, { method: 'DELETE' });
					this._rerender();
				} catch { /* ignore */ }
			});
		}
	}

	/** Pending Items — unfinished clinical work the provider must action. The
	 *  doctor needs this at a glance (Siva: "Doctor needs visibility of
	 *  unfinished work"). Each item is derived from real record state. */
	private _renderPendingItems(grid: HTMLElement, labs: Record<string, unknown>[], encs: Record<string, unknown>[]): void {
		const pendingLabs = labs.filter(l => PatientSnapshotEditor._isLabOrderPending(String(l.status || '')));
		const openEncounters = encs.filter(e => {
			const s = String(e.status || '').toLowerCase();
			return s.includes('progress') || s.includes('unsign') || s === 'arrived' || s === 'planned';
		});

		const items: Array<{ icon: string; label: string; detail: string; color: string; onClick: () => void }> = [];
		if (pendingLabs.length > 0) {
			items.push({ icon: 'beaker', label: 'Lab Results Pending', detail: `${pendingLabs.length} test${pendingLabs.length > 1 ? 's' : ''} awaiting results`, color: '#f59e0b', onClick: () => this._openManager('labs', 'list') });
		}
		if (openEncounters.length > 0) {
			items.push({ icon: 'note', label: 'Encounter Unsigned', detail: `${openEncounters.length} open encounter${openEncounters.length > 1 ? 's' : ''} to finalize`, color: '#3b9edd', onClick: () => this._openManager('encounters', 'list') });
		}
		// NOTE: no "create encounter" pending tile — encounters are created
		// automatically when the visit is marked Completed, never by a manual click.
		// Treatment plan visibility — always offer a quick entry point.
		items.push({ icon: 'checklist', label: 'Treatment Plan', detail: 'Review or update the care plan', color: '#a78bfa', onClick: () => this._openManager('visit-notes', 'list') });

		const card = DOM.append(grid, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span 4;';
		this._cardHeader(card, 'tasklist', 'Pending Items', items.length, undefined);

		const rowWrap = DOM.append(card, DOM.$('div'));
		rowWrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:4px;';
		for (const it of items) {
			const tile = DOM.append(rowWrap, DOM.$('button')) as HTMLButtonElement;
			tile.style.cssText = `display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:9px;cursor:pointer;text-align:left;background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.06));border:1px solid var(--vscode-editorWidget-border);border-left:3px solid ${it.color};`;
			const ico = DOM.append(tile, DOM.$('span.codicon.codicon-' + it.icon));
			(ico as HTMLElement).style.cssText = `font-size:20px;color:${it.color};flex-shrink:0;`;
			const txt = DOM.append(tile, DOM.$('div'));
			txt.style.cssText = 'min-width:0;';
			const lbl = DOM.append(txt, DOM.$('div'));
			lbl.textContent = it.label;
			lbl.style.cssText = 'font-size:13px;font-weight:700;color:var(--vscode-editor-foreground);';
			const det = DOM.append(txt, DOM.$('div'));
			det.textContent = it.detail;
			det.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			tile.addEventListener('mouseenter', () => { tile.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; });
			tile.addEventListener('mouseleave', () => { tile.style.background = 'var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.06))'; });
			tile.addEventListener('click', (e) => { e.stopPropagation(); it.onClick(); });
		}
	}

	private _renderWideCard(parent: HTMLElement, icon: string, title: string, cols: number, count: number, onAdd?: () => void): HTMLElement {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = `background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span ${cols};`;
		this._cardHeader(card, icon, title, count, onAdd);
		return card;
	}

	/** Visit History rows — the patient's APPOINTMENTS (not encounters). Each row
	 *  shows the visit date, type/provider, location and appointment status, plus
	 *  whether an encounter is linked. The action opens that visit's encounter when
	 *  one exists, otherwise re-opens the snapshot focused on that appointment. */
	private _renderAppointmentHistoryRows(card: HTMLElement, appts: Record<string, unknown>[]): void {
		if (appts.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No visits found';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		// Most-recent visit first.
		const sorted = [...appts].sort((a, b) => {
			const da = new Date(String(a.start || a.startTime || a.appointmentStartDate || 0)).getTime();
			const db = new Date(String(b.start || b.startTime || b.appointmentStartDate || 0)).getTime();
			return db - da;
		});
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		table.style.cssText = 'display:grid;grid-template-columns:120px 1fr 140px 90px 78px 56px;gap:0;';
		for (const lbl of ['Date', 'Type / Provider', 'Location', 'Status', 'Encounter', '']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		const { page, pageIdx, pageCount, total } = this._paginate('appointments', sorted);
		for (const a of page) {
			const dateRaw = a.start || a.startTime || a.appointmentStartDate || a.date || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const type = this._apptTypeStr(a);
			const prov = String(a.providerName || a.practitionerName || a.providerDisplay || '').trim();
			const loc = this._apptLocationName(a) || '—';
			const statusRaw = String(a.status || a.appointmentStatus || '').trim();
			const status = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1) : 'Unknown';
			const sColor = PatientSnapshotEditor._statusColor(status);
			const encId = String(a.encounterId || '');
			const cells: Array<{ txt: string; kind?: 'status' | 'enc' }> = [
				{ txt: dateStr },
				{ txt: prov ? `${type} · ${prov}` : type },
				{ txt: String(loc) },
				{ txt: status, kind: 'status' },
				{ txt: encId ? 'Linked' : '—', kind: 'enc' },
			];
			for (const { txt, kind } of cells) {
				const cell = DOM.append(table, DOM.$('div'));
				cell.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:8px;';
				if (kind === 'status') {
					const b = DOM.append(cell, DOM.$('span'));
					b.textContent = txt;
					b.style.cssText = `font-size:10px;padding:2px 6px;border-radius:8px;background:${sColor}20;color:${sColor};font-weight:700;`;
				} else if (kind === 'enc') {
					cell.textContent = txt;
					cell.style.color = encId ? '#22c55e' : 'var(--vscode-descriptionForeground)';
				} else {
					cell.textContent = txt;
				}
			}
			// Trailing action: open the linked encounter, else open this visit.
			const actCell = DOM.append(table, DOM.$('div'));
			actCell.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;justify-content:flex-end;';
			const btn = DOM.append(actCell, DOM.$('button')) as HTMLButtonElement;
			btn.title = encId ? 'Open encounter' : 'Open visit';
			btn.style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;color:var(--vscode-foreground);padding:0;';
			const ico = DOM.append(btn, DOM.$('span.codicon.codicon-' + (encId ? 'go-to-file' : 'eye')));
			(ico as HTMLElement).style.cssText = 'font-size:12px;';
			btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; btn.style.borderColor = 'var(--vscode-editorWidget-border)'; });
			btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.borderColor = 'transparent'; });
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (encId) {
					void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, encId, this._currentPatientName);
				} else {
					void this.commandService.executeCommand('ciyex.openPatientSnapshot', this._currentPatientId, this._currentPatientName, String(a.id || a.appointmentId || ''));
				}
			});
		}
		this._renderPagerFooter(card, 'appointments', pageIdx, pageCount, total);
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

		mkBtn('edit', 'Edit', () => void this._openEditModal(entity, item));
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

	/** Populate {@link _locationNames} from `/api/locations` once per editor so
	 *  location references can be resolved to names. Best-effort: a failed fetch
	 *  leaves the map empty and the raw reference is shown as a fallback. */
	private async _ensureLocationNames(): Promise<void> {
		if (this._locationNames.size > 0) { return; }
		const res = await this._fetch('/api/locations');
		if (!res) { return; }
		const inner = (res.data ?? res) as Record<string, unknown>;
		const list = (inner?.content || inner?.list || inner?.items || (Array.isArray(inner) ? inner : Array.isArray(res) ? res : [])) as Array<Record<string, unknown>>;
		if (!Array.isArray(list)) { return; }
		for (const l of list) {
			const id = String(l.id ?? l.locationId ?? l.fhirId ?? '');
			const name = String(l.name ?? l.locationName ?? l.label ?? l.displayName ?? '');
			if (id && name) { this._locationNames.set(id, name); }
		}
	}

	/** Extract a display location from an appointment, tolerating every shape the
	 *  appointments API returns: a flat locationName/locationDisplay, a numeric
	 *  locationId, a FHIR "Location/{id}" reference (location / locationReference),
	 *  or the location embedded as a participant actor. A freshly-created
	 *  appointment comes back with locationId/locationReference (not `location`),
	 *  which the card previously ignored — so the Location field showed "—". */
	private _apptLocationName(apt: Record<string, unknown>): string {
		// An already-resolved display name wins (|| so empty strings fall through).
		const direct = apt.locationName || apt.locationDisplay;
		if (direct) { return this._resolveLocationName(direct); }
		// Otherwise resolve whichever id / reference shape is present.
		const ref = apt.location || apt.locationReference || apt.locationId || apt.facility;
		const resolved = this._resolveLocationName(ref);
		if (resolved) { return resolved; }
		// FHIR appointments embed the location as a participant actor.
		const participants = Array.isArray(apt.participant) ? apt.participant as Array<Record<string, unknown>> : [];
		for (const p of participants) {
			const actor = p?.actor;
			const actorRef = typeof actor === 'string' ? actor : (actor as Record<string, unknown> | undefined)?.reference;
			if (typeof actorRef === 'string' && actorRef.startsWith('Location/')) {
				return this._resolveLocationName(actorRef);
			}
		}
		return '';
	}

	/** Resolve a raw location value (e.g. "Location/13890", "13890", or an
	 *  already-resolved name) to a display name. Returns '' when nothing usable
	 *  is available so callers can fall back to their own placeholder. */
	private _resolveLocationName(raw: unknown): string {
		const s = String(raw ?? '').trim();
		if (!s) { return ''; }
		// FHIR reference shape "Location/{id}" or bare id → look up the name.
		const refMatch = s.match(/^(?:Location\/)?([0-9a-fA-F-]+)$/);
		if (refMatch) {
			const id = refMatch[1];
			const name = this._locationNames.get(id);
			if (name) { return name; }
			// Pure "Location/{id}" with no match → strip the prefix so we at
			// least show the bare id rather than the FHIR reference noise.
			return s.startsWith('Location/') ? id : s;
		}
		// Anything else is already a human-readable name.
		return s;
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


