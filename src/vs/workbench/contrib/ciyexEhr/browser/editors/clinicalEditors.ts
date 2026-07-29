/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClinicalListEditorBase, ClinicalEditorConfig, FormFieldDef, FormExtrasHandle, showThemedModal, showThemedDetails } from './clinicalListEditor.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown, findWorkbenchRoot } from '../customDropdown.js';
import { enablePickerClick, isoToUsDate } from '../ciyexDateMask.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { IDialogService, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { claimNumberForFeeSheet, normalizeClaimRef } from '../billing/edi837.js';
import { EobClaimOption, EobFormValues, EobLine } from './eobPostingForm.js';
import { buildLedgerEvents, renderLedger, makeLedgerActionsHost, loadLedgerStatementInfo, ILedgerActionsHost, ILedgerExportHost } from './patientLedger.js';
import {
	applyPatientCredit, copayPlanNote, loadCreditAccounts, PatientCreditAccount,
	readCopayPlanNote, recordPatientCredit, refundPatientCredit, resolveVisitCopay, CREDIT_TXN_TYPE,
} from './patientCredit.js';
import { savePrintableAsPdf } from './printableDocument.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { wireZipCityStateInputs } from '../zipAutoFill.js';
import { buildAddressFieldConfigs, ADDRESS_LABELS, ADDRESS_PLACEHOLDERS } from '../addressFields.js';

// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────
// Care Plan goals / interventions — dynamic lists matching the web app
// (ciyex-ehr-ui/src/components/care-plans/CarePlanFormPanel.tsx). Each section
// has an "Add" button and a remove button per item. The collected payload uses
// the same shape the backend already accepts: `goals: Goal[]` and
// `interventions: Intervention[]`.
// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────

interface CarePlanGoal {
	title: string;
	description: string;
	targetDate: string;
	status: string;
	measure: string;
	targetValue: string;
	priority: string;
}

interface CarePlanIntervention {
	title: string;
	description: string;
	frequency: string;
	assignedTo: string;
}

export function renderCarePlanExtras(host: HTMLElement, editing: Record<string, unknown> | null, api: ICiyexApiService): FormExtrasHandle {
	const sectionStyle = 'grid-column:span 2;display:flex;flex-direction:column;gap:8px;margin-top:12px;';
	const headerRowStyle = 'display:flex;align-items:center;justify-content:space-between;';
	const titleStyle = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);margin:0;';
	const addBtnStyle = 'padding:4px 10px;background:transparent;color:var(--vscode-textLink-foreground,#3794ff);border:1px solid var(--vscode-textLink-foreground,#3794ff);border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;';
	const itemStyle = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:6px;background:var(--vscode-editor-background);';
	const itemHeaderStyle = 'display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--vscode-descriptionForeground);';
	const removeBtnStyle = 'background:none;border:none;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:13px;padding:0 4px;';
	const fieldRowStyle = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
	const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;box-sizing:border-box;';
	const labelStyle = 'font-size:10px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:2px;display:block;';

	const goalsSection = DOM.append(host, DOM.$('div'));
	goalsSection.style.cssText = sectionStyle;
	const goalsHeader = DOM.append(goalsSection, DOM.$('div'));
	goalsHeader.style.cssText = headerRowStyle;
	const goalsTitle = DOM.append(goalsHeader, DOM.$('h4'));
	// allow-any-unicode-next-line
	goalsTitle.textContent = '🎯 Goals';
	goalsTitle.style.cssText = titleStyle;
	const addGoalBtn = DOM.append(goalsHeader, DOM.$('button')) as HTMLButtonElement;
	addGoalBtn.type = 'button';
	addGoalBtn.textContent = '+ Add Goal';
	addGoalBtn.style.cssText = addBtnStyle;
	const goalsList = DOM.append(goalsSection, DOM.$('div'));
	goalsList.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

	const interventionsSection = DOM.append(host, DOM.$('div'));
	interventionsSection.style.cssText = sectionStyle;
	const intHeader = DOM.append(interventionsSection, DOM.$('div'));
	intHeader.style.cssText = headerRowStyle;
	const intTitle = DOM.append(intHeader, DOM.$('h4'));
	// allow-any-unicode-next-line
	intTitle.textContent = '🛠 Interventions';
	intTitle.style.cssText = titleStyle;
	const addIntBtn = DOM.append(intHeader, DOM.$('button')) as HTMLButtonElement;
	addIntBtn.type = 'button';
	addIntBtn.textContent = '+ Add Intervention';
	addIntBtn.style.cssText = addBtnStyle;
	const intList = DOM.append(interventionsSection, DOM.$('div'));
	intList.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

	// Refs into the live DOM — collected at save time so the payload stays in sync
	// with whatever the user typed without per-keystroke state mutation.
	const goalRefs: Array<{ row: HTMLElement; getters: () => CarePlanGoal }> = [];
	const intRefs: Array<{ row: HTMLElement; getters: () => CarePlanIntervention }> = [];

	const renumberGoals = () => {
		goalRefs.forEach((g, i) => {
			const head = g.row.firstElementChild as HTMLElement | null;
			if (head) {
				const label = head.firstElementChild as HTMLElement | null;
				if (label) { label.textContent = `Goal ${i + 1}`; }
			}
		});
	};
	const renumberInts = () => {
		intRefs.forEach((it, i) => {
			const head = it.row.firstElementChild as HTMLElement | null;
			if (head) {
				const label = head.firstElementChild as HTMLElement | null;
				if (label) { label.textContent = `Intervention ${i + 1}`; }
			}
		});
	};

	const addGoal = (seed?: Partial<CarePlanGoal>) => {
		const row = DOM.append(goalsList, DOM.$('div'));
		row.style.cssText = itemStyle;
		const head = DOM.append(row, DOM.$('div'));
		head.style.cssText = itemHeaderStyle;
		const label = DOM.append(head, DOM.$('span'));
		label.textContent = `Goal ${goalRefs.length + 1}`;
		const removeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		removeBtn.type = 'button';
		// allow-any-unicode-next-line
		removeBtn.textContent = '🗑';
		removeBtn.title = 'Remove goal';
		removeBtn.style.cssText = removeBtnStyle;

		const titleLabel = DOM.append(row, DOM.$('label'));
		titleLabel.textContent = 'Title';
		titleLabel.style.cssText = labelStyle;
		const titleInput = DOM.append(row, DOM.$('input')) as HTMLInputElement;
		titleInput.type = 'text';
		titleInput.placeholder = 'e.g. Reduce HbA1c below 7%';
		titleInput.style.cssText = inputStyle;
		titleInput.value = seed?.title ?? '';

		const descLabel = DOM.append(row, DOM.$('label'));
		descLabel.textContent = 'Description';
		descLabel.style.cssText = labelStyle;
		const descInput = DOM.append(row, DOM.$('textarea')) as HTMLTextAreaElement;
		descInput.placeholder = 'Describe the goal and how to achieve it...';
		descInput.style.cssText = inputStyle + 'min-height:48px;resize:vertical;font-family:inherit;';
		descInput.value = seed?.description ?? '';

		const sub = DOM.append(row, DOM.$('div'));
		sub.style.cssText = fieldRowStyle;
		const dateCell = DOM.append(sub, DOM.$('div'));
		const dateLabel = DOM.append(dateCell, DOM.$('label'));
		dateLabel.textContent = 'Target Date';
		dateLabel.style.cssText = labelStyle;
		const dateInput = DOM.append(dateCell, DOM.$('input')) as HTMLInputElement;
		dateInput.type = 'date';
		dateInput.style.cssText = inputStyle + 'cursor:pointer;';
		dateInput.value = seed?.targetDate ? String(seed.targetDate).slice(0, 10) : '';
		enablePickerClick(dateInput);

		const statusCell = DOM.append(sub, DOM.$('div'));
		const statusLabel = DOM.append(statusCell, DOM.$('label'));
		statusLabel.textContent = 'Status';
		statusLabel.style.cssText = labelStyle;
		const statusInput = createCustomDropdown({
			parent: statusCell,
			options: [
				{ label: 'In Progress', value: 'in_progress' },
				{ label: 'Achieved', value: 'achieved' },
				{ label: 'Not Achieved', value: 'not_achieved' },
				{ label: 'Cancelled', value: 'cancelled' },
			],
			initialValue: seed?.status ?? 'in_progress',
			triggerStyle: inputStyle,
		});

		// Measure / Target Value / Priority — matching ciyex-ehr-ui goal fields.
		const sub2 = DOM.append(row, DOM.$('div'));
		sub2.style.cssText = fieldRowStyle;
		const measureCell = DOM.append(sub2, DOM.$('div'));
		const measureLabel = DOM.append(measureCell, DOM.$('label'));
		measureLabel.textContent = 'Measure';
		measureLabel.style.cssText = labelStyle;
		const measureInput = DOM.append(measureCell, DOM.$('input')) as HTMLInputElement;
		measureInput.type = 'text';
		measureInput.placeholder = 'e.g. HbA1c';
		measureInput.style.cssText = inputStyle;
		measureInput.value = seed?.measure ?? '';

		const targetValCell = DOM.append(sub2, DOM.$('div'));
		const targetValLabel = DOM.append(targetValCell, DOM.$('label'));
		targetValLabel.textContent = 'Target Value';
		targetValLabel.style.cssText = labelStyle;
		const targetValInput = DOM.append(targetValCell, DOM.$('input')) as HTMLInputElement;
		targetValInput.type = 'text';
		targetValInput.placeholder = 'e.g. 7.0';
		targetValInput.style.cssText = inputStyle;
		targetValInput.value = seed?.targetValue ?? '';

		const priorityCell = DOM.append(row, DOM.$('div'));
		const priorityLabel = DOM.append(priorityCell, DOM.$('label'));
		priorityLabel.textContent = 'Priority';
		priorityLabel.style.cssText = labelStyle;
		const priorityInput = createCustomDropdown({
			parent: priorityCell,
			options: [
				{ label: 'Low', value: 'low' },
				{ label: 'Medium', value: 'medium' },
				{ label: 'High', value: 'high' },
			],
			initialValue: seed?.priority ?? 'medium',
			triggerStyle: inputStyle,
		});

		const ref = {
			row,
			getters: (): CarePlanGoal => ({
				title: titleInput.value.trim(),
				description: descInput.value.trim(),
				targetDate: dateInput.value,
				status: statusInput.value,
				measure: measureInput.value.trim(),
				targetValue: targetValInput.value.trim(),
				priority: priorityInput.value,
			}),
		};
		goalRefs.push(ref);
		removeBtn.addEventListener('click', () => {
			row.remove();
			const idx = goalRefs.indexOf(ref);
			if (idx >= 0) { goalRefs.splice(idx, 1); }
			renumberGoals();
		});
	};

	const addIntervention = (seed?: Partial<CarePlanIntervention>) => {
		const row = DOM.append(intList, DOM.$('div'));
		row.style.cssText = itemStyle;
		const head = DOM.append(row, DOM.$('div'));
		head.style.cssText = itemHeaderStyle;
		const label = DOM.append(head, DOM.$('span'));
		label.textContent = `Intervention ${intRefs.length + 1}`;
		const removeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		removeBtn.type = 'button';
		// allow-any-unicode-next-line
		removeBtn.textContent = '🗑';
		removeBtn.title = 'Remove intervention';
		removeBtn.style.cssText = removeBtnStyle;

		const titleLabel = DOM.append(row, DOM.$('label'));
		titleLabel.textContent = 'Title';
		titleLabel.style.cssText = labelStyle;
		const titleInput = DOM.append(row, DOM.$('input')) as HTMLInputElement;
		titleInput.type = 'text';
		titleInput.placeholder = 'e.g. Monthly A1C testing';
		titleInput.style.cssText = inputStyle;
		titleInput.value = seed?.title ?? '';

		const descLabel = DOM.append(row, DOM.$('label'));
		descLabel.textContent = 'Description';
		descLabel.style.cssText = labelStyle;
		const descInput = DOM.append(row, DOM.$('textarea')) as HTMLTextAreaElement;
		descInput.placeholder = 'How the intervention is delivered...';
		descInput.style.cssText = inputStyle + 'min-height:48px;resize:vertical;font-family:inherit;';
		descInput.value = seed?.description ?? '';

		const sub = DOM.append(row, DOM.$('div'));
		sub.style.cssText = fieldRowStyle;
		const freqCell = DOM.append(sub, DOM.$('div'));
		const freqLabel = DOM.append(freqCell, DOM.$('label'));
		freqLabel.textContent = 'Frequency';
		freqLabel.style.cssText = labelStyle;
		const freqInput = createCustomDropdown({
			parent: freqCell,
			options: [
				{ label: 'Daily', value: 'daily' },
				{ label: 'Weekly', value: 'weekly' },
				{ label: 'Monthly', value: 'monthly' },
				{ label: 'As Needed', value: 'as_needed' },
				{ label: 'Once', value: 'once' },
			],
			initialValue: seed?.frequency ?? 'as_needed',
			triggerStyle: inputStyle,
		});

		// Assign Provider — a searchable select populated from /api/providers,
		// replacing the old free-text "Responsible Party" box (matches the
		// reference EHR UI's "Assign to provider..." field).
		const provCell = DOM.append(sub, DOM.$('div'));
		const provLabel = DOM.append(provCell, DOM.$('label'));
		provLabel.textContent = 'Assign Provider';
		provLabel.style.cssText = labelStyle;
		const provOptions: Array<{ label: string; value: string }> = [];
		const seededProvider = seed?.assignedTo ?? '';
		if (seededProvider) { provOptions.push({ label: seededProvider, value: seededProvider }); }
		const provInput = createCustomDropdown({
			parent: provCell,
			options: provOptions,
			placeholder: 'Assign to provider...',
			initialValue: seededProvider,
			triggerStyle: inputStyle,
		});
		void api.fetch('/api/providers').then(async r => {
			if (!r.ok) { return; }
			const json = await r.json().catch(() => null) as Record<string, unknown> | null;
			const list = (Array.isArray(json?.data) ? json!.data : Array.isArray(json) ? json : Array.isArray(json?.content) ? json!.content : []) as Array<Record<string, unknown>>;
			const seen = new Set(provOptions.map(o => o.value));
			for (const p of list) {
				const name = `${String(p.firstName ?? '')} ${String(p.lastName ?? '')}`.trim() || String(p.name ?? p.fullName ?? p.displayName ?? '');
				if (name && !seen.has(name)) { seen.add(name); provOptions.push({ label: name, value: name }); }
			}
		}).catch(() => { /* providers are optional */ });

		const ref = {
			row,
			getters: (): CarePlanIntervention => ({
				title: titleInput.value.trim(),
				description: descInput.value.trim(),
				frequency: freqInput.value,
				assignedTo: provInput.value.trim(),
			}),
		};
		intRefs.push(ref);
		removeBtn.addEventListener('click', () => {
			row.remove();
			const idx = intRefs.indexOf(ref);
			if (idx >= 0) { intRefs.splice(idx, 1); }
			renumberInts();
		});
	};

	addGoalBtn.addEventListener('click', () => addGoal());
	addIntBtn.addEventListener('click', () => addIntervention());

	// Seed from editing record if present.
	if (editing) {
		const existingGoals = Array.isArray(editing.goals) ? editing.goals as Array<Record<string, unknown>> : [];
		for (const g of existingGoals) {
			addGoal({
				title: String(g.title ?? g.measure ?? ''),
				description: String(g.description ?? ''),
				targetDate: String(g.targetDate ?? ''),
				status: String(g.status ?? 'in_progress'),
				measure: String(g.measure ?? ''),
				targetValue: String(g.targetValue ?? ''),
				priority: String(g.priority ?? 'medium'),
			});
		}
		const existingInts = Array.isArray(editing.interventions) ? editing.interventions as Array<Record<string, unknown>> : [];
		for (const it of existingInts) {
			addIntervention({
				title: String(it.title ?? it.description ?? ''),
				description: String(it.description ?? ''),
				frequency: String(it.frequency ?? 'as_needed'),
				assignedTo: String(it.assignedTo ?? it.responsibleParty ?? ''),
			});
		}
	}

	return {
		collect: () => ({
			// Drop completely empty entries so the backend doesn't receive blanks.
			goals: goalRefs.map(g => g.getters()).filter(g => g.title || g.description),
			// Emit both `assignedTo` (reference EHR UI key) and `responsibleParty`
			// (legacy key) so whichever the backend reads is populated.
			interventions: intRefs.map(i => i.getters()).filter(i => i.title || i.description)
				.map(i => ({ ...i, responsibleParty: i.assignedTo })),
		}),
	};
}

// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL EDITORS
// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────

export const PRESCRIPTIONS_FORM_FIELDS: FormFieldDef[] = [
	{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
	{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
	{
		key: 'prescriberName', label: 'Prescriber', type: 'search', placeholder: 'Search prescriber...',
		apiPath: '/api/providers', relatedDisplayFields: ['identification.firstName', 'identification.lastName'],
		relatedFieldsMap: { prescriberNpi: 'npi' },
		aliases: ['providerName', 'prescribingDoctor', 'prescriber', 'renderingProvider'],
	},
	{ key: 'prescriberNpi', label: 'Prescriber NPI', type: 'text', required: true, placeholder: '10-digit NPI', aliases: ['providerNpi', 'npi'], validationPattern: '^\\d{10}$', validationMessage: 'NPI must be exactly 10 digits' },
	{ key: 'medicationName', label: 'Medication Name', type: 'text', required: true, placeholder: 'e.g. Amoxicillin 500mg', validationPattern: '^[A-Za-z0-9 ,.\\-/()\\[\\]+&\']{2,128}$', validationMessage: 'Medication Name must be 2-128 characters and contain only letters, numbers, and common punctuation' },
	{ key: 'medicationCode', label: 'Medication Code', type: 'text', placeholder: 'e.g. NDC or RxNorm code', aliases: ['code', 'ndcCode', 'rxNormCode', 'medCode'] },
	{
		key: 'medicationSystem', label: 'Code System', type: 'select', aliases: ['codeSystem', 'system', 'code_system'], options: [
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
	{ key: 'sig', label: 'SIG (Directions)', type: 'text', required: true, placeholder: 'Take 1 tablet by mouth twice daily', validationPattern: '^[A-Za-z0-9 ,.\\-/()+:;\'&]{2,256}$', validationMessage: 'SIG must be 2-256 characters using only letters, numbers, and standard punctuation' },
	// Quantity / Days Supply / Refills are counts — never negative (QA: the
	// create & edit form accepted negative values). minValue:0 maps to the input
	// `min` attribute and is enforced on save.
	{ key: 'quantity', label: 'Quantity', type: 'number', placeholder: '30', minValue: 0 },
	{ key: 'daysSupply', label: 'Days Supply', type: 'number', placeholder: '30', minValue: 0 },
	{ key: 'refills', label: 'Total Refills', type: 'number', placeholder: '3', defaultValue: 0, minValue: 0 },
	{
		key: 'deaSchedule', label: 'DEA Schedule', type: 'select', options: [
			{ label: 'Schedule II', value: 'II' }, { label: 'Schedule III', value: 'III' },
			{ label: 'Schedule IV', value: 'IV' }, { label: 'Schedule V', value: 'V' },
		]
	},
	{ key: 'pharmacyName', label: 'Pharmacy', type: 'text', required: true, placeholder: 'Pharmacy name', validationPattern: '^[A-Za-z0-9 ,.\\-/()&\']{2,128}$', validationMessage: 'Pharmacy Name must be 2-128 valid characters' },
	{ key: 'pharmacyPhone', label: 'Pharmacy Phone', type: 'text', required: true, placeholder: '+1 555-123-4567', validationPattern: '^\\+?(?:[0-9][\\s().\\-]?){7,15}$', validationMessage: 'Enter a valid phone number e.g. +1 555-123-4567' },
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
			{ label: 'On Hold', value: 'on-hold' }, { label: 'Discontinued', value: 'discontinued' },
		], defaultValue: 'active'
	},
	{ key: 'startDate', label: 'Start Date', type: 'date' },
	{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
];

export class PrescriptionsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPrescriptions';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Prescriptions', apiPath: '/api/prescriptions', statsPath: '/api/prescriptions/stats',
		searchPlaceholder: 'Search by patient, medication, prescriber, pharmacy...',
		clientSideFilter: ['patientName', 'medicationName', 'sig', 'pharmacyName', 'prescriberName', 'status', 'priority', 'id'],
		editable: true,
		refetchOnEdit: true,
		createDefaults: { intent: 'order' },
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'medicationName', label: 'Medication' },
			{ key: 'sig', label: 'SIG' }, { key: 'quantity', label: 'Qty', width: '60px' },
			{ key: 'refills', label: 'Refills', width: '60px' }, { key: 'pharmacyName', label: 'Pharmacy' },
			{ key: 'prescriberName', label: 'Prescriber' },
			{ key: 'priority', label: 'Priority', width: '80px' }, { key: 'status', label: 'Status', width: '90px' },
		],
		// The edit form's "Total Refills" field is `refills`; the list column must
		// read the SAME field so an edit (e.g. 14 → 15) is reflected immediately.
		// The previous column read `refillsRemaining` — a distinct, server-derived
		// value that never changed on a plain edit, so the saved Total Refills
		// appeared to "not update". Fall back to refillsRemaining only when the
		// list DTO doesn't carry `refills`.
		cellRenderer: (key, value, item) => {
			if (key === 'refills') {
				const total = item['refills'];
				const rem = item['refillsRemaining'];
				const v = (total !== undefined && total !== null && total !== '') ? total
					: (rem !== undefined && rem !== null && rem !== '') ? rem : 0;
				return String(v);
			}
			return String(value ?? '');
		},
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'On Hold', value: 'on_hold' },
			// The form can set a prescription to Stopped, so the list must offer the
			// matching filter — Stopped rows were visible in All with no way to
			// filter down to them (QA issue 5).
			{ label: 'Stopped', value: 'stopped' },
			{ label: 'Completed', value: 'completed' }, { label: 'Discontinued', value: 'discontinued' },
			{ label: 'Cancelled', value: 'cancelled' },
		],
		// The server /api/prescriptions/stats counts a different population than
		// the list shows (e.g. "0 On Hold" while two On-Hold rows are visible —
		// QA issue 4). Derive the cards from the loaded rows with the SAME
		// normalization the status filter uses, so cards, tabs and rows always
		// agree — and clicking a card selects the matching filter.
		computeStats: (items) => {
			const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[-_\s]/g, '');
			const count = (s: string) => items.filter(i => norm(i['status']) === s).length;
			return {
				active: count('active'),
				onHold: count('onhold'),
				stopped: count('stopped'),
				completed: count('completed'),
				discontinued: count('discontinued'),
				cancelled: count('cancelled'),
			};
		},
		statsFilterMap: {
			active: 'active',
			onHold: 'on_hold',
			stopped: 'stopped',
			completed: 'completed',
			discontinued: 'discontinued',
			cancelled: 'cancelled',
		},
		priorityOptions: [
			{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
		],
		// No additionalFilters — prescriber is in clientSideFilter so the main search bar
		// (placeholder includes "prescriber") already filters by prescriber name.
		formFields: PRESCRIPTIONS_FORM_FIELDS,
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Discontinue', icon: '⏹',
				// Only offer Discontinue while the prescription is still active / on hold.
				// Once discontinued (or completed/cancelled) the row shows just Edit + Delete.
				visible: (item) => {
					const s = String(item['status'] || '').toLowerCase().replace(/-/g, '_');
					return s === 'active' || s === 'on_hold';
				},
				handler: async (item, api, reload, dlg) => {
					// Themed modal with a large, mandatory Reason textarea — mirrors the
					// EHR-UI "Discontinue Prescription" popup (bigger box, required reason).
					const result = await showThemedModal({
						title: 'Discontinue Prescription',
						subtitle: 'Please provide a reason for discontinuing.',
						fields: [{ key: 'reason', label: 'Reason', type: 'textarea', required: true, rows: 4, placeholder: 'Reason for discontinuation...' }],
						confirmLabel: 'Discontinue',
						confirmColor: '#f59e0b',
					});
					const reason = result?.['reason']?.trim();
					if (reason) {
						const r = await api.fetch(`/api/prescriptions/${item.id}/discontinue`, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ reason }),
						});
						if (!r.ok) {
							const err = await r.json().catch(() => ({}));
							await dlg.error(String(err?.['message'] || `Failed to discontinue (HTTP ${r.status}).`));
							return;
						}
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

export const LAB_ORDER_FORM_FIELDS: FormFieldDef[] = [
	{
		key: 'patientFirstName', label: 'Patient', type: 'search', required: true,
		placeholder: 'Search patient by name, MRN or ID...',
		apiPath: '/api/patients', relatedField: 'patientId',
		relatedDisplayFields: ['firstName', 'lastName'],
		relatedFieldsMap: { patientFirstName: 'firstName', patientLastName: 'lastName' },
		aliases: ['firstName', 'patientFirst', 'patient.firstName'],
	},
	{ key: 'patientId', label: 'Patient ID', type: 'number', required: true, placeholder: 'Auto-filled from patient search', aliases: ['patient.id'] },
	{ key: 'patientLastName', label: 'Patient Last Name', type: 'text', placeholder: 'Auto-filled from patient search', aliases: ['lastName', 'patientLast', 'patient.lastName'] },
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
	{
		key: 'testDisplay', label: 'Test Name', type: 'search', required: true,
		placeholder: 'Search LOINC test (e.g. CBC, glucose)...',
		apiPath: '/api/app-proxy/ciyex-codes/api/codes/LOINC/search',
		searchParam: 'q',
		searchDisplayField: 'shortDescription',
		searchValueField: 'code',
		relatedField: 'testCode',
		relatedDisplayFields: ['code', 'shortDescription'],
		// Show only the description in the Test Name box after a pick (the LOINC
		// code lands in the separate Test Code field via relatedField) — matches
		// the screenshot and keeps the two fields from both showing the code.
		selectDisplayField: 'shortDescription',
		validationPattern: '^[A-Za-z0-9 ,.\\-/()\\[\\]+&\']{2,}$',
		validationMessage: 'Test Name must be at least 2 characters',
	},
	{ key: 'testCode', label: 'Test Code (LOINC)', type: 'text', required: true, placeholder: 'Auto-filled from test search', validationPattern: '^[0-9A-Za-z\\-]{1,16}$', validationMessage: 'Invalid LOINC code format' },
	{
		// Plain dropdown (NOT segmented) — QA asked for the Status field on the Lab
		// Order create/edit form to match the normal dropdown style used by the
		// Result Status field instead of the pill-button strip.
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
	// On edit the time is read back via these aliases — different backends store
	// it under orderTime / collectionTime / a datetime suffix on orderDate — and
	// the orders config's transformEditItem derives HH:MM from any datetime field
	// when none of them are present (QA: Order Time blank when editing).
	{ key: 'orderTime', label: 'Order Time', type: 'text', placeholder: 'HH:MM (24h)', aliases: ['orderDateTime', 'collectionTime', 'orderedTime', 'specimenCollectionTime'], defaultValue: () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; } },
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
	// `multi`: one lab order routinely justifies several diagnoses and covers
	// several procedures, so both code fields collect a LIST — each pick becomes a
	// removable chip and the saved value is the codes joined with ", ".
	{ key: 'diagnosisCode', label: 'Diagnosis Codes (ICD-10)', type: 'search', multi: true, required: true, placeholder: 'Search ICD-10 codes — pick one or more', apiPath: '/api/app-proxy/ciyex-codes/api/codes/ICD10_CM/search', searchParam: 'q', searchDisplayField: 'shortDescription', searchValueField: 'code', relatedDisplayFields: ['code', 'shortDescription'] },
	{ key: 'procedureCode', label: 'Procedure Codes (CPT)', type: 'search', multi: true, required: true, placeholder: 'Search CPT codes — pick one or more', apiPath: '/api/app-proxy/ciyex-codes/api/codes/CPT/search', searchParam: 'q', searchDisplayField: 'shortDescription', searchValueField: 'code', relatedDisplayFields: ['code', 'shortDescription'] },
];

/**
 * Canonical "New Lab Result" form schema for the clinical Labs page. Exported so
 * the Patient Snapshot and Patient Chart pages render the EXACT same Lab Result
 * create/edit fields (one source of truth, no drift) and write to the same
 * `/api/lab-results` store — which is what makes a result created on any of the
 * three pages show up on the other two.
 */
export const LAB_RESULT_FORM_FIELDS: FormFieldDef[] = [
	// Patient is required — the lab_result row has a NOT NULL patient_id FK.
	// Without these fields the create POSTed a null patientId and the DB
	// rejected it ("null value in column patient_id ... violates not-null").
	{
		key: 'patientFirstName', label: 'Patient', type: 'search', required: true,
		placeholder: 'Search patient by name, MRN or ID...',
		apiPath: '/api/patients', relatedField: 'patientId',
		relatedDisplayFields: ['firstName', 'lastName'],
		relatedFieldsMap: { patientFirstName: 'firstName', patientLastName: 'lastName' },
		aliases: ['firstName', 'patientFirst', 'patient.firstName'],
	},
	{ key: 'patientId', label: 'Patient ID', type: 'number', required: true, placeholder: 'Auto-filled from patient search', aliases: ['patient.id'] },
	{ key: 'patientLastName', label: 'Patient Last Name', type: 'text', placeholder: 'Auto-filled from patient search', aliases: ['lastName', 'patientLast', 'patient.lastName'] },
	{ key: 'testName', label: 'Test Name', type: 'text', required: true, placeholder: 'e.g. CBC, Glucose' },
	{ key: 'procedureName', label: 'Procedure Name', type: 'text', placeholder: 'Procedure name' },
	{ key: 'loincCode', label: 'LOINC Code', type: 'text', placeholder: 'e.g. 2345-7' },
	{
		key: 'status', label: 'Status', type: 'select', required: true, options: [
			{ label: 'Pending', value: 'pending' }, { label: 'Preliminary', value: 'preliminary' },
			{ label: 'Partial', value: 'partial' }, { label: 'Final', value: 'final' },
			{ label: 'Corrected', value: 'corrected' }, { label: 'Amended', value: 'amended' },
		], defaultValue: 'pending'
	},
	{
		key: 'abnormalFlag', label: 'Abnormal Flag', type: 'select', options: [
			{ label: 'Normal', value: 'normal' }, { label: 'Low', value: 'low' },
			{ label: 'High', value: 'high' }, { label: 'Critical', value: 'critical' }, { label: 'Abnormal', value: 'abnormal' },
		], defaultValue: 'normal'
	},
	{ key: 'value', label: 'Value', type: 'text', required: true, placeholder: 'Result value', aliases: ['resultValue'] },
	{ key: 'units', label: 'Units', type: 'text', placeholder: 'mg/dL, mmol/L...' },
	{ key: 'referenceRange', label: 'Reference Range', type: 'text', placeholder: '70-100' },
	// Reference bounds are non-negative concentrations/counts — the form must
	// reject negative Ref Low / Ref High (QA: negatives were accepted and saved).
	{ key: 'referenceLow', label: 'Ref Low', type: 'number', aliases: ['refLow'], minValue: 0 },
	{ key: 'referenceHigh', label: 'Ref High', type: 'number', aliases: ['refHigh'], minValue: 0 },
	{ key: 'specimen', label: 'Specimen', type: 'text', placeholder: 'Blood, Urine...' },
	{ key: 'collectedDate', label: 'Collected Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
	{ key: 'reportedDate', label: 'Reported Date', type: 'date' },
	{ key: 'panelName', label: 'Panel Name', type: 'text', placeholder: 'CBC, BMP...' },
	{ key: 'panelCode', label: 'Panel Code', type: 'text', placeholder: 'e.g. 245321', typingPattern: '[0-9]', maxDigits: 6, validationPattern: '^[0-9]{6}$', validationMessage: 'Panel Code must be exactly 6 digits' },
	{ key: 'recommendations', label: 'Recommendations', type: 'textarea', placeholder: 'Clinical recommendations...', width: 'span 2' },
	{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...', width: 'span 2' },
];

export class LabsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexLabs';

	private _activeView: 'orders' | 'results' = 'orders';
	private _sidebarItems: Map<string, HTMLElement> = new Map();

	protected get config(): ClinicalEditorConfig {
		return this._activeView === 'results' ? this._resultsConfig : this._ordersConfig;
	}

	private readonly _ordersConfig: ClinicalEditorConfig = {
		title: 'Lab Orders', apiPath: '/api/lab-order/search', statsPath: undefined,
		searchPlaceholder: 'Search by patient, test, order number...',
		clientSideFilter: ['patientFirstName', 'patientLastName', 'orderNumber', 'orderName', 'physicianName', 'status', 'priority', 'result', 'id'],
		editable: true,
		refetchOnEdit: true,
		// 8 data columns + Actions overflow a narrow pane and crush the headers
		// into each other (QA issue 13: "columns missing / not aligned, action
		// column missing"). A min-width lets the table scroll horizontally so
		// every column — including Actions — keeps its width and stays aligned.
		tableMinWidth: '1040px',
		buildItemUrl: (item) => `/api/lab-order/${item.patientId}/${item.id}`,
		buildCreateUrl: (payload) => `/api/lab-order/${payload.patientId}`,
		// Backfill Order Time on edit: if the record carries no standalone time
		// field (orderTime/collectionTime/…) but one of its datetime fields has a
		// time component (e.g. orderDate or createdAt as a full ISO timestamp),
		// derive HH:MM so the edit form shows the time the order was placed
		// instead of an empty field (QA: Order Time not fetched on edit).
		transformEditItem: async (item) => {
			if (!item.orderTime) {
				const src = item.orderDateTime || item.collectionTime || item.orderDate || item.createdAt;
				const m = src ? /[T ](\d{2}:\d{2})/.exec(String(src)) : null;
				if (m) { item.orderTime = m[1]; }
			}
			return item;
		},
		cellRenderer: (key, _value, item) => {
			if (key === 'patientFirstName') {
				const fn = String(item.patientFirstName || '').trim();
				const ln = String(item.patientLastName || '').trim();
				const full = `${fn} ${ln}`.trim();
				if (full) { return full; }
				const alt = item.patientName || item.patientFullName || item.patient || '';
				return String(alt || (item.patientId ? `Patient #${item.patientId}` : ''));
			}
			// TEST column: the order's "orderName" field is usually blank — the test
			// is stored as testDisplay (name) + testCode (LOINC). Show the name with
			// the code so the column isn't empty (QA: "test column not showing data").
			if (key === 'orderName') {
				const name = String(item.testDisplay || item.testName || '').trim();
				const code = String(item.testCode || '').trim();
				// Append the code only when the name doesn't already include it
				// (several LOINC displays are already "<code> <description>").
				const combined = name && code && !name.includes(code) ? `${name} (${code})` : (name || code);
				return combined || String(item.orderName || _value || '');
			}
			return String(_value ?? '');
		},
		columns: [
			{ key: 'patientFirstName', label: 'Patient' },
			{ key: 'orderNumber', label: 'Order #', width: '110px' },
			{ key: 'orderName', label: 'Test', width: '1.5fr' },
			{ key: 'physicianName', label: 'Provider' },
			{ key: 'priority', label: 'Priority', width: '80px' },
			{ key: 'result', label: 'Result', width: '90px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'orderDate', label: 'Date', width: '90px' },
		],
		// Status renders as pill tabs (like Prescriptions); Priority / Result stay as
		// toolbar dropdowns. Must cover every value the form's Status select offers
		// (LAB_ORDER_FORM_FIELDS) — Revoked orders showed in the list but had no
		// matching filter tab (QA).
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'Pending', value: 'pending' },
			{ label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
			{ label: 'Revoked', value: 'revoked' },
		],
		priorityOptions: [
			{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
		],
		additionalFilters: [
			{
				key: 'result', placeholder: 'All Results',
				options: [
					{ label: 'Pending', value: 'Pending' }, { label: 'Preliminary', value: 'Preliminary' },
					{ label: 'Final', value: 'Final' }, { label: 'Corrected', value: 'Corrected' }, { label: 'Amended', value: 'Amended' },
				],
			},
		],
		formFields: LAB_ORDER_FORM_FIELDS,
		// Action column mirrors the EHR-UI Lab Orders page: View, Mark Complete,
		// View Results, Edit (auto, from editable:true) and Delete (issue #7).
		actions: [
			{
				// Issue #6: open a proper read-only detail view (matching the
				// LabOrderPage.tsx "View" modal) instead of a bare text dialog.
				// allow-any-unicode-next-line
				label: 'View', icon: '\u{1F441}', handler: async (item, _api, reload, _dlg) => {
					await this._openLabOrderView(item, reload);
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Mark as Complete', icon: '✅',
				// Only offer while the order is not already completed / cancelled.
				visible: (item) => {
					const s = String(item['status'] || '').toLowerCase();
					return s !== 'completed' && s !== 'cancelled';
				},
				handler: async (item, api, reload, dlg) => {
					const r = await api.fetch(`/api/lab-order/${item.patientId}/${item.id}`, {
						method: 'PUT', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ ...item, status: 'completed' }),
					});
					if (!r.ok) {
						const err = await r.json().catch(() => ({}));
						await dlg.error(String(err?.['message'] || `Failed to mark complete (HTTP ${r.status}).`));
						return;
					}
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'View Results', icon: '\u{1F4CA}', handler: async (item, _api, _reload, _dlg) => {
					// Switch the Labs sidebar to the Lab Results view (arrow fn captures
					// the editor instance), matching the web "View Results" navigation.
					if (this._activeView !== 'results') {
						this._activeView = 'results';
						this._updateSidebarActive();
						this._resetAndReload();
					}
					void item;
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '\u{1F5D1}', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this lab order?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/lab-order/${item.patientId}/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	// Lab Results — sibling view shown when the user picks "Lab Results" in
	// the sidebar. The web app exposes both Orders and Results as a single
	// Labs page with a left sidebar (see /labs in ciyex-ehr-ui).
	private readonly _resultsConfig: ClinicalEditorConfig = {
		title: 'Lab Results', apiPath: '/api/lab-results',
		searchPlaceholder: 'Search by test name, code, value, panel...',
		clientSideFilter: ['testName', 'loincCode', 'value', 'units', 'panelName', 'status', 'abnormalFlag', 'id'],
		editable: true,
		refetchOnEdit: true,
		// The lab-result DTO only carries `patientId`, so fetch the patient and
		// inject the name fields the edit form's patient search expects (issue #6a).
		transformEditItem: async (item, api) => {
			const pid = item.patientId;
			if (!pid || item.patientFirstName) { return item; }
			try {
				const res = await api.fetch(`/api/patients/${pid}`);
				if (res.ok) {
					const json = await res.json().catch(() => null);
					const p = (json && (json.data ?? json)) as Record<string, unknown> | null;
					if (p) { return { ...item, patientFirstName: p.firstName ?? '', patientLastName: p.lastName ?? '' }; }
				}
			} catch { /* keep item as-is */ }
			return item;
		},
		columns: [
			{ key: 'testName', label: 'Test', width: '1.5fr' },
			// Backend returns `value` (not `resultValue`) — column key must match
			// or the Value column renders blank (issue #6b).
			{ key: 'value', label: 'Value', width: '90px' },
			{ key: 'referenceRange', label: 'Range', width: '100px' },
			{ key: 'abnormalFlag', label: 'Flag', width: '70px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'collectedDate', label: 'Collected', width: '110px' },
			{
				key: 'signedAt', label: 'Signed', width: '90px', emptyLabel: 'Sign',
				onClick: async (item, api, reload, dlg) => {
					if (item.signedAt) { return; }
					const r = await dlg.confirm({ message: 'Sign this lab result?', type: 'question', primaryButton: 'Sign' });
					if (!r.confirmed) { return; }
					await api.fetch(`/api/lab-results/${item.id}`, {
						method: 'PUT', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ ...item, signedAt: new Date().toISOString() }),
					});
					reload();
				},
			},
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' }, { label: 'Preliminary', value: 'preliminary' },
			{ label: 'Partial', value: 'partial' }, { label: 'Final', value: 'final' },
			{ label: 'Corrected', value: 'corrected' }, { label: 'Amended', value: 'amended' },
		],
		additionalFilters: [
			{
				key: 'abnormalFlag', placeholder: 'All Flags',
				options: [
					{ label: 'Normal', value: 'normal' }, { label: 'Low', value: 'low' },
					{ label: 'High', value: 'high' }, { label: 'Critical', value: 'critical' },
					{ label: 'Abnormal', value: 'abnormal' },
				],
			},
		],
		cellRenderer: (key, value, item) => {
			// TEST column: show the descriptive name together with its LOINC code so
			// the code isn't lost from the table (QA: the New Lab Result form captures
			// both Test Name + LOINC Code but the list showed only the name). Mirrors
			// the Lab Orders "Test" column which renders "name (code)".
			if (key === 'testName') {
				const name = String(item.testName || '').trim();
				const code = String(item.loincCode || item.testCode || '').trim();
				const combined = name && code && !name.includes(code) ? `${name} (${code})` : (name || code);
				return combined || String(value ?? '');
			}
			if ((key === 'collectedDate' || key === 'signedAt') && typeof value === 'string' && value) {
				try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
			}
			if (key === 'abnormalFlag' && typeof value === 'string') {
				return value.charAt(0).toUpperCase() + value.slice(1);
			}
			return String(value ?? '');
		},
		formFields: LAB_RESULT_FORM_FIELDS,
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '\u{1F5D1}', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this lab result?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/lab-results/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(LabsEditor.ID, group, t, th, s, a, d); }

	/**
	 * Render a left sidebar with "Lab Orders" and "Lab Results" sections, matching
	 * the web app at /labs. Selecting a view switches the active config and reloads.
	 */
	protected override wrapContent(parent: HTMLElement): HTMLElement {
		const wrapper = DOM.append(parent, DOM.$('.labs-wrapper'));
		wrapper.style.cssText = 'display:flex;flex-direction:row;height:100%;width:100%;';

		const sidebar = DOM.append(wrapper, DOM.$('.labs-sidebar'));
		// Collapsible-on-hover: while the user is reading/editing the table or a
		// form the sidebar stays narrow (icons only) to maximise content width;
		// moving the pointer onto it expands it to show the labels again.
		const SIDEBAR_W_EXPANDED = '220px';
		const SIDEBAR_W_COLLAPSED = '52px';
		sidebar.style.cssText = `width:${SIDEBAR_W_COLLAPSED};flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background);padding:16px 0;overflow:hidden;display:flex;flex-direction:column;transition:width 0.15s ease;`;

		const sbHeader = DOM.append(sidebar, DOM.$('div'));
		sbHeader.style.cssText = 'padding:0 16px 12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:8px;white-space:nowrap;';
		const sbTitle = DOM.append(sbHeader, DOM.$('div'));
		// allow-any-unicode-next-line
		sbTitle.textContent = '🧪 Labs';
		sbTitle.style.cssText = 'font-weight:700;font-size:14px;color:var(--vscode-foreground);';
		const sbSub = DOM.append(sbHeader, DOM.$('div'));
		sbSub.textContent = 'Orders & results';
		sbSub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		const items: Array<{ key: 'orders' | 'results'; label: string; icon: string }> = [
			// allow-any-unicode-next-line
			{ key: 'orders', label: 'Lab Orders', icon: '🧫' },
			// allow-any-unicode-next-line
			{ key: 'results', label: 'Lab Results', icon: '📊' },
		];
		const navEls: HTMLElement[] = [];
		const labelEls: HTMLElement[] = [];
		for (const it of items) {
			const navEl = DOM.append(sidebar, DOM.$('div'));
			navEl.style.cssText = 'display:flex;align-items:center;gap:10px;margin:2px 8px;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;color:var(--vscode-descriptionForeground);transition:background 0.1s;white-space:nowrap;overflow:hidden;';
			const iconEl = DOM.append(navEl, DOM.$('span'));
			iconEl.textContent = it.icon;
			iconEl.style.cssText = 'font-size:15px;width:18px;text-align:center;flex-shrink:0;';
			const lbl = DOM.append(navEl, DOM.$('span'));
			lbl.textContent = it.label;
			navEl.title = it.label; // tooltip so the icon is identifiable while collapsed
			navEl.addEventListener('mouseenter', () => { if (this._activeView !== it.key) { navEl.style.background = 'var(--vscode-list-hoverBackground)'; } });
			navEl.addEventListener('mouseleave', () => { if (this._activeView !== it.key) { navEl.style.background = ''; } });
			navEl.addEventListener('click', () => {
				if (this._activeView === it.key) { return; }
				this._activeView = it.key;
				this._updateSidebarActive();
				this._resetAndReload();
			});
			navEls.push(navEl);
			labelEls.push(lbl);
			this._sidebarItems.set(it.key, navEl);
		}

		const setSidebarCollapsed = (collapsed: boolean): void => {
			sidebar.style.width = collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_EXPANDED;
			sbHeader.style.display = collapsed ? 'none' : '';
			for (const l of labelEls) { l.style.display = collapsed ? 'none' : ''; }
			for (const n of navEls) {
				n.style.justifyContent = collapsed ? 'center' : '';
				n.style.padding = collapsed ? '8px 0' : '8px 12px';
			}
		};
		// Expand when the pointer is over the sidebar; collapse once it leaves
		// (i.e. when the user moves into the table/form area).
		sidebar.addEventListener('mouseenter', () => setSidebarCollapsed(false));
		sidebar.addEventListener('mouseleave', () => setSidebarCollapsed(true));
		setSidebarCollapsed(true);

		this._updateSidebarActive();

		const main = DOM.append(wrapper, DOM.$('.labs-main'));
		// Hide the vertical + horizontal scrollbars from the OS — the inner
		// table already scrolls smoothly without the chunky bar (Issue #1, #2).
		main.style.cssText = 'flex:1;min-width:0;height:100%;overflow:hidden;';
		return main;
	}

	private _updateSidebarActive(): void {
		for (const [key, el] of this._sidebarItems.entries()) {
			const isActive = key === this._activeView;
			el.style.background = isActive ? 'var(--vscode-list-activeSelectionBackground,rgba(0,122,204,0.18))' : '';
			el.style.color = isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)';
			el.style.fontWeight = isActive ? '600' : '500';
		}
	}

	/**
	 * Issue #6: read-only Lab Order detail view, mirroring the LabOrderPage.tsx
	 * "View" modal — Order Details + Specimen & Clinical sections, an Attached
	 * Results table, and Close / Print / Edit / Delete footer actions.
	 */
	private async _openLabOrderView(item: Record<string, unknown>, reload: () => void): Promise<void> {
		const api = this.apiService;
		const dlg = this.dialogService;
		const val = (k: string): string => { const v = item[k]; return (v === undefined || v === null || v === '') ? '—' : String(v); };

		const overlay = DOM.append(this.root, DOM.$('div'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;';
		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);';
		backdrop.addEventListener('click', () => overlay.remove());
		const panel = DOM.append(overlay, DOM.$('div'));
		panel.style.cssText = 'position:relative;width:720px;max-width:94vw;max-height:88%;display:flex;flex-direction:column;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.4);';

		const hdr = DOM.append(panel, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const title = DOM.append(hdr, DOM.$('div'));
		title.textContent = `Order ${val('orderNumber')}`;
		title.style.cssText = 'font-size:15px;font-weight:600;';
		const xBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		xBtn.textContent = '✕';
		xBtn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;color:var(--vscode-foreground);';
		xBtn.addEventListener('click', () => overlay.remove());

		const body = DOM.append(panel, DOM.$('div'));
		body.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:18px 20px;scrollbar-width:none;-ms-overflow-style:none;';

		const grid = DOM.append(body, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:24px;';

		const sectionTitleStyle = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-foreground);margin:0 0 8px;';
		const buildSection = (heading: string, rows: Array<[string, string]>): void => {
			const sec = DOM.append(grid, DOM.$('div'));
			const h = DOM.append(sec, DOM.$('div')); h.textContent = heading; h.style.cssText = sectionTitleStyle;
			const dl = DOM.append(sec, DOM.$('div'));
			dl.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12.5px;align-items:start;';
			for (const [k, v] of rows) {
				const ks = DOM.append(dl, DOM.$('span')); ks.textContent = k; ks.style.cssText = 'color:var(--vscode-descriptionForeground);';
				const vs = DOM.append(dl, DOM.$('span')); vs.textContent = v; vs.style.cssText = 'color:var(--vscode-foreground);word-break:break-word;';
			}
		};

		const testCodeLine = item.testCode
			? `${String(item.testCode)}${item.testDisplay ? ` (${String(item.testDisplay)})` : ''}`
			: val('orderName');
		buildSection('Order Details', [
			['Order #', val('orderNumber')],
			['Order Name', val('orderName')],
			['Test Code', testCodeLine],
			['Priority', val('priority')],
			['Status', val('status')],
			['Date', `${val('orderDate')}${item.orderTime ? ` at ${String(item.orderTime)}` : ''}`],
			['Lab', val('labName')],
			['Result Status', String(item.result ?? 'Pending')],
		]);
		buildSection('Specimen & Clinical', [
			['Specimen ID', val('specimenId')],
			['Provider', String(item.physicianName ?? item.orderingProvider ?? '—')],
			['Diagnosis', val('diagnosisCode')],
			['Procedure', val('procedureCode')],
			['Notes', val('notes')],
		]);

		// Attached results table.
		const resultsSec = DOM.append(body, DOM.$('div'));
		resultsSec.style.cssText = 'margin-top:20px;';
		const resTitle = DOM.append(resultsSec, DOM.$('div'));
		resTitle.style.cssText = sectionTitleStyle;
		resTitle.textContent = 'Attached Results';
		const resBody = DOM.append(resultsSec, DOM.$('div'));
		resBody.textContent = 'Loading…';
		resBody.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		try {
			const res = await api.fetch(`/api/lab-results/order/${item.id}`);
			let arr: Array<Record<string, unknown>> = [];
			if (res.ok) {
				const json = await res.json().catch(() => null);
				const w = (json && typeof json === 'object' && (json as Record<string, unknown>).data !== undefined) ? (json as Record<string, unknown>).data : json;
				arr = (Array.isArray(w) ? w : []) as Array<Record<string, unknown>>;
			}
			DOM.clearNode(resBody);
			resTitle.textContent = `Attached Results (${arr.length})`;
			if (arr.length === 0) {
				resBody.textContent = 'No results attached yet.';
			} else {
				resBody.style.cssText = '';
				const cols = ['Test', 'Value', 'Status', 'Flag', 'Reported'];
				const head = DOM.append(resBody, DOM.$('div'));
				head.style.cssText = 'display:grid;grid-template-columns:1.6fr 1fr 0.9fr 0.7fr 1fr;gap:10px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:6px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);';
				for (const c of cols) { const s = DOM.append(head, DOM.$('span')); s.textContent = c; }
				for (const r of arr) {
					const rowEl = DOM.append(resBody, DOM.$('div'));
					rowEl.style.cssText = 'display:grid;grid-template-columns:1.6fr 1fr 0.9fr 0.7fr 1fr;gap:10px;font-size:12px;padding:7px 8px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:center;';
					const tn = DOM.append(rowEl, DOM.$('span')); tn.textContent = String(r.testName ?? '—');
					const vv = DOM.append(rowEl, DOM.$('span')); vv.textContent = String(r.value ?? '—'); vv.style.fontWeight = '600';
					const st = DOM.append(rowEl, DOM.$('span')); st.textContent = String(r.status ?? '—');
					const fl = DOM.append(rowEl, DOM.$('span'));
					const flag = String(r.abnormalFlag ?? '').trim();
					if (flag) { fl.textContent = flag; fl.style.cssText = 'font-weight:700;color:#ef4444;'; } else { fl.textContent = 'Normal'; fl.style.color = 'var(--vscode-descriptionForeground)'; }
					const rd = DOM.append(rowEl, DOM.$('span')); rd.textContent = String(r.reportedDate ?? '—'); rd.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
				}
			}
		} catch {
			DOM.clearNode(resBody);
			resBody.textContent = 'Unable to load attached results.';
		}

		// Footer: Close / Print / Edit / Delete.
		const footer = DOM.append(panel, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--vscode-editorWidget-border);';
		const mkBtn = (label: string, primary: boolean, danger = false): HTMLButtonElement => {
			const b = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			const bg = danger ? '#dc2626' : primary ? 'var(--vscode-button-background,#0e639c)' : 'var(--vscode-button-secondaryBackground,#3a3d41)';
			const fg = (primary || danger) ? '#fff' : 'var(--vscode-button-secondaryForeground,#ccc)';
			const border = (primary || danger) ? 'none' : '1px solid var(--vscode-input-border,#555)';
			b.style.cssText = `padding:7px 16px;background:${bg};color:${fg};border:${border};border-radius:4px;cursor:pointer;font-size:13px;font-weight:${primary || danger ? '600' : '400'};`;
			return b;
		};
		const closeBtn = mkBtn('Close', false);
		closeBtn.addEventListener('click', () => overlay.remove());
		const printBtn = mkBtn('Print', false);
		// Issue #9: the old handler opened a blank window.open() popup (which renders
		// black inside the Electron workbench) with a bare <pre> dump. Render a proper
		// on-screen "LAB ORDER FORM" preview (matching ciyex-ehr-ui) and drive the OS
		// print dialog from it via the proven hidden-print-style approach used by the
		// Appointments print preview.
		printBtn.addEventListener('click', () => this._printLabOrder(item));
		const editBtn = mkBtn('Edit', true);
		editBtn.addEventListener('click', () => { overlay.remove(); void this._openForm(item); });
		const deleteBtn = mkBtn('Delete', false, true);
		deleteBtn.addEventListener('click', async () => {
			const r = await dlg.confirm({ message: 'Delete this lab order?', type: 'warning', primaryButton: 'Delete' });
			if (r.confirmed) {
				await api.fetch(`/api/lab-order/${item.patientId}/${item.id}`, { method: 'DELETE' });
				overlay.remove();
				reload();
			}
		});

		overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { overlay.remove(); } });
	}

	/**
	 * Issue #9: render a printable "LAB ORDER FORM" preview (mirroring the
	 * ciyex-ehr-ui template) into a visible modal, then print it via a transient
	 * `@media print` stylesheet — the same approach the Appointments print
	 * preview uses. The previous `window.open()` popup rendered blank inside the
	 * Electron workbench, so nothing reached the page.
	 */
	private _printLabOrder(item: Record<string, unknown>): void {
		const val = (k: string): string => { const v = item[k]; return (v === undefined || v === null || v === '') ? 'N/A' : String(v); };
		const doc = DOM.getActiveWindow().document;

		const patientName = (() => {
			const full = `${String(item.patientFirstName || '').trim()} ${String(item.patientLastName || '').trim()}`.trim();
			return full || String(item.patientName || item.patientFullName || item.patient || (item.patientId ? `Patient #${item.patientId}` : 'N/A'));
		})();
		const orderDate = String(item.orderDate || '') || new Date().toISOString().slice(0, 10);
		const visitTime = item.orderTime ? String(item.orderTime) : '';

		const backdrop = DOM.append(doc.body, DOM.$('div.ciyex-print-backdrop'));
		backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;display:flex;align-items:center;justify-content:center;';
		const sheet = DOM.append(backdrop, DOM.$('div.ciyex-print-sheet'));
		sheet.style.cssText = 'background:#fff;color:#000;width:min(820px,92vw);max-height:88vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.4);display:flex;flex-direction:column;overflow:hidden;font-family:Arial,sans-serif;';

		const toolbar = DOM.append(sheet, DOM.$('div.ciyex-print-toolbar'));
		toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e5e5e5;background:#f7f7f7;flex-shrink:0;';
		const tt = DOM.append(toolbar, DOM.$('span')); tt.textContent = `Lab Order — ${val('orderNumber')}`; tt.style.cssText = 'font-size:13px;font-weight:600;color:#222;flex:1;';
		const doPrintBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		doPrintBtn.textContent = 'Print / Save as PDF';
		doPrintBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
		const closePrintBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		closePrintBtn.textContent = 'Close';
		closePrintBtn.style.cssText = 'padding:6px 14px;background:#e5e5e5;color:#222;border:1px solid #ccc;border-radius:4px;cursor:pointer;font-size:12px;';

		const preview = DOM.append(sheet, DOM.$('div.ciyex-print-preview'));
		preview.style.cssText = 'overflow:auto;padding:28px 32px;flex:1;background:#fff;color:#000;font-size:12px;line-height:1.4;';

		const formTitle = DOM.append(preview, DOM.$('div'));
		formTitle.textContent = 'LAB ORDER FORM';
		formTitle.style.cssText = 'text-align:center;font-size:16px;font-weight:bold;margin-bottom:20px;';

		const cellBorder = 'border:1px solid #333;padding:10px;vertical-align:top;';
		const ptable = DOM.append(preview, DOM.$('table'));
		ptable.style.cssText = 'width:100%;border-collapse:collapse;border:1px solid #333;margin-bottom:20px;';
		const addPatRow = (cells: Array<[string, string]>): void => {
			const tr = DOM.append(ptable, DOM.$('tr'));
			for (const [k, v] of cells) {
				const td = DOM.append(tr, DOM.$('td'));
				td.style.cssText = cellBorder + 'width:33.3%;';
				const b = DOM.append(td, DOM.$('span')); b.textContent = `${k}: `; b.style.cssText = 'font-weight:bold;';
				const s = DOM.append(td, DOM.$('span')); s.textContent = v;
			}
		};
		addPatRow([['Patient', patientName], ['DOB', String(item.patientDob || item.patientBirthDate || 'N/A')], ['Sex', String(item.patientSex || item.patientGender || 'N/A')]]);
		addPatRow([['Provider', String(item.orderingProvider ?? item.physicianName ?? 'N/A')], ['Visit', `${orderDate}${visitTime ? ` ${visitTime}` : ''}`], ['Order Number', val('orderNumber')]]);

		const buildDetails = (heading: string, rows: Array<[string, string, string, string]>): HTMLTableElement => {
			const hr = DOM.append(preview, DOM.$('hr')); hr.style.cssText = 'border:none;border-top:2px solid #333;margin:20px 0;';
			const h = DOM.append(preview, DOM.$('div')); h.textContent = heading; h.style.cssText = 'font-size:15px;font-weight:bold;margin:0 0 12px;';
			const t = DOM.append(preview, DOM.$('table')) as HTMLTableElement; t.style.cssText = 'width:100%;border-collapse:collapse;border:1px solid #333;';
			for (const [k1, v1, k2, v2] of rows) {
				const tr = DOM.append(t, DOM.$('tr'));
				const c1h = DOM.append(tr, DOM.$('td')); c1h.textContent = k1; c1h.style.cssText = cellBorder + 'width:25%;font-weight:bold;background:#f5f5f5;';
				const c1v = DOM.append(tr, DOM.$('td')); c1v.textContent = v1; c1v.style.cssText = cellBorder + 'width:25%;';
				const c2h = DOM.append(tr, DOM.$('td')); c2h.textContent = k2; c2h.style.cssText = cellBorder + 'width:25%;font-weight:bold;background:#f5f5f5;';
				const c2v = DOM.append(tr, DOM.$('td')); c2v.textContent = v2; c2v.style.cssText = cellBorder + 'width:25%;';
			}
			return t;
		};
		const orderTbl = buildDetails('Order Details', [
			['Lab Name', val('labName'), 'Order Name', val('orderName')],
			['Test Code', val('testCode'), 'Test Display', String(item.testDisplay || 'N/A')],
			['Status', val('status'), 'Priority', val('priority')],
			['Ordering Provider', String(item.orderingProvider ?? 'N/A'), 'Physician Name', String(item.physicianName ?? 'N/A')],
			['Specimen ID', val('specimenId'), 'Result Status', String(item.result ?? 'Pending')],
		]);
		if (item.notes) {
			const tr = DOM.append(orderTbl, DOM.$('tr'));
			const nh = DOM.append(tr, DOM.$('td')) as HTMLTableCellElement;
			nh.textContent = 'Notes'; nh.colSpan = 2; nh.style.cssText = cellBorder + 'font-weight:bold;background:#f5f5f5;';
			const nv = DOM.append(tr, DOM.$('td')) as HTMLTableCellElement;
			nv.textContent = String(item.notes); nv.colSpan = 2; nv.style.cssText = cellBorder;
		}
		buildDetails('Procedure Details', [
			['Procedure Code', String(item.procedureCode || item.testCode || 'N/A'), 'Diagnosis Code', val('diagnosisCode')],
		]);

		const footer = DOM.append(preview, DOM.$('div'));
		footer.textContent = `Generated on ${new Date().toLocaleString()}`;
		footer.style.cssText = 'margin-top:36px;text-align:center;color:#666;font-size:11px;';

		const dismiss = (): void => { try { doc.body.removeChild(backdrop); } catch { /* ignore */ } };
		closePrintBtn.addEventListener('click', dismiss);
		backdrop.addEventListener('click', e => { if (e.target === backdrop) { dismiss(); } });
		doPrintBtn.addEventListener('click', () => {
			const printStyle = doc.createElement('style');
			printStyle.textContent = [
				'@media print{',
				'  body>*:not(.ciyex-print-backdrop){display:none !important;}',
				'  .ciyex-print-backdrop{position:static !important;background:#fff !important;display:block !important;inset:auto !important;}',
				'  .ciyex-print-sheet{box-shadow:none !important;border-radius:0 !important;width:100% !important;max-height:none !important;}',
				'  .ciyex-print-toolbar{display:none !important;}',
				'  .ciyex-print-preview{overflow:visible !important;padding:0 !important;}',
				'  @page{size:portrait;margin:14mm;}',
				'}',
			].join('');
			doc.head.appendChild(printStyle);
			try { DOM.getActiveWindow().print(); }
			finally { try { doc.head.removeChild(printStyle); } catch { /* ignore */ } }
		});
	}
}

export const IMMUNIZATIONS_FORM_FIELDS: FormFieldDef[] = [
	// Patient Information
	{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient by name...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
	{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
	// Vaccine Information
	// The vaccine name is never typed — picking a CVX code below writes the code's
	// short description here (see cvxCode.relatedFieldsMap). Mirror the Patient ID
	// field: an auto-filled, read-only box whose placeholder says where the value
	// comes from, so the form doesn't invite free text that would disagree with
	// the selected code.
	{ key: 'vaccineName', label: 'Vaccine Name', type: 'text', readOnly: true, placeholder: 'Auto-filled from CVX code' },
	{
		key: 'cvxCode', label: 'CVX Code', type: 'search', required: true,
		placeholder: 'Search CVX vaccine code...',
		apiPath: '/api/app-proxy/ciyex-codes/api/codes/CVX/search',
		searchParam: 'q',
		searchDisplayField: 'shortDescription',
		searchValueField: 'code',
		// relatedField points back to the same field so the numeric code (not the
		// display description) is stored in cvxCode after the user selects a result.
		relatedField: 'cvxCode',
		aliases: ['cvx', 'vaccineCode'],
		// relatedDisplayFields intentionally omitted so the dropdown item text comes
		// from searchDisplayField ('shortDescription') and the input is then
		// overwritten with result['code'] via relatedField above. This ensures the
		// form payload contains the numeric CVX code (e.g. "88") and satisfies the
		// validationPattern rather than the human-readable description.
		relatedFieldsMap: { vaccineName: 'shortDescription' },
		validationPattern: '^[0-9]{1,4}$',
		validationMessage: 'CVX code must be 1-4 digits',
		// Fallback when ciyex-codes has no CVX dataset loaded — same list the
		// web app uses (DynamicFormRenderer.FALLBACK_CVX_CODES). The previous
		// HEAD version used a hardcoded select; the user's complaint was that
		// the *search* option wasn't working, so we keep the search field but
		// fall back to client-side filtering of these options when the API
		// returns empty.
		fallbackOptions: [
			{ code: '03', shortDescription: 'MMR (Measles, Mumps, Rubella)' },
			{ code: '08', shortDescription: 'Hepatitis B, adolescent or pediatric' },
			{ code: '10', shortDescription: 'IPV (Poliovirus, inactivated)' },
			{ code: '17', shortDescription: 'HIB (Haemophilus influenzae type b)' },
			{ code: '20', shortDescription: 'DTaP' },
			{ code: '21', shortDescription: 'Varicella (Chickenpox)' },
			{ code: '33', shortDescription: 'Pneumococcal polysaccharide (PPV23)' },
			{ code: '43', shortDescription: 'Hepatitis B, adult' },
			{ code: '45', shortDescription: 'Hepatitis B, pediatric' },
			{ code: '48', shortDescription: 'Hib (PRP-T)' },
			{ code: '49', shortDescription: 'Hib (PRP-OMP)' },
			{ code: '52', shortDescription: 'Hepatitis A, adult' },
			{ code: '62', shortDescription: 'HPV, bivalent' },
			{ code: '83', shortDescription: 'Hepatitis A, pediatric/adolescent' },
			{ code: '85', shortDescription: 'Hepatitis A-Hepatitis B' },
			{ code: '88', shortDescription: 'Flu, unspecified' },
			{ code: '94', shortDescription: 'MMR-Varicella (MMRV)' },
			{ code: '100', shortDescription: 'Pneumococcal conjugate (PCV7)' },
			{ code: '103', shortDescription: 'Meningococcal' },
			{ code: '110', shortDescription: 'DTaP-Hepatitis B-IPV' },
			{ code: '113', shortDescription: 'Td, adult' },
			{ code: '114', shortDescription: 'Meningococcal MCV4P' },
			{ code: '115', shortDescription: 'Tdap' },
			{ code: '116', shortDescription: 'Rotavirus, pentavalent' },
			{ code: '121', shortDescription: 'Zoster (shingles), live' },
			{ code: '133', shortDescription: 'PCV13 (Pneumococcal conjugate)' },
			{ code: '135', shortDescription: 'Influenza, high dose' },
			{ code: '140', shortDescription: 'Influenza, seasonal, injectable' },
			{ code: '150', shortDescription: 'Influenza, injectable, quadrivalent' },
			{ code: '158', shortDescription: 'Influenza, injectable, quadrivalent, preservative free' },
			{ code: '162', shortDescription: 'Meningococcal B, recombinant' },
			{ code: '165', shortDescription: 'HPV9 (Human Papillomavirus 9-valent)' },
			{ code: '166', shortDescription: 'PCV15' },
			{ code: '167', shortDescription: 'PCV20' },
			{ code: '174', shortDescription: 'COVID-19 (Moderna)' },
			{ code: '176', shortDescription: 'COVID-19 Pfizer-BioNTech' },
			{ code: '207', shortDescription: 'COVID-19 Moderna' },
			{ code: '210', shortDescription: 'COVID-19 Janssen (Johnson & Johnson)' },
			{ code: '212', shortDescription: 'COVID-19 Novavax' },
			{ code: '228', shortDescription: 'Zoster (shingles), recombinant (Shingrix)' },
		],
	},
	{ key: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'Pfizer' },
	{ key: 'lotNumber', label: 'Lot Number', type: 'text', placeholder: 'e.g. FR8912', aliases: ['lot'], typingPattern: '[A-Za-z0-9]', validationPattern: '^[A-Za-z0-9]{5,10}$', validationMessage: 'Lot Number must be 5-10 letters and numbers only (e.g. FR8912)' },
	{ key: 'expirationDate', label: 'Expiration Date', type: 'date' },
	// Administration Details
	// Admin Date must not be a past-year date — the form previously accepted any
	// date (e.g. 2022) and created the immunization with no validation (QA issue 3).
	{ key: 'administrationDate', label: 'Admin Date', type: 'date', required: true, minDate: 'year-start', validationMessage: 'Admin Date cannot be a past-year date' },
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
	// Free-text dose so units (mL, gtt, liter, lit, units) can be entered.
	// The backend `doseNumber` column is an Integer (dose-in-series), so
	// `beforeSave` below splits "0.5 mL" into the integer part (doseNumber)
	// and keeps the full text — units included — in `doseSeries`. Previously
	// posting "1 ml" straight to the Integer column threw a JSON parse error.
	{ key: 'doseNumber', label: 'Dose', type: 'text', placeholder: 'e.g. 0.5 mL, 1 gtt, 2 units', aliases: ['doseSeries'] },
	// Provider Information
	{
		key: 'administeredBy', label: 'Administered By', type: 'search',
		placeholder: 'Search provider...', apiPath: '/api/providers',
		relatedDisplayFields: ['firstName', 'lastName'],
		aliases: ['provider', 'administeredByName', 'performer', 'practitionerName', 'providerName'],
	},
	// Status & Notes
	{
		key: 'status', label: 'Status', type: 'select', options: [
			{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not_done' },
			{ label: 'Entered in Error', value: 'entered_in_error' },
		], defaultValue: 'completed'
	},
	{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
];

export class ImmunizationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexImmunizations';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Immunizations', apiPath: '/api/immunizations', searchPlaceholder: 'Search by patient, vaccine...',
		clientSideFilter: ['patientName', 'vaccineName', 'cvxCode', 'site', 'route', 'administeredBy', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		// The Dose field is free text so units (mL, gtt, liter, units) can be typed.
		// Backend `doseNumber` is an Integer, so extract the leading number for it and
		// preserve the full "0.5 mL" text — units included — in `doseSeries`. This
		// fixes the "Cannot deserialize Integer from String '1 ml'" save error.
		beforeSave: (payload) => {
			const raw = String(payload['doseNumber'] ?? '').trim();
			if (raw) {
				const m = raw.match(/-?\d+(?:\.\d+)?/);
				const num = m ? parseFloat(m[0]) : NaN;
				payload['doseNumber'] = Number.isFinite(num) ? Math.round(num) : null;
				payload['doseSeries'] = raw;
			} else {
				payload['doseNumber'] = null;
			}
			return payload;
		},
		columns: [
			{ key: 'patientName', label: 'Patient' }, { key: 'vaccineName', label: 'Vaccine', width: '1.5fr' },
			{ key: 'cvxCode', label: 'CVX', width: '60px' }, { key: 'doseSeries', label: 'Dose', width: '70px', aliases: ['doseNumber'] },
			{ key: 'site', label: 'Site', width: '80px' }, { key: 'route', label: 'Route', width: '70px' },
			{ key: 'administrationDate', label: 'Admin Date', width: '90px' }, { key: 'administeredBy', label: 'Administered By' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not_done' }, { label: 'Entered in Error', value: 'entered_in_error' }],
		formFields: IMMUNIZATIONS_FORM_FIELDS,
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this immunization?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/immunizations/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(ImmunizationsEditor.ID, group, t, th, s, a, d); }
}

export const REFERRALS_FORM_FIELDS: FormFieldDef[] = [
	{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
	{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
	{
		key: 'referringProvider', label: 'Referring Provider', type: 'search', required: true,
		placeholder: 'Search provider (must be selected from results)...',
		apiPath: '/api/providers',
		relatedField: 'referringProviderId',
		relatedDisplayFields: ['firstName', 'lastName'],
		aliases: ['referringPrescriber', 'referringProviderName'],
		// Only a provider chosen from the search results is accepted — typed
		// text is wiped on blur and the field locks once a provider is picked.
		strictSelect: true,
		validationMessage: 'Please select a referring provider from the search results',
	},
	{ key: 'referralDate', label: 'Referral Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
	{ key: 'specialistName', label: 'Specialist Name', type: 'text', required: true, placeholder: 'e.g. Dr. Jane Smith', validationPattern: '^[A-Za-z\\s\\-\'.]+$', validationMessage: 'Specialist name must contain only letters, spaces, hyphens, apostrophes or periods' },
	{ key: 'specialistNpi', label: 'Specialist NPI', type: 'text', placeholder: '10-digit NPI', validationPattern: '^\\d{10}$', validationMessage: 'NPI must be exactly 10 digits' },
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
	{ key: 'facilityName', label: 'Facility Name', type: 'text', required: true, placeholder: 'e.g. City Medical Center', validationPattern: '^[A-Za-z0-9\\s\\-\'.,&#()\\/]{2,200}$', validationMessage: 'Facility name must be 2-200 characters using only letters, numbers, and common punctuation' },
	...buildAddressFieldConfigs('facility'),
	{ key: 'facilityPhone', label: 'Facility Phone', type: 'text', placeholder: '(555) 123-4567', validationPattern: '^\\(?\\d{3}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}$', validationMessage: 'Phone must be a 10-digit US number' },
	{ key: 'facilityFax', label: 'Facility Fax', type: 'text', placeholder: '(555) 123-4568', validationPattern: '^\\(?\\d{3}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}$', validationMessage: 'Fax must be a 10-digit US number' },
	{ key: 'reason', label: 'Reason for Referral', type: 'textarea', required: true, placeholder: 'Reason for referral...' },
	{ key: 'clinicalNotes', label: 'Clinical Notes', type: 'textarea', placeholder: 'Relevant clinical information...' },
	{
		key: 'urgency', label: 'Urgency', type: 'select', options: [
			{ label: 'Routine', value: 'routine' }, { label: 'Urgent', value: 'urgent' }, { label: 'STAT', value: 'stat' },
		], defaultValue: 'routine'
	},
	{
		// Status field was missing from the New/Edit Referral form (issue #10).
		// Mirrors the EHR-UI Clinical Details "Status" dropdown.
		key: 'status', label: 'Status', type: 'select', options: [
			{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' },
			{ label: 'Acknowledged', value: 'acknowledged' }, { label: 'Scheduled', value: 'scheduled' },
			{ label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
			{ label: 'Denied', value: 'denied' },
		], defaultValue: 'draft'
	},
	{ key: 'insuranceName', label: 'Insurance Name', type: 'text', placeholder: 'e.g. Blue Cross' },
	{ key: 'insuranceId', label: 'Insurance ID', type: 'text', placeholder: 'Member/policy ID' },
	{ key: 'authorizationNumber', label: 'Authorization Number', type: 'text', placeholder: 'AUTH-001' },
	{ key: 'expiryDate', label: 'Expiry Date', type: 'date' },
	{ key: 'appointmentDate', label: 'Appointment Date', type: 'date' },
	{ key: 'appointmentNotes', label: 'Appointment Notes', type: 'textarea', placeholder: 'Scheduling notes...' },
	{ key: 'followUpNotes', label: 'Follow-Up Notes', type: 'textarea', placeholder: 'Follow-up instructions...' },
];

export class ReferralsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexReferrals';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Referrals', apiPath: '/api/referrals', statsPath: '/api/referrals/stats',
		searchPlaceholder: 'Search by patient, specialist, reason...',
		clientSideFilter: ['patientName', 'specialistName', 'specialty', 'facilityName', 'reason', 'urgency', 'referringProvider', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Issue #22: Referrals shows 7 KPI cards (Draft / Sent / Acknowledged /
		// Scheduled / Completed / Cancelled / Denied). compactStats keeps the
		// strip from dominating the viewport above the table.
		compactStats: true,
		// Map each stats-card key to the status filter value it should activate
		statsFilterMap: {
			draft: 'draft', sent: 'sent', acknowledged: 'acknowledged',
			scheduled: 'scheduled', completed: 'completed', cancelled: 'cancelled', denied: 'denied',
		},
		// Columns match the web app: Urgency | Patient | Specialist / Specialty | Facility | Reason | Date | Status
		columns: [
			{ key: 'urgency', label: 'Urgency', width: '80px' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'specialistName', label: 'Specialist / Specialty' },
			{ key: 'facilityName', label: 'Facility' },
			{ key: 'reason', label: 'Reason' },
			{ key: 'referralDate', label: 'Referral Date', width: '100px' },
			{ key: 'status', label: 'Status', width: '110px' },
		],
		cellRenderer: (key, value, item) => {
			if (key === 'specialistName') {
				const name = String(item.specialistName || '--');
				const specialty = String(item.specialty || '');
				return specialty ? `${name} · ${specialty}` : name;
			}
			if (key === 'urgency') {
				const u = String(value || 'routine').toLowerCase();
				return u === 'stat' ? 'STAT' : u.charAt(0).toUpperCase() + u.slice(1);
			}
			if (key === 'referralDate' && typeof value === 'string') {
				try { return new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); } catch { return String(value); }
			}
			if (key === 'reason') {
				const r = String(value || '--');
				return r.length > 50 ? r.slice(0, 47) + '…' : r;
			}
			return String(value ?? '');
		},
		statusTabs: [
			{ label: 'Draft', value: 'draft' }, { label: 'Sent', value: 'sent' },
			{ label: 'Acknowledged', value: 'acknowledged' }, { label: 'Scheduled', value: 'scheduled' },
			{ label: 'Completed', value: 'completed' }, { label: 'Denied', value: 'denied' },
			{ label: 'Cancelled', value: 'cancelled' },
		],
		additionalFilters: [
			{
				key: 'urgency', placeholder: 'All Urgency',
				options: [
					{ label: 'Routine', value: 'routine' },
					{ label: 'Urgent', value: 'urgent' },
					{ label: 'STAT', value: 'stat' },
				],
			},
		],
		formFields: REFERRALS_FORM_FIELDS,
		actions: [
			{
				// Only the next valid status transition is shown per row (matches
				// ciyex-ehr-ui, which collapses the workflow into a single advance
				// button instead of always showing Send/Ack/Schedule/Complete —
				// QA issue 15: "some of the buttons are extra added").
				visible: (item) => { const s = String(item.status || '').toLowerCase(); return s === '' || s === 'draft' || s === 'pending'; },
				// allow-any-unicode-next-line
				label: 'Send', icon: '\u{1F4E4}', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (['sent', 'acknowledged', 'scheduled', 'completed'].includes(current)) { await dlg.info(`Referral is already ${current}.`); return; }
					const r = await dlg.confirm({ message: 'Send this referral?', type: 'question' });
					if (!r.confirmed) { return; }
					let res = await api.fetch(`/api/referrals/${item.id}/send`, { method: 'POST' });
					if (!res.ok) { res = await api.fetch(`/api/referrals/${item.id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'sent' }) }); }
					if (!res.ok) { const err = await res.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(err?.['message'] || 'Failed to send referral')); return; }
					reload();
				}
			},
			{
				visible: (item) => String(item.status || '').toLowerCase() === 'sent',
				// allow-any-unicode-next-line
				label: 'Acknowledge', icon: '✅', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (current !== 'sent') { await dlg.info(`Can only acknowledge a Sent referral (current: ${current}).`); return; }
					const r = await dlg.confirm({ message: 'Acknowledge this referral?', type: 'question' });
					if (!r.confirmed) { return; }
					const res = await api.fetch(`/api/referrals/${item.id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'acknowledged' }) });
					if (!res.ok) { const err = await res.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(err?.['message'] || 'Failed to acknowledge referral')); return; }
					reload();
				}
			},
			{
				visible: (item) => String(item.status || '').toLowerCase() === 'acknowledged',
				// allow-any-unicode-next-line
				label: 'Schedule', icon: '\u{1F4C5}', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (current !== 'acknowledged') { await dlg.info(`Can only schedule an Acknowledged referral (current: ${current}).`); return; }
					const r = await dlg.confirm({ message: 'Mark this referral as scheduled?', type: 'question' });
					if (!r.confirmed) { return; }
					const res = await api.fetch(`/api/referrals/${item.id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'scheduled' }) });
					if (!res.ok) { const err = await res.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(err?.['message'] || 'Failed to schedule referral')); return; }
					reload();
				}
			},
			{
				visible: (item) => String(item.status || '').toLowerCase() === 'scheduled',
				// allow-any-unicode-next-line
				label: 'Complete', icon: '\u{1F3C1}', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (current === 'completed' || current === 'cancelled') { await dlg.info(`Referral is already ${current}.`); return; }
					const r = await dlg.confirm({ message: 'Mark this referral as completed?', type: 'question' });
					if (!r.confirmed) { return; }
					const res = await api.fetch(`/api/referrals/${item.id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
					if (!res.ok) { const err = await res.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(err?.['message'] || 'Failed to complete referral')); return; }
					reload();
				}
			},
			{
				visible: (item) => { const s = String(item.status || '').toLowerCase(); return s !== 'cancelled' && s !== 'completed'; },
				// allow-any-unicode-next-line
				label: 'Cancel', icon: '\u{1F6AB}', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (current === 'cancelled' || current === 'completed') { await dlg.info(`Referral is already ${current}.`); return; }
					const r = await dlg.confirm({ message: `Cancel referral for ${item.patientName || 'patient'}?`, type: 'warning', primaryButton: 'Cancel Referral' });
					if (!r.confirmed) { return; }
					let res = await api.fetch(`/api/referrals/${item.id}/cancel`, { method: 'POST' });
					if (!res.ok) { res = await api.fetch(`/api/referrals/${item.id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }); }
					if (!res.ok) { const err = await res.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(err?.['message'] || 'Failed to cancel referral')); return; }
					reload();
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '\u{1F5D1}', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this referral?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/referrals/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(ReferralsEditor.ID, group, t, th, s, a, d); }
}

export const CARE_PLANS_FORM_FIELDS: FormFieldDef[] = [
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
	// Provider DTOs nest the name under `identification` (unlike patients,
	// which are flat), so the display fields use dot-paths — otherwise the
	// dropdown falls back to showing the bare provider id.
	{ key: 'authorName', label: 'Author', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedField: 'authorId', relatedDisplayFields: ['identification.firstName', 'identification.lastName'] },
	{ key: 'startDate', label: 'Start Date', type: 'date' },
	{ key: 'endDate', label: 'End Date', type: 'date' },
	{ key: 'description', label: 'Description', type: 'textarea', placeholder: 'Plan description...', width: 'span 2' },
	{
		key: 'status', label: 'Status', type: 'select', options: [
			{ label: 'Draft', value: 'draft' }, { label: 'Active', value: 'active' },
			{ label: 'On Hold', value: 'on_hold' }, { label: 'Completed', value: 'completed' },
			{ label: 'Revoked', value: 'revoked' },
		], defaultValue: 'draft'
	},
	{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...', width: 'span 2' },
	// Dynamic Goals + Interventions are rendered via `formExtras` (issue #23)
	// so the user can add an arbitrary number of items instead of the old
	// hardcoded Goal 1 / Goal 2 / Intervention 1-3 rows.
];

export class CarePlansEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCarePlans';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Care Plans', apiPath: '/api/care-plans', statsPath: '/api/care-plans/stats',
		searchPlaceholder: 'Search by title, patient, author...',
		clientSideFilter: ['title', 'patientName', 'authorName', 'category', 'description', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		columns: [
			{ key: 'title', label: 'Title', width: '1.5fr' }, { key: 'patientName', label: 'Patient' },
			{ key: 'authorName', label: 'Author' }, { key: 'category', label: 'Category', width: '120px' },
			{ key: 'startDate', label: 'Start', width: '90px' },
			{ key: 'endDate', label: 'End', width: '90px' },
			{ key: 'description', label: 'Description', width: '1.5fr' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'Draft', value: 'draft' },
			{ label: 'Completed', value: 'completed' }, { label: 'On Hold', value: 'on_hold' },
			{ label: 'Revoked', value: 'revoked' },
		],
		formFields: CARE_PLANS_FORM_FIELDS,
		endNotBeforeStart: { startKey: 'startDate', endKey: 'endDate', message: 'End Date cannot be earlier than Start Date' },
		formExtras: (host, editing) => renderCarePlanExtras(host, editing, this.apiService),
		additionalFilters: [
			{
				key: 'category', placeholder: 'All Categories',
				options: [
					{ label: 'Chronic Disease', value: 'chronic_disease' },
					{ label: 'Preventive', value: 'preventive' },
					{ label: 'Post-Surgical', value: 'post_surgical' },
					{ label: 'Behavioral', value: 'behavioral' },
					{ label: 'Rehabilitation', value: 'rehabilitation' },
					{ label: 'Palliative', value: 'palliative' },
					{ label: 'Other', value: 'other' },
				],
			},
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: `Delete "${item.title}"?`, type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/care-plans/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(CarePlansEditor.ID, group, t, th, s, a, d); }
}

// Single source of truth for Clinical Alert severities, shared by the list filter
// and the edit form so they can't drift (QA: the edit form previously offered only
// Info/Warning/Critical while the filter listed all six). CDS rules use
// info/warning/critical; merged patient-alert rows add the chart's low/medium/high.
export const CDS_SEVERITY_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
	{ label: 'Info', value: 'info' },
	{ label: 'Warning', value: 'warning' },
	{ label: 'Low', value: 'low' },
	{ label: 'Medium', value: 'medium' },
	{ label: 'High', value: 'high' },
	{ label: 'Critical', value: 'critical' },
];

export class CdsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCds';
	protected readonly config: ClinicalEditorConfig = {
		// Titled "Clinical Alerts" to match the sidebar/system menu label and the
		// editor tab. Previously the page + edit form read "Clinical Decision
		// Support" while the module was launched as "Clinical Alerts", so opening
		// the edit form appeared to rename the module (QA issue 4).
		title: 'Clinical Alerts', apiPath: '/api/cds/rules',
		statsPath: '/api/cds/stats',
		searchPlaceholder: 'Search rules...',
		clientSideFilter: ['name', 'ruleType', 'type', 'description', 'severity', 'triggerEvent', 'actionType', 'message', 'id'],
		editable: true,
		refetchOnEdit: true,
		mergeOnEdit: true,
		// Patient chart alerts live in a SEPARATE store (FHIR Flag resources via
		// /api/fhir-resource/clinical-alerts) from the CDS rules this module
		// manages — an alert created on a patient's Clinical Alerts tab never
		// appeared here (QA issue 9). Merge them in as read-only "Patient Alert"
		// rows so the System module shows every clinical alert in the org.
		enrichItems: async (items) => {
			const res = await this.apiService.fetch('/api/fhir-resource/clinical-alerts?page=0&size=200');
			if (!res.ok) { return; }
			const json = await res.json();
			const flags = (json?.data?.content || json?.content || []) as Record<string, unknown>[];
			if (!Array.isArray(flags) || flags.length === 0) { return; }
			// The patient reference can arrive as a bare id, a "Patient/123" string,
			// or a nested { reference } / { id } object — normalise to the raw id the
			// patient-scoped Flag endpoint expects.
			const pickPatientId = (f: Record<string, unknown>): string => {
				const raw = f['patientId'] ?? f['patient'] ?? f['subject'] ?? f['patientRef'] ?? f['subjectReference'] ?? '';
				const s = (raw && typeof raw === 'object')
					? String((raw as Record<string, unknown>)['reference'] ?? (raw as Record<string, unknown>)['id'] ?? '')
					: String(raw ?? '');
				return s.replace(/^Patient\//, '').trim();
			};
			const flagRows = flags.map(f => {
				const alertName = String(f['alertName'] || f['alert'] || 'Patient alert');
				const notes = String(f['notes'] || '');
				return {
					id: `flag-${f['id'] ?? f['fhirId'] ?? ''}`,
					name: alertName,
					ruleType: 'patient_alert',
					triggerEvent: 'patient_chart',
					actionType: 'alert',
					severity: String(f['severity'] || ''),
					status: String(f['status'] || ''),
					isActive: String(f['status'] || '').toLowerCase() === 'active',
					description: notes,
					// Flag-native keys the readonlyEditFields form seeds/saves from, plus
					// the identifiers its patient-scoped GET/PUT/DELETE endpoint needs.
					alertName,
					notes,
					__readonly: true,
					__patientId: pickPatientId(f),
					__recordId: String(f['id'] ?? f['fhirId'] ?? ''),
				};
			});
			return items.concat(flagRows);
		},
		createDefaults: {
			ruleType: 'custom',
			actionType: 'alert',
			appliesTo: 'all',
			isActive: true,
			conditions: [],
			snoozeDays: 0,
		},
		// GET-by-id / PUT / (via the Delete action) route merged patient-alert rows
		// to the patient-scoped FHIR Flag endpoint; CDS rules keep /api/cds/rules/{id}.
		buildItemUrl: (item) => item['__readonly'] === true
			? `/api/fhir-resource/clinical-alerts/patient/${item['__patientId']}/${item['__recordId']}`
			: `/api/cds/rules/${item['id']}`,
		editTitle: (item) => item['__readonly'] === true ? 'Edit Patient Alert' : 'Edit Clinical Alert',
		// Flag-shaped edit form for the merged patient-chart alert rows (they can't
		// use the CDS-rule schema/endpoint). Mirrors the patient chart's Clinical
		// Alerts fields so the same Flag resource is edited consistently.
		readonlyEditFields: [
			{ key: 'alertName', label: 'Alert', type: 'text', required: true, placeholder: 'Alert summary', width: 'span 2' },
			// Shares CDS_SEVERITY_OPTIONS with the rest of the module.
			{ key: 'severity', label: 'Severity', type: 'select', required: true, options: [...CDS_SEVERITY_OPTIONS] },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Active', value: 'active' },
					{ label: 'Inactive', value: 'inactive' },
					{ label: 'Entered in Error', value: 'entered-in-error' },
				],
			},
			{ key: 'notes', label: 'Description', type: 'textarea', placeholder: 'Detailed description', width: 'span 2' },
		],
		beforeSave: (payload, _isEdit, editingItem) => {
			// Merged patient-alert rows save as FHIR Flags, not CDS rules — return a
			// clean Flag payload (the GET-by-id merge left CDS-rule + internal keys on
			// the record that the Flag resource must not receive).
			if (editingItem && editingItem['__readonly'] === true) {
				const flag: Record<string, unknown> = { ...payload };
				for (const k of ['__readonly', '__patientId', '__recordId', 'ruleType', 'triggerEvent', 'actionType', 'isActive', 'conditions', 'snoozeDays', 'appliesTo', 'type', 'name', 'description']) {
					delete flag[k];
				}
				// The row id is the synthetic "flag-<id>"; the Flag PUT wants the real id.
				flag['id'] = editingItem['__recordId'];
				return flag;
			}
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(payload)) {
				if (v === '' || v === null || v === undefined) { continue; }
				out[k] = v;
			}
			// Rename form key "ruleType" → backend field "ruleType" (already correct).
			// If form sent "type" alias, normalise to "ruleType".
			if (out['type'] && !out['ruleType']) { out['ruleType'] = out['type']; }
			delete out['type'];
			// snoozeDays must be a number.
			if (out['snoozeDays'] !== undefined) { out['snoozeDays'] = Number(out['snoozeDays']) || 0; }
			// Mirror status ↔ isActive. The edit form exposes `status`
			// (active/inactive/entered_in_error) as the user's explicit choice, so it
			// MUST take precedence: `mergeOnEdit` also merges the record's existing
			// `isActive` into the payload, and deriving status FROM that stale isActive
			// silently reverted an Active→Inactive edit back to Active (QA: status
			// change never reflected in the table after save). Derive isActive from
			// the submitted status; only fall back to the reverse when no status field
			// was submitted (e.g. an isActive-only payload).
			if (typeof out['status'] === 'string' && out['status'] !== '') {
				out['isActive'] = out['status'] === 'active';
			} else if (out['isActive'] !== undefined) {
				out['status'] = out['isActive'] ? 'active' : 'inactive';
			}
			// conditions must always be present.
			if (out['conditions'] === undefined) { out['conditions'] = []; }
			return out;
		},
		columns: [
			{ key: 'name', label: 'Rule Name', width: '1.5fr' },
			{ key: 'ruleType', label: 'Type', width: '130px' },
			{ key: 'triggerEvent', label: 'Trigger', width: '120px' },
			{ key: 'severity', label: 'Severity', width: '90px' },
			{ key: 'actionType', label: 'Action', width: '100px' },
			// Issue #13: Status renders as a clickable Active/Inactive toggle inside
			// the table (matching CDSRuleTable.tsx's onToggle pill). Clicking it
			// activates/deactivates the rule via the same /toggle endpoint the row
			// Toggle action used.
			{
				// emptyLabel keeps the cell clickable when isActive is false (the base
				// onClick renderer treats falsy values as "empty" and would otherwise
				// render a blank, non-clickable cell).
				key: 'isActive', label: 'Status', width: '90px', emptyLabel: 'Inactive',
				onClick: async (item, api, reload, dlg) => {
					// Merged patient-alert rows are managed on the patient chart,
					// not through the CDS rules endpoints — ignore the click.
					if (item['__readonly'] === true) { return; }
					let res = await api.fetch(`/api/cds/rules/${item.id}/toggle`, { method: 'POST' });
					if (!res.ok) {
						const next = !(item.isActive === true || item.status === 'active');
						res = await api.fetch(`/api/cds/rules/${item.id}`, {
							method: 'PUT', headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ ...item, isActive: next, status: next ? 'active' : 'inactive' }),
						});
					}
					if (!res.ok) {
						const err = await res.json().catch(() => null) as Record<string, unknown> | null;
						await dlg.error(String(err?.['message'] || `Failed to toggle rule (HTTP ${res.status})`));
						return;
					}
					reload();
				},
			},
		],
		statusTabs: [
			{ label: 'Active', value: 'active' },
			{ label: 'Inactive', value: 'inactive' },
			// Merged patient-chart alert rows can carry 'entered_in_error' — the
			// filter must offer every status the table can display (QA: alerts
			// with that status existed but no filter matched them).
			{ label: 'Entered in Error', value: 'entered-in-error' },
		],
		// The Status COLUMN renders from `isActive` (Active when true, Inactive
		// otherwise) but the status filter compared the raw `status` STRING. A
		// merged patient-alert row whose status is e.g. 'resolved'/'expired'
		// displays as "Inactive" yet matched neither filter — so the Inactive tab
		// showed "No records found" while Inactive rows sat in the All view (QA
		// issue 9). Match the filters off the same isActive/status logic the
		// column displays. Entered-in-Error rows get their own tab and are kept
		// out of Inactive so the tabs stay disjoint.
		statusMatchers: {
			active: (item) => item['isActive'] === true || String(item['status'] ?? '').toLowerCase() === 'active',
			inactive: (item) => {
				const s = String(item['status'] ?? '').toLowerCase().replace(/[-_\s]/g, '');
				return !(item['isActive'] === true || s === 'active') && s !== 'enteredinerror';
			},
			'entered-in-error': (item) => String(item['status'] ?? '').toLowerCase().replace(/[-_\s]/g, '') === 'enteredinerror',
		},
		additionalFilters: [
			{
				key: 'ruleType', placeholder: 'All Types',
				options: [
					{ label: 'Preventive Screening', value: 'preventive_screening' },
					{ label: 'Drug-Allergy', value: 'drug_allergy' },
					{ label: 'Drug-Drug', value: 'drug_drug' },
					{ label: 'Duplicate Order', value: 'duplicate_order' },
					{ label: 'Age-Based', value: 'age_based' },
					{ label: 'Condition-Based', value: 'condition_based' },
					{ label: 'Lab Value', value: 'lab_value' },
					{ label: 'Custom', value: 'custom' },
					{ label: 'Patient Alert', value: 'patient_alert' },
				],
			},
			{
				key: 'severity', placeholder: 'All Severity',
				// Every severity the table can display (QA issue 8) — see CDS_SEVERITY_OPTIONS.
				options: [...CDS_SEVERITY_OPTIONS],
			},
		],
		// Cell renderer — show isActive as Active/Inactive badge, show ruleType readable.
		cellRenderer: (key, value) => {
			if (key === 'isActive') { return value ? 'Active' : 'Inactive'; }
			if (key === 'ruleType' || key === 'type') {
				return String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'triggerEvent') {
				return String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'actionType') {
				return String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		// Only rule-population cards map to a status filter; the rest are
		// info-only aggregates. (The old map keyed nonexistent stats keys, so no
		// card was ever clickable.)
		statsFilterMap: { activeRules: 'active', totalRules: '' },
		// /api/cds/stats only counts the CDS rules store, but the list also merges
		// the patient-chart alerts (enrichItems) — so the cards said "2 Total
		// Rules / 0 Critical" while the table showed 10 rows with a Critical one
		// (QA issue 10). Recount the rule/severity cards from the merged rows;
		// keep the genuinely server-side aggregates (override rate, alerts fired
		// today / last 7 days) from the stats endpoint.
		computeStats: (items, serverStats) => {
			const isActive = (i: Record<string, unknown>) => i['isActive'] === true || String(i['status'] ?? '').toLowerCase() === 'active';
			return {
				...serverStats,
				activeRules: items.filter(isActive).length,
				totalRules: items.length,
				criticalAlerts: items.filter(i => String(i['severity'] ?? '').toLowerCase() === 'critical').length,
			};
		},
		formFields: [
			// Row 1: full-width name
			{ key: 'name', label: 'Rule Name', type: 'text', required: true, placeholder: 'e.g., Diabetes A1C Screening', aliases: ['ruleName'], width: 'span 2' },
			// Row 2: full-width description
			{ key: 'description', label: 'Description', type: 'textarea', placeholder: 'Brief description of this rule...', width: 'span 2' },
			// Row 3: ruleType + category
			{
				key: 'ruleType', label: 'Rule Type', type: 'select', required: true,
				aliases: ['rule_type', 'type', 'kind'],
				options: [
					{ label: 'Preventive Screening', value: 'preventive_screening' },
					{ label: 'Drug-Allergy', value: 'drug_allergy' },
					{ label: 'Drug-Drug', value: 'drug_drug' },
					{ label: 'Duplicate Order', value: 'duplicate_order' },
					{ label: 'Age-Based', value: 'age_based' },
					{ label: 'Condition-Based', value: 'condition_based' },
					{ label: 'Lab Value', value: 'lab_value' },
					{ label: 'Custom', value: 'custom' },
				],
			},
			{
				key: 'category', label: 'Category', type: 'select',
				options: [
					{ label: 'Preventive', value: 'preventive' },
					{ label: 'Medication Safety', value: 'medication_safety' },
					{ label: 'Order Entry', value: 'order_entry' },
					{ label: 'Chronic Disease', value: 'chronic_disease' },
				],
			},
			// Row 4: triggerEvent + actionType
			{
				key: 'triggerEvent', label: 'Trigger Event', type: 'select',
				aliases: ['trigger_event', 'trigger'],
				options: [
					{ label: 'Encounter Open', value: 'encounter_open' },
					{ label: 'Order Entry', value: 'order_entry' },
					{ label: 'Medication Prescribe', value: 'medication_prescribe' },
					{ label: 'Lab Result', value: 'lab_result' },
					{ label: 'Manual', value: 'manual' },
				],
			},
			{
				key: 'actionType', label: 'Action Type', type: 'select',
				aliases: ['action_type'],
				options: [
					{ label: 'Alert', value: 'alert' },
					{ label: 'Reminder', value: 'reminder' },
					{ label: 'Suggestion', value: 'suggestion' },
					{ label: 'Hard Stop', value: 'hard_stop' },
				],
				defaultValue: 'alert',
			},
			// Row 5: severity + appliesTo
			{
				key: 'severity', label: 'Severity', type: 'select', required: true,
				// Same six severities as the list filter — see CDS_SEVERITY_OPTIONS.
				options: [...CDS_SEVERITY_OPTIONS],
				defaultValue: 'warning',
			},
			{
				key: 'appliesTo', label: 'Applies To', type: 'select',
				options: [
					{ label: 'All Users', value: 'all' },
					{ label: 'Provider', value: 'provider' },
					{ label: 'Nurse', value: 'nurse' },
					{ label: 'Medical Assistant', value: 'ma' },
				],
				defaultValue: 'all',
			},
			// Status — the main page and its Active/Inactive tabs let a rule be
			// deactivated, but the edit form had no way to set it (QA issue 4).
			// Backed by the string `status` the backend reads; `beforeSave` mirrors
			// it onto the boolean `isActive` (entered-in-error/inactive → false).
			// The "Entered in Error" state marks a rule created by mistake without
			// deleting it (QA report 2026-07-10, issue 7). On edit the record's
			// status string seeds the select directly.
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Active', value: 'active' },
					{ label: 'Inactive', value: 'inactive' },
					{ label: 'Entered in Error', value: 'entered_in_error' },
				], defaultValue: 'active',
			},
			// Row 6: full-width alert message (required)
			{ key: 'message', label: 'Alert Message', type: 'textarea', required: true, placeholder: 'Message shown to the provider when this rule fires...', width: 'span 2' },
			// Row 7: full-width recommendation
			{ key: 'recommendation', label: 'Recommendation', type: 'textarea', placeholder: 'Recommended action for the provider...', width: 'span 2' },
			// Row 8: referenceUrl + snoozeDays
			{ key: 'referenceUrl', label: 'Reference URL', type: 'text', placeholder: 'https://...', aliases: ['reference_url', 'refUrl'], validationPattern: '^(https?://.*)?$', validationMessage: 'Must be a valid https:// URL' },
			{ key: 'snoozeDays', label: 'Snooze (days)', type: 'number', placeholder: 'Leave empty for no snooze', aliases: ['snooze_days'], minValue: 0, validationMessage: 'Snooze (days) cannot be negative' },
		],
		actions: [
			// Issue #13: the Active/Inactive toggle now lives in the Status column
			// (above), so the actions column only keeps Edit (editable) + Delete.
			// Delete works for CDS rules (/api/cds/rules) AND merged patient-alert
			// rows (the patient-scoped FHIR Flag endpoint). Patient-alert rows only
			// offer it when their patient reference resolved, so the URL is valid.
			{
				// allow-any-unicode-next-line
				label: 'Delete', icon: '🗑️',
				visible: item => item['__readonly'] !== true || !!item['__patientId'],
				handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: `Delete "${item.name}"?`, type: 'warning', primaryButton: 'Delete' });
					if (!r.confirmed) { return; }
					const url = item['__readonly'] === true
						? `/api/fhir-resource/clinical-alerts/patient/${item['__patientId']}/${item['__recordId']}`
						: `/api/cds/rules/${item.id}`;
					await api.fetch(url, { method: 'DELETE' });
					reload();
				},
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(CdsEditor.ID, group, t, th, s, a, d); }
}

export const AUTHORIZATIONS_FORM_FIELDS: FormFieldDef[] = [
	{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
	{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
	{ key: 'providerName', label: 'Provider', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedField: 'providerId', relatedDisplayFields: ['firstName', 'lastName'] },
	// patientCoverageFallback: the patient's EXISTING insurance (snapshot
	// coverage) must be offerable even when the org's insurance-companies
	// catalog has no matching entry (QA: typed name showed "No results found"
	// though the insurance existed on the patient).
	{ key: 'insuranceName', label: 'Insurance Name', type: 'search', required: true, placeholder: 'Search insurance...', apiPath: '/api/insurance-companies', searchDisplayField: 'name', patientCoverageFallback: true },
	{ key: 'memberId', label: 'Member ID', type: 'text' },
	{ key: 'authNumber', label: 'Authorization Number', type: 'text', placeholder: 'Auth reference number' },
	// Issue #12: the first field is the CODE search (CPT) and the second field
	// auto-fills the DESCRIPTION. Selecting a code from the dropdown puts just
	// the code in the search box (selectDisplayField:'code') and writes the
	// description into the companion Procedure Description box (relatedField +
	// searchValueField:'shortDescription' feeds the related field the description).
	{
		key: 'procedureCode', label: 'Procedure Code', type: 'search', required: true,
		placeholder: 'Search CPT code (e.g. 99213)...',
		apiPath: '/api/app-proxy/ciyex-codes/api/codes/CPT/search',
		searchParam: 'q',
		searchDisplayField: 'code',
		searchValueField: 'shortDescription',
		relatedField: 'procedureDescription',
		relatedDisplayFields: ['code', 'shortDescription'],
		selectDisplayField: 'code',
		validationPattern: '^[0-9A-Z]{4,7}$',
		validationMessage: 'Procedure code must be 4-7 alphanumerics (e.g. 99213, J0696)',
	},
	{ key: 'procedureDescription', label: 'Procedure Description', type: 'text', placeholder: 'Auto-filled from code' },
	{
		key: 'diagnosisCode', label: 'Diagnosis Code', type: 'search',
		placeholder: 'Search ICD-10 code (e.g. E11.9)...',
		apiPath: '/api/app-proxy/ciyex-codes/api/codes/ICD10_CM/search',
		searchParam: 'q',
		searchDisplayField: 'code',
		searchValueField: 'shortDescription',
		relatedField: 'diagnosisDescription',
		relatedDisplayFields: ['code', 'shortDescription'],
		selectDisplayField: 'code',
		validationPattern: '^[A-Z][0-9][0-9A-Z](\\.[0-9A-Z]{1,4})?$',
		validationMessage: 'ICD-10 format: e.g. E11.9, J18.9',
	},
	{ key: 'diagnosisDescription', label: 'Diagnosis Description', type: 'text', placeholder: 'Auto-filled from code' },
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
	{
		// Status field was missing from the New/Edit Prior Authorization form
		// (issue #11). Mirrors the EHR-UI Authorization Details "Status" dropdown.
		key: 'status', label: 'Status', type: 'select', options: [
			{ label: 'Pending', value: 'pending' }, { label: 'Submitted', value: 'submitted' },
			{ label: 'Approved', value: 'approved' }, { label: 'Denied', value: 'denied' },
			{ label: 'Appeal', value: 'appeal' }, { label: 'Expired', value: 'expired' },
			{ label: 'Cancelled', value: 'cancelled' },
		], defaultValue: 'pending'
	},
	{ key: 'denialReason', label: 'Denial Reason', type: 'textarea', placeholder: 'Reason for denial if applicable' },
	{ key: 'appealDeadline', label: 'Appeal Deadline', type: 'date' },
	{ key: 'notes', label: 'Notes', type: 'textarea' },
];

export class AuthorizationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexAuthorizations';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Prior Authorizations', apiPath: '/api/prior-auth', statsPath: '/api/prior-auth/stats',
		searchPlaceholder: 'Search by auth#, patient, procedure, insurance...',
		clientSideFilter: ['patientName', 'insuranceName', 'procedureCode', 'procedureDescription', 'authNumber', 'authorizationNumber', 'priority', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Issue #22: 7+ KPI cards (Pending / Submitted / Approved / Denied /
		// Appeal / Expired / Cancelled). compactStats halves the strip height.
		compactStats: true,
		// Issue #10: the typed authorization number wasn't saving/showing because
		// the form + column used the key `authorizationNumber`, but the backend
		// PriorAuth DTO/entity use `authNumber`. The form field + column are now
		// keyed `authNumber`; this beforeSave keeps `authorizationNumber` in sync
		// as a defensive alias in case any path still reads the long key.
		beforeSave: (payload) => {
			const auth = payload.authNumber ?? payload.authorizationNumber;
			if (auth !== undefined && auth !== null && String(auth).trim() !== '') {
				payload.authNumber = auth;
				payload.authorizationNumber = auth;
			}
			return payload;
		},
		// Procedure + Diagnosis columns show BOTH the code and its description
		// (matching ciyex-ehr-ui). Auth # reads `authNumber` (backend key) with a
		// fallback to the legacy `authorizationNumber`.
		cellRenderer: (key, value, item) => {
			if (key === 'procedureDescription') {
				const code = String(item.procedureCode || '').trim();
				const desc = String(item.procedureDescription || '').trim();
				return [code, desc].filter(Boolean).join(' — ') || String(value ?? '');
			}
			if (key === 'diagnosisCode') {
				const code = String(item.diagnosisCode || '').trim();
				const desc = String(item.diagnosisDescription || '').trim();
				return [code, desc].filter(Boolean).join(' — ') || String(value ?? '');
			}
			if (key === 'authNumber') {
				return String(item.authNumber || item.authorizationNumber || value || '');
			}
			return String(value ?? '');
		},
		// Columns matching ciyex-ehr-ui: Patient, Insurance, Procedure, Diagnosis, Auth#, Units, Expiry, Status
		// Priority filter removed per QA request (issue #13).
		// Explicit, balanced widths for the text columns — without them Patient /
		// Insurance / Procedure each defaulted to an equal 1fr and left huge gaps
		// between short values (issue #7: "more space and misaligned").
		columns: [
			{ key: 'patientName', label: 'Patient', width: '1.2fr' },
			{ key: 'insuranceName', label: 'Insurance', width: '1fr' },
			{ key: 'procedureDescription', label: 'Procedure', width: '1.6fr' },
			{ key: 'diagnosisCode', label: 'Diagnosis', width: '110px' },
			{ key: 'authNumber', label: 'Auth #', width: '100px' },
			{ key: 'approvedUnits', label: 'Units', width: '60px' },
			{ key: 'expiryDate', label: 'Expiry', width: '90px' },
			{ key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' }, { label: 'Submitted', value: 'submitted' },
			{ label: 'Approved', value: 'approved' }, { label: 'Denied', value: 'denied' },
			{ label: 'Appeal', value: 'appeal' }, { label: 'Expired', value: 'expired' },
			{ label: 'Cancelled', value: 'cancelled' },
		],
		formFields: AUTHORIZATIONS_FORM_FIELDS,
		actions: [
			{
				color: '#22c55e',
				visible: (item) => String(item.status || '').toLowerCase() !== 'approved',
				// allow-any-unicode-next-line
				label: 'Approve', icon: '✓', handler: async (item, api, reload, dlg) => {
					console.log('[PriorAuth] Approve clicked for', item.id, item.status);
					const current = String(item.status || '').toLowerCase();
					if (current === 'approved') {
						await dlg.info('This authorization is already approved.');
						return;
					}
					// Issue #17a: themed "Approve Authorization" popup with the same
					// three fields as the web app (Authorization Number / Approved
					// Units / Expiry Date) instead of the bare single-input prompt.
					const proc = [item.procedureCode, item.procedureDescription].filter(Boolean).join(' ');
					const result = await showThemedModal({
						title: 'Approve Authorization',
						// allow-any-unicode-next-line
						subtitle: `Patient: ${item.patientName || '—'}${proc ? ` — ${proc}` : ''}`,
						confirmLabel: 'Approve',
						confirmColor: '#16a34a',
						fields: [
							{ key: 'authNumber', label: 'Authorization Number', type: 'text', value: String(item.authNumber || item.authorizationNumber || ''), placeholder: 'Auth reference number' },
							{ key: 'approvedUnits', label: 'Approved Units', type: 'number', value: String(item.approvedUnits || 1) },
							{ key: 'expiryDate', label: 'Expiry Date', type: 'date', value: String(item.expiryDate || '') },
						],
					});
					if (!result) { return; }
					const n = Number(result.approvedUnits);
					if (!result.approvedUnits || !isFinite(n) || n <= 0) {
						await dlg.error('Please enter a valid number of approved units (greater than zero).');
						return;
					}
					const body: Record<string, unknown> = { approvedUnits: n };
					if (result.authNumber) { body.authNumber = result.authNumber; body.authorizationNumber = result.authNumber; }
					if (result.expiryDate) { body.expiryDate = result.expiryDate; }
					const r = await api.fetch(`/api/prior-auth/${item.id}/approve`, {
						method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body),
					});
					if (!r.ok) {
						const err = await r.json().catch(() => null) as Record<string, unknown> | null;
						await dlg.error(String(err?.['message'] || `Failed to approve authorization (HTTP ${r.status}).`));
						return;
					}
					reload();
				}
			},
			{
				color: '#ef4444',
				visible: (item) => String(item.status || '').toLowerCase() !== 'denied',
				// allow-any-unicode-next-line
				label: 'Deny', icon: '✗', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (current === 'denied') {
						await dlg.info('This authorization is already denied.');
						return;
					}
					// Issue #12: themed "Deny Authorization" popup matching the EHR-UI —
					// a Denial Reason textarea (required) plus an Appeal Deadline date,
					// instead of the bare single-line prompt.
					const proc = [item.procedureCode, item.procedureDescription].filter(Boolean).join(' ');
					const result = await showThemedModal({
						title: 'Deny Authorization',
						// allow-any-unicode-next-line
						subtitle: `Denying authorization for ${item.patientName || '—'}${proc ? ` — ${proc}` : ''}`,
						confirmLabel: 'Deny',
						confirmColor: '#dc2626',
						fields: [
							{ key: 'denialReason', label: 'Denial Reason', type: 'textarea', required: true, rows: 4, placeholder: 'Enter reason for denial...' },
							{ key: 'appealDeadline', label: 'Appeal Deadline', type: 'date', value: String(item.appealDeadline || '') },
						],
					});
					if (!result) { return; }
					const reason = result['denialReason']?.trim() || '';
					if (!reason) {
						await dlg.error('A denial reason is required.');
						return;
					}
					// Backend (PriorAuthService.deny) reads `denialReason` from the
					// request body and ALSO accepts the existing record-shape fields
					// — sending just `{ reason }` silently dropped the reason (QA
					// report 2026-05-11). Send both keys for safety.
					const denyBody: Record<string, unknown> = { denialReason: reason, reason };
					if (result['appealDeadline']) { denyBody.appealDeadline = result['appealDeadline']; }
					const r = await api.fetch(`/api/prior-auth/${item.id}/deny`, {
						method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(denyBody),
					});
					if (!r.ok) {
						const err = await r.json().catch(() => null) as Record<string, unknown> | null;
						await dlg.error(String(err?.['message'] || `Failed to deny authorization (HTTP ${r.status}).`));
						return;
					}
					await dlg.info('Authorization denied.');
					reload();
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this authorization?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/prior-auth/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(AuthorizationsEditor.ID, group, t, th, s, a, d); }
}

export const EDUCATION_FORM_FIELDS: FormFieldDef[] = [
	{ key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Material title', width: 'span 2' },
	{
		key: 'category', label: 'Category', type: 'select', options: [
			{ label: 'Disease Management', value: 'disease_management' }, { label: 'Medication', value: 'medication' },
			{ label: 'Procedure', value: 'procedure' }, { label: 'Lifestyle', value: 'lifestyle' },
			{ label: 'Preventive', value: 'preventive' }, { label: 'Mental Health', value: 'mental_health' },
			{ label: 'Nutrition', value: 'nutrition' }, { label: 'Other', value: 'other' },
		]
	},
	{
		key: 'contentType', label: 'Content Type', type: 'select', options: [
			{ label: 'Article', value: 'article' }, { label: 'Video', value: 'video' },
			{ label: 'PDF', value: 'pdf' }, { label: 'Link', value: 'link' },
			{ label: 'Handout', value: 'handout' }, { label: 'Infographic', value: 'infographic' },
		], defaultValue: 'article'
	},
	// Content is mandatory; Source removed to match the ciyex-ehr-ui
	// New Education Library form (issue #8).
	{ key: 'content', label: 'Content', type: 'textarea', required: true, placeholder: 'Education material content...', width: 'span 2' },
	// Key must be `externalUrl` to match EducationMaterialDto. The backend's custom
	// ObjectMapper keeps FAIL_ON_UNKNOWN_PROPERTIES enabled, so an unknown `url`
	// field made every create/update fail with 400 (and edit never prefilled it).
	{ key: 'externalUrl', label: 'URL / Path', type: 'text', placeholder: 'https://... or /files/...' },
	{
		key: 'language', label: 'Language', type: 'select', options: [
			{ label: 'English', value: 'english' }, { label: 'Spanish', value: 'spanish' },
			{ label: 'French', value: 'french' }, { label: 'German', value: 'german' },
			{ label: 'Portuguese', value: 'portuguese' }, { label: 'Chinese', value: 'chinese' },
			{ label: 'Arabic', value: 'arabic' }, { label: 'Hindi', value: 'hindi' },
			{ label: 'Vietnamese', value: 'vietnamese' }, { label: 'Other', value: 'other' },
		], defaultValue: 'english'
	},
	{
		key: 'audience', label: 'Audience', type: 'select', options: [
			{ label: 'Patient', value: 'patient' }, { label: 'Caregiver', value: 'caregiver' },
			{ label: 'Both', value: 'both' },
		], defaultValue: 'patient'
	},
	{ key: 'author', label: 'Author', type: 'search', placeholder: 'Search provider or type name...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
	{
		key: 'isActive', label: 'Active', type: 'select', options: [
			{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' },
		], defaultValue: 'true'
	},
	{ key: 'tags', label: 'Tags', type: 'text', placeholder: 'Comma-separated tags', width: 'span 2' },
	// Description removed to match the ciyex-ehr-ui form (issue #8).
];

export class EducationEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexEducation';

	private eduView: 'library' | 'assignments' = 'library';

	private readonly _libraryConfig: ClinicalEditorConfig = {
		title: 'Education Library', apiPath: '/api/education/materials',
		searchPlaceholder: 'Search by title, category, content type...',
		clientSideFilter: ['title', 'category', 'contentType', 'id'],
		editable: true,
		refetchOnEdit: true,
		// `tags` is a JSON column in education_material, but the form captures it as
		// a comma-separated text field. Sending the raw text (e.g. "YES") makes
		// Postgres reject it ("invalid input syntax for type json"). Normalise it
		// into a JSON array string here so the column always receives valid JSON.
		// Handles both create (comma list) and edit (already a JSON array string).
		beforeSave: (payload) => {
			if (Object.prototype.hasOwnProperty.call(payload, 'tags')) {
				const raw = (payload.tags ?? '').toString().trim();
				let arr: string[] = [];
				if (raw.startsWith('[')) {
					try {
						const parsed = JSON.parse(raw);
						arr = Array.isArray(parsed) ? parsed.map(t => String(t)) : [];
					} catch {
						arr = raw.split(',').map(t => t.trim()).filter(Boolean);
					}
				} else if (raw) {
					arr = raw.split(',').map(t => t.trim()).filter(Boolean);
				}
				payload.tags = arr.length ? JSON.stringify(arr) : null;
			}
			// `isActive` is captured as the string 'true'/'false' by the select;
			// coerce it to a real boolean so the Boolean DTO field deserialises.
			if (Object.prototype.hasOwnProperty.call(payload, 'isActive')) {
				payload.isActive = payload.isActive === true || payload.isActive === 'true';
			}
			// Drop blank optional fields so empty-string values never trip backend
			// validation (mirrors the working CdsEditor config).
			for (const k of Object.keys(payload)) {
				if (payload[k] === '' || payload[k] === undefined) { delete payload[k]; }
			}
			return payload;
		},
		// Issue #24: enable horizontal scroll on narrow viewports so the Actions
		// column stays visible rather than being clipped by the right edge.
		tableMinWidth: '900px',
		// Source column removed; an Actions column (Assign to Patient / Edit / Delete)
		// is rendered automatically from `actions` + `editable` below (issue #13).
		columns: [
			// All columns are flexible so the leftover pane width is shared across
			// the whole row instead of being dumped into a single track. A plain
			// `1.5fr` title (the only flexible column among fixed-px ones) absorbed
			// ALL the slack and left a huge empty gap before Category; proportional
			// `fr` weights keep the columns evenly spread with no awkward gap.
			// Title is kept close to Category by giving it a smaller flex weight so
			// its track doesn't grow much wider than the title text itself.
			{ key: 'title', label: 'Title', width: 'minmax(0,1.4fr)' },
			{ key: 'category', label: 'Category', width: 'minmax(0,1.3fr)' },
			{ key: 'contentType', label: 'Type', width: 'minmax(0,0.9fr)' },
			{ key: 'isActive', label: 'Active', width: 'minmax(0,0.6fr)' },
			{ key: 'viewCount', label: 'Views', width: 'minmax(0,0.6fr)' },
		],
		additionalFilters: [
			{
				key: 'category', placeholder: 'All Categories',
				options: [
					{ label: 'Disease Management', value: 'disease_management' },
					{ label: 'Medication', value: 'medication' },
					{ label: 'Procedure', value: 'procedure' },
					{ label: 'Lifestyle', value: 'lifestyle' },
					{ label: 'Preventive', value: 'preventive' },
					{ label: 'Mental Health', value: 'mental_health' },
					{ label: 'Nutrition', value: 'nutrition' },
					{ label: 'Other', value: 'other' },
				],
			},
			{
				key: 'contentType', placeholder: 'All Types',
				options: [
					{ label: 'Article', value: 'article' }, { label: 'Video', value: 'video' },
					{ label: 'PDF', value: 'pdf' }, { label: 'Link', value: 'link' },
					{ label: 'Handout', value: 'handout' }, { label: 'Infographic', value: 'infographic' },
				],
			},
		],
		cellRenderer: (key, value) => {
			if (key === 'isActive') { return value ? 'Yes' : 'No'; }
			if (key === 'category' || key === 'contentType') {
				return String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		formFields: EDUCATION_FORM_FIELDS,
		actions: [
			{
				// Issue #13: "Assign to Patient" opens the Patient Assignments view and
				// a pre-filled New Assignment form so the chosen material can be
				// assigned to a patient — mirrors the EHR-UI library row action.
				// allow-any-unicode-next-line
				label: 'Assign to Patient', icon: '\u{1F4E4}', handler: async (item) => {
					this.eduView = 'assignments';
					this._updateEduSidebarActive();
					this._eduLibraryMain.style.display = 'none';
					this._eduAssignPanel.style.display = 'flex';
					this._openCreateForm({ materialTitle: item.title, materialId: item.id, category: item.category });
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this material?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/education/materials/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	private readonly _assignmentsConfig: ClinicalEditorConfig = {
		title: 'Patient Assignments', apiPath: '/api/education/assignments',
		searchPlaceholder: 'Search by topic, patient, category...',
		// Column keys mirror PatientEducationAssignmentDto field names. The
		// previous config used `category`/`priority` which the backend doesn't
		// emit, so Topic + Patient columns rendered empty (QA report image15).
		clientSideFilter: ['materialTitle', 'patientName', 'materialCategory', 'materialContentType', 'status', 'assignedBy', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Issue #24: horizontal scroll fallback when the sidebar steals viewport width.
		tableMinWidth: '1000px',
		columns: [
			{ key: 'materialTitle', label: 'Topic', width: 'minmax(0,1.6fr)' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'materialCategory', label: 'Category', width: '120px' },
			{ key: 'materialContentType', label: 'Type', width: '90px' },
			{ key: 'assignedBy', label: 'Assigned By', width: '120px' },
			{ key: 'status', label: 'Status', width: '110px' },
			{ key: 'dueDate', label: 'Due Date', width: '100px' },
		],
		statusTabs: [
			{ label: 'Assigned', value: 'assigned' },
			{ label: 'Viewed', value: 'viewed' },
			{ label: 'Completed', value: 'completed' },
			{ label: 'Dismissed', value: 'dismissed' },
		],
		additionalFilters: [
			{
				key: 'materialCategory', placeholder: 'All Categories',
				options: [
					{ label: 'Disease Management', value: 'disease_management' },
					{ label: 'Medication', value: 'medication' },
					{ label: 'Procedure', value: 'procedure' },
					{ label: 'Lifestyle', value: 'lifestyle' },
					{ label: 'Preventive', value: 'preventive' },
					{ label: 'Mental Health', value: 'mental_health' },
					{ label: 'Nutrition', value: 'nutrition' },
					{ label: 'Other', value: 'other' },
				],
			},
		],
		cellRenderer: (key, value, item) => {
			if (key === 'materialCategory' && value) {
				return String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'materialContentType' && value) {
				return String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'dueDate' && value) {
				try { return new Date(String(value)).toLocaleDateString(); } catch { return String(value); }
			}
			// allow-any-unicode-next-line
			return String(value ?? item[key] ?? '—');
		},
		formFields: [
			{
				key: 'patientName', label: 'Patient', type: 'search', required: true,
				placeholder: 'Search patient (must be selected from results)...',
				apiPath: '/api/patients', relatedField: 'patientId',
				relatedDisplayFields: ['firstName', 'lastName'],
				// Only a patient chosen from the results is accepted — free text is
				// wiped on blur and the field locks once a patient is picked.
				strictSelect: true,
				validationMessage: 'Please select a patient from the search results',
			},
			// type:'number' ensures the ID is sent as a JSON number (not string) so
			// Spring JPA findById does not receive null when the value is ''.
			{ key: 'patientId', label: 'Patient ID', type: 'number', required: true, hidden: true, placeholder: 'Auto-filled', validationMessage: 'Please select a patient from the search results — not just typed text' },
			{
				key: 'materialTitle', label: 'Topic / Material', type: 'search', required: true,
				placeholder: 'Search education material...',
				apiPath: '/api/education/materials',
				relatedField: 'materialId',
				searchDisplayField: 'title',
				relatedFieldsMap: { category: 'category' },
				// Only a material chosen from the results is accepted — free text is
				// wiped on blur and the field locks once a material is picked.
				strictSelect: true,
				validationMessage: 'Please select an education material from the search results',
			},
			{ key: 'materialId', label: 'Material ID', type: 'number', required: true, hidden: true, placeholder: 'Auto-filled', validationMessage: 'Please select a material from the search results — not just typed text' },
			{
				key: 'category', label: 'Category', type: 'select', options: [
					{ label: 'Disease Management', value: 'disease_management' }, { label: 'Medication', value: 'medication' },
					{ label: 'Procedure', value: 'procedure' }, { label: 'Lifestyle', value: 'lifestyle' },
					{ label: 'Preventive', value: 'preventive' }, { label: 'Other', value: 'other' },
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
			{ key: 'assignedBy', label: 'Assigned By', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'], strictSelect: true },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Instructions for the patient...' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this assignment?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/education/assignments/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	// @ts-ignore — override abstract readonly with getter to support view switching
	protected get config(): ClinicalEditorConfig {
		return this.eduView === 'library' ? this._libraryConfig : this._assignmentsConfig;
	}

	private _eduSidebarItems: Map<string, HTMLElement> = new Map();
	private _eduLibraryMain!: HTMLElement;
	private _eduAssignPanel!: HTMLElement;
	private _eduAssignListEl!: HTMLElement;
	private _eduAssignPatientId: number | null = null;
	private _eduAssignPatientName = '';

	protected override wrapContent(parent: HTMLElement): HTMLElement {
		const wrapper = DOM.append(parent, DOM.$('.education-wrapper'));
		wrapper.style.cssText = 'display:flex;flex-direction:row;height:100%;width:100%;';

		// allow-any-unicode-next-line
		// ── Sidebar ──────────────────────────────────────────────────────────
		const sidebar = DOM.append(wrapper, DOM.$('.education-sidebar'));
		// Collapsible-on-hover: stays narrow (icons only) while the user works in
		// the library table or a form, expands to show labels on pointer-over.
		const SIDEBAR_W_EXPANDED = '230px';
		const SIDEBAR_W_COLLAPSED = '52px';
		sidebar.style.cssText = `width:${SIDEBAR_W_COLLAPSED};flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background);padding:16px 0;overflow:hidden;display:flex;flex-direction:column;transition:width 0.15s ease;`;

		const sbHeader = DOM.append(sidebar, DOM.$('div'));
		sbHeader.style.cssText = 'padding:0 16px 12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:8px;white-space:nowrap;';
		const sbTitle = DOM.append(sbHeader, DOM.$('div'));
		// allow-any-unicode-next-line
		sbTitle.textContent = '📚 Patient Education';
		sbTitle.style.cssText = 'font-weight:700;font-size:14px;color:var(--vscode-foreground);';
		const sbSub = DOM.append(sbHeader, DOM.$('div'));
		sbSub.textContent = 'Library & assignments';
		sbSub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		const items: Array<{ key: 'library' | 'assignments'; label: string; icon: string }> = [
			// allow-any-unicode-next-line
			{ key: 'library', label: 'Education Library', icon: '📖' },
			// allow-any-unicode-next-line
			{ key: 'assignments', label: 'Patient Assignments', icon: '📝' },
		];
		const navEls: HTMLElement[] = [];
		const labelEls: HTMLElement[] = [];
		for (const it of items) {
			const navEl = DOM.append(sidebar, DOM.$('div'));
			navEl.style.cssText = 'display:flex;align-items:center;gap:10px;margin:2px 8px;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;color:var(--vscode-descriptionForeground);transition:background 0.1s;white-space:nowrap;overflow:hidden;';
			const iconEl = DOM.append(navEl, DOM.$('span'));
			iconEl.textContent = it.icon;
			iconEl.style.cssText = 'font-size:15px;width:18px;text-align:center;flex-shrink:0;';
			const lbl = DOM.append(navEl, DOM.$('span'));
			lbl.textContent = it.label;
			navEl.title = it.label; // tooltip so the icon is identifiable while collapsed
			navEl.addEventListener('mouseenter', () => { if (this.eduView !== it.key) { navEl.style.background = 'var(--vscode-list-hoverBackground)'; } });
			navEl.addEventListener('mouseleave', () => { if (this.eduView !== it.key) { navEl.style.background = ''; } });
			navEl.addEventListener('click', () => {
				if (this.eduView === it.key) { return; }
				this.eduView = it.key;
				this._updateEduSidebarActive();
				if (it.key === 'assignments') {
					// Switch to the custom patient-search panel — matching ehr-ui layout.
					this._eduLibraryMain.style.display = 'none';
					this._eduAssignPanel.style.display = 'flex';
				} else {
					this._eduLibraryMain.style.display = '';
					this._eduAssignPanel.style.display = 'none';
					this._resetAndReload();
				}
			});
			navEls.push(navEl);
			labelEls.push(lbl);
			this._eduSidebarItems.set(it.key, navEl);
		}

		const setSidebarCollapsed = (collapsed: boolean): void => {
			sidebar.style.width = collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_EXPANDED;
			sbHeader.style.display = collapsed ? 'none' : '';
			for (const l of labelEls) { l.style.display = collapsed ? 'none' : ''; }
			for (const n of navEls) {
				n.style.justifyContent = collapsed ? 'center' : '';
				n.style.padding = collapsed ? '8px 0' : '8px 12px';
			}
		};
		// Expand when the pointer is over the sidebar; collapse once it leaves
		// (i.e. when the user moves into the table/form area).
		sidebar.addEventListener('mouseenter', () => setSidebarCollapsed(false));
		sidebar.addEventListener('mouseleave', () => setSidebarCollapsed(true));
		setSidebarCollapsed(true);

		this._updateEduSidebarActive();

		// allow-any-unicode-next-line
		// ── Library main area (returned as base-class content host) ──────────
		this._eduLibraryMain = DOM.append(wrapper, DOM.$('.education-main'));
		this._eduLibraryMain.style.cssText = 'flex:1;min-width:0;height:100%;overflow:hidden;';
		// Issue #5: the shared table header (rendered by ClinicalListEditorBase as the
		// sticky grid row inside `.cle-table-wrap`) used `padding:8px 14px` + 11px text
		// which made the Education Library header bar feel tall and heavy. The base file
		// can't be touched here, so scope a compact-header override to the Education
		// library only — matching MaterialLibrary.tsx's tight, low-profile list header.
		const eduHeaderStyle = DOM.append(this._eduLibraryMain, DOM.$('style'));
		eduHeaderStyle.textContent =
			'.education-main .cle-table-wrap > div[style*="sticky"]{' +
			'padding-top:4px !important;padding-bottom:4px !important;' +
			'font-size:10px !important;letter-spacing:0.2px !important;line-height:1.3 !important;}';

		// allow-any-unicode-next-line
		// ── Patient Assignments panel (ehr-ui search-by-patient approach) ────
		this._eduAssignPanel = DOM.append(wrapper, DOM.$('.education-assign-panel'));
		this._eduAssignPanel.style.cssText = 'flex:1;min-width:0;height:100%;overflow:hidden;display:none;flex-direction:column;background:var(--vscode-editor-background);';
		this._buildAssignPanel();

		return this._eduLibraryMain;
	}

	private _buildAssignPanel(): void {
		const hdr = DOM.append(this._eduAssignPanel, DOM.$('div'));
		hdr.style.cssText = 'flex-shrink:0;padding:16px 24px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;justify-content:space-between;gap:12px;';
		const hdrTitle = DOM.append(hdr, DOM.$('h2'));
		// allow-any-unicode-next-line
		hdrTitle.textContent = '✉ Patient Assignments';
		hdrTitle.style.cssText = 'margin:0;font-size:16px;font-weight:600;color:var(--vscode-foreground);display:flex;align-items:center;gap:8px;';

		// "+ Assign Material" button — mirrors ciyex-ehr-ui green action button so
		// users can assign a material without leaving the Patient Assignments view.
		// Reuses the assignmentsConfig.formFields via the base class _openForm
		// hook; the assignmentsConfig is active because eduView === 'assignments'
		// while this panel is visible.
		const assignBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		assignBtn.textContent = '+ Assign Material';
		assignBtn.style.cssText = 'padding:6px 14px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;flex-shrink:0;';
		assignBtn.addEventListener('mouseenter', () => { assignBtn.style.background = '#15803d'; });
		assignBtn.addEventListener('mouseleave', () => { assignBtn.style.background = '#16a34a'; });
		assignBtn.addEventListener('click', () => {
			// Pre-fill the assignment form with the currently selected patient
			// (if any) so the user doesn't have to retype it.
			const seed: Record<string, unknown> | null = this._eduAssignPatientId
				? { patientId: this._eduAssignPatientId, patientName: this._eduAssignPatientName }
				: null;
			void this._openForm(seed);
		});

		const searchWrap = DOM.append(this._eduAssignPanel, DOM.$('div'));
		searchWrap.style.cssText = 'flex-shrink:0;padding:12px 24px;border-bottom:1px solid var(--vscode-editorWidget-border);position:relative;';
		const searchInput = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = 'Search patient by name or DOB...';
		searchInput.style.cssText = 'width:100%;padding:8px 12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';

		const dropdown = DOM.append(searchWrap, DOM.$('div'));
		dropdown.style.cssText = 'position:absolute;top:calc(100% - 12px);left:24px;right:24px;max-height:200px;overflow-y:auto;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:0 0 6px 6px;z-index:200;display:none;';

		let patTimer: ReturnType<typeof setTimeout> | undefined;
		searchInput.addEventListener('input', () => {
			if (patTimer) { clearTimeout(patTimer); }
			const q = searchInput.value.trim();
			if (q.length < 2) { dropdown.style.display = 'none'; return; }
			patTimer = setTimeout(async () => {
				try {
					const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
					if (!res.ok) { return; }
					const data = await res.json();
					const patients: Record<string, unknown>[] = data?.data?.content || data?.content || data?.data || [];
					DOM.clearNode(dropdown);
					for (const p of patients) {
						const item = DOM.append(dropdown, DOM.$('div'));
						item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);';
						const fn = String(p['firstName'] || '');
						const ln = String(p['lastName'] || '');
						const dob = p['dateOfBirth'] ? ` — DOB: ${p['dateOfBirth']}` : '';
						item.textContent = `${fn} ${ln}`.trim() + dob;
						item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
						item.addEventListener('mouseleave', () => { item.style.background = ''; });
						// MOUSEDOWN, not click: the input blur hides the dropdown after
						// 150ms, swallowing slower clicks — picking took two clicks (QA).
						item.addEventListener('mousedown', (e) => {
							e.preventDefault();
							this._eduAssignPatientId = typeof p['id'] === 'number' ? p['id'] : parseInt(String(p['id'] || '0'), 10);
							this._eduAssignPatientName = `${fn} ${ln}`.trim();
							searchInput.value = this._eduAssignPatientName;
							dropdown.style.display = 'none';
							this._loadPatientAssignments();
						});
					}
					dropdown.style.display = patients.length > 0 ? 'block' : 'none';
				} catch { /* ignore */ }
			}, 250);
		});
		searchInput.addEventListener('blur', () => { setTimeout(() => { dropdown.style.display = 'none'; }, 150); });

		this._eduAssignListEl = DOM.append(this._eduAssignPanel, DOM.$('div'));
		this._eduAssignListEl.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:20px 24px;';
		this._renderAssignEmpty();
	}

	private _renderAssignEmpty(): void {
		DOM.clearNode(this._eduAssignListEl);
		const empty = DOM.append(this._eduAssignListEl, DOM.$('div'));
		empty.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--vscode-descriptionForeground);gap:12px;';
		const icon = DOM.append(empty, DOM.$('div'));
		// allow-any-unicode-next-line
		icon.textContent = '👤';
		icon.style.cssText = 'font-size:48px;opacity:0.35;';
		const msg = DOM.append(empty, DOM.$('div'));
		msg.textContent = 'Search for a patient to view their education assignments';
		msg.style.cssText = 'font-size:13px;text-align:center;max-width:280px;';
	}

	private async _loadPatientAssignments(): Promise<void> {
		if (!this._eduAssignPatientId) { return; }
		DOM.clearNode(this._eduAssignListEl);
		const loading = DOM.append(this._eduAssignListEl, DOM.$('div'));
		loading.style.cssText = 'padding:20px;color:var(--vscode-descriptionForeground);font-size:13px;';
		loading.textContent = `Loading assignments for ${this._eduAssignPatientName}...`;
		try {
			const res = await this.apiService.fetch(`/api/education/assignments/patient/${this._eduAssignPatientId}`);
			if (!res.ok) { loading.textContent = 'Failed to load assignments.'; return; }
			const raw = await res.json();
			const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : (raw?.data?.content || raw?.content || raw?.data || []);
			DOM.clearNode(this._eduAssignListEl);
			this._renderAssignTable(items);
		} catch {
			loading.textContent = 'Error loading assignments.';
		}
	}

	private _renderAssignTable(items: Record<string, unknown>[]): void {
		if (items.length === 0) {
			const empty = DOM.append(this._eduAssignListEl, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
			empty.textContent = `No education assignments found for ${this._eduAssignPatientName}`;
			return;
		}
		const cols = '2fr 120px 110px 110px 130px';
		const tbl = DOM.append(this._eduAssignListEl, DOM.$('div'));
		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const lbl of ['Topic', 'Category', 'Type', 'Status', 'Assigned By']) {
			DOM.append(hr, DOM.$('span')).textContent = lbl;
		}
		const STATUS_COLORS: Record<string, string> = { assigned: '#3b82f6', viewed: '#f59e0b', completed: '#22c55e', dismissed: '#6b7280' };
		for (const item of items) {
			const row = DOM.append(tbl, DOM.$('div'));
			row.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 12px;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;align-items:center;`;
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			const fmt = (v: unknown) => String(v || '—').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			const cellValues = [
				String(item['materialTitle'] || item['title'] || '—'),
				fmt(item['materialCategory'] || item['category']),
				fmt(item['materialContentType'] || item['contentType']),
				String(item['status'] || '—'),
				String(item['assignedBy'] || '—'),
			];
			cellValues.forEach((text, i) => {
				const cell = DOM.append(row, DOM.$('span'));
				cell.textContent = text;
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				if (i === 3) {
					const clr = STATUS_COLORS[text.toLowerCase()] || '#6b7280';
					cell.style.cssText += `color:${clr};font-weight:500;text-transform:capitalize;`;
				}
			});
		}
	}

	private _updateEduSidebarActive(): void {
		for (const [key, el] of this._eduSidebarItems.entries()) {
			const isActive = key === this.eduView;
			el.style.background = isActive ? 'var(--vscode-list-activeSelectionBackground,rgba(0,122,204,0.18))' : '';
			el.style.color = isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)';
			el.style.fontWeight = isActive ? '600' : '500';
		}
	}

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(EducationEditor.ID, group, t, th, s, a, d); }
}

// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────
// OPERATIONS EDITORS
// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────

interface IRecallOutreachLog {
	attemptNumber?: number;
	attemptDate?: string;
	method?: string;
	outcome?: string;
	notes?: string;
	performedByName?: string;
}

interface IRecallDetail {
	id?: number;
	patientId?: number;
	patientName?: string;
	patientPhone?: string;
	patientEmail?: string;
	providerName?: string;
	status?: string;
	priority?: string;
	preferredContact?: string;
	attemptCount?: number;
	lastAttemptDate?: string;
	lastAttemptMethod?: string;
	recallTypeName?: string;
	dueDate?: string;
	outreachLogs?: IRecallOutreachLog[];
}

/** Accent colour for a recall status badge, mirroring the web RecallBoard pills. */
function recallStatusColor(status: string): string {
	switch ((status || '').toUpperCase()) {
		case 'CONTACTED': return '#b45309';
		case 'SCHEDULED': return '#2563eb';
		case 'COMPLETED': return '#16a34a';
		case 'CANCELLED': return '#6b7280';
		case 'OVERDUE': return '#dc2626';
		case 'PENDING': return '#7c3aed';
		default: return '#6b7280';
	}
}

/** Format an ISO date/datetime string as a short locale date; falls back to the raw value. */
function formatRecallDate(value: string | undefined): string {
	if (!value) { return '—'; }
	try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return value; }
}

/**
 * Right-side detail drawer shown when the Recall "call" action is clicked.
 * Mirrors the web RecallBoard detail panel: a status/priority header with
 * Mark Complete / Cancel, a patient & provider summary, and an outreach history
 * list with a Log Outreach button. Data comes from GET /api/recalls/{id} (which
 * includes nested outreachLogs); Mark Complete / Cancel PUT a partial status
 * change; Log Outreach POSTs to /api/recalls/{id}/outreach. Every mutation
 * re-fetches the panel and reloads the underlying list.
 */
async function showRecallDetailPanel(opts: { recallId: string | number; api: ICiyexApiService; reload: () => void; dlg: IDialogService }): Promise<void> {
	const { recallId, api, reload, dlg } = opts;
	const doc = DOM.getActiveWindow().document;
	const mount = findWorkbenchRoot(doc.body || doc.documentElement, doc);

	const overlay = DOM.append(mount, DOM.$('div'));
	// Mirror the workbench classList so the drawer's children stay themed, but
	// keep the overlay itself transparent — otherwise the `.monaco-workbench`
	// class paints its opaque editor background over the whole viewport and the
	// page "goes out" behind the panel. The 40% backdrop below provides the dim.
	// (Matches the create/edit form drawer in ClinicalListEditorBase._openForm.)
	overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
	overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;justify-content:flex-end;background:transparent;color:var(--vscode-foreground);';
	overlay.tabIndex = -1;

	const backdrop = DOM.append(overlay, DOM.$('div'));
	backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';

	// Sit the drawer below the title bar with a small gap and rounded inner edge,
	// matching the form drawer so the two panels look consistent.
	// eslint-disable-next-line no-restricted-syntax
	const titlebarEl = doc.querySelector('.part.titlebar');
	const titlebarHeight = titlebarEl ? (titlebarEl as HTMLElement).getBoundingClientRect().height : 35;
	const GAP = 12;
	const panel = DOM.append(overlay, DOM.$('div'));
	panel.style.cssText = `position:relative;width:460px;max-width:95vw;height:calc(100% - ${titlebarHeight + GAP * 2}px);margin-top:${titlebarHeight + GAP}px;margin-bottom:${GAP}px;overflow-y:auto;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));border-left:1px solid var(--vscode-editorWidget-border);border-radius:8px 0 0 8px;box-shadow:-8px 0 24px rgba(0,0,0,0.3);padding:18px 20px;box-sizing:border-box;color:var(--vscode-foreground);`;

	let settled = false;
	const close = () => { if (settled) { return; } settled = true; overlay.remove(); };
	backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { close(); } });
	overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); } });

	// Inline "Log Outreach" form state. Kept across re-renders so toggling open and
	// reloading data doesn't lose the form.
	let outreachFormOpen = false;
	const METHOD_OPTIONS = ['PHONE', 'EMAIL', 'SMS', 'PORTAL', 'MAIL', 'IN_PERSON'];
	const OUTCOME_OPTIONS = ['REACHED', 'NO_ANSWER', 'LEFT_VOICEMAIL', 'LEFT_MESSAGE', 'BUSY', 'SCHEDULED', 'DECLINED'];

	const mutateStatus = async (status: string, reason?: string) => {
		try {
			const body: Record<string, string> = reason ? { status, cancelledReason: reason } : { status };
			const r = await api.fetch(`/api/recalls/${recallId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			if (!r.ok) { await dlg.error(`Failed to update recall (${r.status})`); return; }
			reload();
			await load();
		} catch (e) { await dlg.error(`Failed to update recall: ${e instanceof Error ? e.message : String(e)}`); }
	};

	const saveOutreach = async (method: string, outcome: string, notes: string) => {
		try {
			const body: Record<string, string> = { method, outcome };
			if (notes.trim()) { body.notes = notes.trim(); }
			const r = await api.fetch(`/api/recalls/${recallId}/outreach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			if (!r.ok) { const err = await r.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(err?.['message'] || `Failed to log outreach (${r.status})`)); return; }
			outreachFormOpen = false;
			reload();
			await load();
		} catch (e) { await dlg.error(`Failed to log outreach: ${e instanceof Error ? e.message : String(e)}`); }
	};

	const infoRow = (grid: HTMLElement, label: string, value: string) => {
		const cell = DOM.append(grid, DOM.$('div'));
		const l = DOM.append(cell, DOM.$('div'));
		l.textContent = label;
		l.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px;';
		const v = DOM.append(cell, DOM.$('div'));
		v.textContent = value || '—';
		v.style.cssText = 'font-size:13px;font-weight:500;word-break:break-word;';
	};

	const render = (recall: IRecallDetail) => {
		DOM.clearNode(panel);
		const status = (recall.status || '').toUpperCase();
		const terminal = status === 'COMPLETED' || status === 'CANCELLED';

		const closeBtn = DOM.append(panel, DOM.$('button'));
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.title = 'Close';
		closeBtn.style.cssText = 'position:absolute;top:12px;right:14px;background:transparent;border:none;color:var(--vscode-descriptionForeground);font-size:14px;cursor:pointer;';
		closeBtn.addEventListener('click', () => close());

		// Header: status badge + priority | Mark Complete / Cancel
		const header = DOM.append(panel, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 26px 16px 0;flex-wrap:wrap;';
		const left = DOM.append(header, DOM.$('div'));
		left.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const badge = DOM.append(left, DOM.$('span'));
		badge.textContent = status || '—';
		badge.style.cssText = `padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;color:#fff;background:${recallStatusColor(status)};`;
		const prio = DOM.append(left, DOM.$('span'));
		prio.textContent = (recall.priority || '').toUpperCase();
		prio.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);';

		const actions = DOM.append(header, DOM.$('div'));
		actions.style.cssText = 'display:flex;gap:6px;';
		const mkBtn = (label: string, color: string, fn: () => void) => {
			const b = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			b.style.cssText = `padding:4px 10px;border-radius:4px;border:1px solid ${color};background:transparent;color:${color};font-size:11px;font-weight:600;cursor:pointer;`;
			if (terminal) { b.style.opacity = '0.4'; b.style.cursor = 'default'; b.disabled = true; } else { b.addEventListener('click', fn); }
		};
		mkBtn('Mark Complete', '#16a34a', () => { void mutateStatus('COMPLETED'); });
		mkBtn('Cancel', '#dc2626', async () => {
			const r = await dlg.input({ type: 'question', message: 'Cancel this recall?', inputs: [{ placeholder: 'Reason (optional)' }] });
			if (!r.confirmed) { return; }
			await mutateStatus('CANCELLED', (r.values?.[0] || '').trim());
		});

		// Patient / provider summary grid
		const grid = DOM.append(panel, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;margin-bottom:18px;';
		infoRow(grid, 'Patient ID', recall.patientId !== null && recall.patientId !== undefined ? String(recall.patientId) : '—');
		infoRow(grid, 'Provider', recall.providerName || '—');
		infoRow(grid, 'Phone', recall.patientPhone || '—');
		infoRow(grid, 'Email', recall.patientEmail || '—');
		infoRow(grid, 'Preferred Contact', recall.preferredContact || '—');
		infoRow(grid, 'Attempts', recall.attemptCount !== null && recall.attemptCount !== undefined ? String(recall.attemptCount) : '0');
		const lastAttempt = recall.lastAttemptDate ? `${formatRecallDate(recall.lastAttemptDate)}${recall.lastAttemptMethod ? ` (${recall.lastAttemptMethod})` : ''}` : '—';
		infoRow(grid, 'Last Attempt', lastAttempt);

		// Outreach History header + Log Outreach button
		const histHead = DOM.append(panel, DOM.$('div'));
		histHead.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;border-top:1px solid var(--vscode-editorWidget-border);padding-top:14px;';
		const histTitle = DOM.append(histHead, DOM.$('div'));
		histTitle.textContent = 'Outreach History';
		histTitle.style.cssText = 'font-size:13px;font-weight:600;';
		// Log Outreach toggles the inline form below (hidden once the recall is in a
		// terminal state — nothing left to contact).
		if (!terminal) {
			const logBtn = DOM.append(histHead, DOM.$('button'));
			// allow-any-unicode-next-line
			logBtn.textContent = outreachFormOpen ? 'Close' : '📞 Log Outreach';
			logBtn.style.cssText = 'padding:4px 10px;border-radius:4px;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background,#2563eb);font-size:11px;font-weight:600;cursor:pointer;';
			logBtn.addEventListener('click', () => { outreachFormOpen = !outreachFormOpen; render(recall); });
		}

		// Inline Log Outreach form (Method + Outcome dropdowns + Notes), matching the
		// web RecallBoard. Posts to /api/recalls/{id}/outreach.
		if (!terminal && outreachFormOpen) {
			const fcard = DOM.append(panel, DOM.$('div'));
			fcard.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:12px;margin-bottom:12px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background,#252526));';

			const selStyle = 'width:100%;padding:7px 9px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
			const lblStyle = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const makeSelect = (options: string[], selected: string): HTMLSelectElement => {
				const sel = DOM.$('select') as HTMLSelectElement;
				sel.style.cssText = selStyle;
				for (const opt of options) {
					const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
					o.value = opt;
					o.textContent = opt.replace(/_/g, ' ');
					if (opt === selected) { o.selected = true; }
				}
				return sel;
			};

			const fieldRow = DOM.append(fcard, DOM.$('div'));
			fieldRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;';
			const methodWrap = DOM.append(fieldRow, DOM.$('div'));
			DOM.append(methodWrap, DOM.$('label')).textContent = 'Method'; (methodWrap.firstChild as HTMLElement).style.cssText = lblStyle;
			const methodSel = makeSelect(METHOD_OPTIONS, (recall.preferredContact || 'PHONE').toUpperCase());
			methodWrap.appendChild(methodSel);
			const outcomeWrap = DOM.append(fieldRow, DOM.$('div'));
			DOM.append(outcomeWrap, DOM.$('label')).textContent = 'Outcome'; (outcomeWrap.firstChild as HTMLElement).style.cssText = lblStyle;
			const outcomeSel = makeSelect(OUTCOME_OPTIONS, 'REACHED');
			outcomeWrap.appendChild(outcomeSel);

			const notesWrap = DOM.append(fcard, DOM.$('div'));
			notesWrap.style.cssText = 'margin-bottom:10px;';
			const notesLbl = DOM.append(notesWrap, DOM.$('label'));
			notesLbl.textContent = 'Notes'; notesLbl.style.cssText = lblStyle;
			const notesIn = DOM.append(notesWrap, DOM.$('textarea')) as HTMLTextAreaElement;
			notesIn.placeholder = 'Notes...';
			notesIn.style.cssText = selStyle + 'min-height:54px;resize:vertical;font-family:inherit;';

			const formBtns = DOM.append(fcard, DOM.$('div'));
			formBtns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
			const cancelBtn = DOM.append(formBtns, DOM.$('button')) as HTMLButtonElement;
			cancelBtn.textContent = 'Cancel';
			cancelBtn.style.cssText = 'padding:6px 14px;border-radius:4px;border:1px solid var(--vscode-editorWidget-border);background:transparent;color:var(--vscode-foreground);font-size:12px;cursor:pointer;';
			cancelBtn.addEventListener('click', () => { outreachFormOpen = false; render(recall); });
			const saveBtn = DOM.append(formBtns, DOM.$('button')) as HTMLButtonElement;
			saveBtn.textContent = 'Save';
			saveBtn.style.cssText = 'padding:6px 16px;border-radius:4px;border:none;background:var(--vscode-button-background,#2563eb);color:var(--vscode-button-foreground,#fff);font-size:12px;font-weight:600;cursor:pointer;';
			saveBtn.addEventListener('click', () => {
				saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
				void saveOutreach(methodSel.value, outcomeSel.value, notesIn.value);
			});
		}

		// History list (newest first)
		const logs = (recall.outreachLogs || []).slice().sort((a, b) => (b.attemptNumber || 0) - (a.attemptNumber || 0));
		if (logs.length === 0) {
			const empty = DOM.append(panel, DOM.$('div'));
			empty.textContent = 'No outreach logged yet.';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
		} else {
			for (const logItem of logs) {
				const card = DOM.append(panel, DOM.$('div'));
				card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:8px 10px;margin-bottom:8px;';
				const top = DOM.append(card, DOM.$('div'));
				top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
				const idDate = DOM.append(top, DOM.$('div'));
				idDate.textContent = `#${logItem.attemptNumber ?? '?'}  ${formatRecallDate(logItem.attemptDate)}`;
				idDate.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);';
				if (logItem.outcome) {
					const oc = DOM.append(top, DOM.$('span'));
					oc.textContent = logItem.outcome;
					oc.style.cssText = 'font-size:10px;padding:1px 8px;border-radius:999px;background:rgba(22,163,74,0.15);color:#16a34a;text-transform:capitalize;';
				}
				const method = DOM.append(card, DOM.$('div'));
				method.textContent = logItem.method || '—';
				method.style.cssText = 'font-size:13px;font-weight:500;margin-top:4px;';
				if (logItem.notes) {
					const note = DOM.append(card, DOM.$('div'));
					note.textContent = logItem.notes;
					note.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;word-break:break-word;';
				}
			}
		}
	};

	const load = async () => {
		try {
			const r = await api.fetch(`/api/recalls/${recallId}`);
			if (!r.ok) { DOM.clearNode(panel); panel.textContent = `Failed to load recall (${r.status}).`; return; }
			const json = await r.json().catch(() => null) as Record<string, unknown> | null;
			const recall = ((json && json['data']) || json) as IRecallDetail;
			render(recall);
		} catch (e) { DOM.clearNode(panel); panel.textContent = `Failed to load recall: ${e instanceof Error ? e.message : String(e)}`; }
	};

	panel.textContent = 'Loading…';
	overlay.focus();
	await load();
}

export const RECALL_FORM_FIELDS: FormFieldDef[] = [
	{
		key: 'patientName', label: 'Patient Name', type: 'search', required: true,
		placeholder: 'Type 2+ letters, then pick the patient from the dropdown',
		apiPath: '/api/patients',
		relatedField: 'patientId',
		relatedDisplayFields: ['firstName', 'lastName'],
		relatedFieldsMap: { patientPhone: 'phoneNumber||phone||mobile||cellPhone||homePhone', patientEmail: 'email||emailAddress' },
		validationMessage: 'Pick a patient from the dropdown — typing a name alone is not enough',
	},
	// patientId is filled by the patientName search; hidden + not required
	// so an empty value doesn't trigger a confusing "Patient ID required"
	// error against a field the user can't see (QA report 2026-05-11).
	{ key: 'patientId', label: 'Patient ID', type: 'text', hidden: true, placeholder: 'Auto-filled' },
	// Phone and Email mirror the selected patient's record (auto-filled from the
	// patient search). They are read-only so they always match the patient's
	// registered contact info and can't drift out of sync via hand-edits — e.g.
	// inconsistent email casing (QA: recall email doesn't match patient's email).
	{ key: 'patientPhone', label: 'Phone', type: 'text', placeholder: 'Auto-filled', readOnly: true },
	{ key: 'patientEmail', label: 'Email', type: 'text', placeholder: 'Auto-filled', readOnly: true },
	{
		key: 'recallTypeName', label: 'Recall Type', type: 'select', required: true,
		aliases: ['recallType', 'type'],
		options: [
			{ label: 'Annual Physical', value: 'Annual Physical' },
			{ label: 'Preventive Care', value: 'Preventive Care' },
			{ label: 'Follow-Up', value: 'Follow-Up' },
			{ label: 'Chronic Disease Management', value: 'Chronic Disease Management' },
			{ label: 'Immunization', value: 'Immunization' },
			{ label: 'Lab Review', value: 'Lab Review' },
			{ label: 'Specialist Follow-Up', value: 'Specialist Follow-Up' },
			{ label: 'Other', value: 'Other' },
		],
	},
	{
		key: 'providerName', label: 'Provider', type: 'search',
		placeholder: 'Search provider...', apiPath: '/api/providers',
		relatedDisplayFields: ['firstName', 'lastName'],
	},
	// A recall due date must not fall in a past year (QA: Due Date showed 2025
	// while the current year is later). year-start still allows an
	// earlier-this-year date so a genuinely overdue recall stays editable.
	{ key: 'dueDate', label: 'Due Date', type: 'date', required: true, minDate: 'year-start', validationMessage: 'Due Date cannot be a past-year date' },
	{
		key: 'priority', label: 'Priority', type: 'select', options: [
			{ label: 'Normal', value: 'NORMAL' }, { label: 'High', value: 'HIGH' }, { label: 'Urgent', value: 'URGENT' },
		], defaultValue: 'NORMAL'
	},
	{
		key: 'status', label: 'Status', type: 'select', options: [
			{ label: 'Pending', value: 'PENDING' }, { label: 'Due', value: 'DUE' },
			{ label: 'Overdue', value: 'OVERDUE' },
			{ label: 'Contacted', value: 'CONTACTED' }, { label: 'Scheduled', value: 'SCHEDULED' },
			{ label: 'Completed', value: 'COMPLETED' }, { label: 'Declined', value: 'DECLINED' },
			{ label: 'Cancelled', value: 'CANCELLED' },
		], defaultValue: 'PENDING'
	},
	{
		key: 'preferredContact', label: 'Preferred Contact', type: 'select', options: [
			{ label: 'Phone', value: 'PHONE' }, { label: 'Email', value: 'EMAIL' }, { label: 'SMS', value: 'SMS' },
		]
	},
	{ key: 'notes', label: 'Notes', type: 'textarea' },
];

/** A recall counts as Overdue when it is past its due date and neither
 * completed nor cancelled — the same rule the backend's countOverdue uses.
 * Shared by the Overdue status filter AND the Overdue KPI card computation so
 * the card count always equals the rows the filter shows. */
export class RecallEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexRecall';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Patient Recall', apiPath: '/api/recalls',
		// KPI cards on the web RecallBoard come from /api/recalls/kpis. Surfacing
		// them here gives the desktop the same "Due Today / Overdue / Completed /
		// Compliance / Pending / Contacted / Scheduled / Cancelled" header strip.
		statsPath: '/api/recalls/kpis',
		// Recall surfaces 7+ KPI cards; compact mode halves their vertical
		// height so the table is visible without scrolling (Issue #25).
		compactStats: true,
		statsFilterMap: {
			overdue: 'OVERDUE',
			dueTotal: 'DUE',
			pendingTotal: 'PENDING',
			contactedTotal: 'CONTACTED',
			scheduledTotal: 'SCHEDULED',
			completed: 'COMPLETED',
			declinedTotal: 'DECLINED',
			cancelledTotal: 'CANCELLED',
		},
		// /api/recalls/kpis counts a different population than the client-side
		// filters show ("9 Overdue" with an empty Overdue list; "0 Completed This
		// Month" while a completed recall sits under the Completed filter — QA
		// issues 6 & 7). Recompute every KPI card from the loaded rows with the
		// SAME literal-status rule the filter tabs use, so each card equals the rows
		// it surfaces. Overdue counts rows literally stamped status='OVERDUE' (the
		// desktop shows the stored status, so the card must match that badge rather
		// than the backend's computed past-due population); Completed counts every
		// completed recall (matching its Completed filter tab, not a month window).
		computeStats: (items) => {
			const byStatus = (s: string) => items.filter(i => String(i.status ?? '').toUpperCase() === s).length;
			return {
				overdue: byStatus('OVERDUE'),
				// Due/Declined are in the status filter AND the form, so the card
				// strip must surface them too — Due was missing from the summary
				// cards while DUE rows sat in the list (QA issue 8).
				dueTotal: byStatus('DUE'),
				completed: byStatus('COMPLETED'),
				pendingTotal: byStatus('PENDING'),
				contactedTotal: byStatus('CONTACTED'),
				scheduledTotal: byStatus('SCHEDULED'),
				declinedTotal: byStatus('DECLINED'),
				cancelledTotal: byStatus('CANCELLED'),
			};
		},
		searchPlaceholder: 'Search by patient name...',
		clientSideFilter: ['patientName', 'recallTypeName', 'providerName', 'status', 'priority', 'preferredContact', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Completing a recall through the edit form must stamp WHEN it was
		// completed — the form has no completedDate field, so without this the
		// row kept a stale/empty completion date and the "Completed This Month"
		// KPI missed recalls completed right now (QA issue 6). Only the
		// TRANSITION to COMPLETED stamps; re-saving an already-completed recall
		// keeps its original completion date.
		beforeSave: (payload, _isEdit, original) => {
			const nowCompleted = String(payload['status'] ?? '').toUpperCase() === 'COMPLETED';
			const wasCompleted = String(original?.['status'] ?? '').toUpperCase() === 'COMPLETED';
			if (nowCompleted && !wasCompleted) {
				payload['completedDate'] = new Date().toISOString().slice(0, 10);
			}
			return payload;
		},
		// 8 data columns + Actions overflow a narrow pane and crush the Contact
		// and Actions cells until they look empty/missing. A min-width lets the
		// table scroll horizontally so every column keeps its width and stays
		// aligned — matching the web RecallBoard layout.
		tableMinWidth: '1040px',
		// Columns ordered to match the web app's RecallBoard:
		// Patient | Type | Provider | Due Date | Status | Priority | Attempts | Contact
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'recallTypeName', label: 'Type' },
			{ key: 'providerName', label: 'Provider' },
			{ key: 'dueDate', label: 'Due Date', width: '110px' },
			{ key: 'status', label: 'Status', width: '110px' },
			{ key: 'priority', label: 'Priority', width: '90px' },
			{ key: 'attemptCount', label: 'Attempts', width: '80px' },
			{ key: 'preferredContact', label: 'Contact', width: '90px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'PENDING' }, { label: 'Due', value: 'DUE' },
			{ label: 'Overdue', value: 'OVERDUE' },
			{ label: 'Contacted', value: 'CONTACTED' }, { label: 'Scheduled', value: 'SCHEDULED' },
			{ label: 'Completed', value: 'COMPLETED' }, { label: 'Declined', value: 'DECLINED' },
			{ label: 'Cancelled', value: 'CANCELLED' },
		],
		additionalFilters: [
			{
				key: 'recallTypeName', placeholder: 'All Types',
				options: [
					{ label: 'Annual Physical', value: 'Annual Physical' },
					{ label: 'Preventive Care', value: 'Preventive Care' },
					{ label: 'Follow-Up', value: 'Follow-Up' },
					{ label: 'Chronic Disease Management', value: 'Chronic Disease Management' },
					{ label: 'Immunization', value: 'Immunization' },
					{ label: 'Lab Review', value: 'Lab Review' },
					{ label: 'Specialist Follow-Up', value: 'Specialist Follow-Up' },
					{ label: 'Other', value: 'Other' },
				],
			},
			{
				// Providers are loaded live from /api/providers so the filter
				// always reflects the current practice's clinicians — the
				// previous hardcoded list showed stale/old users (QA issue 8).
				key: 'providerName', placeholder: 'All Providers',
				options: [],
				optionsLoader: async () => {
					try {
						const res = await this.apiService.fetch('/api/providers?page=0&size=200');
						if (!res.ok) { return []; }
						const data = await res.json();
						const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
						const seen = new Set<string>();
						const opts: Array<{ label: string; value: string }> = [];
						for (const p of list) {
							const name = String(p.name || p.fullName || `${String(p.firstName || '')} ${String(p.lastName || '')}`.trim());
							if (name && !seen.has(name)) { seen.add(name); opts.push({ label: name, value: name }); }
						}
						return opts.sort((a, b) => a.label.localeCompare(b.label));
					} catch { return []; }
				},
				// The provider option label comes from /api/providers (often a fuller
				// name like "Lily Martinez") while a recall row stores an abbreviated
				// display name ("Lily M"). An exact compare would match nothing, so
				// match loosely: equal, or either name contained in the other.
				match: (item, value) => {
					const p = String(item.providerName ?? '').trim().toLowerCase();
					const v = value.trim().toLowerCase();
					if (!p) { return false; }
					return p === v || p.includes(v) || v.includes(p);
				},
			},
			{
				key: 'dueDateRange', placeholder: 'All Dates',
				options: [
					{ label: 'Today', value: 'today' },
					{ label: 'This Week', value: 'this_week' },
					{ label: 'This Month', value: 'this_month' },
					{ label: 'Overdue', value: 'overdue' },
					{ label: 'Next 30 Days', value: 'next_30' },
				],
				// `dueDateRange` is synthetic — there is no such field on a recall
				// record — so it needs a custom matcher against the row's dueDate.
				// Without this the default exact-field compare hides every row when a
				// range is picked (QA: All Dates filter shows no data).
				match: (item, value) => {
					const raw = String(item.dueDate ?? '');
					const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.split('T')[0]);
					if (!m) { return false; }
					const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
					due.setHours(0, 0, 0, 0);
					const today = new Date();
					today.setHours(0, 0, 0, 0);
					const dayMs = 86400000;
					switch (value) {
						case 'today':
							return due.getTime() === today.getTime();
						case 'this_week': {
							const start = new Date(today.getTime() - today.getDay() * dayMs);
							const end = new Date(start.getTime() + 6 * dayMs);
							return due >= start && due <= end;
						}
						case 'this_month':
							return due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth();
						case 'overdue':
							return due < today;
						case 'next_30':
							return due >= today && due <= new Date(today.getTime() + 30 * dayMs);
						default:
							return true;
					}
				},
			},
		],
		formFields: RECALL_FORM_FIELDS,
		actions: [
			{
				// The call action opens the recall detail drawer (status header with
				// Mark Complete / Cancel, patient/provider summary, and an outreach
				// history list with its own Log Outreach button) — matching the web
				// RecallBoard's row detail panel. Logging outreach now happens inside
				// that panel so the user sees the full history and current status.
				// allow-any-unicode-next-line
				label: 'View Details', icon: '📞', handler: async (item, api, reload, dlg) => {
					if (item.id === null || item.id === undefined) { await dlg.error('This recall has no id.'); return; }
					await showRecallDetailPanel({ recallId: item.id as string | number, api, reload, dlg });
				}
			},
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this recall?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/recalls/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(RecallEditor.ID, group, t, th, s, a, d); }
}

// Medical Code Active/Inactive - local persistence.
// The `global_codes` PUT endpoint does NOT persist the `active` field: it echoes
// the submitted value back in the response, but a subsequent GET still returns
// the code as Active (verified against api-dev). So toggling Active->Inactive
// never stuck no matter how the value was typed/coerced. Until the backend
// supports it, we remember the user's choice locally (keyed by tenant + code id)
// and re-apply it to every loaded row, so the change persists across reloads
// within the app. Shared by the full Codes editor and the Operations pane.
const MEDICAL_CODE_ACTIVE_OVERRIDE_KEY = 'ciyex.medicalCode.activeOverrides';

function _medicalCodeOverrideTenant(): string {
	try { return localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') || ''; } catch { return ''; }
}

function _readMedicalCodeOverrides(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(MEDICAL_CODE_ACTIVE_OVERRIDE_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
	} catch { return {}; }
}

/** Persist a Medical Code's Active/Inactive choice locally (tenant-scoped). */
export function setMedicalCodeActiveOverride(id: unknown, active: boolean): void {
	if (id === undefined || id === null || id === '') { return; }
	try {
		const all = _readMedicalCodeOverrides();
		all[`${_medicalCodeOverrideTenant()}::${String(id)}`] = active;
		localStorage.setItem(MEDICAL_CODE_ACTIVE_OVERRIDE_KEY, JSON.stringify(all));
	} catch { /* storage is best-effort */ }
}

/** Re-apply locally-stored Active/Inactive overrides onto loaded code rows. */
export function applyMedicalCodeActiveOverrides(items: Record<string, unknown>[]): Record<string, unknown>[] {
	const all = _readMedicalCodeOverrides();
	if (!Object.keys(all).length) { return items; }
	const tenant = _medicalCodeOverrideTenant();
	return items.map(it => {
		const id = it.id ?? it.fhirId;
		if (id === undefined || id === null) { return it; }
		const key = `${tenant}::${String(id)}`;
		return Object.prototype.hasOwnProperty.call(all, key) ? { ...it, active: all[key] } : it;
	});
}

export const MEDICAL_CODES_FORM_FIELDS: FormFieldDef[] = [
	{ key: 'code', label: 'Code', type: 'text', required: true, placeholder: 'e.g. 99213' },
	{
		key: 'codeType', label: 'Code Type', type: 'select', required: true, options: [
			{ label: 'ICD-10', value: 'ICD10' }, { label: 'CPT', value: 'CPT4' },
			{ label: 'HCPCS', value: 'HCPCS' }, { label: 'CDT', value: 'CDT' },
			{ label: 'SNOMED', value: 'SNOMED' }, { label: 'LOINC', value: 'LOINC' },
			{ label: 'NDC', value: 'NDC' }, { label: 'CVX', value: 'CVX' },
			{ label: 'Custom', value: 'CUSTOM' },
		]
	},
	{ key: 'modifier', label: 'Modifier', type: 'text', placeholder: 'e.g. 25, 59, GT' },
	{ key: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Office Visit, Preventive, Surgery' },
	{ key: 'shortDescription', label: 'Short Description', type: 'text', required: true, placeholder: 'e.g. Office/outpatient visit, established patient' },
	{ key: 'description', label: 'Full Description', type: 'textarea', placeholder: 'Detailed description of this code...', width: 'span 2' },
	// A fee is a monetary amount — never negative (QA: negative Fee Standard was
	// accepted and the code created). minValue:0 blocks it in create & edit.
	{ key: 'feeStandard', label: 'Fee Standard ($)', type: 'number', minValue: 0 },
	{ key: 'relateTo', label: 'Related To', type: 'text', placeholder: 'Related code or category', aliases: ['relatedTo'] },
	{
		key: 'active', label: 'Status', type: 'select', options: [
			{ label: 'Active', value: 'true' },
			{ label: 'Inactive', value: 'false' },
		], defaultValue: 'true'
	},
	{
		key: 'diagnosisReporting', label: 'Diagnosis Reporting', type: 'select', options: [
			{ label: 'Yes', value: 'true' },
			{ label: 'No', value: 'false' },
		], defaultValue: 'false'
	},
	{
		key: 'serviceReporting', label: 'Service Reporting', type: 'select', options: [
			{ label: 'Yes', value: 'true' },
			{ label: 'No', value: 'false' },
		], defaultValue: 'false'
	},
];

export class CodesEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCodes';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Medical Codes', apiPath: '/api/global_codes',
		searchPlaceholder: 'Search by code, description...',
		// "Status tabs" here are actually code-type categories, so filter on codeType.
		filterKey: 'codeType',
		clientSideFilter: ['code', 'codeType', 'modifier', 'shortDescription', 'description', 'category', 'relateTo', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Fixed pixel widths (no `fr`) keep the columns compact and readable
		// instead of the flexible Description/Category columns stretching across
		// the whole editor and leaving a big empty gap ("too much space"). Fixed
		// widths are identical for the header and every row so columns stay aligned
		// (content-based sizes like fit-content/auto differ per row, as each row is
		// its own grid). Row borders still span the full width, so the table reads
		// as compact-on-the-left with no cut-off edge.
		columns: [
			{ key: 'code', label: 'Code', width: '110px' },
			{ key: 'codeType', label: 'Type', width: '90px' },
			{ key: 'modifier', label: 'Modifier', width: '110px' },
			{ key: 'description', label: 'Description', width: '320px' },
			{ key: 'category', label: 'Category', width: '180px' },
			{ key: 'active', label: 'Active', width: '100px' },
		],
		statusTabs: [
			{ label: 'ICD-10', value: 'ICD10' }, { label: 'CPT', value: 'CPT4' },
			{ label: 'HCPCS', value: 'HCPCS' }, { label: 'CDT', value: 'CDT' },
			{ label: 'SNOMED', value: 'SNOMED' }, { label: 'LOINC', value: 'LOINC' },
			{ label: 'NDC', value: 'NDC' }, { label: 'CVX', value: 'CVX' },
			{ label: 'Custom', value: 'CUSTOM' },
		],
		additionalFilters: [
			{
				key: 'active', placeholder: 'All Status',
				options: [
					{ label: 'Active', value: 'true' },
					{ label: 'Inactive', value: 'false' },
				],
			},
		],
		formFields: MEDICAL_CODES_FORM_FIELDS,
		// The Status / Diagnosis-Reporting / Service-Reporting selects carry string
		// 'true'/'false' values, but the `global_codes` model fields are booleans.
		// Sending the raw string let the backend coerce 'false' to a truthy value
		// (any non-empty string is truthy), so toggling Active→Inactive "saved" but
		// the row still came back Active. Coerce to a real boolean before saving.
		beforeSave: (payload) => {
			for (const k of ['active', 'diagnosisReporting', 'serviceReporting']) {
				if (Object.prototype.hasOwnProperty.call(payload, k)) { payload[k] = payload[k] === true || payload[k] === 'true'; }
			}
			return payload;
		},
		// The backend ignores `active` on update, so remember the Active/Inactive
		// choice locally and re-apply it to every loaded row (QA issue 10).
		afterSave: (saved) => {
			if (Object.prototype.hasOwnProperty.call(saved, 'active')) {
				setMedicalCodeActiveOverride(saved.id ?? saved.fhirId, saved.active === true || saved.active === 'true');
			}
		},
		enrichItems: async (items) => applyMedicalCodeActiveOverrides(items),
		cellRenderer: (key, value) => {
			if (key === 'active') {
				return value === true || value === 'true' ? 'Active' : 'Inactive';
			}
			if (key === 'diagnosisReporting' || key === 'serviceReporting') {
				return value === true || value === 'true' ? 'Y' : 'N';
			}
			if (key === 'feeStandard') {
				const n = Number(value);
				if (!isFinite(n) || !value) { return '—'; }
				return `$${n.toFixed(2)}`;
			}
			return String(value ?? '');
		},
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this code?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/global_codes/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(CodesEditor.ID, group, t, th, s, a, d); }
}

/**
 * Single source of truth for the Inventory create/edit form. Used by both the
 * full editor ({@link InventoryEditor}) and the sidebar `+` quick-create drawer
 * (operationsMenuPane → formFieldsToEditFields) so the two forms always carry
 * the same fields, options and defaults. Edit fields HERE only.
 */
export const INVENTORY_FORM_FIELDS: FormFieldDef[] = [
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
		// Issue #11: Item Type options match ciyex-ehr-ui Inventory.tsx exactly.
		key: 'itemType', label: 'Item Type', type: 'select', options: [
			{ label: 'Consumable', value: 'consumable' },
			{ label: 'Device', value: 'device' },
			{ label: 'Medication', value: 'medication' },
			{ label: 'Other', value: 'other' },
		], defaultValue: 'consumable'
	},
	{ key: 'barcode', label: 'Barcode', type: 'text' },
	{ key: 'manufacturer', label: 'Manufacturer', type: 'text' },
	{
		// Issue #11: Cost Method "Average" uses value `average` to match ehr-ui.
		key: 'costMethod', label: 'Cost Method', type: 'select', options: [
			{ label: 'FIFO', value: 'fifo' },
			{ label: 'LIFO', value: 'lifo' },
			{ label: 'Average', value: 'average' },
		], defaultValue: 'fifo'
	},
	// Issue #13/#11: Category / Location / Supplier are dropdowns loaded from
	// the backend (matching ciyex-ehr-ui) instead of free-text ID inputs.
	// Suppliers use /api/suppliers/list (the list endpoint ehr-ui calls).
	{ key: 'categoryId', label: 'Category', type: 'select', optionsApiPath: '/api/inventory/categories', aliases: ['category.id'] },
	{ key: 'locationId', label: 'Location', type: 'select', optionsApiPath: '/api/inventory/locations', aliases: ['location.id'] },
	{ key: 'supplierId', label: 'Supplier', type: 'select', optionsApiPath: '/api/suppliers/list', aliases: ['supplier.id'] },
];

export class InventoryEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexInventory';

	// Default to the inventory list: the base editor's initial load renders the
	// table view, so landing on a custom view (dashboard/settings) here would
	// desync the tab state. Those are reachable via their tabs.
	private invView: 'dashboard' | 'inventory' | 'orders' | 'records' | 'suppliers' | 'maintenance' | 'settings' = 'inventory';

	private readonly _inventoryConfig: ClinicalEditorConfig = {
		title: 'Inventory', apiPath: '/api/inventory',
		searchPlaceholder: 'Search items...',
		clientSideFilter: ['name', 'sku', 'barcode', 'description', 'categoryName', 'locationName', 'manufacturer', 'unit', 'status', 'id'],
		editable: true,
		mergeOnEdit: true,
		refetchOnEdit: true,
		// Mirrors ciyex-ehr-ui Inventory.tsx columns exactly: Name | SKU | Stock |
		// Min | Unit | Category | Location | Status (Actions provided automatically).
		// Issue #13: distribute the flex across Name/Category/Location instead of
		// letting Name (the only fr column) absorb all slack and leave big gaps.
		columns: [
			{ key: 'name', label: 'Name', width: 'minmax(0,1.6fr)' },
			{ key: 'sku', label: 'SKU', width: '110px' },
			{ key: 'stockOnHand', label: 'Stock', width: '70px' },
			{ key: 'minStock', label: 'Min', width: '60px' },
			{ key: 'unit', label: 'Unit', width: '80px' },
			{ key: 'categoryName', label: 'Category', width: 'minmax(0,1fr)' },
			{ key: 'locationName', label: 'Location', width: 'minmax(0,1fr)' },
			{ key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' },
			{ label: 'Inactive', value: 'inactive' },
		],
		// Match the EHR UI Inventory toolbar: Status (covered by statusTabs above),
		// Category, Location — three dropdown filters next to the search box.
		additionalFilters: [
			{
				key: 'categoryName', placeholder: 'All Categories',
				options: [
					{ label: 'Consumable', value: 'Consumable' },
					{ label: 'Implant', value: 'Implant' },
					{ label: 'PPE', value: 'PPE' },
					{ label: 'Medication', value: 'Medication' },
					{ label: 'Equipment', value: 'Equipment' },
					{ label: 'Device', value: 'Device' },
				],
			},
			{
				key: 'locationName', placeholder: 'All Locations',
				// Issue #8a: locations fetched live from the DB so the filter is
				// never empty and reflects the practice's actual storage locations.
				options: [],
				optionsLoader: async () => {
					try {
						const res = await this.apiService.fetch('/api/inventory/locations');
						if (!res.ok) { return []; }
						const j = await res.json();
						const w = j?.data ?? j;
						const arr = (Array.isArray(w) ? w : (w?.content || [])) as Array<Record<string, unknown>>;
						return arr
							.map(l => String(l.name ?? '').trim())
							.filter(Boolean)
							.map(name => ({ label: name, value: name }));
					} catch { return []; }
				},
			},
		],
		cellRenderer: (key, value) => {
			if (key === 'costPerUnit' && typeof value === 'number') { return `$${value.toFixed(2)}`; }
			if (key === 'stockOnHand' && typeof value === 'number') {
				// colour-hint via text prefix matching ciyex-ehr-ui
				return String(value);
			}
			return String(value ?? '');
		},
		formFields: INVENTORY_FORM_FIELDS,
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this inventory item?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/inventory/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	private readonly _ordersConfig: ClinicalEditorConfig = {
		title: 'Purchase Orders', apiPath: '/api/orders',
		// Issue #14: mirror the ciyex-ehr-ui order form, which is a flat
		// single-item purchase order — Supplier | Item | Category | Date | Qty |
		// Amount | Status — posted to /api/orders.
		searchPlaceholder: 'Search by PO #, supplier...',
		clientSideFilter: ['poNumber', 'supplierName', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Create/edit are handled by the custom _openOrderForm modal (line items),
		// but the base editor only shows the create button when formFields is
		// non-empty — this token entry is never rendered (the _openForm override
		// intercepts orders before the generic form runs).
		createLabel: '+ New Purchase Order',
		formFields: [{ key: 'status', label: 'Status', type: 'text' }],
		// Mirrors ciyex-ehr-ui Orders.tsx columns: PO # | Supplier | Status | Date |
		// Total | Lines. Creation/editing use the custom _openOrderForm modal.
		columns: [
			{ key: 'poNumber', label: 'PO #', width: '150px' },
			{ key: 'supplierName', label: 'Supplier', width: 'minmax(0,1.4fr)' },
			{ key: 'status', label: 'Status', width: '120px' },
			{ key: 'orderDate', label: 'Date', width: '120px' },
			{ key: 'totalAmount', label: 'Total', width: '110px' },
			{ key: 'lines', label: 'Lines', width: '70px' },
		],
		statusTabs: [
			{ label: 'Draft', value: 'draft' }, { label: 'Submitted', value: 'submitted' },
			{ label: 'Partial', value: 'partial' }, { label: 'Received', value: 'received' },
			{ label: 'Cancelled', value: 'cancelled' },
		],
		cellRenderer: (key, value, item) => {
			if (key === 'supplierName' && !value) { return String(item.supplier ?? ''); }
			if (key === 'totalAmount' && value !== '' && value !== null && value !== undefined) {
				const n = Number(value);
				return isFinite(n) ? `$${n.toFixed(2)}` : String(value);
			}
			if (key === 'orderDate') {
				const d = value as string;
				if (d) { try { return new Date(String(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(d); } }
			}
			if (key === 'lines') { return String(Array.isArray(value) ? value.length : (value ?? 0)); }
			if (key === 'status' && typeof value === 'string') { return value.replace(/\b\w/g, c => c.toUpperCase()); }
			return String(value ?? '');
		},
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this order?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/orders/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	private readonly _suppliersConfig: ClinicalEditorConfig = {
		title: 'Suppliers', apiPath: '/api/suppliers',
		// Match Suppliers.tsx: Name | Contact | Phone | Email | Status, plus an
		// Active/Inactive status filter alongside the search box.
		searchPlaceholder: 'Search by name, contact, email, phone...',
		clientSideFilter: ['name', 'contactName', 'email', 'phone', 'id'],
		editable: true,
		refetchOnEdit: true,
		filterKey: 'isActive',
		columns: [
			{ key: 'name', label: 'Name', width: '1.5fr' },
			{ key: 'phone', label: 'Phone', width: '130px' },
			{ key: 'email', label: 'Email' },
			{ key: 'isActive', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'true' },
			{ label: 'Inactive', value: 'false' },
		],
		cellRenderer: (key, value) => {
			if (key === 'isActive') { return value === true || value === 'true' ? 'Active' : 'Inactive'; }
			return String(value ?? '');
		},
		formFields: [
			{
				key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Medline Industries',
				validationPattern: '^[A-Za-z][A-Za-z0-9 ,.&\\-\'()/]{1,127}$',
				validationMessage: 'Name must start with a letter and be 2-128 characters'
			},
			{
				key: 'contactName', label: 'Contact Name', type: 'text', placeholder: 'e.g. John Smith',
				typingPattern: '^[A-Za-z .\\-\']*$',
				validationPattern: '^$|^[A-Za-z][A-Za-z .\\-\']{1,79}$',
				validationMessage: 'Contact name must contain letters only (no numbers)'
			},
			{
				key: 'phone', label: 'Phone', type: 'text', placeholder: 'e.g. 5551234567',
				typingPattern: '^[0-9]*$', maxDigits: 10,
				validationPattern: '^$|^[0-9]{10}$',
				validationMessage: 'Phone must be exactly 10 digits'
			},
			{
				key: 'email', label: 'Email', type: 'text', placeholder: 'e.g. contact@supplier.com',
				validationPattern: '^$|^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
				validationMessage: 'Please enter a valid email address'
			},
			// Address is part of the ciyex-ehr-ui Add Supplier form (and the backend
			// InvSupplierDto supports it) — Name | Contact | Phone | Email | Address |
			// Notes | Status.
			...buildAddressFieldConfigs('supplier'),
			{
				key: 'isActive', label: 'Status', type: 'select', options: [
					{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' },
				], defaultValue: 'true'
			},
			{ key: 'notes', label: 'Notes', type: 'textarea' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this supplier?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/suppliers/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	private readonly _recordsConfig: ClinicalEditorConfig = {
		title: 'Inventory Records', apiPath: '/api/inventory/list',
		// Mirrors ciyex-ehr-ui Records.tsx — Date | Qty | Reason | Notes | By | Ref.
		// Per-item search + Adjustments / Waste Log status tabs.
		searchPlaceholder: 'Search by item, reason, notes...',
		clientSideFilter: ['itemName', 'adjustmentType', 'reasonCode', 'reason', 'notes', 'id'],
		editable: false,
		filterKey: 'recordType',
		columns: [
			{ key: 'createdAt', label: 'Date', width: '130px' },
			{ key: 'quantity', label: 'Qty', width: '70px' },
			{ key: 'reasonCode', label: 'Reason', width: '120px' },
			{ key: 'notes', label: 'Notes' },
			{ key: 'performedBy', label: 'By', width: '120px' },
			{ key: 'referenceId', label: 'Ref', width: '110px' },
		],
		statusTabs: [
			{ label: 'Adjustments', value: 'adjustment' },
			{ label: 'Waste Log', value: 'waste' },
		],
		additionalFilters: [
			{
				key: 'reasonCode', placeholder: 'All Reasons',
				options: [
					{ label: 'Received', value: 'received' },
					{ label: 'Consumed', value: 'consumed' },
					{ label: 'Damaged', value: 'damaged' },
					{ label: 'Expired', value: 'expired' },
					{ label: 'Returned', value: 'returned' },
					{ label: 'Correction', value: 'correction' },
				],
			},
		],
		cellRenderer: (key, value) => {
			if (key === 'createdAt' && typeof value === 'string') {
				try { return new Date(value).toLocaleString(); } catch { return String(value); }
			}
			if (key === 'reasonCode' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		actions: [],
	};

	// Maintenance sub-tab (issue #27) — mirrors ciyex-ehr-ui
	// inventory-management/Maintenance/Maintenance.tsx. The list shows
	// equipment maintenance tasks with priority + status workflow.
	private readonly _maintenanceConfig: ClinicalEditorConfig = {
		title: 'Maintenance', apiPath: '/api/maintenances',
		searchPlaceholder: 'Search by equipment, assignee, vendor...',
		clientSideFilter: ['equipmentName', 'assignee', 'vendor', 'location', 'status', 'priority', 'id'],
		editable: true,
		refetchOnEdit: true,
		filterKey: 'status',
		// Mirrors ciyex-ehr-ui Maintenance.tsx columns: Equipment | Category |
		// Priority | Due | Assignee | Status (Actions provided automatically).
		columns: [
			{ key: 'equipmentName', label: 'Equipment', width: '1.5fr' },
			{ key: 'category', label: 'Category', width: '120px' },
			{ key: 'priority', label: 'Priority', width: '90px' },
			{ key: 'scheduledDate', label: 'Due', width: '110px' },
			{ key: 'assignee', label: 'Assignee', width: '130px' },
			{ key: 'status', label: 'Status', width: '110px' },
		],
		statusTabs: [
			{ label: 'Scheduled', value: 'scheduled' },
			{ label: 'In Progress', value: 'in_progress' },
			{ label: 'Completed', value: 'completed' },
			{ label: 'Cancelled', value: 'cancelled' },
		],
		additionalFilters: [
			{
				key: 'priority', placeholder: 'All Priorities',
				options: [
					{ label: 'Low', value: 'low' },
					{ label: 'Medium', value: 'medium' },
					{ label: 'High', value: 'high' },
					{ label: 'Critical', value: 'critical' },
				],
			},
		],
		formFields: [
			{ key: 'equipmentName', label: 'Equipment Name', type: 'text', required: true, placeholder: 'Equipment...' },
			// Equipment ID + Category + Last/Next Service Date added to match the
			// ciyex-ehr-ui New Maintenance Task form (issue #17).
			{ key: 'equipmentId', label: 'Equipment ID', type: 'text', placeholder: 'e.g. EQ-001 or XR-2024' },
			{
				key: 'category', label: 'Category', type: 'select', options: [
					{ label: 'Preventive', value: 'preventive' },
					{ label: 'Corrective', value: 'corrective' },
					{ label: 'Calibration', value: 'calibration' },
					{ label: 'Inspection', value: 'inspection' },
				], defaultValue: 'preventive',
			},
			// Issue #10: Location is a search field backed by the DB locations list
			// (same /api/inventory/locations source the Inventory form uses). Selecting
			// a result fills the visible `location` name and the hidden `locationId`.
			{
				key: 'location', label: 'Location', type: 'search',
				placeholder: 'Search location…',
				apiPath: '/api/inventory/locations',
				searchDisplayField: 'name',
				searchValueField: 'name',
				relatedField: 'locationId',
				relatedDisplayFields: ['name'],
			},
			{ key: 'locationId', label: 'Location ID', type: 'number', hidden: true, placeholder: 'Auto-filled' },
			{
				key: 'priority', label: 'Priority', type: 'select', options: [
					{ label: 'Low', value: 'low' },
					{ label: 'Medium', value: 'medium' },
					{ label: 'High', value: 'high' },
					{ label: 'Critical', value: 'critical' },
				], defaultValue: 'medium',
			},
			{ key: 'assignee', label: 'Assignee', type: 'search', placeholder: 'Search staff...', apiPath: '/api/providers', relatedDisplayFields: ['identification.firstName', 'identification.lastName'] },
			{ key: 'vendor', label: 'Vendor', type: 'text', placeholder: 'External vendor' },
			{ key: 'scheduledDate', label: 'Due Date', type: 'date' },
			{ key: 'lastServiceDate', label: 'Last Service Date', type: 'date' },
			{ key: 'nextServiceDate', label: 'Next Service Date', type: 'date' },
			{ key: 'completedDate', label: 'Completed Date', type: 'date' },
			{ key: 'cost', label: 'Cost ($)', type: 'number', placeholder: '0.00' },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Scheduled', value: 'scheduled' },
					{ label: 'In Progress', value: 'in_progress' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Cancelled', value: 'cancelled' },
				], defaultValue: 'scheduled',
			},
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Maintenance notes...', width: 'span 2' },
		],
		cellRenderer: (key, value) => {
			if ((key === 'scheduledDate' || key === 'completedDate') && typeof value === 'string' && value) {
				try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return value; }
			}
			if (key === 'status' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		// Issue #10: Delete action on the Maintenance table (Edit comes from editable:true).
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Delete this maintenance task?', type: 'warning', primaryButton: 'Delete' }); if (r.confirmed) { await api.fetch(`/api/maintenances/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	// @ts-ignore — override abstract readonly with getter
	protected get config(): ClinicalEditorConfig {
		switch (this.invView) {
			case 'orders': return this._ordersConfig;
			case 'suppliers': return this._suppliersConfig;
			case 'records': return this._recordsConfig;
			case 'maintenance': return this._maintenanceConfig;
			// dashboard + settings render custom content (see _resetAndReload);
			// the inventory config is a harmless placeholder for those views.
			default: return this._inventoryConfig;
		}
	}

	// Dashboard + Settings + Records are custom (non-table) views, so intercept
	// the base list render and draw them ourselves; everything else uses the
	// table. (#18)
	protected override _resetAndReload(): void {
		if (this.invView === 'dashboard') { void this._renderDashboard(); return; }
		if (this.invView === 'settings') { void this._renderSettings(); return; }
		if (this.invView === 'records') { void this._renderRecords(); return; }
		super._resetAndReload();
	}

	// Orders use a bespoke "New Purchase Order" modal (supplier + multi-line
	// items + grand total) matching ciyex-ehr-ui; everything else uses the
	// generic add/edit form from the base editor.
	protected override async _openForm(item: Record<string, unknown> | null): Promise<void> {
		if (this.invView === 'orders') { await this._openOrderForm(item); return; }
		await super._openForm(item);
	}

	private _invTabBtns: HTMLButtonElement[] = [];

	protected override wrapContent(parent: HTMLElement): HTMLElement {
		// Flex-column wrapper so the tab row and the editor content share the full
		// height correctly — using createEditor + parent.appendChild caused the
		// root's height:100% to overlap the tab row, clipping the pagination bar.
		const wrapper = DOM.append(parent, DOM.$('div'));
		wrapper.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;';

		const tabRow = DOM.append(wrapper, DOM.$('div'));
		tabRow.style.cssText = 'flex-shrink:0;display:flex;border-bottom:2px solid var(--vscode-editorWidget-border);padding:0 24px;background:var(--vscode-editor-background);overflow-x:auto;';

		this._invTabBtns = [];
		const styleInvBtn = (btn: HTMLButtonElement, active: boolean) => {
			btn.style.borderBottomColor = active ? '#0e639c' : 'transparent';
			btn.style.color = active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)';
			btn.style.fontWeight = active ? '600' : '400';
		};

		const invTabs: Array<{ view: 'dashboard' | 'inventory' | 'orders' | 'records' | 'suppliers' | 'maintenance' | 'settings'; label: string }> = [
			{ view: 'dashboard', label: 'Dashboard' },
			{ view: 'inventory', label: 'Inventory' },
			{ view: 'orders', label: 'Orders' },
			{ view: 'records', label: 'Records' },
			{ view: 'suppliers', label: 'Suppliers' },
			{ view: 'maintenance', label: 'Maintenance' },
			{ view: 'settings', label: 'Settings' },
		];
		invTabs.forEach(({ view, label }) => {
			const btn = DOM.append(tabRow, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = label;
			const isActive = this.invView === view;
			btn.style.cssText = `padding:8px 16px;border:none;background:none;cursor:pointer;font-size:12px;border-bottom:2px solid ${isActive ? '#0e639c' : 'transparent'};margin-bottom:-2px;color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};font-weight:${isActive ? '600' : '400'};white-space:nowrap;`;
			btn.addEventListener('click', () => {
				if (this.invView !== view) {
					this.invView = view;
					this._invTabBtns.forEach(b => { styleInvBtn(b, b === btn); });
					this._resetAndReload();
				}
			});
			this._invTabBtns.push(btn);
		});

		const main = DOM.append(wrapper, DOM.$('div'));
		main.style.cssText = 'flex:1;min-height:0;overflow:hidden;position:relative;';
		return main;
	}

	// --- #18 Dashboard --- mirrors ciyex-ehr-ui inventory Dashboard.tsx: an alert
	// banner, the full KPI card set, a category-breakdown bar and a low-stock table.
	private async _renderDashboard(): Promise<void> {
		const c = this.contentEl;
		DOM.clearNode(c);
		c.style.overflowY = 'auto';

		const head = DOM.append(c, DOM.$('div'));
		head.style.cssText = 'margin-bottom:14px;';
		const h = DOM.append(head, DOM.$('div'));
		h.textContent = 'Inventory Dashboard';
		h.style.cssText = 'font-size:20px;font-weight:700;color:var(--vscode-foreground);';
		const sub = DOM.append(head, DOM.$('div'));
		sub.textContent = 'Track stock, purchase orders, suppliers, and equipment upkeep.';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		// Slot for the low-stock alert banner (filled once data arrives).
		const alertSlot = DOM.append(c, DOM.$('div'));

		const grid = DOM.append(c, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;';
		const card = (title: string, value: string, tone?: string): void => {
			const cd = DOM.append(grid, DOM.$('div'));
			cd.style.cssText = `border:1px solid var(--vscode-editorWidget-border);border-left:3px solid ${tone || 'var(--vscode-editorWidget-border)'};border-radius:8px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));padding:12px 14px;`;
			const t = DOM.append(cd, DOM.$('div'));
			t.textContent = title; t.style.cssText = 'font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:var(--vscode-descriptionForeground);';
			const v = DOM.append(cd, DOM.$('div'));
			v.textContent = value; v.style.cssText = `font-size:24px;font-weight:700;margin-top:6px;color:${tone || 'var(--vscode-foreground)'};`;
		};
		const renderCards = (d: Record<string, unknown>): void => {
			DOM.clearNode(grid);
			const num = (k: string): string => String(Number(d[k] ?? 0));
			const money = (k: string): string => { const n = Number(d[k] ?? 0); return `$${isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 0}`; };
			card('Total Items', num('totalItems'));
			card('Low Stock', num('lowStockCount'), '#f59e0b');
			card('Out of Stock', num('outOfStockCount'), '#ef4444');
			card('Pending Orders', num('pendingOrders'));
			card('Total Value', money('totalValue'));
			card('Expiring (30d)', num('expiringWithin30Days'), '#f59e0b');
			card('Overdue Maint.', num('overdueMaintenanceTasks'), '#ef4444');
			card('Active Suppliers', String(this._dashSuppliers ?? 0));
		};
		renderCards({});

		let dash: Record<string, unknown> = {};
		try {
			const [dashRes, supRes] = await Promise.all([
				this.apiService.fetch('/api/inventory/dashboard'),
				this.apiService.fetch('/api/suppliers/count'),
			]);
			if (dashRes.ok) { const j = await dashRes.json(); dash = (j?.data ?? j ?? {}) as Record<string, unknown>; }
			if (supRes.ok) { const j = await supRes.json(); const v = j?.data ?? j; this._dashSuppliers = typeof v === 'number' ? v : Number((v as Record<string, unknown>)?.count ?? 0); }
		} catch { /* leave zeros */ }
		// Guard against a view switch while awaiting.
		if (this.invView !== 'dashboard') { return; }
		renderCards(dash);

		// Low stock alert banner.
		const lowItems = (dash.lowStockItems as Array<Record<string, unknown>> | undefined) ?? [];
		if (lowItems.length) {
			DOM.clearNode(alertSlot);
			const banner = DOM.append(alertSlot, DOM.$('div'));
			banner.style.cssText = 'border:1px solid rgba(239,68,68,0.4);border-left:3px solid #ef4444;background:rgba(239,68,68,0.08);border-radius:8px;padding:10px 14px;margin-bottom:14px;';
			const bt = DOM.append(banner, DOM.$('div'));
			bt.textContent = `⚠ Low Stock Alerts`;
			bt.style.cssText = 'font-size:12px;font-weight:700;color:#ef4444;';
			const bs = DOM.append(banner, DOM.$('div'));
			bs.textContent = `${lowItems.length} item${lowItems.length === 1 ? '' : 's'} below minimum.`;
			bs.style.cssText = 'font-size:11.5px;color:var(--vscode-foreground);margin-top:2px;';
		}

		// Two-column section: Category Breakdown + Low Stock Items.
		const cols = DOM.append(c, DOM.$('div'));
		cols.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;';

		// Category Breakdown bars.
		const catCard = DOM.append(cols, DOM.$('div'));
		catCard.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));padding:14px 16px;';
		const catTitle = DOM.append(catCard, DOM.$('div'));
		catTitle.textContent = 'Category Breakdown';
		catTitle.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:12px;';
		const breakdown = (dash.categoryBreakdown as Array<Record<string, unknown>> | undefined) ?? [];
		if (!breakdown.length) {
			const none = DOM.append(catCard, DOM.$('div'));
			none.textContent = 'No category data.';
			none.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		} else {
			const max = Math.max(1, ...breakdown.map(b => Number(b.count ?? b.value ?? 0)));
			for (const b of breakdown) {
				const name = String(b.category ?? b.name ?? b.categoryName ?? '—');
				const count = Number(b.count ?? b.value ?? 0);
				const rowEl = DOM.append(catCard, DOM.$('div'));
				rowEl.style.cssText = 'margin-bottom:10px;';
				const lblRow = DOM.append(rowEl, DOM.$('div'));
				lblRow.style.cssText = 'display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px;color:var(--vscode-foreground);';
				const ln = DOM.append(lblRow, DOM.$('span')); ln.textContent = name;
				const lc = DOM.append(lblRow, DOM.$('span')); lc.textContent = String(count); lc.style.color = 'var(--vscode-descriptionForeground)';
				const track = DOM.append(rowEl, DOM.$('div'));
				track.style.cssText = 'height:6px;border-radius:3px;background:var(--vscode-input-background,#3c3c3c);overflow:hidden;';
				const bar = DOM.append(track, DOM.$('div'));
				bar.style.cssText = `height:100%;width:${Math.round((count / max) * 100)}%;background:#6366f1;border-radius:3px;`;
			}
		}

		// Low Stock Items table.
		const lowCard = DOM.append(cols, DOM.$('div'));
		lowCard.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));padding:14px 16px;';
		const lowTitle = DOM.append(lowCard, DOM.$('div'));
		lowTitle.textContent = 'Low Stock Items';
		lowTitle.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:12px;';
		if (!lowItems.length) {
			const none = DOM.append(lowCard, DOM.$('div'));
			none.textContent = 'All items above minimum.';
			none.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		} else {
			const hdr = DOM.append(lowCard, DOM.$('div'));
			hdr.style.cssText = 'display:grid;grid-template-columns:1.6fr 1fr 60px 60px;gap:8px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding-bottom:6px;border-bottom:1px solid var(--vscode-editorWidget-border);';
			for (const col of ['Name', 'SKU', 'Stock', 'Min']) { const s = DOM.append(hdr, DOM.$('span')); s.textContent = col; }
			for (const it of lowItems.slice(0, 8)) {
				const r = DOM.append(lowCard, DOM.$('div'));
				r.style.cssText = 'display:grid;grid-template-columns:1.6fr 1fr 60px 60px;gap:8px;font-size:12px;padding:7px 0;border-bottom:1px solid rgba(128,128,128,0.12);';
				const nm = DOM.append(r, DOM.$('span')); nm.textContent = String(it.name ?? ''); nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				const sk = DOM.append(r, DOM.$('span')); sk.textContent = String(it.sku ?? ''); sk.style.color = 'var(--vscode-descriptionForeground)';
				const st = DOM.append(r, DOM.$('span')); st.textContent = String(it.stockOnHand ?? 0); st.style.color = '#ef4444';
				const mn = DOM.append(r, DOM.$('span')); mn.textContent = String(it.minStock ?? 0);
			}
		}
	}

	private _dashSuppliers = 0;

	// --- #18 Settings ---
	private _settingsTab: 'general' | 'categories' | 'locations' = 'general';

	private async _renderSettings(): Promise<void> {
		const c = this.contentEl;
		DOM.clearNode(c);
		c.style.overflowY = 'auto';

		const sub = DOM.append(c, DOM.$('div'));
		sub.textContent = 'Configure inventory thresholds, categories, and storage locations.';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:14px;';

		const tabRow = DOM.append(c, DOM.$('div'));
		tabRow.style.cssText = 'display:flex;gap:4px;margin-bottom:18px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:4px;max-width:520px;';
		const tabs: Array<{ key: 'general' | 'categories' | 'locations'; label: string }> = [
			{ key: 'general', label: 'General' }, { key: 'categories', label: 'Categories' }, { key: 'locations', label: 'Locations' },
		];
		for (const t of tabs) {
			const b = DOM.append(tabRow, DOM.$('button')) as HTMLButtonElement;
			b.textContent = t.label;
			const active = this._settingsTab === t.key;
			b.style.cssText = `flex:1;padding:8px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:${active ? '600' : '400'};background:${active ? 'var(--vscode-button-background,#0e639c)' : 'transparent'};color:${active ? 'var(--vscode-button-foreground,#fff)' : 'var(--vscode-foreground)'};`;
			b.addEventListener('click', () => { if (this._settingsTab !== t.key) { this._settingsTab = t.key; void this._renderSettings(); } });
		}

		const body = DOM.append(c, DOM.$('div'));
		if (this._settingsTab === 'general') { await this._renderSettingsGeneral(body); }
		else if (this._settingsTab === 'categories') { await this._renderSettingsList(body, 'Category', '/api/inventory/categories', 'e.g. Consumable'); }
		else {
			// Locations carry a type (Room / Cabinet / Shelf / …), matching the
			// ciyex-ehr-ui Locations tab which posts { name, type }.
			await this._renderSettingsList(body, 'Location', '/api/inventory/locations', 'e.g. Main Storage', [
				{ label: 'Room', value: 'room' }, { label: 'Cabinet', value: 'cabinet' },
				{ label: 'Shelf', value: 'shelf' }, { label: 'Bin', value: 'bin' },
				{ label: 'Refrigerator', value: 'refrigerator' },
			]);
		}
	}

	private _settingsCard(parent: HTMLElement, title: string): HTMLElement {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:10px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));padding:16px 18px;margin-bottom:16px;';
		const t = DOM.append(card, DOM.$('div'));
		t.textContent = title;
		t.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);margin-bottom:10px;';
		return card;
	}

	private _settingsToggle(parent: HTMLElement, label: string, subText: string, get: () => boolean, set: (v: boolean) => void): void {
		const row = DOM.append(parent, DOM.$('div'));
		row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;';
		const txt = DOM.append(row, DOM.$('div'));
		const l = DOM.append(txt, DOM.$('div')); l.textContent = label; l.style.cssText = 'font-size:13px;color:var(--vscode-foreground);';
		const s = DOM.append(txt, DOM.$('div')); s.textContent = subText; s.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		const sw = DOM.append(row, DOM.$('div'));
		const paint = (): void => {
			const on = get();
			sw.style.cssText = `width:40px;height:22px;border-radius:11px;cursor:pointer;flex-shrink:0;position:relative;transition:background 0.15s;background:${on ? 'var(--vscode-button-background,#0e639c)' : 'var(--vscode-input-background,#3c3c3c)'};border:1px solid var(--vscode-editorWidget-border);`;
			DOM.clearNode(sw);
			const knob = DOM.append(sw, DOM.$('div'));
			knob.style.cssText = `position:absolute;top:1px;left:${on ? '19px' : '1px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.15s;`;
		};
		paint();
		sw.addEventListener('click', () => { set(!get()); paint(); });
	}

	private async _renderSettingsGeneral(body: HTMLElement): Promise<void> {
		let loaded: Record<string, unknown> = {};
		try {
			const res = await this.apiService.fetch('/api/inventory-settings');
			if (res.ok) { const j = await res.json(); loaded = (j?.data ?? j ?? {}) as Record<string, unknown>; }
		} catch { /* fall back to defaults */ }
		if (this.invView !== 'settings' || this._settingsTab !== 'general') { return; }

		const state = {
			lowStockAlerts: loaded.lowStockAlerts !== false,
			autoReorder: loaded.autoReorder === true,
			criticalLowPct: Number(loaded.criticalLowPct ?? loaded.criticalLowPercentage ?? 10),
			defaultCostMethod: String(loaded.defaultCostMethod ?? 'fifo'),
			poApprovalRequired: loaded.poApprovalRequired === true,
			poApprovalThreshold: Number(loaded.poApprovalThreshold ?? 0),
		};
		const save = async (): Promise<void> => {
			try {
				await this.apiService.fetch('/api/inventory-settings', {
					method: 'PUT',
					body: JSON.stringify({
						lowStockAlerts: state.lowStockAlerts,
						autoReorder: state.autoReorder,
						criticalLowPct: state.criticalLowPct,
						defaultCostMethod: state.defaultCostMethod,
						poApprovalRequired: state.poApprovalRequired,
						poApprovalThreshold: state.poApprovalThreshold,
					}),
				});
			} catch { /* ignore */ }
		};

		const grid = DOM.append(body, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;';
		const left = DOM.append(grid, DOM.$('div'));
		const right = DOM.append(grid, DOM.$('div'));

		// Alerts & Automation
		const alerts = this._settingsCard(left, 'Alerts & Automation');
		this._settingsToggle(alerts, 'Low Stock Alerts', 'Notify when stock dips below minimum', () => state.lowStockAlerts, v => { state.lowStockAlerts = v; void save(); });
		this._settingsToggle(alerts, 'Auto Reorder', 'Automatically generate POs for low stock', () => state.autoReorder, v => { state.autoReorder = v; void save(); });

		// Purchase Order Approval
		const poCard = this._settingsCard(left, 'Purchase Order Approval');
		this._settingsToggle(poCard, 'Require PO Approval', 'Orders above threshold need manager sign-off', () => state.poApprovalRequired, v => { state.poApprovalRequired = v; void save(); });

		// Thresholds & Cost
		const thresholds = this._settingsCard(right, 'Thresholds & Cost');
		const lbl1 = DOM.append(thresholds, DOM.$('div'));
		lbl1.textContent = 'Critical Low (%)';
		lbl1.style.cssText = 'font-size:12px;color:var(--vscode-foreground);margin-bottom:4px;';
		const pct = DOM.append(thresholds, DOM.$('input')) as HTMLInputElement;
		pct.type = 'number'; pct.value = String(state.criticalLowPct);
		pct.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		pct.addEventListener('change', () => { const n = Number(pct.value); if (isFinite(n)) { state.criticalLowPct = n; void save(); } });
		const help = DOM.append(thresholds, DOM.$('div'));
		help.textContent = 'Items below this % of minimum stock are marked Critical.';
		help.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin:4px 0 14px;';

		const lbl2 = DOM.append(thresholds, DOM.$('div'));
		lbl2.textContent = 'Default Cost Method';
		lbl2.style.cssText = 'font-size:12px;color:var(--vscode-foreground);margin-bottom:4px;';
		createCustomDropdown({
			parent: thresholds,
			options: [{ label: 'FIFO', value: 'fifo' }, { label: 'LIFO', value: 'lifo' }, { label: 'Average', value: 'avg' }],
			initialValue: state.defaultCostMethod,
			placeholder: 'Select method...',
			triggerStyle: 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;',
			onChange: (v) => { state.defaultCostMethod = v; void save(); },
		});
	}

	private async _renderSettingsList(body: HTMLElement, singular: string, apiPath: string, placeholder: string, types?: Array<{ label: string; value: string }>): Promise<void> {
		const card = this._settingsCard(body, `${singular === 'Category' ? 'Categories' : 'Locations'}`);
		const addRow = DOM.append(card, DOM.$('div'));
		addRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
		const input = DOM.append(addRow, DOM.$('input')) as HTMLInputElement;
		input.placeholder = placeholder;
		input.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		// Locations also pick a storage type next to the name input.
		let typeHidden: HTMLInputElement | undefined;
		if (types && types.length) {
			const typeWrap = DOM.append(addRow, DOM.$('div'));
			typeWrap.style.cssText = 'width:150px;flex-shrink:0;';
			typeHidden = createCustomDropdown({
				parent: typeWrap,
				options: types,
				initialValue: types[0].value,
				triggerStyle: 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;',
			});
		}
		const addBtn = DOM.append(addRow, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = `Add ${singular}`;
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;';

		const listEl = DOM.append(card, DOM.$('div'));
		listEl.textContent = 'Loading…';
		listEl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

		// All loaded records; the name input doubles as a live search/filter.
		let allItems: Array<Record<string, unknown>> = [];
		const renderList = (): void => {
			DOM.clearNode(listEl);
			listEl.style.color = 'var(--vscode-foreground)';
			const q = input.value.trim().toLowerCase();
			const filtered = q
				? allItems.filter(it => String(it.name ?? it.id ?? '').toLowerCase().includes(q))
				: allItems;
			if (allItems.length === 0) { listEl.textContent = `No ${singular.toLowerCase()} records yet.`; return; }
			if (filtered.length === 0) { listEl.textContent = `No ${singular.toLowerCase()} matches "${input.value.trim()}".`; return; }
			for (const item of filtered) {
				const row = DOM.append(listEl, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(128,128,128,0.12);font-size:13px;';
				const name = DOM.append(row, DOM.$('span'));
				name.textContent = String(item.name ?? item.id ?? '');
				name.style.color = 'var(--vscode-foreground)';
				if (item.type) {
					const tag = DOM.append(row, DOM.$('span'));
					tag.textContent = String(item.type);
					tag.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
				}
			}
		};

		const loadItems = async (): Promise<void> => {
			try {
				const res = await this.apiService.fetch(`${apiPath}?page=0&size=200`);
				const json = res.ok ? await res.json() : null;
				const wrapper = json?.data ?? json;
				allItems = (wrapper?.content || (Array.isArray(wrapper) ? wrapper : [])) as Array<Record<string, unknown>>;
				renderList();
			} catch {
				DOM.clearNode(listEl);
				listEl.textContent = `Could not load ${singular.toLowerCase()} list.`;
			}
		};

		// Live filter the existing list as the user types.
		input.addEventListener('input', () => renderList());

		const doAdd = async (): Promise<void> => {
			const name = input.value.trim();
			if (!name) { return; }
			addBtn.disabled = true;
			try {
				const payload: Record<string, unknown> = { name };
				if (typeHidden) { payload.type = typeHidden.value; }
				const res = await this.apiService.fetch(apiPath, { method: 'POST', body: JSON.stringify(payload) });
				if (!res.ok) {
					let msg = `Could not add ${singular.toLowerCase()} (HTTP ${res.status}).`;
					try { const e = await res.json(); if (e?.message) { msg = String(e.message); } } catch { /* ignore */ }
					await this.dialogService.error(msg);
					addBtn.disabled = false;
					return;
				}
				input.value = '';
				await loadItems();
			} catch {
				await this.dialogService.error(`Could not add ${singular.toLowerCase()}. Please try again.`);
			} finally {
				addBtn.disabled = false;
			}
		};
		addBtn.addEventListener('click', () => { void doAdd(); });
		input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void doAdd(); } });

		await loadItems();
	}

	// --- Orders: New Purchase Order modal (supplier + line items + grand total),
	// mirroring ciyex-ehr-ui CreateOrderForm and posting InvOrderDto to /api/orders.
	private async _openOrderForm(existing: Record<string, unknown> | null): Promise<void> {
		const isEdit = !!existing;
		// On edit, refetch the full order so its line items are present (the list
		// row may only carry header fields).
		if (existing && existing.id !== undefined && existing.id !== null) {
			try {
				const res = await this.apiService.fetch(`/api/orders/${existing.id}`);
				if (res.ok) { const j = await res.json(); const full = (j?.data ?? j) as Record<string, unknown> | null; if (full && typeof full === 'object') { existing = { ...existing, ...full }; } }
			} catch { /* keep row data */ }
		}
		// Load suppliers + items for the dropdowns.
		const fetchList = async (path: string): Promise<Array<Record<string, unknown>>> => {
			try {
				const res = await this.apiService.fetch(path);
				if (!res.ok) { return []; }
				const j = await res.json();
				const w = j?.data ?? j;
				return (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
			} catch { return []; }
		};
		const [suppliers, items] = await Promise.all([
			fetchList('/api/suppliers/list'),
			fetchList('/api/inventory/list'),
		]);

		// Mount the modal on the workbench root (not this.root) as a fixed,
		// full-window overlay so the whole app behind it — the sidebar and tab
		// strip included — is dimmed and blurred. The previous absolute overlay
		// was scoped to the editor pane, so it left the sidebar sharp and the
		// backdrop carried no blur at all.
		const doc = (this.root && this.root.ownerDocument) || DOM.getActiveWindow().document;
		const mount = findWorkbenchRoot(this.root, doc);
		// eslint-disable-next-line no-restricted-syntax
		const titlebarEl = doc.querySelector('.part.titlebar');
		const titlebarHeight = titlebarEl ? Math.round((titlebarEl as HTMLElement).getBoundingClientRect().height) : 35;
		const overlay = DOM.append(mount, DOM.$('div'));
		overlay.style.cssText = `position:fixed;top:${titlebarHeight}px;left:0;right:0;bottom:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(2px);`;
		// Click outside the panel closes the dialog.
		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		const panel = DOM.append(overlay, DOM.$('div'));
		panel.style.cssText = 'position:relative;width:620px;max-width:94vw;max-height:88%;display:flex;flex-direction:column;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-editorWidget-border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,0.4);';

		const hdr = DOM.append(panel, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const title = DOM.append(hdr, DOM.$('div')); title.textContent = isEdit ? 'Edit Purchase Order' : 'New Purchase Order';
		title.style.cssText = 'font-size:15px;font-weight:600;';
		const xBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		xBtn.textContent = '✕'; xBtn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;color:var(--vscode-foreground);';
		xBtn.addEventListener('click', () => overlay.remove());

		const body = DOM.append(panel, DOM.$('div'));
		body.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:18px 20px;scrollbar-width:none;';

		const inputStyle = 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';
		const fieldLabel = (parent: HTMLElement, text: string): void => {
			const l = DOM.append(parent, DOM.$('label')); l.textContent = text;
			l.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		};

		// Header row: Supplier + Status.
		const hr1 = DOM.append(body, DOM.$('div')); hr1.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px;';
		const supWrap = DOM.append(hr1, DOM.$('div')); fieldLabel(supWrap, 'Supplier *');
		const supplierHidden = createCustomDropdown({
			parent: supWrap,
			options: [{ value: '', label: 'Select supplier…' }, ...suppliers.map(s => ({ value: String(s.id), label: String(s.name ?? s.id) }))],
			initialValue: existing ? String(existing.supplierId ?? '') : '',
			triggerStyle: inputStyle + 'cursor:pointer;',
		});
		const statWrap = DOM.append(hr1, DOM.$('div')); fieldLabel(statWrap, 'Status');
		const statusHidden = createCustomDropdown({
			parent: statWrap,
			options: [
				{ value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' },
				{ value: 'partial', label: 'Partial' }, { value: 'received', label: 'Received' },
				{ value: 'cancelled', label: 'Cancelled' },
			],
			initialValue: existing ? String(existing.status ?? 'draft').toLowerCase() : 'draft',
			triggerStyle: inputStyle + 'cursor:pointer;',
		});

		// Header row: Order Date + Expected Date.
		const hr2 = DOM.append(body, DOM.$('div')); hr2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px;';
		// Issue #9: `color-scheme:dark light` makes the native date picker glyph +
		// text render with proper contrast on the dark workbench theme (otherwise the
		// value/calendar icon were nearly invisible). MM/DD/YYYY display is the
		// browser default for type=date when the OS locale is US.
		const dateInputStyle = inputStyle + 'color-scheme:dark light;';
		const odWrap = DOM.append(hr2, DOM.$('div')); fieldLabel(odWrap, 'Order Date');
		const orderDate = DOM.append(odWrap, DOM.$('input')) as HTMLInputElement;
		orderDate.type = 'date'; orderDate.style.cssText = dateInputStyle + 'cursor:pointer;';
		orderDate.value = String(existing?.orderDate ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
		enablePickerClick(orderDate);
		const edWrap = DOM.append(hr2, DOM.$('div')); fieldLabel(edWrap, 'Expected Date');
		const expectedDate = DOM.append(edWrap, DOM.$('input')) as HTMLInputElement;
		expectedDate.type = 'date'; expectedDate.style.cssText = dateInputStyle + 'cursor:pointer;';
		expectedDate.value = String(existing?.expectedDate ?? '').slice(0, 10);
		enablePickerClick(expectedDate);

		// Notes.
		const ntWrap = DOM.append(body, DOM.$('div')); ntWrap.style.cssText = 'margin-bottom:14px;'; fieldLabel(ntWrap, 'Notes');
		const notes = DOM.append(ntWrap, DOM.$('textarea')) as HTMLTextAreaElement;
		notes.style.cssText = inputStyle + 'min-height:48px;resize:vertical;'; notes.value = String(existing?.notes ?? '');

		// Line items.
		const liHdr = DOM.append(body, DOM.$('div'));
		liHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
		const liTitle = DOM.append(liHdr, DOM.$('div')); liTitle.textContent = 'Line Items'; liTitle.style.cssText = 'font-size:12px;font-weight:600;';
		const addLineBtn = DOM.append(liHdr, DOM.$('button')) as HTMLButtonElement;
		addLineBtn.textContent = '+ Add Line';
		addLineBtn.style.cssText = 'background:none;border:none;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;font-size:12px;font-weight:600;';

		// Issue #9: column headers for the line-item grid (Item | Qty | Unit $ |
		// Total | Lot # | Expiry) — same labels/order as ciyex-ehr-ui Orders.tsx.
		// Grid template MUST match the per-row template below so headers align.
		const lineColsTemplate = 'minmax(0,2fr) 52px 64px 70px 70px 90px 22px';
		const liColHdr = DOM.append(body, DOM.$('div'));
		liColHdr.style.cssText = `display:grid;grid-template-columns:${lineColsTemplate};gap:6px;align-items:center;margin-bottom:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;color:var(--vscode-descriptionForeground);`;
		for (const h of ['Item', 'Qty', 'Unit $', 'Total', 'Lot #', 'Expiry', '']) {
			const s = DOM.append(liColHdr, DOM.$('span')); s.textContent = h;
			s.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		}
		const linesWrap = DOM.append(body, DOM.$('div'));

		const grand = DOM.append(body, DOM.$('div'));
		grand.style.cssText = 'text-align:right;font-size:13px;font-weight:700;margin-top:10px;';

		interface LineRow { itemHidden: HTMLInputElement; qty: HTMLInputElement; unit: HTMLInputElement; total: HTMLInputElement; lot: HTMLInputElement; expiry: HTMLInputElement; row: HTMLElement }
		const lineRows: LineRow[] = [];
		const recomputeGrand = (): void => {
			let g = 0;
			for (const lr of lineRows) { g += (Number(lr.qty.value) || 0) * (Number(lr.unit.value) || 0); }
			grand.textContent = `Grand Total: $${g.toFixed(2)}`;
		};
		const addLine = (seed?: Record<string, unknown>): void => {
			const row = DOM.append(linesWrap, DOM.$('div'));
			row.style.cssText = `display:grid;grid-template-columns:${lineColsTemplate};gap:6px;align-items:center;margin-bottom:6px;`;
			const itemWrap = DOM.append(row, DOM.$('div'));
			const itemHidden = createCustomDropdown({
				parent: itemWrap,
				options: [{ value: '', label: 'Select item…' }, ...items.map(it => ({ value: String(it.id), label: String(it.name ?? it.id) }))],
				initialValue: seed ? String(seed.itemId ?? '') : '',
				triggerStyle: inputStyle + 'cursor:pointer;font-size:12px;padding:4px 8px;',
			});
			const mkCell = (ph: string, val: string, type = 'text'): HTMLInputElement => {
				const i = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				i.type = type; i.placeholder = ph; i.value = val;
				// Issue #9: date cells get color-scheme so the picker glyph/value is visible.
				i.style.cssText = inputStyle + 'font-size:12px;padding:4px 6px;' + (type === 'date' ? 'color-scheme:dark light;' : '');
				return i;
			};
			const qty = mkCell('Qty', String(seed?.quantityOrdered ?? '1'), 'number');
			const unit = mkCell('Unit $', String(seed?.unitCost ?? '0'), 'number');
			const total = mkCell('Total', '0.00'); total.readOnly = true;
			const lot = mkCell('Lot #', String(seed?.lotNumber ?? ''));
			const expiry = mkCell('', String(seed?.expiryDate ?? '').slice(0, 10), 'date');
			const del = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			// allow-any-unicode-next-line
			del.textContent = '✕'; del.style.cssText = 'background:none;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:12px;';
			const lr: LineRow = { itemHidden, qty, unit, total, lot, expiry, row };
			const recalc = (): void => { total.value = ((Number(qty.value) || 0) * (Number(unit.value) || 0)).toFixed(2); recomputeGrand(); };
			qty.addEventListener('input', recalc); unit.addEventListener('input', recalc);
			del.addEventListener('click', () => { const i = lineRows.indexOf(lr); if (i >= 0) { lineRows.splice(i, 1); } row.remove(); recomputeGrand(); });
			lineRows.push(lr); recalc();
		};
		addLineBtn.addEventListener('click', () => addLine());
		const existingLines = (existing?.lines as Array<Record<string, unknown>> | undefined) ?? [];
		if (existingLines.length) { for (const l of existingLines) { addLine(l); } } else { addLine(); }

		// Footer.
		const footer = DOM.append(panel, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--vscode-editorWidget-border);';
		const err = DOM.append(footer, DOM.$('div'));
		err.style.cssText = 'flex:1;color:#f48771;font-size:11.5px;align-self:center;display:none;';
		const cancel = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		cancel.textContent = 'Cancel';
		cancel.style.cssText = 'padding:7px 16px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:4px;cursor:pointer;font-size:13px;';
		cancel.addEventListener('click', () => overlay.remove());
		const create = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		create.textContent = isEdit ? 'Update Order' : 'Create Order';
		create.style.cssText = 'padding:7px 16px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
		create.addEventListener('click', async () => {
			err.style.display = 'none';
			if (!supplierHidden.value) { err.textContent = 'Supplier is required.'; err.style.display = ''; return; }
			const lines = lineRows
				.filter(lr => lr.itemHidden.value)
				.map(lr => ({
					itemId: Number(lr.itemHidden.value),
					quantityOrdered: Number(lr.qty.value) || 0,
					unitCost: Number(lr.unit.value) || 0,
					lotNumber: lr.lot.value.trim() || undefined,
					expiryDate: lr.expiry.value || undefined,
				}));
			if (lines.length === 0) { err.textContent = 'Add at least one line item.'; err.style.display = ''; return; }
			const payload: Record<string, unknown> = {
				supplierId: Number(supplierHidden.value),
				status: statusHidden.value,
				orderDate: orderDate.value || undefined,
				expectedDate: expectedDate.value || undefined,
				notes: notes.value.trim() || undefined,
				lines,
			};
			create.disabled = true; create.textContent = 'Saving…';
			try {
				const url = isEdit ? `/api/orders/${existing!.id}` : '/api/orders';
				const res = await this.apiService.fetch(url, {
					method: isEdit ? 'PUT' : 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (res.ok) { overlay.remove(); this.reload(); }
				else {
					const e = await res.json().catch(() => ({})) as Record<string, string>;
					err.textContent = e.message || `Error ${res.status}`; err.style.display = '';
				}
			} catch { err.textContent = 'Failed to save order.'; err.style.display = ''; }
			create.disabled = false; create.textContent = isEdit ? 'Update Order' : 'Create Order';
		});
	}

	// --- Records: master-detail (left item list, right Adjustments / Waste Log
	// tabs) mirroring ciyex-ehr-ui Records.tsx.
	private _recItems: Array<Record<string, unknown>> = [];
	private _recSelectedId: string | null = null;
	private _recTab: 'adjustments' | 'waste' = 'adjustments';

	private async _renderRecords(): Promise<void> {
		const c = this.contentEl;
		DOM.clearNode(c);
		c.style.overflow = 'hidden';

		const sub = DOM.append(c, DOM.$('div'));
		sub.textContent = 'View stock adjustment history and waste logs per item.';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:12px;flex-shrink:0;';

		const split = DOM.append(c, DOM.$('div'));
		split.style.cssText = 'flex:1;min-height:0;display:grid;grid-template-columns:300px 1fr;gap:14px;';

		// Left: search + item list.
		const left = DOM.append(split, DOM.$('div'));
		left.style.cssText = 'display:flex;flex-direction:column;min-height:0;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const search = DOM.append(left, DOM.$('input')) as HTMLInputElement;
		search.placeholder = 'Search items…';
		search.style.cssText = 'margin:10px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';
		const listEl = DOM.append(left, DOM.$('div'));
		listEl.style.cssText = 'flex:1;min-height:0;overflow-y:auto;';

		// Right: detail.
		const right = DOM.append(split, DOM.$('div'));
		right.style.cssText = 'display:flex;flex-direction:column;min-height:0;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const renderList = (): void => {
			DOM.clearNode(listEl);
			const q = search.value.trim().toLowerCase();
			const filtered = this._recItems.filter(it => !q || String(it.name ?? '').toLowerCase().includes(q) || String(it.sku ?? '').toLowerCase().includes(q));
			if (filtered.length === 0) {
				const none = DOM.append(listEl, DOM.$('div'));
				none.textContent = 'No items.'; none.style.cssText = 'padding:14px;font-size:12px;color:var(--vscode-descriptionForeground);';
				return;
			}
			for (const it of filtered) {
				const id = String(it.id);
				const rowEl = DOM.append(listEl, DOM.$('div'));
				const active = id === this._recSelectedId;
				rowEl.style.cssText = `padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(128,128,128,0.1);${active ? 'background:var(--vscode-list-activeSelectionBackground);' : ''}`;
				const nm = DOM.append(rowEl, DOM.$('div')); nm.textContent = String(it.name ?? '—');
				nm.style.cssText = `font-size:13px;font-weight:600;${active ? 'color:var(--vscode-list-activeSelectionForeground);' : ''}`;
				const meta = DOM.append(rowEl, DOM.$('div'));
				meta.textContent = `${String(it.categoryName ?? it.category ?? 'Uncategorized')} · Stock: ${String(it.stockOnHand ?? 0)} ${String(it.unit ?? '')}`;
				meta.style.cssText = `font-size:11px;color:var(--vscode-descriptionForeground);${active ? 'color:var(--vscode-list-activeSelectionForeground);opacity:0.85;' : ''}`;
				rowEl.addEventListener('click', () => { this._recSelectedId = id; renderList(); void renderDetail(); });
			}
		};

		const renderDetail = async (): Promise<void> => {
			DOM.clearNode(right);
			const sel = this._recItems.find(it => String(it.id) === this._recSelectedId);
			if (!sel) {
				const none = DOM.append(right, DOM.$('div'));
				none.textContent = 'Select an item to view its history.';
				none.style.cssText = 'margin:auto;font-size:12px;color:var(--vscode-descriptionForeground);';
				return;
			}
			const dh = DOM.append(right, DOM.$('div'));
			dh.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
			const dn = DOM.append(dh, DOM.$('div')); dn.textContent = String(sel.name ?? ''); dn.style.cssText = 'font-size:14px;font-weight:600;';
			const dm = DOM.append(dh, DOM.$('div'));
			dm.textContent = `${String(sel.categoryName ?? sel.category ?? 'Uncategorized')} · Stock: ${String(sel.stockOnHand ?? 0)} ${String(sel.unit ?? '')}`;
			dm.style.cssText = 'font-size:11.5px;color:var(--vscode-descriptionForeground);margin-top:2px;';

			const tabs = DOM.append(right, DOM.$('div'));
			tabs.style.cssText = 'display:flex;gap:16px;padding:0 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
			const mkTab = (key: 'adjustments' | 'waste', label: string): void => {
				const t = DOM.append(tabs, DOM.$('button')) as HTMLButtonElement;
				t.textContent = label;
				const on = this._recTab === key;
				t.style.cssText = `padding:9px 2px;border:none;background:none;cursor:pointer;font-size:12px;border-bottom:2px solid ${on ? '#0e639c' : 'transparent'};color:${on ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};font-weight:${on ? '600' : '400'};`;
				t.addEventListener('click', () => { if (this._recTab !== key) { this._recTab = key; void renderDetail(); } });
			};
			mkTab('adjustments', 'Adjustments');
			mkTab('waste', 'Waste Log');

			const tableWrap = DOM.append(right, DOM.$('div'));
			tableWrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:12px 16px;';
			tableWrap.textContent = 'Loading…';
			const isAdj = this._recTab === 'adjustments';
			let rows: Array<Record<string, unknown>> = [];
			try {
				const res = await this.apiService.fetch(`/api/inventory/${sel.id}/${isAdj ? 'adjustments' : 'waste'}`);
				if (res.ok) { const j = await res.json(); const w = j?.data ?? j; rows = (Array.isArray(w) ? w : (w?.content || [])) as Array<Record<string, unknown>>; }
			} catch { /* show empty */ }
			if (this._recSelectedId !== String(sel.id) || this.invView !== 'records') { return; }
			DOM.clearNode(tableWrap);
			if (rows.length === 0) {
				const none = DOM.append(tableWrap, DOM.$('div'));
				none.textContent = isAdj ? 'No adjustments recorded.' : 'No waste logged.';
				none.style.cssText = 'text-align:center;padding:24px;font-size:12px;color:var(--vscode-descriptionForeground);';
				return;
			}
			const cols = isAdj ? ['Date', 'Qty', 'Reason', 'Notes', 'By'] : ['Date', 'Qty', 'Reason', 'Notes', 'By'];
			const hdr = DOM.append(tableWrap, DOM.$('div'));
			hdr.style.cssText = 'display:grid;grid-template-columns:150px 60px 110px 1fr 110px;gap:8px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding-bottom:6px;border-bottom:1px solid var(--vscode-editorWidget-border);';
			for (const col of cols) { const s = DOM.append(hdr, DOM.$('span')); s.textContent = col; }
			for (const r of rows) {
				const rowEl = DOM.append(tableWrap, DOM.$('div'));
				rowEl.style.cssText = 'display:grid;grid-template-columns:150px 60px 110px 1fr 110px;gap:8px;font-size:12px;padding:7px 0;border-bottom:1px solid rgba(128,128,128,0.1);';
				const date = DOM.append(rowEl, DOM.$('span'));
				try { date.textContent = new Date(String(r.createdAt ?? '')).toLocaleString(); } catch { date.textContent = String(r.createdAt ?? ''); }
				const qtyVal = isAdj ? Number(r.quantityChange ?? 0) : Number(r.quantity ?? 0);
				const qty = DOM.append(rowEl, DOM.$('span'));
				qty.textContent = isAdj ? (qtyVal > 0 ? `+${qtyVal}` : String(qtyVal)) : `-${Math.abs(qtyVal)}`;
				qty.style.color = (isAdj && qtyVal >= 0) ? '#22c55e' : '#ef4444';
				const reason = DOM.append(rowEl, DOM.$('span')); reason.textContent = String(r.reasonCode ?? '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
				const notesS = DOM.append(rowEl, DOM.$('span')); notesS.textContent = String(r.notes ?? ''); notesS.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);';
				const by = DOM.append(rowEl, DOM.$('span')); by.textContent = String(r.adjustedBy ?? r.loggedBy ?? '');
			}
		};

		search.addEventListener('input', renderList);

		// Load items, then render.
		listEl.textContent = 'Loading…';
		try {
			const res = await this.apiService.fetch('/api/inventory/list');
			if (res.ok) { const j = await res.json(); const w = j?.data ?? j; this._recItems = (Array.isArray(w) ? w : (w?.content || [])) as Array<Record<string, unknown>>; }
		} catch { this._recItems = []; }
		if (this.invView !== 'records') { return; }
		if (!this._recSelectedId && this._recItems.length) { this._recSelectedId = String(this._recItems[0].id); }
		renderList();
		await renderDetail();
	}

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(InventoryEditor.ID, group, t, th, s, a, d); }
}

/**
 * A row in the custom Insurance Posting grid: either a billed claim awaiting an
 * EOB, or an existing EOB posting. `lines` carries the per-CPT figures the
 * biller edits inline when the row is expanded.
 */
interface InsurancePostingRow {
	/** Existing transaction id (posted rows); empty for an awaiting claim. */
	txnId: string;
	claimRef: string;
	feeSheetId: string;
	patientId: string;
	patientName: string;
	serviceDate: string;
	payerName: string;
	checkNumber: string;
	paymentMethodType: string;
	/** Per-CPT service lines with billed / allowed / paid. */
	lines: EobLine[];
	copay: number;
	deductible: number;
	coinsurance: number;
	denialReason: string;
	forwardedToSecondary: boolean;
	secondaryPayer: string;
	// allow-any-unicode-next-line
	// ── Secondary-payer EOB state ──────────────────────────────────────────
	// A primary EOB that leaves a coinsurance balance does NOT close the claim:
	// the amount is carried to the patient's SECONDARY insurance (it is an
	// insurance balance, not patient responsibility) and a pending secondary
	// EOB entry is auto-generated on the row. Only after the secondary EOB is
	// posted does the claim close — and only its unpaid remainder becomes
	// patient responsibility.
	secPayer: string;
	secCheck: string;
	secDate: string;
	secPosted: boolean;
	/** Per-code secondary figures — carried = the coinsurance from the primary EOB. */
	secLines: SecondaryEobLine[];
	/** AWAITING_SECONDARY = "Insurance Pending": coinsurance carried to the secondary payer. */
	status: 'AWAITING_EOB' | 'POSTED' | 'DENIAL' | 'AWAITING_SECONDARY';
}

/**
 * One CPT line of the secondary-payer EOB entry. The secondary EOB is a FULL
 * per-code posting like the primary — Billed (defaults to the carried
 * coinsurance), Allowed, Ins Paid, Copay, Deductible, Coinsurance and
 * Write-off/Adjustment (e.g. OA-23 prior-payer adjustment).
 */
interface SecondaryEobLine {
	code: string;
	/** Coinsurance carried over from the primary EOB for this code. */
	carried: number;
	/** Billed to the secondary payer — prefilled with the carried coinsurance. */
	billed: number;
	allowed: number;
	/** What the secondary payer paid on this code. */
	paid: number;
	copay: number;
	deductible: number;
	coinsurance: number;
	/** Secondary adjustment / write-off (auto-fills billed - allowed). */
	writeOff: number;
}

/**
 * What the patient owes on a secondary line: the explicitly entered
 * responsibility split when present, else billed - paid - write-off (which
 * equals allowed - paid once the write-off auto-fills).
 */
function secondaryLineOwes(l: SecondaryEobLine): number {
	const explicit = Math.round((l.copay + l.deductible + l.coinsurance) * 100) / 100;
	if (explicit > 0) { return explicit; }
	return Math.max(Math.round((l.billed - l.paid - l.writeOff) * 100) / 100, 0);
}

interface CreditCardRecord {
	id: number;
	patientId?: number;
	cardHolderName: string;
	cardType: string;
	expiryMonth: number;
	expiryYear: number;
	billingAddressLine1?: string;
	billingAddressLine2?: string;
	billingCity?: string;
	billingState?: string;
	billingZip?: string;
	billingCountry?: string;
	isDefault?: boolean;
	isActive?: boolean;
	maskedCardNumber?: string;
	isExpired?: boolean;
}

export const PAYMENTS_FORM_FIELDS: FormFieldDef[] = [
	{
		key: 'patientName', label: 'Patient', type: 'search', required: true,
		placeholder: 'Search patient...', apiPath: '/api/patients',
		relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'],
		// Selecting a patient auto-fills the Receipt Email from their record so
		// staff don't have to retype it. The candidate list covers the assorted
		// shapes the patient endpoints use for the email value.
		relatedFieldsMap: { receiptEmail: 'email||contact.email||contactInfo.email||emailAddress' },
	},
	{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
	{ key: 'amount', label: 'Amount ($)', type: 'number', required: true, placeholder: '0.00' },
	{
		// Issue #12: Type options match the CollectPaymentModal.tsx dropdown.
		key: 'transactionType', label: 'Type', type: 'select', options: [
			{ label: 'Payment', value: 'payment' },
			{ label: 'Encounter', value: 'encounter' },
			{ label: 'Claim', value: 'claim' },
			{ label: 'Invoice', value: 'invoice' },
			{ label: 'Copay', value: 'copay' },
			{ label: 'Deductible', value: 'deductible' },
			{ label: 'Coinsurance', value: 'coinsurance' },
			{ label: 'Self Pay', value: 'self_pay' },
			// Money taken at the front desk before anyone knows which claim it
			// belongs to. It is held as an available credit balance and deducted
			// automatically when a copay comes due (see patientCredit.ts).
			{ label: 'Patient Credit (hold on account)', value: CREDIT_TXN_TYPE },
			{ label: 'Other', value: 'other' },
		], defaultValue: 'payment'
	},
	{
		// Manual transaction records use non-charging methods. Credit/debit card
		// collection goes through the dedicated "collect payment" flow because the
		// backend requires a saved payment method to actually charge a card
		// (card methods without a saved paymentMethodId return a 400).
		key: 'paymentMethodType', label: 'Method', type: 'select', required: true, options: [
			{ label: 'Cash', value: 'cash' },
			{ label: 'Check', value: 'check' },
			{ label: 'ACH', value: 'ach' },
			{ label: 'Bank Account', value: 'bank_account' },
			{ label: 'FSA', value: 'fsa' },
			{ label: 'HSA', value: 'hsa' },
			{ label: 'Other', value: 'other' },
		], defaultValue: 'cash'
	},
	{ key: 'description', label: 'Description', type: 'text', placeholder: 'Visit copay, lab, etc.' },
	// Issue #12: keep a Receipt Email field (matches CollectPaymentModal.tsx).
	{ key: 'receiptEmail', label: 'Receipt Email', type: 'text', placeholder: 'patient@email.com', validationPattern: '^$|^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', validationMessage: 'Please enter a valid email address' },
	{ key: 'invoiceId', label: 'Invoice ID', type: 'text', placeholder: 'Optional — link to invoice' },
	{ key: 'notes', label: 'Notes / Stripe Charge ID', type: 'text', placeholder: 'Stripe charge id (ch_...), check #, ...' },
	{
		key: 'status', label: 'Status', type: 'select', options: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Processing', value: 'processing' },
			{ label: 'Completed', value: 'completed' },
			{ label: 'Failed', value: 'failed' },
			{ label: 'Refunded', value: 'refunded' },
			{ label: 'Voided', value: 'voided' },
		], defaultValue: 'completed'
	},
];

/** Parse an EOB breakdown value (e.g. `billed=185.00`) out of a posting description. */
function parseEobField(description: string, field: string): number | undefined {
	const m = description.match(new RegExp(`${field}=(-?\\d+(?:\\.\\d+)?)`));
	return m ? Number(m[1]) : undefined;
}

/**
 * Parse the per-CPT EOB breakdown out of a posting's notes. Line-level
 * postings store `lines=CODE~billed~allowed~paid~copay~deductible~coinsurance~writeOff;CODE~…`
 * in the TEXT notes column (the description column is too small to carry
 * per-line detail). Legacy postings only carried the first 4 (then 7)
 * segments — the missing figures stay 0 / undefined for those.
 */
function parseEobLines(notes: string): EobLine[] {
	const m = String(notes ?? '').match(/lines=([^|]+)/);
	if (!m) { return []; }
	const out: EobLine[] = [];
	for (const part of m[1].split(';')) {
		const [code, billed, allowed, paid, copay, deductible, coinsurance, writeOff] = part.split('~');
		if (!code || !code.trim()) { continue; }
		const line: EobLine = {
			code: code.trim(), description: '',
			billed: Number(billed) || 0, allowed: Number(allowed) || 0, paid: Number(paid) || 0,
			copay: Number(copay) || 0, deductible: Number(deductible) || 0, coinsurance: Number(coinsurance) || 0,
		};
		if (writeOff !== undefined) { line.writeOff = Number(writeOff) || 0; }
		out.push(line);
	}
	return out;
}

/** A line's write-off: the explicit per-code figure when entered, else billed - allowed. */
function lineWriteOff(l: EobLine): number {
	if (l.writeOff !== undefined) { return l.writeOff; }
	return l.allowed > 0 ? Math.max(Math.round((l.billed - l.allowed) * 100) / 100, 0) : 0;
}

/** Serialize the per-CPT EOB lines for the notes column (see parseEobLines). */
function eobLinesSegment(lines: EobLine[]): string {
	return lines.map(l => `${l.code}~${l.billed.toFixed(2)}~${l.allowed.toFixed(2)}~${l.paid.toFixed(2)}~${(l.copay || 0).toFixed(2)}~${(l.deductible || 0).toFixed(2)}~${(l.coinsurance || 0).toFixed(2)}~${lineWriteOff(l).toFixed(2)}`).join(';');
}

/**
 * Parse the secondary-payer EOB detail out of a posting's notes. Stored as
 * `| sec=payer~check~date~posted | sl=CODE~carried~paid~writeOff~billed~allowed~copay~deductible~coinsurance;CODE~…`
 * appended after the primary `lines=` segment. Early postings carried only
 * the first 4 segments — billed defaults to the carried coinsurance then.
 */
function parseSecondaryEob(notes: string): { payer: string; check: string; date: string; posted: boolean; lines: SecondaryEobLine[] } | undefined {
	const raw = String(notes ?? '');
	const m = raw.match(/(?:^|\| ?)sec=([^|]+)/);
	if (!m) { return undefined; }
	const [payer, check, date, posted] = m[1].split('~');
	const lines: SecondaryEobLine[] = [];
	const lm = raw.match(/(?:^|\| ?)sl=([^|]+)/);
	if (lm) {
		for (const part of lm[1].split(';')) {
			const [code, carried, paid, writeOff, billed, allowed, copay, deductible, coinsurance] = part.split('~');
			if (!code || !code.trim()) { continue; }
			const carriedN = Number(carried) || 0;
			lines.push({
				code: code.trim(), carried: carriedN,
				billed: billed !== undefined ? (Number(billed) || 0) : carriedN,
				allowed: Number(allowed) || 0,
				paid: Number(paid) || 0,
				copay: Number(copay) || 0, deductible: Number(deductible) || 0, coinsurance: Number(coinsurance) || 0,
				writeOff: Number(writeOff) || 0,
			});
		}
	}
	return { payer: (payer || '').trim(), check: (check || '').trim(), date: (date || '').trim(), posted: posted?.trim() === '1', lines };
}

/** Serialize the secondary-payer EOB detail for the notes column (see parseSecondaryEob). */
function secondaryEobSegment(payer: string, check: string, date: string, posted: boolean, lines: SecondaryEobLine[]): string {
	return ` | sec=${payer}~${check}~${date}~${posted ? 1 : 0} | sl=${lines.map(s =>
		`${s.code}~${s.carried.toFixed(2)}~${s.paid.toFixed(2)}~${s.writeOff.toFixed(2)}~${s.billed.toFixed(2)}~${s.allowed.toFixed(2)}~${s.copay.toFixed(2)}~${s.deductible.toFixed(2)}~${s.coinsurance.toFixed(2)}`).join(';')}`;
}

export class PaymentsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPayments';

	private payView: 'encounter-billing' | 'transactions' | 'insurance-posting' | 'methods' | 'plans' | 'ledger' | 'invoices' | 'credits' = 'encounter-billing';
	// Methods + Plans + Ledger are patient-scoped on the backend (no global list
	// route), so those views require a selected patient (matches ciyex-ehr-ui).
	private _payPatientId = '';
	private _payPatientName = '';
	private _payPatientBar: HTMLElement | null = null;
	/**
	 * What the user last typed in the Ledger's own filter box. `undefined` means
	 * "untouched", so the ledger opens scoped to the patient bar selection; an
	 * empty string is a deliberate clear and must survive the next reload — the
	 * ledger used to re-seed itself from the patient name, which is why a
	 * cleared/edited filter kept coming back (QA 27-Jul).
	 */
	private _ledgerFilter: string | undefined;
	// allow-any-unicode-next-line
	// ── Credit-card grid state ──────────────────────────────────────────────
	private _cards: CreditCardRecord[] = [];
	private _cardsSearch = '';
	private _cardsLoading = false;
	private _cardFormOverlay: HTMLElement | null = null;
	private _cardFormBackdrop: HTMLElement | null = null;
	// allow-any-unicode-next-line
	// ── Invoice state (ciyex-patient-pay service) ──────────────────────────
	private _invoices: Array<Record<string, unknown>> = [];
	private _invoicesLoading = false;
	/** Cache of patientId -> display name for the Transactions Patient column. */
	private readonly _patientNameCache = new Map<string, string>();
	private _invoiceFormOverlay: HTMLElement | null = null;
	private _invoiceFormBackdrop: HTMLElement | null = null;
	/** Billed fee sheets (= claims) loaded by the Insurance Posting enrich pass;
	 *  reused by the line-level EOB form's claim picker and code lookups. */
	private _billedClaims: EobClaimOption[] = [];
	// allow-any-unicode-next-line
	// ── Insurance Posting (custom expandable grid) state ───────────────────
	/** One entry per claim/posting row shown in the Insurance Posting grid. */
	private _insRows: InsurancePostingRow[] = [];
	private _insLoading = false;
	/** claimRef (normalized) of the rows currently expanded to per-CPT inputs. */
	private readonly _insExpanded = new Set<string>();
	/** claimRef (normalized) of POSTED secondary EOBs expanded to their full breakdown. */
	private readonly _secExpanded = new Set<string>();
	private _insSearch = '';
	private _insStatusFilter: '' | 'AWAITING_EOB' | 'POSTED' | 'DENIAL' | 'AWAITING_SECONDARY' = '';

	private readonly _transactionsConfig: ClinicalEditorConfig = {
		title: 'Patient Balance', apiPath: '/api/payments/transactions', statsPath: '/api/payments/stats',
		searchPlaceholder: 'Search by patient, transaction...',
		// "+ Collect Payment" POSTs to /api/payments/collect — the GET list lives
		// at /api/payments/transactions but the backend has no POST on that path.
		// QA report 2026-05-11: clicking save raised
		// "request method 'POST' is not supported".
		buildCreateUrl: () => '/api/payments/collect',
		// PUT/PATCH/DELETE still live under /transactions/{id}.
		buildItemUrl: (item) => `/api/payments/transactions/${item.id}`,
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
			{ key: 'serviceDate', label: 'Date of Service', width: '130px' },
			{ key: 'claimRef', label: 'Claim No', width: '85px' },
			{ key: 'encounterId', label: 'Encounter No', width: '95px' },
			{ key: 'patientName', label: 'Patient Name' },
			{ key: 'transactionType', label: 'Type', width: '95px' },
			{ key: 'paymentMethodType', label: 'Method', width: '80px' },
			{ key: 'amount', label: 'Amount', width: '80px' },
			{ key: 'description', label: 'Description' },
			{ key: 'status', label: 'Status', width: '85px' },
			// Payment posting date — date only, no time (QA: the timestamp made
			// the column noisy and inconsistent with every other date column
			// in this table).
			{ key: 'collectedAt', label: 'Payment Posting Date', width: '150px' },
		],
		statusTabs: [
			{ label: 'Completed', value: 'completed' }, { label: 'Pending', value: 'pending' },
			{ label: 'Processing', value: 'processing' }, { label: 'Failed', value: 'failed' },
			{ label: 'Refunded', value: 'refunded' }, { label: 'Voided', value: 'voided' },
		],
		createLabel: '+ Collect Payment',
		creatable: true,
		additionalFilters: [
			{
				key: 'transactionType', placeholder: 'All Types',
				options: [
					{ label: 'Payment', value: 'payment' },
					{ label: 'Copay', value: 'copay' },
					{ label: 'Deductible', value: 'deductible' },
					{ label: 'Coinsurance', value: 'coinsurance' },
					{ label: 'Self-Pay', value: 'self_pay' },
					{ label: 'Patient Credit', value: CREDIT_TXN_TYPE },
				],
			},
			{
				key: 'paymentMethodType', placeholder: 'All Methods',
				options: [
					{ label: 'Credit Card', value: 'credit_card' },
					{ label: 'Debit Card', value: 'debit_card' },
					{ label: 'Cash', value: 'cash' },
					{ label: 'Check', value: 'check' },
					{ label: 'ACH', value: 'ach' },
				],
			},
		],
		formFields: PAYMENTS_FORM_FIELDS,
		// A "Patient Credit" collection is deliberately unallocated: no claim, no
		// encounter, no date of service. Normalising it here means the plain
		// Collect Payment form produces exactly the record patientCredit.ts writes,
		// so it shows up on the Credits tab and in the credit ledger card.
		beforeSave: (payload) => {
			if (String(payload['transactionType'] ?? '') !== CREDIT_TXN_TYPE) { return payload; }
			const amount = Math.round((Number(payload['amount']) || 0) * 100) / 100;
			payload['status'] = 'completed';
			payload['referenceType'] = 'balance';
			delete payload['claimId'];
			delete payload['dateOfService'];
			if (!payload['description']) {
				// allow-any-unicode-next-line
				payload['description'] = `Patient credit — ${String(payload['paymentMethodType'] ?? 'cash').replace(/_/g, ' ')} payment held on account`;
			}
			payload['notes'] = `credit=${amount.toFixed(2)}`;
			return payload;
		},
		cellRenderer: (key: string, value: unknown, item: Record<string, unknown>): string => {
			if (key === 'amount' && typeof value === 'number') { return `$${value.toFixed(2)}`; }
			if (key === 'collectedAt' && typeof value === 'string') {
				return value ? (isoToUsDate(value) || String(value)) : '—';
			}
			// Date of service (the completed appointment's date), encounter id
			// and claim # are resolved by enrichItems from the claim reference.
			if (key === 'serviceDate') { return value ? isoToUsDate(String(value)) : '—'; }
			if (key === 'encounterId' || key === 'claimRef') { return String(value ?? '') || '—'; }
			// A merged copay+deductible+coinsurance record reads "Patient Resp",
			// not the (single-component) transactionType it is stored under.
			if (key === 'transactionType' && String(item['description'] ?? '').startsWith('Patient responsibility')) { return 'Patient Resp'; }
			if (key === 'patientName' && !value) {
				// Use a resolved name from the cache if enrichment fetched it;
				// otherwise fall back to the patient id.
				const pid = item['patientId'];
				if (pid !== undefined && pid !== null && pid !== '') {
					const cached = this._patientNameCache.get(String(pid));
					return cached || `Patient #${pid}`;
				}
				return '';
			}
			if (key === 'transactionType' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'paymentMethodType' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		// Reshapes the raw transaction list for display:
		//  1. drops insurance payments (EOB postings live on the Insurance
		//     Posting tab, not here),
		//  2. merges a claim's still-pending copay / deductible / coinsurance
		//     rows into ONE "Patient Resp" record,
		//  3. resolves Claim # / Encounter ID / Date of Service (the completed
		//     appointment's date) from the claim reference,
		//  4. resolves missing patient names from /api/patients/{id} (cached).
		enrichItems: async (items) => {
			let rows = items.filter(it => String(it['transactionType'] ?? '') !== 'insurance_payment'
				&& !String(it['description'] ?? '').startsWith('EOB posting'));

			// Merge legacy per-component patient-responsibility rows (new EOB
			// postings already create a single combined record).
			const respGroups = new Map<string, Record<string, unknown>[]>();
			for (const it of rows) {
				const type = String(it['transactionType'] ?? '');
				if (String(it['status'] ?? '') !== 'pending' || !['copay', 'deductible', 'coinsurance'].includes(type)) { continue; }
				const claim = String(it['description'] ?? '').match(/claim[= ]([A-Za-z0-9-]+)/)?.[1];
				if (!claim) { continue; }
				const key = `${it['patientId']}|${normalizeClaimRef(claim)}`;
				respGroups.set(key, [...(respGroups.get(key) || []), it]);
			}
			const drop = new Set<Record<string, unknown>>();
			for (const group of respGroups.values()) {
				if (group.length < 2) { continue; }
				const first = group[0];
				const total = Math.round(group.reduce((s, g) => s + (Number(g['amount']) || 0), 0) * 100) / 100;
				const split = group.map(g => `${g['transactionType']} $${(Number(g['amount']) || 0).toFixed(2)}`).join(' + ');
				const claim = String(first['description'] ?? '').match(/claim[= ]([A-Za-z0-9-]+)/)?.[1] || '';
				first['amount'] = total;
				first['description'] = `Patient responsibility (${split}) due from patient — claim ${claim} (from EOB)`;
				first['__mergedIds'] = group.map(g => g['id']);
				for (const g of group.slice(1)) { drop.add(g); }
			}
			rows = rows.filter(it => !drop.has(it));

			// Claim # / Encounter ID / Date of Service columns.
			if (rows.some(it => /claim[= ]/.test(String(it['description'] ?? '')))) {
				try {
					const [sheetsRes, dosIndex] = await Promise.all([
						this.apiService.fetch('/api/fee-sheets'),
						this._loadCompletedApptDates(),
					]);
					const sheetsJson = sheetsRes.ok ? await sheetsRes.json() : null;
					const w = sheetsJson?.data ?? sheetsJson;
					const sheets = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
					const byRef = new Map<string, Record<string, unknown>>();
					for (const s of (Array.isArray(sheets) ? sheets : [])) {
						if (s['id'] !== undefined && s['id'] !== null) { byRef.set(normalizeClaimRef(String(s['id'])), s); }
					}
					for (const it of rows) {
						const ref = String(it['description'] ?? '').match(/claim[= ]([A-Za-z0-9-]+)/)?.[1] || '';
						if (!ref) { continue; }
						const sheet = byRef.get(normalizeClaimRef(ref));
						it['claimRef'] = sheet ? claimNumberForFeeSheet(String(sheet['id'])) : ref;
						if (sheet && sheet['encounterId'] !== undefined && sheet['encounterId'] !== null) { it['encounterId'] = String(sheet['encounterId']); }
						it['serviceDate'] = this._resolveDateOfService(dosIndex,
							String(sheet?.['encounterId'] ?? ''), String(it['patientId'] ?? ''),
							String(sheet?.['encounterDate'] ?? sheet?.['serviceDate'] ?? '').slice(0, 10));
					}
				} catch { /* the new columns fall back to a dash */ }
			}

			const missing = Array.from(new Set(rows
				.filter(it => !it['patientName'] && it['patientId'] !== undefined && it['patientId'] !== null && it['patientId'] !== '')
				.map(it => String(it['patientId']))
				.filter(pid => !this._patientNameCache.has(pid))));
			await Promise.all(missing.map(async pid => {
				try {
					const res = await this.apiService.fetch(`/api/patients/${encodeURIComponent(pid)}`);
					if (!res.ok) { return; }
					const data = await res.json();
					const p = data?.data || data;
					const first = p?.firstName || p?.identification?.firstName || '';
					const last = p?.lastName || p?.identification?.lastName || '';
					const full = `${first} ${last}`.trim();
					if (full) { this._patientNameCache.set(pid, full); }
				} catch { /* leave fallback */ }
			}));
			for (const it of rows) {
				if (!it['patientName'] && it['patientId'] !== undefined && it['patientId'] !== null) {
					const name = this._patientNameCache.get(String(it['patientId']));
					if (name) { it['patientName'] = name; }
				}
			}
			// Most recent transaction at the TOP (team request 29-Jul) — the backend
			// returns them in insertion order, so the ordering is settled here.
			const when = (it: Record<string, unknown>): number => {
				const t = new Date(String(it['collectedAt'] ?? it['transactionDate'] ?? it['createdAt'] ?? '')).getTime();
				return Number.isFinite(t) ? t : 0;
			};
			rows.sort((a, b) => when(b) - when(a));
			return rows;
		},
		// Issue #12: full action set — View, Collect, Edit, Refund, Void, Delete —
		// matching the TransactionsTab.tsx row actions.
		actions: [
			{
				// Collect Payment: settle a still-open patient balance straight from
				// this tab (team request 2026-07-27). Only pending rows can be
				// collected — a completed transaction is already money in hand.
				// allow-any-unicode-next-line
				label: 'Collect Payment', icon: '💵', color: '#22c55e',
				visible: item => String(item['status'] ?? '').toLowerCase() === 'pending',
				handler: async (item, api, reload, dlg) => {
					const due = Number(item['amount']) || 0;
					const result = await showThemedModal({
						title: 'Collect Payment',
						subtitle: `${String(item['patientName'] || (item['patientId'] ? `Patient #${item['patientId']}` : 'Patient'))} — $${due.toFixed(2)} due`,
						confirmLabel: 'Collect',
						confirmColor: '#22c55e',
						fields: [
							{ key: 'amount', label: 'Amount to Collect ($)', type: 'number', value: due.toFixed(2), required: true },
							{
								key: 'paymentMethodType', label: 'Method', type: 'select', value: 'cash', required: true,
								options: [
									{ label: 'Cash', value: 'cash' }, { label: 'Check', value: 'check' },
									{ label: 'Credit Card', value: 'credit_card' }, { label: 'Debit Card', value: 'debit_card' },
									{ label: 'ACH', value: 'ach' },
								],
							},
							{ key: 'note', label: 'Note', type: 'text', placeholder: 'Reference / receipt note (optional)' },
						],
						anchor: this.root,
					});
					if (!result) { return; }
					const amount = Math.round((Number(result.amount) || 0) * 100) / 100;
					if (!amount || amount <= 0) { await dlg.error('Enter an amount greater than 0.'); return; }
					if (amount > due + 0.005) { await dlg.error(`The most that can be collected on this row is $${due.toFixed(2)}.`); return; }
					const method = String(result.paymentMethodType || 'cash');
					// A merged "Patient Resp" display row is backed by several records;
					// settle them oldest-first so a part payment leaves the right
					// remainder showing as due.
					const ids = (Array.isArray(item['__mergedIds']) && (item['__mergedIds'] as unknown[]).length
						? item['__mergedIds'] as unknown[] : [item['id']]).map(String);
					const ok = await this._collectPendingTransactions(ids, amount, method, item, String(result.note || ''));
					if (!ok) { await dlg.error('The collection could not be recorded. Please try again.'); return; }
					reload();
					// The Dashboard's balance / patient-portion columns read the same
					// transactions, so refresh its cache too.
					void this._loadEncounterBillingSilently();
					await dlg.info(`Collected $${amount.toFixed(2)}. The Dashboard balance has been updated.`);
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'View', icon: '\u{1F441}', handler: async (item, _api, _reload, _dlg) => {
					const fmt = (k: string): string => { const v = item[k]; return (v === undefined || v === null || v === '') ? '—' : String(v); };
					const amt = typeof item.amount === 'number' ? `$${(item.amount as number).toFixed(2)}` : fmt('amount');
					const titleCase = (s: string): string => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
					const dateStr = ((): string => {
						const raw = String(item.collectedAt ?? '').trim();
						if (!raw) { return '—'; }
						const d = new Date(raw);
						return isNaN(d.getTime()) ? raw : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
					})();
					const statusStr = titleCase(fmt('status'));
					const statusColor = ((): string | undefined => {
						const s = statusStr.toLowerCase();
						if (s.includes('complet') || s.includes('fulfil') || s.includes('post')) { return '#22c55e'; }
						if (s.includes('pend') || s.includes('process')) { return '#f59e0b'; }
						if (s.includes('fail') || s.includes('void') || s.includes('cancel') || s.includes('refund')) { return '#ef4444'; }
						return s === '—' ? undefined : '#3b9edd';
					})();
					await showThemedDetails({
						title: `Transaction ${item.transactionId ? `#${item.transactionId}` : ''}`.trim(),
						subtitle: String(item.patientName || (item.patientId ? `Patient #${item.patientId}` : '')),
						anchor: this.root,
						rows: [
							{ label: 'Patient', value: String(item.patientName || (item.patientId ? `Patient #${item.patientId}` : '—')) },
							{ label: 'Amount', value: amt, emphasis: true },
							{ label: 'Type', value: titleCase(fmt('transactionType')) },
							{ label: 'Method', value: titleCase(fmt('paymentMethodType')) },
							{ label: 'Status', value: statusStr, accent: statusColor },
							{ label: 'Date', value: dateStr },
							{ label: 'Description', value: fmt('description'), wide: true },
						],
					});
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Edit', icon: '✏️', handler: async (item, api, reload, dlg) => {
					// Mirrors TransactionsTab.tsx edit modal: amount, description, method.
					const result = await showThemedModal({
						title: 'Edit Transaction',
						subtitle: String(item.patientName || (item.patientId ? `Patient #${item.patientId}` : '')),
						confirmLabel: 'Save',
						fields: [
							{ key: 'amount', label: 'Amount ($)', type: 'number', value: String(item.amount ?? ''), required: true },
							{ key: 'description', label: 'Description', type: 'text', value: String(item.description ?? '') },
							{ key: 'paymentMethodType', label: 'Method', type: 'text', value: String(item.paymentMethodType ?? '') },
						],
						anchor: this.root,
					});
					if (!result) { return; }
					const amt = Number(result.amount);
					if (!amt || amt <= 0) { await dlg.error('Invalid amount.'); return; }
					const res = await api.fetch(`/api/payments/transactions/${item.id}`, {
						method: 'PUT', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ amount: amt, description: result.description, paymentMethodType: result.paymentMethodType }),
					});
					if (!res.ok) { const e = await res.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(e?.['message'] || 'Update failed')); return; }
					reload();
				}
			},
			{
				// Issue #12: Refund opens the same refund UI as ehr-ui — amount
				// pre-filled to the maximum refundable (amount - already refunded) and
				// a reason — posting to the same /refund endpoint.
				// allow-any-unicode-next-line
				label: 'Refund', icon: '↩️', handler: async (item, api, reload, dlg) => {
					const paid = Number(item.amount) || 0;
					const alreadyRefunded = Number(item.refundAmount) || 0;
					const maxRefund = Math.max(0, paid - alreadyRefunded);
					const result = await showThemedModal({
						title: 'Issue a Refund',
						subtitle: `Max refundable: $${maxRefund.toFixed(2)}`,
						confirmLabel: 'Process Refund',
						confirmColor: '#8b5cf6',
						fields: [
							{ key: 'amount', label: 'Refund Amount ($)', type: 'number', value: maxRefund.toFixed(2), required: true },
							{ key: 'reason', label: 'Reason', type: 'textarea', placeholder: 'Reason for refund...', rows: 3 },
						],
						anchor: this.root,
					});
					if (!result) { return; }
					const amount = Number(result.amount);
					if (!amount || amount <= 0) { await dlg.error('Invalid refund amount.'); return; }
					const res = await api.fetch(`/api/payments/transactions/${item.id}/refund`, {
						method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ amount, reason: result.reason || 'Refund' }),
					});
					if (!res.ok) { const e = await res.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(e?.['message'] || 'Refund failed')); return; }
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Void', icon: '⊘', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: 'Void this transaction?', type: 'warning', primaryButton: 'Void' });
					if (r.confirmed) {
						// A merged patient-resp display row voids every backing record.
						const ids = Array.isArray(item['__mergedIds']) && (item['__mergedIds'] as unknown[]).length ? item['__mergedIds'] as unknown[] : [item.id];
						for (const id of ids) {
							await api.fetch(`/api/payments/transactions/${id}/void`, { method: 'POST' });
						}
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: 'Delete this transaction?', type: 'warning', primaryButton: 'Delete' });
					if (r.confirmed) {
						// A merged patient-resp display row deletes every backing record.
						const ids = Array.isArray(item['__mergedIds']) && (item['__mergedIds'] as unknown[]).length ? item['__mergedIds'] as unknown[] : [item.id];
						for (const id of ids) {
							await api.fetch(`/api/payments/transactions/${id}`, { method: 'DELETE' });
						}
						reload();
					}
				}
			},
		],
	};

	// Insurance payment posting (EOB) — CUSTOM expandable grid (not the generic
	// list base). Each billed claim is one collapsed row; clicking it expands
	// inline to one row PER CPT code with editable Billed / Allowed / Ins Paid
	// inputs, plus claim-level Copay / Deductible / Coinsurance and Check # /
	// Payer, and a Post/Save button. Rendered by _loadAndRenderInsurancePosting().
	private readonly _insurancePostingConfig: ClinicalEditorConfig = {
		title: 'Insurance Posting', apiPath: '/api/payments/transactions',
		searchPlaceholder: '', clientSideFilter: [], columns: [], formFields: [],
		listUrlBuilder: () => null,
	};

	/** A billed fee sheet reshaped as a postable claim for the EOB form. */
	private _feeSheetToClaim(s: Record<string, unknown>): EobClaimOption {
		const items = (s['items'] as Array<Record<string, unknown>>) || [];
		const lines: EobLine[] = items
			.filter(it => String(it['type'] ?? '') !== 'ICD10' && it['code'])
			.map(it => ({
				code: String(it['code']),
				description: String(it['description'] ?? ''),
				billed: Math.round((Number(it['price'] ?? 0) || 0) * (Number(it['qty'] ?? 1) || 1) * 100) / 100,
				allowed: 0,
				paid: 0,
			}));
		return {
			claimRef: claimNumberForFeeSheet(String(s['id'] ?? '')),
			feeSheetId: String(s['id'] ?? ''),
			patientId: String(s['patientId'] ?? ''),
			patientName: String(s['patientName'] ?? ''),
			serviceDate: String(s['encounterDate'] ?? s['serviceDate'] ?? s['createdAt'] ?? '').slice(0, 10),
			encounterId: String(s['encounterId'] ?? ''),
			lines,
		};
	}

	/** Persist an EOB form result as a payment transaction (+ patient-pay follow-ups on create). */
	private async _saveEobPosting(v: EobFormValues, editId?: string, secSuffix?: string): Promise<void> {
		const round2 = (n: number) => Math.round(n * 100) / 100;
		const writeOff = v.lines.length
			? round2(v.lines.reduce((s, l) => s + lineWriteOff(l), 0))
			: Math.max(round2(v.billed - v.allowed), 0);
		// Coinsurance is NOT patient responsibility yet — it is carried to the
		// patient's SECONDARY insurance and stays an insurance balance until the
		// secondary EOB posts (only its unpaid remainder bills to the patient).
		const resp = round2(v.copay + v.deductible);
		const balanced = Math.abs(v.allowed - (v.paid + resp + v.coinsurance)) <= 0.01;
		const description =
			`EOB posting | payer=${v.payerName}; claim=${v.claimRef}; ` +
			`check=${v.checkNumber}; billed=${v.billed.toFixed(2)}; allowed=${v.allowed.toFixed(2)}; ` +
			`paid=${v.paid.toFixed(2)}; copay=${v.copay.toFixed(2)}; deductible=${v.deductible.toFixed(2)}; ` +
			`coinsurance=${v.coinsurance.toFixed(2)}; writeoff=${writeOff.toFixed(2)}; resp=${resp.toFixed(2)}` +
			(v.denialReason ? `; denial=${v.denialReason}` : '') +
			(v.forwardedToSecondary ? `; fwd=1; payer2=${v.secondaryPayer}` : '') +
			(balanced ? '' : ' | WARN: allowed != paid + patient responsibility');
		// The description column is too small for per-line detail — the CPT
		// breakdown rides in the TEXT notes column instead (billed / allowed /
		// paid / copay / deductible / coinsurance / write-off per code), plus
		// the secondary-EOB segments when the row carries them.
		const notes = (v.lines.length
			? `check=${v.checkNumber} | lines=${eobLinesSegment(v.lines)}`
			: `check=${v.checkNumber}`) + (secSuffix || '');
		try {
			if (editId) {
				const res = await this.apiService.fetch(`/api/payments/transactions/${editId}`, {
					method: 'PUT', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ amount: v.paid > 0 ? v.paid : 0, description, notes, paymentMethodType: v.paymentMethodType }),
				});
				if (!res.ok) {
					const e = await res.json().catch(() => null) as Record<string, unknown> | null;
					await this.dialogService.error(String(e?.['message'] || `Posting update failed (${res.status}).`));
					return;
				}
			} else {
				// The backend rejects amount <= 0 on create, but a zero-pay denial is
				// a legitimate posting — create with a placeholder cent and PUT the
				// amount back to 0 (the description carries paid=0.00, which the grid
				// treats as authoritative).
				const res = await this.apiService.fetch('/api/payments/collect', {
					method: 'POST',
					body: JSON.stringify({
						patientId: v.patientId,
						patientName: v.patientName,
						amount: v.paid > 0 ? v.paid : 0.01,
						transactionType: 'insurance_payment',
						paymentMethodType: v.paymentMethodType || 'check',
						status: 'completed',
						description,
						notes,
					}),
				});
				if (!res.ok) {
					const e = await res.json().catch(() => null) as Record<string, unknown> | null;
					await this.dialogService.error(String(e?.['message'] || `Posting failed (${res.status}).`));
					return;
				}
				const data = await res.json().catch(() => null) as Record<string, unknown> | null;
				const saved = (data?.['data'] ?? data) as Record<string, unknown> | null;
				if (v.paid <= 0 && saved?.['id'] !== undefined && saved?.['id'] !== null) {
					await this.apiService.fetch(`/api/payments/transactions/${saved['id']}`, {
						method: 'PUT', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ amount: 0 }),
					}).catch(() => { /* grid shows the parsed $0 either way */ });
				}
				// Copay / deductible are the PATIENT-PAY portion — they move to the
				// Patient Balance tab as a pending transaction the front desk
				// collects (the Dashboard's Collect completes it). Coinsurance is
				// deliberately excluded: it is pending with the secondary payer.
				await this._createPatientRespTransactions(v);
				// The patient may already have paid ahead. Insurance pays first, the
				// patient's share is worked out next, and any credit on the account is
				// used against it straight away instead of billing money the practice
				// is already holding.
				await this._applyCreditToNewResponsibility(v);
				if (v.coinsurance > 0) {
					// The claim stays open ("Insurance Pending") — a secondary EOB
					// entry is pre-generated on the row for when the secondary
					// payer's EOB arrives. The copay/deductible part is already a
					// patient balance though, so the patient is statemented now
					// (the email flags the coinsurance as still with the secondary).
					const emailed = resp > 0
						? await this._sendClaimStatement(v, undefined, { coinsurancePending: v.coinsurance, secondaryPayer: v.secondaryPayer })
						: false;
					this._showPayToast(
						`EOB posted. $${v.coinsurance.toFixed(2)} coinsurance is carried to the patient's secondary insurance — the claim stays "Insurance Pending" with a pre-generated secondary EOB entry on its row.`
						+ (resp > 0
							? ` $${resp.toFixed(2)} is patient responsibility now${emailed
								? ' and the patient was emailed a statement with the full code & service breakdown.'
								: ' (statement email could not be sent — check Settings > Notifications and the patient\'s email).'}`
							: ''));
				} else if (resp > 0) {
					// No coinsurance → the insurance side is closed; statement the
					// patient with the full code & service breakdown of what they pay.
					const emailed = await this._sendClaimStatement(v);
					this._showPayToast(
						`EOB posted — claim ${v.claimRef} is closed. $${resp.toFixed(2)} is patient responsibility${emailed
							? ' and the patient was emailed a statement with the full code & service breakdown.'
							: ' (statement email could not be sent — use the Dashboard invoice action).'}`);
				}
			}
			this._resetAndReload();
		} catch (e) {
			await this.dialogService.error(`Posting failed: ${e}`);
		}
	}

	/**
	 * ONE pending transaction for the patient-responsibility total (copay +
	 * deductible combined) — the Patient Balance tab shows a single "Patient
	 * Resp" record per claim instead of one row per component. Typed `copay`
	 * so the Dashboard's Collect flow (_completePendingPatientResp) still
	 * matches and completes it; the description carries the component split.
	 * Coinsurance is NOT included — it is pending with the secondary payer and
	 * only its unpaid remainder becomes patient responsibility when the
	 * secondary EOB posts (_postSecondaryEob creates that record).
	 */
	private async _createPatientRespTransactions(v: EobFormValues): Promise<void> {
		const parts: Array<[string, number]> = ([['copay', v.copay], ['deductible', v.deductible]] as Array<[string, number]>)
			.filter(([, amt]) => amt > 0);
		const total = Math.round(parts.reduce((s, [, amt]) => s + amt, 0) * 100) / 100;
		if (total <= 0) { return; }
		const split = parts.map(([type, amt]) => `${type} $${amt.toFixed(2)}`).join(' + ');
		try {
			await this.apiService.fetch('/api/payments/collect', {
				method: 'POST',
				body: JSON.stringify({
					patientId: v.patientId,
					patientName: v.patientName,
					amount: total,
					transactionType: 'copay',
					paymentMethodType: 'other',
					status: 'pending',
					description: `Patient responsibility (${split}) due from patient — claim ${v.claimRef} (from EOB)`
						+ (v.coinsurance > 0 ? ` — coinsurance $${v.coinsurance.toFixed(2)} pending secondary insurance` : ''),
				}),
			});
		} catch { /* best-effort — the EOB posting itself already saved */ }
	}

	/**
	 * Use the patient's credit balance against the responsibility an EOB has just
	 * assigned. Capped at the credit on hand, so whatever the credit can't cover
	 * stays on the Patient Balance tab as a pending amount to collect.
	 */
	private async _applyCreditToNewResponsibility(v: EobFormValues): Promise<void> {
		if (this.configurationService.getValue<boolean>('ciyex.billing.autoApplyPatientCredit') === false) { return; }
		const due = Math.round((v.copay + v.deductible) * 100) / 100;
		if (due <= 0.005 || !v.patientId) { return; }
		try {
			const result = await applyPatientCredit(this.apiService, {
				patientId: String(v.patientId), patientName: v.patientName, due,
				claimRef: v.claimRef, kind: 'copay', reason: 'auto-deducted from patient credit after EOB',
			});
			if (result.applied > 0.005) {
				this._showPayToast(
					// allow-any-unicode-next-line
					`$${result.applied.toFixed(2)} of the patient responsibility was covered by credit already on the account — $${result.remaining.toFixed(2)} credit remains.`);
			}
		} catch { /* the responsibility stays collectable the normal way */ }
	}

	// allow-any-unicode-next-line
	// ── Insurance Posting (custom expandable grid) ─────────────────────────
	// Each billed claim is one collapsed row. Clicking it (or the caret)
	// unfolds ALL its CPT codes inline — one editable row per code with Billed /
	// Allowed / Ins Paid / Copay / Deductible / Coinsurance inputs — plus
	// Payer, Check # and a Post button. No popup: the biller types every
	// figure directly in the grid.

	/**
	 * Date-of-service index built from COMPLETED appointments: the completed
	 * appointment's date is the encounter's date of service. Keyed by
	 * encounterId (exact link) and patientId (latest completed, fallback).
	 */
	private async _loadCompletedApptDates(): Promise<{ byEncounter: Map<string, string>; byPatient: Map<string, string> }> {
		const byEncounter = new Map<string, string>();
		const byPatient = new Map<string, string>();
		try {
			const res = await this.apiService.fetch('/api/appointments?page=0&size=500&dateFrom=2020-01-01&dateTo=2030-12-31');
			if (res.ok) {
				const data = await res.json();
				const list = (data?.data?.content || data?.data || data?.content || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
				for (const a of (Array.isArray(list) ? list : [])) {
					const rawStatus = a['status'];
					const status = (typeof rawStatus === 'string' ? rawStatus : JSON.stringify(rawStatus ?? '')).toLowerCase();
					if (!status.includes('complet')) { continue; }
					let date = String(a['appointmentStartDate'] ?? a['start'] ?? '');
					if (date.includes('T')) { date = date.slice(0, 10); }
					if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { continue; }
					const enc = String(a['encounterId'] ?? '').trim();
					if (enc) { byEncounter.set(enc, date); }
					const pid = String(a['patientId'] ?? '').trim();
					if (pid && date > (byPatient.get(pid) || '')) { byPatient.set(pid, date); }
				}
			}
		} catch { /* fall back to fee-sheet encounter dates */ }
		return { byEncounter, byPatient };
	}

	/** Resolve a claim's date of service: completed-appointment date first
	 *  (by encounter, then by patient), else the fee-sheet encounter date. */
	private _resolveDateOfService(dos: { byEncounter: Map<string, string>; byPatient: Map<string, string> }, encounterId: string, patientId: string, fallback: string): string {
		return (encounterId && dos.byEncounter.get(encounterId)) || fallback || (patientId && dos.byPatient.get(patientId)) || '';
	}

	private async _loadAndRenderInsurancePosting(): Promise<void> {
		if (!this.contentEl) { return; }
		this._insLoading = true;
		this._renderInsurancePosting();
		try {
			const [txns, sheets, dosIndex] = await Promise.all([
				this.apiService.fetch('/api/payments/transactions').then(async r => r.ok ? await r.json() : null).catch(() => null),
				this.apiService.fetch('/api/fee-sheets').then(async r => r.ok ? await r.json() : null).catch(() => null),
				this._loadCompletedApptDates(),
			]);
			const txnList = ((txns?.data ?? txns)?.content || (Array.isArray(txns?.data) ? txns.data : Array.isArray(txns) ? txns : [])) as Array<Record<string, unknown>>;
			const sheetList = ((sheets?.data ?? sheets)?.content || (Array.isArray(sheets?.data) ? sheets.data : Array.isArray(sheets) ? sheets : [])) as Array<Record<string, unknown>>;

			// Billed fee sheets are the claims.
			const billed = sheetList.filter(s => /^(billed|paid|eob)/i.test(String(s['billingStatus'] ?? '')));
			this._billedClaims = billed.map(s => this._feeSheetToClaim(s));
			const claimByRef = new Map(this._billedClaims.map(c => [normalizeClaimRef(c.claimRef), c]));

			// Existing EOB postings → rows (with their per-CPT line detail).
			const postings = txnList.filter(t => String(t['transactionType'] ?? '') === 'insurance_payment'
				|| String(t['description'] ?? '').startsWith('EOB posting'));
			const postedRefs = new Set<string>();
			const postingRows: InsurancePostingRow[] = postings.map(t => {
				const desc = String(t['description'] ?? '');
				const rawNotes = String(t['notes'] ?? '');
				const ref = (desc.match(/claim=([^;|]+)/)?.[1] || '').trim();
				postedRefs.add(normalizeClaimRef(ref));
				const claim = claimByRef.get(normalizeClaimRef(ref));
				const storedLines = parseEobLines(rawNotes);
				const sec = parseSecondaryEob(rawNotes);
				const lines: EobLine[] = (storedLines.length ? storedLines : (claim?.lines || [])).map(l => ({
					...l, description: claim?.lines.find(cl => cl.code === l.code)?.description || l.description,
				}));
				// Legacy postings carried copay/deductible/coinsurance only at claim
				// level — seed the first line with those totals so the per-code
				// inputs still show (and re-save) the amounts.
				const claimCopay = parseEobField(desc, 'copay') ?? 0;
				const claimDeductible = parseEobField(desc, 'deductible') ?? 0;
				const claimCoinsurance = parseEobField(desc, 'coinsurance') ?? 0;
				const linesHaveResp = lines.some(l => (l.copay || 0) + (l.deductible || 0) + (l.coinsurance || 0) > 0);
				if (!linesHaveResp && lines.length > 0 && (claimCopay + claimDeductible + claimCoinsurance) > 0) {
					lines[0].copay = claimCopay;
					lines[0].deductible = claimDeductible;
					lines[0].coinsurance = claimCoinsurance;
				}
				const paid = parseEobField(desc, 'paid') ?? Number(t['amount']) ?? 0;
				const writeOff = parseEobField(desc, 'writeoff') ?? 0;
				const fwd = /fwd=1/.test(desc);
				const denialReason = desc.match(/denial=([^;|]+)/)?.[1]?.trim() || '';
				const coinsEff = claimCoinsurance > 0 ? claimCoinsurance
					: Math.round(lines.reduce((s, l) => s + (l.coinsurance || 0), 0) * 100) / 100;
				let status: InsurancePostingRow['status'] = 'POSTED';
				if (denialReason || (paid === 0 && writeOff > 0)) { status = 'DENIAL'; }
				// Coinsurance left by the primary payer keeps the claim OPEN — it is
				// pending with the secondary insurance ("Insurance Pending") until
				// the secondary EOB is posted.
				else if ((coinsEff > 0 || fwd) && !sec?.posted) { status = 'AWAITING_SECONDARY'; }
				return {
					txnId: String(t['id'] ?? ''),
					claimRef: ref,
					feeSheetId: claim?.feeSheetId || '',
					patientId: String(t['patientId'] ?? (claim?.patientId || '')),
					patientName: String(t['patientName'] ?? (claim?.patientName || '')),
					serviceDate: this._resolveDateOfService(dosIndex, claim?.encounterId || '', String(t['patientId'] ?? (claim?.patientId || '')), claim?.serviceDate || String(t['collectedAt'] ?? '').slice(0, 10)),
					payerName: desc.match(/payer=([^;|]+)/)?.[1]?.trim() || '',
					// Only ever show a real check number — never the raw notes blob
					// (legacy fallback leaked `check= | lines=…` into the field).
					checkNumber: desc.match(/check=([^;|]+)/)?.[1]?.trim()
						|| rawNotes.match(/(?:^|\| ?)check=([^|;]+)/)?.[1]?.trim()
						|| (!rawNotes.includes('=') ? rawNotes.trim() : ''),
					paymentMethodType: String(t['paymentMethodType'] ?? 'check'),
					lines,
					copay: claimCopay,
					deductible: claimDeductible,
					coinsurance: coinsEff,
					denialReason,
					forwardedToSecondary: fwd,
					secondaryPayer: desc.match(/payer2=([^;|]+)/)?.[1]?.trim() || '',
					secPayer: sec?.payer || '',
					secCheck: sec?.check || '',
					secDate: sec?.date || '',
					secPosted: sec?.posted === true,
					secLines: sec?.lines || [],
					status,
				};
			});

			// Claims with no posting yet → "Awaiting EOB" rows (the work list).
			const awaitingRows: InsurancePostingRow[] = this._billedClaims
				.filter(c => !postedRefs.has(normalizeClaimRef(c.claimRef)))
				.map(c => ({
					txnId: '',
					claimRef: c.claimRef,
					feeSheetId: c.feeSheetId,
					patientId: c.patientId,
					patientName: c.patientName,
					serviceDate: this._resolveDateOfService(dosIndex, c.encounterId || '', c.patientId, c.serviceDate || ''),
					payerName: '',
					checkNumber: '',
					paymentMethodType: 'check',
					lines: c.lines.map(l => ({ ...l })),
					copay: 0, deductible: 0, coinsurance: 0,
					denialReason: '', forwardedToSecondary: false, secondaryPayer: '',
					secPayer: '', secCheck: '', secDate: '', secPosted: false, secLines: [],
					status: 'AWAITING_EOB' as const,
				}));
			// Newest date of service at the TOP (team request 29-Jul). The list used
			// to lead with every "Awaiting EOB" claim regardless of age, which put
			// the oldest work at the top and today's claims below the fold.
			this._insRows = [...awaitingRows, ...postingRows]
				.sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || '') || (b.claimRef || '').localeCompare(a.claimRef || ''));
		} catch {
			this._insRows = [];
		}
		this._insLoading = false;
		this._renderInsurancePosting();
	}

	/**
	 * Non-blocking inline toast at the bottom of the pane. Success feedback
	 * must NOT go through dialogService here — those dialogs are native and
	 * block the renderer.
	 */
	private _showPayToast(message: string, timeoutMs = 9000): void {
		if (!this.contentEl) { return; }
		const host = this.contentEl.parentElement || this.contentEl;
		if (!host.style.position) { host.style.position = 'relative'; }
		const toast = host.ownerDocument.createElement('div');
		toast.textContent = message;
		toast.style.cssText = 'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);max-width:70%;z-index:80;padding:10px 16px;border-radius:6px;background:var(--vscode-editorWidget-background,#252526);border:1px solid #22c55e;color:var(--vscode-foreground);font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,0.45);';
		host.appendChild(toast);
		setTimeout(() => toast.remove(), timeoutMs);
	}

	/** Insurance dollars received from the secondary payer (0 until its EOB posts). */
	private _rowSecPaid(row: InsurancePostingRow): number {
		return row.secPosted ? Math.round(row.secLines.reduce((s, l) => s + l.paid, 0) * 100) / 100 : 0;
	}

	/** Coinsurance left to the patient AFTER the secondary payer adjudicated. */
	private _rowSecRemainder(row: InsurancePostingRow): number {
		if (!row.secPosted) { return 0; }
		return Math.max(Math.round(row.secLines.reduce((s, l) => s + secondaryLineOwes(l), 0) * 100) / 100, 0);
	}

	/**
	 * Patient responsibility for a row: copay + deductible immediately, but
	 * coinsurance only AFTER the secondary EOB posted (its unpaid remainder) —
	 * while the secondary is pending the coinsurance is an INSURANCE balance.
	 */
	private _rowPatientResp(row: InsurancePostingRow): number {
		return Math.round((row.copay + row.deductible + this._rowSecRemainder(row)) * 100) / 100;
	}

	/** Rows passing the current search + status filter. */
	private _visibleInsRows(): InsurancePostingRow[] {
		const q = this._insSearch.trim().toLowerCase();
		return this._insRows.filter(r => {
			if (this._insStatusFilter && r.status !== this._insStatusFilter) { return false; }
			if (!q) { return true; }
			const hay = `${r.patientName} ${r.claimRef} ${r.checkNumber} ${r.payerName} ${r.lines.map(l => l.code).join(' ')}`.toLowerCase();
			return hay.includes(q);
		});
	}

	private _renderInsurancePosting(): void {
		if (!this.contentEl) { return; }
		DOM.clearNode(this.contentEl);

		// Toolbar.
		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px;';
		const titleEl = DOM.append(toolbar, DOM.$('h2'));
		titleEl.textContent = 'Insurance Posting';
		titleEl.style.cssText = 'font-size:20px;font-weight:600;margin:0;color:var(--vscode-foreground);';
		const right = DOM.append(toolbar, DOM.$('div'));
		right.style.cssText = 'display:flex;align-items:center;gap:10px;';
		const refreshBtn = DOM.append(right, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.textContent = '\u21BB Refresh';
		refreshBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:6px;cursor:pointer;font-size:12px;';
		refreshBtn.addEventListener('click', () => this._loadAndRenderInsurancePosting());
		// The "+ Post Insurance Payment (EOB)" modal button is intentionally
		// gone — every posting happens inline on its claim row (team request:
		// hide the toolbar post button and the row Collapse button).

		// Summary cards.
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const posted = this._insRows.filter(r => r.status !== 'AWAITING_EOB');
		const sumPaid = posted.reduce((s, r) => s + r.lines.reduce((a, l) => a + l.paid, 0) + this._rowSecPaid(r), 0);
		const sumResp = posted.reduce((s, r) => s + this._rowPatientResp(r), 0);
		// Coinsurance balances carried to the secondary payer — INSURANCE
		// pending, deliberately not part of the Patient Resp card.
		const sumPendingCoins = this._insRows.filter(r => r.status === 'AWAITING_SECONDARY')
			.reduce((s, r) => s + r.coinsurance, 0);
		const awaiting = this._insRows.filter(r => r.status === 'AWAITING_EOB').length;
		const denials = this._insRows.filter(r => r.status === 'DENIAL').length;
		const cards = DOM.append(this.contentEl, DOM.$('div'));
		cards.style.cssText = 'display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap;';
		const card = (label: string, value: string, color: string, filter?: InsurancePostingRow['status']) => {
			const c = DOM.append(cards, DOM.$('div'));
			c.style.cssText = `flex:0 0 170px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:12px 16px;text-align:center;${filter ? 'cursor:pointer;' : ''}`;
			const v = DOM.append(c, DOM.$('div')); v.textContent = value; v.style.cssText = `font-size:20px;font-weight:700;color:${color};`;
			const l = DOM.append(c, DOM.$('div')); l.textContent = label; l.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';
			if (filter) {
				c.addEventListener('click', () => { this._insStatusFilter = this._insStatusFilter === filter ? '' : filter; this._renderInsurancePosting(); });
				if (this._insStatusFilter === filter) { c.style.borderColor = color; c.style.background = `${color}14`; }
			}
		};
		card('Awaiting EOB', String(awaiting), '#f59e0b', 'AWAITING_EOB');
		card('Postings', String(posted.length), 'var(--vscode-foreground)');
		card('Insurance Paid', money(sumPaid), '#3b9edd');
		card('Insurance Pending', money(sumPendingCoins), '#8b5cf6', 'AWAITING_SECONDARY');
		card('Patient Resp', money(sumResp), '#f59e0b');
		card('Denials', String(denials), '#ef4444', 'DENIAL');

		// Search — same row (directly below the summary cards, above the table)
		// as every other Payments page (Dashboard, Patient Balance, Ledger). This
		// used to sit in the top toolbar next to Refresh, the only one of the
		// four in a different spot (QA: "same place across all 4 payment
		// section pages").
		const tb = DOM.append(this.contentEl, DOM.$('div'));
		tb.style.cssText = 'display:flex;margin-bottom:12px;';
		const searchEl = DOM.append(tb, DOM.$('input')) as HTMLInputElement;
		searchEl.placeholder = 'Search by patient, claim, CPT, check #...';
		searchEl.value = this._insSearch;
		searchEl.style.cssText = 'flex:0 0 560px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;';
		searchEl.addEventListener('input', () => { this._insSearch = searchEl.value; this._renderInsuranceRows(scroll); });

		const scroll = DOM.append(this.contentEl, DOM.$('div'));
		scroll.style.cssText = 'flex:1;min-height:0;overflow:auto;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';
		this._renderInsuranceRows(scroll);
	}

	private _renderInsuranceRows(scroll: HTMLElement): void {
		DOM.clearNode(scroll);
		const COLS = '28px minmax(110px,1.2fr) 90px minmax(130px,1.2fr) 105px 90px 90px 95px 115px 130px';
		const header = DOM.append(scroll, DOM.$('div'));
		header.style.cssText = `display:grid;grid-template-columns:${COLS};gap:8px;padding:9px 12px;position:sticky;top:0;background:var(--vscode-editor-background);border-bottom:2px solid var(--vscode-editorWidget-border);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);z-index:1;`;
		for (const h of ['', 'Patient', 'Claim #', 'CPT Codes', 'Date of Service', 'Billed', 'Ins Paid', 'Patient Resp', 'Status', 'Action']) {
			DOM.append(header, DOM.$('span')).textContent = h;
		}

		if (this._insLoading) {
			const l = DOM.append(scroll, DOM.$('div'));
			l.textContent = 'Loading…'; l.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;';
			return;
		}
		const rows = this._visibleInsRows();
		if (rows.length === 0) {
			const e = DOM.append(scroll, DOM.$('div'));
			e.textContent = 'No claims to post yet. Bill a fee sheet (Dashboard → Send to Billing) and its claim shows here awaiting the payer EOB.';
			e.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;';
			return;
		}
		for (const row of rows) { this._renderInsuranceRow(scroll, row, COLS); }
	}

	private _renderInsuranceRow(scroll: HTMLElement, row: InsurancePostingRow, COLS: string): void {
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const expanded = this._insExpanded.has(normalizeClaimRef(row.claimRef));
		const billedTotal = row.lines.reduce((s, l) => s + l.billed, 0);
		const paidTotal = row.lines.reduce((s, l) => s + l.paid, 0) + this._rowSecPaid(row);
		// Pending coinsurance is NOT patient responsibility — it shows as a
		// Co-Ins badge on the status instead until the secondary EOB posts.
		const respTotal = this._rowPatientResp(row);

		const r = DOM.append(scroll, DOM.$('div'));
		r.style.cssText = `display:grid;grid-template-columns:${COLS};gap:8px;align-items:center;padding:8px 12px;border-top:1px solid rgba(128,128,128,0.1);font-size:12px;${expanded ? 'background:rgba(59,158,221,0.05);' : ''}`;

		// Expand caret.
		const caret = DOM.append(r, DOM.$('span'));
		caret.textContent = expanded ? '\u25BC' : '\u25B6';
		caret.style.cssText = 'cursor:pointer;color:var(--vscode-descriptionForeground);font-size:11px;user-select:none;text-align:center;';
		const toggle = () => {
			const key = normalizeClaimRef(row.claimRef);
			if (this._insExpanded.has(key)) { this._insExpanded.delete(key); } else { this._insExpanded.add(key); }
			this._renderInsuranceRows(scroll);
		};
		caret.addEventListener('click', toggle);

		const nameEl = DOM.append(r, DOM.$('span'));
		nameEl.textContent = row.patientName || `Patient #${row.patientId}`;
		nameEl.style.cssText = 'font-weight:500;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		nameEl.addEventListener('click', toggle);

		const claimEl = DOM.append(r, DOM.$('span'));
		claimEl.textContent = row.claimRef || '—';
		claimEl.style.cssText = 'font-family:var(--vscode-editor-font-family,monospace);font-size:11px;';

		// CPT codes cell: 2 inline + "+N more" (NO popup — clicking expands
		// the row so every code becomes an editable line).
		const codesEl = DOM.append(r, DOM.$('span'));
		codesEl.style.cssText = 'cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const codes = row.lines.map(l => l.code);
		if (codes.length <= 2 || expanded) {
			codesEl.textContent = codes.join(', ') || '—';
		} else {
			codesEl.textContent = `${codes.slice(0, 2).join(', ')} `;
			const more = DOM.append(codesEl, DOM.$('span'));
			more.textContent = `+${codes.length - 2} more`;
			more.style.cssText = 'color:#3b9edd;font-weight:600;';
		}
		codesEl.title = codes.join(', ');
		codesEl.addEventListener('click', toggle);

		// Date of service — the completed appointment's date (MM/DD/YYYY).
		const dosEl = DOM.append(r, DOM.$('span'));
		dosEl.textContent = row.serviceDate ? isoToUsDate(row.serviceDate) : '—';
		dosEl.style.cssText = 'font-size:11px;';

		DOM.append(r, DOM.$('span')).textContent = money(billedTotal);
		const insEl = DOM.append(r, DOM.$('span'));
		insEl.textContent = row.status === 'AWAITING_EOB' ? '—' : money(paidTotal);
		insEl.style.color = row.status === 'AWAITING_EOB' ? 'var(--vscode-descriptionForeground)' : '#3b9edd';
		const respEl = DOM.append(r, DOM.$('span'));
		respEl.textContent = respTotal > 0 ? money(respTotal) : '—';
		respEl.style.color = respTotal > 0 ? '#f59e0b' : 'var(--vscode-descriptionForeground)';

		const statusEl = DOM.append(r, DOM.$('span'));
		const statusMeta: Record<InsurancePostingRow['status'], [string, string]> = {
			AWAITING_EOB: ['Awaiting EOB', '#f59e0b'], POSTED: ['Posted', '#22c55e'],
			DENIAL: ['Denial', '#ef4444'], AWAITING_SECONDARY: ['Insurance Pending', '#8b5cf6'],
		};
		const [stLabel, stColor] = statusMeta[row.status];
		statusEl.textContent = stLabel;
		statusEl.style.cssText = `color:${stColor};font-weight:600;`;
		if (row.status === 'AWAITING_SECONDARY' && row.coinsurance > 0) {
			// The carried coinsurance shows right next to the status (team
			// design: "Insurance Pending" + "Co-Ins: $20.00").
			const coinsBadge = DOM.append(statusEl, DOM.$('div'));
			coinsBadge.textContent = `Co-Ins: ${money(row.coinsurance)}`;
			coinsBadge.style.cssText = 'font-size:10px;font-weight:600;color:#8b5cf6;opacity:0.9;';
		}

		const act = DOM.append(r, DOM.$('div'));
		act.style.cssText = 'display:flex;gap:6px;align-items:center;';
		const actBtn = (label: string, color: string, handler: () => void) => {
			const b = DOM.append(act, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			b.style.cssText = `padding:4px 10px;background:${color};color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px;font-weight:600;`;
			b.addEventListener('click', handler);
		};
		// No "Collapse" action button (team request) — the caret / patient name /
		// codes cell all collapse an expanded row.
		if (!expanded) {
			const [actLabel, actColor] = row.status === 'AWAITING_EOB' ? ['Post EOB', '#22c55e']
				: row.status === 'AWAITING_SECONDARY' ? ['Post 2nd EOB', '#8b5cf6']
					: ['Edit', '#0e639c'];
			actBtn(actLabel, actColor, toggle);
		}
		if (row.txnId) {
			actBtn('Delete', '#a11', async () => {
				const c = await this.dialogService.confirm({ message: 'Delete this insurance posting?', type: 'warning', primaryButton: 'Delete' });
				if (c.confirmed) { await this.apiService.fetch(`/api/payments/transactions/${row.txnId}`, { method: 'DELETE' }); this._loadAndRenderInsurancePosting(); }
			});
		}

		if (expanded) { this._renderInsuranceExpansion(scroll, row); }
	}

	/**
	 * The inline expansion: one editable row per CPT code with SEVEN amount
	 * inputs — Billed / Allowed / Ins Paid / Copay / Deductible / Coinsurance /
	 * Write-off (plain text boxes, no number-input spinners; the write-off
	 * auto-fills from billed - allowed until the biller overrides it) — plus
	 * mandatory Payer + Check #, Denial, EOB document attachments, live
	 * totals, and a Post/Save button — all inside the grid, no popup. The
	 * claim-level responsibility figures are the per-line sums, and a claim
	 * whose primary EOB carries coinsurance also grows a secondary-EOB entry
	 * (see _renderSecondaryEobSection).
	 */
	private _renderInsuranceExpansion(scroll: HTMLElement, row: InsurancePostingRow): void {
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const round2 = (n: number) => Math.round(n * 100) / 100;
		const wrap = DOM.append(scroll, DOM.$('div'));
		wrap.style.cssText = 'padding:10px 14px 16px 40px;border-top:1px solid rgba(128,128,128,0.06);background:rgba(59,158,221,0.04);';

		const inputStyle = 'width:100%;box-sizing:border-box;padding:5px 7px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
		// Plain TEXT inputs (inputmode=decimal) — the team does not want the
		// number-input increment/decrement spinners. Input is sanitized to
		// digits + a single decimal point.
		const numInput = (val: number, onInput: (n: number) => void): HTMLInputElement => {
			const inp = DOM.append(DOM.$('span'), DOM.$('input')) as HTMLInputElement;
			inp.type = 'text';
			inp.inputMode = 'decimal';
			inp.autocomplete = 'off';
			inp.placeholder = '0.00';
			inp.value = val ? String(val) : '';
			inp.style.cssText = inputStyle + 'text-align:right;';
			inp.addEventListener('input', () => {
				const clean = inp.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
				if (inp.value !== clean) { inp.value = clean; }
				onInput(Number(inp.value) || 0);
				recompute();
			});
			return inp;
		};

		// Per-CPT lines table — every code carries its own 6-figure EOB entry.
		const heading = DOM.append(wrap, DOM.$('div'));
		heading.textContent = `Enter the payer EOB amounts ($) for each of the ${row.lines.length} CPT code${row.lines.length === 1 ? '' : 's'}:`;
		heading.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--vscode-descriptionForeground);margin-bottom:6px;';

		const LCOLS = '70px minmax(110px,1fr) repeat(7, minmax(70px, 92px))';
		const linesBox = DOM.append(wrap, DOM.$('div'));
		linesBox.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;background:var(--vscode-editor-background);';
		const lineHead = DOM.append(linesBox, DOM.$('div'));
		lineHead.style.cssText = `display:grid;grid-template-columns:${LCOLS};gap:8px;padding:6px 10px;background:rgba(59,158,221,0.08);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--vscode-descriptionForeground);`;
		for (const h of ['CPT', 'Description', 'Billed', 'Allowed', 'Ins Paid', 'Copay', 'Deductible', 'Coinsurance', 'Write-off']) { DOM.append(lineHead, DOM.$('span')).textContent = h; }

		for (const line of row.lines) {
			const lr = DOM.append(linesBox, DOM.$('div'));
			lr.style.cssText = `display:grid;grid-template-columns:${LCOLS};gap:8px;padding:5px 10px;align-items:center;border-top:1px solid rgba(128,128,128,0.08);`;
			const codeEl = DOM.append(lr, DOM.$('span')); codeEl.textContent = line.code; codeEl.style.cssText = 'font-weight:600;font-family:var(--vscode-editor-font-family,monospace);';
			const descEl = DOM.append(lr, DOM.$('span')); descEl.textContent = line.description || ''; descEl.title = line.description || ''; descEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			// The per-code write-off auto-fills from billed - allowed while the
			// biller types those figures; an explicit entry stops the auto-sync.
			let woManual = line.writeOff !== undefined;
			const woInp = numInput(lineWriteOff(line), n => { line.writeOff = n; woManual = true; });
			const syncWriteOff = () => {
				if (woManual) { return; }
				const w = line.allowed > 0 ? Math.max(round2(line.billed - line.allowed), 0) : 0;
				line.writeOff = w;
				woInp.value = w ? String(w) : '';
			};
			lr.appendChild(numInput(line.billed, n => { line.billed = n; syncWriteOff(); }).parentElement!);
			lr.appendChild(numInput(line.allowed, n => { line.allowed = n; syncWriteOff(); }).parentElement!);
			lr.appendChild(numInput(line.paid, n => { line.paid = n; }).parentElement!);
			lr.appendChild(numInput(line.copay || 0, n => { line.copay = n; }).parentElement!);
			lr.appendChild(numInput(line.deductible || 0, n => { line.deductible = n; }).parentElement!);
			lr.appendChild(numInput(line.coinsurance || 0, n => { line.coinsurance = n; }).parentElement!);
			lr.appendChild(woInp.parentElement!);
		}

		const field = (parent: HTMLElement, label: string, required = false): HTMLElement => {
			const cell = DOM.append(parent, DOM.$('div'));
			const l = DOM.append(cell, DOM.$('label')); l.textContent = label;
			l.style.cssText = 'display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
			if (required) {
				const star = DOM.append(l, DOM.$('span'));
				star.textContent = ' *';
				star.style.cssText = 'color:#ef4444;';
			}
			return cell;
		};

		const metaRow = DOM.append(wrap, DOM.$('div'));
		metaRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;margin-top:10px;';
		// Payer + Check / EFT # are MANDATORY (team request) — starred labels
		// and hard-validated before posting.
		const payerInp = DOM.append(field(metaRow, 'Insurance / Payer', true), DOM.$('input')) as HTMLInputElement;
		payerInp.value = row.payerName; payerInp.placeholder = 'e.g. Medicare, BCBS'; payerInp.style.cssText = inputStyle;
		payerInp.addEventListener('input', () => { row.payerName = payerInp.value; });
		const checkInp = DOM.append(field(metaRow, 'Check / EFT #', true), DOM.$('input')) as HTMLInputElement;
		checkInp.value = row.checkNumber; checkInp.placeholder = 'Check # from EOB'; checkInp.style.cssText = inputStyle;
		checkInp.addEventListener('input', () => { row.checkNumber = checkInp.value; });
		const denialInp = DOM.append(field(metaRow, 'Denial Reason (if denied)'), DOM.$('input')) as HTMLInputElement;
		denialInp.value = row.denialReason; denialInp.placeholder = 'e.g. CO-97 bundled'; denialInp.style.cssText = inputStyle;
		denialInp.addEventListener('input', () => { row.denialReason = denialInp.value; });

		// EOB documents — upload stores the file on the patient's chart
		// (Documents page, FHIR DocumentReference tagged with the claim #), and
		// every document attached to this claim is listed here for viewing.
		const docsWrap = DOM.append(wrap, DOM.$('div'));
		docsWrap.style.cssText = 'margin-top:12px;';
		const docsHead = DOM.append(docsWrap, DOM.$('div'));
		docsHead.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:6px;';
		const docsLbl = DOM.append(docsHead, DOM.$('span'));
		docsLbl.textContent = 'EOB Documents';
		docsLbl.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--vscode-descriptionForeground);';
		const attachBtn = DOM.append(docsHead, DOM.$('button')) as HTMLButtonElement;
		attachBtn.textContent = '\u{1F4CE} Attach Document';
		attachBtn.title = 'Upload an EOB document (PDF, JPG, PNG, …) — it is stored on the patient chart Documents page';
		attachBtn.style.cssText = 'padding:4px 12px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:5px;cursor:pointer;font-size:11px;font-weight:600;';
		const fileInp = DOM.append(docsHead, DOM.$('input')) as HTMLInputElement;
		fileInp.type = 'file';
		fileInp.accept = '.pdf,.jpg,.jpeg,.png,.gif,.tif,.tiff,.doc,.docx,.txt';
		fileInp.style.display = 'none';
		attachBtn.addEventListener('click', () => fileInp.click());
		// Inline upload status — dialogService here is a NATIVE dialog that
		// blocks the renderer, so success/failure reports stay in the pane.
		const uploadStatus = DOM.append(docsHead, DOM.$('span'));
		uploadStatus.style.cssText = 'font-size:11px;';
		const docsList = DOM.append(docsWrap, DOM.$('div'));
		docsList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;';
		this._renderEobDocsList(docsList, row);
		fileInp.addEventListener('change', async () => {
			const file = fileInp.files && fileInp.files[0];
			fileInp.value = '';
			if (!file) { return; }
			attachBtn.disabled = true;
			attachBtn.textContent = 'Uploading…';
			uploadStatus.textContent = '';
			const ok = await this._uploadEobDocument(row, file);
			attachBtn.disabled = false;
			attachBtn.textContent = '\u{1F4CE} Attach Document';
			if (!ok) {
				uploadStatus.textContent = `Upload of "${file.name}" failed.`;
				uploadStatus.style.color = 'var(--vscode-errorForeground,#f48771)';
				return;
			}
			// allow-any-unicode-next-line
			uploadStatus.textContent = `✓ "${file.name}" saved to the patient chart Documents page.`;
			uploadStatus.style.color = '#22c55e';
			this._renderEobDocsList(docsList, row);
		});

		// Live totals + Post button.
		const footer = DOM.append(wrap, DOM.$('div'));
		footer.style.cssText = 'display:flex;align-items:center;gap:20px;margin-top:14px;flex-wrap:wrap;';
		const totalsEl = DOM.append(footer, DOM.$('div'));
		totalsEl.style.cssText = 'display:flex;gap:18px;font-size:12px;flex-wrap:wrap;';
		const spacer = DOM.append(footer, DOM.$('div')); spacer.style.flex = '1';
		const postBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		postBtn.textContent = row.txnId ? 'Save Posting' : 'Post EOB';
		postBtn.style.cssText = 'padding:7px 20px;background:#2e7d32;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:700;';
		// Inline validation message — dialogService dialogs are native and
		// block the renderer, so validation stays in the pane.
		const errEl = DOM.append(wrap, DOM.$('div'));
		errEl.style.cssText = 'display:none;margin-top:8px;font-size:12px;font-weight:600;color:var(--vscode-errorForeground,#f48771);';
		const fail = (msg: string, focusEl?: HTMLElement): void => {
			errEl.textContent = msg;
			errEl.style.display = 'block';
			focusEl?.focus();
		};

		const recompute = () => {
			const billed = round2(row.lines.reduce((s, l) => s + l.billed, 0));
			const allowed = round2(row.lines.reduce((s, l) => s + l.allowed, 0));
			const paid = round2(row.lines.reduce((s, l) => s + l.paid, 0));
			// The claim-level responsibility figures ARE the per-line sums - they
			// feed the posting description and the pending patient-pay record.
			row.copay = round2(row.lines.reduce((s, l) => s + (l.copay || 0), 0));
			row.deductible = round2(row.lines.reduce((s, l) => s + (l.deductible || 0), 0));
			row.coinsurance = round2(row.lines.reduce((s, l) => s + (l.coinsurance || 0), 0));
			const writeOff = round2(row.lines.reduce((s, l) => s + lineWriteOff(l), 0));
			// Coinsurance is carried to the secondary payer \u2014 the patient owes
			// only copay + deductible at primary-posting time.
			const resp = round2(row.copay + row.deductible);
			DOM.clearNode(totalsEl);
			const cell = (label: string, val: string, color?: string) => {
				const c = DOM.append(totalsEl, DOM.$('div'));
				const l = DOM.append(c, DOM.$('div')); l.textContent = label; l.style.cssText = 'font-size:9px;font-weight:700;text-transform:uppercase;color:var(--vscode-descriptionForeground);';
				const v = DOM.append(c, DOM.$('div')); v.textContent = val; v.style.cssText = `font-size:14px;font-weight:700;${color ? `color:${color};` : ''}`;
			};
			cell('Billed', money(billed)); cell('Allowed', money(allowed)); cell('Ins Paid', money(paid), '#3b9edd');
			cell('Write-off', money(writeOff), '#8b5cf6');
			cell('Copay', money(row.copay), '#f59e0b'); cell('Deductible', money(row.deductible), '#f59e0b');
			// allow-any-unicode-next-line
			cell('Coinsurance \u2192 2nd Ins', money(row.coinsurance), '#8b5cf6');
			cell('Patient Resp', money(resp), '#f59e0b');
			const diff = round2(allowed - (paid + resp + row.coinsurance));
			if (allowed || paid || resp || row.coinsurance) {
				const bal = DOM.append(totalsEl, DOM.$('div'));
				bal.style.cssText = 'align-self:center;font-size:11px;';
				if (Math.abs(diff) <= 0.01) { bal.textContent = '\u2713 Balanced'; bal.style.color = '#22c55e'; }
				else { bal.textContent = `\u26A0 off by ${money(Math.abs(diff))}`; bal.style.color = '#f59e0b'; }
			}
		};
		recompute();

		postBtn.addEventListener('click', async () => {
			const billed = round2(row.lines.reduce((s, l) => s + l.billed, 0));
			const allowed = round2(row.lines.reduce((s, l) => s + l.allowed, 0));
			const paid = round2(row.lines.reduce((s, l) => s + l.paid, 0));
			const resp = round2(row.copay + row.deductible + row.coinsurance);
			errEl.style.display = 'none';
			if (billed <= 0) { fail('Enter the billed amounts before posting.'); return; }
			// Payer + check number are mandatory — every EOB posting must carry
			// the payer and the check/EFT it was paid with (team request).
			if (!row.payerName.trim()) { fail('Insurance / Payer is required.', payerInp); return; }
			if (!row.checkNumber.trim()) { fail('The check / EFT number from the EOB is required.', checkInp); return; }
			if (paid <= 0 && !row.denialReason.trim() && resp <= 0) {
				fail('A zero-pay EOB needs a denial reason (or a patient-responsibility amount).', denialInp);
				return;
			}
			postBtn.disabled = true; postBtn.textContent = 'Posting…';
			const values: EobFormValues = {
				claimRef: row.claimRef, patientId: row.patientId, patientName: row.patientName,
				// Carries the date of service onto the patient's statement email.
				serviceDate: row.serviceDate,
				payerName: row.payerName, checkNumber: row.checkNumber, paymentMethodType: row.paymentMethodType || 'check',
				billed, allowed, paid, copay: row.copay, deductible: row.deductible, coinsurance: row.coinsurance,
				denialReason: row.denialReason, forwardedToSecondary: row.forwardedToSecondary, secondaryPayer: row.secondaryPayer,
				lines: row.lines.map(l => ({ ...l })),
			};
			// Re-saving the primary must not drop an already-stored secondary EOB.
			const secSuffix = (row.secPosted || row.secPayer || row.secCheck)
				? secondaryEobSegment(row.secPayer, row.secCheck, row.secDate, row.secPosted, row.secLines)
				: undefined;
			this._insExpanded.delete(normalizeClaimRef(row.claimRef));
			await this._saveEobPosting(values, row.txnId || undefined, secSuffix);
		});

		// Secondary-payer EOB block — pre-generated the moment the primary EOB
		// leaves a coinsurance balance on a posted claim.
		if (row.txnId && (row.secPosted || row.lines.some(l => (l.coinsurance || 0) > 0))) {
			this._renderSecondaryEobSection(wrap, row);
		}
	}

	/**
	 * Secondary-payer EOB block inside the expansion. A primary EOB that
	 * leaves a coinsurance balance does NOT close the claim — the amount is
	 * carried to the patient's secondary insurance and shows as "Insurance
	 * Pending" (an insurance balance, not patient responsibility). This
	 * pre-generated entry lists exactly those CPT codes with their carried
	 * amounts; the biller enters the secondary payer / check # / figures when
	 * that EOB arrives and posts it — only then does the claim close, and only
	 * the unpaid remainder becomes patient responsibility.
	 */
	private _renderSecondaryEobSection(wrap: HTMLElement, row: InsurancePostingRow): void {
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const round2 = (n: number) => Math.round(n * 100) / 100;
		const box = DOM.append(wrap, DOM.$('div'));
		box.style.cssText = 'margin-top:16px;border:1px solid rgba(139,92,246,0.45);border-radius:6px;padding:12px 14px;background:rgba(139,92,246,0.06);';
		const head = DOM.append(box, DOM.$('div'));
		head.textContent = row.secPosted ? 'Secondary Insurance EOB — Posted' : 'Secondary Insurance EOB — Pending';
		head.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#8b5cf6;margin-bottom:8px;';

		if (row.secPosted) {
			const paid = round2(row.secLines.reduce((s, l) => s + l.paid, 0));
			const adj = round2(row.secLines.reduce((s, l) => s + l.writeOff, 0));
			const rem = this._rowSecRemainder(row);
			// The one-line summary is a toggle: clicking it opens the full
			// read-only breakdown of what was posted to the secondary payer
			// (per-CPT figures + payer/check/date), so the biller can review a
			// closed claim without digging into the transaction record.
			const key = normalizeClaimRef(row.claimRef);
			const sum = DOM.append(box, DOM.$('div'));
			sum.style.cssText = 'font-size:12px;color:#22c55e;cursor:pointer;display:flex;align-items:flex-start;gap:6px;';
			sum.title = 'Click to show / hide the full secondary EOB breakdown';
			const caret = DOM.append(sum, DOM.$('span'));
			caret.style.cssText = 'flex:0 0 auto;font-size:10px;line-height:16px;';
			const sumText = DOM.append(sum, DOM.$('span'));
			// allow-any-unicode-next-line
			sumText.textContent = `✓ Posted — payer ${row.secPayer || '—'}, check ${row.secCheck || '—'}${row.secDate ? `, received ${row.secDate}` : ''}. Secondary paid ${money(paid)}, adjustments ${money(adj)}, patient responsibility ${money(rem)}. The claim is closed.`;

			const details = DOM.append(box, DOM.$('div'));
			details.style.cssText = 'margin-top:10px;';
			this._renderPostedSecondaryDetails(details, row);
			const applyExpanded = () => {
				const open = this._secExpanded.has(key);
				// allow-any-unicode-next-line
				caret.textContent = open ? '▼' : '▶';
				details.style.display = open ? 'block' : 'none';
			};
			applyExpanded();
			sum.addEventListener('click', () => {
				if (this._secExpanded.has(key)) { this._secExpanded.delete(key); } else { this._secExpanded.add(key); }
				applyExpanded();
			});
			return;
		}

		// Seed / refresh the pending entry from the primary lines that carry a
		// coinsurance balance, keeping figures already typed for matching codes.
		// The BILLED amount to the secondary payer IS the carried coinsurance.
		const carried = row.lines.filter(l => (l.coinsurance || 0) > 0);
		row.secLines = carried.map(l => {
			const prev = row.secLines.find(s => s.code === l.code);
			const carriedAmt = l.coinsurance || 0;
			return {
				code: l.code, carried: carriedAmt,
				billed: prev?.billed || carriedAmt,
				allowed: prev?.allowed || 0,
				paid: prev?.paid || 0,
				copay: prev?.copay || 0, deductible: prev?.deductible || 0, coinsurance: prev?.coinsurance || 0,
				writeOff: prev?.writeOff || 0,
			};
		});
		const carriedTotal = round2(row.secLines.reduce((s, l) => s + l.carried, 0));

		const info = DOM.append(box, DOM.$('div'));
		info.textContent = `${money(carriedTotal)} coinsurance from the primary EOB is pending with the patient's secondary insurance — it is an insurance balance, NOT patient responsibility. When the secondary EOB arrives, enter its full figures for these exact codes below (Billed is prefilled with the carried coinsurance amount) and post: the claim closes and only the unpaid remainder bills to the patient.`;
		info.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:10px;';

		const inputStyle = 'width:100%;box-sizing:border-box;padding:5px 7px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
		// Live per-line "Patient Owes" cells + secondary claim totals.
		const oweCells = new Map<string, HTMLElement>();
		const secTotalsEl = DOM.append(box, DOM.$('div'));
		const refreshSecTotals = () => {
			for (const l of row.secLines) {
				const c = oweCells.get(l.code);
				if (c) { c.textContent = money(secondaryLineOwes(l)); }
			}
			const billed = round2(row.secLines.reduce((s, l) => s + l.billed, 0));
			const allowed = round2(row.secLines.reduce((s, l) => s + l.allowed, 0));
			const paid = round2(row.secLines.reduce((s, l) => s + l.paid, 0));
			const wo = round2(row.secLines.reduce((s, l) => s + l.writeOff, 0));
			const owes = round2(row.secLines.reduce((s, l) => s + secondaryLineOwes(l), 0));
			secTotalsEl.textContent = `Secondary totals: billed ${money(billed)}, allowed ${money(allowed)}, paid ${money(paid)}, write-off ${money(wo)} — patient owes ${money(owes)} after posting.`;
		};
		const mkNum = (parent: HTMLElement, val: number, onInput: (n: number) => void): HTMLInputElement => {
			const inp = DOM.append(parent, DOM.$('input')) as HTMLInputElement;
			inp.type = 'text';
			inp.inputMode = 'decimal';
			inp.autocomplete = 'off';
			inp.placeholder = '0.00';
			inp.value = val ? String(val) : '';
			inp.style.cssText = inputStyle + 'text-align:right;';
			inp.addEventListener('input', () => {
				const clean = inp.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
				if (inp.value !== clean) { inp.value = clean; }
				onInput(Number(inp.value) || 0);
				refreshSecTotals();
			});
			return inp;
		};

		// Full EOB columns for the exact carried codes — the same shape as the
		// primary entry (Billed = coinsurance amount, Allowed, Ins Paid, Copay,
		// Deductible, Coinsurance, Write-off) plus a live Patient Owes cell.
		const SCOLS = '70px repeat(7, minmax(66px, 88px)) minmax(80px, 100px)';
		const grid = DOM.append(box, DOM.$('div'));
		grid.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;background:var(--vscode-editor-background);';
		const gHead = DOM.append(grid, DOM.$('div'));
		gHead.style.cssText = `display:grid;grid-template-columns:${SCOLS};gap:8px;padding:6px 10px;background:rgba(139,92,246,0.10);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--vscode-descriptionForeground);`;
		for (const h of ['CPT', 'Billed', 'Allowed', 'Ins Paid', 'Copay', 'Deductible', 'Coinsurance', 'Write-off', 'Patient Owes']) { DOM.append(gHead, DOM.$('span')).textContent = h; }
		for (const l of row.secLines) {
			const gr = DOM.append(grid, DOM.$('div'));
			gr.style.cssText = `display:grid;grid-template-columns:${SCOLS};gap:8px;padding:5px 10px;align-items:center;border-top:1px solid rgba(128,128,128,0.08);`;
			const codeEl = DOM.append(gr, DOM.$('span'));
			codeEl.textContent = l.code;
			codeEl.title = `Carried coinsurance from the primary EOB: ${money(l.carried)}`;
			codeEl.style.cssText = 'font-weight:600;font-family:var(--vscode-editor-font-family,monospace);';
			// Write-off auto-fills billed - allowed until explicitly overridden
			// (same behaviour as the primary lines).
			let woManual = l.writeOff > 0;
			const woInp = mkNum(DOM.$('span'), l.writeOff, n => { l.writeOff = n; woManual = true; });
			const syncWo = () => {
				if (woManual) { return; }
				const w = l.allowed > 0 ? Math.max(round2(l.billed - l.allowed), 0) : 0;
				l.writeOff = w;
				woInp.value = w ? String(w) : '';
			};
			gr.appendChild(mkNum(DOM.$('span'), l.billed, n => { l.billed = n; syncWo(); }).parentElement!);
			gr.appendChild(mkNum(DOM.$('span'), l.allowed, n => { l.allowed = n; syncWo(); }).parentElement!);
			gr.appendChild(mkNum(DOM.$('span'), l.paid, n => { l.paid = n; }).parentElement!);
			gr.appendChild(mkNum(DOM.$('span'), l.copay, n => { l.copay = n; }).parentElement!);
			gr.appendChild(mkNum(DOM.$('span'), l.deductible, n => { l.deductible = n; }).parentElement!);
			gr.appendChild(mkNum(DOM.$('span'), l.coinsurance, n => { l.coinsurance = n; }).parentElement!);
			gr.appendChild(woInp.parentElement!);
			const oweEl = DOM.append(gr, DOM.$('span'));
			oweEl.style.cssText = 'font-size:12px;color:#f59e0b;font-weight:600;text-align:right;';
			oweCells.set(l.code, oweEl);
		}
		secTotalsEl.style.cssText = 'margin-top:8px;font-size:11px;color:var(--vscode-descriptionForeground);';
		refreshSecTotals();

		const sField = (parent: HTMLElement, label: string, required = false): HTMLElement => {
			const cell = DOM.append(parent, DOM.$('div'));
			const lb = DOM.append(cell, DOM.$('label')); lb.textContent = label;
			lb.style.cssText = 'display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
			if (required) {
				const star = DOM.append(lb, DOM.$('span'));
				star.textContent = ' *';
				star.style.cssText = 'color:#ef4444;';
			}
			return cell;
		};
		const meta = DOM.append(box, DOM.$('div'));
		meta.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;margin-top:10px;';
		const sPayerInp = DOM.append(sField(meta, 'Secondary Payer', true), DOM.$('input')) as HTMLInputElement;
		sPayerInp.value = row.secPayer; sPayerInp.placeholder = 'e.g. UnitedHealthcare'; sPayerInp.style.cssText = inputStyle;
		sPayerInp.addEventListener('input', () => { row.secPayer = sPayerInp.value; });
		const sCheckInp = DOM.append(sField(meta, 'Check / EFT #', true), DOM.$('input')) as HTMLInputElement;
		sCheckInp.value = row.secCheck; sCheckInp.placeholder = 'Check # from secondary EOB'; sCheckInp.style.cssText = inputStyle;
		sCheckInp.addEventListener('input', () => { row.secCheck = sCheckInp.value; });
		const sDateInp = DOM.append(sField(meta, 'Date Received'), DOM.$('input')) as HTMLInputElement;
		sDateInp.value = row.secDate; sDateInp.placeholder = 'MM/DD/YYYY'; sDateInp.style.cssText = inputStyle;
		sDateInp.addEventListener('input', () => { row.secDate = sDateInp.value; });

		const foot = DOM.append(box, DOM.$('div'));
		foot.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px;';
		const postSecBtn = DOM.append(foot, DOM.$('button')) as HTMLButtonElement;
		postSecBtn.textContent = 'Post Secondary EOB';
		postSecBtn.style.cssText = 'padding:7px 20px;background:#8b5cf6;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:700;';
		// Inline validation — dialogService dialogs are native and block the renderer.
		const secErrEl = DOM.append(box, DOM.$('div'));
		secErrEl.style.cssText = 'display:none;margin-top:8px;font-size:12px;font-weight:600;color:var(--vscode-errorForeground,#f48771);';
		const secFail = (msg: string, focusEl?: HTMLElement): void => {
			secErrEl.textContent = msg;
			secErrEl.style.display = 'block';
			focusEl?.focus();
		};
		postSecBtn.addEventListener('click', async () => {
			secErrEl.style.display = 'none';
			if (!row.secPayer.trim()) { secFail('Secondary Payer is required.', sPayerInp); return; }
			if (!row.secCheck.trim()) { secFail('The check / EFT number from the secondary EOB is required.', sCheckInp); return; }
			postSecBtn.disabled = true; postSecBtn.textContent = 'Posting…';
			await this._postSecondaryEob(row);
		});
	}

	/**
	 * Read-only breakdown of an already-posted secondary EOB, revealed when the
	 * biller clicks the posted summary line. Shows the payer / check / date it
	 * was posted with and every CPT code's full figures (carried coinsurance,
	 * billed, allowed, paid, copay, deductible, coinsurance, write-off and the
	 * resulting patient responsibility) plus the claim totals.
	 */
	private _renderPostedSecondaryDetails(host: HTMLElement, row: InsurancePostingRow): void {
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const round2 = (n: number) => Math.round(n * 100) / 100;

		const meta = DOM.append(host, DOM.$('div'));
		meta.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;margin-bottom:10px;';
		const metaCell = (label: string, value: string) => {
			const c = DOM.append(meta, DOM.$('div'));
			const l = DOM.append(c, DOM.$('div')); l.textContent = label;
			l.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--vscode-descriptionForeground);margin-bottom:2px;';
			const v = DOM.append(c, DOM.$('div')); v.textContent = value;
			v.style.cssText = 'font-size:12px;font-weight:600;';
		};
		// allow-any-unicode-next-line
		metaCell('Secondary Payer', row.secPayer || '—');
		// allow-any-unicode-next-line
		metaCell('Check / EFT #', row.secCheck || '—');
		// allow-any-unicode-next-line
		metaCell('Date Received', row.secDate || '—');

		const SCOLS = '70px repeat(8, minmax(66px, 92px))';
		const grid = DOM.append(host, DOM.$('div'));
		grid.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;background:var(--vscode-editor-background);';
		const gHead = DOM.append(grid, DOM.$('div'));
		gHead.style.cssText = `display:grid;grid-template-columns:${SCOLS};gap:8px;padding:6px 10px;background:rgba(139,92,246,0.10);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--vscode-descriptionForeground);`;
		for (const h of ['CPT', 'Carried', 'Billed', 'Allowed', 'Ins Paid', 'Copay', 'Deductible', 'Write-off', 'Patient Owes']) { DOM.append(gHead, DOM.$('span')).textContent = h; }
		for (const l of row.secLines) {
			const gr = DOM.append(grid, DOM.$('div'));
			gr.style.cssText = `display:grid;grid-template-columns:${SCOLS};gap:8px;padding:5px 10px;align-items:center;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;`;
			const codeEl = DOM.append(gr, DOM.$('span'));
			codeEl.textContent = l.code;
			codeEl.style.cssText = 'font-weight:600;font-family:var(--vscode-editor-font-family,monospace);';
			const val = (v: number, color?: string) => {
				const s = DOM.append(gr, DOM.$('span'));
				s.textContent = money(v);
				s.style.cssText = `text-align:right;${color ? `color:${color};font-weight:600;` : ''}`;
			};
			val(l.carried); val(l.billed); val(l.allowed); val(l.paid, '#3b9edd');
			val(l.copay); val(l.deductible); val(l.writeOff, '#8b5cf6');
			val(secondaryLineOwes(l), '#f59e0b');
		}

		const totals = DOM.append(host, DOM.$('div'));
		totals.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;';
		const tCell = (label: string, value: string, color?: string) => {
			const c = DOM.append(totals, DOM.$('div'));
			const l = DOM.append(c, DOM.$('div')); l.textContent = label;
			l.style.cssText = 'font-size:9px;font-weight:700;text-transform:uppercase;color:var(--vscode-descriptionForeground);';
			const v = DOM.append(c, DOM.$('div')); v.textContent = value;
			v.style.cssText = `font-size:14px;font-weight:700;${color ? `color:${color};` : ''}`;
		};
		tCell('Carried', money(round2(row.secLines.reduce((s, l) => s + l.carried, 0))));
		tCell('Billed', money(round2(row.secLines.reduce((s, l) => s + l.billed, 0))));
		tCell('Allowed', money(round2(row.secLines.reduce((s, l) => s + l.allowed, 0))));
		tCell('Secondary Paid', money(round2(row.secLines.reduce((s, l) => s + l.paid, 0))), '#3b9edd');
		tCell('Write-off', money(round2(row.secLines.reduce((s, l) => s + l.writeOff, 0))), '#8b5cf6');
		tCell('Patient Resp', money(this._rowSecRemainder(row)), '#f59e0b');
	}

	/**
	 * Post the secondary-payer EOB against the primary posting transaction:
	 * the description is rebuilt with the COMBINED figures (paid, write-off,
	 * patient resp) so the Dashboard's balance reflection closes the
	 * encounter, the notes gain the secondary segments, the unpaid coinsurance
	 * remainder becomes a pending patient-responsibility transaction, and the
	 * patient is emailed the full statement — the claim is then Completed.
	 */
	private async _postSecondaryEob(row: InsurancePostingRow): Promise<void> {
		const round2 = (n: number) => Math.round(n * 100) / 100;
		const paidSec = round2(row.secLines.reduce((s, l) => s + l.paid, 0));
		const adjSec = round2(row.secLines.reduce((s, l) => s + l.writeOff, 0));
		const remainder = Math.max(round2(row.secLines.reduce((s, l) => s + secondaryLineOwes(l), 0)), 0);
		const billed = round2(row.lines.reduce((s, l) => s + l.billed, 0));
		const allowed = round2(row.lines.reduce((s, l) => s + l.allowed, 0));
		const paidPrimary = round2(row.lines.reduce((s, l) => s + l.paid, 0));
		const primaryWo = round2(row.lines.reduce((s, l) => s + lineWriteOff(l), 0));
		const resp = round2(row.copay + row.deductible + remainder);
		const description =
			`EOB posting | payer=${row.payerName}; claim=${row.claimRef}; ` +
			`check=${row.checkNumber}; billed=${billed.toFixed(2)}; allowed=${allowed.toFixed(2)}; ` +
			`paid=${round2(paidPrimary + paidSec).toFixed(2)}; copay=${row.copay.toFixed(2)}; deductible=${row.deductible.toFixed(2)}; ` +
			`coinsurance=${row.coinsurance.toFixed(2)}; writeoff=${round2(primaryWo + adjSec).toFixed(2)}; resp=${resp.toFixed(2)}`;
		const notes = `check=${row.checkNumber} | lines=${eobLinesSegment(row.lines)}`
			+ secondaryEobSegment(row.secPayer, row.secCheck, row.secDate, true, row.secLines);
		try {
			const res = await this.apiService.fetch(`/api/payments/transactions/${row.txnId}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ amount: round2(paidPrimary + paidSec), description, notes }),
			});
			if (!res.ok) {
				const e = await res.json().catch(() => null) as Record<string, unknown> | null;
				await this.dialogService.error(String(e?.['message'] || `Secondary posting failed (${res.status}).`));
				this._renderInsurancePosting();
				return;
			}
			// Only NOW does the unpaid coinsurance become patient responsibility.
			if (remainder > 0) {
				await this.apiService.fetch('/api/payments/collect', {
					method: 'POST',
					body: JSON.stringify({
						patientId: row.patientId,
						patientName: row.patientName,
						amount: remainder,
						transactionType: 'coinsurance',
						paymentMethodType: 'other',
						status: 'pending',
						description: `Patient responsibility (coinsurance remainder $${remainder.toFixed(2)} after secondary EOB from ${row.secPayer}) due from patient — claim ${row.claimRef} (from EOB)`,
					}),
				}).catch(() => { /* best-effort — the secondary posting itself saved */ });
			}
			row.secPosted = true;
			let emailed = false;
			if (resp > 0) {
				emailed = await this._sendClaimStatement(row, { payer: row.secPayer, check: row.secCheck, paid: paidSec, remainder });
			}
			this._insExpanded.delete(normalizeClaimRef(row.claimRef));
			this._showPayToast(
				`Secondary EOB posted — claim ${row.claimRef} is closed.`
				+ (remainder > 0 ? ` $${remainder.toFixed(2)} coinsurance remainder is now patient responsibility.` : '')
				+ (emailed ? ' The patient was emailed a statement with the full code & service breakdown.' : ''));
			this._loadAndRenderInsurancePosting();
		} catch (e) {
			await this.dialogService.error(`Secondary posting failed: ${e}`);
			this._renderInsurancePosting();
		}
	}

	/**
	 * Email the patient their statement once insurance has been posted — every
	 * code & service with its billed / allowed / insurance-paid / write-off /
	 * copay / deductible / coinsurance figures and exactly what the patient owes.
	 *
	 * Delivery goes through the EHR's OWN notification channel
	 * (`/api/notifications/send` -> per-practice SMTP from Settings >
	 * Notifications), the same path the appointment confirmations use. The
	 * ciyex-patient-pay invoice is still created (it backs the Dashboard's
	 * invoice list and the pay-portal link) but its comm-service email is no
	 * longer what decides success — that route delivers through ciyex-comm,
	 * whose SMTP credentials fail, which is why patients never received these
	 * statements. Best-effort; returns whether the email actually went out.
	 */
	private async _sendClaimStatement(
		v: { claimRef: string; patientId: string; patientName: string; payerName: string; checkNumber: string; serviceDate?: string; lines: EobLine[]; copay: number; deductible: number },
		sec?: { payer: string; check: string; paid: number; remainder: number },
		opts?: { coinsurancePending?: number; secondaryPayer?: string },
	): Promise<boolean> {
		const round2 = (n: number) => Math.round(n * 100) / 100;
		const fmt = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const respTotal = round2(v.copay + v.deductible + (sec?.remainder || 0));
		if (respTotal <= 0 || !v.patientId) { return false; }
		const pending = round2(opts?.coinsurancePending || 0);
		const paidPrimary = round2(v.lines.reduce((s, l) => s + l.paid, 0));
		const dos = v.serviceDate ? isoToUsDate(v.serviceDate) : '';

		// One plain-text summary line per code — this is what rides in the
		// patient-pay invoice notes (and onto its statement PDF).
		const lineTexts = v.lines.map(l =>
			`${l.code} ${l.description || 'Service'}: billed ${fmt(l.billed)}, allowed ${fmt(l.allowed)}, insurance paid ${fmt(l.paid)}, write-off ${fmt(lineWriteOff(l))}, copay ${fmt(l.copay || 0)}, deductible ${fmt(l.deductible || 0)}, coinsurance ${fmt(l.coinsurance || 0)}`);
		const notes =
			`Patient statement — claim ${v.claimRef}${dos ? `, date of service ${dos}` : ''}. ` +
			`Insurance: ${v.payerName || '—'} (check ${v.checkNumber || '—'})${sec ? `; secondary ${sec.payer} (check ${sec.check})` : ''}. ` +
			`${lineTexts.join(' | ')}. ` +
			`Insurance paid ${fmt(paidPrimary)}${sec ? ` primary + ${fmt(sec.paid)} secondary` : ''}. ` +
			`You pay ${fmt(respTotal)} (copay ${fmt(v.copay)} + deductible ${fmt(v.deductible)}${sec ? ` + coinsurance remainder ${fmt(sec.remainder)}` : ''}).` +
			(pending > 0 ? ` ${fmt(pending)} coinsurance is still pending with ${opts?.secondaryPayer || 'the secondary insurance'} and is not billed to you yet.` : '');

		let patientEmail = '';
		try {
			const pr = await this.apiService.fetch(`/api/patients/${encodeURIComponent(v.patientId)}`);
			if (pr.ok) {
				const pd = await pr.json();
				const patient = (pd?.data ?? pd) as Record<string, unknown>;
				patientEmail = String(patient?.['email'] ?? patient?.['patientEmail'] ?? patient?.['emailAddress'] ?? '').trim();
			}
		} catch { /* email lookup is best-effort */ }

		// The invoice keeps the balance visible in the pay portal / Dashboard.
		const payload: Record<string, unknown> = {
			patientId: v.patientId,
			patientName: v.patientName,
			totalAmount: respTotal,
			balanceDue: respTotal,
			status: 'SENT',
			notes,
		};
		if (patientEmail) { payload['patientEmail'] = patientEmail; }
		try {
			const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices`, { method: 'POST', headers: this._patientPayHeaders(), body: JSON.stringify(payload) });
			if (res.ok) {
				const created = (await res.json().catch(() => ({}))) as Record<string, unknown>;
				const createdData = (created['data'] ?? created) as Record<string, unknown>;
				const invId = String(createdData['id'] ?? '');
				if (invId) {
					await fetch(`${this._patientPayBase()}/api/patient-pay/invoices/${encodeURIComponent(invId)}/send`, { method: 'POST', headers: this._patientPayHeaders() })
						.catch(() => { /* comm-service delivery is the fallback path */ });
				}
			}
		} catch { /* the invoice is best-effort — the email below is what matters */ }

		if (!patientEmail) { return false; }
		const brand = await this._fetchPracticeBranding();
		const body = this._buildClaimStatementEmail(v, respTotal, paidPrimary, dos, sec, pending, opts?.secondaryPayer, brand);
		const send: Record<string, unknown> = {
			channelType: 'email',
			recipient: patientEmail,
			subject: `${brand.name ? `${brand.name} — s` : 'S'}tatement for claim ${v.claimRef}${dos ? ` (visit ${dos})` : ''} — you owe ${fmt(respTotal)}`,
			body,
			triggerType: 'insurance_posting',
		};
		// The notification log keys patients by numeric id; a FHIR-style id would
		// blow up the Long conversion server-side, so only send it when numeric.
		if (/^\d+$/.test(v.patientId)) { send['patientId'] = Number(v.patientId); }
		try {
			const res = await this.apiService.fetch('/api/notifications/send', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(send),
			});
			if (!res.ok) { return false; }
			const data = await res.json().catch(() => null) as Record<string, unknown> | null;
			const log = (data?.['data'] ?? data) as Record<string, unknown> | null;
			// The endpoint answers 200 even when SMTP rejected the message — the
			// log row's status is the only truthful signal.
			const status = String(log?.['status'] ?? '').toLowerCase();
			return status === '' || status === 'sent' || status === 'queued';
		} catch { return false; }
	}

	/**
	 * Practice identity for outbound patient email — name, NPI, phone and the
	 * uploaded logo (Settings > Practice). Cached for the editor's lifetime so
	 * a run of postings doesn't re-fetch it per statement. Every field is
	 * optional: the letterhead degrades to the practice name, and to a plain
	 * heading when even that is unavailable — nothing here is hardcoded.
	 */
	private _practiceBrand: { name: string; npi: string; phone: string; logo: string } | undefined;

	private async _fetchPracticeBranding(): Promise<{ name: string; npi: string; phone: string; logo: string }> {
		if (this._practiceBrand) { return this._practiceBrand; }
		const brand = { name: '', npi: '', phone: '', logo: '' };
		try {
			const [pRes, lRes] = await Promise.all([
				this.apiService.fetch('/api/practices?page=0&size=1').catch(() => null),
				this.apiService.fetch('/api/practice-logo').catch(() => null),
			]);
			if (pRes?.ok) {
				const j = await pRes.json().catch(() => null);
				const list = (j?.data?.content ?? j?.content ?? j?.data ?? []) as Record<string, unknown>[];
				const p = (Array.isArray(list) ? list[0] : (j?.data ?? j)) as Record<string, unknown> | undefined;
				if (p) {
					brand.name = String(p['name'] ?? '');
					brand.npi = String(p['npi'] ?? '');
					brand.phone = String(p['phone'] ?? '');
				}
			}
			if (lRes?.ok) {
				const j = await lRes.json().catch(() => null);
				brand.logo = String(j?.data?.logoData ?? j?.logoData ?? '');
			}
		} catch { /* branding is decoration — the statement sends either way */ }
		this._practiceBrand = brand;
		return brand;
	}

	/**
	 * The statement email body: a practice letterhead, the claim/visit facts,
	 * then a full per-code table (date of service, billed, allowed, insurance
	 * paid, write-off, copay, deductible, coinsurance, patient owes) with the
	 * totals and an amount-due panel.
	 *
	 * Laid out with tables and inline styles only — mail clients drop
	 * stylesheets, flexbox and grid. The logo is emitted when the practice has
	 * uploaded one; note some webmail clients (Gmail among them) strip
	 * `data:` image sources, which is why the practice name is always drawn as
	 * text beside it rather than baked into the image.
	 */
	private _buildClaimStatementEmail(
		v: { claimRef: string; patientName: string; payerName: string; checkNumber: string; lines: EobLine[]; copay: number; deductible: number },
		respTotal: number, paidPrimary: number, dos: string,
		sec: { payer: string; check: string; paid: number; remainder: number } | undefined,
		pending: number, secondaryPayer: string | undefined,
		brand: { name: string; npi: string; phone: string; logo: string },
	): string {
		const round2 = (n: number) => Math.round(n * 100) / 100;
		const fmt = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const ACCENT = '#1f6feb';
		// Ten columns have to survive a 600-700px mail viewport, so the grid is
		// fixed-layout with tight padding and the two text columns pinned — left
		// to itself the description column starves the money columns and the
		// right-hand "You Owe" falls off the card.
		// `overflow-wrap` (not `word-break`) so a header only splits when it truly
		// cannot fit — word-break chops "BILLED" into "BILLE/D" at mail widths.
		// `overflow-wrap` (not `word-break`) so a header only splits when it truly
		// cannot fit — word-break chops "BILLED" into "BILLE/D" at mail widths.
		const th = `padding:7px 4px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;text-align:right;font-size:9px;text-transform:uppercase;color:#475569;font-weight:700;overflow-wrap:break-word;`;
		const thL = th.replace('text-align:right', 'text-align:left');
		const td = 'padding:7px 4px;border-bottom:1px solid #eef2f7;text-align:right;font-size:11px;color:#0f172a;white-space:nowrap;';
		const tdL = td.replace('text-align:right', 'text-align:left').replace('white-space:nowrap;', '');
		const tf = 'padding:8px 4px;border-top:2px solid #cbd5e1;text-align:right;font-size:11px;color:#0f172a;font-weight:700;white-space:nowrap;';
		const tfL = tf.replace('text-align:right', 'text-align:left');
		const rows = v.lines.map(l => {
			const owes = round2((l.copay || 0) + (l.deductible || 0));
			return `<tr>`
				+ `<td style="${tdL}white-space:nowrap;">${esc(dos || '—')}</td>`
				+ `<td style="${tdL}"><strong>${esc(l.code)}</strong>${l.description ? `<br><span style="font-size:11px;color:#64748b;">${esc(l.description)}</span>` : ''}</td>`
				+ `<td style="${td}">${fmt(l.billed)}</td><td style="${td}">${fmt(l.allowed)}</td>`
				+ `<td style="${td}">${fmt(l.paid)}</td><td style="${td}">${fmt(lineWriteOff(l))}</td>`
				+ `<td style="${td}">${fmt(l.copay || 0)}</td><td style="${td}">${fmt(l.deductible || 0)}</td>`
				+ `<td style="${td}">${fmt(l.coinsurance || 0)}</td>`
				+ `<td style="${td}color:${ACCENT};font-weight:700;">${fmt(owes)}</td></tr>`;
		}).join('');
		const totals = v.lines.reduce((a, l) => ({
			billed: a.billed + l.billed, allowed: a.allowed + l.allowed, paid: a.paid + l.paid,
			writeOff: a.writeOff + lineWriteOff(l), copay: a.copay + (l.copay || 0),
			deductible: a.deductible + (l.deductible || 0), coinsurance: a.coinsurance + (l.coinsurance || 0),
		}), { billed: 0, allowed: 0, paid: 0, writeOff: 0, copay: 0, deductible: 0, coinsurance: 0 });

		// Letterhead — uploaded logo when there is one, else a monogram of the
		// practice initials so the mail still reads as a branded document.
		const initials = (brand.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
		const mark = brand.logo
			? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}" width="52" height="52" style="display:block;width:52px;height:52px;border-radius:8px;object-fit:contain;background:#ffffff;" />`
			: (initials
				? `<div style="width:52px;height:52px;border-radius:8px;background:${ACCENT};color:#ffffff;font-size:19px;font-weight:700;line-height:52px;text-align:center;letter-spacing:.04em;">${esc(initials)}</div>`
				: '');
		const contact = [brand.phone ? `Tel ${esc(brand.phone)}` : '', brand.npi ? `NPI ${esc(brand.npi)}` : '']
			.filter(Boolean).join(' &nbsp;·&nbsp; ');
		const fact = (label: string, value: string) =>
			`<tr><td style="padding:3px 16px 3px 0;font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:#64748b;white-space:nowrap;">${esc(label)}</td>`
			+ `<td style="padding:3px 0;font-size:13px;color:#0f172a;font-weight:600;">${value}</td></tr>`;

		return `<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;background:#f8fafc;padding:24px 12px;">`
			+ `<div style="max-width:880px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">`

			// Letterhead
			+ `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-top:4px solid ${ACCENT};">`
			+ `<tr><td style="padding:20px 24px 16px;border-bottom:1px solid #e2e8f0;">`
			+ `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
			+ `<tr>${mark ? `<td style="padding-right:14px;vertical-align:middle;">${mark}</td>` : ''}`
			+ `<td style="vertical-align:middle;">`
			+ `<div style="font-size:19px;font-weight:700;letter-spacing:.01em;">${esc(brand.name || 'Patient Statement')}</div>`
			+ (contact ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">${contact}</div>` : '')
			+ `</td></tr></table></td></tr>`

			// Title band
			+ `<tr><td style="padding:18px 24px 4px;">`
			+ `<div style="font-size:12px;letter-spacing:.10em;text-transform:uppercase;color:${ACCENT};font-weight:700;">Patient Statement</div>`
			+ `<div style="font-size:22px;font-weight:700;margin-top:2px;">Claim ${esc(v.claimRef)}</div>`
			+ `</td></tr>`

			// Greeting
			+ `<tr><td style="padding:10px 24px 0;font-size:13px;line-height:1.55;color:#475569;">`
			+ `Dear ${esc(v.patientName || 'Patient')}, your insurance has finished processing`
			+ `${dos ? ` your visit on <strong style="color:#0f172a;">${esc(dos)}</strong>` : ' this claim'}. `
			+ `Below is the full breakdown of every code and service, and the amount that is now your responsibility.`
			+ `</td></tr>`

			// Facts
			+ `<tr><td style="padding:16px 24px 0;">`
			+ `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
			+ fact('Patient', esc(v.patientName || '—'))
			+ (dos ? fact('Date of Service', esc(dos)) : '')
			+ fact('Insurance', `${esc(v.payerName || '—')}<span style="font-weight:400;color:#64748b;"> &nbsp;·&nbsp; check/EFT ${esc(v.checkNumber || '—')}</span>`)
			+ (sec ? fact('Secondary Insurance', `${esc(sec.payer)}<span style="font-weight:400;color:#64748b;"> &nbsp;·&nbsp; check/EFT ${esc(sec.check)}</span>`) : '')
			+ `</table></td></tr>`

			// Charge detail
			+ `<tr><td style="padding:18px 24px 0;">`
			+ `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;border:1px solid #e2e8f0;border-radius:6px;">`
			+ `<colgroup><col style="width:68px;"><col style="width:17%;">`
			+ `<col><col><col><col><col><col><col><col style="width:58px;"></colgroup>`
			+ `<thead><tr><th style="${thL}">Date of Service</th><th style="${thL}">Code / Service</th><th style="${th}">Billed</th><th style="${th}">Allowed</th>`
			+ `<th style="${th}">Ins. Paid</th><th style="${th}">Write-off</th><th style="${th}">Copay</th>`
			+ `<th style="${th}">Deduct.</th><th style="${th}">Coins.</th><th style="${th}">You Owe</th></tr></thead>`
			+ `<tbody>${rows}</tbody>`
			+ `<tfoot><tr><td style="${tfL}" colspan="2">Total</td>`
			+ `<td style="${tf}">${fmt(totals.billed)}</td><td style="${tf}">${fmt(totals.allowed)}</td>`
			+ `<td style="${tf}">${fmt(totals.paid)}</td><td style="${tf}">${fmt(totals.writeOff)}</td>`
			+ `<td style="${tf}">${fmt(totals.copay)}</td><td style="${tf}">${fmt(totals.deductible)}</td>`
			+ `<td style="${tf}">${fmt(totals.coinsurance)}</td>`
			+ `<td style="${tf}color:${ACCENT};">${fmt(respTotal)}</td></tr></tfoot></table></td></tr>`

			// Amount-due panel
			+ `<tr><td style="padding:18px 24px 0;">`
			+ `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f1f6ff;border:1px solid #cfe0ff;border-radius:8px;">`
			+ `<tr><td style="padding:16px 18px;">`
			+ `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#475569;font-weight:600;">Amount due</div>`
			+ `<div style="font-size:28px;font-weight:700;color:${ACCENT};margin-top:2px;">${fmt(respTotal)}</div>`
			+ `<div style="font-size:12px;color:#475569;margin-top:4px;">`
			+ `Copay ${fmt(v.copay)} &nbsp;+&nbsp; deductible ${fmt(v.deductible)}`
			+ (sec ? ` &nbsp;+&nbsp; coinsurance remainder ${fmt(sec.remainder)}` : '')
			+ `</div>`
			+ `<div style="font-size:12px;color:#475569;margin-top:8px;">`
			+ `Your insurance paid <strong style="color:#0f172a;">${fmt(paidPrimary)}</strong>`
			+ (sec ? ` (${esc(v.payerName || 'primary payer')}) and <strong style="color:#0f172a;">${fmt(sec.paid)}</strong> (${esc(sec.payer)})` : '')
			+ `, and ${fmt(totals.writeOff)} was written off under the plan's contract.`
			+ `</div></td></tr></table></td></tr>`

			// Coinsurance still with the secondary payer
			+ (pending > 0
				? `<tr><td style="padding:12px 24px 0;">`
				+ `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#faf5ff;border:1px solid #e6d8fb;border-radius:8px;">`
				+ `<tr><td style="padding:12px 16px;font-size:12px;line-height:1.55;color:#5b21b6;">`
				+ `<strong>${fmt(pending)}</strong> of coinsurance is still pending with `
				+ `${esc(secondaryPayer || 'your secondary insurance')} and is <strong>not</strong> billed to you. `
				+ `We will send an updated statement if any part of it becomes your responsibility.`
				+ `</td></tr></table></td></tr>`
				: '')

			// Footer
			+ `<tr><td style="padding:20px 24px 22px;">`
			+ `<div style="border-top:1px solid #e2e8f0;padding-top:14px;font-size:12px;line-height:1.6;color:#64748b;">`
			+ `Questions about this statement? Contact our billing office`
			+ (brand.phone ? ` on <strong style="color:#0f172a;">${esc(brand.phone)}</strong>` : '')
			+ ` and quote claim <strong style="color:#0f172a;">${esc(v.claimRef)}</strong>.`
			+ (brand.name ? `<div style="margin-top:6px;color:#94a3b8;">${esc(brand.name)}</div>` : '')
			+ `</div></td></tr>`

			+ `</table></div></div>`;
	}

	// allow-any-unicode-next-line
	// ── EOB document attachments ───────────────────────────────────────────
	// Uploaded EOB files are stored as the patient's FHIR DocumentReference
	// (the same store the patient chart Documents page lists), tagged with the
	// claim # in the notes so the Insurance Posting expansion can list and
	// preview them per claim. NOTE: the generic FHIR write path resolves the
	// resource type from the TAB key — POSTs must target
	// /api/fhir-resource/documents/... ("documents" tab); the
	// document-references path is read-only (write access denied, 403).

	/** This patient's chart documents tagged to the claim. */
	private async _fetchEobDocs(row: InsurancePostingRow): Promise<Array<Record<string, unknown>>> {
		if (!row.patientId || !row.claimRef) { return []; }
		try {
			const res = await this.apiService.fetch(`/api/fhir-resource/documents/patient/${encodeURIComponent(row.patientId)}?page=0&size=200`);
			if (!res.ok) { return []; }
			const data = await res.json();
			const list = (data?.data?.content || data?.data || data?.content || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
			const tag = `claim=${row.claimRef}`.toLowerCase();
			const ref = row.claimRef.toLowerCase();
			return (Array.isArray(list) ? list : []).filter(d =>
				String(d['notes'] ?? '').toLowerCase().includes(tag) ||
				String(d['description'] ?? '').toLowerCase().includes(ref));
		} catch { return []; }
	}

	private async _renderEobDocsList(host: HTMLElement, row: InsurancePostingRow): Promise<void> {
		DOM.clearNode(host);
		const loading = DOM.append(host, DOM.$('span'));
		loading.textContent = 'Loading documents…';
		loading.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const docs = await this._fetchEobDocs(row);
		DOM.clearNode(host);
		if (docs.length === 0) {
			const e = DOM.append(host, DOM.$('span'));
			e.textContent = 'No documents attached yet.';
			e.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-style:italic;';
			return;
		}
		for (const d of docs) {
			const chip = DOM.append(host, DOM.$('button')) as HTMLButtonElement;
			chip.textContent = `\u{1F4C4} ${String(d['description'] ?? d['title'] ?? 'Document')}`;
			chip.title = 'View document';
			chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(59,158,221,0.08);border:1px solid rgba(59,158,221,0.35);border-radius:12px;color:#3b9edd;cursor:pointer;font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			chip.addEventListener('click', () => this._viewEobDocument(d, row.patientId));
		}
	}

	/** Read the file and save it as a patient-chart DocumentReference tagged to the claim. */
	private async _uploadEobDocument(row: InsurancePostingRow, file: File): Promise<boolean> {
		let dataUrl: string;
		try {
			dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result || ''));
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});
		} catch { return false; }
		const ext = (file.name.split('.').pop() || '').toLowerCase();
		const extTypes: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', txt: 'text/plain', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
		const now = new Date();
		const docName = `EOB ${row.claimRef} — ${file.name}`;
		const payload: Record<string, unknown> = {
			// Name under every key the chart's Documents list may use for its
			// title column (backend tab_field_config decides which one shows).
			description: docName,
			title: docName,
			name: docName,
			type: 'other',
			category: 'insurance',
			date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
			// The server only lists status=current documents — anything else
			// silently disappears from the chart (see patientChartEditor).
			status: 'current',
			attachment: dataUrl,
			contentType: file.type || extTypes[ext] || 'application/octet-stream',
			// Unique URI — HAPI's DocumentReference URI index rejects duplicates (HAPI-0550).
			url: `urn:uuid:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
			patientId: parseInt(row.patientId, 10) || row.patientId,
			notes: `EOB attachment | claim=${row.claimRef}`,
		};
		try {
			const res = await this.apiService.fetch(`/api/fhir-resource/documents/patient/${encodeURIComponent(row.patientId)}`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
			});
			return res.ok;
		} catch { return false; }
	}

	/** Resolve the viewable attachment source out of the assorted DocumentReference shapes. */
	private _docAttachmentSrc(d: Record<string, unknown>): string {
		const direct = d['attachment'];
		if (typeof direct === 'string' && (direct.startsWith('data:') || direct.startsWith('http'))) { return direct; }
		// FHIR shape: content[0].attachment.{data, contentType} (raw base64).
		const content = d['content'];
		const att = Array.isArray(content) ? (content[0] as Record<string, unknown> | undefined)?.['attachment'] as Record<string, unknown> | undefined : undefined;
		const attData = att?.['data'];
		if (typeof attData === 'string' && attData) {
			const ct = String(att?.['contentType'] ?? d['contentType'] ?? 'application/octet-stream');
			return attData.startsWith('data:') ? attData : `data:${ct};base64,${attData}`;
		}
		if (typeof direct === 'string' && direct && !direct.startsWith('urn:')) {
			return `data:${String(d['contentType'] ?? 'application/octet-stream')};base64,${direct}`;
		}
		return '';
	}

	private async _viewEobDocument(doc: Record<string, unknown>, patientId: string): Promise<void> {
		// The list payload may omit the attachment content — refetch by id.
		let src = this._docAttachmentSrc(doc);
		if (!src && doc['id'] !== undefined && doc['id'] !== null) {
			try {
				const res = await this.apiService.fetch(`/api/fhir-resource/documents/patient/${encodeURIComponent(patientId)}/${encodeURIComponent(String(doc['id']))}`);
				if (res.ok) {
					const j = await res.json();
					src = this._docAttachmentSrc((j?.data ?? j) as Record<string, unknown>);
				}
			} catch { /* fall through to the not-stored message */ }
		}
		if (!src) {
			await this.dialogService.info('No attachment content is stored on this document.');
			return;
		}
		this._openDocPreview(src, String(doc['description'] ?? 'Document'));
	}

	/** Themed overlay preview: images inline, PDFs in a frame, else download-only. */
	private _openDocPreview(src: string, title: string): void {
		const doc = (this.root && this.root.ownerDocument) || DOM.getActiveWindow().document;
		const mount = findWorkbenchRoot(this.root, doc);
		const overlay = DOM.append(mount, DOM.$('div'));
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		overlay.style.cssText = 'position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);color:var(--vscode-foreground);';
		const close = () => overlay.remove();
		overlay.addEventListener('mousedown', e => { if (e.target === overlay) { close(); } });
		const panel = DOM.append(overlay, DOM.$('div'));
		panel.style.cssText = 'position:relative;width:840px;max-width:92vw;height:86vh;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;';
		const head = DOM.append(panel, DOM.$('div'));
		head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const t = DOM.append(head, DOM.$('span'));
		t.textContent = title;
		t.style.cssText = 'font-weight:600;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const dl = DOM.append(head, DOM.$('a')) as HTMLAnchorElement;
		dl.textContent = 'Download';
		dl.href = src;
		dl.download = title.replace(/[\\/:*?"<>|]/g, '_');
		dl.style.cssText = 'font-size:12px;color:#3b9edd;cursor:pointer;text-decoration:none;';
		const x = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		x.textContent = '✕';
		x.style.cssText = 'background:none;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:14px;';
		x.addEventListener('click', close);
		const body = DOM.append(panel, DOM.$('div'));
		body.style.cssText = 'flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:rgba(0,0,0,0.12);';
		if (/^data:image\//.test(src)) {
			const img = DOM.append(body, DOM.$('img')) as HTMLImageElement;
			img.src = src;
			img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
		} else if (/^data:application\/pdf/.test(src)) {
			const frame = DOM.append(body, DOM.$('iframe')) as HTMLIFrameElement;
			frame.src = src;
			frame.style.cssText = 'width:100%;height:100%;border:none;background:#fff;';
		} else {
			const msg = DOM.append(body, DOM.$('div'));
			msg.textContent = 'Preview is not available for this file type — use Download.';
			msg.style.cssText = 'padding:24px;color:var(--vscode-descriptionForeground);font-size:12px;';
		}
	}

	// allow-any-unicode-next-line
	// ── Credit-card grid rendering ─────────────────────────────────────────

	private async _loadAndRenderCards(): Promise<void> {
		if (!this.contentEl) { return; }
		DOM.clearNode(this.contentEl);

		// Toolbar
		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;';
		const titleEl = DOM.append(toolbar, DOM.$('h2'));
		titleEl.textContent = 'Payment Methods';
		titleEl.style.cssText = 'font-size:20px;font-weight:600;margin:0;color:var(--vscode-foreground);';
		const right = DOM.append(toolbar, DOM.$('div'));
		right.style.cssText = 'display:flex;align-items:center;gap:10px;';
		const searchEl = DOM.append(right, DOM.$('input')) as HTMLInputElement;
		searchEl.placeholder = 'Search cards…';
		searchEl.value = this._cardsSearch;
		searchEl.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;min-width:200px;';
		const addBtn = DOM.append(right, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add Card';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
		// Cards are patient-scoped — adding one requires a selected patient.
		if (!this._payPatientId) {
			addBtn.disabled = true;
			addBtn.style.opacity = '0.5';
			addBtn.style.cursor = 'not-allowed';
			addBtn.title = 'Select a patient first';
		}

		// Card grid container
		const grid = DOM.append(this.contentEl, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;';

		const renderGrid = () => {
			DOM.clearNode(grid);
			const q = this._cardsSearch.toLowerCase();
			const filtered = this._cards.filter(c =>
				!q ||
				(c.cardHolderName || '').toLowerCase().includes(q) ||
				(c.cardType || '').toLowerCase().includes(q) ||
				(c.maskedCardNumber || '').toLowerCase().includes(q) ||
				(c.billingCity || '').toLowerCase().includes(q)
			);
			if (filtered.length === 0) {
				const empty = DOM.append(grid, DOM.$('div'));
				empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:48px;color:var(--vscode-descriptionForeground);font-size:13px;';
				empty.textContent = !this._payPatientId
					? 'Select a patient to view their payment methods.'
					: this._cardsLoading ? 'Loading…' : 'No payment methods found.';
				return;
			}
			for (const card of filtered) { this._renderCardItem(grid, card, renderGrid); }
		};

		searchEl.addEventListener('input', () => { this._cardsSearch = searchEl.value; renderGrid(); });
		// Reload from the backend after save so the newly added card shows up
		// immediately (re-rendering the stale in-memory list alone would not).
		addBtn.addEventListener('click', () => this._openCardForm(null, async () => { await this._reloadCards(); renderGrid(); }));

		// Load data — cards are patient-scoped on the backend. A bare
		// GET /api/credit-cards is a 500 ("Request method 'GET' is not supported");
		// the only list route is /api/credit-cards/patient/{id}, matching the
		// Plans / Ledger views. Without a selected patient there is nothing to load.
		if (!this._payPatientId) {
			this._cards = [];
			this._cardsLoading = false;
			renderGrid();
			return;
		}
		this._cardsLoading = true;
		renderGrid();
		try {
			const res = await this.apiService.fetch(`/api/credit-cards/patient/${this._payPatientId}`);
			if (res.ok) {
				const data = await res.json();
				this._cards = (data?.data?.content || data?.data || data?.content || (Array.isArray(data) ? data : [])) as CreditCardRecord[];
			} else {
				this._cards = [];
			}
		} catch { this._cards = []; }
		this._cardsLoading = false;
		renderGrid();
	}

	private _cardTypeBadge(type: string): string {
		const t = (type || '').toUpperCase();
		if (t.includes('VISA')) { return 'VISA'; }
		if (t.includes('MASTER')) { return 'MC'; }
		if (t.includes('AMEX') || t.includes('AMERICAN')) { return 'AMEX'; }
		if (t.includes('DISCOVER')) { return 'DISC'; }
		return t.slice(0, 4) || '????';
	}

	private _isCardExpired(card: CreditCardRecord): boolean {
		if (card.isExpired) { return true; }
		const now = new Date();
		return (card.expiryYear < now.getFullYear()) ||
			(card.expiryYear === now.getFullYear() && card.expiryMonth < now.getMonth() + 1);
	}

	private _renderCardItem(grid: HTMLElement, card: CreditCardRecord, refresh: () => void): void {
		const expired = this._isCardExpired(card);
		const inactive = card.isActive === false;
		const isDefault = !!card.isDefault;

		let borderColor: string;
		let bgColor: string;
		let opacity = '1';
		if (expired) { borderColor = '#fca5a5'; bgColor = 'rgba(254,202,202,0.12)'; }
		else if (inactive) { borderColor = 'var(--vscode-editorWidget-border,#555)'; bgColor = 'rgba(128,128,128,0.06)'; opacity = '0.65'; }
		else if (isDefault) { borderColor = '#3b82f6'; bgColor = 'rgba(59,130,246,0.08)'; }
		else { borderColor = 'var(--vscode-editorWidget-border,#555)'; bgColor = 'var(--vscode-editor-background)'; }

		const cardEl = DOM.append(grid, DOM.$('div'));
		cardEl.style.cssText = `border:1.5px solid ${borderColor};border-radius:10px;padding:14px 16px;background:${bgColor};opacity:${opacity};display:flex;flex-direction:column;gap:8px;position:relative;transition:box-shadow 0.15s;`;

		// Header row: icon + type badge + status badges
		const headerRow = DOM.append(cardEl, DOM.$('div'));
		headerRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
		const icon = DOM.append(headerRow, DOM.$('span'));
		// allow-any-unicode-next-line
		icon.textContent = '💳';
		icon.style.cssText = 'font-size:20px;line-height:1;';
		const typeBadge = DOM.append(headerRow, DOM.$('span'));
		typeBadge.textContent = this._cardTypeBadge(card.cardType);
		typeBadge.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff);';
		if (isDefault) {
			const defBadge = DOM.append(headerRow, DOM.$('span'));
			defBadge.textContent = 'Default';
			defBadge.style.cssText = 'font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(59,130,246,0.15);color:#3b82f6;margin-left:auto;';
		}
		if (inactive) {
			const inBadge = DOM.append(headerRow, DOM.$('span'));
			inBadge.textContent = 'Inactive';
			inBadge.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(128,128,128,0.15);color:var(--vscode-descriptionForeground);margin-left:auto;';
		}

		// Masked card number
		const numEl = DOM.append(cardEl, DOM.$('div'));
		numEl.textContent = card.maskedCardNumber || '•••• •••• •••• ****';
		numEl.style.cssText = 'font-size:14px;font-weight:600;letter-spacing:2px;color:var(--vscode-foreground);font-family:monospace;';

		// Holder name
		const holderEl = DOM.append(cardEl, DOM.$('div'));
		holderEl.textContent = card.cardHolderName || '';
		holderEl.style.cssText = 'font-size:12px;color:var(--vscode-foreground);';

		// Expiry row
		const expiryRow = DOM.append(cardEl, DOM.$('div'));
		expiryRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px;color:var(--vscode-descriptionForeground);';
		const mm = String(card.expiryMonth || 1).padStart(2, '0');
		const yy = String(card.expiryYear || new Date().getFullYear());
		expiryRow.textContent = `Expires ${mm}/${yy}`;
		if (expired) {
			const expTag = DOM.append(expiryRow, DOM.$('span'));
			expTag.textContent = 'EXPIRED';
			expTag.style.cssText = 'font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.15);color:#ef4444;letter-spacing:0.5px;';
		}

		// Billing info
		if (card.billingCity || card.billingState || card.billingZip) {
			const billEl = DOM.append(cardEl, DOM.$('div'));
			billEl.textContent = [card.billingCity, card.billingState, card.billingZip].filter(Boolean).join(', ');
			billEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}

		// Action buttons
		const actions = DOM.append(cardEl, DOM.$('div'));
		actions.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap;';

		if (!isDefault && !inactive) {
			const defBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			defBtn.textContent = 'Set Default';
			defBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:#3b82f6;padding:0;font-weight:500;';
			defBtn.addEventListener('click', async () => {
				try {
					const pid = card.patientId;
					await this.apiService.fetch(
						pid ? `/api/credit-cards/${card.id}/patient/${pid}/set-default` : `/api/credit-cards/${card.id}/set-default`,
						{ method: 'PUT' }
					);
					await this._reloadCards();
					refresh();
				} catch { /* ignore */ }
			});
		}

		const editBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		editBtn.textContent = 'Edit';
		editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:var(--vscode-descriptionForeground);padding:0;';
		editBtn.addEventListener('click', () => this._openCardForm(card, async () => { await this._reloadCards(); refresh(); }));

		if (!inactive) {
			const deactBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			deactBtn.textContent = 'Deactivate';
			deactBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:#f97316;padding:0;';
			deactBtn.addEventListener('click', async () => {
				const ok = DOM.getActiveWindow().confirm('Deactivate this card?');
				if (!ok) { return; }
				try {
					await this.apiService.fetch(`/api/credit-cards/${card.id}/deactivate`, { method: 'PUT' });
					await this._reloadCards();
					refresh();
				} catch { /* ignore */ }
			});
		}

		const delBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		delBtn.textContent = 'Delete';
		delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;color:#ef4444;padding:0;margin-left:auto;';
		delBtn.addEventListener('click', async () => {
			const ok = DOM.getActiveWindow().confirm('Delete this payment method? This cannot be undone.');
			if (!ok) { return; }
			try {
				await this.apiService.fetch(`/api/credit-cards/${card.id}`, { method: 'DELETE' });
				this._cards = this._cards.filter(c => c.id !== card.id);
				refresh();
			} catch { /* ignore */ }
		});
	}

	private async _reloadCards(): Promise<void> {
		if (!this._payPatientId) { this._cards = []; return; }
		try {
			const res = await this.apiService.fetch(`/api/credit-cards/patient/${this._payPatientId}`);
			if (res.ok) {
				const data = await res.json();
				this._cards = (data?.data?.content || data?.data || data?.content || (Array.isArray(data) ? data : [])) as CreditCardRecord[];
			}
		} catch { /* ignore */ }
	}

	private _openCardForm(card: CreditCardRecord | null, onSaved: () => void): void {
		// Remove any existing overlay
		this._cardFormOverlay?.remove();
		this._cardFormBackdrop?.remove();

		const doc = (this.root && this.root.ownerDocument) || DOM.getActiveWindow().document;
		// Mount on the workbench root (not document.body) so the workbench theme
		// CSS variables resolve. Body-mounted overlays sit OUTSIDE .monaco-workbench
		// where every --vscode-* var falls back to its hardcoded dark default —
		// which is why the Add Payment Method drawer rendered dark on a light
		// workbench (QA report issue 5).
		const mount = findWorkbenchRoot(this.root, doc);
		const themeType = this.themeService.getColorTheme().type;
		const colorScheme = themeType === 'light' || themeType === 'hcLight' ? 'light' : 'dark';
		const backdrop = doc.createElement('div');
		backdrop.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		// Transparent backdrop — still captures click-to-close but does not dim
		// the rest of the screen (matches the other right-side drawers).
		backdrop.style.cssText = 'position:fixed;inset:0;z-index:9999;background:transparent;';
		mount.appendChild(backdrop);
		this._cardFormBackdrop = backdrop;

		// Full-viewport flex wrapper that right-aligns the panel. Using
		// justify-content:flex-end (rather than `right:0` on the panel itself)
		// is what the base list-editor drawer does — it pins reliably to the
		// right even when a transformed workbench ancestor would otherwise make
		// a `position:fixed;right:0` element resolve to the wrong edge (issue 18).
		const overlay = doc.createElement('div');
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		// `background:transparent` is REQUIRED: copying the workbench className above
		// also copies `.monaco-workbench`'s runtime-injected opaque editor background
		// (style.ts registers `.monaco-workbench { background-color: <workbenchBackground> }`).
		// Without this override the overlay paints the whole viewport solid, so the
		// empty flex space to the LEFT of the right-aligned 560px panel renders as a
		// blank opaque grey/white block (Payment Method modal issue: blank left panel).
		overlay.style.cssText = `position:fixed;inset:0;z-index:10000;display:flex;justify-content:flex-end;color-scheme:${colorScheme};background:transparent;`;
		mount.appendChild(overlay);
		this._cardFormOverlay = overlay;

		// The actual right-side drawer panel.
		const panel = DOM.append(overlay, DOM.$('div'));
		panel.style.cssText = 'width:560px;max-width:95vw;height:100%;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border,#454545);box-shadow:-8px 0 24px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;color:var(--vscode-foreground);';

		const close = () => { overlay.remove(); backdrop.remove(); this._cardFormOverlay = null; this._cardFormBackdrop = null; };
		backdrop.addEventListener('click', close);

		// Header
		const hdr = DOM.append(panel, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--vscode-editorWidget-border,#454545);flex-shrink:0;';
		const titleEl = DOM.append(hdr, DOM.$('h3'));
		titleEl.textContent = card ? 'Edit Card' : 'Add Payment Method';
		titleEl.style.cssText = 'margin:0;font-size:15px;font-weight:600;color:var(--vscode-foreground);';
		const closeBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '×';
		closeBtn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:var(--vscode-descriptionForeground);line-height:1;padding:0 4px;';
		closeBtn.addEventListener('click', close);

		// Scrollable form body
		const body = DOM.append(panel, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;align-content:start;scrollbar-width:none;';

		const inp = (label: string, key: string, span2 = false, opts: Partial<HTMLInputElement> = {}): HTMLInputElement => {
			const grp = DOM.append(body, DOM.$('div'));
			if (span2) { grp.style.gridColumn = 'span 2'; }
			const lbl = DOM.append(grp, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const el = DOM.append(grp, DOM.$('input')) as HTMLInputElement;
			el.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';
			Object.assign(el, opts);
			return el;
		};

		const sel = (label: string, options: Array<{ value: string; label: string }>, span2 = false): HTMLInputElement => {
			const grp = DOM.append(body, DOM.$('div'));
			if (span2) { grp.style.gridColumn = 'span 2'; }
			const lbl = DOM.append(grp, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			return createCustomDropdown({
				parent: grp,
				options,
				initialValue: options[0]?.value || '',
				triggerStyle: 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;cursor:pointer;',
			});
		};

		const chk = (label: string, span2 = false): HTMLInputElement => {
			const grp = DOM.append(body, DOM.$('div'));
			if (span2) { grp.style.gridColumn = 'span 2'; }
			grp.style.display = 'flex';
			grp.style.alignItems = 'center';
			grp.style.gap = '8px';
			const el = DOM.append(grp, DOM.$('input')) as HTMLInputElement;
			el.type = 'checkbox';
			el.style.accentColor = 'var(--vscode-focusBorder,#007fd4)';
			const lbl = DOM.append(grp, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'font-size:12px;color:var(--vscode-foreground);cursor:pointer;';
			lbl.addEventListener('click', () => { el.checked = !el.checked; });
			return el;
		};

		// Form fields matching PaymentFlat.tsx exactly
		const holderEl = inp('Card Holder Name *', 'cardHolderName', true, { maxLength: 100, placeholder: 'John Doe' });
		const numberEl = inp('Card Number *', 'cardNumber', true, { maxLength: 16, placeholder: '1234567890123456' });
		// digits only for card number
		numberEl.addEventListener('input', () => { numberEl.value = numberEl.value.replace(/\D/g, ''); });

		const typeEl = sel('Card Type', [
			{ value: 'VISA', label: 'Visa' }, { value: 'MASTERCARD', label: 'Mastercard' },
			{ value: 'AMEX', label: 'Amex' }, { value: 'DISCOVER', label: 'Discover' },
		]);

		const now = new Date();
		const monthEl = sel('Expiry Month *', Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1).padStart(2, '0') })));
		const yearEl = sel('Expiry Year *', Array.from({ length: 16 }, (_, i) => {
			const y = now.getFullYear() + i; return { value: String(y), label: String(y) };
		}));

		// Issue #18: CVV accepts a MAXIMUM of 3 digits, numeric only. The maxLength
		// attribute blocks typing past 3, and the input guard strips non-digits and
		// hard-truncates to 3 (covering paste / IME that bypass maxLength).
		const cvvEl = inp('CVV *', 'cvv', false, { maxLength: 3, placeholder: '123', inputMode: 'numeric' });
		cvvEl.addEventListener('input', () => { cvvEl.value = cvvEl.value.replace(/\D/g, '').slice(0, 3); });

		const addrEl = inp(ADDRESS_LABELS.addressLine1, 'billingAddressLine1', true, { placeholder: ADDRESS_PLACEHOLDERS.addressLine1 });
		const addr2El = inp(ADDRESS_LABELS.addressLine2, 'billingAddressLine2', true, { placeholder: ADDRESS_PLACEHOLDERS.addressLine2 });
		const cityEl = inp('City', 'billingCity', false, { maxLength: 50, placeholder: 'New York' });
		const stateEl = inp('State', 'billingState', false, { maxLength: 50, placeholder: 'NY' });
		const zipEl = inp('Zip Code', 'billingZip', false, { maxLength: 10, placeholder: '10001' });
		// A complete ZIP auto-fills + freezes the billing City/State (QA 22-Jul:
		// ZIP auto-fill on every create/edit form app-wide).
		wireZipCityStateInputs(zipEl, cityEl, stateEl);
		const countryEl = inp('Country', 'billingCountry', false, { maxLength: 50, placeholder: 'USA' });
		const isDefaultEl = chk('Set as default payment method', true);
		const isActiveEl = chk('Active', true);

		// Pre-fill for edit
		if (card) {
			holderEl.value = card.cardHolderName || '';
			// Card number not pre-filled for security (matches PaymentFlat.tsx)
			typeEl.value = card.cardType || 'VISA';
			monthEl.value = String(card.expiryMonth || 1);
			yearEl.value = String(card.expiryYear || now.getFullYear());
			addrEl.value = card.billingAddressLine1 || '';
			addr2El.value = card.billingAddressLine2 || '';
			cityEl.value = card.billingCity || '';
			stateEl.value = card.billingState || '';
			zipEl.value = card.billingZip || '';
			countryEl.value = card.billingCountry || 'USA';
			isDefaultEl.checked = !!card.isDefault;
			isActiveEl.checked = card.isActive !== false;
		} else {
			typeEl.value = 'VISA';
			monthEl.value = String(now.getMonth() + 1);
			yearEl.value = String(now.getFullYear());
			countryEl.value = 'USA';
			isActiveEl.checked = true;
		}

		// Error
		const errEl = DOM.append(body, DOM.$('div'));
		errEl.style.cssText = 'grid-column:span 2;color:#f48771;font-size:12px;padding:6px 10px;background:rgba(244,135,113,0.1);border:1px solid rgba(244,135,113,0.3);border-radius:4px;display:none;';

		// Footer
		const footer = DOM.append(panel, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--vscode-editorWidget-border,#454545);flex-shrink:0;';
		const cancelBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:7px 18px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', close);
		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = card ? 'Update' : 'Save';
		saveBtn.style.cssText = 'padding:7px 18px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';

		saveBtn.addEventListener('click', async () => {
			errEl.style.display = 'none';
			const holder = holderEl.value.trim();
			const num = numberEl.value.trim();
			const cvv = cvvEl.value.trim();
			if (!holder) { errEl.textContent = 'Card holder name is required.'; errEl.style.display = ''; return; }
			if (!card && !num) { errEl.textContent = 'Card number is required.'; errEl.style.display = ''; return; }
			if (!card && !cvv) { errEl.textContent = 'CVV is required.'; errEl.style.display = ''; return; }
			// The backend requires a patientId on every card (POST without it is a
			// 400 "patientId is required"). On create we scope to the selected
			// patient; on edit we keep the card's existing owner.
			const patientId = card ? card.patientId : this._payPatientId;
			if (!card && !patientId) { errEl.textContent = 'Select a patient before adding a card.'; errEl.style.display = ''; return; }

			const payload: Record<string, unknown> = {
				...(patientId ? { patientId } : {}),
				cardHolderName: holder,
				cardType: typeEl.value,
				expiryMonth: Number(monthEl.value),
				expiryYear: Number(yearEl.value),
				billingAddressLine1: addrEl.value.trim() || undefined,
				billingAddressLine2: addr2El.value.trim() || undefined,
				billingCity: cityEl.value.trim() || undefined,
				billingState: stateEl.value.trim() || undefined,
				billingZip: zipEl.value.trim() || undefined,
				billingCountry: countryEl.value.trim() || 'USA',
				isDefault: isDefaultEl.checked,
				isActive: isActiveEl.checked,
			};
			if (num) { payload['cardNumber'] = num; }
			if (cvv) { payload['cvv'] = cvv; }

			saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
			try {
				const url = card ? `/api/credit-cards/${card.id}` : '/api/credit-cards';
				const method = card ? 'PUT' : 'POST';
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				if (res.ok) {
					close();
					onSaved();
				} else {
					const errData = await res.json().catch(() => ({})) as Record<string, string>;
					errEl.textContent = errData['message'] || `Error ${res.status}`;
					errEl.style.display = '';
				}
			} catch {
				errEl.textContent = 'Failed to save. Please try again.';
				errEl.style.display = '';
			}
			saveBtn.disabled = false; saveBtn.textContent = card ? 'Update' : 'Save';
		});
	}

	private readonly _plansConfig: ClinicalEditorConfig = {
		title: 'Payment Plans', apiPath: '/api/payments/plans',
		searchPlaceholder: 'Search by patient, plan...',
		// The backend only exposes /api/payments/plans/patient/{id} for GET
		// (a bare GET /api/payments/plans is a 405). Scope to the selected patient.
		listUrlBuilder: () => this._payPatientId ? `/api/payments/plans/patient/${this._payPatientId}` : null,
		emptyListMessage: 'Select a patient to view their payment plans.',
		clientSideFilter: ['patientName', 'planName', 'status', 'id'],
		editable: true,
		refetchOnEdit: true,
		// Plan-level summary cards derived from the loaded plans. (This view used
		// to show the TRANSACTIONS stats left over from the previous tab — "6500
		// Month Collection" / "2 Month Count" — which described transactions, not
		// plans, and clicking them filtered the plan list down to nothing; QA
		// issue 13.)
		computeStats: (items) => {
			const byStatus = (s: string) => items.filter(i => String(i['status'] ?? '').toLowerCase() === s).length;
			return {
				totalPlans: items.length,
				active: byStatus('active'),
				completed: byStatus('completed'),
				defaulted: byStatus('defaulted'),
				cancelled: byStatus('cancelled'),
			};
		},
		statsFilterMap: {
			totalPlans: '',
			active: 'active',
			completed: 'completed',
			defaulted: 'defaulted',
			cancelled: 'cancelled',
		},
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'planName', label: 'Plan Name' },
			{ key: 'totalAmount', label: 'Total', width: '90px' },
			{ key: 'paidAmount', label: 'Paid', width: '90px' },
			{ key: 'remainingAmount', label: 'Remaining', width: '90px' },
			{ key: 'installments', label: 'Installments', width: '90px' },
			{ key: 'copayPerVisit', label: 'Copay / Visit', width: '95px' },
			{ key: 'nextDueDate', label: 'Next Due', width: '110px' },
			{ key: 'status', label: 'Status', width: '90px' },
		],
		// Surface the recurring-copay marker stored in the plan's notes as real
		// fields, so the grid shows it AND the edit form pre-fills from it.
		enrichItems: async (items) => {
			for (const it of items) {
				const copay = readCopayPlanNote(it['notes']);
				it['planType'] = copay ? 'recurring_copay' : 'installment';
				it['copayPerVisit'] = copay ? copay.perVisit : '';
			}
			return items;
		},
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'Completed', value: 'completed' },
			{ label: 'Defaulted', value: 'defaulted' }, { label: 'Cancelled', value: 'cancelled' },
		],
		cellRenderer: (key, value) => {
			if ((key === 'totalAmount' || key === 'paidAmount' || key === 'remainingAmount') && typeof value === 'number') {
				return `$${value.toFixed(2)}`;
			}
			if (key === 'copayPerVisit') {
				const n = Number(value) || 0;
				// allow-any-unicode-next-line
				return n > 0 ? `$${n.toFixed(2)}` : '—';
			}
			if (key === 'nextDueDate' && typeof value === 'string') {
				try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
			}
			return String(value ?? '');
		},
		formFields: [
			{
				key: 'patientName', label: 'Patient', type: 'search', required: true,
				placeholder: 'Search patient...', apiPath: '/api/patients',
				relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'],
			},
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled' },
			{ key: 'planName', label: 'Plan Name', type: 'text', required: true, placeholder: 'e.g. 6-Month Payment Plan' },
			// A recurring-copay plan charges the SAME copay on every visit (the team's
			// "$30 per visit, 4 visits a month"). It is what the copay auto-deduction
			// reads when no EOB has assigned a responsibility yet. It reuses Total /
			// Installments as "visits x copay" rather than adding parallel required
			// fields — 4 visits at $30 IS a $120 plan in 4 parts.
			{
				key: 'planType', label: 'Plan Type', type: 'select', options: [
					{ label: 'Installment Plan', value: 'installment' },
					{ label: 'Recurring Copay (per visit)', value: 'recurring_copay' },
				], defaultValue: 'installment'
			},
			{ key: 'totalAmount', label: 'Total Amount ($)', type: 'number', required: true, placeholder: '0.00 (copay plan: visits x copay)' },
			{ key: 'installments', label: 'Number of Installments / Visits', type: 'number', required: true, placeholder: '6' },
			{ key: 'copayPerVisit', label: 'Copay per Visit ($)', type: 'number', placeholder: 'Blank = total / visits' },
			{ key: 'startDate', label: 'Start Date', type: 'date', defaultValue: () => new Date().toISOString().slice(0, 10) },
			{ key: 'nextDueDate', label: 'Next Due Date', type: 'date' },
			// Status dropdown mirrors the list tabs (QA report 2026-07-10, issue 3) —
			// the New Payment Plan form had no Status field, so plans could only ever
			// start "active" with no way to record another state.
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Active', value: 'active' },
					{ label: 'Completed', value: 'completed' },
					{ label: 'Defaulted', value: 'defaulted' },
					{ label: 'Cancelled', value: 'cancelled' },
				], defaultValue: 'active'
			},
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Plan notes...' },
		],
		// The backend `payment_plan.installment_amount` column is NOT NULL but the
		// form never collects it. Derive it from total / installments before POST.
		beforeSave: (payload) => {
			// A recurring copay plan is a per-visit arrangement. The visit count is the
			// installment count and the copay defaults to total / visits, so the plan
			// form's existing required fields carry it; the marker rides in `notes`
			// because the backend plan table has no column for either.
			const total = Number(payload['totalAmount']) || 0;
			const count = Number(payload['installments']) || 0;
			const explicitCopay = Math.round((Number(payload['copayPerVisit']) || 0) * 100) / 100;
			const perVisit = explicitCopay > 0
				? explicitCopay
				: (count > 0 ? Math.round((total / count) * 100) / 100 : 0);
			const isCopayPlan = String(payload['planType'] ?? '') === 'recurring_copay' && perVisit > 0;
			if (isCopayPlan) {
				payload['notes'] = copayPlanNote(perVisit, count, String(payload['notes'] ?? ''));
			}
			delete payload['planType'];
			delete payload['copayPerVisit'];

			if (total > 0 && count > 0) {
				payload['installmentAmount'] = Math.round((total / count) * 100) / 100;
			} else if (isCopayPlan) {
				payload['installmentAmount'] = perVisit;
			}
			// nextDueDate is NOT NULL on some deployments; default it to the start date.
			if (!payload['nextDueDate'] && payload['startDate']) {
				payload['nextDueDate'] = payload['startDate'];
			}
			return payload;
		},
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Cancel this payment plan?', type: 'warning', primaryButton: 'Cancel Plan' }); if (r.confirmed) { await api.fetch(`/api/payments/plans/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	// Thin stub used when payView === 'ledger' — the ledger is the shared
	// all-patients financial ledger (charges / insurance postings / patient
	// payments / write-offs / patient portions with per-patient running
	// balances) rendered by _loadAndRenderLedger() via patientLedger.ts, NOT
	// the generic list base. The old view required picking a patient first
	// (backend only has /api/payments/ledger/patient/{id}); the team asked for
	// every patient's activity visible at once, so the ledger is now composed
	// client-side from /api/fee-sheets + /api/payments/transactions.
	private readonly _ledgerConfig: ClinicalEditorConfig = {
		title: 'Ledger', apiPath: '/api/payments/transactions',
		searchPlaceholder: '', clientSideFilter: [], columns: [], formFields: [],
		listUrlBuilder: () => null,
	};

	/** All-patients ledger (Payments → Ledger). */
	private async _loadAndRenderLedger(): Promise<void> {
		if (!this.contentEl) { return; }
		DOM.clearNode(this.contentEl);

		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px;';
		const titleEl = DOM.append(toolbar, DOM.$('h2'));
		titleEl.textContent = 'Ledger';
		titleEl.style.cssText = 'font-size:20px;font-weight:600;margin:0;color:var(--vscode-foreground);';
		const sub = DOM.append(toolbar, DOM.$('span'));
		sub.textContent = 'Every charge, insurance payment, write-off, patient payment and patient portion — all patients.';
		sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);flex:1;';
		const refreshBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.textContent = '\u21BB Refresh';
		refreshBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:6px;cursor:pointer;font-size:12px;';
		refreshBtn.addEventListener('click', () => this._loadAndRenderLedger());

		const bodyHost = DOM.append(this.contentEl, DOM.$('div'));
		bodyHost.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';
		const loading = DOM.append(bodyHost, DOM.$('div'));
		loading.textContent = 'Loading ledger…';
		loading.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;';

		const events = await buildLedgerEvents(this.apiService);
		if (this.payView !== 'ledger') { return; }
		// The patient bar (top) doubles as the initial filter — picking a
		// patient there scopes the ledger AND names the generated statement.
		renderLedger(bodyHost, events, {
			showPatientColumn: true,
			initialFilter: this._ledgerFilter ?? this._payPatientName ?? '',
			onFilterChange: value => { this._ledgerFilter = value; },
			actionsHost: this._ledgerActionsHost(),
			exportHost: this._ledgerExportHost(),
			accountName: this._payPatientName || undefined,
		});
	}

	/**
	 * The ledger's two download options (QA 27-Jul): the statement as a real PDF
	 * (rendered through the native host, like the visit summary) and the same
	 * ledger as an Excel workbook.
	 */
	private _ledgerExportHost(): ILedgerExportHost {
		return {
			savePdf: async (fileName, html, printCss) => {
				const saved = await savePrintableAsPdf(this.nativeHostService, fileName, html, printCss);
				if (saved) { this.dialogService.info('Statement saved', saved); }
			},
			loadStatementInfo: patientIds => loadLedgerStatementInfo(this.apiService, patientIds),
			saveWorkbook: async (fileName, data) => {
				const target = URI.joinPath(await this.fileDialogService.defaultFilePath(), fileName);
				await this.fileService.writeFile(target, VSBuffer.wrap(data));
				this.dialogService.info('Ledger exported to Excel', target.fsPath);
			},
			notify: message => this.dialogService.error(message),
		};
	}

	/** Locally-deleted ledger entries persist app-wide (ids embed the patient, so it's naturally per-patient). */
	private static readonly LEDGER_HIDDEN_KEY = 'ciyex.ledger.hiddenEntries';

	/** Actions host (View / Download / Delete) for the all-patients Ledger table. */
	private _ledgerActionsHost(): ILedgerActionsHost {
		return makeLedgerActionsHost({
			loadHidden: () => this.storageSvc.get(PaymentsEditor.LEDGER_HIDDEN_KEY, StorageScope.PROFILE, '[]'),
			storeHidden: json => this.storageSvc.store(PaymentsEditor.LEDGER_HIDDEN_KEY, json, StorageScope.PROFILE, StorageTarget.USER),
			saveFile: (fileName, html) => this._saveLocalFile(fileName, html),
			confirmDelete: async message => (await this.dialogService.confirm({ message, type: 'warning', primaryButton: 'Remove' })).confirmed,
			notify: message => this.dialogService.info(message),
		});
	}

	/** Write an HTML file to the user's default folder (no native Save dialog — unusable in remote sessions). */
	private async _saveLocalFile(fileName: string, html: string): Promise<void> {
		try {
			const defaultDir = await this.fileDialogService.defaultFilePath();
			const target = URI.joinPath(defaultDir, fileName);
			await this.fileService.writeFile(target, VSBuffer.fromString(html));
			this.dialogService.info('Saved', target.fsPath);
		} catch (e) {
			this.dialogService.error('Could not save the file', String(e));
		}
	}

	// allow-any-unicode-next-line
	// ── Patient Credits ────────────────────────────────────────────────────
	// Copay money the front desk collected without naming a claim, and every
	// automatic deduction taken out of it. The whole account is derived from the
	// payment transactions by patientCredit.ts, so this view never stores a
	// balance of its own and can never show one the transactions don't back.

	/** Stub so the abstract config getter resolves; rendering is custom. */
	private readonly _creditsConfig: ClinicalEditorConfig = {
		title: 'Patient Credits', apiPath: '/api/payments/transactions',
		searchPlaceholder: '', clientSideFilter: [], columns: [], formFields: [],
		listUrlBuilder: () => null,
	};

	private _creditAccounts: PatientCreditAccount[] = [];
	private _creditFilter = '';
	private readonly _creditExpanded = new Set<string>();

	private async _loadAndRenderCredits(): Promise<void> {
		if (!this.contentEl) { return; }
		DOM.clearNode(this.contentEl);
		const loading = DOM.append(this.contentEl, DOM.$('div'));
		loading.textContent = 'Loading patient credits…';
		loading.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;';

		const accounts = await loadCreditAccounts(this.apiService);
		if (this.payView !== 'credits') { return; }
		this._creditAccounts = [...accounts.values()].filter(a => a.received > 0.005 || a.applied > 0.005);
		await this._resolveCreditPatientNames();
		this._renderCredits();
	}

	/** Fill in display names the transaction rows didn't carry (cached per editor). */
	private async _resolveCreditPatientNames(): Promise<void> {
		const missing = this._creditAccounts
			.filter(a => !a.patientName && a.patientId && !this._patientNameCache.has(a.patientId))
			.map(a => a.patientId);
		await Promise.all([...new Set(missing)].map(async pid => {
			try {
				const res = await this.apiService.fetch(`/api/patients/${encodeURIComponent(pid)}`);
				if (!res.ok) { return; }
				const p = (await res.json())?.data ?? {};
				const full = `${p?.firstName ?? p?.identification?.firstName ?? ''} ${p?.lastName ?? p?.identification?.lastName ?? ''}`.trim();
				if (full) { this._patientNameCache.set(pid, full); }
			} catch { /* falls back to "Patient #id" */ }
		}));
		for (const a of this._creditAccounts) {
			if (!a.patientName) { a.patientName = this._patientNameCache.get(a.patientId) || ''; }
		}
	}

	private _creditPatientLabel(a: PatientCreditAccount): string {
		return a.patientName || (a.patientId ? `Patient #${a.patientId}` : 'Unknown patient');
	}

	private _renderCredits(): void {
		if (!this.contentEl) { return; }
		DOM.clearNode(this.contentEl);
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;';
		const titleEl = DOM.append(toolbar, DOM.$('h2'));
		titleEl.textContent = 'Patient Credits';
		titleEl.style.cssText = 'font-size:20px;font-weight:600;margin:0;color:var(--vscode-foreground);';
		const sub = DOM.append(toolbar, DOM.$('span'));
		sub.textContent = 'Copays collected up front, held as credit and deducted automatically on later visits.';
		sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);flex:1;';
		const collectBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		collectBtn.textContent = '+ Collect Credit';
		collectBtn.title = this._payPatientId
			? `Collect a payment from ${this._payPatientName} and hold it as credit`
			: 'Pick a patient in the bar above first';
		collectBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
		collectBtn.addEventListener('click', () => { void this._openCollectCreditForm(); });
		const refreshBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.textContent = '\u21BB Refresh';
		refreshBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:6px;cursor:pointer;font-size:12px;';
		refreshBtn.addEventListener('click', () => { void this._loadAndRenderCredits(); });

		// Summary cards over the WHOLE list (not the filter) — the front desk asks
		// "how much money are we holding", which the filter must not change.
		const received = this._creditAccounts.reduce((s, a) => s + a.received, 0);
		const applied = this._creditAccounts.reduce((s, a) => s + a.applied, 0);
		const available = this._creditAccounts.reduce((s, a) => s + a.available, 0);
		const withCredit = this._creditAccounts.filter(a => a.available > 0.005).length;
		const cards = DOM.append(this.contentEl, DOM.$('div'));
		cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;';
		const card = (label: string, value: string, color: string, hint: string) => {
			const c = DOM.append(cards, DOM.$('div'));
			c.title = hint;
			c.style.cssText = `border:1px solid var(--vscode-editorWidget-border);border-top:3px solid ${color};border-radius:8px;padding:10px 14px;background:var(--vscode-editorWidget-background,transparent);`;
			const v = DOM.append(c, DOM.$('div')); v.textContent = value; v.style.cssText = `font-size:18px;font-weight:700;color:${color};`;
			const l = DOM.append(c, DOM.$('div')); l.textContent = label; l.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-top:3px;';
		};
		card('Credit Collected', money(received), 'var(--vscode-foreground)', 'Every payment taken without naming a claim.');
		card('Applied to Visits', money(applied), '#0ea5e9', 'Copays automatically deducted from those credits.');
		card('Available Credit', money(available), '#14b8a6', 'Still on account. It carries forward until it is used up.');
		card('Patients Holding Credit', String(withCredit), '#f59e0b', 'Patients with a balance left to spend.');

		const bar = DOM.append(this.contentEl, DOM.$('div'));
		bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
		const search = DOM.append(bar, DOM.$('input')) as HTMLInputElement;
		search.placeholder = 'Filter by patient...';
		search.value = this._creditFilter;
		search.style.cssText = 'flex:0 0 300px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;';
		const countEl = DOM.append(bar, DOM.$('span'));
		countEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		search.addEventListener('input', () => { this._creditFilter = search.value; renderList(); });

		const scroll = DOM.append(this.contentEl, DOM.$('div'));
		scroll.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px;';

		const renderList = (): void => {
			DOM.clearNode(scroll);
			const q = this._creditFilter.trim().toLowerCase();
			const rows = this._creditAccounts
				.filter(a => !q || `${this._creditPatientLabel(a)} ${a.patientId}`.toLowerCase().includes(q))
				.sort((a, b) => b.available - a.available || (b.lastActivity || '').localeCompare(a.lastActivity || ''));
			countEl.textContent = `${rows.length} account${rows.length === 1 ? '' : 's'}`;
			if (rows.length === 0) {
				const e = DOM.append(scroll, DOM.$('div'));
				e.textContent = q
					? 'No patient matches the filter.'
					: 'No patient credits yet. Collect a copay with "+ Collect Credit" and it is held here until a visit needs it.';
				e.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;';
				return;
			}
			for (const a of rows) { this._renderCreditAccountCard(scroll, a, renderList); }
		};
		renderList();
	}

	/** One patient's credit account: summary header that expands to the full audit trail. */
	private _renderCreditAccountCard(host: HTMLElement, a: PatientCreditAccount, rerender: () => void): void {
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const open = this._creditExpanded.has(a.patientId);
		const accent = a.available > 0.005 ? '#14b8a6' : 'var(--vscode-editorWidget-border)';
		const cardEl = DOM.append(host, DOM.$('div'));
		cardEl.style.cssText = `flex:0 0 auto;border:1px solid var(--vscode-editorWidget-border);border-left:4px solid ${accent};border-radius:8px;overflow:hidden;background:var(--vscode-editorWidget-background,transparent);`;

		const head = DOM.append(cardEl, DOM.$('div'));
		head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;cursor:pointer;flex-wrap:wrap;';
		head.title = open ? 'Hide this account\'s credit history' : 'Show every credit collected and every deduction';
		head.addEventListener('click', () => {
			if (open) { this._creditExpanded.delete(a.patientId); } else { this._creditExpanded.add(a.patientId); }
			rerender();
		});
		const chevron = DOM.append(head, DOM.$('span'));
		// allow-any-unicode-next-line
		chevron.textContent = open ? '\u{2304}' : '\u{203A}';
		chevron.style.cssText = 'width:12px;color:var(--vscode-descriptionForeground);font-size:13px;flex-shrink:0;';

		const ident = DOM.append(head, DOM.$('div'));
		ident.style.cssText = 'flex:1 1 200px;min-width:160px;';
		const nameEl = DOM.append(ident, DOM.$('div'));
		nameEl.textContent = this._creditPatientLabel(a);
		nameEl.style.cssText = 'font-size:13px;font-weight:700;';
		const subEl = DOM.append(ident, DOM.$('div'));
		const counts = `${a.sources.length} credit${a.sources.length === 1 ? '' : 's'} collected  ·  ${a.applications.length} deduction${a.applications.length === 1 ? '' : 's'}`;
		// allow-any-unicode-next-line
		subEl.textContent = a.lastActivity ? `${counts}  ·  last activity ${isoToUsDate(a.lastActivity)}` : counts;
		subEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		const figures = DOM.append(head, DOM.$('div'));
		figures.style.cssText = 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;justify-content:flex-end;';
		const figure = (label: string, text: string, color: string, strong: boolean) => {
			const f = DOM.append(figures, DOM.$('div'));
			f.style.cssText = 'min-width:84px;text-align:right;';
			const v = DOM.append(f, DOM.$('div'));
			v.textContent = text;
			v.style.cssText = `font-size:13px;font-weight:${strong ? '700' : '500'};color:${color};`;
			const l = DOM.append(f, DOM.$('div'));
			l.textContent = label;
			l.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);';
		};
		figure('Collected', money(a.received), 'var(--vscode-descriptionForeground)', false);
		figure('Applied', money(a.applied), '#0ea5e9', false);
		figure('Available', money(a.available), a.available > 0.005 ? '#14b8a6' : 'var(--vscode-descriptionForeground)', true);

		const act = DOM.append(head, DOM.$('div'));
		act.style.cssText = 'display:flex;gap:6px;align-items:center;';
		const actBtn = (label: string, tip: string, color: string, enabled: boolean, run: () => void) => {
			const b = DOM.append(act, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			b.title = tip;
			b.disabled = !enabled;
			b.style.cssText = `padding:4px 9px;background:transparent;border:1px solid ${enabled ? `${color}55` : 'var(--vscode-editorWidget-border)'};color:${enabled ? color : 'var(--vscode-descriptionForeground)'};border-radius:5px;cursor:${enabled ? 'pointer' : 'default'};font-size:11px;`;
			b.addEventListener('click', e => { e.stopPropagation(); if (enabled) { run(); } });
		};
		actBtn('Collect', 'Collect more money onto this credit balance', '#22c55e', true,
			() => { void this._openCollectCreditForm(a); });
		actBtn('Apply', 'Deduct a copay from this credit balance', '#0ea5e9', a.available > 0.005,
			() => { void this._openApplyCreditForm(a); });
		actBtn('Refund', 'Return unused credit to the patient', '#f59e0b', a.available > 0.005,
			() => { void this._openRefundCreditForm(a); });

		if (!open) { return; }

		const body = DOM.append(cardEl, DOM.$('div'));
		body.style.cssText = 'border-top:1px solid var(--vscode-editorWidget-border);background:rgba(128,128,128,0.04);padding-bottom:6px;';

		const section = (title: string, cols: string, headers: string[]): HTMLElement => {
			const h = DOM.append(body, DOM.$('div'));
			h.textContent = title;
			h.style.cssText = 'padding:8px 12px 4px 28px;font-size:11px;font-weight:600;color:var(--vscode-foreground);';
			const hr = DOM.append(body, DOM.$('div'));
			hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:5px 12px 5px 28px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);`;
			for (const t of headers) { DOM.append(hr, DOM.$('span')).textContent = t; }
			return body;
		};
		const row = (cols: string, cells: Array<{ text: string; style?: string }>): void => {
			const r = DOM.append(body, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;align-items:center;padding:6px 12px 6px 28px;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;`;
			for (const c of cells) {
				const s = DOM.append(r, DOM.$('span'));
				s.textContent = c.text;
				s.title = c.text;
				s.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${c.style ?? ''}`;
			}
		};

		const SRC_COLS = '92px 110px minmax(160px,1.4fr) 96px 96px 100px';
		section('Credits collected', SRC_COLS, ['Date', 'Method', 'Description', 'Original', 'Applied', 'Remaining']);
		if (a.sources.length === 0) {
			row(SRC_COLS, [{ text: 'No credits collected.', style: 'grid-column:1/-1;font-style:italic;color:var(--vscode-descriptionForeground);' }]);
		}
		for (const s of a.sources) {
			row(SRC_COLS, [
				// allow-any-unicode-next-line
				{ text: s.date ? isoToUsDate(s.date) : '—' },
				{ text: s.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
				{ text: s.description || 'Patient credit', style: 'color:var(--vscode-descriptionForeground);' },
				{ text: money(s.original), style: 'text-align:right;font-weight:600;' },
				{ text: money(s.applied), style: 'text-align:right;color:#0ea5e9;' },
				{ text: money(s.remaining), style: `text-align:right;font-weight:700;color:${s.remaining > 0.005 ? '#14b8a6' : 'var(--vscode-descriptionForeground)'};` },
			]);
		}

		const APP_COLS = '92px 110px 96px 110px minmax(150px,1fr) 96px 110px';
		section('Deductions (auto-applied copays)', APP_COLS, ['Date', 'Claim #', 'Encounter', 'Type', 'Description', 'Deducted', 'Credit Left']);
		if (a.applications.length === 0) {
			row(APP_COLS, [{ text: 'Nothing deducted yet — the balance carries forward to the next visit.', style: 'grid-column:1/-1;font-style:italic;color:var(--vscode-descriptionForeground);' }]);
		}
		for (const app of a.applications) {
			row(APP_COLS, [
				// allow-any-unicode-next-line
				{ text: app.date ? isoToUsDate(app.date) : '—' },
				// allow-any-unicode-next-line
				{ text: app.claimRef || '—', style: 'font-family:var(--vscode-editor-font-family,monospace);' },
				// allow-any-unicode-next-line
				{ text: app.encounterId || '—' },
				{ text: app.kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
				{ text: app.description, style: 'color:var(--vscode-descriptionForeground);' },
				{ text: money(app.amount), style: 'text-align:right;font-weight:600;color:#0ea5e9;' },
				{ text: money(app.balanceAfter), style: 'text-align:right;font-weight:700;' },
			]);
		}
	}

	/**
	 * Collect money and hold it as credit. No claim and no date of service are
	 * asked for — that is the whole point of the feature (the team: "the payment
	 * is not immediately linked to any specific claim or encounter").
	 */
	private async _openCollectCreditForm(account?: PatientCreditAccount): Promise<void> {
		const patientId = account?.patientId || this._payPatientId;
		const patientName = account ? this._creditPatientLabel(account) : this._payPatientName;
		if (!patientId) {
			await this.dialogService.info('Select a patient in the Patient bar above, then collect the credit.');
			return;
		}
		const result = await showThemedModal({
			title: 'Collect Patient Credit',
			// allow-any-unicode-next-line
			subtitle: `${patientName} — the money is held as available credit and deducted automatically when a copay comes due.`,
			fields: [
				{ key: 'amount', label: 'Amount ($)', type: 'number', required: true, placeholder: '0.00' },
				{
					// Card collection needs a saved payment method (the backend rejects
					// a bare card charge), so cards go through "Patient Pay: Collect
					// Payment" and this form records the non-charging methods.
					key: 'method', label: 'Payment Method', type: 'select', value: 'cash', options: [
						{ label: 'Cash', value: 'cash' }, { label: 'Check', value: 'check' },
						{ label: 'ACH / EFT', value: 'ach' }, { label: 'FSA', value: 'fsa' },
						{ label: 'HSA', value: 'hsa' }, { label: 'Other', value: 'other' },
					],
				},
				{ key: 'note', label: 'Note', type: 'text', placeholder: 'Copay collected at front desk' },
				{ key: 'receiptEmail', label: 'Receipt Email', type: 'text', placeholder: 'patient@email.com' },
			],
			confirmLabel: 'Collect Credit',
			confirmColor: '#22c55e',
			anchor: this.contentEl ?? undefined,
		});
		if (!result) { return; }
		const amount = Number(result['amount']) || 0;
		if (amount <= 0) {
			await this.dialogService.error('Enter an amount greater than 0.');
			return;
		}
		const saved = await recordPatientCredit(this.apiService, {
			patientId, patientName, amount, method: result['method'] || 'cash',
			note: result['note'] || undefined, receiptEmail: result['receiptEmail'] || undefined,
		});
		if (!saved.ok) {
			await this.dialogService.error('Could not record the credit.', saved.error);
			return;
		}
		// allow-any-unicode-next-line
		this.dialogService.info(`$${amount.toFixed(2)} added to ${patientName}'s credit balance.`);
		await this._loadAndRenderCredits();
	}

	/** Manually deduct a copay from a patient's credit (the automatic path uses the same call). */
	private async _openApplyCreditForm(account: PatientCreditAccount): Promise<void> {
		const plan = await resolveVisitCopay(this.apiService, account.patientId);
		const suggested = plan ? Math.min(plan.perVisit, account.available) : account.available;
		const planLine = plan
			// allow-any-unicode-next-line
			? ` Plan copay $${plan.perVisit.toFixed(2)} per visit (${plan.label}).`
			: '';
		const result = await showThemedModal({
			title: 'Apply Credit to a Visit',
			// allow-any-unicode-next-line
			subtitle: `${this._creditPatientLabel(account)} — $${account.available.toFixed(2)} available.${planLine}`,
			fields: [
				{ key: 'amount', label: 'Amount to Deduct ($)', type: 'number', required: true, value: suggested.toFixed(2) },
				{ key: 'claimRef', label: 'Claim # (optional)', type: 'text', placeholder: 'CLM-0018' },
				{ key: 'encounterId', label: 'Encounter ID (optional)', type: 'text', placeholder: '15868' },
				{
					key: 'kind', label: 'Applies To', type: 'select', value: 'copay', options: [
						{ label: 'Copay', value: 'copay' }, { label: 'Deductible', value: 'deductible' },
						{ label: 'Coinsurance', value: 'coinsurance' }, { label: 'Balance', value: 'payment' },
					],
				},
			],
			confirmLabel: 'Deduct from Credit',
			confirmColor: '#0ea5e9',
			anchor: this.contentEl ?? undefined,
		});
		if (!result) { return; }
		const due = Number(result['amount']) || 0;
		if (due <= 0) {
			await this.dialogService.error('Enter an amount greater than 0.');
			return;
		}
		const applied = await applyPatientCredit(this.apiService, {
			patientId: account.patientId, patientName: account.patientName, due,
			claimRef: result['claimRef'] || '', encounterId: result['encounterId'] || undefined,
			kind: result['kind'] || 'copay', reason: 'applied manually',
		});
		if (applied.applied <= 0) {
			await this.dialogService.error('Nothing was deducted — the credit balance could not cover it.');
			return;
		}
		this.dialogService.info(
			// allow-any-unicode-next-line
			`Deducted $${applied.applied.toFixed(2)} — $${applied.remaining.toFixed(2)} credit left.`
			+ (applied.shortfall > 0.005 ? ` $${applied.shortfall.toFixed(2)} stays as patient responsibility.` : ''));
		await this._loadAndRenderCredits();
	}

	/** Give unused credit back to the patient. */
	private async _openRefundCreditForm(account: PatientCreditAccount): Promise<void> {
		const result = await showThemedModal({
			title: 'Refund Unused Credit',
			// allow-any-unicode-next-line
			subtitle: `${this._creditPatientLabel(account)} — $${account.available.toFixed(2)} available to refund.`,
			fields: [
				{ key: 'amount', label: 'Refund Amount ($)', type: 'number', required: true, value: account.available.toFixed(2) },
				{
					key: 'method', label: 'Refund Method', type: 'select', value: 'cash', options: [
						{ label: 'Cash', value: 'cash' }, { label: 'Check', value: 'check' },
						{ label: 'Credit Card', value: 'credit_card' }, { label: 'ACH / EFT', value: 'ach' },
					],
				},
				{ key: 'reason', label: 'Reason', type: 'text', placeholder: 'Patient requested refund' },
			],
			confirmLabel: 'Refund Credit',
			confirmColor: '#f59e0b',
			anchor: this.contentEl ?? undefined,
		});
		if (!result) { return; }
		const amount = Number(result['amount']) || 0;
		if (amount <= 0 || amount > account.available + 0.005) {
			await this.dialogService.error(`Enter an amount between $0.01 and $${account.available.toFixed(2)}.`);
			return;
		}
		const ok = await refundPatientCredit(this.apiService, {
			patientId: account.patientId, patientName: account.patientName, amount,
			method: result['method'] || 'cash', reason: result['reason'] || undefined,
		});
		if (!ok) {
			await this.dialogService.error('Could not record the refund. Please try again.');
			return;
		}
		await this._loadAndRenderCredits();
	}

	// Thin stub used only when payView === 'methods' to satisfy the abstract
	// config getter — actual rendering is done by _loadAndRenderCards().
	private readonly _methodsConfig: ClinicalEditorConfig = {
		title: 'Payment Methods', apiPath: '/api/credit-cards',
		searchPlaceholder: '', clientSideFilter: [], columns: [], formFields: [],
	};

	// Thin stub used when payView === 'invoices' — invoices live on the
	// ciyex-patient-pay service (a different host), so rendering is custom and
	// done by _loadAndRenderInvoices() rather than the generic list base.
	private readonly _invoicesConfig: ClinicalEditorConfig = {
		title: 'Invoices', apiPath: '/api/patient-pay/invoices',
		searchPlaceholder: '', clientSideFilter: [], columns: [], formFields: [],
	};

	// Thin stub used when payView === 'encounter-billing' — the encounter-billing
	// grid is custom (one row per signed-encounter fee sheet) and rendered by
	// _loadAndRenderEncounterBilling() rather than the generic list base.
	private readonly _encounterBillingConfig: ClinicalEditorConfig = {
		title: 'Payment Dashboard', apiPath: '/api/fee-sheets',
		searchPlaceholder: '', clientSideFilter: [], columns: [], formFields: [],
		// Returning null short-circuits the generic base loader (no fetch / no
		// error UI) — the custom grid is rendered by _loadAndRenderEncounterBilling().
		listUrlBuilder: () => null,
	};

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		// The base setInput kicks off the generic loader; custom views (which the
		// generic list base can't render) take over here on first open.
		if (this.payView === 'encounter-billing') {
			this._loadAndRenderEncounterBilling();
		} else if (this.payView === 'insurance-posting') {
			this._loadAndRenderInsurancePosting();
		} else if (this.payView === 'invoices') {
			this._loadAndRenderInvoices();
		} else if (this.payView === 'methods') {
			this._loadAndRenderCards();
		} else if (this.payView === 'ledger') {
			this._loadAndRenderLedger();
		} else if (this.payView === 'credits') {
			this._loadAndRenderCredits();
		}
	}

	// @ts-ignore — override abstract readonly with getter
	protected get config(): ClinicalEditorConfig {
		switch (this.payView) {
			case 'encounter-billing': return this._encounterBillingConfig;
			case 'credits': return this._creditsConfig;
			case 'methods': return this._methodsConfig;
			case 'invoices': return this._invoicesConfig;
			case 'plans': return this._plansConfig;
			case 'ledger': return this._ledgerConfig;
			case 'insurance-posting': return this._insurancePostingConfig;
			default: return this._transactionsConfig;
		}
	}

	protected override _resetAndReload(): void {
		if (this.payView === 'encounter-billing') {
			this._loadAndRenderEncounterBilling();
		} else if (this.payView === 'insurance-posting') {
			this._loadAndRenderInsurancePosting();
		} else if (this.payView === 'methods') {
			this._loadAndRenderCards();
		} else if (this.payView === 'invoices') {
			this._loadAndRenderInvoices();
		} else if (this.payView === 'ledger') {
			this._loadAndRenderLedger();
		} else if (this.payView === 'credits') {
			this._loadAndRenderCredits();
		} else {
			super._resetAndReload();
		}
	}

	protected override createEditor(parent: HTMLElement): void {
		const tabRow = parent.ownerDocument.createElement('div');
		tabRow.style.cssText = 'display:flex;border-bottom:2px solid var(--vscode-editorWidget-border);padding:0 24px;background:var(--vscode-editor-background);overflow-x:auto;';
		parent.appendChild(tabRow);

		const payTabBtns: HTMLButtonElement[] = [];
		const stylePayBtn = (btn: HTMLButtonElement, active: boolean) => {
			btn.style.borderBottomColor = active ? '#0e639c' : 'transparent';
			btn.style.color = active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)';
			btn.style.fontWeight = active ? '600' : '400';
		};
		// Team renames (meeting 2026-07-22): "Encounter Billing" → "Dashboard",
		// "Transactions" → "Patient Balance"; the views themselves are unchanged.
		// `hidden` keeps a view's implementation intact while taking its tab out
		// of the bar (team request 2026-07-27: hide Payment Methods, do not
		// delete it) — flip the flag back to bring the tab straight back.
		const payTabs: Array<{ view: 'encounter-billing' | 'transactions' | 'insurance-posting' | 'methods' | 'plans' | 'ledger' | 'invoices' | 'credits'; label: string; hidden?: boolean }> = [
			{ view: 'encounter-billing', label: 'Dashboard' },
			{ view: 'transactions', label: 'Patient Balance' },
			{ view: 'insurance-posting', label: 'Insurance Posting' },
			{ view: 'credits', label: 'Patient Credits' },
			{ view: 'methods', label: 'Payment Methods', hidden: true },
			{ view: 'plans', label: 'Payment Plans' },
			{ view: 'ledger', label: 'Ledger' },
		];
		// A hidden tab must not stay selected from a previous session.
		if (payTabs.some(t => t.view === this.payView && t.hidden)) {
			this.payView = 'encounter-billing';
		}
		payTabs.filter(t => !t.hidden).forEach(({ view, label }) => {
			const btn = parent.ownerDocument.createElement('button') as HTMLButtonElement;
			btn.textContent = label;
			const isActive = this.payView === view;
			btn.style.cssText = `padding:8px 16px;border:none;background:none;cursor:pointer;font-size:12px;border-bottom:2px solid ${isActive ? '#0e639c' : 'transparent'};margin-bottom:-2px;color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};font-weight:${isActive ? '600' : '400'};white-space:nowrap;`;
			btn.addEventListener('click', () => {
				if (this.payView !== view) {
					this.payView = view;
					payTabBtns.forEach(b => { stylePayBtn(b, b === btn); });
					this._syncPayPatientBar();
					this._resetAndReload();
				}
			});
			payTabBtns.push(btn);
			tabRow.appendChild(btn);
		});

		this._buildPayPatientBar(parent);
		super.createEditor(parent);
		this._syncPayPatientBar();
	}

	/**
	 * Patient picker shown for the patient-scoped Methods / Plans / Ledger views.
	 * Typing 2+ chars searches /api/patients; picking a result scopes the list
	 * to that patient (the only way the backend serves cards/plans/ledger data).
	 */
	private _buildPayPatientBar(parent: HTMLElement): void {
		const doc = parent.ownerDocument;
		const bar = doc.createElement('div');
		bar.style.cssText = 'display:none;align-items:center;gap:10px;padding:10px 24px 0;position:relative;';
		const label = doc.createElement('span');
		label.textContent = 'Patient:';
		label.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		bar.appendChild(label);

		const wrap = doc.createElement('div');
		wrap.style.cssText = 'position:relative;width:320px;';
		const input = doc.createElement('input');
		input.type = 'text';
		input.placeholder = 'Search patient by name...';
		input.value = this._payPatientName;
		input.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		wrap.appendChild(input);

		const dropdown = doc.createElement('div');
		dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;max-height:220px;overflow-y:auto;background:var(--vscode-editorWidget-background,#1e1e1e);color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.45);z-index:50;display:none;margin-top:2px;';
		wrap.appendChild(dropdown);
		bar.appendChild(wrap);

		let debounce: ReturnType<typeof setTimeout> | undefined;
		input.addEventListener('input', () => {
			const q = input.value.trim();
			if (debounce) { clearTimeout(debounce); }
			// Emptying the picker releases the patient scope instead of leaving the
			// previous selection silently in force (and re-seeding the ledger filter
			// with that name on the next reload).
			if (!q && this._payPatientId) {
				this._payPatientId = '';
				this._payPatientName = '';
				this._ledgerFilter = undefined;
				dropdown.style.display = 'none';
				this._resetAndReload();
				return;
			}
			if (q.length < 2) { dropdown.style.display = 'none'; return; }
			debounce = setTimeout(async () => {
				let list: Array<Record<string, unknown>> = [];
				try {
					const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
					if (res.ok) {
						const data = await res.json();
						const w = data?.data ?? data;
						list = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
					}
				} catch { /* ignore */ }
				DOM.clearNode(dropdown);
				if (list.length === 0) { dropdown.style.display = 'none'; return; }
				for (const p of list.slice(0, 10)) {
					const name = `${String(p.firstName || '')} ${String(p.lastName || '')}`.trim() || String(p.name || p.id);
					const pid = String(p.id ?? p.patientId ?? '');
					const row = doc.createElement('div');
					row.textContent = pid ? `${name} (MRN ${pid})` : name;
					row.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.08);';
					row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
					row.addEventListener('mouseleave', () => { row.style.background = ''; });
					row.addEventListener('mousedown', (e) => {
						e.preventDefault();
						this._payPatientId = pid;
						this._payPatientName = name;
						// A fresh patient pick re-scopes the ledger filter too.
						this._ledgerFilter = undefined;
						input.value = name;
						dropdown.style.display = 'none';
						this._resetAndReload();
					});
					dropdown.appendChild(row);
				}
				dropdown.style.display = 'block';
			}, 250);
		});
		input.addEventListener('blur', () => { setTimeout(() => { dropdown.style.display = 'none'; }, 200); });

		// The statement download lives on the ledger toolbar itself now (PDF +
		// Excel, the only two options the team wants), so the patient bar carries
		// just the picker.
		parent.appendChild(bar);
		this._payPatientBar = bar;
	}

	private _syncPayPatientBar(): void {
		if (this._payPatientBar) {
			// Methods is patient-scoped too (cards list/create live under
			// /api/credit-cards/patient/{id}), so it shares the patient picker.
			// Credits lists every patient, but "Collect Credit" needs one selected —
			// the shared picker is how the front desk names them.
			// Ledger does NOT use this picker to scope its data — per the comment
			// on _ledgerConfig, the ledger is composed client-side from EVERY
			// patient's activity, and picking a name here only pre-seeds the
			// ledger's own filter box below. That made it read as two redundant
			// search boxes (QA: "remove the top search bar"), so it's hidden here.
			this._payPatientBar.style.display =
				(this.payView === 'plans' || this.payView === 'methods' || this.payView === 'credits') ? 'flex' : 'none';
		}
	}

	// allow-any-unicode-next-line
	// ── Encounter Billing ──────────────────────────────────────────────────
	// One row per signed-encounter fee sheet (created via the Fee Sheet editor's
	// "Send to Billing"). Mirrors the OpenEMR Payment Dashboard: charges with
	// Pay Amount, Total Fee/Paid/Balance, billing + payment status, and per-row
	// Edit / Complete (collect) / Invoice / Ledger actions. Collecting a payment
	// that clears the balance auto-generates the patient invoice.

	private _billingRows: Array<Record<string, unknown>> = [];
	private _billingLoading = false;
	/** What the user typed in the Dashboard's own filter box (QA: the Dashboard
	 *  had no search at all while every other Payments page did). */
	private _billingFilter = '';

	private _normalizeBillingRow(d: Record<string, unknown>): Record<string, unknown> {
		const items = (d.items as Array<Record<string, unknown>>) || [];
		const codes = items.length
			? items.map(it => String(it.code ?? '')).filter(Boolean).join(', ')
			: String(d.codes ?? '');
		const totalFee = Number(d.total ?? d.totalFee ?? items.reduce((s, it) => s + (Number(it.price ?? 0) * Number(it.qty ?? 1)), 0)) || 0;
		const totalPaid = Number(d.totalPaid ?? d.paidAmount ?? 0) || 0;
		return {
			id: d.id !== undefined && d.id !== null ? String(d.id) : '',
			encounterId: String(d.encounterId ?? ''),
			patientId: String(d.patientId ?? ''),
			patientName: String(d.patientName ?? d.patient ?? ''),
			clinician: String(d.renderingProviderName ?? d.clinician ?? d.renderingProvider ?? ''),
			encounterDate: String(d.encounterDate ?? d.serviceDate ?? d.createdAt ?? '').slice(0, 10),
			codes,
			totalFee,
			// What the fee-sheet record itself reports as collected. The authoritative
			// figure is recomputed by _applyPaymentActivity, which also counts the
			// payment transactions the fee-sheet record never learns about (a
			// patient-responsibility collection just flips pending transactions to
			// completed — it never touches the sheet). Keep the raw value so the two
			// sources can be reconciled instead of double-counted.
			sheetPaid: totalPaid,
			totalPaid,
			balance: Math.max(0, totalFee - totalPaid),
			billingStatus: String(d.billingStatus ?? 'Unbilled'),
			billedMode: String(d.billedMode ?? 'cash'),
			paymentStatus: String(d.paymentStatus ?? (totalPaid <= 0 ? 'None' : totalPaid >= totalFee ? 'Paid' : 'Partial')),
			comments: String(d.comments ?? ''),
			// The claim number is derived from the auto-increment fee-sheet id —
			// shown once the sheet is billed (billing creates the claim).
			claimNumber: d.id !== undefined && d.id !== null ? claimNumberForFeeSheet(String(d.id)) : '',
			// Raw fee-sheet items kept for the RCM-lite X12 837 export.
			rawItems: items,
			// Filled by _applyPaymentActivity from the payment transactions.
			insurancePaid: 0,
			writeOff: 0,
			respAssigned: 0,
			/** Patient-responsibility transactions still sitting in `pending`. */
			respPending: 0,
			patientPortion: 0,
			eobPosted: false,
			// Filled by _applyInvoiceFlags from the patient-pay invoice list.
			invoiced: false,
		};
	}

	private async _loadAndRenderEncounterBilling(): Promise<void> {
		if (!this.contentEl) { return; }
		this._billingLoading = true;
		try {
			await this._refreshBillingRows();
			// Copay auto-deductible: a visit that needs a copay takes it out of the
			// patient's credit balance before anyone is asked to pay again. Anything
			// deducted changes the numbers, so the rows are re-derived afterwards.
			if (!this._autoCreditBusy) {
				this._autoCreditBusy = true;
				try {
					if (await this._autoApplyPatientCredits()) { await this._refreshBillingRows(); }
				} finally {
					this._autoCreditBusy = false;
				}
			}
			await this._stampCreditBalances();
		} catch {
			this._billingRows = [];
		}
		this._billingLoading = false;
		this._renderEncounterBilling();
	}

	/** Reload the fee sheets and re-derive every money figure on them. */
	private async _refreshBillingRows(): Promise<void> {
		const res = await this.apiService.fetch('/api/fee-sheets');
		if (res.ok) {
			const data = await res.json();
			const w = data?.data ?? data;
			const list = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
			this._billingRows = list.map(d => this._normalizeBillingRow(d));
		} else {
			this._billingRows = [];
		}
		await this._applyPaymentActivity();
		await this._applyInvoiceFlags();
	}

	/** Guards the auto-deduction against re-entering through its own reload. */
	private _autoCreditBusy = false;
	/** patientId -> available credit, stamped onto the rows for the Credit column. */
	private _creditByPatient = new Map<string, number>();
	/** patientId -> per-visit copay resolved from the plan / coverage (cached per pass). */
	private readonly _visitCopayCache = new Map<string, number>();

	/** Put each row's patient credit balance on the row for the Credit column. */
	private async _stampCreditBalances(): Promise<void> {
		const accounts = await loadCreditAccounts(this.apiService);
		this._creditByPatient = new Map([...accounts].map(([pid, a]) => [pid, a.available]));
		for (const row of this._billingRows) {
			row.patientCredit = this._creditByPatient.get(String(row.patientId ?? '')) ?? 0;
		}
	}

	/**
	 * Deduct the copay each open visit needs from the patient's available credit.
	 *
	 * What counts as "the copay due" for a row, in order:
	 *  1. the patient responsibility an EOB already assigned (copay + deductible
	 *     + coinsurance still pending on the claim);
	 *  2. otherwise the recurring per-visit copay - a payment plan marked as a
	 *     recurring copay plan, else the active coverage's copay amount - but only
	 *     once per claim, and only while the insurance side is still open.
	 *
	 * The deduction is always capped at the claim balance AND at the credit on
	 * hand, so the balance can never go negative and anything the credit cannot
	 * cover simply stays as patient responsibility.
	 *
	 * Returns true when at least one deduction was written.
	 */
	private async _autoApplyPatientCredits(): Promise<boolean> {
		if (this.configurationService.getValue<boolean>('ciyex.billing.autoApplyPatientCredit') === false) { return false; }
		if (this._billingRows.length === 0) { return false; }
		const accounts = await loadCreditAccounts(this.apiService);
		if (accounts.size === 0) { return false; }

		const available = new Map<string, number>();
		// Claims that have already drawn on the credit balance — a recurring copay
		// must be taken ONCE per visit, not again on every dashboard refresh.
		const funded = new Set<string>();
		for (const [pid, account] of accounts) {
			available.set(pid, account.available);
			for (const app of account.applications) {
				if (app.claimRef) { funded.add(`${pid}|${normalizeClaimRef(app.claimRef)}`); }
			}
		}
		if ([...available.values()].every(v => v <= 0.005)) { return false; }

		let changed = false;
		for (const row of this._billingRows) {
			const patientId = String(row.patientId ?? '');
			if (!patientId) { continue; }
			const credit = available.get(patientId) ?? 0;
			const balance = Number(row.balance ?? 0);
			if (credit <= 0.005 || balance <= 0.005) { continue; }
			const claimRef = String(row.claimNumber || claimNumberForFeeSheet(String(row.id)));
			const key = `${patientId}|${normalizeClaimRef(claimRef)}`;

			let due = Number(row.patientPortion ?? 0);
			let kind = 'copay';
			if (due <= 0.005) {
				// No EOB responsibility yet. A recurring plan copay is collectable at
				// the visit; an adjudicated claim's remainder is not (it belongs to the
				// payer until an EOB says otherwise).
				if (funded.has(key) || row.eobPosted) { continue; }
				due = await this._visitCopayFor(patientId);
				kind = 'copay';
			}
			const target = Math.min(due, balance, credit);
			if (target <= 0.005) { continue; }

			const result = await applyPatientCredit(this.apiService, {
				patientId, patientName: String(row.patientName ?? ''), due: target,
				claimRef, encounterId: String(row.encounterId ?? '') || undefined,
				serviceDate: String(row.encounterDate ?? '') || undefined, kind,
				reason: 'auto-deducted from patient credit',
			});
			if (result.applied > 0.005) {
				changed = true;
				available.set(patientId, result.remaining);
				funded.add(key);
			}
		}
		return changed;
	}

	/** The fixed per-visit copay for a patient (recurring plan, else coverage). */
	private async _visitCopayFor(patientId: string): Promise<number> {
		const cached = this._visitCopayCache.get(patientId);
		if (cached !== undefined) { return cached; }
		const plan = await resolveVisitCopay(this.apiService, patientId);
		const perVisit = plan?.perVisit ?? 0;
		this._visitCopayCache.set(patientId, perVisit);
		return perVisit;
	}

	/**
	 * Reflect ALL payment activity onto the dashboard rows in one pass over
	 * `/api/payments/transactions` — the single source of truth the Patient
	 * Balance tab and the Ledger also read, so the three views agree.
	 *
	 * Two classes of transaction land on a row (matched by claim reference — the
	 * X12 export uses `FS{feeSheetId}`, so `CLM-0012`, `FS12` and `12` all
	 * resolve to fee sheet 12 — or by an explicit feeSheetId / encounterId):
	 *
	 *  1. EOB postings: insurance payment + contractual write-off reduce the
	 *     balance; the copay/deductible/coinsurance becomes the patient
	 *     responsibility.
	 *  2. Patient money: COMPLETED transactions are collections; the still
	 *     PENDING copay/deductible/coinsurance records are what the patient
	 *     still owes.
	 *
	 * Counting (2) is what fixes the balance after a collection: collecting a
	 * patient portion only flips those pending transactions to completed, and
	 * the fee-sheet record's own `totalPaid` never moves — so the dashboard used
	 * to snap straight back to the pre-collection balance and kept advertising a
	 * Patient Portion that had already been paid.
	 */
	private async _applyPaymentActivity(): Promise<void> {
		if (this._billingRows.length === 0) { return; }
		let txns: Array<Record<string, unknown>> = [];
		try {
			const res = await this.apiService.fetch('/api/payments/transactions');
			if (!res.ok) { return; }
			const data = await res.json();
			const w = data?.data ?? data;
			txns = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
		} catch { return; }

		const round2 = (n: number) => Math.round(n * 100) / 100;
		const byRef = new Map<string, Record<string, unknown>>();
		for (const row of this._billingRows) {
			// Normalized keys make `CLM-0012`, `FS12` and `12` all match row 12
			// (claim numbers are CLM-…, legacy postings used FS…).
			if (row.id) {
				byRef.set(`fs${row.id}`, row); byRef.set(String(row.id), row);
				byRef.set(normalizeClaimRef(String(row.id)), row);
				byRef.set(normalizeClaimRef(String(row.claimNumber ?? '')), row);
			}
			if (row.encounterId) { byRef.set(String(row.encounterId), row); byRef.set(normalizeClaimRef(String(row.encounterId)), row); }
		}
		const resolve = (ref: string): Record<string, unknown> | undefined => {
			const r = ref.trim().toLowerCase();
			if (!r) { return undefined; }
			return byRef.get(r) || byRef.get(r.replace(/^fs-?/, '')) || byRef.get(normalizeClaimRef(r));
		};

		/** Patient money already collected, per row id. */
		const collectedByRow = new Map<Record<string, unknown>, number>();
		for (const txn of txns) {
			const desc = String(txn['description'] ?? '');
			const status = String(txn['status'] ?? '').toLowerCase();
			const type = String(txn['transactionType'] ?? '');
			const amount = Number(txn['amount']) || 0;

			if (desc.startsWith('EOB posting') || type === 'insurance_payment') {
				const row = resolve(desc.match(/claim=([^;|]+)/)?.[1] ?? '');
				if (!row) { continue; }
				row.eobPosted = true;
				row.insurancePaid = Number(row.insurancePaid || 0) + (parseEobField(desc, 'paid') ?? amount);
				row.writeOff = Number(row.writeOff || 0) + (parseEobField(desc, 'writeoff') ?? 0);
				row.respAssigned = Number(row.respAssigned || 0) + (parseEobField(desc, 'resp') ?? 0);
				continue;
			}

			// Patient-side transaction. Prefer the explicit fee-sheet / encounter
			// linkage the Dashboard's own collect writes, then the claim reference
			// the EOB flow embeds in the description.
			const row = resolve(String(txn['claimId'] ?? ''))
				?? resolve(String(txn['feeSheetId'] ?? ''))
				?? resolve(String(txn['encounterId'] ?? ''))
				?? resolve(desc.match(/claim[= ]([A-Za-z0-9-]+)/)?.[1] ?? '')
				// Legacy Dashboard collections carried only "Encounter {id} — codes".
				?? resolve(desc.match(/encounter\s+([A-Za-z0-9-]+)/i)?.[1] ?? '');
			if (!row) { continue; }
			if (status === 'pending' && ['copay', 'deductible', 'coinsurance'].includes(type)) {
				row.respPending = Number(row.respPending || 0) + amount;
			} else if (status === 'completed' && amount > 0) {
				collectedByRow.set(row, (collectedByRow.get(row) || 0) + amount);
			} else if (status === 'refunded' && amount > 0) {
				collectedByRow.set(row, (collectedByRow.get(row) || 0) - amount);
			}
		}

		for (const row of this._billingRows) {
			const totalFee = Number(row.totalFee || 0);
			const insurancePaid = round2(Number(row.insurancePaid || 0));
			const writeOff = round2(Number(row.writeOff || 0));
			// The fee-sheet record and the transaction list describe the SAME patient
			// money whenever both were updated, so take the larger of the two rather
			// than their sum (which would double-count a Dashboard collection).
			const patientPaid = round2(Math.max(Number(row.sheetPaid || 0), collectedByRow.get(row) || 0));
			row.insurancePaid = insurancePaid;
			row.writeOff = writeOff;
			row.totalPaid = patientPaid;
			const balance = round2(Math.max(0, totalFee - insurancePaid - writeOff - patientPaid));
			row.balance = balance;

			// What the patient still owes: the pending responsibility records when the
			// EOB created them, otherwise the EOB-assigned responsibility net of what
			// has already been collected. Either way it can never exceed the balance.
			const respPending = round2(Number(row.respPending || 0));
			const assignedOutstanding = Math.max(0, round2(Number(row.respAssigned || 0) - patientPaid));
			row.patientPortion = round2(Math.min(respPending > 0 ? respPending : assignedOutstanding, balance));

			if (!row.eobPosted && patientPaid <= 0) { continue; }
			row.paymentStatus = balance <= 0 ? 'Paid' : ((patientPaid + insurancePaid) > 0 ? 'Partial' : 'None');
			if (balance <= 0) { row.billingStatus = 'Paid'; }
			else if (row.eobPosted) {
				// Dashboard stage: adjudicated-but-open encounters show "EOB Posted"
				// (the front desk still owes a patient-portion collection).
				row.billingStatus = 'EOB Posted';
			}
		}
	}

	/**
	 * Mark rows whose encounter already has a patient-pay invoice — the
	 * dashboard's "Invoice" column shows the full process closed out
	 * (billed → EOB posted → patient paid → invoiced). Cosmetic; fails soft
	 * when the patient-pay service is unreachable.
	 */
	private async _applyInvoiceFlags(): Promise<void> {
		if (this._billingRows.length === 0) { return; }
		// Locally-generated invoices (patient-pay unreachable) count too.
		const local = this._readLocalInvoices();
		for (const row of this._billingRows) {
			const num = local[String(row.id)];
			if (num) { row.invoiced = true; row.invoiceNumber = num; }
		}
		try {
			const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices`, { headers: this._patientPayHeaders() });
			if (!res.ok) { return; }
			const data = await res.json();
			const w = (data?.data ?? data) as { content?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
			const invoices = (Array.isArray(w) ? w : (w?.content || [])) as Array<Record<string, unknown>>;
			// `feeSheetId` / `encounterId` are not columns on a patient-pay invoice
			// (the entity has no such fields, so they were dropped on create and this
			// flag never lit up). The linkage is written into `notes` instead.
			const byFeeSheet = new Set<string>();
			const byEncounter = new Set<string>();
			for (const inv of invoices) {
				const notes = String(inv['notes'] ?? '');
				const fs = notes.match(/feeSheet=([A-Za-z0-9-]+)/)?.[1];
				const enc = notes.match(/encounter=([A-Za-z0-9-]+)/)?.[1];
				if (fs) { byFeeSheet.add(fs); }
				if (enc) { byEncounter.add(enc); }
			}
			for (const row of this._billingRows) {
				if (row.invoiced) { continue; }
				row.invoiced = (!!row.id && byFeeSheet.has(String(row.id)))
					|| (!!row.encounterId && byEncounter.has(String(row.encounterId)));
			}
		} catch { /* indicator stays off */ }
	}

	private _renderEncounterBilling(): void {
		if (!this.contentEl) { return; }
		DOM.clearNode(this.contentEl);

		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px;';
		const titleEl = DOM.append(toolbar, DOM.$('h2'));
		titleEl.textContent = 'Payment Dashboard';
		titleEl.style.cssText = 'font-size:20px;font-weight:600;margin:0;color:var(--vscode-foreground);';
		const refreshBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		refreshBtn.textContent = '\u21BB Refresh';
		refreshBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:6px;cursor:pointer;font-size:12px;';
		refreshBtn.addEventListener('click', () => this._loadAndRenderEncounterBilling());

		// Summary cards.
		const totalCharges = this._billingRows.reduce((s, r) => s + Number(r.totalFee || 0), 0);
		const totalPaid = this._billingRows.reduce((s, r) => s + Number(r.totalPaid || 0), 0);
		const totalInsurance = this._billingRows.reduce((s, r) => s + Number(r.insurancePaid || 0), 0);
		const totalPatientPortion = this._billingRows.reduce((s, r) => s + Number(r.patientPortion || 0), 0);
		const cards = DOM.append(this.contentEl, DOM.$('div'));
		cards.style.cssText = 'display:flex;gap:16px;margin-bottom:16px;';
		const card = (label: string, value: string, color: string): void => {
			const c = DOM.append(cards, DOM.$('div'));
			c.style.cssText = 'flex:0 0 200px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px 18px;text-align:center;';
			const v = DOM.append(c, DOM.$('div'));
			v.textContent = value; v.style.cssText = `font-size:22px;font-weight:700;color:${color};`;
			const l = DOM.append(c, DOM.$('div'));
			l.textContent = label; l.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		};
		const totalBalance = this._billingRows.reduce((s, r) => s + Number(r.balance || 0), 0);
		card('Total Charges', `$${totalCharges.toFixed(2)}`, 'var(--vscode-foreground)');
		card('Total Paid', `$${totalPaid.toFixed(2)}`, '#22c55e');
		card('Insurance Paid', `$${totalInsurance.toFixed(2)}`, '#3b9edd');
		card('Patient Portion', `$${totalPatientPortion.toFixed(2)}`, '#f59e0b');
		card('Outstanding Balance', `$${totalBalance.toFixed(2)}`, totalBalance > 0 ? '#ef4444' : '#22c55e');

		// Search — same row (directly below the summary cards, above the table)
		// as every other Payments page (Patient Balance, Insurance Posting,
		// Ledger). The Dashboard previously had no search at all (QA: "keep the
		// search bar... same place across all 4 payment section pages").
		const tb = DOM.append(this.contentEl, DOM.$('div'));
		tb.style.cssText = 'display:flex;margin-bottom:12px;';
		const searchEl = DOM.append(tb, DOM.$('input')) as HTMLInputElement;
		searchEl.placeholder = 'Search by patient, claim #, clinician...';
		searchEl.value = this._billingFilter;
		searchEl.style.cssText = 'flex:0 0 560px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;';
		searchEl.addEventListener('input', () => { this._billingFilter = searchEl.value; this._renderEncounterBilling(); });

		const scroll = DOM.append(this.contentEl, DOM.$('div'));
		scroll.style.cssText = 'flex:1;min-height:0;overflow:auto;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';

		const COLS = 'minmax(115px,1.1fr) minmax(100px,0.9fr) 92px 82px 90px 100px 85px 90px 82px 82px 95px 88px 110px 90px 100px 72px minmax(110px,1fr) 196px';
		const header = DOM.append(scroll, DOM.$('div'));
		header.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;padding:9px 12px;position:sticky;top:0;background:var(--vscode-editor-background);border-bottom:2px solid var(--vscode-editorWidget-border);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);z-index:1;`;
		for (const h of ['Patient', 'Clinician', 'Enc. Date', 'Claim #', 'Codes', 'Pay Amount', 'Total Fee', 'Patient Paid', 'Ins Paid', 'Balance', 'Patient Portion', 'Credit', 'Billing Status', 'Billed Mode', 'Pay Status', 'Invoice', 'Comments', 'Action']) {
			DOM.append(header, DOM.$('span')).textContent = h;
		}

		if (this._billingLoading) {
			const l = DOM.append(scroll, DOM.$('div'));
			l.textContent = 'Loading…'; l.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;';
			return;
		}
		if (this._billingRows.length === 0) {
			const e = DOM.append(scroll, DOM.$('div'));
			e.textContent = 'No encounter charges yet. Use the Fee Sheet "Send to Billing" action to create one.';
			e.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;';
			return;
		}

		const q = this._billingFilter.trim().toLowerCase();
		const visibleRows = q
			? this._billingRows.filter(row => [row.patientName, row.claimNumber, row.clinician].some(v => String(v ?? '').toLowerCase().includes(q)))
			: this._billingRows;
		if (visibleRows.length === 0) {
			const e = DOM.append(scroll, DOM.$('div'));
			e.textContent = 'No charges match your search.';
			e.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;';
			return;
		}

		const inputStyle = 'width:100%;box-sizing:border-box;padding:4px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
		const localInvoices = this._readLocalInvoices();

		for (const row of visibleRows) {
			const r = DOM.append(scroll, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;align-items:center;padding:7px 12px;border-top:1px solid rgba(128,128,128,0.08);font-size:12px;`;

			const nameEl = DOM.append(r, DOM.$('span')); nameEl.textContent = String(row.patientName || `Patient #${row.patientId}`); nameEl.style.fontWeight = '500';
			DOM.append(r, DOM.$('span')).textContent = String(row.clinician || '—');
			DOM.append(r, DOM.$('span')).textContent = String(row.encounterDate || '—');
			// The claim exists once the sheet is billed (billing creates it).
			const claimEl = DOM.append(r, DOM.$('span'));
			const isBilled = String(row.billingStatus || 'Unbilled') !== 'Unbilled';
			claimEl.textContent = isBilled ? String(row.claimNumber || '—') : '—';
			claimEl.style.cssText = 'font-family:var(--vscode-editor-font-family,monospace);font-size:11px;';
			claimEl.title = isBilled ? 'Auto-increment claim number created when the fee sheet was sent to billing.' : 'Send to billing to create the claim.';
			const codesEl = DOM.append(r, DOM.$('span')); codesEl.textContent = String(row.codes || '—'); codesEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; codesEl.title = String(row.codes || '');

			// After an EOB posts, the front desk collects the PATIENT PORTION, not
			// the full balance — pre-fill Pay Amount with it when assigned.
			const patientPortion = Number(row.patientPortion || 0);
			const payInp = DOM.append(r, DOM.$('input')) as HTMLInputElement;
			payInp.type = 'number'; payInp.step = '0.01';
			payInp.value = (patientPortion > 0 ? patientPortion : Number(row.balance || 0)).toFixed(2);
			payInp.style.cssText = inputStyle;

			DOM.append(r, DOM.$('span')).textContent = `$${Number(row.totalFee || 0).toFixed(2)}`;
			const insurancePaid = Number(row.insurancePaid || 0);
			const paidEl = DOM.append(r, DOM.$('span')); paidEl.textContent = `$${Number(row.totalPaid || 0).toFixed(2)}`; paidEl.style.color = '#22c55e';
			const insEl = DOM.append(r, DOM.$('span'));
			insEl.textContent = insurancePaid > 0 ? `$${insurancePaid.toFixed(2)}` : '—';
			insEl.style.color = insurancePaid > 0 ? '#3b9edd' : 'var(--vscode-descriptionForeground)';
			if (Number(row.writeOff || 0) > 0) {
				insEl.title = `Insurance paid $${insurancePaid.toFixed(2)} (contractual write-off $${Number(row.writeOff || 0).toFixed(2)})`;
			}
			const balEl = DOM.append(r, DOM.$('span')); balEl.textContent = `$${Number(row.balance || 0).toFixed(2)}`; balEl.style.color = Number(row.balance || 0) > 0 ? '#ef4444' : 'var(--vscode-descriptionForeground)';
			const portionEl = DOM.append(r, DOM.$('span'));
			portionEl.textContent = patientPortion > 0 ? `$${patientPortion.toFixed(2)}` : '—';
			portionEl.style.color = patientPortion > 0 ? '#f59e0b' : 'var(--vscode-descriptionForeground)';
			if (patientPortion > 0) { portionEl.title = 'Copay + deductible + coinsurance assigned by the insurance EOB — collect this from the patient.'; }

			// Credit on hand for this patient. When it covers the portion due, the
			// automatic deduction has usually already taken it — the column is how
			// the front desk sees why the patient owes less than the EOB said.
			const patientCredit = Number(row.patientCredit || 0);
			const creditEl = DOM.append(r, DOM.$('span'));
			// allow-any-unicode-next-line
			creditEl.textContent = patientCredit > 0.005 ? `$${patientCredit.toFixed(2)}` : '—';
			creditEl.style.color = patientCredit > 0.005 ? '#14b8a6' : 'var(--vscode-descriptionForeground)';
			creditEl.title = patientCredit > 0.005
				? 'Unapplied credit on this patient\'s account. A copay due on this visit is deducted from it automatically.'
				: 'No unapplied credit on this account.';

			const billSel = DOM.append(r, DOM.$('select')) as HTMLSelectElement;
			billSel.style.cssText = inputStyle;
			for (const opt of ['Unbilled', 'Billed', 'EOB Posted', 'Paid']) {
				const o = DOM.append(billSel, DOM.$('option')) as HTMLOptionElement; o.value = opt; o.textContent = opt;
			}
			billSel.value = String(row.billingStatus || 'Unbilled');
			billSel.addEventListener('change', () => { row.billingStatus = billSel.value; });

			const modeSel = DOM.append(r, DOM.$('select')) as HTMLSelectElement;
			modeSel.style.cssText = inputStyle;
			for (const opt of [['cash', 'Cash'], ['check', 'Check'], ['credit_card', 'Card'], ['ach', 'ACH']]) {
				const o = DOM.append(modeSel, DOM.$('option')) as HTMLOptionElement; o.value = opt[0]; o.textContent = opt[1];
			}
			modeSel.value = String(row.billedMode || 'cash');
			modeSel.addEventListener('change', () => { row.billedMode = modeSel.value; });

			const paySel = DOM.append(r, DOM.$('select')) as HTMLSelectElement;
			paySel.style.cssText = inputStyle;
			for (const opt of ['None', 'Partial', 'Paid']) {
				const o = DOM.append(paySel, DOM.$('option')) as HTMLOptionElement; o.value = opt; o.textContent = opt;
			}
			paySel.value = String(row.paymentStatus || 'None');
			paySel.addEventListener('change', () => { row.paymentStatus = paySel.value; });

			const invEl = DOM.append(r, DOM.$('span'));
			// An invoice generated on this workstation (patient-pay unreachable) was
			// saved as a PDF, NOT emailed — say so rather than claiming a delivery
			// that never happened.
			const localInvoice = row.id ? localInvoices[String(row.id)] : undefined;
			const emailed = !localInvoice || localInvoice.emailed === true;
			// allow-any-unicode-next-line
			invEl.textContent = row.invoiced ? (emailed ? '✓ Sent' : '✓ PDF') : '—';
			invEl.style.cssText = `text-align:center;font-weight:600;color:${row.invoiced ? (emailed ? '#22c55e' : '#f59e0b') : 'var(--vscode-descriptionForeground)'};`;
			invEl.title = !row.invoiced
				? 'No invoice yet — collecting the full balance auto-generates it.'
				: !localInvoice
					? 'Patient invoice created and emailed for this encounter.'
					: emailed
						? `Invoice ${localInvoice.number} generated here and emailed to the patient.`
						: `Invoice ${localInvoice.number} generated here as a PDF but NOT emailed — the patient has no email address on file, or the practice SMTP is not configured (Settings > Notifications).`;

			const commentInp = DOM.append(r, DOM.$('input')) as HTMLInputElement;
			commentInp.value = String(row.comments || ''); commentInp.style.cssText = inputStyle;
			commentInp.addEventListener('input', () => { row.comments = commentInp.value; });

			// Actions
			const act = DOM.append(r, DOM.$('div'));
			act.style.cssText = 'display:flex;gap:6px;align-items:center;';
			const actBtn = (icon: string, title: string, color: string, handler: () => void): void => {
				const b = DOM.append(act, DOM.$('button')) as HTMLButtonElement;
				b.textContent = icon; b.title = title;
				b.style.cssText = `background:transparent;border:none;cursor:pointer;font-size:14px;color:${color};padding:2px;`;
				b.addEventListener('click', handler);
			};
			actBtn('\u270F\uFE0F', 'Edit fee sheet', 'var(--vscode-textLink-foreground)', () => this._editBillingRow(row));
			actBtn('\u2705', 'Collect payment', '#22c55e', () => this._completeBillingRow(row, Number(payInp.value) || 0, modeSel.value));
			if (patientCredit > 0.005) {
				actBtn('\u{1F4B3}', `Apply $${Math.min(patientCredit, Number(payInp.value) || 0).toFixed(2)} from this patient's $${patientCredit.toFixed(2)} credit balance`, '#14b8a6',
					() => { void this._applyCreditToBillingRow(row, Number(payInp.value) || 0); });
			}
			// The X12 837 download was dropped from this action column (team request
			// 2026-07-27). Claims can still be exported as 837P from the Operations
			// side menu's Claims rows, which is where clearinghouse work belongs.
			actBtn('\u{1F9FE}', 'Generate invoice, show PDF & email patient', 'var(--vscode-textLink-foreground)', () => this._invoiceBillingRow(row));
			actBtn('\u{1F4D2}', 'Open ledger', 'var(--vscode-descriptionForeground)', () => this._openLedgerForRow(row));
		}
	}

	/**
	 * Pay a visit out of the patient's credit balance from the Dashboard row.
	 * The same call the automatic pass uses, so a manual apply and an automatic
	 * one leave identical records behind.
	 */
	private async _applyCreditToBillingRow(row: Record<string, unknown>, requested: number): Promise<void> {
		const credit = Number(row.patientCredit || 0);
		const balance = Number(row.balance || 0);
		const portion = Number(row.patientPortion || 0);
		// Default to what the row is actually asking for, never more than is owed.
		const want = requested > 0 ? requested : (portion > 0 ? portion : balance);
		const due = Math.min(want, balance, credit);
		if (due <= 0.005) {
			await this.dialogService.info('Nothing to apply — this visit has no open balance the credit can cover.');
			return;
		}
		const claimRef = String(row.claimNumber || claimNumberForFeeSheet(String(row.id)));
		const confirmed = await this.dialogService.confirm({
			// allow-any-unicode-next-line
			message: `Deduct $${due.toFixed(2)} from this patient's $${credit.toFixed(2)} credit balance for claim ${claimRef}?`,
			type: 'question', primaryButton: 'Apply Credit',
		});
		if (!confirmed.confirmed) { return; }
		const result = await applyPatientCredit(this.apiService, {
			patientId: String(row.patientId ?? ''), patientName: String(row.patientName ?? ''), due,
			claimRef, encounterId: String(row.encounterId ?? '') || undefined,
			serviceDate: String(row.encounterDate ?? '') || undefined,
			kind: portion > 0 ? 'copay' : 'payment', reason: 'applied from the payment dashboard',
		});
		if (result.applied <= 0.005) {
			await this.dialogService.error('Nothing was deducted — the credit balance could not cover it.');
			return;
		}
		this.dialogService.info(
			// allow-any-unicode-next-line
			`Applied $${result.applied.toFixed(2)} from credit — $${result.remaining.toFixed(2)} left on account.`
			+ (result.shortfall > 0.005 ? ` $${result.shortfall.toFixed(2)} stays as patient responsibility.` : ''));
		await this._loadAndRenderEncounterBilling();
	}

	private _editBillingRow(row: Record<string, unknown>): void {
		// Re-open the fee sheet editor for this encounter to adjust charges.
		this.commandService.executeCommand('ciyex.openFeeSheet', String(row.encounterId || ''), String(row.patientId || ''), String(row.patientName || ''), `Encounter ${row.encounterId}`)
			.then(undefined, () => { /* command may be unavailable */ });
	}

	private async _completeBillingRow(row: Record<string, unknown>, payAmount: number, method: string): Promise<void> {
		if (!payAmount || payAmount <= 0) {
			await this.dialogService.info('Enter a Pay Amount greater than 0 before collecting.');
			return;
		}
		try {
			// If the EOB posting already moved this claim's copay / deductible /
			// coinsurance to the Transactions tab as PENDING patient-pay
			// transactions, collecting the matching amount completes THOSE instead
			// of adding a duplicate charge.
			const settledPending = await this._completePendingPatientResp(row, payAmount, method);
			if (!settledPending) {
				const claimNo = String(row.claimNumber || claimNumberForFeeSheet(String(row.id)));
				// `feeSheetId` / `encounterId` are NOT columns on a payment
				// transaction (the backend DTO drops them), so the claim number has
				// to ride in fields that ARE persisted — `claimId` and the
				// description — or nothing can match this payment back to its
				// encounter and the collected money never reduces the row's balance.
				const payload = {
					patientId: row.patientId,
					patientName: row.patientName,
					amount: payAmount,
					transactionType: 'payment',
					paymentMethodType: method,
					// allow-any-unicode-next-line
					description: `Patient payment — claim ${claimNo} (encounter ${row.encounterId}) — ${row.codes}`,
					status: 'completed',
					referenceType: 'claim',
					claimId: claimNo,
					dateOfService: String(row.encounterDate || '') || undefined,
					feeSheetId: row.id,
					encounterId: row.encounterId,
				};
				const res = await this.apiService.fetch('/api/payments/collect', { method: 'POST', body: JSON.stringify(payload) });
				if (!res.ok) {
					await this.dialogService.error(`Payment failed (${res.status}).`);
					return;
				}
			}
			// The remaining balance nets off insurance and the contractual write-off
			// too — computing it as `totalFee - patientPaid` (as this used to) left a
			// fully-settled encounter still showing the insurance-covered amount as
			// an open balance right after the collection.
			const newPaid = Number(row.totalPaid || 0) + payAmount;
			const newBalance = Math.max(0, Number(row.totalFee || 0) - newPaid
				- Number(row.insurancePaid || 0) - Number(row.writeOff || 0));

			// Auto-generate the invoice once the encounter balance is cleared — the
			// patient receives the invoice without anyone creating it manually.
			if (newBalance <= 0.005) {
				await this._invoiceBillingRow({ ...row, totalPaid: newPaid }, true);
			}
			// Re-derive every figure from the server (fee sheets + transactions)
			// instead of patching the row in place: a patient-responsibility
			// collection only flips pending transactions to completed, so the local
			// arithmetic and the reloaded data disagreed and the balance "jumped
			// back" on the next refresh.
			await this._loadAndRenderEncounterBilling();
		} catch (e) {
			await this.dialogService.error(`Payment failed: ${e}`);
		}
	}

	/**
	 * Settle the claim's pending patient-responsibility transactions (created by
	 * the EOB posting for copay / deductible / coinsurance) with the collected
	 * amount. Records are completed oldest-first until the money runs out; a
	 * record only partly covered is reduced to its remainder and the covered
	 * part is written as its own completed transaction, so a part-payment leaves
	 * the correct amount still showing as due.
	 *
	 * Returns true when the collection was settled that way; false lets the
	 * caller record a fresh transaction (nothing pending on this claim).
	 */
	private async _completePendingPatientResp(row: Record<string, unknown>, payAmount: number, method: string): Promise<boolean> {
		const claimNo = String(row.claimNumber || claimNumberForFeeSheet(String(row.id)));
		let pendings: Array<Record<string, unknown>> = [];
		try {
			const res = await this.apiService.fetch('/api/payments/transactions');
			if (!res.ok) { return false; }
			const data = await res.json();
			const w = data?.data ?? data;
			const txns = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
			pendings = txns.filter(t => String(t['status'] ?? '') === 'pending'
				&& ['copay', 'deductible', 'coinsurance'].includes(String(t['transactionType'] ?? ''))
				&& String(t['description'] ?? '').includes(`claim ${claimNo}`));
		} catch { return false; }
		if (pendings.length === 0) { return false; }

		const { settled, remaining } = await this._settlePendingTransactions(pendings, payAmount, method, {
			patientId: row.patientId, patientName: row.patientName, claimId: claimNo,
		});
		// Money left over after every pending record was cleared is an extra
		// payment on the encounter — book it as its own completed charge.
		if (settled > 0 && remaining > 0.005) {
			await this.apiService.fetch('/api/payments/collect', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					patientId: row.patientId, patientName: row.patientName, amount: remaining,
					transactionType: 'payment', paymentMethodType: method, status: 'completed',
					referenceType: 'claim', claimId: claimNo,
					// allow-any-unicode-next-line
					description: `Patient payment — claim ${claimNo} (encounter ${row.encounterId})`,
				}),
			});
		}
		// Once any pending flipped to completed, never also POST the caller's
		// fresh transaction — that would double-charge the patient ledger.
		return settled > 0;
	}

	/**
	 * Apply `payAmount` to a list of PENDING transactions, oldest first. A record
	 * the money fully covers flips to `completed`; the one it only partly covers
	 * is reduced to its remainder and the collected slice is written as its own
	 * completed transaction, so the patient's remaining balance stays exact.
	 * Returns how many records were touched and any money left over.
	 */
	private async _settlePendingTransactions(
		pendings: Array<Record<string, unknown>>, payAmount: number, method: string,
		ctx: { patientId: unknown; patientName: unknown; claimId?: string; note?: string },
	): Promise<{ settled: number; remaining: number }> {
		const round2 = (n: number) => Math.round(n * 100) / 100;
		let remaining = round2(payAmount);
		let settled = 0;
		for (const t of pendings) {
			if (remaining <= 0.005) { break; }
			const due = round2(Number(t['amount']) || 0);
			if (due <= 0) { continue; }
			if (remaining + 0.005 >= due) {
				const res = await this.apiService.fetch(`/api/payments/transactions/${t['id']}`, {
					method: 'PUT', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ status: 'completed', paymentMethodType: method }),
				});
				if (res.ok) { settled++; remaining = round2(remaining - due); }
				continue;
			}
			// Part payment: shrink what is still owed and book the collected slice.
			const paidNow = remaining;
			const putRes = await this.apiService.fetch(`/api/payments/transactions/${t['id']}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ amount: round2(due - paidNow) }),
			});
			if (!putRes.ok) { break; }
			const type = String(t['transactionType'] ?? 'payment');
			await this.apiService.fetch('/api/payments/collect', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					patientId: ctx.patientId, patientName: ctx.patientName, amount: paidNow,
					transactionType: type, paymentMethodType: method, status: 'completed',
					referenceType: 'claim', claimId: ctx.claimId,
					// allow-any-unicode-next-line
					description: `Patient payment — part of ${type} for claim ${ctx.claimId || '(unlinked)'}${ctx.note ? ` — ${ctx.note}` : ''}`,
				}),
			});
			settled++;
			remaining = 0;
		}
		return { settled, remaining };
	}

	/**
	 * Collect against specific pending transaction ids — the Patient Balance
	 * tab's "Collect Payment" row action. The row may be a merged patient-resp
	 * display record standing in for several backing transactions.
	 */
	private async _collectPendingTransactions(ids: string[], amount: number, method: string, item: Record<string, unknown>, note: string): Promise<boolean> {
		let pendings: Array<Record<string, unknown>> = [];
		try {
			const res = await this.apiService.fetch('/api/payments/transactions');
			if (!res.ok) { return false; }
			const data = await res.json();
			const w = data?.data ?? data;
			const txns = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
			const wanted = new Set(ids);
			pendings = txns.filter(t => wanted.has(String(t['id'])) && String(t['status'] ?? '').toLowerCase() === 'pending');
		} catch { return false; }
		if (pendings.length === 0) { return false; }
		const claimId = String(item['claimRef'] ?? '')
			|| String(item['description'] ?? '').match(/claim[= ]([A-Za-z0-9-]+)/)?.[1]
			|| '';
		const { settled } = await this._settlePendingTransactions(pendings, amount, method, {
			patientId: item['patientId'], patientName: item['patientName'], claimId, note,
		});
		return settled > 0;
	}

	/** Refresh the Dashboard's cached rows without stealing the current view. */
	private async _loadEncounterBillingSilently(): Promise<void> {
		if (this.payView === 'encounter-billing') { await this._loadAndRenderEncounterBilling(); return; }
		try {
			const res = await this.apiService.fetch('/api/fee-sheets');
			if (!res.ok) { return; }
			const data = await res.json();
			const w = data?.data ?? data;
			const list = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
			this._billingRows = list.map(d => this._normalizeBillingRow(d));
			await this._applyPaymentActivity();
			await this._applyInvoiceFlags();
		} catch { /* the Dashboard reloads on its next open anyway */ }
	}

	/**
	 * Invoice an encounter.
	 *
	 * The invoice record belongs to ciyex-patient-pay, but that service is a
	 * separate deployment that most environments do not expose to the desktop
	 * app: the derived host (`patient-pay-api…`) simply does not resolve unless
	 * someone sets `ciyex.patientPay.apiUrl`, so every attempt died in the
	 * `catch` below as "Invoice generation failed: TypeError: Failed to fetch"
	 * and no invoice was ever produced.
	 *
	 * So the invoice is now always produced: patient-pay is tried first (and
	 * still owns emailing when it is reachable), and when it is not the invoice
	 * is generated locally as a PDF from the same encounter data and recorded so
	 * the Dashboard's Invoice column reflects it.
	 */
	private async _invoiceBillingRow(row: Record<string, unknown>, silent = false): Promise<void> {
		const total = Number(row.totalFee || 0);
		const paid = Number(row.totalPaid || 0) + Number(row.insurancePaid || 0) + Number(row.writeOff || 0);
		const payload: Record<string, unknown> = {
			patientId: row.patientId,
			patientName: row.patientName,
			totalAmount: total,
			balanceDue: Math.max(0, Math.round((total - paid) * 100) / 100),
			status: 'SENT',
			// patient-pay has no feeSheet/encounter columns, so the linkage rides in
			// `notes` in a form _applyInvoiceFlags can match again.
			notes: `feeSheet=${row.id}; encounter=${row.encounterId}; claim=${row.claimNumber || claimNumberForFeeSheet(String(row.id))}; codes=${row.codes}`,
		};
		// The patient email is needed so patient-pay can email the statement. Pull
		// it from the patient record (the billing row doesn't carry it).
		const rowEmail = String(row.patientEmail || '');
		if (rowEmail) {
			payload['patientEmail'] = rowEmail;
		} else if (row.patientId) {
			try {
				const pr = await this.apiService.fetch(`/api/patients/${encodeURIComponent(String(row.patientId))}`);
				if (pr.ok) {
					const pd = await pr.json();
					const patient = (pd?.data ?? pd) as Record<string, unknown>;
					const email = String(patient?.email ?? patient?.patientEmail ?? patient?.emailAddress ?? '');
					if (email) { payload['patientEmail'] = email; }
				}
			} catch { /* email lookup is best-effort */ }
		}
		let failure = '';
		try {
			const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices`, { method: 'POST', headers: this._patientPayHeaders(), body: JSON.stringify(payload) });
			if (res.ok) {
				// Trigger the send workflow so the patient is emailed the invoice
				// with the statement PDF attached (and a portal download link).
				const created = (await res.json().catch(() => ({}))) as Record<string, unknown>;
				const createdData = (created['data'] ?? created) as Record<string, unknown>;
				const invId = String(createdData['id'] ?? '');
				const invNo = String(createdData['invoiceNumber'] ?? invId);
				this._recordLocalInvoice(row, invNo);
				if (invId) {
					try {
						await fetch(`${this._patientPayBase()}/api/patient-pay/invoices/${encodeURIComponent(invId)}/send`, { method: 'POST', headers: this._patientPayHeaders() });
					} catch { /* email is best-effort; invoice is already created */ }
					// Show the generated PDF (skip for the silent auto-on-payment path).
					if (!silent) { await this._showInvoicePdf(invId, invNo); }
				}
				if (!silent) { await this.dialogService.info('Invoice generated, shown, and emailed to the patient with the statement PDF attached.'); }
				return;
			}
			const detail = await res.text().catch(() => '');
			failure = `the billing service returned ${res.status}${detail ? ` (${detail.slice(0, 160)})` : ''}`;
		} catch (e) {
			failure = `the billing service is unreachable at ${this._patientPayBase()} (${e instanceof Error ? e.message : String(e)})`;
		}
		await this._generateLocalInvoice(row, failure, silent);
	}

	/** Invoice numbers minted locally when patient-pay is unavailable. */
	private static readonly LOCAL_INVOICE_KEY = 'ciyex.payments.localInvoices';

	/** What a locally-generated invoice recorded: its number and whether it was emailed. */
	private _readLocalInvoices(): Record<string, { number: string; emailed?: boolean }> {
		try {
			const parsed = JSON.parse(this.storageSvc.get(PaymentsEditor.LOCAL_INVOICE_KEY, StorageScope.PROFILE, '{}'));
			if (!parsed || typeof parsed !== 'object') { return {}; }
			const out: Record<string, { number: string; emailed?: boolean }> = {};
			for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
				// Entries written before invoices could be emailed are plain strings.
				if (typeof v === 'string') { out[k] = { number: v }; }
				else if (v && typeof v === 'object') { out[k] = v as { number: string; emailed?: boolean }; }
			}
			return out;
		} catch { return {}; }
	}

	private _recordLocalInvoice(row: Record<string, unknown>, invoiceNumber: string, emailed = false): void {
		const map = this._readLocalInvoices();
		map[String(row.id)] = { number: invoiceNumber, emailed };
		this.storageSvc.store(PaymentsEditor.LOCAL_INVOICE_KEY, JSON.stringify(map), StorageScope.PROFILE, StorageTarget.USER);
		row.invoiced = true;
		row.invoiceNumber = invoiceNumber;
		row.invoiceEmailed = emailed;
	}

	/**
	 * Email the patient their invoice through the EHR's OWN notification channel
	 * (`/api/notifications/send` -> per-practice SMTP from Settings >
	 * Notifications) — the same path the appointment confirmations and the
	 * insurance-posting statements deliver on.
	 *
	 * The patient-pay route is NOT usable for this: it delivers through
	 * ciyex-comm, whose SMTP credentials fail, and in most environments the
	 * patient-pay host does not even resolve. Returns why it could not send so
	 * the caller can tell the user rather than silently claiming delivery.
	 */
	private async _emailInvoiceToPatient(row: Record<string, unknown>, invoiceNumber: string, figures: { total: number; insurance: number; writeOff: number; patientPaid: number; balance: number }): Promise<{ sent: boolean; reason: string }> {
		const patientId = String(row.patientId ?? '');
		let email = String(row.patientEmail ?? '').trim();
		if (!email && patientId) {
			try {
				const pr = await this.apiService.fetch(`/api/patients/${encodeURIComponent(patientId)}`);
				if (pr.ok) {
					const pd = await pr.json();
					const patient = (pd?.data ?? pd) as Record<string, unknown>;
					email = String(patient?.['email'] ?? patient?.['patientEmail'] ?? patient?.['emailAddress'] ?? '').trim();
				}
			} catch { /* handled by the empty check below */ }
		}
		if (!email) { return { sent: false, reason: 'the patient record has no email address' }; }

		const send: Record<string, unknown> = {
			channelType: 'email',
			recipient: email,
			subject: figures.balance > 0
				? `Invoice ${invoiceNumber} — amount due $${figures.balance.toFixed(2)}`
				: `Invoice ${invoiceNumber} — paid in full`,
			body: this._buildInvoiceEmail(row, invoiceNumber, figures),
			triggerType: 'invoice',
		};
		// The notification log keys patients by numeric id; a FHIR-style id would
		// blow up the Long conversion server-side, so only send it when numeric.
		if (/^\d+$/.test(patientId)) { send['patientId'] = Number(patientId); }
		try {
			const res = await this.apiService.fetch('/api/notifications/send', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(send),
			});
			if (!res.ok) { return { sent: false, reason: `the notification service returned ${res.status}` }; }
			const data = await res.json().catch(() => null) as Record<string, unknown> | null;
			const log = (data?.['data'] ?? data) as Record<string, unknown> | null;
			// The endpoint answers 200 even when SMTP rejected the message — the
			// log row's status is the only truthful signal.
			const status = String(log?.['status'] ?? '').toLowerCase();
			if (status === '' || status === 'sent' || status === 'queued') { return { sent: true, reason: email }; }
			return { sent: false, reason: `SMTP reported "${status}" (check Settings > Notifications)` };
		} catch (e) {
			return { sent: false, reason: `the notification service is unreachable (${e instanceof Error ? e.message : String(e)})` };
		}
	}

	/** The invoice email body: the itemised charges, the totals and what is owed. */
	private _buildInvoiceEmail(row: Record<string, unknown>, invoiceNumber: string, f: { total: number; insurance: number; writeOff: number; patientPaid: number; balance: number }): string {
		const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
		const th = 'padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:right;font-size:12px;color:#374151;';
		const thL = th.replace('text-align:right', 'text-align:left');
		const td = 'padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-size:12px;color:#111;';
		const tdL = td.replace('text-align:right', 'text-align:left');
		const items = (row.rawItems as Array<Record<string, unknown>>) || [];
		const rows = items
			.filter(it => String(it['type'] ?? '') !== 'ICD10' && it['code'])
			.map(it => {
				const qty = Number(it['qty'] ?? 1) || 1;
				const price = Number(it['price'] ?? 0) || 0;
				return `<tr><td style="${tdL}"><strong>${esc(it['code'])}</strong>${it['description'] ? ` &mdash; ${esc(it['description'])}` : ''}</td>`
					+ `<td style="${td}">${qty}</td><td style="${td}">${money(price)}</td><td style="${td}"><strong>${money(price * qty)}</strong></td></tr>`;
			}).join('');
		const dos = isoToUsDate(String(row.encounterDate || '')) || String(row.encounterDate || '');
		const summary = (label: string, value: string, bold = false) =>
			`<tr><td style="${tdL}">${esc(label)}</td><td style="${td}">${bold ? `<strong>${value}</strong>` : value}</td></tr>`;
		return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:640px;">
<h2 style="margin:0 0 4px;font-size:18px;">Invoice ${esc(invoiceNumber)}</h2>
<p style="margin:0 0 14px;font-size:12px;color:#555;">${esc(String(row.patientName || 'Patient'))}${dos ? ` &nbsp;|&nbsp; Date of service ${esc(dos)}` : ''} &nbsp;|&nbsp; Claim ${esc(String(row.claimNumber || ''))}</p>
<table style="border-collapse:collapse;width:100%;margin-bottom:14px;">
<thead><tr><th style="${thL}">Service</th><th style="${th}">Qty</th><th style="${th}">Unit</th><th style="${th}">Amount</th></tr></thead>
<tbody>${rows || `<tr><td style="${tdL}" colspan="4">No itemised charges recorded.</td></tr>`}</tbody>
</table>
<table style="border-collapse:collapse;width:320px;">
${summary('Total charges', money(f.total))}
${summary('Insurance paid', money(f.insurance))}
${summary('Adjustments', money(f.writeOff))}
${summary('Already paid by you', money(f.patientPaid))}
${summary('Amount due', money(f.balance), true)}
</table>
<p style="margin:14px 0 0;font-size:13px;">${f.balance > 0
				? `Please pay <strong>${money(f.balance)}</strong>. Contact the practice if you have any questions about this invoice.`
				: 'This visit is paid in full. Thank you.'}</p>
</div>`;
	}

	/**
	 * Produce the invoice without the patient-pay service: render it from the
	 * encounter's own charges and save it as a PDF the front desk can hand or
	 * mail to the patient. The invoice number is minted from the claim number so
	 * it stays stable for the encounter.
	 */
	private async _generateLocalInvoice(row: Record<string, unknown>, reason: string, silent: boolean): Promise<void> {
		const claimNo = String(row.claimNumber || claimNumberForFeeSheet(String(row.id)));
		const invoiceNumber = `INV-${claimNo}`;
		const total = Number(row.totalFee || 0);
		const insurance = Number(row.insurancePaid || 0);
		const writeOff = Number(row.writeOff || 0);
		const patientPaid = Number(row.totalPaid || 0);
		const balance = Math.max(0, Math.round((total - insurance - writeOff - patientPaid) * 100) / 100);
		const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

		const items = (row.rawItems as Array<Record<string, unknown>>) || [];
		const lineRows = items
			.filter(it => String(it['type'] ?? '') !== 'ICD10' && it['code'])
			.map(it => {
				const qty = Number(it['qty'] ?? 1) || 1;
				const price = Number(it['price'] ?? 0) || 0;
				return `<tr><td>${esc(it['code'])}</td><td>${esc(it['description'] ?? '')}</td><td class="amt">${qty}</td><td class="amt">${money(price)}</td><td class="amt">${money(price * qty)}</td></tr>`;
			}).join('\n');

		const html = `<div class="stmt">
<h1>Invoice ${esc(invoiceNumber)}</h1>
<div class="meta">Patient: <b>${esc(row.patientName || `Patient #${row.patientId}`)}</b> &nbsp;|&nbsp; Claim ${esc(claimNo)} &nbsp;|&nbsp; Date of service ${esc(isoToUsDate(String(row.encounterDate || '')) || String(row.encounterDate || ''))} &nbsp;|&nbsp; Issued ${esc(new Date().toLocaleDateString('en-US'))}</div>
<table>
<thead><tr><th>Code</th><th>Description</th><th class="amt">Qty</th><th class="amt">Unit</th><th class="amt">Amount</th></tr></thead>
<tbody>${lineRows || '<tr><td colspan="5">No itemised charges recorded.</td></tr>'}</tbody>
</table>
<table class="summary">
<tr><th>Total charges</th><td class="amt">${money(total)}</td><th>Insurance paid</th><td class="amt">${money(insurance)}</td></tr>
<tr><th>Adjustments</th><td class="amt">${money(writeOff)}</td><th>Patient paid</th><td class="amt">${money(patientPaid)}</td></tr>
<tr><th>Balance due</th><td class="amt"><b>${money(balance)}</b></td><th></th><td></td></tr>
</table>
<div class="due">${balance > 0 ? `Amount due: <b>${money(balance)}</b>. Please remit on receipt.` : 'This encounter is paid in full. Thank you.'}</div>
</div>`;

		// Email the patient their invoice over the EHR's own SMTP channel. This is
		// what actually reaches the patient — patient-pay's own send goes through
		// ciyex-comm, whose credentials fail.
		const figures = { total, insurance, writeOff, patientPaid, balance };
		const mail = await this._emailInvoiceToPatient(row, invoiceNumber, figures);

		// The auto-invoice fired by a completed collection must not interrupt the
		// front desk with a Save dialog — it records (and emails) the invoice and
		// leaves the document to the row's own Invoice action.
		if (silent) {
			this._recordLocalInvoice(row, invoiceNumber, mail.sent);
			this._renderEncounterBilling();
			return;
		}
		try {
			const saved = await savePrintableAsPdf(this.nativeHostService, `${invoiceNumber}.pdf`, html);
			if (saved) {
				// Only a saved document counts as invoiced — a cancelled Save dialog
				// must not light up the Dashboard's Invoice column.
				this._recordLocalInvoice(row, invoiceNumber, mail.sent);
				await this.dialogService.info(
					mail.sent ? `Invoice ${invoiceNumber} generated and emailed.` : `Invoice ${invoiceNumber} generated.`,
					`${saved}\n\n${mail.sent
						? `Emailed to ${mail.reason}.`
						: `NOT emailed: ${mail.reason}.`}\n\nThe invoice was produced by this workstation because ${reason}.`);
			} else {
				await this.dialogService.info(`Invoice ${invoiceNumber} was not saved (the Save dialog was cancelled).`,
					mail.sent ? `It was still emailed to ${mail.reason}.` : undefined);
				if (mail.sent) { this._recordLocalInvoice(row, invoiceNumber, true); }
			}
			this._renderEncounterBilling();
		} catch (e) {
			if (!silent) {
				await this.dialogService.error('Invoice generation failed',
					`${reason}, and the local invoice could not be rendered either: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}

	private _openLedgerForRow(row: Record<string, unknown>): void {
		this._payPatientId = String(row.patientId || '');
		this._payPatientName = String(row.patientName || '');
		// Opening the ledger for a row scopes it to that patient, so any filter
		// the user had typed on a previous visit no longer applies.
		this._ledgerFilter = undefined;
		this.payView = 'ledger';
		this._syncPayPatientBar();
		this._resetAndReload();
	}

	// allow-any-unicode-next-line
	// ── Invoices (ciyex-patient-pay) ───────────────────────────────────────
	// Invoices are owned by the separate ciyex-patient-pay service, not the EHR
	// API, so these helpers resolve that base + auth headers directly (the same
	// way ciyexCommands' patient-pay flow does).

	/**
	 * Resolve the ciyex-patient-pay base URL. Order: the `ciyex.patientPay.apiUrl`
	 * setting, then the `ciyex_patient_pay_api_url` localStorage override, then a
	 * host derived from the EHR API URL by swapping the `api` segment for
	 * `patient-pay-api` — the same order ciyexCommands' patient-pay flow uses.
	 * The setting used to be ignored here, so an org that had configured the
	 * service still had its invoice requests aimed at the derived host.
	 */
	private _patientPayBase(): string {
		const configured = String(this.configurationService.getValue<string>('ciyex.patientPay.apiUrl') ?? '').trim();
		if (configured) { return configured.replace(/\/$/, ''); }
		let override = '';
		try { override = localStorage.getItem('ciyex_patient_pay_api_url') || ''; } catch { /* ignore */ }
		if (override) { return override.replace(/\/$/, ''); }
		try {
			const u = new URL(this.apiService.apiUrl);
			u.hostname = u.hostname.replace(/(^|\.)api(-|\.)/, '$1patient-pay-api$2');
			u.pathname = ''; u.search = ''; u.hash = '';
			return u.toString().replace(/\/$/, '');
		} catch { return 'https://patient-pay-api.apps-dev.us-east.in.hinisoft.com'; }
	}

	private _patientPayHeaders(): Record<string, string> {
		const h: Record<string, string> = { 'Content-Type': 'application/json' };
		try {
			const t = localStorage.getItem('ciyex_token');
			const o = localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant');
			if (t) { h['Authorization'] = `Bearer ${t}`; }
			if (o) { h['X-Org-Alias'] = o; }
		} catch { /* ignore */ }
		return h;
	}

	/**
	 * Download an invoice's statement PDF (generated by ciyex-patient-pay) and
	 * save it via the browser. Used by the per-invoice "PDF" action.
	 */
	private async _downloadInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<void> {
		try {
			const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices/${encodeURIComponent(invoiceId)}/pdf`, { headers: this._patientPayHeaders() });
			if (!res.ok) { await this.dialogService.error(`Could not download PDF (${res.status}).`); return; }
			const blob = await res.blob();
			const doc = (this.root && this.root.ownerDocument) || DOM.getActiveWindow().document;
			const url = URL.createObjectURL(blob);
			const a = doc.createElement('a');
			a.href = url;
			a.download = `Invoice-${invoiceNumber}.pdf`;
			doc.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 4000);
		} catch (e) {
			await this.dialogService.error(`Could not download PDF: ${e}`);
		}
	}

	/** Email the invoice (with the statement PDF attached) to the patient. */
	private async _emailInvoice(invoiceId: string): Promise<void> {
		try {
			const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices/${encodeURIComponent(invoiceId)}/send`, { method: 'POST', headers: this._patientPayHeaders() });
			if (res.ok) {
				await this.dialogService.info('Invoice emailed to the patient with the statement PDF attached.');
			} else {
				await this.dialogService.error(`Could not email the invoice (${res.status}).`);
			}
		} catch (e) {
			await this.dialogService.error(`Could not email the invoice: ${e}`);
		}
	}

	/**
	 * Open the generated invoice PDF for viewing (Chromium renders it inline).
	 * Falls back to a download if the workbench blocks the popup.
	 */
	private async _showInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<void> {
		try {
			const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices/${encodeURIComponent(invoiceId)}/pdf`, { headers: this._patientPayHeaders() });
			if (!res.ok) { await this.dialogService.error(`Could not open the invoice PDF (${res.status}).`); return; }
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const win = DOM.getActiveWindow();
			const opened = win.open(url, '_blank');
			if (!opened) {
				// Popup blocked by the workbench — download so the user still gets it.
				const doc = (this.root && this.root.ownerDocument) || win.document;
				const a = doc.createElement('a');
				a.href = url;
				a.download = `Invoice-${invoiceNumber}.pdf`;
				doc.body.appendChild(a);
				a.click();
				a.remove();
			}
			setTimeout(() => URL.revokeObjectURL(url), 60000);
		} catch (e) {
			await this.dialogService.error(`Could not open the invoice PDF: ${e}`);
		}
	}

	private async _loadAndRenderInvoices(): Promise<void> {
		if (!this.contentEl) { return; }
		DOM.clearNode(this.contentEl);

		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;';
		const titleEl = DOM.append(toolbar, DOM.$('h2'));
		titleEl.textContent = 'Invoices';
		titleEl.style.cssText = 'font-size:20px;font-weight:600;margin:0;color:var(--vscode-foreground);';
		const addBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Create Invoice';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
		addBtn.addEventListener('click', () => this._openInvoiceForm(() => this._loadAndRenderInvoices()));

		const listEl = DOM.append(this.contentEl, DOM.$('div'));
		const render = () => {
			DOM.clearNode(listEl);
			if (this._invoicesLoading) {
				const l = DOM.append(listEl, DOM.$('div'));
				l.textContent = 'Loading…';
				l.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
				return;
			}
			if (!this._invoices.length) {
				const e = DOM.append(listEl, DOM.$('div'));
				e.textContent = 'No invoices yet. Click "Create Invoice" to add one.';
				e.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
				return;
			}
			const table = DOM.append(listEl, DOM.$('table'));
			table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
			const hr = DOM.append(DOM.append(table, DOM.$('thead')), DOM.$('tr'));
			for (const h of ['Invoice #', 'Patient', 'Total', 'Balance', 'Status', 'Issued', 'Due', 'Actions']) {
				const th = DOM.append(hr, DOM.$('th'));
				th.textContent = h;
				th.style.cssText = 'text-align:left;padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);color:var(--vscode-descriptionForeground);font-weight:600;';
			}
			const tbody = DOM.append(table, DOM.$('tbody'));
			const money = (v: unknown): string => { const n = Number(v); return Number.isFinite(n) ? `$${n.toFixed(2)}` : ''; };
			const date = (v: unknown): string => { if (!v) { return ''; } try { return new Date(String(v)).toLocaleDateString(); } catch { return String(v); } };
			for (const inv of this._invoices) {
				const tr = DOM.append(tbody, DOM.$('tr'));
				const cell = (txt: string) => {
					const td = DOM.append(tr, DOM.$('td'));
					td.textContent = txt;
					td.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(128,128,128,0.12);color:var(--vscode-foreground);';
				};
				cell(String(inv['invoiceNumber'] ?? ''));
				cell(String(inv['patientName'] || (inv['patientId'] ? `Patient #${inv['patientId']}` : '')));
				cell(money(inv['totalAmount']));
				cell(money(inv['balanceDue']));
				cell(String(inv['status'] ?? ''));
				cell(date(inv['issueDate']));
				cell(date(inv['dueDate']));

				const actTd = DOM.append(tr, DOM.$('td'));
				actTd.style.cssText = 'padding:6px 10px;border-bottom:1px solid rgba(128,128,128,0.12);white-space:nowrap;';
				const invId = String(inv['id'] ?? '');
				const mkActBtn = (label: string, title: string, onClick: () => void): void => {
					const b = DOM.append(actTd, DOM.$('button')) as HTMLButtonElement;
					b.textContent = label;
					b.title = title;
					b.style.cssText = 'margin-right:6px;padding:3px 9px;font-size:11px;border:1px solid var(--vscode-input-border,#555);border-radius:4px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);cursor:pointer;';
					b.addEventListener('click', onClick);
				};
				if (invId) {
					mkActBtn('\u{2B07} PDF', 'Download invoice PDF', () => { void this._downloadInvoicePdf(invId, String(inv['invoiceNumber'] ?? invId)); });
					mkActBtn('\u{2709} Email', 'Email this invoice (PDF attached) to the patient', () => { void this._emailInvoice(invId); });
				}
			}
		};

		this._invoicesLoading = true;
		render();
		try {
			const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices?page=0&size=100`, { headers: this._patientPayHeaders() });
			if (res.ok) {
				const data = await res.json();
				const w = data?.data ?? data;
				this._invoices = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>;
			} else {
				this._invoices = [];
			}
		} catch { this._invoices = []; }
		this._invoicesLoading = false;
		render();
	}

	private _openInvoiceForm(onSaved: () => void): void {
		this._invoiceFormOverlay?.remove();
		this._invoiceFormBackdrop?.remove();

		const doc = (this.root && this.root.ownerDocument) || DOM.getActiveWindow().document;
		const mount = findWorkbenchRoot(this.root, doc);
		const themeType = this.themeService.getColorTheme().type;
		const colorScheme = themeType === 'light' || themeType === 'hcLight' ? 'light' : 'dark';

		const backdrop = doc.createElement('div');
		backdrop.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		backdrop.style.cssText = 'position:fixed;inset:0;z-index:9999;background:transparent;';
		mount.appendChild(backdrop);
		this._invoiceFormBackdrop = backdrop;

		const overlay = doc.createElement('div');
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		overlay.style.cssText = `position:fixed;inset:0;z-index:10000;display:flex;justify-content:flex-end;color-scheme:${colorScheme};background:transparent;`;
		mount.appendChild(overlay);
		this._invoiceFormOverlay = overlay;

		const panel = DOM.append(overlay, DOM.$('div'));
		panel.style.cssText = 'width:480px;max-width:95vw;height:100%;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border,#454545);box-shadow:-8px 0 24px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;color:var(--vscode-foreground);';

		const close = () => { overlay.remove(); backdrop.remove(); this._invoiceFormOverlay = null; this._invoiceFormBackdrop = null; };
		backdrop.addEventListener('click', close);

		const hdr = DOM.append(panel, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--vscode-editorWidget-border,#454545);flex-shrink:0;';
		const titleEl = DOM.append(hdr, DOM.$('h3'));
		titleEl.textContent = 'Create Invoice';
		titleEl.style.cssText = 'margin:0;font-size:15px;font-weight:600;color:var(--vscode-foreground);';
		const closeBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '×';
		closeBtn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:var(--vscode-descriptionForeground);line-height:1;padding:0 4px;';
		closeBtn.addEventListener('click', close);

		const body = DOM.append(panel, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;scrollbar-width:none;';

		// Patient search
		let selPatientId = '';
		let selPatientName = '';
		const pg = DOM.append(body, DOM.$('div'));
		pg.style.cssText = 'position:relative;';
		const pl = DOM.append(pg, DOM.$('label'));
		pl.textContent = 'Patient *';
		pl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const pInput = DOM.append(pg, DOM.$('input')) as HTMLInputElement;
		pInput.placeholder = 'Search patient by name...';
		pInput.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';
		const pDrop = DOM.append(pg, DOM.$('div'));
		pDrop.style.cssText = 'position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:var(--vscode-editorWidget-background,#1e1e1e);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.45);z-index:50;display:none;margin-top:2px;';
		let deb: ReturnType<typeof setTimeout> | undefined;
		pInput.addEventListener('input', () => {
			selPatientId = '';
			const q = pInput.value.trim();
			if (deb) { clearTimeout(deb); }
			if (q.length < 2) { pDrop.style.display = 'none'; return; }
			deb = setTimeout(async () => {
				let list: Array<Record<string, unknown>> = [];
				try {
					const r = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
					if (r.ok) { const d = await r.json(); const w = d?.data ?? d; list = (w?.content || (Array.isArray(w) ? w : [])) as Array<Record<string, unknown>>; }
				} catch { /* ignore */ }
				DOM.clearNode(pDrop);
				if (!list.length) { pDrop.style.display = 'none'; return; }
				for (const p of list.slice(0, 10)) {
					const name = `${String(p.firstName || '')} ${String(p.lastName || '')}`.trim() || String(p.name || p.id);
					const pid = String(p.id ?? p.patientId ?? '');
					const row = DOM.append(pDrop, DOM.$('div'));
					row.textContent = pid ? `${name} (MRN ${pid})` : name;
					row.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.08);';
					row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
					row.addEventListener('mouseleave', () => { row.style.background = ''; });
					row.addEventListener('mousedown', (e) => { e.preventDefault(); selPatientId = pid; selPatientName = name; pInput.value = name; pDrop.style.display = 'none'; });
				}
				pDrop.style.display = 'block';
			}, 250);
		});
		pInput.addEventListener('blur', () => { setTimeout(() => { pDrop.style.display = 'none'; }, 200); });

		const mkField = (label: string, opts: Partial<HTMLInputElement>): HTMLInputElement => {
			const g = DOM.append(body, DOM.$('div'));
			const l = DOM.append(g, DOM.$('label'));
			l.textContent = label;
			l.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const el = DOM.append(g, DOM.$('input')) as HTMLInputElement;
			el.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';
			Object.assign(el, opts);
			return el;
		};
		const amountEl = mkField('Amount ($) *', { type: 'number', placeholder: '0.00' });
		const dueEl = mkField('Due Date', { type: 'date' });
		const notesG = DOM.append(body, DOM.$('div'));
		const notesL = DOM.append(notesG, DOM.$('label'));
		notesL.textContent = 'Notes';
		notesL.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const notesEl = DOM.append(notesG, DOM.$('textarea')) as HTMLTextAreaElement;
		notesEl.placeholder = 'Office visit, lab, etc.';
		notesEl.rows = 3;
		notesEl.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;resize:vertical;';

		const errEl = DOM.append(body, DOM.$('div'));
		errEl.style.cssText = 'color:#f48771;font-size:12px;padding:6px 10px;background:rgba(244,135,113,0.1);border:1px solid rgba(244,135,113,0.3);border-radius:4px;display:none;';

		const footer = DOM.append(panel, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--vscode-editorWidget-border,#454545);flex-shrink:0;';
		const cancelBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:7px 18px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid var(--vscode-input-border,#555);border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', close);
		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Create Invoice';
		saveBtn.style.cssText = 'padding:7px 18px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
		saveBtn.addEventListener('click', async () => {
			errEl.style.display = 'none';
			const amt = Number(amountEl.value);
			if (!selPatientId) { errEl.textContent = 'Select a patient.'; errEl.style.display = ''; return; }
			if (!amt || amt <= 0) { errEl.textContent = 'Enter a valid amount.'; errEl.style.display = ''; return; }
			// The patient-pay invoice requires both totalAmount and balanceDue.
			const payload: Record<string, unknown> = { patientId: selPatientId, patientName: selPatientName, totalAmount: amt, balanceDue: amt, status: 'SENT' };
			if (dueEl.value) { payload['dueDate'] = dueEl.value; }
			if (notesEl.value.trim()) { payload['notes'] = notesEl.value.trim(); }
			saveBtn.disabled = true; saveBtn.textContent = 'Creating…';
			try {
				const res = await fetch(`${this._patientPayBase()}/api/patient-pay/invoices`, { method: 'POST', headers: this._patientPayHeaders(), body: JSON.stringify(payload) });
				if (res.ok) { close(); onSaved(); }
				else { const e = await res.json().catch(() => ({})) as Record<string, string>; errEl.textContent = e['message'] || `Error ${res.status}`; errEl.style.display = ''; }
			} catch { errEl.textContent = 'Failed to reach the billing service.'; errEl.style.display = ''; }
			saveBtn.disabled = false; saveBtn.textContent = 'Create Invoice';
		});
	}

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService private readonly storageSvc: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService, @ICommandService private readonly commandService: ICommandService, @IFileService private readonly fileService: IFileService, @IFileDialogService private readonly fileDialogService: IFileDialogService, @IConfigurationService private readonly configurationService: IConfigurationService, @INativeHostService private readonly nativeHostService: INativeHostService) { super(PaymentsEditor.ID, group, t, th, storageSvc, a, d); }
}

export class ClaimsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexClaims';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Claims Management', apiPath: '/api/all-claims', statsPath: '/api/all-claims/stats',
		searchPlaceholder: 'Search by patient, diagnosis, claim ID...',
		editable: true,
		refetchOnEdit: true,
		// Claims are derived from invoices created via the patient flow — the Claims
		// list only fetches/displays them. QA report 2026-05-08 #20: hide "+ New Claim".
		creatable: false,
		createDefaults: { status: 'draft', type: 'professional' },
		// /api/all-claims doesn't support server-side q=/status= — filter client-side
		// across the fields the user searches by (matches ciyex-ehr-ui behavior).
		clientSideFilter: ['claimNumber', 'patientName', 'provider', 'payerName', 'diagnosisCode', 'policyNumber', 'planName', 'id'],
		mergeOnEdit: true,
		editTitle: (item) => `Edit Claim #${String(item.id || '')}`,
		additionalFilters: [
			{
				key: 'type', placeholder: 'All Types',
				options: [
					{ label: 'Professional', value: 'professional' },
					{ label: 'Institutional', value: 'institutional' },
					{ label: 'Dental', value: 'dental' },
					{ label: 'Pharmacy', value: 'pharmacy' },
				],
			},
		],
		columns: [
			{ key: 'claimNumber', label: 'Claim #', width: '110px' },
			{ key: 'invoiceNumber', label: 'Invoice #', width: '100px' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'provider', label: 'Provider' },
			{ key: 'payerName', label: 'Payer' },
			{ key: 'planName', label: 'Plan' },
			{ key: 'diagnosisCode', label: 'Diagnosis', width: '90px' },
			{ key: 'policyNumber', label: 'Policy #', width: '100px' },
			{ key: 'serviceDate', label: 'Date', width: '90px' },
			{ key: 'status', label: 'Status', width: '120px' },
		],
		// Status values match ciyex-ehr-ui ClaimManagementDashboard status pills
		statusTabs: [
			{ label: 'Draft', value: 'DRAFT' },
			{ label: 'In Process', value: 'IN_PROCESS' },
			{ label: 'Ready', value: 'READY_FOR_SUBMISSION' },
			{ label: 'Submitted', value: 'SUBMITTED' },
			{ label: 'Closed', value: 'CLOSED' },
			{ label: 'Void', value: 'VOID' },
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
					{ label: 'Draft', value: 'DRAFT' },
					{ label: 'In Process', value: 'IN_PROCESS' },
					{ label: 'Ready for Submission', value: 'READY_FOR_SUBMISSION' },
					{ label: 'Submitted', value: 'SUBMITTED' },
					{ label: 'Closed', value: 'CLOSED' },
					{ label: 'Void', value: 'VOID' },
				], defaultValue: 'DRAFT'
			},
			{ key: 'invoiceNumber', label: 'Invoice Number', type: 'text', placeholder: 'Linked invoice number' },
			{ key: 'totalAmount', label: 'Total Amount ($)', type: 'number' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Update Status', icon: '📋', handler: async (item, api, reload, dlg) => {
					const statuses = ['DRAFT', 'IN_PROCESS', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'CLOSED', 'VOID'];
					const res = await dlg.prompt<string>({
						type: 'question',
						message: 'Update claim status',
						detail: `Current status: ${String(item.status || '—')}`,
						buttons: statuses.map(v => ({ label: v.replace(/_/g, ' '), run: () => v })),
						cancelButton: true,
					});
					const status = res.result;
					if (!status) { return; }
					const r = await api.fetch(`/api/all-claims/${item.claimId || item.id}/status`, {
						method: 'PUT', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ status }),
					});
					if (!r.ok) {
						const err = await r.json().catch(() => null) as Record<string, unknown> | null;
						await dlg.error(String(err?.['message'] || `Failed to update status (HTTP ${r.status}).`));
						return;
					}
					await dlg.info(`Claim status updated to "${status}".`);
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Send', icon: '📤', handler: async (item, api, reload, dlg) => {
					const current = String(item.status || '').toLowerCase();
					if (current === 'submitted' || current === 'approved' || current === 'paid') {
						await dlg.info(`Claim is already ${current}.`);
						return;
					}
					const res = await dlg.confirm({
						message: 'Send this claim to insurance?',
						detail: `Claim #${item.claimNumber || item.id} for ${item.patientName || 'patient'} → ${item.payerName || 'payer'}`,
						type: 'question',
						primaryButton: 'Send',
					});
					if (!res.confirmed) { return; }
					const r = await api.fetch(`/api/all-claims/${item.claimId || item.id}/send`, { method: 'POST' });
					if (!r.ok) {
						const err = await r.json().catch(() => null) as Record<string, unknown> | null;
						await dlg.error(String(err?.['message'] || `Failed to send claim (HTTP ${r.status}). Check that the claim has a payer, provider, diagnosis and policy number.`));
						return;
					}
					await dlg.info('Claim sent to insurance.');
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Void & Recreate', icon: '↺', handler: async (item, api, reload, dlg) => {
					const res = await dlg.confirm({
						message: 'Void this claim and create a replacement?',
						detail: 'This permanently voids the current claim and creates a new draft.',
						type: 'warning',
						primaryButton: 'Void & Recreate',
					});
					if (!res.confirmed) { return; }
					const r = await api.fetch(`/api/all-claims/${item.claimId || item.id}/void-recreate`, { method: 'POST' });
					if (!r.ok) {
						const err = await r.json().catch(() => null) as Record<string, unknown> | null;
						await dlg.error(String(err?.['message'] || `Failed to void claim (HTTP ${r.status}).`));
						return;
					}
					await dlg.info('Claim voided and replaced.');
					reload();
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(ClaimsEditor.ID, group, t, th, s, a, d); }
}
