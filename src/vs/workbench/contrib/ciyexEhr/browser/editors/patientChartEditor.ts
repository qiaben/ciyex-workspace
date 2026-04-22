/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
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

// --- Types ---
interface ChartCategory { key: string; label: string; position: number; hideFromChart?: boolean; tabs: ChartTab[] }
interface ChartTab { key: string; label: string; icon: string; emoji?: string; color?: string; position: number; visible: boolean; display?: 'form' | 'list' | 'custom'; panel?: 'main' | 'bottom' | 'right'; fhirResources: string[] }
interface FieldSection { key: string; title: string; columns: number; visible: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[] }
interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; options?: Array<{ label: string; value: string }>; fhirMapping?: Record<string, string>; validation?: Record<string, unknown>; lookupConfig?: Record<string, string> }
interface FieldConfig { tabKey: string; sections: FieldSection[] }
interface QuickInfo { allergies: string; problems: string; history: string; vitals: string }

const FHIR_MAP: Record<string, string> = {
	'Patient': '/api/fhir-resource/demographics', 'Encounter': '/api/fhir-resource/encounters',
	'Condition': '/api/fhir-resource/conditions', 'AllergyIntolerance': '/api/fhir-resource/allergy-intolerances',
	'MedicationRequest': '/api/fhir-resource/medication-requests', 'Observation': '/api/fhir-resource/observations',
	'DiagnosticReport': '/api/fhir-resource/diagnostic-reports', 'Immunization': '/api/fhir-resource/immunizations',
	'Procedure': '/api/fhir-resource/procedures', 'DocumentReference': '/api/fhir-resource/document-references',
	'Appointment': '/api/fhir-resource/appointments', 'Coverage': '/api/fhir-resource/insurance-coverage',
	'ServiceRequest': '/api/fhir-resource/service-requests', 'CarePlan': '/api/fhir-resource/care-plans',
	'Consent': '/api/fhir-resource/consents', 'FamilyMemberHistory': '/api/fhir-resource/family-member-histories',
	'Claim': '/api/fhir-resource/claims', 'PaymentReconciliation': '/api/fhir-resource/payment-reconciliations',
	'RelatedPerson': '/api/fhir-resource/related-persons', 'Organization': '/api/fhir-resource/organizations',
};

// Default chart layout matching the screenshots. Merged with user's chart-layout.json
// so admins can still customize; defaults fill any gaps.
const DEFAULT_CATEGORIES: ChartCategory[] = [
	{
		key: 'overview', label: 'Overview', position: 0, tabs: [
			{ key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', emoji: '\u{1F4CA}', position: 0, visible: true, display: 'custom', panel: 'main', fhirResources: [] },
			{ key: 'demographics', label: 'Demographics', icon: 'User', emoji: '\u{1F464}', position: 1, visible: true, display: 'form', panel: 'main', fhirResources: ['Patient'] },
			{ key: 'forms', label: 'Forms', icon: 'FileText', emoji: '\u{1F4DD}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'] },
			{ key: 'vitals', label: 'Vitals', icon: 'Activity', emoji: '\u{2764}\u{FE0F}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['Observation'] },
			{ key: 'allergies', label: 'Allergies', icon: 'AlertTriangle', emoji: '\u{1F6A8}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['AllergyIntolerance'] },
			{ key: 'problems', label: 'Problems', icon: 'AlertCircle', emoji: '\u{26A0}\u{FE0F}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: ['Condition'] },
		],
	},
	{
		key: 'clinical', label: 'Clinical', position: 1, tabs: [
			{ key: 'clinical-alerts', label: 'Clinical Alerts', icon: 'Bell', emoji: '\u{1F514}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: [] },
			{ key: 'medications', label: 'Medications', icon: 'Pill', emoji: '\u{1F48A}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['MedicationRequest'] },
			{ key: 'labs', label: 'Labs', icon: 'TestTube', emoji: '\u{1F9EA}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['DiagnosticReport', 'Observation'] },
			{ key: 'immunizations', label: 'Immunizations', icon: 'Syringe', emoji: '\u{1F489}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['Immunization'] },
			{ key: 'procedures', label: 'Procedures', icon: 'Scissors', emoji: '\u{2702}\u{FE0F}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: ['Procedure'] },
			{ key: 'history', label: 'History', icon: 'History', emoji: '\u{1F4DA}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: ['FamilyMemberHistory', 'Observation'] },
		],
	},
	{
		key: 'encounters', label: 'Encounters', position: 2, tabs: [
			{ key: 'encounters', label: 'Encounters', icon: 'ClipboardList', emoji: '\u{1F4CB}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Encounter'] },
			{ key: 'appointments', label: 'Appointments', icon: 'Calendar', emoji: '\u{1F4C5}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['Appointment'] },
			{ key: 'visit-notes', label: 'Visit Notes', icon: 'FileEdit', emoji: '\u{1F4DD}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'] },
			{ key: 'referrals', label: 'Referrals', icon: 'ArrowRight', emoji: '\u{27A1}\u{FE0F}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: ['ServiceRequest'] },
		],
	},
	{
		key: 'billing', label: 'Billing', position: 3, tabs: [
			{ key: 'billing', label: 'Billing', icon: 'Receipt', emoji: '\u{1F9FE}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'] },
			{ key: 'claims', label: 'Claims', icon: 'FileCheck', emoji: '\u{1F4CB}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['Claim'] },
			{ key: 'submissions', label: 'Submissions', icon: 'Upload', emoji: '\u{1F4E4}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: [] },
			{ key: 'denials', label: 'Denials', icon: 'AlertCircle', emoji: '\u{26D4}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: [] },
			{ key: 'era-remittance', label: 'ERA / Remittance', icon: 'FileDown', emoji: '\u{1F4C4}', position: 4, visible: true, display: 'list', panel: 'main', fhirResources: [] },
			{ key: 'transactions', label: 'Transactions', icon: 'ArrowLeftRight', emoji: '\u{1F4B3}', position: 5, visible: true, display: 'list', panel: 'main', fhirResources: ['PaymentReconciliation'] },
		],
	},
	{
		key: 'financial', label: 'Financial', position: 4, tabs: [
			{ key: 'payment', label: 'Payment', icon: 'CreditCard', emoji: '\u{1F4B3}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: [] },
			{ key: 'statements', label: 'Statements', icon: 'FileBarChart', emoji: '\u{1F4CA}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: [] },
		],
	},
	{
		key: 'other', label: 'Other', position: 5, tabs: [
			{ key: 'issues', label: 'Issues', icon: 'CircleAlert', emoji: '\u{2757}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: [] },
			{ key: 'report', label: 'Report', icon: 'FileBarChart', emoji: '\u{1F4C8}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: [] },
		],
	},
	{
		key: 'portal', label: 'Portal', position: 6, tabs: [
			{ key: 'portal-demographics', label: 'Demographics', icon: 'User', emoji: '\u{1F464}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: [] },
		],
	},
	{
		key: 'general', label: 'General', position: 7, tabs: [
			{ key: 'insurance', label: 'Insurance', icon: 'Shield', emoji: '\u{1F6E1}\u{FE0F}', position: 0, visible: true, display: 'list', panel: 'main', fhirResources: ['Coverage', 'Organization'] },
			{ key: 'documents', label: 'Documents', icon: 'FileText', emoji: '\u{1F4C4}', position: 1, visible: true, display: 'list', panel: 'main', fhirResources: ['DocumentReference'] },
			{ key: 'education', label: 'Education', icon: 'BookOpen', emoji: '\u{1F4D6}', position: 2, visible: true, display: 'list', panel: 'main', fhirResources: [] },
			{ key: 'messaging', label: 'Messaging', icon: 'MessageSquare', emoji: '\u{1F4AC}', position: 3, visible: true, display: 'list', panel: 'main', fhirResources: [] },
		],
	},
];

const SIDEBAR_COLLAPSED_KEY = 'ciyex.patientChart.sidebarCollapsed';
const LAST_TAB_KEY_PREFIX = 'ciyex.patientChart.lastTab.';

export class PatientChartEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexPatientChart';

	private root!: HTMLElement;
	private headerBar!: HTMLElement;
	private sidebarEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private patientId = '';
	private patientName = '';
	private patientData: Record<string, unknown> = {};
	private categories: ChartCategory[] = [];
	private activeTab = 'dashboard';
	private sidebarCollapsed = false;
	private quickInfo: QuickInfo = { allergies: '—', problems: '—', history: '—', vitals: '—' };
	private readonly _configHome: URI;
	private readonly _tabDataCache = new Map<string, { config: FieldConfig | null; data: Record<string, unknown>[] }>();
	private readonly _tabNavMap = new Map<string, HTMLElement>();
	private readonly _quickInfoValEls = new Map<string, HTMLElement>();

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageSvc: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(PatientChartEditor.ID, group, telemetryService, themeService, storageSvc);
		this._configHome = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex');
		this.sidebarCollapsed = this.storageSvc.getBoolean(SIDEBAR_COLLAPSED_KEY, StorageScope.PROFILE, false);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-patient-chart'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header bar
		this.headerBar = DOM.append(this.root, DOM.$('.chart-header'));
		this.headerBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;align-items:center;gap:10px;background:var(--vscode-editor-background);';

		// Body: sidebar + main
		const body = DOM.append(this.root, DOM.$('.chart-body'));
		body.style.cssText = 'flex:1;display:flex;overflow:hidden;min-height:0;';

		this.sidebarEl = DOM.append(body, DOM.$('.chart-sidebar'));
		this.sidebarEl.style.cssText = 'width:240px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background, var(--vscode-editor-background));';

		this.mainEl = DOM.append(body, DOM.$('.chart-main'));
		this.mainEl.style.cssText = 'flex:1;min-width:0;overflow-y:auto;padding:20px 24px;';
	}

	override async setInput(input: PatientChartEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.patientId = input.patientId;
		this.patientName = input.patientName;
		this._tabDataCache.clear();
		this._tabNavMap.clear();
		this._quickInfoValEls.clear();
		this.activeTab = this.storageSvc.get(LAST_TAB_KEY_PREFIX + this.patientId, StorageScope.PROFILE, 'dashboard');

		await Promise.all([this._loadLayout(), this._loadPatient()]);
		if (token.isCancellationRequested) { return; }

		this._renderHeader();
		this._renderSidebar();
		this._renderMain();
		void this._loadQuickInfo();
	}

	override clearInput(): void {
		this._tabDataCache.clear();
		this._tabNavMap.clear();
		this._quickInfoValEls.clear();
		super.clearInput();
	}

	// --- Data loading ---

	private async _loadLayout(): Promise<void> {
		let userCategories: ChartCategory[] = [];
		try {
			const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'chart-layout.json'));
			const json = JSON.parse(file.value.toString());
			userCategories = (json.categories || []).filter((c: ChartCategory) => !c.hideFromChart);
		} catch { /* no user config, fall through to defaults */ }

		// Merge: user categories override defaults by key; unknown user categories appended.
		const byKey = new Map<string, ChartCategory>();
		for (const cat of DEFAULT_CATEGORIES) { byKey.set(cat.key, { ...cat, tabs: [...cat.tabs] }); }
		for (const userCat of userCategories) {
			const existing = byKey.get(userCat.key);
			if (existing) {
				// Merge tabs by key, user tabs override
				const tabByKey = new Map<string, ChartTab>();
				for (const t of existing.tabs) { tabByKey.set(t.key, t); }
				for (const t of userCat.tabs || []) { tabByKey.set(t.key, t); }
				existing.tabs = Array.from(tabByKey.values());
				existing.label = userCat.label || existing.label;
				existing.position = userCat.position ?? existing.position;
			} else {
				byKey.set(userCat.key, userCat);
			}
		}
		this.categories = Array.from(byKey.values())
			.sort((a, b) => a.position - b.position)
			.map(cat => ({ ...cat, tabs: cat.tabs.filter(t => t.visible !== false).sort((a, b) => a.position - b.position) }));
	}

	private async _loadPatient(): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/patients/${this.patientId}`);
			if (res.ok) { this.patientData = (await res.json())?.data || {}; }
		} catch { /* */ }
	}

	private async _loadTabData(tab: ChartTab): Promise<{ config: FieldConfig | null; data: Record<string, unknown>[] }> {
		const cached = this._tabDataCache.get(tab.key);
		if (cached) { return cached; }
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
		const result = { config, data };
		this._tabDataCache.set(tab.key, result);
		return result;
	}

	private async _loadQuickInfo(): Promise<void> {
		const fetchCount = async (resource: string): Promise<number | null> => {
			try {
				const ep = FHIR_MAP[resource] || `/api/fhir-resource/${resource.toLowerCase()}s`;
				const res = await this.apiService.fetch(`${ep}/patient/${this.patientId}?page=0&size=1`);
				if (!res.ok) { return null; }
				const json = await res.json();
				const count = json?.data?.totalElements ?? json?.totalElements ?? (Array.isArray(json?.data?.content) ? json.data.content.length : (Array.isArray(json?.data) ? json.data.length : 0));
				return typeof count === 'number' ? count : null;
			} catch { return null; }
		};
		const [allergies, problems, history, vitals] = await Promise.all([
			fetchCount('AllergyIntolerance'), fetchCount('Condition'),
			fetchCount('FamilyMemberHistory'), fetchCount('Observation'),
		]);
		this.quickInfo = {
			allergies: allergies === null ? '—' : allergies === 0 ? 'NKA' : String(allergies),
			problems: problems === null ? '—' : problems === 0 ? 'None' : String(problems),
			history: history === null ? '—' : history === 0 ? 'No records' : String(history),
			vitals: vitals === null ? '—' : vitals === 0 ? 'No recorded vitals' : String(vitals),
		};
		this._refreshQuickInfoDom();
	}

	// --- Header ---

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		const pd = (this.patientData || {}) as Record<string, unknown>;
		const name = this.patientName || `${String(pd.firstName || '')} ${String(pd.lastName || '')}`.trim() || 'Patient';
		const dobRaw = pd.dateOfBirth;
		const gender = this._genderLabel(String(pd.gender || ''));
		const mrn = String(pd.mrn || pd.medicalRecordNumber || pd.id || this.patientId);
		const phone = String(pd.phoneNumber || pd.phone || '');
		const rawStatus = String(pd.status || 'Active');
		const status = rawStatus === 'true' || rawStatus === 'Active' ? 'Active' : rawStatus;

		// Back arrow
		const back = DOM.append(this.headerBar, DOM.$('button'));
		back.textContent = '←';
		back.title = 'Back';
		back.style.cssText = 'background:transparent;border:none;color:var(--vscode-foreground);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;';
		back.addEventListener('mouseenter', () => { back.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
		back.addEventListener('mouseleave', () => { back.style.background = 'transparent'; });
		back.addEventListener('click', () => { this.group.closeEditor(this.input!); });

		// Name
		const nameEl = DOM.append(this.headerBar, DOM.$('span'));
		nameEl.textContent = name;
		nameEl.style.cssText = 'font-size:14px;font-weight:700;color:var(--vscode-foreground);';

		// MRN pill
		if (mrn) {
			const pill = DOM.append(this.headerBar, DOM.$('span'));
			pill.textContent = `MRN: ${mrn}`;
			pill.style.cssText = 'font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(59,130,246,0.12);color:#3b82f6;';
		}

		// DOB + age
		if (dobRaw) {
			const dobStr = this._formatDate(dobRaw);
			const age = this._calculateAge(dobRaw);
			const el = DOM.append(this.headerBar, DOM.$('span'));
			el.textContent = `DOB: ${dobStr}${age ? ` (${age})` : ''}`;
			el.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}
		if (gender) {
			const el = DOM.append(this.headerBar, DOM.$('span'));
			el.textContent = `Sex: ${gender}`;
			el.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}
		if (phone) {
			const el = DOM.append(this.headerBar, DOM.$('span'));
			el.textContent = phone;
			el.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}

		// Status pill
		const statusPill = DOM.append(this.headerBar, DOM.$('span'));
		statusPill.textContent = status;
		const statusColor = status === 'Active' ? '#22c55e' : status === 'Inactive' ? '#ef4444' : '#f59e0b';
		statusPill.style.cssText = `font-size:11px;font-weight:600;padding:2px 10px;border-radius:10px;background:${statusColor}20;color:${statusColor};`;

		// Spacer
		DOM.append(this.headerBar, DOM.$('span')).style.flex = '1';

		// Action buttons
		const newEnc = DOM.append(this.headerBar, DOM.$('button'));
		newEnc.textContent = '+ New Encounter';
		newEnc.style.cssText = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
		newEnc.addEventListener('click', () => this._openNewEncounter());

		const schedBtn = DOM.append(this.headerBar, DOM.$('button'));
		schedBtn.textContent = '\u{1F4C5} Schedule Appointment';
		schedBtn.style.cssText = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);';
		schedBtn.addEventListener('click', () => this._navigate('appointments'));
	}

	// --- Sidebar ---

	private _renderSidebar(): void {
		DOM.clearNode(this.sidebarEl);
		this._tabNavMap.clear();
		this._quickInfoValEls.clear();

		// CHART heading with collapse button
		const chartHdr = DOM.append(this.sidebarEl, DOM.$('div'));
		chartHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;';

		const chartLabel = DOM.append(chartHdr, DOM.$('span'));
		chartLabel.textContent = 'CHART';
		chartLabel.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';

		const collapseBtn = DOM.append(chartHdr, DOM.$('button'));
		collapseBtn.textContent = this.sidebarCollapsed ? '>' : '<';
		collapseBtn.title = this.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
		collapseBtn.style.cssText = 'background:transparent;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:10px;padding:2px 6px;border-radius:3px;';
		collapseBtn.addEventListener('click', () => this._toggleSidebar());

		if (this.sidebarCollapsed) {
			this.sidebarEl.style.width = '48px';
			return;
		}
		this.sidebarEl.style.width = '240px';

		// QUICK INFO section
		const qiHeader = DOM.append(this.sidebarEl, DOM.$('div'));
		qiHeader.textContent = 'QUICK INFO';
		qiHeader.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);padding:4px 14px 6px;';

		const qiBlock = DOM.append(this.sidebarEl, DOM.$('div'));
		qiBlock.style.cssText = 'padding:0 10px 12px;display:flex;flex-direction:column;gap:4px;';
		this._renderQuickInfoRow(qiBlock, 'allergies', '\u{1F6A8}', 'Allergies', this.quickInfo.allergies);
		this._renderQuickInfoRow(qiBlock, 'problems', '\u{1F90D}', 'Problems', this.quickInfo.problems);
		this._renderQuickInfoRow(qiBlock, 'history', '\u{1F4DC}', 'History', this.quickInfo.history);
		this._renderQuickInfoRow(qiBlock, 'vitals', '\u{1FAC0}', 'Vitals', this.quickInfo.vitals);

		// Category tabs
		for (const cat of this.categories) {
			if (cat.tabs.length === 0) { continue; }

			const catHdr = DOM.append(this.sidebarEl, DOM.$('div'));
			catHdr.textContent = cat.label.toUpperCase();
			catHdr.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);padding:14px 14px 6px;';

			for (const tab of cat.tabs) {
				const item = DOM.append(this.sidebarEl, DOM.$('div'));
				item.setAttribute('data-tab', tab.key);
				item.style.cssText = 'padding:6px 14px 6px 20px;cursor:pointer;color:var(--vscode-foreground);display:flex;align-items:center;gap:8px;font-size:13px;border-left:2px solid transparent;';

				if (tab.emoji) {
					const ic = DOM.append(item, DOM.$('span'));
					ic.textContent = tab.emoji;
					ic.style.cssText = 'font-size:13px;width:18px;text-align:center;flex-shrink:0;';
				}

				const lbl = DOM.append(item, DOM.$('span'));
				lbl.textContent = tab.label;
				lbl.style.cssText = 'flex:1;';

				item.addEventListener('mouseenter', () => {
					if (this.activeTab !== tab.key) { item.style.background = 'var(--vscode-list-hoverBackground)'; }
				});
				item.addEventListener('mouseleave', () => {
					if (this.activeTab !== tab.key) { item.style.background = ''; }
				});
				item.addEventListener('click', () => this._navigate(tab.key));
				this._tabNavMap.set(tab.key, item);
			}
		}
		this._highlightActiveTab();
	}

	private _renderQuickInfoRow(parent: HTMLElement, key: string, icon: string, label: string, value: string): void {
		const row = DOM.append(parent, DOM.$('div'));
		row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;font-size:12px;';

		const ic = DOM.append(row, DOM.$('span'));
		ic.textContent = icon;
		ic.style.cssText = 'font-size:13px;width:18px;text-align:center;flex-shrink:0;';

		const lbl = DOM.append(row, DOM.$('span'));
		lbl.textContent = `${label}:`;
		lbl.style.cssText = 'font-weight:600;color:var(--vscode-foreground);';

		const val = DOM.append(row, DOM.$('span'));
		val.textContent = value;
		val.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:11px;';
		this._quickInfoValEls.set(key, val);
	}

	private _refreshQuickInfoDom(): void {
		const map: Record<string, string> = {
			allergies: this.quickInfo.allergies, problems: this.quickInfo.problems,
			history: this.quickInfo.history, vitals: this.quickInfo.vitals,
		};
		for (const [key, val] of Object.entries(map)) {
			const el = this._quickInfoValEls.get(key);
			if (el) { el.textContent = val; }
		}
	}

	private _highlightActiveTab(): void {
		this._tabNavMap.forEach((el, key) => {
			const isActive = key === this.activeTab;
			el.style.borderLeftColor = isActive ? 'var(--vscode-focusBorder, #007acc)' : 'transparent';
			el.style.background = isActive ? 'var(--vscode-list-activeSelectionBackground, rgba(0,120,212,0.15))' : '';
			el.style.fontWeight = isActive ? '600' : '';
		});
	}

	private _toggleSidebar(): void {
		this.sidebarCollapsed = !this.sidebarCollapsed;
		this.storageSvc.store(SIDEBAR_COLLAPSED_KEY, this.sidebarCollapsed, StorageScope.PROFILE, StorageTarget.USER);
		this._renderSidebar();
	}

	private _navigate(tabKey: string): void {
		this.activeTab = tabKey;
		this.storageSvc.store(LAST_TAB_KEY_PREFIX + this.patientId, tabKey, StorageScope.PROFILE, StorageTarget.USER);
		this._highlightActiveTab();
		this._renderMain();
		this.mainEl.scrollTop = 0;
	}

	// --- Main panel ---

	private _renderMain(): void {
		DOM.clearNode(this.mainEl);
		const tab = this._findTab(this.activeTab);
		if (!tab) {
			const msg = DOM.append(this.mainEl, DOM.$('div'));
			msg.textContent = 'Tab not found.';
			msg.style.cssText = 'color:var(--vscode-descriptionForeground);padding:24px;';
			return;
		}

		if (tab.key === 'dashboard') {
			this._renderDashboard();
			return;
		}

		this._renderGenericTab(tab);
	}

	private _findTab(key: string): ChartTab | null {
		for (const cat of this.categories) {
			const t = cat.tabs.find(t => t.key === key);
			if (t) { return t; }
		}
		return null;
	}

	// --- Dashboard view ---

	private _renderDashboard(): void {
		// Recent & Upcoming card
		const card = DOM.append(this.mainEl, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:20px;margin-bottom:20px;';

		const title = DOM.append(card, DOM.$('h3'));
		title.textContent = 'Recent & Upcoming';
		title.style.cssText = 'margin:0 0 16px;font-size:16px;font-weight:600;color:var(--vscode-foreground);';

		const grid = DOM.append(card, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:24px;';

		// Recent Activity
		const recent = DOM.append(grid, DOM.$('div'));
		const recentHdr = DOM.append(recent, DOM.$('h4'));
		recentHdr.textContent = 'Recent Activity';
		recentHdr.style.cssText = 'margin:0 0 10px;font-size:13px;font-weight:600;color:#3b82f6;';
		const recentList = DOM.append(recent, DOM.$('div'));
		recentList.setAttribute('data-slot', 'recent-activity');
		const loading1 = DOM.append(recentList, DOM.$('div'));
		loading1.textContent = 'Loading...';
		loading1.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;padding:8px 0;';

		// Upcoming
		const upcoming = DOM.append(grid, DOM.$('div'));
		const upHdrRow = DOM.append(upcoming, DOM.$('div'));
		upHdrRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;';
		const upHdr = DOM.append(upHdrRow, DOM.$('h4'));
		upHdr.textContent = 'Upcoming';
		upHdr.style.cssText = 'margin:0;font-size:13px;font-weight:600;color:#3b82f6;';
		const viewAll = DOM.append(upHdrRow, DOM.$('a'));
		viewAll.textContent = 'View all →';
		viewAll.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		viewAll.addEventListener('click', () => this._navigate('appointments'));

		const upBox = DOM.append(upcoming, DOM.$('div'));
		upBox.style.cssText = 'background:var(--vscode-editor-background);border:1px dashed var(--vscode-editorWidget-border);border-radius:6px;padding:24px;text-align:center;';
		const upIcon = DOM.append(upBox, DOM.$('div'));
		upIcon.textContent = '\u{1F4C5}';
		upIcon.style.cssText = 'font-size:28px;margin-bottom:6px;';
		const upText = DOM.append(upBox, DOM.$('div'));
		upText.textContent = 'View upcoming appointments';
		upText.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:8px;';
		const goLink = DOM.append(upBox, DOM.$('a'));
		goLink.textContent = 'Go to Appointments →';
		goLink.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		goLink.addEventListener('click', () => this._navigate('appointments'));

		void this._loadRecentActivity(recentList);

		// Summary cards grid
		const cardsGrid = DOM.append(this.mainEl, DOM.$('div'));
		cardsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:16px;';
		this._renderSummaryCard(cardsGrid, 'allergies', '\u{1F6E1}\u{FE0F}', 'Allergies', 'AllergyIntolerance', 'allergyName', 'NKA — No Known Allergies');
		this._renderSummaryCard(cardsGrid, 'problems', '\u{1F90D}', 'Medical Problems', 'Condition', 'code', 'No problems recorded');
		this._renderSummaryCard(cardsGrid, 'insurance', '\u{1F512}', 'Insurance', 'Coverage', 'payerName', 'No insurance on file');
		this._renderPortalAccountCard(cardsGrid);
	}

	private async _loadRecentActivity(parent: HTMLElement): Promise<void> {
		interface ActivityItem { title: string; description: string; timestamp: string; status: string; emoji: string }
		const acts: ActivityItem[] = [];
		try {
			const res = await this.apiService.fetch(`${FHIR_MAP['Appointment']}/patient/${this.patientId}?page=0&size=5`);
			if (res.ok) {
				const json = await res.json();
				const items = json?.data?.content || json?.content || [];
				for (const a of items) {
					acts.push({
						title: `Appointment: ${a.visitType || a.appointmentType || 'Visit'}`,
						description: `With Provider at ${a.appointmentStartTime || this._formatDate(a.appointmentStartDate) || ''}`,
						timestamp: this._formatDate(a.appointmentStartDate) || '',
						status: String(a.status || 'scheduled'),
						emoji: '\u{1F4C5}',
					});
				}
			}
		} catch { /* */ }

		DOM.clearNode(parent);
		if (acts.length === 0) {
			const empty = DOM.append(parent, DOM.$('div'));
			empty.textContent = 'No recent activity';
			empty.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;padding:8px 0;';
			return;
		}

		for (const act of acts) {
			const row = DOM.append(parent, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.08);';

			const ic = DOM.append(row, DOM.$('div'));
			ic.textContent = act.emoji;
			ic.style.cssText = 'font-size:18px;padding-top:2px;';

			const content = DOM.append(row, DOM.$('div'));
			content.style.cssText = 'flex:1;min-width:0;';

			const titleRow = DOM.append(content, DOM.$('div'));
			titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
			const t = DOM.append(titleRow, DOM.$('span'));
			t.textContent = act.title;
			t.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-foreground);';
			const badge = DOM.append(titleRow, DOM.$('span'));
			badge.textContent = act.status;
			badge.style.cssText = 'font-size:10px;padding:1px 8px;border-radius:10px;background:rgba(59,130,246,0.15);color:#3b82f6;';

			const desc = DOM.append(content, DOM.$('div'));
			desc.textContent = act.description;
			desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';

			const time = DOM.append(content, DOM.$('div'));
			time.textContent = act.timestamp;
			time.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		}
	}

	private _renderSummaryCard(parent: HTMLElement, _key: string, icon: string, title: string, resource: string, displayField: string, emptyMsg: string): void {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;';

		const hdr = DOM.append(card, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';

		const titleRow = DOM.append(hdr, DOM.$('div'));
		titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const ic = DOM.append(titleRow, DOM.$('span'));
		ic.textContent = icon;
		ic.style.cssText = 'font-size:16px;';
		const t = DOM.append(titleRow, DOM.$('span'));
		t.textContent = title;
		t.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';

		const viewAll = DOM.append(hdr, DOM.$('a'));
		viewAll.textContent = 'View all';
		viewAll.style.cssText = 'font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:none;';
		const tabKey = title === 'Allergies' ? 'allergies' : title === 'Medical Problems' ? 'problems' : 'insurance';
		viewAll.addEventListener('click', () => this._navigate(tabKey));

		const body = DOM.append(card, DOM.$('div'));
		body.setAttribute('data-card-body', resource);
		body.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);min-height:40px;';
		body.textContent = 'Loading...';

		void (async () => {
			try {
				const ep = FHIR_MAP[resource] || `/api/fhir-resource/${resource.toLowerCase()}s`;
				const res = await this.apiService.fetch(`${ep}/patient/${this.patientId}?page=0&size=3`);
				if (res.ok) {
					const json = await res.json();
					const items: Record<string, unknown>[] = json?.data?.content || json?.content || [];
					DOM.clearNode(body);
					if (items.length === 0) {
						body.textContent = emptyMsg;
						return;
					}
					for (const item of items.slice(0, 3)) {
						const row = DOM.append(body, DOM.$('div'));
						row.style.cssText = 'padding:3px 0;font-size:12px;color:var(--vscode-foreground);';
						const v = item[displayField];
						let text: string;
						if (v && typeof v === 'object') {
							const obj = v as Record<string, unknown>;
							text = String(obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.display || JSON.stringify(v).substring(0, 40));
						} else {
							text = String(v || item.name || item.code || '—');
						}
						row.textContent = text.substring(0, 50);
					}
				} else {
					body.textContent = emptyMsg;
				}
			} catch {
				body.textContent = emptyMsg;
			}
		})();
	}

	private _renderPortalAccountCard(parent: HTMLElement): void {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;';

		const hdrRow = DOM.append(card, DOM.$('div'));
		hdrRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;';
		const ic = DOM.append(hdrRow, DOM.$('span'));
		ic.textContent = '\u{2705}';
		ic.style.cssText = 'font-size:16px;';
		const t = DOM.append(hdrRow, DOM.$('span'));
		t.textContent = 'Portal Account';
		t.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';

		const email = String((this.patientData as Record<string, unknown>).email || '');
		const emailRow = DOM.append(card, DOM.$('div'));
		emailRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:12px;color:var(--vscode-foreground);';
		const dot = DOM.append(emailRow, DOM.$('span'));
		dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0;';
		const emailEl = DOM.append(emailRow, DOM.$('span'));
		emailEl.textContent = email || 'No email on file';
		emailEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

		const btnRow = DOM.append(card, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';

		const mkBtn = (label: string, color: string, bg: string, fn: () => void) => {
			const b = DOM.append(btnRow, DOM.$('button'));
			b.textContent = label;
			b.style.cssText = `padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:1px solid ${color}40;background:${bg};color:${color};`;
			b.addEventListener('click', fn);
		};
		mkBtn('\u{1F511} Reset Password', 'var(--vscode-foreground)', 'var(--vscode-button-secondaryBackground)', () => this.notificationService.info('Reset Password — coming soon'));
		mkBtn('\u{2709} Email Reset', 'var(--vscode-foreground)', 'var(--vscode-button-secondaryBackground)', () => this.notificationService.info('Email Reset — coming soon'));
		mkBtn('\u{26D4} Block', '#ef4444', 'transparent', () => this.notificationService.info('Block — coming soon'));
	}

	// --- Generic tab (list or form) ---

	private async _renderGenericTab(tab: ChartTab): Promise<void> {
		// Section card header
		const card = DOM.append(this.mainEl, DOM.$('div'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const hdr = DOM.append(card, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px;background:rgba(0,122,204,0.08);border-bottom:1px solid var(--vscode-editorWidget-border);';

		if (tab.emoji) {
			const ic = DOM.append(hdr, DOM.$('span'));
			ic.textContent = tab.emoji;
			ic.style.cssText = 'font-size:16px;';
		}
		const t = DOM.append(hdr, DOM.$('span'));
		t.textContent = tab.label;
		t.style.cssText = 'font-size:14px;font-weight:600;';
		const countEl = DOM.append(hdr, DOM.$('span'));
		countEl.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);';

		DOM.append(hdr, DOM.$('span')).style.flex = '1';

		const actionSlot = DOM.append(hdr, DOM.$('div'));
		actionSlot.style.cssText = 'display:flex;gap:6px;';
		const addBtn = DOM.append(actionSlot, DOM.$('button'));
		addBtn.textContent = `+ Add`;
		addBtn.style.cssText = 'padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);';
		addBtn.addEventListener('click', () => this.notificationService.info(`New ${tab.label} — coming soon`));

		const content = DOM.append(card, DOM.$('div'));
		content.style.cssText = 'padding:14px 16px;';
		const loading = DOM.append(content, DOM.$('div'));
		loading.textContent = 'Loading...';
		loading.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';

		// Empty-data tab with no FHIR resources → show placeholder
		if (tab.fhirResources.length === 0) {
			DOM.clearNode(content);
			const placeholder = DOM.append(content, DOM.$('div'));
			placeholder.style.cssText = 'padding:40px 16px;text-align:center;color:var(--vscode-descriptionForeground);';
			const icon = DOM.append(placeholder, DOM.$('div'));
			icon.textContent = tab.emoji || '\u{1F4CB}';
			icon.style.cssText = 'font-size:32px;margin-bottom:8px;';
			const msg = DOM.append(placeholder, DOM.$('div'));
			msg.textContent = `${tab.label} — coming soon`;
			msg.style.cssText = 'font-size:13px;';
			return;
		}

		const { config, data } = await this._loadTabData(tab);
		// Active tab may have changed while loading
		if (tab.key !== this.activeTab) { return; }

		DOM.clearNode(content);
		countEl.textContent = data.length > 0 ? String(data.length) : '';

		const isForm = tab.display === 'form';
		if (config?.sections && isForm) {
			this._renderForm(content, config.sections, data.length > 0 ? data : [{}]);
		} else if (data.length > 0) {
			this._listAuto(content, tab, data);
		} else {
			const empty = DOM.append(content, DOM.$('div'));
			empty.textContent = `No ${tab.label.toLowerCase()} records`;
			empty.style.cssText = 'padding:40px 16px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;';
		}
	}

	// --- Form renderer (grid by section) ---

	private _renderForm(container: HTMLElement, sections: FieldSection[], data: Record<string, unknown>[]): void {
		const record = ((data[0] as Record<string, unknown>)?.data as Record<string, unknown>) || data[0] || {};

		for (const sec of sections) {
			if (!sec.visible) { continue; }
			const cols = Math.min(sec.columns || 3, 4);

			const subHeader = DOM.append(container, DOM.$('div'));
			subHeader.textContent = sec.title;
			subHeader.style.cssText = 'font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;margin:14px 0 6px;padding-top:8px;border-top:1px solid var(--vscode-editorWidget-border);';
			if (sections.indexOf(sec) === 0) { subHeader.style.borderTop = 'none'; subHeader.style.marginTop = '0'; }

			const gridBody = DOM.append(container, DOM.$('div'));
			gridBody.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:4px 16px;margin-bottom:4px;`;

			for (const f of sec.fields) {
				const val = (record as Record<string, unknown>)[f.key] ?? '';

				const cell = DOM.append(gridBody, DOM.$('div'));
				cell.style.cssText = `grid-column:span ${Math.min(f.colSpan || 1, cols)};padding:4px 0;`;

				const lbl = DOM.append(cell, DOM.$('label'));
				lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;';
				const lblText = DOM.append(lbl, DOM.$('span'));
				lblText.textContent = f.label;
				if (f.required) {
					const req = DOM.append(lbl, DOM.$('span'));
					req.textContent = ' *';
					req.style.cssText = 'color:#ef4444;';
				}

				const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:13px;height:32px;box-sizing:border-box;outline:none;';

				if (f.type === 'select') {
					const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
					sel.style.cssText = inputStyle + 'cursor:pointer;';
					for (const o of [{ label: `Select ${f.label}...`, value: '' }, ...(f.options || [])]) {
						const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
						opt.value = o.value; opt.textContent = o.label; opt.selected = String(val) === o.value;
					}
				} else if (f.type === 'boolean' || f.type === 'toggle') {
					const wrap = DOM.append(cell, DOM.$('div'));
					wrap.style.cssText = 'display:flex;align-items:center;gap:8px;height:32px;';
					const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
					cb.type = 'checkbox'; cb.checked = !!val;
					cb.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:var(--vscode-focusBorder,#007acc);';
					const cbLabel = DOM.append(wrap, DOM.$('span'));
					cbLabel.textContent = val ? 'Yes' : 'No';
					cb.addEventListener('change', () => { cbLabel.textContent = cb.checked ? 'Yes' : 'No'; });
				} else if (f.type === 'textarea') {
					const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
					ta.value = String(val); ta.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					ta.style.cssText = inputStyle + 'min-height:70px;height:auto;resize:vertical;';
				} else if (f.type === 'date') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'date'; inp.value = String(val).split('T')[0]; inp.style.cssText = inputStyle;
				} else if (f.type === 'number') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'number'; inp.value = String(val); inp.placeholder = f.placeholder || '0';
					inp.style.cssText = inputStyle;
				} else {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
					inp.value = String(val); inp.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					inp.style.cssText = inputStyle;
				}
			}
		}
	}

	// --- List renderer (FHIR auto-columns) ---

	private _listAuto(c: HTMLElement, tab: ChartTab, data: Record<string, unknown>[]): void {
		const sample = data[0] || {};
		const allKeys = Object.keys(sample);

		const priorityKeys = ['start', 'date', 'period', 'effectiveDateTime', 'recordedDate', 'authoredOn',
			'appointmentType', 'type', 'visitType', 'class', 'serviceType', 'code', 'medicationCodeableConcept',
			'providerName', 'providerDisplay', 'practitionerName', 'patientName', 'patientDisplay',
			'status', 'clinicalStatus', 'verificationStatus', 'category', 'severity', 'criticality',
			'reason', 'note', 'description', 'text'];

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
				if (v === null || v === undefined) { return ''; }
				if (typeof v === 'object') {
					const obj = v as Record<string, unknown>;
					return String(obj.text || obj.display || (obj.coding as Array<Record<string, string>>)?.[0]?.display || '');
				}
				if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
					try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { /* */ }
				}
				return String(v).substring(0, 40);
			});

			const isEncounter = tab.fhirResources.includes('Encounter');
			const onClick = isEncounter ? () => {
				const id = String(item.id || item.fhirId || '');
				this.editorService.openEditor(new EncounterFormEditorInput(this.patientId, id, this.patientName, `Encounter ${id}`), {}, SIDE_GROUP);
			} : undefined;

			return { cells, onClick };
		});

		this._table(c, cols, rows);
	}

	private _table(container: HTMLElement, columns: string[], rows: Array<{ cells: string[]; onClick?: () => void }>): void {
		const wrap = DOM.append(container, DOM.$('div'));
		wrap.style.cssText = 'overflow-x:auto;';
		const table = DOM.append(wrap, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';

		const thead = DOM.append(table, DOM.$('thead'));
		const hrow = DOM.append(thead, DOM.$('tr'));
		for (const col of columns) {
			const th = DOM.append(hrow, DOM.$('th'));
			th.textContent = col;
			th.style.cssText = 'text-align:left;padding:8px 12px;font-size:12px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);white-space:nowrap;';
		}

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

				if (i === row.cells.length - 1 && columns[i] === 'Status') {
					const badge = DOM.append(td, DOM.$('span'));
					badge.textContent = row.cells[i];
					badge.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:3px;background:rgba(59,130,246,0.12);color:#3b82f6;text-transform:capitalize;';
				} else if (i === 0) {
					td.style.fontWeight = '600';
					td.textContent = row.cells[i];
				} else {
					td.textContent = row.cells[i];
				}
			}
		}
	}

	private _openNewEncounter(): void {
		this.editorService.openEditor(new EncounterFormEditorInput(this.patientId, 'new', this.patientName, 'New Encounter'), {}, SIDE_GROUP);
	}

	// --- Formatting helpers ---

	private _formatDate(raw: unknown): string {
		if (!raw) { return ''; }
		if (Array.isArray(raw)) {
			const [y, m, d] = raw;
			if (typeof y === 'number' && typeof m === 'number' && typeof d === 'number') {
				return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
			}
			return '';
		}
		try { return new Date(String(raw)).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); }
		catch { return String(raw); }
	}

	private _calculateAge(raw: unknown): string {
		if (!raw) { return ''; }
		let birthDate: Date;
		if (Array.isArray(raw)) {
			const [y, m, d] = raw;
			if (typeof y !== 'number' || typeof m !== 'number' || typeof d !== 'number') { return ''; }
			birthDate = new Date(y, m - 1, d);
		} else {
			birthDate = new Date(String(raw));
		}
		if (isNaN(birthDate.getTime())) { return ''; }
		const now = new Date();
		let years = now.getFullYear() - birthDate.getFullYear();
		let months = now.getMonth() - birthDate.getMonth();
		let days = now.getDate() - birthDate.getDate();
		if (days < 0) { months--; const prev = new Date(now.getFullYear(), now.getMonth(), 0); days += prev.getDate(); }
		if (months < 0) { years--; months += 12; }
		if (years > 0) { return `${years} yr${years !== 1 ? 's' : ''}${months > 0 ? ` ${months} mo` : ''}`; }
		if (months > 0) { return `${months} mo${days > 0 ? ` ${days} d` : ''}`; }
		return `${days} d`;
	}

	private _genderLabel(g: string): string {
		if (!g) { return ''; }
		const map: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other', U: 'Unknown', Male: 'Male', Female: 'Female', Other: 'Other', Unknown: 'Unknown' };
		return map[g] || g;
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
