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
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

const inputStyle = 'width:100%;padding:7px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
const btnPrimary = 'padding:7px 16px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';

interface KioskConfigData {
	id?: number;
	enabled: boolean;
	config: Record<string, boolean>;
	welcomeMessage: string;
	completionMessage: string;
	idleTimeoutSec: number;
}

const CHECK_IN_STEPS = [
	{ key: 'verify_dob', label: 'Verify Date of Birth', desc: 'Patient must enter DOB to verify identity' },
	{ key: 'verify_phone', label: 'Verify Phone Number', desc: 'Patient must enter phone for verification' },
	{ key: 'update_demographics', label: 'Update Demographics', desc: 'Allow patients to review and update demographics' },
	{ key: 'update_insurance', label: 'Update Insurance', desc: 'Allow patients to update insurance information' },
	{ key: 'sign_consent', label: 'Sign Consent Forms', desc: 'Present consent forms for electronic signature' },
	{ key: 'collect_copay', label: 'Collect Copay', desc: 'Allow copay payment during check-in' },
	{ key: 'show_wait_time', label: 'Show Wait Time', desc: 'Display estimated wait time after check-in' },
];

/**
 * Check-in Kiosk editor with Configuration and Check-in Log tabs.
 */
export class KioskEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexKiosk';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private activeTab = 0;
	private config: KioskConfigData = { enabled: false, config: {}, welcomeMessage: '', completionMessage: '', idleTimeoutSec: 60 };
	private checkins: Record<string, unknown>[] = [];
	private checkinPage = 0;
	private stats: Record<string, unknown> = {};

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(KioskEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.kiosk-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:900px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this._loadData();
	}

	private async _loadData(): Promise<void> {
		try {
			if (this.activeTab === 0) {
				const res = await this.apiService.fetch('/api/kiosk/config');
				if (res.ok) {
					const d = (await res.json())?.data || {};
					this.config = {
						id: d.id,
						enabled: !!d.enabled,
						config: (typeof d.config === 'string' ? JSON.parse(d.config) : d.config) || {},
						welcomeMessage: d.welcomeMessage || '',
						completionMessage: d.completionMessage || '',
						idleTimeoutSec: d.idleTimeoutSec || 60,
					};
				}
			} else {
				const [checkRes, statsRes] = await Promise.all([
					this.apiService.fetch(`/api/kiosk/checkins?page=${this.checkinPage}&size=20`),
					this.apiService.fetch('/api/kiosk/stats'),
				]);
				if (checkRes.ok) { const d = await checkRes.json(); this.checkins = d?.data?.content || d?.content || d?.data || []; }
				if (statsRes.ok) { this.stats = (await statsRes.json())?.data || {}; }
			}
		} catch { /* */ }
		this._render();
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		// Header
		const hdr = DOM.append(this.contentEl, DOM.$('div'));
		hdr.style.cssText = 'margin-bottom:16px;';
		const h = DOM.append(hdr, DOM.$('h2'));
		h.textContent = 'Patient Kiosk';
		h.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 4px;';
		const sub = DOM.append(hdr, DOM.$('div'));
		sub.textContent = 'Self-service check-in configuration and log';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

		// Tabs
		const tabBar = DOM.append(this.contentEl, DOM.$('div'));
		tabBar.style.cssText = 'display:flex;gap:0;border-bottom:2px solid var(--vscode-editorWidget-border);margin-bottom:16px;';
		for (const [i, label] of ['Configuration', 'Check-in Log'].entries()) {
			const btn = DOM.append(tabBar, DOM.$('button'));
			const active = i === this.activeTab;
			btn.textContent = label;
			btn.style.cssText = `padding:8px 16px;border:none;background:none;cursor:pointer;font-size:12px;border-bottom:2px solid ${active ? '#0e639c' : 'transparent'};margin-bottom:-2px;color:${active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};font-weight:${active ? '600' : '400'};`;
			btn.addEventListener('click', () => { this.activeTab = i; this._loadData(); });
		}

		if (this.activeTab === 0) {
			this._renderConfiguration();
		} else {
			this._renderCheckinLog();
		}
	}

	private _renderConfiguration(): void {
		const card = DOM.append(this.contentEl, DOM.$('div'));
		card.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:16px;';

		// Kiosk Mode toggle
		const modeRow = DOM.append(card, DOM.$('div'));
		modeRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--vscode-editorWidget-border);margin-bottom:16px;';
		const modeLabel = DOM.append(modeRow, DOM.$('div'));
		DOM.append(modeLabel, DOM.$('div')).textContent = 'Kiosk Mode';
		(modeLabel.lastChild as HTMLElement).style.cssText = 'font-weight:600;font-size:13px;';
		DOM.append(modeLabel, DOM.$('div')).textContent = 'Enable patient self-service check-in';
		(modeLabel.lastChild as HTMLElement).style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const enabledCb = DOM.append(modeRow, DOM.$('input')) as HTMLInputElement;
		enabledCb.type = 'checkbox';
		enabledCb.checked = this.config.enabled;
		enabledCb.style.cssText = 'width:18px;height:18px;cursor:pointer;';

		// Check-in Steps
		const stepsTitle = DOM.append(card, DOM.$('h3'));
		stepsTitle.textContent = 'Check-in Steps';
		stepsTitle.style.cssText = 'margin:0 0 4px;font-size:13px;font-weight:600;';
		const stepsDesc = DOM.append(card, DOM.$('div'));
		stepsDesc.textContent = 'Configure which steps are included in kiosk check-in';
		stepsDesc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:12px;';

		const stepCheckboxes = new Map<string, HTMLInputElement>();

		for (const step of CHECK_IN_STEPS) {
			const row = DOM.append(card, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(128,128,128,0.08);';
			const lbl = DOM.append(row, DOM.$('div'));
			DOM.append(lbl, DOM.$('div')).textContent = step.label;
			(lbl.lastChild as HTMLElement).style.cssText = 'font-size:12px;font-weight:500;';
			DOM.append(lbl, DOM.$('div')).textContent = step.desc;
			(lbl.lastChild as HTMLElement).style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			const cb = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			cb.type = 'checkbox';
			cb.checked = !!this.config.config[step.key];
			cb.style.cssText = 'width:16px;height:16px;cursor:pointer;';
			stepCheckboxes.set(step.key, cb);
		}

		// Messages
		const msgTitle = DOM.append(card, DOM.$('h3'));
		msgTitle.textContent = 'Messages';
		msgTitle.style.cssText = 'margin:16px 0 8px;font-size:13px;font-weight:600;';

		const welcomeLbl = DOM.append(card, DOM.$('label'));
		welcomeLbl.textContent = 'Welcome Message';
		welcomeLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const welcomeIn = DOM.append(card, DOM.$('textarea')) as HTMLTextAreaElement;
		welcomeIn.value = this.config.welcomeMessage;
		welcomeIn.style.cssText = inputStyle + 'min-height:50px;resize:vertical;font-family:inherit;margin-bottom:8px;';

		const compLbl = DOM.append(card, DOM.$('label'));
		compLbl.textContent = 'Completion Message';
		compLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const compIn = DOM.append(card, DOM.$('textarea')) as HTMLTextAreaElement;
		compIn.value = this.config.completionMessage;
		compIn.style.cssText = inputStyle + 'min-height:50px;resize:vertical;font-family:inherit;margin-bottom:8px;';

		const timeoutLbl = DOM.append(card, DOM.$('label'));
		timeoutLbl.textContent = 'Idle Timeout (seconds)';
		timeoutLbl.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
		const timeoutIn = DOM.append(card, DOM.$('input')) as HTMLInputElement;
		timeoutIn.type = 'number';
		timeoutIn.value = String(this.config.idleTimeoutSec);
		timeoutIn.style.cssText = inputStyle + 'width:120px;';

		// Save button
		const btns = DOM.append(card, DOM.$('div'));
		btns.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
		const saveBtn = DOM.append(btns, DOM.$('button'));
		saveBtn.textContent = 'Save Configuration';
		saveBtn.style.cssText = btnPrimary;
		saveBtn.addEventListener('click', async () => {
			const configObj: Record<string, boolean> = {};
			for (const [key, cb] of stepCheckboxes) { configObj[key] = cb.checked; }
			const payload = {
				enabled: enabledCb.checked,
				config: configObj,
				welcomeMessage: welcomeIn.value,
				completionMessage: compIn.value,
				idleTimeoutSec: Number(timeoutIn.value) || 60,
			};
			saveBtn.textContent = 'Saving...';
			await this.apiService.fetch('/api/kiosk/config', {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			saveBtn.textContent = 'Saved!';
			setTimeout(() => { saveBtn.textContent = 'Save Configuration'; }, 1500);
		});
	}

	private _renderCheckinLog(): void {
		// Stats
		if (Object.keys(this.stats).length > 0) {
			const statsRow = DOM.append(this.contentEl, DOM.$('div'));
			statsRow.style.cssText = 'display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;';
			for (const [key, val] of Object.entries(this.stats)) {
				if (typeof val !== 'number') { continue; }
				const card = DOM.append(statsRow, DOM.$('div'));
				card.style.cssText = 'flex:1;min-width:100px;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;text-align:center;';
				const num = DOM.append(card, DOM.$('div'));
				num.textContent = typeof val === 'number' && val < 1 && val > 0 ? `${Math.round(val * 100)}%` : String(val);
				num.style.cssText = 'font-size:18px;font-weight:700;color:#0e639c;';
				const lbl = DOM.append(card, DOM.$('div'));
				lbl.textContent = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
				lbl.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);text-transform:capitalize;';
			}
		}

		// Table
		const tbl = DOM.append(this.contentEl, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		const cols = '1fr 130px 90px 90px 80px 70px 70px';

		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(0,122,204,0.05);text-transform:uppercase;`;
		for (const h of ['Patient', 'Check-in Time', 'Verified By', 'Demographics', 'Insurance', 'Consent', 'Copay']) { DOM.append(hr, DOM.$('span')).textContent = h; }

		if (this.checkins.length === 0) {
			const e = DOM.append(tbl, DOM.$('div'));
			e.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			e.textContent = 'No check-ins found';
		} else {
			for (const ci of this.checkins) {
				const r = DOM.append(tbl, DOM.$('div'));
				r.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:6px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;`;
				r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
				r.addEventListener('mouseleave', () => { r.style.background = ''; });

				DOM.append(r, DOM.$('span')).textContent = String(ci.patientName || '');
				const timeCell = DOM.append(r, DOM.$('span'));
				try { timeCell.textContent = ci.checkInTime ? new Date(String(ci.checkInTime)).toLocaleString() : ''; } catch { timeCell.textContent = String(ci.checkInTime || ''); }
				DOM.append(r, DOM.$('span')).textContent = String(ci.verificationMethod || '').toUpperCase();
				// allow-any-unicode-next-line
				for (const key of ['demographicsUpdated', 'insuranceUpdated', 'consentSigned', 'copayCollected'] as const) {
					const cell = DOM.append(r, DOM.$('span'));
					// allow-any-unicode-next-line
					cell.textContent = ci[key] ? '✓' : '✗';
					cell.style.cssText = `color:${ci[key] ? '#22c55e' : '#6b7280'};font-weight:500;`;
				}
			}
		}

		// Pagination
		const pg = DOM.append(this.contentEl, DOM.$('div'));
		pg.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:12px;align-items:center;';
		if (this.checkinPage > 0) {
			const prev = DOM.append(pg, DOM.$('button'));
			prev.textContent = 'Previous';
			prev.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
			prev.addEventListener('click', () => { this.checkinPage--; this._loadData(); });
		}
		DOM.append(pg, DOM.$('span')).textContent = `Page ${this.checkinPage + 1}`;
		(pg.lastChild as HTMLElement).style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		if (this.checkins.length >= 20) {
			const next = DOM.append(pg, DOM.$('button'));
			next.textContent = 'Next';
			next.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
			next.addEventListener('click', () => { this.checkinPage++; this._loadData(); });
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
