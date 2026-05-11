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
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { PortalSettingsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface PortalGeneral {
	portalName?: string;
	registrationMode?: string;
	welcomeMessage?: string;
	sessionTimeout?: number;
	primaryColor?: string;
	allowSelfRegistration?: boolean;
	requireEmailVerification?: boolean;
	maintenanceMode?: boolean;
	maintenanceMessage?: string;
	// legacy aliases used by ciyex-workspace
	name?: string;
	url?: string;
	language?: string;
	timezone?: string;
}

interface PortalFeatureValue {
	enabled?: boolean;
	[key: string]: unknown;
}

interface PortalNavItem {
	key: string;
	label: string;
	route?: string;
	icon?: string;
	visible: boolean;
	position?: number;
}

interface PortalForm {
	id?: number;
	formKey: string;
	formType: string;
	title: string;
	description?: string;
	fieldConfig?: unknown;
	settings?: Record<string, boolean>;
	active?: boolean;
	position?: number;
}

interface PortalConfig {
	general: PortalGeneral;
	features: Record<string, PortalFeatureValue | boolean>;
	navigation: PortalNavItem[];
	forms?: PortalForm[];
}

type Tab = 'general' | 'features' | 'forms' | 'navigation';

const FEATURE_META: Record<string, { label: string; description: string; subToggles?: Array<{ key: string; label: string }> }> = {
	appointments: {
		label: 'Appointments',
		description: 'View upcoming and past appointments',
		subToggles: [
			{ key: 'allowScheduling', label: 'Allow patients to schedule appointments' },
			{ key: 'allowCancellation', label: 'Allow patients to cancel appointments' },
		],
	},
	messaging: { label: 'Secure Messaging', description: 'Send/receive secure messages with care team', subToggles: [{ key: 'allowNewConversations', label: 'Allow patients to start new conversations' }] },
	labs: { label: 'Lab Results', description: 'View lab results and diagnostic reports', subToggles: [{ key: 'showResults', label: 'Show lab results to patients' }] },
	medications: { label: 'Medications', description: 'View current and past medications', subToggles: [{ key: 'allowRefillRequests', label: 'Allow medication refill requests' }] },
	vitals: { label: 'Vitals', description: 'View and track vital signs', subToggles: [{ key: 'allowEntry', label: 'Allow patients to enter vitals' }] },
	documents: { label: 'Documents', description: 'Access health documents and records', subToggles: [{ key: 'allowUpload', label: 'Allow patients to upload documents' }] },
	billing: { label: 'Billing', description: 'View billing statements and payment history', subToggles: [{ key: 'allowPayments', label: 'Allow online payments' }] },
	insurance: { label: 'Insurance', description: 'View and manage insurance information', subToggles: [{ key: 'allowEditing', label: 'Allow patients to edit insurance info' }] },
	demographics: { label: 'Demographics', description: 'View and update personal information', subToggles: [{ key: 'allowEditing', label: 'Allow patients to edit demographics' }] },
	education: { label: 'Patient Education', description: 'Access educational materials and resources' },
	allergies: { label: 'Allergies & History', description: 'View allergy and medical history' },
	reports: { label: 'Reports', description: 'Access health reports and summaries' },
	telehealth: { label: 'Telehealth', description: 'Join virtual visits and video appointments' },
};

export class PortalSettingsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexPortalSettings';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private config: PortalConfig | null = null;
	private forms: PortalForm[] = [];
	private activeTab: Tab = 'general';
	private expandedFeatures = new Set<string>();
	private editingForm: PortalForm | null = null;
	private _saving = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(PortalSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.portal-settings-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';

		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1100px;margin:0 auto;padding:24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof PortalSettingsEditorInput)) { return; }
		await this._load();
	}

	private async _load(): Promise<void> {
		this.contentEl.textContent = 'Loading portal configuration\u2026';
		this.contentEl.style.color = 'var(--vscode-descriptionForeground)';
		try {
			const [configRes, formsRes] = await Promise.all([
				this.apiService.fetch('/api/portal/config'),
				this.apiService.fetch('/api/portal/config/forms').catch(() => null),
			]);
			if (configRes.ok) {
				const json = await configRes.json();
				const data = json?.data || json;
				this.config = {
					general: data?.general || {},
					features: data?.features || {},
					navigation: Array.isArray(data?.navigation) ? data.navigation : [],
					forms: Array.isArray(data?.forms) ? data.forms : undefined,
				};
			} else {
				this.config = { general: {}, features: {}, navigation: [] };
			}
			if (formsRes && formsRes.ok) {
				const json = await formsRes.json();
				const data = json?.data || json;
				this.forms = Array.isArray(data) ? data : [];
			}
			this.contentEl.style.color = '';
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login\u2026';
		}
	}

	private _render(): void {
		if (!this.config) { return; }
		DOM.clearNode(this.contentEl);

		// Header
		const header = DOM.append(this.contentEl, DOM.$('.ps-header'));
		header.style.cssText = 'margin-bottom:20px;';
		const title = DOM.append(header, DOM.$('h1'));
		title.textContent = '\u{1F310} Portal Configuration';
		title.style.cssText = 'margin:0 0 4px;font-size:22px;font-weight:600;display:flex;align-items:center;gap:8px;';
		const subtitle = DOM.append(header, DOM.$('p'));
		subtitle.textContent = 'Configure the patient portal \u2014 features, forms, navigation, and branding';
		subtitle.style.cssText = 'margin:0;font-size:13px;color:var(--vscode-descriptionForeground);';

		// Tab bar
		const tabBar = DOM.append(this.contentEl, DOM.$('.ps-tabbar'));
		tabBar.style.cssText = 'display:flex;gap:4px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:24px;';
		this._tabBtn(tabBar, 'general', '\u{2699} General');
		this._tabBtn(tabBar, 'features', '\u{1F6E1} Features');
		this._tabBtn(tabBar, 'forms', '\u{1F4C4} Forms');
		this._tabBtn(tabBar, 'navigation', '\u{1F9ED} Navigation');

		switch (this.activeTab) {
			case 'general': this._renderGeneral(); break;
			case 'features': this._renderFeatures(); break;
			case 'forms': this._renderForms(); break;
			case 'navigation': this._renderNavigation(); break;
		}
	}

	private _tabBtn(parent: HTMLElement, key: Tab, label: string): void {
		const btn = DOM.append(parent, DOM.$('button'));
		btn.textContent = label;
		const isActive = this.activeTab === key;
		btn.style.cssText = `padding:8px 16px;background:transparent;border:none;border-bottom:2px solid ${isActive ? 'var(--vscode-focusBorder)' : 'transparent'};color:${isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};cursor:pointer;font-size:13px;font-weight:500;margin-bottom:-1px;`;
		btn.addEventListener('click', () => { this.activeTab = key; this._render(); });
	}

	private _saveButton(parent: HTMLElement, label: string, onSave: () => void): void {
		const wrap = DOM.append(parent, DOM.$('.ps-save-row'));
		wrap.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
		const lbl = DOM.append(wrap, DOM.$('h3'));
		lbl.textContent = label;
		lbl.style.cssText = 'margin:0;font-size:15px;font-weight:600;';

		const btn = DOM.append(wrap, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = this._saving ? 'Saving\u2026' : '\u{1F4BE} Save';
		btn.disabled = this._saving;
		btn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		btn.addEventListener('click', () => onSave());
	}

	// allow-any-unicode-next-line
	// ─── General Tab ───────────────────────────────────────────────

	private _renderGeneral(): void {
		this._saveButton(this.contentEl, 'General Settings', () => this._saveSection('general', this.config!.general));

		const grid = DOM.append(this.contentEl, DOM.$('.ps-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;margin-bottom:20px;';

		// Portal Name
		this._textField(grid, 'Portal Name', () => this.config!.general.portalName || this.config!.general.name || '', v => {
			this.config!.general.portalName = v;
			this.config!.general.name = v;
		}, 'Patient Portal');

		// Registration Mode
		this._selectField(grid, 'Registration Mode', () => this.config!.general.registrationMode || 'open', v => { this.config!.general.registrationMode = v; }, [
			['open', 'Open (Auto-Approve)'],
			['approval-required', 'Requires Staff Approval'],
			['invite-only', 'Invite Only'],
		]);

		// Welcome Message (full row)
		this._textArea(grid, 'Welcome Message', () => this.config!.general.welcomeMessage || '', v => { this.config!.general.welcomeMessage = v; }, 'Welcome to your patient portal', 2);

		// Session Timeout
		this._numberField(grid, 'Session Timeout (minutes)', () => this.config!.general.sessionTimeout || 30, v => { this.config!.general.sessionTimeout = v; }, 5, 480);

		// Primary Color
		this._colorField(grid, 'Primary Color', () => this.config!.general.primaryColor || '#2563eb', v => { this.config!.general.primaryColor = v; });

		// Access controls
		const acHeader = DOM.append(this.contentEl, DOM.$('.ps-section-header'));
		acHeader.textContent = 'ACCESS CONTROLS';
		acHeader.style.cssText = 'margin:24px 0 12px;font-size:11px;font-weight:600;letter-spacing:1px;color:var(--vscode-descriptionForeground);text-transform:uppercase;border-top:1px solid var(--vscode-editorWidget-border);padding-top:16px;';

		this._toggleRow(this.contentEl, 'Allow Self-Registration', 'Patients can create their own portal accounts',
			() => this.config!.general.allowSelfRegistration !== false, v => { this.config!.general.allowSelfRegistration = v; });
		this._toggleRow(this.contentEl, 'Require Email Verification', 'New accounts must verify their email address',
			() => !!this.config!.general.requireEmailVerification, v => { this.config!.general.requireEmailVerification = v; });
		this._toggleRow(this.contentEl, 'Maintenance Mode', 'Temporarily disable portal access (shows maintenance message)',
			() => !!this.config!.general.maintenanceMode, v => { this.config!.general.maintenanceMode = v; this._render(); });

		if (this.config!.general.maintenanceMode) {
			const mm = DOM.append(this.contentEl, DOM.$('.ps-mm-wrap'));
			mm.style.cssText = 'margin-top:12px;';
			const lbl = DOM.append(mm, DOM.$('label'));
			lbl.textContent = 'Maintenance Message';
			lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;';
			const ta = DOM.append(mm, DOM.$('textarea')) as HTMLTextAreaElement;
			ta.value = this.config!.general.maintenanceMessage || '';
			ta.rows = 2;
			ta.style.cssText = 'width:100%;padding:8px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;font-family:inherit;box-sizing:border-box;outline:none;';
			ta.addEventListener('input', () => { this.config!.general.maintenanceMessage = ta.value; });
		}
	}

	// allow-any-unicode-next-line
	// ─── Features Tab ──────────────────────────────────────────────

	private _renderFeatures(): void {
		this._saveButton(this.contentEl, 'Feature Toggles', () => this._saveSection('features', this.config!.features));

		const desc = DOM.append(this.contentEl, DOM.$('p'));
		desc.textContent = 'Enable or disable features in the patient portal. Sub-options control what patients can do within each feature.';
		desc.style.cssText = 'margin:0 0 20px;color:var(--vscode-descriptionForeground);font-size:13px;';

		const list = DOM.append(this.contentEl, DOM.$('.ps-features'));
		list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

		for (const [key, meta] of Object.entries(FEATURE_META)) {
			const featRaw = this.config!.features[key];
			const feat: PortalFeatureValue = typeof featRaw === 'boolean' ? { enabled: featRaw } : (featRaw || { enabled: true });
			const hasSubs = !!(meta.subToggles && meta.subToggles.length);
			const expanded = this.expandedFeatures.has(key);

			const card = DOM.append(list, DOM.$('.ps-feature-card'));
			card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

			const head = DOM.append(card, DOM.$('.ps-feature-head'));
			head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;';

			const left = DOM.append(head, DOM.$('div'));
			left.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;';

			if (hasSubs) {
				const chev = DOM.append(left, DOM.$('button'));
				chev.textContent = expanded ? '\u25BC' : '\u25B6';
				chev.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.5;font-size:10px;width:14px;';
				chev.addEventListener('click', () => {
					if (expanded) { this.expandedFeatures.delete(key); } else { this.expandedFeatures.add(key); }
					this._render();
				});
			} else {
				const spacer = DOM.append(left, DOM.$('span'));
				spacer.style.cssText = 'width:14px;';
			}

			const labels = DOM.append(left, DOM.$('div'));
			const lbl = DOM.append(labels, DOM.$('div'));
			lbl.textContent = meta.label;
			lbl.style.cssText = 'font-weight:500;font-size:13px;';
			const sub = DOM.append(labels, DOM.$('div'));
			sub.textContent = meta.description;
			sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

			this._toggleSwitch(head, feat.enabled !== false, v => {
				const existing = (typeof featRaw === 'object' && featRaw !== null) ? featRaw : {};
				this.config!.features[key] = { ...existing, enabled: v };

			});

			if (hasSubs && expanded && feat.enabled !== false) {
				const subs = DOM.append(card, DOM.$('.ps-feature-subs'));
				subs.style.cssText = 'border-top:1px solid var(--vscode-editorWidget-border);background:rgba(0,0,0,0.05);padding:10px 14px 10px 38px;display:flex;flex-direction:column;gap:8px;';
				for (const sub of meta.subToggles!) {
					const r = DOM.append(subs, DOM.$('.ps-subtog'));
					r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
					const subLbl = DOM.append(r, DOM.$('span'));
					subLbl.textContent = sub.label;
					subLbl.style.cssText = 'font-size:12px;';
					this._toggleSwitch(r, feat[sub.key] !== false, v => {
						const existing = (typeof featRaw === 'object' && featRaw !== null) ? featRaw : { enabled: true };
						this.config!.features[key] = { ...existing, [sub.key]: v };

					});
				}
			}
		}
	}

	// allow-any-unicode-next-line
	// ─── Forms Tab ──────────────────────────────────────────────

	private _renderForms(): void {
		if (this.editingForm) {
			this._renderFormEditor(this.editingForm);
			return;
		}

		const headerWrap = DOM.append(this.contentEl, DOM.$('.ps-forms-header'));
		headerWrap.style.cssText = 'margin-bottom:8px;';
		const title = DOM.append(headerWrap, DOM.$('h3'));
		title.textContent = 'Onboarding & Consent Forms';
		title.style.cssText = 'margin:0 0 4px;font-size:15px;font-weight:600;';
		const sub = DOM.append(headerWrap, DOM.$('p'));
		sub.textContent = 'Configure forms that patients complete during registration or as part of their care.';
		sub.style.cssText = 'margin:0 0 20px;color:var(--vscode-descriptionForeground);font-size:13px;';

		const onboarding = this.forms.filter(f => f.formType === 'onboarding');
		const consents = this.forms.filter(f => f.formType === 'consent');
		const others = this.forms.filter(f => f.formType !== 'onboarding' && f.formType !== 'consent');

		this._renderFormGroup('Onboarding Forms', 'Completed after patient registration', onboarding, 'onboarding');
		this._renderFormGroup('Consent Forms', 'HIPAA, telehealth, treatment authorization', consents, 'consent');
		this._renderFormGroup('Custom Forms', 'Additional configurable forms', others, 'custom');
	}

	private _renderFormGroup(title: string, description: string, forms: PortalForm[], type: string): void {
		const group = DOM.append(this.contentEl, DOM.$('.ps-form-group'));
		group.style.cssText = 'margin-bottom:24px;';

		const head = DOM.append(group, DOM.$('.ps-form-group-head'));
		head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';

		const left = DOM.append(head, DOM.$('div'));
		const lbl = DOM.append(left, DOM.$('div'));
		lbl.textContent = title;
		lbl.style.cssText = 'font-weight:600;font-size:13px;';
		const desc = DOM.append(left, DOM.$('div'));
		desc.textContent = description;
		desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		const addBtn = DOM.append(head, DOM.$('button'));
		addBtn.textContent = '+ Add';
		addBtn.style.cssText = 'padding:4px 10px;background:transparent;border:1px solid var(--vscode-textLink-foreground,#3794ff);border-radius:4px;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;font-size:11px;';
		addBtn.addEventListener('click', () => this._newForm(type));

		if (forms.length === 0) {
			const empty = DOM.append(group, DOM.$('div'));
			empty.textContent = 'No forms configured';
			empty.style.cssText = 'padding:18px;border:1px dashed var(--vscode-editorWidget-border);border-radius:6px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
			return;
		}

		for (const form of forms) {
			const row = DOM.append(group, DOM.$('.ps-form-row'));
			row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;margin-bottom:6px;${form.active === false ? 'opacity:0.5;' : ''}`;

			const info = DOM.append(row, DOM.$('div'));
			info.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;';
			const grip = DOM.append(info, DOM.$('span'));
			grip.textContent = '\u22EE\u22EE';
			grip.style.cssText = 'opacity:0.3;font-size:11px;letter-spacing:-2px;';
			const titleCol = DOM.append(info, DOM.$('div'));
			const formTitle = DOM.append(titleCol, DOM.$('div'));
			formTitle.textContent = form.title;
			formTitle.style.cssText = 'font-weight:500;font-size:13px;';
			const meta = DOM.append(titleCol, DOM.$('div'));
			meta.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:6px;margin-top:2px;';
			const keyCode = DOM.append(meta, DOM.$('code'));
			keyCode.textContent = form.formKey;
			keyCode.style.cssText = 'font-family:var(--vscode-editor-font-family,monospace);';
			if (form.settings?.required) { this._formBadge(meta, 'Required', '#ef4444'); }
			if (form.settings?.requireSignature) { this._formBadge(meta, 'Signature', '#a855f7'); }
			if (form.settings?.showOnRegistration) { this._formBadge(meta, 'On Registration', '#3b82f6'); }

			const actions = DOM.append(row, DOM.$('div'));
			actions.style.cssText = 'display:flex;align-items:center;gap:6px;';

			this._iconBtn(actions, '\u270F', 'Edit', () => { this.editingForm = JSON.parse(JSON.stringify(form)); this._render(); });
			this._iconBtn(actions, form.active === false ? '\u{1F441}\u200D\u{1F5E8}' : '\u{1F441}', form.active === false ? 'Enable' : 'Disable', async () => {
				if (!form.id) { return; }
				try {
					await this.apiService.fetch(`/api/portal/config/forms/${form.id}/toggle?active=${form.active === false}`, { method: 'PATCH' });
					await this._load();
				} catch { /* ignore */ }
			});
			if (form.id) {
				this._iconBtn(actions, '\u{1F5D1}', 'Delete', () => this._deleteForm(form.id!));
			}
		}
	}

	private _formBadge(parent: HTMLElement, text: string, color: string): void {
		const b = DOM.append(parent, DOM.$('span'));
		b.textContent = text;
		b.style.cssText = `padding:1px 5px;border-radius:3px;font-size:9px;background:${color}25;color:${color};`;
	}

	private _iconBtn(parent: HTMLElement, icon: string, title: string, fn: () => void): void {
		const btn = DOM.append(parent, DOM.$('button'));
		btn.textContent = icon;
		btn.title = title;
		btn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.7;font-size:12px;padding:4px 8px;border-radius:3px;';
		btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.06))'; btn.style.opacity = '1'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = ''; btn.style.opacity = '0.7'; });
		btn.addEventListener('click', () => fn());
	}

	private _newForm(type: string): void {
		this._inlineDialog('New Form', [
			{ label: 'Form Title', key: 'title', placeholder: 'Patient Onboarding Form' },
			{ label: 'Form Key (lowercase, hyphens)', key: 'formKey', placeholder: 'patient-onboarding' },
		], values => {
			if (!values.title) { return; }
			const formKey = values.formKey || values.title.toLowerCase().replace(/[^a-z0-9]/g, '-');
			this.editingForm = {
				formKey,
				formType: type,
				title: values.title,
				description: '',
				fieldConfig: { sections: [] },
				settings: { required: false, showOnRegistration: false, requireSignature: false },
				active: true,
				position: this.forms.length,
			};
			this._render();
		});
	}

	private _inlineDialog(title: string, fields: Array<{ label: string; key: string; placeholder?: string; value?: string }>, onConfirm: (values: Record<string, string>) => void): void {
		const overlay = DOM.append(this.root, DOM.$('.ps-dialog-overlay'));
		overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const dialog = DOM.append(overlay, DOM.$('.ps-dialog'));
		dialog.style.cssText = 'background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:20px;min-width:340px;max-width:480px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
		const titleEl = DOM.append(dialog, DOM.$('h3'));
		titleEl.textContent = title;
		titleEl.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;';
		const inputs: Record<string, HTMLInputElement> = {};
		for (const field of fields) {
			const wrap = DOM.append(dialog, DOM.$('div'));
			wrap.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(wrap, DOM.$('label'));
			lbl.textContent = field.label;
			lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			input.type = 'text';
			input.value = field.value || '';
			input.placeholder = field.placeholder || '';
			input.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
			inputs[field.key] = input;
		}
		const btnRow = DOM.append(dialog, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:12px;';
		const confirmBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		confirmBtn.textContent = 'OK';
		confirmBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		const close = () => overlay.remove();
		cancelBtn.addEventListener('click', close);
		overlay.addEventListener('click', e => { if (e.target === overlay) { close(); } });
		confirmBtn.addEventListener('click', () => {
			const values: Record<string, string> = {};
			for (const [key, input] of Object.entries(inputs)) { values[key] = input.value.trim(); }
			close();
			onConfirm(values);
		});
		const inputArr = Object.values(inputs);
		if (inputArr.length > 0) { setTimeout(() => inputArr[0].focus(), 50); }
		inputArr[inputArr.length - 1]?.addEventListener('keydown', e => { if (e.key === 'Enter') { confirmBtn.click(); } });
	}

	private _renderFormEditor(form: PortalForm): void {
		const headerRow = DOM.append(this.contentEl, DOM.$('.ps-fe-header'));
		headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;';
		const left = DOM.append(headerRow, DOM.$('div'));
		left.style.cssText = 'display:flex;align-items:center;gap:10px;';
		const back = DOM.append(left, DOM.$('button'));
		back.textContent = '\u2715';
		back.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--vscode-foreground);font-size:16px;opacity:0.7;';
		back.addEventListener('click', () => { this.editingForm = null; this._render(); });
		const title = DOM.append(left, DOM.$('h3'));
		title.textContent = form.id ? 'Edit Form' : 'New Form';
		title.style.cssText = 'margin:0;font-size:15px;font-weight:600;';

		const saveBtn = DOM.append(headerRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = this._saving ? 'Saving\u2026' : '\u{1F4BE} Save Form';
		saveBtn.disabled = this._saving || !form.formKey || !form.title;
		saveBtn.style.cssText = 'padding:5px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', () => this._saveForm(form));

		const grid = DOM.append(this.contentEl, DOM.$('.ps-fe-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;margin-bottom:20px;';

		this._textField(grid, 'Form Key (unique identifier)', () => form.formKey, v => { form.formKey = v.replace(/[^a-z0-9-]/g, ''); }, 'patient-onboarding', !!form.id);
		this._selectField(grid, 'Form Type', () => form.formType, v => { form.formType = v; }, [
			['onboarding', 'Onboarding'], ['consent', 'Consent'], ['intake', 'Intake'], ['custom', 'Custom'],
		]);
		this._textField(grid, 'Title', () => form.title, v => { form.title = v; }, 'Patient Onboarding Form');
		this._numberField(grid, 'Position', () => form.position || 0, v => { form.position = v; }, 0, 999);
		this._textArea(grid, 'Description', () => form.description || '', v => { form.description = v; }, 'Instructions shown to the patient', 2);

		const settingsHeader = DOM.append(this.contentEl, DOM.$('h4'));
		settingsHeader.textContent = 'FORM SETTINGS';
		settingsHeader.style.cssText = 'margin:24px 0 12px;font-size:11px;font-weight:600;letter-spacing:1px;color:var(--vscode-descriptionForeground);text-transform:uppercase;border-top:1px solid var(--vscode-editorWidget-border);padding-top:16px;';

		this._toggleRow(this.contentEl, 'Required', 'Patient must complete this form',
			() => form.settings?.required === true, v => { form.settings = { ...(form.settings || {}), required: v }; });
		this._toggleRow(this.contentEl, 'Show on Registration', 'Present immediately after patient registers',
			() => form.settings?.showOnRegistration === true, v => { form.settings = { ...(form.settings || {}), showOnRegistration: v }; });
		this._toggleRow(this.contentEl, 'Require Signature', 'Patient must provide electronic signature',
			() => form.settings?.requireSignature === true, v => { form.settings = { ...(form.settings || {}), requireSignature: v }; });

		const fieldsNote = DOM.append(this.contentEl, DOM.$('div'));
		fieldsNote.textContent = 'Tip: Edit the form fields JSON in the API or use the EHR UI for visual field editing.';
		fieldsNote.style.cssText = 'margin-top:16px;padding:12px;border:1px dashed var(--vscode-editorWidget-border);border-radius:6px;font-size:11px;color:var(--vscode-descriptionForeground);';
	}

	private async _saveForm(form: PortalForm): Promise<void> {
		this._saving = true;
		this._render();
		try {
			const method = form.id ? 'PUT' : 'POST';
			const url = form.id ? `/api/portal/config/forms/${form.id}` : '/api/portal/config/forms';
			const res = await this.apiService.fetch(url, { method, body: JSON.stringify(form) });
			if (res.ok) {
				this.editingForm = null;
				await this._load();
				this.notificationService.notify({ severity: Severity.Info, message: 'Form saved.' });
				return;
			}
			const err = await res.json().catch(() => null);
			this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${res.status})` });
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
		this._saving = false;
		this._render();
	}

	private async _deleteForm(id: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: 'Delete this form? This cannot be undone.' });
		if (!confirmed) { return; }
		try {
			await this.apiService.fetch(`/api/portal/config/forms/${id}`, { method: 'DELETE' });
			await this._load();
			this.notificationService.notify({ severity: Severity.Info, message: 'Form deleted.' });
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Delete failed: ${e}` });
		}
	}

	// allow-any-unicode-next-line
	// ─── Navigation Tab ──────────────────────────────────────────────

	private _renderNavigation(): void {
		this._saveButton(this.contentEl, 'Portal Navigation', () => this._saveSection('navigation', this.config!.navigation));

		const note = DOM.append(this.contentEl, DOM.$('p'));
		note.textContent = 'Configure the patient portal sidebar menu items.';
		note.style.cssText = 'margin:0 0 16px;color:var(--vscode-descriptionForeground);font-size:12px;';

		const list = DOM.append(this.contentEl, DOM.$('.ps-nav'));
		list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

		if (this.config!.navigation.length === 0) {
			const empty = DOM.append(list, DOM.$('div'));
			empty.textContent = 'No navigation items configured. Save defaults to initialize.';
			empty.style.cssText = 'padding:24px;text-align:center;color:var(--vscode-descriptionForeground);';
			return;
		}

		for (let i = 0; i < this.config!.navigation.length; i++) {
			const item = this.config!.navigation[i];
			const row = DOM.append(list, DOM.$('.ps-nav-item'));
			row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;${item.visible ? '' : 'opacity:0.5;'}`;

			const grip = DOM.append(row, DOM.$('span'));
			grip.textContent = '\u22EE\u22EE';
			grip.style.cssText = 'opacity:0.3;font-size:11px;letter-spacing:-2px;';

			const keyLbl = DOM.append(row, DOM.$('code'));
			keyLbl.textContent = item.key;
			keyLbl.style.cssText = 'font-family:var(--vscode-editor-font-family,monospace);font-size:10px;color:var(--vscode-descriptionForeground);width:120px;';

			const labelInput = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			labelInput.value = item.label;
			labelInput.style.cssText = 'flex:1;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:12px;outline:none;';
			labelInput.addEventListener('input', () => { item.label = labelInput.value; });

			this._iconBtn(row, '\u25B2', 'Move up', () => {
				if (i === 0) { return; }
				[this.config!.navigation[i - 1], this.config!.navigation[i]] = [this.config!.navigation[i], this.config!.navigation[i - 1]];
				this.config!.navigation.forEach((it, idx) => { it.position = idx; });
				this._render();
			});
			this._iconBtn(row, '\u25BC', 'Move down', () => {
				if (i === this.config!.navigation.length - 1) { return; }
				[this.config!.navigation[i], this.config!.navigation[i + 1]] = [this.config!.navigation[i + 1], this.config!.navigation[i]];
				this.config!.navigation.forEach((it, idx) => { it.position = idx; });
				this._render();
			});
			this._iconBtn(row, item.visible ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}', item.visible ? 'Hide' : 'Show', () => {
				item.visible = !item.visible;
				this._render();
			});
		}
	}

	// allow-any-unicode-next-line
	// ─── Helpers ──────────────────────────────────────────────

	private _textField(parent: HTMLElement, label: string, get: () => string, set: (v: string) => void, placeholder = '', readOnly = false): void {
		const cell = DOM.append(parent, DOM.$('.ps-cell'));
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const input = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
		input.type = 'text';
		input.value = get();
		input.placeholder = placeholder;
		input.readOnly = readOnly;
		input.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
		input.addEventListener('focus', () => { input.style.borderColor = 'var(--vscode-focusBorder)'; });
		input.addEventListener('blur', () => { input.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });
		input.addEventListener('input', () => { set(input.value); });
	}

	private _numberField(parent: HTMLElement, label: string, get: () => number, set: (v: number) => void, min: number, max: number): void {
		const cell = DOM.append(parent, DOM.$('.ps-cell'));
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const input = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
		input.type = 'number';
		input.value = String(get());
		input.min = String(min);
		input.max = String(max);
		input.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
		input.addEventListener('input', () => { set(parseInt(input.value, 10) || min); });
	}

	private _selectField(parent: HTMLElement, label: string, get: () => string, set: (v: string) => void, options: Array<[string, string]>): void {
		const cell = DOM.append(parent, DOM.$('.ps-cell'));
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
		sel.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));font-size:13px;cursor:pointer;outline:none;';
		const cur = get();
		for (const [v, t] of options) {
			const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			opt.value = v;
			opt.textContent = t;
			if (v === cur) { opt.selected = true; }
		}
		sel.addEventListener('change', () => { set(sel.value); });
	}

	private _textArea(parent: HTMLElement, label: string, get: () => string, set: (v: string) => void, placeholder: string, span: number): void {
		const cell = DOM.append(parent, DOM.$('.ps-cell'));
		cell.style.cssText = `grid-column:span ${span};`;
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
		ta.value = get();
		ta.rows = 3;
		ta.placeholder = placeholder;
		ta.style.cssText = 'width:100%;padding:8px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;font-family:inherit;box-sizing:border-box;outline:none;resize:vertical;';
		ta.addEventListener('input', () => { set(ta.value); });
	}

	private _colorField(parent: HTMLElement, label: string, get: () => string, set: (v: string) => void): void {
		const cell = DOM.append(parent, DOM.$('.ps-cell'));
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const wrap = DOM.append(cell, DOM.$('.ps-color'));
		wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const color = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		color.type = 'color';
		color.value = get();
		color.style.cssText = 'width:38px;height:32px;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;cursor:pointer;background:transparent;padding:2px;';
		const text = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		text.type = 'text';
		text.value = get();
		text.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
		color.addEventListener('input', () => { set(color.value); text.value = color.value; });
		text.addEventListener('input', () => { set(text.value); if (/^#[0-9a-f]{6}$/i.test(text.value)) { color.value = text.value; } });
	}

	private _toggleRow(parent: HTMLElement, label: string, description: string, get: () => boolean, set: (v: boolean) => void): void {
		const row = DOM.append(parent, DOM.$('.ps-toggle-row'));
		row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 0;';
		const left = DOM.append(row, DOM.$('div'));
		const lbl = DOM.append(left, DOM.$('div'));
		lbl.textContent = label;
		lbl.style.cssText = 'font-weight:500;font-size:13px;';
		const desc = DOM.append(left, DOM.$('div'));
		desc.textContent = description;
		desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		this._toggleSwitch(row, get(), set);
	}

	private _toggleSwitch(parent: HTMLElement, initial: boolean, set: (v: boolean) => void): void {
		const sw = DOM.append(parent, DOM.$('button'));
		const update = (val: boolean) => {
			sw.style.cssText = `position:relative;width:38px;height:22px;border-radius:11px;border:none;cursor:pointer;background:${val ? 'var(--vscode-focusBorder,#0e639c)' : 'rgba(128,128,128,0.4)'};transition:background 120ms;flex-shrink:0;`;
			DOM.clearNode(sw);
			const knob = DOM.append(sw, DOM.$('span'));
			knob.style.cssText = `position:absolute;top:3px;${val ? 'right:3px;' : 'left:3px;'}width:16px;height:16px;border-radius:50%;background:#fff;`;
		};
		let val = initial;
		update(val);
		sw.addEventListener('click', () => { val = !val; update(val); set(val); });
	}

	private async _saveSection(section: 'general' | 'features' | 'navigation', data: unknown): Promise<void> {
		this._saving = true;
		this._render();
		try {
			const res = await this.apiService.fetch(`/api/portal/config/${section}`, {
				method: 'PATCH',
				body: JSON.stringify(data),
			});
			if (res.ok) {

				this.notificationService.notify({ severity: Severity.Info, message: `${section.charAt(0).toUpperCase() + section.slice(1)} saved.` });
			} else {
				// Fallback to PUT full config
				const full = await this.apiService.fetch('/api/portal/config', {
					method: 'PUT',
					body: JSON.stringify(this.config),
				});
				if (full.ok) {

					this.notificationService.notify({ severity: Severity.Info, message: 'Configuration saved.' });
				} else {
					const err = await full.json().catch(() => null);
					this.notificationService.notify({ severity: Severity.Error, message: err?.message || `Save failed (${full.status})` });
				}
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
		this._saving = false;
		this._render();
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
