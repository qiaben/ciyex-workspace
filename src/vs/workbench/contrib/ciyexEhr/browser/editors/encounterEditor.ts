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
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { BaseCiyexInput } from './ciyexEditorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface FieldDef { key: string; label?: string; type?: string; required?: boolean; colSpan?: number;[k: string]: unknown }
interface SectionDef { key: string; title: string; columns?: number; visible?: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[]; sectionComponent?: string;[k: string]: unknown }
interface FieldConfig { sections: SectionDef[]; features?: unknown }

/**
 * Encounter Settings editor — mirrors the EHR UI's
 * `/settings/encounter-settings` page exactly. Loads field config from
 * `/api/tab-field-config/encounter-form`, renders a single-table view with
 * Section / Fields / Columns / Status (visible toggle) / Order columns, and
 * persists back to the same endpoint with PUT. Falls back to a local
 * `encounter.json` file when the API is unavailable so the editor still
 * works offline.
 */
export class EncounterEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexEncounter';
	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private config: FieldConfig = { sections: [] };
	private fhirResources: unknown[] = [];
	private configSource: 'UNIVERSAL_DEFAULT' | 'ORG_CUSTOM' = 'UNIVERSAL_DEFAULT';
	private search = '';
	private expandedSection: string | null = null;
	private loading = true;
	private saving = false;
	private saved = false;
	private _dirty = false;
	private _apiAvailable = false;
	get dirty(): boolean { return this._dirty; }

	constructor(
		group: IEditorGroup,
		@ITelemetryService t: ITelemetryService,
		@IThemeService th: IThemeService,
		@IStorageService s: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(EncounterEditor.ID, group, t, th, s);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-encounter-settings.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';
		this.contentEl = DOM.append(this.root, DOM.$('.content'));
		this.contentEl.style.cssText = 'max-width:1100px;margin:0 auto;padding:24px;';
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this._loadData();
		if (!token.isCancellationRequested) { this._render(); }
	}

	private async _loadData(): Promise<void> {
		this.loading = true;
		// Prefer the API (server-side per-org config). Fall back to the local
		// encounter.json file when the API is unreachable (no login / offline).
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/encounter-form');
			if (res.ok) {
				const json = await res.json();
				const tc = json?.data || json;
				const fc: FieldConfig = typeof tc.fieldConfig === 'string'
					? JSON.parse(tc.fieldConfig)
					: (tc.fieldConfig as FieldConfig);
				if (fc?.sections) {
					fc.sections = fc.sections.map(s => ({ ...s, visible: s.visible !== false }));
				}
				this.config = fc || { sections: [] };
				this.fhirResources = tc.fhirResources || [];
				this.configSource = (tc.orgId && tc.orgId !== '*') ? 'ORG_CUSTOM' : 'UNIVERSAL_DEFAULT';
				this._apiAvailable = true;
				this.loading = false;
				return;
			}
		} catch { /* fall through to file-based fallback */ }

		// File-based fallback (legacy on-disk encounter.json)
		this._apiAvailable = false;
		const input = this.input as BaseCiyexInput;
		try {
			const c = await this.fileService.readFile(input.fileUri);
			const parsed = JSON.parse(c.value.toString());
			this.config = parsed.fieldConfig || parsed || { sections: [] };
		} catch { /* file missing — seed defaults */ }
		if (!this.config?.sections || this.config.sections.length === 0) {
			this.config = { sections: EncounterEditor._defaultSections() };
			this._dirty = true;
		}
		this.loading = false;
	}

	private static _defaultSections(): SectionDef[] {
		return [
			{ key: 'chief-complaint', title: 'Chief Complaint', columns: 1, visible: true, fields: [{ key: 'chiefComplaint', label: 'Chief Complaint', type: 'textarea', required: true }] },
			{ key: 'hpi', title: 'History of Present Illness', columns: 2, visible: true, fields: [{ key: 'hpi_onset', label: 'Onset', type: 'text' }, { key: 'hpi_location', label: 'Location', type: 'text' }, { key: 'hpi_duration', label: 'Duration', type: 'text' }, { key: 'hpi_severity', label: 'Severity', type: 'select' }] },
			{ key: 'ros', title: 'Review of Systems', columns: 1, visible: true, fields: [{ key: 'ros_data', label: 'Review of Systems', type: 'ros-grid' }] },
			{ key: 'vitals', title: 'Vitals', columns: 4, visible: true, fields: [{ key: 'vitals_bp_systolic', label: 'BP Systolic', type: 'number' }, { key: 'vitals_bp_diastolic', label: 'BP Diastolic', type: 'number' }, { key: 'vitals_heart_rate', label: 'Heart Rate', type: 'number' }, { key: 'vitals_spo2', label: 'SpO2', type: 'number' }] },
			{ key: 'physical-exam', title: 'Physical Exam', columns: 1, visible: true, fields: [{ key: 'pe_data', label: 'Physical Exam', type: 'exam-grid' }] },
			{ key: 'past-medical-history', title: 'Past Medical / Surgical History', columns: 1, visible: true, fields: [{ key: 'pmh_conditions', label: 'Medical History', type: 'textarea' }, { key: 'pmh_allergies', label: 'Allergies', type: 'textarea' }] },
			{ key: 'family-history', title: 'Family History', columns: 2, visible: true, fields: [{ key: 'fh_mother', label: 'Mother', type: 'text' }, { key: 'fh_father', label: 'Father', type: 'text' }, { key: 'fh_siblings', label: 'Siblings', type: 'text' }, { key: 'fh_notes', label: 'Notes', type: 'textarea' }] },
			{ key: 'social-history', title: 'Social History', columns: 3, visible: true, fields: [{ key: 'sh_tobacco', label: 'Tobacco', type: 'text' }, { key: 'sh_alcohol', label: 'Alcohol', type: 'text' }, { key: 'sh_drugs', label: 'Substance Use', type: 'text' }, { key: 'sh_occupation', label: 'Occupation', type: 'text' }, { key: 'sh_marital', label: 'Marital Status', type: 'text' }, { key: 'sh_exercise', label: 'Exercise', type: 'text' }] },
			{ key: 'assessment', title: 'Assessment & Diagnosis', columns: 1, visible: true, fields: [{ key: 'assessment_diagnoses', label: 'Diagnoses', type: 'diagnosis-list' }, { key: 'assessment_notes', label: 'Notes', type: 'textarea' }] },
			{ key: 'plan', title: 'Plan', columns: 1, visible: true, fields: [{ key: 'plan_items', label: 'Plan Items', type: 'plan-items' }, { key: 'plan_notes', label: 'Notes', type: 'textarea' }, { key: 'plan_followup', label: 'Follow-up', type: 'text' }] },
		];
	}

	private _filteredSections(): SectionDef[] {
		if (!this.config?.sections) { return []; }
		const term = this.search.trim().toLowerCase();
		if (!term) { return this.config.sections; }
		return this.config.sections.filter(s => s.title.toLowerCase().includes(term) || s.key.toLowerCase().includes(term));
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);
		if (this.loading) {
			const loader = DOM.append(this.contentEl, DOM.$('div'));
			loader.textContent = 'Loading encounter configuration…';
			loader.style.cssText = 'padding:48px 0;text-align:center;color:var(--vscode-descriptionForeground);';
			return;
		}

		// --- Header
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:16px;';
		const headLeft = DOM.append(header, DOM.$('div'));
		const title = DOM.append(headLeft, DOM.$('h1'));
		// allow-any-unicode-next-line
		title.textContent = '📋 Encounter Form Configuration';
		title.style.cssText = 'margin:0;font-size:22px;font-weight:600;display:flex;align-items:center;gap:8px;';
		const sub = DOM.append(headLeft, DOM.$('p'));
		// allow-any-unicode-next-line
		sub.textContent = 'Configure encounter form sections — enable/disable, reorder, and adjust display settings. Changes are saved to the server and apply to all users.';
		sub.style.cssText = 'margin:6px 0 0;color:var(--vscode-descriptionForeground);font-size:13px;max-width:680px;';

		const badge = DOM.append(header, DOM.$('span'));
		badge.textContent = this.configSource === 'ORG_CUSTOM' ? 'Custom Config' : 'Universal Default';
		const customBadge = this.configSource === 'ORG_CUSTOM';
		badge.style.cssText = `padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;flex-shrink:0;${customBadge ? 'background:rgba(37,99,235,0.15);color:#2563eb;' : 'background:rgba(148,163,184,0.15);color:#64748b;'}`;

		// --- Controls
		const controls = DOM.append(this.contentEl, DOM.$('div'));
		controls.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap;';

		const leftCtrl = DOM.append(controls, DOM.$('div'));
		leftCtrl.style.cssText = 'display:flex;align-items:center;gap:12px;';

		const searchInput = DOM.append(leftCtrl, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		// allow-any-unicode-next-line
		searchInput.placeholder = '\u{1F50D} Search sections…';
		searchInput.value = this.search;
		searchInput.style.cssText = 'padding:6px 12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;outline:none;width:240px;';
		searchInput.addEventListener('input', () => { this.search = searchInput.value; this._renderTable(); });

		const enabledCount = (this.config.sections || []).filter(s => s.visible !== false).length;
		const totalCount = this.config.sections?.length || 0;
		const stats = DOM.append(leftCtrl, DOM.$('span'));
		stats.textContent = `${enabledCount}/${totalCount} enabled`;
		stats.style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);';

		const rightCtrl = DOM.append(controls, DOM.$('div'));
		rightCtrl.style.cssText = 'display:flex;align-items:center;gap:8px;';

		const codeBtn = DOM.append(rightCtrl, DOM.$('button')) as HTMLButtonElement;
		codeBtn.textContent = '</> Code';
		codeBtn.style.cssText = 'padding:6px 12px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		codeBtn.addEventListener('click', () => this._openJson());

		const resetBtn = DOM.append(rightCtrl, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		resetBtn.textContent = '↺ Reset to Defaults';
		resetBtn.disabled = this.saving || this.configSource === 'UNIVERSAL_DEFAULT';
		resetBtn.style.cssText = `padding:6px 12px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-foreground);cursor:${resetBtn.disabled ? 'not-allowed' : 'pointer'};font-size:12px;opacity:${resetBtn.disabled ? '0.5' : '1'};`;
		resetBtn.addEventListener('click', () => this._reset());

		const saveBtn = DOM.append(rightCtrl, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		saveBtn.textContent = this.saving ? 'Saving…' : (this.saved ? '✓ Saved!' : '\u{1F4BE} Save Changes');
		saveBtn.disabled = this.saving;
		saveBtn.style.cssText = `padding:6px 14px;background:#2563eb;color:#ffffff;border:none;border-radius:6px;cursor:${saveBtn.disabled ? 'not-allowed' : 'pointer'};font-size:13px;font-weight:600;opacity:${saveBtn.disabled ? '0.6' : '1'};`;
		saveBtn.addEventListener('click', () => this._save());

		// --- Table container (re-rendered on search/toggle/move)
		this._tableContainer = DOM.append(this.contentEl, DOM.$('div'));
		this._tableContainer.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:10px;overflow:hidden;';
		this._renderTable();

		// --- Info footer
		const info = DOM.append(this.contentEl, DOM.$('div'));
		info.style.cssText = 'margin-top:16px;padding:12px 14px;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.25);border-radius:8px;font-size:12px;color:var(--vscode-foreground);';
		const infoStrong = DOM.append(info, DOM.$('strong'));
		infoStrong.textContent = 'Note: ';
		const infoText = DOM.append(info, DOM.$('span'));
		infoText.textContent = 'This page controls section visibility, ordering, and display properties. To edit fields within a section (add/remove/reorder fields, change field types), use the Field Configuration editor for Encounter.';
	}

	private _tableContainer!: HTMLElement;
	private _renderTable(): void {
		DOM.clearNode(this._tableContainer);
		const table = DOM.append(this._tableContainer, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;';

		const thead = DOM.append(table, DOM.$('thead'));
		thead.style.cssText = 'background:rgba(148,163,184,0.08);';
		const headerRow = DOM.append(thead, DOM.$('tr'));
		const headers: Array<[string, string]> = [
			['', 'width:32px'],
			['SECTION', 'width:35%'],
			['FIELDS', ''],
			['COLUMNS', 'width:96px;text-align:center;'],
			['STATUS', 'width:96px;text-align:center;'],
			['ORDER', 'width:96px;text-align:center;'],
		];
		for (const [label, style] of headers) {
			const th = DOM.append(headerRow, DOM.$('th'));
			th.textContent = label;
			th.style.cssText = `padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);letter-spacing:0.04em;${style}`;
		}

		const tbody = DOM.append(table, DOM.$('tbody'));
		const filtered = this._filteredSections();
		if (filtered.length === 0) {
			const row = DOM.append(tbody, DOM.$('tr'));
			const cell = DOM.append(row, DOM.$('td'));
			cell.setAttribute('colspan', '6');
			cell.textContent = this.search ? 'No sections match your search.' : 'No encounter form configuration found.';
			cell.style.cssText = 'padding:36px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
			return;
		}

		for (const section of filtered) {
			this._renderRow(tbody, section);
		}
	}

	private _renderRow(tbody: HTMLElement, section: SectionDef): void {
		const row = DOM.append(tbody, DOM.$('tr'));
		row.style.cssText = `border-top:1px solid rgba(148,163,184,0.15);${section.visible === false ? 'opacity:0.5;' : ''}`;
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(148,163,184,0.05))'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		// Grip
		const gripCell = DOM.append(row, DOM.$('td'));
		gripCell.style.cssText = 'padding:10px 12px;';
		const grip = DOM.append(gripCell, DOM.$('span'));
		// allow-any-unicode-next-line
		grip.textContent = '⋮⋮';
		grip.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:14px;cursor:grab;';

		// Section (name + expand toggle)
		const sectionCell = DOM.append(row, DOM.$('td'));
		sectionCell.style.cssText = 'padding:10px 12px;';
		const sectionInner = DOM.append(sectionCell, DOM.$('div'));
		sectionInner.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const isExpanded = this.expandedSection === section.key;
		const chevron = DOM.append(sectionInner, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		chevron.textContent = isExpanded ? '▾' : '▸';
		chevron.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--vscode-descriptionForeground);font-size:12px;padding:2px 4px;';
		chevron.addEventListener('click', () => {
			this.expandedSection = isExpanded ? null : section.key;
			this._renderTable();
		});
		const dot = DOM.append(sectionInner, DOM.$('span'));
		dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${section.visible !== false ? '#22c55e' : '#9ca3af'};display:inline-block;`;
		const name = DOM.append(sectionInner, DOM.$('span'));
		name.textContent = section.title;
		name.style.cssText = 'font-size:13px;font-weight:500;color:var(--vscode-foreground);';
		const keyLabel = DOM.append(sectionInner, DOM.$('span'));
		keyLabel.textContent = section.key;
		keyLabel.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		// Fields count
		const fieldsCell = DOM.append(row, DOM.$('td'));
		fieldsCell.style.cssText = 'padding:10px 12px;';
		const fieldsCount = DOM.append(fieldsCell, DOM.$('span'));
		fieldsCount.textContent = `${section.fields?.length || 0} fields`;
		fieldsCount.style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);';

		// Columns
		const colsCell = DOM.append(row, DOM.$('td'));
		colsCell.style.cssText = 'padding:10px 12px;text-align:center;';
		const colsSel = DOM.append(colsCell, DOM.$('select')) as HTMLSelectElement;
		colsSel.style.cssText = 'padding:3px 6px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;cursor:pointer;';
		for (const n of [1, 2, 3, 4]) {
			const opt = DOM.append(colsSel, DOM.$('option')) as HTMLOptionElement;
			opt.value = String(n);
			opt.textContent = String(n);
			if ((section.columns || 1) === n) { opt.selected = true; }
		}
		colsSel.addEventListener('change', () => {
			section.columns = parseInt(colsSel.value);
			this._dirty = true;
		});

		// Status toggle (visible)
		const statusCell = DOM.append(row, DOM.$('td'));
		statusCell.style.cssText = 'padding:10px 12px;text-align:center;';
		const toggle = DOM.append(statusCell, DOM.$('button')) as HTMLButtonElement;
		const visible = section.visible !== false;
		toggle.style.cssText = `position:relative;display:inline-flex;align-items:center;width:40px;height:22px;border:none;border-radius:999px;cursor:pointer;background:${visible ? '#22c55e' : '#9ca3af'};transition:background 120ms;`;
		const knob = DOM.append(toggle, DOM.$('span'));
		knob.style.cssText = `position:absolute;top:3px;left:${visible ? '21px' : '3px'};width:16px;height:16px;border-radius:50%;background:#ffffff;transition:left 120ms;`;
		toggle.addEventListener('click', () => {
			section.visible = !visible;
			this._dirty = true;
			this._renderTable();
		});

		// Order arrows
		const orderCell = DOM.append(row, DOM.$('td'));
		orderCell.style.cssText = 'padding:10px 12px;text-align:center;';
		const orderWrap = DOM.append(orderCell, DOM.$('div'));
		orderWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
		const upBtn = DOM.append(orderWrap, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		upBtn.textContent = '↑';
		upBtn.disabled = !!this.search.trim();
		upBtn.style.cssText = `background:none;border:none;color:var(--vscode-descriptionForeground);font-size:14px;cursor:${upBtn.disabled ? 'not-allowed' : 'pointer'};padding:2px 6px;border-radius:4px;opacity:${upBtn.disabled ? '0.4' : '1'};`;
		upBtn.addEventListener('click', () => this._move(section.key, 'up'));
		const downBtn = DOM.append(orderWrap, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		downBtn.textContent = '↓';
		downBtn.disabled = !!this.search.trim();
		downBtn.style.cssText = `background:none;border:none;color:var(--vscode-descriptionForeground);font-size:14px;cursor:${downBtn.disabled ? 'not-allowed' : 'pointer'};padding:2px 6px;border-radius:4px;opacity:${downBtn.disabled ? '0.4' : '1'};`;
		downBtn.addEventListener('click', () => this._move(section.key, 'down'));

		// Expanded details row
		if (isExpanded) {
			const detailRow = DOM.append(tbody, DOM.$('tr'));
			detailRow.style.cssText = 'background:rgba(148,163,184,0.04);border-top:1px solid rgba(148,163,184,0.15);';
			const detailCell = DOM.append(detailRow, DOM.$('td'));
			detailCell.setAttribute('colspan', '6');
			detailCell.style.cssText = 'padding:16px 28px;';
			const grid = DOM.append(detailCell, DOM.$('div'));
			grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;';
			this._renderDetailToggle(grid, 'Collapsible', !!section.collapsible, () => { section.collapsible = !section.collapsible; this._dirty = true; this._renderTable(); });
			this._renderDetailToggle(grid, 'Default Collapsed', !!section.collapsed, () => { section.collapsed = !section.collapsed; this._dirty = true; this._renderTable(); });
			const fieldsBlock = DOM.append(grid, DOM.$('div'));
			fieldsBlock.style.cssText = 'grid-column:span 2;';
			const fieldsLabel = DOM.append(fieldsBlock, DOM.$('div'));
			fieldsLabel.textContent = 'Fields in this section';
			fieldsLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:6px;';
			const chips = DOM.append(fieldsBlock, DOM.$('div'));
			chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
			if ((section.fields?.length || 0) === 0) {
				const empty = DOM.append(chips, DOM.$('span'));
				empty.textContent = 'No fields';
				empty.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
			}
			for (const f of section.fields || []) {
				const chip = DOM.append(chips, DOM.$('span'));
				chip.textContent = f.label || f.key;
				chip.style.cssText = 'padding:2px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;font-size:11px;color:var(--vscode-foreground);';
			}
		}
	}

	private _renderDetailToggle(parent: HTMLElement, label: string, enabled: boolean, onToggle: () => void): void {
		const block = DOM.append(parent, DOM.$('div'));
		const lbl = DOM.append(block, DOM.$('div'));
		lbl.textContent = label;
		lbl.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const btn = DOM.append(block, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = enabled ? 'Yes' : 'No';
		btn.style.cssText = `padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:none;${enabled ? 'background:rgba(37,99,235,0.15);color:#2563eb;' : 'background:rgba(148,163,184,0.15);color:var(--vscode-descriptionForeground);'}`;
		btn.addEventListener('click', onToggle);
	}

	private _move(key: string, dir: 'up' | 'down'): void {
		const secs = this.config.sections;
		const idx = secs.findIndex(s => s.key === key);
		if (idx === -1) { return; }
		const newIdx = dir === 'up' ? idx - 1 : idx + 1;
		if (newIdx < 0 || newIdx >= secs.length) { return; }
		[secs[idx], secs[newIdx]] = [secs[newIdx], secs[idx]];
		this._dirty = true;
		this._renderTable();
	}

	private async _save(): Promise<void> {
		this.saving = true;
		this._render();
		try {
			if (this._apiAvailable) {
				const res = await this.apiService.fetch('/api/tab-field-config/encounter-form', {
					method: 'PUT',
					body: JSON.stringify({ fieldConfig: this.config, fhirResources: this.fhirResources }),
				});
				if (res.ok) {
					this.configSource = 'ORG_CUSTOM';
					this._dirty = false;
					this.saved = true;
					this.notificationService.notify({ severity: Severity.Info, message: 'Encounter configuration saved.' });
					setTimeout(() => { this.saved = false; this._render(); }, 1500);
				} else {
					const err = await res.json().catch(() => null);
					this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Failed to save (${res.status}).` });
				}
			} else {
				const input = this.input as BaseCiyexInput;
				await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify({ fieldConfig: this.config }, null, 2)));
				this._dirty = false;
				this.notificationService.notify({ severity: Severity.Info, message: 'Encounter form saved to file.' });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		} finally {
			this.saving = false;
			this._render();
		}
	}

	private async _reset(): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: 'Reset to defaults? Your custom encounter configuration will be removed.' });
		if (!confirmed) { return; }
		this.saving = true;
		this._render();
		try {
			if (this._apiAvailable) {
				const res = await this.apiService.fetch('/api/tab-field-config/encounter-form', { method: 'DELETE' });
				if (res.ok) {
					await this._loadData();
					this.notificationService.notify({ severity: Severity.Info, message: 'Reset to defaults.' });
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: 'Failed to reset.' });
				}
			} else {
				this.config = { sections: EncounterEditor._defaultSections() };
				this._dirty = true;
				this.notificationService.notify({ severity: Severity.Info, message: 'Reset to defaults (file fallback).' });
			}
		} finally {
			this.saving = false;
			this._render();
		}
	}

	private _openJson(): void {
		const i = this.input as BaseCiyexInput;
		if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); }
	}

	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
