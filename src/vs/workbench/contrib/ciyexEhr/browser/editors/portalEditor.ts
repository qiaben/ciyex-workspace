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
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { BaseCiyexInput } from './ciyexEditorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface NavItem { key: string; label: string; route: string; icon: string; visible: boolean }
interface FormField { key: string; label: string; type: string; required?: boolean }
interface PortalForm { id?: string; title: string; description?: string; active?: boolean; fields: FormField[] }
interface PortalConfig { general: Record<string, string>; features: Record<string, boolean>; forms: PortalForm[]; navigation: NavItem[] }

export class PortalEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexPortal';
	private root!: HTMLElement;
	private body!: HTMLElement;
	private config: PortalConfig = { general: {}, features: {}, forms: [], navigation: [] };
	private _dirty = false;
	private _activeTab = 'general';
	get dirty(): boolean { return this._dirty; }

	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService,
		@IFileService private readonly fileService: IFileService, @IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService, @IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService) {
		super(PortalEditor.ID, group, t, th, s);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-settings-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;';

		const header = DOM.append(this.root, DOM.$('.h'));
		header.style.cssText = 'padding:12px 24px;max-width:1000px;width:100%;margin:0 auto;';

		const tb = DOM.append(header, DOM.$('.tb'));
		tb.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const tl = DOM.append(tb, DOM.$('span'));
		tl.textContent = 'Patient Portal';
		tl.style.cssText = 'font-weight:600;font-size:14px;flex:1;';
		this._link(tb, 'Save', () => this._save());
		this._link(tb, 'Open JSON', () => this._openJson());

		// Tabs
		const tabs = DOM.append(header, DOM.$('.tabs'));
		tabs.style.cssText = 'display:flex;border-bottom:1px solid var(--vscode-editorWidget-border);margin-top:8px;';
		for (const tab of ['general', 'features', 'forms', 'navigation']) {
			const tabEl = DOM.append(tabs, DOM.$('div'));
			tabEl.textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
			tabEl.dataset.tab = tab;
			tabEl.style.cssText = `padding:8px 16px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;color:var(--vscode-descriptionForeground);`;
			tabEl.addEventListener('click', () => { this._activeTab = tab; this._render(); });
		}

		const bc = DOM.append(this.root, DOM.$('.bc'));
		bc.style.cssText = 'flex:1;overflow-y:auto;';
		this.body = DOM.append(bc, DOM.$('.b'));
		this.body.style.cssText = 'max-width:1000px;width:100%;margin:0 auto;padding:16px 24px;';
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		try { const c = await this.fileService.readFile(input.fileUri); this.config = JSON.parse(c.value.toString()); } catch { /* defaults */ }
		if (!token.isCancellationRequested) { this._render(); }
	}

	private _render(): void {
		DOM.clearNode(this.body);

		// Update tab active state
		const tabs = this.root.querySelectorAll('[data-tab]');
		for (const tab of tabs) {
			const isActive = (tab as HTMLElement).dataset.tab === this._activeTab;
			(tab as HTMLElement).style.borderBottomColor = isActive ? 'var(--vscode-focusBorder)' : 'transparent';
			(tab as HTMLElement).style.color = isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)';
		}

		switch (this._activeTab) {
			case 'general': this._renderGeneral(); break;
			case 'features': this._renderFeatures(); break;
			case 'forms': this._renderForms(); break;
			case 'navigation': this._renderNavigation(); break;
		}
	}

	private _renderGeneral(): void {
		const fields = ['name', 'url', 'language', 'timezone'];
		const labels: Record<string, string> = { name: 'Portal Name', url: 'Portal URL', language: 'Language', timezone: 'Timezone' };
		for (const key of fields) {
			const row = DOM.append(this.body, DOM.$('.setting-item'));
			row.style.cssText = 'padding:10px 0;border-bottom:1px solid rgba(128,128,128,0.1);';
			const lbl = DOM.append(row, DOM.$('label'));
			lbl.textContent = labels[key] || key;
			lbl.style.cssText = 'display:block;font-weight:500;margin-bottom:4px;';
			const input = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			input.type = 'text';
			input.value = this.config.general[key] || '';
			input.placeholder = key === 'url' ? 'https://portal.example.com' : '';
			input.style.cssText = 'width:100%;max-width:400px;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:13px;';
			input.addEventListener('change', () => { this.config.general[key] = input.value; this._dirty = true; });
		}
	}

	private async _renderFeatures(): Promise<void> {
		const featureKeys = Object.keys(this.config.features).length > 0
			? Object.keys(this.config.features)
			: ['onlineBooking', 'messaging', 'labResults', 'prescriptionRefills', 'billPay', 'formSubmission', 'telehealth', 'educationalContent'];

		for (const key of featureKeys) {
			const row = DOM.append(this.body, DOM.$('.setting-item'));
			row.style.cssText = 'padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.1);display:flex;align-items:center;gap:10px;';

			const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = this.config.features[key] !== false;
			cb.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);width:16px;height:16px;';
			cb.addEventListener('change', () => { this.config.features[key] = cb.checked; this._dirty = true; });

			const lbl = DOM.append(row, DOM.$('span'));
			lbl.textContent = key.replace(/([A-Z])/g, ' $1').trim();
			lbl.style.cssText = 'font-size:13px;text-transform:capitalize;';
		}

		this._link(this.body, '+ Add Feature', async () => {
			const name = await this.quickInputService.input({ prompt: 'Feature name (camelCase):' });
			if (name) { this.config.features[name] = true; this._dirty = true; this._render(); }
		});
	}

	private async _renderForms(): Promise<void> {
		for (let i = 0; i < this.config.forms.length; i++) {
			const form = this.config.forms[i];
			const row = DOM.append(this.body, DOM.$('.setting-item'));
			row.style.cssText = 'padding:10px 0;border-bottom:1px solid rgba(128,128,128,0.1);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const hdr = DOM.append(row, DOM.$('.hdr'));
			hdr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
			const n = DOM.append(hdr, DOM.$('span'));
			n.textContent = form.title;
			n.style.cssText = 'font-weight:500;flex:1;';
			const badge = DOM.append(hdr, DOM.$('span'));
			badge.textContent = form.active !== false ? 'Active' : 'Inactive';
			badge.style.cssText = `font-size:10px;padding:1px 6px;border-radius:3px;${form.active !== false ? 'background:rgba(46,160,67,0.15);color:#3fb950;' : 'background:rgba(128,128,128,0.15);color:var(--vscode-descriptionForeground);'}`;
			const cnt = DOM.append(hdr, DOM.$('span'));
			cnt.textContent = `${form.fields.length} fields`;
			cnt.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
			this._slink(hdr, 'Edit', () => this._editForm(i));
			this._slink(hdr, 'Delete', () => this._deleteForm(i), true);

			if (form.description) {
				const desc = DOM.append(row, DOM.$('div'));
				desc.textContent = form.description;
				desc.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
			}
		}

		this._link(this.body, '+ Add Form', async () => {
			const title = await this.quickInputService.input({ prompt: 'Form title:' });
			if (title) { this.config.forms.push({ title, fields: [], active: true }); this._dirty = true; this._render(); }
		});
	}

	private async _editForm(fi: number): Promise<void> {
		const form = this.config.forms[fi];
		const title = await this.quickInputService.input({ prompt: 'Form title:', value: form.title });
		if (title !== null && title !== undefined) { form.title = title; }
		const desc = await this.quickInputService.input({ prompt: 'Description:', value: form.description || '' });
		if (desc !== null && desc !== undefined) { form.description = desc; }
		this._dirty = true;
		this._render();
	}

	private async _deleteForm(fi: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({ message: `Delete form "${this.config.forms[fi].title}"?` });
		if (!confirmed) { return; }
		this.config.forms.splice(fi, 1);
		this._dirty = true;
		this._render();
	}

	private async _renderNavigation(): Promise<void> {
		for (let i = 0; i < this.config.navigation.length; i++) {
			const item = this.config.navigation[i];
			const row = DOM.append(this.body, DOM.$('.setting-item'));
			row.style.cssText = `padding:8px 16px;display:flex;gap:16px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:center;${item.visible === false ? 'opacity:0.45;' : ''}`;
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(255,255,255,0.03))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			const info = DOM.append(row, DOM.$('.info'));
			info.style.cssText = 'flex:1;';
			const n = DOM.append(info, DOM.$('span'));
			n.textContent = item.label;
			n.style.cssText = 'font-weight:500;';
			const r = DOM.append(info, DOM.$('span'));
			r.textContent = ` ${item.route}`;
			r.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);font-family:monospace;';

			const ctrl = DOM.append(row, DOM.$('.ctrl'));
			ctrl.style.cssText = 'display:flex;align-items:center;gap:8px;';

			const vc = DOM.append(ctrl, DOM.$('input')) as HTMLInputElement;
			vc.type = 'checkbox';
			vc.checked = item.visible !== false;
			vc.style.cssText = 'cursor:pointer;accent-color:var(--vscode-focusBorder);';
			vc.addEventListener('change', () => { item.visible = vc.checked; this._dirty = true; this._render(); });

			this._slink(ctrl, '\u25B2', () => { if (i > 0) { [this.config.navigation[i - 1], this.config.navigation[i]] = [this.config.navigation[i], this.config.navigation[i - 1]]; this._dirty = true; this._render(); } });
			this._slink(ctrl, '\u25BC', () => { if (i < this.config.navigation.length - 1) { [this.config.navigation[i], this.config.navigation[i + 1]] = [this.config.navigation[i + 1], this.config.navigation[i]]; this._dirty = true; this._render(); } });
		}

		this._link(this.body, '+ Add Nav Item', async () => {
			const label = await this.quickInputService.input({ prompt: 'Label:' });
			if (!label) { return; }
			const route = await this.quickInputService.input({ prompt: 'Route:', value: '/' }) || '/';
			this.config.navigation.push({ key: label.toLowerCase().replace(/\s+/g, '-'), label, route, icon: 'Home', visible: true });
			this._dirty = true;
			this._render();
		});
	}

	private async _save(): Promise<void> {
		const input = this.input as BaseCiyexInput;
		if (!input) { return; }
		try {
			await this.fileService.writeFile(input.fileUri, VSBuffer.fromString(JSON.stringify(this.config, null, 2)));
			this._dirty = false;
			this.notificationService.notify({ severity: Severity.Info, message: 'Portal config saved.' });
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
		}
	}

	private _openJson(): void { const i = this.input as BaseCiyexInput; if (i) { this.editorService.openEditor({ resource: i.fileUri, options: { pinned: true } }); } }
	private _link(p: HTMLElement, t: string, fn: () => void): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = 'color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;display:inline-block;margin-top:8px;'; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	private _slink(p: HTMLElement, t: string, fn: () => void, d = false): void { const a = DOM.append(p, DOM.$('a')); a.textContent = t; a.style.cssText = `color:${d ? 'var(--vscode-errorForeground)' : 'var(--vscode-textLink-foreground)'};cursor:pointer;font-size:11px;`; a.addEventListener('click', (e) => { e.preventDefault(); fn(); }); }
	override layout(dim: DOM.Dimension): void { this.root.style.height = `${dim.height}px`; this.root.style.width = `${dim.width}px`; }
}
