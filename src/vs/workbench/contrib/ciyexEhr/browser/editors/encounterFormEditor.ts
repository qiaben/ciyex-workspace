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
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EncounterFormEditorInput } from './ciyexEditorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface FieldSection { key: string; title: string; columns: number; visible: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[] }
interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; options?: Array<{ label: string; value: string }>; validation?: Record<string, unknown> }

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
	private _encounterStatus = '';
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
	) {
		super(EncounterFormEditor.ID, group, telemetryService, themeService, storageService);
		this._configHome = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex');
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-encounter-form'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header
		this.headerBar = DOM.append(this.root, DOM.$('div'));
		this.headerBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;align-items:center;gap:10px;';

		// Body: TOC + scroll
		const body = DOM.append(this.root, DOM.$('div'));
		body.style.cssText = 'flex:1;display:flex;overflow:hidden;';

		this.tocNav = DOM.append(body, DOM.$('div'));
		this.tocNav.style.cssText = 'width:200px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--vscode-editorWidget-border);padding:8px 0;';

		this.scrollArea = DOM.append(body, DOM.$('div'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;';
	}

	override async setInput(input: EncounterFormEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.patientId = input.patientId;
		this.encounterId = input.encounterId;
		this.patientName = input.patientName;
		this._compositionId = '';
		this._encounterStatus = '';

		await Promise.all([this._loadFormSchema(), this._loadEncounterData()]);
		if (token.isCancellationRequested) { return; }

		this._renderHeader();
		this._renderToc();
		this._renderForm();
		this._setupScrollSync();
		this._setupAutoSave();
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
					this.formSections = sections;
					return;
				}
			}
		} catch { /* fall through */ }

		// 2) Try local file
		try {
			const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'encounter.json'));
			const json = JSON.parse(file.value.toString());
			if (json.sections && json.sections.length > 1) {
				this.formSections = json.sections;
				return;
			}
		} catch { /* fall through */ }

		// 3) Hardcoded default
		this.formSections = EncounterFormEditor._defaultSections();
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
					{ key: 'vitals_weight', label: 'Weight', type: 'number', placeholder: 'lbs' },
					{ key: 'vitals_height', label: 'Height', type: 'number', placeholder: 'in' },
					{ key: 'vitals_bmi', label: 'BMI', type: 'number', placeholder: 'Auto-calculated' },
					{ key: 'vitals_pain_level', label: 'Pain Level', type: 'number', placeholder: '0-10' },
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
				key: 'procedures', title: 'Procedures & Coding', columns: 1, visible: true, collapsible: true, collapsed: true, fields: [
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
			this.patientId
				? this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${this.patientId}?encounterRef=${this.encounterId}`).then(async r => {
					if (r.ok) {
						const d = await r.json();
						const comp = d?.data || {};
						if (comp.id) { this._compositionId = String(comp.id); }
						return comp;
					}
					return {};
				}).catch(() => ({}))
				: Promise.resolve({}),
		];
		const [fhir, ehr, form] = await Promise.all(loads);
		this._encounterStatus = String((ehr as Record<string, unknown>).status || (fhir as Record<string, unknown>).status || 'UNSIGNED');
		this.encounterData = { ...fhir, ...ehr, ...form };
	}

	// Section icons for TOC
	private static SECTION_ICONS: Record<string, string> = {
		'cc': '\u{1F6A8}', 'hpi': '\u{1F4DD}', 'ros': '\u{1F4CB}', 'pmh': '\u{1F4DA}',
		'fh': '\u{1F465}', 'sh': '\u{1F3E0}', 'vitals': '\u2764\uFE0F', 'pe': '\u{1F52C}',
		'assessment': '\u{1F9E0}', 'plan': '\u{1F4C4}', 'provider-note': '\u270D\uFE0F',
		'procedures': '\u2702\uFE0F', 'billing': '\u{1F4B3}', 'fee-schedule': '\u{1F4B0}',
		'assigned-providers': '\u{1F468}\u200D\u2695\uFE0F', 'signoff': '\u2705', 'signature': '\u{1F58A}\uFE0F',
	};

	private tocItems: Array<{ key: string; el: HTMLElement }> = [];
	private sectionCards = new Map<string, HTMLElement>();

	private get _isSigned(): boolean {
		return this._encounterStatus.toUpperCase() === 'SIGNED';
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);

		const icon = DOM.append(this.headerBar, DOM.$('span'));
		icon.textContent = '\u{1F4CB}';
		icon.style.cssText = 'font-size:16px;';

		const title = DOM.append(this.headerBar, DOM.$('span'));
		title.textContent = `Encounter ${this.encounterId}`;
		title.style.cssText = 'font-size:14px;font-weight:700;';

		if (this.patientName) {
			const patient = DOM.append(this.headerBar, DOM.$('span'));
			patient.textContent = this.patientName;
			patient.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		}

		// Status badge
		const rawStatus = this._encounterStatus || 'draft';
		const statusMap: Record<string, string> = {
			'arrived': 'Arrived', 'in-progress': 'In Progress', 'finished': 'Completed',
			'cancelled': 'Cancelled', 'entered-in-error': 'Error', 'planned': 'Planned',
			'onleave': 'On Leave', 'unknown': 'Draft', 'draft': 'Draft',
			'SIGNED': 'Signed', 'UNSIGNED': 'Unsigned', 'INCOMPLETE': 'Incomplete',
		};
		const status = statusMap[rawStatus] || rawStatus;
		const statusColor = ['Completed', 'Signed', 'finished'].includes(status) ? '#22c55e' : ['Unsigned', 'Error', 'Cancelled', 'entered-in-error'].includes(status) ? '#ef4444' : ['In Progress', 'Arrived', 'Incomplete'].includes(status) ? '#f59e0b' : '#3b82f6';
		this._statusBadge = DOM.append(this.headerBar, DOM.$('span'));
		this._statusBadge.textContent = status;
		this._statusBadge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:10px;background:${statusColor}18;color:${statusColor};font-weight:500;`;

		// Auto-save indicator
		this._autoSaveIndicator = DOM.append(this.headerBar, DOM.$('span'));
		this._autoSaveIndicator.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		DOM.append(this.headerBar, DOM.$('span')).style.flex = '1';

		// Save button
		const saveBtn = DOM.append(this.headerBar, DOM.$('button'));
		saveBtn.textContent = 'Save';
		saveBtn.style.cssText = 'padding:5px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
		if (this._isSigned) { (saveBtn as HTMLButtonElement).disabled = true; saveBtn.style.opacity = '0.5'; saveBtn.style.cursor = 'not-allowed'; }
		saveBtn.addEventListener('click', () => this._saveEncounter(saveBtn));

		// Sign & Lock / Unsign button
		const signBtn = DOM.append(this.headerBar, DOM.$('button'));
		if (this._isSigned) {
			signBtn.textContent = 'Unsign';
			signBtn.style.cssText = 'padding:5px 16px;background:#f59e0b;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
			signBtn.addEventListener('click', () => this._unsignEncounter());
		} else {
			signBtn.textContent = 'Sign & Lock';
			signBtn.style.cssText = 'padding:5px 16px;background:#22c55e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
			signBtn.addEventListener('click', () => this._signEncounter(saveBtn, signBtn));
		}
	}

	private async _saveEncounter(saveBtn: HTMLElement): Promise<boolean> {
		if (!(this.input instanceof EncounterFormEditorInput)) { return false; }
		if (this._isSigned) { return false; }
		const { encounterId, patientId } = this.input;
		if (!encounterId) { this.notificationService.warn('No encounter ID'); return false; }

		const formData = this._collectFormData();

		saveBtn.textContent = 'Saving...';
		(saveBtn as HTMLButtonElement).disabled = true;

		try {
			// Save to encounter-form composition (primary - matches EHR UI)
			let compRes: Response;
			if (this._compositionId) {
				compRes = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${patientId}/${this._compositionId}`, {
					method: 'PUT',
					body: JSON.stringify(formData),
				});
			} else {
				compRes = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${patientId}?encounterRef=${encounterId}`, {
					method: 'POST',
					body: JSON.stringify(formData),
				});
				if (compRes.ok) {
					const compData = await compRes.json();
					this._compositionId = String(compData?.data?.id || compData?.id || '');
				}
			}

			// Also save to encounter resource
			await this.apiService.fetch(`/api/fhir-resource/encounters/${encounterId}`, {
				method: 'PUT',
				body: JSON.stringify({ ...formData, patientId, id: encounterId }),
			}).catch(() => { /* secondary save, ignore errors */ });

			if (compRes.ok) {
				this._isDirty = false;
				this._updateAutoSaveIndicator('Saved');
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
				this.notificationService.notify({ severity: Severity.Info, message: 'Encounter signed and locked.' });
				// Re-render to show locked state
				this._renderHeader();
				this._renderForm();
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

	private async _unsignEncounter(): Promise<void> {
		if (!this.patientId || !this.encounterId) { return; }

		try {
			const res = await this.apiService.fetch(`/api/${this.patientId}/encounters/${this.encounterId}/unsign`, {
				method: 'POST',
			});

			if (res.ok) {
				this._encounterStatus = 'UNSIGNED';
				this.notificationService.notify({ severity: Severity.Info, message: 'Encounter unlocked.' });
				this._renderHeader();
				this._renderForm();
			} else {
				this.notificationService.error('Failed to unsign encounter.');
			}
		} catch {
			this.notificationService.error('Failed to unsign encounter.');
		}
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
		const { encounterId, patientId } = this.input;
		if (!encounterId || !patientId) { return; }

		this._updateAutoSaveIndicator('Auto-saving...');

		const formData = this._collectFormData();
		try {
			let res: Response;
			if (this._compositionId) {
				res = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${patientId}/${this._compositionId}`, {
					method: 'PUT',
					body: JSON.stringify(formData),
				});
			} else {
				res = await this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${patientId}?encounterRef=${encounterId}`, {
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
			const secIcon = EncounterFormEditor.SECTION_ICONS[sec.key] || '';

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
				if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
			});

			this.tocItems.push({ key: sec.key, el: item });
		}
	}

	private _setupScrollSync(): void {
		this.scrollArea.addEventListener('scroll', () => {
			let activeKey = '';
			const scrollTop = this.scrollArea.scrollTop + this.scrollArea.offsetTop + 20;
			for (const [key, card] of this.sectionCards) {
				if (card.offsetTop <= scrollTop) {
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

		const readOnly = this._isSigned;

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

			const secIcon = EncounterFormEditor.SECTION_ICONS[sec.key] || '';
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
					const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
					sel.dataset.key = f.key;
					sel.style.cssText = inputStyle + 'height:32px;cursor:pointer;';
					if (readOnly) { sel.disabled = true; sel.style.opacity = '0.7'; }
					for (const o of [{ label: `Select ${f.label}...`, value: '' }, ...(f.options || [])]) {
						const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
						opt.value = o.value; opt.textContent = o.label; opt.selected = String(val) === o.value;
					}
					addFocus(sel);
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
				} else if (f.type === 'date' || f.type === 'datetime') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = f.type === 'datetime' ? 'datetime-local' : 'date';
					inp.value = String(val).split('T')[0];
					inp.dataset.key = f.key;
					inp.style.cssText = inputStyle + 'height:32px;';
					if (readOnly) { inp.readOnly = true; inp.style.opacity = '0.7'; }
					addFocus(inp);
				} else {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'text'; inp.value = String(val); inp.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					inp.dataset.key = f.key;
					inp.style.cssText = inputStyle + 'height:32px;';
					if (readOnly) { inp.readOnly = true; inp.style.opacity = '0.7'; }
					addFocus(inp);
				}
			}
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
		const listEl = DOM.append(parent, DOM.$('div'));

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
					removeBtn.addEventListener('click', () => { diagnoses.splice(i, 1); renderList(); });
				}
			}
		};
		renderList();

		if (readOnly) { return; }

		const searchRow = DOM.append(parent, DOM.$('div'));
		searchRow.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
		const searchInput = DOM.append(searchRow, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = 'Search ICD-10 codes...';
		searchInput.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		const results = DOM.append(parent, DOM.$('div'));
		results.style.cssText = 'max-height:150px;overflow-y:auto;display:none;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;margin-top:2px;';

		let timer: ReturnType<typeof setTimeout> | undefined;
		searchInput.addEventListener('input', () => {
			if (timer) { clearTimeout(timer); }
			const q = searchInput.value;
			if (q.length < 2) { results.style.display = 'none'; return; }
			timer = setTimeout(async () => {
				try {
					const res = await this.apiService.fetch(`/api/global_codes?codeType=ICD10&search=${encodeURIComponent(q)}&page=0&size=15`);
					if (res.ok) {
						const data = await res.json();
						const codes = data?.data?.content || data?.content || [];
						DOM.clearNode(results);
						for (const c of codes) {
							const item = DOM.append(results, DOM.$('div'));
							item.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);';
							item.textContent = `${c.code || c.codeValue || ''} \u2014 ${c.description || c.shortDescription || ''}`;
							item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
							item.addEventListener('mouseleave', () => { item.style.background = ''; });
							item.addEventListener('click', () => {
								diagnoses.push({ code: c.code || c.codeValue || '', description: c.description || c.shortDescription || '' });
								renderList();
								searchInput.value = '';
								results.style.display = 'none';
							});
						}
						results.style.display = codes.length > 0 ? 'block' : 'none';
					}
				} catch { /* */ }
			}, 300);
		});
	}

	/** Plan items: simple add/remove list */
	private _renderPlanItems(parent: HTMLElement, dataKey: string, readOnly: boolean): void {
		const items = (this.encounterData[dataKey] || []) as string[];
		const listEl = DOM.append(parent, DOM.$('div'));

		const renderList = () => {
			DOM.clearNode(listEl);
			for (let i = 0; i < items.length; i++) {
				const row = DOM.append(listEl, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;';

				const bullet = DOM.append(row, DOM.$('span'));
				bullet.textContent = `${i + 1}.`;
				bullet.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);width:20px;';

				const inp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				inp.type = 'text';
				inp.value = items[i];
				inp.dataset.key = `plan_item_${i}`;
				inp.style.cssText = 'flex:1;padding:4px 8px;font-size:12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);';
				if (readOnly) { inp.readOnly = true; inp.style.opacity = '0.7'; }
				inp.addEventListener('change', () => { items[i] = inp.value; });

				if (!readOnly) {
					const removeBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
					removeBtn.textContent = '\u2715';
					removeBtn.style.cssText = 'padding:2px 6px;background:none;border:none;color:#ef4444;cursor:pointer;font-size:12px;';
					removeBtn.addEventListener('click', () => { items.splice(i, 1); renderList(); });
				}
			}
		};
		renderList();

		if (!readOnly) {
			const addBtn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
			addBtn.textContent = '+ Add Plan Item';
			addBtn.style.cssText = 'margin-top:6px;padding:4px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;';
			addBtn.addEventListener('click', () => { items.push(''); renderList(); });
		}
	}

	/** Procedures & Coding list */
	private _renderProcedureList(parent: HTMLElement, dataKey: string, readOnly: boolean): void {
		const procs = (this.encounterData[dataKey] || []) as Array<{ code: string; description: string; units: number }>;
		const listEl = DOM.append(parent, DOM.$('div'));

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
					removeBtn.addEventListener('click', () => { procs.splice(i, 1); renderList(); });
				}
			}
		};
		renderList();

		if (readOnly) { return; }

		const searchRow = DOM.append(parent, DOM.$('div'));
		searchRow.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
		const searchInput = DOM.append(searchRow, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = 'Search CPT/HCPCS codes...';
		searchInput.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		const results = DOM.append(parent, DOM.$('div'));
		results.style.cssText = 'max-height:150px;overflow-y:auto;display:none;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;margin-top:2px;';

		let timer: ReturnType<typeof setTimeout> | undefined;
		searchInput.addEventListener('input', () => {
			if (timer) { clearTimeout(timer); }
			const q = searchInput.value;
			if (q.length < 2) { results.style.display = 'none'; return; }
			timer = setTimeout(async () => {
				try {
					const res = await this.apiService.fetch(`/api/global_codes?codeType=CPT4&search=${encodeURIComponent(q)}&page=0&size=15`);
					if (res.ok) {
						const data = await res.json();
						const codes = data?.data?.content || data?.content || [];
						DOM.clearNode(results);
						for (const c of codes) {
							const item = DOM.append(results, DOM.$('div'));
							item.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);';
							item.textContent = `${c.code || c.codeValue || ''} \u2014 ${c.description || c.shortDescription || ''}`;
							item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
							item.addEventListener('mouseleave', () => { item.style.background = ''; });
							item.addEventListener('click', () => {
								procs.push({ code: c.code || c.codeValue || '', description: c.description || c.shortDescription || '', units: 1 });
								renderList();
								searchInput.value = '';
								results.style.display = 'none';
							});
						}
						results.style.display = codes.length > 0 ? 'block' : 'none';
					}
				} catch { /* */ }
			}, 300);
		});
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
