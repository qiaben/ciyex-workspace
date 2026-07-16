/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { createUsDateField, enablePickerClick } from '../ciyexDateMask.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EncounterFormEditorInput } from './ciyexEditorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown } from '../customDropdown.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

interface FieldSection { key: string; title: string; columns: number; visible: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[] }
interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; options?: Array<{ label: string; value: string }>; validation?: Record<string, unknown> }
/** One structured Plan row (matches the EHR-UI `PlanItems` component shape). */
interface PlanItemRow { type: string; description: string; notes: string }

export class EncounterFormEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexEncounterForm';

	private root!: HTMLElement;
	private headerBar!: HTMLElement;
	private tocNav!: HTMLElement;
	private scrollArea!: HTMLElement;
	private patientId = '';
	private encounterId = '';
	private patientName = '';
	private encounterData: Record<string, unknown> = {};
	private formSections: FieldSection[] = [];
	private readonly _configHome: URI;

	// Auto-save state
	private _autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
	private _isDirty = false;
	private _compositionId = '';
	// Patient id the encounter-form Composition lives under. The Composition
	// endpoints are PATIENT-scoped, and different surfaces can open the same
	// encounter with different ids for the same person (the appointment's
	// patient id vs the Encounter subject's id) — so the id the Composition was
	// actually FOUND (or first created) under is remembered and used for every
	// subsequent read/write, keeping all surfaces on the one Composition.
	private _compositionPatientId = '';
	// Distinguishes this editor instance in the cross-editor save broadcast so
	// an instance never reloads in response to its own save.
	private readonly _editorInstanceId = generateUuid();
	// Id of the shared FHIR vitals Observation for this visit's DATE — the SAME
	// record the Snapshot and Patient Chart editor read/write. Resolved on load by
	// date so the three pages share one vitals reading instead of divergent copies.
	private _vitalsObsId = '';
	private _encounterStatus = '';
	private _serviceDate = '';
	private _statusBadge: HTMLElement | undefined;
	private _autoSaveIndicator: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(EncounterFormEditor.ID, group, telemetryService, themeService, storageService);
		this._configHome = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex');
		// Reload when ANOTHER editor instance saves this same encounter — e.g.
		// data charted in the appointment page's slide-over drawer must show up
		// in an already-open Encounters-page / Snapshot encounter tab, which the
		// workbench reveals WITHOUT calling setInput again (QA: "data added from
		// the appointment encounter is not reflected in the encounters page /
		// snapshot encounter").
		this._register(this.apiService.onDidMutateClinicalRecord(m => {
			if (m.entity !== 'encounter-form') { return; }
			if (String(m.record.encounterId ?? '') !== this.encounterId || !this.encounterId) { return; }
			if (String(m.record.sourceId ?? '') === this._editorInstanceId) { return; }
			// Don't clobber the user's unsaved edits in this instance.
			if (this._isDirty) { return; }
			void this._loadEncounterData().then(() => {
				this._renderHeader();
				this._renderForm();
			}).catch(() => { /* keep current view */ });
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-encounter-form.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header
		this.headerBar = DOM.append(this.root, DOM.$('div'));
		this.headerBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;align-items:center;gap:10px;';

		// Body: SECTIONS sidebar (TOC) + scrollable form content. The TOC gives
		// quick navigation between Chief Complaint / HPI / Vitals / Assessment /
		// etc. when the encounter chart is opened as a full editor.
		const body = DOM.append(this.root, DOM.$('div'));
		body.style.cssText = 'flex:1;display:flex;overflow:hidden;';

		this.tocNav = DOM.append(body, DOM.$('div'));
		this.tocNav.style.cssText = 'width:200px;flex-shrink:0;overflow-y:auto;padding:8px 0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));';

		this.scrollArea = DOM.append(body, DOM.$('div'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;';
	}

	override async setInput(input: EncounterFormEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.patientId = input.patientId;
		this.encounterId = input.encounterId;
		this.patientName = input.patientName;
		this._compositionId = '';
		this._compositionPatientId = '';
		this._vitalsObsId = '';
		this._encounterStatus = '';

		await Promise.all([this._loadFormSchema(), this._loadEncounterData()]);
		if (token.isCancellationRequested) { return; }

		// Tab label format: "Encounter MM/DD/YYYY <id>".
		input.setEncounterLabel(this._encounterTitle());

		this._renderHeader();
		this._renderToc();
		this._renderForm();
		this._setupScrollSync();
		this._setupAutoSave();

		// Auto-scroll to a requested section (e.g. when "Record Vitals" is
		// invoked from the appointment row, jump straight to Vitals).
		if (input.initialSectionKey) {
			const target = this.sectionCards.get(input.initialSectionKey);
			if (target) {
				const body = target.children[1] as HTMLElement | undefined;
				const header = target.children[0] as HTMLElement | undefined;
				if (body && header && body.style.display === 'none') { header.click(); }
				let top = 0;
				let node: HTMLElement | null = target;
				while (node && node !== this.scrollArea) {
					top += node.offsetTop;
					node = node.offsetParent as HTMLElement | null;
				}
				this.scrollArea.scrollTo({ top: Math.max(0, top - 8) });
			}
		}
	}

	private async _loadFormSchema(): Promise<void> {
		// 1) Try API first
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/encounter-form');
			if (res.ok) {
				const data = await res.json();
				const cfg = data?.data || data || {};
				let fieldConfig: { sections?: FieldSection[] } | undefined;
				const raw = cfg?.field_config ?? cfg?.fieldConfig;
				if (typeof raw === 'string') {
					try { fieldConfig = JSON.parse(raw); } catch { fieldConfig = undefined; }
				} else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
					fieldConfig = raw;
				}
				const sections = fieldConfig?.sections || cfg?.sections || [];
				if (Array.isArray(sections) && sections.length > 0) {
					// Issue #16: the backend's encounter-form config ships
					// "CPT CODES" and "HCPCS CODES" as plain text inputs that
					// can't actually search the code databases — the test team
					// flagged them as non-functional. Replace whichever section
					// houses those fields with the local Procedures & Coding
					// section, which uses the procedure-list search widget
					// (live CPT + HCPCS lookup via /api/app-proxy/ciyex-codes).
					this.formSections = EncounterFormEditor._stripPainLevel(EncounterFormEditor._mergeWithDefaultFields(EncounterFormEditor._mergeProceduresSection(sections)));
					return;
				}
			}
		} catch { /* fall through */ }

		// 2) Try local file
		try {
			const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'encounter.json'));
			const json = JSON.parse(file.value.toString());
			if (json.sections && json.sections.length > 1) {
				// Apply the same Procedures & Coding merge so legacy local
				// configs that ship plain CPT/HCPCS text inputs still get the
				// searchable widget. (Issue #16)
				this.formSections = EncounterFormEditor._stripPainLevel(EncounterFormEditor._mergeWithDefaultFields(EncounterFormEditor._mergeProceduresSection(json.sections)));
				return;
			}
		} catch { /* fall through */ }

		// 3) Hardcoded default
		this.formSections = EncounterFormEditor._defaultSections();
	}

	/**
	 * Drop every Pain Level field regardless of which config shipped it — the
	 * local defaults no longer carry one, but the backend tab_field_config (and
	 * legacy local encounter.json files) may still ship `vitals_pain_level` /
	 * "Pain Level" variants. Product decision: the encounter form does not
	 * capture a pain score.
	 */
	private static _stripPainLevel(sections: FieldSection[]): FieldSection[] {
		const isPain = (f: { key?: string; label?: string }): boolean =>
			/pain/i.test(f.key || '') || /\bpain\b/i.test(f.label || '');
		return sections.map(s => ({ ...s, fields: (s.fields || []).filter(f => !isPain(f)) }));
	}

	/**
	 * Replace the backend's "Procedures & Coding" section (whose CPT/HCPCS
	 * fields are plain text inputs the user can't search with) with the
	 * local default's `procedure-list` field. Heuristic match: any section
	 * whose key/title mentions procedures+coding OR contains a CPT/HCPCS
	 * code field key. Other sections pass through untouched. (Issue #16)
	 */
	private static _mergeProceduresSection(sections: FieldSection[]): FieldSection[] {
		const localProcedures = EncounterFormEditor._defaultSections().find(s => s.key === 'procedures');
		if (!localProcedures) { return sections; }
		// Match a wider set of section + field shapes from the backend
		// tab_field_config: section key/title containing any of procedure / cpt
		// / hcpcs / coding, OR any field whose key or label hints at a
		// procedure/CPT/HCPCS code. Issue #16: the test team kept seeing the
		// plain text "Enter cpt codes…" / "Enter hcpcs codes…" widgets because
		// the previous heuristic missed sections whose title was just "Coding"
		// or whose fields used camelCase keys like cptCodes / hcpcsCodes.
		const codeHintsKey = /(^|[^a-z])(cpt|hcpcs|procedure)/i;
		const codeHintsLabel = /\b(cpt|hcpcs|procedure)\b/i;
		const isProceduresSection = (s: FieldSection): boolean => {
			const t = `${s.key || ''} ${s.title || ''}`.toLowerCase();
			if (/(procedure|cpt|hcpcs)/.test(t)) { return true; }
			if (t.includes('coding') || t.includes('code')) { return true; }
			return (s.fields || []).some(f => codeHintsKey.test(f.key || '') || codeHintsLabel.test(f.label || ''));
		};
		let replaced = false;
		const out = sections.map(s => {
			if (!isProceduresSection(s)) { return s; }
			replaced = true;
			// Preserve the backend section's key + title so existing data
			// (procedures_data, procedures_notes) still maps to the right
			// section name in the TOC, but swap the field set wholesale.
			return { ...s, fields: localProcedures.fields, columns: 1 };
		});
		// Backend didn't ship a Procedures section at all → append the local one
		// so users still get the CPT/HCPCS search experience.
		if (!replaced) { out.push(localProcedures); }
		return out;
	}

	/**
	 * Union-merge the backend tab_field_config sections with the local default
	 * section spec. The backend's encounter-form config ships TRIMMED sections
	 * (e.g. Past Medical / Surgical History with only 2 of 4 fields, Plan with
	 * only 3 of 7) while the snapshot's flat Edit-Encounter drawer renders the
	 * full local field list — QA flagged the two surfaces as inconsistent
	 * (missing Allergies / Current Medications / Medications Prescribed /
	 * Labs-Imaging / Referrals / Patient Education fields in the dedicated
	 * editor). Backend fields keep their position and label; local default
	 * fields missing from the matched backend section are appended; default
	 * sections absent from the backend entirely are appended whole. Matching is
	 * tolerant (normalised key OR title OR any shared field key) because the
	 * backend config sometimes invents its own keys.
	 */
	private static _mergeWithDefaultFields(sections: FieldSection[]): FieldSection[] {
		const norm = (s: string | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
		const out = sections.map(s => ({ ...s, fields: [...(s.fields || [])] }));
		for (const def of EncounterFormEditor._defaultSections()) {
			const target = out.find(s =>
				norm(s.key) === norm(def.key) ||
				norm(s.title) === norm(def.title) ||
				(s.fields || []).some(f => (def.fields || []).some(df => norm(df.key) === norm(f.key))));
			if (!target) { out.push({ ...def, fields: [...(def.fields || [])] }); continue; }
			const haveKeys = new Set((target.fields || []).map(f => norm(f.key)));
			const haveLabels = new Set((target.fields || []).map(f => norm(f.label)));
			for (const df of def.fields || []) {
				if (haveKeys.has(norm(df.key))) { continue; }
				if (df.label && haveLabels.has(norm(df.label))) { continue; }
				target.fields.push(df);
			}
		}
		return out;
	}

	private static _defaultSections(): FieldSection[] {
		return [
			{
				key: 'cc', title: 'Chief Complaint', columns: 1, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'chiefComplaint', label: 'Chief Complaint', type: 'textarea', required: true, placeholder: 'Why is the patient being seen today?' },
				]
			},
			{
				key: 'hpi', title: 'History of Present Illness', columns: 2, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'hpi_onset', label: 'Onset', type: 'text', placeholder: 'When did it start?' },
					{ key: 'hpi_location', label: 'Location', type: 'text', placeholder: 'Where is it?' },
					{ key: 'hpi_duration', label: 'Duration', type: 'text', placeholder: 'How long?' },
					{ key: 'hpi_character', label: 'Character', type: 'text', placeholder: 'What does it feel like?' },
					{
						key: 'hpi_severity', label: 'Severity', type: 'select', placeholder: 'Select Severity...', options: [
							{ label: 'Mild', value: 'mild' }, { label: 'Moderate', value: 'moderate' }, { label: 'Severe', value: 'severe' },
						]
					},
					{ key: 'hpi_timing', label: 'Timing', type: 'text', placeholder: 'Constant, intermittent?' },
					{ key: 'hpi_context', label: 'Context', type: 'text', placeholder: 'What were you doing?' },
					{ key: 'hpi_modifying', label: 'Modifying Factors', type: 'text', placeholder: 'What makes it better/worse?' },
					{ key: 'hpi_associated', label: 'Associated Signs/Symptoms', type: 'text', colSpan: 2, placeholder: 'Any other symptoms?' },
					{ key: 'hpi_narrative', label: 'HPI Narrative', type: 'textarea', colSpan: 2, placeholder: 'Free-text narrative...' },
				]
			},
			{
				key: 'ros', title: 'Review of Systems', columns: 1, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'ros_data', label: 'Review of Systems', type: 'ros-grid' },
				]
			},
			{
				key: 'vitals', title: 'Vitals', columns: 4, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'vitals_bp_systolic', label: 'BP Systolic', type: 'number', placeholder: 'mmHg' },
					{ key: 'vitals_bp_diastolic', label: 'BP Diastolic', type: 'number', placeholder: 'mmHg' },
					{ key: 'vitals_heart_rate', label: 'Heart Rate', type: 'number', placeholder: 'bpm' },
					{ key: 'vitals_temperature', label: 'Temperature', type: 'number', placeholder: '\u00B0F' },
					{ key: 'vitals_spo2', label: 'SpO2', type: 'number', placeholder: '%' },
					{ key: 'vitals_respiratory_rate', label: 'Respiratory Rate', type: 'number', placeholder: '/min' },
					// Use kg / cm to match the web app's Vitalsform — its useMemo
					// uses w / (h/100)^2 with weightKg / heightCm directly.
					{ key: 'vitals_weight', label: 'Weight (kg)', type: 'number', placeholder: 'kg' },
					{ key: 'vitals_height', label: 'Height (cm)', type: 'number', placeholder: 'cm' },
					{ key: 'vitals_bmi', label: 'BMI', type: 'number', placeholder: 'Auto-calculated' },
					// Pain Level intentionally omitted (product decision — mirrors the
					// snapshot's Edit Encounter drawer). _stripPainLevel also drops any
					// copy the backend tab_field_config ships.
					{ key: 'vitals_notes', label: 'Notes', type: 'text', colSpan: 2, placeholder: 'Additional notes...' },
				]
			},
			{
				key: 'pe', title: 'Physical Exam', columns: 1, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'pe_data', label: 'Physical Exam', type: 'exam-grid' },
				]
			},
			{
				key: 'pmh', title: 'Past Medical / Surgical History', columns: 1, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'pmh_conditions', label: 'Medical Conditions', type: 'textarea', placeholder: 'List past medical conditions...' },
					{ key: 'pmh_surgeries', label: 'Surgical History', type: 'textarea', placeholder: 'List past surgeries...' },
					{ key: 'pmh_allergies', label: 'Allergies', type: 'textarea', placeholder: 'List known allergies...' },
					{ key: 'pmh_medications', label: 'Current Medications', type: 'textarea', placeholder: 'List current medications...' },
				]
			},
			{
				key: 'fh', title: 'Family History', columns: 2, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'fh_father', label: 'Father', type: 'text', placeholder: 'Health conditions...' },
					{ key: 'fh_mother', label: 'Mother', type: 'text', placeholder: 'Health conditions...' },
					{ key: 'fh_siblings', label: 'Siblings', type: 'text', placeholder: 'Health conditions...' },
					{ key: 'fh_notes', label: 'Additional Notes', type: 'textarea', colSpan: 2 },
				]
			},
			{
				key: 'sh', title: 'Social History', columns: 3, visible: true, collapsible: true, collapsed: true, fields: [
					{
						key: 'sh_smoking', label: 'Smoking', type: 'select', options: [
							{ label: 'Never', value: 'never' }, { label: 'Former', value: 'former' }, { label: 'Current', value: 'current' },
						]
					},
					{
						key: 'sh_alcohol', label: 'Alcohol', type: 'select', options: [
							{ label: 'None', value: 'none' }, { label: 'Social', value: 'social' }, { label: 'Daily', value: 'daily' },
						]
					},
					{
						key: 'sh_exercise', label: 'Exercise', type: 'select', options: [
							{ label: 'None', value: 'none' }, { label: '1-2x/week', value: '1-2' }, { label: '3-5x/week', value: '3-5' }, { label: 'Daily', value: 'daily' },
						]
					},
					{ key: 'sh_occupation', label: 'Occupation', type: 'text' },
					{
						key: 'sh_drugs', label: 'Recreational Drugs', type: 'select', options: [
							{ label: 'None', value: 'none' }, { label: 'Past', value: 'past' }, { label: 'Current', value: 'current' },
						]
					},
					{ key: 'sh_notes', label: 'Additional Notes', type: 'textarea', colSpan: 3 },
				]
			},
			{
				key: 'assessment', title: 'Assessment & Diagnosis', columns: 1, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'assessment_diagnoses', label: 'Diagnoses (ICD-10)', type: 'diagnosis-list' },
					{ key: 'assessment_notes', label: 'Assessment Notes', type: 'textarea', placeholder: 'Clinical assessment narrative...' },
				]
			},
			{
				key: 'plan', title: 'Plan', columns: 1, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'plan_items', label: 'Plan Items', type: 'plan-items' },
					{ key: 'plan_medications', label: 'Medications Prescribed', type: 'textarea', placeholder: 'Medications prescribed or changed...' },
					{ key: 'plan_labs', label: 'Labs / Imaging Ordered', type: 'textarea', placeholder: 'Lab tests, imaging, or diagnostics ordered...' },
					{ key: 'plan_referrals', label: 'Referrals', type: 'textarea', placeholder: 'Specialist referrals...' },
					{ key: 'plan_followup', label: 'Follow-up', type: 'text', placeholder: 'Return in 2 weeks, PRN, etc.' },
					{ key: 'plan_patient_education', label: 'Patient Education', type: 'textarea', placeholder: 'Education and instructions provided...' },
					{ key: 'plan_notes', label: 'Plan Notes', type: 'textarea', placeholder: 'Additional plan details...' },
				]
			},
			{
				key: 'provider-note', title: 'Provider Notes', columns: 1, visible: true, collapsible: true, collapsed: true, fields: [
					{ key: 'provider_narrative', label: 'Provider Narrative', type: 'textarea', placeholder: 'Free-text provider notes...', colSpan: 1 },
				]
			},
			{
				key: 'procedures', title: 'Procedures & Coding', columns: 1, visible: true, collapsible: true, collapsed: false, fields: [
					{ key: 'procedures_data', label: 'Procedures (CPT/HCPCS)', type: 'procedure-list' },
					{ key: 'procedures_notes', label: 'Procedure Notes', type: 'textarea', placeholder: 'Procedure details and notes...' },
				]
			},
		];
	}

	private async _loadEncounterData(): Promise<void> {
		const loads = [
			this.apiService.fetch(`/api/fhir-resource/encounters/${this.encounterId}`).then(async r => r.ok ? (await r.json())?.data || {} : {}).catch(() => ({})),
			this.patientId
				? this.apiService.fetch(`/api/encounters/${this.patientId}/${this.encounterId}`).then(async r => r.ok ? (await r.json())?.data || {} : {}).catch(() => ({}))
				: Promise.resolve({}),
			this.patientId ? this._fetchFormComposition(this.patientId) : Promise.resolve({}),
		];
		const [fhir, ehr, form0] = await Promise.all(loads);
		let form = form0 as Record<string, unknown>;
		// The Composition endpoint is PATIENT-scoped, and the id this editor was
		// opened with is not always the id the Composition was saved under (the
		// appointments drawer passes the appointment's patient id; the Encounters
		// list passes the Encounter subject's id — same person, different ids on
		// some backends). When the lookup under our id finds nothing, retry under
		// the patient id the Encounter resource itself points at — otherwise data
		// charted on one surface never shows on the others (QA issue).
		if (!form.id) {
			const encPid = String((fhir as Record<string, unknown>).patientId ?? (fhir as Record<string, unknown>).patientRef ?? '').replace(/^Patient\//i, '').trim();
			if (encPid && encPid !== this.patientId) {
				const alt = await this._fetchFormComposition(encPid);
				if (alt.id) { form = alt; this._compositionPatientId = encPid; }
			}
		}
		this._encounterStatus = String((ehr as Record<string, unknown>).status || (fhir as Record<string, unknown>).status || 'UNSIGNED');
		this.encounterData = { ...fhir, ...ehr, ...form };
		// The form's Chief Complaint field is keyed `chiefComplaint`, but an
		// encounter created from an appointment carries the complaint on the
		// Encounter resource's `reasonForVisit`/`reason` (possibly a FHIR
		// CodeableConcept) with NO composition yet — so the editor opened with a
		// blank Chief Complaint even though the Snapshot's Encounter History
		// showed it (QA issue). Backfill from the reason shapes, skipping the
		// generic "Manual encounter" placeholder.
		if (!String(this.encounterData['chiefComplaint'] ?? '').trim()) {
			const ccText = (v: unknown): string => {
				if (!v) { return ''; }
				if (typeof v === 'string') { return v; }
				if (Array.isArray(v)) { return v.map(ccText).filter(Boolean).join(', '); }
				if (typeof v === 'object') {
					const o = v as Record<string, unknown>;
					const coding = Array.isArray(o.coding) ? (o.coding[0] as Record<string, unknown> | undefined) : undefined;
					return String(o.text || o.display || coding?.display || '');
				}
				return '';
			};
			const cc = ccText(this.encounterData['reasonForVisit']) || ccText(this.encounterData['reason'])
				|| ccText(this.encounterData['reasonText']) || ccText(this.encounterData['reasonCode']);
			if (cc && !/^(manual encounter|scheduled telehealth visit)$/i.test(cc.trim())) {
				this.encounterData['chiefComplaint'] = cc;
			}
		}
		this._serviceDate = this._extractServiceDate(this.encounterData);
		// Vitals are DATE-scoped, never "most recent across all dates". The Snapshot,
		// this Encounter and the Patient Chart all read/write the ONE FHIR Observation
		// recorded on the visit's DATE. Pre-fill the Vitals section from that per-date
		// record — so a fresh visit with no vitals for its own date opens blank
		// (matching the Snapshot), instead of leaking another day's numbers.
		//
		// The shared per-date Observation is the SOURCE OF TRUTH and OVERRIDES the
		// encounter composition's stale `vitals_*` copy: the Snapshot edits only that
		// Observation (not the composition), so if the composition won, a vital edited
		// on the Snapshot would never appear here (the values would silently diverge —
		// e.g. Snapshot showing BP 16/… while this form kept the old 126/…). Overriding
		// keeps Snapshot ↔ Encounter in sync both ways and matches how the Snapshot's
		// own encounter-edit dialog loads vitals (_loadEncounterForEdit). Keys the
		// Observation does not define (e.g. pain level, unsupported by the vitals store)
		// keep their composition value. The record's id is remembered so save upserts
		// the SAME record (no copies).
		const encDateRaw = this.encounterData['encounterDate'] ?? this.encounterData['startDate'] ?? this.encounterData['start'] ?? this.encounterData['date'];
		if (this.patientId && encDateRaw) {
			try {
				const found = await this._findVitalsObsOnDate(String(encDateRaw));
				if (found) {
					this._vitalsObsId = found.id;
					for (const [k, v] of Object.entries(found.vitals)) {
						if (v !== undefined && v !== null && String(v).trim() !== '') { this.encounterData[k] = v; }
					}
				}
			} catch { /* no vitals for this date — leave the section blank */ }
		}
	}

	/** Fetch the encounter-form Composition for this encounter under the given
	 *  patient scope. The endpoint wraps the composition(s) in a paginated
	 *  envelope ({ content, page, size, … }) — pick the most recently updated one
	 *  so saved data (including the assessment_diagnoses / procedures_data code
	 *  arrays) is loaded back. Older responses returned the bare object, so fall
	 *  back to it when there is no content array. Remembers the composition id
	 *  when one is found; returns {} when none exists. */
	private async _fetchFormComposition(patientId: string): Promise<Record<string, unknown>> {
		try {
			const r = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${patientId}?encounterRef=${this.encounterId}`);
			if (!r.ok) { return {}; }
			const d = await r.json();
			const dd = (d?.data ?? {}) as Record<string, unknown>;
			const content = Array.isArray(dd.content) ? dd.content as Array<Record<string, unknown>> : null;
			const comp = content && content.length
				? [...content].sort((a, b) => String(b._lastUpdated ?? '').localeCompare(String(a._lastUpdated ?? '')))[0]
				: dd;
			if (comp && comp.id) { this._compositionId = String(comp.id); }
			return comp ?? {};
		} catch {
			return {};
		}
	}

	/** Find the most-recent FHIR vitals Observation recorded on the given calendar
	 *  day (the shared per-visit-date record). Returns its id + mapped vitals_*
	 *  fields, or null when none exists for that day. */
	private async _findVitalsObsOnDate(dateRaw: string): Promise<{ id: string; vitals: Record<string, unknown> } | null> {
		const ref = new Date(dateRaw);
		if (isNaN(ref.getTime())) { return null; }
		const sameDay = (v: unknown): boolean => {
			const d = v ? new Date(String(v)) : null;
			return !!d && !isNaN(d.getTime()) && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
		};
		const r = await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${this.patientId}?page=0&size=50`);
		if (!r.ok) { return null; }
		const arr = ((await r.json())?.data?.content ?? []) as Array<Record<string, unknown>>;
		const onDate = arr
			.filter(v => sameDay(v.recordedAt ?? v.effectiveDateTime ?? v.recordedDate ?? v.date))
			.sort((a, b) => Date.parse(String(b._lastUpdated ?? b.recordedAt ?? '')) - Date.parse(String(a._lastUpdated ?? a.recordedAt ?? '')));
		const obs = onDate[0];
		if (!obs || !obs.id) { return null; }
		return { id: String(obs.id), vitals: this._mapLatestVitals({ data: { content: [obs] } }) };
	}

	/** Inverse of {@link _mapLatestVitals}: map the encounter form's `vitals_*`
	 *  fields onto the FHIR vitals Observation shape so the encounter's vitals can
	 *  be written to the shared `/api/fhir-resource/vitals` store. Only defined
	 *  values are included. (Temperature is passed through as-is, matching how the
	 *  rest of the app maps `vitals_temperature` ↔ `temperatureC`.) */
	private _vitalsToFhir(form: Record<string, unknown>): Record<string, unknown> {
		const num = (...keys: string[]): number | undefined => {
			for (const key of keys) {
				const v = form[key];
				if (v === undefined || v === null || String(v).trim() === '') { continue; }
				const n = Number(v);
				if (Number.isFinite(n)) { return n; }
			}
			return undefined;
		};
		const map: Record<string, number | undefined> = {
			bpSystolic: num('vitals_bp_systolic'),
			bpDiastolic: num('vitals_bp_diastolic'),
			// The encounter-form's backend field config keys three vitals as
			// vitals_hr / vitals_temp / vitals_rr, while the Snapshot and the local
			// config use vitals_heart_rate / vitals_temperature / vitals_respiratory_rate.
			// Read BOTH so a value entered on the encounter form is saved to the shared
			// vitals store (otherwise Heart Rate / Temperature / Respiratory Rate were
			// silently dropped on save from the encounter).
			pulse: num('vitals_heart_rate', 'vitals_hr'),
			temperatureC: num('vitals_temperature', 'vitals_temp'),
			// SpO2's backend short key is `vitals_spo` (no trailing 2).
			oxygenSaturation: num('vitals_spo2', 'vitals_spo'),
			respiration: num('vitals_respiratory_rate', 'vitals_rr'),
			weightKg: num('vitals_weight'),
			heightCm: num('vitals_height'),
		};
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(map)) { if (v !== undefined) { out[k] = v; } }
		// Recompute BMI from height/weight so the shared store's stored BMI never
		// drifts from the numbers on an encounter edit (mirrors the Snapshot's save,
		// which also recomputes on write). Both cards recompute BMI for display, but
		// keep the persisted value correct for any consumer that reads it directly.
		if (typeof map.heightCm === 'number' && typeof map.weightKg === 'number') {
			const heightM = map.heightCm / 100;
			const bmi = heightM > 0 ? map.weightKg / (heightM * heightM) : 0;
			if (Number.isFinite(bmi) && bmi > 0) { out.bmi = Number(bmi.toFixed(1)); }
		}
		// Vitals notes are free text (FHIR Observation.note[0].text), not a number,
		// so they fall outside the numeric map above. Carry the string through
		// explicitly — otherwise a vitals note is dropped on the way to the shared
		// vitals store and never shows on the Snapshot / Encounter vitals card.
		const notes = form['vitals_notes'];
		if (notes !== undefined && notes !== null && String(notes).trim() !== '') { out['notes'] = String(notes).trim(); }
		return out;
	}

	/** Pull the encounter's date of service out of whichever field the backend
	 *  populated (`encounterDate` / `startDate` / `start` / `date`, or the FHIR
	 *  `period.start`) and format it as e.g. "Jun 25, 2026". Returns '' when no
	 *  usable date is present. */
	private _extractServiceDate(data: Record<string, unknown>): string {
		const period = data['period'] as Record<string, unknown> | undefined;
		const raw = data['encounterDate'] ?? data['startDate'] ?? data['start'] ?? data['date'] ?? (period ? period['start'] : undefined);
		if (!raw) { return ''; }
		const d = new Date(String(raw));
		if (isNaN(d.getTime())) { return String(raw).substring(0, 10); }
		// mm/dd/yyyy — used in the tab label and the editor header title.
		return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
	}

	/** Tab + header title: "Encounter MM/DD/YYYY <id>". Falls back to today's
	 *  date for a brand-new encounter with no service date yet, and omits the id
	 *  until a real one has been minted (it is the literal "new" before save). */
	private _encounterTitle(): string {
		const date = this._serviceDate || new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
		const id = this.encounterId && this.encounterId !== 'new' ? this.encounterId : '';
		return `Encounter ${date}${id ? ` ${id}` : ''}`;
	}

	/**
	 * Map the most recent vitals Observation (response shape from
	 * `/api/fhir-resource/vitals/patient/{id}`) onto the encounter form's
	 * `vitals_*` field keys. Returns an empty object when no record exists.
	 */
	private _mapLatestVitals(json: unknown): Record<string, unknown> {
		const d = json as Record<string, unknown> | null;
		const data = (d?.['data'] ?? d) as Record<string, unknown> | undefined;
		const content = (data?.['content'] ?? data) as unknown;
		const rows = (Array.isArray(content) ? content : (Array.isArray(data) ? data : [data])) as Array<Record<string, unknown>>;
		// The endpoint is NOT ordered newest-first, so `rows[0]` can be a stale record.
		// Pick the most recently recorded/updated one so the encounter pre-fills from
		// the vitals the user actually just entered.
		const stamp = (r: Record<string, unknown> | undefined): string =>
			String(r?.['recordedAt'] ?? r?.['_lastUpdated'] ?? r?.['effectiveDateTime'] ?? '');
		const latest = rows
			.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
			.sort((a, b) => stamp(b).localeCompare(stamp(a)))[0];
		if (!latest || typeof latest !== 'object') { return {}; }
		const num = (...keys: string[]): unknown => {
			for (const k of keys) {
				const v = latest[k];
				if (v !== undefined && v !== null && String(v) !== '') { return v; }
			}
			return undefined;
		};
		// Each form field is filled from the FIRST present source key. The vitals
		// store/Observation shape varies (camelCase, snake_case, unit-suffixed), so
		// every known alias is listed — heart rate, temperature and respiratory rate
		// were fetching blank because their backend keys (e.g. the Fahrenheit-labelled
		// temperature stored as `temperatureF`, `heart_rate`/`respiratory_rate`
		// snake_case) weren't covered while BP/SpO2/weight/height/BMI were.
		const out: Record<string, unknown> = {
			vitals_bp_systolic: num('bpSystolic', 'systolicBP', 'systolic', 'bp_systolic', 'systolicBp'),
			vitals_bp_diastolic: num('bpDiastolic', 'diastolicBP', 'diastolic', 'bp_diastolic', 'diastolicBp'),
			vitals_heart_rate: num('pulse', 'heartRate', 'heart_rate', 'pulseRate', 'heartRateBpm', 'hr'),
			// Fahrenheit-labelled field — prefer the Fahrenheit value when present, else
			// fall back to the Celsius/legacy keys so a value always surfaces.
			vitals_temperature: num('temperatureF', 'tempF', 'temperatureC', 'tempC', 'temperature', 'temp'),
			vitals_spo2: num('oxygenSaturation', 'spo2', 'spO2', 'o2sat', 'oxygen_saturation', 'oxygenSat'),
			vitals_respiratory_rate: num('respiration', 'respiratoryRate', 'respiratory_rate', 'respRate', 'respirationRate', 'rr'),
			vitals_weight: num('weightKg', 'weight', 'bodyWeight', 'weight_kg'),
			vitals_height: num('heightCm', 'height', 'bodyHeight', 'height_cm'),
			vitals_bmi: num('bmi', 'bodyMassIndex', 'BMI'),
			// Free-text vitals note (FHIR Observation.note[0].text) — read it back so
			// the Encounter form shows a note saved from the Snapshot/vitals card.
			vitals_notes: num('notes', 'note', 'comment'),
		};
		// The encounter-form's backend field config keys Heart Rate / Temperature /
		// Respiratory Rate as vitals_hr / vitals_temp / vitals_rr (the Snapshot and the
		// local config use vitals_heart_rate / vitals_temperature / vitals_respiratory_rate).
		// Mirror the values onto BOTH key conventions so those three fields populate
		// regardless of which config drives the form — otherwise they render blank
		// while BP/SpO2/Weight/Height/BMI (whose keys already match) fill in.
		if (out.vitals_heart_rate !== undefined) { out.vitals_hr = out.vitals_heart_rate; }
		if (out.vitals_temperature !== undefined) { out.vitals_temp = out.vitals_temperature; }
		if (out.vitals_respiratory_rate !== undefined) { out.vitals_rr = out.vitals_respiratory_rate; }
		// SpO2's backend short key is `vitals_spo` (no trailing 2) — mirror it too.
		if (out.vitals_spo2 !== undefined) { out.vitals_spo = out.vitals_spo2; }
		// Drop undefined keys so they don't shadow other sources with `undefined`.
		for (const k of Object.keys(out)) {
			if (out[k] === undefined) { delete out[k]; }
		}
		return out;
	}

	// Section icons for TOC
	private static SECTION_ICONS: Record<string, string> = {
		'cc': '\u{1F6A8}', 'hpi': '\u{1F4DD}', 'ros': '\u{1F4CB}', 'pmh': '\u{1F4DA}',
		'fh': '\u{1F465}', 'sh': '\u{1F3E0}', 'vitals': '\u2764\uFE0F', 'pe': '\u{1F52C}',
		'assessment': '\u{1F9E0}', 'plan': '\u{1F4C4}', 'provider-note': '\u270D\uFE0F',
		'procedures': '\u2702\uFE0F', 'billing': '\u{1F4B3}', 'fee-schedule': '\u{1F4B0}',
		'assigned-providers': '\u{1F468}\u200D\u2695\uFE0F', 'signoff': '\u2705', 'signature': '\u{1F58A}\uFE0F',
	};

	/** Same icon set keyed by normalised section TITLE - the backend
	 *  tab_field_config invents its own section keys (so the key lookup above
	 *  misses), which is why Physical Exam / Family History etc. rendered
	 *  without icons in the TOC (QA ask: every section carries an icon). */
	private static SECTION_TITLE_ICONS: Record<string, string> = {
		'chiefcomplaint': '\u{1F6A8}', 'historyofpresentillness': '\u{1F4DD}', 'reviewofsystems': '\u{1F4CB}',
		'pastmedicalsurgicalhistory': '\u{1F4DA}', 'pastmedicalhistory': '\u{1F4DA}', 'familyhistory': '\u{1F465}',
		'socialhistory': '\u{1F3E0}', 'vitals': '\u2764\uFE0F', 'physicalexam': '\u{1F52C}',
		'assessmentdiagnosis': '\u{1F9E0}', 'assessment': '\u{1F9E0}', 'plan': '\u{1F4C4}',
		'providernotes': '\u270D\uFE0F', 'procedurescoding': '\u2702\uFE0F', 'procedures': '\u2702\uFE0F',
		'billing': '\u{1F4B3}', 'feeschedule': '\u{1F4B0}', 'signoff': '\u2705', 'signature': '\u{1F58A}\uFE0F',
	};

	/** Icon for a section: key lookup, then normalised-title lookup, then a
	 *  generic document fallback, so every TOC row and section header carries one. */
	private static _sectionIcon(sec: FieldSection): string {
		const byKey = EncounterFormEditor.SECTION_ICONS[sec.key];
		if (byKey) { return byKey; }
		const t = (sec.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
		return EncounterFormEditor.SECTION_TITLE_ICONS[t] || '\u{1F4C4}';
	}

	private tocItems: Array<{ key: string; el: HTMLElement }> = [];
	private sectionCards = new Map<string, HTMLElement>();
	/** Visible/hidden pairs for every rendered date field, so the save guard can
	 *  locate a typed-but-invalid date and focus it without DOM selectors. */
	private _dateFieldRefs: Array<{ hidden: HTMLInputElement; visible: HTMLInputElement }> = [];

	// Complex (non-input) field values — diagnosis list, procedure list, plan
	// items, ROS/exam grids — that live as in-memory arrays/objects rather than
	// as DOM inputs. `_collectFormData()` merges these in so they actually get
	// saved. Holds live references, so in-place push/splice are picked up.
	private _complexFields = new Map<string, unknown>();

	private get _isSigned(): boolean {
		return this._encounterStatus.toUpperCase() === 'SIGNED';
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);

		const icon = DOM.append(this.headerBar, DOM.$('span'));
		icon.textContent = '\u{1F4CB}';
		icon.style.cssText = 'font-size:16px;';

		// Title: "Encounter MM/DD/YYYY <id>" — same format as the tab label. The
		// date of service is part of the title, so no separate DOS span is needed.
		const title = DOM.append(this.headerBar, DOM.$('span'));
		title.textContent = this._encounterTitle();
		title.style.cssText = 'font-size:14px;font-weight:700;';

		if (this.patientName) {
			const patient = DOM.append(this.headerBar, DOM.$('span'));
			patient.textContent = this.patientName;
			patient.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		}

		// Status badge — the test team wants exactly two encounter states surfaced
		// everywhere: Signed or Unsigned. Raw FHIR/EHR statuses (in-progress,
		// arrived, planned, INCOMPLETE, ...) all collapse to Unsigned; only a
		// signed/finished/completed encounter shows Signed. This mirrors the
		// normalization already used by the encounters sidebar, snapshot and chart.
		const s = String(this._encounterStatus || '').toLowerCase();
		const isSignedish = (s.includes('sign') && !s.includes('unsign')) || s.includes('finish') || (s.includes('complet') && !s.includes('incomplet'));
		const status = isSignedish ? 'Signed' : 'Unsigned';
		const statusColor = isSignedish ? '#22c55e' : '#f59e0b';
		this._statusBadge = DOM.append(this.headerBar, DOM.$('span'));
		this._statusBadge.textContent = status;
		this._statusBadge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:10px;background:${statusColor}18;color:${statusColor};font-weight:500;`;

		// Auto-save indicator
		this._autoSaveIndicator = DOM.append(this.headerBar, DOM.$('span'));
		this._autoSaveIndicator.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		DOM.append(this.headerBar, DOM.$('span')).style.flex = '1';

		// No manual "Fee Sheet" button: the fee sheet is generated automatically
		// when the encounter is signed, from the CPT/ICD codes already captured
		// on the encounter (see _autoCreateFeeSheetFromEncounter).

		// Save button
		const saveBtn = DOM.append(this.headerBar, DOM.$('button'));
		saveBtn.textContent = 'Save';
		saveBtn.style.cssText = 'padding:5px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
		if (this._isSigned) { (saveBtn as HTMLButtonElement).disabled = true; saveBtn.style.opacity = '0.5'; saveBtn.style.cursor = 'not-allowed'; }
		saveBtn.addEventListener('click', () => this._saveEncounter(saveBtn));

		// Sign & Lock button. Once an encounter is signed it is permanently
		// locked — there is no unsign path, so we render a static, disabled
		// "Signed & Locked" indicator instead of an actionable button.
		const signBtn = DOM.append(this.headerBar, DOM.$('button'));
		if (this._isSigned) {
			signBtn.textContent = '\u{1F512} Signed & Locked';
			signBtn.style.cssText = 'padding:5px 16px;background:#16a34a;color:#fff;border:none;border-radius:4px;cursor:not-allowed;font-size:12px;font-weight:600;opacity:0.85;';
			(signBtn as HTMLButtonElement).disabled = true;
			signBtn.title = 'This encounter is signed and permanently locked.';
		} else {
			signBtn.textContent = 'Sign & Lock';
			signBtn.style.cssText = 'padding:5px 16px;background:#22c55e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
			signBtn.addEventListener('click', () => this._signEncounter(saveBtn, signBtn));
		}
	}

	/**
	 * The encounter-form Composition references its parent Encounter by id. When
	 * this editor is opened for a brand-new encounter the id is the literal
	 * "new", so the Composition would point at "Encounter/new" — which the FHIR
	 * server rejects (HAPI-1094: "Resource Encounter/new not found"). Create a
	 * real Encounter first (matching ciyex-ehr-ui's POST /api/{patientId}/encounters)
	 * and adopt its id so the Composition references a resource that exists.
	 */
	private async _ensureRealEncounterId(formData: Record<string, unknown>): Promise<string> {
		if (this.encounterId && this.encounterId !== 'new') { return this.encounterId; }
		if (!this.patientId) { return this.encounterId; }
		const reason = String(formData['chiefComplaint'] || formData['reasonForVisit'] || formData['reason'] || '').trim();
		const res = await this.apiService.fetch(`/api/${this.patientId}/encounters`, {
			method: 'POST',
			body: JSON.stringify({
				visitCategory: 'AMB',
				encounterDate: new Date().toISOString(),
				status: 'UNSIGNED',
				reasonForVisit: reason,
			}),
		});
		if (!res.ok) {
			throw new Error(await res.text().catch(() => `Failed to create encounter (HTTP ${res.status})`));
		}
		const json = await res.json().catch(() => null);
		const newId = String(json?.data?.id || json?.id || '');
		if (newId) { this.encounterId = newId; }
		return this.encounterId;
	}

	private async _saveEncounter(saveBtn: HTMLElement): Promise<boolean> {
		if (!(this.input instanceof EncounterFormEditorInput)) { return false; }
		if (this._isSigned) { return false; }
		const { patientId } = this.input;
		if (!this.encounterId) { this.notificationService.warn('No encounter ID'); return false; }

		// Block save when any date field holds a typed-but-invalid value (e.g.
		// 13/33/2000) — createUsDateField flags these via dataset.invalid.
		const invalidDate = this._findInvalidDateInput();
		if (invalidDate) {
			this.notificationService.warn('Enter a valid date (MM/DD/YYYY) before saving.');
			invalidDate.visible.focus();
			return false;
		}

		const formData = this._collectFormData();

		saveBtn.textContent = 'Saving...';
		(saveBtn as HTMLButtonElement).disabled = true;

		try {
			// Resolve "new" to a real Encounter id before writing the Composition.
			const encounterId = await this._ensureRealEncounterId(formData);
			// Sync the vitals to the SHARED FHIR vitals store (the Snapshot and the
			// Patient Chart editor read that store, NOT the encounter composition).
			// Upsert the ONE Observation for this visit's DATE — found on load (or, if
			// load missed it, looked up now) — so all three pages edit a single record
			// instead of piling up divergent copies. Best-effort: a vitals error never
			// blocks the encounter save.
			const fhirVitals = this._vitalsToFhir(formData);
			if (Object.keys(fhirVitals).length > 0) {
				try {
					const encDateRaw = formData['encounterDate'] ?? formData['startDate'] ?? this.encounterData['encounterDate'] ?? this.encounterData['startDate'];
					const recordedAt = encDateRaw && !isNaN(new Date(String(encDateRaw)).getTime())
						? new Date(String(encDateRaw)).toISOString()
						: new Date().toISOString();
					// Resolve the date's existing Observation if we don't already have it,
					// so a vital entered for this date elsewhere is updated (not duplicated).
					if (!this._vitalsObsId && encDateRaw) {
						const found = await this._findVitalsObsOnDate(String(encDateRaw)).catch(() => null);
						if (found) { this._vitalsObsId = found.id; }
					}
					const body = JSON.stringify({ ...fhirVitals, patientId, recordedAt });
					let vRes = this._vitalsObsId
						? await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${patientId}/${this._vitalsObsId}`, { method: 'PUT', body })
						: await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${patientId}`, { method: 'POST', body });
					// A stale id (Observation deleted) 404s on PUT — fall back to create.
					if (this._vitalsObsId && vRes.status === 404) {
						vRes = await this.apiService.fetch(`/api/fhir-resource/vitals/patient/${patientId}`, { method: 'POST', body });
					}
					if (vRes.ok) {
						const vj = await vRes.json().catch(() => null);
						const newId = String(vj?.data?.id ?? vj?.id ?? this._vitalsObsId ?? '');
						if (newId) { this._vitalsObsId = newId; }
					}
				} catch { /* best-effort vitals sync */ }
			}
			// Save to encounter-form composition (primary - matches EHR UI).
			// Write under the patient scope the Composition was FOUND under —
			// which can differ from this editor's own patient id (see
			// _loadEncounterData) — so the update lands on the one Composition
			// every surface reads instead of forking a second copy.
			const compPatientId = this._compositionPatientId || patientId;
			let compRes: Response;
			if (this._compositionId) {
				compRes = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${compPatientId}/${this._compositionId}`, {
					method: 'PUT',
					body: JSON.stringify(formData),
				});
			} else {
				compRes = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${compPatientId}?encounterRef=${encounterId}`, {
					method: 'POST',
					body: JSON.stringify(formData),
				});
				if (compRes.ok) {
					const compData = await compRes.json();
					this._compositionId = String(compData?.data?.id || compData?.id || '');
				}
			}

			// Also save to encounter resource. The Snapshot's Encounter History
			// reads the complaint from the Encounter resource's
			// `reasonForVisit`/`reason` fields — the composition alone is not
			// enough. Map the form's chiefComplaint onto those keys so a signed
			// encounter's Chief Complaint shows up in the history (QA: history
			// showed "—" after Sign & Lock).
			const ccOut = String(formData['chiefComplaint'] ?? '').trim();
			await this.apiService.fetch(`/api/fhir-resource/encounters/${encounterId}`, {
				method: 'PUT',
				body: JSON.stringify({
					...formData, patientId, id: encounterId,
					...(ccOut ? { reasonForVisit: ccOut, reason: ccOut } : {}),
				}),
			}).catch(() => { /* secondary save, ignore errors */ });

			if (compRes.ok) {
				this._isDirty = false;
				// Re-fetch the persisted composition (now keyed to the real encounter id)
				// and re-render so the saved data is reflected immediately (issue 1).
				await this._loadEncounterData().catch(() => { /* keep current view on reload failure */ });
				// A brand-new encounter now has a real id + service date — refresh the
				// tab label so "Encounter MM/DD/YYYY new" becomes "…  <id>".
				if (this.input instanceof EncounterFormEditorInput) { this.input.setEncounterLabel(this._encounterTitle()); }
				this._renderHeader();
				this._renderForm();
				this._updateAutoSaveIndicator('Saved');
				// Notify the encounters list so a newly created/saved encounter appears
				// without requiring a manual reload (issue 6).
				this.commandService.executeCommand('ciyex.refreshEncounters').catch(() => { /* list may not be open */ });
				// Broadcast the save so any OTHER open editor on this encounter (the
				// appointments drawer vs an Encounters-page / Snapshot tab) reloads
				// and shows the just-charted data immediately.
				this.apiService.notifyClinicalRecordMutation({
					entity: 'encounter-form', patientId, kind: 'update',
					record: { encounterId, sourceId: this._editorInstanceId },
				});
				return true;
			} else {
				const err = await compRes.text().catch(() => 'Unknown error');
				this.notificationService.error(`Failed to save: ${err}`);
				return false;
			}
		} catch (e) {
			this.notificationService.error(`Save error: ${e}`);
			return false;
		} finally {
			saveBtn.textContent = 'Save';
			(saveBtn as HTMLButtonElement).disabled = false;
		}
	}

	private async _signEncounter(saveBtn: HTMLElement, signBtn: HTMLElement): Promise<void> {
		if (!this.patientId || !this.encounterId) { return; }

		// Save first if dirty
		if (this._isDirty) {
			const saved = await this._saveEncounter(saveBtn);
			if (!saved) {
				this.notificationService.warn('Please fix save errors before signing.');
				return;
			}
		}

		signBtn.textContent = 'Signing...';
		(signBtn as HTMLButtonElement).disabled = true;

		try {
			const res = await this.apiService.fetch(`/api/${this.patientId}/encounters/${this.encounterId}/sign`, {
				method: 'POST',
			});

			if (res.ok) {
				this._encounterStatus = 'SIGNED';
				this.notificationService.notify({ severity: Severity.Info, message: 'Encounter signed and locked. Creating fee sheet…' });
				// Capture the captured CPT/ICD codes BEFORE re-rendering: _renderForm()
				// clears _complexFields and rebuilds it from encounterData, so reading
				// the codes after the re-render can come back empty. Snapshot first.
				const procedures = this._encounterCodeList('procedure');
				const diagnoses = this._encounterCodeList('diagnosis');
				// Re-render to show locked state
				this._renderHeader();
				this._renderForm();
				// Refresh the Encounters sidebar list so its status badge flips to
				// SIGNED immediately — without this the list keeps showing the stale
				// UNSIGNED badge until a manual reload (matches the save flow above).
				this.commandService.executeCommand('ciyex.refreshEncounters').catch(() => { /* list may not be open */ });
				// A signed encounter is ready for billing — generate its fee sheet
				// automatically from all the CPT/ICD codes already captured on the
				// encounter (every procedure + the diagnosis pointers).
				await this._autoCreateFeeSheetFromEncounter(procedures, diagnoses);
			} else {
				const err = await res.text().catch(() => 'Unknown error');
				this.notificationService.error(`Failed to sign: ${err}`);
				signBtn.textContent = 'Sign & Lock';
				(signBtn as HTMLButtonElement).disabled = false;
			}
		} catch (e) {
			this.notificationService.error(`Sign error: ${e}`);
			signBtn.textContent = 'Sign & Lock';
			(signBtn as HTMLButtonElement).disabled = false;
		}
	}

	/**
	 * Approach 1 (automatic): when an encounter is signed, build one fee sheet
	 * directly from the codes already captured on the encounter. A single fee
	 * sheet carries ALL of the encounter's procedure (CPT/HCPCS) codes plus all
	 * ICD-10 diagnosis codes, which become the diagnosis pointers that justify
	 * the procedures. No manual step is required.
	 */
	private async _autoCreateFeeSheetFromEncounter(
		procedures?: Array<{ code: string; description: string; units?: number }>,
		diagnoses?: Array<{ code: string; description: string; units?: number }>,
	): Promise<void> {
		if (!this.encounterId || this.encounterId === 'new' || !this.patientId) { return; }

		// Fall back to reading the live form when callers don't pass a snapshot.
		procedures = procedures ?? this._encounterCodeList('procedure');
		diagnoses = diagnoses ?? this._encounterCodeList('diagnosis');

		if (procedures.length === 0) {
			this.notificationService.warn('Encounter signed. No CPT/procedure code was captured, so no fee sheet was created.');
			return;
		}

		// A single fee sheet captures ALL of the encounter's codes: every
		// CPT/HCPCS procedure plus every ICD-10 diagnosis. Each procedure line is
		// justified by the full diagnosis pointer list.
		const justify = diagnoses.map(d => d.code).join(', ');
		const items: Array<Record<string, unknown>> = [
			...procedures.map(p => ({ type: 'CPT', code: p.code, description: p.description || '', modifiers: '', price: 0, qty: p.units || 1, justify, note: '', auth: false })),
			...diagnoses.map(d => ({ type: 'ICD10', code: d.code, description: d.description || '', modifiers: '', price: 0, qty: 1, justify: '', note: '', auth: false })),
		];

		try {
			// Don't create a duplicate if a fee sheet already exists for this encounter.
			const existingRes = await this.apiService.fetch(`/api/fee-sheets/encounter/${encodeURIComponent(this.encounterId)}`)
				.then(async r => r.ok ? await r.json() : null).catch(() => null);
			const existing = (existingRes?.data ?? existingRes) as Record<string, unknown> | null;
			if (existing && existing.id) {
				this.notificationService.info(`Encounter signed. A fee sheet (#${existing.id}) already exists for this encounter.`);
				return;
			}

			const payload = {
				encounterId: this.encounterId,
				patientId: this.patientId,
				patientName: this.patientName,
				priceLevel: '',
				renderingProvider: null,
				supervisingProvider: null,
				total: 0,
				items,
			};
			const res = await this.apiService.fetch('/api/fee-sheets', { method: 'POST', body: JSON.stringify(payload) });
			if (res.ok) {
				const data = await res.json().catch(() => ({}));
				const fs = (data?.data ?? data) as Record<string, unknown>;
				this.notificationService.info(`Fee sheet #${fs?.id ?? ''} created from ${procedures.length} procedure + ${diagnoses.length} ICD code(s).`);
			} else {
				this.notificationService.error(`Encounter signed, but fee sheet creation failed (${res.status}).`);
			}
		} catch (e) {
			this.notificationService.error(`Encounter signed, but fee sheet creation failed: ${e}`);
		}
	}

	/**
	 * Pull the captured procedure (CPT/HCPCS) or diagnosis (ICD-10) codes off
	 * the in-memory encounter form. Prefers the well-known default keys but
	 * falls back to shape detection so tab_field_config overrides still work
	 * (procedure rows carry a `units` field; diagnosis rows don't).
	 */
	private _encounterCodeList(kind: 'procedure' | 'diagnosis'): Array<{ code: string; description: string; units?: number }> {
		const knownKey = kind === 'procedure' ? 'procedures_data' : 'assessment_diagnoses';
		const known = this._complexFields.get(knownKey) ?? this.encounterData[knownKey];
		const isCodeArray = (v: unknown): v is Array<Record<string, unknown>> =>
			Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && (v[0] as Record<string, unknown>).code !== undefined;
		const looksLikeProcedure = (arr: Array<Record<string, unknown>>): boolean => arr[0].units !== undefined;

		let source: Array<Record<string, unknown>> | undefined = isCodeArray(known) ? known : undefined;
		if (!source) {
			for (const value of this._complexFields.values()) {
				if (isCodeArray(value) && looksLikeProcedure(value) === (kind === 'procedure')) { source = value; break; }
			}
		}
		if (!source) { return []; }
		return source
			.map(d => ({ code: String(d.code ?? ''), description: String(d.description ?? ''), units: typeof d.units === 'number' ? d.units : undefined }))
			.filter(d => d.code);
	}

	/** Find the first date field whose typed value isn't a real calendar date
	 *  (createUsDateField marks the hidden input with `dataset.invalid='1'`).
	 *  Returns the visible/hidden pair so the caller can focus the field. */
	private _findInvalidDateInput(): { hidden: HTMLInputElement; visible: HTMLInputElement } | null {
		for (const ref of this._dateFieldRefs) {
			if (ref.hidden.dataset.invalid === '1') { return ref; }
		}
		return null;
	}

	private _collectFormData(): Record<string, unknown> {
		const formData: Record<string, unknown> = {};
		for (const [, card] of this.sectionCards) {
			const walk = (el: HTMLElement) => {
				for (let i = 0; i < el.children.length; i++) {
					const child = el.children[i] as HTMLElement;
					const tag = child.tagName;
					if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
						const inp = child as HTMLInputElement;
						const key = inp.dataset.key || inp.id || inp.name || '';
						if (key) {
							if (inp.type === 'checkbox') {
								formData[key] = inp.checked;
							} else {
								formData[key] = inp.value;
							}
						}
					}
					if (child.children.length > 0) { walk(child); }
				}
			};
			walk(card);
		}
		// Merge in the complex field values (diagnosis/procedure lists, plan
		// items, grids) that aren't backed by DOM inputs. Issue #1: the
		// Diagnosis (ICD-10) and CPT/HCPCS codes were edited as in-memory arrays
		// that the DOM walk never saw, so they were silently dropped on save.
		for (const [key, value] of this._complexFields) {
			formData[key] = value;
		}
		return formData;
	}

	// --- Auto-save ---

	private _setupAutoSave(): void {
		// Listen for input changes in scrollArea
		this.scrollArea.addEventListener('input', () => this._onFormChange());
		this.scrollArea.addEventListener('change', () => this._onFormChange());
	}

	private _onFormChange(): void {
		if (this._isSigned) { return; }
		this._isDirty = true;
		this._updateAutoSaveIndicator('Unsaved changes');

		if (this._autoSaveTimer) { clearTimeout(this._autoSaveTimer); }
		this._autoSaveTimer = setTimeout(() => this._autoSave(), 3000);
	}

	private async _autoSave(): Promise<void> {
		if (!this._isDirty || this._isSigned) { return; }
		if (!(this.input instanceof EncounterFormEditorInput)) { return; }
		const { patientId } = this.input;
		const encounterId = this.encounterId;
		// Don't auto-create a real encounter on a timer — that would mint a new
		// Encounter on every keystroke pause. The explicit Save resolves "new".
		if (!encounterId || encounterId === 'new' || !patientId) { return; }

		this._updateAutoSaveIndicator('Auto-saving...');

		const formData = this._collectFormData();
		try {
			// Same patient-scope rule as _saveEncounter: write under the id the
			// Composition was found under so all surfaces share one Composition.
			const compPatientId = this._compositionPatientId || patientId;
			let res: Response;
			if (this._compositionId) {
				res = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${compPatientId}/${this._compositionId}`, {
					method: 'PUT',
					body: JSON.stringify(formData),
				});
			} else {
				res = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${compPatientId}?encounterRef=${encounterId}`, {
					method: 'POST',
					body: JSON.stringify(formData),
				});
				if (res.ok) {
					const compData = await res.json();
					this._compositionId = String(compData?.data?.id || compData?.id || '');
				}
			}
			if (res.ok) {
				this._isDirty = false;
				this._updateAutoSaveIndicator('Auto-saved');
				// Same cross-editor broadcast as the explicit Save, so a sibling
				// editor on this encounter reflects auto-saved data too.
				this.apiService.notifyClinicalRecordMutation({
					entity: 'encounter-form', patientId, kind: 'update',
					record: { encounterId, sourceId: this._editorInstanceId },
				});
			} else {
				this._updateAutoSaveIndicator('Auto-save failed');
			}
		} catch {
			this._updateAutoSaveIndicator('Auto-save failed');
		}
	}

	private _updateAutoSaveIndicator(text: string): void {
		if (this._autoSaveIndicator) {
			this._autoSaveIndicator.textContent = text;
			if (text.includes('failed') || text === 'Unsaved changes') {
				this._autoSaveIndicator.style.color = '#f59e0b';
			} else {
				this._autoSaveIndicator.style.color = 'var(--vscode-descriptionForeground)';
			}
		}
	}

	private _renderToc(): void {
		DOM.clearNode(this.tocNav);
		this.tocItems = [];

		const heading = DOM.append(this.tocNav, DOM.$('div'));
		heading.textContent = 'SECTIONS';
		heading.style.cssText = 'padding:4px 14px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';

		for (const sec of this.formSections) {
			if (sec.visible === false) { continue; }
			const secIcon = EncounterFormEditor._sectionIcon(sec);

			const item = DOM.append(this.tocNav, DOM.$('div'));
			item.setAttribute('data-toc', sec.key);
			item.style.cssText = 'padding:4px 14px 4px 16px;cursor:pointer;color:var(--vscode-foreground);border-left:2px solid transparent;display:flex;align-items:center;gap:6px;font-size:13px;';

			if (secIcon) {
				const iconEl = DOM.append(item, DOM.$('span'));
				iconEl.textContent = secIcon;
				iconEl.style.cssText = 'font-size:13px;width:18px;text-align:center;flex-shrink:0;';
			}

			const label = DOM.append(item, DOM.$('span'));
			label.textContent = sec.title;
			label.style.cssText = 'flex:1;opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			if (sec.fields.some(f => f.required)) {
				const req = DOM.append(item, DOM.$('span'));
				req.textContent = '*';
				req.style.cssText = 'color:#ef4444;font-weight:700;font-size:11px;';
			}

			item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
			item.addEventListener('mouseleave', () => { if (!item.classList.contains('active')) { item.style.background = ''; } });
			item.addEventListener('click', () => {
				const el = this.sectionCards.get(sec.key);
				if (!el) { return; }
				// Auto-expand the section before scrolling — sections like
				// "Procedures & Coding" default to collapsed, so a TOC click
				// previously appeared to do nothing because the body
				// (display:none) was still hidden after scrolling.
				const body = el.children[1] as HTMLElement | undefined;
				const header = el.children[0] as HTMLElement | undefined;
				if (body && header && body.style.display === 'none') {
					header.click();
				}
				// Compute the section's top relative to the scrollArea by
				// walking offsetParents until we hit the scroll container. The
				// previous "el.offsetTop - scrollArea.offsetTop" subtraction
				// was wrong (different offsetParents), which is why the last
				// section ("Procedures & Coding") appeared to do nothing —
				// the calculated scroll target was usually below the actual
				// section.
				let top = 0;
				let node: HTMLElement | null = el;
				while (node && node !== this.scrollArea) {
					top += node.offsetTop;
					node = node.offsetParent as HTMLElement | null;
				}
				this.scrollArea.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
			});

			this.tocItems.push({ key: sec.key, el: item });
		}
	}

	private _setupScrollSync(): void {
		const cardTopWithin = (card: HTMLElement): number => {
			let top = 0;
			let node: HTMLElement | null = card;
			while (node && node !== this.scrollArea) {
				top += node.offsetTop;
				node = node.offsetParent as HTMLElement | null;
			}
			return top;
		};
		this.scrollArea.addEventListener('scroll', () => {
			let activeKey = '';
			const scrollTop = this.scrollArea.scrollTop + 20;
			for (const [key, card] of this.sectionCards) {
				if (cardTopWithin(card) <= scrollTop) {
					activeKey = key;
				}
			}
			this.tocItems.forEach(({ key, el }) => {
				const isActive = key === activeKey;
				el.style.borderLeftColor = isActive ? 'var(--vscode-focusBorder, #007acc)' : 'transparent';
				el.style.background = isActive ? 'var(--vscode-list-activeSelectionBackground, rgba(0,120,212,0.1))' : '';
				el.style.fontWeight = isActive ? '600' : '';
				if (isActive) { el.classList.add('active'); } else { el.classList.remove('active'); }
			});

			const activeItem = this.tocItems.find(t => t.el.classList.contains('active'));
			if (activeItem) {
				activeItem.el.scrollIntoView({ block: 'nearest' });
			}
		});
	}

	private static ROS_SYSTEMS = ['Constitutional', 'Eyes', 'ENT', 'Cardiovascular', 'Respiratory', 'GI', 'GU', 'Musculoskeletal', 'Skin', 'Neurological', 'Psychiatric', 'Endocrine', 'Hematologic/Lymphatic', 'Allergic/Immunologic'];
	private static PE_SYSTEMS: Array<{ system: string; normal: string }> = [
		{ system: 'General Appearance', normal: 'Well-appearing, in no acute distress' },
		{ system: 'HEENT', normal: 'Normocephalic, PERRL, TMs clear, oropharynx normal' },
		{ system: 'Neck', normal: 'Supple, no lymphadenopathy, no thyromegaly' },
		{ system: 'Chest/Lungs', normal: 'Clear to auscultation bilaterally, no wheezes/rhonchi/rales' },
		{ system: 'Cardiovascular', normal: 'RRR, no murmurs/gallops/rubs, pulses intact' },
		{ system: 'Abdomen', normal: 'Soft, non-tender, non-distended, BS active' },
		{ system: 'Extremities', normal: 'No edema, no cyanosis, full ROM' },
		{ system: 'Neurological', normal: 'Alert, oriented x4, CN II-XII intact, sensation normal' },
		{ system: 'Skin', normal: 'Warm, dry, intact, no rashes or lesions' },
		{ system: 'Psychiatric', normal: 'Appropriate mood and affect, cooperative' },
	];

	private _renderForm(): void {
		DOM.clearNode(this.scrollArea);

		const container = DOM.append(this.scrollArea, DOM.$('div'));
		container.style.cssText = 'max-width:900px;margin:0 auto;padding:16px 24px 60px;';
		this.sectionCards.clear();
		this._dateFieldRefs = [];
		this._complexFields.clear();

		const readOnly = this._isSigned;

		// Track inputs by field key so post-render hooks (BMI auto-calc, etc.)
		// don't have to walk the DOM. Cleared on every re-render.
		const renderedInputs = new Map<string, HTMLInputElement>();

		for (const sec of this.formSections) {
			if (sec.visible === false) { continue; }

			const cols = Math.min(sec.columns || 1, 4);

			const card = DOM.append(container, DOM.$('div'));
			card.setAttribute('data-section', sec.key);
			this.sectionCards.set(sec.key, card);
			card.style.cssText = 'margin-bottom:14px;border:1px solid var(--vscode-editorWidget-border);border-left:3px solid var(--vscode-focusBorder,#007acc);border-radius:6px;overflow:hidden;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));box-shadow:0 1px 3px rgba(0,0,0,0.15);';

			// Header (collapsible)
			const header = DOM.append(card, DOM.$('div'));
			header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 14px;background:rgba(0,122,204,0.12);border-bottom:1px solid rgba(0,122,204,0.2);cursor:pointer;user-select:none;';

			const chevron = DOM.append(header, DOM.$('span'));
			chevron.style.cssText = 'font-size:10px;transition:transform 0.15s;';

			const secIcon = EncounterFormEditor._sectionIcon(sec);
			if (secIcon) {
				const iconEl = DOM.append(header, DOM.$('span'));
				iconEl.textContent = secIcon;
				iconEl.style.cssText = 'font-size:14px;';
			}

			const titleEl = DOM.append(header, DOM.$('span'));
			titleEl.textContent = sec.title;
			titleEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);flex:1;';

			if (sec.fields.some(f => f.required)) {
				const req = DOM.append(header, DOM.$('span'));
				req.textContent = '*';
				req.style.cssText = 'color:#EF5350;font-weight:700;';
			}

			// Body
			const body = DOM.append(card, DOM.$('div'));
			body.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:6px 16px;padding:14px;`;

			// Collapse toggle
			let collapsed = !!sec.collapsed;
			const applyCollapse = () => {
				body.style.display = collapsed ? 'none' : 'grid';
				chevron.textContent = collapsed ? '\u25B6' : '\u25BC';
			};
			applyCollapse();
			if (sec.collapsible !== false) {
				header.addEventListener('click', () => { collapsed = !collapsed; applyCollapse(); });
			}

			// Render fields
			for (const f of sec.fields) {
				const val = (this.encounterData as Record<string, unknown>)[f.key] ?? '';
				const cell = DOM.append(body, DOM.$('div'));
				cell.style.cssText = `grid-column:span ${Math.min(f.colSpan || 1, cols)};`;

				// Special field types
				if (f.type === 'ros-grid') { this._renderRosGrid(cell, f.key, readOnly); continue; }
				if (f.type === 'exam-grid') { this._renderExamGrid(cell, f.key, readOnly); continue; }
				if (f.type === 'diagnosis-list') { this._renderDiagnosisList(cell, f.key, readOnly); continue; }
				if (f.type === 'plan-items') { this._renderPlanItems(cell, f.key, readOnly); continue; }
				if (f.type === 'procedure-list') { this._renderProcedureList(cell, f.key, readOnly); continue; }

				// Standard field label
				const lbl = DOM.append(cell, DOM.$('label'));
				lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px;';
				const lblText = DOM.append(lbl, DOM.$('span'));
				lblText.textContent = f.label;
				if (f.required) {
					const req = DOM.append(lbl, DOM.$('span'));
					req.textContent = ' *';
					req.style.cssText = 'color:#EF5350;';
				}

				const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;transition:border-color 0.15s;';
				const focusCss = 'border-color:var(--vscode-focusBorder,#007acc);box-shadow:0 0 0 1px var(--vscode-focusBorder,#007acc);';
				const addFocus = (el: HTMLElement) => {
					el.addEventListener('focus', () => { el.style.cssText = inputStyle + (el.tagName === 'TEXTAREA' ? 'min-height:80px;resize:vertical;' : el.tagName === 'SELECT' ? 'height:32px;cursor:pointer;' : 'height:32px;') + focusCss; });
					el.addEventListener('blur', () => { el.style.cssText = inputStyle + (el.tagName === 'TEXTAREA' ? 'min-height:80px;resize:vertical;' : el.tagName === 'SELECT' ? 'height:32px;cursor:pointer;' : 'height:32px;'); });
				};

				if (f.type === 'select') {
					// Custom dropdown — replaces native <select> so options
					// remain readable on dark workbench themes (native option
					// popups inherit the OS colour scheme, which produces
					// faint grey-on-grey text the QA team flagged).
					const sel = createCustomDropdown({
						parent: cell,
						options: f.options || [],
						initialValue: String(val),
						placeholder: `Select ${f.label}...`,
						triggerStyle: inputStyle + 'height:32px;cursor:pointer;',
					});
					sel.dataset.key = f.key;
					if (readOnly) { sel.disabled = true; }
				} else if (f.type === 'textarea') {
					const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
					ta.dataset.key = f.key;
					ta.value = String(val);
					ta.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					ta.style.cssText = inputStyle + 'min-height:80px;resize:vertical;';
					if (readOnly) { ta.readOnly = true; ta.style.opacity = '0.7'; }
					addFocus(ta);
				} else if (f.type === 'boolean' || f.type === 'toggle') {
					const cb = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					cb.type = 'checkbox'; cb.checked = !!val;
					cb.dataset.key = f.key;
					cb.style.cssText = 'width:18px;height:18px;cursor:pointer;';
					if (readOnly) { cb.disabled = true; }
				} else if (f.type === 'number') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'number'; inp.value = String(val); inp.placeholder = f.placeholder || '';
					inp.dataset.key = f.key;
					inp.style.cssText = inputStyle + 'height:32px;';
					if (readOnly) { inp.readOnly = true; inp.style.opacity = '0.7'; }
					addFocus(inp);
					renderedInputs.set(f.key, inp);
				} else if (f.type === 'datetime') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'datetime-local';
					inp.value = String(val).split('T')[0];
					inp.dataset.key = f.key;
					inp.style.cssText = inputStyle + 'height:32px;cursor:pointer;';
					if (readOnly) { inp.readOnly = true; inp.style.opacity = '0.7'; } else { enablePickerClick(inp); }
					addFocus(inp);
				} else if (f.type === 'date') {
					// MM/DD/YYYY masked field with calendar picker and real-date
					// validation (rejects 13/33/2000) instead of a native
					// <input type="date">, which renders OS-locale order on Linux
					// Electron and accepts impossible dates. The hidden input carries
					// the ISO value and is collected by its dataset.key.
					const dateDoc = cell.ownerDocument || document;
					const { hidden, visible, picker } = createUsDateField(dateDoc, cell, String(val).split('T')[0], inputStyle + 'height:32px;');
					hidden.dataset.key = f.key;
					addFocus(visible);
					// Track the visible/hidden pair so the save guard can find an
					// invalid date and focus it without DOM selectors (hygiene).
					this._dateFieldRefs.push({ hidden, visible });
					if (readOnly) {
						for (const el of [visible, picker]) {
							el.readOnly = true;
							el.style.opacity = '0.7';
							el.style.pointerEvents = 'none';
						}
					}
				} else {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'text'; inp.value = String(val); inp.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					inp.dataset.key = f.key;
					inp.style.cssText = inputStyle + 'height:32px;';
					if (readOnly) { inp.readOnly = true; inp.style.opacity = '0.7'; }
					addFocus(inp);
					// Register text-typed weight/height/BMI fields too — the
					// backend tab_field_config sometimes ships these as plain
					// text, which previously prevented BMI auto-calc from
					// finding them. (Issue #15)
					renderedInputs.set(f.key, inp);
				}
			}
		}

		// Vitals BMI auto-calc — exact same formula as EHR-UI's Vitalsform.
		// Weight in kg, Height in cm: BMI = w / (h/100)^2. Recalc on either
		// input changing; lock the BMI cell so the user can't type over the
		// derived value. Issue #14: the backend tab_field_config sometimes
		// drops the `vitals_` prefix, so we look up both variants.
		const pickInput = (...keys: string[]): HTMLInputElement | undefined => {
			for (const k of keys) {
				const el = renderedInputs.get(k);
				if (el) { return el; }
			}
			return undefined;
		};
		// Fallback that scans every form section for a field whose label
		// starts/ends with a given word (case-insensitive). Used when the
		// backend tab_field_config invents its own field keys (e.g. just
		// `weight`/`height`/`bmi` without a vitals_ prefix or in some other
		// custom shape). Issue #15: BMI never auto-calculated because the
		// hardcoded key list missed those backend variants.
		const pickByLabel = (rx: RegExp): HTMLInputElement | undefined => {
			for (const sec of this.formSections) {
				for (const f of sec.fields || []) {
					if (rx.test(f.label || '')) {
						const el = renderedInputs.get(f.key);
						if (el) { return el; }
					}
				}
			}
			return undefined;
		};
		const weightKg = pickInput('vitals_weight', 'weight', 'weightKg', 'bodyWeight')
			|| pickByLabel(/^\s*weight\b/i);
		const heightCm = pickInput('vitals_height', 'height', 'heightCm', 'bodyHeight')
			|| pickByLabel(/^\s*height\b/i);
		const bmi = pickInput('vitals_bmi', 'bmi', 'bodyMassIndex')
			|| pickByLabel(/^\s*bmi\b|body\s*mass\s*index/i);
		if (weightKg && heightCm && bmi) {
			bmi.readOnly = true;
			bmi.style.background = 'rgba(128,128,128,0.06)';
			bmi.placeholder = 'Auto-calculated';
			const recalc = () => {
				const w = parseFloat(weightKg.value);
				const h = parseFloat(heightCm.value);
				if (!isNaN(w) && !isNaN(h) && h > 0) {
					const heightM = h / 100;
					bmi.value = (w / (heightM * heightM)).toFixed(1);
				} else {
					bmi.value = '';
				}
			};
			weightKg.addEventListener('input', recalc);
			heightCm.addEventListener('input', recalc);
			recalc();
		}
	}

	/** ROS: multi-system checkbox grid */
	private _renderRosGrid(parent: HTMLElement, dataKey: string, readOnly: boolean): void {
		const rosData = (this.encounterData[dataKey] || {}) as Record<string, string>;
		const grid = DOM.append(parent, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:4px;';

		const checkboxes: HTMLInputElement[] = [];
		for (const system of EncounterFormEditor.ROS_SYSTEMS) {
			const sysKey = system.toLowerCase().replace(/[^a-z]/g, '_');
			const row = DOM.append(grid, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;background:rgba(128,128,128,0.05);';

			const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = rosData[sysKey] === 'positive' || rosData[sysKey] === 'abnormal';
			cb.dataset.key = `ros_${sysKey}`;
			cb.style.cssText = 'width:16px;height:16px;cursor:pointer;flex-shrink:0;';
			if (readOnly) { cb.disabled = true; }
			checkboxes.push(cb);

			const label = DOM.append(row, DOM.$('span'));
			label.textContent = system;
			label.style.cssText = 'font-size:12px;flex:1;';

			const noteInput = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			noteInput.type = 'text';
			noteInput.value = typeof rosData[sysKey] === 'string' && rosData[sysKey] !== 'positive' && rosData[sysKey] !== 'negative' && rosData[sysKey] !== 'abnormal' ? rosData[sysKey] : '';
			noteInput.placeholder = 'Findings...';
			noteInput.dataset.key = `ros_${sysKey}_note`;
			noteInput.style.cssText = 'width:120px;padding:2px 6px;font-size:11px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);';
			if (readOnly) { noteInput.readOnly = true; noteInput.style.opacity = '0.7'; }
		}

		if (!readOnly) {
			const allNorm = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
			allNorm.textContent = 'Mark All Negative / Normal';
			allNorm.style.cssText = 'margin-top:6px;padding:4px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;';
			allNorm.addEventListener('click', () => { for (const cb of checkboxes) { cb.checked = false; } });
		}
	}

	/** Physical Exam: system-by-system exam grid */
	private _renderExamGrid(parent: HTMLElement, dataKey: string, readOnly: boolean): void {
		const peData = (this.encounterData[dataKey] || {}) as Record<string, string>;
		const peCheckboxes: HTMLInputElement[] = [];
		const peTextareas: HTMLTextAreaElement[] = [];

		for (const { system, normal } of EncounterFormEditor.PE_SYSTEMS) {
			const sysKey = system.toLowerCase().replace(/[^a-z]/g, '_');
			const row = DOM.append(parent, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.1);';

			const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = !peData[sysKey] || peData[sysKey] === normal;
			cb.title = 'Normal';
			cb.dataset.key = `pe_${sysKey}_normal`;
			cb.style.cssText = 'width:16px;height:16px;cursor:pointer;margin-top:2px;flex-shrink:0;';
			if (readOnly) { cb.disabled = true; }
			peCheckboxes.push(cb);

			const label = DOM.append(row, DOM.$('span'));
			label.textContent = system;
			label.style.cssText = 'font-size:12px;font-weight:600;width:120px;flex-shrink:0;padding-top:2px;';

			const ta = DOM.append(row, DOM.$('textarea')) as HTMLTextAreaElement;
			ta.value = peData[sysKey] || normal;
			ta.dataset.key = `pe_${sysKey}`;
			ta.style.cssText = 'flex:1;padding:4px 8px;font-size:12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);resize:vertical;min-height:28px;';
			if (readOnly) { ta.readOnly = true; ta.style.opacity = '0.7'; }
			peTextareas.push(ta);

			cb.addEventListener('change', () => { if (cb.checked) { ta.value = normal; } });
		}

		if (!readOnly) {
			const allNorm = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
			allNorm.textContent = 'Set All Normal';
			allNorm.style.cssText = 'margin-top:6px;padding:4px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;';
			allNorm.addEventListener('click', () => {
				for (const cb of peCheckboxes) { cb.checked = true; }
				for (let i = 0; i < EncounterFormEditor.PE_SYSTEMS.length; i++) {
					if (peTextareas[i]) { peTextareas[i].value = EncounterFormEditor.PE_SYSTEMS[i].normal; }
				}
			});
		}
	}

	/** Diagnosis list with ICD-10 search */
	private _renderDiagnosisList(parent: HTMLElement, dataKey: string, readOnly: boolean): void {
		const diagnoses = (this.encounterData[dataKey] || []) as Array<{ code: string; description: string }>;
		// Register the live array so edits persist on save (issue #1).
		this._complexFields.set(dataKey, diagnoses);

		// Order matches the EHR-UI Assessment & Diagnosis layout:
		//   1. "Diagnosis" label
		//   2. ICD-10 search input
		//   3. Search results dropdown (overlays below the input, absolutely
		//      positioned so it doesn't displace the Assessment Notes textarea
		//      or any section below).
		//   4. Selected-diagnoses list
		const labelEl = readOnly ? null : DOM.append(parent, DOM.$('label'));
		if (labelEl) {
			labelEl.textContent = 'Diagnosis';
			labelEl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;margin:0 0 4px;';
		}

		// Wrap the search input + dropdown in a position:relative container so
		// the results panel can absolutely-overlay BELOW the input rather than
		// flowing inline and pushing the rest of the form down.
		const searchWrap = readOnly ? null : DOM.append(parent, DOM.$('div'));
		if (searchWrap) {
			searchWrap.style.cssText = 'position:relative;';
		}
		const searchRow = searchWrap ? DOM.append(searchWrap, DOM.$('div')) : null;
		const results = searchWrap ? DOM.append(searchWrap, DOM.$('div')) : null;
		if (results) {
			results.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:50;background:var(--vscode-dropdown-background,var(--vscode-editorWidget-background,var(--vscode-editor-background)));border:1px solid var(--vscode-dropdown-border,var(--vscode-editorWidget-border));border-radius:4px;margin-top:2px;max-height:280px;overflow-y:auto;display:none;box-shadow:0 4px 8px rgba(0,0,0,0.2);';
		}

		const listEl = DOM.append(parent, DOM.$('div'));
		listEl.style.cssText = 'margin-top:8px;';

		const renderList = () => {
			DOM.clearNode(listEl);
			for (let i = 0; i < diagnoses.length; i++) {
				const dx = diagnoses[i];
				const row = DOM.append(listEl, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(128,128,128,0.1);';

				const code = DOM.append(row, DOM.$('span'));
				code.textContent = dx.code;
				code.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-textLink-foreground);width:80px;';

				const desc = DOM.append(row, DOM.$('span'));
				desc.textContent = dx.description;
				desc.style.cssText = 'font-size:12px;flex:1;';

				if (!readOnly) {
					const removeBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
					removeBtn.textContent = '\u2715';
					removeBtn.style.cssText = 'padding:2px 6px;background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;';
					removeBtn.addEventListener('click', () => { diagnoses.splice(i, 1); this._isDirty = true; renderList(); });
				}
			}
		};
		renderList();

		if (readOnly || !searchRow || !results) { return; }

		searchRow.style.cssText = 'display:flex;gap:8px;';
		const searchInput = DOM.append(searchRow, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = 'Search ICD-10 codes...';
		searchInput.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		let timer: ReturnType<typeof setTimeout> | undefined;
		searchInput.addEventListener('input', () => {
			if (timer) { clearTimeout(timer); }
			const q = searchInput.value;
			if (q.length < 2) { results.style.display = 'none'; return; }
			timer = setTimeout(async () => {
				try {
					// Search the full ICD-10-CM catalog via the ciyex-codes
					// service (~98K codes). The previous /api/global_codes
					// endpoint only returned org-level custom codes (FHIR
					// Basic resource), which is empty by default — that's why
					// the test team's diagnosis search dropdown was always
					// blank. Use the same `code-search` endpoint that the
					// patient chart's _buildSearchInput uses.
					const res = await this.apiService.fetch(`/api/app-proxy/ciyex-codes/api/codes/ICD10_CM/search?q=${encodeURIComponent(q)}&page=0&size=15`);
					if (res.ok) {
						const data = await res.json();
						const codes = data?.data?.content || data?.content || data?.data || [];
						DOM.clearNode(results);
						const list = Array.isArray(codes) ? codes : [];
						for (const c of list) {
							const item = DOM.append(results, DOM.$('div'));
							item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);display:flex;align-items:center;gap:10px;';
							const codeEl = DOM.append(item, DOM.$('span'));
							codeEl.textContent = String(c.code || c.codeValue || '');
							codeEl.style.cssText = 'font-weight:600;color:var(--vscode-textLink-foreground);min-width:60px;font-family:var(--vscode-editor-font-family,monospace);';
							const descEl = DOM.append(item, DOM.$('span'));
							descEl.textContent = String(c.shortDescription || c.description || c.longDescription || '');
							descEl.style.cssText = 'flex:1;color:var(--vscode-foreground);';
							item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
							item.addEventListener('mouseleave', () => { item.style.background = ''; });
							item.addEventListener('click', () => {
								diagnoses.push({
									code: String(c.code || c.codeValue || ''),
									description: String(c.shortDescription || c.description || c.longDescription || ''),
								});
								// Adding a diagnosis is an edit: mark dirty so it is saved
								// (and so signing saves first instead of discarding it).
								this._isDirty = true;
								renderList();
								searchInput.value = '';
								results.style.display = 'none';
							});
						}
						results.style.display = list.length > 0 ? 'block' : 'none';
					}
				} catch { /* */ }
			}, 300);
		});
	}

	/** Plan items: structured add/remove list mirroring the EHR-UI `PlanItems`
	 *  component \u2014 each row is `{ type, description, notes }` with a type dropdown
	 *  (Medication / Procedure / Lab Order / Referral / Follow-up / Other), a
	 *  description input and an optional notes input. Legacy values (newline-joined
	 *  string or string[] rows written by older builds / the snapshot drawer) are
	 *  upgraded to the object shape so existing compositions still load and re-save. */
	private _renderPlanItems(parent: HTMLElement, dataKey: string, readOnly: boolean): void {
		const typeOptions: Array<{ value: string; label: string }> = [
			{ value: 'medication', label: 'Medication' },
			{ value: 'procedure', label: 'Procedure' },
			{ value: 'lab', label: 'Lab Order' },
			{ value: 'referral', label: 'Referral' },
			{ value: 'follow-up', label: 'Follow-up' },
			{ value: 'other', label: 'Other' },
		];
		const toItem = (v: unknown): PlanItemRow | null => {
			if (typeof v === 'string') {
				const s = v.replace(/^\d+\.\s*/, '').trim();
				return s ? { type: 'other', description: s, notes: '' } : null;
			}
			if (v && typeof v === 'object') {
				const o = v as Record<string, unknown>;
				const description = String(o.description ?? o.text ?? o.item ?? '').trim();
				const type = String(o.type ?? 'other').trim().toLowerCase() || 'other';
				const notes = String(o.notes ?? '').trim();
				return (description || notes) ? { type, description, notes } : null;
			}
			return null;
		};
		// Normalise to a real array of plan-item objects, write it back onto
		// encounterData and register it in _complexFields \u2014 only _complexFields
		// entries are merged into the save payload (the DOM walk skips these rows).
		const raw = this.encounterData[dataKey];
		const rawList: unknown[] = Array.isArray(raw)
			? raw
			: (typeof raw === 'string' && raw.trim() ? raw.split('\n') : []);
		const items: PlanItemRow[] = rawList.map(toItem).filter((i): i is PlanItemRow => !!i);
		this.encounterData[dataKey] = items;
		this._complexFields.set(dataKey, items);
		const listEl = DOM.append(parent, DOM.$('div'));

		const renderList = () => {
			DOM.clearNode(listEl);
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const row = DOM.append(listEl, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:6px 8px;margin-bottom:6px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;background:var(--vscode-editorWidget-background,rgba(128,128,128,0.06));';

				const typeSel = DOM.append(row, DOM.$('select')) as HTMLSelectElement;
				typeSel.style.cssText = 'min-width:110px;padding:4px 6px;font-size:12px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-dropdown-border,var(--vscode-input-border,#3c3c3c));border-radius:3px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));';
				for (const opt of typeOptions) {
					const o = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
					o.value = opt.value;
					o.textContent = opt.label;
				}
				// Preserve a type value outside the known list instead of silently
				// snapping it to the first option.
				if (!typeOptions.some(o => o.value === item.type)) {
					const o = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
					o.value = item.type;
					o.textContent = item.type;
				}
				typeSel.value = item.type;
				typeSel.disabled = readOnly;
				typeSel.addEventListener('change', () => { item.type = typeSel.value; });

				const fieldCol = DOM.append(row, DOM.$('div'));
				fieldCol.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;';

				const descInp = DOM.append(fieldCol, DOM.$('input')) as HTMLInputElement;
				descInp.type = 'text';
				descInp.value = item.description;
				descInp.placeholder = 'Description...';
				descInp.style.cssText = 'width:100%;padding:4px 8px;font-size:12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);box-sizing:border-box;';
				descInp.addEventListener('input', () => { item.description = descInp.value; });

				const notesInp = DOM.append(fieldCol, DOM.$('input')) as HTMLInputElement;
				notesInp.type = 'text';
				notesInp.value = item.notes;
				notesInp.placeholder = 'Notes (optional)...';
				notesInp.style.cssText = 'width:100%;padding:3px 8px;font-size:11px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);opacity:0.9;box-sizing:border-box;';
				notesInp.addEventListener('input', () => { item.notes = notesInp.value; });

				if (readOnly) {
					descInp.readOnly = true; descInp.style.opacity = '0.7';
					notesInp.readOnly = true; notesInp.style.opacity = '0.6';
				} else {
					const removeBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
					removeBtn.textContent = '\u2715';
					removeBtn.title = 'Remove plan item';
					removeBtn.style.cssText = 'padding:2px 6px;background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;flex-shrink:0;';
					removeBtn.addEventListener('click', () => { items.splice(i, 1); this._isDirty = true; renderList(); });
				}
			}
		};
		renderList();

		if (!readOnly) {
			const addBtn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
			addBtn.textContent = '+ Add Plan Item';
			addBtn.style.cssText = 'margin-top:6px;padding:4px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;';
			addBtn.addEventListener('click', () => {
				items.push({ type: 'other', description: '', notes: '' });
				this._isDirty = true;
				renderList();
				// Focus the freshly-added row's description input.
				const lastRow = listEl.lastElementChild;
				const col = lastRow ? Array.from(lastRow.children).find(c => c.tagName === 'DIV') : undefined;
				const inp = col ? Array.from(col.children).find(c => c.tagName === 'INPUT') as HTMLInputElement | undefined : undefined;
				inp?.focus();
			});
		}
	}

	/** Procedures & Coding list */
	private _renderProcedureList(parent: HTMLElement, dataKey: string, readOnly: boolean): void {
		const procs = (this.encounterData[dataKey] || []) as Array<{ code: string; description: string; units: number }>;
		// Register the live array so CPT/HCPCS edits persist on save (issue #1).
		this._complexFields.set(dataKey, procs);

		// Container for the CPT/HCPCS code-search rows. Mounted BEFORE the
		// selected-procedures list so the search inputs sit at the top of the
		// section and the list grows downward — matches the EHR-UI Procedures
		// & Coding layout (the previous order rendered the empty list slot
		// first, which pushed the Procedure Notes textarea below the search
		// rows even when no procedures were selected).
		const searchContainer = readOnly ? null : DOM.append(parent, DOM.$('div'));
		const listEl = DOM.append(parent, DOM.$('div'));
		listEl.style.cssText = 'margin-top:8px;';

		const renderList = () => {
			DOM.clearNode(listEl);
			for (let i = 0; i < procs.length; i++) {
				const p = procs[i];
				const row = DOM.append(listEl, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(128,128,128,0.1);';

				const code = DOM.append(row, DOM.$('span'));
				code.textContent = p.code;
				code.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-textLink-foreground);width:80px;';

				const desc = DOM.append(row, DOM.$('span'));
				desc.textContent = p.description;
				desc.style.cssText = 'font-size:12px;flex:1;';

				const units = DOM.append(row, DOM.$('span'));
				units.textContent = `x${p.units || 1}`;
				units.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

				if (!readOnly) {
					const removeBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
					removeBtn.textContent = '\u2715';
					removeBtn.style.cssText = 'padding:2px 6px;background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;';
					removeBtn.addEventListener('click', () => { procs.splice(i, 1); this._isDirty = true; renderList(); });
				}
			}
		};
		renderList();

		if (readOnly || !searchContainer) { return; }

		// Single unified CPT + HCPCS search to match the web app. Queries both
		// catalogs in parallel and tags each row with its source so the user
		// can pick from either system without switching inputs.
		const lbl = DOM.append(searchContainer, DOM.$('label'));
		lbl.textContent = 'Procedure Codes';
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;margin:8px 0 4px;';

		// Wrap the input + dropdown in a relative container so the results
		// list can overlay below the input rather than push Procedure Notes
		// (and the selected-procedures list) downward.
		const searchWrap = DOM.append(searchContainer, DOM.$('div'));
		searchWrap.style.cssText = 'position:relative;';
		const searchRow = DOM.append(searchWrap, DOM.$('div'));
		searchRow.style.cssText = 'display:flex;gap:8px;';
		const searchInput = DOM.append(searchRow, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = 'Search CPT codes and HCPCS codes';
		searchInput.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		const results = DOM.append(searchWrap, DOM.$('div'));
		results.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:50;background:var(--vscode-dropdown-background,var(--vscode-editorWidget-background,var(--vscode-editor-background)));border:1px solid var(--vscode-dropdown-border,var(--vscode-editorWidget-border));border-radius:4px;margin-top:2px;max-height:280px;overflow-y:auto;display:none;box-shadow:0 4px 8px rgba(0,0,0,0.2);';

		const fetchCodes = async (codeType: 'CPT' | 'HCPCS', q: string): Promise<Array<Record<string, unknown>>> => {
			// Try the ciyex-codes proxy first, fall back to org-level global_codes
			const endpoints = [
				`/api/app-proxy/ciyex-codes/api/codes/${codeType}/search?q=${encodeURIComponent(q)}&page=0&size=10`,
				`/api/global_codes?codeType=${codeType === 'HCPCS' ? 'HCPCS' : 'CPT4'}&search=${encodeURIComponent(q)}&page=0&size=10`,
			];
			for (const url of endpoints) {
				try {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { continue; }
					const data = await res.json();
					const raw = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
					if (Array.isArray(raw) && raw.length > 0) { return raw; }
				} catch { /* try next */ }
			}
			return [];
		};

		let timer: ReturnType<typeof setTimeout> | undefined;
		searchInput.addEventListener('input', () => {
			if (timer) { clearTimeout(timer); }
			const q = searchInput.value.trim();
			if (q.length < 2) { results.style.display = 'none'; return; }
			// Show loading state while waiting for results so it's clear the
			// search is happening (test team flagged: "doesn't perform any search
			// option" — they couldn't tell whether the field was broken or
			// just slow).
			DOM.clearNode(results);
			const loading = DOM.append(results, DOM.$('div'));
			loading.textContent = 'Searching...';
			loading.style.cssText = 'padding:14px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
			results.style.display = 'block';
			timer = setTimeout(async () => {
				const [cpt, hcpcs] = await Promise.all([fetchCodes('CPT', q), fetchCodes('HCPCS', q)]);
				const tagged: Array<Record<string, unknown>> = [
					...cpt.map(c => ({ ...c, _system: 'CPT' })),
					...hcpcs.map(c => ({ ...c, _system: 'HCPCS' })),
				];
				DOM.clearNode(results);
				if (tagged.length === 0) {
					const empty = DOM.append(results, DOM.$('div'));
					empty.textContent = `No CPT or HCPCS codes found for "${q}"`;
					empty.style.cssText = 'padding:14px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
					results.style.display = 'block';
					return;
				}
				for (const c of tagged) {
					const item = DOM.append(results, DOM.$('div'));
					item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);display:flex;align-items:center;gap:10px;';
					const sysBadge = DOM.append(item, DOM.$('span'));
					sysBadge.textContent = String(c._system);
					sysBadge.style.cssText = `min-width:48px;text-align:center;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;background:${c._system === 'CPT' ? '#0e639c' : '#a855f7'};color:#fff;`;
					const codeEl = DOM.append(item, DOM.$('span'));
					codeEl.textContent = String(c.code || c.codeValue || '');
					codeEl.style.cssText = 'font-weight:600;color:var(--vscode-textLink-foreground);min-width:60px;font-family:var(--vscode-editor-font-family,monospace);';
					const descEl = DOM.append(item, DOM.$('span'));
					descEl.textContent = String(c.shortDescription || c.description || c.longDescription || '');
					descEl.style.cssText = 'flex:1;color:var(--vscode-foreground);';
					item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
					item.addEventListener('mouseleave', () => { item.style.background = ''; });
					item.addEventListener('click', () => {
						procs.push({
							code: String(c.code || c.codeValue || ''),
							description: String(c.shortDescription || c.description || c.longDescription || ''),
							units: 1,
						});
						// Adding a procedure is an edit: mark dirty so it is saved
						// (and so signing saves first instead of discarding it).
						this._isDirty = true;
						renderList();
						searchInput.value = '';
						results.style.display = 'none';
					});
				}
				results.style.display = tagged.length > 0 ? 'block' : 'none';
			}, 300);
		});
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
