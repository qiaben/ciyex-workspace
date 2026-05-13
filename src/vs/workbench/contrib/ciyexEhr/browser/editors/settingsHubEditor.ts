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
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { SettingsHubEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';

interface FieldDef {
	key: string;
	label: string;
	type?: string;
	required?: boolean;
	options?: Array<string | { value: string; label: string }>;
	placeholder?: string;
	showInTable?: boolean;
	readOnly?: boolean;
	rows?: number;
	accept?: string;
	lookupConfig?: {
		endpoint?: string;
		displayField?: string;
		valueField?: string;
		searchable?: boolean;
		autoFillFields?: Record<string, string>;
	};
}

interface SectionDef {
	key?: string;
	label?: string;
	fields: FieldDef[];
}

interface FieldConfig {
	sections?: SectionDef[];
	singleton?: boolean;
}

interface TabFieldConfig {
	tabKey: string;
	label?: string;
	icon?: string;
	category?: string;
	fhirResources?: Array<unknown>;
	fieldConfig?: FieldConfig | string;
}

interface SidebarItem {
	key: string;
	label: string;
	icon: string;
	kind: 'fhir' | 'admin' | 'builtin' | 'command';
	commandId?: string;
	/** Group label shown above this item — empty means the section header is suppressed. */
	group?: SidebarGroup;
}

/**
 * Sidebar section groups, in display order. Matches the EHR Web UI settings
 * sidebar groups (General resources, User Management, Layout & Forms, System).
 */
type SidebarGroup = 'general' | 'user-mgmt' | 'layout-forms' | 'system';

const GROUP_LABELS: Record<SidebarGroup, string> = {
	'general': 'GENERAL',
	'user-mgmt': 'USER MANAGEMENT',
	'layout-forms': 'LAYOUT & FORMS',
	'system': 'SYSTEM',
};

const ADMIN_ITEMS: SidebarItem[] = [
	{ key: '__users__', label: 'Users', icon: '\u{1F465}', kind: 'admin', group: 'user-mgmt' },
	{ key: '__roles__', label: 'Roles & Permissions', icon: '\u{1F6E1}', kind: 'admin', group: 'user-mgmt' },
];

// Mirror the Ciyex web /settings sidebar. Layout & Forms group contains the
// page-tree settings (Chart, Menu, Encounter, Portal). System group contains
// the global preferences (Display, Form Options, Template Documents, Calendar
// Colors). Items with kind:'command' open a dedicated editor rather than
// rendering inside the hub — same command IDs the gear menu used to expose
// before the Settings Hub redirect.
const BUILTIN_ITEMS: SidebarItem[] = [
	// Layout & Forms
	{ key: '__layout-settings__', label: 'Chart', icon: '\u{1F4CA}', kind: 'command', commandId: 'ciyex.openLayoutSettings', group: 'layout-forms' },
	{ key: '__menu-config__', label: 'Menu', icon: '\u{1F4DC}', kind: 'builtin', group: 'layout-forms' },
	{ key: '__encounter-settings__', label: 'Encounter', icon: '\u{1F4CB}', kind: 'builtin', group: 'layout-forms' },
	{ key: '__portal-settings__', label: 'Portal', icon: '\u{1F310}', kind: 'command', commandId: 'ciyex.openPortalSettings', group: 'layout-forms' },
	{ key: '__template-documents__', label: 'Template Documents', icon: '\u{1F4DD}', kind: 'builtin', group: 'layout-forms' },
	// System
	{ key: '__form-options__', label: 'Form Options', icon: '\u{2699}', kind: 'builtin', group: 'system' },
	{ key: '__display__', label: 'Display', icon: '\u{1F5A5}', kind: 'builtin', group: 'system' },
	{ key: '__calendar-colors__', label: 'Calendar Colors', icon: '\u{1F3A8}', kind: 'builtin', group: 'system' },
	{ key: '__layout-hub__', label: 'Layout Configuration', icon: '\u{1F4D0}', kind: 'command', commandId: 'ciyex.openLayoutHub', group: 'system' },
	{ key: '__practice-settings__', label: 'Practice Settings', icon: '\u{1F3E2}', kind: 'command', commandId: 'ciyex.openPracticeSettings', group: 'system' },
];

const ICON_MAP: Record<string, string> = {
	'Building2': '\u{1F3E2}',
	'Building': '\u{1F3E2}',
	'User': '\u{1F464}',
	'Users': '\u{1F465}',
	'Shield': '\u{1F6E1}',
	'CreditCard': '\u{1F4B3}',
	'Hash': '#',
	'FileText': '\u{1F4C4}',
	'Briefcase': '\u{1F4BC}',
	'Stethoscope': '\u{1FA7A}',
	'MapPin': '\u{1F4CD}',
	'ExternalLink': '\u{1F517}',
	'UserPlus': '\u{1F464}+',
	'Activity': '\u{2764}',
	'Heart': '\u{2764}',
	'Pill': '\u{1F48A}',
	'Calendar': '\u{1F4C5}',
	'Settings': '\u{2699}',
	'AlertCircle': '\u{26A0}',
	'AlertTriangle': '\u{26A0}',
	'Globe': '\u{1F310}',
	'Mail': '\u{1F4E7}',
};

type Mode = 'list' | 'view' | 'create' | 'edit';

export class SettingsHubEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexSettingsHub';

	/** Inject the no-scrollbar stylesheet exactly once per browser session. */
	private static _scrollbarStyleInjected = false;
	private static _injectNoScrollbarStyle(): void {
		if (this._scrollbarStyleInjected) { return; }
		this._scrollbarStyleInjected = true;
		const styleEl = mainWindow.document.createElement('style');
		styleEl.textContent = '.ciyex-no-scrollbar::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none; }';
		mainWindow.document.head.appendChild(styleEl);
	}

	private root!: HTMLElement;
	private sidebarEl!: HTMLElement;
	private contentEl!: HTMLElement;
	private fhirItems: SidebarItem[] = [];
	private activeKey: string = '';
	private mode: Mode = 'list';

	// Per-tab state
	private currentConfig: TabFieldConfig | null = null;
	private currentFieldConfig: FieldConfig | null = null;
	private records: Record<string, unknown>[] = [];
	private formData: Record<string, unknown> = {};
	private selectedRecord: Record<string, unknown> | null = null;
	private page: number = 0;
	private pageSize: number = 25;
	private totalElements: number = 0;
	private saving: boolean = false;
	private searchTerm: string = '';
	private validationErrors: Record<string, string> = {};

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(SettingsHubEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.settings-hub-editor.ciyex-editor-root'));
		// Match the EHR Web UI: bg-gray-50 sidebar (a touch lighter than the
		// editor background) and a flat editor content area to the right.
		this.root.style.cssText = 'height:100%;display:flex;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';

		this.sidebarEl = DOM.append(this.root, DOM.$('.sh-sidebar'));
		this.sidebarEl.style.cssText = 'width:224px;flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background,rgba(0,0,0,0.06));overflow-y:auto;display:flex;flex-direction:column;scrollbar-width:none;';
		this.sidebarEl.classList.add('ciyex-no-scrollbar');

		this.contentEl = DOM.append(this.root, DOM.$('.sh-content'));
		this.contentEl.style.cssText = 'flex:1;overflow-y:auto;scrollbar-width:none;';
		this.contentEl.classList.add('ciyex-no-scrollbar');

		// One-time inject of the scrollbar-hide stylesheet used by every Ciyex
		// editor pane. Team report flagged "still the vertical bar is showing
		// in this page" on Practice Settings; this hides it everywhere.
		SettingsHubEditor._injectNoScrollbarStyle();
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof SettingsHubEditorInput)) { return; }
		if (input.initialTab) {
			this.activeKey = input.initialTab;
		}
		await this._loadSidebar();
	}

	private async _loadSidebar(): Promise<void> {
		this._renderSidebarLoading();
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/all');
			if (res.ok) {
				const data: TabFieldConfig[] = await res.json();
				// Exclude tabs that have a dedicated builtin renderer in the hub
				// (e.g. `template-documents` would otherwise appear twice — once as
				// the DocumentReference FHIR table, once as the Template Documents
				// templates editor). The builtin handles the actual templates flow.
				const BUILTIN_DUPS = new Set(['template-documents']);
				this.fhirItems = data
					.filter(d => d.category === 'Settings' && Array.isArray(d.fhirResources) && d.fhirResources.length > 0 && !BUILTIN_DUPS.has(d.tabKey))
					.map(d => ({
						key: d.tabKey,
						label: d.label || this._titleCase(d.tabKey),
						icon: ICON_MAP[d.icon || 'FileText'] || '\u{1F4C4}',
						kind: 'fhir' as const,
					}));
			}
			if (!this.activeKey && this.fhirItems.length > 0) {
				this.activeKey = this.fhirItems[0].key;
			}
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login\u2026';
		}
	}

	private _renderSidebarLoading(): void {
		DOM.clearNode(this.sidebarEl);
		const loading = DOM.append(this.sidebarEl, DOM.$('div'));
		loading.textContent = 'Loading\u2026';
		loading.style.cssText = 'padding:16px;color:var(--vscode-descriptionForeground);';
	}

	private _render(): void {
		this._renderSidebar();
		this._renderContent();
	}

	private _renderSidebar(): void {
		DOM.clearNode(this.sidebarEl);

		// Header — mirrors the EHR Web UI sidebar header "SETTINGS"
		const header = DOM.append(this.sidebarEl, DOM.$('.sh-sb-header'));
		header.style.cssText = 'padding:14px 16px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;gap:8px;flex-shrink:0;';
		const headerIcon = DOM.append(header, DOM.$('span'));
		headerIcon.textContent = '\u{2699}';
		headerIcon.style.cssText = 'font-size:14px;color:var(--vscode-descriptionForeground);';
		const headerText = DOM.append(header, DOM.$('h2'));
		headerText.textContent = 'SETTINGS';
		headerText.style.cssText = 'margin:0;font-size:11px;font-weight:600;letter-spacing:1.4px;color:var(--vscode-descriptionForeground);';

		const nav = DOM.append(this.sidebarEl, DOM.$('nav'));
		nav.style.cssText = 'padding:8px 6px;display:flex;flex-direction:column;gap:1px;flex:1;overflow-y:auto;';

		// "General" group — FHIR resource settings (Practice, Facilities, Providers, Insurance, etc.)
		// Always rendered first because it contains the practice-level data users
		// most often need to edit. Matches the EHR Web UI which puts these at the top.
		if (this.fhirItems.length > 0) {
			this._renderGroupHeader(nav, GROUP_LABELS['general']);
			for (const item of this.fhirItems) {
				this._renderSidebarBtn(nav, item);
			}
		}

		// Other groups, in declared order. Each group prints its header label
		// once, then all items belonging to that group.
		const groupedItems: Array<[SidebarGroup, SidebarItem[]]> = [
			['user-mgmt', ADMIN_ITEMS],
			['layout-forms', BUILTIN_ITEMS.filter(i => i.group === 'layout-forms')],
			['system', BUILTIN_ITEMS.filter(i => i.group === 'system')],
		];
		for (const [groupKey, items] of groupedItems) {
			if (items.length === 0) { continue; }
			this._renderGroupHeader(nav, GROUP_LABELS[groupKey]);
			for (const item of items) {
				this._renderSidebarBtn(nav, item);
			}
		}
	}

	private _renderGroupHeader(parent: HTMLElement, text: string): void {
		const h = DOM.append(parent, DOM.$('div'));
		h.textContent = text;
		h.style.cssText = 'padding:14px 10px 6px;font-size:10px;font-weight:700;letter-spacing:1.2px;color:var(--vscode-descriptionForeground);text-transform:uppercase;';
	}

	private _renderSidebarBtn(parent: HTMLElement, item: SidebarItem): void {
		const btn = DOM.append(parent, DOM.$('button'));
		btn.dataset.key = item.key;
		const isActive = this.activeKey === item.key;
		// Match the EHR Web UI: active = blue-600 bg + white text + slight shadow,
		// inactive = transparent + foreground text with subtle hover. Padding 7px
		// 10px keeps row height ~32px (matches w-56 sidebar in the web).
		btn.style.cssText = `display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;background:${isActive ? '#2563eb' : 'transparent'};color:${isActive ? '#ffffff' : 'var(--vscode-foreground)'};border:none;border-radius:6px;cursor:pointer;text-align:left;font-size:13px;font-weight:${isActive ? '500' : '400'};transition:background 0.08s;`;
		const icon = DOM.append(btn, DOM.$('span'));
		icon.textContent = item.icon;
		icon.style.cssText = 'flex-shrink:0;width:16px;font-size:13px;text-align:center;opacity:0.95;';
		const label = DOM.append(btn, DOM.$('span'));
		label.textContent = item.label;
		label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		// Command-kind items get a subtle "\u2197" suffix to show they open a new editor.
		if (item.kind === 'command') {
			const ext = DOM.append(btn, DOM.$('span'));
			ext.textContent = '\u2197';
			ext.style.cssText = `font-size:10px;opacity:${isActive ? '0.85' : '0.45'};`;
		}
		btn.addEventListener('mouseenter', () => { if (!isActive) { btn.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; } });
		btn.addEventListener('mouseleave', () => { if (!isActive) { btn.style.background = 'transparent'; } });
		btn.addEventListener('click', () => {
			// Command-kind items run their registered command (which opens
			// the dedicated editor for Layout Settings / Portal Settings /
			// Practice Settings / Menu Configuration / Layout Hub) instead
			// of swapping the hub's right pane.
			if (item.kind === 'command' && item.commandId) {
				void this.commandService.executeCommand(item.commandId);
				return;
			}
			this._onSidebarClick(item.key);
		});
	}

	private _onSidebarClick(key: string): void {
		this.activeKey = key;
		this.mode = 'list';
		this.formData = {};
		this.selectedRecord = null;
		this.searchTerm = '';
		this.page = 0;
		this.records = [];
		this.currentConfig = null;
		this.currentFieldConfig = null;
		this._render();
	}

	private _renderContent(): void {
		DOM.clearNode(this.contentEl);
		const key = this.activeKey;
		if (!key) {
			const ph = DOM.append(this.contentEl, DOM.$('div'));
			ph.style.cssText = 'padding:60px;text-align:center;color:var(--vscode-descriptionForeground);';
			ph.textContent = 'Select a settings page from the left.';
			return;
		}

		if (key === '__users__') { this._renderUsers(); return; }
		if (key === '__roles__') { this._renderRolesPermissions(); return; }
		if (key === '__form-options__') { this._renderFormOptions(); return; }
		if (key === '__display__') { this._renderDisplay(); return; }
		if (key === '__template-documents__') { this._renderTemplateDocuments(); return; }
		if (key === '__encounter-settings__') { this._renderEncounterSettings(); return; }
		if (key === '__menu-config__') { this._renderMenuConfiguration(); return; }
		if (key === '__calendar-colors__') { this._renderCalendarColors(); return; }

		// Codes is backed by /api/global_codes, not the FHIR endpoint — use a dedicated renderer
		if (key === 'codes') { this._renderCodes(); return; }

		// FHIR resource settings — generic list/form
		this._renderFhirSection(key);
	}

	// allow-any-unicode-next-line
	// ----------- FHIR Generic Section -----------

	private listBodyEl: HTMLElement | null = null;
	private practiceLogoData: string | null = null;
	private practiceLogoLoaded: boolean = false;

	private async _ensurePracticeLogo(): Promise<void> {
		if (this.practiceLogoLoaded) { return; }
		this.practiceLogoLoaded = true;
		try {
			const res = await this.apiService.fetch('/api/practice-logo');
			if (res.ok) {
				const json = await res.json();
				this.practiceLogoData = json?.data?.logoData || null;
			}
		} catch { /* ignore */ }
	}

	/**
	 * Patch known fields per tab so they render the right way in the workspace
	 * (matches the EHR UI's `patchSettingsFieldConfig` helper):
	 *   - referral-providers: organization → lookup against /api/fhir-resource/referral-practices
	 *     with auto-fill of phone / email / website / address from the chosen practice
	 *   - providers: photo → upload field (already handled by isPhotoKey detection)
	 */
	private _patchFieldConfig(tabKey: string, fc: FieldConfig): void {
		if (!fc.sections) { return; }
		const isRefProv = /referral-provider/i.test(tabKey);
		const isProvider = tabKey === 'providers' || tabKey === 'provider';
		if (!isRefProv && !isProvider) { return; }
		for (const section of fc.sections) {
			for (const f of section.fields) {
				const keyLower = f.key.toLowerCase();
				if (isRefProv && (f.key === 'organization' || f.key === 'organizationId' || f.key === 'affiliation' || f.key === 'organizationName' || /organ|affil/.test(keyLower))) {
					f.type = 'lookup';
					f.lookupConfig = f.lookupConfig?.endpoint ? f.lookupConfig : {
						endpoint: '/api/fhir-resource/referral-practices',
						displayField: 'name',
						valueField: 'name',
						searchable: true,
						autoFillFields: {
							phone: 'phone',
							fax: 'fax',
							email: 'email',
							website: 'website',
							addressLine1: 'addressLine1',
							addressLine2: 'addressLine2',
							city: 'city',
							state: 'state',
							zip: 'zip',
						},
					};
				}
			}
		}
	}

	private _renderPracticeLogoPanel(parent: HTMLElement): void {
		const wrap = DOM.append(parent, DOM.$('.sh-logo-panel'));
		wrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;padding:16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;';

		const preview = DOM.append(wrap, DOM.$('div'));
		preview.style.cssText = 'width:120px;height:120px;border:2px dashed var(--vscode-editorWidget-border);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;background:var(--vscode-editor-background);';
		if (this.practiceLogoData) {
			const img = DOM.append(preview, DOM.$('img')) as HTMLImageElement;
			img.src = this.practiceLogoData;
			img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
		} else {
			const ph = DOM.append(preview, DOM.$('span'));
			ph.textContent = '\u{1F5BC}';
			ph.style.cssText = 'font-size:36px;opacity:0.4;';
		}

		const info = DOM.append(wrap, DOM.$('div'));
		info.style.cssText = 'flex:1;';
		const lbl = DOM.append(info, DOM.$('div'));
		lbl.textContent = 'Practice Logo';
		lbl.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:4px;';
		const desc = DOM.append(info, DOM.$('div'));
		desc.textContent = 'Upload your practice logo. It will appear on printed documents and reports. Max 2MB, PNG / JPG / SVG.';
		desc.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:12px;';

		const actions = DOM.append(info, DOM.$('div'));
		actions.style.cssText = 'display:flex;gap:8px;';

		const fileInput = DOM.append(info, DOM.$('input')) as HTMLInputElement;
		fileInput.type = 'file';
		fileInput.accept = 'image/*';
		fileInput.style.display = 'none';
		fileInput.addEventListener('change', () => this._uploadLogo(fileInput));

		const uploadBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		uploadBtn.textContent = '\u{2B06} Upload';
		uploadBtn.style.cssText = 'padding:5px 12px;background:transparent;border:1px solid var(--vscode-button-border,var(--vscode-input-border,#3c3c3c));border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		uploadBtn.addEventListener('click', () => fileInput.click());

		if (this.practiceLogoData) {
			const removeBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			removeBtn.textContent = '\u{1F5D1} Remove';
			removeBtn.style.cssText = 'padding:5px 12px;background:transparent;border:1px solid var(--vscode-errorForeground,#f48771);border-radius:4px;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:12px;';
			removeBtn.addEventListener('click', () => this._removeLogo());
		}
	}

	private async _uploadLogo(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		if (!file) { return; }
		if (file.size > 2 * 1024 * 1024) {
			this.notificationService.notify({ severity: Severity.Error, message: 'Logo must be under 2MB.' });
			return;
		}
		try {
			const formData = new FormData();
			formData.append('file', file);
			const url = `${this.apiService.apiUrl}/api/practice-logo`;
			const token = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_token') : '') || '';
			const tenant = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') : '') || '';
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					...(tenant ? { 'X-Tenant-Name': tenant } : {}),
				},
				body: formData,
			});
			if (res.ok) {
				const json = await res.json();
				this.practiceLogoData = json?.data?.logoData || null;
				this._renderContent();
				this.notificationService.notify({ severity: Severity.Info, message: 'Practice logo uploaded.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Upload failed (${res.status}).` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Upload failed: ${e}` });
		}
	}

	private async _removeLogo(): Promise<void> {
		try {
			await this.apiService.fetch('/api/practice-logo', { method: 'DELETE' });
			this.practiceLogoData = null;
			this._renderContent();
		} catch { /* ignore */ }
	}

	private async _renderFhirSection(tabKey: string): Promise<void> {
		// Show a loading state
		const wrap = DOM.append(this.contentEl, DOM.$('div'));
		wrap.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';
		const loadEl = DOM.append(wrap, DOM.$('div'));
		loadEl.textContent = 'Loading\u2026';
		loadEl.style.cssText = 'color:var(--vscode-descriptionForeground);';

		// Load tab config if missing
		if (!this.currentConfig || this.currentConfig.tabKey !== tabKey) {
			try {
				const res = await this.apiService.fetch(`/api/tab-field-config/${encodeURIComponent(tabKey)}`);
				if (res.ok) {
					const json = await res.json();
					const c: TabFieldConfig = json.data || json;
					this.currentConfig = c;
					this.currentFieldConfig = typeof c.fieldConfig === 'string'
						? JSON.parse(c.fieldConfig)
						: (c.fieldConfig as FieldConfig | undefined) || null;
					if (this.currentFieldConfig) {
						this._patchFieldConfig(tabKey, this.currentFieldConfig);
					}
				}
			} catch { /* fall through */ }
			await this._fetchFhirRecords(tabKey);
		}

		DOM.clearNode(this.contentEl);
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		// Practice tab: render logo upload panel above the form/list
		if (tabKey === 'practice') {
			await this._ensurePracticeLogo();
			this._renderPracticeLogoPanel(root);
		}

		// Header
		const header = DOM.append(root, DOM.$('.sh-fhir-header'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;';

		const left = DOM.append(header, DOM.$('div'));
		const title = DOM.append(left, DOM.$('h1'));
		const item = this.fhirItems.find(i => i.key === tabKey);
		title.textContent = item?.label || this._titleCase(tabKey);
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(left, DOM.$('p'));
		sub.textContent = `${this.totalElements} record${this.totalElements === 1 ? '' : 's'}`;
		sub.style.cssText = 'margin:0;font-size:13px;color:var(--vscode-descriptionForeground);';

		const right = DOM.append(header, DOM.$('div'));
		right.style.cssText = 'display:flex;gap:8px;align-items:center;';

		if (this.mode === 'list') {
			// Search
			const search = DOM.append(right, DOM.$('input')) as HTMLInputElement;
			search.type = 'search';
			search.placeholder = 'Search\u2026';
			search.value = this.searchTerm;
			search.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;width:220px;outline:none;';
			search.addEventListener('input', () => { this.searchTerm = search.value; this._renderListBody(root); });

			const addBtn = DOM.append(right, DOM.$('button')) as HTMLButtonElement;
			addBtn.textContent = '+ Add';
			addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			addBtn.addEventListener('click', () => { this.mode = 'create'; this.formData = {}; this.selectedRecord = null; this._renderContent(); });
		} else {
			const backBtn = DOM.append(right, DOM.$('button'));
			backBtn.textContent = '← Back to list';
			backBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
			backBtn.addEventListener('click', () => { this.mode = 'list'; this.validationErrors = {}; this._renderContent(); });
		}

		if (this.mode === 'list') {
			this._renderListBody(root);
		} else {
			this._renderFormBody(root);
		}
	}

	private async _fetchFhirRecords(tabKey: string): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/fhir-resource/${encodeURIComponent(tabKey)}?page=${this.page}&size=${this.pageSize}`);
			if (res.ok) {
				const json = await res.json();
				const payload = json.data || json;
				if (payload.content) {
					this.records = payload.content;
					this.totalElements = payload.totalElements || this.records.length;
				} else if (Array.isArray(payload)) {
					this.records = payload;
					this.totalElements = payload.length;
				} else {
					this.records = [];
					this.totalElements = 0;
				}
			}
		} catch { /* ignore */ }
	}

	private _renderListBody(root: HTMLElement): void {
		// Clear body but keep header
		if (this.listBodyEl && this.listBodyEl.parentElement === root) {
			this.listBodyEl.remove();
		}
		const body = DOM.append(root, DOM.$('.sh-list-body'));
		this.listBodyEl = body;

		// Determine columns
		const cols = this._tableColumns();
		const filtered = this.searchTerm
			? this.records.filter(r => Object.values(this._flatten(r)).some(v => (v !== null && v !== undefined) && String(v).toLowerCase().includes(this.searchTerm.toLowerCase())))
			: this.records;

		if (filtered.length === 0) {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = this.searchTerm ? 'No records match your search.' : 'No records yet. Click + Add to create one.';
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
			return;
		}

		const tableWrap = DOM.append(body, DOM.$('div'));
		tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const table = DOM.append(tableWrap, DOM.$('table'));
		table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

		// Header row
		const thead = DOM.append(table, DOM.$('thead'));
		const tr = DOM.append(thead, DOM.$('tr'));
		tr.style.cssText = 'background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
		for (const col of cols) {
			const th = DOM.append(tr, DOM.$('th'));
			th.textContent = col.label;
			th.style.cssText = 'padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
		}
		const thActions = DOM.append(tr, DOM.$('th'));
		thActions.textContent = '';
		thActions.style.cssText = 'padding:10px 12px;width:160px;';

		// Body rows
		const tbody = DOM.append(table, DOM.$('tbody'));
		for (const r of filtered) {
			const flat = this._flatten(r);
			const row = DOM.append(tbody, DOM.$('tr'));
			row.style.cssText = 'border-bottom:1px solid rgba(128,128,128,0.1);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			for (const col of cols) {
				const td = DOM.append(row, DOM.$('td'));
				td.textContent = this._formatValue(flat[col.key]);
				td.style.cssText = 'padding:10px 12px;';
			}

			const actionsTd = DOM.append(row, DOM.$('td'));
			actionsTd.style.cssText = 'padding:10px 12px;text-align:right;white-space:nowrap;';

			this._tableAction(actionsTd, '\u{1F441}', 'View', () => { this._openRecord(r, 'view'); });
			this._tableAction(actionsTd, '\u270F', 'Edit', () => { this._openRecord(r, 'edit'); });
			this._tableAction(actionsTd, '\u{1F5D1}', 'Delete', () => { this._deleteRecord(r); }, 'danger');
		}

		// Pagination — always rendered (even single page) so users see the
		// total record count and can adjust page size. Team report v4
		// specifically requested "pagination for all" tabs.
		const totalPages = Math.max(1, Math.ceil(this.totalElements / this.pageSize));
		const pag = DOM.append(body, DOM.$('div'));
		pag.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;gap:8px;';

		const leftCol = DOM.append(pag, DOM.$('div'));
		leftCol.style.cssText = 'display:flex;align-items:center;gap:14px;';
		const info = DOM.append(leftCol, DOM.$('span'));
		const startIdx = this.totalElements === 0 ? 0 : this.page * this.pageSize + 1;
		const endIdx = Math.min(this.totalElements, (this.page + 1) * this.pageSize);
		info.textContent = `${startIdx}\u2013${endIdx} of ${this.totalElements}`;
		info.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

		const sizeLbl = DOM.append(leftCol, DOM.$('label'));
		sizeLbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--vscode-descriptionForeground);';
		const sizeTxt = DOM.append(sizeLbl, DOM.$('span'));
		sizeTxt.textContent = 'Rows per page:';
		const sizeSel = DOM.append(sizeLbl, DOM.$('select')) as HTMLSelectElement;
		sizeSel.style.cssText = 'padding:3px 6px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-dropdown-foreground);font-size:11px;cursor:pointer;';
		for (const sz of [10, 25, 50, 100]) {
			const o = DOM.append(sizeSel, DOM.$('option')) as HTMLOptionElement;
			o.value = String(sz);
			o.textContent = String(sz);
			if (sz === this.pageSize) { o.selected = true; }
		}
		sizeSel.addEventListener('change', async () => {
			this.pageSize = Number(sizeSel.value);
			this.page = 0;
			await this._fetchFhirRecords(this.activeKey);
			this._renderContent();
		});

		const ctrls = DOM.append(pag, DOM.$('div'));
		ctrls.style.cssText = 'display:flex;gap:6px;align-items:center;';
		const pageLbl = DOM.append(ctrls, DOM.$('span'));
		pageLbl.textContent = `Page ${this.page + 1} of ${totalPages}`;
		pageLbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-right:8px;';
		const prev = DOM.append(ctrls, DOM.$('button')) as HTMLButtonElement;
		prev.textContent = '\u2190 Prev';
		prev.disabled = this.page === 0;
		prev.style.cssText = `padding:5px 10px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:${this.page === 0 ? 'not-allowed' : 'pointer'};font-size:11px;opacity:${this.page === 0 ? '0.4' : '1'};`;
		prev.addEventListener('click', async () => { if (this.page === 0) { return; } this.page--; await this._fetchFhirRecords(this.activeKey); this._renderContent(); });
		const next = DOM.append(ctrls, DOM.$('button')) as HTMLButtonElement;
		next.textContent = 'Next \u2192';
		next.disabled = this.page >= totalPages - 1;
		next.style.cssText = `padding:5px 10px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:${this.page >= totalPages - 1 ? 'not-allowed' : 'pointer'};font-size:11px;opacity:${this.page >= totalPages - 1 ? '0.4' : '1'};`;
		next.addEventListener('click', async () => { if (this.page >= totalPages - 1) { return; } this.page++; await this._fetchFhirRecords(this.activeKey); this._renderContent(); });
	}

	private _tableAction(parent: HTMLElement, icon: string, title: string, fn: () => void, kind: 'normal' | 'danger' = 'normal'): void {
		// Use a CSS class with :hover so the background only paints while the
		// cursor is actually inside the button. Previously the JS mouseenter /
		// mouseleave pair could leave the button "stuck" with the hover bg
		// (e.g. when a click took focus away or the cursor exited via the
		// button edge without firing mouseleave). The team report flagged this
		// as "hover state sticks".
		this._ensureActionStyles();
		const btn = DOM.append(parent, DOM.$('button'));
		btn.className = kind === 'danger' ? 'sh-action-btn sh-action-btn-danger' : 'sh-action-btn';
		btn.textContent = icon;
		btn.title = title;
		btn.addEventListener('click', () => fn());
	}

	private _stylesInjected = false;
	private _fontSizeStyleInjected = false;
	private _ensureActionStyles(): void {
		if (this._stylesInjected) { return; }
		this._stylesInjected = true;
		const style = mainWindow.document.createElement('style');
		style.textContent = `
			.sh-action-btn { background: transparent; border: none; cursor: pointer; color: var(--vscode-foreground); opacity: 0.7; font-size: 13px; padding: 3px 8px; margin-left: 2px; border-radius: 3px; transition: background-color 0.08s, opacity 0.08s; }
			.sh-action-btn-danger { color: var(--vscode-errorForeground, #f48771); }
			.sh-action-btn:hover { background-color: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); opacity: 1; }
			.sh-action-btn:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
		`;
		mainWindow.document.head.appendChild(style);
	}

	private _tableColumns(): { key: string; label: string }[] {
		const cols: { key: string; label: string }[] = [];
		const fc = this.currentFieldConfig;
		if (fc?.sections?.length) {
			const hasShowInTable = fc.sections.some(s => s.fields.some(f => f.showInTable));
			for (const s of fc.sections) {
				for (const f of s.fields) {
					if (f.type === 'group' || f.type === 'computed' || f.type === 'textarea' || f.type === 'address') { continue; }
					if (hasShowInTable && !f.showInTable) { continue; }
					cols.push({ key: f.key, label: f.label });
					if (cols.length >= 6) { return cols; }
				}
			}
			if (cols.length > 0) { return cols; }
		}
		// Auto-detect from first record
		if (this.records.length > 0) {
			const first = this._flatten(this.records[0]);
			const skip = new Set(['id', 'fhirId', 'orgAlias', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'resourceType', 'meta']);
			for (const k of Object.keys(first)) {
				if (skip.has(k)) { continue; }
				const v = first[k];
				if (v && typeof v === 'object') { continue; }
				cols.push({ key: k, label: this._titleCase(k.replace(/\./g, ' ')) });
				if (cols.length >= 6) { break; }
			}
		}
		return cols;
	}

	private _openRecord(r: Record<string, unknown>, mode: Mode): void {
		this.selectedRecord = r;
		this.formData = { ...r, ...this._flatten(r) };
		this.mode = mode;
		this.validationErrors = {};
		this._renderContent();
	}

	private async _deleteRecord(r: Record<string, unknown>): Promise<void> {
		const id = (r as { id?: string; fhirId?: string }).id || (r as { fhirId?: string }).fhirId;
		if (!id) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Record has no ID \u2014 cannot delete.' });
			return;
		}
		const { confirmed } = await this.dialogService.confirm({ message: 'Delete this record? This cannot be undone.' });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/fhir-resource/${encodeURIComponent(this.activeKey)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
			if (res.ok) {
				await this._fetchFhirRecords(this.activeKey);
				this._renderContent();
				this.notificationService.notify({ severity: Severity.Info, message: 'Record deleted.' });
			} else {
				const err = await res.json().catch(() => null);
				this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Delete failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	// allow-any-unicode-next-line
	// ----------- Form rendering -----------

	private _renderFormBody(root: HTMLElement): void {
		const wrap = DOM.append(root, DOM.$('div'));
		wrap.style.cssText = 'background:var(--vscode-editor-background);';

		const fc = this.currentFieldConfig;
		const isView = this.mode === 'view';

		if (!fc?.sections?.length) {
			const note = DOM.append(wrap, DOM.$('div'));
			note.textContent = 'No field configuration defined for this resource. Edit the JSON directly via the API.';
			note.style.cssText = 'padding:24px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
			return;
		}

		for (const section of fc.sections) {
			const panel = DOM.append(wrap, DOM.$('.sh-form-panel'));
			panel.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:16px;overflow:hidden;';

			const head = DOM.append(panel, DOM.$('div'));
			head.style.cssText = 'padding:10px 16px;background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
			const ht = DOM.append(head, DOM.$('h3'));
			ht.textContent = section.label || this._titleCase(section.key || '');
			ht.style.cssText = 'margin:0;font-size:13px;font-weight:600;';

			const body = DOM.append(panel, DOM.$('div'));
			body.style.cssText = 'padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px;';

			for (const field of section.fields) {
				if (field.type === 'group') { continue; }
				this._renderField(body, field, isView);
			}
		}

		// Action bar
		const actions = DOM.append(wrap, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;';

		// Left side \u2014 Availability shortcut for provider records (edit/view, with id)
		const leftActions = DOM.append(actions, DOM.$('div'));
		leftActions.style.cssText = 'display:flex;gap:8px;';
		const isProvider = this.activeKey === 'providers' || this.activeKey === 'provider';
		const recId = this.selectedRecord ? ((this.selectedRecord as { id?: string; fhirId?: string }).id || (this.selectedRecord as { fhirId?: string }).fhirId) : null;
		if (isProvider && recId && this.mode !== 'create') {
			const availBtn = DOM.append(leftActions, DOM.$('button')) as HTMLButtonElement;
			availBtn.textContent = '\u{1F4C5} Manage Availability';
			availBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
			availBtn.addEventListener('click', () => this._openProviderAvailabilityModal(String(recId)));
		}

		const rightActions = DOM.append(actions, DOM.$('div'));
		rightActions.style.cssText = 'display:flex;gap:8px;';

		if (!isView) {
			const cancel = DOM.append(rightActions, DOM.$('button')) as HTMLButtonElement;
			cancel.textContent = 'Cancel';
			cancel.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
			cancel.addEventListener('click', () => { this.mode = 'list'; this.validationErrors = {}; this._renderContent(); });

			const save = DOM.append(rightActions, DOM.$('button')) as HTMLButtonElement;
			save.textContent = this.saving ? 'Saving\u2026' : (this.mode === 'create' ? 'Create' : 'Save');
			save.disabled = this.saving;
			save.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			save.addEventListener('click', () => this._saveRecord());
		}
	}

	/**
	 * Open a modal to manage a provider's availability schedule.
	 * Mirrors the ProviderAvailabilityEditor from the EHR Web UI:
	 *   - Lists current availability blocks for this provider
	 *   - Lets admins add/edit/delete blocks with day-of-week + start/end + location
	 *   - Backed by /api/providers/{providerId}/availability
	 *
	 * Without provider availability set, appointments cannot be scheduled \u2014 this
	 * unblocks the high-priority issue called out in the team test report.
	 */
	private async _openProviderAvailabilityModal(providerId: string, onSaved?: () => void): Promise<void> {
		const overlay = DOM.append(this.contentEl, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:720px;max-width:94vw;max-height:88vh;overflow-y:auto;padding:22px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = 'Provider Availability';
		ht.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const desc = DOM.append(modal, DOM.$('p'));
		desc.textContent = 'Set the days and times this provider is available for appointments. Required before patients can book.';
		desc.style.cssText = 'margin:0 0 14px;font-size:12px;color:var(--vscode-descriptionForeground);';

		const blocksWrap = DOM.append(modal, DOM.$('div'));
		blocksWrap.style.cssText = 'margin-bottom:16px;';

		interface AvailabilityBlock {
			id?: string;
			fhirId?: string;
			daysOfWeek: string[];
			startTime: string;
			endTime: string;
			locationId?: string;
		}
		let blocks: AvailabilityBlock[] = [];

		const DAYS: Array<[string, string]> = [
			['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'], ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun'],
		];

		const renderBlocks = (): void => {
			DOM.clearNode(blocksWrap);
			if (blocks.length === 0) {
				const empty = DOM.append(blocksWrap, DOM.$('div'));
				empty.textContent = 'No availability blocks. Add one to define when this provider can be booked.';
				empty.style.cssText = 'padding:24px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:6px;font-size:12px;';
				return;
			}
			blocks.forEach((block, idx) => {
				const row = DOM.append(blocksWrap, DOM.$('div'));
				row.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:12px;font-size:12px;';
				const days = DOM.append(row, DOM.$('div'));
				const dayNames = (block.daysOfWeek || []).map(d => DAYS.find(([c]) => c === d)?.[1] || d).join(', ');
				days.textContent = dayNames || '(no days)';
				days.style.cssText = 'flex:1;font-weight:500;';
				const time = DOM.append(row, DOM.$('div'));
				time.textContent = `${block.startTime || '?'} \u2013 ${block.endTime || '?'}`;
				time.style.cssText = 'color:var(--vscode-descriptionForeground);';
				const delBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
				delBtn.textContent = '\u{1F5D1}';
				delBtn.title = 'Remove block';
				delBtn.style.cssText = 'background:transparent;border:none;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:14px;padding:2px 6px;';
				delBtn.addEventListener('click', () => { blocks.splice(idx, 1); renderBlocks(); });
			});
		};

		// Add block form
		const addForm = DOM.append(modal, DOM.$('div'));
		addForm.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:12px 14px;margin-bottom:14px;background:rgba(0,122,204,0.04);';
		const addTitle = DOM.append(addForm, DOM.$('div'));
		addTitle.textContent = 'Add a block';
		addTitle.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';

		const daysRow = DOM.append(addForm, DOM.$('div'));
		daysRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;';
		const selectedDays = new Set<string>(['MO', 'TU', 'WE', 'TH', 'FR']);
		for (const [code, label] of DAYS) {
			const b = DOM.append(daysRow, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			const update = (): void => {
				const sel = selectedDays.has(code);
				b.style.cssText = `padding:4px 10px;border-radius:14px;border:1px solid ${sel ? 'var(--vscode-focusBorder)' : 'var(--vscode-input-border,#3c3c3c)'};background:${sel ? 'var(--vscode-focusBorder)' : 'transparent'};color:${sel ? '#fff' : 'var(--vscode-foreground)'};cursor:pointer;font-size:11px;`;
			};
			update();
			b.addEventListener('click', () => {
				if (selectedDays.has(code)) { selectedDays.delete(code); }
				else { selectedDays.add(code); }
				update();
			});
		}

		const timeRow = DOM.append(addForm, DOM.$('div'));
		timeRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;';
		const startInp = DOM.append(timeRow, DOM.$('input')) as HTMLInputElement;
		startInp.type = 'time';
		startInp.value = '09:00';
		startInp.style.cssText = 'padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
		const toLbl = DOM.append(timeRow, DOM.$('span'));
		toLbl.textContent = 'to';
		toLbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const endInp = DOM.append(timeRow, DOM.$('input')) as HTMLInputElement;
		endInp.type = 'time';
		endInp.value = '17:00';
		endInp.style.cssText = 'padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		const addBtn = DOM.append(addForm, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add Block';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
		addBtn.addEventListener('click', () => {
			if (selectedDays.size === 0) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Select at least one day.' });
				return;
			}
			if (!startInp.value || !endInp.value) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Start and end time required.' });
				return;
			}
			blocks.push({ daysOfWeek: Array.from(selectedDays), startTime: startInp.value, endTime: endInp.value });
			renderBlocks();
		});

		const footer = DOM.append(modal, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;';
		const cancelBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());

		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Save Availability';
		saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving\u2026';
			try {
				// Backend expects List<ScheduleDto> directly (NOT { blocks: [...] } \u2014
				// that caused the "Cannot deserialize ArrayList<ScheduleDto> from
				// Object value" 500 the team reported). Each block maps a
				// recurring weekly availability window to a ScheduleDto whose
				// recurrence carries the day-of-week, time, and providerId.
				const payload = blocks.map(b => ({
					providerId: Number(providerId) || undefined,
					fhirId: b.fhirId || undefined,
					actorReferences: [`Practitioner/${providerId}`, ...(b.locationId ? [`Location/${b.locationId}`] : [])],
					status: 'active',
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					recurrence: {
						frequency: 'WEEKLY',
						interval: 1,
						byWeekday: b.daysOfWeek,
						startTime: b.startTime,
						endTime: b.endTime,
						locationId: b.locationId,
					},
				}));
				const res = await this.apiService.fetch(`/api/providers/${encodeURIComponent(providerId)}/availability`, {
					method: 'PUT',
					body: JSON.stringify(payload),
				});
				if (res.ok) {
					this.notificationService.notify({ severity: Severity.Info, message: 'Availability saved.' });
					overlay.remove();
					if (onSaved) { onSaved(); }
				} else {
					const txt = await res.text().catch(() => '');
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}). ${txt.substring(0, 200)}` });
					saveBtn.disabled = false;
					saveBtn.textContent = 'Save Availability';
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				saveBtn.disabled = false;
				saveBtn.textContent = 'Save Availability';
			}
		});

		// Load existing \u2014 backend returns List<ScheduleDto> wrapped in ApiResponse{data: [...]}.
		// Each ScheduleDto has a `recurrence` with byWeekday + startTime + endTime that we
		// flatten back into the simpler block model the modal renders.
		try {
			const res = await this.apiService.fetch(`/api/providers/${encodeURIComponent(providerId)}/availability`);
			if (res.ok) {
				const json = await res.json();
				const list: Array<Record<string, unknown>> = (json?.data as Array<Record<string, unknown>>) || (Array.isArray(json) ? json : []);
				blocks = list.map(b => {
					const rec = (b.recurrence as Record<string, unknown>) || {};
					return {
						id: (b.id as string) || (b.fhirId as string),
						fhirId: b.fhirId as string,
						daysOfWeek: ((rec.byWeekday as string[]) || (b.daysOfWeek as string[]) || []),
						startTime: (rec.startTime as string) || (b.startTime as string) || '',
						endTime: (rec.endTime as string) || (b.endTime as string) || '',
						locationId: (rec.locationId as string) || (b.locationId as string | undefined),
					};
				});
			}
		} catch { /* ignore \u2014 start with empty */ }
		renderBlocks();

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
	}

	private _renderField(parent: HTMLElement, field: FieldDef, isView: boolean): void {
		const span = field.type === 'textarea' || field.type === 'address' ? 2 : 1;
		const cell = DOM.append(parent, DOM.$('div'));
		cell.style.cssText = `grid-column:span ${span};`;

		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const lblText = DOM.append(lbl, DOM.$('span'));
		lblText.textContent = field.label;
		if (field.required) {
			const req = DOM.append(lbl, DOM.$('span'));
			req.textContent = ' *';
			req.style.color = 'var(--vscode-errorForeground,#f48771)';
		}

		const value = this.formData[field.key];
		const error = this.validationErrors[field.key];

		const inputStyle = `width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid ${error ? 'var(--vscode-errorForeground,#f48771)' : 'var(--vscode-input-border,#3c3c3c)'};border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;`;

		const t = field.type || 'text';

		// Special: active/isActive/enabled fields → toggle button
		const isActiveKey = field.key === 'active' || field.key === 'isActive' || field.key === 'enabled';
		if (isActiveKey && t !== 'boolean' && t !== 'checkbox' && t !== 'switch') {
			const isEnabled = value === true || value === 'true' || value === 1 || (value !== false && value !== 'false' && value !== 0 && value !== null && value !== undefined && value !== '');
			const wrap = DOM.append(cell, DOM.$('div'));
			wrap.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 0;';
			const sw = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
			let swVal = isEnabled;
			const updateSw = (v: boolean) => {
				sw.style.cssText = `position:relative;width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;background:${v ? '#22c55e' : 'rgba(128,128,128,0.4)'};transition:background 120ms;flex-shrink:0;`;
				DOM.clearNode(sw);
				const knob = DOM.append(sw, DOM.$('span'));
				knob.style.cssText = `position:absolute;top:3px;${v ? 'right:3px;' : 'left:3px;'}width:16px;height:16px;border-radius:50%;background:#fff;transition:right 120ms,left 120ms;`;
			};
			updateSw(swVal);
			if (!isView && !field.readOnly) {
				sw.addEventListener('click', () => { swVal = !swVal; updateSw(swVal); this.formData[field.key] = swVal; });
			} else {
				sw.disabled = true;
			}
			const statusLbl = DOM.append(wrap, DOM.$('span'));
			statusLbl.textContent = isEnabled ? 'Active' : 'Inactive';
			statusLbl.style.cssText = `font-size:12px;color:${isEnabled ? '#22c55e' : 'var(--vscode-descriptionForeground)'};font-weight:500;`;
			if (error) {
				const e = DOM.append(cell, DOM.$('div'));
				e.textContent = error;
				e.style.cssText = 'font-size:11px;color:var(--vscode-errorForeground,#f48771);margin-top:4px;';
			}
			return;
		}

		// Special: photo/photoUrl/avatar/image/logo fields → file upload with preview.
		// Detection is permissive: matches by key (any common variant) or by explicit
		// field.type ('photo' | 'image' | 'upload' | 'file'). Without this any custom
		// tab_field_config that uses keys like `providerPhoto`, `avatarUrl`, `profilePic`,
		// `headshot`, `signature` etc. would render as a plain text field.
		const keyLower = field.key.toLowerCase();
		const photoKeys = ['photo', 'photourl', 'logo', 'logourl', 'image', 'imageurl', 'avatar', 'avatarurl', 'picture', 'pictureurl', 'profilepic', 'profilepicture', 'headshot', 'signature', 'signatureurl'];
		const isPhotoKey = photoKeys.includes(keyLower)
			|| /photo|image|logo|avatar|picture|headshot|signature/i.test(field.key)
			|| t === 'photo' || t === 'image' || t === 'upload' || t === 'file';
		if (isPhotoKey) {
			const wrap = DOM.append(cell, DOM.$('div'));
			wrap.style.cssText = 'display:flex;align-items:flex-start;gap:12px;';

			const preview = DOM.append(wrap, DOM.$('div'));
			preview.style.cssText = 'width:80px;height:80px;border:2px dashed var(--vscode-editorWidget-border);border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--vscode-editor-background);flex-shrink:0;';

			const renderPreview = (src: string): void => {
				DOM.clearNode(preview);
				if (src) {
					const img = DOM.append(preview, DOM.$('img')) as HTMLImageElement;
					img.src = src;
					img.style.cssText = 'max-width:100%;max-height:100%;object-fit:cover;';
					img.onerror = () => {
						DOM.clearNode(preview);
						const ph = DOM.append(preview, DOM.$('span'));
						ph.textContent = '\u{1F5BC}';
						ph.style.cssText = 'font-size:28px;opacity:0.4;';
					};
				} else {
					const ph = DOM.append(preview, DOM.$('span'));
					ph.textContent = '\u{1F5BC}';
					ph.style.cssText = 'font-size:28px;opacity:0.4;';
				}
			};
			const initial = (value as string) || '';
			renderPreview(initial);

			const controls = DOM.append(wrap, DOM.$('div'));
			controls.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px;';

			if (!isView && !field.readOnly) {
				const fileInput = DOM.append(controls, DOM.$('input')) as HTMLInputElement;
				fileInput.type = 'file';
				fileInput.accept = 'image/*';
				fileInput.style.cssText = 'font-size:11px;color:var(--vscode-foreground);padding:4px 0;';
				fileInput.addEventListener('change', () => {
					const file = fileInput.files?.[0];
					if (!file) { return; }
					if (file.size > 5 * 1024 * 1024) {
						this.notificationService.notify({ severity: Severity.Error, message: 'Image must be under 5MB.' });
						fileInput.value = '';
						return;
					}
					const reader = new FileReader();
					reader.onload = () => {
						const dataUrl = reader.result as string;
						this.formData[field.key] = dataUrl;
						renderPreview(dataUrl);
					};
					reader.readAsDataURL(file);
				});

				// Optional URL input (alternative to file upload)
				const urlLbl = DOM.append(controls, DOM.$('div'));
				urlLbl.textContent = 'Or paste URL:';
				urlLbl.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
				const urlInp = DOM.append(controls, DOM.$('input')) as HTMLInputElement;
				urlInp.type = 'url';
				urlInp.value = initial.startsWith('data:') ? '' : initial;
				urlInp.placeholder = 'https://…';
				urlInp.style.cssText = inputStyle;
				urlInp.addEventListener('input', () => {
					this.formData[field.key] = urlInp.value;
					renderPreview(urlInp.value);
				});
			} else {
				const urlEl = DOM.append(controls, DOM.$('span'));
				urlEl.textContent = initial && !initial.startsWith('data:') ? initial : (initial ? '(uploaded image)' : '-');
				urlEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);word-break:break-all;';
			}
			if (error) {
				const e = DOM.append(cell, DOM.$('div'));
				e.textContent = error;
				e.style.cssText = 'font-size:11px;color:var(--vscode-errorForeground,#f48771);margin-top:4px;';
			}
			return;
		}

		// Special: Provider Availability field — show a summary of the saved
		// schedule blocks (Mon-Fri 9-5, etc.) plus a Manage Availability button
		// that opens the modal editor. Without this the FHIR provider's
		// `availability` field rendered as an empty input even when blocks
		// existed in the backend (per team report v3/v4).
		//
		// Detection is permissive — match by tab + field.key OR field.label
		// OR field.type so any custom field config that names this column
		// "availability_blocks", "Availability", "schedule", etc. all hit
		// the same renderer.
		const isProvider = this.activeKey === 'providers' || this.activeKey === 'provider';
		const isAvailabilityField = isProvider && (
			/availability|schedule/i.test(field.key)
			|| /availability|schedule/i.test(field.label || '')
			|| t === 'availability'
			|| t === 'schedule'
		);
		if (isAvailabilityField) {
			const wrap = DOM.append(cell, DOM.$('div'));
			wrap.style.cssText = `display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--vscode-input-background);border:1px solid ${error ? 'var(--vscode-errorForeground,#f48771)' : 'var(--vscode-input-border,#3c3c3c)'};border-radius:6px;min-height:60px;`;

			const summary = DOM.append(wrap, DOM.$('div'));
			summary.style.cssText = 'font-size:13px;color:var(--vscode-foreground);min-height:20px;';

			const recordId = this.selectedRecord ? ((this.selectedRecord as { id?: string | number }).id || (this.selectedRecord as { fhirId?: string }).fhirId) : null;

			// Show an immediate placeholder so the area is never blank — even if
			// the async API call hangs or the data structure differs from what
			// we expect, the user always sees something. The renderSummary
			// below replaces this with the real content.
			const placeholder = DOM.append(summary, DOM.$('span'));
			placeholder.textContent = recordId ? 'Loading availability…' : 'Save the provider first to manage availability.';
			placeholder.style.cssText = 'font-style:italic;color:var(--vscode-descriptionForeground);';
			const dayLabels: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
			const renderBlocks = (list: Array<Record<string, unknown>>): void => {
				DOM.clearNode(summary);
				if (list.length === 0) {
					const empty = DOM.append(summary, DOM.$('div'));
					empty.textContent = 'No availability blocks. Click "Manage Availability" to add one.';
					empty.style.cssText = 'font-style:italic;color:var(--vscode-descriptionForeground);padding:8px 0;';
					return;
				}
				// "Schedule Blocks" header matches the EHR Web UI exactly
				// (test-report v6 image showing Location/Active/Office Visit,
				// "Every week - Mon, Tue, Wed, Thu, Fri", 8:00 AM - 5:00 PM,
				// Effective dates, edit/delete actions per block).
				const header = DOM.append(summary, DOM.$('div'));
				header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
				const headerTitle = DOM.append(header, DOM.$('div'));
				headerTitle.textContent = 'Schedule Blocks';
				headerTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';
				const headerActions = DOM.append(header, DOM.$('div'));
				headerActions.style.cssText = 'display:flex;gap:6px;';
				const addBlockBtn = DOM.append(headerActions, DOM.$('button')) as HTMLButtonElement;
				addBlockBtn.textContent = '+ Add Block';
				addBlockBtn.style.cssText = 'padding:5px 12px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:11px;font-weight:500;';
				addBlockBtn.addEventListener('click', () => {
					if (!recordId) {
						this.notificationService.notify({ severity: Severity.Warning, message: 'Save the provider first to add a block.' });
						return;
					}
					this._openProviderAvailabilityModal(String(recordId), () => { void renderSummary(); });
				});

				const blocksWrap = DOM.append(summary, DOM.$('div'));
				blocksWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

				for (const b of list) {
					const rec = (b.recurrence as Record<string, unknown>) || {};
					const days: string[] = ((rec.byWeekday as string[]) || (b.daysOfWeek as string[]) || []).map(d => dayLabels[d] || d);
					const start = (rec.startTime as string) || (b.startTime as string) || '?';
					const end = (rec.endTime as string) || (b.endTime as string) || '?';
					const isActive = String(b.status || 'active').toLowerCase() === 'active';
					const locationRef = (rec.locationId as string) || (b.locationId as string) || '';
					const startDate = (rec.startDate as string) || (b.start as string) || '';
					const endDate = (rec.endDate as string) || (b.end as string) || '';
					const frequency = (rec.frequency as string) || 'WEEKLY';

					const card = DOM.append(blocksWrap, DOM.$('div'));
					card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:10px 12px;background:var(--vscode-editor-background);';

					// Row 1: Location + Active badge + visit type
					const row1 = DOM.append(card, DOM.$('div'));
					row1.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
					const locIcon = DOM.append(row1, DOM.$('span'));
					locIcon.textContent = '\u{1F4CD}';
					locIcon.style.cssText = 'font-size:12px;opacity:0.7;';
					const locTxt = DOM.append(row1, DOM.$('span'));
					locTxt.textContent = locationRef ? `Location #${locationRef}` : 'No location';
					locTxt.style.cssText = 'font-size:12px;font-weight:500;color:var(--vscode-foreground);';
					if (isActive) {
						const badge = DOM.append(row1, DOM.$('span'));
						badge.textContent = '● Active';
						badge.style.cssText = 'font-size:10px;color:#22c55e;font-weight:500;display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:rgba(34,197,94,0.15);border-radius:10px;';
					}
					if (b.serviceType || b.serviceCategory) {
						const svc = DOM.append(row1, DOM.$('span'));
						svc.textContent = String(b.serviceType || b.serviceCategory);
						svc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
					}

					// Row 2: Day pattern (calendar icon)
					const row2 = DOM.append(card, DOM.$('div'));
					row2.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
					const calIcon = DOM.append(row2, DOM.$('span'));
					calIcon.textContent = '\u{1F4C5}';
					calIcon.style.cssText = 'font-size:11px;opacity:0.7;';
					const daysTxt = DOM.append(row2, DOM.$('span'));
					const recurrenceWord = frequency === 'DAILY' ? 'Every day' : (frequency === 'MONTHLY' ? 'Every month' : 'Every week');
					daysTxt.textContent = `${recurrenceWord} · ${days.join(', ') || '(no days)'}`;
					daysTxt.style.cssText = 'font-size:11px;color:var(--vscode-foreground);';

					// Row 3: Time (clock icon)
					const row3 = DOM.append(card, DOM.$('div'));
					row3.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
					const clockIcon = DOM.append(row3, DOM.$('span'));
					clockIcon.textContent = '\u{1F552}';
					clockIcon.style.cssText = 'font-size:11px;opacity:0.7;';
					const timeTxt = DOM.append(row3, DOM.$('span'));
					timeTxt.textContent = `${start} - ${end}`;
					timeTxt.style.cssText = 'font-size:11px;color:var(--vscode-foreground);';

					// Row 4: Effective dates (only when set)
					if (startDate || endDate) {
						const row4 = DOM.append(card, DOM.$('div'));
						row4.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';
						const fmt = (s: string): string => s ? (s.length >= 10 ? s.substring(0, 10) : s) : '';
						row4.textContent = `Effective: ${fmt(startDate) || '—'} — ${fmt(endDate) || '—'}`;
					}
				}
			};
			const renderSummary = async (): Promise<void> => {
				DOM.clearNode(summary);
				if (!recordId) {
					const note = DOM.append(summary, DOM.$('span'));
					note.textContent = 'Save the provider first to manage availability.';
					note.style.fontStyle = 'italic';
					return;
				}
				// If the form record already has availability blocks attached
				// (some backends embed them in the provider record itself),
				// render those immediately so the user sees the data even
				// before the GET round-trips. The async API call below will
				// overwrite this with the authoritative server state.
				const embedded = this.formData[field.key] as unknown;
				if (Array.isArray(embedded) && embedded.length > 0) {
					renderBlocks(embedded as Array<Record<string, unknown>>);
				} else {
					const loading = DOM.append(summary, DOM.$('span'));
					loading.textContent = 'Loading availability…';
				}
				try {
					const r = await this.apiService.fetch(`/api/providers/${encodeURIComponent(String(recordId))}/availability`);
					if (!r.ok) {
						DOM.clearNode(summary);
						const err = DOM.append(summary, DOM.$('span'));
						err.textContent = `Unable to load availability (${r.status}).`;
						return;
					}
					const j = await r.json();
					const list: Array<Record<string, unknown>> = (j?.data as Array<Record<string, unknown>>) || (Array.isArray(j) ? j : []);
					renderBlocks(list);
				} catch (e) {
					DOM.clearNode(summary);
					const err = DOM.append(summary, DOM.$('span'));
					err.textContent = `Load failed: ${e}`;
					err.style.color = 'var(--vscode-errorForeground,#f48771)';
				}
			};
			void renderSummary();

			if (!isView && !field.readOnly) {
				const btn = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
				btn.textContent = '\u{1F4C5} Manage Availability';
				btn.style.cssText = 'align-self:flex-start;padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
				btn.addEventListener('click', () => {
					if (!recordId) {
						this.notificationService.notify({ severity: Severity.Warning, message: 'Save the provider first to set availability.' });
						return;
					}
					this._openProviderAvailabilityModal(String(recordId), () => { void renderSummary(); });
				});
			}
			if (error) {
				const e = DOM.append(cell, DOM.$('div'));
				e.textContent = error;
				e.style.cssText = 'font-size:11px;color:var(--vscode-errorForeground,#f48771);margin-top:4px;';
			}
			return;
		}

		if (t === 'textarea') {
			const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
			ta.value = ((value === null || value === undefined) ? '' : String(value));
			ta.rows = field.rows || 3;
			ta.placeholder = field.placeholder || '';
			ta.readOnly = isView || !!field.readOnly;
			ta.style.cssText = inputStyle + 'font-family:inherit;resize:vertical;';
			ta.addEventListener('input', () => { this.formData[field.key] = ta.value; });
		} else if (t === 'lookup' && field.lookupConfig?.endpoint) {
			this._renderLookupField(cell, field, value, isView, inputStyle);
		} else if (t === 'select' || t === 'enum' || (Array.isArray(field.options) && field.options.length > 0)) {
			const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
			sel.disabled = isView || !!field.readOnly;
			sel.style.cssText = inputStyle.replace('var(--vscode-input-background)', 'var(--vscode-dropdown-background,var(--vscode-input-background))') + 'cursor:pointer;';
			const placeholder = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			placeholder.value = '';
			placeholder.textContent = field.placeholder || '\u2014 Select \u2014';
			for (const o of field.options || []) {
				const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				if (typeof o === 'string') { opt.value = o; opt.textContent = o; }
				else { opt.value = o.value; opt.textContent = o.label; }
				if (String(value || '') === opt.value) { opt.selected = true; }
			}
			sel.addEventListener('change', () => { this.formData[field.key] = sel.value; });
		} else if (t === 'boolean' || t === 'checkbox' || t === 'switch') {
			const wrap = DOM.append(cell, DOM.$('label'));
			wrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;';
			const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = !!value;
			cb.disabled = isView || !!field.readOnly;
			cb.addEventListener('change', () => { this.formData[field.key] = cb.checked; });
			const span = DOM.append(wrap, DOM.$('span'));
			span.textContent = cb.checked ? 'Enabled' : 'Disabled';
			cb.addEventListener('change', () => { span.textContent = cb.checked ? 'Enabled' : 'Disabled'; });
		} else if (t === 'number') {
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = 'number';
			inp.value = (value === null || value === undefined) ? '' : String(value);
			inp.placeholder = field.placeholder || '';
			inp.readOnly = isView || !!field.readOnly;
			inp.style.cssText = inputStyle;
			inp.addEventListener('input', () => { this.formData[field.key] = inp.value === '' ? null : parseFloat(inp.value); });
		} else if (t === 'date') {
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = 'date';
			const v = (value as string | null) || '';
			inp.value = typeof v === 'string' && v.length >= 10 ? v.substring(0, 10) : '';
			inp.readOnly = isView || !!field.readOnly;
			inp.style.cssText = inputStyle;
			inp.addEventListener('input', () => { this.formData[field.key] = inp.value || null; });
		} else {
			const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
			inp.type = t === 'email' ? 'email' : t === 'phone' || t === 'tel' ? 'tel' : t === 'url' ? 'url' : 'text';
			inp.value = (value === null || value === undefined) ? '' : String(value);
			inp.placeholder = field.placeholder || '';
			inp.readOnly = isView || !!field.readOnly;
			inp.style.cssText = inputStyle;
			inp.addEventListener('input', () => { this.formData[field.key] = inp.value; });
		}

		if (error) {
			const e = DOM.append(cell, DOM.$('div'));
			e.textContent = error;
			e.style.cssText = 'font-size:11px;color:var(--vscode-errorForeground,#f48771);margin-top:4px;';
		}
	}

	/**
	 * Render a lookup (searchable dropdown) field. Used by Referral Provider's
	 * "organization" field — fetches Referral Practices and auto-fills contact
	 * info / address from the selected record.
	 */
	private _renderLookupField(cell: HTMLElement, field: FieldDef, value: unknown, isView: boolean, inputStyle: string): void {
		const cfg = field.lookupConfig!;
		const wrap = DOM.append(cell, DOM.$('div'));
		wrap.style.cssText = 'position:relative;';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		input.type = 'text';
		input.value = (value === null || value === undefined) ? '' : String(value);
		input.placeholder = field.placeholder || 'Search organizations…';
		input.readOnly = isView || !!field.readOnly;
		// Make the lookup field visually distinct from a plain text input —
		// adds a dropdown chevron + magnifier so users discover it's a picker.
		// This addresses the team report "Organization dropdown visibility/UI is unclear".
		input.style.cssText = inputStyle + 'padding-right:32px;cursor:pointer;';
		input.autocomplete = 'off';

		// Explicit dropdown chevron — overlaid as a sibling so the input remains
		// a plain text field but visually reads as a combobox. This is what
		// the team report flagged as missing on the Referral Provider page.
		const chevron = DOM.append(wrap, DOM.$('span'));
		chevron.textContent = '\u25BE';
		chevron.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--vscode-descriptionForeground);font-size:10px;';

		const dropdown = DOM.append(wrap, DOM.$('div'));
		// Brighter, more contrasted dropdown — the team report said the
		// dark-theme dropdown was "not visible clearly". White-ish bg works
		// in both light and dark themes; rows below get their own contrast.
		dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;background:var(--vscode-quickInput-background,var(--vscode-editor-background));border:1px solid var(--vscode-focusBorder,#0e639c);border-radius:6px;max-height:280px;overflow-y:auto;z-index:1000;display:none;box-shadow:0 12px 36px rgba(0,0,0,0.5);margin-top:4px;color:var(--vscode-foreground);';

		let results: Array<Record<string, unknown>> = [];
		let debounce: ReturnType<typeof setTimeout> | null = null;
		let loaded = false;

		const close = (): void => { dropdown.style.display = 'none'; };
		const open = (): void => { dropdown.style.display = 'block'; };

		const renderResults = (): void => {
			DOM.clearNode(dropdown);
			if (results.length === 0) {
				const none = DOM.append(dropdown, DOM.$('div'));
				none.textContent = input.value.trim() ? 'No results.' : 'Type to search…';
				none.style.cssText = 'padding:8px 10px;font-size:12px;color:var(--vscode-descriptionForeground);';
				return;
			}
			const displayField = cfg.displayField || 'name';
			for (const row of results) {
				const item = DOM.append(dropdown, DOM.$('div'));
				const display = (row as Record<string, unknown>)[displayField];
				const subBits: string[] = [];
				const city = (row as Record<string, unknown>)['city'];
				const state = (row as Record<string, unknown>)['state'];
				if (city) { subBits.push(String(city)); }
				if (state) { subBits.push(String(state)); }
				const phone = (row as Record<string, unknown>)['phone'];
				if (phone) { subBits.push(String(phone)); }

				item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid rgba(128,128,128,0.1);';
				const nameEl = DOM.append(item, DOM.$('div'));
				nameEl.textContent = display ? String(display) : '(no name)';
				nameEl.style.cssText = 'font-weight:500;';
				if (subBits.length > 0) {
					const subEl = DOM.append(item, DOM.$('div'));
					subEl.textContent = subBits.join(' · ');
					subEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px;';
				}
				item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; });
				item.addEventListener('mouseleave', () => { item.style.background = ''; });
				item.addEventListener('mousedown', e => {
					e.preventDefault();
					const valField = cfg.valueField || displayField;
					const v = (row as Record<string, unknown>)[valField];
					input.value = String(v ?? '');
					this.formData[field.key] = input.value;
					// Auto-fill mapped fields. Try multiple source-field name
					// variations so referral-practices that return phone as
					// "phoneNumber" / "telephone" / "phone.number" still cascade
					// into the form. Also flatten nested address objects.
					if (cfg.autoFillFields) {
						const flat = this._flatten(row);
						const lookups = (sourceKey: string): unknown => {
							const candidates = [
								sourceKey,
								sourceKey.toLowerCase(),
								`address.${sourceKey}`,
								`contactInfo.${sourceKey}`,
								`contact.${sourceKey}`,
							];
							for (const c of candidates) {
								const val = (row as Record<string, unknown>)[c] ?? flat[c];
								if (val !== undefined && val !== null && val !== '') { return val; }
							}
							// Common name variations
							const aliases: Record<string, string[]> = {
								phone: ['phoneNumber', 'telephone', 'tel', 'phone.number'],
								fax: ['faxNumber', 'fax.number'],
								email: ['emailAddress', 'mail'],
								website: ['websiteUrl', 'url', 'webSite'],
								addressLine1: ['address.line1', 'addressLine', 'street', 'street1'],
								addressLine2: ['address.line2', 'street2'],
								city: ['address.city'],
								state: ['address.state', 'province'],
								zip: ['address.zip', 'postalCode', 'zipCode', 'address.postalCode'],
							};
							for (const alias of (aliases[sourceKey] || [])) {
								const val = (row as Record<string, unknown>)[alias] ?? flat[alias];
								if (val !== undefined && val !== null && val !== '') { return val; }
							}
							return undefined;
						};
						for (const [target, source] of Object.entries(cfg.autoFillFields)) {
							const sourceVal = lookups(source);
							if (sourceVal !== undefined && sourceVal !== null) {
								this.formData[target] = sourceVal;
							}
						}
						this._renderContent();
					}
					close();
				});
			}
		};

		const load = async (term: string): Promise<void> => {
			try {
				const sep = cfg.endpoint!.includes('?') ? '&' : '?';
				const url = term.trim()
					? `${cfg.endpoint}${sep}search=${encodeURIComponent(term)}&size=20`
					: `${cfg.endpoint}${sep}size=20`;
				const res = await this.apiService.fetch(url);
				if (!res.ok) {
					results = [];
					renderResults();
					return;
				}
				const json = await res.json();
				const payload = json?.data || json;
				results = payload?.content || (Array.isArray(payload) ? payload : []);
				loaded = true;
				renderResults();
				open();
			} catch {
				results = [];
				renderResults();
			}
		};

		input.addEventListener('input', () => {
			this.formData[field.key] = input.value;
			if (debounce) { clearTimeout(debounce); }
			debounce = setTimeout(() => { void load(input.value); }, 200);
		});
		input.addEventListener('focus', () => {
			if (!loaded) { void load(''); }
			else { open(); }
		});
		input.addEventListener('blur', () => setTimeout(close, 200));
	}

	private async _saveRecord(): Promise<void> {
		// Required validation
		const errors: Record<string, string> = {};
		const fc = this.currentFieldConfig;
		if (fc?.sections) {
			for (const s of fc.sections) {
				for (const f of s.fields) {
					if (f.required) {
						const v = this.formData[f.key];
						if ((v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))) {
							errors[f.key] = `${f.label} is required`;
						}
					}
				}
			}
		}
		this.validationErrors = errors;
		if (Object.keys(errors).length > 0) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Please fill in required fields.' });
			this._renderContent();
			return;
		}

		this.saving = true;
		this._renderContent();
		try {
			const isEdit = this.mode === 'edit' && this.selectedRecord;
			const id = isEdit ? ((this.selectedRecord as { id?: string }).id || (this.selectedRecord as { fhirId?: string }).fhirId) : null;
			const url = isEdit
				? `/api/fhir-resource/${encodeURIComponent(this.activeKey)}/${encodeURIComponent(id || '')}`
				: `/api/fhir-resource/${encodeURIComponent(this.activeKey)}`;
			const method = isEdit ? 'PUT' : 'POST';
			const res = await this.apiService.fetch(url, { method, body: JSON.stringify(this.formData) });
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Saved.' });
				await this._fetchFhirRecords(this.activeKey);
				this.mode = 'list';
				this.formData = {};
				this.selectedRecord = null;
			} else {
				const err = await res.json().catch(() => null);
				this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
		this.saving = false;
		this._renderContent();
	}

	// allow-any-unicode-next-line
	// ----------- Built-in pages -----------

	private async _renderUsers(): Promise<void> {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
		const titleCol = DOM.append(header, DOM.$('div'));
		const title = DOM.append(titleCol, DOM.$('h1'));
		title.textContent = 'Users';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(titleCol, DOM.$('p'));
		sub.textContent = 'Manage user accounts, roles, and portal access.';
		sub.style.cssText = 'margin:0;color:var(--vscode-descriptionForeground);font-size:12px;';

		const headerRight = DOM.append(header, DOM.$('div'));
		headerRight.style.cssText = 'display:flex;gap:8px;align-items:center;';

		const searchInput = DOM.append(headerRight, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'search';
		searchInput.placeholder = 'Search users\u2026';
		searchInput.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;width:200px;outline:none;';

		const addBtn = DOM.append(headerRight, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add User';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		addBtn.addEventListener('click', () => this._showAddUserDialog(root));

		const loading = DOM.append(root, DOM.$('div'));
		loading.textContent = 'Loading users\u2026';
		loading.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';

		try {
			const res = await this.apiService.fetch('/api/admin/users?page=0&size=100');
			if (!res.ok) {
				const errText = await res.text().catch(() => '');
				loading.textContent = `Failed to load users (${res.status}). ${errText.substring(0, 200)}`;
				return;
			}
			const json = await res.json();
			const allList: Array<Record<string, unknown>> = Array.isArray(json?.data)
				? json.data
				: (json?.data?.content || json?.content || (Array.isArray(json) ? json : []));
			loading.remove();

			const HIDDEN_ROLES = new Set(['default-roles-ciyex', 'offline_access', 'uma_authorization']);

			const tableWrap = DOM.append(root, DOM.$('div'));
			tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
			const table = DOM.append(tableWrap, DOM.$('table'));
			table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

			const thead = DOM.append(table, DOM.$('thead'));
			const tr = DOM.append(thead, DOM.$('tr'));
			tr.style.cssText = 'background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
			for (const col of ['Username', 'Name', 'Email', 'Roles', 'Status', 'Actions']) {
				const th = DOM.append(tr, DOM.$('th'));
				th.textContent = col;
				th.style.cssText = 'padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
			}

			const tbody = DOM.append(table, DOM.$('tbody'));

			const renderRows = (filterTerm: string) => {
				DOM.clearNode(tbody);
				const list = filterTerm
					? allList.filter(u => {
						const s = filterTerm.toLowerCase();
						const user = u as { username?: string; firstName?: string; lastName?: string; email?: string };
						return (user.username || '').toLowerCase().includes(s)
							|| (user.email || '').toLowerCase().includes(s)
							|| ([user.firstName, user.lastName].join(' ')).toLowerCase().includes(s);
					})
					: allList;

				if (list.length === 0) {
					const emptyRow = DOM.append(tbody, DOM.$('tr'));
					const td = DOM.append(emptyRow, DOM.$('td')) as HTMLTableCellElement;
					td.colSpan = 6;
					td.textContent = filterTerm ? 'No users match your search.' : 'No users found.';
					td.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);';
					return;
				}

				for (const u of list) {
					const user = u as {
						id?: string;
						username?: string;
						firstName?: string;
						lastName?: string;
						email?: string;
						roles?: string[];
						npi?: string;
						enabled?: boolean;
					};
					const row = DOM.append(tbody, DOM.$('tr'));
					row.style.cssText = 'border-bottom:1px solid rgba(128,128,128,0.1);';
					row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
					row.addEventListener('mouseleave', () => { row.style.background = ''; });

					this._appendCell(row, user.username || '-');
					this._appendCell(row, [user.firstName, user.lastName].filter(Boolean).join(' ') || '-');
					this._appendCell(row, user.email || '-');
					const roleList = (user.roles || []).filter(r => !HIDDEN_ROLES.has(r));
					this._appendCell(row, roleList.length > 0 ? roleList.slice(0, 2).join(', ') + (roleList.length > 2 ? ` +${roleList.length - 2}` : '') : '-');

					// Status badge
					const statusTd = DOM.append(row, DOM.$('td'));
					statusTd.style.cssText = 'padding:10px 12px;';
					const isActive = user.enabled !== false;
					const badge = DOM.append(statusTd, DOM.$('span'));
					badge.textContent = isActive ? 'Active' : 'Inactive';
					badge.style.cssText = `display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:${isActive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'};color:${isActive ? '#22c55e' : '#ef4444'};`;

					// Actions
					const actionsTd = DOM.append(row, DOM.$('td'));
					actionsTd.style.cssText = 'padding:6px 12px;white-space:nowrap;';
					this._tableAction(actionsTd, '\u270f', 'Edit', () => this._showEditUserDialog(root, user as Record<string, unknown>));
					this._tableAction(actionsTd, '\u{1F511}', 'Reset Password', () => this._resetUserPassword(user.id || ''));
					this._tableAction(actionsTd, '\u{1F6AB}', 'Disable user', () => this._deleteUser(user.id || '', user.username || ''), 'danger');
				}
			};

			renderRows('');
			searchInput.addEventListener('input', () => renderRows(searchInput.value));

			if (allList.length === 0) {
				const empty = DOM.append(root, DOM.$('div'));
				empty.textContent = 'No users found.';
				empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;margin-top:16px;';
			}
		} catch {
			loading.textContent = 'Waiting for login\u2026';
		}
	}

	/**
	 * Add User dialog matching the EHR Web UI flow:
	 *   1. Pick "Staff" or "Patient" tab.
	 *   2. Search providers (Staff) or patients (Patient) and pick one.
	 *   3. Choose a role (loaded from /api/admin/roles).
	 *   4. Optionally send a welcome email.
	 *   5. Submit → POST /api/admin/users.
	 */
	private _showAddUserDialog(root: HTMLElement): void {
		const overlay = DOM.append(root, DOM.$('.sh-dialog-overlay'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('div'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:24px;width:520px;box-shadow:0 8px 24px rgba(0,0,0,0.4);max-height:90vh;overflow-y:auto;';

		const title = DOM.append(dialog, DOM.$('h3'));
		title.textContent = 'Add User';
		title.style.cssText = 'margin:0 0 4px;font-size:15px;font-weight:600;';
		const subtitle = DOM.append(dialog, DOM.$('p'));
		subtitle.textContent = 'Search for a provider or patient, then assign a role and credentials.';
		subtitle.style.cssText = 'margin:0 0 16px;color:var(--vscode-descriptionForeground);font-size:12px;';

		// Staff / Patients tab bar
		let activeTab: 'staff' | 'patients' = 'staff';
		const tabBar = DOM.append(dialog, DOM.$('div'));
		tabBar.style.cssText = 'display:flex;gap:4px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:14px;';
		const staffTab = DOM.append(tabBar, DOM.$('button'));
		const patientsTab = DOM.append(tabBar, DOM.$('button'));
		const tabStyle = (active: boolean) => `padding:6px 14px;background:transparent;border:none;border-bottom:2px solid ${active ? 'var(--vscode-focusBorder)' : 'transparent'};color:${active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};cursor:pointer;font-size:12px;font-weight:500;margin-bottom:-1px;`;
		staffTab.textContent = '\u{1FA7A} Staff (Provider)';
		patientsTab.textContent = '\u{1F464} Patient';
		staffTab.style.cssText = tabStyle(true);
		patientsTab.style.cssText = tabStyle(false);

		// Search row
		const searchWrap = DOM.append(dialog, DOM.$('div'));
		searchWrap.style.cssText = 'margin-bottom:12px;position:relative;';
		const searchLbl = DOM.append(searchWrap, DOM.$('label'));
		searchLbl.textContent = 'Search by Name or NPI';
		searchLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const searchInput = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = 'Type 2+ characters…';
		searchInput.autocomplete = 'off';
		searchInput.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
		const results = DOM.append(searchWrap, DOM.$('div'));
		results.style.cssText = 'position:absolute;left:0;right:0;top:100%;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:4px;max-height:200px;overflow-y:auto;z-index:50;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.2);margin-top:2px;';

		let selectedSubject: { id: string; firstName: string; lastName: string; email?: string; npi?: string } | null = null;

		// Selected preview
		const preview = DOM.append(dialog, DOM.$('div'));
		preview.style.cssText = 'display:none;padding:10px 12px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.4);border-radius:4px;margin-bottom:12px;font-size:12px;';

		// Form fields
		const emailWrap = DOM.append(dialog, DOM.$('div'));
		emailWrap.style.cssText = 'margin-bottom:12px;';
		const emailLbl = DOM.append(emailWrap, DOM.$('label'));
		emailLbl.textContent = 'Email *';
		emailLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const emailInp = DOM.append(emailWrap, DOM.$('input')) as HTMLInputElement;
		emailInp.type = 'email';
		emailInp.placeholder = 'name@example.com';
		emailInp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';

		const roleWrap = DOM.append(dialog, DOM.$('div'));
		roleWrap.style.cssText = 'margin-bottom:12px;';
		const roleLbl = DOM.append(roleWrap, DOM.$('label'));
		roleLbl.textContent = 'Role *';
		roleLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const roleSel = DOM.append(roleWrap, DOM.$('select')) as HTMLSelectElement;
		roleSel.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:13px;box-sizing:border-box;outline:none;cursor:pointer;';
		const placeholderOpt = DOM.append(roleSel, DOM.$('option')) as HTMLOptionElement;
		placeholderOpt.value = '';
		placeholderOpt.textContent = '— Select Role —';
		// Load roles
		this.apiService.fetch('/api/admin/roles').then(async r => {
			if (!r.ok) { return; }
			const j = await r.json();
			const roles: Array<{ roleName: string; roleLabel?: string; isActive?: boolean }> = j?.data || [];
			for (const role of roles.filter(rl => rl.isActive !== false)) {
				const opt = DOM.append(roleSel, DOM.$('option')) as HTMLOptionElement;
				opt.value = role.roleName;
				opt.textContent = role.roleLabel || role.roleName;
				if (activeTab === 'patients' && role.roleName === 'PATIENT') { opt.selected = true; }
				if (activeTab === 'staff' && role.roleName === 'PROVIDER') { opt.selected = true; }
			}
		}).catch(() => { /* ignore */ });

		const passwordWrap = DOM.append(dialog, DOM.$('div'));
		passwordWrap.style.cssText = 'margin-bottom:12px;';
		const passwordLbl = DOM.append(passwordWrap, DOM.$('label'));
		passwordLbl.textContent = 'Temporary Password (optional)';
		passwordLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const passwordInp = DOM.append(passwordWrap, DOM.$('input')) as HTMLInputElement;
		passwordInp.type = 'text';
		passwordInp.placeholder = 'Leave blank to auto-generate';
		passwordInp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;font-family:var(--vscode-editor-font-family,monospace);box-sizing:border-box;outline:none;';

		const optionsCol = DOM.append(dialog, DOM.$('div'));
		optionsCol.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:16px;';
		const optionsRow = DOM.append(optionsCol, DOM.$('div'));
		optionsRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const sendWelcomeCb = DOM.append(optionsRow, DOM.$('input')) as HTMLInputElement;
		sendWelcomeCb.type = 'checkbox';
		sendWelcomeCb.checked = true;
		sendWelcomeCb.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
		sendWelcomeCb.id = 'sh-send-welcome';
		const swl = DOM.append(optionsRow, DOM.$('label'));
		swl.textContent = 'Send welcome email with credentials';
		swl.setAttribute('for', 'sh-send-welcome');
		swl.style.cssText = 'font-size:12px;cursor:pointer;';

		// "Generate printable credentials" — matches the EHR Web UI option.
		// When checked, the temporary password is shown after creation with a Print action.
		const printRow = DOM.append(optionsCol, DOM.$('div'));
		printRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const printCb = DOM.append(printRow, DOM.$('input')) as HTMLInputElement;
		printCb.type = 'checkbox';
		printCb.checked = true;
		printCb.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
		printCb.id = 'sh-print-creds';
		const pwl = DOM.append(printRow, DOM.$('label'));
		pwl.textContent = 'Generate printable credentials';
		pwl.setAttribute('for', 'sh-print-creds');
		pwl.style.cssText = 'font-size:12px;cursor:pointer;';

		const setSelected = (item: { id: string; firstName: string; lastName: string; email?: string; npi?: string } | null): void => {
			selectedSubject = item;
			if (!item) { preview.style.display = 'none'; return; }
			DOM.clearNode(preview);
			preview.style.display = 'block';
			const nm = DOM.append(preview, DOM.$('div'));
			nm.textContent = `✓ Selected: ${item.firstName} ${item.lastName}`;
			nm.style.cssText = 'font-weight:600;color:#22c55e;';
			if (item.email || item.npi) {
				const det = DOM.append(preview, DOM.$('div'));
				det.textContent = `${item.email || ''}${item.email && item.npi ? ' · ' : ''}${item.npi ? `NPI ${item.npi}` : ''}`;
				det.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';
			}
			// Always overwrite the email field when a subject is picked — the team
			// flagged that the email should auto-fetch from the provider's record
			// (previously we only auto-filled when the field was empty, which
			// meant switching subjects left the old email in place).
			if (item.email) { emailInp.value = item.email; }
			searchInput.value = `${item.firstName} ${item.lastName}`.trim();
			results.style.display = 'none';
		};

		// Debounced search
		let searchDebounce: ReturnType<typeof setTimeout> | null = null;
		const doSearch = async (q: string): Promise<void> => {
			if (q.length < 2) { results.style.display = 'none'; return; }
			const endpoint = activeTab === 'patients'
				? `/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`
				: `/api/fhir-resource/providers?search=${encodeURIComponent(q)}&page=0&size=10`;
			try {
				const r = await this.apiService.fetch(endpoint);
				if (!r.ok) { return; }
				const j = await r.json();
				const list: Array<Record<string, unknown>> = j?.data?.content || j?.data || j?.content || (Array.isArray(j) ? j : []);
				DOM.clearNode(results);
				if (list.length === 0) {
					const none = DOM.append(results, DOM.$('div'));
					none.textContent = 'No results';
					none.style.cssText = 'padding:8px 10px;color:var(--vscode-descriptionForeground);font-size:12px;';
				}
				// Cross-reference the result list with existing user accounts so we
				// can flag providers/patients that already have a login. The team
				// flagged that "providers who already have logins should show a
				// green Has login badge so we don't create duplicates".
				const existingEmails = new Set<string>();
				const existingFhirIds = new Set<string>();
				try {
					const ur = await this.apiService.fetch('/api/admin/users?page=0&size=200');
					if (ur.ok) {
						const uj = await ur.json();
						const users: Array<Record<string, unknown>> = Array.isArray(uj?.data) ? uj.data : (uj?.data?.content || uj?.content || (Array.isArray(uj) ? uj : []));
						for (const u of users) {
							if (u.email) { existingEmails.add(String(u.email).toLowerCase()); }
							const linkedFhir = (u as { practitionerFhirId?: string; patientFhirId?: string }).practitionerFhirId || (u as { patientFhirId?: string }).patientFhirId;
							if (linkedFhir) { existingFhirIds.add(String(linkedFhir)); }
						}
					}
				} catch { /* ignore — fall back to no badges */ }

				for (const row of list) {
					const ident = (row['identification'] || {}) as Record<string, unknown>;
					const first = String(row['identification.firstName'] || ident.firstName || row.firstName || '');
					const last = String(row['identification.lastName'] || ident.lastName || row.lastName || '');
					const email = String((row['identification.email'] || ident.email || row.email || '') as string);
					const npi = String(row.npi || '');
					const rowId = String(row.id || row.fhirId || '');
					const hasLogin = (email && existingEmails.has(email.toLowerCase())) || (rowId && existingFhirIds.has(rowId));

					const item = DOM.append(results, DOM.$('div'));
					item.style.cssText = `padding:8px 10px;cursor:${hasLogin ? 'not-allowed' : 'pointer'};font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);${hasLogin ? 'opacity:0.7;' : ''}`;
					item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.05))'; });
					item.addEventListener('mouseleave', () => { item.style.background = ''; });

					const nameRow = DOM.append(item, DOM.$('div'));
					nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
					const n = DOM.append(nameRow, DOM.$('span'));
					n.textContent = `${first} ${last}`.trim() || '(no name)';
					n.style.fontWeight = '500';
					if (hasLogin) {
						const badge = DOM.append(nameRow, DOM.$('span'));
						badge.textContent = 'Has login';
						badge.style.cssText = 'font-size:10px;font-weight:500;padding:1px 8px;border-radius:10px;background:rgba(34,197,94,0.18);color:#22c55e;';
					}
					const meta = DOM.append(item, DOM.$('div'));
					meta.textContent = email + (email && npi ? ' · ' : '') + (npi ? `NPI ${npi}` : '');
					meta.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

					item.addEventListener('mousedown', e => {
						e.preventDefault();
						if (hasLogin) {
							this.notificationService.notify({ severity: Severity.Warning, message: `${first} ${last} already has a login.` });
							return;
						}
						setSelected({ id: rowId, firstName: first, lastName: last, email, npi });
					});
				}
				results.style.display = 'block';
			} catch { /* ignore */ }
		};

		searchInput.addEventListener('input', () => {
			selectedSubject = null;
			preview.style.display = 'none';
			if (searchDebounce) { clearTimeout(searchDebounce); }
			searchDebounce = setTimeout(() => { void doSearch(searchInput.value.trim()); }, 250);
		});
		searchInput.addEventListener('focus', () => { if (results.children.length > 0) { results.style.display = 'block'; } });
		searchInput.addEventListener('blur', () => setTimeout(() => { results.style.display = 'none'; }, 200));

		const switchTab = (tab: 'staff' | 'patients') => {
			activeTab = tab;
			staffTab.style.cssText = tabStyle(tab === 'staff');
			patientsTab.style.cssText = tabStyle(tab === 'patients');
			searchInput.placeholder = tab === 'patients' ? 'Search patients by name…' : 'Search providers by name or NPI…';
			searchInput.value = '';
			setSelected(null);
		};
		staffTab.addEventListener('click', () => switchTab('staff'));
		patientsTab.addEventListener('click', () => switchTab('patients'));

		const btnRow = DOM.append(dialog, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;border-top:1px solid var(--vscode-editorWidget-border);padding-top:14px;';
		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Create User';
		saveBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });

		saveBtn.addEventListener('click', async () => {
			if (!selectedSubject) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Search and select a provider or patient first.' });
				return;
			}
			if (!emailInp.value.trim()) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Email is required.' });
				return;
			}
			if (!roleSel.value) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Pick a role.' });
				return;
			}
			const body = {
				firstName: selectedSubject.firstName,
				lastName: selectedSubject.lastName,
				email: emailInp.value.trim(),
				roleName: roleSel.value,
				temporaryPassword: passwordInp.value.trim() || undefined,
				sendWelcomeEmail: sendWelcomeCb.checked,
				generatePrint: printCb.checked,
				...(activeTab === 'staff' && selectedSubject.id ? { practitionerFhirId: selectedSubject.id, npi: selectedSubject.npi } : {}),
				...(activeTab === 'patients' && selectedSubject.id ? { patientFhirId: selectedSubject.id } : {}),
			};
			try {
				const res = await this.apiService.fetch('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
				const json = await res.json().catch(() => null);
				if (res.ok && json?.success !== false) {
					overlay.remove();
					this.notificationService.notify({ severity: Severity.Info, message: `User created for ${selectedSubject.firstName} ${selectedSubject.lastName}.` });

					// Refresh the user list FIRST so the credentials modal we
					// open below sits on top of the rendered table (otherwise
					// _onSidebarClick's render would clear contentEl and nuke
					// the modal). Delay the modal one tick so the async render
					// has time to settle.
					this._onSidebarClick('__users__');

					// Pick the temporary password from any of the response
					// shapes the backend might use, falling back to the value
					// the admin typed (if any). When `generatePrint` is checked
					// the modal MUST appear — even if the backend didn't return
					// a password, we show the username with a "sent via email"
					// note so the admin gets visible confirmation that their
					// "print credentials" intent succeeded.
					if (printCb.checked) {
						const tempPwd = json?.data?.temporaryPassword
							|| json?.data?.password
							|| json?.data?.tempPassword
							|| json?.temporaryPassword
							|| json?.password
							|| body.temporaryPassword
							|| '';
						const newUserId = json?.data?.id || json?.data?.userId || json?.id;
						const newUserEmail = json?.data?.email || body.email;
						setTimeout(() => {
							this._showCredentialsModal({
								userId: String(newUserId || ''),
								username: String(newUserEmail),
								temporaryPassword: tempPwd ? String(tempPwd) : '(sent via email — not displayed)',
								resetDate: new Date().toISOString().split('T')[0],
							});
						}, 100);
					}
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: json?.message || `Create failed (${res.status})` });
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Create failed: ${e}` });
			}
		});

		setTimeout(() => searchInput.focus(), 50);
	}

	private _showEditUserDialog(root: HTMLElement, user: Record<string, unknown>): void {
		const overlay = DOM.append(root, DOM.$('.sh-dialog-overlay'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('div'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:24px;width:420px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
		const t = DOM.append(dialog, DOM.$('h3'));
		t.textContent = 'Edit User';
		t.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';
		const fields: Array<[string, string]> = [['First Name', 'firstName'], ['Last Name', 'lastName'], ['Email', 'email']];
		const inputs: Record<string, HTMLInputElement> = {};
		for (const [label, key] of fields) {
			const wrap = DOM.append(dialog, DOM.$('div'));
			wrap.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(wrap, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const inp = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			inp.type = 'text';
			inp.value = (user[key] as string) || '';
			inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
			inputs[key] = inp;
		}
		const btnRow = DOM.append(dialog, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = 'Save';
		saveBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		saveBtn.addEventListener('click', async () => {
			const body: Record<string, unknown> = { ...user };
			for (const [k, inp] of Object.entries(inputs)) { body[k] = inp.value.trim(); }
			const id = user.id as string;
			try {
				const res = await this.apiService.fetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
				if (res.ok) {
					overlay.remove();
					this.notificationService.notify({ severity: Severity.Info, message: 'User updated.' });
					this._onSidebarClick('__users__');
				} else {
					const err = await res.json().catch(() => null);
					this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Update failed (${res.status})` });
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Update failed: ${e}` });
			}
		});
	}

	private async _resetUserPassword(userId: string): Promise<void> {
		if (!userId) { return; }
		const { confirmed } = await this.dialogService.confirm({
			message: 'Reset password?',
			detail: 'A new temporary password will be generated. You can show or print the credentials for the user.',
			primaryButton: 'Reset',
		});
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
			const json = await res.json().catch(() => null);
			if (res.ok && json?.data?.temporaryPassword) {
				this._showCredentialsModal(json.data as { userId: string; username: string; temporaryPassword: string; resetDate?: string });
			} else if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Password reset.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: json?.message || `Failed to reset password (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Failed: ${e}` });
		}
	}

	private async _deleteUser(userId: string, username: string): Promise<void> {
		if (!userId) { return; }
		// The backend does NOT support DELETE /api/admin/users/{id} — there is
		// only PUT /api/admin/users/{id}/deactivate (matches the EHR Web UI
		// "delete user" behaviour, which also deactivates rather than deletes).
		// Calling DELETE returns "Request method 'DELETE' is not supported", so
		// the workspace must call the deactivate endpoint instead.
		const { confirmed } = await this.dialogService.confirm({
			message: `Disable user "${username}"?`,
			detail: 'This deactivates the account in Keycloak. The user will no longer be able to sign in. You can re-enable later.',
			primaryButton: 'Disable',
			type: 'warning',
		});
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/users/${userId}/deactivate`, { method: 'PUT' });
			if (res.ok || res.status === 204) {
				this.notificationService.notify({ severity: Severity.Info, message: `User ${username} disabled.` });
				this._onSidebarClick('__users__');
				return;
			}
			let msg = `Disable failed (${res.status})`;
			try {
				const json = await res.json();
				if (json?.message) { msg = json.message; }
				else if (json?.error) { msg = json.error; }
			} catch { /* keep status-only msg */ }
			if (res.status === 403) {
				msg += ' — Permission denied. Only admins can disable users.';
			} else if (res.status === 404) {
				msg += ' — User no longer exists.';
				this._onSidebarClick('__users__');
			}
			this.notificationService.notify({ severity: Severity.Error, message: msg });
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Disable failed: ${e}` });
		}
	}

	/**
	 * Show a credentials modal with Copy/Print actions matching the EHR Web UI behavior.
	 * Used after user creation and password reset when the backend returns a temporaryPassword.
	 */
	private _showCredentialsModal(data: { userId: string; username: string; temporaryPassword: string; resetDate?: string }): void {
		// Anchor the modal to <body> instead of contentEl so any subsequent
		// _renderContent() call (e.g. from _onSidebarClick refreshing the user
		// list) doesn't wipe it. The team report repeatedly flagged that the
		// credentials modal "is not showing" after Create User — that was
		// because the async sidebar re-render cleared contentEl moments after
		// the modal was appended. Attaching to body avoids the race entirely.
		const overlay = DOM.append(mainWindow.document.body, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:99999;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:480px;max-width:92vw;padding:22px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = 'Login Credentials';
		ht.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const desc = DOM.append(modal, DOM.$('p'));
		desc.textContent = 'Share these credentials with the user. The temporary password must be changed on first login.';
		desc.style.cssText = 'margin:0 0 14px;font-size:12px;color:var(--vscode-descriptionForeground);';

		const credBox = DOM.append(modal, DOM.$('div'));
		credBox.style.cssText = 'background:rgba(0,122,204,0.08);border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:12px;font-family:var(--vscode-editor-font-family,monospace);font-size:13px;line-height:1.7;';

		const row = (label: string, value: string): void => {
			const r = DOM.append(credBox, DOM.$('div'));
			r.style.cssText = 'display:flex;gap:8px;';
			const k = DOM.append(r, DOM.$('span'));
			k.textContent = label;
			k.style.cssText = 'font-weight:600;min-width:90px;color:var(--vscode-descriptionForeground);';
			const v = DOM.append(r, DOM.$('span'));
			v.textContent = value;
			v.style.cssText = 'font-weight:500;';
		};
		row('Username:', data.username);
		row('Password:', data.temporaryPassword);
		if (data.resetDate) { row('Reset Date:', data.resetDate); }

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';

		const copyBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		copyBtn.textContent = '\u{1F4CB} Copy';
		copyBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		copyBtn.addEventListener('click', async () => {
			const text = `Username: ${data.username}\nPassword: ${data.temporaryPassword}`;
			try {
				await mainWindow.navigator.clipboard.writeText(text);
				this.notificationService.notify({ severity: Severity.Info, message: 'Credentials copied to clipboard.' });
			} catch {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Clipboard unavailable.' });
			}
		});

		const printBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		printBtn.textContent = '\u{1F5A8} Print';
		printBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		printBtn.addEventListener('click', () => this._printCredentials(data));

		const doneBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		doneBtn.textContent = 'Done';
		doneBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		doneBtn.addEventListener('click', () => overlay.remove());

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
	}

	/** Open a printable popup with the user's credentials. */
	private _printCredentials(data: { username: string; temporaryPassword: string; resetDate?: string }): void {
		const w = mainWindow.open('', '_blank', 'width=600,height=500');
		if (!w) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Pop-up blocked. Allow pop-ups to print credentials.' });
			return;
		}
		const doc = w.document;
		const html = doc.createElement('html');
		const head = doc.createElement('head');
		const title = doc.createElement('title');
		title.textContent = 'Login Credentials';
		head.appendChild(title);
		const style = doc.createElement('style');
		style.textContent = `
			body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a2e; }
			h1 { font-size: 22px; margin: 0 0 8px; }
			h2 { font-size: 14px; color: #6b7280; font-weight: normal; margin: 0 0 30px; }
			.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; max-width: 460px; }
			.row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
			.row:last-child { border-bottom: none; }
			.k { font-weight: 600; min-width: 130px; color: #6b7280; }
			.v { font-family: 'Courier New', monospace; font-weight: 600; }
			.note { margin-top: 24px; font-size: 12px; color: #6b7280; }
		`;
		head.appendChild(style);
		const body = doc.createElement('body');
		const h1 = doc.createElement('h1');
		h1.textContent = 'Login Credentials';
		const h2 = doc.createElement('h2');
		h2.textContent = 'Ciyex Workspace';
		const card = doc.createElement('div');
		card.className = 'card';
		const rows: Array<[string, string]> = [
			['Username', data.username],
			['Password', data.temporaryPassword],
		];
		if (data.resetDate) { rows.push(['Issued', data.resetDate]); }
		for (const [k, v] of rows) {
			const r = doc.createElement('div');
			r.className = 'row';
			const ke = doc.createElement('div');
			ke.className = 'k';
			ke.textContent = k;
			const ve = doc.createElement('div');
			ve.className = 'v';
			ve.textContent = v;
			r.appendChild(ke);
			r.appendChild(ve);
			card.appendChild(r);
		}
		const note = doc.createElement('div');
		note.className = 'note';
		note.textContent = 'This is a temporary password. The user must change it on first login. Keep secure.';
		body.appendChild(h1);
		body.appendChild(h2);
		body.appendChild(card);
		body.appendChild(note);
		html.appendChild(head);
		html.appendChild(body);
		doc.documentElement.replaceWith(html);
		doc.close();
		w.focus();
		w.print();
	}

	private async _renderRolesPermissions(): Promise<void> {
		// Matches the EHR Web UI /settings \u2192 Roles & Permissions page exactly
		// (see test report image_3): one full-width row per role with a colored
		// left border (per-role accent), name + key + System badge, description
		// with "N permissions, M FHIR scopes" inline, and edit/delete actions
		// on the right. Built-in system roles cannot be deleted.
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:16px;';
		const headerLeft = DOM.append(header, DOM.$('div'));
		headerLeft.style.cssText = 'display:flex;align-items:center;gap:10px;';
		const shieldIcon = DOM.append(headerLeft, DOM.$('div'));
		shieldIcon.textContent = '\u{1F6E1}';
		shieldIcon.style.cssText = 'width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:rgba(99,102,241,0.12);border-radius:8px;font-size:18px;';
		const titleCol = DOM.append(headerLeft, DOM.$('div'));
		const titleEl = DOM.append(titleCol, DOM.$('h1'));
		titleEl.textContent = 'Roles & Permissions';
		titleEl.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
		const sub = DOM.append(titleCol, DOM.$('p'));
		sub.textContent = 'Configure role-based access control';
		sub.style.cssText = 'margin:2px 0 0;font-size:12px;color:var(--vscode-descriptionForeground);';

		const newRoleBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
		newRoleBtn.textContent = '+ New Role';
		newRoleBtn.style.cssText = 'padding:8px 16px;background:#6366f1;color:#ffffff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;';
		newRoleBtn.addEventListener('click', () => this._showRoleDialog(root, null));

		const loading = DOM.append(root, DOM.$('div'));
		loading.textContent = 'Loading roles\u2026';
		loading.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';

		// Per-role accent colors \u2014 match the EHR Web UI's hard-coded role border
		// stripe colors so Admin = red, Billing = purple, Front Desk = orange, etc.
		const ROLE_COLORS: Record<string, string> = {
			ADMIN: '#ef4444', SUPER_ADMIN: '#dc2626',
			PROVIDER: '#3b82f6', NURSE: '#10b981',
			MA: '#14b8a6', MEDICAL_ASSISTANT: '#14b8a6',
			FRONT_DESK: '#f59e0b', BILLING: '#a855f7',
			LAB_TECHNICIAN: '#0ea5e9', PATIENT: '#64748b',
		};
		const colorFor = (key: string): string => ROLE_COLORS[(key || '').toUpperCase()] || '#94a3b8';

		try {
			const res = await this.apiService.fetch('/api/admin/roles');
			if (!res.ok) {
				const errText = await res.text().catch(() => '');
				loading.textContent = `Failed to load roles (${res.status}). ${errText.substring(0, 200)}`;
				return;
			}
			const json = await res.json();
			const list: Array<Record<string, unknown>> = Array.isArray(json?.data)
				? json.data
				: (json?.content || (Array.isArray(json) ? json : []));
			loading.remove();

			if (list.length === 0) {
				const empty = DOM.append(root, DOM.$('div'));
				empty.textContent = 'No roles configured. Click "+ New Role" to create one.';
				empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
				return;
			}

			const grid = DOM.append(root, DOM.$('div'));
			grid.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
			for (const r of list) {
				const role = r as {
					id?: string | number;
					roleName?: string;
					roleLabel?: string;
					description?: string;
					permissions?: string[];
					smartScopes?: string[];
					isActive?: boolean;
					isSystem?: boolean;
				};
				const accent = colorFor(role.roleName || '');
				const card = DOM.append(grid, DOM.$('div'));
				card.style.cssText = `display:flex;align-items:flex-start;padding:14px 16px;border:1px solid var(--vscode-editorWidget-border);border-left:4px solid ${accent};border-radius:8px;background:var(--vscode-editor-background);gap:12px;position:relative;`;
				card.addEventListener('mouseenter', () => { card.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.02))'; });
				card.addEventListener('mouseleave', () => { card.style.background = 'var(--vscode-editor-background)'; });

				// Action buttons top-right
				const cardActions = DOM.append(card, DOM.$('div'));
				cardActions.style.cssText = 'position:absolute;top:10px;right:10px;display:flex;gap:4px;';
				this._tableAction(cardActions, '\u270f', 'Edit', () => this._showRoleDialog(root, r));
				if (!role.isSystem) {
					this._tableAction(cardActions, '\u{1F5D1}', 'Delete', () => this._deleteRole(r.id as string, role.roleName || ''), 'danger');
				}

				// Content wrapper (left-aligned, takes remaining space)
				const content = DOM.append(card, DOM.$('div'));
				content.style.cssText = 'flex:1;min-width:0;padding-right:60px;';

				// Header: label + name + system lock badge — mirrors image_3 from
				// the test report exactly (label, KEY, lock System)
				const headRow = DOM.append(content, DOM.$('div'));
				headRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:4px;';
				const lbl = DOM.append(headRow, DOM.$('span'));
				lbl.textContent = role.roleLabel || role.roleName || '(unnamed)';
				lbl.style.cssText = 'font-weight:600;font-size:14px;';
				const code = DOM.append(headRow, DOM.$('span'));
				code.textContent = role.roleName || '';
				code.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-weight:500;letter-spacing:0.3px;';
				if (role.isSystem) {
					const sys = DOM.append(headRow, DOM.$('span'));
					sys.textContent = '\u{1F512} System';
					sys.style.cssText = 'font-size:10px;color:#f59e0b;font-weight:500;';
				}
				if (role.isActive === false) {
					const inactive = DOM.append(headRow, DOM.$('span'));
					inactive.textContent = 'INACTIVE';
					inactive.style.cssText = 'font-size:9px;font-weight:600;background:rgba(248,113,113,0.2);color:var(--vscode-errorForeground,#f48771);padding:1px 5px;border-radius:3px;letter-spacing:0.5px;';
				}

				// Single-line summary in the web format:
				// "{description} — {N} permissions, {M} FHIR scopes"
				// The permission count + FHIR scope count are rendered in the
				// link color so they read as inline "tags" the user can scan.
				const summary = DOM.append(content, DOM.$('div'));
				summary.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);line-height:1.5;';
				const permCount = (role.permissions || []).length;
				const scopeCount = (role.smartScopes || []).length;
				if (role.description) {
					const dTxt = DOM.append(summary, DOM.$('span'));
					dTxt.textContent = `${role.description} — `;
				}
				const permTag = DOM.append(summary, DOM.$('span'));
				permTag.textContent = `${permCount} permissions`;
				permTag.style.cssText = 'color:var(--vscode-textLink-foreground,#3794ff);font-weight:500;';
				const comma = DOM.append(summary, DOM.$('span'));
				comma.textContent = ', ';
				const scopeTag = DOM.append(summary, DOM.$('span'));
				scopeTag.textContent = `${scopeCount} FHIR scopes`;
				scopeTag.style.cssText = 'color:var(--vscode-textLink-foreground,#3794ff);font-weight:500;';
			}
		} catch {
			loading.textContent = 'Waiting for login\u2026';
		}
	}

	/**
	 * Create / Edit Role drawer — mirrors the EHR Web UI exactly:
	 *   - Role Name (uppercase + underscores, locked after creation)
	 *   - Display Label
	 *   - Description
	 *   - Permissions: grouped checkboxes (Messaging, Reports, Administration)
	 *     Each parent toggle expands all child permissions.
	 *   - FHIR API Scopes: matrix with Read / Write columns per resource
	 *     grouped by Clinical / Administrative / Billing & Financial /
	 *     Organization & Settings, plus a "Select All FHIR Scopes" master.
	 */
	private _showRoleDialog(root: HTMLElement, role: Record<string, unknown> | null): void {
		const isEdit = role !== null;
		const overlay = DOM.append(root, DOM.$('.sh-dialog-overlay'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-start;justify-content:flex-end;z-index:1000;';

		// Right-anchored drawer (matches the web's slide-in modal in image_35/36)
		const dialog = DOM.append(overlay, DOM.$('div'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border-left:1px solid var(--vscode-editorWidget-border);width:540px;max-width:96vw;height:100%;box-shadow:-8px 0 24px rgba(0,0,0,0.4);display:flex;flex-direction:column;';

		const head = DOM.append(dialog, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const t = DOM.append(head, DOM.$('h3'));
		t.textContent = isEdit ? 'Edit Role' : 'Create Role';
		t.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const body = DOM.append(dialog, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;padding:18px 22px;';

		const labelStyle = 'display:block;font-size:12px;font-weight:600;color:var(--vscode-foreground);margin:14px 0 6px;';
		const inputStyle = 'width:100%;padding:8px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';

		// Role Name (locked after creation)
		const nameLbl = DOM.append(body, DOM.$('label'));
		nameLbl.textContent = 'Role Name *';
		nameLbl.style.cssText = labelStyle;
		const nameInp = DOM.append(body, DOM.$('input')) as HTMLInputElement;
		nameInp.value = (role?.roleName as string) || '';
		nameInp.placeholder = 'e.g. CHARGE_NURSE';
		nameInp.disabled = isEdit;
		nameInp.style.cssText = inputStyle;
		const nameHelp = DOM.append(body, DOM.$('div'));
		nameHelp.textContent = 'Uppercase with underscores. Cannot be changed after creation.';
		nameHelp.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;';

		const labelLbl = DOM.append(body, DOM.$('label'));
		labelLbl.textContent = 'Display Label *';
		labelLbl.style.cssText = labelStyle;
		const labelInp = DOM.append(body, DOM.$('input')) as HTMLInputElement;
		labelInp.value = (role?.roleLabel as string) || '';
		labelInp.placeholder = 'e.g. Charge Nurse';
		labelInp.style.cssText = inputStyle;

		const descLbl = DOM.append(body, DOM.$('label'));
		descLbl.textContent = 'Description';
		descLbl.style.cssText = labelStyle;
		const descArea = DOM.append(body, DOM.$('textarea')) as HTMLTextAreaElement;
		descArea.value = (role?.description as string) || '';
		descArea.rows = 3;
		descArea.style.cssText = inputStyle + 'resize:vertical;font-family:inherit;';

		// -- Permissions section (grouped) -----------------------------
		const selectedPerms = new Set<string>(((role?.permissions as string[]) || []));
		const PERMISSION_GROUPS: Array<{ label: string; perms: Array<{ key: string; label: string }> }> = [
			{ label: 'Messaging', perms: [{ key: 'messaging.read', label: 'View Messages' }, { key: 'messaging.send', label: 'Send Messages' }] },
			{ label: 'Reports', perms: [{ key: 'reports.read', label: 'View Reports' }, { key: 'reports.manage', label: 'Manage Reports' }] },
			{
				label: 'Administration', perms: [
					{ key: 'admin.users', label: 'Manage Users' },
					{ key: 'admin.settings', label: 'Manage Settings' },
					{ key: 'admin.roles', label: 'Manage Roles' },
				]
			},
		];

		const permsHeader = DOM.append(body, DOM.$('div'));
		permsHeader.style.cssText = 'font-size:13px;font-weight:600;margin:18px 0 10px;display:flex;align-items:center;gap:8px;';
		const permsTitle = DOM.append(permsHeader, DOM.$('span'));
		permsTitle.textContent = 'Permissions';
		const permsCounter = DOM.append(permsHeader, DOM.$('span'));
		permsCounter.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);font-weight:400;';

		const updatePermsCounter = (): void => {
			permsCounter.textContent = `(${selectedPerms.size} selected)`;
		};
		updatePermsCounter();

		for (const group of PERMISSION_GROUPS) {
			const card = DOM.append(body, DOM.$('div'));
			card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:10px 14px;margin-bottom:8px;';

			const head = DOM.append(card, DOM.$('label'));
			head.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;font-size:13px;margin-bottom:6px;';
			const parentCb = DOM.append(head, DOM.$('input')) as HTMLInputElement;
			parentCb.type = 'checkbox';
			parentCb.checked = group.perms.every(p => selectedPerms.has(p.key));
			const parentLbl = DOM.append(head, DOM.$('span'));
			parentLbl.textContent = group.label;

			const children = DOM.append(card, DOM.$('div'));
			children.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:6px 16px;padding-left:24px;';
			const childRefs: HTMLInputElement[] = [];
			for (const p of group.perms) {
				const row = DOM.append(children, DOM.$('label'));
				row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--vscode-foreground);';
				const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				cb.type = 'checkbox';
				cb.checked = selectedPerms.has(p.key);
				cb.addEventListener('change', () => {
					if (cb.checked) { selectedPerms.add(p.key); } else { selectedPerms.delete(p.key); }
					parentCb.checked = group.perms.every(g => selectedPerms.has(g.key));
					updatePermsCounter();
				});
				childRefs.push(cb);
				const txt = DOM.append(row, DOM.$('span'));
				txt.textContent = p.label;
			}
			parentCb.addEventListener('change', () => {
				for (let i = 0; i < group.perms.length; i++) {
					const p = group.perms[i];
					if (parentCb.checked) { selectedPerms.add(p.key); } else { selectedPerms.delete(p.key); }
					childRefs[i].checked = parentCb.checked;
				}
				updatePermsCounter();
			});
		}

		// -- FHIR API Scopes section (Read / Write matrix per resource) ----
		// The backend stores scopes with a `SCOPE_` prefix (e.g.
		// "SCOPE_user/Patient.read") because that's the format Spring's
		// authority handling expects. Our matrix uses the canonical SMART
		// shape "user/Patient.read" — so on load we strip the prefix and
		// on save we re-attach it. Without this the matrix renders blank
		// for system roles (Medical Assistant, Nurse, etc.) even though
		// the backend has them populated.
		const stripScopePrefix = (s: string): string => s.startsWith('SCOPE_') ? s.substring(6) : s;
		const rawScopes = ((role?.smartScopes as string[]) || []);
		const selectedScopes = new Set<string>(rawScopes.map(stripScopePrefix));
		const SCOPE_GROUPS: Array<{ label: string; resources: string[] }> = [
			{ label: 'Clinical', resources: ['Patient', 'Encounter', 'Observation', 'Procedure', 'MedicationRequest', 'DiagnosticReport', 'CarePlan', 'Immunization', 'AllergyIntolerance', 'Condition', 'Composition'] },
			{ label: 'Administrative', resources: ['Appointment', 'ServiceRequest', 'DocumentReference', 'Consent', 'Task', 'Communication', 'RelatedPerson', 'CommunicationRequest', 'QuestionnaireResponse'] },
			{ label: 'Billing & Financial', resources: ['Claim', 'ClaimResponse', 'Coverage', 'Invoice', 'ExplanationOfBenefit', 'MeasureReport'] },
			{ label: 'Organization & Settings', resources: ['Practitioner', 'Organization', 'Location', 'HealthcareService'] },
		];

		const scopesHeader = DOM.append(body, DOM.$('div'));
		scopesHeader.style.cssText = 'font-size:13px;font-weight:600;margin:24px 0 4px;display:flex;align-items:center;gap:8px;';
		const scopesTitle = DOM.append(scopesHeader, DOM.$('span'));
		scopesTitle.textContent = 'FHIR API Scopes';
		const scopesCounter = DOM.append(scopesHeader, DOM.$('span'));
		scopesCounter.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);font-weight:400;';
		const updateScopesCounter = (): void => { scopesCounter.textContent = `(${selectedScopes.size} selected)`; };
		updateScopesCounter();

		const scopesIntro = DOM.append(body, DOM.$('p'));
		scopesIntro.textContent = 'Controls which FHIR resources this role can read/write via the API.';
		scopesIntro.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin:0 0 10px;';

		// "Select All FHIR Scopes" master
		const allScopesLbl = DOM.append(body, DOM.$('label'));
		allScopesLbl.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:500;margin-bottom:10px;';
		const allScopesCb = DOM.append(allScopesLbl, DOM.$('input')) as HTMLInputElement;
		allScopesCb.type = 'checkbox';
		const allScopesTxt = DOM.append(allScopesLbl, DOM.$('span'));
		allScopesTxt.textContent = 'Select All FHIR Scopes';

		const allRowCheckboxes: HTMLInputElement[] = [];
		for (const group of SCOPE_GROUPS) {
			const card = DOM.append(body, DOM.$('div'));
			card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;margin-bottom:8px;overflow:hidden;';

			const head = DOM.append(card, DOM.$('div'));
			head.style.cssText = 'padding:8px 14px;background:rgba(0,122,204,0.04);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const ht = DOM.append(head, DOM.$('span'));
			ht.textContent = group.label;
			ht.style.cssText = 'font-size:12px;font-weight:600;';

			const colHeaders = DOM.append(head, DOM.$('div'));
			colHeaders.style.cssText = 'display:flex;gap:24px;font-size:11px;color:var(--vscode-descriptionForeground);font-weight:500;';
			const readMasterLbl = DOM.append(colHeaders, DOM.$('label'));
			readMasterLbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
			const readMasterCb = DOM.append(readMasterLbl, DOM.$('input')) as HTMLInputElement;
			readMasterCb.type = 'checkbox';
			const readMasterTxt = DOM.append(readMasterLbl, DOM.$('span'));
			readMasterTxt.textContent = 'Read';
			const writeMasterLbl = DOM.append(colHeaders, DOM.$('label'));
			writeMasterLbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
			const writeMasterCb = DOM.append(writeMasterLbl, DOM.$('input')) as HTMLInputElement;
			writeMasterCb.type = 'checkbox';
			const writeMasterTxt = DOM.append(writeMasterLbl, DOM.$('span'));
			writeMasterTxt.textContent = 'Write';

			const rowsWrap = DOM.append(card, DOM.$('div'));
			const groupReadCbs: HTMLInputElement[] = [];
			const groupWriteCbs: HTMLInputElement[] = [];
			for (const resource of group.resources) {
				const readScope = `user/${resource}.read`;
				const writeScope = `user/${resource}.write`;
				const row = DOM.append(rowsWrap, DOM.$('div'));
				row.style.cssText = 'display:grid;grid-template-columns:1fr 60px 60px;align-items:center;padding:6px 14px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.08);';
				const name = DOM.append(row, DOM.$('span'));
				name.textContent = resource;
				const readCb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				readCb.type = 'checkbox';
				readCb.checked = selectedScopes.has(readScope);
				readCb.style.cssText = 'justify-self:center;cursor:pointer;';
				readCb.addEventListener('change', () => {
					if (readCb.checked) { selectedScopes.add(readScope); } else { selectedScopes.delete(readScope); }
					readMasterCb.checked = groupReadCbs.every(c => c.checked);
					updateScopesCounter();
				});
				groupReadCbs.push(readCb);
				const writeCb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				writeCb.type = 'checkbox';
				writeCb.checked = selectedScopes.has(writeScope);
				writeCb.style.cssText = 'justify-self:center;cursor:pointer;';
				writeCb.addEventListener('change', () => {
					if (writeCb.checked) { selectedScopes.add(writeScope); } else { selectedScopes.delete(writeScope); }
					writeMasterCb.checked = groupWriteCbs.every(c => c.checked);
					updateScopesCounter();
				});
				groupWriteCbs.push(writeCb);
				allRowCheckboxes.push(readCb, writeCb);
			}
			readMasterCb.checked = groupReadCbs.every(c => c.checked);
			writeMasterCb.checked = groupWriteCbs.every(c => c.checked);
			readMasterCb.addEventListener('change', () => {
				for (let i = 0; i < groupReadCbs.length; i++) {
					groupReadCbs[i].checked = readMasterCb.checked;
					const scope = `user/${group.resources[i]}.read`;
					if (readMasterCb.checked) { selectedScopes.add(scope); } else { selectedScopes.delete(scope); }
				}
				updateScopesCounter();
			});
			writeMasterCb.addEventListener('change', () => {
				for (let i = 0; i < groupWriteCbs.length; i++) {
					groupWriteCbs[i].checked = writeMasterCb.checked;
					const scope = `user/${group.resources[i]}.write`;
					if (writeMasterCb.checked) { selectedScopes.add(scope); } else { selectedScopes.delete(scope); }
				}
				updateScopesCounter();
			});
		}
		allScopesCb.addEventListener('change', () => {
			for (const cb of allRowCheckboxes) {
				cb.checked = allScopesCb.checked;
				cb.dispatchEvent(new Event('change'));
			}
		});

		// Action bar pinned to the bottom of the drawer
		const actions = DOM.append(dialog, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;border-top:1px solid var(--vscode-editorWidget-border);';
		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:7px 16px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-foreground);cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => overlay.remove());

		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? '\u{1F4BE} Save' : 'Create Role';
		saveBtn.style.cssText = 'padding:7px 16px;background:#2563eb;color:#ffffff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			const roleName = nameInp.value.trim();
			const roleLabel = labelInp.value.trim();
			if (!roleName || !roleLabel) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Role Name and Display Label are required.' });
				return;
			}
			const payload = {
				roleName,
				roleLabel,
				description: descArea.value.trim(),
				permissions: Array.from(selectedPerms),
				smartScopes: Array.from(selectedScopes).map(s => s.startsWith('SCOPE_') ? s : `SCOPE_${s}`),
				isActive: true,
			};
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving…';
			try {
				const method = isEdit ? 'PUT' : 'POST';
				const url = isEdit ? `/api/admin/roles/${role!.id}` : '/api/admin/roles';
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				if (res.ok) {
					overlay.remove();
					this.notificationService.notify({ severity: Severity.Info, message: isEdit ? 'Role updated.' : 'Role created.' });
					this._onSidebarClick('__roles__');
				} else {
					const err = await res.json().catch(() => null);
					this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${res.status})` });
					saveBtn.disabled = false;
					saveBtn.textContent = isEdit ? '\u{1F4BE} Save' : 'Create Role';
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				saveBtn.disabled = false;
				saveBtn.textContent = isEdit ? '\u{1F4BE} Save' : 'Create Role';
			}
		});

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		setTimeout(() => (isEdit ? labelInp : nameInp).focus(), 50);
	}

	private async _deleteRole(roleId: string, roleName: string): Promise<void> {
		if (!roleId) { return; }
		const { confirmed } = await this.dialogService.confirm({ message: `Delete role "${roleName}"? This cannot be undone.` });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/admin/roles/${roleId}`, { method: 'DELETE' });
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Role deleted.' });
				this._onSidebarClick('__roles__');
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Delete failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	/**
	 * Form Options \u2014 mirrors the EHR Web UI FormOptionsEditor:
	 * a tree of every select/radio field across all tab_field_configs in the
	 * left rail, plus a right pane to edit value/label/color for the picked
	 * field. The team report flagged the old read-only chip list as "blank".
	 *
	 * Data flow:
	 *   1. GET /api/tab-field-config/all to enumerate every tab.
	 *   2. For each tab, walk fc.sections[].fields[] and collect any field
	 *      whose type is 'select' | 'radio' (or that defines `options`).
	 *   3. Render the tree grouped by tab in the left rail.
	 *   4. Editing an option PUTs the entire tab config back to
	 *      /api/tab-field-config/{tabKey}.
	 */
	private async _renderFormOptions(): Promise<void> {
		interface FieldOpt { value: string; label: string; color?: string }
		interface FieldRow { tabKey: string; tabLabel: string; section: string; key: string; label: string; type: string; options: FieldOpt[]; rawConfig: TabFieldConfig }

		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'display:flex;height:100%;';

		// Left rail
		const rail = DOM.append(root, DOM.$('div'));
		rail.style.cssText = 'width:280px;flex-shrink:0;border-right:1px solid var(--vscode-editorWidget-border);overflow-y:auto;';
		const railHead = DOM.append(rail, DOM.$('div'));
		railHead.style.cssText = 'padding:14px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:11px;font-weight:700;letter-spacing:1.2px;color:var(--vscode-descriptionForeground);';
		railHead.textContent = 'DROPDOWN FIELDS';
		const railBody = DOM.append(rail, DOM.$('div'));
		railBody.style.cssText = 'padding:8px 6px;';

		// Right pane
		const pane = DOM.append(root, DOM.$('div'));
		pane.style.cssText = 'flex:1;overflow-y:auto;padding:24px;';

		let selectedKey: string | null = null;
		let allFields: FieldRow[] = [];

		const renderPane = (): void => {
			DOM.clearNode(pane);
			if (!selectedKey) {
				const ph = DOM.append(pane, DOM.$('div'));
				ph.textContent = 'Pick a field on the left to edit its options.';
				ph.style.cssText = 'padding:60px;text-align:center;color:var(--vscode-descriptionForeground);';
				return;
			}
			const field = allFields.find(f => `${f.tabKey}:${f.key}` === selectedKey);
			if (!field) { return; }

			const head = DOM.append(pane, DOM.$('div'));
			head.style.cssText = 'margin-bottom:16px;';
			const title = DOM.append(head, DOM.$('h1'));
			title.textContent = field.label;
			title.style.cssText = 'margin:0 0 4px;font-size:20px;font-weight:600;';
			const sub = DOM.append(head, DOM.$('p'));
			sub.style.cssText = 'margin:0;font-size:12px;color:var(--vscode-descriptionForeground);';
			const tabSpan = DOM.append(sub, DOM.$('span'));
			tabSpan.textContent = `${field.tabLabel} / ${field.section} \u00b7 Field key: `;
			const keySpan = DOM.append(sub, DOM.$('code'));
			keySpan.textContent = field.key;
			keySpan.style.cssText = 'background:rgba(128,128,128,0.12);padding:1px 5px;border-radius:3px;font-size:11px;';

			// Editable options table
			const tableWrap = DOM.append(pane, DOM.$('div'));
			tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

			const headerRow = DOM.append(tableWrap, DOM.$('div'));
			headerRow.style.cssText = 'display:grid;grid-template-columns:30px 1fr 1fr 80px 40px;gap:8px;padding:10px 12px;background:rgba(0,122,204,0.05);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:var(--vscode-descriptionForeground);';
			for (const h of ['', 'VALUE', 'LABEL', 'COLOR', '']) {
				const c = DOM.append(headerRow, DOM.$('span'));
				c.textContent = h;
			}

			const renderOptions = (): void => {
				// Clear all rows except the header
				while (tableWrap.children.length > 1) { tableWrap.removeChild(tableWrap.lastChild!); }
				field.options.forEach((opt, i) => {
					const row = DOM.append(tableWrap, DOM.$('div'));
					row.style.cssText = 'display:grid;grid-template-columns:30px 1fr 1fr 80px 40px;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid rgba(128,128,128,0.08);';
					const dragHandle = DOM.append(row, DOM.$('span'));
					dragHandle.textContent = '\u2630';
					dragHandle.style.cssText = 'opacity:0.4;cursor:grab;font-size:11px;';
					const valInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
					valInp.value = opt.value;
					valInp.style.cssText = 'padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
					valInp.addEventListener('input', () => { field.options[i].value = valInp.value; });
					const lblInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
					lblInp.value = opt.label;
					lblInp.style.cssText = 'padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
					lblInp.addEventListener('input', () => { field.options[i].label = lblInp.value; });
					const colorInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
					colorInp.type = 'color';
					colorInp.value = opt.color || '#3b82f6';
					colorInp.style.cssText = 'width:100%;height:28px;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;cursor:pointer;background:transparent;padding:1px;';
					colorInp.addEventListener('input', () => { field.options[i].color = colorInp.value; });
					const rm = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
					rm.textContent = '\u{1F5D1}';
					rm.style.cssText = 'background:transparent;border:none;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:13px;';
					rm.addEventListener('click', () => { field.options.splice(i, 1); renderOptions(); });
				});
			};
			renderOptions();

			const addRow = DOM.append(pane, DOM.$('button')) as HTMLButtonElement;
			addRow.textContent = '+ Add option';
			addRow.style.cssText = 'margin-top:10px;background:transparent;border:none;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;font-size:13px;font-weight:500;padding:6px 0;';
			addRow.addEventListener('click', () => { field.options.push({ value: '', label: '' }); renderOptions(); });

			// Preview select
			const previewHeader = DOM.append(pane, DOM.$('div'));
			previewHeader.textContent = 'PREVIEW';
			previewHeader.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:1.2px;color:var(--vscode-descriptionForeground);margin:24px 0 6px;';
			const previewBox = DOM.append(pane, DOM.$('div'));
			previewBox.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:12px;';
			const previewLbl = DOM.append(previewBox, DOM.$('label'));
			previewLbl.textContent = field.label;
			previewLbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
			const previewSel = DOM.append(previewBox, DOM.$('select')) as HTMLSelectElement;
			previewSel.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground);font-size:13px;';
			const ph = DOM.append(previewSel, DOM.$('option')) as HTMLOptionElement;
			ph.textContent = 'Select\u2026';
			for (const o of field.options) {
				const oo = DOM.append(previewSel, DOM.$('option')) as HTMLOptionElement;
				oo.value = o.value;
				oo.textContent = o.label;
			}

			// Save button
			const actions = DOM.append(pane, DOM.$('div'));
			actions.style.cssText = 'display:flex;justify-content:flex-end;margin-top:18px;gap:8px;';
			const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			saveBtn.textContent = '\u{1F4BE} Save Options';
			saveBtn.style.cssText = 'padding:7px 16px;background:#2563eb;color:#ffffff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;';
			saveBtn.addEventListener('click', async () => {
				saveBtn.disabled = true;
				saveBtn.textContent = 'Saving\u2026';
				try {
					// Patch the field's options back into the section it came from
					const fc: FieldConfig = typeof field.rawConfig.fieldConfig === 'string' ? JSON.parse(field.rawConfig.fieldConfig as string) : ((field.rawConfig.fieldConfig as FieldConfig) || { sections: [] });
					for (const s of (fc.sections || [])) {
						for (const f of s.fields) {
							if (f.key === field.key) { f.options = field.options.map(o => ({ value: o.value, label: o.label })); }
						}
					}
					const res = await this.apiService.fetch(`/api/tab-field-config/${encodeURIComponent(field.tabKey)}`, {
						method: 'PUT',
						body: JSON.stringify({ ...field.rawConfig, fieldConfig: fc }),
					});
					if (res.ok) {
						this.notificationService.notify({ severity: Severity.Info, message: 'Options saved.' });
					} else {
						this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}).` });
					}
				} catch (e) {
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				}
				saveBtn.disabled = false;
				saveBtn.textContent = '\u{1F4BE} Save Options';
			});
		};

		const renderRail = (): void => {
			DOM.clearNode(railBody);
			// Group fields by tab
			const grouped: Record<string, { tabLabel: string; fields: FieldRow[] }> = {};
			for (const f of allFields) {
				if (!grouped[f.tabKey]) { grouped[f.tabKey] = { tabLabel: f.tabLabel, fields: [] }; }
				grouped[f.tabKey].fields.push(f);
			}
			const tabKeys = Object.keys(grouped).sort();
			if (tabKeys.length === 0) {
				const empty = DOM.append(railBody, DOM.$('div'));
				empty.textContent = 'No dropdown fields found.';
				empty.style.cssText = 'padding:14px;color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';
				return;
			}
			const expanded = new Set<string>(tabKeys.slice(0, 3));
			const drawTabs = (): void => {
				DOM.clearNode(railBody);
				for (const tabKey of tabKeys) {
					const g = grouped[tabKey];
					const tabRow = DOM.append(railBody, DOM.$('div'));
					tabRow.style.cssText = 'padding:6px 8px;font-size:13px;font-weight:600;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-radius:4px;';
					tabRow.addEventListener('mouseenter', () => { tabRow.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.04))'; });
					tabRow.addEventListener('mouseleave', () => { tabRow.style.background = ''; });
					const lblWrap = DOM.append(tabRow, DOM.$('span'));
					lblWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
					const chev = DOM.append(lblWrap, DOM.$('span'));
					chev.textContent = expanded.has(tabKey) ? '\u25be' : '\u25b8';
					chev.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
					const name = DOM.append(lblWrap, DOM.$('span'));
					name.textContent = g.tabLabel;
					const count = DOM.append(tabRow, DOM.$('span'));
					count.textContent = String(g.fields.length);
					count.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-weight:400;';
					tabRow.addEventListener('click', () => { if (expanded.has(tabKey)) { expanded.delete(tabKey); } else { expanded.add(tabKey); } drawTabs(); });

					if (expanded.has(tabKey)) {
						for (const f of g.fields) {
							const key = `${f.tabKey}:${f.key}`;
							const isActive = key === selectedKey;
							const row = DOM.append(railBody, DOM.$('div'));
							row.style.cssText = `padding:5px 8px 5px 26px;font-size:12px;cursor:pointer;border-radius:4px;background:${isActive ? '#2563eb' : 'transparent'};color:${isActive ? '#ffffff' : 'var(--vscode-foreground)'};display:flex;justify-content:space-between;align-items:center;`;
							row.addEventListener('mouseenter', () => { if (!isActive) { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.04))'; } });
							row.addEventListener('mouseleave', () => { if (!isActive) { row.style.background = ''; } });
							const fl = DOM.append(row, DOM.$('span'));
							fl.textContent = f.label;
							fl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
							const opCount = DOM.append(row, DOM.$('span'));
							opCount.textContent = `${f.options.length}`;
							opCount.style.cssText = `font-size:10px;opacity:${isActive ? '0.85' : '0.55'};`;
							row.addEventListener('click', () => { selectedKey = key; drawTabs(); renderPane(); });
						}
					}
				}
			};
			drawTabs();
		};

		const loading = DOM.append(railBody, DOM.$('div'));
		loading.textContent = 'Loading\u2026';
		loading.style.cssText = 'padding:14px;color:var(--vscode-descriptionForeground);font-size:12px;';

		try {
			const res = await this.apiService.fetch('/api/tab-field-config/all');
			if (!res.ok) {
				loading.textContent = `Failed (${res.status})`;
				return;
			}
			const data: TabFieldConfig[] = await res.json();
			allFields = [];
			for (const tab of data) {
				const fc: FieldConfig | undefined = typeof tab.fieldConfig === 'string'
					? (() => { try { return JSON.parse(tab.fieldConfig as string); } catch { return undefined; } })()
					: (tab.fieldConfig as FieldConfig | undefined);
				if (!fc?.sections) { continue; }
				for (const section of fc.sections) {
					for (const f of section.fields) {
						const isDropdown = f.type === 'select' || f.type === 'radio' || (Array.isArray(f.options) && f.options.length > 0);
						if (!isDropdown) { continue; }
						const opts: FieldOpt[] = (f.options || []).map(o =>
							typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label });
						allFields.push({
							tabKey: tab.tabKey,
							tabLabel: tab.label || tab.tabKey,
							section: section.label || section.key || '',
							key: f.key,
							label: f.label,
							type: f.type || 'select',
							options: opts,
							rawConfig: tab,
						});
					}
				}
			}
			renderRail();
		} catch {
			loading.textContent = 'Waiting for login\u2026';
		}
	}

	// Legacy /api/list-options modal kept for callers that still target the
	// per-list editor (separate from the new tab_field_config-based Form
	// Options tree). Only invoked from explicit code paths; intentionally
	// retained for future "create new option list" flows.
	// @ts-expect-error reserved for future "Manage option lists" entry
	private _openListOptionModal(mode: 'create' | 'edit', list: { id?: number | string; listName?: string; title?: string; options?: Array<{ value?: string; label?: string }> } | null, reload: () => Promise<void>): void {
		const overlay = DOM.append(this.contentEl, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:540px;max-width:92vw;max-height:88vh;overflow-y:auto;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = mode === 'create' ? 'New Option List' : 'Edit Option List';
		ht.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const nameLbl = DOM.append(modal, DOM.$('label'));
		nameLbl.textContent = 'List Name *';
		nameLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const nameInput = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		nameInput.value = list?.listName || list?.title || '';
		nameInput.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;margin-bottom:14px;';

		const optsLbl = DOM.append(modal, DOM.$('div'));
		optsLbl.textContent = 'Options';
		optsLbl.style.cssText = 'font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:6px;';

		const optsContainer = DOM.append(modal, DOM.$('div'));
		optsContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:240px;overflow-y:auto;';

		const opts: Array<{ value: string; label: string }> = (list?.options || []).map(o => ({ value: o.value || '', label: o.label || '' }));
		if (opts.length === 0) { opts.push({ value: '', label: '' }); }

		const renderOpts = (): void => {
			DOM.clearNode(optsContainer);
			opts.forEach((opt, idx) => {
				const row = DOM.append(optsContainer, DOM.$('div'));
				row.style.cssText = 'display:flex;gap:6px;align-items:center;';
				const valInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				valInp.placeholder = 'Value';
				valInp.value = opt.value;
				valInp.style.cssText = 'flex:1;padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
				valInp.addEventListener('input', () => { opts[idx].value = valInp.value; });
				const lblInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				lblInp.placeholder = 'Label';
				lblInp.value = opt.label;
				lblInp.style.cssText = 'flex:1;padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
				lblInp.addEventListener('input', () => { opts[idx].label = lblInp.value; });
				const rm = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
				rm.textContent = '\u2715';
				rm.title = 'Remove option';
				rm.style.cssText = 'padding:4px 8px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:11px;';
				rm.addEventListener('click', () => { opts.splice(idx, 1); renderOpts(); });
			});
		};
		renderOpts();

		const addOptBtn = DOM.append(modal, DOM.$('button')) as HTMLButtonElement;
		addOptBtn.textContent = '+ Add Option';
		addOptBtn.style.cssText = 'padding:5px 10px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:11px;margin-bottom:14px;';
		addOptBtn.addEventListener('click', () => { opts.push({ value: '', label: '' }); renderOpts(); });

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px;';
		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = mode === 'create' ? 'Create' : 'Save';
		saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			const listName = nameInput.value.trim();
			if (!listName) {
				this.notificationService.notify({ severity: Severity.Error, message: 'List name is required.' });
				return;
			}
			const cleanedOpts = opts.filter(o => o.value || o.label);
			const payload = { listName, options: cleanedOpts };
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving\u2026';
			try {
				const id = list?.id;
				const method = id ? 'PUT' : 'POST';
				const url = id ? `/api/list-options/${id}` : '/api/list-options';
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				if (res.ok) {
					overlay.remove();
					await reload();
					this.notificationService.notify({ severity: Severity.Info, message: 'List saved.' });
				} else {
					const txt = await res.text().catch(() => '');
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}). ${txt.substring(0, 160)}` });
					saveBtn.disabled = false;
					saveBtn.textContent = mode === 'create' ? 'Create' : 'Save';
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				saveBtn.disabled = false;
				saveBtn.textContent = mode === 'create' ? 'Create' : 'Save';
			}
		});

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
	}

	/**
	 * Codes tab — backed by /api/global_codes (matches EHR Web UI CodesPage).
	 * Provides search + codeType filter + Add/Edit/View/Delete CRUD actions.
	 */
	private async _renderCodes(): Promise<void> {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1200px;margin:0 auto;';

		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:16px;';
		const headerLeft = DOM.append(header, DOM.$('div'));
		const title = DOM.append(headerLeft, DOM.$('h1'));
		title.textContent = 'Codes';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(headerLeft, DOM.$('p'));
		sub.textContent = 'Global codes (ICD-10, CPT, HCPCS, CVX) — backed by /api/global_codes.';
		sub.style.cssText = 'margin:0;font-size:13px;color:var(--vscode-descriptionForeground);';

		const headerRight = DOM.append(header, DOM.$('div'));
		const addBtn = DOM.append(headerRight, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add Code';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';

		const CODE_TYPES: Array<[string, string]> = [
			['', 'All Code Types'],
			['CPT4', 'CPT4 Procedure / Service'],
			['HCPCS', 'HCPCS Procedure / Service'],
			['CVX', 'CVX Immunization'],
			['ICD10', 'ICD10 Diagnosis'],
			['ICD9', 'ICD9 Diagnosis'],
			['CUSTOM', 'Custom'],
		];

		const filterRow = DOM.append(root, DOM.$('div'));
		filterRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:14px;';

		const searchInput = DOM.append(filterRow, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'search';
		searchInput.placeholder = 'Search by code or description…';
		searchInput.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;flex:1;outline:none;';

		const typeSelect = DOM.append(filterRow, DOM.$('select')) as HTMLSelectElement;
		typeSelect.style.cssText = 'padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:12px;cursor:pointer;';
		for (const [v, l] of CODE_TYPES) {
			const opt = DOM.append(typeSelect, DOM.$('option')) as HTMLOptionElement;
			opt.value = v;
			opt.textContent = l;
		}

		const searchBtn = DOM.append(filterRow, DOM.$('button')) as HTMLButtonElement;
		searchBtn.textContent = 'Search';
		searchBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';

		const body = DOM.append(root, DOM.$('div'));

		const load = async (): Promise<void> => {
			DOM.clearNode(body);
			const loadEl = DOM.append(body, DOM.$('div'));
			loadEl.textContent = 'Loading codes…';
			loadEl.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';

			const params = new URLSearchParams();
			params.set('page', '1');
			params.set('size', '50');
			const q = searchInput.value.trim();
			const t = typeSelect.value;
			if (q) { params.set('q', q); }
			if (t) { params.set('codeType', t); }
			const useSearch = !!(q || t);
			const path = useSearch ? `/api/global_codes/search?${params}` : `/api/global_codes?${params}`;

			try {
				const res = await this.apiService.fetch(path);
				if (!res.ok) {
					const err = await res.text().catch(() => '');
					loadEl.textContent = `Failed to load codes (${res.status}). ${err.substring(0, 200)}`;
					return;
				}
				const json = await res.json();
				const codes: Array<Record<string, unknown>> = json?.data || [];
				const total: number = json?.total ?? json?.totalCount ?? json?.count ?? codes.length;

				DOM.clearNode(body);
				if (codes.length === 0) {
					const empty = DOM.append(body, DOM.$('div'));
					empty.textContent = q || t ? 'No codes match your filter.' : 'No codes found.';
					empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
					return;
				}

				const totalRow = DOM.append(body, DOM.$('div'));
				totalRow.textContent = `${total.toLocaleString()} record${total === 1 ? '' : 's'}`;
				totalRow.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:8px;';

				const tableWrap = DOM.append(body, DOM.$('div'));
				tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
				const table = DOM.append(tableWrap, DOM.$('table'));
				table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
				const thead = DOM.append(table, DOM.$('thead'));
				const tr = DOM.append(thead, DOM.$('tr'));
				tr.style.cssText = 'background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);';
				for (const col of ['Code', 'Type', 'Description', 'Category', 'Active', 'Actions']) {
					const th = DOM.append(tr, DOM.$('th'));
					th.textContent = col;
					th.style.cssText = 'padding:10px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
				}

				const tbody = DOM.append(table, DOM.$('tbody'));
				for (const c of codes) {
					const code = c as { id?: number | string; code?: string; codeType?: string; description?: string; shortDescription?: string; category?: string; active?: boolean };
					const row = DOM.append(tbody, DOM.$('tr'));
					row.style.cssText = 'border-bottom:1px solid rgba(128,128,128,0.1);';
					this._appendCell(row, code.code || '-');
					this._appendCell(row, code.codeType || '-');
					this._appendCell(row, code.description || code.shortDescription || '-');
					this._appendCell(row, code.category || '-');
					this._appendCell(row, code.active === false ? 'No' : 'Yes');

					const actionsTd = DOM.append(row, DOM.$('td'));
					actionsTd.style.cssText = 'padding:10px 12px;white-space:nowrap;';
					this._tableAction(actionsTd, '\u{1F441}', 'View', () => this._openCodeModal('view', code, load));
					this._tableAction(actionsTd, '\u270F', 'Edit', () => this._openCodeModal('edit', code, load));
					this._tableAction(actionsTd, '\u{1F5D1}', 'Delete', () => this._deleteCode(code, load), 'danger');
				}
			} catch (e) {
				loadEl.textContent = `Failed to load codes: ${e}`;
			}
		};

		addBtn.addEventListener('click', () => this._openCodeModal('create', null, load));
		searchBtn.addEventListener('click', () => { void load(); });
		searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { void load(); } });
		typeSelect.addEventListener('change', () => { void load(); });

		void load();
	}

	/** Opens a modal to view/edit/create a global code record. */
	private _openCodeModal(mode: 'view' | 'edit' | 'create', code: Record<string, unknown> | null, reload: () => Promise<void>): void {
		const overlay = DOM.append(this.contentEl, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:680px;max-width:92vw;max-height:88vh;overflow-y:auto;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = mode === 'create' ? 'Create Code' : mode === 'edit' ? 'Edit Code' : 'View Code';
		ht.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const grid = DOM.append(modal, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';

		const form: Record<string, unknown> = code ? { ...code } : { active: true };
		const isView = mode === 'view';

		const mkField = (key: string, label: string, opts: { required?: boolean; placeholder?: string; type?: 'text' | 'number' | 'textarea' | 'select' | 'checkbox'; options?: Array<[string, string]>; span?: number } = {}): void => {
			const cell = DOM.append(grid, DOM.$('div'));
			cell.style.cssText = `grid-column:span ${opts.span || 1};`;
			const lbl = DOM.append(cell, DOM.$('label'));
			lbl.textContent = label + (opts.required ? ' *' : '');
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';

			if (opts.type === 'select') {
				const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
				sel.disabled = isView;
				sel.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:12px;';
				for (const [v, l] of (opts.options || [])) {
					const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
					o.value = v;
					o.textContent = l;
					if (String(form[key] ?? '') === v) { o.selected = true; }
				}
				sel.addEventListener('change', () => { form[key] = sel.value; });
			} else if (opts.type === 'checkbox') {
				const wrap = DOM.append(cell, DOM.$('label'));
				wrap.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;';
				const cb = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				cb.type = 'checkbox';
				cb.disabled = isView;
				cb.checked = !!form[key];
				cb.addEventListener('change', () => { form[key] = cb.checked; });
				const t = DOM.append(wrap, DOM.$('span'));
				t.textContent = opts.placeholder || label;
			} else {
				const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
				inp.type = opts.type === 'number' ? 'number' : 'text';
				inp.placeholder = opts.placeholder || '';
				inp.value = form[key] === undefined || form[key] === null ? '' : String(form[key]);
				inp.disabled = isView;
				inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';
				inp.addEventListener('input', () => {
					if (opts.type === 'number') {
						const n = inp.value === '' ? undefined : Number(inp.value);
						form[key] = Number.isFinite(n) ? n : undefined;
					} else {
						form[key] = inp.value;
					}
				});
			}
		};

		mkField('code', 'Code', { required: true, placeholder: 'e.g. I10' });
		mkField('codeType', 'Type', {
			required: true, type: 'select', options: [
				['', 'Select Type'],
				['CPT4', 'CPT4 Procedure / Service'],
				['HCPCS', 'HCPCS Procedure / Service'],
				['CVX', 'CVX Immunization'],
				['ICD10', 'ICD10 Diagnosis'],
				['ICD9', 'ICD9 Diagnosis'],
				['CUSTOM', 'Custom'],
			],
		});
		mkField('modifier', 'Modifier', { placeholder: 'e.g. 25, 59' });
		mkField('category', 'Category', { placeholder: 'e.g. Evaluation & Management' });
		mkField('description', 'Description', { span: 2, placeholder: 'e.g. Essential (primary) hypertension' });
		mkField('shortDescription', 'Short Description', { span: 2, placeholder: 'e.g. Hypertension' });
		mkField('relateTo', 'Relate To', { placeholder: 'Related code or group' });
		mkField('feeStandard', 'Fee Standard', { type: 'number', placeholder: 'e.g. 150.00' });
		mkField('active', 'Active', { type: 'checkbox' });
		mkField('diagnosisReporting', 'Diagnosis Reporting', { type: 'checkbox' });
		// "Service Reporting" was missing from the workspace form even though the
		// backend GlobalCodeDto persists it — the team report (image_29 vs image_30)
		// shows the web Create Code form has both Diagnosis Reporting AND Service
		// Reporting checkboxes. Adding it here brings the form to 1:1 parity.
		mkField('serviceReporting', 'Service Reporting', { type: 'checkbox' });

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';

		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = isView ? 'Close' : 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());

		if (!isView) {
			const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
			saveBtn.textContent = mode === 'create' ? 'Create' : 'Save';
			saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			saveBtn.addEventListener('click', async () => {
				if (!form['code'] || !form['codeType']) {
					this.notificationService.notify({ severity: Severity.Error, message: 'Code and Type are required.' });
					return;
				}
				saveBtn.disabled = true;
				saveBtn.textContent = 'Saving…';
				try {
					const id = form['id'];
					const method = id ? 'PUT' : 'POST';
					const url = id ? `/api/global_codes/${id}` : '/api/global_codes';
					const res = await this.apiService.fetch(url, { method, body: JSON.stringify(form) });
					if (res.ok) {
						overlay.remove();
						await reload();
						this.notificationService.notify({ severity: Severity.Info, message: 'Saved successfully.' });
					} else {
						const txt = await res.text().catch(() => '');
						this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}). ${txt.substring(0, 160)}` });
						saveBtn.disabled = false;
						saveBtn.textContent = mode === 'create' ? 'Create' : 'Save';
					}
				} catch (e) {
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
					saveBtn.disabled = false;
					saveBtn.textContent = mode === 'create' ? 'Create' : 'Save';
				}
			});
		}

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
	}

	private async _deleteCode(code: Record<string, unknown>, reload: () => Promise<void>): Promise<void> {
		const id = (code as { id?: number | string }).id;
		if (!id) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Cannot delete: code has no ID.' });
			return;
		}
		const { confirmed } = await this.dialogService.confirm({ message: `Delete code "${code['code']}"? This cannot be undone.` });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/global_codes/${id}`, { method: 'DELETE' });
			if (res.ok) {
				await reload();
				this.notificationService.notify({ severity: Severity.Info, message: 'Code deleted.' });
			} else {
				const txt = await res.text().catch(() => '');
				this.notificationService.notify({ severity: Severity.Error, message: `Delete failed (${res.status}). ${txt.substring(0, 160)}` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	/**
	 * Display Settings — mirrors the EHR Web UI /settings → Display page exactly:
	 *   - Heading "Display Settings" with Monitor icon
	 *   - "Font Size" section with 4 button-cards (Small / Default / Large / Extra Large)
	 *     each showing an "Aa" sample at the actual size and a check mark on active
	 *   - Preview pane with sample patient card + table
	 *   - Footer note explaining the preference is browser-local
	 * Selected size persists in localStorage under `ciyex_display_fontSize`.
	 */
	private _renderDisplay(): void {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:720px;margin:0 auto;';

		const STORAGE_KEY = 'ciyex_display_fontSize';
		type FontSize = 'small' | 'default' | 'large' | 'x-large';
		const FONT_OPTIONS: Array<{ value: FontSize; label: string; desc: string; px: string }> = [
			{ value: 'small', label: 'Small', desc: '14px base', px: '14px' },
			{ value: 'default', label: 'Default', desc: '16px base', px: '16px' },
			{ value: 'large', label: 'Large', desc: '18px base', px: '18px' },
			{ value: 'x-large', label: 'Extra Large', desc: '20px base', px: '20px' },
		];
		let current: FontSize = 'default';
		try {
			const raw = localStorage.getItem(STORAGE_KEY) as FontSize | null;
			if (raw && FONT_OPTIONS.some(o => o.value === raw)) { current = raw; }
		} catch { /* ignore */ }

		// Apply the chosen font size to a global CSS variable so every page in
		// the EHR workspace picks it up (not just this preview). The single
		// style rule below wires `.ciyex-editor-root` to read the variable, so
		// every editor pane inherits the size without us needing to walk the
		// DOM (selector-based queries are forbidden by the VSCode lint rules).
		if (!this._fontSizeStyleInjected) {
			this._fontSizeStyleInjected = true;
			const styleEl = mainWindow.document.createElement('style');
			// Apply the font size to the entire VSCode workbench root so
			// every pane — chart, calendar, encounter, settings — uniformly
			// scales with the chosen Display size. Inherits down to all
			// children. The team report repeatedly flagged "font size
			// changes only in this particular tab"; this rule applies it
			// globally instead of only to .ciyex-editor-root.
			styleEl.textContent = `
				.monaco-workbench,
				.monaco-workbench *:not(.codicon):not([class^="codicon-"]):not(.monaco-icon-label):not(.action-label) {
					font-size: var(--ciyex-display-fontSize, inherit);
				}
				.ciyex-editor-root,
				.ciyex-settings-editor {
					font-size: var(--ciyex-display-fontSize, 16px);
				}
			`;
			mainWindow.document.head.appendChild(styleEl);
		}
		const applyGlobalFontSize = (size: FontSize): void => {
			const px = FONT_OPTIONS.find(o => o.value === size)?.px || '16px';
			mainWindow.document.documentElement.style.setProperty('--ciyex-display-fontSize', px);
		};
		applyGlobalFontSize(current);

		// Header (Monitor icon + "Display Settings" title)
		const headerRow = DOM.append(root, DOM.$('div'));
		headerRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:20px;';
		const headerIcon = DOM.append(headerRow, DOM.$('span'));
		headerIcon.textContent = '\u{1F5A5}';
		headerIcon.style.cssText = 'font-size:18px;color:var(--vscode-descriptionForeground);';
		const title = DOM.append(headerRow, DOM.$('h2'));
		title.textContent = 'Display Settings';
		title.style.cssText = 'margin:0;font-size:18px;font-weight:600;';

		// Font Size section
		const fontSection = DOM.append(root, DOM.$('div'));
		fontSection.style.cssText = 'margin-bottom:32px;';

		const fontHeader = DOM.append(fontSection, DOM.$('div'));
		fontHeader.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;';
		const fontIcon = DOM.append(fontHeader, DOM.$('span'));
		fontIcon.textContent = '\u{1F520}';
		fontIcon.style.cssText = 'font-size:14px;opacity:0.6;';
		const fontTitle = DOM.append(fontHeader, DOM.$('h3'));
		fontTitle.textContent = 'Font Size';
		fontTitle.style.cssText = 'margin:0;font-size:14px;font-weight:600;';

		const fontDesc = DOM.append(fontSection, DOM.$('p'));
		fontDesc.textContent = 'Adjust the base font size across the entire application. This affects all text, buttons, and form elements.';
		fontDesc.style.cssText = 'margin:0 0 14px;font-size:12px;color:var(--vscode-descriptionForeground);';

		const grid = DOM.append(fontSection, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:10px;';

		const buttonRefs: HTMLButtonElement[] = [];
		const renderButtons = (): void => {
			DOM.clearNode(grid);
			buttonRefs.length = 0;
			for (const opt of FONT_OPTIONS) {
				const btn = DOM.append(grid, DOM.$('button')) as HTMLButtonElement;
				const isActive = opt.value === current;
				btn.style.cssText = `position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 12px;border-radius:8px;border:2px solid ${isActive ? '#3b82f6' : 'var(--vscode-editorWidget-border)'};background:${isActive ? 'rgba(59,130,246,0.08)' : 'var(--vscode-editor-background)'};cursor:pointer;transition:all 0.08s;`;
				btn.addEventListener('mouseenter', () => { if (!isActive) { btn.style.borderColor = 'var(--vscode-focusBorder)'; } });
				btn.addEventListener('mouseleave', () => { if (!isActive) { btn.style.borderColor = 'var(--vscode-editorWidget-border)'; } });
				if (isActive) {
					const check = DOM.append(btn, DOM.$('span'));
					check.textContent = '✓';
					check.style.cssText = 'position:absolute;top:6px;right:8px;color:#3b82f6;font-size:13px;font-weight:700;';
				}
				const sample = DOM.append(btn, DOM.$('span'));
				sample.textContent = 'Aa';
				sample.style.cssText = `font-weight:500;color:var(--vscode-foreground);font-size:${opt.px};`;
				const label = DOM.append(btn, DOM.$('span'));
				label.textContent = opt.label;
				label.style.cssText = `font-size:13px;font-weight:500;color:${isActive ? '#3b82f6' : 'var(--vscode-foreground)'};`;
				const desc = DOM.append(btn, DOM.$('span'));
				desc.textContent = opt.desc;
				desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
				btn.addEventListener('click', () => {
					current = opt.value;
					try { localStorage.setItem(STORAGE_KEY, current); } catch { /* ignore */ }
					applyGlobalFontSize(current);
					renderButtons();
					renderPreview();
				});
				buttonRefs.push(btn);
			}
		};

		// Preview pane
		const previewWrap = DOM.append(root, DOM.$('div'));
		previewWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:18px;background:var(--vscode-editor-background);';

		const previewLbl = DOM.append(previewWrap, DOM.$('div'));
		previewLbl.textContent = 'PREVIEW';
		previewLbl.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:1.2px;color:var(--vscode-descriptionForeground);margin-bottom:12px;';

		const previewBody = DOM.append(previewWrap, DOM.$('div'));

		const renderPreview = (): void => {
			DOM.clearNode(previewBody);
			const px = FONT_OPTIONS.find(o => o.value === current)?.px || '16px';
			previewBody.style.fontSize = px;

			const name = DOM.append(previewBody, DOM.$('div'));
			name.textContent = 'Patient: Karen Mitchell';
			name.style.cssText = 'font-size:1.125em;font-weight:600;margin-bottom:4px;';

			const meta = DOM.append(previewBody, DOM.$('div'));
			meta.textContent = 'Date of Birth: 12/16/1960 (65y) · Female · MRN: 1148';
			meta.style.cssText = 'font-size:0.875em;color:var(--vscode-descriptionForeground);margin-bottom:10px;';

			const badges = DOM.append(previewBody, DOM.$('div'));
			badges.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;';
			const active = DOM.append(badges, DOM.$('span'));
			active.textContent = 'Active';
			active.style.cssText = 'padding:3px 10px;border-radius:999px;font-size:0.75em;font-weight:500;background:rgba(34,197,94,0.15);color:#22c55e;';
			const allergy = DOM.append(badges, DOM.$('span'));
			allergy.textContent = 'Allergy: Peanut';
			allergy.style.cssText = 'padding:3px 10px;border-radius:999px;font-size:0.75em;font-weight:500;background:rgba(239,68,68,0.15);color:#ef4444;';

			const table = DOM.append(previewBody, DOM.$('table'));
			table.style.cssText = 'width:100%;font-size:0.875em;border-collapse:collapse;';
			const thead = DOM.append(table, DOM.$('thead'));
			const headRow = DOM.append(thead, DOM.$('tr'));
			for (const col of ['Field', 'Value']) {
				const th = DOM.append(headRow, DOM.$('th'));
				th.textContent = col;
				th.style.cssText = 'text-align:left;padding:6px 0;color:var(--vscode-descriptionForeground);font-weight:500;border-bottom:1px solid var(--vscode-editorWidget-border);';
			}
			const rows: Array<[string, string]> = [
				['Phone', '(543) 476-5375'],
				['Email', 'karen.mitchell@email.com'],
			];
			const tbody = DOM.append(table, DOM.$('tbody'));
			for (const [k, v] of rows) {
				const tr = DOM.append(tbody, DOM.$('tr'));
				const td1 = DOM.append(tr, DOM.$('td'));
				td1.textContent = k;
				td1.style.cssText = 'padding:6px 0;color:var(--vscode-descriptionForeground);border-bottom:1px solid rgba(128,128,128,0.1);';
				const td2 = DOM.append(tr, DOM.$('td'));
				td2.textContent = v;
				td2.style.cssText = 'padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.1);';
			}
		};

		renderButtons();
		renderPreview();

		const footnote = DOM.append(root, DOM.$('p'));
		footnote.textContent = 'This setting is saved to your browser. Each user can set their own preferred font size.';
		footnote.style.cssText = 'margin:16px 0 0;font-size:11px;color:var(--vscode-descriptionForeground);';
	}

	/**
	 * Template Documents — manages reusable document templates for encounter notes
	 * and patient portal content. Backed by /api/template-documents which returns
	 * { id, name, context: 'ENCOUNTER' | 'PORTAL', content, options, ... } records.
	 *
	 * The Web EHR uses Tiptap for a full WYSIWYG editor; the workspace renders an
	 * HTML textarea + live preview to keep the footprint manageable while still
	 * supporting the same workflow (create / edit / delete / context filter).
	 */
	private async _renderTemplateDocuments(): Promise<void> {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:16px;';
		const left = DOM.append(header, DOM.$('div'));
		const title = DOM.append(left, DOM.$('h1'));
		title.textContent = 'Template Documents';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(left, DOM.$('p'));
		sub.textContent = 'Reusable document templates for encounters and the patient portal.';
		sub.style.cssText = 'margin:0;color:var(--vscode-descriptionForeground);font-size:13px;';
		const newBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
		newBtn.textContent = '+ New Template';
		newBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';

		// Context filter (ENCOUNTER vs PORTAL) — same as the EHR Web UI tabs
		const filterRow = DOM.append(root, DOM.$('div'));
		filterRow.style.cssText = 'display:flex;gap:4px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:16px;';
		type Ctx = '' | 'ENCOUNTER' | 'PORTAL';
		let activeCtx: Ctx = '';
		const tabs: Array<[Ctx, string]> = [['', 'All'], ['ENCOUNTER', 'Encounter'], ['PORTAL', 'Portal']];
		const tabBtns: Record<string, HTMLButtonElement> = {};
		for (const [val, lbl] of tabs) {
			const b = DOM.append(filterRow, DOM.$('button')) as HTMLButtonElement;
			b.textContent = lbl;
			b.style.cssText = 'padding:8px 16px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:13px;font-weight:500;margin-bottom:-1px;';
			tabBtns[val] = b;
			b.addEventListener('click', () => { activeCtx = val; renderTabs(); void load(); });
		}
		const renderTabs = (): void => {
			for (const [val] of tabs) {
				const b = tabBtns[val];
				const isActive = activeCtx === val;
				b.style.cssText = `padding:8px 16px;background:transparent;border:none;border-bottom:2px solid ${isActive ? 'var(--vscode-focusBorder)' : 'transparent'};color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};cursor:pointer;font-size:13px;font-weight:500;margin-bottom:-1px;`;
			}
		};
		renderTabs();

		const body = DOM.append(root, DOM.$('div'));

		interface TemplateDoc {
			id?: number;
			name: string;
			context: string;
			content: string;
			options?: Record<string, unknown>;
			createdAt?: string;
			updatedAt?: string;
		}

		const load = async (): Promise<void> => {
			DOM.clearNode(body);
			const loading = DOM.append(body, DOM.$('div'));
			loading.textContent = 'Loading templates…';
			loading.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);';
			try {
				const url = activeCtx ? `/api/template-documents?context=${activeCtx}` : '/api/template-documents';
				const res = await this.apiService.fetch(url);
				if (!res.ok) {
					loading.textContent = `Failed to load templates (${res.status})`;
					return;
				}
				const json = await res.json();
				const list: TemplateDoc[] = (Array.isArray(json) ? json : (json.data || json.content || [])) as TemplateDoc[];
				DOM.clearNode(body);
				if (list.length === 0) {
					const empty = DOM.append(body, DOM.$('div'));
					empty.textContent = 'No templates yet. Click "+ New Template" to create one.';
					empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
					return;
				}
				const grid = DOM.append(body, DOM.$('div'));
				grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;';
				for (const tpl of list) {
					const card = DOM.append(grid, DOM.$('div'));
					card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;background:var(--vscode-editor-background);position:relative;';
					const ctxBadge = DOM.append(card, DOM.$('span'));
					ctxBadge.textContent = tpl.context;
					ctxBadge.style.cssText = `position:absolute;top:10px;right:10px;font-size:9px;font-weight:600;letter-spacing:0.5px;padding:2px 6px;border-radius:3px;background:${tpl.context === 'ENCOUNTER' ? 'rgba(34,197,94,0.15)' : 'rgba(168,85,247,0.15)'};color:${tpl.context === 'ENCOUNTER' ? '#22c55e' : '#a855f7'};`;
					const name = DOM.append(card, DOM.$('div'));
					name.textContent = tpl.name || '(untitled)';
					name.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:6px;padding-right:80px;';
					const preview = DOM.append(card, DOM.$('div'));
					const plain = (tpl.content || '').replace(/<[^>]*>/g, '').trim();
					preview.textContent = plain.length > 120 ? plain.substring(0, 120) + '…' : (plain || '(empty)');
					preview.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.4;margin-bottom:10px;min-height:42px;';
					const cardActions = DOM.append(card, DOM.$('div'));
					cardActions.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;';
					this._tableAction(cardActions, '\u270F', 'Edit', () => this._openTemplateDocModal(tpl, load));
					this._tableAction(cardActions, '\u{1F441}', 'Preview', () => this._previewTemplateDoc(tpl));
					this._tableAction(cardActions, '\u{1F5D1}', 'Delete', async () => {
						if (!tpl.id) { return; }
						const { confirmed } = await this.dialogService.confirm({ message: `Delete template "${tpl.name}"?` });
						if (!confirmed) { return; }
						try {
							const r = await this.apiService.fetch(`/api/template-documents/${tpl.id}`, { method: 'DELETE' });
							if (r.ok) {
								await load();
								this.notificationService.notify({ severity: Severity.Info, message: 'Template deleted.' });
							} else {
								this.notificationService.notify({ severity: Severity.Error, message: `Delete failed (${r.status})` });
							}
						} catch (e) {
							this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
						}
					}, 'danger');
				}
			} catch {
				loading.textContent = 'Waiting for login…';
			}
		};

		newBtn.addEventListener('click', () => this._openTemplateDocModal(null, load));
		void load();
	}

	private _openTemplateDocModal(tpl: { id?: number; name: string; context: string; content: string; options?: Record<string, unknown> } | null, reload: () => Promise<void>): void {
		const overlay = DOM.append(this.contentEl, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:880px;max-width:96vw;max-height:90vh;overflow-y:auto;padding:22px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const head = DOM.append(modal, DOM.$('div'));
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';
		const ht = DOM.append(head, DOM.$('h3'));
		ht.textContent = tpl ? 'Edit Template' : 'New Template';
		ht.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:4px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());

		const grid = DOM.append(modal, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px;';

		const nameField = DOM.append(grid, DOM.$('div'));
		const nameLbl = DOM.append(nameField, DOM.$('label'));
		nameLbl.textContent = 'Template Name *';
		nameLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const nameInput = DOM.append(nameField, DOM.$('input')) as HTMLInputElement;
		nameInput.value = tpl?.name || '';
		nameInput.placeholder = 'e.g. SOAP Note, Welcome Letter';
		nameInput.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;';

		const ctxField = DOM.append(grid, DOM.$('div'));
		const ctxLbl = DOM.append(ctxField, DOM.$('label'));
		ctxLbl.textContent = 'Context *';
		ctxLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const ctxSel = DOM.append(ctxField, DOM.$('select')) as HTMLSelectElement;
		ctxSel.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:13px;cursor:pointer;';
		for (const [v, l] of [['ENCOUNTER', 'Encounter'], ['PORTAL', 'Portal']]) {
			const o = DOM.append(ctxSel, DOM.$('option')) as HTMLOptionElement;
			o.value = v;
			o.textContent = l;
			if (tpl?.context === v) { o.selected = true; }
		}

		const contentLbl = DOM.append(modal, DOM.$('label'));
		contentLbl.textContent = 'Content (HTML supported) *';
		contentLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';

		const editorRow = DOM.append(modal, DOM.$('div'));
		editorRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';

		const contentArea = DOM.append(editorRow, DOM.$('textarea')) as HTMLTextAreaElement;
		contentArea.value = tpl?.content || '';
		contentArea.placeholder = '<p>Your template HTML…</p>';
		contentArea.rows = 16;
		contentArea.style.cssText = 'width:100%;padding:8px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;font-family:var(--vscode-editor-font-family,monospace);resize:vertical;min-height:280px;';

		const previewWrap = DOM.append(editorRow, DOM.$('div'));
		previewWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:4px;padding:10px;background:var(--vscode-editor-background);overflow:auto;min-height:280px;font-size:13px;line-height:1.5;';
		const previewLabel = DOM.append(previewWrap, DOM.$('div'));
		previewLabel.textContent = 'Preview';
		previewLabel.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;';
		const previewBody = DOM.append(previewWrap, DOM.$('div'));
		const renderPreview = (): void => {
			// Sanitize: render only as plain text inside a structured preview to avoid
			// CSP / Trusted-Types issues with innerHTML. Iframe srcdoc would also work,
			// but text rendering is sufficient for confirming the template looks right.
			DOM.clearNode(previewBody);
			const lines = contentArea.value.split(/\n+/);
			for (const line of lines) {
				const stripped = line.replace(/<[^>]*>/g, '');
				if (!stripped.trim()) { continue; }
				const p = DOM.append(previewBody, DOM.$('p'));
				p.textContent = stripped;
				p.style.cssText = 'margin:0 0 6px;';
			}
			if (!previewBody.firstChild) {
				const ph = DOM.append(previewBody, DOM.$('div'));
				ph.textContent = '(empty)';
				ph.style.cssText = 'color:var(--vscode-descriptionForeground);font-style:italic;';
			}
		};
		renderPreview();
		contentArea.addEventListener('input', renderPreview);

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;';
		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = tpl ? 'Save' : 'Create';
		saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			if (!nameInput.value.trim()) {
				this.notificationService.notify({ severity: Severity.Error, message: 'Template name is required.' });
				return;
			}
			const payload = {
				name: nameInput.value.trim(),
				context: ctxSel.value,
				content: contentArea.value,
				options: tpl?.options || {},
			};
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving…';
			try {
				const url = tpl?.id ? `/api/template-documents/${tpl.id}` : '/api/template-documents';
				const method = tpl?.id ? 'PUT' : 'POST';
				const r = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				if (r.ok) {
					overlay.remove();
					await reload();
					this.notificationService.notify({ severity: Severity.Info, message: 'Template saved.' });
				} else {
					const txt = await r.text().catch(() => '');
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${r.status}). ${txt.substring(0, 160)}` });
					saveBtn.disabled = false;
					saveBtn.textContent = tpl ? 'Save' : 'Create';
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				saveBtn.disabled = false;
				saveBtn.textContent = tpl ? 'Save' : 'Create';
			}
		});

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
	}

	/**
	 * Encounter Settings — visual editor for the encounter-form field configuration.
	 * Mirrors the EHR Web UI /settings/encounter-settings page:
	 *   - Lists sections with toggle enable/disable, move up/down, edit title/columns
	 *   - Add / Remove sections and fields, Save to backend
	 *   - Backed by /api/tab-field-config/encounter-form
	 *
	 * Addresses the team report: "No Add/Edit/Save options available in Encounter tab".
	 */
	private async _renderEncounterSettings(): Promise<void> {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;';

		interface EncSection { key: string; title: string; columns?: number; collapsible?: boolean; collapsed?: boolean; visible?: boolean; fields?: Array<Record<string, unknown>>;[k: string]: unknown }
		interface EncFieldConfig { sections: EncSection[]; features?: Record<string, unknown> }

		// Header matches the EHR Web UI Encounter Settings page exactly: tab
		// title + subtitle, then a toolbar with search + "N/M enabled" + Code
		// + Reset to Defaults + Save Changes (v6 image_encounter).
		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:16px;';
		const left = DOM.append(header, DOM.$('div'));
		const title = DOM.append(left, DOM.$('h1'));
		title.textContent = 'Encounter Settings';
		title.style.cssText = 'margin:0 0 4px;font-size:20px;font-weight:600;';
		const sub = DOM.append(left, DOM.$('p'));
		sub.textContent = 'Configure encounter form sections \u2014 enable/disable, reorder, add fields, and save.';
		sub.style.cssText = 'margin:0;color:var(--vscode-descriptionForeground);font-size:13px;';

		const toolbar = DOM.append(root, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;';
		const toolLeft = DOM.append(toolbar, DOM.$('div'));
		toolLeft.style.cssText = 'display:flex;align-items:center;gap:14px;flex:1;';
		const searchInp = DOM.append(toolLeft, DOM.$('input')) as HTMLInputElement;
		searchInp.type = 'search';
		searchInp.placeholder = 'Search sections\u2026';
		searchInp.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;width:240px;outline:none;';
		const countLbl = DOM.append(toolLeft, DOM.$('span'));
		countLbl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

		const toolRight = DOM.append(toolbar, DOM.$('div'));
		toolRight.style.cssText = 'display:flex;gap:8px;';
		const codeBtn = DOM.append(toolRight, DOM.$('button')) as HTMLButtonElement;
		codeBtn.textContent = '<> Code';
		codeBtn.style.cssText = 'padding:6px 12px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const resetBtn = DOM.append(toolRight, DOM.$('button')) as HTMLButtonElement;
		resetBtn.textContent = '\u21BA Reset to Defaults';
		resetBtn.style.cssText = 'padding:6px 12px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const saveBtn = DOM.append(toolRight, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = '\u{1F4BE} Save Changes';
		saveBtn.style.cssText = 'padding:6px 14px;background:#2563eb;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';

		const body = DOM.append(root, DOM.$('div'));

		let fieldConfig: EncFieldConfig = { sections: [] };
		let fhirResources: string[] = [];
		let searchTerm = '';

		const renderBody = (): void => {
			DOM.clearNode(body);
			const enabled = fieldConfig.sections.filter(s => s.visible !== false).length;
			countLbl.textContent = `${enabled} / ${fieldConfig.sections.length} enabled`;

			if (fieldConfig.sections.length === 0) {
				const empty = DOM.append(body, DOM.$('div'));
				empty.textContent = 'No sections configured.';
				empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:12px;';
			} else {
				// Table view matching the web image: SECTION | FIELDS | COLUMNS | STATUS | ORDER
				const tableWrap = DOM.append(body, DOM.$('div'));
				tableWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;background:var(--vscode-editor-background);';
				const tHead = DOM.append(tableWrap, DOM.$('div'));
				tHead.style.cssText = 'display:grid;grid-template-columns:60px 1fr 100px 110px 90px 110px;gap:8px;padding:10px 12px;background:rgba(0,122,204,0.05);border-bottom:1px solid var(--vscode-editorWidget-border);font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:1px;';
				for (const colName of ['', 'SECTION', 'FIELDS', 'COLUMNS', 'STATUS', 'ORDER']) {
					const c = DOM.append(tHead, DOM.$('span'));
					c.textContent = colName;
				}
				const tBody = DOM.append(tableWrap, DOM.$('div'));
				const term = searchTerm.toLowerCase();
				fieldConfig.sections.forEach((section, idx) => {
					if (term && !(section.title.toLowerCase().includes(term) || section.key.toLowerCase().includes(term))) { return; }
					this._renderEncounterSection(tBody, section, idx, fieldConfig, renderBody);
				});
			}

			const addSectionBtn = DOM.append(body, DOM.$('button')) as HTMLButtonElement;
			addSectionBtn.textContent = '+ Add Section';
			addSectionBtn.style.cssText = 'display:block;width:100%;padding:10px;background:transparent;border:2px dashed var(--vscode-editorWidget-border);border-radius:8px;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;font-size:13px;font-weight:500;margin-top:10px;';
			addSectionBtn.addEventListener('click', () => {
				const newKey = `section_${Date.now()}`;
				fieldConfig.sections.push({ key: newKey, title: 'New Section', columns: 2, visible: true, fields: [] });
				renderBody();
			});
		};

		searchInp.addEventListener('input', () => { searchTerm = searchInp.value; renderBody(); });
		codeBtn.addEventListener('click', () => {
			const w = mainWindow.open('', '_blank', 'width=900,height=700');
			if (!w) { return; }
			w.document.title = 'Encounter field config (JSON)';
			const pre = w.document.createElement('pre');
			pre.textContent = JSON.stringify(fieldConfig, null, 2);
			pre.style.cssText = 'font-family:monospace;font-size:12px;padding:20px;white-space:pre-wrap;';
			w.document.body.appendChild(pre);
		});

		// Load
		try {
			const res = await this.apiService.fetch('/api/tab-field-config/encounter-form');
			if (res.ok) {
				const data = await res.json();
				const cfg = data?.data || data;
				const fc = typeof cfg.fieldConfig === 'string' ? JSON.parse(cfg.fieldConfig) : (cfg.fieldConfig || { sections: [] });
				if (fc.sections) {
					fc.sections = fc.sections.map((s: EncSection) => ({ ...s, visible: s.visible !== false }));
				}
				fieldConfig = fc as EncFieldConfig;
				fhirResources = cfg.fhirResources || [];
			}
		} catch { /* ignore */ }
		renderBody();

		saveBtn.addEventListener('click', async () => {
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving…';
			try {
				const res = await this.apiService.fetch('/api/tab-field-config/encounter-form', {
					method: 'PUT',
					body: JSON.stringify({ fieldConfig, fhirResources }),
				});
				if (res.ok) {
					this.notificationService.notify({ severity: Severity.Info, message: 'Encounter configuration saved.' });
					renderBody();
				} else {
					const txt = await res.text().catch(() => '');
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}). ${txt.substring(0, 160)}` });
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
			}
			saveBtn.disabled = false;
			saveBtn.textContent = 'Save';
		});

		resetBtn.addEventListener('click', async () => {
			const { confirmed } = await this.dialogService.confirm({ message: 'Reset to defaults? Custom encounter configuration will be removed.' });
			if (!confirmed) { return; }
			try {
				const res = await this.apiService.fetch('/api/tab-field-config/encounter-form', { method: 'DELETE' });
				if (res.ok) {
					this.notificationService.notify({ severity: Severity.Info, message: 'Reset to defaults.' });
					// Reload by re-rendering
					this._renderEncounterSettings();
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Reset failed: ${e}` });
			}
		});
	}

	private _renderEncounterSection(parent: HTMLElement, section: { key: string; title: string; columns?: number; visible?: boolean; fields?: Array<Record<string, unknown>>;[k: string]: unknown }, idx: number, fc: { sections: Array<{ key: string; title: string; columns?: number; visible?: boolean; fields?: Array<Record<string, unknown>>;[k: string]: unknown }> }, reload: () => void): void {
		const card = DOM.append(parent, DOM.$('div'));
		card.style.cssText = `border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:10px;overflow:hidden;${section.visible === false ? 'opacity:0.55;' : ''}`;

		const head = DOM.append(card, DOM.$('div'));
		head.style.cssText = 'padding:10px 14px;background:rgba(0,122,204,0.05);display:flex;align-items:center;gap:10px;';

		const upBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		upBtn.textContent = '\u25B2';
		upBtn.title = 'Move up';
		upBtn.style.cssText = 'background:transparent;border:none;color:var(--vscode-foreground);opacity:0.6;cursor:pointer;font-size:10px;padding:0 4px;';
		upBtn.addEventListener('click', () => {
			if (idx === 0) { return; }
			[fc.sections[idx - 1], fc.sections[idx]] = [fc.sections[idx], fc.sections[idx - 1]];
			reload();
		});
		const downBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		downBtn.textContent = '\u25BC';
		downBtn.title = 'Move down';
		downBtn.style.cssText = 'background:transparent;border:none;color:var(--vscode-foreground);opacity:0.6;cursor:pointer;font-size:10px;padding:0 4px;';
		downBtn.addEventListener('click', () => {
			if (idx === fc.sections.length - 1) { return; }
			[fc.sections[idx], fc.sections[idx + 1]] = [fc.sections[idx + 1], fc.sections[idx]];
			reload();
		});

		const titleInp = DOM.append(head, DOM.$('input')) as HTMLInputElement;
		titleInp.value = section.title;
		titleInp.style.cssText = 'flex:1;padding:4px 8px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--vscode-foreground);font-size:13px;font-weight:600;outline:none;';
		titleInp.addEventListener('focus', () => { titleInp.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; titleInp.style.background = 'var(--vscode-input-background)'; });
		titleInp.addEventListener('blur', () => { titleInp.style.borderColor = 'transparent'; titleInp.style.background = 'transparent'; });
		titleInp.addEventListener('input', () => { section.title = titleInp.value; });

		const keyEl = DOM.append(head, DOM.$('code'));
		keyEl.textContent = section.key;
		keyEl.style.cssText = 'background:rgba(128,128,128,0.1);color:var(--vscode-descriptionForeground);padding:2px 6px;border-radius:3px;font-size:10px;font-family:var(--vscode-editor-font-family,monospace);';

		const colLbl = DOM.append(head, DOM.$('label'));
		colLbl.textContent = 'Cols:';
		colLbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const colSel = DOM.append(head, DOM.$('select')) as HTMLSelectElement;
		colSel.style.cssText = 'padding:3px 6px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-dropdown-foreground);font-size:11px;cursor:pointer;';
		for (const n of [1, 2, 3]) {
			const o = DOM.append(colSel, DOM.$('option')) as HTMLOptionElement;
			o.value = String(n);
			o.textContent = String(n);
			if ((section.columns || 2) === n) { o.selected = true; }
		}
		colSel.addEventListener('change', () => { section.columns = Number(colSel.value); });

		const visBtn = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		visBtn.textContent = section.visible === false ? '\u{1F441}\u200D\u{1F5E8}' : '\u{1F441}';
		visBtn.title = section.visible === false ? 'Show section' : 'Hide section';
		visBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;font-size:13px;';
		visBtn.addEventListener('click', () => { section.visible = section.visible === false; reload(); });

		const delSec = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
		delSec.textContent = '\u{1F5D1}';
		delSec.title = 'Delete section';
		delSec.style.cssText = 'background:transparent;border:none;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:12px;';
		delSec.addEventListener('click', async () => {
			const { confirmed } = await this.dialogService.confirm({ message: `Delete section "${section.title}"?` });
			if (!confirmed) { return; }
			fc.sections.splice(idx, 1);
			reload();
		});

		const fieldsBody = DOM.append(card, DOM.$('div'));
		fieldsBody.style.cssText = 'padding:10px 14px;display:flex;flex-direction:column;gap:6px;';
		const fields = section.fields || [];
		if (fields.length === 0) {
			const none = DOM.append(fieldsBody, DOM.$('div'));
			none.textContent = '(No fields)';
			none.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-style:italic;';
		}
		fields.forEach((field, fi) => {
			const f = field as { key?: string; label?: string; type?: string };
			const row = DOM.append(fieldsBody, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 6px;border-radius:4px;background:rgba(128,128,128,0.06);';
			const fkey = DOM.append(row, DOM.$('code'));
			fkey.textContent = f.key || '?';
			fkey.style.cssText = 'min-width:120px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;color:var(--vscode-descriptionForeground);';
			const flabel = DOM.append(row, DOM.$('span'));
			flabel.textContent = f.label || '(no label)';
			flabel.style.cssText = 'flex:1;';
			const ftype = DOM.append(row, DOM.$('span'));
			ftype.textContent = f.type || 'text';
			ftype.style.cssText = 'background:rgba(14,99,156,0.15);color:var(--vscode-textLink-foreground,#3794ff);padding:1px 6px;border-radius:3px;font-size:10px;';
			const del = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			del.textContent = '\u2715';
			del.style.cssText = 'background:transparent;border:none;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:12px;padding:0 4px;';
			del.addEventListener('click', () => { fields.splice(fi, 1); section.fields = fields; reload(); });
		});

		const addFieldBtn = DOM.append(fieldsBody, DOM.$('button')) as HTMLButtonElement;
		addFieldBtn.textContent = '+ Add Field';
		addFieldBtn.style.cssText = 'align-self:flex-start;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;padding:3px 10px;color:var(--vscode-foreground);cursor:pointer;font-size:11px;margin-top:4px;';
		addFieldBtn.addEventListener('click', () => this._openEncounterFieldModal(null, section, reload));
	}

	private _openEncounterFieldModal(existing: { key?: string; label?: string; type?: string; placeholder?: string } | null, section: { key: string; fields?: Array<Record<string, unknown>> }, reload: () => void): void {
		const overlay = DOM.append(this.contentEl, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:440px;max-width:92vw;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';
		const ht = DOM.append(modal, DOM.$('h3'));
		ht.textContent = existing ? 'Edit Field' : 'Add Field';
		ht.style.cssText = 'margin:0 0 14px;font-size:15px;font-weight:600;';

		const labelStyle = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin:8px 0 4px;';
		const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';

		const keyLbl = DOM.append(modal, DOM.$('label'));
		keyLbl.textContent = 'Field Key *';
		keyLbl.style.cssText = labelStyle;
		const keyInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		keyInp.value = existing?.key || '';
		keyInp.placeholder = 'camelCase identifier';
		keyInp.style.cssText = inputStyle;

		const labelLbl = DOM.append(modal, DOM.$('label'));
		labelLbl.textContent = 'Field Label *';
		labelLbl.style.cssText = labelStyle;
		const labelInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		labelInp.value = existing?.label || '';
		labelInp.style.cssText = inputStyle;

		const typeLbl = DOM.append(modal, DOM.$('label'));
		typeLbl.textContent = 'Type';
		typeLbl.style.cssText = labelStyle;
		const typeSel = DOM.append(modal, DOM.$('select')) as HTMLSelectElement;
		typeSel.style.cssText = inputStyle + 'cursor:pointer;';
		for (const t of ['text', 'textarea', 'number', 'date', 'select', 'boolean', 'email', 'phone']) {
			const o = DOM.append(typeSel, DOM.$('option')) as HTMLOptionElement;
			o.value = t;
			o.textContent = t;
			if (existing?.type === t) { o.selected = true; }
		}

		const phLbl = DOM.append(modal, DOM.$('label'));
		phLbl.textContent = 'Placeholder';
		phLbl.style.cssText = labelStyle;
		const phInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		phInp.value = existing?.placeholder || '';
		phInp.style.cssText = inputStyle;

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;';
		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = existing ? 'Save' : 'Add';
		saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', () => {
			if (!keyInp.value.trim() || !labelInp.value.trim()) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Key and Label are required.' });
				return;
			}
			const newField = {
				key: keyInp.value.trim(),
				label: labelInp.value.trim(),
				type: typeSel.value,
				placeholder: phInp.value.trim() || undefined,
			};
			if (existing) {
				Object.assign(existing, newField);
			} else {
				section.fields = section.fields || [];
				section.fields.push(newField);
			}
			overlay.remove();
			reload();
		});
		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		setTimeout(() => keyInp.focus(), 50);
	}

	/**
	 * Menu Configuration — manages the EHR sidebar menu tree.
	 * Mirrors the EHR Web UI /settings/menu-configuration page:
	 *   - Loads /api/menus/ehr-sidebar (tree) + /api/menus/ehr-sidebar/overrides (mutations)
	 *   - Lets admins add/edit/hide/reorder custom items
	 *   - Backed by /api/menus/ehr-sidebar/custom-items (POST) and /items/{id}/{hide|modify}
	 */
	private async _renderMenuConfiguration(): Promise<void> {
		interface MenuItemNode { item: { id: number; itemKey: string; label: string; icon: string | null; screenSlug: string | null; isSystem?: boolean }; children?: MenuItemNode[] }

		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1000px;margin:0 auto;';

		const header = DOM.append(root, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:16px;';
		const left = DOM.append(header, DOM.$('div'));
		const title = DOM.append(left, DOM.$('h1'));
		title.textContent = 'Menu';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(left, DOM.$('p'));
		sub.textContent = 'Configure the EHR sidebar — reorder, hide, modify built-in items, or add custom links.';
		sub.style.cssText = 'margin:0;color:var(--vscode-descriptionForeground);font-size:13px;';

		const headerActions = DOM.append(header, DOM.$('div'));
		headerActions.style.cssText = 'display:flex;gap:8px;';
		const addBtn = DOM.append(headerActions, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add Item';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		const resetBtn = DOM.append(headerActions, DOM.$('button')) as HTMLButtonElement;
		resetBtn.textContent = '\u21BA Reset to Defaults';
		resetBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';

		const body = DOM.append(root, DOM.$('div'));

		const renderTree = async (): Promise<void> => {
			DOM.clearNode(body);
			const loading = DOM.append(body, DOM.$('div'));
			loading.textContent = 'Loading menu…';
			loading.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);';
			try {
				const res = await this.apiService.fetch('/api/menus/ehr-sidebar');
				if (!res.ok) {
					loading.textContent = `Failed to load menu (${res.status})`;
					return;
				}
				const data = await res.json();
				const tree: MenuItemNode[] = Array.isArray(data) ? data : (data.data || data.items || []);
				DOM.clearNode(body);
				if (tree.length === 0) {
					const empty = DOM.append(body, DOM.$('div'));
					empty.textContent = 'No menu items configured.';
					empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
					return;
				}
				// Tree container — matches the EHR Web UI "SIDEBAR MENU STRUCTURE"
				// card with each item rendered as a polished row (drag handle, label,
				// key chip, route arrow, up/down, edit, add-child, hide/show, delete).
				// Was previously a minimal label-only row; team test report flagged
				// it as not matching the web exactly.
				const treeHeader = DOM.append(body, DOM.$('div'));
				treeHeader.textContent = 'SIDEBAR MENU STRUCTURE';
				treeHeader.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:1.2px;color:var(--vscode-descriptionForeground);padding:12px 14px;background:rgba(0,122,204,0.04);border:1px solid var(--vscode-editorWidget-border);border-bottom:none;border-radius:8px 8px 0 0;';
				const treeWrap = DOM.append(body, DOM.$('div'));
				treeWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden;background:var(--vscode-editor-background);';
				const renderNode = (node: MenuItemNode, depth: number, parentArr: MenuItemNode[], idxInParent: number): void => {
					const row = DOM.append(treeWrap, DOM.$('div'));
					row.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 14px;padding-left:${14 + depth * 28}px;border-bottom:1px solid rgba(128,128,128,0.1);font-size:13px;transition:background 0.08s;`;
					row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.04))'; });
					row.addEventListener('mouseleave', () => { row.style.background = ''; });

					const drag = DOM.append(row, DOM.$('span'));
					drag.textContent = '\u22EE\u22EE';
					drag.style.cssText = 'color:var(--vscode-descriptionForeground);opacity:0.4;font-size:12px;letter-spacing:-2px;cursor:grab;';

					const icon = DOM.append(row, DOM.$('span'));
					icon.textContent = ICON_MAP[node.item.icon || 'FileText'] || '\u{1F4C4}';
					icon.style.cssText = 'opacity:0.85;font-size:14px;width:18px;text-align:center;flex-shrink:0;';

					const lbl = DOM.append(row, DOM.$('span'));
					lbl.textContent = node.item.label;
					lbl.style.cssText = 'flex:1;font-weight:500;color:var(--vscode-foreground);';

					const keyCode = DOM.append(row, DOM.$('span'));
					keyCode.textContent = node.item.itemKey;
					keyCode.style.cssText = 'background:rgba(128,128,128,0.12);color:var(--vscode-descriptionForeground);padding:2px 8px;border-radius:10px;font-size:10px;font-family:var(--vscode-editor-font-family,monospace);';

					if (node.item.screenSlug) {
						const slug = DOM.append(row, DOM.$('span'));
						slug.textContent = `\u2192 /${node.item.screenSlug}`;
						slug.style.cssText = 'font-size:11px;color:var(--vscode-textLink-foreground,#3794ff);font-family:var(--vscode-editor-font-family,monospace);';
					}
					if (node.item.isSystem) {
						const sys = DOM.append(row, DOM.$('span'));
						sys.textContent = '\u{1F512}';
						sys.title = 'System item';
						sys.style.cssText = 'font-size:11px;color:#f59e0b;opacity:0.8;';
					}

					const actions = DOM.append(row, DOM.$('div'));
					actions.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;';
					this._tableAction(actions, '\u2227', 'Move up', () => this._moveMenuItem(parentArr, idxInParent, -1, renderTree));
					this._tableAction(actions, '\u2228', 'Move down', () => this._moveMenuItem(parentArr, idxInParent, 1, renderTree));
					this._tableAction(actions, '\u270F', 'Edit', () => this._openMenuItemModal(node.item, renderTree));
					this._tableAction(actions, '+', 'Add child', () => {
						const child: { id?: number; itemKey: string; label: string; icon: string | null; screenSlug: string | null } = { itemKey: '', label: '', icon: 'FileText', screenSlug: null };
						this._openMenuItemModal(child, renderTree);
					});
					this._tableAction(actions, '\u{1F441}', 'Hide/Show', () => this._toggleMenuItemHidden(node.item.id, renderTree));
					if (!node.item.isSystem) {
						this._tableAction(actions, '\u{1F5D1}', 'Delete', () => this._deleteMenuItem(node.item.id, node.item.label, renderTree), 'danger');
					}

					const children = node.children || [];
					for (let i = 0; i < children.length; i++) {
						renderNode(children[i], depth + 1, children, i);
					}
				};
				for (let i = 0; i < tree.length; i++) {
					renderNode(tree[i], 0, tree, i);
				}
			} catch {
				loading.textContent = 'Waiting for login…';
			}
		};

		// Render an inline "Add Top-Level Item" panel below the toolbar — this
		// matches the EHR Web UI's behaviour (image_19 / image_v5 menu page).
		// Showing the form inline (rather than as a modal overlay) reduces
		// motion and lets the user keep the tree visible while filling fields.
		const addPanel = DOM.append(root, DOM.$('div'));
		addPanel.style.cssText = 'display:none;border:1px solid var(--vscode-focusBorder,var(--vscode-editorWidget-border));border-radius:8px;padding:14px 16px;margin-bottom:14px;background:rgba(59,130,246,0.04);';
		addBtn.addEventListener('click', () => this._toggleInlineAddItem(addPanel, renderTree));
		resetBtn.addEventListener('click', async () => {
			const { confirmed } = await this.dialogService.confirm({ message: 'Reset the menu to factory defaults? All custom items and overrides will be removed.' });
			if (!confirmed) { return; }
			try {
				const res = await this.apiService.fetch('/api/menus/ehr-sidebar/reset', { method: 'POST' });
				if (res.ok) {
					this.notificationService.notify({ severity: Severity.Info, message: 'Menu reset to defaults.' });
					await renderTree();
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: `Reset failed (${res.status})` });
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Reset failed: ${e}` });
			}
		});

		await renderTree();
	}

	/**
	 * Toggle the inline "Add Top-Level Item" panel — exact replica of the
	 * EHR Web UI Menu Configuration page (test report v5 image_menu):
	 *
	 *   Label                 Icon (FileText button)   Route Path           Key
	 *   FHIR Resources (Practitioner, Organization, comma-separated)
	 *                                                            [Add] [Cancel]
	 */
	private _toggleInlineAddItem(panel: HTMLElement, reload: () => Promise<void>): void {
		if (panel.style.display !== 'none') {
			panel.style.display = 'none';
			DOM.clearNode(panel);
			return;
		}
		panel.style.display = 'block';
		DOM.clearNode(panel);

		const title = DOM.append(panel, DOM.$('div'));
		title.textContent = 'Add Top-Level Item';
		title.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:10px;';

		const grid = DOM.append(panel, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:2fr 1.2fr 1.5fr 1fr;gap:10px;margin-bottom:10px;';

		const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;box-sizing:border-box;outline:none;';
		const labelStyle = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';

		const mkCol = (lbl: string): HTMLElement => {
			const col = DOM.append(grid, DOM.$('div'));
			const l = DOM.append(col, DOM.$('label'));
			l.textContent = lbl;
			l.style.cssText = labelStyle;
			return col;
		};

		const labelCol = mkCol('Label');
		const labelInp = DOM.append(labelCol, DOM.$('input')) as HTMLInputElement;
		labelInp.placeholder = 'Menu item label';
		labelInp.style.cssText = inputStyle;

		const iconCol = mkCol('Icon');
		let iconValue = 'FileText';
		const iconBtn = DOM.append(iconCol, DOM.$('button')) as HTMLButtonElement;
		iconBtn.style.cssText = inputStyle + 'cursor:pointer;display:flex;align-items:center;gap:6px;text-align:left;background:var(--vscode-button-secondaryBackground,var(--vscode-input-background));';
		const renderIcon = (): void => {
			DOM.clearNode(iconBtn);
			if (iconValue.startsWith('data:image/')) {
				const img = DOM.append(iconBtn, DOM.$('img')) as HTMLImageElement;
				img.src = iconValue;
				img.style.cssText = 'width:14px;height:14px;object-fit:contain;';
				const txt = DOM.append(iconBtn, DOM.$('span'));
				txt.textContent = 'Custom';
			} else {
				const iconSpan = DOM.append(iconBtn, DOM.$('span'));
				iconSpan.textContent = '\u{1F4C4}';
				iconSpan.style.cssText = 'opacity:0.6;font-size:12px;';
				const txt = DOM.append(iconBtn, DOM.$('span'));
				txt.textContent = iconValue;
			}
		};
		renderIcon();
		const fileInp = DOM.append(iconCol, DOM.$('input')) as HTMLInputElement;
		fileInp.type = 'file';
		fileInp.accept = 'image/*';
		fileInp.style.display = 'none';
		iconBtn.addEventListener('click', () => fileInp.click());
		fileInp.addEventListener('change', () => {
			const f = fileInp.files?.[0];
			if (!f) { return; }
			if (f.size > 128 * 1024) { this.notificationService.notify({ severity: Severity.Error, message: 'Icon must be under 128 KB.' }); return; }
			const reader = new FileReader();
			reader.onload = () => { iconValue = reader.result as string; renderIcon(); };
			reader.readAsDataURL(f);
		});

		const routeCol = mkCol('Route Path');
		const routeInp = DOM.append(routeCol, DOM.$('input')) as HTMLInputElement;
		routeInp.placeholder = '/settings/p/my-page';
		routeInp.style.cssText = inputStyle;

		const keyCol = mkCol('Key');
		const keyInp = DOM.append(keyCol, DOM.$('input')) as HTMLInputElement;
		keyInp.placeholder = 'auto-generated';
		keyInp.style.cssText = inputStyle;
		labelInp.addEventListener('input', () => {
			if (!keyInp.value) {
				keyInp.placeholder = labelInp.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'auto-generated';
			}
		});

		// FHIR Resources (full-width second row)
		const fhirLbl = DOM.append(panel, DOM.$('label'));
		fhirLbl.textContent = 'FHIR Resources';
		fhirLbl.style.cssText = labelStyle;
		const fhirRow = DOM.append(panel, DOM.$('div'));
		fhirRow.style.cssText = 'display:flex;gap:8px;align-items:center;';
		const fhirInp = DOM.append(fhirRow, DOM.$('input')) as HTMLInputElement;
		fhirInp.placeholder = 'Practitioner, Organization (comma-separated)';
		fhirInp.style.cssText = inputStyle;
		const addBtn = DOM.append(fhirRow, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = 'Add';
		addBtn.style.cssText = 'padding:6px 16px;background:#2563eb;color:#ffffff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;flex-shrink:0;';
		const cancelBtn = DOM.append(fhirRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;flex-shrink:0;';
		cancelBtn.addEventListener('click', () => { panel.style.display = 'none'; DOM.clearNode(panel); });

		addBtn.addEventListener('click', async () => {
			if (!labelInp.value.trim()) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Label is required.' });
				return;
			}
			const itemKey = (keyInp.value.trim() || keyInp.placeholder).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
			if (!itemKey || itemKey === 'auto-generated') {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Item key could not be derived from label.' });
				return;
			}
			addBtn.disabled = true;
			addBtn.textContent = 'Saving…';
			const payload = {
				itemKey,
				label: labelInp.value.trim(),
				icon: iconValue,
				screenSlug: routeInp.value.trim() || null,
			};
			try {
				const res = await this.apiService.fetch('/api/menus/ehr-sidebar/custom-items', { method: 'POST', body: JSON.stringify(payload) });
				if (!res.ok) {
					const txt = await res.text().catch(() => '');
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}). ${txt.substring(0, 160)}` });
					addBtn.disabled = false;
					addBtn.textContent = 'Add';
					return;
				}
				if (fhirInp.value.trim()) {
					const fhirArr = fhirInp.value.split(',').map(s => s.trim()).filter(Boolean).map(type => ({ type }));
					try {
						await this.apiService.fetch(`/api/tab-field-config/${encodeURIComponent(itemKey)}`, {
							method: 'PUT',
							body: JSON.stringify({ fhirResources: fhirArr, fieldConfig: { sections: [] }, category: 'Settings' }),
						});
					} catch { /* non-blocking */ }
				}
				panel.style.display = 'none';
				DOM.clearNode(panel);
				await reload();
				this.notificationService.notify({ severity: Severity.Info, message: 'Menu item added.' });
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				addBtn.disabled = false;
				addBtn.textContent = 'Add';
			}
		});

		setTimeout(() => labelInp.focus(), 50);
	}

	private _openMenuItemModal(existing: { id?: number; itemKey: string; label: string; icon: string | null; screenSlug: string | null } | null, reload: () => Promise<void>): void {
		const isEdit = existing !== null && !!existing.id;
		const overlay = DOM.append(this.contentEl, DOM.$('div'));
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;width:460px;max-width:92vw;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.45);';

		const ht = DOM.append(modal, DOM.$('h3'));
		ht.textContent = isEdit ? 'Modify Menu Item' : 'Add Menu Item';
		ht.style.cssText = 'margin:0 0 14px;font-size:16px;font-weight:600;';

		const labelStyle = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin:8px 0 4px;';
		const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';

		const mk = (text: string): HTMLElement => { const l = DOM.append(modal, DOM.$('label')); l.textContent = text; l.style.cssText = labelStyle; return l; };

		mk('Label *');
		const labelInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		labelInp.value = existing?.label || '';
		labelInp.placeholder = 'e.g. Reports';
		labelInp.style.cssText = inputStyle;

		mk('Item Key (auto from label if blank)');
		const keyInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		keyInp.value = existing?.itemKey || '';
		keyInp.placeholder = 'lowercase-with-hyphens';
		keyInp.disabled = isEdit;
		keyInp.style.cssText = inputStyle;

		mk('Icon (lucide name)');
		const iconInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		iconInp.value = existing?.icon || 'FileText';
		iconInp.placeholder = 'FileText, Heart, Pill, …';
		iconInp.style.cssText = inputStyle;

		mk('Screen Slug (URL path)');
		const slugInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		slugInp.value = existing?.screenSlug || '';
		slugInp.placeholder = 'e.g. reports — opens /reports';
		slugInp.style.cssText = inputStyle;

		// FHIR Resources — the web's web Add Item form (image_19) includes this
		// so org-specific tabs can declare which FHIR resources they bind to.
		// Saved separately to /api/tab-field-config/{key} after the menu item
		// is created, matching the web flow.
		mk('FHIR Resources');
		const fhirInp = DOM.append(modal, DOM.$('input')) as HTMLInputElement;
		fhirInp.value = '';
		fhirInp.placeholder = 'Practitioner, Organization (comma-separated)';
		fhirInp.style.cssText = inputStyle;

		const actions = DOM.append(modal, DOM.$('div'));
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';
		const cancelBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => overlay.remove());
		const saveBtn = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save' : 'Add';
		saveBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			if (!labelInp.value.trim()) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Label is required.' });
				return;
			}
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving…';
			const itemKey = keyInp.value.trim() || labelInp.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
			const payload = {
				itemKey,
				label: labelInp.value.trim(),
				icon: iconInp.value.trim() || null,
				screenSlug: slugInp.value.trim() || null,
			};
			try {
				let res: Response;
				if (isEdit && existing) {
					res = await this.apiService.fetch(`/api/menus/ehr-sidebar/items/${existing.id}/modify`, {
						method: 'PUT', body: JSON.stringify({ label: payload.label, icon: payload.icon, screenSlug: payload.screenSlug }),
					});
				} else {
					res = await this.apiService.fetch('/api/menus/ehr-sidebar/custom-items', {
						method: 'POST', body: JSON.stringify(payload),
					});
				}
				if (res.ok) {
					// When the user supplied FHIR resources for a brand-new item,
					// also save them as a fresh tab_field_config so the new menu
					// entry has a working settings tab. Matches the EHR Web flow.
					if (!isEdit && fhirInp.value.trim()) {
						const fhirArr = fhirInp.value.split(',').map(s => s.trim()).filter(Boolean).map(type => ({ type }));
						try {
							await this.apiService.fetch(`/api/tab-field-config/${encodeURIComponent(itemKey)}`, {
								method: 'PUT',
								body: JSON.stringify({ fhirResources: fhirArr, fieldConfig: { sections: [] }, category: 'Settings' }),
							});
						} catch { /* non-blocking */ }
					}
					overlay.remove();
					await reload();
					this.notificationService.notify({ severity: Severity.Info, message: 'Saved.' });
				} else {
					const txt = await res.text().catch(() => '');
					this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}). ${txt.substring(0, 160)}` });
					saveBtn.disabled = false;
					saveBtn.textContent = isEdit ? 'Save' : 'Add';
				}
			} catch (e) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
				saveBtn.disabled = false;
				saveBtn.textContent = isEdit ? 'Save' : 'Add';
			}
		});

		overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); } });
		setTimeout(() => labelInp.focus(), 50);
	}

	/**
	 * Move a menu item up or down within its siblings. The web's Menu
	 * Configuration page exposes up/down chevrons next to each row; the
	 * backend takes the reorder as an override via PUT /overrides.
	 */
	private async _moveMenuItem(siblings: Array<{ item: { id: number; itemKey: string } }>, idx: number, dir: -1 | 1, reload: () => Promise<void>): Promise<void> {
		const newIdx = idx + dir;
		if (newIdx < 0 || newIdx >= siblings.length) { return; }
		const ordered = siblings.map(s => s.item.id);
		[ordered[idx], ordered[newIdx]] = [ordered[newIdx], ordered[idx]];
		try {
			const res = await this.apiService.fetch('/api/menus/ehr-sidebar/overrides', {
				method: 'PUT',
				body: JSON.stringify({ reorder: ordered }),
			});
			if (res.ok) {
				await reload();
				this.notificationService.notify({ severity: Severity.Info, message: 'Menu order updated.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Reorder failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Reorder failed: ${e}` });
		}
	}

	private async _toggleMenuItemHidden(itemId: number, reload: () => Promise<void>): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/menus/ehr-sidebar/items/${itemId}/hide`, { method: 'POST' });
			if (res.ok) {
				await reload();
				this.notificationService.notify({ severity: Severity.Info, message: 'Visibility toggled.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Toggle failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Toggle failed: ${e}` });
		}
	}

	private async _deleteMenuItem(itemId: number, label: string, reload: () => Promise<void>): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete menu item "${label}"?` });
		if (!confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/menus/ehr-sidebar/items/${itemId}`, { method: 'DELETE' });
			if (res.ok) {
				await reload();
				this.notificationService.notify({ severity: Severity.Info, message: 'Menu item deleted.' });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Delete failed (${res.status})` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	private _previewTemplateDoc(tpl: { name: string; context: string; content: string }): void {
		const w = mainWindow.open('', '_blank', 'width=800,height=600');
		if (!w) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Pop-up blocked.' });
			return;
		}
		const doc = w.document;
		const html = doc.createElement('html');
		const head = doc.createElement('head');
		const title = doc.createElement('title');
		title.textContent = `Preview · ${tpl.name}`;
		head.appendChild(title);
		const style = doc.createElement('style');
		style.textContent = `
			body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; max-width: 720px; margin: 0 auto; color: #1a1a2e; }
			.meta { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
			h1 { font-size: 22px; margin: 0 0 16px; }
			.content { line-height: 1.6; }
		`;
		head.appendChild(style);
		const body = doc.createElement('body');
		const meta = doc.createElement('div');
		meta.className = 'meta';
		meta.textContent = tpl.context;
		const h1 = doc.createElement('h1');
		h1.textContent = tpl.name;
		const wrap = doc.createElement('div');
		wrap.className = 'content';
		// Render the template body as plain paragraphs split by newlines. Avoids
		// HTML injection and Trusted Types issues in the popup window.
		const plainLines = tpl.content.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').split(/\n+/);
		for (const line of plainLines) {
			const trimmed = line.trim();
			if (!trimmed) { continue; }
			const p = doc.createElement('p');
			p.textContent = trimmed;
			wrap.appendChild(p);
		}
		body.appendChild(meta);
		body.appendChild(h1);
		body.appendChild(wrap);
		html.appendChild(head);
		html.appendChild(body);
		doc.documentElement.replaceWith(html);
		doc.close();
	}

	private _renderCalendarColors(): void {
		const root = DOM.append(this.contentEl, DOM.$('div'));
		root.style.cssText = 'padding:24px;max-width:1000px;margin:0 auto;';
		const title = DOM.append(root, DOM.$('h1'));
		title.textContent = 'Calendar Colors';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;';
		const sub = DOM.append(root, DOM.$('p'));
		sub.textContent = 'Customize calendar appearance and appointment colors. Saved via /api/ui-colors.';
		sub.style.cssText = 'margin:0 0 20px;color:var(--vscode-descriptionForeground);font-size:13px;';

		// Tab bar \u2014 Calendar tab matches what the EHR Web UI shows
		type ColorTab = 'calendar' | 'visit-type' | 'provider' | 'location';
		let activeColorTab: ColorTab = 'calendar';
		const tabBar = DOM.append(root, DOM.$('div'));
		tabBar.style.cssText = 'display:flex;gap:4px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:20px;';
		const colorTabBody = DOM.append(root, DOM.$('div'));

		const renderColorTab = (tab: ColorTab) => {
			DOM.clearNode(colorTabBody);
			DOM.clearNode(tabBar);

			const tabs: Array<[ColorTab, string]> = [
				['calendar', 'Calendar'],
				['visit-type', 'Visit Types'],
				['provider', 'Providers'],
				['location', 'Locations'],
			];
			for (const [key, lbl] of tabs) {
				const btn = DOM.append(tabBar, DOM.$('button'));
				btn.textContent = lbl;
				const isActive = tab === key;
				btn.style.cssText = `padding:8px 16px;background:transparent;border:none;border-bottom:2px solid ${isActive ? 'var(--vscode-focusBorder)' : 'transparent'};color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};cursor:pointer;font-size:13px;font-weight:500;margin-bottom:-1px;`;
				btn.addEventListener('click', () => { activeColorTab = key; renderColorTab(key); });
			}

			if (tab === 'calendar') {
				this._renderCalendarTab(colorTabBody);
				return;
			}

			void this._renderCalendarEntityTab(colorTabBody, tab);
		};

		renderColorTab(activeColorTab);
	}

	/** General Calendar tab \u2014 working/non-working hours backgrounds, status colors. */
	private _renderCalendarTab(parent: HTMLElement): void {
		const desc = DOM.append(parent, DOM.$('p'));
		desc.textContent = 'General calendar appearance settings.';
		desc.style.cssText = 'margin:0 0 12px;font-size:12px;color:var(--vscode-descriptionForeground);';

		const panel = DOM.append(parent, DOM.$('div'));
		panel.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const items: Array<[string, string, string]> = [
			['workingHoursBg', 'Working Hours Background', '#ffffff'],
			['nonWorkingHoursBg', 'Non-Working Hours Background', '#f1f5f9'],
			['scheduledColor', 'Scheduled Appointment', '#3b82f6'],
			['checkedInColor', 'Checked In', '#22c55e'],
			['noShowColor', 'No Show', '#ef4444'],
			['cancelledColor', 'Cancelled', '#9ca3af'],
		];
		for (const [key, label, defaultColor] of items) {
			const row = DOM.append(panel, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(128,128,128,0.1);';
			const left = DOM.append(row, DOM.$('div'));
			const lbl = DOM.append(left, DOM.$('div'));
			lbl.textContent = label;
			lbl.style.cssText = 'font-size:13px;font-weight:500;';
			const k = DOM.append(left, DOM.$('code'));
			k.textContent = key;
			k.style.cssText = 'font-family:var(--vscode-editor-font-family,monospace);font-size:10px;color:var(--vscode-descriptionForeground);';
			const colorInput = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			colorInput.type = 'color';
			colorInput.value = defaultColor;
			colorInput.style.cssText = 'width:48px;height:32px;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;cursor:pointer;background:transparent;padding:2px;';
		}
	}

	/** Visit Types / Providers / Locations color editor \u2014 backed by /api/ui-colors. */
	private async _renderCalendarEntityTab(parent: HTMLElement, tab: 'visit-type' | 'provider' | 'location'): Promise<void> {
		const loading = DOM.append(parent, DOM.$('div'));
		loading.textContent = 'Loading\u2026';
		loading.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);';

		try {
			let items: Array<{ key: string; label: string; color?: string }> = [];

			if (tab === 'visit-type') {
				const res = await this.apiService.fetch('/api/tab-field-config/appointments');
				if (res.ok) {
					const json = await res.json();
					const raw = json?.fieldConfig ?? json?.data?.fieldConfig;
					const fc = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
					const sections = fc?.sections || [];
					for (const s of sections) {
						for (const f of (s.fields || [])) {
							if (f.key === 'appointmentType' && Array.isArray(f.options)) {
								items = (f.options as Array<string | { value: string; label: string }>).map(o => {
									if (typeof o === 'string') { return { key: o, label: o }; }
									return { key: o.value || o.label, label: o.label || o.value };
								});
							}
						}
					}
				}
				if (items.length === 0) {
					try {
						const r = await this.apiService.fetch('/api/list-options/list/Visit%20Type');
						if (r.ok) {
							const j = await r.json();
							const list: Array<{ title: string; activity?: number }> = j?.data || (Array.isArray(j) ? j : []);
							items = list.filter(i => i.activity !== 0).map(i => ({ key: i.title, label: i.title }));
						}
					} catch { /* ignore */ }
				}
			} else if (tab === 'provider') {
				const res = await this.apiService.fetch('/api/fhir-resource/providers?size=100');
				if (res.ok) {
					const json = await res.json();
					const list: Array<Record<string, unknown>> = json?.data?.content || json?.data || (Array.isArray(json) ? json : []);
					items = list.map(p => {
						const ident = (p['identification'] || {}) as Record<string, unknown>;
						const first = (p['identification.firstName'] || ident.firstName || p.firstName || '') as string;
						const last = (p['identification.lastName'] || ident.lastName || p.lastName || '') as string;
						const name = `${first} ${last}`.trim() || (p.name as string) || (p.displayName as string) || `Provider #${p.id}`;
						return { key: String(p.id || p.fhirId), label: name };
					}).filter(o => o.key && o.label);
				}
			} else {
				const res = await this.apiService.fetch('/api/fhir-resource/facilities?size=100');
				if (res.ok) {
					const json = await res.json();
					const list: Array<Record<string, unknown>> = json?.data?.content || json?.data || (Array.isArray(json) ? json : []);
					items = list.map(l => ({ key: String(l.id || l.fhirId), label: (l.name as string) || '' })).filter(o => o.key && o.label);
				}
			}

			// Overlay saved colors
			try {
				const colorsRes = await this.apiService.fetch('/api/ui-colors');
				if (colorsRes.ok) {
					const cj = await colorsRes.json();
					const cs: Array<{ category: string; entityKey: string; bgColor?: string }> = cj?.data || [];
					const category = tab === 'visit-type' ? 'visit-type' : tab === 'provider' ? 'provider' : 'location';
					for (const c of cs.filter(x => x.category === category)) {
						const item = items.find(i => i.key === c.entityKey);
						if (item && c.bgColor) { item.color = c.bgColor; }
					}
				}
			} catch { /* ignore */ }

			loading.remove();

			if (items.length === 0) {
				const empty = DOM.append(parent, DOM.$('div'));
				empty.textContent = `No ${tab === 'visit-type' ? 'visit types' : tab === 'provider' ? 'providers' : 'locations'} found.`;
				empty.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
				return;
			}

			const grid = DOM.append(parent, DOM.$('div'));
			grid.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

			for (const item of items) {
				const cur = item.color || '#3b82f6';
				const row = DOM.append(grid, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;';
				const nameEl = DOM.append(row, DOM.$('span'));
				nameEl.textContent = item.label;
				nameEl.style.cssText = 'font-size:13px;font-weight:500;flex:1;';
				const right = DOM.append(row, DOM.$('div'));
				right.style.cssText = 'display:flex;align-items:center;gap:8px;';
				const swatch = DOM.append(right, DOM.$('div'));
				swatch.style.cssText = `width:24px;height:24px;border-radius:4px;background:${cur};border:1px solid rgba(0,0,0,0.2);`;
				const colorInput = DOM.append(right, DOM.$('input')) as HTMLInputElement;
				colorInput.type = 'color';
				colorInput.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#3b82f6';
				colorInput.style.cssText = 'width:32px;height:28px;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;cursor:pointer;background:transparent;padding:1px;';
				colorInput.addEventListener('input', () => { swatch.style.background = colorInput.value; });
				const saveBtn = DOM.append(right, DOM.$('button')) as HTMLButtonElement;
				saveBtn.textContent = 'Apply';
				saveBtn.style.cssText = 'padding:3px 10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:11px;';
				saveBtn.addEventListener('click', () => this._saveUiColor(tab, item.key, item.label, colorInput.value));
			}
		} catch (e) {
			loading.textContent = `Failed to load: ${e}`;
		}
	}

	private async _saveUiColor(category: 'visit-type' | 'provider' | 'location', entityKey: string, entityLabel: string, bgColor: string): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/ui-colors', {
				method: 'POST',
				body: JSON.stringify({ category, entityKey, entityLabel, bgColor, borderColor: bgColor }),
			});
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Color saved.' });
			} else {
				const err = await res.text().catch(() => '');
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}). ${err.substring(0, 120)}` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
	}

	// allow-any-unicode-next-line
	// ----------- Helpers -----------

	private _appendCell(row: HTMLElement, text: string): void {
		const td = DOM.append(row, DOM.$('td'));
		td.textContent = text;
		td.style.cssText = 'padding:10px 12px;font-size:12px;';
	}

	private _flatten(obj: unknown, prefix: string = ''): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		if (!obj || typeof obj !== 'object') { return out; }
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			const key = prefix ? `${prefix}.${k}` : k;
			if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
				Object.assign(out, this._flatten(v, key));
			} else {
				out[key] = v;
			}
		}
		// Also keep top-level key
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			if (!Object.prototype.hasOwnProperty.call(out, k)) { out[k] = v; }
		}
		return out;
	}

	private _formatValue(v: unknown): string {
		if (v === null || v === undefined) { return '-'; }
		if (typeof v === 'boolean') { return v ? 'Yes' : 'No'; }
		if (Array.isArray(v)) {
			if (v.length >= 3 && typeof v[0] === 'number' && (v[0] as number) > 1900) {
				try {
					const d = new Date(v[0] as number, ((v[1] as number) || 1) - 1, (v[2] as number) || 1);
					return d.toLocaleDateString();
				} catch { /* keep */ }
			}
			return `[${v.length}]`;
		}
		if (typeof v === 'object') {
			const o = v as { line1?: string; city?: string; state?: string };
			if (o.line1) { return [o.line1, o.city, o.state].filter(Boolean).join(', '); }
			return JSON.stringify(v);
		}
		const s = String(v);
		return s.length > 60 ? s.substring(0, 60) + '\u2026' : s;
	}

	private _titleCase(s: string): string {
		return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
