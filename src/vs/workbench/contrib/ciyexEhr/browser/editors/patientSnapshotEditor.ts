/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { PatientSnapshotEditorInput, PatientChartEditorInput, EncounterFormEditorInput } from './ciyexEditorInput.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { IEditorService, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';

interface QuickAction {
	icon: string;
	title: string;
	onClick: () => void;
}

export class PatientSnapshotEditor extends EditorPane {

	static readonly ID = 'workbench.editor.ciyexPatientSnapshot';

	private root!: HTMLElement;
	private _currentPatientId = '';
	private _currentPatientName = '';
	private readonly _pageState = new Map<string, number>();
	private static readonly PAGE_SIZE = 5;

	constructor(
		group: import('../../../../services/editor/common/editorGroupsService.js').IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(PatientSnapshotEditor.ID, group, telemetryService, themeService, storageService);
	}

	private _openChartAt(tab: string): void {
		if (!this._currentPatientId) { return; }
		this.editorService.openEditor(new PatientChartEditorInput(this._currentPatientId, this._currentPatientName, tab, /*focused*/ true), {}, SIDE_GROUP);
	}

	private _paginate<T>(key: string, items: T[]): { page: T[]; pageIdx: number; pageCount: number; total: number } {
		const total = items.length;
		const pageCount = Math.max(1, Math.ceil(total / PatientSnapshotEditor.PAGE_SIZE));
		const pageIdx = Math.min(this._pageState.get(key) ?? 0, pageCount - 1);
		const start = pageIdx * PatientSnapshotEditor.PAGE_SIZE;
		return { page: items.slice(start, start + PatientSnapshotEditor.PAGE_SIZE), pageIdx, pageCount, total };
	}

	private _renderPagerFooter(parent: HTMLElement, key: string, pageIdx: number, pageCount: number, total: number): void {
		if (pageCount <= 1) { return; }
		const bar = DOM.append(parent, DOM.$('div'));
		bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;margin-top:6px;border-top:1px solid var(--vscode-editorWidget-border);font-size:11px;color:var(--vscode-descriptionForeground);';

		const info = DOM.append(bar, DOM.$('span'));
		const from = pageIdx * PatientSnapshotEditor.PAGE_SIZE + 1;
		const to = Math.min(from + PatientSnapshotEditor.PAGE_SIZE - 1, total);
		// allow-any-unicode-next-line
		info.textContent = `${from}–${to} of ${total}`;

		const btns = DOM.append(bar, DOM.$('div'));
		btns.style.cssText = 'display:flex;gap:4px;align-items:center;';

		const mkBtn = (label: string, disabled: boolean, onClick: () => void): void => {
			const b = DOM.append(btns, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			b.disabled = disabled;
			b.style.cssText = `min-width:24px;height:22px;padding:0 6px;font-size:11px;border-radius:4px;border:1px solid var(--vscode-editorWidget-border);background:${disabled ? 'transparent' : 'var(--vscode-button-secondaryBackground)'};color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? '0.4' : '1'};`;
			b.addEventListener('click', (e) => { e.stopPropagation(); if (!disabled) { onClick(); } });
		};
		// allow-any-unicode-next-line
		mkBtn('‹', pageIdx <= 0, () => { this._pageState.set(key, pageIdx - 1); this._rerender(); });
		const pageLbl = DOM.append(btns, DOM.$('span'));
		pageLbl.textContent = `${pageIdx + 1} / ${pageCount}`;
		pageLbl.style.cssText = 'padding:0 6px;font-weight:600;color:var(--vscode-foreground);';
		// allow-any-unicode-next-line
		mkBtn('›', pageIdx >= pageCount - 1, () => { this._pageState.set(key, pageIdx + 1); this._rerender(); });
	}

	private _lastRenderArgs: { patientId: string; patientName: string; appointmentId?: string } | null = null;
	private _rerender(): void {
		if (!this._lastRenderArgs) { return; }
		const { patientId, patientName, appointmentId } = this._lastRenderArgs;
		void this._loadAndRender(patientId, patientName, appointmentId);
	}

	private _openNewEncounter(): void {
		if (!this._currentPatientId) { return; }
		this.editorService.openEditor(new EncounterFormEditorInput(this._currentPatientId, 'new', this._currentPatientName, 'New Encounter'), {}, SIDE_GROUP);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-snapshot.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,"Segoe UI",sans-serif);font-size:13px;';
	}

	override async setInput(input: PatientSnapshotEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) { return; }
		if (this._currentPatientId !== input.patientId) {
			this._pageState.clear();
		}
		this._currentPatientId = input.patientId;
		this._currentPatientName = input.patientName;
		DOM.clearNode(this.root);
		this._renderSkeleton(input.patientName);
		await this._loadAndRender(input.patientId, input.patientName, input.appointmentId);
	}

	private _renderSkeleton(name: string): void {
		const hdr = DOM.append(this.root, DOM.$('.snap-header'));
		hdr.style.cssText = 'padding:18px 24px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;gap:14px;';
		const av = DOM.append(hdr, DOM.$('div'));
		av.style.cssText = 'width:48px;height:48px;border-radius:50%;background:var(--vscode-button-background,#0e639c);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;flex-shrink:0;';
		av.textContent = (name || '?').charAt(0).toUpperCase();
		const info = DOM.append(hdr, DOM.$('div'));
		info.style.cssText = 'flex:1;min-width:0;';
		const nameEl = DOM.append(info, DOM.$('div'));
		nameEl.textContent = name || 'Loading…';
		nameEl.style.cssText = 'font-size:20px;font-weight:700;color:var(--vscode-editor-foreground);';
		const sub = DOM.append(info, DOM.$('div'));
		sub.textContent = 'Loading patient data…';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:3px;';
	}

	private async _loadAndRender(patientId: string, patientName: string, appointmentId?: string): Promise<void> {
		this._lastRenderArgs = { patientId, patientName, appointmentId };
		const [patient, conditions, medications, vitals, encounters, labs, payments, statements, coverage, appointment] = await Promise.allSettled([
			this._fetch(`/api/patients/${patientId}`),
			this._fetch(`/api/medical-problems/${patientId}`),
			this._fetch(`/api/fhir-resource/medications/patient/${patientId}?page=0&size=50`),
			this._fetch(`/api/fhir-resource/vitals/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/encounters/patient/${patientId}?page=0&size=50`),
			this._fetch(`/api/fhir-resource/labs/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/payments/patient/${patientId}?page=0&size=20`),
			this._fetch(`/api/fhir-resource/statements/patient/${patientId}?page=0&size=1`),
			this._fetch(`/api/fhir-resource/insurance-coverage/patient/${patientId}?page=0&size=1`),
			appointmentId ? this._fetch(`/api/appointments/${appointmentId}`) : Promise.resolve(null),
		]);

		if (this._currentPatientId !== patientId) { return; }

		const p = patient.status === 'fulfilled' ? patient.value : null;
		const conds = this._list(conditions);
		const meds = this._list(medications);
		const vit = this._list(vitals);
		const encs = this._list(encounters);
		const labList = this._list(labs);
		const payList = this._list(payments);
		const stmtList = this._list(statements);
		const cov = this._list(coverage);
		const apt = appointment.status === 'fulfilled' ? appointment.value : null;

		DOM.clearNode(this.root);
		this._renderHeader(p, patientName, apt, cov);
		this._renderGrid(p, conds, meds, vit, encs, labList, payList, stmtList);
	}

	private _renderHeader(p: Record<string, unknown> | null, fallbackName: string, apt: Record<string, unknown> | null, cov: Record<string, unknown>[]): void {
		const name = (p?.name || p?.fullName || p?.displayName || `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || fallbackName) as string;
		const dob = p?.dateOfBirth || p?.birthDate || p?.dob || '';
		const mrn = p?.mrn || p?.medicalRecordNumber || p?.id || '';
		const gender = p?.gender || p?.sex || '';
		let age = '';
		if (dob) {
			try {
				const y = new Date().getFullYear() - new Date(String(dob)).getFullYear();
				age = `${y} yrs`;
			} catch { /* */ }
		}
		const allergies = (p?.allergies as string[] | undefined) || [];
		const insurance = (cov[0] as Record<string, unknown> | undefined);
		const insName = insurance?.payorName || insurance?.name || insurance?.coverageName || '';

		const hdr = DOM.append(this.root, DOM.$('.snap-header'));
		hdr.style.cssText = 'padding:18px 24px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;background:var(--vscode-editor-background);';

		const av = DOM.append(hdr, DOM.$('div'));
		av.style.cssText = 'width:52px;height:52px;border-radius:50%;background:var(--vscode-button-background,#0e639c);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;margin-top:2px;';
		av.textContent = name.charAt(0).toUpperCase();

		const info = DOM.append(hdr, DOM.$('div'));
		info.style.cssText = 'flex:1;min-width:200px;';

		const nameRow = DOM.append(info, DOM.$('div'));
		nameRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
		const nameEl = DOM.append(nameRow, DOM.$('span'));
		nameEl.textContent = name;
		nameEl.style.cssText = 'font-size:22px;font-weight:700;color:var(--vscode-editor-foreground);';

		const metaRow = DOM.append(info, DOM.$('div'));
		metaRow.style.cssText = 'display:flex;gap:12px;margin-top:4px;flex-wrap:wrap;font-size:12px;color:var(--vscode-descriptionForeground);';
		const meta: string[] = [];
		if (dob) { meta.push(`DOB ${new Date(String(dob)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`); }
		if (age) { meta.push(age); }
		if (gender) { meta.push(String(gender).charAt(0).toUpperCase() + String(gender).slice(1)); }
		if (mrn) { meta.push(`MRN ${mrn}`); }
		// allow-any-unicode-next-line
		if (insName) { meta.push(`🏥 ${insName}`); }
		for (const m of meta) {
			const sp = DOM.append(metaRow, DOM.$('span'));
			sp.textContent = m;
		}

		if (allergies.length > 0) {
			const allergyRow = DOM.append(info, DOM.$('div'));
			allergyRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;';
			for (const a of allergies) {
				const badge = DOM.append(allergyRow, DOM.$('span'));
				badge.textContent = `⚠ ${a}`;
				badge.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:10px;background:#ef444420;color:#ef4444;font-weight:600;';
			}
		}

		this._renderHeaderActions(hdr);

		if (apt) {
			const aptBlock = DOM.append(hdr, DOM.$('div'));
			aptBlock.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.08));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:10px 14px;min-width:200px;font-size:12px;';
			const aptTitle = DOM.append(aptBlock, DOM.$('div'));
			aptTitle.textContent = 'TODAY\'S APPOINTMENT';
			aptTitle.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--vscode-descriptionForeground);margin-bottom:6px;';
			const rows: Array<[string, string]> = [];
			const startRaw = (apt.start || apt.startTime || '') as string;
			if (startRaw) {
				try {
					const d = new Date(startRaw);
					rows.push(['Time', d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })]);
				} catch { /* */ }
			}
			const type = apt.visitType || apt.appointmentType || apt.type || '';
			if (type && typeof type === 'string') { rows.push(['Type', type]); }
			const prov = apt.providerName || apt.practitionerName || '';
			if (prov) { rows.push(['Provider', String(prov)]); }
			const room = apt.room || '';
			if (room) { rows.push(['Room', String(room)]); }
			for (const [lbl, val] of rows) {
				const r = DOM.append(aptBlock, DOM.$('div'));
				r.style.cssText = 'display:flex;gap:6px;margin-top:3px;';
				const l = DOM.append(r, DOM.$('span'));
				l.textContent = lbl;
				l.style.cssText = 'color:var(--vscode-descriptionForeground);flex-shrink:0;width:54px;';
				const v = DOM.append(r, DOM.$('span'));
				v.textContent = val;
				v.style.cssText = 'font-weight:500;color:var(--vscode-editor-foreground);';
			}
		}
	}

	private _renderHeaderActions(hdr: HTMLElement): void {
		const actions = DOM.append(hdr, DOM.$('.snap-header-actions'));
		actions.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0;';

		const primary: QuickAction[] = [
			{ icon: 'add', title: 'New Encounter', onClick: () => this._openNewEncounter() },
			{ icon: 'person', title: 'Edit Demographics', onClick: () => this._openChartAt('demographics') },
			{ icon: 'credit-card', title: 'Add Payment / Statement', onClick: () => this._openChartAt('payment') },
			{ icon: 'file-text', title: 'Billing & Claims', onClick: () => this._openChartAt('billing') },
		];
		for (const a of primary) {
			this._renderIconBtn(actions, a);
		}

		const overflowItems: QuickAction[] = [
			{ icon: 'pulse', title: 'Record Vitals', onClick: () => this._openChartAt('vitals') },
			{ icon: 'warning', title: 'Add Problem', onClick: () => this._openChartAt('problems') },
			{ icon: 'symbol-method', title: 'Add Medication', onClick: () => this._openChartAt('medications') },
			{ icon: 'shield', title: 'Add Insurance Coverage', onClick: () => this._openChartAt('insurance') },
			{ icon: 'beaker', title: 'Order Lab', onClick: () => this._openChartAt('labs') },
			{ icon: 'note', title: 'Add Visit Note', onClick: () => this._openChartAt('visit-notes') },
			{ icon: 'file-symlink-file', title: 'Add Statement', onClick: () => this._openChartAt('statements') },
			{ icon: 'file-binary', title: 'Submit Claim', onClick: () => this._openChartAt('claims') },
		];
		this._renderOverflowBtn(actions, overflowItems);
	}

	private _renderIconBtn(parent: HTMLElement, a: QuickAction): HTMLButtonElement {
		const b = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		b.title = a.title;
		b.setAttribute('aria-label', a.title);
		b.style.cssText = 'width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;cursor:pointer;color:var(--vscode-foreground);transition:background 0.15s;';
		const ico = DOM.append(b, DOM.$('span.codicon.codicon-' + a.icon));
		(ico as HTMLElement).style.cssText = 'font-size:20px;';
		b.addEventListener('mouseenter', () => { b.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.22))'; });
		b.addEventListener('mouseleave', () => { b.style.background = 'var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.08))'; });
		b.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
		return b;
	}

	private _renderOverflowBtn(parent: HTMLElement, items: QuickAction[]): void {
		const wrap = DOM.append(parent, DOM.$('div'));
		wrap.style.cssText = 'position:relative;';
		const trigger = this._renderIconBtn(wrap, {
			icon: 'ellipsis',
			title: 'More actions',
			onClick: () => { /* toggle below */ },
		});

		const menu = DOM.append(wrap, DOM.$('div'));
		menu.style.cssText = 'position:absolute;top:44px;right:0;min-width:220px;background:var(--vscode-menu-background,var(--vscode-editor-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));border:1px solid var(--vscode-menu-border,var(--vscode-editorWidget-border));border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.28);padding:4px;z-index:1000;display:none;';

		const closeMenu = (): void => { menu.style.display = 'none'; };
		const docClick = (e: Event): void => {
			if (!wrap.contains(e.target as Node)) { closeMenu(); }
		};
		trigger.addEventListener('click', (e) => {
			e.stopPropagation();
			const open = menu.style.display === 'block';
			if (open) {
				closeMenu();
				DOM.getActiveWindow().document.removeEventListener('click', docClick);
			} else {
				menu.style.display = 'block';
				DOM.getActiveWindow().document.addEventListener('click', docClick);
			}
		});

		for (const item of items) {
			const row = DOM.append(menu, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:13px;color:var(--vscode-menu-foreground,var(--vscode-foreground));';
			const ico = DOM.append(row, DOM.$('span.codicon.codicon-' + item.icon));
			(ico as HTMLElement).style.cssText = 'font-size:14px;color:var(--vscode-descriptionForeground);';
			const lbl = DOM.append(row, DOM.$('span'));
			lbl.textContent = item.title;
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				closeMenu();
				DOM.getActiveWindow().document.removeEventListener('click', docClick);
				item.onClick();
			});
		}
	}

	private _renderGrid(
		_p: Record<string, unknown> | null,
		conds: Record<string, unknown>[],
		meds: Record<string, unknown>[],
		vit: Record<string, unknown>[],
		encs: Record<string, unknown>[],
		labs: Record<string, unknown>[],
		payments: Record<string, unknown>[],
		statements: Record<string, unknown>[],
	): void {
		const grid = DOM.append(this.root, DOM.$('.snap-grid'));
		grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:18px 24px;';

		const activeProblems = conds.filter(c => {
			const s = String(c.status || c.clinicalStatus || '').toLowerCase();
			return !s || s === 'active';
		});
		this._renderCard(grid, 'problems', 'stethoscope', 'Active Problems', activeProblems, (c) => {
			const name = c.conditionName || c.condition || c.name || c.display || (c.code as Record<string, unknown>)?.text || '—';
			const onset = c.onsetDate || c.onsetDateTime || c.recordedDate || '';
			const yr = onset ? new Date(String(onset)).getFullYear() : '';
			return { primary: String(name), secondary: yr ? String(yr) : '', badge: { text: 'Active', color: '#22c55e' } };
		}, () => this._openChartAt('problems'));

		this._renderCard(grid, 'medications', 'symbol-method', 'Medications', meds, (m) => {
			const name = m.medicationName || m.name || '—';
			const dose = m.dosage || '';
			const freq = m.frequency || '';
			return { primary: String(name), secondary: [dose, freq].filter(Boolean).join(' · ') };
		}, () => this._openChartAt('medications'));

		this._renderVitalsCard(grid, vit);
		this._renderPaymentsCard(grid, payments, statements);

		// Bottom row: All Visits (3 cols) + All Labs (1 col)
		const visitCard = this._renderWideCard(grid, 'history', 'Visit History', 3, encs.length, () => this._openNewEncounter());
		this._renderEncounterRows(visitCard, encs);

		const labCard = this._renderWideCard(grid, 'beaker', 'Lab Results', 1, labs.length, () => this._openChartAt('labs'));
		this._renderLabRows(labCard, labs);
	}

	private _renderCard(
		parent: HTMLElement,
		pageKey: string,
		icon: string,
		title: string,
		items: Record<string, unknown>[],
		row: (item: Record<string, unknown>) => { primary: string; secondary: string; badge?: { text: string; color: string } },
		onAdd?: () => void,
	): HTMLElement {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;display:flex;flex-direction:column;min-height:140px;';

		this._cardHeader(card, icon, title, items.length, onAdd);

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:260px;';

		if (items.length === 0) {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = 'None recorded';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return card;
		}

		const { page, pageIdx, pageCount, total } = this._paginate(pageKey, items);
		for (const item of page) {
			const r = row(item);
			const rowEl = DOM.append(body, DOM.$('div'));
			rowEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const textCol = DOM.append(rowEl, DOM.$('div'));
			textCol.style.cssText = 'flex:1;min-width:0;';
			const pri = DOM.append(textCol, DOM.$('div'));
			pri.textContent = r.primary;
			pri.style.cssText = 'font-size:12px;font-weight:500;color:var(--vscode-editor-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
			if (r.secondary) {
				const sec = DOM.append(textCol, DOM.$('div'));
				sec.textContent = r.secondary;
				sec.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px;';
			}
			if (r.badge) {
				const b = DOM.append(rowEl, DOM.$('span'));
				b.textContent = r.badge.text;
				b.style.cssText = `font-size:9px;padding:2px 6px;border-radius:8px;background:${r.badge.color}20;color:${r.badge.color};font-weight:700;white-space:nowrap;flex-shrink:0;`;
			}
		}
		this._renderPagerFooter(card, pageKey, pageIdx, pageCount, total);
		return card;
	}

	private _renderVitalsCard(parent: HTMLElement, vit: Record<string, unknown>[]): void {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;min-height:140px;display:flex;flex-direction:column;';
		this._cardHeader(card, 'pulse', 'Latest Vitals', vit.length, () => this._openChartAt('vitals'));

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:260px;';

		const latest = vit[0] as Record<string, unknown> | undefined;
		if (!latest) {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = 'No vitals recorded';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}

		const bpVal = (latest.bpSystolic && latest.bpDiastolic) ? `${latest.bpSystolic}/${latest.bpDiastolic}` : '';
		const vitalRows: Array<[string, unknown, string?]> = [
			['BP', bpVal, 'mmHg'],
			['Weight', latest.weightKg, 'kg'],
			['Height', latest.heightCm, 'cm'],
			// allow-any-unicode-next-line
			['BMI', latest.bmi, 'kg/m²'],
			['O2 Sat', latest.oxygenSaturation, '%'],
			// allow-any-unicode-next-line
			['Temp', latest.temperatureC, '°C'],
			['Pulse', latest.pulse, '/min'],
			['Resp', latest.respiration, '/min'],
		];

		const grid2 = DOM.append(body, DOM.$('div'));
		grid2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin-top:4px;';
		for (const [lbl, val, unit] of vitalRows) {
			if (!val) { continue; }
			const cell = DOM.append(grid2, DOM.$('div'));
			cell.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const l = DOM.append(cell, DOM.$('div'));
			l.textContent = lbl;
			l.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;';
			const v = DOM.append(cell, DOM.$('div'));
			v.textContent = `${val}${unit ? ' ' + unit : ''}`;
			v.style.cssText = 'font-size:13px;font-weight:700;color:var(--vscode-editor-foreground);';
		}

		// History: remaining vitals readings (paginated)
		const history = vit.slice(1);
		if (history.length > 0) {
			const histLabel = DOM.append(body, DOM.$('div'));
			histLabel.textContent = 'VITALS HISTORY';
			histLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-top:10px;margin-bottom:4px;';
			const { page, pageIdx, pageCount, total } = this._paginate('vitals-history', history);
			for (const v of page) {
				const dateRaw = v.recordedAt || v.effectiveDateTime || v.recordedDate || v.dateRecorded || v.date || '';
				const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
				const bp = (v.bpSystolic && v.bpDiastolic) ? `${v.bpSystolic}/${v.bpDiastolic}` : '';
				const wt = v.weightKg || '';
				const summary = [bp ? `BP ${bp}` : '', wt ? `Wt ${wt} kg` : ''].filter(Boolean).join(' · ') || '—';
				const row = DOM.append(body, DOM.$('div'));
				row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:11px;';
				const dateEl = DOM.append(row, DOM.$('span'));
				dateEl.textContent = dateStr;
				dateEl.style.cssText = 'color:var(--vscode-descriptionForeground);';
				const summaryEl = DOM.append(row, DOM.$('span'));
				summaryEl.textContent = summary;
				summaryEl.style.cssText = 'color:var(--vscode-editor-foreground);font-weight:500;';
			}
			this._renderPagerFooter(card, 'vitals-history', pageIdx, pageCount, total);
		}
	}

	private _renderPaymentsCard(parent: HTMLElement, payments: Record<string, unknown>[], statements: Record<string, unknown>[]): void {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = 'background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;min-height:140px;display:flex;flex-direction:column;';
		this._cardHeader(card, 'credit-card', 'Financials', payments.length, () => this._openChartAt('payment'));

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'flex:1;overflow-y:auto;max-height:260px;';

		// Outstanding balance from the latest statement
		const stmt = statements[0] as Record<string, unknown> | undefined;
		const balance = stmt?.balance ?? stmt?.['totalNet.value'] ?? '—';
		const balNum = parseFloat(String(balance));

		const balRow = DOM.append(body, DOM.$('div'));
		balRow.style.cssText = 'margin-top:4px;margin-bottom:8px;';
		const balLabel = DOM.append(balRow, DOM.$('div'));
		balLabel.textContent = 'OUTSTANDING BALANCE';
		balLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);';
		const balVal = DOM.append(balRow, DOM.$('div'));
		balVal.textContent = isNaN(balNum) ? '—' : `$${balNum.toFixed(2)}`;
		balVal.style.cssText = `font-size:22px;font-weight:800;color:${!isNaN(balNum) && balNum > 0 ? '#ef4444' : '#22c55e'};margin-top:2px;`;

		if (payments.length > 0) {
			const histLabel = DOM.append(body, DOM.$('div'));
			histLabel.textContent = 'PAYMENT HISTORY';
			histLabel.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--vscode-descriptionForeground);margin-top:6px;margin-bottom:4px;border-top:1px solid var(--vscode-editorWidget-border);padding-top:8px;';
			const { page, pageIdx, pageCount, total } = this._paginate('payments', payments);
			for (const pay of page) {
				const dateRaw = (pay.paymentDate || pay.date || pay.transactionDate || pay.created || '') as string;
				const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
				const amt = pay.amount || pay.totalAmount || '';
				const method = pay.paymentType || pay.paymentMethod || pay.method || '';
				const r = DOM.append(body, DOM.$('div'));
				r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
				const left = DOM.append(r, DOM.$('div'));
				const dateEl = DOM.append(left, DOM.$('div'));
				dateEl.textContent = dateStr;
				dateEl.style.cssText = 'font-size:12px;color:var(--vscode-editor-foreground);font-weight:500;';
				if (method) {
					const methEl = DOM.append(left, DOM.$('div'));
					methEl.textContent = String(method);
					methEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px;';
				}
				if (amt) {
					const amtEl = DOM.append(r, DOM.$('span'));
					const amtNum = parseFloat(String(amt));
					amtEl.textContent = isNaN(amtNum) ? String(amt) : `$${amtNum.toFixed(2)}`;
					amtEl.style.cssText = 'font-size:13px;font-weight:700;color:#22c55e;';
				}
			}
			this._renderPagerFooter(card, 'payments', pageIdx, pageCount, total);
		} else {
			const empty = DOM.append(body, DOM.$('div'));
			empty.textContent = 'No payment history';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
		}
	}

	private _renderWideCard(parent: HTMLElement, icon: string, title: string, cols: number, count: number, onAdd?: () => void): HTMLElement {
		const card = DOM.append(parent, DOM.$('.snap-card'));
		card.style.cssText = `background:var(--vscode-editorWidget-background,rgba(128,128,128,0.05));border:1px solid var(--vscode-editorWidget-border);border-radius:10px;padding:14px;grid-column:span ${cols};`;
		this._cardHeader(card, icon, title, count, onAdd);
		return card;
	}

	private _renderEncounterRows(card: HTMLElement, encs: Record<string, unknown>[]): void {
		if (encs.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No encounters found';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		table.style.cssText = 'display:grid;grid-template-columns:120px 1fr 140px 80px 80px;gap:0;';
		for (const lbl of ['Date', 'Type / Provider', 'Location', 'Status', 'Notes']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		const { page, pageIdx, pageCount, total } = this._paginate('encounters', encs);
		for (const enc of page) {
			const dateRaw = enc.encounterDate || enc.startDate || enc.start || enc.date || enc.periodStart || enc.createdAt || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const type = enc.visitCategory || enc.encounterType || enc.type || enc.serviceType || enc.class || '—';
			const prov = enc.encounterProvider || enc.providerDisplay || enc.providerName || enc.practitionerName || '';
			const loc = enc.locationName || enc.location || enc.facility || '—';
			const status = enc.status || 'Unknown';
			const notes = enc.notes || enc.chiefComplaint || enc.reason || '';
			const statusLower = String(status).toLowerCase();
			const sColor = statusLower.includes('finish') || statusLower.includes('complet') ? '#22c55e' : statusLower.includes('cancel') ? '#ef4444' : '#3b9edd';
			const rowCells: Array<{ txt: string; isStatus?: boolean; isNotes?: boolean }> = [
				{ txt: dateStr },
				{ txt: prov ? `${type} · ${prov}` : String(type) },
				{ txt: String(loc) },
				{ txt: String(status), isStatus: true },
				{ txt: String(notes).slice(0, 40) || '—', isNotes: true },
			];
			for (const { txt, isStatus, isNotes } of rowCells) {
				const cell = DOM.append(table, DOM.$('div'));
				cell.style.cssText = `padding:6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;${isNotes ? '' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}padding-right:8px;`;
				if (isStatus) {
					const b = DOM.append(cell, DOM.$('span'));
					b.textContent = txt;
					b.style.cssText = `font-size:10px;padding:2px 6px;border-radius:8px;background:${sColor}20;color:${sColor};font-weight:700;`;
				} else {
					cell.textContent = txt;
					if (isNotes) { cell.style.color = 'var(--vscode-descriptionForeground)'; cell.style.fontSize = '11px'; }
				}
			}
		}
		this._renderPagerFooter(card, 'encounters', pageIdx, pageCount, total);
	}

	private _renderLabRows(card: HTMLElement, labs: Record<string, unknown>[]): void {
		if (labs.length === 0) {
			const empty = DOM.append(card, DOM.$('div'));
			empty.textContent = 'No lab results found';
			empty.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);padding:8px 0;';
			return;
		}
		const wrap = DOM.append(card, DOM.$('div'));
		wrap.style.cssText = 'overflow-y:auto;max-height:320px;margin-top:4px;';
		const table = DOM.append(wrap, DOM.$('div'));
		table.style.cssText = 'display:grid;grid-template-columns:1fr 100px 80px 50px;gap:0;';
		for (const lbl of ['Test', 'Date', 'Value', 'Flag']) {
			const h = DOM.append(table, DOM.$('div'));
			h.textContent = lbl;
			h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding:4px 0 6px;border-bottom:2px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));';
		}
		const { page, pageIdx, pageCount, total } = this._paginate('labs', labs);
		for (const lab of page) {
			const name = lab.testName || lab.display || lab.name || (lab.code as Record<string, unknown>)?.text || '—';
			const dateRaw = lab.resultDate || lab.collectionDate || lab.date || '';
			const dateStr = dateRaw ? new Date(String(dateRaw)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
			const resultVal = lab.result || lab.value || '—';
			const units = lab.units || '';
			const val = units ? `${resultVal} ${units}` : String(resultVal);
			const labStatus = String(lab.status || '').toLowerCase();
			const isAbnormal = labStatus && !['final', 'ordered', ''].includes(labStatus);
			const cells: Array<{ txt: string; isFlag?: boolean }> = [
				{ txt: String(name) },
				{ txt: dateStr },
				{ txt: val },
				{ txt: isAbnormal ? labStatus.toUpperCase() : '', isFlag: true },
			];
			for (const { txt, isFlag } of cells) {
				const cell = DOM.append(table, DOM.$('div'));
				cell.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:6px;';
				if (isFlag && isAbnormal) {
					const b = DOM.append(cell, DOM.$('span'));
					b.textContent = txt;
					b.style.cssText = 'font-size:9px;padding:2px 5px;border-radius:6px;background:#ef444420;color:#ef4444;font-weight:700;';
				} else {
					cell.textContent = txt;
				}
			}
		}
		this._renderPagerFooter(card, 'labs', pageIdx, pageCount, total);
	}

	private _cardHeader(card: HTMLElement, icon: string, title: string, count: number, onAdd?: () => void): void {
		const hdr = DOM.append(card, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';
		const ico = DOM.append(hdr, DOM.$('span.codicon.codicon-' + icon));
		(ico as HTMLElement).style.cssText = 'font-size:14px;color:var(--vscode-descriptionForeground);';
		const lbl = DOM.append(hdr, DOM.$('span'));
		lbl.textContent = title;
		lbl.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--vscode-descriptionForeground);flex:1;';
		if (count > 0) {
			const badge = DOM.append(hdr, DOM.$('span'));
			badge.textContent = String(count);
			badge.style.cssText = 'font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;background:var(--vscode-badge-background,rgba(128,128,128,0.2));color:var(--vscode-badge-foreground,var(--vscode-editor-foreground));';
		}
		if (onAdd) {
			const addBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
			addBtn.title = `Add ${title}`;
			addBtn.setAttribute('aria-label', `Add ${title}`);
			addBtn.style.cssText = 'width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;color:var(--vscode-foreground);padding:0;';
			const addIco = DOM.append(addBtn, DOM.$('span.codicon.codicon-add'));
			(addIco as HTMLElement).style.cssText = 'font-size:13px;';
			addBtn.addEventListener('mouseenter', () => { addBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; addBtn.style.borderColor = 'var(--vscode-editorWidget-border)'; });
			addBtn.addEventListener('mouseleave', () => { addBtn.style.background = 'transparent'; addBtn.style.borderColor = 'transparent'; });
			addBtn.addEventListener('click', (e) => { e.stopPropagation(); onAdd(); });
		}
	}

	private async _fetch(path: string): Promise<Record<string, unknown> | null> {
		try {
			const res = await this.apiService.fetch(path);
			if (!res.ok) { return null; }
			const data = await res.json();
			return data as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	private _list(result: PromiseSettledResult<Record<string, unknown> | null>): Record<string, unknown>[] {
		if (result.status !== 'fulfilled' || !result.value) { return []; }
		const d = result.value as Record<string, unknown>;
		const inner = (d?.data ?? d) as Record<string, unknown>;
		const arr = inner?.problemsList || inner?.allergiesList || inner?.content || inner?.list || inner?.items || inner?.records
			|| (Array.isArray(inner) ? inner : Array.isArray(d) ? d : []);
		return Array.isArray(arr) ? arr as Record<string, unknown>[] : [];
	}

	override layout(dimension: import('../../../../../base/browser/dom.js').Dimension): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
	}
}
