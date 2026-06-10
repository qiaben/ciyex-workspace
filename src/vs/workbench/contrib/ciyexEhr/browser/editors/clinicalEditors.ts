/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClinicalListEditorBase, ClinicalEditorConfig, FormExtrasHandle, showThemedModal } from './clinicalListEditor.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown, findWorkbenchRoot } from '../customDropdown.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';

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

function renderCarePlanExtras(host: HTMLElement, editing: Record<string, unknown> | null, api: ICiyexApiService): FormExtrasHandle {
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
		dateInput.style.cssText = inputStyle;
		dateInput.value = seed?.targetDate ? String(seed.targetDate).slice(0, 10) : '';

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
		// No additionalFilters — prescriber is in clientSideFilter so the main search bar
		// (placeholder includes "prescriber") already filters by prescriber name.
		formFields: [
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
		cellRenderer: (key, _value, item) => {
			if (key === 'patientFirstName') {
				const fn = String(item.patientFirstName || '').trim();
				const ln = String(item.patientLastName || '').trim();
				const full = `${fn} ${ln}`.trim();
				if (full) { return full; }
				const alt = item.patientName || item.patientFullName || item.patient || '';
				return String(alt || (item.patientId ? `Patient #${item.patientId}` : ''));
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
		// Status / Priority / Result all live in the toolbar as dropdowns, mirroring
		// the web app's /labs page (QA report 2026-05-11).
		statusAsDropdown: true,
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'Pending', value: 'pending' },
			{ label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
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
		formFields: [
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
				validationPattern: '^[A-Za-z0-9 ,.\\-/()\\[\\]+&\']{2,}$',
				validationMessage: 'Test Name must be at least 2 characters',
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
			{ key: 'diagnosisCode', label: 'Diagnosis Code (ICD-10)', type: 'search', required: true, placeholder: 'Search ICD-10 codes', apiPath: '/api/app-proxy/ciyex-codes/api/codes/ICD10_CM/search', searchParam: 'q', searchDisplayField: 'shortDescription', searchValueField: 'code', relatedDisplayFields: ['code', 'shortDescription'] },
			{ key: 'procedureCode', label: 'Procedure Code (CPT)', type: 'search', required: true, placeholder: 'Search CPT codes', apiPath: '/api/app-proxy/ciyex-codes/api/codes/CPT/search', searchParam: 'q', searchDisplayField: 'shortDescription', searchValueField: 'code', relatedDisplayFields: ['code', 'shortDescription'] },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Update Status', icon: '\u{1F504}', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({ type: 'question', message: 'Update lab order status', inputs: [{ placeholder: 'New status: active, pending, completed, cancelled' }] });
					if (!res.confirmed || !res.values?.[0]?.trim()) { return; }
					const newStatus = res.values[0].trim().toLowerCase();
					await api.fetch(`/api/lab-order/${item.patientId}/${item.id}`, {
						method: 'PUT', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ ...item, status: newStatus }),
					});
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Print Order', icon: '\u{1F5A8}', handler: async (item, api, _reload, dlg) => {
					const res = await api.fetch(`/api/lab-order/${item.patientId}/${item.id}/print`, { method: 'POST' });
					if (!res.ok) { await dlg.info('Print request sent (check printer queue).'); }
					else { await dlg.info('Lab order sent to printer.'); }
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'View Results', icon: '\u{1F4CA}', handler: async (item, _api, _reload, dlg) => {
					await dlg.info(`Switch to "Lab Results" in the sidebar to view results for order ${item.orderNumber || item.id}.`);
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
			{ label: 'Final', value: 'final' }, { label: 'Corrected', value: 'corrected' }, { label: 'Amended', value: 'amended' },
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
		cellRenderer: (key, value) => {
			if ((key === 'collectedDate' || key === 'signedAt') && typeof value === 'string' && value) {
				try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
			}
			if (key === 'abnormalFlag' && typeof value === 'string') {
				return value.charAt(0).toUpperCase() + value.slice(1);
			}
			return String(value ?? '');
		},
		formFields: [
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
			{ key: 'referenceLow', label: 'Ref Low', type: 'number', aliases: ['refLow'] },
			{ key: 'referenceHigh', label: 'Ref High', type: 'number', aliases: ['refHigh'] },
			{ key: 'specimen', label: 'Specimen', type: 'text', placeholder: 'Blood, Urine...' },
			{ key: 'collectedDate', label: 'Collected Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
			{ key: 'reportedDate', label: 'Reported Date', type: 'date' },
			{ key: 'panelName', label: 'Panel Name', type: 'text', placeholder: 'CBC, BMP...' },
			{ key: 'panelCode', label: 'Panel Code', type: 'text' },
			{ key: 'recommendations', label: 'Recommendations', type: 'textarea', placeholder: 'Clinical recommendations...', width: 'span 2' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...', width: 'span 2' },
		],
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
		sidebar.style.cssText = 'width:220px;flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background);padding:16px 0;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;display:flex;flex-direction:column;';

		const sbHeader = DOM.append(sidebar, DOM.$('div'));
		sbHeader.style.cssText = 'padding:0 16px 12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:8px;';
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
		for (const it of items) {
			const navEl = DOM.append(sidebar, DOM.$('div'));
			navEl.style.cssText = 'display:flex;align-items:center;gap:10px;margin:2px 8px;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;color:var(--vscode-descriptionForeground);transition:background 0.1s;';
			const iconEl = DOM.append(navEl, DOM.$('span'));
			iconEl.textContent = it.icon;
			iconEl.style.cssText = 'font-size:15px;width:18px;text-align:center;';
			const lbl = DOM.append(navEl, DOM.$('span'));
			lbl.textContent = it.label;
			navEl.addEventListener('mouseenter', () => { if (this._activeView !== it.key) { navEl.style.background = 'var(--vscode-list-hoverBackground)'; } });
			navEl.addEventListener('mouseleave', () => { if (this._activeView !== it.key) { navEl.style.background = ''; } });
			navEl.addEventListener('click', () => {
				if (this._activeView === it.key) { return; }
				this._activeView = it.key;
				this._updateSidebarActive();
				this._resetAndReload();
			});
			this._sidebarItems.set(it.key, navEl);
		}
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
			{ key: 'administrationDate', label: 'Admin Date', width: '90px' }, { key: 'administeredBy', label: 'Administered By' },
			{ key: 'status', label: 'Status', width: '80px' },
		],
		statusTabs: [{ label: 'Completed', value: 'completed' }, { label: 'Not Done', value: 'not_done' }, { label: 'Entered in Error', value: 'entered_in_error' }],
		formFields: [
			// Patient Information
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient by name...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			// Vaccine Information
			{ key: 'vaccineName', label: 'Vaccine Name', type: 'text', placeholder: 'Influenza, inactivated' },
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
			{ key: 'lotNumber', label: 'Lot Number', type: 'text', placeholder: 'ABC123', aliases: ['lot'] },
			{ key: 'expirationDate', label: 'Expiration Date', type: 'date' },
			// Administration Details
			{ key: 'administrationDate', label: 'Admin Date', type: 'date', required: true },
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
			{ key: 'doseNumber', label: 'Dose Number', type: 'text', placeholder: 'e.g., 0.5 mL or 1' },
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
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{
				key: 'referringProvider', label: 'Referring Provider', type: 'search', required: true,
				placeholder: 'Search provider (must be selected from results)...',
				apiPath: '/api/providers',
				relatedField: 'referringProviderId',
				relatedDisplayFields: ['firstName', 'lastName'],
				aliases: ['referringPrescriber', 'referringProviderName'],
				validationMessage: 'Please select a referring provider from the search results',
			},
			{ key: 'referralDate', label: 'Referral Date', type: 'date', required: true, defaultValue: () => new Date().toISOString().slice(0, 10) },
			{ key: 'specialistName', label: 'Specialist Name', type: 'text', required: true, validationPattern: '^[A-Za-z\\s\\-\'.]+$', validationMessage: 'Specialist name must contain only letters, spaces, hyphens, apostrophes or periods' },
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
			{ key: 'facilityName', label: 'Facility Name', type: 'text', required: true, validationPattern: '^[A-Za-z0-9\\s\\-\'.,&#()\\/]{2,200}$', validationMessage: 'Facility name must be 2-200 characters using only letters, numbers, and common punctuation' },
			{ key: 'facilityAddress', label: 'Facility Address', type: 'text', placeholder: 'Street address' },
			{ key: 'facilityPhone', label: 'Facility Phone', type: 'text', validationPattern: '^\\(?\\d{3}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}$', validationMessage: 'Phone must be a 10-digit US number' },
			{ key: 'facilityFax', label: 'Facility Fax', type: 'text', validationPattern: '^\\(?\\d{3}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}$', validationMessage: 'Fax must be a 10-digit US number' },
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
			{ key: 'authorName', label: 'Author', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedField: 'authorId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'startDate', label: 'Start Date', type: 'date' },
			{ key: 'endDate', label: 'End Date', type: 'date' },
			{ key: 'description', label: 'Description', type: 'textarea', placeholder: 'Plan description...', width: 'span 2' },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Draft', value: 'draft' }, { label: 'Active', value: 'active' },
					{ label: 'On Hold', value: 'on_hold' }, { label: 'Completed', value: 'completed' },
				], defaultValue: 'draft'
			},
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...', width: 'span 2' },
			// Dynamic Goals + Interventions are rendered via `formExtras` (issue #23)
			// so the user can add an arbitrary number of items instead of the old
			// hardcoded Goal 1 / Goal 2 / Intervention 1-3 rows.
		],
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

export class CdsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexCds';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Clinical Decision Support', apiPath: '/api/cds/rules',
		statsPath: '/api/cds/stats',
		searchPlaceholder: 'Search rules...',
		clientSideFilter: ['name', 'ruleType', 'type', 'description', 'severity', 'triggerEvent', 'actionType', 'message', 'id'],
		editable: true,
		refetchOnEdit: true,
		mergeOnEdit: true,
		createDefaults: {
			ruleType: 'custom',
			actionType: 'alert',
			appliesTo: 'all',
			isActive: true,
			conditions: [],
			snoozeDays: 0,
		},
		beforeSave: (payload, _isEdit) => {
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
			// Mirror isActive ↔ status.
			if (out['isActive'] !== undefined) {
				// isActive was set by the toggle field — derive status from it.
				out['status'] = out['isActive'] ? 'active' : 'inactive';
			} else if (typeof out['status'] === 'string') {
				out['isActive'] = (out['status'] as string) === 'active';
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
			{ key: 'isActive', label: 'Status', width: '80px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' },
			{ label: 'Inactive', value: 'inactive' },
		],
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
				],
			},
			{
				key: 'severity', placeholder: 'All Severity',
				options: [
					{ label: 'Info', value: 'info' },
					{ label: 'Warning', value: 'warning' },
					{ label: 'Critical', value: 'critical' },
				],
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
		statsFilterMap: { active: 'active', inactive: 'inactive', critical: 'critical' },
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
				options: [
					{ label: 'Info', value: 'info' },
					{ label: 'Warning', value: 'warning' },
					{ label: 'Critical', value: 'critical' },
				],
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
			// Row 6: full-width alert message (required)
			{ key: 'message', label: 'Alert Message', type: 'textarea', required: true, placeholder: 'Message shown to the provider when this rule fires...', width: 'span 2' },
			// Row 7: full-width recommendation
			{ key: 'recommendation', label: 'Recommendation', type: 'textarea', placeholder: 'Recommended action for the provider...', width: 'span 2' },
			// Row 8: referenceUrl + snoozeDays
			{ key: 'referenceUrl', label: 'Reference URL', type: 'text', placeholder: 'https://...', aliases: ['reference_url', 'refUrl'], validationPattern: '^(https?://.*)?$', validationMessage: 'Must be a valid https:// URL' },
			{ key: 'snoozeDays', label: 'Snooze (days)', type: 'number', placeholder: 'Leave empty for no snooze', aliases: ['snooze_days'] },
		],
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Toggle', icon: '⏻', handler: async (item, api, reload, dlg) => {
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
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'providerName', label: 'Provider', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedField: 'providerId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'insuranceName', label: 'Insurance Name', type: 'search', required: true, placeholder: 'Search insurance...', apiPath: '/api/insurance-companies', searchDisplayField: 'name' },
			{ key: 'memberId', label: 'Member ID', type: 'text' },
			{ key: 'authNumber', label: 'Authorization Number', type: 'text', placeholder: 'Auth reference number' },
			{
				key: 'procedureDescription', label: 'Procedure', type: 'search', required: true,
				placeholder: 'Search CPT procedure (e.g. office visit)...',
				apiPath: '/api/app-proxy/ciyex-codes/api/codes/CPT/search',
				searchParam: 'q',
				searchDisplayField: 'shortDescription',
				searchValueField: 'code',
				relatedField: 'procedureCode',
				relatedDisplayFields: ['code', 'shortDescription'],
				// Issue #7: dropdown shows "code description", but only the
				// description lands in the Procedure box while the code fills the
				// separate "CPT Code" box (relatedField above).
				selectDisplayField: 'shortDescription',
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
				// Issue #7: ICD-10 code fills the "Diagnosis Code (ICD-10)" box;
				// only the description lands in this "Diagnosis" box.
				selectDisplayField: 'shortDescription',
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
					const res = await dlg.input({
						type: 'question',
						// allow-any-unicode-next-line
						message: 'Deny authorization',
						// allow-any-unicode-next-line
						detail: `Patient: ${item.patientName || '—'}\nThe reason is saved with the denial.`,
						inputs: [{ placeholder: 'Denial reason (required)' }],
					});
					if (!res.confirmed) { return; }
					const reason = res.values?.[0]?.trim() || '';
					if (!reason) {
						await dlg.error('A denial reason is required.');
						return;
					}
					// Backend (PriorAuthService.deny) reads `denialReason` from the
					// request body and ALSO accepts the existing record-shape fields
					// — sending just `{ reason }` silently dropped the reason (QA
					// report 2026-05-11). Send both keys for safety.
					const r = await api.fetch(`/api/prior-auth/${item.id}/deny`, {
						method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ denialReason: reason, reason }),
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

export class EducationEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexEducation';

	private eduView: 'library' | 'assignments' = 'library';

	private readonly _libraryConfig: ClinicalEditorConfig = {
		title: 'Education Library', apiPath: '/api/education/materials',
		searchPlaceholder: 'Search by title, category, content type...',
		clientSideFilter: ['title', 'category', 'contentType', 'source', 'id'],
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
			return payload;
		},
		// Issue #24: enable horizontal scroll on narrow viewports so the Actions
		// column stays visible rather than being clipped by the right edge.
		tableMinWidth: '900px',
		columns: [
			{ key: 'title', label: 'Title', width: '1.5fr' },
			{ key: 'category', label: 'Category', width: '120px' },
			{ key: 'contentType', label: 'Type', width: '90px' },
			{ key: 'source', label: 'Source' },
			{ key: 'isActive', label: 'Active', width: '60px' },
			{ key: 'viewCount', label: 'Views', width: '60px' },
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
		formFields: [
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
			{ key: 'url', label: 'URL / Path', type: 'text', placeholder: 'https://... or /files/...' },
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
		],
		actions: [
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
			{ key: 'assignedBy', label: 'Assigned By', type: 'search', placeholder: 'Search provider...', apiPath: '/api/providers', relatedDisplayFields: ['firstName', 'lastName'] },
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
		sidebar.style.cssText = 'width:230px;flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background);padding:16px 0;overflow-y:auto;display:flex;flex-direction:column;';

		const sbHeader = DOM.append(sidebar, DOM.$('div'));
		sbHeader.style.cssText = 'padding:0 16px 12px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:8px;';
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
		for (const it of items) {
			const navEl = DOM.append(sidebar, DOM.$('div'));
			navEl.style.cssText = 'display:flex;align-items:center;gap:10px;margin:2px 8px;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;color:var(--vscode-descriptionForeground);transition:background 0.1s;';
			const iconEl = DOM.append(navEl, DOM.$('span'));
			iconEl.textContent = it.icon;
			iconEl.style.cssText = 'font-size:15px;width:18px;text-align:center;';
			const lbl = DOM.append(navEl, DOM.$('span'));
			lbl.textContent = it.label;
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
			this._eduSidebarItems.set(it.key, navEl);
		}
		this._updateEduSidebarActive();

		// allow-any-unicode-next-line
		// ── Library main area (returned as base-class content host) ──────────
		this._eduLibraryMain = DOM.append(wrapper, DOM.$('.education-main'));
		this._eduLibraryMain.style.cssText = 'flex:1;min-width:0;height:100%;overflow:hidden;';

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
						item.addEventListener('click', () => {
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

	const mutateStatus = async (status: string, reason?: string) => {
		try {
			const body: Record<string, string> = reason ? { status, cancelledReason: reason } : { status };
			const r = await api.fetch(`/api/recalls/${recallId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			if (!r.ok) { await dlg.error(`Failed to update recall (${r.status})`); return; }
			reload();
			await load();
		} catch (e) { await dlg.error(`Failed to update recall: ${e instanceof Error ? e.message : String(e)}`); }
	};

	const logOutreach = async (preferred: string) => {
		const res = await dlg.input({ type: 'question', message: 'Log outreach', detail: 'Allowed: PHONE, EMAIL, SMS', inputs: [{ placeholder: 'e.g. PHONE', value: preferred }] });
		if (!res.confirmed) { return; }
		const method = (res.values?.[0] || '').trim().toUpperCase();
		if (!['PHONE', 'EMAIL', 'SMS'].includes(method)) { await dlg.error('Enter one of: PHONE, EMAIL, SMS'); return; }
		try {
			const r = await api.fetch(`/api/recalls/${recallId}/outreach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, outcome: 'contacted' }) });
			if (!r.ok) { const err = await r.json().catch(() => null) as Record<string, unknown> | null; await dlg.error(String(err?.['message'] || `Failed to log outreach (${r.status})`)); return; }
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
		const logBtn = DOM.append(histHead, DOM.$('button'));
		// allow-any-unicode-next-line
		logBtn.textContent = '📞 Log Outreach';
		logBtn.style.cssText = 'padding:4px 10px;border-radius:4px;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background,#2563eb);font-size:11px;font-weight:600;cursor:pointer;';
		logBtn.addEventListener('click', () => { void logOutreach(recall.preferredContact || ''); });

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
			pendingTotal: 'PENDING',
			contactedTotal: 'CONTACTED',
			scheduledTotal: 'SCHEDULED',
			completedThisMonth: 'COMPLETED',
			cancelledTotal: 'CANCELLED',
		},
		searchPlaceholder: 'Search by patient name...',
		clientSideFilter: ['patientName', 'recallTypeName', 'providerName', 'status', 'priority', 'preferredContact', 'id'],
		editable: true,
		refetchOnEdit: true,
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
			},
		],
		formFields: [
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
			{ key: 'patientPhone', label: 'Phone', type: 'text', placeholder: 'Auto-filled' },
			{ key: 'patientEmail', label: 'Email', type: 'text', placeholder: 'Auto-filled' },
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
		// Issue #12: Description used to be the only flexible column (2fr) so it
		// absorbed all slack and left a huge gap between Type and Category. Add a
		// Modifier column and let Description + Category share the flex so the
		// columns read evenly instead of spread far apart.
		columns: [
			{ key: 'code', label: 'Code', width: '100px' },
			{ key: 'codeType', label: 'Type', width: '80px' },
			{ key: 'modifier', label: 'Modifier', width: '90px' },
			{ key: 'description', label: 'Description', width: 'minmax(0,2fr)' },
			{ key: 'category', label: 'Category', width: 'minmax(0,1fr)' },
			{ key: 'active', label: 'Active', width: '80px' },
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
		formFields: [
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
			{ key: 'category', label: 'Category', type: 'text' },
			{ key: 'shortDescription', label: 'Short Description', type: 'text', required: true },
			{ key: 'description', label: 'Full Description', type: 'textarea', placeholder: 'Detailed description of this code...', width: 'span 2' },
			{ key: 'feeStandard', label: 'Fee Standard ($)', type: 'number' },
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
		],
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
				],
			},
			{
				key: 'locationName', placeholder: 'All Locations',
				options: [
					{ label: 'Main Storage', value: 'Main Storage' },
					{ label: 'Pharmacy', value: 'Pharmacy' },
					{ label: 'Front Desk', value: 'Front Desk' },
					{ label: 'Exam Room', value: 'Exam Room' },
				],
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
			// Issue #13: Category / Location / Supplier are dropdowns loaded from
			// the backend (matching ciyex-ehr-ui) instead of free-text ID inputs.
			{ key: 'categoryId', label: 'Category', type: 'select', optionsApiPath: '/api/inventory/categories', aliases: ['category.id'] },
			{ key: 'locationId', label: 'Location', type: 'select', optionsApiPath: '/api/inventory/locations', aliases: ['location.id'] },
			{ key: 'supplierId', label: 'Supplier', type: 'select', optionsApiPath: '/api/suppliers', aliases: ['supplier.id'] },
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
			{ key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Medline Industries' },
			{ key: 'contactName', label: 'Contact Name', type: 'text', placeholder: 'e.g. John Smith' },
			{ key: 'phone', label: 'Phone', type: 'text', placeholder: 'e.g. (555) 123-4567' },
			{ key: 'email', label: 'Email', type: 'text', placeholder: 'e.g. contact@supplier.com' },
			// Address is part of the ciyex-ehr-ui Add Supplier form (and the backend
			// InvSupplierDto supports it) — Name | Contact | Phone | Email | Address |
			// Notes | Status.
			{ key: 'address', label: 'Address', type: 'text', placeholder: 'e.g. 123 Main St, City, State' },
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
			{ key: 'location', label: 'Location', type: 'text', placeholder: 'Where is the equipment?' },
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
		addBtn.addEventListener('click', async () => {
			const name = input.value.trim();
			if (!name) { return; }
			addBtn.disabled = true;
			try {
				const payload: Record<string, unknown> = { name };
				if (typeHidden) { payload.type = typeHidden.value; }
				await this.apiService.fetch(apiPath, { method: 'POST', body: JSON.stringify(payload) });
				input.value = '';
				void this._renderSettings();
			} catch { addBtn.disabled = false; }
		});

		const listEl = DOM.append(card, DOM.$('div'));
		listEl.textContent = 'Loading…';
		listEl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		try {
			const res = await this.apiService.fetch(`${apiPath}?page=0&size=200`);
			const json = res.ok ? await res.json() : null;
			const wrapper = json?.data ?? json;
			const items = (wrapper?.content || (Array.isArray(wrapper) ? wrapper : [])) as Array<Record<string, unknown>>;
			DOM.clearNode(listEl);
			listEl.style.color = 'var(--vscode-foreground)';
			if (items.length === 0) { listEl.textContent = `No ${singular.toLowerCase()} records yet.`; return; }
			for (const item of items) {
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
		} catch {
			DOM.clearNode(listEl);
			listEl.textContent = `Could not load ${singular.toLowerCase()} list.`;
		}
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

		const overlay = DOM.append(this.root, DOM.$('div'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;';
		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);';
		backdrop.addEventListener('click', () => overlay.remove());
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
		const odWrap = DOM.append(hr2, DOM.$('div')); fieldLabel(odWrap, 'Order Date');
		const orderDate = DOM.append(odWrap, DOM.$('input')) as HTMLInputElement;
		orderDate.type = 'date'; orderDate.style.cssText = inputStyle;
		orderDate.value = String(existing?.orderDate ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
		const edWrap = DOM.append(hr2, DOM.$('div')); fieldLabel(edWrap, 'Expected Date');
		const expectedDate = DOM.append(edWrap, DOM.$('input')) as HTMLInputElement;
		expectedDate.type = 'date'; expectedDate.style.cssText = inputStyle;
		expectedDate.value = String(existing?.expectedDate ?? '').slice(0, 10);

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
			row.style.cssText = 'display:grid;grid-template-columns:minmax(0,2fr) 52px 64px 70px 70px 90px 22px;gap:6px;align-items:center;margin-bottom:6px;';
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
				i.style.cssText = inputStyle + 'font-size:12px;padding:4px 6px;';
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

interface CreditCardRecord {
	id: number;
	patientId?: number;
	cardHolderName: string;
	cardType: string;
	expiryMonth: number;
	expiryYear: number;
	billingAddress?: string;
	billingCity?: string;
	billingState?: string;
	billingZip?: string;
	billingCountry?: string;
	isDefault?: boolean;
	isActive?: boolean;
	maskedCardNumber?: string;
	isExpired?: boolean;
}

export class PaymentsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPayments';

	private payView: 'transactions' | 'methods' | 'plans' | 'ledger' = 'transactions';
	// Plans + Ledger are patient-scoped on the backend (no global list route),
	// so those two views require a selected patient (matches ciyex-ehr-ui).
	private _payPatientId = '';
	private _payPatientName = '';
	private _payPatientBar: HTMLElement | null = null;
	// allow-any-unicode-next-line
	// ── Credit-card grid state ──────────────────────────────────────────────
	private _cards: CreditCardRecord[] = [];
	private _cardsSearch = '';
	private _cardsLoading = false;
	private _cardFormOverlay: HTMLElement | null = null;
	private _cardFormBackdrop: HTMLElement | null = null;

	private readonly _transactionsConfig: ClinicalEditorConfig = {
		title: 'Transactions', apiPath: '/api/payments/transactions', statsPath: '/api/payments/stats',
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
			{ key: 'patientName', label: 'Patient' },
			{ key: 'amount', label: 'Amount', width: '90px' },
			{ key: 'transactionType', label: 'Type', width: '100px' },
			{ key: 'paymentMethodType', label: 'Method', width: '100px' },
			{ key: 'description', label: 'Description' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'collectedAt', label: 'Date', width: '110px' },
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
		formFields: [
			{
				key: 'patientName', label: 'Patient', type: 'search', required: true,
				placeholder: 'Search patient...', apiPath: '/api/patients',
				relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'],
			},
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{ key: 'amount', label: 'Amount ($)', type: 'number', required: true, placeholder: '0.00' },
			{
				key: 'transactionType', label: 'Type', type: 'select', options: [
					{ label: 'Payment', value: 'payment' },
					{ label: 'Copay', value: 'copay' },
					{ label: 'Deductible', value: 'deductible' },
					{ label: 'Coinsurance', value: 'coinsurance' },
					{ label: 'Self-Pay', value: 'self_pay' },
				], defaultValue: 'payment'
			},
			{
				key: 'paymentMethodType', label: 'Method', type: 'select', required: true, options: [
					{ label: 'Credit Card', value: 'credit_card' },
					{ label: 'Debit Card', value: 'debit_card' },
					{ label: 'Cash', value: 'cash' },
					{ label: 'Check', value: 'check' },
					{ label: 'ACH', value: 'ach' },
					{ label: 'Other', value: 'other' },
				]
			},
			{ key: 'description', label: 'Description', type: 'text', placeholder: 'Visit copay, lab, etc.' },
			{ key: 'invoiceId', label: 'Invoice ID', type: 'text', placeholder: 'Optional — link to invoice' },
			{ key: 'notes', label: 'Notes / Stripe Charge ID', type: 'text', placeholder: 'Stripe charge id (ch_...), check #, ...' },
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Pending', value: 'pending' },
					{ label: 'Processing', value: 'processing' },
					{ label: 'Completed', value: 'completed' },
				], defaultValue: 'completed'
			},
		],
		cellRenderer: (key: string, value: unknown, item: Record<string, unknown>): string => {
			if (key === 'amount' && typeof value === 'number') { return `$${value.toFixed(2)}`; }
			if (key === 'collectedAt' && typeof value === 'string') {
				try { return new Date(value).toLocaleString(); } catch { return String(value); }
			}
			if (key === 'patientName' && !value) {
				// Fall back to patientId if name not set
				return item['patientId'] ? `Patient #${item['patientId']}` : '';
			}
			if (key === 'transactionType' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'paymentMethodType' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
				empty.textContent = this._cardsLoading ? 'Loading…' : 'No payment methods found.';
				return;
			}
			for (const card of filtered) { this._renderCardItem(grid, card, renderGrid); }
		};

		searchEl.addEventListener('input', () => { this._cardsSearch = searchEl.value; renderGrid(); });
		addBtn.addEventListener('click', () => this._openCardForm(null, renderGrid));

		// Load data
		this._cardsLoading = true;
		renderGrid();
		try {
			const res = await this.apiService.fetch('/api/credit-cards?page=0&size=200');
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
		try {
			const res = await this.apiService.fetch('/api/credit-cards?page=0&size=200');
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
		backdrop.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.4);';
		mount.appendChild(backdrop);
		this._cardFormBackdrop = backdrop;

		const overlay = doc.createElement('div');
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		overlay.style.cssText = `position:fixed;top:0;right:0;bottom:0;z-index:10000;width:560px;max-width:95vw;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border,#454545);box-shadow:-8px 0 24px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;color:var(--vscode-foreground);color-scheme:${colorScheme};`;
		mount.appendChild(overlay);
		this._cardFormOverlay = overlay;

		const close = () => { overlay.remove(); backdrop.remove(); this._cardFormOverlay = null; this._cardFormBackdrop = null; };
		backdrop.addEventListener('click', close);

		// Header
		const hdr = DOM.append(overlay, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--vscode-editorWidget-border,#454545);flex-shrink:0;';
		const titleEl = DOM.append(hdr, DOM.$('h3'));
		titleEl.textContent = card ? 'Edit Card' : 'Add Payment Method';
		titleEl.style.cssText = 'margin:0;font-size:15px;font-weight:600;color:var(--vscode-foreground);';
		const closeBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '×';
		closeBtn.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:var(--vscode-descriptionForeground);line-height:1;padding:0 4px;';
		closeBtn.addEventListener('click', close);

		// Scrollable form body
		const body = DOM.append(overlay, DOM.$('div'));
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

		const cvvEl = inp('CVV *', 'cvv', false, { maxLength: 4, placeholder: '123' });
		cvvEl.addEventListener('input', () => { cvvEl.value = cvvEl.value.replace(/\D/g, ''); });

		const addrEl = inp('Billing Address', 'billingAddress', true, { placeholder: '123 Main St' });
		const cityEl = inp('City', 'billingCity', false, { maxLength: 50, placeholder: 'New York' });
		const stateEl = inp('State', 'billingState', false, { maxLength: 50, placeholder: 'NY' });
		const zipEl = inp('Zip Code', 'billingZip', false, { maxLength: 10, placeholder: '10001' });
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
			addrEl.value = card.billingAddress || '';
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
		const footer = DOM.append(overlay, DOM.$('div'));
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

			const payload: Record<string, unknown> = {
				cardHolderName: holder,
				cardType: typeEl.value,
				expiryMonth: Number(monthEl.value),
				expiryYear: Number(yearEl.value),
				billingAddress: addrEl.value.trim() || undefined,
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
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'planName', label: 'Plan Name' },
			{ key: 'totalAmount', label: 'Total', width: '90px' },
			{ key: 'paidAmount', label: 'Paid', width: '90px' },
			{ key: 'remainingAmount', label: 'Remaining', width: '90px' },
			{ key: 'installments', label: 'Installments', width: '90px' },
			{ key: 'nextDueDate', label: 'Next Due', width: '110px' },
			{ key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Active', value: 'active' }, { label: 'Completed', value: 'completed' },
			{ label: 'Defaulted', value: 'defaulted' }, { label: 'Cancelled', value: 'cancelled' },
		],
		cellRenderer: (key, value) => {
			if ((key === 'totalAmount' || key === 'paidAmount' || key === 'remainingAmount') && typeof value === 'number') {
				return `$${value.toFixed(2)}`;
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
			{ key: 'totalAmount', label: 'Total Amount ($)', type: 'number', required: true, placeholder: '0.00' },
			{ key: 'installments', label: 'Number of Installments', type: 'number', required: true, placeholder: '6' },
			{ key: 'startDate', label: 'Start Date', type: 'date', defaultValue: () => new Date().toISOString().slice(0, 10) },
			{ key: 'nextDueDate', label: 'Next Due Date', type: 'date' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Plan notes...' },
		],
		actions: [
			// allow-any-unicode-next-line
			{ label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => { const r = await dlg.confirm({ message: 'Cancel this payment plan?', type: 'warning', primaryButton: 'Cancel Plan' }); if (r.confirmed) { await api.fetch(`/api/payments/plans/${item.id}`, { method: 'DELETE' }); reload(); } } },
		],
	};

	private readonly _ledgerConfig: ClinicalEditorConfig = {
		title: 'Ledger', apiPath: '/api/payments/ledger',
		searchPlaceholder: 'Search ledger entries...',
		// Backend only exposes /api/payments/ledger/patient/{id} for GET
		// (a bare GET /api/payments/ledger has no endpoint → 500). Scope by patient.
		listUrlBuilder: () => this._payPatientId ? `/api/payments/ledger/patient/${this._payPatientId}` : null,
		emptyListMessage: 'Select a patient to view their ledger.',
		clientSideFilter: ['patientName', 'entryType', 'description', 'id'],
		editable: false,
		columns: [
			{ key: 'entryDate', label: 'Date', width: '110px' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'entryType', label: 'Type', width: '100px' },
			{ key: 'description', label: 'Description' },
			{ key: 'debit', label: 'Debit', width: '90px' },
			{ key: 'credit', label: 'Credit', width: '90px' },
			{ key: 'balance', label: 'Balance', width: '90px' },
		],
		cellRenderer: (key, value) => {
			if ((key === 'debit' || key === 'credit' || key === 'balance') && typeof value === 'number') {
				return `$${value.toFixed(2)}`;
			}
			if (key === 'entryDate' && typeof value === 'string') {
				try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
			}
			if (key === 'entryType' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		actions: [],
	};

	// Thin stub used only when payView === 'methods' to satisfy the abstract
	// config getter — actual rendering is done by _loadAndRenderCards().
	private readonly _methodsConfig: ClinicalEditorConfig = {
		title: 'Payment Methods', apiPath: '/api/credit-cards',
		searchPlaceholder: '', clientSideFilter: [], columns: [], formFields: [],
	};

	// @ts-ignore — override abstract readonly with getter
	protected get config(): ClinicalEditorConfig {
		switch (this.payView) {
			case 'methods': return this._methodsConfig;
			case 'plans': return this._plansConfig;
			case 'ledger': return this._ledgerConfig;
			default: return this._transactionsConfig;
		}
	}

	protected override _resetAndReload(): void {
		if (this.payView === 'methods') {
			this._loadAndRenderCards();
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
		const payTabs: Array<{ view: 'transactions' | 'methods' | 'plans' | 'ledger'; label: string }> = [
			{ view: 'transactions', label: 'Transactions' },
			{ view: 'methods', label: 'Payment Methods' },
			{ view: 'plans', label: 'Payment Plans' },
			{ view: 'ledger', label: 'Ledger' },
		];
		payTabs.forEach(({ view, label }) => {
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
	 * Patient picker shown only for the patient-scoped Plans / Ledger views.
	 * Typing 2+ chars searches /api/patients; picking a result scopes the list
	 * to that patient (the only way the backend serves plans/ledger data).
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

		parent.appendChild(bar);
		this._payPatientBar = bar;
	}

	private _syncPayPatientBar(): void {
		if (this._payPatientBar) {
			this._payPatientBar.style.display = (this.payView === 'plans' || this.payView === 'ledger') ? 'flex' : 'none';
		}
	}

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(PaymentsEditor.ID, group, t, th, s, a, d); }
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
					const r = await api.fetch(`/api/all-claims/${item.claimId || item.id}/sends`, { method: 'POST' });
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
