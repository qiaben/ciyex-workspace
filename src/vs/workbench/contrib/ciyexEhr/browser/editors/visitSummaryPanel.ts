/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { editorBackground, editorForeground, editorWidgetBackground, editorWidgetBorder } from '../../../../../platform/theme/common/colors/editorColors.js';
import { descriptionForeground, errorForeground, textLinkForeground } from '../../../../../platform/theme/common/colors/baseColors.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { ICiyexApiService } from '../ciyexApiService.js';

/** Shape of the encounter `EncounterSummaryDto` returned by
 *  `GET /api/encounters/{patientId}/{encounterId}/summary`. Mirrors the fields
 *  rendered by the EHR-UI `Encountersummary` component so the Visit Summary
 *  panel can show every recorded section. */
interface VisitSummaryMeta {
	visitCategory?: string;
	type?: string;
	facility?: string;
	dateOfService?: string;
	reasonForVisit?: string;
}
interface VisitSummaryChiefComplaint {
	title?: string;
	complaint?: string;
	notes?: string;
}
interface VisitSummaryAssignedProvider {
	id?: number;
	providerName?: string;
	name?: string;
	role?: string;
	start?: string;
	end?: string;
}
interface VisitSummaryTextEntry {
	id?: number;
	description?: string;
	text?: string;
	notes?: string;
}
interface VisitSummaryProviderNote {
	id?: number;
	subjective?: string;
	objective?: string;
	assessment?: string;
	plan?: string;
	narrative?: string;
}
interface VisitSummaryFamilyEntry {
	relation?: string;
	diagnosisText?: string;
	condition?: string;
	details?: string;
	diagnosisCode?: string;
	notes?: string;
}
interface VisitSummaryFamilyHistory {
	id?: number;
	entries?: VisitSummaryFamilyEntry[];
	relation?: string;
	condition?: string;
	details?: string;
}
interface VisitSummarySocialEntry {
	id?: number;
	category?: string;
	value?: string;
	details?: string;
}
interface VisitSummaryRosEntry {
	id?: number;
	systemName?: string;
	isNegative?: boolean;
	findings?: string[];
	notes?: string;
}
interface VisitSummaryVitals {
	id?: number;
	bpSystolic?: number;
	bpDiastolic?: number;
	pulse?: number;
	respiration?: number;
	temperatureC?: number;
	temperatureF?: number;
	oxygenSaturation?: number;
	weightKg?: number;
	weightLbs?: number;
	heightCm?: number;
	heightIn?: number;
	bmi?: number;
	notes?: string;
	recordedAt?: string;
}
interface VisitSummaryExamSection {
	sectionKey?: string;
	allNormal?: boolean;
	normalText?: string;
	findings?: string;
}
interface VisitSummaryPhysicalExam {
	id?: number;
	summary?: string;
	sections?: VisitSummaryExamSection[];
}
interface VisitSummaryCodeItem {
	cpt4?: string;
	description?: string;
	units?: number;
	rate?: number;
	relatedIcds?: string;
	modifier1?: string;
	note?: string;
}
interface VisitSummaryProcedure {
	id?: number;
	cpt4?: string;
	description?: string;
	procedureName?: string;
	units?: number;
	rate?: number;
	relatedIcds?: string;
	codeItems?: VisitSummaryCodeItem[];
}
interface VisitSummaryAssessment {
	id?: number;
	text?: string;
	assessment?: string;
}
interface VisitSummaryPlan {
	id?: number;
	diagnosticPlan?: string;
	plan?: string;
	notes?: string;
	followUpVisit?: string | boolean;
	returnWorkSchool?: string | boolean;
}
interface VisitSummaryProviderSignature {
	signedBy?: string;
	signedAt?: string;
	status?: string;
}
interface VisitSummaryFinalized {
	finalizedAt?: string;
	lockedAt?: string;
}
interface VisitSummaryDTO {
	meta?: VisitSummaryMeta;
	assignedProviders?: VisitSummaryAssignedProvider[];
	chiefComplaints?: VisitSummaryChiefComplaint[];
	hpi?: VisitSummaryTextEntry[];
	pmh?: VisitSummaryTextEntry[];
	patientMH?: VisitSummaryTextEntry[];
	familyHistory?: VisitSummaryFamilyHistory[];
	socialHistory?: { entries?: VisitSummarySocialEntry[] };
	ros?: VisitSummaryRosEntry[];
	physicalExam?: VisitSummaryPhysicalExam[];
	vitals?: VisitSummaryVitals[];
	procedures?: VisitSummaryProcedure[];
	assessment?: VisitSummaryAssessment[];
	plan?: VisitSummaryPlan[];
	providerNotes?: VisitSummaryProviderNote[];
	providerSignature?: VisitSummaryProviderSignature;
	dateTimeFinalized?: VisitSummaryFinalized;
}

/** Services the Visit Summary slide-over needs. */
export interface IVisitSummaryDeps {
	readonly apiService: ICiyexApiService;
	readonly themeService: IThemeService;
	readonly notificationService: INotificationService;
}

interface SummaryColors { bg: string; widgetBg: string; fg: string; border: string; desc: string; link: string; error: string }

/** Resolve concrete theme colours for the visit-summary slide-over.
 *  The panel is mounted on `document.body`, which sits OUTSIDE the workbench
 *  element that scopes the `--vscode-*` CSS variables — so a bare
 *  `var(--vscode-editor-background)` resolves to nothing and the panel paints
 *  transparent. Resolving real hex values from the active theme keeps the panel
 *  opaque and theme-aware in every theme. */
function summaryColors(themeService: IThemeService): SummaryColors {
	const theme = themeService.getColorTheme();
	const c = (id: string, fallback: string): string => {
		const col = theme.getColor(id);
		return col ? col.toString() : fallback;
	};
	return {
		bg: c(editorBackground, '#1e1e1e'),
		widgetBg: c(editorWidgetBackground, '#252526'),
		fg: c(editorForeground, '#d4d4d4'),
		border: c(editorWidgetBorder, '#454545'),
		desc: c(descriptionForeground, '#999999'),
		link: c(textLinkForeground, '#3794ff'),
		error: c(errorForeground, '#f48771'),
	};
}

/** Builds the Visit Summary slide-over (panel + backdrop) and loads its data.
 *  Read-only — it deliberately does NOT redirect to the encounter editor or
 *  patient chart. Shared by the appointments editor and the encounter sidebar. */
export function showVisitSummaryPanel(deps: IVisitSummaryDeps, patientId: string, encounterId: string, patientName: string): void {
	const doc = DOM.getActiveWindow().document;
	const col = summaryColors(deps.themeService);

	// Backdrop dimmer — click outside to dismiss.
	const backdrop = DOM.append(doc.body, DOM.$('div.ciyex-summary-backdrop'));
	backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9998;display:flex;justify-content:flex-end;';

	// Right-anchored slide-over sheet.
	const sheet = DOM.append(backdrop, DOM.$('div.ciyex-summary-sheet'));
	sheet.style.cssText = `background:${col.bg};color:${col.fg};width:min(720px,65vw);height:100%;box-shadow:-8px 0 32px rgba(0,0,0,0.35);display:flex;flex-direction:column;overflow:hidden;font-family:var(--vscode-font-family);`;

	// Header with title + Download PDF + Print + Close.
	const header = DOM.append(sheet, DOM.$('div.ciyex-summary-header'));
	header.style.cssText = `display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid ${col.border};background:${col.widgetBg};flex-shrink:0;`;
	const headerTitle = DOM.append(header, DOM.$('span'));
	// allow-any-unicode-next-line
	headerTitle.textContent = `Visit Summary — ${patientName}`;
	headerTitle.style.cssText = `font-size:14px;font-weight:600;color:${col.fg};flex:1;`;
	const pdfBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
	pdfBtn.textContent = 'Download PDF';
	pdfBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
	const printBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
	printBtn.textContent = 'Print';
	printBtn.style.cssText = `padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid ${col.border};border-radius:4px;cursor:pointer;font-size:12px;`;
	const closeBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
	closeBtn.textContent = 'Close';
	closeBtn.style.cssText = `padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid ${col.border};border-radius:4px;cursor:pointer;font-size:12px;`;

	// Scrollable body where the summary content is rendered.
	const body = DOM.append(sheet, DOM.$('div.ciyex-summary-body'));
	body.style.cssText = `overflow:auto;padding:20px 22px;flex:1;background:${col.bg};`;
	const loading = DOM.append(body, DOM.$('div'));
	loading.textContent = 'Loading encounter summary…';
	loading.style.cssText = `font-size:13px;color:${col.desc};`;

	const dismiss = () => { try { doc.body.removeChild(backdrop); } catch { /* ignore */ } };
	closeBtn.addEventListener('click', dismiss);
	backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { dismiss(); } });

	// Render an actual PDF of the encounter. Pull the server-generated PDF from
	// /summary/print (same endpoint the EHR-UI uses) and trigger a download.
	// Falls back to the in-app browser print dialog if the endpoint is missing.
	pdfBtn.addEventListener('click', async () => {
		const original = pdfBtn.textContent;
		pdfBtn.textContent = 'Generating…';
		pdfBtn.disabled = true;
		try {
			const res = await deps.apiService.fetch(`/api/encounters/${patientId}/${encounterId}/summary/print`, {
				headers: { Accept: 'application/pdf' },
			});
			if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
			const blob = await res.blob();
			const blobUrl = URL.createObjectURL(blob);
			const a = DOM.append(doc.body, DOM.$('a')) as HTMLAnchorElement;
			a.href = blobUrl;
			a.download = `encounter-${encounterId}-summary.pdf`;
			a.style.display = 'none';
			a.click();
			URL.revokeObjectURL(blobUrl);
			a.remove();
		} catch (err) {
			deps.notificationService.notify({ severity: Severity.Warning, message: `Could not generate PDF (${String(err)}). Use Print to save as PDF instead.` });
		} finally {
			pdfBtn.textContent = original;
			pdfBtn.disabled = false;
		}
	});

	printBtn.addEventListener('click', () => {
		// Transient print stylesheet: hide the workbench + chrome so only the
		// summary body lands on paper / the saved PDF.
		const printStyle = doc.createElement('style');
		printStyle.textContent = [
			'@media print{',
			'  body>*:not(.ciyex-summary-backdrop){display:none !important;}',
			'  .ciyex-summary-backdrop{position:static !important;background:#fff !important;display:block !important;inset:auto !important;}',
			'  .ciyex-summary-sheet{box-shadow:none !important;width:100% !important;height:auto !important;}',
			'  .ciyex-summary-header button{display:none !important;}',
			'  .ciyex-summary-body{overflow:visible !important;padding:0 !important;}',
			'  @page{margin:14mm;}',
			'}',
		].join('');
		doc.head.appendChild(printStyle);
		try { DOM.getActiveWindow().print(); }
		finally { try { doc.head.removeChild(printStyle); } catch { /* ignore */ } }
	});

	void loadVisitSummary(deps, patientId, encounterId, body, loading);
}

/** Fetches the encounter summary and renders it into the panel body. */
async function loadVisitSummary(deps: IVisitSummaryDeps, patientId: string, encounterId: string, body: HTMLElement, loading: HTMLElement): Promise<void> {
	try {
		const res = await deps.apiService.fetch(`/api/encounters/${patientId}/${encounterId}/summary`);
		const json = res.ok ? await res.json() : null;
		const data = json?.success ? (json.data ?? null) : null;
		loading.remove();
		if (!data) {
			const errMsg = DOM.append(body, DOM.$('div'));
			errMsg.textContent = json?.message || 'Unable to load encounter summary.';
			errMsg.style.cssText = `font-size:13px;color:${summaryColors(deps.themeService).error};`;
			return;
		}
		renderVisitSummary(deps, body, data);
	} catch (err) {
		loading.textContent = `Failed to load encounter summary: ${String(err)}`;
		loading.style.color = summaryColors(deps.themeService).error;
	}
}

/** Renders the full Encounter Summary (meta + every recorded section) from the
 *  EncounterSummaryDto returned by the backend. Mirrors the EHR-UI
 *  `Encountersummary` layout. */
function renderVisitSummary(deps: IVisitSummaryDeps, body: HTMLElement, data: VisitSummaryDTO): void {
	const col = summaryColors(deps.themeService);

	// A titled card the section renderers append their content into.
	const section = (title: string): HTMLElement => {
		const card = DOM.append(body, DOM.$('div'));
		card.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};padding:16px;margin-bottom:14px;`;
		const t = DOM.append(card, DOM.$('div'));
		t.textContent = title;
		t.style.cssText = `font-weight:600;color:${col.fg};margin-bottom:10px;font-size:14px;`;
		return card;
	};
	// A "label: value" line; skipped entirely when the value is empty.
	const line = (parent: HTMLElement, label: string, value: unknown): void => {
		if (value === undefined || value === null || value === '') { return; }
		const row = DOM.append(parent, DOM.$('div'));
		row.style.cssText = 'font-size:13px;margin-bottom:4px;';
		const b = DOM.append(row, DOM.$('span'));
		b.textContent = `${label}: `;
		b.style.cssText = `font-weight:600;color:${col.desc};`;
		const v = DOM.append(row, DOM.$('span'));
		v.textContent = String(value);
		v.style.cssText = `color:${col.fg};white-space:pre-wrap;`;
	};
	// A simple bulleted line of text.
	const bullet = (parent: HTMLElement, text: string): void => {
		const li = DOM.append(parent, DOM.$('div'));
		li.textContent = `• ${text}`;
		li.style.cssText = `font-size:13px;color:${col.fg};margin-bottom:4px;white-space:pre-wrap;`;
	};

	// --- Encounter Summary (meta) card ---
	const meta = data.meta || {};
	const metaCard = DOM.append(body, DOM.$('div'));
	metaCard.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};padding:18px;margin-bottom:14px;`;
	const cardTitle = DOM.append(metaCard, DOM.$('div'));
	cardTitle.textContent = 'Encounter Summary';
	cardTitle.style.cssText = `font-size:16px;font-weight:700;color:${col.link};border-bottom:2px solid ${col.border};padding-bottom:8px;margin-bottom:14px;`;
	const grid = DOM.append(metaCard, DOM.$('div'));
	grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;';
	const metaFields: Array<[string, string | undefined]> = [
		['Visit Category', meta.visitCategory],
		['Type', meta.type],
		['Facility', meta.facility],
		['Date of Service', meta.dateOfService],
		['Reason for Visit', meta.reasonForVisit],
	];
	let anyMeta = false;
	for (const [label, value] of metaFields) {
		if (!value) { continue; }
		anyMeta = true;
		const fieldRow = DOM.append(grid, DOM.$('div'));
		fieldRow.style.cssText = 'display:flex;font-size:13px;';
		const lbl = DOM.append(fieldRow, DOM.$('span'));
		lbl.textContent = `${label}:`;
		lbl.style.cssText = `font-weight:600;color:${col.desc};min-width:140px;`;
		const val = DOM.append(fieldRow, DOM.$('span'));
		val.textContent = String(value);
		val.style.cssText = `color:${col.fg};`;
	}
	if (!anyMeta) {
		const none = DOM.append(grid, DOM.$('div'));
		none.textContent = 'No encounter details recorded.';
		none.style.cssText = `font-size:13px;color:${col.desc};`;
	}

	let renderedAny = false;

	// --- Assigned Providers ---
	if (data.assignedProviders?.length) {
		renderedAny = true;
		const card = section('Assigned Provider(s)');
		for (const p of data.assignedProviders) {
			const name = p.providerName || p.name || `Provider #${p.id ?? ''}`.trim();
			const parts = [name];
			if (p.role) { parts.push(p.role); }
			const span: string[] = [];
			if (p.start) { span.push(`Start: ${p.start}`); }
			if (p.end) { span.push(`End: ${p.end}`); }
			bullet(card, parts.join(' — ') + (span.length ? ` (${span.join(' · ')})` : ''));
		}
	}

	// --- Chief Complaint ---
	if (data.chiefComplaints?.length) {
		renderedAny = true;
		const card = section('Chief Complaint');
		for (const cc of data.chiefComplaints) {
			const item = DOM.append(card, DOM.$('div'));
			item.style.cssText = 'font-size:13px;margin-bottom:6px;';
			const t = DOM.append(item, DOM.$('div'));
			t.textContent = cc.title || cc.complaint || 'Chief Complaint';
			t.style.cssText = `font-weight:500;color:${col.fg};`;
			if (cc.notes) {
				const n = DOM.append(item, DOM.$('div'));
				n.textContent = cc.notes;
				n.style.cssText = `color:${col.desc};white-space:pre-wrap;`;
			}
		}
	}

	// --- HPI ---
	if (data.hpi?.length) {
		renderedAny = true;
		const card = section('History of Present Illness (HPI)');
		for (const h of data.hpi) { bullet(card, h.description || h.text || h.notes || ''); }
	}

	// --- SOAP / Provider Notes ---
	if (data.providerNotes?.length) {
		renderedAny = true;
		const card = section('SOAP');
		for (const n of data.providerNotes) {
			const block = DOM.append(card, DOM.$('div'));
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;padding:10px;margin-bottom:8px;`;
			line(block, 'S', n.subjective);
			line(block, 'O', n.objective);
			line(block, 'A', n.assessment);
			line(block, 'P', n.plan);
			line(block, 'Narrative', n.narrative);
		}
	}

	// --- Patient Medical History ---
	if (data.patientMH?.length) {
		renderedAny = true;
		const card = section('Patient Medical History');
		for (const x of data.patientMH) { bullet(card, x.description || x.text || ''); }
	}

	// --- Past Medical History ---
	if (data.pmh?.length) {
		renderedAny = true;
		const card = section('Past Medical History (PMH)');
		for (const x of data.pmh) { bullet(card, x.description || x.text || ''); }
	}

	// --- Family History ---
	if (data.familyHistory?.length) {
		renderedAny = true;
		const card = section('Family History');
		for (const block of data.familyHistory) {
			if (Array.isArray(block.entries) && block.entries.length) {
				for (const e of block.entries) {
					const txt = `${e.relation ? `${e.relation}: ` : ''}${e.diagnosisText || e.condition || e.details || e.diagnosisCode || '—'}${e.notes ? ` — ${e.notes}` : ''}`;
					bullet(card, txt);
				}
			} else {
				bullet(card, `${block.relation ? `${block.relation}: ` : ''}${block.condition || block.details || ''}`);
			}
		}
	}

	// --- Social History ---
	if (data.socialHistory?.entries?.length) {
		renderedAny = true;
		const card = section('Social History');
		for (const x of data.socialHistory.entries) {
			bullet(card, `${x.category || 'Item'}: ${x.value || '—'}${x.details ? ` — ${x.details}` : ''}`);
		}
	}

	// --- Review of Systems ---
	if (data.ros?.length) {
		const visible = data.ros.filter(r => (r.findings && r.findings.length > 0) || !r.isNegative);
		if (visible.length) {
			renderedAny = true;
			const card = section('Review of Systems (ROS)');
			for (const r of visible) {
				const row = DOM.append(card, DOM.$('div'));
				row.style.cssText = 'font-size:13px;margin-bottom:6px;';
				const head = DOM.append(row, DOM.$('div'));
				head.style.cssText = `color:${col.fg};font-weight:600;`;
				head.textContent = `${r.systemName || 'System'}:${(r.findings && r.findings.length) ? '' : ' All Negative'}`;
				if (r.findings?.length) { for (const f of r.findings) { bullet(row, f); } }
				if (r.notes) { line(row, 'Note', r.notes); }
			}
		}
	}

	// --- Vitals ---
	if (data.vitals?.length) {
		renderedAny = true;
		const card = section('Vitals');
		for (const v of data.vitals) {
			const block = DOM.append(card, DOM.$('div'));
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;padding:10px;margin-bottom:8px;`;
			const vg = DOM.append(block, DOM.$('div'));
			vg.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;';
			if (v.bpSystolic && v.bpDiastolic) { line(vg, 'BP', `${v.bpSystolic}/${v.bpDiastolic} mmHg`); }
			if (v.pulse) { line(vg, 'Pulse', `${v.pulse} bpm`); }
			if (v.temperatureC) { line(vg, 'Temp', `${v.temperatureC} \u00B0C`); }
			if (v.temperatureF) { line(vg, 'Temp', `${v.temperatureF} \u00B0F`); }
			if (v.respiration) { line(vg, 'Respiration', `${v.respiration} /min`); }
			if (v.oxygenSaturation) { line(vg, 'O2 Sat', `${v.oxygenSaturation}%`); }
			if (v.weightKg) { line(vg, 'Weight', `${v.weightKg} kg`); }
			if (v.weightLbs) { line(vg, 'Weight', `${v.weightLbs} lbs`); }
			if (v.heightCm) { line(vg, 'Height', `${v.heightCm} cm`); }
			if (v.heightIn) { line(vg, 'Height', `${v.heightIn} in`); }
			if (v.bmi) { line(vg, 'BMI', v.bmi); }
			if (v.notes) { line(block, 'Notes', v.notes); }
			if (v.recordedAt) { line(block, 'Recorded', v.recordedAt); }
		}
	}

	// --- Physical Exam ---
	if (data.physicalExam?.length) {
		renderedAny = true;
		const card = section('Physical Exam');
		for (const p of data.physicalExam) {
			const block = DOM.append(card, DOM.$('div'));
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;padding:10px;margin-bottom:8px;`;
			if (p.summary) { line(block, 'Summary', p.summary); }
			for (const s of p.sections || []) {
				const head = DOM.append(block, DOM.$('div'));
				head.style.cssText = `color:${col.fg};font-weight:600;margin-top:4px;`;
				head.textContent = s.sectionKey || 'Section';
				if (s.allNormal) { line(block, 'All normal', 'Yes'); }
				if (s.normalText) { line(block, 'Normal', s.normalText); }
				if (s.findings) { line(block, 'Findings', s.findings); }
			}
		}
	}

	// --- Procedures ---
	if (data.procedures?.length) {
		renderedAny = true;
		const card = section('Procedures');
		for (const p of data.procedures) {
			if (p.codeItems?.length) {
				for (const item of p.codeItems) {
					const parts = [item.cpt4, item.description, typeof item.units === 'number' ? `Units: ${item.units}` : '', item.rate ? `$${item.rate}` : '', item.relatedIcds ? `ICDs: ${item.relatedIcds}` : '', item.modifier1 ? `Modifier: ${item.modifier1}` : ''].filter(Boolean);
					bullet(card, parts.join(' · '));
					if (item.note) { line(card, 'Note', item.note); }
				}
			} else {
				const head = p.cpt4 ? `${p.cpt4} · ${p.description || ''}` : (p.procedureName || 'Procedure');
				const parts = [head, typeof p.units === 'number' ? `Units: ${p.units}` : '', p.rate ? `$${p.rate}` : '', p.relatedIcds ? `ICDs: ${p.relatedIcds}` : ''].filter(Boolean);
				bullet(card, parts.join(' · '));
			}
		}
	}

	// --- Assessment ---
	if (data.assessment?.length) {
		renderedAny = true;
		const card = section('Assessment');
		for (const a of data.assessment) { bullet(card, a.text || a.assessment || ''); }
	}

	// --- Plan ---
	if (data.plan?.length) {
		renderedAny = true;
		const card = section('Plan');
		for (const p of data.plan) {
			const block = DOM.append(card, DOM.$('div'));
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;padding:10px;margin-bottom:8px;`;
			line(block, 'Diagnostic Plan', p.diagnosticPlan);
			line(block, 'Plan', p.plan);
			line(block, 'Notes', p.notes);
			if (p.followUpVisit) { line(block, 'Follow-Up Visit', String(p.followUpVisit)); }
			if (p.returnWorkSchool) { line(block, 'Return Work/School', String(p.returnWorkSchool)); }
		}
	}

	// --- Provider Signature ---
	if (data.providerSignature && (data.providerSignature.signedBy || data.providerSignature.signedAt || data.providerSignature.status)) {
		renderedAny = true;
		const card = section('Provider Signature');
		line(card, 'Signed by', data.providerSignature.signedBy || '—');
		line(card, 'Signed at', data.providerSignature.signedAt);
		line(card, 'Status', data.providerSignature.status);
	}

	// --- Date/Time Finalized ---
	if (data.dateTimeFinalized && (data.dateTimeFinalized.finalizedAt || data.dateTimeFinalized.lockedAt)) {
		renderedAny = true;
		const card = section('Date/Time Finalized');
		line(card, 'Finalized At', data.dateTimeFinalized.finalizedAt);
		line(card, 'Locked At', data.dateTimeFinalized.lockedAt);
	}

	if (!renderedAny) {
		const none = DOM.append(body, DOM.$('div'));
		none.textContent = 'No additional sections recorded for this encounter yet.';
		none.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};padding:18px;text-align:center;font-size:13px;color:${col.desc};`;
	}
}
