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
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EncounterFormEditorInput } from './ciyexEditorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface FieldSection { key: string; title: string; columns: number; visible: boolean; collapsible?: boolean; collapsed?: boolean; fields: FieldDef[] }
interface FieldDef { key: string; label: string; type: string; required?: boolean; colSpan?: number; placeholder?: string; options?: Array<{ label: string; value: string }>; validation?: Record<string, unknown> }

// All sections use VS Code focus blue

export class EncounterFormEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexEncounterForm';

	private root!: HTMLElement;
	private headerBar!: HTMLElement;
	private tocNav!: HTMLElement;
	private scrollArea!: HTMLElement;
	private patientId = '';
	private encounterId = '';
	private patientName = '';
	private encounterData: Record<string, unknown> = {};
	private formSections: FieldSection[] = [];
	private readonly _configHome: URI;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(EncounterFormEditor.ID, group, telemetryService, themeService, storageService);
		this._configHome = URI.joinPath(environmentService.userRoamingDataHome, '.ciyex');
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-encounter-form'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		// Header
		this.headerBar = DOM.append(this.root, DOM.$('div'));
		this.headerBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;align-items:center;gap:10px;';

		// Body: TOC + scroll
		const body = DOM.append(this.root, DOM.$('div'));
		body.style.cssText = 'flex:1;display:flex;overflow:hidden;';

		this.tocNav = DOM.append(body, DOM.$('div'));
		this.tocNav.style.cssText = 'width:200px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--vscode-editorWidget-border);padding:8px 0;';

		this.scrollArea = DOM.append(body, DOM.$('div'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;';
	}

	override async setInput(input: EncounterFormEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.patientId = input.patientId;
		this.encounterId = input.encounterId;
		this.patientName = input.patientName;

		await Promise.all([this._loadFormSchema(), this._loadEncounterData()]);
		if (token.isCancellationRequested) { return; }

		this._renderHeader();
		this._renderToc();
		this._renderForm();
		this._setupScrollSync();
	}

	private async _loadFormSchema(): Promise<void> {
		try {
			const file = await this.fileService.readFile(URI.joinPath(this._configHome, 'encounter.json'));
			const json = JSON.parse(file.value.toString());
			this.formSections = json.sections || [];
		} catch {
			this.formSections = [];
		}
	}

	private async _loadEncounterData(): Promise<void> {
		// Load from multiple endpoints in parallel
		const loads = [
			// FHIR encounter data
			this.apiService.fetch(`/api/fhir-resource/encounters/${this.encounterId}`).then(async r => r.ok ? (await r.json())?.data || {} : {}).catch(() => ({})),
			// EHR encounter data (has SIGNED/UNSIGNED status)
			this.patientId
				? this.apiService.fetch(`/api/encounters/${this.patientId}/${this.encounterId}`).then(async r => r.ok ? (await r.json())?.data || {} : {}).catch(() => ({}))
				: Promise.resolve({}),
			// Encounter form composition
			this.patientId
				? this.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${this.patientId}/${this.encounterId}`).then(async r => r.ok ? (await r.json())?.data || {} : {}).catch(() => ({}))
				: Promise.resolve({}),
		];
		const [fhir, ehr, form] = await Promise.all(loads);
		// EHR data takes precedence (has proper status), then FHIR, then form
		this.encounterData = { ...fhir, ...ehr, ...form };
	}

	// Section icons for TOC
	private static SECTION_ICONS: Record<string, string> = {
		'cc': '\u{1F6A8}', 'hpi': '\u{1F4DD}', 'ros': '\u{1F4CB}', 'pmh': '\u{1F4DA}',
		'fh': '\u{1F465}', 'sh': '\u{1F3E0}', 'vitals': '\u2764\uFE0F', 'pe': '\u{1F52C}',
		'assessment': '\u{1F9E0}', 'plan': '\u{1F4C4}', 'provider-note': '\u270D\uFE0F',
		'procedures': '\u2702\uFE0F', 'billing': '\u{1F4B3}', 'fee-schedule': '\u{1F4B0}',
		'assigned-providers': '\u{1F468}\u200D\u2695\uFE0F', 'signoff': '\u2705', 'signature': '\u{1F58A}\uFE0F',
	};

	private tocItems: Array<{ key: string; el: HTMLElement }> = [];

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);

		// Encounter icon
		const icon = DOM.append(this.headerBar, DOM.$('span'));
		icon.textContent = '\u{1F4CB}';
		icon.style.cssText = 'font-size:16px;';

		const title = DOM.append(this.headerBar, DOM.$('span'));
		title.textContent = `Encounter ${this.encounterId}`;
		title.style.cssText = 'font-size:14px;font-weight:700;';

		if (this.patientName) {
			const patient = DOM.append(this.headerBar, DOM.$('span'));
			patient.textContent = this.patientName;
			patient.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		}

		// Map FHIR status to readable label
		const rawStatus = String(this.encounterData.status || 'draft');
		const statusMap: Record<string, string> = {
			'arrived': 'Arrived', 'in-progress': 'In Progress', 'finished': 'Completed',
			'cancelled': 'Cancelled', 'entered-in-error': 'Error', 'planned': 'Planned',
			'onleave': 'On Leave', 'unknown': 'Draft', 'draft': 'Draft',
			'SIGNED': 'Signed', 'UNSIGNED': 'Unsigned', 'INCOMPLETE': 'Incomplete',
		};
		const status = statusMap[rawStatus] || rawStatus;
		const statusColor = ['Completed', 'Signed', 'finished'].includes(status) ? '#22c55e' : ['Unsigned', 'Error', 'Cancelled', 'entered-in-error'].includes(status) ? '#ef4444' : ['In Progress', 'Arrived', 'Incomplete'].includes(status) ? '#f59e0b' : '#3b82f6';
		const badge = DOM.append(this.headerBar, DOM.$('span'));
		badge.textContent = status;
		badge.style.cssText = `font-size:10px;padding:2px 8px;border-radius:10px;background:${statusColor}18;color:${statusColor};font-weight:500;`;

		DOM.append(this.headerBar, DOM.$('span')).style.flex = '1';

		const saveBtn = DOM.append(this.headerBar, DOM.$('button'));
		saveBtn.textContent = 'Save';
		saveBtn.style.cssText = 'padding:5px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
		saveBtn.addEventListener('click', () => this.notificationService.info('Save encounter — coming soon'));

		const signBtn = DOM.append(this.headerBar, DOM.$('button'));
		signBtn.textContent = 'Sign & Lock';
		signBtn.style.cssText = 'padding:5px 16px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;';
	}

	private _renderToc(): void {
		DOM.clearNode(this.tocNav);
		this.tocItems = [];

		const heading = DOM.append(this.tocNav, DOM.$('div'));
		heading.textContent = 'SECTIONS';
		heading.style.cssText = 'padding:4px 14px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';

		for (const sec of this.formSections) {
			if (!sec.visible) { continue; }
			const icon = EncounterFormEditor.SECTION_ICONS[sec.key] || '';

			const item = DOM.append(this.tocNav, DOM.$('div'));
			item.setAttribute('data-toc', sec.key);
			item.style.cssText = 'padding:4px 14px 4px 16px;cursor:pointer;color:var(--vscode-foreground);border-left:2px solid transparent;display:flex;align-items:center;gap:6px;font-size:13px;';

			if (icon) {
				const iconEl = DOM.append(item, DOM.$('span'));
				iconEl.textContent = icon;
				iconEl.style.cssText = 'font-size:13px;width:18px;text-align:center;flex-shrink:0;';
			}

			const label = DOM.append(item, DOM.$('span'));
			label.textContent = sec.title;
			label.style.cssText = 'flex:1;opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			if (sec.fields.some(f => f.required)) {
				const req = DOM.append(item, DOM.$('span'));
				req.textContent = '*';
				req.style.cssText = 'color:#ef4444;font-weight:700;font-size:11px;';
			}

			item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
			item.addEventListener('mouseleave', () => { if (!item.classList.contains('active')) { item.style.background = ''; } });
			item.addEventListener('click', () => {
				const el = this.scrollArea.querySelector(`[data-section="${sec.key}"]`);
				if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
			});

			this.tocItems.push({ key: sec.key, el: item });
		}
	}

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

	private _renderForm(): void {
		DOM.clearNode(this.scrollArea);

		const container = DOM.append(this.scrollArea, DOM.$('div'));
		container.style.cssText = 'max-width:900px;margin:0 auto;padding:16px 24px 60px;';

		for (const sec of this.formSections) {
			if (!sec.visible) { continue; }

			const cols = Math.min(sec.columns || 1, 4);

			// Card — clean VS Code blue accent
			const card = DOM.append(container, DOM.$('div'));
			card.setAttribute('data-section', sec.key);
			card.style.cssText = 'margin-bottom:14px;border:1px solid var(--vscode-editorWidget-border);border-left:3px solid var(--vscode-focusBorder,#007acc);border-radius:6px;overflow:hidden;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));box-shadow:0 1px 3px rgba(0,0,0,0.15);';

			// Header
			const header = DOM.append(card, DOM.$('div'));
			header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 14px;background:rgba(0,122,204,0.12);border-bottom:1px solid rgba(0,122,204,0.2);';

			// No collapse — all sections always expanded

			const secIcon = EncounterFormEditor.SECTION_ICONS[sec.key] || '';
			if (secIcon) {
				const iconEl = DOM.append(header, DOM.$('span'));
				iconEl.textContent = secIcon;
				iconEl.style.cssText = 'font-size:14px;';
			}

			const titleEl = DOM.append(header, DOM.$('span'));
			titleEl.textContent = sec.title;
			titleEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--vscode-foreground);';

			if (sec.fields.some(f => f.required)) {
				const req = DOM.append(header, DOM.$('span'));
				req.textContent = '*';
				req.style.cssText = 'color:#EF5350;font-weight:700;';
			}

			// Body — always expanded
			const body = DOM.append(card, DOM.$('div'));
			body.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:6px 16px;padding:14px;`;

			// Fields
			for (const f of sec.fields) {
				const val = (this.encounterData as Record<string, unknown>)[f.key] ?? '';

				const cell = DOM.append(body, DOM.$('div'));
				cell.style.cssText = `grid-column:span ${Math.min(f.colSpan || 1, cols)};`;

				const lbl = DOM.append(cell, DOM.$('label'));
				lbl.style.cssText = 'display:block;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px;';
				const lblText = DOM.append(lbl, DOM.$('span'));
				lblText.textContent = f.label;
				if (f.required) {
					const req = DOM.append(lbl, DOM.$('span'));
					req.textContent = ' *';
					req.style.cssText = 'color:#EF5350;';
				}

				const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;transition:border-color 0.15s;';
				const focusCss = 'border-color:var(--vscode-focusBorder,#007acc);box-shadow:0 0 0 1px var(--vscode-focusBorder,#007acc);';

				const addFocus = (el: HTMLElement) => {
					el.addEventListener('focus', () => { el.style.cssText = inputStyle + (el.tagName === 'TEXTAREA' ? 'min-height:80px;resize:vertical;' : el.tagName === 'SELECT' ? 'height:32px;cursor:pointer;' : 'height:32px;') + focusCss; });
					el.addEventListener('blur', () => { el.style.cssText = inputStyle + (el.tagName === 'TEXTAREA' ? 'min-height:80px;resize:vertical;' : el.tagName === 'SELECT' ? 'height:32px;cursor:pointer;' : 'height:32px;'); });
				};

				if (f.type === 'select') {
					const sel = DOM.append(cell, DOM.$('select')) as HTMLSelectElement;
					sel.style.cssText = inputStyle + 'height:32px;cursor:pointer;';
					for (const o of [{ label: `Select ${f.label}...`, value: '' }, ...(f.options || [])]) {
						const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
						opt.value = o.value; opt.textContent = o.label; opt.selected = String(val) === o.value;
					}
					addFocus(sel);
				} else if (f.type === 'textarea') {
					const ta = DOM.append(cell, DOM.$('textarea')) as HTMLTextAreaElement;
					ta.value = String(val);
					ta.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					ta.style.cssText = inputStyle + 'min-height:80px;resize:vertical;';
					addFocus(ta);
				} else if (f.type === 'boolean' || f.type === 'toggle') {
					const cb = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					cb.type = 'checkbox'; cb.checked = !!val;
					cb.style.cssText = 'width:18px;height:18px;cursor:pointer;';
				} else if (f.type === 'number') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'number'; inp.value = String(val); inp.placeholder = f.placeholder || '';
					inp.style.cssText = inputStyle + 'height:32px;';
					addFocus(inp);
				} else if (f.type === 'date' || f.type === 'datetime') {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = f.type === 'datetime' ? 'datetime-local' : 'date';
					inp.value = String(val).split('T')[0]; inp.style.cssText = inputStyle + 'height:32px;';
					addFocus(inp);
				} else {
					const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
					inp.type = 'text'; inp.value = String(val); inp.placeholder = f.placeholder || `Enter ${f.label.toLowerCase()}...`;
					inp.style.cssText = inputStyle + 'height:32px;';
					addFocus(inp);
				}
			}
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
