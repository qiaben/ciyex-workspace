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
import { ICiyexRcmApiService } from '../rcm/rcmApiService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { generate837P, downloadEdi, Edi837Claim, Edi837ServiceLine, claimNumberForFeeSheet } from '../billing/edi837.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { FeeSheetEditorInput } from './ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown, IDropdownOption } from '../customDropdown.js';
import { parseSavedRecord } from '../sidebarActions.js';
import { expandEncounterType } from './visitSummaryPanel.js';
import { IPatientCoverage, activeCoverage, coverageLabel, hasActiveInsurance, loadPatientCoverages } from './patientCoverage.js';
import { syncSelfPayResponsibility } from './selfPayBilling.js';

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

/**
 * Searchable code systems offered in the "Search for Additional Codes" row.
 * `searchPath` is the ciyex-codes CodeSystem enum value used in
 * /api/codes/{system}/search — note CPT is "CPT" (not "CPT4") and ICD-10 is
 * "ICD10_CM"; anything else returns HTTP 500 from the codes service.
 */
const CODE_TYPES: Array<{ key: string; label: string; searchPath: string }> = [
	{ key: 'CPT', label: 'CPT Procedure/Service', searchPath: 'CPT' },
	{ key: 'HCPCS', label: 'HCPCS Procedure/Service', searchPath: 'HCPCS' },
	{ key: 'ICD10', label: 'ICD-10 Diagnosis', searchPath: 'ICD10_CM' },
];

// The fee sheet is split into a diagnosis half and a procedure half (QA
// request): each half gets its own search (with only its own code systems)
// and its own selected-codes table.
const ICD_CODE_TYPES = CODE_TYPES.filter(ct => ct.key === 'ICD10');
const CPT_CODE_TYPES = CODE_TYPES.filter(ct => ct.key !== 'ICD10');

/**
 * Who the charges are billed to. `insurance` runs the payer flow (claim →
 * Insurance Posting → EOB → patient's copay/deductible); `self_pay` makes the
 * whole charge the patient's balance immediately, because there is no payer to
 * adjudicate it. Auto-detected from the patient's coverage, overridable by the
 * biller.
 */
type BillTo = 'insurance' | 'self_pay';

/**
 * CMS place-of-service code 11 — "Office". The fee sheet captures charges for
 * in-office encounters, and both billing paths (837P export and the RCM charge
 * push) must claim the same place of service for the same visit.
 */
const PLACE_OF_SERVICE_OFFICE = '11';

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
	/** Visit type of the encounter's appointment ("Follow-Up", "Consultation"…). */
	private visitType = '';

	private feeSheetId: string | null = null;
	private priceLevels: IDropdownOption[] = [];
	private selectedPriceLevel = '';
	private providers: IDropdownOption[] = [];
	private renderingProvider = '';
	private supervisingProvider = '';
	private items: FeeItem[] = [];

	/** Coverage on file for this patient — drives the Bill To default. */
	private coverages: IPatientCoverage[] = [];
	private billTo: BillTo = 'insurance';
	/**
	 * Set once the biller picks Bill To by hand. Auto-detection must never
	 * overwrite a deliberate choice on a later re-render (e.g. an insured patient
	 * the practice agreed to bill as cash).
	 */
	private billToTouched = false;

	private icdTableHost!: HTMLElement;
	private cptTableHost!: HTMLElement;
	private totalsHost!: HTMLElement;
	/** Undefined until the Bill To section exists — `_renderTotals` runs first. */
	private billToHost: HTMLElement | undefined;
	// Footer workflow gate (QA): the fee-sheet data must be SAVED first — only
	// then do "Send to Billing" and "Download 837P" unlock.
	private _saved = false;
	private billBtn: HTMLButtonElement | undefined;
	private ediBtn: HTMLButtonElement | undefined;
	private footerNote: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexRcmApiService private readonly rcmApi: ICiyexRcmApiService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
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
		this.visitType = '';
		this.feeSheetId = null;
		this.items = [];
		this.selectedPriceLevel = '';
		this.renderingProvider = '';
		this.supervisingProvider = '';
		this._saved = false;
		this.coverages = [];
		this.billTo = 'insurance';
		this.billToTouched = false;

		await this._loadData();
		if (token.isCancellationRequested) { return; }

		this._renderHeader();
		this._renderBody();
		this._renderFooter();
	}

	/** Load price levels, providers, coverage, and any existing fee sheet. */
	private async _loadData(): Promise<void> {
		// These loads are independent — run them in parallel so the editor opens as
		// fast as the slowest request rather than the sum of all of them. Each
		// keeps its own try/catch so one failure can't sink the others, and the
		// existing fee sheet must apply LAST since it overrides the default price
		// level / providers chosen above.
		const [, , , feeSheet] = await Promise.all([
			this._loadPriceLevels(),
			this._loadProviders(),
			this._loadVisitType(),
			this._loadExistingFeeSheet(),
			this._loadCoverage(),
		]);
		if (feeSheet) { this._applyExistingFeeSheet(feeSheet); }
	}

	/**
	 * Insurance on file for this patient, and the Bill To default that follows
	 * from it: no ACTIVE coverage means nobody will ever send an EOB, so the
	 * charges are the patient's own balance. A biller override always wins.
	 */
	private async _loadCoverage(): Promise<void> {
		this.coverages = await loadPatientCoverages(this.apiService, this.patientId);
		if (!this.billToTouched) {
			this.billTo = hasActiveInsurance(this.coverages) ? 'insurance' : 'self_pay';
		}
	}

	/**
	 * Visit type of the appointment the encounter was created from
	 * ("Consultation", "Follow-Up", "Telehealth"…). The fee sheet used to title
	 * itself with the encounter's raw FHIR class code — "AMB" — which means
	 * nothing to a biller (QA 27-Jul: "remove the encounter type as AMB, instead
	 * display the visit type of appointment"). Only the FLAT /api/appointments
	 * rows carry both the encounter link and the visit type; that endpoint
	 * ignores its ?patientId filter server-side, so the match is done here.
	 */
	private async _loadVisitType(): Promise<void> {
		if (!this.encounterId || this.encounterId === '_') { return; }
		try {
			const res = await this.apiService.fetch('/api/appointments?page=0&size=500');
			if (!res.ok) { return; }
			const json = await res.json();
			const rows = (json?.data?.content || json?.content || (Array.isArray(json?.data) ? json.data : [])) as Array<Record<string, unknown>>;
			const text = (v: unknown): string => {
				if (!v) { return ''; }
				if (typeof v === 'string') { return v.trim(); }
				const o = v as { text?: string; coding?: Array<{ display?: string; code?: string }> };
				return String(o.text || o.coding?.[0]?.display || o.coding?.[0]?.code || '').trim();
			};
			for (const a of (Array.isArray(rows) ? rows : [])) {
				if (String(a.encounterId ?? '') !== this.encounterId) { continue; }
				const t = text(a.visitType) || text(a.appointmentType) || text(a.serviceType) || text(a.type);
				if (t) { this.visitType = t; break; }
			}
		} catch { /* best-effort — the header falls back to the encounter label */ }
	}

	/** Price levels (from Settings → Price Level). */
	private async _loadPriceLevels(): Promise<void> {
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
	}

	/** Providers — merge facade + FHIR sources (mirrors calendarEditor). */
	private async _loadProviders(): Promise<void> {
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
					// Provider DTOs nest the name under `identification`
					// (firstName/lastName), unlike the flat patient shape — mirror
					// calendarEditor so the dropdown shows provider names instead of
					// falling back to the raw provider id.
					const ident = (p as { identification?: { prefix?: string; firstName?: string; lastName?: string } }).identification;
					const first = ident?.firstName || (p['identification.firstName'] as string) || (p.firstName as string) || '';
					const last = ident?.lastName || (p['identification.lastName'] as string) || (p.lastName as string) || '';
					const full = `${ident?.prefix || (p['identification.prefix'] as string) || ''} ${first} ${last}`.trim();
					const name = full || String(p.name ?? p.fullName ?? p.displayName ?? p.username ?? id);
					byId.set(id, { value: id, label: name });
				}
			}
			this.providers = Array.from(byId.values());
		} catch { /* */ }
	}

	/** Existing fee sheet for this encounter (signed-encounter fetch path). */
	private async _loadExistingFeeSheet(): Promise<Record<string, unknown> | null> {
		if (!this.encounterId || this.encounterId === '_') { return null; }
		try {
			const res = await this.apiService.fetch(`/api/fee-sheets/encounter/${encodeURIComponent(this.encounterId)}`);
			if (res.ok) {
				const data = await res.json() as Record<string, unknown>;
				const fs = (data?.data ?? data) as Record<string, unknown>;
				if (fs && (fs.id || Array.isArray(fs.items))) { return fs; }
			}
		} catch { /* no existing fee sheet — start blank */ }
		return null;
	}

	private _applyExistingFeeSheet(fs: Record<string, unknown>): void {
		this.feeSheetId = fs.id !== undefined && fs.id !== null ? String(fs.id) : null;
		// Even an already-persisted sheet must be explicitly saved THIS session
		// before Send to Billing / Download 837P unlock (QA: the follow-up
		// actions worked without saving — and without providers selected).
		this._saved = false;
		if (fs.priceLevel) { this.selectedPriceLevel = String(fs.priceLevel); }
		if (fs.renderingProvider) { this.renderingProvider = String(fs.renderingProvider); }
		if (fs.supervisingProvider) { this.supervisingProvider = String(fs.supervisingProvider); }
		const rawItems = (fs.items as Array<Record<string, unknown>>) || [];
		this.items = rawItems.map(it => this._normalizeItem(it));
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

	/**
	 * What the header calls this visit: the appointment's visit type when the
	 * encounter has one, otherwise the label we were opened with — with any raw
	 * FHIR class code in it expanded ("AMB" → "Ambulatory") so a code never
	 * reaches the biller.
	 */
	private _visitLabel(): string {
		if (this.visitType) { return this.visitType; }
		const label = this.encounterLabel.trim();
		if (!label) { return ''; }
		const expanded = expandEncounterType(label);
		return expanded && expanded !== label ? expanded : label;
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerBar);
		const visit = this._visitLabel();
		const title = DOM.append(this.headerBar, DOM.$('div'));
		title.style.cssText = 'font-size:15px;font-weight:600;';
		title.textContent = this.patientName
			? `Fee Sheet for ${this.patientName}${visit ? ` — ${visit}` : ''}`
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
		// Detached by the clear above; the Bill To section re-creates it below, and
		// until then `_renderTotals` must not paint into the old node.
		this.billToHost = undefined;

		// 0) Patient (manual mode only) — Approach 2: a fee sheet created from
		// scratch needs a patient. When opened from a signed encounter the
		// patient is already known and this picker is hidden.
		if (!this.patientId || this.patientId === '_') {
			this._sectionTitle(this.scrollArea, 'Patient');
			this._renderPatientPicker(this.scrollArea);
		}

		// 1) Set Price Level — practices without configured price levels bill at
		// the standard price, so the dropdown says exactly that instead of the
		// dead-end "No price levels configured" (QA request).
		this._sectionTitle(this.scrollArea, 'Set Price Level');
		const plWrap = DOM.append(this.scrollArea, DOM.$('div'));
		plWrap.style.cssText = 'max-width:320px;';
		if (!this.priceLevels.length && !this.selectedPriceLevel) { this.selectedPriceLevel = 'standard'; }
		createCustomDropdown({
			parent: plWrap,
			options: this.priceLevels.length ? this.priceLevels : [{ value: 'standard', label: 'Standard Price' }],
			initialValue: this.selectedPriceLevel,
			placeholder: 'Select price level…',
			onChange: v => { this.selectedPriceLevel = v; },
		});

		// 2) ICD half — diagnosis search + selected ICD codes table (QA: the fee
		// sheet is split into an ICD half and a CPT half, each with its own
		// search and table).
		this._sectionTitle(this.scrollArea, 'Search for ICD Codes');
		this._renderCodeSearch(this.scrollArea, ICD_CODE_TYPES);
		this._sectionTitle(this.scrollArea, 'Selected Fee Sheet ICD Codes');
		this.icdTableHost = DOM.append(this.scrollArea, DOM.$('div'));
		this.icdTableHost.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';

		// 3) CPT half — CPT/HCPCS search + selected charges table.
		this._sectionTitle(this.scrollArea, 'Search for CPT Codes');
		this._renderCodeSearch(this.scrollArea, CPT_CODE_TYPES);
		this._sectionTitle(this.scrollArea, 'Selected Fee Sheet CPT Codes and Charges');
		this.cptTableHost = DOM.append(this.scrollArea, DOM.$('div'));
		this.cptTableHost.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
		this.totalsHost = DOM.append(this.scrollArea, DOM.$('div'));
		this.totalsHost.style.cssText = 'display:flex;justify-content:flex-end;gap:24px;padding:10px 4px;font-size:13px;';
		this._renderItemsTables();

		// 4) Bill To — insurance claim, or straight to the patient's balance.
		this._sectionTitle(this.scrollArea, 'Bill To');
		this.billToHost = DOM.append(this.scrollArea, DOM.$('div'));
		this._renderBillTo();

		// 5) Select Providers
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
				// Only real providers as options — the empty "— N/A —" row and the
				// placeholder "clear" row are omitted (placeholder still shows in the
				// trigger via `required` until a provider is picked).
				options: [...this.providers],
				initialValue: value,
				placeholder: 'Select provider…',
				required: true,
				onChange,
			});
		};
		renderProvField('Rendering', this.renderingProvider, v => { this.renderingProvider = v; this._markDirty(); });
		renderProvField('Supervising', this.supervisingProvider, v => { this.supervisingProvider = v; this._markDirty(); });
	}

	/**
	 * Patient search + select for a manually-created fee sheet. Searches
	 * /api/patients; picking a result sets the patient and re-renders so the
	 * header shows the name and Save can attach the charge to that patient.
	 */
	private _renderPatientPicker(parent: HTMLElement): void {
		const wrap = DOM.append(parent, DOM.$('div'));
		wrap.style.cssText = 'position:relative;max-width:420px;';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		input.type = 'text';
		input.placeholder = 'Search patient by name or MRN…';
		input.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;outline:none;';
		const results = DOM.append(wrap, DOM.$('div'));
		results.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:50;background:var(--vscode-dropdown-background,var(--vscode-editorWidget-background,var(--vscode-editor-background)));border:1px solid var(--vscode-dropdown-border,var(--vscode-editorWidget-border));border-radius:4px;margin-top:2px;max-height:260px;overflow-y:auto;display:none;box-shadow:0 4px 8px rgba(0,0,0,0.2);';

		let seq = 0;
		const runSearch = async (q: string): Promise<void> => {
			const mine = ++seq;
			if (q.trim().length < 2) { results.style.display = 'none'; return; }
			try {
				const res = await this.apiService.fetch(`/api/patients?page=0&size=10&search=${encodeURIComponent(q.trim())}`);
				if (!res.ok || mine !== seq) { return; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
				DOM.clearNode(results);
				if (!list.length) { results.style.display = 'none'; return; }
				for (const p of list) {
					const id = String(p.id ?? '');
					const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || `Patient #${id}`;
					const mrn = p.mrn ? ` · MRN ${p.mrn}` : '';
					const row = DOM.append(results, DOM.$('div'));
					row.textContent = `${name}${mrn}`;
					row.style.cssText = 'padding:7px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);';
					row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground,rgba(128,128,128,0.16))'; });
					row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
					row.addEventListener('mousedown', async () => {
						this.patientId = id;
						this.patientName = name;
						results.style.display = 'none';
						this._renderHeader();
						this._renderBody();
						// Bill To depends on WHICH patient this is — re-detect against the
						// newly chosen one, then repaint just that control.
						await this._loadCoverage();
						this._renderBillTo();
						this._updateFooterGates();
					});
				}
				results.style.display = 'block';
			} catch {
				results.style.display = 'none';
			}
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		input.addEventListener('input', () => {
			if (timer) { clearTimeout(timer); }
			timer = setTimeout(() => runSearch(input.value), 250);
		});
		setTimeout(() => input.focus(), 0);
	}

	private _renderCodeSearch(parent: HTMLElement, codeTypes: Array<{ key: string; label: string; searchPath: string }>): void {
		let activeType = codeTypes[0].key;

		const radioRow = DOM.append(parent, DOM.$('div'));
		radioRow.style.cssText = 'display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap;';
		for (const ct of codeTypes) {
			const lbl = DOM.append(radioRow, DOM.$('label'));
			lbl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;';
			const r = DOM.append(lbl, DOM.$('input')) as HTMLInputElement;
			r.type = 'radio';
			// Each search half is its own radio group (ICD vs CPT/HCPCS).
			r.name = `feesheet-codetype-${codeTypes[0].key}`;
			r.value = ct.key;
			r.checked = ct.key === activeType;
			r.addEventListener('change', () => { if (r.checked) { activeType = ct.key; } });
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
				// ciyex-codes exposes the schedule amount as `medicareFee`; fall back
				// to any explicit price/fee field. Defaults to 0 (user can edit).
				const price = Number(c.price ?? c.fee ?? c.medicareFee ?? 0) || 0;
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
		// A fee sheet captures all of the encounter's codes — any number of
		// procedure (CPT/HCPCS) and diagnosis (ICD-10) lines. Adding a code that
		// is already on the sheet bumps its quantity instead of duplicating it.
		const existing = this.items.find(i => i.type === item.type && i.code === item.code);
		if (existing) { existing.qty += 1; } else { this.items.push(item); }
		this._markDirty();
		this._renderItemsTables();
	}

	/** Render both halves of the split fee sheet: diagnosis lines (ICD-10) in
	 *  the ICD table, procedure lines (CPT/HCPCS) in the charges table. */
	private _renderItemsTables(): void {
		this._renderItemsTable(this.icdTableHost, this.items.filter(it => it.type === 'ICD10'),
			'No ICD codes selected. Search above to add ICD-10 diagnosis codes.', true);
		this._renderItemsTable(this.cptTableHost, this.items.filter(it => it.type !== 'ICD10'),
			'No CPT codes selected. Search above to add CPT or HCPCS codes.', false);
		this._renderTotals();
	}

	private _renderItemsTable(host: HTMLElement, items: FeeItem[], emptyText: string, icdOnly: boolean): void {
		// Diagnosis lines carry no charge data — the ICD table drops the
		// Modifier / Price / Qty / Justify columns (QA request).
		const COLS = icdOnly
			? '70px 90px minmax(220px,2fr) minmax(160px,1fr) 50px 40px'
			: '70px 90px minmax(180px,1.6fr) 110px 90px 60px 90px minmax(120px,1fr) 50px 40px';
		DOM.clearNode(host);

		const header = DOM.append(host, DOM.$('div'));
		header.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;padding:8px 10px;background:rgba(0,122,204,0.05);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);`;
		const headings = icdOnly
			? ['Type', 'Code', 'Description', 'Notes', 'Auth', '']
			: ['Type', 'Code', 'Description', 'Modifier', 'Price', 'Qty', 'Justify', 'Notes', 'Auth', ''];
		for (const h of headings) {
			DOM.append(header, DOM.$('span')).textContent = h;
		}

		if (items.length === 0) {
			const empty = DOM.append(host, DOM.$('div'));
			empty.textContent = emptyText;
			empty.style.cssText = 'padding:16px 10px;color:var(--vscode-descriptionForeground);font-size:12px;font-style:italic;';
		}

		const inputStyle = 'width:100%;box-sizing:border-box;padding:4px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		for (const it of items) {
			const row = DOM.append(host, DOM.$('div'));
			row.style.cssText = `display:grid;grid-template-columns:${COLS};gap:6px;align-items:center;padding:6px 10px;border-top:1px solid rgba(128,128,128,0.08);`;

			DOM.append(row, DOM.$('span')).textContent = it.type;
			const codeEl = DOM.append(row, DOM.$('span'));
			codeEl.textContent = it.code;
			codeEl.style.cssText = 'font-weight:600;font-family:var(--vscode-editor-font-family,monospace);';
			const descEl = DOM.append(row, DOM.$('span'));
			descEl.textContent = it.description;
			descEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			descEl.title = it.description;

			if (!icdOnly) {
				const modInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				modInp.value = it.modifiers; modInp.style.cssText = inputStyle;
				modInp.addEventListener('input', () => { it.modifiers = modInp.value; this._markDirty(); });

				const priceInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				priceInp.type = 'number'; priceInp.step = '0.01'; priceInp.value = String(it.price);
				// Drop the native up/down spin-button "Adjust" control (QA) — see
				// .ciyex-num-noSpin in ciyexCommon.css.
				priceInp.classList.add('ciyex-num-noSpin');
				priceInp.style.cssText = inputStyle + 'appearance:textfield;-moz-appearance:textfield;';
				priceInp.addEventListener('input', () => { it.price = parseFloat(priceInp.value) || 0; this._markDirty(); this._renderTotals(); });

				const qtyInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				qtyInp.type = 'number'; qtyInp.value = String(it.qty);
				qtyInp.classList.add('ciyex-num-noSpin');
				qtyInp.style.cssText = inputStyle + 'appearance:textfield;-moz-appearance:textfield;';
				qtyInp.addEventListener('input', () => { it.qty = parseInt(qtyInp.value, 10) || 0; this._markDirty(); this._renderTotals(); });

				const justInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
				justInp.value = it.justify; justInp.placeholder = 'ICD'; justInp.style.cssText = inputStyle;
				justInp.addEventListener('input', () => { it.justify = justInp.value; this._markDirty(); });
			}

			const noteInp = DOM.append(row, DOM.$('input')) as HTMLInputElement;
			noteInp.value = it.note; noteInp.style.cssText = inputStyle;
			noteInp.addEventListener('input', () => { it.note = noteInp.value; this._markDirty(); });

			const authWrap = DOM.append(row, DOM.$('div'));
			authWrap.style.cssText = 'display:flex;justify-content:center;';
			const authInp = DOM.append(authWrap, DOM.$('input')) as HTMLInputElement;
			authInp.type = 'checkbox'; authInp.checked = it.auth; authInp.style.cssText = 'cursor:pointer;';
			authInp.addEventListener('change', () => { it.auth = authInp.checked; this._markDirty(); });

			const rm = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			rm.textContent = '\u{1F5D1}'; rm.title = 'Remove'; rm.style.cssText = 'background:transparent;border:none;color:var(--vscode-errorForeground,#f48771);cursor:pointer;font-size:13px;';
			rm.addEventListener('click', () => {
				const idx = this.items.indexOf(it);
				if (idx >= 0) { this.items.splice(idx, 1); }
				this._markDirty();
				this._renderItemsTables();
			});
		}
	}

	/**
	 * What the patient (or the payer) is actually charged: the PROCEDURE lines
	 * only. ICD-10 rows render no price input, so a diagnosis whose fee schedule
	 * happens to carry a non-zero `medicareFee` would otherwise inflate the bill
	 * with no way to correct it on screen. Every downstream consumer of a claim's
	 * charge already excludes ICD rows the same way (`_feeSheetToClaim`,
	 * patientBilling, patientLedger) — this matches them.
	 */
	private _procedureTotal(): number {
		const total = this.items
			.filter(it => it.type !== 'ICD10')
			.reduce((s, it) => s + (it.price * it.qty), 0);
		return Math.round(total * 100) / 100;
	}

	/**
	 * Bill To picker: two mutually-exclusive choices plus what the auto-detection
	 * found. Choosing does NOT mark the sheet dirty — Bill To is a routing
	 * decision made at Send-to-Billing time, not part of the saved payload, so it
	 * must not re-lock the save gate the way editing a code does.
	 */
	private _renderBillTo(): void {
		if (!this.billToHost) { return; }
		DOM.clearNode(this.billToHost);
		this.billToHost.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-width:680px;';

		const row = DOM.append(this.billToHost, DOM.$('div'));
		row.style.cssText = 'display:flex;gap:18px;flex-wrap:wrap;';

		const coverage = activeCoverage(this.coverages);
		const insured = hasActiveInsurance(this.coverages);

		const choice = (value: BillTo, label: string, hint: string): void => {
			const lbl = DOM.append(row, DOM.$('label'));
			lbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;';
			lbl.title = hint;
			const r = DOM.append(lbl, DOM.$('input')) as HTMLInputElement;
			r.type = 'radio';
			r.name = 'feesheet-billto';
			r.value = value;
			r.checked = this.billTo === value;
			r.addEventListener('change', () => {
				if (!r.checked) { return; }
				this.billTo = value;
				this.billToTouched = true;
				this._renderBillTo();
				// Self-pay has no payer to address an 837P to.
				this._updateFooterGates();
			});
			const span = DOM.append(lbl, DOM.$('span'));
			span.textContent = label;
			if (this.billTo === value) { span.style.fontWeight = '600'; }
		};

		choice('insurance', 'Insurance Claim',
			'Creates a claim for the payer. It waits in Payments → Insurance Posting until the EOB is posted, which decides the copay / deductible the patient owes.');
		choice('self_pay', 'Self-Pay (Patient)',
			'No payer is billed. The full charge becomes the patient balance straight away, collectable in Payments → Dashboard.');

		const note = DOM.append(this.billToHost, DOM.$('div'));
		note.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		if (this.billTo === 'self_pay') {
			const total = this._procedureTotal();
			// allow-any-unicode-next-line
			note.textContent = insured
				// allow-any-unicode-next-line
				? `ⓘ Billing as self-pay by choice — this patient DOES have active coverage on file (${coverageLabel(coverage)}). The full $${total.toFixed(2)} becomes their balance and no claim is sent to the payer.`
				// allow-any-unicode-next-line
				: `ⓘ No active insurance on file for this patient — the full $${total.toFixed(2)} becomes their balance. No claim goes to Insurance Posting.`;
			note.style.color = insured ? '#f59e0b' : 'var(--vscode-descriptionForeground)';
		} else if (insured) {
			// allow-any-unicode-next-line
			note.textContent = `ⓘ Detected coverage: ${coverageLabel(coverage)}.`;
		} else {
			// allow-any-unicode-next-line
			note.textContent = '⚠ No active insurance on file for this patient. Billing this as an insurance claim will leave it waiting for an EOB that never arrives — choose Self-Pay unless you are about to add their coverage.';
			note.style.color = '#f59e0b';
		}
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
		// The self-pay note quotes the amount that becomes the patient's balance,
		// so it has to follow every price / qty / code edit.
		this._renderBillTo();
	}

	private _renderFooter(): void {
		DOM.clearNode(this.footerBar);

		// Workflow order (QA): the data is SAVED first — "Send to Billing" and
		// "Download 837P" stay locked until the save succeeds.
		const saveBtn = this._footerButton('✓ Save Current', '#0e639c');
		saveBtn.addEventListener('click', async () => {
			saveBtn.disabled = true;
			const ok = await this._save();
			saveBtn.disabled = false;
			if (ok) {
				this._saved = true;
				this._updateFooterGates();
				this.notificationService.notify({ severity: Severity.Info, message: 'Fee sheet saved. You can now send it to billing or download the 837P file.' });
			}
		});

		const billBtn = this.billBtn = this._footerButton('\u{1F4E4} Send to Billing', '#2e7d32');
		billBtn.addEventListener('click', async () => {
			billBtn.disabled = true;
			await this._sendToBilling();
			billBtn.disabled = false;
			this._updateFooterGates();
		});

		// Basic claims tier (every practice, no ciyex-rcm subscription needed):
		// export this fee sheet as an 837P X12 file to submit through your own
		// clearinghouse.
		const ediBtn = this.ediBtn = this._footerButton('\u{2B07} Download 837P (X12)', '#5b21b6');
		ediBtn.addEventListener('click', async () => {
			ediBtn.disabled = true;
			await this._downloadEdi837();
			ediBtn.disabled = false;
			this._updateFooterGates();
		});
		this._updateFooterGates();

		const spacer = DOM.append(this.footerBar, DOM.$('div'));
		spacer.style.flex = '1';

		this.footerNote = DOM.append(this.footerBar, DOM.$('span'));
		this.footerNote.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		this._updateFooterNote();
	}

	/** What "Send to Billing" is about to do, given the current Bill To choice. */
	private _updateFooterNote(): void {
		if (!this.footerNote) { return; }
		if (this.billTo === 'self_pay') {
			this.footerNote.textContent = '"Send to Billing" makes the full charge the patient\'s balance — collect it in Payments → Dashboard. No claim is sent to a payer.';
			return;
		}
		// The pre-existing note claimed this also emails the patient. It does not:
		// `FeeSheetService.bill` ignores the `sendEmail` flag and no other code on
		// this path sends mail — the patient is emailed later, from the Dashboard's
		// Invoice action.
		this.footerNote.textContent = this.rcmApi.isAvailable()
			? '"Send to Billing" creates the claim in Payments → Insurance Posting and a draft claim in RCM.'
			: '"Send to Billing" creates the claim in Payments → Insurance Posting, ready for the payer\'s EOB.';
	}

	private _footerButton(label: string, bg: string): HTMLButtonElement {
		const b = DOM.append(this.footerBar, DOM.$('button')) as HTMLButtonElement;
		b.textContent = label;
		b.style.cssText = `padding:7px 16px;background:${bg};color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:500;`;
		return b;
	}

	/** Any edit after a save re-locks Send to Billing / Download 837P until the
	 *  sheet is saved again — the exported/billed data must match what's on
	 *  screen. */
	private _markDirty(): void {
		this._saved = false;
		this._updateFooterGates();
	}

	/** Apply the save-first workflow gate to the footer actions. */
	private _updateFooterGates(): void {
		for (const b of [this.billBtn, this.ediBtn]) {
			if (!b) { continue; }
			b.disabled = !this._saved;
			b.style.opacity = this._saved ? '1' : '0.45';
			b.style.cursor = this._saved ? 'pointer' : 'not-allowed';
			b.title = this._saved ? '' : 'Save the fee sheet first';
		}
		// A self-pay sheet has no payer, so there is nobody to address an 837P to.
		// It used to export one anyway, with the payer loop filled in as
		// "UNKNOWN PAYER" — a file no clearinghouse can do anything with.
		if (this.ediBtn && this.billTo === 'self_pay') {
			this.ediBtn.disabled = true;
			this.ediBtn.style.opacity = '0.45';
			this.ediBtn.style.cursor = 'not-allowed';
			this.ediBtn.title = 'Self-pay charges have no payer to submit an 837P claim to. Switch Bill To to "Insurance Claim" to export one.';
		}
		this._updateFooterNote();
	}

	private _buildPayload(): Record<string, unknown> {
		return {
			id: this.feeSheetId,
			encounterId: this.encounterId && this.encounterId !== '_' ? this.encounterId : null,
			patientId: this.patientId && this.patientId !== '_' ? this.patientId : null,
			patientName: this.patientName || null,
			priceLevel: this.selectedPriceLevel,
			renderingProvider: this.renderingProvider || null,
			supervisingProvider: this.supervisingProvider || null,
			total: this.items.reduce((s, it) => s + it.price * it.qty, 0),
			items: this.items,
		};
	}

	/** Persist the fee sheet. Returns true on success. */
	private async _save(): Promise<boolean> {
		if ((!this.patientId || this.patientId === '_') && (!this.encounterId || this.encounterId === '_')) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Choose a patient before saving the fee sheet.' });
			return false;
		}
		if (this.items.length === 0) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Add at least one code before saving.' });
			return false;
		}
		// Providers are part of the billable record — a fee sheet without its
		// rendering provider must not reach billing / 837P export (QA).
		if (!this.renderingProvider) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Select a rendering provider before saving the fee sheet.' });
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
			// Capture the persisted id from the save response (shared envelope
			// parser) so a subsequent Save/Send-to-Billing reuses it as a PUT.
			const saved = await parseSavedRecord(res);
			if (saved?.id !== undefined && saved?.id !== null) { this.feeSheetId = String(saved.id); }
			return true;
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Save failed: ${e}` });
			return false;
		}
	}

	/**
	 * Save the fee sheet then push it to billing. Marking the sheet "Billed" is
	 * what creates the claim; where the money is owed from there depends on Bill
	 * To:
	 *
	 *  - INSURANCE — the claim waits in Payments → Insurance Posting for the
	 *    payer's EOB, which decides the patient's copay / deductible.
	 *  - SELF-PAY — there is no payer, so the full charge is recorded as the
	 *    patient's responsibility here and now and the claim is kept out of the
	 *    Insurance Posting work list entirely.
	 */
	private async _sendToBilling(): Promise<void> {
		const ok = await this._save();
		if (!ok || !this.feeSheetId) { return; }
		const selfPay = this.billTo === 'self_pay';
		try {
			// `billedMode` is deliberately not sent: it is the payment METHOD
			// (cash/check/card/ach), not who is billed, and it already defaults to
			// "cash" on every sheet — which is exactly why it cannot be used to tell
			// a self-pay claim from an insured one.
			const res = await this.apiService.fetch(`/api/fee-sheets/${encodeURIComponent(this.feeSheetId)}/bill`, {
				method: 'POST',
				body: JSON.stringify({ patientId: this.patientId }),
			});
			if (!res.ok) {
				this.notificationService.notify({ severity: Severity.Error, message: `Send to billing failed (${res.status}).` });
				return;
			}
			// Billing the fee sheet creates the claim — the claim number is derived
			// from the fee-sheet id, so it auto-increments across claims.
			const claimNo = claimNumberForFeeSheet(this.feeSheetId);
			if (selfPay) {
				await this._assignSelfPayBalance(claimNo);
			} else {
				// Switching an already-self-pay sheet back to insurance: retire the
				// patient's self-pay balance so the claim can be adjudicated normally.
				await this._clearSelfPayBalance(claimNo);
				this.notificationService.notify({ severity: Severity.Info, message: `Charges sent to billing — claim ${claimNo} created. Post the payer's EOB against it in Payments → Insurance Posting.` });
			}
			// Surface the new charge in the Payments dashboard.
			this.commandService.executeCommand('ciyex.openPayments').then(undefined, () => { });
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Send to billing failed: ${e}` });
			return;
		}
		// RCM handoff (orgs with the ciyex-rcm marketplace app): push the charges
		// into the revenue cycle and create a draft claim. Non-fatal by design —
		// the native billing flow above must not regress when the RCM service is
		// down or the org isn't subscribed. Skipped for self-pay: the revenue cycle
		// is about getting paid by payers, and this claim has none.
		if (!selfPay && this.rcmApi.isAvailable()) {
			await this._pushToRcm();
		}
	}

	/**
	 * Record the whole charge as the patient's balance. Idempotent per claim, so
	 * pressing Send to Billing twice — or editing the sheet and re-sending —
	 * leaves ONE responsibility record holding the current total.
	 */
	private async _assignSelfPayBalance(claimNo: string): Promise<void> {
		const due = this._procedureTotal();
		const result = await syncSelfPayResponsibility(this.apiService, {
			patientId: this.patientId,
			patientName: this.patientName,
			claimRef: claimNo,
			feeSheetId: this.feeSheetId ?? undefined,
			encounterId: this.encounterId && this.encounterId !== '_' ? this.encounterId : undefined,
			serviceDate: new Date().toISOString().slice(0, 10),
			due,
		});
		if (result.error) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: `Claim ${claimNo} was created, but the patient's self-pay balance could not be recorded: ${result.error} Collect it from the Payments → Dashboard row for this encounter.`,
			});
			return;
		}
		if (due <= 0.005) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: `Charges sent to billing — claim ${claimNo} created, but every procedure line is priced $0.00, so there is nothing to collect. Add prices and send again.`,
			});
			return;
		}
		// After a part payment the outstanding figure is less than the charge — say
		// what is actually left to collect rather than re-quoting the full total.
		const alreadyPaid = Math.round((due - result.amount) * 100) / 100;
		this.notificationService.notify({
			severity: Severity.Info,
			message: alreadyPaid > 0.005
				? `Charges sent to billing — claim ${claimNo} updated. This patient has no insurance, so the $${due.toFixed(2)} charge is their balance; $${alreadyPaid.toFixed(2)} is already collected, leaving $${result.amount.toFixed(2)} due in Payments → Dashboard.`
				: `Charges sent to billing — claim ${claimNo} created. This patient has no insurance, so the full $${result.amount.toFixed(2)} is their balance. Collect it in Payments → Dashboard.`,
		});
	}

	/**
	 * Undo a self-pay assignment because the sheet is now being billed to
	 * insurance. Money already collected is never silently deleted — the biller is
	 * told to refund or adjust it instead.
	 */
	private async _clearSelfPayBalance(claimNo: string): Promise<void> {
		const result = await syncSelfPayResponsibility(this.apiService, {
			patientId: this.patientId, claimRef: claimNo, due: 0,
		});
		if (result.blocked) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: `Claim ${claimNo} was billed to insurance, but $${result.amount.toFixed(2)} has already been collected from the patient as self-pay. That payment was left in place — refund or adjust it on the patient's ledger once the payer's EOB decides what they actually owe.`,
			});
		}
	}

	/**
	 * Mirror the fee sheet into ciyex-rcm: one ChargeEntry per procedure line
	 * (CPT/HCPCS), each carrying the sheet's ICD-10 codes, then convert the
	 * created charges into a single draft claim the biller works in the RCM
	 * claim editor. Because fee sheets are stored locally in the app, the
	 * pushed charges are the remote system of record — the local fee-sheet id
	 * travels in `notes` for traceability.
	 */
	private async _pushToRcm(): Promise<void> {
		const procedures = this.items.filter(it => it.type !== 'ICD10');
		if (procedures.length === 0) { return; }
		const diagnoses = this.items.filter(it => it.type === 'ICD10').map(it => it.code).filter(Boolean);
		const icdCodes = diagnoses.join(',');
		// Every line points at every diagnosis — the same safe default the 837P
		// export uses, refined later by the biller in the RCM claim editor.
		const diagnosisPointers = diagnoses.map((_, i) => i + 1).join(',').slice(0, 20);
		const today = new Date().toISOString().slice(0, 10);

		// `rcm_charges.provider_npi` is NOT NULL, so posting without one fails the
		// whole handoff on the very first line. Resolve it up front and say what
		// to fix rather than firing requests that cannot succeed.
		const { npi: providerNpi, name: providerName } = await this._billingProvider();
		if (!providerNpi) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: 'RCM handoff skipped (local billing unaffected): no billing NPI on file. Set one on the rendering provider, on the practice, or in Settings → Ciyex: Billing / EDI → Billing NPI, then send to billing again.',
			});
			return;
		}

		try {
			const chargeIds: string[] = [];
			for (const it of procedures) {
				const json = await this.rcmApi.fetchJson<{ data?: { id?: string } }>('/api/rcm/charges', {
					method: 'POST',
					body: JSON.stringify({
						patientId: this.patientId && this.patientId !== '_' ? this.patientId : null,
						providerNpi,
						// The claim needs a billing provider NAME too (PRV-003). Send what
						// the practice knows rather than making RCM's credentialing roster
						// a prerequisite for billing at all.
						providerName: providerName || null,
						cptCode: it.code,
						icd10Codes: icdCodes || (it.justify || null),
						diagnosisPointers: diagnosisPointers || null,
						modifier1: it.modifiers ? it.modifiers.split(/[,\s]+/)[0] : null,
						modifier2: it.modifiers ? it.modifiers.split(/[,\s]+/)[1] || null : null,
						description: it.description,
						units: it.qty,
						chargeAmount: it.price,
						dateOfService: today,
						placeOfService: PLACE_OF_SERVICE_OFFICE,
						notes: `Fee sheet ${this.feeSheetId} (Ciyex EHR)`,
					}),
				});
				const id = (json?.data as { id?: string } | undefined)?.id;
				if (id) { chargeIds.push(String(id)); }
			}
			if (chargeIds.length === 0) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'RCM: charges were not accepted — claim not created.' });
				return;
			}
			const claimJson = await this.rcmApi.fetchJson<{ data?: { id?: string; claimNumber?: string } }>('/api/rcm/charges/convert-to-claim', {
				method: 'POST',
				body: JSON.stringify(chargeIds),
			});
			const claim = claimJson?.data;
			if (claim?.id) {
				await this._applyClaimIdentity(String(claim.id));
				const outcome = await this._finalizeRcmClaim(String(claim.id));
				const label = claim.claimNumber || claim.id;
				this.notificationService.notify({
					severity: outcome.ready ? Severity.Info : Severity.Warning,
					message: outcome.summary
						? `RCM claim ${label} — ${outcome.summary}.`
						: `Draft claim ${label} created in RCM.`,
					actions: {
						primary: [{
							id: 'ciyex.rcm.openCreatedClaim', label: 'Open Claim', tooltip: '', class: undefined, enabled: true,
							run: () => this.commandService.executeCommand('ciyex.rcm.openClaim', String(claim.id), claim.claimNumber),
						}],
					},
				});
			} else {
				this.notificationService.notify({ severity: Severity.Info, message: `RCM: ${chargeIds.length} charge(s) pushed; claim conversion pending.` });
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Warning, message: `RCM handoff failed (local billing unaffected): ${e instanceof Error ? e.message : e}` });
		}
	}

	/**
	 * The provider a pushed charge is billed under — NPI and name together, from
	 * whichever source supplied them, so the two never disagree. `rcm_charges.provider_npi` is NOT
	 * NULL and the converted claim validates it as the BILLING provider NPI
	 * (PRV-001), so precedence mirrors the 837P billing loop: the
	 * `ciyex.billing.billingNpi` override first, then the practice's own NPI.
	 * The rendering provider is the last resort so practices that have not filled
	 * in their billing identifiers yet still get a working handoff.
	 *
	 * Returns '' when nothing usable is on file. Every lookup fails soft — a
	 * missing NPI must read as "not on file", never as a hard error.
	 */
	private async _billingProvider(): Promise<{ npi: string; name: string }> {
		// The `npi` field holds free text in places, so only a clean 10-digit
		// value is trusted — we must never ship a phone number as an NPI.
		const clean = (value: unknown): string => {
			const digits = String(value ?? '').replace(/[^0-9]/g, '');
			return digits.length === 10 ? digits : '';
		};
		const str = (value: unknown): string => String(value ?? '').trim();

		const configured = clean(this.configurationService.getValue<string>('ciyex.billing.billingNpi'));
		if (configured) {
			return { npi: configured, name: str(this.configurationService.getValue<string>('ciyex.billing.billingName')) };
		}

		const practice = await this._fetchPractice();
		const practiceNpi = clean(practice.npi);
		if (practiceNpi) { return { npi: practiceNpi, name: str(practice.name) }; }

		if (this.renderingProvider) {
			try {
				const res = await this.apiService.fetch(`/api/providers/${encodeURIComponent(this.renderingProvider)}`);
				if (res.ok) {
					const json = await res.json();
					const provider = (json?.data ?? json) as Record<string, unknown>;
					const ident = (provider.identification as { firstName?: string; lastName?: string }) || {};
					return {
						npi: clean(provider.npi),
						name: `${str(ident.firstName)} ${str(ident.lastName)}`.trim(),
					};
				}
			} catch { /* no provider record — fall through to "not on file" */ }
		}
		return { npi: '', name: '' };
	}

	/**
	 * Name the payer and patient on a freshly converted claim. The charge
	 * endpoint carries neither, so a claim built from charges alone arrives with
	 * no payer and fails validation (PAY-002) — the biller would have to retype
	 * what the fee sheet already knows. Both calls fail soft: the draft claim
	 * exists either way and is still workable in the RCM claim editor.
	 */
	/**
	 * Have RCM check the claim we just built, rather than leaving it in DRAFT for a
	 * biller to find and run three sidebar actions against. The practice's own
	 * settings decide how far it goes — validate and scrub by default, transmit only
	 * if they have opted into that — and the answer comes back as one sentence to
	 * show the person who pressed Send to Billing.
	 *
	 * Fails soft: the claim exists either way and can still be worked by hand.
	 */
	private async _finalizeRcmClaim(claimId: string): Promise<{ ready: boolean; summary: string }> {
		try {
			const res = await this.rcmApi.fetch(`/api/rcm/claims/${encodeURIComponent(claimId)}/finalize`, { method: 'POST' });
			const json = await res.json().catch(() => null) as { message?: string; data?: { ready?: boolean; summary?: string } } | null;
			const data = json?.data;
			return { ready: data?.ready === true, summary: data?.summary || json?.message || '' };
		} catch {
			return { ready: false, summary: '' };
		}
	}

	private async _applyClaimIdentity(claimId: string): Promise<void> {
		const coverage = activeCoverage(this.coverages);
		const requests: Array<[string, Record<string, string>]> = [];
		if (coverage?.payerName) {
			requests.push([`/api/rcm/claims/${encodeURIComponent(claimId)}/apply-coverage`, {
				payerName: coverage.payerName,
				subscriberId: coverage.memberId,
				groupNumber: coverage.groupNumber,
			}]);
		}
		if (this.patientName) {
			requests.push([`/api/rcm/claims/${encodeURIComponent(claimId)}/sync-patient`, { patientName: this.patientName }]);
		}
		for (const [path, body] of requests) {
			try {
				await this.rcmApi.fetch(path, { method: 'PUT', body: JSON.stringify(body) });
			} catch { /* claim is still usable without it */ }
		}
	}

	/**
	 * Basic claims tier: build an 837P X12 file from this fee sheet and download
	 * it so the practice can submit through its OWN clearinghouse — no ciyex-rcm
	 * subscription required. Diagnoses come from the sheet's ICD-10 lines and
	 * each procedure line points at every diagnosis (a safe default the biller
	 * can refine in the clearinghouse). Patient demographics + insurance are
	 * pulled from the EHR; site identifiers (submitter/receiver/billing NPI +
	 * tax id) come from the ciyex.billing.* settings.
	 */
	private async _downloadEdi837(): Promise<void> {
		const procedures = this.items.filter(it => it.type !== 'ICD10');
		if (procedures.length === 0) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Add at least one procedure (CPT/HCPCS) code before exporting a claim.' });
			return;
		}
		if (!this.patientId || this.patientId === '_') {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Choose a patient before exporting a claim.' });
			return;
		}

		// Pull the real data: patient + coverage + rendering provider, and the
		// practice/billing-provider record. Run them together — independent calls.
		const [patient, practice] = await Promise.all([this._fetchPatientForEdi(), this._fetchPractice()]);
		const insurance = patient.insurance;

		// ciyex.billing.* settings override the fetched backend values (a practice
		// may bill under a different entity or a clearinghouse-specific name).
		const cfg = (key: string): string => {
			const v = this.configurationService.getValue<string>(key);
			return (v === undefined || v === null) ? '' : String(v);
		};
		const pick = (setting: string, fetched?: string, fallback = ''): string => cfg(setting) || fetched || fallback;

		const billingName = pick('ciyex.billing.billingName', practice.name) || cfg('ciyex.practice.name') || 'Practice';
		const billingNpi = pick('ciyex.billing.billingNpi', practice.npi);
		const billingTaxId = pick('ciyex.billing.billingTaxId', practice.taxId);
		// Interchange IDs are clearinghouse-assigned — settings only (not in the
		// practice record). These are the one thing a practice must configure.
		const submitterId = cfg('ciyex.billing.submitterId');
		const receiverId = cfg('ciyex.billing.receiverId');

		const missing: string[] = [];
		if (!submitterId) { missing.push('Submitter ID'); }
		if (!receiverId) { missing.push('Receiver ID'); }
		if (!billingNpi) { missing.push('Billing NPI'); }
		if (!billingTaxId) { missing.push('Billing Tax ID'); }
		if (!insurance.payerName) { missing.push('patient\'s insurance (no coverage on file)'); }
		if (this.items.reduce((s, it) => s + it.price * it.qty, 0) === 0) { missing.push('charge amounts (all $0)'); }
		if (missing.length) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: `837P generated, but these are missing/blank: ${missing.join('; ')}. Submitter/Receiver IDs come from Settings → Ciyex: Billing / EDI; NPI/Tax ID/payer/charges come from the practice, patient coverage and fee-sheet prices.`,
			});
		}

		const diagnoses = this.items.filter(it => it.type === 'ICD10').map(it => it.code).filter(Boolean);
		const allPointers = diagnoses.map((_, i) => i + 1);
		const today = new Date();
		const dos = today.toISOString().slice(0, 10);
		const nameParts = (this.patientName || '').split(/\s+/);
		const firstName = patient.firstName || nameParts[0] || '';
		const lastName = patient.lastName || nameParts.slice(1).join(' ') || nameParts[0] || 'Patient';

		const lines: Edi837ServiceLine[] = procedures.map(it => ({
			cptCode: it.code,
			modifiers: it.modifiers ? it.modifiers.split(/[,\s]+/).filter(Boolean) : [],
			chargeAmount: it.price * it.qty,
			units: it.qty,
			diagnosisPointers: allPointers.length ? allPointers : [1],
		}));

		const claim: Edi837Claim = {
			submitterId, submitterName: pick('ciyex.billing.submitterName', practice.name, billingName),
			submitterContactName: practice.name, submitterPhone: practice.phone, submitterEmail: practice.email,
			receiverId, receiverName: cfg('ciyex.billing.receiverName') || 'CLEARINGHOUSE',
			usageIndicator: this.configurationService.getValue<boolean>('ciyex.billing.productionMode') ? 'P' : 'T',
			billingName, billingNpi, billingTaxId,
			billingAddress1: pick('ciyex.billing.billingAddress1', practice.address1),
			billingCity: pick('ciyex.billing.billingCity', practice.city),
			billingState: pick('ciyex.billing.billingState', practice.state),
			billingZip: pick('ciyex.billing.billingZip', practice.zip),
			patientFirstName: firstName, patientLastName: lastName,
			patientDob: patient.dob, patientGender: patient.gender,
			patientAddress1: patient.address1, patientCity: patient.city, patientState: patient.state, patientZip: patient.zip,
			subscriberId: insurance.policyNumber || patient.mrn || String(this.patientId),
			groupNumber: insurance.groupNumber,
			payerName: insurance.payerName || 'UNKNOWN PAYER', payerId: insurance.payerId,
			claimNumber: this.feeSheetId ? claimNumberForFeeSheet(this.feeSheetId) : `CLM-${Date.now()}`,
			totalCharge: this.items.reduce((s, it) => s + it.price * it.qty, 0),
			placeOfService: PLACE_OF_SERVICE_OFFICE,
			dateOfService: dos,
			renderingProviderNpi: patient.renderingNpi,
			renderingProviderFirstName: patient.renderingFirstName,
			renderingProviderLastName: patient.renderingLastName,
			renderingProviderTaxonomy: patient.renderingTaxonomy,
			diagnoses,
			lines,
		};

		try {
			const edi = generate837P(claim, today);
			downloadEdi(DOM.getWindow(this.root), `claim-${claim.claimNumber}-837P.txt`, edi);
			this.notificationService.notify({ severity: Severity.Info, message: `837P claim file downloaded (${lines.length} service line${lines.length === 1 ? '' : 's'}). Upload it to your clearinghouse to submit.` });
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Could not generate the 837P file: ${e instanceof Error ? e.message : e}` });
		}
	}

	/**
	 * Pull the REAL data the 837P needs from the backend (not placeholders):
	 *  - patient demographics + address (/api/patients)
	 *  - active insurance coverage → payer name, member/policy #, group
	 *    (/api/fhir-resource/insurance-coverage), then resolve the electronic
	 *    payer id from the payer directory (/api/insurance-companies)
	 *  - rendering provider name + NPI + taxonomy (/api/providers)
	 * Each source is independent and fails soft so a missing one never blocks
	 * the export — the field just stays blank (which the clearinghouse flags).
	 */
	private async _fetchPatientForEdi(): Promise<{
		firstName?: string; lastName?: string; dob?: string; gender?: string; mrn?: string;
		address1?: string; city?: string; state?: string; zip?: string;
		insurance: { payerName?: string; payerId?: string; policyNumber?: string; groupNumber?: string };
		renderingNpi?: string; renderingFirstName?: string; renderingLastName?: string; renderingTaxonomy?: string;
	}> {
		const out: Awaited<ReturnType<FeeSheetEditor['_fetchPatientForEdi']>> = { insurance: {} };
		const getJson = async (path: string): Promise<Record<string, unknown> | null> => {
			try { const r = await this.apiService.fetch(path); return r.ok ? await r.json() : null; } catch { return null; }
		};
		const listOf = (j: Record<string, unknown> | null): Record<string, unknown>[] => {
			const d = j?.data as { content?: unknown[] } | unknown[] | undefined;
			if (Array.isArray(d)) { return d as Record<string, unknown>[]; }
			const nested = (d as { content?: unknown[] } | undefined)?.content ?? (j?.content as unknown[] | undefined);
			return Array.isArray(nested) ? nested as Record<string, unknown>[] : [];
		};

		// Patient demographics.
		const pj = await getJson(`/api/patients/${encodeURIComponent(this.patientId)}`);
		if (pj) {
			const p = (pj.data ?? pj) as Record<string, unknown>;
			out.firstName = (p.firstName as string) || undefined;
			out.lastName = (p.lastName as string) || undefined;
			out.dob = (p.dob as string) || (p.dateOfBirth as string) || undefined;
			out.gender = (p.gender as string) || (p.sex as string) || undefined;
			out.mrn = (p.mrn as string) || undefined;
			out.address1 = (p.addressLine1 as string) || (p.address as string) || undefined;
			out.city = (p.city as string) || undefined;
			out.state = (p.state as string) || undefined;
			out.zip = (p.zip as string) || (p.zipCode as string) || (p.postalCode as string) || undefined;
		}

		// Active insurance coverage (FHIR Coverage) — the real payer + member id.
		// Uses the coverage already loaded for the Bill To detection when it is
		// there, so opening the editor and exporting a claim agree on which policy
		// is the billable one.
		const coverages = this.coverages.length ? this.coverages : await loadPatientCoverages(this.apiService, this.patientId);
		const active = activeCoverage(coverages);
		if (active) {
			const payerName = active.payerName || undefined;
			out.insurance = {
				payerName,
				payerId: active.payerId || undefined,
				policyNumber: active.memberId || undefined,
				groupNumber: active.groupNumber || undefined,
			};
			// Resolve the ELECTRONIC payer id from the payer directory by name —
			// clearinghouses key NM1*PR on this id, and Coverage rarely carries it.
			if (payerName && !out.insurance.payerId) {
				const dir = listOf(await getJson(`/api/insurance-companies?page=0&size=50&search=${encodeURIComponent(payerName)}`));
				const match = dir.find(d => String(d.name ?? '').trim().toLowerCase() === payerName.trim().toLowerCase()) || dir[0];
				if (match?.payerId) { out.insurance.payerId = String(match.payerId); }
			}
		}

		// Rendering provider — name + NPI + taxonomy for the 2310B loop.
		if (this.renderingProvider) {
			const prj = await getJson(`/api/providers/${encodeURIComponent(this.renderingProvider)}`);
			if (prj) {
				const pr = (prj.data ?? prj) as Record<string, unknown>;
				const ident = (pr.identification as { firstName?: string; lastName?: string }) || {};
				out.renderingFirstName = ident.firstName || undefined;
				out.renderingLastName = ident.lastName || undefined;
				// The `npi` field occasionally holds non-NPI data in dev; only emit
				// a clean 10-digit NPI so we never ship a phone number as an NPI.
				const npiRaw = String((pr.npi as string) || '').replace(/[^0-9]/g, '');
				out.renderingNpi = npiRaw.length === 10 ? npiRaw : undefined;
				const prof = (pr.professionalDetails as { taxonomy?: string }) || {};
				out.renderingTaxonomy = prof.taxonomy || undefined;
			}
		}
		return out;
	}

	/**
	 * The practice / billing-provider record for the current org: legal name,
	 * NPI, tax id (EIN), address, phone, email. Sourced from /api/practices so
	 * the 837P billing loop carries real identifiers instead of "Practice"
	 * placeholders. The ciyex.billing.* settings still override these when set
	 * (e.g. a practice that bills under a different entity).
	 */
	private async _fetchPractice(): Promise<{
		name?: string; npi?: string; taxId?: string; phone?: string; email?: string;
		address1?: string; city?: string; state?: string; zip?: string;
	}> {
		try {
			const res = await this.apiService.fetch('/api/practices?page=0&size=1');
			if (!res.ok) { return {}; }
			const j = await res.json();
			const list = (j?.data?.content ?? j?.content ?? j?.data ?? []) as Record<string, unknown>[];
			const p = Array.isArray(list) ? list[0] : (j?.data ?? j) as Record<string, unknown>;
			if (!p) { return {}; }
			const addr = (p.address as { line1?: string; city?: string; state?: string; zip?: string }) || {};
			const npi = String((p.npi as string) || '').replace(/[^0-9]/g, '');
			return {
				name: (p.name as string) || undefined,
				npi: npi.length === 10 ? npi : undefined,
				taxId: (p.taxId as string) || undefined,
				phone: (p.phone as string) || undefined,
				email: (p.email as string) || undefined,
				address1: addr.line1 || undefined, city: addr.city || undefined,
				state: addr.state || undefined, zip: addr.zip || undefined,
			};
		} catch { return {}; }
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
