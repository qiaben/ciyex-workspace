/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { FeeSheetEditorInput } from './ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown, IDropdownOption } from '../customDropdown.js';

/** A single billable line on the fee sheet. Mirrors the OpenEMR fee-sheet row. */
interface FeeItem {
	/** Code system — CPT4 | HCPCS | ICD10. */
	type: string;
	code: string;
	description: string;
	modifiers: string;
	price: number;
	qty: number;
	/** Linked diagnosis pointer(s) used to justify a procedure. */
	justify: string;
	note: string;
	auth: boolean;
}

/** Searchable code systems offered in the "Search for Additional Codes" row. */
const CODE_TYPES: Array<{ key: string; label: string; searchPath: string }> = [
	{ key: 'CPT4', label: 'CPT Procedure/Service', searchPath: 'CPT4' },
	{ key: 'HCPCS', label: 'HCPCS Procedure/Service', searchPath: 'HCPCS' },
	{ key: 'ICD10', label: 'ICD-10 Diagnosis', searchPath: 'ICD10_CM' },
];

/**
 * Fee Sheet editor — captures the billable charges for a signed encounter and
 * pushes them to billing/payment. Mirrors the OpenEMR Fee Sheet:
 *   1. Set Price Level (sourced from Settings → Price Level)
 *   2. Search for Additional Codes (CPT / HCPCS / ICD-10)
 *   3. Selected Fee Sheet Codes table (Type / Code / Desc / Modifiers / Price /
 *      Qty / Justify / Note / Auth)
 *   4. Select Providers (Rendering / Supervising)
 *   5. Save, or "Send to Billing" which creates the patient charge and emails
 *      the patient their statement.
 *
 * When opened from a signed encounter the existing fee sheet (if any) is
 * fetched; otherwise the user enters codes manually.
 */
export class FeeSheetEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexFeeSheet';

	private root!: HTMLElement;
	private headerBar!: HTMLElement;
	private scrollArea!: HTMLElement;
	private footerBar!: HTMLElement;

	private patientId = '';
	private encounterId = '';
	private patientName = '';
	private encounterLabel = '';

	private feeSheetId: string | null = null;
	private priceLevels: IDropdownOption[] = [];
	private selectedPriceLevel = '';
	private providers: IDropdownOption[] = [];
	private renderingProvider = '';
	private supervisingProvider = '';
	private items: FeeItem[] = [];

	private itemsTableHost!: HTMLElement;
	private totalsHost!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(FeeSheetEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-fee-sheet.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';

		this.headerBar = DOM.append(this.root, DOM.$('div'));
		this.headerBar.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		this.scrollArea = DOM.append(this.root, DOM.$('div'));
		this.scrollArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px;';

		this.footerBar = DOM.append(this.root, DOM.$('div'));
		this.footerBar.style.cssText = 'padding:10px 16px;border-top:1px solid var(--vscode-editorWidget-border);flex-shrink:0;display:flex;gap:8px;align-items:center;';
	}

	override async setInput(input: FeeSheetEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.patientId = input.patientId;
		this.encounterId = input.encounterId;
		this.patientName = input.patientName;
		this.encounterLabel = input.encounterLabel || '';
		this.feeSheetId = null;
		this.items = [];
		this.selectedPriceLevel = '';
		this.renderingProvider = '';
		this.supervisingProvider = '';

		await this._loadData();
		if (token.isCancellationRequested) { return; }

		this._renderHeader();
		this._renderBody();
		this._renderFooter();
	}

	/** Load price levels, providers, and any existing fee sheet for the encounter. */
	private async _loadData(): Promise<void> {
		// Price levels (from Settings → Price Level).
		try {
			const res = await this.apiService.fetch('/api/price-levels');
			if (res.ok) {
				const data = await res.json() as Array<Record<string, unknown>>;
				const list = Array.isArray(data) ? data : [];
				this.priceLevels = list
					.filter(d => d.active !== false && d.activity !== 0)
					.map(d => ({ value: String(d.optionId ?? d.option_id ?? d.id ?? ''), label: String(d.title ?? d.optionId ?? '') }));
				const def = list.find(d => d.isDefault === true || d.is_default === true);
				if (def) { this.selectedPriceLevel = String(def.optionId ?? def.option_id ?? def.id ?? ''); }
				else if (this.priceLevels.length) { this.selectedPriceLevel = this.priceLevels[0].value; }
			}
		} catch { /* not authenticated / offline */ }

		// Providers — merge facade + FHIR sources (mirrors calendarEditor).
		try {
			const results = await Promise.all([
				this.apiService.fetch('/api/providers').then(async r => r.ok ? await r.json() : null).catch(() => null),
				this.apiService.fetch('/api/fhir-resource/providers?size=200').then(async r => r.ok ? await r.json() : null).catch(() => null),
			]);
			const byId = new Map<string, IDropdownOption>();
			for (const payload of results) {
				const arr: Array<Record<string, unknown>> = payload?.data?.content || payload?.content || payload?.data || (Array.isArray(payload) ? payload : []);
				for (const p of (Array.isArray(arr) ? arr : [])) {
					const id = String(p.id ?? p.providerId ?? '');
					if (!id) { continue; }
					const name = String(p.name ?? (`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || id));
					byId.set(id, { value: id, label: name });
				}
			}
			this.providers = Array.from(byId.values());
		} catch { /* */ }

		// Existing fee sheet for this encounter (signed-encounter fetch path).
		if (this.encounterId && this.encounterId !== '_') {
			try {
				const res = await this.apiService.fetch(`/api/fee-sheets/encounter/${encodeURIComponent(this.encounterId)}`);
				if (res.ok) {
					const data = await res.json() as Record<string, unknown>;
					const fs = (data?.data ?? data) as Record<string, unknown>;
					if (fs && (fs.id || Array.isArray(fs.items))) {
						this.feeSheetId = fs.id !== undefined && fs.id !== null ? String(fs.id) : null;
						if (fs.priceLevel) { this.selectedPriceLevel = String(fs.priceLevel); }
						if (fs.renderingProvider) { this.renderingProvider = String(fs.renderingProvider); }
						if (fs.supervisingProvider) { this.supervisingProvider = String(fs.supervisingProvider); }
						const rawItems = (fs.items as Array<Record<string, unknown>>) || [];
						this.items = rawItems.map(it => this._normalizeItem(it));
					}
				}
			} catch { /* no existing fee sheet — start blank */ }
		}
	}

	private _normalizeItem(it: Record<string, unknown>): FeeItem {
		return {
			type: String(it.type ?? it.codeType ?? ''),
			code: String(it.code ?? ''),
			description: String(it.description ?? ''),
			modifiers: String(it.modifiers ?? it.modifier ?? ''),
			price: Number(it.price ?? it.fee ?? 0) || 0,
			qty: Number(it.qty ?? it.units ?? 1) || 1,
			justify: String(it.justify ?? ''),
			note: String(it.note ?? it.noteCodes ?? ''),
			auth: it.auth === true || it.auth === 'true',
		};
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		const title = DOM.append(this.headerBar, DOM.$('div'));
		title.style.cssText = 'font-size:15px;font-weight:600;';
		title.textContent = this.patientName
			? `Fee Sheet for ${this.patientName}${this.encounterLabel ? ` — ${this.encounterLabel}` : ''}`
			: 'Fee Sheet';
		const sub = DOM.append(this.headerBar, DOM.$('div'));
		sub.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		sub.textContent = this.encounterId && this.encounterId !== '_'
			? `Encounter ${this.encounterId}`
			: 'Manual fee sheet (no encounter linked)';
	}

	private _sectionTitle(parent: HTMLElement, text: string): void {
		const h = DOM.append(parent, DOM.$('div'));
		h.textContent = text;
		h.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin:18px 0 8px;';
	}

	private _renderBody(): void {
		DOM.clearNode(this.scrollArea);

		// 1) Set Price Level
		this._sectionTitle(this.scrollArea, 'Set Price Level');
		const plWrap = DOM.append(this.scrollArea, DOM.$('div'));
		plWrap.style.cssText = 'max-width:320px;';
		createCustomDropdown({
			parent: plWrap,
			options: this.priceLevels.length ? this.priceLevels : [{ value: '', label: 'No price levels configured' }],
			initialValue: this.selectedPriceLevel,
			placeholder: 'Select price level…',
			onChange: v => { this.selectedPriceLevel = v; },
		});

		// 2) Search for Additional Codes
		this._sectionTitle(this.scrollArea, 'Search for Additional Codes');
		this._renderCodeSearch(this.scrollArea);

		// 3) Selected Fee Sheet Codes
		this._sectionTitle(this.scrollArea, 'Selected Fee Sheet Codes and Charges');
		this.itemsTableHost = DOM.append(this.scrollArea, DOM.$('div'));
		this.itemsTableHost.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		this.totalsHost = DOM.append(this.scrollArea, DOM.$('div'));
		this.totalsHost.style.cssText = 'display:flex;justify-content:flex-end;gap:24px;padding:10px 4px;font-size:13px;';
		this._renderItemsTable();

		// 4) Select Providers
		this._sectionTitle(this.scrollArea, 'Select Providers');
		const provGrid = DOM.append(this.scrollArea, DOM.$('div'));
		provGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:680px;';
		const renderProvField = (label: string, value: string, onChange: (v: string) => void): void => {
			const cell = DOM.append(provGrid, DOM.$('div'));
			const lbl = DOM.append(cell, DOM.$('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			createCustomDropdown({
				parent: cell,
				options: [{ value: '', label: '— N/A —' }, ...this.providers],
				initialValue: value,
				placeholder: 'Select provider…',
				onChange,
			});
		};
		renderProvField('Rendering', this.renderingProvider, v => { this.renderingProvider = v; });
		renderProvField('Supervising', this.supervisingProvider, v => { this.supervisingProvider = v; });
	}

	private _renderCodeSearch(parent: HTMLElement): void {
		let activeType = CODE_TYPES[0].key;

		const radioRow = DOM.append(parent, DOM.$('div'));
		radioRow.style.cssText = 'display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap;';
		const radioEls: HTMLInputElement[] = [];
		for (const ct of CODE_TYPES) {
			const lbl = DOM.append(radioRow, DOM.$('label'));
			lbl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;';
			const r = DOM.append(lbl, DOM.$('input')) as HTMLInputElement;
			r.type = 'radio';
			r.name = 'feesheet-codetype';
			r.value = ct.key;
			r.checked = ct.key === activeType;
			r.addEventListener('change', () => { if (r.checked) { activeType = ct.key; } });
			radioEls.push(r);
			const span = DOM.append(lbl, DOM.$('span'));
			span.textContent = ct.label;
		}

		const searchWrap = DOM.append(parent, DOM.$('div'));
		searchWrap.style.cssText = 'position:relative;max-width:560px;';
		const input = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
		input.type = 'text';
		input.placeholder = 'Search by code or description…';
		input.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
		const results = DOM.append(searchWrap, DOM.$('div'));
		results.style.cssText = 'position:absolute;left:0;right:0;top:100%;z-index:50;display:none;max-height:280px;overflow-y:auto;background:var(--vscode-editorWidget-background,var(--vscode-input-background));border:1px solid var(--vscode-editorWidget-border);border-radius:0 0 6px 6px;box-shadow:0 8px 20px rgba(0,0,0,0.3);';

		let timer: ReturnType<typeof setTimeout> | undefined;
		input.addEventListener('input', () => {
			if (timer) { clearTimeout(timer); }
			const q = input.value.trim();
			if (q.length < 2) { results.style.display = 'none'; return; }
			timer = setTimeout(() => this._searchCodes(activeType, q, results, input), 300);
		});
		input.addEventListener('blur', () => { setTimeout(() => { results.style.display = 'none'; }, 200); });
	}

	private async _searchCodes(type: string, q: string, results: HTMLElement, input: HTMLInputElement): Promise<void> {
		const ct = CODE_TYPES.find(c => c.key === type) || CODE_TYPES[0];
		try {
			const res = await this.apiService.fetch(`/api/app-proxy/ciyex-codes/api/codes/${ct.searchPath}/search?q=${encodeURIComponent(q)}&page=0&size=15`);
			if (!res.ok) { results.style.display = 'none'; return; }
			const data = await res.json();
			const codes = data?.data?.content || data?.content || data?.data || [];
			const list = Array.isArray(codes) ? codes : [];
			DOM.clearNode(results);
			for (const c of list) {
				const code = String(c.code || c.codeValue || '');
				const desc = String(c.shortDescription || c.description || c.longDescription || '');
				const price = Number(c.price ?? c.fee ?? 0) || 0;
				const item = DOM.append(results, DOM.$('div'));
				item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);display:flex;align-items:center;gap:10px;';
				const codeEl = DOM.append(item, DOM.$('span'));
				codeEl.textContent = code;
				codeEl.style.cssText = 'font-weight:600;color:var(--vscode-textLink-foreground);min-width:64px;font-family:var(--vscode-editor-font-family,monospace);';
				const descEl = DOM.append(item, DOM.$('span'));
				descEl.textContent = desc;
				descEl.style.cssText = 'flex:1;';
				item.addEventListener('mousedown', e => e.preventDefault());
				item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
				item.addEventListener('mouseleave', () => { item.style.background = ''; });
				item.addEventListener('click', () => {
					this._addItem({ type, code, description: desc, modifiers: '', price, qty: 1, justify: '', note: '', auth: false });
					input.value = '';
					results.style.display = 'none';
				});
			}
			results.style.display = list.length ? 'block' : 'none';
		} catch {
			results.style.display = 'none';
		}
	}

	private _addItem(item: FeeItem): void {
		// Avoid duplicate code lines — bump qty instead.
		const existing = this.items.find(i => i.type === item.type && i.code === item.code);
		if (existing) { existing.qty += 1; } else { this.items.push(item); }
		this._renderItemsTable();
	}

	private _renderItemsTable(): void {
		const COLS = '70px 90px minmax(180px,1.6fr) 110px 90px 60px 90px minmax(120px,1fr) 50px 40px';
		DOM.clearNode(this.itemsTableHost);

		const header = DOM.append(this.itemsTableHost, DOM.$('div'));
		header.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;padding:8px 10px;background:rgba(0,122,204,0.05);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);`;
		for (const h of ['Type', 'Code', 'Description', 'Modifiers', 'Price', 'Qty', 'Justify', 'Note', 'Auth', '']) {
			DOM.append(header, DOM.$('span')).textContent = h;
		}

		if (this.items.length === 0) {
			const empty = DOM.append(this.itemsTableHost, DOM.$('div'));
			empty.textContent = 'No codes selected. Search above to add CPT, HCPCS or ICD-10 codes.';
			empty.style.cssText = 'padding:16px 10px;color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';
		}

		const inputStyle = 'width:100%;box-sizing:border-box;padding:4px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		this.items.forEach((it, i) => {
			const row = DOM.append(this.itemsTableHost, DOM.$('div'));
			row.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;align-items:center;padding:6px 10px;border-top:1px solid rgba(128,128,128,0.08);`;

			DOM.append(row, DOM.$('span')).textContent = it.type;
			const codeEl = DOM.append(row, DOM.$('span'));
			codeEl.textContent = it.code;
			codeEl.style.cssText = 'font-weight:600;font-family:var(--vscode-editor-font-family,monospace);';
			const descEl = DOM.append(row, DOM.$('span'));
			descEl.textContent = it.description;
			descEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			descEl.title = it.description;

			const modInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			modInp.value = it.modifiers; modInp.style.cssText = inputStyle;
			modInp.addEventListener('input', () => { it.modifiers = modInp.value; });

			const priceInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			priceInp.type = 'number'; priceInp.step = '0.01'; priceInp.value = String(it.price); priceInp.style.cssText = inputStyle;
			priceInp.addEventListener('input', () => { it.price = parseFloat(priceInp.value) || 0; this._renderTotals(); });

			const qtyInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			qtyInp.type = 'number'; qtyInp.value = String(it.qty); qtyInp.style.cssText = inputStyle;
			qtyInp.addEventListener('input', () => { it.qty = parseInt(qtyInp.value, 10) || 0; this._renderTotals(); });

			const justInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			justInp.value = it.justify; justInp.placeholder = 'ICD'; justInp.style.cssText = inputStyle;
			justInp.addEventListener('input', () => { it.justify = justInp.value; });

			const noteInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			noteInp.value = it.note; noteInp.style.cssText = inputStyle;
			noteInp.addEventListener('input', () => { it.note = noteInp.value; });

			const authWrap = DOM.append(row, DOM.$('div'));
			authWrap.style.cssText = 'display:flex;justify-content:center;';
			const authInp = DOM.append(authWrap, DOM.$('input')) as HTMLInputElement;
			authInp.type = 'checkbox'; authInp.checked = it.auth; authInp.style.cssText = 'cursor:pointer;';
			authInp.addEventListener('change', () => { it.auth = authInp.checked; });

			const rm = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			rm.textContent = '\u{1F5D1}'; rm.title = 'Remove'; rm.style.cssText = 'background:transparent;border:none;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:13px;';
			rm.addEventListener('click', () => { this.items.splice(i, 1); this._renderItemsTable(); });
		});

		this._renderTotals();
	}

	private _renderTotals(): void {
		DOM.clearNode(this.totalsHost);
		const total = this.items.reduce((s, it) => s + (it.price * it.qty), 0);
		const units = this.items.reduce((s, it) => s + it.qty, 0);
		const u = DOM.append(this.totalsHost, DOM.$('span'));
		u.innerText = `Units: ${units}`;
		u.style.color = 'var(--vscode-descriptionForeground)';
		const t = DOM.append(this.totalsHost, DOM.$('span'));
		t.innerText = `Total: $${total.toFixed(2)}`;
		t.style.fontWeight = '600';
	}

	private _renderFooter(): void {
		DOM.clearNode(this.footerBar);

		const saveBtn = this._footerButton('✓ Save', '#0e639c');
		saveBtn.addEventListener('click', async () => {
			saveBtn.disabled = true;
			const ok = await this._save();
			saveBtn.disabled = false;
			if (ok) { this.notificationService.notify({ severity: Severity.Info, message: 'Fee sheet saved.' }); }
		});

		const billBtn = this._footerButton('\u{1F4E4} Send to Billing', '#2e7d32');
		billBtn.addEventListener('click', async () => {
			billBtn.disabled = true;
			await this._sendToBilling();
			billBtn.disabled = false;
		});

		const spacer = DOM.append(this.footerBar, DOM.$('div'));
		spacer.style.flex = '1';

		const note = DOM.append(this.footerBar, DOM.$('span'));
		note.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		note.textContent = '"Send to Billing" posts charges to Payments and emails the patient.';
	}

	private _footerButton(label: string, bg: string): HTMLButtonElement {
		const b = DOM.append(this.footerBar, DOM.$('button')) as HTMLButtonElement;
		b.textContent = label;
		b.style.cssText = `padding:7px 16px;background:${bg};color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:500;`;
		return b;
	}

	private _buildPayload(): Record<string, unknown> {
		return {
			id: this.feeSheetId,
			encounterId: this.encounterId && this.encounterId !== '_' ? this.encounterId : null,
			patientId: this.patientId && this.patientId !== '_' ? this.patientId : null,
			priceLevel: this.selectedPriceLevel,
			renderingProvider: this.renderingProvider || null,
			supervisingProvider: this.supervisingProvider || null,
			total: this.items.reduce((s, it) => s + it.price * it.qty, 0),
			items: this.items,
		};
	}

	/** Persist the fee sheet. Returns true on success. */
	private async _save(): Promise<boolean> {
		if (this.items.length === 0) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Add at least one code before saving.' });
			return false;
		}
		const payload = this._buildPayload();
		try {
			const method = this.feeSheetId ? 'PUT' : 'POST';
			const url = this.feeSheetId ? `/api/fee-sheets/${encodeURIComponent(this.feeSheetId)}` : '/api/fee-sheets';
			const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
			if (!res.ok) {
				this.notificationService.notify({ severity: Severity.Error, message: `Save failed (${res.status}).` });
				return false;
			}
			const data = await res.json().catch(() => ({}));
			const saved = (data?.data ?? data) as Record<string, unknown>;
			if (saved?.id !== undefined && saved?.id !== null) { this.feeSheetId = String(saved.id); }
			return true;
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
			return false;
		}
	}

	/**
	 * Save the fee sheet then push it to billing: the backend creates the
	 * patient charge from the fee-sheet items and emails the statement to the
	 * patient. The charge then surfaces in the Operations → Payments dashboard
	 * where it can be collected (and an invoice auto-generated on payment).
	 */
	private async _sendToBilling(): Promise<void> {
		const ok = await this._save();
		if (!ok || !this.feeSheetId) { return; }
		try {
			const res = await this.apiService.fetch(`/api/fee-sheets/${encodeURIComponent(this.feeSheetId)}/bill`, {
				method: 'POST',
				body: JSON.stringify({ sendEmail: true, patientId: this.patientId }),
			});
			if (res.ok) {
				this.notificationService.notify({ severity: Severity.Info, message: 'Charges sent to billing and statement emailed to the patient.' });
				// Surface the new charge in the Payments dashboard.
				this.commandService.executeCommand('ciyex.openPayments').then(undefined, () => { });
			} else {
				this.notificationService.notify({ severity: Severity.Error, message: `Send to billing failed (${res.status}).` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Send to billing failed: ${e}` });
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
