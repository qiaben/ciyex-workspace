/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { ReportsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#14b8a6'];
const INPUT_STYLE = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

// allow-any-unicode-next-line
// ─── Report definitions ───
interface ReportDef {
	apiPath: string;
	columns: Array<{ key: string; label: string }>;
	chartType: 'bar' | 'pie';
	chartGroupKey: string;
	chartLabel: string;
}

function getReportDef(key: string): ReportDef {
	switch (key) {
		case 'patient-demographics': return { apiPath: '/api/fhir-resource/patients?page=0&size=500', columns: [{ key: 'name', label: 'Name' }, { key: 'gender', label: 'Gender' }, { key: 'birthDate', label: 'DOB' }, { key: 'active', label: 'Status' }, { key: 'phone', label: 'Phone' }], chartType: 'pie', chartGroupKey: 'gender', chartLabel: 'Gender Distribution' };
		case 'encounter-summary': return { apiPath: '/api/fhir-resource/encounters?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'providerDisplay', label: 'Provider' }, { key: 'startDate', label: 'Date' }], chartType: 'bar', chartGroupKey: 'type', chartLabel: 'Encounters by Type' };
		case 'lab-orders---results': return { apiPath: '/api/lab-order/search?q=', columns: [{ key: 'patientName', label: 'Patient' }, { key: 'orderName', label: 'Order' }, { key: 'testDisplay', label: 'Test' }, { key: 'status', label: 'Status' }, { key: 'priority', label: 'Priority' }, { key: 'orderDate', label: 'Order Date' }, { key: 'orderingProvider', label: 'Provider' }], chartType: 'bar', chartGroupKey: 'status', chartLabel: 'Orders by Status' };
		case 'medication---prescriptions': return { apiPath: '/api/prescriptions?page=0&size=500', columns: [{ key: 'patientName', label: 'Patient' }, { key: 'medicationName', label: 'Medication' }, { key: 'sig', label: 'SIG' }, { key: 'prescriberName', label: 'Prescriber' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' }], chartType: 'bar', chartGroupKey: 'status', chartLabel: 'Prescriptions by Status' };
		case 'referral-tracking': return { apiPath: '/api/referrals?page=0&size=500', columns: [{ key: 'patientName', label: 'Patient' }, { key: 'specialistName', label: 'Specialist' }, { key: 'specialty', label: 'Specialty' }, { key: 'urgency', label: 'Urgency' }, { key: 'status', label: 'Status' }, { key: 'referralDate', label: 'Date' }], chartType: 'bar', chartGroupKey: 'status', chartLabel: 'Referrals by Status' };
		case 'immunizations': return { apiPath: '/api/immunizations?page=0&size=500', columns: [{ key: 'patientName', label: 'Patient' }, { key: 'vaccineName', label: 'Vaccine' }, { key: 'cvxCode', label: 'CVX' }, { key: 'route', label: 'Route' }, { key: 'status', label: 'Status' }, { key: 'administrationDate', label: 'Date' }], chartType: 'bar', chartGroupKey: 'vaccineName', chartLabel: 'By Vaccine' };
		case 'appointment-volume': return { apiPath: '/api/fhir-resource/appointments?page=0&size=500', columns: [{ key: 'patientDisplay', label: 'Patient' }, { key: 'appointmentType', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'start', label: 'Start' }, { key: 'providerName', label: 'Provider' }], chartType: 'bar', chartGroupKey: 'status', chartLabel: 'Appointments by Status' };
		case 'provider-productivity': return { apiPath: '/api/fhir-resource/encounters?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'type', label: 'Type' }, { key: 'providerDisplay', label: 'Provider' }, { key: 'status', label: 'Status' }, { key: 'startDate', label: 'Date' }], chartType: 'bar', chartGroupKey: 'providerDisplay', chartLabel: 'Encounters by Provider' };
		case 'no-show-analysis': return { apiPath: '/api/fhir-resource/appointments?page=0&size=500&status=noshow', columns: [{ key: 'patientDisplay', label: 'Patient' }, { key: 'appointmentType', label: 'Type' }, { key: 'start', label: 'Date' }, { key: 'providerName', label: 'Provider' }], chartType: 'bar', chartGroupKey: 'appointmentType', chartLabel: 'No-Shows by Type' };
		case 'care-gaps': return { apiPath: '/api/fhir-resource/care-plans?page=0&size=500', columns: [{ key: 'patientName', label: 'Patient' }, { key: 'title', label: 'Plan' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Status' }], chartType: 'pie', chartGroupKey: 'status', chartLabel: 'Care Plans by Status' };
		case 'problem-list': return { apiPath: '/api/fhir-resource/conditions?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'code', label: 'Diagnosis' }, { key: 'clinicalStatus', label: 'Status' }, { key: 'recordedDate', label: 'Recorded' }], chartType: 'bar', chartGroupKey: 'clinicalStatus', chartLabel: 'Problems by Status' };
		case 'revenue-overview': return { apiPath: '/api/fhir-resource/claims?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'payerDisplay', label: 'Payer' }, { key: 'totalAmount', label: 'Amount' }, { key: 'status', label: 'Status' }, { key: 'serviceDate', label: 'Date' }], chartType: 'bar', chartGroupKey: 'status', chartLabel: 'Claims by Status' };
		case 'payer-mix': return { apiPath: '/api/fhir-resource/claims?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'payerDisplay', label: 'Payer' }, { key: 'totalAmount', label: 'Amount' }, { key: 'status', label: 'Status' }], chartType: 'pie', chartGroupKey: 'payerDisplay', chartLabel: 'Claims by Payer' };
		case 'ar-aging': return { apiPath: '/api/fhir-resource/claims?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'payerDisplay', label: 'Payer' }, { key: 'totalAmount', label: 'Amount' }, { key: 'status', label: 'Status' }, { key: 'serviceDate', label: 'Service Date' }], chartType: 'bar', chartGroupKey: 'status', chartLabel: 'AR by Status' };
		case 'audit-log': return { apiPath: '/api/audit-log?page=0&size=200', columns: [{ key: 'userName', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'resourceType', label: 'Resource' }, { key: 'resourceName', label: 'Resource Name' }, { key: 'patientName', label: 'Patient' }, { key: 'createdAt', label: 'Timestamp' }], chartType: 'bar', chartGroupKey: 'action', chartLabel: 'Actions by Type' };
		case 'portal-usage': return { apiPath: '/api/notifications/log?page=0&size=200', columns: [{ key: 'channelType', label: 'Channel' }, { key: 'recipientName', label: 'Recipient' }, { key: 'patientName', label: 'Patient' }, { key: 'subject', label: 'Subject' }, { key: 'status', label: 'Status' }, { key: 'sentAt', label: 'Sent' }], chartType: 'bar', chartGroupKey: 'channelType', chartLabel: 'Notifications by Channel' };
		case 'denial-management': return { apiPath: '/api/fhir-resource/claims?page=0&size=500&status=denied', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'payerDisplay', label: 'Payer' }, { key: 'denialReason', label: 'Denial Reason' }, { key: 'totalAmount', label: 'Amount' }, { key: 'status', label: 'Status' }, { key: 'serviceDate', label: 'Service Date' }], chartType: 'bar', chartGroupKey: 'denialReason', chartLabel: 'Denials by Reason' };
		case 'cpt-utilization': return { apiPath: '/api/fhir-resource/claims?page=0&size=500', columns: [{ key: 'procedureCode', label: 'CPT Code' }, { key: 'procedureDisplay', label: 'Procedure' }, { key: 'patientRefDisplay', label: 'Patient' }, { key: 'providerDisplay', label: 'Provider' }, { key: 'totalAmount', label: 'Charge' }, { key: 'serviceDate', label: 'Date' }], chartType: 'bar', chartGroupKey: 'procedureCode', chartLabel: 'Top CPT Codes' };
		case 'scheduling-utilization': return { apiPath: '/api/fhir-resource/appointments?page=0&size=500', columns: [{ key: 'patientDisplay', label: 'Patient' }, { key: 'appointmentType', label: 'Type' }, { key: 'providerName', label: 'Provider' }, { key: 'status', label: 'Status' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }], chartType: 'bar', chartGroupKey: 'providerName', chartLabel: 'Slots by Provider' };
		case 'quality-measures': return { apiPath: '/api/fhir-resource/care-plans?page=0&size=500', columns: [{ key: 'patientName', label: 'Patient' }, { key: 'title', label: 'Measure' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Status' }, { key: 'period', label: 'Period' }], chartType: 'pie', chartGroupKey: 'status', chartLabel: 'Measures by Status' };
		case 'risk-stratification': return { apiPath: '/api/fhir-resource/patients?page=0&size=500', columns: [{ key: 'name', label: 'Patient' }, { key: 'gender', label: 'Gender' }, { key: 'birthDate', label: 'DOB' }, { key: 'riskScore', label: 'Risk Score' }, { key: 'riskLevel', label: 'Risk Level' }, { key: 'active', label: 'Status' }], chartType: 'pie', chartGroupKey: 'riskLevel', chartLabel: 'Risk Distribution' };
		case 'disease-registry': return { apiPath: '/api/fhir-resource/conditions?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'code', label: 'Condition' }, { key: 'clinicalStatus', label: 'Status' }, { key: 'verificationStatus', label: 'Verification' }, { key: 'onsetDate', label: 'Onset' }, { key: 'recordedDate', label: 'Recorded' }], chartType: 'bar', chartGroupKey: 'code', chartLabel: 'Top Conditions' };
		case 'document-completion': return { apiPath: '/api/fhir-resource/encounters?page=0&size=500', columns: [{ key: 'patientRefDisplay', label: 'Patient' }, { key: 'providerDisplay', label: 'Provider' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'startDate', label: 'Date' }, { key: 'noteStatus', label: 'Note Status' }], chartType: 'pie', chartGroupKey: 'status', chartLabel: 'Completion Status' };
		case 'ai-usage': return { apiPath: '/api/app-proxy/ask-ciya/api/audit?page=0&size=200', columns: [{ key: 'model', label: 'Model' }, { key: 'inputTokens', label: 'Input Tokens' }, { key: 'outputTokens', label: 'Output Tokens' }, { key: 'cost', label: 'Cost ($)' }, { key: 'latencyMs', label: 'Latency (ms)' }, { key: 'createdAt', label: 'Date' }], chartType: 'bar', chartGroupKey: 'model', chartLabel: 'Usage by Model' };
		default: return { apiPath: '/api/fhir-resource/patients?page=0&size=50', columns: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }], chartType: 'bar', chartGroupKey: 'status', chartLabel: 'Data Distribution' };
	}
}

// allow-any-unicode-next-line
// ─── Reports Editor ───

export class ReportsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexReport';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private kpiEl!: HTMLElement;
	private chartEl!: HTMLElement;
	private tableEl!: HTMLElement;
	private items: Record<string, string>[] = [];
	private reportDef!: ReportDef;
	private dateFrom = '';
	private dateTo = '';
	private statusFilter = '';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(ReportsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.reports-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1100px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof ReportsEditorInput)) { return; }
		this.reportDef = getReportDef(input.reportKey);
		await this._loadAndRender(input);
	}

	private async _loadAndRender(input: ReportsEditorInput): Promise<void> {
		DOM.clearNode(this.contentEl);

		// allow-any-unicode-next-line
		// ─── Header ───
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;';
		const catBadge = DOM.append(header, DOM.$('span'));
		catBadge.textContent = input.category;
		catBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(0,122,204,0.1);color:var(--vscode-textLink-foreground);text-transform:uppercase;';
		const title = DOM.append(header, DOM.$('h2'));
		title.textContent = input.reportLabel;
		title.style.cssText = 'font-size:20px;font-weight:600;margin:0;flex:1;';

		// Export buttons
		const exportBtn = DOM.append(header, DOM.$('button'));
		// allow-any-unicode-next-line
		exportBtn.textContent = '📥 Export CSV';
		exportBtn.style.cssText = 'padding:5px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:11px;';
		exportBtn.addEventListener('click', () => this._exportCsv(input.reportLabel));
		const printBtn = DOM.append(header, DOM.$('button'));
		// allow-any-unicode-next-line
		printBtn.textContent = '🖨️ Print';
		printBtn.style.cssText = 'padding:5px 12px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:11px;';
		printBtn.addEventListener('click', () => this._printReport(input.reportLabel));

		// allow-any-unicode-next-line
		// ─── Filters ───
		const filters = DOM.append(this.contentEl, DOM.$('div'));
		filters.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;background:rgba(0,122,204,0.03);';

		const buildIconDateInput = (parent: HTMLElement, isoValue: string, onChange: (iso: string) => void): void => {
			const wrap = DOM.append(parent, DOM.$('div'));
			wrap.style.cssText = 'position:relative;display:inline-block;';
			const isoToUs = (iso: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };
			const usToIso = (us: string): string => { const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us); if (!m) { return ''; } return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
			const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			visible.type = 'text';
			visible.placeholder = 'MM/DD/YYYY';
			visible.maxLength = 10;
			visible.value = isoToUs(isoValue);
			visible.style.cssText = INPUT_STYLE + 'padding-right:30px;width:130px;';
			visible.addEventListener('input', () => {
				const iso = usToIso(visible.value);
				visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
				onChange(iso);
			});
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.value = isoValue || '';
			picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			picker.addEventListener('change', () => {
				visible.value = isoToUs(picker.value);
				onChange(picker.value);
			});
			const icon = DOM.append(wrap, DOM.$('span'));
			icon.textContent = '\u{1F4C5}';
			icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--vscode-descriptionForeground);pointer-events:none;line-height:1;';
		};

		const fromLabel = DOM.append(filters, DOM.$('label'));
		fromLabel.textContent = 'From';
		fromLabel.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		buildIconDateInput(filters, this.dateFrom, (iso) => { this.dateFrom = iso; this._applyFiltersAndRender(); });

		const toLabel = DOM.append(filters, DOM.$('label'));
		toLabel.textContent = 'To';
		toLabel.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		buildIconDateInput(filters, this.dateTo, (iso) => { this.dateTo = iso; this._applyFiltersAndRender(); });

		const statusSelect = DOM.append(filters, DOM.$('select')) as HTMLSelectElement;
		statusSelect.style.cssText = INPUT_STYLE + 'cursor:pointer;';
		DOM.append(statusSelect, DOM.$('option')).textContent = 'All Status';
		(statusSelect.lastChild as HTMLOptionElement).value = '';
		statusSelect.addEventListener('change', () => { this.statusFilter = statusSelect.value; this._applyFiltersAndRender(); });

		DOM.append(filters, DOM.$('span')).style.flex = '1';
		// Clear filters button
		const clearBtn = DOM.append(filters, DOM.$('button'));
		clearBtn.textContent = 'Clear Filters';
		clearBtn.style.cssText = 'padding:6px 12px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;cursor:pointer;font-size:12px;color:var(--vscode-foreground);';
		clearBtn.addEventListener('click', () => {
			this.dateFrom = '';
			this.dateTo = '';
			this.statusFilter = '';
			this._loadAndRender(input);
		});
		const runBtn = DOM.append(filters, DOM.$('button'));
		// allow-any-unicode-next-line
		runBtn.textContent = '▶ Refresh';
		runBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
		runBtn.addEventListener('click', async () => { await this._loadData(); this._applyFiltersAndRender(); });

		// allow-any-unicode-next-line
		// ─── KPI cards ───
		this.kpiEl = DOM.append(this.contentEl, DOM.$('div'));
		this.kpiEl.style.cssText = 'margin-bottom:16px;';

		// allow-any-unicode-next-line
		// ─── Chart ───
		this.chartEl = DOM.append(this.contentEl, DOM.$('div'));
		this.chartEl.style.cssText = 'margin-bottom:16px;padding:14px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';

		// allow-any-unicode-next-line
		// ─── Data table ───
		this.tableEl = DOM.append(this.contentEl, DOM.$('div'));

		// Load data
		await this._loadData();

		// Populate status filter from data
		const statuses = new Set(this.items.map(i => i.status || i.clinicalStatus || '').filter(Boolean));
		for (const s of statuses) {
			const opt = DOM.append(statusSelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = s;
			opt.textContent = s;
		}

		this._applyFiltersAndRender();
	}

	private async _loadData(): Promise<void> {
		try {
			const res = await this.apiService.fetch(this.reportDef.apiPath);
			if (!res.ok) { this.items = []; return; }
			const json = await res.json();
			const raw = json?.data?.content || json?.data || json?.content || json || [];
			const arr = Array.isArray(raw) ? raw : [];
			// Normalize backend field-name variants so report columns always have data to display.
			this.items = arr.map((r: Record<string, unknown>) => this._normalizeRow(r)) as Record<string, string>[];
		} catch { this.items = []; }
	}

	private _normalizeRow(r: Record<string, unknown>): Record<string, string> {
		const isPlainObject = (v: unknown): v is Record<string, unknown> =>
			v !== null && typeof v === 'object' && !Array.isArray(v);

		const s = (v: unknown): string => {
			if (v === null || v === undefined) { return ''; }
			if (Array.isArray(v)) {
				// Java LocalDate/LocalDateTime arrays [y,m,d,...] → ISO date string
				if (v.length >= 3 && typeof v[0] === 'number' && typeof v[1] === 'number') {
					const [y, m, d] = v as number[];
					return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
				}
				return v.map(x => s(x)).filter(Boolean).join(', ');
			}
			if (typeof v === 'object') {
				const o = v as Record<string, unknown>;
				return String(o.text || o.display || (o.coding as Array<Record<string, string>>)?.[0]?.display || JSON.stringify(o).substring(0, 60));
			}
			return String(v);
		};

		const out: Record<string, string> = {};
		// Flatten the row: write primitive leaves as both dot-notation paths and (when not taken) bare leaf names.
		// Patient records from /api/fhir-resource/patients are nested under identification.*, audit.*, contact.*, etc.
		const walk = (val: unknown, prefix: string): void => {
			if (!isPlainObject(val)) { return; }
			for (const [k, v] of Object.entries(val)) {
				const dotKey = prefix ? `${prefix}.${k}` : k;
				if (isPlainObject(v)) {
					// Store FHIR-style {text,display,coding} as a single string and recurse for additional fields
					out[dotKey] = s(v);
					walk(v, dotKey);
					if (!out[k]) { out[k] = s(v); }
				} else {
					const str = s(v);
					out[dotKey] = str;
					// Bare leaf alias (e.g. identification.firstName → firstName) when no top-level value exists
					if (!out[k] || out[k] === '[object Object]') { out[k] = str; }
				}
			}
		};
		walk(r, '');

		// Derived aliases so report columns match whatever the backend returns
		const pickFirst = (...vals: string[]): string => { for (const v of vals) { if (v) { return v; } } return ''; };

		const firstName = pickFirst(out['firstName'], out['given']);
		const lastName = pickFirst(out['lastName'], out['family']);
		if (!out['name']) { out['name'] = `${firstName} ${lastName}`.trim() || pickFirst(out['displayName'], out['fullName']); }
		if (!out['phone']) { out['phone'] = pickFirst(out['phoneNumber'], out['phoneHome'], out['phoneMobile'], out['mobile'], out['contact.phone'], out['contact.phoneNumber']); }
		if (!out['birthDate']) { out['birthDate'] = pickFirst(out['dateOfBirth'], out['dob']); }
		if (!out['gender']) { out['gender'] = pickFirst(out['sex']); }
		if (out['active'] === 'true' || out['active'] === true as unknown as string) { out['active'] = 'Active'; }
		else if (out['active'] === 'false' || out['active'] === false as unknown as string) { out['active'] = 'Inactive'; }
		if (!out['active']) { out['active'] = pickFirst(out['status']); }

		// Patient name: combine first/last variants from multiple endpoints
		if (!out['patientName']) {
			const pFirst = pickFirst(out['patientFirstName'], out['patient.firstName']);
			const pLast = pickFirst(out['patientLastName'], out['patient.lastName']);
			out['patientName'] = `${pFirst} ${pLast}`.trim() || pickFirst(out['patientDisplay'], out['patientRefDisplay'], out['subjectDisplay'], out['patient.name'], out['patient']);
		}
		// Cross-fill patient display variants (FHIR resources use these interchangeably)
		if (!out['patientDisplay']) { out['patientDisplay'] = pickFirst(out['patientName'], out['patientRefDisplay'], out['subjectDisplay']); }
		if (!out['patientRefDisplay']) { out['patientRefDisplay'] = pickFirst(out['patientDisplay'], out['patientName'], out['subjectDisplay']); }
		if (!out['subjectDisplay']) { out['subjectDisplay'] = pickFirst(out['patientDisplay'], out['patientName'], out['patientRefDisplay']); }

		// Provider name: cover prescription/lab-order/encounter/appointment variants
		if (!out['providerName']) { out['providerName'] = pickFirst(out['providerDisplay'], out['practitionerName'], out['orderingProvider'], out['physicianName'], out['prescriberName'], out['referringProvider'], out['provider']); }
		if (!out['providerDisplay']) { out['providerDisplay'] = pickFirst(out['providerName'], out['practitionerName'], out['prescriberName']); }
		if (!out['prescriberName']) { out['prescriberName'] = pickFirst(out['providerName'], out['providerDisplay'], out['practitionerName']); }
		if (!out['orderingProvider']) { out['orderingProvider'] = pickFirst(out['providerName'], out['providerDisplay']); }

		// Payer / insurer (claims, coverage, referrals)
		if (!out['payerDisplay']) { out['payerDisplay'] = pickFirst(out['insurerName'], out['insuranceName'], out['organizationDisplay'], out['payerName'], out['payor.display']); }

		// Specialist / specialty (referrals)
		if (!out['specialistName']) { out['specialistName'] = pickFirst(out['specialist'], out['providerName'], out['referredTo']); }

		// Audit-log: surface user
		if (!out['user']) { out['user'] = pickFirst(out['userName'], out['userId']); }
		if (!out['userName']) { out['userName'] = pickFirst(out['user'], out['userId']); }

		// Code / clinical fields (FHIR Condition/Encounter/etc — codeable concepts)
		if (!out['code']) { out['code'] = pickFirst(out['display'], out['text'], out['diagnosisCode'], out['icdCode'], out['conditionCode']); }
		if (!out['type']) { out['type'] = pickFirst(out['typeDisplay'], out['encounterType'], out['visitCategory'], out['serviceType'], out['appointmentType']); }
		if (!out['appointmentType']) { out['appointmentType'] = pickFirst(out['type'], out['serviceType'], out['encounterType']); }
		if (!out['clinicalStatus']) { out['clinicalStatus'] = pickFirst(out['conditionStatus'], out['status']); }
		if (!out['verificationStatus']) { out['verificationStatus'] = pickFirst(out['verification']); }

		// Note status / document completion
		if (!out['noteStatus']) { out['noteStatus'] = pickFirst(out['signedStatus'], out['encounterNoteStatus']); }

		// Cost / amount / monetary fields
		if (!out['totalAmount']) { out['totalAmount'] = pickFirst(out['amount'], out['totalGross'], out['totalNet'], out['total']); }
		if (!out['cost']) { out['cost'] = pickFirst(out['totalCost'], out['amount']); }

		// Date fields: surface a generic createdAt for date filtering
		if (!out['createdAt']) { out['createdAt'] = pickFirst(out['audit.createdDate'], out['createdDate'], out['registrationDate'], out['_lastUpdated'], out['timestamp']); }
		if (!out['startDate']) { out['startDate'] = pickFirst(out['start'], out['period.start'], out['effectiveDate']); }
		if (!out['serviceDate']) { out['serviceDate'] = pickFirst(out['serviced'], out['servicedDate'], out['period.start'], out['date']); }
		if (!out['recordedDate']) { out['recordedDate'] = pickFirst(out['recorded'], out['createdAt']); }
		if (!out['onsetDate']) { out['onsetDate'] = pickFirst(out['onsetDateTime'], out['onset']); }

		// Title / measure / plan (care plans, quality)
		if (!out['title']) { out['title'] = pickFirst(out['name'], out['planName'], out['measure'], out['display']); }
		if (!out['category']) { out['category'] = pickFirst(out['categoryDisplay'], out['categoryText'], out['type']); }
		if (!out['period']) { out['period'] = pickFirst(out['periodStart'], out['period.start'], out['effectivePeriod']); }
		return out;
	}

	private _applyFiltersAndRender(): void {
		let filtered = this.items;

		// Date filter — pick the most relevant date field on each row
		const rowDate = (i: Record<string, string>): string =>
			i.startDate || i.start || i.referralDate || i.administrationDate || i.serviceDate
			|| i.orderDate || i.orderDateTime || i.collectedDate || i.reportedDate
			|| i.recordedDate || i.onsetDate || i.sentAt || i.timestamp || i.createdAt || '';
		if (this.dateFrom) {
			const from = new Date(this.dateFrom).getTime();
			filtered = filtered.filter(i => {
				const d = rowDate(i);
				return d ? new Date(d).getTime() >= from : true;
			});
		}
		if (this.dateTo) {
			const to = new Date(this.dateTo + 'T23:59:59').getTime();
			filtered = filtered.filter(i => {
				const d = rowDate(i);
				return d ? new Date(d).getTime() <= to : true;
			});
		}

		// Status filter
		if (this.statusFilter) {
			filtered = filtered.filter(i => (i.status || i.clinicalStatus || '') === this.statusFilter);
		}

		// KPIs
		DOM.clearNode(this.kpiEl);
		const groupCounts: Record<string, number> = {};
		for (const item of filtered) {
			const val = String(item[this.reportDef.chartGroupKey] || 'Other');
			groupCounts[val] = (groupCounts[val] || 0) + 1;
		}
		const kpiRow = DOM.append(this.kpiEl, DOM.$('div'));
		kpiRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';
		// Total
		const totalCard = DOM.append(kpiRow, DOM.$('div'));
		totalCard.style.cssText = 'padding:12px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;border-left:3px solid #3b82f6;min-width:100px;';
		DOM.append(totalCard, DOM.$('div')).textContent = String(filtered.length);
		(totalCard.lastChild as HTMLElement).style.cssText = 'font-size:22px;font-weight:700;';
		DOM.append(totalCard, DOM.$('div')).textContent = 'Total Records';
		(totalCard.lastChild as HTMLElement).style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
		// Per-group
		const sorted = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]);
		for (let i = 0; i < Math.min(sorted.length, 6); i++) {
			const [label, count] = sorted[i];
			const card = DOM.append(kpiRow, DOM.$('div'));
			card.style.cssText = `padding:12px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;border-left:3px solid ${COLORS[i % COLORS.length]};min-width:80px;`;
			DOM.append(card, DOM.$('div')).textContent = String(count);
			(card.lastChild as HTMLElement).style.cssText = 'font-size:22px;font-weight:700;';
			DOM.append(card, DOM.$('div')).textContent = label;
			(card.lastChild as HTMLElement).style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		}

		// Chart
		DOM.clearNode(this.chartEl);
		const chartTitle = DOM.append(this.chartEl, DOM.$('h3'));
		chartTitle.textContent = this.reportDef.chartLabel;
		chartTitle.style.cssText = 'font-size:13px;font-weight:600;margin:0 0 10px;';

		if (this.reportDef.chartType === 'bar') {
			const barData = sorted.slice(0, 12);
			const max = Math.max(...barData.map(d => d[1]), 1);
			const chart = DOM.append(this.chartEl, DOM.$('div'));
			chart.style.cssText = 'display:flex;align-items:flex-end;gap:4px;height:140px;';
			for (let i = 0; i < barData.length; i++) {
				const [label, value] = barData[i];
				const col = DOM.append(chart, DOM.$('div'));
				col.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;';
				const bar = DOM.append(col, DOM.$('div'));
				bar.style.cssText = `width:100%;max-width:50px;height:${Math.max((value / max) * 110, 3)}px;background:${COLORS[i % COLORS.length]};border-radius:3px 3px 0 0;`;
				bar.title = `${label}: ${value}`;
				const valEl = DOM.append(col, DOM.$('div'));
				valEl.textContent = String(value);
				valEl.style.cssText = 'font-size:10px;font-weight:600;';
				const lblEl = DOM.append(col, DOM.$('div'));
				// allow-any-unicode-next-line
				lblEl.textContent = label.length > 12 ? label.substring(0, 12) + '…' : label;
				lblEl.style.cssText = 'font-size:8px;color:var(--vscode-descriptionForeground);text-align:center;max-width:100%;overflow:hidden;';
			}
		} else {
			// Pie
			const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
			const row = DOM.append(this.chartEl, DOM.$('div'));
			row.style.cssText = 'display:flex;gap:16px;align-items:center;';
			const pie = DOM.append(row, DOM.$('div'));
			let gradient = '';
			let angle = 0;
			for (let i = 0; i < sorted.length; i++) {
				const pct = (sorted[i][1] / total) * 360;
				gradient += `${COLORS[i % COLORS.length]} ${angle}deg ${angle + pct}deg, `;
				angle += pct;
			}
			pie.style.cssText = `width:110px;height:110px;border-radius:50%;background:conic-gradient(${gradient.slice(0, -2)});flex-shrink:0;`;
			const legend = DOM.append(row, DOM.$('div'));
			for (let i = 0; i < Math.min(sorted.length, 8); i++) {
				const item = DOM.append(legend, DOM.$('div'));
				item.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
				const dot = DOM.append(item, DOM.$('span'));
				dot.style.cssText = `width:8px;height:8px;border-radius:2px;background:${COLORS[i % COLORS.length]};`;
				DOM.append(item, DOM.$('span')).textContent = `${sorted[i][0]}: ${sorted[i][1]} (${Math.round(sorted[i][1] / total * 100)}%)`;
				(item.lastChild as HTMLElement).style.cssText = 'font-size:11px;';
			}
		}

		// Data table
		DOM.clearNode(this.tableEl);
		const tableHeader = DOM.append(this.tableEl, DOM.$('div'));
		tableHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
		const tableTitle = DOM.append(tableHeader, DOM.$('h3'));
		tableTitle.textContent = `Detail Data (${filtered.length} records)`;
		tableTitle.style.cssText = 'font-size:13px;font-weight:600;margin:0;flex:1;';

		const tbl = DOM.append(this.tableEl, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;';
		const cols = this.reportDef.columns;
		const gridCols = cols.map(() => '1fr').join(' ');

		const hdr = DOM.append(tbl, DOM.$('div'));
		hdr.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);`;
		for (const c of cols) { DOM.append(hdr, DOM.$('span')).textContent = c.label; }

		const pageSize = 50;
		const pageItems = filtered.slice(0, pageSize);
		if (pageItems.length === 0) {
			const empty = DOM.append(tbl, DOM.$('div'));
			empty.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No records match the current filters';
		}
		for (const item of pageItems) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${gridCols};gap:8px;padding:5px 12px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.06);`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });
			for (const c of cols) {
				const cell = DOM.append(r, DOM.$('span'));
				cell.textContent = String(item[c.key] || '');
				cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			}
		}
		if (filtered.length > pageSize) {
			const more = DOM.append(tbl, DOM.$('div'));
			more.style.cssText = 'padding:8px 12px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;';
			more.textContent = `Showing ${pageSize} of ${filtered.length} records`;
		}
	}

	private _printReport(reportName: string): void {
		const cols = this.reportDef.columns;
		const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', '\'': '&#39;' }[c] || c));
		let rows = '';
		for (const item of this.items) {
			rows += '<tr>' + cols.map(c => `<td>${esc(String(item[c.key] || ''))}</td>`).join('') + '</tr>';
		}
		const html = `<!DOCTYPE html><html><head><title>${esc(reportName)}</title><style>
			body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;margin:20px;color:#000;}
			h1{font-size:18px;margin:0 0 4px;}
			.meta{color:#666;font-size:11px;margin-bottom:14px;}
			table{width:100%;border-collapse:collapse;}
			th,td{padding:6px 8px;text-align:left;border:1px solid #ddd;}
			th{background:#f5f5f5;font-weight:600;text-transform:uppercase;font-size:10px;}
			@media print{@page{size:landscape;margin:12mm;}}
		</style></head><body>
			<h1>${esc(reportName)}</h1>
			<div class="meta">Generated ${new Date().toLocaleString()} • ${this.items.length} records</div>
			<table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
		</body></html>`;

		const w = DOM.getActiveWindow().open('', '_blank');
		if (!w) { return; }
		w.document.open();
		w.document.write(html);
		w.document.close();
		// Wait for rendering before invoking print, otherwise sandboxed windows print blank
		w.onload = () => { try { w.focus(); w.print(); } catch { /* ignore */ } };
		// Fallback in case onload doesn't fire (already-loaded docs)
		w.setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
	}

	private _exportCsv(reportName: string): void {
		const cols = this.reportDef.columns;
		let csv = cols.map(c => c.label).join(',') + '\n';
		for (const item of this.items) {
			csv += cols.map(c => `"${String(item[c.key] || '').replace(/"/g, '""')}"`).join(',') + '\n';
		}
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${reportName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
