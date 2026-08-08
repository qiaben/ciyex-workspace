/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { SH_SMOKING_OPTIONS, SH_ALCOHOL_OPTIONS, SH_EXERCISE_OPTIONS, SH_DRUGS_OPTIONS } from './socialHistoryOptions.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IEditorOpenContext, EditorsOrder } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { PatientSnapshotEditorInput, PatientChartEditorInput, EncounterFormEditorInput } from './ciyexEditorInput.js';
import { ICiyexApiService, IClinicalRecordMutation } from '../ciyexApiService.js';
import { IEditorService, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { expandEncounterType, showVisitSummaryPanel } from './visitSummaryPanel.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { IEditFieldDef, IListColumn, openListAndFormDialog, openRecordEditDialog, withTypeaheadSearch, formFieldsToEditFields } from '../sidebarActions.js';
import { DEFAULT_FIELD_CONFIGS, FieldConfig, FieldDef } from './patientChartEditor.js';
import { LAB_ORDER_FORM_FIELDS, LAB_RESULT_FORM_FIELDS } from './clinicalEditors.js';
import { ADDRESS_LABELS, ADDRESS_PLACEHOLDERS } from '../addressFields.js';
import { ICiyexInstallationsService } from '../ciyexInstallationsService.js';
import { RCM_APP_SLUG } from '../rcm/rcmApiService.js';

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
	// Cached answer to "does the backend mint the encounter on the Completed
	// status transition?" — see _completedStatusMintsEncounter.
	private _completedMintsEncounter: Promise<boolean> | undefined;
	// id → display name for Locations, so appointment / encounter rows can show
	// the location NAME instead of the raw "Location/{id}" reference (QA 4 & 5).
	private readonly _locationNames = new Map<string, string>();
	private readonly _pageState = new Map<string, number>();
	/** IDs of records the user just deleted on this patient. Filtered out of
	 *  every list render until a fresh fetch confirms the server has removed
	 *  them — covers HAPI's eventual-consistency search index lag. Keyed by
	 *  `{patientId}::{entity}` so an overlay never leaks across patients (the
	 *  editor pane instance is reused for every snapshot tab). */
	private readonly _deletedIds = new Map<string, Set<string>>();
	/** Records created in this session that the server's search index may not
	 *  have surfaced yet. Merged into every list render until a subsequent
	 *  fetch returns the same id, mirroring the chart editor's _pendingCreates.
	 *  Keyed by `{patientId}::{entity}` — without the patient scope a vital (or
	 *  any record) saved for one patient was overlaid onto every other patient's
	 *  list when the same pane was reused for their snapshot. */
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
	/** Vitals loaded on the last render — consulted by the strict-order guard
	 *  ({@link _missingPrepSteps}) when the user tries to jump the appointment
	 *  status straight to Completed. */
	private _lastLoadedVitals: Array<Record<string, unknown>> = [];
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
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ICiyexInstallationsService private readonly installationsService: ICiyexInstallationsService,
	) {
		super(PatientSnapshotEditor.ID, group, telemetryService, themeService, storageService);
		// Records saved in a sibling editor (the Patient Chart drawer) are
		// overlaid here right away — the snapshot's own refetch can still hit
		// the stale FHIR search index for seconds after the save (QA: problem
		// created in the chart missing from the snapshot's Active Problems).
		this._register(this.apiService.onDidMutateClinicalRecord(m => this._onExternalMutation(m)));
	}

	/** Chart tab keys whose records the snapshot dashboard also renders, mapped
	 *  to the snapshot's own entity keys. */
	private static readonly _EXTERNAL_ENTITY_MAP: Record<string, string> = {
		'problems': 'problems',
		'medications': 'medications',
		'vitals': 'vitals',
	};

	private _onExternalMutation(m: IClinicalRecordMutation): void {
		const entity = PatientSnapshotEditor._EXTERNAL_ENTITY_MAP[m.entity];
		if (!entity || !this._currentPatientId) { return; }
		const pid = String(m.patientId || m.record.patientId || '');
		if (pid !== this._currentPatientId && String(m.record.patientId ?? '') !== this._currentPatientId) { return; }
		this._trackCreated(entity, m.record);
		if (this.isVisible()) { this._rerender(); }
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
			// The records table shows EVERY charted measurement, not just a
			// BP/HR/Temp/O2 excerpt (QA: "incomplete view" — Weight / Height /
			// BMI / Respiration / Notes were recorded but invisible). The list
			// dialog scrolls horizontally when the columns outgrow the sheet.
			columns: [
				{ key: 'recordedAt', label: 'Recorded', width: '104px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
				{ key: 'weightKg', label: 'Wt (kg)', width: '64px' },
				{ key: 'heightCm', label: 'Ht (cm)', width: '64px' },
				{
					key: 'bmi', label: 'BMI', width: '56px', format: (v, r) => {
						if (v !== undefined && v !== null && String(v).trim() !== '') { return String(v); }
						const w = parseFloat(String(r.weightKg ?? ''));
						const h = parseFloat(String(r.heightCm ?? ''));
						return (!isNaN(w) && !isNaN(h) && h > 0) ? (w / ((h / 100) * (h / 100))).toFixed(1) : '—';
					}
				},
				{ key: 'bpSystolic', label: 'BP', width: '76px', format: (_v, r) => (r.bpSystolic && r.bpDiastolic) ? `${r.bpSystolic}/${r.bpDiastolic}` : '—' },
				{ key: 'pulse', label: 'Pulse', width: '58px' },
				{ key: 'respiration', label: 'Resp', width: '56px' },
				{ key: 'temperatureC', label: 'Temp', width: '56px' },
				{ key: 'oxygenSaturation', label: 'O2 %', width: '56px' },
				{ key: 'notes', label: 'Notes', width: 'minmax(110px,1fr)' },
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
		// Lab Orders and Lab Results both write to the CLINICAL stores
		// (/api/lab-order/{patientId} and /api/lab-results) — the very same
		// endpoints the clinical Labs page uses — so an order/result created on
		// the snapshot shows up on the clinical Labs page (and the patient chart),
		// and vice-versa. `nonFhir` keeps the generic delete/save off the FHIR
		// "/patient/" URL shape; lab-specific URLs are built in `_saveUrl`,
		// `_deleteItem` and `_loadEntityList`.
		labOrders: {
			title: 'Lab Orders', configKey: 'labs', basePath: '/api/lab-order', fhirPatientScoped: false, nonFhir: true,
			columns: [
				{ key: 'orderNumber', label: 'Order #', width: '120px' },
				{ key: 'testDisplay', label: 'Test', width: '2fr', format: (_v, r) => String(r.testDisplay || r.testName || r.orderName || '—') },
				{ key: 'physicianName', label: 'Provider', width: '120px' },
				{ key: 'priority', label: 'Priority', width: '90px' },
				{ key: 'status', label: 'Status', width: '100px' },
				{ key: 'orderDate', label: 'Date', width: '110px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
			],
			listPath: () => `/api/lab-order/search?page=0&size=500`,
		},
		labResults: {
			title: 'Lab Results', configKey: 'labs', basePath: '/api/lab-results', fhirPatientScoped: false, nonFhir: true,
			columns: [
				{ key: 'testName', label: 'Test', width: '2fr' },
				// Value shows ONLY the numeric result — the unit lives in its own
				// place (form field `units`) and is NOT appended here, so the column
				// no longer reads like it merged the value and unit columns.
				{ key: 'value', label: 'Value', width: '90px', format: (_v, r) => { const val = String(r.value ?? r.result ?? ''); return val !== '' ? val : '—'; } },
				{ key: 'referenceRange', label: 'Range', width: '100px' },
				{ key: 'abnormalFlag', label: 'Flag', width: '80px' },
				{ key: 'status', label: 'Status', width: '100px' },
				{ key: 'collectedDate', label: 'Collected', width: '110px', format: (v) => v ? new Date(String(v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
			],
			listPath: () => `/api/lab-results?page=0&size=500`,
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
				// Show the SAME two-state vocabulary as the snapshot's Encounter
				// History card — QA flagged this popup showing raw FHIR codes
				// ("finished" / "in-progress") while the history showed
				// Signed / Unsigned for the very same encounters. Mirrors
				// _normalizeEncounterStatus (inlined: a static initializer must not
				// self-reference the decorated class — esbuild #3823 workaround rule).
				{
					key: 'status', label: 'Status', width: '110px', format: (v) => {
						const s = String(v ?? '').toLowerCase();
						return (s.includes('sign') && !s.includes('unsign')) || s.includes('finish') || (s.includes('complet') && !s.includes('incomplet')) ? 'Signed' : 'Unsigned';
					}
				},
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

		// Carry field-level validation so the snapshot popup enforces the SAME
		// rules as the full chart editor — previously these were dropped, so e.g.
		// payment amount fields accepted negatives and date fields accepted
		// past-year values with no validation (QA issues 7 & 8).
		if (f.validationPattern) { out.validationPattern = f.validationPattern; }
		if (f.validationMessage) { out.validationMessage = f.validationMessage; }
		if (f.minDate) { out.minDate = f.minDate; }

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
		// Lab Orders / Lab Results reuse the EXACT clinical Labs page create/edit
		// schema (one source of truth — {@link LAB_ORDER_FORM_FIELDS} /
		// {@link LAB_RESULT_FORM_FIELDS}). The patient is fixed on the snapshot, so
		// the patient-lookup fields are dropped and patientId is injected on save.
		if (PatientSnapshotEditor._isLabEntity(entity)) {
			const base = entity === 'labOrders' ? LAB_ORDER_FORM_FIELDS : LAB_RESULT_FORM_FIELDS;
			const trimmed = base.filter(f => !['patientFirstName', 'patientId', 'patientLastName'].includes(f.key));
			return withTypeaheadSearch(formFieldsToEditFields(trimmed), this.apiService);
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
			// "Date Issued" (the medication start/authored date) must be neither a
			// past-year date nor a FUTURE date — the form previously saved medications
			// with a date like 2022 (no lower bound) and 2027 (no upper bound), with
			// no validation (QA issue 8 / the Date-Issued future-year report).
			const dateIssued = fields.find(f => f.key === 'startDate');
			if (dateIssued) {
				dateIssued.minDate = 'year-start';
				dateIssued.maxDate = 'today';
				dateIssued.validationMessage = 'Date Issued cannot be a past-year or future date';
			}
		}
		// Snapshot-only: the Active Problems onset/resolved dates must stay within
		// the CURRENT calendar year (past & future MONTHS allowed, but no past- or
		// future-YEAR dates) — the form previously accepted any year (QA issue 1).
		if (entity === 'problems') {
			for (const key of ['onsetDate', 'resolvedDate']) {
				const dateField = fields.find(f => f.key === key);
				if (dateField) {
					dateField.minDate = 'year-start';
					dateField.maxDate = 'year-end';
					dateField.validationMessage = `${dateField.label} must be within the current year`;
				}
			}
			// A Resolved Date on a problem that is still Active is contradictory —
			// the form accepted a (past) resolved date without touching the status
			// (QA issue 2). Also keep the order sane vs the Onset Date. Mirrors the
			// chart editor drawer's problems cross-field block.
			const resolved = fields.find(f => f.key === 'resolvedDate');
			if (resolved) {
				resolved.validate = (v, all) => {
					if (!v.trim()) { return undefined; }
					const status = String(all['clinicalStatus'] ?? all['status'] ?? '').trim().toLowerCase();
					if (status === 'active') { return 'Resolved Date can only be set when the problem Status is not Active.'; }
					const onset = (all['onsetDate'] ?? '').trim();
					if (onset && v.trim() < onset) { return 'Resolved Date cannot be earlier than the Onset Date.'; }
					return undefined;
				};
			}
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
			// BMI is not stored on the FHIR vitals Observation (only height + weight),
			// so it opened blank. Auto-calculate it from THIS form's vitals_weight /
			// vitals_height keys (not the chart's heightCm/weightKg) — read-only, live,
			// matching the chart flowsheet + dedicated encounter editor.
			{ key: 'vitals_bmi', label: 'BMI', kind: 'number', placeholder: 'Auto-calculated', widthPct: 25, readonly: true, compute: (vals) => PatientSnapshotEditor._computeBmi(vals['vitals_height'], vals['vitals_weight']) },
			// Pain Level intentionally omitted from the encounter edit form (product decision).
			{ key: 'vitals_notes', label: 'Vitals Notes', placeholder: 'Additional notes...', widthPct: 50 },

			// --- Physical Exam (grid collapsed to textarea) ---
			{ key: 'pe_data', label: 'Physical Exam', kind: 'textarea', placeholder: 'General, head/eyes/ears/nose/throat, neck, chest, cardiovascular, abdomen, extremities, neurological, skin, psychiatric...', widthPct: 100 },

			// --- Past Medical / Surgical History ---
			{ key: 'pmh_conditions', label: 'PMH: Medical History', kind: 'textarea', placeholder: 'List past medical conditions...', widthPct: 50 },
			{ key: 'pmh_surgeries', label: 'PMH: Surgical History', kind: 'textarea', placeholder: 'List past surgeries...', widthPct: 50 },
			{ key: 'pmh_allergies', label: 'PMH: Allergies', kind: 'textarea', placeholder: 'List known allergies...', widthPct: 50 },
			{ key: 'pmh_medications', label: 'PMH: Current Medications', kind: 'textarea', placeholder: 'List current medications...', widthPct: 50 },

			// --- Family History ---
			{ key: 'fh_father', label: 'FH: Father', placeholder: 'Health conditions...', widthPct: 50 },
			{ key: 'fh_mother', label: 'FH: Mother', placeholder: 'Health conditions...', widthPct: 50 },
			{ key: 'fh_siblings', label: 'FH: Siblings', placeholder: 'Health conditions...', widthPct: 50 },
			{ key: 'fh_notes', label: 'FH: Additional Notes', kind: 'textarea', widthPct: 100 },

			// --- Social History ---
			// Each field carries a descriptive placeholder (QA: the drawer's
			// Social History inputs all rendered blank / with a bare "-"). For the
			// selects the empty option doubles as the placeholder row, mirroring
			// how the calendar dropdowns surface their placeholder as a clear row.
			{
				key: 'sh_smoking', label: 'SH: Smoking', kind: 'select', placeholder: 'Select smoking status...', widthPct: 33, options: [...SH_SMOKING_OPTIONS]
			},
			{
				key: 'sh_alcohol', label: 'SH: Alcohol', kind: 'select', placeholder: 'Select alcohol use...', widthPct: 33, options: [...SH_ALCOHOL_OPTIONS]
			},
			{
				key: 'sh_exercise', label: 'SH: Exercise', kind: 'select', placeholder: 'Select exercise frequency...', widthPct: 33, options: [...SH_EXERCISE_OPTIONS]
			},
			{ key: 'sh_occupation', label: 'SH: Occupation', placeholder: 'e.g., Teacher, Software Engineer...', widthPct: 50 },
			{
				key: 'sh_drugs', label: 'SH: Recreational Drugs', kind: 'select', placeholder: 'Select drug use...', widthPct: 50, options: [...SH_DRUGS_OPTIONS]
			},
			{ key: 'sh_notes', label: 'SH: Additional Notes', kind: 'textarea', placeholder: 'Additional social history notes...', widthPct: 100 },

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
			// Labeled "Provider Notes" to match the dedicated Encounter editor's
			// label — QA flagged "Provider Narrative" here vs "Provider Notes"
			// there as inconsistent.
			{ key: 'provider_narrative', label: 'Provider Notes', kind: 'textarea', placeholder: 'Free-text provider notes...', widthPct: 100 },

			// --- Procedures ---
			{ key: 'procedures_data', label: 'Procedures (CPT/HCPCS)', kind: 'textarea', placeholder: 'One procedure per line: e.g. 99213 — Office visit, established patient', widthPct: 100 },
			{ key: 'procedures_notes', label: 'Procedure Notes', kind: 'textarea', placeholder: 'Procedure details and notes...', widthPct: 100 },
			// NOTE: the standalone "Reason for Visit" field was removed — the
			// dedicated Encounter editor has no such field under Procedures &
			// Coding (QA flagged the mismatch). The FHIR Encounter's reason stays
			// in sync via the Chief Complaint mapping on save.
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
	 * The two clinical-backed lab entities the snapshot manages — Lab Orders
	 * (/api/lab-order) and Lab Results (/api/lab-results).
	 */
	private static _isLabEntity(entity: string): boolean {
		return entity === 'labOrders' || entity === 'labResults';
	}

	/**
	 * Collapse any encounter status onto the two states the workspace tracks:
	 * SIGNED (finalized / locked) and UNSIGNED (still open). Accepts FHIR codes
	 * ('finished', 'completed', 'in-progress', 'planned', …) and the EHR values
	 * ('SIGNED'/'UNSIGNED'/'INCOMPLETE'); anything not clearly signed is unsigned.
	 */
	private static _normalizeEncounterStatus(raw: unknown): string {
		const s = String(raw ?? '').toLowerCase();
		// NOTE: exclude "unsigned" from the sign match and "incomplete" from the
		// complete match — "incomplete" contains "complet" and was wrongly read as
		// SIGNED, locking an open encounter out of editing.
		return (s.includes('sign') && !s.includes('unsign')) || s.includes('finish') || (s.includes('complet') && !s.includes('incomplet'))
			? 'SIGNED'
			: 'UNSIGNED';
	}

	/**
	 * Drop repeated rows from a record list (QA: Encounter History showed the
	 * same encounter twice). The same record can arrive under both its EHR id
	 * and its FHIR id — a session-pending overlay keyed one way, the server
	 * list the other — so a row counts as a duplicate when ANY of its ids has
	 * already been seen. Rows with no id at all are kept as-is.
	 */
	private static _dedupeByAnyId(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const seen = new Set<string>();
		const seenFp = new Set<string>();
		const out: Array<Record<string, unknown>> = [];
		for (const r of items) {
			const ids = [r.id, r.fhirId, r.encounterId].map(v => String(v ?? '').trim()).filter(v => v && v !== 'undefined' && v !== 'null');
			if (ids.some(id => seen.has(id))) { continue; }
			// Content fingerprint: the backend can double-create an encounter for a
			// single action (two resources, different ids, identical patient +
			// start/end timestamps — observed with telehealth visit encounters).
			// Two encounters that match to the second on start AND end are the same
			// visit, so only the first survives. Rows without a start date never
			// fingerprint-match.
			const start = String(r.startDate ?? r.encounterDate ?? r.start ?? '').trim();
			const fp = start ? [String(r.patientRef ?? r.patientId ?? ''), start, String(r.endDate ?? r.end ?? ''), String(r.type ?? ''), String(r.reason ?? '')].join('|') : '';
			if (fp && seenFp.has(fp)) { continue; }
			for (const id of ids) { seen.add(id); }
			if (fp) { seenFp.add(fp); }
			out.push(r);
		}
		return out;
	}

	/**
	 * Collapse a Composition's FLAT per-system keys for a section (prefix `pe_` /
	 * `ros_`) into the `{system: finding}` object the popup's ROS / PE textareas
	 * render via {@link _encounterFieldToText}. Text findings (e.g. `pe_heent`)
	 * pass through; per-system booleans (e.g. `ros_gi`) map to Positive / Negative.
	 * The collapsed `${prefix}data` key and the `_normal` display-flag booleans
	 * (e.g. `pe_heent_normal`) are skipped.
	 */
	private static _collapseGranularSection(src: Record<string, unknown>, prefix: string): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(src)) {
			if (!k.startsWith(prefix) || k === `${prefix}data` || k.endsWith('_normal')) { continue; }
			const sys = k.slice(prefix.length);
			if (typeof v === 'string' && v.trim() !== '') { out[sys] = v.trim(); }
			else if (typeof v === 'boolean') { out[sys] = v ? 'Positive' : 'Negative'; }
		}
		return out;
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
				// The dedicated Encounter editor stores structured rows
				// ({ type, description, notes }); render each as
				// "[Type] description — notes" so the flat textarea round-trips
				// through _textToEncounterField without losing the type/notes.
				return value.map(i => {
					if (typeof i === 'string') { return i.trim(); }
					const o = (i ?? {}) as Record<string, unknown>;
					const desc = clean(o.description ?? o.text ?? o.item);
					if (!desc && !clean(o.notes)) { return ''; }
					const type = clean(o.type).toLowerCase();
					const prefix = type && type !== 'other' ? `[${type}] ` : '';
					const notes = clean(o.notes);
					return `${prefix}${desc}${notes ? ` — ${notes}` : ''}`;
				}).filter(Boolean).join('\n');
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
				// Parse back into the structured rows the dedicated Encounter editor
				// stores: an optional "[type]" prefix and an optional " — notes" tail
				// around the description (inverse of _encounterFieldToText above).
				return lines.map(line => {
					let type = 'other';
					let rest = line;
					const tm = /^\[([^\]]+)\]\s*(.*)$/.exec(rest);
					if (tm) { type = tm[1].trim().toLowerCase(); rest = tm[2]; }
					let notes = '';
					const nm = /^(.*?)\s+—\s+(.*)$/.exec(rest);
					if (nm) { rest = nm[1]; notes = nm[2]; }
					return { type, description: rest.trim(), notes: notes.trim() };
				});
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
		let items = Array.isArray(arr) ? arr as Array<Record<string, unknown>> : [];
		// The clinical lab endpoints (/api/lab-order/search, /api/lab-results) are
		// global — they return EVERY patient's rows — so filter to the patient on
		// screen (mirrors how the clinical Labs page filters client-side).
		if (PatientSnapshotEditor._isLabEntity(entity)) {
			const pid = String(this._currentPatientId);
			items = items.filter(r => String(r.patientId ?? r.patient ?? '') === pid);
		}
		// The generic FHIR `/vitals/patient/{id}` endpoint can return cross-patient
		// rows, so the historical-vitals popup must scope to the patient on screen
		// too (same guard the display card applies in `_loadAndRender`).
		if (entity === 'vitals') {
			items = this._filterToPatient(items, this._currentPatientId);
		}
		return this._mergePending(entity, this._filterDeleted(entity, items));
	}

	/** Scope an overlay key to the patient on screen so the pending-create and
	 *  deleted-id overlays never bleed across patients (the editor pane is reused
	 *  for every snapshot tab). */
	private _overlayKey(entity: string): string {
		return `${this._currentPatientId}::${entity}`;
	}

	private _filterDeleted(entity: string, items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const set = this._deletedIds.get(this._overlayKey(entity));
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
		const key = this._overlayKey(entity);
		let set = this._deletedIds.get(key);
		if (!set) { set = new Set<string>(); this._deletedIds.set(key, set); }
		set.add(id);
	}

	private _trackCreated(entity: string, record: Record<string, unknown>): void {
		const id = String(record.id ?? record.fhirId ?? '');
		if (!id) { return; }
		const key = this._overlayKey(entity);
		const arr = this._pendingCreates.get(key) || [];
		// Replace any prior entry with the same id (covers create-then-edit).
		const filtered = arr.filter(r => String(r.id ?? r.fhirId ?? '') !== id);
		// Stamp the client time the overlay was captured so _mergePending can tell
		// when the server row has since been updated by ANOTHER editor (Encounter /
		// Patient Chart) and yield to it instead of shadowing it forever.
		filtered.unshift({ ...record, _pendingClientAt: Date.now() });
		this._pendingCreates.set(key, filtered);
	}

	/** True when the freshly-fetched server row is a NEWER version than our locally
	 *  captured overlay — i.e. the same record was edited elsewhere (e.g. the
	 *  Encounter form's vitals) after we saved it here. In that case the overlay is
	 *  stale and must not shadow the server copy. Prefers a server-vs-server
	 *  `_lastUpdated` comparison (no clock skew); falls back to the client capture
	 *  time with a grace margin when the save response carried no timestamp. When no
	 *  server timestamp is available at all, returns false so index-lag protection
	 *  (the overlay's real purpose) is preserved. */
	private _serverSupersedesOverlay(serverRow: Record<string, unknown>, overlay: Record<string, unknown>): boolean {
		const serverLU = Date.parse(String(serverRow._lastUpdated ?? ''));
		if (!Number.isFinite(serverLU)) { return false; }
		const overlayLU = Date.parse(String(overlay._lastUpdated ?? ''));
		if (Number.isFinite(overlayLU)) { return serverLU > overlayLU; }
		const capturedAt = Number(overlay._pendingClientAt ?? 0);
		return capturedAt > 0 && serverLU > capturedAt + 5000;
	}

	private _mergePending(entity: string, items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const pending = this._pendingCreates.get(this._overlayKey(entity));
		if (!pending || pending.length === 0) { return items; }
		const out = [...items];
		const indexById = new Map<string, number>();
		out.forEach((r, i) => { const id = String(r.id ?? r.fhirId ?? ''); if (id) { indexById.set(id, i); } });
		const superseded = new Set<string>();
		for (const p of pending) {
			const pid = String(p.id ?? p.fhirId ?? '');
			if (pid && indexById.has(pid)) {
				const i = indexById.get(pid)!;
				// If the server row is NEWER than our overlay, the same record was
				// edited in another editor (e.g. vitals saved from the Encounter form)
				// after we saved it here — the server copy wins and the stale overlay
				// is dropped, so the other editor's change shows (bug: Encounter vitals
				// not reflecting on the Snapshot). Otherwise the server's search index
				// may still hold stale values right after OUR save, so overlay our
				// locally-saved copy (QA: edited date not showing).
				if (this._serverSupersedesOverlay(out[i], p)) {
					superseded.add(pid);
				} else {
					out[i] = { ...out[i], ...p };
				}
			} else {
				// A create the server hasn't indexed yet — surface it at the top.
				out.unshift(p);
			}
		}
		// Drop overlays the server has since superseded so they don't linger and
		// re-shadow future fetches; keep the rest for the session (small, replaced
		// by id, cleared on reopen) to avoid a stale-vs-fresh flip-flop.
		if (superseded.size > 0) {
			const key = this._overlayKey(entity);
			this._pendingCreates.set(key, pending.filter(r => !superseded.has(String(r.id ?? r.fhirId ?? ''))));
		}
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
	private async _saveEncounterComposition(values: Record<string, string>, existingId: string | undefined): Promise<{ res: Response; encounterId: string }> {
		const pid = this._currentPatientId;
		let encounterId = existingId || '';
		// The Status dropdown is two-state (Signed/Unsigned); the patient-scoped
		// encounter endpoint accepts those values directly (see encounterListPane).
		const statusVal = PatientSnapshotEditor._normalizeEncounterStatus(values['status'] || 'UNSIGNED');
		// The encounter's END date is the date it was SIGNED: when finalizing an
		// encounter (status → SIGNED) and the user left End Date blank, stamp it with
		// today so a signed encounter always carries a sign/end date (it was blank
		// because the save never sent one). A user-entered End Date is respected.
		const endDate = String(values['endDate'] || '').trim()
			|| (statusVal === 'SIGNED' ? this._localIso(new Date()).slice(0, 10) : '');
		if (!encounterId) {
			const reason = String(values['chiefComplaint'] || values['reason'] || '').trim();
			const startDate = values['startDate'] || new Date().toISOString();
			const createRes = await this.apiService.fetch(`/api/${pid}/encounters`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					visitCategory: values['type'] || 'AMB',
					encounterDate: startDate,
					endDate: endDate || undefined,
					encounterProvider: String(values['provider'] || '').trim() || undefined,
					status: statusVal,
					reasonForVisit: reason,
				}),
			});
			if (!createRes.ok) { return { res: createRes, encounterId: '' }; }
			const created = await createRes.json().catch(() => null);
			encounterId = String(created?.data?.id || created?.id || '');
			if (!encounterId) { throw new Error('Encounter created but server returned no id'); }
		} else {
			// Editing an existing encounter — persist the encounter-level status
			// (Signed/Unsigned), provider and start/end dates through the patient-scoped
			// endpoint, since the encounter-form composition save below only carries
			// clinical content, not the Encounter's own fields. Mirrors encounterListPane.
			const reason = String(values['chiefComplaint'] || values['reason'] || '').trim();
			// Persist the encounter-level status (Signed/Unsigned) here. This is the
			// SAME endpoint the Encounters side-menu list reads, so a successful PUT is
			// what makes a status change in the snapshot show up there too. Previously
			// the result was swallowed with `.catch(() => {})`, so a status PUT that the
			// server rejected (4xx/5xx resolves without throwing) failed silently — the
			// snapshot showed the new status from its local overlay while the encounter
			// list kept the old one (QA: status change not reflected in side-menu). Now
			// we check the response and warn the user when the status did not persist.
			try {
				const stRes = await this.apiService.fetch(`/api/${pid}/encounters/${encounterId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						visitCategory: values['type'] || undefined,
						encounterDate: values['startDate'] || undefined,
						endDate: endDate || undefined,
						encounterProvider: String(values['provider'] || '').trim() || undefined,
						status: statusVal,
						reasonForVisit: reason || undefined,
					}),
				});
				if (!stRes.ok) {
					this.notificationService.notify({
						severity: Severity.Warning,
						message: `Encounter status could not be updated (HTTP ${stRes.status}); the clinical note was still saved.`,
					});
				}
			} catch {
				// Network failure only — the composition save below still runs so the
				// clinical content isn't lost.
				this.notificationService.notify({
					severity: Severity.Warning,
					message: 'Encounter status could not be updated (network error); the clinical note was still saved.',
				});
			}
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
		// Persist the composition (the rich clinical content), then mirror the
		// vitals onto the shared FHIR vitals store so an edit made in the encounter
		// -history card surfaces on the Snapshot vitals card and the Encounter form.
		const compRes = await this._saveEncounterCompositionDoc(createUrl, headers, body, pid, encounterId, existingId);
		await this._upsertEncounterVitals(values, values['startDate']);
		return { res: compRes, encounterId };
	}

	/** Write just the encounter-form Composition document (no vitals side-effect).
	 *  Split out of {@link _saveEncounterComposition} so vitals can be upserted to
	 *  the shared store afterwards regardless of which save branch ran. */
	private async _saveEncounterCompositionDoc(createUrl: string, headers: Record<string, string>, body: string, pid: string, encounterId: string, existingId: string | undefined): Promise<Response> {
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
	/** The viewed visit's encounter/fee-sheet ids, captured at render time, so a
	 *  payment collected from the snapshot is tied to the visit being worked. */
	private _visitPaymentRef: { encounterId: string; feeSheetId: string } | null = null;

	private async _savePayment(values: Record<string, string>): Promise<Response> {
		const payload = this._buildPaymentDto(values, /* downgradeCards */ true);
		payload.patientId = this._currentPatientId;
		// Tie the payment to the visit being worked (same fields the Payments
		// dashboard collect sends) so the Visit Workflow's Payment step completes
		// from THIS visit's payment — not any same-day patient payment. The
		// description fallback covers backends that drop the link fields.
		if (this._visitPaymentRef?.encounterId) {
			payload.encounterId = this._visitPaymentRef.encounterId;
			if (this._visitPaymentRef.feeSheetId) { payload.feeSheetId = this._visitPaymentRef.feeSheetId; }
			if (!payload.description) { payload.description = `Encounter ${this._visitPaymentRef.encounterId}`; }
		}
		// The RCM-style New Payment form has no plain "amount" field — it captures
		// Paid / Allowed amounts. `_buildPaymentDto` falls back through them; if it
		// still resolves to 0 the backend rejects with "A valid payment amount is
		// required", so surface a client-side validation error instead of POSTing a 400.
		if (!(Number(payload.amount) > 0)) {
			return new Response(
				JSON.stringify({ message: 'Enter a payment amount greater than 0.' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}
		const res = await this.apiService.fetch('/api/payments/collect', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		// The /collect POST only accepts card methods with a saved card on file,
		// so `_buildPaymentDto(…, downgradeCards)` records them as 'other' — which
		// made a Debit/Credit Card payment show METHOD "Other" in the Transactions
		// list forever (QA issue 12). The transactions PUT accepts card methods
		// verbatim, so immediately write the REAL chosen method back onto the
		// just-created transaction. Best-effort: a failed PUT leaves the recorded
		// payment intact ('other', the old behavior).
		const rawMethod = String(values['paymentMethod'] ?? values['paymentMethodType'] ?? values['method'] ?? '').trim();
		if (res.ok && (rawMethod === 'credit_card' || rawMethod === 'debit_card')) {
			try {
				// The response body is consumed here — hand callers a re-wrapped copy.
				const bodyText = await res.text();
				let createdId = '';
				try {
					const j = JSON.parse(bodyText);
					const rec = (j?.data ?? j) as Record<string, unknown> | null;
					createdId = String(rec?.['id'] ?? rec?.['transactionId'] ?? '').trim();
				} catch { /* non-JSON body */ }
				if (/^\d+$/.test(createdId)) {
					await this.apiService.fetch(`/api/payments/transactions/${createdId}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ ...payload, id: Number(createdId), paymentMethodType: rawMethod }),
					});
				}
				return new Response(bodyText, { status: res.status, headers: { 'Content-Type': 'application/json' } });
			} catch { /* fall through with the original (consumed) response */ }
		}
		return res;
	}

	/**
	 * Payment methods that need a saved card on file. This form RECORDS an
	 * already-applied payment (no live Stripe charge), so there is never a saved
	 * card on hand — `/api/payments/collect` (and the transaction PUT) reject
	 * `credit_card`/`debit_card` unless a `paymentMethodId` is supplied ("A saved
	 * payment method is required for card payments" → 400). Downgrade those two to
	 * `other`; every other method (cash, check, ach, fsa, hsa, …) is kept as-is.
	 */
	private static readonly _PAYMENT_METHOD_MAP: Record<string, string> = {
		credit_card: 'other', debit_card: 'other', cash: 'cash',
		check: 'check', eft: 'ach', ach: 'ach', bank_account: 'bank_account',
		fsa: 'fsa', hsa: 'hsa',
	};

	/** Transaction statuses the backend accepts. The shared payment form's Status
	 *  select now lists exactly these (it used to list *invoice* statuses —
	 *  issued/draft/balanced — which a PaymentTransaction rejects, so every edit
	 *  silently fell back to 'completed' and the status change never stuck, QA
	 *  issue 8). The guard below stays as a safety net for stale stored values. */
	private static readonly _PAYMENT_TXN_STATUSES = new Set(['completed', 'pending', 'failed', 'refunded', 'cancelled', 'voided', 'processing']);

	/**
	 * Build the `PaymentTransactionDto` body the `/api/payments` endpoints accept,
	 * whitelisting ONLY recognised keys. Both create (POST /collect) and edit
	 * (PUT /transactions/{id}) share this: editing previously sent the whole stored
	 * record plus every form field (allocation fields, server-only keys, form-only
	 * keys like `paymentMethod`/`reference`), which the backend's strict validation
	 * rejected with 400. Pulling out a clean DTO is what fixes the edit-save 400.
	 */
	private _buildPaymentDto(values: Record<string, unknown>, downgradeCards = false): Record<string, unknown> {
		const str = (v: unknown): string => String(v ?? '').trim();
		const rawMethod = str(values['paymentMethod'] ?? values['paymentMethodType'] ?? values['method']);
		// Only the live /collect endpoint needs the card→other downgrade (it tries to
		// charge a saved card and 400s without one). Editing just updates a recorded
		// payment, so the chosen method (e.g. Debit Card) is preserved verbatim.
		const method = downgradeCards
			? (PatientSnapshotEditor._PAYMENT_METHOD_MAP[rawMethod] || (rawMethod || 'other'))
			: (rawMethod || 'other');
		const dto: Record<string, unknown> = {
			amount: Number(values['amount'] || values['paidAmount'] || values['allowedAmount'] || 0),
			transactionType: str(values['transactionType']) || 'payment',
			paymentMethodType: method,
		};
		// `collectedAt` is the DTO's date key; the form captures it as `paymentDate`.
		const collectedAt = str(values['collectedAt'] ?? values['paymentDate'] ?? values['transactionDate']);
		if (collectedAt) { dto.collectedAt = collectedAt.slice(0, 10); }
		const referenceType = str(values['referenceType']);
		if (referenceType) { dto.referenceType = referenceType; }
		const description = str(values['description'] ?? values['payerName']);
		if (description) { dto.description = description; }
		const invoiceNumber = str(values['invoiceNumber']);
		if (invoiceNumber) { dto.invoiceNumber = invoiceNumber; }
		const receiptEmail = str(values['receiptEmail']);
		if (receiptEmail) { dto.receiptEmail = receiptEmail; }
		const notes = str(values['notes'] ?? values['reference']);
		if (notes) { dto.notes = notes; }
		const status = str(values['status']);
		dto.status = PatientSnapshotEditor._PAYMENT_TXN_STATUSES.has(status) ? status : 'completed';
		// Allocation & adjustment detail — the backend now persists these, so send
		// them through so the Edit Payment form round-trips fully (was dropping
		// payer / claim / date-of-service / the whole allocation section).
		const dateOfService = str(values['dateOfService']);
		if (dateOfService) { dto.dateOfService = dateOfService.slice(0, 10); }
		const payerName = str(values['payerName']);
		if (payerName) { dto.payerName = payerName; }
		const claimId = str(values['claimId']);
		if (claimId) { dto.claimId = claimId; }
		const adjustmentReason = str(values['adjustmentReason']);
		if (adjustmentReason) { dto.adjustmentReason = adjustmentReason; }
		const eraReference = str(values['eraReference']);
		if (eraReference) { dto.eraReference = eraReference; }
		const num = (key: string): void => {
			const raw = values[key];
			if (raw === undefined || raw === null || str(raw) === '') { return; }
			const n = Number(raw);
			if (!isNaN(n)) { dto[key] = n; }
		};
		num('allowedAmount'); num('paidAmount'); num('adjustmentAmount');
		num('patientResponsibility'); num('remainingBalance');
		return dto;
	}

	/**
	 * Map a stored payment transaction record onto the chart-editor payment form
	 * keys so the Edit form pre-fills. The backend `PaymentTransactionDto` renames
	 * a couple of fields: the form uses `paymentDate` / `paymentMethod`, the DTO
	 * stores `collectedAt` / `paymentMethodType`. Without this remap the Edit
	 * Payment form opened with Payment Date and Method blank (Payment Date is
	 * required, so the form could not even be saved).
	 */
	/**
	 * Re-fetch the full payment transaction by id before opening the Edit form.
	 * The Payment History list rows can be a trimmed projection (so the Edit form
	 * opened with Date of Service / Reference Type / Receipt Email / allocation
	 * fields blank even though the stored transaction carried them — QA: "edit
	 * doesn't fetch all the data"). GET /api/payments/transactions/{id} returns the
	 * canonical record; merge it over the list row so every field pre-fills. Falls
	 * back to the list row if the id is non-numeric or the fetch fails.
	 */
	/** id → display-name map for the org's providers, built lazily from the same
	 * two endpoints the provider typeahead queries. Used to show the prescriber's
	 * NAME (not the raw practitioner id) when editing a medication. */
	private _providerNamesById: Map<string, string> | null = null;

	private async _lookupProviderName(id: string): Promise<string> {
		if (!this._providerNamesById) {
			const map = new Map<string, string>();
			for (const url of ['/api/providers?page=0&size=200', '/api/fhir-resource/providers?page=0&size=200']) {
				try {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { continue; }
					const data = await res.json();
					const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
					for (const p of (Array.isArray(list) ? list : [])) {
						const ident = p['identification'] as Record<string, unknown> | undefined;
						const name = String(p['name'] || p['fullName'] || `${String(ident?.['firstName'] ?? p['firstName'] ?? '')} ${String(ident?.['lastName'] ?? p['lastName'] ?? '')}`.trim()).trim();
						if (!name) { continue; }
						for (const key of ['id', 'providerId', 'practitionerId', 'fhirId']) {
							const pid = p[key];
							if (pid !== undefined && pid !== null && String(pid).trim() && !map.has(String(pid))) {
								map.set(String(pid), name);
							}
						}
					}
				} catch { /* endpoint unavailable — try the next */ }
			}
			this._providerNamesById = map;
		}
		return this._providerNamesById.get(id) ?? '';
	}

	/**
	 * The stored medication carries the prescriber as a raw practitioner
	 * reference ("Practitioner/13889" or "13889"), which the Edit Medication
	 * form displayed verbatim (QA: "prescriber field is showing the provider
	 * id"). Resolve it to the provider's display name for the form, remembering
	 * the original reference so an untouched field saves back the reference —
	 * not the display string.
	 */
	private _medPrescriber: { ref: string; display: string } | undefined;

	private async _resolveMedicationPrescriber(row: Record<string, unknown>): Promise<Record<string, unknown>> {
		this._medPrescriber = undefined;
		const rawRef = String(row['prescribingDoctor'] ?? '').trim();
		const id = rawRef.replace(/^Practitioner\//i, '').trim();
		// Nothing stored, or already a human-readable name (has whitespace).
		if (!id || /\s/.test(id)) { return row; }
		const fromRow = String(row['prescriberName'] ?? row['prescribingDoctorDisplay'] ?? row['prescriberDisplay'] ?? '').trim();
		const display = fromRow || await this._lookupProviderName(id);
		if (!display) { return row; }
		this._medPrescriber = { ref: rawRef, display };
		return { ...row, prescribingDoctor: display };
	}

	/** Save-side counterpart of {@link _resolveMedicationPrescriber}: if the
	 * Prescriber input still holds the substituted display name, put the stored
	 * practitioner reference back on the payload. */
	private _restoreMedPrescriber(payload: Record<string, unknown>, next: Record<string, unknown>): void {
		const sub = this._medPrescriber;
		if (sub && String(next['prescribingDoctor'] ?? '').trim() === sub.display) {
			payload['prescribingDoctor'] = sub.ref;
		}
	}

	private async _loadFullPayment(item: Record<string, unknown>): Promise<Record<string, unknown>> {
		const id = String(item.id ?? item.transactionId ?? '').trim();
		if (!/^\d+$/.test(id)) { return item; }
		try {
			const res = await this._fetch(`/api/payments/transactions/${id}`);
			const full = (res && (res.data ?? res)) as Record<string, unknown> | null;
			if (full && typeof full === 'object') { return { ...item, ...full }; }
		} catch { /* fall through with the list row */ }
		return item;
	}

	private _normalizePaymentForEdit(item: Record<string, unknown>): Record<string, unknown> {
		const dateOnly = (v: unknown): string => { const s = String(v ?? '').trim(); return s ? s.slice(0, 10) : ''; };
		const out: Record<string, unknown> = { ...item };
		out.paymentDate = dateOnly(item.paymentDate ?? item.collectedAt ?? item.transactionDate ?? item.date ?? item.createdAt);
		if (item.dateOfService) { out.dateOfService = dateOnly(item.dateOfService); }
		if (!out.paymentMethod) { out.paymentMethod = String(item.paymentMethod ?? item.paymentMethodType ?? item.method ?? ''); }
		if (out.amount === undefined || out.amount === null || out.amount === '') { out.amount = item.amount ?? item.totalAmount ?? ''; }
		// Map the remaining stored transaction keys onto their form-field keys so the
		// Edit form opens fully populated (previously Reference / Description / Payer
		// and Notes came up blank even though the record carried them).
		if (!out.reference) { out.reference = String(item.reference ?? item.notes ?? ''); }
		if (!out.notes) { out.notes = String(item.notes ?? ''); }
		if (!out.description) { out.description = String(item.description ?? ''); }
		if (!out.payerName) { out.payerName = String(item.payerName ?? item.payer ?? item.description ?? ''); }
		if (!out.referenceType) { out.referenceType = String(item.referenceType ?? ''); }
		if (!out.invoiceNumber) { out.invoiceNumber = String(item.invoiceNumber ?? ''); }
		if (!out.receiptEmail) { out.receiptEmail = String(item.receiptEmail ?? ''); }
		// Map the remaining Payment Information + Allocation & Adjustments fields onto
		// their form-field keys (backend names differ for several), so the Edit form
		// opens fully populated instead of leaving Status / Claim / the allocation
		// breakdown blank.
		if (!out.status) { out.status = String(item.status ?? item.paymentStatus ?? ''); }
		if (!out.claimId) { out.claimId = String(item.claimId ?? item.claim ?? item.claimNumber ?? ''); }
		const num = (v: unknown): string => { const s = String(v ?? '').trim(); return s === '' ? '' : s; };
		if (!out.allowedAmount) { out.allowedAmount = num(item.allowedAmount ?? item.allowed); }
		if (!out.paidAmount) { out.paidAmount = num(item.paidAmount ?? item.paid ?? item.amount); }
		if (!out.adjustmentAmount) { out.adjustmentAmount = num(item.adjustmentAmount ?? item.adjustment); }
		if (!out.adjustmentReason) { out.adjustmentReason = String(item.adjustmentReason ?? item.adjustmentCode ?? ''); }
		if (!out.patientResponsibility) { out.patientResponsibility = num(item.patientResponsibility ?? item.patientResp); }
		if (!out.remainingBalance) { out.remainingBalance = num(item.remainingBalance ?? item.balance); }
		if (!out.eraReference) { out.eraReference = String(item.eraReference ?? item.erasReference ?? item.traceNumber ?? item.eftReference ?? ''); }
		return out;
	}

	/** Build the create / update URL the same way the full chart editor does. */
	private _saveUrl(entity: string, existingId: string | undefined): { url: string; method: 'POST' | 'PUT' } {
		const reg = PatientSnapshotEditor._ENTITY_REGISTRY[entity];
		const isEdit = !!existingId;
		const ep = reg.basePath;
		// Lab Orders are patient-scoped but WITHOUT the FHIR "/patient/" segment:
		// POST /api/lab-order/{patientId}, PUT /api/lab-order/{patientId}/{id}.
		// (Lab Results use the plain nonFhir {base}/{id} shape below.)
		if (entity === 'labOrders') {
			return isEdit
				? { url: `${ep}/${this._currentPatientId}/${existingId}`, method: 'PUT' }
				: { url: `${ep}/${this._currentPatientId}`, method: 'POST' };
		}
		if (reg.nonFhir) {
			// Non-FHIR: medical-problems / patients use plain {base} or {base}/{id}.
			if (entity === 'demographics') {
				return { url: `${ep}/${this._currentPatientId}`, method: 'PUT' };
			}
			// A payment edit PUTs to /api/payments/transactions/{id}, where {id} binds
			// to a numeric `@PathVariable Long id`. If a row reaches save without a
			// numeric transaction id, the URL becomes `.../undefined` and the backend
			// returns a raw HTTP 500 ("Failed to convert value 'undefined' to Long")
			// rather than a handled error. Guard it so the user sees a clear message
			// instead of an opaque 500.
			if (entity === 'payment' && isEdit && !/^\d+$/.test(String(existingId ?? ''))) {
				throw new Error('This payment cannot be edited — its transaction id is missing. Refresh the page and try again.');
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
			// Payment History opens this dialog in LIST mode; clicking a row's edit
			// pencil seeds the form from the raw transaction row, whose field names
			// (collectedAt / paymentMethodType / …) differ from the form keys
			// (paymentDate / paymentMethod / …). Map them so the edit form pre-fills
			// Payment Date, Method and the allocation breakdown instead of opening
			// blank (QA: payment edit "doesn't fetch all the data").
			normalizeEditItem: entity === 'payment'
				? (row: Record<string, unknown>) => this._normalizePaymentForEdit(row)
				: undefined,
			// Editing an encounter row from the list view carries only the displayed
			// columns (date/status/diagnosis) — load its full Encounter resource,
			// composition (narrative/ROS/PE/assessment/…) and the shared FHIR vitals
			// so the edit form pre-fills instead of opening blank (QA: "vitals and
			// other data not fetching").
			//
			// Payment History rows are likewise a trimmed list projection: the Edit
			// form opened with Payment Date / Method / allocation fields blank because
			// the synchronous normalizeEditItem only remaps whatever the row carried —
			// it can't pull the fields the list view omits. Refetch the full
			// transaction first (GET /api/payments/transactions/{id}) so every field is
			// present before normalizeEditItem maps the backend names onto the form
			// keys (QA: payment edit "still not fetching the data, showing nil").
			loadEditItem: entity === 'encounters'
				? (row: Record<string, unknown>) => this._loadEncounterForEdit(row)
				: entity === 'payment'
					? (row: Record<string, unknown>) => this._loadFullPayment(row)
					// Medications: show the prescriber's NAME instead of the stored
					// practitioner id (QA: "prescriber field is showing the provider id").
					: entity === 'medications'
						? (row: Record<string, unknown>) => this._resolveMedicationPrescriber(row)
						: undefined,
			saveRecord: async (next, existingId) => {
				// Encounters need a two-step save (mirrors EncounterFormEditor):
				//   1. POST /api/{patientId}/encounters to mint a real Encounter id
				//   2. POST /api/fhir-resource/encounter-form/patient/{pid}?encounterRef={id}
				//      to persist the clinical composition (CC, HPI, ROS, …).
				// Without step 1, the composition references "Encounter/new" and
				// HAPI rejects with HAPI-1094 "Resource Encounter/new not found".
				if (entity === 'encounters') {
					const { res, encounterId } = await this._saveEncounterComposition(next, existingId);
					if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
					// The save response body is the encounter-form COMPOSITION, whose id is
					// the composition id, NOT the Encounter id, so tracking the overlay
					// under it meant `_mergePending` could not match/insert the encounter row
					// and the newly created encounter did not appear in the list until the
					// FHIR search index caught up (the "created but not shown" report).
					// Pin the overlay to the real Encounter id and map the form values onto
					// the keys the encounters list reads so it shows up immediately.
					const encId = String(encounterId || existingId || '');
					if (encId) {
						const overlay: Record<string, unknown> = { ...next, id: encId, fhirId: encId };
						const startVal = String(next['startDate'] || next['date'] || new Date().toISOString());
						for (const k of ['encounterDate', 'startDate', 'start', 'date', 'periodStart', 'dateOfService']) { overlay[k] = startVal; }
						overlay.status = next['status'] || 'UNSIGNED';
						overlay.reason = String(next['chiefComplaint'] || next['reason'] || '');
						this._trackCreated(entity, overlay);
					}
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
				// Payment edit (PUT): send a clean, whitelisted transaction DTO so the
				// backend doesn't 400 on form-only/extra fields (create goes through
				// _savePayment above; this branch only runs for edits).
				if (entity === 'payment') {
					payload = this._buildPaymentDto(payload);
					payload.patientId = this._currentPatientId;
					if (existingId) { payload.id = existingId; }
				}
				// An untouched Prescriber (showing the resolved display name) saves
				// back the stored practitioner reference, not the name string.
				if (entity === 'medications') { this._restoreMedPrescriber(payload, next); }
				// Backend `vitals` POST without recordedAt is rejected by the
				// FhirPathMapper validation — chart editor injects this exact
				// fallback, so mirror it here.
				if (entity === 'vitals' && method === 'POST' && !payload.recordedAt) {
					payload.recordedAt = new Date().toISOString();
				}
				// The backend's DocumentReference search lists ONLY status=current
				// docs — a new document saved as Superseded/Entered-in-Error would
				// silently vanish from every list (QA issue 3; see the chart editor's
				// documents save block for the api-dev verification).
				if (entity === 'documents' && method === 'POST' && payload.status && String(payload.status).toLowerCase() !== 'current') {
					payload.status = 'current';
				}
				if ((!reg.nonFhir || PatientSnapshotEditor._isLabEntity(entity)) && entity !== 'demographics') {
					payload.patientId = this._currentPatientId;
					// Lab orders/results created from the snapshot must carry the
					// patient's name — the Lab Orders list falls back to "Patient #<id>"
					// when patientFirstName/Last are blank. The full Labs page fills these
					// from the patient search; here the patient is fixed, so backfill from
					// the known display name (QA issue 1).
					if (PatientSnapshotEditor._isLabEntity(entity) && this._currentPatientName) {
						const parts = this._currentPatientName.trim().split(/\s+/);
						if (!payload.patientFirstName) { payload.patientFirstName = parts[0] || this._currentPatientName; }
						if (!payload.patientLastName) { payload.patientLastName = parts.slice(1).join(' '); }
						if (!payload.patientName) { payload.patientName = this._currentPatientName; }
					}
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
				const delUrl = entity === 'labOrders'
					? `${reg.basePath}/${this._currentPatientId}/${id}`
					: reg.fhirPatientScoped
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
			: entity === 'payment' ? this._normalizePaymentForEdit(await this._loadFullPayment(item))
				// Medications: show the prescriber's NAME instead of the stored
				// practitioner id (QA: "prescriber field is showing the provider id").
				: entity === 'medications' ? await this._resolveMedicationPrescriber(item)
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
			// Re-editing an encounter row from this dialog's list view must also load
			// the full record (composition + shared FHIR vitals) so it pre-fills like
			// the initial edit does.
			loadEditItem: entity === 'encounters'
				? (row: Record<string, unknown>) => this._loadEncounterForEdit(row)
				: entity === 'medications'
					? (row: Record<string, unknown>) => this._resolveMedicationPrescriber(row)
					: undefined,
			saveRecord: async (next, existingId) => {
				if (entity === 'encounters') {
					const { res } = await this._saveEncounterComposition(next, existingId);
					if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
					// The save response is the encounter-form COMPOSITION, whose id is the
					// composition id — NOT the Encounter id. Tracking the overlay under the
					// composition id meant `_mergePending` could not match it to the
					// encounter row the server returns, so it unshifted a phantom SECOND row
					// (the "edit + sign → two duplicate records" report). Build the overlay
					// from the edited encounter row + the form values ONLY, and pin its id
					// to the Encounter id so the overlay updates the existing row in place.
					const encId = String(item.id ?? item.fhirId ?? existingId ?? '');
					const overlay: Record<string, unknown> = { ...item, ...next };
					if (encId) { overlay.id = encId; overlay.fhirId = encId; }
					// The dashboard reads the encounter date from any of these keys; map
					// the edited start date onto all of them so the overlay shows the new
					// date immediately even though the stale search index still has the old.
					const newStart = (next['startDate'] ?? next['date']) as string | undefined;
					if (newStart) {
						for (const k of ['encounterDate', 'startDate', 'start', 'date', 'periodStart', 'dateOfService']) {
							overlay[k] = newStart;
						}
					}
					// Reflect the chosen Signed/Unsigned status on the row right away.
					if (next['status']) { overlay.status = next['status']; }
					this._trackCreated(entity, overlay);
					this.notificationService.notify({ severity: Severity.Info, message: 'Encounter updated.' });
					this._rerender();
					return;
				}
				const { url, method } = this._saveUrl(entity, existingId);
				let payload: Record<string, unknown> = { ...item, ...next };
				// Payment edit: send a clean, whitelisted transaction DTO (built from the
				// stored record merged with the form edits) so changes persist and the
				// backend doesn't 400 on the stored record's server-only / nested fields.
				if (entity === 'payment') {
					payload = this._buildPaymentDto({ ...item, ...next });
					payload.patientId = this._currentPatientId;
					const payId = existingId ?? item.id ?? item.transactionId;
					if (payId) { payload.id = payId; }
				}
				// An untouched Prescriber (showing the resolved display name) saves
				// back the stored practitioner reference, not the name string.
				if (entity === 'medications') { this._restoreMedPrescriber(payload, next); }
				if ((!reg.nonFhir || PatientSnapshotEditor._isLabEntity(entity)) && entity !== 'demographics') {
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
				const delUrl = entity === 'labOrders'
					? `${reg.basePath}/${this._currentPatientId}/${id}`
					: reg.fhirPatientScoped
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
		let { comp: formData, compId } = this._extractEncounterComposition(form);
		// The composition endpoint is PATIENT-scoped, and the encounter may have
		// been charted under a different id for the same person (e.g. the
		// appointments drawer passes the appointment's patient id). When nothing
		// is found under the snapshot's id, retry under the Encounter subject's
		// own patient id so drawer-charted data still loads here (QA issue).
		if (!compId) {
			const encPid = String(detailData['patientId'] ?? detailData['patientRef'] ?? '').replace(/^Patient\//i, '').trim();
			if (encPid && encPid !== pid) {
				const altForm = await this._fetch(`/api/fhir-resource/encounter-form/patient/${encPid}?encounterRef=${encId}`);
				const alt = this._extractEncounterComposition(altForm);
				if (alt.compId) { formData = alt.comp; compId = alt.compId; }
			}
		}
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
		// Chief Complaint: the encounter-form Composition (written by the dedicated
		// Encounter editor) stores it as `cc_text`. Prefer that over the bare Encounter
		// resource's generic `reason` ("Manual encounter") so the popup shows the real
		// complaint (e.g. "high fever") instead of the placeholder.
		merged.chiefComplaint = pick('cc_text', 'chiefComplaint', 'reason', 'reasonForVisit', 'reasonCode');

		// Vitals live in the shared FHIR vitals store (ONE Observation per visit
		// DATE) — not on the encounter composition, whose `vitals_*` are usually
		// blank. Load the encounter date's reading and let it fill the vitals_*
		// fields (mirrors EncounterFormEditor), so the edit form shows the real
		// vitals instead of coming up empty. The save path writes any change back to
		// this same record, so it also shows on the Snapshot card and Encounter form.
		const encDateForVitals = merged.startDate || pick('encounterDate', 'start', 'periodStart', 'date');
		const vitalsObs = await this._findVitalsObsOnDate(encDateForVitals);
		if (vitalsObs) { Object.assign(merged, this._fhirToVitalsFields(vitalsObs)); }

		// Review of Systems / Physical Exam: compositions written by the dedicated
		// Encounter editor store these as FLAT per-system keys (ros_gi, pe_heent, …),
		// not the collapsed ros_data / pe_data object this popup's textareas read — so
		// they came up blank even though the encounter had a full ROS/PE. When the
		// collapsed form is absent, rebuild it from the flat keys so the real findings
		// show (mirrors how the dedicated Encounter editor renders them).
		if (!merged['pe_data'] || typeof merged['pe_data'] !== 'object') {
			const pe = PatientSnapshotEditor._collapseGranularSection(merged, 'pe_');
			if (Object.keys(pe).length > 0) { merged['pe_data'] = pe; }
		}
		if (!merged['ros_data'] || typeof merged['ros_data'] !== 'object') {
			const ros = PatientSnapshotEditor._collapseGranularSection(merged, 'ros_');
			if (Object.keys(ros).length > 0) { merged['ros_data'] = ros; }
		}

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
			const delUrl = entity === 'labOrders'
				? `${reg.basePath}/${this._currentPatientId}/${id}`
				: reg.fhirPatientScoped
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
	private _lastLoadAt = 0;
	private _rerender(): void {
		if (!this._lastRenderArgs) { return; }
		const { patientId, patientName, appointmentId } = this._lastRenderArgs;
		void this._loadAndRender(patientId, patientName, appointmentId);
	}

	/** Re-fetch when the snapshot becomes visible again so vitals (and other data)
	 *  edited in another open editor — the Encounter or Patient Chart — show up
	 *  without a manual reopen. Skipped right after a load to avoid a double fetch
	 *  on first open. */
	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (visible && this._lastRenderArgs && (Date.now() - this._lastLoadAt) > 1500) {
			this._rerender();
		}
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
		// The endpoint can return cross-patient rows (it ignores patientId in some
		// orgs), so filter to this patient before taking the first — otherwise a new
		// patient with no visit today would show a stranger's appointment.
		for (const url of [
			`/api/appointments?patientId=${patientId}&dateFrom=${today}&dateTo=${today}&page=0&size=5`,
			`/api/appointments?patientId=${patientId}&date=${today}&page=0&size=5`,
			`/api/fhir-resource/appointments?patientId=${patientId}&dateFrom=${today}&dateTo=${today}&page=0&size=5`,
		]) {
			const arr = this._filterAppointmentsToPatient(await readList(url), patientId);
			if (arr.length > 0) { return arr[0]; }
		}
		return null;
	}

	private async _loadAndRender(patientId: string, patientName: string, appointmentId?: string): Promise<void> {
		this._lastRenderArgs = { patientId, patientName, appointmentId };
		this._lastLoadAt = Date.now();
		const [patient, conditions, medications, vitals, encounters, labOrdersRaw, labResultsRaw, payments, statements, coverage, appointments] = await Promise.allSettled([
			this._fetch(`/api/patients/${patientId}`),
			this._fetch(`/api/medical-problems/${patientId}`),
			this._fetch(`/api/fhir-resource/medications/patient/${patientId}?page=0&size=50`),
			this._fetch(`/api/fhir-resource/vitals/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/encounters/patient/${patientId}?page=0&size=50`),
			// Lab ORDERS — the clinical /api/lab-order store (NOT the FHIR
			// /api/fhir-resource/labs endpoint, which is a different table the
			// clinical Labs page never reads). The endpoint is global with no
			// patient-scoped route, so pull a page and filter to this patient below.
			this._fetch(`/api/lab-order/search?page=0&size=500`),
			// Lab RESULTS entered on the clinical Labs page live in a separate, global
			// store (/api/lab-results). Same "load all + filter to this patient"
			// approach as the orders above.
			this._fetch(`/api/lab-results?page=0&size=500`),
			this._fetch(`/api/payments/transactions/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/statements/patient/${patientId}?page=0&size=1`),
			this._fetch(`/api/fhir-resource/insurance-coverage/patient/${patientId}?page=0&size=1`),
			// Full appointment history for this patient — powers the Visit History
			// card (which lists VISITS, distinct from the clinical Encounter History).
			this._fetch(`/api/appointments?patientId=${patientId}&page=0&size=50`),
		]);

		// Today's appointment and the location-name cache are independent fetches —
		// run them concurrently so the snapshot opens a round-trip faster.
		const [apt] = await Promise.all([
			this._fetchTodayAppointment(patientId, appointmentId),
			this._ensureLocationNames(),
		]);
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

		if (this._currentPatientId !== patientId) { return; }

		// Patient API may wrap the body in { data: {...} } depending on the
		// backend version — unwrap here so the header can read fields like
		// dateOfBirth / mrn directly.
		const patientRaw = patient.status === 'fulfilled' ? patient.value : null;
		const p = ((patientRaw?.data ?? patientRaw) as Record<string, unknown> | null);
		const conds = this._mergePending('problems', this._filterDeleted('problems', this._list(conditions)));
		const meds = this._mergePending('medications', this._filterDeleted('medications', this._list(medications)));
		// Defensively scope vitals to THIS patient, mirroring the guard the sibling
		// patient-scoped lists already apply (encounters, appointments, labs): those
		// endpoints can return cross-patient rows in some orgs, which surfaced one
		// patient's data on another's card. The vitals list was the only one left
		// unguarded. Best-effort — a vitals row that carries no patient reference is
		// kept (the endpoint is the authority), so this only drops rows explicitly
		// tagged for a different patient.
		const vit = this._filterToPatient(this._mergePending('vitals', this._filterDeleted('vitals', this._list(vitals))), patientId);
		this._lastLoadedVitals = vit;
		const encs = PatientSnapshotEditor._dedupeByAnyId(this._filterToPatient(this._mergePending('encounters', this._filterDeleted('encounters', this._list(encounters))), patientId));
		// The encounters LIST can lag a just-created / just-signed encounter (FHIR
		// indexing), so right after Sign & Lock the workflow read the visit as
		// unsigned — or, before the strict linked-only scoping, a stray same-day
		// encounter. When the appointment's linked encounter record is missing
		// from the list, fetch it directly (the by-id GET is authoritative) and
		// surface it to the workflow and the history card.
		const wfLinkedId = String(apt?.encounterId ?? '').trim();
		if (wfLinkedId && !encs.some(e => String(e.id ?? e.fhirId ?? '') === wfLinkedId)) {
			const encRaw = await this._fetch(`/api/${patientId}/encounters/${encodeURIComponent(wfLinkedId)}`);
			const rec = (encRaw?.data ?? encRaw) as Record<string, unknown> | null;
			if (rec && (rec.id !== undefined || rec.fhirId !== undefined)) { encs.unshift(rec); }
		}
		// Lab ORDERS and lab RESULTS are now two distinct, clinically-backed
		// collections (the snapshot shows each in its own card). Both come from the
		// SAME stores the clinical Labs page uses — /api/lab-order/search and
		// /api/lab-results — filtered to this patient, so a row created on either
		// page appears on the other (and on the patient chart).
		const orderRows = this._list(labOrdersRaw).filter(r => String(r.patientId ?? r.patient ?? '') === String(patientId));
		const orderList = this._mergePending('labOrders', this._filterDeleted('labOrders', orderRows));
		const resultRows = this._normalizeLabResults(this._list(labResultsRaw), patientId);
		const resultList = this._mergePending('labResults', this._filterDeleted('labResults', resultRows));
		const payList = this._mergePending('payment', this._filterDeleted('payment', this._list(payments)));
		const stmtList = this._list(statements);
		const cov = this._list(coverage);
		// Filter to THIS patient — the endpoint can return cross-patient rows, which
		// made a new patient's Visit History show other patients' appointments.
		const apptList = this._filterAppointmentsToPatient(this._list(appointments), patientId);

		// Resolve the encounter tied to TODAY's visit (by appointment link, else a
		// same-day encounter) and load its fee sheet so the Visit Pipeline card can
		// show how far along the revenue cycle this visit is.
		const todayEnc = this._todayEncounter(apt, encs);
		// Revenue-cycle key (fee-sheet lookup + payment stamping): when viewing an
		// appointment this is its LINKED encounter id ONLY — the id works even
		// when the encounter record itself isn't in the fetched list, and a stray
		// same-day encounter must never key the visit's fee sheet. The
		// today-encounter fallback applies only without an appointment context.
		const todayEncId = apt ? String(apt.encounterId ?? '').trim() : (todayEnc ? String(todayEnc.id ?? todayEnc.fhirId ?? '') : '');
		let feeSheet: Record<string, unknown> | null = null;
		// Vitals recorded in the viewed visit's encounter form (mapped to the card's
		// shape) — shown when there are no today FHIR vitals so the encounter's vitals
		// always surface in the snapshot.
		let visitVitals: Record<string, unknown> | null = null;

		// Resolve the viewed visit's encounter (synchronous) up front so its
		// encounter-form fetch can run CONCURRENTLY with the fee-sheet fetch below —
		// they hit independent endpoints, so awaiting them sequentially cost an extra
		// round-trip on every snapshot open.
		// Vitals shown on the card are scoped to the VIEWED VISIT'S DATE: the
		// encounter that belongs to THIS appointment (its linked encounter, or one
		// dated on the appointment day) — never a stray same-day-today encounter. So
		// a future appointment with no visit yet has no encounter vitals and the card
		// stays blank until vitals are actually recorded for that date.
		const apptDateRaw = String(apt?.start || apt?.startTime || '');
		const linkedEncId = String(apt?.encounterId ?? '').trim();
		const visitEnc = linkedEncId
			? encs.find(e => String(e.id ?? e.fhirId ?? '') === linkedEncId)
			: encs.find(e => this._isSameDay(e.encounterDate || e.startDate || e.start || e.date || e.periodStart, apptDateRaw));
		const visitEncId = visitEnc ? String(visitEnc.id ?? visitEnc.fhirId ?? '') : '';

		const [fsRaw, visitForm] = await Promise.all([
			todayEncId ? this._fetch(`/api/fee-sheets/encounter/${encodeURIComponent(todayEncId)}`).catch(() => null) : Promise.resolve(null),
			visitEnc && visitEncId ? this._fetch(`/api/fhir-resource/encounter-form/patient/${patientId}?encounterRef=${encodeURIComponent(visitEncId)}`).catch(() => null) : Promise.resolve(null),
		]);
		if (fsRaw) {
			const fsInner = (fsRaw?.data ?? fsRaw) as unknown;
			const fs = (Array.isArray(fsInner) ? fsInner[0] : fsInner) as Record<string, unknown> | null | undefined;
			// Treat a non-empty object carrying an id (or line items) as a real fee sheet.
			if (fs && (fs.id !== undefined || Array.isArray(fs.items) || Array.isArray(fs.lines))) { feeSheet = fs; }
		}
		if (visitEnc && visitForm) {
			const { comp } = this._extractEncounterComposition(visitForm);
			const encDate = visitEnc.encounterDate || visitEnc.startDate || visitEnc.start || visitEnc.date || visitEnc.periodStart;
			visitVitals = this._compositionVitalsRecord(comp, encDate);
		}
		if (this._currentPatientId !== patientId) { return; }

		const pipeline: VisitPipelineState = { encounter: todayEnc, feeSheet, statement: stmtList[0] ?? null, payments: payList };
		// Remember the viewed visit's encounter/fee-sheet ids so a payment collected
		// from this page is stamped with them — that link is what lets the Visit
		// Workflow's Payment step turn green from THIS visit's payment only.
		this._visitPaymentRef = todayEncId ? { encounterId: todayEncId, feeSheetId: String(feeSheet?.id ?? '').trim() } : null;
		DOM.clearNode(this.root);
		this._renderHeader(p, patientName, apt, cov);
		this._renderWorkflowBanner(apt, vit, encs, pipeline);
		this._renderGrid(p, conds, meds, vit, encs, orderList, resultList, payList, stmtList, apt, apptList, pipeline, visitVitals, apptDateRaw);
	}

	/** The encounter that belongs to today's visit: the appointment's linked
	 *  encounter if present, otherwise a same-day encounter from the chart. */
	private _todayEncounter(apt: Record<string, unknown> | null, encs: Record<string, unknown>[]): Record<string, unknown> | null {
		const linkedId = String(apt?.encounterId ?? '');
		if (linkedId) {
			// The appointment names its encounter — resolve THAT record or nothing.
			// Falling back to "any same-day encounter" here handed the pipeline a
			// stray encounter (e.g. a manually created one) whenever the linked
			// record wasn't in the fetched list, which keyed the fee-sheet lookup
			// to the wrong encounter and left Fee Sheet reading "Add charges" on a
			// signed visit whose fee sheet existed.
			return encs.find(e => String(e.id ?? e.fhirId ?? '') === linkedId) ?? null;
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
		return this._isSameDay(dateRaw, new Date());
	}

	/** True when two dates fall on the same calendar day. Used to scope the Vitals
	 *  card to the VIEWED APPOINTMENT'S date (not just today), so vitals show for
	 *  the visit's day and a future visit with none recorded stays blank. */
	private _isSameDay(dateRaw: unknown, refRaw: unknown): boolean {
		if (!dateRaw || !refRaw) { return false; }
		try {
			const d = new Date(String(dateRaw));
			const r = refRaw instanceof Date ? refRaw : new Date(String(refRaw));
			if (isNaN(d.getTime()) || isNaN(r.getTime())) { return false; }
			return d.getFullYear() === r.getFullYear() && d.getMonth() === r.getMonth() && d.getDate() === r.getDate();
		} catch { return false; }
	}

	/** Vitals recorded during today's visit only — the redesign deliberately
	 *  hides older imported readings from the "Today's Vitals" card. */
	/** Vitals recorded for the given visit date (falls back to today when the
	 *  date is missing/unparsable). The inline vitals save stamps readings with
	 *  the VIEWED APPOINTMENT'S date — so every consumer (workflow strip, prep
	 *  guard, vitals card, history split) must scope by that same date. A
	 *  today-only filter left the Record Vitals step grey after saving vitals
	 *  for a visit on any other day (QA, stage: future-dated appointment). */
	private _vitalsOnDate(vit: Record<string, unknown>[], dateRaw: string): Record<string, unknown>[] {
		const dateRef = dateRaw && !isNaN(new Date(dateRaw).getTime()) ? dateRaw : new Date();
		return vit.filter(v => this._isSameDay(v.recordedAt || v.effectiveDateTime || v.recordedDate || v.dateRecorded || v.date, dateRef));
	}

	/** Best-effort recency timestamp (ms) for a vitals reading — used to pick the
	 *  single most recent reading across the FHIR vitals store (shared with the
	 *  Patient Chart editor) and the encounter-form composition. `_lastUpdated`
	 *  reflects an EDIT (so a vital re-saved in the chart editor sorts to the top
	 *  even though its recorded date is unchanged); the recorded date is the
	 *  fallback. Returns -Infinity when no usable timestamp is present. */
	private _vitalTime(v: Record<string, unknown>): number {
		const raw = v._lastUpdated || v.recordedAt || v.effectiveDateTime || v.recordedDate || v.dateRecorded || v.date;
		const t = raw ? Date.parse(String(raw)) : NaN;
		return Number.isNaN(t) ? -Infinity : t;
	}

	/** The shared map between the FHIR vitals Observation keys and the encounter
	 *  form's `vitals_*` field keys. One per row: `[fhirKey, formKey]`. Used to
	 *  translate vitals in BOTH directions so the Snapshot's Today's Vitals card,
	 *  the encounter-history edit form and the FHIR vitals store all stay in sync. */
	private static readonly _VITALS_FIELD_MAP: ReadonlyArray<readonly [string, string]> = [
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

	/** Alternate spellings of the encounter-form vitals keys: the BACKEND
	 *  encounter-form field config keys Heart Rate / Temperature / Respiratory
	 *  Rate as `vitals_hr` / `vitals_temp` / `vitals_rr` while the Snapshot and
	 *  the local configs use the long keys (mirrors
	 *  EncounterFormEditor._mapLatestVitals). Both conventions are read and
	 *  written so an encounter saved under the short keys still surfaces as the
	 *  Snapshot's Pulse — QA saw the Encounter's Heart Rate diverge from the
	 *  Snapshot's Pulse because compositions carrying `vitals_hr` were skipped. */
	private static readonly _VITALS_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
		vitals_heart_rate: ['vitals_hr'],
		vitals_temperature: ['vitals_temp'],
		vitals_respiratory_rate: ['vitals_rr'],
		vitals_spo2: ['vitals_spo'],
	};

	/**
	 * Map an encounter-form Composition's `vitals_*` fields onto the FHIR-vitals
	 * record shape the Today's Vitals card reads (heightCm/weightKg/bpSystolic/…).
	 * This is the inverse of EncounterFormEditor._mapLatestVitals. Stamps the
	 * record with the encounter date so `_vitalsOnDate` keeps it with that visit's readings.
	 * Returns null when the composition carries no vitals at all.
	 */
	private _compositionVitalsRecord(comp: Record<string, unknown>, encDate: unknown): Record<string, unknown> | null {
		const num = (key: string): number | undefined => {
			const v = comp[key];
			if (v === undefined || v === null || String(v).trim() === '') { return undefined; }
			const n = Number(v);
			return Number.isFinite(n) ? n : undefined;
		};
		const out: Record<string, unknown> = {};
		for (const [target, src] of PatientSnapshotEditor._VITALS_FIELD_MAP) {
			let n = num(src);
			if (n === undefined) {
				for (const alias of PatientSnapshotEditor._VITALS_KEY_ALIASES[src] ?? []) {
					n = num(alias);
					if (n !== undefined) { break; }
				}
			}
			if (n !== undefined) { out[target] = n; }
		}
		if (Object.keys(out).length === 0) { return null; }
		// Stamp with the encounter date (the reading's date) and carry the
		// composition's _lastUpdated so a freshly-edited encounter ranks correctly
		// against the FHIR vitals store when picking the most recent reading. Mark
		// the source so it is never treated as an editable FHIR Observation.
		out.recordedAt = (encDate ? String(encDate) : new Date().toISOString());
		if (comp._lastUpdated) { out._lastUpdated = comp._lastUpdated; }
		out._source = 'encounter-form';
		return out;
	}

	/** Find the most-recent FHIR vitals Observation recorded for the current
	 *  patient on the given calendar day — the ONE shared per-visit-date record the
	 *  Snapshot vitals card, the Encounter form and the Patient Chart all read.
	 *  Returns the raw Observation (or null). Mirrors EncounterFormEditor._findVitalsObsOnDate. */
	private async _findVitalsObsOnDate(dateRaw: unknown): Promise<Record<string, unknown> | null> {
		const pid = this._currentPatientId;
		if (!pid || !dateRaw) { return null; }
		const ref = new Date(String(dateRaw));
		if (isNaN(ref.getTime())) { return null; }
		try {
			const raw = await this._fetch(`/api/fhir-resource/vitals/patient/${pid}?page=0&size=50`);
			const inner = (raw?.data ?? raw) as Record<string, unknown> | undefined;
			const arr = (inner?.content || inner?.list || inner?.items || (Array.isArray(inner) ? inner : Array.isArray(raw) ? raw : [])) as Array<Record<string, unknown>>;
			const onDate = arr
				// Scope to this patient — the endpoint can return cross-patient rows, and
				// upserting the wrong patient's same-date Observation would overwrite it.
				.filter(v => { const rp = this._encounterPatientId(v); return !rp || rp === String(pid); })
				.filter(v => this._isSameDay(v.recordedAt ?? v.effectiveDateTime ?? v.recordedDate ?? v.date, ref))
				.sort((a, b) => this._vitalTime(b) - this._vitalTime(a));
			return onDate[0] ?? null;
		} catch {
			return null;
		}
	}

	/** Translate a FHIR vitals Observation into the encounter form's `vitals_*`
	 *  field keys so the edit form can pre-fill from the shared vitals store. */
	private _fhirToVitalsFields(obs: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [fhirKey, formKey] of PatientSnapshotEditor._VITALS_FIELD_MAP) {
			const v = obs[fhirKey];
			if (v !== undefined && v !== null && String(v).trim() !== '') {
				out[formKey] = v;
				// Mirror onto the backend config's short spellings so a form keyed
				// vitals_hr / vitals_temp / vitals_rr pre-fills too.
				for (const alias of PatientSnapshotEditor._VITALS_KEY_ALIASES[formKey] ?? []) { out[alias] = v; }
			}
		}
		// Notes is a free-text field outside the numeric map — surface it too so an
		// edit form pre-fills the saved vitals note.
		const notesV = obs['notes'];
		if (notesV !== undefined && notesV !== null && String(notesV).trim() !== '') { out['vitals_notes'] = notesV; }
		return out;
	}

	/** Persist the encounter edit form's `vitals_*` values to the shared FHIR
	 *  vitals store, keyed by the encounter's DATE — upserting the ONE Observation
	 *  the Snapshot vitals card and the Encounter form read, so a vitals change made
	 *  while editing an encounter in the history card shows in both places (and never
	 *  spawns a divergent copy). No-op when the form carries no vitals values. */
	private async _upsertEncounterVitals(values: Record<string, string>, encounterDate: unknown): Promise<void> {
		const pid = this._currentPatientId;
		if (!pid) { return; }
		const fhir: Record<string, unknown> = {};
		for (const [fhirKey, formKey] of PatientSnapshotEditor._VITALS_FIELD_MAP) {
			if (fhirKey === 'bmi') { continue; } // derived below from height/weight
			let raw = values[formKey];
			if (raw === undefined || String(raw).trim() === '') {
				// Fall back to the backend config's short spellings (vitals_hr / …)
				// so a form keyed that way still writes to the shared store.
				for (const alias of PatientSnapshotEditor._VITALS_KEY_ALIASES[formKey] ?? []) {
					const av = values[alias];
					if (av !== undefined && String(av).trim() !== '') { raw = av; break; }
				}
			}
			if (raw === undefined || String(raw).trim() === '') { continue; }
			const n = Number(raw);
			if (Number.isFinite(n)) { fhir[fhirKey] = n; }
		}
		// Vitals notes are free text (FHIR Observation.note[0].text) — handled
		// outside the numeric map so a note entered on the Snapshot persists to the
		// shared vitals store and surfaces on the Encounter form's vitals section.
		const notesRaw = values['vitals_notes'];
		if (notesRaw !== undefined && String(notesRaw).trim() !== '') { fhir['notes'] = String(notesRaw).trim(); }
		if (Object.keys(fhir).length === 0) { return; }
		const bmi = PatientSnapshotEditor._computeBmi(fhir.heightCm, fhir.weightKg);
		if (bmi) { fhir.bmi = Number(bmi); }
		// Key the reading to the encounter's date so it upserts the same per-visit
		// record the Snapshot/Encounter form resolve by date (falls back to today).
		const dateRaw = String(values['startDate'] || '') || (encounterDate ? String(encounterDate) : '');
		const when = dateRaw && !isNaN(new Date(dateRaw).getTime()) ? new Date(dateRaw) : new Date();
		const recordedAt = when.toISOString();
		const existing = await this._findVitalsObsOnDate(recordedAt);
		const existingId = existing ? String(existing.id ?? existing.fhirId ?? '') : '';
		const body = JSON.stringify({ ...fhir, patientId: pid, recordedAt });
		const headers = { 'Content-Type': 'application/json' };
		const res = existingId
			? await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${pid}/${existingId}`, { method: 'PUT', headers, body })
			: await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${pid}`, { method: 'POST', headers, body });
		if (!res.ok) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: `Vitals could not be saved to the patient record (HTTP ${res.status}); the encounter note was still saved.`,
			});
			return;
		}
		// Overlay the saved reading so the Snapshot vitals card reflects it at once,
		// before the search index catches up (mirrors the inline vitals form).
		let saved: Record<string, unknown> | null = null;
		try {
			const j = await res.json();
			const cand = (j?.data ?? j) as Record<string, unknown> | null;
			if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
		} catch { /* non-JSON body */ }
		this._trackCreated('vitals', { ...fhir, patientId: pid, recordedAt, id: existingId || undefined, ...(saved || {}) });
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

	/** Filter the global `/api/lab-results` list to the patient on screen and map
	 *  the lab-result DTO keys onto the ones the Lab Results card / `_isLabResult`
	 *  read (`result`, `resultDate`, `collectionDate`). The DTO stores `value`,
	 *  `collectedDate` and `reportedDate`, which otherwise rendered blank. */
	private _normalizeLabResults(rows: Record<string, unknown>[], patientId: string): Record<string, unknown>[] {
		const pid = String(patientId);
		return rows
			.filter(r => String(r.patientId ?? r.patient ?? '') === pid)
			.map(r => ({
				...r,
				result: r.result ?? r.value,
				testCode: r.testCode ?? r.loincCode,
				resultDate: r.resultDate ?? r.reportedDate ?? r.collectedDate,
				collectionDate: r.collectionDate ?? r.collectedDate,
			}));
	}

	/** Keep only the appointments that belong to the patient on screen. The
	 *  `/api/appointments?patientId=` endpoint does NOT reliably filter by patient
	 *  in every org (it returned every org appointment, so a brand-new patient's
	 *  Visit History listed other patients' visits). Appointments carry a real
	 *  `patientId`, so filter client-side. Unlike {@link _filterToPatient}, there is
	 *  NO "keep all when nothing matches" valve: a patient with no matching
	 *  appointments genuinely has no visit history (e.g. a new patient), and the
	 *  appointment id format matches the snapshot's patientId (both flow from the
	 *  same `apt.patientId`), so a non-match means "not this patient", not a format
	 *  mismatch. Rows with no patient reference at all are kept (best-effort). */
	private _filterAppointmentsToPatient(appts: Record<string, unknown>[], patientId: string): Record<string, unknown>[] {
		const pid = String(patientId);
		// `_encounterPatientId` is a generic patient-reference extractor (patientId /
		// patient / subject / …) and works for appointment records too.
		return appts.filter(a => {
			const ref = this._encounterPatientId(a);
			return !ref || ref === pid;
		});
	}

	/** Slim "next action" banner pinned above the grid. It reads from the SAME
	 *  {@link _buildVisitStages} model as the Visit Workflow strip, so the two can
	 *  never disagree (they previously had separate step lists — the banner said
	 *  "Assign Room" while the strip showed Encounter/Sign as done). It names the
	 *  one next step and offers a single button that performs it. */
	private _renderWorkflowBanner(apt: Record<string, unknown> | null, vit: Record<string, unknown>[], encs: Record<string, unknown>[], st: VisitPipelineState): void {
		if (!apt) { return; }
		// Pass the telehealth flag so the banner's step COUNT matches the strip's
		// — the strip drops Record Vitals for virtual visits, so without this the
		// banner read "STEP 2 OF 10" beside a 9-step strip.
		const { stages, currentIdx } = this._buildVisitStages(apt, vit, encs, st, this._isTelehealthAppt(apt));
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
		const insName = insurance?.payerName || insurance?.payorName || insurance?.name || insurance?.coverageName || '';

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
			{ icon: 'beaker', title: 'Order Lab', onClick: () => this._openCreateModal('labOrders') },
			{ icon: 'file-symlink-file', title: 'Add Statement', onClick: () => this._openCreateModal('statements') },
			{ icon: 'file-binary', title: 'Submit Claim', onClick: () => this._openCreateModal('claims') },
		];

		// The eligibility check needs a patient, so the palette command cannot run
		// on its own — the snapshot is the surface that has one. Shown only for
		// orgs on the RCM subscription, like every other RCM entry point.
		if (this.installationsService.isInstalled(RCM_APP_SLUG)) {
			overflowItems.push({
				icon: 'verified', title: 'Verify Insurance Eligibility',
				onClick: () => this.commandService.executeCommand(
					'ciyex.rcm.verifyEligibility', this._currentPatientId, this._currentPatientName),
			});
		}
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

	/** Remember the encounter the backend auto-created for this appointment.
	 *  `PUT /api/appointments/{id}/status` answers with `encounterId` whenever the
	 *  new status triggers encounter creation (Checked-in does), and that response
	 *  is the ONLY immediately-consistent view of the link: the read-only lookup
	 *  the workflow uses before creating one goes through the FHIR search index,
	 *  which stays blind to a brand-new encounter for about a minute (measured at
	 *  60-62s on dev, stage AND production alike). Discarding the id here is what
	 *  produced the duplicate encounters — a visit checked in and then marked
	 *  Completed inside that minute found "No encounter" and POSTed a second one.
	 *  Persisting it in the session overlay carries the link across the rerender
	 *  between Check In and Completed. */
	private _captureEncounterLink(id: string, apt: Record<string, unknown> | undefined, payload: Record<string, unknown> | null): void {
		const encId = String(payload?.encounterId ?? '').trim();
		if (!encId) { return; }
		const patch: Record<string, unknown> = { encounterId: encId };
		const encPatientId = payload?.encounterPatientId;
		if (encPatientId !== undefined && encPatientId !== null && String(encPatientId) !== '') {
			patch.encounterPatientId = String(encPatientId);
		}
		this._setApptOverride(id, patch);
		if (apt) { Object.assign(apt, patch); }
	}

	/** The encounter already linked to this appointment — from the appointment
	 *  record itself, or from a link captured earlier in this session (see
	 *  {@link _captureEncounterLink}). Empty when the visit genuinely has none. */
	private _linkedEncounterId(apt: Record<string, unknown>, id: string): string {
		const direct = String(apt.encounterId ?? '').trim();
		if (direct) { return direct; }
		return String(this._apptStatusOverride.get(id)?.encounterId ?? '').trim();
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
			if (res.ok) {
				this._setApptOverride(id, { status });
				const body = await res.json().catch(() => null) as { data?: Record<string, unknown> } | null;
				this._captureEncounterLink(id, apt, body?.data ?? null);
				return true;
			}
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

	/** Whether this appointment is a Telehealth / virtual / video visit — the
	 *  single source of truth shared by the Video Call action and the Today's
	 *  Vitals card (hidden — no in-person MA to record them) so they never
	 *  disagree on what counts as Telehealth. Assign Room is NOT telehealth-
	 *  dependent: virtual visits keep the step (the provider still takes the
	 *  call from a room). */
	private _isTelehealthAppt(apt: Record<string, unknown>): boolean {
		const vt = this._apptTypeStr(apt).toLowerCase();
		return vt.includes('telehealth') || vt.includes('virtual') || vt.includes('video');
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

	/** Format a Date as a local "YYYY-MM-DDTHH:mm:ss" string (NO timezone shift),
	 *  matching how appointment start times are stored/displayed. `toISOString()`
	 *  would convert to UTC and move the clock time. */
	private _localIso(d: Date): string {
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

	/** Complete the visit: give the appointment its encounter, and only then mark
	 *  it Completed. The two always travel together and in that order — a visit
	 *  never ends up Completed with nothing documented against it, which is what
	 *  the old status-first flow left behind whenever the encounter create that
	 *  followed it failed (or the backend created none at all). */
	private async _completeAppointmentWithEncounter(apt: Record<string, unknown>): Promise<void> {
		const id = String(apt.id || apt.appointmentId || '');
		if (!id) { return; }
		const previousStatus = String(apt.status ?? apt.appointmentStatus ?? '').trim();
		const failed = () => this.notificationService.notify({
			severity: Severity.Error,
			message: 'Could not create the encounter for this visit, so it was not marked Completed. Please try again.',
		});
		// What the visit already carries, resolved BEFORE the transition: the link
		// an earlier status change captured, else the backend's read-only lookup.
		// An encounter that turns up after this point can only have come from this
		// click — which is what tells a fresh one (still needs the visit's details
		// stamped onto it) from one that was already documented.
		let encounterId = this._linkedEncounterId(apt, id) || await this._resolveAppointmentEncounterId(id);
		const linkedBefore = !!encounterId;
		let stamped = false;

		// Which side creates the encounter depends on the org's status config. When
		// the backend mints it on the Completed transition itself the two are one
		// atomic write, so the status has to go first — creating it here would race
		// that write into a duplicate, the backend's own guard being blind to a new
		// encounter for about a minute. Only when the backend will NOT create one
		// (dev's config triggers on Check-in instead) do we mint it up front.
		if (!encounterId && !await this._completedStatusMintsEncounter()) {
			encounterId = await this._createEncounterForAppointment(id, apt);
			stamped = !!encounterId;
			// The status is untouched, so the visit simply stays where it was.
			if (!encounterId) { failed(); return; }
		}

		if (!await this._updateAppointmentStatus(id, 'Completed', apt)) { return; }

		if (!encounterId) {
			// `_updateAppointmentStatus` captures the id the transition hands back,
			// so this picks up the encounter the backend just minted. One that mints
			// none at all still has to end up with one.
			encounterId = this._linkedEncounterId(apt, id);
			if (!encounterId) {
				encounterId = await this._createEncounterForAppointment(id, apt);
				stamped = !!encounterId;
			}
		}
		if (!encounterId) {
			// Put the status back so the visit is not left Completed and empty, and
			// the front desk can retry the step.
			await this._updateAppointmentStatus(id, previousStatus || 'Checked-in', apt);
			failed();
			this._rerender();
			return;
		}
		if (!linkedBefore && !stamped) { await this._stampEncounterFromAppointment(encounterId, apt); }
		this._captureEncounterLink(id, apt, { encounterId });
		if (!linkedBefore) {
			this.notificationService.notify({ severity: Severity.Info, message: 'Encounter created for this visit. The appointment is now Completed.' });
		}
		this._rerender();
	}

	/** Whether the backend creates the visit's encounter on the Completed status
	 *  transition. Orgs configure this per status in `tab_field_config`
	 *  (`triggersEncounter`), and the answer decides who creates the encounter
	 *  when a visit is completed — see {@link _completeAppointmentWithEncounter}.
	 *  Resolved once per session; an unreachable or malformed config answers `true`,
	 *  the option that can never mint a duplicate. */
	private _completedStatusMintsEncounter(): Promise<boolean> {
		this._completedMintsEncounter ??= (async () => {
			try {
				const res = await this.apiService.fetch('/api/appointments/status-options');
				if (!res.ok) { return true; }
				const data = await res.json();
				const opts = (data?.data ?? data ?? []) as Array<{ value?: string; label?: string; triggersEncounter?: boolean }>;
				const completed = opts.find(o => PatientSnapshotEditor._isCompletedStatus(o?.value ?? o?.label));
				return completed ? completed.triggersEncounter !== false : true;
			} catch { return true; }
		})();
		return this._completedMintsEncounter;
	}

	/** Visit Workflow prep steps (Check In → Assign Room → Record Vitals) still
	 *  missing for this visit. The workflow runs strictly in order, so the
	 *  appointment must not jump straight to Completed while these are pending —
	 *  doing so marked steps 2-4 done by inference and advanced the strip to
	 *  Sign & Lock without any of them ever happening (QA issue). */
	private _missingPrepSteps(apt: Record<string, unknown>): string[] {
		const status = String(apt.status || apt.appointmentStatus || '').toLowerCase();
		const missing: string[] = [];
		if (!['checked-in', 'checked in', 'arrived', 'in-room', 'with-provider'].includes(status)) { missing.push('Check In'); }
		// Assign Room applies to telehealth too — the step stays in the strip for
		// virtual visits (see _buildVisitStages), so it gates Completed the same
		// way. Only Record Vitals is dropped for telehealth (no in-person MA to
		// record them), so it must not gate Completed there.
		if (!String(apt.room || apt.roomName || '').trim()) { missing.push('Assign Room'); }
		if (!this._isTelehealthAppt(apt)) {
			if (this._vitalsOnDate(this._lastLoadedVitals, String(apt.start || apt.startTime || '')).length === 0) { missing.push('Record Vitals'); }
		}
		return missing;
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
			// Strict step order: Completed is step 5 — the prep steps before it
			// must be done first, otherwise the strip would leap to Sign & Lock.
			const missing = this._missingPrepSteps(apt);
			if (missing.length > 0) {
				await this.dialogService.info(
					'Finish the visit steps in order first',
					`Still pending: ${missing.join(' → ')}. Complete ${missing.length === 1 ? 'this step' : 'these steps'} before marking the visit Completed.`);
				return;
			}
			// Pass the appointment with its CURRENT status — the completion flow
			// restores it if the encounter cannot be created, and pre-stamping
			// "Completed" onto it would make that restore a no-op.
			await this._completeAppointmentWithEncounter(apt);
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

	/** Colors for the Medications card badge — matches DEFAULT_FIELD_CONFIGS.medications'
	 *  status options (draft/active/on-hold/stopped/completed/cancelled). */
	private static _medicationStatusColor(status: string): string {
		const s = status.toLowerCase();
		if (s === 'active') { return '#22c55e'; }
		if (s === 'on-hold' || s === 'draft') { return '#f59e0b'; }
		if (s === 'stopped' || s === 'cancelled') { return '#ef4444'; }
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
		menu.classList.add('ciyex-select-panel');
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

	/** Encounter-step click while the appointment carries no encounter link yet.
	 *  READ-ONLY: re-resolves the link via GET /appointments/{id}/encounter (the
	 *  appointment list record lags the link set at completion) and opens the
	 *  encounter it finds. Never POSTs — the encounter is created exclusively by
	 *  the Completed transition, so this click can never mint a duplicate. */
	private async _reresolveEncounterLink(apt: Record<string, unknown>, appointmentId: string): Promise<void> {
		if (!appointmentId) { return; }
		const found = await this._resolveAppointmentEncounterId(appointmentId);
		if (found) {
			apt.encounterId = found;
			this._rerender();
			void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, found, this._currentPatientName, 'Encounter', 'edit');
			return;
		}
		await this.dialogService.info(
			'No encounter for this visit yet',
			'The encounter is created automatically when the visit is marked Completed — finish the earlier steps and mark the visit Completed to create it.');
	}

	/** Fill in the visit details on an encounter that was just created for this
	 *  appointment — whether by the Completed status transition or by the create
	 *  endpoint. Both mint a bare Encounter: no patient subject (so it never
	 *  appears on the chart's Encounters tab, which searches by patient), dated
	 *  to "now" rather than to the visit, and with a blank provider. Best-effort
	 *  throughout — a failed stamp must never block completing the visit. */
	private async _stampEncounterFromAppointment(encounterId: string, apt: Record<string, unknown>, patientId?: string): Promise<void> {
		const encPatient = String(patientId || this._currentPatientId || '').trim();
		if (!encounterId || !encPatient) { return; }
		const apptStart = String(apt.start || apt.startTime || apt.scheduledStart || '').trim();
		const link: Record<string, unknown> = { id: encounterId, patientId: encPatient, patientRef: `Patient/${encPatient}` };
		// A fresh encounter is in-progress — the provider still has to document
		// and Sign & Lock it; the appointment itself is what gets marked Completed.
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
		const res = await put(full).catch(() => null);
		// If the enriched PUT was rejected (e.g. backend status enum validation),
		// still ensure the patient link lands.
		if (!res || !res.ok) { await put(link).catch(() => { /* best-effort link */ }); }
		// A provider-only PUT through the EHR endpoint does not disturb the
		// status (verified) — without it the chart and the encounter edit form
		// show a blank Provider.
		const provName = String(apt.providerName || apt.practitionerName || '').trim();
		if (provName) {
			await this.apiService.fetch(`/api/${encPatient}/encounters/${encounterId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ encounterProvider: provName }),
			}).catch(() => { /* best-effort provider stamp */ });
		}
	}

	/** POST a new FHIR encounter for this appointment and stamp the visit's
	 *  details onto it, returning its id (empty when the create failed). The
	 *  endpoint has NO dedupe — it mints another encounter on every call — so
	 *  callers must have established that the visit has none first.
	 *  {@link _completeAppointmentWithEncounter} is the only flow that creates
	 *  one, and it checks both the captured link and the backend's read-only
	 *  lookup before getting here. */
	private async _createEncounterForAppointment(id: string, apt: Record<string, unknown>): Promise<string> {
		try {
			const res = await this.apiService.fetch(`/api/appointments/${id}/encounter`, { method: 'POST' });
			if (!res.ok) { return ''; }
			const data = await res.json().catch(() => null) as Record<string, unknown> | null;
			const payload = ((data?.data ?? data) ?? {}) as Record<string, unknown>;
			const encounterId = String(payload.id ?? payload.encounterId ?? '').trim();
			if (!encounterId) { return ''; }
			const encPatient = String(payload.encounterPatientId ?? payload.patientId ?? this._currentPatientId ?? '');
			await this._stampEncounterFromAppointment(encounterId, apt, encPatient);
			// Stamp the link locally so the very next render shows the Encounter step
			// done (and unlocks Sign & Lock) even though the appointment LIST index
			// still lags and won't echo `encounterId` for a moment.
			this._captureEncounterLink(id, apt, { encounterId });
			return encounterId;
		} catch { return ''; }
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
				// Appointments are fixed 15-minute slots — Duration is shown read-only
				// (non-editable) so staff can't lengthen a visit here (QA report
				// 2026-07-11, issue 4).
				{ key: 'duration', label: 'Duration (min)', kind: 'number', readonly: true, widthPct: 50 },
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
				duration: '15',
				appointmentType: currentType === '—' ? '' : currentType,
				status: currentStatus,
				providerName: currentProvider,
				room: currentRoom,
				reason: String(apt.reason || apt.chiefComplaint || apt.reasonForVisit || apt.description || ''),
				notes: String(apt.notes || apt.note || apt.comment || ''),
			},
			onSave: async (next) => {
				// Strict step order (same guard as the inline Status dropdown): the
				// visit can only move to Completed once Check In / Assign Room /
				// Record Vitals are done. A room picked in THIS dialog counts.
				if (PatientSnapshotEditor._isCompletedStatus(next.status)
					&& !PatientSnapshotEditor._isCompletedStatus(apt.status || apt.appointmentStatus)) {
					const missing = this._missingPrepSteps({ ...apt, room: next.room || apt.room });
					if (missing.length > 0) {
						throw new Error(`Visit steps run in order — still pending: ${missing.join(' → ')}. Finish them before marking the visit Completed.`);
					}
				}
				// Appointments are fixed 15-minute slots and the Duration field is
				// read-only, so always persist 15 — this guards against any stale or
				// injected value and keeps the visit aligned to the calendar grid
				// (QA report 2026-07-11, issue 4).
				next.duration = 15;
				const startTime = next.appointmentTime ? `${next.appointmentDate}T${next.appointmentTime}:00` : startIso;
				// Resolve the new duration up front so it lands in BOTH the payload and
				// the overlay below (it was missing from the overlay, so an edited time /
				// duration showed the OLD duration — and a stale `end` made the card
				// compute the wrong length — until the search index caught up).
				const newDuration = next.duration ? Number(next.duration) : Number(apt.duration) || 0;
				// Recompute the end so a stale `end`/`endTime` from the old appointment
				// can't override the new start + duration when the card derives length.
				const startMs = Date.parse(startTime);
				const endTime = (newDuration > 0 && !Number.isNaN(startMs))
					? this._localIso(new Date(startMs + newDuration * 60000))
					: '';
				// The API persists the provider by id/reference, not by display name —
				// resolve the id so a provider CHANGE actually sticks (QA: changed
				// provider not showing).
				const provName = String(next.providerName || '');
				const provId = provName ? (this._providerIdByName.get(provName) || '') : '';
				const payload: Record<string, unknown> = {
					...apt,
					start: startTime,
					startTime,
					end: endTime || apt.end,
					endTime: endTime || apt.endTime,
					duration: newDuration || apt.duration,
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
				// still serves stale values. MUST include duration + end so the new
				// time/length render immediately (the bug: only start was overlaid).
				this._setApptOverride(id, {
					start: startTime, startTime, duration: newDuration, end: endTime, endTime, status: next.status,
					appointmentType: next.appointmentType, visitType: next.appointmentType,
					providerName: provName, practitionerName: provName, providerId: provId,
					room: next.room, reason: next.reason, notes: next.notes,
				});
				// Selecting "Completed" in the status dropdown auto-spins up the
				// visit's encounter when it doesn't have one yet — the same flow the
				// Visit Workflow's Completed step runs, so both routes leave the
				// appointment Completed only once an encounter exists.
				const wasCompleted = PatientSnapshotEditor._isCompletedStatus(apt.status || apt.appointmentStatus);
				if (PatientSnapshotEditor._isCompletedStatus(next.status) && !wasCompleted && !this._appointmentHasEncounter(apt)) {
					// `apt` is passed as it was BEFORE this edit: its status is the one
					// the flow restores if the encounter cannot be created.
					await this._completeAppointmentWithEncounter(apt);
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
		// The header pill mirrors the workflow's strict step order: an encounter
		// only counts once the visit is Completed (see _buildVisitStages) — some
		// backends link one at check-in, which showed "Encounter Created" while
		// Assign Room was still pending (QA).
		const hasEnc0 = !!(apt.encounterId) && PatientSnapshotEditor._isCompletedStatus(String(apt.status || apt.appointmentStatus || '').toLowerCase());
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
		// Mirrors the header pill's strict-order gate (hasEnc0): some backends
		// attach an encounter id at booking/check-in, but the visit's encounter
		// only exists for the workflow once the visit is Completed — an ungated
		// check here showed "Encounter: Created" on a just-booked visit (QA, stage).
		const hasEncounter = hasEnc0;
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
		const isTele = this._isTelehealthAppt(apt);

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

		// Edit appointment details (date / time / provider / reason …). Always
		// available — even on a finalized (Completed / Cancelled / No Show) visit a
		// correction may be needed (wrong provider, time, reason), and the card's
		// Status dropdown is editable in every state, so Edit Details must match.
		mkBtn('edit', 'Edit Details', () => void this._openApptEdit(apt));
		if (isTele) {
			// Pass the room/status we already hold so the command's room gate
			// ("Assign a room first") answers without a round trip.
			mkBtn('device-camera-video', 'Video Call', () => void this.commandService.executeCommand(
				'ciyex.openTelehealth', appointmentId, this._currentPatientName,
				String(apt.providerName || apt.practitionerName || ''),
				{ room: String(apt.room || apt.roomName || ''), status: String(apt.status || apt.appointmentStatus || '') },
			));
		}

		// NOTE: Check In, Assign Room and Record Vitals are NOT duplicated here —
		// they are the first front-desk steps of the Visit Workflow strip below, so
		// staff drive them from the one workflow line.

		// Destructive / correction actions — hidden once the appointment is
		// terminal (Completed / Cancelled / No Show) so the status is locked.
		if (!isTerminal) {
			mkBtn('circle-slash', 'No Show', () => void this._changeApptStatus(appointmentId, 'No Show', apt), 'danger');
			mkBtn('trash', 'Cancel', () => void this._changeApptStatus(appointmentId, 'Cancelled', apt), 'danger');
		}

		// A finalized non-telehealth appointment leaves no actions — drop the empty
		// bar so it doesn't render a stray bordered strip under the card.
		if (!bar.hasChildNodes()) { bar.remove(); }
	}

	private _renderGrid(
		_p: Record<string, unknown> | null,
		conds: Record<string, unknown>[],
		meds: Record<string, unknown>[],
		vit: Record<string, unknown>[],
		encs: Record<string, unknown>[],
		labOrders: Record<string, unknown>[],
		labResults: Record<string, unknown>[],
		payments: Record<string, unknown>[],
		statements: Record<string, unknown>[],
		apt?: Record<string, unknown> | null,
		appts: Record<string, unknown>[] = [],
		pipeline?: VisitPipelineState,
		visitVitals?: Record<string, unknown> | null,
		apptDateRaw?: string,
	): void {
		const grid = DOM.append(this.root, DOM.$('.snap-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:18px 24px;';

		// Telehealth visits have no in-person MA to record vitals — the Today's
		// Vitals card is hidden for them (see _isTelehealthAppt). The Assign
		// Room workflow step stays.
		const isTele = apt ? this._isTelehealthAppt(apt) : false;

		if (apt) {
			this._renderAppointmentCard(grid, apt);
			// ONE unified workflow strip — the former "Quick Actions" (Check In →
			// Assign Room → Record Vitals → …) and "Visit Pipeline" (… → Encounter →
			// Sign → Fee Sheet → Billing → Payment) were two overlapping step rows;
			// they are now a single end-to-end flow so staff follow one line from
			// arrival to payment.
			this._renderVisitWorkflow(grid, apt, vit, encs, pipeline ?? { encounter: this._todayEncounter(apt, encs), feeSheet: null, statement: statements[0] ?? null, payments }, isTele);
		}

		// Today's Vitals + Financials pair (recommended layout row 1)
		if (!isTele) { this._renderTodayVitalsCard(grid, vit, visitVitals, apptDateRaw); }
		this._renderFinancialsCard(grid, payments, statements);

		// Visit History (2) lists the patient's APPOINTMENTS (the visits), while
		// Encounter History (2) lists the clinical encounters — the two were
		// previously the same encounter list, which read as a duplicate. Falls
		// back to today's appointment when the history endpoint returns nothing.
		// TODAY's appointment is fetched via a separate, authoritative call
		// (_fetchTodayAppointment, with its encounterId backfilled) and can lag
		// behind the bulk `/api/appointments` list (FHIR index lag) — dropping it
		// whenever the bulk list was non-empty silently hid today's visit from
		// both cards and starved Encounter History's visit-type matching of the
		// one row it's most likely to need (QA: today's encounter kept showing
		// the raw FHIR class "Ambulatory" instead of the appointment's visit
		// type). Always include it, deduped against the bulk list by id.
		const apptIdOf = (a: Record<string, unknown>): string => String(a.id || a.appointmentId || '');
		const visitList = (apt && !appts.some(a => apptIdOf(a) === apptIdOf(apt))) ? [apt, ...appts] : appts;
		const visitCard = this._renderWideCard(grid, 'history', 'Visit History', 2, visitList.length, undefined);
		this._renderAppointmentHistoryRows(visitCard, visitList);

		const encCard = this._renderWideCard(grid, 'notebook', 'Encounter History', 2, encs.length, undefined);
		this._renderEncounterClinicalRows(encCard, encs, visitList);

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
			const status = String(m.status || '').trim();
			const badge = status ? { text: `${status.charAt(0).toUpperCase()}${status.slice(1).replace(/-/g, ' ')}`, color: PatientSnapshotEditor._medicationStatusColor(status) } : undefined;
			return { primary: String(name), secondary: [dose, freq].filter(Boolean).join(' · '), badge };
		}, () => this._openCreateModal('medications'), 'medications', 2);

		// Bottom rows: Lab Orders and Lab Results, each in its own full-width card
		// with create / edit / delete. Both read & write the clinical lab stores so
		// they stay in lock-step with the clinical Labs page and the patient chart.
		const orderCard = this._renderWideCard(grid, 'beaker', 'Lab Orders', 4, labOrders.length, () => this._openCreateModal('labOrders'));
		this._renderLabOrderRows(orderCard, labOrders);

		const resultCard = this._renderWideCard(grid, 'graph', 'Lab Results', 4, labResults.length, () => this._openCreateModal('labResults'));
		this._renderLabResultRows(resultCard, labResults);
	}

	/** The single, unified visit workflow — one continuous strip from arrival to
	 *  payment. It merges the old "Quick Actions" (Check In → Assign Room → Record
	 *  Vitals) with the revenue-cycle "Visit Pipeline" (Encounter → Sign & Lock →
	 *  Fee Sheet → Billing → Payment) so the front desk and clinical/billing steps
	 *  are one line, not two overlapping rows. Each stage shows done / next / todo /
	 *  locked state and carries a one-click action. */
	private _renderVisitWorkflow(grid: HTMLElement, apt: Record<string, unknown>, vit: Record<string, unknown>[], encs: Record<string, unknown>[], st: VisitPipelineState, isTele: boolean): void {
		const { stages, currentIdx } = this._buildVisitStages(apt, vit, encs, st, isTele);

		const card = DOM.append(grid, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span 4;';
		this._cardHeader(card, 'rocket', 'Visit Workflow', 0, undefined);

		// One-line legend so the colour coding reads at a glance for any role.
		const legend = DOM.append(card, DOM.$('div'));
		legend.textContent = currentIdx >= stages.length
			? 'All steps complete — this visit is fully processed.'
			: `Step ${currentIdx + 1} of ${stages.length}: ${stages[currentIdx].label}. Steps run in order — click the highlighted step to do it and unlock the next.`;
		legend.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin:2px 0 10px;';

		const row = DOM.append(card, DOM.$('div'));
		row.style.cssText = `display:grid;grid-template-columns:repeat(${stages.length},1fr);gap:7px;margin-top:4px;`;
		stages.forEach((s, i) => {
			// Strictly sequential: everything before the current step is done, the
			// current step is "next" (actionable), everything after is locked. This
			// is what guarantees a later step can never render done before an
			// earlier one, no matter what stray same-day/patient-level data exists.
			const state: 'done' | 'next' | 'locked' = i < currentIdx ? 'done' : i === currentIdx ? 'next' : 'locked';
			// Only the current "next" step is clickable — it PERFORMS its action,
			// the exact same handler the banner button runs, so the strip and
			// banner can never act differently. Once a step shows its green done
			// tick it locks — it is a record of what happened, not a re-openable
			// form, so it must not be editable after the fact. Every locked
			// future step stays inert too: strict order means a step the visit
			// hasn't reached yet must not be runnable early.
			const clickable = state === 'next' && !!s.action;
			const tile = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			tile.disabled = !clickable;
			tile.title = clickable ? `${s.label} — ${s.sub}` : s.label;
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
				tile.addEventListener('mouseenter', () => { tile.style.background = 'var(--vscode-button-hoverBackground,#1177bb)'; });
				tile.addEventListener('mouseleave', () => { tile.style.background = 'var(--vscode-button-background,#0e639c)'; });
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
	 *  Scheduled → Check In → Assign Room → Record Vitals → Completed → Encounter →
	 *  Sign & Lock → Fee Sheet → Billing → Payment, exactly the order the clinic
	 *  works the visit. */
	private _buildVisitStages(apt: Record<string, unknown>, vit: Record<string, unknown>[], encs: Record<string, unknown>[], st: VisitPipelineState, isTele: boolean = false): { stages: VisitStage[]; currentIdx: number } {
		const appointmentId = String(apt.id || apt.appointmentId || this._lastRenderArgs?.appointmentId || '');
		const apptStatus = String(apt.status || apt.appointmentStatus || '').toLowerCase();
		const startRaw = String(apt.start || apt.startTime || '');

		const completed = PatientSnapshotEditor._isCompletedStatus(apptStatus);
		// The encounter belongs to this visit ONLY when it is linked to the
		// appointment (apt.encounterId) — set when the visit is marked Completed
		// and the encounter is auto-created. We never fall back to "any same-day
		// encounter": that cross-contamination is exactly what showed Sign & Lock /
		// Fee Sheet as done for a visit that had not reached them.
		//
		// STRICT ORDER: the workflow only acknowledges the link once the visit is
		// Completed. Some backends attach/create an encounter as early as
		// check-in, which made step 6 show "Created" while step 3 (Assign Room)
		// was still the next action (QA). Steps run in order — before Completed,
		// the Encounter step must read as pending regardless of backend links.
		const linkedEncId = completed ? String(apt.encounterId ?? '').trim() : '';
		const enc = linkedEncId ? (encs.find(e => String(e.id ?? e.fhirId ?? '') === linkedEncId) ?? st.encounter) : null;
		const encId = linkedEncId;
		const encStatus = String(enc?.status ?? '').toLowerCase();
		// Name the visit by the APPOINTMENT's visit type ("Follow-Up",
		// "Consultation"…) — that name travels into the encounter editor and the
		// fee-sheet title. The encounter's own `type` is the FHIR class code
		// ("AMB"), which QA rejected as a heading (27-Jul).
		const apptType = this._apptTypeStr(apt);
		const encName = (apptType && apptType !== '—')
			? apptType
			: (enc ? `${enc.type || enc.serviceType || 'Encounter'}`.trim() : 'Encounter');

		const hasEncounter = !!linkedEncId;
		const signed = ['signed', 'finished', 'complete', 'completed', 'locked'].includes(encStatus);
		// Front-desk prep steps. A completed visit is by definition past this phase,
		// so each counts as done once the visit is Completed even if the field was
		// never filled — that keeps the strip from showing "next: Assign Room" on a
		// finished visit while still prompting the front desk before completion.
		const checkedIn = ['checked-in', 'checked in', 'arrived', 'in-room', 'with-provider', 'completed', 'fulfilled', 'finished'].includes(apptStatus) || completed;
		const room = String(apt.room || apt.roomName || '').trim();
		const roomAssigned = !!room || completed;
		const vitalsRecorded = this._vitalsOnDate(vit, startRaw).length > 0;
		const vitalsDone = vitalsRecorded || completed;
		const hasFeeSheet = !!st.feeSheet;
		// Billing turns done ONLY when THIS visit's fee sheet was actually sent to
		// billing — the fee-sheet "Send to Billing" action sets billingStatus
		// 'Unbilled' → 'Billed' (→ 'Paid' once cleared). It previously keyed off
		// `feeSheet.billed`/`feeSheet.status` (fields that don't exist on the
		// record) and fell back to ANY patient-level statement, so Billing and
		// Payment lit green the moment the encounter was signed (QA).
		const fsBillingStatus = String(st.feeSheet?.billingStatus ?? '').toLowerCase();
		const billed = hasFeeSheet && (fsBillingStatus === 'billed' || fsBillingStatus === 'paid');
		// Payment turns done ONLY from THIS visit's money: the fee sheet marked
		// Paid / fully covered, or a non-failed payment transaction tied to this
		// encounter or fee sheet (the Payments dashboard and the snapshot collect
		// stamp encounterId/feeSheetId; description carries "Encounter {id}" as a
		// fallback for backends that drop the link fields). Never from a stray
		// same-day patient payment or a patient-level statement balance.
		const feeSheetId = String(st.feeSheet?.id ?? '').trim();
		const fsTotal = Number(st.feeSheet?.total ?? NaN);
		const fsTotalPaid = Number(st.feeSheet?.totalPaid ?? NaN);
		const fsPaymentStatus = String(st.feeSheet?.paymentStatus ?? '').toLowerCase();
		const visitPayment = st.payments.some(p => {
			const pStatus = String(p.status ?? '').toLowerCase();
			if (['failed', 'refunded', 'cancelled', 'voided'].includes(pStatus)) { return false; }
			if (encId && String(p.encounterId ?? '') === encId) { return true; }
			if (feeSheetId && String(p.feeSheetId ?? '') === feeSheetId) { return true; }
			const text = `${p.description ?? ''} ${p.notes ?? ''}`;
			return !!encId && new RegExp(`Encounter\\s+${encId}(?:\\D|$)`).test(text);
		});
		const paid = billed && (fsPaymentStatus === 'paid' || (fsTotal > 0 && fsTotalPaid >= fsTotal) || visitPayment);

		let whenStr = 'Booked';
		if (startRaw) { try { whenStr = new Date(startRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { /* keep default */ } }

		const openEncounter = (mode: 'edit' | 'signoff') => encId
			? () => void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, encId, this._currentPatientName, encName, mode)
			: undefined;
		const openFeeSheet = encId
			? () => void this.commandService.executeCommand('ciyex.openFeeSheet', encId, this._currentPatientId, this._currentPatientName, encName)
			: undefined;

		let stages: VisitStage[] = [
			{
				key: 'scheduled', label: 'Scheduled', role: 'Front desk', icon: 'calendar', done: true,
				sub: whenStr, doneSub: whenStr, action: () => void this._openApptEdit(apt),
			},
			{
				key: 'checkin', label: 'Check In', role: 'Front desk', icon: 'sign-in', done: checkedIn,
				sub: 'Patient arrives', doneSub: 'Checked in',
				action: () => void this._changeApptStatus(appointmentId, 'Checked-in', apt),
			},
			{
				key: 'room', label: 'Assign Room', role: 'Front desk', icon: 'home', done: roomAssigned,
				sub: 'Assign room', doneSub: room || 'Room set',
				action: () => void this._openRoomPicker(appointmentId, room),
			},
			{
				key: 'vitals', label: 'Record Vitals', role: 'Medical staff', icon: 'pulse', done: vitalsDone,
				sub: 'Height, BP, …', doneSub: vitalsRecorded ? 'Vitals in' : 'Skipped',
				action: () => this._focusVitalsEntry(),
			},
			{
				key: 'completed', label: 'Completed', role: 'Front desk', icon: 'check', done: completed,
				// Marking Completed auto-creates + links the encounter (single-action
				// rule).
				sub: 'Mark complete', doneSub: 'Visit complete',
				action: () => void this._applyStatusSelection(apt, appointmentId, 'Completed'),
			},
			{
				key: 'encounter', label: 'Encounter', role: 'Provider', icon: 'note', done: hasEncounter,
				sub: 'Auto on complete', doneSub: 'Created',
				// The encounter is created ONLY by the Completed transition — a click
				// must never POST one (the backend create has no dedupe, so a click-to-
				// create would mint duplicates); re-resolve the link read-only instead
				// (the list record lags the link). Once linked the step is done and
				// locks, so this branch only ever runs pre-link.
				action: () => void this._reresolveEncounterLink(apt, appointmentId),
			},
			{
				key: 'sign', label: 'Sign & Lock', role: 'Provider', icon: 'verified', done: signed,
				// Codes are documented inside the encounter before signing.
				sub: 'Codes & sign', doneSub: 'Signed',
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
		// Telehealth visits keep Assign Room — the virtual visit still runs out of
		// a room (the provider's consult / video room), and staff reported the
		// step simply missing from the strip. Only Record Vitals is dropped
		// (no in-person MA to take them). Dropping is a real filter, not a
		// CSS hide, so the strip's grid columns and step numbering stay
		// contiguous; currentIdx is recomputed against the filtered list.
		if (isTele) { stages = stages.filter(s => s.key !== 'vitals'); }
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

	private _renderEncounterClinicalRows(card: HTMLElement, encsInput: Record<string, unknown>[], appts: Record<string, unknown>[]): void {
		// Visit types keyed by linked encounter id — the Encounter History rows
		// show the APPOINTMENT's visit type (Consultation, Follow-Up, …) when the
		// encounter came from a visit, not the FHIR encounter class
		// ("Ambulatory") (QA 22-Jul). Encounters with no linked appointment fall
		// back to their own type fields below.
		const apptTypeByEncId = new Map<string, string>();
		// Same-day fallback, keyed by calendar date — the bulk appointment LIST
		// fetch often lacks `encounterId` per row (it lags the FHIR index; only
		// the SINGLE "today" appointment gets an authoritative backfill via
		// _resolveAppointmentEncounterId), so the by-id map above frequently
		// misses and rows fell back to the raw FHIR class ("Ambulatory") even
		// though the visit's real type was known (QA: "encounter history is
		// again showing the wrong visit type"). A same-day match is the same
		// heuristic already used elsewhere on this page (visitEnc lookup) and
		// the Patient Chart's Encounters tab.
		const apptTypeByDateKey = new Map<string, string>();
		for (const a of appts) {
			const encId = String(a.encounterId || '');
			const t = this._apptTypeStr(a);
			if (!t || t === '—') { continue; }
			if (encId && !apptTypeByEncId.has(encId)) { apptTypeByEncId.set(encId, t); }
			const dRaw = a.start || a.startTime || a.appointmentStartDate || a.date;
			if (dRaw) {
				const d = new Date(String(dRaw));
				if (!isNaN(d.getTime())) {
					const key = d.toDateString();
					if (!apptTypeByDateKey.has(key)) { apptTypeByDateKey.set(key, t); }
				}
			}
		}
		// Show the most recent encounter first, then older ones (QA: Encounter
		// History should list latest → oldest). Read the date from any of the keys
		// an encounter row can carry; rows with no parseable date sort to the bottom.
		const encDateMs = (e: Record<string, unknown>): number => {
			const raw = e.encounterDate || e.startDate || e.start || e.date || e.periodStart || e.createdAt || '';
			const t = raw ? new Date(String(raw)).getTime() : NaN;
			return isNaN(t) ? -Infinity : t;
		};
		const encs = PatientSnapshotEditor._dedupeByAnyId(encsInput).sort((a, b) => encDateMs(b) - encDateMs(a));
		if (encs.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No encounters found';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		// Columns: Date · Visit Type · Action. The action reflects edit-ability — a
		// signed/locked encounter shows a lock + View (read-only), an unsigned one
		// shows Edit — so the column is sized to content.
		table.style.cssText = 'display:grid;grid-template-columns:110px 1fr auto;gap:0;';
		for (const lbl of ['Date', 'Visit Type', '']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		// Coerce a visit-type value (a string or a FHIR CodeableConcept) to its
		// display text.
		const typeText = (v: unknown): string => {
			if (!v) { return ''; }
			if (typeof v === 'string') { return v; }
			if (Array.isArray(v)) { return v.map(typeText).filter(Boolean).join(', '); }
			if (typeof v === 'object') {
				const o = v as Record<string, unknown>;
				const coding = Array.isArray(o.coding) ? (o.coding[0] as Record<string, unknown> | undefined) : undefined;
				return String(o.text || o.display || coding?.display || coding?.code || '');
			}
			return '';
		};
		const { page, pageIdx, pageCount, total } = this._paginate('encounter-clinical', encs);
		for (const enc of page) {
			const dateRaw = enc.encounterDate || enc.startDate || enc.start || enc.date || enc.periodStart || enc.createdAt || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const encRowId = String(enc.id || enc.encounterId || enc.fhirId || '');
			const encDateKey = dateRaw ? (d => isNaN(d.getTime()) ? '' : d.toDateString())(new Date(String(dateRaw))) : '';
			const rawVisitType = apptTypeByEncId.get(encRowId)
				|| (encDateKey ? apptTypeByDateKey.get(encDateKey) : undefined)
				|| typeText(enc.visitType) || typeText(enc.appointmentType) || typeText(enc.type)
				|| typeText(enc.serviceType) || typeText(enc.encounterType) || typeText(enc.visitCategory) || typeText(enc.class) || 'Encounter';
			// Expand short FHIR class codes ("AMB"/"VR") to their full form
			// ("Ambulatory"/"Virtual"); already-full values pass through unchanged.
			const visitType = expandEncounterType(rawVisitType) || rawVisitType;
			const isSigned = PatientSnapshotEditor._normalizeEncounterStatus(enc.status) === 'SIGNED';

			const dateCell = DOM.append(table, DOM.$('div'));
			dateCell.textContent = dateStr;
			dateCell.style.cssText = 'padding:6px 8px 6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;color:var(--vscode-editor-foreground);white-space:nowrap;';

			const typeCell = DOM.append(table, DOM.$('div'));
			typeCell.textContent = String(visitType).slice(0, 120);
			typeCell.style.cssText = 'padding:6px 8px 6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;color:var(--vscode-editor-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			// Action reflects whether the encounter can still be edited. A SIGNED
			// (finalized / locked) encounter is read-only: show a lock indicator plus
			// a "View" action that opens the read-only Visit Summary slide-over
			// (with Download PDF / Print), matching the appointment "Visit Summary"
			// action — not the encounter editor. An UNSIGNED encounter is still open:
			// show an "Edit" action routed through `ciyex.openEncounter`.
			const actionCell = DOM.append(table, DOM.$('div'));
			actionCell.style.cssText = 'padding:4px 0 4px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;justify-content:flex-end;gap:6px;';
			if (isSigned) {
				const lockIco = DOM.append(actionCell, DOM.$('span.codicon.codicon-lock')) as HTMLElement;
				lockIco.title = 'Signed & locked';
				lockIco.setAttribute('aria-label', 'Signed and locked');
				lockIco.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
			}
			const actBtn = DOM.append(actionCell, DOM.$('button')) as HTMLButtonElement;
			actBtn.title = isSigned ? 'View visit summary' : 'Edit encounter';
			actBtn.setAttribute('aria-label', actBtn.title);
			actBtn.disabled = !encRowId;
			actBtn.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:3px 9px;background:transparent;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:${encRowId ? 'pointer' : 'default'};color:var(--vscode-foreground);font-size:11px;opacity:${encRowId ? '1' : '0.5'};`;
			const actIco = DOM.append(actBtn, DOM.$(isSigned ? 'span.codicon.codicon-eye' : 'span.codicon.codicon-edit')) as HTMLElement;
			actIco.style.cssText = 'font-size:12px;';
			const actLbl = DOM.append(actBtn, DOM.$('span'));
			actLbl.textContent = isSigned ? 'View' : 'Edit';
			if (encRowId) {
				actBtn.addEventListener('mouseenter', () => { actBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; });
				actBtn.addEventListener('mouseleave', () => { actBtn.style.background = 'transparent'; });
				actBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					if (isSigned) {
						// Signed & locked → open the read-only Visit Summary panel
						// (Download PDF / Print), same as the appointment action.
						showVisitSummaryPanel(
							{ apiService: this.apiService, themeService: this.themeService, notificationService: this.notificationService, nativeHostService: this.nativeHostService },
							this._currentPatientId, encRowId, this._currentPatientName || 'Patient');
						return;
					}
					void this.commandService.executeCommand('ciyex.openEncounter', this._currentPatientId, encRowId, this._currentPatientName || 'Patient', `Encounter ${dateStr}`);
				});
			}
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
	 * Append hover-reveal Edit + Delete icons to a dashboard card row. Keeps
	 * the row compact in its idle state and only surfaces actions when the
	 * user hovers/focuses.
	 */
	private _attachRowActions(rowEl: HTMLElement, entity: string, item: Record<string, unknown>, opts?: { canEdit?: boolean; lockReason?: string }): void {
		const locked = opts?.canEdit === false;
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

		// Locked rows (e.g. a refunded / voided payment, which the backend refuses
		// to update — it 400s "Cannot update transaction with status: …") show a
		// lock glyph in place of the edit pencil so users aren't offered a doomed
		// edit. Delete stays available for correcting a mistaken row. Mirrors the
		// signed-encounter lock in `_renderGridRowActions`.
		if (locked) {
			const lock = DOM.append(actions, DOM.$('span.codicon.codicon-lock'));
			(lock as HTMLElement).style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--vscode-descriptionForeground);';
			(lock as HTMLElement).title = opts?.lockReason || 'Locked — read only';
		} else {
			mkBtn('edit', 'Edit', () => void this._openEditModal(entity, item));
		}
		mkBtn('trash', 'Delete', () => { void this._deleteItem(entity, item); });

		// Rows are deliberately NOT click-to-edit: the edit modal must only open
		// from the explicit pencil button (tester request — clicking a Problems/
		// Medications record used to jump straight into the edit drawer). This
		// also matches the other snapshot cards (labs, encounters, visits),
		// which are button-only.
		rowEl.style.cursor = 'default';
		rowEl.addEventListener('mouseenter', () => {
			actions.style.opacity = '1';
			rowEl.style.background = 'var(--vscode-list-hoverBackground,rgba(128,128,128,0.08))';
		});
		rowEl.addEventListener('mouseleave', () => {
			actions.style.opacity = '0';
			rowEl.style.background = '';
		});
	}

	// Vital signs captured by the inline entry form. Keys match the backend
	// FHIR vitals resource exactly (verified against the chart editor's
	// DEFAULT_FIELD_CONFIGS['vitals']). 'bp' is split into systolic/diastolic
	// on save.
	// Field order matches the Patient Chart's Vitals list columns (patientChartEditor.ts
	// DEFAULT_FIELD_CONFIGS['vitals']): BP Systolic, BP Diastolic, Pulse, Respiration,
	// Temp, SpO2, Weight, Height — so the two surfaces no longer drift apart. 'pulse' is
	// labelled "Heart Rate" here (the encounter/web-app name) — it's the same value the
	// encounter's vitals_heart_rate maps to via _VITALS_FIELD_MAP.
	private static readonly _VITAL_INPUTS: Array<{ key: string; label: string; unit: string; step?: string }> = [
		{ key: 'bpSystolic', label: 'BP Systolic', unit: 'mmHg' },
		{ key: 'bpDiastolic', label: 'BP Diastolic', unit: 'mmHg' },
		{ key: 'pulse', label: 'Heart Rate', unit: '/min' },
		{ key: 'respiration', label: 'Respiratory Rate', unit: '/min' },
		// allow-any-unicode-next-line
		{ key: 'temperatureC', label: 'Temperature', unit: '°F', step: '0.1' },
		{ key: 'oxygenSaturation', label: 'SpO2', unit: '%' },
		{ key: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1' },
		{ key: 'heightCm', label: 'Height', unit: 'cm', step: '0.1' },
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
	/** The viewed appointment's date — inline vitals are recorded for THIS date and
	 *  upsert the shared per-date FHIR Observation (so they sync with the Encounter
	 *  and Chart editor for that visit instead of creating a divergent copy). */
	private _currentApptDateRaw: string = '';

	/** Vitals for the VIEWED APPOINTMENT'S date only — vitals recorded for that
	 *  visit's day (via the Snapshot inline form, the Encounter, or the Patient
	 *  Chart editor) show; otherwise the card is blank with an inline entry form.
	 *  So a future appointment with nothing recorded for its date stays blank. */
	private _renderTodayVitalsCard(parent: HTMLElement, vit: Record<string, unknown>[], visitVitals?: Record<string, unknown> | null, apptDateRaw?: string): void {
		this._currentApptDateRaw = apptDateRaw && !isNaN(new Date(apptDateRaw).getTime()) ? apptDateRaw : '';
		const card = DOM.append(parent, DOM.$('.snap-card.snap-vitals-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;min-height:140px;display:flex;flex-direction:column;grid-column:span 2;';
		this._vitalsCardEl = card;

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:320px;';

		// Scope to the VIEWED APPOINTMENT'S date: FHIR vitals recorded on that day
		// (from the Snapshot inline form or the Patient Chart editor — same store)
		// plus this visit's own encounter-form vitals. Whichever was recorded last
		// for that date shows; if nothing was recorded for the date, the card stays
		// blank (so a future appointment with no visit yet shows no vitals). With no
		// appointment date, fall back to today.
		const dateVitals = this._vitalsOnDate(vit, apptDateRaw ?? '');
		const candidates = [...dateVitals, ...(visitVitals ? [visitVitals] : [])];
		candidates.sort((a, b) => this._vitalTime(b) - this._vitalTime(a));
		const latest = (candidates[0] ?? undefined) as Record<string, unknown> | undefined;
		// No (+) "Add Vitals" header button — vitals are recorded/updated via the
		// inline entry form (the "Edit" link below, or the standalone form when no
		// reading exists), so the header (+) was a redundant duplicate entry point.
		this._cardHeader(card, 'heart', 'Vitals', latest ? 1 : 0, undefined);
		if (!latest) {
			const msg = DOM.append(body, DOM.$('div'));
			msg.textContent = 'No vitals recorded for this visit — enter below:';
			msg.style.cssText = 'font-size:12.5px;color:var(--vscode-descriptionForeground);font-weight:500;margin-bottom:8px;';
			const firstInput = this._renderInlineVitalsForm(body);
			this._revealVitalsEntry = () => firstInput?.focus();
			this._renderVitalsHistoryLink(body, vit);
			return;
		}

		const bpVal = (latest.bpSystolic && latest.bpDiastolic) ? `${latest.bpSystolic}/${latest.bpDiastolic}` : '';
		const bmiVal = PatientSnapshotEditor._computeBmi(latest.heightCm, latest.weightKg);
		// Order + labels mirror the encounter form's Vitals section so the Snapshot's
		// Today's Vitals card reads like the encounter page (BP, Heart Rate,
		// Temperature, SpO2, Respiratory Rate, Weight, Height, BMI). 'Pulse' shows as
		// "Heart Rate" — same value, unified naming (see _VITAL_INPUTS).
		const vitalRows: Array<[string, unknown, string?]> = [
			['BP', bpVal, 'mmHg'],
			['Heart Rate', latest.pulse, '/min'],
			// allow-any-unicode-next-line
			['Temperature', latest.temperatureC, '°F'],
			['SpO2', latest.oxygenSaturation, '%'],
			['Respiratory Rate', latest.respiration, '/min'],
			['Weight', latest.weightKg, 'kg'],
			['Height', latest.heightCm, 'cm'],
			// allow-any-unicode-next-line
			['BMI', bmiVal, bmiVal ? 'kg/m²' : ''],
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
		// Chromium only drops the native up/down spin-button control on
		// <input type="number"> via its ::-webkit-*-spin-button pseudo-elements
		// (appearance:textfield on the input itself only covers Firefox) — it
		// otherwise read as a stray per-field "Adjust" control on every vital
		// (QA). The field stays a real number input; only the spinner glyph
		// goes.
		const noSpinStyle = DOM.append(formGrid, DOM.$('style'));
		noSpinStyle.textContent = '.ciyex-vital-num-input::-webkit-inner-spin-button,.ciyex-vital-num-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}';
		for (const f of PatientSnapshotEditor._VITAL_INPUTS) {
			const cell = DOM.append(formGrid, DOM.$('div'));
			cell.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
			const l = DOM.append(cell, DOM.$('label'));
			l.textContent = `${f.label} (${f.unit})`;
			l.style.cssText = 'font-size:9.5px;color:var(--vscode-descriptionForeground);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;';
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = 'number';
			inp.classList.add('ciyex-vital-num-input');
			if (f.step) { inp.step = f.step; }
			inp.placeholder = '—';
			// Prefill with today's value so the user edits rather than re-keys.
			const seed = initial ? initial[f.key] : undefined;
			if (seed !== undefined && seed !== null && String(seed) !== '') { inp.value = String(seed); }
			inp.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 9px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-editorWidget-border));border-radius:6px;font-size:13px;font-weight:600;outline:none;appearance:textfield;-moz-appearance:textfield;';
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

	/** Record vitals for the viewed visit. UPSERTS the ONE shared FHIR vitals
	 *  Observation for the appointment's DATE — updating an existing same-date
	 *  reading rather than POSTing a duplicate — so the value is the same record the
	 *  Encounter and Patient Chart editor read/write for that visit. Falls back to
	 *  today when no appointment date is known. */
	private async _saveInlineVitals(payload: Record<string, unknown>): Promise<void> {
		const pid = this._currentPatientId;
		if (!pid) { throw new Error('No patient.'); }
		// Record on the viewed appointment's date so the reading belongs to that
		// visit (not just "now"); the Encounter/Chart editor key vitals by this date.
		const dateRaw = this._currentApptDateRaw && !isNaN(new Date(this._currentApptDateRaw).getTime()) ? this._currentApptDateRaw : '';
		const recordedAt = dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString();
		// Find an existing Observation for that date to update (avoids duplicates and
		// keeps all three pages on one record).
		let existingId = '';
		try {
			const listRaw = await this._fetch(`/api/fhir-resource/vitals/patient/${pid}?page=0&size=50`);
			const inner = (listRaw?.data ?? listRaw) as Record<string, unknown> | undefined;
			const arr = (inner?.content || inner?.list || inner?.items || (Array.isArray(inner) ? inner : Array.isArray(listRaw) ? listRaw : [])) as Record<string, unknown>[];
			const onDate = arr
				// Scope to this patient — the endpoint can return cross-patient rows, so a
				// same-date reading from another patient must not be picked up and updated.
				.filter(v => { const rp = this._encounterPatientId(v); return !rp || rp === String(pid); })
				.filter(v => this._isSameDay(v.recordedAt || v.effectiveDateTime || v.recordedDate || v.date, recordedAt))
				.sort((a, b) => this._vitalTime(b) - this._vitalTime(a));
			if (onDate[0]) { existingId = String(onDate[0].id ?? onDate[0].fhirId ?? ''); }
		} catch { /* no existing reading — create one */ }
		const body = { ...payload, patientId: pid, recordedAt };
		const res = existingId
			? await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${pid}/${existingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
			: await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${pid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		if (!res.ok) { throw new Error(`Save failed (${res.status})`); }
		let saved: Record<string, unknown> | null = null;
		try {
			const j = await res.json();
			const cand = (j?.data ?? j) as Record<string, unknown> | null;
			if (cand && typeof cand === 'object' && !Array.isArray(cand)) { saved = cand; }
		} catch { /* non-JSON body */ }
		this._trackCreated('vitals', { ...body, id: existingId || undefined, ...(saved || {}) });
	}

	/** "View historical vitals" link — older readings live in a popup so they
	 *  don't clutter the today's-visit view. */
	private _renderVitalsHistoryLink(body: HTMLElement, vit: Record<string, unknown>[]): void {
		const visitIds = new Set(this._vitalsOnDate(vit, this._currentApptDateRaw).map(v => String(v.id ?? v.fhirId ?? '')));
		const history = vit.filter(v => !visitIds.has(String(v.id ?? v.fhirId ?? '')));
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
				// Refunded / voided transactions are immutable server-side, so offer a
				// read-only lock instead of an edit pencil that would 400 on save.
				const payEditable = !['refunded', 'voided'].includes(String(pay.status || '').toLowerCase());
				this._attachRowActions(r, 'payment', pay, payEditable ? undefined : { canEdit: false, lockReason: `${status || 'This'} payment is locked — read only` });
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
				{ key: 'billingAddressLine1', label: ADDRESS_LABELS.addressLine1, kind: 'text', placeholder: ADDRESS_PLACEHOLDERS.addressLine1, widthPct: 100 },
				{ key: 'billingAddressLine2', label: ADDRESS_LABELS.addressLine2, kind: 'text', placeholder: ADDRESS_PLACEHOLDERS.addressLine2, widthPct: 100 },
				{ key: 'billingCity', label: 'City', kind: 'text', placeholder: 'New York', widthPct: 50, typingPattern: '[A-Za-z ]', validationPattern: '^[A-Za-z ]+$', validationMessage: 'City may only contain letters and spaces.' },
				{ key: 'billingState', label: 'State', kind: 'text', placeholder: 'NY', widthPct: 50, typingPattern: '[A-Za-z ]', validationPattern: '^[A-Za-z ]+$', validationMessage: 'State may only contain letters and spaces.' },
				{ key: 'billingZip', label: 'Zip Code', kind: 'text', placeholder: '10001', widthPct: 50, typingPattern: '[0-9]', validationPattern: '^\\d{5}$', validationMessage: 'Zip Code must be exactly 5 digits (e.g. 10001).' },
				{ key: 'billingCountry', label: 'Country', kind: 'text', placeholder: 'USA', widthPct: 50 },
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
				// Billing ZIP is numeric-only (US 5-digit). The field-level
				// typingPattern/validationPattern blocks letters as typed, but guard
				// here too so a bypassed/pasted non-numeric value can't reach the
				// backend and get stored as invalid data.
				const zip = String(next.billingZip || '').trim();
				if (zip && !/^\d{5}$/.test(zip)) { throw new Error('Zip Code must be exactly 5 digits (e.g. 10001).'); }
				const payload: Record<string, unknown> = {
					patientId: this._currentPatientId,
					cardHolderName: String(next.cardHolderName).trim(),
					cardNumber: num,
					cvv,
					cardType: next.cardType || 'VISA',
					expiryMonth: Number(next.expiryMonth),
					expiryYear: Number(next.expiryYear),
					billingAddressLine1: String(next.billingAddressLine1 || '').trim() || undefined,
					billingAddressLine2: String(next.billingAddressLine2 || '').trim() || undefined,
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

	private _renderWideCard(parent: HTMLElement, icon: string, title: string, cols: number, count: number, onAdd?: () => void): HTMLElement {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = `background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span ${cols};`;
		this._cardHeader(card, icon, title, count, onAdd);
		return card;
	}

	/** Visit History rows — the patient's APPOINTMENTS (not encounters). Each row
	 *  shows the visit date, type and appointment status, plus whether an
	 *  encounter is linked. The action opens that visit's encounter when
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
		table.style.cssText = 'display:grid;grid-template-columns:120px 1fr 90px 78px 56px;gap:0;';
		// "Visit Type" (not "Type") — matches the appointment form's field label
		// and the Encounter History card next to it (QA 22-Jul).
		for (const lbl of ['Date', 'Visit Type', 'Status', 'Encounter', '']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		const { page, pageIdx, pageCount, total } = this._paginate('appointments', sorted);
		for (const a of page) {
			const dateRaw = a.start || a.startTime || a.appointmentStartDate || a.date || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const type = this._apptTypeStr(a);
			const statusRaw = String(a.status || a.appointmentStatus || '').trim();
			const status = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1) : 'Unknown';
			const sColor = PatientSnapshotEditor._statusColor(status);
			// "Linked" mirrors the workflow's strict order: the encounter is only
			// acknowledged once the visit is Completed (QA: history showed
			// "Linked" while the visit was merely Checked-in).
			const encId = PatientSnapshotEditor._isCompletedStatus(statusRaw.toLowerCase()) ? String(a.encounterId || '') : '';
			const cells: Array<{ txt: string; kind?: 'status' | 'enc' }> = [
				{ txt: dateStr },
				{ txt: type },
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
	private _renderGridRowActions(table: HTMLElement, entity: string, item: Record<string, unknown>, opts?: { canEdit?: boolean; lockReason?: string; hideDelete?: boolean; onView?: () => void }): void {
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

		// Read-only rows (e.g. a signed/locked encounter) show a lock glyph in place
		// of the edit pencil — the backend rejects edits, so offering one only leads
		// to a failed save. A signed encounter still offers View so the record can
		// be read; delete is suppressed entirely where the caller asks for it.
		if (opts && opts.canEdit === false) {
			const lock = DOM.append(cell, DOM.$('span.codicon.codicon-lock'));
			(lock as HTMLElement).style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);width:22px;height:22px;display:flex;align-items:center;justify-content:center;';
			(lock as HTMLElement).title = opts.lockReason || 'Locked — read only';
			if (opts.onView) {
				mkBtn('eye', 'View', opts.onView);
			}
		} else {
			mkBtn('edit', 'Edit', () => void this._openEditModal(entity, item));
		}
		if (!opts?.hideDelete) {
			mkBtn('trash', 'Delete', () => { void this._deleteItem(entity, item); });
		}
	}

	private _renderLabOrderRows(card: HTMLElement, orders: Record<string, unknown>[]): void {
		this._renderLabTable(card, 'labOrders', orders, 'No lab orders');
	}

	private _renderLabResultRows(card: HTMLElement, results: Record<string, unknown>[]): void {
		this._renderLabTable(card, 'labResults', results, 'No lab results found');
	}

	/**
	 * Render a Lab Orders / Lab Results table straight from the entity registry's
	 * column definitions, with per-row Edit / Delete actions wired to the same
	 * clinical-store CRUD the cards' "+" buttons use. Driving both off the shared
	 * `_ENTITY_REGISTRY[entity].columns` keeps the dashboard rows and the records
	 * popup showing the SAME columns (one source of truth).
	 */
	private _renderLabTable(card: HTMLElement, entity: 'labOrders' | 'labResults', rows: Record<string, unknown>[], emptyText: string): void {
		if (rows.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = emptyText;
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		const cols = PatientSnapshotEditor._ENTITY_REGISTRY[entity].columns;
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		table.style.cssText = `display:grid;grid-template-columns:${cols.map(c => c.width || '1fr').join(' ')} 56px;gap:0;`;
		const headerCss = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		for (const c of cols) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = c.label;
			h.style.cssText = headerCss;
		}
		const actHdr = DOM.append(table, DOM.$('div'));
		actHdr.style.cssText = headerCss;
		const { page, pageIdx, pageCount, total } = this._paginate(entity, rows);
		for (const row of page) {
			for (const c of cols) {
				const raw = row[c.key];
				const txt = c.format ? c.format(raw, row) : (raw === null || raw === undefined || raw === '' ? '—' : String(raw));
				const cell = DOM.append(table, DOM.$('div'));
				cell.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:6px;';
				// Colour-code abnormal result flags (red) so out-of-range results stand
				// out, mirroring the clinical Lab Results table.
				const isAbnormalFlag = entity === 'labResults' && c.key === 'abnormalFlag' && !!txt && txt.toLowerCase() !== 'normal' && txt !== '—';
				if (isAbnormalFlag) {
					const b = DOM.append(cell, DOM.$('span'));
					b.textContent = txt.toUpperCase();
					b.style.cssText = 'font-size:9px;padding:2px 5px;border-radius:6px;background:#ef444420;color:#ef4444;font-weight:700;';
				} else {
					cell.textContent = txt;
				}
			}
			this._renderGridRowActions(table, entity, row);
		}
		this._renderPagerFooter(card, entity, pageIdx, pageCount, total);
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


