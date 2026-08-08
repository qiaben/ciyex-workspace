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
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';

interface ScannedDocument {
	id: number;
	fileName: string;
	originalFileName: string;
	fileSize: number;
	mimeType: string;
	fileUrl?: string;
	patientId?: number;
	patientName?: string;
	category: string;
	ocrText?: string;
	ocrStatus: string;
	ocrConfidence?: number;
	createdAt: string;
}

/** Document categories - mirrors ciyex-ehr-ui CATEGORY_LABELS. */
const CATEGORIES: [string, string][] = [
	['medical_record', 'Medical Record'],
	['lab_result', 'Lab Result'],
	['insurance_card', 'Insurance Card'],
	['referral', 'Referral'],
	['consent_form', 'Consent Form'],
	['prescription', 'Prescription'],
	['imaging', 'Imaging / Radiology'],
	['correspondence', 'Correspondence'],
	['legal', 'Legal Document'],
	['other', 'Other'],
];
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES);

/** OCR statuses - mirrors ciyex-ehr-ui OCR_STATUS_LABELS. */
const OCR_STATUSES: [string, string][] = [
	['pending', 'Pending'],
	['processing', 'Processing'],
	['completed', 'Completed'],
	['failed', 'Failed'],
	['not_applicable', 'N/A'],
];
const OCR_STATUS_LABELS: Record<string, string> = Object.fromEntries(OCR_STATUSES);
const OCR_STATUS_COLORS: Record<string, string> = {
	pending: '#9ca3af',
	processing: '#3b82f6',
	completed: '#22c55e',
	failed: '#ef4444',
	not_applicable: '#9ca3af',
};

const inputStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;box-sizing:border-box;';
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.tiff,.tif,.csv,.doc,.docx,.xls,.xlsx,text/csv,application/csv,application/vnd.ms-excel';

function formatFileSize(bytes: number): string {
	if (!bytes || isNaN(bytes)) { return '-'; }
	if (bytes < 1024) { return `${bytes} B`; }
	if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Document Scanning & OCR editor - upload, scan and extract text from documents.
 * Custom EditorPane that mirrors the ciyex-ehr-ui document-scanning page: a
 * drag-and-drop upload zone, category + patient selectors, a filterable results
 * table with OCR status, and an OCR-text viewer. Talks to the backend
 * DocumentScanningController at /api/document-scanning.
 */
export class DocScanningEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexDocScanning';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private tableContainer!: HTMLElement;

	private documents: ScannedDocument[] = [];
	private loading = true;
	private page = 0;
	private totalPages = 0;
	private totalElements = 0;
	private readonly pageSize = 20;

	private searchQuery = '';
	private categoryFilter = 'all';
	private ocrFilter = 'all';

	// Upload panel state
	private uploadCategory = 'medical_record';
	private selectedPatientId: number | null = null;
	private uploading = false;

	private _searchTimer: ReturnType<typeof setTimeout> | undefined;
	private _patientTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(DocScanningEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.doc-scanning-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1100px;margin:0 auto;padding:20px 24px;display:flex;flex-direction:column;height:100%;box-sizing:border-box;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._buildShell();
		await this._loadData();
	}

	/** Build the persistent chrome (header, upload zone, filters) once per input. */
	private _buildShell(): void {
		DOM.clearNode(this.contentEl);

		// Header
		const hdr = DOM.append(this.contentEl, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;flex:0 0 auto;';
		const chip = DOM.append(hdr, DOM.$('div'));
		chip.style.cssText = 'width:36px;height:36px;border-radius:8px;background:rgba(249,115,22,0.15);display:flex;align-items:center;justify-content:center;';
		const chipIcon = DOM.append(chip, DOM.$('span.codicon.codicon-symbol-file'));
		chipIcon.style.cssText = 'color:#f97316;font-size:18px;';
		const titleWrap = DOM.append(hdr, DOM.$('div'));
		const h = DOM.append(titleWrap, DOM.$('h2'));
		h.textContent = 'Document Scanning & OCR';
		h.style.cssText = 'font-size:18px;font-weight:600;margin:0;';
		const sub = DOM.append(titleWrap, DOM.$('div'));
		sub.textContent = 'Upload, scan, and extract text from documents';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';

		// Upload zone
		this._buildUploadZone();

		// Filters
		this._buildFilters();

		// Table container (re-rendered on data reload)
		this.tableContainer = DOM.append(this.contentEl, DOM.$('div'));
		this.tableContainer.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;';
	}

	private _buildUploadZone(): void {
		const zone = DOM.append(this.contentEl, DOM.$('div'));
		zone.style.cssText = 'flex:0 0 auto;border:2px dashed var(--vscode-input-border,#3c3c3c);border-radius:10px;padding:20px;text-align:center;margin-bottom:16px;transition:border-color .15s;';

		const fileInput = DOM.append(zone, DOM.$('input')) as HTMLInputElement;
		fileInput.type = 'file';
		fileInput.multiple = true;
		fileInput.accept = ACCEPT;
		fileInput.style.display = 'none';
		fileInput.addEventListener('change', () => { void this._handleUpload(fileInput.files); fileInput.value = ''; });

		const icon = DOM.append(zone, DOM.$('span.codicon.codicon-cloud-upload'));
		icon.style.cssText = 'font-size:26px;color:var(--vscode-descriptionForeground);display:block;margin-bottom:8px;';
		const title = DOM.append(zone, DOM.$('div'));
		title.textContent = 'Upload Documents';
		title.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px;';
		const hint = DOM.append(zone, DOM.$('div'));
		hint.textContent = 'PDF, PNG, JPG, TIFF, CSV, DOC, XLS - drag & drop or click to browse';
		hint.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:12px;';

		// Category + patient selectors
		const controls = DOM.append(zone, DOM.$('div'));
		controls.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;';

		const catSel = DOM.append(controls, DOM.$('select')) as HTMLSelectElement;
		catSel.style.cssText = inputStyle;
		for (const [val, label] of CATEGORIES) {
			const opt = DOM.append(catSel, DOM.$('option')) as HTMLOptionElement;
			opt.value = val; opt.textContent = label;
		}
		catSel.value = this.uploadCategory;
		catSel.addEventListener('change', () => { this.uploadCategory = catSel.value; });

		// Patient search
		const patWrap = DOM.append(controls, DOM.$('div'));
		patWrap.style.cssText = 'position:relative;';
		const patInput = DOM.append(patWrap, DOM.$('input')) as HTMLInputElement;
		patInput.type = 'text';
		patInput.placeholder = 'Select patient (required)...';
		patInput.style.cssText = inputStyle + 'width:220px;border-color:var(--vscode-inputValidation-errorBorder,#be1100);';
		const results = DOM.append(patWrap, DOM.$('div'));
		results.style.cssText = 'position:absolute;top:100%;left:0;margin-top:2px;width:240px;max-height:180px;overflow-y:auto;background:var(--vscode-dropdown-background,var(--vscode-input-background));border:1px solid var(--vscode-editorWidget-border);border-radius:4px;z-index:50;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.3);';

		patInput.addEventListener('input', () => {
			const q = patInput.value.trim();
			this.selectedPatientId = null;
			patInput.style.borderColor = 'var(--vscode-inputValidation-errorBorder,#be1100)';
			if (this._patientTimer) { clearTimeout(this._patientTimer); }
			if (q.length < 2) { results.style.display = 'none'; return; }
			this._patientTimer = setTimeout(() => { void this._searchPatients(q, results, patInput); }, 300);
		});
		patInput.addEventListener('blur', () => { setTimeout(() => { results.style.display = 'none'; }, 200); });

		const selectBtn = DOM.append(zone, DOM.$('button'));
		selectBtn.textContent = 'Select Files';
		selectBtn.style.cssText = 'padding:8px 18px;background:#0e639c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;';
		selectBtn.addEventListener('click', () => { if (!this.uploading) { fileInput.click(); } });

		// Drag & drop
		const setDragState = (active: boolean) => { zone.style.borderColor = active ? '#0e639c' : 'var(--vscode-input-border,#3c3c3c)'; };
		zone.addEventListener('dragover', e => { e.preventDefault(); setDragState(true); });
		zone.addEventListener('dragleave', () => setDragState(false));
		zone.addEventListener('drop', e => {
			e.preventDefault(); setDragState(false);
			if (e.dataTransfer?.files?.length) { void this._handleUpload(e.dataTransfer.files); }
		});

		this._uploadBtn = selectBtn as HTMLButtonElement;
	}

	private _uploadBtn?: HTMLButtonElement;

	private async _searchPatients(query: string, container: HTMLElement, input: HTMLInputElement): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(query)}&page=0&size=10`);
			if (!res.ok) { return; }
			const json = await res.json();
			const raw = json.data?.content || json.data || json.content || [];
			const list: { id: number; name: string }[] = (Array.isArray(raw) ? raw : []).map((p: Record<string, unknown>) => ({
				id: Number(p.id),
				name: String(p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || `Patient ${p.id}`),
			}));
			DOM.clearNode(container);
			if (list.length === 0) { container.style.display = 'none'; return; }
			for (const p of list) {
				const row = DOM.append(container, DOM.$('div'));
				row.textContent = p.name;
				row.style.cssText = 'padding:7px 10px;font-size:12px;cursor:pointer;color:var(--vscode-foreground);';
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
				row.addEventListener('mouseleave', () => { row.style.background = ''; });
				row.addEventListener('mousedown', () => {
					this.selectedPatientId = p.id;
					input.value = p.name;
					input.style.borderColor = 'var(--vscode-input-border,#3c3c3c)';
					container.style.display = 'none';
				});
			}
			container.style.display = 'block';
		} catch { /* ignore */ }
	}

	private async _handleUpload(files: FileList | null): Promise<void> {
		if (!files || files.length === 0) { return; }
		if (!this.selectedPatientId) {
			this.notificationService.error('Please select a patient before uploading documents.');
			return;
		}
		this.uploading = true;
		if (this._uploadBtn) { this._uploadBtn.textContent = 'Uploading...'; this._uploadBtn.disabled = true; }
		let success = 0;
		const token = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_token') : '') || '';
		const tenant = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') : '') || '';
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const formData = new FormData();
			// CSV files sometimes arrive without a usable MIME type; pin it so the server accepts them.
			if (file.name.toLowerCase().endsWith('.csv') && (!file.type || file.type === 'application/octet-stream')) {
				formData.append('file', new Blob([file], { type: 'text/csv' }), file.name);
			} else {
				formData.append('file', file);
			}
			formData.append('category', this.uploadCategory);
			formData.append('patientId', String(this.selectedPatientId));
			try {
				// Raw fetch: ICiyexApiService.fetch forces application/json which breaks multipart.
				const res = await fetch(`${this.apiService.apiUrl}/api/document-scanning/upload`, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${token}`,
						...(tenant ? { 'X-Tenant-Name': tenant } : {}),
					},
					body: formData,
				});
				if (res.ok) {
					success++;
				} else {
					const errText = await res.text().catch(() => '');
					this.notificationService.error(`Failed to upload "${file.name}": ${errText || `HTTP ${res.status}`}`);
				}
			} catch (e) {
				this.notificationService.error(`Failed to upload "${file.name}": ${e instanceof Error ? e.message : 'Network error'}`);
			}
		}
		this.uploading = false;
		if (this._uploadBtn) { this._uploadBtn.textContent = 'Select Files'; this._uploadBtn.disabled = false; }
		if (success > 0) {
			this.notificationService.info(success === 1 ? 'Upload complete' : `${success} documents uploaded`);
			this.page = 0;
			await this._loadData();
		}
	}

	private _buildFilters(): void {
		const bar = DOM.append(this.contentEl, DOM.$('div'));
		bar.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;flex:0 0 auto;flex-wrap:wrap;';

		const searchWrap = DOM.append(bar, DOM.$('div'));
		searchWrap.style.cssText = 'position:relative;flex:1;min-width:200px;max-width:360px;';
		const searchIcon = DOM.append(searchWrap, DOM.$('span.codicon.codicon-search'));
		searchIcon.style.cssText = 'position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--vscode-descriptionForeground);';
		const searchInput = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.placeholder = 'Search documents...';
		searchInput.value = this.searchQuery;
		searchInput.style.cssText = inputStyle + 'width:100%;padding-left:28px;';
		searchInput.addEventListener('input', () => {
			if (this._searchTimer) { clearTimeout(this._searchTimer); }
			this._searchTimer = setTimeout(() => {
				this.searchQuery = searchInput.value.trim();
				this.page = 0;
				void this._loadData();
			}, 350);
		});

		const catSel = DOM.append(bar, DOM.$('select')) as HTMLSelectElement;
		catSel.style.cssText = inputStyle;
		const allCat = DOM.append(catSel, DOM.$('option')) as HTMLOptionElement;
		allCat.value = 'all'; allCat.textContent = 'All Categories';
		for (const [val, label] of CATEGORIES) {
			const opt = DOM.append(catSel, DOM.$('option')) as HTMLOptionElement;
			opt.value = val; opt.textContent = label;
		}
		catSel.value = this.categoryFilter;
		catSel.addEventListener('change', () => { this.categoryFilter = catSel.value; this.page = 0; void this._loadData(); });

		const ocrSel = DOM.append(bar, DOM.$('select')) as HTMLSelectElement;
		ocrSel.style.cssText = inputStyle;
		const allOcr = DOM.append(ocrSel, DOM.$('option')) as HTMLOptionElement;
		allOcr.value = 'all'; allOcr.textContent = 'All OCR Status';
		for (const [val, label] of OCR_STATUSES) {
			const opt = DOM.append(ocrSel, DOM.$('option')) as HTMLOptionElement;
			opt.value = val; opt.textContent = label;
		}
		ocrSel.value = this.ocrFilter;
		ocrSel.addEventListener('change', () => { this.ocrFilter = ocrSel.value; this.page = 0; void this._loadData(); });
	}

	private async _loadData(): Promise<void> {
		this.loading = true;
		this._renderTable();
		try {
			let url = `/api/document-scanning?page=${this.page}&size=${this.pageSize}`;
			if (this.searchQuery) { url += `&q=${encodeURIComponent(this.searchQuery)}`; }
			if (this.categoryFilter !== 'all') { url += `&category=${this.categoryFilter}`; }
			if (this.ocrFilter !== 'all') { url += `&ocrStatus=${this.ocrFilter}`; }
			const res = await this.apiService.fetch(url);
			const json = await res.json();
			let content: ScannedDocument[] = [];
			let totalPages = 0;
			let totalElements = 0;
			if (res.ok && (json.success ?? true)) {
				const data = json.data ?? json;
				content = data.content || (Array.isArray(data) ? data : []);
				totalPages = data.totalPages || 1;
				totalElements = data.totalElements ?? content.length;
			}
			// `q` only text-matches the scan's own fileName/OCR text server-side —
			// it has no join against the Patients table, so typing a patient's
			// NAME returns zero rows even though the document is correctly
			// tagged with that patient's id (visible in the patient's own chart,
			// which matches by id, never by name). Cross-reference the typed
			// text against the patient directory and merge in any of that
			// patient's scans the name-only search missed.
			if (this.searchQuery) {
				const extra = await this._findDocumentsByPatientName(this.searchQuery);
				const seen = new Set(content.map(d => d.id));
				for (const d of extra) {
					if (!seen.has(d.id)) { content.push(d); seen.add(d.id); totalElements++; }
				}
				if (totalPages === 0 && content.length > 0) { totalPages = 1; }
			}
			this.documents = content;
			this.totalPages = totalPages;
			this.totalElements = totalElements;
			await this._resolvePatientNames();
		} catch {
			this.documents = [];
			this.totalPages = 0;
			this.totalElements = 0;
		}
		this.loading = false;
		this._renderTable();
	}

	/** Resolve `query` to matching patients by name, then fetch that patient's
	 *  scans directly by id — a fallback for the `q` search above, which never
	 *  matches on patient name. Mirrors the same id-based merge the patient
	 *  chart's Documents tab already relies on for this same store. */
	private async _findDocumentsByPatientName(query: string): Promise<ScannedDocument[]> {
		try {
			const pRes = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(query)}&page=0&size=10`);
			if (!pRes.ok) { return []; }
			const pJson = await pRes.json();
			const rawPatients = pJson.data?.content || pJson.data || pJson.content || [];
			const patientIds = new Set((Array.isArray(rawPatients) ? rawPatients : []).map((p: Record<string, unknown>) => Number(p.id)).filter(id => !isNaN(id)));
			if (patientIds.size === 0) { return []; }
			const dRes = await this.apiService.fetch('/api/document-scanning?page=0&size=200');
			if (!dRes.ok) { return []; }
			const dJson = await dRes.json();
			const data = dJson.data ?? dJson;
			const all: ScannedDocument[] = data.content || (Array.isArray(data) ? data : []);
			return all.filter(d => d.patientId && patientIds.has(d.patientId));
		} catch {
			return [];
		}
	}

	/** Fill in patient display names for rows that only carry a patientId. */
	private async _resolvePatientNames(): Promise<void> {
		const missing = this.documents.filter(d => d.patientId && !d.patientName);
		if (missing.length === 0) { return; }
		const ids = Array.from(new Set(missing.map(d => d.patientId)));
		const nameMap: Record<number, string> = {};
		await Promise.all(ids.map(async pid => {
			try {
				const r = await this.apiService.fetch(`/api/patients/${pid}`);
				if (r.ok) {
					const pj = await r.json();
					const p = pj.data || pj;
					nameMap[pid!] = p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || `Patient ${pid}`;
				}
			} catch { /* skip */ }
		}));
		for (const d of this.documents) {
			if (d.patientId && !d.patientName && nameMap[d.patientId]) { d.patientName = nameMap[d.patientId]; }
		}
	}

	private _renderTable(): void {
		if (!this.tableContainer) { return; }
		DOM.clearNode(this.tableContainer);

		if (this.loading) {
			const l = DOM.append(this.tableContainer, DOM.$('div'));
			l.textContent = 'Loading...';
			l.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground);font-size:13px;';
			return;
		}

		if (this.documents.length === 0) {
			const empty = DOM.append(this.tableContainer, DOM.$('div'));
			empty.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground);gap:6px;';
			const ic = DOM.append(empty, DOM.$('span.codicon.codicon-search'));
			ic.style.cssText = 'font-size:32px;opacity:0.5;';
			const t = DOM.append(empty, DOM.$('div'));
			t.textContent = 'No documents found';
			t.style.cssText = 'font-size:13px;font-weight:500;';
			const s = DOM.append(empty, DOM.$('div'));
			s.textContent = 'Upload documents to get started.';
			s.style.cssText = 'font-size:11px;';
			return;
		}

		const tbl = DOM.append(this.tableContainer, DOM.$('div'));
		tbl.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:auto;flex:1;min-height:0;';
		// Column template MUST stay in sync between the header row and every body
		// row so they line up. Each entry maps 1:1 to a rendered cell.
		const cols = '1.6fr 130px 1fr 110px 80px 140px 130px';

		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:9px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(0,122,204,0.05);text-transform:uppercase;position:sticky;top:0;`;
		// "OCR Status" is centred and "Actions" is right-aligned so their header
		// labels sit directly above the centred status badge / right-aligned
		// action buttons in the body — otherwise the left-aligned "Actions"
		// label floated far from its buttons and looked like an empty extra
		// (phantom "location") column.
		const headers: Array<{ label: string; align?: string }> = [
			{ label: 'Document' }, { label: 'Category' }, { label: 'Patient' },
			{ label: 'OCR Status', align: 'center' }, { label: 'Size' },
			{ label: 'Uploaded' }, { label: 'Actions', align: 'right' },
		];
		for (const h of headers) {
			const cell = DOM.append(hr, DOM.$('span'));
			cell.textContent = h.label;
			if (h.align) { cell.style.textAlign = h.align; }
		}

		for (const doc of this.documents) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });

			// Document name. The grey secondary "location"/mime line that used to
			// sit under the filename was removed per request — it read like a
			// stray file-location column.
			const nameCell = DOM.append(r, DOM.$('div'));
			nameCell.style.cssText = 'min-width:0;';
			const nm = DOM.append(nameCell, DOM.$('div'));
			nm.textContent = doc.originalFileName || doc.fileName;
			nm.style.cssText = 'font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

			DOM.append(r, DOM.$('span')).textContent = CATEGORY_LABELS[doc.category] || doc.category || '-';
			DOM.append(r, DOM.$('span')).textContent = doc.patientName || '-';

			// OCR status badge (centred to line up under the centred header)
			const statusCell = DOM.append(r, DOM.$('span'));
			statusCell.style.cssText = 'text-align:center;';
			const badge = DOM.append(statusCell, DOM.$('span'));
			const color = OCR_STATUS_COLORS[doc.ocrStatus] || '#9ca3af';
			badge.textContent = OCR_STATUS_LABELS[doc.ocrStatus] || doc.ocrStatus;
			badge.style.cssText = `display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;color:${color};background:${color}22;`;

			DOM.append(r, DOM.$('span')).textContent = formatFileSize(doc.fileSize);
			const dateCell = DOM.append(r, DOM.$('span'));
			try { dateCell.textContent = doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : '-'; } catch { dateCell.textContent = String(doc.createdAt || '-'); }

			// Actions
			const actions = DOM.append(r, DOM.$('div'));
			actions.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;';

			if (doc.ocrStatus === 'completed') {
				this._actionBtn(actions, 'codicon-eye', 'View OCR Text', () => this._showOcrText(doc));
			}
			// 'processing' is included deliberately: rows uploaded before extraction
			// ran server-side are stuck on that status with no way forward, and a
			// re-run is what unsticks them. 'not_applicable' is excluded — re-running
			// an image scan with no OCR engine would land on the same answer.
			if (doc.ocrStatus === 'failed' || doc.ocrStatus === 'pending' || doc.ocrStatus === 'processing') {
				this._actionBtn(actions, 'codicon-sync', 'Run OCR', () => { void this._reOcr(doc); });
			}
			this._actionBtn(actions, 'codicon-cloud-download', 'Download', () => { void this._download(doc); });
			this._actionBtn(actions, 'codicon-trash', 'Delete', () => { void this._delete(doc); });
		}

		// Pagination
		if (this.totalPages > 1) {
			const pg = DOM.append(this.tableContainer, DOM.$('div'));
			pg.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 4px 0;flex:0 0 auto;';
			const info = DOM.append(pg, DOM.$('span'));
			info.textContent = `Showing ${this.page * this.pageSize + 1}-${Math.min((this.page + 1) * this.pageSize, this.totalElements)} of ${this.totalElements}`;
			info.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
			const nav = DOM.append(pg, DOM.$('div'));
			nav.style.cssText = 'display:flex;align-items:center;gap:8px;';
			const prev = DOM.append(nav, DOM.$('button'));
			prev.textContent = 'Previous';
			prev.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
			(prev as HTMLButtonElement).disabled = this.page === 0;
			if (this.page === 0) { prev.style.opacity = '0.4'; prev.style.cursor = 'default'; }
			prev.addEventListener('click', () => { if (this.page > 0) { this.page--; void this._loadData(); } });
			const lbl = DOM.append(nav, DOM.$('span'));
			lbl.textContent = `Page ${this.page + 1} of ${this.totalPages}`;
			lbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
			const next = DOM.append(nav, DOM.$('button'));
			next.textContent = 'Next';
			next.style.cssText = 'padding:4px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
			(next as HTMLButtonElement).disabled = this.page >= this.totalPages - 1;
			if (this.page >= this.totalPages - 1) { next.style.opacity = '0.4'; next.style.cursor = 'default'; }
			next.addEventListener('click', () => { if (this.page < this.totalPages - 1) { this.page++; void this._loadData(); } });
		}
	}

	private _actionBtn(parent: HTMLElement, codicon: string, title: string, onClick: () => void): HTMLElement {
		const btn = DOM.append(parent, DOM.$(`button.codicon.${codicon}`));
		btn.title = title;
		btn.style.cssText = 'width:26px;height:26px;border:none;background:transparent;border-radius:4px;cursor:pointer;color:var(--vscode-descriptionForeground);display:flex;align-items:center;justify-content:center;font-size:14px;';
		btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.2))'; btn.style.color = 'var(--vscode-foreground)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = 'var(--vscode-descriptionForeground)'; });
		btn.addEventListener('click', onClick);
		return btn;
	}

	/** Run (or re-run) text extraction for a row. The endpoint now returns the
	 *  FINISHED record — extraction is synchronous server-side — so the row lands
	 *  on its terminal status (Completed / Failed / N/A) in one round trip. It
	 *  used to flip the row to "processing" optimistically and hope a worker
	 *  finished it; there was no worker, so every row parked on Processing and
	 *  the other four status filters matched nothing. */
	private async _reOcr(doc: ScannedDocument): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/document-scanning/${doc.id}/ocr`, { method: 'POST' });
			if (!res.ok) { this.notificationService.error('Failed to run OCR'); return; }
			const json = await res.json();
			const updated = (json?.data ?? json) as ScannedDocument | undefined;
			const status = updated?.ocrStatus;
			if (status) {
				this.documents = this.documents.map(d => d.id === doc.id ? { ...d, ...updated } : d);
				this._renderTable();
			}
			this.notificationService.info(
				status === 'completed' ? 'Text extracted from the document'
					: status === 'not_applicable' ? 'No text could be extracted — this file type needs an OCR engine'
						: status === 'failed' ? 'The document could not be read'
							: 'OCR processing started');
			void this._loadData();
		} catch {
			this.notificationService.error('Failed to run OCR');
		}
	}

	/**
	 * Download the original document file.
	 *
	 * The previous implementation did `mainWindow.open(doc.fileUrl, '_blank')`.
	 * The backend serves `fileUrl` as a *relative* path for local storage
	 * (`/api/files-proxy/by-key/download?key=...`). In the Electron renderer the
	 * page origin is `vscode-file://`, so that relative URL resolved against that
	 * origin and Windows tried to open a `vscode-file://` link ("Get an app to
	 * open this 'vscode-file' link"). Relative URLs also need the API host +
	 * Bearer/tenant headers, which `mainWindow.open` cannot supply.
	 *
	 * Fix: fetch the bytes ourselves and trigger a real blob download via a
	 * temporary anchor (the convention used by settingsHubEditor / systemEditors).
	 *  - relative `fileUrl` (starts with '/') -> go through the authenticated API
	 *    service, which prefixes the absolute API base and attaches the
	 *    Bearer + X-Tenant-Name headers.
	 *  - absolute http(s) `fileUrl` (e.g. an S3/Vaultik presigned URL) -> fetch
	 *    it directly; it is already self-authorizing.
	 */
	private async _download(doc: ScannedDocument): Promise<void> {
		const fileUrl = doc.fileUrl;
		if (!fileUrl) {
			this.notificationService.error('No file is available to download for this document.');
			return;
		}
		try {
			const res = /^https?:\/\//i.test(fileUrl)
				? await fetch(fileUrl)
				: await this.apiService.fetch(fileUrl);
			if (!res.ok) {
				this._notifyDownloadFailed(doc, await this._describeDownloadError(res));
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = mainWindow.document.createElement('a');
			a.href = url;
			a.download = doc.originalFileName || doc.fileName || `document-${doc.id}`;
			mainWindow.document.body.appendChild(a);
			a.click();
			setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
		} catch (err) {
			// Network/blob failures (offline, CORS, aborted) land here — surface the
			// underlying message when we have one so the error isn't opaque.
			this._notifyDownloadFailed(doc, err instanceof Error ? err.message : undefined);
		}
	}

	/**
	 * Derive a human-readable reason from a failed download response. The files
	 * proxy returns a JSON error body ({message|error|detail}) on failure, so we
	 * surface that (or a status-specific hint) instead of a bare "Failed to
	 * download" — most stage failures are the stored file no longer being present
	 * on the server, which the user needs to be told.
	 */
	private async _describeDownloadError(res: Response): Promise<string> {
		if (res.status === 404) { return 'The file was not found on the server — it may have been moved or deleted.'; }
		if (res.status === 401 || res.status === 403) { return 'You are not authorized to download this file.'; }
		try {
			if ((res.headers.get('content-type') || '').includes('application/json')) {
				const body = await res.json() as Record<string, unknown>;
				const msg = body?.['message'] ?? body?.['error'] ?? body?.['detail'];
				if (msg) { return String(msg); }
			}
		} catch { /* fall through to the generic status message */ }
		return `The server returned an error (HTTP ${res.status}). The file may no longer be available.`;
	}

	/**
	 * Show a clear download-failure notification with a Retry action, so the user
	 * can re-attempt in place (e.g. after a transient server error) without
	 * re-navigating to the document.
	 */
	private _notifyDownloadFailed(doc: ScannedDocument, detail?: string): void {
		const name = doc.originalFileName || doc.fileName || 'document';
		const reason = detail ? ` ${detail}` : ' The file may no longer be available on the server.';
		this.notificationService.notify({
			severity: Severity.Error,
			message: `Couldn't download "${name}".${reason}`,
			actions: {
				primary: [{
					id: 'ciyex.docScanning.retryDownload', label: 'Retry', tooltip: '', class: undefined, enabled: true,
					run: () => { void this._download(doc); },
				}],
			},
		});
	}

	private async _delete(doc: ScannedDocument): Promise<void> {
		const r = await this.dialogService.confirm({ message: `Delete "${doc.originalFileName || doc.fileName}"?`, type: 'warning', primaryButton: 'Delete' });
		if (!r.confirmed) { return; }
		try {
			const res = await this.apiService.fetch(`/api/document-scanning/${doc.id}`, { method: 'DELETE' });
			if (res.ok) {
				// Optimistic: drop the deleted row immediately, reconcile in background.
				this.documents = this.documents.filter(d => d.id !== doc.id);
				this.totalElements = Math.max(0, this.totalElements - 1);
				this._renderTable();
				this.notificationService.info('Document deleted');
				void this._loadData();
			} else {
				this.notificationService.error('Failed to delete');
			}
		} catch {
			this.notificationService.error('Failed to delete document');
		}
	}

	private _showOcrText(doc: ScannedDocument): void {
		const overlay = DOM.append(this.root, DOM.$('div'));
		overlay.style.cssText = 'position:absolute;inset:0;z-index:1000;';
		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';
		const panel = DOM.append(overlay, DOM.$('div'));
		panel.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:560px;max-width:90%;background:var(--vscode-editor-background);border-left:1px solid var(--vscode-editorWidget-border);box-shadow:-4px 0 16px rgba(0,0,0,0.3);display:flex;flex-direction:column;';

		const head = DOM.append(panel, DOM.$('div'));
		head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--vscode-editorWidget-border);flex:0 0 auto;';
		const titleWrap = DOM.append(head, DOM.$('div'));
		const ht = DOM.append(titleWrap, DOM.$('div'));
		ht.textContent = doc.originalFileName || doc.fileName;
		ht.style.cssText = 'font-size:14px;font-weight:600;';
		const hs = DOM.append(titleWrap, DOM.$('div'));
		hs.textContent = `${CATEGORY_LABELS[doc.category] || doc.category} - OCR Confidence: ${doc.ocrConfidence ? `${Math.round(doc.ocrConfidence * 100)}%` : 'N/A'}`;
		hs.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		const closeBtn = DOM.append(head, DOM.$('button.codicon.codicon-close'));
		closeBtn.style.cssText = 'width:28px;height:28px;border:none;background:transparent;cursor:pointer;color:var(--vscode-foreground);border-radius:4px;';

		const body = DOM.append(panel, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;padding:18px;';
		if (doc.ocrText) {
			const pre = DOM.append(body, DOM.$('pre'));
			pre.textContent = doc.ocrText;
			pre.style.cssText = 'white-space:pre-wrap;font-size:12px;line-height:1.5;font-family:var(--vscode-editor-font-family,monospace);margin:0;';
		} else {
			const none = DOM.append(body, DOM.$('div'));
			none.textContent = 'No OCR text available';
			none.style.cssText = 'text-align:center;color:var(--vscode-descriptionForeground);margin-top:40px;font-size:13px;';
		}

		const close = () => overlay.remove();
		backdrop.addEventListener('click', close);
		closeBtn.addEventListener('click', close);
	}

	override clearInput(): void {
		if (this._searchTimer) { clearTimeout(this._searchTimer); }
		if (this._patientTimer) { clearTimeout(this._patientTimer); }
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
