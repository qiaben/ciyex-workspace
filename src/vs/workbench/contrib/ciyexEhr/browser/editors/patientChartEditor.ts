/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { PatientChartEditorInput, EncounterFormEditorInput } from './ciyexEditorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import * as DOM from '../../../../../base/browser/dom.js';

// ─── Types ───
interface ChartCategory { key: string; label: string; position: number; hideFromChart?: boolean; tabs: ChartTab[] }
interface ChartTab { key: string; label: string; icon: string; emoji?: string; color?: string; position: number; visible: boolean; display?: 'form' | 'list'; panel?: 'main' | 'bottom' | 'right'; fhirResources: string[] }
interface FieldSection { key: string; title: string; columns: number; visible: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[] }
interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; options?: Array<{ label: string; value: string }>; fhirMapping?: Record<string, string>; validation?: Record<string, unknown>; lookupConfig?: Record<string, string> }
interface FieldConfig { tabKey: string; sections: FieldSection[] }

// Colors and icons come from chart-layout.json per tab (color + emoji fields)
// No hardcoded colors — everything from config

const FHIR_MAP: Record<string, string> = {
	'Patient': '/api/fhir-resource/demographics', 'Encounter': '/api/fhir-resource/encounters',
	'Condition': '/api/fhir-resource/conditions', 'AllergyIntolerance': '/api/fhir-resource/allergy-intolerances',
	'MedicationRequest': '/api/fhir-resource/medication-requests', 'Observation': '/api/fhir-resource/observations',
	'DiagnosticReport': '/api/fhir-resource/diagnostic-reports', 'Immunization': '/api/fhir-resource/immunizations',
	'Procedure': '/api/fhir-resource/procedures', 'DocumentReference': '/api/fhir-resource/document-references',
	'Appointment': '/api/fhir-resource/appointments', 'Coverage': '/api/fhir-resource/insurance-coverage',
	'ServiceRequest': '/api/fhir-resource/service-requests', 'CarePlan': '/api/fhir-resource/care-plans',
	'Consent': '/api/fhir-resource/consents', 'FamilyMemberHistory': '/api/fhir-resource/family-member-histories',
};

export class PatientChartEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexPatientChart';

	private root!: HTMLElement;
	private tocNav!: HTMLElement;
	private scrollArea!: HTMLElement;
	private headerBar!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private patientId = '';
	private patientName = '';
	private patientData: Record<string, unknown> = {};
	private categories: ChartCategory[] = [];
	private readonly _configHome: URI;
	private tocItems: Array<{ key: string; el: HTMLElement }> = [];

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(PatientChartEditor.ID, group, telemetryService, themeService, storageService);
		this._configHome = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex');
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-patient-chart'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// ─ Header ─
		this.headerBar = DOM.append(this.root, DOM.$('.chart-header'));
		this.headerBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;align-items:center;gap:10px;';

		// ─ Body: TOC + scrollable main ─
		const body = DOM.append(this.root, DOM.$('.chart-body'));
		body.style.cssText = 'flex:1;display:flex;overflow:hidden;';

		this.tocNav = DOM.append(body, DOM.$('.chart-toc'));
		this.tocNav.style.cssText = 'width:200px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--vscode-editorWidget-border);padding:8px 0;';

		this.scrollArea = DOM.append(body, DOM.$('.chart-scroll'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;';
	}

	override async setInput(input: PatientChartEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.patientId = input.patientId;
		this.patientName = input.patientName;
		this.tocItems = [];

		await Promise.all([this._loadLayout(), this._loadPatient()]);
		if (token.isCancellationRequested) { return; }

		this._renderHeader();
		this._renderToc();
		await this._renderSections();
		this._setupScrollSync();
	}

	// ═══ Data loading ═══

	private async _loadLayout(): Promise<void> {
		try {
			const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'chart-layout.json'));
			const json = JSON.parse(file.value.toString());
			this.categories = (json.categories || [])
				.filter((c: ChartCategory) => !c.hideFromChart)
				.sort((a: ChartCategory, b: ChartCategory) => a.position - b.position);
		} catch {
			this.categories = [
				{ key: 'general', label: 'General', position: 0, tabs: [{ key: 'demographics', label: 'Demographics', icon: '', position: 0, visible: true, fhirResources: ['Patient'] }] },
				{ key: 'clinical', label: 'Clinical', position: 1, tabs: [{ key: 'encounters', label: 'Encounters', icon: '', position: 0, visible: true, fhirResources: ['Encounter'] }] },
			];
		}
	}

	private async _loadPatient(): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/patients/${this.patientId}`);
			if (res.ok) { this.patientData = (await res.json())?.data || {}; }
		} catch { /* */ }
	}

	private async _loadTabData(tab: ChartTab): Promise<{ config: FieldConfig | null; data: Record<string, unknown>[] }> {
		let config: FieldConfig | null = null;
		let data: Record<string, unknown>[] = [];
		try {
			const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'fields', `${tab.key}.json`));
			config = JSON.parse(file.value.toString());
		} catch { /* */ }
		for (const resource of tab.fhirResources) {
			try {
				const ep = FHIR_MAP[resource] || `/api/fhir-resource/${resource.toLowerCase()}s`;
				const res = await this.apiService.fetch(`${ep}/patient/${this.patientId}?page=0&size=100`);
				if (res.ok) {
					const json = await res.json();
					const items = json?.data?.content || json?.content || (json?.data && !Array.isArray(json.data) ? [json.data] : (Array.isArray(json?.data) ? json.data : []));
					data = data.concat(items);
				}
			} catch { /* */ }
		}
		return { config, data };
	}

	// ═══ Header ═══

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		const pd = (this.patientData || {}) as Record<string, string>;
		const name = this.patientName || `${pd.firstName || ''} ${pd.lastName || ''}`.trim();
		const dob = pd.dateOfBirth || '';
		const gender = pd.gender || '';
		const mrn = pd.mrn || pd.id || this.patientId;
		const rawStatus = pd.status || 'Active';
		const status = rawStatus === 'true' || rawStatus === 'Active' ? 'Active' : rawStatus;

		// Avatar
		const initials = name.split(' ').map(w => w[0] || '').join('').substring(0, 2).toUpperCase();
		const hue = Math.abs(name.split('').reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0)) % 360;
		const av = DOM.append(this.headerBar, DOM.$('div'));
		av.textContent = initials;
		av.style.cssText = `width:30px;height:30px;border-radius:50%;background:hsl(${hue},55%,42%);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;`;

		const nameEl = DOM.append(this.headerBar, DOM.$('span'));
		nameEl.textContent = name;
		nameEl.style.cssText = 'font-size:14px;font-weight:700;';

		const pill = (text: string, color: string) => {
			const el = DOM.append(this.headerBar, DOM.$('span'));
			el.textContent = text;
			el.style.cssText = `font-size:10px;padding:1px 7px;border-radius:10px;background:${color}15;color:${color};font-weight:500;`;
		};
		if (dob) { const age = Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000); pill(`${age}y`, '#3b82f6'); }
		if (gender) { pill(gender, '#8b5cf6'); }
		pill(`MRN ${mrn}`, '#6b7280');
		pill(status, status === 'Active' ? '#22c55e' : '#ef4444');

		DOM.append(this.headerBar, DOM.$('span')).style.flex = '1';

		const btn = (label: string, primary: boolean, fn: () => void) => {
			const b = DOM.append(this.headerBar, DOM.$('button'));
			b.textContent = label;
			b.style.cssText = `padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;border:${primary ? 'none' : '1px solid var(--vscode-editorWidget-border)'};background:${primary ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)'};color:${primary ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)'};`;
			b.addEventListener('click', fn);
		};
		btn('+ Encounter', true, () => this.notificationService.info('New encounter — coming soon'));
	}

	// ═══ TOC Navigation ═══

	private _renderToc(): void {
		DOM.clearNode(this.tocNav);
		this.tocItems = [];

		// Search
		this.searchInput = DOM.append(this.tocNav, DOM.$('input')) as HTMLInputElement;
		this.searchInput.type = 'text';
		this.searchInput.placeholder = 'Search chart...';
		this.searchInput.style.cssText = 'width:calc(100% - 16px);margin:4px 8px 10px;padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;height:28px;';
		this.searchInput.addEventListener('input', () => this._filterSections(this.searchInput.value));

		for (const cat of this.categories) {
			const catEl = DOM.append(this.tocNav, DOM.$('div'));
			catEl.textContent = cat.label;
			catEl.style.cssText = 'padding:12px 14px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';

			for (const tab of cat.tabs.filter(t => t.visible)) {
				const item = DOM.append(this.tocNav, DOM.$('div'));
				item.setAttribute('data-toc', tab.key);
				item.style.cssText = 'padding:4px 14px 4px 20px;cursor:pointer;color:var(--vscode-foreground);border-left:2px solid transparent;display:flex;align-items:center;gap:6px;font-size:13px;';

				if (tab.emoji) {
					const icon = DOM.append(item, DOM.$('span'));
					icon.textContent = tab.emoji;
					icon.style.cssText = 'font-size:13px;width:18px;text-align:center;flex-shrink:0;';
				}

				const label = DOM.append(item, DOM.$('span'));
				label.textContent = tab.label;
				label.style.cssText = 'flex:1;opacity:0.9;';

				const badge = DOM.append(item, DOM.$('span'));
				badge.setAttribute('data-toc-badge', tab.key);
				badge.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

				item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
				item.addEventListener('mouseleave', () => { if (!item.classList.contains('active')) { item.style.background = ''; } });
				item.addEventListener('click', () => {
					const el = this.scrollArea.querySelector(`[data-section="${tab.key}"]`);
					if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
				});

				this.tocItems.push({ key: tab.key, el: item });
			}
		}
	}

	// ═══ Sections (single scrollable page) ═══

	private async _renderSections(): Promise<void> {
		DOM.clearNode(this.scrollArea);

		const mainContainer = DOM.append(this.scrollArea, DOM.$('div'));
		mainContainer.style.cssText = 'max-width:1000px;margin:0 auto;padding:0 24px 60px;';

		for (const cat of this.categories) {
			const mainTabs = cat.tabs.filter(t => t.visible && (t.panel || 'main') === 'main');
			if (mainTabs.length === 0) { continue; }

			// Category divider
			const catLabel = DOM.append(mainContainer, DOM.$('div'));
			catLabel.textContent = cat.label;
			catLabel.style.cssText = `font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--vscode-descriptionForeground);padding:${cat === this.categories[0] ? '8' : '28'}px 0 8px;`;

			for (const tab of mainTabs) {
				// const c = ''; // Single VS Code blue — color comes from border only
				const emoji = tab.emoji || '';

				// Card — colored left border + subtle shadow
				const section = DOM.append(mainContainer, DOM.$('div'));
				section.setAttribute('data-section', tab.key);
				section.style.cssText = 'margin-bottom:16px;border:1px solid var(--vscode-editorWidget-border);border-left:3px solid var(--vscode-focusBorder,#007acc);border-radius:6px;overflow:hidden;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));box-shadow:0 1px 3px rgba(0,0,0,0.15);transition:box-shadow 0.2s,border-color 0.2s;';
				section.addEventListener('mouseenter', () => { section.style.boxShadow = '0 3px 10px rgba(0,0,0,0.25)'; section.style.borderColor = 'var(--vscode-focusBorder,#007acc)'; });
				section.addEventListener('mouseleave', () => { section.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)'; section.style.borderColor = 'var(--vscode-editorWidget-border)'; });

				// Header — blue accent background
				const header = DOM.append(section, DOM.$('div'));
				header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(0,122,204,0.12);border-bottom:1px solid rgba(0,122,204,0.2);';

				if (emoji) {
					const iconEl = DOM.append(header, DOM.$('span'));
					iconEl.textContent = emoji;
					iconEl.style.cssText = 'font-size:15px;';
				}

				const title = DOM.append(header, DOM.$('span'));
				title.textContent = tab.label;
				title.style.cssText = 'font-size:14px;font-weight:600;color:var(--vscode-foreground);';

				const countEl = DOM.append(header, DOM.$('span'));
				countEl.setAttribute('data-count', tab.key);
				countEl.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-weight:600;';

				DOM.append(header, DOM.$('span')).style.flex = '1';

				const actionSlot = DOM.append(header, DOM.$('span'));
				actionSlot.setAttribute('data-action', tab.key);

				const content = DOM.append(section, DOM.$('div'));
				content.setAttribute('data-content', tab.key);
				content.style.cssText = 'padding:12px 14px;color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';
				content.textContent = 'Loading...';

				const observer = new IntersectionObserver((entries) => {
					if (entries[0].isIntersecting) { observer.disconnect(); this._loadSection(tab, content, actionSlot); }
				}, { root: this.scrollArea, rootMargin: '300px' });
				observer.observe(section);
			}
		}
	}

	private async _loadSection(tab: ChartTab, content: HTMLElement, actionSlot: HTMLElement): Promise<void> {
		const { config, data } = await this._loadTabData(tab);
		DOM.clearNode(content);
		content.style.fontStyle = 'normal';

		// Update count badge
		const countEl = this.scrollArea.querySelector(`[data-count="${tab.key}"]`);
		if (countEl) { countEl.textContent = data.length > 0 ? `(${data.length})` : ''; }
		const tocBadge = this.tocNav.querySelector(`[data-toc-badge="${tab.key}"]`);
		if (tocBadge) { tocBadge.textContent = data.length > 0 ? String(data.length) : ''; }

		// Action button
		DOM.clearNode(actionSlot);
		if (tab.display === 'form') {
			// Auto-save indicator (shows briefly on save)
			const saved = DOM.append(actionSlot, DOM.$('span'));
			saved.setAttribute('data-saved', tab.key);
			saved.style.cssText = 'font-size:11px;color:#22c55e;opacity:0;transition:opacity 0.3s;margin-right:6px;';
			saved.textContent = '\u2713 Saved';
		}
		this._makeBtn(actionSlot, '+ Add', () => this.notificationService.info(`New ${tab.label} — coming soon`));

		// Render content based on display mode from chart-layout.json
		const isForm = tab.display === 'form';
		if (config?.sections && isForm) {
			this._renderForm(content, config.sections, data.length > 0 ? data : [{}], tab.key);
		} else if (data.length > 0) {
			this._listAuto(content, tab, data);
		} else {
			// Empty state — show table headers from field config if available
			const cols = config?.sections
				? config.sections.filter(s => s.visible).flatMap(s => s.fields).filter(f => f.colSpan !== 0).slice(0, 6).map(f => f.label)
				: [];
			if (cols.length > 0) {
				this._table(content, cols, []);
			}
			const empty = DOM.append(content, DOM.$('div'));
			empty.textContent = `No ${tab.label.toLowerCase()} records`;
			empty.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;padding:16px;text-align:center;';
		}
	}

	// ═══ Form fields — grid layout per section ═══
	//
	// Section "Patient Name" (columns: 4)
	//   ┌──────────┬──────────┬──────────┬──────────┐
	//   │ First    │ Middle   │ Last     │ Suffix   │
	//   │ [Leo   ] │ [Anthony]│ [Rogers] │ [▼     ] │
	//   └──────────┴──────────┴──────────┴──────────┘

	private _renderForm(container: HTMLElement, sections: FieldSection[], data: Record<string, unknown>[], tabKey: string): void {
		const record = (data[0] as Record<string, unknown>)?.data || data[0] || {};

		for (const sec of sections) {
			if (!sec.visible) { continue; }
			const cols = Math.min(sec.columns || 3, 4);

			// Sub-header (just a label, not a nested card)
			const subHeader = DOM.append(container, DOM.$('div'));
			subHeader.textContent = sec.title;
			subHeader.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;margin:14px 0 6px;padding-top:8px;border-top:1px solid var(--vscode-editorWidget-border);';
			// Hide border on first section
			if (sections.indexOf(sec) === 0) { subHeader.style.borderTop = 'none'; subHeader.style.marginTop = '0'; }

			// Grid of fields
			const gridBody = DOM.append(container, DOM.$('div'));
			gridBody.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:4px 16px;margin-bottom:4px;`;

			for (const f of sec.fields) {
				const val = (record as Record<string, unknown>)[f.key] ?? '';

				const cell = DOM.append(gridBody, DOM.$('div'));
				cell.style.cssText = `grid-column:span ${Math.min(f.colSpan || 1, cols)};padding:4px 0;`;

				// Label
				const lbl = DOM.append(cell, DOM.$('label'));
				lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;';
				const lblText = DOM.append(lbl, DOM.$('span'));
				lblText.textContent = f.label;
				if (f.required) {
					const req = DOM.append(lbl, DOM.$('span'));
					req.textContent = ' *';
					req.style.cssText = 'color:#ef4444;';
				}

				// Control
				const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:13px;height:32px;box-sizing:border-box;transition:border-color 0.15s;outline:none;';
				const focusStyle = 'border-color:var(--vscode-focusBorder,#007acc);box-shadow:0 0 0 1px var(--vscode-focusBorder,#007acc);';

				const addFocus = (el: HTMLElement) => {
					el.addEventListener('focus', () => { el.style.cssText = inputStyle + (el.tagName === 'SELECT' ? 'cursor:pointer;' : '') + focusStyle; });
					el.addEventListener('blur', () => { el.style.cssText = inputStyle + (el.tagName === 'SELECT' ? 'cursor:pointer;' : ''); });
					el.addEventListener('change', () => this._autoSave(tabKey));
					el.addEventListener('input', () => this._autoSave(tabKey));
				};

				if (f.type === 'select') {
					const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
					sel.style.cssText = inputStyle + 'cursor:pointer;';
					for (const o of [{ label: `Select ${f.label}...`, value: '' }, ...(f.options || [])]) {
						const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
						opt.value = o.value; opt.textContent = o.label; opt.selected = String(val) === o.value;
					}
					addFocus(sel);
				} else if (f.type === 'boolean' || f.type === 'toggle') {
					const wrap = DOM.append(cell, DOM.$('div'));
					wrap.style.cssText = 'display:flex;align-items:center;gap:8px;height:32px;';
					const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
					cb.type = 'checkbox'; cb.checked = !!val;
					cb.style.cssText = 'width:18px;height:18px;border-radius:4px;cursor:pointer;accent-color:var(--vscode-focusBorder,#007acc);';
					const cbLabel = DOM.append(wrap, DOM.$('span'));
					cbLabel.textContent = val ? 'Yes' : 'No';
					cbLabel.style.cssText = 'font-size:13px;color:var(--vscode-foreground);';
					cb.addEventListener('change', () => { cbLabel.textContent = cb.checked ? 'Yes' : 'No'; });
				} else if (f.type === 'textarea') {
					const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
					ta.value = String(val); ta.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					ta.style.cssText = inputStyle + 'min-height:70px;height:auto;resize:vertical;';
					addFocus(ta);
				} else if (f.type === 'date') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'date'; inp.value = String(val).split('T')[0]; inp.style.cssText = inputStyle;
					addFocus(inp);
				} else if (f.type === 'number') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'number'; inp.value = String(val); inp.placeholder = f.placeholder || '0';
					inp.style.cssText = inputStyle;
					addFocus(inp);
				} else {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
					inp.value = String(val); inp.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					inp.style.cssText = inputStyle;
					addFocus(inp);
				}
			}
		}
	}


	// ═══ List renderers ═══

	// ═══ Generic auto-list for any FHIR data ═══

	private _listAuto(c: HTMLElement, tab: ChartTab, data: Record<string, unknown>[]): void {
		// Smart column detection from data
		const sample = data[0] || {};
		const allKeys = Object.keys(sample);

		// Priority keys: common FHIR/clinical fields first
		const priorityKeys = ['start', 'date', 'period', 'effectiveDateTime', 'recordedDate', 'authoredOn',
			'appointmentType', 'type', 'visitType', 'class', 'serviceType', 'code', 'medicationCodeableConcept',
			'providerName', 'providerDisplay', 'practitionerName', 'patientName', 'patientDisplay',
			'status', 'clinicalStatus', 'verificationStatus', 'category', 'severity', 'criticality',
			'reason', 'note', 'description', 'text'];

		// Pick columns: prioritized keys that exist, then fill from remaining
		const usedKeys: string[] = [];
		for (const pk of priorityKeys) {
			if (allKeys.includes(pk) && usedKeys.length < 6) { usedKeys.push(pk); }
		}
		for (const k of allKeys) {
			if (usedKeys.length >= 6) { break; }
			if (!usedKeys.includes(k) && !k.startsWith('_') && k !== 'id' && k !== 'fhirId' && k !== 'patient' && k !== 'provider' && k !== 'location') {
				usedKeys.push(k);
			}
		}

		const cols = usedKeys.map(k => k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()));

		const rows = data.slice(0, 50).map(item => {
			const cells = usedKeys.map(k => {
				const v = item[k];
				if (v == null) { return ''; }
				if (typeof v === 'object') {
					// Handle FHIR CodeableConcept, Reference, etc.
					const obj = v as Record<string, unknown>;
					return String(obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.display || '');
				}
				// Format dates
				if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
					try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { /* */ }
				}
				return String(v).substring(0, 40);
			});

			// Click handler: encounters open in side group
			const isEncounter = tab.fhirResources.includes('Encounter');
			const onClick = isEncounter ? () => {
				const id = String(item.id || item.fhirId || '');
				this.editorService.openEditor(new EncounterFormEditorInput(this.patientId, id, this.patientName, `Encounter ${id}`), {}, SIDE_GROUP);
			} : undefined;

			return { cells, onClick };
		});

		this._table(c, cols, rows);
	}

	// ═══ Table renderer (VS Code style) ═══

	private _table(container: HTMLElement, columns: string[], rows: Array<{ cells: string[]; onClick?: () => void }>): void {
		const table = DOM.append(container, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';

		// Header
		const thead = DOM.append(table, DOM.$('thead'));
		const hrow = DOM.append(thead, DOM.$('tr'));
		for (const col of columns) {
			const th = DOM.append(hrow, DOM.$('th'));
			th.textContent = col;
			th.style.cssText = 'text-align:left;padding:8px 12px;font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);white-space:nowrap;';
		}

		// Body
		const tbody = DOM.append(table, DOM.$('tbody'));
		for (const row of rows) {
			const tr = DOM.append(tbody, DOM.$('tr'));
			tr.style.cssText = `cursor:${row.onClick ? 'pointer' : 'default'};`;
			tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--vscode-list-hoverBackground)'; });
			tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
			if (row.onClick) { tr.addEventListener('click', row.onClick); }

			for (let i = 0; i < row.cells.length; i++) {
				const td = DOM.append(tr, DOM.$('td'));
				td.style.cssText = 'padding:8px 12px;border-bottom:1px solid rgba(128,128,128,0.08);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;';

				// Last column = status badge
				if (i === row.cells.length - 1 && columns[i] === 'Status') {
					const badge = DOM.append(td, DOM.$('span'));
					badge.textContent = row.cells[i];
					badge.style.cssText = 'font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(59,130,246,0.12);color:#3b82f6;text-transform:capitalize;';
				} else if (i === 0) {
					td.style.fontWeight = '600';
					td.textContent = row.cells[i];
				} else {
					td.textContent = row.cells[i];
				}
			}
		}
	}

	private _makeBtn(parent: HTMLElement, label: string, fn: () => void, primary?: boolean): void {
		const b = DOM.append(parent, DOM.$('button'));
		b.textContent = label;
		b.style.cssText = `padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;border:${primary ? 'none' : '1px solid var(--vscode-editorWidget-border)'};background:${primary ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)'};color:${primary ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)'};`;
		b.addEventListener('click', fn);
	}

	// ═══ Auto-save ═══

	private _saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	private _autoSave(tabKey: string): void {
		// Debounce: save 1.5s after last change
		const existing = this._saveTimers.get(tabKey);
		if (existing) { clearTimeout(existing); }
		this._saveTimers.set(tabKey, setTimeout(() => {
			// Show saved indicator
			const indicator = this.scrollArea.querySelector(`[data-saved="${tabKey}"]`) as HTMLElement;
			if (indicator) {
				indicator.style.opacity = '1';
				setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
			}
			// TODO: collect form data and PUT to API
		}, 1500));
	}

	// ═══ Search filter ═══

	private _filterSections(query: string): void {
		const q = query.toLowerCase().trim();
		const sections = this.scrollArea.querySelectorAll('[data-section]');
		sections.forEach(sec => {
			const key = sec.getAttribute('data-section') || '';
			const text = sec.textContent?.toLowerCase() || '';
			const visible = !q || text.includes(q) || key.includes(q);
			(sec as HTMLElement).style.display = visible ? '' : 'none';
		});
		// Update TOC visibility
		this.tocItems.forEach(({ key, el }) => {
			const section = this.scrollArea.querySelector(`[data-section="${key}"]`) as HTMLElement;
			el.style.display = section?.style.display === 'none' ? 'none' : '';
		});
	}

	// ═══ Scroll ↔ TOC sync ═══

	private _setupScrollSync(): void {
		this.scrollArea.addEventListener('scroll', () => {
			let activeKey = '';
			const sections = this.scrollArea.querySelectorAll('[data-section]');
			const scrollTop = this.scrollArea.scrollTop + 60;
			sections.forEach(sec => {
				if ((sec as HTMLElement).offsetTop <= scrollTop) {
					activeKey = sec.getAttribute('data-section') || '';
				}
			});
			this.tocItems.forEach(({ key, el }) => {
				const isActive = key === activeKey;
				el.style.borderLeftColor = isActive ? 'var(--vscode-focusBorder, #007acc)' : 'transparent';
				el.style.background = isActive ? 'var(--vscode-list-activeSelectionBackground, rgba(0,120,212,0.1))' : '';
				el.style.fontWeight = isActive ? '600' : '';
				if (isActive) { el.classList.add('active'); } else { el.classList.remove('active'); }
			});
		});
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
