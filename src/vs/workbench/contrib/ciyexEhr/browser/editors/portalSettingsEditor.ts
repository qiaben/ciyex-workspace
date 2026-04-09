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
import { PortalSettingsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface PortalConfig {
	general: { name?: string; url?: string; language?: string; timezone?: string };
	features: Record<string, boolean>;
	navigation: Array<{ key: string; label: string; route: string; icon: string; visible: boolean }>;
	forms?: Array<{ id: number; title: string; formType: string; active: boolean; position: number }>;
}

const FEATURE_LABELS: Record<string, string> = {
	onlineBooking: 'Online Booking',
	messaging: 'Secure Messaging',
	labResults: 'Lab Results',
	prescriptionRefills: 'Prescription Refills',
	billPay: 'Bill Pay',
	formSubmission: 'Form Submission',
	telehealth: 'Telehealth',
	educationalContent: 'Educational Content',
};

export class PortalSettingsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexPortalSettings';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private config: PortalConfig | null = null;
	private _dirty = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(PortalSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.portal-settings-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';

		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:800px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof PortalSettingsEditorInput)) { return; }
		await this._loadConfig();
	}

	private async _loadConfig(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/portal/config');
			if (!res.ok) {
				this.contentEl.textContent = 'Failed to load portal configuration.';
				return;
			}
			const data = await res.json();
			this.config = (data?.data || data) as PortalConfig;
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login...';
		}
	}

	private _render(): void {
		if (!this.config) { return; }
		DOM.clearNode(this.contentEl);

		// Title
		const title = DOM.append(this.contentEl, DOM.$('h2'));
		title.textContent = 'Portal Settings';
		title.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 20px;';

		// Save bar
		const saveBar = DOM.append(this.contentEl, DOM.$('div'));
		saveBar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:16px;';
		const saveBtn = DOM.append(saveBar, DOM.$('button'));
		saveBtn.textContent = 'Save Changes';
		saveBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		saveBtn.addEventListener('click', () => this._save());

		// General section
		this._renderSection('General', () => this._renderGeneral());

		// Features section
		this._renderSection('Features', () => this._renderFeatures());

		// Navigation section
		this._renderSection('Navigation', () => this._renderNavigation());
	}

	private _renderSection(title: string, renderContent: () => HTMLElement): void {
		const section = DOM.append(this.contentEl, DOM.$('div'));
		section.style.cssText = 'margin-bottom:24px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		const header = DOM.append(section, DOM.$('div'));
		header.style.cssText = 'padding:12px 16px;background:rgba(0,122,204,0.08);border-bottom:1px solid var(--vscode-editorWidget-border);';
		const headerText = DOM.append(header, DOM.$('h3'));
		headerText.textContent = title;
		headerText.style.cssText = 'margin:0;font-size:14px;font-weight:600;';

		const body = DOM.append(section, DOM.$('div'));
		body.style.cssText = 'padding:16px;';
		body.appendChild(renderContent());
	}

	private _renderGeneral(): HTMLElement {
		const container = DOM.$('div');
		container.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';

		const general = this.config!.general || {};

		const fields: Array<[string, string, string]> = [
			['name', 'Portal Name', general.name || ''],
			['url', 'Portal URL', general.url || ''],
			['language', 'Language', general.language || 'en'],
			['timezone', 'Timezone', general.timezone || 'America/New_York'],
		];

		for (const [key, label, value] of fields) {
			const field = DOM.append(container, DOM.$('div'));
			const lbl = DOM.append(field, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px;font-weight:500;';
			const input = DOM.append(field, DOM.$('input')) as HTMLInputElement;
			input.type = 'text';
			input.value = value;
			input.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
			input.addEventListener('input', () => {
				if (!this.config!.general) { this.config!.general = {} as PortalConfig['general']; }
				(this.config!.general as Record<string, string>)[key] = input.value;
				this._dirty = true;
			});
		}

		return container;
	}

	private _renderFeatures(): HTMLElement {
		const container = DOM.$('div');
		container.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';

		const features = this.config!.features || {};

		for (const [key, label] of Object.entries(FEATURE_LABELS)) {
			const row = DOM.append(container, DOM.$('label'));
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = !!features[key];
			cb.style.cssText = 'cursor:pointer;';
			cb.addEventListener('change', () => {
				this.config!.features[key] = cb.checked;
				this._dirty = true;
			});

			const text = DOM.append(row, DOM.$('span'));
			text.textContent = label;
			text.style.cssText = 'font-size:13px;';
		}

		return container;
	}

	private _renderNavigation(): HTMLElement {
		const container = DOM.$('div');
		const nav = this.config!.navigation || [];

		if (nav.length === 0) {
			container.textContent = 'No navigation items configured.';
			container.style.cssText = 'color:var(--vscode-descriptionForeground);font-style:italic;';
			return container;
		}

		// Table header
		const headerRow = DOM.append(container, DOM.$('div'));
		headerRow.style.cssText = 'display:grid;grid-template-columns:40px 1fr 1fr 80px 60px;gap:8px;padding:6px 8px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);';
		for (const col of ['Icon', 'Label', 'Route', 'Key', 'Visible']) {
			DOM.append(headerRow, DOM.$('span')).textContent = col;
		}

		for (let i = 0; i < nav.length; i++) {
			const item = nav[i];
			const row = DOM.append(container, DOM.$('div'));
			row.style.cssText = 'display:grid;grid-template-columns:40px 1fr 1fr 80px 60px;gap:8px;padding:6px 8px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.1);';

			// Icon
			const iconEl = DOM.append(row, DOM.$('span'));
			iconEl.textContent = item.icon || '📄';
			iconEl.style.cssText = 'font-size:16px;text-align:center;';

			// Label (editable)
			const labelInput = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			labelInput.value = item.label;
			labelInput.style.cssText = 'padding:4px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:12px;';
			labelInput.addEventListener('input', () => { nav[i].label = labelInput.value; this._dirty = true; });

			// Route
			const routeEl = DOM.append(row, DOM.$('span'));
			routeEl.textContent = item.route;
			routeEl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

			// Key
			const keyEl = DOM.append(row, DOM.$('span'));
			keyEl.textContent = item.key;
			keyEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

			// Visible toggle
			const visCb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			visCb.type = 'checkbox';
			visCb.checked = item.visible;
			visCb.style.cssText = 'cursor:pointer;';
			visCb.addEventListener('change', () => { nav[i].visible = visCb.checked; this._dirty = true; });
		}

		return container;
	}

	private async _save(): Promise<void> {
		if (!this.config || !this._dirty) { return; }
		try {
			const res = await this.apiService.fetch('/api/portal/config', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(this.config),
			});
			if (res.ok) {
				this._dirty = false;
				// Flash save confirmation
				const toast = DOM.append(this.contentEl, DOM.$('div'));
				toast.textContent = '✓ Settings saved';
				toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:8px 16px;background:#22c55e;color:#fff;border-radius:6px;font-size:13px;z-index:1000;';
				setTimeout(() => toast.remove(), 2000);
			}
		} catch { /* save failed */ }
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
